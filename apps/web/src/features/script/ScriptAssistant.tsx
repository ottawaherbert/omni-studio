import { useScriptSkills } from './useScriptSkills';
import { useSettingsStore } from '../../clients/stateClient';
import { availableMethods, buildScriptTaskContext, OPERATION_LABELS, INPUT_LABELS, methodUsage } from '../../../../../packages/script/src/methods';
import { useEffect, useMemo, useRef, useState } from 'react';
import PromptEditorModal from '../../../../../src/components/PromptEditorModal';
import { generateAIContent } from '../../clients/aiClient';
import { scriptClient } from '../../clients/scriptClient';
import type { ScriptProject, DeliveryUnit, Scene } from '../../../../../packages/script/src/schema';
import type { ScriptJob, ScriptOperation,ReviewSource,ReviewSceneHandler,TextSelection } from '../../../../../packages/script/src/proposals';
import {scopeOptions} from '../../../../../packages/script/src/continuity';
import {ReviewFindingActions} from './components/ReviewFindingActions';
import {usePromptStore} from '../../clients/stateClient';
import {withManualAIResult} from '../../clients/manualAIClient';
import {ScriptManualReturn} from './components/ScriptManualReturn';
import {blocksToScreenplayText} from '../../../../../packages/script/src/fountainAdapter';

import { SCRIPT_TASK_CONTRACTS as contracts } from '../../../../../packages/script/src/taskContracts';
import {legacyTaskAnchor,unreturnedPlanningUnits} from './scriptAssistantIntent';

const EMPTY_CONTEXT: [] = [];
const labels = OPERATION_LABELS;

