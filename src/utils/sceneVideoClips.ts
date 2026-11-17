import type { EditorialClip, SceneEdit } from '../../packages/domain/src/productionCollaboration';
import type { Scene, Shot, AudioTrack, ManualStoryboardBoardWorkflow } from '../types/project';

/** Resolve an adopted multi-shot take into source ranges without copying its media. */
export type TimelineShot = Shot & { sourceShotId?: string; sourceTakeId?: string };
export function storyboardTakeSourceStart(scene: Scene, workflow: ManualStoryboardBoardWorkflow, take: NonNullable<ManualStoryboardBoardWorkflow['takes']>[number], shotId: string) {
  const recorded=take.generationAudit?.timeline?.find(beat=>beat.shotId===shotId);
  if(recorded)return recorded.startSeconds;
  let cursor=0;
  for(const id of workflow.shotIds || workflow.board?.shotIds || [workflow.shotId]) {
    if(id===shotId)return cursor;
    cursor+=workflow.board?.panels.filter(panel=>panel.shotId===id).reduce((sum,panel)=>sum+Number(panel.durationSeconds||0),0)
      || scene.shots?.find(shot=>shot.id===id)?.duration || 0;
  }
  return 0;
}
export const legacySceneVideoClips = (scene: Scene): TimelineShot[] => {
  const ranges = new Map<string, { videoUrl: string; sourceStartSeconds: number; sourceTakeId: string }>();
  for (const workflow of scene.manualStoryboard?.boards || []) {
    if (workflow.unitSchema !== 'storyboard_unit.v1') continue;
    const take = workflow.takes?.find(item => item.id === workflow.activeTakeId && item.videoUrl);
    if (!take?.videoUrl) continue;
    for (const id of workflow.shotIds || workflow.board?.shotIds || [workflow.shotId]) {
      const shot = scene.shots?.find(item => item.id === id);
      if (!shot) continue;
      ranges.set(id, { videoUrl: take.videoUrl, sourceTakeId: take.id, sourceStartSeconds: storyboardTakeSourceStart(scene,workflow,take,id) });
    }
  }
  return (scene.shots || []).map(shot => shot.sourceStartSeconds !== undefined ? shot : { ...shot, ...ranges.get(shot.id) });
};


