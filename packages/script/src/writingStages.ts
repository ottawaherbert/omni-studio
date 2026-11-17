export const SCRIPT_STAGES=['BLUEPRINT','OUTLINE','SCENES','BODY'] as const;
// Frozen historical contracts keep their original boundary; new pickers expose four stages.
export const COMPATIBLE_SCRIPT_STAGES=[...SCRIPT_STAGES,'BEATS'] as const;
export type ScriptStage=typeof COMPATIBLE_SCRIPT_STAGES[number];
export const stageLabels:Record<ScriptStage,string>={BLUEPRINT:'全案蓝图',OUTLINE:'故事大纲',BEATS:'故事节拍（旧任务）',SCENES:'分场规划',BODY:'剧本初稿与检查'};
export const stageDescriptions:Record<ScriptStage,string>={
  BLUEPRINT:'整理核心构想、主要人物、必要设定和创作方向。允许保留待定事项，不要求提前完成整个故事。',
  OUTLINE:'形成整体故事或所选集的大纲：具体事件、人物选择、前后因果与结局或阶段落点。单元剧允许各集独立，不强求全剧结局线。电影已有完整故事大纲时不必再重复生成单元摘要。',
  SCENES:'把所选范围展开为有顺序的场景，说明每场发生什么、谁在、地点时间和必要的前后变化。节拍与节奏在此处理，不另生成一份重复节拍稿；不写正文。',
  BODY:'展开约定范围的动作、对白和场景描写，完成检查与有限修订。交付可阅读初稿和未解决事项，不等同于作者验收或最终定稿。',
  BEATS:'按旧委托交付场景级故事推进规划，保留原停止边界，不自动升级到分场或正文。',
};
export const SCRIPT_WORKFLOW_GUIDANCE='默认流程：全案蓝图 → 故事大纲（含分集）→ 分场规划（含节拍与节奏）→ 剧本写作（含修订）。阶段可以往返或按作者要求跳过；上游资料可持续完善，不必全部填满。大纲要讲具体事件、人物选择与因果，不重复世界观介绍。分场是场景序列，节拍是事件或情绪变化，两者不强制一一对应。不强制三幕、十五节拍、每场反转或人物蜕变。剧集先有整体方向，再逐集细化，允许只完成当前集，不要求全部集数先完成分场。修改上游只说明需复核的下游内容，不擅自改写授权范围外的稿件。';
export const isPlanningStage=(stage:ScriptStage|undefined)=>Boolean(stage&&stage!=='BODY');
