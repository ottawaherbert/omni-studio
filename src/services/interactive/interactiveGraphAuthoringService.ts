import { randomUUID } from 'node:crypto';

import type {
  DurationBudget,
  ExperienceSpec,
  InteractionFormatProfile,
  NarrativeGraphVersion,
  NarrativeNode,
  NarrativeTransition,
  NodeCapability,
  NodeContentPolicy,
  ProductionBoundary,
  PredicateAST,
  StateEffectAST,
  StateSchema,
  StoryArchitecture,
} from '../../domains/interactive/types/schema';
import { normalizeStoryArchitecture } from '../../domains/interactive/types/schema';
import { durationBudgetForFormat } from '../../domains/interactive/durationContract';
import type { InteractiveWritingPort } from '../../domains/interactive/ports/writingPort';
import type { GraphPatchOperation, InteractiveGraphDraft } from '../../domains/interactive/authoring/graphDraft';
import { auditDraftCandidateGraph } from '../../domains/interactive/authoring/graphDraftAdoption';
import { diffNarrativeGraphs, computeDraftImpact } from '../../domains/interactive/authoring/graphDraftDiff';
import { applyGraphPatch } from '../../domains/interactive/authoring/graphDraftPatch';
import { validateNarrativeGraph } from '../../domains/interactive/validation/domainValidation';
import { summarizeInteractiveGraphDuration } from '../../domains/interactive/analysis/graphDurationSummary';
import { auditNarrativeGraph } from '../../domains/interactive/qa/graphQAEngine';
import {
  buildCostContext,
  buildExperienceContext,
  buildSelectedNodePathContext,
  buildStateLanguageContext,
  buildStoryArchitectureContext,
  buildWritingSummaryContext,
} from '../../domains/interactive/authoring/graphDraftContext';

export type GraphDraftGenerator = (input: {
  prompt: string;
  systemInstruction?: string;
}) => Promise<Record<string, unknown>>;

type DraftAction = 'initial' | 'blueprint' | 'golden_path' | 'extend' | 'strategy' | 'repair' | 'revise';
type GeneratedNode = {
  title?: unknown;
  intent?: unknown;
  narrativeSummary?: unknown;
  dramaticFunction?: unknown;
  durationRangeSec?: unknown;
  capabilities?: unknown;
  contentPolicy?: unknown;
  choices?: unknown;
};

const dramaticFunctions = new Set(['exposition', 'inciting_incident', 'choice_point', 'climax', 'resolution', 'ending']);
const capabilities = new Set<NodeCapability>([
  'play_content', 'present_choice', 'evaluate_condition', 'apply_state_effect', 'converge', 'checkpoint', 'fail_or_retry', 'terminal', 'interaction_hold',
]);
const contentPolicies = new Set<NodeContentPolicy>([
  'no_new_content', 'bind_existing', 'create_shared_content', 'compatible_state_reuse', 'exclusive_branch_content',
]);
const promptTemplate = 'interactive-graph-draft/v1';
const modelCallMetadataSymbol = Symbol.for('writing.modelCallMetadata');

type ModelCallMetadata = {
  provider?: unknown;
  modelId?: unknown;
  providerRequestId?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
};

