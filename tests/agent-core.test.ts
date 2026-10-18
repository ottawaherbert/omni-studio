import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { AgentError, CapabilityRegistry, ResourceCatalog, createLeaseGuard, hashValue, stableJson, type AccessContext, type Capability, type ExecutionPolicy, type ResourceRef } from '../packages/agent-core/src';

const context = (): AccessContext => ({ ownerId: 'test-owner', scopeId: 'checklist-workspace', commandRevision: '1', policyRevision: '1', execution: { leaseKind: 'step', runId: 'run-1', workerId: 'worker-1', fence: 1, generation: 1, inputRevision: 1, stepId: 'step-1' }, signal: new AbortController().signal });
const ref = (version = '1'): ResourceRef => ({ uri: 'resource://documents/checklist', version, contentHash: hashValue({ version }), branch: 'workspace:test' });
const code = (name: string) => (error: unknown) => error instanceof AgentError && error.code === name;

function checklistCapability(onExecute: () => void = () => {}): Capability {
  const parse = (value: unknown) => {
    if (!value || typeof value !== 'object' || !Array.isArray((value as any).items) || !(value as any).items.every((x: unknown) => typeof x === 'string')) throw new AgentError('SCHEMA_INVALID', '清单项目必须为文字数组', 400);
    return { items: (value as { items: string[] }).items };
  };
  return {
    spec: {
      id: 'checklist.propose', version: '1', description: '根据已选文档项目保存清单候选',
      implementationDigest: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
      effect: 'PROPOSE', cost: 'NONE', dispatch: 'DURABLE', replay: 'TRANSACTIONAL',
      input: { jsonSchema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } }, parse },
      output: { jsonSchema: { type: 'object', required: ['items'] }, parse },
    },
    async prepare(input) { return { input: { items: (input as { items: string[] }).items.map(item => item.trim()) }, sources: [ref()], targets: [ref()] }; },
    async execute(call) {
      onExecute();
      return { status: 'SUCCEEDED', summary: '清单候选', data: call.request.input, evidence: call.sources, artifacts: call.targets, effectState: 'CANDIDATE_PRESERVED', retry: 'NEVER' };
    },
  };
}
const request = () => ({ capabilityId: 'checklist.propose', capabilityVersion: '1', input: { items: [' 保存原文 ', ' 检查版本 '] }, callId: 'call-1' });
const allow: ExecutionPolicy = { async assertExecution() {}, async authorize() {} };

test('command identity preserves JSON semantics, dangerous keys and deterministic ordering', () => {
  assert.equal(hashValue({ b: 2, a: [1, '中'] }), hashValue({ a: [1, '中'], b: 2 }));
  assert.notEqual(hashValue(JSON.parse('{"__proto__":{"x":1}}')), hashValue({}));
  assert.equal(JSON.parse(stableJson(JSON.parse('{"__proto__":{"x":1}}'))).__proto__.x, 1);
  for (const invalid of [NaN, Infinity, 1n, new Date(), new Map(), [undefined], Array(1)]) assert.throws(() => hashValue(invalid), code('INVALID_JSON'));
  const cycle: any = {}; cycle.next = cycle;
  assert.throws(() => hashValue(cycle), code('INVALID_JSON'));
});

test('non-screenplay provider prepares, freezes and executes through shared policy', async () => {
  const phases: string[] = [];
  const registry = new CapabilityRegistry({ ...allow, async authorize(spec, call, ctx, phase) { assert.equal(ctx.scopeId, 'checklist-workspace'); assert.equal(spec.effect, 'PROPOSE'); phases.push(phase); } }).register(checklistCapability());
  const input = request();
  const prepared = await registry.prepare(input, context());
  input.input.items[0] = '后来的修改';
  assert.deepEqual(prepared.request.input, { items: ['保存原文', '检查版本'] });
  const result = await registry.execute(prepared, context());
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.effectState, 'CANDIDATE_PRESERVED');
  assert.deepEqual(result.data, prepared.request.input);
  assert.deepEqual(phases, ['PREPARE', 'PREPARE', 'EXECUTE']);
});

