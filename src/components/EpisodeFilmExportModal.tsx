import { useEffect, useState } from "react";
import { Film, Loader2, Subtitles } from "lucide-react";
import type { EpisodeFilmExportMode } from "../hooks/useEpisodeFilmExport";
import { Modal } from "./ui/Modal";

export const EpisodeFilmExportModal = ({
  isOpen,
  onClose,
  readyShotCount,
  imageShotCount,
  totalShotCount,
  completedSceneCount,
  completedShotCount,
  totalSceneCount,
  isExporting,
  onExport,
}: {
  isOpen: boolean;
  onClose: () => void;
  readyShotCount: number;
  imageShotCount: number;
  totalShotCount: number;
  completedSceneCount: number;
  completedShotCount: number;
  totalSceneCount: number;
  isExporting: boolean;
  onExport: (files: { subtitles?: File; mode: EpisodeFilmExportMode; resolution: 480 | 720 | 1080 | 2160; frameRate: 24 | 25 | 30 | 60 }) => Promise<unknown>;
}) => {
  const [resolution, setResolution] = useState<480 | 720 | 1080 | 2160>(1080);
  const [frameRate, setFrameRate] = useState<24 | 25 | 30 | 60>(24);
  const [subtitles, setSubtitles] = useState<File>();
  const [mode, setMode] = useState<EpisodeFilmExportMode>("storyboard");
  useEffect(() => {
    if (!isOpen) return;
    setSubtitles(undefined);
    setMode("storyboard");
  }, [isOpen]);

  const complete = totalShotCount > 0 && readyShotCount === totalShotCount;
  const storyboardReady = totalShotCount > 0 && imageShotCount === totalShotCount;
  const canExport = mode === "storyboard" ? storyboardReady : complete || completedShotCount > 0;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="导出影片"
      size="sm"
      closeOnBackdrop={!isExporting}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={isExporting} className="px-4 py-2 text-sm font-bold text-gray-500 disabled:opacity-50">
            取消
          </button>
          <button
            type="button"
            disabled={!canExport || isExporting}
            onClick={async () => {
              try {
                await onExport({ subtitles, mode, resolution, frameRate });
                onClose();
              } catch {
                // The export hook already surfaces the actionable error in a toast.
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            {mode === "storyboard"
              ? "导出整集分镜预演"
              : complete ? `导出整集 ${resolution}p` : `导出前 ${completedSceneCount} 场 ${resolution}p`}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <button type="button" onClick={() => setMode("storyboard")} disabled={isExporting} className={`rounded-md px-3 py-2 text-sm font-bold ${mode === "storyboard" ? "bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white" : "text-gray-500"}`}>
            分镜预演
          </button>
          <button type="button" onClick={() => setMode("video")} disabled={isExporting} className={`rounded-md px-3 py-2 text-sm font-bold ${mode === "video" ? "bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white" : "text-gray-500"}`}>
            正式视频
          </button>
        </div>
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {mode === "storyboard" ? `分镜图 ${imageShotCount}/${totalShotCount}` : `正式视频 ${readyShotCount}/${totalShotCount}`}
        </div>
        {mode === "storyboard" ? (
          <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">按镜头时长直接使用分镜图生成完整预演，不调用视频模型，也不会产生生成费用。</p>
        ) : !complete && completedShotCount > 0 && (
          <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
            将按故事顺序导出已连续完成的前 {completedSceneCount}/{totalSceneCount} 场，共 {completedShotCount} 个镜头。
          </p>
        )}
        {mode === "video" && <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">声音包含视频原声和未静音的时间轴音轨，使用各音轨保存的音量。</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">分辨率<select aria-label="导出分辨率" value={resolution} disabled={isExporting} onChange={e => setResolution(Number(e.target.value) as typeof resolution)} className="mt-2 block w-full rounded border border-gray-300 bg-transparent p-2">{[480, 720, 1080, 2160].map(value => <option key={value} value={value}>{value}p</option>)}</select></label>
          <label className="text-sm">帧率<select aria-label="导出帧率" value={frameRate} disabled={isExporting} onChange={e => setFrameRate(Number(e.target.value) as typeof frameRate)} className="mt-2 block w-full rounded border border-gray-300 bg-transparent p-2">{[24, 25, 30, 60].map(value => <option key={value} value={value}>{value} fps</option>)}</select></label>
        </div>
        <p className="text-xs text-gray-500">升高输出分辨率不会补回低清素材的细节。转场在原片段时长内完成，不移动对白和音轨。</p>
        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100"><Subtitles className="h-4 w-4" />中文字幕</span>
          <input aria-label="中文字幕" type="file" accept=".srt,application/x-subrip,text/plain" onChange={(event) => setSubtitles(event.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:font-bold" />
        </label>
      </div>
    </Modal>
  );
};
