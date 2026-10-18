import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentError, hashValue } from '../packages/agent-core/src';
import { compileContext, compileConversationWindow, freezeSkills, memoryRef, memorySection, type ContextAccess, type ContextSection, type Dependency } from '../packages/agent-context/src';
import { AgentSqliteStore, SqliteContextStore } from '../packages/agent-sqlite/src';

const access: ContextAccess = { ownerId: 'author', scopeId: 'document', branch: 'author' };
const ref = (version = '1') => ({ uri: 'resource://documents/manuscript', version, contentHash: hashValue(`version:${version}`), branch: 'author' });
const section = (text = '保留作者完整原文', dependencies: Dependency[] = [], required = true): ContextSection => ({ id: 'body', text, dependencies, required, priority: 100 });
const bundle = (sections: ContextSection[]) => compileContext({ systemInstruction: '完成指定任务', sections, skills: [] });
const code = (value: string) => (error: unknown) => error instanceof AgentError && error.code === value;
function setup(t: any) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const state = { current: '1', allowed: true };
  const contexts = new SqliteContextStore(store, dependency => state.allowed && dependency.ref.contentHash === ref(dependency.ref.version).contentHash && (dependency.freshness === 'EXACT' || dependency.ref.version === state.current));
  contexts.ensureSchema(); return { db, store, contexts, state };
}

test('large instructions, full sources, schema and tools are retained without an application input cap', () => {
  const systemInstruction='系统规则'.repeat(20000), original='剧本原文'.repeat(20000), auxiliary='辅助资料'.repeat(20000);
  const tools=[{description:'工具说明'.repeat(20000)}],outputSchema={description:'返回格式'.repeat(20000)};
  const compiled=compileContext({systemInstruction,sections:[section(original),{...section(auxiliary,[],false),id:'optional'}],skills:[],tools,outputSchema});
  assert.equal(compiled.systemInstruction,systemInstruction);
  assert.equal(compiled.prompt,original+'\n\n'+auxiliary);
  assert.deepEqual(compiled.tools,tools);assert.deepEqual(compiled.outputSchema,outputSchema);
  assert.equal('budget' in compiled,false);assert.equal('omitted' in compiled,false);
});

test('large conversation entries remain intact and revoked history stays excluded', () => {
  const body='完整历史原文'.repeat(12000),current={text:'当前要求'};
  const entries=Array.from({length:3},(_,ordinal)=>({index:{id:String(ordinal),ordinal,status:'COMMITTED',inputChars:body.length,responseChars:0,inputHash:hashValue(body),responseHash:null},
    messages:[{text:body+ordinal}],eligible:true,validate(){if(ordinal===1)throw new AgentError('CONTEXT_REVOKED','来源已撤回');}}));
  const result=compileConversationWindow({current,entries,retrieve:{capabilityId:'read',threadId:'thread',throughTurnId:'turn'},
    compile:window=>compileContext({systemInstruction:'',sections:[section(JSON.stringify(window))],skills:[]})});
  assert.deepEqual(result.selectedIds,['0','2']);assert.deepEqual(result.window.index.unavailableEntryIds,['1']);
  assert.deepEqual(result.window.messages,[{text:body+'0'},{text:body+'2'},current]);
  assert.deepEqual(JSON.parse(result.bundle.prompt),result.window);
});

test('legacy frozen context stays readable with its original digest after restart', t => {
  const {contexts,store}=setup(t);
  const legacy={...bundle([section('旧稿原文')]),budget:{estimatedTokens:3000,budget:48000,estimator:'historical',measurement:'ESTIMATED',actualInputTokens:null},omitted:[]};
  const ref=contexts.capture(access,legacy);
  const restarted=new SqliteContextStore(store,()=>true);restarted.ensureSchema();
  assert.deepEqual(restarted.assertAllowed(ref,access),legacy);
});

