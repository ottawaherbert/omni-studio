import type { Shot, Scene } from "../../types/project";

export type ShotTake = NonNullable<Shot["takes"]>[number];
export type ShotTakeAdoptionScope = "image" | "video" | "all";

export interface StudioCandidateWrite {
  shotId: string;
  boardId?: string;
  take?: ShotTake;
  draftPreview?: Shot["draftPreview"];
}

export const appendStudioCandidateToScene = (scene: Scene, candidate: StudioCandidateWrite): Scene => {
  const { shotId, boardId, take, draftPreview } = candidate;
  if (draftPreview) return { ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, draftPreview } : shot) };
  if (!take) return scene;
  if (boardId && scene.manualStoryboard) return { ...scene, manualStoryboard: {
    ...scene.manualStoryboard,
    boards: scene.manualStoryboard.boards?.map((board) => board.boardId === boardId || board.board?.id === boardId ? {
      ...board, takes: [...(board.takes || []).filter((item) => item.id !== take.id), take],
    } : board),
  } };
  return { ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? appendShotTakeCandidate(shot, take) : shot) };
};

const takeHasMedia = (take: ShotTake) => Boolean(
  take.imageUrl || take.videoUrl || take.imageMedia || take.videoMedia,
);

const initialTakeFor = (shot: Shot, createdAt: number): ShotTake | undefined => (
  shot.imageUrl || shot.videoUrl
    ? {
        id: `take-initial-${shot.id}`,
        imageUrl: shot.imageUrl,
        videoUrl: shot.videoUrl,
        imageMedia: shot.imageMedia,
        videoMedia: shot.videoMedia,
        createdAt: createdAt - 1,
      }
    : undefined
);

export const appendShotTakeCandidate = (
  shot: Shot,
  candidate: ShotTake,
  _maxTakes = 8,
): Shot => {
  const storedTakes = (shot.takes || []).filter(takeHasMedia);
  const initialTake = storedTakes.length ? undefined : initialTakeFor(shot, candidate.createdAt);
  const baseTakes = initialTake ? [initialTake] : storedTakes;
  const takesWithCandidate = [
    ...baseTakes.filter((take) => take.id !== candidate.id),
    candidate,
  ];
  return {
    ...shot,
    // Candidates remain durable until the creator explicitly adopts or rejects them.
    takes: takesWithCandidate,
  };
};

export const shotTakeHasVideoIntent = (take: ShotTake) => Boolean(
  take.videoUrl
  || take.videoMedia
  || take.generationAudit?.action === "generate_video"
  || take.generationAudit?.action === "import_video"
);

const mediaIsReady = (status?: string) => status !== "pending" && status !== "failed";

export const isShotTakeReadyForAdoption = (
  take: ShotTake | undefined,
  scope: ShotTakeAdoptionScope = "all",
) => {
  if (!take) return false;
  const imageReady = Boolean(take.imageUrl && mediaIsReady(take.imageMedia?.status));
  const taskStatus = take.generationAudit?.videoTaskStatus;
  const videoReady = Boolean(
    take.videoUrl
    && mediaIsReady(take.videoMedia?.status)
    && !["submitting", "queued", "running", "failed", "cancelled"].includes(taskStatus || ""),
  );
  if (scope === "image") return imageReady;
  if (scope === "video") return videoReady;
  return shotTakeHasVideoIntent(take) ? videoReady : imageReady;
};

export const adoptShotTake = (
  shot: Shot,
  takeId: string,
  scope: ShotTakeAdoptionScope = "all",
): Shot => {
  const selectedTake = shot.takes?.find((take) => take.id === takeId);
  if (!isShotTakeReadyForAdoption(selectedTake, scope)) return shot;

  const adoptImage = scope !== "video" && Boolean(selectedTake.imageUrl);
  const adoptVideo = scope !== "image" && Boolean(selectedTake.videoUrl);
  const imageUrl = adoptImage ? selectedTake.imageUrl : shot.imageUrl;
  const imageMedia = adoptImage ? selectedTake.imageMedia : shot.imageMedia;
  const videoUrl = adoptVideo ? selectedTake.videoUrl : shot.videoUrl;
  const videoMedia = adoptVideo ? selectedTake.videoMedia : shot.videoMedia;
  const retainedVideoTake = shot.takes?.find((take) => take.id === shot.activeTakeId && take.videoUrl === videoUrl)
    || shot.takes?.find((take) => take.videoUrl === videoUrl && take.generationAudit?.audioProvenance);
  const audit = selectedTake.generationAudit || retainedVideoTake?.generationAudit;
  const adoptedTake: ShotTake = {
    ...selectedTake,
    imageUrl,
    imageMedia,
    videoUrl,
    videoMedia,
    generationAudit: audit ? {
      ...audit,
      audioProvenance: adoptVideo ? selectedTake.generationAudit?.audioProvenance : retainedVideoTake?.generationAudit?.audioProvenance,
    } : undefined,
  };

  return {
    ...shot,
    imageUrl,
    imageMedia,
    videoUrl,
    videoMedia,
    ...(adoptVideo && videoUrl !== shot.videoUrl
      && selectedTake.generationAudit?.audioRevision?.originalVideoUrl !== shot.videoUrl
      ? { sourceStartSeconds: 0 } : {}),
    activeTakeId: takeId,
    takes: shot.takes?.map((take) => take.id === takeId ? adoptedTake : take),
  };
};

export const reviseShotTakeAudio = (
  shot: Shot,
  takeId: string,
  revision: { takeId: string; videoUrl: string; mode: "strip" | "replace"; replacementAudioUrl?: string; createdAt: number },
): Shot => {
  const original = shot.takes?.find((take) => take.id === takeId);
  if (!original?.videoUrl || !original.generationAudit) throw new Error("待处理的原视频不存在。");
  if (revision.takeId === takeId || shot.takes?.some((take) => take.id === revision.takeId)) throw new Error("新版本标识已存在，未覆盖原视频。");
  const next: ShotTake = {
    ...original, id: revision.takeId, videoUrl: revision.videoUrl, createdAt: revision.createdAt,
    videoMedia: {
      ...original.videoMedia, kind: "video", source: original.videoMedia?.source || "upload",
      url: revision.videoUrl, status: "ready", createdAt: revision.createdAt, updatedAt: revision.createdAt,
      note: revision.mode === "replace" ? "作者创建的替换声音版本。" : "作者创建的无声版本。",
    },
    generationAudit: {
      ...original.generationAudit,
      audioProvenance: {
        source: revision.mode === "replace" ? "full_dialogue_master" : "none",
        embeddedAudio: revision.mode === "replace",
        masterAudioAssetIds: revision.replacementAudioUrl ? [revision.replacementAudioUrl] : [],
        mustNotAutoDub: revision.mode === "replace",
      },
      audioRevision: {
        operation: revision.mode === "replace" ? "replaced" : "stripped",
        originalVideoUrl: original.videoUrl,
        replacementAudioUrl: revision.replacementAudioUrl,
        createdAt: revision.createdAt,
      },
    },
  };
  const appended = appendShotTakeCandidate(shot, next);
  return shot.activeTakeId === takeId ? adoptShotTake(appended, next.id, "video") : appended;
};
