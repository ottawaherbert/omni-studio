import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {AgentWorker, AgentChildWorker} from '../packages/agent-core/src';
import {AgentSqliteStore} from '../packages/agent-sqlite/src';
import {preparedFixture, observationFixture} from './fixtures/agent-store-fixture';

const busy=(ms:number)=>{const stop=Date.now()+ms;while(Date.now()<stop){};};
function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const accepted=store.accept({requestId:'mechanical',ownerId:'owner',scopeId:'scope',kind:'CHAT',input:{message:'MECHANICAL_NO_MODEL'},policyRevision:'1',maxInvocations:1});
 return {db,store,accepted};
}
test('parent explicitly renews before a second long synchronous validation batch',async t=>{
 const {store,accepted}=setup(t),run=store.readRun(accepted.runId),prepared=preparedFixture(run);
 const originalDecision=store.assertDecisionInput.bind(store);let renewals=0;const originalRenew=store.renew.bind(store);
 store.renew=(token,ms)=>{renewals++;return originalRenew(token,ms);};
 store.assertDecisionInput=(...args)=>{originalDecision(...args);busy(285);};
 const registry={prepare:async()=>{busy(755);return prepared;},attest:async()=>{},
  describe:()=>[{id:prepared.request.capabilityId,version:'1',dispatch:'DURABLE',effect:'READ'}]} as any;
 const worker=new AgentWorker(store,registry,{workerId:'parent',leaseMs:1000,handlers:{CHAT:async context=>{
  await context.call(prepared.request);return {status:'SUCCEEDED',result:null};}}});
 await worker.runOnce(accepted.runId);
 assert.equal(store.readRun(accepted.runId).status,'WAITING_STEP');
 assert.ok(renewals>=1);
});
test('child explicitly renews before a second long synchronous validation batch',async t=>{
 const {store,accepted}=setup(t),parent=store.claim('parent',30000,accepted.runId)!,prepared=preparedFixture(parent.run);
 const step=store.savePrepared(parent.token,prepared);store.handoff(parent.token,step.id);
 const originalDecision=store.assertDecisionInput.bind(store);store.assertDecisionInput=(...args)=>{originalDecision(...args);busy(285);};
 let executed=false;const registry={describe:()=>[{id:prepared.request.capabilityId,version:'1',dispatch:'DURABLE',effect:'READ'}],
  attest:async()=>busy(755),attestReceipt:async()=>{},execute:async()=>{executed=true;return observationFixture;}} as any;
 const worker=new AgentChildWorker(store,registry,{workerId:'child',leaseMs:1000});await worker.runOnce(accepted.runId);
 assert.equal(executed,true);
 assert.equal(store.getStep(accepted.runId,parent.run.generation,prepared.request.callId)?.status,'COMMITTED');
});
