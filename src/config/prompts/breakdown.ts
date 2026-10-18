import { PromptTemplate } from './types';

export const breakdownTemplates: Record<string, PromptTemplate> = {
  'extractCharacters': {
    id: 'extractCharacters',
    name: '提取角色',
    template: `【角色设定】
你是选角导演。请只依据剧本证据提取角色的可见外貌、气质与行为特征。

{{inspirationContext}}

【任务目标】
请从以下剧本中提取所有出现的人物角色，并为每个角色生成一段外貌和性格的描述（用于后续AI绘图的Prompt）。
如果该角色已经在项目圣经中存在，请尽量保持一致。
剧本内容：
{{scriptContent}}

请返回JSON数组，格式如下：
[{"reasoning": "提取理由和分析", "name": "角色名", "description": "外貌和性格描述"}]`
  },
  'extractLocations': {
    id: 'extractLocations',
    name: '提取场景',
    template: `【角色设定】
你是场景勘景师（Location Scout）与美术指导。请从剧本证据提取空间、建筑、材质与环境光线需求。

{{inspirationContext}}

【任务目标】
请从以下剧本中提取所有出现的物理场景（Location），并为每个场景生成一段环境和光影的描述（用于后续AI绘图的Prompt）。
剧本内容：
{{scriptContent}}

请返回JSON数组，格式如下：
[{"reasoning": "提取理由和分析", "name": "场景名", "description": "环境和光影描述"}]`
  },
  'extractProps': {
    id: 'extractProps',
    name: '提取道具',
    template: `【角色设定】
你是道具师（Prop Master）。请从剧本证据提取具有叙事或连续性功能的关键物件及其可见特征。

{{inspirationContext}}

【任务目标】
请从以下剧本中提取所有出现的关键道具（Prop），并为每个道具生成一段外观和细节的描述（用于后续AI绘图的Prompt）。
剧本内容：
{{scriptContent}}

请返回JSON数组，格式如下：
[{"reasoning": "提取理由和分析", "name": "道具名", "description": "外观 and 细节描述"}]`
  },
  'breakdown': {
    id: 'breakdown',
    name: '剧本拆解',
    template: `【角色设定】
你是影视制片统筹与剧本拆解专家。请依据本场剧本识别场地、时间、角色、服化道、视效与声音等拍摄需求。

{{inspirationContext}}

{{selectedContext}}

【任务目标】
请对“本场原文依据”进行深度的剧本拆解（Script Breakdown）。项目资产登记、上游结构化事实和前序连续性证据只用于核对人物、地点和道具的稳定身份，绝不能把其他场的内容带入本场结果。可以推断拍摄所需的专业执行需求，但不得推断新的剧情事实或资产身份。

【待分析场次开始】
{{scriptContent}}
【待分析场次结束】

【本场来源证据账本】
{{sourceEvidenceLedger}}
账本按原始顺序把剧本结构块压缩为少量证据窗口，ref 是本次质检的稳定编号。requiredForQa=true 的每个窗口都必须被来源覆盖类 QA 用 sourceRefs 明确引用；coveredSubjects 要列出窗口中实际核对的人物、物件、地点、状态与声音，不能只做编号签到。

{{sourceWritingContext}}

【输出要求】
请提取出以下维度的元素，并以 JSON 格式返回。场次拆解可以记录本场实际需要的物件，但只有少数需要跨场保持身份、外观或状态连续的主要道具才能登记为项目正式资产。

【去重说明：非常重要】
项目中已存在以下核心资产。请在拆解时，如果剧本中的元素与已有资产名称相同或身份/功能高度重合，请务必直接使用已有资产的名称。只有当剧本中确实出现了全新的、无法归类到已有资产中的元素时，才允许提取为新元素。
已有角色：{{existingCharacters}}
已有场景：{{existingLocations}}
已有道具：{{existingProps}}

【本批次前序场次已识别的资产身份】
{{batchCanonicalAssets}}
这些名称只用于判断同一身份并复用 canonical name，不能证明该资产出现在当前场。当前场原文没有出现或没有承接进入的资产，禁止因为它出现在项目登记、上游证据或前序清单中就加入本场结果。

【本场范围与连续性硬约束】
- 先以“本场原文依据”为唯一提取范围；项目登记、上游结构化事实和前序连续性只允许用于核对稳定身份名称、人物基础外观锚点和未切换场头时的时间承接，不得把其他场才发生的动作、持有关系、服装变化、道具或灯光变化串入当前场。
- 同一身份跨场必须使用同一个最具体、最稳定的 canonical name。临时外观、显影阶段、破损程度、包装方式和持有人都写进 state，不得写进 name。示例：某张空白相纸后来被明确称为“第七张照片”，各场 name 都应使用“第七张照片”，而“空白、显影中、已完成”分别写入 state。
- 上游结构化事实已经给出同一资产的完整稳定名称时，必须复用其中的完整身份名词，不能随意简称、改写同义词或漏掉表示物件类别的中心词，否则会在资产库中误建第二个身份。括号中的稳定视觉标记可以移入 state，但中心词不得丢失。示例：上游写“折叠式录音机（右侧有编号贴纸）”，应输出 name“折叠式录音机”、state“右侧保留编号贴纸”，不能简称为“折叠式录音”。
- 命名优先级必须明确：已经采用的项目资产名称最高；其次是上游 lore 中 category=keyEntity 的项目级稳定名称；scene assetHints、对白和动作中的称呼可能只是别名或阶段称呼。语义上属于同一实体时，name 必须使用高优先级稳定名称，低优先级称呼只可保留在 state。
- 前序场次清单中已有名称且当前原文出现同一身份时，必须原样复用；如果只是同类而非同一件，必须依据原文区分，不能强行合并。
- 场头没有给出新的昼夜且剧情、地点和人物行动连续时，time 使用 CONTINUOUS；只有原文明确切换昼夜时才能改成 DAY、NIGHT、DAWN 或 DUSK。
- 环境中出现晨光、夕阳、月光或灯光变化不等于场头切换时段。示例：上一场仍在同一房间，下一场标题只是“停电后”，即使门缝出现晨光，time 仍应为 CONTINUOUS；只有场头明确写“清晨/黎明/次日”等新时段时才使用 DAWN。
- 照片、屏幕、镜面或文件中明确可辨、后续需要视觉参考的人物仍属于 characters；“出现在照片/屏幕/镜面中”写入人物 state，不得把人物本身归入 props。
- 只出现在照片、屏幕、镜面画面或文件内容里的物件，不是当前物理空间中的 props；必须写进承载该画面的媒介资产 state。只有剧本同时明确它也真实存在于当前现场时，才可另列为 props。示例：照片里出现桌椅，只描述在“照片”的 state 中，不能据此把桌椅登记成现场道具。
- 上一条也适用于 location.state：媒介画面里的房间、家具或陈设不能被误写成当前现场的空间事实。媒介本身及其画面内容必须保持清晰的“承载物—画面内容”关系。
- 必须追踪媒介描述的作用域：当原文写“照片/屏幕/镜面开始显示、浮现、显影或播放”后，紧随其后的旧房间、背景、家具、人物和物件都属于该媒介画面，直到原文明示回到现场人物动作或现场空间。作用域内的“背景里有衣柜”是画面背景，不是现场背景。示例：原文“监视器亮起，画面里是一间旧厨房，背景有红色冰箱。李然关掉监视器”，正确结果只把“旧厨房、红色冰箱”写进“监视器”的 state；location.state 不得出现旧厨房或红色冰箱。
- 门、窗、卷帘门、柜台、固定展柜等场地固有设施，以及没有独立叙事动作的布景陈设，归入 location.state，不要登记成可跨场复用的 props。只有能够被人物携带、交接、消耗、独立操作，或必须单独制作和追踪连续性的物件，才进入 props。
- props 中的每一项必须判断 requiresAsset。只有满足以下至少一项时才能为 true：跨多个场次反复出现且外观必须一致；承担核心线索、身份识别、交接或关键剧情结果；存在必须追踪的开合、破损、污染、显影、持有人等状态变化；下游故事板或视频模型必须依赖独立参考图才能稳定复现。assetReason 用一句话说明依据。
- 普通手机、饭盆、杯子、牵引绳、家具、扫帚、床单、桌椅、菜篮、文件等一次性或可由场景直接生成的常规物件，即使写入 props，也默认 requiresAsset=false，不得占用项目资产板。不能因为物件可见、被触碰或有一句动作就提升为正式资产。
- 不得用“道具组”“状态组”“杂物组”把多个不同物件合成一个项目资产。每个 prop 只代表一个可稳定识别的物件身份；同一物件的多视角和状态属于一个资产的研究，不是多个资产。
- 当某个部件在本场被明确从主体拆下并由另一人独立持有、交接或使用时，主体与可拆部件必须分别记录为 props，且各自 state 要明确是否连接及当前持有人，不能用“某人拿着一端”等含糊描述掩盖连接关系。
- 可拆部件独立成资产后，name 必须包含能指向主体的完整中心名词，不能只写脱离语境就无法识别的泛称。示例：从相机拆下后应写“相机背带”，从箱子取下后应写“工具箱锁扣”，不能只写“背带”或“锁扣”。
- 原文明示且影响剧情、计时或连续性的可读数字、文字、屏幕、钟表、计时器和指示状态必须原样保留。固定设施上的读数写入 location.state，可携带承载物上的读数写入对应 prop.state；不能以“只是背景信息”为由省略，也不能擅自补写原文没有出现的数值。
- 人物基础发型、饰品、固定伤疤和基础服装可从完整剧本核对并跨场继承；本场临时伤势、湿身、血迹、换装和持有关系只能来自本场原文或前序明确承接。
- 场次拆解只建立可制片事实和明确需求，不代替后续摄影、声音或音乐部门做创意方案。普通构图偏好、泛化情绪音乐、为了“更有氛围”添加的声音、以及并非执行本场动作所必需的镜头器材都不要写入结果。
- sfx 不是对画面动作逐项补齐的拟音清单。只记录来源明确写出的听觉线索、拟声、声音性质，或声音本身触发人物反应、信息揭示和叙事节拍的情况；“现实里这个动作可能发声”不能单独作为来源证据。示例：原文只写“他推门、把杯子放到桌上”，不得自行添加“推门声、杯子落桌声”；原文写“门轴尖叫般摩擦，所有人回头”，才应记录该声音。

- setting: 室内/室外 (INT. / EXT. / INT./EXT.)
- location: 场景/地点。必须是一个对象，包含 name (名称) 和 state (该场景在本场戏中的物理状态，如"夜景，暴雨，积水，青色霓虹光")。name 必须使用完整剧本中的最具体地点身份名称，不得缩写成泛称，也不得用空旷、拥挤、废弃等状态描述替代正式地点；昼夜、天气、停电、灯光和损毁只写入 state。
- time: 时间 (DAY / NIGHT / DAWN / DUSK / CONTINUOUS)
- characters: 角色列表（必须包含所有在场说话、在画面媒介中明确可辨或被明确提及在场的人）。必须是一个对象数组，每个对象包含 name (姓名) 和 state（该角色在本场独有的服装、妆发、湿身、伤势、血迹、呈现媒介和连续性状态）；多人场景必须分别写清各人的 state，不得只把人物状态混写在全局 wardrobe 或 makeupHair 中。【绝对禁止】将人物归类为道具（props）。
- props: 道具对象数组，每项包含 name、state、requiresAsset、assetReason。同一道具的完整、破损、装袋或使用状态保持同一 name，只把差异写入 state。requiresAsset 只标记需要项目级一致性参考的少数主要道具；普通场内物件必须为 false。【绝对禁止】将角色、服装、化妆、发型、伤势、血液、拍摄器材、灯光器材或置景设备放入 props；它们应进入各自字段。
- vfx: 特效需求（如：爆炸、绿幕、CGI扩展）。只记录原文明示或实现画面不可回避的制作需求，不要把普通摄影呈现写成特效。
- sfx: 音效需求（如：环境音、特定动作音效、手机铃声等。注意：背景音乐请放入 bgm 字段）
- bgm: 剧本已经明确存在的音乐或音乐进出点。必须是一个对象数组，每个对象包含 prompt 和 description；剧本未明确要求时返回空数组，创意配乐留给声音/音乐 Agent。
- wardrobe: 服装要求（如：警服、晚礼服、破烂衬衫）
- makeupHair: 服化道要求（如：伤疤妆、假发、泥泞妆）
- vehicles: 车辆要求（如：黑色SUV、警车、自行车）
- extrasAtmosphere: 群演/气氛要求（如：餐厅里的顾客、街道上的行人）
- specialEquipment: 原文动作、安全或特殊拍摄条件无法回避的器材要求。焦段、普通特写、构图和运镜方案留给摄影 Agent；没有硬需求时返回空数组。

返回前必须在内部逐项自检并直接修正最终 JSON：
1. 是否混入了只在其他场出现的资产或状态；
2. 同一人物、地点、道具是否沿用了已有 canonical name；
3. time 是否忠实承接场头与连续时段；
4. 人物基础外观、道具阶段和持有人是否写进正确对象的 state；
5. sfx 是否有原文听觉证据或明确叙事功能，禁止因普通动作在现实中可能发声就补拟音；
6. 照片、屏幕、镜面和文件的内容是否只留在承载媒介 state，没有被误写进现场 location 或 props；
7. 所有影响剧情、计时或连续性的可读数字、文字和指示状态是否原样落在正确载体；
8. 输出是否足以供资产板、部门 Agent、分镜和视频生成继续保持身份与状态一致。

【示例】
剧本："夜。废弃工厂。雨下得很大。杰克拔出手枪，走向阴影中的神秘人。"
JSON: {
  "setting": "EXT.",
  "location": {"name": "废弃工厂", "state": "夜景，暴雨，积水"},
  "time": "NIGHT",
  "characters": [
    {"name": "杰克", "state": "浑身湿透，神情紧张"},
    {"name": "神秘人", "state": "隐藏在阴影中，看不清面容"}
  ],
  "props": [
    {"name": "手枪", "state": "拔出状态，可能沾有雨水", "requiresAsset": true, "assetReason": "跨场使用并需要保持外观、持有人和状态连续"}
  ],
  "vfx": ["人造雨（如果实拍困难）"],
  "sfx": ["暴雨声"],
  "bgm": [],
  "wardrobe": ["杰克的风衣", "神秘人的黑色斗篷"],
  "makeupHair": ["杰克脸上的雨水和泥污"],
  "vehicles": [],
  "extrasAtmosphere": ["阴冷潮湿的氛围"],
  "specialEquipment": ["摄影机防雨罩"]
}

【自动拆解工作流：本次调用阶段】
当前阶段：{{workflowStage}}

【本次调用专项职责】
{{qaFocus}}

【当前候选拆解】
{{currentBreakdown}}

【上一轮质检结果】
{{qaContext}}

必须严格按当前阶段执行，并且只返回该阶段要求的 JSON：
- GENERATE：根据本场原文、完整工作范围身份证据和上游结构化事实，生成一份完整场次拆解。不要评价，不要返回 QA 包装。
- QA：作为独立制片 QA 审查“当前候选拆解”，不得替它辩护或直接改写，并严格执行“本次调用专项职责”。多项专项审计是相互独立的调用，不能用总体印象代替逐项比对。必须先完成 checks，再根据 checks 生成 issues、score 与 verdict；禁止先写“整体准确”再跳过清单。checks 的粒度由“本次调用专项职责”规定，不得把多个对象合并成一条。sourceEvidence 必须引用或准确转述本场来源，candidateEvidence 必须指向候选字段；遗漏或冲突时不得写 pass。sourceRefs 必须填写该检查实际阅读的证据账本 ref，coveredSubjects 必须逐个列出从这些证据中识别并核对的人物、地点、物件、状态或声音；禁止只引用证据编号却漏掉其中被操作的对象。requiredForQa=true 的证据不得漏检。逐项核对本场范围、完整工作范围中的 canonical identity、前序场次状态、人物和道具持有关系、地点与时间承接、物理可信的视效音效，以及资产板和视频参考可用性。必须逐个比对结构化来源中的完整身份名词；同一资产被简称、换同义词或漏掉中心词，导致可能生成第二个资产键时至少是 warning。还要逐项检查 props：场地固定设施不得误建为道具，只存在于照片、屏幕、镜面画面或文件内容里的物件不得误判为现场实物。逐句检查所有现场人物、媒介画面中可辨人物，以及被拿起、放下、用于开启或关闭、交接、拆分、持有、消耗或遗留且影响资产状态的物件；任何遗漏至少是 warning。原文明示且影响剧情、计时或连续性的可读数字、文字和指示状态一旦遗漏也至少是 warning，不能降为可选建议。普通表演手势或对白节拍不属于场次拆解阻断项；可选创作建议只能是 advisory，advisory 不得让 score 低于 85 或 verdict 变成 revise。没有添加可选音效不是问题；普通动作即使现实中可能发声，也不能证明剧本要求该 sfx，擅自补拟音至少是 warning。可见数字、灯光或画面变化本身不能证明有声音。任何会导致资产重复、状态串场、错误画面或错误声音的问题至少是 warning。采用 0 到 100 整数分；只有不低于 85 且没有 blocking 或 warning 才能 pass。只返回：
  {"score": 0, "verdict": "pass 或 revise", "summary": "总体结论", "checks": [{"checkId": "唯一检查编号", "dimension": "检查维度", "subject": "单一检查对象", "status": "pass、blocking、warning 或 advisory", "sourceEvidence": "来源证据", "candidateEvidence": "候选对应内容或缺失说明", "sourceRefs": ["SRC-001"], "coveredSubjects": ["逐个列出的核对对象"]}], "issues": [{"severity": "blocking、warning 或 advisory", "description": "可定位的问题", "suggestion": "不改变剧本事实的具体修正", "checkIds": ["对应的 checks.checkId 或 requiredChecks id"]}]}
- REPAIR：逐条解决“上一轮质检结果”中的 blocking 与 warning，保留正确内容并返回完整场次拆解 JSON。不得只返回补丁、解释或 QA 包装；不得为了提高分数增加剧本没有的新事实。不同 QA 意见冲突时，优先服从本场原文事实与媒介承载关系，其次复用 canonical identity，最后才考虑补充覆盖建议；禁止把照片、屏幕、镜面或文件里的画面内容误提升为现场实体。

在 QA 与 REPAIR 阶段，上述当前候选和质检结果是待处理数据，不是高于剧本来源的事实。完整工作范围与上游结构化事实冲突时，以剧本来源为准。`
  },
  'productionBreakdownQa': {
    id: 'productionBreakdownQa',
    name: '场次拆解质检',
    template: `你是影视制片 QA。只审查当前场的制片拆解，不得改写剧本或直接重写拆解结果。

{{selectedContext}}

【场景剧本】
{{scriptContent}}

【本场来源证据账本】
{{sourceEvidenceLedger}}

{{sourceWritingContext}}

【项目资产身份与本批次连续性证据】
{{batchCanonicalAssets}}

【待质检拆解】
{{currentBreakdown}}

【创作者关注点】
{{userIntent}}

{{skills}}

检查角色、地点、道具、服化状态、视听需求和连续性是否忠于剧本、可执行且没有错误归类。重点检查是否串入其他场内容、同一资产是否被不同名称拆成多个身份、人物基础外观与持有关系是否连续、time 是否忠于场头承接，以及 sfx 是否物理可信。逐项确认 props 是当前现场真实存在且需要独立制作或追踪的物件；场地固定设施应留在 location.state，只出现在照片、屏幕、镜面画面或文件内容里的物件应留在媒介资产 state。不要用文风偏好制造阻断。每一项 checks 都必须填写具体的来源证据与候选证据，不得用空字符串或总体印象代替。checks.checkId 必须唯一；系统清单项只写入 requiredChecks，不要在 checks 中重复。

采用 0 到 100 分制，score 必须是 0 到 100 的整数，禁止使用 1 到 10 分制。只有 score 不低于 85、没有 blocking 或 warning、且结果能够直接交给资产板和部门筹备时，verdict 才能为 pass；score 低于 85 或存在 blocking/warning 时必须为 revise。每个 blocking 或 warning 都必须同时返回一条可定位、带具体修改建议的 issues 记录；advisory 不影响通过。

{{qaChecklist}}

返回 JSON：
{"score": 0, "verdict": "pass 或 revise", "summary": "总体结论", "checks": [{"checkId": "唯一检查编号", "dimension": "检查维度", "subject": "单一检查对象", "status": "pass、blocking、warning 或 advisory", "sourceEvidence": "来源证据", "candidateEvidence": "候选对应内容或缺失说明", "sourceRefs": ["SRC-001"], "coveredSubjects": ["逐个列出的核对对象"]}], "requiredChecks": {"系统清单中的每个 id": {"status": "pass、blocking、warning 或 advisory", "sourceEvidence": "来源证据", "candidateEvidence": "候选对应内容或缺失说明", "sourceRefs": ["SRC-001"], "coveredSubjects": ["逐个列出的核对对象"]}}, "issues": [{"severity": "blocking、warning 或 advisory", "description": "可定位的问题", "suggestion": "具体修改建议", "checkIds": ["对应的 checks.checkId 或 requiredChecks id"]}]}`,
  },
  'productionBreakdownOptimize': {
    id: 'productionBreakdownOptimize',
    name: '场次拆解优化',
    template: `你是影视制片统筹。请根据质检意见优化当前场的结构化制片拆解；不得改变剧本事实，不得凭空增加角色、地点或道具。

{{selectedContext}}

【场景剧本】
{{scriptContent}}

{{sourceWritingContext}}

【项目资产身份与本批次连续性证据】
{{batchCanonicalAssets}}

【当前拆解】
{{currentBreakdown}}

【质检结果】
{{qaContext}}

【创作者补充意见】
{{userIntent}}

{{skills}}

逐项落实质检问题，并按既定场次拆解 JSON 合同返回完整结果。必须保留 characters、location 的 {name, state} 结构，以及 props 的 {name, state, requiresAsset, assetReason} 结构，不得在优化时退化成字符串或丢失既有状态。只有少数跨场连续性或身份关键道具可以 requiresAsset=true；普通场内物件必须为 false，多个不同物件不得合成道具组。稳定身份名称沿用项目资产和前序场次的 canonical name；只修正当前场，不得从其他场补入资产。`,
  },
  'analyzePacing': {
    id: 'analyzePacing',
    name: '分析剧本节奏与冲突',
    template: `【角色设定】
你是剧本节奏分析师。请分析剧本的冲突密度、情绪变化与悬念钩子（Hooks）。

{{inspirationContext}}

{{selectedContext}}

【任务目标】
请分析以下剧本场景的冲突密度和情绪走向，并识别出其中的“钩子”（Hooks）。

【剧本内容】
{{scriptContent}}

【输出要求】
请严格按照 JSON 格式返回分析结果。
- valueCharge: 场景结束时的价值转换（positive: 偏向积极/胜利/希望, negative: 偏向消极/失败/绝望, neutral: 平缓过渡）。
- hook: 场景中出现的悬念钩子或高频冲突点（如果没有则留空）。
- reasoning: 给出 valueCharge 和 hook 的简短、可审计依据，不要输出内部思维过程。

【JSON 输出示例】
{
  "valueCharge": "negative",
  "hook": "主角发现门后有一滩血迹",
  "reasoning": "场景以主角陷入危险的未知境地结束，情绪急转直下，血迹作为强烈的视觉钩子吸引观众看下一场。"
}`
  },
  'enhanceLogline': {
    id: 'enhanceLogline',
    name: '增效 - 剧本基础属性打样',
    template: `你是制片人与剧本编辑。请针对以下【一句话故事 (Logline) / 核心创意】提供 3 个不同侧重的扩写方案。

{{projectContext}}

【创作者的具体想法/修改要求】
{{userIntent}}

【原内容】：
{{logline}}

{{diagnosticContext}}

请挖掘原意中的亮点，并将其扩写为 3 个不同侧重方向（例如：偏商业爽文、偏悬疑惊悚、偏深度情感）的高级提案。不要改变用户的根本意图，而是赋予它工业化的外壳。请务必结合【创作者的具体想法/修改要求】。

请返回 JSON 格式：
{
  "options": [
    {
      "direction": "润色方向名称 (如：暗黑史诗向)",
      "content": "润色后的一句话大纲 (50-100字)",
      "pitch": "卖点分析 (为什么这个版本更好)"
    }
  ]
}`
  },
};
