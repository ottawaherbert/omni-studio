import { sha256 } from 'js-sha256';
import { GLOBAL_GENERATION_SCOPE, type GenerationExecution, type GenerationReference, type GenerationTarget, type GenerationTaskDraft, type GenerationPlanRevision, type GenerationCapability } from '../../packages/domain/src/generation';

/** Thin transport for existing generation buttons and the worker. All execution goes through frozen plans and idempotent submission. */
export async function submitGenerationRequest(input: {
  projectId?: string; modelConfigId: string; prompt: string; aspectRatio: string;
  operation?: 'asset_image' | 'joint_storyboard' | 'video'; duration?: number; parameters?: Record<string, string | number | boolean>;
  references?: Array<{ url: string; kind: GenerationReference['mediaKind']; role?: GenerationReference['role']; label?: string }>;
  baseUrl?: string; operator?: boolean; operatorToken?: string; grantId?: string; commandId?: string; target?: GenerationTarget;
}) {
  const projectId = input.projectId || input.target?.projectId || GLOBAL_GENERATION_SCOPE;
  if (projectId !== GLOBAL_GENERATION_SCOPE && !input.target) throw new Error('项目生成须指定实际资产、场次或镜头；实验请明确指定 scratch 目标。');
  if (input.target && input.target.projectId !== projectId) throw new Error('生成目标与项目不一致。');
  const base = `${input.baseUrl || ''}/api/${input.operator ? 'operator' : 'production'}/generation`;
  const request = async <T>(path: string, body?: unknown, method = 'POST'): Promise<T> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (input.operator && input.operatorToken) headers.Authorization = `Bearer ${input.operatorToken}`;
    let response: Response;
    try {
      response = await fetch(base + path, { method: body === undefined ? 'GET' : method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new Error('生成服务连接中断，提交状态未确认。请先查询生成记录，勿重复提交。');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `生成请求失败（${response.status}）`);
    return data;
  };
  const operation = input.operation || 'asset_image';
  const catalog = await request<{ recipes: Array<{ capability: GenerationCapability; legacyModelIds: string[]; presets: Array<{ id: string; values: Record<string, string | number | boolean> }> }> }>('/capabilities');
  const references = input.references || [];
  const recipe = catalog.recipes.find(r => r.legacyModelIds.includes(input.modelConfigId) && r.capability.allowedOperations.includes(operation) && (['image', 'video', 'audio'] as const).every(kind => { const n = references.filter(ref => ref.kind === kind).length, limits = r.capability.inputs[kind]; return n >= limits.min && n <= limits.max; }));
  if (!recipe) throw new Error('当前模型与本次参考数量不兼容。请在生成工作台选择可用方案；不会丢弃参考或换模型重试。');
  const unsupported = Object.keys(input.parameters || {}).filter(key => !recipe.capability.parameters.some(def => def.key === key));
  if (unsupported.length) throw new Error(`当前方案不支持这些参数：${unsupported.join('、')}。请在工作台明确调整，不会静默忽略。`);
  const commandId = input.commandId || crypto.randomUUID();
  const target: GenerationTarget = input.target || { projectId, kind: 'scratch', scratchId: `${commandId}:${sha256(JSON.stringify({ model: input.modelConfigId, prompt: input.prompt, aspectRatio: input.aspectRatio, duration: input.duration, parameters: input.parameters, references }))}`, shotIds: [] };
  let { task } = await request<{ task: GenerationTaskDraft }>('/tasks', { target, operation, capabilityId: recipe.capability.id, commandId });
  const existing = await request<{ executions: GenerationExecution[] }>(`/workspaces/current?target=${encodeURIComponent(JSON.stringify(target))}`);
  const previous = existing.executions.find(e => e.idempotencyKey === commandId);
  if (previous) return { execution: previous, poll: () => request<{ execution: GenerationExecution }>(`/executions/${previous.id}`) };
  const refs: GenerationReference[] = [];
  for (const [index, ref] of references.entries()) {
    const role = ref.role || (ref.kind === 'image' ? recipe.capability.mode === 'first_frame_video' ? 'first_frame' : 'composition' : ref.kind === 'video' ? 'motion' : 'full_dialogue');
    const { reference } = await request<{ reference: GenerationReference }>('/references', { projectId, mediaUrl: ref.url, mediaKind: ref.kind, role, label: ref.label || `参考 ${index + 1}` });
    // Same bytes can intentionally occupy two workflow slots with different roles.
    refs.push({ ...reference, id: `${reference.id}:${index}`, enabled: true, source: 'user' });
  }
  const values = { ...recipe.presets.find(p => p.id === input.modelConfigId)?.values, ...input.parameters, aspectRatio: input.aspectRatio, ...(input.duration !== undefined ? { duration: input.duration } : {}) };
  const parameters = { ...task.parameters };
  for (const def of recipe.capability.parameters) if (values[def.key] !== undefined) parameters[def.key] = { value: values[def.key], source: 'user', locked: !!def.locked };
  if (parameters.width && parameters.height && !input.parameters?.width && !input.parameters?.height) {
    const [w, h] = input.aspectRatio.split(':').map(Number), long = Math.max(Number(parameters.width.value), Number(parameters.height.value));
    parameters.width.value = w >= h ? long : Math.round(long * w / h / 8) * 8;
    parameters.height.value = h >= w ? long : Math.round(long * h / w / 8) * 8;
  }
  ({ task } = await request<{ task: GenerationTaskDraft }>(`/tasks/${task.id}`, { expectedRevision: task.revision, patch: { prompt: input.prompt, references: refs, parameters } }, 'PATCH'));
  const checked = await request<{ plan?: GenerationPlanRevision; issues: Array<{ message: string }> }>(`/tasks/${task.id}/preflight`, { expectedRevision: task.revision });
  if (!checked.plan) throw new Error(checked.issues.map(i => i.message).join('\n'));
  const plan = checked.plan;
  const { execution } = await request<{ execution: GenerationExecution }>('/executions', { planRevisionId: plan.id, planHash: plan.planHash, ...(input.grantId ? { grantId: input.grantId } : {}), idempotencyKey: commandId });
  return { execution, poll: () => request<{ execution: GenerationExecution }>(`/executions/${execution.id}`) };
}

export async function waitForGenerationResult(submitted: Awaited<ReturnType<typeof submitGenerationRequest>>, timeoutMs = 3600000) {
  let execution = submitted.execution;
  const start = Date.now();
  for (;;) {
    if (execution.status === 'succeeded') {
      const result = execution.results[0];
      if (!result || result.technicalIssues.length) throw new Error(result?.technicalIssues.join('\n') || '任务没有可用结果');
      return { url: result.mediaUrl, executionId: execution.id, resultId: result.id, candidateId: result.candidateId || result.id, hasAudio: result.hasAudio };
    }
    if (['failed', 'cancelled', 'held', 'reconciling'].includes(execution.status)) throw new Error(`${execution.error || execution.holdCode || execution.status}（任务 ${execution.id}，请在生成记录中处理，勿重复提交）`);
    if (Date.now() - start > timeoutMs) throw new Error(`页面等待超时，任务 ${execution.id} 仍保留，请在生成记录中查询。`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    execution = (await submitted.poll()).execution;
  }
}
