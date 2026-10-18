import type {
  ChoiceInteractionContract,
  NarrativeGraphVersion,
  NarrativeNode,
  NodeInteractionContract,
  StateEffectAST,
  StateSchema,
} from '../types/schema.ts';
import { getFactDefinitions, getInitialFactIds } from '../types/schema.ts';

const duplicates = (values: string[]) => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  });
  return Array.from(repeated);
};

const validateEffect = (
  effect: StateEffectAST,
  node: NarrativeNode,
  knownVariables: Map<string, StateSchema['variables'][number]>,
  knownFacts: Set<string>,
) => {
  const issues: string[] = [];
  if ('variable' in effect) {
    const variable = knownVariables.get(effect.variable);
    if (!variable) {
      issues.push(`节点“${node.brief.title}”写入了未定义变量“${effect.variable}”`);
    } else if (
      (effect.type === 'increment' || effect.type === 'decrement')
      && variable.type !== 'number'
    ) {
      issues.push(`节点“${node.brief.title}”对非数值变量“${effect.variable}”执行了数值运算`);
    } else if (effect.type === 'set') {
      const expectedType = variable.type === 'enum' ? 'string' : variable.type;
      if (typeof effect.value !== expectedType || (variable.type === 'enum' && !variable.enumValues?.includes(String(effect.value)))) {
        issues.push(`节点“${node.brief.title}”给变量“${effect.variable}”写入了不符合类型或枚举范围的值`);
      }
    } else if (!Number.isFinite(effect.amount) || effect.amount < 0) {
      issues.push(`节点“${node.brief.title}”对变量“${effect.variable}”的增减量必须是非负有限数`);
    }
  }
  if ('fact' in effect && !knownFacts.has(effect.fact)) {
    issues.push(`节点“${node.brief.title}”写入了未登记事实“${effect.fact}”`);
  }
  return issues;
};

const validatePredicate = (
  predicate: import('../types/schema.ts').PredicateAST,
  node: NarrativeNode,
  knownVariables: Map<string, StateSchema['variables'][number]>,
  knownFacts: Set<string>,
  knownNodes: Set<string>,
): string[] => {
  if (predicate.op === 'all' || predicate.op === 'any') return predicate.predicates.flatMap((part) => validatePredicate(part, node, knownVariables, knownFacts, knownNodes));
  if (predicate.op === 'not') return validatePredicate(predicate.predicate, node, knownVariables, knownFacts, knownNodes);
  if (predicate.op === 'has_fact') return knownFacts.has(predicate.fact) ? [] : [`节点“${node.brief.title}”的条件引用未登记事实“${predicate.fact}”`];
  if (predicate.op === 'visited' && !knownNodes.has(predicate.nodeId)) return [`节点“${node.brief.title}”的访问条件引用不存在的节点“${predicate.nodeId}”`];
  if (predicate.op === 'visited') return Number.isInteger(predicate.minTimes ?? 1) && (predicate.minTimes ?? 1) >= 0
    ? [] : [`节点“${node.brief.title}”的访问次数条件无效`];
  if (predicate.op !== 'compare') return [];
  const variable = knownVariables.get(predicate.variable);
  if (!variable) return [`节点“${node.brief.title}”的条件引用未定义变量“${predicate.variable}”`];
  const expectedType = variable.type === 'enum' ? 'string' : variable.type;
  if (typeof predicate.value !== expectedType || (variable.type === 'enum' && !variable.enumValues?.includes(String(predicate.value)))) {
    return [`节点“${node.brief.title}”的变量“${predicate.variable}”条件值不符合类型或枚举范围`];
  }
  if (!['eq', 'neq'].includes(predicate.comparator) && variable.type !== 'number') {
    return [`节点“${node.brief.title}”的变量“${predicate.variable}”只有数值类型支持大小比较`];
  }
  return [];
};

const validDurationRange = (range: [number, number] | undefined) => Boolean(
  range
  && Number.isFinite(range[0])
  && Number.isFinite(range[1])
  && range[0] > 0
  && range[0] <= range[1],
);

const validateNodeInteraction = (node: NarrativeNode, interaction: NodeInteractionContract | undefined): string[] => {
  const issues: string[] = [];
  if (!interaction) return [`节点“${node.brief.title || node.id}”缺少运行与内容合同`];
  const capabilities = Array.isArray(interaction.capabilities) ? interaction.capabilities : [];
  if (!capabilities.length) issues.push(`节点“${node.brief.title || node.id}”至少需要一种运行能力`);
  if (!validDurationRange(interaction.durationRangeSec)) issues.push(`节点“${node.brief.title || node.id}”时长范围无效`);
  if (node.brief.dramaticFunction === 'ending' && !capabilities.includes('terminal')) {
    issues.push(`结局节点“${node.brief.title || node.id}”必须声明 terminal 运行能力`);
  }
  if (node.choices.length > 0 && !capabilities.includes('present_choice')) {
    issues.push(`含选择的节点“${node.brief.title || node.id}”必须声明 present_choice 运行能力`);
  }
  return issues;
};

const validateChoiceInteraction = (node: NarrativeNode, choice: { text: string; id: string }, interaction: ChoiceInteractionContract | undefined): string[] => {
  const issues: string[] = [];
  if (!interaction) return [`选择“${choice.text || choice.id}”缺少玩家知情与后果合同`];
  if (!interaction.playerKnowledge.trim()) issues.push(`选择“${choice.text || choice.id}”必须说明玩家已知信息`);
  if (!interaction.immediateFeedback.trim()) issues.push(`选择“${choice.text || choice.id}”必须说明即时反馈`);
  if (!interaction.thematicMeaning.trim()) issues.push(`选择“${choice.text || choice.id}”必须说明它的戏剧意义`);
  if (!interaction.replayValue.trim()) issues.push(`选择“${choice.text || choice.id}”必须说明重玩新增价值或明确无新增价值`);
  if (!Number.isFinite(interaction.estimatedUniqueMediaSec) || interaction.estimatedUniqueMediaSec < 0) {
    issues.push(`选择“${choice.text || choice.id}”的独占媒体秒数无效`);
  }
  return issues;
};

