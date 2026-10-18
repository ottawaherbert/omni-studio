import { OPERATOR_HANDBOOK_VERSION } from "./types";
import { LONG_FORM_MEMORY_WINDOW_POLICIES } from "../production/longFormMemory";
import { buildOperatorWorkflowContract } from "./workflowContract";
import { buildVideoStoryboardSystem } from "../production/videoStoryboardSystem";
import { buildVideoStoryboardArtifactSystem } from "../production/videoStoryboardArtifacts";
import { buildSceneVisualPackSystem } from "../production/videoStoryboardSceneVisualPacks";
import { buildProductionCoordinationSystem } from "../production/productionCoordination";
import { buildCreativeChangeSystem } from "../production/creativeChange";
import { buildProductionCockpitSystem } from "../production/productionCockpit";
import { buildProductionLockSystem } from "../production/productionLock";
import { buildProductionPrepSystem } from "../production/productionPrep";
import { buildProductionChangeOrderSystem } from "../production/productionChangeOrder";
import { buildCastingDecisionSystem } from "../production/productionCasting";
import { buildProductionModeSystem } from "../production/productionMode";
import { buildFormalAssetPackageSystem } from "../production/productionAssetPackage";
import { buildProductionContinuitySystem } from "../production/productionContinuity";
import { buildDepartmentAgentSystem } from "../production/departmentAgents";
import { buildProductionAgentManifestSystem } from "../production/agents";
import { buildAdvancedVisualStyleLockSystem, buildStyleReferenceSystem } from "../production/styleReference";
import { buildStoryboardStrategyDraftSystem } from "../production/storyboardStrategyDraft";
import { buildStoryboardStrategyTrialSystem } from "../production/storyboardStrategyTrial";
import { buildStoryboardTemplateRendererSystem } from "../production/videoStoryboardTemplateRenderer";
import { buildStoryboardStrategyImpactSystem } from "../production/storyboardStrategyImpact";
import {
  KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
  KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
} from "../../config/aiConfigDefaults";

export const OPERATOR_CORE_DOCUMENTS = [
  "README.md",
  "doc/design.md",
  "doc/handoff.md",
] as const;

