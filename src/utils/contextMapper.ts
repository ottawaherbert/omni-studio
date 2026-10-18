import { Project } from "../types/project";
import { formatCreativeVision, formatVisualCreativeVision } from "./projectUtils";
import { collectProjectAssetsForContext } from "./projectAssetContext";
import {
  buildLongFormMemoryContext,
  LongFormMemoryTaskProfile,
  renderLongFormMemoryForPrompt,
} from "../services/production/longFormMemory";
import { projectUniversalSkillRefs } from "./universalSkillRefs";

export const CONTEXT_DEPENDENCIES: Record<string, { label: string; usedIn: string[] }> = {
  inspiration: {
    label: "初始灵感与核心视角",
    usedIn: [
      "generateEpisodes", "regenerateEpisode", "generateScenes", "expandScene",
      "generateScript", "regenerateLogline", "regenerateConflict", "generateCharacters",
      "regenerateCharacter", "generateWorldRules", "generateAllAssets", "regenerateAsset",
    ]
  },
  logline: {
    label: "一句话故事",
    usedIn: [
      "regenerateConflict", "regenerateArc", "generateCharacters", "validateCharacters",
      "refineCharacters", "regenerateCharacter", "generateWorldRules", "generateAllAssets",
      "regenerateAsset", "generateEpisodes", "regenerateEpisode", "recommendStructure",
      "diagnoseStructure", "generateScenes", "analyzePacing", "diagnoseLogline", "enhanceLogline"
    ]
  },
  coreConflict: {
    label: "核心冲突",
    usedIn: [
      "regenerateArc", "generateCharacters", "validateCharacters", "refineCharacters",
      "regenerateCharacter", "generateWorldRules", "generateAllAssets", "regenerateAsset",
      "generateEpisodes", "regenerateEpisode", "recommendStructure", "diagnoseStructure",
      "diagnoseLogline", "enhanceLogline"
    ]
  },
  seasonArc: {
    label: "剧集主线",
    usedIn: [
      "generateEpisodes", "regenerateEpisode", "recommendStructure", "diagnoseStructure",
      "generateScenes",
    ]
  },
  creativeVision: {
    label: "创意色彩与风格",
    usedIn: [
      "regenerateLogline", "regenerateConflict", "regenerateArc", "generateCharacters", "validateCharacters", "refineCharacters",
      "regenerateCharacter", "generateWorldRules", "generateAllAssets", "regenerateAsset",
      "generateEpisodes", "regenerateEpisode", "generateScenes", "expandScene",
      "regenerateScene", "generateScript", "rewriteScriptBlock", "polishScriptText",
      "showDontTell", "purifyVisualActions", "breakdown", "analyzePacing", "generateShots",
      "generateShotSpatial", "generateImagePrompts", "generateVideoPrompts",
      "generateSpecificPrompt", "generateVideo"
    ]
  },
  worldRules: {
    label: "世界观规则",
    usedIn: [
      "regenerateArc", "regenerateCharacter", "regenerateAsset", "generateEpisodes",
      "regenerateEpisode", "generateScenes", "generateScript"
    ]
  },
  characters: {
    label: "角色档案",
    usedIn: [
      "generateWorldRules", "generateAllAssets", "regenerateAsset", "generateEpisodes",
      "regenerateEpisode", "generateScenes", "expandScene", "regenerateScene",
      "generateScript", "rewriteScriptBlock", "breakdown", "generateShots", "generateImagePrompts", "generateVideoPrompts", "generateSpecificPrompt",
      "planCharacterRoster", "generateCharacters"
    ]
  },
  assets: {
    label: "场景与道具档案",
    usedIn: [
      "generateScript", "expandScene", "breakdown", "generateShots", "generateImagePrompts", "generateVideoPrompts",
      "generateSpecificPrompt",
      "planLocationRoster", "planPropRoster", "generateLocations", "generateProps"
    ]
  },
  relationships: {
    label: "人物关系网络",
    usedIn: [
      "regenerateArc", "regenerateCharacter", "generateEpisodes", "regenerateEpisode",
      "generateScenes", "regenerateScene", "generateScript",
    ]
  },
  storyCards: {
    label: "视觉大纲白板(结构推演)",
    usedIn: ["generateEpisodes", "regenerateEpisode"]
  },
  longFormMemory: {
    label: "长篇多集记忆（分段压缩）",
    usedIn: [
      "generateEpisodes", "regenerateEpisode", "generateScenes", "expandScene",
      "regenerateScene", "generateScript", "rewriteScriptBlock", "polishScriptText",
      "showDontTell", "purifyVisualActions", "breakdown", "generateShots",
      "generateImagePrompts", "generateVideoPrompts", "generateSpecificPrompt", "generateInteractiveEpisodes"
    ]
  }
};

