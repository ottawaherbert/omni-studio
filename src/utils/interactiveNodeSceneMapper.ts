import { GameChoice, GameNode, GameProjectData } from "../types/game";
import { AudioTrack, MediaAssetReference, Scene, Shot } from "../types/project";
import { isTrustedReadyMediaReference } from "./mediaProvenance";

export interface InteractiveNodeSceneMetadata {
  incomingContext: string;
  outgoingContext: string;
  outboundChoices: { label: string; targetNodeId: string }[];
}

export interface InteractiveNodeProductionStatus {
  hasScript: boolean;
  hasBreakdown: boolean;
  hasShots: boolean;
  hasPrompts: boolean;
  hasImages: boolean;
  hasVideos: boolean;
  hasAudio: boolean;
  hasInteractiveHold: boolean;
  hasIncomingAnchor: boolean;
  hasOutgoingChoices: boolean;
  missing: string[];
}

export interface InteractiveSceneSyncResult {
  scenes: Scene[];
  nodeUpdates: Record<string, Partial<GameNode>>;
  removedOrphanSceneCount: number;
}

export interface InteractiveProjectionSyncResult extends InteractiveSceneSyncResult {
  gameData: GameProjectData;
}

export interface InteractiveAssemblyIssue {
  id: string;
  severity: "blocking" | "warning" | "info";
  category: "graph" | "state" | "production" | "playback" | "transition";
  nodeId?: string;
  edgeId?: string;
  title: string;
  detail: string;
  actionLabel?: string;
}

export interface InteractiveAssemblyQAReport {
  score: number;
  blockingCount: number;
  warningCount: number;
  issues: InteractiveAssemblyIssue[];
  readyNodeCount: number;
  totalNodeCount: number;
  totalPathCount: number;
  playablePathCount: number;
  truncatedPathCount: number;
  sampledPaths: string[][];
  coveredEndingIds: string[];
  conditionBlockedEdgeCount: number;
  stateDeadEndCount: number;
}

export interface InteractiveAssemblyQAOptions {
  targetEndingCount?: number;
  currentEpisodeId?: string;
  episodeIds?: string[];
  episodeNodeIdsByEpisodeId?: Record<string, string[]>;
}

const edgeSourceId = (edge: GameChoice) => edge.sourceNodeId || edge.source || "";
const edgeTargetId = (edge: GameChoice) => edge.targetNodeId || edge.target || "";

export const getIncomingEdgesForNode = (
  data: GameProjectData,
  nodeId: string,
) => (data.edges || []).filter((edge) => edgeTargetId(edge) === nodeId);

export const getOutgoingEdgesForNode = (
  data: GameProjectData,
  nodeId: string,
) => (data.edges || []).filter((edge) => edgeSourceId(edge) === nodeId);

export const getStartNode = (data: GameProjectData) => {
  if (!data.nodes?.length) return undefined;
  const explicit = data.nodes.find((node) => node.id === "start");
  if (explicit) return explicit;
  const targetIds = new Set((data.edges || []).map(edgeTargetId).filter(Boolean));
  return data.nodes.find((node) => !targetIds.has(node.id)) || data.nodes[0];
};

export const orderInteractiveNodes = (data: GameProjectData): GameNode[] => {
  if (!data.nodes?.length) return [];

  const sortedNodes: GameNode[] = [];
  const visited = new Set<string>();
  const roots = (() => {
    const explicit = data.nodes.filter((node) => node.id === "start");
    if (explicit.length) return explicit;
    const targetIds = new Set((data.edges || []).map(edgeTargetId).filter(Boolean));
    const rootNodes = data.nodes.filter((node) => !targetIds.has(node.id));
    return rootNodes.length ? rootNodes : [data.nodes[0]];
  })();
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    sortedNodes.push(current);

    getOutgoingEdgesForNode(data, current.id).forEach((edge) => {
      const targetId = edgeTargetId(edge);
      const targetNode = data.nodes.find((node) => node.id === targetId);
      if (targetNode && !visited.has(targetId)) queue.push(targetNode);
    });
  }

  data.nodes.forEach((node) => {
    if (!visited.has(node.id)) sortedNodes.push(node);
  });

  return sortedNodes;
};

