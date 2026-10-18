import { useScriptSkills } from '../useScriptSkills';
import { useSettingsStore } from '../../../clients/stateClient';
import React, { useEffect, useState, useRef } from 'react';
import { 
  LayoutGrid, Plus, Trash2, Sparkles, Check, X, RefreshCw, 
  ArrowRight, AlertTriangle, CheckCircle2, Clock, Radar, Compass, 
  Edit3, Flame, ChevronRight, Wand2, BookOpen, Layers, ShieldCheck,
  ChevronLeft, ExternalLink, Maximize2
} from 'lucide-react';
import type { ScriptProject, DeliveryUnit, Scene, ScriptOperation } from '../../../../../../packages/script/src/schema';
import { newId, removeScriptScene, removeScriptUnit } from '../../../../../../packages/script/src/project';
import { applyWholeBoardPlan, type ProposedUnit } from '../../../../../../packages/script/src/planning';
import { availableMethods, buildScriptTaskContext, OPERATION_LABELS } from '../../../../../../packages/script/src/methods';
import type { ScriptJob } from '../../../../../../packages/script/src/proposals';
import { generateAIContent } from '../../../clients/aiClient';
import { scriptClient } from '../../../clients/scriptClient';
import { withManualAIResult } from '../../../clients/manualAIClient';
import { boardAdviceBody } from './boardAdviceContext';
import toast from 'react-hot-toast';
import {structureNodeSceneIds} from '../../../../../../packages/script/src/structure';

interface Props {
  project: ScriptProject; activeUnitId?:string;activeNodeId?:string;onRequestTask?:(operation:ScriptOperation,unitId?:string,sceneId?:string)=>void;
  dirty: boolean;
  onApplied: (project:ScriptProject,base:ScriptProject)=>void;
  onOpenScene: (unitId: string, sceneId: string) => void;
  onUpdateUnit: (unit: DeliveryUnit) => void;
  onUpdateProject?: (updater: (draft: ScriptProject) => void) => void;
  onAddUnit: () => void;
  onAddScene: (unitId: string) => void;
  onRequestPlan?: (unitId: string) => void;
  onSwitchToWriting?: () => void;
  onSwitchToOutline?: () => void;
  onOpenUnitDetail?: (unitId: string) => void;
}

interface BeatRecomOption {
  title: string;
  subtitle?: string;
  content: string;
  extra?: any;
}

interface BeatRecomState {
  isOpen: boolean;
  type: 'cliffhanger' | 'scene_turn' | 'auto_breakdown';
  targetUnitId?: string;
  targetSceneId?: string;
  title: string;
  description: string;
  isLoading: boolean;
  options: BeatRecomOption[];
  base?: string;
  job?: ScriptJob;
}

function boardPlanOption(job:ScriptJob):BeatRecomOption{
  const units=job.result?.units;
  if(!units?.length)throw new Error('此写作记录没有可预览的全剧分场建议');
  const content=units.map((unit,index)=>`【${unit.title||`第 ${unit.unitIndex||index+1} 集`}】\n${unit.summary||'未写摘要'}\n${unit.scenes?.map((scene,sceneIndex)=>`${sceneIndex+1}. ${scene.title||'暂定场景'}：${scene.purpose}`).join('\n')||'没有分场建议'}${unit.cliffhanger?`\n结尾：${unit.cliffhanger}`:''}`).join('\n\n');
  return {title:`全剧分场建议 (${units.length} 个单元)`,subtitle:'只补尚未规划的场景，保留已有大纲、正文和手工分场',content,extra:units};
}
function boardJobOptions(job:ScriptJob):BeatRecomOption[]{
  if(job.operation==='board_plan')return [boardPlanOption(job)];
  if((job.operation==='ending'||job.operation==='scene_turn')&&job.result?.choices?.length)return job.result.choices;
  throw new Error('此写作记录没有可预览的分场建议');
}
function boardJobType(job:ScriptJob):BeatRecomState['type']{
  return job.operation==='ending'?'cliffhanger':job.operation==='scene_turn'?'scene_turn':'auto_breakdown';
}

