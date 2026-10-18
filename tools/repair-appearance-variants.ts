import Database from 'better-sqlite3';
import { buildManualShotPlanHash, buildManualVisualPromptSourceHash, buildManualStoryboardQASourceHash, buildManualVisualPromptHash } from '../src/services/production/manualStoryboard';
import type { Scene, Shot } from '../src/types/project';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanupAppearanceVariants, type AppearanceRetirement } from '../src/services/production/appearanceVariantCleanup';

const quoteIdentifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
function opaqueDatabaseReferences(db: InstanceType<typeof Database>) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).filter(t => !['projects', 'shots', 'episodes', 'scenes'].includes(t.name));
  return tables.flatMap(({ name }) => {
    const columns = (db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string; type: string }>).filter(c => !/BLOB/i.test(c.type));
    if (!columns.length) return [];
    const predicate = columns.map(c => `instr(CAST(${quoteIdentifier(c.name)} AS TEXT), 'appearance-') > 0`).join(' OR ');
    return db.prepare(`SELECT * FROM ${quoteIdentifier(name)} WHERE ${predicate}`).all().map(row => ({ table: name, row }));
  });
}

export function rebaseAppearanceBookkeeping(scene: Scene, before: Shot[], after: Shot[]): Scene {
  const workspace = scene.manualStoryboard;
  const plan = workspace?.shotPlan;
  if (!plan || plan.outputHash !== buildManualShotPlanHash(before)) return scene;
  const nextHash = buildManualShotPlanHash(after);
  if (plan.outputHash === nextHash) return scene;
  const oldSource = buildManualVisualPromptSourceHash(plan.sourceHash, before);
  const newSource = buildManualVisualPromptSourceHash(plan.sourceHash, after);
  const next = { ...workspace, shotPlan: { ...plan, outputHash: nextHash } };
  for (const key of ['imagePrompts', 'videoPrompts', 'visualPrompts'] as const) {
    const record = next[key];
    if (record?.sourceHash === oldSource) next[key] = { ...record, sourceHash: newSource };
  }
  if (next.qa?.sourceHash === buildManualStoryboardQASourceHash(plan.sourceHash, plan.outputHash, buildManualVisualPromptHash(before))) {
    next.qa = { ...next.qa, sourceHash: buildManualStoryboardQASourceHash(plan.sourceHash, nextHash, buildManualVisualPromptHash(after)) };
  }
  // Only live dependency hashes change. Original prompts, QA receipts and audits remain intact.
  return { ...scene, manualStoryboard: next };
}

export async function repairAppearanceVariants(dbPath: string, projectId: string, apply: boolean, reviewed: AppearanceRetirement[] = []) {
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
  try {
    const projectRow = db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId) as { data: string } | undefined;
    if (!projectRow) throw new Error('项目不存在');
    const shotRows = db.prepare('SELECT id, scene_id, data FROM shots WHERE project_id = ? ORDER BY id').all(projectId) as Array<{ id: string; scene_id: string; data: string }>;
    const otherRows = ['episodes', 'scenes'].flatMap(table => db.prepare(`SELECT data FROM ${table} WHERE project_id = ? ORDER BY id`).all(projectId) as Array<{ data: string }>);
    const externalReferences = opaqueDatabaseReferences(db);
    const result = cleanupAppearanceVariants(JSON.parse(projectRow.data), shotRows.map(r => JSON.parse(r.data)), [...otherRows.map(r => JSON.parse(r.data)), ...externalReferences], reviewed);
    const updates = shotRows.flatMap((row, i) => JSON.stringify(JSON.parse(row.data)) === JSON.stringify(result.shots[i]) ? [] : [{ ...row, next: JSON.stringify(result.shots[i]) }]);
    const sceneRows = db.prepare('SELECT id, data FROM scenes WHERE project_id = ? ORDER BY id').all(projectId) as Array<{ id: string; data: string }>;
    const sceneUpdates = sceneRows.flatMap(row => {
      const indices = shotRows.flatMap((s, i) => s.scene_id === row.id ? [i] : []);
      // Shot order is stable on both sides; these hashes require the actual scene order.
      const ordered = db.prepare('SELECT id FROM shots WHERE project_id = ? AND scene_id = ? ORDER BY order_index').all(projectId, row.id) as Array<{ id: string }>;
      const indexes = ordered.map(s => indices.find(i => shotRows[i].id === s.id)!);
      const original = JSON.parse(row.data);
      const next = rebaseAppearanceBookkeeping(original, indexes.map(i => JSON.parse(shotRows[i].data)), indexes.map(i => result.shots[i]));
      return JSON.stringify(original) === JSON.stringify(next) ? [] : [{ ...row, next: JSON.stringify(next) }];
    });
    const report = { projectId, retired: result.retired, skipped: result.skipped, changedShots: updates.length, rebasedScenes: sceneUpdates.length, applied: false, backup: '' };
    if (!apply || !result.retired.length) return report;
    // Snapshot the live database through SQLite (including WAL), before an atomic compare-and-swap.
    const backup = `${dbPath}.appearance-backup-${Date.now()}.sqlite`;
    await db.backup(backup);
    db.transaction(() => {
      const currentProject = db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId) as { data: string };
      const currentShots = db.prepare('SELECT id, scene_id, data FROM shots WHERE project_id = ? ORDER BY id').all(projectId);
      const currentOther = ['episodes', 'scenes'].flatMap(table => db.prepare(`SELECT data FROM ${table} WHERE project_id = ? ORDER BY id`).all(projectId));
      if (currentProject?.data !== projectRow.data || JSON.stringify(currentShots) !== JSON.stringify(shotRows) || JSON.stringify(currentOther) !== JSON.stringify(otherRows) || JSON.stringify(opaqueDatabaseReferences(db)) !== JSON.stringify(externalReferences)) throw new Error('迁移期间项目被修改，已停止；请重新检查');
      db.prepare('UPDATE projects SET data = ? WHERE id = ?').run(JSON.stringify(result.project), projectId);
      const writeShot = db.prepare('UPDATE shots SET data = ? WHERE id = ? AND project_id = ?');
      for (const row of updates) writeShot.run(row.next, row.id, projectId);
      const writeScene = db.prepare('UPDATE scenes SET data = ? WHERE id = ? AND project_id = ?');
      for (const row of sceneUpdates) writeScene.run(row.next, row.id, projectId);
    })();
    fs.writeFileSync(`${backup}.json`, JSON.stringify({ ...report, applied: true, backup }, null, 2));
    return { ...report, applied: true, backup };
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dbPath, projectId, ...flags] = process.argv.slice(2);
  if (!dbPath || !projectId) throw new Error('用法：tsx tools/repair-appearance-variants.ts <数据库> <项目 ID> [--apply] [--plan=已核对的映射.json]；默认只预览');
  const planFile = flags.find(f => f.startsWith('--plan='))?.slice(7);
  const reviewed = planFile ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : [];
  console.log(JSON.stringify(await repairAppearanceVariants(dbPath, projectId, flags.includes('--apply'), reviewed), null, 2));
}
