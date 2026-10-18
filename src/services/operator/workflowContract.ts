import { getStageDefinitions } from "../production/stages";
import type { ProductionMode, ProductionStageDefinition, ProductionStageType } from "../../types/production";

const summarizeStage = (definition: ProductionStageDefinition, index: number) => ({
  order: index + 1,
  stageType: definition.stageType,
  title: definition.title,
  agentId: definition.agentId,
  artifactTypes: definition.artifactTypes,
  defaultRequiresHumanReview: definition.defaultRequiresHumanReview,
  description: definition.description,
  requiredExitGate: {
    strictQaRequired: true,
    contractQaAgentId: `qa.contract.stage.${definition.stageType}`,
    zeroBlockingIssuesRequired: true,
    humanReviewRequiredWhenConfigured: definition.defaultRequiresHumanReview,
    nextStageBlockedUntilQaPasses: true,
  },
});

const summarizeMode = (mode: ProductionMode) => ({
  mode,
  canonicalStages: getStageDefinitions(mode).map(summarizeStage),
});

export const buildOperatorWorkflowContract = () => ({
  version: "operator-workflow-order-v1",
  strictInstruction: "AI Operator must follow its canonical batch stage order. These stages do not define prerequisites for the current manual creation UI. Quality ladders and memory ledgers are preflight/gate work inside those stages, not new stages that can reorder batch production.",
  formalStageSource: {
    linear: "linearStageDefinitions",
    interactive: "interactiveStageDefinitions",
  },
  nonStageGatePolicy: {
    appliesTo: ["commercial memory", "long-form memory", "asset continuity", "quality ladder", "role QA council"],
    rule: "These gates may prepare, refresh, or validate a stage, but they must not be inserted as standalone workflow stages or used to skip the canonical previous stage.",
  },
  stageExitPolicy: {
    appliesToEveryStage: true,
    requiredBeforeNextStage: [
      "producer output exists for the current stage",
      "contract QA has run for the current stage",
      "stage-specific QA has run when the stage produces script, assets, graph, storyboard, prompts, or media plans",
      "no blocking QA issues remain",
      "manual review is approved when the stage is configured as a human gate",
      "OperatorRun or ProductionRun records the QA verdict before the next stage starts",
    ],
    operatorCommitRule: "Operator artifacts must follow draft -> QA -> commit; a committed downstream artifact cannot be used to skip QA for the current stage.",
  },
  linear: {
    ...summarizeMode("linear"),
    formats: ["short-drama", "tv-series", "movie", "unit-series"],
  },
  interactive: {
    ...summarizeMode("interactive"),
    formats: ["interactive-fmv-game"],
  },
  qualityOverlays: [
    {
      id: "commercial_brief",
      kind: "stage_gate",
      appliesToModes: ["linear", "interactive"] as ProductionMode[],
      requiredBefore: ["bible", "interactive_bible", "structure", "game_blueprint"] as ProductionStageType[],
      mustNotBecomeStandaloneStage: true,
      instruction: "商业定位是 concept/interactive_bible 前后的质量门，不能跳过 intake/concept 或替代 bible。",
    },
    {
      id: "series_or_feature_skeleton",
      kind: "stage_gate",
      appliesToModes: ["linear"] as ProductionMode[],
      requiredBefore: ["scene", "script", "storyboard", "prompt"] as ProductionStageType[],
      mustNotBecomeStandaloneStage: true,
      instruction: "作品骨架沉淀在 structure 和 productionMemory 中，不能先于 bible/asset_detail 直接拆场景。",
    },
    {
      id: "long_form_memory_refresh",
      kind: "preflight",
      appliesToModes: ["linear"] as ProductionMode[],
      requiredBefore: ["scene", "script", "storyboard", "prompt"] as ProductionStageType[],
      mustNotBecomeStandaloneStage: true,
      instruction: "长篇记忆是 scene/script/storyboard/prompt 的前置读取和 project_patch 更新，不是独立生产阶段。",
    },
    {
      id: "asset_continuity_refresh",
      kind: "preflight",
      appliesToModes: ["linear", "interactive"] as ProductionMode[],
      requiredBefore: ["storyboard", "prompt", "interactive_storyboard", "expensive_generation_planning"] as ProductionStageType[],
      mustNotBecomeStandaloneStage: true,
      instruction: "资产连续性在 asset_sync 之后、storyboard/prompt/出图之前检查；状态变化写 variants/assetVariantMap，不能打乱正式阶段顺序。",
    },
  ],
  blockingOrderRules: [
    "Do not generate bible before intake and concept are available.",
    "Do not run structure before bible and asset_detail have created usable character/location/prop assets.",
    "Do not split scenes before structure/episode plan exists.",
    "Do not write script before scenes exist.",
    "Do not run production_breakdown before script_lock or content_lock exists for the current production scope.",
    "Do not run production_asset_detail before production_breakdown, casting_requirement, and department_prep_package exist.",
    "Do not write storyboard before script and breakdown exist.",
    "Do not write storyboard before formal asset prep has either passed production_asset_detail or is explicitly marked legacy_unlocked/sample.",
    "Do not write visual prompts before storyboard shots exist.",
    "Do not execute image/video generation before visual prompts and required references pass QA.",
    "Interactive projects must create game_blueprint and graph_generation before node_to_scene, interactive_script, and interactive_storyboard.",
    "Do not advance from any stage to the next stage while the current stage has missing QA, blocking QA issues, failed artifact QA, or unresolved required human review.",
  ],
});
