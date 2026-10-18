import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {compileContext} from '../packages/agent-context/src';

function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());
 const h=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_MODEL');}},'historical-read',{trustedLegacyProjectOwner:'author'});
 const project=h.scripts.saveProject(createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3)),0);
 h.workspaces.bindTrustedProjectOwner(project.id,'author');
 const thread=h.conversations.open('author','script:home','historical-read');
 const first=h.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{projectId:project.id,revision:project.revision}});
 const changed=structuredClone(first.document);changed.brief.concept='CURRENT_ONLY';
 const current=h.workspaces.saveAuthor({ownerId:'author',workspaceId:first.id,requestId:'edit',expectedRevision:first.revision,expectedEpoch:first.writerEpoch,document:changed});
 return {db,h,project,first,current};
}

test('historical reads use their immutable body while owner bindings remain live',t=>{
 const {db,h,project,first,current}=setup(t);
 // The latest payload is unrelated to a request for the already stored first
 // version. Its parse and pending-change diff must not be prerequisites.
 db.prepare("UPDATE script_workspaces SET data='MALFORMED_CURRENT' WHERE id=?").run(current.id);
 assert.deepEqual(h.workspaces.version(first.id,'author',1),first.document);
 assert.throws(()=>h.workspaces.read(first.id,'author'));
 assert.throws(()=>h.workspaces.version(first.id,'outsider',1),(e:any)=>e.code==='WORKSPACE_NOT_FOUND');
 db.prepare("UPDATE script_workspaces SET owner_id='outsider' WHERE id=?").run(first.id);
 assert.throws(()=>h.workspaces.version(first.id,'author',1),(e:any)=>e.code==='WORKSPACE_NOT_FOUND');
 db.prepare("UPDATE script_workspaces SET owner_id='author' WHERE id=?").run(first.id);
 db.prepare("UPDATE script_project_owners SET owner_id='outsider' WHERE project_id=?").run(project.id);
 assert.throws(()=>h.workspaces.version(first.id,'author',1),(e:any)=>e.code==='SCRIPT_PROJECT_NOT_FOUND');
});

test('historical reads still revalidate source withdrawal and never reuse mutable results',t=>{
 const {db,h,first}=setup(t);
 const access={ownerId:'author',scopeId:first.id,branch:`workspace:${first.id}`};
 const ref=h.contexts.capture(access,compileContext({systemInstruction:'MECHANICAL',skills:[],sections:[]}));
 h.contexts.bindArtifact('script-workspace-version',`${first.id}:1`,ref,access);
 const returned=h.workspaces.version(first.id,'author',1);returned.brief.concept='POLLUTED';
 assert.deepEqual(h.workspaces.version(first.id,'author',1),first.document);
 assert.throws(()=>h.workspaces.version(first.id,'author',999),(e:any)=>e.code==='WORKSPACE_VERSION_NOT_FOUND');
 db.prepare('UPDATE agent_context_scopes SET policy_generation=policy_generation+1 WHERE owner_id=? AND scope_id=?').run('author',first.id);
 assert.throws(()=>h.workspaces.version(first.id,'author',1),'an earlier successful read cannot bypass later source withdrawal');
});
