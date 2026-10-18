import type { PromptTemplate } from "./types";
import { upgradeScenePlanSourceContract } from "./scenePlanSourceContract";

export const productionTeamTemplates: Record<string, PromptTemplate> = {
  productionNovelToScript: {
    id: "productionNovelToScript",
    name: "小说转制片剧本来源",
    template: `你是影视编剧。请把下列小说来源单元改写为可供导演制片继续拆解的完整剧本正文。不要生成资产表、场次表、镜头表或制片计划；这些将在后续独立步骤处理。不得凭空补写与原文相冲突的关键事实；原文没有决定的部分请用可读、可拍摄的戏剧动作自然承接。

{{selectedContext}}

【项目类型】
{{projectFormat}}

【来源单元】
{{sourceTitle}}

【小说原文】
{{sourceContent}}

【创作者补充意见】
{{userIntent}}

{{skills}}

返回 JSON：
{
  "scriptText": "完整的剧本正文"
}`,
  },
  productionScenePlan: {
    id: "productionScenePlan",
    name: "制片场次方案",
    template: upgradeScenePlanSourceContract(`你是经验丰富的跨媒介制片与导演。请只针对当前来源工作范围，提出可执行的制片场次方案。导入的上游分集、分段、分场和节拍是只读参考，不会在导入时自动创建制片场次；原有场头和划分已经合理时应保留，不得为了显示重新规划而强拆、强并或重排。需要调整时，以完整原文的实际表演、地点、时间、人物出入和制作需求为依据，并说明原因。

{{selectedContext}}

【项目类型】
{{projectFormat}}

【当前来源工作范围】
{{sourceDocumentTitle}}

【当前来源完整剧本】
{{sourceDocumentContent}}

【当前来源目标成片时长】
{{sourceTargetDuration}}

【前文与后续范围连续性参考（只读）】
{{fullScriptContext}}

【上游结构参考（只读）】
{{upstreamWritingReference}}

【互动路径、选择与状态合同（只读）】
{{interactivePlanningContext}}

【创作者补充意见】
{{userIntent}}

{{skills}}

scenes 只能覆盖“当前来源完整剧本”。连续性参考里的前文、后续标题和上游结构都不得成为候选场次。互动合同也不得补写来源没有的剧情。若本范围存在互动节点，每个候选场次都必须在 interactiveNodeIds 中声明其服务的一个或多个合同 nodeId；只允许使用互动合同中出现的 nodeId，所有合同 nodeId 至少要被一个候选场次覆盖。不要凭题材或关键词猜测节点归属。每个候选场次必须给出准确的原文依据，所有场次按原文顺序完整覆盖来源，不得遗漏或重复任何正文。sourceEvidence 必须是从当前来源完整剧本中逐字摘取、足够支撑后续拆解的连续片段；不要用概述代替原文，不要捏造原文没有的剧情。目标时长明确时，所有 targetDurationMinutes 的总和必须等于当前来源目标成片时长；允许使用小数，并须按演员实际完成对白、动作、反应、停顿、走位、视觉过程和转场所需时间分配，禁止按固定场数、平均分配、字符数或固定语速机械推算。不要输出资产表、镜头表、部门方案或场内节拍。

返回 JSON：
{
  "scenes": [
    {
      "title": "制片场次标题",
      "description": "本场发生什么以及为何独立成场",
      "purpose": "本场叙事/制作目的",
      "sourceEvidence": "从当前来源剧本摘取的原文片段",
      "continuityIn": "入场承接；不确定时留空",
      "continuityOut": "出场承接；不确定时留空",
      "targetDurationMinutes": 0,
      "interactiveNodeIds": ["只填写互动合同提供的 nodeId；线性范围填 []"]
    }
  ]
}`),
  },
  productionScenePlanQa: {
    id: "productionScenePlanQa",
    name: "制片场次方案质检",
    template: `你是资深影视制片 QA。只审查当前来源工作范围的制片场次方案，不得改写剧本、创建场次或补充资产、镜头、部门方案。

{{selectedContext}}

【项目类型】
{{projectFormat}}

【当前来源完整剧本】
{{sourceDocumentContent}}

【当前来源目标成片时长】
{{sourceTargetDuration}}

【当前制片场次方案】
{{currentScenePlan}}

【互动路径、选择与状态合同（只读）】
{{interactivePlanningContext}}

【创作者补充关注点】
{{userIntent}}

{{skills}}

检查原文覆盖、场次边界、连续性、互动选择与状态承接、可拍性和原文依据是否足够。时长审查既要核对各场 targetDurationMinutes 的总和，也要判断对白、动作、反应、停顿、走位、视觉过程和转场能否在分配时长内真实完成；算术正确但表演或视觉过程无法成立，仍然必须扣分并提出可执行修正。不要因为文风偏好制造 blocking 问题。

场次方案质检采用 0 到 100 分制，score 必须是 0 到 100 的整数，禁止使用 1 到 10 分制。只有 score 不低于 85、没有 blocking、且方案能够直接交给后续场次拆解时，verdict 才能为 pass；score 低于 85 或存在 blocking 时，verdict 必须为 revise。

返回 JSON：
{
  "score": 0,
  "verdict": "pass 或 revise",
  "summary": "总体结论",
  "issues": [
    {"severity": "blocking、warning 或 advisory", "description": "问题", "suggestion": "具体可执行的修改建议"}
  ]
}`,
  },
  productionScenePlanOptimize: {
    id: "productionScenePlanOptimize",
    name: "制片场次方案优化",
    template: upgradeScenePlanSourceContract(`你是经验丰富的影视制片与导演。请根据已确认的质检意见，重新提出当前来源工作范围的制片场次方案。只输出新的候选，不得直接修改已采用的正式场次。

{{selectedContext}}

【项目类型】
{{projectFormat}}

【当前来源完整剧本】
{{sourceDocumentContent}}

【当前来源目标成片时长】
{{sourceTargetDuration}}

【当前场次方案】
{{currentScenePlan}}

【质检意见】
{{scenePlanQa}}

【互动路径、选择与状态合同（只读）】
{{interactivePlanningContext}}

【创作者补充意见】
{{userIntent}}

{{skills}}

逐项落实质检意见。互动合同规定的选择窗口、目标节点及状态承接必须保留在候选场次的边界与连续性描述中，但不得据此编造原文没有的剧情。若本范围存在互动节点，每个候选场次都必须在 interactiveNodeIds 中声明其服务的一个或多个合同 nodeId；只允许使用互动合同中出现的 nodeId，所有合同 nodeId 至少要被一个候选场次覆盖。目标时长明确时，所有候选场次 targetDurationMinutes 的总和必须等于当前来源目标成片时长，并按真实表演与视觉过程重新分配；不得为了凑时长机械合并剧本中确实影响灯光、资产状态、人物出入或拍摄调度的制作边界。所有场次按原文顺序完整覆盖来源，不得遗漏、重复或改写；每个候选场次必须保留足够支撑后续场次拆解的 sourceEvidence 连续原文片段。不要输出资产表、镜头表、部门方案或场内节拍。

返回 JSON：
{
  "scenes": [
    {
      "title": "制片场次标题",
      "description": "本场发生什么以及为何独立成场",
      "purpose": "本场叙事/制作目的",
      "sourceEvidence": "从当前来源剧本摘取的原文片段",
      "continuityIn": "入场承接；不确定时留空",
      "continuityOut": "出场承接；不确定时留空",
      "targetDurationMinutes": 0,
      "interactiveNodeIds": ["只填写互动合同提供的 nodeId；线性范围填 []"]
    }
  ]
}`),
  },
  productionTeamGenerate: {
    id: "productionTeamGenerate",
    name: "制片筹备部门方案",
    template: `你是专业影视制作团队中的{{departmentName}}。你负责当前分集或电影分段的{{departmentResponsibility}}，与其他部门横向协作，不得改写已经确定的剧本事实。

{{selectedContext}}

【当前项目】
项目名称：{{projectTitle}}
项目类型：{{projectType}}
创作风格：{{creativeVision}}

【当前制片单元】
{{sourceUnitTitle}}

【当前分集或分段完整剧本】
{{sourceUnitScript}}

【跨制片单元连续性参考（只读摘要）】
{{fullScriptContext}}

{{sourceWritingContext}}

【已确认正式场次与制片拆解】
{{breakdownContext}}

【跨部门协作上下文】
{{collaborationContext}}

协作上下文中的 confirmedPeerBriefs 是已确认的上游/协作部门结论，incomingHandoffs 是明确发给本部门的任务。必须逐项吸收与回应；不能静默覆盖其他部门决定。若存在冲突，应保留本部门专业判断，并通过结构化 handoffs 定向交给有权决定的部门。不要引用未确认部门草稿。

【本部门任务】
{{departmentTask}}

【创作者补充意见】
{{userIntent}}

{{skills}}

请先给出覆盖当前分集或分段的本部门总体方案，再为上述每一个正式 sceneId 给出场次执行明细。方案必须达到专业拍摄可执行的粒度，服务戏剧目标、观众信息与情绪体验，避免“加强氛围”“注意连续性”这类无法执行的空话。每条关键建议都应能回到当前剧本、已确认拆解或明确的创作提案。

scenePlans 必须完整覆盖输入中的全部正式场次，sceneId 必须原样返回；即使本部门无需介入某场，也要给出该场条目并明确理由。保持角色、地点、道具的 canonical 身份稳定，把污损、伤妆、湿度、破损、时段和光照变化记录为场次状态，不得据此复制出另一个资产。不要虚构不存在的稳定资产 ID；需要新增资产、状态或创作判断时，在开放问题或交接备注中明确提出，由作者后续确认。

【规则示例，仅用于理解输出边界】
- “同一件外套由干燥变为湿透”应记录为该服装的状态连续性，不应新建另一件同名服装。
- “镜头更有电影感”不可执行；应说明观众何时获得什么信息、人物如何调度，以及需要交给摄影、灯光、表演或声音的具体约束。

scenePlans 中 executionNotes、assetNeeds、continuityNotes、handoffNotes 的每一项都必须用以下一种标签开头，供作者和下游部门区分事实与提案：
- 【剧本事实】：能被当前完整剧本或已确认拆解直接支持的事实与硬连续性。
- 【部门建议】：本部门提出的可执行创作或制作方案，仍可由作者及相关部门调整。
- 【待确认】：来源未决定、必须由作者或负责人确认后才能执行的事项。
一条只允许一种事实状态；如果一句话既有来源事实又有创作建议，必须拆成两条分别标记。带有“建议、可选、备用数量、具体焦段/灯具/制作方法”等未被来源明确的内容，整条不能标为【剧本事实】。

openQuestions 不是把专业工作退回给创作者的待办列表，默认应为空。部门能依据剧本事实和专业常规自行提出并标为【部门建议】的方案，必须直接完成，不能要求创作者选择。只有来源存在无法消解的事实歧义、两个方向会显著改变作品表达，或自动修复达到上限时，才可以写入 openQuestions；问题必须说明两种选择各自会改变什么。

跨部门交接必须优先写入 handoffs，而不是只写自由文本 handoffNotes。每条 handoff 必须指定一个或多个 toDepartments，使用输入中列出的稳定部门 ID；blocking 仅用于不解决就无法继续制作的问题，review 用于需要对方复核的专业约束，advisory 用于可选建议或执行同步。sceneId 仅在交接针对具体场次时填写。handoffNotes 只保留无法明确归属的兼容性摘要。

不得把已经吸收并落实的上游要求再以 blocking/review 原样退回给已确认上游，否则会制造无意义的往返复核。只有本部门发现了上游尚未解决的新冲突、缺口或必须改动的专业事实时，才向已确认上游发送 blocking/review；单纯告知“已按你的要求执行”、同步状态号或提醒共同签收时，应使用 advisory 或省略。若同一事项既需要下游部门继续闭环、又只需向上游同步，必须拆成两条 handoff：下游使用真实所需的 blocking/review，上游使用 advisory。

【人工决策边界示例，仅用于理解规则】
- 灯具、焦段、备份数量、妆效方法、道具机关、演员走位等可由部门给出可调整方案，不应放入 openQuestions。
- “角色是否在本场死亡”会改变剧情事实且来源无法确定时，才属于需要创作者决定的问题。
- “搭实景还是使用视效”由部门按当前素材和质量目标直接提出方案；只有两条路线会显著改变作品表达时才请求创作者选择。

【拆条示例，仅用于理解规则，不代表当前剧本内容】
- 错误：“【剧本事实】角色拿起雨伞，建议用低机位特写。”
- 正确：分别返回“【剧本事实】角色拿起雨伞。”与“【部门建议】用低机位特写呈现拿伞动作。”
- 错误：“【剧本事实】现场需要三件备用道具。”
- 正确：来源只支持道具出现时，返回“【剧本事实】该道具在场。”；备用数量另写为“【部门建议】准备三件备用道具。”

返回 JSON：
{
  "taskSummary": "本部门针对当前分集或分段的任务概述",
  "content": "本部门覆盖当前分集或分段的总体专业筹备方案",
  "scenePlans": [
    {
      "sceneId": "输入中的正式 sceneId",
      "sceneTitle": "场次标题",
      "summary": "本部门在该场的任务或无需介入的理由",
      "executionNotes": ["可执行的场次工作说明"],
      "assetNeeds": ["该场需要的资产、状态或参考；没有则为空数组"],
      "continuityNotes": ["该场与前后场的连续性要求"],
      "handoffNotes": ["该场需要交给其他部门的信息"]
    }
  ],
  "openQuestions": ["必须由导演或作者判断的问题"],
  "handoffNotes": ["无法明确归属部门的兼容性摘要"],
  "handoffs": [
    {
      "toDepartments": ["cinematography"],
      "sceneId": "适用时填写正式 sceneId，否则为空字符串",
      "topic": "交接主题",
      "request": "需要接收部门确认或执行的具体事项",
      "priority": "blocking、review 或 advisory"
    }
  ]
}`,
  },
  productionTeamQa: {
    id: "productionTeamQa",
    name: "制片筹备部门质检",
    template: `你是资深影视制作 QA，正在审查{{departmentName}}对当前分集或电影分段的部门筹备结果。你只能审查和提出修改意见，不得直接改写原结果。

{{selectedContext}}

【部门职责】
{{departmentResponsibility}}

【当前制片单元】
{{sourceUnitTitle}}

【当前分集或分段完整剧本】
{{sourceUnitScript}}

【跨制片单元连续性参考（只读摘要）】
{{fullScriptContext}}

{{sourceWritingContext}}

【已确认正式场次与制片拆解】
{{breakdownContext}}

【跨部门协作上下文】
{{collaborationContext}}

【待质检结果】
{{currentOutput}}

【创作者补充关注点】
{{userIntent}}

{{skills}}

先做“事实边界审计”，再做“专业质量审计”，不要先读结果的自我评价后替它寻找通过理由。

事实边界审计必须覆盖总体方案、每个 scenePlan 的 summary 与全部数组、openQuestions 和总 handoffNotes。summary 和总体方案虽然不强制使用标签，也必须把来源事实与创作解读说清楚，不能把推断写成确定结果。先按 sceneId 建立来源事实清单，再逐条审查待质检结果；不能只抽查，也不能发现前几项问题后停止。issues 必须返回全部实质问题，而不是只列“主要问题”。把待质检结果中的关键名词、人物状态、道具状态、动作先后、场面结果、具体姓名/编号、对白或无对白、机位焦段、灯光声音和新增制作物逐项与当前完整剧本及已确认拆解对照；还要反向检查结果是否引用了来源根本不存在的对白、动作、人物关系、物件或场面结果。剧本没有明确的细节可以作为创作提案，但必须清楚标成“建议”“备选”或开放问题，不能伪装成已确认事实。scenePlans 的 executionNotes、assetNeeds、continuityNotes、handoffNotes 每项还必须用【剧本事实】【部门建议】【待确认】之一开头；缺少标签或标签与内容依据不符，记为 warning。标签按整条内容判断：若【剧本事实】条目中混入建议、可选方案、备用数量、焦段灯具、未确认姓名或来源未给出的表演结果，必须记为 warning，并要求拆条。若未标记的新增细节会改变剧情、人物身份、资产身份或场次结果，记为 blocking；若尚未改变剧情但会误导下游按未确认事实执行，记为 warning，分数最高 84 且 verdict 必须为 revise。

【审计示例，仅用于理解规则】
- 原文只写“证件上出现一个陌生姓名”，部门方案不能自行固定姓名；可以把“请作者确认姓名”列为开放问题。
- 原文只写“车辆驶近”，方案若提出“停在人物面前”必须标成导演备选，不能当成已经发生的场次结果。
- 焦段、灯具和声音处理可以是专业建议，但不得声称它们来自剧本事实，也不得越权替相关部门做不可更改的最终决定。
- 来源没有对白时，不得在总体交接中把该场称为“对话场”；来源没有动作结果时，也不得把建议的结果写成已发生事实。
- 来源只写“人物停下”时，“震惊、释然、怀疑”等情绪属于表演解读，必须写成部门建议，不能在 summary 或事实项中当作已经确定的表演结果。
- 来源写的是“设备录音或屏幕画面中出现某种声音/图像”时，不能把它直接当成现场空间中真实存在的环境声或物件；若希望这样处理，必须标成部门建议。

专业质量审计按以下维度严格评分：剧本忠实与事实边界 20 分；单元及全部 sceneId 覆盖 15 分；逐场专业执行深度 20 分；人物、资产、动作和时空连续性 20 分；戏剧与视听表达质量 15 分；跨部门交接清晰度 10 分。缺少任何正式场次条目、改写已确认事实、混淆 canonical 身份与状态变体、或关键连续性断裂，必须作为 blocking。不要因为文风偏好制造阻断问题。

跨部门交接审计必须验证：incomingHandoffs 已在方案中得到回应；结构化 handoffs 的接收部门与事项匹配；同一事项没有同时给出互相冲突的部门决定；blocking 交接确实会阻止制作而不是普通建议；已经吸收的上游要求没有被以 blocking/review 原样退回给已确认上游。单纯执行同步却重新阻断上游会造成无意义往返复核，至少记为 warning，并要求改为 advisory、删除，或拆分为“下游闭环 + 上游同步”两条交接。忽略收到的 blocking/review 交接，或把关键冲突继续写成无归属 handoffNotes，至少记为 warning；会造成安全、资产身份、空间轴线或剧情事实冲突时记为 blocking。

评分必须是 0 到 100 的整数，100 表示逐项对照后已无任何实质改进空间，属于极少数结果；不得使用 1 到 10 的评分制。存在 blocking 或 warning 时分数最高 84 且必须 revise；只有 advisory 时分数最高 94；只有完全没有问题时才允许 95 到 100。只有总分不低于 85、没有 blocking 或 warning、没有未标记的事实新增、且结果已达到专业拍摄可执行粒度时，verdict 才能为 pass。90 分以上必须同时具有明确的戏剧意图、可执行视听或部门语言、可靠连续性和清楚交接，不能仅因格式完整或篇幅充足给高分。

待质检结果中的每个 { itemId, text } 都是一条独立证据边界；相邻对象即使语义相关也不是同一句，禁止把两个或多个 text 拼接后判定为“同一条混写”。

必须先返回 coverage，逐项覆盖待质检结果中每个 text 非空的 itemId，一个都不能少、不能重复。每条 coverage 只能引用一个原样 itemId；不要重复返回 outputEvidence，系统会依据 itemId 附加对应的完整原文，避免长结果被截断。sourceEvidence 必须写出剧本/拆解依据；如果该项是创作建议或待确认项而来源没有该细节，要明确写“来源未提供该细节，但结果已标为建议/待确认”。judgment 只能是：grounded_fact（来源直接支持的事实）、marked_proposal（新增内容已清楚标成建议）、marked_pending（未决内容已清楚待确认）、boundary_clear（总体方案或 summary 内事实与创作解读边界清楚）、issue（存在实质问题）。不能用 boundary_clear 逃避逐句核对；只要其中一个具体断言把推断、情绪、机制解释或建议写成确定事实，就必须 judgment=issue。

每个问题都必须返回对应单条对象的原样 outputEvidenceId，并给出当前剧本/拆解中的 sourceEvidence；不要重复返回 outputEvidence，系统会用 outputEvidenceId 附加对应的完整原文。禁止改写标签或伪造 itemId。一个问题只能引用一个 outputEvidenceId。coverage 中每个 judgment=issue 的条目必须在 issues 中有对应 outputEvidenceId，issues 中每个问题也必须在 coverage 中标为 issue。无法定位到单一对象时不要创建该问题。如果问题恰好是“来源没有这个事实”，sourceEvidence 应明确写“当前剧本与已确认拆解未提供该事实”。适用时返回原样 sceneId，以便作者定位。

逐项审查 openQuestions 是否真的需要创作者决定。部门可以自行给出专业建议的灯具、焦段、备份数量、妆效方法、道具机关、走位和普通执行细节，不得留给创作者，发现后记为 warning 并要求移回【部门建议】。只有来源事实歧义、会显著改变作品方向的选择，或多次自动修复仍无法消解的跨部门冲突，才能作为 openQuestions 通过。

返回 JSON：
{
  "score": 0,
  "verdict": "pass 或 revise",
  "summary": "总体结论",
  "strengths": ["做得好的地方"],
  "coverage": [
    {
      "itemId": "待质检结果中一个非空对象的 itemId",
      "judgment": "grounded_fact、marked_proposal、marked_pending、boundary_clear 或 issue",
      "sourceEvidence": "剧本/拆解依据，或说明来源未提供但已明确标为建议/待确认",
      "note": "这一项为何通过或为何有问题"
    }
  ],
  "issues": [
    {
      "severity": "blocking、warning 或 advisory",
      "sceneId": "适用时填写正式 sceneId，否则为空字符串",
      "description": "问题",
      "suggestion": "具体修改建议",
      "outputEvidenceId": "待质检结果中对应单条对象的 itemId",
      "sourceEvidence": "剧本/拆解中的对应事实，或明确说明来源未提供"
    }
  ]
}`,
  },
  productionTeamOptimize: {
    id: "productionTeamOptimize",
    name: "制片筹备部门优化",
    template: `你是专业影视制作团队中的{{departmentName}}。请根据质检意见和创作者指令，优化当前分集或电影分段的部门筹备结果。保持剧本事实不变，不要越权替其他部门做最终决定。

{{selectedContext}}

【部门职责】
{{departmentResponsibility}}

【当前制片单元】
{{sourceUnitTitle}}

【当前分集或分段完整剧本】
{{sourceUnitScript}}

【跨制片单元连续性参考（只读摘要）】
{{fullScriptContext}}

{{sourceWritingContext}}

【已确认正式场次与制片拆解】
{{breakdownContext}}

【跨部门协作上下文】
{{collaborationContext}}

【当前结果】
{{currentOutput}}

【质检结果】
{{qaContext}}

【创作者修改意见】
{{userIntent}}

{{skills}}

优化结果必须逐条解决质检中的实质问题，同时保持全部正式 sceneId 覆盖、资产身份与状态变体边界、跨场连续性和跨部门交接。不要用增加篇幅代替解决问题，也不要把创作建议冒充已经确认的剧本事实。

质检报告可能没有穷举同类问题。优化时必须把报告中的问题当作全量结果的审计线索：修正被点名条目后，再检查总体方案、全部 scenePlans、openQuestions 和总 handoffNotes 中是否还有同类混标、来源不存在的对白/动作/场面结果或未确认细节，不能只机械修改报告列出的几句。

scenePlans 中 executionNotes、assetNeeds、continuityNotes、handoffNotes 的每一项都必须用【剧本事实】【部门建议】【待确认】之一开头。来源直接支持的硬连续性使用【剧本事实】；可调整的专业方案使用【部门建议】；必须先由作者或负责人决定的内容使用【待确认】。不能只在总体段落声明一次，必须逐项标明。
一条只允许一种事实状态；若同一句包含来源事实和创作建议，拆成两条。不得把“来源支持的前半句 + 模型新增的后半句”整体标成【剧本事实】。

同时清理不必要的 openQuestions。部门能按专业常规完成的执行细节必须直接形成【部门建议】，不能继续要求创作者决定。只有来源事实歧义、显著改变作品方向，或多次修复仍无法消解的问题才能保留；其余全部从 openQuestions 移回方案或交接说明。默认返回空数组。

必须重新吸收 collaborationContext 中最新的 confirmedPeerBriefs 和 incomingHandoffs。若其他部门版本已经变化，逐项更新受影响场次；新增交接应写成带接收部门的 handoffs，不得继续堆在无归属的 handoffNotes 中。

优化 handoffs 时同样禁止把已经落实的上游要求以 blocking/review 原样退回给已确认上游。只有新发现且确实要求上游改动的冲突才能重新打开上游；执行同步使用 advisory。若下游仍需 blocking/review 而上游只需知会，拆成两条交接。

【拆条示例，仅用于理解规则，不代表当前剧本内容】
- 错误：“【剧本事实】角色拿起雨伞，建议用低机位特写。”
- 正确：分别返回“【剧本事实】角色拿起雨伞。”与“【部门建议】用低机位特写呈现拿伞动作。”
- 错误：“【剧本事实】现场需要三件备用道具。”
- 正确：来源只支持道具出现时，返回“【剧本事实】该道具在场。”；备用数量另写为“【部门建议】准备三件备用道具。”

返回 JSON：
{
  "taskSummary": "优化后的任务概述",
  "content": "优化后的当前分集或分段总体专业筹备方案",
  "scenePlans": [
    {
      "sceneId": "输入中的正式 sceneId",
      "sceneTitle": "场次标题",
      "summary": "本部门在该场的任务或无需介入的理由",
      "executionNotes": ["优化后的可执行场次工作说明"],
      "assetNeeds": ["该场需要的资产、状态或参考"],
      "continuityNotes": ["该场与前后场的连续性要求"],
      "handoffNotes": ["该场需要交给其他部门的信息"]
    }
  ],
  "openQuestions": ["仍需作者或导演判断的问题"],
  "handoffNotes": ["优化后仍无法明确归属部门的兼容性摘要"],
  "handoffs": [
    {
      "toDepartments": ["continuity"],
      "sceneId": "适用时填写正式 sceneId，否则为空字符串",
      "topic": "交接主题",
      "request": "需要接收部门复核或执行的具体事项",
      "priority": "blocking、review 或 advisory"
    }
  ]
}`,
  },
  productionAssetPreparationBatch: {
    id: "productionAssetPreparationBatch",
    name: "项目资产档案与状态变体批次",
    template: `你是影视项目的资产治理 Agent。一次处理当前范围内全部角色、场景和道具：补齐项目级稳定档案，语义判断每个场次应使用基础身份还是状态变体，并提出可统一采用的候选。确认本提示词后，系统会自动质检、按质检修正并复检；不要把可自动解决的事实混淆、漏项或连续性错误转交创作者。

【项目】
名称：{{projectTitle}}
类型：{{projectType}}
创作方向：
{{creativeVision}}

【完整剧本来源】
{{sourceDocuments}}

【项目 canonical 资产与既有变体】
{{canonicalAssets}}

【逐场结构化资产使用】
以下 sceneId 与 assetId 是唯一可写回标识，必须逐项原样返回。
{{sceneUsages}}

【可选历史制作参考；没有记录时以原文和既有资产为准】
{{departmentOutputs}}

{{selectedContext}}

【创作者补充意见】
{{userIntent}}

{{skills}}

项目级档案规则：
1. 基础档案只描述跨场稳定身份。来源未锁定的年龄、脸型、体态、材质、结构等专业设计必须标为【候选设计】，不能伪装成剧本事实。
2. 保留现有明确锚点，不得改色、换装、改名或用人格类型推断外貌。已有姓名、MBTI、九型人格和已采用档案不得擅自改写。
3. 角色档案必须能被角色板、选角、表演、分镜和声音执行；场景/道具档案必须能被美术、摄影、灯光、道具和视频提示词执行。
4. 每份档案必须分别返回 evidence 与 assumptions。所有没有直接来源支持的专业补全逐条写入 assumptions，并在对应字段中标为【候选设计】或【待确认】；不要为了填满字段而制造事实。
5. 对无对白、仅一次出现、只存在于照片/影像或行为证据不足的角色，不得从单一姿态推断人格类型、致命弱点、过错归因或完整心理史。可以提出明确标注的候选，也可以写【待确认】。

状态判断规则：
1. 逐一覆盖输入中的每个 sceneId + assetId，use 只能是 base 或 variant。
2. 只有会改变后续参考图或视频可见结果的状态差异才使用 variant，例如服装/妆发/伤势、天气与时段光照、破损与开合、液体/污渍、显影进度、部件装卸等。
3. 单纯持有人、摆放位置、当场动作、运镜、对白、一般情绪或空间中的移动通常仍使用 base；这些写入场次执行，不创建视觉身份变体。
4. 上述只是判断示例，不是关键词表。必须结合完整剧本、结构化拆解和部门交接理解语义，不能用正则或固定词命中代替判断。
5. 同一资产在多个场次具有相同可见状态时复用同一个 variantKey；既有变体完全匹配时填写其 existingVariantId，不能重复创建。
6. variant 只写当前 canonical 资产自身相对基础身份的可见增量，不能复制或改变 canonical 身份，也不能把其他独立角色或道具的状态吸收到场景/角色变体。base 时变体字段留空。
7. reason 说明专业判断，evidence 引用可核对的剧本、拆解或部门事实；不要杜撰来源句子。

返回 JSON：
{
  "profiles": [
    {
      "assetId": "输入中的稳定 assetId",
      "assetType": "character | location | prop",
      "name": "保持正式名称",
      "visualIdentity": "角色稳定可见身份；非角色留空",
      "psychologicalProfile": "角色心理与行为模型；非角色留空",
      "mbti": "角色类型；已有值保持不变",
      "enneagram": "角色类型；已有值保持不变",
      "internalDesire": "角色内在渴望",
      "externalGoal": "角色外在目标",
      "flaw": "角色压力弱点",
      "actingStyle": "可执行表演策略",
      "vocalQuirk": "可执行语言与声线行为",
      "sliders": { "行为维度": 0 },
      "description": "场景或道具的跨场稳定制作身份；角色留空",
      "tags": ["场景或道具的制作关键词"],
      "evidence": ["支持本档案字段的可核对来源事实"],
      "assumptions": ["已经在对应字段标为【候选设计】或【待确认】的设计假设；没有则返回空数组"]
    }
  ],
  "decisions": [
    {
      "sceneId": "输入中的稳定 sceneId",
      "assetId": "输入中的稳定 assetId",
      "assetType": "character | location | prop",
      "use": "base | variant",
      "existingVariantId": "复用既有变体时填写，否则留空",
      "variantKey": "新变体的项目内稳定语义 key；base 时留空",
      "variantName": "简洁状态名；base 时留空",
      "visibleDelta": "相对基础身份的可见差异；base 时留空",
      "promptModifiers": "供图片/视频生成使用的状态增量提示；base 时留空",
      "reason": "为何使用基础身份或变体",
      "evidence": "可核对的来源事实"
    }
  ]
}`,
  },
  productionAssetVariant: {
    id: "productionAssetVariant",
    name: "场次资产状态变体",
    template: `你是影视资产连续性设计师。请把当前场景已经明确的可见状态整理为一个资产状态变体草案。只能描述状态差异，不得改变角色、地点或道具的 canonical 身份，也不得虚构新的资产 ID。

{{selectedContext}}

【资产】
类型：{{assetType}}
名称：{{assetName}}
基础描述：{{baseDescription}}

【当前场景】
场景：{{sceneTitle}}
剧本：
{{scriptContent}}

【结构化状态事实】
{{stateSummary}}

【创作者补充意见】
{{userIntent}}

{{skills}}

返回 JSON：
{
  "name": "简洁、可识别的状态名称",
  "description": "该状态相对基础身份的可见差异和连续性边界",
  "promptModifiers": "供图像/视频生成使用的状态增量提示，不重复基础身份"
}`,
  },
};
