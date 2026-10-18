import React, { useRef, useState, useEffect } from 'react';
import { ArrowRight, BookOpen, Compass, Sparkles, FileText, Activity, GitBranch, ChevronDown, Layers, CheckCircle2 } from 'lucide-react';
import type { ScriptProject, DeliveryUnit, ScriptOperation } from '../../../../../../packages/script/src/schema';
import {
  anchorCurrent,
  anchorFor,
  freezeOutlineGrant,
  getOutlineGuide,
  locateOutlineQuote,
  outlineGuideId,
  outlineText,
  replaceOutlineRange,
  setOutlineText,
  storyOutlineOwner,
  visibleOutlineGuides,
  type OutlineOwner,
} from '../../../../../../packages/script/src/outlineGuides';
import { ScriptWorkDirectory, type OutlineNavigationChoice } from './ScriptWorkDirectory';
import { OutlineBeats } from './OutlineBeats';
import { ScriptStructure } from '../ScriptStructure';
import { ScriptStructureEditor } from './ScriptStructureEditor';
import { ScriptUnitSettings } from './ScriptUnitSettings';
import { ScriptAnalysisOutlet } from './ScriptAnalysisView';
import type { OutlineEvidenceSource } from './StructureAnalysisCard';
import type { AssistantRequest } from '../scriptAssistantShortcuts';

export function focusOutlineEvidence(content: HTMLDivElement | null, editor: HTMLTextAreaElement | null, focus: OutlineEvidenceSource, offset = 0) {
  const target =
    focus.tab === 'beats' && focus.beatId
      ? Array.from(content?.querySelectorAll<HTMLElement>('[data-outline-beat]') ?? []).find(
          (element) => element.dataset.outlineBeat === focus.beatId
        )
      : !editor && focus.nodeId
      ? Array.from(content?.querySelectorAll<HTMLElement>('[data-outline-node]') ?? []).find(
          (element) => element.dataset.outlineNode === focus.nodeId
        )
      : undefined;
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
    return;
  }
  if (focus.tab === 'beats' || !editor) return;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(Math.max(0, focus.start - offset), Math.max(0, focus.end - offset));
  editor.scrollIntoView({ block: 'center' });
}

interface Props {
  focus?: OutlineEvidenceSource;
  seasonId?: string;
  choice: OutlineNavigationChoice;
  tab: 'outline' | 'beats' | 'structure';
  setChoice: (value: OutlineNavigationChoice, seasonId?: string) => void;
  setTab: (value: 'outline' | 'beats' | 'structure') => void;
  project: ScriptProject;
  activeUnitId?: string;
  activeNodeId?: string;
  onUpdateProject: (updater: (draft: ScriptProject) => void) => void;
  onUpdateUnit: (unit: DeliveryUnit) => void;
  onSwitchToBlueprint: () => void;
  onSwitchToBoard: (unitId?: string, sceneId?: string) => void;
  onSelectUnit: (unitId: string) => void;
  onAddUnit: () => void;
  onSelectNode: (nodeId?: string, unitIndices?: number[]) => void;
  onRequestTask: (operation: ScriptOperation, unitId?: string, scopeId?: string, nodeId?: string, unitIndices?: number[], request?: string) => void;
  onRequestBeatChange?: (request: AssistantRequest) => void;
}

