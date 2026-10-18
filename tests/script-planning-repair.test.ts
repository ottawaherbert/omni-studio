import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {registerScriptReadRoutes} from '../apps/api/src/routes/scriptReadRoutes';
import {planningRepairEvidence} from '../packages/script/src/planningRepair';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {hashValue,type ModelTransport} from '../packages/agent-core/src';
import {readScriptPlanningRepairProgress} from '../apps/api/src/agent/scriptPlanningRepair';
import {anchorFor,outlineGuideId,outlineText} from '../packages/script/src/outlineGuides';
import type {PlanningRepairResult} from '../packages/script/src/planningRepair';

async function setup(t:TestContext,options:{scene?:boolean;range?:boolean;node?:boolean;unitOwner?:boolean;maxInvocations?:number;transport?:ModelTransport;channel?:'api'|'external'}={}){
  const db=new Database(':memory:');t.after(()=>db.close());
  const transport=options.transport??{sendOnce:async()=>{throw new Error('NO_REAL_MODEL');}};
  let host=createScriptAgentHost(db,transport,'planning-repair',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','planning-repair');
  const document=createScriptProject('规划有限返修',createScriptCreationProfile('short-film',1,5));
  document.brief.outline='开始。等待。结束。';
  if(options.unitOwner)document.units[0].summary='当前单元自己的大纲。';
  document.units[0].scenes[0].purpose='等待没有动作';
  document.units[0].scenes[0].blocks[0].text='作者正文不能被规划返修改变';
  if(options.node){document.units[0].structureNodes=[{id:'node_wait',title:'等待段',purpose:'保持等待'}];document.units[0].scenes[0].structureNodeId='node_wait';const owner={kind:'project' as const,id:document.id};document.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[{nodeId:'node_wait',unitId:document.units[0].id,anchor:anchorFor(document.brief.outline,3,6)}],beats:[]}];}
  const author=host.scripts.saveProject(document,0),unitId=author.units[0].id,sceneId=author.units[0].scenes[0].id;
  const command={kind:'PLANNING_REPAIR',requestId:'planning-repair-command',threadId:thread.id,expectedConversationVersion:1,
    source:{kind:'PROJECT',projectId:author.id,revision:author.revision,contentHash:hashValue(author)},methodIds:[],instruction:'检查并修正最多两轮，保持原意',
    target:options.scene?{unitId,sceneId}:{unitId,...(options.unitOwner?{}:{scopeId:author.id}),...(options.range?{outlineRange:{start:3,end:6,text:'等待。'}}:{}),...(options.node?{nodeId:'node_wait'}:{})}};
  const resolve={resolveMethods:async()=>[],resolveExecution:()=>({channel:options.channel??'external',routeRef:'isolated-planning-test'})};
  const receipt=await host.commands.submit('author',command,resolve);
  if(options.maxInvocations!==undefined)db.prepare('UPDATE agent_runs SET max_invocations=? WHERE id=?').run(options.maxInvocations,receipt.runId);
  const h={db,get host(){return host;},restart(){host=createScriptAgentHost(db,transport,'planning-repair-restarted',{trustedLegacyProjectOwner:'author'});},
    author,unitId,sceneId,receipt,command,resolve,answered:new Set<string>(),
    workspace:()=>host.workspaces.read(receipt.workspaceId,'author'),run:()=>host.store.readRun(receipt.runId),
    candidates:()=>db.prepare('SELECT data_json FROM script_draft_candidates ORDER BY rowid').all().map((row:any)=>JSON.parse(row.data_json))};
  return h;
}
type Harness=Awaited<ReturnType<typeof setup>>;
async function tick(h:Harness,response?:(request:any)=>unknown){
  await h.host.worker.runOnce(h.receipt.runId);await h.host.childWorker.runOnce(h.receipt.runId);
  const request=h.host.journal.listExternal(h.receipt.runId,'author').find(item=>!h.answered.has(item.id));
  if(request&&response){const value=response(request.request);if(value!==undefined){h.host.journal.submitExternal(request.id,'author',request.inputHash,JSON.stringify(value),{name:'mechanical-planning-response'});h.answered.add(request.id);}}
}
async function until(h:Harness,done:()=>boolean,response?:(request:any)=>unknown){
  for(let i=0;i<60;i++){await tick(h,response);if(done())return;}
  assert.fail(`未到达停点：${JSON.stringify(h.run())}`);
}
const terminal=(h:Harness)=>['SUCCEEDED','PARTIAL','FAILED','NEEDS_REBASE','RECONCILIATION_REQUIRED','CANCELED'].includes(h.run().status);
function reply(request:any,stopAt=2){
  const check=request.inputManifest?.planningRepair;
  if(check){const e=check.evidence[0];return {summary:'依据实际规划原文复核',findings:check.round>=stopAt?[]:[{evidenceId:e.id,quote:e.text,issue:'行动还不够明确',suggestion:'让等待成为人物行动',severity:'ADVISORY'}]};}
  const scope=request.inputManifest.scriptDraft;
  if(scope.operation==='scene_plan')return {summary:'明确人物行动',title:'等待',purpose:`主动寻找女儿并留下第${scope.workspaceRef.version}个标记`,location:'站台',timeOfDay:'夜',entryState:'迟疑',exitState:'决定留下',outlineRequirementIds:null};
  const round=Number(scope.workspaceRef.version);
  return {summary:'规划修正',content:round===1?'主动等待并留下标记。':'主动等待，向值班员打听女儿后留下标记。',nodes:[],beats:[]};
}

