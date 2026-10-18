/** Mechanical memory fixtures. These helpers never send to an external model. */
import { randomUUID } from 'node:crypto';
import type { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import type { ScriptWorkspace } from '../apps/api/src/repositories/scriptWorkspaceStore';
import type { ContextAccess } from '../packages/agent-context/src';
import { hashValue, type ModelResult } from '../packages/agent-core/src';

type Host = ReturnType<typeof createScriptAgentHost>;
export async function authorizeMemoryApi(host: Host, workspace: ScriptWorkspace) {
  const requestId = `memory_fixture_${randomUUID()}`;
  const receipt = await host.commands.submit(workspace.ownerId, {
    kind: 'PROPOSE', requestId, threadId: workspace.threadId,
    expectedConversationVersion: host.conversations.read(workspace.threadId, workspace.ownerId).version,
    source: { kind: 'WORKSPACE', workspaceId: workspace.id, expectedRevision: workspace.revision },
    operation: 'concept', instruction: '机械测试通道，不发送创作请求', target: {}, methodIds: [],
  }, { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'api', routeRef: 'mechanical-memory-api' }) });
  const run = host.store.readRun(receipt.runId);
  host.store.control(run.id, run.ownerId, run.version, 'cancel', `${requestId}_cancel`);
}

export function recordChatApiFixture(host: Host, runId: string) {
  const request = { channel: 'api', routeRef: 'mechanical-chat-api', operationKey: 'reply', prompt: 'MECHANICAL_FIXTURE' };
  host.store.db.prepare(`INSERT INTO agent_invocations(id,run_id,input_revision,owner_key,operation_key,status,input_hash,request_json)
    VALUES(?,?,1,'run','reply','RECEIVED',?,?)`).run(`fixture_${randomUUID()}`, runId, hashValue(request), JSON.stringify(request));
}

/** Simulates a returned provider attempt for protocol assertions. Runtime send
 * fencing and daily limits are tested separately with the real runOnce path. */
export function completeMemoryFixture(host: Host, id: string, access: ContextAccess, requestHash: string, result: ModelResult) {
  const work = host.memory.work.read(id, access);
  const attemptId = work.attemptId ?? `fixture_${id}`;
  if (work.status === 'FROZEN' && work.source.channel === 'api')
    host.store.db.prepare("UPDATE agent_memory_work SET status='SENT',attempt_id=? WHERE id=?").run(attemptId, id);
  const done = host.memory.work.complete(id, access, requestHash, result, attemptId);
  host.store.db.prepare('UPDATE agent_memory_work SET updated_at=? WHERE id=?').run(Date.now() - 86_400_001, id);
  return done;
}
