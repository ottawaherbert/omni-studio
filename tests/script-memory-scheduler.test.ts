import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { ModelResult } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { compileContext, memorySection } from '../packages/agent-context/src';
import { hashValue } from '../packages/agent-core/src';

import { authorizeMemoryApi, recordChatApiFixture, completeMemoryFixture } from './script-memory-fixtures';

const protocol = (items: unknown[]): ModelResult => ({ text: JSON.stringify({ items }), provenance: { channel: 'external-return', producer: 'mechanical-protocol-constant' } });
const code = (value: string) => (error: unknown) => (error as any)?.code === value;
async function setup(t: any, api = true) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { return protocol([]); } }, 'memory-test');
  const thread = host.conversations.open('author', 'script:home', 'memory-test');
  const doc = createScriptProject('机械记忆验收', createScriptCreationProfile('short-film', 1, 5));
  doc.units[0].scenes[0].blocks[0].text = '机械协议来源版本一';
  const workspace = host.workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'create-memory-workspace', source: { document: doc } });
  if (api) await authorizeMemoryApi(host, workspace);
  const access = { ownerId: 'author', scopeId: workspace.id, branch: `workspace:${workspace.id}` };
  return { db, host, workspace, access };
}

test('source batch upgrade restarts unfinished discovery once and preserves frozen work',async t=>{
  const h=await setup(t);
  h.host.memory.discover();const frozen=h.host.memory.work.freezeNext()!;
  const sourceId=`${h.workspace.id}:1`;
  h.db.prepare("INSERT INTO script_memory_scan(kind,source_id,next_index,last_served) VALUES('workspace',?,8,1)").run(sourceId);
  h.db.prepare("DELETE FROM script_memory_scheduler_state WHERE name='source_batch_version'").run();
  const reopened=createScriptAgentHost(h.db,{sendOnce:async()=>protocol([])},'batch-upgrade');
  assert.equal((h.db.prepare('SELECT next_index FROM script_memory_scan WHERE source_id=?').get(sourceId) as any).next_index,0);
  assert.deepEqual(reopened.memory.work.read(frozen.id,h.access),frozen);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_memory_seen WHERE source_id=?').get(sourceId) as any).n,1);
  h.db.prepare('UPDATE script_memory_scan SET next_index=3 WHERE source_id=?').run(sourceId);
  createScriptAgentHost(h.db,{sendOnce:async()=>protocol([])},'batch-upgrade-again');
  assert.equal((h.db.prepare('SELECT next_index FROM script_memory_scan WHERE source_id=?').get(sourceId) as any).next_index,3);
});

test('committed workspace text schedules one frozen extraction, exact return is idempotent, source change schedules rebuild', async t => {
  const h = await setup(t);
  assert.equal(h.host.memory.discover(), 1);
  assert.equal(h.host.memory.discover(), 0);
  const job = h.host.memory.work.freezeNext()!;
  assert.equal(job.status, 'FROZEN');
  assert.match(job.request!.prompt, /机械协议来源版本一/);
  const result = protocol([{ key: 'protocol.note', kind: 'NAVIGATION', label: '机械索引', value: '机械协议占位一' }]);
  const done = completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, result);
  assert.equal(done.status, 'DONE');
  assert.deepEqual(completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, result), done);
  assert.throws(() => completeMemoryFixture(h.host, job.id, h.access, 'wrong', result), code('IDEMPOTENCY_CONFLICT'));
  const first = h.host.contexts.listMemories(h.access).items[0];
  assert.equal(first.origin, 'MODEL_DERIVED');
  assert.equal(first.review, 'AUTO_ACCEPTED');
  assert.equal(first.dependencies[0].ref.contentHash, job.source.ref.contentHash);
  const changed = structuredClone(h.workspace.document);
  changed.units[0].scenes[0].blocks[0].text = '机械协议来源版本二';
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'edit', expectedRevision: 1, expectedEpoch: 1, document: changed });
  assert.equal(h.host.contexts.listMemories(h.access).items.some(item=>item.id===first.id),false);
  assert.equal(h.host.memory.scheduleRebuilds(), 1);
  assert.equal(h.host.contexts.getMemory(first.id, h.access).status, 'STALE');
  assert.deepEqual(h.host.contexts.pendingRebuilds(h.access).map(item => item.id), [first.id]);
  const rebuild = h.host.memory.work.freezeNext()!;
  assert.equal(rebuild.kind, 'REBUILD');
  assert.match(rebuild.request!.prompt, /机械协议来源版本二/);
  completeMemoryFixture(h.host, rebuild.id, h.access, rebuild.requestHash!, protocol([{ key: 'protocol.note', kind: 'NAVIGATION', label: '机械索引新版', value: '机械协议占位二' }]));
  const updated = h.host.contexts.getMemory(first.id, h.access);
  assert.equal(updated.status, 'ACTIVE');
  assert.equal(updated.revision, 3);
  assert.equal(updated.content?.value, '机械协议占位二');
  assert.deepEqual(h.host.contexts.pendingRebuilds(h.access), []);
});

