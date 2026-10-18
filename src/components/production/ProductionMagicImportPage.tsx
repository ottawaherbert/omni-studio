import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Film,
  LayoutGrid,
  ListPlus,
  Minus,
  Palette,
  Sparkles,
  Tv,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { sha256 } from "js-sha256";
import { cn } from "../../lib/utils";

import { useProjectStore } from "../../clients/stateClient";
import { generateAIContent } from "../../clients/aiClient";
import { safeParseAIResponse } from "../../utils/aiParser";
import { createProductionProjectFromMagicSource, type ProductionMagicSourceFormat, type ProductionMagicTargetFormat } from "../../clients/productionPreparationWorkflowClient";
import type { ProductionSourceDocument, VisualImplementationMedium } from "../../clients/domainTypes";
import PromptEditorModal from "../PromptEditorModal";
import type { PromptEditorConfirmMetadata } from "../PromptEditorModal";
import { ProjectVisualSeedFields } from "./ProjectVisualSeedFields";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

type MovieInputMode = "whole" | "segments";

interface SourceUnitInput {
  id: string;
  title: string;
  content: string;
}

interface AdaptedSourceCandidate {
  sourceId: string;
  scriptText: string;
  metadata?: PromptEditorConfirmMetadata;
  prompt: string;
}

const formats: Array<{ id: ProductionMagicTargetFormat; label: string; hint: string; icon: typeof Film }> = [
  { id: "movie", label: "电影", hint: "一部完整长片或作者明确的多个段落", icon: Film },
  { id: "tv-series", label: "电视剧", hint: "按集录入，每集是独立来源工作范围", icon: Tv },
  { id: "short-drama", label: "短剧", hint: "按集录入，后续再进入制片场次规划", icon: FileText },
];

const sourceLabels: Record<ProductionMagicSourceFormat, string> = { script: "剧本", novel: "小说" };
const formatLabels: Record<ProductionMagicTargetFormat, string> = { movie: "电影", "tv-series": "电视剧", "short-drama": "短剧" };

const mediumLabels: Record<string, string> = {
  live_action: "真人实拍",
  "2d_animation": "2D 动画",
  "3d_animation": "3D 动画",
  stop_motion: "定格动画",
  mixed_media: "混合媒介",
};

const newSourceUnit = (): SourceUnitInput => ({ id: crypto.randomUUID(), title: "", content: "" });

const unitsForCount = (count: number) => Array.from({ length: count }, () => newSourceUnit());

const stableOrder = (units: SourceUnitInput[]) => units.map((unit, index) => ({ ...unit, order: index + 1 }));

const sourceTitle = (format: ProductionMagicTargetFormat, mode: MovieInputMode, index: number, customTitle = "") => {
  if (customTitle.trim()) return customTitle.trim();
  if (format === "movie" && mode === "whole") return "完整电影来源";
  if (format === "movie") return `电影第 ${index + 1} 段`;
  return `第 ${index + 1} 集`;
};

