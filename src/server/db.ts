import { appearanceSourceHash } from "../services/production/productionAppearance";
import Database from 'better-sqlite3';
import { previewUnusedMedia, quarantineUnusedMedia, restoreRecycledMedia } from './media/mediaGarbageCollection';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  AI_CONFIG_SCHEMA_VERSION,
  AIConfigSnapshot,
  defaultAIConfig,
  normalizeAIConfig,
} from '../config/aiConfigDefaults';
import {
  appendOperatorEvent,
  createOperatorRunRecord,
  mergeOperatorRunPatch,
} from '../services/operator/runs';
import {
  appendOperatorArtifactQAVerdict,
  createOperatorArtifact,
  createOperatorRegisteredAsset,
  markOperatorArtifactCommitted,
} from '../services/operator/artifacts';
import {
  OperatorArtifactEnvelope,
  OperatorRegisteredAsset,
  OperatorRun,
} from '../services/operator/types';
import { quarantineLegacyDemoProjectData } from '../services/legacy/legacyDemoAssets';
import {
  buildManualImagePromptHash,
  buildManualShotPlanHash,
  buildManualVideoPromptHash,
  buildManualVisualPromptHash,
  buildManualVisualPromptSourceHash,
} from '../services/production/manualStoryboard';
import { productionAssetDepartmentOutputSourceHash } from '../services/production/productionAssetPreparation';
import { listManualStudioEligiblePriorVideoReferences } from '../services/production/manualStudioReferenceCandidates';
import { buildProductionSceneContext } from '../services/production/productionSceneContext';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OMNI_WORKSPACE = path.join(__dirname, '..', '..', 'OMNI_Workspace');
// Domain regression suites use an isolated SQLite file. Production keeps the
// workspace default unless an explicit path is supplied by the process owner.
const DB_PATH = process.env.OMNI_DB_PATH || path.join(OMNI_WORKSPACE, 'omni.db');

