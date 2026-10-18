import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildManualShotPlanHash,
  buildLegacyManualStoryboardSourceHash,
  buildLegacySummaryManualStoryboardSourceHash,
  buildManualImagePromptHash,
  buildManualStoryboardReadModel,
  buildManualStoryboardSourceHash,
  buildManualVideoPromptHash,
  buildManualVisualPromptSourceHash,
  canRebaseManualStoryboardAuthorEdit,
  rebaseManualStoryboardAfterAuthorEdit,
  rebaseManualStoryboardAfterShotDeletion,
} from "../src/services/production/manualStoryboard";
import type { ManualFilmTeamReadModel } from "../src/services/production/manualFilmTeamReadModel";
import type { ManualProductionAssetReadModel } from "../src/services/production/manualProductionAssets";
import type { Scene } from "../src/types/project";

const filmTeam = {
  sourceScriptHash: "script-v1",
  departmentPrepPackages: [{
    department: "directing",
    readiness: "ready",
    specialistPayload: { manualOutput: {
      taskSummary: "完成场面调度",
      content: "保持主角在画面左侧，反派位于右侧。",
      handoffNotes: [],
      handoffs: [],
      collaborationSourceVersions: {},
      collaborationHandoffIds: [],
      version: 1,
      status: "confirmed",
      qaVerdict: "pass",
      qaScore: 96,
      openQuestionCount: 0,
      reviewedSceneIds: ["scene-1"],
      promptHash: "department-prompt-v1",
      updatedAt: 1,
      confirmedAt: 1,
    } },
  }],
} as unknown as ManualFilmTeamReadModel;

const assets = {
  readyForShotPlanning: true,
  readyForStoryboardGeneration: true,
  sceneVisualPack: { id: "scene-pack-1" },
  assetBoards: [{
    boardItemId: "board-character-1",
    assetId: "character-1",
    variantId: "variant-rain",
    promptHash: "board-prompt-v1",
    referenceImageUrl: "/character-rain.png",
    approvalState: "confirmed",
    approvalConfirmedAt: 1,
  }],
} as unknown as ManualProductionAssetReadModel;

const shots = [{
  id: "shot-1",
  duration: 5,
  motivation: "建立冲突双方空间关系",
  visualAction: "主角从画面左侧上前一步，反派按住桌面文件。",
  shotSize: "MS",
  cameraAngle: "Eye-Level",
  cameraMovement: "Push-in",
  characterIdsInShot: ["character-1"],
  locationId: "location-1",
  propIds: ["prop-1"],
  imagePrompt: "中景，主角位于画面左侧，反派位于右侧。",
  videoPrompt: "镜头缓慢推进，主角向前一步，反派按住文件。",
}];

const sourceHash = buildManualStoryboardSourceHash(filmTeam, assets);
const legacySourceHash = buildLegacyManualStoryboardSourceHash(filmTeam, assets);
const legacySummarySourceHash = buildLegacySummaryManualStoryboardSourceHash(filmTeam, assets);
const compactFilmTeam = structuredClone(filmTeam);
(compactFilmTeam.departmentPrepPackages[0].specialistPayload!.manualOutput as Record<string, unknown>).content = "";
assert.equal(
  buildManualStoryboardSourceHash(compactFilmTeam, assets),
  sourceHash,
  "compact and full storyboard views must share one semantic source hash",
);
assert.equal(
  buildLegacySummaryManualStoryboardSourceHash(compactFilmTeam, assets),
  legacySummarySourceHash,
  "legacy compact records must remain valid after switching storyboard views",
);
const revisedFilmTeam = structuredClone(filmTeam);
(revisedFilmTeam.departmentPrepPackages[0].specialistPayload!.manualOutput as Record<string, unknown>).version = 2;
assert.notEqual(buildManualStoryboardSourceHash(revisedFilmTeam, assets), sourceHash);
const confirmationOnlyFilmTeam = structuredClone(filmTeam);
confirmationOnlyFilmTeam.departmentPrepPackages[0].readiness = "needs_review";
Object.assign(confirmationOnlyFilmTeam.departmentPrepPackages[0].specialistPayload!.manualOutput as Record<string, unknown>, {
  status: "draft",
  qaVerdict: "revise",
  qaScore: 71,
  openQuestionCount: 2,
  reviewedSceneIds: ["scene-2"],
});
assert.equal(
  buildManualStoryboardSourceHash(confirmationOnlyFilmTeam, assets),
  sourceHash,
  "department confirmation and QA metadata must not invalidate unchanged storyboard semantics",
);
const pendingAssets = {
  ...assets,
  assetBoards: assets.assetBoards.map((board) => ({ ...board, approvalState: "needs_confirmation" as const })),
} as ManualProductionAssetReadModel;
assert.equal(
  buildManualStoryboardSourceHash(filmTeam, pendingAssets),
  sourceHash,
  "confirming an unchanged asset board must not invalidate storyboards in every scene that reuses it",
);
const changedAssetPrompt = {
  ...assets,
  assetBoards: assets.assetBoards.map((board) => ({ ...board, prompt: `${board.prompt || ""} 新的服装状态。` })),
} as ManualProductionAssetReadModel;
assert.notEqual(
  buildManualStoryboardSourceHash(filmTeam, changedAssetPrompt),
  sourceHash,
  "real asset prompt changes must still invalidate dependent storyboards",
);
const scene: Scene = {
  id: "scene-1",
  title: "雨夜对峙",
  description: "主角逼问关键证据。",
  valueCharge: "negative",
  shots,
};

