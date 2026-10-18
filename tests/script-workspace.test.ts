import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteConversationStore, SqliteContextStore } from '../packages/agent-sqlite/src';
import { CapabilityRegistry, hashValue } from '../packages/agent-core/src';
import { compileContext, memorySection } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { applyWorkspacePatch, createWorkspacePatch, workspacePatchConflicts } from '../packages/script/src/workspacePatch';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

function document() { const p=createScriptProject('机械流程验收',createScriptCreationProfile('tv-series',3,20));p.units[0].scenes[0].blocks[0].text='【人工协议测试原文】保留整句与空格。';return p; }
function setup(t:any) {
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','workspace-tests');
  const scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts,{assertModelWrite:()=>{},trustedLegacyProjectOwner:'author'});workspaces.ensureSchema();
  const create=()=>workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{document:document()}});
  return {db,store,thread,scripts,workspaces,create};
}
test('structural patch adds a new unit, character and scene with references and preserves unrelated author edits',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);
  const unit=newUnit('第2集',1200000,draft.id),character={id:'person_new',name:'协议人物',scopeId:draft.id,desire:'',need:'',contradiction:'',arc:'',voice:''};
  draft.characters.push(character);unit.scenes[0].characterIds=[character.id];draft.units.push(unit);
  draft.units[0].scenes[0].title='工作稿调整标题';author.units[0].scenes[0].blocks[0].text='【作者改稿】另一个字段必须保留';
  const merged=applyWorkspacePatch(author,createWorkspacePatch(base,draft));
  assert.equal(merged.units.length,2);assert.equal(merged.characters[0].id,character.id);assert.equal(merged.units[0].scenes[0].title,'工作稿调整标题');
  assert.equal(merged.units[0].scenes[0].blocks[0].text,author.units[0].scenes[0].blocks[0].text);assert.deepEqual(base.units.length,1);
});
test('same-field conflicts, broken references, orphan entities, unknown paths and immutable originals fail without mutation',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);draft.units[0].scenes[0].blocks[0].text='工作稿修改';author.units[0].scenes[0].blocks[0].text='作者修改';
  const snapshot=structuredClone(author);assert.throws(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)),/分别改动/);assert.deepEqual(author,snapshot);
  author.units[0].scenes[0].blocks[0].text=draft.units[0].scenes[0].blocks[0].text;assert.doesNotThrow(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)));
  assert.throws(()=>applyWorkspacePatch(base,{projectId:base.id,operations:[{key:'project/id',beforeHash:null,after:{present:true,value:'override'}}]}),/格式无效/);
  const orphan=newScene();assert.throws(()=>applyWorkspacePatch(base,{projectId:base.id,operations:[{key:`scene/${base.units[0].id}/${orphan.id}`,beforeHash:null,after:{present:true,value:orphan}}]}),/未引用/);
  draft.originalMaterial={kind:'scene',text:'伪造原件'};assert.throws(()=>createWorkspacePatch(base,draft),/身份|原件/);
  const broken=structuredClone(base);broken.units[0].scenes[0].characterIds=['missing'];assert.throws(()=>createWorkspacePatch(base,broken),/引用不存在/);
});
test('scene reordering is explicit and concurrent structure edits conflict',()=>{
  const base=document();base.units[0].scenes.push(newScene('第二场'));const draft=structuredClone(base);draft.units[0].scenes.reverse();
  const patch=createWorkspacePatch(base,draft);assert.deepEqual(applyWorkspacePatch(base,patch).units[0].scenes.map(s=>s.id),draft.units[0].scenes.map(s=>s.id));
  const author=structuredClone(base);author.units[0].scenes.push(newScene('作者新场'));assert.throws(()=>applyWorkspacePatch(author,patch),/分别改动/);
});
test('explicit structural choices preserve either an author-deleted scene or the fixed workspace scene',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes[1].blocks[0].text='WORKSPACE_BODY';draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[0].scenes.pop();
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);assert.equal(conflicts[0].authorPresent,false);
  assert.equal(applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft).units[0].scenes.length,1);
  const revived=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(revived.units[0].scenes[1].blocks[0].text,'WORKSPACE_BODY');
  assert.equal(revived.units[0].summary,'WORKSPACE_SUMMARY');
  assert.throws(()=>applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}]),/固定工作稿/);
});
test('author choice keeps a concurrently edited deleted scene and unit in their parent orders',()=>{
  const base=document();base.units.push(newUnit('机械第二单元',1000,base.id));
  const draft=structuredClone(base);draft.units.pop();draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[1].scenes[0].blocks[0].text='AUTHOR_BODY';
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);
  const kept=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft);
  assert.equal(kept.units.length,2);assert.equal(kept.units[1].scenes[0].blocks[0].text,'AUTHOR_BODY');
  assert.equal(kept.units[0].summary,'WORKSPACE_SUMMARY');
  const removed=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(removed.units.length,1);
});
test('author order choice restores referenced scenes and drops excluded workspace additions',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes.pop();draft.units[0].scenes.push(newScene('工作稿新增场'));
  const author=structuredClone(base);author.units[0].scenes.push(newScene('作者新增场'));
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  const order=conflicts.find(item=>item.key===`sceneOrder/${base.units[0].id}`);
  assert.ok(order);
  const kept=applyWorkspacePatch(author,patch,[{id:order.id,choice:'AUTHOR'}],draft);
  assert.deepEqual(kept.units[0].scenes.map(scene=>scene.id),author.units[0].scenes.map(scene=>scene.id));
});
test('workspace order choice removes author-only descendants excluded by a chosen scene or unit deletion',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes.pop();draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[0].scenes[1].blocks[0].text='AUTHOR_EDIT';author.units[0].scenes.push(newScene('作者新增场'));
  const patch=createWorkspacePatch(base,draft),choices=workspacePatchConflicts(author,patch).map(item=>({id:item.id,choice:'WORKSPACE' as const}));
  const merged=applyWorkspacePatch(author,patch,choices,draft);
  assert.equal(merged.units[0].scenes.length,1);assert.equal(merged.units[0].summary,'WORKSPACE_SUMMARY');
  assert.equal(author.units[0].scenes.length,3,'预览不得改写作者原稿');

  const unitBase=document();unitBase.units.push(newUnit('机械第二单元',1000,unitBase.id));
  const unitDraft=structuredClone(unitBase);unitDraft.units.pop();unitDraft.units[0].summary='WORKSPACE_UNIT_SUMMARY';
  const unitAuthor=structuredClone(unitBase);unitAuthor.units[1].scenes.push(newScene('作者新增场'));
  const unitPatch=createWorkspacePatch(unitBase,unitDraft),unitChoices=workspacePatchConflicts(unitAuthor,unitPatch).map(item=>({id:item.id,choice:'WORKSPACE' as const}));
  const unitMerged=applyWorkspacePatch(unitAuthor,unitPatch,unitChoices,unitDraft);
  assert.equal(unitMerged.units.length,1);assert.equal(unitMerged.units[0].summary,'WORKSPACE_UNIT_SUMMARY');
  assert.equal(unitAuthor.units.length,2,'单元删除预览不得改写作者原稿');
});
test('conflict choices bind to exact author and workspace values',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);
  draft.title='WORKSPACE_TITLE';author.title='AUTHOR_TITLE';
  const patch=createWorkspacePatch(base,draft),first=workspacePatchConflicts(author,patch);
  author.title='AUTHOR_TITLE_V2';
  const second=workspacePatchConflicts(author,patch);assert.notEqual(first[0].id,second[0].id);
  assert.throws(()=>applyWorkspacePatch(author,patch,[{id:first[0].id,choice:'WORKSPACE'}],draft),/分别改动|冲突集合/);
});
test('an optional field added to a scene deleted by the author still requires an explicit choice',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes[1].storyOrder=2;
  const author=structuredClone(base);author.units[0].scenes.pop();
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);assert.equal(conflicts[0].authorPresent,false);
  const kept=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft);
  assert.equal(kept.units[0].scenes.length,1);
  const revived=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(revived.units[0].scenes[1].storyOrder,2);
});
test('unpublished workspace persists versions without creating a project; owner, CAS, replay and frozen execution inputs are enforced',t=>{
  const h=setup(t),source=document(),input={ownerId:'author',threadId:h.thread.id,requestId:'create-exact',source:{document:source}},w=h.workspaces.create(input);
  assert.deepEqual(h.workspaces.create(input),w);assert.equal(h.scripts.listProjects().length,0);
  assert.throws(()=>h.workspaces.read(w.id,'other'),/不存在/);
  const changed=structuredClone(w.document);changed.units[0].scenes[0].blocks[0].text='【作者】工作稿新正文';
  const save={workspaceId:w.id,ownerId:'author',requestId:'save-one',expectedRevision:1,expectedEpoch:1,document:changed};
  const v2=h.workspaces.saveAuthor(save);assert.equal(v2.revision,2);assert.deepEqual(h.workspaces.saveAuthor(save),v2);
  const sourceAccess={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
  assert.equal(h.workspaces.sourceAllowed(workspaceRef(w),sourceAccess,'EXACT'),true);assert.equal(h.workspaces.sourceAllowed(workspaceRef(w),sourceAccess,'CURRENT'),false);
  assert.equal(h.workspaces.sourceAllowed(workspaceRef(v2),sourceAccess,'CURRENT'),true);assert.equal(h.workspaces.sourceAllowed(workspaceRef(v2),{...sourceAccess,scopeId:'script:home'},'EXACT'),false);
  assert.equal(h.workspaces.sourceAllowed(workspaceRef(v2),{...sourceAccess,ownerId:'another'},'EXACT'),false);
  assert.throws(()=>h.workspaces.saveAuthor({...save,requestId:'stale'}),/新版本|已被更新/);
  assert.equal(h.workspaces.version(w.id,'author',1).units[0].scenes[0].blocks[0].text,w.document.units[0].scenes[0].blocks[0].text);
  assert.equal('restore' in h.workspaces,false);
  assert.equal(h.workspaces.read(w.id,'author').revision,2);
  const exported=h.workspaces.exportVersion({workspaceId:w.id,ownerId:'author',revision:2,unitIds:[w.document.units[0].id],format:'fountain'});
  assert.match(exported.text,/工作稿新正文/);assert.equal(exported.ref.version,'2');assert.equal(exported.kind,'candidate');
});
test('pre-migration restore receipt remains target-change evidence without reinstating author restore',t=>{
  const h=setup(t),w=h.create(),unitId=w.document.units[0].id;
  const changed=structuredClone(w.document);changed.units[0].scenes[0].blocks[0].text='MECHANICAL_OLD_AUTHOR_RESTORE';
  const saved=h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'seed-old-edit',expectedRevision:1,expectedEpoch:1,document:changed});
  h.db.prepare('DELETE FROM script_workspace_commands WHERE owner_id=? AND request_id=?').run('author','seed-old-edit');
  h.db.prepare('INSERT INTO script_workspace_commands(owner_id,request_id,payload_hash,response_json,action) VALUES(?,?,?,?,?)')
    .run('author','legacy-restore',hashValue({action:'restore',workspaceId:w.id,revision:1}),JSON.stringify(saved),'restore');
  assert.equal(h.workspaces.authorChangedTargetSince(w.id,'author',1,[unitId]),true);
  assert.equal(h.workspaces.authorChangedTargetSince(w.id,'author',2,[unitId]),false);
  assert.equal(h.workspaces.authorChangedTargetSince(w.id,'author',1,['unselected_unit']),false);
  assert.equal(h.workspaces.authorChangedTargetSince(w.id,'another',1,[unitId]),false);
  assert.equal('restore' in h.workspaces,false);
  assert.equal(h.scripts.listProjects().length,0);
  assert.equal(h.db.prepare("SELECT 1 FROM sqlite_master WHERE name='script_revisions'").get(),undefined);
});
test('takeover pauses/fences an in-flight run and atomically saves the author version; stale run cannot write',t=>{
  const h=setup(t),w=h.create();const accepted=h.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'run',kind:'GOAL',input:{},policyRevision:'1',maxInvocations:5});
  h.workspaces.bindWriter({workspaceId:w.id,ownerId:'author',runId:accepted.runId,expectedEpoch:1});const claim=h.store.claim('worker',30000)!;
  const next=structuredClone(w.document);next.units[0].scenes[0].blocks[0].text='【接管】作者新稿';
  const v2=h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'takeover',expectedRevision:1,expectedEpoch:1,document:next,takeover:{runId:claim.run.id,expectedVersion:h.store.readRun(claim.run.id).version}});
  assert.equal(v2.writerRunId,null);assert.equal(v2.writerEpoch,2);assert.equal(h.store.readRun(claim.run.id).status,'PAUSED');
  assert.throws(()=>h.workspaces.applyFromRun({workspaceId:w.id,ownerId:'author',token:claim.token,callId:'stale-call',expectedRevision:1,writerEpoch:1,patch:createWorkspacePatch(w.document,next),contextRef:{id:'protocol',digest:'protocol'}}));
  assert.equal(h.workspaces.read(w.id,'author').document.units[0].scenes[0].blocks[0].text,'【接管】作者新稿');
});
test('failed takeover save rolls back pause and writer release',t=>{
  const h=setup(t),w=h.create(),accepted=h.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'run',kind:'GOAL',input:{},policyRevision:'1',maxInvocations:5});
  h.workspaces.bindWriter({workspaceId:w.id,ownerId:'author',runId:accepted.runId,expectedEpoch:1});const claim=h.store.claim('worker',30000)!;
  assert.throws(()=>h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'invalid-takeover',expectedRevision:99,expectedEpoch:1,document:w.document,takeover:{runId:claim.run.id,expectedVersion:claim.run.version}}));
  assert.equal(h.store.readRun(claim.run.id).status,'RUNNING');assert.equal(h.workspaces.read(w.id,'author').writerRunId,claim.run.id);h.store.assertExecution(claim.token);
});
test('adoption creates one author project; later adoption uses paired checkpoints and preserves author edits',t=>{
  const h=setup(t),w=h.create(),first=h.workspaces.prepareAdoption({workspaceId:w.id,ownerId:'author',workspaceRevision:1,expectedAuthorRevision:0});
  const command={workspaceId:w.id,ownerId:'author',requestId:'adopt1',proposalId:first.id,digest:first.digest};const receipt=h.workspaces.adopt(command);
  assert.deepEqual(h.workspaces.adopt(command),receipt);assert.equal(h.scripts.listProjects().length,1);assert.equal(receipt.projectRevision,1);
  const author=h.scripts.getProject(w.documentId)!;author.units[0].scenes[0].blocks[0].text='【作者采用后修改】必须保留';h.scripts.saveProject(author,1);
  const synchronized=h.workspaces.read(w.id,'author');assert.equal(synchronized.revision,2);const draft=structuredClone(synchronized.document);draft.units[0].scenes[0].title='后续工作稿标题';const v2=h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'next-draft',expectedRevision:2,expectedEpoch:1,document:draft});
  const second=h.workspaces.prepareAdoption({workspaceId:w.id,ownerId:'author',workspaceRevision:v2.revision,expectedAuthorRevision:2});h.workspaces.adopt({workspaceId:w.id,ownerId:'author',requestId:'adopt2',proposalId:second.id,digest:second.digest});
  const merged=h.scripts.getProject(w.documentId)!;assert.equal(merged.revision,3);assert.equal(merged.units[0].scenes[0].title,'后续工作稿标题');assert.match(merged.units[0].scenes[0].blocks[0].text,/必须保留/);assert.match(h.workspaces.read(w.id,'author').document.units[0].scenes[0].blocks[0].text,/必须保留/);
});
test('merge preview is pinned and stale adoption cannot overwrite author or workspace changes',t=>{
  const h=setup(t),p=h.scripts.saveProject(document(),0),w=h.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'from-project',source:{projectId:p.id,revision:1}});
  const preview=h.workspaces.prepareAdoption({workspaceId:w.id,ownerId:'author',workspaceRevision:1,expectedAuthorRevision:1});
  p.title='作者已保存';h.scripts.saveProject(p,1);
  assert.throws(()=>h.workspaces.adopt({workspaceId:w.id,ownerId:'author',requestId:'stale-preview',proposalId:preview.id,digest:preview.digest}),/新版本|已被更新/);
  assert.equal(h.scripts.getProject(p.id)!.revision,2);assert.equal(h.workspaces.read(w.id,'author').baseProjectRevision,1);
});