export function ProductionMagicImportPage() {
  const navigate = useNavigate();
  const { createProject } = useProjectStore();
  const [projectName, setProjectName] = useState("");
  const [sourceFormat, setSourceFormat] = useState<ProductionMagicSourceFormat>("script");
  const [targetFormat, setTargetFormat] = useState<ProductionMagicTargetFormat>("movie");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [visualStyleSeed, setVisualStyleSeed] = useState<VisualImplementationMedium | null>(null);
  const [isVisualSeedOpen, setIsVisualSeedOpen] = useState(false);
  const [movieMode, setMovieMode] = useState<MovieInputMode>("whole");
  const [episodeCount, setEpisodeCount] = useState(1);
  const [units, setUnits] = useState<SourceUnitInput[]>([newSourceUnit()]);
  const [activeUnitId, setActiveUnitId] = useState(units[0].id);
  const [promptUnitId, setPromptUnitId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<AdaptedSourceCandidate | null>(null);
  const [adaptedScripts, setAdaptedScripts] = useState<Record<string, AdaptedSourceCandidate>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMatrixOpen, setIsMatrixOpen] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);

  const EPISODES_PER_GROUP = 20;

  const orderedUnits = useMemo(() => stableOrder(units), [units]);
  const totalUnits = orderedUnits.length;
  const groupCount = Math.ceil(totalUnits / EPISODES_PER_GROUP);
  const activeIndex = Math.max(0, orderedUnits.findIndex((unit) => unit.id === activeUnitId));
  const activeUnit = orderedUnits[activeIndex] || orderedUnits[0];
  const isSeries = targetFormat !== "movie";
  const filledUnits = orderedUnits.filter((unit) => unit.content.trim());
  const missingNovelAdoptions = sourceFormat === "novel"
    ? filledUnits.filter((unit) => !adaptedScripts[unit.id])
    : [];
  const canImport = Boolean(projectName.trim()) && filledUnits.length > 0 && missingNovelAdoptions.length === 0;
  const importHint = !projectName.trim()
    ? "请填写项目名称"
    : filledUnits.length === 0
      ? "请粘贴正文或读取 TXT 文件"
      : missingNovelAdoptions.length > 0
        ? `还有 ${missingNovelAdoptions.length} 个单元需要转为剧本并采用`
        : `已录入 ${filledUnits.length} 个单元，可以导入`;

  const resetAdaptations = () => setAdaptedScripts({});
  const replaceUnits = (next: SourceUnitInput[]) => {
    setUnits(next);
    setActiveUnitId(next[0]?.id || "");
    setSelectedGroup(0);
    resetAdaptations();
  };

  const changeTargetFormat = (format: ProductionMagicTargetFormat) => {
    if (format === targetFormat) return;
    setTargetFormat(format);
    setAspectRatio(format === "short-drama" ? "9:16" : "16:9");
    const next = format === "movie" ? [newSourceUnit()] : unitsForCount(episodeCount);
    replaceUnits(next);
  };

  const changeEpisodeCount = (rawCount: number) => {
    const nextCount = Math.max(1, Math.min(100, Number.isFinite(rawCount) ? Math.floor(rawCount) : 1));
    if (nextCount === episodeCount) return;
    setEpisodeCount(nextCount);
    const next = Array.from({ length: nextCount }, (_, index) => units[index] || newSourceUnit());
    replaceUnits(next);
  };

  const changeMovieMode = (mode: MovieInputMode) => {
    if (mode === movieMode) return;
    setMovieMode(mode);
    replaceUnits(mode === "whole" ? [newSourceUnit()] : [newSourceUnit(), newSourceUnit()]);
  };

  const handleNextUnit = () => {
    if (activeIndex < totalUnits - 1) {
      const nextUnit = orderedUnits[activeIndex + 1];
      setActiveUnitId(nextUnit.id);
      if (totalUnits > EPISODES_PER_GROUP && !showAllEpisodes) {
        const nextGroup = Math.floor((activeIndex + 1) / EPISODES_PER_GROUP);
        if (nextGroup !== selectedGroup) {
          setSelectedGroup(nextGroup);
        }
      }
    }
  };

  const handlePrevUnit = () => {
    if (activeIndex > 0) {
      const prevUnit = orderedUnits[activeIndex - 1];
      setActiveUnitId(prevUnit.id);
      if (totalUnits > EPISODES_PER_GROUP && !showAllEpisodes) {
        const prevGroup = Math.floor((activeIndex - 1) / EPISODES_PER_GROUP);
        if (prevGroup !== selectedGroup) {
          setSelectedGroup(prevGroup);
        }
      }
    }
  };

  const updateUnitContent = (id: string, content: string) => {
    setUnits((current) => current.map((unit) => unit.id === id ? { ...unit, content } : unit));
    setAdaptedScripts((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const updateUnitTitle = (id: string, title: string) => {
    setUnits((current) => current.map((unit) => unit.id === id ? { ...unit, title } : unit));
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/production");
    }
  };

  const generateNovelScript = async (finalPrompt: string, _intent?: string, metadata?: PromptEditorConfirmMetadata) => {
    if (!promptUnitId) return;
    setIsGenerating(true);
    try {
      const { Type } = await import("../../clients/aiSchemaClient");
      const response = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema: { type: Type.OBJECT, properties: { scriptText: { type: Type.STRING } } },
      });
      const parsed = safeParseAIResponse<{ scriptText?: unknown }>(response, {});
      const scriptText = String(parsed.scriptText || "").trim();
      if (!scriptText) throw new Error("模型没有返回可采用的剧本正文。");
      setCandidate({ sourceId: promptUnitId, scriptText, metadata, prompt: finalPrompt });
      setPromptUnitId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "小说转剧本失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const adoptCandidate = () => {
    if (!candidate) return;
    setAdaptedScripts((current) => ({ ...current, [candidate.sourceId]: candidate }));
    setCandidate(null);
    toast.success("剧本候选已采用为该来源单元");
  };

  const buildSourceDocuments = (): ProductionSourceDocument[] => {
    const now = Date.now();
    const result: ProductionSourceDocument[] = [];
    filledUnits.forEach((unit, index) => {
      const title = sourceTitle(targetFormat, movieMode, index, unit.title);
      const base = { order: index + 1, title, createdAt: now };
      const kind = targetFormat === "movie" ? (movieMode === "whole" ? "whole" : "segment") : "episode" as const;
      if (sourceFormat === "script") {
        result.push({
          ...base,
          id: `prod_source_${unit.id}`,
          kind,
          content: unit.content.trim(),
          sourceHash: sha256(unit.content.trim()),
          isWorkRange: true,
        });
        return;
      }
      const originalId = `prod_source_novel_${unit.id}`;
      const adapted = adaptedScripts[unit.id];
      if (!adapted) throw new Error(`${title} 尚未采用小说转剧本候选。`);
      result.push({
        ...base,
        id: originalId,
        kind,
        title: `${title}原小说`,
        content: unit.content.trim(),
        sourceHash: sha256(unit.content.trim()),
        isWorkRange: false,
      });
      result.push({
        ...base,
        id: `prod_source_script_${unit.id}`,
        order: index + 1,
        kind: "adapted_script",
        title: `${title}剧本`,
        content: adapted.scriptText,
        sourceHash: sha256(adapted.scriptText),
        isWorkRange: true,
        originalSourceDocumentId: originalId,
      });
    });
    return result;
  };

  const confirmImport = async () => {
    if (!canImport) {
      toast.error(!projectName.trim()
        ? "请先填写项目名称。"
        : sourceFormat === "novel" && missingNovelAdoptions.length
          ? "请先采用每个已填写单元的剧本候选。"
          : "请先填写至少一个来源单元。");
      return;
    }
    setIsImporting(true);
    try {
      const project = createProductionProjectFromMagicSource({
        projectId: Date.now().toString(),
        importId: crypto.randomUUID(),
        title: projectName.trim(),
        sourceFormat,
        targetFormat,
        aspectRatio,
        visualStyleSeed: visualStyleSeed || undefined,
        sourceDocuments: buildSourceDocuments(),
      });
      await createProject(project);
      navigate("/production/preparation");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建制片项目失败");
    } finally {
      setIsImporting(false);
    }
  };

  const activeTitle = activeUnit ? sourceTitle(targetFormat, movieMode, activeIndex, activeUnit.title) : "来源单元";
  const activeAdaptation = activeUnit ? adaptedScripts[activeUnit.id] : undefined;

  const displayedUnits = useMemo(() => {
    if (showAllEpisodes || totalUnits <= EPISODES_PER_GROUP) {
      return orderedUnits;
    }
    const start = selectedGroup * EPISODES_PER_GROUP;
    return orderedUnits.slice(start, start + EPISODES_PER_GROUP);
  }, [orderedUnits, showAllEpisodes, totalUnits, selectedGroup]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 bg-bg-primary text-text-primary">
      {/* 顶部导航与统一操作栏 */}
      <header className="mb-6 flex shrink-0 flex-col items-stretch justify-between gap-4 border-b border-border-soft/20 pb-5 lg:mb-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBack}
            leftIcon={<ChevronLeft className="h-4 w-4" />}
            className="shrink-0 rounded-xl px-3.5 h-8 text-xs font-bold cursor-pointer"
          >
            返回
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gold bg-gold/10 px-2 py-0.5 rounded-md">
                导演制片 · 魔法导入
              </span>
            </div>
            <h1 className="mt-1 flex flex-wrap items-center gap-x-2 text-xl font-bold text-text-primary">
              <span className="shrink-0">导入剧本来源</span>
              {projectName.trim() && (
                <>
                  <span className="text-text-muted/40 font-normal">/</span>
                  <span className="min-w-0 break-words font-bold text-gold">{projectName.trim()}</span>
                </>
              )}
            </h1>
          </div>
        </div>

        {/* 顶部右侧：纯净主操作区，消除突兀的黄色错误提示 */}
        <div className="flex flex-wrap items-center gap-3 lg:max-w-[45%] lg:justify-end">
          {canImport && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              已录入 {filledUnits.length} 个单元，就绪
            </span>
          )}

          <Button
            size="sm"
            variant="primary"
            isLoading={isImporting}
            disabled={!canImport}
            onClick={() => void confirmImport()}
            rightIcon={<ChevronRight className="h-4 w-4" />}
            className="h-10 w-full shrink-0 whitespace-nowrap rounded-xl px-5 font-bold cursor-pointer shadow-md sm:w-auto"
          >
            导入并进入剧本与场次
          </Button>
        </div>
      </header>

      {/* 主体左右分栏布局（自然高度延伸，消除一屏压缩局促感） */}
      <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
        {/* 左侧：项目设定与规格（粘性跟随，长文本向下滚动时依然触手可及） */}
        <aside className="flex min-w-0 flex-col gap-4 self-start lg:sticky lg:top-6">
          {/* 1. 项目基本信息 */}
          <div className="rounded-2xl border border-border-soft/20 bg-bg-surface p-5 space-y-4 shadow-sm">
            <div>
              <label htmlFor="production-magic-project-name" className="mb-2 block text-xs font-bold text-text-muted">
                项目名称 <span className="text-red-400">*</span>
              </label>
              <input
                id="production-magic-project-name"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="例如：流浪地球、繁花、庆余年..."
                autoFocus
                className="h-10 w-full rounded-xl border border-border-soft/20 bg-bg-surface-soft/40 px-3.5 text-sm font-bold text-text-primary outline-none placeholder:text-text-dark focus:border-gold/50 transition-colors"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-bold text-text-muted">来源类型</p>
              <div className="grid grid-cols-2 gap-2">
                {(["script", "novel"] as ProductionMagicSourceFormat[]).map((format) => {
                  const selected = sourceFormat === format;
                  const Icon = format === "script" ? FileText : BookOpen;
                  return (
                    <button
                      key={format}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        if (format === sourceFormat) return;
                        setSourceFormat(format);
                        resetAdaptations();
                      }}
                      className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        selected
                          ? "border-gold/50 bg-gold/10 text-text-primary font-bold shadow-sm"
                          : "border-border-soft/20 bg-bg-surface-soft/30 text-text-muted hover:border-border-soft/45 hover:text-text-primary"
                      }`}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-gold" : "text-text-muted")} />
                      <div>
                        <span className="block text-xs font-bold">{sourceLabels[format]}</span>
                        <span className="block text-[10px] text-text-dark font-normal">
                          {format === "script" ? "制作台本" : "需AI转剧本"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 2. 成片规格与画幅 */}
          <div className="rounded-2xl border border-border-soft/20 bg-bg-surface p-5 space-y-4 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-bold text-text-muted">成片类型</p>
              <div className="grid grid-cols-3 gap-2">
                {formats.map(({ id, label, icon: Icon }) => {
                  const selected = targetFormat === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => changeTargetFormat(id)}
                      className={`flex flex-col items-center justify-center rounded-xl border py-2.5 px-2 text-center transition-all cursor-pointer ${
                        selected
                          ? "border-gold/50 bg-gold/10 text-text-primary font-bold shadow-sm"
                          : "border-border-soft/20 bg-bg-surface-soft/30 text-text-muted hover:border-border-soft/45 hover:text-text-primary"
                      }`}
                    >
                      <Icon className={cn("h-4 w-4 mb-1", selected ? "text-gold" : "text-text-muted")} />
                      <span className="text-xs font-bold">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-text-muted">项目画幅</p>
                <span className="text-[10px] text-text-dark">创建后全项目共用</span>
              </div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="项目画幅">
                {(["16:9", "9:16"] as const).map((ratio) => {
                  const selected = aspectRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAspectRatio(ratio)}
                      className={`rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                        selected
                          ? "border-gold/50 bg-gold/10 text-text-primary font-bold shadow-sm"
                          : "border-border-soft/20 bg-bg-surface-soft/30 text-text-muted hover:border-border-soft/45 hover:text-text-primary"
                      }`}
                    >
                      <span className="block text-xs font-bold">{ratio}</span>
                      <span className="mt-0.5 block text-[10px] text-text-muted">
                        {ratio === "16:9" ? "横屏影院" : "竖屏短剧"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {targetFormat === "movie" ? (
              <div>
                <p className="mb-2 text-xs font-bold text-text-muted">电影输入方式</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["whole", "segments"] as MovieInputMode[]).map((mode) => {
                    const selected = movieMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => changeMovieMode(mode)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer text-center ${
                          selected
                            ? "border-gold/50 bg-gold/10 text-text-primary font-bold shadow-sm"
                            : "border-border-soft/20 bg-bg-surface-soft/30 text-text-muted hover:border-border-soft/45 hover:text-text-primary"
                        }`}
                      >
                        {mode === "whole" ? "完整单篇输入" : "分段切块输入"}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="production-magic-episode-count" className="text-xs font-bold text-text-muted">集数规划</label>
                  <span className="text-[10px] text-text-dark">支持 1-100 集</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="production-magic-episode-count"
                    type="number"
                    min={1}
                    max={100}
                    value={episodeCount}
                    onChange={(event) => changeEpisodeCount(Number(event.target.value))}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-border-soft/20 bg-bg-surface-soft/40 px-3 text-sm font-bold outline-none focus:border-gold/50 text-text-primary"
                  />
                  <div className="flex shrink-0 gap-1">
                    {[1, 5, 10, 80].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => changeEpisodeCount(count)}
                        className={cn(
                          "h-10 px-2 rounded-xl border text-xs font-bold transition cursor-pointer",
                          episodeCount === count
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-border-soft/20 text-text-muted hover:border-border-soft/45 hover:text-text-primary",
                        )}
                      >
                        {count}集
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. 进阶视觉风格（可折叠） */}
          <div className="rounded-2xl border border-border-soft/20 bg-bg-surface p-4 transition-all shadow-sm">
            <button
              type="button"
              onClick={() => setIsVisualSeedOpen(!isVisualSeedOpen)}
              className="flex w-full items-center justify-between text-left cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-gold" />
                  <span className="text-xs font-bold text-text-primary">视觉风格与媒介（可选）</span>
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  {visualStyleSeed
                    ? `已选媒介：${mediumLabels[visualStyleSeed.productionMode] || visualStyleSeed.productionMode}`
                    : "未指定（在剧本与场次中进一步规划）"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {visualStyleSeed && (
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold">已配置</span>
                )}
                {isVisualSeedOpen ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
              </div>
            </button>
            {isVisualSeedOpen && (
              <div className="mt-4 pt-4 border-t border-border-soft/20">
                <ProjectVisualSeedFields
                  value={visualStyleSeed}
                  onChange={setVisualStyleSeed}
                  disabled={isImporting}
                />
                {visualStyleSeed && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setVisualStyleSeed(null)}
                      className="text-[11px] font-medium text-text-muted hover:text-red-400 transition cursor-pointer"
                    >
                      清除已选风格
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 右侧：正文录入工作区 */}
        <section className="flex flex-col space-y-4 min-w-0">
          {/* 工作范围标题行 */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-2.5">
              <span className="text-xs font-bold text-text-muted shrink-0">
                {targetFormat === "movie" && movieMode === "whole" ? "剧本范围：" : "单元标题："}
              </span>
              <input
                type="text"
                aria-label="来源工作范围标题"
                value={activeUnit?.title || ""}
                onChange={(event) => activeUnit && updateUnitTitle(activeUnit.id, event.target.value)}
                placeholder={sourceTitle(targetFormat, movieMode, activeIndex)}
                className="h-9 min-w-0 w-full max-w-md rounded-xl border border-border-soft/20 bg-bg-surface px-3.5 text-sm font-bold text-text-primary outline-none placeholder:text-text-muted/60 focus:border-gold/50 transition-colors shadow-sm"
              />
            </div>
            {targetFormat === "movie" && movieMode === "segments" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = [...units, newSourceUnit()];
                  setUnits(next);
                  setActiveUnitId(next[next.length - 1].id);
                  resetAdaptations();
                }}
                leftIcon={<ListPlus className="h-4 w-4" />}
                className="rounded-xl px-3.5 h-8 text-xs font-bold cursor-pointer"
              >
                新增段落
              </Button>
            )}
          </div>

          {/* 重点优化：分集导航控制器与矩阵面板（支持高达 100 集清晰网格一览） */}
          {totalUnits > 1 && (
            <div className="rounded-2xl border border-border-soft/20 bg-bg-surface p-4 shadow-sm space-y-3">
              {/* 控制器顶行：上一集 / 当前集指示 / 下一集 / 进度与矩阵展开按钮 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeIndex === 0}
                    onClick={handlePrevUnit}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft/20 bg-bg-surface-soft/40 text-text-muted hover:text-text-primary hover:border-border-soft/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    title="上一集/段"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <div className="flex items-center gap-2 px-1">
                    <span className="text-sm font-black text-text-primary">
                      {sourceTitle(targetFormat, movieMode, activeIndex, activeUnit.title)}
                    </span>
                    <span className="rounded-md bg-gold/10 px-2 py-0.5 text-xs font-bold text-gold font-mono">
                      {activeIndex + 1} / {totalUnits}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={activeIndex === totalUnits - 1}
                    onClick={handleNextUnit}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft/20 bg-bg-surface-soft/40 text-text-muted hover:text-text-primary hover:border-border-soft/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    title="下一集/段"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      已录入 <strong className="text-text-primary font-mono">{filledUnits.length}</strong>
                    </span>
                    <span className="opacity-40">/</span>
                    <span>共 {totalUnits} {targetFormat === "movie" ? "段" : "集"}</span>
                  </div>

                  {totalUnits > 8 && (
                    <button
                      type="button"
                      onClick={() => setIsMatrixOpen(!isMatrixOpen)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition cursor-pointer",
                        isMatrixOpen
                          ? "border-gold/50 bg-gold/10 text-gold shadow-sm"
                          : "border-border-soft/20 bg-bg-surface-soft/40 text-text-muted hover:text-text-primary hover:border-border-soft/45",
                      )}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      <span>{isMatrixOpen ? "收起矩阵" : "全部选集"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 矩阵面板本体：如果展开或集数在8集以内 */}
              {(isMatrixOpen || totalUnits <= 8) && (
                <div className="pt-3 border-t border-border-soft/10 space-y-2.5">
                  {/* 如果集数很多（>20集），显示 20 集一档的快捷分组标签 */}
                  {totalUnits > EPISODES_PER_GROUP && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin text-xs">
                      <button
                        type="button"
                        onClick={() => setShowAllEpisodes(true)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg border font-bold shrink-0 transition cursor-pointer",
                          showAllEpisodes
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-border-soft/20 text-text-muted hover:text-text-primary hover:border-border-soft/45",
                        )}
                      >
                        全部 ({totalUnits})
                      </button>
                      {Array.from({ length: groupCount }, (_, gIdx) => {
                        const start = gIdx * EPISODES_PER_GROUP + 1;
                        const end = Math.min((gIdx + 1) * EPISODES_PER_GROUP, totalUnits);
                        const isCurrentRange = !showAllEpisodes && selectedGroup === gIdx;
                        return (
                          <button
                            key={gIdx}
                            type="button"
                            onClick={() => {
                              setShowAllEpisodes(false);
                              setSelectedGroup(gIdx);
                            }}
                            className={cn(
                              "px-2.5 py-1 rounded-lg border font-bold shrink-0 transition cursor-pointer",
                              isCurrentRange
                                ? "border-gold/50 bg-gold/10 text-gold"
                                : "border-border-soft/20 text-text-muted hover:text-text-primary hover:border-border-soft/45",
                            )}
                          >
                            {start} - {end}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 紧凑数字选集矩阵方块（自适应换行，百集清晰平铺） */}
                  <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin">
                    {displayedUnits.map((unit) => {
                      const index = orderedUnits.findIndex((u) => u.id === unit.id);
                      const selected = unit.id === activeUnit?.id;
                      const hasContent = Boolean(unit.content.trim());
                      const isAdapted = sourceFormat === "novel" && Boolean(adaptedScripts[unit.id]);
                      const wordCount = unit.content.trim().length;

                      return (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => setActiveUnitId(unit.id)}
                          title={`${sourceTitle(targetFormat, movieMode, index, unit.title)} · ${
                            sourceFormat === "novel"
                              ? isAdapted
                                ? "已转剧本"
                                : hasContent
                                  ? "待转剧本"
                                  : "未填写"
                              : hasContent
                                ? `${wordCount} 字`
                                : "未填写"
                          }`}
                          className={cn(
                            "relative flex h-8 min-w-8 items-center justify-center rounded-lg border text-xs font-bold transition-all cursor-pointer px-1.5",
                            selected
                              ? "border-gold bg-gold/25 text-gold font-black shadow-sm ring-2 ring-gold/40 scale-105 z-10"
                              : hasContent
                                ? sourceFormat === "novel"
                                  ? isAdapted
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/60"
                                    : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:border-amber-500/60"
                                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/60"
                                : "border-border-soft/20 bg-bg-surface-soft/20 text-text-muted hover:border-border-soft/45 hover:text-text-primary",
                          )}
                        >
                          <span className="font-mono">{index + 1}</span>
                          {/* 状态徽标小点 */}
                          {hasContent && (
                            <span
                              className={cn(
                                "absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full",
                                sourceFormat === "novel"
                                  ? isAdapted
                                    ? "bg-emerald-400"
                                    : "bg-amber-400 animate-pulse"
                                  : "bg-emerald-400",
                              )}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 重点优化：大容量舒展文本编辑卡片（消除一屏高度死锁，给足高度自由纵深） */}
          <div className="flex flex-col border border-border-soft/20 bg-bg-surface rounded-2xl overflow-hidden shadow-sm">
            {/* 卡片顶部：格式引导与字数展示 */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft/10 px-4 py-3.5 bg-bg-surface sm:px-6">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <label htmlFor="production-magic-source-content" className="text-xs font-bold text-text-primary">粘贴{sourceLabels[sourceFormat]}全文</label>
                <label className="cursor-pointer whitespace-nowrap rounded border border-border-soft px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-gold/50">读取 TXT 文件<input aria-label="读取完整剧本文件" type="file" accept=".txt,text/plain" className="sr-only" onChange={async event => {
                  const file = event.target.files?.[0]; const unitId = activeUnit?.id;
                  if (!file || !unitId) return;
                  try {
                    if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB，请按分集导入。');
                    const content = await file.text();
                    updateUnitContent(unitId, content);
                    toast.success(`已读取完整原文：${content.length} 字符`);
                  } catch (error) { toast.error(error instanceof Error ? error.message : '读取失败'); }
                  event.target.value = '';
                }} /></label>
                <span className="basis-full text-[11px] leading-relaxed text-text-muted">
                  {sourceFormat === "script"
                    ? "（此处完整保留正文，不会在导入期提前拆分场次）"
                    : "（粘贴小说章节原文，后续由 AI 提取转换为标准剧本）"}
                </span>
              </div>
              <span className="shrink-0 text-xs font-mono font-bold text-gold/90 bg-gold/10 px-2.5 py-1 rounded-md">
                {activeUnit?.content.length || 0} 字
              </span>
            </div>

            {/* 大尺寸舒展输入框：默认高度 560px，支持纵向自由拖拽拉伸 */}
            <textarea
              id="production-magic-source-content"
              value={activeUnit?.content || ""}
              onChange={(event) => activeUnit && updateUnitContent(activeUnit.id, event.target.value)}
              placeholder={
                sourceFormat === "script"
                  ? "请在此处粘贴完整剧本正文...\n例如场景标头、动作描写、角色台词等，导入时完整保存原文，剧本与场次阶段将提供智能场次切分与拆解。"
                  : "请在此处粘贴小说章节原文...\n粘贴后点击下方「小说转剧本」按钮，AI 将为你提炼出标准拍摄台本。"
              }
              className="min-h-[360px] w-full resize-y bg-transparent p-4 text-sm leading-relaxed text-text-primary outline-none focus:outline-none focus:ring-0 placeholder:text-text-dark/70 font-sans sm:min-h-[560px] sm:p-6"
            />

            {/* 小说转换剧本操作栏 */}
            {sourceFormat === "novel" && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-soft/10 px-4 py-4 bg-bg-surface-soft/30 sm:px-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {activeAdaptation ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> 剧本候选已就绪并采用
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-400">
                        需先将本单元小说转换为剧本候选
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {activeAdaptation ? "已冻结原小说并保留采用后的剧本正文" : "进入剧本与场次前，小说原文需先转为制作剧本"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!activeUnit?.content.trim()}
                  isLoading={isGenerating && promptUnitId === activeUnit?.id}
                  onClick={() => activeUnit && setPromptUnitId(activeUnit.id)}
                  leftIcon={<Sparkles className="h-4 w-4" />}
                  className="rounded-xl px-4 h-9 text-xs font-bold cursor-pointer"
                >
                  {activeAdaptation ? "重新生成候选" : "小说转剧本 (AI)"}
                </Button>
              </div>
            )}

            {/* 卡片内底部工具栏：字数统计 + 翻页切集快捷键 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-soft/10 px-4 py-4 bg-bg-surface-soft/20 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                <span className="font-mono font-medium">{activeUnit?.content.length || 0} 字符</span>
                {targetFormat === "movie" && movieMode === "segments" && units.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (units.length <= 1 || !activeUnit) return;
                      const next = units.filter((unit) => unit.id !== activeUnit.id);
                      setUnits(next);
                      setActiveUnitId(next[Math.max(0, activeIndex - 1)].id);
                      resetAdaptations();
                    }}
                    className="flex items-center gap-1 font-bold text-text-dark hover:text-red-400 transition cursor-pointer"
                  >
                    <Minus className="h-3 w-3" />
                    <span>移除当前段落</span>
                  </button>
                )}
              </div>

              {/* 多集/多段快速翻页切换控制 */}
              {totalUnits > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={activeIndex === 0}
                    onClick={handlePrevUnit}
                    leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                    className="rounded-xl px-3 h-8 text-xs font-bold cursor-pointer"
                  >
                    上一{targetFormat === "movie" ? "段" : "集"}
                  </Button>
                  <span className="text-xs text-text-muted px-1 font-mono">
                    {activeIndex + 1} / {totalUnits}
                  </span>
                  <Button
                    size="sm"
                    variant={activeIndex < totalUnits - 1 ? "primary" : "secondary"}
                    disabled={activeIndex === totalUnits - 1}
                    onClick={handleNextUnit}
                    rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                    className="rounded-xl px-3 h-8 text-xs font-bold cursor-pointer"
                  >
                    下一{targetFormat === "movie" ? "段" : "集"}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-text-muted">{importHint}</p>
            <Button
              size="sm"
              variant="primary"
              isLoading={isImporting}
              disabled={!canImport}
              onClick={() => void confirmImport()}
              rightIcon={<ChevronRight className="h-4 w-4" />}
              className="h-10 w-full whitespace-nowrap rounded-xl px-5 sm:w-auto"
            >
              导入并进入剧本与场次
            </Button>
          </div>
        </section>
      </div>

      {/* 小说转剧本提示词与候选模态框 */}
      <PromptEditorModal
        isOpen={Boolean(promptUnitId && activeUnit)}
        onClose={() => setPromptUnitId(null)}
        templateId="productionNovelToScript"
        title="小说转剧本 - 提示词确认"
        variables={{
          sourceTitle: activeTitle,
          sourceContent: orderedUnits.find((unit) => unit.id === promptUnitId)?.content || "",
          projectFormat: formatLabels[targetFormat],
        }}
        onConfirm={generateNovelScript}
        workflowStepId="production.magic_import.novel_to_script"
      />
      <Modal
        isOpen={Boolean(candidate)}
        onClose={() => setCandidate(null)}
        title="小说转剧本候选"
        size="xl"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setCandidate(null)} className="rounded-xl px-4 h-8 text-xs font-bold">
              放弃
            </Button>
            <Button size="sm" variant="primary" onClick={adoptCandidate} className="rounded-xl px-4 h-8 text-xs font-bold">
              采用为剧本来源
            </Button>
          </>
        }
      >
        <pre className="max-h-[60vh] whitespace-pre-wrap text-sm leading-7 text-text-primary bg-bg-surface-soft/40 p-4 rounded-xl border border-border-soft/20 overflow-y-auto">
          {candidate?.scriptText || ""}
        </pre>
      </Modal>
    </main>
  );
}
