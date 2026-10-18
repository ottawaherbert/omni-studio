import React from "react";
import { AudioLines, Check, CircleAlert, Loader2, Video, Play, Pause, Image as ImageIcon, Maximize2, Minimize2, VolumeX, PanelLeft, PanelRight } from "lucide-react";
import { Shot, AudioTrack } from "../clients/domainTypes";
import { isShotTakeReadyForAdoption, shotTakeHasVideoIntent } from "../clients/productionMediaReviewClient";

interface StudioPreviewProps {
  showMediaPool?: boolean;
  showInspector?: boolean;
  onToggleMediaPool?: () => void;
  onToggleInspector?: () => void;
  previewMode: "video" | "image";
  setPreviewMode: (mode: "video" | "image") => void;
  isPlaying: boolean;
  togglePlay: () => void;
  isMuted: boolean;
  playingShot?: Shot;
  previewOpacity?: number;
  audioTracks?: AudioTrack[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRefs: React.MutableRefObject<{ [key: string]: HTMLAudioElement }>;
  onSynthesize: () => void;
  isSynthesizing: boolean;
  takeShot?: Shot;
  previewTakeId?: string;
  onPreviewTake?: (takeId: string) => void;
  onAdoptTake?: (takeId: string) => void;
  onStripTakeAudio?: (takeId: string) => void;
  onReplaceTakeAudio?: (takeId: string, file: File) => void;
  isEditingVideoAudio?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const StudioPreview: React.FC<StudioPreviewProps> = ({
  previewMode,
  showMediaPool, showInspector, onToggleMediaPool, onToggleInspector,
  setPreviewMode,
  isPlaying,
  togglePlay,
  isMuted,
  playingShot,
  previewOpacity = 1,
  audioTracks,
  videoRef,
  audioRefs,
  onSynthesize,
  isSynthesizing,
  takeShot,
  previewTakeId,
  onPreviewTake,
  onAdoptTake,
  onStripTakeAudio,
  onReplaceTakeAudio,
  isEditingVideoAudio = false,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const replacementAudioInputRef = React.useRef<HTMLInputElement>(null);
  const activeTake = takeShot?.takes?.find((take) => take.id === takeShot.activeTakeId);
  const activeAudio = activeTake?.generationAudit?.audioProvenance;
  return (
    <div className="min-w-0 flex-1 bg-bg-primary flex flex-col overflow-hidden border-r border-border-soft/10 transition-colors duration-200">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border-soft/10 bg-bg-surface px-3 md:px-5">
        <div className="flex bg-bg-surface-soft rounded-xl p-1 border border-border-soft/20">
          <button
            onClick={() => setPreviewMode("video")}
            className={`flex h-8 min-w-8 items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition-all active:scale-95 cursor-pointer sm:px-3 ${
              previewMode === "video"
                ? "bg-bg-surface text-gold shadow-sm border border-border-soft/30"
                : "text-text-muted hover:text-text-primary"
            }`}
            title="视频预览"
          >
            <Video className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">视频预览</span>
          </button>
          <button
            onClick={() => setPreviewMode("image")}
            className={`flex h-8 min-w-8 items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition-all active:scale-95 cursor-pointer sm:px-3 ${
              previewMode === "image"
                ? "bg-bg-surface text-gold shadow-sm border border-border-soft/30"
                : "text-text-muted hover:text-text-primary"
            }`}
            title="图片预览"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">图片预览</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {onToggleMediaPool && <button type="button" onClick={onToggleMediaPool} aria-pressed={showMediaPool} title={showMediaPool ? "收起媒体池" : "展开媒体池"} className="p-2 text-text-secondary"><PanelLeft className="h-4 w-4" /></button>}
          {onToggleInspector && <button type="button" onClick={onToggleInspector} aria-pressed={showInspector} title={showInspector ? "收起检查器" : "展开检查器"} className="p-2 text-text-secondary"><PanelRight className="h-4 w-4" /></button>}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="flex h-8 min-w-8 items-center justify-center gap-1.5 bg-bg-surface-soft px-2 text-xs font-bold text-text-primary transition-all hover:bg-bg-surface-hover border border-border-soft/20 active:scale-95 cursor-pointer sm:px-3"
              title={isFullscreen ? "退出全屏" : "沉浸全屏"}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-gold" />
                  <span className="hidden sm:inline">退出全屏</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-gold" />
                  <span className="hidden sm:inline">沉浸全屏</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={onSynthesize}
            disabled={isSynthesizing}
            className="flex h-8 min-w-8 items-center justify-center gap-2 bg-text-primary px-2 text-xs font-bold text-bg-surface transition-all hover:bg-text-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer sm:px-4"
            title="导出成片"
          >
            {isSynthesizing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-bg-surface/30 border-t-bg-surface rounded-full animate-spin" />
                <span className="hidden sm:inline">整集合成中...</span>
              </span>
            ) : (
              <>
                <Video className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">导出成片</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Player Area */}
      <div className="flex-1 bg-bg-primary p-6 md:p-10 relative flex flex-col items-center justify-center gap-4 overflow-hidden">
        {/* Hidden audio elements for all tracks */}
        {audioTracks?.map(track => (
          <audio 
            key={track.id} 
            ref={el => { if (el) audioRefs.current[track.id] = el; }} 
            src={track.url || undefined} 
            muted={isMuted || Boolean(track.muted)}
          />
        ))}

        <div className="w-full min-h-0 max-h-full max-w-5xl aspect-video bg-black rounded-lg overflow-hidden border border-border-soft/20 relative group">
          {previewMode === "video" ? (
            playingShot?.videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  style={{ opacity: previewOpacity }}
                  className="w-full h-full object-contain"
                  muted={isMuted}
                  playsInline
                />
                {/* Play/Pause Overlay */}
                <button
                  type="button"
                  aria-label={isPlaying ? "暂停预览" : "播放预览"}
                  title={isPlaying ? "暂停预览" : "播放预览"}
                  className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity cursor-pointer focus-visible:opacity-100 ${isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                  onClick={togglePlay}
                >
                  <span className="w-14 h-14 rounded-full bg-bg-surface/80 hover:bg-bg-surface flex items-center justify-center text-text-primary border border-border-soft/30 transition-all active:scale-90">
                    {isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 ml-1 fill-current" />
                    )}
                  </span>
                </button>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-text-muted bg-bg-surface-soft/40">
                <div className="w-16 h-16 rounded-full bg-bg-surface-soft flex items-center justify-center mb-4 border border-border-soft/10">
                  <Video className="w-8 h-8 opacity-30 text-text-muted" />
                </div>
                <p className="text-sm font-bold text-text-secondary">当前时间点无视频片段</p>
                <p className="text-xs mt-1 font-medium opacity-60">请在下方时间轴选择有素材的区域</p>
              </div>
            )
          ) : playingShot?.imageUrl ? (
            <img
              src={playingShot.imageUrl || undefined}
              alt="preview"
              style={{ opacity: previewOpacity }}
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted bg-bg-surface-soft/40">
              <div className="w-16 h-16 rounded-full bg-bg-surface-soft flex items-center justify-center mb-4 border border-border-soft/10">
                <ImageIcon className="w-8 h-8 opacity-30 text-text-muted" />
              </div>
              <p className="text-sm font-bold text-text-secondary">当前时间点无图片片段</p>
            </div>
          )}
        </div>
        {takeShot?.takes?.length ? (
          <div className="flex min-h-16 w-full max-w-5xl shrink-0 items-center gap-2 overflow-x-auto rounded-xl border border-border-soft/20 bg-bg-surface p-2 custom-scrollbar">
            <span className="shrink-0 px-2 text-[10px] font-bold text-text-muted">素材版本</span>
            {takeShot.takes.map((take, index) => {
              const isVideoTake = shotTakeHasVideoIntent(take);
              const readyForAdoption = isShotTakeReadyForAdoption(take);
              const failed = take.videoMedia?.status === "failed"
                || ["failed", "cancelled"].includes(take.generationAudit?.videoTaskStatus || "");
              const sourceReviewRecommended = take.generationAudit?.sourceReview?.status === "review_recommended";
              return (
                <div key={take.id} className="relative h-12 w-20 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewMode(isVideoTake ? "video" : "image");
                      onPreviewTake?.(take.id);
                    }}
                    className={`relative h-12 w-20 overflow-hidden rounded-lg border transition-all cursor-pointer ${takeShot.activeTakeId === take.id ? "border-gold" : previewTakeId === take.id ? "border-sky-400 ring-1 ring-sky-400/30" : "border-border-soft/20 hover:border-border-soft/40"}`}
                    title={`预览方案 ${index + 1}${take.generationAudit ? ` · ${take.generationAudit.modelId}` : ""}`}
                  >
                    {take.imageUrl ? <img src={take.imageUrl} alt={`素材版本 ${index + 1}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-bg-surface-soft"><Video className="h-4 w-4 text-text-muted" /></div>}
                    <span className="absolute bottom-0 inset-x-0 bg-black/65 py-0.5 text-[9px] font-bold text-white text-center">
                      方案 {index + 1}{failed ? " · 失败" : isVideoTake && !readyForAdoption ? " · 生成中" : isVideoTake ? " · 视频" : " · 图片"}
                    </span>
                    {sourceReviewRecommended && (
                      <span className="absolute left-1 top-1 rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black text-black">来源有更新</span>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!readyForAdoption}
                    onClick={() => {
                      setPreviewMode(isVideoTake ? "video" : "image");
                      onAdoptTake?.(take.id);
                    }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border border-white/25 bg-black/70 text-white shadow-sm hover:bg-gold hover:text-black disabled:cursor-not-allowed disabled:opacity-70"
                    title={failed ? "候选生成失败，不能采用" : readyForAdoption ? sourceReviewRecommended ? `来源有更新，建议复核；仍可采用方案 ${index + 1}` : `采用方案 ${index + 1}` : "候选尚未生成完成，不能采用"}
                    aria-label={readyForAdoption ? `采用方案 ${index + 1}` : `方案 ${index + 1} 尚不可采用`}
                  >
                    {failed ? <CircleAlert className="h-3 w-3" /> : readyForAdoption ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  </button>
                </div>
              );
            })}
            {activeTake?.videoUrl && (onStripTakeAudio || onReplaceTakeAudio) ? (
              <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-border-soft/20 pl-3">
                <span className="text-[10px] font-bold text-text-muted">
                  {activeAudio?.embeddedAudio
                    ? activeAudio.source === 'full_dialogue_master' ? '使用完整配音' : '含原声'
                    : activeAudio?.source === 'none' ? '无原声' : '声音未标注'}
                </span>
                {onStripTakeAudio && activeAudio?.embeddedAudio && (
                  <button
                    type="button"
                    disabled={isEditingVideoAudio}
                    onClick={() => onStripTakeAudio(activeTake.id)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-soft/30 px-2.5 text-[10px] font-bold text-text-primary hover:border-gold/50 hover:text-gold disabled:opacity-50"
                    title="保留原视频记录并生成一个无声版本"
                  >
                    {isEditingVideoAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VolumeX className="h-3.5 w-3.5" />}
                    移除原声
                  </button>
                )}
                {onReplaceTakeAudio && (
                  <>
                    <input
                      ref={replacementAudioInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) onReplaceTakeAudio(activeTake.id, file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={isEditingVideoAudio}
                      onClick={() => replacementAudioInputRef.current?.click()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-soft/30 px-2.5 text-[10px] font-bold text-text-primary hover:border-gold/50 hover:text-gold disabled:opacity-50"
                      title="保留原视频记录并用所选声音替换当前音轨"
                    >
                      {isEditingVideoAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
                      替换声音
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
