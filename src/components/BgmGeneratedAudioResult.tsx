import { Play, Save, Square } from "lucide-react";

interface BgmGeneratedAudioResultProps {
  isPlaying: boolean;
  audited: boolean;
  onTogglePlay: () => void;
  onSave: () => void;
}

export function BgmGeneratedAudioResult({ isPlaying, audited, onTogglePlay, onSave }: BgmGeneratedAudioResultProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-900/20">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onTogglePlay} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500">
          {isPlaying ? <Square className="h-4 w-4 fill-current" /> : <Play className="ml-1 h-4 w-4 fill-current" />}
        </button>
        <div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">生成完毕</p><p className="text-xs text-emerald-600/70 dark:text-emerald-500/70">{audited ? "已写入当前音轨审计，可试听后保存到资产库" : "上游状态已变化，仅可试听，不可采用"}</p></div>
      </div>
      <button type="button" onClick={onSave} disabled={!audited} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" />保存至资产库并绑定</button>
    </div>
  );
}
