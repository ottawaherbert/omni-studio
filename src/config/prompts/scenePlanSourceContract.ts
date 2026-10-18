export const scenePlanSourceContract = 'sourceEvidence 是采用后保存为本场剧本的完整原文，不是举例、摘要或几句证据。请把“当前来源完整剧本”按场次分成首尾相接的连续原文块，每块逐字全文放入对应 sourceEvidence，包含本场场头、动作、对白、括注和转场；第一块从来源开头开始，最后一块到来源末尾结束。来源中的标题、说明及场间文字也须按原顺序归入相邻场次，不得跳过。除场次边界处的空白外，各块按顺序拼接必须完整还原来源，不得遗漏、重复、改写或用省略号替代。description 和 purpose 可以概括，sourceEvidence 不可以。输出前逐段核对覆盖；内容较长也不能缩成摘录。';

/** Upgrade only the former built-in wording, retaining all other author edits. */
export const upgradeScenePlanSourceContract = (template: string): string => template
  .replace('每个候选场次必须给出准确的原文依据，所有场次按原文顺序完整覆盖来源，不得遗漏或重复任何正文。sourceEvidence 必须是从当前来源完整剧本中逐字摘取、足够支撑后续拆解的连续片段；不要用概述代替原文，不要捏造原文没有的剧情。', scenePlanSourceContract)
  .replace('所有场次按原文顺序完整覆盖来源，不得遗漏、重复或改写；每个候选场次必须保留足够支撑后续场次拆解的 sourceEvidence 连续原文片段。', scenePlanSourceContract)
  .replace('"sourceEvidence": "从当前来源剧本摘取的原文片段"', '"sourceEvidence": "本场完整连续原文，逐字保留场头、动作、对白、括注和转场，不得仅摘录几句"');