export const buildInteractiveMetadata = (
  data: GameProjectData,
  node: GameNode,
): InteractiveNodeSceneMetadata => {
  const inEdges = getIncomingEdgesForNode(data, node.id);
  const outEdges = getOutgoingEdgesForNode(data, node.id);

  const incomingContext = inEdges.length > 0
    ? `[前置上下文] 本节点触发条件：玩家${inEdges.map((edge) => {
        const parent = data.nodes.find((item) => item.id === edgeSourceId(edge));
        const parentName = parent ? `【${parent.title}】` : "上个节点";
        const choice = edge.displayText ? `做出了选择“${edge.displayText}”` : "自然过渡";
        const condition = edge.conditionExpression ? `，且满足条件 ${edge.conditionExpression}` : "";
        return `从${parentName}${choice}${condition}`;
      }).join("，或者")}。请在开头顺畅承接此情境。`
    : "[前置上下文] 本节点为段落起点、初始节点或无特定限制接入。";

  const outboundChoices = outEdges.map((edge) => ({
    label: edge.displayText || "继续",
    targetNodeId: edgeTargetId(edge),
  }));

  const outgoingContext = outboundChoices.length > 0
    ? `[出口上下文] 节点结尾必须进入互动等待状态，当前面临分支抉择：${outboundChoices
        .map((choice) => `[选项: ${choice.label}]`)
        .join(" / ")}。请把结尾写为一个悬念、行动抉择或信息不完整的最高压停顿。`
    : node.isEnding
      ? "[出口上下文] 本节点是结局节点，结尾必须给出明确的状态结算、情绪落点和后果。"
      : "[出口上下文] 本节点目前没有后续选项，属于待补全节点；请保留可继续生长的悬念。";

  return { incomingContext, outgoingContext, outboundChoices };
};

const legacyVisualShot = (node: GameNode): Shot[] => {
  const imageUrl = node.imageAssetMedia?.url || node.imageAssetUrl;
  const videoUrl = node.videoAssetMedia?.url || node.videoAssetUrl;
  if (!imageUrl && !videoUrl && !node.imageAssetMedia && !node.videoAssetMedia) return [];
  return [
    {
      id: `shot-${node.id}`,
      imageUrl,
      videoUrl,
      imageMedia: node.imageAssetMedia,
      videoMedia: node.videoAssetMedia,
      duration: node.targetDuration ? Math.max(3, node.targetDuration * 60) : 3,
      transition: "none",
      activeTakeId: "default",
      takes: [
        {
          id: "default",
          imageUrl,
          videoUrl,
          imageMedia: node.imageAssetMedia,
          videoMedia: node.videoAssetMedia,
          createdAt: Date.now(),
        },
      ],
    },
  ];
};

const legacyAudioTrack = (node: GameNode): AudioTrack[] => {
  if (!node.audioAssetUrl) return [];
  return [
    {
      id: `audio-${node.id}`,
      type: "dialogue",
      url: node.audioAssetUrl,
      startTime: 0,
      duration: node.targetDuration ? Math.max(3, node.targetDuration * 60) : 3,
    },
  ];
};

export const nodeToInteractiveScene = (
  data: GameProjectData,
  node: GameNode,
  index: number,
  existingScene?: Scene,
): Scene => {
  const interactiveMetadata = buildInteractiveMetadata(data, node);
  const shots = node.shots?.length
    ? node.shots
    : existingScene?.shots?.length
      ? existingScene.shots
      : legacyVisualShot(node);
  const audioTracks = node.audioTracks?.length
    ? node.audioTracks
    : existingScene?.audioTracks?.length
      ? existingScene.audioTracks
      : legacyAudioTrack(node);
  const description = [
    interactiveMetadata.incomingContext,
    "",
    "节点内容概要：",
    node.scriptContent || existingScene?.description || "无描述",
    "",
    interactiveMetadata.outgoingContext,
  ].join("\n");

  return {
    id: node.id,
    sourceNodeId: node.id,
    sceneNumber: String(index + 1),
    title: node.title || existingScene?.title || `互动节点 ${index + 1}`,
    description,
    script: node.detailedScript || existingScene?.script || node.scriptContent || "",
    scriptBlocks: node.scriptBlocks || existingScene?.scriptBlocks || [],
    breakdown: node.breakdown || existingScene?.breakdown,
    valueCharge: node.valueCharge || existingScene?.valueCharge || "neutral",
    valueShift: node.valueShift || existingScene?.valueShift,
    hook: node.hook || existingScene?.hook,
    cliffhanger: node.cliffhanger || existingScene?.cliffhanger,
    targetDuration: node.targetDuration || existingScene?.targetDuration || (shots.length > 0 ? shots.reduce((sum, shot) => sum + (shot.duration || 3), 0) / 60 : undefined),
    sceneGoal: node.sceneGoal || existingScene?.sceneGoal,
    sceneAssets: node.sceneAssets || existingScene?.sceneAssets,
    environment: node.environment || existingScene?.environment,
    timeOfDay: node.timeOfDay || existingScene?.timeOfDay,
    shots,
    audioTracks,
    interactiveMetadata,
    overrideSkills: node.overrideSkills || existingScene?.overrideSkills,
    multiGrid: node.multiGrid || existingScene?.multiGrid,
    generationMetadata: node.generationMetadata || existingScene?.generationMetadata,
  };
};

