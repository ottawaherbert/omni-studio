import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {AgentWorker,DecisionDriver,AgentError,hashValue} from '../packages/agent-core/src';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptGoalPlugin} from '../apps/api/src/agent/scriptGoalPlugin';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';

const envelope=(kind:string,fields:Record<string,unknown>)=>({kind,capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null,...fields});
for(const branch of ['CALL','FINISH'] as const)for(const mutation of ['none','fence','revoke','rollback'] as const)
test(`real parent ${branch} loop renews after guarded receipt transition: ${mutation}`,async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());let sends=0;
 const transport={sendOnce:async()=>{sends++;throw Error('NO_MODEL');}};
 const h=createScriptAgentHost(db,transport,'parent-boundary',{trustedLegacyProjectOwner:'author'});
 const thread=h.conversations.open('author','script:home','parent-boundary'),project=createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3));
 project.units[0].scenes[0].blocks[0].text='MECHANICAL_EXISTING_BODY';const saved=h.scripts.saveProject(project,0);
 const accepted=await h.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:thread.version,
  source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},objective:'MECHANICAL_GOAL',task:'REVISE',target:{unitIds:[saved.units[0].id],wholeUnitIds:[saved.units[0].id]},methodIds:[]},
  {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
 await h.worker.runOnce(accepted.runId);
 const first=h.journal.listExternal(accepted.runId,'author').find(r=>r.status==='WAITING')!;
 const goal=h.goals.read(accepted.goalId!,'author');
 const decision=branch==='CALL'?envelope('CALL',{capabilityId:'script.read',capabilityVersion:'1',arguments:{authorizationRef:goal.revision.authorizationRef,sourceId:null,view:'BODY',unitId:saved.units[0].id,sceneId:null,cursor:null,maxChars:100,limit:20}}):envelope('FINISH',{summary:'MECHANICAL_FINISH_PROPOSAL',artifactRefs:[goal.revision.workspaceRef]});
 h.journal.submitExternal(first.id,'author',first.inputHash,JSON.stringify(decision),{name:'MECHANICAL'});
 const beforeHash=hashValue(h.workspaces.read(accepted.workspaceId!,'author').document);
 let now=Date.now(),transitioned=false,boundarySeen=false,progressCalls=0;
 const savedNow=Date.now;Date.now=()=>now;(h.store as any).now=()=>now;t.after(()=>{Date.now=savedNow;});
 // Reattestation/commit already receives the worker's existing 60s guard.
 // Charge its observed 12s so that later normal checkpoints have 30s left.
 const commit=h.store.commitStep.bind(h.store);h.store.commitStep=(...args)=>{now+=12000;return commit(...args);};
 const plugin=createScriptGoalPlugin(h),projectProgress=plugin.projectProgress.bind(plugin);
 plugin.projectProgress=async(...args)=>{const result=await projectProgress(...args);progressCalls++;now+=21000;return result;};
 const build=plugin.buildDecisionInput.bind(plugin);plugin.buildDecisionInput=async(...args)=>{const result=await build(...args);now+=21000;return result;};
 const method=branch==='CALL'?'consumeReceipt':'advanceDecision',transition=h.goals[method].bind(h.goals);
 (h.goals as any)[method]=(...args:any[])=>{
  now+=12000;
  if(mutation==='rollback')return h.store.atomic(()=>{(transition as any)(...args);throw new AgentError('MECHANICAL_ROLLBACK','MECHANICAL_ROLLBACK');});
  const result=(transition as any)(...args);transitioned=true;return result;
 };
 const renew=h.store.renew.bind(h.store);h.store.renew=(token,ms)=>{
  assert.equal(db.inTransaction,false,'checkpoint must stay outside the receipt transaction');
  if(transitioned&&!boundarySeen){boundarySeen=true;assert.equal(ms,30000,'loop boundary keeps the normal lease');
   if(mutation==='fence')db.prepare('UPDATE agent_runs SET fence=fence+1 WHERE id=?').run(accepted.runId);
   if(mutation==='revoke')db.prepare("UPDATE script_authorizations SET owner_id='revoked' WHERE id=?").run(goal.revision.authorizationRef);
  }
  return renew(token,ms);
 };
 const driver=new DecisionDriver(h.goals,h.journal,transport,plugin),worker=new AgentWorker(h.store,h.registry,{workerId:'parent-boundary',handlers:{GOAL:ctx=>driver.handle(ctx)}});
 if(mutation==='revoke')await assert.rejects(()=>worker.runOnce(accepted.runId),(error:any)=>error.code==='SCRIPT_AUTHORIZATION_DENIED');
 else await worker.runOnce(accepted.runId);
 const samplings=(db.prepare('SELECT data_json FROM agent_samplings WHERE run_id=? ORDER BY idx').all(accepted.runId) as any[]).map(r=>JSON.parse(r.data_json));
 if(mutation==='none'){
  assert.equal(h.store.readRun(accepted.runId).status,'WAITING_EXTERNAL');assert.equal(samplings.length,2);assert.equal(samplings[0].acceptedDecision.consumed,true);assert.ok(boundarySeen);assert.equal(progressCalls,2);
 }else{
  assert.equal(samplings.length,1,'no new frozen request from stale authority or a rolled-back transition');
  assert.equal(samplings[0].acceptedDecision.consumed,mutation!=='rollback');
  if(mutation!=='rollback')assert.ok(boundarySeen);else assert.equal(boundarySeen,false);
 }
 // Already committed reads survive a failed coordinator transition. No draft
 // mutation is authorized by either read or an unverified FINISH proposal.
 assert.equal((db.prepare("SELECT count(*) n FROM agent_steps WHERE run_id=? AND status='COMMITTED'").get(accepted.runId) as any).n,branch==='CALL'?1:0);
 const document=JSON.parse((db.prepare('SELECT data FROM script_workspaces WHERE id=?').get(accepted.workspaceId) as any).data);
 assert.equal(hashValue(document),beforeHash);assert.equal(sends,0);
});
