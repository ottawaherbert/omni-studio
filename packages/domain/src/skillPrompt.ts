export const buildSkillAIDraftPrompt = (input: { userIdea: string; categoryHint?: string }) => [
  "【角色设定】",
  "你是专业创作教练和提示词整理助手。你擅长把作者零散的创作要求整理成一个可复用的 Skill。",
  "",
  "【任务目标】",
  "请根据作者输入，生成一个通用 Skill。Skill 是可被注入任意 AI 提示词的创作参考，不属于任何特定模块。",
  input.userIdea.trim() ? `\n【作者需求】\n${input.userIdea.trim()}` : "",
  input.categoryHint?.trim() ? `\n【分类参考】\n${input.categoryHint.trim()}` : "",
  "",
  "【生成要求】",
  "1. title：2-16 字，清楚表达 Skill 主题。",
  "2. categoryName：给出适合归档的分类名；如果作者已有分类，则优先使用作者分类。",
  "3. content：写成作者可以直接注入提示词的规则文本。",
  "4. content 不要拆成复杂 JSON 字段，不要写导演、音频、视觉等固定模板，除非作者明确要求。",
  "5. content 要可执行，避免空泛口号。",
  "6. content 可以包含条目、注意事项、示例，但不要限制只能用于某个模块。",
  "",
  "【输出格式规范】",
  "输出严格 JSON，不要 Markdown，不要解释。",
  "",
  "JSON 结构：",
  "{\"title\":\"\",\"categoryName\":\"\",\"content\":\"\"}",
].filter(Boolean).join("\n");

export const skillContentForRecommendation = (value: string) => {
  const cleaned = String(value || "")
    .replace(/^---[\s\S]*?---/, "")
    .replace(/^【来源】.*$/gm, "")
    .replace(/^【用途】.*$/gm, "")
    .trim();
  const explicitSummary = cleaned.match(/(?:^|\n)#{1,3}\s*(?:简介|摘要|用途|核心规则)\s*\n([\s\S]*?)(?=\n#{1,3}\s|$)/)?.[1]?.trim();
  return (explicitSummary || cleaned).replace(/\s+/g, " ").trim();
};

export const buildSkillRecommendationPrompt = (input: {
  taskLabel: string;
  stage?: string;
  projectFormat?: string;
  targetUnitCount?: number;
  targetDurationMinutes?: number;
  blueprintSummary?: string;
  currentPromptPreview?: string;
  selectedSkillTitles?: string[];
  categories?: Array<{ id: string; name: string }>;
  skills: Array<{ id: string; title: string; categoryName?: string; content?: string; selected?: boolean }>;
}) => {
  const skillLines = input.skills.map((skill, index) => [
    `${index + 1}. ID: ${skill.id}`,
    `标题: ${skill.title}`,
    skill.categoryName ? `分类: ${skill.categoryName}` : "",
    `当前状态: ${skill.selected ? "已选" : "候选"}`,
    skill.content?.trim() ? `内容摘要: ${skill.content.replace(/\s+/g, " ").trim()}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  const taskLines = [
    `任务：${input.taskLabel}`,
    input.stage ? `阶段：${input.stage}` : "",
    input.projectFormat ? `项目形态：${input.projectFormat}` : "",
    input.targetUnitCount !== undefined ? `目标单元数：${input.targetUnitCount}` : "",
    input.targetDurationMinutes !== undefined ? `目标时长：${input.targetDurationMinutes}` : "",
  ].filter(Boolean).join("\n");

  return [
    "【角色设定】",
    "你是创作系统的技能推荐助手。你只负责从现有技能库里推荐适合当前任务的 Skill；任务可以来自写作、制作、互动、拉片等模块。",
    "",
    "【任务目标】",
    "根据当前任务、项目形态、目标体量、蓝图摘要和 Skill 库候选，推荐本次最适合挂载的 Skill。",
    "你不能修改项目，不能修改 Skill，不能执行正式生成任务，也不能编造不存在的 Skill ID。",
    "",
    "【当前任务】",
    taskLines,
    input.blueprintSummary ? `\n【蓝图/上下文摘要】\n${input.blueprintSummary}` : "",
    input.currentPromptPreview ? `\n【当前提示词】\n${input.currentPromptPreview}` : "",
    input.selectedSkillTitles?.length ? `\n【当前已选 Skill】\n${input.selectedSkillTitles.join("、")}` : "",
    input.categories?.length ? `\n【可选分类】\n${input.categories.map((category) => `- ${category.name} (${category.id})`).join("\n")}` : "",
    "",
    "【Skill 候选库】",
    skillLines,
    "",
    "【推荐要求】",
    "1. 只能从【Skill 候选库】里选择，skillId 必须完全匹配候选 ID。",
    "2. recommended 给出最建议启用的 Skill，通常 3-6 个。",
    "3. optional 给出可选 Skill，适合当前任务但不是必须。",
    "4. notRecommended 给出当前任务下不建议启用的 Skill，并说明原因。",
    "5. 推荐理由必须结合当前任务，不要只复述 Skill 标题。",
    "6. 根据任务所在模块判断技能是否相关；涉及故事结构或节奏时，再结合作品形态、集数/段落数和时长。",
    "7. 只推荐对当前工作有用的要求，例如资产设计不套用剧本结构规则；跨类型借用时说明原因。",
    "8. 不要输出任何生成内容，不要替作者执行正式创作。",
    "9. 可以跨类型合理借用 Skill，但必须说明为什么适合当前任务，不能机械套用。",
    "",
    "【输出格式规范】",
    "输出严格 JSON，不要 Markdown，不要解释。内容使用简体中文。",
    "",
    "JSON 结构：",
    "{\"recommended\":[{\"skillId\":\"\",\"title\":\"\",\"reason\":\"\",\"suggestedUse\":\"\",\"confidence\":0}],\"optional\":[{\"skillId\":\"\",\"title\":\"\",\"reason\":\"\",\"suggestedUse\":\"\",\"confidence\":0}],\"notRecommended\":[{\"skillId\":\"\",\"title\":\"\",\"reason\":\"\"}]}",
  ].join("\n");
};
