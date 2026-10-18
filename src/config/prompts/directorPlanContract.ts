export const directorPlanContract = `
【本场导演方案 director-plan.v1】
保持完整 Shot JSON 数组返回。在当前上下文启用导演方法时，仅第一个镜头额外附带 directorPlan:{intent,rhythm,applications:[{skillId,methodId,dimensions:[],method,evidence,decision,shotNumbers:[1]}],exceptions:[]}，后面的镜头不要重复此对象。
intent 简述本场跟随谁、观众何时知道什么以及整体拍法；rhythm 写明场内收放与实际提供的相邻场次承接，不新建剧情段落。applications 只列本场真正采用的方法：结构化方法填写实际提供的 methodId，dimensions 为实际采用的指导字段路径列表，skillId 仅在上下文提供时填写，不虚构。旧版方法没有标识时省略这三个字段。method 从当前 Skill 或作者补充逐字摘录一小段，evidence 从本场原文逐字摘录，decision 说明如何拍，shotNumbers 为此次返回数组从 1 开始的镜头序号。依据仅是可核对引文，不冒充已验证结论。没有适用方法可返回空 applications，并在 exceptions 说明；不要制造情境来套风格。
具体机位、构图、调度、动作、表演、时长、声音与剪辑继续写入原有 Shot 字段，不另建一套镜头。例外只写重要取舍，不逐项抄写所有未用方法。镜头顺序、方法使用和节奏需要有变化，不让每场都重复同一招。已锁定事实、对白、世界规则、资产身份和画风优先。
本次若为作者主动重新设计分镜，可在本场原文和明确时长要求内调整原有镜头组织；已有镜头作为可对照版本，不强迫照抄旧拍法。通用镜头时长或颗粒度建议仅为默认参考，不能覆盖本场采用的方法与具体表达需要。
已有镜头有局部设置时，只有明确对应该原镜头的返回镜头才填 sourceShotId（来自 existingShotOverrides 的真实 shotId），继承其局部导演与画风。修订候选时保留其 directing.sourceShotId 原镜头对应关系。新增或无法对应的镜头省略此字段，不按序号猜测对应，也不把一个镜头的局部设置扩散到全场。
需要具体声音执行时，每镜可附 directing:{dialogue:[{lineIndex:0,instruction:"本句语气、停顿与重音",startSeconds:0}],soundCues:[{type:"sfx或bgm",description:"具体可听内容",startSeconds:0,durationSeconds:2,linkedAssetId:"可选已有声音资产ID"}]}。无要求就省略或用空数组。
lineIndex 是本镜 dialogueLines 从 0 开始的序号，不写替换台词。startSeconds 相对本镜开始；未指定则沿用系统对白顺序排布。允许已有对白的声音先入或延续到切镜之后，但不能越过本场开头和结尾，不能使对白说不完或打乱剧本的对白先后。对白时长仍按既有台词承载计算。
soundCues 会成为实际待制作音轨，不要与已安排的同一声音重复。只安排原文已有声音或不改变故事含义的配乐和环境处理；禁止新增警报、枪声等会改变事件的声音。linkedAssetId 必须来自项目声音资产，未知时省略，不编造。没有现成媒体仍可安排，不能声称声音已经生成。
所有时点和时长必须是有限数字。声音可以跨相邻切点，但起止都在本场内；description 写听到什么，不含来源审计或制作系统操作。transition 仍仅用 none/fade/black，其他尚不能自动执行的剪辑建议写 editingNote，不宣称已执行。
未选择导演时不需要 directorPlan；历史返回缺少方案仍可使用，不据此编造已完成的方法记录。
`;

export function upgradeDirectorPlanTemplate(template: string) {
  return template.includes("director-plan.v1") ? template : `${template}\n${directorPlanContract}`;
}
