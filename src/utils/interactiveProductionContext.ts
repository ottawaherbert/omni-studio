import { GameNode, GameProjectData } from "../types/game";
import { Episode, Project } from "../types/project";
import { compileProjectBible } from "./gameEditorHelpers";
import {
  buildInteractiveMetadata,
  getIncomingEdgesForNode,
  getNodeProductionStatus,
  getOutgoingEdgesForNode,
} from "./interactiveNodeSceneMapper";

export interface InteractiveProductionContext {
  worldbuilding: string;
  episodeContext: string;
  nodeContext: string;
  incomingContext: string;
  outgoingContext: string;
  variableContext: string;
  pathContext: string;
  productionStatus: string;
}

const summarizeNode = (node?: GameNode) => {
  if (!node) return "";
  return [
    `[${node.id}] ${node.title || node.id}`,
    node.scriptContent || node.detailedScript || "",
  ].filter(Boolean).join(": ");
};

export const buildNodePathContext = (
  data: GameProjectData,
  nodeId: string,
) => {
  const parts: string[] = [];
  const visited = new Set<string>();
  let currentId = nodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = data.nodes.find((item) => item.id === currentId);
    if (node) parts.unshift(summarizeNode(node));
    const incoming = getIncomingEdgesForNode(data, currentId)[0];
    if (!incoming) break;
    const choice = incoming.displayText ? `选择: ${incoming.displayText}` : "自然过渡";
    parts.unshift(`-- ${choice}${incoming.conditionExpression ? ` / 条件: ${incoming.conditionExpression}` : ""} -->`);
    currentId = incoming.sourceNodeId || incoming.source || "";
  }

  return parts.join("\n");
};

export const buildInteractiveProductionContext = (
  project: Project,
  episode: Episode | null | undefined,
  data: GameProjectData,
  nodeId?: string,
): InteractiveProductionContext => {
  const node = nodeId ? data.nodes.find((item) => item.id === nodeId) : undefined;
  const metadata = node
    ? buildInteractiveMetadata(data, node)
    : { incomingContext: "", outgoingContext: "", outboundChoices: [] };
  const incomingEdges = node ? getIncomingEdgesForNode(data, node.id) : [];
  const outgoingEdges = node ? getOutgoingEdgesForNode(data, node.id) : [];
  const status = node ? getNodeProductionStatus(data, node) : undefined;

  const variableContext = data.variables?.length
    ? data.variables.map((variable) =>
        `- ${variable.name} (${variable.type}) 初始值: ${String(variable.defaultValue ?? variable.initialValue ?? "")}`,
      ).join("\n")
    : "";

  const nodeContext = node
    ? [
        `节点 ID: ${node.id}`,
        `节点标题: ${node.title}`,
        `节点定位: ${node.isEnding ? "结局节点" : outgoingEdges.length > 0 ? "选择节点" : "待补全节点"}`,
        node.uiLayout ? `交互布局: ${node.uiLayout}` : "",
        node.sceneGoal ? `节点场景目标: ${node.sceneGoal}` : "",
        node.scriptContent ? `节点概要:\n${node.scriptContent}` : "",
        node.detailedScript ? `已有剧本:\n${node.detailedScript}` : "",
      ].filter(Boolean).join("\n")
    : "";

  const edgeContext = [
    incomingEdges.length
      ? `入边:\n${incomingEdges.map((edge) => `- 来自 ${edge.sourceNodeId || edge.source}: ${edge.displayText || "继续"}${edge.conditionExpression ? ` / 条件: ${edge.conditionExpression}` : ""}`).join("\n")}`
      : "",
    outgoingEdges.length
      ? `出边:\n${outgoingEdges.map((edge) => `- 到 ${edge.targetNodeId || edge.target}: ${edge.displayText || "继续"}${edge.conditionExpression ? ` / 条件: ${edge.conditionExpression}` : ""}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  const episodeContext = episode
    ? [
        `段落/章节: ${episode.title}`,
        episode.inspiration ? `段落目标与剧情任务:\n${episode.inspiration}` : "",
        episode.targetDuration ? `目标时长: ${episode.targetDuration} 分钟` : "",
        data.blueprint ? `本段落互动蓝图:\n${data.blueprint}` : "",
      ].filter(Boolean).join("\n\n")
    : "";

  return {
    worldbuilding: compileProjectBible(project),
    episodeContext,
    nodeContext: [nodeContext, edgeContext].join("\n\n"),
    incomingContext: metadata.incomingContext,
    outgoingContext: metadata.outgoingContext,
    variableContext,
    pathContext: node ? buildNodePathContext(data, node.id) : "",
    productionStatus: status?.missing.length ? `制作缺口: ${status.missing.join("、")}` : "",
  };
};
