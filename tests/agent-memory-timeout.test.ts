import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteMemoryWorkStore } from '../packages/agent-sqlite/src';
import { ExecutionInvalidated, hashValue } from '../packages/agent-core/src';

test('transient validation limit must not permanently cancel queued memory work',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();
 const workStore=new SqliteMemoryWorkStore(store,contexts);workStore.ensureSchema();
 const access={ownerId:'author',scopeId:'test',branch:'author'};
 const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'};
 const work=workStore.enqueue({access,key:'script.body',text:'body',ref,freshness:'CURRENT',channel:'api',routeRef:'model'});
 (contexts as any).assertSource=()=>{throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','slow');};
 assert.equal(workStore.cancelStaleUnsent(),0);
 assert.equal(workStore.read(work.id,access).status,'QUEUED');
});

test('freeze timeout must leave an unsent memory job queued',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>{const until=Date.now()+20;while(Date.now()<until){}return true;},()=>'',()=>true,5);contexts.ensureSchema();
 const workStore=new SqliteMemoryWorkStore(store,contexts);workStore.ensureSchema();
 const access={ownerId:'author',scopeId:'test',branch:'author'};
 const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'};
 const work=workStore.enqueue({access,key:'script.body',text:'body',ref,freshness:'CURRENT',channel:'api',routeRef:'model'});
 assert.equal(workStore.freezeNext(),null);
 assert.equal(workStore.read(work.id,access).status,'QUEUED');
});

test('received external memory result remains retryable after transient validation timeout',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();
 const workStore=new SqliteMemoryWorkStore(store,contexts);workStore.ensureSchema();
 const access={ownerId:'author',scopeId:'test',branch:'author'};
 const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'};
 workStore.enqueue({access,key:'script.body',text:'body',ref,freshness:'CURRENT',channel:'external',routeRef:'model'});
 const frozen=workStore.freezeNext()!;
 const original=contexts.assertAllowed.bind(contexts);
 (contexts as any).assertAllowed=()=>{throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','slow');};
 const result={text:'{"items":[]}',provenance:{channel:'external-return' as const}};
 assert.throws(()=>workStore.complete(frozen.id,access,frozen.requestHash!,result),(e:any)=>e.code==='CONTEXT_VALIDATION_LIMIT');
 assert.equal(workStore.read(frozen.id,access).status,'RECEIVED');
 assert.deepEqual(workStore.read(frozen.id,access).result,result);
 assert.throws(()=>workStore.complete(frozen.id,access,frozen.requestHash!,{text:'{"items":[{"key":"x","kind":"NAVIGATION","label":"x","value":"x"}]}',provenance:{channel:'external-return'}}),(e:any)=>e.code==='IDEMPOTENCY_CONFLICT');
 assert.equal(workStore.read(frozen.id,access).status,'RECEIVED');
 assert.deepEqual(workStore.read(frozen.id,access).result,result);
 (contexts as any).assertAllowed=original;
 assert.equal(workStore.complete(frozen.id,access,frozen.requestHash!,result).status,'DONE');
});

test('provider return after timeout is consumed once after restart without a second send',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();
 const workStore=new SqliteMemoryWorkStore(store,contexts);workStore.ensureSchema();
 const access={ownerId:'author',scopeId:'test',branch:'author'};
 const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'};
 const work=workStore.enqueue({access,key:'script.body',text:'body',ref,freshness:'CURRENT',channel:'api',routeRef:'model'});
 const original=contexts.assertAllowed.bind(contexts);let validations=0;
 (contexts as any).assertAllowed=(...args:any[])=>{if(++validations===3)throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','slow');return original(...args);};
 let sends=0;const transport={sendOnce:async()=>{sends++;return {text:'{"items":[{"key":"derived.fact","kind":"DOMAIN_DERIVED","label":"fact","value":"body"}]}',provenance:{channel:'provider' as const}};}};
 await assert.rejects(workStore.runOnce(transport as any,new AbortController().signal),(e:any)=>e.code==='CONTEXT_VALIDATION_LIMIT');
 assert.equal(workStore.read(work.id,access).status,'RECEIVED');assert.equal(sends,1);
 (contexts as any).assertAllowed=original;
 const reopened=new SqliteMemoryWorkStore(store,contexts);reopened.ensureSchema();
 const done=await reopened.runOnce(transport as any,new AbortController().signal);
 assert.equal(done?.status,'DONE');assert.equal(sends,1);
 assert.equal((db.prepare('SELECT count(*) n FROM agent_memories').get() as any).n,1);
});

test('one timed-out RECEIVED scope cannot starve another received result',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();const workStore=new SqliteMemoryWorkStore(store,contexts);workStore.ensureSchema();
 const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'};
 const a={ownerId:'author',scopeId:'scope-a',branch:'author'},b={ownerId:'author',scopeId:'scope-b',branch:'author'};
 workStore.enqueue({access:a,key:'script.a',text:'body',ref,freshness:'CURRENT',channel:'external',routeRef:'model'});
 const one=workStore.freezeNext()!;
 workStore.enqueue({access:b,key:'script.b',text:'body',ref,freshness:'CURRENT',channel:'external',routeRef:'model'});
 const two=workStore.freezeNext()!;
 assert.equal(one.source.access.scopeId,'scope-a');assert.equal(two.source.access.scopeId,'scope-b');
 const original=contexts.assertAllowed.bind(contexts);
 (contexts as any).assertAllowed=()=>{throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','slow');};
 const result={text:'{"items":[]}',provenance:{channel:'external-return' as const}};
 for(const work of [one,two])assert.throws(()=>workStore.complete(work.id,work.source.access,work.requestHash!,result),(e:any)=>e.code==='CONTEXT_VALIDATION_LIMIT');
 db.prepare("UPDATE agent_memory_work SET retry_after=0 WHERE status='RECEIVED'").run();
 (contexts as any).assertAllowed=(ref:any,access:any)=>{if(access.scopeId==='scope-a')throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','slow-a');return original(ref,access);};
 const transport={sendOnce:async()=>{throw Error('must not send')}},signal=new AbortController().signal;
 for(let i=0;i<3;i++){try{await workStore.runOnce(transport as any,signal);}catch(e:any){assert.equal(e.code,'CONTEXT_VALIDATION_LIMIT');}}
 assert.equal(workStore.read(two.id,b).status,'DONE');
 assert.equal(workStore.read(one.id,a).status,'RECEIVED');
});

test('known provider rejection marks memory work failed with evidence, never unknown or retried',async t=>{
 const {ModelResponseError}=await import('../packages/agent-core/src/model');
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();
 const jobs=new SqliteMemoryWorkStore(store,contexts);jobs.ensureSchema();
 const access={ownerId:'author',scopeId:'test',branch:'author'};
 const work=jobs.enqueue({access,key:'script.body',text:'body',ref:{uri:'resource://test/body',version:'1',contentHash:hashValue('body'),branch:'author'},freshness:'CURRENT',channel:'api',routeRef:'mock'});
 let calls=0;
 const result={text:'',provenance:{channel:'provider' as const},failure:{kind:'HTTP' as const,code:'HTTP_BAD_REQUEST',message:'HTTP 400',httpStatus:400}};
 const transport={sendOnce:async()=>{calls++;throw new ModelResponseError(result);}};
 await assert.rejects(jobs.runOnce(transport,new AbortController().signal),(error:any)=>error.code==='HTTP_BAD_REQUEST');
 assert.equal(jobs.read(work.id,access).status,'FAILED');assert.deepEqual(jobs.read(work.id,access).result,result);
 await jobs.runOnce(transport,new AbortController().signal);assert.equal(calls,1);
});
