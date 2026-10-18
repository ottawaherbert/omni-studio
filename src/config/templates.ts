export interface BeatTemplate {
  id: string;
  name: string;
  description: string;
  instruction: string;
  fixedCount?: number;
  applicableFormats?: string[];
  applicableStages?: Array<"skeleton" | "beat" | "scene">;
  createdForProjectType?: string;
  createdForProjectModel?: "linear" | "interactive";
  referenceWork?: string;
  referenceDnaRelation?: "hard" | "soft" | "disabled" | "unspecified";
  outputSchemaSummary?: string;
  variables?: string[];
  topicKeywords?: string[];
  createdAt?: number;
}

export interface FormatTemplates {
  skeletons: BeatTemplate[];
  beats: BeatTemplate[];
  sceneTemplates: BeatTemplate[];
}

export const GENERAL_FORMAT_TEMPLATES: FormatTemplates = {
  skeletons: [{ id: "open-structure", name: "按作品内容组织", description: "不预设幕数或戏剧结构。", instruction: "按作者意图和可用材料组织段落或分集；观察、声音、记录、叙事与互动内容均可，不强制冲突、转折或钩子。" }],
  beats: [{ id: "open-rhythm", name: "按内容安排节奏", description: "不预设节拍数量或变化频率。", instruction: "按内容、表演、观察、声音和停顿安排节奏。没有节拍表时不必补造。" }],
  sceneTemplates: [{ id: "open-scenes", name: "按实际场景拆分", description: "以实际地点、时间和内容为依据。", instruction: "按实际场景边界拆分，保留作者需要的连续过程；场景数由内容决定，不按时长或字数套公式。" }],
};

