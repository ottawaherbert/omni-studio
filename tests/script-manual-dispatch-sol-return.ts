/** Restarted, isolated production-runtime HTTP acceptance for the exact Sol
 * simulated candidate. The earlier CALL is a labeled mechanical route value. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

const frozen = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-manual-dispatch-frozen-request.json','utf8'));
const responsePath = process.argv[2];
if (!responsePath) throw new Error('Pass the specified gpt-6-sol response file');
const simulated = JSON.parse(readFileSync(responsePath,'utf8'));
assert.match(simulated.identity,/Sol 模拟返回/);
assert.equal(simulated.externalId,frozen.draftRequest.id);
assert.equal(simulated.inputHash,frozen.draftRequest.inputHash);
const parsed = JSON.parse(simulated.responseText);
assert.ok(Array.isArray(parsed.blocks) && parsed.blocks.length > 0);
assert.ok(parsed.blocks.some((block: {text:string})=>block.text.includes('房间里有一把椅子')));
const db = new Database(frozen.db);
let externalModelCalls = 0;
const runtime = createScriptRuntime(db,{transport:{sendOnce:async()=>{externalModelCalls++;throw new Error('NO_EXTERNAL_MODEL');}},
  owner:()=>frozen.ownerId,resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'manual-sol-simulation'})});
const app = express();app.use(express.json({limit:'5mb'}));runtime.register(app);
const server = await new Promise<import('node:http').Server>((resolve,reject)=>{
  const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));listening.once('error',reject);
});
const address=server.address();if(!address||typeof address==='string')throw new Error('listener missing');
const base=`http://127.0.0.1:${address.port}`;
const api=async(path:string,body?:unknown)=>{const result=await fetch(base+path,{method:body===undefined?'GET':'POST',
  headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const payload=await result.json();if(!result.ok)throw new Error(`${result.status} ${JSON.stringify(payload)}`);return payload as any;};
try{
  const before=await api(`/api/agent/external/${frozen.draftRequest.id}`);
  assert.equal(before.request.inputHash,frozen.draftRequest.inputHash);
  assert.deepEqual(before.request.request,frozen.draftRequest.request);
  const authorBefore=await api(`/api/script-workspaces/${frozen.workspaceId}`);
  const initialRevision=authorBefore.workspace.revision;
  const result=await api(`/api/agent/external/${frozen.draftRequest.id}/result`,{
    inputHash:frozen.draftRequest.inputHash,text:simulated.responseText,producer:{name:'gpt-6-sol-labeled-simulation'}});
  assert.equal(result.request.status,'RECEIVED');
  const duplicate=await api(`/api/agent/external/${frozen.draftRequest.id}/result`,{
    inputHash:frozen.draftRequest.inputHash,text:simulated.responseText,producer:{name:'gpt-6-sol-labeled-simulation'}});
  assert.deepEqual(duplicate,result);
  await runtime.childWorker.runOnce(frozen.runId);
  await runtime.worker.runOnce(frozen.runId);
  const complete=await api(`/api/agent/runs/${frozen.runId}`);
  assert.equal(complete.run.status,'SUCCEEDED',JSON.stringify(complete.run));
  const conversation=await api(`/api/script-assistant/conversations/${frozen.threadId}`);
  const turn=conversation.conversation.turns.find((item:any)=>item.id===frozen.turnId);
  assert.equal(turn.response.dispatch.kind,'CALL');
  assert.ok(turn.response.dispatch.candidateId);
  assert.equal(turn.response.dispatch.candidateStatus,'VALID');
  const candidate=(await api(`/api/script-workspaces/${frozen.workspaceId}/candidates/${turn.response.dispatch.candidateId}`)).candidate;
  assert.equal(candidate.status,'VALID');
  assert.equal(candidate.request.operation,'scene_body');
  assert.equal(candidate.request.unitId,frozen.selected.unitId);
  assert.equal(candidate.request.sceneId,frozen.selected.sceneId);
  assert.equal(candidate.modelInputHash,frozen.draftRequest.inputHash);
  const source=await api(`/api/script-workspaces/${frozen.workspaceId}/candidates/${candidate.id}/request`);
  assert.equal(source.inputHash,frozen.draftRequest.inputHash);
  assert.deepEqual(source.request,frozen.draftRequest.request);
  const after=await api(`/api/script-workspaces/${frozen.workspaceId}`);
  assert.equal(after.workspace.revision,initialRevision);
  assert.equal(after.workspace.document.units[0].scenes[0].blocks[0].text,'【作者原文，机械验收】房间里有一把椅子。');
  assert.equal(externalModelCalls,0);
  const receipt={db:frozen.db,runId:frozen.runId,turnId:frozen.turnId,candidateId:candidate.id,
    candidateStatus:candidate.status,workspaceRevision:after.workspace.revision,draftRequestId:frozen.draftRequest.id,
    inputHash:frozen.draftRequest.inputHash,externalModelCalls,
    evidence:'real HTTP + restarted isolated SQLite + specified gpt-6-sol labeled simulated candidate'};
  writeFileSync('artifacts/agent-foundation-study-2026-09-26/sol-manual-dispatch-http-acceptance.json',JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