const missing = buildManualStoryboardReadModel({ scene, filmTeam, assets });
assert.equal(missing.shotPlanStatus, "missing");
assert.equal(missing.visualPromptStatus, "missing");

const passingQuality = (score: number) => ({
  score,
  verdict: "pass" as const,
  summary: "独立 Agent 质检通过。",
  strengths: ["可执行"],
  issues: [],
});

scene.manualStoryboard = {
  schemaVersion: "manual-storyboard.v1",
  shotPlan: {
    sourceHash,
    outputHash: buildManualShotPlanHash(shots),
    audit: {
      action: "generate_shots",
      templateId: "generateShots",
      promptHash: "shot-prompt-hash",
      modelId: "storyboard-model",
      selectedSkillIds: ["skill-directing"],
      selectedSkillTitles: ["克制悬疑调度"],
      selectedContextIds: ["scene-context"],
      createdAt: 1,
    },
    adoptedAt: 2,
  },
  imagePrompts: {
    sourceHash: buildManualVisualPromptSourceHash(sourceHash, shots),
    outputHash: buildManualImagePromptHash(shots),
    audit: {
      action: "generate_image_prompts",
      templateId: "generateImagePrompts",
      promptHash: "image-prompt-hash",
      modelId: "storyboard-model",
      selectedSkillIds: ["skill-cinematography"],
      selectedSkillTitles: ["现实主义摄影"],
      selectedContextIds: ["asset-context"],
      createdAt: 3,
    },
    adoptedAt: 4,
  },
  videoPrompts: {
    sourceHash: buildManualVisualPromptSourceHash(sourceHash, shots),
    outputHash: buildManualVideoPromptHash(shots),
    audit: {
      action: "generate_video_prompts",
      templateId: "generateVideoPrompts",
      promptHash: "video-prompt-hash",
      modelId: "storyboard-model",
      selectedSkillIds: ["skill-cinematography"],
      selectedSkillTitles: ["连续运动设计"],
      selectedContextIds: ["shot-context"],
      createdAt: 4,
    },
    adoptedAt: 4,
  },
  updatedAt: 4,
};