test('author deletion wins over a delayed rebuild return; old source cannot be consumed', async t => {
  const h = await setup(t);
  h.host.memory.discover(); const job = h.host.memory.work.freezeNext()!;
  const saved = completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, protocol([{ key: 'protocol.delete', kind: 'NAVIGATION', label: '待删除', value: '机械占位' }]));
  const memory = h.host.contexts.listMemories(h.access).items[0];
  const changed = structuredClone(h.workspace.document); changed.units[0].scenes[0].blocks[0].text = '机械协议新版';
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'edit', expectedRevision: 1, expectedEpoch: 1, document: changed });
  h.host.memory.scheduleRebuilds(); const rebuild = h.host.memory.work.freezeNext()!;
  h.host.contexts.updateMemory(h.access, 'delete-memory', memory.id, 2, 'DELETE');
  assert.throws(() => completeMemoryFixture(h.host, rebuild.id, h.access, rebuild.requestHash!, protocol([{ key: 'protocol.delete', kind: 'NAVIGATION', label: '不能恢复', value: '机械占位' }])), error => ['CONTEXT_REVOKED', 'MEMORY_REBUILD_DENIED'].includes((error as any)?.code));
  assert.equal(h.host.contexts.getMemory(memory.id, h.access).content, null);
  assert.equal(saved.status, 'DONE');
});

test('sent request is never resent after restart and UNKNOWN accepts only its fenced attempt', async t => {
  const h = await setup(t);
  // The real host rejects unregistered source types; use its committed workspace ref.
  h.host.memory.discover();
  const pending = h.host.memory.work.freezeNext()!;
  assert.equal(pending.source.channel, 'api');
  const api = pending;
  let sends = 0;
  await assert.rejects(() => h.host.memory.work.runOnce({ sendOnce: async () => { sends++; throw new Error('network uncertain'); } }, new AbortController().signal));
  const unknown = h.host.memory.work.read(api.id, h.access);
  assert.equal(unknown.status, 'UNKNOWN'); assert.equal(sends, 1);
  await h.host.memory.work.runOnce({ sendOnce: async () => { sends++; return protocol([]); } }, new AbortController().signal);
  assert.equal(sends, 1);
  assert.throws(() => h.host.memory.work.complete(api.id, h.access, unknown.requestHash!, protocol([]), 'wrong'), code('MEMORY_RESULT_DENIED'));
  const resolved = h.host.memory.work.complete(api.id, h.access, unknown.requestHash!, protocol([]), unknown.attemptId!);
  assert.equal(resolved.status, 'DONE');
});