export function ScriptAssistant({ project, unit, scene, dirty, onSave, onApplied, onReviewScene, initialOperation, initialIssue,initialReviewSource,initialSelection,onOpenScene,submission,unitIndices,historyOnly=false }: { historyOnly?:boolean;unitIndices?:number[]; submission?:{id:number;channel:'api'|'external';methodIds:string[]}; project: ScriptProject; unit: DeliveryUnit; scene?: Scene; dirty: boolean; onSave:()=>Promise<void>; onApplied: (project: ScriptProject, base: ScriptProject) => void; onReviewScene?: ReviewSceneHandler; initialOperation?: ScriptOperation | null; initialIssue?: string;initialReviewSource?:ReviewSource;initialSelection?:TextSelection;onOpenScene:(sceneId:string)=>void }) {
  const templates=usePromptStore(state=>state.templates);
  const {methods,error:skillsError,loaded:skillsLoaded}=useScriptSkills();
  const skillProject=useMemo(()=>({...project,methods}),[project,methods]);
  const launching=useRef(false);
  const [operation, setOperation] = useState<ScriptOperation | null>(null);
  const [pendingOperation,setPendingOperation]=useState<ScriptOperation|null>(initialOperation||'consult');
  const [taskMethodIds,setTaskMethodIds]=useState<string[]>(submission?.methodIds||[]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<ScriptJob[]>([]);
  const [hasMore,setHasMore]=useState(false);
  const [discussion,setDiscussion]=useState<ScriptJob[]>([]);
  const [authorRequest,setAuthorRequest]=useState(initialIssue||'');
  const isTestMode=useSettingsStore(state=>state.isTestMode);
  const [selectedExecutionMode,setExecutionMode]=useState<'api'|'manual'>(submission?.channel==='external'?'manual':'api');
  const executionMode=isTestMode?selectedExecutionMode:'api';
  const submitted=useRef<number|undefined>(undefined);
  const [manualJobId,setManualJobId]=useState('');
  const messageHistory=useRef<HTMLDivElement>(null);
  const [scopeId,setScopeId]=useState(unit.scopeId);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  const latest = useRef({ project, dirty }); latest.current = { project, dirty };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = async () => { const [r,d] = await Promise.all([scriptClient.listJobs(project.id,{unitId:unit.id,standalone:true}),scriptClient.listJobs(project.id,{sceneId:scene?.id||unit.id,operation:'consult',status:'ready',limit:8})]); if (alive.current) {setJobs(r.jobs);setHasMore(r.jobs.length===100);setDiscussion(d.jobs);} window.dispatchEvent(new Event('script-jobs-changed')); };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [project.id, project.revision,unit.id,scene?.id]);
  useEffect(() => { setSelectedBlockIds([]); setOperation(null); setPendingOperation(initialOperation||'consult');setTaskMethodIds(submission?.methodIds||[]);setAuthorRequest(initialIssue||'');setScopeId(unit.scopeId); }, [unit.id,scene?.id,initialOperation,initialIssue,initialReviewSource?.jobId,initialReviewSource?.index,initialSelection]);
  useEffect(() => { setSelectedBlockIds(ids => { const kept=ids.filter(id=>scene?.blocks.some(b=>b.id===id)); return kept.length===ids.length?ids:kept; }); }, [scene?.blocks]);
  const variables = useMemo(() => {
    const operation=pendingOperation;
    if(!operation)return {taskContract:'',scriptContext:'',methodInstructions:''};
    const task=buildScriptTaskContext(skillProject,unit,operation,taskMethodIds.filter(id=>methods.some(m=>m.id===id)),scene?.id,operation==='review'&&scene?[scene.id]:undefined);
    return {taskContract:contracts[operation]+(unitIndices?`\n本批仅处理第 ${unitIndices.join('、')} 集；结果不得包含其余集。`:'')+(authorRequest?`\n【作者要求${initialReviewSource&&operation==='review'?'，请仅复查这条问题；已解决则 findings 为空':''}】\n${authorRequest}`:''),methodInstructions:task.instructions,
      scriptContext:JSON.stringify({...task.context,...(operation==='consult'?{contextSource:dirty?'作者尚未保存的本机草稿':'已保存稿'}:{}),...(scene?{targetSceneId:scene.id}:{}),...(operation==='rewrite'?{selectedBlockIds}:{}),...(operation==='text_rewrite'?{selectedText:initialSelection}:{}),...(['character','fact'].includes(operation)?{writeScopeId:scopeId}:{}),...(operation==='consult'?{previousDiscussion:discussion.filter(j=>j.operation==='consult'&&j.sceneId===(scene?.id||unit.id)&&j.status==='ready').slice(0,8).reverse().map(j=>({question:j.authorRequest||'见该任务提示词',answer:j.result?.answer?.slice(0,4000),revision:j.baseRevision})),discussionCoverage:'最近 8 次已完成讨论，每条答复最多 4000 字；旧稿讨论不代表当前稿事实'}:{})},null,2)};
  }, [project, methods, unit, scene?.id, pendingOperation, selectedBlockIds,taskMethodIds,authorRequest,initialSelection,scopeId,discussion,initialReviewSource,dirty,unitIndices]);
  useEffect(()=>{if(pendingOperation==='consult'&&messageHistory.current)messageHistory.current.scrollTop=messageHistory.current.scrollHeight;},[jobs[0]?.id,jobs[0]?.status,pendingOperation]);
  const template=templates[pendingOperation==='consult'?'scriptChat':'scriptAssist'].template;
  const prompt=template.replace(/\{\{(\w+)\}\}/g,(_match,key)=>variables[key as keyof typeof variables]||'');
  const createJob=async(finalPrompt:string)=>{
    const operation=pendingOperation;
    if(!operation||(operation!=='consult'&&latest.current.dirty)||JSON.stringify(latest.current.project)!==JSON.stringify(project))throw new Error('当前稿已改变，请保存后重新发起。');
    if(taskMethodIds.length&&(!skillsLoaded||taskMethodIds.some(id=>!methods.some(m=>m.id===id))))throw new Error(skillsError||'所选 Skill 已不可用，请从全局技能库重新选择。');
    const targetId=legacyTaskAnchor(unit,operation,scene?.id);
    return (await scriptClient.createJob(skillProject,unit.id,targetId,operation,finalPrompt,operation==='rewrite'?selectedBlockIds:undefined,taskMethodIds,operation==='review'?[targetId]:undefined,undefined,['scene','rewrite','review'].includes(operation)?initialReviewSource:undefined,{authorRequest,...(unitIndices&&['unit_outlines','board_plan'].includes(operation)?{unitIndices}:{}),...(operation==='text_rewrite'?{selection:initialSelection}:{}),...(['character','fact'].includes(operation)?{scopeId}:{})})).job;
  };
  const executeJob = async (job:ScriptJob) => {
    let provenance:ScriptJob['provenance'];
    let executionPrompt:ScriptJob['executionPrompt'];
    try {
      const raw=await generateAIContent({prompt:job.prompt,requireJson:job.operation!=='consult',taskType:job.operation==='review'?'qcAnalyzer':'scriptGen',onPromptComposed:value=>{executionPrompt={prompt:value.prompt,systemInstruction:value.systemInstruction};},onExecutionProvenance:value=>{provenance={source:value.source,provider:value.provider,modelId:value.modelId};}});
      const result=await scriptClient.submitJob(job,raw,provenance,executionPrompt);
      if(result.job.status==='failed')throw new Error(result.job.error);
    }catch(cause){
      await scriptClient.failJob(job,cause instanceof Error?cause.message:'回复未完成').catch(()=>{});
      throw cause;
    }finally{await refresh().catch(()=>{});}
  };
  const submit = async (finalPrompt: string) => {
    setWorking(true);setError('');
    try {
      const job=await createJob(finalPrompt);
      if(job.operation==='consult')setAuthorRequest('');
      await refresh();
      await executeJob(job);
    }finally{if(alive.current)setWorking(false);}
  };
  const start=async()=>{
    if(launching.current)return;
    launching.current=true;setError('');setWorking(true);
    try {
      if(executionMode==='manual'){
        const job=await createJob(prompt);setManualJobId(job.id);if(job.operation==='consult')setAuthorRequest('');await refresh();
      }else await withManualAIResult(prompt,undefined,()=>submit(prompt));
    }catch(cause){setError(cause instanceof Error?cause.message:'任务未完成');}
    finally{launching.current=false;if(alive.current)setWorking(false);}
  };
  useEffect(()=>{if(!submission||(!skillsLoaded&&submission.methodIds.length>0)||submitted.current===submission.id||pendingOperation!==initialOperation||authorRequest!==initialIssue)return;
    submitted.current=submission.id;void start();
  },[submission?.id,pendingOperation,authorRequest,initialOperation,initialIssue,skillsLoaded]);
  const submitManual=async(job:ScriptJob,raw:string)=>{
    if(job.operation!=='consult'&&(latest.current.dirty||latest.current.project.revision!==job.baseRevision))throw new Error('当前稿已改变，旧任务已保留；请从新稿重新发起。');
    setWorking(true);
    try{
      const result=await scriptClient.submitJob(job,raw,{source:'manual_external',provider:'manual_external',modelId:'manual_external'},{prompt:job.prompt,systemInstruction:''});
      await refresh();
      if(result.job.status==='failed')throw new Error(result.job.error);
      setManualJobId('');
    }finally{if(alive.current)setWorking(false);}
  };
  const transition = async (job: ScriptJob, action: 'approve' | 'reject' | 'cancel',choiceIndex?:number) => {
    if (action === 'approve' && latest.current.dirty) { setError('请先保存当前改稿；原提案会保留供参考。'); return; }
    setError('');
    const base = latest.current.project;
    try {
      const result = await scriptClient.transitionJob(job, action,choiceIndex);
      if (result.project) {
        onApplied(result.project, base);

      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
  };
  const decideFinding=async(job:ScriptJob,index:number,status:'to_fix'|'keep'|'later')=>{
    setError('');setWorking(true);
    try{await scriptClient.recordReviewDecision(job,index,status);await refresh();}
    catch(cause){setError(cause instanceof Error?cause.message:'保存审阅决定失败');}
    finally{if(alive.current)setWorking(false);}
  };
  const composer=(<div className="space-y-3">
      {pendingOperation!=='consult'&&<div className="sw-inline"><strong>{pendingOperation?labels[pendingOperation]:''}</strong><button disabled={working} onClick={()=>{setPendingOperation('consult');setTaskMethodIds([]);setOperation(null);setAuthorRequest('');}}>返回对话</button></div>}
      {['scene','rewrite'].includes(pendingOperation||'')&&scene?.blocks.some(block=>block.text.trim())&&<div className="sw-inline"><span>修改范围</span><button aria-pressed={pendingOperation==='scene'} disabled={working} onClick={()=>setPendingOperation('scene')}>本场全文</button><button aria-pressed={pendingOperation==='rewrite'} disabled={working} onClick={()=>setPendingOperation('rewrite')}>只改勾选的段落</button></div>}
      {pendingOperation==='rewrite'&&<div className="sw-rewrite-selection">{scene?.blocks.map((block,index)=><label key={block.id}><input type="checkbox" disabled={working} checked={selectedBlockIds.includes(block.id)} onChange={()=>setSelectedBlockIds(ids=>ids.includes(block.id)?ids.filter(id=>id!==block.id):[...ids,block.id])}/><span>{index+1}. {block.text.slice(0,100)||'空白段落'}</span></label>)}</div>}
      <label className="sw-field">{pendingOperation==='consult'?'给 AI 的消息':'你的要求'}<textarea aria-label={pendingOperation==='consult'?'给 AI 的消息':'你的要求'} disabled={working} rows={3} value={authorRequest} onChange={event=>setAuthorRequest(event.target.value)} placeholder={pendingOperation==='consult'?'直接说你的想法、贴文字，或告诉我希望怎么改…':'例如：父女一起修车，不煽情；保留结尾，不增加主要人物。'}/></label>
      <p className="sw-muted" hidden={pendingOperation==='consult'}>{pendingOperation==='scene'?`结果是一份「${scene?.title||'当前场'}」的完整候选稿，采用后只替换本场正文。`:pendingOperation==='text_rewrite'?'结果只替换下面选中的文字，其余原文保留。':pendingOperation==='rewrite'?'结果只替换勾选的连续段落，其他段落和场景保留。':pendingOperation==='review'?'结果是指向本场原文的审阅意见，可以据此修改和复查。':'结果先作为候选供你比较，采用后才修改对应的资料或规划。'}</p>
      {pendingOperation==='text_rewrite'&&<blockquote className="whitespace-pre-wrap border-l-2 pl-3 select-text">{initialSelection?.text}</blockquote>}
      {pendingOperation&&['character','fact'].includes(pendingOperation)&&<label>新增到<select value={scopeId} onChange={event=>setScopeId(event.target.value)}>{scopeOptions(project).filter(scope=>[project.id,unit.id,unit.scopeId,unit.seasonId].includes(scope.id)).map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select></label>}
      {pendingOperation&&<details><summary>写作方法（可选）{taskMethodIds.length?` · 已选 ${taskMethodIds.length} 项`:''}</summary>
        <div className="sw-methods">{availableMethods(skillProject,pendingOperation).map(m=><label key={m.id}><input type="checkbox" disabled={working||(dirty&&pendingOperation!=='consult')} checked={taskMethodIds.includes(m.id)} onChange={()=>setTaskMethodIds(ids=>ids.includes(m.id)?ids.filter(id=>id!==m.id):[...ids,m.id])}/>{m.title} · v{m.version}</label>)}</div>
        <p className="sw-muted">{availableMethods(skillProject,pendingOperation).length?'仅使用勾选的方法。':'没有为本次工作选择方法，也可以直接开始。'}</p>
        <a href="/skills" target="_blank" rel="noreferrer">打开全局技能库</a>{skillsError&&<p role="alert">{skillsError}</p>}
        <p className="sw-muted">附加资料：{[...new Set(methods.filter(m=>taskMethodIds.includes(m.id)).flatMap(m=>methodUsage(m).inputs))].map(input=>INPUT_LABELS[input]).join('、')||'无'}</p>
      </details>}
      {dirty&&pendingOperation!=='consult'&&<div className="sw-inline"><p>当前有未保存的改稿，先保存这份稿件作为本次依据。</p><button disabled={working} onClick={()=>void onSave()}>保存当前稿</button></div>}
      {isTestMode&&<details><summary>发送设置</summary><label className="sw-field">执行方式<select aria-label="执行方式" disabled={working} value={executionMode} onChange={event=>setExecutionMode(event.target.value as 'api'|'manual')}><option value="api">使用已配置模型</option><option value="manual">复制提示词，手动粘贴返回</option></select></label></details>}
      <div className="sw-inline"><button className="sw-primary" disabled={(dirty&&pendingOperation!=='consult')||working||!pendingOperation||(pendingOperation==='rewrite'&&!selectedBlockIds.length)||(pendingOperation==='consult'&&!authorRequest.trim())} onClick={()=>void start()}>{working?'处理中…':pendingOperation==='consult'?'发送':executionMode==='manual'?'准备本次提示词':'生成候选结果'}</button><button disabled={(dirty&&pendingOperation!=='consult')||working||!pendingOperation} onClick={()=>setOperation(pendingOperation)}>查看或调整提示词</button></div>
    </div>);
  return <section className="sw-assistant">
    {submission&&<div className="space-y-2"><p className="whitespace-pre-wrap">{initialIssue}</p>{working&&<p role="status">正在处理本次需求…</p>}{error&&<button disabled={working} onClick={()=>void start()}>重试本次需求</button>}</div>}
    <p className="sw-muted">当前单元：{unit.title}{scene&&<> · 当前场：{scene.title}</>} · {dirty?'参考尚未同步的当前稿':'当前已保存稿'}</p>
    {initialReviewSource&&<p className="sw-muted">本次关联原审阅意见。采用改稿后会标记“待复查”；回到原意见点击“用当前稿复查”，即可复查这条问题，结果和检查依据会记录在原意见中。</p>}
    {!historyOnly&&!submission&&pendingOperation!=='consult'&&composer}
    <div ref={messageHistory} className={submission||historyOnly?'space-y-3 select-text':'max-h-[35vh] overflow-y-auto space-y-3 select-text'}>
    <h3 className="mt-4 font-semibold">对话与结果</h3>
    {error && <p role="alert">{error}</p>}
    {(pendingOperation==='consult'?[...jobs].reverse():jobs).filter(j => j.unitId === unit.id && !j.agentRunId).map(job => {const missingUnits=unreturnedPlanningUnits(job);return <details className="sw-proposal" key={job.id} open={job.status === 'ready' || job.status === 'failed' || job.status === 'waiting'}>
      <summary>{job.operation==='consult'?'对话':labels[job.operation]} · {job.operation==='consult'&&job.status==='ready'?'已答复':{ waiting: '等待返回', ready: '待审阅', failed: '未完成 / 校验失败', cancelled: '已取消', approved: '已采用', rejected: '已放弃' }[job.status]}</summary>
      {job.operation!=='consult'&&job.provenance && <p className="sw-muted">{job.provenance.source === 'manual_external' ? '手动回填' : '接口返回'} · {job.provenance.modelId}</p>}
      <p className="sw-muted" hidden={job.operation==='consult'}>本次 Skill：{job.methods.map(m=>`${m.title} · v${m.version}`).join('、')||'未选用'}</p>
      {job.operation!=='consult'&&job.baseRevision !== project.revision && job.status === 'ready' && <p>{job.operation==='review'?'这次审阅针对检查时的原文，可查看原文，或用当前稿复查。':'基线已变化，仅供参考。请从当前稿重新生成。'}</p>}
      {job.error && <p role="alert">{job.error}</p>}
      {missingUnits.length>0&&<p aria-label="本批未返回项" className="sw-muted">本批尚未全部返回：第 {missingUnits.join('、')} 集未返回。已有稿件保持原样，可稍后继续规划这些集；采用时只处理已返回的内容。</p>}
      {job.operation==='consult'&&<p className="whitespace-pre-wrap">你：{job.authorRequest||'见提示词'}</p>}
      {job.result && <>{job.operation!=='consult'&&<p>{job.result.summary}</p>}
        {job.operation==='consult' ? <><pre aria-label="AI 回复">{job.result.answer}</pre><button hidden={historyOnly} disabled={working} onClick={()=>{setPendingOperation('scene');setTaskMethodIds([]);setAuthorRequest(`根据下面讨论，试写当前场。保留作者意图；建议尚未成为设定，请只采用适合本场的部分。\n我的问题：${job.authorRequest||''}\n讨论答复（以当前稿为准）：\n${job.result?.answer||''}\n本次试写要求：`);document.querySelector('[aria-label="你的要求"]')?.scrollIntoView({block:'center'});}}>用这条回复继续写本场</button></> : job.result.suggestions ? <>
          <p className="sw-muted">{job.operation==='character'?'采用一个方案，新增一位人物':job.operation==='fact'?'采用一个方案，新增一条待确认设定':'采用一个方案更新对应字段'}{job.scopeId?` · 范围：${scopeOptions(project).find(scope=>scope.id===job.scopeId)?.label||job.scopeId}`:''}</p>
          {['concept','theme'].includes(job.operation)&&<details><summary>当前稿</summary><pre>{project.brief[job.operation as 'concept'|'theme']}</pre></details>}
          {job.result.suggestions.map((suggestion,index)=><article key={index}><h3>{suggestion.title}</h3><pre>{[suggestion.name,suggestion.content,suggestion.voice,suggestion.desire,suggestion.need].filter(Boolean).join('\n')}</pre>{job.status==='ready'&&<button disabled={working||dirty||job.baseRevision!==project.revision} onClick={()=>void transition(job,'approve',index)}>采用此方案</button>}{job.selectedChoiceIndex===index&&<p>已采用此方案</p>}</article>)}
        </> : job.result.choices?.length ? job.result.choices.map((choice,index)=><article key={index}><h3>{choice.title}</h3><p>{choice.subtitle}</p><pre>{choice.content}</pre>{job.status==='ready'&&<button disabled={working||dirty||job.baseRevision!==project.revision} onClick={()=>void transition(job,'approve',index)}>采用此方案</button>}{job.selectedChoiceIndex===index&&<p>已采用此方案</p>}</article>) : job.operation==='review' ? job.result.findings?.map((finding,i)=><article key={i}><strong>{unit.scenes.find(s=>s.id===finding.sceneId)?.title}</strong><p>{finding.issue}</p><p>{finding.suggestion}</p><ReviewFindingActions job={job} index={i} working={working} currentRevision={project.revision} dirty={dirty} onDecide={(...args)=>void decideFinding(...args)} onReviewScene={onReviewScene}/></article>) : <div className="sw-proposal-comparison"><div><h3>当前稿</h3><pre>{job.operation==='outline'?project.brief.outline:job.operation==='unit_outline'?unit.summary:job.operation==='text_rewrite'?job.selection?.text:['unit_outlines','board_plan'].includes(job.operation)?project.units.map((u,i)=>`${i+1}. ${u.title}：${u.summary||'未写大纲'}${job.operation==='board_plan'?'\n'+u.scenes.map(s=>s.title+'：'+s.purpose).join('\n'):''}`).join('\n\n'):job.operation==='plan'?unit.scenes.map(s=>`${s.title}：${s.purpose||'待写'}`).join('\n'):blocksToScreenplayText(unit.scenes.find(s=>s.id===job.sceneId)?.blocks.filter(b=>job.operation!=='rewrite'||job.blockIds?.includes(b.id))||[],project.characters)}</pre></div>
          <div><h3>{['unit_outlines','board_plan'].includes(job.operation)?'提案 · 仅填空白，已有内容保留':job.operation==='plan'?'提案 · 仅新增分场':['rewrite','text_rewrite'].includes(job.operation)?'提案 · 仅替换选中范围':'提案 · 替换对应内容'}</h3><pre>{job.result.replacement||job.result.outline||job.result.units?.map(u=>`${u.unitIndex}. ${u.title||''}\n${u.summary||''}\n${u.scenes?.map(s=>s.title+'：'+s.purpose).join('\n')||''}`).join('\n\n')||job.result.scenePlans?.map(s=>`${s.title}：${s.purpose}`).join('\n')||blocksToScreenplayText(job.result.blocks||[],project.characters)}</pre></div>
        </div>}
      </>}
      {isTestMode&&job.id===manualJobId&&['waiting','failed'].includes(job.status)&&<ScriptManualReturn job={job} disabled={working||(dirty&&job.operation!=='consult')} onSubmit={raw=>submitManual(job,raw)}/>}
      {job.status==='approved'&&['scene','rewrite','text_rewrite'].includes(job.operation)&&<button onClick={()=>onOpenScene(job.sceneId)}>回到正文继续写</button>}
      <details><summary>提示词与返回原文</summary>{job.operation==='consult'&&<p className="sw-muted">{job.provenance?.source==='manual_external'?'手动回复':'模型回复'} · 方法：{job.methods.map(method=>`${method.title} v${method.version}`).join('、')||'未选用'}</p>}<pre>{job.executionPrompt?[job.executionPrompt.systemInstruction,job.executionPrompt.prompt].filter(Boolean).join('\n\n'):job.prompt}</pre>{job.rawResult && <pre>{job.rawResult}</pre>}</details>
      {(job.attempts?.length||0)>1&&<details><summary>返回尝试记录（{job.attempts!.length} 次）</summary>{job.attempts!.map((attempt,index)=><div key={index}><p>第 {index+1} 次 · {attempt.error||'校验通过'}</p><pre>{attempt.rawResult}</pre></div>)}</details>}
      <div className="sw-inline">{isTestMode&&['waiting','failed'].includes(job.status)&&job.id!==manualJobId&&<button disabled={working||(job.operation!=='consult'&&(dirty||job.baseRevision!==project.revision))} onClick={()=>setManualJobId(job.id)}>粘贴或补交返回</button>}{job.status === 'ready' && !['review','consult','concept','theme','character','fact','ending','scene_turn'].includes(job.operation) && <button disabled={dirty || (job.baseRevision !== project.revision&&!(job.operation==='unit_outlines'&&job.unitBatch))} onClick={() => void transition(job, 'approve')}>{job.operation==='unit_outlines'&&job.baseRevision!==project.revision?'重新核对集号并采用':'采用并更新当前稿'}</button>}{job.operation!=='consult'&&['ready', 'failed'].includes(job.status) && <button onClick={() => void transition(job, 'reject')}>放弃提案</button>}{job.status === 'waiting' && <button onClick={() => void transition(job, 'cancel')}>{job.operation==='consult'?'取消等待':'取消回写'}</button>}</div>
    </details>;})}
    {hasMore&&<button disabled={working} onClick={()=>void scriptClient.listJobs(project.id,{unitId:unit.id,standalone:true,before:jobs.at(-1)?.id}).then(({jobs:older})=>{setJobs(current=>[...current,...older.filter(job=>!current.some(existing=>existing.id===job.id))]);setHasMore(older.length===100);}).catch(cause=>setError(cause.message))}>加载更早的任务</button>}
    </div>
    {!historyOnly&&!submission&&pendingOperation==='consult'&&composer}
    {operation && <PromptEditorModal isOpen onClose={() => setOperation(null)} templateId={pendingOperation==='consult'?'scriptChat':'scriptAssist'} variables={variables} title={labels[operation]} manualResultKind="text" contextOptions={EMPTY_CONTEXT} onConfirm={submit} />}
  </section>;
}
