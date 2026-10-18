import Database from 'better-sqlite3';
import { durableFixture } from './agent-durable-fixture';
const [filename, workerId, operation] = process.argv.slice(2);
if (!filename || !workerId || !process.send) throw new Error('Explicit isolated DB and IPC required');
const db = new Database(filename), h = durableFixture(db, { workerId });
process.send({ ready: true });
process.on('message', async () => {
  try {
    if (operation === 'handoff') { await h.worker.runOnce(); process.send!({ result: h.store.db.prepare('SELECT status,active_step_id FROM agent_runs LIMIT 1').get() }); }
    else if (operation === 'claim') { process.send!({ result: h.store.claimChild(workerId, 30000) }); }
    else if (operation === 'commit') {
      const claim = h.store.claimChild(workerId, 30000)!;
      if (!claim) throw new Error('Child not claimable');
      await h.registry.execute(claim.step.prepared, { ownerId: claim.run.ownerId, scopeId: claim.run.scopeId, commandRevision: String(claim.run.generation), policyRevision: claim.run.policyRevision, execution: claim.token, signal: new AbortController().signal });
      process.send!({ result: { committed: true, stepId: claim.step.id } });
    } else { await h.childWorker.runOnce(); await h.worker.runOnce(); process.send!({ result: h.store.db.prepare('SELECT status FROM agent_runs LIMIT 1').get() }); }
    if (operation !== 'commit') { db.close(); process.disconnect(); }
  } catch (error) { process.send!({ error: String(error) }); db.close(); process.disconnect(); }
});