test('late committed chat response is discovered after newer turn; withdrawn context rejects extraction', async t => {
  const h = await setup(t), thread = h.host.conversations.open('author', 'script:home', 'late-chat');
  const accept = (requestId: string, expectedVersion: number) => h.host.conversations.accept({
    threadId: thread.id, ownerId: 'author', requestId, expectedVersion, requestEnvelope: { text: requestId },
    payload: { text: `机械作者输入 ${requestId}` }, capabilityId: 'script.converse', maxInvocations: 1,
  });
  const first = accept('one', 1), second = accept('two', 2);
  recordChatApiFixture(h.host, h.host.conversations.turn(thread.id,first.turnId,'author').turn.runId); recordChatApiFixture(h.host, h.host.conversations.turn(thread.id,second.turnId,'author').turn.runId);
  h.host.conversations.writeResponse(thread.id, second.turnId, 'author', { text: '机械回复二' });
  h.host.memory.discover();
  const home = { ownerId: 'author', scopeId: 'script:home', branch: 'author' };
  assert.equal(h.host.memory.work.list(home).length, 1);
  const memory = h.host.contexts.createMemory(home, 'author', 'author-note', { key: 'test.author', kind: 'AUTHOR_PREFERENCE', content: { label: '机械作者声明', value: '撤回测试' }, dependencies: [] });
  const frozen = compileContext({ systemInstruction: '机械源', skills: [], sections: [memorySection(h.host.contexts.getMemory(memory.id, home))] });
  const contextRef = h.host.contexts.capture(home, frozen);
  h.host.contexts.bindArtifact('conversation-turn', first.turnId, contextRef, home);
  h.host.conversations.writeResponse(thread.id, first.turnId, 'author', { text: '机械迟到回复一' });
  h.host.memory.discover();
  assert.equal(h.host.memory.work.list(home).length, 2);
  h.host.contexts.updateMemory(home, 'forget-author-note', memory.id, memory.revision, 'DELETE');
  const pending = h.host.memory.work.list(home).find(item => item.source.key.startsWith(`chat.${first.turnId}`))!;
  assert.equal(pending.source.text, '');
  assert.equal(pending.request, null);
  for (let index = 0; index < 4; index++) h.host.memory.work.freezeNext();
  assert.equal(h.host.memory.work.read(pending.id, home).status, 'CANCELED');
});

test('queued and frozen work survive host recreation without changing the frozen request', async t => {
  const h = await setup(t);
  h.host.memory.discover();
  const first = h.host.memory.work.list(h.access)[0];
  assert.equal(first.status, 'QUEUED');
  const reopened = createScriptAgentHost(h.db, { sendOnce: async () => { throw new Error('unexpected send'); } }, 'memory-reopened');
  assert.equal(reopened.memory.work.read(first.id, h.access).status, 'QUEUED');
  const frozen = reopened.memory.work.freezeNext()!;
  assert.equal(frozen.status, 'FROZEN');
  const again = createScriptAgentHost(h.db, { sendOnce: async () => { throw new Error('unexpected send'); } }, 'memory-reopened-again');
  assert.deepEqual(again.memory.work.read(frozen.id, h.access).request, frozen.request);
  assert.equal(again.memory.work.read(frozen.id, h.access).status, 'FROZEN');
});

test('more than 64 committed blocks drain in bounded batches across restart', async t => {
  const h = await setup(t);
  const source = structuredClone(h.workspace.document.units[0].scenes[0]);
  const changed = structuredClone(h.workspace.document);
  changed.units[0].scenes = Array.from({ length: 70 }, (_, index) => ({ ...structuredClone(source),
    id: `mechanical_scene_${index}`, blocks: [{ id: `mechanical_block_${index}`, type: 'action' as const, text: `mechanical protocol ${index} ${'x'.repeat(10000)}` }] }));
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'long-body', expectedRevision: 1, expectedEpoch: 1, document: changed });
  h.host.memory.scheduleRebuilds();
  let completed = 0;
  for (let tick = 0; tick < 80; tick++) {
    h.host.memory.discover();
    const job = h.host.memory.work.freezeNext();
    if (job) { completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, protocol([])); completed++; }
    if (completed === 35) {
      const reopened = createScriptAgentHost(h.db, { sendOnce: async () => { throw new Error('unexpected send'); } }, 'memory-restart-mid-scan');
      assert.equal(reopened.memory.work.read(job!.id, h.access).status, 'DONE');
    }
  }
  assert.equal(completed, 70);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM script_memory_seen WHERE kind='workspace' AND source_id=?").get(`${h.workspace.id}:2`) as any).n, 1);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=? AND status IN ('QUEUED','FROZEN','SENT','UNKNOWN')").get(h.workspace.id) as any).n, 0);
});

