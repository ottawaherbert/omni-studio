import { useRef, useState } from "react";
import toast from "react-hot-toast";

import { generateAIContent } from "../clients/aiClient";
import { Type } from "../clients/aiSchemaClient";
import type { AIExecutionProvenance, Asset, Character, Episode, Project } from "../clients/domainTypes";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import { manualFilmTeamScriptHash } from "../clients/productionPreparationWorkflowClient";
import {
  buildProductionAssetProfileContext,
  productionAssetProfileTarget,
  characterProductionFields,
  characterProfileTaskInstruction,
  characterProfileProposal,
  assetDesignTaskInstruction, assetDesignContext, assetDesignProposal, assetIdentityReference, assetVisualDescription,
  type CharacterProfileTask,
} from "../clients/productionAssetWorkflowClient";
import { safeParseAIResponse } from "../utils/aiParser";
import { gatherContextOptions } from "../utils/contextMapper";
import { summarizeUnknownError } from "../utils/logging";
import { formatCreativeVision, getProjectTypeLabel } from "../utils/projectUtils";
import { legacyProjectClient } from "../clients/legacyProjectClient";

/** Read source bodies on demand; workspace shells intentionally omit them. */
export const loadProductionAssetProfileSources = async (project: Project) => {
  const [sourceDocuments, episodes] = await Promise.all([
    Promise.all((project.productionSourceDocuments || []).map(async (document) => {
      if (document.content.trim()) return document;
      const workspace = await legacyProjectClient.getProject(project.id, "production-workspace", { sourceDocumentId: document.id });
      const source = workspace?.productionSourceDocuments?.find((item) => item.id === document.id);
      if (!source?.content.trim()) throw new Error(`无法读取完整来源「${document.title}」，本次尚未生成提示词，请稍后重试。`);
      return source;
    })),
    Promise.all(project.episodes.map(async (episode) => {
      const fullEpisode = await legacyProjectClient.getEpisode(project.id, episode.id, "production-preparation", { scope: "episode" });
      if (!fullEpisode) throw new Error(`无法读取分集「${episode.title}」的完整场次。`);
      return fullEpisode;
    })),
  ]);
  return { project: { ...project, productionSourceDocuments: sourceDocuments }, episodes };
};

async function readAssetDesignReference(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('读取已有形象参考失败，未开始设计');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('形象参考不是可读取的图片');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(blob);
  });
  return { base64: data.slice(data.indexOf(',') + 1), mimeType: blob.type };
}

export interface ProductionAssetProfilePromptRequest {
  templateId: "productionAssetCharacterProfile" | "productionAssetCatalogProfile" | "productionAssetVisualDesign";
  title: string;
  task?: CharacterProfileTask;
  variables: Record<string, string>;
  contextOptions: Array<{ id: string; label: string; value: string }>;
  defaultSelectedContextIds: string[];
  referenceImageUrl?: string;
  designSourceKey?: string;
}

export interface ProductionAssetProfileCandidate {
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  currentValues: Record<string, unknown>;
  proposedValues: Record<string, unknown>;
  changedFields: string[];
  finalPrompt: string;
  modelId: string;
  executionProvenance?: AIExecutionProvenance;
  review?: ProductionAssetProfileReview;
  task?: CharacterProfileTask;
  sourceLabels?: string[];
  sourceNotes?: string;
  targetKey: string;
  designSourceKey?: string;
  metadata?: PromptEditorConfirmMetadata;
}

export interface ProductionAssetProfileReviewIssue {
  severity: "blocking" | "warning" | "advisory";
  field: string;
  description: string;
  suggestion: string;
}

export interface ProductionAssetProfileReviewAttempt {
  attempt: number;
  finalPrompt: string;
  modelId: string;
  executionProvenance?: AIExecutionProvenance;
  score: number;
  verdict: "pass" | "needs_revision";
  summary: string;
}

export interface ProductionAssetProfileReview {
  score: number;
  verdict: "pass" | "needs_revision";
  summary: string;
  issues: ProductionAssetProfileReviewIssue[];
  attempts: ProductionAssetProfileReviewAttempt[];
}

