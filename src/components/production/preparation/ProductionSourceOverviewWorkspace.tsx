import { renderProductionCreativeContext } from "../../../clients/creativeDirectionClient";
import { ProductionCreativeControls } from "../ProductionCreativeControls";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, GitBranch, Layers, Loader2, RefreshCw, Save, Sparkles, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { sha256 } from "js-sha256";

import type {
  Episode,
  ProductionPreparationPromptAudit,
  ProductionScenePlanCandidate,
  ProductionScenePlanQA,
  ProductionScenePlanVersion,
  Project,
  Scene,
} from "../../../clients/domainTypes";
import { generateAIContent } from "../../../clients/aiClient";
import { safeParseAIResponse } from "../../../utils/aiParser";
import { gatherContextOptions } from "../../../utils/contextMapper";
import { productionScenePlanContinuityContext, productionSourceDocumentForEpisode, productionSourceDocumentsForProject, productionSourceTargetDurationMinutes } from "../../../clients/productionPreparationWorkflowClient";
import {
  currentProductionScriptRevision,
  archiveProductionScriptUnit,
  previewWritingScriptSync,
  productionScriptWorkspaceForProject,
  resolveProductionScriptConflictKeepingProduction,
  saveProductionScriptDraft,
  type ProductionScriptMutation,
} from "../../../clients/productionPreparationWorkflowClient";
import { scriptClient } from "../../../../apps/web/src/clients/scriptClient";
import { productionScenesFromPlanCandidate, validateProductionScenePlanSource } from "../../../clients/productionPreparationWorkflowClient";
import PromptEditorModal from "../../PromptEditorModal";
import type { PromptEditorConfirmMetadata } from "../../PromptEditorModal";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { ProductionNarrativeEntitySyncButton } from "./ProductionNarrativeEntitySyncButton";
import { ManualScenePlanEditor, initialManualScenePlan } from "./ManualScenePlanEditor";
import { reconcileProductionScenes } from "./manualScenePlanReconcile";
import { legacyProjectClient } from "../../../clients/legacyProjectClient";
import type { ProductionCanonicalScriptUnit, ProductionSourceDocument, ProductionScriptWorkspace } from "../../../clients/domainTypes";
import type { ScriptExportPackage, ScriptExportUnit, ScriptProjectSummary } from "../../../../packages/domain/src/scriptDelivery";

interface ScenePlanCandidate {
  scenes: ProductionScenePlanCandidate[];
  metadata?: PromptEditorConfirmMetadata;
  prompt: string;
  origin?: "manual";
}

type PromptAction = "plan" | "qa" | "optimize";

interface ScenePlanQaCandidate extends ProductionScenePlanQA {}

type ScriptEditorDraft = {
  title: string;
  summary: string;
  targetDurationMinutes: string;
  content: string;
};

type RecoveredScriptDraft = ScriptEditorDraft & {
  savedAt: number;
  baseRevisionId?: string;
  saveState?: "draft" | "saving";
};

type RecoveredNewUnitDraft = RecoveredScriptDraft & {
  unitId: string;
  sourceDocumentId: string;
  writingUnitId: string;
  placement: "after_current" | "at_end";
};

const text = (value: unknown) => String(value || "").trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const projectScenePlanRepairQa = (qa?: ProductionScenePlanQA) => qa ? ({
  summary: qa.summary,
  issues: qa.issues.filter((issue) => issue.severity !== "advisory"),
}) : undefined;
type InteractivePlanningNode = NonNullable<Project["interactiveProductionPrepProfile"]>["nodes"][number];

const recoveryDraftKey = (projectId: string, sourceDocumentId: string) =>
  `production-script-editor-recovery:${projectId}:${sourceDocumentId}`;
const newUnitRecoveryKey = (projectId: string) => `production-script-new-unit-recovery:${projectId}`;

const readRecoveryDraft = (projectId: string, sourceDocumentId?: string): RecoveredScriptDraft | null => {
  if (!sourceDocumentId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(recoveryDraftKey(projectId, sourceDocumentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveredScriptDraft>;
    if (typeof parsed.content !== "string" || !Number.isFinite(parsed.savedAt)) return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      targetDurationMinutes: typeof parsed.targetDurationMinutes === "string" ? parsed.targetDurationMinutes : "",
      content: parsed.content,
      savedAt: Number(parsed.savedAt),
      baseRevisionId: typeof parsed.baseRevisionId === "string" ? parsed.baseRevisionId : undefined,
      saveState: parsed.saveState === "saving" ? "saving" : "draft",
    };
  } catch {
    return null;
  }
};

const writeRecoveryDraft = (
  projectId: string,
  sourceDocumentId: string | undefined,
  draft: ScriptEditorDraft,
  options: Pick<RecoveredScriptDraft, "baseRevisionId" | "saveState"> = {},
) => {
  if (!sourceDocumentId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recoveryDraftKey(projectId, sourceDocumentId), JSON.stringify({
      ...draft,
      savedAt: Date.now(),
      baseRevisionId: options.baseRevisionId,
      saveState: options.saveState || "draft",
    } satisfies RecoveredScriptDraft));
  } catch {
    // A failed browser cache must not block the formal save request.
  }
};

const clearRecoveryDraft = (projectId: string, sourceDocumentId?: string) => {
  if (!sourceDocumentId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recoveryDraftKey(projectId, sourceDocumentId));
  } catch {
    // Storage can be unavailable in a private browser context. Saving the formal revision still works.
  }
};

const readNewUnitRecovery = (projectId: string): RecoveredNewUnitDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(newUnitRecoveryKey(projectId)) || "null") as Partial<RecoveredNewUnitDraft> | null;
    if (!parsed || typeof parsed.content !== "string" || !parsed.unitId || !parsed.sourceDocumentId || !parsed.writingUnitId) return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      targetDurationMinutes: typeof parsed.targetDurationMinutes === "string" ? parsed.targetDurationMinutes : "",
      content: parsed.content,
      savedAt: Number(parsed.savedAt) || Date.now(),
      baseRevisionId: typeof parsed.baseRevisionId === "string" ? parsed.baseRevisionId : undefined,
      saveState: parsed.saveState === "saving" ? "saving" : "draft",
      unitId: parsed.unitId,
      sourceDocumentId: parsed.sourceDocumentId,
      writingUnitId: parsed.writingUnitId,
      placement: parsed.placement === "at_end" ? "at_end" : "after_current",
    };
  } catch {
    return null;
  }
};

const writeNewUnitRecovery = (
  projectId: string,
  draft: ScriptEditorDraft,
  identity: { unitId: string; sourceDocumentId: string; writingUnitId: string },
  placement: "after_current" | "at_end",
  baseRevisionId: string | null,
  saveState: "draft" | "saving",
) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(newUnitRecoveryKey(projectId), JSON.stringify({
      ...draft,
      ...identity,
      placement,
      baseRevisionId: baseRevisionId || undefined,
      saveState,
      savedAt: Date.now(),
    } satisfies RecoveredNewUnitDraft));
  } catch {
    // A failed browser cache must not block the formal save request.
  }
};

const clearNewUnitRecovery = (projectId: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(newUnitRecoveryKey(projectId));
  } catch {
    // Nothing else depends on the local recovery record.
  }
};

const scriptDraftContentSignature = (draft: ScriptEditorDraft) => JSON.stringify({
  title: draft.title.trim(),
  summary: draft.summary.trim(),
  targetDurationMinutes: draft.targetDurationMinutes.trim(),
  content: draft.content,
});

const screenplayWorkspaceShellForLocalState = (
  workspace: ProductionScriptWorkspace,
  selectedSourceDocumentId?: string,
): ProductionScriptWorkspace => ({
  ...workspace,
  revisions: workspace.revisions.map((revision) => ({
    ...revision,
    units: revision.units.map((unit) => ({
      ...unit,
      content: revision.id === workspace.currentRevisionId && unit.sourceDocumentId === selectedSourceDocumentId
        ? unit.content
        : "",
      __scriptBodyDeferred: !(revision.id === workspace.currentRevisionId && unit.sourceDocumentId === selectedSourceDocumentId),
    })),
  })),
});

const normalizeScenePlan = (value: unknown, sourceContent: string, allowedInteractiveNodeIds: string[]) => {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawScenes = Array.isArray(root.scenes) ? root.scenes : [];
  const candidates = rawScenes.map((raw, index) => {
    const scene = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      id: crypto.randomUUID(),
      order: index + 1,
      title: text(scene.title),
      description: text(scene.description),
      purpose: text(scene.purpose) || undefined,
      sourceEvidence: text(scene.sourceEvidence),
      continuityIn: text(scene.continuityIn) || undefined,
      continuityOut: text(scene.continuityOut) || undefined,
      targetDurationMinutes: Number.isFinite(Number(scene.targetDurationMinutes)) && Number(scene.targetDurationMinutes) > 0
        ? Number(scene.targetDurationMinutes)
        : undefined,
      interactiveNodeIds: unique(
        (Array.isArray(scene.interactiveNodeIds) ? scene.interactiveNodeIds : [])
          .map((nodeId) => text(nodeId))
          .filter((nodeId) => allowedInteractiveNodeIds.includes(nodeId)),
      ),
    };
  });
  if (candidates.some((scene) => !scene.title || !scene.sourceEvidence)) throw new Error("每场都需要标题和完整的原文依据。");
  return { scenes: validateProductionScenePlanSource(sourceContent, candidates) };
};

const writingReference = (project: Project, sourceWritingUnitId?: string) => {
  const snapshot = project.productionSourceSnapshot;
  if (snapshot?.sourceType !== "writing_export" || !sourceWritingUnitId) return "无上游结构参考";
  const unit = snapshot.package.units.find((item) => item.id === sourceWritingUnitId);
  if (!unit) return "无上游结构参考";
  const scenes = (unit.scenes || []).map((scene) => ({
    index: scene.index,
    title: scene.title,
    purpose: scene.purpose,
    goal: scene.goal,
    continuityIn: scene.continuityIn,
    continuityOut: scene.continuityOut,
  }));
  return JSON.stringify({ unit: { index: unit.index, title: unit.title, summary: unit.summary }, scenes }, null, 2);
};

const auditFrom = (prompt: string, metadata?: PromptEditorConfirmMetadata): ProductionPreparationPromptAudit => ({
  templateId: metadata?.templateId || "productionScenePlan",
  promptHash: sha256(prompt),
  selectedSkillIds: metadata?.selectedSkillIds || [],
  selectedSkillTitles: metadata?.selectedSkillTitles || [],
  selectedContextIds: metadata?.selectedContextIds || [],
  createdAt: Date.now(),
});

const normalizeScenePlanQa = (
  value: unknown,
  prompt: string,
  metadata?: PromptEditorConfirmMetadata,
): ScenePlanQaCandidate => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const issues = (Array.isArray(source.issues) ? source.issues : []).flatMap((item) => {
    const issue = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const description = text(issue.description);
    if (!description) return [];
    const severity: "blocking" | "warning" | "advisory" = issue.severity === "blocking" || issue.severity === "advisory" ? issue.severity : "warning";
    return [{ severity, description, suggestion: text(issue.suggestion) }];
  });
  const hasBlockingIssue = issues.some((issue) => issue.severity === "blocking");
  const score = Math.max(0, Math.min(100, Math.round(Number(source.score) || 0)));
  const verdict = source.verdict === "pass" && !hasBlockingIssue && score >= 85 ? "pass" : "revise";
  return {
    score,
    verdict,
    summary: text(source.summary),
    issues,
    audit: auditFrom(prompt, metadata),
    reviewedAt: Date.now(),
  };
};