export const TASK_LABELS: Record<string, string> = {
  generateEpisodes: "大纲推演",
  regenerateEpisode: "衍生单集",
  generateScenes: "场景拆解",
  expandScene: "场景扩写",
  regenerateScene: "场景重做",
  generateScript: "剧本智能生成",
  regenerateLogline: "标语重写",
  regenerateConflict: "冲突提炼",
  regenerateArc: "人物弧光重写",
  generateCharacters: "角色体系构建",
  validateCharacters: "角色校验",
  refineCharacters: "角色提纯",
  regenerateCharacter: "精调单一角色",
  generateWorldRules: "世界观设定",
  generateAllAssets: "资产衍生",
  regenerateAsset: "重写特定资产",
  recommendStructure: "叙事结构推荐",
  diagnoseStructure: "结构诊断",
  analyzePacing: "节奏监测分析",
  diagnoseLogline: "诊断故事概念",
  enhanceLogline: "润色故事概念",
  rewriteScriptBlock: "桥段重构",
  polishScriptText: "台词润色",
  showDontTell: "反解释性转换",
  purifyVisualActions: "提纯视觉动作",
  breakdown: "视听拆解提取",
  generateShots: "镜头智能分镜",
  generateShotSpatial: "空间动线规划",
  generateImagePrompts: "分镜图片提示词",
  generateVideoPrompts: "分镜视频提示词",
  generateSpecificPrompt: "高级提示词微调",
  generate_episodes: "大纲推演",
  generate_script: "剧本生成",
  generate_pitch: "项目提案",
  generate_visuals: "视觉生成",
  generate_bible: "设定扩写",
  generate_whiteboard: "全局白板推演",
  generate_breakdown: "剧本拆解与服化道拆解"
};

const LONG_FORM_TASK_PROFILE: Record<string, LongFormMemoryTaskProfile> = {
  generateEpisodes: "outline",
  generateInteractiveEpisodes: "outline",
  regenerateEpisode: "episode",
  generateScenes: "scene",
  expandScene: "scene",
  regenerateScene: "scene",
  generateScript: "script",
  rewriteScriptBlock: "script",
  polishScriptText: "script",
  showDontTell: "script",
  purifyVisualActions: "script",
  breakdown: "script",
  generateShots: "storyboard",
  generateImagePrompts: "visual_prompt",
  generateVideoPrompts: "visual_prompt",
  generateSpecificPrompt: "visual_prompt",
};

export interface ContextScope {
  /**
   * The workflow-owned episode window. Callers with an explicit episode selection
   * must pass it instead of relying on the project's last globally active episode.
   */
  episodeIds?: string[];
  /**
   * Entity ids already proven relevant by the workflow-owned source. All entity
   * options remain visible for author opt-in; only these ids are selected by
   * default when restrictEntityDefaults is enabled.
   */
  characterIds?: string[];
  assetIds?: string[];
  restrictEntityDefaults?: boolean;
}

const resolveLongFormEpisodeIds = (project: Project, taskId: string, scope?: ContextScope) => {
  const scopedEpisodeIds = scope?.episodeIds?.filter(Boolean);
  if (scopedEpisodeIds?.length) return scopedEpisodeIds;
  const activeEpisodeId = (project as any).activeEpisodeId;
  if (activeEpisodeId && ["regenerateEpisode", "generateScenes", "generateScript", "generateShots", "generateImagePrompts", "generateVideoPrompts"].includes(taskId)) {
    return [activeEpisodeId];
  }
  return undefined;
};