export const FORMAT_ROUTING: Record<string, FormatTemplates> = {
  "single-work": GENERAL_FORMAT_TEMPLATES,
  "series-work": GENERAL_FORMAT_TEMPLATES,
  "movie": {
    skeletons: [
      {
        id: 'skel-movie-8seq',
        name: '8段落法 (8-Sequence)',
        description: '最经典的商业片骨架，将电影分为8个10-15分钟的段落。',
        instruction: '请严格按照标准的“8段落法 (8-Sequence Structure)”为骨架来规划这几个段落。每个段落代表一个完整的小叙事单元，包含明确的起点和终点。',
        fixedCount: 8
      },
      {
        id: 'skel-movie-3act',
        name: '经典三幕剧 (3-Act)',
        description: '最基础的戏剧结构，分为建置、对抗、结局三个大块。',
        instruction: '请严格按照经典三幕剧结构（建置、对抗、结局）为骨架来规划段落，确保包含关键情节点（Inciting Incident, Plot Point 1, Midpoint, Plot Point 2, Climax）。',
        fixedCount: 3
      },
      {
        id: 'skel-movie-5act',
        name: '莎翁五幕剧 (5-Act)',
        description: '适合悲剧、史诗或结构复杂的电影。',
        instruction: '请按照古典五幕剧（交代背景、上升动作、高潮、下降动作、结局）为骨架来规划段落。',
        fixedCount: 5
      },
      {
        id: 'skel-movie-4act',
        name: '起承转合 (4-Act)',
        description: '东亚叙事核心，强调内部突变和余韵，适合生活流或文艺片。',
        instruction: '请按照“起承转合 (Kishōtenketsu)”为骨架来规划段落。不强调激烈的外部冲突，而是侧重于“转”的内部突变和“合”的余韵。',
        fixedCount: 4
      }
    ],
    beats: [
      {
        id: 'beat-save-the-cat',
        name: '《救猫咪》15节拍',
        description: '商业片最强节拍器，适合大多数电影。',
        instruction: '请将布莱克·斯奈德的《救猫咪》15个节拍作为内部特征映射到骨架中。例如：开场画面、主题呈现、铺垫、触发事件、辩论、第二幕衔接点、B故事、游戏时间、中点、坏人逼近、失去一切、灵魂黑夜、第三幕衔接点、结局、终场画面。每个段落必须明确标注其包含的救猫咪节拍。'
      },
      {
        id: 'beat-heros-journey',
        name: '英雄之旅 (12步)',
        description: '基于神话学的经典叙事结构，适合奇幻、冒险、成长类故事。',
        instruction: '请将克里斯托弗·沃格勒的《英雄之旅》12个阶段（正常世界、冒险召唤、拒接召唤、遇上导师、跨越第一道边界、考验/盟友/敌人、接近深水区、严峻考验、获得奖赏、回去的路、复活、满载而归）作为内部特征映射到骨架中。'
      },
      {
        id: 'beat-story-circle',
        name: '丹·哈蒙故事圈 (8步)',
        description: '适合角色驱动的故事，强调主角的心理与物理旅程。',
        instruction: '请将丹·哈蒙的故事圈（舒适区、需求、进入陌生世界、适应、得到所需、付出代价、回归、改变）作为内部特征映射到骨架中。'
      },
      {
        id: 'beat-truby-22',
        name: '特鲁比的22个步骤',
        description: '《救猫咪》进阶版，关注角色道德缺陷和对手网络，适合复杂群像。',
        instruction: '请将约翰·特鲁比的22个故事步骤作为内部特征映射到骨架中。极度关注角色的道德缺陷、对手的网络关系以及主题的揭示。'
      },
      {
        id: 'beat-general',
        name: '通用演进 (General)',
        description: '不套用特定节拍，根据骨架自然发展。',
        instruction: '请根据骨架的自然逻辑进行演进，确保每个段落有清晰的因果关系（因为...所以...但是...），稳步完成叙事任务。'
      }
    ],
    sceneTemplates: [
      {
        id: 'seq-general',
        name: '通用叙事演进 (General Progression)',
        description: '最常用的默认模板。根据当前段落的宏观定位（如：开场、中点、高潮），自然地拆解出符合逻辑的场景。',
        instruction: '请根据本段落的宏观定位和梗概，自然地将其拆解为多个场景。不需要生搬硬套特定的动作或悬疑模板，只需确保场景之间有清晰的因果关系（因为...所以...但是...），并稳步完成本段落的叙事任务。'
      },
      {
        id: 'seq-action',
        name: '动作/追逐段落 (Action/Chase)',
        description: '适合高强度的动作戏、追车戏、逃生戏。',
        instruction: '请按照动作段落结构拆解场景：1. 明确目标与障碍 2. 遭遇战/追逐开始 3. 危机升级（障碍变大） 4. 绝境与反击 5. 解决或失败。注意：这只是电影中的一个 10 分钟段落，不要写出大团圆结局。'
      },
      {
        id: 'seq-investigation',
        name: '调查/解谜段落 (Investigation)',
        description: '适合寻找线索、潜入、推理的段落。',
        instruction: '请按照调查段落结构拆解场景：1. 发现线索/制定计划 2. 潜入或询问 3. 遭遇误导或阻力 4. 发现关键真相/新线索 5. 逃脱或进入下一阶段。注意：这只是电影中的一个 10 分钟段落。'
      },
      {
        id: 'seq-dialogue',
        name: '文戏/谈判段落 (Dialogue/Debate)',
        description: '适合高智商博弈、情感冲突、谈判的段落。',
        instruction: '请按照文戏段落结构拆解场景：1. 双方带着不同目的入场 2. 试探与交锋 3. 施压与底牌揭晓 4. 情绪爆发或妥协 5. 关系改变。注意：这只是电影中的一个 10 分钟段落。'
      },
      {
        id: 'seq-montage',
        name: '蒙太奇段落 (Montage)',
        description: '适合时间压缩的训练、准备、相爱过程。',
        instruction: '请按照蒙太奇结构拆解场景：1. 初始状态（差劲/陌生） 2. 连续的尝试与失败 3. 逐渐进步/升温 4. 达到新状态（准备就绪/相爱）。注意：这只是电影中的一个 10 分钟段落。'
      }
    ]
  },
  "tv-series": {
    skeletons: [
      {
        id: 'skel-tv-serialized',
        name: '连续剧主线推进 (Serialized)',
        description: '适合剧情连贯的剧集，每集都在推动一个宏大的季主线。',
        instruction: '请按照连续剧结构规划集数：确保每集都有独立的A故事，同时B故事或C故事稳步推进整季的主线悬念。每集结尾必须有推动主线的钩子。'
      },
      {
        id: 'skel-tv-procedural',
        name: '单元剧结构 (Procedural)',
        description: '适合刑侦、医疗、律政等单元剧，每集解决一个独立案件/问题。',
        instruction: '请按照单元剧结构规划集数：每集包含独立的“引入案件 -> 调查/误导 -> 陷入僵局 -> 顿悟 -> 解决”流程。主线剧情仅作为背景或角色成长线穿插。'
      },
      {
        id: 'skel-tv-anthology',
        name: '独立迷你剧 (Anthology)',
        description: '适合《黑镜》类独立故事，每集是一个完整的微型电影。',
        instruction: '请按照独立迷你剧结构规划集数：每集必须是一个完整的故事，包含建置、高潮和结局，不需要为下一集留悬念。'
      }
    ],
    beats: [
      {
        id: 'beat-tv-4act-teaser',
        name: '美式4幕剧 + 冷开场',
        description: '经典美剧单集结构，适合剧情向剧集。',
        instruction: '请将“冷开场(Teaser) + 4幕剧(Act 1-4)”作为内部特征映射到骨架中。冷开场必须抛出核心悬念或危机；每一幕的结尾必须卡在一个反转或悬念点上，以适应插播广告的节奏。'
      },
      {
        id: 'beat-tv-5act',
        name: '流媒体5幕剧',
        description: '适合Netflix等无广告流媒体，节奏更连贯。',
        instruction: '请将“5幕剧”结构作为内部特征映射到骨架中。不需要像传统电视网那样强行制造广告悬念点，注重人物弧光和单集主题的完整表达，但结尾必须留有钩子（Cliffhanger）引导观众点击“下一集”。'
      },
      {
        id: 'beat-tv-sitcom',
        name: '情景喜剧A/B/C线',
        description: '适合20分钟喜剧，多线交织。',
        instruction: '请将“A/B/C三线交织”作为内部特征映射到骨架中。A故事（主线冲突，占据70%篇幅）与 B故事（副线/情感线，占据30%篇幅），C故事（搞笑点缀），确保各条线在结尾处有主题上的交汇或喜剧性的碰撞。'
      }
    ],
    sceneTemplates: [
      {
        id: 'tv-general',
        name: '通用叙事演进 (General Progression)',
        description: '最常用的默认模板。根据当前集的宏观定位，自然地拆解出符合逻辑的场景。',
        instruction: '请根据本集的宏观定位和梗概，自然地将其拆解为多个场景。不需要生搬硬套特定的模板，只需确保场景之间有清晰的因果关系，并稳步完成本集的叙事任务。'
      },
      {
        id: 'tv-teaser-4act',
        name: '冷开场 + 四幕剧 (Teaser + 4 Acts)',
        description: '经典美剧单集结构，适合剧情向剧集。',
        instruction: '请严格按照单集结构（Teaser/冷开场、Act 1/第一幕建置冲突、Act 2/第二幕危机加深、Act 3/第三幕高潮、Act 4/第四幕结局与悬念）来拆解场景。'
      },
      {
        id: 'tv-ab-story',
        name: 'A/B 双线叙事',
        description: '适合情景喜剧或多主角剧集，主线与副线交织。',
        instruction: '请按照 A/B 双线叙事结构拆解场景：A故事（主线冲突，占据70%篇幅）与 B故事（副线/情感线，占据30%篇幅），确保两条线在结尾处有主题上的交汇。'
      }
    ]
  },
  "short-drama": {
    skeletons: [
      {
        id: 'skel-short-xianxia-cultivation',
        name: '修仙凡骨逆袭流 (Cultivation Counterattack)',
        description: '凡骨、废柴或低阶弟子在宗门压迫中获得修行规则与代价资源，逐集救人、夺机缘、破阴谋并完成阶段性跃升。',
        instruction: '请按照修仙凡骨逆袭流规划集数：开局用极强羞辱或生死危机建立凡骨/低阶处境；前中期通过灵根、丹炉、器灵、丹方、宗门规训等修行资源形成“救人换成长/因果换力量”的规则；每集必须有一个可视化修仙爽点（破境、炼丹、斗法、打脸、救人、揭露阴谋）和集尾悬念；后期让主角在大比、执法审判、秘境或宗门危机中揭露更大黑手，但保留下一季更高层级压迫。',
        topicKeywords: ['修仙', '玄幻', '仙侠', '凡骨', '废柴', '宗门', '灵根', '丹炉', '器灵', '丹方', '药谷', '魔修', '外门', '内门', '大比', '飞升']
      },
      {
        id: 'skel-short-rich-counterattack',
        name: '豪门逆袭流 (Rich Counterattack)',
        description: '被豪门扫地出门或隐瞒身份的打工仔，后期身份曝光掌控大局。',
        instruction: '请按照豪门逆袭流规划集数：前中期设定主角隐藏身份（如基层员工/赘婿）受尽白眼与刁难；中期开始逐渐展露财力、人脉，小规模打脸拜金配角；后期真实身份（如世界首富/阀门继承人）全量曝光，降维打击所有反派阶级。'
      },
      {
        id: 'skel-short-dragon-king',
        name: '战神/龙王流 (Dragon King/God of War)',
        description: '无敌大能隐姓埋名，遭遇极大受辱后召唤十万部下。',
        instruction: '请按照战神龙王流规划集数：绝对的核心是“极致的反差”。前期战神虎落平阳被犬欺，承受各种鄙视和绿帽；中期积攒怒气，偶尔使用身手震慑；高潮阶段一句话召唤十万退役高手/神医/战将，亮出令牌，“参见龙王/战神！”，所有看不起他的人全部跪地求饶。'
      },
      {
        id: 'skel-short-rebirth-revenge',
        name: '重生复仇流 (Rebirth Revenge)',
        description: '前世被渣男/闺蜜/亲人背叛惨死，重生归来步步为营。',
        instruction: '请按照重生复仇流规划集数：第一集直接交代前世惨死和重生节点；后续集数利用信息差（预见未来事件）抢夺反派机缘、反向设局；反派自以为得计却总是落入陷阱；高潮阶段让反派失去一切，体验前世之苦。'
      },
      {
        id: 'skel-short-fake-heiress',
        name: '真假千金流 (Fake/Real Heiress)',
        description: '流落民间的真千金回归，但养女（假千金）绿茶作妖，最终真千金靠硬实力打脸。',
        instruction: '请按照真假千金流规划集数：真千金回豪门遭遇冷眼（父母偏心假千金）；假千金不断利用白莲花手段栽赃陷害；真千金不屑解释，只用马甲（如神医/黑客/财阀幕后老板）一次次碾压假千金的虚荣心；最终假千金真面目败露被扫地出门，亲生父母追悔莫及。'
      },
      {
        id: 'skel-short-flash-marriage',
        name: '闪婚甜宠流 (Flash Marriage Sweet Romance)',
        description: '意外闪婚对象竟是隐藏千亿首富，先婚后爱，甜宠狂撒狗粮。',
        instruction: '请按照闪婚甜宠流规划集数：开局被迫/意外领证（对方疑似破产/普通人）；女方职场遇阻，男方暗中动用千亿集团资源护妻（收购公司、更换合作方）；中间穿插恶毒女配破坏和男方隐藏身份面临暴露的危机；高潮阶段首富身份公开，轰动全城，举办世纪婚礼。'
      },
      {
        id: 'skel-short-medical-treasure',
        name: '神医/鉴宝玄学流 (Medical/Treasure/Metaphysics)',
        description: '获得祖传/古老传承，通过捡漏、治病、算命大杀四方。',
        instruction: '请按照神医/鉴宝玄学流规划集数：前期主角被权贵/专家专家看扁；中期主角出手捡漏绝世古董、看出绝症病因、点破风水死局；反派/专家被打脸后不服，继续摇人；后期主角施展通天手段救大人物性命或赢得豪赌，各大顶级大佬纷纷结交下跪。'
      },
      {
        id: 'skel-short-time-travel-palace',
        name: '穿越宫斗流 (Time Travel Palace Intrigue)',
        description: '现代女性穿越到古代后宫/宅斗环境，运用现代思维降维打击。',
        instruction: '请按照穿越宫斗流规划集数：穿越成不受宠的废柴/冷宫弃妃；运用现代科技、营销学、现代医学知识在后宫/宅斗中搞事业或化解危机；引得皇上/王爷改变态度；连续破解恶毒贵妃/主母的阴谋，最终掌控大权。'
      },
      {
        id: 'skel-short-school-bullying',
        name: '校园霸凌反击流 (School Bullying Revenge)',
        description: '常年忍受霸凌，因某契机爆发（或是家长/哥哥隐藏大佬身份介入）。',
        instruction: '请按照校园霸凌反击流规划集数：前期极致展现施暴者的嚣张和旁观者的冷漠，累积愤怒；转折点（如自己觉醒或遇到极强靠山，比如黑道哥哥、首富老爸发现）；反转开始，不再隐忍，采用以暴制暴或降维打击的方式，不仅惩戒霸凌者，还让包庇霸凌者的校长/老师付出惨痛代价。'
      }
    ],
    beats: [
      {
        id: 'beat-short-3s-15s',
        name: '黄金3秒 + 15秒反转',
        description: '极致的信息密度与情绪抓手，绝不铺垫。',
        instruction: '请将“黄金3秒+15秒反转”作为微观节拍映射。每一集必须包含：前3秒用极度夸张的动作或冲突画面抓住眼球（如甩巴掌、车祸、下跪）；随后15秒内快速引爆一个核心矛盾并在极短时间内完成一次局部反转或态度突变。杜绝任何平淡叙事和远景起幅。'
      },
      {
        id: 'beat-short-3-4-drops',
        name: '三翻四抖爽文结构',
        description: '经典小品相声抛包袱逻辑用于制造悬念。',
        instruction: '请使用“三翻四抖”节拍：通过三次看似失败、误解或压抑的情景堆叠期待/愤怒（三翻），最后在第四次时抛出意料之外但情理之中的爆发性打脸或揭秘（四抖）。确保情绪的弹簧被压到最底再释放。'
      },
      {
        id: 'beat-short-cliffhanger-ending',
        name: '结尾强悬念 (Cliffhanger Hook)',
        description: '逼迫充值/点击下一集的终极利器。',
        instruction: '请应用“结尾强悬念”节拍模型：每一集必须在剧情看似即将解决或发生重大转折的“最高潮一秒前”戛然而止。可以是一个反派的狰狞笑容、一个突然响起的神秘电话、或是主角面临生死选择倒数1秒。必须留足“钩子”。'
      }
    ],
    sceneTemplates: [
      {
        id: 'short-drama-general',
        name: '通用微短剧演进 (General Progression)',
        description: '最常用的默认模板。根据当前集的宏观定位，自然地拆解出符合逻辑的场景，保持快节奏。',
        instruction: '请根据本集的宏观定位和梗概，自然地将其拆解为多个场景。保持微短剧的快节奏，确保场景之间有清晰的因果关系和情绪起伏，结尾留有悬念。'
      },
      {
        id: 'short-drama-3-4',
        name: '打脸逆袭 (三翻四抖)',
        description: '微短剧经典结构，极快节奏的打脸逆袭，情绪拉满。',
        instruction: '请严格按照微短剧“三翻四抖”结构拆解：1. 极强的情绪开场（受辱/危机） 2. 第一次反转（翻） 3. 危机升级 4. 第二次反转（翻） 5. 绝境 6. 终极反转打脸（抖）。每个场景必须极短，冲突极度密集。'
      },
      {
        id: 'short-drama-hook',
        name: '悬念钩子 (Hook-driven)',
        description: '适合悬疑、复仇类微短剧，结尾必须留有强烈的悬念。',
        instruction: '请按照强悬念结构拆解：1. 悬念开场 2. 抽丝剥茧 3. 意外发现 4. 危机降临 5. 强悬念结尾（Cliffhanger）。必须确保最后一个场景留下巨大的疑问或危机，吸引观众看下一集。'
      },
      {
        id: 'short-drama-misunderstanding',
        name: '误会与澄清',
        description: '适合甜宠、虐恋微短剧。',
        instruction: '请按照误会结构拆解：1. 产生致命误会 2. 冲突爆发/受委屈 3. 发现真相的蛛丝马迹 4. 真相大白 5. 追妻火葬场/甜蜜反转。'
      }
    ]
  }
};

