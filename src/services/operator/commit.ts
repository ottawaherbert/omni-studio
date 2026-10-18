import { Asset, Character, Episode, Project, Scene, Shot } from "../../types/project";
import { OperatorArtifactEnvelope } from "./types";
import { isOperatorArtifactApproved } from "./artifacts";
import { validateStyleLockChangeOrder } from "../production/styleReference";
import {
  normalizeLegacyVisualStyleLock,
  visualStyleContentHash,
} from "../../../packages/production/src/services/production/visualStyleMigration";

export interface OperatorCommitResult {
  project: Project;
  changedPaths: string[];
  summary: string;
}

const mergeDefined = <T extends Record<string, any>>(base: T, patch: Record<string, any>): T => {
  const next = { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      (next as any)[key] = value;
    }
  });
  return next;
};

const stripKeys = (value: Record<string, any>, keys: string[]) => {
  const next = { ...(value || {}) };
  keys.forEach((key) => delete next[key]);
  return next;
};

const findEpisode = (project: Project, episodeId?: string) =>
  (project.episodes as Episode[] || []).find((episode) => episode.id === episodeId);

const findScene = (episode: Episode, sceneId?: string) =>
  (episode.scenes || []).find((scene) => scene.id === sceneId);

const resolveEpisodeId = (artifact: OperatorArtifactEnvelope, data: any) =>
  data?.episodeId || data?.episode?.id || data?.id || artifact.entityIds[0];

const resolveSceneIds = (artifact: OperatorArtifactEnvelope, data: any) => ({
  episodeId: data?.episodeId || data?.episode?.id || artifact.entityIds[0],
  sceneId: data?.sceneId || data?.scene?.id || data?.id || artifact.entityIds[1],
});

const resolveShotIds = (artifact: OperatorArtifactEnvelope, data: any) => ({
  episodeId: data?.episodeId || artifact.entityIds[0],
  sceneId: data?.sceneId || artifact.entityIds[1],
  shotId: data?.shotId || data?.shot?.id || data?.id || artifact.entityIds[2],
});

const resolveStyleLockChangeOrder = (data: any) =>
  data?.styleLockChangeOrder || data?.changeOrder || data?.order || data;

const upsertById = <T extends { id: string }>(items: T[], incoming: T) => {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index >= 0) {
    const next = [...items];
    next[index] = mergeDefined(next[index], incoming);
    return next;
  }
  return [...items, incoming];
};

const updateEpisodeList = (project: Project, episode: Episode): Project => ({
  ...project,
  episodes: upsertById((project.episodes as Episode[]) || [], episode),
});

const updateSceneInEpisode = (project: Project, episodeId: string, scene: Scene): Project => {
  const episode = findEpisode(project, episodeId);
  if (!episode) throw new Error(`Episode not found for scene commit: ${episodeId}`);
  return updateEpisodeList(project, {
    ...episode,
    scenes: upsertById(episode.scenes || [], scene),
  });
};

const updateShotInScene = (project: Project, episodeId: string, sceneId: string, shot: Shot): Project => {
  const episode = findEpisode(project, episodeId);
  if (!episode) throw new Error(`Episode not found for shot commit: ${episodeId}`);
  const scene = findScene(episode, sceneId);
  if (!scene) throw new Error(`Scene not found for shot commit: ${sceneId}`);
  return updateSceneInEpisode(project, episodeId, {
    ...scene,
    shots: upsertById(scene.shots || [], shot),
  });
};

