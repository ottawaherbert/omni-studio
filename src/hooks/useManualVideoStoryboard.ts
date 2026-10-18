import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { generateAIContent } from "../clients/aiClient";
import { Type } from "../clients/aiSchemaClient";
import { flushDebouncedProjectSave, useAIConfigStore, useProjectStore } from "../clients/stateClient";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import type {
  Episode,
  ManualStoryboardBoardQA,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardPromptAudit,
  ManualStoryboardStrategyDecision,
  Project,
  Scene,
  Shot,
} from "../clients/domainTypes";
import type { ManualFilmTeamReadModel } from "../clients/productionPreparationWorkflowClient";
import type { ManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  buildStoryboardUnitVideoPromptRecord,
  buildStoryboardUnitVideoPromptSourceHash,
} from "../clients/productionStoryboardWorkflowClient";
import {
  buildManualBoardOutputHash,
  buildManualBoardQASourceHash,
  buildManualBoardSourceHash,
  buildManualStoryboardModelCatalog,
  buildManualStoryboardStrategyCatalog,
  buildManualStoryboardStrategyContext,
  buildManualVideoStoryboardReadModel,
  normalizeManualStoryboardBoard,
  normalizeManualStoryboardQA,
  normalizeManualStoryboardStrategy,
  projectShotForManualStoryboardPrompt,
  upsertManualStoryboardBoardWorkflow,
  validateManualStoryboardBoard,
  validateManualStoryboardStrategy,
  type ManualVideoStoryboardIssue,
} from "../clients/productionStoryboardWorkflowClient";
import { getStoryboardPromptStrategyById } from "../clients/productionStoryboardWorkflowClient";
import { manualStoryboardHash } from "../clients/productionStoryboardWorkflowClient";
import { appearanceSourceShots, requireAppearanceReady } from "../clients/productionStoryboardWorkflowClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  approveStoryboardPanelVisualTake,
  buildStoryboardPanelVisualSourceHash,
  selectStoryboardPanelVisualReferences,
} from "../clients/productionStoryboardWorkflowClient";
import {
  adoptStoryboardBoardVisualTake,
  buildStoryboardCompositeBoardSourceHash,
  buildStoryboardCompositeVisualPages,
  mergeStoryboardShotGridPageResult,
  composeStoryboardShotGridPage,
  scopeStoryboardCompositeBoardToPage,
  selectStoryboardCompositeBoardReferences,
  STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION,
} from "../clients/productionStoryboardWorkflowClient";
import { safeParseAIResponse } from "../utils/aiParser";
import { summarizeUnknownError } from "../utils/logging";
import { projectStoryboardRepairQuality } from "../clients/productionStoryboardWorkflowClient";
import { renderStoryboardShotGrid } from "../clients/productionAssetWorkflowClient";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";

export type ManualVideoStoryboardAction = "strategy" | "board" | "qa";

export interface ManualVideoStoryboardPromptRequest {
  action: ManualVideoStoryboardAction;
  templateId: string;
  title: string;
  variables: Record<string, string>;
}

export type ManualVideoStoryboardCandidate =
  | { kind: "strategy"; decision: ManualStoryboardStrategyDecision; audit: ManualStoryboardPromptAudit; sourceHash: string; issues: ManualVideoStoryboardIssue[] }
  | { kind: "board"; workflow: Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board">; audit: ManualStoryboardPromptAudit; sourceHash: string; issues: ManualVideoStoryboardIssue[] }
  | { kind: "qa"; qa: ManualStoryboardBoardQA; issues: ManualVideoStoryboardIssue[] };

interface UseManualVideoStoryboardOptions {
  project: Project;
  episode: Episode;
  scene: Scene;
  shot: Shot | null;
  workflowOverride?: ManualStoryboardBoardWorkflow;
  storyboardSourceHash?: string;
  upstreamReady: boolean;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
}

const strategySchema = {
  type: Type.OBJECT,
  properties: {
    selectedStrategyId: { type: Type.STRING },
    selectedStrategyVersion: { type: Type.STRING },
    selectedModelProfileId: { type: Type.STRING },
    rationale: { type: Type.STRING },
    rejectedStrategyIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    riskNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    expectedBoardShape: { type: Type.STRING },
    expectedVideoUnitDurationSeconds: { type: Type.NUMBER },
    expectedReferenceImageCount: { type: Type.NUMBER },
    expectedReferenceVideoCount: { type: Type.NUMBER },
    arrowLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    qaChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
    strategyResolution: {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING },
        primaryStrategyId: { type: Type.STRING },
        modifierStrategyIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        requiredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        coveredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        uncoveredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        fallbackStrategyId: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        requiresHumanApproval: { type: Type.BOOLEAN },
        maxAutomaticRevisionAttempts: { type: Type.NUMBER },
      },
    },
  },
  required: ["selectedStrategyId", "selectedStrategyVersion", "selectedModelProfileId", "rationale", "expectedBoardShape", "expectedVideoUnitDurationSeconds", "expectedReferenceImageCount", "expectedReferenceVideoCount", "arrowLegendIds", "qaChecklist"],
};

