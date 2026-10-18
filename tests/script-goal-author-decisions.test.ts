import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ModelRequest } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { registerScriptReadRoutes } from '../apps/api/src/routes/scriptReadRoutes';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { newGoalSelection, goalSceneLimitTarget } from '../apps/web/src/features/script/scriptGoalAuthoring';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';

const mechanicalAsk={kind:'ASK',capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,
  message:'【机械协议问题】选择接下来的处理范围',choices:[{id:'a',text:'【作者机械选择】保持当前范围'}],
  artifactRefs:null,summary:null,reason:null,remainingWork:null};
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());const requests:ModelRequest[]=[];
  const host=createScriptAgentHost(db,{sendOnce:async request=>{requests.push(structuredClone(request));return {
    text:JSON.stringify(mechanicalAsk),provenance:{channel:'provider',producer:'MECHANICAL_PROTOCOL_NO_EXTERNAL_MODEL'}};}},
    'answer-tests',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','author-decisions');
  const project=createScriptProject('【机械流程作品】',createScriptCreationProfile('tv-series',2,3));
  project.units[0].scenes[0].blocks[0].text='【作者原始数据】必须原样保留';
  const saved=host.scripts.saveProject(project,0),unit=saved.units[0];
  const resolvers={resolveMethods:async()=>[],resolveExecution:()=>({channel:'api' as const,routeRef:'mechanical'})};
  const start=async(selection=newGoalSelection(saved,unit,undefined,'WRITE',0,4))=>host.commands.submit('author',{
    kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:thread.version,
    source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'【机械协议】验证作者决定与授权',task:'WRITE',methodIds:[],...selection},resolvers);
  const command=(goalId:string,requestId:string,extra:Record<string,any>={}):Record<string,any>=>{
    const goal=host.goals.read(goalId,'author'),run=host.store.readRun(goal.activeRunId!,'author');
    return {kind:'GOAL_CONTINUE',requestId,threadId:thread.id,expectedConversationVersion:thread.version,
      goalId,expectedGoalVersion:goal.version,expectedRunVersion:run.version,...extra};
  };
  const frozen={resolveMethods:async()=>{throw Error('must keep frozen methods');},resolveExecution:()=>{throw Error('must keep frozen route');}};
  return {db,host,thread,saved,unit,requests,start,command,resolvers,frozen};
}

test('ASK is projected, answered idempotently and present in the next actual frozen decision',async t=>{
  const h=setup(t),first=await h.start();await h.host.worker.runOnce(first.runId);
  const question=h.host.goals.pendingQuestion(first.goalId!,'author');assert.ok(question);assert.equal(question.message,mechanicalAsk.message);
  const routes=new Map<string,Function>();registerScriptReadRoutes({get:(path:string,handler:Function)=>routes.set(path,handler)} as any,{...h.host,owner:()=> 'author'});
  const response:any={status(){return this;},json(body:unknown){this.body=body;return this;}};
  routes.get('/api/script-goals/:id')!({params:{id:first.goalId},query:{view:'state'}},response);
  assert.deepEqual(response.body.goal.pendingQuestion,question);
  const before=h.host.goals.read(first.goalId!,'author'),budget=h.host.budgets.read(before.revision.budgetId,'author');
  await assert.rejects(()=>h.host.commands.submit('author',h.command(first.goalId!,'no-answer'),h.frozen),/先回答/);
  const waiting=h.host.store.readRun(first.runId);
  assert.throws(()=>h.host.store.control(waiting.id,'author',waiting.version,'resume','bypass'),/回答/);
  const body=h.command(first.goalId!,'answer',{answer:{decisionId:question.decisionId,text:mechanicalAsk.choices[0].text,choiceId:'a'}});
  const accepted=await h.host.commands.submit('author',body,h.frozen);
  assert.deepEqual(await h.host.commands.submit('author',body,h.frozen),accepted);
  const next=h.host.goals.read(first.goalId!,'author');assert.equal(next.revision.authorAnswers?.length,1);
  assert.equal(next.revision.authorAnswers?.[0].decisionId,question.decisionId);
  assert.equal(next.revision.budgetId,budget.id);assert.deepEqual(h.host.budgets.read(budget.id,'author').used,budget.used);
  assert.equal(h.host.goals.pendingQuestion(first.goalId!,'author'),null);
  await h.host.worker.runOnce(accepted.runId);
  assert.ok(h.requests.at(-1)!.prompt.includes(mechanicalAsk.choices[0].text));
  assert.ok(h.requests.at(-1)!.prompt.includes('authorAnswers'));
  assert.ok(!h.requests.at(-1)!.prompt.includes(mechanicalAsk.message),'do not relabel old model question as author evidence');
  await assert.rejects(()=>h.host.commands.submit('author',h.command(first.goalId!,'stale',{answer:body.answer}),h.frozen),/问题已不再/);
});

