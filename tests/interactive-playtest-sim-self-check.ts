import { simulateSinglePath } from '../src/domains/interactive/runtime/traceSimulationEngine.ts';
import type { NarrativeGraphVersion, StateSchema } from '../src/domains/interactive/types/schema.ts';

function runPlaytestSimSelfCheck() {
  console.log('[Interactive Playtest Simulation Self-Check] Running single path & DFS traversal engine...');

  const schema: StateSchema = {
    variables: [{ key: 'clue', type: 'number', scope: 'session', defaultValue: 0 }],
    facts: [],
  };

  const graph: NarrativeGraphVersion = {
    id: 'graph_sim',
    experienceId: 'exp_sim',
    versionIndex: 1,
    entryNodeId: 'node_start',
    locked: false,
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node_start',
        brief: { nodeId: 'node_start', title: 'Start', intent: 'Start', dramaticFunction: 'exposition', narrativeSummary: 'Start' },
        contract: { readVariables: [], writeVariables: ['clue'], requiredFacts: [], producedFacts: [] },
        choices: [
          {
            id: 'c1',
            text: 'Collect clue',
            intent: 'Collect',
            targetNodeId: 'node_end',
            effects: [{ type: 'increment', variable: 'clue', amount: 1 }],
          },
        ],
        bindings: [],
      },
      {
        id: 'node_end',
        brief: { nodeId: 'node_end', title: 'End', intent: 'End', dramaticFunction: 'ending', narrativeSummary: 'End' },
        contract: { readVariables: ['clue'], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
        bindings: [],
      },
    ],
  };

  const res = simulateSinglePath(graph, schema);

  if (res.isDeadlock || res.reachedEndingId !== 'node_end') {
    throw new Error(`Simulation failed: expected reach node_end cleanly, got deadlock=${res.isDeadlock}, ending=${res.reachedEndingId}`);
  }

  if (res.finalContext.variables.clue !== 1) {
    throw new Error('State effect was not correctly accumulated during path simulation');
  }

  const deadEndGraph: NarrativeGraphVersion = {
    ...graph,
    id: 'graph_dead_end',
    nodes: [{
      ...graph.nodes[0],
      id: 'node_dead_end',
      brief: { ...graph.nodes[0].brief, nodeId: 'node_dead_end', title: 'Dead end' },
      choices: [],
    }],
    entryNodeId: 'node_dead_end',
  };
  const deadEnd = simulateSinglePath(deadEndGraph, schema);
  if (!deadEnd.isDeadlock || deadEnd.reachedEndingId) {
    throw new Error('A non-ending node without outgoing choices must be reported as a deadlock, not an ending');
  }

  console.log('[Interactive Playtest Simulation Self-Check] PASSED. Runtime playtest simulation engine verified.');
}

runPlaytestSimSelfCheck();