test('author project edits sync into an existing workspace without losing unrelated local work or replaying twice',t=>{
  const h=setup(t),project=h.scripts.saveProject(document(),0),w=h.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'sync-workspace',source:{projectId:project.id,revision:1}});
  const local=structuredClone(w.document);local.units[0].scenes[0].title='【机械工作稿】独立标题';
  const v2=h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'sync-local',expectedRevision:1,expectedEpoch:1,document:local});
  const author=structuredClone(project);author.units[0].scenes[0].blocks[0].text='【作者正文】独立保存';
  h.scripts.saveProject(author,1);
  const command={workspaceId:w.id,ownerId:'author',requestId:'sync-author',expectedRevision:v2.revision,expectedEpoch:v2.writerEpoch,expectedAuthorRevision:2};
  const receipt=h.workspaces.syncAuthor(command),synced=receipt.workspace;
  assert.equal(receipt.changed,true);assert.equal(synced.revision,3);assert.equal(synced.baseProjectRevision,2);
  assert.equal(synced.document.units[0].scenes[0].title,'【机械工作稿】独立标题');
  assert.equal(synced.document.units[0].scenes[0].blocks[0].text,'【作者正文】独立保存');
  assert.deepEqual(h.workspaces.syncAuthor(command),receipt);
  assert.throws(()=>h.workspaces.syncAuthor({...command,requestId:'stale-sync'}),/版本/);
  const preview=h.workspaces.prepareAdoption({workspaceId:w.id,ownerId:'author',workspaceRevision:synced.revision,expectedAuthorRevision:2});
  h.workspaces.adopt({workspaceId:w.id,ownerId:'author',requestId:'after-sync-adopt',proposalId:preview.id,digest:preview.digest});
  const adopted=h.scripts.getProject(project.id)!;
  assert.equal(adopted.units[0].scenes[0].title,'【机械工作稿】独立标题');
  assert.equal(adopted.units[0].scenes[0].blocks[0].text,'【作者正文】独立保存');
});

