import { CheckSquare, Wand2 } from "lucide-react";
import type { UniversalSkillReference } from "../clients/domainTypes";

interface BgmPromptGovernanceFieldsProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  selectedSkills: UniversalSkillReference[];
  onChooseSkills: () => void;
  finalPrompt: string;
  modelLabel: string;
  contextSummary?: string;
  blockedReason?: string;
}

const BGM_STYLES = [
  "Cinematic", "Ambient", "Electronic", "Orchestral", "Jazz", "Rock",
  "Pop", "Acoustic", "Tension", "Emotional", "Epic", "Lo-Fi",
];

export function BgmPromptGovernanceFields({
  prompt,
  onPromptChange,
  description,
  onDescriptionChange,
  selectedTags,
  onToggleTag,
  selectedSkills,
  onChooseSkills,
  finalPrompt,
  modelLabel,
  contextSummary,
  blockedReason,
}: BgmPromptGovernanceFieldsProps) {
  return (
    <>
      <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[10px] dark:border-neutral-800 dark:bg-neutral-950">
        <div><p className="font-bold text-gray-400">执行模型</p><p className="mt-1 break-words text-gray-700 dark:text-neutral-200">{modelLabel}</p></div>
        <div><p className="font-bold text-gray-400">镜头 / 音轨上下文</p><p className="mt-1 leading-4 text-gray-700 dark:text-neutral-200">{contextSummary || "独立素材生成，未绑定制片上下文"}</p></div>
        {blockedReason && <p className="text-red-600 dark:text-red-400">{blockedReason}</p>}
      </div>

      <label className="block space-y-2 text-sm font-medium text-gray-700 dark:text-neutral-300">音乐提示词 (Prompt)
        <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="描述音乐风格、乐器、情绪与节奏" className="h-24 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200" />
      </label>

      <label className="block space-y-2 text-sm font-medium text-gray-700 dark:text-neutral-300">场景描述 (可选)
        <input type="text" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="音乐服务的情境、动作和情绪变化" className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200" />
      </label>

      <div className="space-y-2"><p className="text-sm font-medium text-gray-700 dark:text-neutral-300">风格标签</p><div className="flex flex-wrap gap-2">{BGM_STYLES.map((tag) => <button key={tag} type="button" onClick={() => onToggleTag(tag)} className={`rounded-md border px-3 py-1.5 text-xs font-medium ${selectedTags.includes(tag) ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-gray-200 bg-white text-gray-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"}`}>{tag}</button>)}</div></div>

      <button type="button" onClick={onChooseSkills} className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-left dark:border-neutral-800 dark:bg-neutral-950">
        <span className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-neutral-200"><Wand2 className="h-4 w-4 text-violet-600" />通用 Skill 注入</span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400">{selectedSkills.length ? `已选 ${selectedSkills.length} 项` : "未选择"}<CheckSquare className="h-3.5 w-3.5" /></span>
      </button>

      <label className="block space-y-2 text-sm font-medium text-gray-700 dark:text-neutral-300">本次实际提交提示词
        <textarea value={finalPrompt} readOnly className="h-36 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-5 text-gray-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300" />
      </label>
    </>
  );
}
