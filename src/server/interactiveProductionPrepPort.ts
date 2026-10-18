import { createHash, randomUUID } from 'node:crypto';
import { sha256 } from 'js-sha256';

import type { ScriptRepository } from '../../apps/api/src/repositories/scriptStore';
import { createScriptDelivery, unitText } from '../../packages/script/src/exporters';
import type { ScriptProject } from '../../packages/script/src/schema';
import type { ScriptExportPackage } from '../../packages/domain/src/scriptDelivery';
import { createLegacyProductionProjectFromWritingSource } from '../services/production/writingExportLegacyAdapter';
import type {
  InteractiveProductionPlanDraft,
  InteractiveMediaPlanDraft,
  InteractiveMediaFeedbackRequest,
  InteractiveVisualRefinementDraft,
  Episode,
  ProductionInteractivePrepProfile,
  ProductionScenePlanCandidate,
  ProductionScenePlanVersion,
  Project,
  Scene,
  Shot,
} from '../types/project';
import {
  interactiveContentSlotLabel, mediaTakeChecksum, resolveProductionMediaTake, sameArtifactRef, trustedProductionTakes,
} from './productionMediaTakeResolver';
import type {
  InteractiveProductionMediaTakeOption,
  InteractiveProductionPrepNodeTarget,
  InteractiveProductionPrepPort,
  InteractiveProductionPrepTarget,
  InteractiveRuntimeMediaClip,
  InteractiveRuntimeMediaManifest,
} from '../domains/interactive/ports/productionPrepPort';
import type { InteractiveWritingPort } from '../domains/interactive/ports/writingPort';
import { nodeRequiresMainContent } from '../domains/interactive/nodeContentRequirements';
import { bindingScriptSceneRefs } from '../domains/interactive/binding/nodeContentBinding';
import { hasCurrentContentFitReview } from '../domains/interactive/binding/contentFitReview';
import { storyPlacementForNode } from '../domains/interactive/structure/storyUnits';
import { dbHelpers } from './db';
import { interactiveRepository } from './interactiveRepository';
import { productionScenesFromPlanCandidate } from '../services/production/productionScenePlanProjection';
import {
  buildInteractiveVisualContextProjections,
  type InteractiveVisualContextProjection,
} from '../domains/interactive/projection/interactiveVisualContextProjection';

type InteractiveVisualRefinementGenerator = (input: {
  prompt: string;
  systemInstruction?: string;
}) => Promise<Record<string, unknown>>;

export const productionPrepSceneRefs = (
  node: ProductionInteractivePrepProfile['nodes'][number],
) => node.sourceSceneRefs?.length
  ? node.sourceSceneRefs
  : node.sourceSceneRef
    ? [node.sourceSceneRef]
    : [];

const requireExactSource = (experienceId: string, writingPort: InteractiveWritingPort) => {
  const aggregate = interactiveRepository.getExperience(experienceId);
  const contentNodeIds = new Set(aggregate.graph.nodes.filter(nodeRequiresMainContent).map((node) => node.id));
  const resolved = aggregate.bindings
    .filter((binding) => contentNodeIds.has(binding.nodeId))
    .filter((binding) => (
      hasCurrentContentFitReview(binding)
      && bindingScriptSceneRefs(binding).length > 0
    ))
    .map((binding) => ({
      binding,
      scenes: bindingScriptSceneRefs(binding).map((ref) => writingPort.resolveScene(ref)),
    }));
  if (contentNodeIds.size === 0) {
    throw Object.assign(new Error('当前范围只有路由或状态节点，不需要进入共享制片筹备。'), { statusCode: 422 });
  }
  if (
    resolved.length !== contentNodeIds.size
    || resolved.some((item) => item.scenes.length === 0 || item.scenes.some((scene) => !scene))
  ) {
    throw Object.assign(new Error('节点主剧本引用不完整或已失效，请返回内容绑定修复后再进入制片筹备'), { statusCode: 422 });
  }

  const sources = new Map(
    resolved.flatMap(({ scenes }) => scenes.map((scene) => [
      `${scene!.writingProjectId}:r${scene!.writingProjectRevision}`,
      scene!,
    ] as const)),
  );
  if (sources.size !== 1) {
    throw Object.assign(
      new Error('本批节点引用了不同次的剧本输入。请先按引用来源拆分制作批次，再分别进入共享制片筹备。'),
      { statusCode: 409 },
    );
  }
  return {
    aggregate,
    source: [...sources.values()][0],
    resolved: resolved.map(({ binding, scenes }) => ({
      binding,
      scenes: scenes.filter((scene): scene is NonNullable<typeof scene> => Boolean(scene)),
    })),
  };
};

/** Keep the fixed Writing revision, but only hand the scenes approved for these nodes to Production. */
const scopedDeliveryForBindings = (
  writingProject: ScriptProject,
  aggregate: ReturnType<typeof interactiveRepository.getExperience>,
  resolved: ReturnType<typeof requireExactSource>['resolved'],
): ScriptExportPackage => {
  const delivery = createScriptDelivery(writingProject);
  const selectedKeys = new Set(resolved.flatMap(({ scenes }) => scenes.map((scene) => `${scene.unitId}:${scene.sceneId}`)));
  const plannedSecondsByScene = new Map<string, number>();
  for (const { binding, scenes } of resolved) {
    const range = aggregate.graph.nodes.find((node) => node.id === binding.nodeId)?.interaction?.durationRangeSec;
    if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] < 0 || range[1] < range[0]) continue;
    const secondsPerScene = (range[0] + range[1]) / (2 * scenes.length);
    for (const scene of scenes) {
      const key = `${scene.unitId}:${scene.sceneId}`;
      plannedSecondsByScene.set(key, Math.max(plannedSecondsByScene.get(key) || 0, secondsPerScene));
    }
  }
  const units = delivery.units.flatMap((unit) => {
    const scenes = (unit.scenes || []).filter((scene) => selectedKeys.has(`${unit.id}:${scene.id}`));
    if (!scenes.length) return [];
    const authorUnit = writingProject.units.find((candidate) => candidate.id === unit.id);
    if (!authorUnit) throw Object.assign(new Error(`固定剧本单元 ${unit.id} 不可读取`), { statusCode: 422 });
    const authorScenes = authorUnit.scenes.filter((scene) => selectedKeys.has(`${unit.id}:${scene.id}`));
    const durationSeconds = scenes.reduce((total, scene) => {
      const sourceSeconds = scene.targetDurationSeconds && scene.targetDurationSeconds > 0
        ? scene.targetDurationSeconds
        : (scene.targetDurationMinutes || 0) * 60;
      return total + (sourceSeconds || plannedSecondsByScene.get(`${unit.id}:${scene.id}`) || 0);
    }, 0);
    return [{
      ...unit,
      title: scenes.length === 1
        ? `${scenes[0].title}（源单元：${unit.title}）`
        : `${unit.title} · 已绑定 ${scenes.length} 场`,
      summary: scenes.map((scene) => scene.synopsis || scene.purpose).filter(Boolean).join('\n'),
      targetDurationMinutes: durationSeconds > 0 ? durationSeconds / 60 : undefined,
      prose: unitText(writingProject, { ...authorUnit, scenes: authorScenes }),
      scenes,
    }];
  });
  if (units.reduce((total, unit) => total + (unit.scenes?.length || 0), 0) !== selectedKeys.size) {
    throw Object.assign(new Error('已确认节点引用的场次不在固定剧本交付中'), { statusCode: 422 });
  }
  return { ...delivery, units };
};

const profileFor = ({
  experienceId,
  aggregate,
  resolved,
  project,
}: {
  experienceId: string;
  aggregate: ReturnType<typeof interactiveRepository.getExperience>;
  resolved: Array<{
    binding: ReturnType<typeof interactiveRepository.getExperience>['bindings'][number];
    scenes: Array<NonNullable<ReturnType<InteractiveWritingPort['resolveScene']>>>;
  }>;
  project: Project;
}): ProductionInteractivePrepProfile => {
  const sourceDocumentIdByUnitId = new Map(
    (project.productionSourceDocuments || [])
      .filter((document) => document.sourceWritingUnitId)
      .map((document) => [document.sourceWritingUnitId!, document.id]),
  );
  const bindingByNodeId = new Map(resolved.map((item) => [item.binding.nodeId, item]));
  const source = resolved[0]?.scenes[0];
  if (!source) throw new Error('互动节点没有可读取的已确认剧本来源');

  return {
    schemaVersion: 'interactive-production-prep.v2',
    experienceId,
    graphVersionId: aggregate.graph.id,
    entryNodeId: aggregate.graph.entryNodeId,
    sourceWritingProjectId: source.writingProjectId,
    sourceWritingRevision: source.writingProjectRevision,
    sourceHash: project.productionSourceSnapshot?.sourceHash || '',
    createdAt: Date.now(),
    nodes: aggregate.graph.nodes.map((node) => {
      const storyPlacement = storyPlacementForNode(aggregate.storyArchitecture.data, node);
      const resolvedBinding = bindingByNodeId.get(node.id);
      const scenes = resolvedBinding?.scenes || [];
      const scene = scenes[0];
      const requiresSharedProduction = nodeRequiresMainContent(node);
      if (requiresSharedProduction && !scene) throw new Error(`节点 ${node.brief.title} 缺少已确认的主剧本引用`);
      const sourceDocumentId = scene ? sourceDocumentIdByUnitId.get(scene.unitId) : undefined;
      if (requiresSharedProduction && !sourceDocumentId) throw new Error(`节点 ${node.brief.title} 的剧本工作单元没有进入共享制片来源`);
      const sourceSceneRefs = scenes.map((item) => item.ref);
      const hasIncomingChoice = aggregate.graph.nodes.some((candidate) => (
        candidate.choices.some((choice) => choice.targetNodeId === node.id)
      ));
      const isEnding = node.brief.dramaticFunction === 'ending' || node.choices.length === 0;
      const orderedContentSlots = sourceSceneRefs.length ? [
        ...(hasIncomingChoice ? [{ slot: 'entry' as const, sourceSceneRefs }] : []),
        { slot: 'main' as const, sourceSceneRefs },
        ...(!isEnding && node.choices.length > 0 ? [{ slot: 'choice_hold' as const, sourceSceneRefs }] : []),
      ] : [];
      return {
        nodeId: node.id,
        title: node.brief.title,
        dramaticFunction: node.brief.dramaticFunction,
        ...storyPlacement,
        requiresSharedProduction,
        sourceDocumentId,
        sourceWritingUnitId: scene?.unitId,
        sourceSceneRef: scene?.ref,
        sourceSceneRefs,
        orderedContentSlots,
        readVariables: [...node.contract.readVariables],
        writeVariables: [...node.contract.writeVariables],
        requiredFacts: [...node.contract.requiredFacts],
        producedFacts: [...node.contract.producedFacts],
        choices: node.choices.map((choice) => ({
          choiceId: choice.id,
          text: choice.text,
          intent: choice.intent,
          targetNodeId: choice.targetNodeId,
          timeoutSeconds: choice.timeoutSeconds,
          defaultTimeoutTargetNodeId: choice.defaultTimeoutTargetNodeId,
        })),
        isEnding,
      };
    }),
  };
};

