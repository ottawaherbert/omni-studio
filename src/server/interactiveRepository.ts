import { createHash, randomUUID } from 'node:crypto';

import { db, dbHelpers } from './db';
import { captureProductionMediaPlayback, sameArtifactRef } from './productionMediaTakeResolver';
import type { ManualStudioTakeAudit, Project, Scene, Shot } from '../types/project';
import {
  graphForPersistence,
  normalizeNarrativeGraph,
  normalizeStateSchema,
  normalizeStoryArchitecture,
} from '../domains/interactive/types/schema';
import type {
  CreateInteractiveExperienceInput,
  InteractiveExperience,
  ExperienceSpec,
  InteractiveExperienceAggregate,
  InteractiveExperienceStatus,
  GraphLayoutRevision,
  InteractivePlaytestCheckpoint,
  InteractiveRuntimeBuild,
  InteractiveVersionStatus,
  NarrativeGraphVersion,
  NodeContentBinding,
  NodeContentBindingVersion,
  StateSchema,
  StoryArchitecture,
  StorySourceBinding,
  VersionedInteractiveArtifact,
} from '../domains/interactive/types/schema';
import { auditNarrativeGraph } from '../domains/interactive/qa/graphQAEngine';
import type { InteractiveProductionPrepTarget } from '../domains/interactive/ports/productionPrepPort';
import { hasCurrentContentFitReview } from '../domains/interactive/binding/contentFitReview';
import {
  artifactRefListEquals,
  bindingMediaTakeRefs,
  bindingScriptSceneRefs,
} from '../domains/interactive/binding/nodeContentBinding';
import {
  bindingNeedsMediaReview,
  recommendBindingSourceReview,
  reconcileBindingSourceReview,
  type BindingSourceReviewReason,
} from '../domains/interactive/binding/sourceReview';
import { nodeRequiresMainContent, nodeRequiresMediaPlayback } from '../domains/interactive/nodeContentRequirements';
import { buildStructurePreviewPayload } from '../domains/interactive/builder/interactiveStructurePreviewBuild';
import { validateNarrativeGraph, validateStateSchema } from '../domains/interactive/validation/domainValidation';
import { validateStoryArchitecture, validateStoryArchitectureDraft } from '../domains/interactive/validation/storyArchitectureValidation';
import type { InteractiveGraphDraft } from '../domains/interactive/authoring/graphDraft';
import type { InteractiveContentPlanDraft } from '../domains/interactive/contentPlanning/contentPlan';
import type {
  InteractiveExecutionPolicy,
  InteractiveTaskCoordination,
  InteractiveTaskRef,
  InteractiveTaskStatus,
} from '../domains/interactive/authoring/taskCoordination';
import {
  computeVisualProjectionSourceFingerprint,
  refineInteractiveVisualScenario,
  validateInteractiveVisualContextProjection,
  type InteractiveVisualContextProjection,
} from '../domains/interactive/projection/interactiveVisualContextProjection';
import {
  stateSchemaAffectedNodeIds,
  stateSchemaChangeSet,
} from '../domains/interactive/projection/stateSchemaImpact';
import {
  recoverInterruptedInteractiveTaskRefs,
  retryInteractiveTaskRef,
  transitionInteractiveTaskRef,
  upsertInteractiveTaskRef,
} from '../domains/interactive/authoring/taskCoordination';

type VersionKind = 'experience_spec' | 'story_architecture' | 'state_schema' | 'graph';

interface ExperienceRow {
  id: string;
  project_id: string;
  title: string;
  genre: string;
  status: InteractiveExperienceStatus;
  current_experience_spec_version_id: string;
  current_story_architecture_version_id: string;
  current_state_schema_version_id: string;
  current_graph_version_id: string;
  created_at: string;
  updated_at: string;
  data: string;
}

interface VersionRow {
  id: string;
  experience_id: string;
  kind: VersionKind;
  version_index: number;
  status: InteractiveVersionStatus;
  created_at: string;
  updated_at: string;
  data: string;
}

interface BindingRow {
  id: string;
  experience_id: string;
  node_id: string;
  slot: NodeContentBinding['slot'];
  status: 'draft' | 'approved' | 'stale';
  created_at: string;
  updated_at: string;
  data: string;
  current_version_id?: string | null;
}

interface BindingVersionRow {
  id: string;
  binding_id: string;
  experience_id: string;
  node_id: string;
  slot: NodeContentBinding['slot'];
  version_index: number;
  status: 'draft' | 'approved' | 'stale';
  created_at: string;
  data: string;
}

interface ProductionPrepLinkRow {
  experience_id: string;
  source_writing_project_id: string;
  source_writing_revision: number;
  production_project_id: string;
  source_hash: string;
  created_at: string;
  updated_at: string;
}

interface RuntimeBuildRow {
  id: string;
  experience_id: string;
  status: InteractiveRuntimeBuild['status'];
  graph_version_id: string;
  graph_version_index: number;
  state_schema_version_id: string;
  state_schema_version_index: number;
  created_at: string;
  data: string;
}

interface PlaytestCheckpointRow {
  id: string;
  experience_id: string;
  playtest_kind: 'formal' | 'structure_preview';
  runtime_build_id: string | null;
  graph_version_id: string;
  state_schema_version_id: string;
  current_node_id: string;
  created_at: string;
  updated_at: string;
  data: string;
}

interface GraphLayoutRow {
  id: string;
  experience_id: string;
  version_index: number;
  created_at: string;
  updated_at: string;
  data: string;
}

interface GraphDraftRow {
  id: string;
  experience_id: string;
  status: InteractiveGraphDraft['status'];
  created_at: string;
  updated_at: string;
  data: string;
}

interface ContentPlanDraftRow {
  id: string;
  experience_id: string;
  status: InteractiveContentPlanDraft['status'];
  created_at: string;
  updated_at: string;
  data: string;
}

interface TaskCoordinationRow {
  experience_id: string;
  execution_policy: InteractiveExecutionPolicy;
  paused: number;
  updated_at: string;
  data: string;
}

interface VisualContextProjectionRow {
  id: string;
  experience_id: string;
  production_project_id: string;
  production_scene_id: string;
  status: InteractiveVisualContextProjection['status'];
  source_fingerprint: string;
  created_at: string;
  updated_at: string;
  data: string;
}

