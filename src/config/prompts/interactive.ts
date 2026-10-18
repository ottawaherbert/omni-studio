import { PromptTemplate } from './types';

export const interactiveTemplates: Record<string, PromptTemplate> = {
  'interactiveCreateFirstDraft': {
    id: 'interactiveCreateFirstDraft',
    name: '互动白板 - 创建第一版方案',
    template: `【任务】
为一个新的互动影视项目生成可审阅的第一版节点白板。请完成主线、关键选择、分支后果和至少两个有差异的结局，并给出作者能理解的分集（仅系列项目）和章节标题。章节属于故事结构，不能用制片批次代替；状态、条件、汇流和制片分块由 AI 自动处理，不要求作者配置技术字段。

【作品名称】
{{projectTitle}}

【故事类型】
{{genre}}

【作品规模】
{{experienceScale}}；{{targetDuration}}

【故事来源】
{{sourceSummary}}

【作者的故事构想】
{{creativeBrief}}

【作者补充要求】
{{userIntent}}

{{skills}}`,
  },
  'interactiveGraphAuthoring': {
    id: 'interactiveGraphAuthoring',
    name: '互动白板 - 调整故事结构',
    template: `【任务】
{{actionLabel}}

【当前白板】
{{graphContext}}

【当前节点】
{{selectedNodeContext}}

【需要处理的问题】
{{qaContext}}

【作者原始意见】
{{authorRequest}}

【作者补充要求】
{{userIntent}}

请返回一个可审阅的新方案，不要静默覆盖已经采用的白板。新增或调整节点必须保留其故事分集/章节归属；制片批次不作为作者章节。

{{skills}}`,
  },
  'interactiveContentPlanning': {
    id: 'interactiveContentPlanning',
    name: '互动白板 - 安排节点内容',
    template: `【任务】
检查整张互动白板，为每个需要播放内容的节点安排合适的有序剧本场次。优先安全复用已有场次，不合适时明确提出补写或修订请求。

【当前白板】
{{graphContext}}

【可用剧本内容】
{{writingContext}}

【作者原始意见】
{{authorRequest}}

【作者补充要求】
{{userIntent}}

不同结局不得用同一段内容伪装；不要向作者暴露内部引用 ID、绑定槽位或变量规则。

{{skills}}`,
  },
  'interactiveMediaRevision': {
    id: 'interactiveMediaRevision',
    name: '互动白板 - 修改节点画面',
    template: `【任务】
根据作者意见修改当前节点的视频方案，只让受影响的节点重新制作，保留其他节点已经确认的画面。

【当前节点】
{{nodeContext}}

【当前视频方案】
{{mediaContext}}

【作者原始意见】
{{authorRequest}}

【作者补充要求】
{{userIntent}}

{{skills}}`,
  },
  'interactiveVisualRefinement': {
    id: 'interactiveVisualRefinement',
    name: '互动分镜 - 完善画面差异',
    template: `【任务】
为当前互动场次提出一套可审阅的画面表现方案。只处理观众实际看得见的环境变化和人物表演，不改故事事实，不新增角色、地点、道具或身份。

【当前场次】
{{sceneContext}}

【当前画面状态】
{{visualStateContext}}

【必须保持一致的角色与资产】
{{canonicalAssetContext}}

【作者原始意见】
{{authorRequest}}

【作者补充要求】
{{userIntent}}

请返回严格 JSON：
{
  "label": "作者能看懂的画面状态名称",
  "environmentChanges": ["环境、光线、道具位置或可见损伤的具体变化"],
  "performanceConstraints": ["人物动作、表情、身体状态和反应的具体要求"],
  "rationale": "为什么这样安排，使用作者能理解的一小段话"
}

不要输出内部变量、引用 ID、绑定槽位或技术指纹。数组内容必须具体可拍，不要写抽象情绪口号。

{{skills}}`,
  },
  'generateBranchingChoices': {
    id: 'generateBranchingChoices',
    name: 'AI 智能发散分支选项',
    template: `【角色设定】
你是互动视频游戏编剧。请依据现有网状叙事节点和上下文设计可执行的多命运走向。

【任务目标】
分析当前节点的情境、剧本对白、以及之前发生的祖先节点路线，为该节点自动生成合理的数个分支选项（具体数量由微调心愿决定，默认 2-3 个）以及对应的后续新节点大纲。

【当前项目与世界观设定提取】
{{worldbuilding}}

【当前节点前置路径（祖先节点）】
{{ancestorPath}}

【当前聚焦节点 (Current Node)】
节点标题: {{nodeTitle}}
节点剧本/内容: {{nodeScript}}

【创作者的微调心愿】
{{userIntent}}

请返回 JSON 数组。
格式要求：
{
  "choices": [
    {
      "displayText": "屏幕上显示的按钮文字(例如: 开枪击毙 / 潜行逃走)",
      "targetNodeTitle": "新阶段节点的标题(极简)",
      "targetNodeScript": "新阶段节点的剧情大纲和细节，至少 50 字描述后果。"
    }
  ]
}`
  },
  'generateInitialGameNodes': {
    id: 'generateInitialGameNodes',
    name: 'AI 生成初始互动游戏架构',
    template: `【任务目标】
你是互动视频游戏架构师。请根据以下影视项目的世界观和设定，生成一个具备发散潜力的初始互动游戏起点组（包含一个起点节点，以及首批 2 到 3 个初期分支节点代表开局的命运差异）。

【项目设定】
{{worldbuilding}}

请发挥想象力，将项目的初始矛盾作为切入点。

请返回 JSON 数组，格式要求：
{
  "nodes": [
    {
      "id": "start",
      "title": "起点节点名称(例如: 第一幕:酒馆)",
      "scriptContent": "一段简短的情境或剧本起因内容(不少于50字)...",
      "position": {"x": 250, "y": 150}
    },
    {
      "id": "node-2",
      "title": "分支节点1",
      "scriptContent": "选项A触发的内容...",
      "position": {"x": 750, "y": 0}
    }
// ... 更多节点
  ],
  "edges": [
    {
      "id": "edge-1",
      "sourceNodeId": "start",
      "targetNodeId": "node-2",
      "displayText": "屏幕上显示的按钮文字(前往A)"
    }
// ... 更多连线
  ]
}`
  },
  'generateGameBlueprint': {
    id: 'generateGameBlueprint',
    name: '互动游戏 - 生成本阶段落拓扑蓝图',
    template: `【角色设定】
你是互动叙事架构师。请为互动视频游戏（FMV）规划逻辑闭合、能承接前后文的局部分支网络。

【任务目标】
请为以下项目正在编排的**【这个特定段落/剧集阶段】**规划一份区域性的“互动剧情拓扑蓝图”。这份蓝图不涉及具体的细节网，而是作为当前段落发散故事节点的“导航仪”。

【项目宏观世界观设定】
{{worldbuilding}}

{{activeEpisodeContext}}

全局游戏规模参考：
- 全局预期规模：{{scale}}
- 全局目标结局数：{{endingCount}} 个
- 本章节目标节点数约：{{estimatedChapterNodes}} 节点（基于规模拆分）

要求：
1. **段落级自适应骨架**：不要把全局故事重写一遍！专注于**本段落的情节内**。分析本段落的承上启下作用。它是发散章？还是收缩章？为此段落设定一种最适合的微观叙事结构（如：单线多分支、多视点交织、结局收束漏斗）。
2. **段落内核心变盘点 (Turning Points)**：针对【这个特定段落/剧集阶段】，列出 3-5 个最重要的“核心玩家选项(变盘点)”，并预演这些选项会导致在本章节末尾产生哪几种不同的本章出口走向（这些出口将延伸给下一个段落，或是导致提前死亡）。
3. **内容继承与向下流转**：明确当前段落的几条核心分支路径如何在随后的步骤中切分到具体的SCENES（场景）中。

请使用纯文本输出，条理清晰，专注当前段落，作为后续生成节点和撰写剧本的坚实骨架依据。`
  },
  'generateGameGoldenPath': {
    id: 'generateGameGoldenPath',
    name: '互动游戏 - 生成段落黄金主线',
    template: `【角色设定】
你是互动游戏架构编剧。

【任务目标】
根据项目的【核心蓝图】和世界观，生成当前【段落剧情阶段】的主线节点网络，作为该阶段的黄金路线。

【核心蓝图】
{{blueprint}}

【项目世界观】
{{worldbuilding}}

【当前编排的核心段落 / 阶段上下文】
{{activeEpisodeContext}}

【预期规模特征】
项目体量定位于：{{scale}}

【生成要求】
1. **紧贴当前段落**：所有生成的节点必须服务于【当前编排的核心段落】，展现该段落内部的具体情节推进。不要跨越到下一个大章节，也不能生成无关内容。
2. **生成规划数量**：结合当前段落所需的剧情密度，一次性生成符合上述【预期规模特征】的一批核心主干节点。（如：轻量级通常只需要生成 5-8 个主干节点，而标准级需要 10-15 个主干节点，请灵活把握节奏）。
3. **结构特征**：形成一条逻辑自洽的长线。必须明确体现：当前段落是怎么开始的？转折点在哪？以及当前段落的终点节点如何自然过渡到“下一个段落”的预期方向？
4. **预留接口**：在当前段落的关键转折点，请在 scriptContent 中详细描述分支意图（如：这里可以有背叛线、战斗线），并标记该节点为需要扩延（isNeedsBranching: true）。未来这将在剧本文本中继承并发扬。

请返回 JSON 对象，格式要求：
{
  "nodes": [
    {
      "id": "node-id",
      "title": "节点标题",
      "scriptContent": "节点详细剧本简述（请包含角色动机、所处环境及如果切分为SCENES的预留依据）",
      "position": { "x": number, "y": number },
      "isNeedsBranching": boolean
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "sourceNodeId": "source-id",
      "targetNodeId": "target-id",
      "displayText": "选择文本或过渡动作"
    }
  ]
}`
  },
  'expandGameBranch': {
    id: 'expandGameBranch',
    name: '互动游戏 - 分支延展生成',
    template: `【角色设定】
你是互动游戏架构师。

【世界观设定】
{{worldbuilding}}

【全局蓝图】
{{blueprint}}

【当前编排的核心段落 / 阶段上下文】
{{activeEpisodeContext}}

【变量与状态机】
{{variableContext}}

【当前路径/节点上下文】
{{pathContext}}

【当前节点制作缺口】
{{productionStatus}}

【入场约束】
{{incomingContext}}

【出口约束】
{{outgoingContext}}

【任务目标】
从指定的【发端节点】开始，根据【历史路径轨迹】、【当前所属段落】以及全局蓝图，向外延展出一套新的分歧网络，并在内容上与后续剧本、分镜的制作接轨。

【全部现存节点网络上下文】
{{existingNodes}}
(注：请感知这些已经存在于棋盘上的节点，特别是那些可以作为合并归宿的主线锚点)

【历史路径轨迹 (连贯性核心)】
{{historyPath}}
(注：这是玩家到达当前发端节点所经历的真实剧情选择，请确保新生成的分支与此逻辑自洽)

【发端节点信息】
标题：{{nodeTitle}}
情境：{{nodeScript}}

【生成任务】
请从当前发端节点开始输出分支，发散出合理的多重命运走向，但情节必须收敛在【当前所属段落】的大框架内，或明确作为当前段落通向未来方向的踏板！
【极其重要】：你不仅可以生成全新的节点，**更可以（且强烈建议在剧情合理时）将连结线（Edges）直接连向【全部现存节点网络】中的那些下游节点**，形成天然闭合的网状结构！请让新发散出来的剧情能够“丝滑地降落”回段落主线之中（除非这是一条决裂到底的长分支）。
不要让分支无限制膨胀，一次性生成的延展层级请控制在一个剧情段落内（通常不超过 5-10 个新节点）。

【约束与规则】
1. **剧情连贯性**：确保新生成的选项与节点完全符合前置轨迹逻辑。
2. **超时默认流 (Timeout Default Sequence)**：不论是发散新分支还是连回已有节点，如果当前节点出现了多个离开的选择边(edges)，请【必须】在代表角色无作为或被动拖延的那一条连线上，于 \`displayText\` 中显式标注 \`[超时默认]\` 字样。
3. **坐标**：如果生成新节点，请使 \`position.x\` 大于发端节点的 X 轴坐标。

请返回 JSON 格式：
{
  "nodes": [
    {
      "id": "node-id",
      "title": "节点标题",
      "scriptContent": "节点详细剧本简述（请包含角色动机、所处环境及如果切分为SCENES的预留依据）",
      "position": { "x": number, "y": number },
      "isNeedsBranching": boolean
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "sourceNodeId": "source-id",
      "targetNodeId": "target-id",
      "displayText": "选择文本或过渡动作"
    }
  ]
}`
  },
  'executeSpecificBranchStrategy': {
    id: 'executeSpecificBranchStrategy',
    name: '执行特定分支策略',
    template: `【角色设定】
你是互动游戏架构编剧。

【任务目标】
这是一次精确的“定向分支发散”。你必须严格按照【核心策略】的发散意图，从指定的【发端节点】开始生成对应的下游分支，同时保证这些生成的情节依然属于【当前编排段落】的范畴。

【核心策略】
{{strategy}}

【世界观设定】
{{worldbuilding}}

【全局蓝图】
{{blueprint}}

【当前编排的核心段落 / 阶段上下文】
{{activeEpisodeContext}}

【变量与状态机】
{{variableContext}}

【当前路径/节点上下文】
{{pathContext}}

【当前节点制作缺口】
{{productionStatus}}

【入场约束】
{{incomingContext}}

【出口约束】
{{outgoingContext}}

【全部现存节点网络上下文】
{{existingNodes}}

【历史路径轨迹 (连贯性核心)】
{{historyPath}}

【发端节点信息】
标题：{{nodeTitle}}
情境：{{nodeScript}}

【约束与规则】
1. **剧情连贯性**：确保生成的下游情境紧密衔接【历史路径轨迹】和发端节点。
2. **超时默认流 (Timeout Default Sequence)**：如果生成多条分支，你【必须】在一条代表玩家不作为、犹豫或退缩的分支边 (edge) 的 \`displayText\` 中明显标注 \`[超时默认]\` 字样，指示倒计时结束的后果。
3. **坐标**：\`position.x\` 相较发端增加 300 到 400，\`position.y\` 根据分支数量分散排布。

请返回 JSON 格式：
{
  "nodes": [
    {
      "id": "node-id",
      "title": "节点标题",
      "scriptContent": "节点详细剧本简述（请包含角色动机、所处环境及如果切分为SCENES的预留依据）",
      "position": { "x": number, "y": number },
      "isNeedsBranching": boolean
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "sourceNodeId": "source-id",
      "targetNodeId": "target-id",
      "displayText": "选择文本或过渡动作"
    }
  ]
}`
  },
  'recommendBranchIntent': {
    id: 'recommendBranchIntent',
    name: 'AI 智子策略诊断 (Auto-Recommend Strategist)',
    template: `【任务目标】
你是高级互动叙事策略智子。在互动游戏开发过程中，请根据以下海量的项目上下文与当前节点位置，深度分析并推荐当下最适合的分支发展策略。
绝不允许简单的随机或者套牌推荐，必须严格依据上下文逻辑和当前进度做出最优决策。

【世界观设定】
{{worldbuilding}}

【全局叙事蓝图】
{{blueprint}}

【当前段落/章节任务】
{{activeEpisodeContext}}

【节点进度定位】
{{plotPosition}}
(若进度较低，初期应当多提供信息收集和小选择，谨慎使用过多的平行网；若进度中晚期，应频繁考虑伏笔收束、高危死亡陷阱及平行线交汇 foldback，避免节点指数爆炸。)

【全盘网络概览】
{{globalGraph}}

【通往当前节点的追溯轴】
{{historyPath}}

【入场约束】
{{incomingContext}}

【出口约束】
{{outgoingContext}}

【当前聚焦节点特写】
节点名称：{{nodeTitle}}
剧本纲要：{{nodeScript}}

【智子决策：请在以下三种策略意图中选择最高优的一项】
请认真斟酌上下文后，只返回所选策略的对应键名全小写英文（必须是以下三者之一，不要返回多余标点和格式）：
1. foldback: 适合收束式的插曲，或者是获取信息/探索/日常的选择。发散的两条（或多条）短时分支最后能顺滑地收束回到同一个节点继续主剧情。
2. parallel: 适合长线发散。面临角色的重大命运转折、生死分歧或者核心信仰拷问，选完后未来将不再轻易交汇，彻底分裂为两条平行的剧本轨迹。
3. deadend: 适合有明显高危陷阱、绝命诱惑、或者是对前期情报极度无视的惩罚。一个分支是生机推进，另一个分支是导致玩家直接走向“失败结局 (Dead End)”的致命分歧。`
  },
  'fixDanglingNodes': {
    id: "fixDanglingNodes",
    name: "AI 智能修复未闭环节点",
    template: `【任务目标】
这是一份互动叙事游戏节点图的审查请求。目前有一些“悬空节点（未闭环节点）”没有任何后续走向，并且它们并非游戏结局。
请你仔细阅读【全部现存节点上下文】，深入理解剧情上下文。
为这些悬空节点提供修复建议：将它们平滑且合理地连接到现有的某个具有承接性的节点上形成闭环。

【全部现存节点上下文】
{{existingNodes}}

【需要审查并修复的悬空节点ID列表】
{{danglingNodes}}

【修复要求】
1. 优先考虑“逻辑闭环”：寻找与该节点剧情顺承的现有节点进行汇聚（foldback）。
2. 每修复一条连接，必须生成一段极度合理的连线理由/选项文本。

请返回 JSON 格式，包含连接悬空节点的新边：
{
  "edges": [
    {
      "sourceNodeId": "悬空节点的ID",
      "targetNodeId": "拟接入的现有节点的ID",
      "displayText": "逻辑转折文字，保证丝滑承接"
    }
  ]
}`
  },
  'generateNodeDetailedScript': {
    id: 'generateNodeDetailedScript',
    name: 'AI 扩写节点剧本正文',
    template: `请根据以下互动节点的纲要，结合其上下文拓扑关系，帮我扩写为标准的好莱坞剧本文本格式（包含场景头部、动作描述和对白）：
节点名称：{{nodeTitle}}

【项目世界观/项目圣经规则】
{{worldbuilding}}

【当前段落/章节任务】
{{episodeContext}}

【变量与状态机】
{{variableContext}}

【玩家路径轨迹】
{{pathContext}}

【当前制作缺口】
{{productionStatus}}

【上游节点输入 (前因)】
{{incomingContext}}

【当前节点纲要】
{{nodeScript}}

【下游分歧选项 (后果 / 出口)】
{{outgoingContext}}

要求：
1. 剧情无缝承接：确保剧本开场第一组镜头和动作，完全顺接【前因】中玩家的选择行为，绝不要出现物理动作的时间线跳跃或场景突兀切换。
2. 互动待机 (Interactive Hold)：【核心要求】如果本节点包含下游分歧选项，剧本进行到该做决定的时刻必须停下。你务必在剧本最后输出一个“(互动待机)”的动作块，描写角色维持轻微动作循环（如凝视、喘气），并注明构图留出 UI 安全区（例如画面偏左或偏右三分之一留空），供玩家做抉择。
3. 超时默认流：如果在【后果】中存在暗示超时的选项分支，请在待机的气氛描写中稍稍体现倒计时的压迫感和默认走向的趋势。
4. 风格约束：深度遵守【项目设定】中的角色性格与世界观设定。

请直接输出剧本正文：`
  },
};
