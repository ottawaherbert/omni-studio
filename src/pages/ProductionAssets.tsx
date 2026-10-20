import { ProductionCreativeControls } from "../components/production/ProductionCreativeControls";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Film,
  ImageIcon,
  Library,
  Loader2,
  MapPin,
  PackageOpen,
  Plus,
  Search,
  Shirt,
  Sparkles,
  UserRound,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useProjectStore } from "../clients/stateClient";
import AddAssetModal from "../components/AddAssetModal";
import PromptEditorModal from "../components/PromptEditorModal";
import { ProductionAssetPreparationReviewModal } from "../components/production/ProductionAssetPreparationReviewModal";
import { ProductionAssetBoardReviewModal } from "../components/production/ProductionAssetBoardReviewModal";
import { VisualStyleInheritanceBadge } from "../components/production/VisualStyleInheritanceBadge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { useProductionEpisodeAvailability } from "../features/production/preparation/useProductionEpisodeAvailability";
import { useProductionAssetPreparationAI } from "../hooks/useProductionAssetPreparationAI";
import { useProductionAssetDesignFlow } from "../hooks/useProductionAssetDesignFlow";
import { ProductionAssetDesignDialogs } from "../components/production/ProductionAssetDesignDialogs";
import { useProductionAssetBoardBatch } from "../hooks/useProductionAssetBoardBatch";
import { cn } from "../lib/utils";
import {
  buildProductionProjectAssetReadModel,
  type ProductionProjectAssetGroup,
  type ProductionProjectAssetRecord,
} from "../clients/productionAssetWorkflowClient";

type AssetFilter = "all" | ProductionProjectAssetGroup;

const filters: Array<{ id: AssetFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色" },
  { id: "location", label: "场景" },
  { id: "prop", label: "道具" },
  { id: "vehicles", label: "交通工具" },
  { id: "other", label: "其他制片资产" },
];

const assetTypeLabel = (asset: ProductionProjectAssetRecord) => {
  const labels: Record<string, string> = {
    character: "角色",
    location: "场景",
    prop: "道具",
    wardrobe: "服装",
    makeupHair: "妆发",
    vehicles: "车辆",
    extrasAtmosphere: "群演与气氛",
    specialEquipment: "特殊设备",
    vfx: "视效",
    sfx: "音效",
    bgm: "音乐",
  };
  return labels[asset.type] || "制片资产";
};

const AssetTypeIcon = ({ asset, className = "h-4 w-4" }: { asset: ProductionProjectAssetRecord; className?: string }) => {
  if (asset.group === "character") return <UserRound className={className} />;
  if (asset.group === "location") return <MapPin className={className} />;
  if (asset.group === "prop") return <PackageOpen className={className} />;
  if (asset.type === "wardrobe") return <Shirt className={className} />;
  if (asset.type === "extrasAtmosphere") return <UsersRound className={className} />;
  if (asset.type === "specialEquipment") return <Wrench className={className} />;
  return <Box className={className} />;
};

