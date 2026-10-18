import type { Scene } from "../types/project";
import type { EpisodeFilmAudioInput } from "../../packages/domain/src/asset";

export const buildEpisodeAudioExportItems = (
  scenes: Scene[],
  resolveLinkedAsset: (id: string) => string | undefined = () => undefined,
): EpisodeFilmAudioInput[] => {
  let sceneStart = 0;
  const items: EpisodeFilmAudioInput[] = [];
  for (const scene of scenes) {
    const sceneDuration = (scene.shots || []).reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
    for (const track of scene.audioTracks || []) {
      if (track.muted || track.volume === 0) continue;
      const url = track.url || (track.linkedAssetId ? resolveLinkedAsset(track.linkedAssetId) : undefined);
      if (!url) {
        if (track.linkedAssetId) throw new Error(`场景「${scene.title}」的关联声音素材不可用，请重新选择或静音该音轨。`);
        continue;
      }
      const volume = track.volume ?? 1;
      if (![track.startTime, track.duration, volume, track.sourceStartSeconds ?? 0].every(Number.isFinite)
        || (track.sourceStartSeconds ?? 0) < 0 || track.startTime < 0 || track.duration <= 0 || volume < 0 || volume > 1) {
        throw new Error(`场景「${scene.title}」的音轨时间或音量无效。`);
      }
      const duration = Math.min(track.duration, sceneDuration - track.startTime);
      if (duration > 0) items.push({ url, startTime: sceneStart + track.startTime, duration, volume, ...(track.sourceStartSeconds ? { sourceStartSeconds: track.sourceStartSeconds } : {}) });
    }
    sceneStart += sceneDuration;
  }
  return items;
};