const characterFields = [
  "name",
  "visualIdentity",
  "psychologicalProfile",
  "mbti",
  "enneagram",
  "internalDesire",
  "externalGoal",
  "flaw",
  "actingStyle",
  "vocalQuirk",
  "sliders",
] as const;

const assetFields = ["name", "description", "tags"] as const;
const profileReviewThreshold = 90;
const maxProfileReviewAttempts = 2;

const characterProfileSchema = {
  type: Type.OBJECT,
  properties: Object.fromEntries([...characterProductionFields, "sourceNotes"].map(field => [field, { type: Type.STRING }])),
};

const assetProfileSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [...assetFields],
};

const projectInspiration = (project: Project) => [
  project.originalInspiration ? `【原初创意】\n${project.originalInspiration}` : "",
  project.refinedInspiration ? `【已确认创作方向】\n${project.refinedInspiration}` : "",
].filter(Boolean).join("\n\n");

const designSourceKey = (project: Project, owner: Character | Asset) => JSON.stringify([assetDesignContext(project, owner), assetIdentityReference(owner)]);

const fieldRecord = (target: Character | Asset, fields: readonly string[]) => Object.fromEntries(
  fields.map((field) => [field, (target as unknown as Record<string, unknown>)[field]]),
);

const normalizedProposal = (raw: Record<string, unknown>, fields: readonly string[]) => {
  const proposal: Record<string, unknown> = {};
  for (const field of fields) {
    const value = raw[field];
    if (field === "sliders") {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const sliders: Record<string, number> = {};
      for (const [key, item] of Object.entries(value)) {
        const numericValue = Number(item);
        if (key.trim() && Number.isFinite(numericValue)) {
          sliders[key.trim()] = Math.max(-10, Math.min(10, Math.round(numericValue)));
        }
      }
      if (Object.keys(sliders).length) proposal[field] = sliders;
      continue;
    }
    if (field === "tags") {
      if (Array.isArray(value)) proposal[field] = value.map((item) => String(item).trim()).filter(Boolean);
      continue;
    }
    const text = String(value || "").trim();
    if (text) proposal[field] = text;
  }
  return proposal;
};

const hasMeaningfulValue = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value || "").trim().length > 0;
};

/** Enrichment fills gaps; changing adopted identity keys belongs to an explicit asset change flow. */
export const applyProductionAssetProfileEnrichmentLocks = ({
  currentValues,
  proposedValues,
  isCharacter,
}: {
  currentValues: Record<string, unknown>;
  proposedValues: Record<string, unknown>;
  isCharacter: boolean;
}) => {
  const result = { ...proposedValues };
  const lockedFields = isCharacter ? ["name", "mbti", "enneagram"] : ["name"];
  for (const field of lockedFields) {
    if (hasMeaningfulValue(currentValues[field])) result[field] = currentValues[field];
  }
  return result;
};

export const buildProductionAssetProfileReviewPrompt = ({
  generationPrompt,
  currentValues,
  proposedValues,
  isCharacter,
  attempt,
}: {
  generationPrompt: string;
  currentValues: Record<string, unknown>;
  proposedValues: Record<string, unknown>;
  isCharacter: boolean;
  attempt: number;
}) => `【项目资产档案候选质检与修正 · 第 ${attempt} 轮】
这是创作者已一次确认后的自动复检步骤。请使用下方同一份完整证据审查候选；不要向创作者转交可由你修正的标签、事实混淆、场次状态混入或字段冲突。

【首次确认的完整提示词与证据】
${generationPrompt}

【当前已采用项目事实】
${JSON.stringify(currentValues, null, 2)}

【本轮待审候选】
${JSON.stringify(proposedValues, null, 2)}

【硬性标准】
1. 完整保留来源剧本、已确认拆解和已确认创作者决定中的稳定锚点，不得改色、替换、遗漏或泛化。
2. 来源未锁定的设计必须明确标记为【候选设计】；例如来源只写了发型、饰品和服装时，模型自行提出的年龄、脸型、体态、材质仍是候选，不能写成事实。
3. 项目级基础身份不得混入灯光阶段、天气、损毁、湿身、显影进度、持有物、摆位、当场动作或单场情绪；这些属于状态变体或场次执行。
4. 这是补全流程。${isCharacter ? "姓名、MBTI、九型人格" : "正式资产名称"}等已有明确值必须保持不变；若需要改动，应由独立修改流程处理。
5. 心理、目标、弱点、表演和声音字段必须互相一致、能被后续 Agent 执行，并清楚区分剧本事实与专业建议。
6. 不得用 MBTI、九型人格、阶层、职业或表演流派推断外貌刻板印象。
7. 发现问题时直接在 repairedValues 中给出完整修正版；不要只写建议。修正版必须保留没有问题的字段。
8. 只有评分不低于 ${profileReviewThreshold}、无 blocking 问题且修正版满足以上标准时 verdict 才能为 pass。

请只返回 JSON：
- score：0-100。
- verdict：pass 或 needs_revision。
- summary：质检结论。
- issues：数组，每项含 severity（blocking/warning/advisory）、field、description、suggestion。
- repairedValues：${isCharacter ? "完整角色档案对象" : "完整场景/道具档案对象"}。`;

