import {AddEpisodeDialog} from './components/AddEpisodeDialog';
import {previewNextEpisode,applyEpisodePreview} from '../../../../../packages/script/src/episodeDevelopment';
import {ScriptAnalysisContext,ScriptAnalysisOutlet,type ScriptAnalysisEntry,type AnalysisSceneSource} from './components/ScriptAnalysisView';
import type {AnalysisEvidenceLocation} from './components/StructureAnalysisCard';
import {bodyEvidenceSelection} from './scriptAnalysisNavigation';
import {ScenePlanningView} from './components/ScenePlanningView';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, LayoutGrid, Edit3, Radar, Download,
  Layers, X, ChevronDown, Check, Sparkles, AlertCircle, Clock, Compass, BookOpen
} from 'lucide-react';
import { Modal } from '../../../../../src/components/ui/Modal';
import { scriptClient } from '../../clients/scriptClient';
import { 
  type ScriptProject, 
  type ProjectProfile, 
  type DeliveryUnit, 
  type Scene 
} from '../../../../../packages/script/src/schema';
import { newScene, newUnit, registerDialogueSpeaker, removeScriptScene } from '../../../../../packages/script/src/project';
import { ScriptExportActions, downloadLocalScript } from './components/ScriptExportActions';
import { exportText, projectSummary } from '../../../../../packages/script/src/exporters';
import { screenplayTextToBlocks } from '../../../../../packages/script/src/fountainAdapter';
import { unitCharacters } from '../../../../../packages/script/src/continuity';
import type { ScriptProjectSummary } from '../../../../../packages/domain/src/scriptDelivery';

import { ScriptLibrary } from './ScriptLibrary';
import { ScriptProjectLibraryPage } from './ScriptProjectLibraryPage';
import { ScriptReadThrough } from './components/ScriptReadThrough';
import { ScreenplayEditor } from './components/ScreenplayEditor';
import { ScriptWorkDirectory,ScriptDirectoryContext } from './components/ScriptWorkDirectory';
import { ScriptDiscussion } from './components/ScriptDiscussion';
import { assistantShortcuts, resolveAssistantUnit, type AssistantRequest } from './scriptAssistantShortcuts';
import { StoryGridBoard } from './components/StoryGridBoard';
import { EpisodeBeatView } from './components/EpisodeBeatView';
import { ContinuityRadarModal } from './components/ContinuityRadarModal';
import { StoryBibleView } from './components/StoryBibleView';
import { WorkflowReviewNotice } from './components/WorkflowReviewNotice';
import { StoryOutlineView } from './components/StoryOutlineView';
import { ScriptTiming } from './ScriptTiming';
import { ScriptAssistant } from './ScriptAssistant';
import type {ScriptAgentStrategy} from '../../../../../packages/script/src/agent';
import { scriptConversationClient } from '../../clients/scriptConversationClient';
import { ScriptDurablePanel } from './ScriptDurablePanel';
import type { AgentDraftOperation } from '../../../../../packages/script/src/agentScope';
import type { ReviewSource,TextSelection, ReviewSceneHandler } from '../../../../../packages/script/src/proposals';
import type { ScriptOperation } from '../../../../../packages/script/src/schema';
import { acknowledgeLegacyScriptRecovery, ownsScriptRecoveryLease, readLegacyScriptRecoveries, readScriptRecovery, putScriptRecovery, removeAllScriptDrafts, removeScriptRecoveryIfSame, scriptRecoveryKey, scriptRecoveryWriterKey, ScriptRecoveryConflict, type ScriptDraftSnapshot } from './scriptDraftCache';
import { currentScriptLoadPolicy, flushScriptForHandoff, mergeAdoptedScript, mergeCurrentScript, sameScriptContent, ScriptSaveCoordinator } from './scriptSaveCoordinator';
import {resolveScriptLocation,locationFromParams,scriptLocationKey,UNASSIGNED_NODE} from './scriptWorkspaceLocation';
import {insertScenesInStructure,updateUnitStructure} from '../../../../../packages/script/src/structure';
import {ScriptStructureEditor} from './components/ScriptStructureEditor';
import './script.css';
import toast from 'react-hot-toast';
import { APP_BEFORE_NAVIGATE_EVENT } from '../../../../../src/utils/navigationGuard';

const durableStep:Partial<Record<ScriptOperation,AgentDraftOperation>>={
  scene:'scene_body',rewrite:'replace_blocks',text_rewrite:'replace_selection',concept:'concept',theme:'theme',
  character:'add_character',fact:'add_fact',outline:'project_outline',unit_outline:'unit_outline',plan:'plan_scenes',
};

