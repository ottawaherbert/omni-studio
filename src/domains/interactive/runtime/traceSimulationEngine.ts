import type { NarrativeGraphVersion, StateSchema } from '../types/schema.ts';
import { createInitialStateContext, evaluatePredicate, applyStateEffects, type RuntimeStateContext } from '../interpreter/stateInterpreter.ts';
import { hasNodeCapability } from '../nodeContentRequirements.ts';

export interface PathTraceStep {
  nodeId: string;
  choiceId?: string;
  chosenText?: string;
}

export interface SimulationPathResult {
  reachedEndingId?: string;
  reachedFailureNodeId?: string;
  isDeadlock: boolean;
  truncated?: boolean;
  steps: PathTraceStep[];
  finalContext: RuntimeStateContext;
}

export function simulateSinglePath(
  graph: NarrativeGraphVersion,
  schema: StateSchema,
  choiceDecisionStrategy: (availableChoices: Array<{ id: string; targetNodeId: string; text: string }>) => number = () => 0
): SimulationPathResult {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  let currentCtx = createInitialStateContext(schema);
  const steps: PathTraceStep[] = [];

  let currentNodeId = graph.entryNodeId;
  const maxSteps = 100; // Prevention against infinite loops
  let stepCount = 0;

  while (currentNodeId && stepCount < maxSteps) {
    stepCount++;
    const node = nodeMap.get(currentNodeId);
    if (!node) break;

    // Track node visit
    currentCtx.visitedNodes[currentNodeId] = (currentCtx.visitedNodes[currentNodeId] || 0) + 1;
    steps.push({ nodeId: currentNodeId });

    if (node.brief?.dramaticFunction === 'ending' || hasNodeCapability(node, 'terminal')) {
      return {
        reachedEndingId: currentNodeId,
        isDeadlock: false,
        steps,
        finalContext: currentCtx,
      };
    }
    if (hasNodeCapability(node, 'fail_or_retry')) {
      return { reachedFailureNodeId: currentNodeId, isDeadlock: false, steps, finalContext: currentCtx };
    }

    if (node.choices.length === 0) {
      return {
        isDeadlock: true,
        steps,
        finalContext: currentCtx,
      };
    }

    // Evaluate unlocked choices
    const unlockedChoices = node.choices.filter(
      (c) => !c.condition || evaluatePredicate(c.condition, currentCtx)
    );

    if (unlockedChoices.length === 0) {
      // Deadlock! No unlocked choices
      return {
        isDeadlock: true,
        steps,
        finalContext: currentCtx,
      };
    }

    const choiceIdx = Math.min(
      Math.max(0, choiceDecisionStrategy(unlockedChoices)),
      unlockedChoices.length - 1
    );
    const chosenChoice = unlockedChoices[choiceIdx];

    steps[steps.length - 1].choiceId = chosenChoice.id;
    steps[steps.length - 1].chosenText = chosenChoice.text;

    // Apply choice state effects
    currentCtx = applyStateEffects(chosenChoice.effects, currentCtx, schema);
    currentNodeId = chosenChoice.targetNodeId;
  }

  return {
    isDeadlock: stepCount < maxSteps,
    truncated: stepCount >= maxSteps,
    steps,
    finalContext: currentCtx,
  };
}
