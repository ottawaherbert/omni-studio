import { appearanceVariantDisplayName } from "../clients/productionStoryboardWorkflowClient";
import { ProductionCreativeControls } from "../components/production/ProductionCreativeControls";
import { formatAIExecutionProvenance } from "../utils/aiExecutionProvenance";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Box,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  Film,
  FileText,
  ImageIcon,
  Layers3,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";

import type { Asset, AssetVariant, Character, Project } from "../clients/domainTypes";
import { useProjectStore } from "../clients/stateClient";
import ImagePromptModal from "../components/ImagePromptModal";
import { CharacterVoiceSettings } from '../components/production/CharacterVoiceSettings';
import PromptEditorModal from "../components/PromptEditorModal";
import { ProductionAssetBoardReviewModal } from "../components/production/ProductionAssetBoardReviewModal";
import { ProductionAssetProfileReviewModal } from "../components/production/ProductionAssetProfileReviewModal";
import { Button } from "../components/ui/Button";
import { DebouncedInput, DebouncedTextarea } from "../components/ui/DebouncedInputs";
import { Modal } from "../components/ui/Modal";
import { useProductionEpisodeAvailability } from "../features/production/preparation/useProductionEpisodeAvailability";
import { useProductionAssetBoardImage } from "../hooks/useProductionAssetBoardImage";
import { useProductionAssetDesignFlow } from "../hooks/useProductionAssetDesignFlow";
import { ProductionAssetDesignDialogs } from "../components/production/ProductionAssetDesignDialogs";
import { assetVisualDescription, assetNeedsVisualDesign } from "../clients/productionAssetWorkflowClient";
import { useProductionAssetProfileAI } from "../hooks/useProductionAssetProfileAI";
import { cn } from "../lib/utils";
import {
  buildProductionAssetBoardPromptUpdate,
  buildProductionAssetBoardReferenceUpdate,
  resolveProductionAssetBoardGenerationReference,
} from "../clients/productionAssetWorkflowClient";
import { buildProductionAssetBoardPromptPreview, productionAssetBoardPromptCore, withProductionAssetBoardStyle } from "../clients/productionAssetWorkflowClient";
import {
  referenceImageUrlForMode,
  resolveProductionAssetReferenceModeSpec,
  type ProductionAssetReferenceMode,
} from "../clients/productionAssetWorkflowClient";
import { buildProductionProjectAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  buildVideoStoryboardAssetBoardPlan,
  type VideoStoryboardAssetBoardItem,
} from "../clients/productionAssetWorkflowClient";

type ProfileTab = "board" | "profile" | "usage";

const MBTI_OPTIONS = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];
const boardTypeMeta = (board?: VideoStoryboardAssetBoardItem) => {
  if (board?.boardKind === "character_board") return { label: "角色板", icon: UserRound };
  if (board?.boardKind === "scene_board") return { label: "场景板", icon: MapPin };
  if (board?.boardKind === "prop_board") return { label: "道具板", icon: Box };
  if (board?.boardKind === "vehicle_board") return { label: "交通工具板", icon: Box };
  if (board?.boardKind === "variant_board") return { label: "状态变体板", icon: Layers3 };
  return { label: "制作档案", icon: Box };
};

const boardReadiness = (
  board: VideoStoryboardAssetBoardItem | undefined,
  referenceMode: ProductionAssetReferenceMode,
) => {
  if (!board) return { label: "无资产板", tone: "text-text-muted bg-bg-surface-soft" };
  if (referenceImageUrlForMode(board, referenceMode)) return { label: referenceMode === "clean_reference" ? "纯净参考已就绪" : "资料板已就绪", tone: "text-emerald-700 bg-emerald-500/10" };
  if (board.readiness === "prompt_ready" || referenceMode === "clean_reference") return { label: referenceMode === "clean_reference" ? "待生成纯净参考" : "待生成资料板", tone: "text-accent-amber bg-amber-500/10" };
  return { label: "待完善提示词", tone: "text-accent-red bg-red-500/10" };
};