export default function ScriptWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId');
  const isLibraryView = location.pathname.endsWith('/library') || params.get('view') === 'library';
  const returnTo = (() => {
    const value = params.get('returnTo');
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '';
    try {
      const target = new URL(value, window.location.origin);
      return target.origin === window.location.origin && target.pathname !== '/writing' && !target.pathname.startsWith('/api/')
        ? `${target.pathname}${target.search}${target.hash}` : '';
    } catch { return ''; }
  })();
  const bindOnReturn = params.get('bindOnReturn') === '1';
  const handoffParams = returnTo ? { returnTo, ...(bindOnReturn ? { bindOnReturn: '1' } : {}) } : {};
  const projectUrl = (id: string, view?: string) => `/writing?${new URLSearchParams({ projectId: id, ...(view ? { view } : {}), ...handoffParams })}`;
  const homeUrl = returnTo ? `/writing?${new URLSearchParams(handoffParams)}` : '/writing';
  const libraryUrl = returnTo ? `/writing/library?${new URLSearchParams(handoffParams)}` : '/writing/library';
  const returnUrl = (id?: string) => {
    if (!returnTo) return '';
    const target = new URL(returnTo, window.location.origin);
    if (id && bindOnReturn) target.searchParams.set('writingProjectId', id);
    return `${target.pathname}${target.search}${target.hash}`;
  };

  const [projects, setProjects] = useState<ScriptProjectSummary[]>([]);
  const [project, setProject] = useState<ScriptProject | null>(null);
  const [saved, setSaved] = useState('');
  const savedCurrent = useRef<ScriptProject | null>(null);
  const [draftConflict, setDraftConflict] = useState<{ server: ScriptProject; message: string } | null>(null);
  const conflictCurrent = useRef<typeof draftConflict>(null);
  conflictCurrent.current = draftConflict;
  const [legacyRecoveries, setLegacyRecoveries] = useState<ScriptDraftSnapshot[]>([]);
  const legacyCurrent = useRef(legacyRecoveries);
  legacyCurrent.current = legacyRecoveries;
  const [draftStorageError, setDraftStorageError] = useState('');
  const [saveError, setSaveError] = useState('');
  const saveErrorCurrent = useRef('');
  const recovery = useRef<ScriptDraftSnapshot | null>(null);
  const writerId = useRef(crypto.randomUUID());
  const [editing, setEditing] = useState(false);
  const editingCurrent = useRef(false);
  const editorGeneration = useRef(0);
  const coordinator = useRef<ScriptSaveCoordinator | null>(null);
  const restoringHistory = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [returning, setReturning] = useState(false);
  const returningCurrent = useRef(false);
  const [error, setError] = useState('');

  // View Mode: 'blueprint' (dedicated pre-production), 'outline' (macro & episode outline), 'studio' (3-pane writing), 'board' (story grid kanban), or 'unit' (deep episode beat details)
  const [viewMode, setViewMode] = useState<'blueprint' | 'outline' | 'studio' | 'board' | 'unit'>('studio');
  const [blueprintTab, setBlueprintTab] = useState<'blueprint' | 'characters' | 'world'>('blueprint');
  const [activeUnitId, setActiveUnitId] = useState('');
  const [activeSceneId, setActiveSceneId] = useState('');
  const [analysisEntry,setAnalysisEntry]=useState<ScriptAnalysisEntry|null>(null);
  const analysisReturnFocus=useRef<HTMLElement|null>(null);
  const analysisReturnAssistant=useRef(false);
  const analysisOrigin=useRef<string|undefined>(undefined);
  const [sceneFocus,setSceneFocus]=useState<{sceneId:string;field?:string;quote?:string}>();
  const [bodyFocus,setBodyFocus]=useState<{sceneId:string;source?:AnalysisSceneSource}>();
  const closeAnalysis=()=>{setAnalysisEntry(null);if(analysisReturnAssistant.current)setAssistantOpen(true);analysisReturnAssistant.current=false;requestAnimationFrame(()=>analysisReturnFocus.current?.isConnected&&analysisReturnFocus.current.focus({preventScroll:true}));};
  useEffect(()=>{setAnalysisEntry(null);setBodyFocus(undefined);setSceneFocus(undefined);},[projectId]);
  const [outlineFocus,setOutlineFocus]=useState<{owner:import('../../../../../packages/script/src/outlineGuides').OutlineOwner;start:number;end:number;nodeId?:string}>();
  const [outlineChoice,setOutlineChoice]=useState<'current'|'story'|'project'|'season'|'legacy'>('current'),[outlineTab,setOutlineTab]=useState<'outline'|'beats'|'structure'>('outline');
  const [outlineSeasonId,setOutlineSeasonId]=useState<string>();
  const [activeNodeId,setActiveNodeId]=useState<string|undefined>();
  const [treeOpen,setTreeOpen]=useState(()=>window.innerWidth>=1280);
  const workArea=useRef<HTMLDivElement>(null);const [workWidth,setWorkWidth]=useState(window.innerWidth);
  useEffect(()=>{const node=workArea.current;if(!node)return;const observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;setWorkWidth(width);if(width<1280)setTreeOpen(false);});observer.observe(node);return()=>observer.disconnect();},[project?.id]);
  const [addingEpisode,setAddingEpisode]=useState(false);
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [isTimingOpen, setIsTimingOpen] = useState(false);
  const assistantToggle=useRef<HTMLButtonElement>(null);
  const closeAssistant=()=>{setAssistantOpen(false);requestAnimationFrame(()=>assistantToggle.current?.focus());};
  const [isAssistantOpen, setAssistantOpen] = useState(() => window.innerWidth >= 1280);
  useEffect(()=>{if(isAssistantOpen&&workWidth<960)setTreeOpen(false);},[isAssistantOpen,workWidth]);
  const [assistantRequest,setAssistantRequest]=useState<AssistantRequest|null>(null);
  const assistantRequestId=useRef(0);
  const [legacyTarget,setLegacyTarget]=useState<{unitId:string;sceneId?:string;unitIndices?:number[]}|null>(null);
  const [legacySubmission,setLegacySubmission]=useState<{id:number;channel:'api'|'external';methodIds:string[]}>();
  const [assistantMode,setAssistantMode] = useState<'step'|'agent'>('step');
  const setIsAssistantOpen = (open:boolean) => {setAssistantOpen(open);};
  const setIsAgentOpen = (open:boolean) => {setAssistantMode(open?'agent':'step');if(open)setAssistantOpen(true);};
  const projectMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event:PointerEvent) => {if(projectMenu.current&&!projectMenu.current.contains(event.target as Node))projectMenu.current.open=false;};
    const escape = (event:KeyboardEvent) => {if(event.key==='Escape'&&projectMenu.current?.open){projectMenu.current.open=false;projectMenu.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[]);
  const [assistantInitialOperation, setAssistantInitialOperation] = useState<ScriptOperation | null>(null);
  const [assistantSelection,setAssistantSelection]=useState<TextSelection|undefined>(undefined);
  const [assistantFocusIssue,setAssistantFocusIssue]=useState('');
  const [assistantReviewSource,setAssistantReviewSource]=useState<ReviewSource|undefined>(undefined);
  const [isReadingOpen,setIsReadingOpen]=useState(false);
  const [isOriginalOpen,setIsOriginalOpen]=useState(false);
  const [agentLaunch,setAgentLaunch]=useState<{strategy:ScriptAgentStrategy;goal:string}|null>(null);
  const analysisPosition=JSON.stringify([viewMode,activeUnitId,activeSceneId,activeNodeId,outlineChoice,outlineSeasonId]);
  useEffect(()=>{
    if(analysisEntry&&analysisOrigin.current!==analysisPosition)setAnalysisEntry(null);
  },[analysisEntry,analysisPosition]);

  const current = useRef(project);
  current.current = project;
  const dirty = Boolean(project && savedCurrent.current && !sameScriptContent(project, savedCurrent.current));
  const ownsEditor = () => {
    if (!editingCurrent.current) return false;
    if (navigator.locks || projectId && ownsScriptRecoveryLease(localStorage, projectId, writerId.current)) return true;
    coordinator.current?.dispose(); coordinator.current = null;
    editingCurrent.current = false; setEditing(false); setSaving(false);
    return false;
  };

  const activeUnit = project?.units.find((u) => u.id === activeUnitId) || project?.units[0];
  const activeScene = activeUnit?.scenes.find((s) => s.id === activeSceneId);
  const rangeScenes=activeUnit?.scenes.filter(s=>!activeNodeId||activeNodeId===UNASSIGNED_NODE?!activeNodeId||!s.structureNodeId:s.structureNodeId===activeNodeId||activeUnit.structureNodes?.find(n=>n.id===s.structureNodeId)?.parentId===activeNodeId)??[];
  const scenePosition=rangeScenes.findIndex(s=>s.id===activeSceneId);
  const navigateScene=(offset:number)=>{const next=rangeScenes[scenePosition+offset];if(next){setActiveSceneId(next.id);updateUrlParams({sceneId:next.id});}};
  const openAnalysisScene=(unitId:string,sceneId:string,source?:AnalysisSceneSource)=>{
    const target=project?.units.find(unit=>unit.id===unitId)?.scenes.find(scene=>scene.id===sceneId);if(!target)return;
    setAnalysisEntry(null);setIsReadingOpen(false);setActiveUnitId(unitId);setActiveSceneId(sceneId);setActiveNodeId(target.structureNodeId);
    const view=source?.kind==='SCENE_PLAN'?'board':'studio';setViewMode(view);
    if(source?.kind==='SCENE_PLAN')setSceneFocus({sceneId,field:source.field,quote:source.quote});else setBodyFocus({sceneId,source});
    updateUrlParams({view,unitId,sceneId,nodeId:target.structureNodeId||null});
  };
  const openAnalysisOutline=(unitId:string,source?:AnalysisEvidenceLocation['outline'])=>{
    if(!project?.units.some(unit=>unit.id===unitId))return;
    setAnalysisEntry(null);setIsReadingOpen(false);setActiveUnitId(unitId);setActiveNodeId(source?.nodeId);setOutlineFocus(source);setOutlineTab('outline');
    if(source){setOutlineChoice(source.owner.kind==='unit'?'current':source.owner.kind==='project'?'project':source.owner.kind==='season'?'season':'story');if(source.owner.kind==='season')setOutlineSeasonId(source.owner.id);}
    setViewMode('outline');updateUrlParams({view:'outline',unitId,nodeId:source?.nodeId||null});
  };
  const openAnalysisRequest=(request:Pick<AssistantRequest,'unitId'|'sceneId'|'nodeId'|'stage'|'selection'|'outlineRange'|'scopeId'|'seasonId'>,source?:AnalysisEvidenceLocation)=>{
    if(source?.outline){openAnalysisOutline(request.unitId,source.outline);return;}
    if(request.sceneId){openAnalysisScene(request.unitId,request.sceneId,source?.scene??{kind:request.stage==='BODY'?'BODY_BLOCK':'SCENE_PLAN',quote:request.selection?.text});return;}
    setAnalysisEntry(null);setIsReadingOpen(false);setActiveUnitId(request.unitId);setActiveNodeId(request.nodeId);
    if(request.stage==='OUTLINE'){
      const owner={kind:request.seasonId?'season':request.scopeId?(request.scopeId===project?.id?'project':'story'):'unit',id:request.seasonId||request.scopeId||request.unitId} as import('../../../../../packages/script/src/outlineGuides').OutlineOwner;
      openAnalysisOutline(request.unitId,request.outlineRange?{owner,start:request.outlineRange.start,end:request.outlineRange.end,nodeId:request.nodeId}:undefined);
      if(!request.outlineRange){setOutlineChoice(owner.kind==='unit'?'current':owner.kind==='project'?'project':owner.kind==='season'?'season':'story');if(owner.kind==='season')setOutlineSeasonId(owner.id);}
    }else{setViewMode('board');updateUrlParams({view:'board',unitId:request.unitId,nodeId:request.nodeId||null});}
  };
  useEffect(()=>{
    if(!bodyFocus||analysisEntry||viewMode!=='studio'||activeScene?.id!==bodyFocus.sceneId||!project||!activeUnit)return;
    const frame=requestAnimationFrame(()=>{
      const editor=workArea.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="本场正文"]');if(!editor)return;
      const selection=bodyFocus.source?bodyEvidenceSelection(activeScene.blocks,unitCharacters(project,activeUnit),bodyFocus.source):{start:0,end:0,text:''};
      if(!selection||editor.value.slice(selection.start,selection.end)!==selection.text)return;
      const selectionStart=selection.start;
      editor.focus({preventScroll:true});editor.setSelectionRange(selection.start,selection.end);
      const line=editor.value.slice(0,selectionStart).split('\n').length-1;
      editor.scrollTop=Math.max(0,line*(parseFloat(getComputedStyle(editor).lineHeight)||25)-editor.clientHeight/2);
      editor.scrollIntoView({block:'nearest'});
    });return()=>cancelAnimationFrame(frame);
  },[bodyFocus,analysisEntry,viewMode,activeScene?.id]);
  const legacyUnit=legacyTarget?project?.units.find(item=>item.id===legacyTarget.unitId):activeUnit;
  const legacyScene=legacyTarget?.sceneId?legacyUnit?.scenes.find(item=>item.id===legacyTarget.sceneId):legacyUnit?.scenes[0];
  const requestAssistant=(operation:ScriptOperation,request?:string,unitId?:string,selection?:TextSelection,entity?:AssistantRequest['entity'],scopeId?:string,nodeId?:string,explicitSceneId?:string,requestedUnitIndices?:number[])=>{
    if(!project)return;
    const targetUnit=resolveAssistantUnit(project,unitId||activeUnit?.id,entity,scopeId);
    if(!targetUnit){toast.error('这条资料尚未对应任何故事单元，请先调整适用范围。');return;}
    const targetScene=targetUnit.scenes.find(item=>item.id===(explicitSceneId||activeSceneId))||targetUnit.scenes[0];
    const shortcut=assistantShortcuts[operation]||{label:'AI 协助',text:'请基于当前内容提出具体建议。'};
    const stage=['scene','rewrite','text_rewrite'].includes(operation)?'BODY':['plan','board_plan','scene_turn','ending'].includes(operation)?'SCENES':['outline','unit_outline','unit_outlines'].includes(operation)?'OUTLINE':viewMode==='blueprint'?'BLUEPRINT':viewMode==='outline'?'OUTLINE':viewMode==='board'||viewMode==='unit'?'SCENES':'BODY';
    const batchStart=project.units.findIndex(item=>item.id===targetUnit.id)+1;
    const unitIndices=['unit_outlines','board_plan'].includes(operation)?requestedUnitIndices||Array.from({length:Math.min(3,project.profile.plannedUnits-batchStart+1)},(_,i)=>batchStart+i):undefined;
    setAssistantRequest({id:++assistantRequestId.current,text:request??(unitIndices?`${shortcut.text} 本批仅处理第 ${unitIndices.join('、')} 集，已有内容保留，其他集留待下一批。`:nodeId?`请仅为「${targetUnit.structureNodes?.find(item=>item.id===nodeId)?.title||'所选段落'}」规划分场，保留其他段落和已有正文。`:shortcut.text),label:nodeId?(stage==='OUTLINE'?'当前段落大纲':'段落分场'):scopeId&&project.seasons?.some(season=>season.id===scopeId)?'本季大纲':scopeId&&scopeId!==project.id?'当前故事大纲':shortcut.label,unitId:targetUnit.id,
      ...(operation==='consult'&&request?.includes('分析')?{analysis:true}:{}),...(['outline','unit_outline'].includes(operation)&&!nodeId&&!project.seasons?.some(season=>season.id===scopeId)?{outlineStructure:true,outlineSceneOrder:true}:{}),
      ...((['scene','scene_turn','text_rewrite','rewrite'].includes(operation)||operation==='consult'&&(stage==='BODY'||Boolean(explicitSceneId)))&&targetScene?{sceneId:targetScene.id}:{}),stage,selection,operation,entity,...(unitIndices?{unitIndices}:{}),...(scopeId?{scopeId,...((project.seasons||[]).some(item=>item.id===scopeId)?{seasonId:scopeId}:{})}:{}),...(nodeId?{nodeId}:{})});
    setAssistantOpen(true);setAssistantMode('step');
  };
  const requestBeatChange=(request:AssistantRequest)=>{
    setAssistantRequest({...request,id:++assistantRequestId.current});
    setAssistantOpen(true);setAssistantMode('step');
  };


  const loadList = () => scriptClient.listProjects().then((r) => setProjects(r.projects));

  useEffect(() => {
    loadList().catch((e) => setError(e instanceof Error ? e.message : '加载列表失败'));
  }, []);

  // Only one live editor owns this work's single recovery slot.
  useEffect(() => {
    let active = true, release: (() => void) | undefined;
    const controller = new AbortController();
    editingCurrent.current = false; setEditing(false);
    if (!projectId) return;
    const own = () => { if (active) { editingCurrent.current = true; setEditing(true); } };
    if (navigator.locks) {
      void navigator.locks.request(`omni.script.edit.${projectId}`, { signal: controller.signal }, async () => {
        if (!active) return;
        own();
        await new Promise<void>(resolve => { release = resolve; });
      }).catch(error => { if (active && error?.name !== 'AbortError') setError('无法取得编辑权，请重新打开作品。'); });
    } else {
      // Older browsers use a renewable ownership record, alongside exact
      // cache comparisons and the server's revision check.
      const key = scriptRecoveryWriterKey(projectId);
      const renew = () => {
        if (!active) return;
        try {
          const value = JSON.parse(localStorage.getItem(key) || 'null');
          if (value && value.id !== writerId.current && value.until > Date.now()) {
            coordinator.current?.dispose(); coordinator.current = null; setSaving(false);
            editingCurrent.current = false; setEditing(false); return;
          }
          const raw = JSON.stringify({ id: writerId.current, until: Date.now() + 15000 });
          localStorage.setItem(key, raw);
          if (localStorage.getItem(key) === raw) own();
        } catch { setDraftStorageError('无法保护本机恢复稿，请先导出当前内容。'); }
      };
      renew();
      const timer = window.setInterval(renew, 3000);
      release = () => {
        window.clearInterval(timer);
        try { if (JSON.parse(localStorage.getItem(key) || 'null')?.id === writerId.current) localStorage.removeItem(key); } catch {}
      };
    }
    return () => {
      active = false; editingCurrent.current = false;
      coordinator.current?.dispose(); coordinator.current = null;
      controller.abort(); release?.();
    };
  }, [projectId]);

  useEffect(() => {
    const policy = currentScriptLoadPolicy(current.current, savedCurrent.current, projectId, editing);
    if (policy === 'wait') {
      coordinator.current?.dispose(); coordinator.current = null; setSaving(false);
      return;
    }
    const retained = policy === 'retain' ? current.current : null;
    let active = true;
    editorGeneration.current++;
    coordinator.current?.dispose(); coordinator.current = null;
    setSaving(false); setError(''); setDraftConflict(null); conflictCurrent.current = null;
    setLegacyRecoveries([]); legacyCurrent.current = [];
    setDraftStorageError(''); setSaveError(''); saveErrorCurrent.current = '';
    recovery.current = null;
    setLoading(true);
    if (!retained) { savedCurrent.current = null; current.current = null; setProject(null); }
    if (!projectId) { setLoading(false); return; }
    scriptClient.getProject(projectId)
      .then(({ project: server }) => {
        if (!active) return;
        savedCurrent.current = server; setSaved(JSON.stringify(server));
        let draft = retained || server;
        if (editing) {
          try {
            const recovered = readScriptRecovery(localStorage, server.id);
            recovery.current = recovered;
            const unparsed = !recovered ? localStorage.getItem(scriptRecoveryKey(server.id)) : null;
            if (unparsed !== null) {
              recovery.current = { key: scriptRecoveryKey(server.id), raw: unparsed, id: 'unread', project: server, updatedAt: 0 };
              const conflict = { server, message: '本机恢复内容暂时无法自动读取。原始内容已保留，请先导出再继续已保存稿。' };
              conflictCurrent.current = conflict; setDraftConflict(conflict);
            }
            const old = readLegacyScriptRecoveries(localStorage, server);
            if (!retained && unparsed === null) {
              if (recovered && !sameScriptContent(recovered.project, server)) draft = recovered.project;
              else if (old.length === 1) draft = old[0].project;
            }
            const remaining = old.filter(item => !sameScriptContent(item.project, draft));
            legacyCurrent.current = remaining; setLegacyRecoveries(remaining);
            if (!sameScriptContent(draft, server) && (retained || draft.revision !== server.revision)) {
              const conflict = { server, message: '本机恢复内容与已保存作品不同，已暂停自动保存。请先导出需要的内容，再继续已保存稿。' };
              conflictCurrent.current = conflict; setDraftConflict(conflict);
            }
          } catch { setDraftStorageError('无法读取本机恢复内容，请先导出当前稿。'); }
        }
        current.current = draft; setProject(draft);
        let remembered = {}; try { remembered = JSON.parse(localStorage.getItem(scriptLocationKey(server.id)) || '{}'); } catch {}
        const next = resolveScriptLocation(draft, locationFromParams(params), remembered);
        setActiveUnitId(next.unitId || ''); setActiveSceneId(next.sceneId || ''); setActiveNodeId(next.nodeId);
        setViewMode(next.view); setOutlineChoice(next.outlineChoice || 'current'); setOutlineSeasonId(next.outlineSeasonId); setOutlineTab(next.outlineTab || 'outline');
        const legacy = params.get('view') || params.get('section') || params.get('tab');
        setBlueprintTab(legacy === 'characters' ? 'characters' : legacy === 'world' ? 'world' : 'blueprint');
      })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : '读取剧本失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, editing]);

  // Explicit URLs win; page changes otherwise preserve the current object.
  useEffect(()=>{
    if(!project)return;
    const requested=locationFromParams(params);if(!Object.keys(requested).length)return;
    const next=resolveScriptLocation(project,requested,{view:viewMode,unitId:activeUnitId,sceneId:activeSceneId,nodeId:activeNodeId});
    setViewMode(next.view);setActiveUnitId(next.unitId||'');setActiveSceneId(next.sceneId||'');setActiveNodeId(next.nodeId);
  },[params,project?.id]);
  useEffect(()=>{
    if(!project||loading)return;
    const next=resolveScriptLocation(project,{view:viewMode,unitId:activeUnitId,sceneId:activeSceneId,nodeId:activeNodeId,outlineChoice,outlineSeasonId,outlineTab});
    if(next.unitId!==activeUnitId)setActiveUnitId(next.unitId||'');
    if(next.sceneId!==activeSceneId)setActiveSceneId(next.sceneId||'');
    if(next.nodeId!==activeNodeId)setActiveNodeId(next.nodeId);
    try{localStorage.setItem(scriptLocationKey(project.id),JSON.stringify(next));}catch{}
  },[project,loading,viewMode,activeUnitId,activeSceneId,activeNodeId,outlineChoice,outlineSeasonId,outlineTab]);

  useLayoutEffect(() => {
    if (!project || loading || !editing || !ownsEditor()) return;
    if (recovery.current?.id === 'unread') return;
    if (draftConflict && recovery.current?.id !== writerId.current && recovery.current && !sameScriptContent(project, recovery.current.project)) return;
    try {
      if (!dirty) {
        if (recovery.current && removeScriptRecoveryIfSame(localStorage, recovery.current)) recovery.current = null;
      } else {
        recovery.current = putScriptRecovery(localStorage, project, writerId.current, recovery.current);
        for (const old of readLegacyScriptRecoveries(localStorage, savedCurrent.current!)) {
          if (sameScriptContent(old.project, project)) acknowledgeLegacyScriptRecovery(localStorage, old);
        }
      }
      setDraftStorageError('');
    } catch (error) {
      const message = error instanceof ScriptRecoveryConflict ? error.message : '本机恢复空间不足，请先导出当前稿。';
      setDraftStorageError(message);
      if (error instanceof ScriptRecoveryConflict && savedCurrent.current) {
        const conflict = { server: savedCurrent.current, message };
        conflictCurrent.current = conflict; setDraftConflict(conflict);
      }
    }
  }, [project, dirty, loading, editing]);

  useEffect(() => {
    if (!projectId) return;
    const changed = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== scriptRecoveryKey(projectId)) return;
      const incoming = readScriptRecovery(localStorage, projectId);
      if (editingCurrent.current && incoming && incoming.id !== writerId.current && current.current && !sameScriptContent(incoming.project, current.current)) {
        const server = savedCurrent.current;
        if (server) { const conflict = { server, message: '另一页面写入了不同恢复内容。当前修改已保留，请先导出后处理。' }; conflictCurrent.current = conflict; setDraftConflict(conflict); }
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [projectId]);

  // Project state mutators
  const change = (fn: (draft: ScriptProject) => void) => {
    if (!ownsEditor() || legacyCurrent.current.length > 0) return;
    setProject((p) => {
      if (!p) return p;
      const next = structuredClone(p);
      try {fn(next);}catch(cause){queueMicrotask(()=>toast.error(cause instanceof Error?cause.message:'内容已变化，请核对后重试。'));return p;}
      current.current = next;
      return next;
    });
  };

  const updateUnit = (updatedUnit: DeliveryUnit) => {
    change((p) => {
      const idx = p.units.findIndex((u) => u.id === updatedUnit.id);
      if (idx !== -1) {
        p.units[idx] = updatedUnit;
      }
    });
  };

  const updateScene = (updatedScene: Scene) => {
    change((p) => {
      const u = p.units.find((u) => u.id === activeUnit?.id);
      if (!u) return;
      const sIdx = u.scenes.findIndex((s) => s.id === updatedScene.id);
      if (sIdx !== -1) {
        u.scenes[sIdx] = updatedScene;
      }
    });
  };

  const ensureCoordinator = () => {
    if (coordinator.current) return coordinator.current;
    const generation = editorGeneration.current;
    const isCurrent = () => generation === editorGeneration.current;
    coordinator.current = new ScriptSaveCoordinator({
      read: () => isCurrent() ? current.current : null,
      saved: () => isCurrent() ? savedCurrent.current : null,
      assertWritable: () => {
        if (!ownsEditor()) throw new Error('此作品正在另一页面编辑，请在该页面继续。');
        if (conflictCurrent.current) throw new Error('请先处理恢复内容冲突。');
        if (legacyCurrent.current.length) throw new Error('请先处理旧版恢复内容。');
        if (saveErrorCurrent.current) throw new Error(saveErrorCurrent.current);
      },
      persist: async snapshot => (await scriptClient.saveProject(snapshot)).project,
      committed: (sent, result) => {
        if (!isCurrent() || !current.current || current.current.id !== result.id) return;
        const latest = current.current;
        let merged: ScriptProject;
        try { merged = mergeCurrentScript(sent, latest, result); }
        catch {
          const conflict = { server: result, message: '保存期间同一处内容发生变化，当前修改已保留，请先处理冲突。' };
          conflictCurrent.current = conflict; setDraftConflict(conflict); return;
        }
        savedCurrent.current = result; setSaved(JSON.stringify(result));
        current.current = merged; setProject(merged);
        setProjects(items => items.map(item => item.id === result.id ? projectSummary(result) : item));
        saveErrorCurrent.current = ''; setSaveError('');
      },
      failed: async (error, sent) => {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : '自动保存失败，请重试。';
        saveErrorCurrent.current = message; setSaveError(message);
        if ((error as { status?: number })?.status === 409) {
          try {
            const { project: server } = await scriptClient.getProject(sent.id);
            if (!isCurrent()) return;
            savedCurrent.current = server; setSaved(JSON.stringify(server));
            const conflict = { server, message: '已保存作品在其他操作中更新，当前修改已保留，已暂停自动保存。' };
            conflictCurrent.current = conflict; setDraftConflict(conflict);
          } catch {}
        }
      },
      saving: value => { if (isCurrent()) setSaving(value); },
    });
    return coordinator.current;
  };

  const saveForAction = async (strict = false): Promise<ScriptProject | undefined> => {
    saveErrorCurrent.current = ''; setSaveError('');
    try {
      const result = await ensureCoordinator().flush();
      if (strict && (!result || !current.current || !sameScriptContent(current.current, result))) throw new Error('页面内容已改变，请重新发起操作。');
      return result;
    } catch (error) {
      if (strict) throw error;
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  };
  const save = async () => { await saveForAction(); };

  const handleReturnToWorkspace = async () => {
    const selectedId = current.current?.id;
    if (!selectedId || returningCurrent.current) return;
    returningCurrent.current = true;
    setReturning(true);
    try {
      if (conflictCurrent.current || legacyCurrent.current.length) throw new Error('请先处理当前稿的本机恢复冲突，再返回原工作区。');
      await flushScriptForHandoff({
        projectId: selectedId,
        readCurrent: () => current.current,
        readSaved: () => savedCurrent.current,
        canEdit: editingCurrent.current,
        flush: () => saveForAction(true),
      });
      navigate(returnUrl(selectedId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '剧本保存失败，请留在当前页面重试。');
    } finally {
      returningCurrent.current = false;
      setReturning(false);
    }
  };

  useEffect(() => {
    if (!project || loading || !editing || !dirty || draftConflict || legacyRecoveries.length || saveError) return;
    const timer = window.setTimeout(() => { void ensureCoordinator().flush().catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [project, loading, editing, dirty, draftConflict, legacyRecoveries.length, saveError]);
  useEffect(() => () => { coordinator.current?.dispose(); }, []);

  const applyAcceptedJob = (accepted: ScriptProject, base: ScriptProject, baselineTrusted = false) => {
    const local = current.current, baseline = savedCurrent.current;
    if (!local || local.id !== accepted.id || !baseline || !editingCurrent.current) return;
    coordinator.current?.dispose(); coordinator.current = null; setSaving(false);
    editorGeneration.current++;
    let merged: ScriptProject;
    try {
      merged = mergeAdoptedScript(base, local, baseline, accepted, baselineTrusted);
    } catch {
      const conflict = { server: accepted, message: 'AI 结果已写入作品；你同时修改了相同内容，本机修改已保留。请先导出后继续已保存稿。' };
      savedCurrent.current = accepted; setSaved(JSON.stringify(accepted));
      conflictCurrent.current = conflict; setDraftConflict(conflict);
      toast.error('同时修改的内容需要处理，当前修改已保留。');
      return;
    }
    savedCurrent.current = accepted; setSaved(JSON.stringify(accepted));
    current.current = merged; setProject(merged);
    conflictCurrent.current = null; setDraftConflict(null);
    saveErrorCurrent.current = ''; setSaveError('');
    void loadList();
    toast.success('已采用到当前稿');
  };

  const openReviewFinding:ReviewSceneHandler=(sceneId,issue,suggestion,source,operation='scene')=>{
    if(!project)return;
    const target=project.units.find(unit=>unit.scenes.some(scene=>scene.id===sceneId));
    if(!target)return;
    setActiveUnitId(target.id);setActiveSceneId(sceneId);setViewMode('studio');
    updateUrlParams({view:'studio',unitId:target.id,sceneId});
    setLegacyTarget({unitId:target.id,sceneId});
    setAssistantFocusIssue(`${issue}\n建议：${suggestion}`);setAssistantInitialOperation(operation);setAssistantReviewSource(source);setLegacySubmission(undefined);
    setIsAgentOpen(false);setIsAssistantOpen(true);
  };

  const navigateTo = (nextParams: Record<string, string>) => {
    if (!confirmLeave()) return;
    setParams(nextParams);
  };

  const confirmLeave = () => !dirty || window.confirm(draftStorageError
    ? '本机草稿保存失败，离开会丢失当前改稿。请先导出 JSON；仍要离开？'
    : '当前草稿保存在本机，确定离开？');

  useEffect(() => {
    if (!dirty || !draftStorageError) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty,draftStorageError]);

  useEffect(() => {
    if(!dirty||!draftStorageError)return;
    const oldUrl=`${location.pathname}${location.search}${location.hash}`;
    const oldState=window.history.state;
    const guardProgrammatic=(event:Event)=>{if(!confirmLeave())event.preventDefault();};
    const guardLink=(event:MouseEvent)=>{
      const link=event.target instanceof Element?event.target.closest('a[href]') as HTMLAnchorElement|null:null;
      if(!link||link.origin!==window.location.origin||link.href===window.location.href)return;
      if(!confirmLeave()){event.preventDefault();event.stopImmediatePropagation();}
    };
    const guardHistory=(event:PopStateEvent)=>{
      if(restoringHistory.current){restoringHistory.current=false;event.stopImmediatePropagation();return;}
      if(confirmLeave())return;
      event.stopImmediatePropagation();
      const previousIndex=oldState?.idx,targetIndex=event.state?.idx;
      if(Number.isSafeInteger(previousIndex)&&Number.isSafeInteger(targetIndex)&&previousIndex!==targetIndex){
        restoringHistory.current=true;
        window.history.go(previousIndex-targetIndex);
      }else window.history.pushState(oldState,'',oldUrl);
    };
    window.addEventListener(APP_BEFORE_NAVIGATE_EVENT,guardProgrammatic);
    document.addEventListener('click',guardLink,true);
    window.addEventListener('popstate',guardHistory,true);
    return()=>{window.removeEventListener(APP_BEFORE_NAVIGATE_EVENT,guardProgrammatic);document.removeEventListener('click',guardLink,true);window.removeEventListener('popstate',guardHistory,true);};
  },[dirty,draftStorageError,location.pathname,location.search,location.hash]);

  const updateUrlParams = (updates: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('section');
      next.delete('tab');
      Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === undefined) {
          next.delete(k);
        } else {
          next.set(k, v);
        }
      });
      return next;
    });
  };

  const handleAddScene = (targetUnitId: string) => {
    const targetUnit=project?.units.find(unit=>unit.id===targetUnitId);
    const s = newScene(`第 ${(targetUnit?.scenes.length || 0) + 1} 场`);
    change((p) => {
      const u = p.units.find((u) => u.id === targetUnitId);
      if (u) Object.assign(p,insertScenesInStructure(p,targetUnitId,[s],{...(targetUnitId===activeUnit?.id&&activeNodeId?{nodeId:activeNodeId}:{})}));
    });
    setActiveUnitId(targetUnitId);
    setActiveSceneId(s.id);
    const targetView=viewMode==='board'||viewMode==='unit'?'board':'studio';setViewMode(targetView);
    updateUrlParams({view:targetView,unitId:targetUnitId,sceneId:s.id});
  };

  const handleAddUnit = () => {
    if (!project) return;
    if(project.profile.organization==='standalone'){
      toast.error('单部作品只有一个交付单元；可直接继续添加场景，或先在作品规格中改为分集。');
      return;
    }
    if(project.units.length>=1000){toast.error('单个作品最多规划 1000 集');return;}
    setAddingEpisode(true);
  };

  const handleDeleteScene = (targetUnitId: string, sceneId: string) => {
    if(!project)return;
    try{removeScriptScene(structuredClone(project),targetUnitId,sceneId);}
    catch(error){toast.error(error instanceof Error?error.message:'无法删除场景');return;}
    change(p=>{removeScriptScene(p,targetUnitId,sceneId);});
    if (activeSceneId === sceneId) {
      const remaining = activeUnit?.scenes.filter((s) => s.id !== sceneId);
      if (remaining && remaining[0]) {
        setActiveSceneId(remaining[0].id);
      }
    }
  };

  const handleMoveScene = (targetUnitId: string, sceneIndex: number, direction: 'up' | 'down') => {
    change((p) => {
      const u = p.units.find((u) => u.id === targetUnitId);
      if (!u) return;
      const targetIdx = direction === 'up' ? sceneIndex - 1 : sceneIndex + 1;
      if (targetIdx >= 0 && targetIdx < u.scenes.length) {
        if(u.scenes[sceneIndex].structureNodeId!==u.scenes[targetIdx].structureNodeId)throw new Error('跨段调整请在目录结构中移动整段');
        const temp = u.scenes[sceneIndex];
        u.scenes[sceneIndex] = u.scenes[targetIdx];
        u.scenes[targetIdx] = temp;
      }
    });
  };

  if (loading) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-bg-primary text-text-muted text-xs">
        <Sparkles size={16} className="animate-spin text-text-secondary mr-2" />
        <span>正在载入剧本工坊…</span>
      </main>
    );
  }

  const handleDeleteProject = async (id: string) => {
    try {
      await scriptClient.deleteProject(id);
      try { removeAllScriptDrafts(localStorage,id); } catch {}
      toast.success('剧本作品已删除');
      await loadList();
    } catch (e: any) {
      toast.error(e?.message || '删除作品失败');
    }
  };

  // Dedicated Works Library Page (Separate Page, No Modal)
  if (!project && isLibraryView) {
    return (
      <div className="flex h-full min-h-0 flex-col">
      {returnTo && <div className="flex shrink-0 items-center justify-between border-b border-border-primary/20 bg-bg-surface px-5 py-2 text-xs text-text-muted"><span>选择一份剧本后可返回原工作区并确认绑定</span><button type="button" onClick={() => navigate(returnUrl())} className="text-gold hover:underline">返回原工作区</button></div>}
      <ScriptProjectLibraryPage
        projects={projects}
        isLoading={loading}
        onOpen={(id) => {void navigate(projectUrl(id));}}
        onBackToHero={() => navigate(homeUrl)}
        onRefresh={() => {
          loadList().catch((e) => setError(e instanceof Error ? e.message : '加载列表失败'));
        }}
        onDeleteProject={handleDeleteProject}
      />
      </div>
    );
  }

  // Conversational Hero Home Page
  if (!project) {
    return (
      <div className="flex h-full min-h-0 flex-col">
      {returnTo && <div className="flex shrink-0 items-center justify-between border-b border-border-primary/20 bg-bg-surface px-5 py-2 text-xs text-text-muted"><span>创建或选择剧本后可返回原工作区并确认绑定</span><button type="button" onClick={() => navigate(returnUrl())} className="text-gold hover:underline">返回原工作区</button></div>}
      <ScriptLibrary
        projects={projects}
        error={error}
        onOpen={(id,view) => {void navigate(projectUrl(id, view));}}
        onOpenLibrary={() => navigate(libraryUrl)}
        onCreate={async (title, profile, initialBrief) => {
          const {project: created} = await scriptClient.createProject(title, profile, initialBrief);
          setAssistantInitialOperation(null);setAssistantSelection(undefined);setAssistantReviewSource(undefined);setAssistantFocusIssue('');
          setIsAssistantOpen(false);
          navigate(projectUrl(created.id, 'blueprint'));
          void loadList().catch(()=>{});
        }}
        onDeleteProject={handleDeleteProject}
      />
      </div>
    );
  }


  return (
    <main className="flex flex-col h-full w-full bg-bg-primary text-text-primary overflow-hidden select-none">
      {/* Top Application Bar */}
      <header className="min-h-14 px-5 py-2 border-b border-border-primary/20 bg-bg-surface flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0 max-lg:w-full">
          <button
            type="button"
            onClick={() => {
              if (!confirmLeave()) return;
              navigate(libraryUrl);
            }}
            title="返回作品库"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface-hover transition-colors"
          >
            <ArrowLeft size={16} />
          </button>

          {returnTo && <button type="button" disabled={returning} onClick={() => { void handleReturnToWorkspace(); }} className="rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">{returning ? '正在保存剧本…' : bindOnReturn ? '返回并绑定此剧本' : '返回上一工作区'}</button>}

          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-sm text-text-primary truncate">
              {project.title}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/25 shrink-0">
              {project.profile.workType}
            </span>
            {dirty && (
              <span className="text-[11px] text-accent-amber font-medium shrink-0 flex items-center gap-1">
                <span>●</span>
                <span>未保存</span>
              </span>
            )}
          </div>
        </div>

        <nav aria-label="作品内容" className="flex flex-wrap items-center p-1 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-xs">
          {([
            { view: 'blueprint', step: '1', label: '故事蓝图', icon: Compass },
            { view: 'outline', step: '2', label: '故事大纲', icon: BookOpen },
            { view: 'board', step: '3', label: '分场规划', icon: LayoutGrid },
            { view: 'studio', step: '4', label: '剧本正文', icon: Edit3 },
          ] as const).map(({ view, step, label, icon: Icon }, index) => {
            const active = viewMode === view || (view === 'board' && viewMode === 'unit');
            return (
              <React.Fragment key={view}>
                {index > 0 && <span className="text-text-muted/30 px-1 text-[11px] select-none font-medium">→</span>}
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setViewMode(view);
                    updateUrlParams({ view, unitId: activeUnit?.id || null, sceneId: activeScene?.id || null });
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                    active
                      ? 'bg-bg-surface text-text-primary font-semibold shadow-xs border border-border-primary/40'
                      : 'text-text-muted hover:text-text-primary border border-transparent'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                      active ? 'bg-text-primary text-bg-surface' : 'bg-bg-surface text-text-muted'
                    }`}
                  >
                    {step}
                  </span>
                  <Icon size={13} />
                  <span>{label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        {/* Writing stays primary; document utilities live in the project menu. */}
        <div className="flex items-center gap-2 max-lg:w-full max-lg:justify-end shrink-0">
          <button ref={assistantToggle} type="button" disabled={!editing} aria-expanded={isAssistantOpen} onClick={()=>setAssistantOpen(open=>!open)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border-primary/30 text-text-secondary hover:text-text-primary disabled:opacity-40"><Sparkles size={13}/>AI 助手</button>
          <details ref={projectMenu} className="relative">
            <summary className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-text-primary cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label="作品菜单">作品<ChevronDown size={13}/></summary>
            <div className="absolute right-0 top-full mt-2 z-50 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-border-primary/30 bg-bg-surface shadow-xl p-1.5 text-xs" onClick={()=>{if(projectMenu.current)projectMenu.current.open=false;}}>
              {project.originalMaterial&&<button type="button" onClick={()=>setIsOriginalOpen(true)} className="block w-full text-left px-3 py-2 rounded hover:bg-bg-surface-hover">查看带入的原文</button>}
              <div className="border-t border-border-primary/20 my-1"/>
              <ScriptExportActions project={project} localDraft={dirty}/>
            </div>
          </details>

          <span role="status" aria-live="polite" className="text-xs text-text-muted min-w-20 text-right">
            {!editing ? '另一页面正在编辑' : draftConflict || legacyRecoveries.length ? '待处理恢复内容' : saveError ? '保存失败' : saving || dirty ? '保存中…' : '已保存'}
          </span>
          {saveError && !draftConflict && <button type="button" disabled={saving || !editing} onClick={save} className="text-xs underline">重试保存</button>}

        </div>
      </header>
      {(!editing || draftConflict || draftStorageError || legacyRecoveries.length > 0 || saveError) && <div role="alert" className="shrink-0 border-b border-accent-amber/30 bg-bg-surface-soft px-5 py-3 text-xs text-text-primary flex flex-wrap items-center gap-3">
        {!editing && <span>此作品已在另一页面打开。该页面关闭后，这里会自动继续编辑。</span>}
        {draftConflict && <>
          <span>{draftConflict.message}</span>
          <button type="button" className="underline" onClick={() => downloadLocalScript(project, 'json')}>导出本机恢复内容</button>
          {recovery.current?.id === 'unread' && <button type="button" className="underline" onClick={() => {
            const raw = recovery.current?.raw; if (raw === undefined) return;
            const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = '本机原始恢复内容.json';
            link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
          }}>导出原始恢复内容</button>}
          {recovery.current && !sameScriptContent(recovery.current.project, project) && <button type="button" className="underline" onClick={() => { if (recovery.current) downloadLocalScript(recovery.current.project, 'json'); }}>导出另一页面恢复内容</button>}
          <button type="button" disabled={!editing} className="underline" onClick={async () => {
            if (!window.confirm('确认需要的恢复内容均已导出，并继续已保存的当前稿？')) return;
            try {
              const { project: server } = await scriptClient.getProject(project.id);
              if (current.current?.id !== server.id) return;
              coordinator.current?.dispose(); coordinator.current = null; editorGeneration.current++;
              if (recovery.current && !removeScriptRecoveryIfSame(localStorage, recovery.current)) throw new Error('另一页面已更新恢复内容，请先重新打开作品。');
              recovery.current = null; savedCurrent.current = server; current.current = server;
              setSaved(JSON.stringify(server)); setProject(server); conflictCurrent.current = null; setDraftConflict(null);
              saveErrorCurrent.current = ''; setSaveError(''); setSaving(false);
            } catch (error) { toast.error(error instanceof Error ? error.message : '读取当前稿失败'); }
          }}>继续已保存稿</button>
        </>}
        {draftStorageError && <><span>{draftStorageError}</span><button type="button" className="underline" onClick={() => downloadLocalScript(project, 'json')}>导出当前稿</button></>}
        {saveError && !draftConflict && <span>{saveError} 当前修改仍保留在本机恢复稿中。</span>}
        {legacyRecoveries.length > 0 && <div className="flex flex-wrap items-center gap-3">
          <span>旧版留下了不同恢复内容。请导出需要的内容，确认后继续当前稿；原缓存会保留。</span>
          {legacyRecoveries.map((item, index) => <button key={item.key} type="button" className="underline" onClick={() => downloadLocalScript(item.project, 'json')}>导出旧恢复内容 {index + 1}</button>)}
          <button type="button" disabled={!editing} className="underline" onClick={() => {
            try { for (const item of legacyRecoveries) acknowledgeLegacyScriptRecovery(localStorage, item); legacyCurrent.current = []; setLegacyRecoveries([]); }
            catch { toast.error('无法记录恢复处理结果，原内容仍保留。'); }
          }}>已处理，继续当前稿</button>
        </div>}
      </div>}

      <WorkflowReviewNotice key={`${project.id}:${project.revision}`} project={project} saved={saved} dirty={dirty} onOpen={notice=>{
        if(notice.unitId)setActiveUnitId(notice.unitId);
        setViewMode(notice.target);updateUrlParams({view:notice.target,...(notice.unitId?{unitId:notice.unitId}:{})});
      }}/>
      {addingEpisode&&<AddEpisodeDialog project={project} unitId={activeUnit?.id||project.units[0].id} onSuggest={(choice,preview)=>{
        const continuing=choice.kind.endsWith('continue'),source=project.units.find(u=>u.id===choice.sourceUnitId);
        setAddingEpisode(false);setAssistantRequest({id:++assistantRequestId.current,operation:'consult',stage:'OUTLINE',unitId:preview.unitId,discussionDraft:preview.project,
          label:`拟新增：${choice.title}`,text:`请讨论拟新增的「${choice.title}」，单集目标 ${Math.round((choice.targetDurationMs??project.profile.targetDurationMs)/6000)/10} 分钟。${continuing?`延续「${source?.title}」所属故事，依据相关前文实际落点。`:'这是新的独立故事，只用共用创作约定、人物和设定，不沿用其他故事的局部剧情。'}${choice.kind.startsWith('season_')?`新季名称「${choice.seasonTitle}」。`:''}当前是新增预览，尚未保存。先提出大纲安排和关系建议，不创建或修改分集。`});setAssistantOpen(true);setAssistantMode('step');
      }} onClose={()=>setAddingEpisode(false)} onApply={async preview=>{
        applyEpisodePreview(project,preview);
        const baseline=await saveForAction(true);if(!baseline)throw new Error('无法保存转换前内容');
        // Flush the current draft before applying the reviewed conversion.
        if(!sameScriptContent(baseline,project))throw new Error('保存期间原稿变化，请重新预览');
        const next={...preview.project,revision:baseline.revision,updatedAt:baseline.updatedAt};
        current.current=next;setProject(next);
        const created=await saveForAction(true);if(!created)throw new Error('无法保存新增内容');
        void loadList();setActiveUnitId(preview.unitId);setActiveSceneId(next.units.find(u=>u.id===preview.unitId)?.scenes[0]?.id||'');setActiveNodeId(undefined);setAddingEpisode(false);updateUrlParams({unitId:preview.unitId,nodeId:null,sceneId:next.units.find(u=>u.id===preview.unitId)?.scenes[0]?.id||null});
      }}/>}
      <p className="shrink-0 px-5 py-2 text-xs text-text-muted border-b border-border-primary/10">{viewMode==='blueprint'?'明确创作方向即可进入大纲；人物和设定可以边写边完善。':viewMode==='outline'?'整理事件、人物选择与因果；可以先推进当前集，其他集之后再细化。':viewMode==='board'||viewMode==='unit'?'把故事展开为场景序列，在这里调整节拍与节奏；准备好当前范围即可写正文。':'生成初稿后可通读、审阅和局部修改；初稿完成不等于最终定稿。'}</p>
      {/* Main Content Area: Decoupled Workspace Views */}
      <ScriptAnalysisContext.Provider value={analysisEntry?{...analysisEntry,project,onClose:closeAnalysis,onOpenScene:openAnalysisScene,onOpenOutline:openAnalysisOutline}:null}><ScriptDirectoryContext.Provider value={{open:treeOpen,drawer:workWidth<960,setOpen:open=>{setTreeOpen(open);if(open&&workWidth<960)setAssistantOpen(false);},outline:{choice:viewMode==='outline'?outlineChoice:'current',seasonId:outlineSeasonId,onSelect:(choice,seasonId)=>{setAnalysisEntry(null);setOutlineFocus(undefined);setOutlineChoice(choice);setOutlineSeasonId(seasonId);setOutlineTab('outline');setActiveNodeId(undefined);setViewMode('outline');updateUrlParams({view:'outline',nodeId:null});}}}}><div ref={workArea} inert={!editing || legacyRecoveries.length > 0 || recovery.current?.id === 'unread' ? true : undefined} data-sidebar-mode={workWidth<960?'drawer':'inline'} className="relative flex-1 flex min-h-0 overflow-hidden script-shared-layout">
      <div className={`flex-1 min-w-0 flex overflow-hidden ${viewMode==='studio'?'script-writing-layout':''}`}>
        {viewMode === 'blueprint' ? (
          /* View 1: Dedicated Pre-Production Blueprint View */
          <div className="flex-1 h-full overflow-hidden">
            <StoryBibleView
              project={project} activeUnitId={activeUnit?.id}
              onRequestTask={(operation,request,entity) => requestAssistant(operation,request,undefined,undefined,entity)}
              onSwitchToOutline={() => {setViewMode('outline');updateUrlParams({view:'outline'});}}
              defaultTab={blueprintTab}
              onUpdateProject={change}
              onSwitchToWriting={() => {
                setViewMode('studio');
                updateUrlParams({ view: 'studio' });
              }}
            />
          </div>
        ) : viewMode === 'outline' ? (
          /* View 2: Story Treatment & Episode Breakdown Outline View */
          <div className="flex-1 h-full overflow-hidden">
            <StoryOutlineView focus={outlineFocus} choice={outlineChoice} seasonId={outlineSeasonId} setChoice={(choice,seasonId)=>{setOutlineChoice(choice);if(choice==='season')setOutlineSeasonId(seasonId);}} tab={outlineTab} setTab={setOutlineTab}
              project={project} activeUnitId={activeUnit?.id} activeNodeId={activeNodeId}
              onSelectUnit={uId=>{const u=project.units.find(item=>item.id===uId);setActiveUnitId(uId);setActiveSceneId(u?.scenes[0]?.id||'');setActiveNodeId(undefined);updateUrlParams({unitId:uId,sceneId:u?.scenes[0]?.id||null,nodeId:null});}}
              onAddUnit={handleAddUnit}
              onSelectNode={nodeId=>{setActiveNodeId(nodeId);updateUrlParams({nodeId:nodeId||null});}}
              onUpdateProject={change}
              onUpdateUnit={updateUnit}
              onRequestTask={(operation,unitId,scopeId,nodeId,unitIndices,request) => requestAssistant(operation,request,unitId,undefined,undefined,scopeId,nodeId,undefined,unitIndices)}
              onRequestBeatChange={requestBeatChange}
              onSwitchToBlueprint={() => {
                setViewMode('blueprint');
                updateUrlParams({ view: 'blueprint' });
              }}
              onSwitchToBoard={(uId,sId) => {
                if(sId){openAnalysisScene(uId||activeUnit!.id,sId,{kind:'SCENE_PLAN'});return;}
                if (uId) setActiveUnitId(uId);
                setViewMode('board');
                updateUrlParams({ view: 'board', unitId: uId || activeUnit?.id||null });
              }}
            />
          </div>
        ) : viewMode === 'board' || viewMode === 'unit' ? (
          <ScenePlanningView focus={sceneFocus} project={project} unitId={activeUnit?.id||''} nodeId={activeNodeId} sceneId={activeSceneId}
            onUnit={uId=>{const u=project.units.find(item=>item.id===uId);setActiveUnitId(uId);setActiveSceneId(u?.scenes[0]?.id||'');setActiveNodeId(undefined);updateUrlParams({unitId:uId,sceneId:u?.scenes[0]?.id||null,nodeId:null});}}
            onNode={nodeId=>{setActiveNodeId(nodeId);updateUrlParams({nodeId:nodeId||null});}}
            onScene={(uId,sId)=>{setActiveUnitId(uId);setActiveSceneId(sId);updateUrlParams({unitId:uId,sceneId:sId});}}
            onChange={change} onUpdateUnit={updateUnit} onAddUnit={handleAddUnit} onAddScene={()=>handleAddScene(activeUnit!.id)}
            onWrite={()=>{setViewMode('studio');updateUrlParams({view:'studio'});}}
            onOutline={()=>{setViewMode('outline');updateUrlParams({view:'outline'});}}
            onRequest={(operation,request,sceneId)=>requestAssistant(operation,request,activeUnit?.id,undefined,undefined,undefined,sceneId?undefined:activeNodeId,sceneId)}
            onRequestBeatChange={requestBeatChange}
            onLocateOutline={source=>openAnalysisOutline(activeUnit!.id,source)}
            overview={closeOverview=><StoryGridBoard activeUnitId={activeUnit?.id} activeNodeId={activeNodeId}
            project={project}
            dirty={dirty}
            onApplied={applyAcceptedJob}
            onOpenScene={(uId, sId) => {
              setActiveUnitId(uId);
              setActiveSceneId(sId);
              setViewMode('studio');
              updateUrlParams({ view: 'studio', unitId: uId, sceneId: sId });
            }}
            onOpenUnitDetail={(uId) => {
              closeOverview();setActiveNodeId(undefined);setActiveSceneId(project.units.find(u=>u.id===uId)?.scenes[0]?.id||'');
              setActiveUnitId(uId);
              setViewMode('board');
              updateUrlParams({ view: 'board', unitId: uId,nodeId:null,sceneId:null });
            }}
            onUpdateUnit={updateUnit}
            onUpdateProject={change}
            onAddUnit={handleAddUnit}
            onAddScene={handleAddScene}
            onRequestPlan={(unitId) => requestAssistant('plan',undefined,unitId,undefined,undefined,undefined,unitId===activeUnit?.id?activeNodeId:undefined)}
            onRequestTask={(operation,unitId,sceneId)=>requestAssistant(operation,undefined,unitId,undefined,undefined,undefined,undefined,sceneId)}
            onSwitchToOutline={() => {
              setViewMode('outline');
              updateUrlParams({ view: 'outline' });
            }}
            onSwitchToWriting={() => {
              setViewMode('studio');
              updateUrlParams({ view: 'studio' });
            }}
          />}
          />
        ) : (
          /* View 3: Pure Three-Pane Immersive Writing Studio */
          <>
            {/* Left Column: Pure Story Outline & Scene Navigator */}
            <ScriptWorkDirectory project={project} unitId={activeUnit?.id||''} nodeId={activeNodeId} sceneId={activeScene?.id} showScenes
              onUnit={uId=>{setActiveUnitId(uId);setActiveNodeId(undefined);setActiveSceneId(project.units.find(u=>u.id===uId)?.scenes[0]?.id||'');updateUrlParams({unitId:uId,nodeId:null,sceneId:null});}}
              onNode={nodeId=>{setActiveNodeId(nodeId);updateUrlParams({nodeId:nodeId||null});}}
              onScene={(uId,sId)=>{setActiveUnitId(uId);setActiveSceneId(sId);updateUrlParams({unitId:uId,sceneId:sId});}} onAddUnit={handleAddUnit}/>

            {/* Middle Column: Screenplay Editor */}
            <div className="script-writing-editor script-analysis-anchor flex-1 min-w-0 h-full overflow-hidden flex flex-col">
              <div className="script-work-toolbar shrink-0"><button type="button" disabled={activeNodeId===UNASSIGNED_NODE} onClick={()=>handleAddScene(activeUnit!.id)}>新增场景</button>{activeScene&&<><button type="button" disabled={scenePosition<=0} onClick={()=>navigateScene(-1)}>上一场</button><button type="button" disabled={scenePosition<0||scenePosition>=rangeScenes.length-1} onClick={()=>navigateScene(1)}>下一场</button><button type="button" onClick={()=>handleDeleteScene(activeUnit!.id,activeScene.id)}>删除本场</button><button type="button" onClick={()=>requestAssistant('consult','请分析当前场景的结构与节奏，引用实际读取的正文与规划，提出修改建议。')}>分析结构与节奏</button></>}</div>
              {activeScene && activeUnit ? (
                <ScreenplayEditor
                  key={`${project.id}:${editorGeneration.current}:${activeScene.id}`}
                  project={project}
                  scene={activeScene}
                  characters={unitCharacters(project,activeUnit)}
                  onUpdateScene={updateScene}
                  onReadThrough={()=>setIsReadingOpen(true)}
                  onDiscuss={()=>requestAssistant('consult')}
                  onRegisterSpeaker={(name) => {change((draft) => {if(activeUnit&&activeScene)registerDialogueSpeaker(draft,activeUnit.id,activeScene.id,name);});}}
                  onRequestTextTask={(selection,request)=>requestAssistant('text_rewrite',request,undefined,selection)}
                  onRequestSceneTask={() => requestAssistant('scene')}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted text-xs">
                  <p>请在左侧选择场景开始写作</p>
                </div>
              )}
              <ScriptAnalysisOutlet/>
            </div>


          </>
        )}
      </div>


      {activeUnit&&editing&&<aside aria-label="AI 助手" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeAssistant();}}} hidden={!isAssistantOpen} className="script-assistant-sidebar">
        <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-bg-surface">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-bg-surface-soft flex items-center justify-center text-text-primary">
              <Sparkles size={13} />
            </div>
            <strong className="text-sm font-medium text-text-primary tracking-tight">剧作 AI 助手</strong>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-bg-surface-soft text-text-muted">Copilot</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" title="时长估算" aria-label="时长估算" className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors" onClick={()=>setIsTimingOpen(true)}>
              <Clock size={15}/>
            </button>
            <button type="button" title="连续性检查" aria-label="连续性检查" className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors" onClick={()=>setIsRadarOpen(true)}>
              <Radar size={15}/>
            </button>
            <button type="button" title="收起助手" aria-label="收起助手" className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors" onClick={closeAssistant}>
              <X size={15}/>
            </button>
          </div>
        </div>
        <div className="script-assistant-body">
          <div className="h-full min-h-0">
            <ScriptDurablePanel key={project.id} visible={isAssistantOpen} request={assistantRequest}
              onRequestAgent={()=>setAssistantMode('agent')} onAgentStarted={()=>setAssistantMode('step')}
              legacyHistory={<>
                <ScriptDiscussion project={project} onRequest={question=>requestAssistant('consult',question)}/>
                {activeUnit&&<details><summary>更早的任务与提案</summary>
                  <ScriptAssistant historyOnly project={project} unit={activeUnit} scene={activeScene} dirty={dirty}
                    onSave={save} onApplied={applyAcceptedJob} onReviewScene={openReviewFinding}
                    onOpenScene={sceneId=>{setActiveSceneId(sceneId);setViewMode('studio');updateUrlParams({view:'studio',sceneId});}}/>
                </details>}
              </>}
              legacyContent={assistantInitialOperation&&(!(assistantInitialOperation in durableStep)||Boolean(assistantReviewSource))&&assistantInitialOperation!=='consult'&&legacyUnit?
                <div className="space-y-3">
                  <button type="button" onClick={()=>setAssistantInitialOperation(null)}>收起专项任务</button>
                  <ScriptAssistant key={legacySubmission?.id} submission={legacySubmission} unitIndices={legacyTarget?.unitIndices} project={project} unit={legacyUnit} scene={legacyScene}
                    dirty={dirty} onSave={save} onApplied={applyAcceptedJob} onReviewScene={openReviewFinding}
                    onOpenScene={sceneId=>{const u=project.units.find(item=>item.scenes.some(s=>s.id===sceneId));if(u){
                      setActiveUnitId(u.id);setActiveSceneId(sceneId);setViewMode('studio');updateUrlParams({view:'studio',unitId:u.id,sceneId});setAssistantOpen(false);
                    }}}
                    initialOperation={assistantInitialOperation} initialIssue={assistantFocusIssue} initialReviewSource={assistantReviewSource}
                    initialSelection={assistantInitialOperation==='text_rewrite'?assistantSelection:undefined}/>
                </div>:null}
              onLegacyRequest={(request,channel,methodIds)=>{
                setAssistantReviewSource(undefined);setLegacySubmission({id:Date.now(),channel,methodIds:methodIds.map(id=>`skill:${id}`)});setLegacyTarget({unitId:request.unitId,sceneId:request.sceneId,unitIndices:request.unitIndices});
                setAssistantInitialOperation(request.operation||'consult');setAssistantFocusIssue(request.text);setAssistantSelection(request.selection);
              }}
              initialStage={viewMode==='blueprint'?'BLUEPRINT':viewMode==='outline'?'OUTLINE':viewMode==='board'||viewMode==='unit'?'SCENES':'BODY'}
              mode={assistantMode==='agent'?'agent':'manual'} project={project} unit={activeUnit} scene={activeScene}
              dirty={dirty} onSave={save} onSaveForAction={async()=>{const next=await saveForAction(true);if(!next)throw new Error('没有可保存的作品');return next;}} onApplied={applyAcceptedJob}
              onOpenAnalysis={entry=>{
                analysisReturnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
                analysisReturnAssistant.current=workWidth<960&&isAssistantOpen;
                if(workWidth<960)setAssistantOpen(false);
                analysisOrigin.current=JSON.stringify([viewMode==='blueprint'?'outline':viewMode,activeUnitId,activeSceneId,activeNodeId,outlineChoice,outlineSeasonId]);
                setBodyFocus(undefined);setSceneFocus(undefined);setOutlineFocus(undefined);
                setAnalysisEntry({...entry,onRequest:(next,source)=>{openAnalysisRequest(next,source);setAssistantOpen(true);entry.onRequest(next,source);},
                  onRepair:entry.onRepair?(target,instruction,source)=>{openAnalysisRequest({...target,stage:target.sceneId?'SCENES':'OUTLINE'},source);setAssistantOpen(true);entry.onRepair!(target,instruction,source);}:undefined});
                if(viewMode==='blueprint'){setViewMode('outline');updateUrlParams({view:'outline'});}
              }}
              onOpenScene={openAnalysisScene}
              onOpenUpdated={target=>{
                if(target.outlineFocus){openAnalysisOutline(target.unitId||activeUnit.id,target.outlineFocus);return;}
                if(target.sceneId&&target.unitId){openAnalysisScene(target.unitId,target.sceneId,target.sceneSource??{kind:target.view==='board'?'SCENE_PLAN':'BODY_BLOCK'});return;}
                setAnalysisEntry(null);if(target.unitId)setActiveUnitId(target.unitId);setActiveNodeId(target.nodeId);setViewMode(target.view);
                updateUrlParams({view:target.view,unitId:target.unitId||activeUnit.id,sceneId:null,nodeId:target.nodeId||null});
              }}
              initialGoal={agentLaunch?.goal||(assistantInitialOperation==='review'?assistantFocusIssue:undefined)}
              initialTask={agentLaunch?.strategy?.startsWith('review')||assistantInitialOperation==='review'?'REVIEW':'WRITE'}
              initialOperation={assistantInitialOperation?durableStep[assistantInitialOperation]:undefined}
              initialInstruction={assistantFocusIssue} initialSelection={assistantInitialOperation==='text_rewrite'?assistantSelection:undefined}/>

          </div>

        </div>
      </aside>}
      </div></ScriptDirectoryContext.Provider></ScriptAnalysisContext.Provider>

      <Modal isOpen={isOriginalOpen} onClose={()=>setIsOriginalOpen(false)} title="带入的原文" size="lg">
        <p className="text-xs text-text-muted mb-3">这是创建时保存的输入原件。当前写作以正文和故事资料为准。</p>
        <pre className="whitespace-pre-wrap break-words text-sm select-text">{project.originalMaterial?.text}</pre>
        <button type="button" className="mt-4 text-sm underline" onClick={()=>{
          const url=URL.createObjectURL(new Blob([project.originalMaterial?.text||''],{type:'text/plain;charset=utf-8'}));
          const a=document.createElement('a');a.href=url;a.download='起笔原文.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }}>下载原文</button>
      </Modal>
      {/* Continuity Radar Drawer Modal */}
      <Modal isOpen={isReadingOpen} onClose={()=>setIsReadingOpen(false)} title={project.profile.organization==='standalone'?'全片连读':'本集连读'} size="xl">
        {isReadingOpen&&activeUnit&&<ScriptReadThrough project={project} initialUnitId={activeUnit.id} dirty={dirty} onOpenScene={openAnalysisScene}/>}
      </Modal>
      <ContinuityRadarModal
        onChange={change} onSave={save} dirty={dirty} saving={saving}
        isOpen={isRadarOpen}
        onClose={() => setIsRadarOpen(false)}
        project={project}
        activeUnitId={activeUnitId}
        onRequestReview={unitId=>{setActiveUnitId(unitId);setAgentLaunch({strategy:'review_all',goal:'检查本单元已写正文的动作、道具位置、人物知情和时间衔接。引用具体原文作为依据，区分规划和已发生事实。尊重留白与作者意图，不把未登记线索当作必需回收。每批说明实际检查范围，不检查未提供的正文。'});setIsRadarOpen(false);setIsAgentOpen(true);}}
        onOpenScene={(uId, sId) => {
          setActiveUnitId(uId);
          setActiveSceneId(sId);
          setIsRadarOpen(false);
          setViewMode('studio');
        }}
      />

      {/* Script Timing & Pacing Modal */}
      {isTimingOpen && activeUnit && (
        <Modal
          isOpen={isTimingOpen}
          onClose={() => setIsTimingOpen(false)}
          title="时长与节奏评估 (Script Timing)"
          size="lg"
        >
          <div className="p-2 text-xs">
            <ScriptTiming
              project={project}
              unit={activeUnit}
              sceneId={activeScene?.id}
              onChange={(editFn) => change((p) => {
                const u = p.units.find((x) => x.id === activeUnit.id);
                if (u) editFn(u);
              })}
              onProfileChange={(val) => change((p) => { p.profile.includeCredits = val; })}
              onOpenScene={(sId) => {
                setActiveSceneId(sId);
                setIsTimingOpen(false);
                setViewMode('studio');
              }}
              onNotice={(msg) => toast.success(msg)}
            />
          </div>
        </Modal>
      )}
    </main>
  );
}
