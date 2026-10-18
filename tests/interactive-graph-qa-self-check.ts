import { auditNarrativeGraph } from '../src/domains/interactive/qa/graphQAEngine.ts';
import type { NarrativeGraphVersion, StateSchema } from '../src/domains/interactive/types/schema.ts';

function runGraphQASelfCheck() {
  console.log('[Interactive Graph QA Self-Check] Testing QA engine against negative matrix...');

  const schema: StateSchema = {
    variables: [{ key: 'trust', type: 'number', scope: 'session', defaultValue: 0 }],
    facts: ['FACT_KEY_FOUND'],
  };

  // Negative Matrix Test 1: Broken Link Target & No Endings
  const brokenGraph: NarrativeGraphVersion = {
    id: 'graph_v1',
    experienceId: 'exp_1',
    versionIndex: 1,
    entryNodeId: 'node_start',
    locked: false,
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node_start',
        brief: { nodeId: 'node_start', title: 'Start', intent: 'Intro', dramaticFunction: 'exposition', narrativeSummary: 'Start' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [
          { id: 'c1', text: 'Go to missing', intent: 'Move', targetNodeId: 'node_non_existent', effects: [] },
        ],
        bindings: [],
      },
    ],
  };

  const result1 = auditNarrativeGraph(brokenGraph, schema);
  if (result1.passed) {
    throw new Error('Graph QA failed to reject graph with broken link target and missing endings');
  }
  const hasTargetErr = result1.issues.some((i) => i.id.startsWith('err_broken_target'));
  const hasEndingErr = result1.issues.some((i) => i.id === 'err_no_endings');
  if (!hasTargetErr || !hasEndingErr) {
    throw new Error('Graph QA failed to detect specific broken link target or missing ending issues');
  }

  // Negative Matrix Test 2: Undefined Variable in Predicate
  const undefVarGraph: NarrativeGraphVersion = {
    id: 'graph_v2',
    experienceId: 'exp_1',
    versionIndex: 1,
    entryNodeId: 'node_1',
    locked: false,
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node_1',
        brief: { nodeId: 'node_1', title: 'Node 1', intent: 'Choice', dramaticFunction: 'choice_point', narrativeSummary: 'Test' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [
          {
            id: 'c_undef',
            text: 'Check ghost var',
            intent: 'Test',
            targetNodeId: 'node_end',
            condition: { op: 'compare', variable: 'non_existent_var', comparator: 'eq', value: 100 },
            effects: [],
          },
        ],
        bindings: [],
      },
      {
        id: 'node_end',
        brief: { nodeId: 'node_end', title: 'End', intent: 'Ending', dramaticFunction: 'ending', narrativeSummary: 'End' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
        bindings: [],
      },
    ],
  };

  const result2 = auditNarrativeGraph(undefVarGraph, schema);
  if (result2.passed) {
    throw new Error('Graph QA failed to reject predicate with undefined variable');
  }
  const hasUndefVarErr = result2.issues.some((i) => i.id.startsWith('err_undef_var'));
  if (!hasUndefVarErr) {
    throw new Error('Graph QA failed to report undefined variable issue');
  }
  const result2b = auditNarrativeGraph(undefVarGraph, { variables: [], facts: [] });
  if (result2b.passed || !result2b.issues.some((issue) => issue.id.startsWith('err_undef_var'))) {
    throw new Error('Graph QA must reject undefined variables when an explicitly empty schema is supplied');
  }

  // Negative Matrix Test 3: a timed choice must describe one valid fallback.
  const invalidTimedChoiceGraph: NarrativeGraphVersion = {
    ...undefVarGraph,
    id: 'graph_timed_invalid',
    nodes: [{
      ...undefVarGraph.nodes[0],
      choices: [{
        id: 'c_timeout', text: '在警报前决定', intent: '逃离', targetNodeId: 'node_end', effects: [],
        timeoutSeconds: 0, defaultTimeoutTargetNodeId: 'node_missing_timeout',
      }],
    }, undefVarGraph.nodes[1]],
  };
  const timedResult = auditNarrativeGraph(invalidTimedChoiceGraph, schema);
  if (timedResult.passed || !timedResult.issues.some((issue) => issue.id.startsWith('err_invalid_timeout_')) || !timedResult.issues.some((issue) => issue.id.startsWith('err_broken_timeout_target_'))) {
    throw new Error('Graph QA must reject an invalid timed choice and missing timeout fallback target');
  }

  // Positive Test Case
  const validGraph: NarrativeGraphVersion = {
    id: 'graph_valid',
    experienceId: 'exp_1',
    versionIndex: 1,
    entryNodeId: 'node_1',
    locked: false,
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node_1',
        brief: { nodeId: 'node_1', title: 'Start Node', intent: 'Begin', dramaticFunction: 'exposition', narrativeSummary: 'Start' },
        contract: { readVariables: [], writeVariables: ['trust'], requiredFacts: [], producedFacts: [] },
        choices: [
          {
            id: 'c_valid',
            text: 'Trust person',
            intent: 'Trust',
            targetNodeId: 'node_end',
            condition: { op: 'compare', variable: 'trust', comparator: 'gte', value: 0 },
            effects: [{ type: 'increment', variable: 'trust', amount: 10 }],
          },
        ],
        bindings: [],
      },
      {
        id: 'node_end',
        brief: { nodeId: 'node_end', title: 'Ending Node', intent: 'End', dramaticFunction: 'ending', narrativeSummary: 'The End' },
        contract: { readVariables: ['trust'], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
        bindings: [],
      },
    ],
  };

  const result3 = auditNarrativeGraph(validGraph, schema);
  if (!result3.passed) {
    throw new Error(`Valid graph failed Graph QA surprisingly: ${JSON.stringify(result3.issues)}`);
  }

  const durationGraph: NarrativeGraphVersion = {
    ...validGraph,
    id: 'graph_duration',
    nodes: validGraph.nodes.map((node) => ({
      ...node,
      interaction: {
        capabilities: node.brief.dramaticFunction === 'ending' ? ['play_content', 'terminal'] : ['play_content', 'present_choice'],
        contentPolicy: 'create_shared_content',
        durationRangeSec: node.id === 'node_1' ? [120, 120] : [180, 180],
        playerKnowledgeIn: [],
        playerKnowledgeOut: [],
      },
    })),
  };
  const durationBudget = { p50TargetSec: 300, p90TargetSec: 300, maxSecondsWithoutChoice: 180, tolerancePercent: 15 } as const;
  const durationResult = auditNarrativeGraph(durationGraph, schema, durationBudget);
  if (!durationResult.passed || durationResult.durationAudit?.pathCount !== 1) {
    throw new Error(`Duration-compatible graph failed budget QA: ${JSON.stringify(durationResult)}`);
  }
  const impossibleDurationResult = auditNarrativeGraph(durationGraph, schema, {
    ...durationBudget,
    p50TargetSec: 600,
    p90TargetSec: 900,
  });
  if (
    impossibleDurationResult.passed
    || !impossibleDurationResult.issues.some((issue) => issue.id === 'err_duration_no_p50_path')
    || !impossibleDurationResult.issues.some((issue) => issue.id === 'err_duration_no_p90_content')
  ) {
    throw new Error('Graph QA must reject duration promises that its reachable node contracts cannot possibly fulfill');
  }

  console.log('[Interactive Graph QA Self-Check] PASSED. Graph QA Engine successfully passed all negative & positive test cases.');
}

runGraphQASelfCheck();
