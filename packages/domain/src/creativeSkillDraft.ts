import { DIRECTOR_FIELDS } from "./directorProfile";
import type { CreativeSkillKind, CreativeSkillReference } from "./creativeDirection";
import type { SkillReferenceWork } from "./skill";

export function buildCreativeSkillDraftPrompt(input: {
  kind: CreativeSkillKind; content: string; referenceWork?: SkillReferenceWork; references: CreativeSkillReference[]; analysisNotes?: string;
}): string {
  const { kind, content, referenceWork, references } = input;
  const hasReferenceWork = Boolean(referenceWork?.title.trim());
  if (kind === "visual_style") throw new Error("请在制作页面直接填写风格提示词。");
  if (!referenceWork?.title.trim() && !content.trim() && !references.length && !input.analysisNotes?.trim()) throw new Error("请输入参考作品、填写规则或提供拉片依据。");
  return [
    kind === "director"
      ? (hasReferenceWork ? "根据参考作品，提炼一套具有该作品辨识度、可用于不同故事的导演方法 Skill。" : "根据提供的观察记录和拍摄要求，整理一套可用于不同故事的导演方法 Skill。") + "Skill 应能独立保存和复用；本次无需提供待拍剧本，具体场景中的应用由后续制片流程决定。"
      : "根据作者提供的要求和参考资料，整理可独立保存和复用的创作规则。",
    kind === "director" ? [
      '只返回 JSON 对象，schemaVersion 固定为 "director-profile.v2"，principles 为整体原则文字列表，methods 为导演方法列表，unclassified 为暂时无法分类的原有规则文字列表（没有则省略）。不要代码块、前言或分析报告。',
      '每个 method 包含 id（如 method-01，唯一）、title（简短中文名称）、priority（core 或 supporting）、when（一般适用情境）、purpose（表达目的）、directions（按下列字段组织的指导）、exceptions（例外文字列表）、checks（检查点文字列表）。',
      'directions 只允许以下路径，每个叶子值都是文字列表，点号表示嵌套对象：\n' + Object.entries(DIRECTOR_FIELDS).map(([key, field]) => key + '：' + field.label).join('\n'),
      '例如 performance: {physical: ["具体身体行为"], dialogueDelivery: ["具体发声要求"]}。省略没有可靠依据的字段，不为填满字段凑规则。一个方法可同时包含几个部门的协作指导，但每句话放在正确字段。',
      'productionDesign.characterAppearance/locationSpace/props 仅写基础造型、空间、道具设计，不写人物反应、镜头、切点或音乐。已有布景道具如何参与拍摄放 onSetUse。声音区分环境、音效、音乐和混音。',
      '转换已有规则时只整理分类，不补造缺少的部门要求；无法确定归类的原文保留在 unclassified，不混入可执行字段。整体原则不能代替具体方法。无法辨认作品或依据不足以形成任何方法时，返回 {"error":"需要补充的作品信息"}，不要把请求澄清写成方法。',
    ].join('\n\n') : "只返回自然语言正文，不要前言或分析报告。",
    referenceWork?.title.trim() ? [
      "参考作品：" + referenceWork.title,
      referenceWork.version ? "年份或版本：" + referenceWork.version : "",
      referenceWork.director ? "导演（辅助辨认）：" + referenceWork.director : "",
      referenceWork.focus ? "参考片段或重点：" + referenceWork.focus : "",
    ].filter(Boolean).join("\n") : "未指定参考作品，按作者提供的要求和参考资料整理，不为自定义方法编造作品来源。",
    content.trim() ? "作者要求与待整理规则：\n" + content.trim() : "",
    references.length ? "参考说明（文字）：\n" + references.map(ref => [ref.label, ref.purpose].filter(Boolean).join("：")).join("\n") + "\n这些说明不等于已观察原片的连续影像。" : "",
    input.analysisNotes?.trim()
      ? "【作者提供的参考分析，仅作提炼依据】\n" + input.analysisNotes.trim() + "\n优先依据其中的具体观察提炼方法，区分观察和推断，正文不复述分析记录。"
      : referenceWork?.title.trim() ? "本次依据作品名称和已有作品知识提炼，没有提供原片分析或影片。" : "本次依据作者提供的文字整理。",
    hasReferenceWork
      ? "以指定作品和版本为分析范围，不把导演其他作品的方法混入。未指定片段时提炼作品整体拍法；指定片段或侧重点时围绕该范围。只提供系列名时提炼有依据的共性，不擅自缩成某一部。省略无法确认的细节，不编造片段、焦距、秒数等原片参数，也不声称观看了未提供的影片。确实无法辨认参考作品时，按 error 格式说明需要补充的作品信息。"
      : "直接按提供的观察和要求整理，不要求补充作品名称。不将自定义方法归给某部作品，不把拍法建议写成已核实的原片参数或观察结论。",
    kind === "director" ? [
      (hasReferenceWork ? "先辨认哪些拍摄手段及其组合最能形成这部作品的观看体验，再提炼为可执行方法。" : "从提供的观察和要求中辨认核心拍摄意图，将其整理成可执行方法。") + "重点是怎样组织观众的注意、信息、空间感和情绪：观看谁、何时揭示什么、人物怎样占据和移动于空间、摄影机怎样参与、何时切镜、声音怎样引导或留白。写清手段的具体组合、使用时机和变化方式，不用‘电影感、史诗感、节奏紧凑’等标签代替做法。",
      "检查重要的观看视点与信息揭示、人物及群像调度、表演、摄影与构图、光线与美术空间、动作组织、奇观尺度与视效呈现、声音与剪辑节奏是否被遗漏。这些是分析视角，不是固定输出栏目；只提炼" + (hasReferenceWork ? "该作品确有特点且有依据的部分" : "输入中有依据的拍法") + "，不强行为每个部门凑规则。",
      "每条 method 围绕一种核心导演方法，分别说明一般适用情境、希望形成的观看体验、实现它的具体视听手段，以及何时改变或停止使用。适用情境是可复用的条件，不预设任何待拍故事。把共同完成同一效果的表演、调度、摄影、声音和切点写在一起，让后续制片能据此作出明确选择；不必每段覆盖所有手段，也不必套同一种句式。",
      "写清核心方法的主次、配合和必要例外，区别整体的稳定倾向与特定段落才使用的手法。节奏同时考虑镜头内部、镜头之间和段落之间的组织，避免把某个标志性手法写成所有场景都必须遵守的固定拍法。",
      "迁移的是拍摄与视听表达方法；参考作品的具体剧情、角色、对白、专有道具和世界设定只作分析线索，不写成使用 Skill 的必要条件。正文使用可直接执行的导演语言，不写影评、剧情梗概、来源标记或分析过程。",
      "优先写清少量有辨识度的方法，按方法组织结构；篇幅由可靠方法的数量和复杂程度决定，不为凑段数重复或补造。已有作者规则可合并整理，保留其明确意图。输出前检查方法是否具体、是否重复、是否符合输入依据；不输出检查过程或未经标定的相似度、风格强度百分比。",
    ].join("\n\n") : "",
  ].filter(Boolean).join("\n\n");
}

/** The model's prose is the editable rule. No schema, title matching or extraction gate. */
export function creativeSkillDraftText(raw: string): string {
  const content = raw.trim();
  if (!content) throw new Error("返回内容为空，请填写规则或重新生成。原有输入已保留。");
  return content;
}

/** Advisory only: an uncertain response remains editable and is never silently certified. */
export function creativeSkillDraftNotice(raw: string): string {
  return raw.trim().length < 220 && /^(?:抱歉[，,。]?\s*)?(?:请(?:提供|补充|明确)|无法(?:确认|辨认|确定)|需要(?:更多|补充))/.test(raw.trim())
    ? "这次返回似乎是在请求更多作品信息。可补充依据后再生成，或编辑为可执行方法后保存。" : "";
}

export function creativeSkillDraftTitle(kind: CreativeSkillKind, referenceWork?: SkillReferenceWork): string {
  const label = kind === "director" ? "导演方法" : kind === "visual_style" ? "画风" : "Skill";
  return referenceWork?.title.trim() ? `${referenceWork.title.trim()} · ${label}` : `自定义${label}`;
}