export default function ProductionAssets() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { currentProject, activeEpisode, isLoading, updateProject, updateScene } = useProjectStore();
  const { fullEpisodes, isResolving } = useProductionEpisodeAvailability(currentProject, activeEpisode);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const assetPreparation = useProductionAssetPreparationAI({
    project: currentProject,
    episodes: fullEpisodes,
    updateProject,
    updateScene,
  });
  const assetBoardBatch = useProductionAssetBoardBatch({ project: currentProject, episodes: fullEpisodes, updateProject });
  const designFlow = useProductionAssetDesignFlow({ project: currentProject, episodes: fullEpisodes, updateProject, onReady: assetBoardBatch.start });

  const readModel = useMemo(
    () => currentProject ? buildProductionProjectAssetReadModel(currentProject, fullEpisodes) : null,
    [currentProject, fullEpisodes],
  );
  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (readModel?.assets || []).filter((asset) => {
      if (filter !== "all" && asset.group !== filter) return false;
      if (missingOnly && asset.missingReferenceCount === 0) return false;
      if (!normalizedQuery) return true;
      return `${asset.name}\n${asset.description}\n${asset.variants.map((variant) => variant.name).join("\n")}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, missingOnly, query, readModel]);
  const selectedAsset = visibleAssets.find((asset) => asset.id === params.get("assetId"));
  const closeInspector = () => {
    const next = new URLSearchParams(params);
    next.delete("assetId");
    setParams(next, { replace: true });
  };
  const returnEpisodeId = params.get("episodeId");
  const returnSceneId = params.get("sceneId");

  const selectAsset = (assetId: string) => {
    const next = new URLSearchParams(params);
    next.set("assetId", assetId);
    setParams(next, { replace: true });
  };

  const revealCreatedAsset = (assetId: string) => {
    setFilter("all");
    setQuery("");
    setMissingOnly(false);
    selectAsset(assetId);
  };

  const openScene = (episodeId: string, sceneId: string) => {
    navigate(`/production/preparation?${new URLSearchParams({ projectId: currentProject!.id, episodeId, sceneId, tab: "assets" })}`);
  };

  const editAsset = (asset: ProductionProjectAssetRecord) => {
    const returnParams = new URLSearchParams(params);
    returnParams.set("assetId", asset.id);
    const returnTo = `/production/assets?${returnParams}`;
    const editPath = asset.source === "project_character"
      ? `/production/assets/character/${encodeURIComponent(asset.id)}`
      : `/production/assets/asset/${encodeURIComponent(asset.id)}`;
    const editParams = new URLSearchParams({ returnTo, projectId: currentProject!.id });
    for (const key of ["episodeId", "sceneId"]) {
      const value = params.get(key);
      if (value) editParams.set(key, value);
    }
    navigate(`${editPath}?${editParams}`);
  };

  if (isLoading || (currentProject && isResolving)) {
    return <div className="flex h-full items-center justify-center text-text-muted"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  if (!currentProject || !readModel) {
    return (
      <EmptyState
        icon={Library}
        title="选择制片项目"
        description="项目资产库属于具体导演项目，请先从项目库进入一个项目。"
        actionLabel="前往项目库"
        onAction={() => navigate("/production/library")}
      />
    );
  }

  return (
    <main className="flex flex-col bg-bg-primary text-text-primary">
      <header className="shrink-0 border-b border-transparent py-5">
        <div className="mx-auto flex w-full max-w-7xl px-8 items-center justify-between gap-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted">
              <span>导演制片</span><ChevronRight className="h-3 w-3" /><span className="text-gold">项目资产库</span>
            </div>
            <h1 className="mt-1 text-lg font-black">项目资产库</h1>
            <p className="mt-1 text-xs text-text-muted">统一管理全项目的角色、场景、道具和状态变体；场次只引用这里的正式身份。</p>
            <div className="mt-3">
              <ProductionCreativeControls project={currentProject} visualOnly />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {returnEpisodeId && returnSceneId && (
              <Button className="shrink-0 whitespace-nowrap rounded-lg" variant="outline" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => openScene(returnEpisodeId, returnSceneId)}>
                返回本场资产
              </Button>
            )}
            <Button
              className="shrink-0 whitespace-nowrap rounded-lg"
              size="sm"
              leftIcon={assetPreparation.stage === "generating" || assetPreparation.stage === "qa" || assetPreparation.stage === "adopting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              onClick={assetPreparation.openPrompt}
              disabled={assetPreparation.stage === "generating" || assetPreparation.stage === "qa" || assetPreparation.stage === "adopting"}
              title="整理资产档案与状态变体"
            >
              AI 整理资产
            </Button>
            <Button
              className="shrink-0 whitespace-nowrap rounded-lg"
              variant="outline"
              size="sm"
              leftIcon={assetBoardBatch.progress.stage === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              onClick={() => designFlow.start(assetBoardBatch.missingAssetIds)}
              disabled={designFlow.active || assetBoardBatch.progress.stage === "generating" || Boolean(assetBoardBatch.candidate) || assetBoardBatch.missingCount === 0}
            >
              {assetBoardBatch.missingCount
                ? assetBoardBatch.canResumeWithoutConfirmation
                  ? `继续生成资产板 · ${assetBoardBatch.missingCount}`
                  : `生成资产板 · ${assetBoardBatch.missingCount}`
                : readModel?.assets.length ? "已有资产板齐备" : "尚无资产，请先添加或拆解剧本"}
            </Button>
            <Button className="shrink-0 whitespace-nowrap rounded-lg" variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setIsAddOpen(true)}>新增资产</Button>
          </div>
        </div>
      </header>

      {(assetPreparation.stage === "generating" || assetPreparation.stage === "qa" || assetPreparation.stage === "adopting") && (
        <section className="border-y border-border-soft/20 bg-bg-surface-soft/45 py-3" aria-live="polite">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-8">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-4 text-[11px] font-black">
                <span>{assetPreparation.stage === "generating" ? "资产治理 Agent 正在补全项目档案并判断状态变体" : assetPreparation.stage === "qa" ? "连续性 Agent 正在质检、自动修改并复检" : "正在统一写入档案、变体和场次绑定"}</span>
                <span className="font-mono text-text-muted">{assetPreparation.progress}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-bg-primary"><div className="h-full bg-gold transition-all" style={{ width: `${assetPreparation.progress}%` }} /></div>
            </div>
          </div>
        </section>
      )}

      {assetBoardBatch.progress.stage !== "idle" && (
        <section className="border-y border-border-soft/20 bg-bg-surface-soft/45 py-3" aria-live="polite">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-8">
            {assetBoardBatch.progress.stage === "generating" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" /> : assetBoardBatch.progress.stage === "completed" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : assetBoardBatch.progress.stage === "awaiting_review" ? <ImageIcon className="h-4 w-4 shrink-0 text-gold" /> : <CircleAlert className="h-4 w-4 shrink-0 text-accent-amber" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-4 text-[11px] font-black">
                <span>{assetBoardBatch.progress.stage === "generating"
                  ? `资产板 Agent 正在生成 ${assetBoardBatch.progress.currentBoardName || "下一张资产板"}${(assetBoardBatch.progress.currentAttempt || 1) > 1 ? `（自动重试 ${assetBoardBatch.progress.currentAttempt}/${assetBoardBatch.progress.maxAttempts}）` : ""}`
                  : assetBoardBatch.progress.stage === "awaiting_review"
                    ? `${assetBoardBatch.progress.currentBoardName || "资产板"}候选等待人工采用`
                  : assetBoardBatch.progress.stage === "completed"
                    ? "项目资产板已全部人工采用"
                    : `${assetBoardBatch.progress.failedBoardNames.length} 张未完成，可点击按钮继续重试`}</span>
                <span className="font-mono text-text-muted">{assetBoardBatch.progress.completed}/{assetBoardBatch.progress.total}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-bg-primary"><div className="h-full bg-gold transition-all" style={{ width: `${assetBoardBatch.progress.total ? Math.round(assetBoardBatch.progress.completed / assetBoardBatch.progress.total * 100) : 0}%` }} /></div>
              {assetBoardBatch.progress.failureReason && <p className="mt-2 truncate text-[10px] text-accent-amber">{assetBoardBatch.progress.failureReason}</p>}
            </div>
          </div>
        </section>
      )}

      <section className="shrink-0 bg-transparent py-4">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-4 px-8">
          <Metric label="正式资产" value={readModel.totalAssetCount} />
          <Metric label="状态变体" value={readModel.totalVariantCount} />
          <Metric label="已绑定场次" value={readModel.linkedSceneCount} />
          <Metric label="待补资产板" value={readModel.missingReferenceCount} attention={readModel.missingReferenceCount > 0} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-8 py-5">
        <section className="w-full">
          <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
            <div className="flex h-9 items-center gap-1 rounded-lg bg-bg-surface-soft p-1">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "h-7 rounded-md px-3 text-[11px] font-bold transition-colors",
                    filter === item.id ? "bg-bg-surface text-gold shadow-sm" : "text-text-muted hover:text-text-primary",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-transparent bg-bg-surface-soft px-3 text-[11px] font-bold text-text-muted hover:bg-bg-surface-hover transition-colors">
                <input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} className="accent-current" />
                只看待完善
              </label>
              <label className="flex h-9 w-64 items-center gap-2 rounded-lg border border-transparent bg-bg-surface-soft px-3 focus-within:bg-bg-surface-hover transition-colors">
                <Search className="h-3.5 w-3.5 text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索资产或变体"
                  className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-dark"
                />
              </label>
            </div>
          </div>

          <div className="w-full">
            {visibleAssets.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-6">
                {visibleAssets.map((asset) => {
                  const selected = selectedAsset?.id === asset.id;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => selectAsset(asset.id)}
                      className={cn(
                        "grid min-h-36 grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-xl border border-transparent p-3 text-left transition-all duration-300",
                        selected
                          ? "bg-bg-surface shadow-sm"
                          : "bg-bg-surface-soft/60 hover:bg-bg-surface-hover",
                      )}
                    >
                      <div className="relative h-28 overflow-hidden rounded-md bg-bg-surface-soft">
                        {asset.referenceImageUrl ? (
                          <img src={asset.referenceImageUrl} alt={asset.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5 text-text-dark" /></div>
                        )}
                        <span className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded bg-black/65 text-white">
                          <AssetTypeIcon asset={asset} className="h-3 w-3" />
                        </span>
                      </div>
                      <div className="min-w-0 py-0.5">
                        <p className="truncate text-xs font-black text-text-primary">{asset.name}</p>
                        <p className="mt-1 text-[10px] font-bold text-text-muted">{assetTypeLabel(asset)}</p>
                        <div className="mt-3 flex items-center gap-3 text-[10px] text-text-muted">
                          <span>{asset.variants.length} 个变体</span>
                          <span>{asset.usageRefs.length} 个场次</span>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5">
                          {asset.missingReferenceCount ? <CircleAlert className="h-3.5 w-3.5 text-accent-amber" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                          <span className={cn("text-[9px] font-bold", asset.missingReferenceCount ? "text-accent-amber" : "text-text-muted")}>{asset.missingReferenceCount ? `缺 ${asset.missingReferenceCount} 张资产板` : "资产板完整"}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center text-center text-text-muted">
                <Library className="h-7 w-7 text-text-dark" />
                <p className="mt-3 text-sm font-black">没有符合条件的项目资产</p>
                <p className="mt-1 text-xs">调整筛选，或新增一个正式资产。</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {selectedAsset && params.get("assetId") && (
        <AssetInspectorModal
          asset={selectedAsset}
          onClose={closeInspector}
          onEdit={editAsset}
          onOpenScene={openScene}
        />
      )}

      <AddAssetModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        initialType={filter === "character" || filter === "location" || filter === "prop" ? filter : "character"}
        onSave={revealCreatedAsset}
      />
      <PromptEditorModal
              presentation="workspace"
        isOpen={Boolean(assetPreparation.promptRequest)}
        onClose={assetPreparation.closePrompt}
        templateId={assetPreparation.promptRequest?.templateId || "productionAssetPreparationBatch"}
        title={assetPreparation.promptRequest?.title}
        variables={assetPreparation.promptRequest?.variables || {}}
        contextOptions={assetPreparation.promptRequest?.contextOptions}
        defaultSelectedContextIds={assetPreparation.promptRequest?.defaultSelectedContextIds}
        workflowStepId="production.asset.preparation_batch"
        onConfirm={assetPreparation.executePrompt}
      />
      <PromptEditorModal
              presentation="workspace"
        isOpen={Boolean(assetBoardBatch.promptRequest)}
        onClose={assetBoardBatch.closePrompt}
        templateId={assetBoardBatch.promptRequest?.templateId || "generateImage"}
        title={assetBoardBatch.promptRequest?.title}
        variables={assetBoardBatch.promptRequest?.variables || {}}
        contextOptions={assetBoardBatch.promptRequest?.contextOptions}
        defaultSelectedContextIds={assetBoardBatch.promptRequest?.defaultSelectedContextIds}
        workflowStepId="production.asset.preparation_batch"
        onConfirm={assetBoardBatch.executeBatch}
      />
      <ProductionAssetPreparationReviewModal
        candidate={assetPreparation.candidate}
        isAdopting={assetPreparation.stage === "adopting"}
        onClose={assetPreparation.discardCandidate}
        onRerun={assetPreparation.rerunCandidate}
        onAdopt={() => void assetPreparation.adoptCandidate()}
      />
      <ProductionAssetDesignDialogs flow={designFlow} />
      <ProductionAssetBoardReviewModal
        candidate={assetBoardBatch.candidate}
        isAdopting={assetBoardBatch.isAdopting}
        onClose={assetBoardBatch.discardCandidate}
        onAdopt={() => void assetBoardBatch.adoptCandidate()}
      />
    </main>
  );
}

function AssetInspectorModal({
  asset,
  onClose,
  onEdit,
  onOpenScene,
}: {
  asset: ProductionProjectAssetRecord;
  onClose: () => void;
  onEdit: (asset: ProductionProjectAssetRecord) => void;
  onOpenScene: (episodeId: string, sceneId: string) => void;
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-primary border border-border-soft/20 rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-bg-surface hover:bg-bg-surface-hover border border-border-soft/20 flex items-center justify-center text-text-muted hover:text-text-primary transition-all z-10 shadow-sm active:scale-90"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 flex flex-col gap-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
          {/* Top Row: Image + Main details */}
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Left Cover */}
            <div className="w-full sm:w-[260px] shrink-0 relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-900 to-neutral-950 aspect-[16/10] sm:aspect-square flex flex-col items-center justify-center border border-neutral-800 shadow-inner group">
              <div className="absolute inset-0 bg-grid-pattern opacity-5" />
              {asset.referenceImageUrl ? (
                <img src={asset.referenceImageUrl} alt={asset.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/10 text-white/90">
                    <AssetTypeIcon asset={asset} className="h-7 w-7 text-gold" />
                  </div>
                  <span className="text-[10px] text-white/60 font-bold uppercase tracking-widest">
                    {assetTypeLabel(asset)}
                  </span>
                </div>
              )}
            </div>

            {/* Right Meta details */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-gold/10 text-gold border border-gold/20 shadow-sm">
                    <AssetTypeIcon asset={asset} className="h-3 w-3" />
                    {assetTypeLabel(asset)}
                  </span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-bg-surface-soft text-text-muted border border-border-soft/10">
                    ID: {asset.id.slice(0, 8)}
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-black text-text-primary tracking-tight leading-none">{asset.name}</h2>
                <p className={cn("mt-2 text-[10px] font-black", asset.cleanReferenceImageUrl || asset.boardImageUrl ? "text-emerald-500" : "text-accent-amber")}>{asset.cleanReferenceImageUrl ? "基础纯净参考图已就绪" : asset.boardImageUrl ? "项目资产板已就绪" : asset.sourceImageUrl ? "已有概念素材，待生成项目资产板" : "待补项目资产板"}</p>
                
                {/* Description quote box */}
                <div className="mt-4 bg-bg-surface-soft border border-border-soft/20 rounded-xl p-4 shadow-inner">
                  <p className="text-[11px] leading-relaxed text-text-secondary italic">
                    {asset.description || "暂无基础身份描述。添加描述以完善大模型上下文生成质量。"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-soft/10 pt-4">
                <div className="flex items-center gap-4 text-[11px] text-text-muted font-bold">
                  <span className="flex items-center gap-1.5"><Box className="w-3.5 h-3.5 text-text-muted/60" /> {asset.variants.length} 个状态变体</span>
                  <span className="flex items-center gap-1.5"><Film className="w-3.5 h-3.5 text-text-muted/60" /> {asset.usageRefs.length} 个场次引用</span>
                </div>
                <button 
                  onClick={() => onEdit(asset)}
                  className="px-4 py-2 rounded-xl text-xs font-black text-text-primary bg-bg-surface hover:bg-bg-surface-hover active:scale-95 transition-all shadow-sm border border-border-soft/20 flex items-center gap-1.5 shrink-0"
                >
                  编辑资产档案
                </button>
              </div>
            </div>
          </div>

          {/* Bottom sections: Variants & Usage side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-border-soft/10 pt-6">
            {/* Variants Column */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-text-muted flex items-center gap-2">
                  <span>状态变体档案 (Variants)</span>
                  <span className="px-1.5 py-0.5 rounded bg-bg-surface-soft text-[10px] font-bold text-text-primary">
                    {asset.variants.length}
                  </span>
                </h3>
              </div>
              <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                {asset.variants.map((variant) => (
                  <div key={variant.id} className="group flex items-center gap-3 rounded-xl bg-bg-surface-soft hover:bg-bg-surface p-3 transition-all duration-300 border border-border-soft/10 hover:border-border-soft/30 hover:shadow-sm">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-surface shadow-inner flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                      {variant.cleanReferenceImageUrl || variant.boardImageUrl || variant.imageUrl ? (
                        <img src={variant.cleanReferenceImageUrl || variant.boardImageUrl || variant.imageUrl} alt={variant.name} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-text-muted/65" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-black text-text-primary">{variant.name}</p>
                        {asset.defaultVariantId === variant.id && (
                          <span className="px-1.5 py-0.2 bg-gold/15 text-gold text-[8px] font-black rounded-full uppercase tracking-wider">
                            默认
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-1 text-[10px] text-text-muted">{variant.description || "尚未描述此状态下的视觉特征"}</p>
                    </div>
                  </div>
                ))}
                {!asset.variants.length && (
                  <div className="rounded-xl bg-bg-surface-soft/40 border border-dashed border-border-soft/20 py-8 text-center text-text-muted text-[10px] font-bold">
                    当前只有基础身份，没有配置状态变体。
                  </div>
                )}
              </div>
            </div>

            {/* Usage Column */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-text-muted flex items-center gap-2">
                  <span>场次使用 (Scene Usage)</span>
                  <span className="px-1.5 py-0.5 rounded bg-bg-surface-soft text-[10px] font-bold text-text-primary">
                    {asset.usageRefs.length}
                  </span>
                </h3>
              </div>
              <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                {asset.usageRefs.slice(0, 8).map((usage) => (
                  <button
                    key={`${usage.episodeId}-${usage.sceneId}`}
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenScene(usage.episodeId, usage.sceneId);
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl p-3 text-left bg-bg-surface-soft hover:bg-bg-surface transition-all duration-300 border border-border-soft/10 hover:border-border-soft/30 hover:shadow-sm"
                  >
                    <div className="w-8 h-8 rounded-lg bg-bg-surface flex items-center justify-center text-text-muted shadow-inner shrink-0 group-hover:text-gold transition-colors">
                      <Film className="h-3.5 w-3.5" />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-black text-text-primary group-hover:text-gold transition-colors">{usage.sceneTitle}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-text-muted">{usage.episodeTitle}{usage.variantId ? ` · ${asset.variants.find((variant) => variant.id === usage.variantId)?.name || "已绑定变体"}` : " · 基础身份"}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-text-muted group-hover:translate-x-0.5 transition-transform shrink-0" />
                  </button>
                ))}
                {!asset.usageRefs.length && (
                  <div className="rounded-xl bg-bg-surface-soft/40 border border-dashed border-border-soft/20 py-8 text-center text-text-muted text-[10px] font-bold">
                    该资产尚未关联到任何筹备场次。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className="px-5 first:pl-0 last:pr-0">
      <p className={cn("text-lg font-black", attention ? "text-accent-amber" : "text-text-primary")}>{value}</p>
      <p className="mt-0.5 text-[10px] font-bold text-text-muted">{label}</p>
    </div>
  );
}
