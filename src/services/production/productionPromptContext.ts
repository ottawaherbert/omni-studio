import type { Project } from "../../types/project";
import type {
  ContextPlan,
  ProductionReferenceInfluence,
  ProductionRuntimeControls,
  ProductionStageRun,
} from "../../types/production";
import { safeParseAIResponse } from "../../utils/aiParser";
import {
  formatCreativeVision,
  getProjectTypeLabel,
} from "../../utils/projectUtils";
import { renderUniversalSkillLines, skillBodyText, skillTitleText } from "../../utils/universalSkillText";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";
import { buildLongFormMemoryContext, renderLongFormMemoryForPrompt } from "./longFormMemory";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const contextPlanFromStage = (stage?: ProductionStageRun): ContextPlan | undefined => {
  const context = stage?.contextUsed as { contextPlan?: ContextPlan } | ContextPlan | undefined;
  if (!context) return undefined;
  if ("contextPlan" in context && context.contextPlan) return context.contextPlan;
  if ("globalSkills" in context) return context as ContextPlan;
  return undefined;
};

const contextSelectionForStage = (
  stageType: ProductionStageRun["stageType"],
  plan: ContextPlan,
) => {
  if (["storyboard", "prompt", "interactive_storyboard"].includes(stageType)) {
    return {
      skillIds: unique([...plan.visualSkills]),
      dnaIds: unique([...plan.shotDNAs]),
      fieldScope: ["title", "projectModel", "logline", "visualStyle", "aspectRatio", "productionMemory", "fieldLanguagePolicy"],
    };
  }
  if (["script", "interactive_script"].includes(stageType)) {
    return {
      skillIds: unique([...plan.scriptSkills, ...plan.dialogueSkills]),
      dnaIds: unique([...plan.pacingDNAs]),
      fieldScope: ["title", "projectModel", "logline", "coreConflict", "narrativeStyle", "dialogueStyle", "productionMemory"],
    };
  }
  if (["structure", "scene", "game_blueprint", "graph_generation", "interactive_graph_qa"].includes(stageType)) {
    return {
      skillIds: unique([...plan.scriptSkills]),
      dnaIds: unique([...plan.pacingDNAs]),
      fieldScope: ["title", "projectModel", "originalInspiration", "refinedInspiration", "logline", "coreConflict", "narrativeStyle", "productionMemory"],
    };
  }
  if (["bible", "interactive_bible", "asset_detail", "asset_sync"].includes(stageType)) {
    return {
      skillIds: unique([...plan.globalSkills, ...plan.scriptSkills]),
      dnaIds: unique([...plan.pacingDNAs]),
      fieldScope: ["title", "projectModel", "originalInspiration", "logline", "coreConflict", "creativeVision", "productionMemory"],
    };
  }
  if (stageType === "expensive_generation_planning") {
    return {
      skillIds: unique([...plan.visualSkills]),
      dnaIds: unique([...plan.shotDNAs]),
      fieldScope: ["title", "projectModel", "fieldLanguagePolicy", "tokenBudget"],
    };
  }
  return {
    skillIds: unique([...plan.globalSkills]),
    dnaIds: unique([...plan.pacingDNAs, ...plan.shotDNAs]),
    fieldScope: ["title", "projectModel", "originalInspiration", "logline", "coreConflict", "creativeVision", "productionMemory"],
  };
};

const renderSkillContext = (
  project: Project,
  skillIds: string[],
  stageType: ProductionStageRun["stageType"],
) => {
  const selectedSkills = projectUniversalSkillRefs(project).filter((skill) => skillIds.includes(skill.id));
  if (selectedSkills.length === 0) return "";
  return renderUniversalSkillLines(selectedSkills);
};

const stageReferenceUses = (stageType: ProductionStageRun["stageType"]) => {
  if (["structure", "scene", "game_blueprint", "graph_generation", "interactive_graph_qa"].includes(stageType)) {
    return ["结构/节奏", "冲突机制", "情绪曲线"];
  }
  if (["script", "interactive_script"].includes(stageType)) {
    return ["对白/表演", "人物反应", "场景推进"];
  }
  if (["storyboard", "prompt", "interactive_storyboard", "expensive_generation_planning"].includes(stageType)) {
    return ["镜头策略", "色彩/光线", "运镜/剪辑", "视觉提示词"];
  }
  if (["bible", "interactive_bible", "asset_detail"].includes(stageType)) {
    return ["主题命题", "人物原型", "世界观边界"];
  }
  return ["创作校准"];
};

