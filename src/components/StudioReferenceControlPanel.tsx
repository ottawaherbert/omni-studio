import { CheckSquare, Clapperboard, ImageIcon, Mic, Square, Video } from "lucide-react";
import type { ManualStudioGenerationTarget } from "../hooks/useManualStudioAI";
import type { ManualProductionAssetBoard, ManualProductionSceneState } from "../clients/productionAssetWorkflowClient";

interface StudioReferenceControlPanelProps {
  target: ManualStudioGenerationTarget;
  assetBoards: ManualProductionAssetBoard[];
  sceneStates: ManualProductionSceneState[];
  selectedBoardItemIds: string[];
  onToggleBoardItem: (boardItemId: string) => void;
  startFrameOptions: Array<{ id: string; label: string }>;
  endFrameOptions: Array<{ id: string; label: string }>;
  startFrameTakeId: string;
  onSelectStartTake: (takeId: string) => void;
  endFrameTakeId: string;
  onSelectEndTake: (takeId: string) => void;
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  requiresStartFrame: boolean;
  requiresEndFrame: boolean;
  acceptsReferenceImages: boolean;
  acceptsReferenceVideos: boolean;
  acceptsReferenceAudios: boolean;
  includeStoryboardReference: boolean;
  storyboardReferenceAvailable: boolean;
  onToggleStoryboardReference: () => void;
  adoptedImageOptions: Array<{ id: string; label: string; mediaUrl: string }>;
  selectedReferenceImageTakeIds: string[];
  onToggleReferenceImageTake: (takeId: string) => void;
  priorVideoOptions: Array<{ id: string; label: string; mediaUrl: string }>;
  selectedReferenceVideoTakeIds: string[];
  onToggleReferenceVideoTake: (takeId: string) => void;
  dialogueOptions: Array<{ id: string; label: string; mediaUrl: string }>;
  selectedDialogueTrackIds: string[];
  onToggleDialogueTrack: (trackId: string) => void;
  voiceOptions: Array<{ id: string; label: string; mediaUrl: string }>;
  selectedVoiceReferenceIds: string[];
  onToggleVoiceReference: (referenceId: string) => void;
  videoModelLabel: string;
  generationModeLabel: string;
}

