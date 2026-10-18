/** Isolated production-runtime HTTP freeze. CALL is a labeled mechanical
 * routing constant; only the subsequent creative candidate needs Sol output. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const filename=`/tmp/script-manual-dispatch-sol-${randomUUID()}.sqlite`,db=new Database(filename);
const runtime=createScriptRuntime(db,{transport:{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},owner:()=> 'author',
  resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'manual-sol-simulation'})});
const app=express();app.use(express.json({limit:'5mb'}));runtime.register(app);
const server=await new Promise<import('node:http').Server>((resolve,reject)=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));listening.once('error',reject);});
const address=server.address();if(!address||typeof address==='string')throw new Error('listener missing');
const base=`http://127.0.0.1:${address.port}`;
const api=async(route:string,body?:unknown)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(`${response.status} ${JSON.stringify(data)}`);return data as any;};
try{
  const conversation=(await api('/api/script-assistant/conversations',{clientKey:'manual-dispatch-sol'})).conversation;
  const project=createScriptProject('【模拟验收】日常场景',createScriptCreationProfile('short-film',1,5));
  project.units[0].scenes[0].blocks[0].text='【作者原文，机械验收】房间里有一把椅子。';
  const workspace=runtime.workspaces.create({ownerId:'author',threadId:conversation.id,requestId:'manual-sol-create',source:{document:project}});
  const selected={workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:workspace.document.units[0].id,sceneId:workspace.document.units[0].scenes[0].id};
  const input={text:'请在当前场补写一段可拍摄的日常动作，延续作者现有原文；不要替换作者稿。',methodIds:[],requestId:'manual-sol-call',expectedVersion:conversation.version,selection:selected};
  const accepted=await api(`/api/script-assistant/conversations/${conversation.id}/messages`,input);
  const runId=accepted.conversation.turns.find((turn:any)=>turn.id===accepted.turnId).runId;
  await runtime.worker.runOnce(runId);
  const decision=(await api(`/api/agent/runs/${runId}`)).externalRequests[0];
  assert.ok(decision.request.prompt.includes('房间里有一把椅子'));
  await api(`/api/agent/external/${decision.id}/result`,{inputHash:decision.inputHash,
    text:JSON.stringify({kind:'CALL',question:'',options:[]}),producer:{name:'MECHANICAL_CALL_ROUTE_ONLY'}});
  await runtime.worker.runOnce(runId);
  assert.equal(runtime.store.readRun(runId).status,'WAITING_STEP');
  await runtime.childWorker.runOnce(runId);
  const draft=(await api(`/api/agent/runs/${runId}`)).externalRequests.find((item:any)=>item.id!==decision.id);
  assert.ok(draft?.request?.prompt.includes('房间里有一把椅子'));
  const frozen={db:filename,ownerId:'author',threadId:conversation.id,workspaceId:workspace.id,runId,turnId:accepted.turnId,
    decisionRequest:decision,draftRequest:draft,selected,body:input};
  const path='artifacts/agent-foundation-study-2026-09-26/sol-manual-dispatch-frozen-request.json';
  writeFileSync(path,JSON.stringify(frozen,null,2));
  console.log(JSON.stringify({path,db:filename,runId,turnId:accepted.turnId,draftRequestId:draft.id,draftInputHash:draft.inputHash,
    decisionStatus:runtime.store.getStep(runId,1,accepted.turnId)?.status,runStatus:runtime.store.readRun(runId).status}));
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