test('Skill pins full version/configuration and variables; only explicit SKIP allows whole rule omission', () => {
  const source = { id: 'method', title: '方法', version: '1', content: '保留 {{name}} 的语气。尾部规则不删。', variables: { name: '林夏' }, configuration: { note: '只改一句' }, overflow: 'ERROR' as const };
  const skills = freezeSkills([source]); source.content = '库中新版本';
  const compiled = compileContext({ systemInstruction: '', sections: [section()], skills });
  assert.match(compiled.prompt, /尾部规则不删/); assert.match(compiled.prompt, /林夏/); assert.match(compiled.prompt, /只改一句/);
  assert.equal(compiled.skillTrace[0].status, 'APPLIED');
  assert.equal(compiled.skills[0].version, '1');
  const missing = freezeSkills([{ ...source, content: '{{missing}} 不得改变', variables: {} }]);
  assert.throws(() => compileContext({ systemInstruction: '', sections: [], skills: missing }), code('SKILL_VARIABLE_MISSING'));
  const huge = { ...source, content: '不能删除尾部限制。'.repeat(10000) };
  for(const overflow of ['ERROR','SKIP'] as const){
    const full=compileContext({systemInstruction:'',sections:[],skills:freezeSkills([{...huge,overflow}])});
    assert.equal(full.skillTrace[0].status,'APPLIED');assert.ok(full.prompt.includes(huge.content));
  }
  const missingSkipped=compileContext({systemInstruction:'',sections:[],skills:freezeSkills([{...huge,content:'{{missing}}',overflow:'SKIP'}])});
  assert.equal(missingSkipped.skillTrace[0].reason,'SKILL_VARIABLE_MISSING');

});

test('historical source identity remains valid when current pointer changes; current/empty collection reads invalidate', t => {
  const { contexts, state } = setup(t);
  const historical = contexts.capture(access, bundle([section('历史稿', [{ ref: ref(), freshness: 'EXACT' }])]));
  const current = contexts.capture(access, bundle([section('当前稿', [{ ref: ref(), freshness: 'CURRENT' }])]));
  const empty = contexts.listMemories(access, { query: '还没有的资料' });
  assert.equal(empty.items.length, 0);
  const query = contexts.capture(access, bundle([section('未找到记忆', [{ ref: empty.collection, freshness: 'COLLECTION' }])]));
  state.current = '2';
  assert.equal(contexts.assertAllowed(historical, access).prompt, '历史稿');
  assert.throws(() => contexts.assertAllowed(current, access), code('CONTEXT_SOURCE_INVALID'));
  contexts.createMemory(access, 'author', 'new-memory', { key: 'author.note', kind: 'AUTHOR_PREFERENCE', content: { label: '还没有的资料', value: '现在新增了' }, dependencies: [] });
  assert.throws(() => contexts.assertAllowed(query, access), code('MEMORY_COLLECTION_CHANGED'));
});

test('memory provenance/review are separate; derived chains revalidate source and cannot cross workspace/owner', t => {
  const { contexts, state } = setup(t);
  const first = contexts.createMemory(access, 'model', 'derived', { key: 'derived.summary', kind: 'DOMAIN_DERIVED', content: { label: '提取', value: '待核验的派生结论' }, dependencies: [{ ref: ref(), freshness: 'CURRENT' }] });
  const memory = contexts.getMemory(first.id, access);
  assert.equal(memory.origin, 'MODEL_DERIVED'); assert.equal(memory.review, 'AUTO_ACCEPTED');
  const next = contexts.createMemory(access, 'model', 'navigation', { key: 'navigation.note', kind: 'NAVIGATION', content: { label: '导航', value: '仅作为查找线索' }, dependencies: [{ ref: memoryRef(memory), freshness: 'CURRENT' }] });
  const frozen = contexts.capture(access, bundle([memorySection(contexts.getMemory(next.id, access))]));
  assert.throws(() => contexts.getMemory(first.id, { ...access, branch: 'workspace:other' }), code('MEMORY_NOT_FOUND'));
  assert.throws(() => contexts.assertAllowed(frozen, { ...access, ownerId: 'other' }), code('CONTEXT_NOT_FOUND'));
  state.current = '2';
  assert.equal(contexts.listMemories(access).items.length, 0);
  assert.equal(contexts.listMemories(access).excluded.length, 2);
  assert.throws(() => contexts.assertAllowed(frozen, access), code('CONTEXT_SOURCE_INVALID'));
});

test('forget retains a content-free tombstone, fences old prompts, and cannot be undone by old command replay', t => {
  const { contexts, db } = setup(t);
  const input = { key: 'author.preference', kind: 'AUTHOR_PREFERENCE' as const, content: { label: '作者偏好', value: '需要忘记的私人习惯' }, dependencies: [] };
  const receipt = contexts.createMemory(access, 'author', 'remember', input);
  const frozen = contexts.capture(access, bundle([memorySection(contexts.getMemory(receipt.id, access))]));
  const removed = contexts.updateMemory(access, 'forget', receipt.id, 1, 'DELETE');
  assert.deepEqual(contexts.updateMemory(access, 'forget', receipt.id, 1, 'DELETE'), removed);
  assert.deepEqual(contexts.createMemory(access, 'author', 'remember', input), receipt);
  assert.equal(contexts.getMemory(receipt.id, access).content, null);
  assert.throws(() => contexts.updateMemory(access, 'restore', receipt.id, 2, 'ENABLE'), code('MEMORY_DELETED'));
  assert.throws(() => contexts.assertAllowed(frozen, access), code('CONTEXT_REVOKED'));
  assert.deepEqual(contexts.view(frozen, access), { ref: frozen, redacted: true, reason: 'CONTEXT_REVOKED' });
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_memory_commands').all()).includes(input.content.value), false);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_memories').all()).includes(input.content.value), false);
});

