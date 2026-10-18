import { GameProjectData } from "../types/game";
import { Episode, Project } from "../types/project";
import {
  applyInteractiveProjectionSync,
  compileGameToInteractiveScenes,
  createInteractiveAssemblyQAReport,
} from "./interactiveNodeSceneMapper";
import { buildInteractiveProductionContext } from "./interactiveProductionContext";
import { createMediaAssetReference } from "./mediaProvenance";

interface SimulatedPlaytestResult {
  visitedNodeIds: string[];
  state: Record<string, number | boolean | string>;
  endingNodeId: string | null;
}

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const checkEqual = <T>(actual: T, expected: T, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const checkArrayEqual = <T>(actual: T[], expected: T[], message: string) => {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const dataUrl = (label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#111827"/><text x="80" y="380" fill="#f9fafb" font-family="Arial" font-size="48">${label}</text></svg>`)}`;

const makeShot = (id: string, label: string, hold = false) => {
  const imageUrl = dataUrl(label);
  const videoUrl = `https://example.invalid/${id}.mp4`;
  return {
    id,
    duration: 3,
    visualAction: hold
      ? `(互动待机) ${label}，角色停在选择前的动作循环中，画面右侧为 UI 选项留白。`
      : `${label}，角色执行明确的物理动作。`,
    motivation: hold ? "interactive hold / 互动待机" : "承接玩家选择的物理动作。",
    imagePrompt: `${id} cinematic still frame, clear physical action, safe composition for choice UI`,
    videoPrompt: hold
      ? `${id} subtle micro-movements, interactive hold loop, safe area for choices`
      : `${id} character movement, slow camera push-in, clear physical motion`,
    imageUrl,
    videoUrl,
    imageMedia: createMediaAssetReference({
      url: imageUrl,
      kind: "image",
      source: "upload",
      status: "ready",
    }),
    videoMedia: createMediaAssetReference({
      url: videoUrl,
      kind: "video",
      source: "upload",
      status: "ready",
    }),
  };
};

export const createManualInteractiveSampleProject = () => {
  const chapterOneGameData: GameProjectData = {
    blueprint: "玩家是一名夜间调查员，必须在信任与风险之间做选择；变量 trust 决定能否进入合作结局。",
    currentStep: 4,
    variables: [
      { id: "var-trust", name: "trust", type: "number", defaultValue: 0 },
      { id: "var-has-key", name: "hasKey", type: "boolean", defaultValue: false },
    ],
    nodes: [
      {
        id: "start",
        title: "雨夜门廊",
        scriptContent: "玩家抵达废弃剧院门口，听见里面有人低声呼救。",
        detailedScript: "INT. 剧院门廊 - NIGHT\n调查员抬手停在门把前，雨水沿袖口滴落。",
        scriptBlocks: [
          { id: "b-start-1", type: "scene_heading", content: "INT. 剧院门廊 - NIGHT", locationId: "loc-theater" },
          { id: "b-start-2", type: "action", content: "调查员抬手停在门把前，雨水沿袖口滴落。" },
        ],
        breakdown: {
          setting: "INT.",
          location: "废弃剧院",
          time: "NIGHT",
          characters: ["调查员"],
          props: ["门禁钥匙"],
          characterIds: ["char-detective"],
          propIds: ["prop-key"],
          locationId: "loc-theater",
        },
        shots: [makeShot("shot-start-1", "调查员推近剧院门口"), makeShot("shot-start-hold", "门把前停顿", true)],
        audioTracks: [{ id: "audio-start", type: "dialogue", url: "https://example.invalid/start.mp3", startTime: 0, duration: 3, text: "里面有人吗？" }],
        onEnterActions: [],
        isEnding: false,
        uiLayout: "timer",
        position: { x: 0, y: 0 },
      },
      {
        id: "help",
        title: "伸手救人",
        scriptContent: "玩家选择冒险进入，先救出藏在幕布后的陌生人。",
        detailedScript: "INT. 剧院后台 - NIGHT\n调查员拨开幕布，陌生人抓住他的手腕。",
        scriptBlocks: [
          { id: "b-help-1", type: "scene_heading", content: "INT. 剧院后台 - NIGHT", locationId: "loc-theater" },
          { id: "b-help-2", type: "action", content: "调查员拨开幕布，陌生人抓住他的手腕。" },
        ],
        breakdown: {
          setting: "INT.",
          location: "废弃剧院后台",
          time: "NIGHT",
          characters: ["调查员", "陌生人"],
          props: ["门禁钥匙"],
          characterIds: ["char-detective", "char-stranger"],
          propIds: ["prop-key"],
          locationId: "loc-theater",
        },
        shots: [makeShot("shot-help-1", "调查员拨开幕布"), makeShot("shot-help-hold", "陌生人递出钥匙", true)],
        audioTracks: [{ id: "audio-help", type: "dialogue", url: "https://example.invalid/help.mp3", startTime: 0, duration: 3, text: "拿着钥匙，别相信灯光。" }],
        onEnterActions: [{ targetVariableId: "var-trust", operation: "add", value: 1 }],
        isEnding: false,
        uiLayout: "standard",
        position: { x: 320, y: -120 },
      },
      {
        id: "leave",
        title: "转身离开",
        scriptContent: "玩家选择不进入剧院，门内的呼救声突然停止。",
        detailedScript: "EXT. 剧院外街 - NIGHT\n调查员后退半步，门内的声响戛然而止。",
        scriptBlocks: [
          { id: "b-leave-1", type: "scene_heading", content: "EXT. 剧院外街 - NIGHT", locationId: "loc-street" },
          { id: "b-leave-2", type: "action", content: "调查员后退半步，门内的声响戛然而止。" },
        ],
        breakdown: {
          setting: "EXT.",
          location: "剧院外街",
          time: "NIGHT",
          characters: ["调查员"],
          props: [],
          characterIds: ["char-detective"],
          propIds: [],
          locationId: "loc-street",
        },
        shots: [makeShot("shot-leave-1", "调查员后退到雨中"), makeShot("shot-leave-hold", "街灯闪烁", true)],
        audioTracks: [{ id: "audio-leave", type: "sfx", url: "https://example.invalid/rain.mp3", startTime: 0, duration: 3 }],
        onEnterActions: [{ targetVariableId: "var-trust", operation: "subtract", value: 1 }],
        isEnding: true,
        uiLayout: "standard",
        position: { x: 320, y: 160 },
      },
      {
        id: "chapter-two-gate",
        title: "暗门开启",
        scriptContent: "陌生人信任玩家，剧院深处的暗门打开，进入下一段落。",
        detailedScript: "INT. 剧院暗门 - NIGHT\n暗门滑开，冷光照出下一条走廊。",
        scriptBlocks: [
          { id: "b-gate-1", type: "scene_heading", content: "INT. 剧院暗门 - NIGHT", locationId: "loc-theater" },
          { id: "b-gate-2", type: "action", content: "暗门滑开，冷光照出下一条走廊。" },
        ],
        breakdown: {
          setting: "INT.",
          location: "剧院暗门",
          time: "NIGHT",
          characters: ["调查员", "陌生人"],
          props: ["门禁钥匙"],
          characterIds: ["char-detective", "char-stranger"],
          propIds: ["prop-key"],
          locationId: "loc-theater",
        },
        shots: [makeShot("shot-gate-1", "暗门开启"), makeShot("shot-gate-hold", "走廊入口停顿", true)],
        audioTracks: [{ id: "audio-gate", type: "sfx", url: "https://example.invalid/gate.mp3", startTime: 0, duration: 3 }],
        onEnterActions: [{ targetVariableId: "var-has-key", operation: "set", value: true }],
        isEnding: true,
        nextEpisodeId: "ep-2",
        nextEpisodeNodeId: "start-ep2",
        uiLayout: "standard",
        position: { x: 640, y: -120 },
      },
    ],
    edges: [
      { id: "edge-help", sourceNodeId: "start", targetNodeId: "help", source: "start", target: "help", displayText: "进入剧院救人" },
      { id: "edge-leave", sourceNodeId: "start", targetNodeId: "leave", source: "start", target: "leave", displayText: "转身离开 [超时默认]" },
      { id: "edge-gate", sourceNodeId: "help", targetNodeId: "chapter-two-gate", source: "help", target: "chapter-two-gate", displayText: "相信陌生人继续深入", conditionExpression: "trust > 0" },
    ],
    nodeSnapshots: [],
  };

  const chapterTwoGameData: GameProjectData = {
    blueprint: "玩家进入剧院深处，开始调查真正的失踪事件。",
    currentStep: 4,
    variables: chapterOneGameData.variables,
    nodes: [
      {
        id: "start-ep2",
        title: "深处走廊",
        scriptContent: "玩家抵达第二段落的走廊入口。",
        detailedScript: "INT. 剧院深处走廊 - NIGHT\n冷光在地面拉出一条细线。",
        scriptBlocks: [{ id: "b-ep2-1", type: "action", content: "冷光在地面拉出一条细线。" }],
        breakdown: { setting: "INT.", location: "深处走廊", time: "NIGHT", characters: ["调查员"], props: [], characterIds: ["char-detective"], propIds: [], locationId: "loc-theater" },
        shots: [makeShot("shot-ep2-1", "深处走廊入口"), makeShot("shot-ep2-hold", "走廊尽头停顿", true)],
        audioTracks: [{ id: "audio-ep2", type: "sfx", url: "https://example.invalid/ep2.mp3", startTime: 0, duration: 3 }],
        onEnterActions: [],
        isEnding: true,
        uiLayout: "standard",
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    nodeSnapshots: [],
  };

  const episodes: Episode[] = [
    {
      id: "ep-1",
      title: "第一段：门口抉择",
      inspiration: "测试节点白板到分镜、Studio 和试玩的完整手动链路。",
      targetDuration: 4,
      scenes: [],
      gameData: chapterOneGameData,
    },
    {
      id: "ep-2",
      title: "第二段：深处走廊",
      inspiration: "测试跨段落出口是否能找到目标节点。",
      targetDuration: 2,
      scenes: [],
      gameData: chapterTwoGameData,
    },
  ];

  const project: Project = {
    id: "manual-interactive-sample",
    title: "M8 手动互动样例",
    type: "movie",
    projectModel: "interactive",
    interactiveTemplate: "FMV mystery branch test",
    interactiveConfig: {
      scale: "light",
      targetNodeCount: 5,
      targetEndingCount: 2,
      playDurationMin: 6,
      explorationDurationMin: 10,
    },
    aspectRatio: "16:9",
    originalInspiration: "一个调查员在雨夜剧院门口做出会改变后续章节的选择。",
    refinedInspiration: "核心可玩性来自信任变量、超时默认选择、跨段落出口和互动待机镜头。",
    logline: "雨夜剧院门口，一次救人与否决定玩家是否能进入隐藏章节。",
    coreConflict: "救人的风险与自保的冲动互相冲突。",
    creativeVision: {
      genre: ["悬疑", "互动影游"],
      visualStyle: "冷色雨夜、低照度、清晰 UI 留白",
      narrativeStyle: "选择压力优先，影视化表达服务可玩性",
      referenceWorks: "互动电影式分支结构",
    },
    characters: [
      { id: "char-detective", name: "调查员", internalDesire: "找到失踪真相", externalGoal: "进入剧院调查", flaw: "过度谨慎", psychologicalProfile: "高压下会用观察替代行动" },
      { id: "char-stranger", name: "陌生人", internalDesire: "逃离剧院", externalGoal: "说服调查员相信自己", flaw: "话语破碎难以取信" },
    ],
    assets: [
      { id: "loc-theater", type: "location", name: "废弃剧院", description: "潮湿、冷光、狭窄入口，适合悬疑影游节点。" },
      { id: "loc-street", type: "location", name: "剧院外街", description: "雨夜街道，路灯闪烁，适合离开结局。" },
      { id: "prop-key", type: "prop", name: "门禁钥匙", description: "旧铜钥匙，决定能否进入暗门。" },
    ],
    episodes: episodes.map(({ scenes, gameData, ...meta }) => ({
      ...meta,
      sceneCount: scenes.length,
    })),
    universalSkillRefs: [],
    globalGenerationParams: { qualityPrompt: "", negativePrompt: "" },
  };

  return { project, episodes };
};

export const simulateInteractivePath = (
  data: GameProjectData,
  choiceIds: string[],
): SimulatedPlaytestResult => {
  const state: Record<string, number | boolean | string> = {};
  data.variables.forEach((variable) => {
    state[variable.name] = variable.defaultValue ?? variable.initialValue ?? (variable.type === "number" ? 0 : variable.type === "boolean" ? false : "");
  });

  const visitedNodeIds: string[] = [];
  let current = data.nodes.find((node) => node.id === "start") || data.nodes[0];
  let choiceCursor = 0;

  while (current) {
    visitedNodeIds.push(current.id);
    current.onEnterActions?.forEach((action) => {
      const variable = data.variables.find((item) => item.id === action.targetVariableId);
      if (!variable) return;
      if (action.operation === "set") state[variable.name] = action.value;
      if (action.operation === "add") state[variable.name] = Number(state[variable.name] || 0) + Number(action.value);
      if (action.operation === "subtract") state[variable.name] = Number(state[variable.name] || 0) - Number(action.value);
    });

    if (current.isEnding) break;
    const outgoing = data.edges.filter((edge) => edge.sourceNodeId === current.id);
    const nextChoiceId = choiceIds[choiceCursor];
    const selected = outgoing.find((edge) => edge.id === nextChoiceId) || outgoing[0];
    if (!selected) break;
    choiceCursor += 1;
    current = data.nodes.find((node) => node.id === selected.targetNodeId);
  }

  return {
    visitedNodeIds,
    state,
    endingNodeId: current?.isEnding ? current.id : null,
  };
};

export const runInteractiveManualFlowSelfCheck = () => {
  const { project, episodes } = createManualInteractiveSampleProject();
  const chapterOne = episodes[0];
  const chapterTwo = episodes[1];

  const scenes = compileGameToInteractiveScenes(chapterOne.gameData, chapterOne.scenes);
  checkEqual(scenes.length, chapterOne.gameData.nodes.length, "节点到 Scene 投影数量不一致");
  check(scenes.find((scene) => scene.id === "start")?.interactiveMetadata?.outboundChoices?.length === 2, "起点节点没有投影出两个分支出口");
  check(scenes.find((scene) => scene.id === "help")?.description.includes("前置上下文"), "节点 Scene 缺少前置上下文");
  const initialProjection = applyInteractiveProjectionSync(
    chapterOne.gameData,
    JSON.parse(JSON.stringify(scenes)),
  );
  const persistedProjection = applyInteractiveProjectionSync(
    initialProjection.gameData,
    JSON.parse(JSON.stringify(initialProjection.scenes)),
  );
  checkEqual(Object.keys(persistedProjection.nodeUpdates).length, 0, "持久化后的等价媒体引用不应持续触发节点投影更新");

  const context = buildInteractiveProductionContext(project, chapterOne, chapterOne.gameData, "help");
  check(context.nodeContext.includes("help"), "互动上下文缺少节点 ID");
  check(context.incomingContext.includes("进入剧院救人"), "互动上下文缺少入边选择");
  check(context.pathContext.includes("雨夜门廊"), "互动上下文缺少路径追溯");
  check(context.variableContext.includes("trust"), "互动上下文缺少变量系统");

  const qa = createInteractiveAssemblyQAReport(chapterOne.gameData, project.interactiveConfig?.targetEndingCount || 0, {
    currentEpisodeId: chapterOne.id,
    episodeIds: project.episodes.map((episode) => episode.id),
    episodeNodeIdsByEpisodeId: {
      [chapterOne.id]: chapterOne.gameData.nodes.map((node) => node.id),
      [chapterTwo.id]: chapterTwo.gameData.nodes.map((node) => node.id),
    },
  });
  checkEqual(qa.blockingCount, 0, `组装 QA 存在阻断问题 ${JSON.stringify(qa.issues, null, 2)}`);
  check(qa.playablePathCount >= 2, "可播路径数量不足");
  checkEqual(qa.stateDeadEndCount, 0, "变量模拟不应产生死路");
  checkEqual(qa.coveredEndingIds.length, 2, "变量模拟结局覆盖不足");

  const helpPath = simulateInteractivePath(chapterOne.gameData, ["edge-help", "edge-gate"]);
  checkArrayEqual(helpPath.visitedNodeIds, ["start", "help", "chapter-two-gate"], "救人路径节点序列错误");
  checkEqual(helpPath.state.trust, 1, "救人路径 trust 状态错误");
  checkEqual(helpPath.state.hasKey, true, "救人路径 hasKey 状态错误");
  checkEqual(helpPath.endingNodeId, "chapter-two-gate", "救人路径结局错误");

  const defaultPath = simulateInteractivePath(chapterOne.gameData, ["edge-leave"]);
  checkArrayEqual(defaultPath.visitedNodeIds, ["start", "leave"], "默认离开路径节点序列错误");
  checkEqual(defaultPath.state.trust, -1, "默认离开路径 trust 状态错误");
  checkEqual(defaultPath.endingNodeId, "leave", "默认离开路径结局错误");

  return {
    projectTitle: project.title,
    sceneCount: scenes.length,
    qaScore: qa.score,
    playablePathCount: qa.playablePathCount,
    totalPathCount: qa.totalPathCount,
    helpPath,
    defaultPath,
  };
};
