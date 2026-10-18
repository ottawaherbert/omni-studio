import { sceneVideoClips } from '../utils/sceneVideoClips';
import { useState } from "react";
import toast from "react-hot-toast";
import { assetClient } from "../clients/assetClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import type { Episode, Project, Scene } from "../clients/domainTypes";
import { flushDebouncedProjectSave, useGlobalStore } from "../clients/stateClient";
import { buildEpisodeAudioExportItems } from "../utils/episodeAudioExport";
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

const downloadName = (project: Project, episode: Episode, suffix?: string, resolution = 1080) => {
  const title = `${project.title || "影片"}-${episode.title || "正片"}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${title || "影片"}${suffix ? `-${suffix}` : ""}-${resolution}p.mp4`;
};

export const buildSceneStoryboardExportItems = (scene: Scene): SceneStoryboardExportItem[] => {
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
  const shots = scenes.flatMap((scene) => scene.shots || []);
  const videoCoveredShotIds = new Set(scenes.flatMap((scene) => (scene.manualStoryboard?.boards || [])
    .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")
    .flatMap((workflow) => {
      const take = workflow.takes?.find((candidate) => candidate.id === workflow.activeTakeId && Boolean(candidate.videoUrl));
      return take ? workflow.shotIds || workflow.board?.shotIds || [workflow.shotId] : [];
    })));
  const storyboardCoveredShotIds = new Set(scenes.flatMap((scene) =>
    buildSceneStoryboardExportItems(scene).flatMap((item) => item.shotIds)));
  const shotHasVideo = (shot: (typeof shots)[number]) => Boolean(shot.videoUrl || videoCoveredShotIds.has(shot.id));
  const completedPrefixScenes = [] as typeof scenes;
  for (const scene of scenes) {
    const sceneShots = scene.shots || [];
    if (!sceneShots.length || sceneShots.some((shot) => !shotHasVideo(shot))) break;
    completedPrefixScenes.push(scene);
  }
  return {
    readyShotCount: shots.filter(shotHasVideo).length,
    imageShotCount: shots.filter((shot) => storyboardCoveredShotIds.has(shot.id)).length,
    totalShotCount: shots.length,
    completedSceneCount: completedPrefixScenes.length,
    completedShotCount: completedPrefixScenes.flatMap((scene) => scene.shots || []).length,
    totalSceneCount: scenes.length,
  };
};

export const buildSceneVideoExportItems = (scene: Scene) => {
  return sceneVideoClips(scene).flatMap((shot) => {
    return shot.videoUrl ? [{ videoUrl: shot.videoUrl, durationSeconds: Number(shot.duration || 0), ...(shot.sourceStartSeconds ? { sourceStartSeconds: shot.sourceStartSeconds } : {}), ...(shot.transition && shot.transition !== "none" ? { transition: shot.transition } : {}) }] : [];
  });
};

export const useEpisodeFilmExport = ({ project, episode }: { project: Project | null; episode: Episode | null }) => {
  const [isExporting, setIsExporting] = useState(false);
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
    setCoverage(next);
    return next;
  };

  const exportEpisode = async ({ subtitles, mode, resolution = 1080, frameRate = 24 }: { subtitles?: File; mode: EpisodeFilmExportMode; resolution?: 480 | 720 | 1080 | 2160; frameRate?: 24 | 25 | 30 | 60 }) => {
    if (!project || !episode || isExporting) return;
    setIsExporting(true);
    const loadingToast = toast.loading(`正在整理 ${resolution}p 成片…`);
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
      const shots = exportedScenes.flatMap((scene) => scene.shots || []);
      if (!shots.length) throw new Error("还没有从开头连续完成的场次可供导出。");

      const uploadOptionalFile = async (file?: File) => {
        if (!file) return undefined;
        const uploaded = await assetClient.uploadAsset({ dataUrl: await fileToDataUrl(file), projectId: project.id });
        if (!uploaded.url) throw new Error(uploaded.error || `无法导入 ${file.name}`);
        return uploaded.url;
      };
      const subtitleUrl = await uploadOptionalFile(subtitles);
      const audioTracks = buildEpisodeAudioExportItems(exportedScenes, (id) => {
        const global = useGlobalStore.getState().globalAssets.find((asset) => asset.id === id);
        return global?.url || global?.imageUrls?.[0] || project.assets.find((asset) => asset.id === id)?.imageUrl;
      });
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
      const anchor = document.createElement("a");
      anchor.href = result.url;
      const suffix = mode === "storyboard" ? "分镜预演" : complete ? undefined : `前${exportedScenes.length}场`;
      anchor.download = downloadName(project, fullEpisode, suffix, resolution);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success(mode === "storyboard"
        ? "整集分镜预演已导出，没有调用视频模型。"
        : complete ? `整集 ${resolution}p 成片已导出。` : `前 ${exportedScenes.length} 场 ${resolution}p 预览片已导出。`, { id: loadingToast });
      return result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整集影片导出失败。", { id: loadingToast });
      throw error;
    } finally {
      setIsExporting(false);
    }
  };

  return { isExporting, exportEpisode, refreshCoverage, ...coverage };
};
