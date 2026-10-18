import test from 'node:test';
import { authorizeMemoryApi } from './script-memory-fixtures';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { AgentError } from '../packages/agent-core/src';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';

test('an in-flight memory request becomes UNKNOWN once its recovery timeout expires after a quick restart', async t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const transport = { sendOnce: async () => { throw new Error('the in-flight request must never be resent'); } };
  const host = createScriptAgentHost(db, transport, 'memory-recovery-first', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'memory-recovery');
  const document = createScriptProject('机械恢复', createScriptCreationProfile('short-film', 1, 5));
  document.units[0].scenes[0].blocks[0].text = '已提交的机械正文';
  const workspace = host.workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'workspace', source: { document } });
  const access = { ownerId: 'author', scopeId: workspace.id, branch: `workspace:${workspace.id}` };
  await authorizeMemoryApi(host, workspace);
  assert.equal(host.memory.discover(), 1);
  const frozen = host.memory.work.freezeNext()!;
  assert.equal(frozen.status, 'FROZEN');
  db.prepare("UPDATE agent_memory_work SET status='SENT',attempt_id=?,updated_at=? WHERE id=?")
    .run('memory_attempt_crashed', Date.now(), frozen.id);

  // Restart while the request is younger than the ten-minute reconciliation window.
  const restarted = createScriptAgentHost(db, transport, 'memory-recovery-restarted', {trustedLegacyProjectOwner:'author'});
  assert.equal(restarted.memory.work.read(frozen.id, access).status, 'SENT');

  // Advance only the durable timestamp. No wall-clock sleep or model call is needed.
  db.prepare('UPDATE agent_memory_work SET updated_at=? WHERE id=?').run(Date.now() - 600_001, frozen.id);
  await restarted.memory.runOnce(new AbortController().signal);
  assert.equal(restarted.memory.work.read(frozen.id, access).status, 'UNKNOWN');
});

test('a synced author project edit counts as author progress in a selected Goal unit', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('no model call'); } }, 'author-progress-review', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'author-progress');
  const original = createScriptProject('机械同步', createScriptCreationProfile('short-film', 1, 5));
  const project = host.scripts.saveProject(original, 0);
  const workspace = host.workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'workspace', source: { projectId: project.id, revision: 1 } });
  const changed = structuredClone(project);
  changed.units[0].scenes[0].blocks[0].text = '作者在正式稿中新增正文';
  host.scripts.saveProject(changed, 1);
  const sync = host.workspaces.syncAuthor({ workspaceId: workspace.id, ownerId: 'author', requestId: 'sync',
    expectedRevision: 1, expectedEpoch: 1, expectedAuthorRevision: 2 });
  assert.equal(sync.changed, true);
  assert.equal(sync.workspace.revision, 2);
  assert.equal(host.workspaces.authorChangedTargetSince(workspace.id, 'author', 1, [project.units[0].id]), true);
});

test('sync-author receipt replay does not reveal a workspace after its ancestor source is withdrawn', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('no model call'); } }, 'sync-revocation-review', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'sync-revocation');
  let withdrawn = false;
  const protectedStore = new ScriptWorkspaceStore(host.store, host.scripts, {
    trustedLegacyProjectOwner:'author',
    assertVersion: (_workspaceId, revision) => {
      if (withdrawn && revision === 1) throw new AgentError('SOURCE_REVOKED', 'mechanical ancestor withdrawn');
    },
  });
  protectedStore.ensureSchema();
  const project = host.scripts.saveProject(createScriptProject('机械撤销', createScriptCreationProfile('short-film', 1, 5)), 0);
  const workspace = protectedStore.create({ ownerId: 'author', threadId: thread.id, requestId: 'workspace', source: { projectId: project.id, revision: 1 } });
  const author = structuredClone(project);
  author.units[0].scenes[0].blocks[0].text = '正式作者稿增量';
  host.scripts.saveProject(author, 1);
  const command = { workspaceId: workspace.id, ownerId: 'author', requestId: 'sync', expectedRevision: 1, expectedEpoch: 1, expectedAuthorRevision: 2 };
  const receipt = protectedStore.syncAuthor(command);
  assert.match(receipt.workspace.document.units[0].scenes[0].blocks[0].text, /正式作者稿增量/);
  withdrawn = true;
  assert.throws(() => protectedStore.read(workspace.id, 'author'), /mechanical ancestor withdrawn/);
  assert.throws(() => protectedStore.syncAuthor(command), /mechanical ancestor withdrawn/);
});
