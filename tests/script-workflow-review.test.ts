import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptProject,newUnit,newScene} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {detectWorkflowChanges} from '../packages/script/src/workflowReview';
import {newGoalSelection,goalStageTarget} from '../apps/web/src/features/script/scriptGoalAuthoring';
import {SCRIPT_STAGES,COMPATIBLE_SCRIPT_STAGES,stageDelivery} from '../packages/script/src/agentStages';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {readScriptGoalEnvelope,parseScriptGoalContract} from '../packages/script/src/agentGoal';

function fixture(){
  const project=createScriptProject('机械流程',createScriptCreationProfile('tv-series',3,10));
  project.brief.outline='原总纲';project.units[0].summary='原集纲';
  project.units[0].scenes[0].purpose='原分场';project.units[0].scenes[0].blocks[0].text='已有正文';
  return project;
}
test('four new stages retain legacy BEATS contract compatibility',()=>{
  assert.deepEqual(SCRIPT_STAGES,['BLUEPRINT','OUTLINE','SCENES','BODY']);
  assert.ok(COMPATIBLE_SCRIPT_STAGES.includes('BEATS'));
});
test('upstream changes flag existing downstream material without touching the manuscript',()=>{
  const before=fixture(),after=structuredClone(before);after.brief.concept='新方向';after.units[0].summary='新集纲';
  after.units[0].scenes[0].purpose='新场景安排';const saved=JSON.stringify(after);
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.target),['outline','board','studio']);
  assert.equal(JSON.stringify(after),saved);
  const bodyOnly=structuredClone(before);bodyOnly.units[0].scenes[0].blocks[0].text='修改对白';
  assert.deepEqual(detectWorkflowChanges(before,bodyOnly),[]);
});
test('initial planning without downstream text does not create a false review task',()=>{
  const before=createScriptProject('机械新稿',createScriptCreationProfile('short-film',1,3));
  const after=structuredClone(before);after.brief.concept='构想';after.brief.outline='故事';after.units[0].scenes[0].purpose='第一场';
  assert.deepEqual(detectWorkflowChanges(before,after),[]);
});
test('author completing a partial scene does not falsely report changed planning',()=>{
  const before=fixture();before.units[0].scenes[0].generation={status:'partial',checkpointId:'fixture',appliedSteps:[]};
  const after=structuredClone(before);after.units[0].scenes[0].blocks[0].text+='，作者补完结尾。';after.units[0].scenes[0].generation!.status='complete';
  assert.deepEqual(detectWorkflowChanges(before,after),[]);
});
test('structure purpose changes flag the existing body even when membership stays fixed',()=>{
  const before=fixture();before.units[0].structureNodes=[{id:'node-a',title:'开场',purpose:'旧安排'}];
  const after=structuredClone(before);after.units[0].structureNodes![0].purpose='新安排';
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.key),[`scenes:${before.units[0].id}`]);
});
test('a local story outline change flags its own episode and leaves unrelated stories alone',()=>{
  const before=fixture(),a=before.units[0];a.scopeId='story-a';before.units.push(newUnit('另一个故事',60000));
  const b=before.units[1];b.scenes[0].blocks[0].text='无关故事原文';
  before.storyOutlines=[{scopeId:a.scopeId,outline:'旧故事大纲'},{scopeId:b.scopeId,outline:'无关故事大纲'}];
  const after=structuredClone(before);after.storyOutlines![0].outline='新故事大纲';
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.unitId),[a.id]);
});
test('review notices survive repository reopen and unrelated saves; stale acknowledgement cannot clear a new change',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const repo=createScriptRepository(db);repo.ensureSchema();
  let project=repo.saveProject(fixture(),0);project.brief.outline='新总纲';project=repo.saveProject(project,project.revision);
  const original=repo.workflowReviews(project.id);assert.equal(original.length,1);
  const reopened=createScriptRepository(db);reopened.ensureSchema();assert.deepEqual(reopened.workflowReviews(project.id),original);
  project.units[0].scenes[0].blocks[0].text='正文修订';project=reopened.saveProject(project,project.revision);
  assert.deepEqual(reopened.workflowReviews(project.id),original);
  project.brief.outline='再次修改总纲';project=reopened.saveProject(project,project.revision);
  assert.throws(()=>reopened.acknowledgeWorkflowReviews(project.id,project.revision-1,original.map(item=>item.id)),
    (error: unknown) => error instanceof Error && (error as Error & {statusCode?: number}).statusCode === 409);
  reopened.acknowledgeWorkflowReviews(project.id,project.revision,original.map(item=>item.id));
  assert.equal(reopened.workflowReviews(project.id).length,1);
  const manuscript=JSON.stringify(reopened.getProject(project.id));
  reopened.acknowledgeWorkflowReviews(project.id,project.revision,reopened.workflowReviews(project.id).map(item=>item.id));
  assert.deepEqual(reopened.workflowReviews(project.id),[]);assert.equal(JSON.stringify(reopened.getProject(project.id)),manuscript);
});
test('episodic outline scope can stop at current episode without rewriting total outline or later episodes',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('No model calls in scope test');}},'workflow-fixture');
  const project=fixture();project.units[0].scenes=[];project.units.push(newUnit('第 2 集',600000));
  const thread=host.conversations.open('author','script:home','outline-scope');
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'scope-base',source:{document:project}});
  const {target}=newGoalSelection(project,project.units[0],workspace,'WRITE',0,4,'OUTLINE');
  assert.equal(target.sharedFields,undefined);assert.deepEqual(target.unitIds,[project.units[0].id]);
  const receipt=await host.commands.submit('author',{kind:'GOAL_START',stopAfter:'OUTLINE',requestId:'scope-goal',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},target,objective:'只完成第一集大纲',task:'WRITE',methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'fixture'})});
  const contract=readScriptGoalEnvelope(host.goals.read(receipt.goalId!,'author').revision.contract);
  assert.equal(contract.scope.sharedFields.includes('outline'),false);
  assert.equal(contract.scope.operations.includes('scene_body'),false);
  assert.equal(stageDelivery(project,contract.scope,'OUTLINE').ready,false,'joint outline needs declared relation delivery as well as original');assert.equal(contract.scope.outlineGrants?.[0].owner.id,project.units[0].id);
  const film={...project,profile:createScriptCreationProfile('short-film',1,3),units:[{...project.units[0],summary:''}]};
  const scope={...contract.scope,outlineGrants:undefined,sharedFields:['outline' as const]};
  assert.equal(stageDelivery(film,scope,'OUTLINE').ready,true,'standalone total outline does not require duplicate summary');
});


