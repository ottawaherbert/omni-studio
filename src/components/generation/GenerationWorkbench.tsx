import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Film, Image as ImageIcon, LayoutGrid, List, Loader2, LockKeyhole, Pause, Plus, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { generationClient } from '../../clients/generationClient';
import { assetClient } from '../../clients/assetClient';
import { legacyProjectClient } from '../../clients/legacyProjectClient';
import { replaceCurrentProjectSnapshot, useProjectStore, useAIConfigStore } from '../../clients/stateClient';
import { GenerationBatchPanel } from './GenerationBatchPanel';
import { GenerationReferences, GenerationReferenceInspector } from './GenerationReferences';
import { GenerationCanvas } from './GenerationCanvas';
import { generationRoleLabels, generationStatusLabels, generationTargetKey, validateGenerationDraft, resolveGenerationParameters,
  type GenerationTaskDraft, type GenerationTarget, type GenerationOperation, type GenerationWorkspace, type GenerationReference, type GenerationPlanRevision, type GenerationIssue, type GenerationParameter, type GenerationExecution, type GenerationLayout } from '../../../packages/domain/src/generation';

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border-soft/50 px-3 py-2 text-xs text-text-secondary hover:border-gold hover:text-text-primary disabled:opacity-40';
const input = 'w-full min-w-0 rounded-md border border-border-soft/50 bg-bg-primary px-3 py-2 text-sm text-text-primary';
const json = (v: unknown) => JSON.stringify(v);
const active = (e: GenerationExecution) => ['queued', 'submitting', 'running', 'reconciling'].includes(e.status);
type Proposal = Awaited<ReturnType<typeof generationClient.propose>>['proposal'];

