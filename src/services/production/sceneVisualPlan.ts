import type { Scene, SceneContinuityBasis, SceneVisualPlan, Shot } from '../../types/project';
import { manualStoryboardHash } from './manualStoryboard';

export const emptySceneVisualPlan = (): SceneVisualPlan => ({
  schemaVersion: 'scene-visual-plan.v1', geography: '', lighting: '', entryState: '', exitState: '',
  transition: { kind: 'unspecified', carryOver: '', changes: '', cue: '' }, references: [], updatedAt: 0,
});
/** Resolve both event-to-shot and shot-to-event links before compiling a unit. */
export function sceneVisualPlanForShots(scene: Scene, shotIds: string[]) {
  if (!scene.visualPlan) return undefined;
  const events=scene.visualPlan.eventStates?.filter(event => {
    const linkedShots=event.shotIds?.length ? event.shotIds
      : (scene.shots || []).filter(shot=>shot.eventIds?.includes(event.id)).map(shot=>shot.id);
    return !linkedShots.length || linkedShots.some(id=>shotIds.includes(id));
  });
  return {...scene.visualPlan, ...(events ? {eventStates:events} : {})};
}
export function sceneContinuityBasis(plan?: SceneContinuityBasis, shotIds?: string[]): SceneContinuityBasis | undefined {
  if(!plan)return undefined;
  const events=plan.eventStates?.filter(e=>!shotIds || !e.shotIds?.length || e.shotIds.some(id=>shotIds.includes(id)));
  if(!(plan.geography || plan.lighting || plan.entryState || plan.exitState || plan.references.length || events?.length || plan.transition.kind!=='unspecified' || plan.transition.sourceSceneId || plan.transition.carryOver || plan.transition.changes || plan.transition.cue))return undefined;
  return {geography:plan.geography,lighting:plan.lighting,entryState:plan.entryState,exitState:plan.exitState,transition:plan.transition,references:plan.references,...(events?.length?{eventStates:events}:{})};
}

export const renderSceneContinuityBasis = (plan?: SceneContinuityBasis, shotIds?: string[]) => !plan || !sceneContinuityBasis(plan) ? '' : [
  '【整场视觉基准与跨场交接】',
  plan.geography && `固定空间：${plan.geography}`,
  plan.lighting && `本场光线：${plan.lighting}`,
  plan.entryState && `整场起始状态（仅本场开头）：${plan.entryState}`,
  plan.exitState && `整场最终状态（只在相应剧情发生后成立，禁止提前画入）：${plan.exitState}`,
  `跨场关系：${({ unspecified: '未指定，不猜测', continuous: '连续事件', time_jump: '时间跳跃', parallel: '平行事件', flashback: '闪回', independent: '独立场次' })[plan.transition.kind]}`,
  plan.transition.carryOver && `允许继承：${plan.transition.carryOver}`,
  plan.transition.changes && `本场改变：${plan.transition.changes}`,
  plan.transition.cue && `转场线索：${plan.transition.cue}`,
  ...(shotIds ? sceneReferencesForShots(plan, shotIds) : plan.references).map((ref, i) => `场次参考 ${i + 1}（${ref.role === 'space' ? '空间基准' : `镜头 ${ref.beforeShotId || '待指定'} 前衔接状态`}）：${ref.note || '仅按本组剧情使用'}；不复制参考中不属于本组的人物、旧背景或后续事件。`),
  ...(plan.eventStates || []).filter(event => !shotIds || !event.shotIds?.length || event.shotIds.some(id=>shotIds.includes(id))).map(event=>`事件「${event.event}」[${event.entityId}]：${event.before} → ${event.after}；仅在对应事件发生后变化。`),
  '每组仍引用原始身份资产；不能仅沿上一组图像逐次重绘。普通切镜承接状态，不强求首尾构图相同。整场终态与跨场信息只供判断，当前组仅执行本组动作。',
].filter(Boolean).join('\n');

export interface SceneVideoGroup { shotIds: string[]; duration: number; start: number; issues: string[] }
export function planSceneVideoGroups(shots: Shot[], breaks: string[] | undefined, min: number, max: number): SceneVideoGroup[] {
  const cut = new Set(breaks || []);
  const groups: SceneVideoGroup[] = [];
  let cursor = 0;
  for (const [index, shot] of shots.entries()) {
    const duration = Number(shot.duration);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const previous = groups.at(-1);
    // Unspecified boundaries are a suggestion, never a rewrite of the Shot duration.
    const startsGroup = !previous || (breaks !== undefined ? cut.has(shots[index - 1]?.id) : previous.duration + safeDuration > max);
    const group = startsGroup ? { shotIds: [], duration: 0, start: cursor, issues: [] } : previous;
    if (startsGroup) groups.push(group);
    group.shotIds.push(shot.id);
    group.duration += safeDuration;
    cursor += safeDuration;
    if (!safeDuration) group.issues.push(`镜头 ${index + 1} 缺少有效时长`);
  }
  // Rebalance a short tail only when suggesting, preserving chronological order.
  if (breaks === undefined) {
    for (let i = groups.length - 1; i > 0; i--) {
      const group = groups[i], previous = groups[i - 1];
      while (group.duration < min && previous.shotIds.length > 1) {
        const id = previous.shotIds.at(-1)!;
        const duration = Number(shots.find(s => s.id === id)?.duration || 0);
        if (!(duration > 0) || previous.duration - duration < min || group.duration + duration > max) break;
        previous.shotIds.pop(); previous.duration -= duration;
        group.shotIds.unshift(id); group.duration += duration; group.start -= duration;
      }
    }
  }
  for (const group of groups) {
    if (group.duration > max) group.issues.push(`超过单次 ${max} 秒上限，请在合理切点拆组；单镜超限需先拆镜`);
    // A short editorial unit may request provider padding and be trimmed in the edit.
  }
  return groups;
}

