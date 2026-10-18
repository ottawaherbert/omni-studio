import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { registerScriptCommandRoutes } from '../apps/api/src/routes/scriptCommandRoutes';

function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('provider must not be called');}},'commands-worker',{trustedLegacyProjectOwner:'author'});
  const {goals,commands}=host;
  const thread=host.conversations.open('author','script:home','command-test');
  const profile=createScriptCreationProfile('tv-series',3,20);
  const resolve={resolveMethods:async(ids:string[])=>{assert.deepEqual(ids,[]);return [];},
    resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical-test'})};
  return {host,goals,commands,thread,profile,resolve};
}

test('new-work author propose atomically creates only a workspace, signs an exact scene and replays before configuration resolution',async t=>{
  const h=setup(t);
  const input={kind:'PROPOSE',requestId:'new-scene',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'雨夜',profile:h.profile},operation:'scene_body',instruction:'写选中的初始场',target:{initialUnit:true},methodIds:[]};
  const receipt=await h.commands.submit('author',input,h.resolve);
  assert.equal(h.host.scripts.listProjects().length,0);
  const workspace=h.host.workspaces.read(receipt.workspaceId,'author');
  const authorization=h.host.authorizations.read(receipt.authorizationRef,'author');
  assert.equal(authorization.binding?.kind,'RUN');
  const scope=authorization.scope as any;
  assert.deepEqual(scope.operations,['scene_body']);
  assert.deepEqual(scope.units.map((unit:any)=>unit.unitId),[workspace.document.units[0].id]);
  assert.deepEqual(scope.units[0].scenes.map((scene:any)=>scene.sceneId),[workspace.document.units[0].scenes[0].id]);
  assert.equal(h.host.store.readRun(receipt.runId).status,'QUEUED');
  const replay=await h.commands.submit('author',input,{resolveMethods:async()=>{throw Error('Skill removed');},
    resolveExecution:()=>{throw Error('route removed');}});
  assert.deepEqual(replay,receipt);
  await assert.rejects(()=>h.commands.submit('author',{...input,instruction:'changed'},h.resolve),/不同内容/);
  await assert.rejects(()=>h.commands.submit('other',input,h.resolve),/对话|不存在|作者/i);
});

test('author Goal reserves only the selected new unit, continues with a newly bound authorization and preserves frozen Skill',async t=>{
  const h=setup(t);
  const initial={kind:'GOAL_START',requestId:'next-unit',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'连续剧',profile:h.profile},objective:'创作下一集',task:'WRITE',target:{newUnitCount:1},methodIds:[]};
  const first=await h.commands.submit('author',initial,h.resolve);
  const original=h.goals.read(first.goalId!,'author');
  const contract=original.revision.contract.value as any;
  assert.equal(contract.checks.targetUnitIds.length,1);
  assert.equal(contract.scope.newUnitSlots.length,1);
  assert.equal(contract.scope.units.length,1);
  assert.equal(contract.scope.units[0].unitId,contract.scope.newUnitSlots[0].unitId);
  assert.equal(contract.scope.units[0].allowAllScenes,true);
  assert.equal(contract.scope.units[0].allowSummary,true);
  assert.equal(contract.scope.units[0].maxNewScenes,100);
  const firstAuth=h.host.authorizations.read(first.authorizationRef,'author');
  assert.equal(firstAuth.binding?.kind,'GOAL');
  const run=h.host.store.readRun(first.runId);
  const continuation={kind:'GOAL_CONTINUE',requestId:'continue-unit',threadId:h.thread.id,expectedConversationVersion:1,
    goalId:first.goalId,expectedGoalVersion:original.version,expectedRunVersion:run.version};
  const second=await h.commands.submit('author',continuation,{resolveMethods:async()=>{throw Error('must retain frozen skills');},
    resolveExecution:()=>{throw Error('must retain frozen route');}});
  assert.equal(second.goalId,first.goalId);
  assert.equal(second.goalRevision,2);
  assert.notEqual(second.authorizationRef,first.authorizationRef);
  const next=h.goals.read(first.goalId!,'author');
  assert.equal(next.revision.authorCommandId,'continue-unit');
  assert.equal(next.revision.authorizationRef,second.authorizationRef);
  assert.equal(next.revision.budgetId,original.revision.budgetId);
  assert.deepEqual(next.revision.skillManifest,original.revision.skillManifest);
  assert.deepEqual(next.revision.route,original.revision.route);
});