test('changing a selected-scene Goal from planning to body preserves its targets and check range',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('No external model');}},'scope-revision-fixture');
  const project=fixture();project.units[0].scenes.push(newScene('留待下一次的场景'));
  const thread=host.conversations.open('author','script:home','scope-revision');
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'scope-workspace',source:{document:project}});
  const unit=project.units[0],sceneId=unit.scenes[0].id;
  const target=newGoalSelection(project,unit,workspace,'WRITE',0,4,'SCENES',false,{kind:'scenes',sceneIds:[sceneId]}).target;
  const resolver={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'fixture'})};
  const receipt=await host.commands.submit('author',{kind:'GOAL_START',stopAfter:'SCENES',requestId:'scope-start',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},target,objective:'只规划选定这一场',task:'WRITE',methodIds:[]},resolver);
  const run=host.store.readRun(receipt.runId);host.store.control(run.id,'author',run.version,'pause','pause-for-change');
  const goal=host.goals.read(receipt.goalId!,'author'),scope=readScriptGoalEnvelope(goal.revision.contract).scope;
  const changed=goalStageTarget(scope,host.workspaces.read(workspace.id,'author'),4,'BODY');
  assert.deepEqual(changed.wholeUnitIds,[]);assert.deepEqual(changed.maxNewScenes,[]);assert.deepEqual(changed.sceneIds,[{unitId:unit.id,sceneId}]);
  await host.commands.submit('author',{kind:'GOAL_REVISE',stopAfter:'BODY',requestId:'scope-body',threadId:thread.id,expectedConversationVersion:host.conversations.read(thread.id,'author').version,goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:host.store.readRun(run.id).version,target:changed},resolver);
  const contract=readScriptGoalEnvelope(host.goals.read(goal.id,'author').revision.contract);
  assert.equal(contract.scope.units[0].allowAllScenes,false);assert.equal(contract.scope.units[0].allowSummary,false);
  assert.equal(contract.scope.operations.includes('plan_scenes'),false);
  assert.deepEqual(contract.checks.targetScenes,[{unitId:unit.id,sceneIds:[sceneId]}]);
  const tampered=structuredClone(contract);tampered.checks.targetScenes![0].sceneIds.push(unit.scenes[1].id);
  assert.throws(()=>parseScriptGoalContract(tampered),/检查范围必须/);
});