const beforeQa = buildManualStoryboardReadModel({ scene, filmTeam, assets });
assert.equal(beforeQa.shotPlanStatus, "ready");
assert.equal(beforeQa.visualPromptStatus, "ready");
assert.equal(beforeQa.qaStatus, "missing");
assert.equal(beforeQa.readyForStoryboardDraftGeneration, true, "manual generation must not require QA approval");
assert.equal(beforeQa.readyForStoryboardFormalAdoption, true);
assert.equal(beforeQa.readyForStoryboardBoardGeneration, true);
const assetsMissingFormalReferences = {
  ...assets,
  readyForStoryboardGeneration: false,
  missingReferenceCount: 1,
} as ManualProductionAssetReadModel;
const draftWithoutFormalReferences = buildManualStoryboardReadModel({
  scene,
  filmTeam,
  assets: assetsMissingFormalReferences,
});
assert.equal(draftWithoutFormalReferences.readyForStoryboardDraftGeneration, true);
assert.equal(draftWithoutFormalReferences.readyForStoryboardFormalAdoption, true);
assert.equal(buildManualStoryboardReadModel({
  scene: { ...scene, shots: [] },
  filmTeam,
  assets,
}).readyForStoryboardDraftGeneration, false);
const automaticallyConfirmedScene = {
  ...scene,
  manualStoryboard: {
    ...scene.manualStoryboard,
    shotPlan: {
      ...scene.manualStoryboard.shotPlan!,
      audit: { ...scene.manualStoryboard.shotPlan!.audit, agentQuality: passingQuality(94) },
      confirmedAt: 5,
    },
    imagePrompts: {
      ...scene.manualStoryboard.imagePrompts!,
      audit: { ...scene.manualStoryboard.imagePrompts!.audit, agentQuality: passingQuality(92) },
      confirmedAt: 5,
    },
    videoPrompts: {
      ...scene.manualStoryboard.videoPrompts!,
      audit: { ...scene.manualStoryboard.videoPrompts!.audit, agentQuality: passingQuality(91) },
      confirmedAt: 5,
    },
  },
} as Scene;
const automaticallyConfirmed = buildManualStoryboardReadModel({ scene: automaticallyConfirmedScene, filmTeam, assets });
assert.equal(automaticallyConfirmed.qaStatus, "confirmed");
assert.equal(automaticallyConfirmed.automaticQAScore, 91);
const promptGenerationWithoutReadyAssets = buildManualStoryboardReadModel({
  scene: automaticallyConfirmedScene,
  filmTeam,
  assets: {
    ...assets,
    readyForShotPlanning: false,
    readyForStoryboardGeneration: false,
  } as ManualProductionAssetReadModel,
});
assert.equal(promptGenerationWithoutReadyAssets.readyForImagePromptGeneration, true, "confirmed Shots must independently unlock image prompt generation");
assert.equal(promptGenerationWithoutReadyAssets.readyForVideoPromptGeneration, true, "confirmed Shots must independently unlock video prompt generation");
assert.equal(promptGenerationWithoutReadyAssets.readyForStoryboardFormalAdoption, true, "manual adoption must not wait for asset QA");
assert.equal(automaticallyConfirmed.readyForStoryboardFormalAdoption, true);
assert.equal(automaticallyConfirmed.readyForStoryboardBoardGeneration, true);
scene.manualStoryboard = automaticallyConfirmedScene.manualStoryboard;
const ready = buildManualStoryboardReadModel({ scene, filmTeam, assets });
assert.equal(ready.qaStatus, "confirmed");
assert.equal(ready.readyForStoryboardFormalAdoption, true);
assert.equal(ready.readyForStoryboardBoardGeneration, true);

