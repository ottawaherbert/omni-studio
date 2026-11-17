import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Image as ImageIcon, Layers, Pencil, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Episode, ManualStoryboardBoardVisualPage, ManualStoryboardBoardVisualTake, ManualStoryboardBoardWorkflow, Project, Scene, Shot } from '../../clients/domainTypes';
import type { ManualFilmTeamReadModel } from '../../clients/productionPreparationWorkflowClient';
import type { ManualProductionAssetReadModel } from '../../clients/productionAssetWorkflowClient';
import { findSceneStoryboardShotCell, buildStoryboardCompositeVisualPages, getActiveStoryboardBoardVisualTake, getLatestStoryboardBoardVisualCandidate, listStoryboardCompositeWorkflowAnchors, overviewCell, sceneStoryboardContentHash, resolveStoryboardShotGridImage, buildStoryboardCompositeBoardSourceHash, scopeStoryboardCompositeBoardToPage, selectStoryboardCompositeBoardReferences, storyboardShotGridStatus } from '../../clients/productionStoryboardWorkflowClient';
import { useManualVideoStoryboard } from '../../hooks/useManualVideoStoryboard';
import { cn } from '../../lib/utils';
import { GenerationWorkbench } from '../generation/GenerationWorkbench';

const actionClass = 'inline-flex min-h-10 sm:min-h-9 items-center justify-center gap-2 rounded-md border border-border-soft/40 px-3 py-2 text-xs text-text-secondary hover:border-gold hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';
const takeLabel = (take: ManualStoryboardBoardVisualTake, index: number) => `版本 ${index + 1} · ${take.status === 'adopted' ? '已采用' : take.status === 'rejected' ? '已拒绝' : take.status === 'stale' ? '需复核' : '待检查'}`;

export function SceneStoryboardShotFrame({ scene, shot }: { scene: Scene; shot: Shot }) {
  const overview = scene.visualPlan?.overview;
  const cell = overview && overviewCell(overview, shot.id);
  if (overview && cell) return <svg viewBox={`0 0 ${cell.width} ${cell.height}`} className="h-full w-full" role="img" aria-label={`镜头画格：${shot.visualSummary || shot.visualAction || ''}`}><image href={overview.imageUrl} x={-cell.x} y={-cell.y} width={overview.width} height={overview.height} /></svg>;
  const grid = !shot.imageUrl && findSceneStoryboardShotCell(scene, shot.id);
  if (grid) return <svg viewBox="0 0 16 9" className="h-full w-full" role="img" aria-label="宫格中的代表画格，需单独检查"><image href={grid.imageUrl} x={-(grid.index % grid.columns) * 16} y={-Math.floor(grid.index / grid.columns) * 9} width={grid.columns * 16} height={grid.rows * 9} preserveAspectRatio="none" /></svg>;
  return shot.imageUrl ? <img src={shot.imageUrl} alt="当前镜头代表图" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xs text-text-muted"><ImageIcon className="mr-2 h-4 w-4" />尚无画面</div>;
}

type Selection = { unitId: string; pageId: string; shotId: string; takeId?: string };
type Context = { unit: ReturnType<typeof listStoryboardCompositeWorkflowAnchors>[number]; page: ManualStoryboardBoardVisualPage; take?: ManualStoryboardBoardVisualTake; imageUrl?: string; stale: boolean };

