import { aiAwareFetch } from "./manualAIClient";
import type {
  CreateInteractiveExperienceInput,
  DurationBudget,
  ExperienceSpec,
  InteractiveExperience,
  InteractiveExperienceAggregate,
  InteractivePlaytestCheckpoint,
  InteractiveRuntimeBuild,
  InteractiveVersionStatus,
  GraphLayoutRevision,
  InteractionFormatProfile,
  InteractiveChoice,
  NarrativeGraphVersion,
  NarrativeNode,
  NodeCapability,
  NodeContentBinding,
  NodeContentBindingVersion,
  StateSchema,
  StoryArchitecture,
  StorySourceBinding,
  VersionedInteractiveArtifact,
} from "../../../../src/domains/interactive/types/schema";
import { normalizeNarrativeGraph } from "../../../../src/domains/interactive/types/schema";
import type {
  InteractiveWritingGenerationStatus,
  InteractiveWritingProjectOption,
  InteractiveRuntimeStoryManifest,
  InteractiveWritingSceneOption,
} from "../../../../src/domains/interactive/ports/writingPort";
import type {
  InteractiveContentPlanDraft,
  InteractiveContentWritingRequest,
} from "../../../../src/domains/interactive/contentPlanning/contentPlan";
import type {
  InteractiveProposalAdoptionRun,
  InteractiveTaskCoordination,
} from "../../../../src/domains/interactive/authoring/taskCoordination";
import type { InteractiveAuthoringStatusProjection } from "../../../../src/services/interactive/interactiveAuthoringStatusProjection";
import type {
  InteractiveProductionMediaTakeOption,
  InteractiveProductionPrepTarget,
  InteractiveRuntimeMediaManifest,
} from "../../../../src/domains/interactive/ports/productionPrepPort";
import type { InteractiveVisualContextProjection } from "../../../../src/domains/interactive/projection/interactiveVisualContextProjection";
import type {
  InteractiveMediaPlanDraft,
  InteractiveProductionPlanDraft,
  InteractiveVisualRefinementDraft,
} from "../../../../src/types/project";

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Interactive API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

const pathFor = (experienceId?: string, suffix = '') =>
  experienceId
    ? `/api/interactive/experiences/${encodeURIComponent(experienceId)}${suffix}`
    : '/api/interactive/experiences';

const writeJson = <T>(url: string, method: 'POST' | 'PUT', body: unknown) =>
  aiAwareFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => parseResponse<T>(response));

