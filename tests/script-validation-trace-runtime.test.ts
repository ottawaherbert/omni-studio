import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ModelRequest } from '../packages/agent-core/src';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { scriptImplementationManifest } from '../apps/api/src/agent/scriptCapabilities';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const call = (capabilityId: string, args: unknown) => ({ kind: 'CALL', capabilityId, capabilityVersion: '1', arguments: args,
  planUpdate: null, message: null, choices: null, artifactRefs: null, summary: null, reason: null, remainingWork: null });
const sections = (request: ModelRequest) => request.prompt.split('\n\n').flatMap(text => { try { return [JSON.parse(text)]; } catch { return []; } });

test('runtime trace toggling preserves the real manifest and resumes frozen controller, body and committed receipt on the same workspace', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  let sends = 0;
  const create = (enabled: boolean) => {
    const previous = process.env.SCRIPT_VALIDATION_TRACE;
    process.env.SCRIPT_VALIDATION_TRACE = enabled ? '1' : '0';
    try {
      return createScriptRuntime(db, { transport: { sendOnce: async () => { sends++; throw Error('NO_MODEL_OR_NETWORK'); } },
        owner: () => 'author', trustedLegacyProjectOwner: 'author', resolveMethods: async () => [],
        resolveExecution: () => ({ channel: 'external', routeRef: 'mechanical-external' }) });
    } finally {
      if (previous === undefined) delete process.env.SCRIPT_VALIDATION_TRACE; else process.env.SCRIPT_VALIDATION_TRACE = previous;
    }
  };
  const manifest = scriptImplementationManifest();
  assert.ok(!manifest.some(item => /scriptRuntime|scriptValidationTrace/.test(item.file)), 'observability does not edit the capability closure');
  let host = create(false);
  const descriptions = host.registry.describe(), manifestHash = hashValue(manifest);
  const thread = host.conversations.open('author', 'script:home', 'trace-runtime');
  const document = createScriptProject('MECHANICAL_TRACE', createScriptCreationProfile('short-film', 1, 3));
  document.units[0].scenes[0].blocks[0].text = 'MECHANICAL_ORIGINAL';
  const project = host.scripts.saveProject(document, 0), unit = project.units[0];
  const accepted = await host.commands.submit('author', { kind: 'GOAL_START', requestId: 'trace-start', threadId: thread.id,
    expectedConversationVersion: thread.version, source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
    objective: 'MECHANICAL_PROTOCOL', task: 'REVISE', target: { unitIds: [unit.id], wholeUnitIds: [unit.id] }, methodIds: [] },
    { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'mechanical-external' }) });
  const pending = () => {
    const request = host.journal.listExternal(accepted.runId, 'author').find(item => item.status === 'WAITING');
    assert.ok(request, JSON.stringify(host.store.readRun(accepted.runId))); return request;
  };
  const restart = (enabled: boolean) => {
    host = create(enabled);
    assert.deepEqual(host.registry.describe(), descriptions);
    assert.equal(hashValue(scriptImplementationManifest()), manifestHash);
  };
  await host.worker.runOnce(accepted.runId);
  const controller = pending(); assert.ok(controller.request.operationKey.startsWith('decision:'));
  restart(true);
  const goal = sections(controller.request).find(item => item.authorizationRef && item.contract);
  host.journal.submitExternal(controller.id, 'author', controller.inputHash, JSON.stringify(call('script.propose', {
    authorizationRef: goal.authorizationRef, operation: 'scene_body', instruction: 'MECHANICAL_BODY', unitId: unit.id,
    sceneId: unit.scenes[0].id, slotId: null, scopeId: null, entityId: null, blockIds: null, selection: null,
  })), { name: 'MECHANICAL_FIXTURE' });
  await host.worker.runOnce(accepted.runId);
  assert.equal(host.store.readRun(accepted.runId).status, 'WAITING_STEP');
  await host.childWorker.runOnce(accepted.runId);
  const body = pending(); assert.equal(body.request.operationKey, 'draft');
  restart(false);
  host.journal.submitExternal(body.id, 'author', body.inputHash, JSON.stringify({ summary: 'MECHANICAL', blocks: [{ localKey: 'mechanical', type: 'action', text: 'MECHANICAL_TRACE_BODY', speakerId: null, speakerName: null }] }), { name: 'MECHANICAL_FIXTURE' });
  await host.childWorker.runOnce(accepted.runId);
  assert.equal(host.store.readRun(accepted.runId).status, 'QUEUED');
  const candidateId = (db.prepare('SELECT id FROM script_draft_candidates').get() as any).id;
  assert.equal(host.drafts.readCandidateView('author', candidateId).status, 'VALID', host.drafts.readCandidate('author', candidateId).error ?? 'candidate must be valid');
  // Parent must reattest the already committed child under the new runtime.
  restart(true);
  await host.worker.runOnce(accepted.runId);
  const applyController = pending(), data = sections(applyController.request);
  const history = data.find(item => item.facts)?.facts;
  assert.ok(history.items.some((item: any) => item.capabilityId === 'script.propose'), 'old receipt VIEW remains visible in the new controller');
  const candidate = host.drafts.readCandidateView('author', candidateId);
  assert.equal(candidate.status, 'VALID');
  const workspace = host.workspaces.read(accepted.workspaceId!, 'author');
  host.journal.submitExternal(applyController.id, 'author', applyController.inputHash, JSON.stringify(call('script.apply_patch', {
    authorizationRef: data.find(item => item.authorizationRef && item.contract).authorizationRef,
    candidateId, expectedRevision: workspace.revision, writerEpoch: workspace.writerEpoch,
  })), { name: 'MECHANICAL_FIXTURE' });
  await host.worker.runOnce(accepted.runId);
  const after = host.workspaces.read(accepted.workspaceId!, 'author');
  assert.equal(after.id, workspace.id); assert.equal(after.revision, workspace.revision + 1);
  assert.match(JSON.stringify(after.document), /MECHANICAL_TRACE_BODY/);
  assert.equal(host.drafts.readCandidateView('author', candidateId).status, 'VALID', host.drafts.readCandidate('author', candidateId).error ?? 'candidate must be valid');
  assert.ok(pending().request.operationKey.startsWith('decision:'));
  assert.equal(host.goals.read(accepted.goalId!, 'author').activeRevision, 1, 'no pause, reauthorization or goal revision was needed');
  assert.equal(sends, 0);
});