export function SceneStoryboardCanvas({ project, episode, scene, filmTeam, assets, sourceHash, updateScene, onEditShot, onEditUnit, onStudio, onSelectUnit }: {
  project: Project; episode: Episode; scene: Scene; filmTeam: ManualFilmTeamReadModel; assets: ManualProductionAssetReadModel;
  sourceHash?: string; updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
  onSelectUnit: (unitId: string) => void; onEditShot: (shotId: string) => void; onEditUnit: (unitId: string) => void; onStudio: (unitId?: string) => void;
}) {
  const units = listStoryboardCompositeWorkflowAnchors({ workflows: scene.manualStoryboard?.boards, shots: scene.shots || [] });
  const inspectorRef = useRef<HTMLElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(() => new URLSearchParams(window.location.search).has('generationTaskId'));
  const viewKey = `scene-canvas-view:${project.id}:${episode.id}:${scene.id}`;
  const [remembered] = useState(() => {
    try { const value = JSON.parse(sessionStorage.getItem(viewKey) || 'null'); return value && typeof value === 'object' ? value as { scope?: string; selection?: Selection; versions?: Record<string, string> } : null; } catch { return null; }
  });
  const [scope, setScope] = useState<string>(remembered?.scope || 'all');
  const [selection, setSelection] = useState<Selection | undefined>(remembered?.selection);
  const [neighborOpen, setNeighborOpen] = useState(false);
  const [versions, setVersions] = useState<Record<string, string>>(remembered?.versions || {});
  useEffect(() => { try { sessionStorage.setItem(viewKey, JSON.stringify({ scope, selection, versions })); } catch { /* Optional browsing state. */ } }, [viewKey, scope, selection, versions]);
  const contexts: Context[] = units.flatMap(unit => unit.workflow.board ? (unit.workflow.board.visualPages?.length ? unit.workflow.board.visualPages : buildStoryboardCompositeVisualPages(unit.workflow.board)).map(page => {
    const chosenId = versions[`${unit.id}:${page.id}`];
    const take = page.visualTakes?.find(item => item.id === chosenId) || getActiveStoryboardBoardVisualTake(page) || getLatestStoryboardBoardVisualCandidate(page) || page.visualTakes?.at(-1);
    const gridImage = !chosenId && unit.workflow.board?.visualReferenceMode === 'shot_grid' && page.activeShotGridTakeId ? resolveStoryboardShotGridImage(page) : undefined;
    const board = unit.workflow.board!;
    const pageBoard = scopeStoryboardCompositeBoardToPage(board, page);
    const pageShots = (scene.shots || []).filter(shot => pageBoard.shotIds.includes(shot.id));
    const references = selectStoryboardCompositeBoardReferences({ project, board: pageBoard, shots: pageShots, assets }).selected;
    const currentHash = buildStoryboardCompositeBoardSourceHash({ project, board, page, references, shots: pageShots });
    return { unit, page, take: gridImage ? undefined : take, imageUrl: gridImage || take?.sourceImageUrl || take?.imageUrl, stale: gridImage ? storyboardShotGridStatus({ board, page, shots: pageShots }) !== 'ready' : !!take && take.sourceHash !== currentHash };
  }) : []);
  const effectiveScope = units.some(unit => unit.id === scope) ? scope : 'all';
  const visibleContexts = contexts.filter(context => effectiveScope === 'all' ? !scene.visualPlan?.overview : context.unit.id === effectiveScope);
  const selected = visibleContexts.find(context => context.unit.id === selection?.unitId && context.page.id === selection.pageId) || visibleContexts[0];
  useEffect(() => { if (selected) onSelectUnit(selected.unit.id); }, [selected?.unit.id, onSelectUnit]);
  const selectedPageShotIds = selected?.page.panelIds.map(id => selected.unit.workflow.board?.panels.find(panel => panel.id === id)?.shotId) || [];
  const shot = scene.shots?.find(item => item.id === selection?.shotId && selectedPageShotIds.includes(item.id)) || scene.shots?.find(item => item.id === selectedPageShotIds[0]);
  const shotIndex = (scene.shots || []).findIndex(item => item.id === shot?.id);
  const select = (context: Context, shotId: string) => {
    setSelection({ unitId: context.unit.id, pageId: context.page.id, shotId }); setNeighborOpen(false);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      setScope(context.unit.id); setInspectorOpen(true);
      requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };
  const duration = (ids: string[]) => (scene.shots || []).filter(item => ids.includes(item.id)).reduce((sum, item) => sum + Number(item.duration || 0), 0);

  if (generationOpen && selected) return <GenerationWorkbench target={{ projectId: project.id, episodeId: episode.id, sceneId: scene.id, kind: 'board', boardId: selected.unit.workflow.board?.id, unitId: selected.unit.workflow.videoGenerationUnitId || selected.unit.id, pageId: selected.page.id, shotIds: selectedPageShotIds.filter((id): id is string => !!id) }} operation="joint_storyboard" onClose={() => setGenerationOpen(false)} />;
  return <div className={cn("grid min-w-0 items-start gap-0", visibleContexts.length > 0 && "xl:grid-cols-[minmax(0,1fr)_300px]")} aria-label="宫格画面工作区">
    <main className="min-w-0 xl:sticky xl:top-0 xl:self-start xl:pr-5">
      <h2 className="sr-only">本场画面</h2>
      <label className="mb-3 block text-xs text-text-muted sm:hidden">预览范围<select aria-label="宫格预览范围" value={effectiveScope} onChange={event => setScope(event.target.value)} className="mt-1 w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-base text-text-primary"><option value="all">整场 · {duration((scene.shots || []).map(shot => shot.id))} 秒</option>{units.map((unit, index) => <option key={unit.id} value={unit.id}>片段 {index + 1} · {duration(unit.shotIds)} 秒</option>)}</select></label>
      <div className={cn("mb-4 hidden flex-wrap gap-1.5", units.length > 0 && "sm:flex")} role="group" aria-label="宫格预览范围">
        <button type="button" onClick={() => setScope('all')} aria-pressed={effectiveScope === 'all'} className={cn(actionClass, effectiveScope === 'all' && 'border-gold text-gold')}><Layers className="h-3.5 w-3.5" />整场</button>
        {units.map((unit, i) => <button type="button" key={unit.id} aria-pressed={effectiveScope === unit.id} onClick={() => setScope(unit.id)} className={cn(actionClass, effectiveScope === unit.id && 'border-gold text-gold')}>片段 {i + 1} · {duration(unit.shotIds)}s</button>)}
      </div>
      {effectiveScope === 'all' && scene.visualPlan?.overview && <section className="mb-5" aria-label="整场故事板"><div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold">整场故事板 · {duration(scene.shots.map(s => s.id))} 秒</span><span className="text-text-muted">{scene.visualPlan.overview.contentHash && scene.visualPlan.overview.contentHash !== sceneStoryboardContentHash(scene) ? '镜头或依据已变化 · 需复核' : '总览参考，视频按片段制作'}</span></div><div className="relative overflow-hidden rounded-md"><img src={scene.visualPlan.overview.imageUrl} alt="本场已采用故事板总览" className="w-full" /><div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${scene.visualPlan.overview.columns}, 1fr)`, gridTemplateRows: `repeat(${scene.visualPlan.overview.rows}, 1fr)` }}>{scene.visualPlan.overview.shotIds.map((id, i) => <button type="button" key={`${id}:${i}`} aria-label={`编辑故事板第 ${i + 1} 格对应镜头`} onClick={() => onEditShot(id)} className="border-2 border-transparent hover:border-gold focus-visible:border-gold" />)}</div></div></section>}
      {visibleContexts.map(context => {
        const board = context.unit.workflow.board!;
        const panels = context.page.panelIds.map(id => board.panels.find(item => item.id === id)).filter(item => !!item);
        const [columns, rows] = context.page.layout.split('x').map(Number);
        const cols = Math.max(1, Math.min(12, columns || 1)), rowCount = Math.max(1, rows || Math.ceil(panels.length / cols));
        return <section key={`${context.unit.id}:${context.page.id}`} className="mb-5" aria-label={`片段 ${units.indexOf(context.unit) + 1} 第 ${context.page.pageIndex + 1} 页`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-text-primary">片段 {units.indexOf(context.unit) + 1} · {duration(context.unit.shotIds)} 秒<span className="ml-2 font-normal text-text-muted">{panels.length} 格{context.page.pageCount > 1 ? ` · 第 ${context.page.pageIndex + 1}/${context.page.pageCount} 页` : ''}</span></span><span className={context.take?.status === 'adopted' ? 'text-emerald-500' : 'text-amber-500'}>{context.stale ? '来源变化 · 需复核' : context.take ? takeLabel(context.take, context.page.visualTakes?.indexOf(context.take) || 0) : context.imageUrl ? '已采用图片排版 · 仍需检查剪接' : '待生成画面'}</span></div>
          <div className="relative overflow-hidden rounded-md bg-bg-primary">
            {context.imageUrl ? <><img src={context.imageUrl} alt={`片段 ${units.indexOf(context.unit) + 1} 宫格候选，不代表视频已验收`} className="block h-auto w-full" /><div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}>{panels.map(panel => <button key={panel.id} type="button" aria-label={`检查镜头 ${(scene.shots || []).findIndex(item => item.id === panel.shotId) + 1}，画格 ${panel.panelNumber}`} aria-pressed={selected === context && shot?.id === panel.shotId} onClick={() => select(context, panel.shotId)} className={cn('min-h-10 border-2 border-transparent transition-colors hover:border-gold/70 focus-visible:border-gold focus-visible:outline-none', selected === context && shot?.id === panel.shotId && 'border-gold')} />)}</div></> : <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{panels.map(panel => { const item = scene.shots?.find(s => s.id === panel.shotId); return <button key={panel.id} type="button" onClick={() => select(context, panel.shotId)} aria-label={`检查镜头 ${(scene.shots || []).findIndex(s => s.id === panel.shotId) + 1}`} className="aspect-video min-w-0 border border-border-soft/30">{item && <SceneStoryboardShotFrame scene={scene} shot={item} />}</button>; })}</div>}
          </div>
        </section>;
      })}
      {!contexts.length && !scene.visualPlan?.overview && <><div className="mb-4 border-b border-border-soft/30 py-6"><h3 className="text-sm font-semibold text-text-primary">尚无联合故事板</h3><p className="mt-2 text-xs text-text-muted">通过顶部“生成故事板”准备图片任务，或在“导入与共同参考”中导入已有联合图。</p></div><details><summary className="mb-3 cursor-pointer text-xs text-text-muted">已有单镜图 · 仅供对照</summary><p className="mb-3 text-xs leading-5 text-text-secondary">尚无联合宫格。下方是已有单镜图片，仅供对照，点击可编辑镜头。</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{(scene.shots || []).map((item, index) => <button type="button" key={item.id} onClick={() => onEditShot(item.id)} className="overflow-hidden rounded-md border border-border-soft/30 text-left"><div className="aspect-video bg-bg-primary"><SceneStoryboardShotFrame scene={scene} shot={item} /></div><p className="p-3 text-xs text-text-secondary">镜头 {index + 1} · {item.duration}s · {item.visualSummary || item.visualAction}</p></button>)}</div></details></>}
      {contexts.length > 0 && <p className="mt-3 text-xs leading-5 text-text-muted">整场总览用于检查空间和事件；视频每次只提交对应片段的画格与相关资产。</p>}
    </main>
    <aside hidden={!visibleContexts.length} ref={inspectorRef} className="mt-5 min-w-0 border-t border-border-soft/30 pt-4 xl:mt-0 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0" aria-label="当前画格详情">
      <button type="button" onClick={() => setInspectorOpen(value => !value)} aria-expanded={inspectorOpen} className="mb-3 flex min-h-10 w-full items-center justify-between text-left text-xs font-bold text-text-primary xl:hidden">{shot ? `镜头 ${shotIndex + 1} · 详情与检查` : '画格详情'}<ChevronDown className={cn('h-4 w-4 transition-transform', inspectorOpen && 'rotate-180')} /></button>
      <div className={cn(!inspectorOpen && 'hidden xl:block')}>
      {selected && shot ? <>
        <p className="mb-1 text-xs text-text-muted">片段 {units.indexOf(selected.unit) + 1} · 所选镜头</p><h3 className="text-sm font-bold text-text-primary">镜头 {shotIndex + 1} · {shot.duration} 秒</h3>
        <div className="mt-3 aspect-video overflow-hidden rounded bg-bg-primary"><CandidateShotFrame context={selected} shotId={shot.id} fallback={<SceneStoryboardShotFrame scene={scene} shot={shot} />} /></div>
        <p className="mt-3 text-xs leading-5 text-text-secondary">{shot.visualAction || shot.visualSummary || '尚未填写画面动作'}</p>
        <dl className="mt-4 space-y-3 text-xs leading-5"><div><dt className="text-text-muted">状态与承接</dt><dd className="mt-1 text-text-secondary">{shot.continuityNote || '尚未记录，需核对人物、持物和事件进度。'}</dd></div><div><dt className="text-text-muted">切镜依据</dt><dd className="mt-1 text-text-secondary">{shot.editingNote || '尚未记录切镜意图。'}</dd></div></dl>
        <button type="button" onClick={() => setNeighborOpen(!neighborOpen)} className={cn(actionClass, 'mt-4 w-full')}>对照相邻镜头</button>
        {neighborOpen && <div className="mt-3 grid grid-cols-2 gap-2">{[scene.shots?.[shotIndex - 1], scene.shots?.[shotIndex + 1]].filter((item): item is Shot => !!item).map(item => <div key={item.id}><div className="aspect-video bg-bg-primary"><CandidateShotFrame context={contexts.find(context => context.page.panelIds.some(id => context.unit.workflow.board?.panels.find(panel => panel.id === id)?.shotId === item.id))} shotId={item.id} fallback={<SceneStoryboardShotFrame scene={scene} shot={item} />} /></div><p className="mt-1 text-[11px] text-text-muted">镜头 {(scene.shots || []).indexOf(item) + 1} · {item.continuityNote || '待补状态'}</p></div>)}</div>}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={actionClass} onClick={() => setGenerationOpen(true)}><ImageIcon className="h-3.5 w-3.5" />{selected.imageUrl ? '重做宫格 · 生成工作台' : '生成宫格 · 生成工作台'}</button><button type="button" className={actionClass} onClick={() => onEditShot(shot.id)}><Pencil className="h-3.5 w-3.5" />编辑镜头</button><button type="button" className={actionClass} onClick={() => onEditUnit(selected.unit.id)}>导入画面 / 详细编辑</button></div>
        <section className="mt-5 border-t border-border-soft/30 pt-4"><h3 className="text-xs font-bold text-text-primary">本页候选与检查</h3><label className="mt-3 block text-xs text-text-muted">预览版本<select aria-label="宫格候选版本" className="mt-1 w-full min-w-0 rounded-md border border-border-soft bg-bg-primary px-2 py-2 text-xs text-text-primary" value={versions[`${selected.unit.id}:${selected.page.id}`] || ''} onChange={event => setVersions(current => ({ ...current, [`${selected.unit.id}:${selected.page.id}`]: event.target.value }))}><option value="">当前参考 / 最近候选</option>{selected.page.visualTakes?.map((take, index) => <option key={take.id} value={take.id}>{takeLabel(take, index)}</option>)}</select></label>
          {selected.take?.review?.notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-amber-500">{selected.take.review.notes}</p>}
          {selected.take?.quality?.issues?.map((issue, index) => <p key={index} className="mt-2 text-xs leading-5 text-amber-500">{typeof issue === 'string' ? issue : JSON.stringify(issue)}</p>)}
          {selected.stale && <p className="mt-3 text-xs leading-5 text-amber-500">镜头、参考或方案已有变化。此图保留用于对照，请重新准备并检查本页。</p>}
          <SceneStoryboardPageAdoption stale={selected.stale} key={`${selected.unit.id}:${selected.page.id}:${selected.take?.id || 'grid'}`} project={project} episode={episode} scene={scene} shot={shot} workflow={selected.unit.workflow} page={selected.page} take={selected.take} filmTeam={filmTeam} assets={assets} sourceHash={sourceHash} updateScene={updateScene} />
        </section>
        <button type="button" onClick={() => onStudio(selected.unit.id)} className={cn(actionClass, 'mt-5 w-full')}>去摄影棚查看本片段<ArrowRight className="h-3.5 w-3.5" /></button>
      </> : <div className="py-6 text-xs leading-5 text-text-muted"><ShieldCheck className="mb-3 h-5 w-5" />先建立视频片段和画格结构。生成或导入画面后，点击画格检查本镜与相邻镜头。</div>}
      </div>
    </aside>
  </div>;
}

function CandidateShotFrame({ context, shotId, fallback }: { context?: Context; shotId: string; fallback: import('react').ReactNode }) {
  if (!context?.imageUrl) return <>{fallback}</>;
  const board = context.unit.workflow.board!;
  const index = context.page.panelIds.findIndex(id => board.panels.find(panel => panel.id === id)?.shotId === shotId);
  if (index < 0) return <>{fallback}</>;
  const [cols, rows] = context.page.layout.split('x').map(Number);
  const columns = cols || 1, rowCount = rows || 1;
  return <div className="relative h-full w-full overflow-hidden"><img src={context.imageUrl} alt="所选候选中的代表画格" className="absolute max-w-none" style={{ width: `${columns * 100}%`, height: `${rowCount * 100}%`, left: `${-(index % columns) * 100}%`, top: `${-Math.floor(index / columns) * 100}%` }} /></div>;
}

function SceneStoryboardPageAdoption({ workflow, page, take, stale, ...props }: {
  project: Project; episode: Episode; scene: Scene; shot: Shot; workflow: ManualStoryboardBoardWorkflow; page: ManualStoryboardBoardVisualPage; take?: ManualStoryboardBoardVisualTake;
  filmTeam: ManualFilmTeamReadModel; assets: ManualProductionAssetReadModel; sourceHash?: string; stale: boolean;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
}) {
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false);
  const { approveBoardVisual } = useManualVideoStoryboard({ ...props, workflowOverride: workflow, storyboardSourceHash: props.sourceHash, upstreamReady: true });
  if (stale) return null;
  if (!take && !page.activeShotGridTakeId) return <p className="mt-3 text-xs leading-5 text-text-muted">本页还没有候选画面。先生成或导入图片，再检查并采用。</p>;
  if (!take || take.status === 'adopted') return <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted"><Check className="h-3.5 w-3.5" />{take ? '参考已采用；视频仍需单独验收' : '图片排版参考；请检查实际剪接效果'}</p>;
  if (take.status !== 'candidate') return <p className="mt-3 text-xs text-amber-500">此版本仅供对照，不能直接采用。</p>;
  return <div className="mt-3 space-y-3"><label className="flex items-start gap-2 text-xs leading-5 text-text-secondary"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} className="mt-1 shrink-0" />已检查本页全部 {page.panelIds.length} 格的人物、空间与状态</label><button type="button" disabled={!checked || busy} className={cn(actionClass, 'w-full')} onClick={async () => { setBusy(true); try { await approveBoardVisual(page.id, take.id); } catch (error) { toast.error(error instanceof Error ? error.message : '采用失败，候选已保留'); } finally { setBusy(false); } }}>{busy ? '正在保存…' : `采用本页 ${page.panelIds.length} 格参考`}</button></div>;
}
