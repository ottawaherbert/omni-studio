import { CONVERSATION_CONTRACT } from './conversation';

export const SCRIPT_TASK_CONTRACTS = {
  text_rewrite: '仅改写 selectedText 指定的原文范围，不输出未选中的上下文。保留剧本格式（对白使用姓名独占一行，下一行写对白）。JSON: {"summary":"修改理由","replacement":"替换选中文字"}。',
  consult: CONVERSATION_CONTRACT,
  concept: '提供可选的故事前提表达，尊重已有方向，不强制危机或反派。JSON: {"summary":"建议依据","suggestions":[{"title":"方案名","content":"故事前提"}]}。1–5 个方案，只替换前提字段。',
  theme: '提供可选的主题或主要问题表达，允许日常处境等张力，不强迫残酷抉择。JSON: {"summary":"建议依据","suggestions":[{"title":"方案名","content":"主题或问题"}]}。1–5 个方案，只替换对应字段。',
  character: '提出可选的新人物，不修改已有人物，不强制创伤与变化。JSON: {"summary":"建议依据","suggestions":[{"title":"方案名","name":"姓名","content":"人物在故事里的作用","voice":"说话方式，可留空","desire":"目标，可留空","need":"内在需要，可留空"}]}。1–5 个方案，采用一个后新增到 writeScopeId 指定范围。',
  fact: '提出环境、关系或规则建议，不把推测当作作者已确认事实。JSON: {"summary":"建议依据","suggestions":[{"title":"方案名","content":"具体设定"}]}。1–5 个方案，采用后新增为 writeScopeId 指定范围的待确认草稿。',
  scene: '只改写指定目标场景的正文，返回完整替换稿。JSON: {"summary":"修改理由与待确认项","blocks":[{"type":"action","text":"可见可听的动作"},{"type":"dialogue","speakerId":"既有人物 ID","text":"对白"}]}。块类型可用 action/dialogue/parenthetical/transition/note；已有角色用 speakerId，新角色只用 speakerName 写姓名并留待作者登记，不要输出块 ID。',
  rewrite: '只替换 selectedBlockIds 指定的连续正文块，其他块仅供上下文参考，不可返回或改写。JSON: {"summary":"局部修改理由","blocks":[{"type":"action","text":"替换选中范围的正文"}]}。块类型可用 action/dialogue/parenthetical/transition/note；已有角色用 speakerId，新角色只用 speakerName 写姓名并留待作者登记，不输出块 ID。',
  outline: '依据作者要求及本次所选 Skill，提出全剧大纲替换稿，沿用既有人物与已确认设定。讲清具体事件、人物选择、前后因果和结局或阶段落点，不重复蓝图设定；单元剧可写共同故事方向，不强求全剧结局线。不要强制套用未选择的结构框架。JSON: {"summary":"修改理由与待确认项","outline":"完整大纲文本"}。',
  unit_outline: '只提出当前单元的大纲替换稿，说明本集起点、事件推进、人物选择及阶段落点；允许只规划本集，不要求其他集完成。不改故事总纲、结尾安排和正文。JSON: {"summary":"修改理由与待确认项","outline":"本单元完整大纲"}。',
  unit_outlines: '按计划单元数提出各单元大纲，保留已填写大纲，采用时仅填入空白。不要强制高潮、反转、悬念或固定结构。JSON: {"summary":"拆分理由与待确认项","units":[{"unitIndex":1,"title":"单元标题","summary":"本单元发生的事件"}]}。不能包含场景或结尾字段。',
  plan: '根据本单元大纲和已有场景，提出需要补充的分场。采用后只增加这些新场；不会改写、删除或重新排序任何已有内容。不要重复已有场景。按呈现顺序安排可展开为正文的具体事件，交代人物、信息或情绪推进；节拍融入场景，不另写重复节拍稿，不要求每场反转。JSON: {"summary":"规划理由与待确认项","scenePlans":[{"title":"场景标题","purpose":"这一场发生什么","location":"地点，可留空","timeOfDay":"时间，可留空"}]}。最多 30 场。',
  board_plan: '根据全剧大纲提出各单元分场；只填入空白单元，保留已有内容。JSON: {"summary":"规划理由","units":[{"unitIndex":1,"title":"标题","summary":"剧情摘要","scenes":[{"title":"场景","purpose":"这一场发生什么"}]}]}。',
  ending: '提出可选的本单元结尾安排。JSON: {"summary":"建议依据","choices":[{"title":"方案","content":"具体结尾事件"}]}。',
  scene_turn: '提出可选的本场推进方向，不改正文。JSON: {"summary":"建议依据","choices":[{"title":"方案","content":"本场具体事件","extra":{"purpose":"发生什么","entryState":"可选入场状态","exitState":"可选结束变化"}}]}。',
  review: '依据作者要求及本次所选 Skill 审阅当前场。其他场的分场信息只作衔接背景，不声称检查了未读取的正文。问题必须引用目标场景 ID，给出原文依据、不确定性与建议；无问题可填空数组。只读审阅，不打总分、不宣称创作质量通过。JSON: {"summary":"本场观察","findings":[{"sceneId":"目标场景 ID","issue":"原文依据与问题","suggestion":"修改建议"}]}。',
};