export function StoryGridBoard({
  project,activeUnitId,activeNodeId,onRequestTask,
  dirty,
  onApplied,
  onOpenScene,
  onUpdateUnit,
  onUpdateProject,
  onAddUnit,
  onAddScene,
  onRequestPlan,
  onSwitchToWriting,
  onSwitchToOutline,
  onOpenUnitDetail,
}: Props) {
  const displayedUnits=activeNodeId?project.units.filter(item=>item.id===activeUnitId):project.units;
  const displayedScenes=(unit:DeliveryUnit)=>{if(!activeNodeId||unit.id!==activeUnitId||!unit.structureNodes?.some(node=>node.id===activeNodeId))return unit.scenes;const ids=new Set(structureNodeSceneIds(unit,activeNodeId));return unit.scenes.filter(scene=>ids.has(scene.id)||!scene.structureNodeId);};
  const isMicroDrama = project.profile.workType.includes('短剧');

  // Layout switcher: 'grid' (adaptive card matrix - default) or 'kanban' (classic horizontal columns)
  const isTestMode=useSettingsStore(state=>state.isTestMode);
  const [boardLayout, setBoardLayout] = useState<'grid' | 'kanban'>('grid');

  // AI Modal State
  const [recomState, setRecomState] = useState<BeatRecomState>({
    isOpen: false,
    type: 'cliffhanger',
    title: '',
    description: '',
    isLoading: false,
    options: [],
  });
  const [boardJobs,setBoardJobs]=useState<ScriptJob[]>([]);
  const [boardMethodIds,setBoardMethodIds]=useState<string[]>([]);
  const [pendingBoardApply,setPendingBoardApply]=useState<{jobId:string;applied:number;preserved:number}|null>(null);
  useEffect(()=>setPendingBoardApply(null),[recomState.isOpen,recomState.job?.id]);
  const {methods:sharedMethods,error:skillsError}=useScriptSkills();
  const skillProject={...project,methods:sharedMethods};
  const boardMethods=sharedMethods;
  useEffect(()=>setBoardMethodIds(ids=>ids.filter(id=>boardMethods.some(method=>method.id===id))),[project.id,sharedMethods]);
  useEffect(()=>{let active=true;scriptClient.listBoardSuggestionJobs(project.id).then(({jobs})=>{if(active)setBoardJobs(jobs);}).catch(error=>{if(active)toast.error(error instanceof Error?error.message:'无法读取分场建议记录');});return()=>{active=false;};},[project.id,project.revision]);
  const refreshBoardJobs=async()=>setBoardJobs((await scriptClient.listBoardSuggestionJobs(project.id)).jobs);

  // Active highlighted unit
  const [highlightedUnitId, setHighlightedUnitId] = useState<string | null>(null);
  const unitRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // -------------------------------------------------------------
  // Metrics & QA Calculations
  // -------------------------------------------------------------
  const totalUnits = project.units.length;
  const totalScenes = project.units.reduce((acc, u) => acc + u.scenes.length, 0);
  const totalWords = project.units.reduce(
    (acc, u) =>
      acc +
      u.scenes.reduce(
        (sAcc, s) =>
          sAcc + s.blocks.reduce((bAcc, b) => bAcc + (b.text || '').replace(/\s/g, '').length, 0),
        0
      ),
    0
  );

  const scenesWithPlans = project.units.flatMap((u) => u.scenes).filter((s) => Boolean(s.purpose.trim()));
  const scenesWithDrafts = project.units.flatMap((u) => u.scenes).filter((s) => s.blocks.some((b) => b.type !== 'note' && b.text.trim()));

  // Scroll or Open unit
  const handleSelectOrScrollUnit = (unitId: string) => {
    if (onOpenUnitDetail) {
      onOpenUnitDetail(unitId);
    } else {
      setHighlightedUnitId(unitId);
      setTimeout(() => setHighlightedUnitId(null), 2500);
    }
  };

  // Delete Unit Handler
  const handleDeleteUnit = (unitId: string, unitTitle: string) => {
    if(!onUpdateProject)return;
    let counts:ReturnType<typeof removeScriptUnit>;
    try{counts=removeScriptUnit(structuredClone(project),unitId);}
    catch(error){toast.error(error instanceof Error?error.message:'无法删除此单元');return;}
    const privateCount=counts.characters+counts.facts+counts.storylines+counts.tracks;
    const detail=privateCount?`同时删除只属于它的 ${counts.characters} 位人物、${counts.facts} 条设定、${counts.storylines} 条故事线和 ${counts.tracks} 条连续性记录。`:'';
    if(window.confirm(`确定删除「${unitTitle}」及其所有场次？${detail}删除后将更新当前稿。`)){
      onUpdateProject(draft=>{removeScriptUnit(draft,unitId);});
      toast.success(`已删除「${unitTitle}」`);
    }
  };

  // Delete Scene Handler
  const handleDeleteScene = (unitId: string, sceneId: string, sceneTitle: string) => {
    const unit = project.units.find((u) => u.id === unitId);
    if (!unit) return;
    const preview=structuredClone(project);
    let removedTiming=0;
    try{removedTiming=removeScriptScene(preview,unitId,sceneId);}
    catch(error){toast.error(error instanceof Error?error.message:'无法删除此场景');return;}
    if (window.confirm(`确定删除场景「${sceneTitle}」？${removedTiming?`同时删除关联的 ${removedTiming} 条时长安排。`:''}连续性证据会保留并提示复核，删除后将更新当前稿。`)) {
      onUpdateUnit(preview.units.find(item=>item.id===unitId)!);
      toast.success(`已删除「${sceneTitle}」`);
    }
  };

  // -------------------------------------------------------------
  // AI Recommendation Handlers
  // -------------------------------------------------------------
  const runChoiceTask=async(operation:'ending'|'scene_turn',unit:DeliveryUnit,scene:Scene|undefined,title:string,description:string,basePrompt:string)=>{
    if(dirty){toast.error('先保存当前稿，再生成建议。');return;}
    const selectedMethodIds=boardMethodIds.filter(id=>availableMethods(skillProject,operation).some(method=>method.id===id));
    const task=buildScriptTaskContext(skillProject,unit,operation,selectedMethodIds,scene?.id);
    const prompt=`${basePrompt}\n\n本次选用的 Skill：\n${task.instructions}${task.inputs.length?`\n本次 Skill 要求的辅助资料：\n${JSON.stringify({seasons:task.context.seasons,storylines:task.context.storylines,continuity:task.context.continuity})}`:''}`;
    setRecomState({isOpen:true,type:operation==='ending'?'cliffhanger':'scene_turn',targetUnitId:unit.id,targetSceneId:scene?.id,title,description,isLoading:true,options:[],base:JSON.stringify(project)});
    let job:ScriptJob|undefined;
    try{
      job=(await scriptClient.createJob(skillProject,unit.id,scene?.id||unit.id,operation,prompt,undefined,selectedMethodIds)).job;
      await refreshBoardJobs();
      let provenance:ScriptJob['provenance'];
      let executionPrompt:ScriptJob['executionPrompt'];
      const raw=await generateAIContent({prompt:job.prompt,systemInstruction:'尊重作者已有内容。严格输出合法 JSON 对象。',requireJson:true,taskType:'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};},onExecutionProvenance:value=>{provenance={source:value.source,provider:value.provider,modelId:value.modelId};}});
      job=(await scriptClient.submitJob(job,raw,provenance||{source:'api',provider:'unknown_api',modelId:'unknown'},executionPrompt)).job;
      await refreshBoardJobs();
      if(job.status==='failed')throw new Error(job.error||'建议未通过校验');
      setRecomState(prev=>({...prev,isLoading:false,options:boardJobOptions(job!),job}));
    }catch(error){
      if(job?.status==='waiting')await scriptClient.failJob(job,error instanceof Error?error.message:'模型调用未完成').catch(()=>{});
      await refreshBoardJobs().catch(()=>{});
      toast.error(error instanceof Error?error.message:'生成建议失败');
      setRecomState(prev=>({...prev,isLoading:false}));
    }
  };
  const handleOpenCliffhanger = async (unit: DeliveryUnit) => {
    if(onRequestTask){setRecomState(prev=>({...prev,isOpen:false}));onRequestTask('ending',unit.id);return;}
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

    await runChoiceTask('ending',unit,unit.scenes[0],`「${unit.title}」结尾安排建议`,'提供几种不同的结尾方式供你选择；可以留下悬念，也可以让这一集平静结束。',prompt);
  };

  const handleOpenSceneTurn = async (unit: DeliveryUnit, scene: Scene) => {
    if(onRequestTask){setRecomState(prev=>({...prev,isOpen:false}));onRequestTask('scene_turn',unit.id,scene.id);return;}
    const prompt = `你是尊重作者风格的剧本编辑。
当前作品：《${project.title}》（${project.profile.workType}）
所属集数：${unit.title}（本集结尾安排：${unit.endingHook || '未定'}）
当前场景标题：${scene.title}
当前场次意图：${scene.purpose || '未填写'}
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

    await runChoiceTask('scene_turn',unit,scene,`「${scene.title}」场景变化建议`,'查看这场戏如何推动行动、关系、认知或气氛；不要求每一场都发生正负翻转。',prompt);
  };

  const handleOpenAutoBreakdown = async () => {
    if(onRequestTask){setRecomState(prev=>({...prev,isOpen:false}));onRequestTask('board_plan',activeUnitId);return;}
    if(dirty){toast.error('先保存当前稿，再生成全剧分场建议。');return;}
    if (!project.brief.outline && !project.brief.concept) {
      toast.error('请先在故事资料中填写构想或大纲');
      return;
    }

    setRecomState({
      isOpen: true,
      type: 'auto_breakdown',
      title: '根据已有构想提出分场建议',
      description: `根据现有大纲提供分场建议。已有正文和手工规划保持原样。`,
      isLoading: true,
      options: [],
      base: JSON.stringify(project),
    });

    const plannedCount = project.profile.organization === 'standalone' ? 1 : project.profile.plannedUnits;
    const firstUnit=project.units[0];
    const selectedMethodIds=boardMethodIds.filter(id=>availableMethods(skillProject,'board_plan').some(method=>method.id===id));
    const task=buildScriptTaskContext(skillProject,firstUnit,'board_plan',selectedMethodIds);
    const prompt = `你是尊重作者目标的剧本规划助手。
当前作品：《${project.title}》（体裁：${project.profile.workType}，题材：${project.profile.genres.join('/') || '通用'}）
规划单元数：${plannedCount}
故事核心前提：${project.brief.concept || '未定'}
作者写下的主题：${project.brief.theme || '未定'}
现有人物：${project.characters.map((c) => c.name).join('、') || '未设定'}
已确认设定：${project.facts.filter(f => f.status === 'approved').map((f) => f.text).join('；') || '暂无'}
全剧大纲：
${project.brief.outline || '暂无，请根据构想提出可讨论的规划'}
本次选用的 Skill：
${task.instructions}
${task.inputs.length?`本次 Skill 要求的辅助资料：\n${JSON.stringify({seasons:task.context.seasons,storylines:task.context.storylines,continuity:task.context.continuity})}`:''}

请将大纲规划为 ${plannedCount} 个${project.profile.organization === 'standalone' ? '全片' : '分集'}单元的场景建议。尊重作者已确定的内容。
要求：
1. 每个单元包含标题、剧情摘要和适量场景；场数由目标时长及故事需要决定；
2. 可选提供结尾安排，允许悬念、情感落点或阶段性完成；
3. 每场给出发生的事件；进出状态只有在有帮助时填写。

请严格仅输出合法 JSON 格式，结构如下：
{
  "summary": "本次分场规划的依据与待作者确认项",
  "units": [
    {
      "unitIndex": 1,
      "title": "第 1 集：暂定标题",
      "summary": "本单元发生的主要剧情...",
      "cliffhanger": "可选的结尾安排...",
      "scenes": [
        {
          "title": "第 1 场：暂定场景",
          "purpose": "这一场发生什么",
          "entryState": "可选的入场状况",
          "exitState": "可选的结束变化"
        }
      ]
    }
  ]
}`;

    let job:ScriptJob|undefined;
    try {
      job=(await scriptClient.createJob(skillProject,firstUnit.id,firstUnit.scenes[0]?.id||firstUnit.id,'board_plan',prompt,undefined,selectedMethodIds)).job;
      await refreshBoardJobs();
      let provenance:ScriptJob['provenance'];
      let executionPrompt:ScriptJob['executionPrompt'];
      const raw=await generateAIContent({prompt:job.prompt,systemInstruction:'保留作者已有内容。严格输出合法 JSON 对象。',requireJson:true,taskType:'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};},onExecutionProvenance:value=>{provenance={source:value.source,provider:value.provider,modelId:value.modelId};}});
      job=(await scriptClient.submitJob(job,raw,provenance||{source:'api',provider:'unknown_api',modelId:'unknown'},executionPrompt)).job;
      await refreshBoardJobs();
      if(job.status==='failed')throw new Error(job.error||'分场建议未通过校验');
      setRecomState(prev=>({...prev,isLoading:false,options:[boardPlanOption(job!)],job}));
    } catch (err: any) {
      if(job?.status==='waiting')await scriptClient.failJob(job,err instanceof Error?err.message:'模型调用未完成').catch(()=>{});
      await refreshBoardJobs().catch(()=>{});
      toast.error(err?.message || '生成分场建议失败');
      setRecomState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const openBoardJob=(job:ScriptJob)=>{
    try{setRecomState({isOpen:true,type:boardJobType(job),targetUnitId:job.unitId,targetSceneId:job.sceneId,title:`已保存的${OPERATION_LABELS[job.operation]}`,description:job.status==='ready'&&job.baseRevision===project.revision?'审阅后可采用；已有正文会保留。':'此记录仅供查阅，不能再次采用。',isLoading:false,options:boardJobOptions(job),base:JSON.stringify(project),job});}
    catch(error){toast.error(error instanceof Error?error.message:'无法预览分场建议');}
  };
  const recoverBoardJob=async(job:ScriptJob)=>{
    if(dirty||job.baseRevision!==project.revision){toast.error('先保存当前稿，并确认任务基线与正式稿一致。');return;}
    setRecomState({isOpen:true,type:boardJobType(job),targetUnitId:job.unitId,targetSceneId:job.sceneId,title:`补交${OPERATION_LABELS[job.operation]}`,description:'使用原提示词手动回填本次返回。',isLoading:true,options:[],base:JSON.stringify(project),job});
    try{
      let executionPrompt:ScriptJob['executionPrompt'];
      const raw=await withManualAIResult('',undefined,()=>generateAIContent({prompt:job.prompt,requireJson:true,taskType:'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};}}),false,true);
      const {job:updated}=await scriptClient.submitJob(job,raw,{source:'manual_external',provider:'manual_external',modelId:'manual_external'},executionPrompt);
      await refreshBoardJobs();
      if(updated.status==='failed')throw new Error(updated.error||'分场建议未通过校验');
      setRecomState(prev=>({...prev,isLoading:false,options:boardJobOptions(updated),job:updated}));
    }catch(error){
      if(job.status==='waiting')await scriptClient.failJob(job,error instanceof Error?error.message:'模型调用未完成').catch(()=>{});
      await refreshBoardJobs().catch(()=>{});
      toast.error(error instanceof Error?error.message:'补交分场建议失败');setRecomState(prev=>({...prev,isLoading:false}));
    }
  };

  const handleApplyRecommendation = async (opt: BeatRecomOption,choiceIndex:number) => {
    if(recomState.base!==JSON.stringify(project)){toast.error('作品已改变，请重新生成与当前稿对应的建议。');return;}
    if(dirty){toast.error('先保存当前稿，再采用建议。');return;}
    if(!recomState.job||recomState.job.status!=='ready'||recomState.job.baseRevision!==project.revision){toast.error('这条建议已过期或不可采用。');return;}
    if (recomState.type === 'auto_breakdown' && opt.extra) {
      if(recomState.job.baseRevision!==project.revision){toast.error('当前稿已有修改，这条建议仅供参考。');return;}
      const newUnitsData = opt.extra as ProposedUnit[];
      const preview = applyWholeBoardPlan(structuredClone(project), newUnitsData);
      if(pendingBoardApply?.jobId!==recomState.job.id||pendingBoardApply.applied!==preview.applied||pendingBoardApply.preserved!==preview.preserved){
        setPendingBoardApply({jobId:recomState.job.id,applied:preview.applied,preserved:preview.preserved});
        return;
      }
      try{
        const accepted=await scriptClient.transitionJob(recomState.job,'approve');
        if(!accepted.project)throw new Error('采用后未返回当前稿');
        onApplied(accepted.project,project);
        await refreshBoardJobs();
      }catch(error){toast.error(error instanceof Error?error.message:'采用分场建议失败');return;}
    }else if(recomState.job.operation==='ending'||recomState.job.operation==='scene_turn'){
      try{
        const accepted=await scriptClient.transitionJob(recomState.job,'approve',choiceIndex);
        if(!accepted.project)throw new Error('采用后未返回当前稿');
        onApplied(accepted.project,project);
        await refreshBoardJobs();
      }catch(error){toast.error(error instanceof Error?error.message:'采用建议失败');return;}
    }

    setRecomState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-bg-primary overflow-hidden select-none relative">
      {/* ========================================================= */}
      {/* 1. TOP PROFESSIONAL BAR: STORY BEAT BOARD                 */}
      {/* ========================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-border-primary/20 bg-bg-surface shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-bg-surface-soft text-text-secondary border border-border-primary/30 flex items-center justify-center">
            <LayoutGrid size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-text-primary">分场规划</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface-soft border border-border-primary/20 text-text-secondary">
                {isMicroDrama ? '微短剧 · 分场视图' : '作品分场视图'}
              </span>
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              从分集大纲安排每场发生的事，点击单元可查看详情并进入正文。
            </p>
          </div>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex flex-wrap items-center gap-2 max-w-full [&>button]:shrink-0 [&>details]:shrink-0">
          {/* Layout Mode Switcher */}
          <div className="flex shrink-0 items-center whitespace-nowrap bg-bg-surface-soft p-0.5 rounded-xl border border-border-primary/20 text-xs">
            <button
              type="button"
              onClick={() => setBoardLayout('grid')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                boardLayout === 'grid'
                  ? 'bg-bg-surface text-text-primary font-semibold shadow-xs border border-border-primary/30'
                  : 'text-text-muted hover:text-text-primary border border-transparent'
              }`}
              title="场记卡全景：自适应多列网格，一览全部集数，点击查看分场详情"
            >
              <LayoutGrid size={12} />
              <span>按作品查看</span>
            </button>
            <button
              type="button"
              onClick={() => setBoardLayout('kanban')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                boardLayout === 'kanban'
                  ? 'bg-bg-surface text-text-primary font-semibold shadow-xs border border-border-primary/30'
                  : 'text-text-muted hover:text-text-primary border border-transparent'
              }`}
              title="横向看板：经典瀑布流平铺各集所有场景"
            >
              <Layers size={12} />
              <span>逐场编辑</span>
            </button>
          </div>

          {onSwitchToOutline && (
            <button
              type="button"
              onClick={onSwitchToOutline}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary bg-bg-surface-soft hover:bg-bg-surface border border-border-primary/30 transition-all cursor-pointer"
              title="返回故事大纲模块调整宏观剧情走向"
            >
              <BookOpen size={13} className="text-text-muted" />
              <span>返回故事大纲</span>
            </button>
          )}

          {/* Auto Breakdown Trigger */}
          {skillsError&&<p role="alert" className="text-xs text-accent-amber">{skillsError}</p>}
          {!onRequestTask&&boardMethods.length>0&&<details className="relative text-xs">
            <summary className="cursor-pointer px-3 py-1.5 rounded-xl bg-bg-surface-soft border border-border-primary/30 text-text-secondary">本次 Skill（{boardMethodIds.length}）</summary>
            <div className="absolute right-0 z-20 mt-1 min-w-52 max-w-72 max-h-52 overflow-auto rounded-xl border border-border-primary/30 bg-bg-surface p-3 shadow-xl space-y-2">
              {boardMethods.map(method=><label key={method.id} className="flex items-start gap-2"><input type="checkbox" checked={boardMethodIds.includes(method.id)} onChange={()=>setBoardMethodIds(ids=>ids.includes(method.id)?ids.filter(id=>id!==method.id):[...ids,method.id])}/><span>{method.title} · v{method.version}</span></label>)}
            </div>
          </details>}
          <button
            type="button"
            onClick={handleOpenAutoBreakdown}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary border border-border-primary/30 transition-all shadow-xs cursor-pointer"
            title="从当前集起最多3集，准备分场建议请求" aria-label="从当前集起最多3集，准备分场建议请求"
          >
            <Sparkles size={13} />
            <span className="sr-only">分批分场建议</span>
          </button>

          {/* Add Unit */}
          {project.profile.organization !== 'standalone' && (
            <button
              type="button"
              onClick={onAddUnit}
              className="px-3 py-1.5 text-xs font-medium rounded-xl bg-text-primary text-bg-surface hover:opacity-90 flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Plus size={14} />
              <span>添加集数</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. CONTENT PROGRESS                                         */}
      {/* ========================================================= */}
      <div className="px-6 py-2 bg-bg-surface-soft/60 border-b border-border-primary/10 flex flex-wrap items-center justify-between text-xs text-text-muted shrink-0 gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-1.5">
            <Layers size={13} className="text-text-muted" />
            <span>规划规格:</span>
            <span className="font-semibold text-text-primary font-mono">
              {project.profile.organization === 'standalone' ? '全片' : `计划 ${project.profile.plannedUnits} 集，已建 ${totalUnits} 集`} · {totalScenes} 个场景 · 约 {totalWords} 字
            </span>
          </div>

          <div className="hidden sm:block h-3 w-px bg-border-primary/20" />

          <span className="text-text-secondary">已写场景梗概 {scenesWithPlans.length}/{totalScenes}</span>

          <div className="hidden sm:block h-3 w-px bg-border-primary/20" />

          <div className="flex items-center gap-1.5 text-text-secondary">
            <Edit3 size={13} className="text-text-muted" />
            <span>已有正文:</span>
            <span className="font-semibold text-text-primary font-mono">{scenesWithDrafts.length}/{totalScenes}</span>
          </div>
        </div>

        {/* Workflow Hint */}
        <div className="text-[11px] text-text-muted flex items-center gap-1">
          <span>按场景顺序安排事件、信息与情绪变化；节拍不必与场景一一对应。</span>
        </div>
      </div>

      {boardJobs.length>0&&<details className="px-6 py-2 border-b border-border-primary/10 bg-bg-surface text-xs">
        <summary className="cursor-pointer text-text-secondary">分场建议任务记录（{boardJobs.length}）</summary>
        <div className="mt-2 max-h-40 overflow-auto space-y-2">{boardJobs.map(job=><div key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-primary/20 p-2">
          <span>{OPERATION_LABELS[job.operation]} · 版本 {job.baseRevision} · {{waiting:'等待返回',ready:'待审阅',failed:'返回需修正',approved:'已采用',rejected:'已放弃',cancelled:'已取消'}[job.status]}</span>
          {job.error&&<span className="text-text-muted">{job.error}</span>}
          {job.result&&<button type="button" onClick={()=>openBoardJob(job)}>查看{job.status==='ready'?'建议':'记录'}</button>}
          {isTestMode&&['waiting','failed'].includes(job.status)&&<button type="button" disabled={dirty||job.baseRevision!==project.revision} onClick={()=>void recoverBoardJob(job)}>手动补交返回</button>}
        </div>)}</div>
      </details>}

      {/* ========================================================= */}
      {/* 3. MAIN CANVAS: GRID MODE (DEFAULT) OR KANBAN MODE        */}
      {/* ========================================================= */}

      {/* 3A. GRID MODE: FULL OVERVIEW INDEX CARDS (NO HORIZONTAL CUTOFF) */}
      {boardLayout === 'grid' && (
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          {/* Welcome Empty Guidance */}
          {totalUnits === 1 && totalScenes <= 1 && totalWords === 0 && !project.units[0].summary && (
            <div className="mb-6 p-5 rounded-2xl bg-bg-surface border border-dashed border-border-primary/30 shadow-lg space-y-2">
              <div className="flex items-center gap-2 text-text-primary font-bold text-xs">
                <Sparkles size={16} />
                <span>分场规划</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                这里可以查看每集有哪些场、每场发生什么。可以从大纲生成分场建议，也可以手动添加场景，随后进入正文写作。
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onRequestPlan?.(project.units[0].id)}
                  className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                 title="根据已有大纲补充本集分场" aria-label="根据已有大纲补充本集分场"><Sparkles size={16} /></button>
              </div>
            </div>
          )}

          {/* Responsive Multi-Row Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
            {displayedUnits.map((unit, unitIdx) => {
              const unitWordCount = unit.scenes.reduce(
                (acc, s) =>
                  acc + s.blocks.reduce((bAcc, b) => bAcc + (b.text || '').replace(/\s/g, '').length, 0),
                0
              );
              const isHighlighted = highlightedUnitId === unit.id;

              return (
                <div
                  key={unit.id}
                  ref={(el) => {
                    unitRefs.current[unit.id] = el;
                  }}
                  onClick={() => onOpenUnitDetail ? onOpenUnitDetail(unit.id) : null}
                  className={`group p-5 rounded-2xl bg-bg-surface border shadow-md hover:shadow-xl transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-3.5 relative ${
                    isHighlighted
                      ? 'border-border-primary/60 ring-2 ring-border-primary/40 shadow-xs'
                      : 'border-border-primary/20 hover:border-border-primary/40'
                  }`}
                >
                  {/* Top Bar: Episode Badge, Title, Delete */}
                  <div>
                    <div className="flex items-center justify-between pb-2 border-b border-border-primary/10">
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        <span className="px-2 py-0.5 rounded-lg text-xs font-medium font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/20 shrink-0">
                          {project.profile.organization === 'standalone' ? '全片' : `第 ${unitIdx + 1} 集`}
                        </span>
                        <span className="text-xs font-bold text-text-primary group-hover:text-text-primary transition-colors truncate">
                          {unit.title || `第 ${unitIdx + 1} 集`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-text-muted font-mono">
                          {unit.scenes.length} 场 · {unitWordCount} 字
                        </span>
                        {project.units.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteUnit(unit.id, unit.title);
                            }}
                            className="p-1 rounded text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="删除该集"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Story first: show the episode's substance before optional techniques. */}
                    <div className="mt-3">
                      <div className="text-[10px] font-bold text-text-secondary mb-1">{project.profile.organization === 'standalone' ? '全片梗概' : '本集梗概'}</div>
                      <div className="p-2.5 rounded-xl border border-border-primary/20 bg-bg-surface-soft/60 text-xs leading-relaxed line-clamp-3 text-text-secondary">
                        {unit.summary?.trim() || '还没有梗概，可以先写一场。'}
                      </div>
                    </div>

                    {/* Scenes Miniature Chain */}
                    <div className="mt-3 pt-2.5 border-t border-border-primary/10 space-y-1.5">
                      <div className="text-[10px] text-text-muted font-medium flex items-center justify-between">
                        <span>场景序列 ({unit.scenes.length} 场)</span>
                      </div>

                      <div className="space-y-1">
                        {displayedScenes(unit).slice(0, 3).map((s, sIdx) => (
                          <div key={s.id} className="text-[11px] text-text-muted flex items-start gap-1.5">
                            <span className="font-mono text-[10px] text-text-muted shrink-0">#{sIdx + 1}</span>
                            <span className="min-w-0 flex-1"><strong className="block truncate text-text-secondary">{s.title}</strong><span className="block truncate">{s.purpose || '待写：这一场发生什么'}</span></span>
                            <span className="text-[9px] text-text-muted shrink-0">{s.blocks.some(b => b.type !== 'note' && b.text.trim()) ? '有正文' : '待写'}</span>
                          </div>
                        ))}
                        {unit.scenes.length > 3 && (
                          <div className="text-[10px] text-text-muted/60 pl-3">
                            + 还有 {unit.scenes.length - 3} 场
                          </div>
                        )}
                      </div>
                    </div>
                    {unit.endingHook?.trim() && <p className="mt-3 text-[11px] text-text-muted border-t border-border-primary/10 pt-2">结尾安排：{unit.endingHook}</p>}
                  </div>

                  {/* Card Footer: Detail Trigger Button */}
                  <div className="pt-2 border-t border-border-primary/10 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestPlan?.(unit.id);
                      }}
                      className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                     title="AI 补本集分场" aria-label="AI 补本集分场"><Sparkles size={16} /></button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenUnitDetail?.(unit.id);
                      }}
                      className="flex items-center gap-1 text-[11px] font-medium text-text-secondary group-hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <span>编辑本集分场</span>
                      <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Quick Add Episode Dotted Card */}
            {project.profile.organization !== 'standalone' && (
              <button
                type="button"
                onClick={onAddUnit}
                className="min-h-[220px] rounded-2xl border-2 border-dashed border-border-primary/25 hover:border-border-primary/50 p-6 flex flex-col items-center justify-center gap-2 text-text-muted hover:text-text-primary transition-all bg-bg-surface/20 hover:bg-bg-surface-soft cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-full bg-bg-surface-soft border border-border-primary/20 group-hover:border-border-primary/40 flex items-center justify-center transition-colors">
                  <Plus size={18} />
                </div>
                <span className="text-xs font-semibold">添加下一集</span>
                <span className="text-[10px] text-text-muted/60">继续扩充全剧架构</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3B. KANBAN MODE: HORIZONTAL SCROLL CANVAS */}
      {boardLayout === 'kanban' && (
        <div className="flex-1 overflow-x-auto overflow-y-auto p-6 flex gap-6 items-start">
          {displayedUnits.map((unit, unitIdx) => {
            const unitWordCount = unit.scenes.reduce(
              (acc, s) =>
                acc + s.blocks.reduce((bAcc, b) => bAcc + (b.text || '').replace(/\s/g, '').length, 0),
              0
            );
            const hasCliffhanger = Boolean(unit.endingHook?.trim());
            const isHighlighted = highlightedUnitId === unit.id;

            return (
              <div
                key={unit.id}
                ref={(el) => {
                  unitRefs.current[unit.id] = el;
                }}
                className={`w-88 shrink-0 flex flex-col rounded-2xl bg-bg-surface border shadow-xl overflow-hidden transition-all duration-300 ${
                  isHighlighted
                    ? 'border-border-primary/60 ring-2 ring-border-primary/40 shadow-xs'
                    : 'border-border-primary/20 hover:border-border-primary/40'
                }`}
              >
                {/* Column Header: Unit Title & Word Count */}
                <div className="p-4 border-b border-border-primary/20 bg-bg-surface-soft/60 flex items-center justify-between">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-medium font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/25 shrink-0">
                        {project.profile.organization === 'standalone' ? '全片' : `第 ${unitIdx + 1} 集`}
                      </span>
                      <input
                        type="text"
                        value={unit.title}
                        onChange={(e) => onUpdateUnit({ ...unit, title: e.target.value })}
                        placeholder="集数标题"
                        className="text-xs font-bold bg-transparent text-text-primary focus:outline-none border-b border-transparent focus:border-border-primary/40 px-0.5 truncate w-full"
                      />
                    </div>
                    <div className="text-[11px] text-text-muted mt-1 flex items-center gap-2">
                      <span>{unit.scenes.length} 个场景</span>
                      <span>·</span>
                      <span className="font-mono">约 {unitWordCount} 字</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenUnitDetail?.(unit.id)}
                      title="打开本集分场详情"
                      className="p-1.5 rounded-lg hover:bg-bg-surface text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <Maximize2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddScene(unit.id)}
                      title="在本集追加场景"
                      className="p-1.5 rounded-lg hover:bg-bg-surface text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                    {project.units.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUnit(unit.id, unit.title)}
                        title="删除整集"
                        className="p-1.5 rounded-lg hover:bg-bg-surface text-text-muted hover:text-accent-red transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Optional ending direction */}
                <div className="p-3.5 border-b border-border-primary/20 bg-bg-surface/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-text-secondary flex items-center gap-1.5">
                      <Flame size={12} className="text-text-muted" />
                      <span>本集结尾安排 · 可选</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleOpenCliffhanger(unit)}
                      className="text-[11px] font-medium text-text-muted hover:text-text-primary flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles size={11} />
                      <span>AI 建议</span>
                    </button>
                  </div>

                  <div className="relative">
                    <textarea
                      value={unit.endingHook || ''}
                      onChange={(e) => onUpdateUnit({ ...unit, endingHook: e.target.value })}
                      placeholder="可选：本集如何结束？可以留下问题，也可以完成一个阶段。"
                      rows={2}
                      className={`w-full text-xs p-2.5 rounded-xl bg-bg-surface-soft border focus:outline-none resize-none leading-relaxed transition-all placeholder:text-text-muted/60 ${
                        hasCliffhanger
                          ? 'border-border-primary/30 focus:border-border-primary/40'
                          : 'border-accent-amber/40 focus:border-border-primary/40'
                      }`}
                    />
                    {!hasCliffhanger && (
                      <div className="absolute right-2 bottom-2 text-[10px] text-accent-amber flex items-center gap-0.5 pointer-events-none opacity-80">
                        <AlertTriangle size={10} />
                        <span>可选</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Scene Cards Stack */}
                <div className="p-3 space-y-3 max-h-[580px] overflow-y-auto">
                  {displayedScenes(unit).map((scene, sceneIdx) => {
                    const sceneCharCount = scene.blocks.reduce(
                      (acc, b) => acc + (b.text || '').replace(/\s/g, '').length,
                      0
                    );

                    return (
                      <div
                        key={scene.id}
                        className="group p-3.5 rounded-xl bg-bg-surface-soft/80 hover:bg-bg-surface-soft border border-border-primary/20 hover:border-border-primary/40 transition-all shadow-sm space-y-2.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 font-bold text-text-primary group-hover:text-text-primary transition-colors flex-1 min-w-0 mr-1">
                            <span className="font-mono text-text-muted shrink-0">#{sceneIdx + 1}</span>
                            <input
                              type="text"
                              value={scene.title}
                              onChange={(e) => {
                                const updated = unit.scenes.map((s) =>
                                  s.id === scene.id ? { ...s, title: e.target.value } : s
                                );
                                onUpdateUnit({ ...unit, scenes: updated });
                              }}
                              className="bg-transparent focus:outline-none border-b border-transparent focus:border-border-primary/40 truncate w-full text-xs font-semibold"
                            />
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-text-muted font-mono">
                              {sceneCharCount} 字
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteScene(unit.id, scene.id, scene.title)}
                              className="p-1 rounded-md text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="删除场景"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] text-text-muted font-medium block mb-0.5">
                            这一场发生什么
                          </span>
                          <input
                            type="text"
                            value={scene.purpose || ''}
                            onChange={(e) => {
                              const updated = unit.scenes.map((s) =>
                                s.id === scene.id ? { ...s, purpose: e.target.value } : s
                              );
                              onUpdateUnit({ ...unit, scenes: updated });
                            }}
                            placeholder="写下人物做了什么、遇到了什么或发现了什么"
                            className="w-full text-xs p-1.5 rounded-lg bg-bg-surface border border-border-primary/20 text-text-secondary focus:border-border-primary/40 focus:outline-none placeholder:text-text-muted/50"
                          />
                        </div>

                        {/* Optional change between beginning and end of a scene. */}
                        <div className="p-2 rounded-lg bg-bg-primary/50 border border-border-primary/15 space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span className="font-medium flex items-center gap-1">
                              <Flame size={10} className="text-text-muted" />
                              <span>本场前后变化 · 可选</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenSceneTurn(unit, scene)}
                              className="text-text-muted hover:text-text-primary flex items-center gap-0.5 cursor-pointer"
                            >
                              <Sparkles size={10} />
                              <span>AI 建议</span>
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 text-[11px]">
                            <input
                              type="text"
                              value={scene.entryState || ''}
                              onChange={(e) => {
                                const updated = unit.scenes.map((s) =>
                                  s.id === scene.id ? { ...s, entryState: e.target.value } : s
                                );
                                onUpdateUnit({ ...unit, scenes: updated });
                              }}
                              placeholder="开场时的状况"
                              className="flex-1 min-w-0 text-[11px] p-1 rounded bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none truncate text-text-secondary placeholder:text-text-muted/40"
                            />
                            <span className="text-text-muted shrink-0 font-bold">→</span>
                            <input
                              type="text"
                              value={scene.exitState || ''}
                              onChange={(e) => {
                                const updated = unit.scenes.map((s) =>
                                  s.id === scene.id ? { ...s, exitState: e.target.value } : s
                                );
                                onUpdateUnit({ ...unit, scenes: updated });
                              }}
                              placeholder="结束时有什么不同"
                              className="flex-1 min-w-0 text-[11px] p-1 rounded bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/40 focus:outline-none truncate text-text-primary font-medium placeholder:text-text-muted/40"
                            />
                          </div>
                        </div>

                        <div className="pt-1 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => onOpenScene(unit.id, scene.id)}
                            className="flex items-center gap-1 text-[11px] font-medium text-text-primary hover:text-text-primary bg-bg-surface hover:bg-bg-surface-soft px-2.5 py-1 rounded-lg border border-border-primary/30 transition-all cursor-pointer shadow-xs"
                          >
                            <span>进入写作</span>
                            <ArrowRight size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => onAddScene(unit.id)}
                    className="w-full py-2.5 rounded-xl border border-dashed border-border-primary/25 hover:border-border-primary/50 text-xs text-text-muted hover:text-text-primary flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-bg-surface/30 hover:bg-bg-surface-soft"
                  >
                    <Plus size={14} />
                    <span>添加新场景</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
              {recomState.job?.operation==='ending'&&<p className="text-xs text-text-secondary">当前结尾安排：{project.units.find(unit=>unit.id===recomState.job?.unitId)?.endingHook||'未填写'}</p>}
              {recomState.job?.operation==='scene_turn'&&<p className="text-xs text-text-secondary">当前场景：{project.units.find(unit=>unit.id===recomState.job?.unitId)?.scenes.find(scene=>scene.id===recomState.job?.sceneId)?.purpose||'尚未填写发生什么'}</p>}
              {recomState.isLoading ? (
                <div className="h-48 flex flex-col items-center justify-center gap-3 text-text-muted text-xs">
                  <Sparkles size={24} className="animate-spin text-text-secondary" />
                  <p>正在整理与你的构想相关的分场建议…</p>
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
                        onClick={() => handleApplyRecommendation(opt,oIdx)}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all shadow-xs cursor-pointer disabled:opacity-40"
                      >
                        <Check size={12} />
                        <span>{recomState.type==='auto_breakdown'&&pendingBoardApply?.jobId===recomState.job?.id?'确认采纳':'采纳此方案'}</span>
                      </button>
                    </div>

                    {recomState.type==='auto_breakdown'&&pendingBoardApply?.jobId===recomState.job?.id&&<div className="rounded-lg border border-border-primary/30 bg-bg-surface p-3 text-xs text-text-secondary flex flex-wrap items-center justify-between gap-2">
                      <span>将补充分场到 {pendingBoardApply.applied} 个尚未规划场景的单元；{pendingBoardApply.preserved} 个已有场景的单元保持原样。</span>
                      <button type="button" onClick={()=>setPendingBoardApply(null)} className="text-text-muted hover:text-text-primary cursor-pointer">取消</button>
                    </div>}

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
                  if (recomState.type === 'auto_breakdown') {
                    handleOpenAutoBreakdown();
                  } else if (recomState.type === 'cliffhanger' && recomState.targetUnitId) {
                    const u = project.units.find((x) => x.id === recomState.targetUnitId);
                    if (u) handleOpenCliffhanger(u);
                  } else if (
                    recomState.type === 'scene_turn' &&
                    recomState.targetUnitId &&
                    recomState.targetSceneId
                  ) {
                    const u = project.units.find((x) => x.id === recomState.targetUnitId);
                    const s = u?.scenes.find((x) => x.id === recomState.targetSceneId);
                    if (u && s) handleOpenSceneTurn(u, s);
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