export const MICRO_SHORT_DRAMA_TEMPLATES: FormatTemplates = {
  skeletons: [
    {
      id: 'skel-micro-single-hook-loop',
      name: '单集强钩子闭环',
      description: '适合 5-20 分钟单条视频，开场必须先给冲突或结果，再回扣完整情绪偿付。',
      instruction: '请按照“强钩子开场 -> 快速建置处境 -> 连续误解/升级 -> 核心反转 -> 情绪偿付与余钩”的单集闭环规划段落。它不是连续短剧分集，不要生成多集付费点；每个段落都必须服务同一条视频的完整观看体验。',
      fixedCount: 5,
    },
    {
      id: 'skel-micro-countdown-crisis',
      name: '倒计时危机',
      description: '用明确时间压力推动单集微短剧，适合悬疑、复仇、误会、救援类题材。',
      instruction: '请按照“倒计时危机”规划段落：第一段直接展示不可逆危机；中段每个行动都缩短剩余时间或增加代价；高潮必须在最后期限前完成选择、揭秘或反击；结尾保留短促余味而不是拖成长篇连载。',
      fixedCount: 4,
    },
    {
      id: 'skel-micro-confession-turn',
      name: '告白/揭面反转',
      description: '适合关系反转、身份揭晓、误会澄清的单集微短剧。',
      instruction: '请按照“隐藏真相 -> 错位关系 -> 证据逼近 -> 当众揭面/告白 -> 情绪落点”规划段落。重点是让观众在单集内获得身份、关系或情感认知的完整翻转。',
      fixedCount: 5,
    },
  ],
  beats: [
    {
      id: 'beat-micro-first-3s-proof',
      name: '前 3 秒可见冲突',
      description: '第一镜必须能看懂冲突、风险或情绪，不依赖旁白慢慢解释。',
      instruction: '请将“前 3 秒可见冲突”作为硬节拍：开场第一段必须出现可被画面直接理解的冲突、风险、羞辱、追逐、异常结果或强烈情绪，不允许以解释世界观、人物背景或纯对白寒暄开场。',
    },
    {
      id: 'beat-micro-90s-turn',
      name: '90 秒内第一次实质反转',
      description: '单集视频必须尽快给出新的信息或关系变化。',
      instruction: '请确保 90 秒内出现第一次实质反转：信息、权力关系、身份判断、情感立场或危机方向至少改变一项，并让后续段落因这个变化而推进。',
    },
    {
      id: 'beat-micro-payoff-aftertaste',
      name: '情绪偿付 + 余钩',
      description: '结尾要给观众明确满足感，同时留下一个可分享或可讨论的余味。',
      instruction: '请把结尾设计为“情绪偿付 + 余钩”：主冲突需要在单集内给到明确满足感，但最后一拍可以留下角色代价、关系余震、隐藏信息或下一次选择的空间。',
    },
  ],
  sceneTemplates: [
    {
      id: 'micro-short-burst',
      name: '爆点递进',
      description: '极短、密集、强可视化的场景递进。',
      instruction: '请拆成短促可拍的场景组：1. 可视化钩子 2. 核心关系/处境 3. 危机升级 4. 反转证据 5. 情绪偿付。每场必须有明确价值变化，避免只换地点不换戏剧状态。',
    },
    {
      id: 'micro-short-countdown',
      name: '倒计时推进',
      description: '用时间限制或即将暴露的秘密制造推进力。',
      instruction: '请按照倒计时推进拆场：每场都要让剩余时间更少、风险更近或误会更难挽回；不要安排可有可无的过场。',
    },
    {
      id: 'micro-short-one-location-pressure',
      name: '单空间高压',
      description: '适合低成本拍摄，用单一空间内的关系压力完成完整短片。',
      instruction: '请尽量在一个主空间内拆场，通过站位、道具、进出门、电话/消息、目光压力推动戏剧变化，避免为了“看起来大”而无意义换景。',
    },
  ],
};

