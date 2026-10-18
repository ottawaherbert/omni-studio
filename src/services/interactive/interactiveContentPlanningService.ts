import { randomUUID } from 'node:crypto';

import type { InteractiveWritingSceneOption } from '../../domains/interactive/ports/writingPort';
import type {
  InteractiveExperienceAggregate,
  NarrativeGraphVersion,
  NarrativeNode,
  NodeContentBinding,
} from '../../domains/interactive/types/schema';
import { nodeRequiresMainContent } from '../../domains/interactive/nodeContentRequirements';
import {
  artifactRefListEquals,
  bindingMediaTakeRefs,
  bindingScriptSceneRefs,
} from '../../domains/interactive/binding/nodeContentBinding';
import {
  type InteractiveContentPlanDraft,
  type InteractiveContentPlanItem,
  type InteractiveContentPlanMode,
  type InteractiveContentWritingRequestKind,
  validateInteractiveContentPlan,
} from '../../domains/interactive/contentPlanning/contentPlan';
import type { GraphDraftGenerator } from './interactiveGraphAuthoringService';

type GeneratedPlanItem = {
  nodeId?: unknown;
  mode?: unknown;
  sceneArtifactIds?: unknown;
  reuseGroupId?: unknown;
  compatibilityRationale?: unknown;
  fitRationale?: unknown;
  revealedFactIds?: unknown;
  writingRequest?: unknown;
};

const coreStoryTitle = (title: string) =>
  title.replace(/【[^】]+】/g, '').replace(/^(?:场景|场次)\s*\d+(?:\s*[-－—.]\s*\w+)?\s*[：:]\s*/, '').trim();

const recoverExactExistingSceneMatches = (
  items: GeneratedPlanItem[],
  nodes: NarrativeNode[],
  scenes: InteractiveWritingSceneOption[],
) => {
  const claimedSceneIds = new Set(items.flatMap((item) => (
    item.mode === 'reuse_existing' ? stringArray(item.sceneArtifactIds) : []
  )));
  return items.map((item) => {
    if (item.mode !== 'create_or_revise' || stringArray(item.sceneArtifactIds).length > 0) return item;
    const node = nodes.find((candidate) => candidate.id === item.nodeId);
    if (!node) return item;
    const coreTitle = coreStoryTitle(node.brief.title);
    if (coreTitle.length < 4) return item;
    const scene = scenes.find((candidate) => (
      !claimedSceneIds.has(candidate.ref.artifactId)
      && (
        coreStoryTitle(candidate.sceneTitle).includes(coreTitle)
        || candidate.synopsis.includes(coreTitle)
      )
    ));
    if (!scene) return item;
    claimedSceneIds.add(scene.ref.artifactId);
    return {
      ...item,
      mode: 'reuse_existing',
      sceneArtifactIds: [scene.ref.artifactId],
      fitRationale: `“${scene.sceneTitle}”已经完整呈现“${node.brief.title}”，无需重复补写。`,
      writingRequest: undefined,
    };
  });
};

export const fallbackContentPlanItems = (
  graph: NarrativeGraphVersion,
  _scenes: InteractiveWritingSceneOption[],
): GeneratedPlanItem[] => {
  return graph.nodes.map((node): GeneratedPlanItem => !nodeRequiresMainContent(node) ? {
    nodeId: node.id,
    mode: 'no_content',
    sceneArtifactIds: [],
  } : {
    nodeId: node.id,
    mode: 'create_or_revise',
    sceneArtifactIds: [],
    writingRequest: {
      kind: 'write_missing_branch',
      dramaticPurpose: node.brief.intent || node.brief.narrativeSummary,
      requiredFacts: node.contract.requiredFacts,
      prohibitedRevelations: [],
      desiredDurationSec: Math.round((node.interaction.durationRangeSec[0] + node.interaction.durationRangeSec[1]) / 2),
      sourceSceneArtifactIds: [],
    },
    revealedFactIds: node.interaction.playerKnowledgeOut,
  });
};

const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];

