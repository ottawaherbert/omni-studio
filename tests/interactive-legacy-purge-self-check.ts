import { db } from '../src/server/db.ts';
import { auditLegacyInteractiveData, executeLegacyPurge } from '../tools/interactive-legacy-purge.ts';

function runPurgeSelfCheck() {
  console.log('[Purge Self-Check] Starting automated purge verification...');

  // 1. Insert dummy linear project
  const linearProjectId = `test_linear_${Date.now()}`;
  db.prepare('INSERT INTO projects (id, title, type, data) VALUES (?, ?, ?, ?)').run(
    linearProjectId,
    'Linear Feature Film',
    'movie',
    JSON.stringify({ id: linearProjectId, title: 'Linear Feature Film', type: 'movie', projectModel: 'linear' })
  );

  const linearEpisodeId = `test_linear_ep_${Date.now()}`;
  db.prepare('INSERT INTO episodes (id, project_id, title, data) VALUES (?, ?, ?, ?)').run(
    linearEpisodeId,
    linearProjectId,
    'Episode 1',
    JSON.stringify({ id: linearEpisodeId, projectId: linearProjectId, title: 'Episode 1' })
  );

  // 2. Insert dummy legacy interactive project
  const legacyProjectId = `test_legacy_interactive_${Date.now()}`;
  db.prepare('INSERT INTO projects (id, title, type, data) VALUES (?, ?, ?, ?)').run(
    legacyProjectId,
    'Legacy FMV Game',
    'interactive',
    JSON.stringify({ id: legacyProjectId, title: 'Legacy FMV Game', type: 'interactive', projectModel: 'interactive' })
  );

  const legacyEpisodeId = `test_legacy_ep_${Date.now()}`;
  db.prepare('INSERT INTO episodes (id, project_id, title, data) VALUES (?, ?, ?, ?)').run(
    legacyEpisodeId,
    legacyProjectId,
    'Node Map 1',
    JSON.stringify({ id: legacyEpisodeId, projectId: legacyProjectId, title: 'Node Map 1', gameData: { nodes: [] } })
  );

  // A modern interactive project may keep its genre/template metadata on the
  // shared project record. That metadata is not a legacy-storage marker and
  // must survive the purge.
  const modernInteractiveProjectId = `test_modern_interactive_${Date.now()}`;
  db.prepare('INSERT INTO projects (id, title, type, data) VALUES (?, ?, ?, ?)').run(
    modernInteractiveProjectId,
    'Modern Interactive Experience',
    'interactive',
    JSON.stringify({
      id: modernInteractiveProjectId,
      title: 'Modern Interactive Experience',
      type: 'interactive',
      projectModel: 'interactive',
      interactiveTemplate: 'investigation',
    })
  );

  // 3. Dry-run test
  const dryRunAudit = auditLegacyInteractiveData();
  if (!dryRunAudit.projectIds.includes(legacyProjectId)) {
    throw new Error('Purge audit failed to detect legacy interactive project in dry-run mode');
  }
  if (dryRunAudit.projectIds.includes(linearProjectId)) {
    throw new Error('Purge audit falsely flagged linear project for deletion');
  }
  if (dryRunAudit.projectIds.includes(modernInteractiveProjectId)) {
    throw new Error('Purge audit falsely flagged a modern interactive project for deletion');
  }

  // 4. Confirmed execution test
  const summary = executeLegacyPurge(true);
  console.log(`[Purge Self-Check] Executed purge transaction. Cleared projects: ${summary.legacyProjectsCount}`);

  // 5. Verify database post-state
  const checkLinear = db.prepare('SELECT id FROM projects WHERE id = ?').get(linearProjectId);
  if (!checkLinear) {
    throw new Error('CRITICAL: Linear project was mistakenly deleted during purge!');
  }

  const checkLegacy = db.prepare('SELECT id FROM projects WHERE id = ?').get(legacyProjectId);
  if (checkLegacy) {
    throw new Error('CRITICAL: Legacy interactive project was NOT purged!');
  }

  const checkModernInteractive = db.prepare('SELECT id FROM projects WHERE id = ?').get(modernInteractiveProjectId);
  if (!checkModernInteractive) {
    throw new Error('CRITICAL: Modern interactive project was mistakenly deleted during purge!');
  }

  // Cleanup dummy linear test project
  db.prepare('DELETE FROM episodes WHERE id = ?').run(linearEpisodeId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(linearProjectId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(modernInteractiveProjectId);

  console.log('[Purge Self-Check] PASSED. Linear data is safe, legacy data successfully purged.');
}

runPurgeSelfCheck();