test('changed prepared targets, input, owner, policy and provider version cannot execute', async () => {
  let executions = 0;
  const registry = new CapabilityRegistry(allow).register(checklistCapability(() => executions++));
  const prepared = await registry.prepare(request(), context());
  for (const mutate of [
    (call: any) => { call.request.input.items.push('changed'); },
    (call: any) => { call.targets[0].version = '2'; },
    (call: any) => { call.request.callId = 'other-call'; },
    (call: any) => { call.implementationDigest = '0'.repeat(64); },
  ]) {
    const forged = structuredClone(prepared); mutate(forged);
    await assert.rejects(registry.execute(forged, context()), code('IDEMPOTENCY_CONFLICT'));
  }
  await assert.rejects(registry.execute(prepared, { ...context(), ownerId: 'another-owner' }), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(registry.execute(prepared, { ...context(), policyRevision: '2' }), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(executions, 0);
});

test('a changed installed capability asks for rebase while retaining the old prepared request', async () => {
  const frozen=await new CapabilityRegistry(allow).register(checklistCapability()).prepare(request(),context());
  const changed=checklistCapability();changed.spec.implementationDigest='0'.repeat(64);
  const current=new CapabilityRegistry(allow).register(changed);
  await assert.rejects(current.attest(frozen,context()),code('CAPABILITY_IMPLEMENTATION_CHANGED'));
  assert.equal(frozen.request.callId,'call-1');
});

test('schema, authorization and durable execution checks precede provider execution', async () => {
  let executions = 0;
  const capability = checklistCapability(() => executions++);
  const registry = new CapabilityRegistry(allow).register(capability);
  await assert.rejects(registry.prepare({ ...request(), input: { items: [1] } }, context()), code('SCHEMA_INVALID'));
  const prepared = await registry.prepare(request(), context());
  await assert.rejects(registry.execute(prepared, { ...context(), execution: { ...context().execution, stepId: undefined } }), code('DURABLE_STEP_REQUIRED'));
  const denied = new CapabilityRegistry({ ...allow, async authorize() { throw new AgentError('DENIED', '未授权'); } }).register(capability);
  await assert.rejects(denied.prepare(request(), context()), code('DENIED'));
  assert.equal(executions, 0);
});

test('losing the execution fence during a provider result prevents success consumption', async () => {
  let valid = true;
  const registry = new CapabilityRegistry({ ...allow, async assertExecution() { if (!valid) throw new AgentError('LEASE_LOST', '旧执行'); } }).register(checklistCapability(() => { valid = false; }));
  const prepared = await registry.prepare(request(), context());
  await assert.rejects(registry.execute(prepared, context()), code('LEASE_LOST'));
});

test('invalid successful output is rejected without assuming that effects did not happen', async () => {
  const capability = checklistCapability();
  capability.execute = async () => ({ status: 'SUCCEEDED', summary: 'invalid', data: { items: [1] }, evidence: [], artifacts: [], effectState: 'EFFECT_VERIFIED', retry: 'NEVER' });
  const registry = new CapabilityRegistry(allow).register(capability);
  const prepared = await registry.prepare(request(), context());
  await assert.rejects(registry.execute(prepared, context()), code('SCHEMA_INVALID'));
});

test('resource reads preserve omitted limits, exact versions and empty collection dependencies', async () => {
  let limit: number | undefined;
  let reads = 0;
  let allowed = true;
  const catalog = new ResourceCatalog(async () => { if (!allowed) throw new AgentError('DENIED', '未授权'); }).register({
    namespace: 'documents',
    async list() { return { items: [], collection: ref('catalog-1'), truncated: false, nextCursor: null }; },
    async search() { return { items: [], collection: ref('catalog-1'), truncated: false, nextCursor: null }; },
    async open(source, options) { limit = options.limit; reads++; return { ref: source, data: '原文', truncated: false, nextCursor: null }; },
  });
  assert.equal((await catalog.search('documents', { query: ' 尚未出现的资料 ' }, context())).collection.version, 'catalog-1');
  const result = await catalog.open(ref(), {}, context());
  assert.equal(limit, undefined);
  assert.deepEqual(result.ref, ref());
  await assert.rejects(catalog.open(ref(), { limit: NaN }, context()), code('INVALID_RESOURCE_LIMIT'));
  allowed = false;
  await assert.rejects(catalog.open(ref(), {}, context()), code('DENIED'));
  assert.equal(reads, 1);
});

test('resource providers cannot return a different version or silently truncated output', async () => {
  const catalog = new ResourceCatalog(async () => {}).register({
    namespace: 'documents',
    async list() { return { items: [], collection: ref(), truncated: true, nextCursor: null }; },
    async search() { return { items: [], collection: ref(), truncated: true, nextCursor: null }; },
    async open() { return { ref: ref('2'), data: 'new', truncated: false, nextCursor: null }; },
  });
  await assert.rejects(catalog.open(ref(), {}, context()), code('RESOURCE_VERSION_CHANGED'));
  await assert.rejects(catalog.list('documents', {}, context()), code('INCOMPLETE_RESOURCE_PAGE'));
});

test('lease guard aborts on confirmed takeover and cannot be revived by late renewal', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
  let finish!: (until: number | null) => void;
  const guard = createLeaseGuard({ leaseUntil: 1100, heartbeatMs: 20, renew: () => new Promise(resolve => { finish = resolve; }), onHeartbeatError() {} });
  t.mock.timers.tick(20);
  t.mock.timers.tick(80);
  assert.equal(guard.signal.aborted, true);
  finish(2000);
  await Promise.resolve();
  assert.equal(guard.signal.aborted, true);
  guard.dispose();
});

test('heartbeat error keeps only the last confirmed deadline; renewal uses DB deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
  let errors = 0;
  const guard = createLeaseGuard({ leaseUntil: 1100, heartbeatMs: 20, async renew() { throw new Error('temporary DB failure'); }, onHeartbeatError() { errors++; } });
  t.mock.timers.tick(20);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(errors, 1);
  assert.equal(guard.signal.aborted, false);
  t.mock.timers.tick(80);
  assert.equal(guard.signal.aborted, true);
  guard.dispose();
  const renewed = createLeaseGuard({ leaseUntil: 1200, heartbeatMs: 20, async renew() { return 1500; }, onHeartbeatError() {} });
  t.mock.timers.tick(20); await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(renewed.signal.aborted, false);
  renewed.dispose();
});

