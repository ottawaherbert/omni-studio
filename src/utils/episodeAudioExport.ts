import { sceneAudioTracks, sceneEditDuration } from './sceneVideoClips';
import type { Scene } from "../types/project";
import type { EpisodeFilmAudioInput } from "../../packages/domain/src/asset";

type AudioLibraryAsset = { id: string; url?: string; imageUrl?: string; imageUrls?: string[] };
export function resolveAudioLibraryUrl(id: string, projectAssets: AudioLibraryAsset[], globalAssets: AudioLibraryAsset[] = []) {
  const global = globalAssets.find(asset => asset.id === id);
  return global?.url || global?.imageUrls?.[0] || projectAssets.find(asset => asset.id === id)?.imageUrl;
}

/** Use the same audible ranges and linked media for listening checks and export. */
export function sceneAudioExportTracks(scene: Scene, resolveLinkedAsset: (id: string) => string | undefined = () => undefined) {
  const duration = sceneEditDuration(scene);
  return sceneAudioTracks(scene)
    .filter(track => !track.muted && track.volume !== 0 && track.startTime < duration)
    .map(track => ({ ...track, url: track.url || (track.linkedAssetId ? resolveLinkedAsset(track.linkedAssetId) : undefined) || '',
      duration: Math.min(track.duration, duration - track.startTime) }));
}

export const buildEpisodeAudioExportItems = (
  scenes: Scene[],
  resolveLinkedAsset: (id: string) => string | undefined = () => undefined,
): EpisodeFilmAudioInput[] => {
  let sceneStart = 0;
  const items: EpisodeFilmAudioInput[] = [];
  for (const scene of scenes) {
    const sceneDuration = sceneEditDuration(scene);
    for (const track of sceneAudioExportTracks(scene, resolveLinkedAsset)) {
      const url = track.url;
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
