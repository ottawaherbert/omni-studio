import React, { useRef, useState } from "react";
import { ImageIcon, Video, Loader2, RefreshCw, UserPlus, BoxSelect, X, Trash2, RotateCcw, Upload } from "lucide-react";
import { Shot, Asset, Project, Character } from "../clients/domainTypes";
import { AssetReferenceSelector } from "./ui/AssetReferenceSelector";
import { useProjectStore } from "../clients/stateClient";
import LinkAssetModal from "./LinkAssetModal";
import { resolveSceneReadModel } from "../utils/sceneReadModel";
import type { ManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";

interface StudioShotControlsProps {
  selectedShot: Shot;
  currentProject: Project;
  boundAssets: (Asset | Character)[];
  manualProductionAssetReadModel?: ManualProductionAssetReadModel | null;
  generationGate?: { ready: boolean; label: string; reason: string };
  videoGenerationIssue?: string;
  promptReadOnly?: boolean;
  videoPromptValue?: string;
  videoPromptSourceLabel?: string;
  videoPromptDirty?: boolean;
  onVideoPromptChange?: (value: string) => void;
  onResetVideoPrompt?: () => void;
  generationTargetLabel?: string;
  isGeneratingImage: boolean;
  isGeneratingVideo: boolean;
  isGeneratingDraftImage?: boolean;
  isImportingMedia?: boolean;
  hasVideoCandidate?: boolean;
  draftPreviewUsable?: boolean;
  onGenerateImage: () => void;
  onGenerateVideo: () => void;
  onExternalVideo?: () => void;
  onGenerateDraftImage?: () => void;
  onImportImage?: (file: File) => void;
  onImportVideo?: (file: File) => void;
}

export const StudioShotControls: React.FC<StudioShotControlsProps> = ({
  selectedShot,
  currentProject,
  boundAssets,
  manualProductionAssetReadModel,
  generationGate,
  videoGenerationIssue,
  promptReadOnly = false,
  videoPromptValue,
  videoPromptSourceLabel,
  videoPromptDirty = false,
  onVideoPromptChange,
  onResetVideoPrompt,
  generationTargetLabel,
  isGeneratingImage,
  isGeneratingVideo,
  isGeneratingDraftImage = false,
  isImportingMedia = false,
  hasVideoCandidate = false,
  draftPreviewUsable = false,
  onGenerateImage,
  onGenerateVideo,
  onExternalVideo,
  onGenerateDraftImage,
  onImportImage,
  onImportVideo,
}) => {
  const { updateScene, activeEpisodeId } = useProjectStore();
  const [selectorAsset, setSelectorAsset] = useState<Asset | Character | null>(null);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState<'image' | 'video'>(promptReadOnly ? 'video' : 'image');
  const imageImportRef = useRef<HTMLInputElement>(null);
  const videoImportRef = useRef<HTMLInputElement>(null);
  const formalGenerationReady = !generationGate || generationGate.ready;
  const governedProductionMode = Boolean(manualProductionAssetReadModel);
  const videoInputReady = governedProductionMode || Boolean(selectedShot.imageUrl);
  const videoGenerationReady = formalGenerationReady && !videoGenerationIssue;

  const getActiveScene = () => {
    const latestProject = useProjectStore.getState().currentProject;
    const latestActiveEpisode = useProjectStore.getState().activeEpisode;
    const readModel = resolveSceneReadModel(latestProject, latestActiveEpisode);
    return readModel.scenes.find(s => 
      s.shots?.some(shot => shot.id === selectedShot.id)
    );
  };

  const handleOverrideReference = (assetId: string, url: string) => {
    const newOverrides = { ...(selectedShot.assetOverrides || {}) };
    if (url === '') {
      delete newOverrides[assetId];
    } else {
      newOverrides[assetId] = url;
    }
    
    // Find the active scene that contains this shot
    const activeScene = getActiveScene();
    
    if (activeScene) {
      const updatedShots = activeScene.shots?.map(s => 
        s.id === selectedShot.id ? { ...s, assetOverrides: newOverrides } : s
      );
      updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId || undefined);
    }
  };

  const handleLinkAsset = (assetId: string) => {
    if (!activeEpisodeId) return;
    
    // Find the asset to determine its type
    const character = currentProject.characters.find(c => c.id === assetId);
    const asset = currentProject.assets.find(a => a.id === assetId);
    
    const activeScene = getActiveScene();
    
    if (!activeScene) return;

    const newShot = { ...selectedShot };
    if (character) {
      if (!newShot.characterIdsInShot) newShot.characterIdsInShot = [];
      if (!newShot.characterIdsInShot.includes(assetId)) {
        newShot.characterIdsInShot = [...newShot.characterIdsInShot, assetId];
      }
    } else if (asset) {
      if (asset.type === 'location') {
        newShot.locationId = assetId;
      } else {
        if (!newShot.propIds) newShot.propIds = [];
        if (!newShot.propIds.includes(assetId)) {
          newShot.propIds = [...newShot.propIds, assetId];
        }
      }
    }

    const updatedShots = activeScene.shots?.map(s => 
      s.id === selectedShot.id ? newShot : s
    );
    updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
  };

  const handleUnlinkAsset = (e: React.MouseEvent, assetId: string) => {
    e.stopPropagation();
    if (!activeEpisodeId) return;
    
    const activeScene = getActiveScene();
    
    if (!activeScene) return;

    const newShot = { ...selectedShot };
    if (newShot.characterIdsInShot?.includes(assetId)) {
      newShot.characterIdsInShot = newShot.characterIdsInShot.filter(id => id !== assetId);
    } else if (newShot.locationId === assetId) {
      newShot.locationId = undefined;
    } else if (newShot.propIds?.includes(assetId)) {
      newShot.propIds = newShot.propIds.filter(id => id !== assetId);
    }

    const updatedShots = activeScene.shots?.map(s => 
      s.id === selectedShot.id ? newShot : s
    );
    updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
  };

  return (
    <div className="space-y-8">
      {manualProductionAssetReadModel && (
        <div className="border-t border-gray-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-gray-700 dark:text-neutral-200">生成准备</p>
            <span className={`text-xs font-medium ${videoGenerationReady ? "text-emerald-600" : "text-amber-600"}`}>{videoGenerationReady ? "可提交" : "缺少生成条件"}</span>
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-neutral-300">{videoGenerationIssue || generationGate?.label || (formalGenerationReady ? "参考图与镜头信息完整" : "参考图或镜头信息尚未完成")}</p>
        </div>
      )}

      {generationTargetLabel && <p className="rounded-md bg-violet-50 px-3 py-2 text-[10px] font-bold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{generationTargetLabel}</p>}

      {!governedProductionMode && selectorAsset && (
        <AssetReferenceSelector
          asset={selectorAsset}
          currentOverrideUrl={selectedShot.assetOverrides?.[selectorAsset.id]}
          onSelect={(url) => handleOverrideReference(selectorAsset.id, url)}
          onClose={() => setSelectorAsset(null)}
        />
      )}

      {!governedProductionMode && isLinkModalOpen && (
        <LinkAssetModal
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          onLink={handleLinkAsset}
        />
      )}

      {!governedProductionMode && (boundAssets.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2.5 text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em]">
              <div className="w-6 h-6 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center shadow-sm">
                <ImageIcon className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              </div>
              已绑定资产参考图
            </label>
            {!governedProductionMode && <button
              onClick={() => setIsLinkModalOpen(true)}
              className="px-2 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[10px] font-black text-violet-600 dark:text-violet-400 flex items-center gap-1.5 uppercase tracking-widest transition-all"
            >
              <UserPlus className="w-3 h-3" />
              追加
            </button>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {boundAssets.map(asset => {
              const overrideUrl = governedProductionMode ? undefined : selectedShot.assetOverrides?.[asset.id];
              const governedReference = manualProductionAssetReadModel?.assetReferencePack?.items.find((item) => item.assetId === asset.id);
              const defaultUrl = asset.defaultReferenceUrl;
              const baseImageUrl = 'imageUrl' in asset ? (asset as Asset).imageUrl : (asset as Character).referenceImageUrl;
              const multiViewUrl = asset.multiViewUrl;
              const panoramaUrl = 'panoramaUrl' in asset ? (asset as Asset).panoramaUrl : undefined;
              
              // Find first available variant image if no other image is found
              let firstVariantUrl = undefined;
              if (!manualProductionAssetReadModel && asset.variants && asset.variants.length > 0) {
                const variantWithImage = asset.variants.find(v => v.imageUrl);
                if (variantWithImage) {
                  firstVariantUrl = variantWithImage.imageUrl;
                }
              }

              const fallbackUrl = baseImageUrl || multiViewUrl || panoramaUrl || firstVariantUrl;
              const imageUrl = overrideUrl || governedReference?.referenceImageUrl || defaultUrl || fallbackUrl;

              return (
                <div 
                  key={asset.id} 
                  className="relative group rounded-[2rem] overflow-hidden bg-gray-100 dark:bg-neutral-800 aspect-square border border-gray-100 dark:border-neutral-700 shadow-sm transition-all hover:shadow-xl hover:border-violet-500 dark:hover:border-violet-500 cursor-pointer"
                >
                  {/* Unlink Button (Delete from Shot) */}
                  {!governedProductionMode && <button
                    onClick={(e) => handleUnlinkAsset(e, asset.id)}
                    className="absolute top-2 right-2 z-20 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg backdrop-blur-sm md:opacity-0 group-hover:opacity-100 transition-all active:scale-95"
                    title="解绑资产"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>}

                  {!governedProductionMode && <div className="absolute top-2 left-2 right-8 z-30 md:opacity-0 group-hover:opacity-100 transition-all">
                    {asset.variants && asset.variants.length > 0 && (
                      <select
                        value={asset.variants.find((v:any) => v.imageUrl === overrideUrl)?.id || governedReference?.variantId || asset.defaultVariantId || ""}
                        onChange={(e) => {
                          e.stopPropagation();
                          const vId = e.target.value;
                          const vUrl = asset.variants?.find((v: any) => v.id === vId)?.imageUrl;
                          if (vId === "") {
                             handleOverrideReference(asset.id, '');
                          } else if (vUrl) {
                             handleOverrideReference(asset.id, vUrl);
                          } else {
                             handleOverrideReference(asset.id, '');
                          }
                        }}
                        className="w-full text-[10px] bg-black/60 hover:bg-black/80 text-white rounded p-1 border border-white/20 outline-none backdrop-blur-md cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">默认形态</option>
                        {asset.variants.map((v: any) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    )}
                  </div>}

                  {/* Clear Override Button */}
                  {overrideUrl && (!asset.variants || !asset.variants.find((v:any) => v.imageUrl === overrideUrl)) && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleOverrideReference(asset.id, ''); }}
                      className="absolute bottom-2 left-2 z-20 p-1.5 bg-violet-600/80 hover:bg-violet-600 text-white rounded-lg backdrop-blur-sm md:opacity-0 group-hover:opacity-100 transition-all active:scale-95"
                      title="清除镜头自定义指定"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}

                  <div className="w-full h-full" onClick={() => { if (!governedProductionMode) setSelectorAsset(asset); }}>
                    {imageUrl ? (
                      <>
                        <img 
                          src={imageUrl} 
                          alt={asset.name} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                          referrerPolicy="no-referrer" 
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                          <div className="bg-white/20 p-3 rounded-full text-white backdrop-blur-md">
                            <RefreshCw className="w-5 h-5" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-neutral-500 text-[10px] p-4 text-center font-black uppercase tracking-widest gap-2">
                        <ImageIcon className="w-6 h-6 opacity-50" />
                        无参考图
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-[10px] text-white truncate text-center font-black uppercase tracking-widest backdrop-blur-md border-t border-white/10">
                      {asset.name}{governedReference?.variantId ? ` / ${asset.variants?.find((variant) => variant.id === governedReference.variantId)?.name || governedReference.variantId}` : ""}
                    </div>
                    {overrideUrl && (
                      <div className="absolute bottom-11 left-3 bg-violet-500 text-white text-[8px] font-black px-2 py-1 rounded-full shadow-sm z-10">
                        镜头指定
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-[2rem] p-6 text-center shadow-inner">
           <div className="w-12 h-12 bg-white dark:bg-neutral-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-gray-100 dark:border-neutral-800 shadow-sm">
              <BoxSelect className="w-6 h-6 text-gray-300 dark:text-neutral-600" />
           </div>
           <h4 className="text-[10px] font-black text-gray-900 dark:text-white mb-2 uppercase tracking-widest">未绑定资产</h4>
           <p className="text-[10px] text-gray-400 dark:text-neutral-500 mb-4 font-bold">关联资产库中的模型，使 AI 生成更具一致性</p>
           {!governedProductionMode && <button
             onClick={() => setIsLinkModalOpen(true)}
             className="px-4 py-2 bg-white hover:bg-gray-50 text-violet-600 dark:bg-neutral-900 dark:hover:bg-neutral-800 border border-gray-100 dark:border-neutral-800 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 shadow-sm"
           >
             立即关联资产
           </button>}
        </div>
      ))}

      <div>
        <div className="flex bg-gray-100 dark:bg-neutral-800 p-1 rounded-2xl mb-4">
          <button
            onClick={() => setActivePromptTab('image')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${
              activePromptTab === 'image'
                ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            画面提示词
          </button>
          <button
            onClick={() => setActivePromptTab('video')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${
              activePromptTab === 'video'
                ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            视频提示词
          </button>
        </div>

        {activePromptTab === 'image' ? (
          <div>
            <textarea
              value={selectedShot.imagePrompt || ""}
              readOnly={promptReadOnly}
              onChange={(e) => {
                if (promptReadOnly) return;
                const activeScene = getActiveScene();
                if (activeScene && activeEpisodeId) {
                  const updatedShots = activeScene.shots?.map(s => 
                    s.id === selectedShot.id ? { ...s, imagePrompt: e.target.value } : s
                  );
                  updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
                }
              }}
              className="w-full h-40 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-[2rem] p-6 text-xs text-gray-700 dark:text-neutral-300 font-black resize-none focus:outline-none focus:ring-4 focus:ring-violet-500/5 focus:border-violet-500/30 custom-scrollbar shadow-inner leading-relaxed transition-all"
              title={promptReadOnly ? "当前生成对象提示词只读；请在生成前的提示词弹窗中修改" : "基础画面提示词（生成时会自动注入资产描述和全局参数）"}
            />
            <button
              onClick={onGenerateImage}
              disabled={isGeneratingImage || !formalGenerationReady}
              title={formalGenerationReady ? "生成图片" : generationGate?.reason || "请先添加当前场的镜头"}
              className="mt-4 w-full flex items-center justify-center gap-3 px-6 py-4 bg-white hover:bg-gray-50 text-gray-900 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-white border border-gray-200 dark:border-neutral-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50 group"
            >
              {isGeneratingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4 text-violet-600 group-hover:scale-110 transition-transform" />}
              验证并生成图片
            </button>
            {onImportImage && (
              <>
                <input ref={imageImportRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportImage(file); event.currentTarget.value = ""; }} />
                <button type="button" onClick={() => imageImportRef.current?.click()} disabled={isImportingMedia} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border-soft/40 px-4 py-3 text-xs font-bold text-text-secondary hover:bg-bg-surface-hover disabled:opacity-50">
                  {isImportingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}导入图片方案
                </button>
              </>
            )}
            {!formalGenerationReady && onGenerateDraftImage && (
              <div className="mt-3 border border-amber-500/20 bg-amber-500/5 p-3 rounded-xl">
                {selectedShot.draftPreview?.imageUrl && (
                  <img
                    src={selectedShot.draftPreview.imageUrl}
                    alt="当前镜头方向预览"
                    className="mb-3 aspect-video w-full rounded-lg border border-border-soft/20 object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={onGenerateDraftImage}
                  disabled={isGeneratingDraftImage}
                  className="w-full flex items-center justify-center gap-2 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-700 hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-300 rounded-lg transition-colors"
                >
                  {isGeneratingDraftImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  {selectedShot.draftPreview ? "重新预览这个镜头" : "预览这个镜头"}
                </button>
                <p className="mt-2 text-[10px] leading-4 text-text-muted">
                  仅查看画面方向，不会加入正式镜头方案，也不会跳过制片确认。
                </p>
              </div>
            )}
            {formalGenerationReady && selectedShot.draftPreview?.imageUrl && (
              <div className={`mt-3 flex items-center gap-3 border p-3 rounded-xl ${
                draftPreviewUsable
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-border-soft/30 bg-bg-surface-soft"
              }`}>
                <img
                  src={selectedShot.draftPreview.imageUrl}
                  alt="镜头方向预览参考"
                  className="h-14 w-24 shrink-0 rounded-lg border border-border-soft/20 object-cover"
                />
                <p className="text-[10px] leading-4 text-text-muted">
                  {draftPreviewUsable
                    ? "正式生成时会把这张图作为构图方向参考，但仍会生成新的正式方案，不会直接采用预览图。"
                    : "镜头方案已经变化，这张旧预览只供对照，不会带入正式生成。"}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            {(videoPromptSourceLabel || onResetVideoPrompt) && (
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <p className="text-[10px] font-bold text-gray-500">{videoPromptSourceLabel || "本次视频提示词"}{videoPromptDirty ? " · 已在摄影棚修改" : ""}</p>
                {onResetVideoPrompt && <button type="button" onClick={onResetVideoPrompt} disabled={!videoPromptDirty} className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />恢复上游版本</button>}
              </div>
            )}
            <textarea
              value={videoPromptValue ?? selectedShot.videoPrompt ?? ""}
              readOnly={!onVideoPromptChange && promptReadOnly}
              onChange={(e) => {
                if (onVideoPromptChange) {
                  onVideoPromptChange(e.target.value);
                  return;
                }
                if (promptReadOnly) return;
                const activeScene = getActiveScene();
                if (activeScene && activeEpisodeId) {
                  const updatedShots = activeScene.shots?.map(s => 
                    s.id === selectedShot.id ? { ...s, videoPrompt: e.target.value } : s
                  );
                  updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
                }
              }}
              className="w-full h-40 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-[2rem] p-6 text-xs text-gray-700 dark:text-neutral-300 font-black resize-none focus:outline-none focus:ring-4 focus:ring-violet-500/5 focus:border-violet-500/30 custom-scrollbar shadow-inner leading-relaxed transition-all"
              title={onVideoPromptChange ? "本次 Take 的工作草稿，不会覆盖分镜或故事板中的上游提示词" : promptReadOnly ? "当前生成对象提示词只读" : "基础视频提示词（生成时会自动注入资产描述和全局参数）"}
            />
            {onExternalVideo && <button type="button" onClick={onExternalVideo} disabled={isGeneratingVideo || isImportingMedia} className="w-full rounded-lg border border-border-soft px-3 py-2 text-xs font-bold text-text-primary">复制提示词 / 外部视频</button>}
            <button
              onClick={onGenerateVideo}
              disabled={isGeneratingVideo || !videoInputReady || !videoGenerationReady}
              title={videoGenerationIssue || (!videoInputReady ? "请先生成或选择首帧图片" : formalGenerationReady ? "打开生成前确认" : generationGate?.reason || "请选择生成对象")}
              className="mt-4 w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-black text-white dark:bg-violet-600 dark:hover:bg-violet-500 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-gray-500/20 active:scale-95 disabled:opacity-50 group"
            >
              {isGeneratingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4 group-hover:scale-110 transition-transform" />}
              {hasVideoCandidate ? "再生成一个候选视频" : "验证并生成视频"}
            </button>
            {onImportVideo && (
              <>
                <input ref={videoImportRef} type="file" accept="video/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportVideo(file); event.currentTarget.value = ""; }} />
                <button type="button" onClick={() => videoImportRef.current?.click()} disabled={isImportingMedia} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border-soft/40 px-4 py-3 text-xs font-bold text-text-secondary hover:bg-bg-surface-hover disabled:opacity-50">
                  {isImportingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}导入视频
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
