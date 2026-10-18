import type { Episode, ManualStoryboardBoardWorkflow, Shot } from "../../types/project";

export interface ManualStudioPriorVideoReferenceCandidate {
  /** Project-scoped selection identity; Take ids alone are not assumed globally unique. */
  id: string;
  takeId: string;
  episodeId: string;
  sceneId: string;
  ownerKind: "shot" | "storyboard_unit";
  ownerId: string;
  shotId: string;
  mediaUrl: string;
  label: string;
  durationSeconds: number;
}

export interface ManualStudioFrameReferenceCandidate {
  id: string;
  shotId: string;
  mediaUrl: string;
  mediaIdentity: string;
  label: string;
  adopted: boolean;
}

export const buildManualStudioGenerationDraftKey = ({
  sourceKey,
  modelConfigId,
  modeId,
}: {
  sourceKey: string;
  modelConfigId?: string;
  modeId?: string;
}) => sourceKey
  ? `${sourceKey}:${modelConfigId || "default"}:${modeId || "default"}`
  : "";

const VOLATILE_MEDIA_QUERY_KEY = /^(?:x-amz-|x-goog-|token$|access_token$|signature$|sig$|expires$)/i;

export const normalizeManualStudioFrameMediaIdentity = (mediaUrl: string) => {
  const value = mediaUrl.trim();
  if (!value) return "";
  try {
    const relativeOrigin = "https://manual-studio.invalid";
    const parsed = new URL(value, relativeOrigin);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (VOLATILE_MEDIA_QUERY_KEY.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.origin === relativeOrigin
      ? `${parsed.pathname}${parsed.search}`
      : parsed.toString();
  } catch {
    return value;
  }
};

export const filterManualStudioDistinctEndFrameCandidates = (
  start: ManualStudioFrameReferenceCandidate | undefined,
  end: ManualStudioFrameReferenceCandidate[],
) => end.filter((candidate) => (
  candidate.id !== start?.id && candidate.mediaIdentity !== start?.mediaIdentity
));

/**
 * Projects frame choices from the source boundary instead of exposing every
 * image Take in a multi-Shot unit. A start frame always belongs to the first
 * Shot and is already adopted; an end frame always belongs to the last Shot
 * and is either adopted or backed by ready image media.
 */
export const buildManualStudioFrameReferenceCandidates = (
  shots: Shot[],
): { start: ManualStudioFrameReferenceCandidate[]; end: ManualStudioFrameReferenceCandidate[] } => {
  const firstShot = shots[0];
  const lastShot = shots[shots.length - 1];
  if (!firstShot || !lastShot) return { start: [], end: [] };

  const adoptedStartTake = (firstShot.takes || []).find((take) => {
    const adopted = take.id === firstShot.activeTakeId;
    const ready = take.imageMedia?.status === "ready" || (adopted && !take.imageMedia);
    return adopted && ready && Boolean(take.imageUrl);
  });
  const start = adoptedStartTake?.imageUrl ? [{
    id: adoptedStartTake.id,
    shotId: firstShot.id,
    mediaUrl: adoptedStartTake.imageUrl,
    mediaIdentity: normalizeManualStudioFrameMediaIdentity(adoptedStartTake.imageMedia?.url || adoptedStartTake.imageUrl),
    label: shots.length > 1 ? "首个分镜 · 已采用画面" : "当前分镜 · 已采用画面",
    adopted: true,
  }] : [];

  const end = (lastShot.takes || []).flatMap((take, index) => {
    const adopted = take.id === lastShot.activeTakeId;
    const ready = take.imageMedia?.status === "ready" || (adopted && !take.imageMedia);
    if (!take.imageUrl || !ready) return [];
    return [{
      id: take.id,
      shotId: lastShot.id,
      mediaUrl: take.imageUrl,
      mediaIdentity: normalizeManualStudioFrameMediaIdentity(take.imageMedia?.url || take.imageUrl),
      label: adopted
        ? shots.length > 1 ? "末个分镜 · 已采用画面" : "当前分镜 · 已采用画面"
        : `${shots.length > 1 ? "末个分镜" : "当前分镜"} · 可用画面 ${index + 1}`,
      adopted,
    }];
  });

  return { start, end };
};

const readyVideoTake = (take: {
  videoUrl?: string;
  videoMedia?: { status?: string };
  generationAudit?: {
    videoTaskStatus?: string;
    videoMotionContract?: { durationSeconds?: number };
  };
}) => {
  const durationSeconds = Number(take.generationAudit?.videoMotionContract?.durationSeconds || 0);
  const ready = take.videoMedia?.status === "ready"
    || take.generationAudit?.videoTaskStatus === "succeeded";
  return take.videoUrl && ready && durationSeconds >= 2 && durationSeconds <= 15
    ? { mediaUrl: take.videoUrl, durationSeconds }
    : undefined;
};

const currentStoryboardUnits = (workflows?: ManualStoryboardBoardWorkflow[]) => (
  workflows || []
).filter((workflow) => workflow.unitSchema === "storyboard_unit.v1");

/**
 * Builds the small project-level read model used by the Studio reference picker.
 * It never returns legacy boards, pending media, or Takes without a known duration.
 */
export const listManualStudioEligiblePriorVideoReferences = (
  episodes: Episode[],
): ManualStudioPriorVideoReferenceCandidate[] => {
  const candidates: ManualStudioPriorVideoReferenceCandidate[] = [];
  for (const episode of episodes) {
    for (const scene of episode.scenes || []) {
      for (const shot of scene.shots || []) {
        for (const take of shot.takes || []) {
          const video = readyVideoTake(take);
          if (!video) continue;
          candidates.push({
            id: `${episode.id}:${scene.id}:shot:${shot.id}:${take.id}`,
            takeId: take.id,
            episodeId: episode.id,
            sceneId: scene.id,
            ownerKind: "shot",
            ownerId: shot.id,
            shotId: shot.id,
            mediaUrl: video.mediaUrl,
            label: `${episode.title} / ${scene.title} / 分镜视频 · ${video.durationSeconds}s`,
            durationSeconds: video.durationSeconds,
          });
        }
      }
      for (const workflow of currentStoryboardUnits(scene.manualStoryboard?.boards)) {
        for (const take of workflow.takes || []) {
          const video = readyVideoTake(take);
          if (!video) continue;
          const ownerId = workflow.videoGenerationUnitId || workflow.board?.videoGenerationUnitId || workflow.id;
          candidates.push({
            id: `${episode.id}:${scene.id}:storyboard_unit:${ownerId}:${take.id}`,
            takeId: take.id,
            episodeId: episode.id,
            sceneId: scene.id,
            ownerKind: "storyboard_unit",
            ownerId,
            shotId: workflow.shotId,
            mediaUrl: video.mediaUrl,
            label: `${episode.title} / ${scene.title} / 视频单元 · ${video.durationSeconds}s`,
            durationSeconds: video.durationSeconds,
          });
        }
      }
    }
  }
  return candidates;
};