test('explicit author correction replaces derived trust but cannot leave old snapshots consumable', t => {
  const { contexts } = setup(t);
  const created = contexts.createMemory(access, 'model', 'derived', { key: 'derived.fact', kind: 'DOMAIN_DERIVED', content: { label: '提取', value: '未核验的记忆' }, dependencies: [{ ref: ref(), freshness: 'EXACT' }] });
  const snapshot = contexts.capture(access, bundle([memorySection(contexts.getMemory(created.id, access))]));
  contexts.updateMemory(access, 'correct', created.id, 1, 'CORRECT', { label: '作者纠正', value: '作者明确补充的内容' });
  const corrected = contexts.getMemory(created.id, access);
  assert.equal(corrected.origin, 'AUTHOR_STATED'); assert.equal(corrected.review, 'HUMAN_REVIEWED');
  assert.throws(() => contexts.assertAllowed(snapshot, access), code('CONTEXT_REVOKED'));
  assert.equal(contexts.listMemories(access).items[0].content!.value, '作者明确补充的内容');
});

test('scope revocation blocks old snapshot even when all source hashes still match', t => {
  const { contexts } = setup(t);
  const snapshot = contexts.capture(access, bundle([section()]));
  contexts.revokeScope(access);
  assert.throws(() => contexts.assertAllowed(snapshot, access), code('CONTEXT_REVOKED'));
});

test('source events persist transitive invalidation/rebuild work; rebuilding cannot revive forgotten memory', t => {
  const { contexts, state } = setup(t);
  const first = contexts.createMemory(access, 'model', 'source', { key: 'derived.first', kind: 'DOMAIN_DERIVED', content: { label: '首层', value: '派生索引占位，不是模型产出' }, dependencies: [{ ref: ref(), freshness: 'CURRENT' }] });
  const second = contexts.createMemory(access, 'model', 'second', { key: 'derived.second', kind: 'NAVIGATION', content: { label: '次层', value: '依赖首层的导航' }, dependencies: [{ ref: memoryRef(contexts.getMemory(first.id, access)), freshness: 'CURRENT' }] });
  state.current = '2';
  assert.deepEqual(new Set(contexts.invalidateSources(access.scopeId)), new Set([first.id, second.id]));
  assert.equal(contexts.pendingRebuilds(access).length, 2);
  contexts.rebuildMemory(access, 'rebuild', first.id, 2, { content: { label: '更新索引', value: '绑定 v2 的机械协议样本' }, dependencies: [{ ref: ref('2'), freshness: 'CURRENT' }] });
  assert.equal(contexts.getMemory(first.id, access).review, 'AUTO_ACCEPTED');
  assert.equal(contexts.pendingRebuilds(access).length, 1);
  contexts.updateMemory(access, 'forget', second.id, 2, 'DELETE');
  assert.equal(contexts.pendingRebuilds(access).length, 0);
  assert.throws(() => contexts.rebuildMemory(access, 'late-rebuild', second.id, 3, { content: { label: '旧结果', value: '不能复活' }, dependencies: [{ ref: ref('2'), freshness: 'EXACT' }] }), code('MEMORY_REBUILD_DENIED'));
});

