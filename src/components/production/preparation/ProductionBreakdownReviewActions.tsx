import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import type { Episode, Project, Scene, ScriptBreakdown } from "../../../clients/domainTypes";
import PromptEditorModal, { type PromptEditorConfirmMetadata } from "../../PromptEditorModal";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { generateAIContent } from "../../../clients/aiClient";
import { safeParseAIResponse } from "../../../utils/aiParser";
import { gatherContextOptions } from "../../../utils/contextMapper";
import { manualFilmTeamSceneSource, manualFilmTeamScriptHash } from "../../../clients/productionPreparationWorkflowClient";
import { productionWritingSourceContext } from "../../../clients/productionPreparationWorkflowClient";
import {
  PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS,
  bindProductionBreakdownAssetsToCanonicalRegistry,
  normalizeProductionBreakdown,
  productionBreakdownAdoptionUpdates,
  productionBreakdownContextEntityScope,
  productionBreakdownPromptContext,
  productionBreakdownQaChecklistPrompt,
  productionBreakdownRequiredSourceRefs,
  projectProductionBreakdownRepairQa,
  reviewProductionBreakdownCandidate,
} from "../../../clients/productionPreparationWorkflowClient";
import { applyProductionSceneManualAssetBindingsToBreakdown } from "../../../clients/productionAssetWorkflowClient";
import { flushDebouncedProjectSave } from "../../../clients/stateClient";

type Qa = NonNullable<NonNullable<Scene["productionPreparation"]>["breakdown"]>["qa"];
type Candidate = { kind: "qa"; qa: Qa } | { kind: "breakdown"; breakdown: ScriptBreakdown; metadata?: PromptEditorConfirmMetadata; prompt: string };

