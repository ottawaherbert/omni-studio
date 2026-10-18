import type {
  ProductionArtifactType,
  ProductionRun,
  ProductionStageType,
} from "../../types/production";

export interface LegacyProductionRunChange {
  changeType: "asset_deleted" | "asset_renamed" | "asset_reference_changed" | "episode_changed" | "scene_changed";
  entityId?: string;
  entityName?: string;
  assetType?: string;
  reason?: string;
}

export const impactedStageTypesForProjectChange = (
  changeType: LegacyProductionRunChange["changeType"],
  assetType?: string,
): ProductionStageType[] => {
  if (changeType === "episode_changed") {
    return [
      "scene",
      "script",
      "script_lock",
      "production_breakdown",
      "production_asset_detail",
      "asset_sync",
      "storyboard",
      "prompt",
      "expensive_generation_planning",
      "node_to_scene",
      "content_lock",
      "interactive_script",
      "interactive_storyboard",
      "playtest_simulation",
    ];
  }
  if (changeType === "scene_changed") {
    return [
      "script",
      "script_lock",
      "production_breakdown",
      "production_asset_detail",
      "asset_sync",
      "storyboard",
      "prompt",
      "expensive_generation_planning",
      "content_lock",
      "interactive_script",
      "interactive_storyboard",
      "playtest_simulation",
    ];
  }
  const common: ProductionStageType[] = [
    "asset_detail",
    "production_breakdown",
    "production_asset_detail",
    "asset_sync",
    "storyboard",
    "interactive_storyboard",
    "prompt",
    "expensive_generation_planning",
    "playtest_simulation",
  ];
  if (assetType === "location") {
    return ["scene", "script", "script_lock", "interactive_script", "content_lock", ...common];
  }
  return ["script", "script_lock", "interactive_script", "content_lock", ...common];
};

const impactedArtifactTypesForStage = new Set<ProductionArtifactType>([
  "character",
  "location",
  "prop",
  "scene",
  "script",
  "performance_beats",
  "breakdown",
  "storyboard",
  "storyboard_board",
  "scene_visual_pack",
  "formal_asset_package",
  "asset_identity_board",
  "scene_asset_variant_pack",
  "asset_variant_fingerprint",
  "continuity_matrix",
  "image_prompt",
  "video_prompt",
  "asset_board_plan",
  "asset_reference_pack",
  "video_generation_unit",
  "creative_change_request",
  "pending_asset",
  "variant_request",
  "local_resync_plan",
  "generation_plan",
  "qa_report",
]);

export const applyLegacyProductionRunInvalidation = (
  runs: ProductionRun[],
  projectId: string,
  change: LegacyProductionRunChange,
  now = Date.now(),
) => {
  const impactedStageTypes = new Set(
    impactedStageTypesForProjectChange(change.changeType, change.assetType),
  );
  const reason = change.reason || [
    "项目资料发生人工变更",
    change.entityName ? `「${change.entityName}」` : "",
    change.entityId ? `(${change.entityId})` : "",
    "，相关历史制片产物需要复核。",
  ].filter(Boolean).join("");
  const nextRuns = runs.map((run) => {
    if (run.projectId !== projectId) return run;
    const staleStageIds = new Set<string>();
    const stages = (run.stages || []).map((stage) => {
      if (!impactedStageTypes.has(stage.stageType) || stage.status === "pending") return stage;
      staleStageIds.add(stage.id);
      return {
        ...stage,
        stale: true,
        staleReason: reason,
        nextAction: `${stage.nextAction || "等待处理。"} 项目资料已变更，请在当前工作区重新生成受影响内容。`,
      };
    });
    if (staleStageIds.size === 0) return run;
    const artifacts = (run.artifacts || []).map((artifact) =>
      staleStageIds.has(artifact.stageId) && impactedArtifactTypesForStage.has(artifact.artifactType)
        ? {
            ...artifact,
            stale: true,
            staleReason: reason,
            staleSince: artifact.staleSince || now,
          }
        : artifact,
    );
    return {
      ...run,
      revision: (run.revision || 0) + 1,
      stages,
      artifacts,
      updatedAt: now,
    };
  });
  return {
    runs: nextRuns,
    changedRunIds: nextRuns
      .filter((run, index) => run !== runs[index])
      .map((run) => run.id),
  };
};