// Ensure workspace directory exists
const DB_DIRECTORY = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIRECTORY)) {
  fs.mkdirSync(DB_DIRECTORY, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const assertProductionEntityOwner = (
  table: "episodes" | "scenes" | "shots",
  id: string,
  owner: { project_id: string; episode_id?: string; scene_id?: string },
) => {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (existing && Object.entries(owner).some(([key, value]) => existing[key] !== value)) {
    const label = table === "episodes" ? "分集" : table === "scenes" ? "场景" : "镜头";
    const error = new Error(`${label}标识 ${id} 已属于其他作品或内容位置。复制内容时请使用新的标识，原内容未被修改。`);
    Object.assign(error, { statusCode: 409 });
    throw error;
  }
};

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT,
    type TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    data JSON
  );
  
  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT,
    production_revision INTEGER NOT NULL DEFAULT 0,
    data JSON,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    episode_id TEXT,
    project_id TEXT,
    scene_number TEXT,
    title TEXT,
    data JSON,
    FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shots (
    id TEXT PRIMARY KEY,
    scene_id TEXT,
    episode_id TEXT,
    project_id TEXT,
    data JSON,
    FOREIGN KEY(scene_id) REFERENCES scenes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_analysis_projects (
    id TEXT PRIMARY KEY,
    title TEXT,
    type TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    data JSON
  );

  CREATE TABLE IF NOT EXISTS video_analysis_segments (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    data JSON,
    FOREIGN KEY(project_id) REFERENCES video_analysis_projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS production_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    project_title TEXT,
    mode TEXT,
    status TEXT,
    revision INTEGER DEFAULT 0,
    updated_at INTEGER,
    data JSON
  );

  CREATE TABLE IF NOT EXISTS ai_config (
    id TEXT PRIMARY KEY,
    updated_at INTEGER,
    data JSON
  );

  CREATE TABLE IF NOT EXISTS operator_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    provider TEXT,
    status TEXT,
    updated_at INTEGER,
    data JSON,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS operator_artifacts (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    run_id TEXT,
    kind TEXT,
    status TEXT,
    updated_at INTEGER,
    data JSON,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS operator_assets (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    run_id TEXT,
    artifact_id TEXT,
    kind TEXT,
    updated_at INTEGER,
    data JSON,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  /*
   * Formal production screenplay revisions are deliberately kept outside the
   * general project JSON blob. This keeps the source-of-truth addressable by
   * project, makes its revision check transactional, and lets workspace reads
   * later load only the current screenplay revision.
   */
  CREATE TABLE IF NOT EXISTS production_script_workspaces (
    project_id TEXT PRIMARY KEY,
    current_revision_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    data JSON NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS production_script_workspaces_updated_at_idx
    ON production_script_workspaces(updated_at DESC);
`);

// Schema migrations to support manual reordering (AUDIT-0001, AUDIT-0002)
try {
  db.exec("ALTER TABLE episodes ADD COLUMN order_index INTEGER DEFAULT 0;");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE episodes ADD COLUMN production_revision INTEGER NOT NULL DEFAULT 0;");
} catch (e) {
  // Column already exists
}

try {
  db.exec("ALTER TABLE production_runs ADD COLUMN revision INTEGER DEFAULT 0;");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE scenes ADD COLUMN order_index INTEGER DEFAULT 0;");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE shots ADD COLUMN order_index INTEGER DEFAULT 0;");
} catch (e) {
  // Column already exists
}

type StoredProductionScriptWorkspace = {
  currentRevisionId?: string;
  revisions?: Array<{ id?: string; revision?: number; units?: Array<Record<string, unknown>> }>;
  updatedAt?: number;
};

// Workspace shells are read on every preparation navigation. Retain the
// current screenplay as the editable source, but defer old full bodies until
// the author explicitly opens version history. This prevents a long project
// from serializing every past full script on a simple page switch.
const productionScriptWorkspaceShell = (
  workspace: StoredProductionScriptWorkspace | undefined,
  sourceDocumentId?: string,
) => {
  if (!workspace?.currentRevisionId || !Array.isArray(workspace.revisions)) return workspace;
  return {
    ...workspace,
    revisions: workspace.revisions.map((revision) => ({
      ...revision,
      units: revision.units?.map((unit) => ({
        ...unit,
        // Navigation needs only one screenplay body. A requested unit remains
        // editable; every other current unit and all historical versions are
        // hydrated on demand through the dedicated unit/history reads.
        content: revision.id === workspace.currentRevisionId && unit.sourceDocumentId === sourceDocumentId
          ? unit.content
          : "",
        __scriptBodyDeferred: !(revision.id === workspace.currentRevisionId && unit.sourceDocumentId === sourceDocumentId),
      })),
    })),
  };
};

const projectDataForWorkspaceShell = <T extends Record<string, any>>(data: T, sourceDocumentId?: string): T => data.productionScriptWorkspace
  ? {
    ...data,
    productionScriptWorkspace: productionScriptWorkspaceShell(data.productionScriptWorkspace, sourceDocumentId),
    // The editable canonical script above is the active source. Keeping a
    // second full copy in source documents turns a long project into a large
    // double payload on every preparation navigation.
    productionSourceDocuments: Array.isArray(data.productionSourceDocuments)
      ? data.productionSourceDocuments.map((document: Record<string, unknown>) => ({
        ...document,
        content: document.id === sourceDocumentId ? document.content : "",
        __scriptBodyDeferred: document.id !== sourceDocumentId,
      }))
      : data.productionSourceDocuments,
  }
  : data;

const persistedProductionScriptWorkspace = (projectId: string) => {
  const row = db.prepare('SELECT data FROM production_script_workspaces WHERE project_id = ?').get(projectId) as { data?: string } | undefined;
  if (!row?.data) return undefined;
  try {
    return JSON.parse(row.data) as StoredProductionScriptWorkspace;
  } catch {
    return undefined;
  }
};

const hasDeferredProductionScriptBodies = (workspace: StoredProductionScriptWorkspace | undefined) =>
  Boolean(workspace?.revisions?.some((revision) => revision.units?.some((unit) => unit.__scriptBodyDeferred === true)));

const hasDeferredProductionSourceBodies = (documents: unknown) =>
  Array.isArray(documents) && documents.some((document) => Boolean((document as Record<string, unknown>).__scriptBodyDeferred));

const restoreDeferredProductionSourceBodies = (
  incomingDocuments: unknown,
  existingDocuments: unknown,
) => {
  if (!Array.isArray(incomingDocuments)) return undefined;
  const existingById = new Map(
    (Array.isArray(existingDocuments) ? existingDocuments : [])
      .map((document) => [String((document as Record<string, unknown>).id || ""), document as Record<string, unknown>]),
  );
  return incomingDocuments.map((rawDocument) => {
    const document = rawDocument as Record<string, unknown>;
    const { __scriptBodyDeferred: deferred, ...documentData } = document;
    if (deferred !== true) return documentData;
    const existing = existingById.get(String(document.id || ""));
    if (!existing) {
      const error = new Error("延迟加载的正式剧本正文已失去持久化基线，请重新读取项目后再保存。");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    return { ...documentData, content: existing.content };
  });
};

const projectDataWithProductionScriptWorkspace = <T extends Record<string, any>>(projectId: string, data: T): T & {
  productionScriptWorkspace?: StoredProductionScriptWorkspace;
} => {
  const persisted = persistedProductionScriptWorkspace(projectId);
  return persisted ? { ...data, productionScriptWorkspace: persisted } : data;
};

const saveProductionScriptWorkspaceRecord = (projectId: string, workspace: StoredProductionScriptWorkspace) => {
  const currentRevision = workspace.revisions?.find((item) => item?.id === workspace.currentRevisionId);
  db.prepare(`
    INSERT INTO production_script_workspaces (project_id, current_revision_id, revision, updated_at, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      current_revision_id=excluded.current_revision_id,
      revision=excluded.revision,
      updated_at=excluded.updated_at,
      data=excluded.data
  `).run(
    projectId,
    workspace.currentRevisionId || "",
    Number(currentRevision?.revision || 0),
    Number(workspace.updatedAt || Date.now()),
    JSON.stringify(workspace),
  );
};

// One-time compatibility migration. Older projects may still carry the
// screenplay workspace in projects.data; the dedicated record becomes primary
// without dropping the legacy copy during startup.
for (const row of db.prepare('SELECT id, data FROM projects').all() as Array<{ id: string; data?: string }>) {
  if (persistedProductionScriptWorkspace(row.id)) continue;
  try {
    const legacy = JSON.parse(row.data || '{}') as { productionScriptWorkspace?: StoredProductionScriptWorkspace };
    if (legacy.productionScriptWorkspace?.currentRevisionId) {
      saveProductionScriptWorkspaceRecord(row.id, legacy.productionScriptWorkspace);
    }
  } catch {
    // Existing project parsing keeps its historical behavior; a bad legacy row
    // must not prevent the server from starting.
  }
}


export function ensureDeepMigration() {
  // Find episodes where scenes might still be packed inside JSON data
  const episodes = db.prepare('SELECT id, project_id, data FROM episodes').all() as any[];
  for (const ep of episodes) {
    const data = JSON.parse(ep.data);
    if (data.scenes && Array.isArray(data.scenes)) {
       // We have scenes hidden in the data!
       const { scenes, ...restData } = data;
       
       // Update the episode data to remove scenes
       db.prepare('UPDATE episodes SET data = ? WHERE id = ?').run(JSON.stringify(restData), ep.id);
       
       // Insert scenes
       const upsertScene = db.prepare(`
         INSERT OR IGNORE INTO scenes (id, episode_id, project_id, scene_number, title, data) 
         VALUES (?, ?, ?, ?, ?, ?)
       `);
       const upsertShot = db.prepare(`
         INSERT OR IGNORE INTO shots (id, scene_id, episode_id, project_id, data) 
         VALUES (?, ?, ?, ?, ?)
       `);
       
       for (const sc of scenes) {
         const { id: scId, sceneNumber, title: scTitle, shots, ...scData } = sc;
         const finalScId = scId || `sc_${Date.now()}_${Math.random()}`;
         upsertScene.run(finalScId, ep.id, ep.project_id, sceneNumber || '', scTitle || 'Untitled', JSON.stringify(scData));
         
         if (Array.isArray(shots)) {
           for (const sh of shots) {
             const { id: shId, ...shData } = sh;
             const finalShId = shId || `sh_${Date.now()}_${Math.random()}`;
             upsertShot.run(finalShId, finalScId, ep.id, ep.project_id, JSON.stringify(shData));
           }
         }
       }
       console.log(`[DB] Deep migrated episode ${ep.id} to standalone scenes and shots.`);
    }
  }
}

export function runMigrationsFromFiles(moviesDataPath: string) {
  if (!fs.existsSync(moviesDataPath)) return;
  const files = fs.readdirSync(moviesDataPath);
  let migratedCount = 0;
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(moviesDataPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const project = JSON.parse(content);
        const { id, title, type, episodes, ...restData } = project;
        
        // Insert project
        const insertProject = db.prepare('INSERT OR IGNORE INTO projects (id, title, type, data) VALUES (?, ?, ?, ?)');
        insertProject.run(id, title || 'Untitled', type || 'movie', JSON.stringify(restData));

        // Insert episodes
        if (Array.isArray(episodes)) {
          const insertEpisode = db.prepare('INSERT OR IGNORE INTO episodes (id, project_id, title, data) VALUES (?, ?, ?, ?)');
          for (const ep of episodes) {
            insertEpisode.run(ep.id, id, ep.title || 'Untitled', JSON.stringify(ep));
          }
        }
        
        // Move file out to indicate migration
        fs.renameSync(filePath, `${filePath}.migrated`);
        migratedCount++;
      } catch (e) {
        console.error(`Failed to migrate ${file}:`, e);
      }
    }
  }
  if (migratedCount > 0) {
    console.log(`[DB] Successfully migrated ${migratedCount} projects from JSON files to SQLite.`);
  }
}

const episodeMetadataRows = (projectId?: string) => {
  const where = projectId ? 'WHERE e.project_id = ?' : '';
  const statement = db.prepare(`
    SELECT
      e.id,
      e.project_id,
      e.title,
      e.order_index,
      e.production_revision,
      json_extract(e.data, '$.sourceWritingUnitId') AS source_writing_unit_id,
      json_extract(e.data, '$.sourceDocumentId') AS source_document_id,
      json_extract(e.data, '$.inspiration') AS inspiration,
      json_extract(e.data, '$.arcId') AS arc_id,
      json_extract(e.data, '$.targetDuration') AS target_duration,
      json_extract(e.data, '$.creativeDirection') AS creative_direction,
      COUNT(s.id) AS scene_count
    FROM episodes e
    LEFT JOIN scenes s ON s.episode_id = e.id
    ${where}
    GROUP BY e.id
    ORDER BY e.project_id ASC, e.order_index ASC
  `);
  return (projectId ? statement.all(projectId) : statement.all()) as any[];
};

const episodeMetadata = (row: any) => ({
  id: row.id,
  productionRevision: Number(row.production_revision || 0),
  title: row.title || '',
  inspiration: row.inspiration || '',
  ...(row.creative_direction ? { creativeDirection: JSON.parse(row.creative_direction) } : {}),
  ...(row.source_writing_unit_id ? { sourceWritingUnitId: row.source_writing_unit_id } : {}),
  ...(row.source_document_id ? { sourceDocumentId: row.source_document_id } : {}),
  ...(row.arc_id ? { arcId: row.arc_id } : {}),
  ...(row.target_duration != null ? { targetDuration: Number(row.target_duration) } : {}),
  sceneCount: Number(row.scene_count || 0),
});

const visibleEpisodeMetadataRows = (projectId: string, projectData: any) => {
  const rows = episodeMetadataRows(projectId);
  const workspace = projectData?.productionScriptWorkspace;
  const currentRevision = workspace?.revisions?.find((revision: any) => revision?.id === workspace?.currentRevisionId);
  const activeDocumentIds = new Set((currentRevision?.units || [])
    .filter((unit: any) => unit?.status === "current" && unit?.sourceDocumentId)
    .map((unit: any) => String(unit.sourceDocumentId)));
  if (!activeDocumentIds.size) return rows;
  // Episode records are preserved for audit and possible restoration. The
  // production workspace only lists active screenplay work ranges.
  return rows.filter((row) => !row.source_document_id || activeDocumentIds.has(String(row.source_document_id)));
};

const projectListEpisodeMetadata = (row: any) => {
  const metadata = episodeMetadata(row);
  return {
    id: metadata.id,
    title: metadata.title,
    ...(metadata.sourceWritingUnitId ? { sourceWritingUnitId: metadata.sourceWritingUnitId } : {}),
    ...(metadata.sourceDocumentId ? { sourceDocumentId: metadata.sourceDocumentId } : {}),
    sceneCount: metadata.sceneCount,
  };
};

const adoptedSceneSnapshotForEpisode = (projectData: any, episode: any) => {
  const sourceDocumentId = episode?.sourceDocumentId;
  if (!sourceDocumentId || !Array.isArray(projectData?.productionScenePlans)) return [];
  const adoptedPlan = projectData.productionScenePlans
    .filter((plan: any) => (
      plan?.sourceDocumentId === sourceDocumentId
      && plan?.status === 'adopted'
      && Array.isArray(plan?.adoptedSceneSnapshot)
    ))
    .sort((left: any, right: any) => Number(right?.adoptedAt || 0) - Number(left?.adoptedAt || 0))[0];
  return adoptedPlan?.adoptedSceneSnapshot || [];
};

const projectListData = (data: any) => {
  const snapshot = data?.productionSourceSnapshot;
  return {
    domain: data?.domain,
    interactiveExperienceId: data?.interactiveExperienceId,
    projectModel: data?.projectModel,
    productionMode: data?.productionMode,
    targetScale: data?.targetScale,
    lockStrategy: data?.lockStrategy,
    styleVariantPolicy: data?.styleVariantPolicy,
    interactiveTemplate: data?.interactiveTemplate,
    interactiveConfig: data?.interactiveConfig,
    aspectRatio: data?.aspectRatio,
    durationMinutes: data?.durationMinutes,
    logline: data?.logline,
    coreConflict: data?.coreConflict,
    targetEpisodeCount: data?.targetEpisodeCount,
    creativeVision: data?.creativeVision,
    isFromAdaptation: Boolean(data?.isFromAdaptation),
    productionTrashedAt: data?.productionTrashedAt,
    updatedAt: data?.updatedAt,
    characters: Array.isArray(data?.characters)
      ? data.characters.map((character: any) => ({ id: character.id, name: character.name }))
      : [],
    assets: Array.isArray(data?.assets)
      ? data.assets.map((asset: any) => ({ id: asset.id, name: asset.name, type: asset.type }))
      : [],
    ...(snapshot ? {
      productionSourceSnapshot: {
        schemaVersion: snapshot.schemaVersion,
        sourceType: snapshot.sourceType,
        sourceWritingProjectId: snapshot.sourceWritingProjectId,
        sourceExportedAt: snapshot.sourceExportedAt,
        sourceHash: snapshot.sourceHash,
        importId: snapshot.importId,
        importedAt: snapshot.importedAt,
      },
    } : {}),
  };
};

const productionWorkspaceAssetRegistry = (registry: any) => {
  if (!registry) return registry;
  return {
    schemaVersion: registry.schemaVersion,
    approvals: registry.approvals || [],
    references: registry.references || [],
    pendingReferences: registry.pendingReferences || [],
    variants: [],
    profileRevisions: (registry.profileRevisions || []).map((revision: any) => ({
      assetId: revision.assetId,
      assetType: revision.assetType,
    })),
    preparationBatches: (registry.preparationBatches || []).map((batch: any) => ({
      id: batch.id,
      episodeIds: batch.episodeIds,
      sourceHash: batch.sourceHash,
      decisions: (batch.decisions || []).map((decision: any) => ({
        sceneId: decision.sceneId,
        assetId: decision.assetId,
        assetType: decision.assetType,
        use: decision.use,
        variantId: decision.variantId,
      })),
      updatedAt: batch.updatedAt,
    })),
    updatedAt: registry.updatedAt,
  };
};

const stripManualStoryboardPromptBodies = (manualStoryboard: any) => {
  if (!manualStoryboard) return manualStoryboard;
  const stripRecord = (record: any) => {
    if (!record?.audit) return record;
    const { confirmedPrompt: _confirmedPrompt, ...audit } = record.audit;
    return { ...record, audit };
  };
  const {
    visualPrompts: _legacyVisualPrompts,
    qa: _legacyAggregateQA,
    ...currentStoryboard
  } = manualStoryboard;
  return {
    ...currentStoryboard,
    shotPlan: stripRecord(manualStoryboard.shotPlan),
    imagePrompts: stripRecord(manualStoryboard.imagePrompts),
    videoPrompts: stripRecord(manualStoryboard.videoPrompts),
  };
};

const workspaceStoryboardIndex = (manualStoryboard: any) => {
  const stripped = stripManualStoryboardPromptBodies(manualStoryboard);
  if (!stripped) return stripped;
  const {
    boards: _boards,
    batchAudits: _batchAudits,
    ...index
  } = stripped;
  return {
    ...index,
    __workspaceStoryboardIndex: true,
    __workspaceStoryboardBoardCount: stripped.boards?.length || 0,
    __workspaceStoryboardBatchAuditCount: stripped.batchAudits?.length || 0,
  };
};

const workspaceShotSummary = (shot: any) => {
  const compactMediaUrl = (value: unknown) => typeof value === "string"
    && value.length <= 4096
    && !value.startsWith("data:")
      ? value
      : undefined;
  const imageUrl = compactMediaUrl(shot.imageUrl);
  const videoUrl = compactMediaUrl(shot.videoUrl);
  return {
    id: shot.id,
    duration: shot.duration,
    appearance: shot.appearance,
    directing: shot.directing,
    creativeDirection: shot.creativeDirection,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    transition: shot.transition,
    ...(imageUrl ? { imageUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    __workspaceShotSummary: true,
  };
};

const workspaceShotReadModel = (scene: any) => {
  const shots = scene.shots || [];
  const shotPlanSourceHash = scene.manualStoryboard?.shotPlan?.sourceHash;
  return {
    __workspaceShotPlanHash: buildManualShotPlanHash(shots),
    __workspaceImagePromptHash: buildManualImagePromptHash(shots),
    __workspaceVideoPromptHash: buildManualVideoPromptHash(shots),
    __workspaceVisualPromptHash: buildManualVisualPromptHash(shots),
    __workspaceHasImagePrompts: shots.length > 0 && shots.every((shot: any) => shot.imagePrompt),
    __workspaceHasVideoPrompts: shots.length > 0 && shots.every((shot: any) => shot.videoPrompt),
    __workspaceHasVisualPrompts: shots.length > 0
      && shots.every((shot: any) => shot.imagePrompt && shot.videoPrompt),
    ...(shotPlanSourceHash
      ? {
          __workspaceVisualPromptSourceHash: buildManualVisualPromptSourceHash(
            shotPlanSourceHash,
            shots,
          ),
        }
      : {}),
  };
};

const workspaceProductionTeamScenePlan = (
  scenePlan: any,
  sceneScopeId?: string,
  summaryOnly = false,
) => {
  if (!summaryOnly && (!sceneScopeId || scenePlan.sceneId === sceneScopeId)) return scenePlan;
  return {
    sceneId: scenePlan.sceneId,
    __workspaceScenePlanSummary: true,
  };
};

const workspaceProductionTeam = (
  productionTeam: any,
  sceneScopeId?: string,
  summaryOnly = false,
) => {
  if (!productionTeam) return productionTeam;
  return {
    ...productionTeam,
    outputs: (productionTeam.outputs || []).map((output: any) => {
      const qa = output.qa
        ? summaryOnly
          ? {
              score: output.qa.score,
              verdict: output.qa.verdict,
              issues: output.qa.issues || [],
              reviewedAt: output.qa.reviewedAt,
            }
          : (({ coverage: _coverage, ...workspaceQa }) => workspaceQa)(output.qa)
        : output.qa;
      const summary = summaryOnly
        ? {
            department: output.department,
            preparationOrigin: output.preparationOrigin,
            coordinationPhase: output.coordinationPhase,
            sourceScriptHash: output.sourceScriptHash,
            sourceBreakdownHash: output.sourceBreakdownHash,
            fullScriptHash: output.fullScriptHash,
            taskSummary: output.taskSummary,
            content: "",
            openQuestions: output.openQuestions || [],
            handoffNotes: output.handoffNotes || [],
            handoffs: output.handoffs || [],
            collaborationSourceHash: output.collaborationSourceHash,
            collaborationSourceVersions: output.collaborationSourceVersions,
            collaborationHandoffIds: output.collaborationHandoffIds,
            status: output.status,
            version: output.version,
            audit: { promptHash: output.audit?.promptHash || "" },
            updatedAt: output.updatedAt,
            confirmedAt: output.confirmedAt,
            __workspaceProductionAssetSourceHash: productionAssetDepartmentOutputSourceHash(output),
            __workspaceProductionTeamOutputSummary: true,
          }
        : output;
      return {
        ...summary,
        ...(sceneScopeId
          ? {
              // Scene-scoped responses collapse the other department scene plans.
              // Keep the authoritative full-output hash so asset-governance batches
              // remain valid when the author returns to one preparation scene.
              __workspaceProductionAssetSourceHash: productionAssetDepartmentOutputSourceHash(output),
            }
          : {}),
        ...(Array.isArray(output.scenePlans)
          ? {
              scenePlans: output.scenePlans.map((scenePlan: any) =>
                workspaceProductionTeamScenePlan(scenePlan, sceneScopeId, summaryOnly)),
            }
          : {}),
        ...(qa ? { qa } : {}),
      };
    }),
  };
};

const workspaceSceneBreakdownStatus = (scene: any) => {
  if (!scene.breakdown) return "待拆解";
  const record = scene.productionPreparation?.breakdown;
  if (!record) return "待确认";
  if (record.status === "needs_revision") return "需优化";
  return "已确认";
};

const workspaceSceneSummary = (scene: any) => ({
  id: scene.id,
  creativeDirection: scene.creativeDirection,
  sourceWritingUnitId: scene.sourceWritingUnitId,
  sourceWritingSceneId: scene.sourceWritingSceneId,
  sourceDocumentId: scene.sourceDocumentId,
  sourceNodeId: scene.sourceNodeId,
  sceneNumber: scene.sceneNumber,
  title: scene.title,
  description: scene.description,
  valueCharge: scene.valueCharge,
  valueShift: scene.valueShift,
  hook: scene.hook,
  cliffhanger: scene.cliffhanger,
  targetDuration: scene.targetDuration,
  sceneGoal: scene.sceneGoal,
  script: scene.script,
  scriptBlocks: scene.scriptBlocks,
  sourceEvidence: scene.sourceEvidence,
  breakdown: scene.breakdown,
  productionPreparation: scene.productionPreparation,
  sceneAssets: scene.sceneAssets,
  environment: scene.environment,
  timeOfDay: scene.timeOfDay,
  interactiveMetadata: scene.interactiveMetadata,
  shotCount: Number(scene.shotCount ?? scene.shots?.length ?? 0),
  __workspaceSceneSummary: true,
  __workspaceBreakdownStatus: workspaceSceneBreakdownStatus(scene),
});

const workspaceEpisode = (
  episode: any,
  view: 'production-preparation' | 'storyboard' | 'storyboard-index',
  sceneScopeId?: string,
  shotScopeId?: string,
) => ({
  ...episode,
  __workspaceView: view === 'storyboard-index' ? 'storyboard' : view,
  ...(sceneScopeId ? { __workspaceSceneScope: sceneScopeId } : {}),
  ...(view === 'storyboard-index'
    ? {
        __workspaceShotSummaryOnly: true,
        ...(shotScopeId ? { __workspaceShotScope: shotScopeId } : {}),
        ...(sceneScopeId
          ? {
              __workspaceProductionTeamSummaryOnly: true,
            }
          : {}),
      }
    : {}),
  productionTeam: workspaceProductionTeam(
    episode.productionTeam,
    sceneScopeId,
    view === 'storyboard-index' && Boolean(sceneScopeId),
  ),
  scenes: (episode.scenes || []).map((scene: any) => {
    if (sceneScopeId && scene.id !== sceneScopeId) {
      return scene.__workspaceSceneSummary ? scene : workspaceSceneSummary(scene);
    }
    const { manualStoryboard, ...workspaceScene } = scene;
    const breakdown = workspaceScene.productionPreparation?.breakdown;
    const productionPreparation = breakdown
      ? {
          ...workspaceScene.productionPreparation,
          breakdown: (({ promptExecutions: _promptExecutions, ...record }) => record)(breakdown),
        }
      : workspaceScene.productionPreparation;
    const shots = view === 'storyboard-index'
      ? (workspaceScene.shots || []).map((shot: any) =>
          shotScopeId && shot.id === shotScopeId ? shot : workspaceShotSummary(shot))
      : workspaceScene.shots;
    return {
      ...workspaceScene,
      ...(view === 'storyboard-index' ? workspaceShotReadModel(scene) : {}),
      ...(shots ? { shots } : {}),
      ...(productionPreparation ? { productionPreparation } : {}),
      ...(view === 'storyboard' || view === 'storyboard-index'
        ? {
            manualStoryboard: view === 'storyboard-index'
              ? workspaceStoryboardIndex(manualStoryboard)
              : stripManualStoryboardPromptBodies(manualStoryboard),
          }
        : {}),
    };
  }),
});

const restoreManualStoryboardPromptBodies = (incoming: any, existing: any) => {
  if (!incoming || !existing) return incoming;
  const {
    __workspaceStoryboardIndex,
    __workspaceStoryboardBoardCount: _workspaceStoryboardBoardCount,
    __workspaceStoryboardBatchAuditCount: _workspaceStoryboardBatchAuditCount,
    ...restoredWorkspace
  } = incoming;
  const mergeRecord = (incomingRecord: any, existingRecord: any) => {
    if (!incomingRecord?.audit || incomingRecord.audit.confirmedPrompt !== undefined) return incomingRecord;
    if (existingRecord?.audit?.confirmedPrompt === undefined) return incomingRecord;
    return {
      ...incomingRecord,
      audit: {
        ...incomingRecord.audit,
        confirmedPrompt: existingRecord.audit.confirmedPrompt,
      },
    };
  };
  const {
    visualPrompts: _legacyVisualPrompts,
    qa: _legacyAggregateQA,
    ...currentWorkspace
  } = restoredWorkspace;
  return {
    ...currentWorkspace,
    shotPlan: mergeRecord(incoming.shotPlan, existing.shotPlan),
    imagePrompts: mergeRecord(incoming.imagePrompts, existing.imagePrompts),
    videoPrompts: mergeRecord(incoming.videoPrompts, existing.videoPrompts),
    boards: __workspaceStoryboardIndex
      ? existing.boards
      : Array.isArray(incoming.boards)
      ? incoming.boards.map((workflow: any) => {
          if (!workflow?.__workspaceStoryboardSummary) return workflow;
          return (existing.boards || []).find((candidate: any) =>
            candidate.id === workflow.id || candidate.boardId === workflow.boardId)
            || workflow;
        })
      : existing.boards,
    batchAudits: __workspaceStoryboardIndex
      ? existing.batchAudits
      : incoming.batchAudits ?? existing.batchAudits,
  };
};

const mergeWorkspaceScene = (incoming: any, existing: any, view: string) => {
  const merged = { ...incoming };
  if (view === 'production-preparation' && merged.manualStoryboard === undefined && existing.manualStoryboard !== undefined) {
    merged.manualStoryboard = existing.manualStoryboard;
  } else if (view === 'storyboard' && merged.manualStoryboard !== undefined) {
    merged.manualStoryboard = restoreManualStoryboardPromptBodies(
      merged.manualStoryboard,
      existing.manualStoryboard,
    );
  }
  const incomingBreakdown = merged.productionPreparation?.breakdown;
  const existingExecutions = existing.productionPreparation?.breakdown?.promptExecutions;
  if (incomingBreakdown && incomingBreakdown.promptExecutions === undefined && existingExecutions !== undefined) {
    merged.productionPreparation = {
      ...merged.productionPreparation,
      breakdown: {
        ...incomingBreakdown,
        promptExecutions: existingExecutions,
      },
    };
  }
  return merged;
};

const mergeWorkspaceProductionTeam = (incoming: any, existing: any) => {
  if (!incoming || !existing) return incoming;
  const existingByDepartment = new Map(
    (existing.outputs || []).map((output: any) => [output.department, output]),
  );
  return {
    ...incoming,
    outputs: (incoming.outputs || []).map((output: any) => {
      const existingOutput: any = existingByDepartment.get(output.department);
      const {
        __workspaceProductionTeamOutputSummary,
        __workspaceProductionAssetSourceHash: _workspaceProductionAssetSourceHash,
        ...incomingOutput
      } = output;
      const outputWithRestoredBodies = __workspaceProductionTeamOutputSummary && existingOutput
        ? {
            ...existingOutput,
            ...incomingOutput,
            content: existingOutput.content,
            handoffNotes: existingOutput.handoffNotes,
            sourceSceneIds: existingOutput.sourceSceneIds,
            audit: existingOutput.audit,
            qa: incomingOutput.qa
              ? { ...existingOutput.qa, ...incomingOutput.qa }
              : existingOutput.qa,
          }
        : incomingOutput;
      const existingScenePlans = new Map(
        (existingOutput?.scenePlans || []).map((scenePlan: any) => [scenePlan.sceneId, scenePlan]),
      );
      const scenePlans = Array.isArray(outputWithRestoredBodies.scenePlans)
        ? outputWithRestoredBodies.scenePlans.map((scenePlan: any) => {
            if (!scenePlan.__workspaceScenePlanSummary) return scenePlan;
            return existingScenePlans.get(scenePlan.sceneId) || scenePlan;
          })
        : outputWithRestoredBodies.scenePlans;
      const restoredOutput = {
        ...outputWithRestoredBodies,
        ...(Array.isArray(scenePlans) ? { scenePlans } : {}),
      };
      if (
        !outputWithRestoredBodies.qa
        || outputWithRestoredBodies.qa.coverage !== undefined
        || existingOutput?.qa?.coverage === undefined
      ) {
        return restoredOutput;
      }
      return {
        ...restoredOutput,
        qa: {
          ...outputWithRestoredBodies.qa,
          coverage: existingOutput.qa.coverage,
        },
      };
    }),
  };
};

export const dbHelpers = {
  transaction: <T>(operation: () => T): T => db.transaction(operation)(),

  getProjectSummaries: () => {
    const episodeRows = episodeMetadataRows();
    const episodesByProject = new Map<string, any[]>();
    episodeRows.forEach((row) => {
      const episodes = episodesByProject.get(row.project_id) || [];
      episodes.push(projectListEpisodeMetadata(row));
      episodesByProject.set(row.project_id, episodes);
    });
    return (db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[])
      .map((project) => ({
        id: project.id,
        title: project.title,
        type: project.type,
        ...projectListData(JSON.parse(project.data || '{}')),
        updatedAt: project.updated_at,
        episodes: episodesByProject.get(project.id) || [],
      }));
  },

  getProductionScriptUnitBySourceDocumentId: (projectId: string, sourceDocumentId: string) => {
    const workspace = persistedProductionScriptWorkspace(projectId);
    const revision = workspace?.revisions?.find((item) => item.id === workspace.currentRevisionId);
    const unit = revision?.units?.find((item) => String(item.sourceDocumentId || "") === sourceDocumentId);
    if (!unit) return null;
    const project = db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId) as { data?: string } | undefined;
    const projectData = project?.data ? JSON.parse(project.data) as { productionSourceDocuments?: Array<Record<string, unknown>> } : {};
    const originalSourceDocumentId = String(unit.originalSourceDocumentId || "");
    const originalSourceDocument = originalSourceDocumentId
      ? projectData.productionSourceDocuments?.find((document) => String(document.id || "") === originalSourceDocumentId)
      : undefined;
    return {
      unit,
      ...(originalSourceDocument ? { originalSourceDocument } : {}),
    };
  },

  getProductionScriptWorkspace: (projectId: string) =>
    persistedProductionScriptWorkspace(projectId) || null,

  getProjectShellById: (id: string, sourceDocumentId?: string) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!project) return null;
    const projectData = projectDataForWorkspaceShell(quarantineLegacyDemoProjectData(projectDataWithProductionScriptWorkspace(project.id, JSON.parse(project.data || '{}'))), sourceDocumentId);
    return {
      id: project.id,
      title: project.title,
      type: project.type,
      ...projectData,
      episodes: visibleEpisodeMetadataRows(id, projectData).map((row) => {
        const metadata = episodeMetadata(row);
        const adoptedScenes = metadata.sceneCount > 0
          ? []
          : adoptedSceneSnapshotForEpisode(projectData, metadata);
        return adoptedScenes.length
          ? { ...metadata, sceneCount: adoptedScenes.length }
          : metadata;
      }),
    };
  },

  getProductionWorkspaceProjectShellById: (id: string, sourceDocumentId?: string) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!project) return null;
    const projectData = projectDataForWorkspaceShell(quarantineLegacyDemoProjectData(projectDataWithProductionScriptWorkspace(project.id, JSON.parse(project.data || '{}'))), sourceDocumentId);
    const {
      productionSourceSnapshot,
      interactiveProductionPlanDrafts: _interactiveProductionPlanDrafts,
      interactiveMediaPlanDrafts: _interactiveMediaPlanDrafts,
      manualProductionAssets,
      ...workspaceData
    } = projectData;
    return {
      id: project.id,
      title: project.title,
      type: project.type,
      ...workspaceData,
      ...(Array.isArray(projectData.productionSourceDocuments) && projectData.productionSourceDocuments.length
        ? {}
        : { productionSourceSnapshot }),
      manualProductionAssets: productionWorkspaceAssetRegistry(manualProductionAssets),
      episodes: visibleEpisodeMetadataRows(id, projectData).map((row) => {
        const metadata = episodeMetadata(row);
        const adoptedScenes = metadata.sceneCount > 0
          ? []
          : adoptedSceneSnapshotForEpisode(projectData, metadata);
        return adoptedScenes.length
          ? { ...metadata, sceneCount: adoptedScenes.length }
          : metadata;
      }),
      __productionWorkspaceShell: true,
    };
  },

  getManualStudioPriorVideoReferences: (projectId: string) => {
    const episodeRows = db.prepare('SELECT id, title, data FROM episodes WHERE project_id = ? ORDER BY order_index ASC').all(projectId) as any[];
    const sceneRows = db.prepare('SELECT id, episode_id, title, data FROM scenes WHERE project_id = ? ORDER BY episode_id ASC, order_index ASC').all(projectId) as any[];
    const shotRows = db.prepare('SELECT id, scene_id, data FROM shots WHERE project_id = ? ORDER BY scene_id ASC, order_index ASC').all(projectId) as any[];
    const shotsByScene = new Map<string, any[]>();
    for (const row of shotRows) {
      const shots = shotsByScene.get(row.scene_id) || [];
      shots.push({ id: row.id, ...JSON.parse(row.data || '{}') });
      shotsByScene.set(row.scene_id, shots);
    }
    const scenesByEpisode = new Map<string, any[]>();
    for (const row of sceneRows) {
      const scenes = scenesByEpisode.get(row.episode_id) || [];
      scenes.push({
        id: row.id,
        title: row.title,
        ...JSON.parse(row.data || '{}'),
        shots: shotsByScene.get(row.id) || [],
      });
      scenesByEpisode.set(row.episode_id, scenes);
    }
    return listManualStudioEligiblePriorVideoReferences(episodeRows.map((row) => ({
      id: row.id,
      title: row.title,
      ...JSON.parse(row.data || '{}'),
      scenes: scenesByEpisode.get(row.id) || [],
    })));
  },

  getEpisodeById: (
    projectId: string,
    episodeId: string,
    view?: string,
    sceneScopeId?: string,
    shotScopeId?: string,
    expandAllScenes = false,
  ) => {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ? AND project_id = ?').get(episodeId, projectId) as any;
    if (!episode) return null;
    const episodeData = JSON.parse(episode.data || '{}');
    const sceneRows = db.prepare('SELECT * FROM scenes WHERE episode_id = ? ORDER BY order_index ASC').all(episodeId) as any[];
    const isWorkspaceView = view === 'production-preparation'
      || view === 'storyboard'
      || view === 'storyboard-index';
    const effectiveSceneScopeId = isWorkspaceView && !expandAllScenes
      ? sceneScopeId || (sceneRows[0]?.id ? String(sceneRows[0].id) : undefined)
      : undefined;
    const isScopedWorkspaceView = (
      isWorkspaceView && Boolean(effectiveSceneScopeId)
    );
    const shotRows = isScopedWorkspaceView
      ? db.prepare('SELECT * FROM shots WHERE episode_id = ? AND scene_id = ? ORDER BY order_index ASC').all(episodeId, effectiveSceneScopeId) as any[]
      : db.prepare('SELECT * FROM shots WHERE episode_id = ? ORDER BY scene_id ASC, order_index ASC').all(episodeId) as any[];
    const scopedShotCounts = isScopedWorkspaceView
      ? new Map<string, number>(
          (db.prepare('SELECT scene_id, COUNT(*) AS count FROM shots WHERE episode_id = ? GROUP BY scene_id').all(episodeId) as any[])
            .map((row) => [String(row.scene_id), Number(row.count || 0)] as const),
        )
      : null;
    const shotsByScene = new Map<string, any[]>();
    shotRows.forEach((shot) => {
      const shots = shotsByScene.get(shot.scene_id) || [];
      shots.push({ id: shot.id, ...JSON.parse(shot.data || '{}') });
      shotsByScene.set(shot.scene_id, shots);
    });
    const result = {
      id: episode.id,
      title: episode.title,
      ...episodeData,
      productionRevision: Number(episode.production_revision || 0),
      scenes: sceneRows.map((scene) => {
        const sceneData = JSON.parse(scene.data || '{}');
        if (isScopedWorkspaceView && scene.id !== effectiveSceneScopeId) {
          return workspaceSceneSummary({
            id: scene.id,
            sceneNumber: scene.scene_number,
            title: scene.title,
            ...sceneData,
            shotCount: scopedShotCounts?.get(scene.id) || 0,
          });
        }
        return {
          id: scene.id,
          sceneNumber: scene.scene_number,
          title: scene.title,
          ...sceneData,
          shots: shotsByScene.get(scene.id) || [],
        };
      }),
    };
    const projectData = isWorkspaceView && result.scenes.length === 0
      ? JSON.parse((db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId) as any)?.data || '{}')
      : null;
    const workspaceResult = projectData
      ? { ...result, scenes: adoptedSceneSnapshotForEpisode(projectData, result) }
      : result;
    return isWorkspaceView
      ? workspaceEpisode(
          workspaceResult,
          view,
          isScopedWorkspaceView ? effectiveSceneScopeId : undefined,
          view === 'storyboard-index' ? shotScopeId : undefined,
        )
      : result;
  },

  getStoryboardTeamPromptContext: (
    projectId: string,
    episodeId: string,
    sceneId: string,
  ) => {
    const episode = db.prepare('SELECT data FROM episodes WHERE id = ? AND project_id = ?')
      .get(episodeId, projectId) as any;
    if (!episode) return null;
    const episodeData = JSON.parse(episode.data || '{}');
    const sceneRows = db.prepare('SELECT id, title, data FROM scenes WHERE episode_id = ? AND project_id = ? ORDER BY order_index ASC').all(episodeId, projectId) as any[];
    const scenes = sceneRows.map(row => ({ ...JSON.parse(row.data || '{}'), id: row.id, title: row.title, shots: [] as any[] }));
    const index = scenes.findIndex(scene => scene.id === sceneId);
    if (index < 0) return null;
    if (index > 0) {
      const rows = db.prepare('SELECT id, data FROM shots WHERE scene_id = ? AND episode_id = ? AND project_id = ? ORDER BY order_index DESC LIMIT 2').all(scenes[index - 1].id, episodeId, projectId) as any[];
      scenes[index - 1].shots = rows.reverse().map(row => ({ ...JSON.parse(row.data || '{}'), id: row.id }));
    }
    const creativeProjectRow = db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId) as any;
    const creativeProject = JSON.parse(creativeProjectRow?.data || '{}');
    scenes[index].shots = (db.prepare("SELECT id, json_extract(data, '$.creativeDirection') AS creative, json_extract(data, '$.visualAction') AS action, json_extract(data, '$.characterIdsInShot') AS characters, json_extract(data, '$.propIds') AS props, json_extract(data, '$.locationId') AS location FROM shots WHERE scene_id = ? AND episode_id = ? AND project_id = ? ORDER BY order_index ASC").all(sceneId, episodeId, projectId) as any[]).map(row => ({ id: row.id, visualAction: row.action, creativeDirection: row.creative ? JSON.parse(row.creative) : undefined, characterIdsInShot: JSON.parse(row.characters || '[]'), propIds: JSON.parse(row.props || '[]'), locationId: row.location }));
    const appearanceHistory = (db.prepare("SELECT shots.id, json_extract(shots.data, '$.appearance') AS appearance, json_object('script', json_extract(scenes.data, '$.script'), 'sourceEvidence', json_extract(scenes.data, '$.sourceEvidence'), 'description', json_extract(scenes.data, '$.description')) AS sceneData FROM shots JOIN scenes ON shots.scene_id = scenes.id AND shots.project_id = scenes.project_id WHERE shots.project_id = ? AND shots.scene_id != ? AND json_type(shots.data, '$.appearance.states') = 'array'").all(projectId, sceneId) as any[]).map(row => ({ id: row.id, appearance: JSON.parse(row.appearance), currentSourceHash: appearanceSourceHash(JSON.parse(row.sceneData)) }));
    return {
      sceneId,
      productionTeamContext: JSON.stringify(buildProductionSceneContext({ ...episodeData, id: episodeId, scenes }, scenes[index], appearanceHistory, creativeProject), null, 2),
    };
  },

  getAIConfig: (): { config: AIConfigSnapshot; hasSavedConfig: boolean; updatedAt?: number } => {
    const row = db.prepare('SELECT updated_at, data FROM ai_config WHERE id = ?').get('default') as any;
    if (!row) {
      return {
        config: normalizeAIConfig(defaultAIConfig),
        hasSavedConfig: false,
      };
    }
    const storedConfig = JSON.parse(row.data || '{}') as Partial<AIConfigSnapshot>;
    const config = normalizeAIConfig(storedConfig);
    const normalizedData = JSON.stringify(config);
    let updatedAt = Number(row.updated_at || 0);
    if (
      Number(storedConfig.schemaVersion || 1) < AI_CONFIG_SCHEMA_VERSION ||
      JSON.stringify(storedConfig) !== normalizedData
    ) {
      updatedAt = Date.now();
      db.prepare('UPDATE ai_config SET updated_at = ?, data = ? WHERE id = ?')
        .run(updatedAt, normalizedData, 'default');
    }
    return {
      config,
      hasSavedConfig: true,
      updatedAt,
    };
  },

  saveAIConfig: (config: Partial<AIConfigSnapshot>) => {
    const normalized = normalizeAIConfig(config);
    const updatedAt = Date.now();
    db.prepare(`
      INSERT INTO ai_config (id, updated_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at=excluded.updated_at,
        data=excluded.data
    `).run('default', updatedAt, JSON.stringify(normalized));
    return { config: normalized, hasSavedConfig: true, updatedAt };
  },

  getAllProjects: () => {
    const projectsStmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
    const projects = projectsStmt.all() as any[];
    return projects.map(p => {
      const data = quarantineLegacyDemoProjectData(projectDataWithProductionScriptWorkspace(p.id, JSON.parse(p.data)));
      const epsStmt = db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY order_index ASC');
      const eps = epsStmt.all(p.id) as any[];
      return {
        id: p.id,
        title: p.title,
        type: p.type,
        ...data,
        episodes: eps.map(e => {
          const epData = JSON.parse(e.data);
          // Explicit compatibility reads retain the historical full project
          // tree. Normal catalog and workspace routes never call this method.
          const scenesStmt = db.prepare('SELECT * FROM scenes WHERE episode_id = ? ORDER BY order_index ASC');
          const scenes = scenesStmt.all(e.id) as any[];
          epData.scenes = scenes.map(s => {
            const scData = JSON.parse(s.data);
            const shotsStmt = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY order_index ASC');
            const shots = shotsStmt.all(s.id) as any[];
            scData.shots = shots.map(sh => ({ id: sh.id, ...JSON.parse(sh.data) }));
            return { id: s.id, sceneNumber: s.scene_number, title: s.title, ...scData };
          });
          return { id: e.id, title: e.title, ...epData };
        })
      };
    });
  },
  
  getProjectById: (id: string) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!p) return null;
    const data = quarantineLegacyDemoProjectData(projectDataWithProductionScriptWorkspace(p.id, JSON.parse(p.data)));
    const epsStmt = db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY order_index ASC');
    const eps = epsStmt.all(id) as any[];
    return {
      id: p.id,
      title: p.title,
      type: p.type,
      ...data,
      episodes: eps.map(e => {
        const epData = JSON.parse(e.data);
        const scenesStmt = db.prepare('SELECT * FROM scenes WHERE episode_id = ? ORDER BY order_index ASC');
        const scenes = scenesStmt.all(e.id) as any[];
        epData.scenes = scenes.map(s => {
          const scData = JSON.parse(s.data);
          const shotsStmt = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY order_index ASC');
          const shots = shotsStmt.all(s.id) as any[];
          scData.shots = shots.map(sh => ({ id: sh.id, ...JSON.parse(sh.data) }));
          return { id: s.id, sceneNumber: s.scene_number, title: s.title, ...scData };
        });
        return { id: e.id, title: e.title, ...epData, productionRevision: Number(e.production_revision || 0) };
      })
    };
  },
  
  saveProject: (project: any) => {
    const { id, title, type, episodes, productionScriptWorkspace, productionSourceDocuments, __requireProductionRevision, ...restData } = project;
    const existingScriptWorkspace = persistedProductionScriptWorkspace(id);
    if (
      existingScriptWorkspace?.currentRevisionId
      && productionScriptWorkspace?.currentRevisionId
      && existingScriptWorkspace.currentRevisionId !== productionScriptWorkspace.currentRevisionId
    ) {
      const error = new Error("正式剧本必须通过带 revision 的保存接口更新，请重新读取后再保存。");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    
    const upsertProject = db.prepare(`
      INSERT INTO projects (id, title, type, data, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        title=excluded.title, 
        type=excluded.type, 
        data=excluded.data, 
        updated_at=CURRENT_TIMESTAMP
    `);
    
    // Use transaction
    const transaction = db.transaction(() => {
      if (Array.isArray(episodes)) {
        for (const episode of episodes) {
          const existingEpisode = db.prepare('SELECT production_revision FROM episodes WHERE id = ? AND project_id = ?').get(episode.id, id) as { production_revision: number } | undefined;
          if (!existingEpisode && episode.productionRevision !== undefined) {
            const error = new Error("制片分集已被删除。本机旧版本未重新建立分集，请核对后新建。");
            Object.assign(error, { statusCode: 409 });
            throw error;
          }
          if (existingEpisode && (__requireProductionRevision || episode.productionRevision !== undefined)
            && episode.productionRevision !== Number(existingEpisode.production_revision || 0)) {
            const error = new Error("制片分集已在其他页面或任务更新。本机修改仍保留，请重新读取并核对后再保存。");
            Object.assign(error, { statusCode: 409 });
            throw error;
          }
        }
      }
      const existingProject = db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data?: string } | undefined;
      const existingProjectData = existingProject?.data ? JSON.parse(existingProject.data) : {};
      const resolvedSourceDocuments = restoreDeferredProductionSourceBodies(
        productionSourceDocuments,
        existingProjectData.productionSourceDocuments,
      );
      const projectData = {
        ...restData,
        ...(resolvedSourceDocuments
          ? { productionSourceDocuments: resolvedSourceDocuments }
          : {}),
      };
      upsertProject.run(id, title || 'Untitled', type || 'movie', JSON.stringify(projectData));
      if (productionScriptWorkspace?.currentRevisionId && !hasDeferredProductionScriptBodies(productionScriptWorkspace)) {
        saveProductionScriptWorkspaceRecord(id, productionScriptWorkspace);
      }
      
      if (Array.isArray(episodes)) {
        // A full payload may come from a page opened before another page added
        // an episode. Deletion is explicit through deleteEpisode, never inferred
        // from an absent item in a possibly stale snapshot.

        const upsertEpisode = db.prepare(`
          INSERT INTO episodes (id, project_id, title, data, order_index, production_revision)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET 
            title=excluded.title, 
            data=excluded.data,
            order_index=excluded.order_index,
            production_revision=episodes.production_revision + 1
        `);
        let epIdx = 0;
        for (const ep of episodes) {
          const { id: epId, title: epTitle, scenes, productionRevision: _productionRevision, ...epData } = ep;
          const finalEpId = epId || `ep_${Date.now()}`;
          assertProductionEntityOwner("episodes", finalEpId, { project_id: id });
          upsertEpisode.run(finalEpId, id, epTitle || 'Untitled', JSON.stringify(epData), epIdx++);

          if (Array.isArray(scenes)) {
            const existingScenes = db.prepare('SELECT id FROM scenes WHERE episode_id = ?').all(finalEpId) as any[];
            const incomingSceneIds = new Set(scenes.map(s => s.id));
            const deleteScene = db.prepare('DELETE FROM scenes WHERE id = ?');
            for (const sc of existingScenes) {
              if (!incomingSceneIds.has(sc.id)) deleteScene.run(sc.id);
            }

            const upsertScene = db.prepare(`
              INSERT INTO scenes (id, episode_id, project_id, scene_number, title, data, order_index) 
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET 
                scene_number=excluded.scene_number,
                title=excluded.title, 
                data=excluded.data,
                order_index=excluded.order_index
            `);
            const upsertShot = db.prepare(`
              INSERT INTO shots (id, scene_id, episode_id, project_id, data, order_index) 
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET 
                scene_id=excluded.scene_id,
                episode_id=excluded.episode_id,
                project_id=excluded.project_id,
                data=excluded.data,
                order_index=excluded.order_index
            `);

            let scIdx = 0;
            for (const sc of scenes) {
              const { id: scId, sceneNumber, title: scTitle, shots, ...scData } = sc;
              const finalScId = scId || `sc_${Date.now()}_${Math.random()}`;
              assertProductionEntityOwner("scenes", finalScId, { project_id: id, episode_id: finalEpId });
              upsertScene.run(finalScId, finalEpId, id, sceneNumber || '', scTitle || 'Untitled', JSON.stringify(scData), scIdx++);

              if (Array.isArray(shots)) {
                const existingShots = db.prepare('SELECT id FROM shots WHERE scene_id = ?').all(finalScId) as any[];
                const incomingShotIds = new Set(shots.map((sh: any) => sh.id));
                const deleteShot = db.prepare('DELETE FROM shots WHERE id = ?');
                for (const sh of existingShots) {
                  if (!incomingShotIds.has(sh.id)) deleteShot.run(sh.id);
                }

                let shIdx = 0;
                for (const sh of shots) {
                  const { id: shId, ...shData } = sh;
                  const finalShId = shId || `sh_${Date.now()}_${Math.random()}`;
                  assertProductionEntityOwner("shots", finalShId, { project_id: id, episode_id: finalEpId, scene_id: finalScId });
                  upsertShot.run(finalShId, finalScId, finalEpId, id, JSON.stringify(shData), shIdx++);
                }
              }
            }
          }
        }
      }
    });
    
    transaction();
    return dbHelpers.getProjectById(id);
  },
  
  deleteProject: (id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },

  deleteEpisode: (projectId: string, episodeId: string) => {
    db.prepare('DELETE FROM episodes WHERE id = ? AND project_id = ?').run(episodeId, projectId);
  },

  updateProjectMeta: (id: string, updates: any) => {
    const existing = db.prepare('SELECT data, title, type FROM projects WHERE id = ?').get(id) as any;
    if (!existing) {
       return dbHelpers.saveProject(updates);
    }
    const existingData = projectDataWithProductionScriptWorkspace(id, JSON.parse(existing.data || '{}'));
    const {
      title,
      type,
      id: _,
      episodes,
      __productionWorkspaceShell,
      __expectedProductionScriptRevisionId,
      productionScriptWorkspace,
      productionSourceDocuments,
      ...restUpdates
    } = updates;
    if (__expectedProductionScriptRevisionId !== undefined) {
      const actualRevisionId = existingData.productionScriptWorkspace?.currentRevisionId;
      if (actualRevisionId !== __expectedProductionScriptRevisionId) {
        const error = new Error("正式剧本已在另一处更新，请重新读取后再保存。");
        (error as Error & { statusCode?: number }).statusCode = 409;
        throw error;
      }
    }
    if (
      productionScriptWorkspace?.currentRevisionId
      && __expectedProductionScriptRevisionId === undefined
      && existingData.productionScriptWorkspace?.currentRevisionId !== productionScriptWorkspace.currentRevisionId
    ) {
      const error = new Error("正式剧本必须通过带 revision 的保存接口更新，请重新读取后再保存。");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    const workspaceManualProductionAssets = __productionWorkspaceShell
      && restUpdates.manualProductionAssets
      && existingData.manualProductionAssets
      ? {
          ...existingData.manualProductionAssets,
          ...restUpdates.manualProductionAssets,
          variants: existingData.manualProductionAssets.variants || [],
          profileRevisions: existingData.manualProductionAssets.profileRevisions || [],
          preparationBatches: existingData.manualProductionAssets.preparationBatches || [],
        }
      : restUpdates.manualProductionAssets;
    const { productionScriptWorkspace: _legacyEmbeddedWorkspace, ...existingDataWithoutScriptWorkspace } = existingData;
    const newData = {
      ...existingDataWithoutScriptWorkspace,
      ...restUpdates,
      ...(productionSourceDocuments && !hasDeferredProductionSourceBodies(productionSourceDocuments)
        ? { productionSourceDocuments }
        : {}),
      ...(workspaceManualProductionAssets
        ? { manualProductionAssets: workspaceManualProductionAssets }
        : {}),
    };
    const newTitle = title !== undefined ? title : existing.title;
    const newType = type !== undefined ? type : existing.type;
    
    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE projects 
        SET title = ?, type = ?, data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newTitle, newType, JSON.stringify(newData), id);

      if (productionScriptWorkspace?.currentRevisionId && !hasDeferredProductionScriptBodies(productionScriptWorkspace)) {
        saveProductionScriptWorkspaceRecord(id, productionScriptWorkspace);
      }
      
      if (Array.isArray(episodes)) {
        const updateEpOrder = db.prepare('UPDATE episodes SET order_index = ? WHERE id = ? AND project_id = ?');
        let idx = 0;
        for (const ep of episodes) {
          if (ep && ep.id) {
            updateEpOrder.run(idx++, ep.id, id);
          }
        }
      }
    });

    transaction();
    
    return {
      id,
      title: newTitle,
      type: newType,
      ...newData,
      ...(productionScriptWorkspace || existingData.productionScriptWorkspace
        ? { productionScriptWorkspace: productionScriptWorkspace || existingData.productionScriptWorkspace }
        : {}),
    };
  },
  
  updateEpisode: (projectId: string, episodeId: string, updates: any) => {
    let newTitle = updates.title || 'Untitled';
    const {
      title,
      id: _epId,
      scenes,
      __workspaceView,
      __workspaceSceneScope,
      __workspaceShotSummaryOnly: _workspaceShotSummaryOnly,
      __workspaceShotScope: _workspaceShotScope,
      __workspaceProductionTeamSummaryOnly: _workspaceProductionTeamSummaryOnly,
      productionRevision,
      __requireProductionRevision,
      ...rawEpisodeData
    } = updates;
    const hasPartialSceneScope = typeof __workspaceSceneScope === 'string' && __workspaceSceneScope.length > 0;
    const hasPartialShotScope = Boolean(_workspaceShotSummaryOnly);

    const transaction = db.transaction(() => {
      assertProductionEntityOwner("episodes", episodeId, { project_id: projectId });
      const existing = db.prepare('SELECT data, title, production_revision FROM episodes WHERE id = ? AND project_id = ?').get(episodeId, projectId) as any;
      if (!existing && productionRevision !== undefined) {
        const error = new Error("制片分集已被删除。本机旧版本未重新建立分集，请核对后新建。");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      if (existing && (__requireProductionRevision || productionRevision !== undefined)
        && (!Number.isSafeInteger(productionRevision) || productionRevision !== Number(existing.production_revision || 0))) {
        const error = new Error("制片分集已在其他页面或任务更新。本机修改仍保留，请重新读取并核对后再保存。");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      const existingEpisodeData = existing ? JSON.parse(existing.data || '{}') : {};
      const epData = __workspaceView
        ? {
            ...rawEpisodeData,
            productionTeam: mergeWorkspaceProductionTeam(
              rawEpisodeData.productionTeam,
              existingEpisodeData.productionTeam,
            ),
          }
        : rawEpisodeData;
      if (existing) {
         db.prepare(`
           UPDATE episodes 
           SET title = ?, data = ?, production_revision = production_revision + 1
           WHERE id = ? AND project_id = ?
         `).run(newTitle, JSON.stringify(epData), episodeId, projectId);
      } else {
         const maxOrderRow = db.prepare('SELECT MAX(order_index) as max_idx FROM episodes WHERE project_id = ?').get(projectId) as any;
         const newIdx = (maxOrderRow?.max_idx !== null && maxOrderRow?.max_idx !== undefined) ? maxOrderRow.max_idx + 1 : 0;
         db.prepare(`
           INSERT INTO episodes (id, project_id, title, data, order_index, production_revision)
           VALUES (?, ?, ?, ?, ?, 1)
         `).run(episodeId, projectId, newTitle, JSON.stringify(epData), newIdx);
      }

      if (Array.isArray(scenes)) {
        const existingScenes = db.prepare('SELECT id, data, order_index FROM scenes WHERE episode_id = ? ORDER BY order_index ASC').all(episodeId) as any[];
        const existingSceneData = new Map(existingScenes.map((scene) => [
          scene.id,
          JSON.parse(scene.data || '{}'),
        ]));
        if (!hasPartialSceneScope) {
          const incomingSceneIds = new Set(scenes.map(s => s.id));
          const deleteScene = db.prepare('DELETE FROM scenes WHERE id = ?');
          for (const sc of existingScenes) {
            if (!incomingSceneIds.has(sc.id)) deleteScene.run(sc.id);
          }
        }

        const upsertScene = db.prepare(`
          INSERT INTO scenes (id, episode_id, project_id, scene_number, title, data, order_index) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            scene_number=excluded.scene_number,
            title=excluded.title, 
            data=excluded.data,
            order_index=excluded.order_index
        `);
        const upsertShot = db.prepare(`
          INSERT INTO shots (id, scene_id, episode_id, project_id, data, order_index) 
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            data=excluded.data,
            order_index=excluded.order_index
        `);

        let scIdx = 0;
        for (const rawScene of scenes) {
          if (hasPartialSceneScope && rawScene.__workspaceSceneSummary) continue;
          const sc = __workspaceView
            ? mergeWorkspaceScene(rawScene, existingSceneData.get(rawScene.id) || {}, __workspaceView)
            : rawScene;
          const {
            id: scId,
            sceneNumber,
            title: scTitle,
            shots,
            shotCount: _shotCount,
            __workspaceSceneSummary: _workspaceSceneSummary,
            __workspaceBreakdownStatus: _workspaceBreakdownStatus,
            __workspaceShotPlanHash: _workspaceShotPlanHash,
            __workspaceImagePromptHash: _workspaceImagePromptHash,
            __workspaceVideoPromptHash: _workspaceVideoPromptHash,
            __workspaceVisualPromptHash: _workspaceVisualPromptHash,
            __workspaceVisualPromptSourceHash: _workspaceVisualPromptSourceHash,
            __workspaceHasImagePrompts: _workspaceHasImagePrompts,
            __workspaceHasVideoPrompts: _workspaceHasVideoPrompts,
            __workspaceHasVisualPrompts: _workspaceHasVisualPrompts,
            ...scData
          } = sc;
          const finalScId = scId || `sc_${Date.now()}_${Math.random()}`;
          assertProductionEntityOwner("scenes", finalScId, { project_id: projectId, episode_id: episodeId });
          const existingScene = existingScenes.find((item) => item.id === finalScId);
          const orderIndex = hasPartialSceneScope && existingScene
            ? Number(existingScene.order_index || 0)
            : scIdx;
          upsertScene.run(finalScId, episodeId, projectId, sceneNumber || '', scTitle || 'Untitled', JSON.stringify(scData), orderIndex);
          scIdx += 1;

          if (Array.isArray(shots)) {
            const existingShots = db.prepare('SELECT id, data FROM shots WHERE scene_id = ?').all(finalScId) as any[];
            const existingShotData = new Map(existingShots.map((shot) => [
              shot.id,
              JSON.parse(shot.data || '{}'),
            ]));
            const incomingShotIds = new Set(shots.map((sh: any) => sh.id));
            const deleteShot = db.prepare('DELETE FROM shots WHERE id = ?');
            if (!hasPartialShotScope) {
              for (const sh of existingShots) {
                if (!incomingShotIds.has(sh.id)) deleteShot.run(sh.id);
              }
            }

            const updateShotOrder = db.prepare(
              'UPDATE shots SET order_index = ? WHERE id = ? AND scene_id = ?',
            );
            let shIdx = 0;
            for (const sh of shots) {
              if (hasPartialShotScope && sh.__workspaceShotSummary) {
                updateShotOrder.run(shIdx++, sh.id, finalScId);
                continue;
              }
              const {
                id: shId,
                __workspaceShotSummary: _workspaceShotSummary,
                ...incomingShotData
              } = sh;
              const shData = hasPartialShotScope
                ? { ...(existingShotData.get(shId) || {}), ...incomingShotData }
                : incomingShotData;
              const finalShId = shId || `sh_${Date.now()}_${Math.random()}`;
              assertProductionEntityOwner("shots", finalShId, { project_id: projectId, episode_id: episodeId, scene_id: finalScId });
              upsertShot.run(finalShId, finalScId, episodeId, projectId, JSON.stringify(shData), shIdx++);
            }
          }
        }
      }
    });

    transaction();
    const saved = db.prepare('SELECT production_revision FROM episodes WHERE id = ? AND project_id = ?').get(episodeId, projectId) as { production_revision: number };
    return { ...updates, id: episodeId, title: newTitle, productionRevision: Number(saved.production_revision) };
  },

  listProductionRuns: (projectId?: string) => {
    const rows = projectId
      ? db.prepare('SELECT * FROM production_runs WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]
      : db.prepare('SELECT * FROM production_runs ORDER BY updated_at DESC').all() as any[];
    return rows.map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
  },

  getProductionRunById: (id: string) => {
    const row = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(id) as any;
    return row ? { id: row.id, ...JSON.parse(row.data) } : null;
  },

  saveProductionRun: (run: any) => {
    const baseRevisionFromRequest = run.__baseRevision;
    delete run.__baseRevision;
    const existing = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(run.id) as any;
    const existingRevision = existing ? Number(existing.revision ?? JSON.parse(existing.data || "{}").revision ?? 0) : undefined;
    const incomingRevision = Number(run.revision || 0);
    const baseRevision = typeof baseRevisionFromRequest === "number" ? baseRevisionFromRequest : Math.max(0, incomingRevision - 1);
    const incomingData = JSON.stringify(run);
    if (
      existing &&
      existingRevision !== undefined &&
      existingRevision > baseRevision &&
      existing.data !== incomingData
    ) {
      const error = new Error("Production run revision conflict");
      (error as any).statusCode = 409;
      (error as any).serverRun = { id: existing.id, ...JSON.parse(existing.data) };
      throw error;
    }
    const upsertRun = db.prepare(`
      INSERT INTO production_runs (id, project_id, project_title, mode, status, revision, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        project_title=excluded.project_title,
        mode=excluded.mode,
        status=excluded.status,
        revision=excluded.revision,
        updated_at=excluded.updated_at,
        data=excluded.data
    `);
    upsertRun.run(
      run.id,
      run.projectId || '',
      run.projectTitle || '',
      run.mode || '',
      run.status || '',
      incomingRevision,
      run.updatedAt || Date.now(),
      JSON.stringify(run),
    );
    return run;
  },

  deleteProductionRun: (id: string) => {
    db.prepare('DELETE FROM production_runs WHERE id = ?').run(id);
  },

  listOperatorRuns: (projectId?: string): OperatorRun[] => {
    const rows = projectId
      ? db.prepare('SELECT * FROM operator_runs WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]
      : db.prepare('SELECT * FROM operator_runs ORDER BY updated_at DESC').all() as any[];
    return rows.map((row) => JSON.parse(row.data));
  },

  getOperatorRunById: (id: string): OperatorRun | null => {
    const row = db.prepare('SELECT * FROM operator_runs WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },

  saveOperatorRun: (run: OperatorRun): OperatorRun => {
    const normalized = createOperatorRunRecord(run, run.handbookVersion);
    const upsertRun = db.prepare(`
      INSERT INTO operator_runs (id, project_id, provider, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        provider=excluded.provider,
        status=excluded.status,
        updated_at=excluded.updated_at,
        data=excluded.data
    `);
    upsertRun.run(
      normalized.id,
      normalized.projectId,
      normalized.provider,
      normalized.status,
      normalized.updatedAt,
      JSON.stringify(normalized),
    );
    return normalized;
  },

  patchOperatorRun: (id: string, updates: any): OperatorRun | null => {
    const existing = dbHelpers.getOperatorRunById(id);
    if (!existing) return null;
    return dbHelpers.saveOperatorRun(mergeOperatorRunPatch(existing, updates));
  },

  appendOperatorRunEvent: (id: string, event: any): OperatorRun | null => {
    const existing = dbHelpers.getOperatorRunById(id);
    if (!existing) return null;
    return dbHelpers.saveOperatorRun(appendOperatorEvent(existing, event));
  },

  listOperatorArtifacts: (filters: { projectId?: string; runId?: string } = {}): OperatorArtifactEnvelope[] => {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filters.projectId) {
      clauses.push('project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.runId) {
      clauses.push('run_id = ?');
      params.push(filters.runId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM operator_artifacts ${where} ORDER BY updated_at DESC`).all(...params) as any[];
    return rows.map((row) => JSON.parse(row.data));
  },

  getOperatorArtifactById: (id: string): OperatorArtifactEnvelope | null => {
    const row = db.prepare('SELECT * FROM operator_artifacts WHERE id = ?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },

  saveOperatorArtifact: (artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope => {
    const run = dbHelpers.getOperatorRunById(artifact.runId);
    if (!run) throw new Error(`Operator run not found for artifact: ${artifact.runId}`);
    const normalized = createOperatorArtifact(artifact, run);
    const upsertArtifact = db.prepare(`
      INSERT INTO operator_artifacts (id, project_id, run_id, kind, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        run_id=excluded.run_id,
        kind=excluded.kind,
        status=excluded.status,
        updated_at=excluded.updated_at,
        data=excluded.data
    `);
    upsertArtifact.run(
      normalized.id,
      normalized.projectId,
      normalized.runId,
      normalized.kind,
      normalized.status,
      normalized.updatedAt,
      JSON.stringify(normalized),
    );
    return normalized;
  },

  appendOperatorArtifactQA: (id: string, verdict: any): OperatorArtifactEnvelope | null => {
    const existing = dbHelpers.getOperatorArtifactById(id);
    if (!existing) return null;
    return dbHelpers.saveOperatorArtifact(appendOperatorArtifactQAVerdict(existing, verdict));
  },

  markOperatorArtifactCommitted: (
    id: string,
    commitResult: NonNullable<OperatorArtifactEnvelope["commitResult"]>,
  ): OperatorArtifactEnvelope | null => {
    const existing = dbHelpers.getOperatorArtifactById(id);
    if (!existing) return null;
    return dbHelpers.saveOperatorArtifact(markOperatorArtifactCommitted(existing, commitResult));
  },

  listOperatorAssets: (filters: { projectId?: string; runId?: string; artifactId?: string } = {}): OperatorRegisteredAsset[] => {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filters.projectId) {
      clauses.push('project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.runId) {
      clauses.push('run_id = ?');
      params.push(filters.runId);
    }
    if (filters.artifactId) {
      clauses.push('artifact_id = ?');
      params.push(filters.artifactId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM operator_assets ${where} ORDER BY updated_at DESC`).all(...params) as any[];
    return rows.map((row) => JSON.parse(row.data));
  },

  saveOperatorAsset: (asset: OperatorRegisteredAsset): OperatorRegisteredAsset => {
    const normalized = createOperatorRegisteredAsset(asset);
    const upsertAsset = db.prepare(`
      INSERT INTO operator_assets (id, project_id, run_id, artifact_id, kind, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        run_id=excluded.run_id,
        artifact_id=excluded.artifact_id,
        kind=excluded.kind,
        updated_at=excluded.updated_at,
        data=excluded.data
    `);
    upsertAsset.run(
      normalized.id,
      normalized.projectId,
      normalized.runId || '',
      normalized.artifactId || '',
      normalized.kind,
      normalized.updatedAt,
      JSON.stringify(normalized),
    );
    return normalized;
  },

  backupDatabase: () => {
    const backupPath = `${DB_PATH}.bak`;
    try {
      db.backup(backupPath)
        .then(() => console.log(`[DB] Successfully backed up database to ${backupPath}`))
        .catch((err) => console.error('[DB] Backup failed:', err));
      return true;
    } catch (e) {
      console.error('[DB] Backup initialization failed:', e);
      return false;
    }
  },

  previewUnusedMedia: (mediaDir: string) => previewUnusedMedia(db, mediaDir),
  garbageCollectMedia: async (mediaDir: string) => quarantineUnusedMedia(db, mediaDir),
  restoreRecycledMedia: (mediaDir: string) => restoreRecycledMedia(mediaDir),

  // Video Analysis Helpers
  getVideoAnalysisProjects: (page: number, limit: number, search: string) => {
    let query = 'SELECT id, title, type, updated_at, data FROM video_analysis_projects';
    let countQuery = 'SELECT COUNT(*) as count FROM video_analysis_projects';
    let params: any[] = [];
    
    if (search) {
      query += '   WHERE title LIKE ?';
      countQuery += ' WHERE title LIKE ?';
      params.push(`%${search}%`);
    }
    
    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    
    const count = db.prepare(countQuery).get(...params) as { count: number };
    const results = db.prepare(query).all(...params, limit, (page - 1) * limit) as any[];
    
    const projects = results.map(row => {
      const data = JSON.parse(row.data);
      const segmentsQuery = db.prepare('SELECT id, title, updated_at, data FROM video_analysis_segments WHERE project_id = ? ORDER BY id ASC');
      const segments = segmentsQuery.all(row.id) as any[];
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        updatedAt: row.updated_at,
        ...data,
        segments: segments.map(s => ({ id: s.id, title: s.title, ...JSON.parse(s.data) }))
      };
    });
    
    return { projects, total: count.count };
  },

  saveVideoAnalysisProject: (project: any) => {
    const { id, title, type, segments, ...restData } = project;
    const upsertProject = db.prepare(`
      INSERT INTO video_analysis_projects (id, title, type, data, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        title=excluded.title, 
        type=excluded.type, 
        data=excluded.data, 
        updated_at=CURRENT_TIMESTAMP
    `);
    
    const transaction = db.transaction(() => {
      upsertProject.run(id, title || 'Untitled', type || 'short-drama', JSON.stringify(restData));
      
      if (Array.isArray(segments)) {
        const existingSegments = db.prepare('SELECT id FROM video_analysis_segments WHERE project_id = ?').all(id) as any[];
        const incomingSegmentIds = new Set(segments.map(s => s.id));
        const deleteSegment = db.prepare('DELETE FROM video_analysis_segments WHERE id = ?');
        for (const seg of existingSegments) {
          if (!incomingSegmentIds.has(seg.id)) deleteSegment.run(seg.id);
        }

        const upsertSegment = db.prepare(`
          INSERT INTO video_analysis_segments (id, project_id, title, data, updated_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET 
            title=excluded.title,
            data=excluded.data,
            updated_at=CURRENT_TIMESTAMP
        `);
        for (const seg of segments) {
          const { id: segId, title: segTitle, ...segData } = seg;
          upsertSegment.run(segId, id, segTitle || 'Untitled', JSON.stringify(segData));
        }
      }
    });
    
    transaction();
    return project;
  },

  deleteVideoAnalysisProject: (id: string) => {
    db.prepare('DELETE FROM video_analysis_projects WHERE id = ?').run(id);
  },

  addVideoAnalysisSegment: (projectId: string, segment: any) => {
    const { id: segId, title: segTitle, ...segData } = segment;
    const upsertSegment = db.prepare(`
      INSERT INTO video_analysis_segments (id, project_id, title, data, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        title=excluded.title,
        data=excluded.data,
        updated_at=CURRENT_TIMESTAMP
    `);
    upsertSegment.run(segId, projectId, segTitle || 'Untitled', JSON.stringify(segData));
    
    // Update project timestamp
    db.prepare('UPDATE video_analysis_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
    return segment;
  },

  updateVideoAnalysisSegment: (projectId: string, segment: any) => {
    // Same as add, ON CONFLICT update handles it
    return dbHelpers.addVideoAnalysisSegment(projectId, segment);
  },

  deleteVideoAnalysisSegment: (projectId: string, segmentId: string) => {
    db.prepare('DELETE FROM video_analysis_segments WHERE id = ? AND project_id = ?').run(segmentId, projectId);
    db.prepare('UPDATE video_analysis_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
  }
};