export function validateStateSchema(stateSchema: StateSchema): string[] {
  const issues: string[] = [];
  const variableKeys = stateSchema.variables.map((variable) => variable.key.trim());
  const facts = getFactDefinitions(stateSchema).map((fact) => fact.trim());
  const initialFactIds = getInitialFactIds(stateSchema).map((fact) => fact.trim());

  if (variableKeys.some((key) => !key)) issues.push('状态变量 key 不能为空');
  if (facts.some((fact) => !fact)) issues.push('事实标签不能为空');
  duplicates(variableKeys).forEach((key) => issues.push(`状态变量“${key}”重复`));
  duplicates(facts).forEach((fact) => issues.push(`事实标签“${fact}”重复`));
  duplicates(initialFactIds).forEach((fact) => issues.push(`开局事实“${fact}”重复`));
  initialFactIds
    .filter((fact) => !facts.includes(fact))
    .forEach((fact) => issues.push(`开局事实“${fact}”未在事实定义中登记`));

  stateSchema.variables.forEach((variable) => {
    const value = variable.defaultValue;
    if (variable.type === 'boolean' && typeof value !== 'boolean') {
      issues.push(`变量“${variable.key}”的默认值必须是布尔值`);
    }
    if (variable.type === 'number' && typeof value !== 'number') {
      issues.push(`变量“${variable.key}”的默认值必须是数值`);
    }
    if ((variable.type === 'string' || variable.type === 'enum') && typeof value !== 'string') {
      issues.push(`变量“${variable.key}”的默认值必须是字符串`);
    }
    if (variable.type === 'number' && variable.min != null && variable.max != null && variable.min > variable.max) {
      issues.push(`变量“${variable.key}”的最小值不能大于最大值`);
    }
    if (variable.type === 'enum') {
      const enumValues = variable.enumValues?.map((item) => item.trim()).filter(Boolean) || [];
      if (enumValues.length === 0) issues.push(`枚举变量“${variable.key}”必须声明可选值`);
      if (typeof value === 'string' && enumValues.length > 0 && !enumValues.includes(value)) {
        issues.push(`枚举变量“${variable.key}”的默认值不在可选值中`);
      }
    }
  });

  return issues;
}

export function validateNarrativeGraph(
  graph: Pick<NarrativeGraphVersion, 'entryNodeId' | 'nodes' | 'semanticContractVersion'>,
  stateSchema: StateSchema,
): string[] {
  const issues: string[] = [];
  const nodeIds = graph.nodes.map((node) => node.id.trim());
  const knownNodes = new Set(nodeIds);
  const choiceIds = graph.nodes.flatMap((node) => node.choices.map((choice) => choice.id.trim()));
  const knownVariables = new Map(stateSchema.variables.map((variable) => [variable.key, variable]));
  const knownFacts = new Set(getFactDefinitions(stateSchema));
  const requiresSemanticContracts = graph.semanticContractVersion === 2;

  if (nodeIds.some((id) => !id)) issues.push('节点 ID 不能为空');
  duplicates(nodeIds).forEach((id) => issues.push(`节点 ID“${id}”重复`));
  duplicates(choiceIds).forEach((id) => issues.push(`选择 ID“${id}”重复`));

  graph.nodes.forEach((node) => {
    if (node.brief.nodeId !== node.id) {
      issues.push(`节点“${node.brief.title || node.id}”的 brief.nodeId 与节点 ID 不一致`);
    }
    if (!node.brief.title.trim()) issues.push(`节点“${node.id}”缺少标题`);
    if (!node.brief.intent.trim()) issues.push(`节点“${node.brief.title || node.id}”缺少戏剧意图`);
    if (requiresSemanticContracts) issues.push(...validateNodeInteraction(node, node.interaction));
    node.contract.readVariables.concat(node.contract.writeVariables).forEach((key) => {
      if (!knownVariables.has(key)) issues.push(`节点“${node.brief.title}”引用了未定义变量“${key}”`);
    });
    node.contract.requiredFacts.concat(node.contract.producedFacts).forEach((fact) => {
      if (!knownFacts.has(fact)) issues.push(`节点“${node.brief.title}”引用了未登记事实“${fact}”`);
    });
    node.choices.forEach((choice) => {
      if (!knownNodes.has(choice.targetNodeId)) issues.push(`选择“${choice.text || choice.id}”的目标节点不存在`);
      if (choice.defaultTimeoutTargetNodeId && !knownNodes.has(choice.defaultTimeoutTargetNodeId)) issues.push(`选择“${choice.text || choice.id}”的超时目标节点不存在`);
      if (!choice.id.trim()) issues.push(`节点“${node.brief.title}”存在缺少 ID 的选择`);
      if (!choice.text.trim()) issues.push(`节点“${node.brief.title}”存在缺少文案的选择`);
      if (!choice.intent.trim()) issues.push(`选择“${choice.text || choice.id}”缺少玩家意图`);
      if (requiresSemanticContracts) issues.push(...validateChoiceInteraction(node, choice, choice.interaction));
      choice.effects.forEach((effect) => {
        issues.push(...validateEffect(effect, node, knownVariables, knownFacts));
      });
      if (choice.condition) issues.push(...validatePredicate(choice.condition, node, knownVariables, knownFacts, knownNodes));
    });
  });

  return Array.from(new Set(issues));
}
