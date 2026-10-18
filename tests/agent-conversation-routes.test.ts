import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { registerScriptConversationRoutes } from '../apps/api/src/routes/scriptConversationRoutes';
import { SCRIPT_CHAT_SCOPE } from '../apps/api/src/agent/scriptConversation';
import type { MethodBinding } from '../packages/script/src/schema';
import { AgentError } from '../packages/agent-core/src';

// Local HTTP and isolated SQLite only. No generated prose or external provider.
async function setup(t: any) {
  const db = new Database(':memory:');
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('Simulated uncertain transport; no external network'); } }, 'conversation-route-test');
  let resolutions = 0;
  const method: MethodBinding = { id: 'method', title: 'Protocol fixture', version: '1', content: 'Frozen test configuration' };
  let resolve = async (ids: string[]): Promise<MethodBinding[]> => ids.map(() => structuredClone(method));
  const app = express(); app.use(express.json());
  const deps = { ...host, owner: (req: express.Request) => req.header('x-test-owner') || 'owner', resolveMethods: async (ids: string[]) => { resolutions++; return resolve(ids); }, channel: 'external' as 'api' | 'external', routeRef: 'fixture:original' };
  registerScriptConversationRoutes(app, deps);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject);
  });
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (route: string, body?: unknown, expected = 200, owner = 'owner') => {
    const response = await fetch(`${origin}/api/script-assistant${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-test-owner': owner }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as any;
  };
  return { ...host, db, deps, request, method, get resolutions() { return resolutions; }, resolveWith: (fn: typeof resolve) => { resolve = fn; } };
}

test('chat state polling retains replies and complete pending requests without replaying archived prompts', async t => {
  const h = await setup(t), { conversation } = await h.request('/conversations', {});
  const route = `/conversations/${conversation.id}`;
  const accepted = await h.request(`${route}/messages`, { requestId: 'state-first', expectedVersion: 1, text: 'mechanical first input' }, 202);
  const runId = accepted.conversation.turns[0].runId;
  await h.worker.runOnce(runId);
  const pending = h.journal.listExternal(runId, 'owner')[0];
  assert.deepEqual((await h.request(`${route}?view=state`)).conversation.turns[0].externalRequests, [pending]);
  h.journal.submitExternal(pending.id, 'owner', pending.inputHash, JSON.stringify({ question: 'mechanical visible reply', options: [] }), { name: 'MECHANICAL_NO_EXTERNAL_MODEL' });
  await h.worker.runOnce(runId);
  const full = (await h.request(route)).conversation;
  assert.ok(full.turns[0].response.prompt.length > 0);
  assert.equal(full.turns[0].externalRequests.length, 1);
  const externalRead = t.mock.method(h.journal, 'externalRequest');
  const archivedRead = t.mock.method(h.journal, 'viewRun');
  const state = (await h.request(`${route}?view=state`)).conversation;
  const { prompt: _prompt, ...display } = full.turns[0].response;
  assert.deepEqual(state.turns[0].response, display);
  assert.deepEqual(state.turns[0].input, full.turns[0].input);
  assert.deepEqual(state.turns[0].externalRequests, []);
  assert.equal(externalRead.mock.callCount(), 0, 'completed frozen requests are not loaded for polling');
  assert.equal(archivedRead.mock.callCount(),0,'state polling validates visible replies without loading archived model requests');
  assert.deepEqual((await h.request('/conversations?view=state', {})).conversation, state);
  assert.deepEqual((await h.request(route)).conversation, full, 'polling must not alter the complete audit record');
  const next = await h.request(`${route}/messages`, { requestId: 'state-next', expectedVersion: full.version, text: 'mechanical second input' }, 202);
  const nextRun = next.conversation.turns[1].runId;
  await h.worker.runOnce(nextRun);
  const nextPending = h.journal.listExternal(nextRun, 'owner')[0];
  const waiting = (await h.request(`${route}?view=state`)).conversation;
  assert.deepEqual(waiting.turns[1].externalRequests, [nextPending]);
  assert.ok(nextPending.request.prompt.includes('mechanical visible reply'));
  await h.request(`${route}?view=state`, undefined, 404, 'other-owner');
  const assertArtifact = h.contexts.assertArtifact.bind(h.contexts);
  t.mock.method(h.contexts, 'assertArtifact', (...args: Parameters<typeof h.contexts.assertArtifact>) => {
    if (args[0] === 'conversation-turn') throw new AgentError('CONTEXT_REVOKED', 'mechanical withdrawal', 403);
    return assertArtifact(...args);
  });
  const revoked = (await h.request(`${route}?view=state`)).conversation;
  assert.equal(revoked.turns[0].response.redacted, true);
  assert.ok(!JSON.stringify(revoked.turns[0].response).includes('mechanical visible reply'));
});

test('HTTP retry returns original accepted turn after Skill update/deletion and host route changes', async t => {
  const h = await setup(t), opened = await h.request('/conversations', {});
  const route = `/conversations/${opened.conversation.id}/messages`;
  const body = { requestId: 'original-message', expectedVersion: 1, text: 'protocol input', methodIds: ['method'] };
  const accepted = await h.request(route, body, 202);
  h.resolveWith(async () => [{ ...h.method, version: '2', content: 'New method' }]);
  h.deps.routeRef = 'fixture:changed'; h.deps.channel = 'api';
  assert.equal((await h.request(route, body, 202)).turnId, accepted.turnId);
  h.resolveWith(async () => { throw new Error('Skill has been deleted'); });
  const replay = await h.request(route, body, 202);
  assert.equal(replay.turnId, accepted.turnId); assert.equal(h.resolutions, 1);
  const frozen = h.conversations.read(opened.conversation.id, 'owner').turns[0].input;
  assert.equal(frozen.methods[0].version, '1'); assert.equal(frozen.channel, 'external'); assert.equal(frozen.routeRef, 'fixture:original');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 1);
  assert.equal((await h.request(route, { ...body, text: 'changed request' }, 409)).code, 'IDEMPOTENCY_CONFLICT');
});

test('concurrent identical HTTP commands resolve to one receipt even when the slower Skill lookup fails', async t => {
  const h = await setup(t), opened = await h.request('/conversations', {});
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  h.resolveWith(async () => { if (++calls === 1) { started(); await blocked; throw new Error('Skill disappeared during lookup'); } return [h.method]; });
  const route = `/conversations/${opened.conversation.id}/messages`;
  const body = { requestId: 'simultaneous', expectedVersion: 1, text: 'protocol concurrent input', methodIds: ['method'] };
  const slow = h.request(route, body, 202); await entered;
  const fast = await h.request(route, body, 202); release();
  assert.equal((await slow).turnId, fast.turnId);
  assert.equal(h.conversations.read(opened.conversation.id, 'owner').turns.length, 1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 1);
});

test('route owner/scope, turn CAS and reset client keys preserve existing conversations', async t => {
  const h = await setup(t), first = await h.request('/conversations', { seed: [{ role: 'user', text: 'old seed' }] });
  const firstId = first.conversation.id, route = `/conversations/${firstId}/messages`;
  const body = { requestId: 'message', expectedVersion: 1, text: 'protocol input' };
  await h.request(route, body, 202);
  assert.equal((await h.request(route, { ...body, requestId: 'stale-tab' }, 409)).code, 'CONVERSATION_VERSION_CONFLICT');
  await h.request(`/conversations/${firstId}`, undefined, 404, 'someone-else');
  const foreignScope = h.conversations.open('owner', 'unrelated:scope', 'home');
  await h.request(`/conversations/${foreignScope.id}`, undefined, 403);
  await h.request(`/conversations/${foreignScope.id}/messages`, body, 403);
  for (const clientKey of ['', ' ', 10, null, 'a'.repeat(201)]) await h.request('/conversations', { clientKey }, 400);
  const reset = await h.request('/conversations', { clientKey: 'new-client-key' });
  assert.notEqual(reset.conversation.id, firstId); assert.equal(reset.conversation.turns.length, 0);
  assert.equal((await h.request('/conversations', { clientKey: 'new-client-key' })).conversation.id, reset.conversation.id);
  const old = (await h.request(`/conversations/${firstId}`)).conversation;
  assert.equal(old.turns.length, 1); assert.deepEqual(old.seed, first.conversation.seed);
  for (const requestId of ['', 10, 'a'.repeat(201)]) await h.request(`/conversations/${reset.conversation.id}/messages`, { ...body, requestId }, 400);
  assert.equal(h.conversations.read(reset.conversation.id, 'owner').scopeId, SCRIPT_CHAT_SCOPE);
});

test('Skill resolution accepts the host skill prefix while enforcing exact ordered one-to-one bindings', async t => {
  const h = await setup(t), opened = await h.request('/conversations', {});
  const route = `/conversations/${opened.conversation.id}/messages`;
  h.resolveWith(async ids => ids.map(id => ({ ...h.method, id: `skill:${id}` })));
  const accepted = await h.request(route, { requestId: 'prefixed', expectedVersion: 1, text: 'protocol input', methodIds: ['first', 'second'] }, 202);
  assert.deepEqual(accepted.conversation.turns[0].input.methods.map((method: MethodBinding) => method.id), ['skill:first', 'skill:second']);
  h.resolveWith(async ids => [...ids].reverse().map(id => ({ ...h.method, id: `skill:${id}` })));
  assert.equal((await h.request(route, { requestId: 'reversed', expectedVersion: 2, text: 'protocol input', methodIds: ['first', 'second'] }, 409)).code, 'SKILL_NOT_FOUND');
  h.resolveWith(async () => [h.method]);
  assert.equal((await h.request(route, { requestId: 'wrong-id', expectedVersion: 2, text: 'protocol input', methodIds: ['first'] }, 409)).code, 'SKILL_NOT_FOUND');
});

test('UNKNOWN turn keeps its HTTP receipt but new request IDs and reset threads cannot resend it', async t => {
  const h = await setup(t); h.deps.channel = 'api';
  const opened = await h.request('/conversations', {}), threadId = opened.conversation.id;
  const body = { requestId: 'uncertain', expectedVersion: 1, text: 'mechanical protocol input' };
  const accepted = await h.request(`/conversations/${threadId}/messages`, body, 202);
  const runId = accepted.conversation.turns[0].runId;
  await h.worker.runOnce(runId);
  assert.equal(h.store.readRun(runId).status, 'RECONCILIATION_REQUIRED');
  assert.equal((await h.request(`/conversations/${threadId}/messages`, body, 202)).turnId, accepted.turnId);
  assert.equal((await h.request(`/conversations/${threadId}/messages`, { ...body, requestId: 'new-retry', expectedVersion: 2 }, 409)).code, 'CONVERSATION_RESULT_UNRESOLVED');
  const reset = await h.request('/conversations', { clientKey: 'reset-after-unknown' });
  assert.equal((await h.request(`/conversations/${reset.conversation.id}/messages`, { ...body, requestId: 'new-thread-retry' }, 409)).code, 'CONVERSATION_RESULT_UNRESOLVED');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_turns').get() as any).n, 1);
});

test('Goal accepted during asynchronous Skill resolution still rejects the new chat without a turn or receipt', async t => {
  const h=await setup(t),{conversation}=await h.request('/conversations',{});
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
  h.resolveWith(async()=>{entered();await waiting;return [h.method];});
  const pending=h.request(`/conversations/${conversation.id}/messages`,{requestId:'goal-race',expectedVersion:1,text:'机械并发输入',methodIds:['method']},409);
  await started;
  h.store.accept({ownerId:'owner',scopeId:SCRIPT_CHAT_SCOPE,threadId:conversation.id,requestId:'concurrent-goal',kind:'GOAL',input:{},policyRevision:'test',maxInvocations:1});
  release();assert.equal((await pending).code,'CONVERSATION_GOAL_ACTIVE');
  assert.equal(h.conversations.read(conversation.id,'owner').turns.length,0);
  assert.equal(h.conversations.read(conversation.id,'owner').version,1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversation_commands').get() as any).n,0);
});

test('HTTP explicit restart retires an UNKNOWN turn, preserves its receipt and opens a new empty usable dialogue', async t => {
  const h = await setup(t); h.deps.channel = 'api';
  const { conversation } = await h.request('/conversations', { seed: [{ role: 'user', text: 'old seed' }] });
  const body = { requestId: 'uncertain-before-restart', expectedVersion: 1, text: 'mechanical protocol input' };
  const accepted = await h.request(`/conversations/${conversation.id}/messages`, body, 202);
  const runId = accepted.conversation.turns[0].runId;
  await h.worker.runOnce(runId);
  assert.equal(h.store.readRun(runId).status, 'RECONCILIATION_REQUIRED');
  const restartBody = { requestId: 'explicit-restart', expectedVersion: accepted.conversation.version, clientKey: 'fresh-dialogue' };
  const route = `/conversations/${conversation.id}/restart`;
  const next = (await h.request(route, restartBody)).conversation;
  assert.notEqual(next.id, conversation.id); assert.deepEqual(next.turns, []); assert.deepEqual(next.seed, []);
  assert.equal(h.store.readRun(runId).status, 'CANCELED');
  const old = (await h.request(`/conversations/${conversation.id}`)).conversation;
  assert.equal(old.restartedTo, next.id); assert.equal(old.turns.length, 1); assert.equal(old.turns[0].response, null);
  assert.equal((await h.request(`/conversations/${conversation.id}/messages`, body, 202)).turnId, accepted.turnId);
  assert.equal((await h.request(`/conversations/${conversation.id}/messages`, { ...body, requestId: 'late-old-message', expectedVersion: old.version }, 409)).code, 'CONVERSATION_RESTARTED');
  assert.equal((await h.request(`/conversations/${next.id}/messages`, { ...body, requestId: 'fresh-message', expectedVersion: next.version }, 202)).conversation.turns.length, 1);
  assert.equal((await h.request(route, restartBody)).conversation.id, next.id);
  assert.equal((await h.request(route, { ...restartBody, clientKey: 'changed-body' }, 409)).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversations').get() as any).n, 2);
});

test('restart HTTP checks author, scope and current version before canceling any work', async t => {
  const h = await setup(t), { conversation } = await h.request('/conversations', {});
  const body = { requestId: 'restart-validation', expectedVersion: conversation.version, clientKey: 'fresh' };
  const route = `/conversations/${conversation.id}/restart`;
  await h.request(route, body, 404, 'someone-else');
  const foreignScope = h.conversations.open('owner', 'other:scope', 'other');
  assert.equal((await h.request(`/conversations/${foreignScope.id}/restart`, body, 403)).code, 'CHAT_SCOPE_DENIED');
  for (const change of [{ requestId: '' }, { requestId: 10 }, { clientKey: '' }, { expectedVersion: 0 }, { seed: [] }])
    assert.equal((await h.request(route, { ...body, ...change }, 400)).code, 'INVALID_CONVERSATION_RESTART');
  const accepted = await h.request(`/conversations/${conversation.id}/messages`, { requestId: 'message-won-race', expectedVersion: 1, text: 'mechanical message' }, 202);
  assert.equal((await h.request(route, body, 409)).code, 'CONVERSATION_VERSION_CONFLICT');
  assert.equal(h.store.readRun(accepted.conversation.turns[0].runId).status, 'QUEUED');
  assert.equal(h.conversations.read(conversation.id, 'owner').restartedTo, null);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversation_restarts').get() as any).n, 0);
});

test('restart wins while old-message Skill lookup is pending and prevents its late acceptance', async t => {
  const h = await setup(t), { conversation } = await h.request('/conversations', {});
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  h.resolveWith(async () => { entered(); await waiting; return [h.method]; });
  const pending = h.request(`/conversations/${conversation.id}/messages`, { requestId: 'old-delayed-message', expectedVersion: 1, text: 'mechanical message', methodIds: ['method'] }, 409);
  await started;
  const next = (await h.request(`/conversations/${conversation.id}/restart`, { requestId: 'restart-before-message-accept', expectedVersion: 1, clientKey: 'fresh' })).conversation;
  release(); assert.equal((await pending).code, 'CONVERSATION_RESTARTED');
  assert.equal(h.conversations.read(conversation.id, 'owner').turns.length, 0);
  assert.equal(h.conversations.read(next.id, 'owner').turns.length, 0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversation_commands').get() as any).n, 0);
});