const applyMediaReference = (project: Project, artifact: OperatorArtifactEnvelope): OperatorCommitResult => {
  const data: any = artifact.data || {};
  const target = data.target || data.targetEntity || {};
  const mediaUrl = data.mediaUrl || data.url || data.imageUrl || data.localPath;
  if (!mediaUrl) throw new Error("media_reference artifact requires mediaUrl/url/localPath.");
  if (!target.type) throw new Error("media_reference artifact requires target.type.");
  const field = target.field || (target.type === "character" ? "referenceImageUrl" : "imageUrl");

  if (target.type === "character") {
    const characters = ((project.characters || []) as Character[]).map((character) =>
      character.id === target.id ? { ...character, [field]: mediaUrl } : character,
    );
    return {
      project: { ...project, characters },
      changedPaths: [`project.characters.${target.id}.${field}`],
      summary: `已把媒体引用写入角色 ${target.id}。`,
    };
  }

  if (target.type === "asset") {
    const assets = ((project.assets || []) as Asset[]).map((asset) =>
      asset.id === target.id ? { ...asset, [field]: mediaUrl } : asset,
    );
    return {
      project: { ...project, assets },
      changedPaths: [`project.assets.${target.id}.${field}`],
      summary: `已把媒体引用写入资产 ${target.id}。`,
    };
  }

  if (target.type === "shot") {
    const episodeId = target.episodeId || data.episodeId;
    const sceneId = target.sceneId || data.sceneId;
    if (!episodeId || !sceneId || !target.id) {
      throw new Error("shot media_reference requires target.id, episodeId and sceneId.");
    }
    const episode = findEpisode(project, episodeId);
    const scene = episode ? findScene(episode, sceneId) : undefined;
    const shot = scene?.shots?.find((item) => item.id === target.id);
    if (!shot) throw new Error(`Shot not found for media reference: ${target.id}`);
    const nextShot = {
      ...shot,
      [field]: mediaUrl,
      ...(data.media ? { [field === "videoUrl" ? "videoMedia" : "imageMedia"]: data.media } : {}),
    };
    return {
      project: updateShotInScene(project, episodeId, sceneId, nextShot),
      changedPaths: [`episodes.${episodeId}.scenes.${sceneId}.shots.${target.id}.${field}`],
      summary: `已把媒体引用写入镜头 ${target.id}。`,
    };
  }

  throw new Error(`Unsupported media_reference target type: ${target.type}`);
};