export default function ProductionAssetProfile() {
  const { characterId, assetId } = useParams<{ characterId?: string; assetId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const backUrl = searchParams.get("returnTo") || "/production/assets";
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { currentProject, activeEpisode, updateProject, removeAssetReferences, removeVariantReferences } = useProjectStore();
  const { fullEpisodes } = useProductionEpisodeAvailability(currentProject, activeEpisode);
  const [activeTab, setActiveTab] = useState<ProfileTab>("board");
  const [referenceMode, setReferenceMode] = useState<ProductionAssetReferenceMode>(
    searchParams.get("referenceMode") === "production_board" ? "production_board" : "clean_reference",
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(searchParams.get("variantId"));
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [isAdoptingExistingBoard, setIsAdoptingExistingBoard] = useState(false);
  const [variantDraft, setVariantDraft] = useState({ name: "", description: "", promptModifiers: "", referenceVariantId: "" });

  const isCharacter = Boolean(characterId);
  const ownerId = characterId || assetId || "";
  const character = isCharacter ? currentProject?.characters.find((item) => item.id === ownerId) : undefined;
  const asset = !isCharacter ? currentProject?.assets.find((item) => item.id === ownerId) : undefined;
  const owner = character || asset;
  useEffect(() => {
    setReferenceMode(searchParams.get("referenceMode") === "production_board" ? "production_board" : "clean_reference");
  }, [searchParams]);
  useEffect(() => { setSelectedVariantId(searchParams.get("variantId")); }, [ownerId, searchParams.get("variantId")]);
  const chooseReferenceMode = (mode: ProductionAssetReferenceMode) => {
    setReferenceMode(mode);
    const next = new URLSearchParams(searchParams);
    next.set("referenceMode", mode);
    setSearchParams(next, { replace: true });
  };
  const variants = owner?.variants || [];
  useEffect(() => {
    if (!owner || !selectedVariantId || owner.variants?.some(v => v.id === selectedVariantId)) return;
    setSelectedVariantId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('variantId');
    setSearchParams(next, { replace: true });
  }, [owner, selectedVariantId, searchParams, setSearchParams]);
  const boardPlan = useMemo(
    () => currentProject ? buildVideoStoryboardAssetBoardPlan(currentProject) : undefined,
    [currentProject],
  );
  const baseBoard = useMemo(() => {
    if (!boardPlan) return undefined;
    return [...boardPlan.characterBoards, ...boardPlan.sceneBoards, ...boardPlan.propBoards, ...boardPlan.vehicleBoards]
      .find((item) => item.assetId === ownerId);
  }, [boardPlan, ownerId]);
  const selectedBoard = useMemo(() => selectedVariantId
    ? boardPlan?.variantBoards.find((item) => item.assetId === ownerId && item.variantId === selectedVariantId)
    : baseBoard, [baseBoard, boardPlan, ownerId, selectedVariantId]);
  const selectedVariant = selectedVariantId ? variants.find((item) => item.id === selectedVariantId) : undefined;
  const readModel = useMemo(
    () => currentProject ? buildProductionProjectAssetReadModel(currentProject, fullEpisodes) : undefined,
    [currentProject, fullEpisodes],
  );
  const assetRecord = readModel?.assets.find((item) => item.id === ownerId);
  const boardMeta = boardTypeMeta(selectedBoard);
  const referenceModeSpec = selectedBoard ? resolveProductionAssetReferenceModeSpec(selectedBoard, referenceMode) : undefined;
  const BoardIcon = boardMeta.icon;
  const readiness = currentProject && assetNeedsVisualDesign(currentProject, ownerId)
    ? { label: '待设计形象', tone: 'text-accent-amber bg-amber-500/10' } : boardReadiness(selectedBoard, referenceMode);
  const boardImageUrl = referenceImageUrlForMode(selectedBoard, referenceMode);
  const sourceImageUrl = character
    ? character.referenceImageUrl || character.defaultReferenceUrl
    : asset?.imageUrl || asset?.defaultReferenceUrl;
  const generationReference = useMemo(
    () => currentProject && selectedBoard
      ? resolveProductionAssetBoardGenerationReference(currentProject, selectedBoard)
      : undefined,
    [currentProject, selectedBoard],
  );
  const generationReferenceUrl = boardImageUrl
    || generationReference?.imageUrl
    || (!selectedVariant ? sourceImageUrl : undefined);
  const generationPrompt = useMemo(() => {
    if (!currentProject || !selectedBoard) return "";
    return buildProductionAssetBoardPromptPreview(currentProject, selectedBoard, referenceMode);
  }, [currentProject, referenceMode, selectedBoard]);
  const auditEntries = (currentProject?.manualProductionAssets?.references || [])
    .filter((item) => item.assetId === ownerId && item.variantId === selectedVariantId);
  const profileRevisionEntries = (currentProject?.manualProductionAssets?.profileRevisions || [])
    .filter((item) => item.assetId === ownerId);
  const approvalCount = (currentProject?.manualProductionAssets?.approvals || [])
    .filter((item) => item.assetId === ownerId).length;

  const assetBoardImage = useProductionAssetBoardImage({
    project: currentProject,
    board: selectedBoard,
    referenceMode,
    updateProject,
  });
  const profileAI = useProductionAssetProfileAI({
    project: currentProject,
    character,
    asset,
    episodes: fullEpisodes,
    updateProject,
  });

  const designFlow = useProductionAssetDesignFlow({ project: currentProject, episodes: fullEpisodes, updateProject, onReady: assetBoardImage.openPrompt, scopeKey: `${ownerId}:${selectedVariantId || ''}:${referenceMode}` });

  if (!currentProject || !owner) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-text-muted">
        <p>资产不存在或项目尚未加载</p>
        <Button size="sm" onClick={() => navigate(backUrl)}>返回项目资产</Button>
      </div>
    );
  }

  const updateOwner = (updates: Record<string, unknown>) => {
    if (character) {
      void updateProject({ characters: currentProject.characters.map((item) => item.id === ownerId ? { ...item, ...updates } as Character : item) });
      return;
    }
    void updateProject({ assets: currentProject.assets.map((item) => item.id === ownerId ? { ...item, ...updates } : item) });
  };

  const updateVariants = (nextVariants: AssetVariant[]) => updateOwner({ variants: nextVariants });

  const openVariantModal = (variant?: AssetVariant) => {
    setEditingVariantId(variant?.id || null);
    setVariantDraft({
      name: variant?.name || "",
      description: variant?.description || "",
      promptModifiers: variant?.promptModifiers || "",
      referenceVariantId: variant?.referenceVariantId || "",
    });
    setVariantModalOpen(true);
  };

  const saveVariant = () => {
    const name = variantDraft.name.trim();
    if (!name) return;
    if (editingVariantId) {
      updateVariants(variants.map((variant) => variant.id === editingVariantId ? {
        ...variant,
        ...variantDraft,
        name,
        referenceVariantId: variantDraft.referenceVariantId || undefined,
      } : variant));
    } else {
      const id = `variant-${Date.now()}-${crypto.randomUUID()}`;
      updateVariants([...variants, {
        id,
        ...variantDraft,
        name,
        referenceVariantId: variantDraft.referenceVariantId || undefined,
      }]);
      setSelectedVariantId(id);
    }
    setVariantModalOpen(false);
  };

  const deleteVariant = (variant: AssetVariant) => {
    if (!window.confirm(`删除状态变体“${variant.name}”？相关场次绑定会进入待复核。`)) return;
    updateVariants(variants.filter((item) => item.id !== variant.id));
    if (selectedVariantId === variant.id) setSelectedVariantId(null);
    void removeVariantReferences(variant.id, variant.boardImageUrl || variant.imageUrl);
  };

  const deleteOwner = async () => {
    if (!window.confirm(`删除${character ? "角色" : "资产"}“${owner.name}”？`)) return;
    if (character) await updateProject({ characters: currentProject.characters.filter((item) => item.id !== ownerId) });
    else await updateProject({ assets: currentProject.assets.filter((item) => item.id !== ownerId) });
    await removeAssetReferences(ownerId, character ? "character" : "asset");
    toast.success("资产已删除");
    navigate(backUrl);
  };

  const updateBoardPrompt = (prompt: string) => {
    try {
      void updateProject(buildProductionAssetBoardPromptUpdate({
        project: currentProject,
        assetId: ownerId,
        variantId: selectedVariantId || undefined,
        prompt: selectedBoard ? productionAssetBoardPromptCore(prompt, currentProject, selectedBoard) : prompt,
        referenceMode,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产板提示词保存失败");
    }
  };

  const handleUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => assetBoardImage.stageUpload(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const adoptExistingBoard = async () => {
    if (!selectedBoard || !selectedVariant || !generationReference?.imageUrl || generationReference.issue || isAdoptingExistingBoard) return;
    setIsAdoptingExistingBoard(true);
    try {
      const updates = buildProductionAssetBoardReferenceUpdate({
        project: currentProject,
        boardItemId: selectedBoard.id,
        imageUrl: generationReference.imageUrl,
        source: "existing",
        finalPrompt: `沿用项目内已确认的「${generationReference.label}」。创作者确认该正式参考板已经完整覆盖「${selectedVariant.name}」状态，无需重复生成。`,
        inputReferenceUrl: generationReference.imageUrl,
      });
      await updateProject(updates);
      toast.success(`已沿用${generationReference.label}，未重复调用图片模型`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "沿用正式参考板失败");
    } finally {
      setIsAdoptingExistingBoard(false);
    }
  };

  const supportsBoard = Boolean(baseBoard);

  return (
    <main className="min-h-full bg-bg-primary text-text-primary">
      <header className="border-b border-border-soft/20 bg-bg-primary">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button type="button" onClick={() => navigate(backUrl)} aria-label="返回项目资产" title="返回项目资产" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-surface-soft hover:text-text-primary">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-surface-soft text-gold">
              {character ? <UserRound className="h-5 w-5" /> : asset?.type === "location" ? <MapPin className="h-5 w-5" /> : <Box className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-black">{owner.name || "未命名资产"}</h1>
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-black", readiness.tone)}>{readiness.label}</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">{boardTypeMeta(baseBoard).label} · 项目级身份 · {assetRecord?.usageRefs.length || 0} 个场次使用</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!character && (asset?.type === "location" || asset?.type === "prop") && (
              <Button variant="outline" size="sm" onClick={() => designFlow.start([ownerId], { force: true, continueToImage: false })} disabled={designFlow.active} leftIcon={profileAI.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}>
                设计 / 补充外观
              </Button>
            )}
            <button type="button" onClick={() => void deleteOwner()} title="删除资产" aria-label="删除资产" className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-red-500/10 hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 sm:px-8 py-3"><ProductionCreativeControls project={currentProject} assetId={ownerId} visualOnly /></div>

      <div className="mx-auto max-w-7xl px-4 sm:px-8 py-5">
        <div className="mb-5 flex items-center justify-between border-b border-border-soft/20">
          <nav className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6" aria-label="资产档案视图">
            {supportsBoard && <TabButton active={activeTab === "board"} onClick={() => setActiveTab("board")} icon={ImageIcon} label="参考板" />}
            <TabButton active={activeTab === "profile" || !supportsBoard} onClick={() => setActiveTab("profile")} icon={Pencil} label={character ? "角色资料" : "制作档案"} />
            <TabButton active={activeTab === "usage"} onClick={() => setActiveTab("usage")} icon={Film} label="使用与连续性" />
          </nav>
          <div className="hidden pb-3 text-[10px] font-bold text-text-muted xl:block">项目资产 ID · {ownerId}</div>
        </div>

        {activeTab === "board" && supportsBoard && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="min-w-0 border-border-soft/20 md:border-r md:pr-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-black">身份与状态</h2>
                  <p className="mt-1 text-[10px] text-text-muted">基础身份不随场次重复创建</p>
                </div>
                <button type="button" onClick={() => openVariantModal()} title="新增状态变体" aria-label="新增状态变体" className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-surface-soft text-text-muted hover:text-gold">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2">
                <VariantButton
                  active={!selectedVariantId}
                  imageUrl={baseBoard?.referenceImageUrl}
                  title={`基础${boardTypeMeta(baseBoard).label}`}
                  subtitle="Canonical identity"
                  onClick={() => setSelectedVariantId(null)}
                />
                {variants.map((variant) => (
                  <VariantButton
                    key={variant.id}
                    active={selectedVariantId === variant.id}
                    imageUrl={variant.cleanReferenceImageUrl || variant.boardImageUrl || variant.imageUrl}
                    title={appearanceVariantDisplayName(variant, variants)}
                    subtitle={variant.description || "状态差异待补充"}
                    onClick={() => setSelectedVariantId(variant.id)}
                    actions={
                      <>
                        <button type="button" title="编辑变体" aria-label={`编辑${variant.name}`} onClick={(event) => { event.stopPropagation(); openVariantModal(variant); }} className="p-1 text-text-muted hover:text-text-primary"><Pencil className="h-3 w-3" /></button>
                        <button type="button" title="删除变体" aria-label={`删除${variant.name}`} onClick={(event) => { event.stopPropagation(); deleteVariant(variant); }} className="p-1 text-text-muted hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                      </>
                    }
                  />
                ))}
              </div>
            </aside>

            <section className="min-w-0">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BoardIcon className="h-4 w-4 text-gold" />
                    <h2 className="text-sm font-black">{selectedVariant ? `${selectedVariant.name} · ${referenceModeSpec?.label || "状态参考"}` : referenceModeSpec?.label || boardMeta.label}</h2>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{referenceMode === "clean_reference"
                    ? selectedBoard?.assetType === "character"
                      ? "正面、严格侧面、背面与上半身特写，供图像和视频模型直接读取。"
                      : selectedBoard?.assetType === "prop"
                        ? "同一道具的干净多视图，供图像和视频模型直接读取。"
                        : "单张无文字空场主视图，供图像和视频模型直接读取。"
                    : selectedBoard?.continuityRole}</p>
                  {selectedVariant && (
                    <p className={cn("mt-1 text-[10px] font-bold", generationReference?.issue ? "text-accent-amber" : "text-text-muted")}>
                      继承参考 · {generationReference?.label || "基础身份板"}{generationReference?.issue ? ` · ${generationReference.issue}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex h-9 items-center rounded-md bg-bg-surface-soft p-1" role="group" aria-label="资产参考模式">
                    <button
                      type="button"
                      onClick={() => chooseReferenceMode("production_board")}
                      aria-pressed={referenceMode === "production_board"}
                      className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-[10px] font-black", referenceMode === "production_board" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
                      title="包含研究区和确定性资料文字"
                    >
                      <FileText className="h-3.5 w-3.5" />资料板
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseReferenceMode("clean_reference")}
                      aria-pressed={referenceMode === "clean_reference"}
                      className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-[10px] font-black", referenceMode === "clean_reference" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
                      title="无文字，供图像和视频模型直接引用"
                    >
                      <ScanLine className="h-3.5 w-3.5" />纯净参考
                    </button>
                  </div>
                  <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { handleUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                  <Button variant="outline" size="sm" onClick={() => uploadInputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>导入{referenceMode === "clean_reference" ? "纯净参考" : "资料板"}</Button>
                  {referenceMode === "production_board" && selectedVariant && !boardImageUrl && generationReference?.imageUrl && !generationReference.issue && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void adoptExistingBoard()}
                      disabled={isAdoptingExistingBoard}
                      title="当前状态已被上游正式参考板完整覆盖时，可直接沿用并保留来源审计，不调用图片模型"
                      leftIcon={isAdoptingExistingBoard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    >
                      沿用继承板
                    </Button>
                  )}
                  <Button size="sm" onClick={() => designFlow.start([ownerId])} disabled={assetBoardImage.isGenerating || designFlow.active} leftIcon={assetBoardImage.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}>
                    {assetNeedsVisualDesign(currentProject, ownerId) ? "设计形象并生成" : boardImageUrl ? "重新生成" : `生成${referenceModeSpec?.label || boardMeta.label}`}
                  </Button>
                </div>
              </div>

              {!selectedVariant && <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                <span>{owner.visualDesignNeedsReview ? "新剧本提供了外观依据，当前形象保持不变，请核对。" : assetVisualDescription(owner) ? "基础形象在本项目各集复用。" : generationReferenceUrl ? "当前以已有参考图锁定形象，可补充文字外观。" : "尚未设计外观，先确定形象再生成参考图。"}</span>
                <button type="button" className="text-gold" onClick={() => designFlow.start([ownerId], { force: true, continueToImage: false })} disabled={designFlow.active}>设计 / 补充外观</button>
                {owner.visualDesignNeedsReview && <button type="button" className="text-gold" onClick={() => updateOwner({ visualDesignNeedsReview: false })}>沿用当前形象</button>}
              </div>}
              {!selectedVariant && Boolean(owner.visualFacts?.length) && <details className="text-xs text-text-muted">
                <summary className="cursor-pointer">查看已导入剧本的外观依据 · {owner.visualFacts!.length} 条</summary>
                <div className="mt-2 space-y-3">{owner.visualFacts!.map((fact, index) => <div key={`${fact.sceneId}:${index}`}>
                  <p className="text-text-secondary">{fact.scope === 'identity' ? '基础形象线索' : '本场状态'}：{fact.description}</p>
                  <p className="mt-1 whitespace-pre-wrap">原文：{fact.evidence}</p>
                  <p className="mt-1">{fullEpisodes.flatMap(ep => ep.scenes.filter(scene => scene.id === fact.sceneId).map(scene => `${ep.title} / ${scene.title}`))[0] || fact.sceneId}</p>
                </div>)}</div>
              </details>}
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-border-soft/20 bg-bg-surface">
                <div className="relative flex min-h-[500px] items-center justify-center bg-bg-surface-soft/45">
                  {boardImageUrl ? (
                    <img src={boardImageUrl} alt={`${owner.name}${boardMeta.label}`} className="h-full max-h-[620px] w-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-text-muted">
                      {assetBoardImage.isGenerating ? <Loader2 className="h-8 w-8 animate-spin text-gold" /> : <Camera className="h-8 w-8 text-text-dark" />}
                      <p className="text-xs font-bold">{assetBoardImage.isGenerating ? "正在生成候选，完成后可预览采用" : `${boardMeta.label}尚未生成`}</p>
                    </div>
                  )}
                </div>
                <aside className="flex min-h-[400px] min-w-0 flex-col border-t border-border-soft/20 bg-bg-primary xl:border-l xl:border-t-0">
                  <div className="border-b border-border-soft/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xs font-black">{referenceMode === "clean_reference" ? "纯净参考提示词" : "资料板提示词"}</h3>
                      <span className="text-[9px] font-bold text-text-muted">可编辑 · 保存后版本失效检查</span>
                    </div>
                  </div>
                  <DebouncedTextarea
                    key={`${selectedBoard?.id}:${referenceMode}`}
                    value={generationPrompt}
                    onChange={updateBoardPrompt}
                    placeholder={referenceMode === "clean_reference" ? "补充纯净参考的身份、视角和一致性约束" : "补充稳定身份、版式和一致性约束"}
                    className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[11px] leading-5 text-text-secondary outline-none custom-scrollbar"
                  />
                  <div className="border-t border-border-soft/20 px-4 py-3 text-[10px] leading-4 text-text-muted">
                    <div className="flex items-center justify-between gap-4">
                      <span>使用位置</span>
                      <span className="text-right font-bold text-text-secondary">
                        {referenceMode === "clean_reference" ? "分镜画面、视频生成" : "剧本与场次、资产档案"}
                      </span>
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        )}

        {(activeTab === "profile" || (!supportsBoard && activeTab === "board")) && (
          character ? (
            <div><CharacterProfile character={character} project={currentProject} updateOwner={updateOwner} sourceImageUrl={sourceImageUrl} isGenerating={profileAI.isGenerating} onExtract={() => void profileAI.openPrompt("extract")} onDesign={() => designFlow.start([ownerId], { force: true, continueToImage: false })} /><CharacterVoiceSettings key={character.id} character={character} projectId={currentProject.id} /></div>
          ) : (
            <AssetProfile asset={asset!} updateOwner={updateOwner} sourceImageUrl={sourceImageUrl} />
          )
        )}

        {activeTab === "usage" && (
          <section className="grid grid-cols-[minmax(0,1fr)_340px] gap-8">
            <div>
              <h2 className="text-sm font-black">场次使用</h2>
              <p className="mt-1 text-xs text-text-muted">场次只绑定项目资产 ID 与状态变体，不复制基础板。</p>
              <div className="mt-4 divide-y divide-border-soft/20 border-y border-border-soft/20">
                {(assetRecord?.usageRefs || []).map((usage) => (
                  <button key={`${usage.episodeId}:${usage.sceneId}`} type="button" onClick={() => navigate(`/production/preparation?${new URLSearchParams({ projectId: currentProject.id, episodeId: usage.episodeId, sceneId: usage.sceneId, tab: "assets" })}`)} className="flex w-full items-center justify-between gap-5 px-2 py-4 text-left hover:bg-bg-surface-soft">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black">{usage.sceneTitle}</p>
                      <p className="mt-1 text-[10px] text-text-muted">{usage.episodeTitle} · {usage.variantId ? `状态变体 ${variants.find((item) => item.id === usage.variantId)?.name || usage.variantId}` : "基础身份"}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold text-text-muted">{usage.shotIds.length} 个镜头</span>
                  </button>
                ))}
                {!assetRecord?.usageRefs.length && <p className="px-2 py-8 text-center text-xs text-text-muted">尚未绑定到正式场次</p>}
              </div>
            </div>
            <aside className="space-y-6 border-l border-border-soft/20 pl-6">
              <div>
                <h3 className="text-xs font-black">参考链路</h3>
                <div className="mt-3 space-y-2">
                  <FlowStep icon={boardImageUrl ? CheckCircle2 : CircleAlert} label={boardTypeMeta(baseBoard).label} status={boardImageUrl ? "已就绪" : "待生成"} ready={Boolean(boardImageUrl)} />
                  <FlowStep icon={Layers3} label="场景视觉包" status={`${assetRecord?.usageRefs.length || 0} 个场次投影`} ready={Boolean(assetRecord?.usageRefs.length)} />
                  <FlowStep icon={Clapperboard} label="分镜参考槽" status="按场次状态选择" ready={Boolean(boardImageUrl)} />
                  <FlowStep icon={Film} label="视频参考包" status="随生成单元打包" ready={Boolean(boardImageUrl)} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between"><h3 className="text-xs font-black">确认与审计</h3><span className="text-[10px] text-text-muted">{approvalCount} 次场次确认</span></div>
                <div className="mt-3 divide-y divide-border-soft/20 border-y border-border-soft/20">
                  {auditEntries.slice().reverse().map((audit) => (
                    <div key={`${audit.boardItemId}:${audit.updatedAt}`} className="py-3 text-[10px] text-text-muted">
                      <div className="flex items-center justify-between gap-3"><span className="font-bold text-text-secondary">{audit.source === "upload" ? "导入" : audit.source === "existing" ? "沿用" : "AI 生成并采用"}{audit.referenceMode === "clean_reference" ? "纯净参考" : "资料资产板"}</span><span>{new Date(audit.updatedAt).toLocaleString("zh-CN")}</span></div>
                      <p className="mt-1">{formatAIExecutionProvenance(audit.executionProvenance, audit.modelId, audit.source)} · Skill {audit.selectedSkillIds.length} · 上下文 {audit.selectedContextIds.length}</p>
                      {audit.finalPrompt && <details className="mt-2"><summary className="cursor-pointer font-bold text-gold">查看最终提示词</summary><pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 custom-scrollbar">{audit.finalPrompt}</pre></details>}
                    </div>
                  ))}
                  {profileRevisionEntries.slice().reverse().map((audit) => (
                    <div key={`${audit.assetId}:${audit.updatedAt}`} className="py-3 text-[10px] text-text-muted">
                      <div className="flex items-center justify-between gap-3"><span className="font-bold text-text-secondary">档案候选已采用</span><span>{new Date(audit.updatedAt).toLocaleString("zh-CN")}</span></div>
                      <p className="mt-1">{audit.changedFields.length} 项变化 · {formatAIExecutionProvenance(audit.executionProvenance, audit.modelId)} · Skill {audit.selectedSkillIds.length} · 上下文 {audit.selectedContextIds.length}{audit.reviewScore !== undefined ? ` · 质检 ${audit.reviewScore} 分` : ""}</p>
                      <details className="mt-2"><summary className="cursor-pointer font-bold text-gold">查看字段差异与提示词</summary><div className="mt-2 space-y-2"><p>模板 {audit.templateId}</p>{audit.reviewSummary && <p>质检：{audit.reviewVerdict} · {audit.reviewSummary}</p>}<pre className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 custom-scrollbar">当前：{JSON.stringify(audit.beforeValues, null, 2)}{"\n"}采用：{JSON.stringify(audit.adoptedValues, null, 2)}</pre><pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 custom-scrollbar">{audit.finalPrompt}</pre>{audit.reviewAttempts?.map((attempt) => <pre key={attempt.attempt} className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 custom-scrollbar">第 {attempt.attempt} 轮质检 · {attempt.score} 分 · {attempt.verdict} · {formatAIExecutionProvenance(attempt.executionProvenance, attempt.modelId)}{"\n"}{attempt.finalPrompt}</pre>)}</div></details>
                    </div>
                  ))}
                  {!auditEntries.length && !profileRevisionEntries.length && <p className="py-5 text-center text-[10px] text-text-muted">暂无生成或采用记录</p>}
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>

      <ProductionAssetDesignDialogs flow={designFlow} />
      <ImagePromptModal
        isOpen={assetBoardImage.isPromptOpen}
        onClose={assetBoardImage.closePrompt}
        initialPrompt={generationPrompt}
        initialReferenceImage={generationReferenceUrl}
        title={`${owner.name} · ${referenceModeSpec?.label || boardMeta.label}`}
        confirmText="生成候选"
        onConfirm={assetBoardImage.generateCandidate}
      />
      <ProductionAssetBoardReviewModal
        candidate={assetBoardImage.candidate}
        isAdopting={assetBoardImage.isAdopting}
        onClose={assetBoardImage.discardCandidate}
        onAdopt={() => void assetBoardImage.adoptCandidate()}
      />
      <PromptEditorModal
        isOpen={Boolean(profileAI.promptRequest)}
        onClose={profileAI.closePrompt}
        templateId={profileAI.promptRequest?.templateId || "productionAssetCharacterProfile"}
        variables={profileAI.promptRequest?.variables || {}}
        onConfirm={profileAI.executePrompt}
        title={profileAI.promptRequest?.title}
        contextOptions={profileAI.promptRequest?.contextOptions}
        defaultSelectedContextIds={profileAI.promptRequest?.defaultSelectedContextIds}
        workflowStepId="production.asset.profile_enrichment"
      />
      <ProductionAssetProfileReviewModal
        candidate={profileAI.candidate}
        isAdopting={profileAI.isAdopting}
        onClose={profileAI.discardCandidate}
        onAdopt={() => void profileAI.adoptCandidate()}
      />
      <Modal
        isOpen={variantModalOpen}
        onClose={() => setVariantModalOpen(false)}
        title={editingVariantId ? "编辑状态变体" : "新增状态变体"}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setVariantModalOpen(false)}>取消</Button>
            <Button size="sm" onClick={saveVariant} disabled={!variantDraft.name.trim()}>{editingVariantId ? "保存变体" : "创建变体"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <LabeledInput label="状态名称"><input value={variantDraft.name} onChange={(event) => setVariantDraft((current) => ({ ...current, name: event.target.value }))} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm outline-none focus:ring-1 focus:ring-gold" placeholder="例如：雨夜湿身、战损、开启状态" /></LabeledInput>
          <LabeledInput label="可见差异"><textarea value={variantDraft.description} onChange={(event) => setVariantDraft((current) => ({ ...current, description: event.target.value }))} className="h-24 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm outline-none focus:ring-1 focus:ring-gold" placeholder="只描述相对基础身份发生的可见变化" /></LabeledInput>
          <LabeledInput label="提示词补充"><textarea value={variantDraft.promptModifiers} onChange={(event) => setVariantDraft((current) => ({ ...current, promptModifiers: event.target.value }))} className="h-24 w-full resize-none rounded-md bg-bg-surface-soft p-3 font-mono text-xs outline-none focus:ring-1 focus:ring-gold" placeholder="状态差异、材质、妆发、伤势或交互部件" /></LabeledInput>
          <LabeledInput label="继承参考板">
            <select
              value={variantDraft.referenceVariantId}
              onChange={(event) => setVariantDraft((current) => ({ ...current, referenceVariantId: event.target.value }))}
              className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm outline-none focus:ring-1 focus:ring-gold"
            >
              <option value="">基础身份板（默认）</option>
              {variants.filter((variant) => variant.id !== editingVariantId).map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name}{variant.boardImageUrl || variant.imageUrl ? " · 已就绪" : " · 待生成"}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[10px] leading-4 text-text-muted">只有连续演变状态才需要继承前一张状态板；互相独立的服装、天气或方案变体继续继承基础身份。</p>
          </LabeledInput>
        </div>
      </Modal>
    </main>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof ImageIcon; label: string }) {
  return <button type="button" onClick={onClick} className={cn("flex h-11 items-center gap-2 border-b-2 px-1 text-xs font-black", active ? "border-gold text-text-primary" : "border-transparent text-text-muted hover:text-text-primary")}><Icon className="h-3.5 w-3.5" />{label}</button>;
}

function VariantButton({ active, imageUrl, title, subtitle, onClick, actions }: { active: boolean; imageUrl?: string; title: string; subtitle: string; onClick: () => void; actions?: React.ReactNode }) {
  return (
    <div className={cn("flex w-full min-w-0 items-center rounded-lg border p-2", active ? "border-gold/50 bg-bg-surface" : "border-transparent bg-bg-surface-soft hover:bg-bg-surface-hover")}>
      <button type="button" onClick={onClick} title={`${title}\n${subtitle}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-primary">{imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <ImageIcon className="h-4 w-4 text-text-dark" />}</span>
        <span className="min-w-0 flex-1"><span className="line-clamp-2 break-words text-xs font-black">{title}</span><span className="mt-1 block truncate text-[9px] text-text-muted">{subtitle}</span></span>
      </button>
      {actions && <span className="ml-1 flex shrink-0 items-center">{actions}</span>}
    </div>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-black text-text-muted">{label}</span>{children}</label>;
}

function CharacterProfile({ character, project, updateOwner, sourceImageUrl, isGenerating, onExtract, onDesign }: {
  character: Character; project: Project; updateOwner: (updates: Record<string, unknown>) => void;
  sourceImageUrl?: string; isGenerating: boolean; onExtract: () => void; onDesign: () => void;
}) {
  const documents = project.productionSourceDocuments || [];
  const revisions = (project.manualProductionAssets?.profileRevisions || []).filter(item => item.assetId === character.id);
  const latest = revisions[revisions.length - 1];
  const inputClass = "min-h-24 w-full resize-y rounded-md bg-bg-surface-soft p-3 text-sm leading-6 outline-none";
  return (
    <section className="min-w-0">
      <div className="flex flex-col items-start justify-between gap-3 border-b border-border-soft/20 pb-4 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-sm font-bold">当前可用资料</h2>
          <p className="text-xs leading-5 text-text-muted">{documents.length ? `已导入 ${documents.length} 份来源：${documents.map(item => item.title).join("、")}` : project.episodes.length ? `项目中有 ${project.episodes.length} 个分集；整理时读取其中可用的剧本正文。` : "尚未导入剧本，可先手动填写资料或设计外观。"}</p>
          <p className="text-xs leading-5 text-text-muted">只依据已选原文整理空缺信息。只导入一集也可以制作，未知的全剧心理与目标无需补齐；已有内容可直接编辑。</p>
        </div>
        <Button size="sm" variant="outline" disabled={isGenerating} onClick={onExtract} leftIcon={isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}>从已导入剧本整理</Button>
      </div>
      {latest && <details className="border-b border-border-soft/20 py-3 text-xs text-text-muted">
        <summary className="cursor-pointer">最近采用的整理依据 · {new Date(latest.createdAt).toLocaleDateString()}</summary>
        <div className="mt-2 space-y-2 whitespace-pre-wrap leading-5">
          {(latest.evidence || []).map((text, index) => <p key={index}>{text}</p>)}
          {(latest.assumptions || []).map((text, index) => <p key={`design-${index}`}>{text}</p>)}
          {!latest.evidence?.length && <p>旧记录没有单独的来源说明，可在原提示词中核对。</p>}
          <details><summary className="cursor-pointer">查看当时的完整提示词</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{latest.finalPrompt}</pre></details>
          <p>这是当时采用记录；追加或修改剧本后，可再次整理空缺信息。不会自动改写已有内容。</p>
        </div>
      </details>}
      <div className="divide-y divide-border-soft/20">
        <ProfileSection title="外观与身份" output="生成角色参考图时使用">
          <LabeledInput label="角色姓名"><DebouncedInput value={character.name || ""} onChange={value => updateOwner({ name: value })} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm font-bold outline-none" /></LabeledInput>
          {sourceImageUrl && <img src={sourceImageUrl} alt={`${character.name}身份参考素材`} className="max-h-48 max-w-full rounded-md object-contain" referrerPolicy="no-referrer" />}
          <LabeledInput label="稳定外观"><DebouncedTextarea value={character.visualIdentity || ""} onChange={value => updateOwner({ visualIdentity: value })} className={inputClass} placeholder="剧本明确的年龄、体态、发型、基础服装与辨识特征。没有写明的外观，可另行设计。" /></LabeledInput>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={isGenerating} onClick={onDesign} leftIcon={<Wand2 className="h-4 w-4" />}>设计缺失外观</Button>
            <p className="text-xs text-text-muted">生成可调整的外观候选，保留已定身份；画风在上方单独设置。</p>
          </div>
        </ProfileSection>
        <ProfileSection title="表演与说话" output="分镜动作与对白配音">
          <LabeledInput label="日常表演习惯（可选）"><DebouncedTextarea value={character.actingStyle || ""} onChange={value => updateOwner({ actingStyle: value })} className={inputClass} placeholder="例如：听别人说话时动作少，回应前先看向对方。只填写已确认的习惯。" /></LabeledInput>
          <LabeledInput label="说话习惯（可选）"><DebouncedTextarea value={character.vocalQuirk || ""} onChange={value => updateOwner({ vocalQuirk: value })} className={inputClass} placeholder="例如：语速平稳，句尾收住，回答前有短停顿。具体音色在下方设置。" /></LabeledInput>
          <p className="text-xs leading-5 text-text-muted">本场想要什么、情绪如何变化、如何行动，由本场原文在生成分镜时处理，不存成全剧性格。单句配音要求优先于日常习惯。修改资料不会自动重做已有分镜或录音。</p>
        </ProfileSection>
        <details className="py-4">
          <summary className="cursor-pointer text-xs font-bold">补充人物设定（可选）</summary>
          <p className="mt-3 text-xs leading-5 text-text-muted">已有的人物小传或全剧设定可在这里保留，也可全部留空。系统不从单集自动推断；人格标签不作为外貌或配音指令。</p>
        <ProfileSection title="心理与目标" output="作者已知的长期设定，可留空">
          <LabeledInput label="心理画像"><DebouncedTextarea value={character.psychologicalProfile || ""} onChange={(value) => updateOwner({ psychologicalProfile: value })} className="h-28 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm leading-6 outline-none" /></LabeledInput>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <LabeledInput label="外在目标"><DebouncedTextarea value={character.externalGoal || ""} onChange={(value) => updateOwner({ externalGoal: value })} className="h-24 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm outline-none" /></LabeledInput>
            <LabeledInput label="内在渴望"><DebouncedTextarea value={character.internalDesire || ""} onChange={(value) => updateOwner({ internalDesire: value })} className="h-24 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm outline-none" /></LabeledInput>
            <LabeledInput label="压力弱点"><DebouncedTextarea value={character.flaw || ""} onChange={(value) => updateOwner({ flaw: value })} className="h-24 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm outline-none" /></LabeledInput>
          </div>
        </ProfileSection>
        <ProfileSection title="人格参考" output="写作参考，不替代具体表演要求">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LabeledInput label="MBTI"><select value={character.mbti || ""} onChange={event => updateOwner({ mbti: event.target.value })} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm outline-none"><option value="">未设置</option>{MBTI_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}</select></LabeledInput>
            <LabeledInput label="九型人格"><DebouncedInput value={character.enneagram || ""} onChange={value => updateOwner({ enneagram: value })} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm outline-none" placeholder="可留空" /></LabeledInput>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-black text-text-muted">情绪 / 压力维度</p>
            {Object.entries(character.sliders || {}).length ? <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-3">{Object.entries(character.sliders || {}).map(([key, value]) => <label key={key} className="grid grid-cols-[100px_minmax(0,1fr)_28px] items-center gap-3 text-xs"><span className="truncate text-text-secondary">{key}</span><input type="range" min={-10} max={10} value={value} onChange={(event) => updateOwner({ sliders: { ...(character.sliders || {}), [key]: Number(event.target.value) } })} className="accent-current" /><span className="text-right font-mono text-text-muted">{value}</span></label>)}</div> : <p className="text-xs text-text-muted">暂无预设维度，无需补齐；本场情绪按场次剧本处理。</p>}
          </div>
        </ProfileSection>
        </details>
      </div>
    </section>
  );
}

function AssetProfile({ asset, updateOwner, sourceImageUrl }: { asset: Asset; updateOwner: (updates: Record<string, unknown>) => void; sourceImageUrl?: string }) {
  return (
    <section className="grid grid-cols-[220px_minmax(0,1fr)] gap-8">
      <aside>
        <h2 className="text-xs font-black">概念 / 勘景参考</h2>
        <div className="mt-3 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-bg-surface-soft">{sourceImageUrl ? <img src={sourceImageUrl} alt={`${asset.name}参考素材`} className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : asset.type === "location" ? <MapPin className="h-7 w-7 text-text-dark" /> : <Box className="h-7 w-7 text-text-dark" />}</div>
        <p className="mt-2 text-[10px] leading-4 text-text-muted">仅作为资产板生成种子；视频参考包读取场景板、道具板及状态变体板。</p>
      </aside>
      <div className="divide-y divide-border-soft/20 border-y border-border-soft/20">
        <ProfileSection title="制作身份" output={asset.type === "location" ? "美术 · 灯光 · 摄影 · 连续性" : "道具 · 表演交互 · 连续性"}>
          <LabeledInput label="资产名称"><DebouncedInput value={asset.name || ""} onChange={(value) => updateOwner({ name: value })} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm font-bold outline-none" /></LabeledInput>
          <LabeledInput label={asset.type === "location" ? "空间、材质与可拍条件" : "外形、材质、尺寸与交互结构"}><DebouncedTextarea value={assetVisualDescription(asset)} onChange={(value) => updateOwner({ description: value })} className="h-44 w-full resize-none rounded-md bg-bg-surface-soft p-3 text-sm leading-6 outline-none" /></LabeledInput>
          <LabeledInput label="关键词"><DebouncedInput value={(asset.tags || []).join("，")} onChange={(value) => updateOwner({ tags: value.replaceAll("，", ",").split(",").map((item) => item.trim()).filter(Boolean) })} className="h-10 w-full rounded-md bg-bg-surface-soft px-3 text-sm outline-none" placeholder="材质、年代、功能、气氛" /></LabeledInput>
        </ProfileSection>
      </div>
    </section>
  );
}

function ProfileSection({ title, output, children }: { title: string; output: string; children: React.ReactNode }) {
  return <section className="grid grid-cols-1 gap-3 py-5 lg:grid-cols-[140px_minmax(0,1fr)] lg:gap-6"><div><h2 className="text-xs font-black">{title}</h2><p className="mt-2 text-[10px] leading-4 text-text-muted">{output}</p></div><div className="min-w-0 space-y-4">{children}</div></section>;
}

function FlowStep({ icon: Icon, label, status, ready }: { icon: typeof Film; label: string; status: string; ready: boolean }) {
  return <div className="flex items-center gap-3 rounded-md bg-bg-surface-soft px-3 py-2.5"><Icon className={cn("h-4 w-4", ready ? "text-emerald-500" : "text-accent-amber")} /><div className="min-w-0 flex-1"><p className="text-[11px] font-black">{label}</p><p className="mt-0.5 truncate text-[9px] text-text-muted">{status}</p></div></div>;
}
