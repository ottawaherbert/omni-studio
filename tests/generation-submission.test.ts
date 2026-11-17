import test from 'node:test';
import assert from 'node:assert/strict';
import { submitGenerationRequest, waitForGenerationResult } from '../src/clients/generationSubmission';

// Only the HTTP boundary is mocked. These tests execute the same transport used by existing entry points.
function server(t: any, options: { previous?: boolean; rejectPreflight?: boolean; failSubmit?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; body: any; headers: Headers }> = [];
  let patch: any;
  const execution = { id: 'execution-1', idempotencyKey: 'command-1', status: 'succeeded', results: [{ mediaUrl: '/media/result.png', technicalIssues: [] }] };
  const capability = { id: 'cap', allowedOperations: ['asset_image', 'video'], coreFamily: 'fixture', mode: 'reference_video',
    inputs: { image: { min: 0, max: 2 }, audio: { min: 0, max: 1 }, video: { min: 0, max: 1 } },
    parameters: ['aspectRatio', 'duration', 'steps', 'width', 'height'].map(key => ({ key })) };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://fixture').pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init.method || 'GET', body, headers: new Headers(init.headers) });
    assert.ok(init.signal, 'every request must have a bounded network wait');
    if (path.endsWith('/capabilities')) return Response.json({ recipes: [{ capability, legacyModelIds: ['model'], presets: [{ id: 'model', values: { steps: 8 } }] }] });
    if (path.endsWith('/workspaces/current')) return Response.json({ executions: options.previous ? [execution] : [] });
    if (path.endsWith('/tasks')) return Response.json({ task: { id: 'task', revision: 1, parameters: { width: { value: 1024 }, height: { value: 576 } } } });
    if (path.endsWith('/references')) return Response.json({ reference: { id: 'same-bytes', mediaUrl: body.mediaUrl, mediaKind: body.mediaKind, role: body.role } });
    if (path.endsWith('/tasks/task')) { patch = body.patch; return Response.json({ task: { id: 'task', revision: 2, ...patch } }); }
    if (path.endsWith('/preflight')) return Response.json(options.rejectPreflight ? { issues: [{ message: '引用范围不符' }] } : { plan: { id: 'plan', planHash: 'hash', capability }, issues: [] });
    if (path.endsWith('/grants')) return Response.json({ grant: { id: 'grant' } });
    if (path.endsWith('/executions')) { if (options.failSubmit) throw new Error('network failure'); return Response.json({ execution }); }
    if (path.endsWith('/executions/execution-1')) return Response.json({ execution });
    throw new Error(`Unexpected path: ${path}`);
  });
  return { calls, get patch() { return patch; } };
}
const input = { modelConfigId: 'model', prompt: '本场镜头', aspectRatio: '9:16', commandId: 'command-1' };

