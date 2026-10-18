import { useScriptSkills } from '../useScriptSkills';
import { useSettingsStore } from '../../../clients/stateClient';
import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2, Sparkles, 
  Check, X, RefreshCw, Flame, ArrowRight, Layers, Edit3, 
  AlertTriangle, CheckCircle2, Wand2, Compass, LayoutGrid, Clock,
  Users, MapPin, Sun, Moon, ArrowUp, ArrowDown
} from 'lucide-react';
import type { ScriptProject, DeliveryUnit, Scene, ScriptOperation } from '../../../../../../packages/script/src/schema';
import { unitCharacters } from '../../../../../../packages/script/src/continuity';
import { newId, newScene, removeScriptScene } from '../../../../../../packages/script/src/project';
import { availableMethods, buildScriptTaskContext, OPERATION_LABELS } from '../../../../../../packages/script/src/methods';
import type { ScriptJob } from '../../../../../../packages/script/src/proposals';
import { generateAIContent } from '../../../clients/aiClient';
import { scriptClient } from '../../../clients/scriptClient';
import { withManualAIResult } from '../../../clients/manualAIClient';
import { boardAdviceBody } from './boardAdviceContext';
import toast from 'react-hot-toast';
import {ScriptUnitSettings} from './ScriptUnitSettings';

interface Props {
  project: ScriptProject;onRequestTask?:(operation:ScriptOperation,unitId?:string,sceneId?:string)=>void;
  unitId: string;
  dirty:boolean;
  onApplied:(project:ScriptProject,base:ScriptProject)=>void;
  onUpdateUnit: (unit: DeliveryUnit) => void;
  onUpdateProject?: (updater: (draft: ScriptProject) => void) => void;
  onOpenScene: (unitId: string, sceneId: string) => void;
  onBackToBoard: () => void;
  onSwitchUnit: (unitId: string) => void;
  onSwitchToWriting: () => void;
}

interface BeatRecomOption {
  title: string;
  subtitle?: string;
  content: string;
  extra?: any;
}

interface BeatRecomState {
  isOpen: boolean;
  type: 'cliffhanger' | 'scene_turn';
  targetSceneId?: string;
  title: string;
  description: string;
  isLoading: boolean;
  options: BeatRecomOption[];
  base?: string;
  job?:ScriptJob;
}

