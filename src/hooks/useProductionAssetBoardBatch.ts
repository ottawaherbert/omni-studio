import { missingAssetDesignIds } from "../clients/productionAssetWorkflowClient";
import type { AIExecutionProvenance } from "../clients/domainTypes";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { ensureAIProviderTaskReady, generateAIContent, generateAIImage } from "../clients/aiClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  buildProductionAssetImageVisualStyleProjection,
  buildProductionAssetVisualRecipeInputEvidence,
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
} from "../clients/productionVisualImageClient";
import { replaceCurrentProjectSnapshot, useAIConfigStore } from "../clients/stateClient";
import type { Episode, ManualStoryboardAgentQuality, Project } from "../clients/domainTypes";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import type { ProductionAssetBoardCandidate } from "./useProductionAssetBoardImage";
import {
  buildProductionAssetBoardReferenceUpdate,
  resolveProductionAssetBoardGenerationReference,
} from "../clients/productionAssetWorkflowClient";
import {
  buildProductionAssetBoardExecutionPlan,
  parseProductionAssetBoardExecutionPlan,
  serializeProductionAssetBoardExecutionPlan,
} from "../clients/productionAssetWorkflowClient";
import {
  buildVideoStoryboardAssetBoardPlan,
  type VideoStoryboardAssetBoardItem,
} from "../clients/productionAssetWorkflowClient";
import {
  buildProductionAssetBoardVisualQAPrompt,
  buildProductionAssetBoardVisualRepairPrompt,
  buildProductionAssetBoardCanonicalReference,
  buildProductionAssetBoardPreviousOutputRepairOperation,
  isProductionAssetBoardVisualQualityPassing,
  PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS,
} from "../clients/productionAssetWorkflowClient";
import {
  normalizeStoryboardAgentQuality,
  storyboardShotQualitySchema,
} from "../clients/productionStoryboardWorkflowClient";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";
import { safeParseAIResponse } from "../utils/aiParser";
import { imageUrlToMediaData, inspectImageTechnicalMetadata } from "../utils/imageMediaData";
import { summarizeUnknownError } from "../utils/logging";
import {
  createImageGenerationReference,
  type CompiledImageGenerationRequest,
} from "../clients/productionStudioWorkflowClient";

type AssetBoardBatchStage = "idle" | "generating" | "awaiting_review" | "completed" | "needs_decision";

export interface ProductionAssetBoardBatchPromptRequest {
  templateId: "generateImage";
  title: string;
  variables: Record<string, string>;
  contextOptions: { id: string; label: string; value: string }[];
  defaultSelectedContextIds: string[];
}

export interface ProductionAssetBoardBatchProgress {
  stage: AssetBoardBatchStage;
  completed: number;
  total: number;
  currentBoardName?: string;
  currentAttempt?: number;
  maxAttempts?: number;
  failedBoardNames: string[];
  failureReason?: string;
}

interface AssetBoardBatchOperationToken {
  projectId: string;
  scopeKey: string;
  epoch: number;
}

const maxGenerationAttempts = PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS + 1;

const isProviderConfigurationFailure = (message: string) => message.includes("无可用渠道");