export function StoryOutlineView({
  focus,
  seasonId,
  choice,
  setChoice,
  tab,
  setTab,
  project,
  activeUnitId,
  activeNodeId,
  onUpdateProject,
  onUpdateUnit,
  onSwitchToBlueprint,
  onSwitchToBoard,
  onSelectUnit,
  onAddUnit,
  onSelectNode,
  onRequestTask,
  onRequestBeatChange,
}: Props) {
  const unit = project.units.find((u) => u.id === activeUnitId) || project.units[0];
  const standalone = project.profile.organization === 'standalone';
  const [batch, setBatch] = useState(3);
  const [quote, setQuote] = useState('');
  const [error, setError] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    setTab(focus.tab ?? 'outline');
    setChoice(
      focus.owner.kind === 'unit' ? (legacy ? 'legacy' : 'current') : focus.owner.kind === 'project' ? 'project' : focus.owner.kind === 'season' ? 'season' : 'story',
      focus.owner.kind === 'season' ? focus.owner.id : undefined
    );
    const targetNode = focus.nodeId && !focus.beatId ? unit.structureNodes?.find((node) => node.id === focus.nodeId) : undefined;
    onSelectNode(targetNode?.id);
    let offset = 0;
    try {
      const link = getOutlineGuide(project, focus.owner)?.nodeLinks.find((link) => link.nodeId === targetNode?.id);
      if (link && anchorCurrent(link.anchor, outlineText(project, focus.owner))) offset = link.anchor.start;
    } catch {
      /* Removed historical sources cannot be focused. */
    }
    const frame = requestAnimationFrame(() => focusOutlineEvidence(content.current, editor.current, focus, offset));
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  const storyOwner = storyOutlineOwner(project, unit);
  const legacy = !standalone && project.units.filter((u) => u.scopeId === unit.scopeId).length === 1 && storyOwner.kind === 'story' && Boolean(outlineText(project, storyOwner).trim());
  const season = project.seasons?.find((s) => s.id === (seasonId ?? unit.seasonId)) ?? (!seasonId ? project.seasons?.find((s) => s.id === unit.scopeId) : undefined);
  const owner: OutlineOwner =
    choice === 'legacy'
      ? { kind: 'unit', id: unit.id }
      : choice === 'current' && legacy
      ? storyOwner
      : choice === 'project'
      ? { kind: 'project', id: project.id }
      : choice === 'season' && season
      ? { kind: 'season', id: season.id }
      : choice === 'story'
      ? storyOutlineOwner(project, unit)
      : standalone && (!unit.summary.trim() || project.brief.outline.trim())
      ? { kind: 'project', id: project.id }
      : { kind: 'unit', id: unit.id };

  const text = outlineText(project, owner);
  const guide = getOutlineGuide(project, owner);
  const node = choice === 'current' || (focus?.nodeId === activeNodeId && focus?.owner.kind === owner.kind && focus?.owner.id === owner.id) ? unit.structureNodes?.find((n) => n.id === activeNodeId) : undefined;
  const link = guide?.nodeLinks.find((l) => l.nodeId === node?.id);
  const linked = Boolean(link && anchorCurrent(link.anchor, text));
  const label = node ? node.title : owner.kind === 'unit' ? '当前集大纲' : owner.kind === 'season' ? '本季完整大纲' : owner.kind === 'story' ? '当前故事完整大纲' : standalone ? '完整故事大纲' : '全剧走向';

  const request = (instruction?: string) =>
    onRequestTask(
      owner.kind === 'unit' ? 'unit_outline' : 'outline',
      unit.id,
      owner.kind === 'unit' ? undefined : owner.id,
      node?.id,
      undefined,
      instruction ||
        `请根据已采用的蓝图和现有内容，${text ? '整理和完善' : '生成'}${label}，${
          owner.kind === 'season'
            ? '并在适合时提出对应的关键节拍，只处理本季原文和获准节拍，不改分集结构、场序或正文。'
            : '并在适合时一并提出相互对应的幕或段落与关键节拍，保留已有正文和未修改对象。'
        }不强制幕数或节拍数。${node ? '仅修改本段原文，保持段外内容。' : ''}`
    );

  const update = (value: string) =>
    onUpdateProject((p) => {
      if (node && linked) {
        const grant = freezeOutlineGrant(p, owner, { nodeId: node.id });
        const next = replaceOutlineRange(p, grant, value);
        const g = getOutlineGuide(next, owner)!;
        if (value.length) {
          g.nodeLinks = g.nodeLinks.map((item) => (item.nodeId === node.id ? { ...item, anchor: anchorFor(outlineText(next, owner), grant.start, grant.start + value.length) } : item));
        }
        Object.assign(p, next);
      } else if (!node) {
        setOutlineText(p, owner, value);
      }
    });

  const linkQuote = () => {
    try {
      const anchor = locateOutlineQuote(text, quote);
      onUpdateProject((p) => {
        let g = getOutlineGuide(p, owner);
        if (!g) {
          g = { id: outlineGuideId(owner), owner, nodeLinks: [], beats: [] };
          (p.outlineGuides ??= []).push(g);
        }
        g.nodeLinks = g.nodeLinks.filter((l) => l.nodeId !== node!.id);
        g.nodeLinks.push({ nodeId: node!.id, unitId: unit.id, anchor });
      });
      setError('');
      setQuote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法关联');
    }
  };

  const guides = choice === 'current' ? visibleOutlineGuides(project, unit).map((g) => (g.owner.kind === 'unit' || standalone ? g : { ...g, beats: g.beats.filter((b) => b.unitIds.includes(unit.id) || b.sceneRefs.some((r) => r.unitId === unit.id)) })) : guide ? [guide] : [];

  const openOwnedBeat = (targetOwner: OutlineOwner, beatId: string) => {
    if (targetOwner.kind === 'unit' && targetOwner.id !== unit.id) onSelectUnit(targetOwner.id);
    onSelectNode(undefined);
    setChoice(
      targetOwner.kind === 'unit' ? (legacy ? 'legacy' : 'current') : targetOwner.kind === 'project' ? 'project' : targetOwner.kind === 'season' ? 'season' : 'story',
      targetOwner.kind === 'season' ? targetOwner.id : undefined
    );
    setTab('beats');
    requestAnimationFrame(() => {
      const target = Array.from(content.current?.querySelectorAll<HTMLElement>('[data-outline-beat]') ?? []).find((element) => element.dataset.outlineBeat === beatId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center' });
    });
  };

  const wordCount = (node && linked ? link!.anchor.quote : text).replace(/\s/g, '').length;

  return (
    <div className="script-work-page">
      {/* 1. Header Bar */}
      <header className="script-work-header px-5 py-3 flex items-center justify-between border-b border-border-primary/10 bg-bg-surface shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-bg-surface-soft flex items-center justify-center text-text-primary">
            <BookOpen size={15} />
          </div>
          <h2 className="text-sm font-bold text-text-primary tracking-tight">故事大纲</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSwitchToBlueprint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft transition-all cursor-pointer"
          >
            <Compass size={13} />
            <span>全案蓝图</span>
          </button>
          <button
            type="button"
            onClick={() => onSwitchToBoard(unit.id)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-text-primary text-bg-surface hover:opacity-90 transition-all cursor-pointer shadow-xs"
          >
            <span>规划分场</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </header>

      <div className="script-work-columns">
        {/* Left Directory */}
        <ScriptWorkDirectory
          project={project}
          unitId={unit.id}
          nodeId={node?.id}
          onUnit={(id) => {
            onSelectUnit(id);
            setChoice('current');
          }}
          onNode={(id) => {
            onSelectNode(id);
            setChoice('current');
            setTab('outline');
          }}
          onAddUnit={onAddUnit}
        />

        {/* Center Content */}
        <main className="script-work-main script-analysis-anchor flex-1 min-w-0 flex flex-col bg-bg-primary overflow-hidden">
          {/* Sub Toolbar: Scope & Metrics & Actions */}
          <div className="script-work-toolbar px-5 py-2.5 border-b border-border-primary/10 flex flex-wrap items-center justify-between gap-3 bg-bg-surface/50 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {!standalone && (
                <select
                  aria-label="大纲归属"
                  value={choice}
                  onChange={(e) => {
                    const next = e.target.value as OutlineNavigationChoice;
                    setChoice(next, next === 'season' ? season?.id : undefined);
                    onSelectNode(undefined);
                  }}
                  className="text-xs bg-bg-surface-soft rounded-xl px-2.5 py-1.5 text-text-primary outline-none focus:ring-1 focus:ring-border-primary cursor-pointer font-medium"
                >
                  <option value="current">当前集：{unit.title}</option>
                  {season && <option value="season">本季：{season.title}</option>}
                  {!legacy && storyOwner.kind === 'story' && <option value="story">本故事整体走向</option>}
                  {legacy && <option value="legacy">已有本集摘要（分别保留）</option>}
                  <option value="project">全剧走向</option>
                </select>
              )}
              <strong className="text-xs font-semibold text-text-primary truncate">{label}</strong>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface-soft text-text-muted">
                {wordCount} 字
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={Boolean(node && !linked)}
                aria-label={`与 AI 整理${label}`}
                title={`与 AI 整理${label}`}
                onClick={() => request()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-primary transition-all cursor-pointer disabled:opacity-40"
              >
                <Sparkles size={13} className="text-text-secondary" />
                <span>与 AI 整理大纲</span>
              </button>
            </div>
          </div>

          {/* View Mode Tabs (Modern Segmented Control) */}
          <div className="script-work-tabs px-5 py-2 flex items-center justify-between border-b border-border-primary/10 bg-bg-surface/30 shrink-0">
            <div className="flex items-center p-1 rounded-xl bg-bg-surface-soft gap-1 text-xs" role="tablist" aria-label="大纲视图">
              {(
                [
                  ['outline', '故事原文', FileText],
                  ['beats', '关键节拍', Sparkles],
                  ['structure', '季与故事线', GitBranch],
                ] as const
              ).map(([id, title, Icon]) => {
                const isActive = tab === id;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-bg-surface text-text-primary font-semibold shadow-xs'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <Icon size={13} />
                    <span>{title}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() =>
                onRequestTask(
                  'consult',
                  unit.id,
                  owner.kind === 'unit' ? undefined : owner.id,
                  node?.id,
                  undefined,
                  `请分析${label}的结构与节奏。仅依据本次实际读到的大纲、关键节拍和场景规划，引用具体原文和位置，区分规划与正文。先提出意见，不修改稿件。`
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft transition-all cursor-pointer"
            >
              <Activity size={13} />
              <span>分析结构与节奏</span>
            </button>
          </div>

          {/* Main Working Canvas */}
          <div ref={content} className="script-work-content flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
            {legacy && choice === 'current' && (
              <div className="p-3 rounded-xl bg-bg-surface-soft text-xs text-text-muted leading-relaxed">
                此旧独立故事的大纲保存在故事原文中，当前直接显示其内容；新增续篇时会预览归属转换。
              </div>
            )}

            {tab === 'outline' && (
              <div className="max-w-4xl mx-auto space-y-6">
                {node && !linked ? (
                  <section
                    className="p-6 rounded-2xl bg-bg-surface space-y-4 shadow-sm"
                    data-outline-node={node.id}
                    tabIndex={-1}
                  >
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-text-primary">
                        {link ? '原文关联待复核' : '此段尚未关联大纲原文'}
                      </h3>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {link
                          ? '保留了修改前的依据，请核对后重新关联。'
                          : '从完整大纲中选取这一段的准确原文，目录就能直接定位和编辑它。'}
                      </p>
                    </div>

                    {node.purpose && (
                      <div className="p-3 rounded-xl bg-bg-surface-soft text-xs text-text-secondary whitespace-pre-wrap">
                        <strong className="text-text-primary block mb-1">现有段落安排：</strong>
                        {node.purpose}
                      </div>
                    )}

                    {link && (
                      <blockquote className="p-3 rounded-xl bg-bg-surface-soft text-xs text-text-muted italic border-l-2 border-border-primary">
                        {link.anchor.quote}
                      </blockquote>
                    )}

                    <textarea
                      aria-label="关联本段原文"
                      value={quote}
                      onChange={(e) => setQuote(e.target.value)}
                      placeholder="粘贴完整大纲中唯一出现的连续原文…"
                      rows={4}
                      className="w-full text-xs rounded-xl p-3 bg-bg-surface-soft text-text-primary placeholder:text-text-muted focus:outline-none resize-none"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={linkQuote}
                        disabled={!quote.trim()}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-text-primary text-bg-surface hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer shadow-xs"
                      >
                        关联这段原文
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectNode(undefined)}
                        className="px-3.5 py-2 rounded-xl text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft transition-all cursor-pointer"
                      >
                        查看完整大纲
                      </button>
                    </div>

                    {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}
                  </section>
                ) : (
                  <>
                    {!text.trim() && (
                      <section className="p-8 rounded-3xl bg-bg-surface text-center space-y-3 shadow-sm my-4">
                        <div className="w-12 h-12 rounded-2xl bg-bg-surface-soft flex items-center justify-center text-text-primary mx-auto mb-2">
                          <BookOpen size={22} />
                        </div>
                        <h3 className="text-base font-bold text-text-primary">把蓝图发展成故事</h3>
                        <p className="text-xs text-text-secondary max-w-md mx-auto leading-relaxed">
                          先形成主要事件、人物选择和因果。需要时一起提出结构与关键节拍，由你审阅采用。
                        </p>
                        <div className="pt-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold bg-text-primary text-bg-surface hover:opacity-90 shadow-sm transition-all cursor-pointer"
                            onClick={() => request()}
                          >
                            <Sparkles size={14} />
                            <span>根据蓝图生成故事大纲</span>
                          </button>
                        </div>
                      </section>
                    )}

                    <div className="rounded-2xl bg-bg-surface p-1 shadow-xs">
                      <textarea
                        ref={editor}
                        aria-label={label}
                        className="script-original-editor"
                        value={node ? link!.anchor.quote : text}
                        onChange={(e) => update(e.target.value)}
                        placeholder={'在这里写下或粘贴已有故事大纲（起因、发展、关键转折与高潮结局）…\n\n也可点击右上角「与 AI 整理大纲」基于故事蓝图自动梳理。'}
                      />
                    </div>
                  </>
                )}

                {/* Directory Management & Unit Settings */}
                {!node && (
                  <div className="rounded-2xl bg-bg-surface p-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <span>目录管理与篇幅设置</span>
                      <ChevronDown size={14} className={`transition-transform ${isSettingsOpen ? 'rotate-180' : ''}`} />
                    </button>

                    <div className={`pt-3 space-y-4 border-t border-border-primary/10 ${isSettingsOpen ? 'block' : 'hidden'}`}>
                      <ScriptStructureEditor
                        key={`${project.id}:${unit.id}`}
                        project={project}
                        unit={unit}
                        selectedNodeId={activeNodeId}
                        onSelectNode={onSelectNode}
                        onChange={onUpdateProject}
                        onRequest={(nodeId) => onRequestTask('plan', unit.id, undefined, nodeId)}
                      />
                      {!standalone && (
                        <div className="space-y-3 pt-2">
                          <ScriptUnitSettings project={project} unit={unit} onUpdate={onUpdateProject} />
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            <select
                              aria-label="大纲批次集数"
                              value={batch}
                              onChange={(e) => setBatch(Number(e.target.value))}
                              className="text-xs bg-bg-surface-soft rounded-xl px-2.5 py-1.5 text-text-primary outline-none cursor-pointer"
                            >
                              {[1, 2, 3].map((n) => (
                                <option value={n} key={n}>
                                  本集起 {n} 集
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                const start = project.units.indexOf(unit) + 1;
                                onRequestTask(
                                  'unit_outlines',
                                  unit.id,
                                  undefined,
                                  undefined,
                                  Array.from({ length: Math.min(batch, project.profile.plannedUnits - start + 1) }, (_, i) => start + i)
                                );
                              }}
                              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-primary transition-all cursor-pointer"
                            >
                              分批规划集纲
                            </button>
                            <button
                              type="button"
                              onClick={onAddUnit}
                              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-primary transition-all cursor-pointer"
                            >
                              新增下一集
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {standalone && project.brief.outline.trim() && unit.summary.trim() && (
                  <details className="p-4 rounded-2xl bg-bg-surface text-xs space-y-2">
                    <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary">
                      查看旧版摘要
                    </summary>
                    <p className="text-[11px] text-text-muted pt-1">
                      分场以完整故事大纲为依据。这里保留原有摘要供查阅。
                    </p>
                    <textarea
                      aria-label="旧版摘要"
                      value={unit.summary}
                      onChange={(e) => onUpdateUnit({ ...unit, summary: e.target.value })}
                      rows={3}
                      className="w-full text-xs rounded-xl p-2.5 bg-bg-surface-soft text-text-primary outline-none resize-none mt-2"
                    />
                  </details>
                )}

                {text.trim() && (
                  <div className="rounded-2xl bg-bg-surface/80 p-5 border border-border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-text-primary text-bg-surface text-xs font-bold flex items-center justify-center">3</span>
                        <h4 className="text-sm font-semibold text-text-primary">大纲已就绪？</h4>
                      </div>
                      <p className="text-xs text-text-secondary">
                        准备好后，可以将大纲事件展开为具体分场。
                      </p>
                    </div>
                    <button
                      type="button"
                      data-primary="true"
                      onClick={() => onSwitchToBoard(unit.id)}
                      className="script-primary-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] shadow-xs shrink-0 transition-all cursor-pointer"
                    >
                      <span>下一步：分场规划</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'beats' && (
              <div className="max-w-4xl mx-auto">
                <OutlineBeats
                  project={project}
                  guides={guides}
                  unitId={unit.id}
                  editableOwner={owner}
                  onRequestChange={onRequestBeatChange}
                  onOpenOwner={openOwnedBeat}
                  onChange={onUpdateProject}
                  onOpenScene={onSwitchToBoard}
                  onLocate={(g, start) => {
                    setTab('outline');
                    onSelectNode(undefined);
                    setChoice(
                      g.owner.kind === 'unit' ? (legacy ? 'legacy' : 'current') : g.owner.kind === 'project' ? 'project' : g.owner.kind === 'season' ? 'season' : 'story',
                      g.owner.kind === 'season' ? g.owner.id : undefined
                    );
                    requestAnimationFrame(() => {
                      editor.current?.focus();
                      editor.current?.setSelectionRange(start, start + g.beats.flatMap((b) => b.anchors).find((a) => a.start === start)!.quote.length);
                    });
                  }}
                />
              </div>
            )}

            {tab === 'structure' && (
              <div className="max-w-4xl mx-auto">
                <ScriptStructure
                  project={project}
                  unit={unit}
                  owner={owner}
                  onChange={onUpdateProject}
                  onOpenScene={(sceneId) => onSwitchToBoard(unit.id, sceneId)}
                  onOpenBeat={openOwnedBeat}
                />
              </div>
            )}
          </div>

          <ScriptAnalysisOutlet />
        </main>
      </div>
    </div>
  );
}