export const compileGameToInteractiveScenes = (
  data: GameProjectData,
  existingScenes: Scene[] = [],
): Scene[] => {
  const existingByNodeId = new Map(existingScenes.map((scene) => [scene.sourceNodeId || scene.id, scene]));
  return orderInteractiveNodes(data).map((node, index) =>
    nodeToInteractiveScene(data, node, index, existingByNodeId.get(node.id)),
  );
};

export const syncGameDataToEpisodeScenes = (
  data: GameProjectData,
  existingScenes: Scene[] = [],
): InteractiveSceneSyncResult => {
  const validNodeIds = new Set((data.nodes || []).map((node) => node.id));
  const reusableScenes = existingScenes.filter((scene) => !scene.id || validNodeIds.has(scene.id) || (scene.sourceNodeId && validNodeIds.has(scene.sourceNodeId)));
  const removedOrphanSceneCount = existingScenes.length - reusableScenes.length;
  const scenes = compileGameToInteractiveScenes(data, reusableScenes);
  const sceneById = new Map(reusableScenes.map((scene) => [scene.sourceNodeId || scene.id, scene]));
  const nodeUpdates: Record<string, Partial<GameNode>> = {};
  const sameMediaReference = (left?: MediaAssetReference, right?: MediaAssetReference) => {
    if (!left || !right) return left === right;
    return left.url === right.url
      && left.kind === right.kind
      && left.source === right.source
      && left.status === right.status
      && left.generationJobId === right.generationJobId
      && left.modelId === right.modelId
      && left.createdAt === right.createdAt
      && left.updatedAt === right.updatedAt
      && left.errorMessage === right.errorMessage
      && left.note === right.note;
  };

  data.nodes.forEach((node) => {
    const existingScene = sceneById.get(node.id);
    if (!existingScene) return;
    const updates: Partial<GameNode> = {};
    if (!node.shots?.length && existingScene.shots?.length) updates.shots = existingScene.shots;
    if (!node.audioTracks?.length && existingScene.audioTracks?.length) updates.audioTracks = existingScene.audioTracks;
    if (!node.multiGrid && existingScene.multiGrid) updates.multiGrid = existingScene.multiGrid;
    if (!node.overrideSkills?.length && existingScene.overrideSkills?.length) updates.overrideSkills = existingScene.overrideSkills;
    if (!node.generationMetadata && existingScene.generationMetadata) updates.generationMetadata = existingScene.generationMetadata;
    const firstShot = existingScene.shots?.[0];
    const imageAssetUrl = existingScene.multiGrid?.imageUrl || firstShot?.imageUrl;
    const videoAssetUrl = existingScene.multiGrid?.videoUrl || firstShot?.videoUrl;
    if (imageAssetUrl && imageAssetUrl !== node.imageAssetUrl) updates.imageAssetUrl = imageAssetUrl;
    if (videoAssetUrl && videoAssetUrl !== node.videoAssetUrl) updates.videoAssetUrl = videoAssetUrl;
    if (firstShot?.imageMedia && !sameMediaReference(firstShot.imageMedia, node.imageAssetMedia)) updates.imageAssetMedia = firstShot.imageMedia;
    if (firstShot?.videoMedia && !sameMediaReference(firstShot.videoMedia, node.videoAssetMedia)) updates.videoAssetMedia = firstShot.videoMedia;
    if (Object.keys(updates).length > 0) nodeUpdates[node.id] = updates;
  });

  return { scenes, nodeUpdates, removedOrphanSceneCount };
};

