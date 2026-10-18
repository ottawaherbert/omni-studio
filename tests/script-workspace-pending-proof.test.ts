import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {compileContext} from '../packages/agent-context/src';

function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());
 const h=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_NETWORK');}},'pending-proof');
 const thread=h.conversations.open('author','script:home','pending-proof');
 const document=createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3));
 const w=h.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{document}});
 const changed=structuredClone(w.document);changed.brief.concept='MECHANICAL_CHANGED';
 const after=h.workspaces.saveAuthor({ownerId:'author',workspaceId:w.id,requestId:'edit',expectedRevision:w.revision,expectedEpoch:w.writerEpoch,document:changed});
 return {db,h,w:after};
}
test('pending-change proof uses exact live rows and cannot carry owner, source, or mutable document state',t=>{
 const {db,h,w}=setup(t);assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,true);
 const first=h.workspaces.read(w.id,'author');first.document.brief.concept='POLLUTED';
 assert.equal(h.workspaces.read(w.id,'author').document.brief.concept,'MECHANICAL_CHANGED');
 db.prepare("UPDATE script_workspaces SET owner_id='another' WHERE id=?").run(w.id);assert.throws(()=>h.workspaces.read(w.id,'author'));
 db.prepare("UPDATE script_workspaces SET owner_id='author' WHERE id=?").run(w.id);
 const base=(db.prepare('SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=?').get(w.id,w.baseWorkspaceRevision) as any).data;
 const current=(db.prepare('SELECT data FROM script_workspaces WHERE id=?').get(w.id) as any).data;
 db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(base,w.id);assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,false);
 db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(current,w.id);assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,true);
 db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=?').run(current,w.id,w.baseWorkspaceRevision);
 assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,false);
 db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=?').run(base,w.id,w.baseWorkspaceRevision);
 assert.throws(()=>db.transaction(()=>{db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(base,w.id);assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,false);throw Error('ROLLBACK');})(),/ROLLBACK/);
 assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,true);
 db.prepare("UPDATE script_workspaces SET data='bad json' WHERE id=?").run(w.id);assert.throws(()=>h.workspaces.read(w.id,'author'));
 db.prepare('UPDATE script_workspaces SET data=? WHERE id=?').run(current,w.id);
 const access={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
 const ref=h.contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[]}));
 h.contexts.bindArtifact('script-workspace-version',`${w.id}:${w.revision}`,ref,access);
 assert.equal(h.workspaces.read(w.id,'author').hasPendingChanges,true);
 db.prepare('UPDATE agent_context_scopes SET policy_generation=policy_generation+1 WHERE owner_id=? AND scope_id=?').run('author',w.id);
 assert.throws(()=>h.workspaces.read(w.id,'author'),'an identical diff proof cannot bypass current source revocation');
});
test('pending-change proof retains at most one bounded exact pair and handles equivalent serialization',t=>{
 const {db,h,w}=setup(t),store=h.workspaces as any;
 assert.equal(store.read(w.id,'author').hasPendingChanges,true);
 assert.ok(store.pendingChangesContent);assert.ok(store.pendingChangesContent.base.length+store.pendingChangesContent.current.length<=16_000_000);
 const document=store.read(w.id,'author').document,data=JSON.stringify(document);
 assert.equal(store.hasPendingChanges(' '+data,data,document),false,'byte-different but equivalent JSON has no patch');
 assert.equal(store.hasPendingChanges(' '.repeat(16_000_001)+data,data,document),false);
 assert.equal(store.pendingChangesContent,null,'oversized pairs are not retained');
 assert.equal(store.read(w.id,'author').hasPendingChanges,true);
});