export const buildOperatorCapabilityManifest = () => {
  const workflowOrderSystem = buildOperatorWorkflowContract();
  const videoStoryboardSystem = {
    ...buildVideoStoryboardSystem(),
    videoGenerationModes: {
      schemaVersion: "video-generation-modes.v1",
      defaultMode: "shot",
      modes: [
        {
          id: "shot",
          role: "baseline",
          requiredInputs: ["adopted_shot_first_frame", "videoPrompt"],
          optionalInputs: ["asset_identity_board", "scene_asset_variant_pack"],
          readiness: "confirmed shot plan, visual prompts, and shot QA",
        },
        {
          id: "storyboard",
          role: "extension",
          requiredInputs: ["adopted_composite_storyboard", "videoPrompt", "formal_asset_references"],
          materializationRule: "Use the composite board and asset references to generate and adopt a target-specific first-frame Take before invoking a single-frame video provider.",
          readiness: "confirmed composite storyboard structure, board visual, and storyboard QA",
        },
      ],
      providerInputContracts: [
        {
          provider: "kie",
          modelId: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
          requestContract: "preview_1_5_numeric_duration_without_task_id_or_mode",
          acceptedInput: "single_start_frame",
          durationSource: "selected shot or VideoGenerationUnit",
          aspectRatioSource: "current project",
          acceptedAspectRatios: ["16:9", "9:16"],
          resolutionSource: "video model settings",
          acceptedResolutions: ["480p", "720p"],
          minDurationSeconds: KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
          maxDurationSeconds: KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
          automaticSubmissionRetries: 0,
          resultDelivery: "provider_terminal_status_polling",
          callbackConfiguration: "not_exposed_in_model_settings",
        },
        {
          provider: "kie",
          modelId: KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
          requestContract: "legacy_image_to_video_string_duration_with_task_id_and_mode",
          acceptedInput: "single_start_frame",
          durationSource: "selected shot or VideoGenerationUnit",
          aspectRatioSource: "current project",
          acceptedAspectRatios: ["16:9", "9:16"],
          resolutionSource: "video model settings",
          acceptedResolutions: ["480p", "720p"],
          minDurationSeconds: KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
          maxDurationSeconds: KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
          automaticSubmissionRetries: 0,
          resultDelivery: "provider_terminal_status_polling",
          callbackConfiguration: "not_exposed_in_model_settings",
        },
      ],
    },
    artifactSystem: buildVideoStoryboardArtifactSystem(),
    departmentPrepReferenceIntegration: {
      schemaVersion: "video-storyboard-department-ref-integration.v1",
      status: "department_prep_refs_runtime_integrated",
      sourceArtifact: "department_prep_package",
      sourceStage: "production_breakdown",
      integratedStages: ["storyboard", "prompt", "expensive_generation_planning"],
      requiredDepartments: ["cinematography", "lighting", "performance_directing"],
      conditionalDepartments: [{
        department: "action_choreography",
        condition: "required for scenes/shots with action, combat, chase, stunt, spell-impact, or other motion-continuity risk",
      }],
      artifactFields: {
        storyboard_board: ["cinematographyRefs", "lightingRefs", "performanceRefs", "actionRefs", "panels[].departmentRefIds"],
        asset_reference_pack: ["cameraRefs", "lightingRefs", "performanceRefs", "actionRefs"],
        video_generation_unit: ["cameraRefs", "lightingRefs", "performanceRefs", "actionRefs"],
      },
      builderFunctions: [
        "buildStoryboardDepartmentPrepRefs",
        "buildProductionStoryboardBoardDrafts",
        "buildProductionAssetReferencePackDrafts",
        "buildProductionVideoGenerationUnitDrafts",
      ],
      qaIssueCodes: [
        "STORYBOARD_BOARD_DEPARTMENT_REFS_MISSING",
        "ASSET_REFERENCE_PACK_DEPARTMENT_REFS_MISSING",
        "VIDEO_UNIT_DEPARTMENT_REFS_MISSING",
        "DEPARTMENT_PREP_REF_PAYLOAD_PATH_MISSING",
        "STORYBOARD_PANEL_UNKNOWN_DEPARTMENT_REF",
      ],
      runnerBehavior: [
        "storyboard, prompt, and expensive_generation_planning runners resolve production prep from the current ProductionRun before deriving operator artifacts.",
        "When department prep packages are present, downstream storyboard/prompt/video-unit refs are required and missing key departments become blocking issues.",
        "Legacy runs without production prep remain compatible, but formal production after production_breakdown must preserve department refs into expensive generation planning.",
      ],
    },
  };
  const sceneVisualPackSystem = buildSceneVisualPackSystem();
  const productionCoordinationSystem = buildProductionCoordinationSystem();
  const creativeChangeSystem = buildCreativeChangeSystem();
  const productionCockpitSystem = buildProductionCockpitSystem();
  const productionLockSystem = buildProductionLockSystem();
  const productionPrepSystem = buildProductionPrepSystem();
  const productionChangeOrderSystem = buildProductionChangeOrderSystem();
  const castingDecisionSystem = buildCastingDecisionSystem();
  const productionModeSystem = buildProductionModeSystem();
  const formalAssetPackageSystem = buildFormalAssetPackageSystem();
  const productionContinuitySystem = buildProductionContinuitySystem();
  const departmentAgentSystem = buildDepartmentAgentSystem();
  const productionAgentManifestSystem = buildProductionAgentManifestSystem();
  const styleReferenceSystem = buildStyleReferenceSystem();
  const advancedVisualStyleLockSystem = buildAdvancedVisualStyleLockSystem();
  const storyboardStrategyDraftSystem = buildStoryboardStrategyDraftSystem();
  const storyboardStrategyTrialSystem = buildStoryboardStrategyTrialSystem();
  const storyboardTemplateRendererSystem = buildStoryboardTemplateRendererSystem();
  const storyboardStrategyImpactSystem = buildStoryboardStrategyImpactSystem();
  return {
  handbookVersion: OPERATOR_HANDBOOK_VERSION,
  operationPolicy: {
    mode: "backend_api_only",
    instruction: "AI Operator must operate O.M.N.I. through backend APIs and persisted storage, not browser clicks.",
    browserUsage: "optional_human_visual_inspection_only",
    browserBoundary: "Browser inspection can verify that persisted results are visible, but it is not an execution channel.",
  },
  premiumProductionSystem: {
    mission: "Treat every Operator run as commercial-grade production work, not a demo or schema-fill exercise.",
    primarySuccessMetric: "The persisted work should be coherent, emotionally forceful, format-aware, and plausibly monetizable for its target audience/platform.",
    executionPrinciple: "Build the skeleton before details, refresh structured memory before every generation step, and let role-specific QA challenge the work before commit.",
    qualityLadder: [
      {
        id: "commercial_brief",
        purpose: "Define target audience, platform fit, monetization hook, differentiating promise, cost boundary, and why the work deserves to be made.",
        requiredBefore: ["intake", "concept", "bible", "structure"],
      },
      {
        id: "series_or_feature_skeleton",
        purpose: "Lock the season/feature spine: main promise, midpoint turns, payoffs, relationship arc, villain pressure, and final emotional/business climax.",
        requiredBefore: ["structure", "scene"],
      },
      {
        id: "continuity_ledger",
        purpose: "Persist character state, relationship stage, injuries, cultivation/power level, prop ownership, location damage, secrets revealed, and time-of-day.",
        requiredBefore: ["scene", "script", "storyboard", "prompt"],
      },
      {
        id: "episode_value_plan",
        purpose: "For each episode, define first-three-second hook, scene value turns, emotional escalation, paid/retention hook, and next-episode pull.",
        requiredBefore: ["script", "storyboard"],
      },
      {
        id: "scene_directing_brief",
        purpose: "For each scene, define dramatic task, blocking/spatial logic, visible assets, continuity handoff, and what changes by the cut.",
        requiredBefore: ["storyboard", "prompt"],
      },
      {
        id: "shot_continuity_plan",
        purpose: "For each shot sequence, verify eyeline, match-on-action, prop flow, screen direction, duration math, vertical readability, and imagePrompt specificity.",
        requiredBefore: ["prompt", "expensive_generation_planning"],
      },
    ],
    memoryTiers: [
      "commercial_memory: audience, platform, monetization promise, hook density, budget/cost boundary",
      "skeleton_memory: season/feature/game spine, turning points, payoff map, relationship arc, finale contract",
      "continuity_memory: character state, relationship stage, power level, injuries, prop ownership, location state, secret reveal status",
      "episode_memory: hook, value turns, emotional escalation, cliffhanger, time target, unresolved questions",
      "scene_memory: objective, conflict, value change, blocking, visible asset ids, continuity in/out",
      "shot_memory: shot order, duration, lens grammar, action handoff, eyeline, prop flow, prompt anchors",
    ],
    qaCouncil: [
      "commercial_producer_qa: asks whether the work can attract, retain, and monetize the target audience",
      "head_writer_qa: protects story causality, promise/payoff, theme, and escalation",
      "character_editor_qa: protects motivation, voice, relationship change, and emotional truth",
      "continuity_script_supervisor_qa: protects timeline, state, props, location damage, eyeline, and match-on-action",
      "director_storyboard_qa: protects camera motivation, spatial clarity, duration, rhythm, and vertical frame readability",
      "operator_governance_qa: protects no hardcoding, no browser operations, no hidden failures, and no chat-memory-as-fact",
    ],
    antiDemoRules: [
      "Do not treat full schemas, green tests, or episode counts as proof of a good work.",
      "Do not repair a project by editing generated data to satisfy personal taste; fix general prompts, QA, schema, or workflow when a repeatable issue appears.",
      "Do not overfit to one title, episode, role name, or test fixture.",
      "When repeated QA warnings appear across episodes, summarize the systemic cause before applying repairs.",
      "One deep episode audit is allowed to expose quality classes; batch-level checks are required to protect generalization.",
    ],
  },
  longFormMemorySystem: {
    sourceOfTruth: "project.productionMemory with operatorProductionMemory as legacy fallback; scripts may execute tests but must not be the memory source.",
    purpose: "Persist and compress multi-episode story memory: plot summaries, world rules, character state, relationship stage, asset ownership, location state, forbidden contradictions, and near-episode details.",
    compressionPolicy: "System chooses detail level by task profile, episode distance, and token budget. AI operators must consume the returned window instead of deciding ad hoc how much history to read.",
    windowProfiles: Object.values(LONG_FORM_MEMORY_WINDOW_POLICIES).map((policy) => ({
      profile: policy.profile,
      exactEpisodeRadius: policy.exactEpisodeRadius,
      nearEpisodeRadius: policy.nearEpisodeRadius,
      includeSceneDetails: policy.includeSceneDetails,
      includeShotDetails: policy.includeShotDetails,
      includePhaseLedger: policy.includePhaseLedger,
      includeAssetLedger: policy.includeAssetLedger,
      rationale: policy.rationale,
    })),
    operatorApi: "GET /api/operator/projects/:projectId/long-form-memory?profile=operator|outline|episode|scene|script|storyboard|visual_prompt&episodeIds=ep-21,ep-22",
    manualModeIntegration: "PromptEditorModal continues to allow manual context selection; gatherContextOptions adds a default long-form memory context option for long-form tasks.",
  },
  assetContinuitySystem: {
    sourceOfTruth: "project.characters, project.assets, scene.breakdown asset ids, shot asset ids, and asset/character variants.",
    purpose: "Protect long-form visual continuity by reusing canonical assets across episodes and creating variants only when costume, makeup, injury, damage, location state, or prop use changes.",
    operatorApi: "GET /api/operator/projects/:projectId/asset-continuity?profile=operator|storyboard|visual_prompt|visual_generation",
    requiredBehavior: [
      "Before each episode batch, read asset continuity and reuse existing character/location/prop ids when the identity is unchanged.",
      "When visual state changes, add a variant to the existing character or asset instead of creating a duplicate asset.",
      "When a scene uses a non-default state, write scene.breakdown.assetVariantMap so storyboard and visual prompts can resolve the correct variant.",
      "Before image generation, resolve all recurringWithoutVariants and missingVariantRefs reported by asset continuity.",
    ],
    qaSignals: [
      "duplicate canonical assets",
      "missing character/location/prop refs",
      "assetVariantMap points to nonexistent variants",
      "recurring long-form assets need variants before visual generation",
    ],
  },
  productionModeSystem,
  sceneVisualPackSystem,
  productionLockSystem,
  productionPrepSystem,
  productionChangeOrderSystem,
  castingDecisionSystem,
  formalAssetPackageSystem,
  productionContinuitySystem,
  departmentAgentSystem,
  productionAgentManifestSystem,
  styleReferenceSystem,
  advancedVisualStyleLockSystem,
  storyboardStrategyDraftSystem,
  storyboardStrategyTrialSystem,
  storyboardTemplateRendererSystem,
  storyboardStrategyImpactSystem,
  productionCoordinationSystem,
  productionCockpitSystem,
  creativeChangeSystem,
  videoStoryboardSystem,
  workflowOrderSystem,
  upgradeContract: {
    mustUpdateOperatorModuleWhen: [
      "backend API routes change",
      "project/episode/scene/shot/gameData schema changes",
      "workflow stages or artifact kinds change",
      "canonical stage order, human workflow simulation, or workflow preflight behavior changes",
      "QA checks, blocking rules, retry policy, or approval rules change",
      "commercial quality ladder, memory tiers, or role-specific QA expectations change",
      "long-form memory compression/window policy or context selection behavior changes",
      "multi-episode asset continuity, variant policy, or visual reference governance changes",
      "scene visual pack, visual fingerprint, scene-level asset reuse, or model input projection behavior changes",
      "production coordination report, department handoff manifest, wrap QA, repair ticket, or circuit breaker behavior changes",
      "production cockpit read model, department workbench source data, or next action aggregation behavior changes",
      "production lock policy, script/content/block lock artifacts, or formal asset preconditions change",
      "production breakdown report, casting requirement, department prep package, or formal prep read model behavior changes",
      "series change order, targetEpisodeCount coverage, production block coverage, or re-lock/re-breakdown/re-sync behavior changes",
      "casting decision contracts, director approval, identity-board rejection, or casting workbench behavior changes",
      "formal asset package, asset identity board, scene asset variant pack, or asset variant fingerprint behavior changes",
      "continuity matrix, script supervisor continuity state, or production scheduling read model behavior changes",
      "production mode, target scale, lock strategy, visual style lock, style variant policy, or identity-board prompt catalog behavior changes",
      "style reference analysis, visual style lock candidate, style lock change order, or advanced style prompt injection behavior changes",
      "department agent taxonomy, department prep envelope, department coverage, or stage-exit coordination behavior changes",
      "production agent manifest schema, manifest registry aggregation, or agent/workflow/QA contract behavior changes",
      "storyboard strategy draft, project-local storyboard template creation, annotation legend, or storyboard strategy promotion behavior changes",
      "storyboard strategy draft trial, template renderer, or project-local template approval behavior changes",
      "storyboard strategy impact plans, bounded local reruns, or strategy provenance propagation behavior changes",
      "storyboard_board, asset_reference_pack, or video_generation_unit department prep reference behavior changes",
      "creative change request, pending asset, variant request, local resync plan, or late-stage inspiration backflow behavior changes",
      "AI video storyboard strategy, model capability profile, line-art legend, video unit, or asset reference pack behavior changes",
      "prompt templates or provider/channel configuration behavior changes",
      "asset storage, media provenance, upload, or audit paths change",
    ],
    requiredUpdateTargets: [
      "OPERATOR_HANDBOOK_VERSION",
      "doc/design.md",
      "doc/handoff.md",
      "production self-check assertions",
      "operator E2E self-check when the operation contract changes",
    ],
    documentationPolicy: "Keep only core docs as the active source of truth. Merge temporary findings into core docs, then delete the temporary file.",
  },
  apiGroups: [
    {
      id: "system",
      purpose: "health, runtime feedback, maintenance",
      routes: [
        "GET /api/health",
        "POST /api/runtime-logs",
        "POST /api/system/gc",
        "POST /api/system/backup",
      ],
    },
    {
      id: "configuration",
      purpose: "AI channel/model configuration, provider status, prompts, skills",
      routes: [
        "GET /api/provider-key-status",
        "GET /api/ai-config",
        "PUT /api/ai-config",
        "GET /api/prompts/:name",
        "PUT /api/prompts/:name",
        "GET /api/skills",
        "POST /api/skills",
        "PUT /api/skills/:id",
        "DELETE /api/skills/:id",
      ],
    },
    {
      id: "project-authority",
      purpose: "project, episode, scene, shot, interactive gameData authority tree",
      routes: [
        "GET /api/projects",
        "POST /api/projects",
        "GET /api/projects/:id",
        "PUT /api/projects/:id",
        "PATCH /api/projects/:id",
        "GET /api/projects/:id/episodes/:epId",
        "PUT /api/projects/:id/episodes/:epId",
        "DELETE /api/projects/:id/episodes/:epId",
        "DELETE /api/projects/:id",
      ],
    },
    {
      id: "production-audit",
      purpose: "traditional page mode and AutoStudio audit trail",
      routes: [
        "GET /api/production-runs",
        "GET /api/production-runs/:runId",
        "PUT /api/production-runs/:runId",
        "DELETE /api/production-runs/:runId",
      ],
    },
    {
      id: "operator",
      purpose: "external AI operation, draft/QA/commit, assets, security, capability discovery",
      routes: [
        "GET /api/operator/handbook",
        "GET /api/operator/capabilities",
        "GET /api/operator/workflows",
        "GET /api/operator/security",
        "GET /api/operator/projects/:projectId/context",
        "GET /api/operator/projects/:projectId/long-form-memory",
        "GET /api/operator/projects/:projectId/asset-continuity",
        "GET /api/operator/projects/:projectId/production-cockpit",
        "GET /api/operator/projects/:projectId/creative-changes",
        "POST /api/operator/projects/:projectId/creative-changes",
        "PATCH /api/operator/projects/:projectId/creative-changes/:artifactId",
        "POST /api/operator/projects/:projectId/style-reference-analysis",
        "POST /api/operator/projects/:projectId/style-lock-change-orders",
        "POST /api/operator/projects/:projectId/storyboard-strategy-trials",
        "POST /api/operator/projects/:projectId/storyboard-strategy-promotions",
        "POST /api/operator/projects/:projectId/role-slots",
        "POST /api/operator/projects/:projectId/casting-candidates",
        "POST /api/operator/projects/:projectId/casting-decisions",
        "POST /api/operator/projects/:projectId/legacy-production-draft",
        "POST /api/operator/qa/:check",
        "POST /api/operator/projects/:projectId/qa/:check",
        "GET /api/operator/runs",
        "GET /api/operator/runs/:runId",
        "POST /api/operator/runs",
        "PATCH /api/operator/runs/:runId",
        "POST /api/operator/runs/:runId/events",
        "GET /api/operator/artifacts",
        "GET /api/operator/artifacts/:artifactId",
        "POST /api/operator/artifacts/draft",
        "POST /api/operator/artifacts/:artifactId/qa",
        "POST /api/operator/artifacts/:artifactId/qa body={auto:true} for video storyboard artifact QA",
        "POST /api/operator/artifacts/:artifactId/commit",
        "GET /api/operator/assets",
        "POST /api/operator/assets",
      ],
    },
    {
      id: "reference-intake",
      purpose: "shot analysis, Video DNA, source-governed style references",
      routes: [
        "GET /api/video-analysis/projects",
        "POST /api/video-analysis/projects",
        "PUT /api/video-analysis/projects/:id",
        "DELETE /api/video-analysis/projects/:id",
        "POST /api/video-analysis/projects/:id/segments",
        "PUT /api/video-analysis/projects/:id/segments/:segmentId",
        "DELETE /api/video-analysis/projects/:id/segments/:segmentId",
      ],
    },
    {
      id: "media",
      purpose: "media upload/proxy plus Operator asset registration",
      routes: [
        "POST /api/assets/upload",
        "POST /api/operator/assets",
        "POST /api/operator/artifacts/draft kind=media_reference",
        "POST /api/operator/artifacts/:artifactId/commit",
      ],
    },
    {
      id: "model-proxy",
      purpose: "traditional mode model provider calls; optional for Operator mode",
      routes: [
        "POST /api/proxy/doubao",
        "POST /api/proxy/minimax",
        "POST /api/proxy/gemini",
        "POST /api/proxy/openai-compatible",
        "POST /api/proxy/openai-image",
        "POST /api/proxy/kie-grok-video",
        "POST /api/proxy/kie-grok-video/tasks",
        "GET /api/proxy/kie-grok-video/tasks/:taskId",
        "POST /api/proxy/minimax-h3-video/tasks",
        "GET /api/proxy/minimax-h3-video/tasks/:taskId",
        "POST /api/proxy/custom-bgm",
      ],
    },
  ],
  workflowCoverage: [
    {
      id: "linear-film-tv-shortdrama",
      formats: ["short-drama", "tv-series", "movie", "unit-series"],
      coverage: "covered_by_operator_api",
      stages: [
        ...workflowOrderSystem.linear.canonicalStages.map((stage) => stage.stageType),
      ],
      qualityOverlays: workflowOrderSystem.qualityOverlays
        .filter((overlay) => overlay.appliesToModes.includes("linear"))
        .map((overlay) => overlay.id),
      operatorArtifacts: [
        "project_patch",
        "episode_patch",
        "scene_patch",
        "character_patch",
        "asset_patch",
        "storyboard_shots",
        "shot_patch",
        "performance_beats",
        "storyboard_board",
        "scene_visual_pack",
        "asset_reference_pack",
        "video_generation_unit",
        "style_reference_analysis",
        "visual_style_lock_candidate",
        "style_lock_change_order",
        "storyboard_strategy_draft",
        "storyboard_strategy_draft_trial",
        "development_asset_brief",
        "script_lock_package",
        "production_block_lock",
        "production_breakdown_report",
        "continuity_matrix",
        "role_slot",
        "casting_candidate",
        "casting_requirement",
        "casting_decision",
        "department_prep_package",
        "formal_asset_package",
        "asset_identity_board",
        "scene_asset_variant_pack",
        "asset_variant_fingerprint",
        "production_coordination_report",
        "coordination_repair_ticket",
        "creative_change_request",
        "series_change_order",
        "pending_asset",
        "variant_request",
        "local_resync_plan",
        "media_reference",
      ],
      qaChecks: ["schema", "asset-refs", "script", "storyboard", "visual-prompts", "full"],
    },
    {
      id: "interactive-game",
      formats: ["interactive-fmv-game"],
      coverage: "covered_by_operator_api",
      stages: [
        ...workflowOrderSystem.interactive.canonicalStages.map((stage) => stage.stageType),
      ],
      qualityOverlays: workflowOrderSystem.qualityOverlays
        .filter((overlay) => overlay.appliesToModes.includes("interactive"))
        .map((overlay) => overlay.id),
      operatorArtifacts: [
        "project_patch for interactiveConfig",
        "episode_patch for episode.gameData",
        "scene_patch for node scene projection",
        "storyboard_shots",
        "shot_patch",
        "performance_beats",
        "storyboard_board",
        "scene_visual_pack",
        "asset_reference_pack",
        "video_generation_unit",
        "style_reference_analysis",
        "visual_style_lock_candidate",
        "style_lock_change_order",
        "storyboard_strategy_draft",
        "storyboard_strategy_draft_trial",
        "development_asset_brief",
        "content_lock_package",
        "production_block_lock",
        "production_breakdown_report",
        "continuity_matrix",
        "role_slot",
        "casting_candidate",
        "casting_requirement",
        "casting_decision",
        "department_prep_package",
        "formal_asset_package",
        "asset_identity_board",
        "scene_asset_variant_pack",
        "asset_variant_fingerprint",
        "production_coordination_report",
        "coordination_repair_ticket",
        "creative_change_request",
        "series_change_order",
        "pending_asset",
        "variant_request",
        "local_resync_plan",
        "media_reference",
      ],
      qaChecks: ["schema", "asset-refs", "script", "storyboard", "visual-prompts", "full"],
    },
    {
      id: "magic-import-adaptation",
      formats: ["novel", "outline", "script", "other"],
      coverage: "covered_by_operator_api_via_governed_artifacts",
      stages: [
        "source_intake",
        "asset_extraction",
        "beat_adaptation",
        "script_projection",
        "project_commit",
      ],
      operatorArtifacts: [
        "project_patch for adaptationData.drafts/source governance",
        "character_patch",
        "asset_patch",
        "episode_patch",
        "scene_patch",
        "style_reference_analysis",
        "visual_style_lock_candidate",
        "style_lock_change_order",
      ],
      qaChecks: ["schema", "asset-refs", "script", "full"],
    },
    {
      id: "shot-analysis-video-dna-skill",
      formats: ["reference-analysis"],
      coverage: "covered_by_backend_api",
      stages: [
        "video_analysis_project",
        "segment_analysis",
        "macro_dna",
        "beat_template_extraction",
        "skill_forge",
        "reference_routing",
      ],
      operatorArtifacts: [
        "video-analysis project/segment resources",
        "skills resources",
        "project_patch for universalSkillRefs/extractedDNAs",
        "style_reference_analysis",
        "visual_style_lock_candidate",
      ],
      qaChecks: ["source-governance via production self-check", "operator full QA after routing into a project"],
    },
  ],
  intentionallyOutOfScope: [
    "production_budget_and_scheduling",
    "post_production_workflow",
    "distribution_delivery",
  ],
  };
};
