import { useMemo, useState } from "react";
import { Check, ClipboardCheck, Loader2, RefreshCw, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import type { Episode, Project, Scene, ScriptBreakdown } from "../../../clients/domainTypes";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import PromptEditorModal from "../../PromptEditorModal";
import type { PromptEditorConfirmMetadata } from "../../PromptEditorModal";
import { gatherContextOptions } from "../../../utils/contextMapper";
import { manualFilmTeamScriptHash } from "../../../clients/productionPreparationWorkflowClient";
import {
  bindProductionBreakdownAssetsToCanonicalRegistry,
  generateProductionBreakdownCandidate,
  productionBreakdownAdoptionUpdates,
  productionBreakdownContextEntityScope,
  productionBreakdownName,
  productionBreakdownPropRequiresAsset,
  productionBreakdownPromptContext,
} from "../../../clients/productionPreparationWorkflowClient";
import { ProductionBreakdownReviewActions } from "./ProductionBreakdownReviewActions";
import { breakdownStatus } from "../../../features/production/preparation/productionPreparationViewModel";
import { applyProductionSceneManualAssetBindingsToBreakdown } from "../../../clients/productionAssetWorkflowClient";
import { flushDebouncedProjectSave } from "../../../clients/stateClient";

const continuityItems = (scene: Scene) => {
  const items = [
    scene.interactiveMetadata?.incomingContext && `入场状态：${scene.interactiveMetadata.incomingContext}`,
    scene.valueShift?.from && `场内起点：${scene.valueShift.from}`,
    scene.valueShift?.to && `场内终点：${scene.valueShift.to}`,
    scene.valueShift?.reason && `变化原因：${scene.valueShift.reason}`,
    scene.interactiveMetadata?.outgoingContext && `离场状态：${scene.interactiveMetadata.outgoingContext}`,
    scene.hook && `钩子：${scene.hook}`,
    scene.cliffhanger && `悬念：${scene.cliffhanger}`,
    ...(scene.shots || []).map((shot) => shot.continuityNote && `镜头衔接：${shot.continuityNote}`),
  ].filter((item): item is string => Boolean(item));
  return [...new Set(items)];
};

const groups = (breakdown: ScriptBreakdown, scene: Scene) => [
  ["演出", breakdown.characters.map(productionBreakdownName)],
  ["场景", [productionBreakdownName(breakdown.location), breakdown.setting, breakdown.time].filter(Boolean)],
  ["道具与车辆", [
    ...breakdown.props.map((item) => `${productionBreakdownName(item)}${productionBreakdownPropRequiresAsset(item) ? " · 需要单独保持一致" : ""}`),
    ...(breakdown.vehicles || []),
  ]],
  ["造型", [...(breakdown.wardrobe || []), ...(breakdown.makeupHair || [])]],
  ["视听", [...(breakdown.vfx || []), ...(breakdown.sfx || []), ...(breakdown.bgm || []).map((item) => item.description || item.prompt)]],
  ["气氛与拍摄器材", [...(breakdown.extrasAtmosphere || []), ...(breakdown.specialEquipment || [])]],
  ["连续性", continuityItems(scene)],
];

export function ProductionSceneBreakdownWorkspace({
  project,
  episode,
  scene,
  updateProject,
  updateScene,
  onNext,
  onContinueBreakdown,
  nextBreakdownHref,
  nextBreakdownTitle,
  allBreakdownsReady,
  remainingBreakdownCount,
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  updateProject: (updates: Partial<Project>) => Promise<void>;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => Promise<void>;
  onNext: () => void;
  onContinueBreakdown: () => void;
  nextBreakdownHref?: string;
  nextBreakdownTitle?: string;
  allBreakdownsReady: boolean;
  remainingBreakdownCount: number;
}) {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [candidate, setCandidate] = useState<{ breakdown: ScriptBreakdown; metadata?: PromptEditorConfirmMetadata; prompt: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewActionBusy, setIsReviewActionBusy] = useState(false);
  const promptContext = useMemo(() => productionBreakdownPromptContext(project, episode, scene), [episode, project, scene]);
  const source = promptContext.source;
  const sourceWritingContext = promptContext.sourceWritingContext;
  const context = useMemo(() => {
    const entityScope = productionBreakdownContextEntityScope(project, scene);
    return gatherContextOptions(project, "breakdown", {
      episodeIds: [episode.id],
      characterIds: entityScope.characterIds,
      // The workflow prompt already carries the current breakdown and canonical
      // asset registry. Asset cards stay available for explicit author opt-in
      // instead of being injected a second time by default.
      assetIds: [],
      restrictEntityDefaults: true,
    });
  }, [episode.id, project, scene]);
  const breakdown = scene.breakdown;
  const currentBreakdownStatus = breakdownStatus(scene);
  const sceneActionBusy = isGenerating || isPromptOpen || Boolean(candidate) || isReviewActionBusy;

  const generate = async (finalPrompt: string, _userIntent?: string, metadata?: PromptEditorConfirmMetadata) => {
    setIsGenerating(true);
    try {
      const next = await generateProductionBreakdownCandidate(finalPrompt, breakdown);
      setCandidate({ breakdown: next, metadata, prompt: finalPrompt });
      setIsPromptOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "场次拆解失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const adopt = async () => {
    if (!candidate) return;
    try {
      const binding = bindProductionBreakdownAssetsToCanonicalRegistry(project, [{ sceneId: scene.id, breakdown: candidate.breakdown }]);
      const boundProject = { ...project, characters: binding.characters, assets: binding.assets };
      const boundBreakdown = applyProductionSceneManualAssetBindingsToBreakdown({
        project: boundProject,
        scene,
        breakdown: binding.entries[0].breakdown,
      });
      await updateProject({ characters: binding.characters, assets: binding.assets });
      await updateScene(scene.id, productionBreakdownAdoptionUpdates({ scene, breakdown: boundBreakdown, prompt: candidate.prompt, metadata: candidate.metadata }), episode.id);
      await flushDebouncedProjectSave(project.id);
      setCandidate(null);
      toast.success("场次拆解已采用，资产身份已登记");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "采用场次拆解失败");
    }
  };
  const confirmExistingBreakdown = async () => {
    if (!breakdown || scene.productionPreparation?.breakdown) return;
    const now = Date.now();
    try {
      const binding = bindProductionBreakdownAssetsToCanonicalRegistry(project, [{ sceneId: scene.id, breakdown }]);
      const boundProject = { ...project, characters: binding.characters, assets: binding.assets };
      const boundBreakdown = applyProductionSceneManualAssetBindingsToBreakdown({
        project: boundProject,
        scene,
        breakdown: binding.entries[0].breakdown,
      });
      await updateProject({ characters: binding.characters, assets: binding.assets });
      await updateScene(scene.id, {
        breakdown: boundBreakdown,
        productionPreparation: {
          ...(scene.productionPreparation || { schemaVersion: "production-preparation.v1", sceneId: scene.id }),
          breakdown: { status: "confirmed", sourceHash: manualFilmTeamScriptHash(source.text), confirmedAt: now },
          updatedAt: now,
        },
      }, episode.id);
      await flushDebouncedProjectSave(project.id);
      toast.success("已确认当前场次拆解，资产身份已登记");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认场次拆解失败");
    }
  };

  return (
    <div className="w-full px-8 py-7 bg-transparent text-text-primary animate-fade-in">
      <header className="pb-5">
        <div className="min-w-0">
          <p className="text-xs font-bold text-text-muted">{scene.sceneNumber || "场次"} · {scene.timeOfDay || ""}</p>
          <h2 className="mt-1 truncate text-xl font-black text-text-primary">{scene.title}</h2>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="当前场拆解操作">
          <button
            type="button"
            disabled={sceneActionBusy || !source.text}
            onClick={() => setIsPromptOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-600 transition-colors hover:border-cyan-500/60 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-400"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : breakdown ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            <span>{isGenerating ? "本场拆解中" : breakdown ? "重新拆解本场" : "拆解本场"}</span>
          </button>
          {breakdown && <ProductionBreakdownReviewActions project={project} episode={episode} scene={scene} updateProject={updateProject} updateScene={updateScene} externalBusy={isGenerating || isPromptOpen || Boolean(candidate)} onBusyChange={setIsReviewActionBusy} />}
        </div>
      </header>
      <details className="mt-4 rounded-xl bg-bg-surface-soft overflow-hidden">
        <summary className="cursor-pointer px-5 py-4 text-xs font-black text-text-muted select-none hover:text-gold transition-colors">参考剧本</summary>
        <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap p-5 text-xs leading-relaxed text-text-secondary custom-scrollbar bg-bg-surface border-t border-border-soft/10">{source.text || "当前场没有可用正文"}</pre>
      </details>
      {sourceWritingContext && (
        <details className="mt-4 rounded-xl bg-bg-surface-soft overflow-hidden">
          <summary className="cursor-pointer px-5 py-4 text-xs font-black text-text-muted select-none hover:text-gold transition-colors">上游剧本结构</summary>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap p-5 text-xs leading-relaxed text-text-secondary custom-scrollbar bg-bg-surface border-t border-border-soft/10">{sourceWritingContext}</pre>
        </details>
      )}
      {breakdown ? (
        <div className="grid gap-6 py-8 md:grid-cols-2">
          {groups(breakdown, scene).map(([title, items]) => {
            const hasItems = (items as string[]).filter(Boolean).length > 0;
            let tagStyle = "bg-bg-surface-soft text-text-secondary";
            if (title === "演出") {
              tagStyle = "bg-bg-surface-soft text-gold";
            } else if (title === "场景") {
              tagStyle = "bg-bg-surface-soft text-gold";
            } else if (title === "道具与车辆") {
              tagStyle = "bg-bg-surface-soft text-accent-amber";
            } else if (title === "造型") {
              tagStyle = "bg-bg-surface-soft text-accent-amber";
            } else if (title === "视听") {
              tagStyle = "bg-bg-surface-soft text-text-secondary";
            }

            return (
              <section key={String(title)} className="bg-bg-surface-soft border border-border-soft/10 rounded-2xl p-6 flex flex-col hover:border-border-soft/30 hover:bg-bg-surface-hover transition-all">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-gold">{title}</h3>
                {title === "连续性" ? (
                  <div className="space-y-2">
                    {(items as string[]).filter(Boolean).map((item) => (
                      <div key={item} className="rounded-lg bg-bg-surface-soft px-3 py-2 text-[11px] leading-relaxed text-text-secondary font-semibold">{item}</div>
                    ))}
                    {!hasItems && <span className="text-xs text-text-dark font-medium">未记录连续性信息</span>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(items as string[]).filter(Boolean).map((item) => (
                      <span key={item} className={`inline-flex items-center rounded-lg px-3 py-1 text-[11px] font-bold transition-all ${tagStyle}`}>{item}</span>
                    ))}
                    {!hasItems && <span className="text-xs text-text-dark font-medium">无</span>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center text-center">
          <ClipboardCheck className="mb-4 h-8 w-8 text-text-dark" />
          <p className="text-sm font-bold text-text-muted">可从原文提取本场人物、场景和道具，也可直接制作分镜</p>
        </div>
      )}
      <footer className="flex flex-wrap justify-end gap-2 pt-5">
        {breakdown && !scene.productionPreparation?.breakdown && <button type="button" onClick={() => void confirmExistingBreakdown()} className="h-9 rounded-lg px-4 text-xs font-bold">确认当前信息</button>}
        {nextBreakdownHref && <Link to={nextBreakdownHref} className="flex h-9 items-center rounded-lg px-4 text-xs text-text-muted">继续其他场次（{remainingBreakdownCount}）</Link>}
        <button type="button" onClick={onNext} className="btn-primary flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-bold">进入本场资产<Check className="h-4 w-4" /></button>
      </footer>
      <PromptEditorModal isOpen={isPromptOpen} onClose={() => setIsPromptOpen(false)} templateId="breakdown" title="生成本场拆解 - 提示词确认" contextOptions={context.options} defaultSelectedContextIds={[]} activeSceneId={scene.id} activeEpisodeId={episode.id} variables={promptContext.variables} onConfirm={generate} />

      <Modal
        isOpen={Boolean(candidate)}
        onClose={() => setCandidate(null)}
        title="场次拆解预览"
        size="lg"
        className="bg-bg-surface text-text-primary"
        footer={
          <>
            <button type="button" className="h-8 px-4 bg-bg-surface-soft text-text-primary rounded-xl text-xs font-bold hover:bg-bg-surface-hover mr-2 cursor-pointer active:scale-95" onClick={() => setCandidate(null)}>放弃</button>
            <button type="button" className="h-8 px-4 btn-primary rounded-xl text-xs font-bold cursor-pointer active:scale-95" onClick={() => void adopt()}>采用拆解</button>
          </>
        }
      >
        <div className="space-y-5">
          {candidate && groups(candidate.breakdown, scene).map(([title, items]) => (
            <section key={String(title)} className="bg-bg-surface rounded-2xl p-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-gold mb-3">{title}</h3>
              <p className="text-sm leading-relaxed text-text-secondary">{(items as string[]).filter(Boolean).join("、") || (title === "连续性" ? "未记录连续性信息" : "无")}</p>
            </section>
          ))}
        </div>
      </Modal>
    </div>
  );
}