export const INTERACTIVE_FORMAT_TEMPLATES: FormatTemplates = {
  skeletons: [
    {
      id: 'skel-interactive-foldback',
      name: '折返主干结构',
      description: '分支产生体验差异，但定期折返到可制作的主干节点。',
      instruction: '请按照互动影视游戏的“折返主干结构”规划章节：每个选择可以改变变量、关系或信息，但关键剧情必须周期性折返到主干节点，避免分支指数爆炸。必须标注 Golden Path、Bad Ending 候选和折返点。',
    },
    {
      id: 'skel-interactive-variable-gate',
      name: '变量门控结构',
      description: '用信任、证据、资源、时间等变量决定路径开放与结局概率。',
      instruction: '请按照变量门控结构规划：每个章节至少声明一个可被选择改变的变量；后续节点必须读取这些变量并改变可见信息、选择文本、风险或结局概率。',
    },
    {
      id: 'skel-interactive-mystery-board',
      name: '线索板结构',
      description: '适合悬疑/调查互动叙事，选择改变线索组合和推理路径。',
      instruction: '请按线索板结构规划：每个选择都应获得、失去或污染一条线索；结局由线索完整度、信任关系和关键误判共同决定。',
    },
  ],
  beats: [
    {
      id: 'beat-interactive-meaningful-choice',
      name: '有效选择',
      description: '选择必须改变信息、变量、关系、路径或结局概率。',
      instruction: '请把“有效选择”作为硬节拍：任何选择如果只改按钮文本、不改变变量/信息/关系/路径/结局概率，就必须重写。',
    },
    {
      id: 'beat-interactive-state-feedback',
      name: '状态反馈',
      description: '玩家需要看见选择造成的状态变化，但不能把系统表格直接念给观众。',
      instruction: '请让关键选择后出现可拍摄的状态反馈：角色态度、环境线索、手机消息、道具变化、可进入地点或旁观者反应至少改变一项。',
    },
    {
      id: 'beat-interactive-costed-branch',
      name: '有代价的分支',
      description: '分支差异必须有制作预算边界，防止无限扩张。',
      instruction: '请为每个分支标注制作代价：新场景、新角色、新道具、新视频段或仅对白差异；优先使用可复用空间和折返点控制成本。',
    },
  ],
  sceneTemplates: [
    {
      id: 'interactive-node-choice-hold',
      name: '节点选择停顿',
      description: '互动节点需要给玩家理解局面和做选择的停顿。',
      instruction: '请拆成“局面呈现 -> 选择前停顿 -> 选项压力 -> 结果反馈 -> 折返/分叉”的可拍节点。必须包含 Interactive Hold，不允许直接把线性剧情切成按钮。',
    },
    {
      id: 'interactive-variable-feedback',
      name: '变量反馈场景',
      description: '让抽象变量通过表演、道具和信息差被观众感知。',
      instruction: '请把变量反馈设计为可拍事件：信任下降可以表现为角色回避目光，证据增加可以表现为照片/录音/账单，道德压力可以表现为旁人反应或环境后果。',
    },
    {
      id: 'interactive-ending-branch',
      name: '结局分支场景',
      description: '结局必须回收变量和选择，不只是换一句旁白。',
      instruction: '请拆解结局分支时明确回收哪些变量、哪些选择造成差异，以及每个结局需要新增的最小拍摄内容。',
    },
  ],
};

FORMAT_ROUTING["micro-short-drama"] = MICRO_SHORT_DRAMA_TEMPLATES;
FORMAT_ROUTING["interactive"] = INTERACTIVE_FORMAT_TEMPLATES;
