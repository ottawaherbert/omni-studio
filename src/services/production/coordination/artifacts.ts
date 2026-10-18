import type { OperatorArtifactEnvelope } from "../../operator/types";
import type {
  AssetReferencePack,
  PerformanceBeat,
  SceneVisualPack,
  StoryboardBoard,
  VideoGenerationUnit,
} from "../videoStoryboardArtifacts";

export interface ProductionCoordinationArtifactBundle {
  performanceBeats: PerformanceBeat[];
  sceneVisualPacks: SceneVisualPack[];
  storyboardBoards: StoryboardBoard[];
  assetReferencePacks: AssetReferencePack[];
  videoGenerationUnits: VideoGenerationUnit[];
}

const compact = (value: unknown) => String(value || "").trim();

const extractPerformanceBeats = (artifact: OperatorArtifactEnvelope): PerformanceBeat[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.performanceBeats)) return data.performanceBeats;
  if (Array.isArray(data?.beats) && artifact.kind === "performance_beats") return data.beats;
  if (artifact.kind === "performance_beats" && Array.isArray(data)) return data;
  return [];
};

const extractSceneVisualPacks = (artifact: OperatorArtifactEnvelope): SceneVisualPack[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.sceneVisualPacks)) return data.sceneVisualPacks;
  const pack = data?.sceneVisualPack || data?.visualPack || (artifact.kind === "scene_visual_pack" ? data?.pack || data : undefined);
  return pack?.id ? [pack] : [];
};

const extractStoryboardBoards = (artifact: OperatorArtifactEnvelope): StoryboardBoard[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.storyboardBoards)) return data.storyboardBoards;
  const board = data?.storyboardBoard || (artifact.kind === "storyboard_board" ? data?.board || data : undefined);
  return board?.id ? [board] : [];
};

const extractAssetReferencePacks = (artifact: OperatorArtifactEnvelope): AssetReferencePack[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.assetReferencePacks)) return data.assetReferencePacks;
  const pack = data?.assetReferencePack || (artifact.kind === "asset_reference_pack" ? data?.pack || data : undefined);
  return pack?.id ? [pack] : [];
};

const extractVideoGenerationUnits = (artifact: OperatorArtifactEnvelope): VideoGenerationUnit[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.videoGenerationUnits)) return data.videoGenerationUnits;
  const unit = data?.videoGenerationUnit || (artifact.kind === "video_generation_unit" ? data?.unit || data : undefined);
  return unit?.id ? [unit] : [];
};

const dedupeById = <T extends { id?: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = compact(item?.id);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const collectProductionCoordinationArtifacts = (
  artifacts: OperatorArtifactEnvelope[] = [],
): ProductionCoordinationArtifactBundle => ({
  performanceBeats: dedupeById(artifacts.flatMap(extractPerformanceBeats)),
  sceneVisualPacks: dedupeById(artifacts.flatMap(extractSceneVisualPacks)),
  storyboardBoards: dedupeById(artifacts.flatMap(extractStoryboardBoards)),
  assetReferencePacks: dedupeById(artifacts.flatMap(extractAssetReferencePacks)),
  videoGenerationUnits: dedupeById(artifacts.flatMap(extractVideoGenerationUnits)),
});
