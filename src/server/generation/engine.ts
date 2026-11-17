import { characterReferenceOwner } from '../../services/production/characterReferenceLayouts';
import { readObservations, productionNextActions } from "../../services/production/productionCollaboration";
import { compileComfyGraph } from '../../../packages/domain/src/comfyWorkflow';
import { randomUUID } from 'node:crypto';
import type { AIConfigSnapshot } from '../../config/aiConfigDefaults';
import { GenerationError, assertNoGenerationCycle, enabledReferences, generationTargetKey, resolveGenerationParameters, validateGenerationDraft, initialGenerationDuration,
  type GenerationTaskDraft, type GenerationTarget, type GenerationPlanRevision, type GenerationExecution, type GenerationPolicy, type GenerationGrant, type GenerationReference, type GenerationWorkspace, type GenerationLayout, type GenerationIssue } from '../../../packages/domain/src/generation';
import { buildGenerationCatalog, generationHash, type GenerationRecipe } from './catalog';
import { GenerationLease } from './lease';
import { h3ReferencePrompt } from './h3References';
import { GenerationStore } from './store';
import { GenerationMediaStore } from './media';
import { GenerationProviders, SubmissionUncertain } from './providers';
import { loadGenerationContext } from './context';
import { emptySceneVisualPlan, sceneStoryboardContentHash } from '../../services/production/sceneVisualPlan';
import { dbHelpers } from '../db';
import { stageProductionAssetBoardReferenceCandidate, adoptProductionAssetBoardReferenceCandidate, returnProductionAssetBoardReferenceCandidateToReview, productionAssetBoardCandidateSourceContentHash } from '../../services/production/productionAssetBoardCandidate';
import { stageStoryboardBoardVisualTakeForCreatorReview, adoptStoryboardBoardVisualTake, rejectStoryboardBoardVisualTake } from '../../services/production/storyboardCompositeBoard';
import { appendShotTakeCandidate, adoptShotTake } from '../../services/production/shotTakeReview';
import { buildManualStudioProjectVisualStyleContract } from '../../services/production/manualStudioVideoIntent';
import type { ManualStoryboardBoardVisualTake, Shot } from '../../types/project';
import { ProductionQuality } from '../productionQuality';

