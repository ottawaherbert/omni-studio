import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildManualBoardOutputHash,
  buildManualBoardQASourceHash,
  buildManualBoardSourceHash,
  buildManualBoardStrategySourceHash,
  buildManualStoryboardStrategyContext,
  buildManualVideoStoryboardReadModel,
  isManualVideoStoryboardReadyForConfirmation,
  normalizeManualStoryboardBoard,
  normalizeManualStoryboardStrategy,
  validateManualStoryboardBoard,
  validateManualStoryboardStrategy,
} from "../src/services/production/manualVideoStoryboard";
import {
  buildManualVideoPromptHash,
  buildManualVisualPromptSourceHash,
  manualStoryboardHash,
} from "../src/services/production/manualStoryboard";
import { buildStoryboardUnitVideoPromptRecord } from "../src/services/production/storyboardUnitVideoPrompt";
import { buildStoryboardPanelVisualSourceHash } from "../src/services/production/storyboardPanelVisual";
import {
  buildStoryboardCompositeBoardSourceHash,
  buildStoryboardCompositeVisualPages,
  buildStoryboardShotCellManifest,
  composeStoryboardShotGridPage,
} from "../src/services/production/storyboardCompositeBoard";
import {
  getActionableStoryboardBoardIssues,
  mergeStoryboardBoardBatchValues,
  normalizeStoryboardBoardBatch,
  splitStoryboardBoardShots,
  validateStoryboardBoardBatch,
} from "../src/services/production/storyboardBoardAgent";
import type { ManualStoryboardBoardWorkflow, ManualStoryboardStrategyDecision, Project, Scene, Shot } from "../src/types/project";
import type { ManualProductionAssetReadModel } from "../src/services/production/manualProductionAssets";

const shot: Shot = {
  id: "shot-1",
  duration: 8,
  motivation: "用缓慢推进呈现权力关系逆转",
  visualAction: "林岚从画面左侧把证据推到桌面中央，周衡的右手从文件上移开。",
  shotSize: "MS",
  cameraAngle: "Eye-Level",
  cameraMovement: "Push-in",
  focalLength: "50mm",
  composition: "林岚左，周衡右，证据位于中线。",
  blocking: "林岚向前半步，周衡后撤半步。",
  continuityNote: "保持轴线、视线、动作和左右方位连续。",
  lightingAtmo: "冷白顶灯，桌面证据处有一束硬光。",
  imagePrompt: "中景，林岚位于左侧，周衡位于右侧，证据在桌面中线。",
  videoPrompt: "镜头缓慢推进，林岚推入证据，周衡的手后撤。",
  characterIdsInShot: ["character-lin", "character-zhou"],
  locationId: "location-office",
  propIds: ["prop-evidence"],
  dialogueLines: [{ characterId: "character-lin", text: "现在，你还要否认吗？" }],
};

const sceneWithConfirmedVideoPrompts = (shots: Shot[]): Scene => ({
  id: "scene-1",
  title: "办公室对峙",
  description: "林岚用证据迫使周衡松手。",
  valueCharge: "positive",
  shots,
  manualStoryboard: {
    schemaVersion: "manual-storyboard.v1",
    videoPrompts: {
      sourceHash: buildManualVisualPromptSourceHash("storyboard-source-v1", shots),
      outputHash: buildManualVideoPromptHash(shots),
      audit: {
        action: "generate_video_prompts",
        templateId: "generateVideoPrompts",
        promptHash: "video-prompt-run",
        modelId: "video-prompt-model",
        selectedSkillIds: [],
        selectedSkillTitles: [],
        selectedContextIds: [],
        createdAt: 1,
        agentQuality: { score: 96, verdict: "pass", summary: "视频提示词已确认。", strengths: ["动作明确"], issues: [] },
      },
      adoptedAt: 1,
      confirmedAt: 1,
    },
    boards: [],
    updatedAt: 1,
  },
});

const decision: ManualStoryboardStrategyDecision = {
  selectedStrategyId: "storyboard.single_shot_dialogue.v1",
  selectedStrategyVersion: "v1",
  selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  rationale: "当前 Shot 是八秒单镜头对白与手部动作变化，策略需要保持轴线、左右站位和证据交接，同时适配短视频模型时长。",
  rejectedStrategyIds: ["storyboard.fight_choreography.v1"],
  riskNotes: ["手部动作和证据位置必须在四格之间连续。"],
  expectedBoardShape: "四格单镜头表演控制板",
  expectedVideoUnitDurationSeconds: 8,
  expectedReferenceImageCount: 4,
  expectedReferenceVideoCount: 0,
  arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green", "shot_note_black"],
  qaChecklist: ["轴线稳定", "证据位置连续", "尾状态可接下一镜"],
};