/** One resolver feeds preview, timeline, audio timing and export. Clips pin media. */
export function sceneVideoClips(scene: Scene): TimelineShot[] {
  if (!scene.edit) return legacySceneVideoClips(scene).map(shot=>({...shot,sourceShotId:shot.id}));
  const sourceShots=new Map([...(scene.shotHistory||[]).flatMap(history=>history.shots),...(scene.shots||[])].map(shot=>[shot.id,shot]));
  return scene.edit.clips.map(clip => ({
    ...sourceShots.get(clip.shotId),
    id:clip.id, sourceShotId:clip.shotId, sourceTakeId:clip.takeId,
    videoUrl:clip.videoUrl, imageUrl:clip.imageUrl,
    duration:clip.durationSeconds, sourceStartSeconds:clip.sourceInSeconds,
    transition:clip.transition || 'none',
  } as TimelineShot));
}
export function editFromTimelineShots(shots: TimelineShot[]): SceneEdit {
  let start=0;
  return { clips:shots.map(shot=>{
    const clip: EditorialClip={id:shot.id,shotId:shot.sourceShotId || shot.id,videoUrl:shot.videoUrl,imageUrl:shot.imageUrl,takeId:shot.sourceTakeId || shot.activeTakeId,sourceInSeconds:shot.sourceStartSeconds || 0,durationSeconds:shot.duration,timelineStartSeconds:start,transition:shot.transition};
    start+=clip.durationSeconds;
    return clip;
  }) };
}
export const sceneEditDuration = (scene: Scene) => sceneVideoClips(scene).reduce((sum,shot)=>sum+Number(shot.duration || 0),0);
/** The authored start may precede the scene for a J-cut. */
export function audioTrackTimelineStart(scene: Scene, track: AudioTrack) {
  const clip=track.clipAnchor && scene.edit?.clips.find(c=>c.id===track.clipAnchor!.clipId);
  return clip ? clip.timelineStartSeconds+track.clipAnchor!.offsetSeconds : track.startTime;
}
export function sceneAudioTracks(scene: Scene): AudioTrack[] {
  const clips=scene.edit?.clips;
  return (scene.audioTracks || []).map(track=>{
    if(!track.clipAnchor || !clips) return track;
    const clip=clips.find(c=>c.id===track.clipAnchor!.clipId);
    if (!clip) return {...track, muted:true};
    const start = audioTrackTimelineStart(scene,track);
    const cropped = Math.max(0, -start);
    return {...track, startTime:Math.max(0,start), ...(cropped ? {
      sourceStartSeconds:(track.sourceStartSeconds || 0)+cropped,
      duration:Math.max(0,track.duration-cropped), muted:track.muted || cropped>=track.duration,
    } : {})};
  });
}
/** Preserve relative audio offsets, including J/L cuts; free tracks stay fixed. */
export function audioForEdit(scene: Scene, edit: SceneEdit): AudioTrack[] {
  const old = editFromTimelineShots(sceneVideoClips(scene)).clips;
  const oldIds = new Set(old.map(clip => clip.id));
  return (scene.audioTracks || []).map(track => {
    const previous = track.clipAnchor
      ? old.find(clip => clip.id === track.clipAnchor!.clipId)
      : old.find(clip => clip.shotId === track.shotId);
    if (!previous) return track;
    const offset = track.clipAnchor?.offsetSeconds ?? track.startTime - previous.timelineStartSeconds;
    const sourceTime = previous.sourceInSeconds + offset;
    // A newly split tail owns dialogue that starts in that source range. Ordinary
    // J/L cuts retain their authored offset; duplicating video does not clone sound.
    const splitTail = edit.clips.find(clip => !oldIds.has(clip.id)
      && clip.shotId === previous.shotId && clip.videoUrl === previous.videoUrl
      && clip.sourceInSeconds > previous.sourceInSeconds
      && clip.sourceInSeconds + clip.durationSeconds <= previous.sourceInSeconds + previous.durationSeconds
      && sourceTime >= clip.sourceInSeconds && sourceTime < clip.sourceInSeconds + clip.durationSeconds);
    const next = splitTail || edit.clips.find(clip => clip.id === previous.id);
    const nextOffset = next && next.videoUrl === previous.videoUrl
      ? offset + previous.sourceInSeconds - next.sourceInSeconds : offset;
    return {...track, clipAnchor:{clipId:next?.id || previous.id, offsetSeconds:nextOffset},
      ...(next ? {startTime:Math.max(0,next.timelineStartSeconds+nextOffset)} : {})};
  });
}
export function readSceneEdit(scene: Scene, raw: unknown): SceneEdit {
  const clips=(raw as SceneEdit)?.clips;
  const sources=new Set([...(scene.shots||[]).map(s=>s.id),...(scene.shotHistory||[]).flatMap(h=>h.shots.map(s=>s.id)),...(scene.edit?.clips||[]).map(c=>c.shotId)]);
  if(!Array.isArray(clips) || clips.length>10000 || new Set(clips.map(c=>c?.id)).size!==clips.length || clips.some(c=>!c || typeof c.id!=='string' || !sources.has(c.shotId) || !Number.isFinite(c.sourceInSeconds) || c.sourceInSeconds<0 || !Number.isFinite(c.durationSeconds) || c.durationSeconds<=0 || [c.videoUrl,c.imageUrl,c.takeId].some(v=>v!==undefined&&typeof v!=='string') || ![undefined,'none','fade','black'].includes(c.transition))) throw Object.assign(new Error('剪辑片段引用或时间无效。'),{statusCode:400});
  // The first editor is a contiguous cut timeline. Positions follow array order.
  let start=0;
  return {clips:clips.map(c=>{const clip={...c,timelineStartSeconds:start};start+=c.durationSeconds;return clip;})};
}