test('initial Goal budget follows the authorized scene range',async t=>{
  const h=setup(t);
  const project=createScriptProject('机械预算范围',createScriptCreationProfile('feature-film',1,3));
  project.units[0].scenes=Array.from({length:50},(_,index)=>newScene(`场 ${index+1}`));
  const saved=h.host.scripts.saveProject(project,0),unit=saved.units[0];
  const quotas:number[]=[];
  for(const [index,target] of [
    {unitIds:[unit.id],sceneIds:[{unitId:unit.id,sceneId:unit.scenes[0].id}]},
    {unitIds:[unit.id],wholeUnitIds:[unit.id]},
  ].entries()){
    const thread=h.host.conversations.open('author','script:home',`budget-${index}`);
    const receipt=await h.commands.submit('author',{kind:'GOAL_START',requestId:`budget-${index}`,
      threadId:thread.id,expectedConversationVersion:thread.version,
      source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
      objective:'机械范围预算',task:'WRITE',target,methodIds:[]},h.resolve);
    quotas.push(h.commands.goalBudget('author',receipt.goalId!).limits.maxInvocations);
  }
  assert.deepEqual(quotas,[46,242]);
});

test('failed author command rolls back workspace, authorization and receipt; browser cannot post authority objects',async t=>{
  const h=setup(t);
  const base={kind:'PROPOSE',requestId:'bad',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'失败事务',profile:h.profile},operation:'scene_body',instruction:'写正文',
    target:{initialUnit:true,sceneId:'scene_outside'},methodIds:[]};
  await assert.rejects(()=>h.commands.submit('author',base,h.resolve),/场景|必须明确/);
  assert.equal(h.host.workspaces.list('author').length,0);
  assert.equal(h.commands.received('author',base),null);
  await assert.rejects(()=>h.commands.submit('author',{...base,authorizationRef:'forged'},h.resolve),/不允许/);
  assert.equal(h.host.workspaces.list('author').length,0);
});

test('retired dialogue rejects new author Goal and workspace even with its latest conversation version', async t => {
  const h = setup(t);
  const next = h.host.conversations.restart({ threadId: h.thread.id, ownerId: 'author', requestId: 'clear-before-goal', expectedVersion: h.thread.version, clientKey: 'new-command-thread' }).conversation;
  const retired = h.host.conversations.read(h.thread.id, 'author');
  const input = { kind: 'GOAL_START', requestId: 'goal-on-retired-dialogue', threadId: h.thread.id, expectedConversationVersion: retired.version,
    source: { kind: 'NEW', title: '机械退休会话测试', profile: h.profile }, objective: '创作下一集', task: 'WRITE', target: { newUnitCount: 1 }, methodIds: [] };
  await assert.rejects(() => h.commands.submit('author', input, h.resolve), (error: any) => error.code === 'CONVERSATION_RESTARTED');
  assert.equal(h.host.workspaces.list('author').length, 0);
  assert.equal((h.host.store.db.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 0);
  assert.equal(h.commands.received('author', input), null);
  const receipt = await h.commands.submit('author', { ...input, requestId: 'goal-on-new-dialogue', threadId: next.id, expectedConversationVersion: next.version }, h.resolve);
  assert.equal(h.host.store.readRun(receipt.runId, 'author').threadId, next.id);
});

test('HTTP route forwards only author body to the trusted receiver',async t=>{
  const h=setup(t);
  const registered:any[]=[];
  registerScriptCommandRoutes({get:(path:string,handler:any)=>registered.push({path,handler}),post:(path:string,handler:any)=>registered.push({path,handler})} as any,{
    commands:h.commands,owner:()=> 'author',resolveMethods:h.resolve.resolveMethods,resolveExecution:h.resolve.resolveExecution});
  assert.equal(registered[0].path,'/api/script-commands');
  const input={kind:'PROPOSE',requestId:'http',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'HTTP 工作稿',profile:h.profile},operation:'concept',instruction:'写一个概念',target:{},methodIds:[]};
  const result:any={statusCode:0,body:null,status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}};
  await registered[0].handler({body:input},result);
  assert.equal(result.statusCode,202);
  assert.equal((h.host.store.readRun(result.body.runId,'author').input as any).authorizationRef,result.body.authorizationRef);
  assert.equal(h.host.scripts.listProjects().length,0);
});

