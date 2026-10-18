import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowRight, Layers, Plus, Sparkles, BookOpen, Activity, ChevronDown, Clock, Users, GitBranch } from 'lucide-react';
import type { ScriptProject, DeliveryUnit, Scene, ScriptOperation } from '../../../../../../packages/script/src/schema';
import { beatsForUnit, outlineText, unitOutlineOwner, visibleOutlineGuides } from '../../../../../../packages/script/src/outlineGuides';
import { ScriptWorkDirectory, UNASSIGNED_NODE } from './ScriptWorkDirectory';
import { OutlineBeats } from './OutlineBeats';
import { unitCharacters, visibleInUnit } from '../../../../../../packages/script/src/continuity';
import { ScriptAnalysisOutlet } from './ScriptAnalysisView';
import type { AssistantRequest } from '../scriptAssistantShortcuts';
import type { OutlineEvidenceSource } from './StructureAnalysisCard';

export function focusScenePlanningField(field: HTMLInputElement | HTMLTextAreaElement | undefined, quote?: string) {
  if (!field) return;
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: 'center' });
  if (quote) {
    const start = field.value.indexOf(quote);
    if (start >= 0 && field.value.indexOf(quote, start + 1) < 0) {
      field.setSelectionRange(start, start + quote.length);
    }
  }
}

const fieldHints: Record<string, string> = {
  title: '例：警局走廊相遇 / 废弃工厂对峙',
  location: '例：市中心刑侦支队·走廊',
  timeOfDay: '例：深夜 / 清晨 / 黄昏',
  purpose: '例：主角发现了关键物证被调包，试图拦住嫌疑警官但遭到反驳质问...',
  entryState: '例：主角信心满满，认为已经掌握铁证',
  exitState: '例：物证失效陷入被动，对内部产生严重信任危机',
};