export function GenerationWorkbench({ target, operation, onClose, returnLabel = '返回制作页面', onUseResult, initialPrompt, initialReferences, initialTaskId }: { target: GenerationTarget; operation: GenerationOperation; onClose: () => void; returnLabel?: string; initialTaskId?: string; initialPrompt?: string; initialReferences?: Array<{ url: string; label: string; role: GenerationReference['role'] }>; onUseResult?: (url: string, source: { modelId: string; prompt: string; plan: GenerationPlanRevision }) => void }) {
  const [search, setSearch] = useSearchParams();
  const scope = generationTargetKey(target), [workspace, setWorkspace] = useState<GenerationWorkspace>();
  const [selectedId, setSelectedId] = useState(initialTaskId || search.get('generationTaskId') || '');
  const [expanded, setExpanded] = useState(true);
  const [view, setView] = useState<'list' | 'canvas'>(search.get('generationView') === 'canvas' ? 'canvas' : 'list');
  const [draft, setDraft] = useState<GenerationTaskDraft>(); const draftRef = useRef(draft); draftRef.current = draft;
  const baseline = useRef(''), saving = useRef<Promise<GenerationTaskDraft> | null>(null), alive = useRef(true);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'failed'>('saved');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [plan, setPlan] = useState<GenerationPlanRevision>();
  const [issues, setIssues] = useState<GenerationIssue[]>([]), [proposal, setProposal] = useState<Proposal>();
  const [panel, setPanel] = useState<'references' | 'results'>('references');
  const [selectedReferenceId, setSelectedReferenceId] = useState<string>();
  const [showTools, setShowTools] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const workspaceElement = useRef<HTMLElement>(null);
  const bodyElement = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [providerIds, setProviderIds] = useState<Record<string, string>>({});
  const [reservationEvidence, setReservationEvidence] = useState<Record<string, string>>({});
  const [observationTimes, setObservationTimes] = useState<Record<string,string>>({});
  const [observationTargets, setObservationTargets] = useState<Record<string,string>>({});
  const observationFor=(result: {id:string;mediaUrl:string;contentHash:string}, impact:'note'|'issue') => notes.trim() ? [{id:`${result.id}:${impact}`,note:notes,impact,mediaUrl:result.mediaUrl,contentHash:result.contentHash,...(observationTimes[result.id]?.trim()?{startSeconds:Number(observationTimes[result.id])}:{}),...(observationTargets[result.id]?.trim()?{fixTargetId:observationTargets[result.id].trim()}: {})}] : [];
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({}), [notes, setNotes] = useState('');
  const [pendingLink, setPendingLink] = useState<{ taskId: string; reference: GenerationReference }>();
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof generationClient.catalog>>['recipes']>([]);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const layoutQueue = useRef(Promise.resolve());
  const undo = useRef<GenerationTaskDraft[]>([]), redo = useRef<GenerationTaskDraft[]>([]);
  const [createOperation, setCreateOperation] = useState<GenerationOperation>(operation);
  const submitTicket = useRef<{ planId: string; key: string } | undefined>(undefined);
  const dirty = !!draft && json(draft) !== baseline.current;
  const liveCapability = workspace?.capabilities.find(c => c.id === draft?.capabilityId);
  const cap = liveCapability || workspace?.plans.find(p => p.taskId === selectedId)?.capability || workspace?.capabilities.find(c => c.allowedOperations.includes(draft?.operation || operation));
  const unavailable = !!draft && !liveCapability;
  const localIssues = draft && cap ? validateGenerationDraft(draft, cap) : [];
  const timingReview = draft && workspace?.sources?.[generationTargetKey(draft.target)]?.timingReview;
  const effectiveIssues = plan && !dirty ? plan.issues : issues.length ? issues : [...localIssues, ...(draft && ['video', 'joint_storyboard'].includes(draft.operation) ? timingReview?.issues || [] : [])];
  const currentTasks = useMemo(() => workspace?.tasks.map(t => t.id === draft?.id ? draft : t) || [], [workspace?.tasks, draft]);
  const paused = !!workspace && (cap?.mediaKind === 'video' ? workspace.policy.videoPaused : workspace.policy.imagePaused);
  const policyBlocked = unavailable || paused || !!cap?.experimental && !workspace?.policy.allowExperimental;
  const currentSource = draft && workspace?.sources?.[generationTargetKey(draft.target)];
  const sourceChanged = !!draft && !(workspace?.taskSourceCurrent?.[draft.id]
    ?? (currentSource?.sourceHash || workspace?.sourceHash) === draft.sourceHash);
  const selectedExecutions = workspace?.executions.filter(e => e.taskId === selectedId) || [];
  const executing = selectedExecutions.some(active);
  const referenceLibrary = [...(currentSource?.references || workspace?.references || []), ...(workspace?.references.filter(r => r.id.startsWith('import:') || r.derivedFrom) || [])];
  const availableReferences = [...(draft?.references || []), ...referenceLibrary.filter(r => !draft?.references.some(existing => existing.mediaVersionId === r.mediaVersionId)).map(r => ({ ...r, enabled: false }))];
  const selectedReference = availableReferences.find(r => r.id === selectedReferenceId);
  function inspectReference(ref: GenerationReference) {
    setSelectedReferenceId(ref.id);
    if (window.innerWidth < 1024) requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  useEffect(() => {
    if (!expanded || !workspaceElement.current) return;
    // The focused workspace covers the stage. Keep covered controls out of keyboard/AT navigation.
    const previous: Array<[HTMLElement, boolean]> = [];
    let child: HTMLElement = workspaceElement.current;
    while (child.parentElement && child.parentElement !== document.body) {
      for (const sibling of Array.from(child.parentElement.children)) if (sibling !== child && sibling instanceof HTMLElement) { previous.push([sibling, sibling.inert]); sibling.inert = true; }
      child = child.parentElement;
    }
    return () => { for (const [element, inert] of previous) element.inert = inert; };
  }, [expanded]);

  async function reload() {
    const data = await generationClient.workspace(target);
    if (alive.current) setWorkspace(data);
    return data;
  }
  useEffect(() => {
    alive.current = true; let cancelled = false;
    setWorkspace(undefined); setError('');
    void (async () => {
      try {
        let data = await generationClient.workspace(target);
        const recipes = await generationClient.catalog(); if (cancelled) return; setCatalog(recipes.recipes);
        let task = data.tasks.find(t => t.id === selectedId) || data.tasks.find(t => generationTargetKey(t.target) === scope && t.operation === operation);
        if (!task) {
          const commandKey = `generation-create:${scope}:${operation}`;
          let commandId = sessionStorage.getItem(commandKey); if (!commandId) { commandId = crypto.randomUUID(); sessionStorage.setItem(commandKey, commandId); }
          const routedModel = useAIConfigStore.getState().routing[operation === 'video' ? 'videoGen' : 'imageGen'];
          const compatible = initialReferences?.length ? recipes.recipes.filter(r => !r.capability.supersededBy && r.capability.allowedOperations.includes(operation)
            && r.capability.inputs.image.min <= initialReferences.length && r.capability.inputs.image.max >= initialReferences.length
            && initialReferences.every(ref => r.capability.inputs.image.roles.includes(ref.role))) : [];
          const initialCapability = (compatible.find(r => r.legacyModelIds.includes(routedModel)) || compatible[0])?.capability.id;
          task = (await generationClient.create(target, operation, commandId, initialCapability)).task;
          if (initialPrompt && !task.prompt) {
            const imported: GenerationReference[] = [];
            for (const ref of initialReferences || []) imported.push({ ...(await generationClient.importReference(target.projectId, ref.url, 'image', ref.role, ref.label)).reference, enabled: true });
            task = (await generationClient.update(task, { prompt: initialPrompt, ...(imported.length ? { references: imported } : {}) })).task;
          }
          data = await generationClient.workspace(target);
        }
        if (!cancelled) { setWorkspace(data); setSelectedId(task.id); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '读取工作台失败'); }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [scope, operation]);
  useEffect(() => {
    const task = workspace?.tasks.find(t => t.id === selectedId); if (!task) return;
    let restored: GenerationTaskDraft | undefined;
    try { const saved = JSON.parse(sessionStorage.getItem(`generation-draft:${task.id}`) || 'null'); if (saved?.revision === task.revision) restored = saved; } catch { /* Optional recovery. */ }
    baseline.current = json(task); setDraft(restored || task); undo.current = []; redo.current = []; setPlan(undefined); setIssues([]); setProposal(undefined); setSelectedReferenceId(undefined); setNotes(''); setSaveState(restored ? 'dirty' : 'saved'); draftRef.current = restored || task;
  }, [selectedId, !!workspace]);
  useEffect(() => {
    if (!selectedId) return;
    const next = new URLSearchParams(search); next.set('generationTaskId', selectedId); next.set('generationView', view); next.set('generationOperation', draft?.operation || operation);
    if (next.toString() !== search.toString()) setSearch(next, { replace: true });
  }, [selectedId, view, draft?.operation]);
  useEffect(() => {
    if (!draft || json(draft) === baseline.current) return;
    try { sessionStorage.setItem(`generation-draft:${draft.id}`, json(draft)); } catch { /* Server save still available. */ }
    setSaveState('dirty'); setPlan(undefined); setIssues([]);
    const timer = setTimeout(() => { void save().catch(() => {}); }, 900); return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setInterval(() => { void reload().catch(() => {}); }, 5000); return () => clearInterval(timer);
  }, [workspace?.executions.map(e => `${e.id}:${e.status}`).join('|'), scope]);

  useEffect(() => {
    const latest = workspace?.tasks.find(t => t.id === selectedId);
    if (!latest || saving.current || !draftRef.current || draftRef.current.id !== latest.id || json(draftRef.current) !== baseline.current || latest.revision === draftRef.current.revision) return;
    baseline.current = json(latest); draftRef.current = latest; setDraft(latest); setPlan(undefined); setProposal(undefined);
  }, [workspace, selectedId]);

  async function save(): Promise<GenerationTaskDraft> {
    if (saving.current) { await saving.current; if (draftRef.current && json(draftRef.current) !== baseline.current) return save(); return draftRef.current!; }
    const current = draftRef.current;
    if (!current) throw new Error('尚未载入任务'); if (json(current) === baseline.current) return current;
    setSaveState('saving');
    const pending = generationClient.update(current, { prompt: current.prompt, references: current.references, parameters: current.parameters, contentType: current.contentType, quality: current.quality, storyboardLayout: current.storyboardLayout }).then(({ task }) => {
      baseline.current = json(task);
      if (alive.current) {
        setWorkspace(ws => ws ? { ...ws, tasks: ws.tasks.map(t => t.id === task.id ? task : t) } : ws);
        const latest = draftRef.current;
        const merged = latest && latest.id === current.id ? json(latest) === json(current) ? task : { ...latest, revision: task.revision } : latest;
        draftRef.current = merged; setDraft(merged);
        setSaveState('saved'); sessionStorage.removeItem(`generation-draft:${task.id}`);
      }
      return task;
    }).catch(e => { setSaveState('failed'); setError(e.message); throw e; }).finally(() => { saving.current = null; });
    saving.current = pending; return pending;
  }
  async function run(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，草稿仍保留。'); } finally { if (alive.current) setBusy(false); }
  }
  async function createComparison() {
    const current = await save();
    const created = await generationClient.create(current.target, current.operation, crypto.randomUUID(), current.capabilityId);
    await generationClient.update(created.task, { prompt: current.prompt, references: current.references,
      parameters: current.parameters, contentType: current.contentType, quality: current.quality, storyboardLayout: current.storyboardLayout });
    await reload(); setSelectedId(created.task.id); setPanel('references'); setShowTools(false);
  }
  function edit(patch: Partial<GenerationTaskDraft>) { if (draftRef.current) { undo.current.push(structuredClone(draftRef.current)); if (undo.current.length > 40) undo.current.shift(); redo.current = []; } const next = draftRef.current ? { ...draftRef.current, ...patch } : undefined; draftRef.current = next; setDraft(next); setPlan(undefined); setIssues([]); setProposal(undefined); }
  const changeRef = (reference: GenerationReference, patch: Partial<GenerationReference>) => { const updated = { ...reference, ...patch, source: patch.source || 'user' as const }; edit({ references: draft!.references.some(r => r.id === reference.id) ? draft!.references.map(r => r.id === reference.id ? updated : r) : [...draft!.references, updated] }); };
  const changeParam = (key: string, value: string | number | boolean) => {
    const parameters = { ...draft!.parameters, [key]: { value, source: 'user' as const, locked: draft!.parameters[key]?.locked || false } };
    if (key === 'aspectRatio' && parameters.width && parameters.height && ![parameters.width, parameters.height].some(p => p.locked || p.source === 'user')) {
      const [w, h] = String(value).split(':').map(Number), long = Math.max(Number(parameters.width.value), Number(parameters.height.value));
      parameters.width = { ...parameters.width, value: w >= h ? long : Math.round(long * w / h / 8) * 8 };
      parameters.height = { ...parameters.height, value: h >= w ? long : Math.round(long * h / w / 8) * 8 };
    }
    edit({ parameters });
  };
  const switchTask = (taskId: string) => void run(async () => { await save(); setSelectedId(taskId); });
  async function close() {
    if (draftRef.current) await save();
    await layoutQueue.current;
    const next = new URLSearchParams(search); next.delete('generationTaskId'); next.delete('generationView'); next.delete('generationOperation'); setSearch(next, { replace: true });
    const state = useProjectStore.getState();
    if (state.currentProject?.id === target.projectId) {
      const project = await legacyProjectClient.getProject(target.projectId, 'shell'); if (project) replaceCurrentProjectSnapshot(project);
      if (target.episodeId && state.activeEpisodeId === target.episodeId) await useProjectStore.getState().setActiveEpisodeId(target.episodeId, { view: 'storyboard', sceneId: target.sceneId });
    }
    onClose();
  }
  const saveLayout = (nodes: GenerationLayout['nodes'], viewport?: GenerationLayout['viewport'], groups?: GenerationLayout['groups']) => {
    layoutQueue.current = layoutQueue.current.then(async () => {
      const ws = workspaceRef.current; if (!ws) return;
      if (json(ws.layout.nodes) === json(nodes) && json(ws.layout.viewport) === json(viewport) && json(ws.layout.groups) === json(groups || ws.layout.groups)) return;
      const result = await generationClient.layout(ws, nodes, viewport, groups || ws.layout.groups);
      workspaceRef.current = { ...ws, layout: result.layout };
      setWorkspace(w => w ? { ...w, layout: result.layout } : w);
    }).catch(e => setError(`画布位置未保存：${e.message}`));
  };
  function connect(source: string, taskId: string) {
    const targetTask = currentTasks.find(t => t.id === taskId); if (!targetTask || !workspace) return;
    const sourceRef = [...workspace.references, ...currentTasks.flatMap(t => t.references)].find(r => `ref:${r.mediaVersionId}` === source);
    const sourceExecution = workspace.executions.find(e => e.results.some(r => r.id === source));
    const result = sourceExecution?.results.find(r => r.id === source);
    const sourceTask = currentTasks.find(t => t.id === source);
    const ref = sourceRef ? { ...sourceRef, id: `linked:${crypto.randomUUID()}`, enabled: true, source: 'user' as const } : result || sourceTask ? {
      id: `dependency:${crypto.randomUUID()}`, label: sourceTask?.label || '上游候选', mediaKind: result?.mediaKind || (sourceTask?.operation === 'video' ? 'video' as const : 'image' as const), mediaUrl: result?.mediaUrl || '', mediaVersionId: result?.id || '', role: 'composition' as const, enabled: true, locked: false, source: 'user' as const, status: result?.review === 'adopted' ? 'adopted' as const : 'candidate' as const,
      dependency: { taskId: sourceExecution?.taskId || sourceTask!.id, resultId: result?.id, condition: 'adopted_current' as const },
    } : undefined;
    if (ref) {
      const targetCap = workspace.capabilities.find(c => c.id === targetTask.capabilityId);
      const roles = targetCap?.inputs[ref.mediaKind].roles || [];
      if (!roles.length) { setError('这个任务不支持此类参考，请选择兼容的生成方式。'); return; }
      if (targetTask.references.some(r => r.enabled && (r.dependency ? r.dependency.taskId === ref.dependency?.taskId && r.dependency.resultId === ref.dependency?.resultId : r.mediaVersionId === ref.mediaVersionId))) { setError('该素材已经用于此任务，可点击素材卡调整用途。'); return; }
      setPendingLink({ taskId, reference: { ...ref, role: roles.includes(ref.role) ? ref.role : roles[0] } });
    }
  }
  function parameter(p: GenerationParameter) {
    const current = draft!.parameters[p.key] || { value: p.default, source: 'default', locked: false };
    return <div key={p.key} className="min-w-0"><div className="mb-1.5 flex items-center justify-between gap-2"><label className="text-xs text-text-secondary" htmlFor={`generation-${p.key}`}>{p.label}</label><button type="button" disabled={busy || p.locked} title={current.locked ? '解除锁定' : '锁定此参数，AI 不再修改'} aria-label={`${current.locked ? '解除锁定' : '锁定'}${p.label}`} className={`${current.locked ? 'text-gold' : 'text-text-muted'} p-1`} onClick={() => edit({ parameters: { ...draft!.parameters, [p.key]: { ...current, locked: !current.locked } } })}><LockKeyhole className="h-3.5 w-3.5" /></button></div>
      {p.enabledBy && <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`启用${p.label}`} checked={Boolean(draft!.parameters[p.enabledBy!]?.value ?? true)} disabled={busy || cap!.parameters.find(item => item.key === p.enabledBy)?.locked} onChange={e => changeParam(p.enabledBy!, e.target.checked)} />启用此 LoRA</label>}
      {p.type === 'boolean' ? <label className="flex min-h-9 items-center gap-2 text-xs"><input id={`generation-${p.key}`} type="checkbox" checked={!!current.value} disabled={busy || p.locked} onChange={e => changeParam(p.key, e.target.checked)} />{current.value ? '启用' : '关闭'}</label> : p.choices ? <select id={`generation-${p.key}`} className={input} value={String(current.value)} disabled={busy || p.locked} onChange={e => changeParam(p.key, p.type === 'number' ? Number(e.target.value) : e.target.value)}>{p.choices.map(v => <option value={String(v)} key={String(v)}>{v}</option>)}</select> : <input id={`generation-${p.key}`} className={input} type={p.type === 'number' ? 'number' : 'text'} value={String(current.value)} min={p.min} max={p.max} step={p.integer ? 1 : 'any'} disabled={busy || p.locked} onChange={e => changeParam(p.key, p.type === 'number' ? Number(e.target.value) : e.target.value)} />}
      <p className="mt-1 text-[11px] text-text-muted">{current.locked ? '人工锁定' : current.source === 'user' ? '人工覆盖' : current.source === 'ai' ? 'AI 建议' : '方案默认'}{p.description ? ` · ${p.description}` : ''}</p>{current.source === 'user' && !p.locked && <button type="button" className="mt-1 text-[11px] text-gold" disabled={busy} onClick={() => edit({ parameters: { ...draft!.parameters, [p.key]: { ...current, source: 'default', locked: false } } })}>允许 AI 再调整此项</button>}</div>;
  }
  function referencePicker() {
    if (!draft || !cap) return null;
    return <GenerationReferences references={availableReferences} capability={cap} selectedId={selectedReferenceId} busy={busy} onSelect={inspectReference} onToggle={(ref, enabled) => changeRef(ref, { enabled })} onUpload={file => void run(async () => {
      const saved = await save();
      const uploaded = await assetClient.uploadFile(file, target.projectId);
      if (!uploaded.url) throw new Error('上传没有返回素材地址');
      const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
      const role = cap.inputs[kind].roles.includes('composition') ? 'composition' : cap.inputs[kind].roles[0];
      if (!role) throw new Error('此方式不支持该素材类型');
      const imported = await generationClient.importReference(target.projectId, uploaded.url, kind, role, file.name);
      baseline.current = json(saved);
      const next = { ...saved, references: [...saved.references.filter(r => r.id !== imported.reference.id), imported.reference] };
      draftRef.current = next; setDraft(next); setSelectedReferenceId(imported.reference.id); await reload();
    })} />;
  }
  return <section ref={workspaceElement} className={`${expanded ? 'fixed inset-0 z-[90] flex flex-col overflow-hidden p-4 sm:p-6' : 'min-w-0'} bg-bg-primary text-text-primary @container`} aria-label="生成工作台">
    <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-border-soft/30 pb-4">
      <div className="flex min-w-0 flex-1 items-center gap-3"><button type="button" aria-label={returnLabel} className={`${button} shrink-0`} disabled={busy} onClick={() => void run(close)}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{returnLabel}</span></button><div className="min-w-0"><h2 className="text-sm font-bold">生成工作台</h2><p className="mt-1 truncate text-xs text-text-muted" title={draft?.label}>{draft?.label || '正在读取当前制作范围…'}</p></div></div>
      <div className="flex shrink-0 items-center gap-2"><button className={`${button.replace("inline-flex", "hidden sm:inline-flex")}`} onClick={() => setExpanded(v => !v)}>{expanded ? '收回阶段内' : '展开工作区'}</button><span className="hidden text-xs text-text-muted sm:inline" aria-live="polite">{{ saved: '已保存', dirty: '待保存', saving: '保存中…', failed: '保存失败 · 草稿保留' }[saveState]}</span><button aria-label="刷新" className={button} disabled={busy || !draft} onClick={() => void run(async () => { await save(); await reload(); })}><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">刷新</span></button></div>
    </header>
    {error && <div role="alert" className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-600 dark:text-amber-300"><span>{error}</span><button className={button} onClick={() => void run(async () => { const fresh = await reload(); const latest = fresh.tasks.find(t => t.id === selectedId); if (latest) { if (draftRef.current) sessionStorage.setItem(`generation-conflict-backup:${selectedId}:${Date.now()}`, json(draftRef.current)); baseline.current = json(latest); draftRef.current = latest; setDraft(latest); setSaveState('saved'); } })}>保留本地备份并读取新版</button></div>}
    {!workspace || !draft || !cap ? <p className="py-10 text-sm text-text-muted">{error ? '草稿和已有媒体保留，可返回上一步处理。' : '正在准备任务与素材…'}</p> : <>

      {(currentSource?.sourceHash || workspace.sourceHash) === 'target-missing' && <p role="status" className="my-3 border-l-2 border-amber-500 pl-3 text-xs text-amber-600">原对象已拆分或删除，历史媒体仍保留。请返回制作阶段选择当前对象。</p>}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-border-soft/30 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {workspace.tasks.length > 1 && <label className="flex min-w-0 items-center gap-2 text-xs text-text-muted">当前任务<select aria-label="当前生成任务" className={`${input} max-w-80 !text-xs`} value={selectedId} disabled={busy} onChange={e => switchTask(e.target.value)}>{workspace.tasks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>}
          <div className="flex gap-1" role="group" aria-label="生成工作台内容">
            <button className={`${button} ${panel === 'references' ? 'border-gold text-gold' : ''}`} aria-pressed={panel === 'references'} onClick={() => { setPanel('references'); setSelectedReferenceId(undefined); bodyElement.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>参考素材</button>
            <button className={`${button} ${panel === 'results' ? 'border-gold text-gold' : ''}`} aria-pressed={panel === 'results'} onClick={() => { setPanel('results'); setSelectedReferenceId(undefined); }}>生成结果{selectedExecutions.length ? ` · ${selectedExecutions.length}` : ''}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {panel === 'references' && <div className="flex gap-1" role="group" aria-label="生成工作台视图">{[{ id: 'list', label: '清单', Icon: List }, { id: 'canvas', label: '画布', Icon: LayoutGrid }].map(({ id, label, Icon }) => <button key={id} className={`${button} ${view === id ? 'border-gold text-gold' : ''}`} aria-pressed={view === id} onClick={() => { setView(id as 'list' | 'canvas'); if (id === 'canvas') setExpanded(true); }}><Icon size={14} />{label}</button>)}</div>}
          {panel === 'references' && <button className={`${button} @[900px]:!hidden`} onClick={() => { setSelectedReferenceId(undefined); requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>生成设置</button>}
          <button className={`${button.replace("inline-flex", "hidden sm:inline-flex")}`} disabled={busy} onClick={() => void run(createComparison)}><Plus size={14} />新方案</button>
          <button className={button} aria-expanded={showTools} onClick={() => setShowTools(v => !v)}>更多</button>
        </div>
      </div>
      {showTools && <div className="max-h-72 shrink-0 overflow-y-auto py-3"><button className={`${button} mb-3 sm:!hidden`} disabled={busy} onClick={() => void run(createComparison)}>新建对照方案</button>      <GenerationBatchPanel workspace={workspace} tasks={currentTasks} onRefresh={reload} onError={setError} beforeAction={save} />
      <details className="mb-3 text-xs"><summary className="cursor-pointer text-text-muted">更多工具 · 裁切、视频取帧与草稿恢复</summary><div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-text-muted">添加处理任务</span><select aria-label="添加任务类型" className="rounded border border-border-soft/40 bg-bg-primary p-2" value={createOperation} onChange={e => setCreateOperation(e.target.value as GenerationOperation)}>{[{ id: operation, label: '当前制作目标' }, { id: 'image_edit', label: 'AI 重绘当前目标' }, { id: 'crop', label: '裁切参考图' }, { id: 'extract_frame', label: '提取视频画面 / 切点' }].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i && !(draft.target.kind === 'scene' && v.id === 'image_edit')).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button className={button} disabled={busy} onClick={() => void run(async () => { await save(); const result = await generationClient.create(draft.target, createOperation, crypto.randomUUID()); await reload(); setSelectedId(result.task.id); })}>添加任务</button><button className={button} disabled={!undo.current.length} onClick={() => { const prior = undo.current.pop(); if (prior) { redo.current.push(structuredClone(draft)); setDraft({ ...prior, revision: draft.revision }); } }}>撤销草稿</button><button className={button} disabled={!redo.current.length} onClick={() => { const next = redo.current.pop(); if (next) { undo.current.push(structuredClone(draft)); setDraft({ ...next, revision: draft.revision }); } }}>重做</button></div></details>
</div>}
      <div ref={bodyElement} className={`${expanded ? "min-h-0 flex-1 overflow-y-auto" : ""} grid min-w-0 items-start gap-5 py-5 @[900px]:grid-cols-[minmax(0,1fr)_320px]`}>
        <main className="min-w-0">
          {panel === 'results' ? <>          <section className="min-w-0" aria-label="生成结果"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">结果与候选</h3><label className={button}>导入外部成果<input type="file" accept={cap.mediaKind === 'video' ? 'video/*' : 'image/*'} className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; if (file) void run(async () => { const saved = await save(); const checked = await generationClient.preflight(saved); setIssues(checked.issues); if (!checked.plan) throw new Error('请先修正方案中的问题，再导入对应成果。'); const uploaded = await assetClient.uploadFile(file, target.projectId); await generationClient.importResult(checked.plan.id, uploaded.url, crypto.randomUUID()); await reload(); toast.success('已登记为候选，请检查后采用'); }); }} /></label></div><div className="mt-3 space-y-4">{workspace.executions.filter(e => e.taskId === selectedId).map(execution => <div key={execution.id} className="border-b border-border-soft/20 pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-text-secondary">{execution.status === 'succeeded' && execution.results.length && execution.results.every(r => r.review === 'adopted') ? '当前结果已采用' : generationStatusLabels[execution.status]} · {new Date(execution.createdAt).toLocaleString('zh-CN')}{execution.origin === 'external' ? ' · 外部导入' : ''}</span><div className="flex gap-2">{(active(execution) || execution.status === 'held') && <button className={button} onClick={() => void run(async () => { await generationClient.cancel(execution.id); await reload(); })}>取消本次</button>}{['held', 'reconciling'].includes(execution.status) && <button className={button} onClick={() => void run(async () => { await generationClient.resume(execution.id); await reload(); })}>恢复查询 / 检查</button>}</div></div>{execution.status === 'reconciling' && !execution.providerTaskId && workspace.plans.find(p => p.id === execution.planId)?.capability.provider === 'comfyui' && <div className="my-2 flex flex-wrap gap-2"><input aria-label="核对后的上游任务编号" placeholder="核对后的 prompt_id" className={input} value={providerIds[execution.id] || ''} onChange={e => setProviderIds(p => ({ ...p, [execution.id]: e.target.value }))} /><button className={button} onClick={() => void run(async () => { await generationClient.associate(execution.id, providerIds[execution.id]); await reload(); })}>验证并关联，不重新生成</button>
            {execution.dispatchReservationRelease ? <p className="w-full text-xs text-text-secondary">本地占位已释放，提交结果仍待核对，不会自动重发。核对记录：{execution.dispatchReservationRelease.evidence}</p> : <>
              <label className="w-full text-xs text-text-secondary">已核对远端无对应在途任务时，可释放本地占位。此操作不取消远端任务，也不重新生成。
                <textarea aria-label="释放占位核对记录" className={`${input} mt-2 w-full`} placeholder="记录检查过的远端队列、历史范围与结论" value={reservationEvidence[execution.id] || ''} onChange={e => setReservationEvidence(p => ({ ...p, [execution.id]: e.target.value }))} />
              </label>
              <button className={button} disabled={busy || !reservationEvidence[execution.id]?.trim()} onClick={() => void run(async () => { await generationClient.releaseReservation(execution.id, reservationEvidence[execution.id]); await reload(); })}>释放本地占位</button>
            </>}
          </div>}{execution.error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{execution.error}</p>}
            <div className="mt-3 grid gap-4 sm:grid-cols-2">{execution.results.map(result => <div key={result.id} className="min-w-0">{result.mediaKind === 'video' ? <video controls preload="metadata" src={result.mediaUrl} className="aspect-video w-full rounded-md bg-bg-surface" /> : <a href={result.mediaUrl} target="_blank" rel="noreferrer"><img src={result.mediaUrl} alt="本次生成的待审候选" className="w-full rounded-md object-contain" /></a>}<p className="mt-2 text-xs text-text-muted">{result.width} × {result.height}{result.durationSeconds ? ` · 实测 ${result.durationSeconds.toFixed(2)} 秒` : ''} · {result.review === 'adopted' ? '已采用' : result.review === 'source_changed' ? '来源已变化' : result.review === 'needs_changes' ? '需修改' : result.review === 'superseded' ? '历史采用，当前已替换' : '待检查'}</p>{result.technicalIssues.map(issue => <p key={issue} className="mt-1 text-xs text-amber-600">{issue}</p>)}{result.registrationError && <div className="mt-2 text-xs text-amber-600"><p>{result.registrationError}</p><button className={button} disabled={busy} onClick={() => void run(async () => { await generationClient.registerResults(execution.id); await reload(); })}>重试登记到原目标，不重新生成</button></div>}
              {workspace.plans.find(p => p.id === execution.planId)?.storyboardLayout && <p className="mt-2 text-xs text-text-secondary">本候选画格映射：{workspace.plans.find(p => p.id === execution.planId)!.storyboardLayout!.shotIds.map(id => `镜头 ${draft.target.shotIds.indexOf(id) + 1}`).join(' → ')}。采用沿用本次生成时的映射。</p>}{result.observations?.map(o=><p className="mt-2 text-xs text-text-secondary" key={o.id}>{o.startSeconds!==undefined?`${o.startSeconds}s · `:''}{o.note}{o.fixTargetId?` · 修改对象：${o.fixTargetId}`:''}</p>)}
              {result.review !== 'adopted' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">观察时间（秒，可选）<input type="number" min="0" step="0.1" className={input} value={observationTimes[result.id]||''} onChange={e=>setObservationTimes(v=>({...v,[result.id]:e.target.value}))} /></label><label className="text-xs">修改对象（可选）<input className={input} value={observationTargets[result.id]||''} onChange={e=>setObservationTargets(v=>({...v,[result.id]:e.target.value}))} /></label></div>}
              {result.review !== 'adopted' && <><label className="mt-3 flex items-start gap-2 text-xs leading-5"><input className="mt-1" type="checkbox" checked={!!reviewed[result.id]} onChange={e => setReviewed(r => ({ ...r, [result.id]: e.target.checked }))} />已检查本结果的人物、空间、事件顺序{draft.target.kind === 'scene' ? '和逐格镜头映射' : ''}{result.mediaKind === 'video' ? '、切点与声音' : ''}</label><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy || !reviewed[result.id] || !!result.registrationError || !!result.technicalIssues.length || result.review === 'source_changed'} onClick={() => void run(async () => { if (draft.target.kind === 'scratch' && onUseResult) { await save(); const resultPlan = workspace.plans.find(p => p.id === execution.planId)!; onUseResult(result.mediaUrl, { modelId: resultPlan.capability.modelConfigId, prompt: resultPlan.prompt, plan: resultPlan }); return; } await generationClient.review(execution.id, result.id, 'adopted', undefined, notes, observationFor(result, 'note')); await reload(); toast.success('已按正式流程采用'); })}><Check className="h-3.5 w-3.5" /> {draft.target.kind === 'scratch' ? onUseResult ? '导入资产库' : '标记已检查' : ['crop', 'extract_frame'].includes(draft.operation) ? '保存为可用参考' : '采用到原目标'}</button><button className={button} disabled={busy} onClick={() => void run(async () => { await generationClient.review(execution.id, result.id, 'needs_changes', undefined, notes, observationFor(result, 'issue')); await reload(); })}>记录需修改</button></div></>}
            </div>)}</div></div>)}</div>{!workspace.executions.some(e => e.taskId === selectedId) && <p className="py-5 text-xs text-text-muted">尚未执行。生成后先进入候选，检查与采用分别处理。</p>}{selectedExecutions.some(e => e.results.length) && <label className="mt-3 block text-xs text-text-secondary">检查或修订说明<textarea className={`${input} mt-2`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="记录观察到的问题、镜头或时间点" /></label>}</section>
</> : <>
            {view === 'canvas' ? <>
              <p className="mb-3 text-xs leading-5 text-text-muted">从左到右：参考素材 → 生成任务 → 候选结果。点素材调整用途，拖动连线添加引用。</p>
              <GenerationCanvas workspace={workspace} tasks={currentTasks} selectedTaskId={selectedId} onSelectTask={taskId => { setSelectedReferenceId(undefined); switchTask(taskId); }} onSelectReference={inspectReference} onSelectResult={taskId => { switchTask(taskId); setPanel('results'); setSelectedReferenceId(undefined); }} onConnect={connect} onRemoveReference={(taskId, referenceId) => { void run(async () => { const saved = await save(); const owner = taskId === saved.id ? saved : workspace.tasks.find(t => t.id === taskId)!; const result = await generationClient.update(owner, { references: owner.references.map(r => r.id === referenceId ? { ...r, enabled: false, source: 'user' } : r) }); if (owner.id === selectedId) { baseline.current = json(result.task); draftRef.current = result.task; setDraft(result.task); setPlan(undefined); } await reload(); }); }} onLayout={saveLayout} onAdd={() => void run(async () => { await save(); const r = await generationClient.create(draft.target, draft.operation, crypto.randomUUID(), draft.capabilityId); await reload(); setSelectedId(r.task.id); })} />
              <details className="mt-4 border-t border-border-soft/30 pt-3"><summary className="cursor-pointer text-xs text-text-secondary">添加素材与查看未选参考</summary><div className="pt-4">{referencePicker()}</div></details>
            </> : referencePicker()}
          </>}
        </main>
        <aside ref={inspectorRef} className="min-w-0 border-t border-border-soft/30 pt-4 @[900px]:border-l @[900px]:border-t-0 @[900px]:pl-5 @[900px]:pt-0" aria-label="本次生成设置">
          {selectedReference && panel === 'references' ? <GenerationReferenceInspector reference={selectedReference} capability={cap} busy={busy} onChange={patch => changeRef(selectedReference, patch)} onBack={() => setSelectedReferenceId(undefined)} /> : <fieldset disabled={busy}>
          <h3 className="mb-3 text-sm font-semibold">生成设置</h3><p className="mb-4 text-xs leading-5 text-text-muted">先核对素材和画幅，再检查并生成。采样、二采和 LoRA 在高级参数中调整。</p>
          <label className="block text-xs text-text-secondary">生成方案<select className={`${input} mt-2`} disabled={busy} value={draft.capabilityId} onChange={e => { const capabilityId = e.target.value; void run(async () => { const saved = await save(); const updated = await generationClient.update(saved, { capabilityId }); baseline.current = json(updated.task); setDraft(updated.task); setPlan(undefined); setProposal(undefined); await reload(); }); }}>{unavailable && <option value={draft.capabilityId}>原生成方案不可用，请更换</option>}{workspace.capabilities.filter(c => c.allowedOperations.includes(draft.operation) && (!c.supersededBy || c.id === draft.capabilityId) && (showHistory || !c.diagnostic || c.id === draft.capabilityId)).map(c => <option key={c.id} value={c.id}>{c.label}{workspace.capabilities.filter(other => other.label === c.label).length > 1 ? ` · ${c.coreLabel}` : ''}{c.experimental ? ' · 实验' : ''}</option>)}</select></label>
          {cap.supersededBy && <p className="mt-2 text-xs leading-5 text-text-muted">这是保留的旧输入配置。需要更多图片、视频或音色时，选择“YZ H3 · 多素材参考”；旧素材与历史结果会保留。</p>}
          {cap.referenceAdapter === 'h3_multimodal_v1' && <p className="mt-2 text-xs leading-5 text-text-muted">沿用 YZ 双采、LoRA 与放大核心。参考数量和用途在左侧按需选择，不固定三图或四图。</p>}
          <p className="mt-2 text-[11px] leading-5 text-text-muted">{cap.connectionName} · {cap.evidence === 'compiled' ? '本地映射通过，实际用法仍需验证' : '依据服务接口声明'}{cap.experimental ? ' · 包含待实测组合' : ''}</p>
          {draft.operation === 'video' && <>          <div className="my-4 grid grid-cols-2 gap-3"><label className="text-xs text-text-secondary">内容特征<select className={`${input} mt-1.5`} value={draft.contentType} onChange={e => edit({ contentType: e.target.value as GenerationTaskDraft['contentType'] })}><option value="mixed">混合 / 未确定</option><option value="dialogue">对白与表演</option><option value="action">动作与打斗</option></select></label><label className="text-xs text-text-secondary">制作目标<select className={`${input} mt-1.5`} value={draft.quality} onChange={e => edit({ quality: e.target.value as GenerationTaskDraft['quality'] })}><option value="production">正式制作配置</option><option value="preview">快速试验</option></select></label></div>
</>}
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(async () => { const task = await save(); setProposal((await generationClient.propose(task, true)).proposal); })}><Sparkles className="h-4 w-4" />AI 帮我调整</button><button className={button} disabled={busy} onClick={() => void run(async () => { const task = await save(); setProposal((await generationClient.propose(task)).proposal); })}>已有预设建议</button></div>
          {draft.storyboardLayout && <details className="my-4 border-t border-border-soft/30 pt-3"><summary className="cursor-pointer text-xs text-text-secondary">故事板排版 · {draft.storyboardLayout.columns} 列 × {draft.storyboardLayout.rows} 行 · {draft.storyboardLayout.shotIds.length} 格</summary><p className="mt-2 text-xs leading-5 text-text-muted">按格子阅读顺序选择对应镜头，同一镜头可以有多个关键画格。采用前请确认实际图片与映射一致；总览不直接作为单次视频输入。</p><div className="mt-3 flex gap-3">{(['columns', 'rows'] as const).map(key => <label key={key} className="text-xs">{key === 'columns' ? '列' : '行'}<input type="number" min={1} max={12} className={input} value={draft.storyboardLayout![key]} onChange={e => edit({ storyboardLayout: { ...draft.storyboardLayout!, [key]: Number(e.target.value) } })} /></label>)}</div><div className="mt-3 space-y-2">{draft.storyboardLayout.shotIds.map((shotId, index) => <div key={index} className="flex items-center gap-2"><label className="flex flex-1 items-center gap-2 text-xs">第 {index + 1} 格<select aria-label={`第 ${index + 1} 格对应镜头`} className={`${input} flex-1`} value={shotId} onChange={e => edit({ storyboardLayout: { ...draft.storyboardLayout!, shotIds: draft.storyboardLayout!.shotIds.map((id, i) => i === index ? e.target.value : id) } })}>{draft.target.shotIds.map((id, i) => <option key={id} value={id}>镜头 {i + 1}</option>)}</select></label><button type="button" aria-label={`移除第 ${index + 1} 格`} className="text-xs text-text-muted hover:text-gold" onClick={() => edit({ storyboardLayout: { ...draft.storyboardLayout!, shotIds: draft.storyboardLayout!.shotIds.filter((_, i) => i !== index) } })}>移除</button></div>)}<button type="button" className={button} disabled={draft.storyboardLayout.shotIds.length >= draft.storyboardLayout.columns * draft.storyboardLayout.rows} onClick={() => edit({ storyboardLayout: { ...draft.storyboardLayout!, shotIds: [...draft.storyboardLayout!.shotIds, draft.target.shotIds.at(-1)!] } })}>添加关键画格</button></div></details>}
          {proposal && <div className="my-3 border-l-2 border-gold pl-3"><p className="text-xs leading-5 text-text-secondary">{proposal.explanation}</p><dl className="mt-2 text-xs text-text-muted">{Object.entries(proposal.parameters).filter(([k, v]) => draft.parameters[k]?.value !== v).map(([k, v]) => <div key={k}>{cap.parameters.find(p => p.key === k)?.label || k}：{String(draft.parameters[k]?.value)} → {String(v)}</div>)}</dl><p className="mt-2 text-xs text-text-muted">建议引用：{draft.references.filter(r => proposal.enabledReferenceIds.includes(r.id)).map(r => r.label).join('、') || '无'}；人工选择与锁定项保留。</p><button className={`${button} mt-2`} disabled={busy} onClick={() => void run(async () => { const saved = await save(); const result = await generationClient.applyProposal(saved, proposal.id); baseline.current = json(result.task); setDraft(result.task); setProposal(undefined); await reload(); })}>应用建议，保留人工设置</button></div>}
          <div className="my-4 grid grid-cols-2 gap-3">{cap.parameters.filter(p => !p.advanced).map(parameter)}</div>
          {draft.narrativeSeconds > 0 && <p className="mb-3 text-xs leading-5 text-text-muted">叙事预计 {draft.narrativeSeconds} 秒 · {draft.target.shotIds.length} 镜。{draft.target.kind === 'scene' ? '这是故事板覆盖范围，不是单次视频时长。' : '这不是已验收时长。估时与切出依据在分镜中调整，生成余量不必保留到成片。'}</p>}
          {draft.operation === 'video' && <div className="my-3 text-xs leading-5 text-text-muted">声音：{cap.nativeAudio ? '随视频生成' : '后期配音'}。{cap.inputs.audio.max ? '可选择参考音频并指定用途。' : '此方式不接收参考音频。'}</div>}
          <details className="my-4 border-t border-border-soft/30 pt-3"><summary className="text-xs text-text-secondary">高级参数{draft.parameters.steps && draft.parameters.firstSteps ? ` · 一采 ${draft.parameters.firstSteps.value} + 二采 ${Number(draft.parameters.steps.value) - Number(draft.parameters.firstSteps.value)}` : ''}</summary><div className="mt-3 space-y-3">{cap.parameters.filter(p => p.advanced && !p.key.startsWith('lora_enabled_')).map(parameter)}</div></details>
          <details open={draft.target.kind === 'scratch' || undefined} className="my-4 border-t border-border-soft/30 pt-3"><summary className="text-xs text-text-secondary">查看与编辑生成描述</summary><textarea className={`${input} mt-3`} rows={10} value={draft.prompt} onChange={e => edit({ prompt: e.target.value })} /></details>
          <details className="my-4 border-t border-border-soft/30 pt-3"><summary className="text-xs text-text-secondary">服务与工作流详情</summary><p className="mt-2 break-all text-xs leading-5 text-text-muted">核心：{cap.coreLabel}<br />版本：{cap.fixedCoreHash.slice(0, 16)}<br />此核心的历史参数版本：{catalog.find(r => r.capability.id === cap.id)?.legacyModelIds.length || 1}</p><label className="my-3 flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />显示诊断与历史方案</label><label className="my-3 flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" disabled={busy} checked={workspace.policy.allowExperimental} onChange={e => void run(async () => { await generationClient.policy(workspace.policy, { allowExperimental: e.target.checked }); await reload(); })} />允许本项目显式选择待实测方式</label><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(async () => { await generationClient.policy(workspace.policy, cap.mediaKind === 'video' ? { videoPaused: !workspace.policy.videoPaused } : { imagePaused: !workspace.policy.imagePaused }); await reload(); })}>{paused ? `明确解除${cap.mediaKind === 'video' ? '视频' : '图片'}暂停` : `暂停${cap.mediaKind === 'video' ? '视频' : '图片'}生成`}</button><a href="/settings" className={button}>查看服务设置</a></div></details>
          </fieldset>}
        </aside>
      </div>
      <footer className={`${expanded ? "shrink-0" : "sticky bottom-0"} z-30 border-t border-border-soft/50 bg-bg-primary/95 py-3 backdrop-blur`} aria-label="生成下一步">
        {panel === 'results' ? <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-secondary"><p>{executing ? '执行状态见上方记录，返回的结果会自动显示在这里。' : selectedExecutions.some(e => e.results.some(r => r.review === 'adopted')) ? '当前候选已采用。可返回制作阶段继续，或调整方案再试。' : '先查看候选画面，再选择采用或记录修改意见。'}</p><button className={button} onClick={() => { setPanel('references'); setSelectedReferenceId(undefined); }}>调整素材与设置</button></div> : <>
        {executing && <p className="mb-2 text-xs text-text-secondary">本次执行尚未结束，可继续编辑下一版草稿。<button className="ml-2 text-gold" onClick={() => setPanel('results')}>查看生成进度</button></p>}
        {unavailable && <p role="alert" className="mb-2 text-xs text-amber-600">原生成方案已停用。历史结果保留，可更换方案后继续制作。</p>}
        {paused && <p className="mb-2 flex items-start gap-2 text-xs leading-5 text-amber-600 dark:text-amber-300"><Pause size={14} />{(cap.mediaKind === 'video' ? workspace.policy.reason : undefined) || '当前类型的生成已暂停'}。可以整理素材和检查配置。</p>}
        {cap.experimental && !workspace.policy.allowExperimental && <label className="mb-3 flex items-start gap-2 text-xs leading-5 text-amber-600 dark:text-amber-300"><input type="checkbox" className="mt-1" disabled={busy} onChange={e => e.target.checked && void run(async () => { await generationClient.policy(workspace.policy, { allowExperimental: true }); await reload(); })} />当前参考组合尚未实测。允许本项目试用此类组合后才能生成；不代表质量已通过。</label>}
          {sourceChanged && <div className="mb-3 text-xs text-amber-600"><p>上游来源已变化，旧候选保留。</p><button className={`${button} mt-2`} disabled={busy} onClick={() => void run(async () => { const saved = await save(); const result = await generationClient.update(saved, {}, true); baseline.current = json(result.task); setDraft(result.task); await reload(); })}>核对后更新来源</button></div>}
          <div className="space-y-2 max-h-32 overflow-y-auto" aria-live="polite">{effectiveIssues.map((issue, index) => <p key={`${issue.code}:${index}`} className={`text-xs leading-5 ${issue.blocking ? 'text-amber-600 dark:text-amber-300' : 'text-text-muted'}`}>{issue.message}</p>)}</div>
          {plan && !dirty && <div className="my-3 border-l-2 border-gold pl-3 text-xs leading-5 text-text-secondary"><p>技术预检通过 · {plan.references.length} 份固定参考</p>{plan.operation === 'video' && <p>叙事预计 {plan.narrativeSeconds} 秒 · 请求 {plan.requestedSeconds} 秒；节奏仍需实际剪辑检查。</p>}{plan.compiledFrames && <p>{plan.compiledFrames} 帧 · 预计 {plan.expectedSeconds?.toFixed(2)} 秒；实际输出另行测量。</p>}<p>{cap.provider === 'local' ? '本机媒体处理，不向生成供应商提交；耗时取决于文件。' : '费用与耗时：暂无可靠估计。'}</p></div>}
          <div className="mt-3 flex flex-wrap gap-2"><button className={`${button} ${!plan ? "!border-gold !text-gold" : ""}`} disabled={busy || unavailable || executing} onClick={() => void run(async () => { setSelectedReferenceId(undefined); const saved = await save(); const checked = await generationClient.preflight(saved); setIssues(checked.issues); setPlan(checked.plan); })}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{plan && !dirty ? '重新检查' : '检查并准备生成'}</button>{plan && !dirty && <button className="btn-primary inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs disabled:opacity-40" disabled={busy || !plan || dirty || policyBlocked || effectiveIssues.some(i => i.blocking)} onClick={() => void run(async () => { if (!submitTicket.current || submitTicket.current.planId !== plan!.id) { submitTicket.current = { planId: plan!.id, key: crypto.randomUUID() }; } await generationClient.execute(plan!, submitTicket.current!.key); setPlan(undefined); await reload(); setPanel('results'); setSelectedReferenceId(undefined); })}>{draft.operation === 'video' ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}{paused ? '生成已暂停' : cap.provider === 'local' ? '开始处理' : draft.operation === 'video' ? '生成视频' : draft.operation === 'joint_storyboard' ? '生成宫格' : '生成图片'}</button>}</div>
        </>}

      </footer>
      {pendingLink && <div role="region" aria-label="确认素材引用用途" className="sticky bottom-0 z-40 my-4 flex flex-wrap items-end gap-3 rounded-md border border-gold/50 bg-bg-surface p-4"><label className="min-w-0 flex-1 text-xs">把“{pendingLink.reference.label}”用于任务<select className={`${input} mt-2`} value={pendingLink.reference.role} onChange={e => setPendingLink(p => p ? { ...p, reference: { ...p.reference, role: e.target.value as GenerationReference['role'] } } : p)}>{Object.entries(generationRoleLabels).filter(([key]) => workspace.capabilities.find(c => c.id === currentTasks.find(t => t.id === pendingLink.taskId)?.capabilityId)?.inputs[pendingLink.reference.mediaKind].roles.includes(key as GenerationReference['role'])).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className={button} onClick={() => void run(async () => { const task = pendingLink.taskId === draft.id ? await save() : workspace.tasks.find(t => t.id === pendingLink.taskId)!; const result = await generationClient.update(task, { references: [...task.references, pendingLink.reference] }); if (task.id === draft.id) { baseline.current = json(result.task); setDraft(result.task); } setPendingLink(undefined); await reload(); })}>确认引用</button><button className={button} onClick={() => setPendingLink(undefined)}>取消</button></div>}
    </>}
  </section>;
}