const text = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AI 草案缺少 ${field}`);
  return value.trim();
};

const stringOr = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`AI 草案的 ${label} 必须是对象`);
  return value as Record<string, unknown>;
};
const onlyKeys = (value: Record<string, unknown>, allowed: string[], label: string) => {
  const invalid = Object.keys(value).find((key) => !allowed.includes(key));
  if (invalid) throw new Error(`AI 草案的 ${label} 包含不允许的字段 ${invalid}`);
};
const validateInteractionPayload = (value: unknown, label: string) => {
  const interaction = record(value, label);
  onlyKeys(interaction, ['capabilities', 'contentPolicy', 'durationRangeSec', 'playerKnowledgeIn', 'playerKnowledgeOut'], label);
};
const validateTransitionPayload = (value: unknown, label: string) => {
  const transition = record(value, label);
  onlyKeys(transition, ['id', 'sourceNodeId', 'targetNodeId', 'text', 'intent', 'condition', 'effects', 'interaction', 'timeoutSeconds', 'defaultTimeoutTargetNodeId'], label);
  if (transition.interaction !== undefined) {
    onlyKeys(record(transition.interaction, `${label}.interaction`),
      ['playerKnowledge', 'immediateFeedback', 'consequenceHorizon', 'thematicMeaning', 'convergenceStrategy', 'estimatedUniqueMediaSec', 'replayValue'], `${label}.interaction`);
  }
};

const parsePatchOperations = (response: Record<string, unknown>, baseGraph: NarrativeGraphVersion, schema: StateSchema): GraphPatchOperation[] => {
  if (!Array.isArray(response.operations) || response.operations.length === 0) throw new Error('AI 草案缺少有效 operations');
  const operations = response.operations.map((raw, index): GraphPatchOperation => {
    const op = record(raw, `operations[${index}]`);
    const label = `operations[${index}]`;
    switch (op.type) {
      case 'update_node_brief': {
        onlyKeys(op, ['type', 'nodeId', 'brief'], label);
        const nodeId = text(op.nodeId, `${label}.nodeId`);
        const existing = baseGraph.nodes.find((node) => node.id === nodeId);
        if (!existing) throw new Error(`AI 草案的 ${label} 指向不存在的节点 ${nodeId}`);
        const patch = record(op.brief, `${label}.brief`);
        onlyKeys(patch, ['title', 'intent', 'narrativeSummary', 'dramaticFunction'], `${label}.brief`);
        if (Object.keys(patch).length === 0) throw new Error(`AI 草案的 ${label}.brief 不能为空`);
        const brief = { ...existing.brief, ...patch };
        if (!dramaticFunctions.has(brief.dramaticFunction) || !brief.title?.trim() || !brief.intent?.trim() || !brief.narrativeSummary?.trim()) {
          throw new Error(`AI 草案的 ${label}.brief 无效`);
        }
        return { type: 'update_node_brief', nodeId, brief };
      }
      case 'update_node_interaction': {
        onlyKeys(op, ['type', 'nodeId', 'interaction'], label);
        const nodeId = text(op.nodeId, `${label}.nodeId`);
        const existing = baseGraph.nodes.find((node) => node.id === nodeId);
        if (!existing?.interaction) throw new Error(`AI 草案的 ${label} 指向无互动合同的节点 ${nodeId}`);
        const patch = record(op.interaction, `${label}.interaction`);
        validateInteractionPayload(patch, `${label}.interaction`);
        return { type: 'update_node_interaction', nodeId, interaction: { ...existing.interaction, ...patch } } as GraphPatchOperation;
      }
      case 'add_node': {
        onlyKeys(op, ['type', 'node'], label);
        const node = record(op.node, `${label}.node`);
        onlyKeys(node, ['id', 'brief', 'contract', 'storyBeatIds', 'choices', 'interaction'], `${label}.node`);
        onlyKeys(record(node.brief, `${label}.node.brief`), ['nodeId', 'title', 'intent', 'dramaticFunction', 'narrativeSummary'], `${label}.node.brief`);
        onlyKeys(record(node.contract, `${label}.node.contract`), ['readVariables', 'writeVariables', 'requiredFacts', 'producedFacts'], `${label}.node.contract`);
        if (node.interaction !== undefined) validateInteractionPayload(node.interaction, `${label}.node.interaction`);
        if (!Array.isArray(node.choices)) throw new Error(`AI 草案的 ${label}.node.choices 必须是数组`);
        node.choices.forEach((choice, choiceIndex) => {
          const choiceLabel = `${label}.node.choices[${choiceIndex}]`;
          validateTransitionPayload(choice, choiceLabel);
          const choiceRecord = record(choice, choiceLabel);
          if ('sourceNodeId' in choiceRecord) throw new Error(`AI 草案的 ${choiceLabel} 不能含 sourceNodeId`);
        });
        return { type: 'add_node', node: node as unknown as NarrativeNode };
      }
      case 'remove_node':
      case 'set_entry':
        onlyKeys(op, ['type', 'nodeId'], label);
        return { type: op.type, nodeId: text(op.nodeId, `${label}.nodeId`) };
      case 'add_transition': {
        onlyKeys(op, ['type', 'transition'], label);
        const transition = record(op.transition, `${label}.transition`);
        validateTransitionPayload(transition, `${label}.transition`);
        return { type: 'add_transition', transition: transition as unknown as NarrativeTransition };
      }
      case 'update_transition': {
        onlyKeys(op, ['type', 'transitionId', 'patch'], label);
        const patch = record(op.patch, `${label}.patch`);
        onlyKeys(patch, ['targetNodeId', 'text', 'intent', 'condition', 'effects', 'interaction', 'timeoutSeconds', 'defaultTimeoutTargetNodeId'], `${label}.patch`);
        if (patch.interaction !== undefined) validateTransitionPayload({ interaction: patch.interaction }, `${label}.patch`);
        return { type: 'update_transition', transitionId: text(op.transitionId, `${label}.transitionId`), patch } as GraphPatchOperation;
      }
      case 'remove_transition':
        onlyKeys(op, ['type', 'transitionId'], label);
        return { type: 'remove_transition', transitionId: text(op.transitionId, `${label}.transitionId`) };
      default:
        throw new Error(`AI 草案的 ${label} 使用了不支持的操作 ${String(op.type)}`);
    }
  });
  const candidate = applyGraphPatch(baseGraph, operations);
  const issues = validateNarrativeGraph(candidate, schema);
  if (issues.length) throw new Error(`AI 草案操作无效：${issues.join('；')}`);
  return operations;
};

const duration = (value: unknown): [number, number] => {
  let candidate = value;
  if (typeof candidate === 'string') {
    const raw = candidate;
    try {
      candidate = JSON.parse(raw);
    } catch {
      candidate = raw.split(/[-,~至]/).map((part) => Number(part.trim()));
    }
  }
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const record = candidate as Record<string, unknown>;
    candidate = [record.min ?? record.minimum ?? record.start, record.max ?? record.maximum ?? record.end];
  }
  if (!Array.isArray(candidate) || candidate.length < 2) return [45, 90];
  const min = Math.round(Number(candidate[0]));
  const max = Math.round(Number(candidate[1]));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return [45, 90];
  return min <= max ? [min, max] : [max, min];
};

const promptFor = (input: Record<string, unknown>) => JSON.stringify(input, null, 2);

type BlueprintShape = {
  nodeRange: string;
  minNodes: number;
  minEndings: number;
};

const blueprintShapeFor = (formatProfile?: InteractionFormatProfile): BlueprintShape => {
  const targetSessionMinutes = Number(formatProfile?.targetSessionMinutes || 0);
  if (!targetSessionMinutes) return { nodeRange: '4-6', minNodes: 3, minEndings: 2 };
  const targetCompleteMinutes = Math.max(
    targetSessionMinutes,
    Number(formatProfile?.targetCompleteMinutes || targetSessionMinutes),
  );
  const minimumUniqueContentNodes = Math.ceil(
    (targetCompleteMinutes * 60 * 0.8) / 360,
  );
  const minimumTypicalPathNodes = Math.ceil(
    (targetSessionMinutes * 60 * 0.8) / 360,
  );
  const minimumByExperience = targetSessionMinutes <= 30 ? 8 : targetSessionMinutes <= 120 ? 24 : 48;
  const minNodes = Math.max(minimumByExperience, minimumUniqueContentNodes, minimumTypicalPathNodes);
  const maxNodes = Math.ceil(minNodes * (minNodes <= 12 ? 1.5 : 1.35));
  return {
    nodeRange: `${minNodes}-${maxNodes}`,
    minNodes,
    minEndings: targetSessionMinutes > 120 ? 4 : 3,
  };
};

const calibrateBlueprintDurations = (
  baseGraph: NarrativeGraphVersion,
  operations: GraphPatchOperation[],
  budget?: DurationBudget,
) => {
  if (!budget) return operations;
  const candidate = applyGraphPatch(baseGraph, operations);
  const audit = auditNarrativeGraph(candidate, undefined, budget).durationAudit;
  const pathMidpoints = [...(audit?.completedPathRanges || [])]
    .map((range) => (range[0] + range[1]) / 2)
    .sort((left, right) => left - right);
  const typicalPathSec = pathMidpoints[Math.floor(pathMidpoints.length / 2)];
  const uniqueMaximumSec = audit?.reachableUniqueRange[1] || 0;
  if (!typicalPathSec || !uniqueMaximumSec || candidate.nodes.length === 0) return operations;
  const tolerance = Math.max(0, budget.tolerancePercent) / 100;
  const scale = Math.min(8, Math.max(
    0.25,
    budget.p50TargetSec / typicalPathSec,
    (budget.p90TargetSec * (1 - tolerance)) / uniqueMaximumSec,
  ));
  if (Math.abs(scale - 1) < 0.03) return operations;
  return operations.map((operation) => {
    if (operation.type !== 'add_node') return operation;
    const currentRange = operation.node.interaction?.durationRangeSec || [45, 90];
    const maximum = operation.node.brief.dramaticFunction === 'ending'
      ? Math.max(1, Math.round(currentRange[1] * scale))
      : Math.min(
          budget.maxSecondsWithoutChoice,
          Math.max(1, Math.round(currentRange[1] * scale)),
        );
    const minimum = Math.min(maximum, Math.max(1, Math.round(currentRange[0] * scale)));
    return {
      ...operation,
      node: {
        ...operation.node,
        interaction: {
          ...operation.node.interaction,
          durationRangeSec: [minimum, maximum] as [number, number],
        },
      },
    };
  });
};

const initialBlueprintFallback = (input: {
  authorIntent: string;
  architecture?: StoryArchitecture;
  formatProfile?: InteractionFormatProfile;
}): Record<string, unknown> => {
  const premise = input.architecture?.premise?.trim()
    || input.authorIntent.split('\n').find((line) => line.includes('作者的想法：'))?.replace(/^.*作者的想法：/, '').trim()
    || '主角进入事件核心，并通过选择面对不同真相。';
  if (blueprintShapeFor(input.formatProfile).minNodes >= 8) {
    return {
      summary: 'AI 已按完整短篇体验搭建一版九节点、三结局结构，可以直接审阅、继续生成剧本并试玩。',
      premise,
      protagonistGoal: input.architecture?.protagonistGoal || '在危机结束前找出真相，并决定如何使用它。',
      thematicQuestion: input.architecture?.thematicQuestion || '当真相会伤害身边的人时，人是否仍应公开它？',
      storyMemory: { variables: [], facts: ['选择相信直觉', '选择相信证据', '决定公开真相'] },
      nodes: [
        {
          title: '异常来信', intent: '建立危机与主角目标', narrativeSummary: premise,
          dramaticFunction: 'inciting_incident', durationRangeSec: [90, 150],
          capabilities: ['play_content', 'present_choice'], contentPolicy: 'create_shared_content',
          choices: [
            { text: '相信直觉，追查来信源头', intent: '走近私人真相', targetNodeIndex: 1, effects: [{ type: 'add_fact', fact: '选择相信直觉' }] },
            { text: '核验证据，报告异常事件', intent: '走进公开调查', targetNodeIndex: 2, effects: [{ type: 'add_fact', fact: '选择相信证据' }] },
          ],
        },
        {
          title: '封存的线索', intent: '兑现直觉路线并制造新疑问', narrativeSummary: '主角找到一条被人为封存、却与自己过去有关的线索。',
          dramaticFunction: 'choice_point', durationRangeSec: [120, 180],
          capabilities: ['play_content', 'present_choice'], contentPolicy: 'exclusive_branch_content',
          choices: [
            { text: '联系线索中的知情人', intent: '冒险建立私人同盟', targetNodeIndex: 3 },
            { text: '带走证物继续独自调查', intent: '保留主动权', targetNodeIndex: 4 },
          ],
        },
        {
          title: '官方调查', intent: '兑现证据路线并建立制度压力', narrativeSummary: '官方调查迅速启动，但有人试图限定主角能够接触的范围。',
          dramaticFunction: 'choice_point', durationRangeSec: [120, 180],
          capabilities: ['play_content', 'present_choice'], contentPolicy: 'exclusive_branch_content',
          choices: [
            { text: '服从安排进入联合调查', intent: '利用制度资源', targetNodeIndex: 4 },
            { text: '绕过命令追踪异常信号', intent: '承担违规风险', targetNodeIndex: 5 },
          ],
        },
        {
          title: '知情人的代价', intent: '揭示私人真相的代价', narrativeSummary: '知情人交出关键证词，同时要求主角保护一个可能负有责任的人。',
          dramaticFunction: 'choice_point', durationRangeSec: [120, 180],
          capabilities: ['play_content', 'present_choice'], contentPolicy: 'exclusive_branch_content',
          choices: [
            { text: '答应保护他，换取完整证词', intent: '以妥协换真相', targetNodeIndex: 6 },
            { text: '拒绝交易，只带走可验证证据', intent: '坚持公开规则', targetNodeIndex: 7 },
          ],
        },
        {
          title: '交叉验证', intent: '让两条路线在证据层汇合', narrativeSummary: '来自私人线索和官方档案的记录互相印证，也暴露了更大的隐瞒。',
          dramaticFunction: 'climax', durationRangeSec: [150, 210],
          capabilities: ['play_content', 'present_choice', 'converge'], contentPolicy: 'compatible_state_reuse',
          choices: [
            { text: '先救下即将受害的人', intent: '把行动置于公开之前', targetNodeIndex: 6 },
            { text: '立即公开全部证据', intent: '用舆论阻止掩盖', targetNodeIndex: 7, effects: [{ type: 'add_fact', fact: '决定公开真相' }] },
            { text: '删除关键记录，结束循环', intent: '以遗忘换取安全', targetNodeIndex: 8 },
          ],
        },
        {
          title: '信号源头', intent: '揭开异常事件的机制', narrativeSummary: '主角抵达信号源头，发现来信既是警告，也是一次等待回应的求救。',
          dramaticFunction: 'climax', durationRangeSec: [150, 210],
          capabilities: ['play_content', 'present_choice'], contentPolicy: 'exclusive_branch_content',
          choices: [
            { text: '回应求救并改变既定事件', intent: '主动承担未知后果', targetNodeIndex: 6 },
            { text: '切断信号，保住现实秩序', intent: '拒绝不可控改变', targetNodeIndex: 8 },
          ],
        },
        {
          title: '改变的明天', intent: '兑现主动营救与承担', narrativeSummary: '主角救下目标，也让所有人进入一个无法预知、但可以共同面对的新现实。',
          dramaticFunction: 'ending', durationRangeSec: [90, 150],
          capabilities: ['play_content', 'terminal'], contentPolicy: 'exclusive_branch_content', choices: [],
        },
        {
          title: '公开的真相', intent: '兑现公开证据的选择', narrativeSummary: '真相被公开，旧秩序开始崩塌；主角失去安稳，却让更多人获得选择。',
          dramaticFunction: 'ending', durationRangeSec: [90, 150],
          capabilities: ['play_content', 'terminal'], contentPolicy: 'exclusive_branch_content', choices: [],
        },
        {
          title: '无人知晓的清晨', intent: '兑现保守秘密的选择', narrativeSummary: '危机安静地消失，世界照常运转，只有主角记得那封再也不会抵达的来信。',
          dramaticFunction: 'ending', durationRangeSec: [90, 150],
          capabilities: ['play_content', 'terminal'], contentPolicy: 'exclusive_branch_content', choices: [],
        },
      ],
    };
  }
  return {
    summary: 'AI 已先搭建一版可以立即审阅和试玩的双结局结构，后续可继续用自然语言调整。',
    premise,
    protagonistGoal: input.architecture?.protagonistGoal || '找出真相，并决定愿意相信谁。',
    thematicQuestion: input.architecture?.thematicQuestion || '当证据与情感冲突时，人应当如何选择？',
    storyMemory: { variables: [], facts: ['选择相信第一位关键人物', '选择相信第二位关键人物'] },
    nodes: [
      {
        title: '进入事件核心',
        intent: '快速建立主角目标与迫近的选择',
        narrativeSummary: premise,
        dramaticFunction: 'inciting_incident',
        durationRangeSec: [45, 75],
        capabilities: ['play_content', 'present_choice'],
        contentPolicy: 'create_shared_content',
        choices: [
          {
            text: '相信第一位关键人物',
            intent: '凭情感与经验追查',
            targetNodeIndex: 1,
            effects: [{ type: 'add_fact', fact: '选择相信第一位关键人物' }],
          },
          {
            text: '相信第二位关键人物',
            intent: '凭证据与规则追查',
            targetNodeIndex: 2,
            effects: [{ type: 'add_fact', fact: '选择相信第二位关键人物' }],
          },
        ],
      },
      {
        title: '沿着旧线索追查',
        intent: '让第一条选择产生明确后果',
        narrativeSummary: '主角沿着一段带有私人情感的旧线索接近真相。',
        dramaticFunction: 'climax',
        durationRangeSec: [60, 90],
        capabilities: ['play_content', 'present_choice'],
        contentPolicy: 'exclusive_branch_content',
        choices: [{ text: '承担这份真相', intent: '接受选择带来的代价', targetNodeIndex: 3 }],
      },
      {
        title: '沿着新证据追查',
        intent: '让第二条选择产生不同后果',
        narrativeSummary: '主角依靠眼前证据找到另一种解释，也面对新的代价。',
        dramaticFunction: 'climax',
        durationRangeSec: [60, 90],
        capabilities: ['play_content', 'present_choice'],
        contentPolicy: 'exclusive_branch_content',
        choices: [{ text: '公开调查结果', intent: '把证据带向结局', targetNodeIndex: 4 }],
      },
      {
        title: '旧线索的结局',
        intent: '兑现信任与情感选择',
        narrativeSummary: '主角得到一份更私人的真相，并承担由此改变的关系。',
        dramaticFunction: 'ending',
        durationRangeSec: [45, 75],
        capabilities: ['play_content', 'terminal'],
        contentPolicy: 'exclusive_branch_content',
        choices: [],
      },
      {
        title: '新证据的结局',
        intent: '兑现证据与行动选择',
        narrativeSummary: '主角让新的证据改变局面，也失去一种回到过去的可能。',
        dramaticFunction: 'ending',
        durationRangeSec: [45, 75],
        capabilities: ['play_content', 'terminal'],
        contentPolicy: 'exclusive_branch_content',
        choices: [],
      },
    ],
  };
};

/**
 * The provider returns story language only. This adapter owns IDs, graph patch
 * semantics and runtime contracts so an LLM cannot write arbitrary persistence
 * payloads into the interactive domain.
 */
export class InteractiveGraphAuthoringService {
  constructor(
    private readonly generator: GraphDraftGenerator,
    private readonly writingPort?: InteractiveWritingPort,
  ) {}

  public async generateDraft(input: {
    action: DraftAction;
    experienceId: string;
    baseGraph: NarrativeGraphVersion;
    authorIntent: string;
    revisionOfDraft?: InteractiveGraphDraft;
    selectedNodeId?: string;
    strategy?: 'foldback' | 'parallel' | 'failure';
    issueIds?: string[];
    spec?: ExperienceSpec;
    architecture?: StoryArchitecture;
    stateSchema?: StateSchema;
    productionBoundary?: ProductionBoundary;
    writingProjectId?: string;
    format?: InteractionFormatProfile['format'];
    formatProfile?: InteractionFormatProfile;
  }): Promise<InteractiveGraphDraft> {
    if (input.revisionOfDraft && (
      input.revisionOfDraft.status !== 'candidate'
      || input.revisionOfDraft.experienceId !== input.experienceId
      || input.revisionOfDraft.baseGraphVersionId !== input.baseGraph.id
      || input.revisionOfDraft.baseGraphVersionIndex !== input.baseGraph.versionIndex
    )) {
      throw Object.assign(new Error('原候选已过期，请根据当前白板重新提交修改意见。'), { statusCode: 409 });
    }
    if ((input.action === 'initial' || input.action === 'blueprint') && input.baseGraph.nodes.length > 0) {
      throw Object.assign(new Error('基础蓝图只能在空白白板生成；请使用“扩展分支”继续现有故事。'), { statusCode: 409 });
    }
    if ((input.action === 'extend' || input.action === 'strategy') && !input.selectedNodeId) {
      throw Object.assign(new Error('请先选择一个节点再生成分支。'), { statusCode: 400 });
    }
    if (input.action === 'repair' && (!input.issueIds || input.issueIds.length === 0)) {
      throw Object.assign(new Error('请先选择需要修复的图谱检查项。'), { statusCode: 400 });
    }
    // A golden path on an existing graph must join the current story instead of
    // producing a visually plausible but unreachable second island.
    const scopeNodeId = input.selectedNodeId
      || (input.action === 'golden_path' && input.baseGraph.nodes.length > 0 ? input.baseGraph.entryNodeId : undefined);
    const repairsDurationContract = input.action === 'repair'
      && Boolean(input.issueIds?.some((issueId) => (
        issueId.startsWith('err_duration_') || issueId.startsWith('warn_duration_')
      )));
    const replacesWholeGraph = (
      input.action === 'revise' || repairsDurationContract
    ) && input.baseGraph.nodes.length > 0;
    const prefersPatch = input.baseGraph.nodes.length > 0 && (input.action === 'revise' || input.action === 'repair');

    const isInitialBlueprint = input.baseGraph.nodes.length === 0 && (input.action === 'initial' || input.action === 'blueprint');
    const blueprintShape = blueprintShapeFor(input.formatProfile);
    const baseSystemInstruction = [
      '你是互动影视叙事设计师。',
      '输出必须遵守调用方给出的 schema，不得输出数据库 ID、HTML、脚本或未声明状态变量。',
      prefersPatch
        ? '请只返回对已采用白板的最小 operations 补丁。保留作者没有明确要求修改的节点 ID、选择条件与效果、节点合同、玩家知识、故事支点和章节归属。不要为了润色而删除重建节点；不要输出 storyMemory、premise 或其他跨域改动。'
      : isInitialBlueprint
        ? `这是完整可玩的作品蓝图，不是功能演示。请生成 ${blueprintShape.nodeRange} 个节点，至少 ${blueprintShape.minEndings} 个不同结局；必须有一个入口和多个真正改变后续的选择，每个非结局节点都必须有 choices。作者选择的单次体验和完整探索时长是不可缩短的合同，节点时长与路径结构必须覆盖它。`
        : replacesWholeGraph
          ? `这是对整张白板方案的完整修订，不是局部补丁。请返回 ${blueprintShape.nodeRange} 个节点的替代方案；所有 choices 必须用 targetNodeIndex 指向本次返回的 nodes 数组，不能引用旧节点 ID。至少包含 ${blueprintShape.minEndings} 个不同结局。作者选择的单次体验和完整探索时长是不可缩短的合同。`
        : [
            '现有白板修改只生成 2-5 个简洁的新节点，每个 narrativeSummary 不超过 100 个汉字。',
            '每个新生成的非结局节点都必须有 choices，并用 targetNodeIndex 或现有节点 ID 连接后续；不得留下不可达节点或无出口节点。',
            '若作者要求调整节奏或提前选择，应让新增路径从指定节点或现有入口立即可达，而不是生成孤立的第二张图。',
          ].join(' '),
    ].filter(Boolean).join(' ');
    const generatorInput = {
      systemInstruction: baseSystemInstruction,
      prompt: promptFor({
        task: 'interactive_graph_draft',
        action: input.action,
        authorIntent: input.authorIntent,
        strategy: input.strategy,
        repairIssueIds: input.issueIds || [],
        revisionOfCandidate: input.revisionOfDraft ? {
          id: input.revisionOfDraft.id,
          instruction: '这是上一版未采用的完整候选。按作者反馈修改它，保留未要求改变的情节与分支。最终仍需返回符合本次 action 的完整结果，并相对已采用白板生成可审阅差异。',
          authorIntent: input.revisionOfDraft.authorIntent,
          summary: input.revisionOfDraft.summary,
          candidateGraph: applyGraphPatch(input.baseGraph, input.revisionOfDraft.operations),
          proposedStateSchema: input.revisionOfDraft.proposedStateSchema,
          proposedStoryArchitecture: input.revisionOfDraft.proposedStoryArchitecture,
        } : undefined,
        baseGraph: prefersPatch ? input.baseGraph : undefined,
        currentStateSchema: prefersPatch ? input.stateSchema : undefined,
        currentStoryArchitecture: prefersPatch ? input.architecture : undefined,
        requiredResponseSchema: prefersPatch ? {
          summary: 'string',
          operations: [
            { type: 'update_node_brief', nodeId: 'existing node ID', brief: { narrativeSummary: 'only changed brief fields; title, intent, dramaticFunction optional' } },
            { type: 'update_node_interaction|update_transition|add_node|remove_node|add_transition|remove_transition|set_entry', note: 'only when explicitly needed; use existing IDs and complete graph-domain payloads' },
          ],
        } : {
          summary: 'string',
          nodes: [{
            title: 'string', intent: 'string', narrativeSummary: 'string',
            dramaticFunction: 'exposition|inciting_incident|choice_point|climax|resolution|ending',
            durationRangeSec: '[minSeconds,maxSeconds]',
            capabilities: ['play_content|present_choice|terminal|...'],
            contentPolicy: 'create_shared_content|exclusive_branch_content|no_new_content|...',
            choices: [{ text: 'string', intent: 'string', targetNodeIndex: 'number or existing node id', condition: '{type: always|variable|fact, variable?, comparator?, value?, fact?} optional', effects: '[{type: set|increment|decrement|add_fact|remove_fact, variable?, value?, amount?, fact?}] optional' }],
          }],
          storyMemory: { variables: [{ key: 'creator-facing string', type: 'boolean|number', defaultValue: 'boolean|number', min: 'number optional', max: 'number optional' }], facts: ['creator-facing string'] },
          premise: 'string',
          protagonistGoal: 'string',
          thematicQuestion: 'string',
          episodeTitle: 'string optional; only for an episodic interactive series',
          chapterTitle: 'string; author-facing story chapter, never a production batch name',
        },
        constraints: {
          completeBlueprintShape: isInitialBlueprint
            ? `${blueprintShape.nodeRange} nodes, one entry, meaningful branching choices, at least ${blueprintShape.minEndings} different endings, and every non-ending node must lead somewhere`
            : undefined,
          durationContract: durationBudgetForFormat(input.architecture?.durationBudget, input.formatProfile),
          selectedNodePath: scopeNodeId ? buildSelectedNodePathContext(input.baseGraph, scopeNodeId) : undefined,
          experience: buildExperienceContext(input.spec),
          architecture: buildStoryArchitectureContext(input.architecture),
          state: buildStateLanguageContext(input.stateSchema),
          writing: buildWritingSummaryContext(input.writingProjectId, this.writingPort),
          cost: buildCostContext(input.baseGraph, input.productionBoundary),
        },
      }),
    };
    let response: Record<string, unknown> | undefined;
    let proposedStateSchema: StateSchema | undefined;
    let generatedOperations: GraphPatchOperation[] | undefined;
    let usedPatchResponse = false;
    const assertCompleteBlueprintShape = (operations: GraphPatchOperation[]) => {
      if (usedPatchResponse || (!isInitialBlueprint && !replacesWholeGraph)) return;
      const nodes = operations.filter((operation): operation is Extract<GraphPatchOperation, { type: 'add_node' }> => operation.type === 'add_node');
      const choices = operations.filter((operation) => operation.type === 'add_transition');
      const endings = nodes.filter((operation) => operation.node.brief.dramaticFunction === 'ending');
      if (nodes.length < blueprintShape.minNodes || choices.length < 2 || endings.length < blueprintShape.minEndings) {
        throw new Error(`AI 首稿不完整：至少需要 ${blueprintShape.minNodes} 个节点、一个有意义的选择和 ${blueprintShape.minEndings} 个结局`);
      }
    };
    const isRetryableModelOutputError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.includes('AI_JSON_INVALID') || message.startsWith('AI 草案') || message.startsWith('AI 首稿');
    };
    const repairInstructions = prefersPatch
      ? ['上次返回无效。请重新返回完整 JSON 对象，只包含 summary 和最小 operations，使用现有节点 ID。', '检查 operations 的类型、目标和字段；只修改作者要求的部分。']
      : ['上次返回不完整。请重新从头返回一个完整 JSON 对象，缩短所有描述并确保括号闭合。', `再次检查：nodes 必须是 ${blueprintShape.nodeRange} 个节点；每个非结局节点必须有 choices；选择用 targetNodeIndex 指向数组节点；至少 ${blueprintShape.minEndings} 个节点的 dramaticFunction 为 ending。`];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const generation = this.generator({
          ...generatorInput,
          systemInstruction: attempt === 0
            ? generatorInput.systemInstruction
            : `${generatorInput.systemInstruction} ${repairInstructions[Math.min(attempt - 1, repairInstructions.length - 1)]}`,
        });
        response = await generation;
        if (response.operations !== undefined) {
          if (!prefersPatch) throw new Error('AI 草案此操作不支持 operations');
          proposedStateSchema = input.stateSchema || { variables: [], factDefinitions: [], initialFactIds: [] };
          generatedOperations = parsePatchOperations(response, input.baseGraph, proposedStateSchema);
          usedPatchResponse = true;
        } else {
          proposedStateSchema = this.toStateSchema(response, input.stateSchema);
          generatedOperations = this.toOperations(
            response,
            { ...input, selectedNodeId: scopeNodeId, replaceWholeGraph: replacesWholeGraph },
            proposedStateSchema,
          );
          usedPatchResponse = false;
        }
        assertCompleteBlueprintShape(generatedOperations);
        break;
      } catch (error) {
        if (attempt === 2 || !isRetryableModelOutputError(error)) throw error;
      }
    }
    if (!response || !proposedStateSchema || !generatedOperations) throw new Error('AI 暂时没有生成完整方案，请稍后重试');
    const operations = usedPatchResponse ? generatedOperations : input.action === 'repair' && !repairsDurationContract
      ? this.toRepairOperations(generatedOperations, input.baseGraph, input.issueIds || [])
      : (isInitialBlueprint || replacesWholeGraph)
        ? calibrateBlueprintDurations(
            input.baseGraph,
            generatedOperations,
            durationBudgetForFormat(input.architecture?.durationBudget, input.formatProfile),
          )
        : generatedOperations;
    const candidateGraph = applyGraphPatch(input.baseGraph, operations);
    const architectureBase = replacesWholeGraph && !usedPatchResponse && input.architecture
      ? {
          ...input.architecture,
          mandatoryNodes: [],
          variableNodes: [],
          endings: [],
          storyBeats: [],
          storyChapters: [],
          storyEpisodes: [],
          endingContracts: [],
          productionBlocks: [],
        }
      : input.architecture;
    const proposedStoryArchitecture = usedPatchResponse && input.architecture ? {
      ...input.architecture,
      durationBudget: durationBudgetForFormat(input.architecture.durationBudget, input.formatProfile),
    } : this.toStoryArchitecture(
      response,
      architectureBase,
      candidateGraph,
      input.authorIntent,
      scopeNodeId,
      input.formatProfile,
    );
    const modelCall = (response as Record<PropertyKey, unknown>)[modelCallMetadataSymbol] as ModelCallMetadata | undefined;
    return this.buildDraft({
      experienceId: input.experienceId,
      baseGraph: input.baseGraph,
      authorIntent: input.authorIntent,
      revisionOfDraftId: input.revisionOfDraft?.id,
      scope: input.action === 'repair'
        ? { type: 'repair', issueIds: input.issueIds || [] }
        : scopeNodeId ? { type: 'from_node', nodeId: scopeNodeId } : { type: 'whole_graph' },
      summary: text(response.summary, 'summary'),
      operations,
      proposedStateSchema,
      proposedStoryArchitecture,
      modelCall,
    });
  }

  private toStateSchema(response: Record<string, unknown>, current?: StateSchema): StateSchema {
    const memory = response.storyMemory && typeof response.storyMemory === 'object' && !Array.isArray(response.storyMemory)
      ? response.storyMemory as Record<string, unknown> : {};
    const variables = [...(current?.variables || [])];
    const keys = new Set(variables.map((variable) => variable.key));
    if (Array.isArray(memory.variables)) {
      memory.variables.forEach((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const variable = raw as Record<string, unknown>;
        const key = text(variable.key, 'storyMemory.variable.key');
        if (keys.has(key)) return;
        if (variable.type === 'boolean') {
          variables.push({ key, type: 'boolean', scope: 'global', defaultValue: variable.defaultValue === true });
        } else if (variable.type === 'number') {
          const defaultValue = Number(variable.defaultValue);
          if (!Number.isFinite(defaultValue)) throw new Error(`AI 草案中的“${key}”缺少有效初始值`);
          variables.push({ key, type: 'number', scope: 'global', defaultValue, min: Number.isFinite(variable.min) ? Number(variable.min) : undefined, max: Number.isFinite(variable.max) ? Number(variable.max) : undefined });
        } else {
          throw new Error(`AI 草案中的“${key}”使用了不支持的记忆类型`);
        }
        keys.add(key);
      });
    }
    const facts = [...(current?.factDefinitions || current?.facts || [])];
    if (Array.isArray(memory.facts)) {
      memory.facts.forEach((value) => {
        const fact = text(value, 'storyMemory.fact');
        if (!facts.includes(fact)) facts.push(fact);
      });
    }
    return { variables, factDefinitions: facts, initialFactIds: current?.initialFactIds || [] };
  }

  private toOperations(
    response: Record<string, unknown>,
    input: { baseGraph: NarrativeGraphVersion; selectedNodeId?: string; replaceWholeGraph?: boolean },
    stateSchema: StateSchema,
  ): GraphPatchOperation[] {
    if (!Array.isArray(response.nodes) || response.nodes.length === 0) throw new Error('AI 草案没有返回节点');
    const generated = response.nodes as GeneratedNode[];
    const generatedIds = generated.map(() => `node-ai-${randomUUID()}`);
    const existingIds = new Set(input.baseGraph.nodes.map((node) => node.id));
    const generatedIdByExistingId = new Map(
      input.baseGraph.nodes.flatMap((node) => {
        const generatedIndex = generated.findIndex((item) => (
          typeof item.title === 'string' && item.title.trim() === node.brief.title.trim()
        ));
        return generatedIndex >= 0 ? [[node.id, generatedIds[generatedIndex]] as const] : [];
      }),
    );
    const stateVariables = new Set(stateSchema.variables.map((variable) => variable.key));
    const facts = new Set(stateSchema.factDefinitions || []);
    const resolveTarget = (value: unknown, sourceIndex: number) => {
      if (typeof value === 'number' && Number.isInteger(value) && generatedIds[value]) return generatedIds[value];
      if (typeof value === 'string' && /^\d+$/.test(value) && generatedIds[Number(value)]) return generatedIds[Number(value)];
      if (typeof value === 'string' && input.replaceWholeGraph && generatedIdByExistingId.has(value)) {
        return generatedIdByExistingId.get(value)!;
      }
      if (typeof value === 'string' && existingIds.has(value) && !input.replaceWholeGraph) return value;
      throw new Error(`AI 草案第 ${sourceIndex + 1} 个节点的选择目标“${String(value)}”无效；请返回有效的 targetNodeIndex${input.replaceWholeGraph ? '' : ' 或现有节点 ID'}。`);
    };
    const nodes: NarrativeNode[] = generated.map((item, index) => {
      const id = generatedIds[index];
      const nodeCapabilities = Array.isArray(item.capabilities)
        ? item.capabilities.filter((capability): capability is NodeCapability => typeof capability === 'string' && capabilities.has(capability as NodeCapability))
        : [];
      const requestedFunction = typeof item.dramaticFunction === 'string' ? item.dramaticFunction : '';
      const functionName = nodeCapabilities.includes('terminal')
        ? 'ending'
        : dramaticFunctions.has(requestedFunction)
          ? requestedFunction
        : index === generated.length - 1 ? 'ending' : index === 0 ? 'exposition' : 'choice_point';
      const choices = Array.isArray(item.choices) ? item.choices : [];
      const requiredCapabilities: NodeCapability[] = [...nodeCapabilities];
      if (!requiredCapabilities.includes('play_content')) requiredCapabilities.unshift('play_content');
      if (choices.length > 0 && !requiredCapabilities.includes('present_choice')) requiredCapabilities.push('present_choice');
      if (functionName === 'ending' && !requiredCapabilities.includes('terminal')) requiredCapabilities.push('terminal');
      const requestedPolicy = typeof item.contentPolicy === 'string' ? item.contentPolicy as NodeContentPolicy : undefined;
      const rawPolicy: NodeContentPolicy = requestedPolicy && contentPolicies.has(requestedPolicy)
        ? requestedPolicy
        : 'create_shared_content';
      return {
        id,
        brief: {
          nodeId: id,
          title: stringOr(item.title, `故事节点 ${index + 1}`),
          intent: stringOr(item.intent, stringOr(item.narrativeSummary, '推动故事继续发展')),
          narrativeSummary: stringOr(item.narrativeSummary, stringOr(item.intent, '故事继续发展。')),
          dramaticFunction: functionName as NarrativeNode['brief']['dramaticFunction'],
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        storyBeatIds: [`beat-${id}`],
        choices: [],
        interaction: {
          capabilities: requiredCapabilities,
          contentPolicy: rawPolicy,
          durationRangeSec: duration(item.durationRangeSec),
          playerKnowledgeIn: [],
          playerKnowledgeOut: [],
        },
      };
    });
    const operations: GraphPatchOperation[] = input.replaceWholeGraph
      ? [
          ...(input.baseGraph.transitions || []).map((transition): GraphPatchOperation => ({
            type: 'remove_transition',
            transitionId: transition.id,
          })),
          ...input.baseGraph.nodes.map((node): GraphPatchOperation => ({ type: 'remove_node', nodeId: node.id })),
          ...nodes.map((node): GraphPatchOperation => ({ type: 'add_node', node })),
          { type: 'set_entry', nodeId: nodes[0].id },
        ]
      : nodes.map((node) => ({ type: 'add_node', node }));
    if (!input.replaceWholeGraph && !input.baseGraph.entryNodeId) {
      operations.push({ type: 'set_entry', nodeId: nodes[0].id });
    }
    generated.forEach((item, sourceIndex) => {
      const choices = Array.isArray(item.choices) ? item.choices as Array<Record<string, unknown>> : [];
      choices.forEach((choice) => {
        const rawCondition = choice.condition && typeof choice.condition === 'object' && !Array.isArray(choice.condition) ? choice.condition as Record<string, unknown> : {};
        let condition: PredicateAST = { op: 'always' };
        if (rawCondition.type === 'variable' && typeof rawCondition.variable === 'string' && stateVariables.has(rawCondition.variable)) {
          const variable = rawCondition.variable;
          const comparator = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(String(rawCondition.comparator)) ? rawCondition.comparator as 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' : 'eq';
          condition = { op: 'compare', variable, comparator, value: typeof rawCondition.value === 'boolean' || typeof rawCondition.value === 'number' || typeof rawCondition.value === 'string' ? rawCondition.value : true };
        } else if (rawCondition.type === 'fact' && typeof rawCondition.fact === 'string' && facts.has(rawCondition.fact)) {
          const fact = rawCondition.fact;
          condition = { op: 'has_fact', fact };
        }
        const effects: StateEffectAST[] = Array.isArray(choice.effects) ? choice.effects.flatMap((raw): StateEffectAST[] => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
          const effect = raw as Record<string, unknown>;
          if (effect.type === 'add_fact' || effect.type === 'remove_fact') {
            if (typeof effect.fact !== 'string' || !facts.has(effect.fact)) return [];
            return [{ type: effect.type, fact: effect.fact }];
          }
          if (typeof effect.variable !== 'string' || !stateVariables.has(effect.variable)) return [];
          const variable = effect.variable;
          if (effect.type === 'increment' || effect.type === 'decrement') return [{ type: effect.type, variable, amount: Number(effect.amount) || 1 }];
          if (effect.type === 'set' && (typeof effect.value === 'boolean' || typeof effect.value === 'number' || typeof effect.value === 'string')) return [{ type: 'set', variable, value: effect.value }];
          return [];
        }) : [];
        const transition: NarrativeTransition = {
          id: `choice-ai-${randomUUID()}`,
          sourceNodeId: nodes[sourceIndex].id,
          targetNodeId: resolveTarget(choice.targetNodeIndex ?? choice.targetNodeId, sourceIndex),
          text: stringOr(choice.text, '继续'),
          intent: stringOr(choice.intent, stringOr(choice.text, '推动故事继续发展')),
          condition,
          effects,
          interaction: {
            playerKnowledge: stringOr(choice.playerKnowledge, '玩家理解了当前选择带来的变化'),
            immediateFeedback: stringOr(choice.immediateFeedback, '故事立即回应了玩家的选择'),
            thematicMeaning: stringOr(choice.thematicMeaning, stringOr(choice.intent, '这个选择表达了玩家的立场')),
            consequenceHorizon: choice.consequenceHorizon === 'delayed' || choice.consequenceHorizon === 'chapter' || choice.consequenceHorizon === 'ending' ? choice.consequenceHorizon : 'immediate',
            convergenceStrategy: choice.convergenceStrategy === 'soft_converge' || choice.convergenceStrategy === 'hard_converge' || choice.convergenceStrategy === 'terminal' ? choice.convergenceStrategy : 'diverge',
            estimatedUniqueMediaSec: Math.max(0, Number(choice.estimatedUniqueMediaSec) || 0),
            replayValue: stringOr(choice.replayValue, '尝试另一种选择会看到不同发展'),
          },
        };
        operations.push({ type: 'add_transition', transition });
      });
    });
    if (input.selectedNodeId) {
      operations.push({
        type: 'add_transition',
        transition: {
          id: `choice-ai-entry-${randomUUID()}`,
          sourceNodeId: input.selectedNodeId,
          targetNodeId: nodes[0].id,
          text: '进入新分支', intent: '探索 AI 草案提出的新路径', effects: [],
          interaction: { playerKnowledge: '当前节点已提供的信息', immediateFeedback: '进入新情境', thematicMeaning: '承担分歧的后果', consequenceHorizon: 'delayed', convergenceStrategy: 'diverge', estimatedUniqueMediaSec: 0, replayValue: '新增一条可审阅路径' },
        },
      });
    }
    return operations;
  }

  private toStoryArchitecture(
    response: Record<string, unknown>,
    current: StoryArchitecture | undefined,
    candidateGraph: NarrativeGraphVersion,
    authorIntent: string,
    selectedNodeId?: string,
    formatProfile?: InteractionFormatProfile,
  ): StoryArchitecture {
    const base = normalizeStoryArchitecture(current || {
      premise: '', protagonistGoal: '', thematicQuestion: '', mandatoryNodes: [], variableNodes: [], endings: [],
      branchBudget: { maxDepth: 5, maxParallelBranches: 3 },
    });
    const existingBeats = new Map(base.storyBeats!.map((beat) => [beat.id, beat]));
    const selectedNode = selectedNodeId
      ? candidateGraph.nodes.find((node) => node.id === selectedNodeId)
      : undefined;
    const selectedBeat = selectedNode?.storyBeatIds
      ?.map((beatId) => existingBeats.get(beatId))
      .find((beat) => Boolean(beat));
    const selectedChapter = selectedBeat?.storyChapterId
      ? base.storyChapters!.find((chapter) => chapter.id === selectedBeat.storyChapterId)
      : undefined;
    const selectedBlock = selectedBeat?.productionBlockId
      ? base.productionBlocks!.find((block) => block.id === selectedBeat.productionBlockId)
      : undefined;
    const chapterId = selectedChapter?.id || `story-chapter-ai-${randomUUID()}`;
    const blockId = selectedBlock?.id || `production-block-ai-${randomUUID()}`;
    const newBeatIds: string[] = [];
    const storyBeats = [...base.storyBeats!];
    candidateGraph.nodes.forEach((node) => {
      const beatId = node.storyBeatIds?.[0] || `beat-${node.id}`;
      const existing = existingBeats.get(beatId);
      if (existing) return;
      newBeatIds.push(beatId);
      storyBeats.push({
        id: beatId,
        title: node.brief.title,
        dramaticPurpose: node.brief.intent,
        kind: node.brief.dramaticFunction === 'ending' ? 'ending' as const : node.brief.dramaticFunction === 'choice_point' ? 'variable' as const : 'mandatory' as const,
        durationRangeSec: node.interaction?.durationRangeSec || [30, 60] as [number, number],
        storyChapterId: chapterId,
        productionBlockId: blockId,
        endingContractId: node.brief.dramaticFunction === 'ending' ? `ending-${node.id}` : undefined,
      });
    });
    const endingContracts = [...base.endingContracts!];
    candidateGraph.nodes.filter((node) => node.brief.dramaticFunction === 'ending').forEach((node) => {
      const id = `ending-${node.id}`;
      if (!endingContracts.some((contract) => contract.id === id)) endingContracts.push({ id, title: node.brief.title, promise: node.brief.narrativeSummary, requiredBeatIds: [node.storyBeatIds?.[0] || `beat-${node.id}`] });
    });
    const newBeatRange = storyBeats
      .filter((beat) => newBeatIds.includes(beat.id))
      .map((beat) => beat.durationRangeSec)
      .reduce<[number, number]>((total, range) => [total[0] + range[0], total[1] + range[1]], [0, 0]);
    const storyEpisodes = base.storyEpisodes!.map((episode) => ({
      ...episode,
      storyChapterIds: [...episode.storyChapterIds],
    }));
    const storyChapters = base.storyChapters!.map((chapter) => ({
      ...chapter,
      storyBeatIds: [...chapter.storyBeatIds],
    }));
    if (newBeatIds.length > 0) {
      if (selectedChapter) {
        const index = storyChapters.findIndex((chapter) => chapter.id === selectedChapter.id);
        storyChapters[index] = {
          ...storyChapters[index],
          storyBeatIds: [...storyChapters[index].storyBeatIds, ...newBeatIds],
          targetDurationRangeSec: [
            storyChapters[index].targetDurationRangeSec[0] + newBeatRange[0],
            storyChapters[index].targetDurationRangeSec[1] + newBeatRange[1],
          ],
        };
      } else {
        let episodeId: string | undefined;
        if (formatProfile?.format === 'interactive_series') {
          const existingEpisode = storyEpisodes[storyEpisodes.length - 1];
          episodeId = existingEpisode?.id || `story-episode-ai-${randomUUID()}`;
          if (!existingEpisode) {
            const episodeTitle = typeof response.episodeTitle === 'string' && response.episodeTitle.trim()
              ? response.episodeTitle.trim()
              : '第1集';
            storyEpisodes.push({ id: episodeId, title: episodeTitle, storyChapterIds: [], order: 1 });
          }
        }
        const chapterTitle = typeof response.chapterTitle === 'string' && response.chapterTitle.trim()
          ? response.chapterTitle.trim()
          : storyChapters.length === 0 ? '第一章' : `第${storyChapters.length + 1}章`;
        storyChapters.push({
          id: chapterId,
          title: chapterTitle,
          summary: authorIntent,
          storyBeatIds: newBeatIds,
          targetDurationRangeSec: newBeatRange,
          order: storyChapters.filter((chapter) => chapter.episodeId === episodeId).length + 1,
          episodeId,
        });
        if (episodeId) {
          const index = storyEpisodes.findIndex((episode) => episode.id === episodeId);
          storyEpisodes[index] = {
            ...storyEpisodes[index],
            storyChapterIds: [...storyEpisodes[index].storyChapterIds, chapterId],
          };
        }
      }
    }
    const productionBlocks = base.productionBlocks!.map((block) => ({
      ...block,
      storyBeatIds: [...block.storyBeatIds],
    }));
    if (newBeatIds.length > 0) {
      if (selectedBlock) {
        const index = productionBlocks.findIndex((block) => block.id === selectedBlock.id);
        productionBlocks[index] = {
          ...productionBlocks[index],
          storyBeatIds: [...productionBlocks[index].storyBeatIds, ...newBeatIds],
          targetDurationRangeSec: [
            productionBlocks[index].targetDurationRangeSec[0] + newBeatRange[0],
            productionBlocks[index].targetDurationRangeSec[1] + newBeatRange[1],
          ],
        };
      } else {
        const chapterTitle = storyChapters.find((chapter) => chapter.id === chapterId)?.title || '故事章节';
        productionBlocks.push({
          id: blockId,
          title: `${chapterTitle}制作范围`,
          storyBeatIds: newBeatIds,
          targetDurationRangeSec: newBeatRange,
          status: 'draft',
        });
      }
    }
    const durationBudget = durationBudgetForFormat(base.durationBudget, formatProfile);
    return normalizeStoryArchitecture({
      ...base,
      premise: typeof response.premise === 'string' && response.premise.trim() ? response.premise.trim() : base.premise || authorIntent,
      protagonistGoal: typeof response.protagonistGoal === 'string' && response.protagonistGoal.trim() ? response.protagonistGoal.trim() : base.protagonistGoal,
      thematicQuestion: typeof response.thematicQuestion === 'string' && response.thematicQuestion.trim() ? response.thematicQuestion.trim() : base.thematicQuestion,
      storyBeats,
      storyChapters,
      storyEpisodes,
      endingContracts,
      endings: endingContracts.map((contract) => ({ id: contract.id, title: contract.title, description: contract.promise })),
      productionBlocks,
      durationBudget,
    });
  }

  private toRepairOperations(
    generatedOperations: GraphPatchOperation[],
    baseGraph: NarrativeGraphVersion,
    issueIds: string[],
  ): GraphPatchOperation[] {
    const operations: GraphPatchOperation[] = [];
    const addOperations = generatedOperations.filter((operation): operation is Extract<GraphPatchOperation, { type: 'add_node' }> => operation.type === 'add_node');
    const generatedEnding = addOperations.find((operation) => operation.node.brief.dramaticFunction === 'ending') || addOperations[0];
    let endingAdded = false;
    const ensureEnding = () => {
      if (!generatedEnding) throw new Error('AI 修复草案没有提供可用的结局节点');
      if (!endingAdded) {
        operations.push({
          type: 'add_node',
          node: {
            ...generatedEnding.node,
            brief: { ...generatedEnding.node.brief, dramaticFunction: 'ending' },
            choices: [],
            interaction: generatedEnding.node.interaction ? {
              ...generatedEnding.node.interaction,
              capabilities: ['play_content', 'terminal'],
            } : undefined,
          },
        });
        endingAdded = true;
      }
      return generatedEnding.node.id;
    };
    const nodeIds = new Set(baseGraph.nodes.map((node) => node.id));
    const transitions = baseGraph.transitions || baseGraph.nodes.flatMap((node) => node.choices.map((choice) => ({ ...choice, sourceNodeId: node.id })));
    const validEntry = nodeIds.has(baseGraph.entryNodeId) ? baseGraph.entryNodeId : baseGraph.nodes[0]?.id;
    const addConnection = (sourceNodeId: string, targetNodeId: string, label: string) => {
      operations.push({
        type: 'add_transition',
        transition: {
          id: `choice-ai-repair-${randomUUID()}`,
          sourceNodeId,
          targetNodeId,
          text: label,
          intent: '修复被检查发现的断裂路径',
          effects: [],
          interaction: { playerKnowledge: '玩家已掌握当前路径信息', immediateFeedback: '故事继续推进', thematicMeaning: '让已有选择产生可达后果', consequenceHorizon: 'immediate', convergenceStrategy: 'soft_converge', estimatedUniqueMediaSec: 0, replayValue: '恢复一条原本不可玩的路径' },
        },
      });
    };

    issueIds.forEach((issueId) => {
      if (issueId === 'err_missing_entry' && baseGraph.nodes[0]) {
        operations.push({ type: 'set_entry', nodeId: baseGraph.nodes[0].id });
        return;
      }
      if (issueId.startsWith('err_unreachable_')) {
        const nodeId = issueId.slice('err_unreachable_'.length);
        if (validEntry && nodeIds.has(nodeId) && validEntry !== nodeId) addConnection(validEntry, nodeId, '进入尚未连接的剧情');
        return;
      }
      if (issueId.startsWith('err_dead_end_')) {
        const nodeId = issueId.slice('err_dead_end_'.length);
        if (nodeIds.has(nodeId)) addConnection(nodeId, ensureEnding(), '面对这一段的最终结果');
        return;
      }
      if (issueId === 'err_no_endings') {
        const source = baseGraph.nodes.find((node) => node.choices.length === 0)?.id || validEntry;
        if (source && !operations.some((operation) => operation.type === 'add_transition' && operation.transition.sourceNodeId === source)) addConnection(source, ensureEnding(), '走向这一版的结局');
        return;
      }
      const brokenChoiceId = issueId.startsWith('err_broken_target_') ? issueId.slice('err_broken_target_'.length) : '';
      if (brokenChoiceId && transitions.some((transition) => transition.id === brokenChoiceId)) {
        operations.push({ type: 'update_transition', transitionId: brokenChoiceId, patch: { targetNodeId: ensureEnding() } });
        return;
      }
      const timeoutPrefixes = ['err_invalid_timeout_', 'err_incomplete_timeout_', 'err_broken_timeout_target_'];
      const timeoutPrefix = timeoutPrefixes.find((prefix) => issueId.startsWith(prefix));
      if (timeoutPrefix) {
        const transitionId = issueId.slice(timeoutPrefix.length);
        if (transitions.some((transition) => transition.id === transitionId)) operations.push({ type: 'update_transition', transitionId, patch: { timeoutSeconds: undefined, defaultTimeoutTargetNodeId: undefined } });
        return;
      }
      if (issueId.startsWith('err_conflicting_timeouts_')) {
        const nodeId = issueId.slice('err_conflicting_timeouts_'.length);
        transitions.filter((transition) => transition.sourceNodeId === nodeId).forEach((transition) => operations.push({ type: 'update_transition', transitionId: transition.id, patch: { timeoutSeconds: undefined, defaultTimeoutTargetNodeId: undefined } }));
        return;
      }
      if (issueId.startsWith('err_duration_') || issueId.startsWith('warn_duration_')) {
        generatedOperations.forEach((operation) => {
          if (operation.type !== 'set_entry' && !operations.some((candidate) => JSON.stringify(candidate) === JSON.stringify(operation))) operations.push(operation);
        });
      }
    });
    if (operations.length === 0) throw new Error('这些检查项暂时不能自动修复，请让 AI 根据具体问题重新设计相关节点。');
    return operations;
  }

  private buildDraft(input: Omit<InteractiveGraphDraft, 'id' | 'baseGraphVersionId' | 'baseGraphVersionIndex' | 'impact' | 'qa' | 'audit' | 'status' | 'createdAt'> & { baseGraph: NarrativeGraphVersion; modelCall?: ModelCallMetadata }) {
    const candidateGraph = applyGraphPatch(input.baseGraph, input.operations);
    const beforeDuration = summarizeInteractiveGraphDuration(input.baseGraph);
    const afterDuration = summarizeInteractiveGraphDuration(candidateGraph);
    const midpoint = (range?: [number, number]) => range ? Math.round((range[0] + range[1]) / 2) : 0;
    const uniqueMedia = (graph: NarrativeGraphVersion) => {
      const transitions = graph.transitions?.length ? graph.transitions : graph.nodes.flatMap((node) => node.choices);
      return transitions.reduce((total, transition) => total + Math.max(0, transition.interaction?.estimatedUniqueMediaSec || 0), 0);
    };
    const draft: InteractiveGraphDraft = {
      id: `draft-${randomUUID()}`,
      experienceId: input.experienceId,
      revisionOfDraftId: input.revisionOfDraftId,
      baseGraphVersionId: input.baseGraph.id,
      baseGraphVersionIndex: input.baseGraph.versionIndex,
      scope: input.scope,
      authorIntent: input.authorIntent,
      summary: input.summary,
      operations: input.operations,
      proposedStateSchema: input.proposedStateSchema,
      proposedStoryArchitecture: input.proposedStoryArchitecture,
      impact: computeDraftImpact(diffNarrativeGraphs(input.baseGraph, candidateGraph), {
        p50DurationDeltaSec: midpoint(afterDuration.typicalPath?.durationRangeSec) - midpoint(beforeDuration.typicalPath?.durationRangeSec),
        p90DurationDeltaSec: midpoint(afterDuration.reachableUniqueRangeSec) - midpoint(beforeDuration.reachableUniqueRangeSec),
        uniqueMediaDeltaSec: uniqueMedia(candidateGraph) - uniqueMedia(input.baseGraph),
      }),
      qa: { blocking: [], warnings: [], coverageIncomplete: false },
      audit: {
        promptTemplate,
        inputGraphVersionId: input.baseGraph.id,
        inputGraphVersionIndex: input.baseGraph.versionIndex,
        provider: typeof input.modelCall?.provider === 'string' ? input.modelCall.provider : undefined,
        modelId: typeof input.modelCall?.modelId === 'string' ? input.modelCall.modelId : undefined,
        providerRequestId: typeof input.modelCall?.providerRequestId === 'string' ? input.modelCall.providerRequestId : undefined,
        inputTokens: typeof input.modelCall?.inputTokens === 'number' ? input.modelCall.inputTokens : undefined,
        outputTokens: typeof input.modelCall?.outputTokens === 'number' ? input.modelCall.outputTokens : undefined,
        events: [{ type: 'generated', at: new Date().toISOString() }],
      },
      status: 'candidate',
      createdAt: new Date().toISOString(),
    };
    draft.qa = auditDraftCandidateGraph(input.baseGraph, draft, input.proposedStateSchema, input.proposedStoryArchitecture?.durationBudget).draftQA;
    return draft;
  }
}
