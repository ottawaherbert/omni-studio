import type { ManualStoryboardBoardWorkflow, Scene, Shot } from '../../types/project';
import { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } from './manualVideoStoryboard';
import { buildStoryboardCompositeVisualPages } from './storyboardCompositeBoard';
import { buildStoryboardUnitVideoPromptRecord } from './storyboardUnitVideoPrompt';
import { sceneContinuityBasis, sceneVisualPlanForShots } from './sceneVisualPlan';
import { manualStoryboardHash } from './manualStoryboard';

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请提供制作单元方案。');
  return value as Record<string, any>;
};
const fields = (value: unknown, allowed: string[]) => {
  const body = object(value);
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('此入口只保存单元方案；媒体及采用请使用生成工作台。');
  return body;
};
const panelFields = ['id','shotId','durationSeconds','framePurpose','shotType','visualBeat','cameraNote','framing','lens','angle','cameraMove','subjectAction','blocking','lightingCue','soundCue','emotionCue','compositionNote','continuityIn','continuityOut','assetRefs','annotationLegendIds','actionArrowLegendIds','dialogueOrSoundCue','renderInstruction'];
const union = (values: string[]) => [...new Set(values)];

/** Save one authored unit on the latest scene; candidate/adoption data stays server-owned. */
export function saveStoryboardUnitPlan(scene: Scene, episodeId: string, unitId: string, value: unknown, now = Date.now()) {
  if (!unitId.trim()) throw new Error('制作单元ID不能为空。');
  const patch = fields(value, ['shotIds','strategyDecision','performanceBeat','board']);
  const workspace = scene.manualStoryboard;
  const previous = workspace?.boards?.find(unit => unit.id === unitId);
  const shotIds: string[] = patch.shotIds ?? previous?.shotIds ?? previous?.board?.shotIds ?? [];
  if (!Array.isArray(shotIds) || !shotIds.length || shotIds.some(id => typeof id !== 'string') || union(shotIds).length !== shotIds.length) throw new Error('请选择本单元的有序镜头，不能重复。');
  const shots = shotIds.map(id => scene.shots?.find(shot => shot.id === id));
  if (shots.some(shot => !shot)) throw new Error('制作单元只能引用本场现有镜头。');
  const selected = shots as Shot[];
  const duration = selected.reduce((total, shot) => total + shot.duration, 0);
  const boardPatch = patch.board === undefined ? {} : fields(patch.board, ['layout','panels','startState','endState','visualReferenceMode']);
  const rawPanels = boardPatch.panels ?? previous?.board?.panels;
  if (!Array.isArray(rawPanels) || !rawPanels.length) throw new Error('请提供本单元的有序画格。');
  const panels = rawPanels.map((raw, index) => {
    // Existing media is retained below, never accepted from a request.
    const source = boardPatch.panels === undefined ? raw : fields(raw, panelFields);
    const shotId = source.shotId ?? (shotIds.length === 1 ? shotIds[0] : undefined);
    if (!shotIds.includes(shotId)) throw new Error('每格须明确属于本单元哪个镜头。');
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) throw new Error('每格须填写依据动作或对白估算的正数秒数。');
    if (!source.framePurpose?.trim() || !(source.visualBeat || source.subjectAction)?.trim()) throw new Error('每格须说明画面作用与实际动作。');
    return { ...source, shotId, id: source.id || previous?.board?.panels[index]?.id || `${unitId}.panel.${index + 1}` };
  });
  if (new Set(panels.map(panel => panel.id)).size !== panels.length) throw new Error('画格ID不能重复。');
  for (const shot of selected) {
    const seconds = panels.filter(panel => panel.shotId === shot.id).reduce((total, panel) => total + panel.durationSeconds, 0);
    if (Math.abs(seconds - shot.duration) > 0.05) throw new Error(`画格时长须覆盖镜头 ${shot.id} 的 ${shot.duration} 秒；请修订实际估时，不自动均分或缩短剧情。`);
  }
  const decision = normalizeManualStoryboardStrategy({
    selectedStrategyId: 'storyboard.action_continuity.v1',
    selectedModelProfileId: 'video.storyboard_reference.configurable.short_unit.v1',
    ...previous?.strategyDecision, ...patch.strategyDecision,
    expectedVideoUnitDurationSeconds: duration,
  });
  const combinedShot: Shot = { ...selected[0], duration,
    characterIdsInShot: union(selected.flatMap(shot => shot.characterIdsInShot || [])),
    propIds: union(selected.flatMap(shot => shot.propIds || [])),
    vehicleIds: union(selected.flatMap(shot => shot.vehicleIds || [])),
  };
  const beat = { ...previous?.performanceBeat, ...patch.performanceBeat };
  const normalized = normalizeManualStoryboardBoard({ episodeId, sceneId: scene.id, shot: combinedShot, decision,
    value: { performanceBeat: beat, board: { ...previous?.board, ...boardPatch, panels } } });
  const boardId = previous?.board?.id || previous?.boardId || `${unitId}.board`;
  const videoGenerationUnitId = previous?.videoGenerationUnitId || previous?.board?.videoGenerationUnitId || unitId;
  const board = normalized.board!;
  const mode = boardPatch.visualReferenceMode ?? previous?.board?.visualReferenceMode ?? 'director_board';
  if (!['director_board','shot_grid'].includes(mode)) throw new Error('请选择联合宫格或镜头拼格用途。');
  Object.assign(board, { id: boardId, shotIds, videoGenerationUnitId, visualReferenceMode: mode,
    continuityBasis: sceneContinuityBasis(sceneVisualPlanForShots(scene, shotIds), shotIds) });
  normalized.performanceBeat!.id = previous?.performanceBeat?.id || `${unitId}.beat`;
  board.performanceBeatIds = [normalized.performanceBeat!.id];
  board.panels = board.panels.map((panel, index) => {
    const authored = panels[index];
    const old = previous?.board?.panels.find(item => item.id === authored.id);
    const shot = selected.find(item => item.id === authored.shotId)!;
    const shotAssets = union([...(shot.characterIdsInShot || []), ...(shot.propIds || []), ...(shot.vehicleIds || []), ...(shot.locationId ? [shot.locationId] : [])]);
    return { ...panel, id: authored.id, shotId: authored.shotId, durationSeconds: authored.durationSeconds,
      assetRefs: Array.isArray(authored.assetRefs) ? authored.assetRefs.filter((id: string) => shotAssets.includes(id)) : shotAssets,
      ...(old ? { visualTakes: old.visualTakes, activeVisualTakeId: old.activeVisualTakeId } : {}) };
  });
  board.visualPages = buildStoryboardCompositeVisualPages(board).map(page => {
    const old = previous?.board?.visualPages?.find(item => item.id === page.id);
    return { ...old, ...page };
  });
  const next: ManualStoryboardBoardWorkflow = { ...previous, ...normalized, id: unitId, unitSchema: 'storyboard_unit.v1',
    boardId, videoGenerationUnitId, shotId: shotIds[0], shotIds, strategyDecision: decision, updatedAt: now };
  next.performanceBeats = [normalized.performanceBeat!];
  next.unitVideoPrompt = buildStoryboardUnitVideoPromptRecord({workflow:next,shots:scene.shots || [],previous:previous?.unitVideoPrompt,now});
  const comparable = (unit: ManualStoryboardBoardWorkflow) => ({ ...unit,updatedAt:0,
    unitVideoPrompt:unit.unitVideoPrompt ? {...unit.unitVideoPrompt,updatedAt:0} : undefined });
  if (previous && manualStoryboardHash(comparable(previous)) === manualStoryboardHash(comparable(next))) return previous;
  const boards = workspace?.boards || [];
  scene.manualStoryboard = { ...workspace, schemaVersion: 'manual-storyboard.v1',
    // Old layouts and their candidates remain available even if panels are removed.
    unitHistory: previous ? [...(workspace?.unitHistory || []), {at:now,boards:[structuredClone(previous)]}] : workspace?.unitHistory,
    boards: previous ? boards.map(unit => unit.id === unitId ? next : unit) : [...boards,next], updatedAt:now };
  return next;
}