test('hundreds of short blocks share bounded requests with complete range provenance', async t => {
  const h = await setup(t), changed = structuredClone(h.workspace.document);
  changed.units[0].scenes[0].blocks = Array.from({ length: 300 }, (_, index) => ({
    id: `short_block_${index}`, type: 'action' as const, text: `mechanical short protocol ${index}`,
  }));
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'many-short-blocks', expectedRevision: 1, expectedEpoch: 1, document: changed });
  h.host.memory.scheduleRebuilds();
  h.host.memory.discover(); h.host.memory.discover();
  const jobs = h.host.memory.work.list(h.access);
  assert.ok(jobs.length > 1 && jobs.length <= 20, `300 short blocks should fit one daily dispatch budget; got ${jobs.length}`);
  const covered = jobs.flatMap(job => job.source.range!.map(range => range.blockId));
  assert.deepEqual(new Set(covered), new Set(changed.units[0].scenes[0].blocks.map(block => block.id)));
});

test('high-escape long block splits by serialized size without stalling discovery', async t => {
  const h = await setup(t), changed = structuredClone(h.workspace.document);
  changed.units[0].scenes[0].blocks[0].text = '\u0000'.repeat(16000);
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'escaped-long-block', expectedRevision: 1, expectedEpoch: 1, document: changed });
  h.host.memory.scheduleRebuilds();
  let completed = 0; const fragments: string[] = [];
  for (let tick = 0; tick < 20; tick++) {
    h.host.memory.discover();
    const job = h.host.memory.work.freezeNext();
    if (job) {
      assert.ok(job.source.text.length <= 12000);
      fragments.push(...job.source.text.split('\n').map(row => JSON.parse(row).text as string));
      completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, protocol([]));
      completed++;
    }
  }
  assert.ok(completed > 1);
  assert.equal(fragments.join(''), changed.units[0].scenes[0].blocks[0].text);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM script_memory_seen WHERE kind='workspace' AND source_id=?").get(`${h.workspace.id}:2`) as any).n, 1);
});

test('long committed conversation with Chinese and escaped punctuation freezes every character', async t => {
  const h=await setup(t),thread=h.host.conversations.open('author','script:home','long-memory-chat');
  const sourceText='汉字，。\n"\\\u0000'.repeat(1300),replyText='回复：\n汉字！'.repeat(1000);
  const accepted=h.host.conversations.accept({threadId:thread.id,ownerId:'author',requestId:'long-chat',expectedVersion:1,
    requestEnvelope:{text:sourceText},payload:{text:sourceText},capabilityId:'script.converse',maxInvocations:1});
  recordChatApiFixture(h.host, h.host.conversations.turn(thread.id,accepted.turnId,'author').turn.runId);
  h.host.conversations.writeResponse(thread.id,accepted.turnId,'author',{text:replyText});
  h.host.memory.discover();
  const home={ownerId:'author',scopeId:'script:home',branch:'author'};
  const jobs=h.host.memory.work.list(home).sort((a,b)=>Number(a.source.key.split('.').at(-1))-Number(b.source.key.split('.').at(-1)));
  assert.ok(jobs.length>1);
  assert.equal(jobs.map(job=>job.source.text).join(''),`作者输入：\n${sourceText}\n\n助手已提交回复：\n${replyText}`);
  for(let index=0;index<jobs.length+2;index++)h.host.memory.work.freezeNext();
  assert.ok(jobs.every(job=>h.host.memory.work.read(job.id,home).status==='FROZEN'));
  assert.ok(jobs.every(job=>h.host.memory.work.read(job.id,home).error===null));
});

