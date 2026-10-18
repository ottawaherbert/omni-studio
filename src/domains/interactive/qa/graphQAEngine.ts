import {
  getFactDefinitions,
  type DurationBudget,
  type NarrativeGraphVersion,
  type NarrativeNode,
  type PredicateAST,
  type StateSchema,
} from '../types/schema.ts';
import { auditExecutableStateSpace } from './stateSpaceQA.ts';
import { hasNodeCapability } from '../nodeContentRequirements.ts';
import { validateNarrativeGraph, validateStateSchema } from '../validation/domainValidation.ts';

export interface GraphQAIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: 'reachability' | 'dangling' | 'ending' | 'state_contract' | 'choice_meaning' | 'duration';
  message: string;
  nodeId?: string;
  choiceId?: string;
}

export interface GraphQAResult {
  passed: boolean;
  issues: GraphQAIssue[];
  reachableNodeIds: string[];
  endingCount: number;
  durationAudit?: GraphDurationAudit;
  stateSpace?: ReturnType<typeof auditExecutableStateSpace>;
}

export interface GraphDurationAudit {
  completedPathRanges: Array<[number, number]>;
  reachableUniqueRange: [number, number];
  pathCount: number;
  truncated: boolean;
}

const MAX_DURATION_PATHS = 512;

const isUsableDurationRange = (range: [number, number] | undefined): range is [number, number] => Boolean(
  range
  && Number.isFinite(range[0])
  && Number.isFinite(range[1])
  && range[0] > 0
  && range[0] <= range[1],
);

/**
 * Bounded structural path enumeration. It deliberately never retries and does
 * not execute predicates: conditions are state-space work. This check answers
 * the smaller but important question: can the authored graph possibly keep
 * its duration and choice promises under its own node contracts?
 */