export const applyInteractiveProjectionSync = (
  data: GameProjectData,
  existingScenes: Scene[] = [],
): InteractiveProjectionSyncResult => {
  const syncResult = syncGameDataToEpisodeScenes(data, existingScenes);
  const gameData: GameProjectData = {
    ...data,
    nodes: (data.nodes || []).map((node) => ({
      ...node,
      ...(syncResult.nodeUpdates[node.id] || {}),
    })),
  };
  return {
    ...syncResult,
    gameData,
  };
};

export const getNodeProductionStatus = (
  data: GameProjectData,
  node: GameNode,
): InteractiveNodeProductionStatus => {
  const shots = node.shots || [];
  const outgoing = getOutgoingEdgesForNode(data, node.id);
  const missing: string[] = [];
  const hasScript = Boolean(node.detailedScript || node.scriptBlocks?.length);
  const hasBreakdown = Boolean(node.breakdown);
  const hasShots = shots.length > 0;
  const hasPrompts = shots.length > 0 && shots.every((shot) => shot.imagePrompt && shot.videoPrompt);
  const hasImages = shots.length > 0 && shots.every((shot) =>
    isTrustedReadyMediaReference(shot.imageMedia, "image"),
  );
  const hasVideos = shots.length > 0 && shots.every((shot) =>
    isTrustedReadyMediaReference(shot.videoMedia, "video"),
  );
  const hasAudio = Boolean(node.audioTracks?.some((track) => track.url));
  const hasInteractiveHold = outgoing.length === 0 || shots.some((shot) =>
    [shot.visualAction, shot.motivation, shot.videoPrompt].some((text) => text?.includes("互动待机") || text?.toLowerCase().includes("interactive hold")),
  );
  const hasIncomingAnchor =
    getIncomingEdgesForNode(data, node.id).length === 0 ||
    shots.length === 0 ||
    isTrustedReadyMediaReference(shots[0]?.imageMedia, "image") ||
    isTrustedReadyMediaReference(node.imageAssetMedia, "image");

  if (!hasScript) missing.push("节点剧本");
  if (!hasBreakdown) missing.push("生产拆解");
  if (!hasShots) missing.push("分镜");
  if (hasShots && !hasPrompts) missing.push("视觉提示词");
  if (hasShots && !hasImages) missing.push("图片");
  if (hasShots && !hasVideos) missing.push("视频");
  if (!hasInteractiveHold) missing.push("互动待机镜头");
  if (!hasIncomingAnchor) missing.push("入场视觉锚点");

  return {
    hasScript,
    hasBreakdown,
    hasShots,
    hasPrompts,
    hasImages,
    hasVideos,
    hasAudio,
    hasInteractiveHold,
    hasIncomingAnchor,
    hasOutgoingChoices: outgoing.length > 0,
    missing,
  };
};

const identifiersFromCondition = (condition: string) => {
  const expression = condition.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
  return expression.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
};

const reservedConditionWords = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "and",
  "or",
  "not",
  "in",
  "if",
]);

type PlaytestState = Record<string, number | boolean | string>;

interface SimulatedPlaytestPath {
  nodeIds: string[];
  state: PlaytestState;
  endingNodeId?: string;
  deadEndNodeId?: string;
}

const defaultVariableValue = (variable: GameProjectData["variables"][number]) =>
  variable.defaultValue ?? variable.initialValue ?? (
    variable.type === "number" ? 0 : variable.type === "boolean" ? false : ""
  );

const createInitialPlaytestState = (data: GameProjectData): PlaytestState =>
  Object.fromEntries((data.variables || []).map((variable) => [variable.name, defaultVariableValue(variable)]));

const findVariableForAction = (
  data: GameProjectData,
  targetVariableId: string,
) => (data.variables || []).find((variable) =>
  variable.id === targetVariableId || variable.name === targetVariableId,
);

const applyNodeActionsToState = (
  data: GameProjectData,
  node: GameNode,
  state: PlaytestState,
): PlaytestState => {
  const nextState = { ...state };
  (node.onEnterActions || []).forEach((action) => {
    const variable = findVariableForAction(data, action.targetVariableId);
    if (!variable) return;
    const key = variable.name;
    if (action.operation === "set") {
      nextState[key] = action.value;
    }
    if (action.operation === "add") {
      nextState[key] = Number(nextState[key] || 0) + Number(action.value);
    }
    if (action.operation === "subtract") {
      nextState[key] = Number(nextState[key] || 0) - Number(action.value);
    }
  });
  return nextState;
};

