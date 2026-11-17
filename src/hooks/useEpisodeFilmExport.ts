import { sceneVideoClips } from '../utils/sceneVideoClips';
import { useEffect, useRef, useState } from "react";
import type { ProductionQualityStatus, QualityEvidence, QualityTarget } from "../../packages/domain/src/productionQuality";
import toast from "react-hot-toast";
import { assetClient } from "../clients/assetClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import type { Episode, Project, Scene } from "../clients/domainTypes";
import { flushDebouncedProjectSave, useGlobalStore } from "../clients/stateClient";
import { buildEpisodeAudioExportItems, resolveAudioLibraryUrl } from "../utils/episodeAudioExport";
import { getActiveStoryboardShotGridTake, resolveReadyStoryboardShotGridImage } from "../clients/productionStoryboardWorkflowClient";

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
  reader.readAsDataURL(file);
});

export type EpisodeFilmExportMode = "storyboard" | "video";

export interface SceneStoryboardExportItem {
  imageUrl: string;
  durationSeconds: number;
  shotIds: string[];
  transition?: "none" | "fade" | "black";
}

const downloadName = (project: Project, episode: Episode, suffix?: string, resolution?: number) => {
  const title = `${project.title || "影片"}-${episode.title || "正片"}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${title || "影片"}${suffix ? `-${suffix}` : ""}${resolution ? `-${resolution}p` : ""}.mp4`;
};

export const buildSceneStoryboardExportItems = (scene: Scene): SceneStoryboardExportItem[] => {
  if (scene.edit) {
    const originals = buildSceneStoryboardExportItems({...scene, edit:undefined});
    const byShot = new Map(originals.flatMap(item => item.shotIds.map(id => [id,item.imageUrl] as const)));
    return sceneVideoClips(scene).flatMap(clip => {
      const imageUrl = clip.imageUrl || byShot.get(clip.sourceShotId || clip.id);
      return imageUrl ? [{imageUrl, durationSeconds:clip.duration, shotIds:[clip.id], transition:clip.transition}] : [];
    });
  }
  const shots = scene.shots || [];
  const shotIndex = new Map(shots.map((shot, index) => [shot.id, index]));
  const pageByFirstShot = new Map<string, SceneStoryboardExportItem>();
  const claimedStoryboardShotIds = new Set<string>();

  for (const workflow of scene.manualStoryboard?.boards || []) {
    if (workflow.unitSchema !== "storyboard_unit.v1" || !workflow.board) continue;
    const pages = workflow.board.visualPages || [];
    const panelShotId = new Map(workflow.board.panels.map((panel) => [panel.id, panel.shotId]));
    const workflowShotIds = (workflow.shotIds || workflow.board.shotIds || [workflow.shotId])
      .filter((shotId) => shotIndex.has(shotId));
    for (const page of pages) {
      const referenceMode = workflow.board.visualReferenceMode || "shot_grid";
      const take = page.visualTakes?.find((candidate) => candidate.id === page.activeVisualTakeId);
      const manuallyAdopted = take?.status === "adopted"
        && take.review?.mode === "manual"
        && take.review.status === "approved";
      const independentGrid = referenceMode === "shot_grid" && getActiveStoryboardShotGridTake(page);
      if (!manuallyAdopted && !independentGrid) continue;
      const imageUrl = referenceMode === "shot_grid"
        ? resolveReadyStoryboardShotGridImage({ board: workflow.board, page, shots })
        : take?.imageUrl;
      if (!imageUrl) continue;
      const mappedShotIds = Array.from(new Set(page.panelIds
        .map((panelId) => panelShotId.get(panelId))
        .filter((shotId): shotId is string => Boolean(shotId) && shotIndex.has(shotId))));
      const pageShotIds = (mappedShotIds.length || pages.length !== 1 ? mappedShotIds : workflowShotIds)
        .filter((shotId) => !claimedStoryboardShotIds.has(shotId))
        .sort((left, right) => shotIndex.get(left)! - shotIndex.get(right)!);
      if (!pageShotIds.length || pageByFirstShot.has(pageShotIds[0])) continue;
      pageShotIds.forEach((shotId) => claimedStoryboardShotIds.add(shotId));
      pageByFirstShot.set(pageShotIds[0], {
        imageUrl,
        durationSeconds: pageShotIds.reduce(
          (sum, shotId) => sum + Number(shots[shotIndex.get(shotId)!]?.duration || 0),
          0,
        ),
        shotIds: pageShotIds,
      });
    }
  }

  const consumed = new Set<string>();
  return shots.flatMap((shot) => {
    if (consumed.has(shot.id)) return [];
    const page = pageByFirstShot.get(shot.id);
    if (page) {
      page.shotIds.forEach((shotId) => consumed.add(shotId));
      if (page.shotIds.some(id => shots[shotIndex.get(id)!]?.transition && shots[shotIndex.get(id)!]?.transition !== "none")) {
        return page.shotIds.map(id => ({ imageUrl: page.imageUrl, shotIds: [id], durationSeconds: shots[shotIndex.get(id)!].duration, transition: shots[shotIndex.get(id)!].transition }));
      }
      return [page];
    }
    consumed.add(shot.id);
    return shot.imageUrl
      ? [{ imageUrl: shot.imageUrl, durationSeconds: Number(shot.duration || 0), shotIds: [shot.id], ...(shot.transition && shot.transition !== "none" ? { transition: shot.transition } : {}) }]
      : [];
  });
};