const normalizeReviewIssues = (value: unknown): ProductionAssetProfileReviewIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const rawSeverity = String(record.severity || "warning");
    const severity: ProductionAssetProfileReviewIssue["severity"] = rawSeverity === "blocking" || rawSeverity === "advisory"
      ? rawSeverity
      : "warning";
    const description = String(record.description || "").trim();
    if (!description) return [];
    return [{
      severity,
      field: String(record.field || "profile").trim() || "profile",
      description,
      suggestion: String(record.suggestion || "请按同一份来源证据修正。"),
    }];
  });
};

export const useProductionAssetProfileAI = ({
  project,
  character,
  asset,
  episodes,
  updateProject,
}: {
  project: Project | null;
  character?: Character;
  asset?: Asset;
  episodes: Episode[];
  updateProject: (updates: Partial<Project>) => Promise<void>;
}) => {
  const [promptRequest, setPromptRequest] = useState<ProductionAssetProfilePromptRequest | null>(null);
  const [candidate, setCandidate] = useState<ProductionAssetProfileCandidate | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const target = character || asset;
  const targetKey = `${project?.id || ""}:${target?.id || ""}`;
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;

  const openPrompt = async (task: CharacterProfileTask = "extract") => {
    if (!project || !target || isGenerating) return;
    const requestKey = targetKey;
    setRequestError("");
    setIsGenerating(true);
    try {
      const loaded = await loadProductionAssetProfileSources(project);
      if (targetKeyRef.current !== requestKey) return;
      const gathered = gatherContextOptions(project, character ? "regenerateCharacter" : "regenerateAsset");
      const productionContext = buildProductionAssetProfileContext(loaded.project, productionAssetProfileTarget(target), loaded.episodes);
      const isCharacter = Boolean(character);
      const kind = productionAssetProfileTarget(target).kind;
      const designContext = assetDesignContext(loaded.project, target);
      const instruction = task === "appearance" ? assetDesignTaskInstruction(kind, designContext.visualStyle) : characterProfileTaskInstruction(task);
      setPromptRequest({
        templateId: task === "appearance" ? "productionAssetVisualDesign" : isCharacter ? "productionAssetCharacterProfile" : "productionAssetCatalogProfile",
        title: task === "appearance" ? `设计形象 · ${target.name}` : isCharacter ? "从已导入剧本整理" : "AI 补全制作档案",
        task,
        referenceImageUrl: task === 'appearance' ? assetIdentityReference(target) : undefined,
        designSourceKey: task === 'appearance' ? designSourceKey(project, target) : undefined,
        variables: {
          profileTask: instruction,
          assetDesignContext: JSON.stringify(designContext, null, 2),
          sourceCoverage: productionContext.options.length ? productionContext.options.map(option => option.label).join("；") : "暂无可读取的来源。整理任务不得补造资料；外观设计只能作为候选。",
          inspirationContext: projectInspiration(project),
          characterName: isCharacter ? `角色名：${target.name}` : "",
          assetName: isCharacter ? "" : `${asset?.type === "location" ? "场景" : "道具"}名：${target.name}`,
          type: getProjectTypeLabel(project.type),
          creativeVision: formatCreativeVision(project.creativeVision),
          currentProfile: JSON.stringify(task === 'appearance' ? { name: target.name, [isCharacter ? 'visualIdentity' : 'description']: assetVisualDescription(target) } : fieldRecord(target, isCharacter ? characterFields : assetFields), null, 2) + (task === "appearance" ? "" : `\n本次任务边界：${instruction}`),
        },
        contextOptions: [...gathered.options, ...productionContext.options],
        defaultSelectedContextIds: productionContext.defaultIds,
      });
    } catch (error) {
      if (targetKeyRef.current === requestKey) { const message = error instanceof Error ? error.message : "读取资产来源失败"; setRequestError(message); toast.error(message); }
    } finally {
      setIsGenerating(false);
    }
  };

  const executePrompt = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!project || !target || isGenerating) return;
    const requestKey = targetKey;
    const task = promptRequest?.task || "extract";
    if (task === 'appearance' && promptRequest?.designSourceKey !== designSourceKey(project, target)) { setRequestError('形象依据已更新，请重新打开设计'); toast.error('形象依据已更新，请重新打开设计'); throw new Error('形象依据已更新，请重新打开设计'); }
    const selectedIds = metadata?.selectedContextIds ?? promptRequest?.defaultSelectedContextIds ?? [];
    const sourceLabels = promptRequest?.contextOptions.filter(option => selectedIds.includes(option.id)).map(option => option.label) || [];
    setRequestError("");
    setIsGenerating(true);
    try {
      const isCharacter = Boolean(character);
      const fields = task === "appearance" ? [isCharacter ? "visualIdentity" : "description"] : isCharacter ? characterProductionFields : assetFields;
      const currentValues = fieldRecord(target, fields);
      const profileSchema = task === "appearance" ? {
        type: Type.OBJECT, properties: { [isCharacter ? 'visualIdentity' : 'description']: { type: Type.STRING }, sourceNotes: { type: Type.STRING } },
      } : isCharacter ? characterProfileSchema : assetProfileSchema;
      const reference = task === 'appearance' ? assetIdentityReference(target) : undefined;
      const mediaData = reference ? await readAssetDesignReference(reference) : undefined;
      let generationPrompt = finalPrompt;
      let generationExecution: AIExecutionProvenance | undefined;
      const response = await generateAIContent({
        prompt: finalPrompt,
        mediaData,
        requireJson: true,
        schema: profileSchema,
        onExecutionProvenance: audit => { generationExecution = audit; },
        onPromptComposed: audit => { generationPrompt = [audit.systemInstruction, audit.prompt].filter(Boolean).join("\n\n"); },
      });
      const parsed = safeParseAIResponse<Record<string, unknown>>(response, {});
      let proposedValues = applyProductionAssetProfileEnrichmentLocks({
        currentValues,
        proposedValues: normalizedProposal(parsed, fields),
        isCharacter,
      });
      if (task === "appearance") proposedValues = assetDesignProposal(parsed, target);
      else if (isCharacter) proposedValues = characterProfileProposal(parsed, currentValues, task);
      const reviewAttempts: ProductionAssetProfileReviewAttempt[] = [];
      let review: ProductionAssetProfileReview = {
        score: 0,
        verdict: "needs_revision",
        summary: "候选尚未通过质检。",
        issues: [],
        attempts: reviewAttempts,
      };

      for (let attempt = 1; attempt <= (isCharacter || task === "appearance" ? 0 : maxProfileReviewAttempts); attempt += 1) {
        let reviewExecution: AIExecutionProvenance | undefined;
        let reviewPrompt = buildProductionAssetProfileReviewPrompt({
          generationPrompt,
          currentValues,
          proposedValues,
          isCharacter,
          attempt,
        });
        const reviewResponse = await generateAIContent({
          prompt: reviewPrompt,
          taskType: "qcAnalyzer",
          onExecutionProvenance: audit => { reviewExecution = audit; },
          onPromptComposed: audit => { reviewPrompt = [audit.systemInstruction, audit.prompt].filter(Boolean).join("\n\n"); },
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
                    field: { type: Type.STRING },
                    description: { type: Type.STRING },
                    suggestion: { type: Type.STRING },
                  },
                  required: ["severity", "field", "description", "suggestion"],
                },
              },
              repairedValues: profileSchema,
            },
            required: ["score", "verdict", "summary", "issues", "repairedValues"],
          },
        });
        const parsedReview = safeParseAIResponse<Record<string, unknown>>(reviewResponse, {});
        const repairedValues = parsedReview.repairedValues && typeof parsedReview.repairedValues === "object"
          ? normalizedProposal(parsedReview.repairedValues as Record<string, unknown>, fields)
          : {};
        proposedValues = applyProductionAssetProfileEnrichmentLocks({
          currentValues,
          proposedValues: { ...proposedValues, ...repairedValues },
          isCharacter,
        });
        const score = Math.max(0, Math.min(100, Number(parsedReview.score) || 0));
        const issues = normalizeReviewIssues(parsedReview.issues);
        const passed = String(parsedReview.verdict || "").toLowerCase() === "pass"
          && score >= profileReviewThreshold
          && !issues.some((issue) => issue.severity === "blocking");
        const verdict = passed ? "pass" : "needs_revision";
        const summary = String(parsedReview.summary || (passed ? "候选通过质检。" : "候选需要继续修正。"));
        reviewAttempts.push({ attempt, finalPrompt: reviewPrompt, modelId: reviewExecution?.modelId || "unknown", executionProvenance: reviewExecution, score, verdict, summary });
        review = { score, verdict, summary, issues, attempts: reviewAttempts };
        if (passed) break;
      }

      const changedFields = fields.filter((field) =>
        field in proposedValues && JSON.stringify(currentValues[field]) !== JSON.stringify(proposedValues[field])
      );
      if (targetKeyRef.current !== requestKey) return;
      if (!changedFields.length && !isCharacter && task !== "appearance") {
        toast.error("AI 没有给出可采用的档案变化");
        return;
      }
      setCandidate({
        assetId: target.id,
        assetType: isCharacter ? "character" : asset!.type as "location" | "prop" | "vehicles",
        assetName: target.name,
        currentValues,
        proposedValues,
        changedFields: [...changedFields],
        finalPrompt: generationPrompt,
        modelId: generationExecution?.modelId || "unknown",
        executionProvenance: generationExecution,
        review: isCharacter || task === "appearance" ? undefined : review,
        task,
        sourceLabels,
        sourceNotes: typeof parsed.sourceNotes === "string" ? parsed.sourceNotes : "模型未提供来源说明，请对照原文核对候选。",
        targetKey: requestKey,
        designSourceKey: task === 'appearance' ? designSourceKey(project, target) : undefined,
        metadata,
      });
      if (isCharacter || task === "appearance") toast(changedFields.length ? "整理完成，请对照来源查看候选" : "没有新增的可确认信息，已有资料保持不变");
      else if (review.verdict === "pass") toast.success(`档案候选已生成，质检 ${review.score} 分`);
      else toast("档案候选有修改建议，请查看后决定是否采用");
    } catch (error) {
      console.error("Production asset profile generation failed:", summarizeUnknownError(error));
      if (targetKeyRef.current === requestKey) { const message = error instanceof Error ? error.message : "档案生成失败"; setRequestError(message); toast.error(message); }
      throw error;
    } finally {
      setIsGenerating(false);
    }
  };

  const adoptCandidate = async () => {
    if (!project || !candidate || isAdopting || !candidate.changedFields.length) return;
    if (candidate.targetKey !== targetKeyRef.current) { setCandidate(null); toast.error("项目或角色已切换，请重新整理"); return; }
    const liveOwner = candidate.assetType === "character" ? project.characters.find(item => item.id === candidate.assetId) : project.assets.find(item => item.id === candidate.assetId);
    if (!liveOwner || liveOwner.name !== candidate.assetName || candidate.changedFields.some(field => JSON.stringify((liveOwner as unknown as Record<string, unknown>)[field]) !== JSON.stringify(candidate.currentValues[field]))) {
      toast.error("资料已在预览后修改，请重新整理，避免覆盖手动内容"); return;
    }
    if (candidate.task === 'appearance' && candidate.designSourceKey !== designSourceKey(project, liveOwner)) { toast.error('形象依据或参考图已更新，请重新设计后核对'); return; }
    if (candidate.task === 'appearance' && candidate.changedFields.some(field => !String(candidate.proposedValues[field] || '').trim())) { toast.error('请填写具体外观后再采用'); return; }
    setIsAdopting(true);
    try {
      const changedValues = Object.fromEntries(candidate.changedFields.map((field) => [field, candidate.proposedValues[field]]));
      const now = Date.now();
      const updates: Partial<Project> = {
        characters: project.characters.map((item) => item.id === candidate.assetId ? { ...item, ...changedValues, ...(candidate.task === "appearance" ? { visualDesignNeedsReview: false } : {}) } : item),
        assets: project.assets.map((item) => item.id === candidate.assetId ? { ...item, ...changedValues, ...(candidate.task === "appearance" ? { visualDesignNeedsReview: false } : {}) } : item),
        manualProductionAssets: {
          ...project.manualProductionAssets,
          schemaVersion: "manual-production-assets.v1",
          approvals: project.manualProductionAssets?.approvals || [],
          references: project.manualProductionAssets?.references || [],
          pendingReferences: project.manualProductionAssets?.pendingReferences || [],
          variants: project.manualProductionAssets?.variants || [],
          preparationBatches: project.manualProductionAssets?.preparationBatches || [],
          profileRevisions: [
            ...(project.manualProductionAssets?.profileRevisions || []),
            {
              assetId: candidate.assetId,
              assetType: candidate.assetType,
              templateId: candidate.metadata?.templateId || (candidate.assetType === "character" ? "productionAssetCharacterProfile" : "productionAssetCatalogProfile"),
              workflowStepId: candidate.metadata?.workflowStepId,
              promptHash: manualFilmTeamScriptHash(candidate.finalPrompt),
              finalPrompt: candidate.finalPrompt,
              modelId: candidate.modelId,
              executionProvenance: candidate.executionProvenance,
              selectedSkillIds: candidate.metadata?.selectedSkillIds || [],
              selectedSkillTitles: candidate.metadata?.selectedSkillTitles || [],
              selectedContextIds: candidate.metadata?.selectedContextIds || [],
              changedFields: candidate.changedFields,
              beforeValues: Object.fromEntries(candidate.changedFields.map((field) => [field, candidate.currentValues[field]])),
              adoptedValues: changedValues,
              evidence: [...(candidate.sourceLabels || []), ...(candidate.sourceNotes ? [candidate.sourceNotes] : [])],
              assumptions: candidate.task === "appearance" ? ["本次为外观设计，新增外观不是剧本提取事实。"] : undefined,
              reviewScore: candidate.review?.score,
              reviewVerdict: candidate.review?.verdict,
              reviewSummary: candidate.review?.summary,
              reviewIssues: candidate.review?.issues,
              reviewAttempts: candidate.review?.attempts.map((attempt) => ({
                ...attempt,
                promptHash: manualFilmTeamScriptHash(attempt.finalPrompt),
              })),
              createdAt: now,
              updatedAt: now,
            },
          ],
          updatedAt: now,
        },
      };
      await updateProject(updates);
      setCandidate(null);
      toast.success("资料已采用，下次生成使用新资料；已有图片、分镜和录音保持不变");
      return { ...project, ...updates };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "采用档案候选失败");
    } finally {
      setIsAdopting(false);
    }
  };

  return {
    promptRequest,
    candidate,
    requestError,
    clearRequestError: () => setRequestError(""),
    isGenerating,
    isAdopting,
    openPrompt,
    editCandidate: (field: string, value: string) => setCandidate(current => {
      if (!current || !current.changedFields.includes(field)) return current;
      return { ...current, proposedValues: { ...current.proposedValues, [field]: value } };
    }),
    closePrompt: () => setPromptRequest(null),
    executePrompt,
    adoptCandidate,
    discardCandidate: () => setCandidate(null),
  };
};
