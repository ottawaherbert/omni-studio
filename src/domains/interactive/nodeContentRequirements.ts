import type { NarrativeNode, NodeCapability } from './types/schema.ts';

/**
 * Older graph revisions can have an `interaction` object without the
 * `capabilities` array. Keep those revisions readable instead of crashing the
 * whiteboard, while deriving the minimum capabilities from their visible
 * narrative shape.
 */
export const nodeCapabilities = (node: NarrativeNode): NodeCapability[] => {
  const stored = node.interaction?.capabilities;
  if (Array.isArray(stored) && stored.length > 0) return stored;

  const inferred: NodeCapability[] = ['play_content'];
  if ((node.choices?.length ?? 0) > 0) inferred.push('present_choice');
  if (node.brief?.dramaticFunction === 'ending') inferred.push('terminal');
  return inferred;
};

/**
 * The semantic graph decides whether a node needs authored content.  This is
 * deliberately capability-based: dramatic role, title and project format must
 * never decide whether a route/checkpoint needs a fabricated script or video.
 */
export const hasNodeCapability = (node: NarrativeNode, capability: NodeCapability) =>
  nodeCapabilities(node).includes(capability);

export const nodeRequiresMainContent = (node: NarrativeNode) =>
  hasNodeCapability(node, 'play_content');

export const nodeRequiresMediaPlayback = (node: NarrativeNode) =>
  hasNodeCapability(node, 'play_content');
