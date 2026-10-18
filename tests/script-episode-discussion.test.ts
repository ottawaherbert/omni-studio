import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {hashValue} from '../packages/agent-core/src';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {previewNextEpisode, type EpisodePreview} from '../packages/script/src/episodeDevelopment';
import {createScriptProject, newUnit} from '../packages/script/src/project';

function fixture(t: TestContext) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const host = createScriptAgentHost(db, {
    sendOnce: async () => { throw new Error('NO_EXTERNAL_MODEL'); },
  }, 'episode-discussion-test', {trustedLegacyProjectOwner: 'author'});
  const thread = host.conversations.open('author', 'script:home', 'episode-discussion-test');
  const document = createScriptProject('独立故事合集', createScriptCreationProfile('anthology', 3, 2));
  document.brief.concept = 'SHARED_CONCEPT';
  document.brief.constraints = 'SHARED_AUTHOR_REQUIREMENT';
  document.brief.outline = 'MIXED_DIRECTORY_NOT_STORY_CONTEXT';
  const a = document.units[0];
  a.title = '故事甲';
  a.summary = 'A_STALE_UNIT_SUMMARY';
  a.endingHook = 'A_PLANNED_ENDING';
  a.scenes[0].blocks[0].text = 'A_ACTUAL_MANUSCRIPT_END';
  const b = newUnit('故事乙', 120000);
  b.summary = 'B_PRIVATE_SUMMARY';
  b.endingHook = 'B_PRIVATE_ENDING';
  b.scenes[0].blocks[0].text = 'B_PRIVATE_MANUSCRIPT';
  document.units.push(b);
  document.storyOutlines = [
    {scopeId: a.scopeId, outline: 'A_FULL_LEGACY_ORIGINAL'},
    {scopeId: b.scopeId, outline: 'B_PRIVATE_STORY_OUTLINE'},
  ];
  for (const [id, scopeId, marker] of [
    ['shared', document.id, 'SHARED'], ['a', a.scopeId, 'A_PRIVATE'], ['b', b.scopeId, 'B_PRIVATE'],
  ]) {
    document.characters.push({
      id: `character_${id}`, scopeId, name: `${marker}_CHARACTER`, bio: `${marker}_BIO`,
      desire: '', need: '', contradiction: '', arc: '', voice: '',
    });
    document.facts.push({id: `fact_${id}`, scopeId, text: `${marker}_FACT`, status: 'approved'});
  }
  const author = host.scripts.saveProject(document, 0);
  const workspace = host.workspaces.create({
    ownerId: 'author', threadId: thread.id, requestId: 'create-workspace',
    source: {projectId: author.id, revision: author.revision},
  });
  return {db, host, thread, author, workspace, a, b};
}

function acceptDiscussion(h: ReturnType<typeof fixture>, preview: EpisodePreview) {
  const selection = {
    workspaceId: h.workspace.id, expectedRevision: h.workspace.revision,
    unitId: preview.unitId, localDraft: preview.project,
  };
  const text = '讨论拟新增集的大纲安排和关系建议；当前只是预览，不创建或修改分集。';
  const input = {
    ownerId: 'author', threadId: h.thread.id, requestId: 'episode-preview-discussion', expectedVersion: 1,
    requestEnvelope: {text, selection},
    payload: {
      text, methods: [], template: '{{taskContract}}\n{{conversation}}\n{{methodInstructions}}',
      channel: 'external', routeRef: 'MECHANICAL_PROTOCOL_ONLY', selection,
    },
    text, methods: [], route: {channel: 'external' as const, routeRef: 'MECHANICAL_PROTOCOL_ONLY'}, selection,
  };
  const accepted = h.host.commands.acceptChatTurn(input);
  assert.deepEqual(h.host.commands.acceptChatTurn(input), accepted, 'a retry must replay the same accepted discussion');
  const runId = accepted.conversation.turns.find(turn => turn.id === accepted.turnId)!.runId;
  const runInput = h.host.store.readRun(runId).input as any;
  assert.equal(runInput.authorizationRef, undefined);
  assert.deepEqual(runInput.dispatchOptions, []);
  assert.deepEqual(runInput.dispatchGoals, []);
  assert.equal(runInput.dispatchSelection.unitId, preview.unitId);
  assert.deepEqual(runInput.dispatchDiscussionDraft, preview.project);
  return {accepted, runId};
}

function assertNoAuthorChanges(h: ReturnType<typeof fixture>, preview: EpisodePreview) {
  const author = h.host.scripts.getProject(h.author.id)!;
  const workspace = h.host.workspaces.read(h.workspace.id, 'author');
  assert.deepEqual(author, h.author, 'discussion cannot persist the preview or its legacy-outline conversion');
  assert.deepEqual(workspace.document, h.workspace.document);
  assert.equal(workspace.revision, h.workspace.revision);
  assert.equal(workspace.writerEpoch, h.workspace.writerEpoch);
  assert.ok(!author.units.some(unit => unit.id === preview.unitId));
  assert.ok(!workspace.document.units.some(unit => unit.id === preview.unitId));
  for (const table of ['script_authorizations', 'script_draft_candidates', 'script_jobs']) {
    assert.equal((h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n: number}).n, 0, table);
  }
  assert.equal(h.db.prepare("SELECT 1 FROM sqlite_master WHERE name='script_revisions'").get(), undefined);
}

