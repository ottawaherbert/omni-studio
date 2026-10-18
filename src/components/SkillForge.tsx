import { Link } from "react-router-dom";
import { ArrowRight, Wand2 } from "lucide-react";

export default function SkillForge() {
  return (
    <div className="rounded-[2rem] border border-violet-100 bg-white p-8 shadow-sm dark:border-violet-900/50 dark:bg-neutral-950">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
            <Wand2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-black text-gray-950 dark:text-white">可选的创作 Skill</h2>
          <p className="mt-3 text-sm font-bold leading-7 text-gray-500 dark:text-neutral-400">
            导演方法按工作分类，在制作页选择后指导对应环节；通用要求可在提示词弹窗中选用。不使用 Skill 也能完成整个制片流程。
          </p>
        </div>
        <Link
          to="/skills"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
        >
          打开 Skill 库
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