export const commitOperatorArtifactToProject = (
  project: Project,
  artifact: OperatorArtifactEnvelope,
): OperatorCommitResult => {
  if (artifact.status === "committed") {
    throw new Error("Operator artifact is already committed.");
  }
  if (!isOperatorArtifactApproved(artifact)) {
    throw new Error("Operator artifact must pass non-blocking QA before commit.");
  }
  const data: any = artifact.data || {};

  if (artifact.kind === "project_patch") {
    const patch = stripKeys(data, ["id", "episodes", "scenes", "shots"]);
    return {
      project: mergeDefined(project, patch),
      changedPaths: Object.keys(patch).map((key) => `project.${key}`),
      summary: "已提交项目根字段补丁。",
    };
  }

  if (artifact.kind === "episode_patch") {
    const episodeId = resolveEpisodeId(artifact, data);
    if (!episodeId) throw new Error("episode_patch requires episode id.");
    const existing = findEpisode(project, episodeId);
    const incoming = stripKeys({ ...data, id: episodeId }, ["episodeId"]);
    const episode = mergeDefined(existing || ({ id: episodeId, scenes: [] } as Episode), incoming) as Episode;
    return {
      project: updateEpisodeList(project, episode),
      changedPaths: [`episodes.${episodeId}`],
      summary: `已提交分集 ${episodeId} 补丁。`,
    };
  }

  if (artifact.kind === "scene_patch") {
    const { episodeId, sceneId } = resolveSceneIds(artifact, data);
    if (!episodeId || !sceneId) throw new Error("scene_patch requires episodeId and sceneId.");
    const episode = findEpisode(project, episodeId);
    const existing = episode ? findScene(episode, sceneId) : undefined;
    const scene = mergeDefined(existing || ({ id: sceneId, title: "", description: "", valueCharge: "neutral" } as Scene), {
      ...stripKeys(data, ["episodeId", "sceneId", "scene"]),
      ...(data.scene || {}),
      id: sceneId,
    }) as Scene;
    return {
      project: updateSceneInEpisode(project, episodeId, scene),
      changedPaths: [`episodes.${episodeId}.scenes.${sceneId}`],
      summary: `已提交场景 ${sceneId} 补丁。`,
    };
  }

  if (artifact.kind === "storyboard_shots") {
    const { episodeId, sceneId } = resolveSceneIds(artifact, data);
    const shots = data.shots;
    if (!episodeId || !sceneId || !Array.isArray(shots)) {
      throw new Error("storyboard_shots requires episodeId, sceneId and shots[].");
    }
    const episode = findEpisode(project, episodeId);
    const scene = episode ? findScene(episode, sceneId) : undefined;
    if (!scene) throw new Error(`Scene not found for storyboard commit: ${sceneId}`);
    return {
      project: updateSceneInEpisode(project, episodeId, { ...scene, shots }),
      changedPaths: [`episodes.${episodeId}.scenes.${sceneId}.shots`],
      summary: `已提交场景 ${sceneId} 的 ${shots.length} 个分镜。`,
    };
  }

  if (artifact.kind === "shot_patch") {
    const { episodeId, sceneId, shotId } = resolveShotIds(artifact, data);
    if (!episodeId || !sceneId || !shotId) throw new Error("shot_patch requires episodeId, sceneId and shotId.");
    const episode = findEpisode(project, episodeId);
    const scene = episode ? findScene(episode, sceneId) : undefined;
    const existing = scene?.shots?.find((shot) => shot.id === shotId);
    const shot = mergeDefined(existing || ({ id: shotId } as Shot), {
      ...stripKeys(data, ["episodeId", "sceneId", "shotId", "shot"]),
      ...(data.shot || {}),
      id: shotId,
    }) as Shot;
    return {
      project: updateShotInScene(project, episodeId, sceneId, shot),
      changedPaths: [`episodes.${episodeId}.scenes.${sceneId}.shots.${shotId}`],
      summary: `已提交镜头 ${shotId} 补丁。`,
    };
  }

  if (artifact.kind === "character_patch") {
    const character = { ...data.character, ...stripKeys(data, ["character"]) } as Character;
    if (!character.id) throw new Error("character_patch requires character id.");
    return {
      project: { ...project, characters: upsertById((project.characters || []) as Character[], character) },
      changedPaths: [`project.characters.${character.id}`],
      summary: `已提交角色 ${character.id} 补丁。`,
    };
  }

  if (artifact.kind === "asset_patch") {
    const asset = { ...data.asset, ...stripKeys(data, ["asset"]) } as Asset;
    if (!asset.id) throw new Error("asset_patch requires asset id.");
    return {
      project: { ...project, assets: upsertById((project.assets || []) as Asset[], asset) },
      changedPaths: [`project.assets.${asset.id}`],
      summary: `已提交资产 ${asset.id} 补丁。`,
    };
  }

  if (artifact.kind === "media_reference") {
    return applyMediaReference(project, artifact);
  }

  if (artifact.kind === "style_lock_change_order") {
    const order = resolveStyleLockChangeOrder(data);
    const blockingIssues = validateStyleLockChangeOrder(order).filter((issue) => issue.severity === "blocking");
    if (blockingIssues.length > 0) {
      throw new Error(`style_lock_change_order has blocking QA issues: ${blockingIssues.map((issue) => issue.target).join(", ")}`);
    }
    if (order?.schemaVersion !== "style-lock-change-order.v1") {
      throw new Error("style_lock_change_order requires schemaVersion style-lock-change-order.v1.");
    }
    if (order.projectId && order.projectId !== project.id) {
      throw new Error("style_lock_change_order projectId does not match target project.");
    }
    if (order.approvalState !== "approved") {
      throw new Error("Only approved style_lock_change_order artifacts can mutate project.visualStyleLock.");
    }
    if (!order.targetStyleLock || typeof order.targetStyleLock !== "object") {
      throw new Error("style_lock_change_order requires targetStyleLock.");
    }
    const now = Date.now();
    const currentRevision = Math.max(0, Math.floor(Number(project.visualStyleLock?.revision) || 0));
    if (Number(order.baseRevision) !== currentRevision) {
      throw new Error(`style_lock_change_order is stale: based on revision ${order.baseRevision}, current revision is ${currentRevision}.`);
    }
    const visualStyleLock = normalizeLegacyVisualStyleLock({
      ...order.targetStyleLock,
      revision: currentRevision + 1,
      source: order.targetStyleLock.source || "style_reference_analysis",
      humanApprovalState: "approved",
      lockedAt: order.targetStyleLock.lockedAt || now,
      sourceReview: {
        status: "current",
        changedFields: [],
        detectedAt: now,
        basedOnRevision: currentRevision + 1,
      },
    }, { detectedAt: now }).lock;
    visualStyleLock.schemaVersion = "visual-style-lock.v3";
    visualStyleLock.revision = currentRevision + 1;
    visualStyleLock.version = `visual-style-lock.v3.r${visualStyleLock.revision}`;
    visualStyleLock.contentHash = visualStyleContentHash(visualStyleLock);
    return {
      project: {
        ...project,
        visualStyleLock,
        styleLockChangeLog: [
          ...(project.styleLockChangeLog || []),
          {
            id: order.id,
            sourceCandidateId: order.sourceCandidateId,
            artifactId: artifact.id,
            approvedBy: order.approvedBy,
            approvedAt: now,
            scope: order.scope,
            affectedArtifactKinds: order.affectedArtifactKinds || [],
            requiredReruns: order.requiredReruns || [],
            rollbackPlan: order.rollbackPlan,
          },
        ],
      },
      changedPaths: ["project.visualStyleLock", "project.styleLockChangeLog"],
      summary: `已提交风格锁变更单 ${order.id}，后续需复核 ${((order.requiredReruns || []) as string[]).join(", ") || "相关阶段"}。`,
    };
  }

  throw new Error(`Unsupported operator artifact kind for commit: ${artifact.kind}`);
};
