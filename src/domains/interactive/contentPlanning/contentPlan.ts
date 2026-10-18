import type { InteractiveWritingSceneOption } from '../ports/writingPort';
import type {
  ArtifactRef,
  InteractiveExperienceAggregate,
  NarrativeGraphVersion,
  NodeContentBinding,
} from '../types/schema';
import { nodeRequiresMainContent } from '../nodeContentRequirements';
import { artifactRefIdentity, hasDuplicateArtifactRefs } from '../binding/nodeContentBinding';

export type InteractiveContentPlanMode = 'no_content' | 'reuse_existing' | 'create_or_revise';
export type InteractiveContentPlanStatus = 'candidate' | 'adopted' | 'rejected' | 'stale';
export type InteractiveContentWritingRequestKind = 'write_missing_branch' | 'split_scene' | 'revise_scene';

export interface InteractiveContentWritingRequest {
  kind: InteractiveContentWritingRequestKind;
  dramaticPurpose: string;
  requiredFacts: string[];
  prohibitedRevelations: string[];
  desiredDurationSec: number;
  sourceSceneArtifactIds: string[];
}

export interface InteractiveContentPlanSlot {
  slot: NodeContentBinding['slot'];
  orderedSceneRefs: ArtifactRef[];
  /** Facts the planner verified this content reveals to the player. */
  revealedFactIds?: string[];
  writingRequest?: InteractiveContentWritingRequest;
  fitRationale?: string;
}

export interface InteractiveContentPlanItem {
  nodeId: string;
  mode: InteractiveContentPlanMode;
  slots: InteractiveContentPlanSlot[];
  reuseGroupId?: string;
  compatibilityRationale?: string;
  estimatedDurationSec: number;
}

export interface InteractiveContentPlanDraft {
  id: string;
  experienceId: string;
  baseGraphVersionId: string;
  baseWritingProjectId?: string;
  baseWritingRevision?: number;
  baseBindingVersionByNodeId: Record<string, number>;
  authorIntent: string;
  items: InteractiveContentPlanItem[];
  impact: {
    newWritingSceneCount: number;
    reusedWritingSceneCount: number;
    affectedNodeCount: number;
    staleProductionSceneIds: string[];
    staleMediaTakeCount: number;
  };
  qa: {
    blocking: string[];
    warnings: string[];
  };
  status: InteractiveContentPlanStatus;
  createdAt: string;
  updatedAt: string;
}

const refKey = (ref: ArtifactRef) => artifactRefIdentity(ref);