const isTransientGenerationFailure = (message: string) => {
  if (isProviderConfigurationFailure(message)) return false;
  const normalized = message.toLowerCase();
  return [
    "(429)",
    "(500)",
    "(502)",
    "(503)",
    "(504)",
    "network",
    "timeout",
    "proxy request failed",
    "网络",
    "超时",
  ].some((marker) => normalized.includes(marker));
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const allBoards = (project: Project) => {
  const plan = buildVideoStoryboardAssetBoardPlan(project);
  return [
    ...plan.characterBoards,
    ...plan.sceneBoards,
    ...plan.propBoards,
    ...plan.vehicleBoards,
    ...plan.variantBoards,
  ];
};

const boardAspectRatio = (_board: VideoStoryboardAssetBoardItem) => "16:9" as const;

const batchInstruction = `你是项目资产板总监 Agent。请为下面清单中的每个角色板、场景板、道具板、交通工具板和状态变体板建立可直接供分镜与视频模型引用的一致性参考图。

批次规则：
1. 基础资产板固定身份、材质、比例、色彩和可识别细节；状态变体板只改变清单声明的状态，不重新设计身份。状态变体板的所有视角只能展示当前变体，禁止加入变化时间线、前后对比、基础状态、其他变体或未来状态。
2. 角色板必须让正面、侧面、全身、关键服化和可识别细节能够被下游读取；不得把 MBTI、表演流派等抽象标签画成刻板符号。
3. 场景板必须固定空间拓扑、主视角、关键出入口、固定陈设和光线基准；道具板必须固定结构、材质、磨损和比例参照。
4. 不添加项目与资产档案中没有的剧情事实、文字、水印、品牌标志或无关人物。
5. 同一资产的变体必须继承基础板；若提供参考图，优先保持参考图身份。
6. 所有资产板必须继承同一份项目风格锁与已确认导演、摄影、灯光、美术、服化妆和表演方案；风格锁尚未明确时，只能从这些已确认项目上下文形成一个共享方向，不能逐张自由发挥。
7. 这是一次已确认的整批生成计划。系统每次只生成下一张候选；每张都必须预览并明确采用后才能写入正式资产。失败重试可沿用本计划，所有调用必须保留提示词、模型、Skill、上下文和来源审计。
8. 一张图只能表现当前 boardItemId 对应的一种资产。允许同一资产的多视角、表情、细节和状态，但禁止把其他角色、场景或道具拼进同一张板；组合道具必须先拆成独立资产再生成。`;

export const useProductionAssetBoardBatch = ({
  project,
  episodes,
  updateProject,
}: {
  project: Project | null;
  episodes: Episode[];
  updateProject: (updates: Partial<Project>) => Promise<void>;
}) => {
  const [promptRequest, setPromptRequest] = useState<ProductionAssetBoardBatchPromptRequest | null>(null);
  const [progress, setProgress] = useState<ProductionAssetBoardBatchProgress>({
    stage: "idle",
    completed: 0,
    total: 0,
    failedBoardNames: [],
  });
  const [transientCandidate, setTransientCandidate] = useState<ProductionAssetBoardCandidate | null>(null);
  const [isAdopting, setIsAdopting] = useState(false);
  const approvedExecutionPlanRef = useRef<ReturnType<typeof parseProductionAssetBoardExecutionPlan> | null>(null);
  const approvedSourceHashesRef = useRef<Record<string, string>>({});
  const approvedMetadataRef = useRef<PromptEditorConfirmMetadata | undefined>(undefined);
  const operationScopeKey = project?.id || "no-project";
  const activeProjectIdRef = useRef(project?.id);
  const activeScopeKeyRef = useRef(operationScopeKey);
  const generationEpochRef = useRef(0);
  const reviewEpochRef = useRef(0);
  const inFlightGenerationScopesRef = useRef(new Set<string>());
  const inFlightReviewScopesRef = useRef(new Set<string>());
  const beginGenerationOperation = (projectId: string): AssetBoardBatchOperationToken | null => {
    if (inFlightGenerationScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId, scopeKey: operationScopeKey, epoch: generationEpochRef.current + 1 };
    generationEpochRef.current = operation.epoch;
    inFlightGenerationScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isGenerationOperationCurrent = (operation: AssetBoardBatchOperationToken) => (
    activeProjectIdRef.current === operation.projectId
    && activeScopeKeyRef.current === operation.scopeKey
    && generationEpochRef.current === operation.epoch
  );
  const finishGenerationOperation = (operation: AssetBoardBatchOperationToken) => {
    inFlightGenerationScopesRef.current.delete(operation.scopeKey);
  };
  const beginReviewOperation = (projectId: string): AssetBoardBatchOperationToken | null => {
    if (inFlightReviewScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId, scopeKey: operationScopeKey, epoch: reviewEpochRef.current + 1 };
    reviewEpochRef.current = operation.epoch;
    inFlightReviewScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isReviewOperationCurrent = (operation: AssetBoardBatchOperationToken) => (
    activeProjectIdRef.current === operation.projectId
    && activeScopeKeyRef.current === operation.scopeKey
    && reviewEpochRef.current === operation.epoch
  );
  const finishReviewOperation = (operation: AssetBoardBatchOperationToken) => {
    inFlightReviewScopesRef.current.delete(operation.scopeKey);
    if (isReviewOperationCurrent(operation)) setIsAdopting(false);
  };
  const missingBoards = useMemo(() => project
    ? allBoards(project).filter((board) => !board.referenceImageUrl)
    : [], [project]);
  const persistedCandidate = useMemo<ProductionAssetBoardCandidate | null>(() => {
    if (!project) return null;
    const boards = allBoards(project);
    const pendingReferences = [...(project.manualProductionAssets?.pendingReferences || [])]
      .sort((left, right) => right.createdAt - left.createdAt);
    for (const pending of pendingReferences) {
      const board = boards.find((item) => item.id === pending.boardItemId);
      if (!board) continue;
      return {
        candidateId: pending.id,
        board,
        imageUrl: pending.imageUrl,
        finalPrompt: pending.finalPrompt || "",
        source: pending.source,
        modelId: pending.modelId,
      executionProvenance: pending.executionProvenance,
        inputReferenceUrl: pending.inputReferenceUrl,
        imageReferenceManifest: pending.imageReferenceManifest,
        promptCompositionManifest: pending.promptCompositionManifest,
        visualStyleCompileManifest: pending.visualStyleCompileManifest,
        sourceContentHash: pending.sourceContentHash,
        sourceReview: reviewProductionAssetBoardCandidateSource({
          project,
          candidate: pending,
          detectedAt: pending.updatedAt,
        }),
        selection: {
          selectedSkillIds: pending.selectedSkillIds,
          selectedSkillTitles: pending.selectedSkillTitles || [],
          selectedContextIds: pending.selectedContextIds,
        },
        quality: pending.quality,
        review: pending.review || { mode: "manual", status: "pending" },
        referenceMode: pending.referenceMode || "production_board",
        layoutContractId: pending.layoutContractId || board.layoutContract.contractId,
      };
    }
    return null;
  }, [project]);
  const rawCandidate = transientCandidate || persistedCandidate;
  const candidate = useMemo<ProductionAssetBoardCandidate | null>(() => {
    if (!project || !rawCandidate) return rawCandidate;
    return {
      ...rawCandidate,
      sourceReview: reviewProductionAssetBoardCandidateSource({
        project,
        candidate: {
          boardItemId: rawCandidate.board.id,
          referenceMode: rawCandidate.referenceMode,
          sourceContentHash: rawCandidate.sourceContentHash,
        },
      }),
    };
  }, [project, rawCandidate]);
  useLayoutEffect(() => {
    activeProjectIdRef.current = project?.id;
    activeScopeKeyRef.current = operationScopeKey;
    generationEpochRef.current += 1;
    reviewEpochRef.current += 1;
    setTransientCandidate(null);
    setPromptRequest(null);
    setProgress({ stage: "idle", completed: 0, total: 0, failedBoardNames: [] });
    setIsAdopting(false);
    approvedExecutionPlanRef.current = null;
    approvedMetadataRef.current = undefined;
  }, [operationScopeKey]);

  const openPrompt = () => {
    if (!project || !missingBoards.length) {
      toast.success("项目资产板已经完整。");
      return;
    }
    if (missingAssetDesignIds(project, missingBoards.map(b => b.assetId)).length) { toast.error("请先完成待生成资产的形象设计"); return; }
    const executionPlan = buildProductionAssetBoardExecutionPlan(project, missingBoards);
    setPromptRequest({
      templateId: "generateImage",
      title: `一键生成项目资产板（${missingBoards.length} 张）`,
      variables: {
        imagePrompt: `${batchInstruction}\n\n【以下 JSON 是确认后逐张实际调用的提示词，可直接编辑；不要删除起止标记或改变 boardItemId】\n${serializeProductionAssetBoardExecutionPlan(executionPlan)}`,
      },
      contextOptions: [],
      defaultSelectedContextIds: [],
    });
  };

  const executeBatch = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!project || progress.stage === "generating" || candidate) return;
    if (missingAssetDesignIds(project, missingBoards.map(b => b.assetId)).length) { toast.error("资产外观尚未完成，未开始生图"); return; }
    const targetIds = new Set(missingBoards.map((board) => board.id));
    let executionPlan: ReturnType<typeof parseProductionAssetBoardExecutionPlan>;
    try {
      executionPlan = parseProductionAssetBoardExecutionPlan(finalPrompt, Array.from(targetIds));
    } catch (error) {
      const summary = summarizeUnknownError(error);
      toast.error(summary.message);
      return;
    }
    const operation = beginGenerationOperation(project.id);
    if (!operation) return;
    const setCurrentProgress = (next: ProductionAssetBoardBatchProgress) => {
      if (isGenerationOperationCurrent(operation)) setProgress(next);
    };
    try {
    approvedExecutionPlanRef.current = executionPlan;
    approvedSourceHashesRef.current = Object.fromEntries(missingBoards.map(board => [board.id, productionAssetBoardCandidateSourceContentHash({ project, boardItemId: board.id, referenceMode: "production_board" })]));
    approvedMetadataRef.current = metadata;
    const executionPromptByBoardId = new Map(executionPlan.items.map((item) => [item.boardItemId, item.executionPrompt]));
    let workingProject = project;
    let completed = 0;
    const failedBoardNames: string[] = [];
    let failureReason: string | undefined;
    let consecutiveFailures = 0;
    setCurrentProgress({ stage: "generating", completed: 0, total: targetIds.size, failedBoardNames: [] });

    try {
      await ensureAIProviderTaskReady("imageGen", "项目资产板生成");
      if (!isGenerationOperationCurrent(operation)) return;
    } catch (error) {
      if (!isGenerationOperationCurrent(operation)) return;
      const summary = summarizeUnknownError(error);
      const failed = missingBoards.map((board) => board.variantId
        ? `${board.assetName} · ${board.variantName || "状态变体"}`
        : board.assetName);
      setCurrentProgress({
        stage: "needs_decision",
        completed: 0,
        total: targetIds.size,
        failedBoardNames: failed,
        failureReason: summary.message,
      });
      toast.error("图片生成渠道尚未就绪，资产板任务未开始，也没有留下部分结果。");
      throw error;
    }

    for (const targetId of targetIds) {
      const board = allBoards(workingProject).find((item) => item.id === targetId);
      if (!board || board.referenceImageUrl) {
        completed += 1;
        setCurrentProgress({ stage: "generating", completed, total: targetIds.size, failedBoardNames: [...failedBoardNames] });
        continue;
      }
      setCurrentProgress({
        stage: "generating",
        completed,
        total: targetIds.size,
        currentBoardName: board.variantId ? `${board.assetName} · ${board.variantName || "状态变体"}` : board.assetName,
        currentAttempt: 1,
        maxAttempts: maxGenerationAttempts,
        failedBoardNames: [...failedBoardNames],
      });
      const boardPrompt = executionPromptByBoardId.get(board.id);
      if (!boardPrompt) {
        failureReason ||= `资产板「${board.assetName}」缺少已确认的执行提示词。`;
        failedBoardNames.push(board.variantId ? `${board.assetName} · ${board.variantName || "状态变体"}` : board.assetName);
        completed += 1;
        continue;
      }
      let stopForProviderConfiguration = false;
      try {
        const generationReference = resolveProductionAssetBoardGenerationReference(workingProject, board);
        if (generationReference.issue) throw new Error(generationReference.issue);
        const inputReferenceUrl = generationReference.imageUrl;
        const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
          project: workingProject,
          boardItemId: board.id,
          referenceMode: "production_board",
        });
        const visualStyleProjection = buildProductionAssetImageVisualStyleProjection({
          project: workingProject,
          asset: board,
        });
        let imageUrl = "";
        let adoptedPrompt = boardPrompt;
        let quality: ManualStoryboardAgentQuality | undefined;
      let reviewExecution: AIExecutionProvenance | undefined;
        let review: NonNullable<Parameters<typeof buildProductionAssetBoardReferenceUpdate>[0]["review"]> | undefined;
        let repairIssues: string[] = [];
        let latestError: unknown;
        let compiledRequest: CompiledImageGenerationRequest | undefined;
      let executionProvenance: AIExecutionProvenance | undefined;
        let previousOutputReferenceUrl: string | undefined;
        for (let attempt = 1; attempt <= maxGenerationAttempts; attempt += 1) {
          if (!isGenerationOperationCurrent(operation)) return;
          setCurrentProgress({
            stage: "generating",
            completed,
            total: targetIds.size,
            currentBoardName: board.variantId ? `${board.assetName} · ${board.variantName || "状态变体"}` : board.assetName,
            currentAttempt: attempt,
            maxAttempts: maxGenerationAttempts,
            failedBoardNames: [...failedBoardNames],
          });
          try {
            const executionPrompt = buildProductionAssetBoardVisualRepairPrompt(boardPrompt, repairIssues);
            const references = previousOutputReferenceUrl
              ? [createImageGenerationReference({
                  imageUrl: previousOutputReferenceUrl,
                  label: "待修改的参考图",
                  role: "previous_output_repair",
                })]
              : inputReferenceUrl
                ? [buildProductionAssetBoardCanonicalReference({ board, imageUrl: inputReferenceUrl })]
                : undefined;
            const generatedImageUrl = await generateAIImage({
              promptCore: executionPrompt,
              aspectRatio: boardAspectRatio(board),
              visualStyleProjection,
              visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project: workingProject, asset: board }),
              references,
              operation: previousOutputReferenceUrl
                ? buildProductionAssetBoardPreviousOutputRepairOperation({ board, issues: repairIssues })
                : { kind: "generate" },
              onExecutionProvenance: audit => { executionProvenance = audit; },
        onPromptCompiled: (compiled) => {
                compiledRequest = compiled;
              },
            });
            if (!isGenerationOperationCurrent(operation)) return;
            imageUrl = await persistProjectMediaUrl(generatedImageUrl, project.id);
            if (!isGenerationOperationCurrent(operation)) return;
            previousOutputReferenceUrl = imageUrl;
            adoptedPrompt = executionPrompt;
            const technical = await inspectImageTechnicalMetadata(imageUrl);
            if (!isGenerationOperationCurrent(operation)) return;
            if (technical.width > 0 && technical.height > 0 && technical.width <= technical.height) {
              repairIssues = [`资产板输出方向与本次结构化画幅不一致，实际返回 ${technical.width}x${technical.height}。`];
              latestError = new Error(repairIssues[0]);
              imageUrl = "";
              if (attempt < maxGenerationAttempts) continue;
              throw latestError;
            }

            if (!useAIConfigStore.getState().visualQcEnabled) {
              review = { mode: "manual", status: "pending" };
              break;
            }

            const qaPrompt = buildProductionAssetBoardVisualQAPrompt({ project: workingProject, board });
            const mediaDataList = await Promise.all(
              [imageUrl, inputReferenceUrl].filter(Boolean).map((url) => imageUrlToMediaData(url!)),
            );
            if (!isGenerationOperationCurrent(operation)) return;
            const qaResponse = await generateAIContent({
              taskType: "visualQc",
          onExecutionProvenance: audit => { reviewExecution = audit; },
              prompt: qaPrompt,
              requireJson: true,
              schema: storyboardShotQualitySchema,
              mediaDataList,
            });
            if (!isGenerationOperationCurrent(operation)) return;
            quality = normalizeStoryboardAgentQuality(safeParseAIResponse<unknown>(qaResponse, {}));
            if (isProductionAssetBoardVisualQualityPassing(quality)) {
              review = { mode: "automatic", executionProvenance: reviewExecution, status: "approved", reviewedAt: Date.now() };
              break;
            }
            repairIssues = quality.issues
              .filter((item) => item.severity !== "advisory")
              .map((item) => `${item.description}；${item.suggestion}`);
            latestError = new Error(`资产板视觉质检 ${quality.score} 分，未达到制作参考板标准：${repairIssues.join("；") || quality.summary}`);
            imageUrl = "";
            if (attempt < maxGenerationAttempts) continue;
            throw latestError;
          } catch (error) {
            if (!isGenerationOperationCurrent(operation)) return;
            latestError = error;
            const message = summarizeUnknownError(error).message;
            if (attempt >= maxGenerationAttempts || !isTransientGenerationFailure(message)) throw error;
            await wait(attempt * 1500);
            if (!isGenerationOperationCurrent(operation)) return;
          }
        }
        if (!imageUrl) throw latestError || new Error("图片生成未返回结果。");
        if (!compiledRequest) throw new Error("资产板候选缺少图片编译审计，不能进入人工采用。");
        const candidateId = `asset-board-${window.crypto.randomUUID()}`;
        const stagedCandidate: ProductionAssetBoardCandidate = {
          candidateId,
          board,
          imageUrl,
          source: executionProvenance?.source === "manual_external" ? "upload" : "ai_generation",
          finalPrompt: compiledRequest?.providerPrompt || adoptedPrompt,
          modelId: executionProvenance?.modelId,
        executionProvenance,
          inputReferenceUrl,
          imageReferenceManifest: compiledRequest.references.map((reference, index) => ({
            index: index + 1,
            imageUrl: reference.imageUrl,
            label: reference.label,
            role: reference.role,
            preserve: [...reference.preserve],
            allowChange: [...reference.allowChange],
            exclude: [...reference.exclude],
          })),
          promptCompositionManifest: structuredClone(compiledRequest.manifest),
          visualStyleCompileManifest: compiledRequest.visualStyleProjection?.compileManifest
            ? structuredClone(compiledRequest.visualStyleProjection.compileManifest)
            : undefined,
          sourceContentHash,
          selection: {
            selectedSkillIds: [...(metadata?.selectedSkillIds || [])],
            selectedSkillTitles: [...(metadata?.selectedSkillTitles || [])],
            selectedContextIds: [...(metadata?.selectedContextIds || [])],
          },
          quality,
          review: review || { mode: "manual", status: "pending" },
          referenceMode: "production_board",
          layoutContractId: board.layoutContract.contractId,
        };
        if (!isGenerationOperationCurrent(operation)) return;
        const savedProject = await legacyProjectClient.stageProductionAssetBoardCandidate(project.id, {
          candidateId,
          boardItemId: board.id,
          imageUrl,
          source: stagedCandidate.source,
          finalPrompt: stagedCandidate.finalPrompt,
          modelId: stagedCandidate.modelId,
        executionProvenance: stagedCandidate.executionProvenance,
          inputReferenceUrl: stagedCandidate.inputReferenceUrl,
          imageReferenceManifest: stagedCandidate.imageReferenceManifest,
          promptCompositionManifest: stagedCandidate.promptCompositionManifest,
          visualStyleCompileManifest: stagedCandidate.visualStyleCompileManifest,
          sourceContentHash,
          selectedSkillIds: stagedCandidate.selection?.selectedSkillIds,
          selectedSkillTitles: stagedCandidate.selection?.selectedSkillTitles,
          selectedContextIds: stagedCandidate.selection?.selectedContextIds,
          quality: stagedCandidate.quality,
          review: stagedCandidate.review,
          referenceMode: stagedCandidate.referenceMode,
        });
        if (!isGenerationOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
        const persisted = savedProject.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
        setTransientCandidate({
          ...stagedCandidate,
          sourceContentHash: persisted?.sourceContentHash || sourceContentHash,
          sourceReview: reviewProductionAssetBoardCandidateSource({
            project: savedProject,
            candidate: persisted || {
              boardItemId: board.id,
              referenceMode: "production_board",
              sourceContentHash,
            },
          }),
        });
        setCurrentProgress({
          stage: "awaiting_review",
          completed,
          total: targetIds.size,
          currentBoardName: board.variantId
            ? `${board.assetName} · ${board.variantName || "状态变体"}`
            : board.assetName,
          failedBoardNames: [...failedBoardNames],
          failureReason,
        });
        toast.success("下一张资产板候选已生成，请预览并明确采用或放弃。");
        return;
      } catch (error) {
        if (!isGenerationOperationCurrent(operation)) return;
        const summary = summarizeUnknownError(error);
        console.error("Production asset board batch item failed:", summary);
        failureReason ||= summary.message;
        stopForProviderConfiguration = isProviderConfigurationFailure(summary.message);
        failedBoardNames.push(board.variantId ? `${board.assetName} · ${board.variantName || "状态变体"}` : board.assetName);
        consecutiveFailures += 1;
      }
      completed += 1;
      setCurrentProgress({
        stage: "generating",
        completed,
        total: targetIds.size,
        failedBoardNames: [...failedBoardNames],
        failureReason,
      });
      if (stopForProviderConfiguration || consecutiveFailures >= 3) {
        const remaining = Array.from(targetIds).slice(completed);
        for (const remainingId of remaining) {
          const remainingBoard = allBoards(workingProject).find((item) => item.id === remainingId);
          if (!remainingBoard) continue;
          failedBoardNames.push(remainingBoard.variantId
            ? `${remainingBoard.assetName} · ${remainingBoard.variantName || "状态变体"}`
            : remainingBoard.assetName);
        }
        break;
      }
    }

    const stage: AssetBoardBatchStage = failedBoardNames.length ? "needs_decision" : "completed";
    setCurrentProgress({ stage, completed, total: targetIds.size, failedBoardNames, failureReason });
    if (isGenerationOperationCurrent(operation) && failedBoardNames.length) {
      toast.error(`${failedBoardNames.length} 张资产板生成失败，可沿已确认计划继续重试。`);
      throw new Error(failureReason || "资产板生成失败");
    }
    } finally {
      finishGenerationOperation(operation);
    }
  };

  const adoptCandidate = async () => {
    if (!project || !candidate || isAdopting) return;
    const operation = beginReviewOperation(project.id);
    if (!operation) return;
    setIsAdopting(true);
    try {
      if (!candidate.candidateId) throw new Error("资产板候选缺少持久化 ID，不能采用。");
      const savedProject = await legacyProjectClient.adoptProductionAssetBoardCandidate(project.id, candidate.candidateId);
      if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const nextCompleted = Math.min(progress.total, progress.completed + 1);
      setTransientCandidate(null);
      setProgress({
        stage: missingBoards.length <= 1 ? "completed" : "idle",
        completed: nextCompleted,
        total: progress.total,
        failedBoardNames: progress.failedBoardNames,
        failureReason: progress.failureReason,
      });
      const adoptedAudit = savedProject.manualProductionAssets?.references?.find((item) => item.candidateId === candidate.candidateId);
      toast.success(adoptedAudit?.sourceReview?.status === "review_recommended"
        ? "资产板候选已按你的明确操作采用；来源有更新，建议复核。"
        : "资产板候选已采用；其余项目可沿已确认计划继续生成。");
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "采用资产板候选失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  const discardCandidate = async () => {
    if (!project || !candidate || isAdopting) return;
    const operation = beginReviewOperation(project.id);
    if (!operation) return;
    setIsAdopting(true);
    const boardName = candidate.board.variantId
      ? `${candidate.board.assetName} · ${candidate.board.variantName || "状态变体"}`
      : candidate.board.assetName;
    try {
      if (candidate.candidateId) {
        const savedProject = await legacyProjectClient.discardProductionAssetBoardCandidate(project.id, candidate.candidateId);
        if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      }
      if (!isReviewOperationCurrent(operation)) return;
      setTransientCandidate(null);
      setProgress((current) => ({
        ...current,
        stage: "needs_decision",
        failedBoardNames: Array.from(new Set([...current.failedBoardNames, boardName])),
        failureReason: "候选已由用户放弃，正式资产未改变。",
      }));
      toast.success("候选已放弃，正式资产未改变。");
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "放弃资产板候选失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  const canResumeWithoutConfirmation = Boolean(approvedExecutionPlanRef.current
    && missingBoards.length
    && project && missingBoards.every((board) => approvedExecutionPlanRef.current?.items.some((item) => item.boardItemId === board.id)
      && approvedSourceHashesRef.current[board.id] === productionAssetBoardCandidateSourceContentHash({ project, boardItemId: board.id, referenceMode: "production_board" })));

  const start = () => {
    if (candidate) {
      toast.error("请先采用或放弃当前资产板候选。");
      return;
    }
    const approvedPlan = approvedExecutionPlanRef.current;
    if (!approvedPlan || !canResumeWithoutConfirmation) {
      openPrompt();
      return;
    }
    const promptByBoardId = new Map(approvedPlan.items.map((item) => [item.boardItemId, item]));
    const resumePlan = {
      schemaVersion: "production-asset-board-execution-plan.v1" as const,
      items: missingBoards.map((board) => promptByBoardId.get(board.id)!),
    };
    void executeBatch(
      serializeProductionAssetBoardExecutionPlan(resumePlan),
      undefined,
      approvedMetadataRef.current,
    );
  };

  return {
    promptRequest,
    progress,
    candidate,
    isAdopting,
    missingCount: missingBoards.length,
    missingAssetIds: [...new Set(missingBoards.map(board => board.assetId))],
    canResumeWithoutConfirmation,
    start,
    openPrompt,
    closePrompt: () => setPromptRequest(null),
    executeBatch,
    adoptCandidate,
    discardCandidate,
  };
};