const authorEditedShots = shots.map((shot) => ({
  ...shot,
  visualAction: `${shot.visualAction} 主角停步确认对方反应。`,
  imagePrompt: `${shot.imagePrompt} 保持双方视线关系。`,
  videoPrompt: `${shot.videoPrompt} 结尾停在主角的判断反应。`,
}));
const authorRebasedWorkspace = rebaseManualStoryboardAfterAuthorEdit({
  workspace: {
    ...scene.manualStoryboard!,
    boards: [{
      id: "old-derived-board",
      unitSchema: "storyboard_unit.v1",
      shotId: "shot-1",
      shotIds: ["shot-1"],
      updatedAt: 8,
    }],
  },
  shots: authorEditedShots,
  sourceHash: ready.sourceHash,
  confirmShotPlan: true,
  confirmImagePrompts: true,
  confirmVideoPrompts: true,
  now: 10,
});
assert.equal(authorRebasedWorkspace.shotPlan?.outputHash, buildManualShotPlanHash(authorEditedShots));
assert.equal(authorRebasedWorkspace.imagePrompts?.sourceHash, buildManualVisualPromptSourceHash(ready.sourceHash, authorEditedShots));
assert.equal(authorRebasedWorkspace.imagePrompts?.outputHash, buildManualImagePromptHash(authorEditedShots));
assert.equal(authorRebasedWorkspace.videoPrompts?.outputHash, buildManualVideoPromptHash(authorEditedShots));
assert.equal(authorRebasedWorkspace.shotPlan?.confirmedAt, 10);
assert.equal(authorRebasedWorkspace.imagePrompts?.confirmedAt, 10);
assert.equal(authorRebasedWorkspace.videoPrompts?.confirmedAt, 10);
assert.equal(authorRebasedWorkspace.boards?.[0]?.id, "old-derived-board", "saving a Shot must preserve traceable downstream work while its hashes make it stale");
assert.equal(canRebaseManualStoryboardAuthorEdit(authorRebasedWorkspace, ready.sourceHash), true);
assert.equal(canRebaseManualStoryboardAuthorEdit(authorRebasedWorkspace, "new-upstream-source"), false, "a card edit must not confirm stale Shots against changed upstream content");
const authorRebasedReadModel = buildManualStoryboardReadModel({
  scene: { ...scene, shots: authorEditedShots, manualStoryboard: authorRebasedWorkspace },
  filmTeam,
  assets,
});
assert.equal(authorRebasedReadModel.shotPlanStatus, "ready");
assert.equal(authorRebasedReadModel.visualPromptStatus, "ready");
assert.equal(authorRebasedReadModel.qaStatus, "missing", "author adoption is not an independent QA run");
assert.equal(authorRebasedReadModel.automaticQAScore, undefined);
assert.equal(authorRebasedWorkspace.shotPlan?.qa, undefined, "saving must not manufacture a perfect review");
assert.equal(authorRebasedReadModel.shotPlanAccepted, true);
assert.equal(authorRebasedReadModel.imagePromptAccepted, true);
assert.equal(authorRebasedReadModel.videoPromptAccepted, true);
assert.equal(authorRebasedReadModel.readyForStudioVideoGeneration, true, "author adoption still unlocks production");
const legacyAuthorWorkspace = structuredClone(authorRebasedWorkspace);
for (const key of ["shotPlan", "imagePrompts", "videoPrompts"] as const) {
  legacyAuthorWorkspace[key]!.qa = { score: 100, verdict: "pass", summary: "创作者已保存并确认当前内容。", strengths: [], issues: [] };
}
const legacyAuthorReadModel = buildManualStoryboardReadModel({ scene: { ...scene, shots: authorEditedShots, manualStoryboard: legacyAuthorWorkspace }, filmTeam, assets });
assert.equal(legacyAuthorReadModel.automaticQAScore, undefined, "legacy placeholder scores must not become independent QA");
assert.equal(legacyAuthorReadModel.shotPlanAccepted, true, "legacy author adoption remains usable");
assert.equal(legacyAuthorReadModel.qaStatus, "missing");
const selfReviewedWorkspace = structuredClone(legacyAuthorWorkspace);
for (const key of ["shotPlan", "imagePrompts", "videoPrompts"] as const) {
  const record = selfReviewedWorkspace[key]!;
  record.audit = { ...record.audit, templateId: "authored-shots", modelId: "local-author", agentQuality: { ...record.qa!, reviewKind: "author_self_review" } };
  delete record.qa;
}
const selfReviewedReadModel = buildManualStoryboardReadModel({ scene: { ...scene, shots: authorEditedShots, manualStoryboard: selfReviewedWorkspace }, filmTeam, assets });
assert.equal(selfReviewedReadModel.automaticQAScore, undefined);
assert.equal(selfReviewedReadModel.qaStatus, "missing");
assert.equal(selfReviewedReadModel.shotPlanAccepted, true, "documented author review and adoption still work without masquerading as independent QA");
assert.equal(selfReviewedReadModel.readyForStudioVideoGeneration, true);

const deletionRebasedWorkspace = rebaseManualStoryboardAfterShotDeletion({
  workspace: authorRebasedWorkspace,
  shots: [],
  sourceHash: ready.sourceHash,
  now: 11,
});
assert.equal(deletionRebasedWorkspace?.shotPlan?.confirmedAt, 11, "deleting Shots directly adopts the edited Shot plan");
assert.equal(
  deletionRebasedWorkspace?.imagePrompts?.confirmedAt,
  authorRebasedWorkspace.imagePrompts?.confirmedAt,
  "deleting Shots must not silently reconfirm downstream image prompts",
);
assert.equal(
  deletionRebasedWorkspace?.videoPrompts?.confirmedAt,
  authorRebasedWorkspace.videoPrompts?.confirmedAt,
  "deleting Shots must not silently reconfirm downstream video prompts",
);
assert.equal(
  deletionRebasedWorkspace?.imagePrompts?.outputHash,
  authorRebasedWorkspace.imagePrompts?.outputHash,
  "deleting Shots must leave downstream image prompt lineage stale for review",
);
assert.equal(
  deletionRebasedWorkspace?.videoPrompts?.outputHash,
  authorRebasedWorkspace.videoPrompts?.outputHash,
  "deleting Shots must leave downstream video prompt lineage stale for review",
);

