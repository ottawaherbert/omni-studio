import type { NarrativeGraphVersion, StateSchema } from "../types/schema";
import { validateNarrativeGraph, validateStateSchema } from "../validation/domainValidation";

export interface StructurePreviewPayload {
  warningNodeIds: string[];
  previewTextByNodeId: Record<string, string>;
}

export const buildStructurePreviewPayload = (input: {
  graph: NarrativeGraphVersion;
  stateSchema: StateSchema;
  approvedNodeIds?: Iterable<string>;
}): StructurePreviewPayload => {
  if (!input.graph.entryNodeId || !input.graph.nodes.some((node) => node.id === input.graph.entryNodeId)) {
    throw new Error("结构试玩需要一个有效入口节点");
  }
  const schemaIssues = validateStateSchema(input.stateSchema);
  const graphIssues = validateNarrativeGraph(input.graph, input.stateSchema);
  const issues = [...schemaIssues, ...graphIssues];
  if (issues.length > 0) {
    throw new Error(`结构试玩无法执行：${issues.slice(0, 5).join("；")}`);
  }

  const approvedNodeIds = new Set(input.approvedNodeIds || []);
  const warningNodeIds: string[] = [];
  const previewTextByNodeId: Record<string, string> = {};
  for (const node of input.graph.nodes) {
    if (!approvedNodeIds.has(node.id)) warningNodeIds.push(node.id);
    previewTextByNodeId[node.id] = node.brief.narrativeSummary.trim()
      || node.brief.intent.trim()
      || node.brief.title.trim();
  }
  return { warningNodeIds, previewTextByNodeId };
};
