import { createHash } from 'node:crypto';
import type { Episode, ManualStudioTakeAudit, MediaAssetReference, Project, Shot } from '../types/project';
import type { InteractiveProductionMediaTakeOption } from '../domains/interactive/ports/productionPrepPort';
import type { ArtifactRef, InteractiveMediaPlaybackSnapshot } from '../domains/interactive/types/schema';
import { isTrustedReadyMediaReference } from '../utils/mediaProvenance';
import { dbHelpers } from './db';

export const mediaTakeChecksum = ({
  projectId,
  episodeId,
  sceneId,
  shotId,
  takeId,
  media,
}: {
  projectId: string;
  episodeId: string;
  sceneId: string;
  shotId: string;
  takeId: string;
  media: MediaAssetReference;
}) => createHash('sha256').update(JSON.stringify({
  projectId,
  episodeId,
  sceneId,
  shotId,
  takeId,
  url: media.url,
  generationJobId: media.generationJobId,
  modelId: media.modelId,
  source: media.source,
  status: media.status,
  updatedAt: media.updatedAt,
})).digest('hex');

type TrustedProductionTake = {
  takeId: string;
  media: MediaAssetReference;
  mediaKind: 'video' | 'image';
  generationAudit?: ManualStudioTakeAudit;
  createdAt: number;
  isActive: boolean;
};

export const trustedProductionTakes = (shot: Shot): TrustedProductionTake[] => {
  const takes: TrustedProductionTake[] = [];
  for (const take of shot.takes || []) {
    if (isTrustedReadyMediaReference(take.videoMedia, 'video')) {
      takes.push({
        takeId: take.id,
        media: take.videoMedia,
        mediaKind: 'video',
        generationAudit: take.generationAudit,
        createdAt: take.createdAt,
        isActive: take.id === shot.activeTakeId,
      });
    } else if (isTrustedReadyMediaReference(take.imageMedia, 'image')) {
      takes.push({
        takeId: take.id,
        media: take.imageMedia,
        mediaKind: 'image',
        generationAudit: take.generationAudit,
        createdAt: take.createdAt,
        isActive: take.id === shot.activeTakeId,
      });
    }
  }
  const selectedTake = shot.activeTakeId
    ? shot.takes?.find((take) => take.id === shot.activeTakeId)
    : undefined;
  const directMedia: TrustedProductionTake[] = isTrustedReadyMediaReference(shot.videoMedia, 'video')
    ? [{
        takeId: shot.activeTakeId || `${shot.id}:primary`,
        media: shot.videoMedia,
        mediaKind: 'video' as const,
        generationAudit: selectedTake?.generationAudit,
        createdAt: selectedTake?.createdAt || shot.videoMedia.createdAt,
        isActive: true,
      }]
    : isTrustedReadyMediaReference(shot.imageMedia, 'image')
      ? [{
          takeId: shot.activeTakeId || `${shot.id}:image`,
          media: shot.imageMedia,
          mediaKind: 'image' as const,
          generationAudit: selectedTake?.generationAudit,
          createdAt: selectedTake?.createdAt || shot.imageMedia.createdAt,
          isActive: true,
        }]
      : [];
  return [...takes, ...directMedia].filter((take, index, candidates) => (
    candidates.findIndex((candidate) => (
      candidate.mediaKind === take.mediaKind
      && candidate.media.url === take.media.url
      && candidate.media.generationJobId === take.media.generationJobId
    )) === index
  ));
};

export const interactiveContentSlotLabel = (slot: InteractiveProductionMediaTakeOption['contentSlot']) => ({
  entry: '进入画面',
  main: '主体画面',
  choice_hold: '选择等待',
  exit: '离开画面',
}[slot]);
export const sameArtifactRef = (
  left: { artifactId: string; versionId: string; checksum: string } | undefined,
  right: { artifactId: string; versionId: string; checksum: string } | undefined,
) => Boolean(left && right && left.artifactId === right.artifactId
  && left.versionId === right.versionId
  && left.checksum === right.checksum);

