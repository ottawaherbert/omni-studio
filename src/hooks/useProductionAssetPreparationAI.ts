import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { generateAIContent } from "../clients/aiClient";
import { Type } from "../clients/aiSchemaClient";
import type { Episode, Project, Scene } from "../clients/domainTypes";
import { useAIConfigStore } from "../clients/stateClient";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import {
  buildProductionAssetPreparationContext,
  buildProductionAssetPreparationSceneUpdates,
  normalizeProductionAssetPreparationCandidate,
  productionAssetPreparationVariantId,
  mergeProductionAssetPreparationVariants,
  type ProductionAssetPreparationContext,
  type ProductionAssetPreparationNormalizedCandidate,
} from "../clients/productionAssetWorkflowClient";
import { manualFilmTeamScriptHash } from "../clients/productionPreparationWorkflowClient";
import { gatherContextOptions } from "../utils/contextMapper";
import { safeParseAIResponse } from "../utils/aiParser";
import { summarizeUnknownError } from "../utils/logging";
import { formatCreativeVision, getProjectTypeLabel } from "../utils/projectUtils";

export interface ProductionAssetPreparationPromptRequest {
  templateId: "productionAssetPreparationBatch";
  title: string;
  variables: Record<string, string>;
  contextOptions: Array<{ id: string; label: string; value: string }>;
  defaultSelectedContextIds: string[];
}

export interface ProductionAssetPreparationReviewIssue {
  severity: "blocking" | "warning" | "advisory";
  targetType: "profile" | "state" | "continuity" | "coverage";
  targetId: string;
  description: string;
  suggestion: string;
}

export interface ProductionAssetPreparationReviewAttempt {
  attempt: number;
  finalPrompt: string;
  modelId: string;
  score: number;
  verdict: "pass" | "needs_revision";
  summary: string;
}

export interface ProductionAssetPreparationReview {
  score: number;
  verdict: "pass" | "needs_revision";
  summary: string;
  issues: ProductionAssetPreparationReviewIssue[];
  attempts: ProductionAssetPreparationReviewAttempt[];
}

export interface ProductionAssetPreparationCandidate extends ProductionAssetPreparationNormalizedCandidate {
  context: ProductionAssetPreparationContext;
  finalPrompt: string;
  modelId: string;
  review: ProductionAssetPreparationReview;
  metadata?: PromptEditorConfirmMetadata;
}

export type ProductionAssetPreparationStage = "idle" | "generating" | "qa" | "ready" | "adopting" | "failed";

const reviewThreshold = 90;
const maxReviewAttempts = 3;

const normalizedCandidateFingerprint = (candidate: ProductionAssetPreparationNormalizedCandidate) => JSON.stringify({
  profiles: candidate.profiles.map((profile) => ({
    assetId: profile.assetId,
    proposedValues: profile.proposedValues,
    evidence: profile.evidence,
    assumptions: profile.assumptions,
  })),
  decisions: candidate.decisions,
});

