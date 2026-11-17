import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { ChevronDown, Play, Pause, Save, Upload, Scissors } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Episode, ManualStoryboardBoardWorkflow, Project, Scene, SceneVisualPlan } from '../../clients/domainTypes';
import { useProjectStore, flushDebouncedProjectSave } from '../../clients/stateClient';
import { persistProjectMediaUrl } from '../../clients/projectMediaClient';
import { legacyProjectClient } from '../../clients/legacyProjectClient';
import { extractSceneOverviewCells } from '../../clients/productionAssetWorkflowClient';
import type { ManualProductionAssetReadModel } from '../../clients/productionAssetWorkflowClient';
import {
  findSceneStoryboardShotCell, draftSceneFactsFromShots, emptySceneVisualPlan, sceneContinuityBasis, planSceneVideoGroups, groupBreaks, sceneVisualReviewHash,
  validateSceneOverview, resolveSceneOverviewPanelIndices, manualStoryboardHash, splitStoryboardUnitWorkflow, mergeStoryboardUnitWorkflows,
  buildStoryboardCompositeBoardSourceHash, selectStoryboardCompositeBoardReferences,
} from '../../clients/productionStoryboardWorkflowClient';
import { cn } from '../../lib/utils';
import { SceneStoryboardShotFrame } from './SceneStoryboardCanvas';
import { generationClient } from '../../clients/generationClient';

const input = 'w-full rounded border border-border-soft bg-bg-primary px-2.5 py-2 text-xs text-text-primary focus:border-cyan-500 focus:outline-none';
const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded border border-border-soft px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed';
const seconds = (n: number) => `${Number(n.toFixed(2))} 秒`;
export type ScenePlanningSection = 'basis' | 'timing' | 'overview' | 'review';
export type ScenePlanningController = { inspectShot: () => void; save: () => Promise<boolean> };
const labels = { unspecified: '尚未指定', continuous: '连续事件', time_jump: '时间跳跃', parallel: '平行事件', flashback: '闪回', independent: '独立场次' } as const;

