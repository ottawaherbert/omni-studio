/**
 * Interactive Graph Draft Diff Engine
 * Current architecture and boundaries: doc/design.md.
 */

import { NarrativeGraphVersion, normalizeNarrativeGraph } from '../types/schema';
import { GraphDraftImpact } from './graphDraft';

export interface GraphDiffResult {
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  addedChoiceIds: string[];
  updatedChoiceIds: string[];
  removedChoiceIds: string[];
}

export function diffNarrativeGraphs(
  baseGraph: NarrativeGraphVersion,
  candidateGraph: NarrativeGraphVersion
): GraphDiffResult {
  const baseNorm = normalizeNarrativeGraph(baseGraph);
  const candNorm = normalizeNarrativeGraph(candidateGraph);

  const baseNodeMap = new Map(baseNorm.nodes.map((n) => [n.id, n]));
  const candNodeMap = new Map(candNorm.nodes.map((n) => [n.id, n]));

  const addedNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];

  for (const [id, candNode] of candNodeMap.entries()) {
    if (!baseNodeMap.has(id)) {
      addedNodeIds.push(id);
    } else {
      const baseNode = baseNodeMap.get(id)!;
      if (JSON.stringify(baseNode.brief) !== JSON.stringify(candNode.brief) ||
          JSON.stringify(baseNode.interaction) !== JSON.stringify(candNode.interaction) ||
          JSON.stringify(baseNode.contract) !== JSON.stringify(candNode.contract)) {
        updatedNodeIds.push(id);
      }
    }
  }

  for (const id of baseNodeMap.keys()) {
    if (!candNodeMap.has(id)) {
      removedNodeIds.push(id);
    }
  }

  const baseChoices = new Map<string, string>();
  const candChoices = new Map<string, string>();

  const extractChoices = (graph: typeof baseNorm, map: Map<string, string>) => {
    (graph.transitions || []).forEach((t) => {
      map.set(t.id, JSON.stringify({ text: t.text, intent: t.intent, target: t.targetNodeId, cond: t.condition, eff: t.effects }));
    });
    graph.nodes.forEach((n) => {
      n.choices.forEach((c) => {
        if (!map.has(c.id)) {
          map.set(c.id, JSON.stringify({ text: c.text, intent: c.intent, target: c.targetNodeId, cond: c.condition, eff: c.effects }));
        }
      });
    });
  };

  extractChoices(baseNorm, baseChoices);
  extractChoices(candNorm, candChoices);

  const addedChoiceIds: string[] = [];
  const updatedChoiceIds: string[] = [];
  const removedChoiceIds: string[] = [];

  for (const [id, content] of candChoices.entries()) {
    if (!baseChoices.has(id)) {
      addedChoiceIds.push(id);
    } else if (baseChoices.get(id) !== content) {
      updatedChoiceIds.push(id);
    }
  }

  for (const id of baseChoices.keys()) {
    if (!candChoices.has(id)) {
      removedChoiceIds.push(id);
    }
  }

  return {
    addedNodeIds: addedNodeIds.sort(),
    updatedNodeIds: updatedNodeIds.sort(),
    removedNodeIds: removedNodeIds.sort(),
    addedChoiceIds: addedChoiceIds.sort(),
    updatedChoiceIds: updatedChoiceIds.sort(),
    removedChoiceIds: removedChoiceIds.sort(),
  };
}

export function computeDraftImpact(
  diff: GraphDiffResult,
  estimates: {
    p50DurationDeltaSec?: number;
    p90DurationDeltaSec?: number;
    uniqueMediaDeltaSec?: number;
  } = {}
): GraphDraftImpact {
  return {
    addedNodeIds: diff.addedNodeIds,
    updatedNodeIds: diff.updatedNodeIds,
    removedNodeIds: diff.removedNodeIds,
    addedChoiceIds: diff.addedChoiceIds,
    updatedChoiceIds: diff.updatedChoiceIds,
    removedChoiceIds: diff.removedChoiceIds,
    p50DurationDeltaSec: estimates.p50DurationDeltaSec ?? 0,
    p90DurationDeltaSec: estimates.p90DurationDeltaSec ?? 0,
    uniqueMediaDeltaSec: estimates.uniqueMediaDeltaSec ?? 0,
  };
}