export function ScenePlanningView({
  project,
  unitId,
  nodeId,
  sceneId,
  focus,
  onUnit,
  onNode,
  onScene,
  onChange,
  onUpdateUnit,
  onAddUnit,
  onAddScene,
  onWrite,
  onOutline,
  onRequest,
  onRequestBeatChange,
  onLocateOutline,
  overview,
}: {
  project: ScriptProject;
  unitId: string;
  nodeId?: string;
  sceneId?: string;
  focus?: { sceneId: string; field?: string; quote?: string };
  onUnit: (id: string) => void;
  onNode: (id?: string) => void;
  onScene: (unitId: string, sceneId: string) => void;
  onChange: (fn: (p: ScriptProject) => void) => void;
  onUpdateUnit: (unit: DeliveryUnit) => void;
  onAddUnit: () => void;
  onAddScene: () => void;
  onWrite: () => void;
  onOutline: () => void;
  onRequest: (operation: ScriptOperation, request?: string, sceneId?: string) => void;
  onRequestBeatChange?: (request: AssistantRequest) => void;
  onLocateOutline?: (source: OutlineEvidenceSource) => void;
  overview: (close: () => void) => React.ReactNode;
}) {
  const [showOverview, setShowOverview] = useState(false);
  const [showBeats, setShowBeats] = useState(false);
  const fields = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const fieldRef = (id: string, field: string) => (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    const key = `${id}:${field}`;
    if (element) fields.current.set(key, element);
    else fields.current.delete(key);
  };

  useEffect(() => {
    if (!focus) return;
    if (showOverview) {
      setShowOverview(false);
      return;
    }
    if (focus.sceneId !== sceneId) return;
    const frame = requestAnimationFrame(() =>
      focusScenePlanningField(fields.current.get(`${focus.sceneId}:${focus.field || 'purpose'}`), focus.quote),
    );
    return () => cancelAnimationFrame(frame);
  }, [focus, sceneId, showOverview]);

  const unit = project.units.find((u) => u.id === unitId) || project.units[0];
  const nodes = unit.structureNodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  const scenes = unit.scenes.filter((s) =>
    !nodeId || nodeId === UNASSIGNED_NODE
      ? !nodeId || !s.structureNodeId
      : s.structureNodeId === nodeId || nodes.find((n) => n.id === s.structureNodeId)?.parentId === nodeId,
  );
  const selected = scenes.find((s) => s.id === sceneId);
  const basis = outlineText(project, unitOutlineOwner(project, unit));
  const beats = beatsForUnit(project, unit);
  const characters = unitCharacters(project, unit);
  const storylines = (project.storylines ?? []).filter((line) => visibleInUnit(line.scopeId, project, unit));

  const update = (scene: Scene, field: keyof Scene, value: string | number | string[]) =>
    onUpdateUnit({ ...unit, scenes: unit.scenes.map((s) => (s.id === scene.id ? { ...s, [field]: value } : s)) });

  const move = (scene: Scene, direction: number) => {
    const index = unit.scenes.indexOf(scene);
    const other = unit.scenes[index + direction];
    if (!other || other.structureNodeId !== scene.structureNodeId) return;
    const next = [...unit.scenes];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onUpdateUnit({ ...unit, scenes: next });
  };

  const openRelatedScene = (targetUnitId: string, targetSceneId: string) => {
    if (targetUnitId !== unit.id || !scenes.some((scene) => scene.id === targetSceneId)) {
      const target = project.units.find((unit) => unit.id === targetUnitId)?.scenes.find((scene) => scene.id === targetSceneId);
      onNode(target?.structureNodeId);
    }
    onScene(targetUnitId, targetSceneId);
  };

  return (
    <div className="script-work-page flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Top Header */}
      <header className="script-work-header flex items-center justify-between px-6 py-3.5 bg-bg-surface/80 backdrop-blur-md shadow-xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Layers size={18} />
          </div>
          <h2 className="text-base font-semibold text-text-primary tracking-tight">分场规划</h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-bg-surface-soft text-text-secondary font-medium">
            {unit.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={showOverview}
            onClick={() => setShowOverview(!showOverview)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              showOverview
                ? 'bg-text-primary text-bg-surface shadow-xs'
                : 'bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary'
            }`}
          >
            {showOverview
              ? '返回当前场景'
              : project.profile.organization === 'standalone'
                ? '全片概览'
                : '全集概览'}
          </button>
          <button
            type="button"
            data-primary="true"
            onClick={onWrite}
            className="script-primary-btn inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
          >
            写正文
            <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      {showOverview ? (
        <div className="flex-1 min-h-0 flex flex-col script-analysis-anchor overflow-y-auto">
          {overview(() => setShowOverview(false))}
          <ScriptAnalysisOutlet />
        </div>
      ) : (
        <div className="script-work-columns flex-1 min-h-0 flex overflow-hidden">
          <ScriptWorkDirectory
            project={project}
            unitId={unit.id}
            nodeId={nodeId}
            sceneId={sceneId}
            showScenes
            onUnit={onUnit}
            onNode={onNode}
            onScene={onScene}
            onAddUnit={onAddUnit}
          />
          <main className="script-work-main script-analysis-anchor flex-1 min-h-0 flex flex-col overflow-hidden bg-bg-primary">
            {/* Toolbar */}
            <div className="script-work-toolbar flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-bg-surface/50 backdrop-blur-xs">
              <div className="flex items-center gap-2.5">
                <strong className="text-sm font-semibold text-text-primary tracking-tight">
                  {unit.title}
                  {node ? ` · ${node.title}` : nodeId === UNASSIGNED_NODE ? ' · 未归组' : ''}
                </strong>
                <span className="text-xs px-2 py-0.5 rounded-full bg-bg-surface-soft text-text-muted font-medium">
                  {scenes.length} 场
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="规划当前范围分场"
                  aria-label="规划当前范围分场"
                  disabled={nodeId === UNASSIGNED_NODE}
                  onClick={() => onRequest('plan')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Sparkles size={14} />
                  AI 规划分场
                </button>
                <button
                  type="button"
                  title="新增场景"
                  aria-label="新增场景"
                  disabled={nodeId === UNASSIGNED_NODE}
                  onClick={onAddScene}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface hover:bg-bg-surface-hover text-text-primary active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all"
                >
                  <Plus size={14} />
                  新增场景
                </button>
                <button
                  type="button"
                  aria-pressed={showBeats}
                  onClick={() => setShowBeats(!showBeats)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    showBeats
                      ? 'bg-text-primary text-bg-surface shadow-xs'
                      : 'bg-bg-surface hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary shadow-xs'
                  }`}
                >
                  关键节拍
                </button>
                <button
                  type="button"
                  disabled={nodeId === UNASSIGNED_NODE && !selected}
                  title={nodeId === UNASSIGNED_NODE && !selected ? '先选中一个未归组场景' : undefined}
                  onClick={() =>
                    onRequest(
                      'consult',
                      nodeId === UNASSIGNED_NODE
                        ? '请分析当前所选场景的结构与节奏，引用本场实际规划或正文，只给意见，不改稿。'
                        : '请分析当前范围的结构与节奏。指出具体场景的事件、信息顺序、铺垫与兑现；有正文才检查正文。先给出有依据的意见，不改稿。',
                      nodeId === UNASSIGNED_NODE ? selected?.id : undefined,
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                >
                  <Activity size={14} />
                  {nodeId === UNASSIGNED_NODE ? '分析当前场' : '分析结构与节奏'}
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="script-work-content flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
              {/* Story Basis Accordion */}
              <details className="script-story-basis group rounded-2xl bg-bg-surface p-4 shadow-xs transition-all">
                <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center justify-between select-none">
                  <div className="flex items-center gap-2">
                    <BookOpen size={15} className="text-text-muted group-hover:text-primary transition-colors" />
                    <span className="text-sm font-semibold">故事依据</span>
                  </div>
                  <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="pt-3.5 space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-text-secondary leading-relaxed bg-bg-surface-soft/60 rounded-xl p-3.5">
                    {basis || '尚未整理当前故事大纲。'}
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={onOutline}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      查看和修改大纲
                    </button>
                  </div>
                </div>
              </details>

              {/* Outline Beats Drawer/Panel */}
              {showBeats && (
                <div className="p-4 rounded-2xl bg-bg-surface/60 backdrop-blur-xs shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-primary">关联关键节拍</h3>
                    <button
                      type="button"
                      onClick={() => setShowBeats(false)}
                      className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      收起
                    </button>
                  </div>
                  <OutlineBeats
                    project={project}
                    guides={visibleOutlineGuides(project, unit).map((g) => ({
                      ...g,
                      beats: g.beats.filter((b) => beats.some((item) => item.beat.id === b.id)),
                    }))}
                    unitId={unit.id}
                    sceneId={selected?.id}
                    editableOwner={unitOutlineOwner(project, unit)}
                    onRequestChange={onRequestBeatChange}
                    onOpenOwner={
                      onLocateOutline
                        ? (owner, beatId) => onLocateOutline({ owner, beatId, tab: 'beats', start: 0, end: 0 })
                        : undefined
                    }
                    onChange={onChange}
                    onOpenScene={openRelatedScene}
                    onLocate={
                      onLocateOutline
                        ? (guide, start) => {
                            const anchor = guide.beats.flatMap((beat) => beat.anchors).find((anchor) => anchor.start === start);
                            if (anchor) onLocateOutline({ owner: guide.owner, start, end: anchor.end });
                          }
                        : undefined
                    }
                  />
                </div>
              )}

              {/* Empty State */}
              {!scenes.length && (
                <section className="script-empty-state rounded-2xl bg-bg-surface p-12 text-center space-y-3 shadow-xs">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Layers size={24} />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary">把当前故事展开成场景</h3>
                  <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
                    按场安排人物行动、信息和前后变化，再分批写正文。
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      disabled={nodeId === UNASSIGNED_NODE}
                      onClick={() => onRequest('plan')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                    >
                      <Sparkles size={14} />
                      根据大纲规划分场
                    </button>
                  </div>
                </section>
              )}

              {/* Scene Sequence List */}
              <ol className="script-scene-sequence space-y-3.5 list-none p-0 m-0">
                {scenes.map((scene) => {
                  const open = scene.id === sceneId;
                  const index = unit.scenes.indexOf(scene);
                  const linkedBeatsCount = beats.filter(({ beat }) =>
                    beat.sceneRefs.some((ref) => ref.sceneId === scene.id),
                  ).length;

                  return (
                    <li
                      key={scene.id}
                      data-scene-id={scene.id}
                      className={`rounded-2xl transition-all shadow-xs ${
                        open
                          ? 'bg-bg-surface ring-2 ring-primary/25 shadow-sm'
                          : 'bg-bg-surface hover:shadow-sm'
                      }`}
                    >
                      {/* Scene Row Summary */}
                      <div className="script-scene-row flex items-center justify-between p-4 gap-3">
                        <button
                          type="button"
                          className="script-scene-select flex-1 min-w-0 flex items-center gap-3 text-left group"
                          aria-expanded={open}
                          onClick={() => onScene(unit.id, scene.id)}
                        >
                          <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                            {index + 1}
                          </span>
                          <strong className="text-sm font-semibold text-text-primary truncate">
                            {scene.title}
                          </strong>
                          <small className="text-xs text-text-muted truncate">
                            {scene.location}
                            {scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''}
                          </small>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            title="上移一场"
                            aria-label={`上移${scene.title}`}
                            disabled={!unit.scenes[index - 1] || unit.scenes[index - 1].structureNodeId !== scene.structureNodeId}
                            onClick={() => move(scene, -1)}
                            className="p-1.5 rounded-lg hover:bg-bg-surface-soft text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            title="下移一场"
                            aria-label={`下移${scene.title}`}
                            disabled={!unit.scenes[index + 1] || unit.scenes[index + 1].structureNodeId !== scene.structureNodeId}
                            onClick={() => move(scene, 1)}
                            className="p-1.5 rounded-lg hover:bg-bg-surface-soft text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            title="与 AI 整理本场"
                            aria-label={`与 AI 整理${scene.title}`}
                            onClick={() => onRequest('scene_turn', undefined, scene.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
                          >
                            <Sparkles size={13} />
                            整理
                          </button>
                        </div>
                      </div>

                      {/* Collapsed Synopsis */}
                      {!open && (
                        <div className="px-4 pb-4 pt-0">
                          <p className="script-scene-synopsis text-xs text-text-secondary line-clamp-2 leading-relaxed">
                            {scene.purpose || '尚未安排本场事件'}
                            {linkedBeatsCount > 0 && (
                              <span className="text-xs text-text-muted"> · 关联 {linkedBeatsCount} 个关键节拍</span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Expanded Scene Detail Form */}
                      {open && (
                        <div className="script-scene-detail px-5 pb-5 pt-1 space-y-4">
                          <div className="script-plan-fields grid grid-cols-1 md:grid-cols-3 gap-3">
                            {(
                              [
                                ['title', '场景标题'],
                                ['location', '地点'],
                                ['timeOfDay', '时间'],
                                ['purpose', '本场事件'],
                                ['entryState', '进入时的状态'],
                                ['exitState', '离开时的变化'],
                              ] as const
                            ).map(([field, label]) => {
                              const isTextArea = ['purpose', 'entryState', 'exitState'].includes(field);
                              const colSpan = field === 'purpose' ? 'md:col-span-3' : isTextArea ? 'md:col-span-3 lg:col-span-1.5' : '';

                              return (
                                <label
                                  key={field}
                                  className={`block space-y-1.5 ${colSpan}`}
                                >
                                  <span className="text-xs font-medium text-text-secondary">{label}</span>
                                  {isTextArea ? (
                                    <textarea
                                      ref={fieldRef(scene.id, field)}
                                      data-scene-field={field}
                                      aria-label={label}
                                      placeholder={fieldHints[field]}
                                      value={scene[field]}
                                      rows={field === 'purpose' ? 3 : 2}
                                      onChange={(e) => update(scene, field, e.target.value)}
                                      className="block w-full min-w-0 rounded-xl bg-bg-surface-soft border-0 px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"
                                    />
                                  ) : (
                                    <input
                                      ref={fieldRef(scene.id, field)}
                                      data-scene-field={field}
                                      aria-label={label}
                                      placeholder={fieldHints[field]}
                                      value={scene[field]}
                                      onChange={(e) => update(scene, field, e.target.value)}
                                      className="block w-full min-w-0 rounded-xl bg-bg-surface-soft border-0 px-3.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"
                                    />
                                  )}
                                </label>
                              );
                            })}
                          </div>

                          {/* More Settings Accordion */}
                          <details className="group rounded-xl bg-bg-surface-soft/40 p-3.5 text-xs">
                            <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center justify-between select-none">
                              <span className="font-semibold">更多安排</span>
                              <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="script-plan-fields pt-3 space-y-3.5">
                              <label className="block space-y-1.5">
                                <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                                  <Clock size={13} className="text-text-muted" />
                                  目标时长（秒）
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  aria-label="目标时长（秒）"
                                  placeholder="未设定"
                                  value={scene.targetDurationMs ? scene.targetDurationMs / 1000 : ''}
                                  onChange={(e) => {
                                    const seconds = Number(e.target.value);
                                    if (Number.isFinite(seconds) && seconds >= 0)
                                      update(scene, 'targetDurationMs', Math.round(seconds * 1000));
                                  }}
                                  className="block w-40 rounded-xl bg-bg-surface border-0 px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 outline-none"
                                />
                              </label>

                              {/* Characters */}
                              <fieldset className="space-y-1.5 border-0 p-0 m-0">
                                <legend className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                                  <Users size={13} className="text-text-muted" />
                                  登场人物
                                </legend>
                                {!characters.length && <p className="text-xs text-text-muted">尚未登记本故事人物</p>}
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {characters.map((character) => (
                                    <label
                                      key={character.id}
                                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-bg-surface hover:bg-bg-surface-hover cursor-pointer text-xs font-medium text-text-secondary has-[:checked]:bg-primary/10 has-[:checked]:text-primary transition-all select-none shadow-2xs"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={scene.characterIds.includes(character.id)}
                                        onChange={(e) =>
                                          update(
                                            scene,
                                            'characterIds',
                                            e.target.checked
                                              ? [...scene.characterIds, character.id]
                                              : scene.characterIds.filter((id) => id !== character.id),
                                          )
                                        }
                                        className="rounded border-border-primary/40 text-primary focus:ring-primary/20 accent-primary"
                                      />
                                      {character.name}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>

                              {/* Storylines */}
                              <fieldset className="space-y-1.5 border-0 p-0 m-0">
                                <legend className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                                  <GitBranch size={13} className="text-text-muted" />
                                  承接故事线
                                </legend>
                                {!storylines.length && <p className="text-xs text-text-muted">尚未登记可见故事线</p>}
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {storylines.map((line) => (
                                    <label
                                      key={line.id}
                                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-bg-surface hover:bg-bg-surface-hover cursor-pointer text-xs font-medium text-text-secondary has-[:checked]:bg-primary/10 has-[:checked]:text-primary transition-all select-none shadow-2xs"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={scene.storylineIds?.includes(line.id) ?? false}
                                        onChange={(e) =>
                                          update(
                                            scene,
                                            'storylineIds',
                                            e.target.checked
                                              ? [...(scene.storylineIds ?? []), line.id]
                                              : (scene.storylineIds ?? []).filter((id) => id !== line.id),
                                          )
                                        }
                                        className="rounded border-border-primary/40 text-primary focus:ring-primary/20 accent-primary"
                                      />
                                      {line.title}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            </div>
                          </details>

                          {/* Footer Action Bar */}
                          <div className="script-work-toolbar flex flex-wrap items-center justify-between gap-3 pt-2">
                            <span className="text-xs text-text-muted font-medium px-2.5 py-1 rounded-lg bg-bg-surface-soft">
                              已有正文 {scene.blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0)} 字
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowBeats(true);
                                }}
                                className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                              >
                                关联关键节拍
                              </button>
                              <button
                                type="button"
                                data-primary="true"
                                onClick={onWrite}
                                className="script-primary-btn inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] shadow-xs transition-all cursor-pointer"
                              >
                                写这一场
                                <ArrowRight size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {scenes.length > 0 && (
                <div className="rounded-2xl bg-bg-surface/80 p-5 border border-border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-text-primary text-bg-surface text-xs font-bold flex items-center justify-center">4</span>
                      <h4 className="text-sm font-semibold text-text-primary">场景已排布完毕？</h4>
                    </div>
                    <p className="text-xs text-text-secondary">
                      当前已有 {scenes.length} 个规划场景。分场完成后，即可进入下一步开始编写剧本对白与动作。
                    </p>
                  </div>
                  <button
                    type="button"
                    data-primary="true"
                    onClick={onWrite}
                    className="script-primary-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] shadow-xs shrink-0 transition-all cursor-pointer"
                  >
                    <span>下一步：开始写剧本正文</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <ScriptAnalysisOutlet />
          </main>
        </div>
      )}
    </div>
  );
}
