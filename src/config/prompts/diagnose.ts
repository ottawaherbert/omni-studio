import { PromptTemplate } from './types';

export const diagnoseTemplates: Record<string, PromptTemplate> = {
  'doctorDiagnose': {
    id: 'doctorDiagnose',
    name: '剧本医生诊断',
    template: `【角色设定】
你是剧本医生（Script Doctor）。请根据项目题材和节奏需求推荐可执行的节拍模板。

{{inspirationContext}}

【任务目标】
请为当前段落/剧集量身定制一个最合适的“微观场景节拍模板”。

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

【其他段落/剧集上下文】
{{otherEpisodesContext}}

【当前需要设计模板的段落/剧集】
所属类型: {{projectTypeName}}
目标时长: {{targetDuration}}
标题: {{episodeTitle}}
梗概: {{episodeInspiration}}

【任务要求】
1. 先给出可审计的诊断摘要：当前段落在整个故事中的定位、承接任务、待解决问题和情绪起伏。不要输出内部思维过程。
2. 基于你的分析，不要局限于固定的传统模板，灵活地为这个特定的段落设计一个专属的节拍模板。
3. 模板必须全面且具体，指导后续的 AI 如何一步步拆解出具体的场景。

请返回一个 JSON 对象，包含：
1. diagnosis: 剧本医生的可审计诊断摘要（约200字，说明设计该节拍结构的关键依据）。
2. name: 专属模板名称（例如："《xxx》高潮前夕的宁静与爆发"）。
3. description: 简短描述这个模板的特点。
4. instruction: 给后续 AI 的详细指令，说明如何按照这个结构来拆解场景。必须列出该结构的所有关键节拍/阶段。`
  },
  'diagnoseSelectedTemplate': {
    id: 'diagnoseSelectedTemplate',
    name: '诊断所选模板',
    template: `【角色设定】
你是剧本医生（Script Doctor）。请评估候选模板的优劣及其与当前故事语境的适配度。

{{inspirationContext}}

【任务目标】
请对用户当前选择的节拍模板进行诊断，并根据当前段落/剧集的上下文，对其进行优化和定制。

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

【其他段落/剧集上下文】
{{otherEpisodesContext}}

【当前需要设计模板的段落/剧集】
所属类型: {{projectTypeName}}
目标时长: {{targetDuration}}
标题: {{episodeTitle}}
梗概: {{episodeInspiration}}

【当前选择的模板】
名称: {{templateName}}
描述: {{templateDescription}}
指令: {{templateInstruction}}

【任务要求】
1. 先给出可审计的适配摘要：当前模板是否适合该段落/剧集、哪里需要加强、哪里可以精简。不要输出内部思维过程。
2. 基于你的分析，对原模板进行优化和定制，使其成为当前段落/剧集的“专属完美模板”。
3. 优化后的模板必须全面且具体，指导后续的 AI 如何一步步拆解出具体的场景。

请返回一个 JSON 对象，包含：
1. diagnosis: 剧本医生的可审计诊断摘要（约200字，说明对原模板的判断与修改依据）。
2. name: 优化后的模板名称（例如："定制版：[原模板名]"）。
3. description: 简短描述优化后模板的特点。
4. instruction: 给后续 AI 的详细指令，说明如何按照这个优化后的结构来拆解场景。必须列出该结构的所有关键节拍/阶段。`
  },
  'diagnoseStructure': {
    id: 'diagnoseStructure',
    name: '诊断当前结构',
    template: `【角色设定】
你是剧本结构分析师。请识别叙事结构与故事内核之间的契合点和错位。

{{inspirationContext}}

【任务目标】
请阅读以下【项目圣经】与【创作视点】，并对用户选择的叙事结构进行诊断。

项目类型：{{projectType}}

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

【当前创作进度】
{{existingProgress}}

用户选择的组合是：【骨架：{{selectedSkeleton}}】 + 【节拍：{{selectedBeats}}】。

请综合上述信息（特别是【当前创作进度】所处的阶段），严格针对【用户选择的这个组合】在【{{projectType}}】类型下的适用性进行打分和优劣势分析：如果进度较深，应当着重评估该节拍组合能否稳定推动后续情绪，而不只是开局建置。
绝对不要分析其他未选择的结构。请严格按照以下 JSON 格式返回结果；reasoning 只写简短、可审计的评价依据，不要输出内部思维过程：
{
  "reasoning": "针对该组合的整体评价依据（约50字）",
  "matchScore": 85,
  "pros": ["优势1：...", "优势2：..."],
  "cons": ["劣势1（风险点）：...", "劣势2：..."]
}`
  },
  'diagnoseLogline': {
    id: 'diagnoseLogline',
    name: '诊断 - 剧本基础属性验证',
    template: `你是剧本医生与内容策划。请评估以下【项目一句话故事 (Logline)】或【核心创意】的专业质感（非大白话）。

{{projectContext}}

【创作者的具体想法/修改要求】
{{userIntent}}

正向案例 (Positive)：
- "在核战后的废土世界，一名失去女儿的退役老兵必须穿越辐射区，将免疫抗体送到反抗军基地，同时还要面对内心深处的创伤与背叛。" (有明确的主告、动力、阻力、高概念)
反面案例 (Negative)：
- "一个男的要去打败魔王。" (大白话，无细节，无内核)
- "两个人在学校里谈恋爱发生了很多事。" (流水账，无冲突)

请根据下列标准进行评估：
1. 是否有明确的驱动力 (Want/Need)？
2. 是否有明显的阻力/反面力量 (Antagonist/Conflict)？
3. 是否显得单薄、像大白话、缺乏高概念、职业质感或{{visualTerm}}？

【当前内容】：
{{logline}}

如果你认为处于“反面案例”的水平或有显著缺陷，请在诊断结果中指出。
请返回 JSON 格式：
{
  "score": "评分 (1-100)",
  "level": "绝佳 | 标准 | 平庸 (大白话)",
  "issues": ["如果存在缺陷，列出具体问题"],
  "compliments": ["如果写得好，列出优点"],
  "summary": "一句简短的总结评价"
}`
  },
  'diagnoseScript': {
    id: 'diagnoseScript',
    name: '法官洞察批注（剧本维度）',
    template: `{{stylePrompt}}

【任务目标】
请作为“法官洞察系统”，深度扫描以下剧本内容，找出其中的“痛点/降智/割裂”等问题。
不要只是泛泛而谈，必须找出【原文引用】的 exactQuote 作为高亮锚点。

【剧本内容】
{{scriptContent}}

如果存在问题，请给出改进建议。
`
  }
};