export const resolveProductionMediaTake = (
  ref: { artifactId: string; versionId: string; checksum: string },
  nodeId: string,
): InteractiveProductionMediaTakeOption | null => {
  const prefix = 'production-media-take:';
  if (!ref.artifactId.startsWith(prefix)) return null;
  const productionProjectId = ref.artifactId.slice(prefix.length).split(':')[0];
  const project = dbHelpers.getProjectById(productionProjectId) as Project | null;
  if (!project) return null;
  for (const episode of project.episodes) {
    for (const scene of (episode as Episode).scenes || []) {
      for (const [shotIndex, shot] of (scene.shots || []).entries()) {
        for (const take of trustedProductionTakes(shot)) {
          const checksum = mediaTakeChecksum({
            projectId: project.id,
            episodeId: episode.id,
            sceneId: scene.id,
            shotId: shot.id,
            takeId: take.takeId,
            media: take.media,
          });
          const candidateRef = {
            artifactId: `production-media-take:${project.id}:${episode.id}:${scene.id}:${shot.id}:${take.takeId}`,
            versionId: take.media.generationJobId || `media-${checksum.slice(0, 16)}`,
            kind: 'media_take' as const,
            checksum,
          };
          if (!sameArtifactRef(candidateRef, ref)) continue;
          const interactiveContext = take.generationAudit?.interactiveVideoContext;
          const visualScenarios = scene.interactiveMetadata?.visualScenarios || [];
          const fallbackScenario = visualScenarios.length === 1 ? visualScenarios[0] : undefined;
          const contentSlot = interactiveContext?.contentSlot || 'main';
          return {
            ref: candidateRef,
            nodeId,
            productionProjectId: project.id,
            productionEpisodeId: episode.id,
            productionSceneId: scene.id,
            shotId: shot.id,
            takeId: take.takeId,
            isActive: take.isActive,
            createdAt: take.createdAt,
            label: `${interactiveContentSlotLabel(contentSlot)} · ${scene.title || `场 ${scene.sceneNumber || ''}`} · 镜头 ${shotIndex + 1}`,
            durationSeconds: Number(shot.duration || 0),
            contentSlot,
            mediaKind: take.mediaKind,
            embeddedAudio: take.mediaKind === 'video' && Boolean(take.generationAudit?.audioProvenance?.embeddedAudio),
            visualScenarioId: interactiveContext?.visualScenarioId
              || take.generationAudit?.visualScenarioId
              || fallbackScenario?.id,
            visualStateFingerprint: take.generationAudit?.visualStateFingerprint
              || interactiveContext?.visualStateFingerprint
              || fallbackScenario?.stateFingerprint,
            visualReuseFingerprint: take.generationAudit?.visualReuseFingerprint
              || interactiveContext?.visualReuseFingerprint
              || fallbackScenario?.reuseFingerprint,
            url: take.media.url,
          };
        }
      }
    }
  }
  return null;
};

export const captureProductionMediaPlayback = (ref: ArtifactRef, nodeId: string): InteractiveMediaPlaybackSnapshot => {
  const take = resolveProductionMediaTake(ref, nodeId);
  if (!take) throw Object.assign(new Error('所选画面已经变更或被移除，请重新选择素材后再创建试玩。'), { statusCode: 409 });
  if (!Number.isFinite(take.durationSeconds) || take.durationSeconds <= 0) {
    throw Object.assign(new Error(`「${take.label}」缺少有效播放时长，请设置镜头时长后再创建试玩。`), { statusCode: 422 });
  }
  return {
    ref, label: take.label, durationSeconds: take.durationSeconds,
    contentSlot: take.contentSlot, mediaKind: take.mediaKind, embeddedAudio: take.embeddedAudio,
    visualScenarioId: take.visualScenarioId,
    visualStateFingerprint: take.visualStateFingerprint,
    visualReuseFingerprint: take.visualReuseFingerprint,
  };
};
