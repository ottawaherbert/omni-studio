import { isGeneralSkill } from "../clients/creativeDirectionClient";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, X, Wand2 } from "lucide-react";
import { useSkillStore } from "../clients/stateClient";
import type { SkillDTO, UniversalSkillReference } from "../clients/domainTypes";
import { cn } from "../lib/utils";

interface SkillOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedSkills: UniversalSkillReference[]) => void;
  initialSelectedSkills: UniversalSkillReference[];
}

const toSceneSkillSnapshot = (skill: SkillDTO): UniversalSkillReference => ({
  id: skill.id,
  kind: skill.kind || "general",
  title: skill.title,
  content: skill.content,
  categoryId: skill.categoryId,
  source: skill.source,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
});

export default function SkillOverrideModal({
  isOpen,
  onClose,
  onConfirm,
  initialSelectedSkills,
}: SkillOverrideModalProps) {
  const { skills: allSkills, fetchSkills } = useSkillStore();
  const skills = allSkills.filter(isGeneralSkill);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchSkills();
    setSelectedSkillIds(initialSelectedSkills.map((skill) => skill.id));
  }, [fetchSkills, initialSelectedSkills, isOpen]);

  if (typeof document === "undefined") return null;

  const toggleSkillSelection = (skillId: string) => {
    setSelectedSkillIds((current) =>
      current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId],
    );
  };

  const handleConfirm = () => {
    const selected = skills
      .filter((skill) => selectedSkillIds.includes(skill.id))
      .map(toSceneSkillSnapshot);
    onConfirm(selected);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 p-6 dark:border-neutral-800 dark:bg-neutral-900/80">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-100 p-2 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                  <Wand2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black tracking-tight text-gray-900 dark:text-white">场景通用 Skill</h2>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-neutral-400">
                    这里选择通用创作要求；导演方法请在制作页的“导演”设置中选择。
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 overflow-auto bg-gray-50 p-6 dark:bg-neutral-950">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {skills.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm font-bold text-gray-400 dark:border-neutral-800 dark:bg-neutral-900">
                    暂无通用 Skill，请先到 Skill 库创建。
                  </div>
                ) : (
                  skills.map((skill) => {
                    const isSelected = selectedSkillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkillSelection(skill.id)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all",
                          isSelected
                            ? "border-violet-200 bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/50"
                            : "border-gray-100 bg-white text-gray-900 hover:border-gray-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:hover:border-neutral-700",
                        )}
                      >
                        <div className={cn("mt-0.5 shrink-0 rounded-full p-1", isSelected ? "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400" : "bg-gray-100 text-gray-400 dark:bg-neutral-800")}>
                          {isSelected ? <Check className="h-3 w-3" /> : <div className="h-3 w-3" />}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold">{skill.title}</h3>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-neutral-400">
                            {skill.content || "无内容"}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-gray-200 bg-gray-50 p-6 dark:border-neutral-800 dark:bg-neutral-900/80">
              <button
                onClick={() => setSelectedSkillIds([])}
                className="px-4 py-2 text-sm font-bold text-gray-500 transition-colors hover:text-gray-900 dark:text-neutral-400 dark:hover:text-white"
              >
                清除选择
              </button>
              <button
                onClick={onClose}
                className="rounded-xl bg-gray-200 px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-xl bg-violet-600 px-8 py-2 text-sm font-black uppercase tracking-widest text-white shadow-md transition-all hover:bg-violet-500 hover:shadow-lg"
              >
                确认应用
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