test('two bounded rounds persist typed checks, candidates and workspace applications; restart reuses each call and never writes author',async t=>{
  const h=await setup(t),authorBefore=hashValue(h.author);
  await until(h,()=>h.candidates().length===1,request=>reply(request));h.restart();
  await until(h,()=>terminal(h),request=>reply(request));
  assert.equal(h.run().status,'SUCCEEDED',JSON.stringify(h.run()));
  const result=h.run().result as PlanningRepairResult;
  assert.equal(result.roundsUsed,2);assert.equal(result.analyses.length,3);assert.equal(result.candidateIds.length,2);assert.equal(result.applicationRefs.length,2);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM agent_invocations').get().n,5);
  assert.equal(h.workspace().revision,3);assert.equal(hashValue(h.host.scripts.getProject(h.author.id)),authorBefore);
  assert.deepEqual(h.workspace().document.units[0].scenes[0].blocks,h.author.units[0].scenes[0].blocks);
  assert.ok(result.analyses.every(a=>!a.evidenceKinds.includes('BODY_BLOCK')));
  const replay=await h.host.commands.submit('author',h.command,h.resolve);assert.equal(replay.runId,h.receipt.runId);
});

test('excerpt repair keeps prefix/suffix and a second round only receives the changed authorized excerpt',async t=>{
  const h=await setup(t,{range:true});
  await until(h,()=>terminal(h),request=>reply(request));
  assert.equal(h.run().status,'SUCCEEDED',JSON.stringify(h.run()));
  const current=outlineText(h.workspace().document,{kind:'project',id:h.author.id});
  assert.equal(current,'开始。主动等待，向值班员打听女儿后留下标记。结束。');
  const result=h.run().result as PlanningRepairResult;
  assert.equal(result.analyses[1].findings[0].evidence.text,'主动等待并留下标记。');
});

test('unresolved planning problems stop after two actual applications with a final current-source analysis',async t=>{
  const h=await setup(t,{scene:true});await until(h,()=>terminal(h),request=>reply(request,99));
  assert.equal(h.run().status,'PARTIAL',JSON.stringify(h.run()));
  const result=h.run().result as PlanningRepairResult;assert.equal(result.roundsUsed,2);assert.equal(result.analyses.at(-1)!.findings.length,1);
  assert.equal(result.analyses.at(-1)!.revision,h.workspace().revision);assert.match(result.summary,/两轮/);
  assert.equal(h.candidates().length,2);assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM agent_invocations').get().n,5);
});

