import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteConversationStore } from '../packages/agent-sqlite/src';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { anchorFor, outlineGuideId } from '../packages/script/src/outlineGuides';
import { createWorkspacePatch } from '../packages/script/src/workspacePatch';

// Independent repository regressions: all manuscripts and failures are confined
// to an in-memory database. No provider, running app, or real work is involved.
function fixture(t: TestContext) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  const thread = conversations.open('outline-reviewer', 'script:home', 'outline-adoption');
  const scripts = createScriptRepository(db); scripts.ensureSchema();
  const workspaces = new ScriptWorkspaceStore(store, scripts, { trustedLegacyProjectOwner: 'outline-reviewer' });
  workspaces.ensureSchema();
  const original = createScriptProject('仅供部分采用回归', createScriptCreationProfile('short-film', 1, 5));
  original.brief.outline = '原故事走向。';
  original.units[0].scenes[0].blocks[0].text = '必须保留的既有正文。';
  const author = scripts.saveProject(original, 0);
  const initial = workspaces.create({ ownerId: 'outline-reviewer', threadId: thread.id, requestId: 'create',
    source: { projectId: author.id, revision: author.revision } });
  const access = { ownerId: 'outline-reviewer', workspaceId: initial.id };
  const draft = structuredClone(initial.document);
  draft.brief.outline = '新的故事走向。';
  draft.units[0].structureNodes = [{ id: 'outline_review_part', title: '作出选择' }];
  const owner = { kind: 'project' as const, id: author.id };
  const anchor = anchorFor(draft.brief.outline, 0, draft.brief.outline.length);
  draft.outlineGuides = [{ id: outlineGuideId(owner), owner,
    nodeLinks: [{ nodeId: 'outline_review_part', unitId: draft.units[0].id, anchor }],
    beats: [{ id: 'outline_review_beat', title: '留下', change: '决定留下', anchors: [anchor],
      unitIds: [draft.units[0].id], sceneRefs: [{ unitId: draft.units[0].id, sceneId: draft.units[0].scenes[0].id }] }] }];
  const changed = workspaces.saveAuthor({ ...access, requestId: 'save-candidate', expectedRevision: initial.revision,
    expectedEpoch: initial.writerEpoch, document: draft });
  const readAuthor = () => scripts.getProject(author.id)!;
  const readWorkspace = () => workspaces.read(initial.id, access.ownerId);
  const prepare = (outlineOnly = false) => workspaces.prepareAdoption({ ...access,
    workspaceRevision: readWorkspace().revision, expectedAuthorRevision: readAuthor().revision, outlineOnly });
  const adopt = (proposal: ReturnType<typeof prepare>, requestId: string) => workspaces.adopt({ ...access,
    requestId, proposalId: proposal.id, digest: proposal.digest });
  return { db, scripts, workspaces, author, initial, changed, access, readAuthor, readWorkspace, prepare, adopt };
}

test('outline-only adoption retains dependent changes in a new workspace version for later adoption', t => {
  const h = fixture(t), proposal = h.prepare(true), receipt = h.adopt(proposal, 'adopt-outline');
  const author = h.readAuthor(), remaining = h.readWorkspace();
  assert.equal(receipt.partial, true);
  assert.equal(author.brief.outline, h.changed.document.brief.outline);
  assert.deepEqual(author.units, h.author.units, '仅采用大纲不能提前写入结构或正文');
  assert.equal(author.outlineGuides, undefined);
  assert.equal(remaining.hasPendingChanges, true);
  assert.ok(remaining.baseWorkspaceRevision > h.changed.revision);
  assert.ok(remaining.revision > remaining.baseWorkspaceRevision);
  assert.equal(receipt.synchronizedWorkspaceRevision, remaining.revision);
  assert.deepEqual(remaining.document.outlineGuides, h.changed.document.outlineGuides);
  assert.deepEqual(h.workspaces.version(h.initial.id, h.access.ownerId, h.changed.revision), h.changed.document,
    '原候选版本保持不可变');
  const base = h.workspaces.version(h.initial.id, h.access.ownerId, remaining.baseWorkspaceRevision);
  const patch = createWorkspacePatch(base, remaining.document);
  assert.ok(patch.operations.length);
  assert.equal(patch.operations.some(item => item.key === 'project/brief' && item.field === 'outline'), false,
    '后续采用不应重新提交已采用的大纲');

  const rest = h.prepare(), completed = h.adopt(rest, 'adopt-relations');
  assert.notEqual(rest.id, proposal.id);
  assert.equal(completed.partial, false);
  assert.deepEqual(h.readAuthor().outlineGuides, h.changed.document.outlineGuides);
  assert.deepEqual(h.readAuthor().units[0].structureNodes, h.changed.document.units[0].structureNodes);
  assert.deepEqual(h.readAuthor().units[0].scenes, h.author.units[0].scenes);
  assert.equal(h.readWorkspace().hasPendingChanges, false);
});