export function ProductionBreakdownReviewActions({ project, episode, scene, updateProject, updateScene, externalBusy = false, onBusyChange }: { project: Project; episode: Episode; scene: Scene; updateProject: (updates: Partial<Project>) => Promise<void>; updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => Promise<void>; externalBusy?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [action, setAction] = useState<"qa" | "optimize" | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [running, setRunning] = useState(false);
  const context = useMemo(() => {
    const entityScope = productionBreakdownContextEntityScope(project, scene);
    return gatherContextOptions(project, "breakdown", {
      episodeIds: [episode.id],
      characterIds: entityScope.characterIds,
      assetIds: [],
      restrictEntityDefaults: true,
    });
  }, [episode.id, project, scene]);
  const source = manualFilmTeamSceneSource(scene);
  const sourceWritingContext = useMemo(() => productionWritingSourceContext(project, episode, scene), [episode, project, scene]);
  const breakdownPromptContext = useMemo(() => productionBreakdownPromptContext(project, episode, scene), [episode, project, scene]);
  const requiredSourceRefs = useMemo(() => productionBreakdownRequiredSourceRefs(scene).map((entry) => entry.ref), [scene]);
  const qaChecklist = useMemo(() => productionBreakdownQaChecklistPrompt(PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS), []);
  const record = scene.productionPreparation?.breakdown;
  const localBusy = running || Boolean(action) || Boolean(candidate);
  const actionBusy = externalBusy || localBusy;
  const hasActionableQaFinding = Boolean(
    record?.qa?.issues.some((issue) => issue.severity !== "advisory")
    || record?.qa?.checks?.some((check) => check.status === "blocking" || check.status === "warning"),
  );
  const canOptimize = record?.status === "needs_revision"
    && record.qa?.verdict === "revise"
    && hasActionableQaFinding;
  const open = (next: "qa" | "optimize") => {
    if (actionBusy || (next === "optimize" && !canOptimize)) return;
    setAction(next);
  };

  useEffect(() => {
    onBusyChange?.(localBusy);
    return () => onBusyChange?.(false);
  }, [localBusy, onBusyChange]);

  const execute = async (prompt: string, _intent?: string, metadata?: PromptEditorConfirmMetadata) => {
    if (!action || !scene.breakdown) return;
    setRunning(true);
    try {
      if (action === "qa") {
        const qa = await reviewProductionBreakdownCandidate(prompt, {
          requiredSourceRefs,
          requiredChecks: PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS,
        });
        const reviewedAt = Date.now();
        setCandidate({ kind: "qa", qa: { ...qa, audit: { templateId: "productionBreakdownQa", promptHash: manualFilmTeamScriptHash(prompt), selectedSkillIds: metadata?.selectedSkillIds || [], selectedSkillTitles: metadata?.selectedSkillTitles || [], selectedContextIds: metadata?.selectedContextIds || [], createdAt: reviewedAt }, reviewedAt } });
      } else {
        const { Type } = await import("../../../clients/aiSchemaClient");
        const namedEntitySchema = { type: Type.OBJECT, properties: { name: { type: Type.STRING }, state: { type: Type.STRING } }, required: ["name"] };
        const propSchema = { type: Type.OBJECT, properties: { name: { type: Type.STRING }, state: { type: Type.STRING }, requiresAsset: { type: Type.BOOLEAN }, assetReason: { type: Type.STRING } }, required: ["name", "requiresAsset"] };
        const response = await generateAIContent({ prompt, requireJson: true, schema: { type: Type.OBJECT, properties: { setting: { type: Type.STRING }, location: namedEntitySchema, time: { type: Type.STRING }, characters: { type: Type.ARRAY, items: namedEntitySchema }, props: { type: Type.ARRAY, items: propSchema }, vfx: { type: Type.ARRAY, items: { type: Type.STRING } }, sfx: { type: Type.ARRAY, items: { type: Type.STRING } }, wardrobe: { type: Type.ARRAY, items: { type: Type.STRING } }, makeupHair: { type: Type.ARRAY, items: { type: Type.STRING } }, vehicles: { type: Type.ARRAY, items: { type: Type.STRING } }, extrasAtmosphere: { type: Type.ARRAY, items: { type: Type.STRING } }, specialEquipment: { type: Type.ARRAY, items: { type: Type.STRING } }, bgm: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["prompt"] } } } } });
        const parsed = safeParseAIResponse(response, {});
        setCandidate({ kind: "breakdown", breakdown: { ...scene.breakdown, ...normalizeProductionBreakdown(parsed) }, metadata, prompt });
      }
      setAction(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "场次拆解操作失败"); } finally { setRunning(false); }
  };

  const adopt = async () => {
    if (!candidate) return;
    const now = Date.now();
    if (candidate.kind === "qa") await updateScene(scene.id, { productionPreparation: { ...(scene.productionPreparation || { schemaVersion: "production-preparation.v1", sceneId: scene.id }), breakdown: { status: record?.status || "confirmed", sourceHash: record?.sourceHash || manualFilmTeamScriptHash(source.text), promptAudit: record?.promptAudit, qa: candidate.qa, confirmedAt: record?.confirmedAt || now }, updatedAt: now } }, episode.id);
    else {
      const binding = bindProductionBreakdownAssetsToCanonicalRegistry(project, [{ sceneId: scene.id, breakdown: candidate.breakdown }]);
      const boundProject = { ...project, characters: binding.characters, assets: binding.assets };
      const boundBreakdown = applyProductionSceneManualAssetBindingsToBreakdown({
        project: boundProject,
        scene,
        breakdown: binding.entries[0].breakdown,
      });
      await updateProject({ characters: binding.characters, assets: binding.assets });
      const updates = productionBreakdownAdoptionUpdates({
        scene,
        breakdown: boundBreakdown,
        prompt: candidate.prompt,
        metadata: candidate.metadata,
        templateId: "productionBreakdownOptimize",
        now,
      });
      await updateScene(scene.id, {
        ...updates,
        productionPreparation: updates.productionPreparation ? {
          ...updates.productionPreparation,
          breakdown: updates.productionPreparation.breakdown ? {
            ...updates.productionPreparation.breakdown,
            status: "confirmed",
            qa: undefined,
            confirmedAt: now,
          } : undefined,
        } : undefined,
      }, episode.id);
    }
    await flushDebouncedProjectSave(project.id);
    setCandidate(null);
    toast.success(candidate.kind === "qa" ? "场次拆解检查结果已采用" : "优化结果已采用，可按需检查本场拆解");
  };

  return <>
    <button
      type="button"
      title="检查当前场的演员、场景、道具、造型、视听和连续性拆解"
      disabled={actionBusy}
      onClick={() => open("qa")}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:border-cyan-500/40 hover:text-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ShieldCheck className="h-4 w-4" />检查本场拆解
    </button>
    <button
      type="button"
      title={canOptimize
        ? "根据最近一次检查发现的问题重新整理本场拆解"
        : record?.qa?.verdict === "pass"
          ? "当前拆解已通过检查，无需优化"
          : "请先检查本场拆解"}
      disabled={actionBusy || !canOptimize}
      onClick={() => open("optimize")}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:border-cyan-500/40 hover:text-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Sparkles className="h-4 w-4" />按检查意见优化
    </button>
    <PromptEditorModal isOpen={Boolean(action)} onClose={() => setAction(null)} templateId={action === "qa" ? "productionBreakdownQa" : "productionBreakdownOptimize"} title={action === "qa" ? "检查本场拆解 - 提示词确认" : "按检查意见优化 - 提示词确认"} variables={{ scriptContent: breakdownPromptContext.variables.scriptContent, sourceEvidenceLedger: breakdownPromptContext.variables.sourceEvidenceLedger, sourceWritingContext, batchCanonicalAssets: breakdownPromptContext.variables.batchCanonicalAssets, currentBreakdown: JSON.stringify(scene.breakdown, null, 2), qaContext: record?.qa ? JSON.stringify(projectProductionBreakdownRepairQa(record.qa), null, 2) : "", qaChecklist }} contextOptions={context.options} defaultSelectedContextIds={[]} activeSceneId={scene.id} activeEpisodeId={episode.id} onConfirm={execute} />
    <Modal isOpen={Boolean(candidate)} onClose={() => setCandidate(null)} title={candidate?.kind === "qa" ? "本场拆解检查结果" : "本场拆解优化预览"} footer={<><Button size="sm" variant="secondary" onClick={() => setCandidate(null)}>放弃</Button><Button size="sm" onClick={() => void adopt()}>采用结果</Button></>}><div className="space-y-3">{candidate?.kind === "qa" ? <><p className="text-4xl font-black">{candidate.qa.score}</p><p>{candidate.qa.summary}</p>{candidate.qa.issues.map((item, index) => <p key={`${item.description}-${index}`} className="border-l-2 border-amber-400 pl-3 text-sm">{item.description}：{item.suggestion}</p>)}</> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{candidate ? JSON.stringify(candidate.breakdown, null, 2) : ""}</pre>}</div></Modal>
  </>;
}
