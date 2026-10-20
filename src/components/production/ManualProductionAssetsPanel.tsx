import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  Film,
  ImageIcon,
  Library,
  Link2,
  MapPin,
  PackageOpen,
  RefreshCw,
  Ship,
  ShieldAlert,
  Upload,
  Wand2,
  UserRound,
} from "lucide-react";
import type { Episode, Project, Scene } from "../../clients/domainTypes";
import {
  buildManualProductionAssetReadModel,
  confirmManualProductionAssetBoard,
  confirmManualProductionAssetBoards,
  revokeManualProductionAssetBoard,
  type ManualProductionAssetBoard,
} from "../../clients/productionAssetWorkflowClient";
import { MANUAL_FILM_TEAM_DEPARTMENTS } from "../../clients/productionPreparationWorkflowClient";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/utils";
import ImagePromptModal from "../ImagePromptModal";
import PromptEditorModal from "../PromptEditorModal";
import { useManualProductionAssetImages } from "../../hooks/useManualProductionAssetImages";
import { useManualProductionAssetVariants } from "../../hooks/useManualProductionAssetVariants";
import { ManualProductionVariantReviewModal } from "./ManualProductionVariantReviewModal";
import { ManualProductionSceneStateView } from "./ManualProductionSceneStateView";
import { ManualProductionReferenceReviewModal } from "./ManualProductionReferenceReviewModal";
import type { ManualFilmTeamReadModel } from "../../clients/productionPreparationWorkflowClient";
import {
  buildProductionProjectAssetReadModel,
  buildProductionSceneAssetBindingUpdate,
  buildProductionSceneVehicleSelectionUpdate,
  buildProductionSceneAssetVariantBindingUpdate,
} from "../../clients/productionAssetWorkflowClient";
import { Modal } from "../ui/Modal";
import { flushDebouncedProjectSave, useProjectStore } from "../../clients/stateClient";
import { legacyProjectClient } from "../../clients/legacyProjectClient";

interface ManualProductionAssetsPanelProps {
  project: Project;
  episode: Episode;
  episodes?: Episode[];
  scene: Scene;
  updateProject: (updates: Partial<Project>) => Promise<void>;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string, options?: { expectedProjectId: string; expectedEpisodeId: string }) => Promise<void>;
  filmTeam?: ManualFilmTeamReadModel;
  onConfirmAssetPack?: (assetPackHash?: string) => Promise<void>;
  assetPackConfirmed?: boolean;
  assetPackConfirmBlockedReason?: string;
  sceneBindingOnly?: boolean;
  onOpenProjectAsset?: (assetId?: string) => void;
  embedded?: boolean;
}

type AssetTab = "character" | "location" | "prop" | "vehicles" | "state";

const tabs: Array<{ id: AssetTab; label: string; icon: typeof UserRound }> = [
  { id: "character", label: "角色身份板", icon: UserRound },
  { id: "location", label: "场景板", icon: MapPin },
  { id: "prop", label: "道具板", icon: PackageOpen },
  { id: "vehicles", label: "交通工具板", icon: Ship },
  { id: "state", label: "服化道与引用", icon: Film },
];

const approvalLabel = (state: ManualProductionAssetBoard["approvalState"]) => {
  if (state === "confirmed") return "已核对";
  if (state === "stale") return "来源有更新";
  if (state === "blocked_by_team") return "有筹备意见";
  return "未标记核对";
};

const approvalTone = (state: ManualProductionAssetBoard["approvalState"]) => {
  if (state === "confirmed") return "success";
  if (state === "blocked_by_team") return "danger";
  return "warning";
};

