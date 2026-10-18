import type {
  ProductionQAIssue,
  ProductionRun,
  ProductionStageExecutionResult,
} from "../../types/production";
import {
  buildSceneAssetVariantPacks,
  validateSceneAssetVariantPacks,
} from "./productionAssetPackage";
import {
  latestFormalAssetBoardPlan,
  latestFormalAssetPackage,
  resolveProductionPrepBundle,
} from "./productionPrepRuntime";
import {
  getProject,
  loadFullEpisodes,
  updateProject,
} from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import {
  buildVideoStoryboardAssetBoardPlan,
} from "./videoStoryboardAssetBoards";
import type { VideoStoryboardArtifactIssue } from "./videoStoryboardArtifacts";
import { buildProductionSceneVisualPackDrafts } from "./videoStoryboardSceneVisualPacks";

const toVideoStoryboardProductionIssues = (
  issues: VideoStoryboardArtifactIssue[],
): ProductionQAIssue[] =>
  issues.map((issue) =>
    makeIssue(
      issue.target,
      `${issue.code}: ${issue.message}`,
      issue.severity === "blocking" ? "blocking" : "warning",
      "检查故事板策略选择、panel 数、箭头 legend、镜头/资产/连续性引用后再进入 prompt 或媒体生成计划。",
    ),
  );