export const buildEpisodeFilmCoverage = (episode: Episode | null) => {
  const scenes = episode?.scenes || [];
  const shots = scenes.flatMap(sceneVideoClips);
  const imageShotCount = scenes.reduce((count,scene) => {
    const covered = new Set(buildSceneStoryboardExportItems(scene).flatMap(item => item.shotIds));
    return count + sceneVideoClips(scene).filter(clip => covered.has(clip.id)).length;
  },0);
  const shotHasVideo = (shot: (typeof shots)[number]) => Boolean(shot.videoUrl);
  const completedPrefixScenes = [] as typeof scenes;
  for (const scene of scenes) {
    const sceneShots = sceneVideoClips(scene);
    if (!sceneShots.length || sceneShots.some((shot) => !shotHasVideo(shot))) break;
    completedPrefixScenes.push(scene);
  }
  return {
    readyShotCount: shots.filter(shotHasVideo).length,
    imageShotCount,
    totalShotCount: shots.length,
    completedSceneCount: completedPrefixScenes.length,
    completedShotCount: completedPrefixScenes.flatMap(sceneVideoClips).length,
    totalSceneCount: scenes.length,
  };
};

export const buildSceneVideoExportItems = (scene: Scene) => {
  const clips=sceneVideoClips(scene);
  if(scene.edit && clips.some(clip=>!clip.videoUrl))throw new Error(`场景「${scene.title}」有剪辑片段缺少固定素材。`);
  return clips.flatMap((shot) => {
    return shot.videoUrl ? [{ videoUrl: shot.videoUrl, durationSeconds: Number(shot.duration || 0), ...(shot.sourceStartSeconds ? { sourceStartSeconds: shot.sourceStartSeconds } : {}), ...(shot.transition && shot.transition !== "none" ? { transition: shot.transition } : {}) }] : [];
  });
};

export interface EpisodeDeliveryAvailability { ready: boolean; reason: string }
const downloadFile = (url: string, name: string) => {
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
};
async function qualityRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/production/quality${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 409 ? '当前内容或检查依据已变化，请完成整集总检后再交付。' : data.error || '无法读取成片检查状态。');
  return data;
}
const readEpisodeDelivery = async (projectId: string, episodeId: string) => {
  const status = await qualityRequest<ProductionQualityStatus>(`/status?target=${encodeURIComponent(JSON.stringify({ projectId, episodeId }))}`);
  const check = status.stages.find(stage => stage.stage === 'episode_cut');
  return { check, availability: {
    ready: check?.status === 'passed' && !!check.inspectionId,
    reason: check?.status === 'passed' && check.inspectionId ? '整集总检已通过，直接下载本次已检查的视频。' : check?.blockers.join('；') || (check?.status === 'stale' ? '当前内容已变化，请完成整集总检。' : '尚未通过整集总检；请在制作质量检查中完整回看并记录结论。'),
  } };
};