export function EpisodeBeatView({
  project,onRequestTask,
  unitId,
  dirty,
  onApplied,
  onUpdateUnit,
  onUpdateProject,
  onOpenScene,
  onBackToBoard,
  onSwitchUnit,
  onSwitchToWriting,
}: Props) {
  const isMicroDrama = project.profile.workType.includes('短剧');

  // Find Current Unit and Neighbors
  const currentUnitIndex = project.units.findIndex((u) => u.id === unitId);
  const unit = currentUnitIndex >= 0 ? project.units[currentUnitIndex] : project.units[0];
  const prevUnit = currentUnitIndex > 0 ? project.units[currentUnitIndex - 1] : null;
  const nextUnit = currentUnitIndex < project.units.length - 1 ? project.units[currentUnitIndex + 1] : null;

  // Selected Scene for Master-Detail (Left List -> Right Detail)
  const isTestMode=useSettingsStore(state=>state.isTestMode);
  const [selectedSceneId, setSelectedSceneId] = useState<string>(unit?.scenes[0]?.id || '');

  // Keep selectedSceneId in sync when unit changes
  useEffect(() => {
    if (unit && unit.scenes.length > 0) {
      if (!unit.scenes.some((s) => s.id === selectedSceneId)) {
        setSelectedSceneId(unit.scenes[0].id);
      }
    }
  }, [unit?.id]);

  // AI Modal State
  const [recomState, setRecomState] = useState<BeatRecomState>({
    isOpen: false,
    type: 'cliffhanger',
    title: '',
    description: '',
    isLoading: false,
    options: [],
  });
  const [adviceJobs,setAdviceJobs]=useState<ScriptJob[]>([]);
  const [methodIds,setMethodIds]=useState<string[]>([]);
  const unitIdRef=useRef(unitId);
  unitIdRef.current=unitId;
  const {methods:sharedMethods,error:skillsError}=useScriptSkills();
  const skillProject={...project,methods:sharedMethods};
  const suggestionMethods=sharedMethods;
  useEffect(()=>setMethodIds(ids=>ids.filter(id=>suggestionMethods.some(method=>method.id===id))),[project.id,sharedMethods]);
  useEffect(()=>{let active=true;scriptClient.listBoardSuggestionJobs(project.id).then(({jobs})=>{if(active)setAdviceJobs(jobs.filter(job=>job.unitId===unitId&&(job.operation==='ending'||job.operation==='scene_turn')));}).catch(error=>{if(active)toast.error(error instanceof Error?error.message:'无法读取分场建议记录');});return()=>{active=false;};},[project.id,project.revision,unitId]);
  const refreshAdviceJobs=async()=>setAdviceJobs((await scriptClient.listBoardSuggestionJobs(project.id)).jobs.filter(job=>job.unitId===unitIdRef.current&&(job.operation==='ending'||job.operation==='scene_turn')));
  useEffect(()=>setRecomState(prev=>({...prev,isOpen:false})),[unitId]);

  if (!unit) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
        <p className="text-text-muted text-sm">未能定位到该集数数据</p>
        <button
          type="button"
          onClick={onBackToBoard}
          className="px-4 py-2 rounded-xl bg-text-primary text-bg-surface hover:opacity-90 transition-all text-xs font-medium cursor-pointer shadow-xs"
        >
          返回分场规划
        </button>
      </div>
    );
  }

  const activeScene = unit.scenes.find((s) => s.id === selectedSceneId) || unit.scenes[0];
  const activeSceneIndex = unit.scenes.findIndex((s) => s.id === (activeScene?.id || ''));

  const totalWords = unit.scenes.reduce(
    (acc, s) =>
      acc + s.blocks.reduce((bAcc, b) => bAcc + (b.text || '').replace(/\s/g, '').length, 0),
    0
  );
  const hasCliffhanger = Boolean(unit.endingHook?.trim());
  const turnsCount = unit.scenes.filter((s) => s.entryState && s.exitState).length;

  // -------------------------------------------------------------
  // Unit & Scene Handlers
  // -------------------------------------------------------------
  const handleAddScene = () => {
    const sc = newScene(`第 ${unit.scenes.length + 1} 场`);
    onUpdateUnit({
      ...unit,
      scenes: [...unit.scenes, sc],
    });
    setSelectedSceneId(sc.id);
    toast.success(`已添加「${sc.title}」`);
  };

  const handleDeleteScene = (sceneId: string, sceneTitle: string) => {
    const preview=structuredClone(project);
    let removedTiming=0;
    try{removedTiming=removeScriptScene(preview,unit.id,sceneId);}
    catch(error){toast.error(error instanceof Error?error.message:'无法删除场景');return;}
    if (window.confirm(`确定删除场景「${sceneTitle}」？${removedTiming?`同时删除关联的 ${removedTiming} 条时长安排。`:''}连续性证据会保留并提示复核；删除后将更新当前稿。`)) {
      const remaining=preview.units.find(item=>item.id===unit.id)!;
      onUpdateUnit(remaining);
      if (selectedSceneId === sceneId && remaining.scenes[0]) {
        setSelectedSceneId(remaining.scenes[0].id);
      }
      toast.success(`已删除「${sceneTitle}」`);
    }
  };

  const handleMoveScene = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= unit.scenes.length) return;

    const newScenes = [...unit.scenes];
    const temp = newScenes[index];
    newScenes[index] = newScenes[targetIndex];
    newScenes[targetIndex] = temp;

    onUpdateUnit({
      ...unit,
      scenes: newScenes,
    });
  };

  // -------------------------------------------------------------
  // AI Recommendation Handlers
  // -------------------------------------------------------------
  const runAdvice=async(operation:'ending'|'scene_turn',scene:Scene|undefined,title:string,description:string,basePrompt:string)=>{
    if(dirty){toast.error('先保存当前稿，再生成建议。');return;}
    const selectedMethodIds=methodIds.filter(id=>availableMethods(skillProject,operation).some(method=>method.id===id));
    const task=buildScriptTaskContext(skillProject,unit,operation,selectedMethodIds,scene?.id);
    const prompt=`${basePrompt}\n\n本次选用的 Skill：\n${task.instructions}${task.inputs.length?`\n本次 Skill 要求的辅助资料：\n${JSON.stringify({seasons:task.context.seasons,storylines:task.context.storylines,continuity:task.context.continuity})}`:''}`;
    setRecomState({isOpen:true,type:operation==='ending'?'cliffhanger':'scene_turn',targetSceneId:scene?.id,title,description,isLoading:true,options:[],base:JSON.stringify(project)});
    let job:ScriptJob|undefined;
    try{
      job=(await scriptClient.createJob(skillProject,unit.id,scene?.id||unit.id,operation,prompt,undefined,selectedMethodIds)).job;
      await refreshAdviceJobs();
      let provenance:ScriptJob['provenance'];
      let executionPrompt:ScriptJob['executionPrompt'];
      const raw=await generateAIContent({prompt:job.prompt,systemInstruction:'尊重作者已有内容。严格输出合法 JSON 对象。',requireJson:true,taskType:'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};},onExecutionProvenance:value=>{provenance={source:value.source,provider:value.provider,modelId:value.modelId};}});
      job=(await scriptClient.submitJob(job,raw,provenance||{source:'api',provider:'unknown_api',modelId:'unknown'},executionPrompt)).job;
      await refreshAdviceJobs();
      if(job.status==='failed')throw new Error(job.error||'建议未通过校验');
      if(unitIdRef.current===unit.id)setRecomState(prev=>({...prev,isLoading:false,options:job!.result!.choices||[],job}));
    }catch(error){
      if(job?.status==='waiting')await scriptClient.failJob(job,error instanceof Error?error.message:'模型调用未完成').catch(()=>{});
      await refreshAdviceJobs().catch(()=>{});
      toast.error(error instanceof Error?error.message:'生成建议失败');
      if(unitIdRef.current===unit.id)setRecomState(prev=>({...prev,isLoading:false}));
    }
  };
  const handleOpenCliffhanger = async () => {
    if(onRequestTask){setRecomState(prev=>({...prev,isOpen:false}));onRequestTask('ending',unitId);return;}
    const scenesSummary = unit.scenes
      .map((s, idx) => `场${idx + 1}【${s.title}】：${s.purpose || '无'}（${s.entryState || '入场'} → ${s.exitState || '出场'}）`)
      .join('\n');

    const prompt = `你是尊重作者目标的剧本编辑。
当前作品：《${project.title}》（体裁：${project.profile.workType}，题材：${project.profile.genres.join('/') || '通用'}）
故事核心前提：${project.brief.concept || '暂未设定'}
作者写下的主题：${project.brief.theme || '暂未设定'}
当前处理集数：${unit.title}
已有场次规划：
${scenesSummary || '暂无明确场次'}
已有结尾安排：${unit.endingHook || '暂无'}
最近 ${Math.min(2,unit.scenes.length)} 场的已写正文（其余场只参考上述规划）：
${boardAdviceBody(project,unit.scenes.slice(-2))}

请根据已经写下的剧情提出 3 种不同的本集结尾。可以是问题、行动、关系变化、情绪落点或阶段性完成；不要强加危机、反转或悬念。各方案需和已有场景衔接，说明具体发生什么。

请严格仅输出合法 JSON 对象，不要包含任何额外说明：
{"summary":"三种结尾的差异与依据","choices":[
  { "title": "方案一", "subtitle": "这一种结尾的作用", "content": "具体发生什么" },
  { "title": "方案二", "subtitle": "与方案一不同的表达", "content": "具体发生什么" },
  { "title": "方案三", "subtitle": "另一种可行的结尾", "content": "具体发生什么" }
]}`;

    await runAdvice('ending',unit.scenes[0],`「${unit.title}」结尾安排建议`,'提供几种不同的结尾方式供你选择；可以留下悬念，也可以让这一集平静结束。',prompt);
  };

  const handleOpenSceneTurn = async (scene: Scene) => {
    if(onRequestTask){setRecomState(prev=>({...prev,isOpen:false}));onRequestTask('scene_turn',unitId,scene.id);return;}
    const prompt = `你是尊重作者风格的剧本编辑。
当前作品：《${project.title}》（${project.profile.workType}）
所属集数：${unit.title}（本集结尾安排：${unit.endingHook || '未定'}）
当前场景标题：${scene.title}
本场发生的事：${scene.purpose || '未填写'}
当前入场状态：${scene.entryState || '未填写'}
当前出场状态：${scene.exitState || '未填写'}
本场已写正文：
${boardAdviceBody(project,[scene])}
相邻场景规划：${unit.scenes[unit.scenes.findIndex(item=>item.id===scene.id)-1]?.purpose||'前一场未规划'} → ${unit.scenes[unit.scenes.findIndex(item=>item.id===scene.id)+1]?.purpose||'后一场未规划'}

请给出 3 种有具体事件支撑的场景推进方案。变化可以是行动、关系、认知、信息或气氛；无需强行反转。不要改变已有正文。

请严格仅输出合法 JSON 对象：
{"summary":"方案差异与依据","choices":[
  {
    "title": "方案一",
    "subtitle": "这一方案的作用",
    "content": "本场发生的具体事件",
    "extra": {
      "purpose": "本场发生什么",
      "entryState": "入场状况，可留空",
      "exitState": "结束时的变化，可留空"
    }
  }
]}`;

    await runAdvice('scene_turn',scene,`「${scene.title}」场景变化建议`,'查看这场戏如何推动行动、关系、认知或气氛；不要求每一场都发生正负翻转。',prompt);
  };

  const handleApplyRecommendation = async (choiceIndex:number) => {
    if(recomState.base!==JSON.stringify(project)){toast.error('作品已改变，请重新生成与当前稿对应的建议。');return;}
    if(dirty||!recomState.job||recomState.job.status!=='ready'||recomState.job.baseRevision!==project.revision){toast.error('先保存当前稿，并确认建议仍基于正式稿。');return;}
    try{
      const accepted=await scriptClient.transitionJob(recomState.job,'approve',choiceIndex);
      if(!accepted.project)throw new Error('采用后未返回当前稿');
      onApplied(accepted.project,project);
      await refreshAdviceJobs();
    }catch(error){toast.error(error instanceof Error?error.message:'采用建议失败');return;}
    setRecomState((prev) => ({ ...prev, isOpen: false }));
  };
  const openAdviceJob=(job:ScriptJob)=>{
    if(!job.result?.choices?.length)return;
    setRecomState({isOpen:true,type:job.operation==='ending'?'cliffhanger':'scene_turn',targetSceneId:job.sceneId,title:`已保存的${OPERATION_LABELS[job.operation]}`,description:job.status==='ready'&&job.baseRevision===project.revision?'审阅后可采用；已有正文会保留。':'此记录仅供查阅，不能再次采用。',isLoading:false,options:job.result.choices,base:JSON.stringify(project),job});
  };
  const recoverAdviceJob=async(job:ScriptJob)=>{
    if(dirty||job.baseRevision!==project.revision){toast.error('先保存当前稿，并确认任务基线与正式稿一致。');return;}
    setRecomState({isOpen:true,type:job.operation==='ending'?'cliffhanger':'scene_turn',targetSceneId:job.sceneId,title:`补交${OPERATION_LABELS[job.operation]}`,description:'使用原提示词手动回填本次返回。',isLoading:true,options:[],base:JSON.stringify(project),job});
    try{
      let executionPrompt:ScriptJob['executionPrompt'];
      const raw=await withManualAIResult('',undefined,()=>generateAIContent({prompt:job.prompt,requireJson:true,taskType:'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};}}),false,true);
      const {job:updated}=await scriptClient.submitJob(job,raw,{source:'manual_external',provider:'manual_external',modelId:'manual_external'},executionPrompt);
      await refreshAdviceJobs();
      if(updated.status==='failed')throw new Error(updated.error||'建议未通过校验');
      if(unitIdRef.current===job.unitId)setRecomState(prev=>({...prev,isLoading:false,options:updated.result?.choices||[],job:updated}));
    }catch(error){
      if(job.status==='waiting')await scriptClient.failJob(job,error instanceof Error?error.message:'模型调用未完成').catch(()=>{});
      await refreshAdviceJobs().catch(()=>{});
      toast.error(error instanceof Error?error.message:'补交建议失败');
      if(unitIdRef.current===job.unitId)setRecomState(prev=>({...prev,isLoading:false}));
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-bg-primary overflow-hidden select-none">
      {/* ========================================================= */}
      {/* 1. TOP HEADER: NAVIGATION & EPISODE SWITCHER              */}
      {/* ========================================================= */}
      <header className="px-6 py-3 border-b border-border-primary/20 bg-bg-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Back to Board & Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBackToBoard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft border border-border-primary/30 transition-all cursor-pointer shadow-xs"
          >
            <ArrowLeft size={14} />
            <span>返回分场规划</span>
          </button>

          <div className="h-4 w-px bg-border-primary/20 mx-1" />

          {/* Episode Switcher with Prev / Next */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!prevUnit}
              onClick={() => prevUnit && onSwitchUnit(prevUnit.id)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface-soft border border-border-primary/20 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer"
              title={prevUnit ? `上一集：${prevUnit.title}` : '已是第一集'}
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-bg-surface-soft border border-border-primary/20">
              <span className="px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-bg-surface text-text-secondary border border-border-primary/30">
                EP {String(currentUnitIndex + 1).padStart(2, '0')}
              </span>
              <input
                type="text"
                value={unit.title}
                onChange={(e) => onUpdateUnit({ ...unit, title: e.target.value })}
                className="text-xs font-bold text-text-primary bg-transparent focus:outline-none border-b border-transparent focus:border-border-primary/40 px-0.5 w-36 truncate"
                placeholder="输入本集标题..."
              />
            </div>

            <button
              type="button"
              disabled={!nextUnit}
              onClick={() => nextUnit && onSwitchUnit(nextUnit.id)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface-soft border border-border-primary/20 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer"
              title={nextUnit ? `下一集：${nextUnit.title}` : '已是最后一集'}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="text-[11px] text-text-muted font-mono pl-2 hidden md:inline">
            {unit.scenes.length} 场 · {unit.scenes.filter(s => s.blocks.some(b => b.type !== 'note' && b.text.trim())).length} 场有正文 · 约 {totalWords} 字
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {skillsError&&<p role="alert" className="text-xs text-accent-amber">{skillsError}</p>}
          {!onRequestTask&&suggestionMethods.length>0&&<details className="relative text-xs">
            <summary className="cursor-pointer px-3 py-1.5 rounded-xl bg-bg-surface-soft border border-border-primary/30 text-text-secondary">本次 Skill（{methodIds.length}）</summary>
            <div className="absolute right-0 z-20 mt-1 min-w-52 max-w-72 max-h-52 overflow-auto rounded-xl border border-border-primary/30 bg-bg-surface p-3 shadow-xl space-y-2">
              <p className="text-text-muted">仅在适用的建议任务中启用</p>
              {suggestionMethods.map(method=><label key={method.id} className="flex items-start gap-2"><input type="checkbox" checked={methodIds.includes(method.id)} onChange={()=>setMethodIds(ids=>ids.includes(method.id)?ids.filter(id=>id!==method.id):[...ids,method.id])}/><span>{method.title} · v{method.version}</span></label>)}
            </div>
          </details>}
          <button
            type="button"
            onClick={handleAddScene}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft text-text-secondary hover:text-text-primary hover:bg-bg-surface border border-border-primary/30 transition-all cursor-pointer"
          >
            <Plus size={14} />
            <span>添加新场景</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeScene) {
                onOpenScene(unit.id, activeScene.id);
              } else if (unit.scenes[0]) {
                onOpenScene(unit.id, unit.scenes[0].id);
              }
              onSwitchToWriting();
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all shadow-xs cursor-pointer"
          >
            <Edit3 size={13} />
            <span>进入剧本写作 ✍️</span>
          </button>
        </div>
      </header>

      {adviceJobs.length>0&&<details className="shrink-0 px-6 py-2 border-b border-border-primary/10 bg-bg-surface text-xs">
        <summary className="cursor-pointer text-text-secondary">本集建议任务记录（{adviceJobs.length}）</summary>
        <div className="mt-2 max-h-40 overflow-auto space-y-2">{adviceJobs.map(job=><div key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-primary/20 p-2">
          <span>{OPERATION_LABELS[job.operation]} · 版本 {job.baseRevision} · {{waiting:'等待返回',ready:'待审阅',failed:'返回需修正',approved:'已采用',rejected:'已放弃',cancelled:'已取消'}[job.status]}</span>
          {job.error&&<span className="text-text-muted">{job.error}</span>}
          {job.result&&<button type="button" onClick={()=>openAdviceJob(job)}>查看{job.status==='ready'?'建议':'记录'}</button>}
          {isTestMode&&['waiting','failed'].includes(job.status)&&<button type="button" disabled={dirty||job.baseRevision!==project.revision} onClick={()=>void recoverAdviceJob(job)}>手动补交返回</button>}
        </div>)}</div>
      </details>}

      {/* ========================================================= */}
      {onUpdateProject&&<ScriptUnitSettings project={project} unit={unit} onUpdate={onUpdateProject}/>}
      {/* 2. MASTER-DETAIL WORKBENCH: COMPACT LEFT LIST, GRID RIGHT */}
      {/* ========================================================= */}
      <div className="script-beat-columns flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT COLUMN: SCENE STREAM (COMPACT MASTER LIST) */}
        <div className="script-beat-directory w-64 md:w-72 h-full flex flex-col border-r border-border-primary/20 bg-bg-surface shrink-0">
          {/* List Header */}
          <div className="px-3.5 py-2.5 border-b border-border-primary/10 flex items-center justify-between bg-bg-surface-soft/40">
            <div className="flex items-center gap-1.5">
              <Layers size={13} className="text-text-secondary" />
              <span className="text-xs font-bold text-text-primary">本集场景顺序</span>
              <span className="text-[10px] font-mono text-text-muted">({unit.scenes.length} 场)</span>
            </div>

            <button
              type="button"
              onClick={handleAddScene}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <Plus size={12} />
              <span>加场</span>
            </button>
          </div>

          {/* List Scroll Area */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {unit.scenes.map((scene, sceneIdx) => {
              const isSelected = scene.id === activeScene?.id;
              const sceneCharCount = scene.blocks.reduce(
                (acc, b) => acc + (b.text || '').replace(/\s/g, '').length,
                0
              );
              const hasTurn = Boolean(scene.entryState && scene.exitState);
              const hasPurpose = Boolean(scene.purpose && scene.purpose.trim().length > 3);

              return (
                <React.Fragment key={scene.id}>
                  <div
                    onClick={() => setSelectedSceneId(scene.id)}
                    className={`group p-2.5 rounded-xl border transition-all cursor-pointer relative space-y-1.5 ${
                      isSelected
                        ? 'bg-bg-surface border-border-primary/60 ring-1 ring-border-primary/40 shadow-xs'
                        : 'bg-bg-surface-soft/40 hover:bg-bg-surface-soft border-border-primary/15 hover:border-border-primary/30'
                    }`}
                  >
                    {/* Scene Card Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                        <span
                          className={`font-mono text-[9px] font-medium px-1.5 py-0.5 rounded ${
                            isSelected
                              ? 'bg-text-primary text-bg-surface'
                              : 'bg-bg-surface-soft text-text-muted border border-border-primary/25'
                          }`}
                        >
                          #{sceneIdx + 1}
                        </span>
                        <span className="text-xs font-bold text-text-primary truncate">
                          {scene.title || '未命名场景'}
                        </span>
                      </div>

                      {/* Scene Word Count & Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono text-text-muted">
                          {sceneCharCount > 0 ? `${sceneCharCount}字` : '空'}
                        </span>

                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                          <button
                            type="button"
                            disabled={sceneIdx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveScene(sceneIdx, 'up');
                            }}
                            className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20"
                            title="上移"
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={sceneIdx === unit.scenes.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveScene(sceneIdx, 'down');
                            }}
                            className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20"
                            title="下移"
                          >
                            <ArrowDown size={11} />
                          </button>
                          {unit.scenes.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteScene(scene.id, scene.title);
                              }}
                              className="p-0.5 text-text-muted hover:text-accent-red"
                              title="删除"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Preview of Want (Purpose) */}
                    <div className="text-[10px] text-text-secondary truncate leading-tight">
                      {hasPurpose ? (
                        <span>🎯 {scene.purpose}</span>
                      ) : (
                        <span className="text-text-muted/50 italic">待写：这一场发生什么</span>
                      )}
                    </div>

                    {/* Preview of The Turn */}
                    <div className="flex items-center justify-between text-[10px] pt-0.5">
                      {hasTurn ? (
                        <span className="text-text-secondary truncate flex items-center gap-1 text-[9px]">
                          <Flame size={9} className="text-text-muted shrink-0" />
                          <span className="truncate">{scene.entryState} → {scene.exitState}</span>
                        </span>
                      ) : (
                        <span className="text-text-muted/40 text-[9px]">可补前后变化</span>
                      )}

                      {isSelected && (
                        <span className="text-[9px] font-medium text-text-secondary shrink-0">
                          编辑中
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Causality Connector */}
                  {sceneIdx < unit.scenes.length - 1 && (
                    <div className="flex items-center justify-center gap-1.5 py-0 text-[9px] text-text-muted/30 font-mono">
                      <div className="h-1.5 w-px bg-border-primary/20" />
                      <span>↓</span>
                      <div className="h-1.5 w-px bg-border-primary/20" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Quick Add Button */}
            <button
              type="button"
              onClick={handleAddScene}
              className="w-full py-2 rounded-xl border border-dashed border-border-primary/25 hover:border-border-primary/50 text-[11px] text-text-muted hover:text-text-primary flex items-center justify-center gap-1 transition-all cursor-pointer bg-bg-surface/20 hover:bg-bg-surface-soft mt-1.5"
            >
              <Plus size={12} />
              <span>添加第 {unit.scenes.length + 1} 场</span>
            </button>
          </div>
        </div>

        {/* RIGHT MAIN CONTENT WORKBENCH (FULL WIDTH GRID & TILES) */}
        <div className="flex-1 h-full overflow-y-auto p-4 md:p-5 bg-bg-primary space-y-3.5">
          {/* SECTION A: UNIT CLIFFHANGER (EMBEDDED AT TOP OF MAIN AREA) */}
          <div className="p-3.5 rounded-xl bg-bg-surface border border-border-primary/25 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={13} className="text-text-secondary" />
                <span className="text-xs font-bold text-text-primary">
                  本集结尾安排 · 可选
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  ({unit.endingHook?.length || 0} 字)
                </span>
              </div>

              <button
                type="button"
                onClick={handleOpenCliffhanger}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary border border-border-primary/30 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Sparkles size={11} />
                <span>AI 建议结尾</span>
              </button>
            </div>

            <textarea
              value={unit.endingHook || ''}
              onChange={(e) => onUpdateUnit({ ...unit, endingHook: e.target.value })}
              placeholder="本集怎样结束？可以是悬念、情感落点，或一个阶段的完成。"
              rows={2}
              className="w-full text-xs p-2.5 rounded-lg bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/40 font-sans"
            />
          </div>

          {activeScene ? (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              {/* SECTION B: SCENE SLUGLINE & ACTION BAR */}
              <div className="p-3.5 rounded-xl bg-bg-surface border border-border-primary/20 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
                  <span className="px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-bg-surface-soft text-text-secondary border border-border-primary/30 shrink-0">
                    SCENE #{activeSceneIndex + 1}
                  </span>
                  <input
                    type="text"
                    value={activeScene.title}
                    onChange={(e) => {
                      const updated = unit.scenes.map((s) =>
                        s.id === activeScene.id ? { ...s, title: e.target.value } : s
                      );
                      onUpdateUnit({ ...unit, scenes: updated });
                    }}
                    className="text-xs font-bold text-text-primary bg-transparent focus:outline-none border-b border-transparent focus:border-border-primary/40 px-1 truncate flex-1"
                    placeholder="场景标题（如：第 1 场：INT. 密室 - 夜）"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <input
                      type="text"
                      value={activeScene.location || ''}
                      onChange={(e) => {
                        const updated = unit.scenes.map((s) =>
                          s.id === activeScene.id ? { ...s, location: e.target.value } : s
                        );
                        onUpdateUnit({ ...unit, scenes: updated });
                      }}
                      placeholder="地点 (如: INT. 实验室)"
                      className="w-36 text-xs px-2 py-1 rounded-lg bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none text-text-primary placeholder:text-text-muted/40"
                    />

                    <input aria-label="场景时间" placeholder="时间，可自填" list="scene-time-options"
                      value={activeScene.timeOfDay}
                      onChange={(e) => {
                        const updated = unit.scenes.map((s) =>
                          s.id === activeScene.id ? { ...s, timeOfDay: e.target.value } : s
                        );
                        onUpdateUnit({ ...unit, scenes: updated });
                      }}
                      className="text-xs px-2 py-1 rounded-lg bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none text-text-primary cursor-pointer"
                    />
                    <datalist id="scene-time-options"><option value="日"/><option value="夜"/><option value="黄昏"/><option value="清晨"/></datalist>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onOpenScene(unit.id, activeScene.id);
                      onSwitchToWriting();
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary border border-border-primary/30 transition-all shadow-xs cursor-pointer shrink-0"
                    title="跳转到正文编辑器编写本场台词与动作"
                  >
                    <Edit3 size={12} />
                    <span>进入正文写作</span>
                  </button>
                </div>
              </div>

              {/* SECTION C: 2-COLUMN DRAMATIC CORE (WANT & THE TURN) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {/* TILE 1: DRAMATIC WANT */}
                <div className="p-4 rounded-xl bg-bg-surface border border-border-primary/20 shadow-xs flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <span>这一场发生什么</span>
                    </label>
                    <span className="text-[10px] text-text-muted">先记下具体事件</span>
                  </div>

                  <textarea
                    value={activeScene.purpose || ''}
                    onChange={(e) => {
                      const updated = unit.scenes.map((s) =>
                        s.id === activeScene.id ? { ...s, purpose: e.target.value } : s
                      );
                      onUpdateUnit({ ...unit, scenes: updated });
                    }}
                    placeholder="例如：两个人一起修好一把伞，决定同行到车站。也可以写动作、对话或气氛安排。"
                    rows={4}
                    className="w-full text-xs p-2.5 rounded-lg bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/40 font-sans"
                  />

                  <div className="text-[10px] text-text-muted">
                    写清人物做了什么、说了什么。日常相处、信息揭示和气氛铺垫也可以构成一场戏。
                  </div>
                </div>

                {/* TILE 2: THE TURN */}
                <div className="p-4 rounded-xl bg-bg-surface border border-border-primary/20 shadow-xs flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <Flame size={13} className="text-text-secondary" />
                      <span>本场前后变化 · 可选</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleOpenSceneTurn(activeScene)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary border border-border-primary/30 transition-all cursor-pointer shadow-xs"
                      title="查看不同的场景推进方式"
                    >
                      <Sparkles size={11} />
                      <span>AI 建议变化</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-bg-surface-soft/60 border border-border-primary/15 space-y-1">
                      <span className="text-[10px] font-bold text-text-muted block">
                        开始时：
                      </span>
                      <input
                        type="text"
                        value={activeScene.entryState || ''}
                        onChange={(e) => {
                          const updated = unit.scenes.map((s) =>
                            s.id === activeScene.id ? { ...s, entryState: e.target.value } : s
                          );
                          onUpdateUnit({ ...unit, scenes: updated });
                        }}
                        placeholder="如：两人还不熟悉"
                        className="w-full text-xs p-1.5 rounded bg-bg-primary/50 border border-border-primary/20 focus:border-border-primary/40 focus:outline-none text-text-primary placeholder:text-text-muted/40"
                      />
                    </div>

                    <div className="p-2.5 rounded-lg bg-bg-surface-soft/60 border border-border-primary/15 space-y-1">
                      <span className="text-[10px] font-bold text-text-muted block">
                        结束时：
                      </span>
                      <input
                        type="text"
                        value={activeScene.exitState || ''}
                        onChange={(e) => {
                          const updated = unit.scenes.map((s) =>
                            s.id === activeScene.id ? { ...s, exitState: e.target.value } : s
                          );
                          onUpdateUnit({ ...unit, scenes: updated });
                        }}
                        placeholder="如：开始愿意一起做一件事"
                        className="w-full text-xs p-1.5 rounded bg-bg-primary/50 border border-border-primary/20 focus:border-border-primary/40 focus:outline-none text-text-primary font-medium placeholder:text-text-muted/40"
                      />
                    </div>
                  </div>

                  <div className="text-[10px] text-text-muted flex items-center justify-between px-0.5">
                    <span>可以记录关系、认知、情绪或气氛，也可以留空</span>
                    {activeScene.entryState && activeScene.exitState ? (
                      <span className="text-text-secondary font-mono">已记录变化</span>
                    ) : (
                      <span className="text-text-muted font-mono">可选填写</span>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION D: 2-COLUMN SECONDARY TILES (CHARACTERS & SCREENPLAY BRIDGE) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {/* TILE 3: CHARACTERS IN SCENE */}
                <div className="p-4 rounded-xl bg-bg-surface border border-border-primary/20 shadow-xs space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-text-primary">
                    <span className="flex items-center gap-1.5">
                      <Users size={13} className="text-text-secondary" />
                      <span>登场人物 ({activeScene.characterIds?.length || 0})</span>
                    </span>
                    <span className="text-[10px] text-text-muted font-normal">
                      只列本故事可用人物；资料供写作参考
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {unitCharacters(project,unit).map((char) => {
                      const isPresent = activeScene.characterIds?.includes(char.id);
                      return (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => {
                            const currentIds = activeScene.characterIds || [];
                            const nextIds = isPresent
                              ? currentIds.filter((id) => id !== char.id)
                              : [...currentIds, char.id];
                            const updated = unit.scenes.map((s) =>
                              s.id === activeScene.id ? { ...s, characterIds: nextIds } : s
                            );
                            onUpdateUnit({ ...unit, scenes: updated });
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                            isPresent
                              ? 'bg-text-primary text-bg-surface font-medium shadow-xs'
                              : 'bg-bg-surface-soft text-text-muted hover:text-text-primary border border-border-primary/20'
                          }`}
                        >
                          <span>{char.name}</span>
                          {char.voice && (
                            <span className={`text-[10px] opacity-75 font-normal ${isPresent ? 'text-bg-surface' : 'text-text-muted'}`}>
                              ({char.voice})
                            </span>
                          )}
                          {isPresent && <Check size={11} />}
                        </button>
                      );
                    })}
                    {unitCharacters(project,unit).length === 0 && (
                      <span className="text-xs text-text-muted">
                        暂无预设人物，可在全案蓝图中添加主要人物档案
                      </span>
                    )}
                  </div>
                </div>

                {/* TILE 4: SCREENPLAY DRAFT BRIDGE */}
                <div className="p-4 rounded-xl bg-bg-surface border border-border-primary/20 shadow-xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-text-primary">
                      {activeScene.blocks.length > 0 && activeScene.blocks.some((b) => b.text?.trim()) ? (
                        <span className="text-text-secondary">已撰写剧本正文（约 {activeScene.blocks.reduce((acc, b) => acc + (b.text || '').replace(/\s/g, '').length, 0)} 字）</span>
                      ) : (
                        <span>本场正文待起草</span>
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted">
                      进入编辑器可以手写正文，也可以让 AI 提出本场候选稿。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onOpenScene(unit.id, activeScene.id);
                      onSwitchToWriting();
                    }}
                    className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all shadow-xs cursor-pointer shrink-0 ml-2"
                  >
                    <span>进入正文写作</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-text-muted text-xs">
              <p>请在左侧选择场景，写下发生的事，再按需补充地点和前后变化。</p>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 4. DUAL-TRACK AI RECOMMENDATION MODAL POPUP               */}
      {/* ========================================================= */}
      {recomState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-bg-surface border border-border-primary/40 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border-primary/20 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-bg-surface-soft text-text-secondary border border-border-primary/30 flex items-center justify-center">
                  <Sparkles size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">{recomState.title}</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">{recomState.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecomState((prev) => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-[220px]">
              {recomState.job&&<div className="text-xs text-text-muted space-y-2"><p>本次任务依据 · {recomState.job.result?.summary||recomState.job.error||'等待返回'}</p><p>本次 Skill：{recomState.job.methods.map(method=>`${method.title} · v${method.version}`).join('、')||'未选用'}</p><details><summary className="cursor-pointer">本次提示词与模型返回原文</summary><pre className="whitespace-pre-wrap select-text">{recomState.job.prompt}</pre>{recomState.job.rawResult&&<pre className="whitespace-pre-wrap select-text">{recomState.job.rawResult}</pre>}</details></div>}
              {recomState.job?.operation==='ending'&&<p className="text-xs text-text-secondary">当前结尾安排：{unit.endingHook||'未填写'}</p>}
              {recomState.job?.operation==='scene_turn'&&<p className="text-xs text-text-secondary">当前场景：{unit.scenes.find(scene=>scene.id===recomState.job?.sceneId)?.purpose||'尚未填写发生什么'}</p>}
              {recomState.isLoading ? (
                <div className="h-48 flex flex-col items-center justify-center gap-3 text-text-muted text-xs">
                  <Sparkles size={24} className="animate-spin text-text-secondary" />
                  <p>正在根据本集已有内容整理建议…</p>
                </div>
              ) : recomState.options.length > 0 ? (
                recomState.options.map((opt, oIdx) => (
                  <div
                    key={oIdx}
                    className="p-4 rounded-xl bg-bg-surface-soft border border-border-primary/20 hover:border-border-primary/50 transition-all space-y-2 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface text-text-secondary font-medium border border-border-primary/30">
                          {opt.title || `方案 ${oIdx + 1}`}
                        </span>
                        {opt.subtitle && (
                          <span className="text-[11px] text-text-muted">{opt.subtitle}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={dirty||!recomState.job||recomState.job.status!=='ready'||recomState.job.baseRevision!==project.revision}
                        onClick={() => handleApplyRecommendation(oIdx)}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all shadow-xs cursor-pointer disabled:opacity-40"
                      >
                        <Check size={12} />
                        <span>采纳此方案</span>
                      </button>
                    </div>

                    <div className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed p-3 rounded-lg bg-bg-primary/50 border border-border-primary/10 select-text font-sans">
                      {opt.content}
                    </div>
                    {recomState.type==='scene_turn'&&opt.extra&&<p className="text-xs text-text-secondary">{opt.extra.purpose&&`发生什么：${opt.extra.purpose}　`}{opt.extra.entryState&&`入场：${opt.extra.entryState}　`}{opt.extra.exitState&&`结束：${opt.extra.exitState}`}</p>}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-text-muted">
                  暂未获取到推荐方案，点击下方按钮重试。
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border-primary/10 shrink-0">
              <button
                type="button"
                disabled={recomState.isLoading||dirty}
                onClick={() => {
                  if (recomState.type === 'cliffhanger') {
                    handleOpenCliffhanger();
                  } else if (recomState.type === 'scene_turn' && recomState.targetSceneId) {
                    const s = unit.scenes.find((x) => x.id === recomState.targetSceneId);
                    if (s) handleOpenSceneTurn(s);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft border border-border-primary/30 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw size={12} className={recomState.isLoading ? 'animate-spin' : ''} />
                <span>换一批灵感</span>
              </button>

              <button
                type="button"
                onClick={() => setRecomState((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