export const groupBreaks = (groups: SceneVideoGroup[]) => groups.slice(0, -1).map(g => g.shotIds.at(-1)!);
export const sceneVisualReviewHash = (scene: Scene, sourceScene?: Scene) => manualStoryboardHash({
  basis: sceneContinuityBasis(scene.visualPlan), overview: scene.visualPlan?.overview,
  cuts: scene.visualPlan?.breakAfterShotIds, targetModel: scene.visualPlan?.targetVideoModelConfigId,
  shots: (scene.shots || []).map(s => ({ id: s.id, duration: s.duration, imageUrl: s.imageUrl, videoUrl: s.videoUrl, action: s.visualAction, continuity: s.continuityNote, editing: s.editingNote, dialogue: s.dialogueLines })),
  boards: scene.manualStoryboard?.boards?.map(b => ({ id: b.id, shots: b.shotIds, start: b.board?.startState, end: b.board?.endState, pages: b.board?.visualPages?.map(p => ({ id: p.id, active: p.activeVisualTakeId, takes: p.visualTakes?.map(t => ({ id: t.id, imageUrl: t.imageUrl, status: t.status })) })) })),
  source: sourceScene && { id: sourceScene.id, exitState: sourceScene.visualPlan?.exitState, shot: sourceScene.shots?.at(-1) },
});

export const sceneStoryboardContentHash = (scene: Scene) => manualStoryboardHash({
  basis: sceneContinuityBasis(scene.visualPlan),
  shots: (scene.shots || []).map(({ takes, activeTakeId, imageUrl, imageMedia, videoUrl, videoMedia, draftPreview, ...shot }) => shot),
});

export function validateSceneOverview(overview: NonNullable<SceneVisualPlan['overview']>, shots: Shot[]) {
  if (!Number.isInteger(overview.columns) || !Number.isInteger(overview.rows) || overview.columns < 1 || overview.rows < 1 || overview.columns > 12 || overview.rows > 12) throw new Error('宫格行列须为 1–12 的整数');
  if (!overview.shotIds.length || overview.shotIds.length > overview.columns * overview.rows) throw new Error('有效画格数不能超过布局容量，空格只能留在末尾');
  if (overview.shotIds.some(id => !shots.some(s => s.id === id))) throw new Error('总览图包含已不存在的镜头，请重新映射');
  if (!(overview.width > 0 && overview.height > 0)) throw new Error('无法识别图片尺寸');
}

export function resolveSceneOverviewPanelIndices(overview: NonNullable<SceneVisualPlan['overview']>, panels: Array<{ id: string; shotId: string }>, choices: Record<string, number>) {
  return panels.map(panel => {
    const available = overview.shotIds.flatMap((id, i) => id === panel.shotId ? [i] : []);
    if (!available.length) throw new Error('总览图没有覆盖此片段的画格');
    const chosen = choices[panel.id] ?? (available.length === 1 ? available[0] : undefined);
    if (chosen === undefined || !available.includes(chosen)) throw new Error('同一镜头有多个关键画格，请在画格来源中明确选择；不会自动丢弃或猜测');
    return chosen;
  });
}

export function overviewCell(overview: NonNullable<SceneVisualPlan['overview']>, shotId: string) {
  const index = overview.shotIds.indexOf(shotId);
  if (index < 0) return undefined;
  const x = Math.round((index % overview.columns) * overview.width / overview.columns);
  const y = Math.round(Math.floor(index / overview.columns) * overview.height / overview.rows);
  const right = Math.round(((index % overview.columns) + 1) * overview.width / overview.columns);
  const bottom = Math.round((Math.floor(index / overview.columns) + 1) * overview.height / overview.rows);
  return { x, y, width: right - x, height: bottom - y };
}

export const sceneReferencesForShots = (plan: SceneContinuityBasis | undefined, shotIds: string[]) =>
  (plan?.references || []).filter(ref => ref.role === 'space' || Boolean(ref.beforeShotId && shotIds.includes(ref.beforeShotId)));
