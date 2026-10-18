import { ShotExecutionEditor } from "../production/ShotExecutionEditor";
import { validateDirectorShotEdits, reconcileDirectorAudioEdits } from "../../clients/creativeDirectionClient";
import { ProductionCreativeControls } from "../production/ProductionCreativeControls";
import { appearanceContentHash } from "../../clients/productionStoryboardWorkflowClient";
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { 
  Camera, 
  Trash2, 
  Wand2, 
  Box,
  Sparkles,
  Plus,
  Minus,
  Edit2,
  Maximize2,
  Minimize2,
  Loader2,
  Upload,
  Check,
  X,
  FileImage,
  Video,
  Square,
  CheckSquare2,
} from 'lucide-react';
import { Shot, Scene } from '../../clients/domainTypes';
import { adoptShotTake, appendShotTakeCandidate } from '../../clients/productionMediaReviewClient';
import { SpatialModal } from '../spatial/SpatialModal';
import { useSpatialStore } from '../../clients/stateClient';
import { flushDebouncedProjectSave, useProjectStore } from '../../clients/stateClient';
import {
  canRebaseManualStoryboardAuthorEdit,
  rebaseManualStoryboardAfterAuthorEdit,
  mergeShotAuthorDraft,
} from '../../clients/productionStoryboardWorkflowClient';
import { persistProjectMediaUrl } from '../../clients/projectMediaClient';
import { createMediaAssetReference } from '../../utils/mediaProvenance';

const takeHasImage = (take: NonNullable<Shot['takes']>[number]) => Boolean(take.imageUrl);

interface ShotCardProps {
  shot: Shot;
  index: number;
  activeScene: Scene;
  activeEpisodeId: string;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId: string) => void | Promise<void>;
  storyboardSourceHash?: string;
  onReroll: (shotId: string) => void;
  onGenerateImagePrompt: (shotId: string) => void;
  onGenerateVideoPrompt: (shotId: string) => void;
  onGenerateSpatial: (shot: Shot) => void;
  aiGenerationBlockedReason?: string;
  isGeneratingImage?: boolean;
  promptGenerationBusy?: boolean;
  generatingPromptKind?: "image" | "video";
  selected?: boolean;
  onSelect?: (shotId: string) => void;
  batchSelected?: boolean;
  onToggleBatchSelection?: (shotId: string) => void;
}