const strategyAlias = normalizeManualStoryboardStrategy({ ...decision, selectedStrategyId: "storyboard.single_shot_dialogue", selectedStrategyVersion: "" });
assert.equal(strategyAlias.selectedStrategyId, "storyboard.single_shot_dialogue.v1");
assert.equal(strategyAlias.selectedStrategyVersion, "v1");
assert.equal(normalizeManualStoryboardStrategy({ ...decision, selectedStrategyId: "storyboard.single_shot" }).selectedStrategyId, "storyboard.single_shot_dialogue.v1");
assert.equal(normalizeManualStoryboardStrategy({ ...decision, selectedStrategyId: "storyboard.dialogue" }).selectedStrategyId, "storyboard.dialogue");

const strategyContext = buildManualStoryboardStrategyContext({
  shot,
  projectFormat: "movie",
  aspectRatio: "16:9",
  referenceImageCount: 4,
});
assert.equal(validateManualStoryboardStrategy(decision, strategyContext).some((item) => item.severity === "blocking"), false);

const strategySourceHash = buildManualBoardStrategySourceHash("storyboard-source-v1", shot);
assert.notEqual(
  buildManualBoardStrategySourceHash("storyboard-source-v1", { ...shot, lightingAtmo: "暖色侧逆光" }),
  strategySourceHash,
  "changing a Shot's lighting must stale its existing storyboard unit",
);
const boardSourceHash = buildManualBoardSourceHash(strategySourceHash, decision);
const rawBoard = {
  performanceBeat: {
    scriptBlockIds: [],
    beatType: "dialogue",
    summary: "林岚用证据迫使周衡松手",
    visibleChange: "证据从林岚手中进入桌面中线，周衡的手撤离文件。",
    startState: "周衡右手压住文件，林岚站在桌对面。",
    endState: "证据留在桌面中线，周衡的手已经撤开。",
    durationSeconds: 8,
    characterIds: ["character-lin", "character-zhou"],
    locationId: "location-office",
    propIds: ["prop-evidence"],
    soundCues: ["文件滑过桌面的摩擦声", "林岚对白"],
    continuityIn: "承接林岚左侧入画。",
    continuityOut: "证据停在中线，周衡视线落向证据。",
  },
  board: {
    layout: "2x2",
    lineArtPrompt: "16:9 四格黑白线稿故事板，林岚始终在左，周衡始终在右，红色箭头标证据移动，蓝色箭头标缓慢推进。",
    startState: "周衡压住文件。",
    endState: "周衡松手，证据停在中线。",
    panels: Array.from({ length: 4 }, (_, index) => ({
      durationSeconds: 2,
      framePurpose: ["建立站位", "证据入画", "对白施压", "反应尾帧"][index],
      shotType: "MS",
      visualBeat: ["双方隔桌对峙", "林岚把证据推向中线", "林岚说出台词，镜头推进", "周衡松手并看向证据"][index],
      cameraNote: "保持同侧轴线并缓慢推进",
      framing: "林岚左、周衡右",
      lens: "50mm",
      angle: "Eye-Level",
      cameraMove: "Push-in",
      subjectAction: "证据和手部发生可见变化",
      blocking: "双方不越过桌面中线",
      lightingCue: "顶灯方向不变",
      soundCue: "对白与文件摩擦声",
      emotionCue: "周衡视线从林岚转向证据",
      compositionNote: "证据保持在画面中线",
      continuityIn: "承接上一格的手和证据位置",
      continuityOut: "输出下一格所需的手和证据位置",
      assetRefs: ["character-lin", "character-zhou", "location-office", "prop-evidence"],
      annotationLegendIds: ["subject_action_red", "camera_motion_blue"],
      actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"],
      dialogueOrSoundCue: "对白/摩擦声",
      renderInstruction: "黑白线稿，位置清楚",
    })),
  },
};