test('legacy entry preserves repeated image roles, audio, exact prompt and authored parameters', async t => {
  const mock = server(t);
  const result = await submitGenerationRequest({ ...input, operation: 'video', duration: 12, parameters: { steps: 10 }, references: [
    { url: '/media/same.png', kind: 'image', role: 'first_frame' }, { url: '/media/same.png', kind: 'image', role: 'last_frame' }, { url: '/media/dialogue.wav', kind: 'audio', role: 'full_dialogue' },
  ] });
  assert.equal(mock.patch.prompt, input.prompt);
  assert.deepEqual(mock.patch.references.map((r: any) => r.role), ['first_frame', 'last_frame', 'full_dialogue']);
  assert.equal(new Set(mock.patch.references.map((r: any) => r.id)).size, 3);
  assert.equal(mock.patch.parameters.width.value, 576);
  assert.equal(mock.patch.parameters.height.value, 1024);
  assert.equal(mock.patch.parameters.steps.value, 10);
  assert.equal(mock.patch.parameters.duration.value, 12);
  assert.equal(mock.calls.some(c => c.path.endsWith('/grants')), false);
  assert.equal((await waitForGenerationResult(result)).url, '/media/result.png');
});
test('resuming an existing command never imports, edits, grants or resubmits', async t => {
  const mock = server(t, { previous: true });
  const result = await submitGenerationRequest(input);
  await result.poll();
  assert.equal(mock.calls.filter(c => c.method !== 'GET').length, 1, 'only idempotent task lookup is allowed');
  assert.equal(mock.calls.some(c => c.path.endsWith('/executions')), false);
});
test('operator never creates its own grant and authenticates all requests including polling', async t => {
  const mock = server(t);
  const result = await submitGenerationRequest({ ...input, operator: true, operatorToken: 'fixture-token' });
  await result.poll();
  assert.ok(mock.calls.every(c => c.path.includes('/operator/') && c.headers.get('Authorization') === 'Bearer fixture-token'));
  assert.equal(mock.calls.some(c => c.path.endsWith('/grants')), false);
  assert.equal(mock.calls.find(c => c.path.endsWith('/executions'))!.body.grantId, undefined);
});
test('unsupported reference counts fail before task mutation rather than dropping inputs', async t => {
  const mock = server(t);
  await assert.rejects(submitGenerationRequest({ ...input, references: [1, 2, 3].map(n => ({ url: `${n}.png`, kind: 'image' })) }), /不会丢弃参考/);
  assert.equal(mock.calls.length, 1);
});
test('failed preflight cannot grant or execute', async t => {
  const mock = server(t, { rejectPreflight: true });
  await assert.rejects(submitGenerationRequest(input), /引用范围不符/);
  assert.equal(mock.calls.some(c => c.path.endsWith('/executions') || c.path.endsWith('/grants')), false);
});
test('unknown submit outcome remains recoverable and is never automatically retried', async t => {
  const mock = server(t, { failSubmit: true });
  await assert.rejects(submitGenerationRequest(input), /提交状态未确认/);
  assert.equal(mock.calls.filter(c => c.path.endsWith('/executions')).length, 1);
});
test('held executions report their identity without further polling', async () => {
  let polls = 0;
  await assert.rejects(waitForGenerationResult({ execution: { id: 'held-1', status: 'held', holdCode: 'SOURCE_CHANGED' } as any, poll: async () => { polls++; throw new Error('should not poll'); } }), /held-1/);
  assert.equal(polls, 0);
});

test('worker uses a stable target and directly submits the checked plan without a grant', async t => {
  const mock = server(t);
  const target = { projectId: 'p', kind: 'scratch' as const, scratchId: 'worker:asset-1', shotIds: [] };
  await submitGenerationRequest({ ...input, projectId: 'p', target, operator: true });
  assert.deepEqual(mock.calls.find(c => c.path.endsWith('/tasks'))!.body.target, target);
  assert.equal(mock.calls.some(c => c.path.endsWith('/grants')), false);
  const submission = mock.calls.find(c => c.path.endsWith('/executions'))!.body;
  assert.deepEqual(submission, { planRevisionId: 'plan', planHash: 'hash', idempotencyKey: 'command-1' });
});
test('unsupported explicit parameters are rejected before mutation', async t => {
  const mock = server(t);
  await assert.rejects(submitGenerationRequest({ ...input, parameters: { resolution: '4K' } }), /不会静默忽略/);
  assert.equal(mock.calls.length, 1);
});

test('project generation requires an explicit target and preserves formal ownership through submission', async t => {
  const mock = server(t);
  await assert.rejects(submitGenerationRequest({ ...input, projectId: 'p' }), /实际资产/);
  assert.equal(mock.calls.length, 0);
  const target = { projectId: 'p', kind: 'asset' as const, assetId: 'asset-board', shotIds: [] };
  await submitGenerationRequest({ ...input, target });
  assert.deepEqual(mock.calls.find(call => call.path.endsWith('/tasks'))!.body.target, target);
});

test('waiting timeout preserves the in-flight execution without polling or submitting another task', async () => {
  let polls = 0;
  const execution = { id: 'still-running', status: 'running', results: [] } as any;
  await assert.rejects(waitForGenerationResult({ execution, poll: async () => { polls++; return { execution }; } }, -1), /still-running.*仍保留/);
  assert.equal(polls, 0);
  assert.equal(execution.status, 'running');
});