const profileSchema = {
  type: Type.OBJECT,
  properties: {
    assetId: { type: Type.STRING },
    assetType: { type: Type.STRING },
    name: { type: Type.STRING },
    visualIdentity: { type: Type.STRING },
    psychologicalProfile: { type: Type.STRING },
    mbti: { type: Type.STRING },
    enneagram: { type: Type.STRING },
    internalDesire: { type: Type.STRING },
    externalGoal: { type: Type.STRING },
    flaw: { type: Type.STRING },
    actingStyle: { type: Type.STRING },
    vocalQuirk: { type: Type.STRING },
    sliders: { type: Type.OBJECT, additionalProperties: { type: Type.INTEGER } },
    description: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["assetId", "assetType", "name", "visualIdentity", "psychologicalProfile", "mbti", "enneagram", "internalDesire", "externalGoal", "flaw", "actingStyle", "vocalQuirk", "sliders", "description", "tags", "evidence", "assumptions"],
};

const decisionSchema = {
  type: Type.OBJECT,
  properties: {
    sceneId: { type: Type.STRING },
    assetId: { type: Type.STRING },
    assetType: { type: Type.STRING },
    use: { type: Type.STRING },
    existingVariantId: { type: Type.STRING },
    variantKey: { type: Type.STRING },
    variantName: { type: Type.STRING },
    visibleDelta: { type: Type.STRING },
    promptModifiers: { type: Type.STRING },
    reason: { type: Type.STRING },
    evidence: { type: Type.STRING },
  },
  required: ["sceneId", "assetId", "assetType", "use", "existingVariantId", "variantKey", "variantName", "visibleDelta", "promptModifiers", "reason", "evidence"],
};

const candidateSchema = {
  type: Type.OBJECT,
  properties: {
    profiles: { type: Type.ARRAY, items: profileSchema },
    decisions: { type: Type.ARRAY, items: decisionSchema },
  },
  required: ["profiles", "decisions"],
};

const normalizeIssues = (value: unknown): ProductionAssetPreparationReviewIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const description = String(record.description || "").trim();
    if (!description) return [];
    const rawSeverity = String(record.severity || "warning");
    const rawTargetType = String(record.targetType || "coverage");
    return [{
      severity: rawSeverity === "blocking" || rawSeverity === "advisory" ? rawSeverity : "warning",
      targetType: rawTargetType === "profile" || rawTargetType === "state" || rawTargetType === "continuity" ? rawTargetType : "coverage",
      targetId: String(record.targetId || "batch").trim() || "batch",
      description,
      suggestion: String(record.suggestion || "请依据同一份来源证据直接修正候选。").trim(),
    } as ProductionAssetPreparationReviewIssue];
  });
};

