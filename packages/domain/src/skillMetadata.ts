import type { SkillDTO } from './skill';

export const SKILL_PURPOSE_LABELS: Record<string, string> = { structure: '结构', technique: '技法', genre: '题材', character: '人物', style: '风格', other: '其他' };
export const SKILL_TASK_LABELS: Record<string, string> = { writing: '剧本写作', planning: '分镜规划', assets: '资产设计', image: '图片生成', video: '视频生成', interactive: '互动设计', analysis: '拉片分析' };
export const SKILL_FORMAT_LABELS: Record<string, string> = { 'single-work': '单部作品', 'series-work': '系列作品', movie: '电影', 'tv-series': '电视剧', 'short-drama': '短剧', 'micro-short-drama': '微短剧' };
export interface SkillApplicability { tasks?: string[]; projectFormats?: string[]; note?: string }

/** Optional catalog metadata gives advice only; it never selects or removes an author's Skill. */
export function skillApplicabilityHint(skill: Pick<SkillDTO, 'applicability'>, task: { task?: string; projectFormat?: string }): string {
  const scope = skill.applicability;
  if (!scope || (!scope.tasks?.length && !scope.projectFormats?.length)) return scope?.note || '未标注适用范围';
  const mismatch = [
    task.task && scope.tasks?.length && !scope.tasks.includes(task.task) ? `标注任务为${scope.tasks.map(value => SKILL_TASK_LABELS[value] || value).join('、')}` : '',
    task.projectFormat && scope.projectFormats?.length && !scope.projectFormats.includes(task.projectFormat) ? `标注作品形态为${scope.projectFormats.map(value => SKILL_FORMAT_LABELS[value] || value).join('、')}` : '',
  ].filter(Boolean);
  const unverified = [!task.task && scope.tasks?.length ? `标注任务为${scope.tasks.map(value => SKILL_TASK_LABELS[value] || value).join('、')}` : '', !task.projectFormat && scope.projectFormats?.length ? `标注作品形态为${scope.projectFormats.map(value => SKILL_FORMAT_LABELS[value] || value).join('、')}` : ''].filter(Boolean);
  return [...(mismatch.length ? mismatch : unverified.length ? unverified : ['适用于当前已知任务范围']), scope.note].filter(Boolean).join('；');
}

export function validateSkillMetadata(skill: Pick<SkillDTO, 'purposes' | 'applicability'>): void {
  const strings = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(entry => typeof entry === 'string' && entry.length <= 200);
  if (skill.purposes !== undefined && !strings(skill.purposes)) throw new Error('Skill 用途需要为文字列表');
  if (skill.applicability !== undefined) {
    const value = skill.applicability;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Skill 适用范围格式不正确');
    for (const key of ['tasks', 'projectFormats'] as const) if (value[key] !== undefined && !strings(value[key])) throw new Error('Skill 适用范围需要为文字列表');
    if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 4000)) throw new Error('Skill 适用说明过长或格式不正确');
  }
}

/** Explicit template/stage contracts only; never infer from a Skill title or body. */
export function skillTaskForPrompt(templateId: string, stage?: string): string | undefined {
  const templates: Record<string, string> = { generateImage: 'image', generateVideo: 'video', generateShots: 'planning', generateImagePrompts: 'planning', generateVideoPrompts: 'planning', scriptChat: 'writing', scriptAssist: 'writing', scriptIdeation: 'writing', interactiveVisualRefinement: 'interactive' };
  const stages: Record<string, string> = { storyboard: 'planning', asset_sync: 'assets', asset_detail: 'assets', production_breakdown: 'planning', script: 'writing', scene: 'writing', structure: 'writing', concept: 'writing', bible: 'writing', intake: 'writing', interactive_bible: 'interactive', game_blueprint: 'interactive', graph_generation: 'interactive', interactive_script: 'interactive', interactive_storyboard: 'interactive' };
  return templates[templateId] || (stage ? stages[stage] : undefined);
}
