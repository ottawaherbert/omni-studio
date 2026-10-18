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
  const [activeTab, setActiveTab] = useState<TabType>("traditional");

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

            {activeTab === "system" && (
              <motion.div
                key="system"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-10"
              >
                <header>
                  <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">O.M.N.I. 系统工作流</h1>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed max-w-2xl">
                    系统完美映射了传统电影工业流程，并利用 AI 技术极大地简化了执行难度。按照以下顺序，一个人即可完成专业团队的工作。
                  </p>
                </header>

                <div className="relative space-y-10 before:absolute before:inset-0 before:ml-6 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-emerald-500/20 before:to-transparent">
                  
                  {/* Step 1 */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-white dark:border-neutral-900 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-6 rounded-3xl bg-gray-50 dark:bg-neutral-900/50 border border-gray-100 dark:border-neutral-800 hover:border-emerald-500/30 transition-all duration-500">
                      <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1.5">Step 01</div>
                      <h4 className="text-base font-black text-gray-900 dark:text-white mb-3">构思与设定 (开发阶段)</h4>
                      <ul className="space-y-2.5">
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>设定集 (Bible)：</strong> 建立世界观、角色档案和核心设定。这是 AI 理解故事的基础。</p>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>段落/剧集 (Episodes)：</strong> 规划故事的宏观结构。 </p>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-white dark:border-neutral-900 bg-blue-500 text-white shadow-lg shadow-blue-500/20 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <LayoutIcon className="w-5 h-5" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-6 rounded-3xl bg-gray-50 dark:bg-neutral-900/50 border border-gray-100 dark:border-neutral-800 hover:border-blue-500/30 transition-all duration-500">
                      <div className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1.5">Step 02</div>
                      <h4 className="text-base font-black text-gray-900 dark:text-white mb-3">剧本与视觉规划 (前期筹备)</h4>
                      <ul className="space-y-2.5">
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-blue-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>剧本 (Script)：</strong> 编写具体的角色对白和动作描写。</p>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-blue-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>分镜 (Storyboard)：</strong> 为每个镜头生成画面草图，确定构图和运镜。</p>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-white dark:border-neutral-900 bg-amber-500 text-white shadow-lg shadow-amber-500/20 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <Video className="w-5 h-5" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-6 rounded-3xl bg-gray-50 dark:bg-neutral-900/50 border border-gray-100 dark:border-neutral-800 hover:border-amber-500/30 transition-all duration-500">
                      <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1.5">Step 03</div>
                      <h4 className="text-base font-black text-gray-900 dark:text-white mb-3">AI 拍摄与录音 (拍摄阶段)</h4>
                      <ul className="space-y-2.5">
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-amber-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>生成模块：</strong> 根据分镜提示词，生成实际的视频片段、角色配音和音效。</p>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-amber-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>资产 (Assets)：</strong> 统一管理您“拍摄”生成的所有素材。</p>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-white dark:border-neutral-900 bg-rose-500 text-white shadow-lg shadow-rose-500/20 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <Scissors className="w-5 h-5" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-6 rounded-3xl bg-gray-50 dark:bg-neutral-900/50 border border-gray-100 dark:border-neutral-800 hover:border-rose-500/30 transition-all duration-500">
                      <div className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1.5">Step 04</div>
                      <h4 className="text-base font-black text-gray-900 dark:text-white mb-3">剪辑与成片 (后期制作)</h4>
                      <ul className="space-y-2.5">
                        <li className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-rose-500" />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-neutral-400"><strong>摄影棚 (Studio)：</strong> 您的非线性剪辑台。在这里将素材拖拽到时间线上，进行剪辑、对轨，最终导出成片。</p>
                        </li>
                      </ul>
                    </div>
                  </div>

                </div>
              </motion.div>
            )}

            {activeTab === "quickstart" && (
              <motion.div
                key="quickstart"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-10"
              >
                <header>
                  <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">快速上手指南</h1>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed max-w-2xl">
                    三分钟带您完成从创意到成片的完整闭环。
                  </p>
                </header>

                <div className="grid grid-cols-1 gap-5">
                  <div className="group bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-3xl p-6 flex flex-col md:flex-row gap-6 hover:shadow-xl transition-all duration-500">
                    <div className="w-full md:w-48 h-36 rounded-2xl bg-gray-50 dark:bg-neutral-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-blue-500/20" />
                      <Sparkles className="w-10 h-10 text-emerald-500 relative z-10" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">1. 建立您的第一个故事</h3>
                      <p className="text-xs text-gray-600 dark:text-neutral-400 mb-4 leading-relaxed">
                        进入“设定集”，点击“新建角色”。输入角色的名字和性格描述，AI 会为您自动生成精美的人物立绘和背景故事。
                      </p>
                      <button className="flex items-center gap-1.5 text-[10px] font-black text-emerald-500 hover:gap-3 transition-all uppercase tracking-widest">
                        立即开始 <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="group bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-3xl p-6 flex flex-col md:flex-row gap-6 hover:shadow-xl transition-all duration-500">
                    <div className="w-full md:w-48 h-36 rounded-2xl bg-gray-50 dark:bg-neutral-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-violet-500/20" />
                      <Mic2 className="w-10 h-10 text-blue-500 relative z-10" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">2. 赋予角色声音</h3>
                      <p className="text-xs text-gray-600 dark:text-neutral-400 mb-4 leading-relaxed">
                        在“剧本”模块编写一段台词，点击对白旁的“播放”按钮。您可以为角色选择不同的音色，甚至克隆您自己的声音。
                      </p>
                      <button className="flex items-center gap-1.5 text-[10px] font-black text-blue-500 hover:gap-3 transition-all uppercase tracking-widest">
                        探索配音 <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="group bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-3xl p-6 flex flex-col md:flex-row gap-6 hover:shadow-xl transition-all duration-500">
                    <div className="w-full md:w-48 h-36 rounded-2xl bg-gray-50 dark:bg-neutral-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 to-amber-500/20" />
                      <MonitorPlay className="w-10 h-10 text-rose-500 relative z-10" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-black text-gray-900 dark:text-white mb-2">3. 导出您的处女作</h3>
                      <p className="text-xs text-gray-600 dark:text-neutral-400 mb-4 leading-relaxed">
                        在“摄影棚”完成剪辑后，点击右上角的“导出”。您可以选择 4K 高清分辨率，直接分享到社交平台。
                      </p>
                      <button className="flex items-center gap-1.5 text-[10px] font-black text-rose-500 hover:gap-3 transition-all uppercase tracking-widest">
                        导出作品 <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