const conditionTokenPattern = /\s*(>=|<=|===|!==|==|!=|&&|\|\||[()!<>]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|\btrue\b|\bfalse\b|\bnull\b|\band\b|\bor\b|\bnot\b|[a-zA-Z_][a-zA-Z0-9_]*)/gy;

const tokenizeCondition = (condition: string): string[] | undefined => {
  const tokens: string[] = [];
  let index = 0;
  conditionTokenPattern.lastIndex = 0;
  while (index < condition.length) {
    const match = conditionTokenPattern.exec(condition);
    if (!match) {
      return condition.slice(index).trim() ? undefined : tokens;
    }
    tokens.push(match[1]);
    index = conditionTokenPattern.lastIndex;
  }
  return tokens;
};

const isConditionIdentifier = (token: string) =>
  /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token) && !reservedConditionWords.has(token);

const evaluateConditionExpression = (
  condition: string | undefined,
  state: PlaytestState,
) => {
  if (!condition?.trim()) {
    return { valid: true, passed: true, unknownIdentifiers: [] as string[] };
  }
  const tokens = tokenizeCondition(condition);
  if (!tokens) {
    return {
      valid: false,
      passed: false,
      unknownIdentifiers: [] as string[],
      error: "条件表达式包含不支持的字符或操作符。",
    };
  }
  const unknownIdentifiers: string[] = [];
  const expression = tokens.map((token) => {
    if (token === "and") return "&&";
    if (token === "or") return "||";
    if (token === "not") return "!";
    if (isConditionIdentifier(token)) {
      if (!(token in state)) {
        unknownIdentifiers.push(token);
        return "undefined";
      }
      return JSON.stringify(state[token]);
    }
    return token;
  }).join(" ");
  if (unknownIdentifiers.length > 0) {
    return { valid: false, passed: false, unknownIdentifiers };
  }
  try {
    return {
      valid: true,
      passed: Boolean(Function(`"use strict"; return (${expression});`)()),
      unknownIdentifiers,
    };
  } catch (error) {
    return {
      valid: false,
      passed: false,
      unknownIdentifiers,
      error: error instanceof Error ? error.message : "条件表达式执行失败。",
    };
  }
};

