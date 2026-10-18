import { PromptTemplate } from './types';

export const bibleTemplates: Record<string, PromptTemplate> = {
  'compressTropes': {
    id: 'compressTropes',
    name: '精炼套路与核心准则',
    template: `【任务目标】
请分析用户输入的核心创意，并提炼其背后的经典叙事结构与核心痛点（Tropes & Themes）。
为了节省后续模型的上下文空间，你必须将这些宏大的文学或影视套路，"智能压缩" 为极度短小精悍的核心准则（Core Guidelines）。

【用户的核心创意】
{{inspiration}}

【额外用户要求/意图】
{{userIntent}}

【项目类型】
{{projectType}}

【输出格式】
必须严格返回JSON格式数据：
{
  "compressedTropes": [
    "用一句话描述提炼出的核心套路或叙事准则（例如：'绝境逼迫下的道德异化'）"
  ],
  "aestheticGuideline": "一句话视觉基调或整体审美核心指导词汇"
}`
  },
  'validateTropes': {
    id: 'validateTropes',
    name: '精炼套路自检 (Validation)',
    template: `【任务目标】
这是一次“逻辑校验 (Validation)”步骤。你需要对刚刚生成的“精炼套路与核心准则”进行极其严苛的自检。

【待校验的原始生成数据】
{{generatedData}}

【用户的核心创意】
{{inspiration}}

【额外用户要求/意图】
{{userIntent}}

【核查清单（Checklist）】
1. 精炼出的套路是否准确抓住了用户创意的本质？是否存在过度解读或偏离主题的情况？
2. 核心审美基调是否与套路相符？是否足够具体且具有视觉指导意义？
3. 文字是否足够精简凝练？是否真的达到了“智能压缩”的目的？

请严格返回 JSON 格式数据：
{
  "flaws": ["缺陷指出1", "缺陷指出2"],
  "improvementPlan": "一整段关于如何具体重构这些套路与审美基调的改进建议"
}`
  },
  'rewriteTropes': {
    id: 'rewriteTropes',
    name: '重写精炼套路 (Rewrite)',
    template: `【任务目标】
请根据【用户的额外意图或修改意见】以及【自检反馈（如果有）】，重新提炼并重写“精炼套路与核心准则”。
你必须将这些宏大的文学或影视套路，"智能压缩" 为极度短小精悍的核心准则（Core Guidelines）。

【用户的核心创意】
{{inspiration}}

【上一版的生成数据或修改中数据】
{{generatedData}}

【自检反馈（如果为空则忽略）】
{{feedback}}

【额外用户要求/意图】
{{userIntent}}

【项目类型】
{{projectType}}

【强制输出要求】
1. 保持原有的 JSON 结构。
2. 吸收自检反馈和用户意见，精准修正。

必须严格返回JSON格式数据：
{
  "compressedTropes": [
    "用一句话描述提炼出的核心套路或叙事准则（例如：'绝境逼迫下的道德异化'）"
  ],
  "aestheticGuideline": "一句话视觉基调或整体审美核心指导词汇"
}`
  },
  'planCharacterRoster': {
    id: 'planCharacterRoster',
    name: '规划角色阵容画像',
    template: `【任务目标】
请根据以下前置上下文，分析并推演本项目需要的【核心角色阵容画像】。
你不需要设定角色的具体台词或详细档案，只需规划出“人物定位、大致描述/画像特质”。

{{inspirationContext}}

【用户显式点名的必含角色】
{{requiredNamedCharacters}}
以上角色来自用户原始输入，必须全部进入 plannedCharacters；不得用功能性称呼替代其姓名。

【项目类型与强制数量架构】
本项目类型为：{{type}}
请严格规划出：{{leadsCount}}名核心主角、{{supportingCount}}名主要/常驻配角、以及{{extrasCount}}名龙套/客串人物（总计{{totalCount}}人）。
切勿随意增减角色数量！必须严格遵守该配置。

【注入的前置设定/参考上下文】
{{selectedContext}}
(注意：请严格核对上方上下文中的“角色档案”，绝不要将已经存在的角色重复列入规划名单。本次规划仅补充尚缺角色。)

【用户的特定要求/意图】
{{userIntent}}

请严格按照 JSON 格式输出这个项目的“角色阵容画像计划”，返回一个对象，包含 \`plannedCharacters\` 数组。
数据结构要求：
{
  "plannedCharacters": [
    {
      "name": "暂定名称或代号 (如：神秘的反派)",
      "roleType": "lead" | "supporting" | "extra",
      "brief": "大致描述/画像特质"
    }
  ]
}
注意：你的输出必须是一个有效的 JSON，其他任何文字都不需要输出。`
  },
  'planLocationRoster': {
    id: 'planLocationRoster',
    name: '规划场景阵容画像',
    template: `【任务目标】
请根据以下前置上下文，分析并推演本项目需要的【核心场景规划】。
你不需要设定场景的详细描述或用于文生图的提示词，只需规划出“场景名称、类型和大致功能特质描述”。

{{inspirationContext}}

【用户显式点名的必含场景】
{{requiredNamedLocations}}
以上场景来自用户原始输入，必须全部进入 plannedLocations；不得用功能性相似场景替代其名称。

【项目类型与架构】
本项目类型为：{{type}}
预估的场景数量：{{locationsCount}}个。
请尽量接近该数量要求。

【注入的前置设定/参考上下文】
{{selectedContext}}
(注意：请严格核对上方上下文中的“场景档案”，绝不要将已经存在的场景重复列入规划名单。本次规划仅补充尚缺场景。)

【用户的特定要求/意图】
{{userIntent}}

请严格按照 JSON 格式输出这个项目的“场景规划”，返回一个对象，包含 \`plannedLocations\` 数组。
数据结构要求：
{
  "plannedLocations": [
    {
      "name": "暂定名称 (如：神秘的地下室 / 张三的单身公寓)",
      "brief": "大致描述/视觉功能特质/在这个场景发生了什么剧情"
    }
  ]
}
注意：你的输出必须是一个有效的 JSON，其他任何文字都不需要输出。`
  },
  'planPropRoster': {
    id: 'planPropRoster',
    name: '规划道具阵容画像',
    template: `【任务目标】
请根据以下前置上下文，分析并推演本项目需要的【关键道具规划】。
你不需要设定道具的详细描述或用于文生图的提示词，只需规划出“道具名称和大致功能意义描述”。

{{inspirationContext}}

【用户显式点名的必含道具】
{{requiredNamedProps}}
以上道具来自用户原始输入，必须全部进入 plannedProps；不得用功能性相似道具替代其名称。

【项目类型与架构】
本项目类型为：{{type}}
预估的关键道具数量：{{propsCount}}个。
请尽量接近该数量要求。

【注入的前置设定/参考上下文】
{{selectedContext}}
(注意：请严格核对上方上下文中的“道具档案”，绝不要将已经存在的道具重复列入规划名单。本次规划仅补充尚缺道具。)

【用户的特定要求/意图】
{{userIntent}}

请严格按照 JSON 格式输出这个项目的“道具规划”，返回一个对象，包含 \`plannedProps\` 数组。
数据结构要求：
{
  "plannedProps": [
    {
      "name": "暂定名称 (如：沾血的时钟 / 祖传玉佩)",
      "brief": "道具的外观特质/在剧情中起到的关键作用或隐喻"
    }
  ]
}
注意：你的输出必须是一个有效的 JSON，其他任何文字都不需要输出。`
  },
  'generateProposals': {
    id: 'generateProposals',
    name: '生成项目提案',
    template: `【角色设定】
你是影视制片人与编剧。请从用户灵感中推演可执行的影视或互动项目圣经。

【任务目标】
请根据【用户的创意】与【项目定位】，生成一个项目的初始设定（项目圣经）。
1. **深度挖掘**：不要局限于字面意思。请运用“举一反三”的能力，挖掘灵感背后的时代情绪和人性的“想要（Want）”与“需要（Need）”。
2. **冲突重构**：核心冲突严禁流于表面。必须包含内在、外在、系统性冲突及终极筹码。

【项目定位】
注意：当前项目形态为 [{{projectModel}}]。
{{projectScale}}
{{projectRequirement}}

【用户的创意（含精炼套路）】
{{inspiration}}

【核心冲突：戏剧协议】
在输出 \`coreConflict\` 时，你必须包含以下维度的深度拆解：
- **外部目标 (Want)**：主角主观上拼命想要达成什么物理目标？
- **内在缺失 (Need)**：主角灵魂深处缺失什么认知？他的“想要”与“需要”如何冲突？
- **对抗力量 (Antagonism)**：阻碍主角的不是单纯的坏人，而是什么样的对立价值观或系统性压迫？
- **终极代价 (Stakes)**：如果主角失败，他将失去什么无法挽回的东西（生存、灵魂、还是希望）？

【跨国创意视点 (Creative Vision)】
请基于用户的创意，自动推演并生成 {{versionCount}} 个不同风格的视点版本。
要求：
{{styleInstructions}}
- **输出内容**：visionReasoning（简短、可审计的风格选择理由，不要输出内部思维过程）、versionName、genre (数组)、visualStyle (视觉、媒介、光影与运动语言)、narrativeStyle (叙事/台词习惯)、referenceWorks (对标作品/创作者)、globalLook (兼容字段名，语义为“全局视觉处理”，必须使用中文标签。包含 baseTexture(基础表面或成像质感，例如 2D 纸纹与线条、3D 着色与材质、实拍成像或定格手作表面)、colorGrading(色彩关系)、conditionalEffects(仅在明确条件成立时触发的视觉效果))。不得默认项目是写实电影，也不得默认胶片、摄影机或任何具体动画技法。

【输出格式规范】
1. 必须返回合法的 JSON 对象。
2. 绝对不要在最外层包裹 \`projectBible\` 字段。
3. 结构如下：
{
  "premiseReasoning": "对创意的深度分析与模式适配逻辑",
  "logline": "一句话核心梗概",
  "coreConflict": {
    "want": "外部目标",
    "need": "内在需求与灵魂缺陷",
    "antagonism": "对抗力量与系统压迫",
    "stakes": "失败的终极代价"
  },
  "creativeVisions": [ ...{{versionCount}}个版本的数组 ]
}`
  },
  'generateCharacters': {
    id: 'generateCharacters',
    name: '生成核心角色',
    template: `【角色设定】
你是选角导演与人物塑造专家。请依据已确认项目事实设计具有明确动机、弱点与行为差异的角色。

{{inspirationContext}}

【任务目标】
请基于以下已确定的项目信息以及用户的要求，为指定的几个角色生成深度角色档案。这是一个局部的连载/增量生成过程。

【当前需要生成的目标角色名单】
以下是本次要求你生成详细档案的角色名单，请专注于完成这几个角色的详细设定：
{{targetGenerationList}}

【项目类型】
{{type}}

【注入的前置设定/参考上下文（含已存在的其他角色档案）】
已有角色和世界观：
{{selectedContext}}
(注意：请确保你只生成上面【当前需要生成的目标角色名单】中的角色。如果在这个上下文中看到了已经存在的角色，请绝对不要覆盖或重复生成他们。)

【预设立定的角色阵容画像计划 (历史参考)】
{{characterRosterPlan}}

【创作者的具体想法/指令】
{{userIntent}}

要求：
1. **深度人格设定**：每个设定的角色必须包含：
   - psychologicalProfile（对人物矛盾、行为动机与设计意图的可审计摘要，不要输出内部思维过程）
   - name (姓名)
   - mbti (16型人格类型，如INTJ, ENFP等)
   - enneagram (九型人格，如 8w7 等)
   - vocalQuirk (说话怪癖，如：喜欢反问，句尾带轻微叹息等)
   - internalDesire (内在渴望：真正需要什么)
   - externalGoal (外在目标：具体要达成什么)
   - flaw (致命弱点：阻碍角色达成目标的性格缺陷或创伤)
   - sliders: 动态情绪滑块量表（生成3-5个适合该剧集类型的情绪维度，范围 -10 到 10。例如：{'压力阈值': 8, '黑化潜能': -3, '共情度': 5}）。这些将作为角色的“情绪操控面板”。
2. **动态关系网生成**：生成这批角色的网络关系。必须带有动态张力维度。
   - 包含：sourceName (角色A), targetName (角色B), type (关系类型), description (描述)
   - dynamic parameters (\`dynamics\` 对象属性): 举一反三，根据题材为你发散动态维度，如 {'背叛潜力': 8, '羁绊深度': 3, '权力博弈值': -5} 范围-10~10。

请严格返回 JSON 格式数据：
{
  "characters": [{ "psychologicalProfile": "...", "name": "...", "mbti": "...", "enneagram": "...", "vocalQuirk": "...", "internalDesire": "...", "externalGoal": "...", "flaw": "...", "sliders": {"stress": 5, ...} }],
  "relationships": [{ "sourceName": "A", "targetName": "B", "type": "师徒", "description": "...", "dynamics": {"betrayal": 8} }]
}`
  },
  'validateCharacters': {
    id: 'validateCharacters',
    name: '逻辑自检校准 (Validation)',
    template: `【任务目标】
这是一次“逻辑校验 (Validation)”步骤。你需要对刚刚基于项目设定的角色阵容与人物关系进行极其严苛的自我审问和自检。

【待校验的原始生成数据】
{{generatedData}}

【项目类型】
{{type}}
【创作者想法】
{{userIntent}}
【前置设定】
{{selectedContext}}

【核查清单（Checklist）】
1. 人设与世界观是否有割裂感？（例如在硬硬科幻里写了一个纯靠唯心主义驱动的角色）
2. 情绪滑块（sliders）的初始数值设定是否自洽？（有没有同质化，或者与角色标签相悖的维度？）
3. 有没有“为了推剧情而显得太过刻意”的设计（Plot device character）？角色的内外动机是否真正能从他们自身的视点立住？
4. 人物关系网（dynamics）是否平庸？是否缺乏潜在的“背叛潜力”、“权力反转”等高张力锚点？

请严格返回 JSON 格式数据：
{
  "flaws": ["缺陷指出1", "缺陷指出2"],
  "improvementPlan": "一整段关于如何具体重构这些角色档案与关系的改进建议"
}`
  },
  'refineCharacters': {
    id: 'refineCharacters',
    name: '精准修正定稿 (Refine)',
    template: `【任务目标】
这是角色构建的“精准修正 (Refine)”阶段。
请你吸收上一轮的【自检与纠错反馈】，对【原始生成数据】进行闭环式精细微调，锁死角色的底层设定逻辑。不能改变角色的核心数量与名称，只做深度的修改和重塑。

【待修正的原始生成数据】
{{generatedData}}

【自检与纠错反馈】
{{feedback}}

【强制输出要求】
1. 保持原有的 JSON 结构。
2. 强化 \`psychologicalProfile\` 中的深度。
3. 把反馈中提到的所有改进点在数据体（特别是 \`sliders\` 维度和 \`vocalQuirk\`, \`dynamics\`）中体现出来。

请严格返回完整的经过修正的 JSON 数据：
{
  "characters": [{ "psychologicalProfile": "...", "name": "...", "mbti": "...", "enneagram": "...", "vocalQuirk": "...", "internalDesire": "...", "externalGoal": "...", "flaw": "...", "sliders": {"stress": 5, ...} }],
  "relationships": [{ "sourceName": "A", "targetName": "B", "type": "师徒", "description": "...", "dynamics": {"betrayal": 8} }]
}`
  },
  'generateWorldRules': {
    id: 'generateWorldRules',
    name: '生成世界观规则',
    template: `【世界观构建专家】
你是世界观架构师（World Builder）。请构建具体、自洽并可用于剧情校验的底层规则体系。

{{inspirationContext}}

【任务目标】
请基于以下已确定的项目信息，为该项目生成核心的世界观规则（World Building Rules）。
这些规则将作为后续 AI 剧本创作的底层约束，确保故事逻辑的严密性和一致性。

【项目类型】
{{type}}

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

要求：
1. 规则必须深度契合故事的 Logline 和核心冲突，为戏剧张力服务。
2. 规则分类（category）可以包括但不限于：物理法则（Magic/Physics）、社会结构（Society/Politics）、技术设定（Technology）、核心禁忌（Taboos）、时间线（Timeline）等。
3. 每条规则的描述（content）必须具体、清晰，具有可操作性，能够直接指导剧情发展。

请严格返回 JSON 格式数据，包含一个 rules 数组。
rules 数组中每个对象包含：category (规则分类), content (规则具体内容)。`
  },
  'regenerateLogline': {
    id: 'regenerateLogline',
    name: '重写 Logline',
    template: `【角色设定】
你是剧本医生与制片人。请用精炼语言概括故事的核心卖点与悬念。

【系统精炼套路与核心准则】
{{inspirationContext}}

【任务目标】
基于以下项目信息，重新生成一个极具吸引力的 Logline（一句话故事）：

【创作者的具体想法/指令】
{{userIntent}}

项目上下文：
类型：{{type}}
当前核心冲突：{{coreConflict}}
创作视点：
{{creativeVision}}`
  },
  'regenerateConflict': {
    id: 'regenerateConflict',
    name: '重写核心冲突',
    template: `【角色设定】
你是剧本医生。请基于项目事实重构人物内在、外部与系统性冲突。

【系统精炼套路与核心准则】
{{inspirationContext}}

【任务目标】
基于以下项目信息，重新生成一个深刻的核心冲突。

【创作者的具体想法/指令】
{{userIntent}}

【输出规范】
必须严格返回 JSON 格式数据：
{
  "want": "外部目标（主角想要达成什么物理目标）",
  "need": "内在缺失（主角灵魂深处缺失什么认知）",
  "antagonism": "对抗力量（阻碍主角的价值观冲突或压力）",
  "stakes": "终极代价（如果主角失败，他将失去什么）"
}

请确保每个字段的内容深刻且具有戏剧张力。

【参考：戏剧协议】
- 外部目标 (Want)：主角主观上拼命想要达成什么物理目标？
- 内在缺失 (Need)：主角灵魂深处缺失什么认知？他的“想要”与“需要”如何冲突？
- 对抗力量 (Antagonism)：阻碍主角的不是单纯的坏人，而是什么样的对立价值观或系统性压迫？
- 终极代价 (Stakes)：如果主角失败，他将失去什么无法挽回的东西？

项目背景：
类型：{{type}}
当前Logline：{{logline}}
创作视点：
{{creativeVision}}`
  },
  'regenerateCharacter': {
    id: 'regenerateCharacter',
    name: '重写角色设定',
    template: `【角色设定】
你是人物塑造专家。请为角色设计可指导选择与表演的动机和弱点。

{{inspirationContext}}

【任务目标】
基于以下项目信息，重新生成角色设定（包含外在目标、内在渴望、致命弱点）。{{characterName}}

【项目圣经】
当前体裁/类型：{{type}}
创作视点/美学对标：
{{creativeVision}}

请务必保持新的设定符合当前的体裁风格，不可串味。

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

请直接返回 JSON 格式数据，包含：
- name：名称。
- visualIdentity：稳定可见身份锚点，只描述视觉年龄、脸部比例、体态、发型、基础服装、材质和辨识特征；不要写角色板版式或镜头指令。
- psychologicalProfile：心理画像。
- mbti：MBTI 行为偏好。
- enneagram：九型人格与翼。
- internalDesire：内在渴望。
- externalGoal：外在目标。
- flaw：压力下的致命弱点。
- actingStyle：可执行的表演策略或流派。
- vocalQuirk：语言与声线行为特征。
- sliders：3-5 个与本项目相关的情绪/压力维度，值为 -10 到 10。

这些字段会分别进入角色板姿态表情、选角要求、表演部门、分镜表演节拍、对白/声音上下文。人格类型只能作为行为推演辅助，禁止把 MBTI 或九型人格转化为外貌、阶层、族裔或服装刻板印象。`
  },
  'regenerateAsset': {
    id: 'regenerateAsset',
    name: '重写资产设定',
    template: `【资产制作档案】
你是美术指导（Production Designer）。请把项目事实转换为空间、色彩、材质与可制作的资产设定。

{{inspirationContext}}

【任务目标】
基于以下项目信息，重新生成该资产（场景/道具）的详细设定。{{assetName}}

【项目圣经】
当前体裁/类型：{{type}}
创作视点/美学对标：
{{creativeVision}}

请务必保持新的设定符合当前的体裁风格，不可串味。

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

请直接返回 JSON 格式数据，包含：
- name：资产名称。
- description：稳定的制作身份事实。场景需要包含空间骨架、入口出口、关键陈设、材质、可拍区域和光线条件；道具需要包含轮廓、尺寸、材质、持握/交互结构和功能边界。
- tags：2-5 个用于检索和部门协作的关键词。

不要在这里输出单张概念图提示词、多视图版式或全景图版式。角色板、场景板、道具板由资产板策略结合项目风格锁统一生成；状态变化必须进入 variant，不能混进基础身份。`
  },
  'productionAssetVisualDesign': {
    id: 'productionAssetVisualDesign',
    name: '资产形象设计',
    template: `{{profileTask}}

当前资产：{{characterName}}{{assetName}}
已有外观、已知外观依据和其他已定形象：
{{assetDesignContext}}

已采用资料：{{currentProfile}}
本次可用来源：{{sourceCoverage}}
作者选择的来源正文：
{{selectedContext}}

项目创作方向：{{inspirationContext}}
{{type}}
{{creativeVision}}
作者要求：{{userIntent}}
{{skills}}

只依据实际提供的文字或图片。以原文和作者已定形象为约束补足外观；新剧集的信息不能直接覆盖原设计。原文事实、设计补充和冲突写入 sourceNotes，纯视觉描述与说明分开。输出只使用本次任务要求的字段。`,
  },
  'productionAssetCharacterProfile': {
    id: 'productionAssetCharacterProfile',
    name: '整理角色资料 / 外观设计',
    template: `请依据本次任务整理角色资料，输出待作者采用的候选。

【本次任务】
{{profileTask}}

【当前角色】
{{characterName}}

【当前已采用资料，非空内容保留】
{{currentProfile}}

【可用来源范围，实际依据以作者勾选的正文为准】
{{sourceCoverage}}

【作者选择的来源正文】
{{selectedContext}}

【创作方向，仅用于外观设计，不能冒充剧本事实】
{{inspirationContext}}
{{type}}
{{creativeVision}}

【作者补充】
{{userIntent}}
{{skills}}

只根据实际提供的内容判断。只导入第一集就只知道第一集；不预测后续剧情，也不把人物当场的目的、伪装、受伤、害怕或争吵升级为全剧目标、永久外貌或性格。全剧目标、内在渴望、心理类型没有可靠依据时保持未知。人物小传中的明确长期设定可作为依据；部门建议、导演风格与模型推测不算剧本事实。

visualIdentity 只写可用于角色参考图的稳定外观，不带灯光、画风、镜头、持有道具或本场衣服污损。表演与说话仅保留适用范围明确、能观察或听见的习惯；不要从 MBTI 或一次动作推断习惯。每场目标、情绪、动作和对白节奏由该场剧本在分镜阶段确定，优先于一般习惯。

例如：只提供第一集“阿青短发，穿白衬衣；这次被追问时移开视线”。整理结果可提取明确外观；不能据此生成“性格逃避”“终生追求自由”或“说话总是躲闪”。当场移开视线留给这场分镜。若作者另行选择外观设计，可补充未确定的脸部比例，但要标记为设计，不能声称原文这样写。

只返回 JSON 对象，不需填满：visualIdentity（稳定外观）、actingStyle（日常可观察的表演习惯）、vocalQuirk（说话习惯）、sourceNotes（简短说明所用来源标题、支持各项的原文及未能确认的部分）。整理任务中未知字段用空字符串或省略。外观设计任务只返回 visualIdentity 与 sourceNotes。不要返回姓名、心理、目标、人格和量表字段。sourceNotes 不是生产提示词，不要塞进前三个字段。没有新增信息时也如实说明，不为填表编造。`
  },
  'productionAssetCatalogProfile': {
    id: 'productionAssetCatalogProfile',
    name: '补全项目资产制作档案',
    template: `【项目资产制作档案】
你是电影美术指导、置景、道具与连续性部门组成的专业协作 Agent。你的任务是补全一个可供资产板、场次拆解、分镜和视频生成共同使用的项目级制作档案，而不是生成单张概念图。

【项目创作方向】
{{inspirationContext}}

【当前资产】
{{assetName}}

【当前已采用档案】
{{currentProfile}}

【项目类型】
{{type}}

【项目创作圣经】
{{creativeVision}}

【创作者选择的上下文】
{{selectedContext}}

【专业 Skill】
{{skills}}

【创作者的补充要求】
{{userIntent}}

【事实与候选边界】
1. 先逐项读取完整来源剧本、已确认场次拆解和已采用部门结果。剧本明确的空间关系、入口出口、关键陈设、轮廓、颜色、材质、标记、交互结构和功能必须原样保留。
2. description 只收录跨场稳定的项目级身份。日夜、天气、开合、损毁、血污、持有人、摆放位置、显影进度和灯光阶段必须进入状态变体，不得混入基础身份。
3. 来源未锁定的细节可以提出制作候选，但必须在字段内用【候选设计】明确标记；不得把部门建议伪装成剧本事实。
4. 已确认的制作路线和连续性决定必须被吸收，已被解决的 openQuestions 不得重新提出。
5. 这是“补全”而不是“重命名”。当前正式资产名称属于已采用项目事实，必须原样保留；名称变更应走专门的资产修改流程。

【确认后自动质检与修正标准】
首次生成后，系统会在不重复打断创作者的前提下，用本提示词中的同一份剧本、拆解、部门结果和创作者要求自动质检并修正候选。质检必须逐项检查：剧本锚点是否完整；未锁定设计是否带【候选设计】；基础身份是否混入场次状态；已有项目事实是否被改写；描述是否可供资产板、场次变体、分镜和视频参考包执行。只有评分不低于 90、无 blocking 问题并通过复检的候选才允许采用，全部质检提示词和结论必须进入审计记录。

请直接返回 JSON：
- name：资产名称。
- description：稳定的制作身份事实。场景需要包含空间骨架、入口出口、关键陈设、材质、可拍区域和基础光线条件；道具需要包含轮廓、尺寸、材质、持握/交互结构和功能边界。
- tags：2-5 个用于检索和部门协作的关键词。

不要输出单张概念图提示词、多视图版式或全景图版式。角色板、场景板、道具板由资产板策略结合项目风格锁统一生成。日夜、天气、损毁、血污、湿身、开合等变化必须进入状态变体，不得混入项目级基础身份。不得修改剧本事实或凭空增加剧情用途。`
  },
  'estimateAssetCount': {
    id: 'estimateAssetCount',
    name: '场景与道具数量估算',
    template: `【角色设定】
你是制片人与美术指导。请依据项目形态、时长和故事体量评估制作资产规模。

{{inspirationContext}}

【任务目标】
请基于以下项目信息，估算该项目在“核心场景”和“关键道具”上的合理数量范围，并推导出一个推荐的具体数量。
你必须考虑以下因素：
1. 项目的类型（电影/电视剧/短剧等）：短剧场景通常更集中，而长篇剧集需要更多样化的空间。
2. 预估总时长或集数。
3. 故事发生的体量：是一个封闭空间的故事，还是多国度的史诗？

项目类型：{{type}}
预估时长/集数：{{duration}}

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

请返回 JSON 格式数据，包含：
- locations: 整数，推荐的核心场景数量
- props: 整数，推荐的关键道具数量
- reasoning: 字符串，给创作者解释为什么推荐这个数量，可以包含对整体体量和制作节奏的建议。`
  },
  'generateLocations': {
    id: 'generateLocations',
    name: '生成核心场景',
    template: `{{inspirationContext}}

【任务目标】
请基于以下已确定的项目信息以及用户的要求，为指定的几个场景生成深度场景档案。这是一个局部的连载/增量生成过程。

【当前需要生成的目标场景名单】
以下是本次要求你生成详细档案的场景名单，请专注于完成这几个场景的设定：
{{targetGenerationList}}

【项目类型】
{{type}}

【注入的前置设定/参考上下文（含已存在的其他资产）】
已有设定：
{{selectedContext}}
(注意：请确保你只生成上面【当前需要生成的目标场景名单】中的场景。如果在这个上下文中看到了已经存在的场景，请绝对不要覆盖或重复生成他们。)

【创作者的具体想法/指令】
{{userIntent}}

要求：
每个设定的场景必须包含以下字段：
1. name (名称)
2. description (详细描述，包括外观、材质、年代感、氛围等)
3. prompt (用于AI绘图的英文提示词，包含光影、构图、风格等)
4. tags (2-3个标签的字符串数组)
5. panoramaPrompt (如果是场景，提供用于生成全景图的英文提示词)

请直接返回 JSON 格式数据，包含 locations 数组，不要返回多余的内容，不要包裹在 Markdown 代码块里。`
  },
  'generateProps': {
    id: 'generateProps',
    name: '生成关键道具',
    template: `{{inspirationContext}}

【任务目标】
请基于以下已确定的项目信息以及用户的要求，为指定的几个道具生成深度道具档案。这是一个局部的连载/增量生成过程。

【当前需要生成的目标道具名单】
以下是本次要求你生成详细档案的道具名单，请专注于完成这几个道具的设定：
{{targetGenerationList}}

【项目类型】
{{type}}

【注入的前置设定/参考上下文（含已存在的其他资产）】
已有设定：
{{selectedContext}}
(注意：请确保你只生成上面【当前需要生成的目标道具名单】中的道具。如果在这个上下文中看到了已经存在的道具，请绝对不要覆盖或重复生成他们。)

【创作者的具体想法/指令】
{{userIntent}}

要求：
每个设定的道具必须包含以下字段：
1. name (名称)
2. description (详细描述，包括外观、材质、年代感、氛围等)
3. prompt (用于AI绘图的英文提示词，包含光影、构图、风格等)
4. tags (2-3个标签的字符串数组)
5. multiViewPrompt (如果是道具，提供用于生成多视角设计图的英文提示词)

请直接返回 JSON 格式数据，包含 props 数组，不要返回多余的内容，不要包裹在 Markdown 代码块里。`
  },
  'generateAllAssets': {
    id: 'generateAllAssets',
    name: '生成核心场景与道具',
    template: `【角色设定】
你是美术指导和世界观架构师。请通过场景与道具建立一致、可制作的视觉世界。

{{inspirationContext}}

【任务目标】
请基于以下项目信息，为该项目生成核心场景（Locations）和关键道具（Props）。
当前项目的预计需求为：核心场景 {{assetCountConfigLocations}} 个左右，关键道具 {{assetCountConfigProps}} 个左右。
请尽量接近该数量进行生成！

请确保涵盖故事发生的最重要舞台，以及对剧情推进、角色塑造有重大意义的物件。
同时请注意：这只是初始的核心资产设定。在后续的剧本创作和拆解环节中，系统允许根据剧情需要随时新增场景和道具。

项目类型：{{type}}
目标场景数量：{{assetCountConfigLocations}}
目标道具数量：{{assetCountConfigProps}}

【注入的前置设定/参考上下文】
{{selectedContext}}

【创作者的具体想法/指令】
{{userIntent}}

【去重说明：非常重要】
项目中已存在以下场景和道具，请在生成新资产时务必避开这些已有的名称和核心设定。严禁生成名称相同或功能高度重合的冗余资产。
已有场景：{{existingLocations}}
已有道具：{{existingProps}}

请严格返回 JSON 格式数据，包含 locations 和 props 两个数组。
每个对象必须包含：
- name (名称)
- description (详细描述，包括外观、材质、年代感、氛围等)
- prompt (用于AI绘图的中文提示词，包含光影、构图、风格等)
- tags (2-3个标签的字符串数组)`
  },
};