const buildReferenceInfluenceTrace = (
  project: Project,
  skillIds: string[],
  dnaIds: string[],
  stageType: ProductionStageRun["stageType"],
): ProductionReferenceInfluence[] => {
  const selectedSkills = projectUniversalSkillRefs(project).filter((skill) => skillIds.includes(skill.id));
  const influences = selectedSkills.map((skill): ProductionReferenceInfluence => {
    const hasBody = Boolean(skillBodyText(skill));
    return {
      sourceId: skill.id,
      sourceName: skillTitleText(skill, skill.id),
      sourceType: "universal-skill",
      category: "custom",
      influenceAxes: hasBody ? ["通用 Skill 原文"] : ["空 Skill"],
      appliedAs: hasBody ? stageReferenceUses(stageType) : ["未注入"],
      limitations: [
        "只作为作者本次选择的创作参考，不覆盖任务目标、事实和输出格式。",
        "不得把 Skill 标题当作可复制的作品来源或镜头方案。",
      ],
    };
  });

  const appliedDnaId = project.appliedVADnaProjectId;
  if (appliedDnaId && dnaIds.includes(appliedDnaId) && !influences.some((item) => item.sourceId === appliedDnaId || item.sourceId.startsWith("skill-macro"))) {
    influences.push({
      sourceId: appliedDnaId,
      sourceName: "拉片 DNA 项目",
      sourceType: "video-analysis",
      category: "structure",
      influenceAxes: stageReferenceUses(stageType),
      appliedAs: ["节奏、冲突机制、情绪曲线或镜头策略参考"],
      limitations: ["只允许参考抽象 DNA，禁止迁移原片人物、台词、场景和世界观。"],
    });
  }

  return influences;
};

const runtimeControlsFromStage = (stage?: ProductionStageRun): ProductionRuntimeControls | undefined => {
  const context = stage?.contextUsed;
  if (!context || typeof context !== "object" || !("runtimeControls" in context)) return undefined;
  return (context as { runtimeControls?: ProductionRuntimeControls }).runtimeControls;
};

const renderRuntimeControls = (controls?: ProductionRuntimeControls) => {
  if (!controls) return "";
  return [
    `创作温度: ${controls.creativeTemperature}`,
    `镜头密度: ${controls.shotDensity}`,
    `对白密度: ${controls.dialogueDensity}`,
    `短剧节拍频率: ${controls.shortDramaBeatFrequency}`,
    `互动分支深度: ${controls.interactiveBranchDepth}`,
  ].join("；");
};

export const buildStageContextTrace = (
  project: Project,
  plan: ContextPlan,
  stageType: ProductionStageRun["stageType"],
) => {
  const selection = contextSelectionForStage(stageType, plan);
  const referenceInfluence = buildReferenceInfluenceTrace(project, selection.skillIds, selection.dnaIds, stageType);
  const creativeVision = (project.creativeVision || {}) as NonNullable<Project["creativeVision"]>;
  const creativeVisionFields = [
    creativeVision.visualStyle,
    creativeVision.narrativeStyle,
    creativeVision.referenceWorks,
    creativeVision.want,
    creativeVision.need,
    creativeVision.stakes,
    creativeVision.themeQuestion,
  ].filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(String(value || "").trim())).length +
    (Array.isArray(creativeVision.genre) ? creativeVision.genre.length : 0);
  const fieldScope = selection.fieldScope;
  const includesAny = (fields: string[]) => fields.some((field) => fieldScope.includes(field));
  const contextInventory = {
    universalSkillRefs: projectUniversalSkillRefs(project).length,
    worldBuildingRules: (project.worldBuildingRules || []).length,
    relationships: (project.relationships || []).length,
    characters: (project.characters || []).length,
    productionMemory: Boolean(project.productionMemory || project.operatorProductionMemory || Number(project.targetEpisodeCount || 0) >= 10),
    creativeVisionFields,
  };
  const omittedProjectContext = [
    contextInventory.worldBuildingRules > 0 && !fieldScope.includes("worldBuildingRules") ? "worldBuildingRules" : "",
    contextInventory.relationships > 0 && !fieldScope.includes("relationships") ? "relationships" : "",
    contextInventory.characters > 0 && !fieldScope.includes("characters") && !fieldScope.includes("plannedCharacters") ? "characters" : "",
    contextInventory.creativeVisionFields > 0 && !includesAny(["creativeVision", "visualStyle", "narrativeStyle", "dialogueStyle"]) ? "creativeVision" : "",
    contextInventory.productionMemory && !fieldScope.includes("productionMemory") ? "productionMemory" : "",
  ].filter(Boolean);
  return {
    stageType,
    fieldScope,
    skillIds: selection.skillIds,
    dnaIds: selection.dnaIds,
    forbiddenSkillIds: plan.forbiddenSkills,
    tokenBudget: plan.tokenBudgetEstimate[stageType],
    fieldLanguagePolicy: plan.fieldLanguagePolicy,
    selectedSkillCount: projectUniversalSkillRefs(project).filter((skill) => selection.skillIds.includes(skill.id)).length,
    referenceInfluence,
    contextInventory,
    omittedProjectContext,
    reason: plan.reason,
  };
};