const linkedProjectIsCurrent = (target: InteractiveProductionPrepTarget) => {
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  const source = project?.productionSourceSnapshot;
  const sourceDocuments = project?.productionSourceDocuments || [];
  const interactiveProfile = project?.interactiveProductionPrepProfile;
  const aggregate = (() => {
    try {
      return interactiveRepository.getExperience(target.experienceId);
    } catch {
      return null;
    }
  })();
  const currentBindingRefs = new Map(
    aggregate?.bindings
      .filter((binding) => binding.slot === 'main' && binding.status === 'approved')
      .map((binding) => [binding.nodeId, bindingScriptSceneRefs(binding).map((ref) => ref.checksum)]) || [],
  );
  const profileMatchesBindings = Boolean(aggregate && interactiveProfile
    && interactiveProfile.graphVersionId === aggregate.graph.id
    && interactiveProfile.nodes.every((node) => {
      const graphNode = aggregate.graph.nodes.find((candidate) => candidate.id === node.nodeId);
      if (!graphNode) return false;
      const storyPlacement = storyPlacementForNode(aggregate.storyArchitecture.data, graphNode);
      if (
        node.storyChapterId !== storyPlacement.storyChapterId
        || node.storyEpisodeId !== storyPlacement.storyEpisodeId
      ) return false;
      if (!(node.requiresSharedProduction ?? Boolean(node.sourceDocumentId))) return true;
      const refs = productionPrepSceneRefs(node);
      return JSON.stringify(refs.map((ref) => ref.checksum))
        === JSON.stringify(currentBindingRefs.get(node.nodeId) || []);
    }));
  const sourceUnitsReadable = sourceDocuments.length > 0
    && sourceDocuments.every((document) => project?.episodes.some((episode) => episode.sourceDocumentId === document.id));
  return Boolean(
    source
      && source.sourceType === 'writing_export'
      && source.sourceWritingProjectId === target.sourceWritingProjectId
      && source.sourceHash === target.sourceHash
      && sourceUnitsReadable
      && interactiveProfile?.experienceId === target.experienceId
      && profileMatchesBindings
      && interactiveProfile.sourceWritingProjectId === target.sourceWritingProjectId
      && interactiveProfile.sourceWritingRevision === target.sourceWritingRevision
      && interactiveProfile.sourceHash === target.sourceHash,
  );
};

const linkedProjectIsReadable = (target: InteractiveProductionPrepTarget) => {
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  const source = project?.productionSourceSnapshot;
  const profile = project?.interactiveProductionPrepProfile;
  const sourceDocuments = project?.productionSourceDocuments || [];
  return Boolean(
    project
      && source?.sourceType === 'writing_export'
      && source.sourceWritingProjectId === target.sourceWritingProjectId
      && source.sourceHash === target.sourceHash
      && sourceDocuments.length > 0
      && sourceDocuments.every((document) => project.episodes.some((episode) => episode.sourceDocumentId === document.id))
      && profile?.experienceId === target.experienceId
      && profile.sourceWritingProjectId === target.sourceWritingProjectId
      && profile.sourceHash === target.sourceHash,
  );
};

/** An older preparation project may contain the whole Writing unit even when its profile names one scene. */
const projectScopeMatchesProfile = (project: Project, profile: ProductionInteractivePrepProfile) => {
  const source = project.productionSourceSnapshot;
  if (source?.sourceType !== 'writing_export'
    || source.package.sourceWritingProjectId !== profile.sourceWritingProjectId
    || source.package.sourceRevision !== profile.sourceWritingRevision) return false;
  const expected = new Set(profile.nodes
    .filter((node) => node.requiresSharedProduction ?? Boolean(node.sourceDocumentId))
    .flatMap((node) => productionPrepSceneRefs(node).map((ref) => ref.artifactId)));
  const units = source.package.units;
  const actual = units.flatMap((unit) => (unit.scenes || []).map((scene) =>
    `script-scene:${profile.sourceWritingProjectId}:${unit.id}:${scene.id}`));
  return expected.size > 0
    && units.every((unit) => Boolean(unit.scenes?.length))
    && actual.length === expected.size
    && actual.every((artifactId) => expected.has(artifactId));
};

const refreshStoryPlacementProjection = (
  target: InteractiveProductionPrepTarget,
): InteractiveProductionPrepTarget => {
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  const profile = project?.interactiveProductionPrepProfile;
  if (!project || !profile || profile.experienceId !== target.experienceId) return target;
  let aggregate: ReturnType<typeof interactiveRepository.getExperience>;
  try {
    aggregate = interactiveRepository.getExperience(target.experienceId);
  } catch {
    return target;
  }
  let changed = false;
  const nodes = profile.nodes.map((node) => {
    const graphNode = aggregate.graph.nodes.find((candidate) => candidate.id === node.nodeId);
    if (!graphNode) return node;
    const placement = storyPlacementForNode(aggregate.storyArchitecture.data, graphNode);
    if (
      node.storyChapterId === placement.storyChapterId
      && node.storyEpisodeId === placement.storyEpisodeId
      && node.storyChapterTitle === placement.storyChapterTitle
      && node.storyEpisodeTitle === placement.storyEpisodeTitle
      && node.storyChapterOrder === placement.storyChapterOrder
      && node.storyEpisodeOrder === placement.storyEpisodeOrder
    ) return node;
    changed = true;
    return { ...node, ...placement };
  });
  if (changed) {
    dbHelpers.saveProject({
      ...project,
      interactiveProductionPrepProfile: { ...profile, nodes },
      updatedAt: Date.now(),
    });
  }
  return target;
};

