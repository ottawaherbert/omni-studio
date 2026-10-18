import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentChildWorker, AgentWorker, ExecutionSuspended, hashValue} from '../packages/agent-core/src';

const busy=(ms:number)=>{const until=Date.now()+ms;while(Date.now()<until){};};

test('parent worker renews between separate synchronous decision and tool validations',async()=>{
 const request={capabilityId:'mechanical.read',capabilityVersion:'1',input:{value:'MECHANICAL'},callId:'call:mechanical'};
 const prepared={request,implementationDigest:'mechanical',contractDigest:'mechanical',inputDigest:'mechanical',
  binding:{ownerId:'owner',scopeId:'scope',commandRevision:'1',policyRevision:'p1'},sources:[],targets:[],preparedDigest:'mechanical'};
 const run={id:'run',threadId:'thread',ownerId:'owner',scopeId:'scope',kind:'GOAL',input:{},policyRevision:'p1',
  status:'RUNNING',version:1,generation:1,controlGeneration:1,fence:1,leaseUntil:Date.now()+5000};
 let renewals=0,handedOff=false;
 const token={runId:'run',workerId:'worker',fence:1,generation:1,inputRevision:1};
 const store={
  claim:()=>({run,token}),
  renew:()=>{renewals++;return Date.now()+5000;},
  assertExecution:()=>run,
  assertDecisionInput:()=>busy(25),
  getStep:()=>null,
  savePrepared:()=>({id:'step',status:'PREPARED',requestHash:hashValue(request),prepared}),
  handoff:()=>{handedOff=true;throw new ExecutionSuspended('WAITING_STEP','mechanical handoff');},
 } as any;
 const registry={
  prepare:async()=>{busy(25);return prepared;},
  attest:async()=>busy(25),
  describe:()=>[{id:'mechanical.read',version:'1',dispatch:'DURABLE',effect:'READ'}],
 } as any;
 const worker=new AgentWorker(store,registry,{workerId:'worker',leaseMs:30,handlers:{GOAL:async context=>{
  await context.call(request,()=>busy(25));
  return {status:'SUCCEEDED',result:null};
 }}});
 assert.equal(await worker.runOnce('run'),true);
 assert.equal(handedOff,true);
 assert.ok(renewals>=2,`expected heartbeat renewals between validators, got ${renewals}`);
});

test('committed receipt is consumed in the same source authorization turn',async()=>{
 const request={capabilityId:'mechanical.read',capabilityVersion:'1',input:{value:'MECHANICAL'},callId:'call:receipt'};
 const prepared={request,implementationDigest:'mechanical',contractDigest:'mechanical',inputDigest:'mechanical',
  binding:{ownerId:'owner',scopeId:'scope',commandRevision:'1',policyRevision:'p1'},sources:[],targets:[],preparedDigest:'mechanical'};
 const observation={status:'SUCCEEDED',summary:'MECHANICAL',data:{},evidence:[],artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'};
 const run={id:'run',threadId:'thread',ownerId:'owner',scopeId:'scope',kind:'CAPABILITY',input:{request},policyRevision:'p1',
  status:'RUNNING',version:1,generation:1,controlGeneration:1,fence:1,leaseUntil:Date.now()+5000,activeStepId:null};
 const token={runId:'run',workerId:'worker',fence:1,generation:1,inputRevision:1};
 let sourceRevoked=false,finishedAfterRevocation=false;
 const store={
  claim:()=>({run,token}),renew:()=>Date.now()+5000,assertExecution:()=>run,
  getStep:()=>({id:'step',status:'COMMITTED',requestHash:hashValue(request),prepared,observation}),
  finish:()=>{finishedAfterRevocation=sourceRevoked;return run;},
 } as any;
 const registry={
  attestReceipt:async()=>{if(sourceRevoked)throw new Error('source withdrawn');setTimeout(()=>{sourceRevoked=true;},0);},
  validateObservation:()=>observation,
  describe:()=>[{id:'mechanical.read',version:'1',dispatch:'INLINE',effect:'READ'}],
 } as any;
 const worker=new AgentWorker(store,registry,{workerId:'worker',handlers:{}});
 assert.equal(await worker.runOnce('run'),true);
 assert.equal(finishedAfterRevocation,false);
});

test('child worker renews after decision authorization before attesting its frozen tool',async()=>{
 const request={capabilityId:'mechanical.check',capabilityVersion:'1',input:{value:'MECHANICAL'},callId:'call:child'};
 const prepared={request,implementationDigest:'mechanical',contractDigest:'mechanical',inputDigest:'mechanical',
  binding:{ownerId:'owner',scopeId:'scope',commandRevision:'1',policyRevision:'p1'},sources:[],targets:[],preparedDigest:'mechanical'};
 const observation={status:'SUCCEEDED',summary:'MECHANICAL',data:{},evidence:[],artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'};
 const run={id:'run',threadId:'thread',ownerId:'owner',scopeId:'scope',kind:'GOAL',input:{},policyRevision:'p1',
  status:'WAITING_STEP',version:1,generation:1,controlGeneration:1,fence:1};
 const token={runId:'run',stepId:'step',leaseKind:'step',workerId:'child',fence:1,generation:1,inputRevision:1};
 let renewals=0,renewalsAtAttest=-1,completed=false;
 const store={
  claimChild:()=>({run,token,step:{id:'step',status:'PREPARED',prepared},leaseUntil:Date.now()+5000}),
  renew:()=>{renewals++;return Date.now()+5000;},assertExecution:()=>run,
  assertDecisionInput:()=>busy(25),
  getStep:()=>({status:'COMMITTED'}),commitStep:()=>observation,completeChild:()=>{completed=true;},
 } as any;
 const registry={
  describe:()=>[{id:'mechanical.check',version:'1',dispatch:'DURABLE',effect:'PROPOSE'}],
  attest:async()=>{renewalsAtAttest=renewals;busy(25);},attestReceipt:async()=>{},execute:async()=>{busy(25);return observation;},
 } as any;
 const worker=new AgentChildWorker(store,registry,{workerId:'child',leaseMs:30});
 assert.equal(await worker.runOnce('run'),true);
 assert.equal(completed,true);
 assert.ok(renewalsAtAttest>=1,`expected child heartbeat before attest, got ${renewalsAtAttest}`);
});