test('author sync rejects a same-field collision without changing either version',t=>{
  const h=setup(t),project=h.scripts.saveProject(document(),0),w=h.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'collision-workspace',source:{projectId:project.id,revision:1}});
  const local=structuredClone(w.document);local.units[0].scenes[0].blocks[0].text='【工作稿】局部修改';
  const v2=h.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'collision-local',expectedRevision:1,expectedEpoch:1,document:local});
  const author=structuredClone(project);author.units[0].scenes[0].blocks[0].text='【作者稿】另一修改';
  h.scripts.saveProject(author,1);
  assert.throws(()=>h.workspaces.syncAuthor({workspaceId:w.id,ownerId:'author',requestId:'collision-sync',
    expectedRevision:v2.revision,expectedEpoch:v2.writerEpoch,expectedAuthorRevision:2}),/分别改动/);
  const unchanged=h.workspaces.read(w.id,'author');assert.equal(unchanged.revision,2);assert.equal(unchanged.baseProjectRevision,1);
  assert.equal(unchanged.document.units[0].scenes[0].blocks[0].text,'【工作稿】局部修改');
  assert.equal(h.scripts.getProject(project.id)!.units[0].scenes[0].blocks[0].text,'【作者稿】另一修改');
});

test('workspace model commit, source binding and receipt roll back together; revocation propagates through frozen task inputs and cached receipts',async t=>{
  const h=setup(t),w=h.create(),contexts=new SqliteContextStore(h.store,()=>true);contexts.ensureSchema();
  const access={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
  const memory=contexts.createMemory(access,'author','source-memory',{key:'test.protocol',kind:'AUTHOR_PREFERENCE',content:{label:'协议记忆',value:'【机械参考】用于撤回校验'},dependencies:[]});
  const compiled=compileContext({systemInstruction:'机械协议测试',sections:[memorySection(contexts.getMemory(memory.id,access))],skills:[]}),contextRef=contexts.capture(access,compiled);
  let rejectBinding=true;
  const workspaces=new ScriptWorkspaceStore(h.store,h.scripts,{
    assertVersion:(id,revision,phase)=>contexts.assertArtifact('script-workspace-version',`${id}:${revision}`,phase),
    assertModelWrite:input=>{contexts.assertAllowed(input.contextRef,access);},
    bindModelVersion:(workspace,ref)=>{contexts.bindArtifact('script-workspace-version',`${workspace.id}:${workspace.revision}`,ref,access);if(rejectBinding)throw new Error('fault after binding');},
  });
  const request={capabilityId:'protocol.workspace.write',capabilityVersion:'1',callId:'write',input:{}};
  const run=h.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'write-run',kind:'CAPABILITY',input:{request},policyRevision:'1',maxInvocations:1});
  workspaces.bindWriter({workspaceId:w.id,ownerId:'author',runId:run.runId,expectedEpoch:1});const claim=h.store.claim('writer',30000)!;
  const registry=new CapabilityRegistry({assertExecution:async c=>{h.store.assertExecution(c.execution);},authorize:async()=>{}}).register({spec:{id:request.capabilityId,version:'1',implementationDigest:hashValue('protocol'),description:'mechanical test',effect:'WRITE',cost:'NONE',dispatch:'INLINE',replay:'TRANSACTIONAL',input:{jsonSchema:{},parse:x=>x},output:{jsonSchema:{},parse:x=>x}},execute:async()=>{throw new Error('not used');}});
  const prepared=await registry.prepare(request,{ownerId:'author',scopeId:'script:home',commandRevision:'1',policyRevision:'1',execution:claim.token,signal:new AbortController().signal});
  const step=h.store.savePrepared(claim.token,prepared),token={...claim.token,stepId:step.id};
  const desired=structuredClone(w.document);desired.units[0].scenes[0].blocks[0].text='【机械候选】测试持久提交';
  const command={workspaceId:w.id,ownerId:'author',token,callId:'write',expectedRevision:1,writerEpoch:1,patch:createWorkspacePatch(w.document,desired),contextRef};
  assert.throws(()=>workspaces.applyFromRun(command),/fault after binding/);
  assert.equal(workspaces.read(w.id,'author').revision,1);assert.equal(h.store.getStep(run.runId,1,'write')!.status,'PREPARED');assert.equal(contexts.hasArtifact('script-workspace-version',`${w.id}:2`),false);
  rejectBinding=false;const result=workspaces.applyFromRun(command);assert.equal(result.artifacts[0].contentHash,hashValue(workspaces.version(w.id,'author',2)));assert.equal(h.store.getStep(run.runId,1,'write')!.status,'COMMITTED');
  h.store.finish(claim.token,'SUCCEEDED',result);workspaces.releaseRun(run.runId);
  const v2=workspaces.read(w.id,'author');const edited=structuredClone(v2.document);edited.title='作者修改名称';
  const authorCommand={workspaceId:w.id,ownerId:'author',requestId:'author-after-model',expectedRevision:2,expectedEpoch:v2.writerEpoch,document:edited};
  workspaces.saveAuthor(authorCommand);
  const unguarded=new ScriptWorkspaceStore(h.store,h.scripts);assert.throws(()=>unguarded.read(w.id,'author'),/上下文仓储/);
  contexts.updateMemory(access,'forget',memory.id,1,'DELETE');
  assert.throws(()=>workspaces.read(w.id,'author'));assert.throws(()=>workspaces.saveAuthor(authorCommand));
  assert.throws(()=>workspaces.exportVersion({workspaceId:w.id,ownerId:'author',revision:3,unitIds:[w.document.units[0].id],format:'markdown'}));
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_revisions WHERE workspace_id=?').get(w.id) as any).n,3);
});