const longFormProfileForStage = (stageType: ProductionStageRun["stageType"]) => {
  if (["structure", "game_blueprint", "graph_generation"].includes(stageType)) return "outline";
  if (["scene", "node_to_scene"].includes(stageType)) return "scene";
  if (["script", "interactive_script"].includes(stageType)) return "script";
  if (["storyboard", "interactive_storyboard"].includes(stageType)) return "storyboard";
  if (stageType === "prompt") return "visual_prompt";
  return "default";
};

export const renderStageContextEnvelope = (
  project: Project,
  stage?: ProductionStageRun,
) => {
  const plan = contextPlanFromStage(stage);
  if (!stage || !plan) return "";
  const trace = buildStageContextTrace(project, plan, stage.stageType);
  const skillContext = renderSkillContext(project, trace.skillIds, stage.stageType);
  const runtimeControls = renderRuntimeControls(runtimeControlsFromStage(stage));
  return [
    runtimeControls ? `【作者运行控制】\n${runtimeControls}` : "",
    skillContext ? `【本任务适用方法】\n${skillContext}` : "",
  ].filter(Boolean).join("\n");
};

export const projectContext = (project: Project, stage?: ProductionStageRun) => {
  const plan = contextPlanFromStage(stage);
  const fieldScope = plan && stage ? contextSelectionForStage(stage.stageType, plan).fieldScope : [];
  const include = (field: string) => fieldScope.length === 0 || fieldScope.includes(field);
  const longFormMemory = stage && include("productionMemory")
    ? renderLongFormMemoryForPrompt(buildLongFormMemoryContext(project, { profile: longFormProfileForStage(stage.stageType) }))
    : "";
  return [
    `标题: ${project.title}`,
    `类型: ${getProjectTypeLabel(project.type)}`,
    project.workType && `作品类型: ${project.workType}`,
    `形态: ${project.projectModel === "interactive" ? "互动影视游戏" : "线性影视"}`,
    include("originalInspiration") && project.originalInspiration ? `原始灵感: ${project.originalInspiration}` : "",
    include("refinedInspiration") && project.refinedInspiration ? `精炼套路: ${project.refinedInspiration}` : "",
    include("logline") && project.logline ? `Logline: ${project.logline}` : "",
    include("coreConflict") && project.coreConflict ? `核心冲突: ${project.coreConflict}` : "",
    include("aspectRatio") ? `画幅: ${project.aspectRatio}` : "",
    include("creativeVision") || include("visualStyle") || include("narrativeStyle")
      ? `创作视点:\n${formatCreativeVision(project.creativeVision)}`
      : "",
    longFormMemory ? `长篇多集记忆:\n${longFormMemory}` : "",
    renderStageContextEnvelope(project, stage),
  ].filter(Boolean).join("\n\n");
};

export const revisionGuidance = (stage: ProductionStageRun) =>
  stage.revisionInstructions
    ? `\n\n本次重做必须优先响应以下人工修订意见：\n${stage.revisionInstructions}`
    : "";

export const parseResult = <T>(response: string, fallback: T) =>
  safeParseAIResponse<T>(response, fallback);
