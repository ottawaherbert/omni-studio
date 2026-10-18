import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { 
  ArrowLeft, Upload, Wand2, Loader2, Image as ImageIcon, Plus, Trash2, 
  Check, Settings2, User, MapPin, Box, Sparkles, Info, Tag, Music,
  Camera, Eye, X
} from 'lucide-react';
import { Asset, Character, AssetVariant, type Project } from '../../clients/domainTypes';
import { useAIConfigStore, useProjectStore } from '../../clients/stateClient';
import { useGlobalStore, GlobalAsset } from '../../clients/stateClient';
import { generateAIImage } from '../../clients/aiClient';
import toast from 'react-hot-toast';
import ImagePromptModal from '../ImagePromptModal';
import PromptEditorModal from '../PromptEditorModal';
import { useBibleAI } from '../../hooks/useBibleAI';
import { DebouncedTextarea } from '../ui/DebouncedInputs';
import { summarizeUnknownError } from '../../utils/logging';
import { PanoramaViewer } from './PanoramaViewer';
import {
  adoptGlobalVisualImageCandidate,
  adoptVisualImageCandidate,
  buildAssetImagePrompt,
  buildAssetImageVisualRecipeInputEvidence,
  buildImageVisualStyleProjection,
  createCanonicalAssetGenerationReference,
  createVisualImageCandidate,
  rejectVisualImageCandidate,
  resolveCreativeVisionVisualFallback,
  upsertVisualImageCandidate,
  visualImageCandidateSourceContentHash,
  type AssetImagePromptType,
  type CompiledImageGenerationRequest,
} from '../../clients/productionVisualImageClient';
import { VisualImageCandidatePanel } from '../production/VisualImageCandidatePanel';

interface AssetDetailViewProps {
  assetId: string;
  type: 'global' | 'project';
  assetType: 'character' | 'asset';
  onBack: () => void;
}

const pendingProjectWrite = () => (
  useProjectStore.getState() as ReturnType<typeof useProjectStore.getState> & {
    _updateProjectLock?: Promise<void>;
  }
)._updateProjectLock;

const visualProjectionTargetType = (
  isCharacter: boolean,
  assetType: Asset["type"] | undefined,
) => isCharacter
  ? "character" as const
  : assetType === "location"
    ? "location" as const
    : assetType === "vfx"
      ? "vfx" as const
      : "prop" as const;

const buildProjectAssetVisualStyleProjection = ({
  project,
  assetId,
  isCharacter,
  assetType,
  variantId,
}: {
  project: Project;
  assetId: string;
  isCharacter: boolean;
  assetType?: Asset["type"];
  variantId?: string;
}) => {
  const canonicalAsset = isCharacter
    ? project.characters.find((entry) => entry.id === assetId)
    : project.assets.find((entry) => entry.id === assetId);
  return buildImageVisualStyleProjection({
    project,
    intent: variantId ? "asset_state" : "asset_identity",
    target: {
      entityType: visualProjectionTargetType(isCharacter, assetType),
      entityId: assetId,
    },
    assetOverride: canonicalAsset?.visualOverride,
  });
};