const legacyCombinedScene = structuredClone(scene);
legacyCombinedScene.manualStoryboard!.visualPrompts = legacyCombinedScene.manualStoryboard!.imagePrompts;
legacyCombinedScene.manualStoryboard!.imagePrompts = undefined;
legacyCombinedScene.manualStoryboard!.videoPrompts = undefined;
const ignoredLegacyCombined = buildManualStoryboardReadModel({ scene: legacyCombinedScene, filmTeam, assets });
assert.equal(ignoredLegacyCombined.imagePromptStatus, "missing");
assert.equal(ignoredLegacyCombined.videoPromptStatus, "missing");
assert.equal(ignoredLegacyCombined.readyForStoryboardFormalAdoption, true, "legacy lineage remains separate from permission to act manually");

const historicalLineageScene = structuredClone(scene);
historicalLineageScene.productionPreparation = {
  schemaVersion: "production-preparation.v1",
  sceneId: historicalLineageScene.id,
  breakdown: {
    status: "confirmed",
    sourceHash: "breakdown-v1",
    confirmedAt: 1,
  },
  updatedAt: 1,
};
historicalLineageScene.manualStoryboard!.shotPlan!.sourceHash = "historical-source-hash";
historicalLineageScene.manualStoryboard!.imagePrompts!.sourceHash = buildManualVisualPromptSourceHash("historical-source-hash", shots);
historicalLineageScene.manualStoryboard!.videoPrompts!.sourceHash = buildManualVisualPromptSourceHash("historical-source-hash", shots);
historicalLineageScene.manualStoryboard!.shotPlan!.audit.agentQuality = passingQuality(94);
historicalLineageScene.manualStoryboard!.imagePrompts!.audit.agentQuality = passingQuality(92);
historicalLineageScene.manualStoryboard!.videoPrompts!.audit.agentQuality = passingQuality(91);
const timelineFilmTeam = {
  ...filmTeam,
  directorCockpit: { ...filmTeam.directorCockpit, readyForStoryboard: true },
} as ManualFilmTeamReadModel;
const historicalLineage = buildManualStoryboardReadModel({
  scene: historicalLineageScene,
  filmTeam: timelineFilmTeam,
  assets,
});
assert.equal(historicalLineage.shotPlanStatus, "ready");
assert.equal(historicalLineage.visualPromptStatus, "ready");
assert.equal(historicalLineage.sourceHash, "historical-source-hash");

const changedAfterAdoptionFilmTeam = structuredClone(timelineFilmTeam);
Object.assign(changedAfterAdoptionFilmTeam.departmentPrepPackages[0].specialistPayload!.manualOutput as Record<string, unknown>, {
  version: 2,
  updatedAt: 3,
  confirmedAt: 3,
});
const changedAfterAdoption = buildManualStoryboardReadModel({
  scene: historicalLineageScene,
  filmTeam: changedAfterAdoptionFilmTeam,
  assets,
});
assert.equal(changedAfterAdoption.shotPlanStatus, "stale", "a semantic dependency updated after adoption must remain stale");
assert.equal(changedAfterAdoption.shotPlanAccepted, true, "an upstream source update must remain advisory and preserve the prior author confirmation");
assert.equal(changedAfterAdoption.videoPromptAccepted, true, "unchanged confirmed video prompt output must remain accepted");
assert.equal(changedAfterAdoption.readyForImagePromptGeneration, true);
assert.equal(changedAfterAdoption.readyForStudioVideoGeneration, true);

const performanceGuidanceChanged = [{ ...shots[0], microExpression: "下颌收紧，视线停在文件边缘。" }];
assert.notEqual(buildManualShotPlanHash(performanceGuidanceChanged), buildManualShotPlanHash(shots));
assert.equal(
  buildManualImagePromptHash(performanceGuidanceChanged),
  buildManualImagePromptHash(shots),
  "upstream performance guidance must not be counted as an image prompt output",
);
assert.equal(buildManualVideoPromptHash(performanceGuidanceChanged), buildManualVideoPromptHash(shots));

