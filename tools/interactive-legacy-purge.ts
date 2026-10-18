import { db } from '../src/server/db.ts';

export interface PurgeSummary {
  legacyProjectsCount: number;
  legacyEpisodesCount: number;
  legacyScenesCount: number;
  legacyRunsCount: number;
  legacyArtifactsCount: number;
  legacyAssetsCount: number;
  clearedGameDataBlobsCount: number;
}

export function auditLegacyInteractiveData(): {
  projectIds: string[];
  episodeIds: string[];
  sceneIds: string[];
  runIds: string[];
  artifactIds: string[];
  assetIds: string[];
  gameDataBlobEpisodeIds: string[];
} {
  // `projectModel: interactive` and `interactiveTemplate` were shared by the
  // retired project editor and by legitimate projects. They describe intent,
  // not storage ownership, so they must never be a destructive-purge signal.
  // The old runtime was identified by its embedded `gameData` episode blob.
  const legacyProjectIdSet = new Set<string>();
  const legacyEpisodeIds: string[] = [];
  const episodes = db.prepare('SELECT id, project_id, data FROM episodes').all() as { id: string; project_id: string; data: string }[];
  for (const ep of episodes) {
    try {
      const parsed = typeof ep.data === 'string' ? JSON.parse(ep.data) : ep.data;
      if (parsed?.gameData) {
        legacyProjectIdSet.add(ep.project_id);
        legacyEpisodeIds.push(ep.id);
      }
    } catch {
      // Ignore invalid JSON.
    }
  }
  const legacyProjectIds = [...legacyProjectIdSet];

  const legacySceneIds: string[] = [];
  const scenes = db.prepare('SELECT id, episode_id FROM scenes').all() as { id: string; episode_id: string }[];
  for (const sc of scenes) {
    if (legacyEpisodeIds.includes(sc.episode_id)) {
      legacySceneIds.push(sc.id);
    }
  }

  const legacyRunIds: string[] = [];
  try {
    const runs = db.prepare('SELECT id, project_id FROM operator_runs').all() as { id: string; project_id: string }[];
    for (const run of runs) {
      if (legacyProjectIds.includes(run.project_id)) {
        legacyRunIds.push(run.id);
      }
    }
  } catch {
    // Table may be missing in lightweight DB
  }

  const legacyArtifactIds: string[] = [];
  try {
    const artifacts = db.prepare('SELECT id, project_id FROM operator_artifacts').all() as { id: string; project_id: string }[];
    for (const art of artifacts) {
      if (legacyProjectIds.includes(art.project_id)) {
        legacyArtifactIds.push(art.id);
      }
    }
  } catch {
    // Table may be missing
  }

  const legacyAssetIds: string[] = [];
  try {
    const assets = db.prepare('SELECT id, project_id FROM operator_registered_assets').all() as { id: string; project_id: string }[];
    for (const ast of assets) {
      if (ast.project_id && legacyProjectIds.includes(ast.project_id)) {
        legacyAssetIds.push(ast.id);
      }
    }
  } catch {
    // Table may be missing
  }

  // A `gameData` blob is the destructive-purge signal itself. Projects that
  // contain one are purged as a unit, so there is no second, broad cleanup
  // pass that can mutate an unrelated project.
  const gameDataBlobEpisodeIds: string[] = [];

  return {
    projectIds: legacyProjectIds,
    episodeIds: legacyEpisodeIds,
    sceneIds: legacySceneIds,
    runIds: legacyRunIds,
    artifactIds: legacyArtifactIds,
    assetIds: legacyAssetIds,
    gameDataBlobEpisodeIds,
  };
}

export function executeLegacyPurge(confirmed: boolean): PurgeSummary {
  const audit = auditLegacyInteractiveData();
  const summary: PurgeSummary = {
    legacyProjectsCount: audit.projectIds.length,
    legacyEpisodesCount: audit.episodeIds.length,
    legacyScenesCount: audit.sceneIds.length,
    legacyRunsCount: audit.runIds.length,
    legacyArtifactsCount: audit.artifactIds.length,
    legacyAssetsCount: audit.assetIds.length,
    clearedGameDataBlobsCount: audit.gameDataBlobEpisodeIds.length,
  };

  if (!confirmed) {
    return summary;
  }

  const purgeTx = db.transaction(() => {
    // Delete legacy scenes
    if (audit.sceneIds.length > 0) {
      const stmt = db.prepare('DELETE FROM scenes WHERE id = ?');
      for (const id of audit.sceneIds) {
        stmt.run(id);
      }
    }

    // Delete legacy episodes
    if (audit.episodeIds.length > 0) {
      const stmt = db.prepare('DELETE FROM episodes WHERE id = ?');
      for (const id of audit.episodeIds) {
        stmt.run(id);
      }
    }

    // Delete legacy runs
    if (audit.runIds.length > 0) {
      try {
        const stmt = db.prepare('DELETE FROM operator_runs WHERE id = ?');
        for (const id of audit.runIds) {
          stmt.run(id);
        }
      } catch {
        // ignore missing table
      }
    }

    // Delete legacy artifacts
    if (audit.artifactIds.length > 0) {
      try {
        const stmt = db.prepare('DELETE FROM operator_artifacts WHERE id = ?');
        for (const id of audit.artifactIds) {
          stmt.run(id);
        }
      } catch {
        // ignore
      }
    }

    // Delete legacy assets
    if (audit.assetIds.length > 0) {
      try {
        const stmt = db.prepare('DELETE FROM operator_registered_assets WHERE id = ?');
        for (const id of audit.assetIds) {
          stmt.run(id);
        }
      } catch {
        // ignore
      }
    }

    // Delete legacy projects
    if (audit.projectIds.length > 0) {
      const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
      for (const id of audit.projectIds) {
        stmt.run(id);
      }
    }

    // Clear leftover gameData from linear episodes
    if (audit.gameDataBlobEpisodeIds.length > 0) {
      const getStmt = db.prepare('SELECT data FROM episodes WHERE id = ?');
      const updateStmt = db.prepare('UPDATE episodes SET data = ? WHERE id = ?');
      for (const id of audit.gameDataBlobEpisodeIds) {
        const row = getStmt.get(id) as { data: string };
        if (row?.data) {
          const parsed = JSON.parse(row.data);
          delete parsed.gameData;
          updateStmt.run(JSON.stringify(parsed), id);
        }
      }
    }
  });

  purgeTx();
  return summary;
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('interactive-legacy-purge.ts')) {
  const confirmed = process.argv.includes('--confirm');
  console.log(`[Interactive Legacy Purge] Executing... Mode: ${confirmed ? 'EXECUTE (CONFIRMED)' : 'DRY-RUN'}`);
  
  const summary = executeLegacyPurge(confirmed);
  console.log('--- PURGE AUDIT SUMMARY ---');
  console.log(`Legacy Projects:  ${summary.legacyProjectsCount}`);
  console.log(`Legacy Episodes:  ${summary.legacyEpisodesCount}`);
  console.log(`Legacy Scenes:    ${summary.legacyScenesCount}`);
  console.log(`Legacy Runs:      ${summary.legacyRunsCount}`);
  console.log(`Legacy Artifacts: ${summary.legacyArtifactsCount}`);
  console.log(`Legacy Assets:    ${summary.legacyAssetsCount}`);
  console.log(`Cleared Blobs:    ${summary.clearedGameDataBlobsCount}`);
  
  if (!confirmed) {
    console.log('\n[NOTICE] Dry-run completed. No database changes were made. Use --confirm to execute purge.');
  } else {
    console.log('\n[SUCCESS] Purge transaction executed successfully.');
  }
}