test('query dependencies ignore unrelated kinds but detect effective membership changes without a memory write', t => {
  const { contexts, state } = setup(t);
  const preference = contexts.createMemory(access, 'author', 'pref', { key: 'author.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '偏好', value: '机械协议样本' }, dependencies: [] });
  const query = contexts.listMemories(access, { kind: 'AUTHOR_PREFERENCE' });
  const derived = contexts.createMemory(access, 'model', 'navigation-query', { key: 'derived.navigation', kind: 'NAVIGATION', content: { label: '索引', value: '偏好索引占位' }, dependencies: [{ ref: query.collection, freshness: 'COLLECTION' }, { ref: memoryRef(contexts.getMemory(preference.id, access)), freshness: 'CURRENT' }] });
  assert.equal(contexts.listMemories(access, { kind: 'NAVIGATION' }).items[0].id, derived.id);
  contexts.createMemory(access, 'model', 'domain-query', { key: 'derived.domain', kind: 'DOMAIN_DERIVED', content: { label: '观察', value: '绑定当前来源' }, dependencies: [{ ref: ref(), freshness: 'CURRENT' }] });
  const domain = contexts.listMemories(access, { kind: 'DOMAIN_DERIVED' });
  const snapshot = contexts.capture(access, bundle([section('集合有一个有效成员', [{ ref: domain.collection, freshness: 'COLLECTION' }])]));
  state.current = '2';
  assert.equal(contexts.listMemories(access, { kind: 'DOMAIN_DERIVED' }).items.length, 0);
  assert.throws(() => contexts.assertAllowed(snapshot, access), code('MEMORY_COLLECTION_CHANGED'));
  assert.equal(contexts.view(snapshot, access).redacted, false);
  state.allowed = false;
  assert.equal(contexts.view(snapshot, access).redacted, true);
});

test('historical prompt keeps frozen recursive memory evidence after automatic invalidation/rebuild, but respects source revocation', t => {
  const { contexts, state } = setup(t);
  const first = contexts.createMemory(access, 'model', 'derived', { key: 'derived.first', kind: 'DOMAIN_DERIVED', content: { label: 'v1提取', value: '历史来源的索引占位' }, dependencies: [{ ref: ref(), freshness: 'CURRENT' }] });
  const second = contexts.createMemory(access, 'model', 'navigation', { key: 'derived.second', kind: 'NAVIGATION', content: { label: '导航', value: '历史索引' }, dependencies: [{ ref: memoryRef(contexts.getMemory(first.id, access)), freshness: 'CURRENT' }] });
  const snapshot = contexts.capture(access, bundle([memorySection(contexts.getMemory(second.id, access))]));
  state.current = '2';
  assert.equal(contexts.view(snapshot, access).redacted, false);
  contexts.invalidateSources(access.scopeId);
  assert.equal(contexts.view(snapshot, access).redacted, false);
  contexts.rebuildMemory(access, 'rebuild', first.id, 2, { content: { label: 'v2', value: '新索引' }, dependencies: [{ ref: ref('2'), freshness: 'CURRENT' }] });
  assert.equal(contexts.view(snapshot, access).redacted, false);
  assert.throws(() => contexts.assertAllowed(snapshot, access), code('MEMORY_STALE'));
  state.allowed = false;
  assert.equal(contexts.view(snapshot, access).redacted, true);
});

test('query-only dependency notices member expiry even without an invalidation event', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { contexts } = setup(t);
  contexts.createMemory(access, 'author', 'temporary', { key: 'temporary.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '临时', value: '过期协议样本' }, dependencies: [], expiresAt: 2000 });
  const query = contexts.listMemories(access);
  const snapshot = contexts.capture(access, bundle([section('有一个有效成员', [{ ref: query.collection, freshness: 'COLLECTION' }])]));
  t.mock.timers.tick(1001);
  assert.throws(() => contexts.assertAllowed(snapshot, access), code('MEMORY_COLLECTION_CHANGED'));
  assert.equal(contexts.view(snapshot, access).redacted, false);
});

test('self-referential query outputs are rejected atomically; twenty acyclic query layers stay bounded', t => {
  const { contexts, db } = setup(t);
  contexts.createMemory(access, 'author', 'root', { key: 'author.root', kind: 'AUTHOR_PREFERENCE', content: { label: 'entry-00:', value: '非创作协议占位' }, dependencies: [] });
  const all = contexts.listMemories(access);
  assert.throws(() => contexts.createMemory(access, 'model', 'cycle', { key: 'derived.cycle', kind: 'NAVIGATION', content: { label: 'self', value: '不能依赖包含自身的全集' }, dependencies: [{ ref: all.collection, freshness: 'COLLECTION' }] }), code('MEMORY_DEPENDENCY_CYCLE'));
  assert.equal((db.prepare('SELECT count(*) AS n FROM agent_memories').get() as any).n, 1);
  assert.equal((db.prepare('SELECT count(*) AS n FROM agent_memory_commands').get() as any).n, 1);
  const started = performance.now();
  for (let i = 1; i <= 20; i++) {
    const previous = `entry-${String(i - 1).padStart(2, '0')}:`, label = `entry-${String(i).padStart(2, '0')}:`;
    const query = contexts.listMemories(access, { query: previous });
    assert.equal(query.items.length, 1);
    contexts.createMemory(access, 'model', `layer-${i}`, { key: `derived.layer${i}`, kind: 'NAVIGATION', content: { label, value: '非创作依赖图协议占位' }, dependencies: [{ ref: query.collection, freshness: 'COLLECTION' }] });
    assert.equal(contexts.listMemories(access).items.length, i + 1);
  }
  assert.ok(performance.now() - started < 3000, 'normal acyclic dependencies must not block the API for seconds');
});