export const interactiveClient = {
  listExperiences: () =>
    aiAwareFetch(pathFor()).then((response) => parseResponse<InteractiveExperience[]>(response)),

  createExperience: (input: CreateInteractiveExperienceInput) =>
    writeJson<InteractiveExperienceAggregate>(pathFor(), 'POST', input),

  getExperience: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId)).then((response) => parseResponse<InteractiveExperienceAggregate>(response)),

  getWhiteboardExperience: (experienceId: string) =>
    aiAwareFetch(`${pathFor(experienceId)}?view=whiteboard`)
      .then((response) => parseResponse<InteractiveExperienceAggregate>(response))
      .then((aggregate) => ({
        ...aggregate,
        graph: normalizeNarrativeGraph(aggregate.graph),
      })),

  listStoryArchitectureHistory: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/story-architecture/history'))
      .then((response) => parseResponse<Array<VersionedInteractiveArtifact<StoryArchitecture>>>(response)),

  saveStoryArchitecture: (
    experienceId: string,
    architecture: StoryArchitecture,
    status: InteractiveVersionStatus = 'draft',
  ) => writeJson<InteractiveExperienceAggregate>(
    pathFor(experienceId, '/story-architecture'),
    'PUT',
    { architecture, status },
  ),

  getLatestRuntimeBuild: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/runtime-build')).then((response) => parseResponse<InteractiveRuntimeBuild | null>(response)),

  createRuntimeBuild: (experienceId: string) =>
    writeJson<InteractiveRuntimeBuild>(pathFor(experienceId, '/runtime-build'), 'POST', {}),

  createStructurePreviewBuild: (experienceId: string) =>
    writeJson<InteractiveRuntimeBuild>(pathFor(experienceId, '/structure-preview-build'), 'POST', {}),

  getRuntimeMediaManifest: (experienceId: string, runtimeBuildId: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/runtime-media')}?runtimeBuildId=${encodeURIComponent(runtimeBuildId)}`)
      .then((response) => parseResponse<InteractiveRuntimeMediaManifest>(response)),

  getRuntimeStoryManifest: (experienceId: string, runtimeBuildId: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/runtime-story')}?runtimeBuildId=${encodeURIComponent(runtimeBuildId)}`)
      .then((response) => parseResponse<InteractiveRuntimeStoryManifest>(response)),

  getPlaytestCheckpoint: (experienceId: string, runtimeBuildId?: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/playtest-checkpoint')}${runtimeBuildId ? `?runtimeBuildId=${encodeURIComponent(runtimeBuildId)}` : ''}`)
      .then((response) => parseResponse<InteractivePlaytestCheckpoint | null>(response)),

  savePlaytestCheckpoint: (experienceId: string, checkpoint: Pick<InteractivePlaytestCheckpoint, 'runtimeBuildId' | 'currentNodeId' | 'state'>) =>
    writeJson<InteractivePlaytestCheckpoint>(pathFor(experienceId, '/playtest-checkpoint'), 'PUT', checkpoint),

  listWritingProjects: () =>
    aiAwareFetch('/api/interactive/writing-projects').then((response) => parseResponse<InteractiveWritingProjectOption[]>(response)),

  saveStorySource: (experienceId: string, storySource: StorySourceBinding) =>
    writeJson<InteractiveExperienceAggregate>(pathFor(experienceId, '/story-source'), 'PUT', storySource),

  listWritingScenes: (experienceId: string, nodeId?: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/writing-scenes')}${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`)
      .then((response) => parseResponse<InteractiveWritingSceneOption[]>(response)),

  listWritingSceneSummaries: (experienceId: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/writing-scenes')}?view=summary`)
      .then((response) => parseResponse<InteractiveWritingSceneOption[]>(response)),

  getWritingGenerationStatus: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/writing-status'))
      .then((response) => parseResponse<InteractiveWritingGenerationStatus>(response)),

  getAuthoringStatus: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/authoring-status'))
      .then((response) => parseResponse<InteractiveAuthoringStatusProjection>(response)),

  setExecutionPolicy: (experienceId: string, executionPolicy: 'autopilot' | 'guided') =>
    writeJson<InteractiveTaskCoordination>(
      pathFor(experienceId, '/execution-policy'),
      'PUT',
      { executionPolicy },
    ),

  setAuthoringPaused: (experienceId: string, paused: boolean) =>
    writeJson<InteractiveAuthoringStatusProjection>(
      pathFor(experienceId, '/authoring-pause'),
      'PUT',
      { paused },
    ),

  adoptCompatibleProposals: (experienceId: string, idempotencyKey: string) =>
    writeJson<InteractiveProposalAdoptionRun>(
      pathFor(experienceId, '/proposal-bundles/adopt-compatible'),
      'POST',
      { idempotencyKey },
    ),

  getLatestContentPlan: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/content-plans/latest'))
      .then((response) => parseResponse<InteractiveContentPlanDraft | null>(response)),

  createContentPlan: (experienceId: string, authorIntent?: string) =>
    writeJson<InteractiveContentPlanDraft>(
      pathFor(experienceId, '/content-plans'),
      'POST',
      { authorIntent },
    ),

  reviseContentPlan: (experienceId: string, draftId: string, feedback: string) =>
    writeJson<InteractiveContentPlanDraft>(
      pathFor(experienceId, `/content-plans/${encodeURIComponent(draftId)}/revise`),
      'POST',
      { feedback },
    ),

  rejectContentPlan: (experienceId: string, draftId: string) =>
    writeJson<InteractiveContentPlanDraft>(
      pathFor(experienceId, `/content-plans/${encodeURIComponent(draftId)}/reject`),
      'POST',
      {},
    ),

  adoptContentPlan: (experienceId: string, draftId: string) =>
    writeJson<{
      draft: InteractiveContentPlanDraft;
      aggregate: InteractiveExperienceAggregate;
      productionPlan?: InteractiveProductionPlanDraft;
    }>(
      pathFor(experienceId, `/content-plans/${encodeURIComponent(draftId)}/adopt`),
      'POST',
      {},
    ),

  saveStateSchema: (experienceId: string, stateSchema: StateSchema) =>
    writeJson<InteractiveExperienceAggregate>(
      pathFor(experienceId, '/state-schema'),
      'PUT',
      stateSchema,
    ),

  saveGraph: (
    experienceId: string,
    graph: Pick<NarrativeGraphVersion, 'entryNodeId' | 'nodes' | 'transitions' | 'semanticContractVersion'>,
    status: InteractiveVersionStatus = 'draft',
    expectedVersionIndex?: number,
  ) =>
    writeJson<InteractiveExperienceAggregate>(
      pathFor(experienceId, '/graph'),
      'PUT',
      { graph, status, expectedVersionIndex },
    ),

  getGraphLayout: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/graph-layout')).then((response) => parseResponse<GraphLayoutRevision>(response)),

  saveGraphLayout: (
    experienceId: string,
    layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>,
    expectedVersionIndex?: number,
  ) => writeJson<GraphLayoutRevision>(
    pathFor(experienceId, '/graph-layout'),
    'PUT',
    { layout, expectedVersionIndex },
  ),

  beginProductionPreparation: (experienceId: string) =>
    writeJson<InteractiveExperienceAggregate>(pathFor(experienceId, '/production-preparation'), 'POST', {}),

  // Compatibility for older callers. It no longer locks author editing.
  lockContent: (experienceId: string) =>
    writeJson<InteractiveExperienceAggregate>(pathFor(experienceId, '/production-preparation'), 'POST', {}),

  getProductionPrepTarget: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/production-prep')).then((response) => parseResponse<InteractiveProductionPrepTarget | null>(response)),

  ensureProductionPrepTarget: (experienceId: string) =>
    writeJson<InteractiveProductionPrepTarget>(pathFor(experienceId, '/production-prep'), 'POST', {}),

  getLatestProductionPlan: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/production-plan/latest'))
      .then((response) => parseResponse<InteractiveProductionPlanDraft | null>(response)),

  createProductionPlan: (experienceId: string) =>
    writeJson<InteractiveProductionPlanDraft>(pathFor(experienceId, '/production-plan'), 'POST', {}),

  adoptProductionPlan: (experienceId: string, planId: string) =>
    writeJson<{ plan: InteractiveProductionPlanDraft; target: InteractiveProductionPrepTarget }>(
      pathFor(experienceId, `/production-plan/${encodeURIComponent(planId)}/adopt`),
      'POST',
      {},
    ),

  rejectProductionPlan: (experienceId: string, planId: string) =>
    writeJson<InteractiveProductionPlanDraft>(
      pathFor(experienceId, `/production-plan/${encodeURIComponent(planId)}/reject`),
      'POST',
      {},
    ),

  getLatestVisualRefinement: (
    experienceId: string,
    productionSceneId: string,
    visualScenarioId: string,
  ) => {
    const query = new URLSearchParams({ productionSceneId, visualScenarioId });
    return aiAwareFetch(`${pathFor(experienceId, '/visual-refinement/latest')}?${query}`)
      .then((response) => parseResponse<InteractiveVisualRefinementDraft | null>(response));
  },

  createVisualRefinement: (
    experienceId: string,
    input: {
      productionSceneId: string;
      visualScenarioId: string;
      finalPrompt: string;
      selectedSkillIds?: string[];
      selectedSkillTitles?: string[];
      selectedContextIds?: string[];
    },
  ) => writeJson<InteractiveVisualRefinementDraft>(
    pathFor(experienceId, '/visual-refinement'),
    'POST',
    input,
  ),

  adoptVisualRefinement: (experienceId: string, draftId: string) =>
    writeJson<{
      draft: InteractiveVisualRefinementDraft;
      projection: InteractiveVisualContextProjection;
    }>(
      pathFor(experienceId, `/visual-refinement/${encodeURIComponent(draftId)}/adopt`),
      'POST',
      {},
    ),

  rejectVisualRefinement: (experienceId: string, draftId: string) =>
    writeJson<InteractiveVisualRefinementDraft>(
      pathFor(experienceId, `/visual-refinement/${encodeURIComponent(draftId)}/reject`),
      'POST',
      {},
    ),

  getLatestMediaPlan: (experienceId: string) =>
    aiAwareFetch(pathFor(experienceId, '/media-plan/latest'))
      .then((response) => parseResponse<InteractiveMediaPlanDraft | null>(response)),

  createMediaPlan: (experienceId: string) =>
    writeJson<InteractiveMediaPlanDraft>(pathFor(experienceId, '/media-plan'), 'POST', {}),

  adoptMediaPlan: (experienceId: string, planId: string) =>
    writeJson<{ plan: InteractiveMediaPlanDraft; aggregate: InteractiveExperienceAggregate }>(
      pathFor(experienceId, `/media-plan/${encodeURIComponent(planId)}/adopt`),
      'POST',
      {},
    ),

  requestMediaPlanRevision: (
    experienceId: string,
    planId: string,
    nodeId: string,
    feedback: string,
    scenarioId?: string,
  ) =>
    writeJson<InteractiveMediaPlanDraft>(
      pathFor(experienceId, `/media-plan/${encodeURIComponent(planId)}/feedback`),
      'POST',
      { nodeId, feedback, scenarioId },
    ),

  listProductionMediaTakes: (experienceId: string, nodeId: string) =>
    aiAwareFetch(`${pathFor(experienceId, '/production-media')}?nodeId=${encodeURIComponent(nodeId)}`)
      .then((response) => parseResponse<InteractiveProductionMediaTakeOption[]>(response)),

  saveBinding: (experienceId: string, binding: NodeContentBinding) =>
    writeJson<InteractiveExperienceAggregate>(
      pathFor(experienceId, '/bindings'),
      'PUT',
      binding,
    ),

  saveBindings: (experienceId: string, bindings: NodeContentBinding[]) =>
    writeJson<InteractiveExperienceAggregate>(
      pathFor(experienceId, '/bindings/batch'),
      'PUT',
      { bindings },
    ),

  saveScriptBindings: (experienceId: string, bindings: Array<Pick<NodeContentBinding, 'nodeId' | 'slot' | 'versionIndex' | 'scriptSceneRefs' | 'contentFitReview' | 'reusePolicy' | 'status'>>) =>
    writeJson<InteractiveExperienceAggregate>(
      pathFor(experienceId, '/bindings/script'),
      'PUT',
      { bindings },
    ),

  listBindingHistory: (experienceId: string, nodeId: string, slot: NodeContentBinding['slot'] = 'main') => {
    const query = new URLSearchParams({ nodeId, slot });
    return aiAwareFetch(`${pathFor(experienceId, '/bindings/history')}?${query}`)
      .then((response) => parseResponse<NodeContentBindingVersion[]>(response));
  },

  deleteExperience: async (experienceId: string) => {
    const response = await aiAwareFetch(pathFor(experienceId), { method: 'DELETE' });
    return parseResponse<{ success: true }>(response);
  },
};

export type {
  DurationBudget,
  ExperienceSpec,
  GraphLayoutRevision,
  InteractionFormatProfile,
  InteractiveAuthoringStatusProjection,
  InteractiveChoice,
  InteractiveExperience,
  InteractiveExperienceAggregate,
  InteractivePlaytestCheckpoint,
  InteractiveProductionMediaTakeOption,
  InteractiveProductionPrepTarget,
  InteractiveRuntimeBuild,
  InteractiveRuntimeMediaManifest,
  InteractiveRuntimeStoryManifest,
  InteractiveWritingProjectOption,
  InteractiveWritingSceneOption,
  NarrativeGraphVersion,
  NarrativeNode,
  NodeCapability,
  NodeContentBinding,
  StateSchema,
  StoryArchitecture,
  StorySourceBinding,
};

export { normalizeNarrativeGraph } from '../../../../src/domains/interactive/types/schema';
export {
  bindingMediaTakeRefs,
  bindingScriptSceneRefs,
} from '../../../../src/domains/interactive/binding/nodeContentBinding';
export {
  hasNodeCapability,
  nodeRequiresMainContent,
} from '../../../../src/domains/interactive/nodeContentRequirements';
export { buildInteractiveStoryUnits } from '../../../../src/domains/interactive/structure/storyUnits';
export {
  applyStateEffects,
  createInitialStateContext,
  evaluatePredicate,
} from '../../../../src/domains/interactive/interpreter/stateInterpreter';
export type { RuntimeStateContext } from '../../../../src/domains/interactive/interpreter/stateInterpreter';
export { selectRuntimeMediaScenario } from '../../../../src/domains/interactive/media/runtimeMediaScenario';
export { bindingNeedsMediaReview } from '../../../../src/domains/interactive/binding/sourceReview';
export { bindingNeedsContentReview } from '../../../../src/domains/interactive/binding/sourceReview';
export { hasCurrentContentFitReview } from '../../../../src/domains/interactive/binding/contentFitReview';
