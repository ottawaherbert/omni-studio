import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteConversationStore } from '../packages/agent-sqlite/src';
import { AgentError, CapabilityRegistry, hashValue, stableJson } from '../packages/agent-core/src';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { createWorkspacePatch, applyWorkspacePatch } from '../packages/script/src/workspacePatch';
import { createScriptProject, newUnit, unitContentHash } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { analyseTimeline } from '../packages/script/src/runtime';
import type { ScriptProject, TimingEvidence } from '../packages/script/src/schema';

// Independent mechanical fault cases; no model output or external service.
const document = () => createScriptProject('独立仓储故障测试', createScriptCreationProfile('tv-series', 3, 20));
const evidence = (): TimingEvidence => ({ id:'mechanical_measurement',kind:'final',source:'ffprobe',durationMs:1000,contentHash:'mechanical-content',assumptions:'',mediaHash:'mechanical-media',toolVersion:'test-only',rawMeasurement:'{}',settingsHash:'mechanical-settings' });
function setup(t: any) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  const thread = conversations.open('review-author', 'script:home', 'review');
  const scripts = createScriptRepository(db); scripts.ensureSchema();
  const workspaces = new ScriptWorkspaceStore(store, scripts, {trustedLegacyProjectOwner:'review-author'}); workspaces.ensureSchema();
  const access = (workspaceId: string) => ({workspaceId,ownerId:'review-author'});
  const create = (source: {document:ScriptProject}|{projectId:string;revision:number}={document:document()}) => workspaces.create({ownerId:'review-author',threadId:thread.id,requestId:'create',source});
  return {db,store,conversations,thread,scripts,workspaces,access,create};
}

test('unchanged workspace baseline skips duplicate document parsing without hiding semantic edits',t=>{
 const h=setup(t),workspace=h.create();
 const row=h.db.prepare('SELECT data FROM script_workspaces WHERE id=?').get(workspace.id) as {data:string};
 const parse=JSON.parse;let parses=0;
 t.mock.method(JSON,'parse',(value:string,...args:any[])=>{if(value===row.data)parses++;return parse(value,...args);});
 assert.equal(h.workspaces.read(workspace.id,'review-author').hasPendingChanges,false);
 assert.equal(parses,1,'an identical adopted baseline should not be parsed and diffed again');
 h.workspaces.assertReadable(workspace.id,'review-author');
 assert.equal(parses,1,'permission-only reads must not decode the current document');
 h.db.prepare('UPDATE script_workspace_revisions SET data=? WHERE workspace_id=? AND revision=1').run(JSON.stringify(parse(row.data),null,2),workspace.id);
 assert.equal(h.workspaces.read(workspace.id,'review-author').hasPendingChanges,false,'different serialization is still compared semantically');
 const changed=structuredClone(workspace.document);changed.title='机械修改';
 const saved=h.workspaces.saveAuthor({...h.access(workspace.id),requestId:'semantic-edit',expectedRevision:1,expectedEpoch:1,document:changed});
 assert.equal(saved.hasPendingChanges,true);
});

