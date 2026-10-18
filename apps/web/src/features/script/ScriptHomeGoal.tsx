import { useScriptExecutionChannel } from './useScriptExecutionChannel';
import { isPlanningStage, stageLabels, type ScriptStage } from '../../../../../packages/script/src/agentStages';
import { useEffect, useRef, useState } from 'react';
import { scriptAgentClient, type ScriptAuthorCommand, type ScriptGoalView } from '../../clients/scriptClient';
import { scriptConversationClient } from '../../clients/scriptConversationClient';
import type { AgentRun } from '../../../../../packages/agent-core/src';
import type { ExternalRequest } from '../../../../../packages/agent-core/src';
import type { ScriptWorkspace } from '../../../../api/src/repositories/scriptWorkspaceStore';
import { exportText } from '../../../../../packages/script/src/exporters';
import { goalSceneLimitTarget } from './scriptGoalAuthoring';
import type { ScriptDraftScope } from '../../../../../packages/script/src/agentScope';
import type { SkillDTO } from '../../../../../packages/domain/src/skill';

const working=(run:AgentRun)=>['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL'].includes(run.status);
const labels:Record<string,string>={QUEUED:'准备中',RUNNING:'创作中',WAITING_STEP:'正在完成一步工作',WAITING_EXTERNAL:'等待模型返回',WAITING_INPUT:'等你决定',PAUSED:'已暂停',PARTIAL:'尚未完成',FAILED:'本次执行未完成',SUCCEEDED:'已完成检查，可审阅采用',NEEDS_REBASE:'资料已变化，需要重新核对',RECONCILIATION_REQUIRED:'上次返回待核对',CANCELED:'已取消'};
const draftKey=(id:string)=>`omni.script.external.draft.${id}`;
export function ScriptHomeExternalRequest({request,onSubmitted}:{request:ExternalRequest;onSubmitted?:()=>void}){
  const {isTestMode}=useScriptExecutionChannel();
  const [text,setText]=useState(()=>{try{return localStorage.getItem(draftKey(request.id))||'';}catch{return '';}});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const prompt=[request.request.systemInstruction,request.request.prompt].filter(Boolean).join('\n\n');
  const update=(value:string)=>{setText(value);try{localStorage.setItem(draftKey(request.id),value);}catch{setError('浏览器未能保存回填草稿，请先复制内容。');}};
  const submit=async()=>{
    if(busy||!text.trim())return;
    setBusy(true);setError('');
    try{await scriptAgentClient.submitExternal(request,text,{name:'author-external-return'});
      localStorage.removeItem(draftKey(request.id));setText('');onSubmitted?.();}
    catch(cause){setError((cause as Error).message);}
    finally{setBusy(false);}
  };
  if(!isTestMode)return <p className="text-xs text-text-muted">这是一条尚未完成的测试请求。可在设置中开启测试模式后继续，或取消本次任务。</p>;
  return <details open className="rounded-xl bg-bg-surface-soft p-3 space-y-2 text-xs">
    <summary className="font-medium cursor-pointer">等待手动回填 · {request.request.operationKey}</summary>
    <p className="text-text-muted">请求摘要 {request.inputHash}</p>
    {request.redacted?<p role="alert" className="text-accent-red">来源已撤回，原提示词不可继续使用。</p>:<>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{prompt}</pre>
      <button type="button" onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setCopied(true)).catch(()=>setError('复制失败，请展开提示词手动复制。'))}>{copied?'已复制提示词':'复制提示词'}</button>
      <textarea aria-label={`模型返回原文 ${request.request.operationKey}`} rows={5} value={text} onChange={event=>update(event.target.value)} className="w-full bg-bg-primary p-3 rounded-lg"/>
      <button type="button" disabled={busy||!text.trim()} onClick={()=>void submit()}>{busy?'正在提交…':'提交本次返回'}</button>
    </>}
    {error&&<p role="alert" className="text-accent-red">{error}</p>}
  </details>;
}

/** The home conversation keeps its place while the shared Goal works. A new
 * manuscript is created only when its author adopts this fixed draft. */
