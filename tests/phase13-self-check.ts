import assert from "node:assert/strict";
import { commitOperatorArtifactToProject } from "../src/services/operator/commit";
import {
  buildStyleLockChangeOrderFromCandidate,
  buildStyleReferenceAnalysis,
  buildVisualStyleLockCandidateFromAnalysis,
  validateStyleLockChangeOrder,
  validateStyleReferenceAnalysis,
  validateVisualStyleLockCandidate,
} from "../src/services/production/styleReference";
import type { StyleLockChangeOrder } from "../src/services/production/styleReference";
import { validateStoryboardStrategyDraft } from "../src/services/production/storyboardStrategyDraft";
import {
  buildStoryboardStrategyDraftTrial,
  validateStoryboardStrategyDraftTrial,
} from "../src/services/production/storyboardStrategyTrial";
import { buildProductionCockpit } from "../src/services/production/productionCockpit";
import { buildProductionVideoGenerationUnitDrafts } from "../src/services/production/videoStoryboardVideoUnits";
import {
  renderStoryboardBoardPrompt,
  validateStoryboardTemplateRender,
} from "../src/services/production/videoStoryboardTemplateRenderer";
import { runStyleStrategyCoordinationQA } from "../src/services/production/productionCoordination";
import { visualStyleContentHash } from "../src/services/production/visualStyleMigration";