const boardDraft = normalizeManualStoryboardBoard({ value: rawBoard, episodeId: "episode-1", sceneId: "scene-1", shot, decision });
assert.equal(boardDraft.board?.layout, "2x2");
assert.ok(boardDraft.board?.lineArtPrompt.includes("共4格，严格采用2x2布局"));
assert.equal(boardDraft.board?.panels.reduce((sum, panel) => sum + (panel.durationSeconds || 0), 0), shot.duration);
const threePanelDraft = normalizeManualStoryboardBoard({
  value: { ...rawBoard, board: { ...rawBoard.board, layout: "2x2", panels: rawBoard.board.panels.slice(0, 3) } },
  episodeId: "episode-1",
  sceneId: "scene-1",
  shot,
  decision,
});
assert.equal(threePanelDraft.board?.layout, "1x3");
assert.ok(threePanelDraft.board?.lineArtPrompt.includes("共3格，严格采用1x3布局"));
assert.equal(threePanelDraft.board?.panels.reduce((sum, panel) => sum + (panel.durationSeconds || 0), 0), shot.duration);
const boardIssues = validateManualStoryboardBoard({
  workflow: boardDraft,
  strategyContext,
  allowedAssetIds: ["character-lin", "character-zhou", "location-office", "prop-evidence"],
  shot,
});
assert.equal(boardIssues.some((item) => item.severity === "blocking"), false, JSON.stringify(boardIssues, null, 2));

const batchValues = normalizeStoryboardBoardBatch({
  value: [{ shotId: shot.id, strategyDecision: decision, ...rawBoard }],
  episodeId: "episode-1",
  sceneId: "scene-1",
  shots: [shot],
});
const batchIssues = validateStoryboardBoardBatch({
  values: batchValues,
  shots: [shot],
  projectFormat: "movie",
  aspectRatio: "16:9",
  referenceImageCount: 4,
  allowedAssetIds: ["character-lin", "character-zhou", "location-office", "prop-evidence"],
});
assert.equal(batchIssues.some((item) => item.severity === "blocking"), false, JSON.stringify(batchIssues, null, 2));
assert.ok(validateStoryboardBoardBatch({
  values: [],
  shots: [shot],
  projectFormat: "movie",
  aspectRatio: "16:9",
  referenceImageCount: 4,
  allowedAssetIds: [],
}).some((item) => item.code === "BOARD_SHOT_MISSING"));
assert.ok(validateStoryboardBoardBatch({
  values: [...batchValues, ...batchValues],
  shots: [shot],
  projectFormat: "movie",
  aspectRatio: "16:9",
  referenceImageCount: 4,
  allowedAssetIds: ["character-lin", "character-zhou", "location-office", "prop-evidence"],
}).some((item) => item.code === "BOARD_SHOT_DUPLICATE"));

const boardOutputHash = buildManualBoardOutputHash(boardDraft);
assert.equal(
  buildManualBoardOutputHash({ ...boardDraft, board: { ...boardDraft.board!, visualReferenceMode: "director_board" } }),
  boardOutputHash,
  "manually switching the reference representation must not invalidate storyboard structure or QA",
);
const qaSourceHash = buildManualBoardQASourceHash(boardOutputHash);
const visualBoardDraft = {
  ...boardDraft,
  board: {
    ...boardDraft.board!,
    panels: boardDraft.board!.panels.map((panel) => {
      const sourceHash = buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source-v1", boardOutputHash, panel, imagePrompt: shot.imagePrompt });
      const takeId = `visual-take-${panel.id}`;
      return {
        ...panel,
        activeVisualTakeId: takeId,
        visualTakes: [{
          id: takeId,
          imageUrl: `https://example.com/${panel.id}.jpg`,
          sourceHash,
          prompt: `故事板画格 ${panel.panelNumber}`,
          promptHash: manualStoryboardHash(`故事板画格 ${panel.panelNumber}`),
          modelId: "image-model",
          selectedSkillIds: ["skill-board"],
          selectedSkillTitles: ["线稿控制图"],
          selectedContextIds: ["asset-context"],
          selectedAssetBoardItemIds: panel.assetRefs,
          referenceImageUrls: panel.assetRefs.map((id) => `https://example.com/${id}.jpg`),
          attempt: 1,
          status: "adopted" as const,
          quality: { score: 95, verdict: "pass" as const, summary: "身份、构图和连续性一致。", strengths: ["动作清楚"], issues: [] },
          executions: [],
          createdAt: 6,
          adoptedAt: 7,
        }],
      };
    }),
  },
};
const workflow: ManualStoryboardBoardWorkflow = {
  id: "workflow-shot-1",
  unitSchema: "storyboard_unit.v1",
  shotId: shot.id,
  strategyDecision: decision,
  strategyRecord: {
    sourceHash: strategySourceHash,
    outputHash: manualStoryboardHash(decision),
    audit: { action: "select_board_strategy", templateId: "storyboard.strategy.select", promptHash: "prompt-strategy", modelId: "storyboard-model", selectedSkillIds: ["skill-director"], selectedSkillTitles: ["克制调度"], selectedContextIds: ["scene-context"], createdAt: 1 },
    adoptedAt: 2,
  },
  ...visualBoardDraft,
  boardRecord: {
    sourceHash: boardSourceHash,
    outputHash: boardOutputHash,
    audit: { action: "generate_board", templateId: "storyboard.board.plan", promptHash: "prompt-board", modelId: "storyboard-model", selectedSkillIds: ["skill-board"], selectedSkillTitles: ["线稿控制图"], selectedContextIds: ["asset-context"], createdAt: 3 },
    adoptedAt: 4,
  },
  qa: {
    score: 91,
    verdict: "pass",
    summary: "轴线、动作和资产引用完整。",
    strengths: ["首尾状态清楚"],
    issues: [],
    sourceHash: qaSourceHash,
    audit: { action: "qa_board", templateId: "storyboard.board.qa", promptHash: "prompt-qa", modelId: "storyboard-model", selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: ["board-context"], createdAt: 5 },
    reviewedAt: 6,
  },
  unitVideoPrompt: buildStoryboardUnitVideoPromptRecord({
    workflow: { shotId: shot.id, board: visualBoardDraft.board },
    shots: [shot],
    now: 7,
  }),
  confirmedAt: 7,
  updatedAt: 7,
};