const boardSchema = {
  type: Type.OBJECT,
  properties: {
    performanceBeat: {
      type: Type.OBJECT,
      properties: {
        scriptBlockIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        beatType: { type: Type.STRING },
        summary: { type: Type.STRING },
        visibleChange: { type: Type.STRING },
        startState: { type: Type.STRING },
        endState: { type: Type.STRING },
        durationSeconds: { type: Type.NUMBER },
        characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        locationId: { type: Type.STRING },
        propIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        soundCues: { type: Type.ARRAY, items: { type: Type.STRING } },
        continuityIn: { type: Type.STRING },
        continuityOut: { type: Type.STRING },
      },
      required: ["beatType", "summary", "visibleChange", "startState", "endState", "durationSeconds", "characterIds", "propIds", "soundCues", "continuityIn", "continuityOut"],
    },
    board: {
      type: Type.OBJECT,
      properties: {
        layout: { type: Type.STRING },
        lineArtPrompt: { type: Type.STRING },
        startState: { type: Type.STRING },
        endState: { type: Type.STRING },
        panels: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              durationSeconds: { type: Type.NUMBER },
              framePurpose: { type: Type.STRING },
              shotType: { type: Type.STRING },
              visualBeat: { type: Type.STRING },
              cameraNote: { type: Type.STRING },
              framing: { type: Type.STRING },
              lens: { type: Type.STRING },
              angle: { type: Type.STRING },
              cameraMove: { type: Type.STRING },
              subjectAction: { type: Type.STRING },
              blocking: { type: Type.STRING },
              lightingCue: { type: Type.STRING },
              soundCue: { type: Type.STRING },
              emotionCue: { type: Type.STRING },
              compositionNote: { type: Type.STRING },
              continuityIn: { type: Type.STRING },
              continuityOut: { type: Type.STRING },
              assetRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
              annotationLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionArrowLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              dialogueOrSoundCue: { type: Type.STRING },
              renderInstruction: { type: Type.STRING },
            },
            required: ["framePurpose", "visualBeat", "cameraNote", "subjectAction", "continuityIn", "continuityOut", "assetRefs", "annotationLegendIds", "actionArrowLegendIds"],
          },
        },
      },
      required: ["layout", "lineArtPrompt", "startState", "endState", "panels"],
    },
  },
  required: ["performanceBeat", "board"],
};

const qaSchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    verdict: { type: Type.STRING },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING },
          description: { type: Type.STRING },
          suggestion: { type: Type.STRING },
        },
        required: ["severity", "description", "suggestion"],
      },
    },
  },
  required: ["score", "verdict", "summary", "strengths", "issues"],
};

