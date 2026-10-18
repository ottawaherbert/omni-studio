import { PromptTemplate } from './types';

const sharedLineArtBoardRules = `【通用线稿故事板规则】
1. 输出必须是中文为主的故事板生成提示词。
2. 线稿故事板是控制图，不是最终美术图；重点表达站位、动作方向、镜头运动、视线、道具流转和首尾状态。
3. 必须写明标注图例：红色箭头=身体/动作/道具运动；蓝色箭头=摄影机/画框运动；绿色标记=视线/注意力/取景/构图笔记；橙色标记=灯光方向/能量/冲击/光效；紫色标记=声音/音乐节拍/情绪强调；黑色文字=panel 编号、镜头规格和简短镜头笔记。
4. 不要把角色外貌、场景细节、道具材质全部塞进故事板提示词；外貌和材质交给角色板、场景板、道具板。
5. 每一格应有动作、信息、停顿或承接意义；静止、沉默、等待和长镜头可以是作者的有意安排，不为凑格数增加动作。同一 Shot 的多个动作格不是多个切镜。
6. 必须标注 panel 编号、镜头类型、表演提示、台词/音效提示、首尾状态。`;

export const storyboardVideoTemplates: Record<string, PromptTemplate> = {
  "storyboard.strategy.select": {
    id: "storyboard.strategy.select",
    name: "选择故事板策略",
    template: `你是 AI 视频制片的导演统筹。请根据项目、场景、剧本节拍、模型能力和资产状态，选择最合适的故事板提示词策略。

【候选策略】
{{strategyCatalog}}

【模型能力 Profile】
{{modelProfiles}}

【项目级制作约束】
{{productionMemory}}

【资产连续性】
{{assetContinuity}}

【当前剧本/节拍】
{{performanceContext}}

【作者选择的上下文】
{{selectedContext}}

【本次 Skill】
{{skills}}

【作者补充意见】
{{userIntent}}

【选择原则】
1. 单镜头对白、沉默对视、情绪停顿，不要误选打斗或复杂动作板。
2. 打斗、追逐、跌倒、武器/道具交接，不要误选单张气氛图。
3. 选择的预计视频单元时长不能超过模型 profile。
4. 参考图/参考视频数量不能超过模型 profile。
5. 必须带上本次使用的箭头 legend，至少包含红色动作箭头和蓝色镜头箭头。
6. 必须说明为什么该策略能服务剧情、表演、连续性和模型适配。
7. 先把需求写成 capability ids，再判断一个内置预设能否覆盖；混合场景允许一个主策略加最多两个修饰策略，主策略决定版式，修饰策略只补控制规则。
8. 若仍有 uncoveredCapabilityIds，必须返回 project_local_draft_required 和 fallbackStrategyId，不能临时堆万能 Prompt，也不能反复自动发明策略。
9. 必须遵守 strategyCatalog.compositionRole：modifier 不能作为 selectedStrategyId，primary 不能塞入 modifierStrategyIds；两个完整主版式都必要时应拆分 VideoGenerationUnit。

严格返回 JSON：
{
  "selectedStrategyId": "strategy id",
  "selectedStrategyVersion": "v1",
  "selectedModelProfileId": "model profile id",
  "rationale": "中文选择理由",
  "rejectedStrategyIds": ["未选策略 id"],
  "riskNotes": ["风险"],
  "expectedBoardShape": "例如 3-4 格单镜头表演板",
  "expectedVideoUnitDurationSeconds": 10,
  "expectedReferenceImageCount": 4,
  "expectedReferenceVideoCount": 0,
  "arrowLegendIds": ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
  "qaChecklist": ["本次必须检查的点"],
  "strategyResolution": {
    "mode": "built_in_preset|composed_recipe|project_local_draft_required",
    "primaryStrategyId": "与 selectedStrategyId 相同",
    "modifierStrategyIds": ["最多两个内置策略 id"],
    "requiredCapabilityIds": ["narrative:... 或 control:..."],
    "coveredCapabilityIds": ["已覆盖能力"],
    "uncoveredCapabilityIds": ["仍缺能力"],
    "fallbackStrategyId": "内置安全回退策略 id",
    "confidence": 0.9,
    "requiresHumanApproval": false,
    "maxAutomaticRevisionAttempts": 1
  }
}`,
  },
  "storyboard.board.plan": {
    id: "storyboard.board.plan",
    name: "生成当前视频单元复合故事板",
    template: `你是电影导演、分镜师与 AI 视频控制图设计师。请依据作者已经确认的策略，为当前 VideoGenerationUnit 生成结构化表演节拍和一张多格线稿故事板。这个视频单元可以包含一个或多个已确认 Shot。不能改写剧情事实，不能创造正式资产包之外的人物、地点或道具。

${sharedLineArtBoardRules}

【已确认策略】
{{strategyDecision}}

【策略定义与输出约束】
{{strategyDefinition}}

【当前视频单元/已确认 Shot】
{{shotContext}}

【当前原文、相邻场次与已采用制作结果】
{{filmTeamContext}}

【当前场景正式资产与参考图】
{{assetContext}}

【后续真实画格生成与视觉质检合同】
{{visualPanelContract}}

【上一版质检意见】
{{qaContext}}

【作者选择的上下文】
{{selectedContext}}

【本次 Skill】
{{skills}}

【作者补充意见】
{{userIntent}}

【要求】
1. performanceBeat 只服务当前视频单元绑定的 Shot，不得偷取相邻视频单元的剧情任务。
2. 每个 panel 明确其构图、动作或保持状态及相关摄影、声音和连续性；无变化、无声音或无摄影机运动时如实说明，不机械补动作或拟音。同一 Shot 内的 panel 只描述连续阶段，不新增切镜，不合并或改写不同人物的对白。
3. panel.assetRefs 只能填写输入中已有的正式 canonical asset ID。
4. lineArtPrompt 是一张完整复合故事板控制图的中文图片提示词，必须包含全部 panel 的布局和箭头 legend；最终交付只有整板图片，panel 不独立生成正式图片。
5. panel 数量遵守已确认策略，不按固定格数硬凑。

严格返回 JSON：
{
  "performanceBeat": {
    "scriptBlockIds": ["已有 script block id；没有可为空数组"],
    "beatType": "dialogue|action|combat|emotion|reveal|transition|interactive_idle",
    "summary": "本 Shot 的节拍摘要",
    "visibleChange": "观众可见的变化",
    "startState": "首状态",
    "endState": "尾状态",
    "durationSeconds": 8,
    "characterIds": ["character id"],
    "locationId": "location id",
    "propIds": ["prop id"],
    "soundCues": ["声音提示"],
    "continuityIn": "承接入口",
    "continuityOut": "交接出口"
  },
  "board": {
    "layout": "例如 2x2、3x2；由策略决定",
    "lineArtPrompt": "完整中文线稿故事板生成提示词",
    "startState": "故事板首状态",
    "endState": "故事板尾状态",
    "panels": [
      {
        "durationSeconds": 2,
        "framePurpose": "该格的叙事功能",
        "shotType": "景别",
        "visualBeat": "可见节拍",
        "cameraNote": "机位和摄影说明",
        "framing": "构图",
        "lens": "焦段",
        "angle": "角度",
        "cameraMove": "运镜",
        "subjectAction": "主体物理动作",
        "blocking": "人物/道具调度",
        "lightingCue": "灯光变化",
        "soundCue": "声音或台词提示",
        "emotionCue": "可见表演提示，不写抽象情绪",
        "compositionNote": "画面层次和安全区",
        "continuityIn": "本格入口",
        "continuityOut": "本格出口",
        "assetRefs": ["canonical asset id"],
        "annotationLegendIds": ["legend id"],
        "actionArrowLegendIds": ["legend id"],
        "dialogueOrSoundCue": "对白、停顿或音效",
        "renderInstruction": "线稿绘制指令"
      }
    ]
  }
}`,
  },
  "storyboard.board.qa": {
    id: "storyboard.board.qa",
    name: "质检当前 Shot 视频故事板",
    template: `你是严格但尊重导演创意的故事板质检负责人。只审查，不改写、不生成图片、不调用视频模型。

【当前 Shot】
{{shotContext}}

【已确认策略】
{{strategyDecision}}

【故事板与表演节拍】
{{boardContext}}

【正式资产与连续性】
{{assetContext}}

【当前原文、相邻场次与已采用制作结果】
{{filmTeamContext}}

【作者选择的上下文】
{{selectedContext}}

【本次 Skill】
{{skills}}

【作者补充意见】
{{userIntent}}

【质检维度】
1. 是否忠于 Shot 的剧情任务、时长、画面动作和视觉提示词。
2. panel 是否真的有可见变化，首尾状态和格间动作是否连续。
3. 轴线、视线、屏幕方向、人物站位、道具持有和灯光是否一致。
4. 是否忠实于原文、复用已采用的资产身份，并与相邻场次和已采用镜头的状态一致。不得把缺少部门方案当作问题。
5. 是否只引用正式资产，是否把资产外貌材质错误塞入 lineArtPrompt。
6. 策略、panel 数量、箭头 legend 和模型能力是否匹配。

严格返回 JSON：
{
  "score": 0,
  "verdict": "pass|revise",
  "summary": "总体结论",
  "strengths": ["优点"],
  "issues": [
    {
      "severity": "blocking|warning|advisory",
      "description": "具体问题",
      "suggestion": "可执行修改建议"
    }
  ]
}`,
  },
  "storyboard.panel.visual.rerun": {
    id: "storyboard.panel.visual.rerun",
    name: "Legacy 单格诊断草图（非正式故事板）",
    template: `仅用于旧项目迁移或整板问题定位。输出不得标记为 StoryboardBoard 正式成品，不得进入视频生成输入包；正式修订必须返回一张完整复合故事板。

{{visualPrompt}}

{{userIntent}}`,
  },
  "storyboard.shots.qa": {
    id: "storyboard.shots.qa",
    name: "质检 Shot 与视觉提示词",
    template: `你是导演、摄影指导、场记和 AI 视觉提示词质检负责人。只审查当前场景已经生成的 Shot、图片提示词和视频提示词，不直接修改内容，不生成图片或视频。

【剧本与 Shot】
{{shotPlanContext}}

【当前原文、相邻场次与已采用制作结果】
{{filmTeamContext}}

【正式资产与当前状态】
{{assetContext}}

【作者选择的上下文】
{{selectedContext}}

【本次 Skill】
{{skills}}

【作者补充意见】
{{userIntent}}

【质检要求】
1. 检查 Shot 是否完整覆盖剧本事件和可见表演，不按字数或固定镜头数凑时长。
2. 检查景别、角度、运镜、焦段、构图、调度和时长是否服务叙事，是否存在无意义重复。
3. 检查轴线、视线、屏幕方向、动作顺接、人物站位、道具持有和灯光连续性。
4. 检查每个 Shot 的 character/location/prop ID 是否来自正式资产包。
5. 检查 imagePrompt 和 videoPrompt 是否忠实继承 Shot，是否包含可执行动作、构图、运镜、首尾变化和资产锚点。
6. 不能因为个人风格偏好制造 blocking；blocking 只用于事实错误、连续性断裂、资产越界或无法生成的关键缺失。

严格返回 JSON：
{
  "score": 0,
  "verdict": "pass|revise",
  "summary": "总体结论",
  "strengths": ["优点"],
  "issues": [
    {
      "severity": "blocking|warning|advisory",
      "targetShotId": "shot id，可为空",
      "description": "具体问题",
      "suggestion": "可执行修改建议"
    }
  ]
}`,
  },
  "storyboard.board.singleShotDialogue": {
    id: "storyboard.board.singleShotDialogue",
    name: "单镜头对白表演板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张单镜头对白/表演线稿故事板。它通常对应一个 6-12 秒的视频生成单元，重点不是切镜头，而是表演变化。

【输入】
{{boardContext}}

【输出要求】
- 3-4 格关键帧：起始对峙、中段台词/微动作、反应变化、结束状态。
- 固定轴线和角色屏幕位置。
- 标注台词起止、停顿、呼吸、眼神落点、手部/道具微动作。
- 明确首帧和尾帧，保证能接上一段/下一段。
`,
  },
  "storyboard.board.dialogueBlocking": {
    id: "storyboard.board.dialogueBlocking",
    name: "对白站位调度板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张对白站位调度线稿故事板，适合双人/多人对峙、权力关系变化、道具交接。

【输入】
{{boardContext}}

【输出要求】
- 4-6 格，标清角色在画面左/右/前/后的位置。
- 用绿色箭头标注视线和注意力变化。
- 用红色箭头标注人物移动、转身、伸手、道具交接。
- 用蓝色箭头标注推、拉、摇、移、跟拍等镜头运动。
- 每格必须说明关系、信息或权力状态发生了什么变化。
`,
  },
  "storyboard.board.multiShotNarrative": {
    id: "storyboard.board.multiShotNarrative",
    name: "多镜头剧情推进板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张多镜头剧情推进线稿故事板，适合一个视频单元内包含 2-5 个镜头节拍的普通剧情段落。

【输入】
{{boardContext}}

【输出要求】
- 6-9 格，覆盖开端、动作、反应、揭示、尾状态。
- 标注每格的镜头类型、切换动机、角色位置、道具状态。
- 明确哪几格属于同一个 shot，哪几格是镜头切换。
- 不能让一个视频单元偷走相邻场景的剧情任务。
`,
  },
  "storyboard.board.spatialGeography": {
    id: "storyboard.board.spatialGeography",
    name: "空间建立与调度板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张空间建立与调度线稿故事板。它用于先讲清人物、出入口、障碍、行动路线和轴线，再让后续镜头在同一个空间事实里工作。

【输入】
{{boardContext}}

【输出要求】
- 4-8 格，至少包含空间建立、主要人物初始站位、关键移动路线和尾状态。
- 需要时加入简化平面/拓扑小区，但不得把整张板变成美术场景板。
- 用绿色标注构图、视线和空间关系，用红色标注人物/道具路线，用蓝色标注摄影机位置与运动。
- 所有出入口、障碍物、屏幕方向和人物位置必须能被后续 panel 继承。
`,
  },
  "storyboard.board.montageCompression": {
    id: "storyboard.board.montageCompression",
    name: "蒙太奇与时间压缩板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张蒙太奇与时间压缩线稿故事板，用视觉或声音母题把跨时间、跨地点的阶段性进展压缩成一个可理解的视频单元。

【输入】
{{boardContext}}

【输出要求】
- 6-12 格，每格必须带来阶段进展，不能只是同一动作换背景。
- 标清时间/地点跳跃、共同视觉母题、声音桥和起止状态。
- 用紫色标注节拍/声音连接，用绿色标注重复构图母题，用红蓝箭头标注关键动作与镜头方向。
- 实时连续动作不能被错误省略；若因果必须连续，应改用动作连续板。
`,
  },
  "storyboard.board.proceduralInsert": {
    id: "storyboard.board.proceduralInsert",
    name: "程序动作与道具细节板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张程序动作与道具细节线稿故事板，适合开锁、配药、组装、检验证据或设备操作等步骤敏感的内容。

【输入】
{{boardContext}}

【输出要求】
- 4-10 格，严格按输入步骤排序，标明手、道具、部件和状态变化。
- 插入特写必须能回到操作者和空间主镜头，不产生手、方向或道具跳变。
- 用红色标注手与部件运动，用绿色标注观察点/读数位置，用蓝色标注主镜头与插入特写的切换。
- 结尾格必须能验证完成、失败或未完成状态。
`,
  },
  "storyboard.board.parallelIntercut": {
    id: "storyboard.board.parallelIntercut",
    name: "平行交叉剪辑板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张平行交叉剪辑线稿故事板，让两条或多条行动线在一张板上保持各自连续，同时通过共同时间点、声音桥或因果事件交替推进。

【输入】
{{boardContext}}

【输出要求】
- 6-12 格，用分栏、边框或稳定色标区分行动线，不得混淆角色和地点。
- 每次切换都要说明信息增量、压力增量或因果联系。
- 标出共同时间点、倒计时、声音桥或事件同步点。
- 各行动线的首尾状态分别闭合；模型不支持多镜头时必须拆成多个视频单元。
`,
  },
  "storyboard.board.subjectiveSuspense": {
    id: "storyboard.board.subjectiveSuspense",
    name: "主观视角与悬念信息板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张主观视角与悬念信息线稿故事板，控制谁在看、观众知道什么、什么被遮挡，以及声音和画外空间如何制造压力。

【输入】
{{boardContext}}

【输出要求】
- 4-8 格，逐格标清主观视角拥有者、客观现实锚点和观众信息变化。
- 用绿色标注视线、遮挡和画框内外关系，用紫色标注画外声音/声音先行，用蓝色标注 POV 或主客观切换。
- 隐藏信息必须公平，不能靠突然改写空间、人物身份或道具状态制造悬念。
- 梦境、记忆或错觉必须在尾部保留现实锚点，避免污染 canonical 资产事实。
`,
  },
  "storyboard.board.actionContinuity": {
    id: "storyboard.board.actionContinuity",
    name: "动作连续板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张动作连续线稿故事板，适合追逐、跌倒、拔剑、转身、爆发和 match-on-action。

【输入】
{{boardContext}}

【输出要求】
- 8-12 格，动作方向必须连续。
- 用红色箭头标注身体、武器、道具和重心方向。
- 用蓝色箭头标注摄影机跟拍、推拉摇移。
- 标注动作承接点、受力点、道具所在手、屏幕方向。
- 尾帧必须能自然接下一段。
`,
  },
  "storyboard.board.aiVideoControl": {
    id: "storyboard.board.aiVideoControl",
    name: "AI 视频控制故事板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张 AI 视频控制线稿故事板，重点是让视频模型同时理解主题内容、场景关系、景别、摄影机运动、灯光变化、声音/情绪和首尾状态。

【输入】
{{boardContext}}

【输出要求】
- 8-12 格，必须保持草图/控制图属性，不要做最终美术图；画幅由执行层结构化参数控制，不在图片提示词中重复比例。
- 每格必须标注：panel 编号、景别/镜头规格、主体动作、摄影机运动、灯光方向、声音/情绪提示、连续性 in/out。
- 使用红/蓝/绿/橙/紫/黑标注体系，且在画面中保留 legend。
- 背景只画足以说明空间和景别关系的线索；资产外貌、材质和身份细节交给 AssetReferencePack。
- 如果该段有部门 prep refs，镜头、灯光、表演和动作标注必须继承这些专业约束。
`,
  },
  "storyboard.board.fightChoreography": {
    id: "storyboard.board.fightChoreography",
    name: "打斗/仙术动作板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张打斗/仙术/武器交锋线稿故事板，适合多段攻防、闪避、受击、反击和能量对撞。

【输入】
{{boardContext}}

【输出要求】
- 12-16 格，标注攻防顺序、距离变化、受击反馈和反击起点。
- 红色箭头标注角色/武器运动；橙色箭头标注法术、冲击、能量方向。
- 保持 180 度轴线，若故意破坏必须标注动机和承接点。
- 角色不能瞬移，道具/武器不能凭空换手。
`,
  },
  "storyboard.board.danceChoreography": {
    id: "storyboard.board.danceChoreography",
    name: "舞蹈/肢体节奏板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张舞蹈/肢体节奏线稿故事板，适合街舞、霹雳舞、舞台动作、训练动作或强节奏身体表演。

【输入】
{{boardContext}}

【输出要求】
- 12-20 格，禁止静态站姿灌水，每格都必须有身体动能、重心变化或姿态承接。
- 用红色箭头表达身体、四肢、衣物、道具的运动轨迹；用蓝色箭头表达跟拍、环绕、推拉、快速平移。
- 用紫色标注音乐节拍、重音、停顿或情绪爆点；必要时用橙色标注舞台光/窗光/闪光变化。
- 可以包含 headspin、地板动作、滑步、跳跃、极端平衡、最终定格，但必须保持身体结构可读。
- 背景只保留空间透视、障碍物和安全区；视觉焦点始终在动作连续性。
`,
  },
  "storyboard.board.rhythmSheet": {
    id: "storyboard.board.rhythmSheet",
    name: "分镜节奏表",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张分镜节奏表，用于复杂动作、音乐、VFX 或高密度镜头的导演预演。

【输入】
{{boardContext}}

【输出要求】
- 16-24 格，panel 上方写镜头编号、焦段/景别/角度/镜头运动；底部保留节奏轨道。
- 底部节奏轨至少包含：镜头轨、动作轨、声音/节拍轨、灯光/光效轨、状态变化轨。
- 每格要能对应一个清楚的动作或镜头承接点，不能只重复姿态。
- 用黑色文字做镜头笔记，用红/蓝/橙/紫标明动作、镜头、灯光和声音变化。
- 这张图是分镜节奏和视频单元拆分依据，不是最终效果图。
`,
  },
  "storyboard.board.emotionalReaction": {
    id: "storyboard.board.emotionalReaction",
    name: "情绪反应表演板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张情绪反应线稿故事板，适合沉默、关系裂变、道侣情感、无对白反应和内心变化外化。

【输入】
{{boardContext}}

【输出要求】
- 3-5 格，动作少但必须有可见表演变化。
- 把抽象情绪翻译成眼神落点、下颌、肩膀、手指、呼吸、停顿、身体重心。
- 标注声音留白、环境声、台词前后停顿。
- 不允许只写“悲伤”“愤怒”“感动”等抽象词。
`,
  },
  "storyboard.board.emotionalPerformance": {
    id: "storyboard.board.emotionalPerformance",
    name: "情绪表演推进板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张情绪表演推进线稿故事板，适合情绪变化、沉默停顿、关系裂变和演员表演指导。

【输入】
{{boardContext}}

【输出要求】
- 3-5 格，镜头可以少，但每格必须有可见的表演变化。
- 把抽象情绪翻译成眼神、下颌、肩膀、手指、呼吸、站姿、重心、停顿和微动作。
- 用绿色标注意力/视线变化，用紫色标注声音留白、音乐入点、台词重音或沉默。
- 明确首帧情绪、转折瞬间和尾帧情绪状态，保证能接后续视频单元。
- 不允许只写“伤心、震惊、释然”等抽象词。
`,
  },
  "storyboard.board.revealTwist": {
    id: "storyboard.board.revealTwist",
    name: "揭示/反转/付费钩子板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张揭示/反转/付费钩子线稿故事板，适合证据露出、身份反转、结尾悬念和观众信息更新。

【输入】
{{boardContext}}

【输出要求】
- 4-8 格，严格控制观众看到信息的顺序。
- 标注证据/道具/表情/反应的可见位置。
- 结尾格必须形成明确牵引，不提前解释完下一段。
- 保证角色反应与已知信息一致。
`,
  },
  "storyboard.board.effectReveal": {
    id: "storyboard.board.effectReveal",
    name: "效果揭示板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张效果揭示线稿故事板，适合法术、灵纹、发光道具、爆炸、变身、空间异常、屏幕特效或 SFX/VFX 状态显现。

【输入】
{{boardContext}}

【输出要求】
- 4-8 格，必须清楚表达效果从无到有、增强、影响人物/物体、收束或留下尾状态。
- 用橙色标注光源方向、能量扩散、冲击范围和 VFX 阶段；用紫色标注声音、音乐和情绪强调。
- 每格说明效果影响了哪些角色、道具、场景状态或连续性事实。
- 不得因为效果变强而改变角色身份、服装、道具归属或场景结构。
- 尾帧必须能接下一段或进入媒体生成计划。
`,
  },
  "storyboard.board.transitionBridge": {
    id: "storyboard.board.transitionBridge",
    name: "首尾帧转场桥接板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张首尾帧转场桥接线稿故事板，适合两个视频生成单元之间的连续性衔接。

【输入】
{{boardContext}}

【输出要求】
- 2-4 格，重点是上一段尾帧和下一段首帧。
- 标注角色位置、运动方向、光线方向、道具状态和镜头运动。
- 不改变角色服装、伤势、道具归属和地点状态。
- 说明桥接方式：动作桥接、视线桥接、道具桥接、光线桥接或声音桥接。
`,
  },
  "storyboard.board.interactiveIdleLoop": {
    id: "storyboard.board.interactiveIdleLoop",
    name: "互动待机循环板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张互动影视节点待机循环线稿故事板，适合等待玩家选择、UI 安全区和默认超时动作。

【输入】
{{boardContext}}

【输出要求】
- 首尾帧必须可循环，不能产生明显跳变。
- 标注 UI 安全区，主体不能被选择按钮遮挡。
- 角色只能做等待微动作，不能替玩家提前做未选择事件。
- 标注默认超时选择如何从待机动作自然承接。
`,
  },
  "storyboard.board.interactiveUiSafe": {
    id: "storyboard.board.interactiveUiSafe",
    name: "互动 UI 安全故事板",
    template: `${sharedLineArtBoardRules}

【任务】
生成一张互动 UI 安全线稿故事板，适合互动影视或游戏节点中的选择按钮、状态 UI、提示卡、触控热区和默认超时动作。

【输入】
{{boardContext}}

【输出要求】
- 4-8 格，必须标注 UI 安全区、主体表演区、选择按钮/提示卡区域和触控热区。
- 角色在玩家选择前只能做等待、观察、呼吸、轻微移动等不替玩家决策的动作。
- 用绿色标注构图和 UI 安全区，用蓝色标注镜头或画框运动，用紫色标注提示音/反馈音。
- 必须说明每个选择会影响的变量、结局路径或下一节点承接。
- 首尾状态要能支持循环等待或安全进入分支。
`,
  },
  "storyboard.performanceBeats.plan": {
    id: "storyboard.performanceBeats.plan",
    name: "视频故事板表演节拍计划",
    template: `你是短剧/影视 AI 视频故事板统筹。请把当前场景的 scriptBlocks 切成可用于线稿故事板和视频生成单元的 performanceBeats。

【输入】
{{scriptContext}}

【要求】
1. 每个 beat 对应一个短时可生成片段，具体时长必须服从后续 VideoModelProfile。
2. 每个 beat 必须有 startState、endState、visibleChange、continuityIn、continuityOut。
3. 对白、动作、停顿、声音、道具状态都要拆成可见节拍，不能只写抽象情绪。
4. 只引用已有角色/地点/道具 canonical id；新变体需求写入备注，不要创建重复资产。

严格返回 JSON：
{
  "performanceBeats": [
    {
      "id": "beat id",
      "episodeId": "episode id",
      "sceneId": "scene id",
      "scriptBlockIds": ["script block id"],
      "beatType": "dialogue|action|combat|emotion|reveal|transition|interactive_idle",
      "summary": "这一段发生什么",
      "visibleChange": "观众能看到的变化",
      "startState": "首状态",
      "endState": "尾状态",
      "durationSeconds": 10,
      "characterIds": ["character id"],
      "locationId": "location id",
      "propIds": ["prop id"],
      "dialogueLineCount": 2,
      "actionBeatCount": 0,
      "combatBeatCount": 0,
      "emotionalBeatCount": 1,
      "soundCues": ["风声", "钟声"],
      "continuityIn": "从上一段如何接入",
      "continuityOut": "如何接下一段"
    }
  ]
}`,
  },
  "storyboard.assetReferencePack.plan": {
    id: "storyboard.assetReferencePack.plan",
    name: "视频资产参考包计划",
    template: `你是 AI 视频资产统筹。请为一个故事板/视频生成单元整理 AssetReferencePack，优先从 SceneVisualPack 投影模型输入，明确角色板、场景板、道具板、变体板和首尾帧参考。

【输入】
{{assetContinuityContext}}

【要求】
1. 不把角色外貌、场景材质、道具细节塞进视频长 prompt；这些信息进入 reference pack。
2. 参考图/参考视频数量必须服从所选 VideoModelProfile。
3. 资产身份不变时复用 canonical id；服装、伤势、妆造、道具状态变化时引用 variantId。
4. required=true 的核心资产应有 referenceImageUrl 或 referenceAssetId；没有则记录为待补齐风险。
5. 如果已有 SceneVisualPack，必须填写 sceneVisualPackId，并基于该 pack 的 referenceSlots 投影，不得从全项目资产池任意抓取。
6. modelInputFingerprint 只描述模型输入差异，不能反向改变 SceneVisualPack 的 visualFingerprint。

严格返回 JSON：
{
  "assetReferencePack": {
    "id": "pack id",
    "episodeId": "episode id",
    "sceneId": "scene id",
    "sceneVisualPackId": "scene visual pack id",
    "modelInputFingerprint": "model input fingerprint",
    "modelProfileId": "video model profile id",
    "purpose": "这个参考包服务哪段视频",
    "maxReferenceImages": 9,
    "maxReferenceVideos": 3,
    "packagingNotes": "如何避免提示词污染",
    "items": [
      {
        "assetId": "asset id",
        "assetType": "character|location|prop|style|frame",
        "variantId": "variant id",
        "referenceAssetId": "operator asset id",
        "referenceImageUrl": "local or remote image url",
        "roleInUnit": "主角/场景/关键道具/首帧/尾帧",
        "required": true
      }
    ]
  }
}`,
  },
  "storyboard.sceneVisualPack.plan": {
    id: "storyboard.sceneVisualPack.plan",
    name: "场景视觉包计划",
    template: `你是影视片场美术统筹和连续性场记。请在 asset_sync 阶段为当前场创建或复用 SceneVisualPack。

【输入】
{{sceneVisualPackContext}}

【要求】
1. SceneVisualPack 只包含当前场真正可见或会影响连续性的角色、地点、道具、服化道、场景布置和状态变化。
2. 基础角色板、场景板、道具板来自 asset_board_plan；不要因为某场戏出现资产就重新创建基础资产。
3. 相同 visualFingerprint 的多场戏必须复用同一个 pack，并记录 linkedSceneIds。
4. 换装、妆发、伤势、血迹、道具破损、场景损毁、关键光线或时间变化必须通过已有 variantId 表达；没有 variant 时记录为 QA 风险。
5. visualFingerprint 是模型无关的视觉事实，不包含模型 profile、参考图数量上限或首尾帧策略。
6. referenceSlots 是后续故事板和 AssetReferencePack 的参考槽位，不是最终视频 prompt。

严格返回 JSON：
{
  "sceneVisualPack": {
    "id": "scene visual pack id",
    "projectId": "project id",
    "episodeId": "episode id",
    "sourceSceneIds": ["scene id"],
    "linkedSceneIds": ["scene id"],
    "baseAssetBoardPlanId": "asset board plan id",
    "visualFingerprint": "model independent visual fingerprint",
    "reuseOfPackId": "optional reused pack id",
    "location": {
      "assetId": "location asset id",
      "variantId": "optional variant id",
      "setDressingState": "当前布景/陈设/损毁状态",
      "timeOfDay": "DAY|NIGHT|DAWN|DUSK|CONTINUOUS",
      "weather": "天气，如无则省略",
      "lightingState": "当前光线状态",
      "damageState": "地点损毁或状态变化"
    },
    "characters": [
      {
        "characterId": "character id",
        "variantId": "optional variant id",
        "costumeState": "服装状态",
        "makeupState": "妆容状态",
        "hairState": "发型状态",
        "injuryState": "伤势/血迹/战损状态",
        "emotionalBaseline": "本场入场情绪基准"
      }
    ],
    "props": [
      {
        "assetId": "prop asset id",
        "variantId": "optional variant id",
        "ownerCharacterId": "持有者角色 id",
        "usageState": "本场使用方式和状态",
        "continuityState": "承接/输出状态"
      }
    ],
    "referenceSlots": [
      {
        "slotId": "reference slot id",
        "assetId": "asset id",
        "variantId": "optional variant id",
        "boardItemId": "asset_board_plan item id",
        "referenceImageUrl": "optional reference image url",
        "purpose": "identity|costume|set|prop|state|continuity",
        "priority": 10
      }
    ],
    "continuityIn": "从上一场如何接入",
    "continuityOut": "如何接下一场",
    "qaChecklist": ["本场资产无冗余", "复用判断正确", "variant 引用存在"]
  }
}`,
  },
  "storyboard.videoGenerationUnit.plan": {
    id: "storyboard.videoGenerationUnit.plan",
    name: "视频生成单元计划",
    template: `你是 AI 视频制片调度。请基于 performanceBeats、StoryboardBoard、AssetReferencePack 和 VideoModelProfile 生成 VideoGenerationUnit。

【输入】
{{videoUnitContext}}

【要求】
1. 一个 VideoGenerationUnit 是一次视频模型调用的生产包，可以包含一个 shot，也可以包含多个 shot/beat。
2. durationSeconds 必须符合所选 VideoModelProfile，不允许硬编码 10 秒或 15 秒。
3. 必须绑定 storyboardBoardId、assetReferencePackId、performanceBeatIds、startState、endState。
4. 输出完整的视频生成参数；计划通过就绪检查后可直接进入生成。
5. videoPrompt 必须简洁，动作、构图、首尾状态、声音清楚；资产外貌细节交给 AssetReferencePack。

严格返回 JSON：
{
  "videoGenerationUnit": {
    "id": "unit id",
    "episodeId": "episode id",
    "sceneId": "scene id",
    "modelProfileId": "video model profile id",
    "durationSeconds": 10,
    "performanceBeatIds": ["beat id"],
    "storyboardBoardId": "board id",
    "assetReferencePackId": "pack id",
    "shotIds": ["shot id"],
    "startState": "首状态",
    "endState": "尾状态",
    "previousUnitId": "previous unit id",
    "nextUnitId": "next unit id",
    "promptTemplateId": "video prompt template id",
    "videoPrompt": "中文视频提示词",
    "audioPlan": "对白/音效/环境声",
  }
}`,
  },
};