const withNodeTargets = (target: InteractiveProductionPrepTarget): InteractiveProductionPrepTarget => {
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  const profile = project?.interactiveProductionPrepProfile;
  if (!project || !profile || profile.experienceId !== target.experienceId) return target;
  const sourceScopeCurrent = projectScopeMatchesProfile(project, profile);
  const aggregate = (() => {
    try {
      return interactiveRepository.getExperience(target.experienceId);
    } catch {
      return null;
    }
  })();
  const currentProjectionSceneIds = new Set(aggregate
    ? interactiveRepository.listVisualContextProjections(target.experienceId, project.id)
        .filter((projection) => (
          projection.status !== 'stale'
          && projection.graphVersionId === aggregate.graph.id
          && projection.stateSchemaVersionId === aggregate.stateSchema.id
        ))
        .map((projection) => projection.productionSceneId)
    : []);
  const bindingRefsByNodeId = new Map(
    aggregate?.bindings
      .filter((binding) => binding.slot === 'main')
      .map((binding) => [binding.nodeId, bindingScriptSceneRefs(binding)]) || [],
  );

  const episodeBySourceDocumentId = new Map(
    project.episodes
      .filter((episode) => Boolean(episode.sourceDocumentId))
      .map((episode) => [episode.sourceDocumentId!, episode.id]),
  );
  const nodeTargets: InteractiveProductionPrepNodeTarget[] = profile.nodes.flatMap((node) => {
    const requiresSharedProduction = node.requiresSharedProduction ?? Boolean(node.sourceDocumentId);
    if (!requiresSharedProduction || !node.sourceDocumentId || !node.sourceWritingUnitId) return [];
    const productionEpisodeId = episodeBySourceDocumentId.get(node.sourceDocumentId);
    const productionEpisode = project.episodes
      .find((episode) => episode.id === productionEpisodeId) as (Project['episodes'][number] & {
        scenes?: Array<{ id: string; interactiveMetadata?: { nodeIds?: string[] } }>;
      }) | undefined;
    const productionSceneIds = productionEpisode
      ?.scenes
      .filter((scene) => scene.interactiveMetadata?.nodeIds.includes(node.nodeId))
      .map((scene) => scene.id) || [];
    const graphNode = aggregate?.graph.nodes.find((candidate) => candidate.id === node.nodeId);
    const currentBindingRefs = bindingRefsByNodeId.get(node.nodeId) || [];
    const profileRefs = productionPrepSceneRefs(node);
    const profileMatchesCurrentNode = Boolean(graphNode
      && node.title === graphNode.brief.title
      && node.dramaticFunction === graphNode.brief.dramaticFunction
      && node.requiresSharedProduction === nodeRequiresMainContent(graphNode)
      && JSON.stringify(node.readVariables) === JSON.stringify(graphNode.contract.readVariables)
      && JSON.stringify(node.writeVariables) === JSON.stringify(graphNode.contract.writeVariables)
      && JSON.stringify(node.requiredFacts) === JSON.stringify(graphNode.contract.requiredFacts)
      && JSON.stringify(node.producedFacts) === JSON.stringify(graphNode.contract.producedFacts)
      && JSON.stringify(node.choices) === JSON.stringify(graphNode.choices.map((choice) => ({
        choiceId: choice.id,
        text: choice.text,
        intent: choice.intent,
        targetNodeId: choice.targetNodeId,
        timeoutSeconds: choice.timeoutSeconds,
        defaultTimeoutTargetNodeId: choice.defaultTimeoutTargetNodeId,
      })))
      && node.isEnding === (graphNode.brief.dramaticFunction === 'ending' || graphNode.choices.length === 0)
      && JSON.stringify(profileRefs.map((ref) => ({
        artifactId: ref.artifactId,
        versionId: ref.versionId,
        checksum: ref.checksum,
      }))) === JSON.stringify(currentBindingRefs.map((ref) => ({
        artifactId: ref.artifactId,
        versionId: ref.versionId,
        checksum: ref.checksum,
      })))
      && (
        productionSceneIds.length === 0
        || productionSceneIds.every((sceneId) => currentProjectionSceneIds.has(sceneId))
      ));
    return productionEpisodeId ? [{
      nodeId: node.nodeId,
      sourceDocumentId: node.sourceDocumentId,
      sourceWritingUnitId: node.sourceWritingUnitId,
      productionEpisodeId,
      productionSceneIds,
      isCurrentForNode: sourceScopeCurrent && profileMatchesCurrentNode,
    }] : [];
  });
  const latestFeedbackByNode = new Map<string, InteractiveMediaFeedbackRequest>();
  for (const request of project.interactiveMediaFeedbackRequests || []) {
    const current = latestFeedbackByNode.get(request.nodeId);
    if (!current || request.createdAt > current.createdAt) latestFeedbackByNode.set(request.nodeId, request);
  }
  return {
    ...target,
    nodeTargets,
    nodeFeedback: [...latestFeedbackByNode.values()].map(({ nodeId, feedback, createdAt }) => ({
      nodeId,
      feedback,
      createdAt,
    })),
  };
};

const attachInteractiveVisualProjections = (
  experienceId: string,
  project: Project,
): {
  project: Project;
  projections: InteractiveVisualContextProjection[];
} => {
  const aggregate = interactiveRepository.getExperience(experienceId);
  const productionEpisodes = project.episodes as Episode[];
  const charactersById = new Map((project.characters || []).map((character) => [character.id, character]));
  const assetsById = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const sources = productionEpisodes.flatMap((episode) => (
    (episode.scenes || []).flatMap((scene) => {
      const metadata = scene.interactiveMetadata;
      if (!metadata?.nodeIds?.length) return [];
      const characterIds = [...new Set(scene.breakdown?.characterIds || [])];
      const assetIds = [...new Set([
        scene.breakdown?.locationId,
        ...(scene.breakdown?.propIds || []),
      ].filter((id): id is string => Boolean(id)))];
      const variantEntries = Object.entries(scene.breakdown?.assetVariantMap || {})
        .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]));
      const describeVariant = (assetId: string, variantId: string) => {
        const owner = charactersById.get(assetId) || assetsById.get(assetId);
        const variant = owner?.variants?.find((item) => item.id === variantId);
        if (!owner || !variant) return '';
        const description = [variant.name, variant.description, variant.promptModifiers]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .join('；');
        return description ? `${owner.name}：${description}` : owner.name;
      };
      return [{
        productionSceneId: scene.id,
        nodeIds: metadata.nodeIds,
        continuityIn: [metadata.incomingContext || ''].filter(Boolean),
        continuityOut: [metadata.outgoingContext || ''].filter(Boolean),
        canonicalAssetRefs: [...new Set([...characterIds, ...assetIds])],
        characterVariantRefs: variantEntries
          .filter(([assetId]) => charactersById.has(assetId))
          .map(([, variantId]) => variantId),
        assetVariantRefs: variantEntries
          .filter(([assetId]) => assetsById.has(assetId))
          .map(([, variantId]) => variantId),
        environmentChanges: variantEntries
          .filter(([assetId]) => assetsById.has(assetId))
          .map(([assetId, variantId]) => describeVariant(assetId, variantId))
          .filter(Boolean),
        performanceConstraints: variantEntries
          .filter(([assetId]) => charactersById.has(assetId))
          .map(([assetId, variantId]) => describeVariant(assetId, variantId))
          .filter(Boolean),
      }];
    })
  ));
  const projections = buildInteractiveVisualContextProjections({
    experienceId,
    graph: aggregate.graph,
    stateSchemaVersionId: aggregate.stateSchema.id,
    stateSchema: aggregate.stateSchema.data,
    bindings: aggregate.bindings,
    productionProjectId: project.id,
    sources,
  });
  const projectionBySceneId = new Map(
    projections.map((projection) => [projection.productionSceneId, projection]),
  );
  return {
    project: {
      ...project,
      episodes: productionEpisodes.map((episode) => ({
        ...episode,
        scenes: (episode.scenes || []).map((scene) => {
          const projection = projectionBySceneId.get(scene.id);
          if (!projection || !scene.interactiveMetadata) return scene;
          const visualScenarios = projection.scenarios.map((scenario) => ({
            id: scenario.id,
            label: scenario.label,
            shotPromptDelta: scenario.shotPromptDelta,
            reuseFingerprint: scenario.reuseFingerprint,
            stateFingerprint: scenario.stateFingerprint,
            observableFacts: scenario.observableFacts,
            observableVariables: scenario.observableVariables,
            canonicalAssetRefs: scenario.canonicalAssetRefs,
            characterVariantRefs: scenario.characterVariantRefs,
            assetVariantRefs: scenario.assetVariantRefs,
            environmentChanges: scenario.environmentChanges,
            performanceConstraints: scenario.performanceConstraints,
          }));
          const previousActive = scene.interactiveMetadata.activeVisualScenarioId;
          const activeVisualScenarioId = visualScenarios.some((scenario) => scenario.id === previousActive)
            ? previousActive
            : [...visualScenarios].sort((left, right) => (
              (left.observableFacts.length + Object.keys(left.observableVariables || {}).length)
              - (right.observableFacts.length + Object.keys(right.observableVariables || {}).length)
            ))[0]?.id;
          return {
            ...scene,
            interactiveMetadata: {
              ...scene.interactiveMetadata,
              graphVersionId: projection.graphVersionId,
              visualProjectionId: projection.id,
              visualProjectionFingerprint: projection.sourceFingerprint,
              activeVisualScenarioId,
              visualScenarios,
            },
          };
        }),
      })) as Project['episodes'],
    } as Project,
    projections,
  };
};

const sanitizedProposalText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const sanitizedProposalList = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value
        .map((item) => sanitizedProposalText(item, 300))
        .filter(Boolean))]
        .slice(0, 12)
    : []
);

const visualRefinementProposalFrom = (
  value: Record<string, unknown>,
  fallbackLabel: string,
): InteractiveVisualRefinementDraft['proposal'] => {
  const nested = value.proposal;
  const payload = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : value;
  const proposal = {
    label: sanitizedProposalText(payload.label, 80) || fallbackLabel,
    environmentChanges: sanitizedProposalList(payload.environmentChanges),
    performanceConstraints: sanitizedProposalList(payload.performanceConstraints),
    rationale: sanitizedProposalText(payload.rationale, 600),
  };
  if (proposal.environmentChanges.length === 0 && proposal.performanceConstraints.length === 0) {
    throw Object.assign(new Error('AI 没有提出可采用的环境或表演变化，请补充意见后重试'), { statusCode: 422 });
  }
  return proposal;
};

const applyVisualProjectionToProject = (
  project: Project,
  projection: InteractiveVisualContextProjection,
): Project => ({
  ...project,
  episodes: project.episodes.map((episode) => ({
    ...episode,
    scenes: ((episode as Episode).scenes || []).map((scene) => {
      if (scene.id !== projection.productionSceneId || !scene.interactiveMetadata) return scene;
      const visualScenarios = projection.scenarios.map((scenario) => ({
        id: scenario.id,
        label: scenario.label,
        shotPromptDelta: scenario.shotPromptDelta,
        reuseFingerprint: scenario.reuseFingerprint,
        stateFingerprint: scenario.stateFingerprint,
        observableFacts: scenario.observableFacts,
        observableVariables: scenario.observableVariables,
        canonicalAssetRefs: scenario.canonicalAssetRefs,
        characterVariantRefs: scenario.characterVariantRefs,
        assetVariantRefs: scenario.assetVariantRefs,
        environmentChanges: scenario.environmentChanges,
        performanceConstraints: scenario.performanceConstraints,
      }));
      return {
        ...scene,
        interactiveMetadata: {
          ...scene.interactiveMetadata,
          graphVersionId: projection.graphVersionId,
          visualProjectionId: projection.id,
          visualProjectionFingerprint: projection.sourceFingerprint,
          activeVisualScenarioId: visualScenarios.some((item) => (
            item.id === scene.interactiveMetadata?.activeVisualScenarioId
          ))
            ? scene.interactiveMetadata.activeVisualScenarioId
            : visualScenarios[0]?.id,
          visualScenarios,
        },
      };
    }),
  })) as Project['episodes'],
});


