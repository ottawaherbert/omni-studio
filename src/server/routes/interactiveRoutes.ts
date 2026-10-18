import { createHash, randomUUID } from 'node:crypto';
import { trackManualAIWork } from '../manualAI';
import { resolveInteractiveRuntimeStory } from '../interactiveRuntimeStory';
import { createInteractiveStandaloneHtml } from '../interactiveStandaloneExport';
import type { Express, Request, Response } from 'express';

import { interactiveRepository } from '../interactiveRepository';
import type { InteractiveWritingPort } from '../../domains/interactive/ports/writingPort';
import type { InteractiveProductionPrepPort } from '../../domains/interactive/ports/productionPrepPort';
import type {
  CreateInteractiveExperienceInput,
  InteractiveExperience,
  ExperienceSpec,
  InteractiveVersionStatus,
  InteractivePlaytestCheckpoint,
  GraphLayoutRevision,
  NarrativeGraphVersion,
  NodeContentBinding,
  StateSchema,
  StoryArchitecture,
  StorySourceBinding,
} from '../../domains/interactive/types/schema';
import { InteractiveGraphAuthoringService } from '../../services/interactive/interactiveGraphAuthoringService';
import type { GraphDraftGenerator } from '../../services/interactive/interactiveGraphAuthoringService';
import { adoptGraphDraft, rejectGraphDraft } from '../../domains/interactive/authoring/graphDraftAdoption';
import {
  artifactRefListEquals,
  bindingMediaTakeRefs,
  bindingScriptSceneRefs,
} from '../../domains/interactive/binding/nodeContentBinding';
import {
  bindingsForContentPlanAdoption,
  contentPlanAdoptable,
  contentPlanMatchesWritingSource,
  validateInteractiveContentPlan,
} from '../../domains/interactive/contentPlanning/contentPlan';
import type {
  InteractiveContentPlanDraft,
  InteractiveContentWritingRequest,
} from '../../domains/interactive/contentPlanning/contentPlan';
import { InteractiveContentPlanningService } from '../../services/interactive/interactiveContentPlanningService';
import { projectInteractiveAuthoringStatus } from '../../services/interactive/interactiveAuthoringStatusProjection';
import type {
  InteractiveExecutionPolicy,
  InteractiveProposalAdoptionRun,
  InteractiveProposalAdoptionResult,
  InteractiveProposalKind,
  InteractiveTaskOwner,
  InteractiveTaskRetryContext,
  InteractiveTaskStatus,
} from '../../domains/interactive/authoring/taskCoordination';
import {
  createProposalAdoptionRun,
  finishProposalAdoptionRun,
  pendingProposalAdoptions,
  proposalAdoptionOrder,
  recordProposalAdoptionResult,
} from '../../domains/interactive/authoring/proposalBundle';

const fail = (res: Response, error: unknown) => {
  const status = Number((error as { statusCode?: number })?.statusCode) || 500;
  const message = error instanceof Error ? error.message : 'Interactive domain request failed';
  if (status >= 500) console.error('[Interactive Domain]', error);
  return res.status(status).json({ error: message });
};

const requireText = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  }
};

const requireOneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string) => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw Object.assign(new Error(`${field} is invalid`), { statusCode: 400 });
  }
};

export const interactiveGraphAttemptFingerprint = (input: {
  graphVersionId: string;
  action: Extract<InteractiveTaskRetryContext, { kind: 'interactive_graph' }>['action'];
  authorIntent: string;
  scopeNodeId?: string;
  strategy?: 'foldback' | 'parallel' | 'failure';
  issueIds?: string[];
  revisionOfDraftId?: string;
}) => createHash('sha256').update(JSON.stringify({
  graphVersionId: input.graphVersionId,
  action: input.action,
  authorIntent: input.authorIntent.trim(),
  scopeNodeId: input.scopeNodeId || '',
  strategy: input.strategy || '',
  issueIds: [...(input.issueIds || [])].sort(),
  revisionOfDraftId: input.revisionOfDraftId || '',
})).digest('hex');

export const interactiveContentPlanAttemptFingerprint = (input: {
  graphVersionId: string;
  writingProjectRevision: number;
  authorIntent: string;
}) => createHash('sha256').update(JSON.stringify({
  graphVersionId: input.graphVersionId,
  writingProjectRevision: input.writingProjectRevision,
  authorIntent: input.authorIntent.trim(),
})).digest('hex');