export function ScriptHomeGoal({goalId,onOpen,skills}:{goalId:string;onOpen:(projectId:string)=>void;skills:SkillDTO[]}){
  const [view,setView]=useState<{goal:ScriptGoalView;run:AgentRun;workspace:ScriptWorkspace}|null>(null);
  const [external,setExternal]=useState<ExternalRequest[]>([]);
  const [answer,setAnswer]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [objective,setObjective]=useState(''),[skillIds,setSkillIds]=useState<string[]>([]);
  const {isTestMode,channel,setChannel}=useScriptExecutionChannel();
  const [maxScenes,setMaxScenes]=useState(4);
  const [preview,setPreview]=useState<{revision:number;proposal:{id:string;digest:string;document:ScriptWorkspace['document']}}|null>(null);
  const generation=useRef(0),mounted=useRef(true);
  const pendingKey=`omni.script.home.goal.command.${goalId}`,adoptionKey=`omni.script.home.goal.adopt.${goalId}`;
  const refresh=async()=>{
    const request=++generation.current,result=await scriptAgentClient.goal(goalId);
    const [workspace,requests]=await Promise.all([scriptAgentClient.workspace(result.goal.workspaceId),scriptAgentClient.goalExternal(goalId)]);
    if(mounted.current&&request===generation.current){setView({...result,workspace:workspace.workspace});setExternal(requests.externalRequests.map(row=>row.request));}
  };
  useEffect(()=>{mounted.current=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await refresh();}catch(e){if(mounted.current)setError((e as Error).message);}if(mounted.current)timer=setTimeout(poll,3000);};
    void poll();return()=>{mounted.current=false;generation.current++;clearTimeout(timer);};
  },[goalId]);
  useEffect(()=>{
    if(!view)return;
    const {goal,workspace}=view,scope=(goal.revision.contract.value as {scope:ScriptDraftScope}).scope;
    const pending=scope.newUnitSlots.find(slot=>!workspace.document.units.some(unit=>unit.id===slot.unitId));
    setObjective(goal.revision.objective);
    setSkillIds((goal.revision.skillManifest as Array<{id:string}>).map(item=>item.id.replace(/^skill:/,'')));
    setChannel(goal.revision.route.channel);
    const first=scope.units[0];
    setMaxScenes(Math.max(1,pending?.maxNewScenes??(first?first.maxNewScenes+(goal.createdSceneCounts?.[first.unitId]??0):4)));
  },[goalId,view?.goal.activeRevision]);
  const act=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await action();await refresh();}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}};
  const send=async(command:ScriptAuthorCommand)=>{
    const pending=localStorage.getItem(pendingKey);
    if(pending)throw new Error('上次决定的接收结果尚未确定，请先核对。');
    localStorage.setItem(pendingKey,JSON.stringify(command));
    try{await scriptAgentClient.submit(command);localStorage.removeItem(pendingKey);setAnswer('');}
    catch(e){const status=(e as any).status;if(status>=400&&status<500)localStorage.removeItem(pendingKey);throw e;}
  };
  const continueGoal=(choiceId?:string,text=answer)=>act(async()=>{
    if(view?.goal.revision.route.channel==='external'&&!isTestMode)throw new Error('此委托使用测试回填，请开启测试模式，或修改委托改用 API。');
    if(!view)return;const question=view.goal.pendingQuestion;
    const conversation=await scriptConversationClient.get(view.goal.threadId);
    await send({kind:'GOAL_CONTINUE',requestId:crypto.randomUUID(),threadId:view.goal.threadId,expectedConversationVersion:conversation.conversation.version,
      goalId:view.goal.id,expectedGoalVersion:view.goal.version,expectedRunVersion:view.run.version,
      ...(question?{answer:{decisionId:question.decisionId,text,...(choiceId?{choiceId}:{})}}:{})});
  });
  const reviseGoal=()=>act(async()=>{
    if(!view)return;
    const {goal,run,workspace}=view,scope=(goal.revision.contract.value as {scope:ScriptDraftScope}).scope;
    const pending=scope.newUnitSlots.find(slot=>!workspace.document.units.some(unit=>unit.id===slot.unitId));
    const first=scope.units[0];
    const originalScenes=Math.max(1,pending?.maxNewScenes??(first?first.maxNewScenes+(goal.createdSceneCounts?.[first.unitId]??0):4));
    const originalSkills=(goal.revision.skillManifest as Array<{id:string}>).map(item=>item.id.replace(/^skill:/,''));
    if(!objective.trim())throw new Error('写下修改后的创作目标');
    if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>1000)throw new Error('场数应为 1 到 1000 的整数');
    const changes:Partial<Extract<ScriptAuthorCommand,{kind:'GOAL_CONTINUE'|'GOAL_REVISE'}>>={};
    if(objective.trim()!==goal.revision.objective)changes.objective=objective.trim();
    if(JSON.stringify(skillIds)!==JSON.stringify(originalSkills))changes.methodIds=skillIds;
    if(channel!==goal.revision.route.channel)changes.executionChannel=channel;
    if(maxScenes!==originalScenes)changes.target=goalSceneLimitTarget(scope,workspace,maxScenes);
    if(!Object.keys(changes).length)throw new Error('目标、Skill、执行方式或场数尚未改变');
    const conversation=await scriptConversationClient.get(goal.threadId);
    await send({kind:'GOAL_REVISE',requestId:crypto.randomUUID(),threadId:goal.threadId,expectedConversationVersion:conversation.conversation.version,
      goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:run.version,...changes});
  });
  if(!view)return <p className="text-sm text-text-muted" role="status">{error||'正在读取创作进度…'}</p>;
  const {goal,run,workspace}=view,question=goal.pendingQuestion;
  const stage=(goal.revision.contract.value as {stopAfter?:ScriptStage}).stopAfter;
  const draftText=(doc:ScriptWorkspace['document'])=>isPlanningStage(stage)?[doc.title,doc.brief.concept,doc.brief.theme,doc.brief.outline,...doc.units.flatMap(unit=>[unit.title,unit.summary,...unit.scenes.map(scene=>[scene.title,scene.purpose,scene.location,scene.timeOfDay,scene.entryState,scene.exitState].filter(Boolean).join(' · '))])].filter(Boolean).join('\n\n'):exportText(doc,'fountain');
  let pending=false,pendingAdoption=false;try{pending=!!localStorage.getItem(pendingKey);pendingAdoption=!!localStorage.getItem(adoptionKey);}catch{}
  return <section aria-label="Agent 创作进度" className="space-y-3 text-sm">
    <div className="flex flex-wrap justify-between gap-3"><strong>{workspace.document.title}</strong><span role="status">{run.status==='SUCCEEDED'&&isPlanningStage(stage)?'阶段工作稿已完成，待你审阅':labels[run.status]||run.status}</span></div>
    {stage&&<p>本次做到：{stageLabels[stage]}。完成后停止，下一步由你决定。</p>}
    <p className="text-text-muted">{workspace.document.profile.workType} · 本次目标 {Math.round(workspace.document.units[0].targetDurationMs/60000)} 分钟</p>
    {error&&<p role="alert" className="text-accent-red">{error}</p>}
    {external.filter(request=>request.status==='WAITING').map(request=><ScriptHomeExternalRequest key={request.id} request={request} onSubmitted={()=>void refresh().catch(cause=>setError((cause as Error).message))}/>)}
    {pending&&<button disabled={busy} onClick={()=>void act(async()=>{await scriptAgentClient.submit(JSON.parse(localStorage.getItem(pendingKey)!));localStorage.removeItem(pendingKey);setAnswer('');})}>核对上次决定</button>}
    {question&&<div className="space-y-2"><p>{question.message}</p>
      <div className="flex flex-wrap gap-2">{question.choices.map(choice=><button key={choice.id} disabled={busy||pending} onClick={()=>void continueGoal(choice.id,choice.text)} className="px-3 py-2 bg-bg-surface-hover rounded-lg">{choice.text}</button>)}</div>
      <textarea aria-label="回答 Agent" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="也可以直接说你的决定…" className="w-full bg-bg-primary p-3 rounded-lg"/>
      <button disabled={busy||pending||!answer.trim()} onClick={()=>void continueGoal()}>回答并继续</button></div>}
    <div className="flex flex-wrap gap-3">
      {working(run)&&<button disabled={busy} onClick={()=>void act(async()=>{await scriptAgentClient.control(run,'pause');})}>暂停创作</button>}
      {!question&&['PAUSED','NEEDS_REBASE','PARTIAL','FAILED'].includes(run.status)&&<button disabled={busy||pending} onClick={()=>void continueGoal()}>继续创作</button>}
      {run.status==='RECONCILIATION_REQUIRED'&&<button disabled={busy} onClick={()=>void act(async()=>{await scriptAgentClient.reconcile(run);})}>核对已收到的返回</button>}
      {workspace.projectId?<button onClick={()=>onOpen(workspace.projectId!)}>打开当前稿</button>:<button disabled={busy||working(run)} onClick={()=>void act(async()=>{
        const result=await scriptAgentClient.prepareAdoption(workspace,0);if(!result.proposal)throw new Error('请重新读取工作稿后审阅');setPreview({revision:workspace.revision,proposal:result.proposal});
      })}>审阅工作稿</button>}
    </div>
    {!working(run)&&<details className="rounded-xl bg-bg-surface-soft p-3 space-y-2"><summary className="cursor-pointer">修改本次委托</summary>
      <label className="block">创作目标<textarea aria-label="修改创作目标" value={objective} onChange={event=>setObjective(event.target.value)} className="w-full bg-bg-primary p-2 rounded-lg"/></label>
      {isTestMode&&<label className="block">执行方式<select aria-label="修改执行方式" value={channel} onChange={event=>setChannel(event.target.value as 'api'|'external')} className="ml-2 bg-bg-primary"><option value="api">使用已配置模型</option><option value="external">复制提示词，手动回填</option></select></label>}
      <label className="block">每集最多新增场数<input aria-label="每集最多新增场数" type="number" min={1} max={1000} value={maxScenes} onChange={event=>setMaxScenes(Number(event.target.value))} className="ml-2 w-20 bg-bg-primary p-1"/></label>
      <fieldset><legend>本次使用的 Skill</legend><div className="flex flex-wrap gap-2">{skills.map(skill=><label key={skill.id}><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={()=>setSkillIds(ids=>ids.includes(skill.id)?ids.filter(id=>id!==skill.id):[...ids,skill.id])}/> {skill.title}</label>)}</div></fieldset>
      <button disabled={busy||Boolean(pending)} onClick={()=>void reviseGoal()}>保存修订并继续</button>
    </details>}
    <details><summary>阅读当前工作稿</summary><pre className="whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-auto py-3">{draftText(workspace.document)}</pre></details>
    {preview&&!workspace.projectId&&<div className="space-y-3"><p>审阅本次成果。采用后保存为你的新作品，可以逐步调用模型继续生成或修改，也可直接编辑。</p>
      <pre className="whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-auto">{draftText(preview.proposal.document)}</pre>
      <button disabled={busy||working(run)||preview.revision!==workspace.revision||pendingAdoption} onClick={()=>void act(async()=>{
        const saved={workspaceId:workspace.id,proposal:{id:preview.proposal.id,digest:preview.proposal.digest},requestId:crypto.randomUUID()};
        localStorage.setItem(adoptionKey,JSON.stringify(saved));
        try{const result=await scriptAgentClient.adopt(saved.workspaceId,saved.proposal,saved.requestId);localStorage.removeItem(adoptionKey);onOpen((result.receipt as {projectId:string}).projectId);}
        catch(e){const status=(e as any).status;if(status>=400&&status<500)localStorage.removeItem(adoptionKey);throw e;}
      })}>采用并打开作品</button></div>}
    {pendingAdoption&&<button disabled={busy} onClick={()=>void act(async()=>{const saved=JSON.parse(localStorage.getItem(adoptionKey)!);const result=await scriptAgentClient.adopt(saved.workspaceId,saved.proposal,saved.requestId);localStorage.removeItem(adoptionKey);onOpen((result.receipt as {projectId:string}).projectId);})}>核对上次采用结果</button>}
  </section>;
}