const mediaTakesForNode = ({
  target,
  nodeId,
}: {
  target: InteractiveProductionPrepTarget;
  nodeId: string;
}): InteractiveProductionMediaTakeOption[] => {
  const nodeTarget = target.nodeTargets?.find((candidate) => candidate.nodeId === nodeId);
  if (!nodeTarget) return [];
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  if (!project) return [];
  const episode = project.episodes.find((candidate) => candidate.id === nodeTarget.productionEpisodeId) as (Project['episodes'][number] & { scenes?: Scene[] }) | undefined;
  if (!episode) return [];
  const sceneOrder = new Map(nodeTarget.productionSceneIds.map((sceneId, index) => [sceneId, index]));
  const options = (episode.scenes || [])
    .filter((scene) => sceneOrder.has(scene.id))
    .sort((left, right) => (sceneOrder.get(left.id) || 0) - (sceneOrder.get(right.id) || 0))
    .flatMap((scene) => (scene.shots || []).map((shot, shotIndex) => ({ scene, shot, shotIndex })))
    .flatMap(({ scene, shot, shotIndex }) => {
      return trustedProductionTakes(shot).flatMap((take) => {
        const interactiveContext = take.generationAudit?.interactiveVideoContext;
        const currentGraphVersionId = project.interactiveProductionPrepProfile?.graphVersionId;
        if (
          interactiveContext
          && currentGraphVersionId
          && interactiveContext.graphVersionId !== currentGraphVersionId
        ) return [];
        const checksum = mediaTakeChecksum({
          projectId: project.id,
          episodeId: episode.id,
          sceneId: scene.id,
          shotId: shot.id,
          takeId: take.takeId,
          media: take.media,
        });
        const visualScenarios = scene.interactiveMetadata?.visualScenarios || [];
        const fallbackScenario = visualScenarios.length === 1 ? visualScenarios[0] : undefined;
        const contentSlot = interactiveContext?.contentSlot || 'main';
        const visualScenarioId = interactiveContext?.visualScenarioId
          || take.generationAudit?.visualScenarioId
          || fallbackScenario?.id;
        const visualStateFingerprint = take.generationAudit?.visualStateFingerprint
          || interactiveContext?.visualStateFingerprint
          || fallbackScenario?.stateFingerprint;
        const visualReuseFingerprint = take.generationAudit?.visualReuseFingerprint
          || interactiveContext?.visualReuseFingerprint
          || fallbackScenario?.reuseFingerprint;
        return [{
          ref: {
            artifactId: `production-media-take:${project.id}:${episode.id}:${scene.id}:${shot.id}:${take.takeId}`,
            versionId: take.media.generationJobId || `media-${checksum.slice(0, 16)}`,
            kind: 'media_take' as const,
            checksum,
          },
          nodeId,
          productionProjectId: project.id,
          productionEpisodeId: episode.id,
          productionSceneId: scene.id,
          shotId: shot.id,
          takeId: take.takeId,
          isActive: take.isActive,
          createdAt: take.createdAt,
          label: `${interactiveContentSlotLabel(contentSlot)} · ${scene.title || `场 ${scene.sceneNumber || ''}`} · 镜头 ${shotIndex + 1}`,
          durationSeconds: Number(shot.duration || 0),
          contentSlot,
          mediaKind: take.mediaKind,
          embeddedAudio: take.mediaKind === 'video' && Boolean(take.generationAudit?.audioProvenance?.embeddedAudio),
          visualScenarioId,
          visualStateFingerprint,
          visualReuseFingerprint,
          url: take.media.url,
        }];
      });
    });
  const slotOrder: Record<InteractiveProductionMediaTakeOption['contentSlot'], number> = {
    entry: 0,
    main: 1,
    exit: 2,
    choice_hold: 3,
  };
  return options.sort((left, right) => slotOrder[left.contentSlot] - slotOrder[right.contentSlot]);
};

const selectPreferredMediaTakes = (
  takes: InteractiveProductionMediaTakeOption[],
  previouslyAdoptedRefs: Array<{ artifactId: string; versionId: string; checksum: string }> = [],
) => {
  const takesByShot = new Map<string, InteractiveProductionMediaTakeOption[]>();
  for (const take of takes) {
    const key = `${take.productionSceneId}:${take.shotId}`;
    takesByShot.set(key, [...(takesByShot.get(key) || []), take]);
  }
  return [...takesByShot.values()].map((candidates) => (
    candidates.find((take) => take.isActive)
    || candidates.find((take) => previouslyAdoptedRefs.some((ref) => sameArtifactRef(ref, take.ref)))
    || [...candidates].sort((left, right) => right.createdAt - left.createdAt)[0]
  ));
};


const productionProjectForExperience = (
  experienceId: string,
  target: InteractiveProductionPrepTarget | null,
) => {
  if (!target) throw Object.assign(new Error('请先准备共享制片项目'), { statusCode: 409 });
  const project = dbHelpers.getProjectById(target.productionProjectId) as Project | null;
  if (!project?.interactiveProductionPrepProfile || project.interactiveProductionPrepProfile.experienceId !== experienceId) {
    throw Object.assign(new Error('共享制片项目已失效，请重新准备'), { statusCode: 409 });
  }
  return project;
};

const productionProjectShellForExperience = (
  experienceId: string,
  target: InteractiveProductionPrepTarget | null,
) => {
  if (!target) return null;
  const project = dbHelpers.getProjectShellById(target.productionProjectId) as Project | null;
  if (!project?.interactiveProductionPrepProfile || project.interactiveProductionPrepProfile.experienceId !== experienceId) {
    return null;
  }
  return project;
};

const persistedVisualScenariosForNode = (project: Project, nodeId: string) => (
  (project.episodes as Episode[]).flatMap((episode) => (
    (episode.scenes || []).flatMap((scene) => (
      scene.interactiveMetadata?.nodeIds?.includes(nodeId)
        ? (scene.interactiveMetadata.visualScenarios || []).map((scenario) => ({ sceneId: scene.id, scenario }))
        : []
    ))
  ))
);

const persistedInteractiveSceneIdsForNode = (project: Project, nodeId: string) => (
  (project.episodes as Episode[]).flatMap((episode) => (
    (episode.scenes || [])
      .filter((scene) => scene.interactiveMetadata?.nodeIds?.includes(nodeId))
      .map((scene) => scene.id)
  ))
);

const sceneEvidence = (scene: {
  synopsis?: string;
  blocks?: ReadonlyArray<{ readonly content?: string }>;
}) => scene.blocks?.map((block) => String(block.content || '').trim()).filter(Boolean).join('\n')
  || String(scene.synopsis || '').trim();

