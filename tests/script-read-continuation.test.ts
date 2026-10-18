import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createSceneContinuationCheckpoint } from '../packages/script/src/continuation';

test('paged script index exposes a server-derived checkpoint beyond the initial 80 scene preview',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());let decision=0,readResult:any;
 const project=createScriptProject('机械长片索引',createScriptCreationProfile('feature-film',1,90)),unit=project.units[0];
 while(unit.scenes.length<81)unit.scenes.push(newScene(`第${unit.scenes.length+1}场`));
 const selected=unit.scenes[80];
 selected.purpose='第八十一场完整目的';selected.entryState='入场时防水门仍闭合';selected.exitState='离场时已确认撤离路线';
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   const parts=request.prompt.split('\n\n').flatMap(part=>{try{return [JSON.parse(part)];}catch{return [];}}),goal=parts.find(part=>part.authorizationRef&&part.contract),index=parts.find(part=>part.meaning==='PLAN_INDEX_NOT_MANUSCRIPT');
   const base={kind:'STOP',capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:'MECHANICAL_INDEX_CHECKED',remainingWork:['正文未生成']};
   if(++decision===1){assert.equal(index.scenes.length,80);assert.ok(index.truncated);Object.assign(base,{kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:{authorizationRef:goal.authorizationRef,sourceId:null,view:'INDEX',unitId:unit.id,sceneId:selected.id,cursor:null,maxChars:6000,limit:1},reason:null,remainingWork:null});}
   else readResult=parts.find(part=>part.facts)?.facts.items.find((item:any)=>item.capabilityId==='script.read')?.result;
   return {text:JSON.stringify(base),provenance:{channel:'provider',producer:'MECHANICAL_READ_NO_EXTERNAL_MODEL'}};
 }},'read-checkpoint');
 const thread=host.conversations.open('author','script:home','read-checkpoint'),workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:project}});
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},task:'WRITE',stopAfter:'BODY',objective:'只检查第81场续写位置',target:{unitIds:[unit.id],sceneIds:[{unitId:unit.id,sceneId:selected.id}]},methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'mechanical'})});
 await host.worker.runOnce(receipt.runId);
 assert.equal(host.store.readRun(receipt.runId).status,'PARTIAL');assert.equal(decision,2);
 const plan=JSON.parse(readResult.rows[0].text);
 assert.equal(plan.purpose,selected.purpose);
 assert.equal(plan.entryState,selected.entryState);
 assert.equal(plan.exitState,selected.exitState);
 assert.deepEqual(plan.continuationCheckpoint,createSceneContinuationCheckpoint(workspace.document,unit.id,selected.id));
});
