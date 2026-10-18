import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore } from '../packages/agent-sqlite/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';

test('workspace source ancestry avoids exponential expansion and revocation remains immediate',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();
  const thread=conversations.open('author','script:home','ancestry-review');
  const scripts=createScriptRepository(db);scripts.ensureSchema();
  let calls=0,allowed=true;
  const contexts=new SqliteContextStore(store,(dep,access)=>{calls++;return allowed&&workspaces.sourceAllowed(dep.ref,access,dep.freshness);});contexts.ensureSchema();
  const workspaces=new ScriptWorkspaceStore(store,scripts,{assertVersion:(id,revision,phase)=>contexts.assertArtifact('script-workspace-version',`${id}:${revision}`,phase)});workspaces.ensureSchema();
  let w=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3))}});
  const access={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
  // Build the same ancestry shape that consecutive model-authored revisions
  // produce, using author edits solely as isolated fixture construction.
  for(let revision=2;revision<=11;revision++){
    const previous=workspaceRef(w),next=structuredClone(w.document);next.brief.concept=`MECHANICAL_${revision}`;
    const bundle=compileContext({systemInstruction:'MECHANICAL',sections:[{id:'source',text:'MECHANICAL',required:true,priority:1,dependencies:[{ref:previous,freshness:'EXACT'}]}],skills:[]});
    const context=contexts.capture(access,bundle);
    w=workspaces.saveAuthor({ownerId:'author',workspaceId:w.id,requestId:`edit-${revision}`,expectedRevision:w.revision,expectedEpoch:w.writerEpoch,document:next});
    contexts.bindArtifact('script-workspace-version',`${w.id}:${w.revision}`,context,access);
  }
  calls=0;assert.equal(workspaces.read(w.id,'author').revision,11);
  const readCalls=calls;t.diagnostic(`10 source links used ${readCalls} source validations`);
  assert.ok(readCalls<=100,`10 source links must not recursively expand into ${readCalls} validations`);
  workspaces.assertReadable(w.id,'author');
  assert.throws(()=>workspaces.assertReadable(w.id,'other'));
  allowed=false;assert.throws(()=>workspaces.read(w.id,'author'));
  assert.throws(()=>workspaces.assertReadable(w.id,'author'),'permission-only reads must also validate all source ancestors');
});

test('later memory extraction does not block fixed workspace adoption, while source revocation still does',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_MODEL_IN_MECHANICAL_TEST');}},'memory-adoption-review');
  const thread=host.conversations.open('author','script:home','memory-adoption-review');
  const document=createScriptProject('机械记忆采用',createScriptCreationProfile('short-film',1,3));
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'memory-workspace',source:{document}});
  const access={ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`};
  const next=structuredClone(workspace.document);next.units[0].scenes[0].blocks[0].text='MECHANICAL_SAVED_DRAFT';
  const saved=host.workspaces.saveAuthor({workspaceId:workspace.id,ownerId:'author',requestId:'memory-draft',expectedRevision:1,expectedEpoch:1,document:next});
  const bundle=compileContext({systemInstruction:'机械冻结上下文',sections:[{id:'collection',text:'机械记忆目录',required:true,priority:1,
    dependencies:[{ref:host.contexts.listMemories(access).collection,freshness:'COLLECTION'}]}],skills:[]});
  const ref=host.contexts.capture(access,bundle);
  host.contexts.bindArtifact('script-workspace-version',`${workspace.id}:${saved.revision}`,ref,access);
  host.contexts.createMemory(access,'author','later-extraction',{key:'test.new-memory',kind:'AUTHOR_PREFERENCE',
    content:{label:'后续机械记忆',value:'模型成稿后新增'},dependencies:[]});
  const proposal=host.workspaces.prepareAdoption({workspaceId:workspace.id,ownerId:'author',workspaceRevision:saved.revision,expectedAuthorRevision:0});
  const adopted=host.workspaces.adopt({workspaceId:workspace.id,ownerId:'author',requestId:'adopt-after-memory',proposalId:proposal.id,digest:proposal.digest});
  assert.equal(host.scripts.getProject(adopted.projectId)!.units[0].scenes[0].blocks[0].text,'MECHANICAL_SAVED_DRAFT');
  host.contexts.revokeScope(access);
  assert.throws(()=>host.workspaces.prepareAdoption({workspaceId:workspace.id,ownerId:'author',workspaceRevision:adopted.synchronizedWorkspaceRevision,
    expectedAuthorRevision:adopted.projectRevision}),/撤回/);
});

test('content read batch reuses only exact document hashes while owner, writes and revocation remain live',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','content-batch');
 const scripts=createScriptRepository(db);scripts.ensureSchema();let allowed=true,checks=0;
 const workspaces=new ScriptWorkspaceStore(store,scripts,{assertVersion:()=>{checks++;if(!allowed)throw new Error('source revoked');}});workspaces.ensureSchema();
 const workspace=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'content-batch',source:{document:createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3))}});
 const ref=workspaceRef(workspace),access={ownerId:'author',scopeId:workspace.id,branch:ref.branch};
 const data=(db.prepare('SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=1').get(workspace.id) as {data:string}).data;
 const parse=JSON.parse;let parses=0;
 t.mock.method(JSON,'parse',(text:string,...args:any[])=>{if(text===data)parses++;return parse(text,...args);});
 const verify=(freshness:'EXACT'|'CURRENT'='EXACT')=>workspaces.sourceAllowed(ref,access,freshness);
 workspaces.withContentReadBatch(()=>{
  assert.equal(verify(),true);assert.equal(verify(),true);assert.equal(parses,1);
  allowed=false;assert.equal(verify(),false,'cached content must not suppress a source withdrawal');allowed=true;
  assert.equal(workspaces.sourceAllowed(ref,{...access,ownerId:'stranger'},'EXACT'),false);
  const changed=structuredClone(workspace.document);changed.brief.concept='changed';
  db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1').run(JSON.stringify(changed),workspace.id);
  assert.equal(verify(),false,'changed bytes in the same read transaction must not reuse an old hash');
  db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1').run(data,workspace.id);
  db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(JSON.stringify(changed),workspace.id);
  assert.equal(verify(),true,'EXACT still reads its historical document');assert.equal(verify('CURRENT'),false,'CURRENT must compare the actual current row');
 });
 const previous=parses;assert.equal(verify(),true);assert.equal(parses,previous,'identical bytes may reuse only their pure digest between reads');
 allowed=false;assert.equal(verify(),false,'a new read must recheck provenance even with a retained digest');allowed=true;
 assert.equal(workspaces.sourceAllowed(ref,{...access,ownerId:'stranger'},'EXACT'),false,'a retained digest grants no access to another owner');
 assert.ok(checks>=6,'each read checks version provenance even for repeated content');
 assert.throws(()=>workspaces.withContentReadBatch(()=>Promise.resolve()),/必须同步/);
});
