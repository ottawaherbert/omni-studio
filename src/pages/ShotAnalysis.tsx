import { CreativeSkillComposer } from "../components/production/CreativeSkillComposer";
import React, { useEffect, useState } from "react";
import { 
  PlayCircle, Wand2, Database, LayoutTemplate, Trash2,
  Film, PlusCircle, Activity, Save, Settings2, Folder, 
  FileVideo, ChevronRight, ChevronDown, CheckCircle, X,
  FileText, Link, UploadCloud, AudioLines, Search, ChevronLeft
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import toast from "react-hot-toast";
import { useVideoAnalysisStore } from "../clients/stateClient";
import { VideoAnalysisProject, AnalysisSegment } from "../clients/domainTypes";
import { cn } from "../lib/utils";
import { generateAIContent } from "../clients/aiClient";
import { summarizeUnknownError } from "../utils/logging";
import {
  governAnalysisSegmentResult,
  governMacroDNA,
  governVideoAnalysisSkillForIntake,
} from "../clients/referenceGovernanceClient";
import PromptEditorModal from "../components/PromptEditorModal";

const shotAnalysisTypeMap: Record<string, string> = {
  movie: "院线电影",
  "tv-series": "电视剧",
  "short-drama": "微短剧",
};

const segmentAnalysisTypeMap: Record<string, string> = {
  movie: "院线电影段落",
  "tv-series": "电视剧集",
  "short-drama": "微短剧分集",
};

const buildMacroAnalysisPrompt = (project: VideoAnalysisProject) => {
  const projTypeName = shotAnalysisTypeMap[project.type || "short-drama"];
  const allSegmentContexts = project.segments
    .filter(s => !!s.analysisResult)
    .map(s => `=== ${s.title} ===\n${JSON.stringify(s.analysisResult, null, 2)}`)
    .join("\n\n");

  return `你是一个专业的影视剧作大师和制片人。请基于以下所有【${projTypeName}】的局部微观拉片合并数据，进行【全剧宏观 DNA】的提炼。
提取出该项目的起承转合结构、规律、核心主题等。

分集拉片数据：
${allSegmentContexts}

请严格返回以下 JSON 格式：
- macroDNA: { overview, structureSkeleton, coreDriver, commonBeats }
- macroSkill: 结构技能对象 { description, themeFocus, characterArchetypes, dialogueStyle, pacingAndStructure }
- characterSkill: 人设技能对象 { description, themeFocus, characterArchetypes, dialogueStyle }`;
};

const buildSegmentAnalysisPrompt = (input: {
  project: VideoAnalysisProject;
  inputMode: "text" | "url" | "video" | "audio";
  content: string;
  mediaFile?: File | null;
}) => {
  const projTypeName = segmentAnalysisTypeMap[input.project.type || "short-drama"];
  const sourceInfoPrompt = input.inputMode === "url"
    ? `视频链接为：${input.content}`
    : (input.inputMode === "video" || input.inputMode === "audio") && input.mediaFile
      ? `用户上传了${input.inputMode === "video" ? "视频" : "音频"}文件。`
      : input.content;

  return `你是一个专业的影视拉片与拆剧分析专家。当前分析的项目类型是：【${projTypeName}】。
请分析以下${input.inputMode === "audio" ? "原声音频内容与对白" : "片段内容/视频/大纲"}：
${sourceInfoPrompt}

请深度提取该片段的内蕴特征，并返回严格的 JSON 格式。包含以下字段：
- overview: 片段综述，简略总结核心内容与卖点
- shotListInfo: 叙事逻辑分镜表，返回对象数组包含 {timestamp, cameraMovement, shotSize, action, dialogue}（拆解出关键画面的视觉变化与动作，如果是音频则侧重对话节奏与冲突）
- rhythmWaves: 内部节拍与节奏曲线（情绪的高低起伏特征）
- sceneLogic: 场景编排逻辑与转换（幕结构或情节点）
- audiovisualStyle: 视听语言/听觉特色风格分析
- visualKeywords: 专门用于后期图像生成的简短英文视觉提示词数组，如 ["cyberpunk", "neon lights", "low angle"]
- characterHighlights: 人物高光时刻与原型拆解

如果在理解视频或音频上有不足，请根据其可能涉及的标签类型、平台规律进行最佳专业预测。`;
};

export default function ShotAnalysis() {
  const { 
    projects, fetchProjects, addProject, updateProject, deleteProject, addSegment, deleteSegment,
    totalProjects, currentPage, currentSearch, pageSize
  } = useVideoAnalysisStore();
  
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{type: 'project' | 'segment', projectId: string, segmentId?: string} | null>(null);
  const [searchValue, setSearchValue] = useState(currentSearch);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== currentSearch) {
        fetchProjects(1, searchValue);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchValue, currentSearch, fetchProjects]);

  const toggleProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateProject = () => {
    setShowCreateProjectModal(true);
  };

  const submitCreateProject = async (title: string, type: "movie" | "tv-series" | "short-drama") => {
    const newProject: VideoAnalysisProject = {
      id: `vap-${crypto.randomUUID()}`,
      title: title || `新建拉片项目 ${projects.length + 1}`,
      type,
      segments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addProject(newProject);
    setSelectedProjectId(newProject.id);
    setSelectedSegmentId(null);
    setExpandedProjects(prev => ({ ...prev, [newProject.id]: true }));
    setShowCreateProjectModal(false);
  };

  const handleCreateSegment = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const proj = projects.find(p => p.id === projectId);
    const index = (proj?.segments?.length || 0) + 1;
    const title = proj?.type === "movie" ? `第 ${index} 段` : `第 ${index} 集`;

    const newSegment: AnalysisSegment = {
      id: `vseg-${crypto.randomUUID()}`,
      projectId,
      title,
      mediaType: "video",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await addSegment(projectId, newSegment);
    setSelectedProjectId(projectId);
    setSelectedSegmentId(newSegment.id);
    setExpandedProjects(prev => ({ ...prev, [projectId]: true }));
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedSegment = selectedProject?.segments.find(s => s.id === selectedSegmentId);

  return (
    <div className="mx-auto w-full max-w-7xl flex px-8 pb-8 pt-4 flex-col md:flex-row gap-6 relative bg-bg-primary">
      {/* Sidebar: Project Tree */}
      <aside className="w-80 shrink-0 flex flex-col gap-4">
        {/* Title Header (Borderless) */}
        <div className="py-2 shrink-0">
          <h1 className="text-xl font-bold text-text-primary uppercase tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-text-muted" />
            拉片工作台
          </h1>
          <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-1">Video Analysis Studio</p>
        </div>

        {/* Card: Project List & Search */}
        <div className="bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm flex flex-col p-4 min-h-[480px]">
          <div className="pb-4 border-b border-border-soft/10 shrink-0 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider">项目列表</span>
              <button 
                onClick={handleCreateProject}
                className="p-2 bg-bg-surface-soft border border-border-soft/15 text-text-primary rounded-lg hover:bg-bg-surface-hover transition-colors cursor-pointer"
                title="新建拉片项目"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input 
                type="text" 
                placeholder="搜索项目..." 
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-surface-soft border border-border-soft/20 rounded-lg text-sm focus:border-border-soft/60 outline-none transition-all"
              />
            </div>
          </div>

        <div className="space-y-2 p-2 mt-4 flex-grow">
          {projects.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Folder className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-60" />
              <p className="text-xs font-bold text-text-muted">暂无项目</p>
              <button 
                onClick={handleCreateProject}
                className="mt-4 px-4 py-2 btn-primary rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                新建第一个项目
              </button>
            </div>
          ) : (
            projects.map(project => {
              const isExpanded = expandedProjects[project.id];
              const isSelectedMacro = selectedProjectId === project.id && !selectedSegmentId;

              return (
                <div key={project.id} className="select-none">
                  <div 
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setSelectedSegmentId(null);
                    }}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border",
                      isSelectedMacro 
                        ? "bg-bg-surface-soft border-border-soft/20 shadow-sm text-gold" 
                        : "bg-transparent border-transparent hover:bg-bg-surface-hover text-text-secondary"
                    )}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <button onClick={(e) => toggleProject(project.id, e)} className="p-0.5 text-text-muted hover:text-text-primary">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <Folder className={cn("w-4 h-4 shrink-0", isSelectedMacro ? "text-gold" : "text-text-muted")} />
                      <span className="text-sm font-bold truncate">{project.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => handleCreateSegment(project.id, e)}
                        className="p-1 opacity-50 hover:opacity-100 text-gold transition-opacity"
                        title="添加分集/片段"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm({ type: 'project', projectId: project.id });
                        }}
                        className="p-1 opacity-50 hover:opacity-100 text-red-500 transition-opacity"
                        title="删除项目"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Segments Tree */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden ml-6 mt-1 space-y-1 border-l border-gray-200 dark:border-neutral-800"
                      >
                        {project.segments.length === 0 ? (
                          <div className="pl-4 py-2 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                            点击 + 添加集数
                          </div>
                        ) : (
                          project.segments.map(segment => {
                            const isSelectedSeg = selectedProjectId === project.id && selectedSegmentId === segment.id;
                            const isDone = !!segment.analysisResult;
                            return (
                              <div 
                                key={segment.id}
                                onClick={() => {
                                  setSelectedProjectId(project.id);
                                  setSelectedSegmentId(segment.id);
                                }}
                                className={cn(
                                  "flex items-center justify-between pl-4 pr-3 py-2 cursor-pointer transition-all group rounded-lg",
                                  isSelectedSeg ? "bg-bg-surface-soft text-gold font-bold" : "text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary"
                                )}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  {isDone ? (
                                    <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                                  ) : (
                                    <FileVideo className="w-3.5 h-3.5 shrink-0" />
                                  )}
                                  <span className="text-xs truncate">{segment.title}</span>
                                </div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirm({ type: 'segment', projectId: project.id, segmentId: segment.id });
                                  }}
                                  className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                                  title="删除片段"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
        
        {/* Pagination Controls */}
        {totalProjects > pageSize && (
          <div className="p-3 border-t border-gray-100 dark:border-neutral-800 shrink-0 flex items-center justify-between text-sm">
            <button 
              onClick={() => fetchProjects(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-xs font-bold text-gray-500">
              {currentPage} / {Math.ceil(totalProjects / pageSize)}
            </span>
            <button 
              onClick={() => fetchProjects(currentPage + 1)}
              disabled={currentPage >= Math.ceil(totalProjects / pageSize)}
              className="p-1 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-grow min-w-0 relative flex flex-col text-text-primary">
        {!selectedProjectId ? (
          <div className="flex-grow min-h-[480px] flex items-center justify-center p-8 bg-transparent">
            <div className="text-center bg-bg-surface border border-border-soft/20 rounded-2xl p-12 max-w-md shadow-sm">
              <LayoutTemplate className="w-10 h-10 text-text-muted mb-4 opacity-55 mx-auto" />
              <h2 className="text-sm font-bold text-text-primary mb-2">选择或创建拉片项目</h2>
              <p className="text-xs text-text-muted leading-relaxed">
                将多集的分析结果汇总在一个项目中，从而提取出全剧的宏观打脸骨架与微观节奏特征。
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-6">
            {!selectedSegmentId && selectedProject ? (
              // Project Macro View
              <ProjectMacroView project={selectedProject} onUpdate={updateProject} />
            ) : selectedSegment && selectedProject ? (
              // Segment Micro View
              <SegmentMicroView project={selectedProject} segment={selectedSegment} />
            ) : null}
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreateProjectModal && (
          <CreateProjectModal
            onClose={() => setShowCreateProjectModal(false)}
            onSubmit={submitCreateProject}
          />
        )}
        
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-neutral-900 rounded-2xl shadow-xl border border-gray-200 dark:border-neutral-800 p-6 relative"
            >
              <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
                确认删除{deleteConfirm.type === 'project' ? '项目' : '片段'}？
              </h2>
              <p className="text-gray-500 text-sm mb-6">
                删除后数据无法恢复，请确认是否继续此操作。
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (deleteConfirm.type === 'project') {
                      deleteProject(deleteConfirm.projectId);
                      if (selectedProjectId === deleteConfirm.projectId) {
                        setSelectedProjectId(null);
                        setSelectedSegmentId(null);
                      }
                    } else if (deleteConfirm.segmentId) {
                      deleteSegment(deleteConfirm.projectId, deleteConfirm.segmentId);
                      if (selectedSegmentId === deleteConfirm.segmentId) {
                        setSelectedSegmentId(null);
                      }
                    }
                    toast.success('删除成功');
                    setDeleteConfirm(null);
                  }}
                  className="px-4 py-2 font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateProjectModal({ onClose, onSubmit }: { onClose: () => void, onSubmit: (title: string, type: "movie" | "tv-series" | "short-drama") => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"movie" | "tv-series" | "short-drama">("short-drama");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-xl border border-gray-200 dark:border-neutral-800 p-6 relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-6">新建拉片项目</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">项目名称</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入拉片项目名称 (e.g. 某爆款短剧拉片)"
              className="w-full px-4 py-2 bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">项目类型</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setType("movie")}
                className={cn(
                  "px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-center",
                  type === "movie" 
                    ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700"
                )}
              >
                电影
              </button>
              <button
                onClick={() => setType("tv-series")}
                className={cn(
                  "px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-center",
                  type === "tv-series" 
                    ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700"
                )}
              >
                电视剧/单元剧
              </button>
              <button
                onClick={() => setType("short-drama")}
                className={cn(
                  "px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-center",
                  type === "short-drama" 
                    ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700"
                )}
              >
                短剧
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onSubmit(title, type)}
            className="px-4 py-2 font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity"
          >
            创建
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ProjectMacroView({ project, onUpdate }: { project: VideoAnalysisProject, onUpdate: (p: VideoAnalysisProject) => void }) {
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [localTitle, setLocalTitle] = useState(project.title);
  const [isMacroPromptOpen, setIsMacroPromptOpen] = useState(false);
  const [macroPromptVariables, setMacroPromptVariables] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocalTitle(project.title);
  }, [project.id]);

  const handleTitleBlur = () => {
    if (localTitle.trim() !== project.title) {
      onUpdate({ ...project, title: localTitle.trim() || "未命名拉片项目" });
      if (!localTitle.trim()) setLocalTitle("未命名拉片项目");
    }
  };

  const openSynthesizePrompt = () => {
    if (project.segments.filter(s => !!s.analysisResult).length === 0) {
      toast.error('请至少先完成一个分集的局部拉片，再执行全局分析。');
      return;
    }
    setMacroPromptVariables({
      shotAnalysisPrompt: buildMacroAnalysisPrompt(project),
    });
    setIsMacroPromptOpen(true);
  };

  const handleSynthesize = async (finalPrompt: string) => {
    setIsMacroPromptOpen(false);
    setIsSynthesizing(true);
    let analyzingToast = toast.loading('正在跨集分析提炼全剧宏观 DNA...');

    try {
      const schema = {
        type: "OBJECT",
        properties: {
          macroDNA: {
            type: "OBJECT",
            properties: {
              overview: { type: "STRING" },
              structureSkeleton: { type: "STRING" },
              coreDriver: { type: "STRING" },
              commonBeats: { type: "STRING" }
            }
          },
          macroSkill: {
            type: "OBJECT",
            properties: {
              description: { type: "STRING" },
              themeFocus: { type: "ARRAY", items: { type: "STRING" } },
              characterArchetypes: { type: "STRING" },
              dialogueStyle: { type: "STRING" },
              pacingAndStructure: { type: "STRING" }
            }
          },
          characterSkill: {
            type: "OBJECT",
            properties: {
              description: { type: "STRING" },
              themeFocus: { type: "ARRAY", items: { type: "STRING" } },
              characterArchetypes: { type: "STRING" },
              dialogueStyle: { type: "STRING" }
            }
          }
        }
      };

      const resultText = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema,
        taskType: 'videoExtraction'
      });

      const result = JSON.parse(resultText);

      // Auto-generate macro skill (structure)
      const newMacroSkill = {
        id: `skill-macro-struct-${crypto.randomUUID()}`,
        name: `${project.title} - 总体结构骨架`,
        sourceType: "video-analysis" as const,
        category: "structure" as const,
        sourceProjectId: project.id,
        description: result.macroSkill.description,
        narrative: {
          themeFocus: result.macroSkill.themeFocus,
          characterArchetypes: result.macroSkill.characterArchetypes,
          dialogueStyle: result.macroSkill.dialogueStyle,
          pacingAndStructure: result.macroSkill.pacingAndStructure
        },
        directing: { colorPalette: "", cameraMovement: "", shotSizePreference: "", lightingStyle: "" },
        audioEditorial: { soundscape: "", editingRhythm: "" },
        promptModifiers: { scriptInstruction: "", imageAppendedTags: "", videoAppendedTags: "" },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      // Auto-generate character macro skill
      const newCharacterSkill = {
        id: `skill-macro-char-${crypto.randomUUID()}`,
        name: `${project.title} - 核心人设规律`,
        sourceType: "video-analysis" as const,
        category: "character" as const,
        sourceProjectId: project.id,
        description: result.characterSkill.description,
        narrative: {
          themeFocus: result.characterSkill.themeFocus,
          characterArchetypes: result.characterSkill.characterArchetypes,
          dialogueStyle: result.characterSkill.dialogueStyle,
          pacingAndStructure: ""
        },
        directing: { colorPalette: "", cameraMovement: "", shotSizePreference: "", lightingStyle: "" },
        audioEditorial: { soundscape: "", editingRhythm: "" },
        promptModifiers: { scriptInstruction: "", imageAppendedTags: "", videoAppendedTags: "" },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const governedMacroDNA = governMacroDNA(project, result.macroDNA, project.segments);
      const governedMacroSkill = governVideoAnalysisSkillForIntake(newMacroSkill);
      const governedCharacterSkill = governVideoAnalysisSkillForIntake(newCharacterSkill);

      onUpdate({
        ...project,
        macroDNA: governedMacroDNA,
        skills: [...(project.skills || []).filter(s => s.category !== 'structure' && s.category !== 'character'), governedMacroSkill, governedCharacterSkill]
      });

      toast.success('宏观 DNA (Macro DNA) 提炼完成！', { id: analyzingToast });
    } catch (err: any) {
      console.error("Shot analysis segment extraction failed:", summarizeUnknownError(err));
      toast.error(err.message || '提炼失败', { id: analyzingToast });
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="animate-in fade-in-50 duration-500 space-y-8">
      <div className="flex items-start justify-between">
        <div className="flex-1 mr-4">
          <input
            type="text"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-full text-3xl font-black text-gray-900 dark:text-white tracking-tight leading-tight bg-transparent border-none outline-none focus:ring-0 p-0 placeholder-gray-300 dark:placeholder-neutral-700 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors focus:bg-black/5 dark:focus:bg-white/5 px-2 -ml-2"
            placeholder="输入拉片项目名称"
          />
          <p className="text-sm text-gray-500 dark:text-neutral-400 mt-2 font-mono px-2 -ml-2">MACRO PROJECT VIEW</p>
        </div>
        <button
          onClick={openSynthesizePrompt}
          disabled={isSynthesizing}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 text-white rounded-xl text-sm font-bold shadow-md transition-all active:scale-95"
        >
          {isSynthesizing ? <Wand2 className="w-5 h-5 animate-spin" /> : <Activity className="w-5 h-5" />}
          执行全剧整体拉片
        </button>
      </div>

      {project.macroDNA ? (
        <div className="space-y-6">
          <div className="p-6 bg-bg-surface-soft border border-border-soft/20 rounded-2xl shadow-sm">
            <h3 className="text-sm font-bold uppercase text-gold tracking-widest mb-4 flex items-center gap-2">
              <Database className="w-4 h-4" />
              宏观结构骨架 (Skeleton DNA)
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed mb-4">{project.macroDNA.overview}</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-bg-surface border border-border-soft/10 rounded-xl">
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">全局起承转合</div>
                <p className="text-xs text-text-secondary leading-relaxed">{project.macroDNA.structureSkeleton}</p>
              </div>
              <div className="p-4 bg-bg-surface border border-border-soft/10 rounded-xl">
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">核心驱动力</div>
                <p className="text-xs text-text-secondary leading-relaxed">{project.macroDNA.coreDriver}</p>
              </div>
            </div>
          </div>

          <div className="p-6 bg-bg-surface-soft border border-border-soft/20 rounded-2xl shadow-sm">
             <h3 className="text-sm font-bold uppercase text-accent-amber tracking-widest mb-4 flex items-center gap-2">
              <Film className="w-4 h-4" />
              通用拉片节拍 (Global Beats)
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">{project.macroDNA.commonBeats}</p>
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border-2 border-dashed border-border-soft/25 rounded-2xl">
           <Activity className="w-10 h-10 text-text-muted mx-auto mb-4 opacity-50" />
           <h3 className="text-sm font-bold text-text-secondary mb-2">暂无宏观分析结果</h3>
           <p className="text-xs text-text-muted max-w-sm mx-auto">
             请先在左侧添加并完成各个局部集/片段的拉片后，点击右上角【执行全剧整体拉片】按钮综合提取 DNA。
           </p>
        </div>
      )}
      <PromptEditorModal
        isOpen={isMacroPromptOpen}
        onClose={() => setIsMacroPromptOpen(false)}
        templateId="shotAnalysisMacro"
        variables={macroPromptVariables}
        onConfirm={handleSynthesize}
        title="全剧整体拉片提示词确认"
        workflowStepId="shot-analysis-macro"
      />
    </div>
  );
}

function SegmentMicroView({ project, segment }: { project: VideoAnalysisProject, segment: AnalysisSegment }) {
  const [exportDirector, setExportDirector] = useState(false);
  const { updateSegment } = useVideoAnalysisStore();
  const [content, setContent] = useState(segment.sourceContent || "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [localTitle, setLocalTitle] = useState(segment.title);
  const [isSegmentPromptOpen, setIsSegmentPromptOpen] = useState(false);
  const [segmentPromptVariables, setSegmentPromptVariables] = useState<Record<string, string>>({});
  
  const [inputMode, setInputMode] = useState<'text' | 'url' | 'video' | 'audio'>('text');
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  // Sync state if segment changes
  useEffect(() => {
    setContent(segment.sourceContent || "");
    setLocalTitle(segment.title);
    setMediaFile(null);
    setInputMode('text');
  }, [segment.id]);

  const handleTitleBlur = () => {
    if (localTitle.trim() !== segment.title) {
      const index = project.segments.findIndex(s => s.id === segment.id) + 1;
      const defaultTitle = project.type === "movie" ? `第 ${index} 段` : `第 ${index} 集`;
      updateSegment(project.id, { ...segment, title: localTitle.trim() || defaultTitle });
      if (!localTitle.trim()) setLocalTitle(defaultTitle);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setMediaFile(file);
    setContent(file.name);

    if (file.type.startsWith('video/')) {
      // rough check for > 20 mins would require reading metadata, we just check size casually or show notice.
      // just trust user to read the notice.
    }
  };

  const readMediaAsBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const openAnalyzePrompt = () => {
    if (!content.trim() && !mediaFile) {
      toast.error('请提供需要分析的内容');
      return;
    }
    setSegmentPromptVariables({
      shotAnalysisPrompt: buildSegmentAnalysisPrompt({ project, inputMode, content, mediaFile }),
    });
    setIsSegmentPromptOpen(true);
  };

  const handleAnalyze = async (finalPrompt: string) => {
    setIsSegmentPromptOpen(false);
    setIsAnalyzing(true);
    let analyzingToast = toast.loading('正在执行微观拉片，由于数据量大，大模型分析可能需要一分钟左右，请耐心等待...');

    try {
      let mediaData: { base64: string; mimeType: string } | undefined = undefined;

      if ((inputMode === 'video' || inputMode === 'audio') && mediaFile) {
        toast.loading(`正在读取与处理${inputMode === 'video' ? '视频' : '音频'}文件，如果文件较大，这需要一定时间...`, { id: analyzingToast });
        const base64Url = await readMediaAsBase64(mediaFile);
        const mimeType = mediaFile.type;
        const base64Data = base64Url.split(',')[1];
        mediaData = { base64: base64Data, mimeType };
        toast.loading('文件已读取，正在提交至大模型进行深入拉片解析...', { id: analyzingToast });
      }

      const schema = {
        type: "OBJECT",
        properties: {
          overview: { type: "STRING" },
          shotListInfo: { 
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                timestamp: { type: "STRING", description: "时间戳，例如 00:00-00:05" },
                cameraMovement: { type: "STRING", description: "运镜，例如 推镜头/Pan" },
                shotSize: { type: "STRING", description: "景别，例如 特写/远景" },
                action: { type: "STRING", description: "画面/动作描述" },
                dialogue: { type: "STRING", description: "对白" }
              }
            }
          },
          rhythmWaves: { type: "STRING" },
          sceneLogic: { type: "STRING" },
          audiovisualStyle: { type: "STRING" },
          visualKeywords: { type: "ARRAY", items: { type: "STRING" } },
          characterHighlights: { type: "STRING" }
        }
      };

      const resultText = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema,
        taskType: 'videoExtraction',
        mediaData
      });

      const result = JSON.parse(resultText);
      const governedAnalysisResult = governAnalysisSegmentResult(project, {
        ...segment,
        sourceContent: inputMode === 'text' || inputMode === 'url' ? content : mediaFile?.name || "",
      }, result);

      const newSegment = {
        ...segment,
        sourceContent: inputMode === 'text' || inputMode === 'url' ? content : mediaFile?.name || "",
        analysisResult: governedAnalysisResult
      };
      
      await updateSegment(project.id, newSegment);
      
      const newBeatSkill = {
        id: `skill-beat-${crypto.randomUUID()}`,
        name: `${segment.title} - 专属内部节拍`,
        sourceType: "video-analysis" as const,
        category: "beat" as const,
        sourceProjectId: project.id,
        description: result.rhythmWaves,
        narrative: {
          themeFocus: ["微观节拍"],
          characterArchetypes: "",
          dialogueStyle: "",
          pacingAndStructure: result.sceneLogic
        },
        directing: { colorPalette: "", cameraMovement: "", shotSizePreference: "", lightingStyle: "" },
        audioEditorial: { soundscape: "", editingRhythm: "" },
        promptModifiers: { scriptInstruction: "参考拉片提取节拍：" + result.rhythmWaves + "\\n场景逻辑：" + result.sceneLogic, imageAppendedTags: result.visualKeywords?.join(", ") || "", videoAppendedTags: result.audiovisualStyle },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const newVisualSkill = {
        id: `skill-visual-${crypto.randomUUID()}`,
        name: `${segment.title} - 视听语言`,
        sourceType: "video-analysis" as const,
        category: "visual" as const,
        sourceProjectId: project.id,
        description: result.audiovisualStyle,
        narrative: { themeFocus: [], characterArchetypes: "", dialogueStyle: "", pacingAndStructure: "" },
        directing: { 
          colorPalette: "", 
          cameraMovement: "", 
          shotSizePreference: "", 
          lightingStyle: "" 
        },
        audioEditorial: { soundscape: "", editingRhythm: "" },
        promptModifiers: { scriptInstruction: "", imageAppendedTags: result.visualKeywords?.join(", ") || "", videoAppendedTags: result.audiovisualStyle },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const currentProject = useVideoAnalysisStore.getState().projects.find(p => p.id === project.id);
      if (currentProject) {
        useVideoAnalysisStore.getState().updateProject({
          ...currentProject,
          skills: [
            ...(currentProject.skills || []),
            governVideoAnalysisSkillForIntake(newBeatSkill),
            governVideoAnalysisSkillForIntake(newVisualSkill),
          ]
        });
      }

      toast.success('拉片完成，规律提取成功！', { id: analyzingToast });
    } catch (err: any) {
      console.error("Shot analysis global extraction failed:", summarizeUnknownError(err));
      toast.error(err.message || '大模型解析失败，请检查文件大小或重试', { id: analyzingToast });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClear = async () => {
    await updateSegment(project.id, { ...segment, analysisResult: undefined });
    toast.success('已清空分析结果');
  };

  return (
    <div className="animate-in fade-in-50 duration-500 space-y-8">
      <div className="flex items-start justify-between">
        <div className="flex-1 mr-4">
          <input
            type="text"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-full text-3xl font-black text-gray-900 dark:text-white tracking-tight leading-tight bg-transparent border-none outline-none focus:ring-0 p-0 placeholder-gray-300 dark:placeholder-neutral-700 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors focus:bg-black/5 dark:focus:bg-white/5 px-2 -ml-2"
            placeholder="输入片段/集数名称"
          />
          <p className="text-sm text-gray-500 dark:text-neutral-400 mt-2 font-mono px-2 -ml-2">MICRO SEGMENT ANALYSIS</p>
        </div>
        {segment.analysisResult && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 rounded-lg text-sm font-bold transition-all"
          >
            <Trash2 className="w-4 h-4" />
            清空重拉
          </button>
        )}
      </div>

      {!segment.analysisResult ? (
        <div className="p-6 bg-bg-surface-soft border border-border-soft/20 rounded-2xl shadow-sm space-y-4">
          <div className="flex bg-bg-surface border border-border-soft/20 rounded-xl p-1 w-fit">
            <button
              onClick={() => { setInputMode('text'); setContent(''); setMediaFile(null); }}
              className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer", inputMode === 'text' ? "bg-bg-surface-soft border border-border-soft/15 text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
            >
              <FileText className="w-4 h-4" /> 文本/大纲
            </button>
            <button
              onClick={() => { setInputMode('url'); setContent(''); setMediaFile(null); }}
              className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer", inputMode === 'url' ? "bg-bg-surface-soft border border-border-soft/15 text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
            >
              <Link className="w-4 h-4" /> 网络链接
            </button>
            <button
              onClick={() => { setInputMode('video'); setContent(''); setMediaFile(null); }}
              className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer", inputMode === 'video' ? "bg-bg-surface-soft border border-border-soft/15 text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
            >
              <UploadCloud className="w-4 h-4" /> 视频上传
            </button>
            <button
              onClick={() => { setInputMode('audio'); setContent(''); setMediaFile(null); }}
              className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer", inputMode === 'audio' ? "bg-bg-surface-soft border border-border-soft/15 text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary")}
            >
              <AudioLines className="w-4 h-4" /> 音频拉片
            </button>
          </div>

          <div>
            {inputMode === 'text' && (
              <textarea 
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="粘贴此片段的剧情、剧本或视频描述，例如：全城祭坛降临，大家都扔金子，主角扔了一包辣条..."
                className="w-full h-48 bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-800 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none custom-scrollbar"
              />
            )}
            {inputMode === 'url' && (
              <input 
                type="text"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="输入视频链接地址 (支持常见视频平台)"
                className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-800 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            )}
            {(inputMode === 'video' || inputMode === 'audio') && (
              <div className="flex items-center justify-center w-full h-48 bg-gray-50 dark:bg-neutral-950 border-2 border-dashed border-gray-300 dark:border-neutral-700 rounded-2xl relative hover:bg-gray-100 dark:hover:bg-neutral-900 transition-colors">
                <input 
                  type="file" 
                  accept={inputMode === 'video' ? "video/*" : "audio/*"}
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="text-center pointer-events-none p-4">
                  {inputMode === 'video' ? <UploadCloud className="w-8 h-8 text-indigo-500 mx-auto mb-2" /> : <AudioLines className="w-8 h-8 text-indigo-500 mx-auto mb-2" />}
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {mediaFile ? mediaFile.name : `点击或拖拽上传${inputMode === 'video' ? '视频' : '音频'}文件`}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    {inputMode === 'video' ? (
                      <>文件大小不做限制，建议视频时长 <span className="text-amber-500 font-bold">不超过20分钟</span></>
                    ) : (
                      "通过提取台词与对话节奏分析情绪起伏"
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button 
              onClick={openAnalyzePrompt}
              disabled={isAnalyzing || (!content.trim() && !mediaFile)}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-md transition-all active:scale-95"
            >
              {isAnalyzing ? <Wand2 className="w-5 h-5 animate-spin" /> : <Activity className="w-5 h-5" />}
              开始局部微观拉片
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <button className="rounded-md border border-border-soft px-3 py-2 text-sm text-text-primary" onClick={() => setExportDirector(true)}>整理为可复用导演 Skill</button>
          {exportDirector && <CreativeSkillComposer kind="director" initial={{ id: "analysis-draft", title: segment.title + " · 导演方法", kind: "director", source: "manual", builtin: true, createdAt: 0, updatedAt: 0, content: "", analysisBasis: "provided_analysis", analysisNotes: ["以下为已有拉片分析，请区分观察和推断；提炼导演方法时不复制剧情和对白。", segment.analysisResult.sceneLogic, segment.analysisResult.rhythmWaves, segment.analysisResult.audiovisualStyle, ...(segment.analysisResult.shotListInfo || []).map(shot => `${shot.timestamp}：${shot.shotSize}；${shot.cameraMovement}；${shot.action}`)].filter(Boolean).join("\n\n") }} onClose={() => setExportDirector(false)} onSaved={() => { setExportDirector(false); toast.success("已保存到 Skill 库，可在制作页选择。"); }} />}
          <div className="p-6 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm">
             <h3 className="text-sm font-bold uppercase text-text-primary tracking-widest mb-2 flex items-center gap-2">
               <Activity className="w-4 h-4 text-text-muted" />
               片段综述 (Segment Overview)
             </h3>
             <p className="text-sm text-text-secondary leading-relaxed font-bold">
               {segment.analysisResult.overview}
             </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
             <div className="p-5 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm overflow-x-auto">
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                   <Film className="w-4 h-4 text-text-muted" />
                   叙事逻辑分镜台账 (Industrial Shot List)
                </div>
                <div className="min-w-[600px]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border-soft/10 text-[10px] uppercase tracking-wider text-text-muted bg-bg-surface-soft">
                        <th className="p-3 font-medium w-24 rounded-tl-lg">时间戳</th>
                        <th className="p-3 font-medium w-24">景别</th>
                        <th className="p-3 font-medium w-24">运镜</th>
                        <th className="p-3 font-medium">画面/动作</th>
                        <th className="p-3 font-medium w-1/3 rounded-tr-lg">对白</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {Array.isArray(segment.analysisResult.shotListInfo) ? segment.analysisResult.shotListInfo.map((shot, i) => (
                        <tr key={i} className="border-b border-border-soft/10 hover:bg-bg-surface-hover/50 transition-colors">
                          <td className="p-3 text-text-muted font-mono align-top">{shot.timestamp}</td>
                          <td className="p-3 text-text-primary font-medium align-top">{shot.shotSize}</td>
                          <td className="p-3 text-accent-amber align-top">{shot.cameraMovement}</td>
                          <td className="p-3 text-text-secondary leading-relaxed align-top">{shot.action}</td>
                          <td className="p-3 text-text-muted italic leading-relaxed align-top">"{shot.dialogue}"</td>
                        </tr>
                      )) : null}
                    </tbody>
                  </table>
                </div>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {/* Card 2 */}
               <div className="p-5 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                     <Activity className="w-4 h-4 text-accent-amber" />
                     单集节奏波段 (Rhythm)
                  </div>
                   <div className="space-y-2">
                    {segment.analysisResult.rhythmWaves?.split('\n').map((line, i) => (
                      <p key={i} className="text-xs text-text-secondary leading-relaxed">{line}</p>
                    ))}
                  </div>
               </div>

               {/* Card 3 */}
               <div className="p-5 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                     <LayoutTemplate className="w-4 h-4 text-text-muted" />
                     场景剧本逻辑 (Logic)
                  </div>
                  <div className="space-y-2">
                    {segment.analysisResult.sceneLogic?.split('\n').map((line, i) => (
                      <p key={i} className="text-xs text-text-secondary leading-relaxed">{line}</p>
                    ))}
                  </div>
               </div>

               {/* Card 4 */}
               <div className="p-5 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm md:col-span-2">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                     <Database className="w-4 h-4 text-text-muted" />
                     视听语言与人设高光
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">视听风格</h4>
                        <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed">{segment.analysisResult.audiovisualStyle}</p>
                      </div>
                      {segment.analysisResult.visualKeywords && segment.analysisResult.visualKeywords.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">独立生图 Tag (Visual Keywords)</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {segment.analysisResult.visualKeywords.map((tag, i) => (
                              <span key={i} className="px-2 py-0.5 bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 text-[10px] rounded-md border border-gray-200 dark:border-neutral-700">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">人设高光</h4>
                      <p className="text-xs text-gray-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap">{segment.analysisResult.characterHighlights}</p>
                    </div>
                  </div>
               </div>
             </div>
        </div>
      )}
      <PromptEditorModal
        isOpen={isSegmentPromptOpen}
        onClose={() => setIsSegmentPromptOpen(false)}
        templateId="shotAnalysisSegment"
        variables={segmentPromptVariables}
        onConfirm={handleAnalyze}
        title="局部微观拉片提示词确认"
        workflowStepId="shot-analysis-segment"
      />
    </div>
  );
}
