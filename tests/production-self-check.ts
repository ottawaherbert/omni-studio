import assert from "node:assert/strict";
import fs from "node:fs";
import { isOpenAICompatibleTextChannelType } from "../src/config/aiConfigDefaults";
import {
  applyStageExecutionResult,
  approveCurrentStage,
  createProductionRun,
  requestRevisionForCurrentStage,
  rerunFromStage,
  retryCurrentStageWithDifferentModel,
  runContractQAForCurrentStage,
  skipCurrentStage,
} from "../src/services/production/orchestrator";
import {
  productionStageExecutorRegistry,
} from "../src/services/production/runners";
import {
  interactiveStageDefinitions,
  linearStageDefinitions,
} from "../src/services/production/stages";
import { createInitialContextPlan } from "../src/services/production/contextPlanner";
import { createGateVerdictsForStage, getGatesForStage } from "../src/services/production/gates";
import { validateProductionAgentRubrics } from "../src/services/production/rubric";
import type { ProductionDepartmentFinding, ProductionRunProjectInput } from "../src/types/production";
import { GameNode, GameProjectData } from "../src/types/game";
import { applyInteractiveProjectionSync, createInteractiveAssemblyQAReport } from "../src/utils/interactiveNodeSceneMapper";
import {
  createAIGeneratedMediaReference,
  createLegacyMediaReference,
  createMediaAssetReference,
  isTrustedReadyMediaReference,
} from "../src/utils/mediaProvenance";
import {
  buildAssetReferenceRepairPlan,
  collectAssetReferenceAudit,
  isLikelySameAssetName,
  normalizeBreakdownAssetIds,
  resolveAssetRef,
} from "../src/utils/assetRefs";
import {
  productionTemplateMetadataRegistry,
  validateProductionTemplateMetadata,
} from "../src/services/production/templateMetadata";
import {
  productionAgentRegistry,
  productionWorkflowStepRegistry,
  validateProductionAgentRegistry,
} from "../src/services/production/agents";
import { runAgentGatewayStep } from "../src/services/production/agentGateway";
import {
  inferManualWorkflowStepId,
  runManualPromptGatewayReview,
} from "../src/services/production/manualGateway";
import {
  createAssetDetailQAReports,
  createContextPlannerQAReports,
  createPromptAgentQAReports,
  createScriptAgentQAReports,
  createStoryboardAgentQAReports,
  validateLinearAssetRefs,
  validateLinearMediaProvenance,
} from "../src/services/production/linearAgents";
import {
  createRetryAttempt,
  defaultAgentRetryPolicy,
  evaluateRetryDecision,
} from "../src/services/production/retryManager";
import {
  classifyQAIssueResolution,
  normalizeProductionQAIssue,
} from "../src/services/production/qaIssue";
import {
  buildAdaptationDraftPackage,
  createSourceArtifact,
  governAnalysisSegmentResult,
  governExtractedBeatTemplate,
  governMacroDNA,
  governUniversalSkillForIntake,
  isReferenceAllowedForContext,
  routeProjectReferencesForContext,
  validateAdaptationAssets,
  validateAdaptationBeatDraft,
} from "../src/services/production/referenceGovernance";
import {
  canWaiveQAIssue,
  createQAWarningWaiver,
  expireWaiversForStaleArtifacts,
} from "../src/services/production/artifactLifecycle";
import { getImpactedStageTypes } from "../src/services/production/impact";
import {
  captureProductionAuthoritySnapshot,
  restoreProductionAuthoritySnapshot,
} from "../src/services/production/authorityTransaction";
import { useGameStore } from "../src/store/useGameStore";
import { useProjectStore } from "../src/store/useProjectStore";
import { impactedStageTypesForProjectChange } from "../src/services/production/legacyProductionRunInvalidation";
import { getProjectStage } from "../src/utils/projectUtils";
import { collectProjectAssetsForContext } from "../src/utils/projectAssetContext";
import { gatherContextOptions } from "../src/utils/contextMapper";
import {
  buildLongFormMemoryContext,
  LONG_FORM_MEMORY_WINDOW_POLICIES,
  renderLongFormMemoryForPrompt,
  validateLongFormMemoryRules,
} from "../src/services/production/longFormMemory";
import { buildAssetContinuityContext } from "../src/services/production/assetContinuity";
import {
  recommendStoryboardPromptStrategies,
  STORYBOARD_PROMPT_STRATEGIES,
  validateStoryboardStrategyDecision,
  validateVideoStoryboardSystem,
} from "../src/services/production/videoStoryboardSystem";
import {
  buildVideoStoryboardArtifactSystem,
  validateAssetReferencePack,
  validatePerformanceBeats,
  validateSceneVisualPack,
  validateStoryboardBoard,
  validateVideoGenerationUnit,
  validateVideoStoryboardPlan,
  VIDEO_STORYBOARD_ARTIFACT_CONTRACTS,
} from "../src/services/production/videoStoryboardArtifacts";
import {
  buildVideoStoryboardAssetBoardPlan,
  validateVideoStoryboardAssetBoardPlan,
} from "../src/services/production/videoStoryboardAssetBoards";
import { resolveVisualStyleLock } from "../src/services/production/visualStyleLock";
import {
  buildProductionLockStrategyDecision,
  buildProductionModeProfile,
  buildProductionModeSystem,
  resolveProductionLockStrategy,
  resolveProductionMode,
} from "../src/services/production/productionMode";
import { buildProductionStoryboardBoardDrafts } from "../src/services/production/videoStoryboardStageBoards";
import { buildProductionAssetReferencePackDrafts } from "../src/services/production/videoStoryboardPromptPacks";
import { buildProductionVideoGenerationUnitDrafts } from "../src/services/production/videoStoryboardVideoUnits";
import { buildProductionPerformanceBeatDrafts } from "../src/services/production/videoStoryboardPerformanceBeats";
import {
  buildProductionSceneVisualPackDrafts,
  createSceneVisualFingerprint,
} from "../src/services/production/videoStoryboardSceneVisualPacks";
import {
  buildDepartmentHandoffManifest,
  buildCoordinationRepairTickets,
  buildProductionDepartmentCoverage,
  buildProductionCoordinationStageGate,
  buildProductionCoordinationReport,
  buildProductionCoordinationSnapshot,
  buildProductionCoordinationWrapQA,
  runMediaReadinessCoordinationQA,
  runProductionDepartmentCoordinationQA,
  validateCoordinationRepairTickets,
  validateProductionCoordinationReport,
} from "../src/services/production/productionCoordination";
import { buildProductionCockpit } from "../src/services/production/productionCockpit";
import {
  buildCreativeChangeRequest,
  buildCreativeChangeSystem,
  validateCreativeChangeRequest,
} from "../src/services/production/creativeChange";
import {
  buildProductionLockSystem,
  buildLegacyProductionLockDraftBundle,
  validateContentLockPackage,
  validateDevelopmentAssetBrief,
  validateProductionBlockLock,
  validateScriptLockPackage,
} from "../src/services/production/productionLock";
import {
  buildProductionChangeOrderSystem,
  buildProductionSeriesGovernanceSnapshot,
  buildSeriesChangeOrder,
  validateProductionSeriesGovernanceSnapshot,
  validateSeriesChangeOrder,
} from "../src/services/production/productionChangeOrder";
import {
  buildCastingRequirements,
  buildDepartmentPrepPackages,
  buildProductionBreakdownReport,
  buildProductionPrepSystem,
  expandProductionPrepDepartment,
  validateCastingRequirements,
  validateDepartmentPrepPackages,
  validateProductionBreakdownReport,
} from "../src/services/production/productionPrep";
import { buildDepartmentAgentSystem } from "../src/services/production/departmentAgents";
import {
  buildCastingCandidates,
  buildCastingDecision,
  buildCastingDecisionSystem,
  buildRoleSlots,
  validateCastingCandidates,
  validateCastingDecision,
  validateRoleSlots,
} from "../src/services/production/productionCasting";
import {
  buildFormalAssetPackage,
  buildFormalAssetPackageSystem,
  buildSceneAssetVariantPacks,
  validateFormalAssetPackage,
  validateSceneAssetVariantPacks,
} from "../src/services/production/productionAssetPackage";
import {
  buildContinuityMatrix,
  buildProductionContinuitySystem,
  validateContinuityMatrix,
} from "../src/services/production/productionContinuity";
import { defaultTemplates } from "../src/config/prompts";
import { createSceneScopedContextSelection } from "../src/utils/sceneContextSelection";
import { resolveSceneReadModel } from "../src/utils/sceneReadModel";
import { runPhase13SelfCheck } from "./phase13-self-check";
import { getShotPacingWarning } from "../src/config/industryStandards";
import {
  areDiscoveredCharacterNamesEquivalent,
  extractScriptSceneHeadingLocationName,
  getBreakdownLocationCandidateNames,
  getScriptCharacterNameCandidates,
  inferDiscoveredCharacterRoleType,
  isEphemeralBreakdownPropName,
  normalizeScriptCharacterCueName,
  normalizeTemporaryCharacterStateName,
  plannedCharacterCoversDiscoveredName,
} from "../src/utils/breakdownAssets";
import {
  validateAssetRules,
  validateConceptRules,
  validateContextPlanRules,
  validateFormatSpecificRules,
  validateGameDataRules,
  validateInteractiveProjectionRules,
  validatePromptRules,
  validateSceneRules,
  validateStoryboardRules,
} from "../src/services/production/ruleQa";
import {
  buildOperatorProjectContext,
  extractOperatorHandbookVersion,
} from "../src/services/operator/context";
import { buildOperatorWorkflowContract } from "../src/services/operator/workflowContract";
import {
  appendOperatorEvent,
  createOperatorRunRecord,
  mergeOperatorRunPatch,
} from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import {
  appendOperatorArtifactQAVerdict,
  createOperatorArtifact,
  createOperatorRegisteredAsset,
  isOperatorArtifactApproved,
} from "../src/services/operator/artifacts";
import { commitOperatorArtifactToProject } from "../src/services/operator/commit";
import { runOperatorArtifactQA, runOperatorQA } from "../src/services/operator/qa";
import {
  assertOperatorProjectAllowed,
  assertOperatorTokenAuthorized,
  createOperatorSecurityPolicy,
  extractOperatorTokenFromHeaders,
  summarizeOperatorSecurityPolicy,
} from "../src/services/operator/security";
import {
  buildOperatorCapabilityManifest,
  OPERATOR_CORE_DOCUMENTS,
} from "../src/services/operator/capabilities";

const selfCheckStartedAt = Date.now();
const reportSelfCheckProgress = (stage: string) => {
  const elapsedSeconds = ((Date.now() - selfCheckStartedAt) / 1000).toFixed(1);
  console.log(`[production-self-check] ${stage} (${elapsedSeconds}s)`);
};

reportSelfCheckProgress("modules loaded");

const project: ProductionRunProjectInput = {
  id: "project-self-check",
  title: "Production Self Check",
  projectModel: "linear",
  type: "movie",
  originalInspiration: "一个导演用自动制片系统完成短片开发。",
  refinedInspiration: "",
  universalSkillRefs: [],
};

function assertOperatorRouteSourceContracts(
  serverSource: string,
  legacyProjectRoutesSource: string,
  operatorMetadataRoutesSource: string,
  operatorArtifactRoutesSource: string,
  operatorArtifactUseCasesSource: string,
  operatorAssetRoutesSource: string,
  operatorAssetUseCasesSource: string,
  operatorCreativeChangeRoutesSource: string,
  operatorCreativeChangeUseCasesSource: string,
  operatorStyleReferenceRoutesSource: string,
  operatorStyleReferenceUseCasesSource: string,
  operatorStoryboardStrategyRoutesSource: string,
  operatorStoryboardStrategyUseCasesSource: string,
  operatorCastingRoutesSource: string,
  operatorCastingUseCasesSource: string,
  operatorProjectContextRoutesSource: string,
  operatorProjectContextUseCasesSource: string,
  operatorProductionCockpitRoutesSource: string,
  operatorProductionCockpitUseCasesSource: string,
  operatorLegacyProductionDraftRoutesSource: string,
  operatorLegacyProductionDraftUseCasesSource: string,
  operatorQARoutesSource: string,
  operatorQAUseCasesSource: string,
  operatorRunRoutesSource: string,
  operatorRunUseCasesSource: string,
) {
  assert.ok(serverSource.includes("registerOperatorMetadataRoutes"));
  assert.ok(serverSource.includes("registerOperatorProjectContextRoutes"));
  assert.ok(serverSource.includes("registerOperatorProductionCockpitRoutes"));
  assert.ok(serverSource.includes("registerOperatorArtifactRoutes"));
  assert.ok(serverSource.includes("registerOperatorAssetRoutes"));
  assert.ok(serverSource.includes("registerOperatorCreativeChangeRoutes"));
  assert.ok(serverSource.includes("registerOperatorStyleReferenceRoutes"));
  assert.ok(serverSource.includes("registerOperatorStoryboardStrategyRoutes"));
  assert.ok(serverSource.includes("registerOperatorCastingRoutes"));
  assert.ok(serverSource.includes("registerOperatorLegacyProductionDraftRoutes"));
  assert.ok(serverSource.includes("registerOperatorQARoutes"));
  assert.ok(serverSource.includes("registerOperatorRunRoutes"));
  assert.ok(operatorMetadataRoutesSource.includes("readOperatorHandbookFromPath"));
  assert.ok(operatorMetadataRoutesSource.includes("/api/operator/handbook"));
  assert.ok(operatorMetadataRoutesSource.includes("/api/operator/capabilities"));
  assert.ok(operatorMetadataRoutesSource.includes("/api/operator/workflows"));
  assert.ok(operatorMetadataRoutesSource.includes("/api/operator/security"));
  assert.ok(operatorMetadataRoutesSource.includes("buildOperatorCapabilityManifest"));
  assert.ok(operatorMetadataRoutesSource.includes("buildOperatorWorkflowContract"));
  assert.ok(operatorMetadataRoutesSource.includes("summarizeOperatorSecurityPolicy"));
  assert.ok(operatorArtifactRoutesSource.includes("/api/operator/artifacts"));
  assert.ok(operatorArtifactRoutesSource.includes("/api/operator/artifacts/draft"));
  assert.ok(operatorArtifactRoutesSource.includes("/api/operator/artifacts/:artifactId/qa"));
  assert.ok(operatorArtifactRoutesSource.includes("/api/operator/artifacts/:artifactId/commit"));
  assert.ok(operatorArtifactRoutesSource.includes("runOperatorArtifactQAForAccess"));
  assert.ok(operatorArtifactUseCasesSource.includes("createOperatorDraftArtifactForAccess"));
  assert.ok(operatorArtifactUseCasesSource.includes("runOperatorArtifactQAForAccess"));
  assert.ok(operatorArtifactUseCasesSource.includes("commitOperatorArtifactForAccess"));
  assert.ok(operatorArtifactUseCasesSource.includes("commitOperatorArtifactToProject"));
  assert.ok(operatorArtifactUseCasesSource.includes("createOperatorArtifact"));
  assert.ok(operatorAssetRoutesSource.includes("/api/operator/assets"));
  assert.ok(operatorAssetRoutesSource.includes("listOperatorAssetsForAccess"));
  assert.ok(operatorAssetRoutesSource.includes("registerOperatorAssetForAccess"));
  assert.ok(operatorAssetUseCasesSource.includes("listOperatorAssetsForAccess"));
  assert.ok(operatorAssetUseCasesSource.includes("registerOperatorAssetForAccess"));
  assert.ok(operatorAssetUseCasesSource.includes("saveOperatorAsset"));
  assert.ok(operatorAssetUseCasesSource.includes("appendOperatorRunEvent"));
  assert.ok(operatorCreativeChangeRoutesSource.includes("/api/operator/projects/:projectId/creative-changes"));
  assert.ok(operatorCreativeChangeRoutesSource.includes("/api/operator/projects/:projectId/creative-changes/:artifactId"));
  assert.ok(operatorCreativeChangeRoutesSource.includes("listCreativeChangesForProject"));
  assert.ok(operatorCreativeChangeRoutesSource.includes("createCreativeChangeForProject"));
  assert.ok(operatorCreativeChangeRoutesSource.includes("updateCreativeChangeForProject"));
  assert.ok(operatorCreativeChangeUseCasesSource.includes("buildCreativeChangeRequest"));
  assert.ok(operatorCreativeChangeUseCasesSource.includes("getCreativeChangeFormalDeliveryBlockers"));
  assert.ok(operatorCreativeChangeUseCasesSource.includes("runOperatorArtifactQA"));
  assert.ok(operatorCreativeChangeUseCasesSource.includes("createOperatorRunRecord"));
  assert.ok(operatorStyleReferenceRoutesSource.includes("/api/operator/projects/:projectId/style-reference-analysis"));
  assert.ok(operatorStyleReferenceRoutesSource.includes("/api/operator/projects/:projectId/style-lock-change-orders"));
  assert.ok(operatorStyleReferenceRoutesSource.includes("createStyleReferenceAnalysisForProject"));
  assert.ok(operatorStyleReferenceRoutesSource.includes("createStyleLockChangeOrderForProject"));
  assert.ok(operatorStyleReferenceUseCasesSource.includes("buildStyleReferenceAnalysis"));
  assert.ok(operatorStyleReferenceUseCasesSource.includes("buildVisualStyleLockCandidateFromAnalysis"));
  assert.ok(operatorStyleReferenceUseCasesSource.includes("buildStyleLockChangeOrderFromCandidate"));
  assert.ok(operatorStyleReferenceUseCasesSource.includes("commitOperatorArtifactToProject"));
  assert.ok(operatorStoryboardStrategyRoutesSource.includes("/api/operator/projects/:projectId/storyboard-strategy-trials"));
  assert.ok(operatorStoryboardStrategyRoutesSource.includes("/api/operator/projects/:projectId/storyboard-strategy-promotions"));
  assert.ok(operatorStoryboardStrategyRoutesSource.includes("createStoryboardStrategyTrialForProject"));
  assert.ok(operatorStoryboardStrategyRoutesSource.includes("createStoryboardStrategyPromotionForProject"));
  assert.ok(operatorStoryboardStrategyUseCasesSource.includes("buildStoryboardStrategyDraftTrial"));
  assert.ok(operatorStoryboardStrategyUseCasesSource.includes("isOperatorArtifactApproved"));
  assert.ok(operatorStoryboardStrategyUseCasesSource.includes("storyboard_strategy_draft_trial"));
  assert.ok(operatorCastingRoutesSource.includes("/api/operator/projects/:projectId/role-slots"));
  assert.ok(operatorCastingRoutesSource.includes("/api/operator/projects/:projectId/casting-candidates"));
  assert.ok(operatorCastingRoutesSource.includes("/api/operator/projects/:projectId/casting-decisions"));
  assert.ok(operatorCastingRoutesSource.includes("createRoleSlotsForProject"));
  assert.ok(operatorCastingRoutesSource.includes("createCastingCandidatesForProject"));
  assert.ok(operatorCastingRoutesSource.includes("createCastingDecisionForProject"));
  assert.ok(operatorCastingUseCasesSource.includes("buildRoleSlots"));
  assert.ok(operatorCastingUseCasesSource.includes("buildCastingCandidates"));
  assert.ok(operatorCastingUseCasesSource.includes("buildCastingDecision"));
  assert.ok(operatorCastingUseCasesSource.includes("casting_requirement"));
  assert.ok(operatorProjectContextRoutesSource.includes("/api/operator/projects/:projectId/context"));
  assert.ok(operatorProjectContextRoutesSource.includes("/api/operator/projects/:projectId/long-form-memory"));
  assert.ok(operatorProjectContextRoutesSource.includes("/api/operator/projects/:projectId/asset-continuity"));
  assert.ok(operatorProjectContextRoutesSource.includes("readOperatorProjectContextForAccess"));
  assert.ok(operatorProjectContextRoutesSource.includes("readLongFormMemoryForAccess"));
  assert.ok(operatorProjectContextRoutesSource.includes("readAssetContinuityForAccess"));
  assert.ok(operatorProjectContextUseCasesSource.includes("buildOperatorProjectContext"));
  assert.ok(operatorProjectContextUseCasesSource.includes("buildLongFormMemoryContext"));
  assert.ok(operatorProjectContextUseCasesSource.includes("buildAssetContinuityContext"));
  assert.ok(operatorProductionCockpitRoutesSource.includes("/api/operator/projects/:projectId/production-cockpit"));
  assert.ok(operatorProductionCockpitRoutesSource.includes("readProductionCockpitForAccess"));
  assert.ok(operatorProductionCockpitUseCasesSource.includes("buildProductionCockpit"));
  assert.ok(operatorProductionCockpitUseCasesSource.includes("resolveProductionCockpitEnvironment"));
  assert.ok(operatorLegacyProductionDraftRoutesSource.includes("/api/operator/projects/:projectId/legacy-production-draft"));
  assert.ok(operatorLegacyProductionDraftRoutesSource.includes("createLegacyProductionDraftForProject"));
  assert.ok(operatorLegacyProductionDraftUseCasesSource.includes("buildLegacyProductionLockDraftBundle"));
  assert.ok(operatorLegacyProductionDraftUseCasesSource.includes("buildProductionBreakdownReport"));
  assert.ok(operatorLegacyProductionDraftUseCasesSource.includes("runOperatorArtifactQA"));
  assert.ok(operatorQARoutesSource.includes("/api/operator/qa/:check"));
  assert.ok(operatorQARoutesSource.includes("/api/operator/projects/:projectId/qa/:check"));
  assert.ok(operatorQARoutesSource.includes("runOperatorQAForAccess"));
  assert.ok(operatorQAUseCasesSource.includes("runOperatorQA"));
  assert.ok(operatorQAUseCasesSource.includes("summarizeOperatorQAVerdict"));
  assert.ok(operatorRunRoutesSource.includes("/api/operator/runs"));
  assert.ok(operatorRunRoutesSource.includes("/api/operator/runs/:runId"));
  assert.ok(operatorRunRoutesSource.includes("/api/operator/runs/:runId/events"));
  assert.ok(operatorRunRoutesSource.includes("createOperatorRunForAccess"));
  assert.ok(operatorRunUseCasesSource.includes("createOperatorRunRecord"));
  assert.ok(operatorRunUseCasesSource.includes("appendOperatorRunEventForAccess"));
  assert.ok(legacyProjectRoutesSource.includes("withProjectProductionDefaults"));
  assert.ok(legacyProjectRoutesSource.includes("resolveProductionMode"));
  assert.ok(serverSource.includes("OMNI_OPERATOR_API_TOKEN"));
  assert.ok(serverSource.includes("OMNI_OPERATOR_ALLOWED_PROJECT_IDS"));
  assert.ok(serverSource.includes("assertOperatorProjectAccess"));
  assert.ok(serverSource.includes("app.use(\"/api/operator\""));
}

reportSelfCheckProgress("checking source contracts");
const aiServiceSource = fs.readFileSync(new URL("../src/services/ai.ts", import.meta.url), "utf-8");
assert.ok(aiServiceSource.includes("/api/proxy/openai-image"));
assert.equal(aiServiceSource.includes("dangerouslyAllowBrowser"), false);
assert.equal(aiServiceSource.includes("new OpenAI"), false);
assert.equal(isOpenAICompatibleTextChannelType("openai"), true);
assert.equal(isOpenAICompatibleTextChannelType("deepseek"), true);
assert.equal(isOpenAICompatibleTextChannelType("doubao"), true);
assert.equal(isOpenAICompatibleTextChannelType("kie"), true);
assert.equal(isOpenAICompatibleTextChannelType("llamacpp"), true);
assert.equal(isOpenAICompatibleTextChannelType("gemini"), false);
const openAICompatibleTextStart = aiServiceSource.indexOf("if (isOpenAICompatibleTextChannelType(channel.type))");
const geminiTextStart = aiServiceSource.indexOf("} else if (channel.type === 'gemini')", openAICompatibleTextStart);
assert.ok(openAICompatibleTextStart >= 0, "OpenAI-compatible text branch should exist.");
assert.ok(geminiTextStart > openAICompatibleTextStart, "Gemini branch should follow OpenAI-compatible text branch.");
const openAICompatibleTextBranch = aiServiceSource.slice(openAICompatibleTextStart, geminiTextStart);
assert.ok(openAICompatibleTextBranch.includes("/api/proxy/openai-compatible"));
const minimaxTextStart = aiServiceSource.indexOf("} else if (channel.type === 'minimax')");
const unsupportedTextStart = aiServiceSource.indexOf("} else {\n    throw new Error(`Unsupported channel type for text generation", minimaxTextStart);
assert.ok(minimaxTextStart >= 0, "MiniMax text branch should exist.");
assert.ok(unsupportedTextStart > minimaxTextStart, "Unsupported channel branch should follow MiniMax text branch.");
const minimaxTextBranch = aiServiceSource.slice(minimaxTextStart, unsupportedTextStart);
assert.ok(minimaxTextBranch.includes("/api/proxy/minimax"));
assert.equal(minimaxTextBranch.includes("new Anthropic"), false);
assert.ok(aiServiceSource.includes("/api/proxy/gemini"));
assert.equal(aiServiceSource.includes("new GoogleGenAI"), false);
assert.equal(aiServiceSource.includes("x-goog-api-key"), false);
assert.ok(aiServiceSource.includes("/api/proxy/custom-bgm"));
assert.equal(aiServiceSource.includes("fetch(settings.customApiUrl"), false);
assert.ok(aiServiceSource.includes("ensureCustomBgmServerEnvKeyAvailable"));
assert.ok(aiServiceSource.includes("apiKeyEnvName"));
assert.ok(aiServiceSource.includes("resolveClientApiKey"));
assert.ok(aiServiceSource.includes("ensureServerEnvKeyAvailable"));
assert.ok(aiServiceSource.includes("/api/provider-key-status"));
assert.ok(aiServiceSource.includes("ensureAIConfigHydrated"));
assert.equal(aiServiceSource.includes("process.env."), false);
const aiConfigStoreSource = fs.readFileSync(new URL("../src/store/useAIConfigStore.ts", import.meta.url), "utf-8");
const aiConfigClientSource = fs.readFileSync(new URL("../apps/web/src/clients/aiConfigClient.ts", import.meta.url), "utf-8");
assert.ok(aiConfigClientSource.includes("/api/ai-config"));
assert.ok(aiConfigStoreSource.includes("hydrate"));
assert.equal(aiConfigStoreSource.includes("persist("), false);
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.ok(appSource.includes("readActiveProjectId"));
assert.ok(appSource.includes("shouldRestoreActiveProject"));
const activeProjectStorageSource = fs.readFileSync(new URL("../src/utils/activeProjectStorage.ts", import.meta.url), "utf-8");
assert.ok(activeProjectStorageSource.includes("writeActiveEpisodeId"));
assert.ok(activeProjectStorageSource.includes("readActiveEpisodeId"));
const projectSliceSource = fs.readFileSync(new URL("../src/store/slices/projectSlice.ts", import.meta.url), "utf-8");
assert.ok(projectSliceSource.includes("writeActiveProjectId(newProject.id)"));
assert.ok(projectSliceSource.includes("writeActiveProjectId(data.id)"));
assert.ok(projectSliceSource.includes("clearActiveProjectId(id)"));
assert.ok(projectSliceSource.includes("readActiveEpisodeId(data.id)"));
assert.ok(projectSliceSource.includes("中文多视图角色设定图"));
assert.ok(projectSliceSource.includes("ensureProductionMetadata"));
assert.ok(projectSliceSource.includes("resolveProductionMode"));
assert.ok(projectSliceSource.includes("createDefaultTargetScale"));
assert.equal(projectSliceSource.includes("Cinematic character portrait"), false);

const productionModeSource = fs.readFileSync(new URL("../packages/production/src/services/production/productionMode.ts", import.meta.url), "utf-8");
assert.ok(productionModeSource.includes("production-lock-strategy-decision.v1"));
assert.ok(productionModeSource.includes("current_block_only must never be rendered as full-series ready"));
const episodeSliceSource = fs.readFileSync(new URL("../src/store/slices/episodeSlice.ts", import.meta.url), "utf-8");
assert.ok(episodeSliceSource.includes("writeActiveEpisodeId(currentProject.id, id)"));
const serverSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf-8");
const aiConfigRoutesSource = fs.readFileSync(new URL("../src/server/routes/aiConfigRoutes.ts", import.meta.url), "utf-8");
const legacyProjectRoutesSource = fs.readFileSync(new URL("../src/server/routes/legacyProjectRoutes.ts", import.meta.url), "utf-8");
const providerProxyRoutesSource = fs.readFileSync(new URL("../src/server/routes/providerProxyRoutes.ts", import.meta.url), "utf-8");
const providerProxyUtilsSource = fs.readFileSync(new URL("../src/server/routes/providerProxyUtils.ts", import.meta.url), "utf-8");
const operatorMetadataRoutesSource = fs.readFileSync(new URL("../src/server/operatorMetadataRoutes.ts", import.meta.url), "utf-8");
const operatorArtifactRoutesSource = fs.readFileSync(new URL("../src/server/operatorArtifactRoutes.ts", import.meta.url), "utf-8");
const operatorArtifactUseCasesSource = fs.readFileSync(new URL("../src/services/operator/artifactUseCases.ts", import.meta.url), "utf-8");
const operatorAssetRoutesSource = fs.readFileSync(new URL("../src/server/operatorAssetRoutes.ts", import.meta.url), "utf-8");
const operatorAssetUseCasesSource = fs.readFileSync(new URL("../src/services/operator/assetUseCases.ts", import.meta.url), "utf-8");
const operatorCreativeChangeRoutesSource = fs.readFileSync(new URL("../src/server/operatorCreativeChangeRoutes.ts", import.meta.url), "utf-8");
const operatorCreativeChangeUseCasesSource = fs.readFileSync(new URL("../src/services/operator/creativeChangeUseCases.ts", import.meta.url), "utf-8");
const operatorStyleReferenceRoutesSource = fs.readFileSync(new URL("../src/server/operatorStyleReferenceRoutes.ts", import.meta.url), "utf-8");
const operatorStyleReferenceUseCasesSource = fs.readFileSync(new URL("../src/services/operator/styleReferenceUseCases.ts", import.meta.url), "utf-8");
const operatorStoryboardStrategyRoutesSource = fs.readFileSync(new URL("../src/server/operatorStoryboardStrategyRoutes.ts", import.meta.url), "utf-8");
const operatorStoryboardStrategyUseCasesSource = fs.readFileSync(new URL("../src/services/operator/storyboardStrategyUseCases.ts", import.meta.url), "utf-8");
const operatorCastingRoutesSource = fs.readFileSync(new URL("../src/server/operatorCastingRoutes.ts", import.meta.url), "utf-8");
const operatorCastingUseCasesSource = fs.readFileSync(new URL("../src/services/operator/castingUseCases.ts", import.meta.url), "utf-8");
const operatorProjectContextRoutesSource = fs.readFileSync(new URL("../src/server/operatorProjectContextRoutes.ts", import.meta.url), "utf-8");
const operatorProjectContextUseCasesSource = fs.readFileSync(new URL("../src/services/operator/projectContextUseCases.ts", import.meta.url), "utf-8");
const operatorProductionCockpitRoutesSource = fs.readFileSync(new URL("../src/server/operatorProductionCockpitRoutes.ts", import.meta.url), "utf-8");
const operatorProductionCockpitUseCasesSource = fs.readFileSync(new URL("../src/services/operator/productionCockpitUseCases.ts", import.meta.url), "utf-8");
const operatorLegacyProductionDraftRoutesSource = fs.readFileSync(new URL("../src/server/operatorLegacyProductionDraftRoutes.ts", import.meta.url), "utf-8");
const operatorLegacyProductionDraftUseCasesSource = fs.readFileSync(new URL("../src/services/operator/legacyProductionDraftUseCases.ts", import.meta.url), "utf-8");
const operatorQARoutesSource = fs.readFileSync(new URL("../src/server/operatorQARoutes.ts", import.meta.url), "utf-8");
const operatorQAUseCasesSource = fs.readFileSync(new URL("../src/services/operator/qaUseCases.ts", import.meta.url), "utf-8");
const operatorRunRoutesSource = fs.readFileSync(new URL("../src/server/operatorRunRoutes.ts", import.meta.url), "utf-8");
const operatorRunUseCasesSource = fs.readFileSync(new URL("../src/services/operator/runUseCases.ts", import.meta.url), "utf-8");
assert.ok(serverSource.includes("registerAiConfigRoutes(app"));
assert.ok(aiConfigRoutesSource.includes("/api/provider-key-status"));
assert.ok(aiConfigRoutesSource.includes("/api/ai-config"));
assertOperatorRouteSourceContracts(
  serverSource,
  legacyProjectRoutesSource,
  operatorMetadataRoutesSource,
  operatorArtifactRoutesSource,
  operatorArtifactUseCasesSource,
  operatorAssetRoutesSource,
  operatorAssetUseCasesSource,
  operatorCreativeChangeRoutesSource,
  operatorCreativeChangeUseCasesSource,
  operatorStyleReferenceRoutesSource,
  operatorStyleReferenceUseCasesSource,
  operatorStoryboardStrategyRoutesSource,
  operatorStoryboardStrategyUseCasesSource,
  operatorCastingRoutesSource,
  operatorCastingUseCasesSource,
  operatorProjectContextRoutesSource,
  operatorProjectContextUseCasesSource,
  operatorProductionCockpitRoutesSource,
  operatorProductionCockpitUseCasesSource,
  operatorLegacyProductionDraftRoutesSource,
  operatorLegacyProductionDraftUseCasesSource,
  operatorQARoutesSource,
  operatorQAUseCasesSource,
  operatorRunRoutesSource,
  operatorRunUseCasesSource,
);
assert.ok(serverSource.includes("registerProviderProxyRoutes(app"));
assert.ok(providerProxyUtilsSource.includes("MINIMAX_API_KEY"));
assert.ok(providerProxyUtilsSource.includes("OMNI_CUSTOM_BGM_API_KEY"));
assert.ok(providerProxyUtilsSource.includes("normalizeCustomBgmEnvName"));
assert.ok(providerProxyUtilsSource.includes("OMNI_CUSTOM_BGM_ALLOWED_ORIGINS"));
assert.ok(providerProxyUtilsSource.includes("normalizeCustomBgmProviderUrl"));
assert.ok(providerProxyUtilsSource.includes("normalizeCustomBgmModelId"));
assert.ok(providerProxyUtilsSource.includes("redactProxyText"));
assert.ok(providerProxyUtilsSource.includes("providerFailureSummary"));
assert.ok(providerProxyRoutesSource.includes("providerFailureSummary"));
assert.equal(providerProxyRoutesSource.includes("Doubao Proxy System Error:\", err"), false);
assert.equal(providerProxyRoutesSource.includes("MiniMax Proxy Error:\", err"), false);
assert.equal(providerProxyRoutesSource.includes("Gemini proxy error for action ${action}:\", err"), false);
const dbSource = fs.readFileSync(new URL("../src/server/db.ts", import.meta.url), "utf-8");
assert.ok(dbSource.includes("CREATE TABLE IF NOT EXISTS operator_runs"));
assert.ok(dbSource.includes("CREATE TABLE IF NOT EXISTS operator_artifacts"));
assert.ok(dbSource.includes("CREATE TABLE IF NOT EXISTS operator_assets"));
assert.ok(dbSource.includes("listOperatorRuns"));
assert.ok(dbSource.includes("appendOperatorRunEvent"));
assert.ok(dbSource.includes("appendOperatorArtifactQA"));
assert.ok(dbSource.includes("saveOperatorAsset"));
const operatorHandbookSource = fs.readFileSync(new URL("../doc/design.md", import.meta.url), "utf-8");
assert.equal(extractOperatorHandbookVersion(operatorHandbookSource), OPERATOR_HANDBOOK_VERSION);
const readmeSource = fs.readFileSync(new URL("../README.md", import.meta.url), "utf-8");
for (const coreDoc of OPERATOR_CORE_DOCUMENTS) {
  assert.ok(
    coreDoc === "README.md" || readmeSource.includes(coreDoc),
    `README should link active core doc: ${coreDoc}`,
  );
}
reportSelfCheckProgress("checking capability manifest");
const capabilityManifest = buildOperatorCapabilityManifest();
assert.equal(capabilityManifest.handbookVersion, OPERATOR_HANDBOOK_VERSION);
assert.equal(capabilityManifest.operationPolicy.mode, "backend_api_only");
assert.equal(capabilityManifest.storyboardStrategyImpactSystem.schemaVersion, "storyboard-strategy-impact-system.v1");
assert.equal(capabilityManifest.storyboardStrategyImpactSystem.builderFunction, "buildStoryboardStrategyImpactPlan");
assert.ok(capabilityManifest.storyboardStrategyImpactSystem.requiredBehavior.some((rule) => rule.includes("automaticRetryBudget=0")));
assert.equal(capabilityManifest.premiumProductionSystem.mission.includes("commercial-grade production work"), true);
assert.ok(capabilityManifest.premiumProductionSystem.qualityLadder.some((step) => step.id === "commercial_brief"));
assert.ok(capabilityManifest.premiumProductionSystem.qualityLadder.some((step) => step.id === "continuity_ledger"));
const canonicalStageTypeSet = new Set<string>(
  [...linearStageDefinitions, ...interactiveStageDefinitions].map((stage) => stage.stageType),
);
for (const qualityStep of capabilityManifest.premiumProductionSystem.qualityLadder) {
  for (const stageType of qualityStep.requiredBefore) {
    assert.ok(
      canonicalStageTypeSet.has(stageType),
      `premium quality gate ${qualityStep.id} must point to canonical stageType, got ${stageType}`,
    );
  }
}
assert.ok(capabilityManifest.premiumProductionSystem.memoryTiers.some((tier) => tier.includes("skeleton_memory")));
assert.ok(capabilityManifest.premiumProductionSystem.qaCouncil.some((qa) => qa.includes("commercial_producer_qa")));
assert.ok(capabilityManifest.premiumProductionSystem.antiDemoRules.some((rule) => rule.includes("green tests")));
assert.equal(capabilityManifest.longFormMemorySystem.compressionPolicy.includes("System chooses detail level"), true);
assert.ok(capabilityManifest.longFormMemorySystem.windowProfiles.some((profile) => profile.profile === "script" && profile.includeSceneDetails));
assert.ok(capabilityManifest.longFormMemorySystem.windowProfiles.some((profile) => profile.profile === "visual_prompt" && profile.includeShotDetails));
assert.ok(capabilityManifest.longFormMemorySystem.operatorApi.includes("long-form-memory"));
assert.ok(capabilityManifest.assetContinuitySystem.operatorApi.includes("asset-continuity"));
assert.ok(capabilityManifest.assetContinuitySystem.requiredBehavior.some((rule) => rule.includes("assetVariantMap")));
assert.equal(capabilityManifest.sceneVisualPackSystem.artifactKind, "scene_visual_pack");
assert.equal(capabilityManifest.sceneVisualPackSystem.stage, "asset_sync");
assert.equal(capabilityManifest.sceneVisualPackSystem.qaFunction, "validateSceneVisualPack");
assert.ok(capabilityManifest.sceneVisualPackSystem.reusePolicy.some((rule) => rule.includes("visualFingerprint")));
assert.equal(capabilityManifest.productionModeSystem.schemaVersion, "production-mode-system.v1");
assert.equal(capabilityManifest.productionModeSystem.status, "production_mode_and_style_lock_contract_available");
assert.ok(capabilityManifest.productionModeSystem.projectFields.includes("productionMode"));
assert.ok(capabilityManifest.productionModeSystem.projectFields.includes("targetScale"));
assert.ok(capabilityManifest.productionModeSystem.projectFields.includes("lockStrategy"));
assert.ok(capabilityManifest.productionModeSystem.projectFields.includes("visualStyleLock"));
assert.ok(capabilityManifest.productionModeSystem.projectFields.includes("styleVariantPolicy"));
assert.ok(capabilityManifest.productionModeSystem.productionModes.some((mode) => mode.mode === "movie" && mode.defaultLockStrategy === "full_script"));
assert.ok(capabilityManifest.productionModeSystem.productionModes.some((mode) => mode.mode === "interactive" && mode.allowedLockStrategies.includes("node_block")));
assert.equal(capabilityManifest.productionModeSystem.lockStrategyDecisionSystem.schemaVersion, "production-lock-strategy-decision.v1");
assert.equal(capabilityManifest.productionModeSystem.lockStrategyDecisionSystem.builderFunction, "buildProductionLockStrategyDecision");
assert.ok(capabilityManifest.productionModeSystem.lockStrategyDecisionSystem.readinessRule.includes("current_block_only"));
assert.ok(capabilityManifest.productionModeSystem.styleLockPolicy.promptCatalogRule.includes("visualStyleLock"));
assert.equal(buildProductionModeSystem().projectFields.includes("lockStrategy"), true);
assert.equal(resolveProductionMode({ projectModel: "interactive", type: "movie" } as any), "interactive");
assert.equal(resolveProductionLockStrategy({ type: "tv-series" } as any), "episode_block");
assert.equal(resolveProductionLockStrategy({ type: "micro-short-drama" } as any), "full_script");
const sampleProductionModeProfile = buildProductionModeProfile({
  type: "short-drama",
  targetEpisodeCount: 100,
  visualStyleLock: { renderingMode: "comic", stylePrompt: "竖屏漫画短剧" },
} as any);
assert.equal(sampleProductionModeProfile.productionMode, "short-drama");
assert.equal(sampleProductionModeProfile.targetScale.episodeCount, 100);
assert.equal(sampleProductionModeProfile.lockStrategy, "episode_block");
assert.equal(sampleProductionModeProfile.visualStyleLockStatus, "locked_or_seeded");
const hundredEpisodeLockDecision = buildProductionLockStrategyDecision({
  type: "short-drama",
  productionMode: "short-drama",
  targetEpisodeCount: 100,
  targetScale: { label: "short-drama-season", episodeCount: 100, productionBlockSize: 10 },
  lockStrategy: "episode_block",
} as any);
assert.equal(hundredEpisodeLockDecision.schemaVersion, "production-lock-strategy-decision.v1");
assert.equal(hundredEpisodeLockDecision.selectedStrategy, "episode_block");
assert.equal(hundredEpisodeLockDecision.selectedReadinessScope, "current_block_only");
assert.ok(hundredEpisodeLockDecision.blockLabel.includes("10"));
assert.ok(hundredEpisodeLockDecision.currentBlockReadyRule.includes("当前 production block ready"));
assert.ok(hundredEpisodeLockDecision.fullSeriesReadyRule.includes("full-series ready"));
const fullSeriesLockDecision = buildProductionLockStrategyDecision({
  type: "tv-series",
  productionMode: "tv-series",
  targetEpisodeCount: 12,
  targetScale: { label: "series", episodeCount: 12, productionBlockSize: 12 },
  lockStrategy: "full_series",
} as any);
assert.equal(fullSeriesLockDecision.selectedReadinessScope, "full_project_ready");
assert.equal(capabilityManifest.productionLockSystem.schemaVersion, "production-lock-system.v1");
assert.equal(capabilityManifest.productionLockSystem.status, "production_lock_contract_stage_integrated");
assert.deepEqual(
  buildProductionLockSystem().artifactKinds,
  ["development_asset_brief", "script_lock_package", "content_lock_package", "production_block_lock"],
);
assert.ok(capabilityManifest.productionLockSystem.artifactKinds.includes("development_asset_brief"));
assert.ok(capabilityManifest.productionLockSystem.artifactKinds.includes("script_lock_package"));
assert.ok(capabilityManifest.productionLockSystem.artifactKinds.includes("content_lock_package"));
assert.ok(capabilityManifest.productionLockSystem.artifactKinds.includes("production_block_lock"));
assert.ok(capabilityManifest.productionLockSystem.modePolicies.some((policy) => policy.format === "movie" && policy.formalAssetPrecondition.includes("full_script")));
assert.ok(capabilityManifest.productionLockSystem.modePolicies.some((policy) => policy.format === "tv-series" && policy.rollingProduction === "block_lock_allowed"));
assert.ok(capabilityManifest.productionLockSystem.modePolicies.some((policy) => policy.format === "interactive" && policy.requiredLockArtifacts.includes("content_lock_package")));
assert.ok(capabilityManifest.productionLockSystem.formalAssetPreconditions["short-drama"].includes("production block"));
assert.ok(capabilityManifest.productionLockSystem.qaFunctions.includes("validateScriptLockPackage"));
assert.ok(capabilityManifest.productionLockSystem.qaFunctions.includes("validateContentLockPackage"));
assert.ok(capabilityManifest.productionLockSystem.requiredBehavior.some((rule) => rule.includes("development_asset_brief")));
assert.ok(capabilityManifest.productionLockSystem.requiredBehavior.some((rule) => rule.includes("legacyAssetPackageDraft")));
assert.ok(capabilityManifest.productionLockSystem.requiredBehavior.some((rule) => rule.includes("failure paths")));
assert.equal(capabilityManifest.productionLockSystem.commitBehavior, "formal_stage_output_with_operator_artifact_qa");
const runProductionPrepCapabilitySelfChecks = () => {
  assert.equal(capabilityManifest.productionPrepSystem.schemaVersion, "production-prep-system.v1");
  assert.equal(capabilityManifest.productionPrepSystem.status, "production_prep_contract_stage_integrated");
  assert.deepEqual(
    buildProductionPrepSystem().artifactKinds,
    ["production_breakdown_report", "continuity_matrix", "casting_requirement", "casting_decision", "department_prep_package"],
  );
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes("production_breakdown_report"));
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes("continuity_matrix"));
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes("casting_requirement"));
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes("casting_decision"));
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes("department_prep_package"));
  assert.ok(capabilityManifest.productionPrepSystem.builderFunctions.includes("buildProductionBreakdownReport"));
  assert.ok(capabilityManifest.productionPrepSystem.builderFunctions.includes("buildCastingRequirements"));
  assert.ok(capabilityManifest.productionPrepSystem.builderFunctions.includes("buildAutostudioCastingDecisions"));
  assert.ok(capabilityManifest.productionPrepSystem.builderFunctions.includes("buildDepartmentPrepPackages"));
  assert.ok(capabilityManifest.productionPrepSystem.builderFunctions.includes("buildContinuityMatrix"));
  assert.ok(capabilityManifest.productionPrepSystem.qaFunctions.includes("validateProductionBreakdownReport"));
  assert.ok(capabilityManifest.productionPrepSystem.qaFunctions.includes("validateCastingRequirements"));
  assert.ok(capabilityManifest.productionPrepSystem.qaFunctions.includes("validateCastingDecision"));
  assert.ok(capabilityManifest.productionPrepSystem.qaFunctions.includes("validateDepartmentPrepPackages"));
  assert.ok(capabilityManifest.productionPrepSystem.qaFunctions.includes("validateContinuityMatrix"));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("locked script scenes")));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("interactiveCoverage")));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("AutoStudio casting bridge")));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("continuity_matrix")));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("UI/interaction")));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("production_breakdown stage")));
  assert.ok(capabilityManifest.productionPrepSystem.canonicalDepartments.includes("cinematography"));
  assert.ok(capabilityManifest.productionPrepSystem.canonicalDepartments.includes("lighting"));
  assert.ok(capabilityManifest.productionPrepSystem.canonicalDepartments.includes("wardrobe"));
  assert.ok(capabilityManifest.productionPrepSystem.canonicalDepartments.includes("makeup_hair"));
  assert.deepEqual(expandProductionPrepDepartment("wardrobe_makeup"), ["wardrobe_makeup", "wardrobe", "makeup_hair"]);
  assert.deepEqual(expandProductionPrepDepartment("location_art"), ["location_art", "production_design"]);
  assert.ok(capabilityManifest.productionPrepSystem.departmentEnvelopeFields.includes("specialistPayload"));
  assert.ok(capabilityManifest.productionPrepSystem.specialistPayloadSchemas.some((schema) => schema.schemaVersion === "cinematography-prep.v1"));
  assert.ok(capabilityManifest.productionPrepSystem.specialistPayloadSchemas.some((schema) => schema.schemaVersion === "lighting-prep.v1"));
  assert.ok(capabilityManifest.productionPrepSystem.specialistPayloadSchemas.some((schema) => schema.schemaVersion === "performance-directing-prep.v1"));
  assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule) => rule.includes("Specialized department packages")));
  assert.equal(capabilityManifest.productionPrepSystem.commitBehavior, "formal_stage_output_with_operator_artifact_qa");
};
runProductionPrepCapabilitySelfChecks();
assert.equal(capabilityManifest.departmentAgentSystem.schemaVersion, "department-agent-system.v1");
assert.equal(capabilityManifest.departmentAgentSystem.status, "department_agent_contract_available");
assert.ok(capabilityManifest.departmentAgentSystem.canonicalPrepDepartments.includes("cinematography"));
assert.ok(capabilityManifest.departmentAgentSystem.canonicalPrepDepartments.includes("action_choreography"));
assert.ok(capabilityManifest.departmentAgentSystem.legacyPrepDepartments.includes("wardrobe_makeup"));
assert.ok(capabilityManifest.departmentAgentSystem.departmentAgents.some((agent) => agent.id === "department.cinematography"));
assert.ok(capabilityManifest.departmentAgentSystem.departmentAgents.some((agent) => agent.id === "department.production_coordination"));
assert.ok(capabilityManifest.departmentAgentSystem.coordinationPoints.some((point) => point.scope === "stage_exit" && point.stageTypes.includes("production_breakdown")));
assert.ok(capabilityManifest.departmentAgentSystem.coordinationPoints.some((point) => point.scope === "episode_wrap"));
assert.ok(capabilityManifest.departmentAgentSystem.coordinationPrinciple.includes("do not add or reorder formal workflow stages"));
assert.equal(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.schemaVersion, "manual-film-team-collaboration.v1");
assert.equal(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.orderedDepartments.length, 12);
assert.equal(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.orderedDepartments[0], "directing");
assert.equal(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.orderedDepartments.at(-1), "continuity");
assert.deepEqual(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.productionCoordinationPasses, ["initial_dependency_brief", "final_specialist_reconciliation"]);
assert.ok(capabilityManifest.departmentAgentSystem.manualPreparationCollaboration.handoffContract.includes("toDepartments"));
const runPhase12DepartmentModeCapabilitySelfChecks = () => {
  assert.ok(capabilityManifest.departmentAgentSystem.modeDepartmentPolicies["ai-video-sample"].requiredForFormal.includes("cinematography"));
  assert.ok(capabilityManifest.departmentAgentSystem.modeDepartmentPolicies["ai-video-sample"].optionalSoftHold.includes("wardrobe"));
  assert.ok(capabilityManifest.departmentAgentSystem.modeDepartmentPolicies.interactive.requiredForFormal.includes("ui_interaction"));
  assert.ok(capabilityManifest.departmentAgentSystem.modeDepartmentPolicies.movie.requiredForFormal.includes("production_design"));
};
runPhase12DepartmentModeCapabilitySelfChecks();
assert.equal(buildDepartmentAgentSystem().schemaVersion, "department-agent-system.v1");
assert.equal(capabilityManifest.productionCoordinationSystem.artifactKind, "production_coordination_report");
assert.equal(capabilityManifest.productionCoordinationSystem.qaFunction, "validateProductionCoordinationReport");
assert.equal(capabilityManifest.productionCoordinationSystem.departmentQaFunction, "runProductionDepartmentCoordinationQA");
assert.equal(capabilityManifest.productionCoordinationSystem.departmentCoverageFunction, "buildProductionDepartmentCoverage");
assert.equal(capabilityManifest.productionCoordinationSystem.departmentCoverageSchema, "production-department-coverage.v1");
assert.equal(capabilityManifest.productionCoordinationSystem.departmentQaAgents.asset, "runAssetCoordinationQA");
assert.equal(capabilityManifest.productionCoordinationSystem.departmentQaAgents.department_coverage, "runDepartmentCoverageCoordinationQA");
assert.equal(capabilityManifest.productionCoordinationSystem.repairTicketArtifactKind, "coordination_repair_ticket");
assert.equal(capabilityManifest.productionCoordinationSystem.qaSeverityPolicyId, "qa-severity-policy.v1");
assert.ok(capabilityManifest.productionCoordinationSystem.qaResolutionClasses.includes("soft_hold"));
assert.ok(capabilityManifest.productionCoordinationSystem.requiredBehavior.some((rule) => rule.includes("soft_hold")));
assert.ok(capabilityManifest.productionCoordinationSystem.requiredBehavior.some((rule) => rule.includes("repairClassification")));
assert.equal(capabilityManifest.productionCoordinationSystem.stageGateFunction, "buildProductionCoordinationStageGate");
assert.equal(capabilityManifest.productionCoordinationSystem.wrapQaFunction, "buildProductionCoordinationWrapQA");
assert.equal(capabilityManifest.productionCoordinationSystem.circuitBreakerFunction, "evaluateCoordinationCircuitBreaker");
assert.equal(capabilityManifest.productionCoordinationSystem.commitBehavior, "operator_artifact_only");
assert.ok(capabilityManifest.productionCoordinationSystem.departments.includes("asset"));
assert.ok(capabilityManifest.productionCoordinationSystem.departments.includes("department_coverage"));
assert.ok(capabilityManifest.productionCoordinationSystem.coordinatedPrepDepartments.includes("lighting"));
assert.ok(capabilityManifest.productionCoordinationSystem.coordinationTargets.includes("department_prep_package"));
assert.ok(capabilityManifest.productionCoordinationSystem.coordinationPoints.some((point) => point.stageTypes.includes("storyboard")));
assert.ok(capabilityManifest.productionCoordinationSystem.requiredBehavior.some((rule) => rule.includes("canonical stages")));
assert.ok(capabilityManifest.productionCoordinationSystem.requiredBehavior.some((rule) => rule.includes("departmentCoverage")));
assert.equal(capabilityManifest.productionCockpitSystem.schemaVersion, "production-cockpit.v1");
assert.equal(capabilityManifest.productionCockpitSystem.readModelFunction, "buildProductionCockpit");
assert.ok(capabilityManifest.productionCockpitSystem.operatorApi.includes("production-cockpit"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("softHolds"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("deliveryMode"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("storyboardChain"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("productionGovernance"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("productionPrep"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("departmentCoverage"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("departmentQaSummary"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("roleSlots"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("castingCandidates"));
assert.ok(capabilityManifest.productionCockpitSystem.includes.includes("assetPrepReadiness"));
assert.ok(capabilityManifest.productionCockpitSystem.requiredBehavior.some((rule) => rule.includes("frontend")));
assert.ok(capabilityManifest.productionCockpitSystem.requiredBehavior.some((rule) => rule.includes("formal_delivery")));
assert.ok(capabilityManifest.productionCockpitSystem.requiredBehavior.some((rule) => rule.includes("storyboard chain")));
assert.ok(capabilityManifest.productionCockpitSystem.requiredBehavior.some((rule) => rule.includes("current_block_only")));
assert.equal(capabilityManifest.productionChangeOrderSystem.schemaVersion, "production-change-order-system.v1");
assert.equal(capabilityManifest.productionChangeOrderSystem.status, "series_change_order_available");
assert.ok(capabilityManifest.productionChangeOrderSystem.artifactKinds.includes("series_change_order"));
assert.ok(capabilityManifest.productionChangeOrderSystem.builderFunctions.includes("buildSeriesChangeOrder"));
assert.ok(capabilityManifest.productionChangeOrderSystem.qaFunctions.includes("validateSeriesChangeOrder"));
assert.ok(capabilityManifest.productionChangeOrderSystem.requiredBehavior.some((rule) => rule.includes("variable-state")));
assert.ok(capabilityManifest.productionChangeOrderSystem.requiredBehavior.some((rule) => rule.includes("targetEpisodeCount")));
assert.equal(capabilityManifest.castingDecisionSystem.schemaVersion, "casting-decision-system.v1");
assert.ok(capabilityManifest.castingDecisionSystem.artifactKinds.includes("role_slot"));
assert.ok(capabilityManifest.castingDecisionSystem.artifactKinds.includes("casting_candidate"));
assert.ok(capabilityManifest.castingDecisionSystem.artifactKinds.includes("casting_decision"));
assert.ok(capabilityManifest.castingDecisionSystem.builderFunctions.includes("buildRoleSlots"));
assert.ok(capabilityManifest.castingDecisionSystem.builderFunctions.includes("buildCastingCandidates"));
assert.ok(capabilityManifest.castingDecisionSystem.builderFunctions.includes("buildCastingDecision"));
assert.ok(capabilityManifest.castingDecisionSystem.qaFunctions.includes("validateRoleSlots"));
assert.ok(capabilityManifest.castingDecisionSystem.qaFunctions.includes("validateCastingCandidates"));
assert.ok(capabilityManifest.castingDecisionSystem.qaFunctions.includes("validateCastingDecision"));
assert.ok(capabilityManifest.castingDecisionSystem.requiredBehavior.some((rule) => rule.includes("AutoStudio production_breakdown")));
assert.equal(capabilityManifest.formalAssetPackageSystem.schemaVersion, "formal-asset-package-system.v1");
assert.ok(capabilityManifest.formalAssetPackageSystem.artifactKinds.includes("formal_asset_package"));
assert.ok(capabilityManifest.formalAssetPackageSystem.artifactKinds.includes("asset_identity_board"));
assert.ok(capabilityManifest.formalAssetPackageSystem.artifactKinds.includes("scene_asset_variant_pack"));
assert.ok(capabilityManifest.formalAssetPackageSystem.artifactKinds.includes("asset_variant_fingerprint"));
assert.ok(capabilityManifest.formalAssetPackageSystem.builderFunctions.includes("buildFormalAssetPackage"));
assert.ok(capabilityManifest.formalAssetPackageSystem.builderFunctions.includes("buildSceneAssetVariantPacks"));
assert.ok(capabilityManifest.formalAssetPackageSystem.qaFunctions.includes("validateFormalAssetPackage"));
assert.ok(capabilityManifest.formalAssetPackageSystem.qaFunctions.includes("validateSceneAssetVariantPacks"));
assert.ok(capabilityManifest.formalAssetPackageSystem.requiredBehavior.some((rule) => rule.includes("Stabilized planned characters")));
assert.ok(capabilityManifest.formalAssetPackageSystem.requiredBehavior.some((rule) => rule.includes("Three scenes")));
assert.equal(capabilityManifest.productionContinuitySystem.schemaVersion, "production-continuity-system.v1");
assert.ok(capabilityManifest.productionContinuitySystem.artifactKinds.includes("continuity_matrix"));
assert.ok(capabilityManifest.productionContinuitySystem.builderFunctions.includes("buildContinuityMatrix"));
assert.ok(capabilityManifest.productionContinuitySystem.qaFunctions.includes("validateContinuityMatrix"));
assert.ok(capabilityManifest.productionContinuitySystem.requiredBehavior.some((rule) => rule.includes("Continuity rows")));
assert.ok(capabilityManifest.apiGroups.some((group) =>
  group.routes.includes("GET /api/operator/projects/:projectId/production-cockpit"),
));
assert.ok(capabilityManifest.apiGroups.some((group) =>
  group.routes.includes("POST /api/operator/projects/:projectId/casting-decisions"),
));
assert.ok(capabilityManifest.apiGroups.some((group) =>
  group.routes.includes("POST /api/operator/projects/:projectId/legacy-production-draft"),
));
assert.deepEqual(buildCreativeChangeSystem().artifactKinds, ["creative_change_request", "pending_asset", "variant_request", "local_resync_plan"]);
assert.equal(capabilityManifest.creativeChangeSystem.primaryArtifactKind, "creative_change_request");
assert.ok(capabilityManifest.creativeChangeSystem.artifactKinds.includes("pending_asset"));
assert.ok(capabilityManifest.creativeChangeSystem.qaFunctions.includes("validateCreativeChangeRequest"));
assert.ok(capabilityManifest.creativeChangeSystem.requiredBehavior.some((rule) => rule.includes("asset ids")));
assert.deepEqual(validateVideoStoryboardSystem(), []);
assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.length >= 6);
assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy) => strategy.id === "storyboard.single_shot_dialogue.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy) => strategy.id === "storyboard.fight_choreography.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.videoModelProfiles.some((profile) => profile.supportsStoryboardReference));
assert.ok(capabilityManifest.videoStoryboardSystem.imageModelProfiles.some((profile) => profile.supportsLineArtControl));
assert.ok(capabilityManifest.videoStoryboardSystem.arrowLegend.some((entry) => entry.id === "subject_action_red"));
assert.ok(capabilityManifest.videoStoryboardSystem.arrowLegend.some((entry) => entry.id === "camera_motion_blue"));
assert.equal(capabilityManifest.videoStoryboardSystem.selectionProtocol.producerChoosesStrategy, true);
assert.equal(capabilityManifest.videoStoryboardSystem.selectionProtocol.strategySelectionPromptTemplateId, "storyboard.strategy.select");
assert.ok(capabilityManifest.videoStoryboardSystem.selectionProtocol.requiredDecisionFields.includes("arrowLegendIds"));
assert.ok(capabilityManifest.videoStoryboardSystem.selectionProtocol.requiredDecisionFields.includes("expectedReferenceImageCount"));
assert.equal(capabilityManifest.videoStoryboardSystem.selectionProtocol.qaContract.qaFunction, "validateStoryboardStrategyDecision");
assert.equal(capabilityManifest.videoStoryboardSystem.selectionProtocol.qaContract.recommendationFunction, "recommendStoryboardPromptStrategies");
assert.deepEqual(
  buildVideoStoryboardArtifactSystem().artifactKinds,
  ["performance_beats", "storyboard_board", "scene_visual_pack", "asset_reference_pack", "video_generation_unit"],
);
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.artifactKinds.includes("performance_beats"));
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.artifactKinds.includes("storyboard_board"));
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.artifactKinds.includes("scene_visual_pack"));
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.artifactKinds.includes("asset_reference_pack"));
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.artifactKinds.includes("video_generation_unit"));
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.strictQa.artifactQaFunctions.includes("validateVideoStoryboardPlan"));
assert.equal(capabilityManifest.videoStoryboardSystem.artifactSystem.operatorQaApi.autoQaBody.auto, true);
assert.ok(capabilityManifest.videoStoryboardSystem.artifactSystem.operatorQaApi.supportedKinds.includes("custom videoStoryboardPlan"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStrategies.some((strategy) => strategy.id === "assetBoard.characterIdentity.artbook.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStrategies.some((strategy) => strategy.id === "assetBoard.variantDelta.stateLock.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStrategies.some((strategy) => strategy.id === "assetBoard.wardrobeMakeup.continuity.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStrategies.some((strategy) => strategy.id === "assetBoard.vfxSfx.stateCycle.v1"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStyleLockPolicy.sourcePriority.includes("project.visualStyleLock"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardStyleLockPolicy.rule.includes("cartoon"));
assert.equal(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.defaultReadiness, "development_only");
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.formalReadyRequires.includes("production_breakdown_report with locked scene/node matrix"));
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.formalReadyRequires.includes("approved casting_decision for formal character identity boards"));
assert.equal(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.blockedIssueCode, "FORMAL_ASSET_BOARD_LOCK_MISSING");
assert.equal(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.developmentWarningCode, "ASSET_BOARD_DEVELOPMENT_ONLY");
assert.ok(capabilityManifest.videoStoryboardSystem.assetBoardProductionGate.rule.includes("formalAssetIntent=true"));
assert.ok(capabilityManifest.videoStoryboardSystem.stageIntegration.asset_detail.includes("development asset board directions"));
assert.ok(capabilityManifest.videoStoryboardSystem.stageIntegration.asset_sync.includes("production_breakdown_report"));
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.asset_detail.artifactType, "asset_board_plan");
assert.ok(capabilityManifest.videoStoryboardSystem.stageArtifacts.asset_detail.sourceOfTruth.includes("production_breakdown_report"));
assert.ok(capabilityManifest.videoStoryboardSystem.stageArtifacts.asset_detail.sourceOfTruth.includes("casting_decision"));
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.script.artifactType, "performance_beats");
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.asset_sync.artifactType, "scene_visual_pack");
assert.ok(capabilityManifest.videoStoryboardSystem.stageArtifacts.asset_sync.sourceOfTruth.includes("department_prep_package"));
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.storyboard.artifactType, "storyboard_board");
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.prompt.artifactType, "asset_reference_pack");
assert.equal(capabilityManifest.videoStoryboardSystem.stageArtifacts.expensive_generation_planning.artifactType, "video_generation_unit");
reportSelfCheckProgress("checking phase 13 contracts");
runPhase13SelfCheck(capabilityManifest, reportSelfCheckProgress);
reportSelfCheckProgress("checked phase 13 contracts");

assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "asset_detail")?.artifactTypes.includes("asset_board_plan"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "production_breakdown")?.artifactTypes.includes("continuity_matrix"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "production_asset_detail")?.artifactTypes.includes("formal_asset_package"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "production_asset_detail")?.artifactTypes.includes("asset_identity_board"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "script")?.artifactTypes.includes("performance_beats"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "asset_sync")?.artifactTypes.includes("scene_visual_pack"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "asset_sync")?.artifactTypes.includes("scene_asset_variant_pack"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "asset_sync")?.artifactTypes.includes("asset_variant_fingerprint"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "storyboard")?.artifactTypes.includes("storyboard_board"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "prompt")?.artifactTypes.includes("asset_reference_pack"));
assert.ok(linearStageDefinitions.find((stage) => stage.stageType === "expensive_generation_planning")?.artifactTypes.includes("video_generation_unit"));
assert.ok(interactiveStageDefinitions.find((stage) => stage.stageType === "production_asset_detail")?.artifactTypes.includes("formal_asset_package"));
assert.ok(interactiveStageDefinitions.find((stage) => stage.stageType === "production_asset_detail")?.artifactTypes.includes("asset_identity_board"));
assert.ok(interactiveStageDefinitions.find((stage) => stage.stageType === "production_breakdown")?.artifactTypes.includes("continuity_matrix"));
assert.ok(interactiveStageDefinitions.find((stage) => stage.stageType === "expensive_generation_planning")?.artifactTypes.includes("video_generation_unit"));
for (const contract of VIDEO_STORYBOARD_ARTIFACT_CONTRACTS) {
  assert.equal(contract.commitBehavior, "operator_artifact_only");
  assert.ok(contract.qaFunction.startsWith("validate"));
  for (const promptTemplateId of contract.promptTemplateIds.filter((id) => !id.endsWith(".*"))) {
    assert.ok(defaultTemplates[promptTemplateId]?.template, `Missing video storyboard artifact prompt template: ${promptTemplateId}`);
  }
}
for (const strategy of STORYBOARD_PROMPT_STRATEGIES) {
  assert.ok(defaultTemplates[strategy.promptTemplateId]?.template, `Missing storyboard prompt template: ${strategy.promptTemplateId}`);
}
const dialogueStrategyRecommendations = recommendStoryboardPromptStrategies(
  {
    dialogueLineCount: 3,
    actionBeatCount: 0,
    combatBeatCount: 0,
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  },
  3,
);
assert.ok(dialogueStrategyRecommendations.some((recommendation) => recommendation.strategyId === "storyboard.single_shot_dialogue.v1"));
assert.notEqual(dialogueStrategyRecommendations[0]?.strategyId, "storyboard.fight_choreography.v1");
const revealStrategyRecommendations = recommendStoryboardPromptStrategies(
  {
    actionBeatCount: 2,
    combatBeatCount: 0,
    revealOrTwist: true,
    requiresMultiShot: true,
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 3,
    expectedReferenceVideoCount: 0,
    modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  },
  3,
);
assert.ok([
  "storyboard.reveal_twist.v1",
  "storyboard.multi_shot_narrative.v1",
].includes(revealStrategyRecommendations[0]?.strategyId || ""));
const validStoryboardDecisionIssues = validateStoryboardStrategyDecision(
  {
    selectedStrategyId: "storyboard.single_shot_dialogue.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: "这是一段以双人对白和停顿为主的表演节拍，动作少但需要稳定轴线、眼神和手部微动作，同时 10 秒和 4 张参考图符合当前视频模型 profile。",
    rejectedStrategyIds: ["storyboard.fight_choreography.v1", "storyboard.action_continuity.v1"],
    riskNotes: ["需要确保对白时长撑满 10 秒。"],
    expectedBoardShape: "3-4 格单镜头表演板",
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
    qaChecklist: ["对白时长可支撑", "角色位置稳定", "首尾状态可接"],
  },
  { dialogueLineCount: 3, actionBeatCount: 0, combatBeatCount: 0 },
);
assert.equal(validStoryboardDecisionIssues.some((issue) => issue.severity === "blocking"), false);
const dialogueMisfireIssues = validateStoryboardStrategyDecision(
  {
    selectedStrategyId: "storyboard.fight_choreography.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: "这是一段对白戏但错误使用打斗板，用于测试 QA 是否能拦住明显误选。",
    rejectedStrategyIds: ["storyboard.single_shot_dialogue.v1"],
    riskNotes: ["测试负例。"],
    expectedBoardShape: "12-16 格打斗板",
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
    qaChecklist: ["测试 QA"],
  },
  { dialogueLineCount: 3, actionBeatCount: 0, combatBeatCount: 0 },
);
assert.ok(dialogueMisfireIssues.some((issue) => issue.code === "DIALOGUE_OVERCOMPLICATED_AS_ACTION"));
const modelLimitIssues = validateStoryboardStrategyDecision(
  {
    selectedStrategyId: "storyboard.multi_shot_narrative.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.start_end_frame.configurable.bridge_unit.v1",
    rationale: "这是一段多镜头剧情推进，但时长和参考资产数量故意超过模型 profile，用于测试能力边界 QA。",
    rejectedStrategyIds: ["storyboard.single_shot_dialogue.v1"],
    riskNotes: ["测试负例。"],
    expectedBoardShape: "6-9 格多镜头剧情板",
    expectedVideoUnitDurationSeconds: 15,
    expectedReferenceImageCount: 9,
    expectedReferenceVideoCount: 1,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
    qaChecklist: ["测试 QA"],
  },
  { requiresMultiShot: true },
);
assert.ok(modelLimitIssues.some((issue) => issue.code === "DURATION_EXCEEDS_MODEL_MAX"));
assert.ok(modelLimitIssues.some((issue) => issue.code === "REFERENCE_IMAGES_EXCEED_MODEL_MAX"));
assert.ok(modelLimitIssues.some((issue) => issue.code === "REFERENCE_VIDEOS_UNSUPPORTED"));
reportSelfCheckProgress("checking storyboard artifact contracts");
const samplePerformanceBeats = [{
  id: "beat-sample-dialogue",
  episodeId: "ep-sample",
  sceneId: "scene-sample",
  scriptBlockIds: ["sb-1", "sb-2"],
  beatType: "dialogue",
  summary: "双人对白从试探转为公开表态。",
  visibleChange: "角色从沉默对视变为举起关键道具。",
  startState: "角色 A 在画面左侧压住情绪。",
  endState: "关键道具被举起，角色 B 被迫回应。",
  durationSeconds: 10,
  characterIds: ["char-a", "char-b"],
  locationId: "loc-gate",
  propIds: ["prop-token"],
  dialogueLineCount: 2,
  actionBeatCount: 0,
  combatBeatCount: 0,
  emotionalBeatCount: 1,
  soundCues: ["风声"],
  continuityIn: "承接上一段角色 A left、角色 B right。",
  continuityOut: "以道具发光作为下一段首帧。",
}];
const sampleSceneVisualPack = {
  id: "svp-sample",
  projectId: "project-sample",
  episodeId: "ep-sample",
  sourceSceneIds: ["scene-sample"],
  linkedSceneIds: ["scene-sample"],
  baseAssetBoardPlanId: "project-sample.asset_board_plan",
  visualFingerprint: createSceneVisualFingerprint({
    location: { assetId: "loc-gate", variantId: "night" },
    characters: [{ characterId: "char-a", variantId: "robe-clean" }, { characterId: "char-b", variantId: "robe-clean" }],
    props: [{ assetId: "prop-token", variantId: "glowing" }],
  }),
  location: {
    assetId: "loc-gate",
    variantId: "night",
    setDressingState: "夜色山门，冷雾，石阶完整。",
    timeOfDay: "NIGHT",
    lightingState: "冷月逆光。",
  },
  characters: [
    { characterId: "char-a", variantId: "robe-clean", costumeState: "青白道袍完整。", emotionalBaseline: "压住情绪。" },
    { characterId: "char-b", variantId: "robe-clean", costumeState: "青白道袍完整。", emotionalBaseline: "被迫回应。" },
  ],
  props: [
    { assetId: "prop-token", variantId: "glowing", ownerCharacterId: "char-a", usageState: "举起发光令牌。", continuityState: "令牌发光作为下一段首帧。" },
  ],
  referenceSlots: [
    { slotId: "character-char-a", assetId: "char-a", variantId: "robe-clean", boardItemId: "char-a.robe-clean.variant_board", purpose: "costume", priority: 10 },
    { slotId: "character-char-b", assetId: "char-b", variantId: "robe-clean", boardItemId: "char-b.robe-clean.variant_board", purpose: "costume", priority: 11 },
    { slotId: "location-loc-gate", assetId: "loc-gate", variantId: "night", boardItemId: "loc-gate.night.variant_board", purpose: "set", priority: 30 },
    { slotId: "prop-prop-token", assetId: "prop-token", variantId: "glowing", boardItemId: "prop-token.glowing.variant_board", purpose: "state", priority: 50 },
  ],
  continuityIn: "角色 A left、角色 B right，山门冷雾延续。",
  continuityOut: "令牌发光，角色 B 被迫回应。",
  qaChecklist: ["本场资产无冗余", "复用判断正确", "variant 引用存在"],
};
const sampleAssetReferencePack = {
  id: "pack-sample",
  episodeId: "ep-sample",
  sceneId: "scene-sample",
  sceneVisualPackId: "svp-sample",
  modelInputFingerprint: "mif-sample",
  modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  purpose: "为 10 秒单镜头对白准备角色、场景和道具参考。",
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  packagingNotes: "外貌和材质进入参考包，视频 prompt 只保留动作、构图和首尾状态。",
  styleLockVersion: "visual-style-lock.production-self-check.v1",
  visualStyleLockRefs: ["visualStyleLock.version"],
  storyboardStrategyIds: ["storyboard.single_shot_dialogue.v1"],
  storyboardStrategyOrigin: "built_in",
  annotationLegendVersion: "storyboard-annotation-legend.v1",
  items: [
    { assetId: "char-a", assetType: "character", referenceAssetId: "ref-char-a", roleInUnit: "角色 A", required: true },
    { assetId: "char-b", assetType: "character", referenceAssetId: "ref-char-b", roleInUnit: "角色 B", required: true },
    { assetId: "loc-gate", assetType: "location", referenceAssetId: "ref-loc-gate", roleInUnit: "场景", required: true },
    { assetId: "prop-token", assetType: "prop", referenceAssetId: "ref-prop-token", roleInUnit: "关键道具", required: true },
  ],
};
const sampleStrategyDecision = {
  selectedStrategyId: "storyboard.single_shot_dialogue.v1",
  selectedStrategyVersion: "v1",
  selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  rationale: "这是一段双人对白和道具微动作驱动的 10 秒表演段，动作和打斗密度很低，使用单镜头对白板能保护轴线、停顿、眼神和模型时长边界。",
  rejectedStrategyIds: ["storyboard.fight_choreography.v1", "storyboard.action_continuity.v1"],
  riskNotes: ["需要确认对白和停顿能支撑 10 秒。"],
  expectedBoardShape: "3-4 格单镜头表演板",
  expectedVideoUnitDurationSeconds: 10,
  expectedReferenceImageCount: 4,
  expectedReferenceVideoCount: 0,
  arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
  qaChecklist: ["对白时长可支撑", "角色位置稳定", "首尾状态可接"],
};
const sampleStoryboardBoard = {
  id: "board-sample",
  episodeId: "ep-sample",
  sceneId: "scene-sample",
  strategyDecision: sampleStrategyDecision,
  boardMode: "single_shot_performance",
  layout: "1x4",
  lineArtPrompt: "中文线稿故事板，三格单镜头对白表演板，红箭头标注道具举起，蓝箭头标注轻微慢推。",
  arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
  styleLockVersion: "visual-style-lock.production-self-check.v1",
  strategyOrigin: "built_in",
  templateScope: "built_in",
  visualStyleLockRefs: ["visualStyleLock.version"],
  annotationLegendVersion: "storyboard-annotation-legend.v1",
  performanceBeatIds: ["beat-sample-dialogue"],
  scriptBlockIds: ["sb-1", "sb-2"],
  shotIds: ["shot-1"],
  assetReferencePackId: "pack-sample",
  videoGenerationUnitId: "unit-sample",
  panels: [
    { id: "panel-1", panelNumber: 1, performanceBeatId: "beat-sample-dialogue", shotId: "shot-1", durationSeconds: 3, framePurpose: "起始对峙", shotType: "MS", visualBeat: "两人对视。", cameraNote: "固定轴线。", actionArrowLegendIds: ["camera_motion_blue"], annotationLegendIds: ["camera_motion_blue", "shot_note_black"], dialogueOrSoundCue: "风声" },
    { id: "panel-2", panelNumber: 2, performanceBeatId: "beat-sample-dialogue", shotId: "shot-1", durationSeconds: 4, framePurpose: "举起道具", shotType: "MS", visualBeat: "角色 A 举起道具。", cameraNote: "轻微慢推。", actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"], annotationLegendIds: ["subject_action_red", "camera_motion_blue", "shot_note_black"], dialogueOrSoundCue: "对白" },
    { id: "panel-3", panelNumber: 3, performanceBeatId: "beat-sample-dialogue", shotId: "shot-1", durationSeconds: 3, framePurpose: "尾状态", shotType: "MS", visualBeat: "角色 B 被迫回应。", cameraNote: "慢推停止。", actionArrowLegendIds: ["eyeline_attention_green"], annotationLegendIds: ["eyeline_attention_green", "shot_note_black"], dialogueOrSoundCue: "停顿" },
  ],
  startState: "角色 A 在画面左侧压住情绪。",
  endState: "关键道具被举起，角色 B 被迫回应。",
};
const sampleVideoGenerationUnit = {
  id: "unit-sample",
  episodeId: "ep-sample",
  sceneId: "scene-sample",
  modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  durationSeconds: 10,
  performanceBeatIds: ["beat-sample-dialogue"],
  storyboardBoardId: "board-sample",
  assetReferencePackId: "pack-sample",
  shotIds: ["shot-1"],
  startState: "角色 A 在画面左侧压住情绪。",
  endState: "关键道具被举起，角色 B 被迫回应。",
  promptTemplateId: "storyboard.videoGenerationUnit.plan",
  videoPrompt: "竖屏 9:16，单镜头双人中景，轻微慢推，角色 A 举起关键道具，角色 B 被迫回应，10 秒，角色位置稳定。",
  audioPlan: "环境风声，两句对白，尾部停顿。",
  styleLockVersion: "visual-style-lock.production-self-check.v1",
  visualStyleLockRefs: ["visualStyleLock.version"],
  storyboardStrategyId: "storyboard.single_shot_dialogue.v1",
  storyboardStrategyVersion: "v1",
  storyboardStrategyOrigin: "built_in",
  annotationLegendIds: ["subject_action_red", "camera_motion_blue", "shot_note_black"],
  annotationLegendVersion: "storyboard-annotation-legend.v1",
};
assert.equal(validatePerformanceBeats(samplePerformanceBeats as any).some((issue) => issue.severity === "blocking"), false);
assert.equal(validateSceneVisualPack(sampleSceneVisualPack as any).some((issue) => issue.severity === "blocking"), false);
assert.equal(validateAssetReferencePack(sampleAssetReferencePack as any).some((issue) => issue.severity === "blocking"), false);
assert.equal(validateStoryboardBoard(sampleStoryboardBoard as any, { dialogueLineCount: 2 }).some((issue) => issue.severity === "blocking"), false);
assert.equal(validateVideoGenerationUnit(sampleVideoGenerationUnit as any, sampleAssetReferencePack as any).some((issue) => issue.severity === "blocking"), false);
assert.equal(validateVideoStoryboardPlan({
  performanceBeats: samplePerformanceBeats as any,
  storyboardBoards: [sampleStoryboardBoard as any],
  sceneVisualPacks: [sampleSceneVisualPack as any],
  assetReferencePacks: [sampleAssetReferencePack as any],
  videoGenerationUnits: [sampleVideoGenerationUnit as any],
}).some((issue) => issue.severity === "blocking"), false);
const invalidVideoUnitIssues = validateVideoGenerationUnit({
  ...sampleVideoGenerationUnit,
  durationSeconds: 30,
} as any, sampleAssetReferencePack as any);
assert.ok(invalidVideoUnitIssues.some((issue) => issue.code === "VIDEO_UNIT_DURATION_EXCEEDS_MODEL_MAX"));
reportSelfCheckProgress("checking workflow ordering");
const workflowContract = buildOperatorWorkflowContract();
const linearStageOrder = linearStageDefinitions.map((stage) => stage.stageType);
const interactiveStageOrder = interactiveStageDefinitions.map((stage) => stage.stageType);
assert.deepEqual(
  capabilityManifest.workflowOrderSystem.linear.canonicalStages.map((stage) => stage.stageType),
  linearStageOrder,
);
assert.deepEqual(
  capabilityManifest.workflowOrderSystem.interactive.canonicalStages.map((stage) => stage.stageType),
  interactiveStageOrder,
);
assert.deepEqual(
  linearStageOrder.slice(linearStageOrder.indexOf("script"), linearStageOrder.indexOf("asset_sync") + 1),
  ["script", "script_lock", "production_breakdown", "production_asset_detail", "asset_sync"],
);
assert.deepEqual(
  interactiveStageOrder.slice(interactiveStageOrder.indexOf("interactive_script"), interactiveStageOrder.indexOf("interactive_storyboard") + 1),
  ["interactive_script", "content_lock", "production_breakdown", "production_asset_detail", "interactive_storyboard"],
);
assert.ok(capabilityManifest.workflowOrderSystem.blockingOrderRules.some((rule) => rule.includes("Do not write storyboard before script")));
assert.ok(capabilityManifest.workflowOrderSystem.blockingOrderRules.some((rule) => rule.includes("script_lock")));
assert.ok(capabilityManifest.workflowOrderSystem.blockingOrderRules.some((rule) => rule.includes("content_lock")));
assert.equal(capabilityManifest.workflowOrderSystem.formalStageSource.linear, "linearStageDefinitions");
assert.equal(capabilityManifest.workflowOrderSystem.formalStageSource.interactive, "interactiveStageDefinitions");
assert.ok(capabilityManifest.workflowOrderSystem.nonStageGatePolicy.rule.includes("must not be inserted as standalone workflow stages"));
assert.equal(capabilityManifest.workflowOrderSystem.stageExitPolicy.appliesToEveryStage, true);
assert.ok(capabilityManifest.workflowOrderSystem.stageExitPolicy.requiredBeforeNextStage.some((rule) => rule.includes("contract QA")));
assert.ok(capabilityManifest.workflowOrderSystem.linear.canonicalStages.every((stage) => stage.requiredExitGate.strictQaRequired));
assert.ok(capabilityManifest.workflowOrderSystem.interactive.canonicalStages.every((stage) => stage.requiredExitGate.nextStageBlockedUntilQaPasses));
assert.ok(getImpactedStageTypes([
  {
    id: "artifact-script-lock-impact",
    stageId: "stage-script-lock-impact",
    artifactType: "script_lock_package",
    targetPath: "run.outputSnapshot.scriptLockPackage",
    entityIds: [],
    version: 1,
    summary: "script lock impact self-check",
  },
] as any).includes("production_breakdown"));
assert.ok(getImpactedStageTypes([
  {
    id: "artifact-breakdown-impact",
    stageId: "stage-breakdown-impact",
    artifactType: "production_breakdown_report",
    targetPath: "run.outputSnapshot.productionBreakdownReport",
    entityIds: [],
    version: 1,
    summary: "production breakdown impact self-check",
  },
] as any).includes("production_asset_detail"));
assert.ok(impactedStageTypesForProjectChange("scene_changed").includes("production_asset_detail"));
assert.ok(impactedStageTypesForProjectChange("scene_changed").includes("asset_sync"));
assert.ok(impactedStageTypesForProjectChange("scene_changed").includes("storyboard"));
assert.ok(impactedStageTypesForProjectChange("scene_changed").includes("prompt"));
assert.ok(impactedStageTypesForProjectChange("asset_reference_changed", "prop").includes("production_asset_detail"));
assert.ok(impactedStageTypesForProjectChange("asset_reference_changed", "prop").includes("asset_sync"));
assert.ok(impactedStageTypesForProjectChange("asset_reference_changed", "prop").includes("expensive_generation_planning"));
assert.deepEqual(workflowContract.linear.canonicalStages.map((stage) => stage.stageType), linearStageOrder);
assert.ok(capabilityManifest.workflowOrderSystem.qualityOverlays.every((overlay) => overlay.mustNotBecomeStandaloneStage));
for (const overlay of capabilityManifest.workflowOrderSystem.qualityOverlays) {
  for (const stageType of overlay.requiredBefore) {
    assert.ok(
      canonicalStageTypeSet.has(stageType),
      `workflow overlay ${overlay.id} must point to canonical stageType, got ${stageType}`,
    );
  }
}
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("commercial quality ladder")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("long-form memory")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("asset continuity")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("canonical stage order")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("AI video storyboard strategy")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("production coordination report")));
assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule) => rule.includes("creative change request")));
assert.ok(capabilityManifest.apiGroups.some((group) => group.routes.includes("GET /api/operator/capabilities")));
assert.ok(capabilityManifest.apiGroups.some((group) => group.routes.includes("GET /api/operator/projects/:projectId/creative-changes")));
assert.ok(capabilityManifest.apiGroups.some((group) => group.routes.includes("POST /api/operator/projects/:projectId/creative-changes")));
assert.ok(capabilityManifest.apiGroups.some((group) => group.routes.includes("PATCH /api/operator/projects/:projectId/creative-changes/:artifactId")));
assert.ok(capabilityManifest.workflowCoverage.some((workflow) => workflow.id === "magic-import-adaptation"));
assert.ok(capabilityManifest.workflowCoverage.some((workflow) => workflow.id === "interactive-game"));
assert.deepEqual(
  capabilityManifest.workflowCoverage.find((workflow) => workflow.id === "linear-film-tv-shortdrama")?.stages,
  linearStageDefinitions.map((stage) => stage.stageType),
);
assert.deepEqual(
  capabilityManifest.workflowCoverage.find((workflow) => workflow.id === "interactive-game")?.stages,
  interactiveStageDefinitions.map((stage) => stage.stageType),
);
assert.ok(capabilityManifest.workflowCoverage.find((workflow) => workflow.id === "linear-film-tv-shortdrama")?.qualityOverlays.includes("asset_continuity_refresh"));
assert.equal(LONG_FORM_MEMORY_WINDOW_POLICIES.script.includeSceneDetails, true);
assert.equal(LONG_FORM_MEMORY_WINDOW_POLICIES.visual_prompt.includeShotDetails, true);
reportSelfCheckProgress("checking long-form memory");
const longFormMemoryProject = {
  id: "long-form-project",
  title: "长篇记忆测试",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  targetEpisodeCount: 100,
  durationMinutes: 500,
  logline: "道侣飞升后重写天规。",
  coreConflict: "飞升制度与下界生存冲突。",
  productionMemory: {
    commercialMemory: { monetizationPromise: "飞升后反转和道侣长线付费钩子" },
    skeletonMemory: {
      seriesPromise100: "五阶段修仙长篇",
      finaleContract: "第 100 集重写飞升规则",
      phaseMap: [
        { id: "phase-1", episodes: "1-20", title: "下界飞升", promise: "宗门被毁后同心飞升" },
        { id: "phase-2", episodes: "21-40", title: "仙籍飞升税", promise: "保住玄霄星岛" },
        { id: "phase-3", episodes: "41-60", title: "诸天试炼", promise: "取得宗门名分" },
        { id: "phase-4", episodes: "61-80", title: "道侣大劫", promise: "穿过失忆和仙魔战" },
        { id: "phase-5", episodes: "81-100", title: "重写天规", promise: "制度终局偿付" },
      ],
    },
    continuityMemory: {
      relationshipStage: "道侣共同承劫",
      protagonistState: "飞升后初入上界",
      propOwnership: { soulLamp: "主角持有" },
      forbiddenContradictions: ["不能否认第 20 集飞升"],
    },
  },
  characters: [],
  assets: [],
  episodes: [
    { id: "ep-20", title: "同心飞升", inspiration: "二人穿过新天门。", scenes: [] },
    {
      id: "ep-21",
      order: 20,
      title: "仙籍第一笔",
      inspiration: "飞升后被登记欠税。",
      continuityState: {
        cultivationStage: "飞升初期",
        relationshipStage: "道侣被制度拆分",
        sectState: "玄霄下界重建中",
        keyPropState: "魂灯仍在",
      },
      scenes: [{
        id: "scene-21-1",
        title: "升仙台登记",
        description: "仙籍光柱照向二人。",
        valueCharge: "negative",
        valueShift: { from: "飞升成功", to: "被制度登记", reason: "仙籍玉牌强制绑定" },
        shots: [{
          id: "shot-21-1",
          visualAction: "仙籍玉牌落到陆青尘掌心。",
          duration: 6,
          continuityNote: "180 度轴线固定；视线匹配；动作顺接；空间方位连续性。",
        }],
      }],
    },
  ],
} as any;
const longFormOperatorMemory = buildLongFormMemoryContext(longFormMemoryProject, { profile: "operator", episodeIds: ["ep-21"] });
assert.equal(longFormOperatorMemory.source, "productionMemory");
assert.equal(longFormOperatorMemory.phaseMap.length, 5);
assert.equal(longFormOperatorMemory.windowPolicy.profile, "operator");
assert.equal(longFormOperatorMemory.previousEpisodes[0].id, "ep-20");
assert.ok(longFormOperatorMemory.assetContinuity);
assert.ok(renderLongFormMemoryForPrompt(longFormOperatorMemory).includes("较近前文具体内容"));
assert.ok(renderLongFormMemoryForPrompt(longFormOperatorMemory).includes("多集资产台账"));
const numericProjectIdEpisodeProject = {
  ...longFormMemoryProject,
  id: "short10-episode-number-parse",
  targetEpisodeCount: 10,
  productionMemory: {
    commercialMemory: { monetizationPromise: "每集都有付费钩子" },
    skeletonMemory: { finaleContract: "第 10 集完成双线偿付" },
    continuityMemory: {
      relationshipStage: "互相试探",
      protagonistState: "刚进入主线局",
      propOwnership: { contractBook: "女主持有线索" },
    },
  },
  episodes: Array.from({ length: 10 }, (_, index) => ({
    id: `short10-episode-number-parse-ep-${String(index + 1).padStart(2, "0")}`,
    title: `第${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][index]}集`,
    inspiration: "用于验证项目 ID 中的总集数不会污染分集编号。",
    scenes: [],
  })),
} as any;
const numericProjectIdEpisodeIssues = validateLongFormMemoryRules(
  numericProjectIdEpisodeProject,
  [numericProjectIdEpisodeProject.episodes[0]],
);
assert.equal(numericProjectIdEpisodeIssues.some((issue) => issue.target.includes(".continuityState")), false);
assert.equal(numericProjectIdEpisodeIssues.some((issue) => issue.message.includes("第 10 集")), false);
const assetContinuityProject = {
  id: "asset-continuity-project",
  title: "多集资产台账测试",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  targetEpisodeCount: 20,
  logline: "主角携令牌查案。",
  coreConflict: "身份与旧案冲突。",
  characters: [{
    id: "char-main",
    name: "沈瑶",
  }],
  assets: [
    {
      id: "loc-hall",
      type: "location",
      name: "青岚宗大殿",
      description: "宗门审判空间。",
      prompt: "中文场景提示词：青岚宗大殿，竖屏构图，冷色审判光。",
      variants: [{ id: "day", name: "白日审判", description: "白日冷光。", promptModifiers: "冷白天光。" }],
    },
    {
      id: "prop-token",
      type: "prop",
      name: "青岚令",
      description: "执法令牌。",
      prompt: "中文道具提示词：青岚令，青铜纹路，中心发光。",
      variants: [{ id: "clean", name: "完整状态", description: "无裂纹。", promptModifiers: "干净完整。" }],
    },
  ],
  episodes: Array.from({ length: 6 }, (_, index) => ({
    id: `ep-${index + 1}`,
    title: `第 ${index + 1} 集`,
    inspiration: "连续追查旧案。",
    scenes: [{
      id: `scene-${index + 1}`,
      title: "大殿追问",
      description: "沈瑶追问旧案。",
      valueCharge: "negative",
      breakdown: {
        characterIds: ["char-main"],
        locationId: "loc-hall",
        propIds: ["prop-token"],
        assetVariantMap: { "prop-token": "broken" },
      },
      shots: [{
        id: `shot-${index + 1}`,
        visualAction: "沈瑶握住青岚令追问。",
        duration: 5,
        characterIdsInShot: ["char-main"],
        locationId: "loc-hall",
        propIds: ["prop-token"],
        imagePrompt: "中文图片提示词：沈瑶在青岚宗大殿握住青岚令。",
      }],
    }],
  })),
} as any;
reportSelfCheckProgress("checking asset continuity");
const assetContinuity = buildAssetContinuityContext(assetContinuityProject, { profile: "visual_prompt" });
assert.equal(assetContinuity.counts.episodes, 6);
assert.equal(assetContinuity.missingReferences.length, 0);
assert.ok(assetContinuity.variantCoverage.recurringWithoutVariants.some((entry) => entry.id === "char-main"));
assert.equal(assetContinuity.variantCoverage.missingVariantReferenceCount, 1);
assert.ok(assetContinuity.qaIssues.some((issue) => issue.target === "assets.variants.references" && issue.severity === "blocking"));
assert.ok(assetContinuity.requiredBeforeVisualGeneration.some((item) => item.includes("char-main")));
const sceneVisualPackProject = {
  id: "scene-visual-pack-project",
  title: "场景视觉包复用测试",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  visualStyleLock: {
    version: "visual-style-lock.production-self-check.v1",
    humanApprovalState: "approved",
    source: "style_reference_analysis",
    styleSourceRefs: ["uploaded-style-reference.production-self-check"],
    noSourceCopyRules: ["只继承线稿控制、标注体系、镜头语言和色彩逻辑，不复制参考图人物、场景、logo、水印或具体构图。"],
    renderingMode: "line_art_control",
    styleKeywords: ["中文线稿故事板", "动态箭头标注", "清晰首尾状态"],
    cameraLanguage: "可生成视频用的分镜控制图，镜头运动和动作轨迹分离标注。",
    annotationLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green", "lighting_direction_orange", "sound_emotion_purple", "shot_note_black"],
  },
  characters: [{
    id: "char-hero",
    name: "陆青尘",
    multiViewPrompt: "中文角色板：陆青尘，青白道袍，沉静坚韧。",
    variants: [
      { id: "robe-clean", name: "完整道袍", description: "青白道袍完整无血。", promptModifiers: "衣袍干净。" },
      { id: "robe-blood", name: "染血道袍", description: "袖口染血，肩部有裂痕。", promptModifiers: "血迹和战损。" },
    ],
  }],
  assets: [
    {
      id: "loc-cliff",
      type: "location",
      name: "飞升崖",
      description: "下界宗门残崖，天门光柱从云层落下。",
      prompt: "中文场景板：飞升崖，断裂石阶，天门光柱。",
      variants: [
        { id: "intact-night", name: "夜色完整", description: "石阶完整，夜色冷光。", promptModifiers: "冷月逆光。" },
        { id: "broken-dawn", name: "破晓崩裂", description: "石阶崩裂，晨光穿云。", promptModifiers: "破晓金光和裂石。" },
      ],
    },
    {
      id: "prop-soul-lamp",
      type: "prop",
      name: "同心魂灯",
      description: "道侣共同守护的魂灯。",
      prompt: "中文道具板：同心魂灯，琉璃灯芯，微弱金光。",
      variants: [
        { id: "stable", name: "稳定燃烧", description: "灯火稳定。", promptModifiers: "稳定金光。" },
        { id: "cracked", name: "裂纹将灭", description: "灯盏出现裂纹，火苗摇晃。", promptModifiers: "裂纹和摇晃火苗。" },
      ],
    },
  ],
} as any;
const sceneVisualPackEpisodes = [{
  id: "ep-svp",
  title: "飞升前夜",
  inspiration: "三场戏测试相同视觉状态复用和变体分裂。",
  scenes: [
    {
      id: "scene-svp-1",
      title: "崖前对望一",
      description: "陆青尘持魂灯望向天门。",
      valueCharge: "positive",
      valueShift: { from: "犹豫", to: "坚定", reason: "魂灯亮起" },
      timeOfDay: "NIGHT",
      breakdown: {
        locationId: "loc-cliff",
        characterIds: ["char-hero"],
        propIds: ["prop-soul-lamp"],
        wardrobe: ["青白道袍完整"],
        makeupHair: ["束发整齐"],
        assetVariantMap: { "char-hero": "robe-clean", "loc-cliff": "intact-night", "prop-soul-lamp": "stable" },
      },
      shots: [{ id: "shot-svp-1", characterIdsInShot: ["char-hero"], locationId: "loc-cliff", propIds: ["prop-soul-lamp"], lighting: "冷月逆光", continuityNote: "角色在画面左侧，魂灯在胸前。" }],
    },
    {
      id: "scene-svp-2",
      title: "崖前对望二",
      description: "同一布景服化道状态的补拍段落。",
      valueCharge: "positive",
      valueShift: { from: "犹豫", to: "坚定", reason: "魂灯亮起" },
      timeOfDay: "NIGHT",
      breakdown: {
        locationId: "loc-cliff",
        characterIds: ["char-hero"],
        propIds: ["prop-soul-lamp"],
        wardrobe: ["青白道袍完整"],
        makeupHair: ["束发整齐"],
        assetVariantMap: { "char-hero": "robe-clean", "loc-cliff": "intact-night", "prop-soul-lamp": "stable" },
      },
      shots: [{ id: "shot-svp-2", characterIdsInShot: ["char-hero"], locationId: "loc-cliff", propIds: ["prop-soul-lamp"], lighting: "冷月逆光", continuityNote: "角色在画面左侧，魂灯在胸前。" }],
    },
    {
      id: "scene-svp-3",
      title: "破晓染血",
      description: "陆青尘染血，魂灯裂开，飞升崖崩裂。",
      valueCharge: "negative",
      valueShift: { from: "坚定", to: "濒临失去", reason: "魂灯出现裂纹" },
      timeOfDay: "DAWN",
      breakdown: {
        locationId: "loc-cliff",
        characterIds: ["char-hero"],
        propIds: ["prop-soul-lamp"],
        wardrobe: ["青白道袍染血"],
        makeupHair: ["发丝散乱"],
        assetVariantMap: { "char-hero": "robe-blood", "loc-cliff": "broken-dawn", "prop-soul-lamp": "cracked" },
      },
      shots: [{ id: "shot-svp-3", characterIdsInShot: ["char-hero"], locationId: "loc-cliff", propIds: ["prop-soul-lamp"], lighting: "破晓金光", continuityNote: "角色跪在裂石前，魂灯火苗将灭。" }],
    },
  ],
}] as any;
reportSelfCheckProgress("checking scene visual pack drafts");
const sceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(sceneVisualPackProject, sceneVisualPackEpisodes);
assert.equal(sceneVisualPackDrafts.issues.some((issue) => issue.severity === "blocking"), false, JSON.stringify(sceneVisualPackDrafts.issues, null, 2));
assert.equal(sceneVisualPackDrafts.sceneVisualPacks.length, 2);
assert.equal(sceneVisualPackDrafts.reusedPackIds.length, 1);
assert.ok(sceneVisualPackDrafts.sceneVisualPacks.some((pack) => pack.linkedSceneIds.includes("scene-svp-1") && pack.linkedSceneIds.includes("scene-svp-2")));
assert.ok(sceneVisualPackDrafts.sceneVisualPacks.some((pack) => pack.linkedSceneIds.includes("scene-svp-3") && pack.visualFingerprint !== sceneVisualPackDrafts.sceneVisualPacks[0].visualFingerprint));
const longFormContextOptions = gatherContextOptions(longFormMemoryProject, "generateScript");
assert.ok(longFormContextOptions.options.some((option) => option.id === "ctx_longFormMemory"));
assert.ok(longFormContextOptions.defaultIds.includes("ctx_longFormMemory"));
const packageSource = fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8");
assert.ok(packageSource.includes("\"test:operator-e2e\""));
assert.ok(packageSource.includes("\"test:scene-visual-pack-flow\""));
const operatorE2ESource = fs.readFileSync(new URL("./operator-mode-e2e-self-check.ts", import.meta.url), "utf-8");
assert.ok(operatorE2ESource.includes("externalModelCalls: 0"));
assert.ok(operatorE2ESource.includes("storyboard_shots"));
assert.ok(operatorE2ESource.includes("performance_beats"));
assert.ok(operatorE2ESource.includes("storyboard_board"));
assert.ok(operatorE2ESource.includes("scene_visual_pack"));
assert.ok(operatorE2ESource.includes("asset_reference_pack"));
assert.ok(operatorE2ESource.includes("video_generation_unit"));
const operatorClientSource = fs.readFileSync(new URL("../apps/web/src/clients/operatorClient.ts", import.meta.url), "utf-8");
assert.ok(operatorClientSource.includes("/api/operator/runs?projectId="));
assert.ok(operatorClientSource.includes("/api/operator/artifacts?projectId="));
assert.ok(operatorClientSource.includes("/api/operator/assets?projectId="));
const runPhase12DepartmentUiSourceSelfChecks = () => {
  const departmentBoardsPanelSource = fs.readFileSync(new URL("../src/components/storyboard/DepartmentBoardsPanel.tsx", import.meta.url), "utf-8");
  assert.ok(departmentBoardsPanelSource.includes("cinematography"));
  assert.ok(departmentBoardsPanelSource.includes("performance_directing"));
  assert.ok(departmentBoardsPanelSource.includes("action_choreography"));
  assert.ok(departmentBoardsPanelSource.includes("departmentCoverage"));
  assert.ok(departmentBoardsPanelSource.includes("departmentQaSummary"));
  assert.ok(departmentBoardsPanelSource.includes("production_design"));
};
runPhase12DepartmentUiSourceSelfChecks();
const manualGatewaySource = fs.readFileSync(new URL("../src/services/production/manualGateway.ts", import.meta.url), "utf-8");
assert.ok(manualGatewaySource.includes("productionClient.createOperatorRun"));
assert.ok(manualGatewaySource.includes("productionClient.appendOperatorRunEvent"));
assert.ok(manualGatewaySource.includes("productionClient.updateOperatorRun"));
assert.ok(manualGatewaySource.includes("Manual prompt gateway reviewed"));
const operatorPromptEditorSource = fs.readFileSync(new URL("../src/components/PromptEditorModal.tsx", import.meta.url), "utf-8");
assert.ok(operatorPromptEditorSource.includes("projectId: currentProject?.id"));
assert.ok(operatorPromptEditorSource.includes("episodeId: activeEpisodeId || activeEpisode?.id"));
const openOperatorPolicy = createOperatorSecurityPolicy();
assert.equal(openOperatorPolicy.localDevelopmentOpen, true);
assertOperatorTokenAuthorized(openOperatorPolicy, undefined);
assertOperatorProjectAllowed(openOperatorPolicy, "any-project");
const lockedOperatorPolicy = createOperatorSecurityPolicy({
  token: "operator-secret",
  allowedProjectIds: ["operator-project"],
});
assert.equal(summarizeOperatorSecurityPolicy(lockedOperatorPolicy).projectScope, "restricted");
assertOperatorTokenAuthorized(
  lockedOperatorPolicy,
  extractOperatorTokenFromHeaders({ authorization: "Bearer operator-secret" }),
);
assert.throws(
  () => assertOperatorTokenAuthorized(lockedOperatorPolicy, "wrong-secret"),
  /Operator API token/,
);
assertOperatorProjectAllowed(lockedOperatorPolicy, "operator-project");
assert.throws(
  () => assertOperatorProjectAllowed(lockedOperatorPolicy, "other-project"),
  /not allowed/,
);
reportSelfCheckProgress("checking operator contracts");
const operatorRun = createOperatorRunRecord({
  projectId: "operator-project",
  provider: "codex",
  mode: "produce",
  userRequest: "继续第六集分镜视觉验收。",
  scope: { projectId: "operator-project", episodeIds: ["ep-6"] },
}, OPERATOR_HANDBOOK_VERSION);
assert.equal(operatorRun.provider, "codex");
assert.equal(operatorRun.status, "running");
assert.deepEqual(operatorRun.scope.episodeIds, ["ep-6"]);
const operatorRunWithEvent = appendOperatorEvent(operatorRun, {
  type: "context_read",
  message: "读取项目上下文。",
  entityIds: ["operator-project"],
});
assert.equal(operatorRunWithEvent.events.length, 1);
assert.equal(operatorRunWithEvent.events[0].type, "context_read");
const completedOperatorRun = mergeOperatorRunPatch(operatorRunWithEvent, { status: "completed" });
assert.equal(completedOperatorRun.status, "completed");
assert.equal(completedOperatorRun.projectId, "operator-project");
const operatorAssetPackArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "asset_reference_pack",
  targetPath: "episodes.ep-sample.scenes.scene-sample.assetReferencePacks.pack-sample",
  entityIds: ["ep-sample", "scene-sample", "pack-sample"],
  data: { assetReferencePack: sampleAssetReferencePack },
}, operatorRun);
const operatorPerformanceBeatsArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "performance_beats",
  targetPath: "episodes.ep-sample.scenes.scene-sample.performanceBeats",
  entityIds: ["ep-sample", "scene-sample", "beat-sample-dialogue"],
  data: { performanceBeats: samplePerformanceBeats },
}, operatorRun);
const operatorSceneVisualPackArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "scene_visual_pack",
  targetPath: "episodes.ep-sample.scenes.scene-sample.sceneVisualPacks.svp-sample",
  entityIds: ["ep-sample", "scene-sample", "svp-sample"],
  data: { sceneVisualPack: sampleSceneVisualPack },
}, operatorRun);
const autoSceneVisualPackVerdict = runOperatorArtifactQA({ artifact: operatorSceneVisualPackArtifact });
assert.equal(autoSceneVisualPackVerdict?.blocking, false, JSON.stringify(autoSceneVisualPackVerdict?.issues, null, 2));
assert.equal(autoSceneVisualPackVerdict?.qaAgentId, "operator.artifact.scene_visual_pack.qa");
const operatorStoryboardBoardArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "storyboard_board",
  targetPath: "episodes.ep-sample.scenes.scene-sample.storyboardBoards.board-sample",
  entityIds: ["ep-sample", "scene-sample", "board-sample"],
  data: { storyboardBoard: sampleStoryboardBoard },
}, operatorRun);
const operatorVideoUnitArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "video_generation_unit",
  targetPath: "episodes.ep-sample.scenes.scene-sample.videoGenerationUnits.unit-sample",
  entityIds: ["ep-sample", "scene-sample", "unit-sample"],
  data: { videoGenerationUnit: sampleVideoGenerationUnit },
}, operatorRun);
const autoVideoUnitVerdict = runOperatorArtifactQA({
  artifact: operatorVideoUnitArtifact,
  relatedArtifacts: [operatorAssetPackArtifact],
});
assert.equal(autoVideoUnitVerdict?.blocking, false, JSON.stringify(autoVideoUnitVerdict?.issues, null, 2));
assert.equal(autoVideoUnitVerdict?.qaAgentId, "operator.artifact.video_generation_unit.qa");
const operatorVideoStoryboardPlanArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "custom",
  targetPath: "videoStoryboardPlan",
  entityIds: ["ep-sample", "scene-sample"],
  data: {
    performanceBeats: samplePerformanceBeats,
    storyboardBoards: [sampleStoryboardBoard],
    sceneVisualPacks: [sampleSceneVisualPack],
    assetReferencePacks: [sampleAssetReferencePack],
    videoGenerationUnits: [sampleVideoGenerationUnit],
  },
}, operatorRun);
const autoPlanVerdict = runOperatorArtifactQA({ artifact: operatorVideoStoryboardPlanArtifact });
assert.equal(autoPlanVerdict?.blocking, false, JSON.stringify(autoPlanVerdict?.issues, null, 2));
assert.equal(autoPlanVerdict?.qaAgentId, "operator.artifact.video_storyboard_plan.qa");
const sampleDevelopmentAssetBrief = {
  schemaVersion: "development-asset-brief.v1" as const,
  id: "dev-asset-brief-monk",
  projectId: "operator-project",
  assetType: "character" as const,
  assetIntent: "探索主角师父的视觉方向，服务 bible 阶段角色功能判断。",
  storyFunction: "导师/秘密持有者，暂未从锁定剧本反推出正式选角要求。",
  visualHypothesis: "素色长袍、克制姿态、低饱和气质，具体年龄和表演范围等待剧本锁定。",
  knownUnknowns: ["年龄段", "关键伤痕是否存在", "是否需要动作戏"],
  notProductionReadyReason: "尚无 script_lock_package 和 casting_requirement，不能作为正式角色身份板。",
  sourceStageType: "bible",
  productionReady: false as const,
};
assert.equal(validateDevelopmentAssetBrief(sampleDevelopmentAssetBrief).some((issue) => issue.severity === "blocking"), false);
const operatorDevelopmentAssetBriefArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "development_asset_brief",
  targetPath: "operator.productionLocks.developmentAssetBrief.dev-asset-brief-monk",
  entityIds: ["operator-project", "dev-asset-brief-monk"],
  data: { developmentAssetBrief: sampleDevelopmentAssetBrief },
}, operatorRun);
const autoDevelopmentAssetBriefVerdict = runOperatorArtifactQA({ artifact: operatorDevelopmentAssetBriefArtifact });
assert.equal(autoDevelopmentAssetBriefVerdict?.qaAgentId, "operator.artifact.development_asset_brief.qa");
assert.equal(autoDevelopmentAssetBriefVerdict?.blocking, false, JSON.stringify(autoDevelopmentAssetBriefVerdict?.issues, null, 2));
const sampleMovieScriptLock = {
  schemaVersion: "script-lock-package.v1" as const,
  id: "script-lock-feature-v1",
  projectId: "operator-project",
  format: "movie" as const,
  lockScope: "full_script" as const,
  episodeIds: ["feature-reel-1"],
  sceneIds: ["scene-a", "scene-b"],
  sequenceIds: ["seq-1"],
  scriptRevision: "screenplay-r3-approved",
  coverageRatio: 1,
  scriptCoverage: {
    expectedSceneCount: 2,
    lockedSceneCount: 2,
    expectedSequenceCount: 1,
    lockedSequenceCount: 1,
  },
  approvedBy: "director",
  approvalState: "approved" as const,
  unlockedRisks: [],
  lockedAt: 1710000000000,
};
assert.equal(validateScriptLockPackage(sampleMovieScriptLock).some((issue) => issue.severity === "blocking"), false);
const operatorScriptLockArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "script_lock_package",
  targetPath: "operator.productionLocks.script.script-lock-feature-v1",
  entityIds: ["operator-project", "script-lock-feature-v1"],
  data: { scriptLockPackage: sampleMovieScriptLock },
}, operatorRun);
const autoScriptLockVerdict = runOperatorArtifactQA({ artifact: operatorScriptLockArtifact });
assert.equal(autoScriptLockVerdict?.qaAgentId, "operator.artifact.script_lock_package.qa");
assert.equal(autoScriptLockVerdict?.blocking, false, JSON.stringify(autoScriptLockVerdict?.issues, null, 2));
const invalidPartialFullScriptLock = {
  ...sampleMovieScriptLock,
  id: "script-lock-feature-invalid",
  coverageRatio: 0.5,
};
assert.ok(validateScriptLockPackage(invalidPartialFullScriptLock).some((issue) => issue.severity === "blocking" && issue.target === "script_lock_package.coverageRatio"));
const sampleContentLock = {
  schemaVersion: "content-lock-package.v1" as const,
  id: "content-lock-chapter-1",
  projectId: "operator-project",
  format: "interactive" as const,
  lockScope: "node_block" as const,
  graphRevision: "graph-r2-approved",
  nodeIds: ["node-start", "node-choice", "node-ending", "node-failure"],
  variableStateIds: ["var-trust-low", "var-trust-high"],
  goldenPathNodeIds: ["node-start", "node-choice", "node-ending"],
  endingNodeIds: ["node-ending", "node-failure"],
  failurePathNodeIds: ["node-failure"],
  endingCoverageRatio: 1,
  unreachableNodeIds: [],
  unlockedNodeIds: [],
  variableGaps: [],
  approvedBy: "game-director",
  approvalState: "approved" as const,
  lockedAt: 1710000000100,
};
assert.equal(validateContentLockPackage(sampleContentLock).some((issue) => issue.severity === "blocking"), false);
const operatorContentLockArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "content_lock_package",
  targetPath: "operator.productionLocks.content.content-lock-chapter-1",
  entityIds: ["operator-project", "content-lock-chapter-1"],
  data: { contentLockPackage: sampleContentLock },
}, operatorRun);
const autoContentLockVerdict = runOperatorArtifactQA({ artifact: operatorContentLockArtifact });
assert.equal(autoContentLockVerdict?.qaAgentId, "operator.artifact.content_lock_package.qa");
assert.equal(autoContentLockVerdict?.blocking, false, JSON.stringify(autoContentLockVerdict?.issues, null, 2));
const sampleProductionBlockLock = {
  schemaVersion: "production-block-lock.v1" as const,
  id: "production-block-lock-ep-1-10",
  projectId: "operator-project",
  blockId: "ep-1-10",
  mode: "tv-series" as const,
  lockType: "episode_block" as const,
  episodeIds: ["ep-1", "ep-2"],
  sceneIds: ["scene-a", "scene-b"],
  nodeIds: [],
  scriptLockPackageId: "script-lock-feature-v1",
  entryCriteria: ["series structure approved", "episode block scripts approved"],
  exitCriteria: ["production breakdown complete", "department prep package ready"],
  openDependencies: [],
  status: "locked" as const,
  lockedAt: 1710000000200,
};
assert.equal(validateProductionBlockLock(sampleProductionBlockLock).some((issue) => issue.severity === "blocking"), false);
const operatorProductionBlockLockArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "production_block_lock",
  targetPath: "operator.productionLocks.blocks.production-block-lock-ep-1-10",
  entityIds: ["operator-project", "production-block-lock-ep-1-10"],
  data: { productionBlockLock: sampleProductionBlockLock },
}, operatorRun);
const autoProductionBlockLockVerdict = runOperatorArtifactQA({ artifact: operatorProductionBlockLockArtifact });
assert.equal(autoProductionBlockLockVerdict?.qaAgentId, "operator.artifact.production_block_lock.qa");
assert.equal(autoProductionBlockLockVerdict?.blocking, false, JSON.stringify(autoProductionBlockLockVerdict?.issues, null, 2));
reportSelfCheckProgress("checking production preparation");
const productionPrepProject = {
  id: "operator-project",
  title: "锁定后制片筹备样例",
  type: "tv-series",
  projectModel: "linear",
  aspectRatio: "16:9",
  logline: "锁定剧本后从场次反推出正式资产筹备。",
  coreConflict: "导演不能先定角色板，必须先看剧本拆解。",
  characters: [{
    id: "char-lead",
    name: "林澈",
    psychologicalProfile: "克制、警惕、爆发时动作迅速",
    actingStyle: "细腻克制到突然爆发",
    voiceName: "calm-tenor",
  }],
  assets: [{
    id: "loc-court",
    type: "location",
    name: "废弃法庭",
    description: "雨夜、破损木椅、顶灯闪烁。",
  }, {
    id: "prop-ticket",
    type: "prop",
    name: "烧焦的彩票",
    description: "边缘焦黑的关键证据。",
  }],
  episodes: [{
    id: "ep-1",
    title: "第一集",
    inspiration: "锁定样例",
    scenes: [{
      id: "scene-a",
      title: "废弃法庭对峙",
      description: "林澈拿出证据逼对方承认。",
      valueCharge: "positive",
      script: "林澈站在雨水倒灌的法庭里，攥紧烧焦的彩票。",
      scriptBlocks: [{
        id: "sb-a-1",
        type: "action",
        content: "林澈把烧焦的彩票按在证人席上。",
        linkedAssetId: "prop-ticket",
        propIds: ["prop-ticket"],
        locationId: "loc-court",
      }],
      shots: [{
        id: "shot-a-1",
        characterIdsInShot: ["char-lead"],
        locationId: "loc-court",
        propIds: ["prop-ticket"],
        visualAction: "林澈手指压住彩票边缘。",
        duration: 4,
      }],
      breakdown: {
        setting: "INT.",
        location: { name: "废弃法庭", state: "雨夜漏水" },
        time: "NIGHT",
        characters: [{ name: "林澈", state: "袖口湿透" }],
        props: [{ name: "烧焦的彩票", state: "边缘焦黑" }],
        characterIds: ["char-lead"],
        propIds: ["prop-ticket"],
        locationId: "loc-court",
        wardrobe: ["深灰风衣湿透"],
        makeupHair: ["额前湿发", "右颧轻微擦伤"],
        vfx: ["顶灯闪烁"],
        sfx: ["雨声", "远处雷声"],
        vehicles: [],
        extrasAtmosphere: ["空荡旁听席"],
        specialEquipment: ["雨水反光地面"],
        bgm: [{ prompt: "低频悬疑脉冲" }],
        assetVariantMap: {
          "char-lead": "variant-wet-coat",
          "prop-ticket": "variant-burnt",
          "loc-court": "variant-rain-night",
        },
      },
    }, {
      id: "scene-b",
      title: "门口追逐",
      description: "林澈冲出法庭。",
      valueCharge: "negative",
      shots: [{
        id: "shot-b-1",
        characterIdsInShot: ["char-lead"],
        locationId: "loc-court",
        visualAction: "林澈从门口冲入雨幕。",
        duration: 3,
      }],
      breakdown: {
        setting: "INT./EXT.",
        location: "废弃法庭门口",
        time: "NIGHT",
        characters: ["林澈"],
        props: [],
        characterIds: ["char-lead"],
        locationId: "loc-court",
        wardrobe: ["深灰风衣湿透"],
        makeupHair: ["湿发贴额"],
        vfx: ["雨幕"],
        sfx: ["急促脚步"],
        vehicles: [],
        extrasAtmosphere: [],
        specialEquipment: [],
        bgm: [{ prompt: "追逐鼓点" }],
        assetVariantMap: {
          "char-lead": "variant-wet-coat",
          "loc-court": "variant-rain-night",
        },
      },
    }],
  }],
} as any;
const productionBreakdownReport = buildProductionBreakdownReport({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  scriptLockPackage: sampleMovieScriptLock,
  productionBlockLock: sampleProductionBlockLock,
  createdAt: 1710000000300,
});
assert.equal(productionBreakdownReport.schemaVersion, "production-breakdown-report.v1");
assert.equal(productionBreakdownReport.sceneMatrix.length, 2);
assert.ok(productionBreakdownReport.scope.sourceLockIds.includes("script-lock-feature-v1"));
assert.ok(productionBreakdownReport.characterAppearances.some((appearance) => appearance.id === "char-lead"));
assert.ok(productionBreakdownReport.propAppearances.some((appearance) => appearance.id === "prop-ticket"));
assert.ok(productionBreakdownReport.variantNeeds.some((need) => need.variantKind === "wardrobe"));
assert.equal(validateProductionBreakdownReport(productionBreakdownReport).some((issue) => issue.severity === "blocking"), false);
const operatorProductionBreakdownArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "production_breakdown_report",
  targetPath: `operator.productionPrep.${productionBreakdownReport.id}`,
  entityIds: ["operator-project", "ep-1", "scene-a", "scene-b"],
  data: { productionBreakdownReport },
}, operatorRun);
const autoProductionBreakdownVerdict = runOperatorArtifactQA({ artifact: operatorProductionBreakdownArtifact });
assert.equal(autoProductionBreakdownVerdict?.qaAgentId, "operator.artifact.production_breakdown_report.qa");
assert.equal(autoProductionBreakdownVerdict?.blocking, false, JSON.stringify(autoProductionBreakdownVerdict?.issues, null, 2));
const castingRequirements = buildCastingRequirements(productionPrepProject, productionBreakdownReport, 1710000000400);
assert.ok(castingRequirements.some((requirement) => requirement.characterId === "char-lead"));
assert.equal(validateCastingRequirements(castingRequirements).some((issue) => issue.severity === "blocking"), false);
const operatorCastingArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "casting_requirement",
  targetPath: "operator.productionPrep.castingRequirements.ep-1",
  entityIds: ["operator-project", "char-lead"],
  data: { castingRequirements },
}, operatorRun);
const autoCastingVerdict = runOperatorArtifactQA({ artifact: operatorCastingArtifact });
assert.equal(autoCastingVerdict?.qaAgentId, "operator.artifact.casting_requirement.qa");
assert.equal(autoCastingVerdict?.blocking, false, JSON.stringify(autoCastingVerdict?.issues, null, 2));
const roleSlots = buildRoleSlots({
  project: productionPrepProject,
  castingRequirements,
  createdAt: 1710000000410,
});
assert.ok(roleSlots.some((slot) => slot.castingRequirementId === castingRequirements[0].id));
assert.equal(validateRoleSlots(roleSlots).some((issue) => issue.severity === "blocking"), false);
const operatorRoleSlotArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "role_slot",
  targetPath: "operator.productionCasting.roleSlots.ep-1",
  entityIds: ["operator-project", ...roleSlots.map((slot) => slot.id)],
  data: { roleSlots },
}, operatorRun);
const autoRoleSlotVerdict = runOperatorArtifactQA({ artifact: operatorRoleSlotArtifact });
assert.equal(autoRoleSlotVerdict?.qaAgentId, "operator.artifact.role_slot.qa");
assert.equal(autoRoleSlotVerdict?.blocking, false, JSON.stringify(autoRoleSlotVerdict?.issues, null, 2));
const castingCandidates = buildCastingCandidates({
  projectId: productionPrepProject.id,
  roleSlot: roleSlots[0],
  castingRequirement: castingRequirements[0],
  createdAt: 1710000000420,
});
assert.ok(castingCandidates.some((candidate) => candidate.roleSlotId === castingRequirements[0].roleSlotId));
assert.equal(validateCastingCandidates(castingCandidates).some((issue) => issue.severity === "blocking"), false);
const operatorCastingCandidateArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "casting_candidate",
  targetPath: "operator.productionCasting.candidates.ep-1",
  entityIds: ["operator-project", ...castingCandidates.map((candidate) => candidate.id)],
  data: { castingCandidates },
}, operatorRun);
const autoCastingCandidateVerdict = runOperatorArtifactQA({ artifact: operatorCastingCandidateArtifact });
assert.equal(autoCastingCandidateVerdict?.qaAgentId, "operator.artifact.casting_candidate.qa");
assert.equal(autoCastingCandidateVerdict?.blocking, false, JSON.stringify(autoCastingCandidateVerdict?.issues, null, 2));
const approvedCastingDecision = buildCastingDecision({
  projectId: productionPrepProject.id,
  castingRequirement: castingRequirements[0],
  decisionType: "assign_existing_character",
  candidate: {
    characterId: castingRequirements[0].characterId,
    name: castingRequirements[0].displayName,
    source: "existing_character",
    suitabilityNotes: ["符合锁定剧本的行动与表演需求。"],
  },
  directorNotes: "导演确认林澈当前角色身份方向可以进入正式角色资产板。",
  castingRequirementArtifactId: operatorCastingArtifact.id,
  scriptLockPackageId: sampleMovieScriptLock.id,
  productionBlockLockId: sampleProductionBlockLock.id,
  approvedBy: "director",
  createdAt: 1710000000450,
});
assert.equal(approvedCastingDecision.schemaVersion, "casting-decision.v1");
assert.equal(validateCastingDecision(approvedCastingDecision).some((issue) => issue.severity === "blocking"), false);
const operatorCastingDecisionArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "casting_decision",
  targetPath: `operator.productionCasting.decisions.${approvedCastingDecision.id}`,
  entityIds: ["operator-project", approvedCastingDecision.castingRequirementId, approvedCastingDecision.roleSlotId],
  data: { castingDecision: approvedCastingDecision },
}, operatorRun);
const autoCastingDecisionVerdict = runOperatorArtifactQA({ artifact: operatorCastingDecisionArtifact });
assert.equal(autoCastingDecisionVerdict?.qaAgentId, "operator.artifact.casting_decision.qa");
assert.equal(autoCastingDecisionVerdict?.blocking, false, JSON.stringify(autoCastingDecisionVerdict?.issues, null, 2));
const departmentPrepPackages = buildDepartmentPrepPackages(productionPrepProject, productionBreakdownReport, 1710000000500);
const departmentPrepByDepartment = new Map(departmentPrepPackages.map((pack) => [pack.department, pack]));
assert.ok(departmentPrepByDepartment.has("cinematography"));
assert.ok(departmentPrepByDepartment.has("lighting"));
assert.ok(departmentPrepByDepartment.has("production_design"));
assert.ok(departmentPrepByDepartment.has("wardrobe"));
assert.ok(departmentPrepByDepartment.has("makeup_hair"));
assert.ok(departmentPrepByDepartment.has("performance_directing"));
assert.ok(departmentPrepByDepartment.has("action_choreography"));
assert.ok(departmentPrepPackages.some((pack) => pack.department === "wardrobe_makeup" && pack.variants.length > 0));
assert.ok(departmentPrepPackages.some((pack) => pack.department === "props" && pack.requiredAssets.some((asset) => asset.assetId === "prop-ticket")));
assert.ok(departmentPrepPackages.every((pack) => Array.isArray(pack.qaChecklist) && pack.qaChecklist.length > 0));
assert.ok(departmentPrepPackages.every((pack) => Array.isArray(pack.sceneRefs)));
assert.ok(departmentPrepPackages.every((pack) => pack.departmentPlanType));
assert.equal((departmentPrepByDepartment.get("cinematography")?.specialistPayload as any)?.schemaVersion, "cinematography-prep.v1");
assert.ok(((departmentPrepByDepartment.get("cinematography")?.specialistPayload as any)?.coveragePlan || []).some((plan: any) => plan.shotRefs.includes("shot-a-1")));
assert.equal((departmentPrepByDepartment.get("lighting")?.specialistPayload as any)?.schemaVersion, "lighting-prep.v1");
assert.ok(((departmentPrepByDepartment.get("lighting")?.specialistPayload as any)?.lightingPlan || []).some((plan: any) => plan.title === "废弃法庭对峙"));
assert.equal((departmentPrepByDepartment.get("production_design")?.specialistPayload as any)?.schemaVersion, "production-design-prep.v1");
assert.equal((departmentPrepByDepartment.get("wardrobe")?.specialistPayload as any)?.schemaVersion, "wardrobe-prep.v1");
assert.ok(((departmentPrepByDepartment.get("wardrobe")?.specialistPayload as any)?.wardrobeStates || []).some((state: any) => state.wardrobe.includes("深灰风衣湿透")));
assert.equal((departmentPrepByDepartment.get("makeup_hair")?.specialistPayload as any)?.schemaVersion, "makeup-hair-prep.v1");
assert.ok(((departmentPrepByDepartment.get("makeup_hair")?.specialistPayload as any)?.makeupHairStates || []).some((state: any) => state.makeupHair.includes("额前湿发")));
assert.equal((departmentPrepByDepartment.get("performance_directing")?.specialistPayload as any)?.schemaVersion, "performance-directing-prep.v1");
assert.equal((departmentPrepByDepartment.get("action_choreography")?.specialistPayload as any)?.schemaVersion, "action-choreography-prep.v1");
assert.ok(((departmentPrepByDepartment.get("action_choreography")?.specialistPayload as any)?.actionBeats || []).some((beat: any) => beat.title === "门口追逐"));
assert.equal(validateDepartmentPrepPackages(departmentPrepPackages).some((issue) => issue.severity === "blocking"), false);
const operatorDepartmentPrepArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "department_prep_package",
  targetPath: "operator.productionPrep.departmentPrep.ep-1",
  entityIds: ["operator-project", "ep-1"],
  data: { departmentPrepPackages },
}, operatorRun);
const autoDepartmentPrepVerdict = runOperatorArtifactQA({ artifact: operatorDepartmentPrepArtifact });
assert.equal(autoDepartmentPrepVerdict?.qaAgentId, "operator.artifact.department_prep_package.qa");
assert.equal(autoDepartmentPrepVerdict?.blocking, false, JSON.stringify(autoDepartmentPrepVerdict?.issues, null, 2));
const runPhase12DepartmentCoverageSelfChecks = () => {
  const productionDepartmentCoverage = buildProductionDepartmentCoverage(buildProductionCoordinationSnapshot({
    project: productionPrepProject,
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "storyboard",
    runId: operatorRun.id,
    environment: "test",
  }));
  assert.equal(productionDepartmentCoverage.schemaVersion, "production-department-coverage.v1");
  assert.equal(productionDepartmentCoverage.coverageMode, "active");
  assert.ok(productionDepartmentCoverage.requiredDepartments.includes("cinematography"));
  assert.ok(productionDepartmentCoverage.requiredDepartments.includes("lighting"));
  assert.ok(productionDepartmentCoverage.requiredDepartments.includes("performance_directing"));
  assert.ok(productionDepartmentCoverage.requiredDepartments.includes("action_choreography"));
  assert.equal(productionDepartmentCoverage.missingRequiredDepartments.length, 0, JSON.stringify(productionDepartmentCoverage.missingDepartmentPackages, null, 2));
  assert.ok(productionDepartmentCoverage.departments.some((item) => item.department === "wardrobe" && item.hasSpecialistPayload));
  assert.ok(productionDepartmentCoverage.perSceneReadiness.some((row) => row.sceneId === "scene-b" && row.readyDepartments.includes("action_choreography")));

  const sampleMinimalDepartmentPrepPackages = departmentPrepPackages.filter((pack) =>
    !["wardrobe", "makeup_hair", "production_design", "props", "wardrobe_makeup", "location_art"].includes(pack.department),
  );
  const operatorSampleMinimalDepartmentPrepArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.sample-minimal",
    entityIds: ["operator-project", "ep-1"],
    data: { departmentPrepPackages: sampleMinimalDepartmentPrepPackages },
  }, operatorRun);
  const sampleModeCoverage = buildProductionDepartmentCoverage(buildProductionCoordinationSnapshot({
    project: {
      ...productionPrepProject,
      productionMode: "ai-video-sample",
    },
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorSampleMinimalDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "storyboard",
    runId: operatorRun.id,
    environment: "test",
  }));
  assert.equal(sampleModeCoverage.projectMode, "ai-video-sample");
  assert.ok(sampleModeCoverage.requiredDepartments.includes("cinematography"));
  assert.ok(sampleModeCoverage.requiredDepartments.includes("lighting"));
  assert.ok(sampleModeCoverage.requiredDepartments.includes("performance_directing"));
  assert.equal(sampleModeCoverage.requiredDepartments.includes("wardrobe"), false);
  assert.equal(sampleModeCoverage.requiredDepartments.includes("production_design"), false);
  assert.equal(sampleModeCoverage.missingRequiredDepartments.includes("wardrobe"), false);
  assert.equal(sampleModeCoverage.missingRequiredDepartments.includes("props"), false);

  const legacyAliasDepartmentPrepPackages = departmentPrepPackages.filter((pack) =>
    !["wardrobe", "makeup_hair", "production_design"].includes(pack.department),
  );
  const operatorLegacyAliasDepartmentPrepArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.legacy-alias",
    entityIds: ["operator-project", "ep-1"],
    data: { departmentPrepPackages: legacyAliasDepartmentPrepPackages },
  }, operatorRun);
  const legacyAliasCoverage = buildProductionDepartmentCoverage(buildProductionCoordinationSnapshot({
    project: productionPrepProject,
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorLegacyAliasDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "storyboard",
    runId: operatorRun.id,
    environment: "test",
  }));
  assert.ok(legacyAliasCoverage.legacyAliasCoverage.some((item) => item.aliasDepartment === "wardrobe_makeup"));
  assert.ok(legacyAliasCoverage.legacyAliasCoverage.some((item) => item.aliasDepartment === "location_art"));
  assert.equal(legacyAliasCoverage.missingRequiredDepartments.includes("wardrobe"), false);
  assert.equal(legacyAliasCoverage.missingRequiredDepartments.includes("makeup_hair"), false);
  assert.equal(legacyAliasCoverage.missingRequiredDepartments.includes("production_design"), false);

  const missingActionDepartmentPrepPackages = departmentPrepPackages.filter((pack) => pack.department !== "action_choreography");
  const operatorMissingActionDepartmentPrepArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.missing-action",
    entityIds: ["operator-project", "ep-1"],
    data: { departmentPrepPackages: missingActionDepartmentPrepPackages },
  }, operatorRun);
  const missingActionCoordinationReport = buildProductionCoordinationReport({
    project: productionPrepProject,
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorMissingActionDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "storyboard",
    runId: operatorRun.id,
    environment: "test",
  });
  assert.ok(missingActionCoordinationReport.departmentFindings.some((finding) => finding.department === "department_coverage" && finding.severity === "blocking"));
  assert.ok(missingActionCoordinationReport.missingDepartmentPackages.some((item) => item.department === "action_choreography"));
  assert.ok(missingActionCoordinationReport.repairTickets.some((ticket) => ticket.targetPath === "coordination.department_coverage"));
  assert.ok(validateProductionCoordinationReport(missingActionCoordinationReport).some((issue) => issue.target === "productionCoordinationReport.approvalState") === false);

  const missingCameraLightingDepartmentPrepPackages = departmentPrepPackages.filter((pack) =>
    pack.department !== "cinematography" && pack.department !== "lighting",
  );
  const operatorMissingCameraLightingDepartmentPrepArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.missing-camera-lighting",
    entityIds: ["operator-project", "ep-1"],
    data: { departmentPrepPackages: missingCameraLightingDepartmentPrepPackages },
  }, operatorRun);
  const missingCameraLightingCoordinationReport = buildProductionCoordinationReport({
    project: productionPrepProject,
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorMissingCameraLightingDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "prompt",
    runId: operatorRun.id,
    environment: "test",
  });
  assert.ok(missingCameraLightingCoordinationReport.missingDepartmentPackages.some((item) => item.department === "cinematography"));
  assert.ok(missingCameraLightingCoordinationReport.missingDepartmentPackages.some((item) => item.department === "lighting"));
  assert.equal(missingCameraLightingCoordinationReport.approvalState, "blocked");

  const missingLightingPayloadPackages = departmentPrepPackages.map((pack) =>
    pack.department === "lighting" ? { ...pack, specialistPayload: undefined } : pack,
  );
  const operatorMissingLightingPayloadArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.missing-lighting-payload",
    entityIds: ["operator-project", "ep-1"],
    data: { departmentPrepPackages: missingLightingPayloadPackages },
  }, operatorRun);
  const missingLightingPayloadStageGate = buildProductionCoordinationStageGate({
    project: productionPrepProject,
    episodes: productionPrepProject.episodes,
    operatorArtifacts: [
      operatorProductionBreakdownArtifact,
      operatorMissingLightingPayloadArtifact,
    ],
    stageType: "storyboard",
    runId: operatorRun.id,
    environment: "test",
  });
  assert.equal(missingLightingPayloadStageGate.canProceed, true);
  assert.ok(missingLightingPayloadStageGate.report.departmentCoverage.departmentQaSummary.some((item) =>
    item.department === "lighting" && item.readiness === "needs_review" && item.resolutionClass === "soft_hold",
  ));
};
runPhase12DepartmentCoverageSelfChecks();
const runPhase12DepartmentRefSelfChecks = () => {
  assert.equal(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.schemaVersion, "video-storyboard-department-ref-integration.v1");
  assert.equal(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.status, "department_prep_refs_runtime_integrated");
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.requiredDepartments.includes("cinematography"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.requiredDepartments.includes("performance_directing"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.artifactFields.storyboard_board.includes("panels[].departmentRefIds"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.artifactFields.asset_reference_pack.includes("cameraRefs"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.artifactFields.video_generation_unit.includes("performanceRefs"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.qaIssueCodes.includes("VIDEO_UNIT_DEPARTMENT_REFS_MISSING"));
  assert.ok(capabilityManifest.videoStoryboardSystem.departmentPrepReferenceIntegration.runnerBehavior.some((rule) => rule.includes("ProductionRun")));
  const departmentRefOptions = {
    departmentPrepPackages,
    requireDepartmentPrepRefs: true,
  };
  const departmentStoryboardDrafts = buildProductionStoryboardBoardDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    departmentRefOptions,
  );
  assert.equal(
    departmentStoryboardDrafts.issues.some((issue) => issue.severity === "blocking"),
    false,
    JSON.stringify(departmentStoryboardDrafts.issues.filter((issue) => issue.severity === "blocking"), null, 2),
  );
  const sceneAStoryboardBoard = departmentStoryboardDrafts.storyboardBoards.find((board) => board.sceneId === "scene-a");
  const sceneBStoryboardBoard = departmentStoryboardDrafts.storyboardBoards.find((board) => board.sceneId === "scene-b");
  assert.ok(sceneAStoryboardBoard?.cinematographyRefs?.some((ref) => ref.schemaVersion === "cinematography-prep.v1"));
  assert.ok(sceneAStoryboardBoard?.lightingRefs?.some((ref) => ref.schemaVersion === "lighting-prep.v1"));
  assert.ok(sceneAStoryboardBoard?.performanceRefs?.some((ref) => ref.schemaVersion === "performance-directing-prep.v1"));
  assert.ok(sceneAStoryboardBoard?.lineArtPrompt.includes("表演导演"));
  assert.equal(sceneAStoryboardBoard?.lineArtPrompt.includes("performance-directing-prep.v1"), false);
  assert.ok(sceneAStoryboardBoard?.panels.every((panel) => panel.departmentRefIds?.some((refId) => refId.includes("performance_directing"))));
  assert.ok(sceneBStoryboardBoard?.actionRefs?.some((ref) => ref.schemaVersion === "action-choreography-prep.v1"));
  assert.ok(sceneBStoryboardBoard?.panels.some((panel) => panel.departmentRefIds?.some((refId) => refId.includes("action_choreography"))));

  const departmentPackDrafts = buildProductionAssetReferencePackDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    undefined,
    departmentRefOptions,
  );
  assert.equal(
    departmentPackDrafts.issues.some((issue) => issue.severity === "blocking"),
    false,
    JSON.stringify(departmentPackDrafts.issues.filter((issue) => issue.severity === "blocking"), null, 2),
  );
  const sceneAPack = departmentPackDrafts.assetReferencePacks.find((pack) => pack.sceneId === "scene-a");
  const sceneBPack = departmentPackDrafts.assetReferencePacks.find((pack) => pack.sceneId === "scene-b");
  assert.ok(sceneAPack?.cameraRefs?.some((ref) => ref.schemaVersion === "cinematography-prep.v1"));
  assert.ok(sceneAPack?.lightingRefs?.some((ref) => ref.schemaVersion === "lighting-prep.v1"));
  assert.ok(sceneAPack?.performanceRefs?.some((ref) => ref.schemaVersion === "performance-directing-prep.v1"));
  assert.ok(sceneAPack?.packagingNotes.includes("专业部门引用"));
  assert.ok(sceneBPack?.actionRefs?.some((ref) => ref.schemaVersion === "action-choreography-prep.v1"));

  // Entering a room quickly is ordinary blocking, not a choreography requirement.
  // Keep action-department gates for sustained combat, stunts, or dangerous movement.
  const ordinaryEntranceProject = structuredClone(productionPrepProject);
  const ordinaryEntranceEpisode = ordinaryEntranceProject.episodes[0];
  const ordinaryEntranceScene = ordinaryEntranceEpisode.scenes.find((scene: any) => scene.id === "scene-a")!;
  ordinaryEntranceScene.title = "主管冲进控制室";
  ordinaryEntranceScene.description = "主管冲进控制室，打断值班员的操作。";
  ordinaryEntranceScene.shots = ordinaryEntranceScene.shots.map((shot: any) => ({
    ...shot,
    visualAction: "主管从门口冲进控制室，停在控制台外侧。",
    blocking: "主管从右侧门口进入，停在控制台外侧。",
  }));
  const withoutActionPrepPackages = departmentPrepPackages.filter((pack) => pack.department !== "action_choreography");
  const ordinaryEntranceOptions = {
    departmentPrepPackages: withoutActionPrepPackages,
    requireDepartmentPrepRefs: true,
  };
  const ordinaryEntrancePackDrafts = buildProductionAssetReferencePackDrafts(
    ordinaryEntranceProject,
    ordinaryEntranceProject.episodes,
    undefined,
    ordinaryEntranceOptions,
  );
  assert.equal(
    ordinaryEntrancePackDrafts.issues.some((issue) =>
      issue.code === "ASSET_REFERENCE_PACK_DEPARTMENT_REFS_MISSING"
      && issue.target.includes(ordinaryEntranceScene.id)
      && issue.target.includes("action_choreography")),
    false,
    "ordinary entrance blocking must not require an action-choreography prep package",
  );
  const ordinaryEntranceVideoDrafts = buildProductionVideoGenerationUnitDrafts(
    ordinaryEntranceProject,
    ordinaryEntranceProject.episodes,
    ordinaryEntranceOptions,
  );
  assert.equal(
    ordinaryEntranceVideoDrafts.issues.some((issue) =>
      issue.code === "VIDEO_UNIT_DEPARTMENT_REFS_MISSING"
      && issue.target.includes(ordinaryEntranceScene.id)
      && issue.target.includes("action_choreography")),
    false,
    "video-unit gates must agree with asset-reference action semantics",
  );

  const departmentVideoUnitDrafts = buildProductionVideoGenerationUnitDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    departmentRefOptions,
  );
  assert.equal(
    departmentVideoUnitDrafts.issues.some((issue) => issue.severity === "blocking"),
    false,
    JSON.stringify(departmentVideoUnitDrafts.issues.filter((issue) => issue.severity === "blocking"), null, 2),
  );
  const sceneAVideoUnit = departmentVideoUnitDrafts.videoGenerationUnits.find((unit) => unit.sceneId === "scene-a");
  const sceneBVideoUnit = departmentVideoUnitDrafts.videoGenerationUnits.find((unit) => unit.sceneId === "scene-b");
  assert.ok(sceneAVideoUnit?.cameraRefs?.some((ref) => ref.schemaVersion === "cinematography-prep.v1"));
  assert.ok(sceneAVideoUnit?.performanceRefs?.some((ref) => ref.schemaVersion === "performance-directing-prep.v1"));
  assert.ok(sceneAVideoUnit?.videoPrompt.includes("表演导演"));
  assert.equal(sceneAVideoUnit?.videoPrompt.includes("performance-directing-prep.v1"), false);
  assert.ok(sceneBVideoUnit?.actionRefs?.some((ref) => ref.schemaVersion === "action-choreography-prep.v1"));

  const missingPerformanceDepartmentPrepPackages = departmentPrepPackages.filter((pack) => pack.department !== "performance_directing");
  const missingPerformanceOptions = {
    departmentPrepPackages: missingPerformanceDepartmentPrepPackages,
    requireDepartmentPrepRefs: true,
  };
  const missingPerformanceStoryboardDrafts = buildProductionStoryboardBoardDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    missingPerformanceOptions,
  );
  assert.ok(missingPerformanceStoryboardDrafts.issues.some((issue) =>
    issue.severity === "blocking" &&
    issue.code === "STORYBOARD_BOARD_DEPARTMENT_REFS_MISSING" &&
    issue.target.includes("performance_directing"),
  ));
  const missingPerformancePackDrafts = buildProductionAssetReferencePackDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    undefined,
    missingPerformanceOptions,
  );
  assert.ok(missingPerformancePackDrafts.issues.some((issue) =>
    issue.severity === "blocking" &&
    issue.code === "ASSET_REFERENCE_PACK_DEPARTMENT_REFS_MISSING" &&
    issue.target.includes("performance_directing"),
  ));
  const missingPerformanceVideoUnitDrafts = buildProductionVideoGenerationUnitDrafts(
    productionPrepProject,
    productionPrepProject.episodes,
    missingPerformanceOptions,
  );
  assert.ok(missingPerformanceVideoUnitDrafts.issues.some((issue) =>
    issue.severity === "blocking" &&
    issue.code === "VIDEO_UNIT_DEPARTMENT_REFS_MISSING" &&
    issue.target.includes("performance_directing"),
  ));
};
runPhase12DepartmentRefSelfChecks();
const continuityMatrix = buildContinuityMatrix({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  productionBreakdownReport,
  departmentPrepPackages,
  createdAt: 1710000000525,
});
assert.equal(continuityMatrix.schemaVersion, "continuity-matrix.v1");
assert.equal(continuityMatrix.sourceRefs.productionBreakdownReportId, productionBreakdownReport.id);
assert.ok(continuityMatrix.rows.length > 0);
assert.ok(continuityMatrix.rows.some((row) => row.targetType === "character" && row.targetId === "char-lead"));
assert.ok(continuityMatrix.rows.some((row) => row.targetType === "wardrobe_makeup"));
assert.ok(continuityMatrix.rows.some((row) => row.targetType === "location" && row.targetId === "loc-court"));
assert.ok(continuityMatrix.rows
  .filter((row) => row.targetType === "character" && row.targetId === "char-lead")
  .every((row) => !/深灰风衣|湿发|擦伤/.test(row.visibleState)), "character continuity must not absorb scene-level wardrobe/makeup state");
assert.ok(continuityMatrix.rows
  .filter((row) => row.targetType === "time_weather")
  .every((row) => row.targetId === "loc-court" && row.targetName.includes("废弃法庭")), "time/weather continuity must be scoped to its location");
assert.ok(departmentPrepPackages
  .filter((item) => item.department === "continuity")
  .flatMap((item) => item.continuityInOut)
  .filter((item) => item.targetId === "char-lead")
  .every((item) => !/深灰风衣|湿发|擦伤/.test(`${item.inState} ${item.outState}`)), "department handoffs must keep wardrobe/makeup in their own continuity rows");
assert.equal(validateContinuityMatrix(continuityMatrix).some((issue) => issue.severity === "blocking"), false, JSON.stringify(validateContinuityMatrix(continuityMatrix), null, 2));
const operatorContinuityMatrixArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "continuity_matrix",
  targetPath: `operator.productionPrep.continuity.${continuityMatrix.id}`,
  entityIds: ["operator-project", "ep-1", "scene-a", "scene-b"],
  data: { continuityMatrix },
}, operatorRun);
const autoContinuityMatrixVerdict = runOperatorArtifactQA({ artifact: operatorContinuityMatrixArtifact });
assert.equal(autoContinuityMatrixVerdict?.qaAgentId, "operator.artifact.continuity_matrix.qa");
assert.equal(autoContinuityMatrixVerdict?.blocking, false, JSON.stringify(autoContinuityMatrixVerdict?.issues, null, 2));
const productionPrepCockpit = buildProductionCockpit({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  operatorArtifacts: [
    createOperatorArtifact({
      runId: operatorRun.id,
      kind: "script_lock_package",
      targetPath: "operator.productionLocks.script.prep",
      entityIds: [productionPrepProject.id],
      data: { scriptLockPackage: sampleMovieScriptLock },
    }, operatorRun),
    createOperatorArtifact({
      runId: operatorRun.id,
      kind: "production_block_lock",
      targetPath: "operator.productionLocks.block.prep",
      entityIds: [productionPrepProject.id],
      data: { productionBlockLock: sampleProductionBlockLock },
    }, operatorRun),
    operatorProductionBreakdownArtifact,
    operatorRoleSlotArtifact,
    operatorCastingArtifact,
    operatorCastingCandidateArtifact,
    operatorCastingDecisionArtifact,
    operatorDepartmentPrepArtifact,
    operatorContinuityMatrixArtifact,
  ],
  operatorRunId: operatorRun.id,
  stageType: "production_asset_detail",
  environment: "test",
  capturedAt: 1710000000550,
});
assert.equal(productionPrepCockpit.productionPrep.latestBreakdown?.id, productionBreakdownReport.id);
assert.equal(productionPrepCockpit.productionPrep.sceneMatrix.length, productionBreakdownReport.sceneMatrix.length);
assert.equal(productionPrepCockpit.productionPrep.roleSlots.length, roleSlots.length);
assert.equal(productionPrepCockpit.productionPrep.castingRequirements.length, castingRequirements.length);
assert.equal(productionPrepCockpit.productionPrep.castingCandidates.length, castingCandidates.length);
assert.equal(productionPrepCockpit.productionPrep.castingDecisions.length, 1);
assert.equal(productionPrepCockpit.productionContinuity.latestMatrix?.id, continuityMatrix.id);
assert.equal(productionPrepCockpit.productionContinuity.rows.length, continuityMatrix.rows.length);
assert.equal(productionPrepCockpit.productionSchedule.currentBlockReady, true);
assert.equal(productionPrepCockpit.productionSchedule.scope, "full_series");
assert.equal(productionPrepCockpit.productionPrep.totals.approvedCastingDecisions, 1);
assert.equal(productionPrepCockpit.productionPrep.totals.roleSlots, roleSlots.length);
assert.equal(productionPrepCockpit.productionPrep.totals.castingCandidates, castingCandidates.length);
assert.ok(productionPrepCockpit.productionPrep.castingRequirements.some((requirement) => requirement.latestDecisionStatus === "approved"));
assert.ok(productionPrepCockpit.productionPrep.castingRequirements.some((requirement) => requirement.candidateCount > 0));
assert.ok(productionPrepCockpit.productionPrep.roleSlots.some((slot) => slot.candidateCount > 0));
assert.equal(productionPrepCockpit.productionPrep.departmentPrepPackages.length, departmentPrepPackages.length);
assert.ok(productionPrepCockpit.productionPrep.departmentPrepPackages.some((pack) => pack.department === "props" && pack.requiredAssetCount > 0));
assert.ok(productionPrepCockpit.productionPrep.castingRequirements.some((requirement) => requirement.characterId === "char-lead"));
assert.equal(productionPrepCockpit.departmentCoverage.schemaVersion, "production-department-coverage.v1");
assert.equal(productionPrepCockpit.missingDepartmentPackages.length, 0);
assert.ok(productionPrepCockpit.departmentQaSummary.some((item) => item.department === "cinematography" && item.readiness === "ready"));
assert.ok(productionPrepCockpit.departmentCoverage.perSceneReadiness.some((row) => row.sceneId === "scene-b" && row.readyDepartments.includes("action_choreography")));
assert.equal(productionPrepCockpit.counts.departmentCoverageBlocked, 0);
const productionRunCheckpointSource = createProductionRun(productionPrepProject);
const productionBreakdownStageForCheckpoint = productionRunCheckpointSource.stages.find((stage) => stage.stageType === "production_breakdown");
assert.ok(productionBreakdownStageForCheckpoint);
const checkpointOnlyProductionRun = {
  ...productionRunCheckpointSource,
  checkpoints: [
    {
      id: "checkpoint-phase11-production-breakdown",
      stageId: productionBreakdownStageForCheckpoint.id,
      kind: "output" as const,
      snapshot: {
        scriptLockPackage: sampleMovieScriptLock,
        productionBlockLock: sampleProductionBlockLock,
        productionBreakdownReport,
        continuityMatrix,
        roleSlots,
        castingRequirements,
        departmentPrepPackages,
        castingDecisions: [approvedCastingDecision],
      },
      note: "PHASE-11 production run checkpoint should feed production-cockpit.",
      createdAt: 1710000000555,
    },
  ],
};
const productionRunCheckpointCockpit = buildProductionCockpit({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  productionRuns: [checkpointOnlyProductionRun],
  productionRunId: checkpointOnlyProductionRun.id,
  stageType: "production_asset_detail",
  environment: "test",
  capturedAt: 1710000000556,
});
assert.equal(productionRunCheckpointCockpit.productionPrep.latestBreakdown?.id, productionBreakdownReport.id);
assert.equal(productionRunCheckpointCockpit.productionPrep.castingRequirements.length, castingRequirements.length);
assert.equal(productionRunCheckpointCockpit.productionPrep.castingDecisions.length, 1);
assert.equal(productionRunCheckpointCockpit.productionContinuity.latestMatrix?.id, continuityMatrix.id);
const unselectedProductionRunSource = createProductionRun(productionPrepProject);
const unselectedBreakdownStageForCheckpoint = unselectedProductionRunSource.stages.find((stage) => stage.stageType === "production_breakdown");
assert.ok(unselectedBreakdownStageForCheckpoint);
const unselectedBreakdownReport = {
  ...productionBreakdownReport,
  id: "production-breakdown-report-unselected-newer",
  createdAt: 1710000000999,
};
const unselectedCheckpointRun = {
  ...unselectedProductionRunSource,
  id: "production-run-unselected-phase11",
  updatedAt: 1710000000999,
  checkpoints: [
    {
      id: "checkpoint-phase11-unselected-production-breakdown",
      stageId: unselectedBreakdownStageForCheckpoint.id,
      kind: "output" as const,
      snapshot: {
        scriptLockPackage: sampleMovieScriptLock,
        productionBlockLock: sampleProductionBlockLock,
        productionBreakdownReport: unselectedBreakdownReport,
        continuityMatrix,
        roleSlots,
        castingRequirements,
        departmentPrepPackages,
        castingDecisions: [approvedCastingDecision],
      },
      note: "PHASE-11 production cockpit must not mix checkpoints from an unselected production run.",
      createdAt: 1710000000999,
    },
  ],
};
const selectedProductionRunCockpit = buildProductionCockpit({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  productionRuns: [checkpointOnlyProductionRun, unselectedCheckpointRun],
  productionRunId: checkpointOnlyProductionRun.id,
  stageType: "production_asset_detail",
  environment: "test",
  capturedAt: 1710000001000,
});
assert.equal(selectedProductionRunCockpit.productionPrep.latestBreakdown?.id, productionBreakdownReport.id);
const operatorScopedCockpitWithoutProductionRun = buildProductionCockpit({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  operatorArtifacts: [],
  productionRuns: [checkpointOnlyProductionRun],
  operatorRunId: "operator-run-without-production-run-scope",
  stageType: "production_asset_detail",
  environment: "test",
  capturedAt: 1710000001001,
});
assert.equal(operatorScopedCockpitWithoutProductionRun.productionPrep.latestBreakdown, undefined);
const developmentOnlyAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(productionPrepProject);
assert.equal(developmentOnlyAssetBoardPlan.productionReadiness, "development_only");
assert.equal(developmentOnlyAssetBoardPlan.formalAssetIntent, false);
assert.ok(developmentOnlyAssetBoardPlan.characterBoards.every((board) => board.productionUse === "development_reference"));
const developmentOnlyAssetBoardIssues = validateVideoStoryboardAssetBoardPlan(developmentOnlyAssetBoardPlan, productionPrepProject);
assert.equal(developmentOnlyAssetBoardIssues.some((issue) => issue.severity === "blocking"), false);
assert.ok(developmentOnlyAssetBoardIssues.some((issue) => issue.code === "ASSET_BOARD_DEVELOPMENT_ONLY"));
const blockedFormalAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(productionPrepProject, { formalAssetIntent: true });
assert.equal(blockedFormalAssetBoardPlan.productionReadiness, "formal_blocked");
assert.ok(blockedFormalAssetBoardPlan.formalAssetBlockers.some((blocker) => blocker.includes("script_lock_package")));
assert.ok(validateVideoStoryboardAssetBoardPlan(blockedFormalAssetBoardPlan, productionPrepProject).some((issue) =>
  issue.severity === "blocking" && issue.code === "FORMAL_ASSET_BOARD_LOCK_MISSING",
));
const formalProductionAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(productionPrepProject, {
  formalAssetIntent: true,
  scriptLockPackage: sampleMovieScriptLock,
  productionBlockLock: sampleProductionBlockLock,
  productionBreakdownReport,
  castingRequirements,
  castingDecisions: [approvedCastingDecision],
  departmentPrepPackages,
});
assert.equal(formalProductionAssetBoardPlan.productionReadiness, "formal_ready");
assert.equal(formalProductionAssetBoardPlan.productionPrepRefs.scriptLockPackageId, sampleMovieScriptLock.id);
assert.equal(formalProductionAssetBoardPlan.productionPrepRefs.productionBreakdownReportId, productionBreakdownReport.id);
assert.ok(formalProductionAssetBoardPlan.productionPrepRefs.castingRequirementIds.length > 0);
assert.ok(formalProductionAssetBoardPlan.productionPrepRefs.castingDecisionIds.includes(approvedCastingDecision.id));
assert.ok(formalProductionAssetBoardPlan.productionPrepRefs.departmentPrepPackageIds.length > 0);
assert.ok([
  ...formalProductionAssetBoardPlan.characterBoards,
  ...formalProductionAssetBoardPlan.sceneBoards,
  ...formalProductionAssetBoardPlan.propBoards,
  ...formalProductionAssetBoardPlan.variantBoards,
].every((board) => board.productionUse === "formal_asset_board"));
assert.equal(validateVideoStoryboardAssetBoardPlan(formalProductionAssetBoardPlan, productionPrepProject).some((issue) => issue.severity === "blocking"), false);
const formalAssetPackage = buildFormalAssetPackage({
  project: productionPrepProject,
  assetBoardPlan: formalProductionAssetBoardPlan,
  productionBreakdownReport,
  castingDecisions: [approvedCastingDecision],
  departmentPrepPackages,
  createdAt: 1710000000560,
});
assert.equal(formalAssetPackage.schemaVersion, "formal-asset-package.v1");
assert.equal(formalAssetPackage.status, "ready_for_department_review");
assert.equal(formalAssetPackage.productionReadiness, "formal_ready");
assert.ok(formalAssetPackage.sourceRefs.castingDecisionIds.includes(approvedCastingDecision.id));
assert.ok(formalAssetPackage.identityBoards.length > 0);
assert.ok(formalAssetPackage.identityBoards.every((board) => board.productionUse === "formal_asset_board"));
assert.ok(formalAssetPackage.identityBoards.some((board) => board.usageRefs.some((ref) => ref.sceneId === "scene-a")));
assert.equal(validateFormalAssetPackage(formalAssetPackage).some((issue) => issue.severity === "blocking"), false);
const operatorFormalAssetPackageArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "formal_asset_package",
  targetPath: `operator.formalAssets.${formalAssetPackage.id}`,
  entityIds: ["operator-project", ...formalAssetPackage.identityBoards.map((board) => board.assetId)],
  data: { formalAssetPackage },
}, operatorRun);
const autoFormalAssetPackageVerdict = runOperatorArtifactQA({ artifact: operatorFormalAssetPackageArtifact });
assert.equal(autoFormalAssetPackageVerdict?.qaAgentId, "operator.artifact.formal_asset_package.qa");
assert.equal(autoFormalAssetPackageVerdict?.blocking, false, JSON.stringify(autoFormalAssetPackageVerdict?.issues, null, 2));
const operatorAssetIdentityBoardArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "asset_identity_board",
  targetPath: `operator.formalAssets.${formalAssetPackage.id}.identityBoards`,
  entityIds: formalAssetPackage.identityBoards.map((board) => board.id),
  data: { formalAssetPackage },
}, operatorRun);
const autoAssetIdentityBoardVerdict = runOperatorArtifactQA({ artifact: operatorAssetIdentityBoardArtifact });
assert.equal(autoAssetIdentityBoardVerdict?.qaAgentId, "operator.artifact.asset_identity_board.qa");
assert.equal(autoAssetIdentityBoardVerdict?.blocking, false, JSON.stringify(autoAssetIdentityBoardVerdict?.issues, null, 2));
const blockedMissingCastingDecisionAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(productionPrepProject, {
  formalAssetIntent: true,
  scriptLockPackage: sampleMovieScriptLock,
  productionBlockLock: sampleProductionBlockLock,
  productionBreakdownReport,
  castingRequirements,
  departmentPrepPackages,
});
assert.equal(blockedMissingCastingDecisionAssetBoardPlan.productionReadiness, "formal_blocked");
assert.ok(blockedMissingCastingDecisionAssetBoardPlan.formalAssetBlockers.some((blocker) => blocker.includes("casting_decision")));
const blockedFormalSceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(productionPrepProject, productionPrepProject.episodes, formalProductionAssetBoardPlan, { requireProductionPrep: true });
assert.ok(blockedFormalSceneVisualPackDrafts.issues.some((issue) =>
  issue.severity === "blocking" && issue.code === "SCENE_VISUAL_PACK_PRODUCTION_BREAKDOWN_MISSING",
));
const formalSceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(productionPrepProject, productionPrepProject.episodes, formalProductionAssetBoardPlan, {
  productionBreakdownReport,
  departmentPrepPackages,
  requireProductionPrep: true,
});
assert.equal(formalSceneVisualPackDrafts.issues.some((issue) => issue.severity === "blocking"), false, JSON.stringify(formalSceneVisualPackDrafts.issues, null, 2));
assert.deepEqual(new Set(formalSceneVisualPackDrafts.packSceneIds), new Set(["scene-a", "scene-b"]));
assert.ok(formalSceneVisualPackDrafts.sceneVisualPacks.every((pack) =>
  pack.qaChecklist.some((item) => item.includes(`production_breakdown_report：${productionBreakdownReport.id}`)),
));
const baseReusableSceneVisualPack = formalSceneVisualPackDrafts.sceneVisualPacks[0];
assert.ok(baseReusableSceneVisualPack);
const duplicateSceneVisualPacks = ["scene-a", "scene-b", "scene-c"].map((sceneId, index) => ({
  ...baseReusableSceneVisualPack,
  id: `${baseReusableSceneVisualPack.id}.reuse-${index + 1}`,
  sourceSceneIds: [sceneId],
  linkedSceneIds: [sceneId],
}));
const reusableSceneAssetVariantPacks = buildSceneAssetVariantPacks({
  projectId: productionPrepProject.id,
  formalAssetPackage,
  sceneVisualPacks: duplicateSceneVisualPacks,
  createdAt: 1710000000565,
});
assert.equal(reusableSceneAssetVariantPacks.length, 1);
assert.equal(reusableSceneAssetVariantPacks[0].readiness, "reusable");
assert.deepEqual(new Set(reusableSceneAssetVariantPacks[0].linkedSceneIds), new Set(["scene-a", "scene-b", "scene-c"]));
assert.ok(reusableSceneAssetVariantPacks[0].variantFingerprints.length > 0);
assert.equal(validateSceneAssetVariantPacks(reusableSceneAssetVariantPacks).some((issue) => issue.severity === "blocking"), false);
const operatorSceneAssetVariantPackArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "scene_asset_variant_pack",
  targetPath: "operator.formalAssets.sceneAssetVariantPacks",
  entityIds: reusableSceneAssetVariantPacks.map((pack) => pack.id),
  data: { sceneAssetVariantPacks: reusableSceneAssetVariantPacks },
}, operatorRun);
const autoSceneAssetVariantPackVerdict = runOperatorArtifactQA({ artifact: operatorSceneAssetVariantPackArtifact });
assert.equal(autoSceneAssetVariantPackVerdict?.qaAgentId, "operator.artifact.scene_asset_variant_pack.qa");
assert.equal(autoSceneAssetVariantPackVerdict?.blocking, false, JSON.stringify(autoSceneAssetVariantPackVerdict?.issues, null, 2));
const operatorAssetVariantFingerprintArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "asset_variant_fingerprint",
  targetPath: "operator.formalAssets.assetVariantFingerprints",
  entityIds: reusableSceneAssetVariantPacks.flatMap((pack) => pack.variantFingerprints.map((fingerprint) => fingerprint.id)),
  data: { sceneAssetVariantPacks: reusableSceneAssetVariantPacks },
}, operatorRun);
const autoAssetVariantFingerprintVerdict = runOperatorArtifactQA({ artifact: operatorAssetVariantFingerprintArtifact });
assert.equal(autoAssetVariantFingerprintVerdict?.qaAgentId, "operator.artifact.asset_variant_fingerprint.qa");
assert.equal(autoAssetVariantFingerprintVerdict?.blocking, false, JSON.stringify(autoAssetVariantFingerprintVerdict?.issues, null, 2));
const legacyProductionDraft = buildLegacyProductionLockDraftBundle({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  createdAt: 1710000000575,
});
assert.equal(legacyProductionDraft.scriptLockPackage?.approvalState, "draft");
assert.equal(legacyProductionDraft.productionBlockLock.status, "draft");
assert.ok(legacyProductionDraft.migrationNotes.some((note) => note.includes("legacy_unlocked")));
assert.ok(legacyProductionDraft.developmentAssetBriefs.length > 0);
assert.ok(legacyProductionDraft.developmentAssetBriefs.every((brief) => brief.productionReady === false));
assert.ok(legacyProductionDraft.developmentAssetBriefs.every((brief) => brief.notProductionReadyReason.includes("legacy_unlocked")));
assert.equal(validateDevelopmentAssetBrief(legacyProductionDraft.developmentAssetBriefs[0]).some((issue) => issue.severity === "blocking"), false);
assert.equal(legacyProductionDraft.legacyAssetPackageDraft.productionReady, false);
assert.ok(legacyProductionDraft.legacyAssetPackageDraft.developmentAssetBriefIds.length === legacyProductionDraft.developmentAssetBriefs.length);
assert.ok(legacyProductionDraft.legacyAssetPackageDraft.formalAssetBlockedReason.includes("formal_asset_package"));
assert.equal(validateScriptLockPackage(legacyProductionDraft.scriptLockPackage).some((issue) => issue.severity === "warning"), true);
assert.equal(validateProductionBlockLock(legacyProductionDraft.productionBlockLock).some((issue) => issue.severity === "warning"), true);
const legacyProductionBreakdownReport = buildProductionBreakdownReport({
  project: productionPrepProject,
  episodes: productionPrepProject.episodes,
  scriptLockPackage: legacyProductionDraft.scriptLockPackage,
  productionBlockLock: legacyProductionDraft.productionBlockLock,
  createdAt: 1710000000580,
});
assert.equal(legacyProductionBreakdownReport.sceneMatrix.length, productionBreakdownReport.sceneMatrix.length);
const hundredEpisodeBlockProject = {
  id: "hundred-episode-project",
  title: "百集批次锁样例",
  type: "tv-series",
  projectModel: "linear",
  aspectRatio: "16:9",
  targetEpisodeCount: 100,
  logline: "百集长剧按生产批次推进。",
  coreConflict: "当前只锁定第一批，不能伪装全剧 ready。",
  characters: [{ id: "char-series-lead", name: "许知微", internalDesire: "守住家族", externalGoal: "查清旧案", flaw: "过度隐忍" }],
  assets: [{ id: "loc-series-house", type: "location", name: "许家旧宅", description: "老宅正厅" }],
  episodes: Array.from({ length: 10 }, (_, index) => ({
    id: `ep-${index + 1}`,
    title: `第 ${index + 1} 集`,
    inspiration: "批次锁测试",
    scenes: [{
      id: `scene-${index + 1}`,
      title: `旧宅场 ${index + 1}`,
      description: "许知微在旧宅发现线索。",
      script: "许知微走进旧宅正厅。",
      scriptBlocks: [{ id: `sb-${index + 1}`, type: "action", content: "许知微推门进入。", locationId: "loc-series-house" }],
      shots: [{ id: `shot-${index + 1}`, characterIdsInShot: ["char-series-lead"], locationId: "loc-series-house", visualAction: "推门进入旧宅。", duration: 3 }],
      breakdown: {
        setting: "INT.",
        location: { name: "许家旧宅", state: "白天" },
        time: "DAY",
        characters: [{ name: "许知微", state: "素色外套" }],
        props: [],
        characterIds: ["char-series-lead"],
        locationId: "loc-series-house",
        wardrobe: ["素色外套"],
        makeupHair: ["低马尾"],
        vfx: [],
        sfx: ["木门声"],
        vehicles: [],
        extrasAtmosphere: [],
        specialEquipment: [],
        bgm: [],
        assetVariantMap: {
          "char-series-lead": "variant-plain-coat",
          "loc-series-house": "variant-day",
        },
      },
    }],
  })),
} as any;
const hundredEpisodeIds = hundredEpisodeBlockProject.episodes.map((episode: any) => episode.id);
const hundredSceneIds = hundredEpisodeBlockProject.episodes.flatMap((episode: any) => episode.scenes.map((scene: any) => scene.id));
const blockScriptLockPackage = {
  schemaVersion: "script-lock-package.v1" as const,
  id: "script-lock-hundred-ep-1-10",
  projectId: hundredEpisodeBlockProject.id,
  format: "tv-series" as const,
  lockScope: "episode_block" as const,
  episodeIds: hundredEpisodeIds,
  sceneIds: hundredSceneIds,
  scriptRevision: "season-r1-block-1-10",
  coverageRatio: 0.1,
  scriptCoverage: {
    expectedEpisodeCount: 100,
    lockedEpisodeCount: 10,
    expectedSceneCount: hundredSceneIds.length,
    lockedSceneCount: hundredSceneIds.length,
  },
  approvedBy: "showrunner",
  approvalState: "approved" as const,
  unlockedRisks: ["目标 100 集中当前只锁定 1-10 集。"],
  lockedAt: 1710000000600,
};
const hundredProductionBlockLock = {
  schemaVersion: "production-block-lock.v1" as const,
  id: "production-block-lock-hundred-ep-1-10",
  projectId: hundredEpisodeBlockProject.id,
  blockId: "ep-1-10",
  mode: "tv-series" as const,
  lockType: "episode_block" as const,
  episodeIds: hundredEpisodeIds,
  sceneIds: hundredSceneIds,
  nodeIds: [],
  scriptLockPackageId: blockScriptLockPackage.id,
  entryCriteria: ["season structure approved", "episodes 1-10 scripts approved"],
  exitCriteria: ["production breakdown complete", "formal asset board ready for block"],
  openDependencies: ["episodes 11-100 remain unlocked"],
  status: "locked" as const,
  lockedAt: 1710000000600,
};
const hundredBlockBreakdownReport = buildProductionBreakdownReport({
  project: hundredEpisodeBlockProject,
  episodes: hundredEpisodeBlockProject.episodes,
  scriptLockPackage: blockScriptLockPackage,
  productionBlockLock: hundredProductionBlockLock,
  createdAt: 1710000000700,
});
const hundredGovernance = buildProductionSeriesGovernanceSnapshot({
  project: hundredEpisodeBlockProject,
  episodes: hundredEpisodeBlockProject.episodes,
  scriptLockPackages: [blockScriptLockPackage],
  productionBlockLocks: [hundredProductionBlockLock],
  productionBreakdownReports: [hundredBlockBreakdownReport],
});
assert.equal(hundredGovernance.lockStatus, "partially_locked");
assert.equal(hundredGovernance.scriptCoverage.targetEpisodeCount, 100);
assert.equal(hundredGovernance.scriptCoverage.lockedEpisodeCount, 10);
assert.equal(hundredGovernance.scriptCoverage.missingEpisodeCount, 90);
assert.equal(hundredGovernance.assetPrepReadiness.scope, "current_block_only");
assert.equal(hundredGovernance.assetPrepReadiness.currentBlockReady, true);
assert.equal(hundredGovernance.assetPrepReadiness.fullSeriesReady, false);
assert.equal(validateProductionSeriesGovernanceSnapshot(hundredGovernance).some((issue) => issue.severity === "blocking"), false, JSON.stringify(validateProductionSeriesGovernanceSnapshot(hundredGovernance), null, 2));
assert.ok(validateProductionSeriesGovernanceSnapshot(hundredGovernance, { requireFullSeriesReady: true }).some((issue) =>
  issue.severity === "blocking" && issue.target === "production_series_governance.fullSeriesReady",
));
const addEpisodeChangeOrder = buildSeriesChangeOrder({
  project: hundredEpisodeBlockProject,
  episodes: hundredEpisodeBlockProject.episodes,
  changeType: "add_episode",
  reason: "平台要求在第一批锁定后新增第 11 集作为付费钩子测试。",
  requestedChanges: [{
    targetType: "episode",
    operation: "add",
    targetId: "ep-11",
    title: "新增第 11 集",
    description: "新增一集承接第一批结尾的付费钩子。",
  }],
  scriptLockPackage: blockScriptLockPackage,
  productionBlockLock: hundredProductionBlockLock,
  productionBreakdownReport: hundredBlockBreakdownReport,
  targetEpisodeCountAfter: 101,
  createdAt: 1710000000800,
});
assert.equal(addEpisodeChangeOrder.schemaVersion, "series-change-order.v1");
assert.ok(addEpisodeChangeOrder.requiredReLocks.includes("script_lock_package"));
assert.ok(addEpisodeChangeOrder.requiredStageReruns.includes("production_breakdown"));
assert.ok(addEpisodeChangeOrder.staleArtifactKinds.includes("scene_visual_pack"));
assert.equal(validateSeriesChangeOrder(addEpisodeChangeOrder).some((issue) => issue.severity === "blocking"), false, JSON.stringify(validateSeriesChangeOrder(addEpisodeChangeOrder), null, 2));
assert.ok(validateSeriesChangeOrder({ ...addEpisodeChangeOrder, sourceLockIds: [] }).some((issue) =>
  issue.severity === "blocking" && issue.target === "series_change_order.sourceLockIds",
));
const operatorSeriesChangeOrderArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "series_change_order",
  targetPath: `operator.seriesChangeOrders.${addEpisodeChangeOrder.id}`,
  entityIds: [hundredEpisodeBlockProject.id, "ep-11"],
  data: { seriesChangeOrder: addEpisodeChangeOrder },
}, operatorRun);
const autoSeriesChangeOrderVerdict = runOperatorArtifactQA({ artifact: operatorSeriesChangeOrderArtifact });
assert.equal(autoSeriesChangeOrderVerdict?.qaAgentId, "operator.artifact.series_change_order.qa");
assert.equal(autoSeriesChangeOrderVerdict?.blocking, false, JSON.stringify(autoSeriesChangeOrderVerdict?.issues, null, 2));
const hundredGovernanceWithOpenChange = buildProductionSeriesGovernanceSnapshot({
  project: hundredEpisodeBlockProject,
  episodes: hundredEpisodeBlockProject.episodes,
  scriptLockPackages: [blockScriptLockPackage],
  productionBlockLocks: [hundredProductionBlockLock],
  productionBreakdownReports: [hundredBlockBreakdownReport],
  seriesChangeOrders: [addEpisodeChangeOrder],
});
assert.equal(hundredGovernanceWithOpenChange.changeOrders.openCount, 1);
assert.equal(hundredGovernanceWithOpenChange.assetPrepReadiness.currentBlockReady, false);
assert.ok(validateProductionSeriesGovernanceSnapshot(hundredGovernanceWithOpenChange).some((issue) =>
  issue.severity === "blocking" && issue.target === "production_series_governance.changeOrders",
));
const hundredCockpit = buildProductionCockpit({
  project: hundredEpisodeBlockProject,
  episodes: hundredEpisodeBlockProject.episodes,
  operatorArtifacts: [
    createOperatorArtifact({
      runId: operatorRun.id,
      kind: "script_lock_package",
      targetPath: "operator.productionLocks.script.hundred",
      entityIds: [hundredEpisodeBlockProject.id],
      data: { scriptLockPackage: blockScriptLockPackage },
    }, operatorRun),
    createOperatorArtifact({
      runId: operatorRun.id,
      kind: "production_block_lock",
      targetPath: "operator.productionLocks.block.hundred",
      entityIds: [hundredEpisodeBlockProject.id],
      data: { productionBlockLock: hundredProductionBlockLock },
    }, operatorRun),
    createOperatorArtifact({
      runId: operatorRun.id,
      kind: "production_breakdown_report",
      targetPath: "operator.productionPrep.breakdown.hundred",
      entityIds: [hundredEpisodeBlockProject.id],
      data: { productionBreakdownReport: hundredBlockBreakdownReport },
    }, operatorRun),
    operatorSeriesChangeOrderArtifact,
  ],
  operatorRunId: operatorRun.id,
  stageType: "production_asset_detail",
  environment: "test",
  capturedAt: 1710000000900,
});
assert.equal(hundredCockpit.productionGovernance.scriptCoverage.lockedEpisodeCount, 10);
assert.equal(hundredCockpit.productionGovernance.scriptCoverage.missingEpisodeCount, 90);
assert.equal(hundredCockpit.productionGovernance.changeOrders.openCount, 1);
assert.equal(hundredCockpit.counts.openSeriesChangeOrders, 1);
assert.equal(hundredCockpit.productionPrep.latestBreakdown?.id, hundredBlockBreakdownReport.id);
assert.equal(hundredCockpit.productionPrep.sceneMatrix.length, hundredBlockBreakdownReport.sceneMatrix.length);
assert.ok(hundredCockpit.nextActions.some((action) => action.id.startsWith("series_change_order:")));
const invalidProductionBreakdownVerdict = runOperatorArtifactQA({
  artifact: createOperatorArtifact({
    runId: operatorRun.id,
    kind: "production_breakdown_report",
    targetPath: "operator.productionPrep.invalid",
    entityIds: ["operator-project"],
    data: { productionBreakdownReport: { schemaVersion: "production-breakdown-report.v1", projectId: "operator-project", scope: { sourceLockIds: [] }, sceneMatrix: [] } },
  }, operatorRun),
});
assert.equal(invalidProductionBreakdownVerdict?.blocking, true);
const interactivePrepProject = {
  ...productionPrepProject,
  projectModel: "interactive",
  interactiveTemplate: "分支调查",
  gameData: {
    variables: [{ id: "var-trust", name: "trust", type: "number", defaultValue: 0 }],
    edges: [
      { id: "edge-start-choice", sourceNodeId: "node-start", targetNodeId: "node-choice", displayText: "走向证物柜" },
      { id: "edge-choice-ending", sourceNodeId: "node-choice", targetNodeId: "node-ending", displayText: "相信林澈", conditionExpression: "trust >= 1" },
      { id: "edge-choice-failure", sourceNodeId: "node-choice", targetNodeId: "node-failure", displayText: "抛弃证据", conditionExpression: "trust < 1" },
    ],
    nodes: [
      {
        id: "node-start",
        title: "节点开场",
        scriptContent: "林澈进入废弃法庭。",
        onEnterActions: [{ targetVariableId: "var-trust", operation: "add", value: 1 }],
        isEnding: false,
        uiLayout: "standard",
        position: { x: 0, y: 0 },
        shots: productionPrepProject.episodes[0].scenes[0].shots,
        breakdown: productionPrepProject.episodes[0].scenes[0].breakdown,
      },
      {
        id: "node-choice",
        title: "节点选择",
        scriptContent: "玩家在证物柜前决定是否相信林澈。",
        onEnterActions: [],
        isEnding: false,
        uiLayout: "timer",
        position: { x: 160, y: 0 },
        shots: productionPrepProject.episodes[0].scenes[0].shots,
        breakdown: productionPrepProject.episodes[0].scenes[0].breakdown,
      },
      {
        id: "node-ending",
        title: "真相信结局",
        scriptContent: "信任成立，证据链闭合，林澈打开安全出口。",
        onEnterActions: [],
        isEnding: true,
        uiLayout: "standard",
        position: { x: 320, y: -80 },
        shots: productionPrepProject.episodes[0].scenes[0].shots,
        breakdown: productionPrepProject.episodes[0].scenes[0].breakdown,
      },
      {
        id: "node-failure",
        title: "失败结局：证据丢失",
        scriptContent: "玩家抛弃证据，法庭警报响起，进入失败重试。",
        onEnterActions: [{ targetVariableId: "var-trust", operation: "subtract", value: 1 }],
        isEnding: true,
        uiLayout: "qte",
        position: { x: 320, y: 80 },
        shots: productionPrepProject.episodes[0].scenes[0].shots,
        breakdown: productionPrepProject.episodes[0].scenes[0].breakdown,
      },
    ],
  },
} as any;
const interactiveProductionBlockLock = {
  ...sampleProductionBlockLock,
  mode: "interactive" as const,
  lockType: "node_block" as const,
  episodeIds: [],
  sceneIds: [],
  nodeIds: ["node-start"],
  scriptLockPackageId: undefined,
  contentLockPackageId: "content-lock-chapter-1",
};
const interactiveProductionBreakdownReport = buildProductionBreakdownReport({
  project: interactivePrepProject,
  episodes: [],
  contentLockPackage: sampleContentLock,
  productionBlockLock: interactiveProductionBlockLock,
  createdAt: 1710000000600,
});
assert.equal(interactiveProductionBreakdownReport.scope.mode, "interactive");
assert.ok(interactiveProductionBreakdownReport.sceneMatrix.some((row) => row.nodeId === "node-start"));
assert.equal(interactiveProductionBreakdownReport.sceneMatrix.every((row) => row.sourceType === "node"), true);
assert.equal(interactiveProductionBreakdownReport.interactiveCoverage?.missingLockedNodeIds.length, 0);
assert.equal(interactiveProductionBreakdownReport.interactiveCoverage?.missingGoldenPathNodeIds.length, 0);
assert.equal(interactiveProductionBreakdownReport.interactiveCoverage?.missingEndingNodeIds.length, 0);
assert.equal(interactiveProductionBreakdownReport.interactiveCoverage?.missingFailurePathNodeIds.length, 0);
assert.ok(interactiveProductionBreakdownReport.interactiveCoverage?.coveredVariableStateIds.includes("var-trust-high"));
assert.ok(interactiveProductionBreakdownReport.variantNeeds.some((need) => need.variantKind === "choice_state"));
assert.ok(interactiveProductionBreakdownReport.variantNeeds.some((need) => need.variantKind === "failure_state"));
assert.equal(validateProductionBreakdownReport(interactiveProductionBreakdownReport).some((issue) => issue.severity === "blocking"), false);
const interactiveBlockedFormalAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(interactivePrepProject, { formalAssetIntent: true });
assert.equal(interactiveBlockedFormalAssetBoardPlan.productionReadiness, "formal_blocked");
assert.ok(interactiveBlockedFormalAssetBoardPlan.formalAssetBlockers.some((blocker) => blocker.includes("content_lock_package")));
const interactiveCastingRequirements = buildCastingRequirements(interactivePrepProject, interactiveProductionBreakdownReport, 1710000000601);
const interactiveDepartmentPrepPackages = buildDepartmentPrepPackages(interactivePrepProject, interactiveProductionBreakdownReport, 1710000000602);
const interactiveUiPrepPackage = interactiveDepartmentPrepPackages.find((pack) => pack.department === "ui_interaction");
assert.ok(interactiveUiPrepPackage);
assert.equal(interactiveUiPrepPackage?.readiness, "ready_for_department_review");
assert.ok(interactiveUiPrepPackage?.requiredAssets.some((asset) => asset.type === "ui_asset"));
assert.ok(interactiveUiPrepPackage?.variants.some((variant) => variant.variantKind === "interactive_variable_state"));
const runPhase12InteractiveDepartmentCoverageSelfChecks = () => {
  const operatorInteractiveBreakdownArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "production_breakdown_report",
    targetPath: "operator.productionPrep.breakdown.interactive",
    entityIds: ["interactive-prep-project", "node-start"],
    data: { productionBreakdownReport: interactiveProductionBreakdownReport },
  }, operatorRun);
  const operatorInteractiveDepartmentPrepArtifact = createOperatorArtifact({
    runId: operatorRun.id,
    kind: "department_prep_package",
    targetPath: "operator.productionPrep.departmentPrep.interactive",
    entityIds: ["interactive-prep-project", "node-start"],
    data: { departmentPrepPackages: interactiveDepartmentPrepPackages },
  }, operatorRun);
  const interactiveDepartmentCoverage = buildProductionDepartmentCoverage(buildProductionCoordinationSnapshot({
    project: interactivePrepProject,
    episodes: interactivePrepProject.episodes,
    operatorArtifacts: [
      operatorInteractiveBreakdownArtifact,
      operatorInteractiveDepartmentPrepArtifact,
    ],
    scope: "stage_exit",
    stageType: "interactive_storyboard",
    runId: operatorRun.id,
    environment: "test",
  }));
  assert.equal(interactiveDepartmentCoverage.projectMode, "interactive");
  assert.ok(interactiveDepartmentCoverage.requiredDepartments.includes("ui_interaction"));
  assert.ok(interactiveDepartmentCoverage.departments.some((item) => item.department === "ui_interaction" && item.readiness === "ready"));
  assert.equal(interactiveDepartmentCoverage.missingRequiredDepartments.includes("ui_interaction"), false);
};
runPhase12InteractiveDepartmentCoverageSelfChecks();
const interactiveApprovedCastingDecision = buildCastingDecision({
  projectId: interactivePrepProject.id,
  castingRequirement: interactiveCastingRequirements[0],
  decisionType: "approve_identity_board",
  candidate: {
    identityBoardArtifactId: "interactive-identity-board-node-start",
    name: interactiveCastingRequirements[0]?.displayName || "Interactive role",
    source: "generated_identity_board",
    suitabilityNotes: ["符合互动节点的表演和状态需求。"],
  },
  directorNotes: "导演确认该互动节点角色身份板可以进入正式资产筹备。",
  contentLockPackageId: sampleContentLock.id,
  productionBlockLockId: interactiveProductionBlockLock.id,
  approvedBy: "director",
  createdAt: 1710000000603,
});
assert.equal(validateCastingDecision(interactiveApprovedCastingDecision).some((issue) => issue.severity === "blocking"), false);
const interactiveFormalAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(interactivePrepProject, {
  formalAssetIntent: true,
  contentLockPackage: sampleContentLock,
  productionBlockLock: interactiveProductionBlockLock,
  productionBreakdownReport: interactiveProductionBreakdownReport,
  castingRequirements: interactiveCastingRequirements,
  castingDecisions: [interactiveApprovedCastingDecision],
  departmentPrepPackages: interactiveDepartmentPrepPackages,
});
assert.equal(interactiveFormalAssetBoardPlan.productionReadiness, "formal_ready");
assert.equal(interactiveFormalAssetBoardPlan.productionPrepRefs.contentLockPackageId, sampleContentLock.id);
const interactiveVariableChangeOrder = buildSeriesChangeOrder({
  project: interactivePrepProject,
  changeType: "node_variable_change",
  title: "锁后调整信任变量分支",
  reason: "导演希望失败路径在 trust 低于 2 时提前触发，需要重新锁定互动内容。",
  requestedChanges: [
    {
      targetType: "variable",
      operation: "state_change",
      targetId: "var-trust-high",
      title: "trust 高低阈值调整",
      description: "把 trust >= 1 的成功条件调整为 trust >= 2，并同步失败路径反馈。",
    },
    {
      targetType: "ending",
      operation: "rewrite",
      targetId: "node-failure",
      title: "失败结局反馈强化",
      description: "失败结局需要新增重试反馈和 UI 风险提示。",
    },
  ],
  contentLockPackage: sampleContentLock,
  productionBlockLock: interactiveProductionBlockLock,
  productionBreakdownReport: interactiveProductionBreakdownReport,
  affectedNodeIds: ["node-choice", "node-failure"],
  affectedChoiceIds: ["edge-choice-ending", "edge-choice-failure"],
  affectedVariableStateIds: ["var-trust-high", "var-trust-low"],
  affectedEndingNodeIds: ["node-failure"],
  createdAt: 1710000000604,
});
assert.equal(interactiveVariableChangeOrder.mode, "interactive");
assert.ok(interactiveVariableChangeOrder.requiredReLocks.includes("content_lock_package"));
assert.ok(interactiveVariableChangeOrder.requiredStageReruns.includes("interactive_graph_qa"));
assert.ok(interactiveVariableChangeOrder.requiredStageReruns.includes("content_lock"));
assert.ok(interactiveVariableChangeOrder.requiredStageReruns.includes("interactive_storyboard"));
assert.ok(interactiveVariableChangeOrder.staleArtifactKinds.includes("content_lock_package"));
assert.ok(interactiveVariableChangeOrder.impactOnInteractive.requiresGraphQA);
assert.ok(interactiveVariableChangeOrder.impactOnInteractive.requiresPlaytest);
assert.ok(interactiveVariableChangeOrder.impactOnInteractive.affectedVariableStateIds.includes("var-trust-high"));
assert.equal(validateSeriesChangeOrder(interactiveVariableChangeOrder).some((issue) => issue.severity === "blocking"), false, JSON.stringify(validateSeriesChangeOrder(interactiveVariableChangeOrder), null, 2));
const coordinationSceneVisualPackArtifacts = sceneVisualPackDrafts.sceneVisualPacks.map((pack) => createOperatorArtifact({
  runId: operatorRun.id,
  kind: "scene_visual_pack",
  targetPath: `episodes.${pack.episodeId}.sceneVisualPacks.${pack.id}`,
  entityIds: [pack.episodeId, ...pack.linkedSceneIds, pack.id],
  data: { sceneVisualPack: pack },
}, operatorRun));
const coordinationVisualPack = sceneVisualPackDrafts.sceneVisualPacks[0];
const coordinationPerformanceBeats = [{
  ...samplePerformanceBeats[0],
  id: "beat-svp-1",
  episodeId: "ep-svp",
  sceneId: "scene-svp-1",
  scriptBlockIds: ["svp-sb-1", "svp-sb-2"],
  characterIds: ["char-hero"],
  locationId: "loc-cliff",
  propIds: ["prop-soul-lamp"],
  startState: "陆青尘在飞升崖左侧护住同心魂灯。",
  endState: "同心魂灯稳定亮起，陆青尘看向天门。",
  continuityIn: "承接夜色飞升崖，魂灯在胸前。",
  continuityOut: "魂灯稳定燃烧，天门光柱压近。",
}];
const coordinationAssetReferencePack = {
  ...sampleAssetReferencePack,
  id: "pack-svp-1",
  episodeId: "ep-svp",
  sceneId: "scene-svp-1",
  sceneVisualPackId: coordinationVisualPack.id,
  modelInputFingerprint: "mif-svp-1",
  purpose: "为飞升崖 10 秒情绪表演准备角色、场景和魂灯参考。",
  items: [
    { assetId: "char-hero", assetType: "character", referenceAssetId: "ref-char-hero", roleInUnit: "陆青尘", required: true },
    { assetId: "loc-cliff", assetType: "location", referenceAssetId: "ref-loc-cliff", roleInUnit: "飞升崖", required: true },
    { assetId: "prop-soul-lamp", assetType: "prop", referenceAssetId: "ref-soul-lamp", roleInUnit: "同心魂灯", required: true },
  ],
};
const coordinationStoryboardBoard = {
  ...sampleStoryboardBoard,
  id: "board-svp-1",
  episodeId: "ep-svp",
  sceneId: "scene-svp-1",
  performanceBeatIds: ["beat-svp-1"],
  scriptBlockIds: ["svp-sb-1", "svp-sb-2"],
  shotIds: ["shot-svp-1"],
  assetReferencePackId: "pack-svp-1",
  videoGenerationUnitId: "unit-svp-1",
  startState: "陆青尘在飞升崖左侧护住同心魂灯。",
  endState: "同心魂灯稳定亮起，陆青尘看向天门。",
  lineArtPrompt: "中文线稿故事板，飞升崖夜色，陆青尘护住同心魂灯，红箭头标注魂灯举起，蓝箭头标注轻微慢推。",
  panels: [
    { id: "panel-svp-1", panelNumber: 1, performanceBeatId: "beat-svp-1", shotId: "shot-svp-1", durationSeconds: 3, framePurpose: "起始守护", shotType: "MS", visualBeat: "陆青尘护住魂灯。", cameraNote: "固定轴线。", actionArrowLegendIds: ["camera_motion_blue"], annotationLegendIds: ["camera_motion_blue", "shot_note_black"], dialogueOrSoundCue: "风声" },
    { id: "panel-svp-2", panelNumber: 2, performanceBeatId: "beat-svp-1", shotId: "shot-svp-1", durationSeconds: 4, framePurpose: "魂灯亮起", shotType: "CU", visualBeat: "魂灯稳定亮起。", cameraNote: "轻微慢推。", actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"], annotationLegendIds: ["subject_action_red", "camera_motion_blue", "lighting_direction_orange", "shot_note_black"], dialogueOrSoundCue: "低声对白" },
    { id: "panel-svp-3", panelNumber: 3, performanceBeatId: "beat-svp-1", shotId: "shot-svp-1", durationSeconds: 3, framePurpose: "尾状态", shotType: "MS", visualBeat: "陆青尘看向天门。", cameraNote: "慢推停止。", actionArrowLegendIds: ["eyeline_attention_green"], annotationLegendIds: ["eyeline_attention_green", "shot_note_black"], dialogueOrSoundCue: "停顿" },
  ],
};
const coordinationVideoGenerationUnit = {
  ...sampleVideoGenerationUnit,
  id: "unit-svp-1",
  episodeId: "ep-svp",
  sceneId: "scene-svp-1",
  performanceBeatIds: ["beat-svp-1"],
  storyboardBoardId: "board-svp-1",
  assetReferencePackId: "pack-svp-1",
  shotIds: ["shot-svp-1"],
  startState: "陆青尘在飞升崖左侧护住同心魂灯。",
  endState: "同心魂灯稳定亮起，陆青尘看向天门。",
  videoPrompt: "竖屏 9:16，飞升崖夜色，陆青尘护住同心魂灯，轻微慢推，魂灯稳定亮起，10 秒，角色位置稳定。",
};
const coordinationPerformanceBeatsArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "performance_beats",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.performanceBeats",
  entityIds: ["ep-svp", "scene-svp-1", "beat-svp-1"],
  data: { performanceBeats: coordinationPerformanceBeats },
}, operatorRun);
const coordinationAssetReferencePackArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "asset_reference_pack",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.assetReferencePacks.pack-svp-1",
  entityIds: ["ep-svp", "scene-svp-1", "pack-svp-1"],
  data: { assetReferencePack: coordinationAssetReferencePack },
}, operatorRun);
const coordinationStoryboardBoardArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "storyboard_board",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.storyboardBoards.board-svp-1",
  entityIds: ["ep-svp", "scene-svp-1", "board-svp-1"],
  data: { storyboardBoard: coordinationStoryboardBoard },
}, operatorRun);
const coordinationVideoUnitArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "video_generation_unit",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.videoGenerationUnits.unit-svp-1",
  entityIds: ["ep-svp", "scene-svp-1", "unit-svp-1"],
  data: { videoGenerationUnit: coordinationVideoGenerationUnit },
}, operatorRun);
const coordinationUnsafeVideoUnitArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "video_generation_unit",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.videoGenerationUnits.unit-svp-unsafe",
  entityIds: ["ep-svp", "scene-svp-1", "unit-svp-unsafe"],
  data: {
    videoGenerationUnit: {
      ...coordinationVideoGenerationUnit,
      id: "unit-svp-unsafe",
      durationSeconds: 30,
    },
  },
}, operatorRun);
const coordinationSnapshot = buildProductionCoordinationSnapshot({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationVideoUnitArtifact,
  ],
  scope: "stage_exit",
  stageType: "prompt",
  runId: operatorRun.id,
  environment: "test",
});
const coordinationHandoffManifest = buildDepartmentHandoffManifest(coordinationSnapshot);
const coordinationDepartmentFindings = runProductionDepartmentCoordinationQA(coordinationSnapshot, coordinationHandoffManifest);
assert.deepEqual(
  coordinationDepartmentFindings.map((finding) => finding.department),
  ["asset", "continuity", "storyboard_video_unit", "style_strategy", "creative_commercial", "media_readiness", "department_coverage", "operator_governance"],
);
assert.equal(coordinationDepartmentFindings.some((finding) => finding.severity === "blocking"), false, JSON.stringify(coordinationDepartmentFindings, null, 2));
assert.ok(coordinationDepartmentFindings.every((finding) => finding.ownerAgentId && finding.suggestedStageType));
const coordinationReport = buildProductionCoordinationReport({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationVideoUnitArtifact,
  ],
  scope: "stage_exit",
  stageType: "prompt",
  runId: operatorRun.id,
  environment: "test",
});
assert.equal(coordinationReport.schemaVersion, "production-coordination-report.v1");
assert.equal(coordinationReport.handoffManifest.missingRefs.length, 0);
assert.equal(coordinationReport.environmentPolicy.preferredRepairMode, "test_fix_code_prompt_qa_or_workflow");
assert.ok(coordinationReport.departmentFindings.some((finding) => finding.department === "asset"));
assert.ok(coordinationReport.departmentFindings.some((finding) => finding.department === "style_strategy" && finding.status === "passed"));
assert.ok(coordinationReport.departmentFindings.some((finding) => finding.department === "department_coverage" && finding.status === "passed"));
assert.equal(coordinationReport.departmentCoverage.coverageMode, "not_started");
assert.equal(coordinationReport.departmentCoverage.missingRequiredDepartments.length, 0);
assert.equal(coordinationReport.missingDepartmentPackages.length, 0);
assert.ok(coordinationReport.departmentQaSummary.some((item) => item.department === "cinematography"));
assert.ok(coordinationReport.sourceRefs.some((ref) => ref.kind === "asset_continuity"));
assert.equal(validateProductionCoordinationReport(coordinationReport).some((issue) => issue.severity === "blocking"), false);
const operatorCoordinationArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "production_coordination_report",
  targetPath: "operator.productionCoordinationReports.prompt",
  entityIds: ["ep-svp", "scene-svp-1", "scene-svp-2", "scene-svp-3"],
  data: { productionCoordinationReport: coordinationReport },
}, operatorRun);
const autoCoordinationVerdict = runOperatorArtifactQA({ artifact: operatorCoordinationArtifact });
assert.equal(autoCoordinationVerdict?.blocking, false, JSON.stringify(autoCoordinationVerdict?.issues, null, 2));
assert.equal(autoCoordinationVerdict?.qaAgentId, "operator.artifact.production_coordination_report.qa");
const coordinationStageGate = buildProductionCoordinationStageGate({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationVideoUnitArtifact,
  ],
  stageType: "prompt",
  runId: operatorRun.id,
  environment: "test",
});
assert.equal(coordinationStageGate.canProceed, true);
assert.equal(coordinationStageGate.nextAction, "proceed");
reportSelfCheckProgress("checking coordination and cockpit");
const coordinationCockpit = buildProductionCockpit({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationVideoUnitArtifact,
  ],
  operatorRunId: operatorRun.id,
  stageType: "prompt",
  environment: "test",
  capturedAt: 1710000000000,
});
assert.equal(coordinationCockpit.schemaVersion, "production-cockpit.v1");
assert.equal(coordinationCockpit.scope.stageType, "prompt");
assert.equal(coordinationCockpit.currentStage.source, "query");
assert.equal(coordinationCockpit.coordination.gate.nextAction, "proceed");
assert.equal(coordinationCockpit.counts.repairTickets, 0);
assert.equal(coordinationCockpit.departmentCoverage.coverageMode, "not_started");
assert.equal(coordinationCockpit.counts.missingDepartmentPackages, 0);
assert.equal(coordinationCockpit.deliveryMode.draftExploration.allowed, true);
assert.equal(coordinationCockpit.deliveryMode.formalDelivery.canRequestStageExit, true);
assert.equal(coordinationCockpit.storyboardChain.artifactCounts.performanceBeats, 1);
assert.equal(coordinationCockpit.storyboardChain.artifactCounts.storyboardBoards, 1);
assert.equal(coordinationCockpit.storyboardChain.artifactCounts.sceneVisualPacks, 2);
assert.equal(coordinationCockpit.storyboardChain.artifactCounts.assetReferencePacks, 1);
assert.equal(coordinationCockpit.storyboardChain.artifactCounts.videoGenerationUnits, 1);
assert.equal(coordinationCockpit.storyboardChain.generationStatus.status, "ready");
assert.ok(coordinationCockpit.nextActions.some((action) => action.actionType === "proceed"));
assert.ok(coordinationCockpit.nextActions.some((action) => action.actionType === "save_coordination_report"));
const coordinationWrapQA = buildProductionCoordinationWrapQA({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationVideoUnitArtifact,
  ],
  runId: operatorRun.id,
  environment: "test",
});
assert.equal(coordinationWrapQA.report.scope, "episode_wrap");
assert.equal(coordinationWrapQA.canProceed, true);
const operatorRepairableVideoUnitArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "video_generation_unit",
  targetPath: "episodes.ep-svp.scenes.scene-svp-1.videoGenerationUnits.unit-svp-repairable",
  entityIds: ["ep-svp", "scene-svp-1", "unit-svp-repairable"],
  data: {
    videoGenerationUnit: {
      ...sampleVideoGenerationUnit,
      id: "unit-svp-repairable",
      durationSeconds: 30,
    },
  },
}, operatorRun);
const repairableCoordinationStageGate = buildProductionCoordinationStageGate({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    operatorRepairableVideoUnitArtifact,
  ],
  stageType: "expensive_generation_planning",
  runId: operatorRun.id,
  environment: "test",
});
assert.equal(repairableCoordinationStageGate.canProceed, false);
assert.equal(repairableCoordinationStageGate.nextAction, "repair", JSON.stringify(repairableCoordinationStageGate, null, 2));
assert.ok(repairableCoordinationStageGate.repairTickets.some((ticket) => ticket.resolutionClass === "auto_repairable" && ticket.status === "open"));
const repairableCoordinationCockpit = buildProductionCockpit({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    operatorRepairableVideoUnitArtifact,
  ],
  operatorRunId: operatorRun.id,
  stageType: "expensive_generation_planning",
  environment: "test",
  capturedAt: 1710000000001,
});
assert.equal(repairableCoordinationCockpit.coordination.gate.nextAction, "repair");
assert.ok(repairableCoordinationCockpit.counts.autoRepairable >= 1);
assert.ok(repairableCoordinationCockpit.counts.openRepairTickets >= 1);
assert.ok(repairableCoordinationCockpit.nextActions.some((action) => action.actionType === "repair"));
const unsafeCoordinationStageGate = buildProductionCoordinationStageGate({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationUnsafeVideoUnitArtifact,
  ],
  stageType: "expensive_generation_planning",
  runId: operatorRun.id,
  environment: "test",
});
assert.equal(unsafeCoordinationStageGate.canProceed, false);
assert.equal(unsafeCoordinationStageGate.nextAction, "repair", JSON.stringify(unsafeCoordinationStageGate, null, 2));
assert.ok(unsafeCoordinationStageGate.repairTickets.length >= 1);
assert.equal(validateCoordinationRepairTickets(unsafeCoordinationStageGate.repairTickets).some((issue) => issue.severity === "blocking"), false);
assert.ok(unsafeCoordinationStageGate.repairTickets.some((ticket) => ticket.ownerAgentId && ticket.suggestedStageType && ticket.repairInstruction));
assert.ok(unsafeCoordinationStageGate.repairTickets.every((ticket) => ticket.repairMode === "test_fix_code_prompt_qa_or_workflow"));
assert.ok(unsafeCoordinationStageGate.repairTickets.every((ticket) => ticket.repairClassification !== "content"));
assert.ok(unsafeCoordinationStageGate.repairTickets.every((ticket) => ticket.issueFingerprint && Array.isArray(ticket.sourceArtifactIds)));
const unsafeCoordinationCockpit = buildProductionCockpit({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationUnsafeVideoUnitArtifact,
  ],
  operatorRunId: operatorRun.id,
  stageType: "expensive_generation_planning",
  environment: "test",
  capturedAt: 1710000000002,
});
assert.equal(unsafeCoordinationCockpit.coordination.gate.nextAction, "repair");
assert.ok(unsafeCoordinationCockpit.counts.autoRepairable >= 1);
assert.ok(unsafeCoordinationCockpit.counts.openRepairTickets >= 1);
assert.ok(unsafeCoordinationCockpit.nextActions.some((action) => action.actionType === "repair"));
const operatorRepairTicketArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "coordination_repair_ticket",
  targetPath: "operator.productionCoordinationRepairTickets.expensiveGeneration",
  entityIds: ["ep-svp", "scene-svp-1"],
  data: { repairTickets: unsafeCoordinationStageGate.repairTickets },
}, operatorRun);
const autoRepairTicketVerdict = runOperatorArtifactQA({ artifact: operatorRepairTicketArtifact });
assert.equal(autoRepairTicketVerdict?.blocking, false, JSON.stringify(autoRepairTicketVerdict?.issues, null, 2));
assert.equal(autoRepairTicketVerdict?.qaAgentId, "operator.artifact.coordination_repair_ticket.qa");
const repeatedUnsafeCoordinationStageGate = buildProductionCoordinationStageGate({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    coordinationPerformanceBeatsArtifact,
    ...coordinationSceneVisualPackArtifacts,
    coordinationStoryboardBoardArtifact,
    coordinationAssetReferencePackArtifact,
    coordinationUnsafeVideoUnitArtifact,
  ],
  stageType: "expensive_generation_planning",
  runId: operatorRun.id,
  environment: "test",
  previousReports: [unsafeCoordinationStageGate.report],
});
assert.equal(repeatedUnsafeCoordinationStageGate.canProceed, false);
assert.equal(repeatedUnsafeCoordinationStageGate.nextAction, "blocked", JSON.stringify(repeatedUnsafeCoordinationStageGate, null, 2));
assert.equal(repeatedUnsafeCoordinationStageGate.circuitBreaker.humanInterventionRequired, true);
assert.ok(repeatedUnsafeCoordinationStageGate.humanInterventionTasks.length >= 1);
const invalidCoordinationArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "production_coordination_report",
  targetPath: "operator.productionCoordinationReports.invalid",
  entityIds: ["ep-svp"],
  data: { productionCoordinationReport: { schemaVersion: "bad", projectId: "" } },
}, operatorRun);
const invalidCoordinationVerdict = runOperatorArtifactQA({ artifact: invalidCoordinationArtifact });
assert.equal(invalidCoordinationVerdict?.blocking, true);
assert.ok(invalidCoordinationVerdict?.issues.some((issue) => issue.message.includes("schemaVersion")));
const operatorInvalidVideoUnitArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "video_generation_unit",
  targetPath: "episodes.ep-sample.scenes.scene-sample.videoGenerationUnits.unit-invalid",
  entityIds: ["ep-sample", "scene-sample", "unit-invalid"],
  data: {
    videoGenerationUnit: {
      ...sampleVideoGenerationUnit,
      id: "unit-invalid",
      durationSeconds: 30,
    },
  },
}, operatorRun);
const autoInvalidVideoUnitVerdict = runOperatorArtifactQA({
  artifact: operatorInvalidVideoUnitArtifact,
  relatedArtifacts: [operatorAssetPackArtifact],
});
assert.equal(autoInvalidVideoUnitVerdict?.blocking, true);
assert.ok(autoInvalidVideoUnitVerdict?.issues.some((issue) => issue.message.includes("VIDEO_UNIT_DURATION_EXCEEDS_MODEL_MAX")));
const unsafeVideoUnitSnapshot = buildProductionCoordinationSnapshot({
  project: sceneVisualPackProject,
  episodes: sceneVisualPackEpisodes,
  operatorArtifacts: [
    ...coordinationSceneVisualPackArtifacts,
    operatorAssetPackArtifact,
    operatorInvalidVideoUnitArtifact,
  ],
  scope: "stage_exit",
  stageType: "expensive_generation_planning",
  runId: operatorRun.id,
  environment: "test",
});
const mediaReadinessFinding = runMediaReadinessCoordinationQA(unsafeVideoUnitSnapshot);
assert.equal(mediaReadinessFinding.department, "media_readiness");
const softHoldIssue = normalizeProductionQAIssue({
  id: "soft-hold-issue",
  severity: "warning",
  target: "props.lottery.owner",
  message: "道具归属不够清楚，正式交付前需要确认。",
  issueType: "continuity_coordination",
});
assert.equal(classifyQAIssueResolution(softHoldIssue), "soft_hold");
const autoRepairableIssue = normalizeProductionQAIssue({
  id: "auto-repairable-issue",
  severity: "blocking",
  target: "shots.shot-backflow.propIds",
  message: "镜头引用了尚未登记的后置道具。",
  issueType: "asset_coordination",
  retryable: true,
});
assert.equal(classifyQAIssueResolution(autoRepairableIssue), "auto_repairable");
const hardBlockingIssue = normalizeProductionQAIssue({
  id: "hard-blocking-issue",
  severity: "blocking",
  target: "videoGenerationUnits.unit-unsafe.assetReferencePackId",
  message: "视频生成单元缺少资产参考包。",
  issueType: "media_readiness_coordination",
});
assert.equal(classifyQAIssueResolution(hardBlockingIssue), "hard_blocking");
const findingBase = {
  evidenceRefs: [],
  ownerAgentId: "production.coordination.supervisor",
  suggestedStageType: "asset_sync" as const,
};
const softHoldTickets = buildCoordinationRepairTickets({
  repairMode: "production_content_draft",
  departmentFindings: [{
    id: "finding-soft-hold",
    department: "continuity",
    status: "warning",
    severity: "warning",
    target: softHoldIssue.target,
    message: softHoldIssue.message,
    repairInstruction: softHoldIssue.repairInstruction,
    retryable: true,
    resolutionClass: softHoldIssue.resolutionClass,
    severityPolicyId: softHoldIssue.severityPolicyId,
    ...findingBase,
  } as ProductionDepartmentFinding],
});
assert.equal(softHoldTickets.length, 0);
const autoRepairTickets = buildCoordinationRepairTickets({
  repairMode: "production_content_draft",
  departmentFindings: [{
    id: "finding-auto-repairable",
    department: "asset",
    status: "failed",
    severity: "blocking",
    target: autoRepairableIssue.target,
    message: autoRepairableIssue.message,
    repairInstruction: autoRepairableIssue.repairInstruction,
    retryable: true,
    resolutionClass: autoRepairableIssue.resolutionClass,
    severityPolicyId: autoRepairableIssue.severityPolicyId,
    ...findingBase,
  } as ProductionDepartmentFinding],
});
assert.equal(autoRepairTickets[0].resolutionClass, "auto_repairable");
assert.equal(autoRepairTickets[0].repairMode, "production_content_draft");
assert.equal(autoRepairTickets[0].repairClassification, "content");
assert.equal(autoRepairTickets[0].issueFingerprint, autoRepairTickets[0].issueId);
assert.ok(Array.isArray(autoRepairTickets[0].sourceArtifactIds));
assert.equal(autoRepairTickets[0].maxRetries, 2);
assert.equal(autoRepairTickets[0].status, "open");
const testPromptRepairTickets = buildCoordinationRepairTickets({
  repairMode: "test_fix_code_prompt_qa_or_workflow",
  departmentFindings: [{
    id: "finding-test-prompt",
    department: "storyboard_video_unit",
    status: "failed",
    severity: "blocking",
    target: "operatorArtifacts.asset_reference_pack.prompt",
    message: "prompt 模板没有输出必需字段。",
    repairInstruction: "修复 prompt 模板或 schema，不要改项目内容绕过测试。",
    retryable: true,
    resolutionClass: "auto_repairable",
    severityPolicyId: autoRepairableIssue.severityPolicyId,
    ...findingBase,
  } as ProductionDepartmentFinding],
});
assert.equal(testPromptRepairTickets[0].repairMode, "test_fix_code_prompt_qa_or_workflow");
assert.equal(testPromptRepairTickets[0].repairClassification, "prompt");
assert.equal(validateCoordinationRepairTickets(testPromptRepairTickets).some((issue) => issue.severity === "blocking"), false);
assert.ok(validateCoordinationRepairTickets([{ ...testPromptRepairTickets[0], repairClassification: "content" }]).some((issue) =>
  issue.severity === "blocking" && issue.target.endsWith(".repairClassification"),
));
const hardBlockingTickets = buildCoordinationRepairTickets({
  repairMode: "production_content_draft",
  departmentFindings: [{
    id: "finding-hard-blocking",
    department: "media_readiness",
    status: "failed",
    severity: "blocking",
    target: hardBlockingIssue.target,
    message: hardBlockingIssue.message,
    repairInstruction: hardBlockingIssue.repairInstruction,
    retryable: false,
    resolutionClass: hardBlockingIssue.resolutionClass,
    severityPolicyId: hardBlockingIssue.severityPolicyId,
    ...findingBase,
  } as ProductionDepartmentFinding],
});
assert.equal(hardBlockingTickets[0].resolutionClass, "hard_blocking");
assert.equal(hardBlockingTickets[0].maxRetries, 0);
assert.equal(hardBlockingTickets[0].status, "blocked");
assert.ok(hardBlockingTickets[0].humanEscalationReason);
const creativeBackflowProject = {
  id: "creative-backflow-project",
  title: "Creative Backflow Project",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  characters: [{ id: "char-backflow", name: "沈瑶", internalDesire: "求生", externalGoal: "翻案", flaw: "冲动" }],
  assets: [{ id: "prop-token", type: "prop", name: "青岚令", description: "宗门令牌" }],
  episodes: [{
    id: "ep-backflow",
    title: "袖口证物",
    inspiration: "分镜阶段新增视觉 gag。",
    scenes: [{
      id: "scene-backflow",
      title: "庭审反转",
      description: "沈瑶用新证物打断审判。",
      valueCharge: "negative",
      scriptBlocks: [{ id: "block-backflow", type: "action", content: "沈瑶抬手，袖口滑出一张烧焦的彩票。" }],
      breakdown: {
        setting: "INT.",
        location: "宗门审判堂",
        time: "NIGHT",
        characters: ["沈瑶"],
        characterIds: ["char-backflow"],
        props: ["青岚令"],
        propIds: ["prop-token"],
      },
      shots: [{
        id: "shot-backflow",
        visualAction: "袖口滑出烧焦的彩票，压住青岚令。",
        duration: 4,
        characterIdsInShot: ["char-backflow"],
        propIds: ["prop-token"],
      }],
    }],
  }],
} as any;
const creativeChangeRequest = buildCreativeChangeRequest(creativeBackflowProject, {
  source: { stageType: "storyboard", requestedBy: "operator" },
  title: "袖口掉出烧焦的彩票",
  description: "导演在分镜阶段新增一个视觉 gag：沈瑶袖口掉出一张烧焦的彩票，证明她提前布置反证。",
  creativePurpose: "用可见道具强化反转，而不是只靠台词解释。",
  sceneIds: ["scene-backflow"],
  shotIds: ["shot-backflow"],
  proposedAsset: {
    assetType: "prop",
    name: "烧焦的彩票",
    description: "边缘焦黑、还能看出号码的关键证物。",
  },
}, [creativeBackflowProject.episodes[0]]);
assert.equal(creativeChangeRequest.schemaVersion, "creative-change-request.v1");
assert.equal(creativeChangeRequest.pendingAssets.length, 1);
assert.equal(creativeChangeRequest.pendingAssets[0].status, "pending");
assert.ok(creativeChangeRequest.localResyncPlan?.affectedStageTypes.includes("asset_sync"));
assert.ok(creativeChangeRequest.localResyncPlan?.affectedArtifactKinds.includes("scene_visual_pack"));
assert.equal(validateCreativeChangeRequest(creativeChangeRequest).some((issue) => issue.severity === "blocking"), false);
assert.ok(validateCreativeChangeRequest(creativeChangeRequest, { targetStageType: "prompt" }).some((issue) => issue.message.includes("pending_asset")));
const operatorCreativeChangeArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "creative_change_request",
  targetPath: `operator.creativeChangeRequests.${creativeChangeRequest.id}`,
  entityIds: ["creative-backflow-project", "ep-backflow", "scene-backflow", "shot-backflow"],
  data: { creativeChangeRequest },
}, operatorRun);
const autoCreativeChangeVerdict = runOperatorArtifactQA({ artifact: operatorCreativeChangeArtifact });
assert.equal(autoCreativeChangeVerdict?.qaAgentId, "operator.artifact.creative_change_request.qa");
assert.equal(autoCreativeChangeVerdict?.blocking, false);
const creativeBackflowCockpit = buildProductionCockpit({
  project: creativeBackflowProject,
  episodes: [creativeBackflowProject.episodes[0]],
  operatorArtifacts: [operatorCreativeChangeArtifact],
  operatorRunId: operatorRun.id,
  stageType: "storyboard",
  environment: "test",
  capturedAt: 1710000000003,
});
assert.equal(creativeBackflowCockpit.creativeBackflow.openChangeCount, 1);
assert.equal(creativeBackflowCockpit.creativeBackflow.pendingAssetCount, 1);
assert.equal(creativeBackflowCockpit.counts.pendingAssets, 1);
assert.ok(creativeBackflowCockpit.creativeBackflow.formalDeliveryBlockers.some((item) => item.includes("pending_asset")));
assert.equal(creativeBackflowCockpit.deliveryMode.draftExploration.canCreateCreativeChanges, true);
assert.equal(creativeBackflowCockpit.deliveryMode.formalDelivery.canRequestStageExit, false);
assert.ok(creativeBackflowCockpit.deliveryMode.formalDelivery.blockers.some((item) => item.includes("pending_asset")));
assert.ok(creativeBackflowCockpit.nextActions.some((action) => action.actionType === "promote_pending_asset"));
const formalCreativeChangeArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "creative_change_request",
  targetPath: `operator.creativeChangeRequests.${creativeChangeRequest.id}.formalDelivery`,
  entityIds: ["creative-backflow-project", "ep-backflow", "scene-backflow", "shot-backflow"],
  data: { creativeChangeRequest, targetStageType: "prompt" },
}, operatorRun);
const formalCreativeChangeVerdict = runOperatorArtifactQA({ artifact: formalCreativeChangeArtifact });
assert.equal(formalCreativeChangeVerdict?.blocking, true);
assert.ok(formalCreativeChangeVerdict?.issues.some((issue) => issue.message.includes("不能进入正式交付")));
const promotedCreativeChangeRequest = {
  ...creativeChangeRequest,
  pendingAssets: creativeChangeRequest.pendingAssets.map((asset) => ({
    ...asset,
    status: "promoted" as const,
    canonicalAssetId: "prop-burnt-ticket",
  })),
  formalDeliveryBlockers: [],
};
assert.equal(validateCreativeChangeRequest(promotedCreativeChangeRequest, { targetStageType: "prompt" }).some((issue) => issue.severity === "blocking"), false);
const operatorDraftArtifact = createOperatorArtifact({
  runId: operatorRun.id,
  kind: "shot_patch",
  targetPath: "episodes.ep-6.scenes.scene-1.shots.shot-1",
  entityIds: ["ep-6", "scene-1", "shot-1"],
  data: {
    episodeId: "ep-6",
    sceneId: "scene-1",
    shotId: "shot-1",
    shot: {
      id: "shot-1",
      imageUrl: "/media/operator-shot.png",
      imagePrompt: "中文图片提示词，沈瑶站在青岚宗大殿内，青岚令悬浮旋转",
    },
  },
}, operatorRun);
assert.equal(operatorDraftArtifact.status, "draft");
assert.equal(isOperatorArtifactApproved(operatorDraftArtifact), false);
const operatorApprovedArtifact = appendOperatorArtifactQAVerdict(operatorDraftArtifact, {
  qaAgentId: "operator.qa.storyboard_visual",
  status: "passed",
  blocking: false,
  score: 96,
  issues: [],
  nextAction: "commit",
});
assert.equal(operatorApprovedArtifact.status, "approved");
assert.equal(isOperatorArtifactApproved(operatorApprovedArtifact), true);
const committedProjectResult = commitOperatorArtifactToProject({
  id: "operator-project",
  title: "Operator Context Project",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  logline: "凡骨少女逆改因果。",
  coreConflict: "因果火与宗门规训冲突。",
  characters: [{ id: "char-1", name: "沈瑶", internalDesire: "求生", externalGoal: "自证", flaw: "孤立" }],
  assets: [{ id: "prop-1", type: "prop", name: "青岚令", description: "执法令牌" }],
  episodes: [{
    id: "ep-6",
    title: "陷阱与搜魂",
    inspiration: "审判与反证。",
    scenes: [{
      id: "scene-1",
      title: "诬陷与搜魂",
      description: "执法弟子搜魂。",
      valueCharge: "negative",
      shots: [{ id: "shot-1", visualAction: "青岚令悬浮旋转。" }],
    }],
  }],
} as any, operatorApprovedArtifact);
assert.equal((committedProjectResult.project.episodes as any[])[0].scenes[0].shots[0].imageUrl, "/media/operator-shot.png");
assert.ok(committedProjectResult.changedPaths.includes("episodes.ep-6.scenes.scene-1.shots.shot-1"));
const operatorRegisteredAsset = createOperatorRegisteredAsset({
  projectId: "operator-project",
  runId: operatorRun.id,
  artifactId: operatorApprovedArtifact.id,
  kind: "image",
  mediaUrl: "/media/operator-shot.png",
  prompt: "中文图片提示词，沈瑶站在青岚宗大殿内",
  targetEntity: { type: "shot", id: "shot-1", episodeId: "ep-6", sceneId: "scene-1", field: "imageUrl" },
  qaStatus: "passed",
});
assert.equal(operatorRegisteredAsset.kind, "image");
assert.equal(operatorRegisteredAsset.targetEntity?.type, "shot");
const operatorSchemaVerdict = runOperatorQA({
  check: "schema",
  project: {
    id: "operator-project",
    title: "Operator QA Project",
    type: "movie",
    aspectRatio: "9:16",
    logline: "本地 AI Operator 使用系统同源 QA 验收内容。",
    coreConflict: "外部操作能力必须服从 O.M.N.I. 权威流程。",
    characters: [],
    assets: [],
    episodes: [{ id: "ep-qa", title: "QA", scenes: [] }],
  } as any,
});
assert.equal(operatorSchemaVerdict.qaAgentId, "operator.qa.schema");
assert.equal(operatorSchemaVerdict.blocking, false);
const operatorContext = buildOperatorProjectContext({
  handbookVersion: OPERATOR_HANDBOOK_VERSION,
  operatorRuns: [operatorRunWithEvent],
  productionRuns: [{
    id: "production-run-1",
    status: "needs_human_review",
    updatedAt: 123,
    stages: [{
      id: "stage-storyboard",
      stageType: "storyboard",
      status: "needs_human_review",
      qaReport: { issues: [{ id: "issue-1", severity: "blocking", message: "镜头缺少连续性。", target: "shot-1" }] },
    }],
  }],
  project: {
    id: "operator-project",
    title: "Operator Context Project",
    type: "short-drama",
    projectModel: "linear",
    aspectRatio: "9:16",
    targetEpisodeCount: 20,
    logline: "凡骨少女逆改因果。",
    coreConflict: "因果火与宗门规训冲突。",
    operatorProductionMemory: {
      commercialMemory: { monetizationHook: "每集付费钩子" },
      skeletonMemory: {
        finaleContract: "第 20 集飞升偿付",
        phaseMap: [{ id: "phase-1", episodes: "1-20", title: "飞升前", promise: "第 20 集飞升偿付" }],
      },
      continuityMemory: {
        relationshipStage: "道侣共同承劫",
        propOwnership: { soulLamp: "魂灯归主角持有" },
        forbiddenContradictions: ["不能否认第 20 集飞升偿付"],
      },
      qaCouncil: ["commercial_producer_qa", "continuity_script_supervisor_qa"],
      updatedAt: 123,
    },
    characters: [{ id: "char-1", name: "沈瑶", roleType: "lead", brief: "凡骨少女" }],
    assets: [
      { id: "loc-1", type: "location", name: "青岚宗大殿", description: "宗门审判空间" },
      { id: "prop-1", type: "prop", name: "青岚令", description: "执法令牌" },
    ],
    episodes: [{
      id: "ep-6",
      title: "陷阱与搜魂",
      inspiration: "审判与反证。",
      scenes: [{
        id: "scene-1",
        title: "诬陷与搜魂",
        description: "执法弟子搜魂。",
        shots: [{
          id: "shot-1",
          visualAction: "青岚令悬浮旋转。",
          duration: 4,
          shotSize: "特写",
          cameraAngle: "低角度",
          cameraMovement: "推进",
          imagePrompt: "中文图片提示词",
          characterIdsInShot: ["char-1"],
          locationId: "loc-1",
          propIds: ["prop-1"],
        }],
      }],
    }],
  } as any,
});
assert.equal(operatorContext.operatorModeBoundary.preservesTraditionalMode, true);
assert.equal(operatorContext.operatorModeBoundary.preservesProductionDetail, true);
assert.equal(operatorContext.creativeMemory.characters.length, 1);
assert.equal((operatorContext.creativeMemory.premiumProduction?.skeletonMemory as any)?.finaleContract, "第 20 集飞升偿付");
assert.equal((operatorContext.creativeMemory.premiumProduction?.continuityMemory as any)?.relationshipStage, "道侣共同承劫");
assert.equal((operatorContext.creativeMemory.longFormMemory as any)?.source, "operatorProductionMemory");
assert.equal((operatorContext.creativeMemory.longFormMemory as any)?.windowPolicy.profile, "operator");
assert.equal((operatorContext.creativeMemory.longFormMemory as any)?.phaseMap[0].id, "phase-1");
assert.equal((operatorContext.creativeMemory.assetContinuity as any)?.counts.characters, 1);
assert.equal(operatorContext.creativeMemory.locations.length, 1);
assert.equal(operatorContext.structureMemory.shots.length, 1);
assert.equal(operatorContext.productionState.blockedIssues.length, 1);
assert.ok(operatorContext.qaPolicy.requiredChecks.includes("storyboard_continuity"));
const settingsPageSource = fs.readFileSync(new URL("../src/pages/Settings.tsx", import.meta.url), "utf-8");
assert.ok(settingsPageSource.includes("SQLite Saved"));
assert.ok(settingsPageSource.includes("database key ready"));
assert.equal(settingsPageSource.includes("local key can migrate"), false);
assert.equal(settingsPageSource.includes("Migrate"), false);
assert.ok(settingsPageSource.includes("refreshProviderKeyStatus"));
assert.ok(settingsPageSource.includes("Server Env Slot"));
assert.ok(settingsPageSource.includes("allowlist missing"));
const frontendLoggingSource = fs.readFileSync(new URL("../src/utils/logging.ts", import.meta.url), "utf-8");
assert.ok(frontendLoggingSource.includes("summarizeUnknownError"));
assert.ok(frontendLoggingSource.includes("summarizeGeneratedText"));
const shotAnalysisSource = fs.readFileSync(new URL("../src/pages/ShotAnalysis.tsx", import.meta.url), "utf-8");
assert.ok(shotAnalysisSource.includes("summarizeUnknownError"));
assert.equal(shotAnalysisSource.includes("console.error(err)"), false);

for (const retiredPath of [
  "../src/pages/Script.tsx",
  "../src/hooks/useScriptAI.ts",
  "../src/hooks/useScriptAI/pacingAndParsing.ts",
  "../src/hooks/useScriptAI/rewriteSceneOptions.ts",
  "../src/components/script/ScriptEditor.tsx",
  "../src/components/script/AssetExtractionPanel.tsx",
]) {
  assert.equal(
    fs.existsSync(new URL(retiredPath, import.meta.url)),
    false,
    `${retiredPath} must stay deleted after the Writing migration`,
  );
}
assert.equal(isEphemeralBreakdownPropName("魔气伤口"), true);
assert.equal(isEphemeralBreakdownPropName("腐蚀伤"), true);
assert.equal(isEphemeralBreakdownPropName("染血匕首"), false);
assert.equal(isEphemeralBreakdownPropName("疗伤药膏"), false);
assert.equal(extractScriptSceneHeadingLocationName("INT. 沈瑶厢房 - NIGHT"), "沈瑶厢房");
assert.equal(extractScriptSceneHeadingLocationName("EXT. 青岚宗山门 - DUSK"), "青岚宗山门");
assert.deepEqual(getBreakdownLocationCandidateNames({ name: "沈瑶厢房/地下密室" }), ["沈瑶厢房", "地下密室"]);
assert.deepEqual(getScriptCharacterNameCandidates("魔修（黑影）"), ["魔修（黑影）", "魔修", "黑影"]);
assert.equal(normalizeTemporaryCharacterStateName("受伤外门弟子"), "外门弟子");
assert.equal(normalizeTemporaryCharacterStateName("外门弟子（无名）"), "外门弟子");
assert.equal(normalizeScriptCharacterCueName("玄烬 (O.S.)"), "玄烬");
assert.equal(normalizeScriptCharacterCueName("玄烬（画外）"), "玄烬");
assert.equal(areDiscoveredCharacterNamesEquivalent("受伤外门弟子", "外门弟子"), true);
assert.equal(areDiscoveredCharacterNamesEquivalent("外门弟子（无名）", "外门弟子"), true);
assert.equal(inferDiscoveredCharacterRoleType("外门弟子"), "extra");
assert.equal(inferDiscoveredCharacterRoleType("裴无咎"), "supporting");
assert.equal(plannedCharacterCoversDiscoveredName({ name: "黑影", brief: "魔修接头人，与萧寒交易。" }, "魔修"), true);
assert.equal(plannedCharacterCoversDiscoveredName({ name: "魔修甲", brief: "魔修喽啰。" }, "魔修"), true);
assert.equal(plannedCharacterCoversDiscoveredName({ name: "沈瑶", brief: "被萧寒利用。" }, "萧寒"), false);
assert.equal(getShotPacingWarning("short-drama", 0.35, 8, 24.5), null);
assert.equal(getShotPacingWarning("short-drama", 0.35, 20, 15), "镜头数远超标准可能过碎");
assert.equal(getShotPacingWarning("movie", 2, 1, 100), "镜头数偏少可能节奏拖沓");
const bibleAISource = fs.readFileSync(new URL("../src/hooks/useBibleAI.ts", import.meta.url), "utf-8");
assert.ok(bibleAISource.includes("logBibleAIError"));
assert.ok(bibleAISource.includes("summarizeUnknownError"));
assert.equal(bibleAISource.includes("console.error(error)"), false);
const studioAISource = fs.readFileSync(new URL("../src/hooks/useStudioAI.ts", import.meta.url), "utf-8");
const storyboardAISource = fs.readFileSync(new URL("../src/hooks/useStoryboardAI.ts", import.meta.url), "utf-8");
const storyboardPageSource = fs.readFileSync(new URL("../src/pages/Storyboard.tsx", import.meta.url), "utf-8");
assert.ok(studioAISource.includes("summarizeUnknownError"));
assert.ok(storyboardAISource.includes("summarizeUnknownError"));
assert.equal(studioAISource.includes("Generate Image Error:\", error"), false);
assert.equal(storyboardAISource.includes("Generate Shots Error:\", error"), false);
assert.ok(storyboardAISource.includes('collectProjectAssetsForContext(currentProject, "location")'));
assert.ok(storyboardAISource.includes('collectProjectAssetsForContext(currentProject, "prop")'));
assert.ok(storyboardAISource.includes("createSceneScopedContextSelection"));
assert.ok(storyboardAISource.includes("dialogueLines"));
assert.ok(storyboardAISource.includes("normalizeShotDialogueLines"));
assert.ok(storyboardAISource.includes("inferCharacterIdsFromShotText"));
assert.ok(storyboardAISource.includes("collectStoryboardAssetCandidates"));
assert.equal(storyboardAISource.includes("?.canonicalId || idOrName"), false);
assert.ok(storyboardPageSource.includes('next.set("sceneId", sceneId)'), "storyboard scene selection must update the canonical URL state");
assert.ok(storyboardPageSource.includes("onSelect={selectScene}"));
assert.equal(storyboardPageSource.includes("setActiveSceneId(id)"), false, "a stale URL scene id must not reset a rail selection");
const visualsPromptSource = fs.readFileSync(new URL("../src/config/prompts/visuals.ts", import.meta.url), "utf-8");
assert.ok(visualsPromptSource.includes("dialogueLines"));
assert.ok(visualsPromptSource.includes("正式项目角色必须填写有效 characterId 和 text"));
assert.ok(visualsPromptSource.includes("临时人物必须填写 speakerName 和 text"));
assert.ok(visualsPromptSource.includes("即使只有一句角色台词，也要写入 dialogueLines"));
assert.ok(visualsPromptSource.includes("180 度轴线"));
assert.ok(visualsPromptSource.includes("视线匹配"));
assert.ok(visualsPromptSource.includes("动作顺接"));
assert.ok(visualsPromptSource.includes("空间方位连续性"));
const skillForgeSource = fs.readFileSync(new URL("../src/components/SkillForge.tsx", import.meta.url), "utf-8");
const promptRegistrySource = fs.readFileSync(new URL("../src/config/prompts/index.ts", import.meta.url), "utf-8");
assert.equal(promptRegistrySource.includes("generateSkillProfile"), false);
assert.equal(promptRegistrySource.includes("skillTemplates"), false);
assert.equal(skillForgeSource.includes("normalizeSkillData"), false);
assert.equal(skillForgeSource.includes("referenceStrength"), false);
assert.equal(skillForgeSource.includes("generateAIContent"), false);
const projectTypesSource = fs.readFileSync(new URL("../src/types/project.ts", import.meta.url), "utf-8");
assert.equal(projectTypesSource.includes("conflictMechanics?: string"), false);
assert.equal(projectTypesSource.includes("forbiddenCliches?: string[]"), false);
assert.ok(projectTypesSource.includes("applicableFormats?: string[]"));
assert.ok(projectTypesSource.includes("applicableStages?: Array<\"skeleton\" | \"beat\" | \"scene\">"));
const gameTypesSource = fs.readFileSync(new URL("../src/types/game.ts", import.meta.url), "utf-8");
assert.ok(gameTypesSource.includes("export interface InteractiveGameDesignDoc"));
assert.ok(gameTypesSource.includes("export interface InteractiveRuntimeCompilation"));
assert.ok(gameTypesSource.includes("export interface InteractiveContinuitySnapshot"));
assert.ok(gameTypesSource.includes("export interface InteractivePlaytestTelemetryAnalysis"));
assert.ok(gameTypesSource.includes("export interface InteractiveMediaAssemblyPlan"));
const productionTypesSource = fs.readFileSync(new URL("../src/types/production.ts", import.meta.url), "utf-8");
assert.ok(productionTypesSource.includes("pilotPlan"));
assert.ok(productionTypesSource.includes("runtimeControlOverrides"));
assert.ok(productionTypesSource.includes("omittedProjectContext"));
assert.ok(productionTypesSource.includes("fieldEvidence"));
assert.ok(productionTypesSource.includes("export interface AgentDefinition"));
assert.ok(productionTypesSource.includes("export interface WorkflowStepDefinition"));
assert.ok(productionTypesSource.includes("export interface ArtifactEnvelope"));
assert.ok(productionTypesSource.includes("export interface QAVerdict"));
assert.ok(productionTypesSource.includes("export interface RetryPolicy"));
const productionRunnerSource = fs.readFileSync(new URL("../src/services/production/runners.ts", import.meta.url), "utf-8");
assert.equal(/switch\s*\(\s*executionStage\.stageType\s*\)/.test(productionRunnerSource), false);
assert.ok(productionRunnerSource.includes("productionStageExecutorRegistry"));
assert.equal(productionRunnerSource.includes("useProjectStore"), false);
assert.equal(/\bfetch\s*\(/.test(productionRunnerSource), false);
assert.ok(productionRunnerSource.includes("./runnerRepositoryAccess"));
assert.equal(productionRunnerSource.includes("getProductionRepository"), false);
const productionRunnerRepositoryAccessSource = fs.readFileSync(new URL("../src/services/production/runnerRepositoryAccess.ts", import.meta.url), "utf-8");
assert.ok(productionRunnerRepositoryAccessSource.includes("getProductionRepository"));
const productionPrepRuntimeSource = fs.readFileSync(new URL("../packages/production/src/services/production/productionPrepRuntime.ts", import.meta.url), "utf-8");
assert.ok(productionPrepRuntimeSource.includes("resolveProductionPrepBundle"));
assert.ok(productionPrepRuntimeSource.includes("createScriptLockBundle"));
assert.ok(productionPrepRuntimeSource.includes("createContentLockBundle"));
const productionPrepStageRunnerSource = fs.readFileSync(new URL("../src/services/production/productionPrepStageRunners.ts", import.meta.url), "utf-8");
const productionAssetSyncStageRunnerSource = fs.readFileSync(new URL("../src/services/production/productionAssetSyncStageRunner.ts", import.meta.url), "utf-8");
const productionStoryboardStageRunnerSource = fs.readFileSync(new URL("../src/services/production/productionStoryboardStageRunner.ts", import.meta.url), "utf-8");
const productionPromptStageRunnerSource = fs.readFileSync(new URL("../src/services/production/productionPromptStageRunner.ts", import.meta.url), "utf-8");
assert.ok([
  productionPrepStageRunnerSource,
  productionAssetSyncStageRunnerSource,
  productionStoryboardStageRunnerSource,
  productionPromptStageRunnerSource,
].some((source) => source.includes("./productionPrepRuntime")));
assert.ok([
  productionPrepStageRunnerSource,
  productionAssetSyncStageRunnerSource,
  productionStoryboardStageRunnerSource,
  productionPromptStageRunnerSource,
].some((source) => source.includes("./runnerArtifacts")));
const productionRunnerArtifactsSource = fs.readFileSync(new URL("../packages/production/src/services/production/runnerArtifacts.ts", import.meta.url), "utf-8");
assert.ok(productionRunnerArtifactsSource.includes("export const makeIssue"));
assert.ok(productionRunnerArtifactsSource.includes("export const makeQA"));
assert.ok(productionRunnerArtifactsSource.includes("export const makeArtifact"));
const productionRepositorySource = fs.readFileSync(new URL("../packages/production/src/services/production/repositories.ts", import.meta.url), "utf-8");
assert.ok(productionRepositorySource.includes("export interface ProjectRepository"));
assert.ok(productionRepositorySource.includes("export interface EpisodeRepository"));
assert.ok(productionRepositorySource.includes("export interface OperatorArtifactRepository"));
const productionStageRunnerKernelSource = fs.readFileSync(new URL("../src/services/production/stageRunnerKernel.ts", import.meta.url), "utf-8");
assert.ok(productionStageRunnerKernelSource.includes("executeProductionStageWithKernel"));
assert.equal(productionStageRunnerKernelSource.includes("useProjectStore"), false);
assert.equal(/\bfetch\s*\(/.test(productionStageRunnerKernelSource), false);
const definedStageTypes = Array.from(new Set(
  [...linearStageDefinitions, ...interactiveStageDefinitions].map((definition) => definition.stageType),
)).sort();
assert.deepEqual(Object.keys(productionStageExecutorRegistry).sort(), definedStageTypes);
[
  "../app/applet/fix_bible.js",
  "../app/applet/test-openai.js",
  "../archive/legacy-src/README.md",
  "../archive/legacy-src/Script.tsx.backup",
  "../archive/legacy-src/Script.tsx.bak",
  "../archive/legacy-src/ShotAnalysis.tsx.bak2",
  "../archive/legacy-src/World.tsx.bak",
  "../fix_bible_templates.js",
  "../fix_prompts.cjs",
  "../fix_useBibleAI.cjs",
  "../modify_prompts.cjs",
  "../modify_prompts_2.cjs",
  "../modify_prompts_3.cjs",
  "../modify_prompts_4.cjs",
  "../modify_prompts_5.cjs",
  "../patch_context.cjs",
  "../scratch/apply_aside.py",
  "../scratch/apply_center.py",
  "../scratch/recover.py",
  "../scratch/recovered_code.txt",
  "../scratch/replacement_aside.txt",
  "../scratch/replacement_center.txt",
  "../scratch/replay.py",
  "../scratch/step_383_args.json",
  "../scratch/target_aside.txt",
  "../scratch/target_center.txt",
  "../src/config/prompts.ts.bak",
].forEach((retiredPath) => {
  assert.equal(fs.existsSync(new URL(retiredPath, import.meta.url)), false, `${retiredPath} should stay deleted.`);
});

const agentRegistryIssues = validateProductionAgentRegistry();
assert.deepEqual(agentRegistryIssues, []);
productionAgentRegistry
  .filter((agent) => agent.role === "producer")
  .forEach((agent) => {
    assert.equal(/[,|+]/.test(agent.owns), false, `${agent.id} must own exactly one responsibility.`);
  });
productionWorkflowStepRegistry.forEach((step) => {
  assert.ok(step.qaAgentIds.length > 0, `${step.id} must declare at least one QA agent.`);
  if (step.trigger === "auto" && step.stageType) {
    assert.ok(
      step.qaAgentIds.includes(`qa.contract.stage.${step.stageType}`),
      `${step.id} must include contract QA.`,
    );
  }
});
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "autostudio.stage.intake"));
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "manual.script.rewrite_scene" && step.trigger === "manual"));
[
  ["linear.concept.generate", "linear.concept.producer", "qa.contract.stage.concept"],
  ["linear.context.plan", "linear.context.planner", "qa.linear.context_contamination"],
  ["linear.asset.character_detail", "linear.asset.character_detailer", "qa.contract.stage.asset_detail"],
  ["linear.asset.location_detail", "linear.asset.location_detailer", "qa.contract.stage.asset_detail"],
  ["linear.asset.prop_detail", "linear.asset.prop_detailer", "qa.contract.stage.asset_detail"],
  ["linear.asset.board_plan", "linear.asset.board_plan_planner", "qa.linear.asset_board_plan"],
  ["linear.script.write", "linear.script.writer", "qa.contract.stage.script"],
  ["linear.breakdown.extract", "linear.breakdown.extractor", "qa.linear.asset_ref_integrity"],
  ["linear.script.plan_performance_beats", "linear.script.performance_beat_planner", "qa.linear.performance_beats"],
  ["linear.asset_sync.plan_scene_visual_packs", "linear.asset_sync.scene_visual_pack_planner", "qa.linear.scene_visual_pack"],
  ["linear.storyboard.plan_shots", "linear.storyboard.shot_planner", "qa.linear.asset_ref_integrity"],
  ["linear.storyboard.plan_continuity", "linear.storyboard.continuity_planner", "qa.linear.shot_continuity"],
  ["linear.storyboard.plan_boards", "linear.storyboard.board_planner", "qa.linear.storyboard_board"],
  ["linear.prompt.compile_image", "linear.prompt.image_compiler", "qa.contract.stage.prompt"],
  ["linear.prompt.compile_video", "linear.prompt.video_compiler", "qa.contract.stage.prompt"],
  ["linear.prompt.plan_asset_reference_pack", "linear.prompt.asset_reference_pack_planner", "qa.linear.asset_reference_pack"],
  ["linear.media.provenance_qa", "linear.prompt.video_compiler", "qa.linear.media_provenance"],
  ["linear.expensive_generation.plan_video_units", "linear.expensive_generation.video_unit_planner", "qa.linear.video_generation_unit"],
  ["manual.bible.generate", "manual.bible.generate", "qa.manual.prompt_preview"],
  ["manual.structure.generate", "manual.structure.generate", "qa.manual.prompt_preview"],
  ["manual.storyboard.generate", "manual.storyboard.generate", "qa.linear.shot_continuity"],
  ["manual.studio.media_generate", "manual.studio.media_generate", "qa.linear.media_provenance"],
  ["manual.game.editor", "manual.game.editor", "qa.manual.prompt_preview"],
  ["manual.game.editor.commit", "manual.game.editor", "qa.interactive.graph_integrity"],
  ["production.magic_import.novel_to_script", "manual.production.novel_to_script", "qa.manual.prompt_preview"],
  ["production.preparation.scene_plan", "manual.production.scene_plan", "qa.manual.prompt_preview"],
  ["production.preparation.scene_plan_qa", "manual.production.scene_plan", "qa.manual.prompt_preview"],
  ["production.preparation.scene_plan_optimize", "manual.production.scene_plan", "qa.manual.prompt_preview"],
  ["production.asset.profile_enrichment", "manual.production.asset_profile", "qa.manual.prompt_preview"],
  ["shot-analysis-segment", "manual.shot_analysis", "qa.manual.prompt_preview"],
  ["shot-analysis-macro", "manual.shot_analysis", "qa.manual.prompt_preview"],
  ["interactive.game_design_doc.generate", "interactive.game_design_doc", "qa.contract.stage.game_blueprint"],
  ["interactive.runtime.compile", "interactive.runtime_compiler", "qa.interactive.runtime_schema"],
  ["interactive.continuity.track", "interactive.continuity_state_tracker", "qa.interactive.branch_continuity"],
  ["interactive.telemetry.analyze", "interactive.telemetry_analyzer", "qa.interactive.playtest_coverage"],
  ["interactive.media.assemble", "interactive.media_assembly_planner", "qa.interactive.media_assembly"],
].forEach(([stepId, producerAgentId, qaAgentId]) => {
  const step = productionWorkflowStepRegistry.find((item) => item.id === stepId);
  assert.ok(step, `${stepId} should be registered.`);
  assert.equal(step?.producerAgentId, producerAgentId);
  assert.ok(step?.qaAgentIds.includes(qaAgentId), `${stepId} should include ${qaAgentId}.`);
});
assert.equal(inferManualWorkflowStepId("production.bible", "bible"), "manual.bible.generate");
assert.equal(inferManualWorkflowStepId("generateEpisodes", "structure"), "manual.structure.generate");
assert.equal(inferManualWorkflowStepId("production.script", "script"), "manual.script.rewrite_scene");
assert.equal(inferManualWorkflowStepId("production.storyboard", "storyboard"), "manual.storyboard.generate");
assert.equal(inferManualWorkflowStepId("production.prompt", "prompt"), "manual.studio.media_generate");
assert.equal(inferManualWorkflowStepId("production.graphGeneration", "graph_generation"), "manual.game.editor");
const invalidMultiRoleAgent = {
  ...productionAgentRegistry.find((agent) => agent.id === "concept.agent")!,
  id: "bad.multi_role_agent",
  owns: "stage:concept|stage:script",
};
assert.ok(
  validateProductionAgentRegistry([...productionAgentRegistry, invalidMultiRoleAgent], productionWorkflowStepRegistry)
    .some((issue) => issue.includes("producer owns must describe exactly one responsibility")),
);
assert.ok(
  validateProductionAgentRegistry(productionAgentRegistry, [
    { ...productionWorkflowStepRegistry[0], id: "bad.step.no_qa", qaAgentIds: [] },
  ]).some((issue) => issue.includes("missing qa agents")),
);

const normalizedIssue = normalizeProductionQAIssue({
  id: "issue-contract-missing",
  severity: "blocking",
  target: "scriptBlocks",
  message: "Missing script blocks.",
  suggestion: "Generate at least one script block.",
  issueType: "schema",
});
assert.ok(normalizedIssue.fingerprint?.startsWith("qa."));
assert.equal(normalizedIssue.retryable, true);
assert.equal(normalizedIssue.repairInstruction, "Generate at least one script block.");

const autoGatewayResult = await runAgentGatewayStep({
  workflowStepId: "autostudio.stage.intake",
  input: { title: "Agent gateway intake smoke test" },
  producer: ({ input }) => ({
    archivedTitle: input.title,
    archivedAt: "test",
  }),
  qaHandlers: {
    "qa.contract.stage.intake": () => ({
      status: "passed",
      blocking: false,
      score: 100,
      issues: [],
    }),
  },
});
assert.equal(autoGatewayResult.step.trigger, "auto");
assert.equal(autoGatewayResult.draft.status, "approved");
assert.equal(autoGatewayResult.retryDecision.nextAction, "commit");

const manualGatewayResult = await runAgentGatewayStep({
  workflowStepId: "manual.script.rewrite_scene",
  input: { sceneId: "scene-1", instruction: "tighten dialogue" },
  producer: ({ input }) => ({
    sceneId: input.sceneId,
    scriptBlocks: [{ type: "dialogue", text: "We keep the scene alive." }],
    breakdown: { characters: [], props: [] },
  }),
  qaHandlers: {
    "qa.contract.manual.script_rewrite": () => ({
      status: "passed",
      blocking: false,
      score: 100,
      issues: [],
    }),
  },
});
assert.equal(manualGatewayResult.step.trigger, "manual");
assert.equal(manualGatewayResult.producerAgent.id, "manual.script.rewrite_scene");
assert.equal(manualGatewayResult.draft.status, "approved");

const manualGatewaySmokeInputs = [
  {
    templateId: "production.bible",
    stageType: "bible" as const,
    expectedStepId: "manual.bible.generate",
    finalPrompt: "Generate a production bible with selectedContext, skills and userIntent.",
  },
  {
    templateId: "production.script",
    stageType: "script" as const,
    expectedStepId: "manual.script.rewrite_scene",
    finalPrompt: "Rewrite this scene with scriptBlocks and production breakdown.",
  },
  {
    templateId: "production.storyboard",
    stageType: "storyboard" as const,
    expectedStepId: "manual.storyboard.generate",
    finalPrompt: "Generate storyboard shots with blocking, eyeline and continuity notes.",
  },
  {
    templateId: "production.prompt",
    stageType: "prompt" as const,
    expectedStepId: "manual.studio.media_generate",
    finalPrompt: "Generate image prompt and video prompt for shot shot-1.",
  },
  {
    templateId: "production.graphGeneration",
    stageType: "graph_generation" as const,
    expectedStepId: "manual.game.editor",
    finalPrompt: "Generate interactive game graph nodes, edges and variables.",
  },
];
for (const smoke of manualGatewaySmokeInputs) {
  const reviewed = await runManualPromptGatewayReview({
    templateId: smoke.templateId,
    stageType: smoke.stageType,
    finalPrompt: smoke.finalPrompt,
    currentTemplate: "{{selectedContext}}\n{{skills}}\n{{userIntent}}",
    variables: {},
    userIntent: "smoke test",
    selectedContextIds: ["ctx_project"],
    selectedSkillIds: [],
    missingVariables: [],
    templateConflicts: [],
  });
  assert.equal(reviewed.step.id, smoke.expectedStepId);
  assert.equal(reviewed.step.trigger, "manual");
  assert.notEqual(reviewed.draft.status, "quarantined");
  assert.ok(reviewed.qaVerdicts.length > 0);
}

const explicitManualWorkflowStepSmokeInputs = [
  ["production.magic_import.novel_to_script", "productionNovelToScript", "将小说来源改写为候选剧本正文。"],
  ["production.preparation.scene_plan", "productionScenePlan", "根据完整剧本生成可采用的制片场次候选。"],
  ["production.preparation.scene_plan_qa", "productionScenePlanQa", "检查当前制片场次方案的原文覆盖和连续性。"],
  ["production.preparation.scene_plan_optimize", "productionScenePlanOptimize", "根据已确认质检意见生成新的场次方案候选。"],
  ["production.asset.profile_enrichment", "productionAssetCharacterProfile", "根据完整剧本、已确认拆解和部门连续性生成角色档案候选。"],
  ["shot-analysis-segment", "shotAnalysisSegment", "分析当前视频片段的镜头与表演信息。"],
  ["shot-analysis-macro", "shotAnalysisMacro", "综合多个片段的拉片结果，形成整体分析。"],
] as const;
for (const [workflowStepId, templateId, finalPrompt] of explicitManualWorkflowStepSmokeInputs) {
  const reviewed = await runManualPromptGatewayReview({
    templateId,
    workflowStepId,
    finalPrompt,
    currentTemplate: "{{selectedContext}}\n{{skills}}\n{{userIntent}}",
    variables: {},
    userIntent: "smoke test",
    selectedContextIds: [],
    selectedSkillIds: [],
    missingVariables: [],
    templateConflicts: [],
  });
  assert.equal(reviewed.step.id, workflowStepId, `${workflowStepId} must be routable through the manual prompt gateway.`);
  assert.equal(reviewed.step.trigger, "manual");
}

const blockingVerdict = {
  qaAgentId: "qa.contract.manual.script_rewrite",
  status: "failed" as const,
  blocking: true,
  score: 40,
  issues: [normalizedIssue],
  nextAction: "retry" as const,
  createdAt: Date.now(),
};
const retryPolicyNoFallback = {
  ...defaultAgentRetryPolicy,
  id: "retry.test.no_fallback",
  maxAutoRetries: 2,
  maxModelFallbacks: 0,
};
const firstRetryDecision = evaluateRetryDecision(retryPolicyNoFallback, [blockingVerdict], []);
assert.equal(firstRetryDecision.nextAction, "retry");
const repeatedHistory = [createRetryAttempt(1, [blockingVerdict], "draft.previous")];
const repeatedDecision = evaluateRetryDecision(retryPolicyNoFallback, [blockingVerdict], repeatedHistory, "draft.changed");
assert.equal(repeatedDecision.nextAction, "human_review");
assert.equal(repeatedDecision.stuckReason, "same_issue_loop");
const budgetDecision = evaluateRetryDecision(
  { ...retryPolicyNoFallback, maxAutoRetries: 1 },
  [blockingVerdict],
  repeatedHistory,
);
assert.equal(budgetDecision.nextAction, "human_review");
assert.equal(budgetDecision.stuckReason, "retry_budget_exhausted");
const lowScoreIssue = normalizeProductionQAIssue({
  id: "issue-low-score",
  severity: "blocking",
  target: "creativeQuality",
  message: "Scene still lacks actionable stakes.",
  suggestion: "Add a concrete tradeoff.",
  issueType: "creative_quality",
});
const lowScoreDecision = evaluateRetryDecision(
  { ...retryPolicyNoFallback, maxAutoRetries: 3, minScoreDelta: 5 },
  [{
    ...blockingVerdict,
    score: 42,
    issues: [lowScoreIssue],
  }],
  [{
    id: "agent-attempt-previous-low-score",
    attempt: 1,
    score: 40,
    issueFingerprints: ["qa.previous"],
    createdAt: Date.now(),
  }],
);
assert.equal(lowScoreDecision.nextAction, "human_review");
assert.equal(lowScoreDecision.stuckReason, "score_delta_too_low");

const stuckGatewayResult = await runAgentGatewayStep({
  workflowStepId: "manual.script.rewrite_scene",
  input: { sceneId: "scene-2", instruction: "fix missing blocks" },
  producer: () => ({ sceneId: "scene-2", scriptBlocks: [] }),
  retryPolicy: { ...retryPolicyNoFallback, maxAutoRetries: 0 },
  qaHandlers: {
    "qa.contract.manual.script_rewrite": () => ({
      status: "failed",
      blocking: true,
      score: 20,
      issues: [normalizedIssue],
    }),
  },
});
assert.equal(stuckGatewayResult.draft.status, "quarantined");
assert.equal(stuckGatewayResult.retryDecision.nextAction, "human_review");
assert.ok(stuckGatewayResult.humanInterventionTask);

assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "import.source_intake" && step.qaAgentIds.includes("rights.source_clearance")));
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "analysis.segment_analyzer" && step.qaAgentIds.includes("qa.analysis.segment_schema")));
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "dna.beat_template_extractor" && step.qaAgentIds.includes("qa.dna.no_source_copying")));
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "skill.profile_generator" && step.qaAgentIds.includes("qa.skill.structural_completeness")));
assert.ok(productionWorkflowStepRegistry.some((step) => step.id === "reference.context_router" && step.qaAgentIds.includes("qa.reference.contamination")));

const sourceArtifact = createSourceArtifact({
  kind: "adaptation_source",
  sourceType: "novel",
  sourceText: "一个原创故事大纲：主角必须在雨夜选择是否公开真相。",
  title: "source smoke",
});
assert.ok(sourceArtifact.sourceHash.startsWith("src."));
assert.equal(sourceArtifact.truncated, false);
assert.ok(sourceArtifact.rightsBoundary.includes("改编"));
assert.ok(sourceArtifact.adaptationBoundary.includes("不得复制"));

const assetValidation = validateAdaptationAssets({
  logline: "主角必须公开真相，否则城市会失去最后证据。",
  characters: [
    { id: "char-a", name: "林夏", traits: ["坚定"], motivation: "公开真相" },
    { id: "char-b", name: "林夏", traits: ["重复"], motivation: "重复" },
  ],
  locations: [
    { id: "loc-a", name: "档案馆", description: "雨夜档案馆" },
    { id: "loc-b", name: "档案馆", description: "重复地点" },
  ],
}, {
  characterNames: [],
  locationNames: [],
});
assert.equal(assetValidation.assets.characters.length, 1);
assert.equal(assetValidation.assets.locations.length, 1);
assert.equal(assetValidation.verdict.status, "warning");
assert.ok(assetValidation.verdict.issues.every((issue) => issue.fingerprint && typeof issue.retryable === "boolean"));

const shortDramaBeatVerdict = validateAdaptationBeatDraft([
  { id: "beat-1", title: "开局", summary: "发现证据", isCliffhanger: true, status: "completed", generatedScript: [{ type: "scene_heading", content: "INT. 档案馆 - 夜" }] },
  { id: "beat-2", title: "反转", summary: "证据被夺", isCliffhanger: false, status: "completed", generatedScript: [{ type: "action", content: "灯光熄灭。" }] },
], "short-drama");
assert.equal(shortDramaBeatVerdict.status, "warning");
assert.ok(shortDramaBeatVerdict.issues.some((issue) => issue.target === "beatSheet.length"));
assert.ok(shortDramaBeatVerdict.issues.some((issue) => issue.target === "beatSheet.cliffhanger"));

const adaptationDraftPackage = await buildAdaptationDraftPackage({
  sourceText: "原创输入文本：主角在雨夜公开真相。",
  sourceType: "outline",
  targetFormat: "short-drama",
  globalAssets: assetValidation.assets,
  beatSheet: [
    { id: "beat-1", title: "开局", summary: "发现证据", isCliffhanger: true, status: "completed", generatedScript: [{ type: "scene_heading", content: "INT. 档案馆 - 夜" }] },
    { id: "beat-2", title: "反转", summary: "证据被夺", isCliffhanger: true, status: "completed", generatedScript: [{ type: "action", content: "灯光熄灭。" }] },
    { id: "beat-3", title: "追击", summary: "追查线索", isCliffhanger: true, status: "completed", generatedScript: [{ type: "action", content: "她追进雨幕。" }] },
    { id: "beat-4", title: "终局", summary: "公开真相", isCliffhanger: true, status: "completed", generatedScript: [{ type: "dialogue", content: "证据在这里。" }] },
  ],
});
assert.ok(adaptationDraftPackage.sourceArtifact.sourceHash);
assert.equal(adaptationDraftPackage.assetDraft.status, "approved");
assert.equal(adaptationDraftPackage.beatDraft.status, "approved");
assert.equal(adaptationDraftPackage.scriptDraft.status, "approved");

const governedSkill = governUniversalSkillForIntake({
  id: "skill-governance-smoke",
  title: "克制雨夜真相风格",
  content: "用低饱和雨夜、逐步释放信息和克制对白推动真相公开。只参考抽象气质和信息释放方式，不复制来源台词、人物或场景。",
  source: "manual",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
assert.ok(governedSkill.referenceGovernance);
assert.equal(governedSkill.referenceGovernance?.routingQaStatus, "passed");
assert.ok(governedSkill.referenceGovernance?.allowedStages.includes("structure"));

const governedDna = governExtractedBeatTemplate({
  id: "dna-smoke",
  sourceVideoName: "测试参考",
  globalTone: "压抑到释放",
  beats: [{
    timeRange: "0:00-0:10",
    beatName: "压力建立",
    baseMetrics: {
      emotionStart: -5,
      emotionEnd: 3,
      conflictType: "psychological",
      pacingSpeed: "fast",
    },
    appliedTechniques: [{ name: "TickingClock", description: "用倒计时制造压力，不复制具体事件。" }],
  }],
}, "测试参考 URL");
assert.ok(governedDna.referenceGovernance);
assert.notEqual(governedDna.referenceGovernance?.noSourceCopyQaStatus, "failed");
assert.ok(governedDna.referenceGovernance?.allowedStages.includes("storyboard"));

const governedSegmentAnalysis = governAnalysisSegmentResult({
  id: "vap-smoke",
  title: "拉片测试项目",
  type: "movie",
  segments: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}, {
  id: "segment-smoke",
  projectId: "vap-smoke",
  title: "第 1 段",
  mediaType: "text",
  sourceContent: "原创片段：角色在雨夜公开真相。",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}, {
  overview: "雨夜公开真相的压力段落。",
  rhythmWaves: "压抑 -> 犹豫 -> 释放",
  sceneLogic: "证据出现、被质疑、公开。",
  audiovisualStyle: "低饱和雨夜，缓慢推进。",
  visualKeywords: ["rain", "low saturation"],
  characterHighlights: "主角选择承担代价。",
});
assert.ok(governedSegmentAnalysis.sourceArtifact);
assert.ok(governedSegmentAnalysis.qaVerdicts?.length);
assert.ok(governedSegmentAnalysis.referenceGovernance?.allowedStages.includes("script"));

const governedMacro = governMacroDNA({
  id: "vap-smoke",
  title: "拉片测试项目",
  type: "movie",
  segments: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}, {
  overview: "多个雨夜真相段落形成的结构规律。",
  structureSkeleton: "秘密发现 -> 公开压力 -> 代价释放",
  coreDriver: "真相公开的代价",
  commonBeats: "证据出现、关系施压、公开选择",
}, [
  {
    id: "segment-1",
    projectId: "vap-smoke",
    title: "第 1 段",
    mediaType: "text",
    sourceContent: "片段一",
    analysisResult: governedSegmentAnalysis,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "segment-2",
    projectId: "vap-smoke",
    title: "第 2 段",
    mediaType: "text",
    sourceContent: "片段二",
    analysisResult: governedSegmentAnalysis,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]);
assert.deepEqual(governedMacro.evidenceSegmentIds, ["segment-1", "segment-2"]);
assert.notEqual(governedMacro.referenceGovernance?.structureQaStatus, "failed");

const routedReferences = routeProjectReferencesForContext({
  universalSkillRefs: [governedSkill],
  extractedDNAs: [governedDna],
});
assert.equal(routedReferences.universalSkillRefs.length, 1);
assert.equal(routedReferences.extractedDNAs.length, 1);
assert.equal(isReferenceAllowedForContext(governedSkill), true);

let lifecycleRun = createProductionRun(project, { name: "Artifact Lifecycle Smoke", policy: { reviewMode: "fast" } });
assert.deepEqual(lifecycleRun.artifactDependencies, []);
assert.deepEqual(lifecycleRun.artifactApprovals, []);
assert.deepEqual(lifecycleRun.qaWaivers, []);
assert.deepEqual(lifecycleRun.interventionTasks, []);
const lifecycleConceptStage = lifecycleRun.stages.find((stage) => stage.stageType === "concept")!;
lifecycleRun = {
  ...lifecycleRun,
  currentStageId: lifecycleConceptStage.id,
  status: "running",
  stages: lifecycleRun.stages.map((stage) =>
    stage.id === lifecycleConceptStage.id ? { ...stage, status: "running" } : stage,
  ),
};
lifecycleRun = applyStageExecutionResult(lifecycleRun, {
  summary: "Concept draft v1",
  artifacts: [{
    artifactType: "concept",
    targetPath: "project.concept",
    entityIds: [project.id],
    version: 1,
    summary: "Concept v1",
  }],
  qaReports: [{
    checkerId: "concept.qa",
    status: "warning",
    score: 82,
    issues: [{
      id: "concept-warning-waiveable",
      severity: "warning",
      target: "project.logline",
      message: "logline 仍可更锐利。",
      fingerprint: "qa.concept.warning",
      retryable: true,
      repairInstruction: "加强代价。",
    }],
    blocking: false,
  }],
  outputSnapshot: { logline: "v1" },
});
const conceptArtifactV1 = lifecycleRun.artifacts.find((artifact) => artifact.targetPath === "project.concept")!;
assert.equal(conceptArtifactV1.lifecycleStatus, "approved");
assert.ok(conceptArtifactV1.approvalRecords?.some((record) => record.action === "approve" && record.actor === "qa"));
const waiveableIssue = lifecycleRun.stages.find((stage) => stage.id === lifecycleConceptStage.id)?.qaReports.at(-1)?.issues[0]!;
assert.equal(canWaiveQAIssue(waiveableIssue), true);
assert.equal(canWaiveQAIssue(waiveableIssue, "CONTRACT"), false);
const waiver = createQAWarningWaiver({
  stageId: lifecycleConceptStage.id,
  artifactId: conceptArtifactV1.id,
  issue: waiveableIssue,
  reason: "作者接受该非阻断风格风险。",
});
assert.equal(waiver.issueFingerprint, "qa.concept.warning");
const runWithWaiver = {
  ...lifecycleRun,
  qaWaivers: [waiver],
  artifacts: lifecycleRun.artifacts.map((artifact) =>
    artifact.id === conceptArtifactV1.id
      ? { ...artifact, waiverIds: [waiver.id], stale: true }
      : artifact,
  ),
};
const expiredWaiverRun = expireWaiversForStaleArtifacts(runWithWaiver);
assert.equal(expiredWaiverRun.qaWaivers?.length, 0);
assert.deepEqual(
  expiredWaiverRun.artifacts.find((artifact) => artifact.id === conceptArtifactV1.id)?.waiverIds,
  [],
);
lifecycleRun = approveCurrentStage(lifecycleRun);
const lockedConceptArtifact = lifecycleRun.artifacts.find((artifact) => artifact.id === conceptArtifactV1.id)!;
assert.equal(lockedConceptArtifact.lifecycleStatus, "locked");
assert.equal(lockedConceptArtifact.locked, true);
assert.ok(lifecycleRun.artifactApprovals?.some((record) => record.artifactId === lockedConceptArtifact.id && record.action === "lock"));

lifecycleRun = {
  ...lifecycleRun,
  currentStageId: lifecycleConceptStage.id,
  status: "running",
  stages: lifecycleRun.stages.map((stage) =>
    stage.id === lifecycleConceptStage.id ? { ...stage, status: "running" } : stage,
  ),
};
lifecycleRun = applyStageExecutionResult(lifecycleRun, {
  summary: "Concept draft v2",
  artifacts: [{
    artifactType: "concept",
    targetPath: "project.concept",
    entityIds: [project.id],
    version: 1,
    summary: "Concept v2",
  }],
  qaReports: [{
    checkerId: "concept.qa",
    status: "passed",
    score: 100,
    issues: [],
    blocking: false,
  }],
  outputSnapshot: { logline: "v2" },
});
const conceptArtifactV2 = lifecycleRun.artifacts.find((artifact) => artifact.version === 2 && artifact.targetPath === "project.concept")!;
assert.equal(conceptArtifactV2.previousArtifactId, lockedConceptArtifact.id);
assert.ok(lifecycleRun.artifactDependencies?.some((edge) =>
  edge.sourceArtifactId === lockedConceptArtifact.id &&
  edge.targetArtifactId === conceptArtifactV2.id &&
  edge.relation === "overwrites",
));

let failedLifecycleRun = createProductionRun(project, { name: "Artifact Failure Smoke", policy: { reviewMode: "fast" } });
const failedConceptStage = failedLifecycleRun.stages.find((stage) => stage.stageType === "concept")!;
failedLifecycleRun = {
  ...failedLifecycleRun,
  currentStageId: failedConceptStage.id,
  status: "running",
  stages: failedLifecycleRun.stages.map((stage) =>
    stage.id === failedConceptStage.id ? { ...stage, status: "running" } : stage,
  ),
};
failedLifecycleRun = applyStageExecutionResult(failedLifecycleRun, {
  summary: "Concept failed draft",
  artifacts: [{
    artifactType: "concept",
    targetPath: "project.concept",
    entityIds: [project.id],
    version: 1,
    summary: "Bad concept",
  }],
  qaReports: [{
    checkerId: "concept.qa",
    status: "failed",
    score: 30,
    issues: [{
      id: "concept-blocking",
      severity: "blocking",
      target: "project.creativeVision",
      message: "缺少 concept 强约束字段。",
      fingerprint: "qa.concept.blocking",
      retryable: true,
      repairInstruction: "补齐 want/need/stakes。",
    }],
    blocking: true,
  }],
  outputSnapshot: { logline: "" },
});
const failedArtifact = failedLifecycleRun.artifacts.find((artifact) => artifact.targetPath === "project.concept")!;
assert.ok(["qa_failed", "quarantined"].includes(failedArtifact.lifecycleStatus || ""));
assert.ok((failedLifecycleRun.interventionTasks || []).some((task) => task.issueFingerprints.includes("qa.concept.blocking")));
assert.equal(canWaiveQAIssue({
  id: "blocking",
  severity: "blocking",
  target: "x",
  message: "blocked",
  fingerprint: "qa.blocking",
}), false);

const authorityProject = {
  ...project,
  aspectRatio: "16:9",
  logline: "权威 logline",
  coreConflict: "权威冲突",
  creativeVision: { genre: ["Drama"], visualStyle: "Noir", narrativeStyle: "", referenceWorks: "" },
  characters: [],
  assets: [],
  episodes: [{ id: "authority-episode", title: "权威段落", inspiration: "", sceneCount: 1 }],
  globalGenerationParams: { qualityPrompt: "", negativePrompt: "" },
} as any;
useProjectStore.setState({
  projects: [authorityProject],
  currentProject: authorityProject,
  activeEpisodeId: "authority-episode",
  activeEpisode: {
    id: "authority-episode",
    title: "权威段落",
    scenes: [{ id: "authority-scene", title: "权威场景", description: "原始场景" }],
  } as any,
});
useGameStore.setState({
  projectId: authorityProject.id,
  episodeId: "authority-episode",
  data: {
    variables: [],
    nodes: [{ id: "authority-node", title: "权威节点", nodeType: "start", position: { x: 0, y: 0 } }],
    edges: [],
    blueprint: "权威蓝图",
    currentStep: 1,
    nodeSnapshots: [],
  } as any,
});
const authoritySnapshot = await captureProductionAuthoritySnapshot();
useProjectStore.setState({
  currentProject: { ...authorityProject, logline: "draft polluted" },
  activeEpisode: {
    id: "authority-episode",
    title: "污染段落",
    scenes: [{ id: "authority-scene", title: "污染场景", description: "污染" }],
  } as any,
});
useGameStore.setState({
  data: {
    variables: [],
    nodes: [{ id: "draft-node", title: "污染节点", nodeType: "event", position: { x: 1, y: 1 } }],
    edges: [],
    blueprint: "污染蓝图",
    currentStep: 9,
    nodeSnapshots: [],
  } as any,
});
await restoreProductionAuthoritySnapshot(authoritySnapshot);
assert.equal(useProjectStore.getState().currentProject?.logline, "权威 logline");
assert.equal(useProjectStore.getState().activeEpisode?.title, "权威段落");
assert.equal(useGameStore.getState().data.blueprint, "权威蓝图");

const plannedAssetContextProject = {
  ...project,
  assets: [],
  plannedLocations: [
    { id: "planned-location-1", type: "location", name: "山门试炼台", brief: "公开测试根骨与门规压迫的入口场景", isDetailed: false },
  ],
  plannedProps: [
    { id: "planned-prop-1", type: "prop", name: "裂纹测灵石", brief: "揭示天赋争议的关键道具", isDetailed: false },
  ],
} as any;
const plannedContextAssets = collectProjectAssetsForContext(plannedAssetContextProject);
assert.deepEqual(plannedContextAssets.map((asset) => asset.id), ["planned-location-1", "planned-prop-1"]);
const plannedContext = gatherContextOptions(plannedAssetContextProject, "generateScript");
assert.ok(plannedContext.defaultIds.includes("ctx_asset_planned-location-1"));
assert.ok(plannedContext.defaultIds.includes("ctx_asset_planned-prop-1"));
assert.ok(plannedContext.options.some((option) => option.value.includes("山门试炼台")));
const scopedScriptContext = createSceneScopedContextSelection(
  {
    ...plannedAssetContextProject,
    characters: [
      { id: "char-a", name: "陆青禾" },
      { id: "char-b", name: "萧寒" },
      { id: "char-c", name: "白芷" },
    ],
    relationships: [
      { sourceId: "char-a", targetId: "char-b", type: "仇敌", description: "夺玉冲突" },
      { sourceId: "char-a", targetId: "char-c", type: "同盟", description: "后续同盟" },
    ],
  } as any,
  [
    ...plannedContext.options,
    {
      id: "ctx_char_char-a",
      label: "角色档案: 陆青禾",
      value: '<character name="陆青禾">主角</character>',
    },
    {
      id: "ctx_char_char-b",
      label: "角色档案: 萧寒",
      value: '<character name="萧寒">反派</character>',
    },
    {
      id: "ctx_char_char-c",
      label: "角色档案: 白芷",
      value: '<character name="白芷">盟友</character>',
    },
    {
      id: "ctx_relationships",
      label: "人物关系网络",
      value: "<relationships>\n全量关系\n</relationships>",
    },
  ],
  [
    ...plannedContext.defaultIds,
    "ctx_char_char-a",
    "ctx_char_char-b",
    "ctx_char_char-c",
    "ctx_relationships",
  ],
  {
    title: "夺玉坠炉",
    description: "陆青禾被萧寒夺走灵根玉，坠入山门试炼台下的废炉。",
    sceneAssets: "山门试炼台、裂纹测灵石、灵根玉",
  } as any,
);
assert.ok(scopedScriptContext.defaultSelectedContextIds.includes("ctx_char_char-a"));
assert.ok(scopedScriptContext.defaultSelectedContextIds.includes("ctx_char_char-b"));
assert.equal(scopedScriptContext.defaultSelectedContextIds.includes("ctx_char_char-c"), false);
assert.ok(scopedScriptContext.defaultSelectedContextIds.includes("ctx_asset_planned-location-1"));
assert.ok(scopedScriptContext.defaultSelectedContextIds.includes("ctx_asset_planned-prop-1"));
assert.ok(scopedScriptContext.defaultSelectedContextIds.includes("ctx_relationships"));
assert.ok(scopedScriptContext.contextOptions.find((option) => option.id === "ctx_relationships")?.value.includes("夺玉冲突"));
assert.equal(scopedScriptContext.contextOptions.find((option) => option.id === "ctx_relationships")?.value.includes("后续同盟"), false);
assert.equal(isLikelySameAssetName("宗门后山", "后山密林"), true);
const plannedBreakdown = normalizeBreakdownAssetIds(plannedAssetContextProject, {
  setting: "EXT.",
  location: { name: "山门试炼台" },
  time: "NIGHT",
  characters: [],
  props: [{ name: "裂纹测灵石" }],
} as any);
assert.equal(plannedBreakdown?.locationId, "planned-location-1");
assert.deepEqual(plannedBreakdown?.propIds, ["planned-prop-1"]);

const promptEditorModalSource = fs.readFileSync(new URL("../src/components/PromptEditorModal.tsx", import.meta.url), "utf-8");
assert.ok(promptEditorModalSource.includes("CONTEXT_RISK_THRESHOLD = 12"));
[
  "../src/pages/Storyboard.tsx",
  "../src/pages/Studio.tsx",
].forEach((path) => {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf-8");
  assert.ok(source.includes("PromptEditorModal"), `${path} should keep manual prompt preview before model calls`);
});
const manualTemplateFitSource = fs.readFileSync(new URL("../src/utils/manualTemplateFit.ts", import.meta.url), "utf-8");
assert.ok(manualTemplateFitSource.includes("未声明适用类型 / 未声明阶段"));
assert.ok(manualTemplateFitSource.includes("自定义模板（已声明适用范围）"));
assert.ok(manualTemplateFitSource.includes("normalizeLegacyManualTemplateScopes"));
assert.ok(manualTemplateFitSource.includes("buildManualTemplateConflictWarnings"));
assert.ok(manualTemplateFitSource.includes("Legacy BeatTemplate"));
assert.ok(manualTemplateFitSource.includes("推荐理由"));
assert.ok(manualTemplateFitSource.includes("冲突风险"));

const productionRunnersSource = fs.readFileSync(new URL("../src/services/production/runners.ts", import.meta.url), "utf-8");
const productionPromptContextSource = fs.readFileSync(new URL("../src/services/production/productionPromptContext.ts", import.meta.url), "utf-8");
const productionGenerationPlanningStageRunnerSource = fs.readFileSync(new URL("../src/services/production/productionGenerationPlanningStageRunner.ts", import.meta.url), "utf-8");
const productionOrchestratorSource = fs.readFileSync(new URL("../src/services/production/orchestrator.ts", import.meta.url), "utf-8");
assert.ok(productionOrchestratorSource.includes("buildPilotPlanSnapshot"));
assert.ok(productionOrchestratorSource.includes("pilotPlan: buildPilotPlanSnapshot(run)"));
assert.ok(productionOrchestratorSource.includes("effectiveRuntimeControlsForStage"));
assert.ok(productionOrchestratorSource.includes("runtimeControlSource"));
assert.ok(productionOrchestratorSource.includes("上下文遗漏报告"));
assert.ok(productionOrchestratorSource.includes("buildProductionTemplateConflictWarnings"));
assert.ok(productionOrchestratorSource.includes("allowedReferenceInputs"));
assert.ok(productionOrchestratorSource.includes("referenceFieldEvidence"));
assert.ok(productionOrchestratorSource.includes("fieldEvidence: referenceFieldEvidence"));
assert.ok(productionRunnersSource.includes("...run.policy.runtimeControls"));
assert.ok(productionRunnersSource.includes("stage.runtimeControlOverrides"));
assert.ok(productionRunnersSource.includes("buildStageContextTrace"));
assert.ok(productionPromptContextSource.includes("omittedProjectContext"));
assert.ok(productionPromptContextSource.includes("作者运行控制"));
assert.equal(productionPromptContextSource.includes("未注入关键上下文:"), false);
assert.ok(productionPromptContextSource.includes("sourceId: skill.id"));
assert.equal(productionPromptContextSource.includes("reference:${item.sourceId}"), false);
assert.equal(productionPromptContextSource.includes("skill.name || skill.id} ("), false);
assert.equal(productionGenerationPlanningStageRunnerSource.includes("estimatedCostUnits"), false);
assert.equal(productionGenerationPlanningStageRunnerSource.includes("approvalRequired"), false);
const ruleQaSource = fs.readFileSync(new URL("../src/services/production/ruleQa.ts", import.meta.url), "utf-8");
assert.ok(ruleQaSource.includes("contextPlan.videoAnalysisDnaMissingSkill"));
assert.ok(ruleQaSource.includes("contextPlan.referenceNotInjected"));
const productionGatesSource = fs.readFileSync(new URL("../src/services/production/gates.ts", import.meta.url), "utf-8");
assert.ok(productionGatesSource.includes("outputSnapshot.generationQueues"));
assert.ok(productionGatesSource.includes("manifest.context.omittedProjectContext"));

reportSelfCheckProgress("checking production run orchestration");
const contextPlan = createInitialContextPlan({
  ...project,
  appliedVADnaProjectId: "dna-1",
  universalSkillRefs: [
    { id: "skill-visual", title: "视觉参考", content: "画面保持红色警戒感，强调压迫和高反差。" },
    { id: "skill-dialogue", title: "对白参考", content: "对白短促锋利，每句都有试探、威胁或让步。" },
  ] as any,
});
assert.ok(contextPlan.visualSkills.includes("skill-visual"));
assert.ok(contextPlan.dialogueSkills.includes("skill-dialogue"));
assert.ok(contextPlan.pacingDNAs.includes("dna-1"));
assert.ok((contextPlan.tokenBudgetEstimate.script || 0) > 7200);
assert.ok((contextPlan.skillScores?.["skill-visual"] || 0) > 0);
const contextPlannerAgentReports = createContextPlannerQAReports(contextPlan, {
  ...project,
  appliedVADnaProjectId: "dna-1",
  universalSkillRefs: project.universalSkillRefs || [],
} as any);
reportSelfCheckProgress("checked production context planning");
assert.ok(contextPlannerAgentReports.some((report) => report.checkerId === "qa.linear.context_contamination" && report.blocking));
const missingVideoDnaSkillIssues = validateContextPlanRules(contextPlan, project.universalSkillRefs || [], {
  ...project,
  appliedVADnaProjectId: "dna-1",
  universalSkillRefs: project.universalSkillRefs || [],
} as any);
assert.ok(missingVideoDnaSkillIssues.some((issue) => issue.target === "contextPlan.videoAnalysisDnaMissingSkill" && issue.severity === "blocking"));
const linkedVideoSkillProject = {
  ...project,
  appliedVADnaProjectId: "dna-1",
	  universalSkillRefs: [
	    {
	      id: "skill-dna-structure",
	      title: "拉片结构参考",
	      content: "只参考代价、信息差、短促对白和折返节奏，不复制原片人物、台词或场景。",
	      sourceType: "video-analysis",
	      sourceProjectId: "dna-1",
	    },
	  ],
	} as any;
const linkedVideoContextPlan = createInitialContextPlan(linkedVideoSkillProject);
const linkedVideoIssues = validateContextPlanRules(linkedVideoContextPlan, linkedVideoSkillProject.universalSkillRefs, linkedVideoSkillProject);
assert.equal(linkedVideoIssues.some((issue) => issue.target === "contextPlan.videoAnalysisDnaMissingSkill"), false);
assert.equal(getProjectStage({
  logline: "Logline",
  coreConflict: "Conflict",
  creativeVision: { genre: [] },
  worldBuildingRules: [{ id: "rule-1" }],
  characters: [{ id: "char-1" }],
  episodes: [{ id: "ep-1", scenes: [{ id: "scene-1", scriptBlocks: [{ id: "block-1", type: "action", content: "Action" }] }] }],
}), 7);
assert.equal(getProjectStage({
  logline: "Logline",
  coreConflict: "Conflict",
  creativeVision: { genre: [] },
  worldBuildingRules: [{ id: "rule-1" }],
  characters: [{ id: "char-1" }],
  episodes: [{ id: "ep-1", scenes: [{ id: "scene-1", blocks: [{ content: "Legacy block" }] }] }],
}), 7);
const visualLanguageAssetIssues = validateAssetRules({
  characters: [{ id: "char-cn", name: "角色", multiViewPrompt: "中文角色多视图提示词" }],
  assets: [{ id: "asset-cn", type: "prop", name: "道具", description: "", prompt: "中文道具提示词", multiViewPrompt: "中文多视图提示词" }],
} as any);
assert.equal(visualLanguageAssetIssues.some((issue) => issue.target === "visualPrompt.language" && issue.severity === "blocking"), false);
const visualLanguagePromptIssues = validatePromptRules([
  {
    id: "ep-prompt-language",
    title: "Prompt Language",
    inspiration: "",
    scenes: [
      {
        id: "scene-prompt-language",
        title: "Prompt Language Scene",
        shots: [{ id: "shot-cn", imagePrompt: "中文图片提示词，低角度近景，角色手部动作清楚", videoPrompt: "中文视频提示词，镜头缓慢推进，角色动作连续" }],
      },
    ],
  },
] as any);
assert.equal(visualLanguagePromptIssues.some((issue) => issue.target === "shot.shot-cn.prompt.language" && issue.severity === "blocking"), false);
const weakConceptIssues = validateConceptRules({
  logline: "太短",
  coreConflict: "主角很难过",
  creativeVision: { genre: [], visualStyle: "Noir", narrativeStyle: "", referenceWorks: "" },
} as any);
assert.ok(weakConceptIssues.some((issue) => issue.target === "project.creativeVision.conceptContract" && issue.severity === "blocking"));
const sceneValueShiftIssues = validateSceneRules([
  {
    id: "ep-value-shift",
    title: "Value Shift",
    scenes: [
      {
        id: "scene-no-shift",
        title: "No Shift",
        description: "角色在房间里交谈。",
        valueCharge: "neutral",
        sceneGoal: "交谈",
        environment: "INT.",
        timeOfDay: "NIGHT",
      },
    ],
  },
] as any);
assert.ok(sceneValueShiftIssues.some((issue) => issue.target === "scenes.valueShift"));
const weakMovieFormatIssues = validateFormatSpecificRules({
  id: "movie-format",
  title: "Movie Format",
  projectModel: "linear",
  type: "movie",
  logline: "A director fights the machine.",
  coreConflict: "主角必须对抗自动制片系统，否则失去最后的作品。",
  creativeVision: { genre: [], want: "完成电影", need: "接受协作" },
} as any, [
  {
    id: "ep-movie-format",
    title: "Movie Format Segment",
    inspiration: "主角进入暗房。",
    scenes: [{
      id: "scene-movie-format",
      title: "No Shift",
      description: "主角进入暗房。",
      valueCharge: "neutral",
      sceneGoal: "进入",
    }],
  },
] as any);
assert.ok(weakMovieFormatIssues.some((issue) => issue.target === "format.movie.themeUnity"));
assert.ok(weakMovieFormatIssues.some((issue) => issue.target === "format.movie.visualMotif"));
reportSelfCheckProgress("checked production rule QA samples");
const storyboardAssetReferenceProject = {
  id: "project-asset-reference",
  visualStyleLock: {
    renderingMode: "3d_animation",
    stylePrompt: "皮克斯式 3D 卡通体块，柔和电影光，夸张但可信的表情。",
    colorPalette: ["雨夜蓝灰", "警示橙"],
    negativeStyleRules: ["不要写实真人摄影", "不要水墨"],
    source: "project_creation",
  },
  characters: [{
    id: "char-valid",
    name: "Lead",
    multiViewPrompt: "中文角色板：Lead 正面、侧面、背面、表情变化、风衣与疲惫眼神。",
    variants: [{ id: "variant-wounded", name: "受伤态", description: "额角擦伤、外套破损", promptModifiers: "增加血痕、破损袖口和疲惫呼吸。" }],
  }],
  plannedCharacters: [{ id: "planned-char-shadow", name: "黑影", roleType: "supporting", brief: "魔修接头人", isDetailed: false }],
  assets: [
    { id: "char-char-valid", type: "character", name: "Lead", description: "Mirror character asset" },
    { id: "loc-valid", type: "location", name: "Warehouse", description: "雨夜仓库", panoramaPrompt: "中文场景板：雨夜仓库，入口、货架、冷光、可拍机位。" },
    { id: "prop-valid", type: "prop", name: "Canister", description: "金属罐", multiViewPrompt: "中文道具板：金属罐正面、侧面、背面、铭牌和开关结构。", variants: [{ id: "variant-open", name: "开启态", description: "罐盖打开，蓝光外泄", promptModifiers: "增加开启缝隙和蓝色泄露光。" }] },
  ],
};
const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(storyboardAssetReferenceProject as any);
reportSelfCheckProgress("built production asset-board plan");
assert.equal(assetBoardPlan.characterBoards.length, 2);
assert.equal(assetBoardPlan.sceneBoards.length, 1);
assert.equal(assetBoardPlan.propBoards.length, 1);
assert.equal(assetBoardPlan.variantBoards.length, 2);
const resolvedAssetStyleLock = resolveVisualStyleLock(storyboardAssetReferenceProject as any);
reportSelfCheckProgress("resolved production asset visual style");
assert.ok(resolvedAssetStyleLock.assetBoardInstruction.includes("3d_animation"));
assert.equal(assetBoardPlan.characterBoards[0].strategyId, "assetBoard.characterIdentity.artbook.v1");
assert.equal(assetBoardPlan.sceneBoards[0].strategyId, "assetBoard.locationSetIdentity.production.v1");
assert.equal(assetBoardPlan.propBoards[0].strategyId, "assetBoard.propIdentity.production.v1");
assert.ok(assetBoardPlan.variantBoards.every((board) => board.strategyId === "assetBoard.variantDelta.stateLock.v1"));
assert.ok(assetBoardPlan.characterBoards[0].styleLockSummary?.includes("皮克斯式 3D 卡通体块"));
assert.equal(assetBoardPlan.characterBoards[0].prompt?.includes("皮克斯式 3D 卡通体块"), false, "raw asset prompts must not duplicate the structured visual-style projection");
assert.ok(assetBoardPlan.characterBoards[0].prompt?.includes("制作级角色身份板"));
assert.ok(assetBoardPlan.variantBoards[0].prompt?.includes("只表现当前状态，不改变 canonical 身份"));
assert.ok(assetBoardPlan.sceneBoards[0].prompt?.includes("场景/置景身份板"));
assert.ok(assetBoardPlan.propBoards[0].prompt?.includes("持握方式"));
const assetBoardPlanIssues = validateVideoStoryboardAssetBoardPlan(assetBoardPlan, storyboardAssetReferenceProject as any);
reportSelfCheckProgress("validated production asset-board plan");
assert.equal(assetBoardPlanIssues.some((issue) => issue.severity === "blocking"), false);
assert.equal(resolveAssetRef(storyboardAssetReferenceProject as any, "character", "char-char-valid")?.canonicalId, "char-valid");
assert.equal(resolveAssetRef(storyboardAssetReferenceProject as any, "character", "Lead")?.canonicalId, "char-valid");
assert.equal(resolveAssetRef(storyboardAssetReferenceProject as any, "character", "黑影")?.canonicalId, "planned-char-shadow");
assert.equal(resolveAssetRef(storyboardAssetReferenceProject as any, "character", "planned-char-shadow")?.canonicalId, "planned-char-shadow");
assert.equal(resolveAssetRef(storyboardAssetReferenceProject as any, "location", "Warehouse")?.canonicalId, "loc-valid");
reportSelfCheckProgress("resolved production asset references");
assert.deepEqual(
  normalizeBreakdownAssetIds(storyboardAssetReferenceProject as any, {
    setting: "INT.",
    location: "Warehouse",
    time: "NIGHT",
    characters: ["Lead"],
    props: ["Canister"],
    characterIds: ["char-char-valid"],
  } as any)?.characterIds,
  ["char-valid"],
);
reportSelfCheckProgress("checked production asset-board and reference plan");
const storyboardAssetReferenceIssues = validateStoryboardRules([
  {
    id: "ep-asset-reference",
    title: "Asset Reference",
    scenes: [
      {
        id: "scene-asset-reference",
        title: "Asset Reference Scene",
        scriptBlocks: [{ id: "block-asset-reference", type: "action", content: "Lead grabs the canister." }],
        breakdown: {
          characters: ["Lead"],
          characterIds: ["char-valid"],
          location: "Warehouse",
          locationId: "loc-valid",
          props: ["Canister"],
          propIds: ["prop-valid"],
        },
        shots: [
          {
            id: "shot-asset-reference",
            visualAction: "Lead grabs the canister and opens the warehouse door.",
            duration: 4,
            characterIdsInShot: ["char-missing"],
            locationId: "prop-valid",
            propIds: ["loc-valid"],
          },
        ],
      },
    ],
  },
] as any, storyboardAssetReferenceProject as any);
assert.ok(storyboardAssetReferenceIssues.some((issue) => issue.target === "shot.shot-asset-reference.characterIdsInShot" && issue.severity === "blocking"));
assert.ok(storyboardAssetReferenceIssues.some((issue) => issue.target === "shot.shot-asset-reference.visibleCharacter.char-valid" && issue.severity === "blocking"));
assert.ok(storyboardAssetReferenceIssues.some((issue) => issue.target === "shot.shot-asset-reference.locationId" && issue.severity === "blocking"));
assert.ok(storyboardAssetReferenceIssues.some((issue) => issue.target === "shot.shot-asset-reference.propIds" && issue.severity === "blocking"));
assert.ok(storyboardAssetReferenceIssues.some((issue) => issue.target === "shot.shot-asset-reference.shotGrammar"));
const propInsertReferenceIssues = validateStoryboardRules([
  {
    id: "ep-prop-insert-reference",
    title: "Prop Insert Reference",
    scenes: [{
      id: "scene-prop-insert-reference",
      title: "Prop Insert Reference Scene",
      breakdown: {
        characters: ["Lead"],
        characterIds: ["char-valid"],
        location: "Warehouse",
        locationId: "loc-valid",
        props: ["Canister"],
        propIds: ["prop-valid"],
      },
      shots: [{
        id: "shot-prop-insert-reference",
        shotSize: "CU",
        cameraAngle: "EYE_LEVEL",
        cameraMovement: "STATIC",
        focalLength: "85mm",
        lighting: "motivated practical key light",
        composition: "single prop centered in frame",
        blocking: "no performer visible",
        continuityNote: "the canister remains on the warehouse table",
        visualAction: "The canister valve rotates a quarter turn and stops.",
        duration: 3,
        characterIdsInShot: [],
        locationId: "loc-valid",
        propIds: ["prop-valid"],
      }],
    }],
  },
] as any, storyboardAssetReferenceProject as any);
assert.equal(propInsertReferenceIssues.some((issue) => issue.target === "shot.shot-prop-insert-reference.characterIdsInShot" && issue.severity === "blocking"), false);
const mirrorCharacterReferenceIssues = validateStoryboardRules([
  {
    id: "ep-mirror-reference",
    title: "Mirror Reference",
    scenes: [{
      id: "scene-mirror-reference",
      title: "Mirror Reference Scene",
      breakdown: {
        characters: ["Lead"],
        characterIds: ["char-char-valid"],
        location: "Warehouse",
        locationId: "loc-valid",
        props: [],
        propIds: [],
      },
      shots: [{
        id: "shot-mirror-reference",
        shotSize: "CU",
        cameraAngle: "LOW",
        cameraMovement: "PAN",
        focalLength: "50mm",
        lighting: "motivated practical key light",
        composition: "foreground prop frames the face",
        blocking: "lead stays screen left",
        continuityNote: "maintain eyeline",
        visualAction: "Lead grabs the warehouse door handle.",
        duration: 4,
        characterIdsInShot: ["char-char-valid"],
        locationId: "loc-valid",
      }],
    }],
  },
] as any, storyboardAssetReferenceProject as any);
assert.equal(mirrorCharacterReferenceIssues.some((issue) => issue.target === "shot.shot-mirror-reference.characterIdsInShot" && issue.severity === "blocking"), false);
const linearQaEpisode = {
  id: "ep-linear-agent-qa",
  title: "Linear Agent QA",
  scenes: [{
    id: "scene-linear-agent-qa",
    title: "Linear Agent QA Scene",
    description: "Lead grabs the canister.",
    breakdown: {
      characters: ["Lead"],
      characterIds: ["char-missing"],
      location: "Warehouse",
      locationId: "loc-valid",
      props: ["Canister"],
      propIds: ["prop-missing"],
    },
    scriptBlocks: [{
      id: "block-linear-agent-qa",
      type: "action",
      content: "Lead grabs the canister.",
      linkedAssetId: "char-valid",
      locationId: "loc-valid",
      propIds: ["prop-valid"],
    }],
    shots: [{
      id: "shot-linear-agent-qa",
      shotSize: "CU",
      cameraAngle: "LOW",
      cameraMovement: "PAN",
      visualAction: "Lead grabs the canister.",
      duration: 4,
      characterIdsInShot: ["char-valid"],
      locationId: "loc-valid",
      propIds: ["prop-valid"],
      imagePrompt: "Cinematic close-up of hands grabbing a metal canister, low angle, neon rim light",
      videoPrompt: "Slow pan across hands grabbing a metal canister under neon rim light",
      imageUrl: "/legacy/linear-agent-qa.png",
    }],
  }],
} as any;
const linearAssetRefIssues = validateLinearAssetRefs(storyboardAssetReferenceProject as any, [linearQaEpisode], "script");
assert.ok(linearAssetRefIssues.some((issue) => issue.target.includes("char-missing") && issue.severity === "blocking"));
assert.ok(linearAssetRefIssues.some((issue) => issue.target.includes("prop-missing") && issue.severity === "blocking"));
const linearMediaIssues = validateLinearMediaProvenance([linearQaEpisode]);
assert.ok(linearMediaIssues.some((issue) => issue.target.endsWith(".imageUrl") && issue.issueType === "media_provenance"));
const assetDetailAgentReports = createAssetDetailQAReports(storyboardAssetReferenceProject as any, assetBoardPlan);
assert.ok(assetDetailAgentReports.some((report) => report.checkerId === "linear.asset.character_detailer.qa"));
assert.ok(assetDetailAgentReports.some((report) => report.checkerId === "linear.asset.location_detailer.qa"));
assert.ok(assetDetailAgentReports.some((report) => report.checkerId === "linear.asset.prop_detailer.qa"));
assert.ok(assetDetailAgentReports.some((report) => report.checkerId === "qa.linear.asset_board_plan" && !report.blocking));
const scriptAgentReports = createScriptAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any, { stageType: "script" } as any);
assert.ok(scriptAgentReports.some((report) => report.checkerId === "linear.script.writer.qa"));
assert.ok(scriptAgentReports.some((report) => report.checkerId === "linear.breakdown.extractor.qa" && report.blocking));
const performanceBeatDrafts = buildProductionPerformanceBeatDrafts(storyboardAssetReferenceProject as any, [linearQaEpisode]);
assert.ok(performanceBeatDrafts.performanceBeats.length > 0);
assert.ok(performanceBeatDrafts.performanceBeats.every((beat) => beat.scriptBlockIds.length > 0));
assert.ok(performanceBeatDrafts.performanceBeats.every((beat) => beat.startState && beat.endState && beat.durationSeconds > 0));
assert.equal(performanceBeatDrafts.issues.some((issue) => issue.severity === "blocking"), false);
const scriptAgentReportsWithBeats = createScriptAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any, { stageType: "script" } as any, [], []);
assert.ok(scriptAgentReportsWithBeats.some((report) => report.checkerId === "qa.linear.performance_beats"));
const linearSceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(storyboardAssetReferenceProject as any, [linearQaEpisode]);
assert.ok(linearSceneVisualPackDrafts.sceneVisualPacks.length > 0);
assert.equal(linearSceneVisualPackDrafts.issues.some((issue) => issue.severity === "blocking"), false);
const storyboardBoardDrafts = buildProductionStoryboardBoardDrafts(storyboardAssetReferenceProject as any, [linearQaEpisode]);
assert.ok(storyboardBoardDrafts.storyboardBoards.length > 0);
assert.ok(storyboardBoardDrafts.performanceBeats.length > 0);
assert.ok(storyboardBoardDrafts.storyboardBoards.every((board) => board.strategyDecision.arrowLegendIds.includes("subject_action_red")));
assert.ok(storyboardBoardDrafts.storyboardBoards.every((board) => board.panels.every((panel) => panel.visualBeat.includes("动作进度"))));
assert.ok(storyboardBoardDrafts.storyboardBoards.every((board) => board.panels.every((panel) => !/当前可见事件：可见角色[:：]/u.test(panel.visualBeat))));
assert.ok(storyboardBoardDrafts.storyboardBoards.every((board) => new Set(board.panels.map((panel) => panel.visualBeat)).size === board.panels.length));
assert.equal(
  storyboardBoardDrafts.issues.some((issue) => issue.severity === "blocking"),
  false,
  JSON.stringify(storyboardBoardDrafts.issues.filter((issue) => issue.severity === "blocking"), null, 2),
);
const storyboardAgentReports = createStoryboardAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any);
assert.ok(storyboardAgentReports.some((report) => report.checkerId === "linear.storyboard.shot_planner.qa"));
assert.ok(storyboardAgentReports.some((report) => report.checkerId === "linear.storyboard.continuity_planner.qa"));
const storyboardAgentReportsWithBoards = createStoryboardAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any, [], []);
assert.ok(storyboardAgentReportsWithBoards.some((report) => report.checkerId === "qa.linear.storyboard_board"));
const assetReferencePackDrafts = buildProductionAssetReferencePackDrafts(storyboardAssetReferenceProject as any, [linearQaEpisode]);
assert.ok(assetReferencePackDrafts.assetReferencePacks.length > 0);
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.modelProfileId));
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.sceneVisualPackId));
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.modelInputFingerprint));
assert.equal(assetReferencePackDrafts.issues.some((issue) => issue.severity === "blocking"), false);
const videoGenerationUnitDrafts = buildProductionVideoGenerationUnitDrafts(storyboardAssetReferenceProject as any, [linearQaEpisode]);
assert.ok(videoGenerationUnitDrafts.videoGenerationUnits.length > 0);
assert.ok(videoGenerationUnitDrafts.videoGenerationUnits.every((unit) => unit.storyboardBoardId && unit.assetReferencePackId));
assert.ok(
  videoGenerationUnitDrafts.assetReferencePacks.every((pack) => (pack.storyboardStrategyIds || []).length > 0),
  JSON.stringify(videoGenerationUnitDrafts.assetReferencePacks.map((pack) => ({ id: pack.id, sceneId: pack.sceneId, strategyIds: pack.storyboardStrategyIds })), null, 2),
);
assert.ok(videoGenerationUnitDrafts.videoGenerationUnits.every((unit) =>
  videoGenerationUnitDrafts.assetReferencePacks.some((pack) =>
    pack.id === unit.assetReferencePackId &&
    (pack.storyboardStrategyIds || []).includes(unit.storyboardStrategyId || ""),
  ),
), JSON.stringify(videoGenerationUnitDrafts.videoGenerationUnits.map((unit) => ({
  id: unit.id,
  packId: unit.assetReferencePackId,
  strategyId: unit.storyboardStrategyId,
})), null, 2));
assert.equal(videoGenerationUnitDrafts.issues.some((issue) => issue.severity === "blocking"), false);
const promptAgentReports = createPromptAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any);
assert.ok(promptAgentReports.some((report) => report.checkerId === "linear.prompt.image_compiler.qa"));
assert.ok(promptAgentReports.some((report) => report.checkerId === "linear.prompt.video_compiler.qa"));
assert.ok(promptAgentReports.some((report) => report.checkerId === "qa.linear.media_provenance"));
const promptAgentReportsWithPacks = createPromptAgentQAReports([linearQaEpisode], storyboardAssetReferenceProject as any, [], []);
assert.ok(promptAgentReportsWithPacks.some((report) => report.checkerId === "qa.linear.asset_reference_pack"));
reportSelfCheckProgress("checked production agent QA reports");
const assetReferenceAuditProject = {
  title: "Asset Reference Audit",
  type: "movie",
  characters: [{
    id: "char-valid",
    name: "Lead",
  }],
  assets: [
    { id: "char-char-valid", type: "character", name: "Lead", description: "Mirror character asset" },
    { id: "loc-valid", type: "location", name: "Warehouse", description: "A warehouse", prompt: "wide industrial warehouse with sodium vapor lights" },
    { id: "prop-valid", type: "prop", name: "Canister", description: "A canister", prompt: "brushed metal canister with red warning stripe" },
  ],
  episodes: [{
    id: "ep-audit",
    scenes: [{
      id: "scene-audit",
      breakdown: {
        characters: ["Lead"],
        characterIds: ["char-char-valid", "Lead"],
        location: "Warehouse",
        locationId: "prop-valid",
        props: ["Canister"],
        propIds: ["Canister", "prop-missing"],
      },
      scriptBlocks: [{
        id: "block-audit",
        type: "action",
        content: "Lead grabs the canister.",
        linkedAssetId: "char-char-valid",
        locationId: "Warehouse",
        propIds: ["loc-valid"],
      }],
      shots: [{
        id: "shot-audit",
        characterIdsInShot: ["char-missing"],
        locationId: "loc-valid",
        propIds: ["prop-valid"],
        assetOverrides: { Canister: "override-url" },
      }],
    }],
    gameData: {
      nodes: [{
        id: "node-audit",
        breakdown: { characterIds: ["char-char-valid"], props: [], characters: [], location: "Warehouse" },
        shots: [{ id: "node-shot-audit", characterIdsInShot: ["char-char-valid"], locationId: "Warehouse" }],
      }],
    },
  }],
};
const assetReferenceAudit = collectAssetReferenceAudit(assetReferenceAuditProject as any);
assert.ok(assetReferenceAudit.some((item) => item.rawValue === "char-char-valid" && item.status === "noncanonical" && item.canonicalId === "char-valid"));
assert.ok(assetReferenceAudit.some((item) => item.rawValue === "Lead" && item.status === "legacy_name" && item.canonicalId === "char-valid"));
assert.ok(assetReferenceAudit.some((item) => item.rawValue === "prop-missing" && item.status === "missing"));
assert.ok(assetReferenceAudit.some((item) => item.path.endsWith(".breakdown.locationId") && item.rawValue === "prop-valid" && item.status === "wrong_type"));
const assetReferenceRepairPlan = buildAssetReferenceRepairPlan(assetReferenceAuditProject as any);
assert.ok(assetReferenceRepairPlan.some((item) => item.action === "replace_with_canonical_id" && item.rawValue === "Lead" && item.replacementValue === "char-valid"));
assert.ok(assetReferenceRepairPlan.some((item) => item.action === "needs_author_decision" && item.rawValue === "prop-missing"));
const assetReferenceRuleIssues = validateAssetRules(assetReferenceAuditProject as any);
assert.ok(assetReferenceRuleIssues.some((item) => item.target === "assets.references.audit" && item.severity === "blocking"));
assert.ok(assetReferenceRuleIssues.some((item) => item.target === "assets.references.canonicalIds" && item.severity === "warning"));
reportSelfCheckProgress("checked production asset-reference audit");
const weakShotGroupIssues = validateStoryboardRules([
  {
    id: "ep-weak-shot-group",
    title: "Weak Shot Group",
    scenes: [{
      id: "scene-weak-shot-group",
      title: "Weak Shot Group Scene",
      shots: ["a", "b", "c"].map((suffix) => ({
        id: `shot-weak-${suffix}`,
        shotSize: "CU",
        cameraAngle: "EYE",
        cameraMovement: "STATIC",
        focalLength: "50mm",
        lighting: "soft practical light",
        composition: "centered face close-up",
        blocking: "lead stays seated",
        continuityNote: "maintain eyeline",
        visualAction: "Lead looks at the table.",
        motivation: "show tension",
        duration: 3,
      })),
    }],
  },
] as any);
assert.ok(weakShotGroupIssues.some((issue) => issue.target === "scene.scene-weak-shot-group.continuity.axis"));
assert.ok(weakShotGroupIssues.some((issue) => issue.target === "scene.scene-weak-shot-group.continuity.matchOnAction"));
assert.ok(weakShotGroupIssues.some((issue) => issue.target === "scene.scene-weak-shot-group.shotGroup.sizeVariety"));
assert.ok(weakShotGroupIssues.some((issue) => issue.target === "scene.scene-weak-shot-group.shotGroup.informationProgression"));
const strongContinuityIssues = validateStoryboardRules([
  {
    id: "ep-strong-continuity",
    title: "Strong Continuity",
    scenes: [{
      id: "scene-strong-continuity",
      title: "Strong Continuity Scene",
      shots: [
        {
          id: "shot-strong-1",
          shotSize: "WS",
          cameraAngle: "EYE",
          cameraMovement: "STATIC",
          focalLength: "35mm",
          lighting: "motivated practical key light",
          composition: "lead screen left, partner screen right, doorway background",
          blocking: "lead reaches for the canister while partner holds position",
          continuityNote: "180 度轴线沿门口到桌面的行动线固定；视线匹配为 lead 看向 partner 后切到 partner 回看；动作顺接从伸手拿罐延续到下一镜交接；空间方位连续性保持 lead screen left、partner screen right。",
          visualAction: "Lead reaches toward the canister on the table.",
          motivation: "establish geography and prop ownership",
          duration: 4,
        },
        {
          id: "shot-strong-2",
          shotSize: "MS",
          cameraAngle: "LOW",
          cameraMovement: "PUSH",
          focalLength: "50mm",
          lighting: "same practical key light, harder edge",
          composition: "canister foreground, lead left hand enters from left",
          blocking: "lead hand carries the canister across frame toward partner",
          continuityNote: "180 度轴线继续沿桌面行动线；视线匹配承接 partner 看向罐体；动作顺接接上上一镜伸手并完成递送；空间方位连续性保持罐体从 left foreground 移向 right midground。",
          visualAction: "The canister crosses the foreground from lead to partner.",
          motivation: "show the handoff as proof",
          duration: 4,
        },
        {
          id: "shot-strong-3",
          shotSize: "CU",
          cameraAngle: "EYE",
          cameraMovement: "STATIC",
          focalLength: "85mm",
          lighting: "practical key catches partner's eyes",
          composition: "partner face right third, canister edge foreground",
          blocking: "partner grips the canister and looks back toward lead",
          continuityNote: "180 度轴线仍不越过桌面行动线；视线匹配为 partner 回看 lead 的眼神方向；动作顺接从接过罐体延续到握紧；空间方位连续性保持 partner screen right、canister foreground right。",
          visualAction: "Partner tightens fingers around the canister and looks back.",
          motivation: "pay off the handoff with reaction",
          duration: 3,
        },
      ],
    }],
  },
] as any);
assert.equal(strongContinuityIssues.some((issue) => issue.target.startsWith("scene.scene-strong-continuity.continuity.")), false);
const physicalPromptIssues = validatePromptRules([
  {
    id: "ep-physical-prompt",
    title: "Physical Prompt",
    inspiration: "",
    scenes: [
      {
        id: "scene-physical-prompt",
        title: "Physical Prompt Scene",
        shots: [{
          id: "shot-physical",
          shotSize: "CU",
          cameraAngle: "LOW",
          cameraMovement: "PAN",
          focalLength: "50mm",
          lighting: "motivated practical key light",
          composition: "foreground prop frames the face",
          blocking: "lead stays screen left",
          continuityNote: "maintain eyeline",
          imagePrompt: "A dramatic emotional moment in a room",
          videoPrompt: "The mood slowly becomes tense",
        }],
      },
    ],
  },
] as any);
assert.ok(physicalPromptIssues.some((issue) => issue.target === "shot.shot-physical.prompt.physicalParameters"));
reportSelfCheckProgress("checked production continuity and prompt QA");
[
  "production.concept",
  "production.bible",
  "production.assetDetail",
  "generateEpisodes",
  "production.scene",
  "production.script",
  "production.storyboard",
  "production.prompt",
  "production.interactiveBible",
  "production.gameBlueprint",
  "production.graphGeneration",
  "production.interactiveScript",
  "production.interactiveStoryboard",
].forEach((templateId) => {
  const metadata = productionTemplateMetadataRegistry[templateId];
  assert.ok(metadata, `${templateId} should declare production template metadata`);
  assert.deepEqual(validateProductionTemplateMetadata(metadata), []);
});
reportSelfCheckProgress("checked production template metadata");

let run = createProductionRun(project);
reportSelfCheckProgress("created production run sample");
assert.equal(run.status, "draft");
assert.equal(run.policy.reviewMode, "lean");
assert.deepEqual(run.policy.modelFallbackOrder, ["scriptGen", "qcAnalyzer", "storyboardGen"]);
assert.equal(run.metrics.modelCallCount, 0);
assert.equal(run.stages[0].stageType, "intake");
assert.equal(run.stages[0].schemaVersion, "production-stage-v1");
assert.equal(run.checkpoints.length, 1);

run = runContractQAForCurrentStage(run);
assert.equal(run.stages[0].qaReports.length, 1);
assert.equal(run.stages[0].qaReports[0].blocking, false);
assert.ok(run.stages[0].gateVerdicts?.some((verdict) => verdict.gateId === "CONTRACT"));
assert.ok(getGatesForStage("graph_generation", "fast").some((gate) => gate.id === "GRAPH"));
assert.ok(getGatesForStage("concept", "lean").some((gate) => gate.id === "CREATIVE_QUALITY"));
assert.ok(getGatesForStage("concept", "lean").some((gate) => gate.id === "TRANSPARENCY"));
assert.ok(getGatesForStage("concept", "lean").some((gate) => gate.id === "FORMAT_STANDARDS"));
assert.equal(run.formatProfile?.defaultSkeletonId, "skel-movie-3act");
assert.equal(validateProductionAgentRubrics().length, 0);
const contractGate = run.stages[0].gateVerdicts?.find((verdict) => verdict.gateId === "CONTRACT");
assert.equal(contractGate?.score, 100);
assert.deepEqual(contractGate?.issues, []);

const skippedCritical = skipCurrentStage(run);
assert.equal(skippedCritical.status, "failed");
assert.equal(skippedCritical.stages[0].failureType, "user");

run = requestRevisionForCurrentStage(run, "把核心冲突写得更具体。");
assert.equal(run.stages[0].status, "retrying");
assert.equal(run.stages[0].revisionInstructions, "把核心冲突写得更具体。");

run = retryCurrentStageWithDifferentModel(run);
assert.equal(run.stages[0].status, "retrying");
assert.equal(run.stages[0].modelUsed, "scriptGen");
run = {
  ...run,
  stages: run.stages.map((stage, index) =>
    index === 0
      ? {
          ...stage,
          runtimeControlOverrides: {
            creativeTemperature: 0.31,
            shotDensity: "high",
          },
        }
      : stage,
  ),
};

run = applyStageExecutionResult(run, {
  summary: "Intake completed.",
  artifacts: [
    {
      artifactType: "concept",
      targetPath: "project.originalInspiration",
      entityIds: [project.id],
      version: 1,
      summary: "Input archived.",
    },
  ],
  qaReports: [
    {
      checkerId: "self.check",
      status: "passed",
      score: 100,
      issues: [],
      blocking: false,
    },
  ],
  promptUsed: "prompt".repeat(5000),
  rawOutput: "raw".repeat(5000),
  modelUsed: "scriptGen",
  outputSnapshot: { ok: true },
});
assert.equal(run.stages[0].status, "completed");
assert.equal(run.artifacts.length, 1);
assert.equal(run.artifacts[0].version, 1);
assert.equal(run.stages[0].promptUsed, "prompt".repeat(5000));
assert.equal(run.stages[0].modelUsed, "scriptGen");
assert.equal(run.metrics.modelCallCount, 1);
assert.equal(run.metrics.stageRetryCount.intake, 2);
assert.equal(run.checkpoints.filter((checkpoint) => checkpoint.kind === "output").length, 1);
assert.equal(run.stages[0].productionManifest?.provider.providerLabel, "unresolved");
assert.equal(run.stages[0].productionManifest?.provider.modelLabel, undefined);
assert.equal(run.stages[0].productionManifest?.provider.modelId, undefined);
assert.equal(run.stages[0].productionManifest?.provider.channelName, undefined);
assert.equal(run.stages[0].productionManifest?.provider.resolutionStatus, "missing-route");
assert.equal(run.stages[0].productionManifest?.provider.apiKeySource, "missing");
assert.ok(run.stages[0].productionManifest?.provider.disclosure.includes("设置页补齐任务路由"));
assert.ok(run.stages[0].productionManifest?.outputContract.metadataWarnings);
assert.equal(run.stages[0].productionManifest?.parameters.formatProfile?.defaultBeatId, "beat-story-circle");
assert.ok(run.stages[0].productionManifest?.parameters.modelFallbackOrder.includes("scriptGen"));
assert.equal(run.stages[0].productionManifest?.parameters.runtimeControls.creativeTemperature, 0.31);
assert.equal(run.stages[0].productionManifest?.parameters.runtimeControls.shotDensity, "high");
assert.equal(run.policy.runtimeControls.creativeTemperature, 0.72);
assert.equal(run.stages[0].productionManifest?.parameters.runtimeControlSource, "stage_override");
assert.equal(run.stages[0].productionManifest?.parameters.runtimeControlOverrides.creativeTemperature, 0.31);
assert.equal(run.stages[0].productionManifest?.parameters.pilotPlan.enabled, true);
assert.equal(run.stages[0].productionManifest?.parameters.pilotPlan.firstBatchLimit, 3);
assert.equal(run.stages[0].productionManifest?.parameters.pilotPlan.batchPolicy, "pilot_then_expand");
assert.ok(run.stages[0].productionManifest?.parameters.pilotPlan.scope.includes("试制批次"));
assert.equal(run.stages[0].productionManifest?.prompt.preview.available, true);
assert.equal(run.stages[0].productionManifest?.prompt.preview.reviewStatus, "auto_recorded");
assert.ok(run.stages[0].productionManifest?.prompt.preview.text.includes("prompt"));
assert.ok(run.stages[0].productionManifest?.explainability.summary.includes(run.stages[0].title));
assert.ok((run.stages[0].productionManifest?.diff[0]?.structuredChanges || []).some((change) => change.path.includes("output.ok")));
assert.ok(run.stages[0].gateVerdicts?.some((verdict) => verdict.gateId === "TRANSPARENCY" && verdict.status === "warning"));

run = approveCurrentStage(run);
assert.equal(run.status, "running");

run = {
  ...run,
  currentStageId: run.stages[1].id,
};
run = applyStageExecutionResult(run, {
  summary: "Concept revised.",
  artifacts: [
    {
      artifactType: "concept",
      targetPath: "project.originalInspiration",
      entityIds: [project.id],
      version: 1,
      summary: "Concept revision.",
    },
  ],
  qaReports: [
    {
      checkerId: "self.check",
      status: "passed",
      score: 100,
      issues: [],
      blocking: false,
    },
  ],
  outputSnapshot: { ok: true },
});
assert.equal(run.artifacts.filter((artifact) => artifact.artifactType === "concept").at(-1)?.version, 2);
assert.ok(run.artifacts.filter((artifact) => artifact.artifactType === "concept").at(-1)?.previousArtifactId);
assert.ok(run.artifacts.filter((artifact) => artifact.artifactType === "concept").at(-1)?.changeSummary);
assert.ok(run.stages[1].productionManifest?.diff[0]?.fieldLevelSummary.includes("project.originalInspiration"));
assert.equal(run.stages[1].productionManifest?.diff[0]?.artifactType, "concept");
assert.ok((run.stages[1].productionManifest?.diff[0]?.structuredChanges || []).length > 0);
assert.equal(run.stages[1].productionManifest?.diff[0]?.entityChangeSummary?.added, 0);
assert.equal(run.stages[1].productionManifest?.diff[0]?.previousVersion, 1);

  const preservedDownstreamStage = {
    status: run.stages[1].status,
    outputArtifactIds: [...run.stages[1].outputArtifactIds],
  };
run = rerunFromStage(run, run.stages[0].id, "用户目标改为更悬疑。");
  assert.equal(run.currentStageId, run.stages[0].id);
  assert.equal(run.stages[0].revisionInstructions, "用户目标改为更悬疑。");
  assert.equal(run.stages[1].status, preservedDownstreamStage.status, "rerunning an upstream stage must not reset a completed downstream stage");
  assert.deepEqual(run.stages[1].outputArtifactIds, preservedDownstreamStage.outputArtifactIds, "rerunning an upstream stage must preserve downstream outputs");
  assert.equal(run.stages[1].stale, true, "the preserved downstream result should carry only an advisory source-change marker");
reportSelfCheckProgress("checked production run orchestration");

reportSelfCheckProgress("checking interactive production");
const fakeChoiceGraph: GameProjectData = {
  currentStep: 4,
  variables: [],
  nodes: [
    {
      id: "start",
      title: "Start",
      scriptContent: "Start",
      onEnterActions: [],
      isEnding: false,
      uiLayout: "standard",
      position: { x: 0, y: 0 },
    },
    {
      id: "same",
      title: "Same",
      scriptContent: "Same",
      onEnterActions: [],
      isEnding: false,
      uiLayout: "standard",
      position: { x: 200, y: 0 },
    },
  ],
  edges: [
    { id: "edge-a", sourceNodeId: "start", targetNodeId: "same", source: "start", target: "same", displayText: "继续" },
    { id: "edge-b", sourceNodeId: "start", targetNodeId: "same", source: "start", target: "same", displayText: "还是继续" },
  ],
};
const fakeChoiceIssues = validateGameDataRules(fakeChoiceGraph);
assert.ok(fakeChoiceIssues.some((issue) => issue.target === "node.start.choices.fake"));
assert.ok(fakeChoiceIssues.some((issue) => issue.target === "node.start.choices.impact"));
const projectionGraph: GameProjectData = {
  currentStep: 4,
  variables: [],
  nodes: [
    {
      id: "start",
      title: "Start",
      scriptContent: "Start",
      detailedScript: "玩家在门口停顿。",
      scriptBlocks: [{ id: "block-1", type: "action", content: "玩家停顿并等待选择。" }],
      shots: [{ id: "shot-start", imageUrl: "/img/start.png", videoUrl: "/video/start.mp4", imagePrompt: "door", videoPrompt: "door hold" }],
      onEnterActions: [],
      isEnding: false,
      uiLayout: "standard",
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};
const projectionSync = applyInteractiveProjectionSync(projectionGraph, []);
assert.equal(projectionSync.scenes.length, 1);
assert.equal(projectionSync.scenes[0].sourceNodeId, "start");
assert.equal(projectionSync.scenes[0].scriptBlocks?.length, 1);
assert.equal(projectionSync.scenes[0].shots?.[0]?.imageUrl, "/img/start.png");
const interactiveReadModel = resolveSceneReadModel({ projectModel: "interactive" }, {
  id: "ep-read-model",
  title: "Read Model",
  inspiration: "",
  gameData: projectionGraph,
  scenes: [],
} as any);
assert.equal(interactiveReadModel.source, "interactive.gameData_projection");
assert.equal(interactiveReadModel.writeTarget, "episode.gameData.nodes");
assert.equal(interactiveReadModel.scenes[0].sourceNodeId, "start");
assert.equal(resolveSceneReadModel({ projectModel: "linear" }, {
  id: "ep-linear-read-model",
  title: "Linear Read Model",
  inspiration: "",
  scenes: [{ id: "scene-linear", title: "Linear Scene", description: "" }],
} as any).source, "episode.scenes");
assert.equal(validateInteractiveProjectionRules([{ id: "ep-projection", title: "Projection", inspiration: "", gameData: projectionGraph, scenes: projectionSync.scenes } as any]).length, 0);
const projectionIssues = validateInteractiveProjectionRules([{ id: "ep-projection-broken", title: "Projection Broken", inspiration: "", gameData: projectionGraph, scenes: [] } as any]);
assert.ok(projectionIssues.some((issue) => issue.target === "episode.ep-projection-broken.interactiveProjection.count"));
assert.ok(projectionIssues.some((issue) => issue.target === "node.start.interactiveProjection.missingScene"));
const interactiveProject: ProductionRunProjectInput = {
  id: "interactive-self-check",
  title: "Interactive Self Check",
  projectModel: "interactive",
  type: "movie",
  originalInspiration: "一个互动影游项目从节点白板开始制作。",
  refinedInspiration: "",
  interactiveTemplate: "FMV mystery",
  interactiveConfig: {
    scale: "light",
    targetNodeCount: 4,
    targetEndingCount: 1,
    playDurationMin: 5,
    explorationDurationMin: 8,
  },
  universalSkillRefs: [],
};
const interactiveRun = createProductionRun(interactiveProject);
assert.equal(interactiveRun.mode, "interactive");
assert.deepEqual(
  interactiveRun.stages.map((stage) => stage.stageType),
  [
    "intake",
    "interactive_bible",
    "context_planning",
    "game_blueprint",
    "graph_generation",
    "interactive_graph_qa",
    "node_to_scene",
    "interactive_script",
    "content_lock",
    "production_breakdown",
    "production_asset_detail",
    "interactive_storyboard",
    "playtest_simulation",
    "expensive_generation_planning",
  ],
);

const legacyUrlOnlyMedia = createLegacyMediaReference("image", "https://example.invalid/fake-url.png");
const staleGeneratedMedia = createMediaAssetReference({
  url: "https://example.invalid/stale.png",
  kind: "image",
  source: "ai_generation",
  status: "stale",
  generationJobId: "generation-stale",
});
const failedGeneratedMedia = createMediaAssetReference({
  url: "https://example.invalid/failed.png",
  kind: "image",
  source: "ai_generation",
  status: "failed",
  generationJobId: "generation-failed",
});
const forgedManualReadyMedia = createMediaAssetReference({
  url: "https://example.invalid/manual-forged.png",
  kind: "image",
  source: "manual",
  status: "ready",
});
const forgedGeneratedReadyMedia = createMediaAssetReference({
  url: "https://example.invalid/generated-forged.png",
  kind: "image",
  source: "ai_generation",
  status: "ready",
});
const uploadedReadyMedia = createMediaAssetReference({
  url: "https://example.invalid/uploaded.png",
  kind: "image",
  source: "upload",
  status: "ready",
});
const generatedReadyMedia = createAIGeneratedMediaReference(
  "image",
  "https://example.invalid/generated.png",
  "self-check-image-model",
);
assert.equal(isTrustedReadyMediaReference(legacyUrlOnlyMedia, "image"), false);
assert.equal(isTrustedReadyMediaReference(staleGeneratedMedia, "image"), false);
assert.equal(isTrustedReadyMediaReference(failedGeneratedMedia, "image"), false);
assert.equal(isTrustedReadyMediaReference(forgedManualReadyMedia, "image"), false);
assert.equal(isTrustedReadyMediaReference(forgedGeneratedReadyMedia, "image"), false);
assert.equal(isTrustedReadyMediaReference(uploadedReadyMedia, "image"), true);
assert.equal(isTrustedReadyMediaReference(generatedReadyMedia, "image"), true);

const createReadyUploadedMedia = (kind: "image" | "video", url: string) =>
  createMediaAssetReference({
    url,
    kind,
    source: "upload",
    status: "ready",
  });

const createReadyInteractiveShot = (id: string) => {
  const imageUrl = `https://example.invalid/${id}.png`;
  const videoUrl = `https://example.invalid/${id}.mp4`;
  return {
    id: `shot-${id}`,
    visualAction: `${id} physical action`,
    motivation: "interactive hold",
    imagePrompt: `${id} cinematic still frame`,
    videoPrompt: `${id} interactive hold loop`,
    imageUrl,
    videoUrl,
    imageMedia: createReadyUploadedMedia("image", imageUrl),
    videoMedia: createReadyUploadedMedia("video", videoUrl),
  };
};

const createReadyNode = (
  id: string,
  title: string,
  overrides: Partial<GameNode> = {},
): GameNode => ({
  id,
  title,
  scriptContent: `${title} script`,
  detailedScript: `${title} detailed script`,
  scriptBlocks: [{ id: `block-${id}`, type: "action", content: `${title} action` }],
  breakdown: { setting: "INT.", location: "Room", time: "NIGHT", characters: [], props: [] },
  shots: [createReadyInteractiveShot(id)],
  onEnterActions: [],
  isEnding: false,
  uiLayout: "standard",
  position: { x: 0, y: 0 },
  ...overrides,
});

const playableGraph: GameProjectData = {
  currentStep: 4,
  variables: [{ id: "var-trust", name: "trust", type: "number", defaultValue: 0 }],
  nodes: [
    {
      id: "start",
      title: "Start",
      scriptContent: "Start",
      detailedScript: "Start script",
      scriptBlocks: [{ id: "block-start", type: "action", content: "Start" }],
      breakdown: { setting: "INT.", location: "Room", time: "NIGHT", characters: [], props: [] },
      shots: [
        {
          id: "shot-start",
          visualAction: "Start action",
          motivation: "interactive hold",
          imagePrompt: "start",
          videoPrompt: "interactive hold",
          imageUrl: "https://example.invalid/start.png",
          videoUrl: "https://example.invalid/start.mp4",
          imageMedia: createReadyUploadedMedia("image", "https://example.invalid/start.png"),
          videoMedia: createReadyUploadedMedia("video", "https://example.invalid/start.mp4"),
        },
      ],
      onEnterActions: [],
      isEnding: false,
      uiLayout: "standard",
      position: { x: 0, y: 0 },
    },
    {
      id: "ending",
      title: "End",
      scriptContent: "End",
      detailedScript: "End script",
      scriptBlocks: [{ id: "block-end", type: "action", content: "End" }],
      breakdown: { setting: "INT.", location: "Room", time: "NIGHT", characters: [], props: [] },
      shots: [
        {
          id: "shot-end",
          visualAction: "End action",
          motivation: "interactive hold",
          imagePrompt: "end",
          videoPrompt: "interactive hold",
          imageUrl: "https://example.invalid/end.png",
          videoUrl: "https://example.invalid/end.mp4",
          imageMedia: createReadyUploadedMedia("image", "https://example.invalid/end.png"),
          videoMedia: createReadyUploadedMedia("video", "https://example.invalid/end.mp4"),
        },
      ],
      onEnterActions: [],
      isEnding: true,
      uiLayout: "standard",
      position: { x: 200, y: 0 },
    },
  ],
  edges: [
    {
      id: "edge-end",
      sourceNodeId: "start",
      targetNodeId: "ending",
      source: "start",
      target: "ending",
      displayText: "Continue",
    },
  ],
};
const playableReport = createInteractiveAssemblyQAReport(playableGraph, 1);
assert.equal(playableReport.blockingCount, 0);
assert.equal(playableReport.playablePathCount, 1);
assert.deepEqual(playableReport.coveredEndingIds, ["ending"]);
const urlOnlyGraph: GameProjectData = {
  ...playableGraph,
  nodes: playableGraph.nodes.map((node) => ({
    ...node,
    shots: (node.shots || []).map((shot) => ({
      ...shot,
      imageMedia: undefined,
      videoMedia: undefined,
    })),
  })),
};
const urlOnlyReport = createInteractiveAssemblyQAReport(urlOnlyGraph, 1);
assert.equal(urlOnlyReport.playablePathCount, 0);
assert.equal(urlOnlyReport.readyNodeCount, 0);
assert.ok(urlOnlyReport.issues.some((issue) => issue.id === "playback.paths.none-ready"));

const stateBlockedGraph: GameProjectData = {
  ...playableGraph,
  edges: [
    {
      ...playableGraph.edges[0],
      conditionExpression: "trust > 0",
    },
  ],
};
const stateBlockedReport = createInteractiveAssemblyQAReport(stateBlockedGraph, 1);
assert.equal(stateBlockedReport.playablePathCount, 0);
assert.ok(stateBlockedReport.issues.some((issue) => issue.id === "node.stateDeadEnd.start"));
assert.ok(stateBlockedReport.issues.some((issue) => issue.id === "edge.condition.never.edge-end"));

const stateMachineGraph: GameProjectData = {
  currentStep: 4,
  variables: [
    { id: "var-trust", name: "trust", type: "number", defaultValue: 0 },
    { id: "var-has-key", name: "hasKey", type: "boolean", defaultValue: false },
    { id: "var-alarm", name: "alarm", type: "boolean", defaultValue: false },
  ],
  nodes: [
    createReadyNode("start", "Decision Start", { position: { x: 0, y: 0 } }),
    createReadyNode("gain-trust", "Gain Trust", {
      onEnterActions: [
        { targetVariableId: "trust", operation: "add", value: 1 },
        { targetVariableId: "hasKey", operation: "set", value: true },
      ],
      position: { x: 180, y: -80 },
    }),
    createReadyNode("lose-trust", "Lose Trust", {
      onEnterActions: [
        { targetVariableId: "trust", operation: "subtract", value: 1 },
        { targetVariableId: "alarm", operation: "set", value: true },
      ],
      position: { x: 180, y: 80 },
    }),
    createReadyNode("branch", "Mutually Exclusive Branch", { position: { x: 360, y: 0 } }),
    createReadyNode("ending-success", "Trust Ending", { isEnding: true, position: { x: 540, y: -80 } }),
    createReadyNode("ending-default", "Timeout Ending", { isEnding: true, position: { x: 540, y: 80 } }),
  ],
  edges: [
    {
      id: "edge-start-gain",
      sourceNodeId: "start",
      targetNodeId: "gain-trust",
      source: "start",
      target: "gain-trust",
      displayText: "Choose trust",
    },
    {
      id: "edge-start-lose",
      sourceNodeId: "start",
      targetNodeId: "lose-trust",
      source: "start",
      target: "lose-trust",
      displayText: "Wait too long [超时默认]",
    },
    {
      id: "edge-gain-branch",
      sourceNodeId: "gain-trust",
      targetNodeId: "branch",
      source: "gain-trust",
      target: "branch",
      displayText: "Continue",
    },
    {
      id: "edge-lose-branch",
      sourceNodeId: "lose-trust",
      targetNodeId: "branch",
      source: "lose-trust",
      target: "branch",
      displayText: "Continue",
    },
    {
      id: "edge-branch-success",
      sourceNodeId: "branch",
      targetNodeId: "ending-success",
      source: "branch",
      target: "ending-success",
      displayText: "Use key",
      conditionExpression: "trust > 0 && hasKey === true && alarm === false",
    },
    {
      id: "edge-branch-default",
      sourceNodeId: "branch",
      targetNodeId: "ending-default",
      source: "branch",
      target: "ending-default",
      displayText: "Fallback exit [超时默认]",
      conditionExpression: "trust <= 0 && hasKey === false && alarm === true",
    },
  ],
};
const stateMachineReport = createInteractiveAssemblyQAReport(stateMachineGraph, 2);
assert.equal(stateMachineReport.playablePathCount, 2);
assert.deepEqual([...stateMachineReport.coveredEndingIds].sort(), ["ending-default", "ending-success"]);
assert.equal(stateMachineReport.conditionBlockedEdgeCount, 2);
assert.equal(stateMachineReport.stateDeadEndCount, 0);
assert.equal(stateMachineReport.issues.some((issue) => issue.id.startsWith("node.timeout.")), false);
assert.equal(stateMachineReport.issues.some((issue) => issue.id.startsWith("edge.condition.never.")), false);
for (const retiredStageType of [
  "interactive_bible",
  "game_blueprint",
  "graph_generation",
  "interactive_graph_qa",
  "node_to_scene",
  "interactive_script",
  "interactive_storyboard",
  "playtest_simulation",
] as const) {
  const retiredStage = interactiveRun.stages.find((stage) => stage.stageType === retiredStageType);
  assert.ok(retiredStage, `expected historical run to retain ${retiredStageType} for read-only audit`);
  await assert.rejects(
    () => productionStageExecutorRegistry[retiredStageType](interactiveRun, retiredStage),
    /历史互动自动制片阶段.*已停止执行/,
  );
}

const unreachableEndingGraph: GameProjectData = {
  ...stateMachineGraph,
  nodes: [
    ...stateMachineGraph.nodes,
    createReadyNode("ending-secret", "Unreachable Secret Ending", { isEnding: true, position: { x: 720, y: 0 } }),
  ],
};
const unreachableEndingReport = createInteractiveAssemblyQAReport(unreachableEndingGraph, 3);
assert.ok(unreachableEndingReport.issues.some((issue) => issue.id === "node.unreachable.ending-secret"));
assert.ok(unreachableEndingReport.issues.some((issue) => issue.id === "playback.endings.coverage"));

const mediaStage = interactiveRun.stages.find((stage) => stage.stageType === "expensive_generation_planning");
assert.ok(mediaStage);
const mediaGateVerdicts = createGateVerdictsForStage(interactiveRun, mediaStage, {
  result: {
    summary: "Media plan with missing prompts.",
    artifacts: [
      {
        artifactType: "generation_plan",
        targetPath: "run.generationPlan",
        entityIds: [interactiveProject.id],
        version: 1,
        summary: "Media plan",
      },
    ],
    qaReports: [],
    outputSnapshot: {
      imagePromptCount: 1,
      videoPromptCount: 0,
      missingImagePromptShotIds: [],
      missingVideoPromptShotIds: ["shot-missing-video"],
      audioTrackCount: 0,
      generationQueues: {
        image: { count: 1, estimatedMinutes: 2, retryLimit: 1, items: [{ shotId: "shot-image", priority: "high" }] },
        video: { count: 0, estimatedMinutes: 0, retryLimit: 0, items: [] },
        audio: { count: 0, estimatedMinutes: 0, retryLimit: 0, items: [] },
      },
      estimatedDurationMinutes: { image: 2, video: 0, audio: 0, total: 2 },
      retryLimit: { image: 1, video: 0, audio: 0, totalRetries: 1 },
      skippableItems: [],
    },
  },
  qaReports: [],
  stageBlocking: false,
});
const mediaGate = mediaGateVerdicts.find((verdict) => verdict.gateId === "MEDIA");
assert.equal(mediaGate?.status, "failed");
assert.equal(mediaGate?.blocking, true);
assert.ok((mediaGate?.issues || []).some((issue) => issue.target === "outputSnapshot.missingPromptShotIds"));
assert.equal((mediaGate?.issues || []).some((issue) => issue.target === "outputSnapshot.generationQueues"), false);

reportSelfCheckProgress("checking final regression matrix");
const phase11JProductionRegressionMatrix = [
  {
    id: "movie-full-script-lock",
    passed: sampleMovieScriptLock.lockScope === "full_script" &&
      sampleMovieScriptLock.coverageRatio === 1 &&
      formalProductionAssetBoardPlan.productionReadiness === "formal_ready",
  },
  {
    id: "hundred-episode-current-block-lock",
    passed: hundredGovernance.scriptCoverage.targetEpisodeCount === 100 &&
      hundredGovernance.assetPrepReadiness.scope === "current_block_only" &&
      hundredGovernance.assetPrepReadiness.fullSeriesReady === false,
  },
  {
    id: "micro-short-drama-lock-strategy",
    passed: resolveProductionLockStrategy({ type: "micro-short-drama" } as any) === "full_script",
  },
  {
    id: "visual-style-lock-dynamic-injection",
    passed: sampleProductionModeProfile.visualStyleLockStatus === "locked_or_seeded" &&
      capabilityManifest.productionModeSystem.styleLockPolicy.promptCatalogRule.includes("visualStyleLock"),
  },
  {
    id: "interactive-content-lock-graph-aware-prep",
    passed: interactiveProductionBreakdownReport.scope.mode === "interactive" &&
      interactiveProductionBreakdownReport.interactiveCoverage?.missingLockedNodeIds.length === 0 &&
      interactiveFormalAssetBoardPlan.productionReadiness === "formal_ready",
  },
  {
    id: "asset-package-variant-reuse",
    passed: reusableSceneAssetVariantPacks.length === 1 &&
      reusableSceneAssetVariantPacks[0].readiness === "reusable",
  },
  {
    id: "lock-after-change-relock",
    passed: addEpisodeChangeOrder.requiredStageReruns.includes("production_breakdown") &&
      interactiveVariableChangeOrder.requiredStageReruns.includes("interactive_graph_qa") &&
      interactiveVariableChangeOrder.requiredReLocks.includes("content_lock_package"),
  },
  {
    id: "legacy-upgrade-development-briefs",
    passed: legacyProductionDraft.developmentAssetBriefs.length > 0 &&
      legacyProductionDraft.legacyAssetPackageDraft.productionReady === false,
  },
  {
    id: "qa-repair-layering",
    passed: autoRepairTickets[0].repairClassification === "content" &&
      testPromptRepairTickets[0].repairClassification === "prompt" &&
      unsafeCoordinationStageGate.repairTickets.every((ticket) => ticket.repairClassification !== "content"),
  },
];
assert.deepEqual(
  phase11JProductionRegressionMatrix.filter((item) => !item.passed).map((item) => item.id),
  [],
  JSON.stringify(phase11JProductionRegressionMatrix, null, 2),
);

// P1 Backup files check
const srcPagesFiles = fs.readdirSync(new URL("../src/pages", import.meta.url));
const backups = srcPagesFiles.filter((f) => /\.(bak|backup|bak[0-9]+)$/.test(f));
assert.equal(backups.length, 0, `Detected legacy backup files under src/pages: ${backups.join(", ")}`);

console.log("Production self-check passed.");