test('core imports stay domain independent and migration source snapshots match their manifest', () => {
  const root = path.resolve('packages/agent-core/src');
  for (const name of readdirSync(root).filter(file => file.endsWith('.ts'))) {
    const file = ts.createSourceFile(name, readFileSync(path.join(root, name), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const target = specifier.text;
      assert.ok(target.startsWith('./') || target === 'js-sha256', `Forbidden core dependency: ${target}`);
      if (target.startsWith('./')) assert.ok(path.resolve(root, target).startsWith(root + path.sep));
    }
  }
  for (const name of ['agent-core', 'agent-sqlite', 'agent-context']) {
    const migration = path.resolve(`packages/${name}/migration`);
    const manifest = JSON.parse(readFileSync(path.join(migration, 'manifest.json'), 'utf8'));
    for (const source of manifest.files) assert.equal(createHash('sha256').update(readFileSync(path.join(migration, source.snapshot))).digest('hex'), source.sha256);
  }
});


test('context compiler remains independent of domains, persistence and UI', () => {
  const root = path.resolve('packages/agent-context/src');
  for (const name of readdirSync(root).filter(file => file.endsWith('.ts'))) {
    const file = ts.createSourceFile(name, readFileSync(path.join(root, name), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      assert.ok(specifier.text.startsWith('./') || specifier.text === '../../agent-core/src', `Forbidden context dependency: ${specifier.text}`);
    }
  }
});
