import { PromptTemplate } from './types';

export const refineTemplates: Record<string, PromptTemplate> = {
  'compressGoldenRules': {
    id: 'compressGoldenRules',
    name: '精简：提取三大铁律',
    template: `【任务目标】
请仔细阅读下方的《世界观/设定规则》。
使用极度冷峻、凝练的语言，将其压缩为最高权重的“三大铁律（Golden Rules）”。
这些铁律将作为剧本大模型的强约束条件。

【原始规则内容】
{{rulesContent}}

【要求】
1. 必须结构化、压缩化，抛弃冗长的修饰语。
2. 每条铁律不能超过15个字。
3. 如果原文中有情感补偿的“意难平”或反转机制，必须被提炼在铁律中。
4. 返回纯文本内容，按序号排列。`
  },
  'purifyVisualActions': {
    id: 'purifyVisualActions',
    name: '提纯：剥离动作片段',
    template: `【任务目标】
请对下方的剧本段落进行“视觉信息提纯”。
剔除所有大段的心理活动描写、冗长解释、动机分析，仅仅提取可以直接在画面上呈现的【视觉动作、表情、交互】。

【待提纯片段】
{{scriptContent}}

【要求】
1. 纯客观视角，像监控探头一样描述画面。
2. 用极简短句，例如：“男主抬头。眼神冷漠。转身走向门。”
3. 必须绝对抛弃对画面生成无用的动机描述。
4. 直接返回提纯后的动作文本。`
  }
};