test('unverifiable citation stops before any candidate or workspace edit',async t=>{
  const h=await setup(t);await until(h,()=>terminal(h),()=>({summary:'错误引用',findings:[{evidenceId:'invented',quote:'不存在',issue:'错',suggestion:'改',severity:'ADVISORY'}]}));
  assert.equal(h.run().status,'PARTIAL');assert.equal(h.workspace().revision,1);assert.equal(h.candidates().length,0);
  assert.match((h.run().result as PlanningRepairResult).summary,/准确原文/);
});

test('budget stops before the next check and retains the applied working draft without author adoption',async t=>{
  const h=await setup(t,{maxInvocations:2});await until(h,()=>terminal(h),request=>reply(request));
  assert.equal(h.run().status,'PARTIAL');assert.equal(h.run().reason,'BUDGET_EXHAUSTED');assert.equal(h.workspace().revision,2);
  assert.equal(h.candidates().length,1);assert.equal(h.host.scripts.getProject(h.author.id)!.brief.outline,h.author.brief.outline);
  const progress=readScriptPlanningRepairProgress(h.host,h.run())!;assert.equal(progress.roundsUsed,1);assert.equal(progress.analyses.length,1);assert.match(progress.summary,/尚未完成/);
});

test('node-scoped repair preserves node identity and rebases only its proven original interval for round two',async t=>{
  const h=await setup(t,{node:true});await until(h,()=>terminal(h),request=>{
    const value=reply(request) as any;if(request.inputManifest?.scriptDraft)value.nodes=[{id:'node_wait',localKey:'wait',parentLocalKey:null,title:'等待段',purpose:'保持等待',quote:value.content,sceneIds:[h.sceneId]}];return value;
  });
  assert.equal(h.run().status,'SUCCEEDED',JSON.stringify(h.run()));
  assert.equal(h.workspace().document.brief.outline,'开始。主动等待，向值班员打听女儿后留下标记。结束。');
  assert.deepEqual(h.workspace().document.units[0].structureNodes,h.author.units[0].structureNodes);
  assert.equal(h.workspace().document.outlineGuides![0].nodeLinks[0].nodeId,'node_wait');
});

test('pause after first working-draft application resumes the same frozen recheck without repeating the write',async t=>{
  const h=await setup(t);await until(h,()=>h.workspace().revision===2&&h.host.journal.listExternal(h.receipt.runId,'author').some(item=>!h.answered.has(item.id)),request=>request.inputManifest?.planningRepair?.round===1?undefined:reply(request));
  const request=h.host.journal.listExternal(h.receipt.runId,'author').find(item=>!h.answered.has(item.id))!;
  h.host.store.control(h.receipt.runId,'author',h.run().version,'pause','pause-at-check');
  const count=h.run().invocationCount;for(let i=0;i<2;i++)await tick(h);
  assert.equal(h.run().status,'PAUSED');assert.equal(h.run().invocationCount,count);assert.equal(h.workspace().revision,2);
  h.host.journal.submitExternal(request.id,'author',request.inputHash,JSON.stringify(reply(request.request)),{name:'paused-response'});h.answered.add(request.id);
  assert.equal(h.run().status,'PAUSED');
  h.restart();h.host.store.control(h.receipt.runId,'author',h.run().version,'resume','resume-at-check');
  await until(h,()=>terminal(h),request=>reply(request));assert.equal(h.run().status,'SUCCEEDED',JSON.stringify(h.run()));
  assert.equal(h.workspace().revision,3);assert.equal(h.run().invocationCount,5);
});

test('cancel while proposal is waiting retains checked opinions but a late response cannot modify work or author',async t=>{
  const h=await setup(t);await until(h,()=>h.run().invocationCount===2,request=>request.inputManifest?.scriptDraft?undefined:reply(request));
  const request=h.host.journal.listExternal(h.receipt.runId,'author').find(item=>!h.answered.has(item.id))!;
  h.host.store.control(h.receipt.runId,'author',h.run().version,'cancel','cancel-proposal');
  h.host.journal.submitExternal(request.id,'author',request.inputHash,JSON.stringify(reply(request.request)),{name:'late-response'});h.answered.add(request.id);
  for(let i=0;i<3;i++)await tick(h);
  assert.equal(h.run().status,'CANCELED');assert.equal(h.workspace().revision,1);assert.equal(h.candidates().length,0);
  const progress=readScriptPlanningRepairProgress(h.host,h.run())!;assert.equal(progress.analyses.length,1);assert.equal(progress.roundsUsed,0);
});

