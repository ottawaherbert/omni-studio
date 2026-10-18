import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ExecutionInvalidated, hashValue } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { AgentSqliteStore, SqliteContextStore } from '../packages/agent-sqlite/src';

test('synchronous context memo is isolated by reader, phase, database writes and call boundary',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();
  db.exec('CREATE TABLE permissions(allowed INTEGER NOT NULL); INSERT INTO permissions VALUES(1)');
  let reader='wide',current=true,calls=0;
  const contexts=new SqliteContextStore(store,dep=>{calls++;return reader==='wide'&&Boolean((db.prepare('SELECT allowed FROM permissions').get() as any).allowed)&&(dep.freshness==='EXACT'||current);},()=>reader);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'};
  const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('MECHANICAL'),branch:'author'};
  const snapshot=contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[{id:'body',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref,freshness:'CURRENT'}]}]}));
  calls=0;
  contexts.withValidationBatch(()=>{
    const first=contexts.assertVisible(snapshot,access);first.prompt='caller mutation';
    assert.notEqual(contexts.assertVisible(snapshot,access).prompt,'caller mutation');assert.equal(calls,1);
    reader='narrow';assert.throws(()=>contexts.assertVisible(snapshot,access));
    reader='wide';current=false;assert.throws(()=>contexts.assertAllowed(snapshot,access));
    db.prepare('UPDATE permissions SET allowed=0').run();assert.throws(()=>contexts.assertVisible(snapshot,access));
  });
  db.prepare('UPDATE permissions SET allowed=1').run();current=true;
  assert.doesNotThrow(()=>contexts.assertVisible(snapshot,access));
  reader='narrow';assert.throws(()=>contexts.assertVisible(snapshot,access));
  assert.throws(()=>contexts.withValidationBatch(()=>Promise.resolve(null)),/同步/);
});

test('inherited committed evidence remains visible after pointer change but cannot authorize a fresh model request',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();let current='1',allowed=true;
  const contexts=new SqliteContextStore(store,dep=>allowed&&(dep.freshness==='EXACT'||dep.ref.version===current));contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'},ref={uri:'resource://test/body',version:'1',contentHash:hashValue('MECHANICAL'),branch:'author'};
  const snapshot=contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[{id:'body',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref,freshness:'CURRENT'}]}]}));
  current='2';
  assert.throws(()=>contexts.bindArtifact('fresh','new',snapshot,access));
  contexts.bindEvidenceArtifact('committed','inherited',snapshot,access);
  contexts.assertArtifact('committed','inherited','VIEW');
  assert.throws(()=>contexts.assertAllowed(snapshot,access));
  allowed=false;assert.throws(()=>contexts.assertArtifact('committed','inherited','VIEW'));
});

test('snapshot batches never carry reader authority or accept changed stored bytes',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();let reader='first',allowed=true,calls=0;
  const contexts=new SqliteContextStore(store,()=>{calls++;return allowed;},()=>reader);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'};
  const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('MECHANICAL'),branch:'author'};
  const snapshot=contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[{id:'body',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref,freshness:'CURRENT'}]}]}));
  calls=0;
  contexts.withValidationBatch(()=>{
    contexts.assertVisible(snapshot,access);
    reader='second';contexts.assertVisible(snapshot,access);assert.equal(calls,2,'the same bytes under a second reader still require source authorization');
    reader='denied';allowed=false;assert.throws(()=>contexts.assertVisible(snapshot,access),/来源/);
    allowed=true;reader='corrupt';
    const row=db.prepare('SELECT bundle_json,memory_evidence_json FROM agent_context_snapshots WHERE id=?').get(snapshot.id) as {bundle_json:string;memory_evidence_json:string|null};
    const bundle=JSON.parse(row.bundle_json);bundle.prompt='tampered';
    db.prepare('UPDATE agent_context_snapshots SET bundle_json=? WHERE id=?').run(JSON.stringify(bundle),snapshot.id);
    assert.throws(()=>contexts.assertVisible(snapshot,access),/完整性/);
    db.prepare('UPDATE agent_context_snapshots SET bundle_json=? WHERE id=?').run(row.bundle_json,snapshot.id);
    contexts.assertVisible(snapshot,access);
    db.prepare("UPDATE agent_context_snapshots SET memory_evidence_json='[{\"id\":\"tampered\"}]' WHERE id=?").run(snapshot.id);
    assert.throws(()=>contexts.assertVisible(snapshot,access),/完整性/);
    db.prepare('UPDATE agent_context_snapshots SET memory_evidence_json=? WHERE id=?').run(row.memory_evidence_json,snapshot.id);
  });
  const visible=contexts.assertVisible(snapshot,access);visible.prompt='caller mutation';
  assert.notEqual(contexts.assertVisible(snapshot,access).prompt,visible.prompt,'decoded content retained between reads cannot be mutated through public results');
  allowed=false;assert.throws(()=>contexts.assertVisible(snapshot,access),/来源/,'identical cached bytes cannot carry authority into another request');
});

test('synchronous source validation stops within its configured batch deadline even when the source returns false',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();let delay=false;
  const contexts=new SqliteContextStore(store,()=>{
    if(delay){const until=Date.now()+15;while(Date.now()<until){} }
    return !delay;
  },()=>'',()=>true,5);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'};
  const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('MECHANICAL'),branch:'author'};
  const snapshot=contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[{
    id:'body',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref,freshness:'CURRENT'}]
  }]}));
  delay=true;
  assert.throws(()=>contexts.assertAllowed(snapshot,access),(error:unknown)=>error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT');
});

test('direct context capture shares the validation deadline with its source checks',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();
  const contexts=new SqliteContextStore(store,()=>{const until=Date.now()+15;while(Date.now()<until){}return true;},()=>'',()=>true,5);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'};
  const ref={uri:'resource://test/body',version:'1',contentHash:hashValue('MECHANICAL'),branch:'author'};
  const bundle=compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[{
    id:'body',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref,freshness:'CURRENT'}]
  }]});
  assert.throws(()=>contexts.capture(access,bundle),(error:unknown)=>error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT');
  assert.equal((db.prepare('SELECT count(*) n FROM agent_context_snapshots').get() as {n:number}).n,0);
});

test('memory query propagates a validation timeout instead of silently excluding an item',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();let slow=false;
  const contexts=new SqliteContextStore(store,()=>true,()=>'',()=>{
    if(slow){const until=Date.now()+15;while(Date.now()<until){} }
    return !slow;
  },5);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:'test',branch:'author'};
  contexts.createMemory(access,'author','MECHANICAL_CREATE',{key:'author.fact',kind:'AUTHOR_PREFERENCE',content:{label:'事实',value:'机械测试'},dependencies:[]});
  slow=true;
  assert.throws(()=>contexts.listMemories(access),(error:unknown)=>error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT');
});