export function AssetDetailView({ assetId, type, assetType, onBack }: AssetDetailViewProps) {
  const { currentProject, updateProject } = useProjectStore();
  const { globalAssets, updateGlobalAsset, deleteGlobalAsset } = useGlobalStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const variantFileInputRef = useRef<HTMLInputElement>(null);
  const nextImageRequestIdRef = useRef(0);
  const activeImageRequestIdsRef = useRef(new Map<string, number>());
  const renderedViewKey = `${type}:${assetId}:${type === "project" ? currentProject?.id || "missing" : "global"}`;
  const viewContextRef = useRef({
    key: renderedViewKey,
    projectId: type === "project" ? currentProject?.id ?? null : null,
    epoch: 0,
  });
  if (viewContextRef.current.key !== renderedViewKey) {
    viewContextRef.current = {
      key: renderedViewKey,
      projectId: type === "project" ? currentProject?.id ?? null : null,
      epoch: viewContextRef.current.epoch + 1,
    };
    activeImageRequestIdsRef.current.clear();
  }
  const isRenderedViewCurrent = () => viewContextRef.current.key === renderedViewKey
    && (type !== "project" || (
      Boolean(viewContextRef.current.projectId)
      && useProjectStore.getState().currentProject?.id === viewContextRef.current.projectId
    ));

  const {
    handleRegenerateCharacter,
    handleRegenerateAsset,
    handleGenerateSpecificPrompt,
    handleGeneratePanoramaImage,
    handleGenerateAssetMultiViewImage,
    isOptimizingPrompt,
    generatingCharId,
    generatingAssetId,
    promptModalState: aiPromptModal,
    closePromptModal,
  } = useBibleAI();
  
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [isViewingPanorama, setIsViewingPanorama] = useState(false);
  const [generatingVariantId, setGeneratingVariantId] = useState<string | null>(null);
  const [isAddingVariant, setIsAddingVariant] = useState(false);
  const [newVariant, setNewVariant] = useState<Partial<AssetVariant>>({ name: '', description: '', promptModifiers: '' });
  const [promptModalState, setPromptModalState] = useState<{
    isOpen: boolean;
    initialPrompt: string;
    targetVariantId?: string;
  }>({ isOpen: false, initialPrompt: '' });

  React.useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (type !== "project") return;
      const projectId = state.currentProject?.id ?? null;
      const key = `${type}:${assetId}:${projectId || "missing"}`;
      if (viewContextRef.current.key === key) return;
      viewContextRef.current = {
        key,
        projectId,
        epoch: viewContextRef.current.epoch + 1,
      };
      activeImageRequestIdsRef.current.clear();
      setPromptModalState({ isOpen: false, initialPrompt: '' });
      setIsGeneratingBase(false);
      setGeneratingVariantId(null);
    });
    return unsubscribe;
  }, [assetId, type]);

  React.useEffect(() => {
    setPromptModalState({ isOpen: false, initialPrompt: '' });
    setIsGeneratingBase(false);
    setGeneratingVariantId(null);
  }, [renderedViewKey]);

  const beginImageRequest = (requestKey: string) => {
    const context = viewContextRef.current;
    if (context.key !== renderedViewKey) return null;
    const request = {
      viewKey: context.key,
      projectId: context.projectId,
      viewEpoch: context.epoch,
      requestKey,
      requestId: ++nextImageRequestIdRef.current,
    };
    activeImageRequestIdsRef.current.set(requestKey, request.requestId);
    return request;
  };

  const isImageRequestCurrent = (request: NonNullable<ReturnType<typeof beginImageRequest>>) => (
    activeImageRequestIdsRef.current.get(request.requestKey) === request.requestId
    && viewContextRef.current.key === request.viewKey
    && viewContextRef.current.epoch === request.viewEpoch
    && (type !== "project" || (
      Boolean(request.projectId)
      && useProjectStore.getState().currentProject?.id === request.projectId
    ))
  );

  const awaitProjectWrites = async (request: NonNullable<ReturnType<typeof beginImageRequest>>) => {
    if (type !== "project") return isImageRequestCurrent(request);
    while (isImageRequestCurrent(request)) {
      const pendingWrite = pendingProjectWrite();
      if (pendingWrite) await pendingWrite;
      if (!isImageRequestCurrent(request)) return false;
      if (pendingProjectWrite() === pendingWrite) return true;
    }
    return false;
  };

  const finishImageRequest = (request: NonNullable<ReturnType<typeof beginImageRequest>>) => {
    if (activeImageRequestIdsRef.current.get(request.requestKey) !== request.requestId) return false;
    activeImageRequestIdsRef.current.delete(request.requestKey);
    return true;
  };

  // Get the asset based on type
  let asset: any = null;
  if (type === 'global') {
    asset = globalAssets.find(a => a.id === assetId);
  } else {
    if (assetType === 'character') {
      asset = currentProject?.characters.find(c => c.id === assetId);
    } else {
      asset = currentProject?.assets.find(a => a.id === assetId);
    }
  }

  if (!asset) return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-gray-500 mb-4">未找到资产</p>
      <button onClick={onBack} className="text-violet-500 font-bold">返回列表</button>
    </div>
  );

  const isCharacter = assetType === 'character' || (type === 'global' && asset.type === 'character');
  const baseImageUrl = type === 'global' 
    ? asset.imageUrls?.[0] 
    : (isCharacter ? (asset as Character).referenceImageUrl : (asset as Asset).imageUrl);
  
  const description = type === 'global'
    ? asset.description
    : (isCharacter ? ((asset as Character).visualIdentity || asset.name) : (asset as Asset).description);
  
  const variants = asset.variants || [];
  const defaultVariantId = asset.defaultVariantId;

  const resolveLatestAsset = () => {
    if (type === "global") {
      return useGlobalStore.getState().globalAssets.find((entry) => entry.id === assetId);
    }
    const latestProject = useProjectStore.getState().currentProject;
    return assetType === "character"
      ? latestProject?.characters.find((entry) => entry.id === assetId)
      : latestProject?.assets.find((entry) => entry.id === assetId);
  };

  const handleUpdateAsset = (updates: any) => {
    if (!isRenderedViewCurrent()) return;
    if (type === 'global') {
      updateGlobalAsset(assetId, updates);
    } else {
      const latestProject = useProjectStore.getState().currentProject;
      const expectedProjectId = viewContextRef.current.projectId;
      if (!latestProject || !expectedProjectId || latestProject.id !== expectedProjectId) return;
      if (assetType === 'character') {
        const newCharacters = latestProject.characters.map(c =>
          c.id === asset.id ? { ...c, ...updates } : c
        );
        updateProject({ characters: newCharacters }, { expectedProjectId });
      } else {
        const newAssets = latestProject.assets.map(a =>
          a.id === asset.id ? { ...a, ...updates } : a
        );
        updateProject({ assets: newAssets }, { expectedProjectId });
      }
    }
  };

  const adoptImageCandidate = (candidateId: string) => {
    const latestAsset = resolveLatestAsset();
    if (!latestAsset) return;
    handleUpdateAsset(type === "global"
      ? adoptGlobalVisualImageCandidate(latestAsset as GlobalAsset, candidateId)
      : adoptVisualImageCandidate(latestAsset, candidateId, Date.now(), currentProject?.visualStyleLock));
    toast.success("图片候选已采用为正式资产");
  };

  const rejectImageCandidate = (candidateId: string) => {
    const latestAsset = resolveLatestAsset();
    if (!latestAsset) return;
    handleUpdateAsset(rejectVisualImageCandidate(latestAsset, candidateId));
    toast.success("图片候选已丢弃");
  };

  const handleBaseFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploadRequest = beginImageRequest("upload:base");
    if (!uploadRequest) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        if (!isImageRequestCurrent(uploadRequest)) return;
        if (!await awaitProjectWrites(uploadRequest)) return;
        const latestAsset = resolveLatestAsset();
        if (!latestAsset || !isImageRequestCurrent(uploadRequest)) return;
        const dataUrl = String(reader.result || "");
        const updates: any = {};
        if (!("defaultReferenceUrl" in latestAsset) || !latestAsset.defaultReferenceUrl) {
          updates.defaultReferenceUrl = dataUrl;
        }
        if (type === 'global') {
          updates.imageUrls = [dataUrl];
          handleUpdateAsset(updates);
        } else if (isCharacter) {
          updates.referenceImageUrl = dataUrl;
          handleUpdateAsset(updates);
        } else {
          updates.imageUrl = dataUrl;
          handleUpdateAsset(updates);
        }
      } finally {
        finishImageRequest(uploadRequest);
      }
    };
    reader.onerror = () => finishImageRequest(uploadRequest);
    reader.readAsDataURL(file);
  };

  const handleVariantFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeVariantId) return;
    const targetVariantId = activeVariantId;
    const uploadRequest = beginImageRequest(`upload:variant:${targetVariantId}`);
    if (!uploadRequest) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        if (!isImageRequestCurrent(uploadRequest)) return;
        if (!await awaitProjectWrites(uploadRequest)) return;
        const latestAsset = resolveLatestAsset();
        const latestVariants = latestAsset && "variants" in latestAsset ? latestAsset.variants : undefined;
        if (!latestAsset || !latestVariants?.some((variant) => variant.id === targetVariantId)) return;
        const dataUrl = String(reader.result || "");
        const updatedVariants = latestVariants.map((variant) =>
          variant.id === targetVariantId ? { ...variant, imageUrl: dataUrl } : variant
        );
        const updates: any = { variants: updatedVariants };
        if (!("defaultReferenceUrl" in latestAsset) || !latestAsset.defaultReferenceUrl) {
          updates.defaultReferenceUrl = dataUrl;
        }
        handleUpdateAsset(updates);
        if (isImageRequestCurrent(uploadRequest)) setActiveVariantId(null);
      } finally {
        finishImageRequest(uploadRequest);
      }
    };
    reader.onerror = () => finishImageRequest(uploadRequest);
    reader.readAsDataURL(file);
  };

  const openBaseImagePrompt = () => {
    const prompt = ('prompt' in asset ? asset.prompt : '') || description || asset.name;
    const assetType: AssetImagePromptType = isCharacter ? 'character' : (asset.type === 'location' ? 'location' : 'prop');
    const fullPrompt = buildAssetImagePrompt({
      assetType,
      assetName: asset.name,
      description: prompt,
      visualStyle: resolveCreativeVisionVisualFallback(type === 'project' ? currentProject : undefined),
    });
    
    setPromptModalState({
      isOpen: true,
      initialPrompt: fullPrompt,
      targetVariantId: undefined
    });
  };

  const openVariantImagePrompt = (variant: AssetVariant) => {
    const basePrompt = ('prompt' in asset ? asset.prompt : '') || description || asset.name;
    const assetType: AssetImagePromptType = isCharacter ? 'character' : (asset.type === 'location' ? 'location' : 'prop');
    const fullPrompt = buildAssetImagePrompt({
      assetType,
      assetName: asset.name,
      description: basePrompt,
      variantDescription: variant.description,
      variantModifiers: variant.promptModifiers,
      visualStyle: resolveCreativeVisionVisualFallback(type === 'project' ? currentProject : undefined),
    });
    
    setPromptModalState({
      isOpen: true,
      initialPrompt: fullPrompt,
      targetVariantId: variant.id
    });
  };

  const handleGenerateImageConfirm = async (finalPrompt: string, referenceImage?: string) => {
    const targetVariantId = promptModalState.targetVariantId;
    const requestKey = targetVariantId ? `variant:${targetVariantId}` : "base";
    let generationRequest: NonNullable<ReturnType<typeof beginImageRequest>> | null = null;

    if (type === "global" && targetVariantId) {
      toast.error("全局资产当前只支持生成基础形象候选，请先将资产加入项目后生成状态变体。");
      return;
    }
    generationRequest = beginImageRequest(requestKey);
    if (!generationRequest) return;
    if (targetVariantId) {
      setGeneratingVariantId(targetVariantId);
    } else {
      setIsGeneratingBase(true);
    }

    try {
      let aspectRatio: "1:1" | "16:9" | "3:4" = "16:9";
      if (isCharacter) {
        aspectRatio = "3:4";
      } else if (asset.type === 'prop') {
        aspectRatio = "1:1";
      }

      const latestProject = useProjectStore.getState().currentProject;
      const sourceOwner = resolveLatestAsset() || asset;
      const candidateKind = targetVariantId ? "variant" as const : "base" as const;
      const sourceContentHash = visualImageCandidateSourceContentHash({
        owner: sourceOwner,
        kind: candidateKind,
        variantId: targetVariantId,
        visualStyleLock: type === "project" ? latestProject?.visualStyleLock : undefined,
      });
      let compiledRequest: CompiledImageGenerationRequest | undefined;
      const imageUrl = await generateAIImage({
        promptCore: finalPrompt,
        aspectRatio,
        visualStyleProjection: type === "project" && latestProject
          ? buildProjectAssetVisualStyleProjection({
              project: latestProject,
              assetId: asset.id,
              isCharacter,
              assetType: isCharacter ? undefined : asset.type,
              variantId: targetVariantId,
            })
          : undefined,
        visualRecipeInputEvidence: type === "project"
          ? buildAssetImageVisualRecipeInputEvidence({
              intent: targetVariantId ? "asset_state" : "asset_identity",
              identityFacts: isCharacter
                ? [(asset as Character).visualIdentity, (asset as Character).boardPrompt, asset.imageUrl]
                : [(asset as Asset).description, (asset as Asset).prompt, (asset as Asset).boardPrompt, asset.imageUrl],
              stateDelta: targetVariantId
                ? asset.variants?.find((entry) => entry.id === targetVariantId)
                : undefined,
              identitySource: "Project.asset.canonicalIdentityFacts",
              stateSource: "Project.asset.variants.stateDelta",
            })
          : undefined,
        references: referenceImage ? [createCanonicalAssetGenerationReference({
          imageUrl: referenceImage,
          label: `${asset.name}${targetVariantId ? " 变体" : ""} 的 canonical 身份与上游状态参考`,
          assetType: isCharacter ? "character" : asset.type === "location" ? "location" : "prop",
          stateChange: Boolean(targetVariantId),
        })] : undefined,
        operation: { kind: "generate" },
        onPromptCompiled: (compiled) => {
          compiledRequest = compiled;
        },
      });

      if (!isImageRequestCurrent(generationRequest)) return;
      if (!await awaitProjectWrites(generationRequest)) return;

      const currentProjectForCandidate = useProjectStore.getState().currentProject;
      const latestAsset = type === "global"
        ? useGlobalStore.getState().globalAssets.find((entry) => entry.id === assetId)
        : assetType === "character"
          ? currentProjectForCandidate?.characters.find((entry) => entry.id === assetId)
          : currentProjectForCandidate?.assets.find((entry) => entry.id === assetId);
      if (!latestAsset || !isImageRequestCurrent(generationRequest)) return;
      const latestVariants = "variants" in latestAsset ? latestAsset.variants : undefined;
      if (targetVariantId && !latestVariants?.some((variant) => variant.id === targetVariantId)) return;

      const candidate = createVisualImageCandidate({
        kind: candidateKind,
        variantId: targetVariantId,
        imageUrl,
        prompt: finalPrompt,
        modelId: useAIConfigStore.getState().routing.imageGen,
        compiledRequest,
        sourceContentHash,
      });
      const visualImageCandidates = upsertVisualImageCandidate(latestAsset.visualImageCandidates, candidate);
      if (type === "global") {
        updateGlobalAsset(assetId, { visualImageCandidates });
      } else if (assetType === "character" && currentProjectForCandidate) {
        await updateProject({
          characters: currentProjectForCandidate.characters.map((entry) => entry.id === assetId
            ? { ...entry, visualImageCandidates }
            : entry),
        }, { expectedProjectId: generationRequest.projectId || undefined });
      } else if (currentProjectForCandidate) {
        await updateProject({
          assets: currentProjectForCandidate.assets.map((entry) => entry.id === assetId
            ? { ...entry, visualImageCandidates }
            : entry),
        }, { expectedProjectId: generationRequest.projectId || undefined });
      }
      if (isImageRequestCurrent(generationRequest)) toast.success("图片候选已生成，请预览后人工采用");
    } catch (error) {
      console.error("Generate Image Error:", summarizeUnknownError(error));
      if (isImageRequestCurrent(generationRequest)) {
        toast.error("生成图片失败，请重试。");
      }
    } finally {
      if (finishImageRequest(generationRequest)) {
        if (targetVariantId) {
          setGeneratingVariantId(null);
        } else {
          setIsGeneratingBase(false);
        }
      }
    }
  };

  const handleAddVariant = () => {
    if (!newVariant.name) return;
    const variant: AssetVariant = {
      id: `var_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: newVariant.name,
      description: newVariant.description || '',
      promptModifiers: newVariant.promptModifiers || '',
    };
    handleUpdateAsset({ variants: [...variants, variant] });
    setIsAddingVariant(false);
    setNewVariant({ name: '', description: '', promptModifiers: '' });
  };

  const handleDeleteVariant = (id: string) => {
    handleUpdateAsset({ 
      variants: variants.filter((v: any) => v.id !== id),
      defaultVariantId: defaultVariantId === id ? undefined : defaultVariantId
    });
  };

  const handleUpdateVariant = (id: string, updates: Partial<AssetVariant>) => {
    handleUpdateAsset({
      variants: variants.map((v: any) => v.id === id ? { ...v, ...updates } : v)
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md z-20 py-4 -mx-6 px-6 border-b border-gray-100 dark:border-neutral-800">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl text-gray-500 dark:text-neutral-400 transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
              isCharacter ? 'bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400' : 
              (asset.type === 'location' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' : 
               asset.type === 'bgm' ? 'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' :
               'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400')
            }`}>
              {isCharacter ? <User className="w-5 h-5" /> : 
               (asset.type === 'location' ? <MapPin className="w-5 h-5" /> : 
                asset.type === 'bgm' ? <Music className="w-5 h-5" /> :
                <Box className="w-5 h-5" />)}
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">{asset.name}</h2>
              <p className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mt-0.5">
                {isCharacter ? '角色 (Character)' : 
                 (asset.type === 'location' ? '场地 (Location)' : 
                  asset.type === 'bgm' ? '背景音乐 (BGM)' :
                  '道具 (Prop)')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {type === 'project' && (
            <button 
              onClick={() => {
                if (isCharacter) {
                  handleRegenerateCharacter(asset.id, asset.name);
                } else {
                  handleRegenerateAsset(asset.id, asset.name, asset.type);
                }
              }}
              disabled={generatingCharId === asset.id || generatingAssetId === asset.id}
              className="flex items-center justify-center p-2.5 bg-bg-surface border border-border-soft/20 text-text-primary rounded-xl transition-all shadow-sm active:scale-95 group cursor-pointer hover:bg-bg-surface-soft"
              title="AI 丰满设定"
            >
              {(generatingCharId === asset.id || generatingAssetId === asset.id) ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform" />
              )}
            </button>
          )}
          <button 
            onClick={() => {
              if (type === 'global') {
                deleteGlobalAsset(assetId);
              } else if (currentProject) {
                if (isCharacter) {
                  updateProject({ characters: currentProject.characters.filter(c => c.id !== asset.id) });
                } else {
                  updateProject({ assets: currentProject.assets.filter(a => a.id !== asset.id) });
                }
              }
              onBack();
            }}
            className="p-2.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col md:flex-row gap-10">
        <div className="w-full md:w-1/3 aspect-video md:aspect-square bg-bg-surface border border-border-soft/10 rounded-2xl overflow-hidden relative group flex items-center justify-center shrink-0 shadow-sm">
          {asset.type === 'bgm' ? (
            <div className="flex flex-col items-center justify-center text-text-muted p-8 text-center w-full h-full">
              <Music className="w-16 h-16 opacity-20 mb-6" />
              <p className="text-xs font-bold uppercase tracking-widest">背景音乐资产</p>
              <input 
                type="text"
                value={baseImageUrl || ""}
                onChange={(e) => {
                  if (type === 'global') {
                    handleUpdateAsset({ imageUrls: [e.target.value] });
                  } else {
                    handleUpdateAsset({ imageUrl: e.target.value });
                  }
                }}
                placeholder="输入音频 URL..."
                className="mt-6 w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-border-soft/30 text-text-primary"
              />
            </div>
          ) : baseImageUrl ? (
            <>
              <img 
                src={baseImageUrl} 
                alt={asset.name} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform group-hover:scale-105" 
              />
              {asset.defaultReferenceUrl === baseImageUrl && (
                <div className="absolute top-4 left-4 bg-bg-surface-soft/95 text-text-primary border border-border-soft/25 text-[9px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm z-10">
                  <Sparkles className="w-3 h-3 text-text-muted" />
                  参考图
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 backdrop-blur-md">
                {asset.defaultReferenceUrl !== baseImageUrl && (
                  <button 
                    onClick={() => handleUpdateAsset({ defaultReferenceUrl: baseImageUrl })}
                    className="p-3 bg-bg-surface border border-border-soft/25 text-text-primary hover:bg-bg-surface-soft rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                    title="设为参考图"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all active:scale-95 cursor-pointer border border-white/10"
                >
                  <Upload className="w-5 h-5" />
                </button>
                <button 
                  onClick={openBaseImagePrompt}
                  className="p-3 bg-bg-surface border border-border-soft/25 text-text-primary hover:bg-bg-surface-soft rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Wand2 className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-text-muted p-8 text-center w-full h-full">
              {isGeneratingBase ? (
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="w-12 h-12 mb-4 animate-spin text-text-muted opacity-80" />
                  <span className="text-xs font-bold text-text-muted uppercase tracking-widest mt-2">正在构思形象...</span>
                </div>
              ) : (
                <>
                  <ImageIcon className="w-12 h-12 opacity-20 mb-6" />
                  <div className="flex flex-col gap-3 w-full max-w-[200px]">
                    <button 
                      onClick={openBaseImagePrompt}
                      className="w-full text-xs btn-primary px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest cursor-pointer"
                    >
                      AI 生成
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-xs bg-bg-surface border border-border-soft/20 text-text-primary px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest cursor-pointer hover:bg-bg-surface-soft"
                    >
                      本地上传
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleBaseFileUpload} accept="image/*" className="hidden" />
        </div>

        <div className="flex-1 flex flex-col gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bg-surface-soft border border-border-soft/10 rounded-xl text-text-muted">
                <Info className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-text-muted uppercase tracking-[0.15em]">资产详情</h3>
            </div>
            <div className="grid gap-6">
              <div>
                <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">名称</label>
                <input 
                  type="text" 
                  value={asset.name} 
                  onChange={(e) => handleUpdateAsset({ name: e.target.value })}
                  className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-border-soft/30 transition-all font-bold text-text-primary"
                />
              </div>

              {isCharacter ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">内在渴望 (Want/Need)</label>
                      <textarea 
                        value={asset.internalDesire || ''}
                        onChange={(e) => handleUpdateAsset({ internalDesire: e.target.value })}
                        className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 transition-all h-24 resize-none text-text-primary custom-scrollbar"
                        placeholder="他/她内心深处渴望什么？"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">外部目标 (Goal)</label>
                      <textarea 
                        value={asset.externalGoal || ''}
                        onChange={(e) => handleUpdateAsset({ externalGoal: e.target.value })}
                        className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 transition-all h-24 resize-none text-text-primary custom-scrollbar"
                        placeholder="他在本剧/本场中的行动目标..."
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">性格弱点/缺陷 (Flaw)</label>
                      <textarea 
                        value={asset.flaw || ''}
                        onChange={(e) => handleUpdateAsset({ flaw: e.target.value })}
                        className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 transition-all h-24 resize-none text-text-primary custom-scrollbar"
                        placeholder="致命缺陷或性格短板..."
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">心理画像 / 小传</label>
                      <textarea 
                        value={asset.psychologicalProfile || ''}
                        onChange={(e) => handleUpdateAsset({ psychologicalProfile: e.target.value })}
                        className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 transition-all h-24 resize-none text-text-primary custom-scrollbar"
                        placeholder="更多关于角色的成长背景、性格特征..."
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-widest">描述</label>
                  <textarea 
                    value={description || ''}
                    onChange={(e) => handleUpdateAsset({ description: e.target.value })}
                    className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 transition-all h-32 resize-none text-text-primary custom-scrollbar"
                    placeholder="输入资产描述..."
                  />
                </div>
              )}

              {/* Specific fields for locations */}
              {!isCharacter && asset.type === 'location' && (
                <div className="pt-4 border-t border-border-soft/10">
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest">全景图提示词 (Panorama Prompt)</label>
                    <button 
                      onClick={() => handleGenerateSpecificPrompt('location_panorama', asset.id)}
                      disabled={isOptimizingPrompt}
                      className="text-[10px] font-bold text-text-muted hover:text-text-primary flex items-center gap-1 uppercase tracking-widest cursor-pointer"
                    >
                      {isOptimizingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                      智能扩充
                    </button>
                  </div>
                  <DebouncedTextarea 
                    value={asset.panoramaPrompt || ''}
                    onChange={(val) => handleUpdateAsset({ panoramaPrompt: val })}
                    className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-border-soft/30 font-mono h-20 text-text-primary custom-scrollbar"
                    placeholder="描述场景的 360 度环绕细节..."
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <VisualImageCandidatePanel
        candidates={asset.visualImageCandidates}
        owner={asset}
        visualStyleLock={type === 'project' ? currentProject?.visualStyleLock : undefined}
        onAdopt={adoptImageCandidate}
        onReject={rejectImageCandidate}
      />

      {/* Visual Design Sheet / Panorama Area */}
      <div className="py-12 border-t border-gray-100 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl">
              <Camera className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                {asset.type === 'location' ? '场景全景视觉 (Panorama)' : '视觉设计底板 (Design Sheet)'}
              </h3>
              <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1 font-medium">16:9 比例的高清视觉参考</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {type === 'project' && (
              <button
                onClick={() => {
                  if (asset.type === 'location') {
                    handleGeneratePanoramaImage(asset.id);
                  } else {
                    handleGenerateAssetMultiViewImage(asset.id);
                  }
                }}
                disabled={generatingAssetId === asset.id || isGeneratingBase}
                className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 text-gray-900 dark:text-white rounded-2xl text-xs font-black transition-all shadow-sm"
              >
                {(generatingAssetId === asset.id) ? (
                  <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                ) : (
                  <Sparkles className="w-4 h-4 text-violet-600" />
                )}
                AI 生成大图
              </button>
            )}
            {asset.type === 'location' && asset.panoramaUrl && (
              <button
                onClick={() => setIsViewingPanorama(true)}
                className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black transition-all shadow-xl shadow-emerald-500/20"
              >
                <Eye className="w-4 h-4" />
                沉浸式预览
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8">
            <div className="relative aspect-video bg-gray-50 dark:bg-neutral-950 rounded-[2.5rem] overflow-hidden border border-gray-100 dark:border-neutral-800 group shadow-lg">
              {(asset.type === 'location' ? asset.panoramaUrl : asset.multiViewUrl) ? (
                <img 
                  src={asset.type === 'location' ? asset.panoramaUrl : asset.multiViewUrl} 
                  alt="Visual Preview" 
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-neutral-800 gap-4">
                  <ImageIcon className="w-20 h-20 opacity-10" />
                  <p className="text-xs font-black uppercase tracking-[0.2em] opacity-40">暂无 16:9 参考图</p>
                </div>
              )}
            </div>
          </div>
          <div className="lg:col-span-4 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest ml-1">详细视觉描述</label>
                {type === 'project' && (
                  <button 
                    onClick={() => handleGenerateSpecificPrompt(asset.type === 'location' ? 'location_panorama' : 'character_multiview', asset.id)}
                    className="text-[10px] font-black text-violet-500 hover:text-violet-600 uppercase tracking-widest transition-colors flex items-center gap-1"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    优化词
                  </button>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-neutral-950 rounded-3xl p-6 border border-gray-100 dark:border-neutral-800/50 h-[300px]">
                <DebouncedTextarea 
                  value={(asset.type === 'location' ? asset.panoramaPrompt : asset.multiViewPrompt) || ''}
                  onChange={(val) => handleUpdateAsset(asset.type === 'location' ? { panoramaPrompt: val } : { multiViewPrompt: val })}
                  className="w-full h-full bg-transparent text-xs text-gray-600 dark:text-neutral-400 focus:outline-none resize-none custom-scrollbar font-mono leading-relaxed"
                  placeholder={asset.type === 'location' ? "描述该场景的360度环绕细节、光影分布..." : "描述角色的多视角细节、服装配饰、标志性体态..."}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isViewingPanorama && asset.panoramaUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-in fade-in duration-500 p-10">
          <div className="relative w-full h-full max-w-6xl max-h-[80vh] shadow-2xl rounded-2xl overflow-hidden border border-white/10">
            <button 
              onClick={() => setIsViewingPanorama(false)}
              className="absolute top-6 right-6 z-50 p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <PanoramaViewer 
              imageUrl={asset.panoramaUrl} 
            />
          </div>
        </div>
      )}

      {/* Variants Section - Only for Project Assets or Global Assets with variants support */}
      <div className="border-t border-border-soft/10 pt-12">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bg-surface-soft border border-border-soft/10 rounded-xl text-text-muted">
                <Settings2 className="w-5 h-5" />
              </div>
              <h3 className="text-md font-bold text-text-primary tracking-tight">变体矩阵 (Lookbook Matrix)</h3>
            </div>
            <p className="text-xs text-text-muted mt-2 font-medium">管理该资产在不同场景下的状态、服装或形态变化</p>
          </div>
          <button
            onClick={() => setIsAddingVariant(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-surface border border-border-soft/20 text-text-primary rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer hover:bg-bg-surface-soft"
          >
            <Plus className="w-3.5 h-3.5" />
            添加新状态
          </button>
        </div>

        {isAddingVariant && (
          <div className="bg-bg-surface border border-border-soft/20 rounded-2xl p-6 mb-10 flex flex-col gap-6 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-[0.15em]">状态名称 *</label>
                <input
                  type="text"
                  value={newVariant.name}
                  onChange={(e) => setNewVariant({ ...newVariant, name: e.target.value })}
                  className="w-full bg-bg-surface-soft border border-border-soft/20 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-border-soft/60 transition-all text-text-primary font-bold"
                  placeholder="如：战损版、晚礼服"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-text-muted mb-2 uppercase tracking-[0.15em]">状态描述</label>
                <input
                  type="text"
                  value={newVariant.description}
                  onChange={(e) => setNewVariant({ ...newVariant, description: e.target.value })}
                  className="w-full bg-bg-surface-soft border border-border-soft/20 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-border-soft/60 transition-all text-text-primary"
                  placeholder="描述该状态的具体表现"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsAddingVariant(false)} className="px-4 py-2 text-xs font-bold text-text-muted hover:text-text-primary transition-all uppercase tracking-widest cursor-pointer">
                取消
              </button>
              <button onClick={handleAddVariant} disabled={!newVariant.name} className="px-6 py-2.5 text-xs btn-primary rounded-xl cursor-pointer">
                保存变体
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          {variants.map((variant: any) => (
            <div key={variant.id} className="bg-bg-surface border border-border-soft/15 rounded-2xl overflow-hidden flex flex-col group hover:bg-bg-surface-soft/80 transition-all cursor-pointer shadow-sm">
              <div className="aspect-video bg-bg-surface-soft relative flex items-center justify-center border-b border-border-soft/10 overflow-hidden">
                {variant.imageUrl ? (
                  <>
                    <img 
                      src={variant.imageUrl} 
                      alt={variant.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105" 
                    />
                    {asset.defaultReferenceUrl === variant.imageUrl && (
                      <div className="absolute top-4 left-4 bg-bg-surface-soft/95 text-text-primary border border-border-soft/25 text-[9px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm z-10">
                        <Sparkles className="w-3 h-3 text-text-muted" />
                        参考图
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 backdrop-blur-md">
                      {asset.defaultReferenceUrl !== variant.imageUrl && (
                        <button 
                          onClick={() => handleUpdateAsset({ defaultReferenceUrl: variant.imageUrl })}
                          className="p-3 bg-bg-surface border border-border-soft/25 text-text-primary hover:bg-bg-surface-soft rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                          title="设为参考图"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                      )}
                      <button 
                        onClick={() => { setActiveVariantId(variant.id); variantFileInputRef.current?.click(); }}
                        className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all active:scale-95 cursor-pointer border border-white/10"
                      >
                        <Upload className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => openVariantImagePrompt(variant)}
                        className="p-3 bg-bg-surface border border-border-soft/25 text-text-primary hover:bg-bg-surface-soft rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                      >
                        <Wand2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-text-muted p-8 text-center w-full h-full">
                    {generatingVariantId === variant.id ? (
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-10 h-10 mb-3 animate-spin text-text-muted opacity-80" />
                        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">正在生成...</span>
                      </div>
                    ) : (
                      <div className="flex gap-2.5">
                        <button 
                          onClick={() => openVariantImagePrompt(variant)}
                          className="text-[10px] font-bold btn-primary px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 uppercase tracking-widest cursor-pointer"
                        >
                          <Wand2 className="w-4 h-4" /> 生成
                        </button>
                        <button 
                          onClick={() => { setActiveVariantId(variant.id); variantFileInputRef.current?.click(); }}
                          className="text-[10px] font-bold bg-bg-surface border border-border-soft/20 text-text-primary px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 uppercase tracking-widest cursor-pointer hover:bg-bg-surface-soft"
                        >
                          <Upload className="w-4 h-4" /> 上传
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="p-4 flex flex-col gap-3 flex-1 bg-bg-surface">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={variant.name}
                      onChange={(e) => handleUpdateVariant(variant.id, { name: e.target.value })}
                      className="font-bold text-text-primary bg-transparent border-none p-0 focus:ring-0 w-full text-md tracking-tight focus:outline-none"
                    />
                    <input
                      type="text"
                      value={variant.description}
                      onChange={(e) => handleUpdateVariant(variant.id, { description: e.target.value })}
                      placeholder="状态描述..."
                      className="text-xs text-text-secondary bg-transparent border-none p-0 focus:ring-0 w-full mt-1 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => handleDeleteVariant(variant.id)}
                    className="text-text-muted hover:text-red-500 transition-all shrink-0 p-2 hover:bg-red-500/10 rounded-xl cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                <button
                  onClick={() => handleUpdateAsset({ defaultVariantId: defaultVariantId === variant.id ? undefined : variant.id })}
                  className={`mt-2 flex items-center justify-center gap-2 text-[10px] font-bold px-4 py-2.5 rounded-xl transition-all w-full border uppercase tracking-widest cursor-pointer ${
                    defaultVariantId === variant.id 
                      ? 'btn-primary text-text-primary' 
                      : 'bg-bg-surface border-border-soft/20 text-text-muted hover:text-text-primary hover:bg-bg-surface-soft shadow-sm'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  {defaultVariantId === variant.id ? '已设为参考' : '设为参考图'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ImagePromptModal
        isOpen={promptModalState.isOpen}
        onClose={() => setPromptModalState(prev => ({ ...prev, isOpen: false }))}
        initialPrompt={promptModalState.initialPrompt}
        onConfirm={handleGenerateImageConfirm}
        title={promptModalState.targetVariantId ? "生成变体参考候选" : "生成基础参考候选"}
      />
      
      <PromptEditorModal
        isOpen={aiPromptModal.isOpen}
        onClose={closePromptModal}
        templateId={aiPromptModal.templateId}
        variables={aiPromptModal.variables}
        contextOptions={aiPromptModal.contextOptions}
        defaultSelectedContextIds={aiPromptModal.defaultSelectedContextIds}
        onConfirm={aiPromptModal.onConfirm}
      />

      <input type="file" ref={variantFileInputRef} onChange={handleVariantFileUpload} accept="image/*" className="hidden" />
    </div>
  );
}