export function ManualProductionAssetsPanel({
  project,
  episode,
  episodes,
  scene,
  updateProject,
  updateScene,
  filmTeam,
  onConfirmAssetPack,
  assetPackConfirmed = false,
  assetPackConfirmBlockedReason,
  sceneBindingOnly = false,
  onOpenProjectAsset,
  embedded = false,
}: ManualProductionAssetsPanelProps) {
  const [activeTab, setActiveTab] = useState<AssetTab>("character");
  const [savingBoardId, setSavingBoardId] = useState<string | null>(null);
  const [savingBindingId, setSavingBindingId] = useState<string | null>(null);
  const [bindingBoard, setBindingBoard] = useState<ManualProductionAssetBoard | null>(null);
  const [isConfirmingAssetPack, setIsConfirmingAssetPack] = useState(false);
  const readModel = useMemo(
    () => buildManualProductionAssetReadModel({ project, episode, scene, episodes, filmTeam }),
    [episode, episodes, filmTeam, project, scene],
  );
  const hasAssetRequirements = readModel.assetBoards.length > 0;
  const noAssetRequirementMessage = readModel.issues.find((issue) => issue.severity === "blocking")?.message
    || "本场无需额外角色、场景、道具或交通工具资产";
  const visibleBoards = useMemo(
    () => readModel.assetBoards.filter((item) => item.assetType === activeTab),
    [activeTab, readModel.assetBoards],
  );
  const visibleBindings = useMemo(() => {
    const byAsset = new Map<string, ManualProductionAssetBoard>();
    for (const board of visibleBoards) {
      const current = byAsset.get(board.assetId);
      if (!current || board.variantId) byAsset.set(board.assetId, board);
    }
    return Array.from(byAsset.values());
  }, [visibleBoards]);
  const assetImages = useManualProductionAssetImages({ project, episode, scene, updateProject });
  const assetVariants = useManualProductionAssetVariants({ project, episode, scene, updateProject, updateScene });
  const projectAssets = useMemo(
    () => buildProductionProjectAssetReadModel(project, episodes || [episode]).assets,
    [episode, episodes, project],
  );
  const bindingCandidates = useMemo(() => bindingBoard
    ? projectAssets
        .filter((asset) => asset.group === bindingBoard.assetType)
        .sort((left, right) => Number(Boolean(right.referenceImageUrl)) - Number(Boolean(left.referenceImageUrl)) || left.name.localeCompare(right.name, "zh-CN"))
    : [], [bindingBoard, projectAssets]);
  const vehicleCandidates = useMemo(() => projectAssets.filter((asset) => asset.type === "vehicles"), [projectAssets]);

  const loadVehicleBindingScene = async () => {
    await flushDebouncedProjectSave(project.id);
    const fullEpisode = await legacyProjectClient.getEpisode(project.id, episode.id);
    const current = useProjectStore.getState();
    if (current.currentProject?.id !== project.id || current.activeEpisode?.id !== episode.id) {
      throw new Error("工作区已切换，请在当前项目重新选择交通工具。");
    }
    const fullScene = fullEpisode?.scenes.find((item) => item.id === scene.id);
    if (!fullScene) throw new Error("无法读取完整场次，未更改交通工具绑定。");
    return fullScene;
  };

  const selectVehicle = async (vehicleId: string, selected: boolean) => {
    setSavingBindingId(vehicleId);
    try {
      const fullScene = await loadVehicleBindingScene();
      const updates = buildProductionSceneVehicleSelectionUpdate({ project, scene: fullScene, vehicleId, selected });
      await updateScene(scene.id, updates, episode.id, { expectedProjectId: project.id, expectedEpisodeId: episode.id });
      await flushDebouncedProjectSave(project.id);
      toast.success(selected ? "已绑定本场交通工具" : "已移除本场交通工具");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "交通工具绑定失败");
    } finally {
      setSavingBindingId(null);
    }
  };

  const persistBoard = async (board: ManualProductionAssetBoard, confirm: boolean) => {
    setSavingBoardId(board.boardItemId);
    try {
      const registry = confirm
        ? confirmManualProductionAssetBoard({ project, episode, scene, boardItemId: board.boardItemId })
        : revokeManualProductionAssetBoard(project.manualProductionAssets, board.boardItemId);
      await updateProject({ manualProductionAssets: registry });
      await flushDebouncedProjectSave(project.id);
      toast.success(confirm ? "资产身份已确认" : "资产确认已撤销");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产状态保存失败");
    } finally {
      setSavingBoardId(null);
    }
  };

  const bindingBoardsFor = (assetId: string) => readModel.assetBoards.filter((board) => board.assetId === assetId);
  const bindingApprovalState = (assetId: string): ManualProductionAssetBoard["approvalState"] => {
    const boards = bindingBoardsFor(assetId);
    if (boards.some((board) => board.approvalState === "blocked_by_team")) return "blocked_by_team";
    if (boards.length && boards.every((board) => board.approvalState === "confirmed")) return "confirmed";
    if (boards.some((board) => board.approvalState === "stale")) return "stale";
    return "needs_confirmation";
  };
  const variantsFor = (board: ManualProductionAssetBoard) => board.assetType === "character"
    ? project.characters.find((item) => item.id === board.assetId)?.variants || []
    : project.assets.find((item) => item.id === board.assetId)?.variants || [];

  const persistBinding = async (assetId: string, confirm: boolean) => {
    const boardItemIds = bindingBoardsFor(assetId).map((board) => board.boardItemId);
    setSavingBindingId(assetId);
    try {
      const registry = confirm
        ? confirmManualProductionAssetBoards({ project, episode, scene, boardItemIds })
        : boardItemIds.reduce(
            (current, boardItemId) => revokeManualProductionAssetBoard(current, boardItemId),
            project.manualProductionAssets,
          );
      await updateProject({ manualProductionAssets: registry });
      await flushDebouncedProjectSave(project.id);
      toast.success(confirm ? "本场资产绑定已确认" : "本场资产绑定确认已撤销");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产绑定保存失败");
    } finally {
      setSavingBindingId(null);
    }
  };

  const bindVariant = async (assetId: string, variantId?: string) => {
    setSavingBindingId(assetId);
    try {
      const updates = buildProductionSceneAssetVariantBindingUpdate({ project, scene, assetId, variantId });
      await updateScene(scene.id, updates, episode.id);
      toast.success(variantId ? "已绑定项目资产变体" : "已改用基础身份");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "状态变体绑定失败");
    } finally {
      setSavingBindingId(null);
    }
  };

  const bindProjectAsset = async (targetAssetId: string) => {
    if (!bindingBoard || targetAssetId === bindingBoard.assetId) return;
    setSavingBindingId(bindingBoard.assetId);
    try {
      const updates = buildProductionSceneAssetBindingUpdate({
        project,
        scene: bindingBoard.assetType === "vehicles" ? await loadVehicleBindingScene() : scene,
        sourceAssetId: bindingBoard.assetId,
        targetAssetId,
        assetType: bindingBoard.assetType,
      });
      await updateScene(scene.id, updates, episode.id, { expectedProjectId: project.id, expectedEpisodeId: episode.id });
      await flushDebouncedProjectSave(project.id);
      setBindingBoard(null);
      toast.success("已手动绑定项目资产，后续重新拆解仍会优先保留");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "项目资产绑定失败");
    } finally {
      setSavingBindingId(null);
    }
  };

  const confirmAssetPack = async () => {
    if (!onConfirmAssetPack || assetPackConfirmed) return;
    setIsConfirmingAssetPack(true);
    try {
      const pendingBoardItemIds = readModel.assetBoards
        .filter((board) => board.approvalState !== "confirmed")
        .map((board) => board.boardItemId);
      const registry = pendingBoardItemIds.length
        ? confirmManualProductionAssetBoards({ project, episode, scene, boardItemIds: pendingBoardItemIds })
        : project.manualProductionAssets;
      const nextProject = registry ? { ...project, manualProductionAssets: registry } : project;
      const nextReadModel = buildManualProductionAssetReadModel({ project: nextProject, episode, scene, episodes, filmTeam });
      if (registry && registry !== project.manualProductionAssets) await updateProject({ manualProductionAssets: registry });
      await onConfirmAssetPack(nextReadModel.assetPackHash);
      await flushDebouncedProjectSave(project.id);
      toast.success(hasAssetRequirements ? "本场资产包已确认" : "已确认本场无需额外资产");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产包确认失败");
    } finally {
      setIsConfirmingAssetPack(false);
    }
  };

  return (
    <>
    <section className={cn("overflow-hidden rounded-lg bg-bg-surface animate-fade-in", embedded ? "" : "mb-6")}>
      <div className="px-3 py-4 sm:px-6 bg-bg-surface">
        <div className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-text-primary">{sceneBindingOnly ? "本场资产" : "资产确认"}</h2>
              <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-black",
                readModel.readiness === "ready" ? "bg-bg-surface-soft text-gold" : readModel.readiness === "blocked" ? "bg-bg-surface-soft text-accent-red" : "bg-bg-surface-soft text-accent-amber"
              )}>
                {!hasAssetRequirements && readModel.readiness === "blocked" ? "缺少正式资产" : !hasAssetRequirements ? "无需额外资产" : readModel.readiness === "ready" ? "可用于生成" : readModel.readiness === "blocked" ? "存在阻断" : "待完善"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {sceneBindingOnly ? `${scene.title} / 从项目资产库选择本场实际使用的基础身份与状态变体` : scene.title}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 lg:w-auto lg:shrink-0">
            {sceneBindingOnly && onOpenProjectAsset && (
              <button
                type="button"
                onClick={() => onOpenProjectAsset()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-soft/35 px-3 text-xs font-bold text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary"
              >
                <Library className="h-3.5 w-3.5" />项目资产库
              </button>
            )}
            {onConfirmAssetPack && (
              <div className="max-w-full text-right">
                <button
                  type="button"
                  disabled={assetPackConfirmed || isConfirmingAssetPack}
                  title="采用当前资产选择"
                  onClick={() => void confirmAssetPack()}
                  className={cn(
                    "inline-flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45 transition-all cursor-pointer active:scale-95",
                    assetPackConfirmed
                      ? "bg-bg-surface-soft text-gold"
                      : "btn-primary",
                  )}
                >
                  {isConfirmingAssetPack ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {assetPackConfirmed ? "资产包已确认" : "确认本场资产包"}
                </button>
              </div>
            )}
          </div>
        </div>

        {hasAssetRequirements ? (
          <div className="mt-4 grid grid-cols-3 divide-x divide-border-soft/25 rounded-md bg-bg-primary/70 py-2.5 text-center">
            <Metric value={`${readModel.confirmedBoardCount}/${readModel.assetBoards.length}`} label="参考已核对" />
            <Metric value={readModel.sceneStates.length} label="场次状态" />
            <Metric value={readModel.missingReferenceCount} label="缺参考图" tone="text-accent-amber" />
          </div>
        ) : (
          <p className={cn("mt-4 rounded-md bg-bg-primary/70 px-3 py-2.5 text-xs font-bold", readModel.readiness === "blocked" ? "text-accent-red" : "text-text-muted")}>
            {noAssetRequirementMessage}
          </p>
        )}
        {!assetPackConfirmed && assetPackConfirmBlockedReason && assetPackConfirmBlockedReason !== noAssetRequirementMessage && (
          <p className="mt-2 text-right text-[10px] leading-4 text-accent-amber">{assetPackConfirmBlockedReason}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-6 py-2.5 bg-bg-surface border-t border-b border-border-soft/20">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isTabActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-bold transition-all cursor-pointer",
                isTabActive
                  ? "bg-bg-surface-soft text-gold font-bold"
                  : "bg-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <Icon className="h-4 w-4" />
              {sceneBindingOnly
                ? tab.id === "character" ? "角色" : tab.id === "location" ? "场景" : tab.id === "prop" ? "道具" : tab.id === "vehicles" ? "交通工具" : "本场状态"
                : tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "state" ? (
        <ManualProductionSceneStateView
          readModel={readModel}
          onCreateVariant={sceneBindingOnly ? undefined : assetVariants.prepareVariant}
          onOpenAsset={sceneBindingOnly ? onOpenProjectAsset : undefined}
          showReferencePack={!sceneBindingOnly}
        />
      ) : sceneBindingOnly ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3 bg-bg-primary p-3 sm:p-5">
          {activeTab === "vehicles" && vehicleCandidates.map((asset) => {
            const selected = Boolean(scene.breakdown?.vehicleIds?.includes(asset.id));
            return <button key={`select-${asset.id}`} type="button" disabled={savingBindingId === asset.id}
              onClick={() => void selectVehicle(asset.id, !selected)}
              className={cn("flex items-center gap-3 rounded-lg border p-3 text-left", selected ? "border-gold/45 bg-bg-surface-soft" : "border-border-soft/25 bg-bg-surface hover:border-gold/45")}>
              {asset.referenceImageUrl ? <img src={asset.referenceImageUrl} alt={asset.name} className="h-16 w-20 rounded object-contain" /> : <ImageIcon className="h-6 w-20 text-text-muted" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-text-primary">{asset.name}</span><span className="text-[10px] text-text-muted">{selected ? "已用于本场，点击移除" : "点击用于本场"}</span></span>
              {selected && <CheckCircle2 className="h-4 w-4 text-gold" />}
            </button>;
          })}
          {visibleBindings.map((board) => {
            const variants = variantsFor(board);
            const approvalState = bindingApprovalState(board.assetId);
            const selectedVariantId = scene.breakdown?.assetVariantMap?.[board.assetId] || "";
            return (
              <article key={board.assetId} className="grid grid-cols-1 sm:grid-cols-[104px_minmax(0,1fr)] gap-4 rounded-lg border border-border-soft/25 bg-bg-surface p-4">
                <div className="relative flex min-h-36 items-center justify-center overflow-hidden rounded-md bg-bg-surface-soft">
                  {board.referenceImageUrl ? (
                    <img src={board.referenceImageUrl} alt={board.assetName} className="h-full w-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-text-dark" />
                  )}
                  <span className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-0.5 text-[9px] font-bold text-white">
                    {selectedVariantId ? "状态变体" : "基础身份"}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-text-muted"><Link2 className="h-3 w-3" />项目资产</p>
                      <h3 className="mt-1 truncate text-sm font-black text-text-primary">{board.assetName}</h3>
                    </div>
                    <span className={cn(
                      "shrink-0 rounded px-2 py-1 text-[9px] font-black",
                      approvalState === "confirmed" ? "bg-bg-surface-soft text-gold" : approvalState === "blocked_by_team" ? "bg-bg-surface-soft text-accent-red" : "bg-bg-surface-soft text-accent-amber",
                    )}>
                      {approvalLabel(approvalState)}
                    </span>
                  </div>

                  <label className="mt-3 block text-[9px] font-bold text-text-muted">
                    本场使用状态
                    <select
                      value={selectedVariantId}
                      disabled={savingBindingId === board.assetId}
                      onChange={(event) => void bindVariant(board.assetId, event.target.value || undefined)}
                      className="mt-1.5 h-8 w-full rounded-md border border-border-soft/35 bg-bg-primary px-2.5 text-[10px] font-bold text-text-primary outline-none focus:border-gold/50 disabled:opacity-45"
                    >
                      <option value="">基础身份</option>
                      {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
                    </select>
                  </label>

                  <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-text-muted">
                    {variants.find((variant) => variant.id === selectedVariantId)?.description || (board.assetType === "character" ? project.characters.find((item) => item.id === board.assetId)?.visualIdentity : project.assets.find((item) => item.id === board.assetId)?.description)}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={savingBindingId === board.assetId}
                      onClick={() => setBindingBoard(board)}
                      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 border border-border-soft/35 text-[10px] font-bold text-gold hover:bg-bg-surface-soft disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Link2 className="h-3.5 w-3.5" />绑定资产
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenProjectAsset?.(board.assetId)}
                      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 border border-border-soft/35 text-[10px] font-bold text-text-secondary hover:bg-bg-surface-soft"
                    >
                      <Library className="h-3.5 w-3.5" />查看资产
                    </button>
                    <button
                      type="button"
                      disabled={savingBindingId === board.assetId}
                      onClick={() => void persistBinding(board.assetId, approvalState !== "confirmed")}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40",
                        approvalState === "confirmed" ? "bg-bg-surface-soft text-text-muted" : "btn-primary",
                      )}
                    >
                      {savingBindingId === board.assetId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {approvalState === "confirmed" ? "取消标记" : "标记已核对"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {!visibleBindings.length && activeTab !== "vehicles" && <p className="py-10 text-center text-xs text-text-muted lg:col-span-2">当前场没有此类正式资产绑定。</p>}
        </div>
      ) : (
        <div className="grid gap-6 p-6 md:grid-cols-2 bg-bg-primary">
          {visibleBoards.map((board) => (
            <article key={board.boardItemId} className="bg-bg-surface border border-border-soft/25 rounded-2xl hover:bg-bg-surface-hover transition-all p-5 grid grid-cols-[120px_1fr] gap-5">
              <div className="relative flex min-h-[144px] items-center justify-center bg-bg-surface-soft/80 rounded-xl overflow-hidden">
                {board.referenceImageUrl ? (
                  <img src={board.referenceImageUrl} alt={board.assetName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <ImageIcon className="h-7 w-7 text-text-dark" />
                )}
                <span className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-md">
                  {board.variantId ? "状态变体" : "基础身份"}
                </span>
              </div>
              <div className="min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-text-primary">{board.assetName}</h3>
                      <p className="mt-1 truncate text-[10px] text-text-muted font-bold">{board.variantName || board.boardKind}</p>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black shrink-0",
                      board.approvalState === "confirmed" ? "bg-bg-surface-soft text-gold" : board.approvalState === "blocked_by_team" ? "bg-bg-surface-soft text-accent-red" : "bg-bg-surface-soft text-accent-amber"
                    )}>
                      {approvalLabel(board.approvalState)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {board.requiredDepartments.map((dep) => (
                      <span key={dep} className="rounded-full bg-bg-surface-soft text-text-secondary px-2.5 py-0.5 text-[9px] font-bold">
                        {MANUAL_FILM_TEAM_DEPARTMENTS.find((item) => item.id === dep)?.name || dep}
                      </span>
                    ))}
                  </div>

                  <p className="mt-3 line-clamp-2 text-[10px] text-text-muted font-medium">
                    {board.departmentBlockers[0] || `${board.usageRefs[0]?.title || scene.title} / ${board.usageRefs[0]?.shotIds.length || 0} 镜头`}
                  </p>
                  <p className="mt-1 text-[9px] font-bold text-text-dark">
                    来源：{board.referenceSource === "variant" ? "状态变体参考" : board.referenceSource === "canonical" ? "基础资产参考" : "尚无参考图"} / 使用：{board.usageRefs[0]?.title || scene.title}
                  </p>

                  <details className="mt-3 text-[10px] text-text-muted">
                    <summary className="cursor-pointer font-bold text-gold select-none">资产板提示词</summary>
                    <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-bg-surface-soft p-3 leading-relaxed custom-scrollbar text-text-secondary">{board.prompt}</p>
                  </details>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(assetImages.generatingBoardId)}
                    onClick={() => assetImages.openPrompt(board)}
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-xl bg-bg-surface-soft text-[10px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-40 hover:bg-bg-surface-hover transition-all cursor-pointer"
                  >
                    {assetImages.generatingBoardId === board.boardItemId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    <span>{board.referenceImageUrl ? "重新生成" : "AI 生成"}</span>
                  </button>
                  <label
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-bg-surface-soft text-[10px] font-bold text-text-secondary transition-all hover:bg-bg-surface-hover hover:text-text-primary",
                      Boolean(assetImages.generatingBoardId) && "pointer-events-none opacity-40",
                    )}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void assetImages.importReferenceImage(board, file);
                        event.currentTarget.value = "";
                      }}
                    />
                    <Upload className="h-3.5 w-3.5" />
                    <span>上传图片</span>
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(savingBoardId)}
                    onClick={() => persistBoard(board, board.approvalState !== "confirmed")}
                    className={cn(
                      "inline-flex h-8 items-center justify-center gap-2 rounded-xl text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40 transition-all cursor-pointer",
                      board.approvalState === "confirmed"
                        ? "bg-bg-surface-soft text-text-muted hover:bg-bg-surface-hover"
                        : "btn-primary active:scale-95",
                    )}
                  >
                    {savingBoardId === board.boardItemId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : board.approvalState === "confirmed" ? <ShieldAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span>{board.approvalState === "confirmed" ? "撤销确认" : "确认身份"}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
          {!visibleBoards.length && <p className="py-8 text-center text-xs text-gray-400 md:col-span-2">当前场景没有此类正式资产。</p>}
        </div>
      )}
    </section>
    <Modal
      isOpen={Boolean(bindingBoard)}
      onClose={() => setBindingBoard(null)}
      title={`绑定${bindingBoard?.assetType === "character" ? "角色" : bindingBoard?.assetType === "location" ? "场景" : bindingBoard?.assetType === "vehicles" ? "交通工具" : "道具"}资产`}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-xs leading-5 text-text-muted">
          当前条目“{bindingBoard?.assetName || ""}”将改为使用你选择的项目资产。这里只修改本场引用，不会删除或改写项目资产库中的其他资产。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {bindingCandidates.map((asset) => {
            const isCurrent = asset.id === bindingBoard?.assetId;
            return (
              <button
                key={asset.id}
                type="button"
                disabled={isCurrent || savingBindingId === bindingBoard?.assetId}
                onClick={() => void bindProjectAsset(asset.id)}
                className={cn(
                  "grid min-h-24 grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-default",
                  isCurrent
                    ? "border-gold/40 bg-bg-surface-soft"
                    : "border-border-soft/35 bg-bg-surface hover:border-gold/45 hover:bg-bg-surface-soft",
                )}
              >
                <span className="flex h-[72px] items-center justify-center overflow-hidden rounded-md bg-bg-primary">
                  {asset.referenceImageUrl
                    ? <img src={asset.referenceImageUrl} alt={asset.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    : <ImageIcon className="h-5 w-5 text-text-dark" />}
                </span>
                <span className="min-w-0 py-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-black text-text-primary">{asset.name}</span>
                    {isCurrent && <span className="shrink-0 rounded bg-bg-primary px-1.5 py-0.5 text-[9px] font-bold text-gold">当前绑定</span>}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-text-muted">{asset.description || "暂无资产说明"}</span>
                  <span className={cn("mt-2 block text-[9px] font-bold", asset.referenceImageUrl ? "text-gold" : "text-accent-amber")}>
                    {asset.referenceImageUrl ? "已有参考图" : "缺少参考图"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!bindingCandidates.length && (
          <p className="rounded-md bg-bg-surface-soft px-4 py-8 text-center text-xs text-text-muted">项目资产库中还没有同类型资产。</p>
        )}
      </div>
    </Modal>
    <ImagePromptModal
      isOpen={Boolean(assetImages.promptBoard)}
      onClose={assetImages.closePrompt}
      initialPrompt={assetImages.promptBoard?.prompt || ""}
      initialReferenceImage={assetImages.promptBoard?.referenceImageUrl}
      title={`${assetImages.promptBoard?.assetName || "资产"}参考图`}
      confirmText={assetImages.promptBoard?.referenceImageUrl ? "重新生成参考图" : "生成参考图"}
      onConfirm={assetImages.generateReferenceImage}
    />
    <PromptEditorModal
              presentation="workspace"
      isOpen={Boolean(assetVariants.promptRequest)}
      onClose={() => assetVariants.setPromptRequest(null)}
      templateId={assetVariants.promptRequest?.templateId || "productionAssetVariant"}
      title={assetVariants.promptRequest?.title}
      variables={assetVariants.promptRequest?.variables || {}}
      contextOptions={assetVariants.promptRequest?.contextOptions}
      defaultSelectedContextIds={assetVariants.promptRequest?.defaultSelectedContextIds}
      activeSceneId={scene.id}
      activeEpisodeId={episode.id}
      onConfirm={assetVariants.executePrompt}
    />
    <ManualProductionVariantReviewModal
      candidate={assetVariants.candidate}
      onClose={() => assetVariants.setCandidate(null)}
      onAdopt={assetVariants.adoptCandidate}
    />
    <ManualProductionReferenceReviewModal
      candidate={assetImages.candidate}
      isAdopting={assetImages.isAdoptingCandidate}
      onClose={assetImages.discardCandidate}
      onAdopt={() => void assetImages.adoptCandidate()}
    />
    </>
  );
}

function Metric({ value, label, tone = "text-text-primary" }: { value: string | number; label: string; tone?: string }) {
  return <div><p className={cn("text-lg font-black", tone)}>{value}</p><p className="text-[10px] text-text-muted">{label}</p></div>;
}
