import type { ProductionObservation } from "./productionCollaboration";
/** Shared generation contracts. No provider credentials or UI positions in plans. */
export type GenerationMediaKind = 'image' | 'video' | 'audio';
export type GenerationOperation = 'asset_image' | 'joint_storyboard' | 'image_edit' | 'video' | 'crop' | 'extract_frame' | 'upscale';
export type GenerationMode = 'text_to_image' | 'reference_image' | 'joint_storyboard' | 'image_edit' | 'text_to_video' | 'first_frame_video' | 'reference_video' | 'board_guided_video';
export type GenerationRole = 'character_identity' | 'environment' | 'prop_identity' | 'style' | 'composition' | 'board_sequence' | 'first_frame' | 'last_frame' | 'motion' | 'voice_timbre' | 'full_dialogue';
export type GenerationTarget = { projectId: string; episodeId?: string; sceneId?: string; kind: 'asset' | 'board' | 'video_unit' | 'shot' | 'scene' | 'scratch'; scratchId?: string; assetId?: string; referenceMode?: 'production_board' | 'clean_reference'; boardId?: string; pageId?: string; unitId?: string; shotIds: string[] };
// A real non-project scope for experiments and global assets; never a database project.
export const GLOBAL_GENERATION_SCOPE = 'generation-global';
export interface GenerationIssue { code: string; message: string; blocking: boolean; field?: string; bindingId?: string; allowedActions?: string[] }
export class GenerationError extends Error {
  constructor(public code: string, message: string, public statusCode = 400, public details?: unknown) { super(message); this.name = 'GenerationError'; }
}
export interface GenerationParameter {
  key: string; label: string; type: 'number' | 'boolean' | 'string'; default: string | number | boolean;
  min?: number; max?: number; integer?: boolean; choices?: Array<string | number>; advanced?: boolean; locked?: boolean;
  enabledBy?: string; description?: string; mappings?: Array<{ nodeId: string; input: string }>; group?: string;
}
export interface GenerationReference {
  characterReferenceLayout?: 'standard' | 'body_face';
  locationView?: 'main' | 'reverse' | 'oblique' | 'top';
  id: string; label: string; mediaKind: GenerationMediaKind; mediaUrl: string; mediaVersionId: string; role: GenerationRole;
  sourceAssetId?: string; sourceTakeId?: string; contentHash?: string; shotIds?: string[]; enabled: boolean; locked: boolean;
  source: 'user' | 'ai' | 'preset'; status: 'adopted' | 'candidate' | 'source_changed';
  dependency?: { taskId: string; resultId?: string; condition: 'generated' | 'adopted_current' | 'measured_frame' };
  derivedFrom?: { executionId: string; resultId: string; operation: 'extract_frame' | 'crop'; sourceMediaVersionId?: string; framePosition?: 'end' | 'time'; frameTimeSeconds?: number };
  /** Provenance is independent from how this reference is used by the destination task. */
  sourceShotIds?: string[];
  sourceCharacterId?: string;
  usageNote?: string;
  /** Canonical content checks, recalculated from saved sources; not an editable approval flag. */
  qualityIssue?: string;
  /** Technical previs is an optional reference, never an adopted final storyboard. */
  previsSource?: { exportId: string; sceneId: string; sourceHash: string; kind: 'grid' | 'video' };
}
export interface GenerationCapability {
  /** Old recipes remain readable/executable; new tasks prefer this replacement. */
  supersededBy?: string;
  referenceAdapter?: 'h3_multimodal_v1';
  sourceCoreHash?: string;
  id: string; recipeRevisionId: string; modelConfigId: string; connectionId: string; connectionName: string;
  label: string; coreLabel: string; provider: string; mediaKind: 'image' | 'video'; mode: GenerationMode;
  minDuration: number; maxDuration: number; durations?: number[]; aspectRatios: string[];
  inputs: Record<GenerationMediaKind, { min: number; max: number; roles: GenerationRole[] }>;
  nativeAudio: boolean; multiShot: boolean; experimental: boolean; diagnostic: boolean;
  evidence: 'declared' | 'compiled' | 'service_tested' | 'creative_reviewed'; evidenceNotes: string[];
  parameters: GenerationParameter[]; defaults: Record<string, string | number | boolean>;
  fixedCoreHash: string; coreFamily: string; deploymentFingerprint: string; allowedOperations: GenerationOperation[];
}
export interface GenerationParameterValue { value: string | number | boolean; source: 'default' | 'preset' | 'ai' | 'user'; locked: boolean }
export interface GenerationStoryboardLayout { columns: number; rows: number; shotIds: string[] }
export interface GenerationTaskDraft {
  storyboardLayout?: GenerationStoryboardLayout;
  id: string; revision: number; target: GenerationTarget; label: string; operation: GenerationOperation;
  capabilityId: string; prompt: string; references: GenerationReference[]; parameters: Record<string, GenerationParameterValue>;
  contentType: 'dialogue' | 'action' | 'mixed'; quality: 'preview' | 'production'; narrativeSeconds: number;
  sourceHash: string; sourceRevision: number; createdAt: number; updatedAt: number; archived?: boolean;
}
export interface ProductionTimingReview {
  shots: Array<{ shotId: string; plannedSeconds: number; action: string; dialogue: string[]; purpose: string; timingAndCut: string; basisStatus: 'incomplete' | 'described' }>;
  issues: GenerationIssue[];
  creativeStatus: 'not_assessed';
  instruction: string;
}
export interface GenerationPlanRevision {
  productionBasis?: unknown;
  timingReview?: ProductionTimingReview;
  storyboardLayout?: GenerationStoryboardLayout;
  id: string; taskId: string; draftRevision: number; target: GenerationTarget; operation: GenerationOperation;
  sourceHash: string; sourceRevision: number; capability: GenerationCapability; prompt: string;
  references: GenerationReference[]; parameters: Record<string, string | number | boolean>;
  narrativeSeconds: number; requestedSeconds: number; expectedSeconds?: number; compiledFrames?: number;
  planHash: string; compiledRequestHash: string; createdAt: number; issues: GenerationIssue[];
}
export interface GenerationPolicy {
  projectId: string; revision: number; imagePaused: boolean; videoPaused: boolean; reason?: string;
  allowedCoreFamilies: string[]; allowExperimental: boolean; updatedAt: number;
}
export interface GenerationGrant {
  id: string; projectId: string; kind: 'fixed_plans' | 'bounded_scope'; planIds: string[]; sceneId?: string;
  operations: GenerationOperation[]; coreFamilies: string[]; maxAttempts: number; usedAttempts: number;
  allowUnknownCost: boolean; expiresAt: number; revoked?: boolean; createdAt: number;
  allowedRecipeHashes?: string[];
  targetKeys?: string[]; parameterRanges?: Record<string, { min?: number; max?: number; values?: Array<string | number | boolean> }>;
  targetConstraints?: Record<string, { fixedParameters: Record<string, string | number | boolean>; fixedReferenceVersionIds: string[] }>;
  fixedParameters?: Record<string, string | number | boolean>; fixedReferenceVersionIds?: string[];
}
export type GenerationExecutionStatus = 'queued' | 'held' | 'submitting' | 'running' | 'reconciling' | 'succeeded' | 'failed' | 'cancelled';
export interface DispatchReservationRelease {
  releasedAt: number;
  evidence: string;
  actor: 'creator' | 'external_agent';
}
export interface GenerationExecution {
  dispatchReservationRelease?: DispatchReservationRelease;
  origin?: 'provider' | 'external';
  id: string; taskId: string; planId: string; planHash: string; projectId: string; grantId: string; idempotencyKey: string;
  status: GenerationExecutionStatus; providerTaskId?: string; providerRecordId?: string; error?: string; holdCode?: string;
  results: GenerationResult[]; createdAt: number; updatedAt: number; dispatchStage?: 'preparing' | 'posting' | 'accepted';
}
export interface GenerationResult {
  observations?: ProductionObservation[];
  id: string; mediaUrl: string; mediaKind: GenerationMediaKind; contentHash: string; candidateId?: string;
  width?: number; height?: number; durationSeconds?: number; hasAudio?: boolean; technicalIssues: string[]; registrationError?: string;
  review: 'pending' | 'needs_changes' | 'adopted' | 'superseded' | 'source_changed';
  adoptedSourceHash?: string;
}
export interface GenerationLayout {
  revision: number; nodes: Record<string, { x: number; y: number; hidden?: boolean; groupId?: string }>;
  viewport?: { x: number; y: number; zoom: number }; groups?: Array<{ id: string; label: string; collapsed: boolean }>;
}
export interface GenerationWorkspace {
  collaboration?: unknown;
  productionWorkingAgreement?: string;
  id: string; target: GenerationTarget; tasks: GenerationTaskDraft[]; plans: GenerationPlanRevision[];
  capabilities: GenerationCapability[]; references: GenerationReference[]; executions: GenerationExecution[];
  scheduled?: Array<{ id: string; taskId: string; status: string; error?: string; executionId?: string }>;
  sources?: Record<string, { sourceHash: string; sourceRevision: number; references: GenerationReference[]; timingReview?: ProductionTimingReview }>;
  /** Includes strictly verified compatibility for drafts frozen before board hashes were combined. */
  taskSourceCurrent?: Record<string, boolean>;
  policy: GenerationPolicy; grants: GenerationGrant[]; layout: GenerationLayout; sourceHash: string; sourceRevision: number;
}
export const generationRoleLabels: Record<GenerationRole, string> = {
  character_identity: '人物身份与服装', environment: '空间与光线', prop_identity: '道具身份', style: '画风', composition: '构图',
  board_sequence: '宫格与镜头次序', first_frame: '视频首帧', last_frame: '视频尾帧', motion: '动作参考', voice_timbre: '音色参考', full_dialogue: '完整对白',
};
export const generationStatusLabels: Record<GenerationExecutionStatus, string> = {
  queued: '排队中', held: '等待处理', submitting: '正在提交', running: '生成中', reconciling: '正在核对提交结果', succeeded: '生成完成 · 待检查', failed: '生成失败', cancelled: '已取消',
};
export const generationTargetKey = (t: GenerationTarget) => [t.projectId, t.episodeId || '', t.sceneId || '', t.kind, t.scratchId || t.assetId || t.pageId || t.unitId || t.shotIds.join(','), t.kind === 'asset' ? t.referenceMode || 'clean_reference' : ''].join(':');
export const enabledReferences = (task: Pick<GenerationTaskDraft, 'references'>) => task.references.filter(r => r.enabled);
export function resolveGenerationParameters(task: GenerationTaskDraft, cap: GenerationCapability) {
  return Object.fromEntries(cap.parameters.map(p => [p.key, task.parameters[p.key]?.value ?? cap.defaults[p.key] ?? p.default]));
}
/** Provider padding belongs to the request, never to the editorial shot duration. */
export function initialGenerationDuration(narrativeSeconds: number, cap: GenerationCapability): number {
  const definition = cap.parameters.find(p => p.key === 'duration');
  const needed = Math.max(cap.minDuration, narrativeSeconds || Number(definition?.default) || cap.minDuration);
  if (cap.durations?.length) return [...cap.durations].sort((a, b) => a - b).find(n => n >= needed) ?? needed;
  return definition?.integer ? Math.ceil(needed) : needed;
}
export function validateGenerationDraft(task: GenerationTaskDraft, cap: GenerationCapability): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const add = (code: string, message: string, field?: string, bindingId?: string) => issues.push({ code, message, field, bindingId, blocking: true });
  if (!task.prompt.trim()) add('PROMPT_REQUIRED', '请整理本次生成内容。', 'prompt');
  if (!cap.allowedOperations.includes(task.operation)) add('MODE_OPERATION_MISMATCH', '此方案不支持当前制作目标，请选择兼容的生成方式。', 'capabilityId');
  if (task.target.kind === 'scene' && task.operation === 'video') add('SCENE_VIDEO_RANGE', '整场故事板不是单次视频任务，请选择对应镜头或视频片段。');
  if (task.target.kind === 'scene' && task.operation === 'joint_storyboard') {
    const layout = task.storyboardLayout;
    if (!layout || !Number.isInteger(layout.columns) || !Number.isInteger(layout.rows) || layout.columns < 1 || layout.columns > 12 || layout.rows < 1 || layout.rows > 12 || !Array.isArray(layout.shotIds) || layout.shotIds.length > layout.columns * layout.rows || layout.shotIds.some(id => !task.target.shotIds.includes(id)) || task.target.shotIds.some(id => !layout.shotIds.includes(id))) add('STORYBOARD_LAYOUT', '请明确故事板行列和逐格镜头归属，覆盖本次范围；一个镜头可有多个关键画格。', 'storyboardLayout');
  }
  const refs = enabledReferences(task);
  if (cap.referenceAdapter === 'h3_multimodal_v1' && !refs.length) add('REFERENCE_REQUIRED', '多素材参考至少选择一份图片、视频或音频；纯文字生成请使用文生视频方式。', 'references');
  for (const ref of refs) if (ref.usageNote !== undefined && (typeof ref.usageNote !== 'string' || ref.usageNote.length > 2000)) add('REFERENCE_NOTE_INVALID', '素材具体要求须为不超过 2000 字的文本。', 'references', ref.id);
  for (const kind of ['image', 'video', 'audio'] as const) {
    const selected = refs.filter(r => r.mediaKind === kind), limits = cap.inputs[kind];
    if (selected.length < limits.min || selected.length > limits.max) add('REFERENCE_COUNT', `此方式需要 ${limits.min === limits.max ? limits.min : `${limits.min}–${limits.max}`} 份${{ image: '图片', video: '视频', audio: '音频' }[kind]}参考，当前 ${selected.length} 份。`, 'references');
    for (const r of selected) {
      if (!limits.roles.includes(r.role)) add('REFERENCE_ROLE_UNSUPPORTED', `“${r.label}”的用途“${generationRoleLabels[r.role]}”不适用于此方式。`, 'references', r.id);
      if (r.dependency && !r.dependency.resultId) add('DEPENDENCY_WAITING', `“${r.label}”还在等待上游结果。`, 'references', r.id);
      else if (!r.mediaUrl) add('REFERENCE_MISSING', `“${r.label}”尚无可读取的素材。`, 'references', r.id);
      if (r.status === 'source_changed') add('REFERENCE_STALE', `“${r.label}”来源已变化，请核对版本。`, 'references', r.id);
      if (r.qualityIssue) add('REFERENCE_QUALITY', r.qualityIssue, 'references', r.id);
      if (r.previsSource) {
        if (r.previsSource.sceneId !== task.target.sceneId || r.sourceShotIds?.some(id => !task.target.shotIds.includes(id))) add('PREVIS_SCOPE', '白模参考包含本次范围之外的镜头，请导出对应范围。', 'references', r.id);
        if (r.previsSource.kind === 'grid' && r.role !== 'composition') add('PREVIS_ROLE', '白模宫格使用“构图”用途，不是已采用故事板或视频首帧。', 'references', r.id);
        if (r.previsSource.kind === 'video' && r.role !== 'motion') add('PREVIS_ROLE', '白模预演视频使用“动作参考”用途。', 'references', r.id);
      }
      if (r.role === 'board_sequence' && cap.mediaKind === 'video' && r.shotIds?.length && r.shotIds.some(id => !task.target.shotIds.includes(id))) add('REFERENCE_SCOPE', `“${r.label}”不属于当前镜头范围。`, 'references', r.id);
    }
  }
  if (cap.mode === 'board_guided_video' && !refs.some(r => r.role === 'board_sequence')) add('REFERENCE_ROLE_REQUIRED', '宫格指导方式需要本片段的宫格参考，人物图不能替代。', 'references');
  if (cap.mode === 'first_frame_video' && !refs.some(r => r.role === 'first_frame')) add('REFERENCE_ROLE_REQUIRED', '请选择本次视频的首帧，不能把宫格整图当首帧。', 'references');
  if (cap.mediaKind === 'video' && task.target.shotIds.length > 1 && !cap.multiShot) add('MULTISHOT_UNSUPPORTED', '此方式仅支持单镜头，请返回“镜头与时长”调整分段，或选择支持本片段的方式。', 'capabilityId');
  if (cap.mediaKind === 'video' && refs.some(r => r.role === 'board_sequence' && r.status !== 'adopted')) add('DEPENDENCY_NOT_ADOPTED', '正式视频需要已采用且来源一致的宫格；生成成功不代表已检查。', 'references');
  const params = resolveGenerationParameters(task, cap);
  const duration = Number(params.duration ?? task.narrativeSeconds);
  if (cap.mediaKind === 'video') {
    if (task.target.kind !== 'scratch' && (!Number.isFinite(task.narrativeSeconds) || task.narrativeSeconds <= 0)) add('NARRATIVE_DURATION_REQUIRED', '请先按本镜内容填写有效的叙事估时，不能用生成默认时长替代。', 'duration');
    if (!Number.isFinite(duration) || duration < cap.minDuration || duration > cap.maxDuration || (cap.durations && !cap.durations.includes(duration))) add('DURATION_UNSUPPORTED', `请求时长不符合此方式（${cap.durations?.join(' / ') || `${cap.minDuration}–${cap.maxDuration}`} 秒）。`, 'duration');
    if (duration + .001 < task.narrativeSeconds) add('DURATION_COVERAGE_GAP', `本片段需要 ${task.narrativeSeconds} 秒，请求 ${duration} 秒无法覆盖。请检查分段；若原估时有误，先在分镜中修订动作、时长与切出依据，不用改请求值偷偷截断内容。`, 'duration');
  }
  if (!cap.aspectRatios.includes(String(params.aspectRatio))) add('ASPECT_RATIO_UNSUPPORTED', '此方案不支持当前画幅。', 'aspectRatio');
  if (params.width && params.height && typeof params.aspectRatio === 'string') { const [w, h] = params.aspectRatio.split(':').map(Number); if (w && h && Math.abs(Number(params.width) / Number(params.height) - w / h) > .02) add('OUTPUT_ASPECT_MISMATCH', '输出宽高与画幅不一致，请调整宽高或画幅。', 'aspectRatio'); }
  for (const p of cap.parameters) {
    const v = params[p.key];
    if (typeof v !== p.type || (typeof v === 'number' && (!Number.isFinite(v) || (p.integer && !Number.isSafeInteger(v)) || (p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))) || (p.choices && !p.choices.includes(v as string | number))) add('PARAMETER_INVALID', `“${p.label}”不在此方案允许范围内。`, p.key);
    if (p.locked && task.parameters[p.key] && v !== p.default) add('CORE_PARAMETER_LOCKED', `“${p.label}”属于指定核心，修改需另存工作流版本。`, p.key);
  }
  if (params.steps !== undefined && params.firstSteps !== undefined && Number(params.firstSteps) >= Number(params.steps)) add('SAMPLING_STEPS', '一采步数必须小于总步数，二采至少保留一步。', 'firstSteps');
  const h3 = cap.coreFamily === 'yz_h3';
  if (cap.mediaKind === 'video' && h3) {
    const frames = 5 + 17 * Math.max(0, Math.ceil((Math.round(duration * 24) - 5) / 17));
    if (frames > 328 || frames / 24 > Math.min(cap.maxDuration, 14)) add('DURATION_FRAME_LIMIT', '当前 H3 的帧数对齐无法在 14 秒内覆盖此计划，请调整片段边界；不会自动截短剧情。', 'duration');
  }
  return issues;
}
export function assertNoGenerationCycle(tasks: GenerationTaskDraft[]) {
  const byId = new Map(tasks.map(t => [t.id, t])); const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new GenerationError('DEPENDENCY_CYCLE', '这些任务形成循环依赖，请移除其中一条引用。');
    if (done.has(id)) return; visiting.add(id);
    for (const r of byId.get(id)?.references || []) if (r.enabled && r.dependency && byId.has(r.dependency.taskId)) visit(r.dependency.taskId);
    visiting.delete(id); done.add(id);
  }; tasks.forEach(t => visit(t.id));
}