const editedShotScene = { ...scene, shots: [{ ...shots[0], duration: 7 }] };
const edited = buildManualStoryboardReadModel({ scene: editedShotScene, filmTeam, assets });
assert.equal(edited.shotPlanStatus, "stale");
assert.equal(edited.visualPromptStatus, "stale");
assert.ok(edited.staleReasons.some((reason) => reason.includes("人工编辑")));
assert.equal(edited.shotPlanAccepted, true, "an author edit must not automatically disable the next workflow action");

const editedVideoPromptScene = {
  ...scene,
  shots: [{ ...shots[0], videoPrompt: `${shots[0].videoPrompt} 结尾停在人物反应上。` }],
};
const editedVideoPrompt = buildManualStoryboardReadModel({ scene: editedVideoPromptScene, filmTeam, assets });
assert.equal(editedVideoPrompt.videoPromptStatus, "stale");
assert.equal(editedVideoPrompt.videoPromptQAStatus, "stale");
assert.equal(editedVideoPrompt.videoPromptAccepted, false, "changed video prompt output must not inherit its old confirmation");
assert.equal(editedVideoPrompt.readyForStudioVideoGeneration, true);

const changedAssets = {
  ...assets,
  assetBoards: [{ ...assets.assetBoards[0], referenceImageUrl: "/character-rain-v2.png" }],
} as ManualProductionAssetReadModel;
const upstreamChanged = buildManualStoryboardReadModel({ scene, filmTeam, assets: changedAssets });
assert.equal(upstreamChanged.shotPlanStatus, "ready", "replacing only a reference image must not invalidate confirmed Shot semantics");
assert.equal(upstreamChanged.visualPromptStatus, "ready", "replacing only a reference image must not invalidate confirmed text prompts");

const changedAssetState = {
  ...assets,
  sceneVisualPack: {
    ...assets.sceneVisualPack,
    visualFingerprint: "scene-pack-semantic-v2",
  },
} as ManualProductionAssetReadModel;
const semanticUpstreamChanged = buildManualStoryboardReadModel({ scene, filmTeam, assets: changedAssetState });
assert.equal(semanticUpstreamChanged.shotPlanStatus, "stale");
assert.equal(semanticUpstreamChanged.visualPromptStatus, "stale");
assert.equal(semanticUpstreamChanged.readyForStoryboardFormalAdoption, true, "semantic upstream changes must warn without revoking confirmed storyboard access");

const hookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardAI.ts", import.meta.url), "utf8");
assert.ok(hookSource.includes("manualReview"));
assert.ok(hookSource.includes("setReviewCandidate"));
assert.ok(hookSource.includes("selectedSkillIds: metadata?.selectedSkillIds"));
assert.ok(hookSource.includes("modelId: useAIConfigStore.getState().routing.storyboardGen"));
assert.ok(hookSource.includes("workflowOptions.manualReview\n            ? Array.from(new Set(explicitCharacterIds))"));
assert.ok(hookSource.includes("不属于当前项目"));
assert.ok(hookSource.includes("workflowOptions.allowedAssetIds"));
assert.ok(hookSource.includes("const promptContext = {"));
assert.ok(hookSource.includes("!workflowOptions.manualReview && (unlinkedCharacters.length > 0 || unlinkedLocations.length > 0)"));
assert.ok(hookSource.includes("采用镜头草案前"));
assert.ok(hookSource.includes("microExpression: shot.microExpression"), "visual prompt generation must not rewrite confirmed Shot performance guidance");

const pageSource = fs.readFileSync(new URL("../src/pages/Storyboard.tsx", import.meta.url), "utf8");
const shotCardSource = fs.readFileSync(new URL("../src/components/storyboard/ShotCard.tsx", import.meta.url), "utf8");
assert.ok(pageSource.includes("ManualStoryboardReviewModal"));
assert.equal(pageSource.includes("ManualStoryboardStatusBar"), false);
assert.equal(pageSource.includes("ManualStoryboardQAControls"), false);
assert.equal(pageSource.includes("分镜与提示词检查"), false);
assert.equal(pageSource.includes("rebaseManualStoryboardAfterAuthorEdit"), false, "the page must not silently confirm downstream prompt layers");
assert.ok(
  pageSource.includes("if (hasActiveStoryboardGeneration)"),
  "batch deletion must refuse to race an in-flight storyboard generation",
);
assert.ok(pageSource.includes("disabled={isStoryboardMutationBusy}"));
assert.ok(shotCardSource.includes("rebaseManualStoryboardAfterAuthorEdit"));
assert.ok(shotCardSource.includes("canRebaseManualStoryboardAuthorEdit"));
assert.ok(pageSource.includes("manualTeamContext"));
assert.ok(pageSource.includes("manualAssetContext"));
assert.ok(pageSource.includes("useStoryboardBoardBatchAgent"));

const boardBatchHookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardBoardBatchAgent.ts", import.meta.url), "utf8");
assert.ok(boardBatchHookSource.includes("qcAnalyzer"));
assert.ok(boardBatchHookSource.includes("STORYBOARD_BOARD_AGENT_MAX_REPAIRS"));
assert.ok(boardBatchHookSource.includes("confirmedAt"));
assert.ok(boardBatchHookSource.includes("buildManualBoardQASourceHash"));
assert.ok(boardBatchHookSource.includes("generateAIImage"));
assert.ok(boardBatchHookSource.includes("buildStoryboardCompositeBoardQAPrompt"));
assert.ok(boardBatchHookSource.includes("mediaDataList"));
assert.ok(boardBatchHookSource.includes('ensureAIProviderTaskReady("visualQc"'));
assert.ok(boardBatchHookSource.includes("runStoryboardCompositeVisualAgent"));
assert.ok(boardBatchHookSource.includes("renderStoryboardBoardOverlay"));
assert.ok(boardBatchHookSource.includes("visualTakes"));
assert.ok(boardBatchHookSource.includes("inspectImageTechnicalMetadata"));

const aiDefaultsSource = fs.readFileSync(new URL("../src/config/aiConfigDefaults.ts", import.meta.url), "utf8");
assert.ok(aiDefaultsSource.includes("export const defaultModels: AIModel[] = []"));
assert.ok(aiDefaultsSource.includes("visualQc: ''"));
assert.ok(aiDefaultsSource.includes("channelPresets"));

const boardAgentSource = fs.readFileSync(new URL("../src/services/production/storyboardBoardAgent.ts", import.meta.url), "utf8");
assert.ok(boardAgentSource.includes("BOARD_SHOT_MISSING"));
assert.ok(boardAgentSource.includes("targetShotId 必须填写输入中的完整 shotId"));
assert.ok(boardAgentSource.includes("只修复结构检查和独立质检明确指出的问题"));
assert.ok(boardAgentSource.includes("控制关键帧不等于剪辑镜头"));
assert.ok(boardAgentSource.includes("找不到证据时不得报错"));
assert.ok(boardAgentSource.includes("【有效 legend 目录】"));
assert.ok(boardAgentSource.includes("不得只写颜色文字而不声明 legend"));
assert.ok(boardAgentSource.includes("renderInstruction 只能描述线稿媒介、构图和运动标记"));
assert.ok(boardAgentSource.includes("不能因为对白或视线提到道具就推断其转移"));
assert.ok(boardAgentSource.includes("未有明确拿起、放下、交接、开启或改变动作时保持原状态"));
assert.ok(boardAgentSource.includes("距离和台词保留在结构字段"));
assert.ok(boardAgentSource.includes("不得创造近义策略名"));
assert.ok(boardBatchHookSource.includes("scoreStoryboardBoardCandidateCompleteness"));
assert.ok(boardBatchHookSource.includes("combineStoryboardBatchQualities"));
assert.ok(boardBatchHookSource.includes("new Set(qualities.map((quality) => quality.summary).filter(Boolean))"));
assert.ok(boardBatchHookSource.includes("surroundingShots"));
assert.ok(boardBatchHookSource.includes("STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES"));
assert.ok(boardBatchHookSource.includes("输出恢复"));
assert.ok(boardBatchHookSource.includes("repairShots.map((shot) => [shot])"));
assert.ok(boardBatchHookSource.includes("质检输出格式无效"));
assert.ok(boardBatchHookSource.includes("禁止 Markdown、解释文字或省略字段"));
assert.ok(boardAgentSource.includes("【本轮负责质检的 Shot】"));
assert.ok(boardAgentSource.includes('required: ["severity", "targetShotId", "description", "suggestion", "evidence"]'));
assert.ok(boardAgentSource.includes("resolveJsonPointer"));
assert.ok(boardAgentSource.includes("候选证据路径或精确值未匹配"));

console.log("Manual storyboard self-check passed.");