const writingRequestFor = (
  value: unknown,
  node: NarrativeNode,
  knownSceneArtifactIds: Set<string>,
) => {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const requestedKind = raw.kind;
  const kind: InteractiveContentWritingRequestKind = requestedKind === 'split_scene'
    || requestedKind === 'revise_scene'
    || requestedKind === 'write_missing_branch'
    ? requestedKind
    : 'write_missing_branch';
  const sourceSceneArtifactIds = stringArray(raw.sourceSceneArtifactIds)
    .filter((artifactId) => knownSceneArtifactIds.has(artifactId));
  return {
    kind,
    dramaticPurpose: typeof raw.dramaticPurpose === 'string' && raw.dramaticPurpose.trim()
      ? raw.dramaticPurpose.trim()
      : node.brief.intent || node.brief.narrativeSummary,
    requiredFacts: stringArray(raw.requiredFacts).length
      ? stringArray(raw.requiredFacts)
      : [...node.contract.requiredFacts],
    prohibitedRevelations: stringArray(raw.prohibitedRevelations),
    desiredDurationSec: Number.isFinite(Number(raw.desiredDurationSec))
      ? Math.max(1, Math.round(Number(raw.desiredDurationSec)))
      : Math.round((node.interaction.durationRangeSec[0] + node.interaction.durationRangeSec[1]) / 2),
    sourceSceneArtifactIds,
  };
};

const modeFor = (value: unknown): InteractiveContentPlanMode => {
  if (value === 'no_content' || value === 'reuse_existing' || value === 'create_or_revise') return value;
  throw new Error(`AI 内容方案返回了未知处理方式：${String(value)}`);
};

const currentMainBinding = (bindings: NodeContentBinding[], nodeId: string) =>
  bindings.find((binding) => binding.nodeId === nodeId && binding.slot === 'main');

export class InteractiveContentPlanningService {
  constructor(private readonly generate: GraphDraftGenerator) {}