const now = () => new Date().toISOString();
const createId = (prefix: string) => `${prefix}_${randomUUID()}`;

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export function ensureInteractiveSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interactive_experiences (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      status TEXT NOT NULL,
      current_experience_spec_version_id TEXT NOT NULL,
      current_story_architecture_version_id TEXT NOT NULL,
      current_state_schema_version_id TEXT NOT NULL,
      current_graph_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_versions (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      version_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      UNIQUE(experience_id, kind, version_index)
    );

    CREATE TABLE IF NOT EXISTS interactive_node_content_bindings (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      current_version_id TEXT,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      UNIQUE(experience_id, node_id, slot)
    );

    CREATE TABLE IF NOT EXISTS interactive_node_content_binding_versions (
      id TEXT PRIMARY KEY,
      binding_id TEXT NOT NULL,
      experience_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      version_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      FOREIGN KEY(binding_id) REFERENCES interactive_node_content_bindings(id) ON DELETE CASCADE,
      UNIQUE(binding_id, version_index)
    );

    CREATE TABLE IF NOT EXISTS interactive_production_prep_links (
      experience_id TEXT NOT NULL,
      source_writing_project_id TEXT NOT NULL,
      source_writing_revision INTEGER NOT NULL,
      production_project_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (experience_id, source_writing_project_id, source_writing_revision),
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      FOREIGN KEY(production_project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_runtime_builds (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      status TEXT NOT NULL,
      graph_version_id TEXT NOT NULL,
      graph_version_index INTEGER NOT NULL,
      state_schema_version_id TEXT NOT NULL,
      state_schema_version_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_playtest_checkpoints (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      playtest_kind TEXT NOT NULL,
      runtime_build_id TEXT,
      graph_version_id TEXT NOT NULL,
      state_schema_version_id TEXT NOT NULL,
      current_node_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      UNIQUE(experience_id, playtest_kind)
    );

    CREATE TABLE IF NOT EXISTS interactive_graph_layout_versions (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      version_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      UNIQUE(experience_id, version_index)
    );

    CREATE TABLE IF NOT EXISTS interactive_graph_layout_current (
      experience_id TEXT PRIMARY KEY,
      current_layout_version_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
      FOREIGN KEY(current_layout_version_id) REFERENCES interactive_graph_layout_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_graph_drafts (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_content_plan_drafts (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_task_coordination (
      experience_id TEXT PRIMARY KEY,
      execution_policy TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interactive_visual_context_projections (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL,
      production_project_id TEXT NOT NULL,
      production_scene_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interactive_versions_experience
      ON interactive_versions(experience_id, kind, version_index DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_bindings_experience
      ON interactive_node_content_bindings(experience_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_interactive_binding_versions_binding
      ON interactive_node_content_binding_versions(binding_id, version_index DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_prep_links_experience
      ON interactive_production_prep_links(experience_id);
    CREATE INDEX IF NOT EXISTS idx_interactive_runtime_builds_experience
      ON interactive_runtime_builds(experience_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_graph_layout_versions_experience
      ON interactive_graph_layout_versions(experience_id, version_index DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_graph_drafts_experience
      ON interactive_graph_drafts(experience_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_content_plan_drafts_experience
      ON interactive_content_plan_drafts(experience_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interactive_visual_context_experience
      ON interactive_visual_context_projections(experience_id, production_project_id, production_scene_id);
  `);

  const bindingColumns = db.prepare('PRAGMA table_info(interactive_node_content_bindings)').all() as Array<{ name: string }>;
  if (!bindingColumns.some((column) => column.name === 'current_version_id')) {
    db.exec('ALTER TABLE interactive_node_content_bindings ADD COLUMN current_version_id TEXT');
  }

  const checkpointColumns = db.prepare('PRAGMA table_info(interactive_playtest_checkpoints)').all() as Array<{ name: string }>;
  if (!checkpointColumns.some((column) => column.name === 'playtest_kind')) {
    db.exec(`
      ALTER TABLE interactive_playtest_checkpoints RENAME TO interactive_playtest_checkpoints_legacy;

      CREATE TABLE interactive_playtest_checkpoints (
        id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL,
        playtest_kind TEXT NOT NULL,
        runtime_build_id TEXT,
        graph_version_id TEXT NOT NULL,
        state_schema_version_id TEXT NOT NULL,
        current_node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data JSON NOT NULL,
        FOREIGN KEY(experience_id) REFERENCES interactive_experiences(id) ON DELETE CASCADE,
        UNIQUE(experience_id, playtest_kind)
      );

      INSERT INTO interactive_playtest_checkpoints (
        id, experience_id, playtest_kind, runtime_build_id, graph_version_id,
        state_schema_version_id, current_node_id, created_at, updated_at, data
      )
      SELECT
        checkpoint.id,
        checkpoint.experience_id,
        CASE COALESCE(json_extract(build.data, '$.kind'), 'formal')
          WHEN 'structure_preview' THEN 'structure_preview'
          ELSE 'formal'
        END,
        checkpoint.runtime_build_id,
        checkpoint.graph_version_id,
        checkpoint.state_schema_version_id,
        checkpoint.current_node_id,
        checkpoint.created_at,
        checkpoint.updated_at,
        checkpoint.data
      FROM interactive_playtest_checkpoints_legacy checkpoint
      LEFT JOIN interactive_runtime_builds build ON build.id = checkpoint.runtime_build_id;

      DROP TABLE interactive_playtest_checkpoints_legacy;
    `);
  }

  const legacyHeads = db.prepare(`
    SELECT * FROM interactive_node_content_bindings
    WHERE current_version_id IS NULL
  `).all() as BindingRow[];
  legacyHeads.forEach((row) => {
    const versionId = createId('binding_version');
    const parsed = parseJson<NodeContentBinding>(row.data);
    const scriptSceneRefs = bindingScriptSceneRefs(parsed);
    const mediaTakeRefs = bindingMediaTakeRefs(parsed);
    const data = JSON.stringify({
      ...parsed,
      versionIndex: 1,
      scriptSceneRefs,
      scriptSceneRef: undefined,
      mediaTakeRefs,
      mediaTakeRef: undefined,
    });
    db.prepare(`
      INSERT INTO interactive_node_content_binding_versions
        (id, binding_id, experience_id, node_id, slot, version_index, status, created_at, data)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(versionId, row.id, row.experience_id, row.node_id, row.slot, row.status, row.updated_at, data);
    db.prepare(`
      UPDATE interactive_node_content_bindings
      SET current_version_id = ?, data = ?
      WHERE id = ?
    `).run(versionId, data, row.id);
  });
}

const toProductionPrepTarget = (row: ProductionPrepLinkRow, status: InteractiveProductionPrepTarget['status'] = 'reused'): InteractiveProductionPrepTarget => ({
  experienceId: row.experience_id,
  productionProjectId: row.production_project_id,
  sourceWritingProjectId: row.source_writing_project_id,
  sourceWritingRevision: Number(row.source_writing_revision),
  sourceHash: row.source_hash,
  status,
});

const toExperience = (row: ExperienceRow): InteractiveExperience => {
  const data = parseJson<Pick<InteractiveExperience, 'formatProfile' | 'storySource' | 'productionBoundary'>>(row.data);
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    genre: row.genre,
    status: row.status,
    formatProfile: data.formatProfile,
    storySource: data.storySource,
    productionBoundary: data.productionBoundary,
    currentExperienceSpecVersionId: row.current_experience_spec_version_id,
    currentStoryArchitectureVersionId: row.current_story_architecture_version_id,
    currentStateSchemaVersionId: row.current_state_schema_version_id,
    currentGraphVersionId: row.current_graph_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toGraphDraft = (row: GraphDraftRow): InteractiveGraphDraft => ({
  ...parseJson<InteractiveGraphDraft>(row.data),
  id: row.id,
  experienceId: row.experience_id,
  status: row.status,
  createdAt: row.created_at,
});

const toContentPlanDraft = (row: ContentPlanDraftRow): InteractiveContentPlanDraft => ({
  ...parseJson<InteractiveContentPlanDraft>(row.data),
  id: row.id,
  experienceId: row.experience_id,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toVisualContextProjection = (
  row: VisualContextProjectionRow,
): InteractiveVisualContextProjection => ({
  ...parseJson<InteractiveVisualContextProjection>(row.data),
  id: row.id,
  experienceId: row.experience_id,
  productionProjectId: row.production_project_id,
  productionSceneId: row.production_scene_id,
  sourceFingerprint: row.source_fingerprint,
  status: row.status,
});

const toRuntimeBuild = (row: RuntimeBuildRow): InteractiveRuntimeBuild => {
  const data = parseJson<Pick<InteractiveRuntimeBuild,
    'nodeManifests'
    | 'missingMediaNodeIds'
    | 'pendingMediaReviewNodeIds'
    | 'graphSnapshot'
    | 'stateSchemaSnapshot'
    | 'experienceSpecSnapshot'
    | 'nodeChapterIds'
    | 'qaWarnings'
    | 'kind'
    | 'previewTextByNodeId'
    | 'warningNodeIds'
    | 'staleReason'
  >>(row.data);
  const hasExecutableSnapshot = Boolean(data.graphSnapshot && data.stateSchemaSnapshot);
  return {
    id: row.id,
    experienceId: row.experience_id,
    kind: data.kind || 'formal',
    status: hasExecutableSnapshot ? row.status : 'stale',
    graphVersionId: row.graph_version_id,
    graphVersionIndex: Number(row.graph_version_index),
    stateSchemaVersionId: row.state_schema_version_id,
    stateSchemaVersionIndex: Number(row.state_schema_version_index),
    nodeManifests: data.nodeManifests.map((manifest) => ({
      ...manifest,
      scriptSceneRefs: manifest.scriptSceneRefs?.length
        ? manifest.scriptSceneRefs
        : manifest.scriptSceneRef ? [manifest.scriptSceneRef] : [],
      // Builds created before capability-aware content requirements assumed
      // that every node played media. Preserve that conservative behavior.
      requiresMedia: manifest.requiresMedia ?? true,
      // Reads created before multi-take support remain usable without a data migration.
      mediaTakeRefs: manifest.mediaTakeRefs?.length
        ? manifest.mediaTakeRefs
        : (manifest as { mediaTakeRef?: InteractiveRuntimeBuild['nodeManifests'][number]['mediaTakeRefs'][number] }).mediaTakeRef
          ? [(manifest as { mediaTakeRef?: InteractiveRuntimeBuild['nodeManifests'][number]['mediaTakeRefs'][number] }).mediaTakeRef!]
          : [],
    })),
    missingMediaNodeIds: data.missingMediaNodeIds,
    pendingMediaReviewNodeIds: data.pendingMediaReviewNodeIds || [],
    previewTextByNodeId: data.previewTextByNodeId,
    warningNodeIds: data.warningNodeIds || [],
    graphSnapshot: data.graphSnapshot,
    stateSchemaSnapshot: data.stateSchemaSnapshot,
    experienceSpecSnapshot: data.experienceSpecSnapshot,
    nodeChapterIds: data.nodeChapterIds,
    qaWarnings: data.qaWarnings,
    staleReason: hasExecutableSnapshot
      ? data.staleReason
      : '该试玩创建于旧合同之前，不能保证回放一致性。请重新开始试玩。',
    createdAt: row.created_at,
  };
};

const toPlaytestCheckpoint = (row: PlaytestCheckpointRow): InteractivePlaytestCheckpoint => ({
  id: row.id,
  experienceId: row.experience_id,
  runtimeBuildId: row.runtime_build_id || undefined,
  kind: row.playtest_kind || 'formal',
  graphVersionId: row.graph_version_id,
  stateSchemaVersionId: row.state_schema_version_id,
  currentNodeId: row.current_node_id,
  state: parseJson<InteractivePlaytestCheckpoint['state']>(row.data),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toVersion = <T>(row: VersionRow): VersionedInteractiveArtifact<T> => ({
  id: row.id,
  experienceId: row.experience_id,
  versionIndex: row.version_index,
  status: row.status,
  data: parseJson<T>(row.data),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getExperienceRow = (experienceId: string) =>
  db.prepare('SELECT * FROM interactive_experiences WHERE id = ?').get(experienceId) as ExperienceRow | undefined;

const getVersionRow = (versionId: string) =>
  db.prepare('SELECT * FROM interactive_versions WHERE id = ?').get(versionId) as VersionRow | undefined;

const toGraphLayoutRevision = (row: GraphLayoutRow): GraphLayoutRevision => ({
  ...parseJson<Pick<GraphLayoutRevision, 'nodes' | 'viewport'>>(row.data),
  id: row.id,
  experienceId: row.experience_id,
  versionIndex: row.version_index,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getCurrentGraphLayoutRow = (experienceId: string) => db.prepare(`
  SELECT layout.*
  FROM interactive_graph_layout_current current
  JOIN interactive_graph_layout_versions layout ON layout.id = current.current_layout_version_id
  WHERE current.experience_id = ?
`).get(experienceId) as GraphLayoutRow | undefined;

const ensureGraphLayoutRow = (experienceId: string): GraphLayoutRow => {
  const existing = getCurrentGraphLayoutRow(experienceId);
  if (existing) return existing;
  db.transaction(() => {
    if (getCurrentGraphLayoutRow(experienceId)) return;
    const id = insertGraphLayoutRevision(experienceId, 1, { nodes: {} });
    db.prepare(`
      INSERT INTO interactive_graph_layout_current
        (experience_id, current_layout_version_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(experience_id) DO NOTHING
    `).run(experienceId, id, now());
  })();
  const initialized = getCurrentGraphLayoutRow(experienceId);
  if (!initialized) throw new Error('Failed to initialize graph layout');
  return initialized;
};

const insertGraphLayoutRevision = (
  experienceId: string,
  versionIndex: number,
  layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>,
) => {
  const id = createId('graph_layout');
  const timestamp = now();
  db.prepare(`
    INSERT INTO interactive_graph_layout_versions
      (id, experience_id, version_index, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, experienceId, versionIndex, timestamp, timestamp, JSON.stringify({ nodes: layout.nodes, viewport: layout.viewport }));
  return id;
};

const validateGraphLayout = (layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>): string[] => {
  const issues: string[] = [];
  Object.entries(layout.nodes || {}).forEach(([nodeId, position]) => {
    if (!nodeId.trim()) issues.push('布局中不能存在空节点 ID');
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      issues.push(`节点“${nodeId || 'unknown'}”的画布坐标无效`);
    }
  });
  if (layout.viewport && (!Number.isFinite(layout.viewport.x)
    || !Number.isFinite(layout.viewport.y)
    || !Number.isFinite(layout.viewport.zoom)
    || layout.viewport.zoom <= 0)) {
    issues.push('画布视口无效');
  }
  return issues;
};

const bindingForRead = (row: Pick<BindingRow, 'id' | 'experience_id' | 'node_id' | 'slot' | 'status' | 'updated_at' | 'data'>): NodeContentBinding => {
  const parsed = parseJson<NodeContentBinding>(row.data);
  const scriptSceneRefs = bindingScriptSceneRefs(parsed);
  const mediaTakeRefs = bindingMediaTakeRefs(parsed);
  return {
    ...parsed,
    id: row.id,
    versionIndex: parsed.versionIndex || 1,
    experienceId: row.experience_id,
    nodeId: row.node_id,
    slot: row.slot,
    scriptSceneRefs,
    scriptSceneRef: scriptSceneRefs[0],
    mediaTakeRefs,
    mediaTakeRef: mediaTakeRefs[0],
    status: row.status,
    updatedAt: row.updated_at,
  };
};

const listBindings = (experienceId: string): NodeContentBinding[] =>
  (db.prepare(
    'SELECT * FROM interactive_node_content_bindings WHERE experience_id = ? ORDER BY node_id, slot',
  ).all(experienceId) as BindingRow[]).map(bindingForRead);

const markBindingsReviewRecommended = (
  experienceId: string,
  bindings: NodeContentBinding[],
  reasons: BindingSourceReviewReason[],
  timestamp: string,
) => {
  bindings.forEach((binding) => {
    db.prepare(`
      UPDATE interactive_node_content_bindings
      SET updated_at = ?, data = ?
      WHERE experience_id = ? AND node_id = ? AND slot = ?
    `).run(
      timestamp,
      JSON.stringify({
        ...recommendBindingSourceReview(binding, reasons, timestamp),
        updatedAt: undefined,
      }),
      experienceId,
      binding.nodeId,
      binding.slot,
    );
  });
};

const recommendTakeSourceReview = (
  audit: ManualStudioTakeAudit | undefined,
  reason: 'project_source_updated' | 'visual_style_updated',
  detectedAt: number,
): ManualStudioTakeAudit | undefined => audit ? ({
  ...audit,
  sourceReview: {
    status: 'review_recommended' as const,
    reasons: [...new Set([
      ...(audit.sourceReview?.status === 'review_recommended' ? audit.sourceReview.reasons : []),
      reason,
    ])],
    detectedAt,
  },
}) : audit;

const markShotVisualReviewRecommended = (
  shot: Shot,
  reason: 'project_source_updated' | 'visual_style_updated',
  detectedAt: number,
): Shot => ({
  ...shot,
  takes: (shot.takes || []).map((take) => ({
    ...take,
    generationAudit: recommendTakeSourceReview(take.generationAudit, reason, detectedAt),
  })),
});

const markProductionSceneVisualOutputsReviewRecommended = (
  projectSceneIds: Map<string, Set<string>>,
  reason: 'project_source_updated' | 'visual_style_updated',
) => {
  const detectedAt = Date.now();
  for (const [projectId, sceneIds] of projectSceneIds) {
    const project = dbHelpers.getProjectById(projectId) as Project | null;
    if (!project) continue;
    let changed = false;
    const episodes = project.episodes.map((episode) => ({
      ...episode,
      scenes: ((episode as Project['episodes'][number] & { scenes?: any[] }).scenes || []).map((scene) => {
        if (!sceneIds.has(scene.id)) return scene;
        changed = true;
        const manualStoryboard = scene.manualStoryboard ? {
          ...scene.manualStoryboard,
          boards: (scene.manualStoryboard.boards || []).map((workflow: any) => ({
            ...workflow,
            takes: (workflow.takes || []).map((take: any) => ({
              ...take,
              generationAudit: recommendTakeSourceReview(take.generationAudit, reason, detectedAt),
            })),
          })),
        } : undefined;
        return {
          ...scene,
          shots: (scene.shots || []).map((shot: Shot) => (
            markShotVisualReviewRecommended(shot, reason, detectedAt)
          )),
          manualStoryboard,
        };
      }),
    }));
    if (!changed) continue;
    dbHelpers.saveProject({
      ...project,
      episodes,
      interactiveMediaPlanDrafts: (project.interactiveMediaPlanDrafts || []).map((plan) => {
        const referencesAffectedScene = plan.selections.some((selection) => (
          selection.takeRefs.some((ref) => [...sceneIds].some((sceneId) => ref.artifactId.includes(`:${sceneId}:`)))
        ));
        return referencesAffectedScene && plan.status === 'candidate'
          ? { ...plan, status: 'stale' as const, updatedAt: Date.now() }
          : plan;
      }),
    });
  }
};

const markBindingMediaReviewRecommended = (
  experienceId: string,
  affectedNodeIds: ReadonlySet<string>,
) => {
  const timestamp = now();
  listBindings(experienceId).forEach((binding) => {
    if (!affectedNodeIds.has(binding.nodeId) || bindingMediaTakeRefs(binding).length === 0) return;
    db.prepare(`
      UPDATE interactive_node_content_bindings
      SET updated_at = ?, data = ?
      WHERE experience_id = ? AND node_id = ? AND slot = ?
    `).run(
      timestamp,
      JSON.stringify({
        ...recommendBindingSourceReview(binding, ['visual_projection_updated'], timestamp),
        updatedAt: undefined,
      }),
      experienceId,
      binding.nodeId,
      binding.slot,
    );
  });
};

const markContentPlansStale = (experienceId: string) => {
  const timestamp = now();
  const rows = db.prepare(`
    SELECT * FROM interactive_content_plan_drafts
    WHERE experience_id = ? AND status = 'candidate'
  `).all(experienceId) as ContentPlanDraftRow[];
  rows.forEach((row) => {
    const draft = parseJson<InteractiveContentPlanDraft>(row.data);
    db.prepare(`
      UPDATE interactive_content_plan_drafts
      SET status = 'stale', updated_at = ?, data = ?
      WHERE id = ?
    `).run(timestamp, JSON.stringify({ ...draft, status: 'stale', updatedAt: timestamp }), row.id);
  });
};

const markVisualContextProjectionsStale = (
  experienceId: string,
  reasonNodeIds?: ReadonlySet<string>,
) => {
  const timestamp = now();
  const affectedNodeIds = new Set<string>();
  const affectedProductionScenes = new Map<string, Set<string>>();
  const rows = db.prepare(`
    SELECT * FROM interactive_visual_context_projections
    WHERE experience_id = ? AND status != 'stale'
  `).all(experienceId) as VisualContextProjectionRow[];
  rows.forEach((row) => {
    const projection = toVisualContextProjection(row);
    if (reasonNodeIds && !projection.nodeIds.some((nodeId) => reasonNodeIds.has(nodeId))) return;
    projection.nodeIds.forEach((nodeId) => affectedNodeIds.add(nodeId));
    affectedProductionScenes.set(projection.productionProjectId, new Set([
      ...(affectedProductionScenes.get(projection.productionProjectId) || []),
      projection.productionSceneId,
    ]));
    db.prepare(`
      UPDATE interactive_visual_context_projections
      SET status = 'stale', updated_at = ?, data = ?
      WHERE id = ?
    `).run(
      timestamp,
      JSON.stringify({ ...projection, status: 'stale' }),
      row.id,
    );
  });
  if (affectedNodeIds.size > 0) {
    markBindingMediaReviewRecommended(experienceId, affectedNodeIds);
    markProductionSceneVisualOutputsReviewRecommended(
      affectedProductionScenes,
      'project_source_updated',
    );
  }
};

const rebaseUnchangedVisualContextProjections = (
  experienceId: string,
  affectedNodeIds: ReadonlySet<string>,
  nextGraphVersionId: string,
) => {
  const timestamp = now();
  const rows = db.prepare(`
    SELECT * FROM interactive_visual_context_projections
    WHERE experience_id = ? AND status != 'stale'
  `).all(experienceId) as VisualContextProjectionRow[];
  rows.forEach((row) => {
    const projection = toVisualContextProjection(row);
    if (projection.nodeIds.some((nodeId) => affectedNodeIds.has(nodeId))) return;
    const sourceFingerprint = computeVisualProjectionSourceFingerprint({
      graphVersionId: nextGraphVersionId,
      stateSchemaVersionId: projection.stateSchemaVersionId,
      bindingVersionIds: projection.bindingVersionIds,
      productionProjectId: projection.productionProjectId,
      source: {
        productionSceneId: projection.productionSceneId,
        nodeIds: projection.nodeIds,
        continuityIn: projection.scenarios.flatMap((scenario) => scenario.continuityIn),
        continuityOut: projection.scenarios.flatMap((scenario) => scenario.continuityOut),
        canonicalAssetRefs: projection.scenarios.flatMap((scenario) => scenario.canonicalAssetRefs),
        characterVariantRefs: projection.scenarios.flatMap((scenario) => scenario.characterVariantRefs),
        assetVariantRefs: projection.scenarios.flatMap((scenario) => scenario.assetVariantRefs),
        environmentChanges: projection.scenarios.flatMap((scenario) => scenario.environmentChanges),
        performanceConstraints: projection.scenarios.flatMap((scenario) => scenario.performanceConstraints),
      },
    });
    const rebased = {
      ...projection,
      graphVersionId: nextGraphVersionId,
      sourceFingerprint,
    };
    db.prepare(`
      UPDATE interactive_visual_context_projections
      SET source_fingerprint = ?, updated_at = ?, data = ?
      WHERE id = ?
    `).run(sourceFingerprint, timestamp, JSON.stringify(rebased), row.id);
  });
};

const persistedVisualStateAffectedNodeIds = (
  experienceId: string,
  previous: StateSchema,
  next: StateSchema,
) => {
  const changed = stateSchemaChangeSet(previous, next);
  const affectedNodeIds = new Set<string>();
  const rows = db.prepare(`
    SELECT * FROM interactive_visual_context_projections
    WHERE experience_id = ? AND status != 'stale'
  `).all(experienceId) as VisualContextProjectionRow[];
  rows.forEach((row) => {
    const projection = toVisualContextProjection(row);
    const directlyAffected = projection.scenarios.some((scenario) => (
      scenario.observableFacts.some((fact) => changed.facts.has(fact))
      || Object.keys(scenario.observableVariables || {}).some((key) => changed.variables.has(key))
    ));
    if (directlyAffected) projection.nodeIds.forEach((nodeId) => affectedNodeIds.add(nodeId));
  });
  return affectedNodeIds;
};

const rebaseUnchangedVisualContextProjectionsForState = (
  experienceId: string,
  affectedNodeIds: ReadonlySet<string>,
  nextStateSchemaVersionId: string,
) => {
  const timestamp = now();
  const rows = db.prepare(`
    SELECT * FROM interactive_visual_context_projections
    WHERE experience_id = ? AND status != 'stale'
  `).all(experienceId) as VisualContextProjectionRow[];
  rows.forEach((row) => {
    const projection = toVisualContextProjection(row);
    if (projection.nodeIds.some((nodeId) => affectedNodeIds.has(nodeId))) return;
    const sourceFingerprint = computeVisualProjectionSourceFingerprint({
      graphVersionId: projection.graphVersionId,
      stateSchemaVersionId: nextStateSchemaVersionId,
      bindingVersionIds: projection.bindingVersionIds,
      productionProjectId: projection.productionProjectId,
      source: {
        productionSceneId: projection.productionSceneId,
        nodeIds: projection.nodeIds,
        continuityIn: projection.scenarios.flatMap((scenario) => scenario.continuityIn),
        continuityOut: projection.scenarios.flatMap((scenario) => scenario.continuityOut),
        canonicalAssetRefs: projection.scenarios.flatMap((scenario) => scenario.canonicalAssetRefs),
        characterVariantRefs: projection.scenarios.flatMap((scenario) => scenario.characterVariantRefs),
        assetVariantRefs: projection.scenarios.flatMap((scenario) => scenario.assetVariantRefs),
        environmentChanges: projection.scenarios.flatMap((scenario) => scenario.environmentChanges),
        performanceConstraints: projection.scenarios.flatMap((scenario) => scenario.performanceConstraints),
      },
    });
    const rebased = {
      ...projection,
      stateSchemaVersionId: nextStateSchemaVersionId,
      sourceFingerprint,
    };
    db.prepare(`
      UPDATE interactive_visual_context_projections
      SET source_fingerprint = ?, updated_at = ?, data = ?
      WHERE id = ?
    `).run(sourceFingerprint, timestamp, JSON.stringify(rebased), row.id);
  });
};

const requireAggregate = (experienceId: string): InteractiveExperienceAggregate => {
  const row = getExperienceRow(experienceId);
  if (!row) throw Object.assign(new Error('Interactive experience not found'), { statusCode: 404 });

  const experience = toExperience(row);
  const experienceSpecRow = getVersionRow(experience.currentExperienceSpecVersionId);
  const storyArchitectureRow = getVersionRow(experience.currentStoryArchitectureVersionId);
  const stateSchemaRow = getVersionRow(experience.currentStateSchemaVersionId);
  const graphRow = getVersionRow(experience.currentGraphVersionId);
  if (!experienceSpecRow || !storyArchitectureRow || !stateSchemaRow || !graphRow) {
    throw new Error('Interactive experience version pointers are incomplete');
  }
  const storyArchitecture = toVersion<StoryArchitecture>(storyArchitectureRow);

  return {
    experience,
    experienceSpec: toVersion(experienceSpecRow),
    storyArchitecture: {
      ...storyArchitecture,
      data: normalizeStoryArchitecture(storyArchitecture.data),
    },
    stateSchema: toVersion<StateSchema>(stateSchemaRow),
    graph: {
      ...normalizeNarrativeGraph(parseJson<NarrativeGraphVersion>(graphRow.data)),
      id: graphRow.id,
      experienceId,
      versionIndex: graphRow.version_index,
      status: graphRow.status,
      locked: graphRow.status === 'locked',
      createdAt: graphRow.created_at,
      updatedAt: graphRow.updated_at,
    },
    bindings: listBindings(experienceId),
  };
};

const insertVersion = (
  experienceId: string,
  kind: VersionKind,
  versionIndex: number,
  status: InteractiveVersionStatus,
  data: unknown,
) => {
  const id = createId(kind);
  const timestamp = now();
  db.prepare(`
    INSERT INTO interactive_versions
      (id, experience_id, kind, version_index, status, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, experienceId, kind, versionIndex, status, timestamp, timestamp, JSON.stringify(data ?? {}));
  return id;
};

export const interactiveRepository = {
  getTaskCoordination(experienceId: string): InteractiveTaskCoordination {
    requireAggregate(experienceId);
    const row = db.prepare(`
      SELECT * FROM interactive_task_coordination WHERE experience_id = ?
    `).get(experienceId) as TaskCoordinationRow | undefined;
    if (!row) {
      return {
        experienceId,
        executionPolicy: 'autopilot',
        taskRefs: [],
        adoptionRuns: [],
        paused: false,
        updatedAt: now(),
      };
    }
    const data = parseJson<{
      taskRefs?: InteractiveTaskRef[];
      adoptionRuns?: InteractiveTaskCoordination['adoptionRuns'];
    }>(row.data);
    return {
      experienceId,
      executionPolicy: row.execution_policy,
      taskRefs: Array.isArray(data.taskRefs)
        ? data.taskRefs.map((task) => ({
          ...task,
          // Legacy refs were written only after their domain operation had returned.
          status: task.status || 'completed',
          attempt: task.attempt || 1,
          updatedAt: task.updatedAt || row.updated_at,
        }))
        : [],
      adoptionRuns: Array.isArray(data.adoptionRuns) ? data.adoptionRuns : [],
      paused: Boolean(row.paused),
      updatedAt: row.updated_at,
    };
  },

  saveTaskCoordination(
    experienceId: string,
    patch: Partial<Pick<InteractiveTaskCoordination, 'executionPolicy' | 'taskRefs' | 'adoptionRuns' | 'paused'>>,
  ): InteractiveTaskCoordination {
    const current = this.getTaskCoordination(experienceId);
    const next: InteractiveTaskCoordination = {
      ...current,
      ...patch,
      experienceId,
      taskRefs: patch.taskRefs || current.taskRefs,
      adoptionRuns: patch.adoptionRuns || current.adoptionRuns,
      updatedAt: now(),
    };
    db.prepare(`
      INSERT INTO interactive_task_coordination
        (experience_id, execution_policy, paused, updated_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(experience_id) DO UPDATE SET
        execution_policy = excluded.execution_policy,
        paused = excluded.paused,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      experienceId,
      next.executionPolicy,
      next.paused ? 1 : 0,
      next.updatedAt,
      JSON.stringify({ taskRefs: next.taskRefs, adoptionRuns: next.adoptionRuns }),
    );
    return next;
  },

  recoverInterruptedTasks(experienceId: string, at = Date.now()): InteractiveTaskCoordination {
    const current = this.getTaskCoordination(experienceId);
    void at;
    const taskRefs = recoverInterruptedInteractiveTaskRefs(current.taskRefs);
    return taskRefs === current.taskRefs
      ? current
      : this.saveTaskCoordination(experienceId, { taskRefs });
  },

  addTaskRef(experienceId: string, taskRef: InteractiveTaskRef): InteractiveTaskCoordination {
    const current = this.getTaskCoordination(experienceId);
    return this.saveTaskCoordination(experienceId, {
      taskRefs: upsertInteractiveTaskRef(current.taskRefs, taskRef),
    });
  },

  updateTaskRef(
    experienceId: string,
    taskId: string,
    status: InteractiveTaskStatus,
    options: { error?: string; replacementTaskId?: string } = {},
  ): InteractiveTaskCoordination {
    const current = this.getTaskCoordination(experienceId);
    if (!current.taskRefs.some((task) => task.taskId === taskId)) {
      throw Object.assign(new Error('互动创作任务不存在'), { statusCode: 404 });
    }
    return this.saveTaskCoordination(experienceId, {
      taskRefs: transitionInteractiveTaskRef(current.taskRefs, taskId, status, options),
    });
  },

  retryTaskRef(
    experienceId: string,
    taskId: string,
    replacementTaskId: string,
  ): InteractiveTaskCoordination {
    const current = this.getTaskCoordination(experienceId);
    return this.saveTaskCoordination(experienceId, {
      taskRefs: retryInteractiveTaskRef(current.taskRefs, taskId, replacementTaskId),
    });
  },

  listExperiences(): InteractiveExperience[] {
    return (db.prepare(
      'SELECT * FROM interactive_experiences ORDER BY updated_at DESC',
    ).all() as ExperienceRow[]).map(toExperience);
  },

  getExperience(experienceId: string): InteractiveExperienceAggregate {
    return requireAggregate(experienceId);
  },

  listBindingVersions(
    experienceId: string,
    nodeId: string,
    slot: NodeContentBinding['slot'],
  ): NodeContentBindingVersion[] {
    requireAggregate(experienceId);
    return (db.prepare(`
      SELECT * FROM interactive_node_content_binding_versions
      WHERE experience_id = ? AND node_id = ? AND slot = ?
      ORDER BY version_index DESC
    `).all(experienceId, nodeId, slot) as BindingVersionRow[]).map((row) => bindingForRead({
      id: row.binding_id,
      experience_id: row.experience_id,
      node_id: row.node_id,
      slot: row.slot,
      status: row.status,
      updated_at: row.created_at,
      data: row.data,
    }) as NodeContentBindingVersion);
  },

  saveGraphDraft(draft: InteractiveGraphDraft): InteractiveGraphDraft {
    requireAggregate(draft.experienceId);
    const timestamp = now();
    db.prepare(`
      INSERT INTO interactive_graph_drafts
        (id, experience_id, status, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      draft.id,
      draft.experienceId,
      draft.status,
      draft.createdAt,
      timestamp,
      JSON.stringify(draft),
    );
    return draft;
  },

  getGraphDraft(experienceId: string, draftId: string): InteractiveGraphDraft {
    const row = db.prepare(`
      SELECT * FROM interactive_graph_drafts
      WHERE id = ? AND experience_id = ?
    `).get(draftId, experienceId) as GraphDraftRow | undefined;
    if (!row) throw Object.assign(new Error('Graph Draft 不存在或已被清理'), { statusCode: 404 });
    return toGraphDraft(row);
  },

  getLatestGraphDraft(experienceId: string): InteractiveGraphDraft | null {
    requireAggregate(experienceId);
    const row = db.prepare(`
      SELECT * FROM interactive_graph_drafts
      WHERE experience_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(experienceId) as GraphDraftRow | undefined;
    return row ? toGraphDraft(row) : null;
  },

  saveContentPlanDraft(draft: InteractiveContentPlanDraft): InteractiveContentPlanDraft {
    requireAggregate(draft.experienceId);
    const timestamp = now();
    db.prepare(`
      INSERT INTO interactive_content_plan_drafts
        (id, experience_id, status, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      draft.id,
      draft.experienceId,
      draft.status,
      draft.createdAt,
      timestamp,
      JSON.stringify({ ...draft, updatedAt: timestamp }),
    );
    return this.getContentPlanDraft(draft.experienceId, draft.id);
  },

  getContentPlanDraft(experienceId: string, draftId: string): InteractiveContentPlanDraft {
    requireAggregate(experienceId);
    const row = db.prepare(`
      SELECT * FROM interactive_content_plan_drafts
      WHERE id = ? AND experience_id = ?
    `).get(draftId, experienceId) as ContentPlanDraftRow | undefined;
    if (!row) throw Object.assign(new Error('内容方案不存在或已被清理'), { statusCode: 404 });
    return toContentPlanDraft(row);
  },

  getLatestContentPlanDraft(experienceId: string): InteractiveContentPlanDraft | null {
    requireAggregate(experienceId);
    const row = db.prepare(`
      SELECT * FROM interactive_content_plan_drafts
      WHERE experience_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(experienceId) as ContentPlanDraftRow | undefined;
    return row ? toContentPlanDraft(row) : null;
  },

  updateContentPlanStatus(
    experienceId: string,
    draftId: string,
    status: InteractiveContentPlanDraft['status'],
  ): InteractiveContentPlanDraft {
    const draft = this.getContentPlanDraft(experienceId, draftId);
    const timestamp = now();
    const update = db.prepare(`
      UPDATE interactive_content_plan_drafts
      SET status = ?, updated_at = ?, data = ?
      WHERE id = ? AND experience_id = ?
    `).run(
      status,
      timestamp,
      JSON.stringify({ ...draft, status, updatedAt: timestamp }),
      draftId,
      experienceId,
    );
    if (update.changes !== 1) throw Object.assign(new Error('内容方案状态更新失败'), { statusCode: 409 });
    return this.getContentPlanDraft(experienceId, draftId);
  },

  adoptContentPlan(
    experienceId: string,
    draftId: string,
    bindings: NodeContentBinding[],
  ): { draft: InteractiveContentPlanDraft; aggregate: InteractiveExperienceAggregate } {
    const currentDraft = this.getContentPlanDraft(experienceId, draftId);
    const currentAggregate = requireAggregate(experienceId);
    if (currentDraft.status === 'adopted') return { draft: currentDraft, aggregate: currentAggregate };
    if (currentDraft.status !== 'candidate') {
      throw Object.assign(new Error('这份内容方案已经失效或被放弃，请查看最新方案'), { statusCode: 409 });
    }
    if (currentDraft.baseGraphVersionId !== currentAggregate.graph.id) {
      this.updateContentPlanStatus(experienceId, draftId, 'stale');
      throw Object.assign(new Error('白板故事已经变化，请让 AI 重新检查内容方案'), { statusCode: 409 });
    }
    for (const binding of bindings) {
      const current = currentAggregate.bindings.find((candidate) => (
        candidate.nodeId === binding.nodeId && candidate.slot === binding.slot
      ));
      const expectedVersion = currentDraft.baseBindingVersionByNodeId[binding.nodeId];
      if ((current?.versionIndex || 0) !== (expectedVersion || 0)) {
        this.updateContentPlanStatus(experienceId, draftId, 'stale');
        throw Object.assign(new Error(`节点“${binding.nodeId}”的内容已变化，请重新生成方案`), { statusCode: 409 });
      }
    }

    const adopt = db.transaction(() => {
      const draft = this.getContentPlanDraft(experienceId, draftId);
      const aggregate = requireAggregate(experienceId);
      if (draft.status === 'adopted') return { draft, aggregate };
      if (draft.status !== 'candidate') {
        throw Object.assign(new Error('这份内容方案已经失效或被放弃，请查看最新方案'), { statusCode: 409 });
      }
      if (draft.baseGraphVersionId !== aggregate.graph.id) {
        throw Object.assign(new Error('白板故事已经变化，请让 AI 重新检查内容方案'), { statusCode: 409 });
      }
      for (const binding of bindings) {
        const current = aggregate.bindings.find((candidate) => (
          candidate.nodeId === binding.nodeId && candidate.slot === binding.slot
        ));
        const expectedVersion = draft.baseBindingVersionByNodeId[binding.nodeId];
        if ((current?.versionIndex || 0) !== (expectedVersion || 0)) {
          throw Object.assign(new Error(`节点“${binding.nodeId}”的内容已变化，请重新生成方案`), { statusCode: 409 });
        }
      }
      for (const binding of bindings) {
        const current = requireAggregate(experienceId).bindings.find((candidate) => (
          candidate.nodeId === binding.nodeId && candidate.slot === binding.slot
        ));
        this.saveBinding(experienceId, { ...binding, versionIndex: current?.versionIndex });
      }
      const adoptedDraft = this.updateContentPlanStatus(experienceId, draftId, 'adopted');
      return { draft: adoptedDraft, aggregate: requireAggregate(experienceId) };
    });
    return adopt();
  },

  getGraphLayout(experienceId: string): GraphLayoutRevision {
    requireAggregate(experienceId);
    return toGraphLayoutRevision(ensureGraphLayoutRow(experienceId));
  },

  listGraphLayoutVersions(experienceId: string): GraphLayoutRevision[] {
    requireAggregate(experienceId);
    return (db.prepare(`
      SELECT * FROM interactive_graph_layout_versions
      WHERE experience_id = ?
      ORDER BY version_index DESC
    `).all(experienceId) as GraphLayoutRow[]).map(toGraphLayoutRevision);
  },

  saveGraphLayout(
    experienceId: string,
    layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>,
    expectedVersionIndex?: number,
  ): GraphLayoutRevision {
    requireAggregate(experienceId);
    const current = ensureGraphLayoutRow(experienceId);
    if (expectedVersionIndex != null && expectedVersionIndex !== current.version_index) {
      throw Object.assign(
        new Error(`画布布局已更新到版本 ${current.version_index}，请刷新后再保存。`),
        { statusCode: 409 },
      );
    }
    const issues = validateGraphLayout(layout);
    if (issues.length > 0) throw Object.assign(new Error(issues.join('；')), { statusCode: 422 });
    const nextId = db.transaction(() => {
      const id = insertGraphLayoutRevision(experienceId, current.version_index + 1, layout);
      const update = db.prepare(`
        UPDATE interactive_graph_layout_current
        SET current_layout_version_id = ?, updated_at = ?
        WHERE experience_id = ? AND current_layout_version_id = ?
      `).run(id, now(), experienceId, current.id);
      if (update.changes !== 1) {
        throw Object.assign(new Error('画布布局已被其他编辑者更新，请刷新后再保存。'), { statusCode: 409 });
      }
      return id;
    })();
    const next = db.prepare('SELECT * FROM interactive_graph_layout_versions WHERE id = ?').get(nextId) as GraphLayoutRow | undefined;
    if (!next) throw new Error('Failed to save graph layout');
    return toGraphLayoutRevision(next);
  },

  listStoryArchitectureVersions(experienceId: string): Array<VersionedInteractiveArtifact<StoryArchitecture>> {
    requireAggregate(experienceId);
    return (db.prepare(`
      SELECT * FROM interactive_versions
      WHERE experience_id = ? AND kind = 'story_architecture'
      ORDER BY version_index DESC
    `).all(experienceId) as VersionRow[]).map((row) => {
      const version = toVersion<StoryArchitecture>(row);
      return { ...version, data: normalizeStoryArchitecture(version.data) };
    });
  },

  getProductionPrepTarget(experienceId: string): InteractiveProductionPrepTarget | null {
    const row = db.prepare(`
      SELECT * FROM interactive_production_prep_links
      WHERE experience_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(experienceId) as ProductionPrepLinkRow | undefined;
    return row ? toProductionPrepTarget(row) : null;
  },

  listVisualContextProjections(
    experienceId: string,
    productionProjectId?: string,
  ): InteractiveVisualContextProjection[] {
    requireAggregate(experienceId);
    const rows = productionProjectId
      ? db.prepare(`
          SELECT * FROM interactive_visual_context_projections
          WHERE experience_id = ? AND production_project_id = ?
          ORDER BY
            production_scene_id,
            CASE WHEN status = 'stale' THEN 1 ELSE 0 END,
            updated_at DESC,
            id DESC
        `).all(experienceId, productionProjectId) as VisualContextProjectionRow[]
      : db.prepare(`
          SELECT * FROM interactive_visual_context_projections
          WHERE experience_id = ?
          ORDER BY
            production_project_id,
            production_scene_id,
            CASE WHEN status = 'stale' THEN 1 ELSE 0 END,
            updated_at DESC,
            id DESC
        `).all(experienceId) as VisualContextProjectionRow[];
    return rows.map(toVisualContextProjection);
  },

  replaceVisualContextProjections(
    experienceId: string,
    productionProjectId: string,
    projections: InteractiveVisualContextProjection[],
  ): InteractiveVisualContextProjection[] {
    requireAggregate(experienceId);
    if (projections.some((projection) => (
      projection.experienceId !== experienceId
      || projection.productionProjectId !== productionProjectId
    ))) {
      throw Object.assign(new Error('视觉状态投影不能跨互动项目或制片项目写入'), { statusCode: 422 });
    }
    const sceneIds = projections.map((projection) => projection.productionSceneId);
    if (new Set(sceneIds).size !== sceneIds.length) {
      throw Object.assign(new Error('一个制片场次只能有一份当前视觉状态投影'), { statusCode: 422 });
    }
    for (const projection of projections) {
      const issues = validateInteractiveVisualContextProjection(projection);
      if (issues.length > 0) {
        throw Object.assign(new Error(issues.join('；')), { statusCode: 422 });
      }
    }
    const previousCurrent = this.listVisualContextProjections(experienceId, productionProjectId)
      .filter((projection) => projection.status !== 'stale');
    const nextBySceneId = new Map(
      projections.map((projection) => [projection.productionSceneId, projection]),
    );
    const previousBySceneId = new Map<string, InteractiveVisualContextProjection>(
      previousCurrent.map((projection) => [projection.productionSceneId, projection]),
    );
    const changedPrevious = previousCurrent.filter((projection) => (
      nextBySceneId.get(projection.productionSceneId)?.sourceFingerprint !== projection.sourceFingerprint
    ));
    const changedNext = projections.filter((projection) => (
      previousBySceneId.get(projection.productionSceneId)?.sourceFingerprint !== projection.sourceFingerprint
    ));
    const projectionSourcesChanged = JSON.stringify(previousCurrent
      .map((projection) => `${projection.productionSceneId}:${projection.sourceFingerprint}`)
      .sort()) !== JSON.stringify(projections
        .map((projection) => `${projection.productionSceneId}:${projection.sourceFingerprint}`)
        .sort());
    const timestamp = now();
    db.transaction(() => {
      const currentRows = db.prepare(`
        SELECT * FROM interactive_visual_context_projections
        WHERE experience_id = ? AND production_project_id = ? AND status != 'stale'
      `).all(experienceId, productionProjectId) as VisualContextProjectionRow[];
      const nextIds = new Set(projections.map((projection) => projection.id));
      currentRows.forEach((row) => {
        if (nextIds.has(row.id)) return;
        const current = toVisualContextProjection(row);
        db.prepare(`
          UPDATE interactive_visual_context_projections
          SET status = 'stale', updated_at = ?, data = ?
          WHERE id = ?
        `).run(timestamp, JSON.stringify({ ...current, status: 'stale' }), row.id);
      });
      projections.forEach((projection) => {
        const createdAt = (db.prepare(`
          SELECT created_at FROM interactive_visual_context_projections WHERE id = ?
        `).get(projection.id) as { created_at?: string } | undefined)?.created_at || timestamp;
        db.prepare(`
          INSERT INTO interactive_visual_context_projections (
            id, experience_id, production_project_id, production_scene_id,
            status, source_fingerprint, created_at, updated_at, data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            source_fingerprint = excluded.source_fingerprint,
            updated_at = excluded.updated_at,
            data = excluded.data
        `).run(
          projection.id,
          experienceId,
          productionProjectId,
          projection.productionSceneId,
          projection.status,
          projection.sourceFingerprint,
          createdAt,
          timestamp,
          JSON.stringify(projection),
        );
      });
    })();
    if (projectionSourcesChanged) {
      const affectedNodeIds = new Set(
        [...changedPrevious, ...changedNext].flatMap((projection) => projection.nodeIds),
      );
      const affectedSceneIds = new Set(
        [...changedPrevious, ...changedNext].map((projection) => projection.productionSceneId),
      );
      if (affectedNodeIds.size > 0) {
        markBindingMediaReviewRecommended(
          experienceId,
          affectedNodeIds,
        );
        markProductionSceneVisualOutputsReviewRecommended(
          new Map([[
            productionProjectId,
            affectedSceneIds,
          ]]),
          'visual_style_updated',
        );
      }
    }
    return this.listVisualContextProjections(experienceId, productionProjectId)
      .filter((projection) => projection.status !== 'stale');
  },

  adoptVisualContextRefinement(
    experienceId: string,
    input: {
      projectionId: string;
      productionSceneId: string;
      visualScenarioId: string;
      sourceFingerprint: string;
      projectionSnapshotHash?: string;
      label?: string;
      environmentChanges: string[];
      performanceConstraints: string[];
    },
  ): InteractiveVisualContextProjection {
    const projection = this.listVisualContextProjections(experienceId)
      .find((candidate) => (
        candidate.id === input.projectionId
        && candidate.productionSceneId === input.productionSceneId
        && candidate.status !== 'stale'
      ));
    if (!projection) {
      throw Object.assign(new Error('当前画面方案已更新，请重新让 AI 提出建议'), { statusCode: 409 });
    }
    if (projection.sourceFingerprint !== input.sourceFingerprint) {
      throw Object.assign(new Error('故事或制片内容已经变化，请重新生成画面建议'), { statusCode: 409 });
    }
    if (
      input.projectionSnapshotHash
      && createHash('sha256').update(JSON.stringify(projection)).digest('hex') !== input.projectionSnapshotHash
    ) {
      throw Object.assign(new Error('当前画面方案已被另一项建议更新，请重新生成后再采用'), { statusCode: 409 });
    }
    const scenario = projection.scenarios.find((candidate) => candidate.id === input.visualScenarioId);
    if (!scenario) {
      throw Object.assign(new Error('当前画面状态已不存在，请重新选择'), { statusCode: 409 });
    }
    const refinedScenario = refineInteractiveVisualScenario(scenario, {
      label: input.label,
      environmentChanges: input.environmentChanges,
      performanceConstraints: input.performanceConstraints,
    });
    const updatedProjection: InteractiveVisualContextProjection = {
      ...projection,
      scenarios: projection.scenarios.map((candidate) => (
        candidate.id === scenario.id ? refinedScenario : candidate
      )),
      status: 'adopted',
    };
    const issues = validateInteractiveVisualContextProjection(updatedProjection);
    if (issues.length > 0) {
      throw Object.assign(new Error(issues.join('；')), { statusCode: 422 });
    }
    if (JSON.stringify(refinedScenario) === JSON.stringify(scenario)) return projection;

    const timestamp = now();
    const update = db.prepare(`
      UPDATE interactive_visual_context_projections
      SET status = ?, updated_at = ?, data = ?
      WHERE id = ? AND experience_id = ? AND status != 'stale' AND source_fingerprint = ? AND data = ?
    `).run(
      updatedProjection.status,
      timestamp,
      JSON.stringify(updatedProjection),
      projection.id,
      experienceId,
      projection.sourceFingerprint,
      JSON.stringify(projection),
    );
    if (update.changes !== 1) {
      throw Object.assign(new Error('画面方案已被其他修改覆盖，请刷新后重试'), { statusCode: 409 });
    }
    markBindingMediaReviewRecommended(experienceId, new Set(projection.nodeIds));
    markProductionSceneVisualOutputsReviewRecommended(
      new Map([[projection.productionProjectId, new Set([projection.productionSceneId])]]),
      'visual_style_updated',
    );
    return updatedProjection;
  },

  getLatestRuntimeBuild(experienceId: string): InteractiveRuntimeBuild | null {
    const row = db.prepare(`
      SELECT * FROM interactive_runtime_builds
      WHERE experience_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(experienceId) as RuntimeBuildRow | undefined;
    return row ? toRuntimeBuild(row) : null;
  },

  getRuntimeBuild(experienceId: string, runtimeBuildId: string): InteractiveRuntimeBuild | null {
    const row = db.prepare(`
      SELECT * FROM interactive_runtime_builds
      WHERE experience_id = ? AND id = ?
      LIMIT 1
    `).get(experienceId, runtimeBuildId) as RuntimeBuildRow | undefined;
    return row ? toRuntimeBuild(row) : null;
  },

  getPlaytestCheckpoint(experienceId: string, runtimeBuildId?: string): InteractivePlaytestCheckpoint | null {
    const row = runtimeBuildId
      ? db.prepare(`
          SELECT * FROM interactive_playtest_checkpoints
          WHERE experience_id = ? AND runtime_build_id = ?
          LIMIT 1
        `).get(experienceId, runtimeBuildId) as PlaytestCheckpointRow | undefined
      : db.prepare(`
          SELECT * FROM interactive_playtest_checkpoints
          WHERE experience_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(experienceId) as PlaytestCheckpointRow | undefined;
    return row ? toPlaytestCheckpoint(row) : null;
  },

  savePlaytestCheckpoint(
    experienceId: string,
    checkpoint: Pick<InteractivePlaytestCheckpoint, 'runtimeBuildId' | 'currentNodeId' | 'state'>,
  ): InteractivePlaytestCheckpoint {
    const current = requireAggregate(experienceId);
    const build = checkpoint.runtimeBuildId
      ? this.getRuntimeBuild(experienceId, checkpoint.runtimeBuildId)
      : null;
    if (checkpoint.runtimeBuildId && (!build || build.status === 'stale' || !build.graphSnapshot || !build.stateSchemaSnapshot)) {
      throw Object.assign(new Error('本次试玩内容已更新，不能保存检查点；请重新开始试玩'), { statusCode: 409 });
    }
    const graph = build?.graphSnapshot || current.graph;
    const stateSchema = build?.stateSchemaSnapshot || current.stateSchema.data;
    const playtestKind = build?.kind === 'structure_preview' ? 'structure_preview' : 'formal';
    if (!graph.nodes.some((node) => node.id === checkpoint.currentNodeId)) {
      throw Object.assign(new Error('存档节点不属于当前互动图谱'), { statusCode: 422 });
    }
    const supportedVariables = new Set(stateSchema.variables.map((variable) => variable.key));
    if (Object.keys(checkpoint.state.variables).some((key) => !supportedVariables.has(key))) {
      throw Object.assign(new Error('存档包含当前状态 schema 未定义的变量'), { statusCode: 422 });
    }
    if (!Array.isArray(checkpoint.state.facts) || Object.values(checkpoint.state.visitedNodes).some((count) => !Number.isInteger(count) || count < 0)) {
      throw Object.assign(new Error('存档状态格式不合法'), { statusCode: 422 });
    }
    if (
      checkpoint.state.playedNodes
      && (
        !Array.isArray(checkpoint.state.playedNodes)
        || checkpoint.state.playedNodes.some((entry) => !graph.nodes.some((node) => node.id === entry.nodeId))
      )
    ) {
      throw Object.assign(new Error('存档路径包含不属于当前互动图谱的节点'), { statusCode: 422 });
    }
    if (
      checkpoint.state.elapsedSeconds != null
      && (!Number.isFinite(checkpoint.state.elapsedSeconds) || checkpoint.state.elapsedSeconds < 0)
    ) {
      throw Object.assign(new Error('存档试玩时间格式不合法'), { statusCode: 422 });
    }
    if (checkpoint.state.nodeStates && (
      !Array.isArray(checkpoint.state.nodeStates)
      || checkpoint.state.nodeStates.some((state) => (
        !graph.nodes.some((node) => node.id === state.nodeId)
        || !Array.isArray(state.facts)
        || Object.keys(state.variables || {}).some((key) => !supportedVariables.has(key))
        || Object.values(state.visitedNodes || {}).some((count) => !Number.isInteger(count) || count < 0)
      ))
    )) throw Object.assign(new Error('存档回退路径状态格式不合法'), { statusCode: 422 });
    const existing = db.prepare(`
      SELECT * FROM interactive_playtest_checkpoints
      WHERE experience_id = ? AND playtest_kind = ?
      LIMIT 1
    `).get(experienceId, playtestKind) as PlaytestCheckpointRow | undefined;
    const timestamp = now();
    const id = existing?.id || createId('playtest_checkpoint');
    db.prepare(`
      INSERT INTO interactive_playtest_checkpoints (
        id, experience_id, playtest_kind, runtime_build_id, graph_version_id,
        state_schema_version_id, current_node_id, created_at, updated_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(experience_id, playtest_kind) DO UPDATE SET
        runtime_build_id = excluded.runtime_build_id,
        graph_version_id = excluded.graph_version_id,
        state_schema_version_id = excluded.state_schema_version_id,
        current_node_id = excluded.current_node_id,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      id,
      experienceId,
      playtestKind,
      checkpoint.runtimeBuildId || null,
      build?.graphVersionId || current.graph.id,
      build?.stateSchemaVersionId || current.stateSchema.id,
      checkpoint.currentNodeId,
      existing?.created_at || timestamp,
      timestamp,
      JSON.stringify(checkpoint.state),
    );
    return this.getPlaytestCheckpoint(experienceId, checkpoint.runtimeBuildId)!;
  },

  createRuntimeBuild(experienceId: string): InteractiveRuntimeBuild {
    const current = requireAggregate(experienceId);
    const chapterByBeat = new Map((current.storyArchitecture.data.storyChapters || []).flatMap((chapter) => chapter.storyBeatIds.map((beatId) => [beatId, chapter.id] as const)));
    const nodeChapterIds = Object.fromEntries(current.graph.nodes.flatMap((node) => {
      const chapterId = node.storyBeatIds?.map((beatId) => chapterByBeat.get(beatId)).find(Boolean);
      return chapterId ? [[node.id, chapterId]] : [];
    }));
    if (!current.graph.entryNodeId || current.graph.nodes.length === 0) {
      throw Object.assign(new Error('请先保存至少一个设为入口的互动节点，再开始试玩'), { statusCode: 422 });
    }
    const qaResult = auditNarrativeGraph(current.graph, current.stateSchema.data, undefined,
      current.experienceSpec.data.accessibilitySettings.timedChoiceOption !== 'infinite');
    const executableNodes = new Set(qaResult.stateSpace?.reachableNodeIds || []);
    const qaWarnings = qaResult.issues.filter((issue) => issue.severity === 'warning'
      || issue.id.startsWith('err_unreachable_')
      || (issue.id.startsWith('err_dead_end_') && issue.nodeId && !executableNodes.has(issue.nodeId)))
      .map((issue) => issue.message);
    const validationIssues = [
      ...validateStateSchema(current.stateSchema.data),
      ...validateNarrativeGraph(current.graph, current.stateSchema.data),
      ...qaResult.issues
        .filter((issue) => issue.severity === 'error' && issue.category !== 'duration'
          && !issue.id.startsWith('err_unreachable_')
          && !(issue.id.startsWith('err_dead_end_') && issue.nodeId && !executableNodes.has(issue.nodeId)))
        .map((issue) => issue.message),
    ];
    if (validationIssues.length) {
      throw Object.assign(new Error(`互动图谱尚不能完整试玩：${[...new Set(validationIssues)].slice(0, 5).join('；')}`), { statusCode: 422 });
    }
    const mainBindings = new Map(
      current.bindings
        .filter((binding) => (
          binding.slot === 'main'
          && binding.status === 'approved'
          && bindingScriptSceneRefs(binding).length > 0
        ))
        .map((binding) => [binding.nodeId, binding]),
    );
    const contentNodes = current.graph.nodes.filter(nodeRequiresMainContent);
    const missingScriptNodes = contentNodes.filter((node) => !mainBindings.has(node.id));
    if (missingScriptNodes.length > 0) {
      throw Object.assign(new Error(`以下节点缺少已批准剧本：${missingScriptNodes.map((node) => node.brief.title).join('、')}`), { statusCode: 422 });
    }
    const pendingContentReviewNodes = contentNodes.filter((node) => {
      const binding = mainBindings.get(node.id);
      return Boolean(binding && !hasCurrentContentFitReview(binding));
    });
    if (pendingContentReviewNodes.length > 0) {
      throw Object.assign(
        new Error(`以下节点的来源有更新，建议先复核剧本匹配：${pendingContentReviewNodes.map((node) => node.brief.title).join('、')}`),
        { statusCode: 422 },
      );
    }
    const productionTarget = this.getProductionPrepTarget(experienceId);
    const productionProject = productionTarget
      ? dbHelpers.getProjectById(productionTarget.productionProjectId) as Project | null
      : null;
    const allVisualProjections = productionTarget
      ? this.listVisualContextProjections(experienceId, productionTarget.productionProjectId)
      : [];
    const currentVisualProjectionIds = new Set(allVisualProjections
      .filter((projection) => (
            projection.status !== 'stale'
            && projection.graphVersionId === current.graph.id
            && projection.stateSchemaVersionId === current.stateSchema.id
          ))
      .map((projection) => projection.id));
    const nodeManifests = current.graph.nodes.map((node) => {
      const binding = mainBindings.get(node.id);
      const requiresMedia = nodeRequiresMediaPlayback(node);
      const mediaTakeRefs = binding?.mediaTakeRefs?.length
        ? binding.mediaTakeRefs
        : binding?.mediaTakeRef ? [binding.mediaTakeRef] : [];
      const reviewedChecksums = new Set(binding?.mediaFitReview?.mediaChecksums || []);
      const mediaReviewCurrent = mediaTakeRefs.length > 0
        && reviewedChecksums.size === mediaTakeRefs.length
        && mediaTakeRefs.every((ref) => reviewedChecksums.has(ref.checksum))
        && !bindingNeedsMediaReview(binding!);
      const projectedScenarioGroups = new Map<string, {
        requiredProductionSceneIds: Set<string>;
        currentProductionSceneIds: Set<string>;
        scenarios: Array<{
          label: string;
          entryPredicate: InteractiveVisualContextProjection['scenarios'][number]['entryPredicate'];
          reuseFingerprint: string;
        }>;
      }>();
      const persistedScenesForNode = (productionProject?.episodes || []).flatMap((episode) => (
        ((episode as Project['episodes'][number] & { scenes?: Scene[] }).scenes || [])
          .filter((scene) => scene.interactiveMetadata?.nodeIds?.includes(node.id))
      ));
      const persistedSceneIdSet = new Set(persistedScenesForNode.map((scene) => scene.id));
      const projectionBySceneId = new Map<string, InteractiveVisualContextProjection>();
      allVisualProjections
        .filter((projection) => (
          projection.nodeIds.includes(node.id)
          && (!productionProject || persistedSceneIdSet.has(projection.productionSceneId))
        ))
        .forEach((projection) => {
          const existing = projectionBySceneId.get(projection.productionSceneId);
          if (!existing || (
            currentVisualProjectionIds.has(projection.id)
            && !currentVisualProjectionIds.has(existing.id)
          )) projectionBySceneId.set(projection.productionSceneId, projection);
        });
      [...projectionBySceneId.values()]
        .forEach((projection) => projection.scenarios.forEach((scenario) => {
          const stateFingerprint = scenario.stateFingerprint || scenario.reuseFingerprint;
          const projectionCurrent = currentVisualProjectionIds.has(projection.id);
          const existing = projectedScenarioGroups.get(stateFingerprint);
          projectedScenarioGroups.set(stateFingerprint, {
            requiredProductionSceneIds: new Set([
              ...(existing?.requiredProductionSceneIds || []),
              projection.productionSceneId,
            ]),
            currentProductionSceneIds: new Set([
              ...(existing?.currentProductionSceneIds || []),
              ...(projectionCurrent ? [projection.productionSceneId] : []),
            ]),
            scenarios: [
              ...(existing?.scenarios || []),
              scenario,
            ],
          });
        }));
      const persistedInteractiveSceneIds = new Set<string>();
      persistedScenesForNode.forEach((scene) => {
          persistedInteractiveSceneIds.add(scene.id);
          (scene.interactiveMetadata.visualScenarios || []).forEach((scenario) => {
            const stateFingerprint = scenario.stateFingerprint || scenario.reuseFingerprint;
            const existing = projectedScenarioGroups.get(stateFingerprint);
            projectedScenarioGroups.set(stateFingerprint, {
              requiredProductionSceneIds: new Set([
                ...(existing?.requiredProductionSceneIds || []),
                scene.id,
              ]),
              currentProductionSceneIds: new Set(existing?.currentProductionSceneIds || []),
              scenarios: existing?.scenarios.some((candidate) => (
                candidate.reuseFingerprint === scenario.reuseFingerprint
              ))
                ? existing.scenarios
                : [
                    ...(existing?.scenarios || []),
                    {
                      label: scenario.label,
                      entryPredicate: null,
                      reuseFingerprint: scenario.reuseFingerprint,
                    },
                  ],
            });
          });
      });
      persistedInteractiveSceneIds.forEach((sceneId) => {
        if ([...projectedScenarioGroups.values()].some((group) => (
          group.requiredProductionSceneIds.has(sceneId)
        ))) return;
        const refreshId = `visual_projection_refresh_required_${node.id}_${sceneId}`;
        projectedScenarioGroups.set(refreshId, {
          requiredProductionSceneIds: new Set([sceneId]),
          currentProductionSceneIds: new Set(),
          scenarios: [{ label: '画面状态来源待刷新', entryPredicate: null, reuseFingerprint: refreshId }],
        });
      });
      const mediaScenarios = projectedScenarioGroups.size > 0
        ? [...projectedScenarioGroups.entries()].map(([stateFingerprint, group]) => {
            const productionFingerprints = new Set(
              group.scenarios.map((scenario) => scenario.reuseFingerprint),
            );
            const projectionCurrent = [...group.requiredProductionSceneIds]
              .every((sceneId) => group.currentProductionSceneIds.has(sceneId));
            const selectedRefs = projectionCurrent
              ? (binding?.mediaScenarios || [])
                  .filter((candidate) => productionFingerprints.has(candidate.reuseFingerprint))
                  .flatMap((candidate) => candidate.mediaTakeRefs)
                  .filter((ref, index, refs) => refs.findIndex((candidate) => (
                    candidate.artifactId === ref.artifactId
                    && candidate.versionId === ref.versionId
                    && candidate.checksum === ref.checksum
                  )) === index)
              : [];
            const scenario = group.scenarios[0];
            return {
              scenarioId: `runtime_scenario_${node.id}_${stateFingerprint}`,
              label: scenario.label,
              entryPredicate: scenario.entryPredicate,
              reuseFingerprint: stateFingerprint,
              mediaTakeRefs: selectedRefs,
            };
          })
        : undefined;
      return {
        nodeId: node.id,
        title: node.brief.title,
        scriptSceneRefs: bindingScriptSceneRefs(binding),
        requiresMedia,
        mediaTakeRefs,
        mediaScenarios,
        mediaReviewCurrent,
      };
    });
    const missingMediaNodeIds = nodeManifests
      .filter((manifest) => manifest.requiresMedia && (
        manifest.mediaTakeRefs.length === 0
        || manifest.mediaScenarios?.some((scenario) => scenario.mediaTakeRefs.length === 0)
      ))
      .map((manifest) => manifest.nodeId);
    const pendingMediaReviewNodeIds = nodeManifests
      .filter((manifest) => manifest.requiresMedia && manifest.mediaTakeRefs.length > 0 && !manifest.mediaReviewCurrent)
      .map((manifest) => manifest.nodeId);
    const status: InteractiveRuntimeBuild['status'] = missingMediaNodeIds.length
      || pendingMediaReviewNodeIds.length
      ? 'waiting_for_media'
      : 'ready_for_player';
    const frozenNodeManifests = nodeManifests.map(({ mediaReviewCurrent: _mediaReviewCurrent, ...manifest }) => {
      const refs = [...manifest.mediaTakeRefs, ...(manifest.mediaScenarios || []).flatMap((scenario) => scenario.mediaTakeRefs)]
        .filter((ref, index, all) => all.findIndex((candidate) => sameArtifactRef(candidate, ref)) === index);
      return {
        ...manifest,
        mediaPlaybackSnapshots: status === 'ready_for_player'
          ? refs.map((ref) => captureProductionMediaPlayback(ref, manifest.nodeId))
          : [],
      };
    });
    const id = createId('runtime_build');
    const createdAt = now();
    db.prepare(`
      INSERT INTO interactive_runtime_builds (
        id, experience_id, status, graph_version_id, graph_version_index,
        state_schema_version_id, state_schema_version_index, created_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      experienceId,
      status,
      current.graph.id,
      current.graph.versionIndex,
      current.stateSchema.id,
      current.stateSchema.versionIndex,
      createdAt,
      JSON.stringify({
        kind: 'formal',
        graphSnapshot: current.graph,
        stateSchemaSnapshot: normalizeStateSchema(current.stateSchema.data),
        experienceSpecSnapshot: current.experienceSpec.data,
        nodeChapterIds,
        qaWarnings,
        nodeManifests: frozenNodeManifests,
        missingMediaNodeIds,
        pendingMediaReviewNodeIds,
      }),
    );
    return {
      id,
      experienceId,
      kind: 'formal',
      status,
      graphVersionId: current.graph.id,
      graphVersionIndex: current.graph.versionIndex,
      stateSchemaVersionId: current.stateSchema.id,
      stateSchemaVersionIndex: current.stateSchema.versionIndex,
      graphSnapshot: current.graph,
      stateSchemaSnapshot: normalizeStateSchema(current.stateSchema.data),
      experienceSpecSnapshot: current.experienceSpec.data,
      nodeChapterIds,
      qaWarnings,
      nodeManifests: frozenNodeManifests,
      missingMediaNodeIds,
      pendingMediaReviewNodeIds,
      createdAt,
    };
  },

  createStructurePreviewBuild(experienceId: string): InteractiveRuntimeBuild {
    const current = requireAggregate(experienceId);
    const qaWarnings = auditNarrativeGraph(current.graph, current.stateSchema.data, undefined,
      current.experienceSpec.data.accessibilitySettings.timedChoiceOption !== 'infinite').issues
      .filter((issue) => issue.severity !== 'info')
      .map((issue) => issue.message);
    const chapterByBeat = new Map((current.storyArchitecture.data.storyChapters || []).flatMap((chapter) => chapter.storyBeatIds.map((beatId) => [beatId, chapter.id] as const)));
    const nodeChapterIds = Object.fromEntries(current.graph.nodes.flatMap((node) => {
      const chapterId = node.storyBeatIds?.map((beatId) => chapterByBeat.get(beatId)).find(Boolean);
      return chapterId ? [[node.id, chapterId]] : [];
    }));
    const approvedBindings = new Map(
      current.bindings
        .filter((binding) => (
          binding.slot === 'main'
          && binding.status === 'approved'
          && bindingScriptSceneRefs(binding).length > 0
        ))
        .map((binding) => [binding.nodeId, binding]),
    );
    const payload = buildStructurePreviewPayload({
      graph: current.graph,
      stateSchema: current.stateSchema.data,
      approvedNodeIds: approvedBindings.keys(),
    });
    const nodeManifests: InteractiveRuntimeBuild['nodeManifests'] = current.graph.nodes.map((node) => ({
      nodeId: node.id,
      title: node.brief.title,
      scriptSceneRefs: bindingScriptSceneRefs(approvedBindings.get(node.id)),
      requiresMedia: false,
      mediaTakeRefs: [],
    }));
    const id = createId('runtime_build');
    const createdAt = now();
    const stateSchemaSnapshot = normalizeStateSchema(current.stateSchema.data);
    db.prepare(`
      INSERT INTO interactive_runtime_builds (
        id, experience_id, status, graph_version_id, graph_version_index,
        state_schema_version_id, state_schema_version_index, created_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      experienceId,
      'ready_for_preview',
      current.graph.id,
      current.graph.versionIndex,
      current.stateSchema.id,
      current.stateSchema.versionIndex,
      createdAt,
      JSON.stringify({
        kind: 'structure_preview',
        graphSnapshot: current.graph,
        stateSchemaSnapshot,
        experienceSpecSnapshot: current.experienceSpec.data,
        nodeChapterIds,
        qaWarnings,
        nodeManifests,
        missingMediaNodeIds: [],
        pendingMediaReviewNodeIds: [],
        ...payload,
      }),
    );
    return {
      id,
      experienceId,
      kind: 'structure_preview',
      status: 'ready_for_preview',
      graphVersionId: current.graph.id,
      graphVersionIndex: current.graph.versionIndex,
      stateSchemaVersionId: current.stateSchema.id,
      stateSchemaVersionIndex: current.stateSchema.versionIndex,
      graphSnapshot: current.graph,
      stateSchemaSnapshot,
      experienceSpecSnapshot: current.experienceSpec.data,
      nodeChapterIds,
      qaWarnings,
      nodeManifests,
      missingMediaNodeIds: [],
      pendingMediaReviewNodeIds: [],
      ...payload,
      createdAt,
    };
  },

  saveProductionPrepTarget(target: Omit<InteractiveProductionPrepTarget, 'status'>): InteractiveProductionPrepTarget {
    const timestamp = now();
    db.prepare(`
      INSERT INTO interactive_production_prep_links (
        experience_id, source_writing_project_id, source_writing_revision,
        production_project_id, source_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(experience_id, source_writing_project_id, source_writing_revision)
      DO UPDATE SET
        production_project_id = excluded.production_project_id,
        source_hash = excluded.source_hash,
        updated_at = excluded.updated_at
    `).run(
      target.experienceId,
      target.sourceWritingProjectId,
      target.sourceWritingRevision,
      target.productionProjectId,
      target.sourceHash,
      timestamp,
      timestamp,
    );
    return { ...target, status: 'created' };
  },

  createExperience(input: CreateInteractiveExperienceInput): InteractiveExperienceAggregate {
    // Repository callers include workers and isolated verification scripts, not only the HTTP server.
    ensureInteractiveSchema();
    const experienceId = createId('experience');
    const projectId = createId('project');
    const timestamp = now();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, title, type, updated_at, data)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).run(projectId, input.title, 'interactive-film', JSON.stringify({
        id: projectId,
        title: input.title,
        type: 'interactive-film',
        interactiveExperienceId: experienceId,
        domain: 'interactive',
      }));

      // Insert the root first so version rows can safely reference it.
      db.prepare(`
        INSERT INTO interactive_experiences (
          id, project_id, title, genre, status,
          current_experience_spec_version_id,
          current_story_architecture_version_id,
          current_state_schema_version_id,
          current_graph_version_id,
          created_at, updated_at, data
        ) VALUES (?, ?, ?, ?, ?, '', '', '', '', ?, ?, ?)
      `).run(
        experienceId,
        projectId,
        input.title,
        input.genre,
        'development',
        timestamp,
        timestamp,
        JSON.stringify({
          formatProfile: input.formatProfile,
          storySource: input.storySource,
          productionBoundary: input.productionBoundary,
        }),
      );

      const experienceSpecId = insertVersion(experienceId, 'experience_spec', 1, 'approved', input.experienceSpec);
      const storyArchitectureId = insertVersion(experienceId, 'story_architecture', 1, 'draft', input.storyArchitecture);
      const stateSchemaId = insertVersion(experienceId, 'state_schema', 1, 'draft', {
        variables: [],
        factDefinitions: [],
        initialFactIds: [],
      });
      const graphId = insertVersion(experienceId, 'graph', 1, 'draft', {
        semanticContractVersion: 2,
        entryNodeId: '',
        nodes: [],
      });
      const graphLayoutId = insertGraphLayoutRevision(experienceId, 1, { nodes: {} });
      db.prepare(`
        INSERT INTO interactive_graph_layout_current
          (experience_id, current_layout_version_id, updated_at)
        VALUES (?, ?, ?)
      `).run(experienceId, graphLayoutId, timestamp);

      db.prepare(`
        UPDATE interactive_experiences
        SET current_experience_spec_version_id = ?,
            current_story_architecture_version_id = ?,
            current_state_schema_version_id = ?,
            current_graph_version_id = ?
        WHERE id = ?
      `).run(experienceSpecId, storyArchitectureId, stateSchemaId, graphId, experienceId);
    })();

    return requireAggregate(experienceId);
  },

  saveStateSchema(experienceId: string, stateSchema: StateSchema, expectedVersionIndex?: number): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    if (expectedVersionIndex != null && expectedVersionIndex !== current.stateSchema.versionIndex) {
      throw Object.assign(new Error('状态设定已被更新，请刷新后重试。'), { statusCode: 409 });
    }
    const normalizedStateSchema = normalizeStateSchema(stateSchema);
    if (
      JSON.stringify(normalizeStateSchema(current.stateSchema.data))
      === JSON.stringify(normalizedStateSchema)
    ) {
      return current;
    }
    const previousGraphIssues = new Set(validateNarrativeGraph(current.graph, normalizeStateSchema(current.stateSchema.data)));
    const issues = [
      ...validateStateSchema(normalizedStateSchema),
      ...validateNarrativeGraph(current.graph, normalizedStateSchema).filter((issue) => !previousGraphIssues.has(issue)),
    ];
    if (issues.length > 0) {
      throw Object.assign(new Error([...new Set(issues)].join('；')), { statusCode: 422 });
    }
    const projectionAffectedNodeIds = persistedVisualStateAffectedNodeIds(
      experienceId,
      current.stateSchema.data,
      normalizedStateSchema,
    );
    const affectedNodeIds = stateSchemaAffectedNodeIds(
      current.graph,
      current.stateSchema.data,
      normalizedStateSchema,
      projectionAffectedNodeIds,
    );
    const versionId = db.transaction(() => {
      const nextId = insertVersion(
        experienceId,
        'state_schema',
        current.stateSchema.versionIndex + 1,
        'draft',
        normalizedStateSchema,
      );
      const update = db.prepare(`
        UPDATE interactive_experiences
        SET current_state_schema_version_id = ?, status = 'development', updated_at = ?
        WHERE id = ? AND current_state_schema_version_id = ?
      `).run(nextId, now(), experienceId, current.stateSchema.id);
      if (update.changes !== 1) throw Object.assign(new Error('状态设定已被更新，请刷新后重试。'), { statusCode: 409 });
      markBindingsReviewRecommended(
        experienceId,
        current.bindings.filter((binding) => affectedNodeIds.has(binding.nodeId)),
        ['state_schema_updated'],
        now(),
      );
      markVisualContextProjectionsStale(experienceId, affectedNodeIds);
      rebaseUnchangedVisualContextProjectionsForState(experienceId, affectedNodeIds, nextId);
      return nextId;
    })();
    if (!versionId) throw new Error('Failed to save state schema');
    return requireAggregate(experienceId);
  },

  saveStoryArchitecture(
    experienceId: string,
    architecture: StoryArchitecture,
    status: InteractiveVersionStatus = 'draft',
    expectedVersionIndex?: number,
  ): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    if (expectedVersionIndex != null && expectedVersionIndex !== current.storyArchitecture.versionIndex) {
      throw Object.assign(new Error('故事结构已被更新，请刷新后重试。'), { statusCode: 409 });
    }
    const normalizedArchitecture = normalizeStoryArchitecture(architecture);
    const issues = status === 'approved'
      ? validateStoryArchitecture(normalizedArchitecture)
      : validateStoryArchitectureDraft(normalizedArchitecture);
    if (issues.length > 0) {
      throw Object.assign(new Error(issues.join('；')), { statusCode: 422 });
    }
    const normalizedStatus = status === 'approved' ? 'approved' : 'draft';
    const changed = JSON.stringify(normalizeStoryArchitecture(current.storyArchitecture.data))
      !== JSON.stringify(normalizedArchitecture);
    if (!changed) return current;
    db.transaction(() => {
      const nextId = insertVersion(
        experienceId,
        'story_architecture',
        current.storyArchitecture.versionIndex + 1,
        normalizedStatus,
        normalizedArchitecture,
      );
      const update = db.prepare(`
        UPDATE interactive_experiences
        SET current_story_architecture_version_id = ?, status = 'development', updated_at = ?
        WHERE id = ? AND current_story_architecture_version_id = ?
      `).run(nextId, now(), experienceId, current.storyArchitecture.id);
      if (update.changes !== 1) throw Object.assign(new Error('故事结构已被更新，请刷新后重试。'), { statusCode: 409 });
      markBindingsReviewRecommended(
        experienceId,
        current.bindings,
        ['story_architecture_updated'],
        now(),
      );
      markContentPlansStale(experienceId);
      markVisualContextProjectionsStale(experienceId);
    })();
    return requireAggregate(experienceId);
  },

  saveExperienceSpec(experienceId: string, spec: ExperienceSpec, expectedVersionIndex?: number): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    if (expectedVersionIndex != null && expectedVersionIndex !== current.experienceSpec.versionIndex) {
      throw Object.assign(new Error('体验策略已被更新，请刷新后重试。'), { statusCode: 409 });
    }
    if (!spec || !['retry', 'rollback', 'checkpoint', 'game_over'].includes(spec.failStatePolicy)
      || !['auto_checkpoint', 'manual_save', 'chapter_only'].includes(spec.savePolicy)
      || !spec.accessibilitySettings
      || !['standard', 'extended', 'infinite'].includes(spec.accessibilitySettings.timedChoiceOption)
      || !spec.choiceCadence
      || !Number.isFinite(spec.choiceCadence.targetChoicesPerTenMinutes)
      || spec.choiceCadence.targetChoicesPerTenMinutes < 0
      || !Number.isFinite(spec.choiceCadence.maxMinutesWithoutChoice)
      || spec.choiceCadence.maxMinutesWithoutChoice <= 0) {
      throw Object.assign(new Error('体验策略的存档、失败、限时或选择节奏设置无效'), { statusCode: 422 });
    }
    if (JSON.stringify(current.experienceSpec.data) === JSON.stringify(spec)) return current;
    db.transaction(() => {
      const nextId = insertVersion(experienceId, 'experience_spec', current.experienceSpec.versionIndex + 1, 'approved', spec);
      const update = db.prepare(`
        UPDATE interactive_experiences SET current_experience_spec_version_id = ?, status = 'development', updated_at = ?
        WHERE id = ? AND current_experience_spec_version_id = ?
      `).run(nextId, now(), experienceId, current.experienceSpec.id);
      if (update.changes !== 1) throw Object.assign(new Error('体验策略已被更新，请刷新后重试。'), { statusCode: 409 });
      markContentPlansStale(experienceId);
    })();
    return requireAggregate(experienceId);
  },

  saveExperienceDetails(
    experienceId: string,
    details: Pick<InteractiveExperience, 'title' | 'genre' | 'formatProfile' | 'productionBoundary'>,
    expectedUpdatedAt?: string,
  ): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    if (expectedUpdatedAt != null && expectedUpdatedAt !== current.experience.updatedAt) {
      throw Object.assign(new Error('作品资料已被更新，请刷新后重试。'), { statusCode: 409 });
    }
    if (!details || typeof details.title !== 'string' || typeof details.genre !== 'string') {
      throw Object.assign(new Error('作品名称与类型格式无效'), { statusCode: 422 });
    }
    const title = details.title.trim();
    const genre = details.genre.trim();
    if (!title || !genre) throw Object.assign(new Error('作品名称与类型不能为空'), { statusCode: 422 });
    if (!details.formatProfile || !['branching_fmv', 'interactive_series', 'narrative_game'].includes(details.formatProfile.format)
      || !['16:9', '9:16', '1:1'].includes(details.formatProfile.aspectRatio)
      || !Array.isArray(details.formatProfile.platforms)
      || !details.formatProfile.platforms.length
      || details.formatProfile.platforms.some((platform) => !['web', 'mobile', 'tv', 'desktop', 'console'].includes(platform))
      || !details.formatProfile.primaryLanguage?.trim()
      || !Number.isFinite(details.formatProfile.targetSessionMinutes) || details.formatProfile.targetSessionMinutes <= 0
      || !Number.isFinite(details.formatProfile.targetCompleteMinutes) || details.formatProfile.targetCompleteMinutes <= 0
      || !details.productionBoundary
      || !Number.isInteger(details.productionBoundary.maxBranchDepth) || details.productionBoundary.maxBranchDepth < 1
      || !Number.isInteger(details.productionBoundary.maxParallelBranches) || details.productionBoundary.maxParallelBranches < 1
      || !Number.isFinite(details.productionBoundary.exclusiveContentPercent)
      || details.productionBoundary.exclusiveContentPercent < 0 || details.productionBoundary.exclusiveContentPercent > 100
      || !Number.isInteger(details.productionBoundary.maxAutomaticRepairAttempts)
      || details.productionBoundary.maxAutomaticRepairAttempts < 0) {
      throw Object.assign(new Error('作品格式、目标时长或制作边界设置无效'), { statusCode: 422 });
    }
    const oldData = { formatProfile: current.experience.formatProfile, storySource: current.experience.storySource, productionBoundary: current.experience.productionBoundary };
    const newData = { ...oldData, formatProfile: details.formatProfile, productionBoundary: details.productionBoundary };
    if (title === current.experience.title && genre === current.experience.genre && JSON.stringify(oldData) === JSON.stringify(newData)) return current;
    const nextTimestamp = new Date(Math.max(Date.now(), Date.parse(current.experience.updatedAt) + 1)).toISOString();
    db.transaction(() => {
      const update = db.prepare(`
        UPDATE interactive_experiences SET title = ?, genre = ?, data = ?, status = 'development', updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(title, genre, JSON.stringify(newData), nextTimestamp, experienceId, current.experience.updatedAt);
      if (update.changes !== 1) throw Object.assign(new Error('作品资料已被更新，请刷新后重试。'), { statusCode: 409 });
      const project = db.prepare('SELECT data FROM projects WHERE id = ?').get(current.experience.projectId) as { data: string } | undefined;
      if (project) db.prepare('UPDATE projects SET title = ?, data = ? WHERE id = ?').run(title, JSON.stringify({ ...parseJson<Record<string, unknown>>(project.data), title }), current.experience.projectId);
    })();
    return requireAggregate(experienceId);
  },

  saveStorySource(experienceId: string, storySource: StorySourceBinding): InteractiveExperienceAggregate {
    const row = getExperienceRow(experienceId);
    if (!row) throw Object.assign(new Error('Interactive experience not found'), { statusCode: 404 });
    const existing = parseJson<Pick<InteractiveExperience, 'formatProfile' | 'storySource' | 'productionBoundary'>>(row.data);
    const timestamp = now();
    const sourceChanged = JSON.stringify(existing.storySource) !== JSON.stringify(storySource);
    db.transaction(() => {
      db.prepare(`
        UPDATE interactive_experiences
        SET status = ?, updated_at = ?, data = ?
        WHERE id = ?
      `).run(sourceChanged ? 'development' : row.status, timestamp, JSON.stringify({ ...existing, storySource }), experienceId);
      if (sourceChanged) {
        markBindingsReviewRecommended(
          experienceId,
          listBindings(experienceId),
          ['story_source_updated'],
          timestamp,
        );
        markContentPlansStale(experienceId);
        markVisualContextProjectionsStale(experienceId);
      }
    })();
    return requireAggregate(experienceId);
  },

  adoptGraphDraftArtifacts(
    experienceId: string,
    graph: Pick<NarrativeGraphVersion, 'entryNodeId' | 'nodes' | 'semanticContractVersion' | 'transitions'>,
    proposedStateSchema?: StateSchema,
    proposedStoryArchitecture?: StoryArchitecture,
  ): InteractiveExperienceAggregate {
    return db.transaction(() => {
      const current = requireAggregate(experienceId);
      if (proposedStoryArchitecture && JSON.stringify(normalizeStoryArchitecture(proposedStoryArchitecture)) !== JSON.stringify(normalizeStoryArchitecture(current.storyArchitecture.data))) {
        this.saveStoryArchitecture(experienceId, proposedStoryArchitecture);
      }
      const afterArchitecture = requireAggregate(experienceId);
      if (proposedStateSchema && JSON.stringify(normalizeStateSchema(proposedStateSchema)) !== JSON.stringify(normalizeStateSchema(afterArchitecture.stateSchema.data))) {
        this.saveStateSchema(experienceId, proposedStateSchema);
      }
      return this.saveGraph(experienceId, graph);
    })();
  },

  saveGraph(
    experienceId: string,
    graph: Pick<NarrativeGraphVersion, 'entryNodeId' | 'nodes' | 'semanticContractVersion' | 'transitions'>,
    status: InteractiveVersionStatus = 'draft',
    expectedVersionIndex?: number,
  ): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    if (expectedVersionIndex != null && expectedVersionIndex !== current.graph.versionIndex) {
      throw Object.assign(
        new Error(`图谱已更新到版本 ${current.graph.versionIndex}，请刷新后再保存，避免覆盖其他人的修改。`),
        { statusCode: 409 },
      );
    }
    const persistedGraph = graphForPersistence(graph);
    const candidateGraph = normalizeNarrativeGraph({
      id: 'candidate',
      experienceId,
      versionIndex: current.graph.versionIndex + 1,
      locked: false,
      createdAt: now(),
      ...persistedGraph,
    });
    // Graph revisions remain editable for a solo author. Runtime builds, not a
    // graph lock, are the immutable artifact used for reproducible playtests.
    const normalizedStatus: InteractiveVersionStatus = 'draft';
    const currentPersisted = graphForPersistence(current.graph);
    const semanticGraphChanged = JSON.stringify(currentPersisted) !== JSON.stringify(persistedGraph);
    const changedNodeIds = new Set(
      Array.from(new Set([
        ...current.graph.nodes.map((node) => node.id),
        ...candidateGraph.nodes.map((node) => node.id),
      ])).filter((nodeId) => {
        const previous = current.graph.nodes.find((node) => node.id === nodeId);
        const next = candidateGraph.nodes.find((node) => node.id === nodeId);
        return JSON.stringify(previous) !== JSON.stringify(next);
      }),
    );
    const stateFlowChangedNodeIds = new Set(
      Array.from(new Set([
        ...current.graph.nodes.map((node) => node.id),
        ...candidateGraph.nodes.map((node) => node.id),
      ])).filter((nodeId) => {
        const previous = current.graph.nodes.find((node) => node.id === nodeId);
        const next = candidateGraph.nodes.find((node) => node.id === nodeId);
        const visualFlow = (node: typeof previous) => node ? {
          id: node.id,
          choices: node.choices.map((choice) => ({
            targetNodeId: choice.targetNodeId,
            condition: choice.condition,
            effects: choice.effects,
          })),
        } : null;
        return JSON.stringify(visualFlow(previous)) !== JSON.stringify(visualFlow(next));
      }),
    );
    if (current.graph.entryNodeId !== candidateGraph.entryNodeId) {
      stateFlowChangedNodeIds.add(current.graph.entryNodeId);
      stateFlowChangedNodeIds.add(candidateGraph.entryNodeId);
    }
    const visualAffectedNodeIds = new Set(changedNodeIds);
    const expandAffectedNodes = (candidate: NarrativeGraphVersion) => {
      const queue = [...stateFlowChangedNodeIds];
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        const node = candidate.nodes.find((item) => item.id === nodeId);
        for (const choice of node?.choices || []) {
          if (visualAffectedNodeIds.has(choice.targetNodeId)) continue;
          visualAffectedNodeIds.add(choice.targetNodeId);
          queue.push(choice.targetNodeId);
        }
      }
    };
    expandAffectedNodes(current.graph);
    expandAffectedNodes(candidateGraph);
    db.transaction(() => {
      const nextId = insertVersion(
        experienceId,
        'graph',
        current.graph.versionIndex + 1,
        normalizedStatus,
        persistedGraph,
      );
      const update = db.prepare(`
        UPDATE interactive_experiences
        SET current_graph_version_id = ?,
            status = ?,
            updated_at = ?
        WHERE id = ? AND current_graph_version_id = ?
      `).run(
        nextId,
        'development',
        now(),
        experienceId,
        current.graph.id,
      );
      if (update.changes !== 1) {
        throw Object.assign(
          new Error('图谱已被其他编辑者更新，请刷新后再保存，避免覆盖对方的修改。'),
          { statusCode: 409 },
        );
      }
      if (changedNodeIds.size > 0) {
        markBindingsReviewRecommended(
          experienceId,
          current.bindings.filter((binding) => changedNodeIds.has(binding.nodeId)),
          ['graph_updated'],
          now(),
        );
        markVisualContextProjectionsStale(experienceId, visualAffectedNodeIds);
        rebaseUnchangedVisualContextProjections(experienceId, visualAffectedNodeIds, nextId);
      }
      if (semanticGraphChanged) {
        markContentPlansStale(experienceId);
      }
    })();
    return requireAggregate(experienceId);
  },

  saveBinding(experienceId: string, binding: NodeContentBinding): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    const node = current.graph.nodes.find((candidate) => candidate.id === binding.nodeId);
    if (!node) {
      throw Object.assign(new Error('Binding node does not exist in the current graph'), { statusCode: 422 });
    }
    if (binding.scriptSceneRef && !binding.scriptSceneRefs) {
      throw Object.assign(new Error('新内容绑定必须使用有序 scriptSceneRefs，不能再写单数 scriptSceneRef'), { statusCode: 422 });
    }
    const scriptSceneRefs = binding.scriptSceneRefs || [];
    if (scriptSceneRefs.some((ref) => ref.kind !== 'script_scene')) {
      throw Object.assign(new Error('scriptSceneRefs must contain only script_scene artifacts'), { statusCode: 422 });
    }
    if (new Set(scriptSceneRefs.map((ref) => `${ref.artifactId}:${ref.versionId}:${ref.checksum}`)).size !== scriptSceneRefs.length) {
      throw Object.assign(new Error('scriptSceneRefs must not contain duplicate scenes'), { statusCode: 422 });
    }
    const mediaTakeRefs = bindingMediaTakeRefs(binding);
    if (mediaTakeRefs.some((ref) => ref.kind !== 'media_take')) {
      throw Object.assign(new Error('mediaTakeRef must reference a media_take artifact'), { statusCode: 422 });
    }
    if (new Set(mediaTakeRefs.map((ref) => `${ref.artifactId}:${ref.versionId}`)).size !== mediaTakeRefs.length) {
      throw Object.assign(new Error('mediaTakeRefs must not contain duplicate takes'), { statusCode: 422 });
    }
    if (binding.mediaTakeRef && binding.mediaTakeRefs?.length && (
      binding.mediaTakeRef.artifactId !== binding.mediaTakeRefs[0].artifactId
      || binding.mediaTakeRef.versionId !== binding.mediaTakeRefs[0].versionId
      || binding.mediaTakeRef.checksum !== binding.mediaTakeRefs[0].checksum
    )) {
      throw Object.assign(new Error('mediaTakeRef must match the first ordered mediaTakeRefs item'), { statusCode: 422 });
    }
    const mediaScenarios = binding.mediaScenarios || [];
    if (
      new Set(mediaScenarios.map((scenario) => scenario.scenarioId)).size !== mediaScenarios.length
      || mediaScenarios.some((scenario) => !scenario.scenarioId || !scenario.reuseFingerprint)
    ) {
      throw Object.assign(new Error('媒体画面状态必须有唯一的情境和复用指纹'), { statusCode: 422 });
    }
    if (mediaScenarios.some((scenario) => (
      scenario.mediaTakeRefs.length === 0
      || scenario.mediaTakeRefs.some((ref) => ref.kind !== 'media_take')
    ))) {
      throw Object.assign(new Error('每个媒体画面状态都必须包含正式视频引用'), { statusCode: 422 });
    }
    const fingerprintByTake = new Map<string, string>();
    for (const scenario of mediaScenarios) {
      for (const ref of scenario.mediaTakeRefs) {
        const identity = `${ref.artifactId}:${ref.versionId}:${ref.checksum}`;
        const previousFingerprint = fingerprintByTake.get(identity);
        if (previousFingerprint && previousFingerprint !== scenario.reuseFingerprint) {
          throw Object.assign(
            new Error('同一个正式视频不能用于两个可见状态不同的画面情境'),
            { statusCode: 422 },
          );
        }
        fingerprintByTake.set(identity, scenario.reuseFingerprint);
      }
    }
    for (const otherBinding of current.bindings) {
      if (otherBinding.nodeId === binding.nodeId && otherBinding.slot === binding.slot) continue;
      for (const otherScenario of otherBinding.mediaScenarios || []) {
        for (const ref of otherScenario.mediaTakeRefs) {
          const selectedFingerprint = fingerprintByTake.get(`${ref.artifactId}:${ref.versionId}:${ref.checksum}`);
          if (selectedFingerprint && selectedFingerprint !== otherScenario.reuseFingerprint) {
            throw Object.assign(
              new Error('该正式视频已绑定到不同的可见状态，不能跨状态复用'),
              { statusCode: 422 },
            );
          }
        }
      }
    }
    if (binding.contentFitReview) {
      const expectedChecksums = scriptSceneRefs.map((ref) => ref.checksum);
      const reviewedChecksums = binding.contentFitReview.sceneChecksums
        || (binding.contentFitReview.scriptChecksum ? [binding.contentFitReview.scriptChecksum] : []);
      if (
        !binding.contentFitReview.rationale.trim()
        || expectedChecksums.length === 0
        || reviewedChecksums.length !== expectedChecksums.length
        || expectedChecksums.some((checksum, index) => reviewedChecksums[index] !== checksum)
      ) {
        throw Object.assign(new Error('contentFitReview must describe and match every ordered script scene'), { statusCode: 422 });
      }
    }
    if (binding.mediaFitReview) {
      const expectedChecksums = new Set(mediaTakeRefs.map((ref) => ref.checksum));
      const reviewedChecksums = new Set(binding.mediaFitReview.mediaChecksums);
      if (!binding.mediaFitReview.rationale.trim() || expectedChecksums.size === 0 || expectedChecksums.size !== reviewedChecksums.size || [...expectedChecksums].some((checksum) => !reviewedChecksums.has(checksum))) {
        throw Object.assign(new Error('mediaFitReview must describe and match every selected media take'), { statusCode: 422 });
      }
    }
    if (binding.status === 'approved' && binding.slot === 'main' && nodeRequiresMainContent(node) && scriptSceneRefs.length === 0) {
      throw Object.assign(new Error('已采用的主内容绑定必须关联剧本场次'), { statusCode: 422 });
    }
    const existingBinding = current.bindings.find((candidate) => (
      candidate.nodeId === binding.nodeId && candidate.slot === binding.slot
    ));
    if (
      existingBinding
      && binding.versionIndex !== existingBinding.versionIndex
    ) {
      throw Object.assign(new Error('节点内容已被更新，请刷新后再提交'), { statusCode: 409 });
    }
    const scriptRefsChanged = Boolean(existingBinding)
      && !artifactRefListEquals(bindingScriptSceneRefs(existingBinding), scriptSceneRefs);
    const timestamp = now();
    const normalizedBindingBase: NodeContentBinding = {
      ...binding,
      sourceReview: existingBinding?.sourceReview || binding.sourceReview,
      scriptSceneRefs,
      scriptSceneRef: undefined,
      mediaTakeRefs,
      mediaTakeRef: undefined,
      mediaScenarios,
      contentFitReview: binding.contentFitReview ? {
        ...binding.contentFitReview,
        sceneChecksums: scriptSceneRefs.map((ref) => ref.checksum),
        scriptChecksum: undefined,
      } : undefined,
      mediaFitReview: binding.mediaFitReview,
    };
    const normalizedBinding = reconcileBindingSourceReview(
      scriptRefsChanged
        ? recommendBindingSourceReview(
            normalizedBindingBase,
            ['binding_source_updated'],
            timestamp,
          )
        : normalizedBindingBase,
    );
    const visualContractChanged = (!existingBinding && scriptSceneRefs.length > 0)
      || scriptRefsChanged;
    // Every edit creates a new binding revision. Existing Runtime Builds keep
    // their frozen snapshots while newer Builds use the reviewed head.
    const id = existingBinding?.id || binding.id || createId('binding');
    const status = binding.status || 'draft';
    const versionIndex = (existingBinding?.versionIndex || 0) + 1;
    const versionId = createId('binding_version');
    const stored = {
      ...normalizedBinding,
      id: undefined,
      experienceId: undefined,
      versionIndex,
      updatedAt: undefined,
    };
    const persistBinding = db.transaction(() => {
      db.prepare(`
        INSERT INTO interactive_node_content_bindings
          (id, experience_id, node_id, slot, status, created_at, updated_at, current_version_id, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(experience_id, node_id, slot) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          data = excluded.data
      `).run(
        id,
        experienceId,
        binding.nodeId,
        binding.slot,
        status,
        existingBinding?.updatedAt || timestamp,
        timestamp,
        JSON.stringify(stored),
      );
      db.prepare(`
        INSERT INTO interactive_node_content_binding_versions
          (id, binding_id, experience_id, node_id, slot, version_index, status, created_at, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId,
        id,
        experienceId,
        binding.nodeId,
        binding.slot,
        versionIndex,
        status,
        timestamp,
        JSON.stringify(stored),
      );
      db.prepare(`
        UPDATE interactive_node_content_bindings
        SET current_version_id = ?
        WHERE id = ?
      `).run(versionId, id);
    });
    persistBinding();
    if (visualContractChanged) {
      markVisualContextProjectionsStale(experienceId, new Set([binding.nodeId]));
    }
    db.prepare('UPDATE interactive_experiences SET updated_at = ? WHERE id = ?').run(timestamp, experienceId);
    return requireAggregate(experienceId);
  },

  saveBindings(
    experienceId: string,
    bindings: NodeContentBinding[],
  ): InteractiveExperienceAggregate {
    if (bindings.length === 0) {
      throw Object.assign(new Error('至少需要提交一个节点内容选择'), { statusCode: 400 });
    }
    const bindingKeys = bindings.map((binding) => `${binding.nodeId}:${binding.slot}`);
    if (new Set(bindingKeys).size !== bindingKeys.length) {
      throw Object.assign(new Error('同一次提交不能重复包含相同节点内容位置'), { statusCode: 422 });
    }
    const save = db.transaction(() => {
      for (const binding of bindings) this.saveBinding(experienceId, binding);
      return requireAggregate(experienceId);
    });
    return save();
  },

  saveScriptBindings(
    experienceId: string,
    updates: Array<Pick<NodeContentBinding, 'nodeId' | 'slot' | 'versionIndex' | 'scriptSceneRefs' | 'contentFitReview' | 'reusePolicy' | 'status'>>,
  ): InteractiveExperienceAggregate {
    if (updates.length === 0 || new Set(updates.map((item) => `${item.nodeId}:${item.slot}`)).size !== updates.length) {
      throw Object.assign(new Error('剧本映射必须包含不同的节点位置'), { statusCode: 422 });
    }
    return db.transaction(() => {
      for (const update of updates) {
        const existing = requireAggregate(experienceId).bindings.find((binding) => (
          binding.nodeId === update.nodeId && binding.slot === update.slot
        ));
        this.saveBinding(experienceId, {
          ...existing,
          ...update,
          // A script review never owns media selections or their review.
          mediaTakeRefs: existing?.mediaTakeRefs,
          mediaScenarios: existing?.mediaScenarios,
          mediaFitReview: existing?.mediaFitReview,
        });
      }
      return requireAggregate(experienceId);
    })();
  },

  adoptMediaPlan(
    experienceId: string,
    selections: Array<{
      nodeId: string;
      scenarioId?: string;
      stateFingerprint?: string;
      reuseFingerprint?: string;
      takeRefs: NonNullable<NodeContentBinding['mediaTakeRefs']>;
    }>,
  ): InteractiveExperienceAggregate {
    return db.transaction(() => {
      const current = requireAggregate(experienceId);
      const selectionsByNode = new Map<string, typeof selections>();
      selections.forEach((selection) => {
        selectionsByNode.set(selection.nodeId, [
          ...(selectionsByNode.get(selection.nodeId) || []),
          selection,
        ]);
      });
      for (const [nodeId, nodeSelections] of selectionsByNode) {
        const binding = current.bindings.find((item) => item.nodeId === nodeId && item.slot === 'main');
        if (!binding || binding.status !== 'approved' || bindingScriptSceneRefs(binding).length === 0) {
          throw Object.assign(new Error(`节点 ${nodeId} 的正式剧本内容尚未准备好`), { statusCode: 422 });
        }
        if (nodeSelections.some((selection) => !selection.takeRefs.length)) {
          throw Object.assign(new Error(`节点 ${nodeId} 没有可采用的视频`), { statusCode: 422 });
        }
        const hasScenarioSelections = nodeSelections.some((selection) => (
          Boolean(selection.scenarioId) || Boolean(selection.reuseFingerprint)
        ));
        if (hasScenarioSelections && nodeSelections.some((selection) => (
          !selection.scenarioId || !selection.reuseFingerprint
        ))) {
          throw Object.assign(new Error(`节点 ${nodeId} 的视频状态信息不完整`), { statusCode: 422 });
        }
        const mediaScenarios = hasScenarioSelections
          ? nodeSelections.map((selection) => ({
              scenarioId: selection.scenarioId!,
              stateFingerprint: selection.stateFingerprint,
              reuseFingerprint: selection.reuseFingerprint!,
              mediaTakeRefs: selection.takeRefs,
            }))
          : [];
        const selectedRefs = nodeSelections.flatMap((selection) => selection.takeRefs)
          .filter((ref, index, refs) => refs.findIndex((candidate) => (
            candidate.artifactId === ref.artifactId
            && candidate.versionId === ref.versionId
            && candidate.checksum === ref.checksum
          )) === index);
        this.saveBinding(experienceId, {
          ...binding,
          mediaTakeRefs: selectedRefs,
          mediaTakeRef: undefined,
          mediaScenarios,
          visibleStateSignature: mediaScenarios.length
            ? mediaScenarios.map((scenario) => scenario.reuseFingerprint).sort().join('|')
            : binding.visibleStateSignature,
          reusePolicy: mediaScenarios.length ? 'compatible_states_only' : binding.reusePolicy,
          mediaFitReview: {
            verdict: 'pass',
            rationale: '作者采用了本次画面方案中列出的素材版本；此记录不代表 AI 已检查画面质量。',
            reviewedAt: now(),
            mediaChecksums: selectedRefs.map((ref) => ref.checksum),
          },
        });
      }
      return requireAggregate(experienceId);
    })();
  },

  beginProductionPreparation(experienceId: string): InteractiveExperienceAggregate {
    const current = requireAggregate(experienceId);
    const approvedMainNodeIds = new Set(
      current.bindings
        .filter(hasCurrentContentFitReview)
        .map((binding) => binding.nodeId),
    );
    const missing = current.graph.nodes
      .filter(nodeRequiresMainContent)
      .filter((node) => !approvedMainNodeIds.has(node.id));
    if (missing.length > 0) {
      throw Object.assign(new Error(`以下节点缺少当前剧本的匹配确认：${missing.map((node) => node.brief.title).join('、')}`), { statusCode: 422 });
    }
    db.prepare(`
      UPDATE interactive_experiences
      SET status = 'content_production', updated_at = ?
      WHERE id = ?
    `).run(now(), experienceId);
    return requireAggregate(experienceId);
  },

  // Compatibility for older API consumers. New author-facing flows use
  // beginProductionPreparation; it records readiness but never makes edits read-only.
  lockContent(experienceId: string): InteractiveExperienceAggregate {
    return this.beginProductionPreparation(experienceId);
  },

  deleteExperience(experienceId: string) {
    const row = getExperienceRow(experienceId);
    if (!row) return;
    db.transaction(() => {
      db.prepare('DELETE FROM interactive_experiences WHERE id = ?').run(experienceId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(row.project_id);
    })();
  },
};