test('outline and remaining adoption replay their receipts without duplicate versions or objects', t => {
  const h = fixture(t), proposal = h.prepare(true), partial = h.adopt(proposal, 'partial-replay');
  const partialAuthor = h.readAuthor(), partialWorkspace = h.readWorkspace();
  assert.deepEqual(h.adopt(proposal, 'partial-replay'), partial);
  assert.deepEqual(h.readAuthor(), partialAuthor);
  assert.deepEqual(h.readWorkspace(), partialWorkspace);
  const rest = h.prepare(), complete = h.adopt(rest, 'complete-replay');
  const completedAuthor = h.readAuthor(), completedWorkspace = h.readWorkspace();
  assert.deepEqual(h.adopt(rest, 'complete-replay'), complete);
  assert.deepEqual(h.adopt(proposal, 'partial-replay'), partial, '之后重放旧采用仍返回原回执');
  assert.deepEqual(h.readAuthor(), completedAuthor);
  assert.deepEqual(h.readWorkspace(), completedWorkspace);
  assert.equal(completedAuthor.units[0].structureNodes?.length, 1);
  assert.equal(completedAuthor.outlineGuides?.[0].beats.length, 1);
});

test('failure while preserving remaining relations rolls back the author, both workspace saves, and receipt', t => {
  const h = fixture(t), proposal = h.prepare(true), author = h.readAuthor(), workspace = h.readWorkspace();
  const beforeVersions = h.db.prepare('SELECT count(*) AS n FROM script_workspace_revisions').get();
  h.db.exec(`CREATE TRIGGER outline_review_fail_remaining BEFORE INSERT ON script_workspace_revisions
    WHEN NEW.revision=${workspace.revision + 2}
    BEGIN SELECT RAISE(ABORT,'isolated remaining-save failure'); END`);
  assert.throws(() => h.adopt(proposal, 'rollback-partial'), /isolated remaining-save failure/);
  assert.deepEqual(h.readAuthor(), author);
  assert.deepEqual(h.readWorkspace(), workspace);
  assert.deepEqual(h.db.prepare('SELECT count(*) AS n FROM script_workspace_revisions').get(), beforeVersions);
  assert.equal(h.db.prepare('SELECT 1 FROM script_workspace_commands WHERE request_id=?').get('rollback-partial'), undefined);
  h.db.exec('DROP TRIGGER outline_review_fail_remaining');
  assert.equal(h.adopt(proposal, 'rollback-partial').partial, true, '失败后可用原命令安全重试');
  assert.equal(h.readWorkspace().hasPendingChanges, true);
});

test('an independent author edit after full adoption does not resurrect pending candidate changes', t => {
  const h = fixture(t);
  h.adopt(h.prepare(true), 'outline-first');
  h.adopt(h.prepare(), 'relations-second');
  assert.equal(h.readWorkspace().hasPendingChanges, false);
  const author = h.readAuthor(), manual = structuredClone(author);
  manual.brief.theme = '采用完成后的独立作者修改';
  h.scripts.saveProject(manual, author.revision);
  const workspace = h.readWorkspace();
  assert.ok(createWorkspacePatch(h.readAuthor(), workspace.document).operations.length,
    '作者稿与旧工作稿存在差异，不能用它判断候选是否尚未采用');
  assert.equal(workspace.hasPendingChanges, false);
  assert.equal(h.workspaces.list(h.access.ownerId).find(item => item.id === workspace.id)?.hasPendingChanges, false);
  const base = h.workspaces.version(workspace.id, h.access.ownerId, workspace.baseWorkspaceRevision);
  assert.equal(createWorkspacePatch(base, workspace.document).operations.length, 0);
});

for (const choice of ['AUTHOR', 'WORKSPACE'] as const) {
  test(`outline-only conflict resolution keeps its adoption boundary when choosing ${choice}`, t => {
    const h = fixture(t), manual = structuredClone(h.author);
    manual.brief.outline = '作者同时修改的大纲。';
    const author = h.scripts.saveProject(manual, h.author.revision);
    const input = { ...h.access, workspaceRevision: h.changed.revision, expectedAuthorRevision: author.revision };
    const conflicts = h.workspaces.inspectAdoption(input);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].key, 'project/brief');
    assert.equal(conflicts[0].field, 'outline');
    const proposal = h.workspaces.prepareAdoption({ ...input, outlineOnly: true,
      resolutions: conflicts.map(item => ({ id: item.id, choice })) });
    assert.equal(proposal.document.brief.outline, choice === 'AUTHOR' ? author.brief.outline : h.changed.document.brief.outline);
    assert.equal(proposal.document.outlineGuides, undefined);
    assert.deepEqual(proposal.document.units, author.units);
    assert.equal(h.adopt(proposal, `resolve-${choice}`).partial, true);
    assert.equal(h.readAuthor().outlineGuides, undefined);
    assert.deepEqual(h.readAuthor().units, author.units);
    assert.equal(h.readWorkspace().hasPendingChanges, true);
    assert.equal(h.readWorkspace().document.outlineGuides?.[0].beats[0].id, 'outline_review_beat');
  });
}

test('a partial-adoption preview cannot overwrite an author version saved after the preview', t => {
  const h = fixture(t), proposal = h.prepare(true), manual = structuredClone(h.author);
  manual.brief.theme = '预览之后保存的作者修改';
  const current = h.scripts.saveProject(manual, h.author.revision), beforeWorkspace = h.readWorkspace();
  assert.throws(() => h.adopt(proposal, 'stale-author-preview'));
  assert.deepEqual(h.readAuthor(), current);
  assert.deepEqual(h.readWorkspace(), beforeWorkspace);
  assert.equal(h.db.prepare('SELECT 1 FROM script_workspace_commands WHERE request_id=?').get('stale-author-preview'), undefined);
});