export const createInteractiveProductionPrepPort = ({
  scriptRepository,
  writingPort,
  visualRefinementGenerator,
}: {
  scriptRepository: ScriptRepository;
  writingPort: InteractiveWritingPort;
  visualRefinementGenerator?: InteractiveVisualRefinementGenerator;
}): InteractiveProductionPrepPort => ({
  getTarget(experienceId) {
    const persisted = interactiveRepository.getProductionPrepTarget(experienceId);
    const target = persisted ? refreshStoryPlacementProjection(persisted) : null;
    // Existing preparation remains inspectable while a changed node awaits review.
    // ensureTarget still requires the full current source before rebuilding it.
    return target && linkedProjectIsReadable(target) ? withNodeTargets(target) : null;
  },

  ensureTarget(experienceId) {
    const { aggregate, source, resolved } = requireExactSource(experienceId, writingPort);
    const writingProject = scriptRepository.readProjectInput?.(
      source.writingProjectId,
      source.writingProjectRevision,
    );
    if (!writingProject) {
      throw Object.assign(new Error('已引用的剧本输入不可读取，无法建立可复现的制片筹备项目'), { statusCode: 422 });
    }
    const scopedDelivery = scopedDeliveryForBindings(writingProject, aggregate, resolved);
    const scopedSourceHash = sha256(JSON.stringify(scopedDelivery));
    const persistedTarget = interactiveRepository.getProductionPrepTarget(experienceId);
    const currentTarget = persistedTarget ? refreshStoryPlacementProjection(persistedTarget) : null;
    if (
      currentTarget
      && currentTarget.sourceWritingProjectId === source.writingProjectId
      && currentTarget.sourceWritingRevision === source.writingProjectRevision
      && currentTarget.sourceHash === scopedSourceHash
      && linkedProjectIsCurrent(currentTarget)
    ) {
      return withNodeTargets({ ...currentTarget, status: 'reused' });
    }

    if (
      currentTarget
      && currentTarget.sourceWritingProjectId === source.writingProjectId
      && currentTarget.sourceWritingRevision === source.writingProjectRevision
      && currentTarget.sourceHash === scopedSourceHash
    ) {
      const currentProject = dbHelpers.getProjectById(currentTarget.productionProjectId) as Project | null;
      if (currentProject?.productionSourceSnapshot?.sourceHash === currentTarget.sourceHash) {
        currentProject.interactiveProductionPrepProfile = profileFor({
          experienceId,
          aggregate,
          resolved,
          project: currentProject,
        });
        const projected = attachInteractiveVisualProjections(experienceId, currentProject);
        projected.project.interactiveProductionPlanDrafts = (projected.project.interactiveProductionPlanDrafts || [])
          .map((plan) => plan.status === 'candidate'
            ? { ...plan, status: 'stale' as const, updatedAt: Date.now() }
            : plan);
        dbHelpers.saveProject(projected.project);
        interactiveRepository.replaceVisualContextProjections(
          experienceId,
          currentProject.id,
          projected.projections,
        );
        return withNodeTargets({ ...currentTarget, status: 'reused' });
      }
    }

    const productionProject = createLegacyProductionProjectFromWritingSource({
      package: scopedDelivery,
      productionProjectId: `interactive-production-${randomUUID()}`,
      importId: `interactive-prep-${randomUUID()}`,
    });
    productionProject.interactiveProductionPrepProfile = profileFor({
      experienceId,
      aggregate,
      resolved,
      project: productionProject,
    });
    const sourceHash = productionProject.productionSourceSnapshot?.sourceHash;
    if (!sourceHash || !productionProject.productionSourceDocuments?.length) {
      throw new Error('引用剧本没有可进入共享制片筹备的正文单元');
    }

    dbHelpers.saveProject(productionProject);
    return withNodeTargets(interactiveRepository.saveProductionPrepTarget({
      experienceId,
      productionProjectId: productionProject.id,
      sourceWritingProjectId: source.writingProjectId,
      sourceWritingRevision: source.writingProjectRevision,
      sourceHash,
    }));
  },

  listMediaTakes(experienceId, nodeId) {
    const target = this.getTarget(experienceId);
    return target ? mediaTakesForNode({ target, nodeId }) : [];
  },

  getLatestPlan(experienceId) {
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectShellForExperience(experienceId, target);
    if (!project) return null;
    return [...(project.interactiveProductionPlanDrafts || [])]
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  },

  createPlan(experienceId) {
    const target = this.ensureTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const profile = project.interactiveProductionPrepProfile!;
    const existing = [...(project.interactiveProductionPlanDrafts || [])]
      .filter((plan) => plan.status === 'candidate' && plan.sourceHash === target.sourceHash)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (existing) return existing;

    const sourceSnapshot = project.productionSourceSnapshot;
    if (sourceSnapshot?.sourceType !== 'writing_export') {
      throw Object.assign(new Error('制片项目没有可追溯的 Writing 来源'), { statusCode: 422 });
    }
    const sourceUnits = sourceSnapshot.package.units;
    const documentByUnitId = new Map(
      (project.productionSourceDocuments || [])
        .filter((document) => document.sourceWritingUnitId)
        .map((document) => [document.sourceWritingUnitId!, document]),
    );
    const episodeByDocumentId = new Map(
      project.episodes
        .filter((episode) => episode.sourceDocumentId)
        .map((episode) => [episode.sourceDocumentId!, episode]),
    );
    const aggregate = interactiveRepository.getExperience(experienceId);
    const graphNodeById = new Map(aggregate.graph.nodes.map((node) => [node.id, node]));
    const nodeIdsByScene = new Map<string, string[]>();
    const resolvedSceneByKey = new Map<string, NonNullable<ReturnType<InteractiveWritingPort['resolveScene']>>>();
    const plannedDurationSecondsByScene = new Map<string, number>();
    for (const node of profile.nodes) {
      const sceneRefs = productionPrepSceneRefs(node);
      const durationRange = graphNodeById.get(node.nodeId)?.interaction?.durationRangeSec;
      const plannedNodeDurationSeconds = durationRange
        && Number.isFinite(durationRange[0])
        && Number.isFinite(durationRange[1])
        && durationRange[0] >= 0
        && durationRange[1] >= durationRange[0]
        ? (durationRange[0] + durationRange[1]) / 2
        : 0;
      const plannedSecondsPerScene = sceneRefs.length > 0
        ? plannedNodeDurationSeconds / sceneRefs.length
        : 0;
      for (const ref of sceneRefs) {
        const resolved = writingPort.resolveScene({ ...ref, kind: 'script_scene' });
        if (!resolved) throw Object.assign(new Error(`节点“${node.title}”的剧本场次已失效`), { statusCode: 422 });
        const key = `${resolved.unitId}:${resolved.sceneId}`;
        nodeIdsByScene.set(key, [...new Set([...(nodeIdsByScene.get(key) || []), node.nodeId])]);
        resolvedSceneByKey.set(key, resolved);
        if (plannedSecondsPerScene > 0) {
          plannedDurationSecondsByScene.set(
            key,
            Math.max(plannedDurationSecondsByScene.get(key) || 0, plannedSecondsPerScene),
          );
        }
      }
    }

    const units = sourceUnits.flatMap((unit) => {
      const sourceDocument = documentByUnitId.get(unit.id);
      const episode = sourceDocument ? episodeByDocumentId.get(sourceDocument.id) : undefined;
      if (!sourceDocument || !episode) return [];
      const scenes: ProductionScenePlanCandidate[] = (unit.scenes || [])
        .filter((scene) => nodeIdsByScene.has(`${unit.id}:${scene.id}`))
        .sort((left, right) => left.index - right.index)
        .map((scene, index) => {
          const key = `${unit.id}:${scene.id}`;
          const resolvedScene = resolvedSceneByKey.get(key);
          const scriptBlocks = (resolvedScene?.scriptBlocks || [])
            .map((block) => ({
              type: block.type === 'prose' ? 'action' as const : block.type,
              content: block.content.trim(),
            }))
            .filter((block) => block.content);
          const sourceEvidence = scriptBlocks.map((block) => block.content).join('\n')
            || sceneEvidence(scene);
          return {
            id: `production_candidate_${unit.id}_${scene.id}`,
            order: index + 1,
            title: scene.title,
            description: scene.synopsis || scene.purpose || sourceEvidence,
            purpose: scene.purpose,
            sourceEvidence,
            scriptBlocks,
            continuityIn: scene.continuityIn,
            continuityOut: scene.continuityOut,
            targetDurationMinutes: scene.targetDurationSeconds
              ? scene.targetDurationSeconds / 60
              : scene.targetDurationMinutes
                || ((plannedDurationSecondsByScene.get(key) || 0) / 60)
                || undefined,
            interactiveNodeIds: nodeIdsByScene.get(key) || [],
          };
        });
      return scenes.length ? [{ episodeId: episode.id, sourceDocumentId: sourceDocument.id, scenes }] : [];
    });
    const allScenes = units.flatMap((unit) => unit.scenes);
    if (!allScenes.length) {
      throw Object.assign(new Error('当前内容方案没有可映射的正式剧本场次'), { statusCode: 422 });
    }
    const affectedNodeIds = new Set(allScenes.flatMap((scene) => scene.interactiveNodeIds || []));
    const plan: InteractiveProductionPlanDraft = {
      id: `interactive_production_plan_${randomUUID()}`,
      experienceId,
      sourceHash: target.sourceHash,
      sourceWritingRevision: target.sourceWritingRevision,
      status: 'candidate',
      units,
      impact: {
        productionSceneCount: allScenes.length,
        reusedSceneCount: allScenes.filter((scene) => (scene.interactiveNodeIds || []).length > 1).length,
        affectedNodeCount: affectedNodeIds.size,
        estimatedUniqueDurationSeconds: Math.round(allScenes.reduce(
          (total, scene) => total + (scene.targetDurationMinutes || 1) * 60,
          0,
        )),
        nodesWithoutMedia: [...affectedNodeIds].filter((nodeId) => mediaTakesForNode({ target, nodeId }).length === 0).length,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dbHelpers.saveProject({
      ...project,
      interactiveProductionPlanDrafts: [
        ...(project.interactiveProductionPlanDrafts || []).map((item) => (
          item.status === 'candidate' ? { ...item, status: 'stale' as const, updatedAt: Date.now() } : item
        )),
        plan,
      ],
    });
    return plan;
  },

  adoptPlan(experienceId, planId) {
    const target = this.getTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const plan = project.interactiveProductionPlanDrafts?.find((item) => item.id === planId);
    if (!plan) throw Object.assign(new Error('制片方案不存在'), { statusCode: 404 });
    if (plan.status === 'adopted') {
      const currentProjections = interactiveRepository.listVisualContextProjections(
        experienceId,
        project.id,
      ).filter((projection) => projection.status !== 'stale');
      if (currentProjections.length > 0) {
        return { plan, target: withNodeTargets(target!) };
      }
      const projected = attachInteractiveVisualProjections(experienceId, project);
      dbHelpers.saveProject(projected.project);
      interactiveRepository.replaceVisualContextProjections(
        experienceId,
        project.id,
        projected.projections,
      );
      return { plan, target: withNodeTargets(target!) };
    }
    if (plan.status !== 'candidate' || plan.sourceHash !== target!.sourceHash) {
      throw Object.assign(new Error('制片方案已过期，请重新准备'), { statusCode: 409 });
    }
    const profile = project.interactiveProductionPrepProfile!;
    const now = Date.now();
    const nextPlanVersions: ProductionScenePlanVersion[] = [...(project.productionScenePlans || [])];
    let nextEpisodes = [...project.episodes];
    for (const unit of plan.units) {
      const episode = nextEpisodes.find((item) => item.id === unit.episodeId);
      if (!episode) throw new Error('制片方案引用的工作单元不存在');
      const planVersionId = `production_scene_plan_${randomUUID()}`;
      const interactiveNodes = profile.nodes.filter((node) => node.sourceDocumentId === unit.sourceDocumentId);
      const scenes = productionScenesFromPlanCandidate(
        unit.sourceDocumentId,
        unit.scenes,
        planVersionId,
        interactiveNodes,
      );
      nextPlanVersions.splice(0, nextPlanVersions.length, ...nextPlanVersions.map((item) => (
        item.sourceDocumentId === unit.sourceDocumentId && item.status === 'adopted'
          ? { ...item, status: 'superseded' as const, supersededAt: now }
          : item
      )));
      nextPlanVersions.push({
        id: planVersionId,
        sourceDocumentId: unit.sourceDocumentId,
        sourceHash: plan.sourceHash,
        status: 'adopted',
        candidateScenes: unit.scenes,
        adoptedSceneSnapshot: scenes,
        replacedSceneSnapshot: (episode as Episode).scenes || [],
        promptAudit: {
          templateId: 'interactiveProductionPlan.exact-writing-scenes/v1',
          promptHash: createHash('sha256').update(JSON.stringify(unit.scenes)).digest('hex'),
          selectedSkillIds: [],
          selectedSkillTitles: [],
          selectedContextIds: [],
          createdAt: now,
        },
        adoptedAt: now,
      });
      nextEpisodes = nextEpisodes.map((item) => item.id === episode.id ? { ...item, scenes } : item);
    }
    const adopted = { ...plan, status: 'adopted' as const, updatedAt: now };
    const projected = attachInteractiveVisualProjections(experienceId, {
      ...project,
      episodes: nextEpisodes,
      productionScenePlans: nextPlanVersions,
      interactiveProductionPlanDrafts: (project.interactiveProductionPlanDrafts || [])
        .map((item) => item.id === plan.id ? adopted : item),
    });
    dbHelpers.saveProject(projected.project);
    interactiveRepository.replaceVisualContextProjections(
      experienceId,
      project.id,
      projected.projections,
    );
    return { plan: adopted, target: withNodeTargets(target!) };
  },

  rejectPlan(experienceId, planId) {
    const target = this.getTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const plan = project.interactiveProductionPlanDrafts?.find((item) => item.id === planId);
    if (!plan) throw Object.assign(new Error('制片方案不存在'), { statusCode: 404 });
    if (plan.status === 'adopted') throw Object.assign(new Error('已采用的制片方案不能放弃'), { statusCode: 409 });
    const rejected = { ...plan, status: 'rejected' as const, updatedAt: Date.now() };
    dbHelpers.saveProject({
      ...project,
      interactiveProductionPlanDrafts: (project.interactiveProductionPlanDrafts || [])
        .map((item) => item.id === plan.id ? rejected : item),
    });
    return rejected;
  },

  getLatestMediaPlan(experienceId) {
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectShellForExperience(experienceId, target);
    if (!project) return null;
    return [...(project.interactiveMediaPlanDrafts || [])]
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  },

  createMediaPlan(experienceId) {
    const target = this.getTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const aggregate = interactiveRepository.getExperience(experienceId);
    const nodeIds = aggregate.graph.nodes.filter(nodeRequiresMainContent).map((node) => node.id);
    const bindingByNodeId = new Map(
      aggregate.bindings
        .filter((binding) => binding.slot === 'main')
        .map((binding) => [binding.nodeId, binding]),
    );
    const expectedSlotsByNode = new Map(
      (project.interactiveProductionPrepProfile?.nodes || []).map((node) => [
        node.nodeId,
        (node.orderedContentSlots?.length ? node.orderedContentSlots.map((item) => item.slot) : ['main' as const]),
      ]),
    );
    const rejectedChecksumsBySelection = new Map<string, Set<string>>();
    const feedbackSelectionKey = (nodeId: string, scenarioId?: string) => `${nodeId}:${scenarioId || ''}`;
    for (const request of project.interactiveMediaFeedbackRequests || []) {
      const key = feedbackSelectionKey(request.nodeId, request.scenarioId);
      const checksums = rejectedChecksumsBySelection.get(key) || new Set<string>();
      request.rejectedTakeChecksums.forEach((checksum) => checksums.add(checksum));
      rejectedChecksumsBySelection.set(key, checksums);
    }
    const allProjections = interactiveRepository.listVisualContextProjections(experienceId, project.id);
    const currentProjectionIds = new Set(allProjections
      .filter((projection) => (
        projection.status !== 'stale'
        && projection.graphVersionId === aggregate.graph.id
        && projection.stateSchemaVersionId === aggregate.stateSchema.id
      ))
      .map((projection) => projection.id));
    const options: Array<{
      nodeId: string;
      scenarioId?: string;
      stateFingerprint?: string;
      reuseFingerprint?: string;
      label?: string;
      takes: InteractiveProductionMediaTakeOption[];
    }> = nodeIds.flatMap((nodeId) => {
      const allTakes = mediaTakesForNode({ target: target!, nodeId });
      const takesForScenario = (scenarioId?: string) => {
        const rejectedChecksums = new Set([
          ...(rejectedChecksumsBySelection.get(feedbackSelectionKey(nodeId)) || []),
          ...(rejectedChecksumsBySelection.get(feedbackSelectionKey(nodeId, scenarioId)) || []),
        ]);
        return allTakes.filter((take) => !rejectedChecksums.has(take.ref.checksum));
      };
      const expectedScenarios = new Map<string, {
        scenarioId: string;
        stateFingerprint: string;
        label: string;
        reuseFingerprint: string;
        requiredProductionSceneIds: Set<string>;
        currentProductionSceneIds: Set<string>;
      }>();
      const persistedSceneIds = persistedInteractiveSceneIdsForNode(project, nodeId);
      const persistedSceneIdSet = new Set(persistedSceneIds);
      const projectionBySceneId = new Map<string, InteractiveVisualContextProjection>();
      allProjections
        .filter((projection) => (
          projection.nodeIds.includes(nodeId)
          && (persistedSceneIdSet.size === 0 || persistedSceneIdSet.has(projection.productionSceneId))
        ))
        .forEach((projection) => {
          const existing = projectionBySceneId.get(projection.productionSceneId);
          if (!existing || (
            currentProjectionIds.has(projection.id)
            && !currentProjectionIds.has(existing.id)
          )) projectionBySceneId.set(projection.productionSceneId, projection);
        });
      [...projectionBySceneId.values()]
        .forEach((projection) => projection.scenarios.forEach((scenario) => {
          const projectionCurrent = currentProjectionIds.has(projection.id);
          const existingScenario = expectedScenarios.get(scenario.reuseFingerprint);
          expectedScenarios.set(scenario.reuseFingerprint, {
            scenarioId: scenario.id,
            stateFingerprint: scenario.stateFingerprint,
            label: scenario.label,
            reuseFingerprint: scenario.reuseFingerprint,
            requiredProductionSceneIds: new Set([
              ...(existingScenario?.requiredProductionSceneIds || []),
              projection.productionSceneId,
            ]),
            currentProductionSceneIds: new Set([
              ...(existingScenario?.currentProductionSceneIds || []),
              ...(projectionCurrent ? [projection.productionSceneId] : []),
            ]),
          });
        }));
      persistedVisualScenariosForNode(project, nodeId).forEach(({ sceneId, scenario }) => {
        const existingScenario = expectedScenarios.get(scenario.reuseFingerprint);
        expectedScenarios.set(scenario.reuseFingerprint, {
          scenarioId: existingScenario?.scenarioId || scenario.id,
          stateFingerprint: existingScenario?.stateFingerprint || scenario.stateFingerprint,
          label: existingScenario?.label || scenario.label,
          reuseFingerprint: existingScenario?.reuseFingerprint || scenario.reuseFingerprint,
          requiredProductionSceneIds: new Set([
            ...(existingScenario?.requiredProductionSceneIds || []),
            sceneId,
          ]),
          currentProductionSceneIds: new Set(existingScenario?.currentProductionSceneIds || []),
        });
      });
      persistedSceneIds.forEach((sceneId) => {
        if ([...expectedScenarios.values()].some((scenario) => (
          scenario.requiredProductionSceneIds.has(sceneId)
        ))) return;
        const refreshId = `visual_projection_refresh_required_${nodeId}_${sceneId}`;
        expectedScenarios.set(refreshId, {
          scenarioId: refreshId,
          stateFingerprint: refreshId,
          label: '画面状态来源待刷新',
          reuseFingerprint: refreshId,
          requiredProductionSceneIds: new Set([sceneId]),
          currentProductionSceneIds: new Set(),
        });
      });
      if (expectedScenarios.size === 0) {
        const previouslyAdoptedRefs = bindingByNodeId.get(nodeId)?.mediaTakeRefs || [];
        return [{
          nodeId,
          takes: selectPreferredMediaTakes(takesForScenario(), previouslyAdoptedRefs),
        }];
      }
      const allowLegacyUntaggedTake = expectedScenarios.size === 1;
      return [...expectedScenarios.values()].map((scenario) => {
        const {
          requiredProductionSceneIds,
          currentProductionSceneIds,
          ...scenarioContract
        } = scenario;
        const projectionCurrent = [...requiredProductionSceneIds]
          .every((sceneId) => currentProductionSceneIds.has(sceneId));
        const previouslyAdoptedRefs = bindingByNodeId.get(nodeId)?.mediaScenarios
          ?.find((candidate) => candidate.reuseFingerprint === scenario.reuseFingerprint)
          ?.mediaTakeRefs || [];
        const matchingTakes = projectionCurrent
          ? takesForScenario(scenario.scenarioId).filter((take) => (
              take.visualReuseFingerprint === scenario.reuseFingerprint
              || previouslyAdoptedRefs.some((ref) => sameArtifactRef(ref, take.ref))
              || (allowLegacyUntaggedTake && !take.visualReuseFingerprint)
            ))
          : [];
        return {
          nodeId,
          ...scenarioContract,
          takes: selectPreferredMediaTakes(matchingTakes, previouslyAdoptedRefs),
        };
      });
    });
    const currentFingerprint = JSON.stringify(options.map((item) => ({
      nodeId: item.nodeId,
      scenarioId: item.scenarioId,
      stateFingerprint: item.stateFingerprint,
      reuseFingerprint: item.reuseFingerprint,
      refs: item.takes.map((take) => `${take.contentSlot}:${take.mediaKind}:${take.ref.checksum}`),
    })));
    const existing = [...(project.interactiveMediaPlanDrafts || [])]
      .filter((plan) => plan.status === 'candidate' && plan.productionProjectId === project.id)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const existingFingerprint = existing && JSON.stringify(options.map((option) => {
      const selection = existing.selections.find((item) => (
        item.nodeId === option.nodeId
        && item.scenarioId === option.scenarioId
        && item.reuseFingerprint === option.reuseFingerprint
      ));
      return {
        nodeId: option.nodeId,
        scenarioId: option.scenarioId,
        stateFingerprint: option.stateFingerprint,
        reuseFingerprint: option.reuseFingerprint,
        refs: selection?.takeRefs.map((ref) => {
          const take = option.takes.find((candidate) => candidate.ref.checksum === ref.checksum);
          return take ? `${take.contentSlot}:${take.mediaKind}:${ref.checksum}` : ref.checksum;
        }) || [],
      };
    }));
    if (existing && existingFingerprint === currentFingerprint) return existing;
    const missingContentSlots = options.flatMap((item) => (
      (expectedSlotsByNode.get(item.nodeId) || ['main' as const])
        .filter((contentSlot) => !item.takes.some((take) => take.contentSlot === contentSlot))
        .map((contentSlot) => ({ nodeId: item.nodeId, scenarioId: item.scenarioId, contentSlot }))
    ));
    const plan: InteractiveMediaPlanDraft = {
      id: `interactive_media_plan_${randomUUID()}`,
      experienceId,
      productionProjectId: project.id,
      status: 'candidate',
      selections: options.filter((item) => item.takes.length > 0).map((item) => ({
        nodeId: item.nodeId,
        scenarioId: item.scenarioId,
        scenarioLabel: item.label,
        stateFingerprint: item.stateFingerprint,
        reuseFingerprint: item.reuseFingerprint,
        takeRefs: item.takes.map((take) => ({ ...take.ref, kind: 'media_take' as const })),
        labels: item.takes.map((take) => take.label),
      })),
      missingNodeIds: [...new Set(options.filter((item) => item.takes.length === 0).map((item) => item.nodeId))],
      missingScenarioIds: options
        .filter((item) => item.takes.length === 0 && item.scenarioId)
        .map((item) => item.scenarioId!),
      missingScenarios: options
        .filter((item) => item.takes.length === 0 && item.scenarioId)
        .map((item) => ({
          nodeId: item.nodeId,
          scenarioId: item.scenarioId!,
          label: item.label,
        })),
      missingContentSlots,
      estimatedDurationSeconds: options.reduce(
        (total, item) => total + item.takes.reduce((sum, take) => sum + take.durationSeconds, 0),
        0,
      ),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dbHelpers.saveProject({
      ...project,
      interactiveMediaPlanDrafts: [
        ...(project.interactiveMediaPlanDrafts || []).map((item) => (
          item.status === 'candidate' ? { ...item, status: 'stale' as const, updatedAt: Date.now() } : item
        )),
        plan,
      ],
    });
    return plan;
  },

  adoptMediaPlan(experienceId, planId) {
    const target = this.getTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const plan = project.interactiveMediaPlanDrafts?.find((item) => item.id === planId);
    if (!plan) throw Object.assign(new Error('视频方案不存在'), { statusCode: 404 });
    if (plan.status === 'adopted') {
      return { plan, aggregate: interactiveRepository.getExperience(experienceId) };
    }
    if (plan.status !== 'candidate' || plan.productionProjectId !== target!.productionProjectId) {
      throw Object.assign(new Error('视频方案已过期，请重新准备'), { statusCode: 409 });
    }
    if (plan.missingNodeIds.length) {
      throw Object.assign(new Error('仍有节点缺少可用画面，请先在制片中生成或选定画面'), { statusCode: 422 });
    }
    if (plan.missingContentSlots?.length) {
      throw Object.assign(new Error('仍有内容位置缺少可用画面，请先补齐进入、主体、选择等待或离开画面'), { statusCode: 422 });
    }
    if (plan.missingScenarioIds?.length) {
      throw Object.assign(new Error('仍有画面状态缺少可用媒体，请先补齐对应状态的画面'), { statusCode: 422 });
    }
    const aggregate = interactiveRepository.adoptMediaPlan(experienceId, plan.selections.map((selection) => ({
      nodeId: selection.nodeId,
      scenarioId: selection.scenarioId,
      stateFingerprint: selection.stateFingerprint,
      reuseFingerprint: selection.reuseFingerprint,
      takeRefs: selection.takeRefs,
    })));
    const adopted = { ...plan, status: 'adopted' as const, updatedAt: Date.now() };
    dbHelpers.saveProject({
      ...project,
      interactiveMediaPlanDrafts: (project.interactiveMediaPlanDrafts || [])
        .map((item) => item.id === plan.id ? adopted : item),
    });
    return { plan: adopted, aggregate };
  },

  requestMediaRevision(experienceId, planId, nodeId, feedback, scenarioId) {
    const target = this.getTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const plan = project.interactiveMediaPlanDrafts?.find((item) => item.id === planId);
    if (!plan) throw Object.assign(new Error('视频方案不存在'), { statusCode: 404 });
    if (plan.status !== 'candidate' || plan.productionProjectId !== target!.productionProjectId) {
      throw Object.assign(new Error('视频方案已过期，请重新查看'), { statusCode: 409 });
    }
    const nodeSelections = plan.selections.filter((item) => item.nodeId === nodeId);
    if (!scenarioId && nodeSelections.length > 1) {
      throw Object.assign(new Error('当前节点包含多个画面状态，请指定要返修的状态'), { statusCode: 422 });
    }
    const selection = nodeSelections.find((item) => (
      scenarioId ? item.scenarioId === scenarioId : true
    ));
    if (!selection) throw Object.assign(new Error('当前节点没有可返修的视频方案'), { statusCode: 422 });
    const availableTakes = mediaTakesForNode({ target: target!, nodeId });
    const selectedTakes = availableTakes.filter((take) => (
      selection.takeRefs.some((ref) => sameArtifactRef(ref, take.ref))
    ));
    const rejectedTakeChecksums = availableTakes
      .filter((take) => selectedTakes.some((selectedTake) => (
        selectedTake.productionSceneId === take.productionSceneId
        && selectedTake.shotId === take.shotId
        && (
          sameArtifactRef(selectedTake.ref, take.ref)
          || take.visualReuseFingerprint === selection.reuseFingerprint
          || (!selectedTake.visualReuseFingerprint && !take.visualReuseFingerprint)
        )
      )))
      .map((take) => take.ref.checksum);
    const now = Date.now();
    const request: InteractiveMediaFeedbackRequest = {
      id: `interactive_media_feedback_${randomUUID()}`,
      nodeId,
      scenarioId: selection.scenarioId,
      feedback,
      rejectedTakeChecksums,
      createdAt: now,
    };
    dbHelpers.saveProject({
      ...project,
      interactiveMediaPlanDrafts: (project.interactiveMediaPlanDrafts || []).map((item) => (
        item.id === plan.id ? { ...item, status: 'stale' as const, updatedAt: now } : item
      )),
      interactiveMediaFeedbackRequests: [
        ...(project.interactiveMediaFeedbackRequests || []),
        request,
      ],
      updatedAt: now,
    });
    return this.createMediaPlan(experienceId);
  },

  getLatestVisualRefinement(experienceId, productionSceneId, visualScenarioId) {
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    return [...(project.interactiveVisualRefinementDrafts || [])]
      .filter((draft) => (
        draft.productionSceneId === productionSceneId
        && draft.visualScenarioId === visualScenarioId
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  },

  async createVisualRefinement(experienceId, input) {
    if (!visualRefinementGenerator) {
      throw Object.assign(new Error('AI 画面建议服务暂不可用'), { statusCode: 503 });
    }
    const finalPrompt = input.finalPrompt.trim();
    if (!finalPrompt) {
      throw Object.assign(new Error('请先确认给 AI 的意见'), { statusCode: 400 });
    }
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const projection = interactiveRepository.listVisualContextProjections(experienceId, project.id)
      .find((candidate) => (
        candidate.productionSceneId === input.productionSceneId
        && candidate.status !== 'stale'
      ));
    const scenario = projection?.scenarios.find((candidate) => candidate.id === input.visualScenarioId);
    if (!projection || !scenario) {
      throw Object.assign(new Error('当前画面状态已经变化，请刷新后重试'), { statusCode: 409 });
    }
    const sceneExists = project.episodes.some((episode) => (
      ((episode as Episode).scenes || []).some((scene) => scene.id === input.productionSceneId)
    ));
    if (!sceneExists) {
      throw Object.assign(new Error('当前制片场次已经变化，请返回白板重新进入'), { statusCode: 409 });
    }
    const promptHash = createHash('sha256').update(finalPrompt).digest('hex');
    const existing = [...(project.interactiveVisualRefinementDrafts || [])]
      .filter((draft) => (
        draft.status === 'candidate'
        && draft.productionSceneId === input.productionSceneId
        && draft.visualScenarioId === input.visualScenarioId
        && draft.sourceFingerprint === projection.sourceFingerprint
        && draft.promptAudit.promptHash === promptHash
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (existing) return existing;

    const generated = await visualRefinementGenerator({
      prompt: finalPrompt,
      systemInstruction: [
        '你是互动影视的表演与环境连续性导演。',
        '只能提出观众可见的环境变化和人物表演约束，不得创建新角色、新地点、新道具或暴露内部变量。',
      ].join('\n'),
    });
    const generatedProposal = visualRefinementProposalFrom(generated, scenario.label);
    const proposal: InteractiveVisualRefinementDraft['proposal'] = {
      ...generatedProposal,
      environmentChanges: [...new Set([
        ...scenario.environmentChanges,
        ...generatedProposal.environmentChanges,
      ])],
      performanceConstraints: [...new Set([
        ...scenario.performanceConstraints,
        ...generatedProposal.performanceConstraints,
      ])],
    };
    const latestTarget = interactiveRepository.getProductionPrepTarget(experienceId);
    const latestProject = productionProjectForExperience(experienceId, latestTarget);
    const latestProjection = interactiveRepository.listVisualContextProjections(experienceId, latestProject.id)
      .find((candidate) => (
        candidate.id === projection.id
        && candidate.productionSceneId === input.productionSceneId
        && candidate.status !== 'stale'
      ));
    const latestScenario = latestProjection?.scenarios.find((candidate) => candidate.id === input.visualScenarioId);
    if (
      latestProject.id !== project.id
      || !latestProjection
      || latestProjection.sourceFingerprint !== projection.sourceFingerprint
      || !latestScenario
      || JSON.stringify(latestScenario) !== JSON.stringify(scenario)
      || !latestProject.episodes.some((episode) => (
        ((episode as Episode).scenes || []).some((scene) => scene.id === input.productionSceneId)
      ))
    ) {
      throw Object.assign(new Error('等待 AI 时画面来源已更新，请基于最新版本重新生成'), { statusCode: 409 });
    }
    const concurrentCandidate = [...(latestProject.interactiveVisualRefinementDrafts || [])]
      .filter((draft) => (
        draft.status === 'candidate'
        && draft.productionSceneId === input.productionSceneId
        && draft.visualScenarioId === input.visualScenarioId
        && draft.sourceFingerprint === latestProjection.sourceFingerprint
        && draft.promptAudit.promptHash === promptHash
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (concurrentCandidate) return concurrentCandidate;
    const timestamp = Date.now();
    const draft: InteractiveVisualRefinementDraft = {
      id: `interactive_visual_refinement_${randomUUID()}`,
      experienceId,
      productionProjectId: latestProject.id,
      productionSceneId: input.productionSceneId,
      visualProjectionId: latestProjection.id,
      visualScenarioId: input.visualScenarioId,
      sourceFingerprint: latestProjection.sourceFingerprint,
      projectionSnapshotHash: createHash('sha256').update(JSON.stringify(latestProjection)).digest('hex'),
      status: 'candidate',
      proposal,
      promptAudit: {
        templateId: 'interactiveVisualRefinement/v1',
        promptHash,
        selectedSkillIds: [...new Set(input.selectedSkillIds || [])],
        selectedSkillTitles: [...new Set(input.selectedSkillTitles || [])],
        selectedContextIds: [...new Set(input.selectedContextIds || [])],
        createdAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    dbHelpers.updateProjectMeta(latestProject.id, {
      interactiveVisualRefinementDrafts: [
        ...(latestProject.interactiveVisualRefinementDrafts || []).map((item) => (
          item.status === 'candidate'
          && item.productionSceneId === input.productionSceneId
          && item.visualScenarioId === input.visualScenarioId
            ? { ...item, status: 'stale' as const, updatedAt: timestamp }
            : item
        )),
        draft,
      ],
      updatedAt: timestamp,
    });
    return draft;
  },

  adoptVisualRefinement(experienceId, draftId) {
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const draft = project.interactiveVisualRefinementDrafts?.find((item) => item.id === draftId);
    if (!draft) throw Object.assign(new Error('画面建议不存在'), { statusCode: 404 });
    if (draft.status === 'rejected' || draft.status === 'stale') {
      throw Object.assign(new Error('画面建议已经失效，请重新生成'), { statusCode: 409 });
    }
    const projection = interactiveRepository.adoptVisualContextRefinement(experienceId, {
      projectionId: draft.visualProjectionId,
      productionSceneId: draft.productionSceneId,
      visualScenarioId: draft.visualScenarioId,
      sourceFingerprint: draft.sourceFingerprint,
      projectionSnapshotHash: draft.projectionSnapshotHash,
      label: draft.proposal.label,
      environmentChanges: draft.proposal.environmentChanges,
      performanceConstraints: draft.proposal.performanceConstraints,
    });
    const refreshed = productionProjectForExperience(
      experienceId,
      interactiveRepository.getProductionPrepTarget(experienceId),
    );
    const timestamp = Date.now();
    const adopted = { ...draft, status: 'adopted' as const, updatedAt: timestamp };
    const projectedProject = applyVisualProjectionToProject(refreshed, projection);
    dbHelpers.saveProject({
      ...projectedProject,
      interactiveVisualRefinementDrafts: (projectedProject.interactiveVisualRefinementDrafts || [])
        .map((item) => item.id === draft.id
          ? adopted
          : item.status === 'candidate'
            && item.productionSceneId === draft.productionSceneId
            && item.visualScenarioId === draft.visualScenarioId
            ? { ...item, status: 'stale' as const, updatedAt: timestamp }
            : item),
      updatedAt: timestamp,
    });
    return { draft: adopted, projection };
  },

  rejectVisualRefinement(experienceId, draftId) {
    const target = interactiveRepository.getProductionPrepTarget(experienceId);
    const project = productionProjectForExperience(experienceId, target);
    const draft = project.interactiveVisualRefinementDrafts?.find((item) => item.id === draftId);
    if (!draft) throw Object.assign(new Error('画面建议不存在'), { statusCode: 404 });
    if (draft.status === 'adopted') {
      throw Object.assign(new Error('已采用的画面建议不能放弃'), { statusCode: 409 });
    }
    const rejected = { ...draft, status: 'rejected' as const, updatedAt: Date.now() };
    dbHelpers.saveProject({
      ...project,
      interactiveVisualRefinementDrafts: (project.interactiveVisualRefinementDrafts || [])
        .map((item) => item.id === draft.id ? rejected : item),
      updatedAt: rejected.updatedAt,
    });
    return rejected;
  },

  resolveRuntimeMediaManifest(experienceId, runtimeBuildId): InteractiveRuntimeMediaManifest {
    const build = runtimeBuildId
      ? interactiveRepository.getRuntimeBuild(experienceId, runtimeBuildId)
      : interactiveRepository.getLatestRuntimeBuild(experienceId);
    if (!build) {
      throw Object.assign(new Error('请先开始试玩，再装配播放器媒体。'), { statusCode: 422 });
    }
    if (build.status === 'stale') {
      throw Object.assign(new Error(build.staleReason || '本次试玩内容已更新，请重新开始。'), { statusCode: 409 });
    }
    if (build.status !== 'ready_for_player') {
      throw Object.assign(new Error('当前试玩仍缺已确认的画面，不能进入播放器。'), { statusCode: 422 });
    }
    const nodes = build.nodeManifests.map((nodeManifest) => {
      const resolveClips = (refs: typeof nodeManifest.mediaTakeRefs): InteractiveRuntimeMediaClip[] => refs.map((ref) => {
        const playback = nodeManifest.mediaPlaybackSnapshots?.find((item) => sameArtifactRef(item.ref, ref));
        if (!playback) {
          throw Object.assign(new Error('此旧试玩没有保存完整播放参数，无法保证按原版本播放。请重新创建试玩；已导出的独立文件不受影响。'), { statusCode: 409 });
        }
        const take = resolveProductionMediaTake(ref, nodeManifest.nodeId);
        if (!take) {
          throw Object.assign(
            new Error(`节点“${nodeManifest.title}”采用的画面已经变更或不再可用。请回到制片确认后重新开始试玩。`),
            { statusCode: 409 },
          );
        }
        if (!take.url || !Number.isFinite(playback.durationSeconds) || playback.durationSeconds <= 0) {
          throw Object.assign(new Error(`节点“${nodeManifest.title}”采用的画面缺少可播放时长。`), { statusCode: 422 });
        }
        // Active here means selected by this build, not the current Studio head.
        return { ...take, ...playback, isActive: true, url: take.url };
      });
      const clips = resolveClips(nodeManifest.mediaTakeRefs);
      const scenarios = nodeManifest.mediaScenarios?.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        label: scenario.label,
        entryPredicate: scenario.entryPredicate,
        reuseFingerprint: scenario.reuseFingerprint,
        clips: resolveClips(scenario.mediaTakeRefs),
      }));
      return { nodeId: nodeManifest.nodeId, clips, scenarios };
    });

    return { buildId: build.id, experienceId, nodes };
  },
});