export const executeAssetSyncStage = async (
  run?: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const existingCharacterNames = new Set((project.characters || []).map((character) => character.name));
  const existingLocationNames = new Set((project.assets || []).filter((asset) => asset.type === "location").map((asset) => asset.name));
  const existingPropNames = new Set((project.assets || []).filter((asset) => asset.type === "prop").map((asset) => asset.name));
  const plannedCharacterNames = new Set((project.plannedCharacters || []).map((item) => item.name));
  const plannedLocationNames = new Set((project.plannedLocations || []).map((item) => item.name));
  const plannedPropNames = new Set((project.plannedProps || []).map((item) => item.name));

  const newCharacters: any[] = [];
  const newLocations: any[] = [];
  const newProps: any[] = [];

  episodes.forEach((episode) => {
    (episode.scenes || []).forEach((scene) => {
      const breakdown = scene.breakdown;
      if (!breakdown) return;
      (breakdown.characters || []).forEach((item: any) => {
        const name = typeof item === "string" ? item : item.name;
        if (name && !existingCharacterNames.has(name) && !plannedCharacterNames.has(name)) {
          plannedCharacterNames.add(name);
          newCharacters.push({
            id: `planned-char-${Date.now()}-${crypto.randomUUID()}`,
            name,
            roleType: "supporting",
            brief: `由场景《${scene.title}》的已确认剧本拆解识别。`,
            isDetailed: false,
          });
        }
      });
      const locationName = typeof breakdown.location === "string" ? breakdown.location : breakdown.location?.name;
      if (locationName && !existingLocationNames.has(locationName) && !plannedLocationNames.has(locationName)) {
        plannedLocationNames.add(locationName);
        newLocations.push({
          id: `planned-location-${Date.now()}-${crypto.randomUUID()}`,
          name: locationName,
          type: "location",
          brief: `由场景《${scene.title}》的已确认剧本拆解识别。`,
          isDetailed: false,
        });
      }
      (breakdown.props || []).forEach((item: any) => {
        const name = typeof item === "string" ? item : item.name;
        if (name && !existingPropNames.has(name) && !plannedPropNames.has(name)) {
          plannedPropNames.add(name);
          newProps.push({
            id: `planned-prop-${Date.now()}-${crypto.randomUUID()}`,
            name,
            type: "prop",
            brief: `由场景《${scene.title}》的已确认剧本拆解识别。`,
            isDetailed: false,
          });
        }
      });
    });
  });

  await updateProject({
    plannedCharacters: [...(project.plannedCharacters || []), ...newCharacters],
    plannedLocations: [...(project.plannedLocations || []), ...newLocations],
    plannedProps: [...(project.plannedProps || []), ...newProps],
  });

  const newAssetCount = newCharacters.length + newLocations.length + newProps.length;
  const syncedProject = {
    ...project,
    plannedCharacters: [...(project.plannedCharacters || []), ...newCharacters],
    plannedLocations: [...(project.plannedLocations || []), ...newLocations],
    plannedProps: [...(project.plannedProps || []), ...newProps],
  };
  const formalAssetBoardPlan = run ? latestFormalAssetBoardPlan(run) : undefined;
  const formalAssetPackage = run ? latestFormalAssetPackage(run) : undefined;
  const requiresVehicleBoardRefresh = Boolean(formalAssetBoardPlan
    && !Array.isArray(formalAssetBoardPlan.vehicleBoards)
    && syncedProject.assets.some((asset) => asset.type === "vehicles"));
  const prep = run && !requiresVehicleBoardRefresh && formalAssetBoardPlan?.productionReadiness === "formal_ready"
    ? resolveProductionPrepBundle(run, syncedProject, episodes)
    : undefined;
  const sceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(
    syncedProject,
    episodes,
    (requiresVehicleBoardRefresh ? undefined : formalAssetBoardPlan) || buildVideoStoryboardAssetBoardPlan(syncedProject),
    prep ? {
      productionBreakdownReport: prep.productionBreakdownReport,
      departmentPrepPackages: prep.departmentPrepPackages,
      requireProductionPrep: true,
    } : {},
  );
  const sceneVisualPackIssues = toVideoStoryboardProductionIssues(sceneVisualPackDrafts.issues);
  const sceneAssetVariantPacks = !requiresVehicleBoardRefresh && formalAssetPackage && formalAssetPackage.status !== "blocked"
    ? buildSceneAssetVariantPacks({
        projectId: syncedProject.id,
        formalAssetPackage,
        sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
      })
    : [];
  const sceneAssetVariantPackIssues = sceneAssetVariantPacks.length > 0
    ? validateSceneAssetVariantPacks(sceneAssetVariantPacks)
    : [];
  const issues = newAssetCount > 0
    ? [makeIssue(
        "assetSync.newAssets",
        `asset_sync 发现 ${newAssetCount} 个新增待确认资产，不能直接进入分镜。`,
        "blocking",
        "新增资产已写入 plannedCharacters/plannedLocations/plannedProps；请从 asset_detail 阶段重跑补全档案，再继续 storyboard。",
      )]
    : [];
  if (requiresVehicleBoardRefresh) issues.push(makeIssue(
    "assetSync.vehicleBoardsMissing",
    "旧资产确认记录尚未包含项目交通工具，已生成参考草案，需重新确认后进入分镜。",
    "blocking",
    "请重跑 asset_detail 阶段，补全交通工具资产板；现有角色、场景、道具档案保持不变。",
  ));
  const qaIssues = [...issues, ...sceneVisualPackIssues, ...sceneAssetVariantPackIssues];

  return {
    summary: `资产同步完成：新增待确认角色 ${newCharacters.length} 个，场景 ${newLocations.length} 个，道具 ${newProps.length} 个；派生 ${sceneVisualPackDrafts.sceneVisualPacks.length} 个场景视觉包草案、${sceneAssetVariantPacks.length} 个场次资产变体包。`,
    artifacts: [
      makeArtifact("character", "project.plannedCharacters", "新增待确认角色", newCharacters.map((item) => item.id)),
      makeArtifact("location", "project.plannedLocations", "新增待确认场景", newLocations.map((item) => item.id)),
      makeArtifact("prop", "project.plannedProps", "新增待确认道具", newProps.map((item) => item.id)),
      makeArtifact("scene_visual_pack", "run.outputSnapshot.sceneVisualPackDrafts", "AI 视频场景视觉包草案", sceneVisualPackDrafts.sceneVisualPacks.map((pack) => pack.id)),
      makeArtifact("scene_asset_variant_pack", "run.outputSnapshot.sceneAssetVariantPacks", "场次资产变体复用包", sceneAssetVariantPacks.map((pack) => pack.id)),
      makeArtifact("asset_variant_fingerprint", "run.outputSnapshot.sceneAssetVariantPacks.variantFingerprints", "资产变体指纹", sceneAssetVariantPacks.flatMap((pack) => pack.variantFingerprints.map((fingerprint) => fingerprint.id))),
    ],
    qaReports: [makeQA("asset.lifecycle.qa", qaIssues, qaIssues.some((issue) => issue.severity === "blocking") ? 0 : qaIssues.length > 0 ? 78 : 100)],
    outputSnapshot: {
      newCharacters,
      newLocations,
      newProps,
      requiresAssetDetailRerun: newAssetCount > 0 || requiresVehicleBoardRefresh,
      sceneVisualPackDrafts: {
        sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
        packSceneIds: sceneVisualPackDrafts.packSceneIds,
        reusedPackIds: sceneVisualPackDrafts.reusedPackIds,
      },
      sceneAssetVariantPacks,
      productionPrepRefs: prep ? {
        productionBreakdownReportId: prep.productionBreakdownReport.id,
        departmentPrepPackageIds: prep.departmentPrepPackages.map((item) => item.id),
      } : undefined,
    },
  };
};