test('paused ASK still requires its answer; changed versions and withdrawn sources reject answers atomically',async t=>{
  const h=setup(t),first=await h.start();await h.host.worker.runOnce(first.runId);
  const question=h.host.goals.pendingQuestion(first.goalId!,'author')!,old=h.command(first.goalId!,'old',{answer:{decisionId:question.decisionId,text:'作者回答'}});
  const run=h.host.store.readRun(first.runId);h.host.store.control(run.id,'author',run.version,'pause','pause');
  assert.equal(h.host.goals.pendingQuestion(first.goalId!,'author')?.decisionId,question.decisionId);
  await assert.rejects(()=>h.host.commands.submit('author',old,h.frozen),/版本已改变/);
  await assert.rejects(()=>h.host.commands.submit('author',h.command(first.goalId!,'paused-no-answer'),h.frozen),/先回答/);
  const badChoice=h.command(first.goalId!,'bad-choice',{answer:{decisionId:question.decisionId,text:'不匹配',choiceId:'a'}});
  await assert.rejects(()=>h.host.commands.submit('author',badChoice,h.frozen),/答案.*不一致/);
  assert.equal(h.host.commands.received('author',badChoice),null);
  h.host.contexts.revokeScope({ownerId:'author',scopeId:first.workspaceId,branch:`workspace:${first.workspaceId}`});
  assert.throws(()=>h.host.goals.pendingQuestion(first.goalId!,'author'),/撤回|权限|失效/);
  const revoked=h.command(first.goalId!,'revoked',{answer:{decisionId:question.decisionId,text:'作者回答'}});
  await assert.rejects(()=>h.host.commands.submit('author',revoked,h.frozen),/撤回|权限|失效/);
  assert.equal(h.host.commands.received('author',revoked),null);
});

test('next episode uses fixed predecessor read permission and no predecessor write target',async t=>{
  const h=setup(t),selection=newGoalSelection(h.saved,h.unit,undefined,'WRITE',1,4),first=await h.start(selection);
  const auth=h.host.authorizations.read(first.authorizationRef,'author'),scope=auth.scope as ScriptDraftScope;
  assert.ok(scope.units.every(unit=>unit.unitId!==h.unit.id));assert.equal(scope.newUnitSlots.length,1);
  assert.equal(scope.newUnitSlots[0].maxNewScenes,4);assert.equal(scope.units[0].maxNewScenes,4);
  assert.deepEqual(auth.sources[0].unitIds,[h.unit.id]);assert.equal(auth.sources[0].ref.version,String(h.saved.revision));
  const run=h.host.store.readRun(first.runId);
  assert.throws(()=>h.host.drafts.assertProposalTarget(run,{operation:'scene_body',unitId:h.unit.id,sceneId:h.unit.scenes[0].id} as any),/授权|范围|目标/);
  const grant=h.host.authorizations.grants(auth.id,'author')[0];
  const original=h.host.authorizations.withRunAuthorization(run,'CONSUME',()=>h.host.authorizations.readGranted(h.host.authorizations.ref(grant),
    {ownerId:'author',scopeId:first.workspaceId,branch:`workspace:${first.workspaceId}`},'CURRENT'));
  assert.match(JSON.stringify(original.data),/必须原样保留/);
  await h.host.worker.runOnce(first.runId);
  assert.equal(h.host.scripts.getProject(h.saved.id)!.units[0].scenes[0].blocks[0].text,h.unit.scenes[0].blocks[0].text);
});

test('configuration revision preserves untouched route, sources, budget and new-unit slot identity',async t=>{
  const h=setup(t),first=await h.start(newGoalSelection(h.saved,h.unit,undefined,'WRITE',1,4));
  const before=h.host.goals.read(first.goalId!,'author'),workspace=h.host.workspaces.read(first.workspaceId,'author');
  const oldScope=(before.revision.contract.value as any).scope as ScriptDraftScope;
  const method={id:'skill:method-a',title:'机械方法',version:'v2',content:'FULL_SKILL_SENTINEL',usage:{operations:['scene_body'],inputs:[],note:'FULL_CONFIG_SENTINEL'}};
  const body=h.command(first.goalId!,'configuration',{kind:'GOAL_REVISE',methodIds:['method-a'],target:goalSceneLimitTarget(oldScope,workspace,2)});
  await h.host.commands.submit('author',body,{resolveMethods:async()=>[method] as any,resolveExecution:()=>{throw Error('route must stay frozen');}});
  const after=h.host.goals.read(first.goalId!,'author'),scope=(after.revision.contract.value as any).scope as ScriptDraftScope;
  assert.equal(scope.newUnitSlots[0].unitId,oldScope.newUnitSlots[0].unitId);assert.equal(scope.newUnitSlots[0].slotId,oldScope.newUnitSlots[0].slotId);
  assert.equal(scope.newUnitSlots[0].maxNewScenes,2);assert.equal(scope.units[0].maxNewScenes,2);
  assert.deepEqual(after.revision.skillManifest,[method]);assert.deepEqual(after.revision.route,before.revision.route);
  assert.deepEqual(after.revision.sourceRefs,before.revision.sourceRefs);assert.equal(after.revision.budgetId,before.revision.budgetId);
  assert.deepEqual(before.revision.skillManifest,[]);
  const channel=h.command(first.goalId!,'channel',{kind:'GOAL_REVISE',executionChannel:'external'});
  await h.host.commands.submit('author',channel,{resolveMethods:async()=>{throw Error('method snapshot must stay frozen');},resolveExecution:()=>({channel:'external',routeRef:'frozen-new-route'})});
  const changed=h.host.goals.read(first.goalId!,'author');assert.deepEqual(changed.revision.skillManifest,[method]);assert.equal(changed.revision.route.channel,'external');
});
