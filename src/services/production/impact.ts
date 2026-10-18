import {
  ProductionArtifact,
  ProductionArtifactType,
  ProductionRun,
  ProductionStageRun,
  ProductionStageType,
} from "../../types/production";

const downstreamByArtifact: Record<ProductionArtifactType, ProductionStageType[]> = {
  concept: [
    "context_planning",
    "bible",
    "interactive_bible",
    "game_blueprint",
    "structure",
    "scene",
    "script",
    "script_lock",
    "production_breakdown",
    "production_asset_detail",
    "interactive_script",
    "content_lock",
    "storyboard",
    "interactive_storyboard",
    "prompt",
    "expensive_generation_planning",
  ],
  bible: [
    "asset_detail",
    "structure",
    "scene",
    "script",
    "script_lock",
    "production_breakdown",
    "production_asset_detail",
    "interactive_script",
    "content_lock",
    "storyboard",
    "interactive_storyboard",
    "prompt",
    "expensive_generation_planning",
  ],
  character: ["asset_detail", "production_breakdown", "production_asset_detail", "asset_sync", "script", "interactive_script", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  location: ["asset_detail", "scene", "production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  prop: ["asset_detail", "production_breakdown", "production_asset_detail", "asset_sync", "script", "interactive_script", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  episode: ["scene", "script", "script_lock", "production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  scene: ["script", "script_lock", "production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  script: ["script_lock", "production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  performance_beats: ["storyboard", "prompt", "expensive_generation_planning"],
  breakdown: ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  storyboard: ["prompt", "expensive_generation_planning"],
  storyboard_board: ["prompt", "expensive_generation_planning"],
  scene_visual_pack: ["storyboard", "prompt", "expensive_generation_planning"],
  style_reference_analysis: ["asset_detail", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  visual_style_lock_candidate: ["asset_detail", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  style_lock_change_order: ["asset_detail", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  storyboard_strategy_draft: ["storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  storyboard_strategy_draft_trial: ["storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  formal_asset_package: ["asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  asset_identity_board: ["asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  scene_asset_variant_pack: ["storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  asset_variant_fingerprint: ["storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  image_prompt: ["expensive_generation_planning"],
  video_prompt: ["expensive_generation_planning"],
  asset_reference_pack: ["expensive_generation_planning"],
  development_asset_brief: ["asset_detail", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  script_lock_package: ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  content_lock_package: ["production_breakdown", "production_asset_detail", "node_to_scene", "interactive_script", "interactive_storyboard", "playtest_simulation", "expensive_generation_planning"],
  production_block_lock: ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  production_breakdown_report: ["production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  continuity_matrix: ["asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  role_slot: ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  casting_requirement: ["asset_detail", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  casting_candidate: ["production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  casting_decision: ["production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  department_prep_package: ["production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  creative_change_request: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  series_change_order: ["script_lock", "content_lock", "production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  pending_asset: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  variant_request: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  local_resync_plan: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
  asset_board_plan: ["production_asset_detail", "storyboard", "interactive_storyboard", "prompt", "expensive_generation_planning"],
  game_graph: ["interactive_graph_qa", "node_to_scene", "interactive_script", "interactive_storyboard", "playtest_simulation"],
  video_generation_unit: [],
  qa_report: [],
  generation_plan: [],
};

const sourceArtifactTypes = new Set<ProductionArtifactType>([
  "concept",
  "bible",
  "character",
  "location",
  "prop",
  "episode",
  "scene",
  "script",
  "performance_beats",
  "breakdown",
  "storyboard",
  "storyboard_board",
  "scene_visual_pack",
  "style_reference_analysis",
  "visual_style_lock_candidate",
  "style_lock_change_order",
  "storyboard_strategy_draft",
  "storyboard_strategy_draft_trial",
  "formal_asset_package",
  "asset_identity_board",
  "scene_asset_variant_pack",
  "asset_variant_fingerprint",
  "asset_board_plan",
  "asset_reference_pack",
  "development_asset_brief",
  "script_lock_package",
  "content_lock_package",
  "production_block_lock",
  "production_breakdown_report",
  "continuity_matrix",
  "role_slot",
  "casting_requirement",
  "casting_candidate",
  "casting_decision",
  "department_prep_package",
  "creative_change_request",
  "series_change_order",
  "pending_asset",
  "variant_request",
  "local_resync_plan",
  "game_graph",
]);

export const getImpactedStageTypes = (artifacts: ProductionArtifact[]) =>
  Array.from(
    new Set(
      artifacts.flatMap((artifact) =>
        sourceArtifactTypes.has(artifact.artifactType) &&
        artifact.lifecycleStatus !== "qa_failed" &&
        artifact.lifecycleStatus !== "quarantined"
          ? downstreamByArtifact[artifact.artifactType] || []
          : [],
      ),
    ),
  );

export const markDownstreamImpacts = (
  run: ProductionRun,
  sourceStage: ProductionStageRun,
  sourceArtifacts: ProductionArtifact[],
): Pick<ProductionRun, "stages" | "artifacts"> => {
  const now = Date.now();
  const impactedStageTypes = getImpactedStageTypes(sourceArtifacts);
  if (impactedStageTypes.length === 0) {
    return { stages: run.stages, artifacts: run.artifacts };
  }
  const sourceIndex = run.stages.findIndex((stage) => stage.id === sourceStage.id);
  const reason = `上游阶段「${sourceStage.title}」产生了新版本产物，需要复核下游上下文。`;

  const stages = run.stages.map((stage, index) => {
    if (index <= sourceIndex) return stage;
    if (!impactedStageTypes.includes(stage.stageType)) return stage;
    if (stage.status === "pending") return stage;
    if (stage.outputArtifactIds.length === 0 && stage.status === "running") return stage;
    return {
      ...stage,
      stale: true,
      staleReason: reason,
      nextAction: `${stage.nextAction || "等待处理。"} 上游产物已更新，建议重跑或人工确认后继续。`,
    };
  });

  const impactedStageIds = new Set(
    stages
      .filter((stage) => stage.stale && impactedStageTypes.includes(stage.stageType))
      .map((stage) => stage.id),
  );
  const artifacts = run.artifacts.map((artifact) =>
    impactedStageIds.has(artifact.stageId)
      ? {
          ...artifact,
          stale: true,
          staleReason: reason,
          staleSince: artifact.staleSince || now,
        }
      : artifact,
  );

  return { stages, artifacts };
};