const ready = buildManualVideoStoryboardReadModel({ workflows: [workflow], shot, storyboardSourceHash: "storyboard-source-v1", scene: sceneWithConfirmedVideoPrompts([shot]) });
assert.equal(ready.strategyStatus, "ready");
assert.equal(ready.boardStatus, "ready");
assert.equal(ready.qaStatus, "confirmed");
assert.equal(ready.panelVisualStatus, "ready");
assert.equal(ready.readyVisualPanelCount, 4);
assert.equal(ready.assetReferencePackStatus, "ready");
assert.equal(ready.videoGenerationUnitStatus, "ready");
assert.equal(ready.readyForStudio, true);
const upstreamSourceChanged = buildManualVideoStoryboardReadModel({
  workflows: [workflow],
  shot,
  storyboardSourceHash: "storyboard-source-v2",
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(upstreamSourceChanged.strategyStatus, "stale");
assert.equal(upstreamSourceChanged.boardStatus, "stale");
assert.equal(upstreamSourceChanged.qaStatus, "stale");
assert.equal(upstreamSourceChanged.unitVideoPromptStatus, "ready");
assert.equal(
  upstreamSourceChanged.readyForStudio,
  true,
  "an upstream source-only change must request review without revoking adopted output",
);
const unconfirmedVideoPromptLayer = buildManualVideoStoryboardReadModel({
  workflows: [workflow],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  scene: { ...sceneWithConfirmedVideoPrompts([shot]), manualStoryboard: { schemaVersion: "manual-storyboard.v1", boards: [], updatedAt: 1 } },
});
assert.equal(unconfirmedVideoPromptLayer.unitVideoPromptStatus, "missing", "non-empty legacy Shot.videoPrompt text must not bypass the confirmed video-prompt record");
assert.equal(unconfirmedVideoPromptLayer.readyForStudio, true);
const removedFormatReadModel = buildManualVideoStoryboardReadModel({
  workflows: [{ ...workflow, unitSchema: undefined }],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(removedFormatReadModel.workflow, undefined);
assert.equal(removedFormatReadModel.boardStatus, "missing");

const project = {
  id: "project-1",
  title: "复合故事板测试",
  type: "movie",
  aspectRatio: "16:9",
  logline: "证据迫使权力关系逆转。",
  coreConflict: "林岚必须迫使周衡承认证据。",
  characters: [],
  episodes: [],
  assets: [],
} as Project;
const emptyAssets = {
  schemaVersion: "manual-production-asset-read-model.v1",
  projectId: project.id,
  episodeId: "episode-1",
  sceneId: "scene-1",
  assetPackHash: "asset-pack-1",
  readiness: "ready",
  readyForShotPlanning: true,
  readyForStoryboardGeneration: true,
  assetBoards: [],
  sceneStates: [],
  reusedSceneIds: [],
  confirmedBoardCount: 0,
  missingReferenceCount: 0,
  blockedBoardCount: 0,
  staleBoardCount: 0,
  issues: [],
} satisfies ManualProductionAssetReadModel;
const compositePages = buildStoryboardCompositeVisualPages(boardDraft.board!);
const compositeBoardWithManifest = {
  ...boardDraft.board!,
  shotCellManifest: buildStoryboardShotCellManifest({ board: boardDraft.board!, shots: [shot] }),
};
const compositeSourceHash = buildStoryboardCompositeBoardSourceHash({
  project,
  board: compositeBoardWithManifest,
  page: compositePages[0],
  references: [],
  shots: [shot],
});
const compositeTakeId = "composite-board-take-1";
const compositeWorkflow: ManualStoryboardBoardWorkflow = {
  ...workflow,
  board: {
    ...compositeBoardWithManifest,
    visualPages: [{
      ...compositePages[0],
      activeVisualTakeId: compositeTakeId,
      visualTakes: [{
        id: compositeTakeId,
        imageUrl: "https://example.com/composite-board.jpg",
        sourceHash: compositeSourceHash,
        prompt: "一张完整 2x2 多格故事板页。",
        promptHash: manualStoryboardHash("一张完整 2x2 多格故事板页。"),
        modelId: "image-model",
        selectedSkillIds: ["skill-board"],
        selectedSkillTitles: ["复合故事板"],
        selectedContextIds: ["board-context"],
        selectedAssetBoardItemIds: [],
        referenceImageUrls: [],
        panelIds: compositePages[0].panelIds,
        attempt: 1,
        status: "adopted",
        quality: { score: 95, verdict: "pass", summary: "格数、顺序和连续性通过。", strengths: ["整板清楚"], issues: [] },
        review: { mode: "automatic", status: "approved", reviewedAt: 8 },
        executions: [],
        createdAt: 8,
        adoptedAt: 9,
      }],
    }],
  },
};
const compositeReady = buildManualVideoStoryboardReadModel({
  workflows: [compositeWorkflow],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  project,
  assets: emptyAssets,
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(compositeReady.boardVisualStatus, "ready");
assert.equal(compositeReady.visualPageCount, 1);
assert.equal(compositeReady.readyVisualPageCount, 1);
assert.equal(compositeReady.readyVisualPanelCount, 1);
assert.equal(compositeReady.readyForStudio, true);
assert.equal(isManualVideoStoryboardReadyForConfirmation(compositeReady), true);
const latePictureShot = { ...shot, imageUrl: "https://example.com/late-adopted-shot.jpg", activeTakeId: "late-shot-picture", takes: [{ id: "late-shot-picture", imageUrl: "https://example.com/late-adopted-shot.jpg", createdAt: 10 }] };
const latePictureSourceHash = buildStoryboardCompositeBoardSourceHash({ project, board: compositeWorkflow.board!, page: compositePages[0], references: [], shots: [latePictureShot] });
const latePictureWorkflow: ManualStoryboardBoardWorkflow = {
  ...compositeWorkflow,
  board: {
    ...compositeWorkflow.board!,
    // The structure's persisted manifest predates this newly uploaded Shot.
    visualPages: compositeWorkflow.board!.visualPages!.map((page) => ({ ...page, visualTakes: page.visualTakes?.map((take) => ({ ...take, sourceHash: latePictureSourceHash })) })),
  },
};
const latePictureReadModel = buildManualVideoStoryboardReadModel({ workflows: [latePictureWorkflow], shot: latePictureShot, storyboardSourceHash: "storyboard-source-v1", project, assets: emptyAssets, scene: sceneWithConfirmedVideoPrompts([latePictureShot]) });
assert.equal(latePictureReadModel.boardVisualStatus, "ready", "a redrawn board remains adopted after a late Shot image replaces the stored empty manifest");
const gridOnlyPage = await composeStoryboardShotGridPage({ board: compositeWorkflow.board!, page: { ...compositePages[0], visualTakes: [] }, shots: [latePictureShot], render: async () => "grid-pixels", persist: async () => "/api/assets/independent-grid.png", now: 20 });
const gridOnlyWorkflow: ManualStoryboardBoardWorkflow = { ...compositeWorkflow, board: { ...compositeWorkflow.board!, visualReferenceMode: "shot_grid", visualPages: [gridOnlyPage] } };
const gridOnlyReadModel = buildManualVideoStoryboardReadModel({ workflows: [gridOnlyWorkflow], shot: latePictureShot, storyboardSourceHash: "storyboard-source-v1", project, assets: emptyAssets, scene: sceneWithConfirmedVideoPrompts([latePictureShot]) });
assert.equal(gridOnlyReadModel.panelVisualStatus, "ready", "independent composition is ready as a grid without inventing a director-board image");
assert.equal(gridOnlyReadModel.boardVisualStatus, "missing");
assert.deepEqual(gridOnlyReadModel.workflow?.qa, compositeWorkflow.qa, "deterministic composition does not manufacture or change a model quality report");
assert.equal(buildManualBoardOutputHash(gridOnlyWorkflow), buildManualBoardOutputHash(compositeWorkflow), "grid versions are not board structure and do not invalidate accepted structure QA");
const directorModeReadModel = buildManualVideoStoryboardReadModel({ workflows: [{ ...gridOnlyWorkflow, board: { ...gridOnlyWorkflow.board!, visualReferenceMode: "director_board" } }], shot: latePictureShot, storyboardSourceHash: "storyboard-source-v1", project, assets: emptyAssets, scene: sceneWithConfirmedVideoPrompts([latePictureShot]) });
assert.equal(directorModeReadModel.panelVisualStatus, "missing", "choosing director-board mode cannot silently substitute a composed grid");
const compositeAwaitingConfirmation = buildManualVideoStoryboardReadModel({
  workflows: [{ ...compositeWorkflow, confirmedAt: undefined }],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  project,
  assets: emptyAssets,
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(compositeAwaitingConfirmation.qaStatus, "ready");
assert.equal(compositeAwaitingConfirmation.panelVisualStatus, "ready");
assert.equal(compositeAwaitingConfirmation.readyForStudio, true);
assert.equal(isManualVideoStoryboardReadyForConfirmation(compositeAwaitingConfirmation), true);
assert.equal(isManualVideoStoryboardReadyForConfirmation({ ...compositeAwaitingConfirmation, panelVisualStatus: "needs_review" }), true);
const manuallyAdoptedCompositeWorkflow: ManualStoryboardBoardWorkflow = {
  ...compositeWorkflow,
  confirmedAt: undefined,
  board: {
    ...compositeWorkflow.board!,
    visualPages: compositeWorkflow.board!.visualPages!.map((page) => ({
      ...page,
      visualTakes: page.visualTakes?.map((take) => ({
        ...take,
        review: { mode: "manual", status: "approved", reviewer: "creator", reviewedAt: 10 },
      })),
    })),
  },
};
const manuallyAdoptedComposite = buildManualVideoStoryboardReadModel({
  workflows: [manuallyAdoptedCompositeWorkflow],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  project,
  assets: emptyAssets,
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(manuallyAdoptedComposite.qaStatus, "confirmed");
assert.equal(manuallyAdoptedComposite.boardVisualStatus, "ready");
assert.equal(manuallyAdoptedComposite.videoGenerationUnitStatus, "ready");
assert.equal(manuallyAdoptedComposite.readyForStudio, true);
const staleComposite = buildManualVideoStoryboardReadModel({
  workflows: [compositeWorkflow],
  shot,
  storyboardSourceHash: "storyboard-source-v1",
  project: { ...project, aspectRatio: "9:16" },
  assets: emptyAssets,
  scene: sceneWithConfirmedVideoPrompts([shot]),
});
assert.equal(staleComposite.boardVisualStatus, "stale");
assert.equal(staleComposite.readyForStudio, true, "a stale optional composite rendering must not block text/frame generation modes");

const editedShot = { ...shot, videoPrompt: `${shot.videoPrompt} 镜头尾部停住。` };
const edited = buildManualVideoStoryboardReadModel({ workflows: [workflow], shot: editedShot, storyboardSourceHash: "storyboard-source-v1", scene: sceneWithConfirmedVideoPrompts([editedShot]) });
assert.equal(edited.strategyStatus, "ready", "video prompt edits must not invalidate storyboard structure");
assert.equal(edited.boardStatus, "ready");
assert.equal(edited.qaStatus, "confirmed");
assert.equal(edited.unitVideoPromptStatus, "stale");
assert.deepEqual(edited.staleScopes, ["VideoGenerationUnit"]);
assert.equal(edited.readyForStudio, true, "editing a prompt must not revoke manual studio access");

const imageEdited = buildManualVideoStoryboardReadModel({
  workflows: [workflow],
  shot: { ...shot, imagePrompt: `${shot.imagePrompt} 桌面硬光更集中。` },
  storyboardSourceHash: "storyboard-source-v1",
  scene: sceneWithConfirmedVideoPrompts([{ ...shot, imagePrompt: `${shot.imagePrompt} 桌面硬光更集中。` }]),
});
assert.equal(imageEdited.strategyStatus, "ready", "image prompt edits must not invalidate storyboard structure");
assert.equal(imageEdited.boardStatus, "ready");
assert.equal(imageEdited.qaStatus, "confirmed");
assert.equal(imageEdited.panelVisualStatus, "stale", "image prompt edits must stale rendered storyboard images");
assert.equal(imageEdited.unitVideoPromptStatus, "ready", "image prompt edits must not stale the video-unit prompt");

const missingVisuals = buildManualVideoStoryboardReadModel({ workflows: [{ ...workflow, board: boardDraft.board }], shot, storyboardSourceHash: "storyboard-source-v1", scene: sceneWithConfirmedVideoPrompts([shot]) });
assert.equal(missingVisuals.panelVisualStatus, "missing");
assert.equal(missingVisuals.readyForStudio, true, "I2V/T2V readiness is structural and must not depend on a complete composite rendering");

const manualReviewWorkflow = {
  ...workflow,
  confirmedAt: undefined,
  board: {
    ...workflow.board!,
    panels: workflow.board!.panels.map((panel) => ({
      ...panel,
      activeVisualTakeId: undefined,
      visualTakes: [{
        ...(panel.visualTakes?.[0] as NonNullable<typeof panel.visualTakes>[number]),
        id: `manual-${panel.id}`,
        status: "candidate" as const,
        quality: undefined,
        review: { mode: "manual" as const, status: "pending" as const },
      }],
    })),
  },
};
const manualReview = buildManualVideoStoryboardReadModel({ workflows: [manualReviewWorkflow], shot, storyboardSourceHash: "storyboard-source-v1", scene: sceneWithConfirmedVideoPrompts([shot]) });
assert.equal(manualReview.panelVisualStatus, "needs_review");
assert.equal(manualReview.readyForStudio, true);

const invalidDraft = normalizeManualStoryboardBoard({
  value: {
    ...rawBoard,
    performanceBeat: {
      ...rawBoard.performanceBeat,
      characterIds: ["character-outside-shot"],
      locationId: "location-outside-shot",
      propIds: ["prop-outside-pack"],
    },
    board: {
      ...rawBoard.board,
      panels: rawBoard.board.panels.map((panel) => ({
        ...panel,
        assetRefs: ["character-outside-shot", "prop-outside-pack"],
        annotationLegendIds: ["unknown-legend"],
        actionArrowLegendIds: [],
      })),
    },
  },
  episodeId: "episode-1",
  sceneId: "scene-1",
  shot,
  decision,
});
assert.deepEqual(invalidDraft.performanceBeat?.characterIds, shot.characterIdsInShot);
assert.equal(invalidDraft.performanceBeat?.locationId, shot.locationId);
assert.deepEqual(invalidDraft.performanceBeat?.propIds, shot.propIds);
assert.ok(invalidDraft.board?.panels.every((panel) => panel.assetRefs.every((id) => ["character-lin", "character-zhou", "location-office", "prop-evidence"].includes(id))));
assert.ok(invalidDraft.board?.panels.every((panel) => panel.actionArrowLegendIds.includes("subject_action_red") && panel.actionArrowLegendIds.includes("camera_motion_blue")));
const normalizedIssues = validateManualStoryboardBoard({ workflow: invalidDraft, strategyContext, allowedAssetIds: ["character-lin", "character-zhou", "location-office", "prop-evidence"], shot });
assert.equal(normalizedIssues.some((item) => item.code === "BOARD_ASSET_OUTSIDE_SCENE_PACK" || item.code === "BOARD_ASSET_OUTSIDE_SHOT"), false);
assert.equal(normalizedIssues.find((item) => item.code === "PERFORMANCE_BEAT_SCRIPT_LINK_WEAK")?.severity, "advisory");
assert.equal(getActionableStoryboardBoardIssues(normalizedIssues.map((item) => ({ ...item, targetShotId: shot.id }))).some((item) => item.code === "PERFORMANCE_BEAT_SCRIPT_LINK_WEAK"), false);

const chunkShots = Array.from({ length: 9 }, (_, index) => ({ ...shot, id: `shot-${index + 1}` }));
assert.deepEqual(splitStoryboardBoardShots(chunkShots).map((chunk) => chunk.length), [4, 4, 1]);
const mergedValues = mergeStoryboardBoardBatchValues(
  [{ ...batchValues[0], shotId: "shot-1" }, { ...batchValues[0], shotId: "shot-2" }],
  [{ ...batchValues[0], shotId: "shot-2", strategyDecision: { ...decision, rationale: `${decision.rationale} 修订版。` } }],
);
assert.equal(mergedValues.length, 2);
assert.ok(mergedValues.find((item) => item.shotId === "shot-2")?.strategyDecision.rationale.endsWith("修订版。"));

const hookSource = fs.readFileSync(new URL("../src/hooks/useManualVideoStoryboard.ts", import.meta.url), "utf8");
for (const templateId of ["storyboard.strategy.select", "storyboard.board.plan", "storyboard.board.qa"]) assert.ok(hookSource.includes(templateId));
assert.ok(hookSource.includes("selectedSkillIds: metadata?.selectedSkillIds"));
assert.ok(hookSource.includes("setCandidate"));
assert.equal(/onClick=\{[^}]*generateAIContent/.test(hookSource), false);
const approveBoardVisualSource = hookSource.slice(
  hookSource.indexOf("const approveBoardVisual = async"),
  hookSource.indexOf("return {", hookSource.indexOf("const approveBoardVisual = async")),
);
assert.ok(
  approveBoardVisualSource.includes("confirmedAt: undefined"),
  "adopting a complete storyboard page must leave the independent board confirmation pending",
);
assert.equal(
  approveBoardVisualSource.includes("isManualVideoStoryboardReadyForConfirmation"),
  false,
  "adopting the last visual page must not silently confirm the board",
);
const confirmBoardSource = hookSource.slice(
  hookSource.indexOf("const confirmBoard = async"),
  hookSource.indexOf("const setTargetVideoModel = async", hookSource.indexOf("const confirmBoard = async")),
);
assert.ok(
  confirmBoardSource.includes("confirmedAt: now"),
  "only the explicit board confirmation action should write confirmedAt",
);

const serviceSource = fs.readFileSync(new URL("../src/services/production/manualVideoStoryboard.ts", import.meta.url), "utf8");
assert.equal(serviceSource.includes("COMBAT_PATTERN"), false);
assert.equal(serviceSource.includes("ACTION_PATTERN"), false);
assert.ok(serviceSource.includes("normalizeManualStoryboardStrategy"));

const panelSource = fs.readFileSync(new URL("../src/components/production/ManualVideoStoryboardPanel.tsx", import.meta.url), "utf8");
assert.ok(panelSource.includes("PromptEditorModal"));
assert.equal(panelSource.includes("质检故事板"), false, "the primary workflow must hide internal QA terminology");
assert.equal(panelSource.includes("动态预演"), false, "storyboard review must not expose a redundant animatic player");
assert.ok(panelSource.includes("primaryActionFor"));
assert.ok(panelSource.includes("primaryActionLabel"));
assert.equal(panelSource.includes("场景复合故事板"), false, "the primary workflow must use plain-language video reference terminology");
assert.ok(panelSource.includes("当前视频生成单元尚未建立"));
assert.ok(panelSource.includes("batchPlanningManaged"), "multi-shot composite units must not fall back to per-shot manual planning actions");
assert.ok(panelSource.includes("更新提示："));
assert.equal(panelSource.includes("STALE 影响范围"), false, "the creator-facing panel must not expose internal stale terminology");
assert.ok(panelSource.includes("完整故事板页"));
assert.ok(panelSource.includes("分镜宫格图"));
assert.ok(panelSource.includes("重新生成双版本"));
assert.ok(panelSource.includes("setStoryboardReferenceMode"));
assert.ok(panelSource.includes("整板采用"));
assert.ok(panelSource.includes("故事板已确认"));
assert.ok(panelSource.includes("进入摄影棚"));
assert.equal(panelSource.includes("重新生成当前画格"), false);

console.log("Manual video storyboard self-check passed.");
