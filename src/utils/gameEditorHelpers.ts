import { renderUniversalSkillLines } from "./universalSkillText";

export const compileProjectBible = (project: any) => {
  if (!project) return '';
  let bible = '';
  
  if (project.originalInspiration) {
    bible += `【原初创意】\n${project.originalInspiration}\n\n`;
  }
  if (project.refinedInspiration) {
    bible += `【系统精炼套路与核心准则】\n${project.refinedInspiration}\n\n`;
  }

  bible += `【故事主轴】\nLogline: ${project.logline || ''}\n核心冲突: ${project.coreConflict || ''}\n\n`;
  if (project.characters && project.characters.length > 0) {
    bible += `【核心角色】\n` + project.characters.map((c: any) => `- ${c.name}: ${c.psychologicalProfile || ''} (想要: ${c.externalGoal || ''}, 缺陷: ${c.flaw || ''})`).join('\n') + `\n\n`;
  }
  if (project.relationships && project.relationships.length > 0) {
    bible += `【人物关系】\n` + project.relationships.map((r: any) => {
      const sourceChar = project.characters?.find((c: any) => c.id === r.sourceId);
      const targetChar = project.characters?.find((c: any) => c.id === r.targetId);
      const sourceName = sourceChar ? sourceChar.name : (r.sourceName || 'Unknown');
      const targetName = targetChar ? targetChar.name : (r.targetName || 'Unknown');
      return `- ${sourceName} <-> ${targetName}: ${r.type} (${r.description})`;
    }).join('\n') + `\n\n`;
  }
  if (project.worldBuildingRules && project.worldBuildingRules.length > 0) {
    bible += `【世界观法则】\n` + project.worldBuildingRules.map((b: any) => `- ${b.category || '规则'}: ${b.content}`).join('\n') + `\n\n`;
  }
  if (project.episodes && project.episodes.length > 0) {
    bible += `【已规划段落剧集 / 章回结构】\n`;
    project.episodes.forEach((ep: any, index: number) => {
      bible += `第 ${index + 1} 章: ${ep.title || '未命名'}\n大纲: ${ep.inspiration || '无摘要'}\n\n`;
      // If there are scenes (units) inside the episode, we can optionally list them too, but 
      // since scenes are kept separately in activeEpisode, or nested in full episode data
      // Let's just keep it macro.
    });
  }
  if (project.interactiveTemplate) {
    bible += `【参考游戏/体验产品】\n对标游戏: ${project.interactiveTemplate}\n\n`;
  }
  if (project.creativeVision) {
    bible += `【创意视点与基调 (Creative Vision)】\n`;
    if (project.creativeVision.genre && project.creativeVision.genre.length > 0) bible += `- 核心类型: ${project.creativeVision.genre.join(', ')}\n`;
    if (project.creativeVision.tone) bible += `- 情感基调: ${project.creativeVision.tone}\n`;
    if (project.creativeVision.visualStyle) bible += `- 视觉风格: ${project.creativeVision.visualStyle}\n`;
    if (project.creativeVision.narrativeStyle) bible += `- 叙事手法: ${project.creativeVision.narrativeStyle}\n`;
    bible += `\n`;
  }

  if (project.universalSkillRefs && project.universalSkillRefs.length > 0) {
    const skillText = renderUniversalSkillLines(project.universalSkillRefs);
    if (skillText) bible += `【作者选择的通用 Skill】\n${skillText}\n\n`;
  }

  if (project.promptModifiers?.scriptInstruction) {
    bible += `【项目全局写作偏好 / 覆盖指令】\n${project.promptModifiers.scriptInstruction}\n\n`;
  }

  return bible;
};