const auditDurationBudget = (
  graph: NarrativeGraphVersion,
  budget: DurationBudget,
  nodeMap: Map<string, NarrativeNode>,
  reachableNodeIds: Set<string>,
  issues: GraphQAIssue[],
): GraphDurationAudit => {
  const completedPathRanges: Array<[number, number]> = [];
  let truncated = false;
  const visit = (nodeId: string, visited: Set<string>, total: [number, number]) => {
    if (completedPathRanges.length >= MAX_DURATION_PATHS) {
      truncated = true;
      return;
    }
    const node = nodeMap.get(nodeId);
    if (!node || !reachableNodeIds.has(nodeId)) return;
    const range = node.interaction?.durationRangeSec;
    const nextTotal: [number, number] = isUsableDurationRange(range)
      ? [total[0] + range[0], total[1] + range[1]]
      : total;
    if (node.brief.dramaticFunction === 'ending') {
      completedPathRanges.push(nextTotal);
      return;
    }
    node.choices
      .filter((choice) => choice.targetNodeId && nodeMap.has(choice.targetNodeId))
      .filter((choice) => choice.condition?.op !== 'never')
      .forEach((choice) => {
        if (visited.has(choice.targetNodeId)) {
          truncated = true;
          return;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(choice.targetNodeId);
        visit(choice.targetNodeId, nextVisited, nextTotal);
      });
  };

  if (graph.entryNodeId && nodeMap.has(graph.entryNodeId)) {
    visit(graph.entryNodeId, new Set([graph.entryNodeId]), [0, 0]);
  }

  const reachableUniqueRange = Array.from(reachableNodeIds).reduce<[number, number]>((total, nodeId) => {
    const range = nodeMap.get(nodeId)?.interaction?.durationRangeSec;
    return isUsableDurationRange(range)
      ? [total[0] + range[0], total[1] + range[1]]
      : total;
  }, [0, 0]);
  const tolerance = budget.tolerancePercent / 100;
  const p50Range: [number, number] = [
    budget.p50TargetSec * (1 - tolerance),
    budget.p50TargetSec * (1 + tolerance),
  ];
  const p90LowerBound = budget.p90TargetSec * (1 - tolerance);
  const overlapsP50 = completedPathRanges.some((range) => range[0] <= p50Range[1] && range[1] >= p50Range[0]);

  if (completedPathRanges.length > 0 && !overlapsP50) {
    issues.push({
      id: 'err_duration_no_p50_path',
      severity: 'error',
      category: 'duration',
      message: `没有任何完整路径覆盖 P50 目标 ${Math.round(p50Range[0])}-${Math.round(p50Range[1])} 秒；请调整节点时长、路径结构或体验承诺`,
    });
  }
  if (completedPathRanges.some((range) => range[1] < p50Range[0] || range[0] > p50Range[1])) {
    issues.push({
      id: 'warn_duration_outlier_path',
      severity: 'warning',
      category: 'duration',
      message: '存在完整路径明显偏离 P50 时长承诺；请确认它是有意的短失败结局或长探索路径',
    });
  }
  if (reachableUniqueRange[1] < p90LowerBound) {
    issues.push({
      id: 'err_duration_no_p90_content',
      severity: 'error',
      category: 'duration',
      message: `全部可达节点最长合计 ${reachableUniqueRange[1]} 秒，无法覆盖 P90 完整探索下限 ${Math.round(p90LowerBound)} 秒`,
    });
  }
  Array.from(reachableNodeIds).forEach((nodeId) => {
    const node = nodeMap.get(nodeId)!;
    const range = node.interaction?.durationRangeSec;
    if (
      node.brief.dramaticFunction !== 'ending'
      && isUsableDurationRange(range)
      && range[1] > budget.maxSecondsWithoutChoice
    ) {
      issues.push({
        id: `err_duration_choice_gap_${node.id}`,
        severity: 'error',
        category: 'duration',
        nodeId: node.id,
        message: `节点“${node.brief.title || node.id}”最长 ${range[1]} 秒，超过最长无选择间隔 ${budget.maxSecondsWithoutChoice} 秒；请拆分节点或在中段设置选择`,
      });
    }
  });
  if (truncated) {
    issues.push({
      id: 'warn_duration_path_budget',
      severity: 'warning',
      category: 'duration',
      message: '路径时长检查达到有界探索上限或遇到循环；开始试玩后请使用状态空间试玩复核循环与完整探索时长',
    });
  }

  return {
    completedPathRanges,
    reachableUniqueRange,
    pathCount: completedPathRanges.length,
    truncated,
  };
};

export function auditNarrativeGraph(
  graph: NarrativeGraphVersion,
  stateSchema?: StateSchema,
  durationBudget?: DurationBudget,
  includeTimeoutBranches = true,
): GraphQAResult {
  const issues: GraphQAIssue[] = [];
  const nodeMap = new Map<string, NarrativeNode>(graph.nodes.map((n) => [n.id, n]));
  const knownVariables = new Set(stateSchema?.variables.map((v) => v.key) || []);
  const knownFacts = new Set(getFactDefinitions(stateSchema));
  const validateStateReferences = stateSchema != null;
  if (stateSchema) {
    [...validateStateSchema(stateSchema), ...validateNarrativeGraph(graph, stateSchema)].forEach((message, index) => {
      issues.push({ id: `err_invalid_contract_${index}`, severity: 'error', category: 'state_contract', message });
    });
  }

  // 1. Check entry node existence
  if (!graph.entryNodeId || !nodeMap.has(graph.entryNodeId)) {
    issues.push({
      id: 'err_missing_entry',
      severity: 'error',
      category: 'reachability',
      message: `图谱入口节点 "${graph.entryNodeId}" 不存在`,
    });
  }

  // 2. Reachability Traversal (BFS)
  const reachableNodeIds = new Set<string>();
  if (graph.entryNodeId && nodeMap.has(graph.entryNodeId)) {
    const queue = [graph.entryNodeId];
    reachableNodeIds.add(graph.entryNodeId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const node = nodeMap.get(currentId);
      if (!node) continue;

      for (const choice of node.choices) {
        if (choice.targetNodeId && nodeMap.has(choice.targetNodeId)) {
          if (!reachableNodeIds.has(choice.targetNodeId)) {
            reachableNodeIds.add(choice.targetNodeId);
            queue.push(choice.targetNodeId);
          }
        }
      }
    }
  }

  // 3. Detect unreachable nodes (Dangling)
  for (const node of graph.nodes) {
    if (!reachableNodeIds.has(node.id)) {
      issues.push({
        id: `err_unreachable_${node.id}`,
        severity: 'error',
        category: 'dangling',
        message: `节点 "${node.brief?.title || node.id}" 不可达`,
        nodeId: node.id,
      });
    }
  }

  // 4. Check endings and Choice validity
  let endingCount = 0;
  for (const node of graph.nodes) {
    if (node.brief?.dramaticFunction === 'ending') {
      endingCount++;
    } else if (node.choices.length === 0 && !hasNodeCapability(node, 'fail_or_retry')) {
      issues.push({
        id: `err_dead_end_${node.id}`,
        severity: 'error',
        category: 'ending',
        message: `非结局节点 "${node.brief?.title || node.id}" 没有可继续的选择`,
        nodeId: node.id,
      });
    }

    // Check invalid choice targets & undefined variables in Predicates
    const timedChoiceKeys = new Set<string>();
    for (const choice of node.choices) {
      if (!choice.targetNodeId || !nodeMap.has(choice.targetNodeId)) {
        issues.push({
          id: `err_broken_target_${choice.id}`,
          severity: 'error',
          category: 'reachability',
          message: `选项 "${choice.text}" 的目标节点 "${choice.targetNodeId}" 不存在`,
          nodeId: node.id,
          choiceId: choice.id,
        });
      }

      if (choice.condition) {
        validatePredicateVariables(
          choice.condition,
          knownVariables,
          knownFacts,
          validateStateReferences,
          node.id,
          choice.id,
          issues,
        );
      }

      const hasTimeout = choice.timeoutSeconds !== undefined;
      const hasDefaultTimeoutTarget = Boolean(choice.defaultTimeoutTargetNodeId);
      if (hasTimeout && (!Number.isFinite(choice.timeoutSeconds) || choice.timeoutSeconds! <= 0)) {
        issues.push({
          id: `err_invalid_timeout_${choice.id}`,
          severity: 'error',
          category: 'choice_meaning',
          message: `选项 "${choice.text}" 的限时秒数必须是大于 0 的数字`,
          nodeId: node.id,
          choiceId: choice.id,
        });
      }
      if (hasTimeout !== hasDefaultTimeoutTarget) {
        issues.push({
          id: `err_incomplete_timeout_${choice.id}`,
          severity: 'error',
          category: 'choice_meaning',
          message: `选项 "${choice.text}" 的限时选择必须同时声明限时秒数和默认去向`,
          nodeId: node.id,
          choiceId: choice.id,
        });
      }
      if (hasDefaultTimeoutTarget && !nodeMap.has(choice.defaultTimeoutTargetNodeId!)) {
        issues.push({
          id: `err_broken_timeout_target_${choice.id}`,
          severity: 'error',
          category: 'choice_meaning',
          message: `选项 "${choice.text}" 的超时默认节点 "${choice.defaultTimeoutTargetNodeId}" 不存在`,
          nodeId: node.id,
          choiceId: choice.id,
        });
      }
      if (hasTimeout && hasDefaultTimeoutTarget) {
        timedChoiceKeys.add(`${choice.timeoutSeconds}:${choice.defaultTimeoutTargetNodeId}`);
      }
    }
    if (timedChoiceKeys.size > 1) {
      issues.push({
        id: `err_conflicting_timeouts_${node.id}`,
        severity: 'error',
        category: 'choice_meaning',
        message: `节点 "${node.brief?.title || node.id}" 声明了相互冲突的限时默认去向；一个选择时刻只能有一个倒计时和默认分支`,
        nodeId: node.id,
      });
    }
  }

  // 5. Ending coverage check
  if (endingCount === 0) {
    issues.push({
      id: 'err_no_endings',
      severity: 'error',
      category: 'ending',
      message: '图谱缺失有效结局 (Ending Node)，所有分支均为死路',
    });
  }

  const durationAudit = durationBudget
    ? auditDurationBudget(graph, durationBudget, nodeMap, reachableNodeIds, issues)
    : undefined;

  const stateSpace = stateSchema ? auditExecutableStateSpace(graph, stateSchema, includeTimeoutBranches) : undefined;
  if (stateSpace) {
    stateSpace.deadlockNodeIds.forEach((nodeId) => issues.push({
      id: `err_runtime_deadlock_${nodeId}`,
      severity: 'error', category: 'reachability', nodeId,
      message: `状态路径可到达节点“${nodeMap.get(nodeId)?.brief.title || nodeId}”，但当前状态无法继续到达结局或失败处理节点`,
    }));
    if (stateSpace.complete && stateSpace.reachableEndingIds.length === 0 && endingCount > 0) issues.push({
      id: 'err_no_reachable_ending', severity: 'error', category: 'ending',
      message: '图上虽有结局，但按当前状态条件没有可到达的结局',
    });
    if (!stateSpace.complete) issues.push({
      id: 'warn_state_exploration_incomplete', severity: 'warning', category: 'reachability',
      message: '状态空间探索达到上限；结果不代表所有分支均已检查，请缩小状态范围或继续人工试玩',
    });
  }
  const hasErrors = issues.some((i) => i.severity === 'error');

  return {
    passed: !hasErrors,
    issues,
    reachableNodeIds: Array.from(reachableNodeIds),
    endingCount,
    durationAudit,
    stateSpace,
  };
}

function validatePredicateVariables(
  pred: PredicateAST,
  knownVariables: Set<string>,
  knownFacts: Set<string>,
  validateStateReferences: boolean,
  nodeId: string,
  choiceId: string,
  issues: GraphQAIssue[]
) {
  switch (pred.op) {
    case 'compare':
      if (validateStateReferences && !knownVariables.has(pred.variable)) {
        issues.push({
          id: `err_undef_var_${choiceId}_${pred.variable}`,
          severity: 'error',
          category: 'state_contract',
          message: `条件中使用了未定义的状态变量 "${pred.variable}"`,
          nodeId,
          choiceId,
        });
      }
      break;
    case 'has_fact':
      if (validateStateReferences && !knownFacts.has(pred.fact)) {
        issues.push({
          id: `err_undef_fact_${choiceId}_${pred.fact}`,
          severity: 'error',
          category: 'state_contract',
          message: `条件引用的事实 "${pred.fact}" 未在 schema 中登记`,
          nodeId,
          choiceId,
        });
      }
      break;
    case 'all':
    case 'any':
      pred.predicates.forEach((p) => validatePredicateVariables(
        p,
        knownVariables,
        knownFacts,
        validateStateReferences,
        nodeId,
        choiceId,
        issues,
      ));
      break;
    case 'not':
      validatePredicateVariables(
        pred.predicate,
        knownVariables,
        knownFacts,
        validateStateReferences,
        nodeId,
        choiceId,
        issues,
      );
      break;
  }
}
