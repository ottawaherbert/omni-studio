import { renderProductionCreativeContext } from "../../../packages/production/src/services/production/creativeDirection";
import { appearanceSourceHash } from "./productionAppearance";
import type { Episode, Scene, Shot, Project } from '../../types/project';
import { manualFilmTeamSceneSource } from './manualFilmTeam';

/** Read-only evidence carried directly into production, without a preparation report. */
export const buildProductionSceneContext = (episode: Episode, scene: Scene, history: Shot[] = [], project: Partial<Project> = {}) => {
  const scenes = episode.scenes || [];
  const index = scenes.findIndex(item => item.id === scene.id);
  const adjacent = index < 0 ? [] : scenes.slice(Math.max(0, index - 1), index + 2).filter(item => item.id !== scene.id);
  const snapshot = (item: Scene) => ({
    sceneId: item.id,
    title: item.title,
    source: manualFilmTeamSceneSource(item).text,
    existingBreakdown: item.breakdown || null,
    breakdownStatus: item.productionPreparation?.breakdown?.status || "unconfirmed",
  });
  const previous = index > 0 ? scenes[index - 1] : undefined;
  return {
    sourcePolicy: '以当前原文为事实依据；已有拆解可能尚未确认，冲突时以原文为准；相邻场次与已采用镜头用于承接。不得改写对白、人物身份、道具归属或伤势。原文未指定的机位、表演、灯光和声音可在本次分镜中设计；无来源支持的状态不得写成既定事实。历史方案仅作可选参考，缺少方案不构成问题。',
    currentScene: snapshot(scene),
    creativeDirection: renderProductionCreativeContext(project, { episode, scene }, "planning"),
    existingShotOverrides: (scene.shots || []).filter(shot => shot.creativeDirection).map(shot => ({ shotId: shot.id, visualAction: shot.visualAction })),
    directingAcrossScenes: scenes.map(item => ({ sceneId: item.id, title: item.title, targetDuration: item.targetDuration,
      ...(item.manualStoryboard?.directorPlan ? { adoptedIntent: item.manualStoryboard.directorPlan.intent, adoptedRhythm: item.manualStoryboard.directorPlan.rhythm } : {}),
    })),
    appearanceHistory: [...history, ...scenes.filter(item => item.id !== scene.id).flatMap(item => (item.shots || []).map(shot => ({ ...shot, currentSourceHash: appearanceSourceHash(item) })))].filter(shot => shot.appearance?.states.some(state => state.decision === 'accepted')).map(shot => ({ shotId: shot.id, appearance: shot.appearance, currentSourceHash: (shot as Shot & { currentSourceHash?: string }).currentSourceHash })),
    adjacentScenes: adjacent.map(snapshot),
    previousSceneEnding: (previous?.shots || []).slice(-2).map(shot => ({
      shotId: shot.id,
      appearance: shot.appearance,
      visualAction: shot.visualAction,
      blocking: shot.blocking,
      continuityNote: shot.continuityNote,
      characterIds: shot.characterIdsInShot || [],
      propIds: shot.propIds || [],
      locationId: shot.locationId,
      dialogueLines: shot.dialogueLines || [],
    })),
    historicalPlans: (episode.productionTeam?.outputs || []).filter(output => output.status === 'confirmed').map(output => ({
      department: output.department,
      taskSummary: output.taskSummary,
      unitPlan: output.content,
      scenePlan: output.scenePlans?.find(item => item.sceneId === scene.id),
      handoffNotes: output.handoffNotes,
    })),
  };
};