test('author APPLY adopts a persisted candidate under a separate narrow authorization',async t=>{
  const h=setup(t),propose={kind:'PROPOSE',requestId:'concept-propose',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'候选采用',profile:h.profile},operation:'concept',instruction:'机械概念',
    target:{},methodIds:[],executionChannel:'external'};
  const first=await h.commands.submit('author',propose,h.resolve);
  await h.host.worker.runOnce(first.runId);await h.host.childWorker.runOnce(first.runId);
  const frozen=h.host.journal.listExternal(first.runId,'author')[0];
  assert.equal(frozen.status,'WAITING');
  const raw=JSON.stringify({summary:'MECHANICAL_PROTOCOL',content:'仅供事务检查。'});
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,raw,{name:'MECHANICAL_PROTOCOL',model:'test'});
  for(let index=0;index<5&&h.host.store.readRun(first.runId).status!=='SUCCEEDED';index++){
    await h.host.childWorker.runOnce(first.runId);await h.host.worker.runOnce(first.runId);
  }
  const proposal=h.host.store.readRun(first.runId);
  assert.equal(proposal.status,'SUCCEEDED');
  const candidateId=(proposal.result as any).data.candidateId;
  assert.equal(h.host.drafts.readCandidate('author',candidateId).raw,raw);
  const workspace=h.host.workspaces.read(first.workspaceId,'author');
  const apply={kind:'APPLY',requestId:'concept-apply',threadId:h.thread.id,expectedConversationVersion:1,
    workspaceId:first.workspaceId,candidateId,expectedRevision:workspace.revision,writerEpoch:workspace.writerEpoch};
  const second=await h.commands.submit('author',apply,{resolveMethods:async()=>{throw Error('APPLY must not resolve methods');},
    resolveExecution:()=>{throw Error('APPLY must not resolve route');}});
  assert.notEqual(second.authorizationRef,first.authorizationRef);
  const scope=h.host.authorizations.read(second.authorizationRef,'author').scope as any;
  assert.deepEqual(scope.operations,['concept']);assert.deepEqual(scope.sharedFields,['concept']);assert.deepEqual(scope.units,[]);
  await h.host.worker.runOnce(second.runId);
  assert.equal(h.host.store.readRun(second.runId).status,'SUCCEEDED');
  assert.equal(h.host.workspaces.read(first.workspaceId,'author').document.brief.concept,'仅供事务检查。');
  assert.equal(h.host.scripts.listProjects().length,0);
});

test('existing formal source must match current author input and pins its author-selected unit',async t=>{
  const h=setup(t),saved=h.host.scripts.saveProject(createScriptProject('既有作品',h.profile),0);
  const unitId=saved.units[0].id;
  const base={kind:'GOAL_START',requestId:'from-project',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'只完成作者选定的一集',task:'WRITE',target:{unitIds:[unitId],wholeUnitIds:[unitId]},methodIds:[]};
  const receipt=await h.commands.submit('author',base,h.resolve);
  const workspace=h.host.workspaces.read(receipt.workspaceId,'author');
  assert.equal(workspace.projectId,saved.id);
  assert.equal(workspace.baseProjectRevision,saved.revision);
  assert.deepEqual((h.host.authorizations.read(receipt.authorizationRef,'author').scope as any).units.map((unit:any)=>unit.unitId),[unitId]);
  assert.equal(h.host.scripts.getProject(saved.id)?.revision,saved.revision);
  await assert.rejects(()=>h.commands.submit('author',{...base,requestId:'wrong-hash',
    source:{...base.source,contentHash:'0'.repeat(64)}},h.resolve),/当前作者稿/);
  assert.deepEqual(h.host.workspaces.authorBaseline(workspace.id,'author'),saved);
  h.host.scripts.saveProject({...saved,title:'作者随后修改的当前稿'},saved.revision);
  assert.deepEqual(h.host.scripts.readProjectInput(saved.id,saved.revision),saved,'任务固定输入继续保留');
  await assert.rejects(()=>h.commands.submit('author',{...base,requestId:'retired-author-source'},h.resolve),/当前作者稿/);
  assert.equal(h.host.workspaces.list('author').length,1);
});

