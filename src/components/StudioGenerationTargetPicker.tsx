import { CheckCircle2, Clapperboard, Film, Grid3X3, ImageIcon, Video } from "lucide-react";
import type { ManualStoryboardBoardWorkflow, Shot, StoryboardVisualReferenceMode } from "../clients/domainTypes";
import { buildStoryboardCompositeVisualPages, getActiveStoryboardBoardVisualTake, resolveReadyStoryboardShotGridImage, storyboardShotGridStatus } from "../clients/productionStoryboardWorkflowClient";
import { evaluateStandaloneShotDuration } from "../clients/productionStudioWorkflowClient";

export type StudioGenerationTargetSelection =
  | { kind: "shot" }
  | { kind: "storyboard_board"; pageId: string; panelId?: string };

interface StudioGenerationTargetPickerProps {
  shot: Shot;
  shots: Shot[];
  workflow?: ManualStoryboardBoardWorkflow;
  selection: StudioGenerationTargetSelection;
  onChange: (selection: StudioGenerationTargetSelection) => void;
  referenceMode: StoryboardVisualReferenceMode;
  onReferenceModeChange: (mode: StoryboardVisualReferenceMode) => void;
}

export function StudioGenerationTargetPicker({
  shot,
  shots,
  workflow,
  selection,
  onChange,
  referenceMode,
  onReferenceModeChange,
}: StudioGenerationTargetPickerProps) {
  const shotDurationPolicy = evaluateStandaloneShotDuration(shot);
  const board = workflow?.board;
  const pages = board
    ? (board.visualPages?.length ? board.visualPages : buildStoryboardCompositeVisualPages(board))
    : [];
  const firstPage = pages[0];
  const targetSelected = selection.kind === "shot" || pages.some(page => page.id === selection.pageId);

  return (
    <section className="space-y-4 border-b border-border-soft/30 pb-4" aria-label="制作对象">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-gold" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">制作对象</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium ${targetSelected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}><CheckCircle2 className="h-3 w-3" />{targetSelected ? "对象已选" : "请检查生成对象"}</span>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">选择本次要制作的镜头或片段；参考素材与生成参数在工作台设置。</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-bold text-gray-500">生成对象</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="摄影棚生成对象">
          <button type="button" onClick={() => onChange({ kind: "shot" })} aria-pressed={selection.kind === "shot"} className={`flex min-h-10 items-center justify-center gap-2 border px-3 text-xs font-bold ${selection.kind === "shot" ? "border-gold bg-gold/10 text-gold" : "border-gray-200 text-gray-600 dark:border-neutral-700 dark:text-neutral-300"}`}><Film className="h-4 w-4" />分镜</button>
          <button type="button" disabled={!firstPage} onClick={() => firstPage && onChange({ kind: "storyboard_board", pageId: firstPage.id })} aria-pressed={selection.kind === "storyboard_board"} className={`flex min-h-10 items-center justify-center gap-2 border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${selection.kind === "storyboard_board" ? "border-gold bg-gold/10 text-gold" : "border-gray-200 text-gray-600 dark:border-neutral-700 dark:text-neutral-300"}`}><Clapperboard className="h-4 w-4" />视频单元</button>
        </div>
        {selection.kind === "shot" && !shotDurationPolicy.valid && <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">{shotDurationPolicy.reason}</p>}
      </div>

      {selection.kind === "storyboard_board" && board && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold text-gray-500">视频单元参考画面</p>
            <div className="flex items-center border border-gray-200 bg-gray-50 p-1 dark:border-neutral-700 dark:bg-neutral-950" role="group" aria-label="摄影棚故事板参考模式">
              <button type="button" onClick={() => onReferenceModeChange("shot_grid")} aria-pressed={referenceMode === "shot_grid"} className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-bold ${referenceMode === "shot_grid" ? "bg-bg-surface text-gold shadow-sm" : "text-gray-500"}`}><Grid3X3 className="h-3.5 w-3.5" />宫格模式</button>
              <button type="button" onClick={() => onReferenceModeChange("director_board")} aria-pressed={referenceMode === "director_board"} className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-bold ${referenceMode === "director_board" ? "bg-bg-surface text-gold shadow-sm" : "text-gray-500"}`}><Clapperboard className="h-3.5 w-3.5" />故事板模式</button>
            </div>
          </div>
          <p className="mb-2 text-[10px] text-gray-400">与故事板页面使用同一个选择，任一处切换都会同步到另一处。</p>
          <div className="grid grid-cols-1 gap-2">
            {pages.map((page) => {
              const take = getActiveStoryboardBoardVisualTake(page);
              const gridStatus = storyboardShotGridStatus({ board, page, shots });
              const imageUrl = referenceMode === "shot_grid" ? resolveReadyStoryboardShotGridImage({ board, page, shots }) : take?.imageUrl;
              const selected = selection.pageId === page.id;
              return <button key={page.id} type="button" onClick={() => onChange({ kind: "storyboard_board", pageId: page.id })} className={`relative aspect-video overflow-hidden border ${selected ? "border-gold bg-gold/10" : "border-gray-200 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-950"}`} title={`第 ${page.pageIndex + 1} 页${referenceMode === "shot_grid" ? "宫格" : "故事板"}`}>
                {imageUrl ? <img src={imageUrl} alt={`第 ${page.pageIndex + 1} 页${referenceMode === "shot_grid" ? "宫格" : "故事板"}`} className="h-full w-full object-contain" referrerPolicy="no-referrer" /> : <span className="flex h-full items-center justify-center gap-2 px-3 text-[10px] text-gray-400"><ImageIcon className="h-4 w-4" />{referenceMode === "shot_grid" && gridStatus === "stale" ? "请回故事板更新宫格图" : "当前版本待生成"}</span>}
                <span className="absolute bottom-1 left-1 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">第 {page.pageIndex + 1} 页 · {page.panelIds.length} 个分镜</span>
              </button>;
            })}
          </div>
        </div>
      )}


    </section>
  );
}
