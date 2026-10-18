import { ManualAIResultField } from "./ManualAIResultField";
import { withManualAIResult } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, type ManualAIResult } from "../../packages/domain/src/manualAI";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { CheckSquare, Loader2, Sparkles, Wand2, X } from "lucide-react";
import type {
  SkillCategoryDTO,
  SkillDTO,
  SkillRecommendationItem,
  SkillRecommendationResult,
  SkillRecommendationTaskContext,
} from "../clients/domainTypes";
import { skillClient } from "../clients/skillClient";
import { buildSkillRecommendationPrompt, skillContentForRecommendation } from "../../packages/domain/src/skillPrompt";

interface SkillRecommendationModalProps {
  isOpen: boolean;
  title?: string;
  task: SkillRecommendationTaskContext;
  skills: SkillDTO[];
  categories: SkillCategoryDTO[];
  initialSelectedSkillIds?: string[];
  preferredCategoryIds?: string[];
  onClose: () => void;
  onApply: (skillIds: string[]) => void;
}

const useCandidateSkills = (
  skills: SkillDTO[],
  preferredCategoryIds?: string[],
) => useMemo(() => {
  if (!preferredCategoryIds?.length) return skills;
  const preferred = new Set(preferredCategoryIds);
  const matched = skills.filter((skill) => skill.categoryId && preferred.has(skill.categoryId));
  return matched.length ? matched : skills;
}, [preferredCategoryIds, skills]);

const RecommendationRow = ({
  item,
  selected,
  disabled,
  onToggle,
}: {
  item: SkillRecommendationItem;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: (id: string) => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onToggle?.(item.skillId)}
    className={`w-full rounded-xl border p-3 text-left transition ${
      selected
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : disabled
          ? "border-gray-100 bg-gray-50 text-gray-400"
          : "border-gray-100 bg-white text-gray-800 hover:border-violet-200 hover:bg-violet-50/40"
    }`}
  >
    <div className="flex items-start gap-2">
      {!disabled && (
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-300"}`}>
          {selected && <CheckSquare className="h-3 w-3" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black">{item.title}</span>
        <span className="mt-1 block text-xs font-medium leading-5 text-gray-500">{item.reason}</span>
        {(item.suggestedUse || item.confidence !== undefined) && (
          <span className="mt-2 block text-[11px] font-bold text-gray-400">
            {[item.suggestedUse, item.confidence !== undefined ? `匹配度 ${item.confidence}` : ""].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </div>
  </button>
);

export default function SkillRecommendationModal({
  isOpen,
  title = "AI 推荐 Skill",
  task,
  skills,
  categories,
  initialSelectedSkillIds = [],
  preferredCategoryIds,
  onClose,
  onApply,
}: SkillRecommendationModalProps) {
  const candidateSkills = useCandidateSkills(skills, preferredCategoryIds);
  const categoryNameById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const [prompt, setPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  useEffect(() => { if (isOpen) setManualResult(undefined); }, [isOpen]);
  const [result, setResult] = useState<SkillRecommendationResult | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setPromptEdited(false);
    setResult(null);
    setAcceptedIds([]);
    setPrompt(buildSkillRecommendationPrompt({
      ...task,
      selectedSkillTitles: skills.filter((skill) => initialSelectedSkillIds.includes(skill.id)).map((skill) => skill.title),
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
      skills: candidateSkills.map((skill) => ({
        id: skill.id,
        title: skill.title,
        categoryName: skill.categoryId ? categoryNameById.get(skill.categoryId) : undefined,
        content: skillContentForRecommendation(skill.content),
        selected: initialSelectedSkillIds.includes(skill.id),
      })),
    }));
  }, [candidateSkills, categories, categoryNameById, initialSelectedSkillIds, isOpen, skills, task]);

  if (!isOpen || typeof document === "undefined") return null;

  const requestRecommendation = async () => {
    if (!candidateSkills.length) {
      toast.error("暂无可推荐的 Skill");
      return;
    }
    setLoading(true);
    try {
      const next = await withManualAIResult(prompt, manualResult, () => skillClient.recommendSkills({
        prompt,
        task: { ...task, selectedSkillIds: initialSelectedSkillIds },
        skillIds: candidateSkills.map((skill) => skill.id),
      }));
      setResult(next);
      setAcceptedIds([]);
      toast.success("Skill 推荐已生成，请选择是否应用");
    } catch (error) {
      toast.error((error as Error)?.message || "Skill 推荐失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleAccepted = (id: string) => {
    setAcceptedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const apply = () => {
    onApply(Array.from(new Set([...initialSelectedSkillIds, ...acceptedIds])));
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-950">{title}</h2>
              <p className="mt-0.5 text-xs font-medium text-gray-400">先确认探测器提示词，AI 只推荐候选，作者选择后才注入正式提示词。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr]">
          <section className="flex min-h-0 flex-col border-r border-gray-100">
            <div className="shrink-0 border-b border-gray-100 px-5 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">探测器提示词</div>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); setPromptEdited(true); }}
              className="min-h-0 flex-1 resize-none bg-gray-50 p-5 font-mono text-xs leading-6 text-gray-700 outline-none"
            />
            {promptEdited && (
              <div className="shrink-0 border-t border-amber-100 bg-amber-50 px-5 py-2 text-xs font-bold text-amber-700">
                已手动修改探测器提示词，本次会按修改后内容推荐。
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-gray-100 px-5 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">推荐结果</div>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {!result ? (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                  <Wand2 className="mb-3 h-8 w-8 text-violet-500" />
                  <div className="text-sm font-black text-gray-800">尚未生成推荐</div>
                  <p className="mt-2 max-w-xs text-xs leading-6 text-gray-500">确认左侧提示词后，AI 会从 {candidateSkills.length} 个候选 Skill 中推荐适合当前任务的选项。</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-xs font-black text-emerald-600">建议启用</div>
                    {result.recommended.length ? result.recommended.map((item) => (
                      <RecommendationRow key={`rec-${item.skillId}`} item={item} selected={acceptedIds.includes(item.skillId)} onToggle={toggleAccepted} />
                    )) : <div className="rounded-xl border border-dashed border-gray-200 p-3 text-xs font-bold text-gray-400">暂无强推荐。</div>}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-black text-violet-600">可选</div>
                    {result.optional.length ? result.optional.map((item) => (
                      <RecommendationRow key={`opt-${item.skillId}`} item={item} selected={acceptedIds.includes(item.skillId)} onToggle={toggleAccepted} />
                    )) : <div className="rounded-xl border border-dashed border-gray-200 p-3 text-xs font-bold text-gray-400">暂无可选推荐。</div>}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-black text-gray-400">不建议本次启用</div>
                    {result.notRecommended.length ? result.notRecommended.map((item) => (
                      <RecommendationRow key={`no-${item.skillId}`} item={item} disabled />
                    )) : <div className="rounded-xl border border-dashed border-gray-200 p-3 text-xs font-bold text-gray-400">暂无不建议项。</div>}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {!result && <ManualAIResultField prompt={prompt} value={manualResult} onChange={setManualResult} kind="text" disabled={loading} />}
        <footer className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
          <div className="text-xs font-bold text-gray-400">
            已选候选：{acceptedIds.length} 个
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-black text-gray-500 hover:bg-gray-100">
              取消
            </button>
            {!result ? (
              <button type="button" onClick={requestRecommendation} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-600/20 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {hasManualAIResult(manualResult) ? "使用手动推荐结果" : "确认并推荐"}
              </button>
            ) : (
              <button type="button" onClick={apply} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-600/20">
                {acceptedIds.length ? "应用到本次提示词" : "不采用推荐，打开提示词"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