export function gatherContextOptions(project: Project, taskId: string, scope?: ContextScope) {
  const options = [];
  const defaultIds = [];
  const visualTask = [
    "generateShots",
    "generateShotSpatial",
    "generateImagePrompts",
    "generateVideoPrompts",
    "generateSpecificPrompt",
    "generateVideo",
    "generateAllAssets",
    "generateLocations",
    "generateProps",
    "regenerateAsset",
    "planLocationRoster",
    "planPropRoster",
  ].includes(taskId);
  const hasDedicatedCreativeVision = ["generateShots", "generateImagePrompts", "generateSpecificPrompt"].includes(taskId);
  const hasDedicatedAssetContext = ["generateShots", "generateImagePrompts", "generateVideoPrompts"].includes(taskId);
  const scopedCharacterIds = new Set(scope?.characterIds || []);
  const scopedAssetIds = new Set(scope?.assetIds || []);

  const longFormContext = buildLongFormMemoryContext(project, {
    episodeIds: resolveLongFormEpisodeIds(project, taskId, scope),
    profile: LONG_FORM_TASK_PROFILE[taskId] || "default",
  });
  const longFormPrompt = renderLongFormMemoryForPrompt(longFormContext);
  if (longFormPrompt) {
    const id = "ctx_longFormMemory";
    options.push({
      id,
      label: CONTEXT_DEPENDENCIES.longFormMemory.label,
      value: longFormPrompt,
    });
    if (CONTEXT_DEPENDENCIES.longFormMemory.usedIn.includes(taskId) && !visualTask) defaultIds.push(id);
  }

  // Inspiration (Original and Refined)
  if (project.originalInspiration || project.refinedInspiration) {
    const id = "ctx_inspiration";
    const content = [];
    if (project.originalInspiration) content.push(`【初始创意灵感】\n${project.originalInspiration}`);
    if (project.refinedInspiration) content.push(`【AI精炼核心视角】\n${project.refinedInspiration}`);
    
    options.push({ 
      id, 
      label: CONTEXT_DEPENDENCIES.inspiration.label, 
      value: `<inspiration>\n${content.join('\n\n')}\n</inspiration>` 
    });
    if (CONTEXT_DEPENDENCIES.inspiration.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Logline
  if (project.logline) {
    const id = "ctx_logline";
    options.push({ id, label: CONTEXT_DEPENDENCIES.logline.label, value: `<logline>\n${project.logline}\n</logline>` });
    if (CONTEXT_DEPENDENCIES.logline.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Core Conflict
  if (project.coreConflict) {
    const id = "ctx_coreConflict";
    options.push({ id, label: CONTEXT_DEPENDENCIES.coreConflict.label, value: `<core_conflict>\n${project.coreConflict}\n</core_conflict>` });
    if (CONTEXT_DEPENDENCIES.coreConflict.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Season Arc
  if (project.seasonArc) {
    const id = "ctx_seasonArc";
    options.push({ id, label: CONTEXT_DEPENDENCIES.seasonArc.label, value: `<season_arc>\n${project.seasonArc}\n</season_arc>` });
    if (CONTEXT_DEPENDENCIES.seasonArc.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Creative Vision
  if (project.creativeVision) {
    const id = "ctx_creativeVision";
    const creativeVision = visualTask
      ? formatVisualCreativeVision(project.creativeVision)
      : formatCreativeVision(project.creativeVision);
    if (creativeVision) {
      options.push({ id, label: CONTEXT_DEPENDENCIES.creativeVision.label, value: `<creative_vision>\n${creativeVision}\n</creative_vision>` });
    }
    if (creativeVision && CONTEXT_DEPENDENCIES.creativeVision.usedIn.includes(taskId) && !hasDedicatedCreativeVision) defaultIds.push(id);
  }

  // World Rules
  if (project.worldBuildingRules && project.worldBuildingRules.length > 0) {
    const rulesStr = project.worldBuildingRules.map((r: any) => `- ${r.category}: ${r.content}`).join('\n');
    const id = "ctx_worldRules";
    options.push({ id, label: CONTEXT_DEPENDENCIES.worldRules.label, value: `<world_rules>\n${rulesStr}\n</world_rules>` });
    if (CONTEXT_DEPENDENCIES.worldRules.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Characters
  if (project.characters && project.characters.length > 0) {
    project.characters.forEach((char: any) => {
      const id = `ctx_char_${char.id}`;
      const characterLines = (visualTask ? [
        char.visualIdentity && `可见身份锚点: ${char.visualIdentity}`,
        char.visualAge && `视觉年龄: ${char.visualAge}`,
        char.keyVisualFeature && `视觉锚点: ${char.keyVisualFeature}`,
        char.actingStyle && `可观察表演方式: ${char.actingStyle}`,
        char.vocalQuirk && `说话特征: ${char.vocalQuirk}`,
      ] : [
        char.visualIdentity && `可见身份锚点: ${char.visualIdentity}`,
        char.psychologicalProfile && `心理侧写: ${char.psychologicalProfile}`,
        [char.mbti, char.enneagram].filter(Boolean).length
          ? `性格类型: ${[char.mbti, char.enneagram].filter(Boolean).join(" | ")}`
          : "",
        char.actingStyle && `表演流派/气质预设: ${char.actingStyle}`,
        char.sliders && Object.keys(char.sliders).length ? `情绪滑块: ${JSON.stringify(char.sliders)}` : "",
        char.visualAge && `视觉年龄: ${char.visualAge}`,
        char.keyVisualFeature && `视觉锚点: ${char.keyVisualFeature}`,
        char.vocalQuirk && `说话怪癖: ${char.vocalQuirk}`,
        char.internalDesire && `内在渴望: ${char.internalDesire}`,
        char.externalGoal && `外在目标: ${char.externalGoal}`,
        char.flaw && `致命弱点: ${char.flaw}`,
      ]).filter(Boolean).join("\n");
      options.push({ 
        id, 
        label: `角色档案: ${char.name}`, 
        value: `<character name="${char.name}">\n${characterLines}\n</character>`
      });
      if (
        CONTEXT_DEPENDENCIES.characters.usedIn.includes(taskId)
        && !hasDedicatedAssetContext
        && (!scope?.restrictEntityDefaults || scopedCharacterIds.has(char.id))
      ) defaultIds.push(id);
    });
  }

  // Assets (Locations, Props)
  const contextAssets = collectProjectAssetsForContext(project);
  if (contextAssets.length > 0) {
    contextAssets.forEach((asset: any) => {
      const id = `ctx_asset_${asset.id}`;
      const typeLabel = asset.type === 'location' ? '场景' : '道具';
      const descriptionLine = asset.description ? `\n描述: ${asset.description}` : "";
      options.push({ 
        id, 
        label: `${typeLabel}: ${asset.name}`, 
        value: `<asset type="${asset.type}" name="${asset.name}">${descriptionLine}\n</asset>`
      });
      if (
        CONTEXT_DEPENDENCIES.assets.usedIn.includes(taskId)
        && !hasDedicatedAssetContext
        && (!scope?.restrictEntityDefaults || scopedAssetIds.has(asset.id))
      ) defaultIds.push(id);
    });
  }

  // Relationships
  if (project.relationships && project.relationships.length > 0) {
    const relsStr = project.relationships.map((r: any) => {
      const sourceChar = project.characters?.find((c: any) => c.id === r.sourceId);
      const targetChar = project.characters?.find((c: any) => c.id === r.targetId);
      if (!sourceChar?.name || !targetChar?.name) return "";
      const dynamicsStr = r.dynamics && Object.keys(r.dynamics).length > 0 ? ` [动态维度: ${JSON.stringify(r.dynamics)}]` : '';
      return `- ${sourceChar.name} -> ${targetChar.name}: [${r.type}] ${r.description}${dynamicsStr}`;
    }).filter(Boolean).join('\n');
    if (relsStr) {
      const id = "ctx_relationships";
      options.push({ id, label: CONTEXT_DEPENDENCIES.relationships.label, value: `<relationships>\n${relsStr}\n</relationships>` });
      if (CONTEXT_DEPENDENCIES.relationships.usedIn.includes(taskId)) defaultIds.push(id);
    }
  }

  // Story Cards (Whiteboard)
  if (project.storyCards && project.storyCards.length > 0) {
    let cardsText = "";
    [1, 2, 3].forEach(act => {
      const actCards = project.storyCards?.filter((c: any) => c.act === act);
      if (actCards && actCards.length > 0) {
        cardsText += `第 ${act} 幕:\n` + actCards.map((c: any) => `- [${c.type}] ${c.title}: ${c.content}`).join('\n') + '\n\n';
      }
    });

    const id = "ctx_storyCards";
    options.push({ id, label: CONTEXT_DEPENDENCIES.storyCards.label, value: `<whiteboard_structure>\n${cardsText.trim()}\n</whiteboard_structure>` });
    if (CONTEXT_DEPENDENCIES.storyCards.usedIn.includes(taskId)) defaultIds.push(id);
  }

  // Extracted DNAs (Shadow Reference Mapping)
  if (project.extractedDNAs && project.extractedDNAs.length > 0) {
    project.extractedDNAs.forEach((dna: any) => {
      const id = `ctx_dna_${dna.id}`;
      // Just stringify the beats or the whole dna depending on what's available
      const dnaStr = JSON.stringify(dna.beats || dna, null, 2);
      options.push({ 
        id, 
        label: `拉片节奏参照系: ${dna.sourceVideoName || '未命名'}`, 
        value: `<shadow_reference_template name="${dna.sourceVideoName || '未命名'}">
【隔离保护声明】
只使用上述 JSON 中的情绪波动、冲突机制和节奏要求，绝对禁止引入任何原有台词、原有人名或场景设定。必须使用用户当前的宇宙设定。
${dnaStr}
</shadow_reference_template>` 
      });
      // We don't default include it, let the user manually select it in the generate modal if they want to apply it
    });
  }

  return { options, defaultIds };
}

import { Scene, ScriptBlock, UniversalSkillReference } from "../types/project";

const skillTitle = (skill: UniversalSkillReference) => skill.title || "未命名 Skill";
const skillContent = (skill: UniversalSkillReference) => (skill.content || "").trim();

/**
 * 获取当前场景生效的 Skill（处理场次级覆写优先级）
 */
export function getActiveSkills(project: Project, scene?: Scene): UniversalSkillReference[] {
  if (scene?.overrideSkills && scene.overrideSkills.length > 0) {
    return scene.overrideSkills;
  }
  return projectUniversalSkillRefs(project);
}

/**
 * 1. 为【文本大脑 (Script Brain)】构建纯净上下文
 * 严格过滤所有视觉/听觉指令，只保留叙事与结构
 */
export function buildScriptContext(project: Project, scene: Scene): string {
  const universalSkillRefs = getActiveSkills(project, scene);
  
  // 提取全局纲领的三大铁律（结构化、压缩化）
  const goldenRules = project.worldBuildingRules?.map((rule: any) => `- ${rule.content}`).join('\n') || '';

  let context = [
    goldenRules ? `【全局叙事铁律 (Golden Rules)】:\n${goldenRules}` : "",
    scene?.sceneGoal || scene?.description
      ? `【本集核心目标】:\n${scene.sceneGoal || scene.description}`
      : "",
  ].filter(Boolean).join("\n\n");

  if (universalSkillRefs.length > 0) {
    universalSkillRefs.filter((skill) => skillContent(skill)).forEach((activeSkill, index) => {
      context += `
【作者选择的通用 Skill ${index + 1}: ${skillTitle(activeSkill)}】:
${skillContent(activeSkill)}
`;
    });
  }

  return context.trim();
}

/**
 * 2. 为【视觉大脑 (Visual Brain)】构建纯净上下文
 * 屏蔽剧情动机，将抽象文本强力翻译为镜头语言
 */
export function buildVisualContext(_project: Project, _scene: Scene | undefined, scriptBlock: ScriptBlock): string {
  const context = `
【当前画面动作】:
${scriptBlock.content}
`;

  return context.trim();
}

/**
 * 3. 为【法官系统 (Insight Judge)】构建校验模板
 * 强制输出 exactQuote，以支持前端 ScriptEditor 红线高亮
 */
export function getJudgeSystemPrompt(): string {
  return `你是一个无情的剧本评审系统。请审查以下剧本是否符合"情感补偿"与"不降智"的逻辑。
你必须严格输出 JSON 格式，且必须包含 exactQuote 字段，以供 UI 引擎进行精准字符串匹配高亮。

期望的 JSON 格式:
{
  "score": "A-F评分",
  "issues": [
    {
      "level": "warning" | "error",
      "type": "降智警告/爽点未成立/解释性对白过多",
      "exactQuote": "（必须是剧本中原封不动的原话片段，不超过20个字，用于精确匹配定位）",
      "suggestion": "具体的修改建议（比如：改为动作描写）"
    }
  ]
}
`;
}
