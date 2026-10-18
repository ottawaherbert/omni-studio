import type Database from 'better-sqlite3';
import { AgentWorker, AgentChildWorker, CapabilityRegistry, ExecutionInvalidated, hashValue, invokeModel, type ModelTransport, type Observation } from '../../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../../packages/agent-sqlite/src';

/** A deterministic document provider, not screenplay generation. Model tests
 * replay the separately attributed Sol fixture only to inject transport faults. */
export function durableFixture(db: InstanceType<typeof Database>, options: { workerId?: string; channel?: 'api' | 'external'; transport?: ModelTransport } = {}) {
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const journal = new SqliteModelJournal(store); journal.ensureSchema();
  db.exec("CREATE TABLE IF NOT EXISTS test_child_documents(id TEXT PRIMARY KEY, revision INTEGER, text TEXT); INSERT OR IGNORE INTO test_child_documents VALUES('document',1,'author-original'); CREATE TABLE IF NOT EXISTS test_child_effects(step_id TEXT PRIMARY KEY, text TEXT); CREATE TABLE IF NOT EXISTS test_child_policy(id INTEGER PRIMARY KEY, allowed INTEGER); INSERT OR IGNORE INTO test_child_policy VALUES(1,1);");
  const registry = new CapabilityRegistry({
    async assertExecution(context) { store.assertExecution(context.execution); },
    async authorize() { if (!(db.prepare('SELECT allowed FROM test_child_policy WHERE id=1').get() as any).allowed) throw new ExecutionInvalidated('CONTEXT_REVOKED', 'Fixture source revoked'); },
  }).register({
    spec: { id: 'document.append', version: '1', implementationDigest: hashValue({ fixture: 'durable-document-v1', channel: options.channel ?? null }), description: 'Deterministic versioned document write', effect: 'WRITE', cost: options.channel ? 'MODEL' : 'NONE', dispatch: 'DURABLE', replay: 'TRANSACTIONAL', input: { jsonSchema: {}, parse: value => {
      const input = value as { text: string; baseRevision?: number }; if (typeof input.text !== 'string') throw new Error('invalid document text'); return input;
    } }, output: { jsonSchema: {}, parse: value => { if (!Number.isInteger((value as any).revision)) throw new Error('invalid receipt revision'); return value; } } },
    async prepare(input) {
      const document = db.prepare("SELECT * FROM test_child_documents WHERE id='document'").get() as any;
      const ref = { uri: 'resource://documents/document', version: String(document.revision), contentHash: hashValue(document), branch: 'workspace:test' };
      return { input: { ...(input as object), baseRevision: document.revision }, sources: [ref], targets: [ref] };
    },
    async execute(call, context) {
      const input = call.request.input as { text: string; baseRevision: number };
      const text = options.channel ? (await invokeModel(journal, options.transport ?? { sendOnce: async () => { throw new Error('No external provider permitted'); } }, context.execution, { operationKey: 'test-generation', channel: options.channel, routeRef: 'fixture-replay:gpt-6-sol', prompt: 'Protocol replay of attributed Sol return; not a new creative generation.' }, context.signal)).text : input.text;
      const observation: Observation = { status: 'SUCCEEDED', summary: 'Document effect committed', data: { revision: input.baseRevision + 1 }, evidence: call.sources, artifacts: [], effectState: 'EFFECT_VERIFIED', retry: 'NEVER' };
      return store.commitStep(context.execution, call.request.callId, observation, () => {
        const updated = db.prepare("UPDATE test_child_documents SET revision=revision+1,text=? WHERE id='document' AND revision=?").run(text, input.baseRevision);
        if (updated.changes !== 1) throw new ExecutionInvalidated('VERSION_CONFLICT', 'Author document changed');
        db.prepare('INSERT INTO test_child_effects(step_id,text) VALUES(?,?)').run(context.execution.stepId!, text);
      });
    },
  });
  const workerId = options.workerId || 'test-worker';
  const worker = new AgentWorker(store, registry, { workerId });
  const childWorker = new AgentChildWorker(store, registry, { workerId: `${workerId}:child` });
  return { store, journal, registry, worker, childWorker };
}
export function durableCommand(requestId = 'durable-1', maxInvocations = 3) {
  return { ownerId: 'owner', scopeId: 'document', kind: 'CAPABILITY' as const, requestId, policyRevision: 'test-policy-v1', maxInvocations, input: { request: { capabilityId: 'document.append', capabilityVersion: '1', callId: 'append', input: { text: 'mechanical-test-value' } } } };
}
