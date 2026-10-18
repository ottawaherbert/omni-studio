/**
 * Interactive Graph Draft Patch Engine
 * Current architecture and boundaries: doc/design.md.
 */

import { NarrativeGraphVersion, NarrativeNode, NarrativeTransition, normalizeNarrativeGraph } from '../types/schema';
import { GraphPatchOperation } from './graphDraft';

export class GraphPatchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'GraphPatchError';
  }
}

export function validateGraphPatchOperations(
  baseGraph: NarrativeGraphVersion,
  operations: GraphPatchOperation[]
): void {
  const normalized = normalizeNarrativeGraph(baseGraph);
  const nodeIds = new Set<string>(normalized.nodes.map((n) => n.id));
  const transitionIds = new Set<string>();

  (normalized.transitions || []).forEach((t) => transitionIds.add(t.id));
  normalized.nodes.forEach((n) => {
    n.choices.forEach((c) => transitionIds.add(c.id));
  });

  for (const op of operations) {
    switch (op.type) {
      case 'add_node':
        if (nodeIds.has(op.node.id)) {
          throw new GraphPatchError(`Duplicate node ID: ${op.node.id}`, 'DUPLICATE_NODE_ID');
        }
        nodeIds.add(op.node.id);
        break;
      case 'update_node_brief':
      case 'update_node_interaction':
        if (!nodeIds.has(op.nodeId)) {
          throw new GraphPatchError(`Target node does not exist: ${op.nodeId}`, 'NODE_NOT_FOUND');
        }
        break;
      case 'remove_node':
        if (!nodeIds.has(op.nodeId)) {
          throw new GraphPatchError(`Cannot remove non-existent node: ${op.nodeId}`, 'NODE_NOT_FOUND');
        }
        nodeIds.delete(op.nodeId);
        break;
      case 'add_transition':
        if (transitionIds.has(op.transition.id)) {
          throw new GraphPatchError(`Duplicate transition ID: ${op.transition.id}`, 'DUPLICATE_TRANSITION_ID');
        }
        if (!nodeIds.has(op.transition.sourceNodeId)) {
          throw new GraphPatchError(`Transition source node not found: ${op.transition.sourceNodeId}`, 'SOURCE_NODE_NOT_FOUND');
        }
        if (!nodeIds.has(op.transition.targetNodeId)) {
          throw new GraphPatchError(`Transition target node not found: ${op.transition.targetNodeId}`, 'TARGET_NODE_NOT_FOUND');
        }
        transitionIds.add(op.transition.id);
        break;
      case 'update_transition':
        if (!transitionIds.has(op.transitionId)) {
          throw new GraphPatchError(`Transition not found: ${op.transitionId}`, 'TRANSITION_NOT_FOUND');
        }
        if (op.patch.targetNodeId && !nodeIds.has(op.patch.targetNodeId)) {
          throw new GraphPatchError(`Transition target node not found: ${op.patch.targetNodeId}`, 'TARGET_NODE_NOT_FOUND');
        }
        if (op.patch.sourceNodeId && !nodeIds.has(op.patch.sourceNodeId)) {
          throw new GraphPatchError(`Transition source node not found: ${op.patch.sourceNodeId}`, 'SOURCE_NODE_NOT_FOUND');
        }
        break;
      case 'remove_transition':
        if (!transitionIds.has(op.transitionId)) {
          throw new GraphPatchError(`Cannot remove non-existent transition: ${op.transitionId}`, 'TRANSITION_NOT_FOUND');
        }
        transitionIds.delete(op.transitionId);
        break;
      case 'set_entry':
        if (!nodeIds.has(op.nodeId)) {
          throw new GraphPatchError(`Entry node not found: ${op.nodeId}`, 'ENTRY_NODE_NOT_FOUND');
        }
        break;
    }
  }
}

export function applyGraphPatch(
  baseGraph: NarrativeGraphVersion,
  operations: GraphPatchOperation[]
): NarrativeGraphVersion {
  validateGraphPatchOperations(baseGraph, operations);

  const normalized = normalizeNarrativeGraph(baseGraph);
  let nodes: NarrativeNode[] = [...normalized.nodes.map((n) => ({ ...n, choices: [...n.choices] }))];
  let transitions: NarrativeTransition[] = normalized.transitions
    ? [...normalized.transitions]
    : nodes.flatMap((n) => n.choices.map((c) => ({ ...c, sourceNodeId: n.id })));

  let entryNodeId = baseGraph.entryNodeId;

  for (const op of operations) {
    switch (op.type) {
      case 'add_node': {
        nodes.push({ ...op.node, choices: [...(op.node.choices || [])] });
        break;
      }
      case 'update_node_brief': {
        nodes = nodes.map((n) => (n.id === op.nodeId ? { ...n, brief: { ...op.brief } } : n));
        break;
      }
      case 'update_node_interaction': {
        nodes = nodes.map((n) => (n.id === op.nodeId ? { ...n, interaction: { ...op.interaction } } : n));
        break;
      }
      case 'remove_node': {
        nodes = nodes.filter((n) => n.id !== op.nodeId);
        // Cascade cleanup transitions involving this node
        transitions = transitions.filter((t) => t.sourceNodeId !== op.nodeId && t.targetNodeId !== op.nodeId);
        nodes = nodes.map((n) => ({
          ...n,
          choices: n.choices.filter((c) => c.targetNodeId !== op.nodeId),
        }));
        break;
      }
      case 'add_transition': {
        transitions.push({ ...op.transition });
        // Update choices array on source node
        nodes = nodes.map((n) => {
          if (n.id === op.transition.sourceNodeId) {
            const existingChoiceIdx = n.choices.findIndex((c) => c.id === op.transition.id);
            const choices = [...n.choices];
            if (existingChoiceIdx >= 0) {
              choices[existingChoiceIdx] = { ...op.transition };
            } else {
              choices.push({ ...op.transition });
            }
            return { ...n, choices };
          }
          return n;
        });
        break;
      }
      case 'update_transition': {
        transitions = transitions.map((t) => (t.id === op.transitionId ? { ...t, ...op.patch } : t));
        nodes = nodes.map((n) => ({
          ...n,
          choices: n.choices.map((c) => (c.id === op.transitionId ? { ...c, ...op.patch } : c)),
        }));
        break;
      }
      case 'remove_transition': {
        transitions = transitions.filter((t) => t.id !== op.transitionId);
        nodes = nodes.map((n) => ({
          ...n,
          choices: n.choices.filter((c) => c.id !== op.transitionId),
        }));
        break;
      }
      case 'set_entry': {
        entryNodeId = op.nodeId;
        break;
      }
    }
  }

  return {
    ...baseGraph,
    nodes,
    transitions,
    entryNodeId,
    updatedAt: new Date().toISOString(),
  };
}