test('selected previous-script reference derives ContextAccess on server and rejects browser-supplied access',async t=>{
  const h=setup(t),previous=h.host.scripts.saveProject(createScriptProject('前集',h.profile),0);
  const current=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'current-workspace',
    source:{document:createScriptProject('当前集',h.profile)}});
  const reference={uri:`resource://script/projects/${previous.id}`,version:String(previous.revision),
    contentHash:hashValue(previous),branch:'author'};
  const base={kind:'PROPOSE',requestId:'read-previous',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'WORKSPACE',workspaceId:current.id,expectedRevision:current.revision},
    operation:'concept',instruction:'参考选定前集',target:{},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref:reference,unitIds:[previous.units[0].id]}]};
  const receipt=await h.commands.submit('author',base,h.resolve);
  const selected=h.host.authorizations.read(receipt.authorizationRef,'author').sources[0];
  assert.deepEqual(selected.access,{ownerId:'author',scopeId:previous.id,branch:'author'});
  assert.deepEqual(selected.unitIds,[previous.units[0].id]);
  await assert.rejects(()=>h.commands.submit('author',{...base,requestId:'forged-access',
    sources:[{...base.sources[0],access:{ownerId:'author',scopeId:current.id,branch:'author'}}]},h.resolve),/不允许/);
});

test('new work can select a server-derived character scope without knowing project IDs beforehand',async t=>{
  const h=setup(t),input={kind:'PROPOSE',requestId:'new-character',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'人物起稿',profile:h.profile},operation:'add_character',
    instruction:'为新作品构思人物',target:{initialScope:'UNIT'},methodIds:[]};
  const receipt=await h.commands.submit('author',input,h.resolve);
  const workspace=h.host.workspaces.read(receipt.workspaceId,'author'),auth=h.host.authorizations.read(receipt.authorizationRef,'author');
  assert.deepEqual((auth.scope as any).characterScopeIds,[workspace.document.units[0].scopeId]);
  const request=(h.host.store.readRun(receipt.runId,'author').input as any).request;
  assert.equal(request.input.scopeId,workspace.document.units[0].scopeId);
  await assert.rejects(()=>h.commands.submit('author',{...input,requestId:'old-work-initial',
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision}},h.resolve),/初始实体作用域无效/);
});

test('new Goal can explicitly authorize planning and server-derived character facts without broadening older units',async t=>{
  const h=setup(t),input={kind:'GOAL_START',requestId:'whole-new-work',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'新作',profile:h.profile},objective:'写完整首集',task:'WRITE',
    target:{initialUnit:true,sharedFields:['concept','outline'],initialCharacterScope:'UNIT',initialFactScope:'PROJECT'},methodIds:[]};
  const receipt=await h.commands.submit('author',input,h.resolve);
  const workspace=h.host.workspaces.read(receipt.workspaceId,'author');
  const scope=(h.host.authorizations.read(receipt.authorizationRef,'author').scope as any);
  assert.deepEqual(scope.units.map((unit:any)=>unit.unitId),[workspace.document.units[0].id]);
  assert.deepEqual(scope.sharedFields,['concept','outline']);
  assert.deepEqual(scope.characterScopeIds,[workspace.document.units[0].scopeId]);
  assert.deepEqual(scope.factScopeIds,[workspace.document.id]);
  assert.ok(scope.operations.includes('add_character'));
  assert.ok(scope.operations.includes('add_fact'));
});