export const registerInteractiveRoutes = (
  app: Express,
  {
    writingPort,
    productionPrepPort,
    graphDraftGenerator,
    mediaAssetsDir,
  }: {
    writingPort?: InteractiveWritingPort;
    productionPrepPort?: InteractiveProductionPrepPort;
    graphDraftGenerator?: GraphDraftGenerator;
    mediaAssetsDir?: string;
  } = {},
) => {
  const requireWritingPort = () => {
    if (!writingPort) {
      throw Object.assign(new Error('Writing binding service is unavailable'), { statusCode: 503 });
    }
    return writingPort;
  };
  const requireProductionPrepPort = () => {
    if (!productionPrepPort) {
      throw Object.assign(new Error('共享制片筹备服务暂不可用'), { statusCode: 503 });
    }
    return productionPrepPort;
  };
  const recordTaskRef = ({
    experienceId,
    owner,
    taskId,
    purpose,
    inputFingerprint,
    dependsOnOwners = [],
    status = 'review',
    retryContext,
  }: {
    experienceId: string;
    owner: InteractiveTaskOwner;
    taskId: string;
    purpose: string;
    inputFingerprint: string;
    dependsOnOwners?: InteractiveTaskOwner[];
    status?: InteractiveTaskStatus;
    retryContext?: InteractiveTaskRetryContext;
  }) => {
    const coordination = interactiveRepository.recoverInterruptedTasks(experienceId);
    const dependsOn = dependsOnOwners.flatMap((dependencyOwner) => {
      const dependency = [...coordination.taskRefs].reverse()
        .find((task) => task.owner === dependencyOwner);
      return dependency ? [dependency.taskId] : [];
    });
    return interactiveRepository.addTaskRef(experienceId, {
      owner,
      taskId,
      purpose,
      dependsOn,
      inputFingerprint,
      idempotencyKey: `${owner}:${inputFingerprint}`,
      status,
      retryContext,
    });
  };
  const confirmedAuthorIntentFor = (experienceId: string) => {
    const tasks = interactiveRepository.getTaskCoordination(experienceId).taskRefs;
    for (const task of [...tasks].reverse()) {
      const context = task.retryContext;
      if (context?.kind === 'content_plan' && context.authorIntent.trim()) {
        return context.authorIntent.trim();
      }
      if (context?.kind === 'interactive_graph' && context.authorIntent.trim()) {
        return context.authorIntent.trim();
      }
      if (
        context?.kind === 'writing'
        && task.purpose !== '按全图方案补齐分支剧本'
        && context.authorFeedback?.trim()
      ) {
        return context.authorFeedback.trim();
      }
    }
    return '';
  };
  const settleCandidateTask = (
    experienceId: string,
    candidateId: string,
    status: Extract<InteractiveTaskStatus, 'completed' | 'cancelled' | 'stale'>,
  ) => {
    const task = interactiveRepository.getTaskCoordination(experienceId).taskRefs
      .find((item) => item.taskId === candidateId);
    return task
      ? interactiveRepository.updateTaskRef(experienceId, candidateId, status)
      : interactiveRepository.getTaskCoordination(experienceId);
  };

  const assertWritingSource = (source: StorySourceBinding | undefined) => {
    const mode = source?.mode;
    requireOneOf(mode, ['scratch', 'bind_writing', 'import'], 'storySource.mode');
    if (mode === 'bind_writing') {
      requireText(source.writingProjectId, 'storySource.writingProjectId');
      if (!requireWritingPort().hasProject(source.writingProjectId!)) {
        throw Object.assign(new Error('已选 Writing 项目不存在或不可访问'), { statusCode: 422 });
      }
    }
  };

  const assertNodeContentBinding = (experienceId: string, binding: NodeContentBinding) => {
    requireText(binding?.nodeId, 'nodeId');
    requireOneOf(binding?.slot, ['entry', 'main', 'choice_hold', 'exit'], 'slot');
    if (binding?.status) requireOneOf(binding.status, ['draft', 'approved', 'stale'], 'status');
    if (binding.scriptSceneRef && !binding.scriptSceneRefs) {
      throw Object.assign(new Error('请使用有序 scriptSceneRefs 提交节点内容'), { statusCode: 422 });
    }
    if (binding.scriptSceneRefs !== undefined && !Array.isArray(binding.scriptSceneRefs)) {
      throw Object.assign(new Error('scriptSceneRefs must be an array'), { statusCode: 400 });
    }
    const scriptSceneRefs = binding.scriptSceneRefs || [];
    if (binding.contentFitReview) {
      if (binding.contentFitReview.verdict !== 'pass' || !binding.contentFitReview.rationale?.trim()) {
        throw Object.assign(new Error('内容匹配确认必须包含通过结论与具体理由'), { statusCode: 422 });
      }
      const reviewedChecksums = binding.contentFitReview.sceneChecksums
        || (binding.contentFitReview.scriptChecksum ? [binding.contentFitReview.scriptChecksum] : []);
      if (
        scriptSceneRefs.length === 0
        || reviewedChecksums.length !== scriptSceneRefs.length
        || scriptSceneRefs.some((ref, index) => reviewedChecksums[index] !== ref.checksum)
      ) {
        throw Object.assign(new Error('内容匹配确认必须依次覆盖当前选择的全部精确剧本场次'), { statusCode: 422 });
      }
    }
    if (scriptSceneRefs.length === 0) return;
    const aggregate = interactiveRepository.getExperience(experienceId);
    const writingProjectId = aggregate.experience.storySource.writingProjectId;
    if (aggregate.experience.storySource.mode !== 'bind_writing' || !writingProjectId) {
      throw Object.assign(new Error('请先绑定 Writing 项目，再选择节点剧本内容'), { statusCode: 409 });
    }
    const scenes = scriptSceneRefs.map((ref) => requireWritingPort().resolveScene(ref));
    if (scenes.some((scene) => !scene || scene.writingProjectId !== writingProjectId)) {
      throw Object.assign(new Error('剧本引用不是当前 Writing 项目的有效精确版本，请重新选择'), { statusCode: 422 });
    }
    const resolved = scenes.filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
    if (new Set(resolved.map((scene) => scene.writingProjectRevision)).size !== 1) {
      throw Object.assign(new Error('一个节点的剧本场次必须来自同一 Writing revision'), { statusCode: 422 });
    }
    if (new Set(resolved.map((scene) => scene.unitId)).size !== 1) {
      throw Object.assign(new Error('一个节点不能跨 Writing 单元，请先让 AI 在单元边界拆分节点'), { statusCode: 422 });
    }
  };

  app.get('/api/interactive/writing-projects', (_req, res) => {
    try {
      res.json(requireWritingPort().listProjects());
    } catch (error) {
      fail(res, error);
    }
  });
  app.get('/api/interactive/experiences', (_req, res) => {
    try {
      res.json(interactiveRepository.listExperiences());
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences', (req: Request<unknown, unknown, CreateInteractiveExperienceInput>, res) => {
    try {
      requireText(req.body?.title, 'title');
      requireText(req.body?.genre, 'genre');
      requireText(req.body?.experienceSpec?.playerRole, 'experienceSpec.playerRole');
      requireText(req.body?.experienceSpec?.interactionPromise, 'experienceSpec.interactionPromise');
      if (!Array.isArray(req.body?.experienceSpec?.coreVerbs) || req.body.experienceSpec.coreVerbs.length === 0) {
        throw Object.assign(new Error('experienceSpec.coreVerbs requires at least one verb'), { statusCode: 400 });
      }
      requireOneOf(req.body?.formatProfile?.format, ['branching_fmv', 'interactive_series', 'narrative_game'], 'formatProfile.format');
      requireOneOf(req.body?.formatProfile?.aspectRatio, ['16:9', '9:16', '1:1'], 'formatProfile.aspectRatio');
      if (!Array.isArray(req.body?.formatProfile?.platforms) || req.body.formatProfile.platforms.length === 0) {
        throw Object.assign(new Error('formatProfile.platforms requires at least one platform'), { statusCode: 400 });
      }
      req.body.formatProfile.platforms.forEach((platform) => {
        requireOneOf(platform, ['web', 'mobile', 'tv', 'desktop', 'console'], 'formatProfile.platforms');
      });
      assertWritingSource(req.body.storySource);
      const repairAttempts = req.body?.productionBoundary?.maxAutomaticRepairAttempts;
      if (!Number.isInteger(repairAttempts) || repairAttempts < 0 || repairAttempts > 2) {
        throw Object.assign(new Error('productionBoundary.maxAutomaticRepairAttempts must be between 0 and 2'), { statusCode: 400 });
      }
      const executionPolicy = req.body.executionPolicy || 'autopilot';
      requireOneOf(executionPolicy, ['autopilot', 'guided'], 'executionPolicy');
      if (req.body.authoringPrompt !== undefined) {
        requireText(req.body.authoringPrompt, 'authoringPrompt');
      }
      const centralConflict = typeof req.body.experienceSpec?.dramaticContract?.centralConflict === 'string'
        ? req.body.experienceSpec.dramaticContract.centralConflict.trim()
        : '';
      const initialAuthoringPrompt = req.body.authoringPrompt?.trim()
        || centralConflict;
      if (req.body.storySource.mode === 'scratch') {
        requireText(initialAuthoringPrompt, 'authoringPrompt');
      }
      const aggregate = interactiveRepository.createExperience(req.body);
      interactiveRepository.saveTaskCoordination(aggregate.experience.id, {
        executionPolicy,
        paused: false,
      });
      if (req.body.storySource.mode !== 'scratch') {
        if (req.body.storySource.mode === 'bind_writing' && req.body.storySource.writingProjectId) {
          const writingProject = requireWritingPort().listProjects()
            .find((project) => project.id === req.body.storySource.writingProjectId);
          recordTaskRef({
            experienceId: aggregate.experience.id,
            owner: 'writing',
            taskId: `writing-source-${req.body.storySource.writingProjectId}-r${writingProject?.revision || 0}`,
            purpose: '读取已有统一剧本',
            inputFingerprint: `${req.body.storySource.writingProjectId}:r${writingProject?.revision || 0}`,
            status: 'completed',
            retryContext: initialAuthoringPrompt
              ? {
                  kind: 'writing',
                  authorFeedback: initialAuthoringPrompt,
                }
              : undefined,
          });
        }
        return res.status(201).json(aggregate);
      }

      return res.status(201).json(aggregate);

    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId', (req, res) => {
    try {
      const aggregate = interactiveRepository.getExperience(req.params.experienceId);
      if (req.query.view !== 'whiteboard') return res.json(aggregate);
      return res.json({
        ...aggregate,
        graph: aggregate.graph.transitions
          ? {
              ...aggregate.graph,
              nodes: aggregate.graph.nodes.map((node) => ({ ...node, choices: [] })),
            }
          : aggregate.graph,
        bindings: aggregate.bindings,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.put('/api/interactive/experiences/:experienceId/details', (
    req: Request<{ experienceId: string }, unknown, {
      details?: Pick<InteractiveExperience, 'title' | 'genre' | 'formatProfile' | 'productionBoundary'>;
      expectedUpdatedAt?: string;
    }>, res,
  ) => {
    try {
      const details = req.body?.details;
      requireText(details?.title, 'details.title');
      requireText(details?.genre, 'details.genre');
      requireOneOf(details?.formatProfile?.format, ['branching_fmv', 'interactive_series', 'narrative_game'], 'details.formatProfile.format');
      requireOneOf(details?.formatProfile?.aspectRatio, ['16:9', '9:16', '1:1'], 'details.formatProfile.aspectRatio');
      if (!Array.isArray(details?.formatProfile?.platforms) || !details.formatProfile.platforms.length) {
        throw Object.assign(new Error('details.formatProfile.platforms requires at least one platform'), { statusCode: 400 });
      }
      details.formatProfile.platforms.forEach((platform) => requireOneOf(platform, ['web', 'mobile', 'tv', 'desktop', 'console'], 'details.formatProfile.platforms'));
      if (!details.productionBoundary || !Number.isInteger(details.productionBoundary.maxAutomaticRepairAttempts)) {
        throw Object.assign(new Error('details.productionBoundary is invalid'), { statusCode: 400 });
      }
      if (req.body.expectedUpdatedAt !== undefined) requireText(req.body.expectedUpdatedAt, 'expectedUpdatedAt');
      res.json(interactiveRepository.saveExperienceDetails(req.params.experienceId, details, req.body.expectedUpdatedAt));
    } catch (error) { fail(res, error); }
  });

  app.put('/api/interactive/experiences/:experienceId/experience-spec', (
    req: Request<{ experienceId: string }, unknown, { spec?: ExperienceSpec; expectedVersionIndex?: number }>, res,
  ) => {
    try {
      if (!req.body?.spec || typeof req.body.spec !== 'object' || Array.isArray(req.body.spec)) {
        throw Object.assign(new Error('experience spec is required'), { statusCode: 400 });
      }
      requireText(req.body.spec.playerRole, 'spec.playerRole');
      requireText(req.body.spec.interactionPromise, 'spec.interactionPromise');
      if (req.body.expectedVersionIndex !== undefined && (!Number.isInteger(req.body.expectedVersionIndex) || req.body.expectedVersionIndex < 1)) {
        throw Object.assign(new Error('expectedVersionIndex must be a positive integer'), { statusCode: 400 });
      }
      res.json(interactiveRepository.saveExperienceSpec(req.params.experienceId, req.body.spec, req.body.expectedVersionIndex));
    } catch (error) { fail(res, error); }
  });

  app.get('/api/interactive/experiences/:experienceId/story-architecture/history', (req, res) => {
    try {
      res.json(interactiveRepository.listStoryArchitectureVersions(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.put(
    '/api/interactive/experiences/:experienceId/story-architecture',
    (req: Request<{ experienceId: string }, unknown, { architecture: StoryArchitecture; status?: InteractiveVersionStatus; expectedVersionIndex?: number }>, res) => {
      try {
        if (!req.body?.architecture || typeof req.body.architecture !== 'object') {
          throw Object.assign(new Error('story architecture is required'), { statusCode: 400 });
        }
        if (req.body.status) requireOneOf(req.body.status, ['draft', 'approved'], 'status');
        if (req.body.expectedVersionIndex !== undefined && (!Number.isInteger(req.body.expectedVersionIndex) || req.body.expectedVersionIndex < 1)) {
          throw Object.assign(new Error('expectedVersionIndex must be a positive integer'), { statusCode: 400 });
        }
        res.json(interactiveRepository.saveStoryArchitecture(
          req.params.experienceId,
          req.body.architecture,
          req.body.status,
          req.body.expectedVersionIndex,
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/runtime-build', (req, res) => {
    try {
      res.json(interactiveRepository.getLatestRuntimeBuild(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences/:experienceId/runtime-build', (req, res) => {
    try {
      const build = interactiveRepository.createRuntimeBuild(req.params.experienceId);
      recordTaskRef({
        experienceId: req.params.experienceId,
        owner: 'runtime',
        taskId: build.id,
        purpose: '准备互动试玩',
        inputFingerprint: `${build.graphVersionId}:${build.stateSchemaVersionId}:${build.nodeManifests.map((item) => item.nodeId).join(',')}`,
        dependsOnOwners: ['production', 'content_plan'],
        status: 'completed',
        retryContext: { kind: 'runtime', buildKind: 'formal' },
      });
      res.status(201).json(build);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences/:experienceId/structure-preview-build', (req, res) => {
    try {
      const build = interactiveRepository.createStructurePreviewBuild(req.params.experienceId);
      recordTaskRef({
        experienceId: req.params.experienceId,
        owner: 'runtime',
        taskId: build.id,
        purpose: '准备结构试玩',
        inputFingerprint: `${build.graphVersionId}:${build.stateSchemaVersionId}:structure-preview`,
        dependsOnOwners: [],
        status: 'completed',
        retryContext: { kind: 'runtime', buildKind: 'structure' },
      });
      res.status(201).json(build);
    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/runtime-export', async (req, res) => {
    try {
      const id = req.params.experienceId;
      const buildId = typeof req.query.runtimeBuildId === 'string' ? req.query.runtimeBuildId : '';
      const build = buildId ? interactiveRepository.getRuntimeBuild(id, buildId) : null;
      if (!build || build.status === 'stale') throw Object.assign(new Error('请先准备有效的试玩快照，再导出。'), { statusCode: 409 });
      if (!mediaAssetsDir) throw Object.assign(new Error('可玩文件导出服务尚未配置。'), { statusCode: 503 });
      const aggregate = interactiveRepository.getExperience(id);
      const story = resolveInteractiveRuntimeStory(build, requireWritingPort());
      const media = build.status === 'ready_for_player' ? requireProductionPrepPort().resolveRuntimeMediaManifest(id, build.id) : null;
      const html = await createInteractiveStandaloneHtml({ schemaVersion: 'interactive-player.v1', aggregate, build, story, media }, mediaAssetsDir);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="interactive-player.html"; filename*=UTF-8''${encodeURIComponent(aggregate.experience.title + '.html')}`);
      res.send(html);
    } catch (error) { fail(res, error); }
  });

  app.get('/api/interactive/experiences/:experienceId/runtime-media', (req, res) => {
    try {
      const runtimeBuildId = typeof req.query.runtimeBuildId === 'string'
        ? req.query.runtimeBuildId.trim()
        : undefined;
      res.json(requireProductionPrepPort().resolveRuntimeMediaManifest(req.params.experienceId, runtimeBuildId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/runtime-story', (req, res) => {
    try {
      const runtimeBuildId = typeof req.query.runtimeBuildId === 'string'
        ? req.query.runtimeBuildId.trim()
        : undefined;
      const build = runtimeBuildId
        ? interactiveRepository.getRuntimeBuild(req.params.experienceId, runtimeBuildId)
        : interactiveRepository.getLatestRuntimeBuild(req.params.experienceId);
      if (!build) {
        throw Object.assign(new Error('请先开始试玩，再读取故事内容。'), { statusCode: 422 });
      }
      if (build.status === 'stale') {
        throw Object.assign(new Error(build.staleReason || '本次试玩内容已更新，请重新开始。'), { statusCode: 409 });
      }
      const port = requireWritingPort();
      const { nodes } = resolveInteractiveRuntimeStory(build, port);
      res.json({
        buildId: build.id,
        experienceId: req.params.experienceId,
        nodes,
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/playtest-checkpoint', (req: Request<{ experienceId: string }, unknown, unknown, { runtimeBuildId?: string }>, res) => {
    try {
      res.json(interactiveRepository.getPlaytestCheckpoint(
        req.params.experienceId,
        typeof req.query.runtimeBuildId === 'string' ? req.query.runtimeBuildId : undefined,
      ));
    } catch (error) {
      fail(res, error);
    }
  });

  app.put('/api/interactive/experiences/:experienceId/playtest-checkpoint', (req: Request<{ experienceId: string }, unknown, Pick<InteractivePlaytestCheckpoint, 'runtimeBuildId' | 'currentNodeId' | 'state'>>, res) => {
    try {
      requireText(req.body?.currentNodeId, 'currentNodeId');
      if (!req.body?.state || typeof req.body.state !== 'object') {
        throw Object.assign(new Error('state is required'), { statusCode: 400 });
      }
      res.json(interactiveRepository.savePlaytestCheckpoint(req.params.experienceId, req.body));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/production-prep', (req, res) => {
    try {
      res.json(requireProductionPrepPort().getTarget(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences/:experienceId/production-prep', (req, res) => {
    try {
      res.status(201).json(requireProductionPrepPort().ensureTarget(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/production-plan/latest', (req, res) => {
    try {
      res.json(requireProductionPrepPort().getLatestPlan(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences/:experienceId/production-plan', (req, res) => {
    try {
      const plan = requireProductionPrepPort().createPlan(req.params.experienceId);
      recordTaskRef({
        experienceId: req.params.experienceId,
        owner: 'production',
        taskId: plan.id,
        purpose: '准备完整制片场次方案',
        inputFingerprint: `${plan.sourceHash}:${plan.sourceWritingRevision}`,
        dependsOnOwners: ['content_plan', 'writing'],
        retryContext: { kind: 'production_plan' },
      });
      res.status(201).json(plan);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(
    '/api/interactive/experiences/:experienceId/production-plan/:planId/adopt',
    (req: Request<{ experienceId: string; planId: string }>, res) => {
      try {
        const result = requireProductionPrepPort().adoptPlan(req.params.experienceId, req.params.planId);
        settleCandidateTask(req.params.experienceId, req.params.planId, 'completed');
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/visual-refinement/latest', (req, res) => {
    try {
      const productionSceneId = typeof req.query.productionSceneId === 'string'
        ? req.query.productionSceneId.trim()
        : '';
      const visualScenarioId = typeof req.query.visualScenarioId === 'string'
        ? req.query.visualScenarioId.trim()
        : '';
      requireText(productionSceneId, 'productionSceneId');
      requireText(visualScenarioId, 'visualScenarioId');
      res.json(requireProductionPrepPort().getLatestVisualRefinement(
        req.params.experienceId,
        productionSceneId,
        visualScenarioId,
      ));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(
    '/api/interactive/experiences/:experienceId/visual-refinement',
    async (
      req: Request<
        { experienceId: string },
        unknown,
        {
          productionSceneId?: string;
          visualScenarioId?: string;
          finalPrompt?: string;
          selectedSkillIds?: string[];
          selectedSkillTitles?: string[];
          selectedContextIds?: string[];
        }
      >,
      res,
    ) => {
      try {
        requireText(req.body.productionSceneId, 'productionSceneId');
        requireText(req.body.visualScenarioId, 'visualScenarioId');
        requireText(req.body.finalPrompt, 'finalPrompt');
        const draft = await requireProductionPrepPort().createVisualRefinement(
          req.params.experienceId,
          {
            productionSceneId: req.body.productionSceneId!.trim(),
            visualScenarioId: req.body.visualScenarioId!.trim(),
            finalPrompt: req.body.finalPrompt!.trim(),
            selectedSkillIds: Array.isArray(req.body.selectedSkillIds) ? req.body.selectedSkillIds : [],
            selectedSkillTitles: Array.isArray(req.body.selectedSkillTitles) ? req.body.selectedSkillTitles : [],
            selectedContextIds: Array.isArray(req.body.selectedContextIds) ? req.body.selectedContextIds : [],
          },
        );
        res.status(201).json(draft);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/visual-refinement/:draftId/adopt',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        res.json(requireProductionPrepPort().adoptVisualRefinement(
          req.params.experienceId,
          req.params.draftId,
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/visual-refinement/:draftId/reject',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        res.json(requireProductionPrepPort().rejectVisualRefinement(
          req.params.experienceId,
          req.params.draftId,
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/media-plan/latest', (req, res) => {
    try {
      res.json(requireProductionPrepPort().getLatestMediaPlan(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/interactive/experiences/:experienceId/media-plan', (req, res) => {
    try {
      const plan = requireProductionPrepPort().createMediaPlan(req.params.experienceId);
      recordTaskRef({
        experienceId: req.params.experienceId,
        owner: 'production',
        taskId: plan.id,
        purpose: '汇总并审阅可用画面',
        inputFingerprint: `${plan.productionProjectId}:${plan.selections.flatMap((item) => item.takeRefs.map((ref) => ref.checksum)).join(',')}`,
        dependsOnOwners: ['production'],
        retryContext: { kind: 'media_plan' },
      });
      res.status(201).json(plan);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(
    '/api/interactive/experiences/:experienceId/media-plan/:planId/adopt',
    (req: Request<{ experienceId: string; planId: string }>, res) => {
      try {
        const result = requireProductionPrepPort().adoptMediaPlan(req.params.experienceId, req.params.planId);
        settleCandidateTask(req.params.experienceId, req.params.planId, 'completed');
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/media-plan/:planId/feedback',
    (
      req: Request<
        { experienceId: string; planId: string },
        unknown,
        { nodeId?: string; scenarioId?: string; feedback?: string }
      >,
      res,
    ) => {
      try {
        requireText(req.body.nodeId, 'nodeId');
        requireText(req.body.feedback, 'feedback');
        const plan = requireProductionPrepPort().requestMediaRevision(
          req.params.experienceId,
          req.params.planId,
          req.body.nodeId!.trim(),
          req.body.feedback!.trim(),
          req.body.scenarioId?.trim() || undefined,
        );
        const feedbackHash = createHash('sha256').update(req.body.feedback!.trim()).digest('hex').slice(0, 12);
        const scenarioId = req.body.scenarioId?.trim() || undefined;
        const selectionId = `${req.body.nodeId!.trim()}${scenarioId ? `:${scenarioId}` : ''}`;
        recordTaskRef({
          experienceId: req.params.experienceId,
          owner: 'production',
          taskId: `${plan.id}:${selectionId}`,
          purpose: '按作者意见返修节点视频',
          inputFingerprint: `${selectionId}:${feedbackHash}`,
          dependsOnOwners: ['production'],
          retryContext: {
            kind: 'media_revision',
            planId: req.params.planId,
            nodeId: req.body.nodeId!.trim(),
            scenarioId,
            feedback: req.body.feedback!.trim(),
          },
        });
        res.status(201).json(plan);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/production-plan/:planId/reject',
    (req: Request<{ experienceId: string; planId: string }>, res) => {
      try {
        const result = requireProductionPrepPort().rejectPlan(req.params.experienceId, req.params.planId);
        settleCandidateTask(req.params.experienceId, req.params.planId, 'cancelled');
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/production-media', (req, res) => {
    try {
      const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId.trim() : '';
      requireText(nodeId, 'nodeId');
      res.json(requireProductionPrepPort().listMediaTakes(req.params.experienceId, nodeId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.put(
    '/api/interactive/experiences/:experienceId/story-source',
    (req: Request<{ experienceId: string }, unknown, StorySourceBinding>, res) => {
      try {
        assertWritingSource(req.body);
        res.json(interactiveRepository.saveStorySource(req.params.experienceId, req.body));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/writing-scenes', (req, res) => {
    try {
      const aggregate = interactiveRepository.getExperience(req.params.experienceId);
      const writingProjectId = aggregate.experience.storySource.writingProjectId;
      if (aggregate.experience.storySource.mode !== 'bind_writing' || !writingProjectId) {
        throw Object.assign(new Error('请先为互动项目绑定一个 Writing 项目'), { statusCode: 409 });
      }
      const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId.trim() : '';
      if (!nodeId) {
        const scenes = requireWritingPort().listScenes(writingProjectId);
        if (req.query.view !== 'summary') return res.json(scenes);
        return res.json(scenes.map((scene) => ({
          ...scene,
          scriptBlocks: undefined,
        })));
      }
      if (!aggregate.graph.nodes.some((node) => node.id === nodeId)) {
        throw Object.assign(new Error('互动节点不存在'), { statusCode: 404 });
      }
      const binding = aggregate.bindings.find((candidate) => (
        candidate.nodeId === nodeId && candidate.slot === 'main'
      ));
      const scenes = bindingScriptSceneRefs(binding).flatMap((ref) => {
        const scene = requireWritingPort().resolveScene(ref);
        return scene?.writingProjectId === writingProjectId ? [scene] : [];
      });
      return res.json(scenes);
    } catch (error) {
      return fail(res, error);
    }
  });

  app.get('/api/interactive/experiences/:experienceId/writing-status', (req, res) => {
    try {
      const aggregate = interactiveRepository.getExperience(req.params.experienceId);
      const writingProjectId = aggregate.experience.storySource.writingProjectId;
      if (aggregate.experience.storySource.mode !== 'bind_writing' || !writingProjectId) {
        return res.json({ state: 'idle', message: '等待建立统一剧本项目' });
      }
      return res.json(requireWritingPort().getGenerationStatus(writingProjectId));
    } catch (error) {
      return fail(res, error);
    }
  });

  app.put(
    '/api/interactive/experiences/:experienceId/state-schema',
    (req: Request<{ experienceId: string }, unknown, StateSchema & { expectedVersionIndex?: number }>, res) => {
      try {
        const factDefinitions = req.body?.factDefinitions ?? req.body?.facts;
        if (!Array.isArray(req.body?.variables) || !Array.isArray(factDefinitions)) {
          throw Object.assign(new Error('State schema requires variables and factDefinitions arrays'), { statusCode: 400 });
        }
        if (req.body?.initialFactIds !== undefined && !Array.isArray(req.body.initialFactIds)) {
          throw Object.assign(new Error('State schema initialFactIds must be an array'), { statusCode: 400 });
        }
        if (req.body.expectedVersionIndex !== undefined && (!Number.isInteger(req.body.expectedVersionIndex) || req.body.expectedVersionIndex < 1)) {
          throw Object.assign(new Error('expectedVersionIndex must be a positive integer'), { statusCode: 400 });
        }
        const { expectedVersionIndex, ...schema } = req.body;
        res.json(interactiveRepository.saveStateSchema(req.params.experienceId, schema, expectedVersionIndex));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  const beginProductionPreparation = (req: Request<{ experienceId: string }>, res: Response) => {
    try {
      const aggregate = interactiveRepository.getExperience(req.params.experienceId);
      const writingProjectId = aggregate.experience.storySource.writingProjectId;
      if (aggregate.experience.storySource.mode !== 'bind_writing' || !writingProjectId) {
        throw Object.assign(new Error('制片准备需要先绑定 Writing 项目'), { statusCode: 409 });
      }
      const invalidBinding = aggregate.bindings.find((binding) => (
        binding.slot === 'main'
        && binding.status === 'approved'
        && (
          bindingScriptSceneRefs(binding).length === 0
          || bindingScriptSceneRefs(binding).some((ref) => (
            requireWritingPort().resolveScene(ref)?.writingProjectId !== writingProjectId
          ))
        )
      ));
      if (invalidBinding) {
        throw Object.assign(new Error(`节点 ${invalidBinding.nodeId} 的剧本引用已失效，请重新选择场次版本`), { statusCode: 422 });
      }
      res.json(interactiveRepository.beginProductionPreparation(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  };

  app.post('/api/interactive/experiences/:experienceId/production-preparation', beginProductionPreparation);
  // Deprecated compatibility route. It intentionally shares the non-locking implementation.
  app.post('/api/interactive/experiences/:experienceId/content-lock', beginProductionPreparation);

  app.put(
    '/api/interactive/experiences/:experienceId/graph',
    (
      req: Request<
        { experienceId: string },
        unknown,
        {
          graph: Pick<NarrativeGraphVersion, 'entryNodeId' | 'nodes' | 'transitions' | 'semanticContractVersion'>;
          status?: InteractiveVersionStatus;
          expectedVersionIndex?: number;
        }
      >,
      res,
    ) => {
      try {
        if (!req.body?.graph || !Array.isArray(req.body.graph.nodes)) {
          throw Object.assign(new Error('graph.nodes must be an array'), { statusCode: 400 });
        }
        if (req.body.status) requireOneOf(req.body.status, ['draft', 'locked'], 'status');
        if (req.body.expectedVersionIndex != null && (!Number.isInteger(req.body.expectedVersionIndex) || req.body.expectedVersionIndex < 1)) {
          throw Object.assign(new Error('expectedVersionIndex must be a positive integer'), { statusCode: 400 });
        }
        res.json(interactiveRepository.saveGraph(
          req.params.experienceId,
          req.body.graph,
          req.body.status,
          req.body.expectedVersionIndex,
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/graph-layout', (req, res) => {
    try {
      res.json(interactiveRepository.getGraphLayout(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.put(
    '/api/interactive/experiences/:experienceId/graph-layout',
    (
      req: Request<
        { experienceId: string },
        unknown,
        { layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>; expectedVersionIndex?: number }
      >,
      res,
    ) => {
      try {
        if (!req.body?.layout || typeof req.body.layout.nodes !== 'object' || Array.isArray(req.body.layout.nodes)) {
          throw Object.assign(new Error('layout.nodes must be an object'), { statusCode: 400 });
        }
        if (req.body.expectedVersionIndex != null && (!Number.isInteger(req.body.expectedVersionIndex) || req.body.expectedVersionIndex < 1)) {
          throw Object.assign(new Error('expectedVersionIndex must be a positive integer'), { statusCode: 400 });
        }
        res.json(interactiveRepository.saveGraphLayout(
          req.params.experienceId,
          req.body.layout,
          req.body.expectedVersionIndex,
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.put(
    '/api/interactive/experiences/:experienceId/bindings/batch',
    (
      req: Request<{ experienceId: string }, unknown, { bindings?: NodeContentBinding[] }>,
      res,
    ) => {
      try {
        if (!Array.isArray(req.body?.bindings) || req.body.bindings.length === 0) {
          throw Object.assign(new Error('bindings must be a non-empty array'), { statusCode: 400 });
        }
        req.body.bindings.forEach((binding) => (
          assertNodeContentBinding(req.params.experienceId, binding)
        ));
        res.json(interactiveRepository.saveBindings(req.params.experienceId, req.body.bindings));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.put(
    '/api/interactive/experiences/:experienceId/bindings/script',
    (req: Request<{ experienceId: string }, unknown, { bindings?: Array<Pick<NodeContentBinding, 'nodeId' | 'slot' | 'versionIndex' | 'scriptSceneRefs' | 'contentFitReview' | 'reusePolicy' | 'status'>> }>, res) => {
      try {
        if (!Array.isArray(req.body?.bindings) || req.body.bindings.length === 0) {
          throw Object.assign(new Error('bindings must be a non-empty array'), { statusCode: 400 });
        }
        req.body.bindings.forEach((binding) => assertNodeContentBinding(req.params.experienceId, binding as NodeContentBinding));
        res.json(interactiveRepository.saveScriptBindings(req.params.experienceId, req.body.bindings));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.put(
    '/api/interactive/experiences/:experienceId/bindings',
    (req: Request<{ experienceId: string }, unknown, NodeContentBinding>, res) => {
      try {
        assertNodeContentBinding(req.params.experienceId, req.body);
        res.json(interactiveRepository.saveBinding(req.params.experienceId, req.body));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get(
    '/api/interactive/experiences/:experienceId/bindings/history',
    (req: Request<{ experienceId: string }, unknown, unknown, { nodeId?: string; slot?: string }>, res) => {
      try {
        requireText(req.query.nodeId, 'nodeId');
        requireOneOf(req.query.slot, ['entry', 'main', 'choice_hold', 'exit'], 'slot');
        res.json(interactiveRepository.listBindingVersions(
          req.params.experienceId,
          req.query.nodeId!,
          req.query.slot as NodeContentBinding['slot'],
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  const requireGraphDraftGenerator = () => {
    if (!graphDraftGenerator) {
      throw Object.assign(new Error('互动 AI 服务尚未配置；请先在系统设置中配置可用文本模型。'), { statusCode: 503 });
    }
    return graphDraftGenerator;
  };

  const contentPlanningService = () =>
    new InteractiveContentPlanningService(requireGraphDraftGenerator());

  const generateContentPlan = async (
    experienceId: string,
    authorIntent: string,
    activeTaskId?: string,
  ) => {
    const aggregate = interactiveRepository.getExperience(experienceId);
    const writingProjectId = aggregate.experience.storySource.writingProjectId;
    if (aggregate.experience.storySource.mode !== 'bind_writing' || !writingProjectId) {
      throw Object.assign(new Error('AI 需要先建立统一剧本项目，才能编排节点内容'), { statusCode: 409 });
    }
    const scenes = requireWritingPort().listScenes(writingProjectId);
    const inputFingerprint = interactiveContentPlanAttemptFingerprint({
      graphVersionId: aggregate.graph.id,
      writingProjectRevision: scenes[0]?.writingProjectRevision || 0,
      authorIntent,
    });
    const idempotencyKey = `content_plan:${inputFingerprint}`;
    const coordination = interactiveRepository.recoverInterruptedTasks(experienceId);
    const existing = coordination.taskRefs.find((task) => task.idempotencyKey === idempotencyKey);
    if (!activeTaskId && existing && ['working', 'review', 'completed'].includes(existing.status || 'working')) {
      if (existing.status === 'review' || existing.status === 'completed') {
        return interactiveRepository.getContentPlanDraft(experienceId, existing.taskId);
      }
      throw Object.assign(new Error('AI 正在安排节点内容，请稍后查看'), { statusCode: 409 });
    }
    const taskId = activeTaskId || `content-plan-pending-${randomUUID()}`;
    if (!activeTaskId) {
      recordTaskRef({
        experienceId,
        owner: 'content_plan',
        taskId,
        purpose: '安排整张白板的剧本内容',
        inputFingerprint,
        dependsOnOwners: ['interactive_graph', 'writing'],
        status: 'working',
        retryContext: { kind: 'content_plan', authorIntent },
      });
    }
    let draft;
    try {
      draft = await contentPlanningService().generateDraft({
        aggregate,
        scenes,
        authorIntent,
      });
    } catch (error) {
      interactiveRepository.updateTaskRef(experienceId, taskId, 'failed', {
        error: error instanceof Error ? error.message : '节点内容安排失败',
      });
      throw error;
    }
    const currentTask = interactiveRepository.getTaskCoordination(experienceId).taskRefs
      .find((task) => task.taskId === taskId);
    if (!currentTask || (currentTask.status || 'working') !== 'working') {
      throw Object.assign(new Error('这次节点内容安排已取消'), { statusCode: 409 });
    }
    const changedNodeIds = new Set(draft.items.flatMap((item) => {
      const nextRefs = item.slots.find((slot) => slot.slot === 'main')?.orderedSceneRefs || [];
      const current = aggregate.bindings.find((binding) => (
        binding.nodeId === item.nodeId && binding.slot === 'main'
      ));
      return item.mode === 'create_or_revise' || !artifactRefListEquals(bindingScriptSceneRefs(current), nextRefs)
        ? [item.nodeId]
        : [];
    }));
    const productionTarget = productionPrepPort?.getTarget(experienceId);
    draft.impact.staleProductionSceneIds = productionTarget?.nodeTargets
      ?.filter((target) => changedNodeIds.has(target.nodeId))
      .flatMap((target) => target.productionSceneIds) || [];
    const saved = interactiveRepository.saveContentPlanDraft(draft);
    interactiveRepository.updateTaskRef(experienceId, taskId, 'review', {
      replacementTaskId: saved.id,
    });
    return saved;
  };

  const maybeGenerateContentPlan = async (experienceId: string) => {
    const coordination = interactiveRepository.getTaskCoordination(experienceId);
    if (coordination.paused || coordination.executionPolicy !== 'autopilot') return null;
    const aggregate = interactiveRepository.getExperience(experienceId);
    if (!aggregate.graph.nodes.length) return null;
    const writingProjectId = aggregate.experience.storySource.writingProjectId;
    if (!writingProjectId || requireWritingPort().getGenerationStatus(writingProjectId).state !== 'ready') return null;
    const latest = interactiveRepository.getLatestContentPlanDraft(experienceId);
    const scenes = requireWritingPort().listScenes(writingProjectId);
    if (
      latest?.status === 'candidate'
      && latest.baseGraphVersionId === aggregate.graph.id
      && contentPlanMatchesWritingSource(latest, scenes)
    ) {
      return latest;
    }
    const confirmedAuthorIntent = confirmedAuthorIntentFor(experienceId);
    if (!confirmedAuthorIntent) return null;
    const defaultContentIntent = [
      '请为整张白板自动安排统一剧本内容。优先安全复用；缺失时提出补写，不制造假引用。',
      `作者已确认的创作意图：${confirmedAuthorIntent}`,
    ].join('\n');
    const continuationIntent = latest && latest.status !== 'rejected'
      ? latest.authorIntent || defaultContentIntent
      : defaultContentIntent;
    if (latest?.status === 'candidate') {
      interactiveRepository.updateContentPlanStatus(experienceId, latest.id, 'stale');
      settleCandidateTask(experienceId, latest.id, 'stale');
    }
    return generateContentPlan(experienceId, continuationIntent);
  };

  const continueContentPlanning = async (experienceId: string) => {
    try {
      return await maybeGenerateContentPlan(experienceId);
    } catch (error) {
      // Content planning owns its own persisted task status. A downstream
      // planning failure must never rewrite a completed Writing task as failed.
      if (Number((error as { statusCode?: number })?.statusCode) !== 409) {
        console.error('[Interactive Content] Automatic planning after Writing failed', error);
      }
      return null;
    }
  };

  app.post(
    '/api/interactive/experiences/:experienceId/tasks/:taskId/cancel',
    (req: Request<{ experienceId: string; taskId: string }>, res) => {
      try {
        res.json(interactiveRepository.updateTaskRef(
          req.params.experienceId,
          req.params.taskId,
          'cancelled',
        ));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/tasks/:taskId/retry',
    async (req: Request<{ experienceId: string; taskId: string }>, res) => {
      const { experienceId, taskId } = req.params;
      const current = interactiveRepository.getTaskCoordination(experienceId);
      const task = current.taskRefs.find((item) => item.taskId === taskId);
      if (!task) return fail(res, Object.assign(new Error('互动创作任务不存在'), { statusCode: 404 }));
      const retryTaskId = `${task.owner}-retry-${Date.now()}`;
      try {
        interactiveRepository.retryTaskRef(experienceId, taskId, retryTaskId);
        if (task.owner === 'writing') throw Object.assign(new Error('请在剧本工作区编辑，再绑定已保存场景；旧自动编剧任务已退役。'), {statusCode:410});
        if (task.owner === 'interactive_graph') {
          const aggregate = interactiveRepository.getExperience(experienceId);
          let retryContext = task.retryContext?.kind === 'interactive_graph'
            ? task.retryContext
            : undefined;
          if (!retryContext) {
            try {
              const previous = interactiveRepository.getGraphDraft(experienceId, taskId);
              retryContext = {
                kind: 'interactive_graph',
                action: aggregate.graph.nodes.length ? 'revise' : 'initial',
                authorIntent: previous.authorIntent,
              };
            } catch {
              throw Object.assign(
                new Error('这条旧故事任务没有保存重试上下文，请在白板重新提交一次意见'),
                { statusCode: 409 },
              );
            }
          }
          const draft = await new InteractiveGraphAuthoringService(
            requireGraphDraftGenerator(),
            writingPort,
          ).generateDraft({
            action: retryContext.action,
            experienceId,
            baseGraph: aggregate.graph,
            authorIntent: retryContext.authorIntent,
            revisionOfDraft: retryContext.revisionOfDraftId
              ? interactiveRepository.getGraphDraft(experienceId, retryContext.revisionOfDraftId)
              : undefined,
            selectedNodeId: retryContext.scopeNodeId,
            strategy: retryContext.strategy,
            issueIds: retryContext.issueIds,
            spec: aggregate.experienceSpec.data,
            architecture: aggregate.storyArchitecture.data,
            stateSchema: aggregate.stateSchema.data,
            productionBoundary: aggregate.experience.productionBoundary,
            writingProjectId: aggregate.experience.storySource.writingProjectId,
            format: aggregate.experience.formatProfile.format,
            formatProfile: aggregate.experience.formatProfile,
          });
          const currentTask = interactiveRepository.getTaskCoordination(experienceId).taskRefs
            .find((item) => item.taskId === retryTaskId);
          if (!currentTask || currentTask.status !== 'working') {
            throw Object.assign(new Error('这次故事方案重试已取消'), { statusCode: 409 });
          }
          const saved = interactiveRepository.saveGraphDraft(draft);
          return res.json(interactiveRepository.updateTaskRef(
            experienceId,
            retryTaskId,
            'review',
            { replacementTaskId: saved.id },
          ));
        }
        if (task.owner === 'content_plan') {
          let authorIntent = task.retryContext?.kind === 'content_plan'
            ? task.retryContext.authorIntent
            : '';
          if (!authorIntent) {
            try {
              authorIntent = interactiveRepository.getContentPlanDraft(experienceId, taskId).authorIntent;
            } catch {
              // Historical tasks did not persist their retry input.
            }
          }
          await generateContentPlan(
            experienceId,
            authorIntent || '请为整张白板自动安排统一剧本内容。优先安全复用；缺失时提出补写，不制造假引用。',
            retryTaskId,
          );
          return res.json(interactiveRepository.getTaskCoordination(experienceId));
        }
        if (task.owner === 'production') {
          const retryContext = task.retryContext;
          const plan = retryContext?.kind === 'media_revision'
            ? requireProductionPrepPort().requestMediaRevision(
                experienceId,
                retryContext.planId,
                retryContext.nodeId,
                retryContext.feedback,
                retryContext.scenarioId,
              )
            : retryContext?.kind === 'media_plan' || (!retryContext && task.purpose.includes('视频'))
              ? requireProductionPrepPort().createMediaPlan(experienceId)
              : requireProductionPrepPort().createPlan(experienceId);
          return res.json(interactiveRepository.updateTaskRef(
            experienceId,
            retryTaskId,
            'review',
            { replacementTaskId: plan.id },
          ));
        }
        const build = task.retryContext?.kind === 'runtime' && task.retryContext.buildKind === 'structure'
          ? interactiveRepository.createStructurePreviewBuild(experienceId)
          : interactiveRepository.createRuntimeBuild(experienceId);
        return res.json(interactiveRepository.updateTaskRef(
          experienceId,
          retryTaskId,
          'completed',
          { replacementTaskId: build.id },
        ));
      } catch (error) {
        try {
          interactiveRepository.updateTaskRef(experienceId, retryTaskId, 'failed', {
            error: error instanceof Error ? error.message : '任务重试失败',
          });
        } catch {
          // The original error is more useful than a secondary coordination write.
        }
        return fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/authoring-status', (req, res) => {
    try {
      const aggregate = interactiveRepository.getExperience(req.params.experienceId);
      const coordination = interactiveRepository.recoverInterruptedTasks(req.params.experienceId);
      const latestContentPlan = interactiveRepository.getLatestContentPlanDraft(req.params.experienceId);
      res.json(projectInteractiveAuthoringStatus({
        aggregate,
        coordination: interactiveRepository.getTaskCoordination(req.params.experienceId),
        latestContentPlan,
        writingPort: requireWritingPort(),
      }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.put(
    '/api/interactive/experiences/:experienceId/execution-policy',
    (req: Request<{ experienceId: string }, unknown, { executionPolicy?: InteractiveExecutionPolicy }>, res) => {
      try {
        requireOneOf(req.body.executionPolicy, ['autopilot', 'guided'], 'executionPolicy');
        const coordination = interactiveRepository.saveTaskCoordination(req.params.experienceId, {
          executionPolicy: req.body.executionPolicy,
          paused: false,
        });
        if (coordination.executionPolicy === 'autopilot') {
          const latestContentPlan = interactiveRepository.getLatestContentPlanDraft(req.params.experienceId);
          if (latestContentPlan?.status === 'candidate') {
          }
        }
        res.json(interactiveRepository.getTaskCoordination(req.params.experienceId));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.put(
    '/api/interactive/experiences/:experienceId/authoring-pause',
    async (req: Request<{ experienceId: string }, unknown, { paused?: boolean }>, res) => {
      try {
        if (typeof req.body.paused !== 'boolean') {
          throw Object.assign(new Error('paused must be a boolean'), { statusCode: 400 });
        }
        const coordination = interactiveRepository.saveTaskCoordination(req.params.experienceId, {
          paused: req.body.paused,
        });
        if (!coordination.paused) await maybeGenerateContentPlan(req.params.experienceId);
        const aggregate = interactiveRepository.getExperience(req.params.experienceId);
        res.json(projectInteractiveAuthoringStatus({
          aggregate,
          coordination: interactiveRepository.getTaskCoordination(req.params.experienceId),
          latestContentPlan: interactiveRepository.getLatestContentPlanDraft(req.params.experienceId),
          writingPort: requireWritingPort(),
        }));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/proposal-bundles/adopt-compatible',
    (
      req: Request<{ experienceId: string }, unknown, { idempotencyKey?: string }>,
      res,
    ) => {
      try {
        requireText(req.body.idempotencyKey, 'idempotencyKey');
        const experienceId = req.params.experienceId;
        const idempotencyKey = req.body.idempotencyKey!.trim();
        const coordination = interactiveRepository.getTaskCoordination(experienceId);
        const previous = coordination.adoptionRuns.find((run) => run.idempotencyKey === idempotencyKey);
        if (previous?.status === 'complete') return res.json(previous);

        const candidateRefs = previous?.candidateRefs || [
          interactiveRepository.getLatestGraphDraft(experienceId),
          interactiveRepository.getLatestContentPlanDraft(experienceId),
          requireProductionPrepPort().getLatestPlan(experienceId),
          requireProductionPrepPort().getLatestMediaPlan(experienceId),
        ].flatMap((candidate, index) => (
          candidate?.status === 'candidate'
            ? [{
              kind: proposalAdoptionOrder[index],
              candidateId: candidate.id,
            }]
            : []
        ));
        let run = previous || createProposalAdoptionRun(idempotencyKey, candidateRefs);
        const saveRun = (status: InteractiveProposalAdoptionRun['status']) => {
          run = { ...run, status, updatedAt: new Date().toISOString() };
          const current = interactiveRepository.getTaskCoordination(experienceId);
          interactiveRepository.saveTaskCoordination(experienceId, {
            adoptionRuns: [
              ...current.adoptionRuns.filter((item) => item.idempotencyKey !== idempotencyKey),
              run,
            ].slice(-20),
          });
          return run;
        };
        saveRun('working');

        const adoptCandidate = (
          kind: InteractiveProposalKind,
          candidateId: string,
        ): InteractiveProposalAdoptionResult => {
          if (kind === 'interactive_graph') {
            const draft = interactiveRepository.getGraphDraft(experienceId, candidateId);
            if (draft.status === 'adopted') {
              settleCandidateTask(experienceId, candidateId, 'completed');
              return { kind, candidateId, status: 'adopted', message: '故事方案已经采用' };
            }
            if (draft.status !== 'candidate') {
              return { kind, candidateId, status: 'skipped', message: '故事方案已不再可采用' };
            }
            const aggregate = interactiveRepository.getExperience(experienceId);
            const adopted = adoptGraphDraft(aggregate.graph, draft);
            if (!adopted.success || !adopted.newGraph) {
              throw Object.assign(new Error(adopted.reason || '故事方案与当前白板不兼容'), { statusCode: 409 });
            }
            interactiveRepository.adoptGraphDraftArtifacts(
              experienceId,
              adopted.newGraph,
              draft.proposedStateSchema,
              draft.proposedStoryArchitecture,
            );
            draft.status = 'adopted';
            if (!draft.audit.events.some((event) => event.type === 'adopted')) {
              draft.audit.events.push({ type: 'adopted', at: new Date().toISOString() });
            }
            interactiveRepository.saveGraphDraft(draft);
            settleCandidateTask(experienceId, candidateId, 'completed');
            return { kind, candidateId, status: 'adopted', message: '故事方案已采用' };
          }
          if (kind === 'content_plan') {
            const draft = interactiveRepository.getContentPlanDraft(experienceId, candidateId);
            if (draft.status === 'adopted') {
              settleCandidateTask(experienceId, candidateId, 'completed');
              return { kind, candidateId, status: 'adopted', message: '节点内容方案已经采用' };
            }
            if (draft.status !== 'candidate') {
              return { kind, candidateId, status: 'skipped', message: '节点内容方案已不再可采用' };
            }
            const aggregate = interactiveRepository.getExperience(experienceId);
            const writingProjectId = aggregate.experience.storySource.writingProjectId;
            const scenes = writingProjectId ? requireWritingPort().listScenes(writingProjectId) : [];
            draft.qa = validateInteractiveContentPlan({ draft, graph: aggregate.graph, scenes });
            if (!contentPlanAdoptable(draft)) {
              throw Object.assign(new Error(draft.qa.blocking[0] || '节点内容方案仍需补写'), { statusCode: 422 });
            }
            if (!contentPlanMatchesWritingSource(draft, scenes)) {
              interactiveRepository.updateContentPlanStatus(experienceId, candidateId, 'stale');
              settleCandidateTask(experienceId, candidateId, 'stale');
              throw Object.assign(new Error('统一剧本已经变化'), { statusCode: 409 });
            }
            interactiveRepository.adoptContentPlan(
              experienceId,
              candidateId,
              bindingsForContentPlanAdoption(draft, aggregate),
            );
            settleCandidateTask(experienceId, candidateId, 'completed');
            return { kind, candidateId, status: 'adopted', message: '节点内容方案已采用' };
          }
          if (kind === 'production_plan') {
            requireProductionPrepPort().adoptPlan(experienceId, candidateId);
            settleCandidateTask(experienceId, candidateId, 'completed');
            return { kind, candidateId, status: 'adopted', message: '制片方案已采用' };
          }
          requireProductionPrepPort().adoptMediaPlan(experienceId, candidateId);
          settleCandidateTask(experienceId, candidateId, 'completed');
          return { kind, candidateId, status: 'adopted', message: '视频方案已采用' };
        };

        for (const ref of pendingProposalAdoptions(run)) {
          try {
            const result = adoptCandidate(ref.kind, ref.candidateId);
            run = recordProposalAdoptionResult(run, result);
          } catch (error) {
            run = recordProposalAdoptionResult(run, {
                kind: ref.kind,
                candidateId: ref.candidateId,
                status: 'failed',
                message: error instanceof Error ? error.message : '当前方案无法采用',
            });
          }
          saveRun('working');
        }
        run = finishProposalAdoptionRun(run);
        saveRun(run.status);
        return res.status(previous ? 200 : 201).json(run);
      } catch (error) {
        return fail(res, error);
      }
    },
  );

  app.get('/api/interactive/experiences/:experienceId/content-plans/latest', (req, res) => {
    try {
      res.json(interactiveRepository.getLatestContentPlanDraft(req.params.experienceId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get(
    '/api/interactive/experiences/:experienceId/content-plans/:draftId',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        res.json(interactiveRepository.getContentPlanDraft(req.params.experienceId, req.params.draftId));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/content-plans',
    async (req: Request<{ experienceId: string }, unknown, { authorIntent?: string }>, res) => {
      try {
        const authorIntent = req.body.authorIntent?.trim()
          || '请检查整张白板，为每个节点安排最合适的剧本内容；优先安全复用，不合适时提出补写请求。';
        res.status(201).json(await generateContentPlan(req.params.experienceId, authorIntent));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/content-plans/:draftId/revise',
    async (req: Request<{ experienceId: string; draftId: string }, unknown, { feedback?: string }>, res) => {
      try {
        requireText(req.body.feedback, 'feedback');
        const previous = interactiveRepository.getContentPlanDraft(req.params.experienceId, req.params.draftId);
        const revised = await generateContentPlan(
          req.params.experienceId,
          `${previous.authorIntent}\n作者对上一版的意见：${req.body.feedback!.trim()}`,
        );
        interactiveRepository.updateContentPlanStatus(req.params.experienceId, req.params.draftId, 'rejected');
        settleCandidateTask(req.params.experienceId, req.params.draftId, 'cancelled');
        res.status(201).json(revised);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/content-plans/:draftId/reject',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        const draft = interactiveRepository.getContentPlanDraft(req.params.experienceId, req.params.draftId);
        if (draft.status === 'adopted') {
          throw Object.assign(new Error('已经采用的内容方案不能再放弃'), { statusCode: 409 });
        }
        const rejected = interactiveRepository.updateContentPlanStatus(
          req.params.experienceId,
          req.params.draftId,
          'rejected',
        );
        settleCandidateTask(req.params.experienceId, req.params.draftId, 'cancelled');
        res.json(rejected);
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/content-plans/:draftId/adopt',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        const { experienceId, draftId } = req.params;
        const aggregate = interactiveRepository.getExperience(experienceId);
        const draft = interactiveRepository.getContentPlanDraft(experienceId, draftId);
        const writingProjectId = aggregate.experience.storySource.writingProjectId;
        const scenes = writingProjectId ? requireWritingPort().listScenes(writingProjectId) : [];
        draft.qa = validateInteractiveContentPlan({ draft, graph: aggregate.graph, scenes });
        if (!contentPlanAdoptable(draft)) {
          throw Object.assign(
            new Error(draft.qa.blocking[0] || '这份方案仍需要 AI 补写剧本，暂时不能采用'),
            { statusCode: 422 },
          );
        }
        if (!contentPlanMatchesWritingSource(draft, scenes)) {
          interactiveRepository.updateContentPlanStatus(experienceId, draftId, 'stale');
          settleCandidateTask(experienceId, draftId, 'stale');
          throw Object.assign(new Error('统一剧本已经变化，请让 AI 重新编排节点内容'), { statusCode: 409 });
        }
        const bindings = bindingsForContentPlanAdoption(draft, aggregate);
        const adoption = interactiveRepository.adoptContentPlan(experienceId, draftId, bindings);
        settleCandidateTask(experienceId, draftId, 'completed');
        let productionPlan: import('../../types/project').InteractiveProductionPlanDraft | undefined;
        const coordination = interactiveRepository.getTaskCoordination(experienceId);
        if (!coordination.paused && coordination.executionPolicy === 'autopilot') {
          try {
            productionPlan = requireProductionPrepPort().createPlan(experienceId);
            recordTaskRef({
              experienceId,
              owner: 'production',
              taskId: productionPlan.id,
              purpose: '准备完整制片场次方案',
              inputFingerprint: `${productionPlan.sourceHash}:${productionPlan.sourceWritingRevision}`,
              dependsOnOwners: ['content_plan', 'writing'],
              retryContext: { kind: 'production_plan' },
            });
          } catch (error) {
            console.error('[Interactive Production] Automatic no-cost planning failed', error);
          }
        }
        res.json({ ...adoption, productionPlan });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.post(
    '/api/interactive/experiences/:experienceId/graph-drafts',
    async (req: Request<{ experienceId: string }, unknown, {
      action: 'initial' | 'blueprint' | 'golden_path' | 'extend' | 'strategy' | 'repair' | 'revise';
      authorIntent: string;
      expectedGraphVersionIndex?: number;
      scopeNodeId?: string;
      strategy?: 'foldback' | 'parallel' | 'failure';
      issueIds?: string[];
      revisionOfDraftId?: string;
    }>, res) => {
      try {
        const { experienceId } = req.params;
        const { action, authorIntent, expectedGraphVersionIndex, scopeNodeId, strategy, issueIds, revisionOfDraftId } = req.body;
        requireText(authorIntent, 'authorIntent');
        requireOneOf(action, ['initial', 'blueprint', 'golden_path', 'extend', 'strategy', 'repair', 'revise'], 'action');

        const aggregate = interactiveRepository.getExperience(experienceId);
        if (expectedGraphVersionIndex !== undefined) {
          if (!Number.isInteger(expectedGraphVersionIndex) || expectedGraphVersionIndex < 1) {
            throw Object.assign(new Error('expectedGraphVersionIndex must be a positive integer'), { statusCode: 400 });
          }
          if (expectedGraphVersionIndex !== aggregate.graph.versionIndex) {
            throw Object.assign(new Error('白板图谱已更新，请先刷新后再让 AI 生成方案。'), { statusCode: 409 });
          }
        }
        if (revisionOfDraftId !== undefined) requireText(revisionOfDraftId, 'revisionOfDraftId');
        const revisionOfDraft = revisionOfDraftId
          ? interactiveRepository.getGraphDraft(experienceId, revisionOfDraftId)
          : undefined;
        if (revisionOfDraft && (
          revisionOfDraft.status !== 'candidate'
          || revisionOfDraft.baseGraphVersionId !== aggregate.graph.id
          || revisionOfDraft.baseGraphVersionIndex !== aggregate.graph.versionIndex
        )) {
          throw Object.assign(new Error('原候选已过期，请根据当前白板重新提交修改意见。'), { statusCode: 409 });
        }
        if ((action === 'extend' || action === 'strategy') && !scopeNodeId) {
          throw Object.assign(new Error(`scopeNodeId is required for ${action} action`), { statusCode: 400 });
        }
        if (action === 'repair' && (!issueIds || issueIds.length === 0)) {
          throw Object.assign(new Error('repair action requires at least one Graph QA issue'), { statusCode: 400 });
        }
        const inputFingerprint = interactiveGraphAttemptFingerprint({
          graphVersionId: aggregate.graph.id,
          action,
          authorIntent,
          scopeNodeId,
          strategy,
          issueIds,
          revisionOfDraftId,
        });
        const idempotencyKey = `interactive_graph:${inputFingerprint}`;
        const existing = interactiveRepository.recoverInterruptedTasks(experienceId).taskRefs
          .find((task) => task.idempotencyKey === idempotencyKey);
        if (existing && ['working', 'review', 'completed'].includes(existing.status || 'working')) {
          if (existing.status === 'review' || existing.status === 'completed') {
            return res.json(interactiveRepository.getGraphDraft(experienceId, existing.taskId));
          }
          throw Object.assign(new Error('AI 正在准备故事方案，请稍后查看'), { statusCode: 409 });
        }
        const taskId = `interactive-graph-pending-${randomUUID()}`;
        recordTaskRef({
          experienceId,
          owner: 'interactive_graph',
          taskId,
          purpose: '准备可审阅的互动故事方案',
          inputFingerprint,
          status: 'working',
          retryContext: {
            kind: 'interactive_graph',
            action,
            authorIntent: authorIntent.trim(),
            scopeNodeId,
            strategy,
            issueIds,
            revisionOfDraftId,
          },
        });
        const authoringService = new InteractiveGraphAuthoringService(requireGraphDraftGenerator(), writingPort);
        let draft;
        try {
          draft = await authoringService.generateDraft({
            action,
            experienceId,
            baseGraph: aggregate.graph,
            authorIntent,
            revisionOfDraft,
            selectedNodeId: scopeNodeId,
            strategy,
            issueIds,
            spec: aggregate.experienceSpec.data,
            architecture: aggregate.storyArchitecture.data,
            stateSchema: aggregate.stateSchema.data,
            productionBoundary: aggregate.experience.productionBoundary,
            writingProjectId: aggregate.experience.storySource.writingProjectId,
            formatProfile: aggregate.experience.formatProfile,
          });
        } catch (error) {
          interactiveRepository.updateTaskRef(experienceId, taskId, 'failed', {
            error: error instanceof Error ? error.message : '故事方案准备失败',
          });
          throw error;
        }
        const currentTask = interactiveRepository.getTaskCoordination(experienceId).taskRefs
          .find((task) => task.taskId === taskId);
        if (!currentTask || (currentTask.status || 'working') !== 'working') {
          throw Object.assign(new Error('这次故事方案生成已取消'), { statusCode: 409 });
        }

        const saved = interactiveRepository.saveGraphDraft(draft);
        interactiveRepository.updateTaskRef(experienceId, taskId, 'review', {
          replacementTaskId: saved.id,
        });
        res.json(saved);
      } catch (error) {
        fail(res, error);
      }
    }
  );

  app.get(
    '/api/interactive/experiences/:experienceId/graph-drafts/latest',
    (req: Request<{ experienceId: string }>, res) => {
      try {
        res.json(interactiveRepository.getLatestGraphDraft(req.params.experienceId));
      } catch (error) {
        fail(res, error);
      }
    },
  );

  app.get(
    '/api/interactive/experiences/:experienceId/graph-drafts/:draftId',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        res.json(interactiveRepository.getGraphDraft(req.params.experienceId, req.params.draftId));
      } catch (error) {
        fail(res, error);
      }
    }
  );

  app.post(
    '/api/interactive/experiences/:experienceId/graph-drafts/:draftId/adopt',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        const { experienceId, draftId } = req.params;
        const draft = interactiveRepository.getGraphDraft(experienceId, draftId);

        const aggregate = interactiveRepository.getExperience(experienceId);
        const result = adoptGraphDraft(aggregate.graph, draft);

        if (!result.success || !result.newGraph) {
          return res.status(409).json({
            success: false,
            draft,
            reason: result.reason,
          });
        }

        const savedGraph = interactiveRepository.adoptGraphDraftArtifacts(
          experienceId,
          result.newGraph,
          draft.proposedStateSchema,
          draft.proposedStoryArchitecture,
        );
        draft.audit.events.push({ type: 'adopted', at: new Date().toISOString() });
        interactiveRepository.saveGraphDraft(draft);
        settleCandidateTask(experienceId, draftId, 'completed');

        res.json({
          success: true,
          draft,
          newGraph: savedGraph.graph,
          stateSchema: savedGraph.stateSchema.data,
          storyArchitecture: savedGraph.storyArchitecture.data,
        });
        void trackManualAIWork(maybeGenerateContentPlan(experienceId)).catch((error) => {
          console.error('[Interactive Content] Automatic planning after graph adoption failed', error);
        });
      } catch (error) {
        fail(res, error);
      }
    }
  );

  app.post(
    '/api/interactive/experiences/:experienceId/graph-drafts/:draftId/reject',
    (req: Request<{ experienceId: string; draftId: string }>, res) => {
      try {
        const draft = interactiveRepository.getGraphDraft(req.params.experienceId, req.params.draftId);
        const updated = rejectGraphDraft(draft);
        updated.audit.events.push({ type: 'rejected', at: new Date().toISOString() });
        const saved = interactiveRepository.saveGraphDraft(updated);
        settleCandidateTask(req.params.experienceId, req.params.draftId, 'cancelled');
        res.json(saved);
      } catch (error) {
        fail(res, error);
      }
    }
  );

  app.delete('/api/interactive/experiences/:experienceId', (req, res) => {
    try {
      interactiveRepository.deleteExperience(req.params.experienceId);
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  });
};