test('unpublished author document cannot bootstrap forged measured evidence into workspace history or export', t => {
  const h=setup(t), value=document(); value.units[0].timingEvidence.push(evidence());
  assert.throws(() => h.create({document:value}), /实测|测量|TIMING/);
  assert.equal(h.workspaces.list('review-author').length, 0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_commands').get() as any).n, 0);
});

test('unchanged author timing remains current through workspace create, save, adoption, export and reopen',t=>{
  const h=setup(t),value=document(),unit=value.units[0];unit.scenes[0].blocks[0].text='MECHANICAL_TIMED_BODY';
  const originalHash=unitContentHash(value,unit);
  unit.timeline=[{id:'mechanical_plan',track:'V1',modality:'video',kind:'content',startMs:0,endMs:60000,included:true,label:'机械正文计划',contentHash:originalHash}];
  unit.timingEvidence=[{id:'mechanical_estimate',kind:'estimate',source:'assumption',durationMs:60000,contentHash:originalHash,assumptions:'仅机械测试假设'}];
  const author=h.scripts.saveProject(value,0),workspace=h.create({projectId:author.id,revision:author.revision});
  const current=workspace.document.units[0];assert.equal(unitContentHash(workspace.document,current),originalHash);
  h.db.prepare('UPDATE script_workspace_commands SET response_json=? WHERE owner_id=? AND request_id=?')
    .run(stableJson(workspace),'review-author','create');
  const replay=h.create({projectId:author.id,revision:author.revision});
  assert.equal(unitContentHash(replay.document,replay.document.units[0]),originalHash,'旧格式命令回执仍须从固定版本恢复原证据顺序');
  assert.equal(analyseTimeline(current.timeline,current.targetDurationMs,unitContentHash(workspace.document,current)).coverageMs,60000);
  const edited=structuredClone(workspace.document);edited.title='只改作品标题';
  const saved=h.workspaces.saveAuthor({...h.access(workspace.id),requestId:'timing-save',expectedRevision:1,expectedEpoch:1,document:edited});
  assert.equal(unitContentHash(saved.document,saved.document.units[0]),originalHash);
  const saveReplay=h.workspaces.saveAuthor({...h.access(workspace.id),requestId:'timing-save',expectedRevision:1,expectedEpoch:1,document:edited});
  assert.equal(unitContentHash(saveReplay.document,saveReplay.document.units[0]),originalHash);
  const exported=h.workspaces.exportVersion({...h.access(workspace.id),revision:2,unitIds:[current.id],format:'json'});
  assert.equal(JSON.parse(exported.text).units[0].timingEvidence[0].contentHash,originalHash);
  const proposal=h.workspaces.prepareAdoption({...h.access(workspace.id),workspaceRevision:2,expectedAuthorRevision:1});
  h.workspaces.adopt({...h.access(workspace.id),requestId:'timing-adopt',proposalId:proposal.id,digest:proposal.digest});
  const adopted=h.scripts.getProject(value.id)!;assert.equal(unitContentHash(adopted,adopted.units[0]),originalHash);
  const reopened=h.workspaces.read(workspace.id,'review-author');assert.equal(unitContentHash(reopened.document,reopened.document.units[0]),originalHash);
  const changed=structuredClone(reopened.document);changed.units[0].scenes[0].blocks[0].text='CHANGED_MECHANICAL_BODY';
  const revised=h.workspaces.saveAuthor({...h.access(workspace.id),requestId:'timing-body-change',expectedRevision:reopened.revision,expectedEpoch:reopened.writerEpoch,document:changed});
  assert.notEqual(unitContentHash(revised.document,revised.document.units[0]),originalHash);
  assert.equal(analyseTimeline(revised.document.units[0].timeline,revised.document.units[0].targetDurationMs,unitContentHash(revised.document,revised.document.units[0])).staleCount,1);
});

test('adoption synchronization preserves new trusted author measurement without allowing client injection', t => {
  const h=setup(t), original=h.scripts.saveProject(document(),0);
  const w=h.create({projectId:original.id,revision:1});
  // Mechanical database fixture models an already accepted trusted media result.
  // It does not assert that this test performed a real ffprobe measurement.
  const measured=structuredClone(original); measured.revision=2; measured.units[0].timingEvidence.push(evidence());
  h.db.prepare('UPDATE script_projects SET revision=2,data=? WHERE id=?').run(JSON.stringify(measured),measured.id);
  const changed=structuredClone(w.document); changed.units[0].scenes[0].title='机械标题修改';
  const next=h.workspaces.saveAuthor({...h.access(w.id),requestId:'edit',expectedRevision:1,expectedEpoch:1,document:changed});
  const proposal=h.workspaces.prepareAdoption({...h.access(w.id),workspaceRevision:next.revision,expectedAuthorRevision:2});
  const adopted=h.workspaces.adopt({...h.access(w.id),requestId:'adopt',proposalId:proposal.id,digest:proposal.digest});
  assert.equal(adopted.projectRevision,3);
  assert.deepEqual(h.scripts.getProject(measured.id)!.units[0].timingEvidence,[evidence()]);
  assert.deepEqual(h.workspaces.read(w.id,'review-author').document.units[0].timingEvidence,[evidence()]);
});

test('trusted measurement stays in frozen AI input without an author restore operation', t => {
  const h=setup(t), value=document(); value.revision=1; value.units[0].timingEvidence.push(evidence());
  // Seed trusted media evidence only in this isolated current manuscript.
  h.db.prepare('INSERT INTO script_projects VALUES(?,?,?)').run(value.id,1,JSON.stringify(value));
  const w=h.create({projectId:value.id,revision:1}),without=structuredClone(w.document);
  without.units[0].timingEvidence=[];
  h.workspaces.saveAuthor({...h.access(w.id),requestId:'omit-measurement',expectedRevision:1,expectedEpoch:1,document:without});
  assert.equal('restore' in h.workspaces,false);
  assert.deepEqual(h.workspaces.version(w.id,'review-author',1).units[0].timingEvidence,[evidence()]);
  assert.deepEqual(h.workspaces.read(w.id,'review-author').document.units[0].timingEvidence,[]);
  assert.deepEqual(h.workspaces.authorBaseline(w.id,'review-author')!.units[0].timingEvidence,[evidence()]);
  assert.deepEqual(h.workspaces.version(w.id,'review-author',2).units[0].timingEvidence,[]);
});

test('two successive adoptions of the same field advance paired baselines rather than creating a false conflict', t => {
  const h=setup(t), w=h.create();
  for (const [index, title] of ['机械第一次改动','机械第二次改动'].entries()) {
    const current=h.workspaces.read(w.id,'review-author'), next=structuredClone(current.document); next.title=title;
    const edited=h.workspaces.saveAuthor({...h.access(w.id),requestId:`save-${index}`,expectedRevision:current.revision,expectedEpoch:current.writerEpoch,document:next});
    const proposal=h.workspaces.prepareAdoption({...h.access(w.id),workspaceRevision:edited.revision,expectedAuthorRevision:index});
    h.workspaces.adopt({...h.access(w.id),requestId:`adopt-${index}`,proposalId:proposal.id,digest:proposal.digest});
    assert.equal(h.scripts.getProject(w.documentId)!.title,title);
    assert.equal(h.workspaces.read(w.id,'review-author').baseProjectRevision,index+1);
  }
});

test('failure after author version write rolls back project, synchronized workspace, paired baseline and command receipt', t => {
  const h=setup(t),w=h.create(),proposal=h.workspaces.prepareAdoption({...h.access(w.id),workspaceRevision:1,expectedAuthorRevision:0});
  h.db.exec("CREATE TRIGGER review_fail_sync BEFORE INSERT ON script_workspace_revisions WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'mechanical synchronization fault'); END");
  const command={...h.access(w.id),requestId:'atomic-adoption',proposalId:proposal.id,digest:proposal.digest};
  assert.throws(()=>h.workspaces.adopt(command),/mechanical synchronization fault/);
  assert.equal(h.scripts.getProject(w.documentId),null);
  assert.equal(h.db.prepare("SELECT 1 FROM sqlite_master WHERE name='script_revisions'").get(),undefined);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_author_inputs').get() as any).n,0);
  assert.equal(h.workspaces.read(w.id,'review-author').revision,1);
  assert.equal(h.workspaces.read(w.id,'review-author').baseProjectRevision,null);
  assert.equal(h.db.prepare('SELECT 1 FROM script_workspace_commands WHERE request_id=?').get(command.requestId),undefined);
  h.db.exec('DROP TRIGGER review_fail_sync');
  const receipt=h.workspaces.adopt(command); assert.equal(receipt.projectRevision,1);
  assert.deepEqual(h.workspaces.adopt(command),receipt);
});

test('deleting a unit cannot discard concurrent author work inside its scene', () => {
  const base=document(); base.units.push(newUnit('机械第二单元',1000,base.id));
  const draft=structuredClone(base); draft.units.pop();
  const author=structuredClone(base); author.units[1].scenes[0].blocks[0].text='机械作者未保存到草稿的改动';
  const snapshot=structuredClone(author);
  assert.throws(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)),/分别改动/);
  assert.deepEqual(author,snapshot);
});