const parseScenePlanQa = (
  value: unknown,
  prompt: string,
  metadata?: PromptEditorConfirmMetadata,
): ScenePlanQaCandidate => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const score = Number(source.score);
  const verdict = text(source.verdict);
  const summary = text(source.summary);
  if (!Number.isInteger(score) || score < 0 || score > 100 || !["pass", "revise"].includes(verdict) || !summary || !Array.isArray(source.issues)) {
    throw new Error("模型没有返回有效的场次方案质检结果，请重试或检查当前模型路由。");
  }
  const normalized = normalizeScenePlanQa(source, prompt, metadata);
  if (normalized.verdict === "revise" && normalized.issues.length === 0) {
    throw new Error("场次方案质检要求优化，但没有返回可执行的问题说明，请重试。");
  }
  return normalized;
};

export function ProductionSourceOverviewWorkspace({
  project,
  episode,
  updateProject,
  onOpenScene,
  onOpenSourceUnit,
  newUnitRequestKey = 0,
}: {
  project: Project;
  episode: Episode;
  updateProject: (updates: Partial<Project>) => Promise<void>;
  onOpenScene: (sceneId: string) => void;
  onOpenSourceUnit?: (episodeId: string) => void;
  newUnitRequestKey?: number;
}) {
  const [promptAction, setPromptAction] = useState<PromptAction | null>(null);
  const [candidate, setCandidate] = useState<ScenePlanCandidate | null>(null);
  const [confirmedSceneReplacement, setConfirmedSceneReplacement] = useState(false);
  const [isManualPlanOpen, setIsManualPlanOpen] = useState(false);
  const [manualPlanDraft, setManualPlanDraft] = useState<{ sourceDocumentId: string; scenes: ProductionScenePlanCandidate[] } | null>(null);
  const [isLoadingManualPlan, setIsLoadingManualPlan] = useState(false);
  const [qaCandidate, setQaCandidate] = useState<ScenePlanQaCandidate | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showOriginalNovel, setShowOriginalNovel] = useState(false);
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [scriptEditorBaseRevisionId, setScriptEditorBaseRevisionId] = useState<string | null>(null);
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [isNewUnitOpen, setIsNewUnitOpen] = useState(false);
  const [newUnitBaseRevisionId, setNewUnitBaseRevisionId] = useState<string | null>(null);
  const [isNewUnitAiPromptOpen, setIsNewUnitAiPromptOpen] = useState(false);
  const [isDraftingNewUnitWithAi, setIsDraftingNewUnitWithAi] = useState(false);
  const [isArchiveUnitOpen, setIsArchiveUnitOpen] = useState(false);
  const [isCheckingWritingSync, setIsCheckingWritingSync] = useState(false);
  const [isApplyingWritingSync, setIsApplyingWritingSync] = useState(false);
  const [isScriptConflictOpen, setIsScriptConflictOpen] = useState(false);
  const [isResolvingScriptConflict, setIsResolvingScriptConflict] = useState(false);
  const [writingSyncPreview, setWritingSyncPreview] = useState<ReturnType<typeof previewWritingScriptSync> | null>(null);
  const [scriptDraft, setScriptDraft] = useState<ScriptEditorDraft>({ title: "", summary: "", targetDurationMinutes: "", content: "" });
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveredScriptDraft | null>(null);
  const [scriptSaveError, setScriptSaveError] = useState<string | null>(null);
  const [newUnitDraft, setNewUnitDraft] = useState<ScriptEditorDraft>({ title: "", summary: "", targetDurationMinutes: "", content: "" });
  const [manualNewUnitDraft, setManualNewUnitDraft] = useState<ScriptEditorDraft>({ title: "", summary: "", targetDurationMinutes: "", content: "" });
  const [newUnitSourceMode, setNewUnitSourceMode] = useState<"manual" | "writing">("manual");
  const [writingImportProjects, setWritingImportProjects] = useState<ScriptProjectSummary[]>([]);
  const [selectedWritingImportProjectId, setSelectedWritingImportProjectId] = useState("");
  const [writingImportPackage, setWritingImportPackage] = useState<ScriptExportPackage | null>(null);
  const [selectedWritingImportUnitId, setSelectedWritingImportUnitId] = useState("");
  const [isLoadingWritingImport, setIsLoadingWritingImport] = useState(false);
  const writingImportRequestRef = useRef(0);
  const [newUnitPlacement, setNewUnitPlacement] = useState<"after_current" | "at_end">("after_current");
  const [newUnitIdentity, setNewUnitIdentity] = useState<{ unitId: string; sourceDocumentId: string; writingUnitId: string } | null>(null);
  const [hydratedScriptUnit, setHydratedScriptUnit] = useState<{
    sourceDocumentId: string;
    unit: ProductionCanonicalScriptUnit;
    originalSourceDocument?: ProductionSourceDocument;
  } | null>(null);
  const [isHydratingScriptUnit, setIsHydratingScriptUnit] = useState(false);
  const documents = productionSourceDocumentsForProject(project);
  const scriptWorkspace = productionScriptWorkspaceForProject(project, documents);
  const scriptRevision = currentProductionScriptRevision(scriptWorkspace);
  const sourceDocumentShell = productionSourceDocumentForEpisode(project, episode);
  const scriptUnitShell = scriptRevision?.units.find((unit) => unit.sourceDocumentId === sourceDocumentShell?.id);
  const scriptUnit = (sourceDocumentShell?.id && hydratedScriptUnit?.sourceDocumentId === sourceDocumentShell.id)
    ? hydratedScriptUnit?.unit
    : scriptUnitShell;
  const sourceDocument = useMemo(() => sourceDocumentShell && scriptUnit
    ? {
      ...sourceDocumentShell,
      title: scriptUnit.title,
      summary: scriptUnit.summary,
      targetDurationMinutes: scriptUnit.targetDurationMinutes,
      continuityMode: scriptUnit.continuityMode || sourceDocumentShell.continuityMode,
      content: scriptUnit.content,
      sourceWritingUnitId: scriptUnit.sourceWritingUnitId || sourceDocumentShell.sourceWritingUnitId,
    }
    : sourceDocumentShell, [scriptUnit, sourceDocumentShell]);
  const sourceTargetDurationMinutes = productionSourceTargetDurationMinutes(project, sourceDocument);
  const sourceTargetDuration = sourceTargetDurationMinutes
    ? `${sourceTargetDurationMinutes} 分钟；所有场次目标时长总和必须等于该值。`
    : "未指定；请根据完整原文的真实表演和制作体量估算，不得使用固定场长。";
  const formalScriptDraft = useMemo<ScriptEditorDraft>(() => ({
    title: scriptUnit?.title || sourceDocument?.title || "",
    summary: scriptUnit?.summary || "",
    targetDurationMinutes: scriptUnit?.targetDurationMinutes ? String(scriptUnit.targetDurationMinutes) : "",
    content: scriptUnit?.content || sourceDocument?.content || "",
  }), [scriptUnit?.content, scriptUnit?.summary, scriptUnit?.targetDurationMinutes, scriptUnit?.title, sourceDocument?.content, sourceDocument?.title]);
  const isScriptDraftDirty = isEditingScript
    && scriptDraftContentSignature(scriptDraft) !== scriptDraftContentSignature(formalScriptDraft);
  const scriptDraftCharacterCount = [...scriptDraft.content.replace(/\s/g, "")].length;
  const sourceText = sourceDocument?.content || "";
  const originalNovel = (sourceDocument?.id && hydratedScriptUnit?.sourceDocumentId === sourceDocument.id)
    ? hydratedScriptUnit?.originalSourceDocument
    : sourceDocument?.originalSourceDocumentId
      ? documents.find((document) => document.id === sourceDocument.originalSourceDocumentId)
      : undefined;
  const activePlan = project.productionScenePlans
    ?.filter((plan) => plan.sourceDocumentId === sourceDocument?.id && plan.status === "adopted")
    .sort((left, right) => right.adoptedAt - left.adoptedAt)[0];
  const interactiveProfile = project.interactiveProductionPrepProfile;
  const interactiveNodes = interactiveProfile?.nodes.filter((node) => node.sourceDocumentId === sourceDocument?.id) || [];
  const interactiveNodeIds = interactiveNodes.map((node) => node.nodeId);
  const interactiveNodeTitleById = new Map(interactiveProfile?.nodes.map((node) => [node.nodeId, node.title]) || []);
  const interactivePlanningContext = interactiveNodes.length
    ? JSON.stringify(interactiveNodes.map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      dramaticFunction: node.dramaticFunction,
      storyEpisode: node.storyEpisodeTitle,
      storyChapter: node.storyChapterTitle,
      readVariables: node.readVariables,
      writeVariables: node.writeVariables,
      requiredFacts: node.requiredFacts,
      producedFacts: node.producedFacts,
      choices: node.choices.map((choice) => ({
        text: choice.text,
        intent: choice.intent,
        targetNodeId: choice.targetNodeId,
        targetNodeTitle: interactiveNodeTitleById.get(choice.targetNodeId) || choice.targetNodeId,
        timeoutSeconds: choice.timeoutSeconds,
      })),
      isEnding: node.isEnding,
    })), null, 2)
    : "当前来源没有绑定互动节点；按线性制片场次规划。";
  const candidateDurationMinutes = candidate?.scenes.reduce(
    (sum, scene) => sum + (scene.targetDurationMinutes || 0),
    0,
  ) || 0;
  const candidateHasCompleteDurations = Boolean(candidate?.scenes.length)
    && candidate!.scenes.every((scene) => Number.isFinite(scene.targetDurationMinutes) && (scene.targetDurationMinutes || 0) > 0);
  const candidateDurationDelta = sourceTargetDurationMinutes
    ? candidateDurationMinutes - sourceTargetDurationMinutes
    : 0;
  const candidateDurationMatchesTarget = !sourceTargetDurationMinutes
    || (candidateHasCompleteDurations && Math.abs(candidateDurationDelta) < 0.01);
  const candidateInteractiveNodeIds = new Set(candidate?.scenes.flatMap((scene) => scene.interactiveNodeIds || []) || []);
  const candidateHasCompleteInteractiveCoverage = interactiveNodeIds.every((nodeId) => candidateInteractiveNodeIds.has(nodeId));
  const candidateCanBeAdopted = candidateDurationMatchesTarget && candidateHasCompleteInteractiveCoverage;
  const candidateReplacementImpact = candidate && sourceDocument
    ? reconcileProductionScenes({
      sourceDocumentId: sourceDocument.id,
      candidates: candidate.scenes,
      planId: "preview",
      nodes: interactiveNodes,
      priorPlan: activePlan,
      currentScenes: activePlan?.adoptedSceneSnapshot || episode.scenes || [],
    }).replacedScenes
    : [];
  useEffect(() => { setConfirmedSceneReplacement(false); }, [candidate]);
  const writingSyncImpact = useMemo(() => {
    if (!writingSyncPreview) return null;
    const changedDocumentIds = new Set(writingSyncPreview.changes.map((change) => change.sourceDocumentId));
    const productionPlans = (project.productionScenePlans || []).filter((plan) => changedDocumentIds.has(plan.sourceDocumentId) && plan.status === "adopted");
    const interactiveNodes = (project.interactiveProductionPrepProfile?.nodes || [])
      .filter((node) => changedDocumentIds.has(node.sourceDocumentId));
    return {
      added: writingSyncPreview.changes.filter((change) => change.type === "unit_added").length,
      reviewPlans: productionPlans.length,
      reviewNodes: interactiveNodes.length,
      requiresReview: writingSyncPreview.changes.filter((change) => change.requiresReview).length,
    };
  }, [project.interactiveProductionPrepProfile?.nodes, project.productionScenePlans, writingSyncPreview]);
  const context = useMemo(
    () => gatherContextOptions(project, "productionScenePlan", { episodeIds: [episode.id] }),
    [episode.id, project],
  );

  useEffect(() => {
    const sourceDocumentId = sourceDocumentShell?.id;
    const needsHydration = Boolean(
      project.productionScriptWorkspace?.currentRevisionId
      && sourceDocumentId
      && !scriptUnitShell?.content,
    );
    if (!needsHydration || !sourceDocumentId) {
      setHydratedScriptUnit(null);
      setIsHydratingScriptUnit(false);
      return;
    }
    let cancelled = false;
    setHydratedScriptUnit(null);
    setIsHydratingScriptUnit(true);
    void legacyProjectClient.getProductionScriptUnit(project.id, sourceDocumentId)
      .then((result) => {
        if (cancelled) return;
        if (!result || !result.unit) throw new Error("无法读取当前剧本单元。");
        setHydratedScriptUnit({ sourceDocumentId, ...result });
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "当前剧本单元加载失败");
      })
      .finally(() => {
        if (!cancelled) setIsHydratingScriptUnit(false);
      });
    return () => { cancelled = true; };
  }, [project.id, project.productionScriptWorkspace?.currentRevisionId, scriptUnitShell?.content, sourceDocumentShell?.id]);

  useEffect(() => {
    setIsEditingScript(false);
    setScriptDraft(formalScriptDraft);
    setScriptSaveError(null);
    const savedDraft = readRecoveryDraft(project.id, sourceDocument?.id);
    if (savedDraft && scriptDraftContentSignature(savedDraft) === scriptDraftContentSignature(formalScriptDraft)) {
      clearRecoveryDraft(project.id, sourceDocument?.id);
      setRecoveryDraft(null);
      if (savedDraft.saveState === "saving") {
        toast.success("已确认上次保存成功，正式剧本没有丢失");
      }
      return;
    }
    setRecoveryDraft(savedDraft);
  }, [formalScriptDraft, project.id, sourceDocument?.id, scriptUnit?.contentHash]);

  useEffect(() => {
    const recovered = readNewUnitRecovery(project.id);
    if (!recovered) return;
    let cancelled = false;
    const restoreEditor = () => {
      if (cancelled) return;
      const recoveredDraft = {
        title: recovered.title,
        summary: recovered.summary,
        targetDurationMinutes: recovered.targetDurationMinutes,
        content: recovered.content,
      };
      setNewUnitDraft(recoveredDraft);
      setManualNewUnitDraft(recoveredDraft);
      setNewUnitIdentity({
        unitId: recovered.unitId,
        sourceDocumentId: recovered.sourceDocumentId,
        writingUnitId: recovered.writingUnitId,
      });
      setNewUnitPlacement(recovered.placement);
      setNewUnitBaseRevisionId(recovered.baseRevisionId || scriptWorkspace.currentRevisionId);
      setScriptSaveError(recovered.saveState === "saving" ? "上次保存可能被刷新中断，请核对后重试。" : null);
      setIsNewUnitOpen(true);
    };
    void legacyProjectClient.getProductionScriptUnit(project.id, recovered.sourceDocumentId)
      .then((result) => {
        if (cancelled) return;
        if (result?.unit && scriptDraftContentSignature({
          title: result.unit.title,
          summary: result.unit.summary || "",
          targetDurationMinutes: result.unit.targetDurationMinutes ? String(result.unit.targetDurationMinutes) : "",
          content: result.unit.content,
        }) === scriptDraftContentSignature(recovered)) {
          clearNewUnitRecovery(project.id);
          clearRecoveryDraft(project.id, recovered.sourceDocumentId);
          toast.success("已确认新增剧本单元保存成功");
          return;
        }
        restoreEditor();
      })
      .catch(restoreEditor);
    return () => { cancelled = true; };
    // Recovery is inspected once when this production project opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const openScriptEditor = () => {
    const savedDraft = readRecoveryDraft(project.id, sourceDocument?.id);
    const formalDraft = formalScriptDraft;
    setScriptDraft(formalDraft);
    setRecoveryDraft(savedDraft && scriptDraftContentSignature(savedDraft) !== scriptDraftContentSignature(formalDraft)
      ? savedDraft
      : null);
    setScriptSaveError(null);
    setScriptEditorBaseRevisionId(scriptWorkspace.currentRevisionId);
    setIsEditingScript(true);
  };

  useEffect(() => {
    if (!newUnitRequestKey) return;
    clearNewUnitRecovery(project.id);
    const nextOrder = (scriptRevision?.units.length || 0) + 1;
    const defaultDuration = scriptUnit?.targetDurationMinutes ? String(scriptUnit.targetDurationMinutes) : (project.type === "movie" ? "15" : "2");
    const emptyDraft = {
      title: project.type === "movie" ? `分段 ${nextOrder}` : `第 ${nextOrder} 集`,
      summary: "",
      targetDurationMinutes: defaultDuration,
      content: "",
    };
    setNewUnitDraft(emptyDraft);
    setManualNewUnitDraft(emptyDraft);
    setNewUnitSourceMode("manual");
    setWritingImportProjects([]);
    setSelectedWritingImportProjectId("");
    setWritingImportPackage(null);
    setSelectedWritingImportUnitId("");
    setScriptSaveError(null);
    setNewUnitPlacement("after_current");
    setNewUnitBaseRevisionId(scriptWorkspace.currentRevisionId);
    setNewUnitIdentity({
      unitId: `prod_script_unit_${crypto.randomUUID()}`,
      sourceDocumentId: `prod_source_${crypto.randomUUID()}`,
      writingUnitId: `writing_unit_${crypto.randomUUID()}`,
    });
    setIsNewUnitOpen(true);
  }, [newUnitRequestKey]);

  useEffect(() => {
    if (!isEditingScript || recoveryDraft || !sourceDocument?.id || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      writeRecoveryDraft(project.id, sourceDocument.id, scriptDraft, {
        baseRevisionId: scriptEditorBaseRevisionId || scriptWorkspace.currentRevisionId,
        saveState: "draft",
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isEditingScript, project.id, recoveryDraft, scriptDraft, scriptEditorBaseRevisionId, scriptWorkspace.currentRevisionId, sourceDocument?.id]);

  useEffect(() => {
    if (!isNewUnitOpen || !newUnitIdentity) return;
    const timer = window.setTimeout(() => {
      writeNewUnitRecovery(
        project.id,
        newUnitDraft,
        newUnitIdentity,
        newUnitPlacement,
        newUnitBaseRevisionId || scriptWorkspace.currentRevisionId,
        "draft",
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isNewUnitOpen, newUnitBaseRevisionId, newUnitDraft, newUnitIdentity, newUnitPlacement, project.id, scriptWorkspace.currentRevisionId]);

  useEffect(() => {
    if (!isScriptDraftDirty || typeof window === "undefined") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isScriptDraftDirty]);

  const cancelScriptEditor = () => {
    if (isScriptDraftDirty && typeof window !== "undefined" && !window.confirm("当前修改尚未保存，确定放弃吗？")) return;
    setIsEditingScript(false);
  };

  const cancelNewUnitEditor = () => {
    if (
      (newUnitDraft.title.trim() || newUnitDraft.summary.trim() || newUnitDraft.content.trim())
      && typeof window !== "undefined"
      && !window.confirm("这个新增剧本单元尚未保存，确定放弃吗？")
    ) return;
    clearNewUnitRecovery(project.id);
    setIsNewUnitOpen(false);
    const emptyDraft = { title: "", summary: "", targetDurationMinutes: "", content: "" };
    setNewUnitDraft(emptyDraft);
    setManualNewUnitDraft(emptyDraft);
    setNewUnitIdentity(null);
    setNewUnitBaseRevisionId(null);
    setScriptSaveError(null);
  };

  const writingImportUnits = (writingImportPackage?.units || []).filter((unit) => Boolean(unit.prose?.trim()));
  const selectedWritingImportUnit = writingImportUnits.find((unit) => unit.id === selectedWritingImportUnitId);
  const importedWritingUnitIds = new Set(
    (scriptRevision?.units || []).map((unit) => unit.sourceWritingUnitId).filter((id): id is string => Boolean(id)),
  );

  const selectWritingImportUnit = (unit: ScriptExportUnit) => {
    setSelectedWritingImportUnitId(unit.id);
    setNewUnitDraft({
      title: unit.title,
      summary: unit.summary,
      targetDurationMinutes: unit.targetDurationMinutes ? String(unit.targetDurationMinutes) : "",
      content: unit.prose || "",
    });
  };

  const updateManualNewUnitDraft = (patch: Partial<ScriptEditorDraft>) => {
    setNewUnitDraft((draft) => ({ ...draft, ...patch }));
    setManualNewUnitDraft((draft) => ({ ...draft, ...patch }));
  };

  const loadWritingImportProject = async (writingProjectId: string) => {
    const requestId = ++writingImportRequestRef.current;
    setSelectedWritingImportProjectId(writingProjectId);
    setSelectedWritingImportUnitId("");
    setWritingImportPackage(null);
    setNewUnitDraft({ title: "", summary: "", targetDurationMinutes: "", content: "" });
    if (!writingProjectId) {
      setIsLoadingWritingImport(false);
      return;
    }
    setIsLoadingWritingImport(true);
    try {
      const result = await scriptClient.exportPackage(writingProjectId);
      if (requestId !== writingImportRequestRef.current) return;
      setWritingImportPackage(result.package);
      const firstAvailable = result.package.units.find((unit) => unit.prose?.trim() && !importedWritingUnitIds.has(unit.id));
      if (firstAvailable) selectWritingImportUnit(firstAvailable);
    } catch (error) {
      if (requestId === writingImportRequestRef.current) {
        toast.error(error instanceof Error ? error.message : "读取剧本模块失败");
      }
    } finally {
      if (requestId === writingImportRequestRef.current) setIsLoadingWritingImport(false);
    }
  };

  const chooseNewUnitSourceMode = async (mode: "manual" | "writing") => {
    setNewUnitSourceMode(mode);
    if (mode === "manual") {
      writingImportRequestRef.current += 1;
      setIsLoadingWritingImport(false);
      setNewUnitDraft(manualNewUnitDraft);
      return;
    }
    if (newUnitSourceMode === "manual") setManualNewUnitDraft(newUnitDraft);
    if (selectedWritingImportUnit) {
      selectWritingImportUnit(selectedWritingImportUnit);
      return;
    }
    if (writingImportProjects.length) {
      const initialProjectId = selectedWritingImportProjectId || scriptWorkspace.writingProjectId || writingImportProjects[0]?.id || "";
      if (initialProjectId) await loadWritingImportProject(initialProjectId);
      return;
    }
    const requestId = ++writingImportRequestRef.current;
    setIsLoadingWritingImport(true);
    try {
      const result = await scriptClient.listProjects();
      if (requestId !== writingImportRequestRef.current) return;
      const projects = scriptWorkspace.writingProjectId
        ? result.projects.filter((item) => item.id === scriptWorkspace.writingProjectId)
        : result.projects;
      setWritingImportProjects(projects);
      const initialProjectId = scriptWorkspace.writingProjectId || projects[0]?.id || "";
      if (initialProjectId) await loadWritingImportProject(initialProjectId);
      else setIsLoadingWritingImport(false);
    } catch (error) {
      if (requestId === writingImportRequestRef.current) {
        setIsLoadingWritingImport(false);
        toast.error(error instanceof Error ? error.message : "读取剧本项目失败");
      }
    }
  };

  // A PATCH acknowledgement only proves the request was accepted. Re-read the
  // dedicated screenplay record before telling the author that a formal
  // revision exists, so a stale write cannot masquerade as a saved script.
  const verifyPersistedScriptRevision = async (revisionId: string) => {
    const persisted = await legacyProjectClient.getProject(project.id, "production-workspace");
    if (persisted?.productionScriptWorkspace?.currentRevisionId !== revisionId) {
      throw new Error("剧本保存未能确认，请刷新后检查当前正式版本。");
    }
  };

  // Project shells intentionally omit non-active screenplay bodies. Fetch only
  // the screenplay aggregate for a mutation; rebuilding every Episode, Scene
  // and Shot here would make a one-line save scale with the entire production.
  const loadFullScriptProject = async () => {
    const persistedWorkspace = await legacyProjectClient.getProductionScriptWorkspace(project.id);
    if (!persistedWorkspace) {
      throw new Error("无法读取完整正式剧本，请刷新后重试。");
    }
    return {
      ...project,
      productionScriptWorkspace: persistedWorkspace,
    };
  };

  const persistScriptDraft = async (draft: typeof scriptDraft, options: {
    unitId?: string;
    sourceDocumentId?: string;
    isNew?: boolean;
    insertAfterUnitId?: string;
    targetOrder?: number;
    newWritingUnitId?: string;
    sourceWritingUnitId?: string;
    skipWritingWriteback?: boolean;
    continuityMode?: "continue" | "standalone";
    expectedRevisionId?: string;
  } = {}) => {
    setIsSavingScript(true);
    setScriptSaveError(null);
    const recoverySourceDocumentId = options.sourceDocumentId || sourceDocument?.id;
    const recoveryBaseRevisionId = options.expectedRevisionId
      || (options.isNew ? newUnitBaseRevisionId : scriptEditorBaseRevisionId)
      || scriptWorkspace.currentRevisionId;
    writeRecoveryDraft(project.id, recoverySourceDocumentId, draft, {
      baseRevisionId: recoveryBaseRevisionId,
      saveState: "saving",
    });
    if (options.isNew && newUnitIdentity) {
      writeNewUnitRecovery(
        project.id,
        draft,
        newUnitIdentity,
        newUnitPlacement,
        recoveryBaseRevisionId,
        "saving",
      );
    }
    try {
      const expectedRevisionId = recoveryBaseRevisionId;
      const fullProject = await loadFullScriptProject();
      const fullDocuments = productionSourceDocumentsForProject(fullProject);
      const fullWorkspace = productionScriptWorkspaceForProject(fullProject, fullDocuments);
      if (fullWorkspace.currentRevisionId !== expectedRevisionId) {
        throw new Error("正式剧本已在另一处更新。当前草稿仍保留，请刷新并核对新版本后再保存。");
      }
      const writeMode = "production_override" as const;
      const existingWritingUnitId = options.isNew ? undefined : scriptUnit?.sourceWritingUnitId;
      const sourceWritingUnitId = options.sourceWritingUnitId || existingWritingUnitId;
      const mutation = saveProductionScriptDraft(fullProject, fullWorkspace, {
        unitId: options.unitId,
        sourceDocumentId: options.sourceDocumentId,
        sourceWritingUnitId,
        kind: project.type === "movie" ? "segment" : "episode",
        insertAfterUnitId: options.insertAfterUnitId,
        targetOrder: options.targetOrder,
        title: draft.title,
        summary: draft.summary,
        targetDurationMinutes: draft.targetDurationMinutes ? Number(draft.targetDurationMinutes) : undefined,
        continuityMode: options.continuityMode,
        content: draft.content,
        message: options.isNew ? `新增《${draft.title.trim()}》` : `修改《${draft.title.trim()}》`,
        writeMode,
      });
      const originalDocuments = fullProject.productionSourceDocuments?.length
        ? fullProject.productionSourceDocuments
        : fullDocuments;
      const existingDocumentIds = new Set(originalDocuments.map((document) => document.id));
      const projectUpdates: Partial<Project> = {
        productionScriptWorkspace: mutation.workspace,
        productionSourceDocuments: [
          ...originalDocuments,
          ...mutation.sourceDocumentsToAppend.filter((document) => !existingDocumentIds.has(document.id)),
        ],
        productionScenePlans: mutation.productionScenePlans,
        episodes: mutation.episodes,
        targetEpisodeCount: mutation.targetEpisodeCount,
        durationMinutes: mutation.durationMinutes,
      };
      // Commit against the revision this editor opened before scheduling the
      // regular store update. A second tab must never overwrite this revision.

        await legacyProjectClient.patchProductionScriptWorkspace(
          project.id,
          projectUpdates,
          expectedRevisionId,
        );
      await verifyPersistedScriptRevision(mutation.workspace.currentRevisionId);
      for (const newEpisode of mutation.episodesToCreate) {
        await legacyProjectClient.saveEpisode(project.id, newEpisode);
      }
      const savedUnit = currentProductionScriptRevision(mutation.workspace)?.units
        .find((unit) => unit.sourceDocumentId === (options.sourceDocumentId || sourceDocument?.id));
      const { productionSourceDocuments: _sourceDocuments, ...localProjectUpdates } = projectUpdates;
      await updateProject({
        ...localProjectUpdates,
        productionScriptWorkspace: screenplayWorkspaceShellForLocalState(mutation.workspace, savedUnit?.sourceDocumentId || sourceDocument?.id),
      });
      if (savedUnit) setHydratedScriptUnit({ sourceDocumentId: savedUnit.sourceDocumentId, unit: savedUnit });
      clearRecoveryDraft(project.id, recoverySourceDocumentId);
      if (options.isNew) clearNewUnitRecovery(project.id);
      setRecoveryDraft(null);
      setIsEditingScript(false);
      setIsNewUnitOpen(false);
      setNewUnitDraft({ title: "", summary: "", targetDurationMinutes: "", content: "" });
      setManualNewUnitDraft({ title: "", summary: "", targetDurationMinutes: "", content: "" });
      setNewUnitIdentity(null);
      setScriptEditorBaseRevisionId(null);
      setNewUnitBaseRevisionId(null);
      const newEpisode = mutation.episodesToCreate[0];
      if (newEpisode) onOpenSourceUnit?.(newEpisode.id);
      toast.success(options.isNew ? "新剧本单元已保存，接下来可为它规划制片场次" : "剧本已保存，受影响的场次方案已标记为待复核");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存剧本失败";
      setScriptSaveError(message);
      writeRecoveryDraft(project.id, recoverySourceDocumentId, draft, {
        baseRevisionId: recoveryBaseRevisionId,
        saveState: "draft",
      });
      if (options.isNew && newUnitIdentity) {
        writeNewUnitRecovery(
          project.id,
          draft,
          newUnitIdentity,
          newUnitPlacement,
          recoveryBaseRevisionId,
          "draft",
        );
      }
      toast.error(message);
    } finally {
      setIsSavingScript(false);
    }
  };

  const archiveCurrentUnit = async () => {
    if (!scriptUnit || !sourceDocument || isSavingScript) return;
    setIsSavingScript(true);
    try {
      const expectedRevisionId = scriptWorkspace.currentRevisionId;
      const fullProject = await loadFullScriptProject();
      const fullDocuments = productionSourceDocumentsForProject(fullProject);
      const fullWorkspace = productionScriptWorkspaceForProject(fullProject, fullDocuments);
      if (fullWorkspace.currentRevisionId !== expectedRevisionId) {
        throw new Error("正式剧本已在另一处更新，请刷新后再归档。");
      }
      const mutation = archiveProductionScriptUnit(fullProject, fullWorkspace, scriptUnit.id);
      const projectUpdates: Partial<Project> = {
        productionScriptWorkspace: mutation.workspace,
        productionScenePlans: mutation.productionScenePlans,
        episodes: mutation.episodes,
        targetEpisodeCount: mutation.targetEpisodeCount,
        durationMinutes: mutation.durationMinutes,
      };

        await legacyProjectClient.patchProductionScriptWorkspace(
          project.id,
          projectUpdates,
          expectedRevisionId,
        );
      await verifyPersistedScriptRevision(mutation.workspace.currentRevisionId);
      await updateProject({
        ...projectUpdates,
        productionScriptWorkspace: screenplayWorkspaceShellForLocalState(mutation.workspace, sourceDocument.id),
      });
      setIsArchiveUnitOpen(false);
      const nextEpisode = mutation.episodes[0];
      if (nextEpisode) onOpenSourceUnit?.(nextEpisode.id);
      toast.success(`已删除当前${project.type === "movie" ? "段落" : "剧集"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除剧本单元失败");
    } finally {
      setIsSavingScript(false);
    }
  };

  const persistWritingScriptSync = async (
    preview: ReturnType<typeof previewWritingScriptSync>,
  ) => {
    const fullProject = await loadFullScriptProject();
    const fullDocuments = productionSourceDocumentsForProject(fullProject);
    const fullWorkspace = productionScriptWorkspaceForProject(fullProject, fullDocuments);
    if (!fullWorkspace.writingProjectId) throw new Error("当前制片项目没有可同步的剧本工作台来源。");
    const source = await scriptClient.exportPackage(fullWorkspace.writingProjectId);
    const effectivePreview = previewWritingScriptSync(fullProject, fullWorkspace, source.package);
    if (effectivePreview.blockedReason) throw new Error(effectivePreview.blockedReason);
    const originalDocuments = fullProject.productionSourceDocuments?.length
      ? fullProject.productionSourceDocuments
      : fullDocuments;
    const existingDocumentIds = new Set(originalDocuments.map((document) => document.id));
    const projectUpdates: Partial<Project> = {
      productionScriptWorkspace: effectivePreview.workspace,
      productionSourceDocuments: [
        ...originalDocuments,
        ...effectivePreview.sourceDocumentsToAppend.filter((document) => !existingDocumentIds.has(document.id)),
      ],
      productionScenePlans: effectivePreview.productionScenePlans,
      episodes: effectivePreview.episodes,
      targetEpisodeCount: effectivePreview.targetEpisodeCount,
      durationMinutes: effectivePreview.durationMinutes,
    };
    await legacyProjectClient.patchProductionScriptWorkspace(
      project.id,
      projectUpdates,
      fullWorkspace.currentRevisionId,
    );
    await verifyPersistedScriptRevision(effectivePreview.workspace.currentRevisionId);
    for (const newEpisode of effectivePreview.episodesToCreate) {
      await legacyProjectClient.saveEpisode(project.id, newEpisode);
    }
    const { productionSourceDocuments: _sourceDocuments, ...localProjectUpdates } = projectUpdates;
    await updateProject({
      ...localProjectUpdates,
      productionScriptWorkspace: screenplayWorkspaceShellForLocalState(effectivePreview.workspace, sourceDocument?.id),
    });
    setWritingSyncPreview(null);
    toast.success(`已同步 ${effectivePreview.changes.length} 处剧本更新`);
  };

  const checkWritingScriptUpdates = async () => {
    if (!scriptWorkspace.writingProjectId || isCheckingWritingSync || isApplyingWritingSync) return;
    setIsCheckingWritingSync(true);
    try {
      const result = await scriptClient.exportPackage(scriptWorkspace.writingProjectId);
      const preview = previewWritingScriptSync(project, scriptWorkspace, result.package);
      if (preview.blockedReason) {
        toast.error(preview.blockedReason);
        return;
      }
      if (!preview.changes.length) {
        toast.success("制片使用的剧本已经是最新版本");
        return;
      }
      setWritingSyncPreview(preview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "检查剧本更新失败");
    } finally {
      setIsCheckingWritingSync(false);
    }
  };

  const applyWritingScriptSync = async () => {
    if (!writingSyncPreview) return;
    setIsApplyingWritingSync(true);
    try {
      await persistWritingScriptSync(writingSyncPreview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步剧本更新失败");
    } finally {
      setIsApplyingWritingSync(false);
    }
  };

  const resolveScriptConflict = async (decision: "keep_production" | "accept_writing") => {
    if (!scriptWorkspace.writingProjectId || scriptWorkspace.syncStatus !== "conflict" || isResolvingScriptConflict) return;
    setIsResolvingScriptConflict(true);
    try {
      const expectedRevisionId = scriptWorkspace.currentRevisionId;
      const fullProject = await loadFullScriptProject();
      const fullDocuments = productionSourceDocumentsForProject(fullProject);
      const fullWorkspace = productionScriptWorkspaceForProject(fullProject, fullDocuments);
      if (fullWorkspace.currentRevisionId !== expectedRevisionId) {
        throw new Error("正式剧本已在另一处更新，请刷新后重新处理冲突。");
      }
      let mutation: ProductionScriptMutation;
      if (decision === "keep_production") {
        mutation = resolveProductionScriptConflictKeepingProduction(fullProject, fullWorkspace);
      } else {
        const source = await scriptClient.exportPackage(fullWorkspace.writingProjectId!);
        const preview = previewWritingScriptSync(
          fullProject,
          { ...fullWorkspace, syncStatus: "current" },
          source.package,
        );
        if (preview.blockedReason) throw new Error(preview.blockedReason);
        mutation = preview;
      }
      const originalDocuments = fullProject.productionSourceDocuments?.length
        ? fullProject.productionSourceDocuments
        : fullDocuments;
      const existingDocumentIds = new Set(originalDocuments.map((document) => document.id));
      const projectUpdates: Partial<Project> = {
        productionScriptWorkspace: mutation.workspace,
        productionSourceDocuments: [
          ...originalDocuments,
          ...mutation.sourceDocumentsToAppend.filter((document) => !existingDocumentIds.has(document.id)),
        ],
        productionScenePlans: mutation.productionScenePlans,
        episodes: mutation.episodes,
        targetEpisodeCount: mutation.targetEpisodeCount,
        durationMinutes: mutation.durationMinutes,
      };

        await legacyProjectClient.patchProductionScriptWorkspace(project.id, projectUpdates, expectedRevisionId);
      await verifyPersistedScriptRevision(mutation.workspace.currentRevisionId);
      for (const newEpisode of mutation.episodesToCreate) {
        await legacyProjectClient.saveEpisode(project.id, newEpisode);
      }
      const { productionSourceDocuments: _sourceDocuments, ...localProjectUpdates } = projectUpdates;
      await updateProject({
        ...localProjectUpdates,
        productionScriptWorkspace: screenplayWorkspaceShellForLocalState(mutation.workspace, sourceDocument?.id),
      });
      setIsScriptConflictOpen(false);
      toast.success(decision === "keep_production"
        ? "已保留制片改稿，原剧本保持独立"
        : "已放弃制片专用改稿并采用剧本工作台版本");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "处理剧本冲突失败");
    } finally {
      setIsResolvingScriptConflict(false);
    }
  };

  const draftNewUnitWithAi = async (finalPrompt: string) => {
    setIsDraftingNewUnitWithAi(true);
    try {
      const { Type } = await import("../../../clients/aiSchemaClient");
      const response = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: { scriptText: { type: Type.STRING } },
        },
      });
      const parsed = safeParseAIResponse(response, {}) as { scriptText?: unknown };
      const content = text(parsed.scriptText);
      if (!content) throw new Error("模型没有返回可保存的剧本正文。");
      setNewUnitDraft((draft) => ({ ...draft, content }));
      setManualNewUnitDraft((draft) => ({ ...draft, content }));
      setIsNewUnitAiPromptOpen(false);
      toast.success("AI 草稿已填入正文；请审阅后再保存为正式剧本。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 补写剧本失败");
    } finally {
      setIsDraftingNewUnitWithAi(false);
    }
  };

  const generate = async (finalPrompt: string, _userIntent?: string, metadata?: PromptEditorConfirmMetadata) => {
    const action = promptAction;
    if (!action) return;
    setIsGenerating(true);
    try {
      const { Type } = await import("../../../clients/aiSchemaClient");
      const response = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema: action === "qa" ? {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER }, verdict: { type: Type.STRING, enum: ["pass", "revise"] }, summary: { type: Type.STRING },
            issues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING, enum: ["blocking", "warning", "advisory"] },
                  description: { type: Type.STRING },
                  suggestion: { type: Type.STRING },
                },
                required: ["severity", "description", "suggestion"],
              },
            },
          },
          required: ["score", "verdict", "summary", "issues"],
        } : {
          type: Type.OBJECT,
          properties: {
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING }, description: { type: Type.STRING }, purpose: { type: Type.STRING },
                  sourceEvidence: { type: Type.STRING }, continuityIn: { type: Type.STRING }, continuityOut: { type: Type.STRING },
                  targetDurationMinutes: { type: Type.NUMBER },
                  interactiveNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
              },
            },
          },
        },
      });
      if (action === "qa") {
        setQaCandidate(parseScenePlanQa(safeParseAIResponse(response, {}), finalPrompt, metadata));
        setPromptAction(null);
        return;
      }
      const normalized = normalizeScenePlan(safeParseAIResponse(response, {}), sourceText, interactiveNodeIds);
      const scenes = normalized.scenes;
      if (!scenes.length) throw new Error("模型没有返回包含原文依据的场次方案。");
      setCandidate({ scenes, metadata, prompt: finalPrompt });
      setPromptAction(null);
    } catch (error) {
      // Keep the prompt and pasted response open so the author can correct it.
      throw error;
    } finally {
      setIsGenerating(false);
    }
  };

  const adoptQa = async () => {
    if (!activePlan || !qaCandidate) return;
    try {
      await updateProject({
        productionScenePlans: (project.productionScenePlans || []).map((plan) => plan.id === activePlan.id
          ? { ...plan, qa: qaCandidate }
          : plan),
      });
      setQaCandidate(null);
      toast.success(qaCandidate.verdict === "pass" ? "场次方案质检已确认" : "质检意见已记录，请按意见优化场次方案");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存场次方案质检失败");
    }
  };

  const adopt = async () => {
    if (!candidate || !sourceDocument) return;
    try { validateProductionScenePlanSource(sourceText, candidate.scenes); }
    catch (error) { toast.error((error as Error).message); return; }
    const now = Date.now();
    const planId = crypto.randomUUID();
    try {
      const fullEpisode = await legacyProjectClient.getEpisode(project.id, episode.id, undefined, { scope: "episode" });
      if (!fullEpisode) throw new Error("找不到当前剧本单元，无法替换制片场次。");
      const replacementSnapshot = [...(fullEpisode.scenes || [])];
      const { scenes: nextScenes, replacedScenes } = reconcileProductionScenes({
        sourceDocumentId: sourceDocument.id,
        candidates: candidate.scenes,
        planId,
        nodes: interactiveNodes,
        priorPlan: activePlan,
        currentScenes: replacementSnapshot,
      });
      if (replacedScenes.length && !confirmedSceneReplacement) {
        throw new Error(`此次会替换或移除 ${replacedScenes.length} 个已有场次，请先确认下游影响。`);
      }
    const plan: ProductionScenePlanVersion = {
      id: planId,
      sourceDocumentId: sourceDocument.id,
      sourceHash: sourceDocument.sourceHash,
      status: "adopted",
      sourceStatus: "current",
      candidateScenes: candidate.scenes,
      adoptedSceneSnapshot: nextScenes,
      replacedSceneSnapshot: replacementSnapshot,
      promptAudit: candidate.origin === "manual"
        ? { templateId: "productionScenePlan.manual", promptHash: sha256(JSON.stringify(candidate.scenes)), selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], createdAt: now }
        : auditFrom(candidate.prompt, candidate.metadata),
      adoptedAt: now,
    };
    const prior = project.productionScenePlans || [];
    const nextPlans = [
      ...prior.map((item) => item.sourceDocumentId === sourceDocument.id && item.status === "adopted"
        ? { ...item, status: "superseded" as const, supersededAt: now }
        : item),
      plan,
    ];
      await legacyProjectClient.saveEpisode(project.id, { ...fullEpisode, scenes: nextScenes });
      await updateProject({
        productionScenePlans: nextPlans,
        episodes: project.episodes.map((item) => item.id === episode.id
          ? { ...item, sceneCount: nextScenes.length }
          : item),
      });
      setCandidate(null);
      toast.success("场次方案已采用，制片场次已更新");
      onOpenScene(nextScenes[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "采用场次方案失败");
    }
  };

  if (!sourceDocument) return <div className="flex min-h-full flex-col items-center justify-center px-8 text-center"><FileText className="mb-4 h-8 w-8 text-gray-300" /><p className="text-sm font-black text-gray-700 dark:text-neutral-200">当前项目没有可读取的剧本来源</p><p className="mt-2 text-xs text-gray-400">旧项目可以继续使用原有场次流程；新导入项目会在这里保存完整原文。</p></div>;

  const promptVariables = promptAction === "qa"
    ? {
      projectFormat: project.type === "movie" ? "电影" : project.type === "tv-series" ? "电视剧" : "短剧",
      sourceDocumentContent: sourceDocument.content,
      sourceTargetDuration,
      currentScenePlan: JSON.stringify(activePlan?.candidateScenes || [], null, 2),
      interactivePlanningContext,
    }
    : promptAction === "optimize"
      ? {
        projectFormat: project.type === "movie" ? "电影" : project.type === "tv-series" ? "电视剧" : "短剧",
        sourceDocumentContent: sourceDocument.content,
        sourceTargetDuration,
        currentScenePlan: JSON.stringify(activePlan?.candidateScenes || [], null, 2),
        scenePlanQa: JSON.stringify(projectScenePlanRepairQa(activePlan?.qa) || {}, null, 2),
        interactivePlanningContext,
      }
      : {
        projectFormat: project.type === "movie" ? "电影" : project.type === "tv-series" ? "电视剧" : "短剧",
        sourceDocumentTitle: sourceDocument.title,
        sourceDocumentContent: sourceDocument.content,
        sourceTargetDuration,
        fullScriptContext: productionScenePlanContinuityContext(project, sourceDocument.id),
        upstreamWritingReference: writingReference(project, sourceDocument.sourceWritingUnitId),
        interactivePlanningContext,
      };

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-5 md:px-8 md:py-7 bg-transparent text-text-primary">
      <header className="flex flex-wrap items-start justify-between gap-5 pb-5">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-gold">剧本与场次 · 第一步</p>
          <h2 className="mt-1 text-page-title text-text-primary">剧本总览</h2>
          <p className="mt-2 text-sm text-text-muted">这里维护制片采用的正式剧本；修改后，只复核受影响的场次方案。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={!scriptUnit || isSavingScript}
            onClick={() => setIsArchiveUnitOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-surface-soft text-text-primary transition-all duration-300 hover:bg-bg-surface-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            title={`删除当前${project.type === "movie" ? "段落" : "剧集"}`}
            aria-label={`删除当前${project.type === "movie" ? "段落" : "剧集"}`}
          >
            <Trash2 className="h-4 w-4 text-text-muted" />
          </button>
          {scriptWorkspace.writingProjectId && (
            <>
              <button
                type="button"
                onClick={() => void checkWritingScriptUpdates()}
                disabled={isCheckingWritingSync || isApplyingWritingSync}
                className="h-9 px-4 bg-bg-surface-soft text-text-primary hover:bg-bg-surface-hover rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 text-gold ${(isCheckingWritingSync || isApplyingWritingSync) ? "animate-spin" : ""}`} />
                <span>{isCheckingWritingSync ? "检查中..." : isApplyingWritingSync ? "同步中..." : "检查剧本更新"}</span>
              </button>
            </>
          )}
          <ProductionNarrativeEntitySyncButton project={project} updateProject={updateProject} />
          {activePlan && (
            <button
              type="button"
              disabled={isGenerating && promptAction === "qa"}
              onClick={() => setPromptAction("qa")}
              className="h-9 px-4 bg-bg-surface-soft text-text-primary hover:bg-bg-surface-hover rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isGenerating && promptAction === "qa" ? "质检中..." : "质检"}
            </button>
          )}
          {activePlan?.qa && (
            <button
              type="button"
              disabled={isGenerating && promptAction === "optimize"}
              onClick={() => setPromptAction("optimize")}
              className="h-9 px-4 bg-bg-surface-soft text-gold hover:bg-bg-surface-hover rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isGenerating && promptAction === "optimize" ? "按意见优化..." : "按意见优化"}
            </button>
          )}
          <button
            type="button"
            disabled={isHydratingScriptUnit || isLoadingManualPlan || !sourceText.trim()}
            onClick={async () => {
              setIsLoadingManualPlan(true);
              try {
                const sourceProject = await legacyProjectClient.getProject(project.id, "shell", { sourceDocumentId: sourceDocument.id });
                if (!sourceProject) throw new Error("当前制片来源无法读取，请重试");
                const snapshot = sourceProject.productionSourceSnapshot;
                const sourceScenes = snapshot?.sourceType === "writing_export"
                  ? snapshot.package.units.find((unit) => unit.id === sourceDocument.sourceWritingUnitId)?.scenes || [] : [];
                setManualPlanDraft({ sourceDocumentId: sourceDocument.id, scenes: activePlan?.candidateScenes || initialManualScenePlan(sourceText, sourceScenes, interactiveNodes, sourceTargetDurationMinutes) });
                setIsManualPlanOpen(true);
              } catch (error) { toast.error(error instanceof Error ? error.message : "无法读取场次来源"); }
              finally { setIsLoadingManualPlan(false); }
            }}
            className="h-9 px-4 bg-bg-surface-soft text-text-primary hover:bg-bg-surface-hover rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer disabled:opacity-50 active:scale-95"
          >
            {activePlan ? "手动修改场次方案" : "手动规划场次"}
          </button>
          <button
            type="button"
            disabled={isHydratingScriptUnit || (isGenerating && promptAction === "plan")}
            onClick={() => setPromptAction("plan")}
            className="h-9 px-4 btn-primary rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
          >
            <Sparkles className="h-4 w-4" />
            <span>{activePlan ? "重新生成场次方案" : "生成本单元场次方案"}</span>
          </button>
        </div>
	      </header>
      <div className="pb-5"><ProductionCreativeControls project={project} episode={episode} /></div>
	      {!isEditingScript && recoveryDraft && (
	        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-amber/30 bg-accent-amber/10 px-4 py-3 text-xs text-text-secondary">
	          <span>{recoveryDraft.saveState === "saving" ? "上次保存可能被刷新中断，草稿仍在本机。" : "发现尚未正式保存的本地草稿。"}</span>
	          <button type="button" onClick={openScriptEditor} className="font-bold text-gold hover:underline">继续编辑并核对</button>
	        </div>
	      )}
	      <section className="mt-5 min-w-0 animate-fade-in">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">当前来源</p>
            <h3 className="mt-1 text-base font-black text-text-primary">{sourceDocument.title}</h3>
          </div>
        </div>
        {activePlan && (
          <div className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 text-xs font-bold leading-normal transition-all ${
            activePlan.qa?.verdict === "revise"
              ? "bg-bg-surface-soft text-accent-amber"
              : "bg-bg-surface-soft text-gold"
          }`}>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              <span>
                当前场次方案已采用，共 <strong className="font-black">{activePlan.adoptedSceneSnapshot.length}</strong> 场。
                {activePlan.qa ? ` 质检评分：${activePlan.qa.score} 分 (${activePlan.qa.verdict === "pass" ? "通过" : "需优化"})` : ""}
              </span>
            </div>
          </div>
        )}
        {interactiveNodes.length > 0 && (
          <details className="mb-5 overflow-hidden rounded-2xl border border-gold/20 bg-gold/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-xs font-black text-gold select-none hover:bg-gold/10">
              <span className="flex items-center gap-2"><GitBranch className="h-4 w-4" />互动路径约束 · 本剧本单元</span>
              <span className="text-[10px] text-text-muted">{interactiveNodes.length} 个锁定节点</span>
            </summary>
            <div className="space-y-3 border-t border-gold/15 px-5 py-4">
              <p className="text-[11px] leading-5 text-text-muted">这里展示互动模块锁定的路径、选择和状态合同。它们只约束本单元的场次规划；资产、镜头和媒体仍在共享工作台中创建。</p>
              {interactiveNodes.map((node) => (
                <article key={node.nodeId} className="rounded-xl bg-bg-surface-soft px-4 py-3 text-xs text-text-secondary">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-text-primary">{node.title}</strong>
                    <span className="rounded-md bg-bg-surface px-2 py-1 text-[10px] font-bold text-text-muted">{node.dramaticFunction}{node.isEnding ? " · 结局" : ""}</span>
                  </div>
                  {(node.readVariables.length > 0 || node.writeVariables.length > 0 || node.requiredFacts.length > 0 || node.producedFacts.length > 0) && (
                    <p className="mt-2 text-[11px] leading-5 text-text-muted">
                      {node.readVariables.length > 0 ? `读取：${node.readVariables.join("、")}。` : ""}
                      {node.writeVariables.length > 0 ? `写入：${node.writeVariables.join("、")}。` : ""}
                      {node.requiredFacts.length > 0 ? `前置事实：${node.requiredFacts.join("、")}。` : ""}
                      {node.producedFacts.length > 0 ? `产生事实：${node.producedFacts.join("、")}。` : ""}
                    </p>
                  )}
                  {node.choices.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px] leading-5 text-text-muted">
                      {node.choices.map((choice) => <li key={choice.choiceId}>选择“{choice.text}” → {interactiveNodeTitleById.get(choice.targetNodeId) || choice.targetNodeId}{choice.timeoutSeconds ? `（${choice.timeoutSeconds} 秒）` : ""}</li>)}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
        <article className="bg-bg-surface rounded-2xl overflow-hidden transition-all">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft/10 px-6 py-4">
            <div>
              <div className="text-xs font-black text-text-muted">当前正式剧本</div>
              <p className="mt-1 text-[11px] text-text-muted">
                {scriptWorkspace.syncStatus === "conflict"
                  ? "当前内容是仅本次制片改稿；后续剧本工作台更新需要先处理冲突。"
                  : scriptWorkspace.authority === "writing"
                  ? "来源为剧本工作台；制片内改稿会保留为可追溯修订。"
                  : "来源为本制片项目，可以直接点击正文修改。"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted">
              {scriptWorkspace.syncStatus === "conflict" && (
                <button
                  type="button"
                  onClick={() => setIsScriptConflictOpen(true)}
                  className="rounded-lg bg-accent-amber/10 px-2.5 py-1 text-accent-amber hover:bg-accent-amber/20"
                >
                  处理制片改稿
                </button>
              )}
              {activePlan?.sourceStatus === "needs_review" && <span className="rounded-lg bg-accent-amber/10 px-2.5 py-1 text-accent-amber">场次待复核</span>}
            </div>
          </div>
          {isHydratingScriptUnit ? (
            <div className="flex min-h-[280px] items-center justify-center px-6 text-sm font-semibold text-text-muted">正在加载当前{project.type === "movie" ? "段落" : "剧集"}正文...</div>
          ) : isEditingScript ? (
            <div className="space-y-4 p-6">
              {recoveryDraft && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-4 py-3 text-xs text-text-secondary">
                  <span>发现上次未保存的本地草稿，尚未写入正式剧本。</span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScriptDraft({
                          title: recoveryDraft.title,
                          summary: recoveryDraft.summary,
                          targetDurationMinutes: recoveryDraft.targetDurationMinutes,
                          content: recoveryDraft.content,
                        });
                        setRecoveryDraft(null);
                      }}
                      className="font-bold text-gold hover:underline"
                    >恢复草稿</button>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecoveryDraft(project.id, sourceDocument?.id);
                        setRecoveryDraft(null);
                      }}
                      className="font-bold text-text-muted hover:text-text-primary"
                    >丢弃</button>
                  </span>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                <label className="block min-w-0">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-text-muted">标题</span>
                  <input
                    value={scriptDraft.title}
                    onChange={(event) => setScriptDraft((draft) => ({ ...draft, title: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-border-soft bg-bg-surface px-3 text-sm font-semibold text-text-primary outline-none focus:border-gold"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-text-muted">目标时长（分钟）</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={scriptDraft.targetDurationMinutes}
                    onChange={(event) => setScriptDraft((draft) => ({ ...draft, targetDurationMinutes: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-border-soft bg-bg-surface px-3 text-sm font-semibold text-text-primary outline-none focus:border-gold"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-text-muted">本集摘要</span>
                <textarea
                  value={scriptDraft.summary}
                  onChange={(event) => setScriptDraft((draft) => ({ ...draft, summary: event.target.value }))}
                  className="min-h-20 w-full resize-y rounded-lg border border-border-soft bg-bg-surface px-3 py-2 text-sm leading-6 text-text-primary outline-none focus:border-gold"
                  placeholder="这一集或段落承担什么故事任务？"
                />
              </label>
              <label className="block">
                <span className="mb-2 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-text-muted"><span>完整剧本正文</span><span className="shrink-0 normal-case tracking-normal">{scriptDraftCharacterCount.toLocaleString()} 字{scriptDraft.targetDurationMinutes ? ` · 目标 ${scriptDraft.targetDurationMinutes} 分钟` : ""}</span></span>
                <textarea
                  value={scriptDraft.content}
                  onChange={(event) => setScriptDraft((draft) => ({ ...draft, content: event.target.value }))}
                  className="min-h-[420px] w-full resize-y rounded-lg border border-border-soft bg-bg-surface px-4 py-3 font-mono text-sm leading-7 text-text-primary outline-none focus:border-gold"
                  placeholder="直接输入或粘贴剧本正文"
                />
              </label>
	              <p className="text-xs text-text-muted">修改保存为本次制片版本。源剧本请在剧本工作区编辑。</p>
	              {scriptSaveError && (
	                <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs font-semibold leading-5 text-red-300">
	                  保存失败：{scriptSaveError}。当前草稿仍保留，可以直接重试。
	                </p>
	              )}
	              <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft/10 pt-4">
                <button
                  type="button"
                  onClick={cancelScriptEditor}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-bg-surface-soft px-4 text-xs font-bold text-text-primary hover:bg-bg-surface-hover"
                >
                  <X className="h-4 w-4" />取消
                </button>
                {isScriptDraftDirty && <span className="self-center text-xs font-semibold text-accent-amber">有未保存修改</span>}
                <button
                  type="button"
                  disabled={isSavingScript}
                  onClick={() => void persistScriptDraft(scriptDraft, { unitId: scriptUnit?.id, sourceDocumentId: sourceDocument.id })}
                  className="flex h-9 items-center gap-1.5 rounded-lg btn-primary px-4 text-xs font-bold disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />{isSavingScript ? "保存中..." : "保存剧本"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openScriptEditor}
              className="block w-full cursor-text whitespace-pre-wrap bg-bg-surface p-6 text-left text-sm font-normal leading-8 text-text-secondary outline-none transition-colors hover:bg-bg-surface-hover/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
              aria-label="编辑当前剧本"
            >
              {sourceText}
            </button>
          )}
        </article>
        {originalNovel && (
          <details
            className="mt-5 rounded-2xl bg-bg-surface-soft overflow-hidden"
            open={showOriginalNovel}
            onToggle={(event) => setShowOriginalNovel((event.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer px-5 py-4 text-xs font-black text-text-muted select-none hover:text-gold transition-colors">保留的原小说</summary>
            <pre className="whitespace-pre-wrap p-5 text-xs leading-7 text-text-secondary">{originalNovel.content}</pre>
          </details>
        )}
      </section>
      <PromptEditorModal isOpen={Boolean(promptAction)} autoConfirm={Boolean(project.interactiveProductionPrepProfile)} onClose={() => setPromptAction(null)} templateId={promptAction === "qa" ? "productionScenePlanQa" : promptAction === "optimize" ? "productionScenePlanOptimize" : "productionScenePlan"} title={promptAction === "qa" ? "场次方案质检 - 提示词确认" : promptAction === "optimize" ? "场次方案优化 - 提示词确认" : "生成场次方案 - 提示词确认"} contextOptions={context.options} defaultSelectedContextIds={context.defaultIds} activeEpisodeId={episode.id} workflowStepId={promptAction === "qa" ? "production.preparation.scene_plan_qa" : promptAction === "optimize" ? "production.preparation.scene_plan_optimize" : "production.preparation.scene_plan"} variables={{ ...promptVariables, creativeDirection: renderProductionCreativeContext(project, { episode }, "planning") }} onConfirm={generate} />
      <PromptEditorModal
        isOpen={isNewUnitAiPromptOpen}
        onClose={() => !isDraftingNewUnitWithAi && setIsNewUnitAiPromptOpen(false)}
        templateId="productionNovelToScript"
        title={`补写${project.type === "movie" ? "电影段落" : "剧集"} - 提示词确认`}
        contextOptions={context.options}
        defaultSelectedContextIds={context.defaultIds}
        activeEpisodeId={episode.id}
        workflowStepId="production.preparation.script_unit_draft"
        variables={{
          projectFormat: project.type === "movie" ? "电影" : project.type === "tv-series" ? "电视剧" : "短剧",
          sourceTitle: newUnitDraft.title || `待新增${project.type === "movie" ? "段落" : "剧集"}`,
          sourceContent: [
            newUnitDraft.summary ? `【作者设定】\n${newUnitDraft.summary}` : "",
            newUnitDraft.content ? `【已有草稿】\n${newUnitDraft.content}` : "",
            `【相邻内容参考】\n${productionScenePlanContinuityContext(project, sourceDocument.id)}`,
          ].filter(Boolean).join("\n\n"),
        }}
        onConfirm={draftNewUnitWithAi}
      />

      <Modal
        isOpen={isNewUnitOpen}
        onClose={cancelNewUnitEditor}
        title={`新增${project.type === "movie" ? "电影段落" : "剧集"}`}
        size="xl"
        className="bg-bg-primary text-text-primary max-w-4xl border border-border-primary/40 shadow-2xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-[11px] text-text-muted flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-gold shrink-0" />
              <span>新增后将作为独立工作单元进入剧本与场次，全剧资产共用。</span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className="h-8 px-4 bg-bg-surface text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover transition-all cursor-pointer active:scale-95 border border-border-soft/20"
                onClick={cancelNewUnitEditor}
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSavingScript || (newUnitSourceMode === "writing" ? !selectedWritingImportUnitId : (!newUnitDraft.title.trim() && !newUnitDraft.content.trim()))}
                className="h-8 px-5 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95 disabled:opacity-50 flex items-center gap-1.5 transition-all shadow-sm"
                onClick={() => {
                  const fallbackTitle = project.type === "movie"
                    ? `分段 ${(scriptRevision?.units.length || 0) + 1}`
                    : `第 ${(scriptRevision?.units.length || 0) + 1} 集`;
                  const finalDraft = {
                    ...newUnitDraft,
                    title: newUnitDraft.title.trim() || fallbackTitle,
                  };
                  void persistScriptDraft(finalDraft, {
                    isNew: true,
                    unitId: newUnitIdentity?.unitId,
                    sourceDocumentId: newUnitIdentity?.sourceDocumentId,
                    newWritingUnitId: newUnitSourceMode === "manual" ? newUnitIdentity?.writingUnitId : undefined,
                    sourceWritingUnitId: newUnitSourceMode === "writing" && selectedWritingImportProjectId === scriptWorkspace.writingProjectId
                      ? selectedWritingImportUnitId
                      : undefined,
                    skipWritingWriteback: newUnitSourceMode === "writing",
                    continuityMode: newUnitSourceMode === "writing" ? selectedWritingImportUnit?.continuityMode : undefined,
                    insertAfterUnitId: newUnitPlacement === "after_current" ? scriptUnit?.id : undefined,
                  });
                }}
              >
                {isSavingScript ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>保存中...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>保存并加入制片</span>
                  </>
                )}
              </button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3.5">
          {scriptSaveError && (
            <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs font-medium leading-5 text-red-400 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>保存失败：{scriptSaveError}。当前内容没有被当作已保存，可以直接重试。</span>
            </p>
          )}

          {/* Top Segmented Mode Switch & AI Trigger */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft/10 pb-3">
            <div className="inline-flex rounded-xl bg-bg-surface p-1 border border-border-soft/20" aria-label="剧本来源">
              <button
                type="button"
                onClick={() => void chooseNewUnitSourceMode("manual")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${newUnitSourceMode === "manual" ? "bg-bg-primary text-text-primary shadow-sm border border-border-soft/20 text-gold" : "text-text-muted hover:text-text-primary"}`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>自己输入剧本</span>
              </button>
              <button
                type="button"
                onClick={() => void chooseNewUnitSourceMode("writing")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${newUnitSourceMode === "writing" ? "bg-bg-primary text-text-primary shadow-sm border border-border-soft/20 text-gold" : "text-text-muted hover:text-text-primary"}`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>从剧本模块导入</span>
              </button>
            </div>

            {newUnitSourceMode === "manual" && (
              <button
                type="button"
                disabled={isDraftingNewUnitWithAi || (!newUnitDraft.title.trim() && !newUnitDraft.summary.trim() && !newUnitDraft.content.trim())}
                onClick={() => setIsNewUnitAiPromptOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-gold/30 bg-gold/10 px-3 text-xs font-bold text-gold hover:bg-gold/20 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                title={(!newUnitDraft.title.trim() && !newUnitDraft.summary.trim() && !newUnitDraft.content.trim()) ? "先输入标题或摘要即可使用 AI 补写" : "AI 根据设定和相邻集上下文补写正文"}
              >
                <Sparkles className="h-3.5 w-3.5 text-gold animate-pulse" />
                <span>{isDraftingNewUnitWithAi ? "AI 补写中..." : "让 AI 补写"}</span>
              </button>
            )}
          </div>

          {/* Two-Column Responsive Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            {/* Left Column: Metadata & Settings (5 cols) */}
            <div className="md:col-span-5 flex flex-col gap-3">
              {newUnitSourceMode === "writing" && (
                <div className="space-y-3 rounded-xl border border-border-soft/30 bg-bg-surface-soft/30 p-3">
                  <div className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-gold" />
                    <span>选择剧本项目与分集</span>
                  </div>
                  {isLoadingWritingImport && <p className="text-xs text-text-muted">正在读取剧本模块...</p>}
                  {!isLoadingWritingImport && writingImportProjects.length === 0 && <p className="text-xs text-text-muted">没有可导入的剧本项目。</p>}
                  {writingImportProjects.length > 0 && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-text-secondary">剧本项目</span>
                      <select
                        value={selectedWritingImportProjectId}
                        onChange={(event) => void loadWritingImportProject(event.target.value)}
                        className="h-8 w-full rounded-lg border border-border-soft bg-bg-surface px-2.5 text-xs font-semibold text-text-primary outline-none focus:border-gold"
                      >
                        {writingImportProjects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                    </label>
                  )}
                  {writingImportPackage && writingImportUnits.length === 0 && <p className="text-xs leading-5 text-text-muted">这个项目还没有已写正文，暂时没有可导入的剧集。</p>}
                  {writingImportUnits.length > 0 && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-text-secondary">选择剧集</span>
                      <select
                        value={selectedWritingImportUnitId}
                        onChange={(event) => {
                          const unit = writingImportUnits.find((item) => item.id === event.target.value);
                          if (unit) selectWritingImportUnit(unit);
                        }}
                        className="h-8 w-full rounded-lg border border-border-soft bg-bg-surface px-2.5 text-xs font-semibold text-text-primary outline-none focus:border-gold"
                      >
                        <option value="">请选择</option>
                        {writingImportUnits.map((unit) => <option key={unit.id} value={unit.id} disabled={importedWritingUnitIds.has(unit.id)}>{unit.index}. {unit.title}{importedWritingUnitIds.has(unit.id) ? "（已在制片中）" : ""}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {/* Title */}
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-text-secondary flex items-center justify-between">
                  <span>标题</span>
                  <span className="text-[10px] text-gold font-medium">必填</span>
                </span>
                <input
                  readOnly={newUnitSourceMode === "writing"}
                  value={newUnitDraft.title}
                  onChange={(event) => updateManualNewUnitDraft({ title: event.target.value })}
                  className="h-8.5 w-full rounded-lg border border-border-soft bg-bg-surface px-3 text-xs font-semibold text-text-primary outline-none focus:border-gold read-only:text-text-muted placeholder:text-text-muted/60"
                  placeholder={project.type === "movie" ? "例如：高潮前的失败" : `例如：第 ${(scriptRevision?.units.length || 0) + 1} 集：证人失联`}
                />
              </label>

              {/* Placement & Duration */}
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-text-secondary">加入位置</span>
                  <select
                    value={newUnitPlacement}
                    onChange={(event) => setNewUnitPlacement(event.target.value as "after_current" | "at_end")}
                    className="h-8.5 w-full rounded-lg border border-border-soft bg-bg-surface px-2 text-xs font-semibold text-text-primary outline-none focus:border-gold cursor-pointer"
                  >
                    <option value="after_current">当前{project.type === "movie" ? "段落" : "剧集"}之后</option>
                    <option value="at_end">排在全剧最后</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-text-secondary">目标时长（分钟）</span>
                  <div className="relative flex items-center">
                    <input
                      readOnly={newUnitSourceMode === "writing"}
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={newUnitDraft.targetDurationMinutes}
                      onChange={(event) => updateManualNewUnitDraft({ targetDurationMinutes: event.target.value })}
                      className="h-8.5 w-full rounded-lg border border-border-soft bg-bg-surface pl-3 pr-8 text-xs font-semibold text-text-primary outline-none focus:border-gold read-only:text-text-muted"
                      placeholder="2"
                    />
                    <span className="pointer-events-none absolute right-2.5 text-[11px] font-bold text-text-muted">分</span>
                  </div>
                </label>
              </div>

              {/* Summary */}
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-text-secondary flex items-center justify-between">
                  <span>摘要</span>
                  <span className="text-[10px] text-text-muted">可选</span>
                </span>
                <textarea
                  readOnly={newUnitSourceMode === "writing"}
                  value={newUnitDraft.summary}
                  onChange={(event) => updateManualNewUnitDraft({ summary: event.target.value })}
                  className="h-20 w-full resize-none rounded-lg border border-border-soft bg-bg-surface p-2.5 text-xs leading-5 text-text-primary outline-none focus:border-gold read-only:text-text-muted placeholder:text-text-muted/60"
                  placeholder="这部分发生什么，为什么需要它？"
                />
              </label>

              {/* Authority writeback mode */}
              <p className="text-xs text-text-muted">修改保存为本次制片版本。源剧本请在剧本工作区编辑。</p>
            </div>

            {/* Right Column: Script Text Content (7 cols) */}
            <div className="md:col-span-7 flex flex-col min-h-0">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary">完整剧本正文</span>
                <span className="text-[11px] font-medium text-text-muted">
                  {newUnitDraft.content ? `${newUnitDraft.content.replace(/\s/g, "").length} 字` : "支持直接粘贴或留空后由 AI 生成"}
                </span>
              </div>
              <textarea
                readOnly={newUnitSourceMode === "writing"}
                value={newUnitDraft.content}
                onChange={(event) => updateManualNewUnitDraft({ content: event.target.value })}
                className="h-[250px] w-full resize-none rounded-lg border border-border-soft bg-bg-surface p-3.5 font-mono text-xs leading-relaxed text-text-primary outline-none focus:border-gold read-only:text-text-muted placeholder:text-text-muted/50"
                placeholder={newUnitSourceMode === "writing" ? "（已选择分集的正文将在此预览）" : "直接输入或粘贴剧本正文"}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isArchiveUnitOpen}
        onClose={() => !isSavingScript && setIsArchiveUnitOpen(false)}
        title={`删除当前${project.type === "movie" ? "段落" : "剧集"}`}
        className="bg-bg-surface text-text-primary"
        footer={
          <>
            <button type="button" disabled={isSavingScript} className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95 disabled:opacity-50" onClick={() => setIsArchiveUnitOpen(false)}>取消</button>
            <button type="button" disabled={isSavingScript} className="h-8 px-4 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95 disabled:opacity-50" onClick={() => void archiveCurrentUnit()}>{isSavingScript ? "处理中..." : "确认删除"}</button>
          </>
        }
      >
        <div className="space-y-3 text-xs leading-6 text-text-secondary">
          <p>删除后，这一{project.type === "movie" ? "段" : "集"}不再出现在剧本列表中。</p>
          {scriptWorkspace.authority === "writing" ? (
            <p className="rounded-lg bg-bg-surface-soft px-3 py-2">只从当前制片版本移除，源剧本保持不变。已有制片记录保留并标记为需要重新检查。</p>
          ) : (
            <p className="rounded-lg bg-bg-surface-soft px-3 py-2">已有场次和分镜不会被直接清空，但会标记为需要重新检查。</p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isScriptConflictOpen}
        onClose={() => !isResolvingScriptConflict && setIsScriptConflictOpen(false)}
        title="处理制片改稿"
        className="bg-bg-surface text-text-primary"
        footer={<button type="button" disabled={isResolvingScriptConflict} className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover disabled:opacity-50" onClick={() => setIsScriptConflictOpen(false)}>暂不处理</button>}
      >
        <div className="space-y-4">
          <p className="text-xs leading-6 text-text-secondary">当前制片使用的剧本与剧本工作台不同。系统不会猜测哪一版正确，请明确选择保留哪一版。</p>
          <button
            type="button"
            disabled={isResolvingScriptConflict}
            onClick={() => void resolveScriptConflict("keep_production")}
            className="w-full rounded-lg border border-border-soft bg-bg-surface-soft px-4 py-4 text-left hover:bg-bg-surface-hover disabled:opacity-50"
          >
            <strong className="text-sm text-text-primary">采用当前制片改稿</strong>
            <span className="mt-2 block text-xs leading-5 text-text-muted">保留当前制片改稿，并停止该项目的源剧本自动同步。源剧本保持不变。</span>
          </button>
          <button
            type="button"
            disabled={isResolvingScriptConflict}
            onClick={() => void resolveScriptConflict("accept_writing")}
            className="w-full rounded-lg border border-border-soft bg-bg-surface-soft px-4 py-4 text-left hover:bg-bg-surface-hover disabled:opacity-50"
          >
            <strong className="text-sm text-text-primary">采用剧本工作台版本</strong>
            <span className="mt-2 block text-xs leading-5 text-text-muted">放弃当前制片专用正文，读取剧本工作台的最新版本；已有关联场次会进入待复核。</span>
          </button>
          {isResolvingScriptConflict && <p className="text-xs font-semibold text-gold">正在保存选择并核对两边版本...</p>}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(writingSyncPreview)}
        onClose={() => !isApplyingWritingSync && setWritingSyncPreview(null)}
        title="同步中心"
        className="bg-bg-surface text-text-primary"
        footer={
          <>
            <button type="button" disabled={isApplyingWritingSync} className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95" onClick={() => setWritingSyncPreview(null)}>暂不处理</button>
            <button type="button" disabled={isApplyingWritingSync} className="h-8 px-4 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95 disabled:opacity-50" onClick={() => void applyWritingScriptSync()}>{isApplyingWritingSync ? "同步中..." : "采用剧本更新"}</button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs leading-6 text-text-secondary">这里汇总上游故事改动、当前正式剧本和下游制片影响。采用后只更新剧本工作范围；新增内容不会自动生成制片场次。</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <article className="rounded-xl bg-bg-surface-soft px-4 py-3"><p className="text-[10px] font-bold text-text-muted">故事变化</p><p className="mt-1 text-xs font-black text-text-primary">{writingSyncPreview?.changes.length || 0} 处待采用</p></article>
            <article className="rounded-xl bg-bg-surface-soft px-4 py-3"><p className="text-[10px] font-bold text-text-muted">制片影响</p><p className="mt-1 text-xs font-black text-text-primary">{writingSyncImpact?.reviewPlans || 0} 个场次方案待复核</p></article>
            <article className="rounded-xl bg-bg-surface-soft px-4 py-3"><p className="text-[10px] font-bold text-text-muted">互动影响</p><p className="mt-1 text-xs font-black text-text-primary">{writingSyncImpact?.reviewNodes || 0} 个节点需查看</p></article>
          </div>
          {writingSyncImpact?.added ? <p className="rounded-xl bg-gold/5 px-4 py-3 text-xs font-semibold text-text-secondary">新增 {writingSyncImpact.added} 个剧本单元会直接成为制片工作范围，但场次数保持为 0。</p> : null}
          {writingSyncImpact?.requiresReview ? <p className="rounded-xl bg-accent-amber/10 px-4 py-3 text-xs font-semibold text-accent-amber">已有场次方案的内容不会被覆盖；采用后会标记为待复核。</p> : null}
          <div className="space-y-2">
            {writingSyncPreview?.changes.map((change) => (
              <article key={`${change.type}-${change.sourceWritingUnitId}`} className="flex items-center justify-between gap-4 rounded-xl border border-border-soft/20 bg-bg-surface-soft px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-text-primary">{change.title}</p>
                  <p className="mt-1 text-[10px] text-text-muted">
                    {change.type === "unit_added" ? "新增剧本单元" : change.type === "unit_updated" ? "正文或时长已修改" : change.type === "unit_moved" ? "顺序已调整" : "已从剧本移出"}
                  </p>
                </div>
                {change.requiresReview && <span className="shrink-0 rounded-lg bg-accent-amber/10 px-2 py-1 text-[10px] font-bold text-accent-amber">场次待复核</span>}
              </article>
            ))}
          </div>
        </div>
      </Modal>
      
      <Modal
        isOpen={isManualPlanOpen}
        onClose={() => setIsManualPlanOpen(false)}
        title="手动规划场次"
        size="xl"
        className="bg-bg-surface text-text-primary"
      >
        {isManualPlanOpen && <ManualScenePlanEditor
          key={`${sourceDocument.id}:${sourceDocument.sourceHash}:${activePlan?.id || "new"}`}
          sourceText={sourceText}
          nodes={interactiveNodes}
          targetDurationMinutes={sourceTargetDurationMinutes}
          initialScenes={(manualPlanDraft?.sourceDocumentId === sourceDocument.id ? manualPlanDraft.scenes : null) || activePlan?.candidateScenes || initialManualScenePlan(
            sourceText,
            project.productionSourceSnapshot?.sourceType === "writing_export"
              ? project.productionSourceSnapshot.package.units.find((unit) => unit.id === sourceDocument.sourceWritingUnitId)?.scenes || []
              : [],
            interactiveNodes,
            sourceTargetDurationMinutes,
          )}
          onCancel={() => setIsManualPlanOpen(false)}
          onConfirm={(scenes) => {
            setManualPlanDraft({ sourceDocumentId: sourceDocument.id, scenes });
            setCandidate({ scenes, prompt: "作者手动规划场次", origin: "manual" });
            setIsManualPlanOpen(false);
          }}
        />}
      </Modal>
      <Modal
        isOpen={Boolean(candidate)}
        onClose={() => setCandidate(null)}
        title="场次方案候选"
        size="xl"
        className="bg-bg-surface text-text-primary"
        footer={
          <>
            {candidate?.origin === "manual" && <button type="button" className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95" onClick={() => { setManualPlanDraft({ sourceDocumentId: sourceDocument.id, scenes: candidate.scenes }); setCandidate(null); setIsManualPlanOpen(true); }}>返回编辑</button>}
            <button type="button" className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95" onClick={() => setCandidate(null)}>放弃</button>
            <button type="button" disabled={!candidateCanBeAdopted || (candidateReplacementImpact.length > 0 && !confirmedSceneReplacement)} className="h-8 px-4 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void adopt()}>采用并更新制片场次</button>
          </>
        }
      >
        <div className="space-y-4">
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-bold ${candidateDurationMatchesTarget ? "bg-bg-surface-soft text-text-secondary" : "bg-accent-amber/10 text-accent-amber"}`}>
            <span>候选 {candidate?.scenes.length || 0} 场 · 规划 {candidateDurationMinutes.toFixed(2)} 分钟</span>
            <span>
              {sourceTargetDurationMinutes
                ? candidateDurationMatchesTarget
                  ? `与来源目标 ${sourceTargetDurationMinutes} 分钟一致`
                  : `来源目标 ${sourceTargetDurationMinutes} 分钟，差值 ${candidateDurationDelta > 0 ? "+" : ""}${candidateDurationDelta.toFixed(2)} 分钟`
                : "来源未设置目标时长"}
            </span>
          </div>
          {!candidateDurationMatchesTarget && (
            <p className="text-xs font-semibold text-accent-amber">每场必须有有效时长，且总和与来源目标一致后才能采用；请返回修改场次方案。</p>
          )}
          {!candidateHasCompleteInteractiveCoverage && interactiveNodes.length > 0 && (
            <p className="text-xs font-semibold text-accent-amber">候选尚未覆盖全部互动节点，不能采用。请为每个场次标明它服务的互动节点。</p>
          )}
          {candidateReplacementImpact.length > 0 && <label className="flex items-start gap-2 rounded-xl border border-accent-amber/30 bg-accent-amber/10 px-4 py-3 text-xs leading-relaxed text-accent-amber">
            <input type="checkbox" className="mt-0.5" checked={confirmedSceneReplacement} onChange={(event) => setConfirmedSceneReplacement(event.target.checked)} />
            <span>此次会替换或移除 {candidateReplacementImpact.length} 个已有场次。其现有分镜、资产等下游关联可能失效；完整旧场次将保存在方案版本快照中。我已核对影响并确认继续。</span>
          </label>}
          {candidate?.scenes.map((scene) => (
            <article key={scene.id} className="bg-bg-surface rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-surface-soft text-xs font-black text-gold">{scene.order}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black text-text-primary">{scene.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-text-muted">
                    <span className="rounded-lg bg-bg-surface-soft px-2 py-1">
                      目标时长 {scene.targetDurationMinutes ? `${Math.floor(Math.round(scene.targetDurationMinutes * 60) / 60)}分${Math.round(scene.targetDurationMinutes * 60) % 60}秒` : "缺失"}
                    </span>
                    {scene.continuityIn && <span className="rounded-lg bg-bg-surface-soft px-2 py-1">入场：{scene.continuityIn}</span>}
                    {scene.continuityOut && <span className="rounded-lg bg-bg-surface-soft px-2 py-1">出场：{scene.continuityOut}</span>}
                    {scene.interactiveNodeIds?.map((nodeId) => <span key={nodeId} className="rounded-lg bg-gold/10 px-2 py-1 text-gold">互动节点：{interactiveNodeTitleById.get(nodeId) || nodeId}</span>)}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">{scene.description}</p>
                  {scene.purpose && (
                    <div className="mt-3 rounded-lg bg-bg-surface-soft px-3 py-2 text-xs font-semibold text-text-secondary">
                      目的：{scene.purpose}
                    </div>
                  )}
                  <details className="mt-4 rounded-xl p-4 bg-bg-surface-soft">
                    <summary className="cursor-pointer text-xs font-bold text-text-muted select-none">原文依据</summary>
                    <pre className="mt-3 whitespace-pre-wrap border-l-2 border-border-soft pl-3 text-xs leading-relaxed text-text-secondary">{scene.sourceEvidence}</pre>
                  </details>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(qaCandidate)}
        onClose={() => setQaCandidate(null)}
        title="场次方案质检预览"
        className="bg-bg-surface text-text-primary"
        footer={
          <>
            <button type="button" className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95" onClick={() => setQaCandidate(null)}>放弃</button>
            <button type="button" className="h-8 px-4 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95" onClick={() => void adoptQa()}>确认质检结果</button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-4xl font-black text-text-primary">{qaCandidate?.score || 0}</p>
          <p className="text-sm font-bold text-text-secondary">{qaCandidate?.summary || "未提供总结"}</p>
          {qaCandidate?.issues.map((issue, index) => (
            <div key={`${issue.description}-${index}`} className="border-l-2 border-accent-amber pl-3 text-xs leading-relaxed text-text-secondary">
              <span className="mr-2 text-[10px] font-black text-accent-amber uppercase tracking-wider">{issue.severity}</span>
              <span>{issue.description}</span>
              {issue.suggestion && <p className="mt-1 text-[11px] text-text-muted">建议：{issue.suggestion}</p>}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