export const ShotCard: React.FC<ShotCardProps> = ({
  shot,
  index,
  activeScene,
  activeEpisodeId,
  updateScene,
  storyboardSourceHash,
  onReroll,
  onGenerateImagePrompt,
  onGenerateVideoPrompt,
  onGenerateSpatial,
  aiGenerationBlockedReason,
  isGeneratingImage = false,
  promptGenerationBusy = false,
  generatingPromptKind,
  selected = false,
  onSelect,
  batchSelected = false,
  onToggleBatchSelection,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingData, setEditingData] = useState<Partial<Shot>>({});
  const originalEditShot = useRef<Shot>(shot);
  const [isSpatialModalOpen, setIsSpatialModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [pendingTakeDeletionId, setPendingTakeDeletionId] = useState<string | null>(null);
  const [previewTakeId, setPreviewTakeId] = useState<string | null>(null);
  const [fullscreenInfoScale, setFullscreenInfoScale] = useState(1);
  const fullscreenInfoViewportRef = useRef<HTMLDivElement>(null);
  const fullscreenInfoContentRef = useRef<HTMLDivElement>(null);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const currentProject = useProjectStore(state => state.currentProject);
  const clearEntities = useSpatialStore(state => state.clearEntities);
  const addEntity = useSpatialStore(state => state.addEntity);
  const imageTakes = (shot.takes || []).filter(takeHasImage);
  const activeImageTakeId = imageTakes.some((take) => take.id === shot.activeTakeId)
    ? shot.activeTakeId
    : imageTakes.find((take) => take.imageUrl === shot.imageUrl)?.id;
  const previewTake = imageTakes.find((take) => take.id === previewTakeId);
  const previewImageUrl = previewTake?.imageUrl || shot.imageUrl;
  const previewingCandidate = Boolean(previewTake && previewTake.id !== activeImageTakeId);
  const availableVisualLayers = Array.isArray(currentProject?.visualStyleLock?.mediumAssignments)
    ? currentProject.visualStyleLock.mediumAssignments.flatMap((assignment) => (
        assignment?.target?.scope === "layer" && assignment.target.layerId.trim()
          ? [{ id: assignment.target.layerId, label: assignment.target.label || assignment.target.layerId }]
          : []
      )).filter((layer, layerIndex, layers) => layers.findIndex((candidate) => candidate.id === layer.id) === layerIndex)
    : [];

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const wasAppRootInert = appRoot?.inert || false;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = wasAppRootInert;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useLayoutEffect(() => {
    if (!isFullscreen || isEditing) {
      setFullscreenInfoScale(1);
      return;
    }
    const viewport = fullscreenInfoViewportRef.current;
    const content = fullscreenInfoContentRef.current;
    if (!viewport || !content) return;

    let frameId = 0;
    const fitInformation = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const availableHeight = content.clientHeight;
        const naturalHeight = content.scrollHeight;
        const nextScale = naturalHeight > availableHeight && naturalHeight > 0
          ? Math.max(0.01, availableHeight / naturalHeight)
          : 1;
        setFullscreenInfoScale((current) => Math.abs(current - nextScale) < 0.005 ? current : nextScale);
      });
    };

    const observer = new ResizeObserver(fitInformation);
    observer.observe(viewport);
    observer.observe(content);
    fitInformation();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [activeScene.audioTracks, isEditing, isFullscreen, shot]);

  const handleOpenSpatial = () => {
    clearEntities();
    
    if (shot.compositionData && shot.compositionData.entities) {
      // Load from saved composition data
      shot.compositionData.entities.forEach(entity => {
        // Prevent location from being added as an entity
        if (entity.id === shot.locationId) return;

        let label = '';
        let model3dUrl = undefined;
        if (entity.type === 'character') {
          const char = currentProject?.characters.find(c => c.id === entity.id);
          label = char?.name || '';
          model3dUrl = char?.model3dUrl;
        } else if (entity.type === 'prop') {
          const prop = currentProject?.assets.find(a => a.id === entity.id);
          label = prop?.name || '';
          model3dUrl = prop?.model3dUrl;
        }
        
        if (label) {
          addEntity({
            id: entity.id,
            type: entity.type,
            position: (entity.position as [number, number, number]) || [0, 0, 0],
            rotation: [0, entity.rotationY || 0, 0],
            scale: (entity.scale as [number, number, number]) || [1, 1, 1],
            label,
            model3dUrl
          });
        }
      });
    } else {
      // Smart Initialization: Add characters to 3D stage
      if (shot.characterIdsInShot && currentProject && currentProject.characters) {
        let xOffset = -1;
        shot.characterIdsInShot.forEach((charId) => {
          const character = currentProject.characters.find(c => c.id === charId);
          if (character) {
            addEntity({
              id: charId,
              type: 'character',
              position: [xOffset, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              label: character.name,
              model3dUrl: character.model3dUrl
            });
            xOffset += 2; // Space them out
          }
        });
      }

      // Add props to 3D stage
      if (shot.propIds && currentProject && currentProject.assets) {
        let xOffset = -1;
        shot.propIds.forEach((propId) => {
          const prop = currentProject.assets.find(a => a.id === propId);
          if (prop) {
            addEntity({
              id: propId,
              type: 'prop',
              position: [xOffset, 0, -2], // Place props slightly behind characters
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              label: prop.name,
              model3dUrl: prop.model3dUrl
            });
            xOffset += 2;
          }
        });
      }
    }
    
    setIsSpatialModalOpen(true);
  };

  const persistAuthorShotChanges = (
    newShots: Shot[],
    confirmations: { shotPlan?: boolean; imagePrompts?: boolean; videoPrompts?: boolean },
    extraUpdates: Partial<Scene> = {},
    baseScene = activeScene,
  ) => {
    const live = useProjectStore.getState();
    if (!currentProject || live.currentProject?.id !== currentProject.id || live.activeEpisode?.id !== activeEpisodeId) throw new Error("当前项目或分集已切换，请返回原镜头保存。");
    const canRebaseAuthorEdit = canRebaseManualStoryboardAuthorEdit(
      baseScene.manualStoryboard,
      storyboardSourceHash,
    );
    const manualStoryboard = canRebaseAuthorEdit && storyboardSourceHash
      ? rebaseManualStoryboardAfterAuthorEdit({
          workspace: baseScene.manualStoryboard,
          shots: newShots,
          sourceHash: storyboardSourceHash,
          confirmShotPlan: Boolean(confirmations.shotPlan),
          confirmImagePrompts: Boolean(confirmations.imagePrompts),
          confirmVideoPrompts: Boolean(confirmations.videoPrompts),
        })
      : baseScene.manualStoryboard;
    return updateScene(activeScene.id, {
      ...extraUpdates,
      shots: newShots,
      audioTracks: reconcileDirectorAudioEdits(baseScene.shots || [], newShots, extraUpdates.audioTracks ?? baseScene.audioTracks ?? []),
      ...(manualStoryboard ? { manualStoryboard } : {}),
    }, activeEpisodeId);
  };

  const handleSave = async () => {
    const latestScene = useProjectStore.getState().activeEpisode?.scenes.find(scene => scene.id === activeScene.id);
    const currentShot = latestScene?.shots?.find(item => item.id === shot.id);
    if (!currentShot || !latestScene) { toast.error("镜头已不存在，草稿仍保留。"); return; }
    let merged: ReturnType<typeof mergeShotAuthorDraft>;
    try { merged = mergeShotAuthorDraft(originalEditShot.current, editingData, currentShot); }
    catch (error) { toast.error(error instanceof Error ? error.message : "镜头已变化，草稿仍保留。"); return; }
    const { changedKeys } = merged;
    const newShots = latestScene.shots!.map(s => s.id === shot.id ? {
      ...merged.shot,
      ...(changedKeys.includes('imagePrompt') ? { imagePromptAppearanceHash: appearanceContentHash(merged.shot, 'image') } : {}),
      ...(changedKeys.includes('videoPrompt') ? { videoPromptAppearanceHash: appearanceContentHash(merged.shot, 'video') } : {}),
    } : s);
    if (changedKeys.some(key => key === 'duration' || key === 'directing' || key === 'dialogueLines')) {
      const directionIssues = validateDirectorShotEdits(newShots, { previous: latestScene.shots || [], tracks: latestScene.audioTracks || [] });
      if (directionIssues.length) { toast.error(directionIssues[0]); return; }
    }
    if (isSaving || !currentProject) return;
    setIsSaving(true);
    try { await persistAuthorShotChanges(newShots, {
      shotPlan: changedKeys.some((key) => key !== 'imagePrompt' && key !== 'videoPrompt' && key !== 'visualSummary'),
      imagePrompts: changedKeys.includes('imagePrompt') || changedKeys.includes('visualSummary'),
      videoPrompts: changedKeys.includes('videoPrompt'),
    }, {}, latestScene);
    await flushDebouncedProjectSave(currentProject.id);
    setIsEditing(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败，修改仍保留在编辑器中。"); }
    finally { setIsSaving(false); }
  };

  const handleSelectTake = (takeId: string) => {
    const takeIndex = imageTakes.findIndex((take) => take.id === takeId);
    if (takeIndex < 0) return;
    const updatedShots = activeScene.shots!.map((item) => item.id === shot.id
      ? adoptShotTake(item, takeId, 'image')
      : item);

    updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
    setPreviewTakeId(null);
    setPendingTakeDeletionId(null);
    if (takeIndex >= 0) toast.success(`已将 V${takeIndex + 1} 设为当前画面。`);
  };

  const handleDeleteTake = (takeId: string) => {
    const takes = shot.takes || [];
    const takeIndex = imageTakes.findIndex((take) => take.id === takeId);
    const currentTakeId = activeImageTakeId;
    if (takeIndex < 0) return;
    if (takeId === currentTakeId) {
      toast.error('当前画面不能删除，请先切换到其他版本。');
      return;
    }
    const updatedShots = (activeScene.shots || []).map((item) => item.id === shot.id
      ? { ...item, takes: takes.filter((take) => take.id !== takeId) }
      : item);
    updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId);
    if (previewTakeId === takeId) setPreviewTakeId(null);
    setPendingTakeDeletionId(null);
    toast.success(`已删除画面版本 V${takeIndex + 1}。`);
  };

  const handleUploadImage = async (file: File) => {
    if (!currentProject || isUploadingImage) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件。');
      return;
    }
    setIsUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败。'));
        reader.readAsDataURL(file);
      });
      const imageUrl = await persistProjectMediaUrl(dataUrl, currentProject.id);
      const createdAt = Date.now();
      const imageMedia = createMediaAssetReference({
        url: imageUrl,
        kind: 'image',
        source: 'upload',
        status: 'ready',
        createdAt,
        note: `作者在分镜卡片上传：${file.name}`,
      });
      const takeId = `take-upload-${createdAt}`;
      const stagedShot = appendShotTakeCandidate(shot, {
        id: takeId,
        imageUrl,
        imageMedia,
        createdAt,
      });
      const adoptedShot = adoptShotTake(stagedShot, takeId, 'image');
      const updatedShots = (activeScene.shots || []).map((item) => item.id === shot.id ? adoptedShot : item);
      await Promise.resolve(updateScene(activeScene.id, { shots: updatedShots }, activeEpisodeId));
      toast.success('图片已上传并设为当前画面。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传图片失败。');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleDurationChange = async (delta: number) => {
    if (!activeScene.shots || !currentProject || isSaving) return;
    const currentDuration = shot.duration || 3;
    const newDuration = Math.max(0.5, currentDuration + delta); // minimum 0.5s
    const newShots = activeScene.shots.map(s => s.id === shot.id ? { ...s, duration: parseFloat(newDuration.toFixed(1)) } : s);
    const issues = validateDirectorShotEdits(newShots, { previous: activeScene.shots, tracks: activeScene.audioTracks || [] });
    if (issues.length) { toast.error(issues[0]); return; }
    setIsSaving(true);
    try {
      await persistAuthorShotChanges(newShots, { shotPlan: true });
      await flushDebouncedProjectSave(currentProject.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存时长失败，请重试。"); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async () => {
    if (!currentProject || isSaving) return;
    let currentStartTime = 0;
    for (let i = 0; i < index; i++) {
      currentStartTime += activeScene.shots![i].duration || 0;
    }
    const shotDuration = shot.duration || 0;
    const shotEndTime = currentStartTime + shotDuration;

    const newShots = activeScene.shots?.filter(s => s.id !== shot.id) || [];
    
    let newAudioTracks = activeScene.audioTracks ? [...activeScene.audioTracks] : [];
    
    newAudioTracks = newAudioTracks.filter(track => {
      // 彻底去除与被删镜头显式关联的音轨
      if (track.shotId === shot.id) return false;
      return true;
    }).map(track => {
      // Shot-owned tracks are shifted once by reconcileDirectorAudioEdits.
      if (track.shotId && newShots.some(item => item.id === track.shotId)) return track;
      const t = { ...track };
      // 清理可能的遗漏悬空引用
      if (t.shotId === shot.id) {
         t.shotId = undefined;
      }
      
      // 凡是 startTime 晚于或等于此镜头结束时间的音轨，一律向前补正移位
      if (t.startTime >= shotEndTime) {
        t.startTime = Math.max(0, t.startTime - shotDuration);
      } else if (t.startTime > currentStartTime && t.startTime < shotEndTime) {
        // 如果起始点落在被删镜头内部，将其挤压到裁剪点
        t.startTime = currentStartTime;
      }
      return t;
    });

    const issues = validateDirectorShotEdits(newShots, { previous: activeScene.shots || [], tracks: newAudioTracks });
    if (issues.length) { toast.error(issues[0]); return; }
    setIsSaving(true);
    try {
      await persistAuthorShotChanges(newShots, { shotPlan: true }, { audioTracks: newAudioTracks });
      await flushDebouncedProjectSave(currentProject.id);
      setIsDeleting(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "删除镜头未保存，请重试。"); }
    finally { setIsSaving(false); }
  };

  // Calculate audio tracks for this shot
  let currentStartTime = 0;
  for (let i = 0; i < index; i++) {
    currentStartTime += activeScene.shots![i].duration || 0;
  }
  const shotEndTime = currentStartTime + (shot.duration || 0);
  const overlappingAudio = activeScene.audioTracks?.filter(a => 
    a.type === 'dialogue' && a.startTime >= currentStartTime && a.startTime < shotEndTime
  );

  const isInteractiveLoop = shot.visualAction?.includes('互动待机') || shot.motivation?.includes('互动待机') || shot.visualAction?.includes('循环') || shot.visualAction?.includes('待机') || shot.visualAction?.includes('留白') || shot.visualAction?.includes('UI');

  const card = (
    <div
      data-shot-id={shot.id}
      role="button"
      tabIndex={0}
      aria-label={`镜头 SHOT ${index + 1}`}
      onClick={() => onSelect?.(shot.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect?.(shot.id);
      }}
      className={`bg-bg-surface-soft/90 border ${
        isInteractiveLoop 
          ? 'border-purple-500/30 shadow-purple-900/5' 
          : 'border-border-soft/20 hover:border-border-soft/40'
      } ${selected ? 'border-gold/40 ring-1 ring-inset ring-gold/30' : ''} ${batchSelected ? 'border-cyan-500/70 ring-2 ring-inset ring-cyan-500/35' : ''} ${isFullscreen ? 'flex h-full w-full flex-col rounded-lg md:flex-row' : 'flex h-[460px] flex-col rounded-2xl'} overflow-hidden transition-all group relative shadow-sm`}
    >
      {/* 顶部画面预览区（去纯黑，柔和背景） */}
      <div className={`${isFullscreen ? 'h-[46%] w-full border-b md:h-full md:w-[52%] md:border-r md:border-b-0' : 'h-48 w-full border-b'} bg-bg-surface-soft relative flex items-center justify-center overflow-hidden shrink-0 border-border-soft/10`}>
        {previewImageUrl ? (
          <img
            src={previewImageUrl}
            alt={`SHOT ${index + 1} preview`}
            className={`h-full w-full transition-transform duration-500 ${isFullscreen ? 'object-contain' : 'object-cover group-hover:scale-105'}`}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-text-muted/40">
            <Camera className="w-9 h-9 stroke-1" />
            <span className="text-[10px] font-mono tracking-widest uppercase">等待生成画面</span>
          </div>
        )}

        {previewingCandidate && (
          <div className="absolute bottom-3 left-3 z-20 rounded-md border border-amber-300/50 bg-amber-50/95 px-2.5 py-1 text-[10px] font-bold text-amber-800 shadow-sm backdrop-blur-sm dark:border-amber-800/50 dark:bg-amber-950/90 dark:text-amber-200">
            候选预览 · 尚未采用
          </div>
        )}

        {isGeneratingImage && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-surface/85 text-text-primary backdrop-blur-sm"
          >
            <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
            <span className="text-xs font-bold">正在生成 {currentProject?.aspectRatio || "16:9"} 分镜画面</span>
          </div>
        )}
        
        {isInteractiveLoop && (
          <div className="absolute top-3 left-3 z-10 pointer-events-none">
            <span className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/90 text-white rounded-lg text-[10px] font-bold tracking-wider uppercase backdrop-blur-sm shadow-sm">
              <Sparkles className="w-3 h-3" />
              互动待机
            </span>
          </div>
        )}
        
        {/* 左上角：Shot 序号与景别 */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
          {onToggleBatchSelection && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleBatchSelection(shot.id);
              }}
              aria-pressed={batchSelected}
              aria-label={batchSelected ? `取消选择 SHOT ${index + 1}` : `选择 SHOT ${index + 1}`}
              title={batchSelected ? "取消批量选择" : "加入批量选择"}
              className={`flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-md transition-colors ${batchSelected ? "border-cyan-400/70 bg-cyan-500 text-white" : "border-border-soft/30 bg-bg-surface/90 text-text-muted hover:text-cyan-400"}`}
            >
              {batchSelected ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
          )}
          <span className="text-[10px] font-bold text-text-primary bg-bg-surface/90 px-2.5 py-1 rounded-md backdrop-blur-md border border-border-soft/30 uppercase tracking-wider shadow-sm">
            SHOT {index + 1}
          </span>
          {shot.shotSize && (
            <span className="text-[10px] font-medium text-text-secondary bg-bg-surface/80 px-2 py-1 rounded-md backdrop-blur-md border border-border-soft/20 shadow-sm">
              {shot.shotSize}
            </span>
          )}
        </div>

        {/* 右上角：悬浮按钮组 */}
        {isDeleting ? (
          <div className="absolute top-3 right-12 flex items-center gap-1.5 z-20 bg-bg-surface/95 p-1.5 rounded-xl backdrop-blur-md shadow-lg border border-border-soft/30">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              className="text-[11px] text-red-500 hover:text-red-600 font-bold px-2.5 py-1 rounded-md bg-red-500/10 transition-colors cursor-pointer"
            >
              确认
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsDeleting(false);
              }}
              className="text-[11px] text-text-muted hover:text-text-primary px-2.5 py-1 rounded-md bg-bg-surface-soft transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="absolute top-3 right-12 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateSpatial(shot);
                }}
                disabled={Boolean(aiGenerationBlockedReason)}
                className="p-1.5 bg-bg-surface/90 hover:bg-bg-surface-hover text-text-primary rounded-lg backdrop-blur-md border border-border-soft/30 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                title={aiGenerationBlockedReason || "AI 3D 构图生成"}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenSpatial();
                }}
                className="p-1.5 bg-bg-surface/90 hover:bg-bg-surface-hover text-text-primary rounded-lg backdrop-blur-md border border-border-soft/30 shadow-sm transition-colors cursor-pointer"
                title="3D 构图"
              >
                <Box className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeleting(true);
                }}
                className="p-1.5 bg-bg-surface/90 hover:bg-red-500 hover:text-white text-text-primary rounded-lg backdrop-blur-md border border-border-soft/30 shadow-sm transition-colors cursor-pointer"
                title="删除镜头"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
          </div>
        )}
        {/* 右下角：时长微调 */}
        <div className="absolute bottom-2.5 right-3 flex items-center bg-bg-surface/90 text-text-primary rounded-md border border-border-soft/30 backdrop-blur-md shadow-sm overflow-hidden z-10">
          <button 
            onClick={(e) => { e.stopPropagation(); handleDurationChange(-0.5); }}
            className="px-2 py-1 hover:bg-bg-surface-hover transition-colors cursor-pointer text-text-muted hover:text-text-primary"
            title="减少时长"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[10px] font-mono font-bold px-1.5 py-1 min-w-[3.5ch] text-center border-x border-border-soft/20">
            {shot.duration}s
          </span>
          <button 
            onClick={(e) => { e.stopPropagation(); handleDurationChange(0.5); }}
            className="px-2 py-1 hover:bg-bg-surface-hover transition-colors cursor-pointer text-text-muted hover:text-text-primary"
            title="增加时长"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsFullscreen((value) => !value);
        }}
        className="absolute top-3 right-3 z-30 p-1.5 bg-bg-surface/90 hover:bg-bg-surface-hover text-text-primary rounded-lg backdrop-blur-md border border-border-soft/30 shadow-sm transition-colors cursor-pointer"
        title={isFullscreen ? "退出全屏" : "全屏查看镜头"}
        aria-label={isFullscreen ? "退出全屏" : "全屏查看镜头"}
      >
        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>

      <div className={isFullscreen ? "flex h-[54%] w-full min-w-0 flex-col bg-bg-surface-soft pt-10 md:h-full md:w-[48%]" : "contents"}>

      {/* 中部卡片内容区域（顺畅内滚动） */}
      <div ref={fullscreenInfoViewportRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <div
          ref={fullscreenInfoContentRef}
          className={`flex-1 min-h-0 pr-1 ${isFullscreen && !isEditing ? 'grid grid-cols-1 content-start gap-2 overflow-visible xl:grid-cols-2' : 'space-y-3 overflow-y-auto custom-scrollbar'}`}
          style={isFullscreen && !isEditing ? {
            transform: `scale(${fullscreenInfoScale})`,
            transformOrigin: 'top left',
          } : undefined}
        >
          {isEditing ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1.5">动作描述 (Action)</label>
                <textarea
                  value={editingData.visualAction || ""}
                  onChange={(e) => setEditingData({ ...editingData, visualAction: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-xl p-3 text-xs text-text-primary resize-none h-20 focus:outline-none transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">景别</label>
                  <input
                    value={editingData.shotSize || ""}
                    onChange={(e) => setEditingData({ ...editingData, shotSize: e.target.value })}
                    className="w-full bg-bg-surface border border-border-soft/30 rounded-lg p-2 text-xs text-text-primary focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">角度</label>
                  <input
                    value={editingData.cameraAngle || ""}
                    onChange={(e) => setEditingData({ ...editingData, cameraAngle: e.target.value })}
                    className="w-full bg-bg-surface border border-border-soft/30 rounded-lg p-2 text-xs text-text-primary focus:outline-none transition-all"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">运镜</label>
                  <input
                    value={editingData.cameraMovement || ""}
                    onChange={(e) => setEditingData({ ...editingData, cameraMovement: e.target.value })}
                    className="w-full bg-bg-surface border border-border-soft/30 rounded-lg p-2 text-xs text-text-primary focus:outline-none transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">光影氛围</label>
                <input
                  value={editingData.lighting ?? editingData.lightingAtmo ?? ""}
                  onChange={(e) => setEditingData({ ...editingData, lighting: e.target.value, lightingAtmo: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-lg p-2 text-xs text-text-primary focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">画面微表情</label>
                <textarea
                  value={editingData.microExpression || ""}
                  onChange={(e) => setEditingData({ ...editingData, microExpression: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-xl p-3 text-xs text-text-primary resize-none h-16 focus:outline-none transition-all"
                  placeholder="眼神落点、面部微表情..."
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">导演意图</label>
                <textarea
                  value={editingData.motivation || ""}
                  onChange={(e) => setEditingData({ ...editingData, motivation: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-xl p-3 text-xs text-text-primary resize-none h-16 focus:outline-none transition-all"
                />
              </div>
              {availableVisualLayers.length > 0 && (
                <fieldset className="space-y-2 rounded-lg border border-border-soft/30 bg-bg-surface p-3">
                  <legend className="px-1 text-[10px] font-black text-text-muted">本镜头视觉层</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableVisualLayers.map((layer) => {
                      const selectedLayerIds = editingData.activeVisualLayerIds || [];
                      const checked = selectedLayerIds.includes(layer.id);
                      return (
                        <label key={layer.id} className="flex min-w-0 items-center gap-2 text-xs text-text-primary">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => setEditingData({
                              ...editingData,
                              activeVisualLayerIds: event.target.checked
                                ? Array.from(new Set([...selectedLayerIds, layer.id]))
                                : selectedLayerIds.filter((id) => id !== layer.id),
                            })}
                            className="h-4 w-4 shrink-0 accent-gold"
                          />
                          <span className="truncate">{layer.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">画面提示词 (Image Prompt)</label>
                <textarea
                  value={editingData.imagePrompt || ""}
                  onChange={(e) => setEditingData({ ...editingData, imagePrompt: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-xl p-3 text-xs text-text-primary font-mono resize-none h-20 focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-text-muted uppercase tracking-wider block mb-1">视频提示词 (Video Prompt)</label>
                <textarea
                  value={editingData.videoPrompt || ""}
                  onChange={(e) => setEditingData({ ...editingData, videoPrompt: e.target.value })}
                  className="w-full bg-bg-surface border border-border-soft/30 rounded-xl p-3 text-xs text-text-primary font-mono resize-none h-24 focus:outline-none transition-all"
                />
              </div>
              <details className="text-xs text-text-secondary"><summary className="cursor-pointer text-gold">构图、调度、声音与剪辑</summary><div className="mt-3"><ShotExecutionEditor shot={{ ...shot, ...editingData }} onChange={next => setEditingData(next)} extraOnly /></div></details>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 bg-text-primary text-bg-primary rounded-xl py-2 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  {isSaving ? '保存中…' : '保存参数'}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  className="flex-1 bg-bg-surface border border-border-soft/30 hover:bg-bg-surface-hover text-text-primary rounded-xl py-2 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 动作描述 (Action) */}
              <div className={isFullscreen ? "xl:col-span-2" : undefined}>
                <span className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-wider block mb-1">动作描述 (ACTION)</span>
                <p className="text-xs font-semibold text-text-primary leading-relaxed">
                  {shot.visualAction || "暂无动作描述"}
                </p>
              </div>

              {(shot.soundDesign || shot.editingNote) && <details className="text-xs text-text-muted"><summary className="cursor-pointer">声音与剪辑说明</summary>{shot.soundDesign && <p className="mt-2">声音：{shot.soundDesign}</p>}{shot.editingNote && <p className="mt-2">剪辑：{shot.editingNote}</p>}</details>}
              {/* 镜头参数 Tag 颗粒组 */}
              <div className={`flex flex-wrap gap-1.5 ${isFullscreen ? 'xl:col-span-2' : ''}`}>
                {shot.shotSize && (
                  <span className="text-[10px] bg-bg-surface text-text-secondary px-2 py-0.5 rounded-md border border-border-soft/20">
                    {shot.shotSize}
                  </span>
                )}
                {shot.cameraAngle && (
                  <span className="text-[10px] bg-bg-surface text-text-secondary px-2 py-0.5 rounded-md border border-border-soft/20">
                    {shot.cameraAngle}
                  </span>
                )}
                {shot.cameraMovement && (
                  <span className="text-[10px] bg-bg-surface text-text-secondary px-2 py-0.5 rounded-md border border-border-soft/20">
                    {shot.cameraMovement}
                  </span>
                )}
                {shot.lightingAtmo && (
                  <span className="text-[10px] bg-bg-surface text-text-secondary px-2 py-0.5 rounded-md border border-border-soft/20 truncate max-w-[180px]">
                    {shot.lightingAtmo}
                  </span>
                )}
              </div>

              {/* 画面微表情 / 导演意图 */}
              {(shot.microExpression || shot.motivation) && (
                <div className="bg-bg-surface/60 rounded-xl p-2.5 border border-border-soft/20 space-y-1.5">
                  {shot.microExpression && (
                    <div>
                      <span className="text-[9px] font-bold text-amber-500/90 uppercase tracking-wider block">微表情 (MICRO-EXPRESSION)</span>
                      <p className="text-[11px] text-text-secondary leading-snug">
                        {shot.microExpression}
                      </p>
                    </div>
                  )}
                  {shot.motivation && (
                    <div>
                      <span className="text-[9px] font-bold text-purple-400/90 uppercase tracking-wider block">导演意图 (MOTIVATION)</span>
                      <p className="text-[11px] text-text-muted italic leading-snug">
                        {shot.motivation}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 提示词 (Prompts) */}
              <div className="space-y-2 rounded-lg border border-border-soft/15 bg-bg-surface/40 p-2.5">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono font-bold text-emerald-500/90 uppercase tracking-wider">画面提示词</span>
                    <button
                      type="button"
                      onClick={() => onGenerateImagePrompt(shot.id)}
                      disabled={promptGenerationBusy}
                      title="只为当前分镜生成图片提示词"
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-soft/25 bg-bg-surface px-2 text-[10px] font-bold text-text-secondary transition-colors hover:bg-bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {generatingPromptKind === "image"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <FileImage className="h-3 w-3" />}
                      {shot.imagePrompt ? "重新生成" : "单独生成"}
                    </button>
                  </div>
                  <p className={`text-[10px] font-mono leading-relaxed break-all ${shot.imagePrompt ? "text-text-muted" : "text-text-muted/55"} ${isFullscreen ? '' : 'line-clamp-2'}`}>
                    {shot.imagePrompt || "尚未生成图片提示词"}
                  </p>
                </div>
                <div className="border-t border-border-soft/15 pt-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono font-bold text-cyan-500/90 uppercase tracking-wider">视频提示词</span>
                    <button
                      type="button"
                      onClick={() => onGenerateVideoPrompt(shot.id)}
                      disabled={promptGenerationBusy}
                      title="只为当前分镜生成视频提示词"
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-soft/25 bg-bg-surface px-2 text-[10px] font-bold text-text-secondary transition-colors hover:bg-bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {generatingPromptKind === "video"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Video className="h-3 w-3" />}
                      {shot.videoPrompt ? "重新生成" : "单独生成"}
                    </button>
                  </div>
                  <p className={`text-[10px] font-mono leading-relaxed break-all ${shot.videoPrompt ? "text-text-muted" : "text-text-muted/55"} ${isFullscreen ? '' : 'line-clamp-2'}`}>
                    {shot.videoPrompt || "尚未生成视频提示词"}
                  </p>
                </div>
              </div>

              {/* 台词 (Dialogue) */}
              {overlappingAudio && overlappingAudio.length > 0 && (
                <div className={`border-l-2 border-gold/60 pl-2.5 py-0.5 ${isFullscreen ? 'xl:col-span-2' : ''}`}>
                  <span className="text-[9px] font-bold text-gold uppercase tracking-wider block">台词</span>
                  {overlappingAudio.map(audio => (
                    <p key={audio.id} className="text-[11px] text-text-secondary italic leading-snug">
                      "{audio.text}"
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 底部固定操作按钮工具栏（从极黑改为优雅基色） */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-soft/20 bg-bg-surface-soft p-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setIsEditing(true);
              originalEditShot.current = structuredClone(shot);
              setEditingData(structuredClone(shot));
            }}
            className="h-8 px-2.5 bg-bg-surface hover:bg-bg-surface-hover border border-border-soft/30 text-text-primary rounded-lg text-[11px] font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer shadow-sm"
            title="编辑参数"
          >
            <Edit2 className="w-3 h-3 text-text-muted" />
            编辑
          </button>

          <button
            onClick={() => onReroll(shot.id)}
            disabled={isGeneratingImage || Boolean(aiGenerationBlockedReason)}
            title={isGeneratingImage ? "当前镜头画面正在生成" : aiGenerationBlockedReason || "重新生成镜头图片"}
            className="h-8 px-2.5 bg-bg-surface hover:bg-bg-surface-hover border border-border-soft/30 text-text-primary rounded-lg text-[11px] font-bold transition-all active:scale-95 flex items-center gap-1 disabled:opacity-40 cursor-pointer shadow-sm"
          >
            {isGeneratingImage
              ? <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
              : <Wand2 className="w-3 h-3 text-text-muted" />}
            {isGeneratingImage ? "生成中" : shot.imageUrl ? "AI 重绘" : "AI 生成"}
          </button>

          <input
            ref={imageUploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleUploadImage(file);
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => imageUploadInputRef.current?.click()}
            disabled={isUploadingImage}
            title="上传镜头画面"
            className="flex h-8 items-center gap-1 rounded-lg border border-border-soft/30 bg-bg-surface px-2.5 text-[11px] font-bold text-text-primary shadow-sm transition-all hover:bg-bg-surface-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isUploadingImage ? <Loader2 className="h-3 w-3 animate-spin text-text-muted" /> : <Upload className="h-3 w-3 text-text-muted" />}
            上传图片
          </button>
        </div>

        {imageTakes.length > 0 && (() => {
          const currentTakeId = activeImageTakeId;
          const currentTakeIndex = imageTakes.findIndex((take) => take.id === currentTakeId);
          const pendingCount = imageTakes.filter((take) => take.id !== currentTakeId).length;
          return (
            <div className="ml-auto flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border-soft/30 bg-bg-surface p-1" aria-label="画面版本">
              <span className="px-1.5 text-[10px] font-bold text-text-muted">
                {currentTakeIndex >= 0 ? `当前 V${currentTakeIndex + 1}` : `待采用 ${pendingCount}`}
              </span>
              {imageTakes.map((take, takeIndex) => {
                const isActive = currentTakeId === take.id;
                const isPreviewed = previewTakeId === take.id || (!previewTakeId && isActive);
                const isConfirmingDelete = pendingTakeDeletionId === take.id;
                return (
                  <div key={take.id} className="inline-flex h-7 items-center overflow-hidden rounded-md border border-border-soft/20">
                    <button
                      type="button"
                      onClick={() => setPreviewTakeId(isActive ? null : take.id)}
                      aria-pressed={isPreviewed}
                      aria-label={isActive ? `预览当前画面版本 V${takeIndex + 1}` : `预览候选画面版本 V${takeIndex + 1}`}
                      title={isActive ? `当前使用：V${takeIndex + 1}` : `先预览候选 V${takeIndex + 1}`}
                      className={`inline-flex h-full min-w-9 items-center justify-center gap-1 px-2 text-[10px] font-bold transition-colors ${isPreviewed ? "bg-text-primary text-bg-primary" : "text-text-muted hover:bg-bg-surface-soft hover:text-text-primary"}`}
                    >
                      {isActive && <Check className="h-3 w-3" aria-hidden="true" />}
                      V{takeIndex + 1}
                    </button>
                    {!isActive && (isConfirmingDelete ? (
                      <div className="flex h-full items-center border-l border-border-soft/20 bg-bg-surface-soft">
                        <button
                          type="button"
                          onClick={() => handleDeleteTake(take.id)}
                          aria-label={`确认删除画面版本 V${takeIndex + 1}`}
                          title={`确认删除 V${takeIndex + 1}`}
                          className="flex h-full w-7 items-center justify-center text-status-error transition-colors hover:bg-status-error/10"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingTakeDeletionId(null)}
                          aria-label={`取消删除画面版本 V${takeIndex + 1}`}
                          title="取消删除"
                          className="flex h-full w-7 items-center justify-center text-text-muted transition-colors hover:bg-bg-surface-hover hover:text-text-primary"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectTake(take.id)}
                          aria-label={`采用候选画面版本 V${takeIndex + 1}`}
                          title={`采用 V${takeIndex + 1}`}
                          className="flex h-full w-7 items-center justify-center border-l border-border-soft/20 text-emerald-600 transition-colors hover:bg-emerald-500/10"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingTakeDeletionId(take.id)}
                          aria-label={`删除画面版本 V${takeIndex + 1}`}
                          title={`删除不用的版本 V${takeIndex + 1}`}
                          className="flex h-full w-7 items-center justify-center border-l border-border-soft/20 text-text-muted transition-colors hover:bg-status-error/10 hover:text-status-error"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })()}

      </div>

      </div>

      {currentProject && <div className="shrink-0 px-3 pb-2"><ProductionCreativeControls project={currentProject} episode={useProjectStore.getState().activeEpisode || currentProject.episodes.find(item => item.id === activeEpisodeId)} scene={activeScene} shot={shot} compact /></div>}

      <SpatialModal
        isOpen={isSpatialModalOpen}
        onClose={() => setIsSpatialModalOpen(false)}
        onConfirm={(compositionData) => {
          setIsSpatialModalOpen(false);
          const newShots = activeScene.shots!.map(s => 
            s.id === shot.id ? { ...s, compositionData } : s
          );
          updateScene(activeScene.id, { shots: newShots }, activeEpisodeId);
        }}
        shotId={shot.id}
        backgroundImageUrl={currentProject?.assets?.find(a => a.id === shot.locationId)?.panoramaUrl || currentProject?.assets?.find(a => a.id === shot.locationId)?.imageUrl}
        isPanorama={!!currentProject?.assets?.find(a => a.id === shot.locationId)?.panoramaUrl}
        shotSize={shot.shotSize}
        cameraAngle={shot.cameraAngle}
      />
    </div>
  );

  if (!isFullscreen) return card;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`SHOT ${index + 1} 全屏查看`}
      className="fixed inset-0 z-[120] flex bg-bg-primary p-3 md:p-6"
    >
      {card}
    </div>,
    document.body,
  );
};
