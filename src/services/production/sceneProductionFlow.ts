import type { Scene } from '../../types/project';
import { emptySceneVisualPlan } from './sceneVisualPlan';
import { getActiveStoryboardBoardVisualTake, getLatestStoryboardBoardVisualCandidate, resolveStoryboardShotGridImage } from './storyboardCompositeBoard';

export type SceneProductionStage = 'design' | 'shots' | 'visuals';
export const sceneProductionStages = ['design', 'shots', 'visuals'] as const;

export function findSceneStoryboardShotCell(scene: Scene, shotId: string) {
  for (const workflow of scene.manualStoryboard?.boards || []) {
    for (const page of workflow.board?.visualPages || []) {
      const index = page.panelIds.findIndex(id => workflow.board?.panels.find(panel => panel.id === id)?.shotId === shotId);
      if (index < 0) continue;
      const take = getActiveStoryboardBoardVisualTake(page) || getLatestStoryboardBoardVisualCandidate(page);
      const imageUrl = workflow.board?.visualReferenceMode === 'shot_grid' && page.activeShotGridTakeId
        ? resolveStoryboardShotGridImage(page) : take?.sourceImageUrl || take?.imageUrl;
      const [columns, rows] = page.layout.split('x').map(Number);
      if (imageUrl && Number.isInteger(columns) && columns > 0 && Number.isInteger(rows) && rows > 0 && index < columns * rows) return { imageUrl, index, columns, rows };
    }
  }
  return undefined;
}

export function draftSceneFactsFromShots(scene: Scene, plan = scene.visualPlan || emptySceneVisualPlan()) {
  const first = scene.shots?.[0], last = scene.shots?.at(-1);
  const entry = first?.continuityNote?.match(/入镜[：:]\s*([\s\S]*?)(?=出镜[：:]|$)/)?.[1].trim() || '';
  const exit = last?.continuityNote?.match(/出镜[：:]\s*([\s\S]*)/)?.[1].trim() || '';
  return { ...plan, geography: plan.geography || first?.blocking || '', lighting: plan.lighting || first?.lighting || first?.lightingAtmo || '', entryState: plan.entryState || entry, exitState: plan.exitState || exit, review: undefined };
}

export function resolveSceneProductionStage(scene: Scene, requested?: string | null, remembered?: string | null, legacyMode?: string | null): SceneProductionStage {
  const valid = (value?: string | null): value is SceneProductionStage => sceneProductionStages.includes(value as SceneProductionStage);
  if (valid(requested)) return requested;
  if (valid(remembered)) return remembered;
  if (legacyMode === 'storyboard') return 'visuals';
  if (legacyMode === 'shot') return 'shots';
  if (scene.manualStoryboard?.boards?.some(unit => unit.board?.visualPages?.some(page => page.visualTakes?.length || page.shotGridTakes?.length))) return 'visuals';
  return scene.shots?.length ? 'shots' : 'design';
}

/** Saved structure and successful jobs are not evidence of visual acceptance. */
export function sceneProductionVisualSummary(scene: Scene) {
  const pages = (scene.manualStoryboard?.boards || []).flatMap(unit => unit.board?.visualPages || []);
  const adopted = pages.filter(page => page.visualTakes?.some(take => take.id === page.activeVisualTakeId && take.status === 'adopted' && take.review?.status === 'approved') || page.shotGridTakes?.some(take => take.id === page.activeShotGridTakeId)).length;
  const pending = pages.filter(page => {
    const current = page.visualTakes?.find(take => take.id === page.activeVisualTakeId && take.status === 'adopted' && take.review?.status === 'approved');
    return page.visualTakes?.some((take, index) => take.status === 'candidate' && (!current || (
      current.adoptedAt && take.createdAt ? take.createdAt > current.adoptedAt : index > page.visualTakes!.indexOf(current)
    )));
  }).length;
  return { total: pages.length, adopted, pending };
}