test('workspace extraction inherits the accepted author execution channel', async t => {
  const h = await setup(t);
  await h.host.commands.submit('author', { kind: 'GOAL_START', requestId: 'memory-api-route', threadId: h.workspace.threadId,
    expectedConversationVersion: 1, source: { kind: 'WORKSPACE', workspaceId: h.workspace.id, expectedRevision: 1 },
    objective: 'mechanical review route', task: 'REVIEW', target: { unitIds: [h.workspace.document.units[0].id] }, methodIds: [] },
    { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'api', routeRef: 'mechanical-api-route' }) });
  h.host.memory.discover();
  const job = h.host.memory.work.list(h.access)[0];
  assert.equal(job.source.channel, 'api');
  assert.equal(job.source.routeRef, 'mechanical-api-route');
  assert.equal(h.host.memory.work.freezeNext()?.request?.channel, 'api');
});

test('one API scope at its daily send cap does not starve another workspace', async t => {
  const h = await setup(t); h.host.memory.discover();
  const base = h.host.memory.work.list(h.access)[0].source;
  for (let index = 0; index < 20; index++) h.host.memory.work.enqueue({ ...base, key: `protocol.api.cap.${index}`, channel: 'api', routeRef: 'mechanical-api' });
  const sends: string[] = [];
  const transport = { sendOnce: async (request: any) => { sends.push(request.contextRef!.id); return protocol([]); } };
  for (let index = 0; index < 25 && sends.length < 20; index++) await h.host.memory.work.runOnce(transport, new AbortController().signal);
  assert.equal(sends.length, 20);
  const other = h.host.workspaces.create({ ownerId: 'author', threadId: h.workspace.threadId, requestId: 'api-other-scope',
    source: { document: createScriptProject('其他 API 稿', createScriptCreationProfile('short-film', 1, 5)) } });
  const otherAccess = { ownerId: 'author', scopeId: other.id, branch: `workspace:${other.id}` };
  const otherSource = { ...base, access: otherAccess, ref: { ...base.ref, uri: `resource://script/workspaces/${other.id}`,
    contentHash: hashValue(other.document), branch: otherAccess.branch }, key: 'protocol.api.other', channel: 'api' as const, routeRef: 'mechanical-api' };
  h.host.memory.work.enqueue(otherSource);
  for (let index = 0; index < 3 && h.host.memory.work.list(otherAccess)[0].status !== 'DONE'; index++)
    await h.host.memory.work.runOnce(transport, new AbortController().signal);
  assert.equal(sends.length, 21);
  assert.equal(h.host.memory.work.list(otherAccess)[0].status, 'DONE');
  assert.equal(h.host.memory.work.list(h.access).filter(job => job.source.channel === 'api' && ['QUEUED','FROZEN'].includes(job.status)).length, 1);
});

test('full queue releases stale unsent versions and another workspace still advances', async t => {
  const h = await setup(t), original = h.workspace.document.units[0].scenes[0];
  const long = structuredClone(h.workspace.document);
  long.units[0].scenes = Array.from({ length: 70 }, (_, index) => ({ ...structuredClone(original), id: `full_scene_${index}`,
    blocks: [{ id: `full_block_${index}`, type: 'action' as const, text: `mechanical full ${index} ${'x'.repeat(10000)}` }] }));
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'fill-source', expectedRevision: 1, expectedEpoch: 1, document: long });
  h.host.memory.scheduleRebuilds();
  const other = h.host.workspaces.create({ ownerId: 'author', threadId: h.workspace.threadId, requestId: 'other-memory-scope', source: { document: createScriptProject('其他机械稿', createScriptCreationProfile('short-film', 1, 5)) } });
  await authorizeMemoryApi(h.host, other);
  for (let index = 0; index < 12; index++) h.host.memory.discover();
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=? AND status IN ('QUEUED','FROZEN')").get(h.workspace.id) as any).n, 64);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=?").get(other.id) as any).n, 1);
  const revised = structuredClone(long); revised.revision = 2; revised.units[0].scenes[0].blocks[0].text = 'mechanical revised';
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'replace-full-source', expectedRevision: 2,
    expectedEpoch: h.host.workspaces.read(h.workspace.id, 'author').writerEpoch, document: revised });
  await h.host.memory.runOnce(new AbortController().signal);
  await h.host.memory.runOnce(new AbortController().signal);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=? AND status='CANCELED'").get(h.workspace.id) as any).n, 64);
  assert.ok((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=? AND status IN ('QUEUED','FROZEN')").get(h.workspace.id) as any).n > 0);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE scope_id=? AND status='CANCELED'").get(other.id) as any).n, 0);
});