export function StudioReferenceControlPanel({
  target,
  assetBoards,
  sceneStates = [],
  selectedBoardItemIds = [],
  onToggleBoardItem,
  startFrameOptions,
  endFrameOptions,
  startFrameTakeId,
  onSelectStartTake,
  endFrameTakeId,
  onSelectEndTake,
  supportsStartFrame,
  supportsEndFrame,
  requiresStartFrame,
  requiresEndFrame,
  acceptsReferenceImages,
  acceptsReferenceVideos,
  acceptsReferenceAudios,
  includeStoryboardReference,
  storyboardReferenceAvailable,
  onToggleStoryboardReference,
  adoptedImageOptions,
  selectedReferenceImageTakeIds,
  onToggleReferenceImageTake,
  priorVideoOptions,
  selectedReferenceVideoTakeIds,
  onToggleReferenceVideoTake,
  dialogueOptions,
  selectedDialogueTrackIds,
  onToggleDialogueTrack,
  voiceOptions,
  selectedVoiceReferenceIds,
  onToggleVoiceReference,
  videoModelLabel,
  generationModeLabel,
}: StudioReferenceControlPanelProps) {
  const frameMode = supportsStartFrame || supportsEndFrame;

  return (
    <section className="border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900" aria-label="本次生成参考素材">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-gray-800 dark:text-neutral-200">本次生成参考素材</h3>
          <p className="mt-1 text-[10px] text-gray-400">{generationModeLabel} · 只提交这里明确选择且当前方式允许的素材。</p>
        </div>
        <span className="bg-gray-100 px-2 py-1 text-[9px] font-bold text-gray-500 dark:bg-neutral-800">{videoModelLabel}</span>
      </div>

      {acceptsReferenceImages && (
        <div className="space-y-4">
          {target.kind === "storyboard_board" && (
            <div>
              <p className="mb-2 text-[10px] font-bold text-gray-500">视频单元画面</p>
              <button type="button" disabled={!storyboardReferenceAvailable} onClick={onToggleStoryboardReference} aria-pressed={includeStoryboardReference} className={`flex w-full items-center gap-3 border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${includeStoryboardReference ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
                <Clapperboard className="h-4 w-4 shrink-0 text-violet-500" />
                <span className="min-w-0 flex-1 text-[10px] font-bold">使用当前选择的宫格图 / 故事板</span>
                {includeStoryboardReference ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
              </button>
              {!storyboardReferenceAvailable && <p className="mt-1 text-[9px] text-amber-600">当前选择的宫格或故事板画面尚未生成并采用，可改选其他视觉参考。</p>}
            </div>
          )}
          <div>
          <p className="mb-2 text-[10px] font-bold text-gray-500">资产参考图 · 已选 {selectedBoardItemIds.length} 张</p>
          <div className="grid gap-2 xl:grid-cols-2">
            {assetBoards.length === 0 && <p className="border border-dashed border-gray-200 p-3 text-[10px] leading-4 text-gray-400 dark:border-neutral-800">当前生成对象没有可选的正式资产参考图。</p>}
            {assetBoards.map((board) => {
              const selected = selectedBoardItemIds.includes(board.boardItemId);
              const sceneState = sceneStates.find((state) => state.assetId === board.assetId && (!board.variantId || state.variantId === board.variantId));
              return (
                <button key={board.boardItemId} type="button" aria-label={`参考 ${board.assetName}${board.variantName ? ` ${board.variantName}` : ""}`} aria-pressed={selected} data-reference-board-id={board.boardItemId} onClick={() => onToggleBoardItem(board.boardItemId)} className={`flex w-full items-center gap-3 border p-2 text-left ${selected ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 opacity-60 dark:border-neutral-800"}`}>
                  <div className="h-10 w-10 shrink-0 overflow-hidden bg-gray-100 dark:bg-neutral-800">{board.referenceImageUrl ? <img src={board.referenceImageUrl} alt={board.assetName} className="h-full w-full object-cover" /> : <ImageIcon className="m-3 h-4 w-4 text-gray-300" />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{board.assetName}{board.variantName ? ` / ${board.variantName}` : ""}</p><p className="mt-0.5 text-[9px] uppercase text-gray-400">{board.assetType} · {board.referenceOrigin}</p>{sceneState?.stateSummary && <p className="mt-1 line-clamp-2 text-[9px] leading-3 text-gray-500">本场状态：{sceneState.stateSummary}</p>}</div>
                  {selected ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                </button>
              );
            })}
          </div>
          </div>
          {adoptedImageOptions.length > 0 && <div>
            <p className="mb-2 text-[10px] font-bold text-gray-500">已采用分镜画面 · 已选 {selectedReferenceImageTakeIds.length} 张</p>
            <div className="grid gap-2 xl:grid-cols-2">
              {adoptedImageOptions.map((option) => {
                const selected = selectedReferenceImageTakeIds.includes(option.id);
                return <button key={option.id} type="button" aria-pressed={selected} onClick={() => onToggleReferenceImageTake(option.id)} className={`flex items-center gap-3 border p-2 text-left ${selected ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
                  <img src={option.mediaUrl} alt="" className="h-10 w-16 object-cover" />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-bold">{option.label}</span>
                  {selected ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                </button>;
              })}
            </div>
          </div>}
        </div>
      )}

      {acceptsReferenceVideos && priorVideoOptions.length > 0 && <div className="mt-4 border-t border-gray-100 pt-3 dark:border-neutral-800">
        <p className="mb-2 text-[10px] font-bold text-gray-500">历史视频版本 · 已选 {selectedReferenceVideoTakeIds.length} 段</p>
        <div className="grid gap-2 xl:grid-cols-2">
          {priorVideoOptions.map((option) => {
            const selected = selectedReferenceVideoTakeIds.includes(option.id);
            return <button key={option.id} type="button" aria-pressed={selected} onClick={() => onToggleReferenceVideoTake(option.id)} className={`flex items-center gap-3 border p-2 text-left ${selected ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
              <Video className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-bold">{option.label}</span>
              {selected ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
            </button>;
          })}
        </div>
      </div>}

      {acceptsReferenceAudios && (dialogueOptions.length > 0 || voiceOptions.length > 0) && <div className="mt-4 border-t border-gray-100 pt-3 dark:border-neutral-800">
        <p className="mb-2 text-[10px] font-bold text-gray-500">声音参考 · 在确认弹窗选择声音策略</p>
        <div className="grid gap-2 xl:grid-cols-2">
          {dialogueOptions.map((option) => {
            const selected = selectedDialogueTrackIds.includes(option.id);
            return <button key={`dialogue-${option.id}`} type="button" aria-pressed={selected} onClick={() => onToggleDialogueTrack(option.id)} className={`flex items-center gap-3 border p-2 text-left ${selected ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
              <Mic className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[10px] font-bold">完整配音 · {option.label}</span>{selected ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
            </button>;
          })}
          {voiceOptions.map((option) => {
            const selected = selectedVoiceReferenceIds.includes(option.id);
            return <button key={`voice-${option.id}`} type="button" aria-pressed={selected} onClick={() => onToggleVoiceReference(option.id)} className={`flex items-center gap-3 border p-2 text-left ${selected ? "border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
              <Mic className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[10px] font-bold">音色参考 · {option.label}</span>{selected ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className="h-4 w-4 text-gray-400" />}
            </button>;
          })}
        </div>
      </div>}

      {frameMode && (
        <div className={`${acceptsReferenceImages ? "mt-4 border-t border-gray-100 pt-3 dark:border-neutral-800" : ""}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {supportsStartFrame && <label className="text-[10px] font-bold text-gray-500">首帧{requiresStartFrame ? "（必选）" : "（可选）"}
              <select value={startFrameTakeId} onChange={(event) => onSelectStartTake(event.target.value)} className="mt-1 w-full border border-gray-200 bg-white p-2 text-[10px] dark:border-neutral-700 dark:bg-neutral-950">
                <option value="">{requiresStartFrame ? "请选择首帧" : "不使用首帧"}</option>
                {startFrameOptions.map((take) => <option key={`start-${take.id}`} value={take.id}>{take.label}</option>)}
              </select>
            </label>}
            {supportsEndFrame && <label className="text-[10px] font-bold text-gray-500">尾帧{requiresEndFrame ? "（必选）" : "（可选）"}
              <select value={endFrameTakeId} onChange={(event) => onSelectEndTake(event.target.value)} className="mt-1 w-full border border-gray-200 bg-white p-2 text-[10px] dark:border-neutral-700 dark:bg-neutral-950">
                <option value="">{requiresEndFrame ? "请选择尾帧" : "不使用尾帧"}</option>
                {endFrameOptions.filter((take) => take.id !== startFrameTakeId).map((take) => <option key={`end-${take.id}`} value={take.id}>{take.label}</option>)}
              </select>
            </label>}
          </div>
        </div>
      )}

      {!acceptsReferenceImages && !acceptsReferenceVideos && !acceptsReferenceAudios && !frameMode && <p className="border border-dashed border-gray-200 p-3 text-[10px] leading-4 text-gray-500 dark:border-neutral-800">当前为纯文本生成方式，不会提交资产图、宫格图、故事板或首尾帧。</p>}
    </section>
  );
}
