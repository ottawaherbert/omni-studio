import { ProductionStageType } from "../../types/production";

export interface ProductionAgentRubric {
  agentId: string;
  ownedStages: ProductionStageType[];
  responsibilities: string[];
  requiredContext: string[];
  outputContract: string[];
  qaGates: string[];
  forbiddenActions: string[];
  verificationMetrics: string[];
}

export const productionAgentRubrics: ProductionAgentRubric[] = [
  {
    agentId: "concept.agent",
    ownedStages: ["concept"],
    responsibilities: ["生成 logline、核心冲突、主题与视听基调"],
    requiredContext: ["项目标题", "原始灵感", "项目类型", "创作视点"],
    outputContract: ["project.logline", "project.coreConflict", "project.creativeVision"],
    qaGates: ["CONCEPT", "CREATIVE_QUALITY", "FORMAT_STANDARDS"],
    forbiddenActions: ["写入角色库或分镜", "提示词未通过检查时进入媒体生成"],
    verificationMetrics: ["logline 非空", "核心冲突包含目标、阻力、代价", "视觉风格可被后续 prompt 使用"],
  },
  {
    agentId: "bible.agent",
    ownedStages: ["bible", "interactive_bible"],
    responsibilities: ["生成世界观、角色规划、地点规划、道具规划"],
    requiredContext: ["立项概念", "核心冲突", "项目类型", "目标体量"],
    outputContract: ["worldBuildingRules", "plannedCharacters", "plannedLocations", "plannedProps"],
    qaGates: ["BIBLE"],
    forbiddenActions: ["生成最终分镜", "绕过资产待确认流程"],
    verificationMetrics: ["角色不为空", "地点/道具服务剧情", "世界观规则可执行"],
  },
  {
    agentId: "script.agent",
    ownedStages: ["script", "interactive_script"],
    responsibilities: ["为场景生成结构化剧本、breakdown 和表演/动作节拍草案"],
    requiredContext: ["项目圣经", "场景描述", "角色/地点/道具上下文", "修订意见"],
    outputContract: ["scriptBlocks", "script", "breakdown", "performance_beats"],
    qaGates: ["SCRIPT", "ASSET_LIFECYCLE", "CREATIVE_QUALITY", "FORMAT_STANDARDS"],
    forbiddenActions: ["只输出散文剧本", "丢失 breakdown", "改写上游 Bible"],
    verificationMetrics: ["scriptBlocks 可消费", "breakdown 完整", "performance_beats 有可见变化和连续性", "人物目标连续"],
  },
  {
    agentId: "storyboard.agent",
    ownedStages: ["storyboard", "interactive_storyboard"],
    responsibilities: ["生成镜头、时长、镜头动机、表演微动作"],
    requiredContext: ["结构化剧本", "breakdown", "角色/场景资产"],
    outputContract: ["shots", "shot.duration", "shot.visualAction"],
    qaGates: ["STORYBOARD", "PROMPT", "CREATIVE_QUALITY", "FORMAT_STANDARDS"],
    forbiddenActions: ["生成空 shot", "用抽象情绪替代可拍摄画面"],
    verificationMetrics: ["镜头覆盖剧本", "时长合理", "角色/地点/道具引用可解析"],
  },
  {
    agentId: "graph.generator",
    ownedStages: ["graph_generation"],
    responsibilities: ["生成互动节点、选择边、变量和结局结构"],
    requiredContext: ["互动蓝图", "目标结局数", "分支密度", "玩家身份"],
    outputContract: ["GameNode[]", "GameChoice[]", "GameVariable[]"],
    qaGates: ["GRAPH", "FORMAT_STANDARDS"],
    forbiddenActions: ["生成不可达主线", "引用未定义变量"],
    verificationMetrics: ["至少一个 start", "结局数量达标", "无断边", "变量引用合法"],
  },
  {
    agentId: "media.readiness",
    ownedStages: ["expensive_generation_planning"],
    responsibilities: ["整理图片/视频提示词数量、视频生成单元、就绪状态和优先级"],
    requiredContext: ["shots", "imagePrompt", "videoPrompt", "storyboard_board", "asset_reference_pack", "生成策略"],
    outputContract: ["generation_plan", "video_generation_unit"],
    qaGates: ["MEDIA"],
    forbiddenActions: ["提示词或参考资产不完整时调用生图/视频模型"],
    verificationMetrics: ["输出优先级队列", "生成单元参数完整", "缺少提示词或参考资产时准确阻断"],
  },
];

export const findProductionAgentRubric = (agentId: string) =>
  productionAgentRubrics.find((rubric) => rubric.agentId === agentId);

export const validateProductionAgentRubrics = () => {
  const issues: string[] = [];
  productionAgentRubrics.forEach((rubric) => {
    if (rubric.ownedStages.length === 0) issues.push(`${rubric.agentId}: missing ownedStages`);
    if (rubric.responsibilities.length === 0) issues.push(`${rubric.agentId}: missing responsibilities`);
    if (rubric.requiredContext.length === 0) issues.push(`${rubric.agentId}: missing requiredContext`);
    if (rubric.outputContract.length === 0) issues.push(`${rubric.agentId}: missing outputContract`);
    if (rubric.qaGates.length === 0) issues.push(`${rubric.agentId}: missing qaGates`);
    if (rubric.forbiddenActions.length === 0) issues.push(`${rubric.agentId}: missing forbiddenActions`);
    if (rubric.verificationMetrics.length === 0) issues.push(`${rubric.agentId}: missing verificationMetrics`);
  });
  return issues;
};
