import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {workspaceRef} from '../apps/api/src/repositories/scriptWorkspaceStore';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {compileContext} from '../packages/agent-context/src';

function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());
 const h=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_MODEL');}},'revision-hash',{trustedLegacyProjectOwner:'author'});
 const project=h.scripts.saveProject(createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3)),0);
 h.workspaces.bindTrustedProjectOwner(project.id,'author');
 const thread=h.conversations.open('author','script:home','revision-hash');
 const first=h.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{projectId:project.id,revision:project.revision}});
 const access={ownerId:'author',scopeId:first.id,branch:`workspace:${first.id}`},ref=workspaceRef(first);
 let reads=0;const prepare=db.prepare;
 db.prepare=function(sql:any){const st=prepare.call(db,sql);if(sql!=='SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=?')return st;
  const get=st.get;st.get=function(...args:any[]){reads++;return get.apply(st,args);} as any;return st;} as any;
 return {db,h,project,first,access,ref,reads:()=>reads};
}

test('a bounded synchronous batch reuses only the version digest and releases it at exit',t=>{
 const f=setup(t),{h,first,access,ref}=f;const before=f.reads();
 h.workspaces.withContentReadBatch(()=>{
  for(let i=0;i<5;i++)assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  assert.equal(f.reads()-before,1);
  const returned=h.workspaces.version(first.id,'author',1);returned.brief.concept='POLLUTED';
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
 });
 assert.equal((h.workspaces as any).revisionHashBatch,null);
 const after=f.reads();assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);assert.equal(f.reads(),after+1);
 assert.throws(()=>h.workspaces.withContentReadBatch(()=>Promise.resolve()),(e:any)=>e.code==='ASYNC_WORKSPACE_READ');
 assert.equal((h.workspaces as any).revisionHashBatch,null);
});

test('owner, project owner, freshness and a changing policy gate stay live on every digest hit',t=>{
 const {db,h,first,project,access,ref}=setup(t);const policy=(h.workspaces as any).policy,original=policy.assertVersion;
 let allowed=true,calls=0;policy.assertVersion=(...args:any[])=>{calls++;original(...args);if(!allowed)throw Error('DYNAMIC_READER_OR_TIME_DENIED');};
 h.workspaces.withContentReadBatch(()=>{
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);const count=calls;
  allowed=false;assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);assert.ok(calls>count);allowed=true;
  assert.equal(h.workspaces.sourceAllowed(ref,{...access,ownerId:'other'},'EXACT'),false);
  assert.equal(h.workspaces.sourceAllowed(ref,{...access,branch:'other'},'EXACT'),false);
  db.prepare("UPDATE script_project_owners SET owner_id='other' WHERE project_id=?").run(project.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);
  db.prepare("UPDATE script_project_owners SET owner_id='author' WHERE project_id=?").run(project.id);
  db.prepare('UPDATE script_workspaces SET revision=2 WHERE id=?').run(first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'CURRENT'),false);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  db.prepare("UPDATE script_workspaces SET owner_id='other' WHERE id=?").run(first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);
 });
});

test('a write disables reuse for the rest of the batch, including nested rollback and delete',t=>{
 const {db,h,first,access,ref}=setup(t),changed=structuredClone(first.document);changed.brief.concept='TAMPER';
 const changedRef=workspaceRef({...first,document:changed});
 h.workspaces.withContentReadBatch(()=>{
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  assert.throws(()=>db.transaction(()=>{
   db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1').run(JSON.stringify(changed),first.id);
   assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);
   assert.equal(h.workspaces.sourceAllowed(changedRef,access,'EXACT'),true);
   throw Error('ROLLBACK');
  })(),/ROLLBACK/);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  assert.equal(h.workspaces.sourceAllowed(changedRef,access,'EXACT'),false);
  db.prepare('DELETE FROM script_workspace_revisions WHERE workspace_id=?').run(first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);
 });
});

test('the real source policy still blocks withdrawal after a successful read',t=>{
 const {db,h,first,access,ref}=setup(t);
 const snapshot=h.contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[]}));
 h.contexts.bindArtifact('script-workspace-version',`${first.id}:1`,snapshot,access);
 h.workspaces.withContentReadBatch(()=>{
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  db.prepare('UPDATE agent_context_scopes SET policy_generation=policy_generation+1 WHERE owner_id=? AND scope_id=?').run('author',first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),false);
 });
});

test('digest retention is capped at 128 revisions even inside one batch',t=>{
 const {db,h,first,access,ref}=setup(t);
 for(let revision=2;revision<=130;revision++)db.prepare('INSERT INTO script_workspace_revisions VALUES(?,?,?)').run(first.id,revision,JSON.stringify(first.document));
 h.workspaces.withContentReadBatch(()=>{
  for(let revision=1;revision<=130;revision++)assert.equal(h.workspaces.sourceAllowed({...ref,version:String(revision)},access,'EXACT'),true);
  assert.equal((h.workspaces as any).revisionHashBatch.hashes.size,128);
 });
 assert.equal((h.workspaces as any).revisionHashBatch,null);
});

 test('a write before the first lookup and a nested read batch cannot leak rollback state',t=>{
 const {db,h,first,access,ref}=setup(t),changed=structuredClone(first.document);changed.brief.concept='ROLLBACK_FIRST';
 const changedRef=workspaceRef({...first,document:changed});
 h.workspaces.withContentReadBatch(()=>{
  assert.throws(()=>db.transaction(()=>{
   db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1').run(JSON.stringify(changed),first.id);
   h.workspaces.withContentReadBatch(()=>assert.equal(h.workspaces.sourceAllowed(changedRef,access,'EXACT'),true));
   assert.equal(h.workspaces.sourceAllowed(changedRef,access,'EXACT'),true);
   throw Error('ROLLBACK');
  })(),/ROLLBACK/);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  assert.equal(h.workspaces.sourceAllowed(changedRef,access,'EXACT'),false);
 });
});

test('CURRENT reads the live body and accepts equivalent stored serialization only',t=>{
 const {db,h,first,access,ref}=setup(t),changed=structuredClone(first.document);changed.brief.concept='CURRENT_TAMPER';
 h.workspaces.withContentReadBatch(()=>{
  assert.equal(h.workspaces.sourceAllowed(ref,access,'CURRENT'),true);
  db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(JSON.stringify(changed),first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'CURRENT'),false);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'EXACT'),true);
  db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(JSON.stringify(first.document,null,2),first.id);
  assert.equal(h.workspaces.sourceAllowed(ref,access,'CURRENT'),true);
 });
});