  async generateDraft({
    aggregate,
    scenes,
    authorIntent,
  }: {
    aggregate: InteractiveExperienceAggregate;
    scenes: InteractiveWritingSceneOption[];
    authorIntent: string;
  }): Promise<InteractiveContentPlanDraft> {
    const nodes = aggregate.graph.nodes;
    const sceneByArtifactId = new Map(scenes.map((scene) => [scene.ref.artifactId, scene]));
    const knownNodeIds = new Set(nodes.map((node) => node.id));
    let generatedItems: GeneratedPlanItem[] | undefined;
    let fallbackWarning = '';

    for (let attempt = 0; attempt < 3 && !generatedItems; attempt += 1) {
      try {
        const response = await this.generate({
          systemInstruction: [
            '你是互动影视的内容编排 AI。',
            '你要一次覆盖全部节点，而不是逐节点让作者选择内容。',
            '纯跳转、汇流、检查点节点使用 no_content。',
            '一个节点可以按顺序播放多个同一剧本单元内的场次。',
            '多个节点可以复用场次，但必须给出 reuseGroupId 和状态兼容理由。',
            '必须按每条玩家路径检查剧本时间顺序：后续节点不能倒退到更早场次，也不能重复播放上一节点已经播放的场次。',
            '分支节点只有在故事事件、玩家所得信息和结果确实相同时才可复用；仅仅人物或关键词相同不算可复用。',
            '结局节点必须播放真正兑现该结局的场次。现有剧本只写出一个分支或结局时，其他分支必须使用 create_or_revise 请求 Writing 补写，禁止拿铺垫场次冒充结局。',
            '已有场次不适合时使用 create_or_revise 并给 Writing 明确补写请求，不得杜撰场次 ID。',
            '若现有一个场次只在中途满足节点目标、无法作为稳定边界复用，使用 split_scene，并在 sourceSceneArtifactIds 中给出要拆分的精确场次 ID。',
            '缺失全新分支使用 write_missing_branch；已有场次需要实质改写使用 revise_scene。普通补写不得填写假的源场次 ID。',
            '每个播放内容的节点必须在 revealedFactIds 中列出该内容实际让玩家知道的精确故事 fact ID；不得列出当前节点合同尚未允许公开的后续事实。',
          ].join('\n'),
          prompt: JSON.stringify({
            task: 'plan_all_interactive_node_content',
            authorIntent,
            requiredResponseSchema: {
              items: [{
                nodeId: 'exact node id',
                mode: 'no_content | reuse_existing | create_or_revise',
                sceneArtifactIds: ['zero, one, or ordered exact artifact ids'],
                fitRationale: 'creator-facing Chinese rationale',
                revealedFactIds: ['exact story fact ids this content reveals'],
                reuseGroupId: 'required when a scene is shared by nodes',
                compatibilityRationale: 'required when a scene is shared by nodes',
                writingRequest: {
                  kind: 'write_missing_branch | split_scene | revise_scene',
                  dramaticPurpose: 'required when new writing is needed',
                  requiredFacts: ['fact ids'],
                  prohibitedRevelations: ['facts that must not be revealed'],
                  desiredDurationSec: 60,
                  sourceSceneArtifactIds: ['exact existing artifact ids; required for split_scene'],
                },
              }],
            },
            nodes: nodes.map((node) => ({
              nodeId: node.id,
              title: node.brief.title,
              intent: node.brief.intent,
              summary: node.brief.narrativeSummary,
              requiresContent: nodeRequiresMainContent(node),
              requiredFacts: node.contract.requiredFacts,
              producedFacts: node.contract.producedFacts,
              playerKnowledgeIn: node.interaction.playerKnowledgeIn,
              playerKnowledgeOut: node.interaction.playerKnowledgeOut,
              durationRangeSec: node.interaction.durationRangeSec,
              choices: node.choices.map((choice) => ({ text: choice.text, targetNodeId: choice.targetNodeId })),
              currentSceneArtifactIds: bindingScriptSceneRefs(currentMainBinding(aggregate.bindings, node.id))
                .map((ref) => ref.artifactId),
            })),
            scenes: scenes.map((scene) => ({
              artifactId: scene.ref.artifactId,
              unitId: scene.unitId,
              unitIndex: scene.unitIndex,
              sceneIndex: scene.sceneIndex,
              title: scene.sceneTitle,
              synopsis: scene.synopsis,
              characters: scene.characters,
              targetDurationSeconds: scene.targetDurationSeconds || 60,
            })),
            previousAttemptFeedback: attempt > 0
              ? '上一版包含未知引用、遗漏节点或非法模式。请只使用输入中的精确 nodeId 和 artifactId，并完整覆盖每个节点。'
              : undefined,
          }),
        });
        if (!Array.isArray(response.items)) throw new Error('AI 没有返回完整内容方案');
        const candidateItems = response.items as GeneratedPlanItem[];
        const returnedNodeIds = candidateItems.map((item) => item.nodeId);
        const invalidNode = candidateItems.find((raw) => (
          typeof raw.nodeId !== 'string' || !knownNodeIds.has(raw.nodeId)
        ));
        const invalidArtifactId = candidateItems
          .flatMap((raw) => stringArray(raw.sceneArtifactIds))
          .find((artifactId) => !sceneByArtifactId.has(artifactId));
        const invalidMode = candidateItems.find((raw) => (
          raw.mode !== 'no_content'
          && raw.mode !== 'reuse_existing'
          && raw.mode !== 'create_or_revise'
        ));
        const incompleteCoverage = returnedNodeIds.length !== nodes.length
          || new Set(returnedNodeIds).size !== nodes.length;
        if (invalidNode || invalidArtifactId || invalidMode || incompleteCoverage) {
          throw new Error(invalidArtifactId
            ? `AI 返回了无法确认的场次“${invalidArtifactId}”`
            : 'AI 返回的节点内容方案不完整');
        }
        generatedItems = recoverExactExistingSceneMatches(candidateItems, nodes, scenes);
        if (attempt > 0) fallbackWarning = `AI 已在第 ${attempt + 1} 次尝试中自动修正不完整的内容方案。`;
      } catch (error) {
        if (attempt === 2) {
          generatedItems = recoverExactExistingSceneMatches(
            fallbackContentPlanItems(aggregate.graph, scenes),
            nodes,
            scenes,
          );
          const reason = error instanceof Error ? error.message : 'AI 返回的节点内容方案不完整';
          fallbackWarning = `${reason}，系统已拒绝该结果并使用安全方案。`;
        }
      }
    }

    const items: InteractiveContentPlanItem[] = generatedItems.map((raw) => {
      const node = nodes.find((candidate) => candidate.id === raw.nodeId)!;
      const proposedMode = modeFor(raw.mode);
      const selectedScenes = stringArray(raw.sceneArtifactIds).map((artifactId) => sceneByArtifactId.get(artifactId)!);
      const selectedDurationSec = selectedScenes.reduce(
        (total, scene) => total + (scene.targetDurationSeconds || 60),
        0,
      );
      const desiredDurationSec = Math.round(
        (node.interaction.durationRangeSec[0] + node.interaction.durationRangeSec[1]) / 2,
      );
      const severeDurationMismatch = proposedMode !== 'no_content'
        && selectedScenes.length > 0
        && (
          selectedDurationSec < node.interaction.durationRangeSec[0] * 0.5
          || selectedDurationSec > node.interaction.durationRangeSec[1] * 2
        );
      const mode: InteractiveContentPlanMode = severeDurationMismatch ? 'create_or_revise' : proposedMode;
      const adoptedScenes = severeDurationMismatch ? [] : selectedScenes;
      const durationRepairRequest = severeDurationMismatch ? writingRequestFor({
        kind: selectedScenes.length === 1
          ? selectedDurationSec > node.interaction.durationRangeSec[1] * 2
            ? 'split_scene'
            : 'revise_scene'
          : 'write_missing_branch',
        dramaticPurpose: `${node.brief.intent || node.brief.narrativeSummary}。现有内容约 ${selectedDurationSec} 秒，需要调整为约 ${desiredDurationSec} 秒后再映射。`,
        requiredFacts: node.contract.requiredFacts,
        prohibitedRevelations: [],
        desiredDurationSec,
        sourceSceneArtifactIds: selectedScenes.length === 1
          ? [selectedScenes[0].ref.artifactId]
          : [],
      }, node, new Set(sceneByArtifactId.keys())) : undefined;
      return {
        nodeId: node.id,
        mode,
        slots: mode === 'no_content' ? [] : [{
          slot: 'main',
          orderedSceneRefs: adoptedScenes.map((scene) => scene.ref),
          revealedFactIds: stringArray(raw.revealedFactIds),
          writingRequest: durationRepairRequest || (
            mode === 'create_or_revise' && adoptedScenes.length === 0
              ? writingRequestFor(raw.writingRequest, node, new Set(sceneByArtifactId.keys()))
              : undefined
          ),
          fitRationale: typeof raw.fitRationale === 'string' && raw.fitRationale.trim()
            ? raw.fitRationale.trim()
            : adoptedScenes.length > 0
              ? `AI 已按“${node.brief.title}”的故事目标检查这些场次的播放顺序。`
              : undefined,
        }],
        reuseGroupId: typeof raw.reuseGroupId === 'string' && raw.reuseGroupId.trim()
          ? raw.reuseGroupId.trim()
          : undefined,
        compatibilityRationale: typeof raw.compatibilityRationale === 'string' && raw.compatibilityRationale.trim()
          ? raw.compatibilityRationale.trim()
          : undefined,
        estimatedDurationSec: severeDurationMismatch
          ? desiredDurationSec
          : selectedDurationSec || desiredDurationSec,
      };
    });

    const now = new Date().toISOString();
    const baseWritingRevision = scenes[0]?.writingProjectRevision;
    const draft: InteractiveContentPlanDraft = {
      id: `content_plan_${randomUUID()}`,
      experienceId: aggregate.experience.id,
      baseGraphVersionId: aggregate.graph.id,
      baseWritingProjectId: aggregate.experience.storySource.writingProjectId,
      baseWritingRevision,
      baseBindingVersionByNodeId: Object.fromEntries(
        aggregate.bindings
          .filter((binding) => binding.slot === 'main')
          .map((binding) => [binding.nodeId, binding.versionIndex || 1]),
      ),
      authorIntent,
      items,
      impact: {
        newWritingSceneCount: items.filter((item) => (
          item.mode === 'create_or_revise'
          && item.slots.some((slot) => slot.orderedSceneRefs.length === 0)
        )).length,
        reusedWritingSceneCount: new Set(
          items.flatMap((item) => item.slots.flatMap((slot) => slot.orderedSceneRefs.map((ref) => ref.artifactId))),
        ).size,
        affectedNodeCount: items.filter((item) => {
          const nextRefs = item.slots.find((slot) => slot.slot === 'main')?.orderedSceneRefs || [];
          if (item.mode === 'create_or_revise' && nextRefs.length === 0) return true;
          return !artifactRefListEquals(
            bindingScriptSceneRefs(currentMainBinding(aggregate.bindings, item.nodeId)),
            nextRefs,
          );
        }).length,
        staleProductionSceneIds: [],
        staleMediaTakeCount: items.reduce((count, item) => {
          const current = currentMainBinding(aggregate.bindings, item.nodeId);
          const nextRefs = item.slots.find((slot) => slot.slot === 'main')?.orderedSceneRefs || [];
          return count + (
            !artifactRefListEquals(bindingScriptSceneRefs(current), nextRefs)
              ? bindingMediaTakeRefs(current).length
              : 0
          );
        }, 0),
      },
      qa: { blocking: [], warnings: [] },
      status: 'candidate',
      createdAt: now,
      updatedAt: now,
    };
    draft.qa = validateInteractiveContentPlan({ draft, graph: aggregate.graph, scenes });
    if (fallbackWarning) draft.qa.warnings.unshift(fallbackWarning);
    return draft;
  }
}