test('unknown physical response suspends with no automatic resend or candidate fallback',async t=>{
  let sends=0;const h=await setup(t,{channel:'api',transport:{sendOnce:async()=>{sends++;throw new Error('timeout after physical send');}}});
  await until(h,()=>terminal(h));assert.equal(h.run().status,'RECONCILIATION_REQUIRED');h.restart();for(let i=0;i<3;i++)await tick(h);
  assert.equal(sends,1);assert.equal(h.run().invocationCount,1);assert.equal(h.workspace().revision,1);assert.equal(h.candidates().length,0);
});

test('independent author changes in a paused workspace cannot be silently accepted into the next repair round',async t=>{
  const h=await setup(t);await until(h,()=>h.workspace().revision===2&&h.run().invocationCount===3,request=>request.inputManifest?.planningRepair?.round===1?undefined:reply(request));
  h.host.store.control(h.receipt.runId,'author',h.run().version,'pause','pause-author-edit');
  const workspace=h.workspace(),document=structuredClone(workspace.document);document.brief.outline='作者接管后的全新版本';
  h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'author-edit',expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document,takeover:{runId:h.receipt.runId,expectedVersion:h.run().version}});
  h.host.store.control(h.receipt.runId,'author',h.run().version,'resume','resume-after-author-edit');
  await until(h,()=>terminal(h),request=>reply(request));assert.notEqual(h.run().status,'SUCCEEDED');
  assert.equal(h.candidates().length,1);assert.equal(h.workspace().document.brief.outline,'作者接管后的全新版本');
});

test('a partial second candidate is preserved and can be explicitly applied under the same proven range',async t=>{
  const h=await setup(t,{range:true});await until(h,()=>terminal(h),request=>{
    const value=reply(request) as any;if(request.inputManifest?.scriptDraft?.workspaceRef.version==='2')value.beats=null;return value;
  });
  assert.equal(h.run().status,'PARTIAL');assert.equal(h.workspace().revision,2);
  const candidate=h.candidates().at(-1);assert.equal(candidate.status,'VALID');assert.deepEqual(candidate.candidate.delivery.missing,['beats']);
  const w=h.workspace(),accepted=await h.host.commands.submit('author',{kind:'APPLY',requestId:'author-apply-second-partial',threadId:h.receipt.threadId,
    expectedConversationVersion:1,workspaceId:w.id,candidateId:candidate.id,expectedRevision:w.revision,writerEpoch:w.writerEpoch},h.resolve);
  for(let i=0;i<6;i++){await h.host.worker.runOnce(accepted.runId);await h.host.childWorker.runOnce(accepted.runId);if(['SUCCEEDED','FAILED'].includes(h.host.store.readRun(accepted.runId).status))break;}
  assert.equal(h.host.store.readRun(accepted.runId).status,'SUCCEEDED');
  assert.equal(h.workspace().document.brief.outline,'开始。主动等待，向值班员打听女儿后留下标记。结束。');
  assert.equal(h.host.scripts.getProject(h.author.id)!.brief.outline,h.author.brief.outline);
});

test('finished checked working draft reaches author only through explicit three-way adoption and receipt replay',async t=>{
  const h=await setup(t);await until(h,()=>terminal(h),request=>reply(request,1));
  assert.equal(h.run().status,'SUCCEEDED');assert.equal(h.host.scripts.getProject(h.author.id)!.brief.outline,h.author.brief.outline);
  const w=h.workspace(),proposal=h.host.workspaces.prepareAdoption({ownerId:'author',workspaceId:w.id,workspaceRevision:w.revision,expectedAuthorRevision:h.author.revision});
  const command={ownerId:'author',workspaceId:w.id,requestId:'explicit-author-adoption',proposalId:proposal.id,digest:proposal.digest};
  const receipt=h.host.workspaces.adopt(command);assert.deepEqual(h.host.workspaces.adopt(command),receipt);
  assert.equal(h.host.scripts.getProject(h.author.id)!.brief.outline,w.document.brief.outline);
});