test('two threads cannot claim one workspace and a wrong-epoch takeover cannot pause its real writer', t => {
  const h=setup(t),w=h.create(),other=h.conversations.open('review-author','script:home','other');
  const first=h.store.accept({ownerId:'review-author',threadId:h.thread.id,scopeId:'script:home',requestId:'run-one',kind:'GOAL',input:{},policyRevision:'1',maxInvocations:2});
  const second=h.store.accept({ownerId:'review-author',threadId:other.id,scopeId:'script:home',requestId:'run-two',kind:'GOAL',input:{},policyRevision:'1',maxInvocations:2});
  h.workspaces.bindWriter({...h.access(w.id),runId:first.runId,expectedEpoch:1});
  assert.throws(()=>h.workspaces.bindWriter({...h.access(w.id),runId:second.runId,expectedEpoch:1}),/另一个/);
  const claim=h.store.claim('mechanical-worker',30000,first.runId)!;
  assert.throws(()=>h.workspaces.saveAuthor({...h.access(w.id),requestId:'stale-takeover',expectedRevision:1,expectedEpoch:2,document:w.document,takeover:{runId:first.runId,expectedVersion:claim.run.version}}),/写入权/);
  h.store.assertExecution(claim.token); assert.equal(h.workspaces.read(w.id,'review-author').writerRunId,first.runId);
});

