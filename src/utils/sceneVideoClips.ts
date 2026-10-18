import type { Scene, Shot } from '../types/project';

/** Resolve an adopted multi-shot take into source ranges without copying its media. */
export const sceneVideoClips = (scene: Scene): Shot[] => {
  const ranges = new Map<string, { videoUrl: string; sourceStartSeconds: number }>();
  for (const workflow of scene.manualStoryboard?.boards || []) {
    if (workflow.unitSchema !== 'storyboard_unit.v1') continue;
    const take = workflow.takes?.find(item => item.id === workflow.activeTakeId && item.videoUrl);
    if (!take?.videoUrl) continue;
    let cursor = 0;
    for (const id of workflow.shotIds || workflow.board?.shotIds || [workflow.shotId]) {
      const shot = scene.shots?.find(item => item.id === id);
      if (!shot) continue;
      const recorded = take.generationAudit?.timeline?.find(beat => beat.shotId === id);
      ranges.set(id, { videoUrl: take.videoUrl, sourceStartSeconds: recorded?.startSeconds ?? cursor });
      cursor += workflow.board?.panels.filter(panel => panel.shotId === id).reduce((sum, panel) => sum + Number(panel.durationSeconds || 0), 0) || shot.duration;
    }
  }
  return (scene.shots || []).map(shot => shot.sourceStartSeconds !== undefined ? shot : { ...shot, ...ranges.get(shot.id) });
};
