export const getProjectTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    'single-work': '单部作品（内容类型、时长与结构以作者设定为准）',
    'series-work': '系列作品（各集可独立或连续，数量与时长以作者设定为准）',
    'movie': '电影 (100分钟级别)',
    'tv-series': '常规电视剧/网剧 (多集)',
    'short-drama': '短剧（集数、单集时长和横竖画幅以当前项目实际数据为准）',
    'micro-short-drama': '单集微短剧 (5-20分钟单一视频)'
  };
  return labels[type] || type;
};

export const getDefaultCharacterCount = (type: string, durationMinutes?: number) => {
  if (type === 'micro-short-drama') {
    const mins = durationMinutes || 10;
    if (mins <= 5) {
      return { leads: 2, supporting: 3, extras: 1 };
    } else {
      return { leads: 3, supporting: 5, extras: 4 };
    }
  } else if (type === 'short-drama' || type === 'tv-series') {
    return { leads: 5, supporting: 15, extras: 10 };
  } else if (type === 'movie') {
    return { leads: 4, supporting: 10, extras: 6 };
  }
  return { leads: 4, supporting: 10, extras: 6 }; // Default fallback
};

export const getProjectStage = (project: any): number => {
  if (!project) return 1;
  // Stage 1: Basic concept
  if (!project.logline || !project.coreConflict) return 1;
  // Stage 2: World building rules and Vision
  if (!project.creativeVision || !project.worldBuildingRules || project.worldBuildingRules.length === 0) return 2;
  // Stage 3: Characters
  if (!project.characters || project.characters.length === 0) return 3;
  // Stage 4: Episodes
  if (!project.episodes || project.episodes.length === 0) return 4;
  // Stage 5: Script (at least one scene with blocks)
  const sceneHasScriptBlocks = (scene: any) =>
    (Array.isArray(scene.scriptBlocks) && scene.scriptBlocks.length > 0) ||
    (Array.isArray(scene.blocks) && scene.blocks.length > 0);
  const hasScript = project.episodes.some((ep: any) =>
    ep.scenes && ep.scenes.some(sceneHasScriptBlocks)
  ) || (project.scenes && project.scenes.some(sceneHasScriptBlocks)); // fallback for old schema
  
  if (!hasScript) return 5;
  
  // Stage 7: Full production (Studio/Storyboard unlocked)
  return 7;
};

export const formatPromptValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^(?:无|暂无|未知|未设置|待补全|none|null|n\/a|-)[。.!！]?$/i.test(normalized)) return '';
    return normalized;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatPromptValue).filter(Boolean).join('；');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const formatted = formatPromptValue(entry);
        return formatted ? `${key}：${formatted}` : '';
      })
      .filter(Boolean)
      .join('；');
  }
  return String(value).trim();
};

export const formatVisualCreativeVision = (vision: any): string => {
  if (!vision) return '';
  const lines = [
    formatPromptValue(vision.visualStyle) ? `- 视觉风格：${formatPromptValue(vision.visualStyle)}` : '',
  ].filter(Boolean);

  const baseTexture = formatPromptValue(vision.globalLook?.baseTexture);
  const colorGrading = formatPromptValue(vision.globalLook?.colorGrading);
  const conditionalEffects = (vision.globalLook?.conditionalEffects || [])
    .map((effect: any) => {
      const tag = formatPromptValue(effect?.tag);
      const condition = formatPromptValue(effect?.condition);
      return tag ? `${tag}${condition ? `（仅当${condition}）` : ''}` : '';
    })
    .filter(Boolean)
    .join('；');
  const legacyLook = formatPromptValue(vision.globalLookTags);
  const lookLines = [
    baseTexture ? `  - 基础质感：${baseTexture}` : '',
    colorGrading ? `  - 色彩关系：${colorGrading}` : '',
    conditionalEffects ? `  - 条件特效：${conditionalEffects}` : '',
    !baseTexture && !colorGrading && !conditionalEffects && legacyLook
      ? `  - 视觉锚点：${legacyLook}`
      : '',
  ].filter(Boolean);
  if (lookLines.length) lines.push(`- 全局视觉锚点：\n${lookLines.join('\n')}`);

  return lines.join('\n');
};

export const formatCreativeVision = (vision: any): string => {
  if (!vision) return '';
  const line = (label: string, value: unknown) => {
    const formatted = formatPromptValue(value);
    return formatted ? `- ${label}：${formatted}` : '';
  };
  const lines = [
    line('类型', vision.genre),
    line('视觉风格', vision.visualStyle),
    line('叙事风格', vision.narrativeStyle),
    line('参考作品', vision.referenceWorks),
    line('外部目标 Want', vision.want),
    line('内在需求 Need', vision.need),
    line('失败代价 Stakes', vision.stakes),
    line('对抗力量', vision.oppositionForce),
    line('主题问题', vision.themeQuestion),
    line('主角弧线', vision.protagonistArc),
    line('情感补偿', vision.emotionalReward),
  ].filter(Boolean);
  
  if (vision.globalLook) {
    const base = vision.globalLook.baseTexture?.join(', ') || '';
    const color = vision.globalLook.colorGrading?.join(', ') || '';
    const effects = (vision.globalLook.conditionalEffects || [])
      .map((e: any) => `${e.tag} (条件: ${e.condition})`)
      .join(', ');
    
    const lookLines = [
      base ? `  - 基础质感：${base}` : '',
      color ? `  - 色彩调配：${color}` : '',
      effects ? `  - 条件特效：${effects}` : '',
    ].filter(Boolean);
    if (lookLines.length) lines.push(`- 全局视觉处理：\n${lookLines.join('\n')}`);
  } else if (vision.globalLookTags) {
    lines.push(`- 全局视觉处理：${vision.globalLookTags}`);
  }

  return lines.join('\n');
};
