import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const transport={sendOnce:async()=>{throw new Error('Owner boundary tests must not call a model');}};
const project=(title:string)=>createScriptProject(title,createScriptCreationProfile('short-film',1,5));

test('an adopted project belongs to its author across project creation, grants, contexts and stale workspaces',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,transport,'owner-boundary');
  const alice=host.conversations.open('alice','script:home','Alice');
  const bob=host.conversations.open('bob','script:home','Bob');
  const source=project('ALICE_SECRET_PROJECT');source.units[0].scenes[0].blocks[0].text='ALICE_SECRET_SOURCE';
  const owned=host.workspaces.create({ownerId:'alice',threadId:alice.id,requestId:'alice-create',source:{document:source}});
  const proposal=host.workspaces.prepareAdoption({ownerId:'alice',workspaceId:owned.id,workspaceRevision:1,expectedAuthorRevision:0});
  host.workspaces.adopt({ownerId:'alice',workspaceId:owned.id,requestId:'alice-adopt',proposalId:proposal.id,digest:proposal.digest});
  const author=host.scripts.getProject(source.id)!;
  assert.equal(host.workspaces.ownsProject(source.id,'alice'),true);
  assert.equal(host.workspaces.ownsProject(source.id,'bob'),false);
  assert.throws(()=>host.workspaces.create({ownerId:'bob',threadId:bob.id,requestId:'bob-import',source:{projectId:source.id,revision:1}}),/作品不存在|不属于/);

  const previous={uri:`resource://script/projects/${source.id}`,version:'1',contentHash:hashValue(author),branch:'author'};
  const compiled=compileContext({systemInstruction:'',skills:[],sections:[{id:'previous',text:'ALICE_SECRET_SOURCE',required:true,priority:100,dependencies:[{ref:previous,freshness:'EXACT'}]}]});
  const aliceAccess={ownerId:'alice',scopeId:source.id,branch:'author'};
  const bobAccess={ownerId:'bob',scopeId:source.id,branch:'author'};
  const aliceContext=host.contexts.capture(aliceAccess,compiled);
  assert.doesNotThrow(()=>host.contexts.assertAllowed(aliceContext,aliceAccess));
  assert.throws(()=>host.contexts.capture(bobAccess,compiled),/来源|不可访问|CONTEXT/);

  const bobDraft=host.workspaces.create({ownerId:'bob',threadId:bob.id,requestId:'bob-create',source:{document:project('Bob draft')}});
  const scope={workspaceId:bobDraft.id,documentId:bobDraft.documentId,originRevision:bobDraft.revision,
    originContentHash:hashValue(bobDraft.document),operations:[],units:[],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
  assert.throws(()=>host.authorizations.issue({ownerId:'bob',threadId:bob.id,workspaceId:bobDraft.id,commandId:'bob-foreign-source',scope,
    sources:[{ref:previous,access:bobAccess,purpose:'PREVIOUS_SCRIPT',unitIds:null}]}),/来源|不可访问|不属于/);

  // A pre-fix workspace could have persisted the foreign project ID and body.
  // Its own workspace owner must not make that project body readable again.
  db.prepare('UPDATE script_workspaces SET project_id=?,document_id=?,data=? WHERE id=?')
    .run(source.id,source.id,JSON.stringify({...author,revision:1}),bobDraft.id);
  db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1')
    .run(JSON.stringify({...author,revision:1}),bobDraft.id);
  assert.throws(()=>host.workspaces.read(bobDraft.id,'bob'),/作品不存在|不属于/);
  assert.throws(()=>host.workspaces.version(bobDraft.id,'bob',1),/作品不存在|不属于/);
  assert.throws(()=>host.workspaces.prepareAdoption({ownerId:'bob',workspaceId:bobDraft.id,workspaceRevision:1,expectedAuthorRevision:1}),/作品不存在|不属于/);
  assert.deepEqual(host.workspaces.list('bob'),[]);
  assert.equal(host.scripts.getProject(source.id)!.units[0].scenes[0].blocks[0].text,'ALICE_SECRET_SOURCE');
});

test('only a trusted binding or configured local author migrates an ownerless legacy project, without changing existing owners',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,transport,'legacy-owner');
  const aliceThread=host.conversations.open('alice','script:home','Alice');
  const bobThread=host.conversations.open('bob','script:home','Bob');
  const legacy=host.scripts.saveProject(project('Legacy author document'),0);
  assert.equal(host.workspaces.ownsProject(legacy.id,undefined as unknown as string),false);
  assert.throws(()=>host.workspaces.create({ownerId:'bob',threadId:bobThread.id,requestId:'bob-claim',source:{projectId:legacy.id,revision:1}}),/作品不存在|不属于/);
  assert.throws(()=>host.workspaces.create({ownerId:'alice',threadId:aliceThread.id,requestId:'alice-claim',source:{projectId:legacy.id,revision:1}}),/作品不存在|不属于/);
  host.workspaces.bindTrustedProjectOwner(legacy.id,'alice');
  assert.throws(()=>host.workspaces.bindTrustedProjectOwner(legacy.id,'bob'),/作品不存在|不属于/);
  assert.doesNotThrow(()=>host.workspaces.create({ownerId:'alice',threadId:aliceThread.id,requestId:'alice-import',source:{projectId:legacy.id,revision:1}}));

  const unbound=host.scripts.saveProject(project('Unbound production legacy document'),0);
  const reopened=createScriptAgentHost(db,transport,'production-reopen',{trustedLegacyProjectOwner:'local-author'});
  assert.equal(reopened.workspaces.ownsProject(legacy.id,'alice'),true);
  assert.equal(reopened.workspaces.ownsProject(legacy.id,'local-author'),false);
  assert.equal(reopened.workspaces.ownsProject(unbound.id,'local-author'),true);
  assert.equal(reopened.workspaces.ownsProject(unbound.id,'bob'),false);
  assert.doesNotThrow(()=>reopened.workspaces.read(reopened.workspaces.list('alice')[0].id,'alice'));
});