export const buildProductionAssetPreparationReviewPrompt = ({
  context,
  candidate,
  structureErrors,
  attempt,
}: {
  context: ProductionAssetPreparationContext;
  candidate: Record<string, unknown>;
  structureErrors: string[];
  attempt: number;
}) => `【项目资产筹备候选自动质检与修正 · 第 ${attempt} 轮】
这是创作者一次确认后的批次内部复检。请直接修正可定位的漏项、事实混淆、错误变体、重复身份和连续性问题，不要要求创作者逐项处理。

【稳定资产与逐场证据】
${JSON.stringify({
  assets: context.assets.map((asset) => ({ id: asset.id, type: asset.type, name: asset.name })),
  scenes: context.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    sceneTitle: scene.sceneTitle,
    sourceEvidence: scene.sourceEvidence || scene.script,
  })),
  usages: context.usages,
  departmentOutputs: context.departmentOutputs.map(({ sourceHash: _sourceHash, episodeId: _episodeId, ...output }) => output),
}, null, 2)}

【系统结构校验结果】
${structureErrors.length ? structureErrors.join("\n") : "全部稳定 ID 与覆盖关系通过结构校验。"}

【当前候选】
${JSON.stringify(candidate, null, 2)}

【必须逐项核对】
1. profiles 必须逐一覆盖 ${context.assets.length} 个范围内 canonical 资产；decisions 必须逐一覆盖 ${context.usages.length} 个 sceneId + assetId 使用关系，ID 原样返回，不多不少。
2. 档案只写跨场稳定身份，保留所有已确认锚点；没有来源支持的专业设计标为【候选设计】。不得把场次灯光、天气、动作、持有人、摆位、显影阶段或伤损状态写进基础身份。
3. 每个 profile 都必须返回 evidence 与 assumptions。evidence 只能写可核对的剧本、拆解或已确认部门事实；所有无法由 evidence 支持的年龄、材质、装潢、职业、性格因果和关系解释必须逐条进入 assumptions，并在对应字段内标为【候选设计】或【待确认】。不能为了“补齐档案”把推测写成事实。
4. 对只出现一次、没有对白、只存在于照片/影像、或行为证据不足的角色，不得从单一姿态推断 MBTI、九型人格、致命弱点、过错归因或完整心理史。可以返回【待确认】，也可以提供明确标注的【候选设计】；例如来源只说“有东西倒了”，不能改写成“器材倒下”并据此归责。
5. base/variant 必须按语义和下游参考图、分镜及视频的可见结果判断，不能按关键词、正则或“首次出现”机械判断。资产变体不是只记录物理结构变化：同一场景在时段、天气、主导光色或开闭状态上形成明显不同画面，且后续生成需要稳定复现时，也应建立可复用的场景状态变体；“灯光可在现场调整”本身不是判为 base 的理由。持有人、摆位、动作和一般情绪通常不需要变体；会改变参考图的服化、伤损、天气光照、物理状态、显影阶段或部件装卸通常需要变体，但必须服从具体证据。
6. 同一资产的同一可见状态必须复用同一个 variantKey；不同可见状态不能错误复用。variant 只写该 canonical 资产自身的可见增量，不能把其他独立角色或道具的状态吸收到场景/角色变体里，也不能重写 canonical 身份。
7. MBTI、九型人格和表演流派必须真正服务行为、表演、分镜或声音，不能推断外貌刻板印象；已有明确值保持不变。
8. reason 与 evidence 必须能核对；模型自己产生的标签错误、漏项和连续性冲突应通过 repair 数组直接修正。
9. 每个 variant 的 visibleDelta 与 promptModifiers 必须足以让图片或视频模型在不改写 canonical 身份的前提下稳定复现该状态；只解释剧情、不描述可见增量的变体不能通过。
10. profileRepairs 只返回需要新增或替换的完整 profile；decisionRepairs 只返回需要新增或替换的完整 decision。不要重复返回未修改项。系统按 assetId 或 sceneId + assetId 合并补丁并自动复检。
11. 先确定必要修正，再检查应用这些修正后的候选。issues 只列修正后仍然存在的问题；已修正的问题写入 summary，不要一边声明已修正、一边把同一问题保留在 issues 中。
12. 如果当前候选已经完全合格，两个 repair 数组必须都返回空数组，不做润色、同义改写或可选优化。
13. 只有不低于 ${reviewThreshold} 分、无 blocking 或 warning 问题、结构校验可通过且不再需要 repair 时，verdict 才能为 pass。

请只返回 JSON：score、verdict（pass 或 needs_revision）、summary、issues、profileRepairs、decisionRepairs。`;

export const applyProductionAssetPreparationRepairs = (
  candidate: Record<string, unknown>,
  profileRepairs: unknown,
  decisionRepairs: unknown,
) => {
  const profiles = Array.isArray(candidate.profiles) ? [...candidate.profiles] : [];
  const decisions = Array.isArray(candidate.decisions) ? [...candidate.decisions] : [];
  for (const repair of Array.isArray(profileRepairs) ? profileRepairs : []) {
    if (!repair || typeof repair !== "object") continue;
    const assetId = String((repair as Record<string, unknown>).assetId || "").trim();
    if (!assetId) continue;
    const index = profiles.findIndex((item) => item && typeof item === "object"
      && String((item as Record<string, unknown>).assetId || "").trim() === assetId);
    if (index >= 0) profiles[index] = repair;
    else profiles.push(repair);
  }
  for (const repair of Array.isArray(decisionRepairs) ? decisionRepairs : []) {
    if (!repair || typeof repair !== "object") continue;
    const record = repair as Record<string, unknown>;
    const sceneId = String(record.sceneId || "").trim();
    const assetId = String(record.assetId || "").trim();
    if (!sceneId || !assetId) continue;
    const index = decisions.findIndex((item) => {
      if (!item || typeof item !== "object") return false;
      const current = item as Record<string, unknown>;
      return String(current.sceneId || "").trim() === sceneId
        && String(current.assetId || "").trim() === assetId;
    });
    if (index >= 0) decisions[index] = repair;
    else decisions.push(repair);
  }
  return { ...candidate, profiles, decisions };
};