export const createInteractiveAssemblyQAReport = (
  data: GameProjectData,
  targetEndingCount = 0,
  options: InteractiveAssemblyQAOptions = {},
): InteractiveAssemblyQAReport => {
  const issues: InteractiveAssemblyIssue[] = [];
  const resolvedTargetEndingCount = options.targetEndingCount ?? targetEndingCount;
  const nodeIds = new Set((data.nodes || []).map((node) => node.id));
  const variableNames = new Set((data.variables || []).map((variable) => variable.name));
  const variableIds = new Set((data.variables || []).map((variable) => variable.id));

  if (!data.nodes?.length) {
    issues.push({
      id: "graph.empty",
      severity: "blocking",
      category: "graph",
      title: "节点白板为空",
      detail: "当前段落没有任何互动节点，无法进入组装或试玩。",
    });
  }

  const invalidEdges = (data.edges || []).filter((edge) => !nodeIds.has(edgeSourceId(edge)) || !nodeIds.has(edgeTargetId(edge)));
  invalidEdges.forEach((edge) => {
    issues.push({
      id: `edge.invalid.${edge.id}`,
      severity: "blocking",
      category: "graph",
      edgeId: edge.id,
      title: "存在断边",
      detail: `连线 ${edge.id} 引用了不存在的起点或目标节点。`,
    });
  });

  const startNode = getStartNode(data);
  const reachable = new Set<string>();
  const queue = startNode ? [startNode] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || reachable.has(node.id)) continue;
    reachable.add(node.id);
    getOutgoingEdgesForNode(data, node.id).forEach((edge) => {
      const target = data.nodes.find((item) => item.id === edgeTargetId(edge));
      if (target) queue.push(target);
    });
  }

  const endingNodes = (data.nodes || []).filter((node) => node.isEnding);
  const canReachEnding = new Set<string>();
  const reverseQueue = [...endingNodes];
  while (reverseQueue.length > 0) {
    const node = reverseQueue.shift();
    if (!node || canReachEnding.has(node.id)) continue;
    canReachEnding.add(node.id);
    (data.edges || [])
      .filter((edge) => edgeTargetId(edge) === node.id && nodeIds.has(edgeSourceId(edge)))
      .forEach((edge) => {
        const source = data.nodes.find((item) => item.id === edgeSourceId(edge));
        if (source) reverseQueue.push(source);
      });
  }

  (data.nodes || []).forEach((node) => {
    if (startNode && !reachable.has(node.id)) {
      issues.push({
        id: `node.unreachable.${node.id}`,
        severity: "blocking",
        category: "graph",
        nodeId: node.id,
        title: "不可达节点",
        detail: `节点「${node.title}」无法从起点路径抵达。`,
      });
    }

    const outgoing = getOutgoingEdgesForNode(data, node.id);
    const invalidActions = (node.onEnterActions || []).filter((action) =>
      !variableIds.has(action.targetVariableId) && !variableNames.has(action.targetVariableId),
    );
    if (invalidActions.length > 0) {
      issues.push({
        id: `node.actions.invalid.${node.id}`,
        severity: "blocking",
        category: "state",
        nodeId: node.id,
        title: "节点动作引用未知变量",
        detail: `节点「${node.title}」有 ${invalidActions.length} 个 onEnterAction 引用了不存在的变量。`,
      });
    }

    if (!node.isEnding && outgoing.length === 0) {
      issues.push({
        id: `node.dangling.${node.id}`,
        severity: "blocking",
        category: "graph",
        nodeId: node.id,
        title: "非结局节点悬空",
        detail: `节点「${node.title}」没有后续选项，也没有标记为结局。`,
      });
    }

    if (reachable.has(node.id) && !canReachEnding.has(node.id)) {
      issues.push({
        id: `node.trapped.${node.id}`,
        severity: "blocking",
        category: "graph",
        nodeId: node.id,
        title: "可达但无法抵达任何结局",
        detail: `玩家可以到达「${node.title}」，但从这里没有任何路径能抵达结局节点。`,
      });
    }

    if (outgoing.length > 1 && !outgoing.some((edge) => /超时默认|timeout/i.test(edge.displayText || ""))) {
      issues.push({
        id: `node.timeout.${node.id}`,
        severity: "warning",
        category: "playback",
        nodeId: node.id,
        title: "缺少超时默认分支",
        detail: `节点「${node.title}」有多个选项，但没有显式标注 [超时默认]。`,
      });
    }

    const status = getNodeProductionStatus(data, node);
    status.missing.forEach((missing) => {
      issues.push({
        id: `node.production.${node.id}.${missing}`,
        severity: ["节点剧本", "分镜", "互动待机镜头"].includes(missing) ? "blocking" : "warning",
        category: "production",
        nodeId: node.id,
        title: `缺少${missing}`,
        detail: `节点「${node.title}」尚未补齐${missing}。`,
      });
    });

    if (node.isEnding && node.nextEpisodeId) {
      if (options.episodeIds && !options.episodeIds.includes(node.nextEpisodeId)) {
        issues.push({
          id: `node.nextEpisode.invalid.${node.id}`,
          severity: "blocking",
          category: "graph",
          nodeId: node.id,
          title: "跨段落出口目标不存在",
          detail: `结局节点「${node.title}」配置的跳转段落不存在。`,
        });
      }

      if (options.currentEpisodeId && node.nextEpisodeId === options.currentEpisodeId) {
        issues.push({
          id: `node.nextEpisode.self.${node.id}`,
          severity: "warning",
          category: "graph",
          nodeId: node.id,
          title: "结局跳回当前段落",
          detail: `结局节点「${node.title}」跳回当前段落；如果这是循环章节，请确认 Playtest 中不会让玩家误以为已经通关。`,
        });
      }

      const targetNodeIds = options.episodeNodeIdsByEpisodeId?.[node.nextEpisodeId];
      if (node.nextEpisodeNodeId && targetNodeIds && !targetNodeIds.includes(node.nextEpisodeNodeId)) {
        issues.push({
          id: `node.nextEpisodeNode.invalid.${node.id}`,
          severity: "blocking",
          category: "graph",
          nodeId: node.id,
          title: "跨段落目标节点不存在",
          detail: `结局节点「${node.title}」配置的目标节点 ${node.nextEpisodeNodeId} 不在目标段落中。`,
        });
      }
    }
  });

  (data.edges || []).forEach((edge) => {
    if (!edge.conditionExpression) return;
    const unknown = identifiersFromCondition(edge.conditionExpression).filter((id) =>
      !reservedConditionWords.has(id) && !variableNames.has(id),
    );
    if (unknown.length > 0) {
      issues.push({
        id: `edge.condition.${edge.id}`,
        severity: "blocking",
        category: "state",
        edgeId: edge.id,
        title: "条件表达式引用未定义变量",
        detail: `连线「${edge.displayText || edge.id}」引用了未定义变量：${unknown.join(", ")}。`,
      });
    }
  });

  const endingCount = (data.nodes || []).filter((node) => node.isEnding).length;
  const reachableEndingCount = endingNodes.filter((node) => reachable.has(node.id)).length;
  if (endingCount > 0 && reachableEndingCount === 0) {
    issues.push({
      id: "graph.endings.unreachable",
      severity: "blocking",
      category: "graph",
      title: "没有可达结局",
      detail: "当前段落存在结局节点，但没有任何结局能从起点路径抵达。",
    });
  }
  if (resolvedTargetEndingCount > 0 && endingCount < resolvedTargetEndingCount) {
    issues.push({
      id: "graph.endings.target",
      severity: "warning",
      category: "graph",
      title: "结局数量不足",
      detail: `当前结局 ${endingCount} 个，目标结局 ${resolvedTargetEndingCount} 个。`,
    });
  }

  const simulatedPaths: SimulatedPlaytestPath[] = [];
  const simulatedReachable = new Set<string>();
  const conditionBlockedEdges = new Set<string>();
  const conditionPassedEdges = new Set<string>();
  const invalidConditionEdges = new Set<string>();
  const stateDeadEndNodeIds = new Set<string>();
  let truncatedPathCount = 0;
  const maxPaths = 200;
  const maxDepth = Math.max(20, (data.nodes?.length || 0) + 5);
  const recordSimulatedPath = (path: SimulatedPlaytestPath) => {
    if (simulatedPaths.length >= maxPaths) {
      truncatedPathCount += 1;
      return;
    }
    simulatedPaths.push(path);
  };
  const walkPath = (node: GameNode | undefined, state: PlaytestState, path: string[]) => {
    if (!node || simulatedPaths.length >= maxPaths) {
      truncatedPathCount += 1;
      return;
    }
    if (path.includes(node.id) || path.length > maxDepth) {
      truncatedPathCount += 1;
      return;
    }

    const enteredState = applyNodeActionsToState(data, node, state);
    const nextPath = [...path, node.id];
    simulatedReachable.add(node.id);
    const outgoing = getOutgoingEdgesForNode(data, node.id);

    if (node.isEnding || outgoing.length === 0) {
      recordSimulatedPath({
        nodeIds: nextPath,
        state: enteredState,
        endingNodeId: node.isEnding ? node.id : undefined,
        deadEndNodeId: node.isEnding ? undefined : node.id,
      });
      return;
    }

    const enabledEdges = outgoing.filter((edge) => {
      const evaluation = evaluateConditionExpression(edge.conditionExpression, enteredState);
      if (!evaluation.valid) {
        conditionBlockedEdges.add(edge.id);
        if (!invalidConditionEdges.has(edge.id)) {
          invalidConditionEdges.add(edge.id);
          issues.push({
            id: `edge.condition.invalid.${edge.id}`,
            severity: "blocking",
            category: "state",
            edgeId: edge.id,
            title: "条件表达式无法执行",
            detail: `连线「${edge.displayText || edge.id}」的条件表达式无效：${evaluation.error || evaluation.unknownIdentifiers.join(", ")}。`,
          });
        }
        return false;
      }
      if (!evaluation.passed) {
        conditionBlockedEdges.add(edge.id);
        return false;
      }
      conditionPassedEdges.add(edge.id);
      return true;
    });

    if (enabledEdges.length === 0) {
      stateDeadEndNodeIds.add(node.id);
      recordSimulatedPath({
        nodeIds: nextPath,
        state: enteredState,
        deadEndNodeId: node.id,
      });
      return;
    }

    enabledEdges.forEach((edge) => {
      const target = data.nodes.find((item) => item.id === edgeTargetId(edge));
      if (target) walkPath(target, enteredState, nextPath);
    });
  };
  if (startNode) walkPath(startNode, createInitialPlaytestState(data), []);

  (data.edges || [])
    .filter((edge) =>
      edge.conditionExpression &&
      !invalidConditionEdges.has(edge.id) &&
      conditionBlockedEdges.has(edge.id) &&
      !conditionPassedEdges.has(edge.id) &&
      reachable.has(edgeSourceId(edge)),
    )
    .forEach((edge) => {
      const targetId = edgeTargetId(edge);
      issues.push({
        id: `edge.condition.never.${edge.id}`,
        severity: simulatedReachable.has(targetId) ? "warning" : "blocking",
        category: "state",
        edgeId: edge.id,
        title: "条件从未满足",
        detail: `连线「${edge.displayText || edge.id}」在自动变量模拟中从未满足，目标节点可能无法被玩家实际触发。`,
      });
    });

  (data.nodes || []).forEach((node) => {
    if (startNode && reachable.has(node.id) && !simulatedReachable.has(node.id)) {
      issues.push({
        id: `node.stateUnreachable.${node.id}`,
        severity: "blocking",
        category: "state",
        nodeId: node.id,
        title: "变量模拟不可达节点",
        detail: `节点「${node.title}」拓扑上可达，但在执行 onEnterActions 与 conditionExpression 后没有任何采样路径能抵达。`,
      });
    }
  });

  stateDeadEndNodeIds.forEach((nodeId) => {
    const node = data.nodes.find((item) => item.id === nodeId);
    if (!node || node.isEnding) return;
    issues.push({
      id: `node.stateDeadEnd.${nodeId}`,
      severity: "blocking",
      category: "state",
      nodeId,
      title: "变量条件死路",
      detail: `节点「${node.title}」存在出边，但当前变量状态下没有任何条件可走，玩家会卡死在此节点。`,
    });
  });

  const coveredEndingIds = Array.from(new Set(
    simulatedPaths.map((path) => path.endingNodeId).filter(Boolean) as string[],
  ));
  if (endingCount > 0 && coveredEndingIds.length === 0) {
    issues.push({
      id: "playback.endings.none-covered",
      severity: "blocking",
      category: "playback",
      title: "变量模拟没有覆盖结局",
      detail: "自动 Playtest 执行变量和条件后，没有任何路径能抵达结局节点。",
    });
  }
  if (resolvedTargetEndingCount > 0 && coveredEndingIds.length < Math.min(resolvedTargetEndingCount, endingCount)) {
    issues.push({
      id: "playback.endings.coverage",
      severity: "warning",
      category: "playback",
      title: "结局覆盖不足",
      detail: `变量模拟覆盖结局 ${coveredEndingIds.length}/${Math.min(resolvedTargetEndingCount, endingCount)} 个。`,
    });
  }

  const playablePaths = simulatedPaths.map((path) => path.nodeIds);

  const playablePathCount = simulatedPaths.filter((path) =>
    Boolean(path.endingNodeId) && path.nodeIds.every((nodeId) => {
      const node = data.nodes.find((item) => item.id === nodeId);
      if (!node) return false;
      const status = getNodeProductionStatus(data, node);
      return status.hasShots && status.hasVideos && status.hasInteractiveHold;
    }),
  ).length;

  if (playablePaths.length > 0 && playablePathCount === 0) {
    issues.push({
      id: "playback.paths.none-ready",
      severity: "blocking",
      category: "playback",
      title: "没有完整可播放路径",
      detail: "从起点出发的路径里，没有任何一条同时补齐分镜、视频和互动待机镜头。",
    });
  }

  if (truncatedPathCount > 0) {
    issues.push({
      id: "playback.paths.truncated",
      severity: "warning",
      category: "playback",
      title: "路径检查被截断",
      detail: `检测到循环或路径数量过多，已截断 ${truncatedPathCount} 条路径；需要人工确认回环是否可玩。`,
    });
  }

  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const totalNodeCount = data.nodes?.length || 0;
  const readyNodeCount = (data.nodes || []).filter((node) => getNodeProductionStatus(data, node).missing.length === 0).length;
  const score = Math.max(0, Math.round(100 - blockingCount * 12 - warningCount * 4));

  return {
    score,
    blockingCount,
    warningCount,
    issues,
    readyNodeCount,
    totalNodeCount,
    totalPathCount: playablePaths.length,
    playablePathCount,
    truncatedPathCount,
    sampledPaths: playablePaths.slice(0, 40),
    coveredEndingIds,
    conditionBlockedEdgeCount: conditionBlockedEdges.size,
    stateDeadEndCount: stateDeadEndNodeIds.size,
  };
};