export const useEpisodeFilmExport = ({ project, episode }: { project: Project | null; episode: Episode | null }) => {
  const [isExporting, setIsExporting] = useState(false);
  const running = useRef(false);
  const scope = `${project?.id || ''}:${episode?.id || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [deliveryAvailability, setDeliveryAvailability] = useState<EpisodeDeliveryAvailability>({ ready: false, reason: '尚未读取整集总检状态。' });
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => { setDeliveryAvailability({ ready: false, reason: '尚未读取整集总检状态。' }); setPreviewUrl(undefined); }, [scope]);
  const [coverage, setCoverage] = useState({
    readyShotCount: 0,
    imageShotCount: 0,
    totalShotCount: 0,
    completedSceneCount: 0,
    completedShotCount: 0,
    totalSceneCount: 0,
  });

  const refreshCoverage = async () => {
    if (!project || !episode) return coverage;
    await flushDebouncedProjectSave(project.id);
    const fullEpisode = await legacyProjectClient.getEpisode(project.id, episode.id);
    const next = buildEpisodeFilmCoverage(fullEpisode);
    if (currentScope.current !== scope) return next;
    setCoverage(next);
    try {
      const { availability } = await readEpisodeDelivery(project.id, episode.id);
      if (currentScope.current === scope) setDeliveryAvailability(availability);
    } catch (error) {
      if (currentScope.current === scope) setDeliveryAvailability({ ready: false, reason: error instanceof Error ? error.message : '无法读取整集总检状态。' });
    }
    return next;
  };

  const exportEpisode = async ({ subtitles, mode, resolution = 1080, frameRate = 24 }: { subtitles?: File; mode: EpisodeFilmExportMode; resolution?: 480 | 720 | 1080 | 2160; frameRate?: 24 | 25 | 30 | 60 }) => {
    if (!project || !episode || running.current) return;
    running.current = true;
    setIsExporting(true);
    const loadingToast = toast.loading(`正在合成 ${resolution}p 待审预览…`);
    try {
      await flushDebouncedProjectSave(project.id);
      const fullEpisode = await legacyProjectClient.getEpisode(project.id, episode.id);
      if (!fullEpisode) throw new Error("无法读取完整剧集数据。");
      const currentCoverage = buildEpisodeFilmCoverage(fullEpisode);
      const complete = currentCoverage.totalShotCount > 0
        && currentCoverage.readyShotCount === currentCoverage.totalShotCount;
      const storyboardReady = currentCoverage.totalShotCount > 0
        && currentCoverage.imageShotCount === currentCoverage.totalShotCount;
      if (mode === "storyboard" && !storyboardReady) {
        throw new Error(`还有 ${currentCoverage.totalShotCount - currentCoverage.imageShotCount} 个镜头没有分镜图。`);
      }
      const exportedScenes = mode === "storyboard" || complete
        ? (fullEpisode.scenes || [])
        : (fullEpisode.scenes || []).slice(0, currentCoverage.completedSceneCount);
      const shots = exportedScenes.flatMap(sceneVideoClips);
      if (!shots.length) throw new Error("还没有从开头连续完成的场次可供导出。");

      const uploadOptionalFile = async (file?: File) => {
        if (!file) return undefined;
        const uploaded = await assetClient.uploadAsset({ dataUrl: await fileToDataUrl(file), projectId: project.id });
        if (!uploaded.url) throw new Error(uploaded.error || `无法导入 ${file.name}`);
        return uploaded.url;
      };
      const subtitleUrl = await uploadOptionalFile(subtitles);
      const audioTracks = buildEpisodeAudioExportItems(exportedScenes,
        id => resolveAudioLibraryUrl(id, project.assets, useGlobalStore.getState().globalAssets));
      const result = await assetClient.composeEpisodeFilm({
        projectId: project.id,
        resolution, frameRate,
        aspectRatio: project.aspectRatio === "9:16" ? "9:16" : "16:9",
        shots: mode === "storyboard"
          ? exportedScenes.flatMap(buildSceneStoryboardExportItems).map(({ shotIds: _shotIds, ...item }) => item)
          : exportedScenes.flatMap(buildSceneVideoExportItems),
        subtitleUrl,
        audioTracks,
      });
      if (!result.url) throw new Error(result.error || "整集影片合成失败。");
      if (currentScope.current !== scope) throw new Error('当前剧集已切换，合成结果已保留，请回到原剧集查看。');
      setPreviewUrl(result.url);
      const suffix = mode === "storyboard" ? "待审分镜预演" : complete ? "待审粗剪" : `前${exportedScenes.length}场待审粗剪`;
      downloadFile(result.url, downloadName(project, fullEpisode, suffix, resolution));
      toast.success(mode === "storyboard"
        ? "待审分镜预演已导出，没有调用视频模型。"
        : complete ? `整集 ${resolution}p 待审粗剪已导出。` : `前 ${exportedScenes.length} 场 ${resolution}p 待审粗剪已导出。`, { id: loadingToast });
      return result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整集影片导出失败。", { id: loadingToast });
      throw error;
    } finally {
      running.current = false;
      setIsExporting(false);
    }
  };

  const downloadReviewedEpisode = async () => {
    if (!project || !episode || running.current) return;
    running.current = true; setIsExporting(true);
    const loadingToast = toast.loading('正在读取已通过总检的成片…');
    try {
      await flushDebouncedProjectSave(project.id);
      const { check, availability } = await readEpisodeDelivery(project.id, episode.id);
      if (currentScope.current !== scope) throw new Error('当前剧集已切换，请在目标剧集重新交付。');
      setDeliveryAvailability(availability);
      if (!availability.ready || !check?.inspectionId) throw new Error(availability.reason);
      const result = await qualityRequest<{ target: QualityTarget; inspectionId: string; status: string; media: QualityEvidence[] }>('/deliveries', { inspectionId: check.inspectionId });
      if (currentScope.current !== scope) throw new Error('当前剧集已切换，请在目标剧集重新交付。');
      if (result.status !== 'quality_passed' || result.target.projectId !== project.id || result.target.episodeId !== episode.id || result.target.sceneId || result.inspectionId !== check.inspectionId || result.media.length !== 1 || result.media[0].mediaKind !== 'video' || !result.media[0].mediaUrl) throw new Error('返回的成片与本集总检对象不一致，未下载。');
      downloadFile(result.media[0].mediaUrl, downloadName(project, episode, '正式交付'));
      toast.success('已下载本次整集总检通过的成片。', { id: loadingToast });
      return result.media[0].mediaUrl;
    } catch (error) {
      if (currentScope.current === scope) setDeliveryAvailability({ ready: false, reason: error instanceof Error ? error.message : '正式成片读取失败。' });
      toast.error(error instanceof Error ? error.message : '正式成片读取失败。', { id: loadingToast });
      throw error;
    } finally { running.current = false; setIsExporting(false); }
  };

  return { isExporting, exportEpisode, downloadReviewedEpisode, deliveryAvailability, previewUrl, refreshCoverage, ...coverage };
};