export const useProductionAssetPreparationAI = ({
  project,
  episodes,
  updateProject,
  updateScene,
}: {
  project: Project | null;
  episodes: Episode[];
  updateProject: (updates: Partial<Project>) => Promise<void>;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => Promise<void>;
}) => {
  const [promptRequest, setPromptRequest] = useState<ProductionAssetPreparationPromptRequest | null>(null);
  const [candidate, setCandidate] = useState<ProductionAssetPreparationCandidate | null>(null);
  const [stage, setStage] = useState<ProductionAssetPreparationStage>("idle");
  const context = useMemo(
    () => project ? buildProductionAssetPreparationContext(project, episodes) : null,
    [episodes, project],
  );
  const contextSelection = useMemo(() => {
    if (!project) return { options: [], defaultIds: [] };
    const gathered = gatherContextOptions(project, "generate_visuals");
    return {
      options: gathered.options,
      defaultIds: [],
    };
  }, [project]);

  const openPrompt = () => {
    if (!project || !context) return;
    if (!context.assets.length || !context.usages.length) {
      toast.error("当前项目还没有可治理的结构化场次资产，请先完成场次拆解。");
      return;
    }
    setPromptRequest({
      templateId: "productionAssetPreparationBatch",
      title: "整批资产筹备 - 一次确认",
      variables: {
        projectTitle: project.title,
        projectType: getProjectTypeLabel(project.type),
        creativeVision: formatCreativeVision(project.creativeVision),
        sourceDocuments: JSON.stringify(context.scenes.map((item) => ({
          episodeTitle: item.episodeTitle,
          sceneTitle: item.sceneTitle,
          script: item.script,
          ...(item.sourceEvidence && item.sourceEvidence !== item.script ? { sourceEvidence: item.sourceEvidence } : {}),
        })), null, 2),
        canonicalAssets: JSON.stringify(context.assets, null, 2),
        sceneUsages: JSON.stringify({
          scenes: context.scenes.map((item) => ({
            sceneId: item.sceneId,
            sceneTitle: item.sceneTitle,
            structuredBreakdown: item.structuredBreakdown,
          })),
          usages: context.usages,
        }, null, 2),
        departmentOutputs: JSON.stringify(context.departmentOutputs.map(({ sourceHash: _sourceHash, episodeId: _episodeId, ...item }) => item), null, 2),
      },
      contextOptions: contextSelection.options,
      defaultSelectedContextIds: contextSelection.defaultIds,
    });
  };

  const reviewCandidate = async ({
    rawCandidate: initialRawCandidate,
    finalPrompt,
    metadata,
    previousAttempts = [],
  }: {
    rawCandidate: Record<string, unknown>;
    finalPrompt: string;
    metadata?: PromptEditorConfirmMetadata;
    previousAttempts?: ProductionAssetPreparationReviewAttempt[];
  }): Promise<ProductionAssetPreparationCandidate> => {
    if (!project || !context) throw new Error("当前项目资产上下文不可用");
    let rawCandidate = initialRawCandidate;
    let normalized = normalizeProductionAssetPreparationCandidate({ raw: rawCandidate, project, context });
    const attempts = [...previousAttempts];
    let review: ProductionAssetPreparationReview = {
      score: 0,
      verdict: "needs_revision",
      summary: "候选尚未通过自动质检。",
      issues: [],
      attempts,
    };
    const reviewModelId = useAIConfigStore.getState().routing.qcAnalyzer;
    setStage("qa");
    for (let reviewIndex = 0; reviewIndex < maxReviewAttempts; reviewIndex += 1) {
      const attempt = attempts.length + 1;
      const reviewPrompt = buildProductionAssetPreparationReviewPrompt({
        context,
        candidate: rawCandidate,
        structureErrors: normalized.structureErrors,
        attempt,
      });
      const reviewResponse = await generateAIContent({
        prompt: reviewPrompt,
        taskType: "qcAnalyzer",
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            verdict: { type: Type.STRING },
            summary: { type: Type.STRING },
            issues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING },
                  targetType: { type: Type.STRING },
                  targetId: { type: Type.STRING },
                  description: { type: Type.STRING },
                  suggestion: { type: Type.STRING },
                },
                required: ["severity", "targetType", "targetId", "description", "suggestion"],
              },
            },
            profileRepairs: { type: Type.ARRAY, items: profileSchema },
            decisionRepairs: { type: Type.ARRAY, items: decisionSchema },
          },
          required: ["score", "verdict", "summary", "issues", "profileRepairs", "decisionRepairs"],
        },
      });
      const parsedReview = safeParseAIResponse<Record<string, unknown>>(reviewResponse, {});
      const beforeRepairFingerprint = normalizedCandidateFingerprint(normalized);
      rawCandidate = applyProductionAssetPreparationRepairs(
        rawCandidate,
        parsedReview.profileRepairs,
        parsedReview.decisionRepairs,
      );
      normalized = normalizeProductionAssetPreparationCandidate({ raw: rawCandidate, project, context });
      const candidateChanged = normalizedCandidateFingerprint(normalized) !== beforeRepairFingerprint;
      const score = Math.max(0, Math.min(100, Number(parsedReview.score) || 0));
      const issues = normalizeIssues(parsedReview.issues);
      const passed = String(parsedReview.verdict || "").toLowerCase() === "pass"
        && score >= reviewThreshold
        && !issues.some((issue) => issue.severity !== "advisory")
        && !candidateChanged
        && normalized.structureErrors.length === 0;
      const verdict = passed ? "pass" : "needs_revision";
      const reviewSummary = String(parsedReview.summary || (passed ? "候选通过自动质检。" : "候选仍需修正。"));
      const summary = candidateChanged
        ? `${reviewSummary} 本轮已写入修正，正在使用修正后候选复检。`
        : reviewSummary;
      attempts.push({ attempt, finalPrompt: reviewPrompt, modelId: reviewModelId, score, verdict, summary });
      review = { score, verdict, summary, issues, attempts };
      if (passed) break;
    }
    return {
      ...normalized,
      context,
      finalPrompt,
      modelId: useAIConfigStore.getState().routing.scriptGen,
      review,
      metadata,
    };
  };

  const publishReviewedCandidate = (reviewedCandidate: ProductionAssetPreparationCandidate) => {
    setCandidate(reviewedCandidate);
    setStage(reviewedCandidate.review.verdict === "pass" ? "ready" : "failed");
    if (reviewedCandidate.review.verdict === "pass") toast.success(`资产筹备候选已完成，自动质检 ${reviewedCandidate.review.score} 分`);
    else toast("资产筹备候选有修改建议，请查看后决定是否采用");
  };

  const executePrompt = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!project || !context || stage === "generating" || stage === "qa" || stage === "adopting") return;
    setPromptRequest(null);
    setStage("generating");
    try {
      const response = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema: candidateSchema,
      });
      const rawCandidate = safeParseAIResponse<Record<string, unknown>>(response, {});
      publishReviewedCandidate(await reviewCandidate({ rawCandidate, finalPrompt, metadata }));
    } catch (error) {
      const summary = summarizeUnknownError(error);
      console.error("Production asset preparation failed:", summary.message);
      setStage("failed");
      toast.error(summary.message || "整批资产筹备失败");
    }
  };

  const adoptCandidate = async () => {
    if (!project || !candidate || stage === "adopting") return;
    setStage("adopting");
    try {
      const now = Date.now();
      const batchId = `asset-preparation-${now}-${crypto.randomUUID()}`;
      const profileById = new Map(candidate.profiles.map((profile) => [profile.assetId, profile]));
      const newVariantById = new Map<string, { id: string; name: string; description: string; promptModifiers: string }>();
      candidate.decisions.filter((decision) => decision.use === "variant" && !decision.existingVariantId).forEach((decision) => {
        const id = productionAssetPreparationVariantId(decision);
        newVariantById.set(id, {
          id,
          name: decision.variantName || "状态变体",
          description: decision.visibleDelta || "",
          promptModifiers: decision.promptModifiers || "",
        });
      });
      const characters = project.characters.map((character) => {
        const profile = profileById.get(character.id);
        return {
          ...character,
          ...(profile ? profile.proposedValues : {}),
          variants: mergeProductionAssetPreparationVariants(character.id, character.variants || [], candidate.decisions),
        };
      });
      const assets = project.assets.map((asset) => {
        const profile = profileById.get(asset.id);
        return {
          ...asset,
          ...(profile ? profile.proposedValues : {}),
          variants: mergeProductionAssetPreparationVariants(asset.id, asset.variants || [], candidate.decisions),
        };
      });
      const promptHash = manualFilmTeamScriptHash(candidate.finalPrompt);
      const reviewAttempts = candidate.review.attempts.map((attempt) => ({
        ...attempt,
        promptHash: manualFilmTeamScriptHash(attempt.finalPrompt),
      }));
      const profileRevisions = candidate.profiles.filter((profile) => profile.changedFields.length).map((profile) => ({
        assetId: profile.assetId,
        assetType: profile.assetType,
        templateId: "productionAssetPreparationBatch",
        workflowStepId: candidate.metadata?.workflowStepId,
        promptHash,
        finalPrompt: candidate.finalPrompt,
        modelId: candidate.modelId,
        selectedSkillIds: candidate.metadata?.selectedSkillIds || [],
        selectedSkillTitles: candidate.metadata?.selectedSkillTitles || [],
        selectedContextIds: candidate.metadata?.selectedContextIds || [],
        changedFields: profile.changedFields,
        beforeValues: Object.fromEntries(profile.changedFields.map((field) => [field, profile.currentValues[field]])),
        adoptedValues: Object.fromEntries(profile.changedFields.map((field) => [field, profile.proposedValues[field]])),
        evidence: profile.evidence,
        assumptions: profile.assumptions,
        reviewScore: candidate.review.score,
        reviewVerdict: candidate.review.verdict,
        reviewSummary: candidate.review.summary,
        reviewIssues: candidate.review.issues.map((issue) => ({
          severity: issue.severity,
          field: issue.targetId,
          description: issue.description,
          suggestion: issue.suggestion,
        })),
        reviewAttempts,
        createdAt: now,
        updatedAt: now,
      }));
      const variantAudits = Array.from(newVariantById.keys()).map((variantId) => {
        const decisions = candidate.decisions.filter((decision) => decision.use === "variant" && productionAssetPreparationVariantId(decision) === variantId);
        const first = decisions[0];
        return {
          variantId,
          assetId: first.assetId,
          assetType: first.assetType,
          sourceSceneId: first.sceneId,
          sourceSceneIds: decisions.map((decision) => decision.sceneId),
          preparationBatchId: batchId,
          stateSummaryHash: manualFilmTeamScriptHash(JSON.stringify(decisions.map((decision) => ({ sceneId: decision.sceneId, visibleDelta: decision.visibleDelta })))),
          promptHash,
          finalPrompt: candidate.finalPrompt,
          modelId: candidate.modelId,
          reason: first.reason,
          evidence: first.evidence,
          selectedSkillIds: candidate.metadata?.selectedSkillIds || [],
          selectedSkillTitles: candidate.metadata?.selectedSkillTitles || [],
          selectedContextIds: candidate.metadata?.selectedContextIds || [],
          createdAt: now,
          updatedAt: now,
        };
      });
      await updateProject({
        characters,
        assets,
        manualProductionAssets: {
          schemaVersion: "manual-production-assets.v1",
          approvals: project.manualProductionAssets?.approvals || [],
          references: project.manualProductionAssets?.references || [],
          pendingReferences: project.manualProductionAssets?.pendingReferences || [],
          variants: [
            ...(project.manualProductionAssets?.variants || []),
            ...variantAudits.filter((audit) => !project.manualProductionAssets?.variants?.some((existing) => existing.variantId === audit.variantId)),
          ],
          profileRevisions: [...(project.manualProductionAssets?.profileRevisions || []), ...profileRevisions],
          preparationBatches: [
            ...(project.manualProductionAssets?.preparationBatches || []),
            {
              id: batchId,
              episodeIds: candidate.context.episodeIds,
              templateId: "productionAssetPreparationBatch",
              workflowStepId: candidate.metadata?.workflowStepId,
              sourceHash: candidate.context.sourceHash,
              promptHash,
              finalPrompt: candidate.finalPrompt,
              modelId: candidate.modelId,
              selectedSkillIds: candidate.metadata?.selectedSkillIds || [],
              selectedSkillTitles: candidate.metadata?.selectedSkillTitles || [],
              selectedContextIds: candidate.metadata?.selectedContextIds || [],
              changedProfileAssetIds: profileRevisions.map((revision) => revision.assetId),
              variantIds: Array.from(newVariantById.keys()),
              decisions: candidate.decisions.map((decision) => ({
                sceneId: decision.sceneId,
                assetId: decision.assetId,
                assetType: decision.assetType,
                use: decision.use,
                variantId: decision.use === "variant" ? productionAssetPreparationVariantId(decision) : undefined,
                variantKey: decision.variantKey,
                reason: decision.reason,
                evidence: decision.evidence,
              })),
              reviewScore: candidate.review.score,
              reviewVerdict: candidate.review.verdict,
              reviewSummary: candidate.review.summary,
              reviewIssues: candidate.review.issues,
              reviewAttempts,
              createdAt: now,
              updatedAt: now,
            },
          ],
          updatedAt: now,
        },
      });
      const sceneUpdates = buildProductionAssetPreparationSceneUpdates(episodes, candidate.decisions);
      for (const update of sceneUpdates) {
        await updateScene(update.sceneId, { breakdown: update.breakdown }, update.episodeId);
      }
      setCandidate(null);
      setStage("idle");
      toast.success(`已采用整批资产筹备：${profileRevisions.length} 个档案、${newVariantById.size} 个状态变体、${sceneUpdates.length} 个场次绑定`);
    } catch (error) {
      setStage("failed");
      toast.error(error instanceof Error ? error.message : "整批资产候选采用失败");
    }
  };

  const rerunCandidate = async () => {
    if (!candidate || stage === "generating" || stage === "qa" || stage === "adopting") return;
    const previousCandidate = candidate;
    const rawCandidate = {
      profiles: candidate.profiles.map((profile) => ({
        ...profile.proposedValues,
        assetId: profile.assetId,
        assetType: profile.assetType,
        name: profile.proposedValues.name || profile.assetName,
        evidence: profile.evidence,
        assumptions: profile.assumptions,
      })),
      decisions: candidate.decisions,
    };
    setCandidate(null);
    try {
      publishReviewedCandidate(await reviewCandidate({
        rawCandidate,
        finalPrompt: candidate.finalPrompt,
        metadata: candidate.metadata,
        previousAttempts: candidate.review.attempts,
      }));
    } catch (error) {
      console.error("Production asset preparation review continuation failed:", summarizeUnknownError(error));
      setCandidate(previousCandidate);
      setStage("failed");
      toast.error(error instanceof Error ? error.message : "资产候选继续优化失败");
    }
  };

  const progress = stage === "generating" ? 34 : stage === "qa" ? 72 : stage === "adopting" ? 92 : stage === "ready" ? 100 : 0;
  return {
    promptRequest,
    candidate,
    stage,
    progress,
    context,
    openPrompt,
    closePrompt: () => setPromptRequest(null),
    executePrompt,
    rerunCandidate,
    adoptCandidate,
    discardCandidate: () => {
      setCandidate(null);
      setStage("idle");
    },
  };
};