test('reserved anthology episode can explicitly include its server-created private character and fact scope',async t=>{
  const h=setup(t),document=createScriptProject('单元剧',createScriptCreationProfile('procedural',2,20));
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'prior-unit',source:{document}});
  const input={kind:'GOAL_START',requestId:'reserved-private',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},
    objective:'只写下一集',task:'WRITE',target:{newUnitCount:1,newUnitCharacterScopes:true,newUnitFactScopes:true},methodIds:[]};
  const receipt=await h.commands.submit('author',input,h.resolve),scope=(h.host.authorizations.read(receipt.authorizationRef,'author').scope as any);
  assert.equal(scope.units.length,1);
  assert.equal(scope.newUnitSlots[0].scopeId,scope.newUnitSlots[0].unitId);
  assert.deepEqual(scope.characterScopeIds,[scope.newUnitSlots[0].unitId]);
  assert.deepEqual(scope.factScopeIds,[scope.newUnitSlots[0].unitId]);
  assert.notEqual(scope.units[0].unitId,workspace.document.units[0].id);
});

test('standalone film command rejects a new-episode slot before creating a workspace',async t=>{
  const h=setup(t),input={kind:'GOAL_START',requestId:'film-extra-unit',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'电影',profile:createScriptCreationProfile('feature-film',1,90)},
    objective:'写电影',task:'WRITE',target:{newUnitCount:1},methodIds:[]};
  await assert.rejects(()=>h.commands.submit('author',input,h.resolve),/独立电影不能新增分集/);
  assert.equal(h.host.workspaces.list('author').length,0);
});

test('explicit manual step on a paused Goal uses the same capability and shared Goal budget',async t=>{
  const h=setup(t),start={kind:'GOAL_START',requestId:'goal-for-manual',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'NEW',title:'接管委托',profile:h.profile},objective:'写选中单元',task:'WRITE',
    target:{initialUnit:true},methodIds:[]};
  const accepted=await h.commands.submit('author',start,h.resolve),firstRun=h.host.store.readRun(accepted.runId);
  h.host.store.control(firstRun.id,'author',firstRun.version,'pause','manual-takeover');
  const goal=h.goals.read(accepted.goalId!,'author'),workspace=h.host.workspaces.read(accepted.workspaceId,'author');
  const manual={kind:'PROPOSE',requestId:'manual-on-goal',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},
    operation:'scene_body',instruction:'只写这一场',target:{unitId:workspace.document.units[0].id,sceneId:workspace.document.units[0].scenes[0].id},
    methodIds:[],manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}};
  const step=await h.commands.submit('author',manual,h.resolve);
  const link=h.goals.readRunLink(step.runId)!;
  assert.equal(link.role,'MANUAL_STEP');
  assert.equal(link.goalId,goal.id);
  assert.equal(link.budgetId,goal.revision.budgetId);
  assert.equal(link.authorizationRef,step.authorizationRef);
  assert.equal(h.host.authorizations.forRun(h.host.store.readRun(step.runId)).id,step.authorizationRef);
  const createScene={...manual,requestId:'manual-create-scene',operation:'plan_scenes',
    target:{unitId:workspace.document.units[0].id,maxNewScenes:30}};
  const sceneStep=await h.commands.submit('author',createScene,h.resolve);
  assert.equal(h.goals.readRunLink(sceneStep.runId)?.goalId,goal.id);
  assert.equal((h.host.authorizations.read(sceneStep.authorizationRef,'author').scope as any).units[0].maxNewScenes,30);
  const prior=h.host.scripts.saveProject(createScriptProject('额外来源',h.profile),0);
  const withExtra={...manual,requestId:'manual-extra-source',sources:[{purpose:'PREVIOUS_SCRIPT',
    ref:{uri:`resource://script/projects/${prior.id}`,version:String(prior.revision),contentHash:hashValue(prior),branch:'author'},unitIds:null}]};
  await assert.rejects(()=>h.commands.submit('author',withExtra,h.resolve),/来源超出/);
  assert.equal(h.commands.received('author',withExtra),null);
});