export function useManualVideoStoryboard({
  project,
  episode,
  scene,
  shot,
  workflowOverride,
  storyboardSourceHash,
  upstreamReady,
  filmTeam,
  assets,
  updateScene,
}: UseManualVideoStoryboardOptions) {
  const [promptRequest, setPromptRequest] = useState<ManualVideoStoryboardPromptRequest | null>(null);
  const [candidate, setCandidate] = useState<ManualVideoStoryboardCandidate | null>(null);
  const [runningAction, setRunningAction] = useState<ManualVideoStoryboardAction | null>(null);
  const [composingGridPageId, setComposingGridPageId] = useState<string | null>(null);
  const readModel = useMemo(() => shot && storyboardSourceHash
    ? buildManualVideoStoryboardReadModel({ workflows: scene.manualStoryboard?.boards, workflowOverride, shot, storyboardSourceHash, project, assets, scene })
    : null, [assets, project, scene, shot, storyboardSourceHash, workflowOverride]);
  const allowedAssetIds = useMemo(() => Array.from(new Set(assets.assetBoards.map((item) => item.assetId))), [assets.assetBoards]);
  const strategyContext = useMemo(() => shot ? buildManualStoryboardStrategyContext({
    shot,
    projectFormat: project.type,
    aspectRatio: project.aspectRatio,
    referenceImageCount: assets.assetBoards.filter((item) => item.referenceImageUrl).length,
  }) : null, [assets.assetBoards, project.aspectRatio, project.type, shot]);
  const filmTeamContext = useMemo(() => {
    const scenePlans = (episode.productionTeam?.outputs || [])
      .filter((output) => output.status === "confirmed")
      .map((output) => {
        const scenePlan = output.scenePlans?.find((item) => item.sceneId === scene.id);
        if (!scenePlan) return null;
        return {
          department: output.department,
          scenePlan: {
            summary: scenePlan.summary,
            executionNotes: scenePlan.executionNotes,
            assetNeeds: scenePlan.assetNeeds,
            continuityNotes: scenePlan.continuityNotes,
            handoffNotes: scenePlan.handoffNotes,
          },
        };
      }).filter(Boolean);
    return scenePlans.length ? JSON.stringify(scenePlans, null, 2) : "";
  }, [episode.productionTeam?.outputs, scene.id]);
  const assetContext = useMemo(() => JSON.stringify({
    sceneStates: assets.sceneStates.map((item) => ({
      assetId: item.assetId,
      assetType: item.assetType,
      assetName: item.assetName,
      variantId: item.variantId,
      stateSummary: item.stateSummary,
    })),
    sceneVisualPack: assets.sceneVisualPack ? {
      location: assets.sceneVisualPack.location,
      characters: assets.sceneVisualPack.characters,
      props: assets.sceneVisualPack.props,
      continuityIn: assets.sceneVisualPack.continuityIn,
      continuityOut: assets.sceneVisualPack.continuityOut,
      referenceSlots: assets.sceneVisualPack.referenceSlots.map(({ referenceImageUrl, ...slot }) => ({
        ...slot,
        hasReferenceImage: Boolean(referenceImageUrl),
      })),
    } : undefined,
    assetReferencePack: assets.assetReferencePack ? {
      modelProfileId: assets.assetReferencePack.modelProfileId,
      purpose: assets.assetReferencePack.purpose,
      maxReferenceImages: assets.assetReferencePack.maxReferenceImages,
      maxReferenceVideos: assets.assetReferencePack.maxReferenceVideos,
      items: assets.assetReferencePack.items.map(({ referenceImageUrl, ...item }) => ({
        ...item,
        hasReferenceImage: Boolean(referenceImageUrl),
      })),
    } : undefined,
    formalAssets: assets.assetBoards.map((item) => ({
      assetId: item.assetId,
      assetType: item.assetType,
      assetName: item.assetName,
      variantId: item.variantId,
      variantName: item.variantName,
      hasReferenceImage: Boolean(item.referenceImageUrl),
    })),
  }, null, 2), [assets]);

  const prepareAction = (action: ManualVideoStoryboardAction) => {
    if (!shot || !readModel || !strategyContext) return;
    if (!upstreamReady) {
      toast.error("请先确认 Shot、视觉提示词和正式资产，再制作视频故事板。");
      return;
    }
    if (action === "strategy") {
      setPromptRequest({
        action,
        templateId: "storyboard.strategy.select",
        title: "选择当前视频单元故事板策略 - 提示词确认",
        variables: {
          strategyCatalog: JSON.stringify(buildManualStoryboardStrategyCatalog(), null, 2),
          modelProfiles: JSON.stringify(buildManualStoryboardModelCatalog(), null, 2),
          productionMemory: JSON.stringify({
            projectType: project.type,
            projectModel: project.projectModel,
            aspectRatio: project.aspectRatio,
          }, null, 2),
          assetContinuity: assetContext,
          performanceContext: JSON.stringify({
            shot: projectShotForManualStoryboardPrompt(shot),
            structuredContext: strategyContext,
          }, null, 2),
        },
      });
      return;
    }
    const workflow = readModel.workflow;
    if (!workflow?.strategyDecision || !readModel.boardSourceHash || readModel.strategyStatus !== "ready") {
      toast.error("请先选择并采用当前视频单元的故事板策略。");
      return;
    }
    if (action === "board") {
      const definition = getStoryboardPromptStrategyById(workflow.strategyDecision.selectedStrategyId);
      setPromptRequest({
        action,
        templateId: "storyboard.board.plan",
        title: `${workflow.board ? "重新生成" : "生成"}当前视频单元故事板 - 提示词确认`,
        variables: {
          strategyDecision: JSON.stringify(workflow.strategyDecision, null, 2),
          strategyDefinition: JSON.stringify(definition || {}, null, 2),
          shotContext: JSON.stringify(projectShotForManualStoryboardPrompt(shot), null, 2),
          filmTeamContext,
          assetContext,
          qaContext: workflow.qa
            ? JSON.stringify(projectStoryboardRepairQuality(workflow.qa), null, 2)
            : "",
          visualPanelContract: JSON.stringify({
            version: STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION,
            mode: "一张图片包含多格镜头的完整故事板页",
            referencePolicy: "只使用当前视频单元正式资产参考锁定身份与状态；缺失参考时只能生成待审构图草案。",
            renderPolicy: "一次调用生成整张故事板页；panel 只保存结构化镜头元数据，不逐格生成独立正式图片。",
          }, null, 2),
        },
      });
      return;
    }
    if (!workflow.board || !workflow.performanceBeat || readModel.boardStatus !== "ready" || !readModel.qaSourceHash) {
      toast.error("请先生成并采用当前视频单元的故事板。");
      return;
    }
    setPromptRequest({
      action,
      templateId: "storyboard.board.qa",
      title: "当前视频单元故事板质检 - 提示词确认",
      variables: {
        shotContext: JSON.stringify(projectShotForManualStoryboardPrompt(shot), null, 2),
        strategyDecision: JSON.stringify(workflow.strategyDecision, null, 2),
        boardContext: JSON.stringify({ performanceBeat: workflow.performanceBeat, board: workflow.board }, null, 2),
        assetContext,
        filmTeamContext,
      },
    });
  };

  const executePrompt = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!promptRequest || !shot || !readModel || !strategyContext) return;
    if (!upstreamReady) {
      toast.error("上游状态已变化，本次执行已取消。");
      return;
    }
    const action = promptRequest.action;
    setRunningAction(action);
    try {
      const response = await generateAIContent({
        taskType: "storyboardGen",
        prompt: finalPrompt,
        requireJson: true,
        schema: action === "strategy" ? strategySchema : action === "board" ? boardSchema : qaSchema,
      });
      const parsed = safeParseAIResponse<unknown>(response, {});
      const now = Date.now();
      const audit: ManualStoryboardPromptAudit = {
        action: action === "strategy" ? "select_board_strategy" : action === "board" ? "generate_board" : "qa_board",
        templateId: promptRequest.templateId,
        promptHash: manualStoryboardHash(finalPrompt),
        modelId: useAIConfigStore.getState().routing.storyboardGen,
        selectedSkillIds: metadata?.selectedSkillIds || [],
        selectedSkillTitles: metadata?.selectedSkillTitles || [],
        selectedContextIds: metadata?.selectedContextIds || [],
        createdAt: now,
      };
      if (action === "strategy") {
        const decision = normalizeManualStoryboardStrategy(parsed);
        setCandidate({ kind: "strategy", decision, audit, sourceHash: readModel.strategySourceHash, issues: validateManualStoryboardStrategy(decision, strategyContext) });
      } else if (action === "board") {
        const decision = readModel.workflow?.strategyDecision;
        if (!decision || !readModel.boardSourceHash) throw new Error("已确认策略已变化，请重新选择。");
        const workflow = normalizeManualStoryboardBoard({ value: parsed, episodeId: episode.id, sceneId: scene.id, shot, decision });
        setCandidate({ kind: "board", workflow, audit, sourceHash: readModel.boardSourceHash, issues: validateManualStoryboardBoard({ workflow, strategyContext, allowedAssetIds, shot }) });
      } else {
        if (!readModel.qaSourceHash) throw new Error("故事板已变化，请重新生成后质检。");
        const qa = normalizeManualStoryboardQA(parsed, readModel.qaSourceHash, audit, now);
        const issues: ManualVideoStoryboardIssue[] = qa.verdict === "pass" && qa.issues.some((item) => item.severity === "blocking")
          ? [{ severity: "blocking", code: "QA_VERDICT_CONFLICT", message: "质检标记通过，但仍包含 blocking 问题。" }]
          : [];
        setCandidate({ kind: "qa", qa, issues });
      }
      setPromptRequest(null);
    } catch (error) {
      console.error("Manual video storyboard action failed:", summarizeUnknownError(error));
      toast.error(error instanceof Error ? error.message : "视频故事板 Agent 执行失败。");
    } finally {
      setRunningAction(null);
    }
  };

  const adoptCandidate = async () => {
    if (!candidate || !shot || !readModel) return;
    if (candidate.issues.some((item) => item.severity === "blocking")) {
      toast.error("草案仍有阻断问题，不能采用。");
      return;
    }
    const current = readModel.workflow || { id: `manual-board-workflow-${shot.id}`, shotId: shot.id, updatedAt: Date.now() };
    const now = Date.now();
    let next: ManualStoryboardBoardWorkflow;
    if (candidate.kind === "strategy") {
      if (candidate.sourceHash !== readModel.strategySourceHash) {
        toast.error("Shot 或上游资产已变化，请重新选择策略。");
        return;
      }
      next = {
        ...current,
        strategyDecision: candidate.decision,
        strategyRecord: {
          sourceHash: candidate.sourceHash,
          outputHash: manualStoryboardHash(candidate.decision),
          audit: candidate.audit,
          adoptedAt: now,
        },
        confirmedAt: undefined,
        updatedAt: now,
      };
    } else if (candidate.kind === "board") {
      if (candidate.sourceHash !== readModel.boardSourceHash) {
        toast.error("策略或 Shot 已变化，请重新生成故事板。");
        return;
      }
      next = {
        ...current,
        ...candidate.workflow,
        boardRecord: {
          sourceHash: candidate.sourceHash,
          outputHash: buildManualBoardOutputHash(candidate.workflow),
          audit: candidate.audit,
          adoptedAt: now,
        },
        confirmedAt: undefined,
        updatedAt: now,
      };
    } else {
      if (candidate.qa.sourceHash !== readModel.qaSourceHash) {
        toast.error("故事板已变化，请重新质检。");
        return;
      }
      next = { ...current, qa: candidate.qa, confirmedAt: undefined, updatedAt: now };
    }
    const workspace = scene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now };
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, next),
        updatedAt: now,
      },
    }, episode.id);
    try {
      await flushDebouncedProjectSave(project.id);
    } catch (error) {
      console.error("Failed to persist adopted video storyboard candidate:", summarizeUnknownError(error));
      toast.error("采用结果已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
      return;
    }
    setCandidate(null);
    toast.success(candidate.kind === "strategy" ? "故事板策略已采用" : candidate.kind === "board" ? "视频故事板已采用" : "故事板质检已采用");
  };

  const confirmBoard = async () => {
    if (!shot || !readModel?.workflow?.qa || readModel.qaStatus !== "ready" || readModel.panelVisualStatus !== "ready") {
      toast.error(readModel?.panelVisualStatus !== "ready"
        ? "完整多格故事板页尚未完成自动视觉质检或人工整板采用，不能确认。"
        : "故事板结构质检尚未通过，不能确认。");
      return;
    }
    const currentBoardHash = readModel.workflow.board ? buildManualBoardOutputHash(readModel.workflow) : "";
    if (readModel.workflow.qa.sourceHash !== buildManualBoardQASourceHash(currentBoardHash)) {
      toast.error("故事板已变化，请重新质检。");
      return;
    }
    const now = Date.now();
    const confirmed = { ...readModel.workflow, confirmedAt: now, updatedAt: now };
    const workspace = scene.manualStoryboard!;
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, confirmed),
        updatedAt: now,
      },
    }, episode.id);
    try {
      await flushDebouncedProjectSave(project.id);
    } catch (error) {
      console.error("Failed to persist confirmed video storyboard:", summarizeUnknownError(error));
      toast.error("视频单元故事板确认已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
      return;
    }
    toast.success("当前视频单元故事板已确认。");
  };

  const setTargetVideoModel = async (modelConfigId?: string) => {
    if (!shot || !readModel) return;
    const current = readModel.workflow || {
      id: `manual-board-workflow-${shot.id}`,
      shotId: shot.id,
      updatedAt: Date.now(),
    };
    const now = Date.now();
    const next: ManualStoryboardBoardWorkflow = {
      ...current,
      targetVideoModelConfigId: modelConfigId?.trim() || undefined,
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now };
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, next),
        updatedAt: now,
      },
    }, episode.id);
    toast.success(modelConfigId ? "当前视频单元的目标模型已更新" : "当前视频单元已改为跟随默认视频模型");
  };

  const setStoryboardReferenceMode = async (visualReferenceMode: "shot_grid" | "director_board") => {
    if (!shot || !readModel?.workflow?.board) return;
    const now = Date.now();
    const next: ManualStoryboardBoardWorkflow = {
      ...readModel.workflow,
      board: { ...readModel.workflow.board, visualReferenceMode },
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now };
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, next),
        updatedAt: now,
      },
    }, episode.id);
    toast.success(visualReferenceMode === "shot_grid" ? "已选用分镜宫格图" : "已选用导演故事板");
  };

  const saveUnitVideoPrompt = async (value: string) => {
    if (!shot || !readModel?.workflow?.board) return;
    const prompt = value.trim();
    if (!prompt) {
      toast.error("视频单元提示词不能为空。");
      return;
    }
    const workflow = readModel.workflow;
    const unitShotIds = workflow.shotIds || workflow.board.shotIds || [workflow.shotId];
    const unitShots = unitShotIds
      .map((shotId) => scene.shots?.find((item) => item.id === shotId))
      .filter((item): item is Shot => Boolean(item));
    const now = Date.now();
    const next: ManualStoryboardBoardWorkflow = {
      ...workflow,
      unitVideoPrompt: {
        text: prompt,
        sourceHash: buildStoryboardUnitVideoPromptSourceHash({ workflow, shots: unitShots }),
        source: "author_edited",
        status: "ready",
        confirmedAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now };
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, next),
        updatedAt: now,
      },
    }, episode.id);
    try {
      await flushDebouncedProjectSave(project.id);
    } catch (error) {
      console.error("Failed to persist video-unit prompt:", summarizeUnknownError(error));
      toast.error("视频单元提示词已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
      return;
    }
    toast.success("视频单元提示词已保存，摄影棚会读取这一版。");
  };

  const rebuildUnitVideoPrompt = async () => {
    if (!shot || !readModel?.workflow?.board) return;
    const workflow = readModel.workflow;
    const unitShotIds = workflow.shotIds || workflow.board.shotIds || [workflow.shotId];
    const unitShots = unitShotIds
      .map((shotId) => scene.shots?.find((item) => item.id === shotId))
      .filter((item): item is Shot => Boolean(item));
    const now = Date.now();
    const next: ManualStoryboardBoardWorkflow = {
      ...workflow,
      unitVideoPrompt: buildStoryboardUnitVideoPromptRecord({ workflow, shots: unitShots, now }),
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now };
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, next),
        updatedAt: now,
      },
    }, episode.id);
    toast.success("已根据当前分镜顺序、时长、对白和声音重新整理视频单元提示词。");
  };

  const approvePanelVisual = async (panelId: string, takeId: string) => {
    if (!shot || !storyboardSourceHash || !readModel?.workflow?.board) return;
    const workflow = readModel.workflow;
    const panel = workflow.board.panels.find((item) => item.id === panelId);
    const take = panel?.visualTakes?.find((item) => item.id === takeId);
    if (!panel || !take) {
      toast.error("待采用的故事板候选画格不存在。");
      return;
    }
    const referenceSelection = selectStoryboardPanelVisualReferences({ panel, shot, assets, scene });
    const sourceHash = buildStoryboardPanelVisualSourceHash({
      storyboardSourceHash,
      boardOutputHash: buildManualBoardOutputHash(workflow),
      panel,
      project,
      references: referenceSelection.selected,
      styleAnchor: referenceSelection.styleAnchor,
      imagePrompt: shot.imagePrompt,
    });
    if (take.sourceHash !== sourceHash) {
      toast.error("Shot、故事板或正式资产已变化，请重新生成当前画格。");
      return;
    }
    const now = Date.now();
    const nextPanel = approveStoryboardPanelVisualTake({ panel, takeId, reviewedAt: now });
    const nextWorkflow: ManualStoryboardBoardWorkflow = {
      ...workflow,
      board: {
        ...workflow.board,
        panels: workflow.board.panels.map((item) => item.id === panelId ? nextPanel : item),
      },
      confirmedAt: undefined,
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard!;
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, nextWorkflow),
        updatedAt: now,
      },
    }, episode.id);
    try {
      await flushDebouncedProjectSave(project.id);
    } catch (error) {
      console.error("Failed to persist adopted storyboard panel visual:", summarizeUnknownError(error));
      toast.error("故事板画格采用结果已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
      return;
    }
    toast.success(`PANEL ${panel.panelNumber} 已人工看图采用。`);
  };

  const approveBoardVisual = async (pageId: string, takeId: string) => {
    if (!shot || !readModel?.workflow?.board) return;
    const workflow = readModel.workflow;
    const pages = workflow.board.visualPages?.length
      ? workflow.board.visualPages
      : buildStoryboardCompositeVisualPages(workflow.board);
    const page = pages.find((item) => item.id === pageId);
    const take = page?.visualTakes?.find((item) => item.id === takeId);
    if (!page || !take) {
      toast.error("待采用的完整故事板候选页不存在。");
      return;
    }
    const pageBoard = scopeStoryboardCompositeBoardToPage(workflow.board, page);
    const pageShotIds = new Set(pageBoard.shotIds);
    const boardShots = (scene.shots || []).filter((item) => pageShotIds.has(item.id));
    if (boardShots.some((item) => item.appearance?.states.some((state) => state.decision === "accepted"))) {
      try {
        const sourceContext = boardShots.some((item) => item.appearance?.states.some((state) => state.decision === "accepted" && state.inheritFromShotId))
          ? (await legacyProjectClient.getStoryboardTeamContext(project.id, episode.id, scene.id)).productionTeamContext
          : "";
        requireAppearanceReady(project, scene, boardShots, appearanceSourceShots(episode, sourceContext), "image");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "请先复核此页镜头的外观状态。");
        return;
      }
    }
    const references = selectStoryboardCompositeBoardReferences({
      project,
      board: pageBoard,
      shots: boardShots,
      assets,
    });
    const sourceHash = buildStoryboardCompositeBoardSourceHash({
      project,
      board: workflow.board,
      page,
      references: references.selected,
      shots: boardShots,
    });
    if (take.sourceHash !== sourceHash) {
      toast.error("Shot、故事板结构或正式资产已变化，请重新生成完整故事板页。");
      return;
    }
    const now = Date.now();
    const nextPage = adoptStoryboardBoardVisualTake({
      page,
      take: {
        ...take,
        review: { mode: "manual", status: "approved", reviewer: "creator", reviewedAt: now },
      },
      adoptedAt: now,
    });
    const visuallyAdoptedWorkflow: ManualStoryboardBoardWorkflow = {
      ...workflow,
      board: {
        ...workflow.board,
        visualPages: pages.map((item) => item.id === pageId ? nextPage : item),
      },
      confirmedAt: undefined,
      updatedAt: now,
    };
    const workspace = scene.manualStoryboard!;
    await updateScene(scene.id, {
      manualStoryboard: {
        ...workspace,
        boards: upsertManualStoryboardBoardWorkflow(workspace.boards, visuallyAdoptedWorkflow),
        updatedAt: now,
      },
    }, episode.id);
    try {
      await flushDebouncedProjectSave(project.id);
    } catch (error) {
      console.error("Failed to persist adopted storyboard page visual:", summarizeUnknownError(error));
      toast.error("故事板整页采用结果已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
      return;
    }
    toast.success(`故事板第 ${page.pageIndex + 1} 页已整板采用。`);
  };

  const composeShotGrid = async (pageId: string) => {
    if (composingGridPageId || runningAction || !readModel?.workflow?.board) return;
    const workflow = readModel.workflow;
    const pages = workflow.board.visualPages?.length ? workflow.board.visualPages : buildStoryboardCompositeVisualPages(workflow.board);
    const page = pages.find((item) => item.id === pageId);
    if (!page) return;
    setComposingGridPageId(pageId);
    try {
      const pageBoard = scopeStoryboardCompositeBoardToPage(workflow.board, page);
      const pageShotIds = new Set(pageBoard.shotIds);
      const pageShots = (scene.shots || []).filter((item) => pageShotIds.has(item.id));
      // Composition only arranges author-adopted pictures; it does not need
      // generation prompts, reference preparation, or another model review.
      const nextPage = await composeStoryboardShotGridPage({ board: workflow.board, page, shots: pageShots, render: renderStoryboardShotGrid, persist: (url) => persistProjectMediaUrl(url, project.id) });
      if (nextPage === page) { toast.success("宫格图已是当前分镜版本。"); return; }
      const latestState = useProjectStore.getState();
      if (latestState.currentProject?.id !== project.id || latestState.activeEpisode?.id !== episode.id) throw new Error("已切换项目或分集，本次宫格未写入新工作区。");
      const latestScene = latestState.activeEpisode.scenes.find((item) => item.id === scene.id);
      if (!latestScene) throw new Error("当前场次已不存在，本次宫格未写入。");
      const latestWorkflow = latestScene.manualStoryboard?.boards?.find((item) => item.id === workflow.id);
      if (!latestWorkflow?.board) throw new Error("故事板单元在合成过程中有更新，请重新合成宫格。");
      const latestPages = latestWorkflow.board.visualPages?.length ? latestWorkflow.board.visualPages : buildStoryboardCompositeVisualPages(latestWorkflow.board);
      const latestPage = latestPages.find((item) => item.id === pageId);
      if (!latestPage) throw new Error("故事板页在合成过程中有更新，请重新合成宫格。");
      const mergedPage = mergeStoryboardShotGridPageResult({ board: latestWorkflow.board, page: latestPage, shots: latestScene.shots || [], result: nextPage });
      const now = Date.now();
      const nextWorkflow = {
        ...latestWorkflow,
        board: {
          ...latestWorkflow.board,
          visualPages: latestPages.map((item) => item.id === pageId
            ? mergedPage
            : item),
        },
        updatedAt: now,
      };
      await updateScene(scene.id, {
        manualStoryboard: {
          ...latestScene.manualStoryboard!,
          boards: upsertManualStoryboardBoardWorkflow(latestScene.manualStoryboard?.boards, nextWorkflow),
          updatedAt: now,
        },
      }, episode.id);
      try { await flushDebouncedProjectSave(project.id); }
      catch { throw new Error("宫格图已保留在本地，但数据库保存失败。失败保存已保留，请稍后重试。"); }
      toast.success(page.shotGridTakes?.length ? "宫格图已更新，旧版本已保留。" : "宫格图已合成。未调用生成模型。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "宫格图合成失败，请重试。");
    } finally { setComposingGridPageId(null); }
  };

  return {
    readModel,
    composeShotGrid,
    composingGridPageId,
    promptRequest,
    setPromptRequest,
    candidate,
    setCandidate,
    runningAction,
    prepareAction,
    executePrompt,
    adoptCandidate,
    approvePanelVisual,
    approveBoardVisual,
    confirmBoard,
    setTargetVideoModel,
    setStoryboardReferenceMode,
    saveUnitVideoPrompt,
    rebuildUnitVideoPrompt,
  };
}
