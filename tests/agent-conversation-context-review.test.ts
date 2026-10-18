import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { AccessContext, ModelRequest } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_SCOPE, SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';
import { registerScriptConversationRoutes } from '../apps/api/src/routes/scriptConversationRoutes';
import type { MethodBinding } from '../packages/script/src/schema';

// Independent protocol/revocation review. Every model result is a replay of
// the supplied Sol fixture; these tests make no claim about writing quality.
const access = { ownerId: 'author', scopeId: SCRIPT_CHAT_SCOPE, branch: 'author' };
const fixtures = ['first', 'second'].map(name => readFileSync(new URL(`./fixtures/agent-sol-chat-${name}-result.json`, import.meta.url), 'utf8'));
const firstText = JSON.parse(fixtures[0]).question as string;
const secondText = JSON.parse(fixtures[1]).question as string;
const result = (index = 0) => ({ text: fixtures[index % fixtures.length], provenance: { channel: 'provider' as const, producer: 'GPT-6 Sol fixture replay (independent protocol review)', model: 'gpt-6-sol' } });
function setup(t: any, reply: (request: ModelRequest, index: number) => ReturnType<typeof result> = (_request, i) => result(i - 1)) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const sent: ModelRequest[] = [];
  const transport = { sendOnce: async (request: ModelRequest) => { sent.push(structuredClone(request)); return reply(request, sent.length); } };
  let host = createScriptAgentHost(db, transport, 'review-worker');
  const conversation = host.conversations.open(access.ownerId, access.scopeId, 'context-review');
  let next = 0;
  const accept = (text = `模拟作者消息${++next}`, options: { channel?: 'api' | 'external'; methods?: MethodBinding[] } = {}) => {
    const payload = { text, methods: options.methods || [], template: SCRIPT_CHAT_TEMPLATE, channel: options.channel || 'api', routeRef: 'review:local-simulation' };
    const accepted = host.conversations.accept({ threadId: conversation.id, ownerId: access.ownerId, requestId: `review-${++next}`, expectedVersion: host.conversations.read(conversation.id, access.ownerId).version, requestEnvelope: { text, methodIds: payload.methods.map(method => method.id), channel: payload.channel }, payload, capabilityId: 'script.converse', maxInvocations: 1 });
    return accepted.conversation.turns.find(turn => turn.id === accepted.turnId)!;
  };
  const execute = async (text?: string, options?: Parameters<typeof accept>[1]) => {
    const turn = accept(text, options); await host.worker.runOnce(turn.runId); return turn;
  };
  const memory = () => host.contexts.createMemory(access, 'author', 'remember-review', { key: 'review.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '模拟待撤回记忆', value: '模拟机密甲' }, dependencies: [] });
  return { db, sent, get host() { return host; }, conversation, accept, execute, memory, restart: () => { host = createScriptAgentHost(db, transport, 'review-restarted'); } };
}

test('withdrawn replies and their descendants cannot re-enter a new round through history', async t => {
  const h = setup(t);
  const memory = h.memory();
  const first = await h.execute(), second = await h.execute();
  assert.ok(h.sent[1].prompt.includes(firstText));
  h.host.contexts.updateMemory(access, 'forget-review', memory.id, memory.revision, 'DELETE');
  for (const turn of [first, second]) assert.throws(() => h.host.contexts.assertArtifact('conversation-turn', turn.id, 'VIEW'), (error: any) => error.code === 'CONTEXT_REVOKED');
  const third = await h.execute(), fourth = await h.execute();
  for (const turn of [third, fourth]) assert.equal(h.host.store.readRun(turn.runId).status, 'SUCCEEDED');
  assert.equal(h.sent[2].prompt.includes(firstText), false);
  assert.equal(h.sent[2].prompt.includes(secondText), false);
  for (const request of h.sent.slice(2)) {
    assert.equal(request.prompt.includes('模拟机密甲'), false);
    assert.ok(request.prompt.includes('历史回复已撤回'));
  }
  const fourthHistory = JSON.parse((h.db.prepare('SELECT data_json FROM agent_conversation_sources WHERE turn_id=?').get(fourth.id) as any).data_json);
  const thirdReply = h.host.conversations.turn(h.conversation.id, third.id, access.ownerId).turn.response;
  assert.deepEqual(fourthHistory.contextRefs, [thirdReply.contextRef]);
});

test('recursive history validation rejects an unavailable ancestor even without a scope-generation change', async t => {
  const h = setup(t);
  const first = await h.execute(), second = await h.execute();
  // Fault injection: the source disappears independently of scope policy and
  // memory generations. Its descendant must still fail recursive validation.
  h.db.prepare('DELETE FROM agent_conversation_sources WHERE turn_id=?').run(first.id);
  assert.throws(() => h.host.contexts.assertArtifact('conversation-turn', second.id, 'VIEW'), (error: any) => error.code === 'CONTEXT_SOURCE_INVALID');
  const third = await h.execute();
  assert.equal(h.host.store.readRun(third.runId).status, 'SUCCEEDED');
  assert.equal(h.sent[2].prompt.includes(firstText), false);
  assert.equal(h.sent[2].prompt.includes(secondText), false);
});

test('restart resumes the same frozen context and full Skill without a second physical send', async t => {
  const h = setup(t);
  const method: MethodBinding = { id: 'review-skill', title: '模拟完整方法', version: 'v1', content: '开头约束\n' + '完整中段规则。'.repeat(800) + '\n不可遗漏的末尾规则', usage: { operations: ['consult'], inputs: [], note: '只作讨论，不创建作品' } } as MethodBinding;
  const turn = await h.execute('根据完整方法讨论', { channel: 'external', methods: [method] });
  assert.equal(h.host.store.readRun(turn.runId).status, 'WAITING_EXTERNAL');
  const frozen = h.host.journal.listExternal(turn.runId, access.ownerId)[0];
  assert.ok(frozen.request.prompt.includes(method.content));
  assert.ok(frozen.request.prompt.includes(method.usage!.note));
  const digest = frozen.request.contextRef;
  method.version = 'v2'; method.content = '接收之后被更改的方法';
  h.restart();
  const reopened = h.host.journal.listExternal(turn.runId, access.ownerId)[0];
  assert.deepEqual(reopened, frozen);
  h.host.journal.submitExternal(reopened.id, access.ownerId, reopened.inputHash, result().text);
  await h.host.worker.runOnce(turn.runId);
  assert.equal(h.host.store.readRun(turn.runId).status, 'SUCCEEDED');
  const reply = h.host.conversations.turn(h.conversation.id, turn.id, access.ownerId).turn.response;
  assert.deepEqual(reply.contextRef, digest);
  assert.equal(reply.methods[0].version, 'v1');
  assert.ok(reply.methods[0].content.includes('不可遗漏的末尾规则'));
  assert.equal(h.sent.length, 0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_invocations').get() as any).n, 1);
});

test('forget during physical return keeps restricted evidence and commits no reply', async t => {
  let forget!: () => void;
  const h = setup(t, () => { forget(); return result(); });
  const memory = h.memory(); forget = () => { h.host.contexts.updateMemory(access, 'forget-inflight', memory.id, memory.revision, 'DELETE'); };
  const turn = await h.execute();
  assert.equal(h.host.store.readRun(turn.runId).status, 'NEEDS_REBASE');
  assert.equal(h.host.conversations.turn(h.conversation.id, turn.id, access.ownerId).turn.response, null);
  assert.equal(h.host.contexts.hasArtifact('conversation-turn', turn.id), false);
  assert.equal((h.db.prepare('SELECT status FROM agent_invocations').get() as any).status, 'RECEIVED');
  assert.equal(h.sent.length, 1);
});

test('a pending frozen round cannot consume a reply whose ancestor was revoked after restart', async t => {
  const h = setup(t);
  h.memory(); await h.execute();
  const pending = await h.execute('继续讨论', { channel: 'external' });
  const external = h.host.journal.listExternal(pending.runId, access.ownerId)[0];
  h.host.contexts.revokeScope(access); h.restart();
  assert.equal(h.host.journal.listExternal(pending.runId, access.ownerId)[0].redacted, true);
  h.host.journal.submitExternal(external.id, access.ownerId, external.inputHash, result().text);
  await h.host.worker.runOnce(pending.runId);
  assert.equal(h.host.store.readRun(pending.runId).status, 'NEEDS_REBASE');
  assert.equal(h.host.conversations.turn(h.conversation.id, pending.id, access.ownerId).turn.response, null);
});

test('fifty-two rounds share only a synchronous validation batch and redact on the next read', async t => {
  const h = setup(t);
  let checks = 0;
  const sourceAllowed = h.host.conversations.sourceAllowed.bind(h.host.conversations);
  h.host.conversations.sourceAllowed = (...args) => { checks++; return sourceAllowed(...args); };
  let lastChecks = 0;
  const start = performance.now();
  let finalTurnMs = 0;
  for (let index = 0; index < 52; index++) {
    checks = 0;
    const turnStart = performance.now();
    const turn = await h.execute(`长对话模拟问题${index}`);
    finalTurnMs = performance.now() - turnStart;
    assert.equal(h.host.store.readRun(turn.runId).status, 'SUCCEEDED');
    lastChecks = checks;
  }
  assert.ok(lastChecks < 52 * 12, `last round source checks: ${lastChecks}`);
  // Exercise the actual route projection without a listening socket. Other
  // tests cover HTTP; this review counts recursive source validations.
  const routes = new Map<string, (req: any, res: any) => unknown>();
  const app = { get: (path: string, handler: any) => routes.set(path, handler), post: () => {} };
  registerScriptConversationRoutes(app as any, { ...h.host, owner: () => access.ownerId, resolveMethods: async () => [], channel: 'api', routeRef: 'review:local-simulation' });
  const readRoute = () => {
    let value: any;
    routes.get('/api/script-assistant/conversations/:id')!({ params: { id: h.conversation.id } }, { json: (body: any) => { value = body; }, status: (code: number) => { throw new Error(`Unexpected response: ${code}`); } });
    return value.conversation;
  };
  checks = 0;
  const viewStart = performance.now();
  assert.equal(readRoute().turns.filter((turn: any) => !turn.response.redacted).length, 52);
  const viewMs = performance.now() - viewStart, viewChecks = checks;
  assert.ok(viewChecks < 52 * 5, `view source checks: ${viewChecks}`);
  t.diagnostic(`52 Sol fixture turns: ${Math.round(performance.now() - start)} ms; final turn ${Math.round(finalTurnMs)} ms / ${lastChecks} source checks; route view ${Math.round(viewMs)} ms / ${viewChecks} checks`);
  // A source-only withdrawal catches cache leakage that a scope-generation
  // check alone would mask: descendants retain their own valid snapshot rows.
  const first = h.host.conversations.read(h.conversation.id, access.ownerId).turns[0];
  h.db.prepare('DELETE FROM agent_conversation_sources WHERE turn_id=?').run(first.id);
  assert.ok(readRoute().turns.every((turn: any) => turn.response.redacted));
  h.host.contexts.revokeScope(access);
  const redacted = readRoute();
  assert.ok(redacted.turns.every((turn: any) => turn.response.redacted));
  assert.equal(JSON.stringify(redacted).includes(firstText), false);
  const next = await h.execute('撤回后重新开始');
  assert.equal(h.host.store.readRun(next.runId).status, 'SUCCEEDED');
  assert.equal(h.sent.at(-1)!.prompt.includes(firstText), false);
});

test('preparation recovery requests rebase after a withdrawal and preserves the frozen history', async t => {
  const h = setup(t); const memory = h.memory(); await h.execute();
  const turn = h.accept('等待准备的消息');
  const claim = h.host.store.claim('review-crash-before-step', 30000, turn.runId)!;
  const context: AccessContext = { ownerId: access.ownerId, scopeId: access.scopeId, commandRevision: String(claim.run.generation), policyRevision: claim.run.policyRevision, execution: claim.token, signal: new AbortController().signal };
  // Simulate a crash after prepare returns but before savePrepared. No model
  // invocation exists, so recovery should either reprepare or request rebase.
  await h.host.registry.prepare((claim.run.input as any).request, context);
  const frozenHistory = h.db.prepare('SELECT * FROM agent_conversation_sources WHERE turn_id=?').get(turn.id);
  h.host.contexts.updateMemory(access, 'forget-before-step', memory.id, memory.revision, 'DELETE');
  h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(turn.runId);
  h.restart(); await h.host.worker.runOnce(turn.runId);
  const recovered = h.host.store.readRun(turn.runId);
  assert.equal(recovered.status, 'NEEDS_REBASE');
  assert.equal(recovered.reason, 'CONVERSATION_HISTORY_CHANGED');
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.db.prepare('SELECT * FROM agent_conversation_sources WHERE turn_id=?').get(turn.id), frozenHistory);
  const next = await h.execute('基于现在可用的信息继续');
  assert.equal(h.host.store.readRun(next.runId).status, 'SUCCEEDED');
  assert.equal(h.sent.at(-1)!.prompt.includes('模拟机密甲'), false);
});
