import Database from 'better-sqlite3';
import { AgentSqliteStore } from '../../packages/agent-sqlite/src';
import { preparedFixture, observationFixture } from './agent-store-fixture';

const [filename, workerId, operation] = process.argv.slice(2);
if (!filename || !workerId || !process.send) throw new Error('Isolated test process requires SQLite path and IPC');
const db = new Database(filename);
const store = new AgentSqliteStore(db);
store.ensureSchema();
process.send({ ready: true });
process.on('message', () => {
  const claim = store.claim(workerId, 30000);
  if (claim && operation === 'commit') {
    store.savePrepared(claim.token, preparedFixture(claim.run));
    store.commitStep(claim.token, 'call-1', observationFixture, () => db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(claim.run.id));
  }
  process.send!({ result: claim });
  if (operation !== 'commit') { db.close(); process.disconnect(); }
});
