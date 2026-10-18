import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createScriptAgentHost } from '../../api/src/agent/scriptHost';

// Explicit isolated/host path, no implicit connection to the application's DB.
// API model transport is installed by the host; this CLI accepts durable manual
// returns for now and is used by real-process acceptance.
const filename = process.env.SCRIPT_AGENT_DB;
if (!filename) throw new Error('SCRIPT_AGENT_DB is required; refusing to infer a database');
const db = new Database(filename);
const { worker, childWorker } = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('此 worker 未配置外部模型传输；只接受持久回填'); } }, `script-worker-${randomUUID()}`,
  {trustedLegacyProjectOwner:process.env.SCRIPT_AGENT_TRUSTED_LEGACY_OWNER});
const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM'] as const) process.on(name, () => controller.abort());
process.send?.({ ready: true });
try {
  while (!controller.signal.aborted) {
    if (process.env.SCRIPT_AGENT_ROLE !== 'child') await worker.runOnce(undefined, controller.signal);
    if (process.env.SCRIPT_AGENT_ROLE !== 'coordinator') await childWorker.runOnce(undefined, controller.signal);
    await delay(75, undefined, { signal: controller.signal }).catch(() => {});
  }
} finally { db.close(); }