export const runPhase13SelfCheck = (
  capabilityManifest: any,
  reportProgress: (stage: string) => void = () => undefined,
) => {
  assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy: any) => strategy.id === "storyboard.ai_video_control.v1"));
  assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy: any) => strategy.id === "storyboard.dance_choreography.v1"));
  assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy: any) => strategy.id === "storyboard.rhythm_sheet.v1"));
  assert.ok(capabilityManifest.videoStoryboardSystem.promptStrategies.some((strategy: any) => strategy.id === "storyboard.effect_reveal.v1"));
  assert.ok(capabilityManifest.videoStoryboardSystem.arrowLegend.some((entry: any) => entry.id === "sound_emotion_purple"));
  assert.ok(capabilityManifest.videoStoryboardSystem.arrowLegend.some((entry: any) => entry.id === "lighting_direction_orange"));
  assert.equal(capabilityManifest.videoStoryboardSystem.strategyCreationPolicy.allowProjectLocalDrafts, true);
  assert.equal(capabilityManifest.videoStoryboardSystem.strategyCreationPolicy.draftArtifactKind, "storyboard_strategy_draft");
  assert.ok(capabilityManifest.videoStoryboardSystem.strategyCreationPolicy.forbiddenShortcut.includes("create 'a storyboard'"));
  assert.ok(capabilityManifest.videoStoryboardSystem.storyboardAnnotationPolicy.defaultLegendIds.includes("sound_emotion_purple"));

  assert.equal(capabilityManifest.styleReferenceSystem.schemaVersion, "style-reference-system.v1");
  assert.ok(capabilityManifest.styleReferenceSystem.artifactKinds.includes("style_reference_analysis"));
  assert.ok(capabilityManifest.styleReferenceSystem.artifactKinds.includes("visual_style_lock_candidate"));
  assert.ok(capabilityManifest.styleReferenceSystem.artifactKinds.includes("style_lock_change_order"));
  assert.ok(capabilityManifest.styleReferenceSystem.qaFunctions.includes("validateStyleReferenceAnalysis"));
  assert.ok(capabilityManifest.styleReferenceSystem.approvalFlow.some((rule: string) => rule.includes("style_lock_change_order")));
  assert.equal(capabilityManifest.styleReferenceSystem.operatorApi.uploadReferenceImage, "POST /api/assets/upload");
  assert.equal(capabilityManifest.styleReferenceSystem.operatorApi.createAnalysisAndCandidate, "POST /api/operator/projects/:projectId/style-reference-analysis");
  assert.equal(capabilityManifest.styleReferenceSystem.operatorApi.createChangeOrder, "POST /api/operator/projects/:projectId/style-lock-change-orders");
  assert.ok(capabilityManifest.apiGroups.some((group: any) => group.routes.includes("POST /api/operator/projects/:projectId/style-reference-analysis")));
  assert.ok(capabilityManifest.apiGroups.some((group: any) => group.routes.includes("POST /api/operator/projects/:projectId/style-lock-change-orders")));
  assert.ok(capabilityManifest.apiGroups.some((group: any) => group.routes.includes("POST /api/operator/projects/:projectId/storyboard-strategy-trials")));
  assert.ok(capabilityManifest.apiGroups.some((group: any) => group.routes.includes("POST /api/operator/projects/:projectId/storyboard-strategy-promotions")));
  assert.equal(capabilityManifest.advancedVisualStyleLockSystem.schemaVersion, "advanced-visual-style-lock-system.v1");
  assert.ok(capabilityManifest.advancedVisualStyleLockSystem.lockedDimensions.includes("annotationLegend/boardAnnotationPolicy"));
  assert.ok(capabilityManifest.advancedVisualStyleLockSystem.promptInjectionPolicy.storyboardBoards.includes("StoryboardPromptStrategy"));
  assert.equal(capabilityManifest.storyboardStrategyDraftSystem.schemaVersion, "storyboard-strategy-draft-system.v1");
  assert.equal(capabilityManifest.storyboardStrategyDraftSystem.artifactKind, "storyboard_strategy_draft");
  assert.equal(capabilityManifest.storyboardStrategyDraftSystem.trialArtifactKind, "storyboard_strategy_draft_trial");
  assert.ok(capabilityManifest.storyboardStrategyDraftSystem.creationPolicy.some((rule: string) => rule.includes("built-in")));
  assert.equal(capabilityManifest.storyboardTemplateRendererSystem.schemaVersion, "storyboard-template-renderer-system.v1");
  assert.equal(capabilityManifest.storyboardTemplateRendererSystem.rendererFunction, "renderStoryboardBoardPrompt");
  assert.ok(capabilityManifest.storyboardTemplateRendererSystem.requiredBehavior.some((rule: string) => rule.includes("universal mega-prompt")));
  assert.equal(capabilityManifest.storyboardTemplateRendererSystem.rhythmTrackSystem.schemaVersion, "storyboard-rhythm-track-system.v1");
  assert.equal(capabilityManifest.storyboardTemplateRendererSystem.rhythmTrackSystem.builderFunction, "buildStoryboardRhythmTrack");
  assert.ok(capabilityManifest.storyboardTemplateRendererSystem.rhythmTrackSystem.activationPolicy.forbiddenShortcut.includes("genre names"));
  assert.deepEqual(capabilityManifest.storyboardTemplateRendererSystem.rhythmTrackSystem.lanes, ["shot", "action", "camera", "sound", "lighting", "state"]);
  assert.equal(capabilityManifest.storyboardStrategyTrialSystem.schemaVersion, "storyboard-strategy-trial-system.v1");
  assert.equal(capabilityManifest.storyboardStrategyTrialSystem.builderFunction, "buildStoryboardStrategyDraftTrial");
  assert.equal(capabilityManifest.storyboardStrategyTrialSystem.operatorApi.createTrial, "POST /api/operator/projects/:projectId/storyboard-strategy-trials");
  assert.equal(capabilityManifest.storyboardStrategyTrialSystem.operatorApi.createGlobalCandidate, "POST /api/operator/projects/:projectId/storyboard-strategy-promotions");
  assert.ok(capabilityManifest.storyboardStrategyTrialSystem.requiredBehavior.some((rule: string) => rule.includes("fallbackStrategyId")));
  assert.ok(capabilityManifest.productionCoordinationSystem.departments.includes("style_strategy"));
  assert.equal(capabilityManifest.productionCoordinationSystem.departmentQaAgents.style_strategy, "runStyleStrategyCoordinationQA");
  assert.ok(capabilityManifest.productionCoordinationSystem.coordinationTargets.includes("visual_style_lock_candidate"));
  assert.ok(capabilityManifest.productionCoordinationSystem.coordinationTargets.includes("style_lock_change_order"));
  assert.ok(capabilityManifest.productionCoordinationSystem.coordinationTargets.includes("storyboard_strategy_draft"));
  assert.ok(capabilityManifest.productionCoordinationSystem.coordinationTargets.includes("storyboard_strategy_draft_trial"));
  assert.ok(capabilityManifest.productionCoordinationSystem.requiredBehavior.some((rule: string) => rule.includes("styleLockVersion")));

  reportProgress("phase 13: style reference validation");
  const styleReferenceAnalysisSample = {
    schemaVersion: "style-reference-analysis.v1" as const,
    id: "style-analysis-sample",
    projectId: "style-project",
    sourceImageRefs: [{
      id: "ref-1",
      sourceType: "uploaded_image" as const,
      usageIntent: "style_only" as const,
      localPath: "/tmp/style-reference.png",
      rightsStatus: "user_provided" as const,
    }],
    extractedTraits: {
      renderingMode: "2d_animation",
      mediumSurface: ["rough pencil sketch"],
      linework: ["fast gesture lines", "clear silhouette"],
      colorPalette: ["black", "white", "annotation colors"],
      allowedHex: ["#111111", "#FFFFFF"],
      forbiddenColors: [],
      colorTemperature: ["neutral paper"],
      texture: ["paper grain"],
      lighting: ["simple light direction note"],
      lightSourceLogic: ["window light direction must be marked"],
      conditionalLighting: [],
      practicalLightRules: [],
      cameraLanguage: "dynamic handheld storyboard grammar",
      lensBias: ["24mm low angle", "50mm close-up"],
      movementBias: ["push-in", "follow"],
      framingBias: ["strong silhouette readability"],
      grain: ["light paper grain"],
      materialRendering: ["minimal shading"],
      compositionRules: ["large readable action shapes"],
      negativeSpaceRules: ["leave notes readable"],
      foregroundRules: ["use foreground only when it clarifies depth"],
      readabilityRules: ["panel must remain legible on mobile"],
      annotationLegend: [{
        id: "sound_emotion_purple",
        marker: "purple note",
        meaning: "sound or emotional emphasis",
      }],
      negativeStyleRules: ["no polished final render"],
      noSourceCopyRules: ["do not copy source character, scene, logo, watermark, or exact composition"],
      driftGuards: ["keep storyboard as control sketch"],
    },
    paletteSamples: ["black", "white", "red", "blue", "green", "orange", "purple"],
    lightingRead: ["simple window direction"],
    cameraRead: ["handheld, low angle, push-in"],
    lineworkRead: ["rough pencil line"],
    compositionRead: ["readable multi-panel layout"],
    noSourceCopyBoundaries: ["style only; no source character/scene/composition reuse"],
    confidence: 0.86,
    createdAt: Date.now(),
  };
  assert.deepEqual(validateStyleReferenceAnalysis(styleReferenceAnalysisSample), []);
  reportProgress("phase 13: style lock candidate validation");
  const styleLockCandidateSample = buildVisualStyleLockCandidateFromAnalysis(styleReferenceAnalysisSample);
  assert.deepEqual(validateVisualStyleLockCandidate(styleLockCandidateSample), []);
  const approvedStyleLock = {
    ...styleLockCandidateSample.candidateLock,
    visualImplementation: {
      productionMode: "2d_animation" as const,
      appearance: {
        realism: "stylized" as const,
        dimensionality: "flat_2d" as const,
        finish: "raw" as const,
        descriptors: ["rough pencil storyboard control drawing"],
      },
      techniques: ["hand-drawn storyboard control"],
      specification: {
        kind: "2d_animation" as const,
        animationMethod: "hand_drawn" as const,
        lineSystem: ["fast gesture lines with clear silhouettes"],
        colorApplication: ["sparse annotation colors on neutral paper"],
        depthStrategy: ["overlap and value separation for readable staging"],
        layoutAndBackground: ["authored staging layout on a neutral control background"],
        performanceAndCleanup: ["preserve acting intent, bounded deformation, and key/in-between/cleanup consistency"],
        motionCadence: ["key action states with directional arrows"],
        effectsAnimation: ["none; this control-drawing project declares no animated effects layer"],
        compositing: ["flat control layers kept legible on mobile"],
      },
    },
    treatment: {
      ...styleLockCandidateSample.candidateLock.treatment!,
      palette: ["black, white, and declared annotation colors"],
      color: ["neutral paper with restrained annotation accents"],
      linework: ["fast gesture lines with clear silhouettes"],
      lighting: ["simple window-light direction notes"],
      movement: ["push-in and follow movement annotations"],
      composition: ["large readable action shapes"],
      readability: ["every panel remains legible on mobile"],
      constraints: ["do not copy source subjects, scenes, logos, or exact composition"],
      directives: ["render a production control drawing, not a polished final frame"],
    },
    humanApprovalState: "approved" as const,
  };
  approvedStyleLock.contentHash = visualStyleContentHash(approvedStyleLock);
  const completeStyleChangeOrder = {
    schemaVersion: "style-lock-change-order.v1",
    id: "style-lock-change-order-sample",
    projectId: "style-project",
    sourceCandidateId: styleLockCandidateSample.id,
    baseRevision: styleLockCandidateSample.baseRevision,
    scope: "project",
    approvalState: "approved",
    approvedBy: "human-director",
    targetStyleLock: approvedStyleLock,
    affectedArtifactKinds: ["asset_identity_board", "storyboard_board", "asset_reference_pack", "video_generation_unit"],
    requiredReruns: ["production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
    rollbackPlan: "restore previous project.visualStyleLock and re-run affected artifact QA",
    createdAt: Date.now(),
  } satisfies StyleLockChangeOrder;
  assert.deepEqual(validateStyleLockChangeOrder(completeStyleChangeOrder), []);
  assert.ok(validateStyleLockChangeOrder({
    ...completeStyleChangeOrder,
    baseRevision: undefined,
  }).some((issue) => issue.target.endsWith("baseRevision") && issue.severity === "blocking"));
  const builtAnalysis = buildStyleReferenceAnalysis({
    id: "style-project",
    visualStyleLock: approvedStyleLock,
    creativeVision: { genre: ["short"], visualStyle: "rough pencil storyboard", narrativeStyle: "direct", tone: "kinetic", themes: [] },
  } as any, {
    sourceImageRefs: [{
      id: "uploaded-style-ref",
      sourceType: "uploaded_image",
      usageIntent: "style_only",
      localPath: "/tmp/uploaded-style-ref.png",
      rightsStatus: "user_provided",
      notes: "rough pencil line, black and white, red and blue arrows, window sunlight, 35mm handheld push-in",
    }],
    analysisText: "12 panel storyboard control sheet, purple sound notes, orange lighting direction, no polished final render",
  });
  assert.equal(validateStyleReferenceAnalysis(builtAnalysis).some((issue) => issue.severity === "blocking"), false);
  const builtCandidate = buildVisualStyleLockCandidateFromAnalysis(builtAnalysis, approvedStyleLock);
  assert.equal(validateVisualStyleLockCandidate(builtCandidate).some((issue) => issue.severity === "blocking"), false);
  const builtChangeOrder = buildStyleLockChangeOrderFromCandidate(builtCandidate, {
    approvalState: "approved",
    approvedBy: "human-director",
  });
  assert.deepEqual(validateStyleLockChangeOrder(builtChangeOrder), []);
  reportProgress("phase 13: style lock commit");
  const commitResult = commitOperatorArtifactToProject({
    id: "style-project",
    title: "Style Project",
    type: "short-drama",
    aspectRatio: "16:9",
    logline: "sample",
    coreConflict: "sample",
    characters: [],
    episodes: [],
    assets: [],
    visualStyleLock: approvedStyleLock,
  } as any, {
    id: "artifact-style-change-order",
    runId: "run-style",
    projectId: "style-project",
    kind: "style_lock_change_order",
    targetPath: "operator.styleLockChangeOrders.sample",
    entityIds: ["style-project", builtCandidate.id],
    status: "approved",
    data: { styleLockChangeOrder: builtChangeOrder },
    qaVerdicts: [{
      qaAgentId: "operator.artifact.style_lock_change_order.qa",
      status: "passed",
      blocking: false,
      score: 100,
      issues: [],
      nextAction: "commit",
      createdAt: Date.now(),
    }],
    provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  assert.equal(commitResult.project.visualStyleLock?.humanApprovalState, "approved");
  assert.equal(commitResult.project.visualStyleLock?.source, "style_reference_analysis");
  assert.ok(commitResult.project.styleLockChangeLog?.some((entry) => entry.id === builtChangeOrder.id));
  assert.throws(() => commitOperatorArtifactToProject({
    id: "style-project",
    title: "Style Project",
    type: "short-drama",
    characters: [],
    episodes: [],
    assets: [],
  } as any, {
    id: "artifact-forged-approved-style-change-order",
    runId: "run-style",
    projectId: "style-project",
    kind: "style_lock_change_order",
    targetPath: "operator.styleLockChangeOrders.forged",
    entityIds: ["style-project", builtCandidate.id],
    status: "approved",
    data: { styleLockChangeOrder: builtChangeOrder },
    qaVerdicts: [],
    provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any), /pass non-blocking QA/);
  assert.throws(() => commitOperatorArtifactToProject({
    id: "style-project",
    title: "Style Project",
    type: "short-drama",
    characters: [],
    episodes: [],
    assets: [],
  } as any, {
    id: "artifact-invalid-style-change-order",
    runId: "run-style",
    projectId: "style-project",
    kind: "style_lock_change_order",
    targetPath: "operator.styleLockChangeOrders.invalid",
    entityIds: ["style-project", builtCandidate.id],
    status: "approved",
    data: {
      styleLockChangeOrder: {
        ...builtChangeOrder,
        approvedBy: undefined,
        requiredReruns: [],
        rollbackPlan: "",
      },
    },
    qaVerdicts: [{
      qaAgentId: "operator.artifact.style_lock_change_order.qa",
      status: "passed",
      blocking: false,
      score: 100,
      issues: [],
      nextAction: "commit",
      createdAt: Date.now(),
    }],
    provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any), /blocking QA issues/);
  reportProgress("phase 13: style coordination QA");
  const resolvedStyleCandidateFinding = runStyleStrategyCoordinationQA({
    project: commitResult.project,
    episodes: [],
    operatorArtifacts: [{
      id: "artifact-style-lock-candidate-resolved",
      runId: "run-style",
      projectId: "style-project",
      kind: "visual_style_lock_candidate",
      targetPath: "operator.styleLockCandidates.resolved",
      entityIds: ["style-project", builtCandidate.id],
      status: "approved",
      data: { visualStyleLockCandidate: builtCandidate },
      qaVerdicts: [],
      provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, {
      id: "artifact-style-change-order-committed",
      runId: "run-style",
      projectId: "style-project",
      kind: "style_lock_change_order",
      targetPath: "operator.styleLockChangeOrders.committed",
      entityIds: ["style-project", builtCandidate.id],
      status: "committed",
      data: { styleLockChangeOrder: builtChangeOrder },
      qaVerdicts: [],
      provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    stageType: "storyboard",
    environment: "test",
    capturedAt: Date.now(),
  } as any);
  assert.equal(resolvedStyleCandidateFinding.status, "passed");
  assert.equal(resolvedStyleCandidateFinding.message.includes("尚未通过 style_lock_change_order"), false);
  reportProgress("phase 13: storyboard provenance drafts");
  const storyboardProvenanceDrafts = buildProductionVideoGenerationUnitDrafts({
    id: "style-project",
    title: "Style Provenance Project",
    type: "short-drama",
    aspectRatio: "16:9",
    logline: "sample",
    coreConflict: "sample",
    visualStyleLock: {
      version: "visual-style-lock.phase13.test",
      renderingMode: "line_art_control",
      styleKeywords: ["rough pencil storyboard"],
      noSourceCopyRules: ["style only"],
      styleSourceRefs: ["uploaded-style-ref"],
    },
    characters: [{
      id: "char-a",
      name: "A",
      referenceImageUrl: "/tmp/char-a.png",
    }],
    assets: [{
      id: "loc-room",
      type: "location",
      name: "Room",
      imageUrl: "/tmp/room.png",
    }, {
      id: "prop-clock",
      type: "prop",
      name: "Clock",
      imageUrl: "/tmp/clock.png",
    }],
    episodes: [],
  } as any, [{
    id: "ep-1",
    title: "Episode 1",
    scenes: [{
      id: "scene-1",
      title: "Morning Beat",
      description: "A wakes up and reaches for the clock.",
      valueCharge: "positive",
      breakdown: {
        characterIds: ["char-a"],
        locationId: "loc-room",
        propIds: ["prop-clock"],
      },
      shots: [{
        id: "shot-1",
        visualAction: "A pushes up from bed and reaches toward the clock.",
        blocking: "A moves from bed edge to desk.",
        cameraMovement: "slow push-in",
        shotSize: "MS",
        cameraAngle: "low angle",
        focalLength: "35mm",
        composition: "negative space at right for notes",
        duration: 4,
        characterIdsInShot: ["char-a"],
        locationId: "loc-room",
        propIds: ["prop-clock"],
        continuityNote: "clock remains on desk",
      }],
    }],
  }] as any);
  assert.equal(storyboardProvenanceDrafts.issues.some((issue) => issue.severity === "blocking"), false);
  assert.ok(storyboardProvenanceDrafts.storyboardBoards.every((board) => board.styleLockVersion === "visual-style-lock.phase13.test"));
  assert.ok(storyboardProvenanceDrafts.storyboardBoards.every((board) => board.strategyOrigin === "built_in"));
  assert.ok(storyboardProvenanceDrafts.storyboardBoards.some((board) => board.panels.some((panel) => panel.annotationLegendIds?.includes("shot_note_black"))));
  assert.ok(storyboardProvenanceDrafts.assetReferencePacks.every((pack) => pack.styleLockVersion === "visual-style-lock.phase13.test"));
  assert.ok(storyboardProvenanceDrafts.videoGenerationUnits.every((unit) => unit.styleLockVersion === "visual-style-lock.phase13.test"));
  assert.ok(storyboardProvenanceDrafts.videoGenerationUnits.every((unit) => unit.visualStyleCompileManifest?.intent === "video_clip"), "video units must retain video_clip projection lineage");
  assert.ok(storyboardProvenanceDrafts.videoGenerationUnits.every((unit) => !/production video clip|storyboard control drawing|\[Visual artifact\]/.test(unit.videoPrompt)), "video unit content prompts must not embed a visual projection that the execution adapter will compile again");
  assert.ok(storyboardProvenanceDrafts.videoGenerationUnits.every((unit) => unit.storyboardStrategyOrigin === "built_in"));
  assert.ok(storyboardProvenanceDrafts.videoGenerationUnits.some((unit) => unit.annotationLegendIds?.includes("shot_note_black")));
  reportProgress("phase 13: storyboard prompt render");
  const rendererVisualStyleLock = {
    ...approvedStyleLock,
    version: "visual-style-lock.phase13.test",
    treatment: {
      ...approvedStyleLock.treatment,
      linework: ["rough pencil storyboard"],
    },
  };
  rendererVisualStyleLock.contentHash = visualStyleContentHash(rendererVisualStyleLock);
  const renderedStoryboardPrompt = renderStoryboardBoardPrompt({
    project: {
      id: "style-project",
      title: "Style Renderer Project",
      type: "short-drama",
      aspectRatio: "16:9",
      logline: "sample",
      coreConflict: "sample",
      characters: [],
      assets: [],
      visualStyleLock: rendererVisualStyleLock,
    } as any,
    scene: {
      id: "scene-1",
      title: "Morning Beat",
      description: "A wakes up and reaches for the clock.",
      shots: [{ id: "shot-1", visualAction: "A reaches for the clock.", duration: 4 }],
    } as any,
    board: storyboardProvenanceDrafts.storyboardBoards[0],
  });
  reportProgress(`phase 13: storyboard prompt rendered (${renderedStoryboardPrompt.prompt.length} chars)`);
  assert.deepEqual(validateStoryboardTemplateRender(renderedStoryboardPrompt), []);
  reportProgress("phase 13: storyboard prompt validated");
  assert.equal(renderedStoryboardPrompt.schemaVersion, "storyboard-template-render.v1");
  assert.ok(renderedStoryboardPrompt.prompt.includes("【Panel 合同】"), "the rendered prompt must retain the panel contract");
  assert.ok(renderedStoryboardPrompt.prompt.includes("【项目视觉规范 · 故事板控制投影】"), "the rendered prompt must retain its recipe-scoped human-readable visual standard");
  assert.ok(renderedStoryboardPrompt.prompt.includes("rough pencil storyboard"), "the rendered prompt must retain approved style content");
  assert.ok(renderedStoryboardPrompt.prompt.includes("黑色文字"), "the rendered prompt must explain the black shot-note annotation in readable language");
  assert.equal(renderedStoryboardPrompt.prompt.includes("styleLockVersion"), false);
  assert.equal(renderedStoryboardPrompt.prompt.includes("shot_note_black"), false);
  const styleCockpitArtifact = (kind: string, data: unknown) => ({
    id: `artifact-${kind}`,
    runId: "run-style-cockpit",
    projectId: "style-project",
    kind,
    targetPath: `operator.phase13.${kind}`,
    entityIds: ["style-project", "ep-1", "scene-1"],
    status: "approved",
    data,
    qaVerdicts: [],
    provenance: {
      provider: "codex",
      handbookVersion: "test",
      source: "operator",
      generatedAt: Date.now(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  reportProgress("phase 13: style cockpit");
  const styleCockpit = buildProductionCockpit({
    project: {
      id: "style-project",
      title: "Style Cockpit Project",
      type: "short-drama",
      aspectRatio: "16:9",
      logline: "sample",
      coreConflict: "sample",
      characters: [],
      assets: [],
      visualStyleLock: {
        version: "visual-style-lock.phase13.test",
        humanApprovalState: "approved",
        renderingMode: "line_art_control",
        styleKeywords: ["rough pencil storyboard"],
        noSourceCopyRules: ["style only"],
        styleSourceRefs: ["uploaded-style-ref"],
      },
    } as any,
    episodes: [{
      id: "ep-1",
      title: "Episode 1",
      scenes: [{
        id: "scene-1",
        title: "Morning Beat",
        shots: [{ id: "shot-1", visualAction: "A reaches for the clock.", duration: 4 }],
      }],
    }] as any,
    operatorArtifacts: [
      styleCockpitArtifact("storyboard_board", { storyboardBoards: storyboardProvenanceDrafts.storyboardBoards }),
      styleCockpitArtifact("asset_reference_pack", { assetReferencePacks: storyboardProvenanceDrafts.assetReferencePacks }),
      styleCockpitArtifact("video_generation_unit", { videoGenerationUnits: storyboardProvenanceDrafts.videoGenerationUnits }),
    ],
    stageType: "prompt",
    environment: "test",
    capturedAt: Date.now(),
  });
  assert.equal(styleCockpit.styleStrategy.styleLockVersion, "visual-style-lock.phase13.test");
  assert.equal(styleCockpit.styleStrategy.styleLockApprovalState, "approved");
  assert.equal(styleCockpit.styleStrategy.storyboardBoardCount, storyboardProvenanceDrafts.storyboardBoards.length);
  assert.equal(styleCockpit.styleStrategy.assetReferencePackCount, storyboardProvenanceDrafts.assetReferencePacks.length);
  assert.equal(styleCockpit.styleStrategy.videoGenerationUnitCount, storyboardProvenanceDrafts.videoGenerationUnits.length);
  assert.equal(styleCockpit.styleStrategy.styleStrategyFindings.some((finding) => finding.severity === "blocking"), false);
  reportProgress("phase 13: project-local strategy draft");
  const projectLocalStoryboardDraft = {
    schemaVersion: "storyboard-strategy-draft.v1" as const,
    id: "storyboard.project_local.dance_room_sample.v1",
    projectId: "style-project",
    scope: "project_local" as const,
    status: "draft" as const,
    name: "卧室舞蹈局部故事板",
    boardMode: "dance_choreography" as const,
    promptTemplateId: "storyboard.board.danceChoreography",
    inheritsFromStrategyIds: ["storyboard.dance_choreography.v1", "storyboard.ai_video_control.v1"],
    gapStatement: "当前视频单元需要同时表达身体重心、音乐节拍、镜头运动和最终定格，普通动作连续板不足以约束舞蹈节奏。",
    requiredCapabilityIds: ["narrative:dance", "control:body_rhythm", "control:camera_motion"],
    coveredCapabilityIds: ["narrative:dance", "control:body_rhythm", "control:camera_motion"],
    recommendedWhen: ["室内街舞", "音乐节拍驱动的动作"],
    avoidWhen: ["静态对白", "纯效果揭示"],
    requiredInputs: ["choreographyBeats", "musicOrSoundBeats", "cameraRhythm"],
    outputContract: ["12-20 格", "身体轨迹", "节拍标注", "最终定格"],
    panelContractFields: ["panelNumber", "framePurpose", "subjectAction", "cameraMove", "continuityIn", "continuityOut"],
    annotationLegendIds: ["subject_action_red", "camera_motion_blue", "sound_emotion_purple", "lighting_direction_orange", "shot_note_black"],
    qaChecklist: ["动作不静态", "节拍清楚", "镜头不过密"],
    modelCompatibilityTags: ["dance", "rhythm", "line-art-control"],
    fallbackStrategyId: "storyboard.dance_choreography.v1",
    sampleSceneIds: [],
    createdAt: Date.now(),
  };
  assert.deepEqual(validateStoryboardStrategyDraft(projectLocalStoryboardDraft), []);

  const approvedProjectLocalStoryboardDraft = {
    ...projectLocalStoryboardDraft,
    status: "approved" as const,
    sampleSceneIds: ["scene-1"],
  };
  assert.deepEqual(validateStoryboardStrategyDraft(approvedProjectLocalStoryboardDraft), []);
  reportProgress("phase 13: storyboard strategy trial");
  const storyboardStrategyTrial = buildStoryboardStrategyDraftTrial({
    project: {
      id: "style-project",
      title: "Storyboard Trial Project",
      type: "short-drama",
      aspectRatio: "16:9",
      logline: "sample",
      coreConflict: "sample",
      characters: [{
        id: "char-a",
        name: "A",
        referenceImageUrl: "/tmp/char-a.png",
      }],
      assets: [{
        id: "loc-room",
        type: "location",
        name: "Room",
        imageUrl: "/tmp/room.png",
      }],
      visualStyleLock: {
        version: "visual-style-lock.phase13.test",
        renderingMode: "line_art_control",
        styleKeywords: ["rough pencil storyboard", "dance rhythm marks"],
        noSourceCopyRules: ["style only"],
        styleSourceRefs: ["uploaded-style-ref"],
      },
    } as any,
    episodes: [{
      id: "ep-1",
      title: "Episode 1",
      scenes: [{
        id: "scene-1",
        title: "Bedroom Dance Trial",
        description: "A dances through the bedroom with a strong beat and a final freeze pose.",
        valueCharge: "positive",
        breakdown: {
          characterIds: ["char-a"],
          locationId: "loc-room",
          propIds: [],
        },
        shots: [{
          id: "shot-1",
          visualAction: "A performs fast footwork, spins, and lands in a final freeze pose.",
          blocking: "A crosses the floor from bed edge to window light.",
          cameraMovement: "handheld push-in with circular move",
          shotSize: "MS",
          cameraAngle: "low angle",
          focalLength: "35mm",
          composition: "negative space for rhythm and camera annotations",
          duration: 12,
          characterIdsInShot: ["char-a"],
          locationId: "loc-room",
          propIds: [],
          continuityNote: "A begins standing near the bed and ends frozen in the window light.",
        }],
      }],
    }] as any,
    draft: approvedProjectLocalStoryboardDraft,
    createdAt: 1700000000000,
  });
  assert.deepEqual(validateStoryboardStrategyDraftTrial(storyboardStrategyTrial), []);
  assert.equal(storyboardStrategyTrial.schemaVersion, "storyboard-strategy-draft-trial.v1");
  assert.equal(storyboardStrategyTrial.status, "passed");
  assert.equal(storyboardStrategyTrial.renderedBoards.length, 1);
  assert.equal(storyboardStrategyTrial.renderedBoards[0].templateId, "storyboard.board.danceChoreography");
  assert.ok(storyboardStrategyTrial.renderedBoards[0].renderedStrategyId.includes("storyboard.project_local.dance_room_sample.v1"));
  assert.equal(storyboardStrategyTrial.renderedBoards[0].warnings.length, 0);
  const globalCandidateStoryboardDraft = {
    ...approvedProjectLocalStoryboardDraft,
    id: "global_candidate.storyboard.project_local.dance_room_sample.v1",
    scope: "global_candidate" as const,
    status: "approved" as const,
    promotionNotes: "Evidence: storyboard_strategy_trial_storyboard.project_local.dance_room_sample.v1_1700000000000",
  };
  reportProgress("phase 13: strategy cockpit");
  const strategyCockpit = buildProductionCockpit({
    project: {
      id: "style-project",
      title: "Strategy Cockpit Project",
      type: "short-drama",
      aspectRatio: "16:9",
      logline: "sample",
      coreConflict: "sample",
      characters: [],
      assets: [],
      visualStyleLock: {
        version: "visual-style-lock.phase13.test",
        humanApprovalState: "approved",
        renderingMode: "line_art_control",
        styleKeywords: ["rough pencil storyboard"],
        noSourceCopyRules: ["style only"],
        styleSourceRefs: ["uploaded-style-ref"],
      },
    } as any,
    episodes: [{
      id: "ep-1",
      title: "Episode 1",
      scenes: [{
        id: "scene-1",
        title: "Bedroom Dance Trial",
        shots: [{ id: "shot-1", visualAction: "A performs a final freeze pose.", duration: 12 }],
      }],
    }] as any,
    operatorArtifacts: [
      styleCockpitArtifact("storyboard_strategy_draft", { storyboardStrategyDraft: approvedProjectLocalStoryboardDraft }),
      {
        ...styleCockpitArtifact("storyboard_strategy_draft", { storyboardStrategyDraft: globalCandidateStoryboardDraft }),
        id: "artifact-storyboard_strategy_draft-global-candidate",
        targetPath: "operator.phase13.storyboard_strategy_draft.global",
      },
      styleCockpitArtifact("storyboard_strategy_draft_trial", { storyboardStrategyDraftTrial: storyboardStrategyTrial }),
    ],
    stageType: "storyboard",
    environment: "test",
    capturedAt: Date.now(),
  });
  assert.equal(strategyCockpit.styleStrategy.strategyDraftCount, 2);
  assert.equal(strategyCockpit.styleStrategy.approvedStrategyDraftCount, 2);
  assert.equal(strategyCockpit.styleStrategy.strategyTrialCount, 1);
  assert.equal(strategyCockpit.styleStrategy.passedStrategyTrialCount, 1);
  assert.equal(strategyCockpit.styleStrategy.promotionCandidateCount, 1);
};