for (const kind of ['independent', 'continue'] as const) {
  test(`from current B, ${kind === 'independent' ? 'a new independent story' : 'a continuation of A'} freezes the correct read-only context`, async t => {
    const h = fixture(t);
    // The UI is on B, but its dialog may explicitly select A as the continuation source.
    const preview = previewNextEpisode(h.author, {
      kind, sourceUnitId: kind === 'continue' ? h.a.id : h.b.id,
      title: '拟新增单集', targetDurationMs: 180000,
    });
    const previewUnit = preview.project.units.find(unit => unit.id === preview.unitId)!;
    assert.equal(previewUnit.scopeId, kind === 'continue' ? h.a.scopeId : previewUnit.id);
    if (kind === 'continue') {
      assert.equal(preview.conversion?.original, 'A_FULL_LEGACY_ORIGINAL');
      assert.equal(preview.project.units[0].summary, 'A_FULL_LEGACY_ORIGINAL');
    } else assert.equal(preview.conversion, null);

    const {accepted, runId} = acceptDiscussion(h, preview);
    assertNoAuthorChanges(h, preview);
    await h.host.worker.runOnce(runId);
    const frozen = h.host.journal.listExternal(runId, 'author')[0];
    assert.ok(frozen, JSON.stringify(h.host.store.readRun(runId)));
    const prompt = frozen.request.prompt;
    assert.match(prompt, /拟新增单集/);
    assert.ok(prompt.includes(preview.unitId));
    assert.match(prompt, /"targetDurationMs":180000/);
    for (const marker of ['SHARED_CONCEPT', 'SHARED_AUTHOR_REQUIREMENT', 'SHARED_CHARACTER', 'SHARED_FACT']) {
      assert.ok(prompt.includes(marker), `missing common material: ${marker}`);
    }
    assert.doesNotMatch(prompt, /B_PRIVATE_|MIXED_DIRECTORY_NOT_STORY_CONTEXT/);
    if (kind === 'continue') {
      for (const marker of ['A_PRIVATE_CHARACTER', 'A_PRIVATE_FACT', 'A_FULL_LEGACY_ORIGINAL', 'A_ACTUAL_MANUSCRIPT_END', 'A_PLANNED_ENDING']) {
        assert.ok(prompt.includes(marker), `missing continuation evidence: ${marker}`);
      }
      assert.doesNotMatch(prompt, /A_STALE_UNIT_SUMMARY/);
    } else assert.doesNotMatch(prompt, /A_PRIVATE_|A_FULL_LEGACY_ORIGINAL|A_ACTUAL_MANUSCRIPT_END|A_PLANNED_ENDING|A_STALE_UNIT_SUMMARY/);
    assert.match(prompt, /"allowedOperations":\[\],"allowedGoals":\[\]/);
    assert.match(prompt, /未保存草稿，仅可讨论/);
    const manifest = frozen.request.inputManifest as any;
    assert.equal(manifest.discussionDraftHash, hashValue(preview.project));
    assert.equal(manifest.workspaceRef, null);
    assert.equal(manifest.dispatchOptionsHash, null);

    // Even an erroneous model decision cannot turn this preview into a creation or Agent grant.
    h.host.journal.submitExternal(frozen.id, 'author', frozen.inputHash, JSON.stringify({
      kind: 'CALL', operation: kind === 'independent' ? 'add_unit' : 'outline_goal',
      entityId: null, analysis: null, question: '', options: [],
    }), {name: 'MECHANICAL_PROTOCOL_ONLY'});
    await h.host.worker.runOnce(runId);
    assert.equal(h.host.store.readRun(runId).status, 'SUCCEEDED');
    const response = h.host.conversations.turn(h.thread.id, accepted.turnId, 'author').turn.response;
    assert.equal(response.dispatch.kind, 'ASK');
    assert.equal(response.goal, undefined);
    assert.equal(response.dispatch.candidateId, undefined);
    assert.equal(h.host.journal.listExternal(runId, 'author').length, 1, 'no child model request may be created');
    assertNoAuthorChanges(h, preview);
  });
}

test('an accepted episode preview remains frozen when the caller later edits its local preview', async t => {
  const h = fixture(t);
  const preview = previewNextEpisode(h.author, {kind: 'continue', sourceUnitId: h.a.id, title: 'ACCEPTED_PREVIEW_TITLE'});
  const acceptedHash = hashValue(preview.project);
  const {accepted, runId} = acceptDiscussion(h, preview);
  preview.project.units.find(unit => unit.id === preview.unitId)!.title = 'LATER_LOCAL_TITLE';
  preview.project.units[0].scenes[0].blocks[0].text = 'LATER_LOCAL_BODY';
  await h.host.worker.runOnce(runId);
  const frozen = h.host.journal.listExternal(runId, 'author')[0];
  assert.ok(frozen);
  assert.equal((frozen.request.inputManifest as any).discussionDraftHash, acceptedHash);
  assert.match(frozen.request.prompt, /ACCEPTED_PREVIEW_TITLE/);
  assert.match(frozen.request.prompt, /A_ACTUAL_MANUSCRIPT_END/);
  assert.doesNotMatch(frozen.request.prompt, /LATER_LOCAL_TITLE|LATER_LOCAL_BODY/);
  h.host.journal.submitExternal(frozen.id, 'author', frozen.inputHash, JSON.stringify({
    kind: 'REPLY', operation: null, entityId: null, analysis: null,
    question: '机械协议测试：只讨论当前预览，等待作者决定是否创建。', options: [],
  }), {name: 'MECHANICAL_PROTOCOL_ONLY'});
  await h.host.worker.runOnce(runId);
  assert.equal(h.host.store.readRun(runId).status, 'SUCCEEDED');
  assert.equal(h.host.conversations.turn(h.thread.id, accepted.turnId, 'author').turn.response.dispatch.kind, 'REPLY');
  assertNoAuthorChanges(h, preview);
});