test('derived block memories obey current unit scope and old frozen evidence is rechecked', async t => {
  const h = await setup(t), doc = structuredClone(h.workspace.document);
  const second = structuredClone(doc.units[0]); second.id = 'mechanical_other_unit'; second.scenes[0].id = 'mechanical_other_scene';
  second.scenes[0].blocks[0].id = 'mechanical_other_block'; second.scenes[0].blocks[0].text = 'OUTSIDE_UNIT_PROTOCOL_MARKER';
  doc.units.push(second); doc.profile = createScriptCreationProfile('tv-series', 2, 5);
  h.host.workspaces.saveAuthor({ workspaceId: h.workspace.id, ownerId: 'author', requestId: 'two-units', expectedRevision: 1, expectedEpoch: 1, document: doc });
  h.host.memory.scheduleRebuilds();
  h.host.memory.discover(); h.host.memory.discover();
  for (let index = 0; index < 2; index++) {
    const job = h.host.memory.work.freezeNext()!;
    const label = job.source.range![0].unitId === second.id ? 'outside' : 'inside';
    completeMemoryFixture(h.host, job.id, h.access, job.requestHash!, protocol([{ key: `protocol.${label}`, kind: 'DOMAIN_DERIVED', label, value: label }]));
  }
  const wide = h.host.contexts.listMemories(h.access);
  assert.equal(wide.items.length, 2);
  const frozen = compileContext({ systemInstruction: 'mechanical', skills: [], sections: wide.items.map(memorySection) });
  const oldRef = h.host.contexts.capture(h.access, frozen);
  const receipt = await h.host.commands.submit('author', { kind: 'GOAL_START', requestId: 'memory-narrow-goal', threadId: h.workspace.threadId,
    expectedConversationVersion: 1, source: { kind: 'WORKSPACE', workspaceId: h.workspace.id, expectedRevision: 2 }, objective: 'mechanical review',
    task: 'REVIEW', target: { unitIds: [doc.units[0].id] }, methodIds: [] },
    { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'protocol' }) });
  h.host.authorizations.withAuthorization(receipt.authorizationRef, 'author', 'CONSUME', () => {
    const narrow = h.host.contexts.listMemories(h.access);
    assert.deepEqual(narrow.items.map(item => item.key), ['protocol.inside']);
    assert.throws(() => h.host.contexts.assertVisible(oldRef, h.access), code('MEMORY_SOURCE_RANGE_DENIED'));
  });
  assert.deepEqual(new Set(h.host.contexts.listMemories(h.access).items.map(item => item.key)), new Set(['protocol.inside', 'protocol.outside']));
});