const storyPositionFromTitle = (title: string): [number, number] | null => {
  const match = title.match(/(?:场景|场次)\s*(\d+)\s*[-－—.]\s*(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
};

const sceneMovesBackwardOrRepeats = (
  source: InteractiveWritingSceneOption,
  target: InteractiveWritingSceneOption,
) => {
  const sourceStoryPosition = storyPositionFromTitle(source.sceneTitle);
  const targetStoryPosition = storyPositionFromTitle(target.sceneTitle);
  if (sourceStoryPosition && targetStoryPosition) {
    const sourceOrder = sourceStoryPosition[0] * 10_000 + sourceStoryPosition[1];
    const targetOrder = targetStoryPosition[0] * 10_000 + targetStoryPosition[1];
    return targetOrder <= sourceOrder;
  }
  return source.unitId === target.unitId && target.sceneIndex <= source.sceneIndex;
};

export const validateInteractiveContentPlan = ({
  draft,
  graph,
  scenes,
}: {
  draft: InteractiveContentPlanDraft;
  graph: NarrativeGraphVersion;
  scenes: InteractiveWritingSceneOption[];
}) => {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const planNodeIds = new Set<string>();
  const sceneByRef = new Map(scenes.map((scene) => [refKey(scene.ref), scene]));
  const knownSceneArtifactIds = new Set(scenes.map((scene) => scene.ref.artifactId));
  const knownStoryFacts = new Set(graph.nodes.flatMap((node) => [
    ...node.contract.requiredFacts,
    ...node.contract.producedFacts,
    ...node.interaction.playerKnowledgeIn,
    ...node.interaction.playerKnowledgeOut,
  ]));
  const reusedByRef = new Map<string, InteractiveContentPlanItem[]>();

  for (const item of draft.items) {
    if (!graphNodeIds.has(item.nodeId)) {
      blocking.push(`内容方案引用了不存在的节点：${item.nodeId}`);
      continue;
    }
    if (planNodeIds.has(item.nodeId)) {
      blocking.push(`节点“${item.nodeId}”在内容方案中重复出现`);
      continue;
    }
    planNodeIds.add(item.nodeId);

    const node = graph.nodes.find((candidate) => candidate.id === item.nodeId)!;
    const requiresContent = nodeRequiresMainContent(node);
    const mainSlots = item.slots.filter((slot) => slot.slot === 'main');
    if (mainSlots.length > 1) blocking.push(`节点“${node.brief.title}”存在重复的主要内容安排`);

    if (!requiresContent) {
      if (item.mode !== 'no_content' || item.slots.some((slot) => slot.orderedSceneRefs.length > 0)) {
        blocking.push(`节点“${node.brief.title}”只负责故事跳转或记录进度，不应安排剧本场次`);
      }
      continue;
    }

    if (item.mode === 'no_content') {
      blocking.push(`节点“${node.brief.title}”会播放故事，但方案没有为它安排内容`);
      continue;
    }

    const main = mainSlots[0];
    if (!main) {
      blocking.push(`节点“${node.brief.title}”缺少主要故事内容安排`);
      continue;
    }
    const revealedFactIds = main.revealedFactIds || [];
    const unknownRevealedFacts = revealedFactIds.filter((fact) => !knownStoryFacts.has(fact));
    if (unknownRevealedFacts.length) {
      blocking.push(`节点“${node.brief.title}”的内容方案声称揭示了未定义的故事信息：${unknownRevealedFacts.join('、')}`);
    }
    const allowedRevelations = new Set([
      ...node.contract.requiredFacts,
      ...node.contract.producedFacts,
      ...node.interaction.playerKnowledgeIn,
      ...node.interaction.playerKnowledgeOut,
    ]);
    const prematureRevelations = revealedFactIds.filter((fact) => (
      knownStoryFacts.has(fact) && !allowedRevelations.has(fact)
    ));
    if (prematureRevelations.length) {
      blocking.push(`节点“${node.brief.title}”会提前泄露后续故事信息：${prematureRevelations.join('、')}`);
    }
    if (item.mode === 'create_or_revise' && main.orderedSceneRefs.length === 0) {
      if (!main.writingRequest?.dramaticPurpose.trim()) {
        blocking.push(`节点“${node.brief.title}”需要补写，但没有给 Writing 明确的创作请求`);
      }
      if (main.writingRequest?.kind === 'split_scene' && main.writingRequest.sourceSceneArtifactIds.length === 0) {
        blocking.push(`节点“${node.brief.title}”需要拆分现有场次，但没有指出要拆分的场次`);
      }
      const unknownSourceSceneId = main.writingRequest?.sourceSceneArtifactIds
        .find((artifactId) => !knownSceneArtifactIds.has(artifactId));
      if (unknownSourceSceneId) {
        blocking.push(`节点“${node.brief.title}”请求处理的源场次已经不存在：${unknownSourceSceneId}`);
      }
      const prohibitedLeak = main.writingRequest?.prohibitedRevelations
        .filter((fact) => revealedFactIds.includes(fact)) || [];
      if (prohibitedLeak.length) {
        blocking.push(`节点“${node.brief.title}”的补写方案会提前泄露明确禁止的信息：${prohibitedLeak.join('、')}`);
      }
      continue;
    }
    if (main.orderedSceneRefs.length === 0) {
      blocking.push(`节点“${node.brief.title}”没有可采用的剧本场次`);
      continue;
    }
    if (hasDuplicateArtifactRefs(main.orderedSceneRefs)) {
      blocking.push(`节点“${node.brief.title}”重复安排了同一个剧本场次`);
    }
    if (main.orderedSceneRefs.some((ref) => ref.kind !== 'script_scene')) {
      blocking.push(`节点“${node.brief.title}”包含不是剧本场次的内容引用`);
    }

    const resolved = main.orderedSceneRefs.map((ref) => sceneByRef.get(refKey(ref)));
    if (resolved.some((scene) => !scene)) {
      blocking.push(`节点“${node.brief.title}”引用了当前剧本中不存在或已经变化的场次`);
      continue;
    }
    const exactScenes = resolved as InteractiveWritingSceneOption[];
    if (new Set(exactScenes.map((scene) => scene.writingProjectId)).size !== 1
      || new Set(exactScenes.map((scene) => scene.writingProjectRevision)).size !== 1) {
      blocking.push(`节点“${node.brief.title}”的场次必须来自同一版剧本`);
    }
    if (new Set(exactScenes.map((scene) => scene.unitId)).size !== 1) {
      blocking.push(`节点“${node.brief.title}”跨越了剧本单元，应先让 AI 拆分节点`);
    }
    if (!(main.fitRationale || '').trim()) {
      blocking.push(`节点“${node.brief.title}”缺少剧本内容与故事目标的匹配说明`);
    }
    const availableKnowledge = new Set([
      ...node.interaction.playerKnowledgeIn,
      ...node.contract.requiredFacts,
    ]);
    const missingChoiceKnowledge = node.choices.flatMap((choice) => {
      const target = graph.nodes.find((candidate) => candidate.id === choice.targetNodeId);
      if (!target) return [];
      return target.contract.requiredFacts.filter((fact) =>
        !availableKnowledge.has(fact) && !node.interaction.playerKnowledgeOut.includes(fact)
      );
    });
    if (missingChoiceKnowledge.length) {
      blocking.push(`节点“${node.brief.title}”给出选择前缺少必要故事信息：${[...new Set(missingChoiceKnowledge)].join('、')}`);
    }
    const evidenceText = `${main.fitRationale || ''} ${exactScenes.map((scene) => scene.synopsis).join(' ')}`;
    const uncoveredFacts = node.contract.requiredFacts.filter((fact) => !evidenceText.includes(fact));
    if (uncoveredFacts.length) {
      warnings.push(`节点“${node.brief.title}”的内容说明尚未逐项证明这些必要事实：${uncoveredFacts.join('、')}`);
    }

    const estimatedDuration = exactScenes.reduce(
      (total, scene) => total + (scene.targetDurationSeconds || 60),
      0,
    );
    const [minimum, maximum] = node.interaction.durationRangeSec;
    if (estimatedDuration < minimum * 0.5 || estimatedDuration > maximum * 2) {
      blocking.push(`节点“${node.brief.title}”的剧本约 ${estimatedDuration} 秒，无法满足该节点 ${minimum}-${maximum} 秒的播放合同；请让 AI 拆分、补写或重新匹配场次`);
    } else if (estimatedDuration < minimum * 0.7 || estimatedDuration > maximum * 1.3) {
      warnings.push(`节点“${node.brief.title}”的内容约 ${estimatedDuration} 秒，与目标时长 ${minimum}-${maximum} 秒偏差较大`);
    }

    for (const ref of main.orderedSceneRefs) {
      const key = refKey(ref);
      reusedByRef.set(key, [...(reusedByRef.get(key) || []), item]);
    }
  }

  for (const node of graph.nodes) {
    if (!planNodeIds.has(node.id)) blocking.push(`内容方案遗漏了节点“${node.brief.title}”`);
  }

  const plannedScenes = new Map(draft.items.map((item) => [
    item.nodeId,
    item.slots.find((slot) => slot.slot === 'main')?.orderedSceneRefs
      .map((ref) => sceneByRef.get(refKey(ref)))
      .filter((scene): scene is InteractiveWritingSceneOption => Boolean(scene)) || [],
  ]));
  for (const source of graph.nodes) {
    const sourceScenes = plannedScenes.get(source.id) || [];
    const sourceLast = sourceScenes[sourceScenes.length - 1];
    if (!sourceLast) continue;
    for (const choice of source.choices) {
      const target = graph.nodes.find((node) => node.id === choice.targetNodeId);
      const targetFirst = (plannedScenes.get(choice.targetNodeId) || [])[0];
      if (!target || !targetFirst) continue;
      if (sceneMovesBackwardOrRepeats(sourceLast, targetFirst)) {
        blocking.push(`从“${source.brief.title}”前往“${target.brief.title}”时，剧本场次顺序发生倒退或重复，应让 AI 重新安排或补写`);
      }
    }
  }

  for (const items of reusedByRef.values()) {
    const nodeIds = new Set(items.map((item) => item.nodeId));
    if (nodeIds.size < 2) continue;
    const endingCount = items.filter((item) => (
      graph.nodes.find((candidate) => candidate.id === item.nodeId)?.brief.dramaticFunction === 'ending'
    )).length;
    if (endingCount > 1) {
      blocking.push('不同结局不能复用同一个剧本场次，应让 AI 为每个结局补写各自的兑现内容');
    }
    if (
      items.some((item) => !item.reuseGroupId)
      || new Set(items.map((item) => item.reuseGroupId)).size !== 1
      || items.some((item) => (item.compatibilityRationale || '').trim().length < 8)
    ) {
      blocking.push(`复用同一场次的 ${nodeIds.size} 个节点缺少明确的故事状态兼容说明`);
    }
    const stateSignatures = items.map((item) => {
      const node = graph.nodes.find((candidate) => candidate.id === item.nodeId)!;
      return JSON.stringify({
        requiredFacts: [...node.contract.requiredFacts].sort(),
        readVariables: [...node.contract.readVariables].sort(),
        playerKnowledgeIn: [...node.interaction.playerKnowledgeIn].sort(),
      });
    });
    if (new Set(stateSignatures).size > 1) {
      blocking.push(`复用同一场次的 ${nodeIds.size} 个节点进入时故事状态不同，不能仅凭文字理由直接复用`);
    }
  }

  return {
    blocking: [...new Set(blocking)],
    warnings: [...new Set(warnings)],
  };
};

export const contentPlanAdoptable = (draft: InteractiveContentPlanDraft) =>
  draft.status === 'candidate'
  && draft.qa.blocking.length === 0
  && draft.items.every((item) => (
    item.mode === 'no_content'
    || item.slots.some((slot) => slot.slot === 'main' && slot.orderedSceneRefs.length > 0)
  ));

export const contentPlanMatchesWritingSource = (
  draft: InteractiveContentPlanDraft,
  scenes: InteractiveWritingSceneOption[],
) => {
  const current = scenes[0];
  return Boolean(
    current
    && draft.baseWritingProjectId === current.writingProjectId
    && draft.baseWritingRevision === current.writingProjectRevision
  );
};

export const bindingsForContentPlanAdoption = (
  draft: InteractiveContentPlanDraft,
  aggregate: InteractiveExperienceAggregate,
  adoptedAt = new Date().toISOString(),
): NodeContentBinding[] => draft.items.flatMap((item): NodeContentBinding[] => {
  if (item.mode === 'no_content') return [];
  const main = item.slots.find((slot) => slot.slot === 'main');
  if (!main?.orderedSceneRefs.length) return [];
  const existing = aggregate.bindings.find((binding) => (
    binding.nodeId === item.nodeId && binding.slot === 'main'
  ));
  return [{
    ...existing,
    nodeId: item.nodeId,
    slot: 'main',
    status: 'approved',
    scriptSceneRefs: main.orderedSceneRefs,
    checksum: main.orderedSceneRefs.map((ref) => ref.checksum).join(':'),
    // Visual compatibility is decided later from the persisted reachable-state
    // projection. Player knowledge is narrative context, not a media signature.
    visibleStateSignature: undefined,
    reusePolicy: item.reuseGroupId ? 'compatible_states_only' : 'exclusive',
    adoption: { proposalId: draft.id, adoptedAt },
    lockedAt: adoptedAt,
    contentFitReview: {
      verdict: 'pass',
      rationale: main.fitRationale
        || item.compatibilityRationale
        || 'AI 已检查这些场次与当前节点的故事目标、播放顺序和玩家已知信息。',
      reviewedAt: adoptedAt,
      sceneChecksums: main.orderedSceneRefs.map((ref) => ref.checksum),
    },
  }];
});