export function SceneVisualPlanningPanel({ project, episode, scene, assets, limits: inheritedLimits, modelOptions, disabled, section, shotEditor, onSelectShot, controllerRef, onDraftStateChange, basisSupplement, selectedShotId, basisOpen = false }: {
  project: Project; episode: Episode; scene: Scene; assets?: ManualProductionAssetReadModel;
  basisSupplement?: ReactNode; selectedShotId?: string; basisOpen?: boolean; section?: ScenePlanningSection | 'hidden'; shotEditor?: ReactNode; onSelectShot?: (shotId: string) => void;
  modelOptions: Array<{ id: string; label: string; min: number; max: number; multiShot: boolean }>;
  limits?: { min: number; max: number; multiShot: boolean; label: string }; disabled?: boolean;
  controllerRef?: Ref<ScenePlanningController>; onDraftStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [internalOpen, setOpen] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [shotInspectorOpen, setShotInspectorOpen] = useState(false);
  const [overviewChoices, setOverviewChoices] = useState<Record<string, number>>({});
  const [editBasis, setEditBasis] = useState(false);
  const [generationRecipes, setGenerationRecipes] = useState<Awaited<ReturnType<typeof generationClient.catalog>>['recipes']>([]);
  useEffect(() => { let cancelled = false; void generationClient.catalog().then(data => { if (!cancelled) setGenerationRecipes(data.recipes); }).catch(() => {}); return () => { cancelled = true; }; }, []);
  const [internalTab, setTab] = useState<ScenePlanningSection>('basis');
  const open = section ? section !== 'hidden' : internalOpen;
  const tab = section && section !== 'hidden' ? section : internalTab;
  const draftKey = `scene-plan-draft:${project.id}:${episode.id}:${scene.id}`;
  const initial = useMemo(() => {
    try { const value = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); if (value?.plan?.schemaVersion === 'scene-visual-plan.v1') return value as { plan: SceneVisualPlan; base: string }; } catch { /* Storage may be unavailable. */ }
    return { plan: structuredClone(scene.visualPlan || emptySceneVisualPlan()), base: manualStoryboardHash(scene.visualPlan || emptySceneVisualPlan()) };
  }, [draftKey]);
  const [draft, setDraft] = useState<SceneVisualPlan>(initial.plan);
  const editBase = useRef(initial.base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [notes, setNotes] = useState('');
  const [reviewChecks, setReviewChecks] = useState<string[]>([]);
  const [sourceScenes, setSourceScenes] = useState<Record<string, Scene>>({});
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLInputElement>(null);
  const [anchorRole, setAnchorRole] = useState<'space' | 'boundary'>('space');
  const savedRef = useRef(scene.visualPlan);
  const shots = scene.shots || [];
  const publicModels = generationRecipes.filter(r => r.capability.mediaKind === 'video' && !r.capability.diagnostic && !r.capability.supersededBy).map(r => ({ id: r.capability.modelConfigId, label: r.capability.label + (r.capability.referenceAdapter ? ` · ${r.capability.coreLabel}` : '') + (r.capability.experimental ? ' · 实验方式' : ''), min: r.capability.minDuration, max: r.capability.maxDuration, multiShot: r.capability.multiShot, legacyIds: r.legacyModelIds }));
  const selectedRecipe = generationRecipes.find(r => !r.capability.supersededBy && r.legacyModelIds.includes(draft.targetVideoModelConfigId || ''));
  const effectiveModelId = selectedRecipe?.capability.modelConfigId || draft.targetVideoModelConfigId;
  const displayModels = publicModels.length ? publicModels : modelOptions.map(m => ({ ...m, legacyIds: [m.id] }));
  const limits = effectiveModelId ? displayModels.find(m => m.id === effectiveModelId) : inheritedLimits;
  const min = limits?.min ?? 5, max = limits?.max ?? 14;
  const currentBreaks = useMemo(() => {
    const ends = new Set((scene.manualStoryboard?.boards || []).map(b => (b.shotIds || b.board?.shotIds || [b.shotId]).at(-1)));
    return shots.slice(0, -1).filter(s => ends.has(s.id)).map(s => s.id);
  }, [scene.manualStoryboard?.boards, shots]);
  const breaks = draft.breakAfterShotIds ?? (currentBreaks.length ? currentBreaks : groupBreaks(planSceneVideoGroups(shots, undefined, min, max)));
  const groups = useMemo(() => planSceneVideoGroups(shots, breaks, min, max), [shots, breaks.join('|'), min, max]);
  const total = groups.reduce((sum, g) => sum + g.duration, 0);
  const dirty = manualStoryboardHash(draft) !== manualStoryboardHash(scene.visualPlan || emptySceneVisualPlan());
  useEffect(() => { onDraftStateChange?.({ dirty, busy }); }, [dirty, busy, onDraftStateChange]);
  const sourceScene = sourceScenes[draft.transition.sourceSceneId || ''];
  const savedSource = sourceScenes[scene.visualPlan?.transition.sourceSceneId || ''];
  const reviewCurrent = !sourceLoading && !sourceError && scene.visualPlan?.review?.sourceHash === sceneVisualReviewHash(scene, savedSource);
  const shotIndex = Math.max(0, shots.findIndex((_, i) => shots.slice(0, i + 1).reduce((sum, s) => sum + Number(s.duration || 0), 0) > time));
  const activeShot = shots[shotIndex];
  const cutIssues = groups.flatMap((g, i) => g.issues.map(issue => `第 ${i + 1} 组：${issue}`));
  if (limits && !limits.multiShot && groups.some(g => g.shotIds.length > 1)) cutIssues.push('所选模型仅支持单镜头生成，请按镜头拆组或选择多镜头工作流');

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set([draft.transition.sourceSceneId, scene.visualPlan?.transition.sourceSceneId].filter((id): id is string => !!id))];
    setSourceError(''); setSourceLoading(ids.length > 0);
    if (!ids.length) { setSourceScenes({}); return; }
    // The active screen intentionally contains only summaries of other scenes.
    // Read the selected source independently without replacing the editing workspace.
    void Promise.all(ids.map(async id => {
      const full = await legacyProjectClient.getEpisode(project.id, episode.id, 'storyboard', { sceneId: id });
      const source = full?.scenes.find(s => s.id === id);
      if (!source) throw new Error('承接来源场次不存在，请重新选择');
      return [id, source] as const;
    })).then(entries => { if (!cancelled) setSourceScenes(Object.fromEntries(entries)); })
      .catch(e => { if (!cancelled) { setSourceScenes({}); setSourceError(e instanceof Error ? e.message : '来源场次读取失败'); } })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, episode.id, episode.productionRevision, draft.transition.sourceSceneId, scene.visualPlan?.transition.sourceSceneId]);

  useEffect(() => {
    if (savedRef.current === scene.visualPlan) return;
    // Keep a local dirty draft when another editor changes the scene; save will detect conflict.
    const previous = savedRef.current;
    setDraft(current => {
      if (manualStoryboardHash(current) !== manualStoryboardHash(previous || emptySceneVisualPlan())) return current;
      editBase.current = manualStoryboardHash(scene.visualPlan || emptySceneVisualPlan());
      return structuredClone(scene.visualPlan || emptySceneVisualPlan());
    });
    savedRef.current = scene.visualPlan;
  }, [scene.visualPlan]);
  useEffect(() => {
    if (!playing || !total) return;
    const origin = performance.now() - time * 1000;
    const timer = window.setInterval(() => {
      const next = (performance.now() - origin) / 1000;
      if (next >= total) { setTime(0); setPlaying(false); } else setTime(next);
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, total]);
  useEffect(() => { setPlaying(false); }, [section]);
  useEffect(() => { setPlaying(false); setReviewChecks([]); }, [manualStoryboardHash(shots), scene.visualPlan?.updatedAt]);
  useEffect(() => {
    try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ plan: draft, base: editBase.current })); else sessionStorage.removeItem(draftKey); } catch { /* Keep editing without browser storage. */ }
  }, [draft, dirty, draftKey]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const change = <K extends keyof SceneVisualPlan>(key: K, value: SceneVisualPlan[K]) => setDraft(d => ({ ...d, [key]: value, review: undefined }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { const message = e instanceof Error ? e.message : '操作失败'; setError(message); toast.error(message); }
    finally { setBusy(false); }
  };
  const persist = async (plan: SceneVisualPlan, boards?: ManualStoryboardBoardWorkflow[]) => {
    const state = useProjectStore.getState();
    const latest = state.activeEpisode?.scenes.find(s => s.id === scene.id);
    if (state.currentProject?.id !== project.id || state.activeEpisode?.id !== episode.id || !latest || manualStoryboardHash(latest) !== manualStoryboardHash(scene)) throw new Error('场次在编辑期间有更新，请刷新核对后保存；当前输入仍保留');
    if (manualStoryboardHash(latest.visualPlan || emptySceneVisualPlan()) !== editBase.current) throw new Error('已保存方案有更新，当前草稿仍保留；请先核对或重新载入已保存方案');
    if (plan.overview) validateSceneOverview(plan.overview, shots);
    if (plan.references.some(r => r.role === 'boundary' && !shots.some(s => s.id === r.beforeShotId))) throw new Error('衔接参考的目标镜头已变化，请重新选择');
    const basisChanged = manualStoryboardHash({ basis: sceneContinuityBasis(scene.visualPlan) }) !== manualStoryboardHash({ basis: sceneContinuityBasis(plan) });
    const workspace = latest.manualStoryboard;
    const now = Date.now();
    const nextBoards = (boards || workspace?.boards || []).map(b => b.board ? { ...b, targetVideoModelConfigId: plan.targetVideoModelConfigId || b.targetVideoModelConfigId, board: { ...b.board, continuityBasis: sceneContinuityBasis(plan) } } : b);
    await state.updateScene(scene.id, {
      visualPlan: { ...plan, updatedAt: now },
      ...(workspace ? { manualStoryboard: { ...workspace, boards: nextBoards,
        ...(boards ? { unitHistory: [...(workspace.unitHistory || []), { at: now, boards: workspace.boards || [] }] } : {}),
        ...(basisChanged ? { qa: undefined } : {}), updatedAt: now } } : {}),
    }, episode.id, { expectedProjectId: project.id, expectedEpisodeId: episode.id });
    await flushDebouncedProjectSave(project.id);
    const saved = useProjectStore.getState().activeEpisode!.scenes.find(s => s.id === scene.id)!.visualPlan!;
    editBase.current = manualStoryboardHash(saved);
    setDraft(structuredClone(saved));
    toast.success('整场方案已保存');
  };
  const upload = async (file: File | undefined, purpose: 'overview' | 'anchor') => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片无法解码')); img.src = data; });
    const url = await persistProjectMediaUrl(data, project.id);
    if (purpose === 'overview') {
      const cols = Math.ceil(Math.sqrt(shots.length || 1));
      change('overview', { imageUrl: url, width: image.naturalWidth, height: image.naturalHeight, columns: cols, rows: Math.ceil((shots.length || 1) / cols), shotIds: shots.map(s => s.id) });
    } else change('references', [...draft.references, { id: crypto.randomUUID(), imageUrl: url, role: anchorRole, note: '', ...(anchorRole === 'boundary' ? { beforeShotId: shots[0]?.id } : {}) }]);
    toast.success('图片已上传，请核对用途后保存方案');
  };
  const applyGroups = async () => {
    if (!limits) throw new Error('请先在设置或视频单元中选择有效视频模型，才能应用分组');
    if (cutIssues.length) throw new Error(cutIssues[0]);
    const original = scene.manualStoryboard?.boards || [];
    const sameGroups = original.length === groups.length && original.every((b, i) =>
      JSON.stringify(b.shotIds || b.board?.shotIds || [b.shotId]) === JSON.stringify(groups[i].shotIds));
    if (!dirty && sameGroups && JSON.stringify(scene.visualPlan?.breakAfterShotIds) === JSON.stringify(breaks)) return;
    const byShot = new Map<string, ManualStoryboardBoardWorkflow>();
    for (const workflow of original) {
      if (!workflow.board) continue;
      for (const split of splitStoryboardUnitWorkflow({ workflow, shots })) {
        if (byShot.has(split.shotId)) throw new Error('镜头归属存在重复，请先在单元列表核对');
        byShot.set(split.shotId, split);
      }
    }
    if (shots.some(s => !byShot.has(s.id))) {
      await persist({ ...draft, breakAfterShotIds: breaks, review: undefined });
      toast('已保存分组边界；建立故事板结构时将按此编组'); return;
    }
    const boards = groups.map(group => {
      const existing = original.find(b => JSON.stringify(b.shotIds || b.board?.shotIds || [b.shotId]) === JSON.stringify(group.shotIds));
      if (existing) return existing;
      const parts = group.shotIds.map(id => byShot.get(id)!);
      return parts.length === 1 ? parts[0] : mergeStoryboardUnitWorkflows({ workflows: parts, shots });
    });
    await persist({ ...draft, breakAfterShotIds: breaks, review: undefined }, sameGroups ? undefined : boards);
  };
  const extract = async () => {
    if (dirty) throw new Error('请先保存当前方案，再裁切对应单元');
    const overview = scene.visualPlan?.overview;
    if (!overview || !assets) throw new Error('请先保存总览图，并载入本场资产');
    validateSceneOverview(overview, shots);
    const boards = structuredClone(scene.manualStoryboard?.boards || []);
    if (!boards.length) throw new Error('请先建立视频单元结构');
    for (const workflow of boards) {
      const board = workflow.board;
      if (!board?.visualPages?.length) throw new Error('单元尚未建立画格结构');
      for (const page of board.visualPages) {
        const panels = page.panelIds.map(id => board.panels.find(p => p.id === id)!);
        if (panels.some(p => !p)) throw new Error('片段画格已变化，请刷新核对');
        const indices = resolveSceneOverviewPanelIndices(overview, panels, overviewChoices);
        const columns = Number(page.layout.split('x')[0]);
        const result = await extractSceneOverviewCells({ ...overview, indices, targetColumns: columns });
        const url = await persistProjectMediaUrl(result.imageUrl, project.id);
        const unitShots = shots.filter(s => panels.some(p => p.shotId === s.id));
        const refs = selectStoryboardCompositeBoardReferences({ project, board, shots: unitShots, assets }).selected;
        const now = Date.now();
        page.visualTakes = [...(page.visualTakes || []), {
          id: `overview-crop-${crypto.randomUUID()}`, imageUrl: url, sourceImageUrl: url, videoReferenceImageUrl: url,
          sourceHash: buildStoryboardCompositeBoardSourceHash({ project, board, page, references: refs, shots: unitShots }),
          prompt: '从作者映射的联合总览图裁切对应画格；保持原像素细节，未调用生成模型。', promptHash: manualStoryboardHash({ overview, indices }),
          modelId: 'overview-extraction', selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], selectedAssetBoardItemIds: refs.map(r => r.boardItemId),
          referenceImageUrls: [overview.imageUrl], panelIds: page.panelIds, attempt: 1, status: 'candidate',
          review: { mode: 'manual', status: 'pending', notes: `总览裁切，每格约 ${result.cellWidth}×${result.cellHeight}。请检查细节和状态；放大不代表原生高清。` },
          executions: [], createdAt: now,
        }];
      }
    }
    await persist(scene.visualPlan!, boards);
    toast.success('已加入各单元待审候选，请在单元中看图采用；没有生成视频');
  };
  const useBoundaryFrame = async (fromId: string, beforeShotId: string) => {
    const shot = shots.find(s => s.id === fromId)!;
    let imageUrl = shot.imageUrl;
    if (draft.overview && draft.overview.shotIds.includes(fromId)) {
      validateSceneOverview(draft.overview, shots);
      const crop = await extractSceneOverviewCells({ ...draft.overview, indices: [draft.overview.shotIds.indexOf(fromId)], targetColumns: 1 });
      imageUrl = await persistProjectMediaUrl(crop.imageUrl, project.id);
    }
    if (!imageUrl) {
      const grid = findSceneStoryboardShotCell(scene, fromId);
      if (grid) {
        const crop = await extractSceneOverviewCells({ ...grid, indices: [grid.index], targetColumns: 1 });
        imageUrl = await persistProjectMediaUrl(crop.imageUrl, project.id);
      }
    }
    if (!imageUrl) throw new Error('前镜尚无代表图，请先上传总览或生成镜头图');
    change('references', [...draft.references.filter(r => !(r.role === 'boundary' && r.beforeShotId === beforeShotId)), { id: crypto.randomUUID(), role: 'boundary', beforeShotId, imageUrl, note: `前镜代表画面，仅供身份与空间参考；不是视频实际尾帧。状态按镜头计划：${shot.continuityNote || '待核对'}` }]);
    toast.success('已加入衔接参考草稿，请核对后保存');
  };
  const restoreUnits = async (boards: ManualStoryboardBoardWorkflow[]) => {
    const ids = boards.flatMap(b => b.shotIds || b.board?.shotIds || [b.shotId]);
    if (ids.length !== shots.length || ids.some((id, i) => id !== shots[i].id)) throw new Error('历史镜头顺序与当前场次不同，不能直接覆盖；原素材仍保留');
    await persist({ ...draft, breakAfterShotIds: boards.slice(0, -1).map(b => (b.shotIds || b.board?.shotIds || [b.shotId]).at(-1)!), review: undefined }, structuredClone(boards));
  };
  const recordReview = async () => {
    const plan = scene.visualPlan || emptySceneVisualPlan();
    let source = savedSource;
    if (plan.transition.sourceSceneId) {
      const full = await legacyProjectClient.getEpisode(project.id, episode.id, 'storyboard', { sceneId: plan.transition.sourceSceneId });
      source = full?.scenes.find(s => s.id === plan.transition.sourceSceneId);
      if (!source) throw new Error('承接来源场次已不存在，请重新选择');
      if (sceneVisualReviewHash(scene, source) !== sceneVisualReviewHash(scene, savedSource)) {
        setSourceScenes(current => ({ ...current, [source!.id]: source! }));
        setReviewChecks([]);
        throw new Error('来源场次有更新，请检查新的交接状态后再记录');
      }
    }
    await persist({ ...plan, review: { sourceHash: sceneVisualReviewHash({ ...scene, visualPlan: plan }, source), notes, checkedAt: Date.now(), reviewer: 'creator' } });
  };
  const savePlan = async () => {
    const groupsChanged = JSON.stringify(draft.breakAfterShotIds) !== JSON.stringify(scene.visualPlan?.breakAfterShotIds)
      || draft.targetVideoModelConfigId !== scene.visualPlan?.targetVideoModelConfigId;
    if (groupsChanged && shots.length) await applyGroups();
    else if (dirty) await persist({ ...draft, review: undefined });
  };
  useImperativeHandle(controllerRef, () => ({ inspectShot: () => setShotInspectorOpen(true), save: async () => {
    if (busy || disabled) return false;
    let saved = false;
    await run(async () => { await savePlan(); saved = true; });
    return saved;
  } }));
  const existingFacts = draftSceneFactsFromShots(scene, draft);
  const basisEditor = <section aria-label="本场剧本与依据" className="space-y-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text-primary">本场依据</h3><button type="button" className="text-xs text-gold" onClick={() => setEditBasis(value => !value)}>{editBasis ? '查看摘要' : '编辑依据'}</button></div>
    <details className="text-xs"><summary className="cursor-pointer text-text-secondary">本场原文</summary><p className="mt-2 whitespace-pre-wrap leading-6 text-text-secondary">{scene.script || scene.description || '尚无本场原文'}</p></details>
    {!editBasis ? <dl className="space-y-4 text-xs leading-5">{([['geography', '固定空间'], ['lighting', '光线基准'], ['entryState', '入场状态'], ['exitState', '离场状态']] as const).map(([key, label]) => <div key={key}><dt className="text-text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-text-secondary">{draft[key] || existingFacts[key] || '尚未记录，请结合原文补充'}{!draft[key] && existingFacts[key] && <span className="mt-1 block text-text-muted">来自{key === 'exitState' ? '末镜' : '首镜'}已有记录 · 尚未保存为本场依据</span>}</dd></div>)}<div><dt className="text-text-muted">跨场关系</dt><dd className="mt-1 text-text-secondary">{labels[draft.transition.kind]}{draft.transition.cue ? ` · ${draft.transition.cue}` : ''}</dd></div></dl> : <>
    <button type="button" className={button} disabled={busy || disabled || !shots.length} onClick={() => setDraft(current => draftSceneFactsFromShots(scene, current))}>提取已有镜头记录</button><p className="text-xs leading-5 text-text-muted">仅提取首尾镜头的已有字段，缺失内容仍需核对原文补充。</p>
<div className="grid gap-4 grid-cols-1">
        {([['geography', '固定空间与地标', '写清入口、出口、人物活动区域；机位改变时仍能辨认地点'], ['lighting', '光线与画面基准', '主光方向、时间、天气；剧情特效按对应镜头出现'], ['entryState', '本场起始状态', '人物、持物、伤势和事件进度'], ['exitState', '本场结束状态', '明确哪些变化已完成，避免下一组或下一场复原']] as const).map(([key, label, placeholder]) => <label key={key} className="space-y-1.5 text-xs text-text-secondary">{label}<textarea className={input} rows={3} value={draft[key]} placeholder={placeholder} onChange={e => change(key, e.target.value)} /></label>)}
        <details className="space-y-3 col-span-1" open={draft.transition.kind !== 'unspecified' || !!draft.transition.sourceSceneId || undefined}>
          <summary className="cursor-pointer text-xs font-bold text-text-primary">与其他场次的关系（可选）</summary>
          <p className="text-xs text-text-muted">首场可留空。需要承接另一场时，注明保留的状态、变化和转场理由。</p>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-secondary">关系<select className={input} value={draft.transition.kind} onChange={e => change('transition', { ...draft.transition, kind: e.target.value as SceneVisualPlan['transition']['kind'] })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs text-text-secondary">承接场次<select className={input} value={draft.transition.sourceSceneId || ''} onChange={e => change('transition', { ...draft.transition, sourceSceneId: e.target.value || undefined })}><option value="">无 / 尚未确定</option>{episode.scenes.filter(s => s.id !== scene.id).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label></div>
          {sourceLoading && <p className="text-xs text-text-muted">正在读取来源场次…</p>}{sourceError && <p role="alert" className="text-xs text-red-400">{sourceError}</p>}{sourceScene && <p className="text-xs leading-5 text-text-muted">来源结束状态：{sourceScene.visualPlan?.exitState || sourceScene.shots?.at(-1)?.continuityNote || '尚未记录，请阅读来源场次后填写。'}</p>}
          <div className="grid gap-3 grid-cols-1">{([['carryOver', '需要延续', '身份、伤势、持物、动作阶段'], ['changes', '需要改变', '新地点、时间、光线或有依据的换装'], ['cue', '转场依据', '动作、视线、声音或叙事联系']] as const).map(([key, label, placeholder]) => <label key={key} className="text-xs text-text-secondary">{label}<textarea rows={3} className={input} value={draft.transition[key]} placeholder={placeholder} onChange={e => change('transition', { ...draft.transition, [key]: e.target.value })} /></label>)}</div>
        </details>
      </div></>}{basisSupplement}
  </section>;
  const renderFrame = (shotId: string, overview = draft.overview) => {
    const shot = shots.find(s => s.id === shotId);
    return shot ? <SceneStoryboardShotFrame scene={{ ...scene, visualPlan: { ...draft, overview } }} shot={shot} /> : <p className="p-3 text-xs text-text-muted">暂无代表画面</p>;
  };
  return <section hidden={section === 'hidden'} className={cn('mb-5 min-w-0', !section && 'border-y border-border-soft/40 py-3')} aria-label="整场视觉规划">
    {!section && <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
      <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /><span className="text-sm font-bold text-text-primary">整场规划与衔接</span>
      <span className="text-xs text-text-muted">{shots.length} 镜头 · {seconds(total)} · {groups.length} 个计划单元</span>
      <span className="ml-auto text-xs text-text-muted">{dirty ? '有未保存修改' : reviewCurrent ? '作者已检查此版' : '待检查'} · 展开规划</span>
    </button>}
    {open && <>
      {!section && <div className="mb-4 flex items-center justify-between gap-3"><div className="flex gap-2">{([['basis', '场景'], ['timing', '镜头'], ['overview', '参考'], ['review', '检查']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={button}>{label}</button>)}</div><button type="button" disabled={busy || disabled || !dirty} onClick={() => void run(savePlan)} className={button}><Save className="h-3.5 w-3.5" />保存当前修改</button></div>}
      {error && <div role="alert" className="my-3 flex flex-wrap items-center gap-2 text-xs text-red-400">{error}<button type="button" className={button} disabled={busy} onClick={() => { editBase.current = manualStoryboardHash(scene.visualPlan || emptySceneVisualPlan()); setDraft(structuredClone(scene.visualPlan || emptySceneVisualPlan())); setError(''); }}>放弃草稿并载入已保存方案</button></div>}
      <fieldset disabled={busy || disabled} className="min-w-0">
      {tab === 'basis' && basisEditor}
      {tab === 'timing' && <div className="space-y-4">
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-text-muted">按叙事顺序编排镜头</span><button type="button" aria-pressed={showGroups} onClick={() => setShowGroups(value => !value)} className={button}>{showGroups ? '隐藏生成分组' : '显示生成分组'}</button></div>
        {showGroups && <div className="space-y-3 border-b border-border-soft/30 pb-4" aria-label="生成分组设置">        <details className="max-w-xl text-xs text-text-secondary"><summary className="cursor-pointer">分段依据：{limits?.label || '当前默认生成方式'} · 调整</summary><label className="mt-3 block">目标视频生成方式<select className={input} value={effectiveModelId || ''} onChange={e => change('targetVideoModelConfigId', e.target.value || undefined)}><option value="">沿用当前项目方案</option>{displayModels.map(model => <option key={model.id} value={model.id}>{model.label} · {model.min}–{model.max} 秒 · {model.multiShot ? '可编排多镜头' : '单镜头'}</option>)}</select></label><p className="mt-2 leading-5 text-text-muted">这里用于检查分段容量。参考素材、分辨率与采样参数在生成工作台中调整；实验方式仍需实际画面验证。</p></details>
        <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-text-secondary">{limits ? `本场 ${seconds(total)} → ${groups.length} 个片段 · 每次请求 ${min}–${max} 秒` : '尚未统一目标模型；以下按请求上限14秒预览，应用前需选择模型'}</p><button type="button" className={button} onClick={() => change('breakAfterShotIds', groupBreaks(planSceneVideoGroups(shots, undefined, min, max)))}>按容量建议分组</button><button type="button" className={button} onClick={() => void run(applyGroups)} disabled={!shots.length || !limits || !!cutIssues.length}><Scissors className="h-3.5 w-3.5" />应用生成分组</button></div>
        <p className="text-xs text-text-muted">勾选合理切点结束一组。建议只处理容量，不代表剪辑已经合理；短片段可按模型最低时长生成后剪用，不必延长叙事；原有单元和素材会保留在编组历史中。</p>
</div>}
        <div className={cn("grid items-start gap-5", (basisOpen || shotInspectorOpen) && "xl:grid-cols-[minmax(0,1fr)_320px]")}><div className="min-w-0">{!showGroups ? <div className={cn("grid gap-3", basisOpen || shotInspectorOpen ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3")}>{shots.map((shot, index) => <button type="button" key={shot.id} aria-label={`编辑镜头 ${index + 1}`} aria-pressed={selectedShotId === shot.id} onClick={() => { onSelectShot?.(shot.id); setShotInspectorOpen(true); setPlaying(false); setTime(shots.slice(0, index).reduce((n, s) => n + Number(s.duration || 0), 0)); }} className={cn('min-w-0 overflow-hidden rounded-md border text-left', selectedShotId === shot.id ? 'border-gold ring-1 ring-gold/30' : 'border-border-soft/30 hover:border-gold/60')}><div className="aspect-video bg-bg-primary">{renderFrame(shot.id)}</div><div className="p-3"><p className="flex justify-between text-xs font-semibold text-text-primary"><span>镜头 {index + 1}</span><span className="font-normal text-text-muted">{seconds(Number(shot.duration || 0))}</span></p><p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary">{shot.visualSummary || shot.visualAction || '待填写动作'}</p></div></button>)}</div> : <div className="space-y-3">{(showGroups ? groups : shots.map(shot => ({ shotIds: [shot.id], duration: Number(shot.duration || 0), issues: [] as string[] }))).map((g, i) => <article key={g.shotIds.join('|')} className="border-b border-border-soft/40 py-3">{showGroups && <div className="mb-2 flex justify-between text-xs font-bold text-text-primary"><span>生成片段 {i + 1} · {g.shotIds.length} 镜头</span><span>{seconds(g.duration)}</span></div>}{g.shotIds.map(id => { const index = shots.findIndex(s => s.id === id), shot = shots[index]; return <div key={id} className="border-t border-border-soft/25 py-2 text-xs"><button type="button" aria-pressed={selectedShotId === id} onClick={() => { onSelectShot?.(id); setShotInspectorOpen(true); setPlaying(false); setTime(shots.slice(0, index).reduce((n, s) => n + Number(s.duration || 0), 0)); }} className={cn("w-full rounded-md p-2 text-left", selectedShotId === id ? "bg-gold/10 text-gold" : "text-text-primary hover:bg-bg-surface")}>镜头 {index + 1} · {seconds(Number(shot.duration || 0))} · {shot.visualSummary || shot.visualAction || '待填写动作'}</button><p className="mt-1 text-text-muted">切镜依据：{shot.editingNote || '尚未填写，可在镜头详情补充'}</p>{showGroups && index < shots.length - 1 && <label className="mt-2 flex items-center gap-2 text-text-secondary"><input type="checkbox" checked={breaks.includes(id)} onChange={e => change('breakAfterShotIds', e.target.checked ? [...breaks, id] : breaks.filter(value => value !== id))} />此镜后结束本组</label>}</div>; })}{g.issues.map(issue => <p key={issue} className="mt-2 text-xs text-amber-400">{issue}</p>)}</article>)}</div>}</div>
        <div className={cn("min-w-0 border-l border-border-soft/30 pl-4", !basisOpen && !shotInspectorOpen && "hidden")}>{!basisOpen && <button type="button" className="mb-3 text-xs text-text-muted hover:text-gold" onClick={() => setShotInspectorOpen(false)}>收起镜头详情</button>}{basisOpen ? basisEditor : shotEditor}<details className="mt-4" open={!shotEditor && !basisOpen}><summary className="mb-3 cursor-pointer text-xs text-text-secondary">静态试播 · 检查对白与节奏</summary><div className="aspect-video overflow-hidden rounded bg-black">{activeShot && renderFrame(activeShot.id)}</div><div className="mt-2 flex items-center gap-3"><button type="button" className={button} disabled={!total} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? '暂停试播' : '按时长试播'}</button><span className="text-xs text-text-secondary">{seconds(time)} / {seconds(total)} · 镜头 {shotIndex + 1}</span></div><input type="range" aria-label="分镜试播进度" min={0} max={Math.max(0, total - 0.01)} step={0.01} value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} className="mt-3 w-full" /><p className="mt-2 text-xs leading-5 text-text-secondary">{activeShot?.dialogueLines?.map(d => `${d.speakerName || '角色'}：${d.text}`).join(' / ') || '本镜无对白'}</p><p className="mt-2 text-xs leading-5 text-text-muted">静态分镜按计划时长播放，不调用视频模型，也不模拟角色动作或自动配音。请朗读对白，检查动作与停顿是否放得下。</p></details></div></div>
        {showGroups && cutIssues.length > 0 && <p className="text-xs text-amber-400">{cutIssues.join('；')}</p>}
      </div>}
      {tab === 'overview' && <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={!shots.length} onClick={() => uploadRef.current?.click()}><Upload className="h-3.5 w-3.5" />上传联合总览图</button><button type="button" className={button} onClick={() => void run(extract)} disabled={!draft.overview || dirty}>裁切为各单元待审参考</button><input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void run(() => upload(file, 'overview')); }} /></div>
        <p className="text-xs leading-5 text-text-muted">总览图覆盖整场，不作为超时视频输入。此入口支持等分画格，按从左到右、从上到下映射；一镜多格时，裁切前选择片段实际使用的关键画格。裁切只重新排版，不是重新生成，不会自动采用。</p>
        {draft.overview && <div className="grid gap-4 lg:grid-cols-2"><img src={draft.overview.imageUrl} alt="整场总览，非单次视频输入" className="max-h-96 w-full object-contain" /><div className="space-y-3"><p className="text-xs text-text-primary">整场 {seconds(total)} · 原图 {draft.overview.width}×{draft.overview.height}</p><div className="flex gap-3">{(['columns', 'rows'] as const).map(key => <label key={key} className="text-xs text-text-secondary">{key === 'columns' ? '列数' : '行数'}<input className={input} type="number" min={1} max={12} value={draft.overview![key]} onChange={e => change('overview', { ...draft.overview!, [key]: Number(e.target.value) })} /></label>)}</div><p className="text-xs text-amber-400">每格约 {Math.floor(draft.overview.width / (draft.overview.columns || 1))}×{Math.floor(draft.overview.height / (draft.overview.rows || 1))}；放大不能恢复缺失细节。</p><div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto">{draft.overview.shotIds.map((id, i) => <label key={i} className="text-xs text-text-secondary">画格 {i + 1}<select className={input} value={id} onChange={e => change('overview', { ...draft.overview!, shotIds: draft.overview!.shotIds.map((value, index) => index === i ? e.target.value : value) })}>{shots.map((s, index) => <option key={s.id} value={s.id}>镜头 {index + 1}</option>)}</select></label>)}</div><button type="button" className={button} onClick={() => change('overview', undefined)}>移除当前总览关联</button></div></div>}
        {draft.overview && new Set(draft.overview.shotIds).size !== draft.overview.shotIds.length && <details className="border-t border-border-soft/30 pt-3"><summary className="cursor-pointer text-xs text-text-secondary">视频片段画格来源 · 一镜多格时选择</summary><p className="my-2 text-xs text-text-muted">只选择本片段需要的关键状态，不改变叙事时长。尚无片段时，先在分镜的生成分组中按视频容量组织。</p><div className="grid grid-cols-2 gap-3">{(scene.manualStoryboard?.boards || []).flatMap((unit, unitIndex) => unit.board?.panels.map(panel => { const available = draft.overview!.shotIds.flatMap((id, i) => id === panel.shotId ? [i] : []); return <label key={panel.id} className="text-xs">片段 {unitIndex + 1} · 画格 {panel.panelNumber} · 镜头 {shots.findIndex(s => s.id === panel.shotId) + 1}<select className={input} value={overviewChoices[panel.id] ?? (available.length === 1 ? available[0] : '')} onChange={e => setOverviewChoices(value => { const next = { ...value }; if (e.target.value === '') delete next[panel.id]; else next[panel.id] = Number(e.target.value); return next; })}><option value="">选择总览画格</option>{available.map(i => <option key={i} value={i}>总览第 {i + 1} 格</option>)}</select></label>; }) || [])}</div></details>}
        <div className="border-t border-border-soft/30 pt-4"><p className="mb-2 text-xs font-bold text-text-primary">分批生成的共同参考</p><p className="mb-3 text-xs leading-5 text-text-muted">原始角色与道具资产仍由系统引用。这里补充经检查的空间基准，或指定镜头前的衔接状态；下一组不能只复制上一组，换场也不能复制旧背景。图片会计入模型参考容量。</p><div className="flex flex-wrap gap-2"><select className={cn(input, 'w-auto')} aria-label="新增参考用途" value={anchorRole} onChange={e => setAnchorRole(e.target.value as typeof anchorRole)}><option value="space">本场空间基准</option><option value="boundary">指定镜头衔接</option></select><button type="button" className={button} onClick={() => anchorRef.current?.click()}>上传参考图</button><input ref={anchorRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void run(() => upload(file, 'anchor')); }} /></div>
        <div className="mt-3 space-y-3">{draft.references.map(ref => <div key={ref.id} className="flex flex-wrap items-start gap-3 border-b border-border-soft/25 pb-3"><img src={ref.imageUrl} alt={ref.role === 'space' ? '空间基准' : '衔接状态'} className="h-20 w-28 object-contain" /><div className="min-w-0 flex-1 space-y-2"><input className={input} aria-label="参考图用途说明" placeholder="只继承什么、不能复制什么" value={ref.note} onChange={e => change('references', draft.references.map(r => r.id === ref.id ? { ...r, note: e.target.value } : r))} />{ref.role === 'boundary' && <select className={input} aria-label="衔接镜头" value={ref.beforeShotId || ''} onChange={e => change('references', draft.references.map(r => r.id === ref.id ? { ...r, beforeShotId: e.target.value } : r))}><option value="">选择衔接镜头</option>{shots.map((s, i) => <option key={s.id} value={s.id}>镜头 {i + 1} 前</option>)}</select>}</div><button type="button" className={button} onClick={() => change('references', draft.references.filter(r => r.id !== ref.id))}>移除关联</button></div>)}</div></div>
      </div>}
      {tab === 'review' && <div className="space-y-4"><p className="text-xs leading-5 text-text-secondary">{reviewCurrent ? '作者已检查当前版本。' : scene.visualPlan?.review ? '计划、参考图或来源场次有变化，请重新检查。' : '尚无本版检查记录。'} 此记录只表示分镜计划检查，不代表生成视频已验收。</p>{sourceLoading && <p className="text-xs text-text-muted">正在核对来源场次…</p>}{sourceError && <p role="alert" className="text-xs text-red-400">{sourceError}</p>}<div className="space-y-4">{groups.slice(1).map((group, i) => {
          const previousId = groups[i].shotIds.at(-1)!, nextId = group.shotIds[0];
          return <article key={nextId} className="border-b border-border-soft/30 pb-4"><p className="mb-2 text-xs font-bold text-text-primary">第 {i + 1} 组 → 第 {i + 2} 组</p><div className="grid grid-cols-2 gap-3">{[previousId, nextId].map(id => <div key={id}><div className="aspect-video overflow-hidden bg-black">{renderFrame(id)}</div><p className="mt-2 text-xs text-text-secondary">镜头 {shots.findIndex(s => s.id === id) + 1}：{shots.find(s => s.id === id)?.continuityNote || '待补状态'}</p></div>)}</div><p className="my-2 text-xs text-text-muted">代表画面不一定是实际首尾帧。切镜依据：{shots.find(s => s.id === previousId)?.editingNote || '待填写'}</p><button type="button" className={button} onClick={() => void run(() => useBoundaryFrame(previousId, nextId))}>将前镜画格加入此处衔接参考</button></article>;
        })}</div>
        {sourceScene && <div className="border-b border-border-soft/30 pb-3"><p className="text-xs font-bold text-text-primary">跨场：{sourceScene.title} → {scene.title}</p><div className="mt-2 grid grid-cols-2 gap-3"><div className="aspect-video bg-black">{sourceScene.shots?.at(-1)?.imageUrl ? <img src={sourceScene.shots.at(-1)!.imageUrl} alt="来源场次末镜代表图" className="h-full w-full object-contain" /> : <p className="p-3 text-xs text-text-muted">来源场次暂无末镜代表图</p>}</div><div className="aspect-video bg-black">{shots[0] && renderFrame(shots[0].id)}</div></div><p className="mt-2 text-xs text-text-secondary">继承：{draft.transition.carryOver || '待填写'}；改变：{draft.transition.changes || '待填写'}</p></div>}
        <div className="space-y-2">{['已逐格检查人物、空间、光影与道具状态', '已按计划时长试播并核对对白与动作容量', '已检查组间与跨场交接，记录退场或损坏复原等问题'].map(label => <label key={label} className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={reviewChecks.includes(label)} onChange={e => setReviewChecks(e.target.checked ? [...reviewChecks, label] : reviewChecks.filter(v => v !== label))} />{label}</label>)}</div><label className="block text-xs text-text-secondary">观察与待处理问题<textarea className={input} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="记录实际看到的问题，不以任务成功代替画面验收" /></label><button type="button" className={button} disabled={dirty || sourceLoading || !!sourceError || reviewChecks.length !== 3 || !!cutIssues.length || !shots.length} onClick={() => void run(recordReview)}>记录本版作者检查</button><p className="text-xs text-text-muted">{scene.visualPlan?.review?.notes}</p><details className="text-xs text-text-muted"><summary>编组历史（{scene.manualStoryboard?.unitHistory?.length || 0} 版，完整素材保留）</summary>{scene.manualStoryboard?.unitHistory?.map(h => <p key={h.at} className="mt-2">{new Date(h.at).toLocaleString()} · {h.boards.length} 个单元 · {h.boards.reduce((n, b) => n + (b.takes?.length || 0), 0)} 个视频候选 <button type="button" className={button} onClick={() => void run(() => restoreUnits(h.boards))}>恢复此版编组</button></p>)}</details></div>}
      </fieldset>
      {busy && <p role="status" className="mt-3 text-xs text-text-muted">正在保存，请勿切换场次…</p>}
    </>}
  </section>;
}