test('copy/return and unconfigured sources never create auxiliary user tasks or call an API', async t => {
  const h = await setup(t, false);
  const thread = h.host.conversations.open('author', 'script:home', 'external-memory-chat');
  const turn = h.host.conversations.accept({ threadId: thread.id, ownerId: 'author', requestId: 'external-chat', expectedVersion: 1,
    requestEnvelope: { text: '保持轻松风格' }, payload: { text: '保持轻松风格' }, capabilityId: 'script.converse', maxInvocations: 1 });
  h.host.conversations.writeResponse(thread.id, turn.turnId, 'author', { text: '已理解你的创作方向' });
  const runId = h.host.conversations.turn(thread.id, turn.turnId, 'author').turn.runId;
  recordChatApiFixture(h.host, runId);
  h.db.prepare("UPDATE agent_invocations SET request_json=json_set(request_json,'$.channel','external') WHERE run_id=?").run(runId);
  assert.equal(h.host.memory.discover(), 0);
  let sends = 0;
  const reopened = createScriptAgentHost(h.db, { sendOnce: async () => { sends++; throw Error('unexpected API'); } }, 'external-memory-restart');
  for (let tick = 0; tick < 3; tick++) assert.equal(await reopened.memory.runOnce(new AbortController().signal), null);
  assert.equal(sends, 0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_memory_work').get() as any).n, 0);
  assert.equal(reopened.conversations.turn(thread.id, turn.turnId, 'author').turn.response?.text, '已理解你的创作方向');
  assert.equal(reopened.workspaces.read(h.workspace.id, 'author').document.units[0].scenes[0].blocks[0].text, '机械协议来源版本一');
});

test('API memory completes automatically without any manual return', async t => {
  const h = await setup(t);
  let sends = 0;
  const host = createScriptAgentHost(h.db, { sendOnce: async request => {
    sends++;
    assert.equal(request.channel, 'api');
    assert.equal(request.routeRef, 'mechanical-memory-api');
    return { text: JSON.stringify({ items: [{ key: 'auto.reference', kind: 'NAVIGATION', label: '自动索引', value: '机械来源线索' }] }),
      provenance: { channel: 'provider', producer: 'MECHANICAL_AUTOMATIC_MEMORY_FIXTURE' } };
  } }, 'api-memory-auto');
  const result = await host.memory.runOnce(new AbortController().signal);
  assert.equal(result?.status, 'DONE');
  assert.equal(sends, 1);
  assert.equal(host.contexts.listMemories(h.access).items[0].content?.value, '机械来源线索');
  await host.memory.runOnce(new AbortController().signal);
  assert.equal(sends, 1);
});

test('legacy manual maintenance retires only unsent work, retaining sources, prompts and completed memories', async t => {
  const h = await setup(t, false);
  const { workspaceSources } = await import('../apps/api/src/agent/scriptMemory');
  const source = workspaceSources(h.workspace, 'external', 'legacy-manual')[0];
  const done = h.host.memory.work.enqueue({ ...source, key: 'legacy.done' });
  const frozenDone = h.host.memory.work.freezeNext()!;
  h.host.memory.work.complete(done.id, h.access, frozenDone.requestHash!, protocol([{ key: 'legacy.note', kind: 'NAVIGATION', label: '保留线索', value: '已提取内容' }]));
  const sent = h.host.memory.work.enqueue({ ...source, key: 'legacy.sent' });
  h.host.memory.work.freezeNext();
  h.db.prepare("UPDATE agent_memory_work SET status='SENT',attempt_id='legacy_attempt' WHERE id=?").run(sent.id);
  const frozen = h.host.memory.work.enqueue({ ...source, key: 'legacy.frozen' });
  const before = h.host.memory.work.freezeNext()!;
  const queued = h.host.memory.work.enqueue({ ...source, key: 'legacy.queued' });
  const host = createScriptAgentHost(h.db, { sendOnce: async () => { throw Error('no send'); } }, 'retire-manual-memory');
  for (const id of [frozen.id, queued.id]) {
    const work = host.memory.work.read(id, h.access);
    assert.equal(work.status, 'CANCELED');
    assert.equal(work.error, 'AUTOMATIC_MEMORY_ONLY');
    assert.equal(work.source.text, source.text);
  }
  assert.deepEqual(host.memory.work.read(frozen.id, h.access).request, before.request);
  assert.equal(host.memory.work.read(frozen.id, h.access).requestHash, before.requestHash);
  assert.equal(host.memory.work.read(sent.id, h.access).status, 'SENT');
  assert.equal(host.memory.work.read(done.id, h.access).status, 'DONE');
  assert.equal(host.contexts.listMemories(h.access).items[0].content?.value, '已提取内容');
  await host.memory.runOnce(new AbortController().signal);
  assert.equal(host.memory.work.read(sent.id, h.access).status, 'SENT');
});
