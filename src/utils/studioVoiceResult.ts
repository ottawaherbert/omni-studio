import type { VoiceSettings } from '../../packages/domain/src/speech';
import type { AudioTrack, ManualStudioVoiceAudit, Shot } from '../types/project';

export const characterSpeechDirection = (habit?: string, direction?: string) => !habit?.trim() ? direction || '' : [
  habit?.trim() ? `【角色日常说话习惯】\n${habit.trim()}\n这是一般习惯，本句明确的情绪、语速与表演要求优先。只改变读法，不新增口头禅、语气词或改写台词。` : '',
  direction?.trim() ? `【本次配音要求】\n${direction.trim()}` : '',
].filter(Boolean).join('\n\n');

export const resolveTrackVoiceDirection = (defaults?: Partial<VoiceSettings>, track?: AudioTrack) => ({
  language: track?.voiceDirection?.language ?? defaults?.language ?? 'Auto',
  instructions: track?.voiceDirection?.instructions ?? defaults?.instructions ?? '',
  speed: track?.voiceDirection?.speed ?? defaults?.speed,
});

export const voiceDirectionOverrides = (direction: Partial<VoiceSettings>, defaults?: Partial<VoiceSettings>): AudioTrack['voiceDirection'] => ({
  ...(direction.language !== (defaults?.language ?? 'Auto') ? { language: direction.language } : {}),
  ...(direction.instructions !== (defaults?.instructions ?? '') ? { instructions: direction.instructions } : {}),
  ...(direction.speed !== defaults?.speed && !(direction.speed === 1 && defaults?.speed === undefined) ? { speed: direction.speed } : {}),
});

/** Replace one recording, preserving authored offsets and earlier recordings. */
export function applyStudioVoiceResult(input: {
  shots: Shot[];
  tracks: AudioTrack[];
  trackId: string;
  url: string;
  text: string;
  duration: number;
  audioMedia: AudioTrack['audioMedia'];
  audit: ManualStudioVoiceAudit;
  voiceDirection: AudioTrack['voiceDirection'];
  governed: boolean;
}) {
  const track = input.tracks.find(item => item.id === input.trackId);
  if (!track) throw new Error('当前配音轨已不存在。');
  const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : track.duration;
  const starts = (shots: Shot[]) => {
    let start = 0;
    return new Map(shots.map(shot => {
      const entry: [string, number] = [shot.id, start];
      start += shot.duration || 0;
      return entry;
    }));
  };
  const oldStarts = starts(input.shots);
  const shotStart = track.shotId ? oldStarts.get(track.shotId) : undefined;
  const requiredShotDuration = shotStart === undefined ? 0 : track.startTime - shotStart + duration;
  const shots = input.governed ? input.shots : input.shots.map(shot => shot.id === track.shotId
    ? { ...shot, duration: Math.max(shot.duration || 0, Math.ceil(requiredShotDuration)) }
    : shot);
  const newStarts = starts(shots);
  const tracks = input.tracks.map(item => {
    const previousStart = item.shotId ? oldStarts.get(item.shotId) : undefined;
    const nextStart = item.shotId ? newStarts.get(item.shotId) : undefined;
    // Preserve per-shot offsets, intentional pauses, and all unlinked tracks.
    const startTime = previousStart !== undefined && nextStart !== undefined
      ? item.startTime + nextStart - previousStart : item.startTime;
    if (item.id !== track.id) return startTime === item.startTime ? item : { ...item, startTime };
    const history = item.url && item.url !== input.url ? [...(item.voiceHistory || []), {
      url: item.url, text: item.text, duration: item.duration, audioMedia: item.audioMedia,
      sourceStartSeconds: item.sourceStartSeconds, characterId: item.characterId, shotId: item.shotId,
      generationAudit: item.generationAudit, voiceDirection: item.voiceDirection, archivedAt: input.audit.createdAt,
    }] : item.voiceHistory;
    return {
      ...item, startTime, url: input.url, text: input.text, duration,
      sourceStartSeconds: undefined, linkedAssetId: undefined,
      audioMedia: input.audioMedia, generationAudit: input.audit,
      voiceDirection: input.voiceDirection, voiceHistory: history,
    };
  });
  const linkedShot = shots.find(shot => shot.id === track.shotId);
  const exceedsShot = Boolean(linkedShot && requiredShotDuration > (linkedShot.duration || 0) + 0.01);
  const overlapsNextLine = input.tracks.some(item => item.id !== track.id && item.type === 'dialogue'
    && item.shotId === track.shotId && item.startTime > track.startTime
    && item.startTime < track.startTime + duration - 0.01);
  // Governed voice generation only owns recordings. Sending the unchanged shot
  // snapshot can overwrite prompts adopted in another open workspace.
  const sceneUpdates = input.governed
    ? { audioTracks: tracks }
    : { audioTracks: tracks, shots };
  return { shots, audioTracks: tracks, sceneUpdates, exceedsShot, overlapsNextLine };
}
