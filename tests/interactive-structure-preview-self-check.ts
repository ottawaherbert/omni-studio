import assert from "node:assert";
import { buildStructurePreviewPayload } from "../src/domains/interactive/builder/interactiveStructurePreviewBuild";
import type { NarrativeGraphVersion, StateSchema } from "../src/domains/interactive/types/schema";

const graph: NarrativeGraphVersion = {
  id: "graph_test_1",
  experienceId: "exp_1",
  versionIndex: 1,
  entryNodeId: "n1",
  locked: false,
  status: "approved",
  createdAt: "2026-07-28T00:00:00.000Z",
  nodes: [
    {
      id: "n1",
      brief: {
        nodeId: "n1",
        title: "入口",
        intent: "建立危机",
        dramaticFunction: "exposition",
        narrativeSummary: "主角进入封锁区域。",
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      interaction: {
        capabilities: ["play_content", "present_choice"],
        contentPolicy: "create_shared_content",
        durationRangeSec: [30, 60],
        playerKnowledgeIn: [],
        playerKnowledgeOut: ["危机已经发生"],
      },
      choices: [{
        id: "c1",
        text: "继续",
        intent: "深入调查",
        targetNodeId: "n2",
        effects: [],
        interaction: {
          playerKnowledge: "主角知道前方仍有风险",
          immediateFeedback: "进入下一处区域",
          consequenceHorizon: "immediate",
          thematicMeaning: "主动承担风险",
          convergenceStrategy: "terminal",
          estimatedUniqueMediaSec: 30,
          replayValue: "查看安全点结果",
        },
      }],
    },
    {
      id: "n2",
      brief: {
        nodeId: "n2",
        title: "第二个已完成节点",
        intent: "确认前方路线",
        dramaticFunction: "choice_point",
        narrativeSummary: "主角抵达安全点并确认下一段路线。",
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      interaction: {
        capabilities: ["play_content", "present_choice"],
        contentPolicy: "create_shared_content",
        durationRangeSec: [30, 60],
        playerKnowledgeIn: ["危机已经发生"],
        playerKnowledgeOut: ["下一段路线已经确认"],
      },
      choices: [{
        id: "c2",
        text: "继续核查",
        intent: "完成入口路径检查",
        targetNodeId: "n3",
        effects: [],
      }],
    },
    {
      id: "n3",
      brief: {
        nodeId: "n3",
        title: "第三个已完成节点",
        intent: "完成已制作路径",
        dramaticFunction: "choice_point",
        narrativeSummary: "主角完成入口段调查，准备进入未制作区域。",
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      interaction: {
        capabilities: ["play_content", "present_choice"],
        contentPolicy: "create_shared_content",
        durationRangeSec: [30, 60],
        playerKnowledgeIn: ["下一段路线已经确认"],
        playerKnowledgeOut: ["入口段调查完成"],
      },
      choices: [{
        id: "c3",
        text: "查看后续草案",
        intent: "进入未制作路径",
        targetNodeId: "n4",
        effects: [],
      }],
    },
    {
      id: "n4",
      brief: {
        nodeId: "n4",
        title: "未完成路径",
        intent: "预览后续结构",
        dramaticFunction: "resolution",
        narrativeSummary: "后续内容尚未写成剧本，但结构摘要可以试玩。",
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      interaction: {
        capabilities: ["play_content", "present_choice"],
        contentPolicy: "create_shared_content",
        durationRangeSec: [20, 40],
        playerKnowledgeIn: ["入口段调查完成"],
        playerKnowledgeOut: ["后续结构可见"],
      },
      choices: [{
        id: "c4",
        text: "抵达结尾",
        intent: "完成结构试玩",
        targetNodeId: "n5",
        effects: [],
      }],
    },
    {
      id: "n5",
      brief: {
        nodeId: "n5",
        title: "结构结尾",
        intent: "结束试玩路径",
        dramaticFunction: "ending",
        narrativeSummary: "结构试玩抵达暂定结尾。",
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      interaction: {
        capabilities: ["play_content", "terminal"],
        contentPolicy: "create_shared_content",
        durationRangeSec: [10, 20],
        playerKnowledgeIn: ["后续结构可见"],
        playerKnowledgeOut: ["结构试玩完成"],
      },
      choices: [],
    },
  ],
};
const stateSchema: StateSchema = { variables: [], factDefinitions: [], initialFactIds: [] };

const payload = buildStructurePreviewPayload({
  graph,
  stateSchema,
  approvedNodeIds: ["n1", "n2", "n3"],
});

assert.deepStrictEqual(payload.warningNodeIds, ["n4", "n5"]);
assert.strictEqual(payload.previewTextByNodeId.n1, "主角进入封锁区域。");
assert.strictEqual(payload.previewTextByNodeId.n3, "主角完成入口段调查，准备进入未制作区域。");
assert.strictEqual(payload.previewTextByNodeId.n4, "后续内容尚未写成剧本，但结构摘要可以试玩。");
assert.strictEqual(Object.keys(payload.previewTextByNodeId).length, 5);
assert.throws(
  () => buildStructurePreviewPayload({
    graph: { ...graph, entryNodeId: "missing" },
    stateSchema,
  }),
  /有效入口节点/,
);

console.log("✓ Structure preview uses the real graph validator and permits missing approved content.");