test('withdrawn analysis source cannot be exposed by the persisted-progress projection',async t=>{
  const h=await setup(t);await until(h,()=>terminal(h),request=>reply(request,0));
  assert.equal(readScriptPlanningRepairProgress(h.host,h.run())!.analyses.length,1);
  h.host.contexts.revokeScope({ownerId:'author',scopeId:h.receipt.workspaceId,branch:`workspace:${h.receipt.workspaceId}`});
  assert.throws(()=>readScriptPlanningRepairProgress(h.host,h.run()));
});

test('an explicit unit outline never silently inspects or rewrites the standalone project outline',async t=>{
  const h=await setup(t,{unitOwner:true});await until(h,()=>terminal(h),request=>reply(request));
  assert.equal(h.run().status,'SUCCEEDED',JSON.stringify(h.run()));
  const result=h.run().result as PlanningRepairResult;
  assert.equal(result.analyses[0].findings[0].evidence.owner!.kind,'unit');
  assert.equal(result.analyses[0].findings[0].quote,'当前单元自己的大纲。');
  assert.equal(h.workspace().document.brief.outline,h.author.brief.outline);
  assert.notEqual(h.workspace().document.units[0].summary,h.author.units[0].summary);
});

test('excerpt planning evidence includes only beats anchored inside the authorized current interval',async t=>{
  const h=await setup(t,{range:true}),document=structuredClone(h.workspace().document),owner={kind:'project' as const,id:document.id};
  document.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[
    {id:'outside',title:'开头',change:'不能把开头意见列入所选中段',anchors:[anchorFor(document.brief.outline,0,3)],unitIds:[h.unitId],sceneRefs:[]},
    {id:'inside',title:'等待',change:'从犹豫到等待',anchors:[anchorFor(document.brief.outline,3,6)],unitIds:[h.unitId],sceneRefs:[]},
  ]}];
  const scope=h.host.authorizations.read(h.receipt.authorizationRef,'author').scope as any;
  const evidence=planningRepairEvidence(document,(h.run().input as any).planningRepair,scope);
  assert.deepEqual(evidence.filter(e=>e.kind==='NODE_BEAT').map(e=>e.beatId),['inside']);
  assert.equal(evidence.find(e=>e.kind==='OUTLINE_SPAN')!.text,'等待。');
});

test('state-listing route returns persisted planning progress under source and owner guards',async t=>{
  const h=await setup(t);await until(h,()=>terminal(h),request=>reply(request,0));
  const handlers=new Map<string,Function>();let ownerId='author';
  registerScriptReadRoutes({get:(path:string,handler:Function)=>handlers.set(path,handler)} as any,{...h.host,owner:()=>ownerId});
  const read=()=>{let status=200,body:any;const res={status(value:number){status=value;return this;},json(value:unknown){body=JSON.parse(JSON.stringify(value));return this;}};
    handlers.get('/api/script-runs')!({query:{threadId:h.receipt.threadId,view:'state'}},res);return {status,body};};
  const listing=read();assert.equal(listing.status,200);assert.equal(listing.body.runs[0].run.input,null);
  assert.equal(listing.body.runs[0].planningRepair.analyses.length,1);assert.equal(listing.body.runs[0].planningRepair.analyses[0].target.unitId,h.unitId);
  ownerId='stranger';assert.equal(read().status,404);ownerId='author';
  h.host.contexts.revokeScope({ownerId:'author',scopeId:h.receipt.workspaceId,branch:`workspace:${h.receipt.workspaceId}`});
  assert.equal(read().body.runs.length,0);
});