const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const active = new Set(['queued', 'held', 'submitting', 'running', 'reconciling']);
const defaultLayout = (): GenerationLayout => ({ revision: 0, nodes: {} });
type Context = ReturnType<typeof loadGenerationContext>;
type ScheduledTask = { id: string; taskId: string; grantId: string; projectId: string; revision: number; status: 'waiting' | 'submitted' | 'held'; fingerprint?: string; error?: string; executionId?: string };
type Suggestion = { id: string; taskId: string; revision: number; parameters: Record<string, string | number | boolean>; enabledReferenceIds: string[]; explanation: string; source: 'rules' | 'ai' };
/** Image and video adoption are independent even when the active take combines both. */
const shotResultIsCurrent = (shot: Shot | undefined, execution: GenerationExecution, result: GenerationExecution['results'][number]) => {
  if (!shot) return false;
  const video = result.mediaKind === 'video';
  const media = video ? shot.videoMedia : shot.imageMedia;
  if ((video ? shot.videoUrl : shot.imageUrl) !== result.mediaUrl) return false;
  if (media?.generationJobId) return media.generationJobId === execution.id;
  const activeTake = shot.takes?.find(take => take.id === shot.activeTakeId);
  const activeMedia = video ? activeTake?.videoMedia : activeTake?.imageMedia;
  if (activeMedia?.generationJobId) return activeMedia.generationJobId === execution.id;
  if (shot.activeTakeId === result.candidateId) return true;
  // Older records lack per-media provenance. Only infer ownership when their
  // original output history is unambiguous; a later same-URL take stays intact.
  const originals = shot.takes?.filter(take => (video ? take.videoUrl : take.imageUrl) === result.mediaUrl
    && take.generationAudit?.action === (video ? 'generate_video' : 'generate_image')) || [];
  const activeOriginal = originals.find(take => take.id === shot.activeTakeId);
  return activeOriginal ? activeOriginal.id === result.candidateId : originals.length === 1 && originals[0].id === result.candidateId;
};
export class GenerationEngine {
  get quality() { return new ProductionQuality(this.store,this.mediaRoot); }
  readonly media: GenerationMediaStore;
  readonly providers: GenerationProviders;
  private timer?: ReturnType<typeof setInterval>;
  readonly leases: GenerationLease;
  private busy = new Set<string>();
  constructor(readonly store: GenerationStore, readonly getConfig: () => AIConfigSnapshot, readonly mediaRoot: string,
    readonly context: (target: GenerationTarget) => Context = loadGenerationContext) {
    this.leases = new GenerationLease(store.db);
    this.media = new GenerationMediaStore(mediaRoot); this.providers = new GenerationProviders(getConfig, this.media);
  }
  catalog() { return buildGenerationCatalog(this.getConfig()); }
  recipe(capabilityId: string) { const recipe = this.catalog().find(r => r.capability.id === capabilityId); if (!recipe) throw new GenerationError('CAPABILITY_UNAVAILABLE', '此方案当前不可用，请查看生成设置或更换兼容方案。'); return recipe; }
  task(taskId: string) { const task = this.store.get<GenerationTaskDraft>('task', taskId); if (!task) throw new GenerationError('TASK_NOT_FOUND', '找不到生成任务。', 404); return task; }
  plan(planId: string) { const plan = this.store.get<GenerationPlanRevision>('plan', planId); if (!plan) throw new GenerationError('PLAN_NOT_FOUND', '找不到已检查的生成方案，请重新检查。', 404); return plan; }
  execution(executionId: string) { const e = this.store.get<GenerationExecution>('execution', executionId); if (!e) throw new GenerationError('EXECUTION_NOT_FOUND', '找不到执行记录。', 404); return e; }
  private planSourceCurrent(plan: GenerationPlanRevision, ctx: Context, sourceHash = plan.sourceHash) {
    if (ctx.sourceHash === sourceHash) return true;
    if (!Object.hasOwn(plan, 'productionBasis') && ctx.preCollaborationSourceHash === sourceHash) return true;
    // Older plans froze these two fingerprints separately. Accept them only
    // with their own saved board evidence; never rewrite the immutable plan.
    return !!ctx.boardSourceHash && !!ctx.legacySourceHash && ctx.legacySourceHash === sourceHash
      && this.store.get<{ boardSourceHash?: string }>('plan-context', plan.id)?.boardSourceHash === ctx.boardSourceHash;
  }
  private draftSourceCurrent(task: GenerationTaskDraft, ctx: Context, plans?: GenerationPlanRevision[]) {
    if (task.sourceHash === ctx.sourceHash) return true;
    if (!ctx.legacySourceHash || task.sourceHash !== ctx.legacySourceHash) return false;
    return (plans || this.store.list<GenerationPlanRevision>('plan', task.target.projectId)).some(plan =>
      plan.taskId === task.id && plan.sourceHash === task.sourceHash && this.planSourceCurrent(plan, ctx));
  }
  workspace(target: GenerationTarget): GenerationWorkspace {
    let ctx: Context;
    try { ctx = this.context(target); }
    catch (error) {
      if (!(error instanceof GenerationError) || !['TARGET_NOT_FOUND', 'TARGET_RANGE_CHANGED'].includes(error.code) || !dbHelpers.getProjectShellById(target.projectId) || !this.store.list<GenerationTaskDraft>('task', target.projectId).some(t => generationTargetKey(t.target) === generationTargetKey(target))) throw error;
      ctx = { project: { id: target.projectId }, target, references: [], sourceHash: 'target-missing', sourceRevision: 0 } as unknown as Context;
    }
    const projectId = ctx.project.id, key = generationTargetKey(target);
    const tasks = this.store.list<GenerationTaskDraft>('task', projectId).filter(t => !t.archived && (target.kind === 'scratch' ? t.target.kind === 'scratch' && (!target.scratchId || generationTargetKey(t.target) === key) : target.kind === 'asset' ? t.target.assetId === target.assetId : t.target.sceneId === target.sceneId && t.target.episodeId === target.episodeId));
    const taskIds = new Set(tasks.map(t => t.id));
    const plans = this.store.list<GenerationPlanRevision>('plan', projectId).filter(p => taskIds.has(p.taskId));
    const contexts = new Map<string, Context>([[key, ctx]]);
    // Each task may target another page or shot. Never compare it with the entry page's source.
    const sources: NonNullable<GenerationWorkspace['sources']> = { [key]: { sourceHash: ctx.sourceHash, sourceRevision: ctx.sourceRevision, references: ctx.references, timingReview: ctx.timingReview } };
    for (const task of tasks) {
      const taskKey = generationTargetKey(task.target);
      if (sources[taskKey]) continue;
      try { const source = this.context(task.target); contexts.set(taskKey, source); sources[taskKey] = { sourceHash: source.sourceHash, sourceRevision: source.sourceRevision, references: source.references, timingReview: source.timingReview }; }
      catch (error) {
        if (!(error instanceof GenerationError) || !['TARGET_NOT_FOUND', 'TARGET_RANGE_CHANGED'].includes(error.code)) throw error;
        sources[taskKey] = { sourceHash: 'target-missing', sourceRevision: 0, references: [] };
      }
    }
    const taskSourceCurrent = Object.fromEntries(tasks.map(task => { const source = contexts.get(generationTargetKey(task.target)); return [task.id, !!source && this.draftSourceCurrent(task, source, plans)]; }));
    return { collaboration: ctx.scene ? productionNextActions(ctx.scene) : undefined, productionWorkingAgreement: ctx.project.productionWorkingAgreement, sources, taskSourceCurrent, scheduled: this.store.list<ScheduledTask>('scheduled-task', projectId).filter(s => taskIds.has(s.taskId)), id: key, target: ctx.target, tasks, plans, capabilities: this.catalog().map(r => r.capability), references: [...ctx.references, ...this.store.list<GenerationReference>('imported-reference', projectId)], executions: this.store.list<GenerationExecution>('execution', projectId).filter(e => taskIds.has(e.taskId)).map(e => this.refreshResultReview(e)), policy: this.store.policy(projectId), grants: this.store.list<GenerationGrant>('grant', projectId), layout: this.store.get<GenerationLayout>('layout', key) || defaultLayout(), sourceHash: ctx.sourceHash, sourceRevision: ctx.sourceRevision };
  }
  create(input: { target: GenerationTarget; operation: GenerationTaskDraft['operation']; capabilityId?: string; commandId: string }) {
    if (!input.commandId || input.commandId.length > 200) throw new GenerationError('COMMAND_REQUIRED', '创建任务缺少有效的操作标识。');
    const commandKey = `${input.target.projectId}:${input.commandId}`, prior = this.store.get<{ taskId: string; hash: string }>('command', commandKey), hash = generationHash(input);
    if (prior) { if (prior.hash !== hash) throw new GenerationError('IDEMPOTENCY_CONFLICT', '相同操作标识对应其他内容。', 409); return this.task(prior.taskId); }
    const ctx = this.context(input.target);
    if (ctx.target.kind === 'scene' && !['joint_storyboard', 'crop', 'extract_frame'].includes(input.operation)) throw new GenerationError('TARGET_OPERATION', '整场目标用于故事板或素材处理；生成视频请选择镜头或视频片段。');
    const policy = this.store.policy(ctx.project.id);
    const compatible = this.catalog().filter(r => r.capability.allowedOperations.includes(input.operation) && !r.capability.diagnostic && !r.capability.supersededBy);
    const desiredRefs = ctx.references.filter(r => r.enabled && r.sourceAssetId).length;
    const config = this.getConfig(), routed = config.models.find(m => m.id === config.routing[input.operation === 'video' ? 'videoGen' : 'imageGen']);
    const ranked = compatible.filter(r => input.operation !== 'video' || !policy.allowedCoreFamilies.length || policy.allowedCoreFamilies.includes(r.capability.coreFamily)).sort((a, b) => {
      const score = (r: GenerationRecipe) => (desiredRefs > 0 && input.operation !== 'video' && r.capability.inputs.image.max === 0 ? -2000 : 0) + (r.legacyModelIds.includes(routed?.id || '') ? 1000 : r.capability.connectionId === routed?.channelId ? 500 : 0) + (input.operation === 'video' ? r.capability.mode === (ctx.target.shotIds.length > 1 ? 'board_guided_video' : 'first_frame_video') ? 100 : 0 : Math.min(r.capability.inputs.image.max, desiredRefs) * 10);
      return score(b) - score(a);
    });
    const plannedId = input.operation === 'video' ? ctx.workflow?.targetVideoModelConfigId || ctx.scene?.visualPlan?.targetVideoModelConfigId : undefined;
    const inherited = plannedId ? ranked.find(r => r.capability.id === plannedId || r.legacyModelIds.includes(plannedId)) : undefined;
    if (!input.capabilityId && plannedId && !inherited) throw new GenerationError('PLANNED_CAPABILITY_UNAVAILABLE', '规划中的生成方案已不可用，请回镜头与时长更换，或明确指定本次方案。');
    const chosen = input.capabilityId ? this.recipe(input.capabilityId) : inherited || ranked[0];
    if (!chosen) throw new GenerationError('CAPABILITY_UNAVAILABLE', '尚无支持当前任务的生成方案，请在设置中配置服务。');
    const cap = chosen.capability;
    const refs = ctx.references.map(r => ({ ...r, enabled: false }));
    const recommended = new Set(ctx.references.filter(r => r.enabled).map(r => r.id));
    let selected = 0;
    for (const ref of [...refs].sort((a, b) => Number(b.role === 'board_sequence') - Number(a.role === 'board_sequence'))) {
      if (!ref.previsSource && (input.operation !== 'video' || ref.locationView !== 'top') && (input.operation === 'video' ? ref.role === 'board_sequence' ? ref.status === 'adopted' : ref.role === 'first_frame' || recommended.has(ref.id) : recommended.has(ref.id) || !ref.sourceAssetId && !ctx.references.some(r => r.sourceAssetId) && ref.role !== 'board_sequence') && (!ref.sourceShotIds?.length || ref.sourceShotIds.some(id => ctx.target.shotIds.includes(id))) && ref.status !== 'source_changed' && ref.mediaKind === 'image' && selected < cap.inputs.image.max && cap.inputs.image.roles.includes(ref.role) && (cap.mode !== 'board_guided_video' || ref.role !== 'board_sequence' || ref.status === 'adopted')) { ref.enabled = true; selected++; }
    }
    const now = Date.now(), taskNumber = this.store.list<GenerationTaskDraft>('task', ctx.project.id).filter(t => generationTargetKey(t.target) === generationTargetKey(ctx.target) && t.operation === input.operation).length + 1;
    const task: GenerationTaskDraft = { id: id('generation-task'), revision: 1, target: ctx.target, label: `${ctx.label} · ${input.operation === 'video' ? '视频' : input.operation === 'asset_image' ? '资产图' : input.operation === 'extract_frame' ? '实际末帧' : input.operation === 'crop' ? '裁切参考' : input.operation === 'image_edit' ? '修改参考图' : '联合宫格'} · 方案 ${taskNumber}`, operation: input.operation, ...(ctx.target.kind === 'scene' && input.operation === 'joint_storyboard' ? { storyboardLayout: { columns: Math.ceil(Math.sqrt(ctx.shots.length)), rows: Math.ceil(ctx.shots.length / Math.ceil(Math.sqrt(ctx.shots.length))), shotIds: ctx.shots.map(s => s.id) } } : {}), capabilityId: cap.id, prompt: input.operation === 'video' ? ctx.videoPrompt : ctx.prompt, references: refs, parameters: Object.fromEntries(cap.parameters.map(p => [p.key, { value: p.key === 'duration' ? initialGenerationDuration(ctx.narrativeSeconds, cap) : p.key === 'aspectRatio' ? ctx.project.aspectRatio || p.default : p.default, source: 'default' as const, locked: false }])), contentType: 'mixed', quality: 'production', narrativeSeconds: ctx.narrativeSeconds, sourceHash: ctx.sourceHash, sourceRevision: ctx.sourceRevision, createdAt: now, updatedAt: now };
    const inheritedPreset = chosen === inherited ? inherited?.presetVariants.find(p => p.id === plannedId) : undefined;
    if (inheritedPreset) for (const [key, value] of Object.entries(inheritedPreset.values)) if (!['duration', 'aspectRatio', 'width', 'height'].includes(key)) task.parameters[key] = { value, source: 'preset', locked: false };
    // Align default output dimensions with the project canvas; retain the workflow's long edge.
    if (task.parameters.width && task.parameters.height) {
      const [w, h] = String(task.parameters.aspectRatio.value).split(':').map(Number);
      const long = Math.max(Number(task.parameters.width.value), Number(task.parameters.height.value));
      if (w && h) { task.parameters.width.value = w >= h ? long : Math.round(long * w / h / 8) * 8; task.parameters.height.value = h >= w ? long : Math.round(long * h / w / 8) * 8; }
    }
    return this.store.db.transaction(() => { this.store.put('task', task.id, ctx.project.id, task, 0); this.store.put('command', commandKey, ctx.project.id, { taskId: task.id, hash }, 0); return task; })();
  }
  update(taskId: string, input: { expectedRevision: number; patch: Partial<Pick<GenerationTaskDraft, 'capabilityId' | 'prompt' | 'references' | 'parameters' | 'contentType' | 'quality' | 'archived' | 'storyboardLayout'>>; refreshSource?: boolean }) {
    const current = this.task(taskId);
    if (current.revision !== input.expectedRevision) throw new GenerationError('DRAFT_CONFLICT', '任务草稿已更新，请重新读取；当前输入仍保留。', 409);
    const patch = input.patch || {};
    if (Object.keys(patch).some(k => !['capabilityId', 'prompt', 'references', 'parameters', 'contentType', 'quality', 'archived', 'storyboardLayout'].includes(k))) throw new GenerationError('PATCH_INVALID', '此修改包含不允许的字段。');
    if (patch.prompt !== undefined && (typeof patch.prompt !== 'string' || patch.prompt.length > 150000)) throw new GenerationError('PATCH_INVALID', '生成内容过长或格式无效。');
    const cap = this.recipe(patch.capabilityId || current.capabilityId).capability;
    if (patch.parameters && Object.values(patch.parameters).some(v => !v || !['string', 'number', 'boolean'].includes(typeof v.value) || typeof v.locked !== 'boolean')) throw new GenerationError('PATCH_INVALID', '参数格式无效。');
    if (patch.references && (!Array.isArray(patch.references) || patch.references.length > 100 || patch.references.some(r => !r || typeof r.id !== 'string' || typeof r.enabled !== 'boolean' || typeof r.locked !== 'boolean'))) throw new GenerationError('PATCH_INVALID', '参考素材格式无效。');
    if (patch.contentType && !['dialogue', 'action', 'mixed'].includes(patch.contentType) || patch.quality && !['preview', 'production'].includes(patch.quality)) throw new GenerationError('PATCH_INVALID', '内容与质量类型无效。');
    if (patch.references && new Set(patch.references.map(r => r.id)).size !== patch.references.length) throw new GenerationError('PATCH_INVALID', '引用编号不能重复。');
    const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: Date.now() };
    if (patch.capabilityId && patch.capabilityId !== current.capabilityId) {
      const saved = this.store.get<Record<string, GenerationTaskDraft['parameters']>>('parameter-history', current.id) || {};
      saved[current.capabilityId] = current.parameters;
      this.store.put('parameter-history', current.id, current.target.projectId, saved);
      next.parameters = saved[cap.id] || Object.fromEntries(cap.parameters.map(p => [p.key, current.parameters[p.key] || { value: p.default, source: 'default', locked: false }]));
    }
    if (input.refreshSource) { const ctx = this.context(current.target); next.sourceHash = ctx.sourceHash; next.sourceRevision = ctx.sourceRevision; next.narrativeSeconds = ctx.narrativeSeconds; }
    assertNoGenerationCycle([...this.store.list<GenerationTaskDraft>('task', current.target.projectId).filter(t => t.id !== current.id), next]);
    return this.store.put('task', current.id, current.target.projectId, next, input.expectedRevision);
  }
  propose(taskId: string, suggested?: Partial<Suggestion>) {
    const task = this.task(taskId), recipe = this.recipe(task.capabilityId), cap = recipe.capability;
    const variant = recipe.presetVariants.find(v => task.quality === 'preview' ? /8.?4|快速|preview/i.test(v.label) : task.contentType === 'action' ? /动作|武戏|action/i.test(v.label) : /10.?6|标准|文戏/i.test(v.label)) || recipe.presetVariants[0];
    const parameters = { ...variant?.values, ...(suggested?.parameters || {}) };
    // Sampling presets must not overwrite content-based request duration.
    if (suggested?.parameters?.duration === undefined) delete parameters.duration;
    for (const [key, value] of Object.entries(parameters)) if (!cap.parameters.some(p => p.key === key && !p.locked) || task.parameters[key]?.locked || task.parameters[key]?.source === 'user') delete parameters[key];
    const selected = suggested?.enabledReferenceIds || task.references.filter(r => r.enabled).map(r => r.id);
    const proposal: Suggestion = { id: id('proposal'), taskId, revision: task.revision, parameters, enabledReferenceIds: selected, source: suggested ? 'ai' : 'rules', explanation: suggested?.explanation || `沿用${variant?.label || cap.label}，保留人工覆盖和锁定项；这是一组已有参数参考，不代表最佳画质。` };
    return this.store.put('proposal', proposal.id, task.target.projectId, proposal, 0);
  }
  applyProposal(taskId: string, proposalId: string, expectedRevision: number) {
    const task = this.task(taskId), proposal = this.store.get<Suggestion>('proposal', proposalId);
    if (!proposal || proposal.taskId !== taskId || proposal.revision !== expectedRevision) throw new GenerationError('PROPOSAL_STALE', '建议依据的草稿已变化，请重新获取。', 409);
    const parameters = { ...task.parameters };
    for (const [key, value] of Object.entries(proposal.parameters)) if (!parameters[key]?.locked && parameters[key]?.source !== 'user') parameters[key] = { value, source: proposal.source === 'ai' ? 'ai' : 'preset', locked: false };
    const references = task.references.map(r => r.locked || r.source === 'user' ? r : { ...r, enabled: proposal.enabledReferenceIds.includes(r.id), source: proposal.source === 'ai' ? 'ai' as const : 'preset' as const });
    return this.update(taskId, { expectedRevision, patch: { parameters, references } });
  }
  private locationReferenceIssues(task: { references: GenerationReference[]; operation: string }, ctx: ReturnType<typeof loadGenerationContext>): GenerationIssue[] {
    const issues: GenerationIssue[] = (ctx.locationViewIssues || []).map(message => ({ code: 'LOCATION_VIEW_NOT_READY', message, blocking: true }));
    // Videos follow the reviewed storyboard. View selection is mandatory while creating images.
    if (task.operation !== 'video') for (const id of ctx.requiredLocationReferenceIds || []) {
      const canonical = ctx.references.find(r => r.id === id);
      if (canonical && !task.references.some(r => r.enabled && r.mediaVersionId === canonical.mediaVersionId)) issues.push({ code: 'LOCATION_VIEW_REQUIRED', message: `请保留必需参考「${canonical.label}」；模型容量不足时请选择支持所需参考图数量的模型。`, blocking: true });
    }
    for (const ref of task.references.filter(r => r.enabled)) {
      const source = ctx.references.find(r => r.mediaVersionId === ref.mediaVersionId);
      if (source?.characterReferenceLayout === 'body_face' && ref.role !== 'character_identity') issues.push({code:'CHARACTER_REFERENCE_ROLE',message:'去头身体与脸部特写板仅用于角色身份，不能作为视频首帧或故事画面。',bindingId:ref.id,blocking:true});
      if (source?.locationView && ref.role !== 'environment') issues.push({ code: 'LOCATION_VIEW_ROLE', message: '场景视角图仅作环境参考，顶视布局图不能作为视频首帧或故事板。', bindingId: ref.id, blocking: true });
    }
    return issues;
  }
  async preflight(taskId: string, expectedRevision: number) {
    const task = this.task(taskId), ctx = this.context(task.target), recipe = this.recipe(task.capabilityId), cap = recipe.capability;
    if (task.revision !== expectedRevision) throw new GenerationError('DRAFT_CONFLICT', '草稿已经变化，请重新检查。', 409);
    const checkedTask = structuredClone(task);
    const dependencyIssues: GenerationIssue[] = [];
    for (const ref of checkedTask.references.filter(r => r.enabled && r.dependency && !r.dependency.resultId)) {
      const outputs = this.store.list<GenerationExecution>('execution', task.target.projectId).filter(e => e.taskId === ref.dependency!.taskId && e.status === 'succeeded').flatMap(e => this.refreshResultReview(e).results);
      const result = outputs.find(r => !r.technicalIssues.length && (ref.dependency!.condition !== 'adopted_current' || r.review === 'adopted'));
      if (result) ref.dependency!.resultId = result.id;
    }
    for (const ref of checkedTask.references.filter(r => r.enabled && r.dependency?.resultId)) {
      const owner = this.store.list<GenerationExecution>('execution', task.target.projectId).find(e => e.taskId === ref.dependency!.taskId && e.results.some(r => r.id === ref.dependency!.resultId));
      const result = owner && this.refreshResultReview(owner).results.find(r => r.id === ref.dependency!.resultId);
      if (!owner || !result || owner.status !== 'succeeded') { dependencyIssues.push({ code: 'DEPENDENCY_WAITING', message: `“${ref.label}”的指定上游结果不可用。`, bindingId: ref.id, blocking: true }); continue; }
      const sourcePlan = this.plan(owner.planId);
      if (sourcePlan.operation === 'joint_storyboard' && ref.role === 'first_frame') dependencyIssues.push({ code: 'BOARD_IS_NOT_FRAME', message: '宫格结果不能直接作为首帧，请先裁切具体画格。', bindingId: ref.id, blocking: true });
      if (ref.dependency!.condition === 'adopted_current' && result.review !== 'adopted') dependencyIssues.push({ code: 'DEPENDENCY_NOT_ADOPTED', message: `“${ref.label}”尚未按正式流程采用。`, bindingId: ref.id, blocking: true });
      if (ref.dependency!.condition === 'measured_frame' && (sourcePlan.operation !== 'extract_frame' || result.technicalIssues.length)) dependencyIssues.push({ code: 'MEASURED_FRAME_REQUIRED', message: '计划画格或原始视频不能冒充实际提取帧。', bindingId: ref.id, blocking: true });
      if (cap.mediaKind === 'video' && ref.role === 'board_sequence' && (sourcePlan.target.sceneId !== task.target.sceneId || sourcePlan.target.shotIds.some(id => !task.target.shotIds.includes(id)))) dependencyIssues.push({ code: 'REFERENCE_SCOPE', message: '该宫格不属于本片段范围。', bindingId: ref.id, blocking: true });
      Object.assign(ref, { mediaUrl: result.mediaUrl, mediaKind: result.mediaKind, mediaVersionId: result.id, contentHash: result.contentHash, status: result.review === 'adopted' ? 'adopted' : result.review === 'source_changed' ? 'source_changed' : 'candidate' });
    }
    for (const ref of checkedTask.references.filter(r => r.enabled && !r.dependency)) {
      const canonical = [...ctx.references, ...this.store.list<GenerationReference>('imported-reference', task.target.projectId)].find(r => r.mediaVersionId === ref.mediaVersionId && r.mediaUrl === ref.mediaUrl);
      if (canonical) Object.assign(ref, { status: canonical.status, qualityIssue: canonical.qualityIssue, shotIds: canonical.shotIds, sourceAssetId: canonical.sourceAssetId, sourceCharacterId: canonical.sourceCharacterId, sourceShotIds: canonical.sourceShotIds, derivedFrom: canonical.derivedFrom, label: canonical.label, previsSource: canonical.previsSource, characterReferenceLayout: canonical.characterReferenceLayout, locationView: canonical.locationView, ...(canonical.previsSource || canonical.locationView || canonical.characterReferenceLayout ? { usageNote: canonical.usageNote } : {}) });
    }
    const timingReview = ['video', 'joint_storyboard'].includes(task.operation) ? ctx.timingReview : undefined;
    const issues = [...this.locationReferenceIssues(checkedTask, ctx), ...dependencyIssues, ...validateGenerationDraft(checkedTask, cap), ...(timingReview?.issues || [])];
    try { this.quality.assertGeneration(task.target,task.operation,checkedTask.references,false); }
    catch(error) { if(!(error instanceof GenerationError))throw error;issues.push({code:error.code,message:error.message,blocking:true}); }
    if (!this.draftSourceCurrent(task, ctx)) issues.push({ code: 'SOURCE_CHANGED', message: '正式场次或资产已变化，请核对并更新任务来源。', blocking: true, allowedActions: ['refresh_source'] });
    for (const r of enabledReferences(checkedTask)) {
      if (r.dependency) {
        const result = r.dependency.resultId && this.store.list<GenerationExecution>('execution', task.target.projectId).find(e => e.results.some(o => o.id === r.dependency!.resultId));
        if (!result) issues.push({ code: 'DEPENDENCY_WAITING', message: `“${r.label}”的上游结果尚不可用。`, bindingId: r.id, blocking: true });
      } else {
        const source = [...ctx.references, ...this.store.list<GenerationReference>('imported-reference', task.target.projectId)].find(item => item.mediaVersionId === r.mediaVersionId && item.mediaUrl === r.mediaUrl);
        if (!source) issues.push({ code: 'REFERENCE_VERSION_CHANGED', message: `“${r.label}”不是当前可用的素材版本，请从引用列表重新选择。`, bindingId: r.id, blocking: true });
        if (source?.role === 'board_sequence' && r.role === 'first_frame') issues.push({ code: 'BOARD_IS_NOT_FRAME', message: '宫格整图不能直接作为视频首帧，请选择或提取具体画格。', bindingId: r.id, blocking: true });
        if (r.role === 'board_sequence' && cap.mediaKind === 'video' && source?.status !== 'adopted') issues.push({ code: 'DEPENDENCY_NOT_ADOPTED', message: '宫格尚未正式采用，视频任务不能使用自报的采用状态。', bindingId: r.id, blocking: true });
      }
    }
    if (issues.some(i => i.blocking)) return { issues, plan: undefined };
    const references: GenerationReference[] = [];
    for (const ref of enabledReferences(checkedTask)) {
      const frozen = await this.media.freeze(ref.mediaUrl, ref.mediaKind);
      references.push({ ...ref, ...frozen });
    }
    try { this.quality.assertGeneration(task.target,task.operation,references); }
    catch(error) { if(!(error instanceof GenerationError))throw error;return {issues:[...issues,{code:error.code,message:error.message,blocking:true}],plan:undefined}; }
    const p = resolveGenerationParameters(task, cap);
    if (cap.referenceAdapter === 'h3_multimodal_v1') for (const reference of references.filter(r => r.mediaKind !== 'image')) {
      const metadata = await this.media.inspect(reference.mediaUrl, reference.mediaKind);
      const maximum = reference.mediaKind === 'video' ? Math.min(15, Number(p.duration)) : 15;
      const minimum = reference.mediaKind === 'video' ? 5 / 24 : 0;
      if (!metadata.durationSeconds || metadata.durationSeconds < minimum || metadata.durationSeconds > maximum + .001) return {
        issues: [{ code: 'REFERENCE_DURATION', message: `“${reference.label}”需为可解码且不超过 ${maximum} 秒的${reference.mediaKind === 'video' ? '视频（24fps 下至少 5 帧）' : '音频'}片段。请先选择所需片段，系统不会静默截断。`, bindingId: reference.id, blocking: true }], plan: undefined,
      };
    }
    if (task.operation === 'crop' && references[0]) {
      const dimensions = await this.media.inspect(references[0].mediaUrl, 'image');
      if (Number(p.cropX) + Number(p.cropWidth) > Number(dimensions.width) || Number(p.cropY) + Number(p.cropHeight) > Number(dimensions.height)) return { issues: [{ code: 'CROP_BOUNDS', message: '裁切区域超出原图范围，请按实际像素调整。', blocking: true }], plan: undefined };
    }
    if (task.operation === 'extract_frame' && references[0] && p.framePosition === 'time') {
      const metadata = await this.media.inspect(references[0].mediaUrl, 'video');
      if (!metadata.durationSeconds || Number(p.frameTimeSeconds) >= metadata.durationSeconds) return { issues: [{ code: 'FRAME_TIME_BOUNDS', message: '取帧时间必须位于原视频时长内，请查看实际视频后选择切点。', blocking: true }], plan: undefined };
    }
    if (p.seed !== undefined && Number(p.seed) === -1) p.seed = Math.floor(Math.random() * 2147483647);
    const current = this.task(taskId);
    if (current.revision !== expectedRevision || this.context(task.target).sourceHash !== ctx.sourceHash) throw new GenerationError('SOURCE_CHANGED', '检查期间草稿或来源发生变化，请重新检查。', 409);
    const duration = Number(p.duration || task.narrativeSeconds || 0);
    const frames = cap.mediaKind === 'video' && cap.coreFamily === 'yz_h3' ? 5 + 17 * Math.max(0, Math.ceil((Math.round(duration * 24) - 5) / 17)) : undefined;
    const style = cap.mediaKind === 'video' && ctx.scene ? buildManualStudioProjectVisualStyleContract(ctx.project, { creativeScope: { episode: ctx.episode, scene: ctx.scene, shot: ctx.shots.length === 1 ? ctx.shots[0] : undefined } }) : '';
    const prompt = [task.prompt, task.storyboardLayout ? `故事板布局：${task.storyboardLayout.columns} 列 × ${task.storyboardLayout.rows} 行，从左到右、从上到下排列。有效画格依次对应：${task.storyboardLayout.shotIds.map((id, i) => `第 ${i + 1} 格 = ${id}`).join('；')}。多格归属同一镜头时表现该镜的不同关键状态；多余空格留白，不添加剧情。这是整体预览，不是要求一次生成整场视频。` : '', style, cap.referenceAdapter === 'h3_multimodal_v1' ? h3ReferencePrompt(references) : references.map((r, i) => `参考 ${i + 1}：${r.label}；用途：${r.role}。${r.usageNote || ''}`).join('\n')].filter(Boolean).join('\n\n');
    if (recipe.template) {
      try { compileComfyGraph(recipe.template, { prompt, aspectRatio: String(p.aspectRatio), width: Number(p.width) || undefined, height: Number(p.height) || undefined, duration, seed: Number(p.seed), images: references.filter(r => r.mediaKind === 'image').map(r => r.mediaUrl), videos: references.filter(r => r.mediaKind === 'video').map(r => r.mediaUrl), audio: references.filter(r => r.mediaKind === 'audio').map(r => r.mediaUrl), parameters: Object.fromEntries((recipe.template.parameters || []).map(def => [def.key, p[def.key]])) }); }
      catch (error) { return { issues: [{ code: 'COMPILE_FAILED', message: this.safeError(error), blocking: true }], plan: undefined }; }
    }
    const data = { productionBasis: ctx.productionBasis ?? null, ...(timingReview ? { timingReview } : {}), taskId, draftRevision: task.revision, target: task.target, operation: task.operation, storyboardLayout: task.storyboardLayout, sourceHash: ctx.sourceHash, sourceRevision: ctx.sourceRevision, capability: cap, prompt, references, parameters: p, narrativeSeconds: task.narrativeSeconds, requestedSeconds: duration, expectedSeconds: frames ? frames / 24 : duration || undefined, compiledFrames: frames, compiledRequestHash: generationHash({ template: recipe.template, prompt, references, parameters: p }), issues };
    const plan: GenerationPlanRevision = { ...data, id: id('generation-plan'), createdAt: Date.now(), planHash: generationHash(data) };
    this.store.put('plan', plan.id, task.target.projectId, plan, 0);
    this.store.put('recipe', plan.id, task.target.projectId, recipe, 0);
    this.store.put('plan-context', plan.id, task.target.projectId, { boardSourceHash: ctx.boardSourceHash, assetSourceHash: task.target.kind === 'asset' ? productionAssetBoardCandidateSourceContentHash({ project: ctx.project, boardItemId: task.target.assetId!, referenceMode: task.target.referenceMode }) : undefined }, 0);
    return { plan, issues };
  }
  async importResult(planId: string, mediaUrl: string, commandId: string) {
    const plan = this.plan(planId);
    if (['extract_frame', 'crop'].includes(plan.operation)) throw new GenerationError('IMPORT_OPERATION', '取帧和裁切必须实际执行本机处理，外部文件请作为普通参考导入。');
    if (typeof mediaUrl !== 'string' || !/^(?:\/media\/|https?:\/\/|data:(?:image|video)\/)/.test(mediaUrl) || typeof commandId !== 'string' || !commandId || commandId.length > 200) throw new GenerationError('IMPORT_INVALID', '请提供外部成果文件和唯一操作编号。');
    const key = `${plan.target.projectId}:external:${commandId}`, hash = generationHash({ planId, mediaUrl });
    const previous = this.store.get<{ executionId: string; hash: string }>('command', key);
    if (previous) { if (previous.hash !== hash) throw new GenerationError('IDEMPOTENCY_CONFLICT', '同一导入编号对应其他成果。', 409); return this.refreshResultReview(this.execution(previous.executionId)); }
    if (!this.planSourceCurrent(plan, this.context(plan.target)) || !this.referenceSourcesCurrent(plan, this.context(plan.target))) throw new GenerationError('SOURCE_CHANGED', '原制作内容已变化，请重新核对导入目标。', 409);
    this.quality.assertGeneration(plan.target,plan.operation,plan.references);
    const frozen = await this.media.freeze(mediaUrl, plan.capability.mediaKind, 256 * 1024 * 1024);
    const metadata = await this.media.inspect(frozen.mediaUrl, plan.capability.mediaKind);
    const technicalIssues: string[] = [];
    if (plan.capability.mediaKind === 'video' && (!metadata.durationSeconds || metadata.durationSeconds > plan.capability.maxDuration + .05 || metadata.durationSeconds + .05 < plan.narrativeSeconds)) technicalIssues.push('实际时长超出限制或不足以覆盖叙事。');
    const execution = this.store.db.transaction(() => {
      const prior = this.store.get<{ executionId: string; hash: string }>('command', key);
      if (prior) { if (prior.hash !== hash) throw new GenerationError('IDEMPOTENCY_CONFLICT', '同一导入编号对应其他成果。', 409); return this.execution(prior.executionId); }
      if (!this.planSourceCurrent(plan, this.context(plan.target)) || !this.referenceSourcesCurrent(plan, this.context(plan.target))) throw new GenerationError('SOURCE_CHANGED', '导入期间原内容已变化，文件已保存但未采用。', 409);
      const executionId = id('external-result'), now = Date.now();
      const result: GenerationExecution = { id: executionId, origin: 'external', taskId: plan.taskId, planId, planHash: plan.planHash, projectId: plan.target.projectId, grantId: '', idempotencyKey: commandId, status: 'succeeded', results: [{ id: `${executionId}:output:0`, ...frozen, ...metadata, mediaKind: plan.capability.mediaKind, technicalIssues, review: 'pending' }], createdAt: now, updatedAt: now };
      this.store.put('execution', result.id, result.projectId, result, 0);
      this.store.put('command', key, result.projectId, { executionId, hash }, 0);
      return result;
    })();
    await this.registerResults(execution);
    return this.execution(execution.id);
  }
  updatePolicy(projectId: string, patch: Partial<GenerationPolicy>, expectedRevision: number) {
    const old = this.store.policy(projectId);
    if (old.revision !== expectedRevision) throw new GenerationError('POLICY_CONFLICT', '生成设置已更新，请重新读取。', 409);
    const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ['imagePaused', 'videoPaused', 'reason', 'allowExperimental', 'allowedCoreFamilies'].includes(k)));
    if (['imagePaused', 'videoPaused', 'allowExperimental'].some(k => k in allowed && typeof allowed[k] !== 'boolean') || ('allowedCoreFamilies' in allowed && (!Array.isArray(allowed.allowedCoreFamilies) || allowed.allowedCoreFamilies.some(v => typeof v !== 'string')))) throw new GenerationError('POLICY_INVALID', '生成设置格式无效。');
    const next = { ...old, ...allowed, projectId, revision: old.revision + 1, updatedAt: Date.now() };
    return this.store.put('policy', projectId, projectId, next, expectedRevision);
  }
  grant(input: Omit<GenerationGrant, 'id' | 'createdAt' | 'usedAttempts' | 'revoked'>) {
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 100 || !Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now() || !['fixed_plans', 'bounded_scope'].includes(input.kind)) throw new GenerationError('GRANT_INVALID', '请明确允许的次数、范围和有效期。');
    if (!input.operations.length || !input.coreFamilies.length || (input.kind === 'fixed_plans' && !input.planIds.length)) throw new GenerationError('GRANT_INVALID', '授权需要明确制作方式、核心和计划范围。');
    if (input.kind === 'bounded_scope' && (!input.allowedRecipeHashes?.length || !input.targetKeys?.length)) throw new GenerationError('GRANT_INVALID', '范围委托需要明确允许的目标和工作流核心版本，不能只指定一个模型家族。');
    for (const planId of input.planIds) if (this.plan(planId).target.projectId !== input.projectId) throw new GenerationError('GRANT_SCOPE_MISMATCH', '授权不能包含其他项目。');
    const grant: GenerationGrant = { ...input, id: id('generation-grant'), usedAttempts: 0, createdAt: Date.now() };
    return this.store.put('grant', grant.id, input.projectId, grant, 0);
  }
  private previsSourcesCurrent(plan: GenerationPlanRevision, ctx: Context) {
    return plan.references.filter(r => r.previsSource).every(ref => {
      const current = ctx.references.find(r => r.mediaVersionId === ref.mediaVersionId);
      return current && !current.qualityIssue && current.status !== 'source_changed' && current.previsSource?.sourceHash === ref.previsSource?.sourceHash;
    });
  }
  private storyboardSourcesCurrent(plan: GenerationPlanRevision, ctx: Context) {
    const references = [...ctx.references, ...this.store.list<GenerationReference>('imported-reference', plan.target.projectId)];
    return plan.references.filter(ref => ref.role === 'board_sequence').every(ref => {
      const current = references.find(item => item.mediaVersionId === ref.mediaVersionId);
      return current && current.status !== 'source_changed' && (plan.capability.mediaKind !== 'video' || current.status === 'adopted');
    });
  }
  private referenceSourcesCurrent(plan: GenerationPlanRevision, ctx: Context) {
    return this.previsSourcesCurrent(plan, ctx) && this.storyboardSourcesCurrent(plan, ctx) && !this.locationReferenceIssues({ ...plan, references: plan.references.map(r => ({ ...r, enabled: true })) }, ctx).length;
  }
  assertAllowed(plan: GenerationPlanRevision, grant?: GenerationGrant, charged = false) {
    const policy = this.store.policy(plan.target.projectId);
    if (plan.capability.mediaKind === 'video' ? policy.videoPaused : policy.imagePaused) throw new GenerationError('GENERATION_PAUSED', (plan.capability.mediaKind === 'video' ? policy.reason : undefined) || '当前类型已暂停生成，仍可编辑方案和查看已有结果。', 409);
    if (plan.capability.mediaKind === 'video' && policy.allowedCoreFamilies.length && !policy.allowedCoreFamilies.includes(plan.capability.coreFamily)) throw new GenerationError('CORE_NOT_ALLOWED', '此项目指定了生成核心，不能自动更换。', 409);
    if (plan.capability.experimental && !policy.allowExperimental) throw new GenerationError('EXPERIMENT_NOT_ALLOWED', '此方式包含尚未实测的组合，请明确允许实验方式后再生成。', 409);
    // Only legacy executions that explicitly carry a grant retain its restrictions.
    if (grant) {
      if (grant.revoked || grant.expiresAt < Date.now() || grant.projectId !== plan.target.projectId || (grant.kind === 'fixed_plans' && !grant.planIds.includes(plan.id)) || (grant.sceneId && grant.sceneId !== plan.target.sceneId) || !grant.operations.includes(plan.operation) || !grant.coreFamilies.includes(plan.capability.coreFamily) || (!charged && grant.usedAttempts >= grant.maxAttempts)) throw new GenerationError('GRANT_SCOPE_MISMATCH', '本次方案不在允许范围内或次数已用完。', 409);
      if (grant.allowedRecipeHashes?.length && !grant.allowedRecipeHashes.includes(plan.capability.fixedCoreHash)) throw new GenerationError('GRANT_SCOPE_MISMATCH', '此工作流核心版本不在委托范围内。', 409);
      if (grant.targetKeys?.length && !grant.targetKeys.includes(generationTargetKey(plan.target))) throw new GenerationError('GRANT_SCOPE_MISMATCH', '制作目标不在委托范围内。', 409);
      const targetConstraint = grant.targetConstraints?.[generationTargetKey(plan.target)];
      for (const [key, value] of Object.entries({ ...grant.fixedParameters, ...targetConstraint?.fixedParameters })) if (plan.parameters[key] !== value) throw new GenerationError('LOCKED_FIELD_CONFLICT', '委托锁定的参数不能改变。', 409);
      for (const [key, range] of Object.entries(grant.parameterRanges || {})) {
        const value = plan.parameters[key];
        if (range.values && !range.values.includes(value) || range.min !== undefined && Number(value) < range.min || range.max !== undefined && Number(value) > range.max) throw new GenerationError('GRANT_SCOPE_MISMATCH', '参数超出本次委托范围。', 409);
      }
      for (const version of [...(grant.fixedReferenceVersionIds || []), ...(targetConstraint?.fixedReferenceVersionIds || [])]) if (!plan.references.some(r => r.mediaVersionId === version)) throw new GenerationError('LOCKED_FIELD_CONFLICT', '委托锁定的参考版本不能移除。', 409);
      if (!grant.allowUnknownCost && plan.capability.provider !== 'local') throw new GenerationError('BUDGET_UNAVAILABLE', '此连接暂未提供可靠费用上界，不能保证金额上限；可明确允许有限次数。', 409);
    }
    const currentContext = this.context(plan.target);
    if (!this.planSourceCurrent(plan, currentContext)) throw new GenerationError('SOURCE_CHANGED', '上游来源已变化，任务保留，重新检查后才能继续。', 409);
    if (!this.previsSourcesCurrent(plan, currentContext)) throw new GenerationError('PREVIS_SOURCE_CHANGED', '影视城、机位或镜头已变化，或接触检查未通过；请核对并重拍相关参考，旧成果保留。', 409);
    if (!this.storyboardSourcesCurrent(plan, currentContext)) throw new GenerationError('STORYBOARD_SOURCE_CHANGED', '宫格来源或采用状态已变化，请重新核对当前参考；旧成果保留。', 409);
    const locationIssues = this.locationReferenceIssues({ ...plan, references: plan.references.map(r => ({...r, enabled:true})) }, currentContext);
    if (locationIssues.length) throw new GenerationError(locationIssues[0].code, locationIssues[0].message, 409);
    const current = this.recipe(plan.capability.id).capability;
    if (current.deploymentFingerprint !== plan.capability.deploymentFingerprint || current.fixedCoreHash !== plan.capability.fixedCoreHash) throw new GenerationError('CAPABILITY_CHANGED', '服务或工作流版本发生变化，请重新检查。', 409);
    this.quality.assertGeneration(plan.target,plan.operation,plan.references);
  }
  submit(planId: string, planHash: string, grantId: string | undefined, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 300) throw new GenerationError('IDEMPOTENCY_REQUIRED', '缺少有效的重复提交识别码。');
    const plan = this.plan(planId);
    if (plan.planHash !== planHash) throw new GenerationError('PLAN_HASH_MISMATCH', '提交的内容与检查方案不一致。', 409);
    return this.store.db.transaction(() => {
      const prior = this.store.get<{ executionId: string; planHash: string }>('idempotency', idempotencyKey);
      if (prior) { if (prior.planHash !== planHash) throw new GenerationError('IDEMPOTENCY_CONFLICT', '相同提交识别码已属于其他方案。', 409); return this.execution(prior.executionId); }
      const task = this.task(plan.taskId);
      if (task.revision !== plan.draftRevision) throw new GenerationError('DRAFT_CONFLICT', '任务已修改，请检查当前版本。', 409);
      const grant = grantId ? this.store.get<GenerationGrant>('grant', grantId) : undefined;
      if (grantId && !grant) throw new GenerationError('GRANT_REQUIRED', '请先明确本次生成范围。', 409);
      this.assertAllowed(plan, grant);
      const now = Date.now(), execution: GenerationExecution = { id: id('generation-execution'), taskId: plan.taskId, planId, planHash, projectId: plan.target.projectId, grantId: grantId || '', idempotencyKey, status: 'queued', results: [], createdAt: now, updatedAt: now };
      if (grant) this.store.put('grant', grant.id, grant.projectId, { ...grant, usedAttempts: grant.usedAttempts + 1 });
      this.store.put('execution', execution.id, execution.projectId, execution, 0);
      this.store.put('idempotency', idempotencyKey, execution.projectId, { executionId: execution.id, planHash }, 0);
      return execution;
    })();
  }
  assertDispatch(executionId: string) {
    const execution = this.execution(executionId), grant = execution.grantId ? this.store.get<GenerationGrant>('grant', execution.grantId) : undefined;
    if ((execution.grantId && !grant) || !active.has(execution.status) || execution.status === 'held') throw new GenerationError('GENERATION_HELD', '原执行已暂停或不可继续提交。', 409);
    this.assertAllowed(this.plan(execution.planId), grant, true);
  }
  private writeExecution(e: GenerationExecution, patch: Partial<GenerationExecution>) { const latest = this.execution(e.id); return this.store.put('execution', e.id, e.projectId, { ...latest, ...patch, updatedAt: Date.now() }); }
  async process(executionId: string) {
    if (this.busy.has(executionId)) return;
    const release = this.leases.acquire(`execution:${executionId}`); if (!release) return;
    this.busy.add(executionId);
    try {
      let execution = this.execution(executionId); if (!active.has(execution.status) || execution.status === 'held') return;
      const plan = this.plan(execution.planId);
      if (!execution.providerTaskId && !execution.providerRecordId) {
        if (execution.status === 'reconciling') return;
        try {
          this.assertDispatch(execution.id);
          execution = this.writeExecution(execution, { status: 'submitting', dispatchStage: 'preparing', error: undefined });
          const recipe = this.store.get<GenerationRecipe>('recipe', plan.id)!;
          const result = await this.providers.submit(plan, recipe, execution, posting => { this.assertDispatch(execution.id); if (posting) this.writeExecution(execution, { dispatchStage: 'posting' }); });
          execution = this.writeExecution(execution, { ...result, status: 'queued', dispatchStage: 'accepted' });
        } catch (error) {
          const hold = error instanceof GenerationError && (error.code.startsWith('QUALITY_') || ['PRODUCTION_QUALITY_BLOCKED','GENERATION_PAUSED', 'GENERATION_HELD', 'GRANT_SCOPE_MISMATCH', 'SOURCE_CHANGED', 'CAPABILITY_CHANGED'].includes(error.code));
          this.writeExecution(execution, { status: hold ? 'held' : error instanceof SubmissionUncertain ? 'reconciling' : 'failed', holdCode: hold ? (error as GenerationError).code : undefined, error: this.safeError(error) }); return;
        }
      }
      const result = await this.providers.poll(plan, execution);
      if (result.status === 'succeeded') {
        const outputs = result.outputs?.filter(o => o.kind === plan.capability.mediaKind) || [];
        if (!outputs.length) throw new GenerationError('OUTPUT_MISSING', '任务返回成功但没有目标媒体，等待核对。');
        const results = [];
        for (const [index, output] of outputs.entries()) {
          const frozen = await this.media.freeze(output.url, output.kind, 256 * 1024 * 1024), technicalIssues: string[] = [...(output.technicalIssues || [])];
          let metadata: { width?: number; height?: number; durationSeconds?: number; hasAudio?: boolean } = {};
          try { metadata = await this.media.inspect(frozen.mediaUrl, output.kind); } catch { technicalIssues.push('媒体测量未通过，不能作为已验收成果。'); }
          if (output.kind === 'video' && (!Number.isFinite(metadata.durationSeconds) || !metadata.durationSeconds || metadata.durationSeconds > plan.capability.maxDuration + .05 || metadata.durationSeconds + .05 < plan.narrativeSeconds)) technicalIssues.push('实际时长超出限制或不足以覆盖叙事。');
          results.push({ id: `${execution.id}:output:${index}`, ...frozen, mediaKind: output.kind, ...metadata, technicalIssues, review: 'pending' as const });
        }
        execution = this.writeExecution(execution, { status: 'succeeded', results, providerTaskId: result.providerTaskId || execution.providerTaskId, error: undefined });
        await this.registerResults(execution);
      } else this.writeExecution(execution, { status: result.status, error: result.error, providerTaskId: result.providerTaskId || execution.providerTaskId });
    } catch (error) { const e = this.execution(executionId); const held = error instanceof GenerationError && ['GENERATION_PAUSED', 'SOURCE_CHANGED', 'CAPABILITY_CHANGED', 'GRANT_SCOPE_MISMATCH', 'GENERATION_HELD'].includes(error.code); this.writeExecution(e, { ...(held ? { status: 'held' as const, holdCode: (error as GenerationError).code } : {}), error: this.safeError(error) }); }
    finally { release(); this.busy.delete(executionId); }
  }
  safeError(error: unknown) { let message = error instanceof Error ? error.message : '生成处理失败，原输入保留。'; for (const c of [...this.getConfig().channels, ...this.getConfig().models.map(m => ({ apiKey: m.apiKeyOverride }))]) if (c.apiKey) message = message.replaceAll(c.apiKey, '[已隐藏]'); return message.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').slice(0, 1800); }
  async registerResults(execution: GenerationExecution) {
    const plan = this.plan(execution.planId);
    const results = execution.results.map(result => {
      if (result.candidateId) return result;
      try {
        const ctx = this.context(plan.target), candidateId = result.id, now = Date.now();
        const outputModelId = execution.origin === 'external' ? 'external-import' : plan.capability.modelConfigId;
        const media = { id: `media-${result.contentHash}`, url: result.mediaUrl, kind: result.mediaKind, source: execution.origin === 'external' ? 'upload' as const : 'ai_generation' as const, status: 'ready' as const, generationJobId: execution.id, modelId: outputModelId, createdAt: now, updatedAt: now };
        if (['extract_frame', 'crop'].includes(plan.operation)) {
          const reference: GenerationReference = { id: `frame:${result.id}`, label: plan.operation === 'extract_frame' ? (plan.parameters.framePosition === 'time' ? `视频画面 · ${plan.parameters.frameTimeSeconds} 秒` : '实际视频末帧') : '裁切参考图', mediaKind: 'image', mediaUrl: result.mediaUrl, mediaVersionId: result.id, contentHash: result.contentHash, role: 'composition', sourceShotIds: plan.references[0]?.sourceShotIds || plan.references[0]?.shotIds || plan.target.shotIds, enabled: false, locked: false, source: 'user', status: 'candidate', derivedFrom: { executionId: execution.id, resultId: result.id, operation: plan.operation as 'extract_frame' | 'crop', sourceMediaVersionId: plan.references[0]?.mediaVersionId, ...(plan.operation === 'extract_frame' ? { framePosition: plan.parameters.framePosition === 'time' ? 'time' as const : 'end' as const, frameTimeSeconds: plan.parameters.framePosition === 'time' ? Number(plan.parameters.frameTimeSeconds) : undefined } : {}) } };
          this.store.put('imported-reference', `${execution.projectId}:${reference.id}`, execution.projectId, reference);
        } else if (plan.target.kind === 'scratch') {
          // Result ownership stays in this workspace; importing it is a separate domain action.
        } else if (plan.target.kind === 'scene' && plan.operation === 'joint_storyboard') {
          // The execution owns this candidate until review; never attach a whole board to the first shot.
        } else if (plan.target.kind === 'asset') {
          const assetSourceHash = this.store.get<{ assetSourceHash?: string }>('plan-context', plan.id)?.assetSourceHash;
          const updates = stageProductionAssetBoardReferenceCandidate({ project: ctx.project, candidateId, boardItemId: plan.target.assetId!, imageUrl: result.mediaUrl, finalPrompt: plan.prompt, source: execution.origin === 'external' ? 'upload' : 'ai_generation', modelId: outputModelId, referenceMode: plan.target.referenceMode, sourceContentHash: assetSourceHash, selectedContextIds: [], sourceRunId: execution.id, executionProvenance: execution.origin === 'external' ? { source: 'manual_external', provider: 'external', modelId: outputModelId } : { source: 'api', provider: plan.capability.provider, modelId: outputModelId, requestedModelId: plan.capability.modelConfigId } });
          dbHelpers.updateProjectMeta(ctx.project.id, updates);
        } else if (plan.target.kind === 'board' && result.mediaKind === 'image' && ctx.workflow?.board && ctx.page && ctx.episode && ctx.scene) {
          const source = this.store.get<{ boardSourceHash?: string }>('plan-context', plan.id)?.boardSourceHash;
          const take: ManualStoryboardBoardVisualTake = { id: candidateId, imageUrl: result.mediaUrl, sourceImageUrl: result.mediaUrl, imageMedia: media as any, sourceImageMedia: media as any, sourceHash: source || plan.sourceHash, prompt: plan.prompt, promptHash: generationHash(plan.prompt), modelId: outputModelId, selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], selectedAssetBoardItemIds: plan.references.flatMap(r => r.sourceAssetId ? [r.sourceAssetId] : []), referenceImageUrls: plan.references.map(r => r.mediaUrl), panelIds: ctx.page.panelIds, attempt: 1, status: 'candidate', review: { mode: 'manual', status: 'pending' }, executions: [], createdAt: now };
          const page = stageStoryboardBoardVisualTakeForCreatorReview({ page: ctx.page, take });
          ctx.workflow.board.visualPages = ctx.workflow.board.visualPages!.map(p => p.id === page.id ? page : p);
          dbHelpers.updateEpisode(ctx.project.id, ctx.episode.id, ctx.episode);
        } else if (ctx.scene && ctx.episode) {
          const shot = ctx.shots[0];
          const take = { id: candidateId, [result.mediaKind === 'video' ? 'videoUrl' : 'imageUrl']: result.mediaUrl, [result.mediaKind === 'video' ? 'videoMedia' : 'imageMedia']: media, createdAt: now, generationAudit: { ...(result.mediaKind === 'video' && result.hasAudio !== undefined ? { audioProvenance: { source: plan.references.some(r => r.role === 'full_dialogue') ? 'full_dialogue_master' : plan.references.some(r => r.role === 'voice_timbre') ? 'reference_voice' : 'provider_native', embeddedAudio: result.hasAudio, masterAudioAssetIds: plan.references.filter(r => r.role === 'full_dialogue').map(r => r.mediaVersionId), mustNotAutoDub: result.hasAudio } } : {}), action: result.mediaKind === 'video' ? 'generate_video' : 'generate_image', targetKind: ctx.workflow ? 'storyboard_board' : 'shot', shotId: shot.id, boardId: plan.target.boardId, sourceHash: plan.sourceHash, promptHash: generationHash(plan.prompt), authorPrompt: plan.prompt, providerType: execution.origin === 'external' ? 'manual_external' : plan.capability.provider, providerNativeVideoOptions: plan.parameters, videoTaskId: execution.providerRecordId || execution.id, videoProviderTaskId: execution.providerTaskId, videoTaskStatus: 'succeeded', videoIdempotencyKey: execution.idempotencyKey } };
          if (ctx.workflow) ctx.workflow.takes = [...(ctx.workflow.takes || []).filter(t => t.id !== candidateId), take as any];
          else ctx.scene.shots = ctx.scene.shots.map(s => s.id === shot.id ? appendShotTakeCandidate(s, take as any) : s);
          dbHelpers.updateEpisode(ctx.project.id, ctx.episode.id, ctx.episode);
        } else throw new Error('原目标已变化，媒体已保存，请重新关联。');
        return { ...result, candidateId, registrationError: undefined, review: this.planSourceCurrent(plan, ctx) && this.referenceSourcesCurrent(plan, ctx) ? result.review : 'source_changed' as const };
      } catch (error) { return { ...result, registrationError: this.safeError(error) }; }
    });
    this.writeExecution(execution, { results });
  }
  refreshResultReview(execution: GenerationExecution) {
    try {
      const plan = this.plan(execution.planId), ctx = this.context(plan.target);
      if (plan.target.kind === 'scratch') return execution;
      return { ...execution, results: execution.results.map(result => {
        const boardTake = ctx.page?.visualTakes?.find(t => t.id === result.candidateId);
        const adopted = plan.target.kind === 'scene' && plan.operation === 'joint_storyboard' ? ctx.scene?.visualPlan?.overview?.candidateId === result.candidateId : boardTake ? boardTake.id === ctx.page?.activeVisualTakeId && boardTake.status === 'adopted' : ctx.workflow ? ctx.workflow.activeTakeId === result.candidateId : shotResultIsCurrent(ctx.shots[0], execution, result);
        const assetAdopted = plan.target.kind === 'asset' && ctx.project.manualProductionAssets?.references?.some(r => { if (r.candidateId !== result.candidateId) return false; if (!r.characterReferenceLayout) return true; const character=ctx.project.characters.find(c=>c.id===r.assetId); const owner=character ? characterReferenceOwner(character,r.variantId) : undefined; return owner?.cleanReferenceImageUrl === r.imageUrl && owner.cleanReferenceLayout === r.characterReferenceLayout; });
        if (result.review === 'needs_changes' && !adopted && !assetAdopted) return result;
        return { ...result, review: !this.planSourceCurrent(plan, ctx, result.adoptedSourceHash || plan.sourceHash) || !this.referenceSourcesCurrent(plan, ctx) ? 'source_changed' as const : adopted || assetAdopted ? 'adopted' as const : result.review === 'adopted' && !['crop', 'extract_frame'].includes(plan.operation) ? 'superseded' as const : result.review };
      }) };
    } catch { return { ...execution, results: execution.results.map(r => ({ ...r, review: 'source_changed' as const })) }; }
  }
  review(executionId: string, resultId: string, verdict: 'adopted' | 'needs_changes', expectedRevision: number | undefined, notes: string, review: { observations?: import("../../../packages/domain/src/productionCollaboration").ProductionObservation[]; reviewer: 'creator' | 'external_agent'; contentHash?: string; sourceHash?: string } = { reviewer: 'creator' }) {
    const execution = this.execution(executionId), plan = this.plan(execution.planId), result = execution.results.find(r => r.id === resultId);
    if (execution.status !== 'succeeded' || !result || !result.candidateId) throw new GenerationError('RESULT_NOT_READY', '候选尚未完成登记，原文件仍保留。', 409);
    if (!['adopted', 'needs_changes'].includes(verdict)) throw new GenerationError('REVIEW_INVALID', '检查结论无效。');
    if (review.reviewer === 'external_agent' && (!notes.trim() || review.contentHash !== undefined && review.contentHash !== result.contentHash || review.sourceHash !== undefined && review.sourceHash !== plan.sourceHash)) throw new GenerationError('REVIEW_EVIDENCE_REQUIRED', '外部 Agent 检查需提供实际观察；附带的来源信息须与当前候选一致。', 409);
    if (verdict === 'adopted' && result.technicalIssues.length) throw new GenerationError('TECHNICAL_CHECK_FAILED', '素材或执行核对未通过，不能采用。', 409);
    const observations=review.observations ? readObservations(review.observations).map(o=>({...o,checkedAt:Date.now(),reviewer:review.reviewer})) : undefined;
    if (!observations?.length && verdict === 'adopted' && this.refreshResultReview(execution).results.find(r => r.id === resultId)?.review === 'adopted' && this.planSourceCurrent(plan, this.context(plan.target), result.adoptedSourceHash || plan.sourceHash)) return this.refreshResultReview(execution);
    this.store.db.transaction(() => {
      const ctx = this.context(plan.target);
      if (verdict === 'adopted') {
        if (!this.previsSourcesCurrent(plan, ctx)) throw new GenerationError('PREVIS_SOURCE_CHANGED', '白模参考来源已变化，请核对并重新制作；已有媒体保留。', 409);
        if (!this.storyboardSourcesCurrent(plan, ctx)) throw new GenerationError('STORYBOARD_SOURCE_CHANGED', '宫格来源或采用状态已变化，请核对并重新制作；已有媒体保留。', 409);
        if (!this.planSourceCurrent(plan, ctx)) throw new GenerationError('SOURCE_CHANGED', '候选来源已变化，请核对后重新制作或关联，不能覆盖当前稿。', 409);
        if (ctx.episode && expectedRevision !== undefined && ctx.episode.productionRevision !== expectedRevision) throw new GenerationError('DRAFT_CONFLICT', '制作版本已变化，请刷新后核对。', 409);
        if (['extract_frame', 'crop'].includes(plan.operation)) {
          const key = `${execution.projectId}:frame:${result.id}`, reference = this.store.get<GenerationReference>('imported-reference', key);
          if (!reference) throw new GenerationError('REFERENCE_MISSING', '实际末帧尚未登记。');
          this.store.put('imported-reference', key, execution.projectId, { ...reference, status: 'adopted' });
        } else if (plan.target.kind === 'asset') dbHelpers.updateProjectMeta(ctx.project.id, adoptProductionAssetBoardReferenceCandidate({ project: ctx.project, candidateId: result.candidateId!, adoptedBy: review.reviewer === 'external_agent' ? 'external_agent' : 'user', review: { mode: 'manual', status: 'approved', reviewer: review.reviewer, notes, reviewedAt: Date.now() } }));
        else if (ctx.episode && ctx.scene) {
          if (plan.target.kind === 'scene' && plan.operation === 'joint_storyboard') {
            const layout = plan.storyboardLayout;
            if (!layout || !result.width || !result.height) throw new GenerationError('STORYBOARD_LAYOUT', '缺少画格映射或实际尺寸，不能采用。');
            const previous = ctx.scene.visualPlan || emptySceneVisualPlan();
            ctx.scene.visualPlan = { ...previous, overviewHistory: [...(previous.overviewHistory || []), ...(previous.overview ? [previous.overview] : [])], overview: { ...layout, imageUrl: result.mediaUrl, width: result.width, height: result.height, candidateId: result.candidateId, sourceHash: plan.sourceHash, contentHash: sceneStoryboardContentHash(ctx.scene) }, updatedAt: Date.now() };
          } else if (plan.target.kind === 'board' && ctx.page && ctx.workflow?.board) {
            const take = ctx.page.visualTakes?.find(t => t.id === result.candidateId);
            if (!take) throw new GenerationError('TARGET_NOT_FOUND', '对应宫格候选已不存在。', 404);
            const updated = adoptStoryboardBoardVisualTake({ page: ctx.page, take: { ...take, review: { mode: 'manual', status: 'approved', reviewer: review.reviewer, reviewedAt: Date.now(), notes } } });
            ctx.workflow.board.visualPages = ctx.workflow.board.visualPages!.map(p => p.id === updated.id ? updated : p);
          } else if (ctx.workflow) {
            if (!ctx.workflow.takes?.some(t => t.id === result.candidateId)) throw new GenerationError('TARGET_NOT_FOUND', '对应视频候选已不存在。', 404);
            ctx.workflow.activeTakeId = result.candidateId; ctx.workflow.updatedAt = Date.now();
          } else ctx.scene.shots = ctx.scene.shots.map(s => s.id === ctx.shots[0].id ? adoptShotTake(s, result.candidateId!, result.mediaKind === 'video' ? 'video' : 'image') : s);
          dbHelpers.updateEpisode(ctx.project.id, ctx.episode.id, { ...ctx.episode, __requireProductionRevision: true });
        }
      }
      if (verdict === 'needs_changes') {
        if (ctx.episode && expectedRevision !== undefined && ctx.episode.productionRevision !== expectedRevision) throw new GenerationError('DRAFT_CONFLICT', '制作版本已变化，请刷新后核对。', 409);
        if (['extract_frame', 'crop'].includes(plan.operation)) {
          const key = `${execution.projectId}:frame:${result.id}`, reference = this.store.get<GenerationReference>('imported-reference', key);
          if (reference) this.store.put('imported-reference', key, execution.projectId, { ...reference, status: 'candidate' });
        } else if (plan.target.kind === 'asset') {
          dbHelpers.updateProjectMeta(ctx.project.id, returnProductionAssetBoardReferenceCandidateToReview({ project: ctx.project, candidateId: result.candidateId!, reviewer: review.reviewer, notes }));
        } else if (ctx.episode && ctx.scene) {
          if (plan.target.kind === 'scene' && plan.operation === 'joint_storyboard') {
            const visualPlan = ctx.scene.visualPlan;
            if (visualPlan?.overview?.candidateId === result.candidateId) ctx.scene.visualPlan = {
              ...visualPlan, overviewHistory: [...(visualPlan.overviewHistory || []), visualPlan.overview], overview: undefined, updatedAt: Date.now(),
            };
          } else if (plan.target.kind === 'board' && ctx.page && ctx.workflow?.board) {
            if (!ctx.page.visualTakes?.some(t => t.id === result.candidateId)) throw new GenerationError('TARGET_NOT_FOUND', '对应宫格候选已不存在。', 404);
            const updated = rejectStoryboardBoardVisualTake({ page: ctx.page, takeId: result.candidateId!, reviewer: review.reviewer, notes });
            ctx.workflow.board.visualPages = ctx.workflow.board.visualPages!.map(p => p.id === updated.id ? updated : p);
          } else if (ctx.workflow) {
            if (ctx.workflow.activeTakeId === result.candidateId) { ctx.workflow.activeTakeId = undefined; ctx.workflow.updatedAt = Date.now(); }
          } else ctx.scene.shots = ctx.scene.shots.map(shot => shot.id === ctx.shots[0].id && shotResultIsCurrent(shot, execution, result) ? {
            ...shot, activeTakeId: shot.activeTakeId === result.candidateId ? undefined : shot.activeTakeId,
            ...(result.mediaKind === 'video' ? { videoUrl: undefined, videoMedia: undefined } : { imageUrl: undefined, imageMedia: undefined }),
            takes: shot.takes?.map(take => take.id === shot.activeTakeId && take.id !== result.candidateId ? {
              ...take, ...(result.mediaKind === 'video' ? { videoUrl: undefined, videoMedia: undefined } : { imageUrl: undefined, imageMedia: undefined }),
            } : take),
          } : shot);
          dbHelpers.updateEpisode(ctx.project.id, ctx.episode.id, { ...ctx.episode, __requireProductionRevision: true });
        }
      }
      const sourceAfter = verdict === 'adopted' ? this.context(plan.target).sourceHash : undefined;
      this.writeExecution(execution, { results: execution.results.map(r => r.id === resultId ? { ...r, review: verdict, adoptedSourceHash: sourceAfter, ...(observations ? {observations:[...new Map([...(r.observations||[]),...observations].map(o=>[o.id,o])).values()]} : {}) } : r) });
      this.store.put('review', `${executionId}:${resultId}:${Date.now()}`, execution.projectId, { executionId, resultId, verdict, notes, observations, reviewer: review.reviewer, contentHash: result.contentHash, sourceHash: plan.sourceHash, expectedRevision, reviewedAt: Date.now() });
    })();
    return this.refreshResultReview(this.execution(executionId));
  }
  async associate(executionId: string, providerTaskId: string) {
    const execution = this.execution(executionId), plan = this.plan(execution.planId);
    if (execution.status !== 'reconciling' || execution.providerTaskId || typeof providerTaskId !== 'string') throw new GenerationError('RECONCILE_INVALID', '此执行不需要关联上游编号。', 409);
    if (plan.capability.provider !== 'comfyui' || !execution.providerRecordId || !this.providers.comfy) throw new GenerationError('RECONCILE_UNSUPPORTED', '此连接尚不能验证上游请求一致性，请保持待核对状态，不能盲目关联。', 409);
    const task = await this.providers.comfy.reconcileFrozen(execution.providerRecordId, providerTaskId);
    this.writeExecution(execution, { providerTaskId: task.providerTaskId, status: 'queued', error: undefined });
    await this.process(executionId); return this.execution(executionId);
  }
  releaseReservation(executionId: string, evidence: string, actor: 'creator' | 'external_agent') {
    const execution = this.execution(executionId), plan = this.plan(execution.planId);
    if (execution.status !== 'reconciling' || execution.providerTaskId || plan.capability.provider !== 'comfyui' || !execution.providerRecordId || !this.providers.comfy) throw new GenerationError('RESERVATION_RELEASE_INVALID', '仅能释放 ComfyUI 无上游编号的待核对任务占位。', 409);
    const task = this.providers.comfy.releaseReservation(execution.providerRecordId, evidence, actor);
    return this.writeExecution(execution, { dispatchReservationRelease: task.dispatchReservationRelease });
  }
  async resume(executionId: string) {
    const execution = this.execution(executionId);
    if (execution.status === 'held') { const grant = execution.grantId ? this.store.get<GenerationGrant>('grant', execution.grantId) : undefined; if (execution.grantId && !grant) throw new GenerationError('GRANT_REQUIRED', '原允许范围已不存在。'); this.assertAllowed(this.plan(execution.planId), grant, true); this.writeExecution(execution, { status: 'queued', error: undefined, holdCode: undefined }); }
    await this.process(executionId); return this.execution(executionId);
  }
  async cancel(executionId: string) {
    const e = this.execution(executionId);
    if (!active.has(e.status)) return e;
    if (!e.providerTaskId && !e.providerRecordId && e.status !== 'reconciling' && e.status !== 'submitting') return this.writeExecution(e, { status: 'cancelled', error: undefined });
    await this.providers.cancel(this.plan(e.planId), e); return this.writeExecution(e, { error: '取消请求已发送，正在查询最终状态。' });
  }
  schedule(taskIds: string[], grantId: string | undefined, commandId: string) {
    const grant = grantId ? this.store.get<GenerationGrant>('grant', grantId) : undefined;
    if (grantId && (!grant || grant.kind !== 'bounded_scope' || grant.revoked || grant.expiresAt < Date.now())) throw new GenerationError('GRANT_SCOPE_MISMATCH', '需要尚未失效的范围委托。', 409);
    if (!Array.isArray(taskIds) || !taskIds.length || taskIds.length > 100 || typeof commandId !== 'string' || !commandId || commandId.length > 200) throw new GenerationError('SCHEDULE_INVALID', '请明确等待依赖的任务及操作标识。');
    const tasks = taskIds.map(taskId => this.task(taskId));
    if (tasks.some(task => task.target.projectId !== tasks[0].target.projectId)) throw new GenerationError('SCHEDULE_INVALID', '一次等待队列只能包含同一项目的任务。');
    for (const task of tasks) if (grant && (task.target.projectId !== grant.projectId || !grant.targetKeys?.includes(generationTargetKey(task.target)) || !grant.operations.includes(task.operation))) throw new GenerationError('GRANT_SCOPE_MISMATCH', '任务不在此委托范围内。', 409);
    return this.store.db.transaction(() => tasks.map(task => {
      const key = `${grant?.id || 'direct'}:${commandId}:${task.id}`, prior = this.store.get<ScheduledTask>('scheduled-task', key);
      if (prior) return prior;
      const job: ScheduledTask = { id: key, taskId: task.id, grantId: grantId || '', projectId: task.target.projectId, revision: task.revision, status: 'waiting' };
      return this.store.put('scheduled-task', key, task.target.projectId, job, 0);
    }))();
  }
  async processScheduled(job: ScheduledTask) {
    const release = this.leases.acquire(`schedule:${job.id}`); if (!release) return;
    try {
      const current = this.store.get<ScheduledTask>('scheduled-task', job.id);
      if (!current || current.status !== 'waiting') return;
      job = current;
      const task = this.task(job.taskId), grant = job.grantId ? this.store.get<GenerationGrant>('grant', job.grantId) : undefined;
      if ((job.grantId && (!grant || grant.revoked || grant.expiresAt < Date.now())) || task.revision !== job.revision) throw new GenerationError('DELEGATION_HELD', '任务已修改或旧委托已失效，请核对后重新加入等待队列。');
      const fingerprint = generationHash({ revision: task.revision, policy: this.store.policy(job.projectId), source: this.context(task.target).sourceHash, dependencies: task.references.filter(r => r.enabled && r.dependency).map(r => this.store.list<GenerationExecution>('execution', job.projectId).filter(e => e.taskId === r.dependency!.taskId).map(e => this.refreshResultReview(e))) });
      if (job.fingerprint === fingerprint) return;
      const checked = await this.preflight(task.id, task.revision);
      if (!checked.plan) {
        const qualityBlocked = checked.issues.some(issue => issue.blocking && (issue.code.startsWith('QUALITY_') || issue.code === 'PRODUCTION_QUALITY_BLOCKED'));
        this.store.put('scheduled-task', job.id, job.projectId, { ...job, fingerprint, status: qualityBlocked ? 'held' : 'waiting', error: checked.issues.map(i => i.message).join('；') });
        return;
      }
      try { this.assertAllowed(checked.plan, grant); } catch (e) { if (e instanceof GenerationError && ['GENERATION_PAUSED', 'EXPERIMENT_NOT_ALLOWED'].includes(e.code)) { this.store.put('scheduled-task', job.id, job.projectId, { ...job, fingerprint, error: e.message }); return; } throw e; }
      this.store.db.transaction(() => { const execution = this.submit(checked.plan!.id, checked.plan!.planHash, job.grantId || undefined, `delegation:${job.id}`); this.store.put('scheduled-task', job.id, job.projectId, { ...job, status: 'submitted', executionId: execution.id, error: undefined }); })();
    } catch (e) { this.store.put('scheduled-task', job.id, job.projectId, { ...job, status: 'held', error: this.safeError(e) }); }
    finally { release(); }
  }
  async tick() {
    for (const job of this.store.list<ScheduledTask>('scheduled-task').filter(j => j.status === 'waiting')) void this.processScheduled(job);
    const executions = this.store.list<GenerationExecution>('execution');
    for (const e of executions.filter(e => e.status === 'succeeded' && e.results.some(r => !r.candidateId))) void this.registerResults(e);
    for (const e of executions.filter(e => active.has(e.status) && e.status !== 'held')) {
      const plan = this.plan(e.planId), channel = this.getConfig().channels.find(c => c.id === plan.capability.connectionId);
      if (!e.providerTaskId && !e.providerRecordId && plan.capability.provider !== 'comfyui') {
        const count = this.store.list<GenerationExecution>('execution').filter(other => other.id !== e.id && (other.providerTaskId && active.has(other.status) || ['submitting', 'running', 'reconciling'].includes(other.status)) && this.plan(other.planId).capability.connectionId === channel?.id).length;
        if (count >= (channel?.comfyQueue?.maxInFlight || 2)) continue;
      }
      void this.process(e.id);
    }
  }
  start() {
    for (const execution of this.store.list<GenerationExecution>('execution').filter(e => e.status === 'submitting' && !e.providerRecordId && !e.providerTaskId && !this.leases.active(`execution:${e.id}`))) this.writeExecution(execution, { status: execution.dispatchStage === 'posting' ? 'reconciling' : 'queued', error: execution.dispatchStage === 'posting' ? '上次提交中断，先核对上游任务；不会自动重发。' : undefined });
    this.timer = setInterval(() => { void this.tick(); }, 3000); this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