test('withdrawn ancestor protects reads, history, export, adoption and saved author-command replay', t => {
  const h=setup(t);let withdrawn=false,withdrawnId='';
  const protectedStore=new ScriptWorkspaceStore(h.store,h.scripts,{assertVersion:(id,revision)=>{if(withdrawn&&id===withdrawnId&&revision===1)throw new AgentError('REVIEW_SOURCE_REVOKED','机械来源已撤回');}});
  protectedStore.ensureSchema();
  const input={ownerId:'review-author',threadId:h.thread.id,requestId:'protected-create',source:{document:document()}},w=protectedStore.create(input);
  withdrawnId=w.id;
  const other=protectedStore.create({...input,requestId:'unrelated-visible-create'});
  const changed=structuredClone(w.document);changed.title='机械作者后续编辑';
  const save={...h.access(w.id),requestId:'protected-save',expectedRevision:1,expectedEpoch:1,document:changed};
  const saved=protectedStore.saveAuthor(save);
  const proposal=protectedStore.prepareAdoption({...h.access(w.id),workspaceRevision:saved.revision,expectedAuthorRevision:0});
  withdrawn=true;
  assert.deepEqual(protectedStore.list('review-author').map(item=>item.id),[other.id],
    '撤回一个工作稿的祖先不得使其他独立工作稿无法选择');
  for(const access of [
    ()=>protectedStore.read(w.id,'review-author'),
    ()=>protectedStore.version(w.id,'review-author',2),()=>protectedStore.create(input),()=>protectedStore.saveAuthor(save),
    ()=>protectedStore.exportVersion({...h.access(w.id),revision:2,unitIds:[w.document.units[0].id],format:'json'}),
    ()=>protectedStore.prepareAdoption({...h.access(w.id),workspaceRevision:2,expectedAuthorRevision:0}),
    ()=>protectedStore.adopt({...h.access(w.id),requestId:'after-revoke',proposalId:proposal.id,digest:proposal.digest}),
  ]) assert.throws(access,/机械来源已撤回/);
  assert.equal(h.scripts.getProject(w.documentId),null);
  // A separately constructed legacy repository must not bypass a bound ancestor.
  h.db.exec('CREATE TABLE agent_context_artifacts(domain TEXT,artifact_id TEXT)');
  h.db.prepare('INSERT INTO agent_context_artifacts VALUES(?,?)').run('script-workspace-version',`${w.id}:1`);
  assert.throws(()=>h.workspaces.read(w.id,'review-author'),/受保护/);
  assert.throws(()=>h.workspaces.version(w.id,'review-author',2),/受保护/);
});

test('model-version binding failure rolls back workspace revision and Step receipt together', async t => {
  const h=setup(t),w=h.create(),run=h.store.accept({ownerId:'review-author',threadId:h.thread.id,scopeId:'script:home',requestId:'model-write',kind:'GOAL',input:{},policyRevision:'1',maxInvocations:2});
  h.workspaces.bindWriter({...h.access(w.id),runId:run.runId,expectedEpoch:1});
  const claim=h.store.claim('mechanical-worker',30000,run.runId)!;
  const registry=new CapabilityRegistry({assertExecution:async()=>{h.store.assertExecution(claim.token);},authorize:async()=>{}});
  registry.register({spec:{id:'review.write',version:'1',description:'机械写入事务检查',implementationDigest:hashValue('mechanical-implementation'),effect:'WRITE',cost:'NONE',dispatch:'INLINE',replay:'TRANSACTIONAL',input:{jsonSchema:{},parse:v=>v},output:{jsonSchema:{},parse:v=>v}},execute:async()=>{throw new Error('not used');}});
  const request={capabilityId:'review.write',capabilityVersion:'1',callId:'same-step',input:{}};
  const prepared=await registry.prepare(request,{ownerId:'review-author',scopeId:'script:home',commandRevision:'1',policyRevision:'1',execution:claim.token,signal:new AbortController().signal});
  h.store.savePrepared(claim.token,prepared,hashValue(request));
  const guarded=new ScriptWorkspaceStore(h.store,h.scripts,{assertModelWrite:()=>{},bindModelVersion:()=>{throw new Error('mechanical source-binding failure');}});
  const next=structuredClone(w.document);next.title='机械模型局部标题';
  assert.throws(()=>guarded.applyFromRun({...h.access(w.id),token:claim.token,callId:request.callId,expectedRevision:1,writerEpoch:1,patch:createWorkspacePatch(w.document,next),contextRef:{id:'mechanical-context',digest:hashValue('context')}}),/mechanical source-binding failure/);
  assert.equal(h.workspaces.read(w.id,'review-author').revision,1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_revisions').get() as any).n,1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_parents').get() as any).n,0);
  assert.equal(h.store.getStep(run.runId,claim.token.inputRevision,request.callId)!.status,'PREPARED');
});
