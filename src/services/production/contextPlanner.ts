import { ContextPlan, ProductionRunProjectInput } from "../../types/production";
import { defaultContextPlan } from "./stages";
import {
  ensureSkillReferenceRouting,
  isReferenceAllowedForContext,
  routeProjectReferencesForContext,
} from "./referenceGovernance";
import { buildLongFormMemoryContext } from "./longFormMemory";
import { skillBodyText } from "../../utils/universalSkillText";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";

export const createInitialContextPlan = (
  project: ProductionRunProjectInput,
): ContextPlan => {
  const routedReferences = routeProjectReferencesForContext(project);
  const universalSkillRefs = routedReferences.universalSkillRefs;
  const rejectedSkillIds = projectUniversalSkillRefs(project)
    .map(ensureSkillReferenceRouting)
    .filter((skill) => !isReferenceAllowedForContext(skill))
    .map((skill) => skill.id);
  const activeSkillIds = universalSkillRefs.map((skill) => skill.id);
  const skillScores = Object.fromEntries(
    universalSkillRefs.map((skill) => {
      const score = Math.min(100, Math.max(10, Math.ceil(skillBodyText(skill).length / 12)));
      return [skill.id, score];
    }),
  );
  const universalSkillIds = universalSkillRefs.filter((skill) => skillBodyText(skill)).map((skill) => skill.id);
  const characterSkillIds = universalSkillIds;
  const structureSkillIds = universalSkillIds;
  const visualSkillIds = universalSkillIds;
  const scriptSkillIds = universalSkillIds;
  const forbiddenSkills = universalSkillRefs
    .filter((skill) => !skillBodyText(skill))
    .map((skill) => skill.id);
  const hasVideoAnalysisDNA = Boolean(project.appliedVADnaProjectId);
  const longFormMemory = buildLongFormMemoryContext(project as any);
  const longFormPressure = longFormMemory.isLongForm
    ? 900 + Math.min(2400, longFormMemory.phaseMap.length * 240 + longFormMemory.generatedEpisodeCount * 20)
    : 0;
  const contextPressure = activeSkillIds.length * 180 + (hasVideoAnalysisDNA ? 800 : 0);
  const tokenBudgetEstimate = Object.fromEntries(
    Object.entries(defaultContextPlan.tokenBudgetEstimate).map(([stageType, budget]) => [
      stageType,
      Math.min(12000, budget + contextPressure + longFormPressure),
    ]),
  );

  return {
    ...defaultContextPlan,
    globalSkills: activeSkillIds,
    scriptSkills: scriptSkillIds,
    visualSkills: visualSkillIds,
    dialogueSkills: characterSkillIds,
    pacingDNAs: hasVideoAnalysisDNA ? [project.appliedVADnaProjectId!, ...structureSkillIds] : structureSkillIds,
    shotDNAs: hasVideoAnalysisDNA ? [project.appliedVADnaProjectId!, ...visualSkillIds] : visualSkillIds,
    forbiddenSkills: Array.from(new Set([...forbiddenSkills, ...rejectedSkillIds])),
    skillScores,
    tokenBudgetEstimate,
    reason: [
      "基于创建项目时的 Skill 与拉片 DNA 选择生成初始 ContextPlan。",
      `已识别全局 Skill ${activeSkillIds.length} 个、剧本 Skill ${scriptSkillIds.length} 个、视觉 Skill ${visualSkillIds.length} 个、对白 Skill ${characterSkillIds.length} 个。`,
      `阶段上下文规模估算已计入 Skill 与拉片 DNA 的约 ${contextPressure} tokens；该数值只用于审计，不会截断发送内容。`,
      longFormMemory.isLongForm
        ? `检测到长篇/多集项目：将注入 productionMemory 分段压缩上下文，额外预留 ${longFormPressure} tokens。`
        : "未检测到长篇分段记忆压力。",
      hasVideoAnalysisDNA
        ? "检测到拉片 DNA：仅允许进入节奏、冲突机制、情绪曲线和镜头策略。"
        : "未选择拉片 DNA。",
      longFormMemory.missingRequirements.length
        ? `长篇记忆缺口：${longFormMemory.missingRequirements.join("；")}`
        : "长篇记忆未发现基础缺口。",
      forbiddenSkills.length + rejectedSkillIds.length > 0
        ? `发现 ${forbiddenSkills.length + rejectedSkillIds.length} 个缺少结构化能力描述或未通过参考治理的 Skill，暂列入 forbiddenSkills，避免污染上下文。`
        : "未发现需要禁用的 Skill。",
    ].join(" "),
  };
};
