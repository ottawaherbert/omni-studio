import { Link } from 'react-router-dom';
import { productionStages } from '../config/productionNavigation';
import { useState } from "react";
import { 
  BookOpen, 
  Film, 
  Clapperboard, 
  Video, 
  Scissors, 
  CheckCircle2, 
  ChevronRight,
  Sparkles,
  Layout as LayoutIcon,
  Mic2,
  MonitorPlay,
  ArrowRight,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = "traditional" | "system" | "quickstart";

export default function Guide() {
  const [activeTab, setActiveTab] = useState<TabType>("quickstart");

  const sidebarItems = [
    { id: "traditional", label: "传统电影工业流程", icon: Film, color: "text-blue-500" },
    { id: "system", label: "O.M.N.I. 系统工作流", icon: Clapperboard, color: "text-emerald-500" },
    { id: "quickstart", label: "快速上手指南", icon: Sparkles, color: "text-violet-500" },
  ];

  return (
    <div className="flex flex-col md:flex-row h-full bg-white dark:bg-neutral-950 overflow-hidden">
      {/* Sidebar */}
      <div className="w-full md:w-72 border-r border-gray-100 dark:border-neutral-900 bg-gray-50/30 dark:bg-neutral-900/10 p-6 flex flex-col shrink-0 overflow-y-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">使用指南</h2>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">User Manual</p>
          </div>
        </div>

        <nav className="space-y-1.5 flex-1">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as TabType)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all group relative overflow-hidden",
                activeTab === item.id
                  ? "bg-white dark:bg-neutral-900 text-gray-900 dark:text-white shadow-sm border border-gray-100 dark:border-neutral-800"
                  : "text-gray-500 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-900/50"
              )}
            >
              {activeTab === item.id && (
                <motion.div 
                  layoutId="active-pill-guide"
                  className="absolute left-0 w-1 h-5 bg-emerald-500 rounded-r-full"
                />
              )}
              <item.icon className={cn("w-4 h-4 transition-colors", activeTab === item.id ? item.color : "text-gray-400")} />
              {item.label}
              <ChevronRight className={cn("w-3.5 h-3.5 ml-auto transition-transform", activeTab === item.id ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0")} />
            </button>
          ))}
        </nav>

        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-neutral-900">
          <div className="bg-emerald-50 dark:bg-emerald-500/5 rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-500/10">
            <div className="flex items-center gap-2 mb-1.5">
              <Info className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">需要帮助？</span>
            </div>
            <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/60 leading-relaxed">
              如果您在使用过程中遇到任何问题，请随时联系我们的技术支持团队。
            </p>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8 md:p-12 custom-scrollbar bg-white dark:bg-neutral-950">
        <div className="max-w-4xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === "traditional" && (
              <motion.div
                key="traditional"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-10"
              >
                <header>
                  <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">传统电影工业流程</h1>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed max-w-2xl">
                    理解标准制作流程是掌握 O.M.N.I. 系统的关键。我们将复杂的工业体系简化为五个核心阶段。
                  </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="col-span-1 md:col-span-2 bg-blue-50 dark:bg-blue-500/5 p-6 rounded-3xl border border-blue-100 dark:border-blue-500/10 group hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-500">
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-sm border border-blue-100 dark:border-blue-500/20">
                        <BookOpen className="w-6 h-6 text-blue-500" />
                      </div>
                      <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-full border border-blue-100 dark:border-blue-500/20">Phase 01</span>
                    </div>
                    <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">开发阶段 (Development)</h3>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">
                      一切的起点。在这个阶段，创意被转化为可落地的文学雏形。核心产出包括：<strong>故事梗概 (Synopsis)</strong>、<strong>人物小传</strong>、<strong>世界观设定</strong>以及<strong>剧本大纲 (Treatment)</strong>。这是确立电影灵魂的阶段。
                    </p>
                  </div>

                  <div className="bg-emerald-50 dark:bg-emerald-500/5 p-6 rounded-3xl border border-emerald-100 dark:border-emerald-500/10 group hover:shadow-xl hover:shadow-emerald-500/5 transition-all duration-500">
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-sm border border-emerald-100 dark:border-emerald-500/20">
                        <LayoutIcon className="w-6 h-6 text-emerald-500" />
                      </div>
                      <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em] bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-full border border-emerald-100 dark:border-emerald-500/20">Phase 02</span>
                    </div>
                    <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">前期筹备 (Pre-production)</h3>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">
                      将文字转化为可执行的视觉计划。核心工作包括：撰写并定稿<strong>完整剧本 (Script)</strong>、进行<strong>剧本拆解 (Breakdown)</strong>、绘制<strong>分镜头脚本 (Storyboard)</strong>、选角及勘景。
                    </p>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-500/5 p-6 rounded-3xl border border-amber-100 dark:border-amber-500/10 group hover:shadow-xl hover:shadow-amber-500/5 transition-all duration-500">
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-sm border border-amber-100 dark:border-amber-500/20">
                        <Video className="w-6 h-6 text-amber-500" />
                      </div>
                      <span className="text-[9px] font-black text-amber-500 uppercase tracking-[0.2em] bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-full border border-amber-100 dark:border-amber-500/20">Phase 03</span>
                    </div>
                    <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">拍摄阶段 (Production)</h3>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">
                      剧组正式开机。所有的前期准备都在此刻转化为实际的<strong>视频素材 (Footage)</strong> 和 <strong>音频素材</strong>。这是整个流程中最耗费资源和精力的核心环节。
                    </p>
                  </div>

                  <div className="bg-rose-50 dark:bg-rose-500/5 p-6 rounded-3xl border border-rose-100 dark:border-rose-500/10 group hover:shadow-xl hover:shadow-rose-500/5 transition-all duration-500">
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-sm border border-rose-100 dark:border-rose-500/20">
                        <Scissors className="w-6 h-6 text-rose-500" />
                      </div>
                      <span className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em] bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-full border border-rose-100 dark:border-rose-500/20">Phase 04</span>
                    </div>
                    <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">后期制作 (Post-production)</h3>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">
                      素材的二次创作。包括：<strong>剪辑 (Editing)</strong>、<strong>视觉特效 (VFX)</strong>、<strong>色彩调配 (Color Grading)</strong> 以及 <strong>声音设计与混音</strong>。电影最终在这里成型。
                    </p>
                  </div>

                  <div className="bg-violet-50 dark:bg-violet-500/5 p-6 rounded-3xl border border-violet-100 dark:border-violet-500/10 group hover:shadow-xl hover:shadow-violet-500/5 transition-all duration-500">
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-sm border border-violet-100 dark:border-violet-500/20">
                        <MonitorPlay className="w-6 h-6 text-violet-500" />
                      </div>
                      <span className="text-[9px] font-black text-violet-500 uppercase tracking-[0.2em] bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-full border border-violet-100 dark:border-violet-500/20">Phase 05</span>
                    </div>
                    <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">发行阶段 (Distribution)</h3>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">
                      作品最终呈现给观众。包括：<strong>市场营销 (Marketing)</strong>、<strong>院线发行</strong>或<strong>流媒体上线</strong>。这是电影生命周期的终点。
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab !== "traditional" && <section className="space-y-7 text-text-primary">
              <header><h1 className="text-xl font-semibold">{activeTab === 'quickstart' ? '从哪里开始' : '当前系统流程'}</h1><p className="mt-2 text-sm leading-6 text-text-muted">先确定内容，再制作画面与声音。每一步都能修改；已有成果保留，来源变化会提示复核。</p></header>
              <div className="divide-y divide-border-soft border-y border-border-soft">
                {[{ path: '/writing', title: '写作', task: '创建或打开作品，编辑大纲、分场与正文。需要外部模型协作时打开“写作任务”，复制要求、回填返回、检查后采用；不会自动继续写作。已有剧本可直接导入制片。' }, ...productionStages, { path: '/interactive', title: '互动作品', task: '设计选择与状态，绑定剧本和制作素材，试玩后导出互动运行包。' }].map((step, i) => <div key={step.path} className="flex items-start justify-between gap-6 py-5"><div><h2 className="text-sm font-semibold">{i + 1}. {step.title}</h2><p className="mt-2 text-sm leading-6 text-text-secondary">{step.task}</p></div><Link className="shrink-0 rounded-md border border-border-soft px-3 py-2 text-xs hover:text-gold" to={step.path}>进入{step.title}</Link></div>)}
              </div>
              <div className="space-y-3 text-sm leading-6 text-text-secondary"><h2 className="font-semibold text-text-primary">生成时只需要一处设置</h2><p>从项目资产、宫格预览或摄影棚打开生成工作台，选择参考素材和用途，调整方案参数，检查后允许本次生成。结果先保存为候选，检查通过后再采用。无限画布与清单操作的是同一份任务。</p><p>角色音色在项目资产的“角色声音”中设置；对白、背景音乐和混音在摄影棚处理。视频模型是否接收参考音频，以工作台显示的能力为准。</p><p>成片导出、分镜预演与互动运行包用途不同。生成成功也不代表镜头衔接或创作质量已通过。</p></div>
              <div className="flex gap-5 text-sm text-gold"><Link to="/settings">配置生成与配音服务</Link><Link to="/image-gen">独立生成与外部图片导入</Link><Link to="/assets">全局资产与音色库</Link></div>
            </section>}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
