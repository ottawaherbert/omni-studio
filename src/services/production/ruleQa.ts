import { ContextPlan, ProductionQAIssue } from "../../types/production";
import { Episode, Project, Scene, Shot, UniversalSkillReference } from "../../types/project";
import { skillBodyText, skillTitleText } from "../../utils/universalSkillText";
import { GameProjectData } from "../../types/game";
import { validateLongFormMemoryRules } from "./longFormMemory";
import {
  buildAssetReferenceRepairPlan,
  collectAssetReferenceAudit,
  canonicalAssetId,
  normalizeAssetRefName,
  resolveAssetRef,
} from "../../utils/assetRefs";
import { evaluateStandaloneShotDuration } from "./shotDurationPolicy";

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "error",
  suggestion?: string,
): ProductionQAIssue => ({
  id: `rule-qa-${Date.now()}-${crypto.randomUUID()}`,
  target,
  message,
  severity,
  suggestion,
});

const normalizeName = (value?: string) => (value || "").trim().toLowerCase();

const normalizeCreativeText = (value?: string) =>
  (value || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：“”"'（）()【】\[\]《》,.!?;:—\-]/g, "")
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsCjk = (value?: string) => /[\u3400-\u9fff]/.test(value || "");

const hasConcreteVerb = (text: string) =>
  /追|逃|偷|藏|找|打|拿|放|看|撕|烧|推|关|开|写|删|拨|跑|跪|撞|砸|翻|停|转|刺|指|掷|抛|接|握|递|拍|绕|走|站|蹲|跪|闪|爆|进入|离开|上前|后撤|低头|抬头|侧身|阻止|交换|揭穿|cinematic|camera|walks|runs|grabs|opens|closes|pushes|reveals/i.test(text);

const abstractWords = ["孤独", "命运", "绝望", "希望", "恐惧", "内心", "宿命", "崩溃", "救赎", "anxiety", "destiny", "loneliness", "despair", "hope", "fear", "redemption"];

const requiredShotGrammarFields: { key: keyof Shot; label: string }[] = [
  { key: "shotSize", label: "shotSize" },
  { key: "cameraAngle", label: "cameraAngle" },
  { key: "cameraMovement", label: "cameraMovement" },
  { key: "focalLength", label: "focalLength" },
  { key: "lighting", label: "lighting" },
  { key: "composition", label: "composition" },
  { key: "blocking", label: "blocking" },
  { key: "continuityNote", label: "continuityNote" },
];

const shotPhysicalText = (shot: Shot) => [
  shot.shotSize,
  shot.cameraAngle,
  shot.cameraMovement,
  shot.focalLength,
  shot.lighting,
  shot.lightingAtmo,
  shot.composition,
  shot.blocking,
  shot.continuityNote,
].filter(Boolean).join(" ");

const visibleCharacterListText = (value?: string) =>
  Array.from(String(value || "").matchAll(/可见角色[:：]([^，。；;\n]+)/g))
    .map((match) => match[1])
    .join("、");

const characterActsOnCamera = (text: string, characterName: string) => {
  if (!text || !characterName) return false;
  const name = escapeRegExp(characterName);
  return new RegExp(
    `${name}(?:\\s|，|、|：|:)*(?:笑道|说道|喊道|问道|答道|宣布|现身|入画|出现|走|跑|看|抬|按|握|拿|放|推|递|挥|站|跪|挡|冲|转|进入|离开|上前|后撤|低头|抬头|侧身|阻止|交换|揭穿|开口|发声|grabs|opens|walks|runs|speaks|says|shouts|looks|hands|pushes|enters|exits)`,
    "i",
  ).test(text);
};

const promptPhysicalAliases = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    ecu: ["ecu", "extreme close-up", "extreme close up", "极端特写", "大特写"],
    cu: ["cu", "close-up", "close up", "closeup", "特写", "近景"],
    mcu: ["mcu", "medium close-up", "medium close up", "中近景", "半身近景"],
    ms: ["ms", "medium shot", "中景"],
    ws: ["ws", "wide shot", "远景", "广角全景"],
    low: ["low angle", "low-angle", "低角度", "仰拍"],
    high: ["high angle", "high-angle", "高角度", "俯拍"],
    eye: ["eye-level", "eye level", "平视", "视线高度"],
    "eye-level": ["eye-level", "eye level", "平视", "视线高度"],
    pan: ["pan", "panning", "横摇", "摇摄", "横移"],
    tilt: ["tilt", "tilting", "俯仰", "上摇", "下摇"],
    static: ["static", "locked-off", "locked off", "静态", "固定镜头", "镜头固定"],
    handheld: ["handheld", "hand-held", "手持", "手持镜头"],
    dolly: ["dolly", "tracking", "推轨", "跟拍", "移动镜头"],
    "push-in": ["push-in", "push in", "推进", "推近"],
  };
  return aliases[normalized] || [normalized];
};

const physicalParameterMatchCount = (shot: Shot, promptText: string) => {
  const prompt = promptText.toLowerCase();
  const values = [
    shot.shotSize,
    shot.cameraAngle,
    shot.cameraMovement,
    shot.focalLength,
    shot.lighting,
    shot.composition,
    shot.blocking,
  ].filter((value): value is string => Boolean(value?.trim()));
  return values.filter((value) =>
    promptPhysicalAliases(value).some((alias) => alias.length > 1 && prompt.includes(alias)),
  ).length;
};

const episodeSceneText = (episodes: Episode[]) =>
  episodes.flatMap((episode) => [
    episode.title,
    episode.inspiration,
    ...(episode.scenes || []).flatMap((scene) => [
      scene.title,
      scene.description,
      scene.sceneGoal,
      scene.hook,
      scene.cliffhanger,
      scene.valueShift?.from,
      scene.valueShift?.to,
      scene.valueShift?.reason,
      ...(scene.scriptBlocks || []).map((block) => block.content),
    ]),
  ]).filter(Boolean).join("\n");

export const validateFormatSpecificRules = (
  project: Project,
  episodes: Episode[] = [],
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  const scenes = episodes.flatMap((episode) => episode.scenes || []);
  const text = `${episodeSceneText(episodes)}\n${project.logline || ""}\n${project.coreConflict || ""}\n${project.creativeVision?.narrativeStyle || ""}`;
  const creativeVision = project.creativeVision || ({} as NonNullable<Project["creativeVision"]>);
  const isInteractive = project.projectModel === "interactive";

  if (isInteractive) {
    const gameDataList = episodes.map((episode) => episode.gameData).filter(Boolean) as GameProjectData[];
    const nodes = gameDataList.flatMap((gameData) => gameData.nodes || []);
    const edges = gameDataList.flatMap((gameData) => gameData.edges || []);
    const variables = gameDataList.flatMap((gameData) => gameData.variables || []);
    const endingCount = nodes.filter((node) => node.isEnding).length;
    if (nodes.length > 0 && edges.length === 0) {
      issues.push(issue("format.interactive.choiceValidity", "互动游戏标准缺少选择边，玩家无法形成有效选择。", "warning"));
    }
    if (edges.length > 0 && variables.length === 0) {
      issues.push(issue("format.interactive.variableFeedback", "互动游戏标准缺少变量反馈，选择后果难以被系统记住。", "warning"));
    }
    if (endingCount < 2 && nodes.length >= 4) {
      issues.push(issue("format.interactive.endingDifference", "互动游戏标准缺少足够结局差异，分支价值不足。", "warning"));
    }
    if (nodes.length > 0 && edges.length > nodes.length * 3) {
      issues.push(issue("format.interactive.branchComplexity", "互动游戏标准发现分支复杂度可能膨胀，边数量相对节点过高。", "warning"));
    }
    return issues;
  }

  if (project.type === "movie") {
    if (!creativeVision.themeQuestion) {
      issues.push(issue("format.movie.themeUnity", "电影标准缺少主题命题，长片容易散成事件串。", "warning"));
    }
    if (!creativeVision.protagonistArc) {
      issues.push(issue("format.movie.characterArc", "电影标准缺少主角弧线，结尾变化难以验证。", "warning"));
    }
    if (!creativeVision.emotionalReward) {
      issues.push(issue("format.movie.emotionalReward", "电影标准缺少结尾认知/情感补偿。", "warning"));
    }
    if (scenes.length > 0 && scenes.some((scene) => !scene.valueShift?.from || !scene.valueShift?.to)) {
      issues.push(issue("format.movie.causalClosure", "电影标准发现部分场景缺少价值变化，因果推进可能不清晰。", "warning"));
    }
    if (!/母题|意象|motif|回收|recall|visual motif/i.test(text)) {
      issues.push(issue("format.movie.visualMotif", "电影标准缺少视觉母题或回收信号。", "warning"));
    }
  }

  if (project.type === "tv-series") {
    if (episodes.length > 0 && episodes.length < 3) {
      issues.push(issue("format.tv.seriesEngine", "电视剧标准缺少足够分集来验证持续发动机。", "warning"));
    }
    const hasStoryLines = scenes.some((scene) => scene.storyLine && scene.storyLine !== "A-Story");
    if (scenes.length > 0 && !hasStoryLines) {
      issues.push(issue("format.tv.relationshipFuel", "电视剧标准缺少 B/C 线或关系长线燃料。", "warning"));
    }
    if (!/季|主线|season|arc|下一集|new question|关系/.test(text)) {
      issues.push(issue("format.tv.seasonArc", "电视剧标准缺少季节弧线或每集新问题信号。", "warning"));
    }
    if (scenes.length > 0 && scenes.every((scene) => !scene.cliffhanger && !/钩子|悬念|下一集|cliffhanger/i.test(scene.description))) {
      issues.push(issue("format.tv.episodeSatisfaction", "电视剧标准缺少单集满足感后的新问题或尾钩。", "warning"));
    }
  }

  if (project.type === "short-drama") {
    if (scenes.length > 0 && scenes.every((scene) => !scene.hook)) {
      issues.push(issue("format.shortDrama.firstHook", "短剧标准缺少强钩子，前置吸引力不足。", "warning"));
    }
    if (!/反转|打脸|逆袭|爽点|reversal|twist/i.test(text)) {
      issues.push(issue("format.shortDrama.reversalFrequency", "短剧标准缺少高频反转或爽点信号。", "warning"));
    }
    if (!/付费|追更|cliffhanger|paywall|继续看/i.test(text)) {
      issues.push(issue("format.shortDrama.paidHook", "短剧标准缺少集尾付费/追更诱因。", "warning"));
    }
    if (scenes.some((scene) => (scene.description || "").length > 260)) {
      issues.push(issue("format.shortDrama.lowCognitiveLoad", "短剧标准发现部分场景描述过长，可能提高理解门槛。", "warning"));
    }
  }

  if (project.type === "micro-short-drama") {
    if (episodes.length > 1) {
      issues.push(issue("format.microShort.singleUnit", "单集微短剧标准发现多个分集/段落，可能被误写成连续短剧。", "warning"));
    }
    if (scenes.length > 0 && !scenes[0]?.hook) {
      issues.push(issue("format.microShort.first3sHook", "单集微短剧标准缺少前 3 秒可见冲突。", "warning"));
    }
    if (!/反转|倒计时|真相|证据|爽点|twist|reversal/i.test(text)) {
      issues.push(issue("format.microShort.reversal", "单集微短剧标准缺少 90-120 秒反转或爽点。", "warning"));
    }
    if (!/偿付|补偿|完成|解决|payoff|reward/i.test(text)) {
      issues.push(issue("format.microShort.emotionalPayoff", "单集微短剧标准缺少完整情绪偿付。", "warning"));
    }
  }

  return issues;
};

const continuityCheckDefinitions = [
  {
    key: "axis",
    label: "180 度轴线",
    pattern: /180|轴线|轴向|视线方向|朝向|方向|左后方|右后方|左前方|右前方|门内|院内|axis|line of action|screen direction|方位/i,
  },
  {
    key: "eyeline",
    label: "视线匹配",
    pattern: /视线|眼神|eyeline|eye[- ]?line|look direction|gaze/i,
  },
  {
    key: "matchOnAction",
    label: "动作顺接",
    pattern: /动作顺接|动作衔接|动作连续|运动方向延续|接上|接上一|继前|延续前|连续|连贯|传递|场景切换|无直接空间关系|标题卡|match[- ]?on[- ]?action|match cut|continuing action|hand movement|gesture/i,
  },
  {
    key: "spatial",
    label: "空间方位连续性",
    pattern: /空间|方位|位置|左侧|右侧|左后方|右后方|左前方|右前方|门内|院内|画面外|前镜头|上一镜头|screen left|screen right|foreground|background|blocking|geography|spatial/i,
  },
];

const shotSizeCategory = (shotSize?: string) => {
  const value = (shotSize || "").toLowerCase();
  if (/mcu|medium close|medium|ms|中景/.test(value)) return "medium";
  if (/ecu|extreme close|close|cu|特写|近景/.test(value)) return "close";
  if (/wide|ws|long|establish|全景|远景/.test(value)) return "wide";
  return value ? "other" : "";
};

const isExempt = (note: string) => {
  const exemptions = [
    "故意越轴",
    "越过轴线",
    "reverse angle",
    "motivated axis break",
    "deliberate screen direction reversal",
  ];
  return exemptions.some((term) => note.toLowerCase().includes(term.toLowerCase()));
};

const getCharCenters = (shot: Shot) => {
  const centers: Record<string, number> = {};
  if (shot.compositionData?.entities) {
    shot.compositionData.entities.forEach((ent) => {
      if (ent.type === "character" && ent.screenBox) {
        centers[ent.id] = ent.screenBox.x + ent.screenBox.w / 2;
      }
    });
  }
  return centers;
};

const validateSceneContinuity = (scene: Scene) => {
  const shots = scene.shots || [];
  if (shots.length < 2) return [];

  const issues: ProductionQAIssue[] = [];
  const continuityText = shots.map((shot) => shot.continuityNote || "").join("\n");

  continuityCheckDefinitions.forEach((definition) => {
    if (!definition.pattern.test(continuityText)) {
      issues.push(
        issue(
          `scene.${scene.id}.continuity.${definition.key}`,
          `场景「${scene.title}」缺少${definition.label}策略说明。`,
          "warning",
          "在 continuityNote 中说明轴线、视线、动作顺接和空间方位如何保持，或说明为何故意打破连续性。",
        ),
      );
    }
  });

  for (let i = 0; i < shots.length - 1; i++) {
    const shotA = shots[i];
    const shotB = shots[i + 1];

    const centersA = getCharCenters(shotA);
    const centersB = getCharCenters(shotB);

    const commonChars = Object.keys(centersA).filter((id) => id in centersB);

    for (let j = 0; j < commonChars.length; j++) {
      for (let k = j + 1; k < commonChars.length; k++) {
        const char1 = commonChars[j];
        const char2 = commonChars[k];

        const posA1 = centersA[char1];
        const posA2 = centersA[char2];
        const posB1 = centersB[char1];
        const posB2 = centersB[char2];

        if (posA1 === posA2 || posB1 === posB2) continue;

        const leftRightA = posA1 < posA2;
        const leftRightB = posB1 < posB2;

        if (leftRightA !== leftRightB) {
          const noteText = `${shotA.continuityNote || ""} ${shotB.continuityNote || ""}`;
          const exempt = isExempt(noteText);

          if (!exempt) {
            issues.push(
              issue(
                `scene.${scene.id}.continuity.geometryAxis`,
                `镜头 ${i + 1} (ID: ${shotA.id || "无"}) 和镜头 ${i + 2} (ID: ${shotB.id || "无"}) 之间发生越轴：角色「${char1}」和「${char2}」的左右相对方位翻转，且缺少故意越轴的策略说明。`,
                "warning",
                "在 continuityNote 中写明「故意越轴」或「reverse angle」、「motivated axis break」、「deliberate screen direction reversal」以豁免此检查。",
              ),
            );
          }
        }
      }
    }
  }

  return issues;
};

const validateShotGroupGrammar = (scene: Scene) => {
  const shots = scene.shots || [];
  if (shots.length < 3) return [];
  const issues: ProductionQAIssue[] = [];
  const sizeCategories = new Set(shots.map((shot) => shotSizeCategory(shot.shotSize)).filter(Boolean));
  const uniqueVisualActions = new Set(shots.map((shot) => normalizeName(shot.visualAction)).filter(Boolean));
  const uniqueMotivations = new Set(shots.map((shot) => normalizeName(shot.motivation)).filter(Boolean));
  const physicalProgression = shots.map((shot) => [
    shot.shotSize,
    shot.cameraMovement,
    shot.composition,
    shot.blocking,
    shot.motivation,
  ].filter(Boolean).join(" ")).filter(Boolean);

  if (sizeCategories.size < 2) {
    issues.push(issue(
      `scene.${scene.id}.shotGroup.sizeVariety`,
      `场景「${scene.title}」镜头组缺少远中近或情绪距离变化，可能是一串同质化镜头。`,
      "warning",
      "至少安排建立空间的远/全景、推进信息的中景，以及承载情绪或证据的近景/特写。",
    ));
  }
  if (uniqueVisualActions.size <= 1 && shots.length >= 3) {
    issues.push(issue(
      `scene.${scene.id}.shotGroup.informationProgression`,
      `场景「${scene.title}」镜头组缺少信息递进，每个镜头的 visualAction 过于相似。`,
      "warning",
      "让镜头依次揭示空间、动作、反应、证据或关系变化，而不是重复同一个动作。",
    ));
  }
  if (uniqueMotivations.size <= 1 && physicalProgression.length >= 3) {
    issues.push(issue(
      `scene.${scene.id}.shotGroup.motivationProgression`,
      `场景「${scene.title}」镜头组缺少镜头动机递进。`,
      "warning",
      "为镜头组标明情绪距离、信息层级或观众注意力如何逐步变化。",
    ));
  }
  return issues;
};

const skillReferenceText = (skill: UniversalSkillReference) => [skillTitleText(skill), skillBodyText(skill)].filter(Boolean).join(" ");

const missingStructuredSkillFields = (skill: UniversalSkillReference) => {
  return skillBodyText(skill) ? [] : ["content"];
};

const detectReferenceFormatConflicts = (project: Project | undefined, skills: UniversalSkillReference[]) => {
  if (!project || skills.length === 0) return [];
  const issues: ProductionQAIssue[] = [];
  const joined = skills.map(skillReferenceText).join("\n");
  const shortDramaCue = /短剧|微短剧|打脸|爽点|付费点|3秒|三翻四抖|cliffhanger|爽文|逆袭/i.test(joined);
  const slowCinemaCue = /慢热|生活流|克制|留白|静观|长镜头|slow burn|minimalist|meditative/i.test(joined);
  const interactiveCue = /互动|选择|变量|分支|结局|状态反馈|foldback|branch|choice|variable|ending/i.test(joined);

  if (project.type === "movie" && shortDramaCue) {
    issues.push(issue(
      "contextPlan.referenceFormatConflict",
      "参考源包含明显短剧/爽点节奏，但当前项目是电影长片，可能与长片弧线和留白要求冲突。",
      "warning",
      "把短剧节奏降级为局部段落建议，或切换项目类型/结构模板。",
    ));
  }
  if ((project.type === "short-drama" || project.type === "micro-short-drama") && slowCinemaCue) {
    issues.push(issue(
      "contextPlan.referenceFormatConflict",
      "参考源偏慢热/克制/长镜头，但当前项目需要短剧或微短剧的高频钩子和低理解成本。",
      "warning",
      "保留视听气质，但不要让慢热节奏覆盖前 3 秒钩子、反转密度和情绪偿付。",
    ));
  }
  if (project.projectModel === "interactive" && skills.length > 0 && !interactiveCue) {
    issues.push(issue(
      "contextPlan.referenceInteractiveFit",
      "互动项目已选择参考源，但参考源缺少选择、变量、分支、结局或状态反馈等互动可执行规则。",
      "warning",
      "补充互动 DNA，或明确这些参考只影响视听/对白，不影响互动结构。",
    ));
  }
  return issues;
};

export const validateConceptRules = (project: Project) => {
  const issues: ProductionQAIssue[] = [];
  if ((project.logline || "").length < 18) {
    issues.push(issue("project.logline", "logline 过短，无法支撑后续自动拆解。", "warning", "补充主角、目标、阻力和代价。"));
  }
  if (!/目标|阻止|必须|否则|代价|冲突|对抗|选择|失去|拯救/.test(project.coreConflict || "")) {
    issues.push(issue("project.coreConflict", "核心冲突缺少可执行目标、对抗力量或代价。", "warning", "按外部目标、内在缺失、对抗力量、终极代价重写。"));
  }
  if (!project.creativeVision?.visualStyle && !project.creativeVision?.narrativeStyle) {
    issues.push(issue("project.creativeVision", "创作视点缺少视觉或叙事风格。", "warning"));
  }
  const conceptContract = project.creativeVision || ({} as Project["creativeVision"]);
  const missingConceptFields = [
    ["want", conceptContract.want],
    ["need", conceptContract.need],
    ["stakes", conceptContract.stakes],
    ["oppositionForce", conceptContract.oppositionForce],
    ["themeQuestion", conceptContract.themeQuestion],
    ["protagonistArc", conceptContract.protagonistArc],
    ["emotionalReward", conceptContract.emotionalReward],
  ].filter(([, value]) => !String(value || "").trim());
  if (missingConceptFields.length > 0) {
    issues.push(issue(
      "project.creativeVision.conceptContract",
      `Concept 缺少创作强约束字段：${missingConceptFields.map(([field]) => field).join(", ")}。`,
      "blocking",
      "请让 concept 阶段结构化输出 want、need、stakes、oppositionForce、themeQuestion、protagonistArc、emotionalReward。",
    ));
  }
  return [...issues, ...validateFormatSpecificRules(project)];
};

export const validateContextPlanRules = (plan: ContextPlan, skills: UniversalSkillReference[] = [], project?: Project) => {
  const issues: ProductionQAIssue[] = [];
  const allUsed = [
    ...plan.globalSkills,
    ...plan.scriptSkills,
    ...plan.visualSkills,
    ...plan.dialogueSkills,
    ...plan.pacingDNAs,
    ...plan.shotDNAs,
  ];
  const duplicated = allUsed.filter((id, index) => allUsed.indexOf(id) !== index);
  if (duplicated.length > 4) {
    issues.push(issue("contextPlan.skills", "同一批 Skill 被重复注入多个阶段，存在上下文污染风险。", "warning", "保留主用途阶段，避免全局注入。"));
  }
  const forbiddenInUse = plan.forbiddenSkills.filter((id) => allUsed.includes(id));
  if (forbiddenInUse.length > 0) {
    issues.push(issue("contextPlan.forbiddenSkills", `禁用 Skill 仍被使用：${forbiddenInUse.join(", ")}`, "blocking"));
  }
  const missingScores = skills.filter((skill) => !plan.skillScores || plan.skillScores[skill.id] === undefined);
  if (missingScores.length > 0) {
    issues.push(issue("contextPlan.skillScoring", `${missingScores.length} 个 Skill 缺少分类信号，评分可信度不足。`, "warning"));
  }
  const lowScoreInUse = allUsed.filter((id) => (plan.skillScores?.[id] ?? 100) < 35);
  if (lowScoreInUse.length > 0) {
    issues.push(issue("contextPlan.skillScoring.low", `低评分 Skill 仍被注入：${Array.from(new Set(lowScoreInUse)).join(", ")}`, "warning", "改为 forbiddenSkills 或只在人工指定阶段使用。"));
  }
  const activeSkillIds = skills.map((skill) => skill.id);
  const activeSkillIdsInUse = activeSkillIds.filter((id) => allUsed.includes(id));
  if (skills.length > 0 && activeSkillIdsInUse.length === 0) {
    issues.push(issue(
      "contextPlan.referenceNotInjected",
      "项目已选择参考 Skill，但 ContextPlan 没有把任何参考 Skill 注入到生产阶段。",
      "blocking",
      "请重新生成 ContextPlan，或把参考 Skill 明确分配到结构、剧本、视觉、对白或镜头阶段。",
    ));
  }
  const appliedDnaId = project?.appliedVADnaProjectId;
  if (appliedDnaId) {
    const hasDnaIdInPlan = plan.pacingDNAs.includes(appliedDnaId) || plan.shotDNAs.includes(appliedDnaId);
    const linkedVideoSkills = skills.filter((skill) => skill.sourceProjectId === appliedDnaId || skill.source === "video-analysis");
    if (!hasDnaIdInPlan) {
      issues.push(issue(
        "contextPlan.videoAnalysisDnaNotInjected",
        "项目已选择拉片 DNA，但 ContextPlan 没有把该 DNA 注入节奏或镜头阶段。",
        "blocking",
        "请重新生成 ContextPlan，并确保拉片 DNA 进入 pacingDNAs 或 shotDNAs。",
      ));
    }
    if (linkedVideoSkills.length === 0) {
      issues.push(issue(
        "contextPlan.videoAnalysisDnaMissingSkill",
        "项目只记录了拉片 DNA projectId，但没有可执行的 video-analysis Skill 明细，后续阶段无法知道参考了什么。",
        "blocking",
        "请重新从拉片项目生成结构、节拍或视觉 Skill，或移除该拉片 DNA 选择。",
      ));
    }
  }
  const weakStructuredSkills = skills
    .map((skill) => ({ skill, missing: missingStructuredSkillFields(skill) }))
    .filter((item) => item.missing.length > 0);
  if (weakStructuredSkills.length > 0) {
    issues.push(issue(
      "contextPlan.skillDnaSchema",
      `${weakStructuredSkills.length} 个参考 Skill 缺少正文内容，无法可靠注入后续阶段。`,
      "warning",
      weakStructuredSkills
        .slice(0, 3)
        .map((item) => `${item.skill.title || item.skill.id}: ${item.missing.join(", ")}`)
        .join("；"),
    ));
  }
  if (plan.pacingDNAs.some((id) => plan.visualSkills.includes(id) || plan.dialogueSkills.includes(id))) {
    issues.push(issue("contextPlan.dnaPollution", "拉片 DNA 同时进入对白/视觉 Skill 池，可能带入原片内容。", "warning", "DNA 仅用于节奏、冲突机制、情绪曲线和镜头策略。"));
  }
  issues.push(...detectReferenceFormatConflicts(project, skills));
  return issues;
};

export const validateBibleRules = (project: Project) => {
  const issues: ProductionQAIssue[] = [];
  const names = (project.plannedCharacters || []).map((item) => normalizeName(item.name)).filter(Boolean);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    issues.push(issue("bible.characters", `角色规划存在重复命名：${Array.from(new Set(duplicateNames)).join(", ")}`, "warning"));
  }
  if ((project.plannedCharacters || []).some((item) => !item.brief || item.brief.length < 8)) {
    issues.push(issue("bible.characters.brief", "部分角色缺少足够的人物功能说明。", "warning"));
  }
  if ((project.plannedLocations || []).length === 0) {
    issues.push(issue("bible.locations", "缺少地点规划，后续分镜和提示词锚点会不稳定。", "warning"));
  }
  if ((project.worldBuildingRules || []).some((rule) => !rule.content || rule.content.length < 8)) {
    issues.push(issue("bible.worldRules", "存在过短的世界观规则，执行性不足。", "warning"));
  }
  return issues;
};

export const validateAssetRules = (project: Project) => {
  const issues: ProductionQAIssue[] = [];
  const assetKeys = (project.assets || []).map((asset) => `${asset.type}:${normalizeName(asset.name)}`);
  const duplicates = assetKeys.filter((key, index) => assetKeys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    issues.push(issue("assets.duplicates", `资产库存在重复资产：${Array.from(new Set(duplicates)).join(", ")}`, "warning"));
  }
  const visualAssets = (project.assets || []).filter((asset) => ["location", "prop"].includes(asset.type));
  if (visualAssets.some((asset) => !asset.prompt || asset.prompt.length < 20)) {
    issues.push(issue("assets.prompts", "部分场景/道具资产缺少可用视觉提示词。", "warning"));
  }
  if ((project.characters || []).some((character) => !character.externalGoal || !character.internalDesire)) {
    issues.push(issue("characters.goals", "部分角色缺少外在目标或内在欲望。", "warning"));
  }
  const assetReferenceAudit = collectAssetReferenceAudit(project);
  const missingOrWrongTypeReferences = assetReferenceAudit.filter((item) => item.status === "missing" || item.status === "wrong_type");
  if (missingOrWrongTypeReferences.length > 0) {
    issues.push(issue(
      "assets.references.audit",
      `${missingOrWrongTypeReferences.length} 个结构化资产引用无法安全解析或类型不匹配。`,
      "blocking",
      missingOrWrongTypeReferences.slice(0, 5).map((item) => `${item.path}: ${item.message}`).join("；"),
    ));
  }
  const repairPlan = buildAssetReferenceRepairPlan(project);
  const canonicalMigrationCount = repairPlan.filter((item) => item.action === "replace_with_canonical_id").length;
  if (canonicalMigrationCount > 0) {
    issues.push(issue(
      "assets.references.canonicalIds",
      `${canonicalMigrationCount} 个结构化资产引用仍在使用名称、镜像 ID 或旧 ID，可迁移为 canonical ID。`,
      "warning",
      repairPlan.filter((item) => item.action === "replace_with_canonical_id").slice(0, 5).map((item) => `${item.path}: ${item.rawValue} -> ${item.replacementValue}`).join("；"),
    ));
  }
  const nonChineseVisualPrompts = [
    ...(project.assets || []).flatMap((asset) => [
      asset.prompt ? `asset.${asset.id}.prompt` : "",
      asset.multiViewPrompt ? `asset.${asset.id}.multiViewPrompt` : "",
      asset.panoramaPrompt ? `asset.${asset.id}.panoramaPrompt` : "",
    ].filter(Boolean).filter((target) => {
      if (target.endsWith(".prompt")) return !containsCjk(asset.prompt);
      if (target.endsWith(".multiViewPrompt")) return !containsCjk(asset.multiViewPrompt);
      return !containsCjk(asset.panoramaPrompt);
    })),
    ...(project.characters || [])
      .filter((character) => character.multiViewPrompt && !containsCjk(character.multiViewPrompt))
      .map((character) => `character.${character.id}.multiViewPrompt`),
  ];
  if (nonChineseVisualPrompts.length > 0) {
    issues.push(issue(
      "visualPrompt.language",
      `视觉生成字段建议使用中文，当前 ${nonChineseVisualPrompts.length} 个字段缺少中文可读信息：${nonChineseVisualPrompts.join(", ")}。`,
      "warning",
      "请把 asset.prompt、multiViewPrompt、panoramaPrompt 等生成字段改为中文为主，并保留必要镜头术语。",
    ));
  }
  return issues;
};

export const validateStructureRules = (project: Project, episodes: Episode[]) => {
  const issues: ProductionQAIssue[] = [];
  if (episodes.length === 0) {
    issues.push(issue("structure.episodes", "结构阶段没有分集/段落。", "blocking"));
  }
  if (episodes.some((episode) => !episode.inspiration || episode.inspiration.length < 20)) {
    issues.push(issue("structure.causality", "部分分集/段落梗概过短，因果链不可验证。", "warning"));
  }
  const target = project.targetEpisodeCount || 0;
  if (target > 0 && episodes.length < Math.min(target, 3)) {
    issues.push(issue("structure.count", `生成段落数量低于目标：${episodes.length}/${target}`, "warning"));
  }
  return [
    ...issues,
    ...validateLongFormMemoryRules(project, episodes),
    ...validateFormatSpecificRules(project, episodes),
  ];
};

export const validateSceneRules = (episodes: Episode[], project?: Project) => {
  const scenes = episodes.flatMap((episode) => episode.scenes || []);
  const issues: ProductionQAIssue[] = [];
  if (scenes.length === 0) {
    issues.push(issue("scenes", "没有可进入剧本阶段的场景。", "blocking"));
  }
  if (scenes.some((scene) => !scene.sceneGoal || !scene.environment || !scene.timeOfDay)) {
    issues.push(issue("scenes.fields", "部分场景缺少 sceneGoal/environment/timeOfDay。", "warning"));
  }
  const scenesMissingValueShift = scenes.filter((scene) =>
    !scene.valueShift?.from || !scene.valueShift?.to || !scene.valueShift?.reason,
  );
  if (scenesMissingValueShift.length > 0) {
    issues.push(issue(
      "scenes.valueShift",
      `${scenesMissingValueShift.length} 个场景缺少 valueShift.from/to/reason，无法证明场景发生了价值转换。`,
      "warning",
      "为每个场景标注开场价值、收场价值和转换原因；没有价值转换的场景应重写或合并。",
    ));
  }
  const totalDuration = scenes.reduce((sum, scene) => sum + Number(scene.targetDuration || 0), 0);
  if (totalDuration > 0 && (totalDuration < 3 || totalDuration > 240)) {
    issues.push(issue("scenes.duration", `场景总时长异常：${totalDuration} 分钟。`, "warning"));
  }
  if (project?.type === "short-drama" && scenes.length > 0 && scenes.every((scene) => !scene.hook)) {
    issues.push(issue(
      "scenes.shortDrama.hook",
      "连续短剧场景缺少 hook 字段，后续很难保证前置钩子和集尾追更欲望。",
      "warning",
      "至少为每集/关键场景标注一个可拍摄钩子或 cliffhanger。",
    ));
  }
  if (project?.type === "short-drama" && scenes.length > 0) {
    const missingCliffhanger = scenes.filter((scene) => !scene.cliffhanger && !/悬念|付费|追更|反转|cliffhanger|paywall/i.test(`${scene.description} ${scene.hook || ""}`));
    if (missingCliffhanger.length > 0) {
      issues.push(issue(
        "scenes.shortDrama.cliffhanger",
        `连续短剧 ${missingCliffhanger.length} 个场景缺少集尾追更/付费点信号。`,
        "warning",
        "为关键场景补充 cliffhanger 或付费点前置，让每集结尾形成继续观看压力。",
      ));
    }
  }
  if (project?.type === "micro-short-drama" && scenes.length > 0 && !scenes[0]?.hook) {
    issues.push(issue(
      "scenes.microShort.firstHook",
      "单集微短剧首场缺少 hook，可能无法保证前 3 秒可见冲突。",
      "warning",
      "首场 hook 应描述第一眼能看懂的冲突、异常结果、羞辱、追逐或反转证据。",
    ));
  }
  if (project?.type === "micro-short-drama" && scenes.length > 0) {
    const firstSceneText = `${scenes[0]?.hook || ""} ${scenes[0]?.description || ""}`;
    if (!/3秒|前三秒|羞辱|追逐|撞见|反转|证据|倒计时|当场|first three seconds|hook/i.test(firstSceneText)) {
      issues.push(issue(
        "scenes.microShort.threeSecondHook",
        "单集微短剧首场缺少前 3 秒可见冲突或异常结果。",
        "warning",
        "首场必须让观众第一眼看到冲突、羞辱、追逐、证据、倒计时或反转结果。",
      ));
    }
    const hasReversalSignal = scenes.some((scene) => /反转|揭面|倒计时|真相|证据|reversal|twist/i.test(`${scene.description} ${scene.hook || ""} ${scene.cliffhanger || ""}`));
    if (!hasReversalSignal) {
      issues.push(issue(
        "scenes.microShort.reversal",
        "单集微短剧缺少 90-120 秒内的反转或爽点信号。",
        "warning",
        "补充可拍摄反转、身份揭面、证据翻盘、倒计时危机或情绪偿付。",
      ));
    }
  }
  return project
    ? [
        ...issues,
        ...validateFormatSpecificRules(project, episodes),
        ...(project.projectModel === "interactive" ? validateInteractiveProjectionRules(episodes) : []),
      ]
    : issues;
};

const validateScriptBlocks = (scene: Scene, project?: Project) => {
  const issues: ProductionQAIssue[] = [];
  const blocks = scene.scriptBlocks || [];
  const actionText = blocks.filter((block) => block.type === "action").map((block) => block.content).join("\n");
  const dialogueBlocks = blocks.filter((block) => block.type === "dialogue");
  if (blocks.length === 0) {
    issues.push(issue(`scene.${scene.id}.scriptBlocks`, "场景缺少结构化剧本块。", "blocking"));
  }
  if (actionText && !hasConcreteVerb(actionText)) {
    issues.push(issue(`scene.${scene.id}.showDontTell`, "动作段落缺少可拍摄动作，疑似只在讲情绪或设定。", "warning", "用可观察动作替代心理说明。"));
  }
  const repeatedDialogue = dialogueBlocks.filter((block) => block.content.length > 0 && block.content.length < 8).length;
  if (dialogueBlocks.length >= 4 && repeatedDialogue / dialogueBlocks.length > 0.65) {
    issues.push(issue(`scene.${scene.id}.dialogueVoice`, "对白句式过短且重复，角色声线可能串味。", "warning", "为不同角色加入措辞、节奏和潜台词差异。"));
  }
  if (!scene.breakdown?.characters?.length) {
    issues.push(issue(`scene.${scene.id}.breakdown.characters`, "breakdown 缺少角色列表。", "warning"));
  }
  const nameOf = (value: string | { name?: string } | undefined) => typeof value === "string" ? value : value?.name || "";
  if (project && scene.breakdown) {
    const characterNamesWithIds = new Set((project.characters || []).map((character) => normalizeAssetRefName(character.name)));
    const locationNamesWithIds = new Set((project.assets || []).filter((asset) => asset.type === "location").map((asset) => normalizeAssetRefName(asset.name)));
    const propNamesWithIds = new Set((project.assets || []).filter((asset) => asset.type === "prop").map((asset) => normalizeAssetRefName(asset.name)));
    const matchedCharacterNames = (scene.breakdown.characters || []).filter((item) => characterNamesWithIds.has(normalizeAssetRefName(nameOf(item))));
    const matchedPropNames = (scene.breakdown.props || []).filter((item) => propNamesWithIds.has(normalizeAssetRefName(nameOf(item))));
    const matchedLocation = locationNamesWithIds.has(normalizeAssetRefName(nameOf(scene.breakdown.location)));
    if (matchedCharacterNames.length > 0 && !scene.breakdown.characterIds?.length) {
      issues.push(issue(`scene.${scene.id}.breakdown.characterIds`, "breakdown 使用了资产库角色名称，但缺少稳定 characterIds。", "blocking"));
    }
    if (matchedLocation && !scene.breakdown.locationId) {
      issues.push(issue(`scene.${scene.id}.breakdown.locationId`, "breakdown 使用了资产库地点名称，但缺少稳定 locationId。", "blocking"));
    }
    if (matchedPropNames.length > 0 && !scene.breakdown.propIds?.length) {
      issues.push(issue(`scene.${scene.id}.breakdown.propIds`, "breakdown 使用了资产库道具名称，但缺少稳定 propIds。", "blocking"));
    }
  }
  return issues;
};

const repeatedTextWarnings = (
  rows: Array<{ text?: string; target: string; episodeId?: string }>,
  label: string,
  target: string,
  thresholdRatio: number,
  minimumRepeats: number,
) => {
  const groups = new Map<string, { sample: string; count: number; targets: Set<string>; episodeIds: Set<string> }>();
  rows.forEach((row) => {
    const normalized = normalizeCreativeText(row.text);
    if (normalized.length < 8) return;
    const current = groups.get(normalized) || {
      sample: String(row.text || "").trim(),
      count: 0,
      targets: new Set<string>(),
      episodeIds: new Set<string>(),
    };
    current.count += 1;
    current.targets.add(row.target);
    if (row.episodeId) current.episodeIds.add(row.episodeId);
    groups.set(normalized, current);
  });

  const threshold = Math.max(minimumRepeats, Math.ceil(rows.length * thresholdRatio));
  return Array.from(groups.values())
    .filter((group) => group.count >= threshold && group.episodeIds.size >= 3)
    .map((group) => issue(
      target,
      `跨集${label}重复过高：「${group.sample.slice(0, 36)}」出现 ${group.count} 次，覆盖 ${group.episodeIds.size} 集，疑似模板化生产。`,
      "warning",
      "保留必要母题，但每集/每场应有独立事件、信息变化、角色反应或潜台词，避免用同一段文字批量填充。",
    ));
};

const validateCrossEpisodeScriptDiversity = (episodes: Episode[]) => {
  if (episodes.length < 3) return [];
  const scenes = episodes.flatMap((episode) =>
    (episode.scenes || []).map((scene) => ({ episode, scene })),
  );
  const dialogueRows = scenes.flatMap(({ episode, scene }) =>
    (scene.scriptBlocks || [])
      .filter((block) => block.type === "dialogue")
      .map((block) => ({
        text: block.content,
        target: `scene.${scene.id}.dialogue`,
        episodeId: episode.id,
      })),
  );
  return [
    ...repeatedTextWarnings(
      scenes.map(({ episode, scene }) => ({
        text: scene.description,
        target: `scene.${scene.id}.description`,
        episodeId: episode.id,
      })),
      "场景描述",
      "script.crossEpisode.sceneDescription",
      0.2,
      3,
    ),
    ...repeatedTextWarnings(
      scenes.map(({ episode, scene }) => ({
        text: scene.sceneGoal,
        target: `scene.${scene.id}.sceneGoal`,
        episodeId: episode.id,
      })),
      "场景目标",
      "script.crossEpisode.sceneGoal",
      0.2,
      3,
    ),
    ...repeatedTextWarnings(dialogueRows, "对白", "script.crossEpisode.dialogue", 0.15, 4),
  ];
};

export const validateScriptRules = (episodes: Episode[], project?: Project) =>
  [
    ...episodes.flatMap((episode) => (episode.scenes || []).flatMap((scene) => validateScriptBlocks(scene, project))),
    ...validateCrossEpisodeScriptDiversity(episodes),
  ];

const validateShot = (scene: Scene, shot: Shot, project?: Project) => {
  const issues: ProductionQAIssue[] = [];
  const visual = [shot.visualAction, shotPhysicalText(shot)].filter(Boolean).join(" ");
  if (!visual || !hasConcreteVerb(visual)) {
    issues.push(issue(`shot.${shot.id}.visualAction`, `分镜「${scene.title}」存在抽象或不可拍摄镜头。`, "warning"));
  }
  const missingGrammarFields = requiredShotGrammarFields
    .filter(({ key }) => !String(shot[key] || "").trim())
    .map(({ label }) => label);
  if (missingGrammarFields.length > 0) {
    issues.push(issue(
      `shot.${shot.id}.shotGrammar`,
      `分镜缺少视听语法字段：${missingGrammarFields.join(", ")}。`,
      "warning",
      "Storyboard 应声明景别、角度、运镜、焦距、布光、构图、blocking 和连续性备注，供 prompt 阶段继承。",
    ));
  }
  if (!shot.duration || shot.duration <= 0 || shot.duration > 30) {
    issues.push(issue(`shot.${shot.id}.duration`, "镜头时长缺失或异常。", "warning"));
  } else {
    const durationPolicy = evaluateStandaloneShotDuration(shot);
    if (!durationPolicy.valid) {
      issues.push(issue(
        `shot.${shot.id}.duration`,
        durationPolicy.reason || "镜头时长不符合独立视频生成要求。",
        "blocking",
        durationPolicy.requiresGrouping ? "优先与相邻短镜头编组成不少于 3 秒的视频生成单元。" : undefined,
      ));
    }
  }
  const requiredCharacterIds = (scene.breakdown?.characterIds || [])
    .map((id) => canonicalAssetId(project, "character", id) || id)
    .filter(Boolean);
  const requiredLocationId = canonicalAssetId(project, "location", scene.breakdown?.locationId) || scene.breakdown?.locationId;
  const shotCharacterIds = (shot.characterIdsInShot || [])
    .map((id) => canonicalAssetId(project, "character", id) || id)
    .filter(Boolean);
  const shotLocationId = canonicalAssetId(project, "location", shot.locationId) || shot.locationId;
  const requiredPropIds = (scene.breakdown?.propIds || [])
    .map((id) => canonicalAssetId(project, "prop", id) || id)
    .filter(Boolean);
  const dialogueSpeakerIds = (shot.dialogueLines || [])
    .map((line) => canonicalAssetId(project, "character", line.characterId) || line.characterId)
    .filter(Boolean);
  const missingDialogueSpeakerIds = dialogueSpeakerIds.filter((id) => !shotCharacterIds.includes(id));
  if (missingDialogueSpeakerIds.length > 0) {
    issues.push(issue(
      `shot.${shot.id}.characterIdsInShot`,
      `对白角色缺少稳定角色 ID 引用：${missingDialogueSpeakerIds.join(", ")}。`,
      "blocking",
    ));
  }
  if (requiredLocationId && !shotLocationId) {
    issues.push(issue(`shot.${shot.id}.locationId`, "镜头缺少稳定地点 ID 引用。", "blocking"));
  }
  if (project) {
    const shotCharacterIdSet = new Set(shotCharacterIds);
    const visibleListText = [
      visibleCharacterListText(shot.imagePrompt),
      visibleCharacterListText(shot.videoPrompt),
    ].filter(Boolean).join("、");
    const actionText = String(shot.visualAction || "");
    (project.characters || []).forEach((character) => {
      const canonicalId = canonicalAssetId(project, "character", character.id) || character.id;
      const mustBeVisible = character.name
        && (visibleListText.includes(character.name) || characterActsOnCamera(actionText, character.name));
      if (mustBeVisible && canonicalId && !shotCharacterIdSet.has(canonicalId)) {
        issues.push(issue(
          `shot.${shot.id}.visibleCharacter.${canonicalId}`,
          `镜头文本点名角色「${character.name}」，但 characterIdsInShot 未包含对应角色 ID。`,
          "blocking",
          "凡是 visualAction、imagePrompt 或 videoPrompt 中明确入画/发声/动作的角色，必须同步写入 characterIdsInShot。",
        ));
      }
    });
  }
  (shot.characterIdsInShot || []).forEach((id) => {
    const resolved = resolveAssetRef(project, "character", id);
    if ((project && !resolved) || (!project && requiredCharacterIds.length > 0 && !requiredCharacterIds.includes(id))) {
      issues.push(issue(`shot.${shot.id}.characterIdsInShot`, `镜头引用了不存在的角色 ID：${id}`, "blocking"));
    }
  });
  if (shot.locationId && ((project && !resolveAssetRef(project, "location", shot.locationId)) || (!project && requiredLocationId && shot.locationId !== requiredLocationId))) {
    issues.push(issue(`shot.${shot.id}.locationId`, `镜头引用了不存在的地点 ID：${shot.locationId}`, "blocking"));
  }
  (shot.propIds || []).forEach((id) => {
    const resolved = resolveAssetRef(project, "prop", id);
    if ((project && !resolved) || (!project && requiredPropIds.length > 0 && !requiredPropIds.includes(id))) {
      issues.push(issue(`shot.${shot.id}.propIds`, `镜头引用了不存在的道具 ID：${id}`, "blocking"));
    }
  });
  return issues;
};

export const validateStoryboardRules = (episodes: Episode[], project?: Project) => {
  const issues = episodes.flatMap((episode) =>
    (episode.scenes || []).flatMap((scene) => {
      if (!scene.shots?.length) {
        return [issue(`scene.${scene.id}.shots`, "场景缺少分镜。", "blocking")];
      }
      const shotIssues = scene.shots.flatMap((shot) => validateShot(scene, shot, project));
      const requiredPropIds = (scene.breakdown?.propIds || [])
        .map((id) => canonicalAssetId(project, "prop", id) || id)
        .filter(Boolean);
      const coveredPropIds = new Set((scene.shots || []).flatMap((shot) =>
        (shot.propIds || []).map((id) => canonicalAssetId(project, "prop", id) || id).filter(Boolean),
      ));
      if (requiredPropIds.length > 0 && requiredPropIds.every((id) => !coveredPropIds.has(id))) {
        shotIssues.push(issue(
          `scene.${scene.id}.propIds.coverage`,
          "场景 breakdown 中的关键道具没有在任何镜头中以稳定 propIds 出现。",
          "blocking",
          "关键道具不需要每镜都出现，但至少应在其被看见、交接、使用或造成影响的镜头中绑定 propIds。",
        ));
      }
      if ((scene.scriptBlocks?.length || 0) > 0 && scene.shots.length < 1) {
        shotIssues.push(issue(`scene.${scene.id}.coverage`, "分镜没有覆盖剧本。", "blocking"));
      }
      return [
        ...shotIssues,
        ...validateSceneContinuity(scene),
        ...validateShotGroupGrammar(scene),
      ];
    }),
  );
  return issues;
};

export const validatePromptRules = (episodes: Episode[], project?: Project) => {
  const issues: ProductionQAIssue[] = [];
  const shots = episodes.flatMap((episode) => (episode.scenes || []).flatMap((scene) => scene.shots || []));
  shots.forEach((shot) => {
    const imagePrompt = shot.imagePrompt || "";
    const videoPrompt = shot.videoPrompt || "";
    if (!imagePrompt || !videoPrompt) {
      issues.push(issue(`shot.${shot.id}.prompt`, "镜头缺少 imagePrompt 或 videoPrompt。", "warning"));
    }
    if (!containsCjk(imagePrompt) || !containsCjk(videoPrompt)) {
      issues.push(issue(
        `shot.${shot.id}.prompt.language`,
        "imagePrompt/videoPrompt 建议使用中文为主，当前提示词缺少中文可读信息。",
        "warning",
        "请把镜头视觉生成提示词改写为中文为主，并保留必要镜头术语、参数和资产名。",
      ));
    }
    const abstractOnly = abstractWords.some((word) => imagePrompt.includes(word)) && !hasConcreteVerb(imagePrompt);
    if (abstractOnly) {
      issues.push(issue(`shot.${shot.id}.prompt.abstract`, "提示词偏抽象，缺少可生成视觉锚点。", "warning"));
    }
    if (imagePrompt.length > 1800 || videoPrompt.length > 1800) {
      issues.push(issue(`shot.${shot.id}.prompt.length`, "提示词过长，可能降低模型执行稳定性。", "warning"));
    }
    const promptText = `${imagePrompt} ${videoPrompt}`.toLowerCase();
    const physicalValues = shotPhysicalText(shot);
    if (physicalValues && physicalParameterMatchCount(shot, promptText) < 2) {
      issues.push(issue(
        `shot.${shot.id}.prompt.physicalParameters`,
        "提示词没有明显继承分镜物理参数，可能只是剧情摘要改写。",
        "warning",
        "把 shotSize、cameraAngle、cameraMovement、focalLength、lighting、composition、blocking 等参数写进中文 imagePrompt/videoPrompt，可保留必要英文镜头术语。",
      ));
    }
    if (
      (project?.type === "short-drama" || project?.type === "micro-short-drama") &&
      !/vertical|close[- ]?up|mobile|portrait|face|expression|竖屏|近景|特写|手机|脸|表情|手部|主体/.test(promptText)
    ) {
      issues.push(issue(
        `shot.${shot.id}.prompt.mobileReadability`,
        "短剧/微短剧提示词缺少移动端可读性信号，如 vertical、close-up、face、expression。",
        "warning",
        "补充竖屏、近景主体、表情、手部动作、动作爆点等中文提示词。",
      ));
    }
    if (project?.projectModel === "interactive" && !/choice|interactive|pause|hold|ui|state|feedback|branch/.test(promptText)) {
      issues.push(issue(
        `shot.${shot.id}.prompt.interactiveState`,
        "互动项目提示词缺少选择停顿、状态反馈、UI 安全区或分支语义。",
        "warning",
        "补充 interactive hold、choice pause、state feedback、UI safe area 或 branch consequence。",
      ));
    }
  });
  return issues;
};

export const validateInteractiveScriptRules = (episodes: Episode[]) => {
  const issues: ProductionQAIssue[] = [];
  episodes.flatMap((episode) => episode.scenes || []).forEach((scene) => {
    if (!scene.sourceNodeId) return;
    const text = `${scene.script || ""}\n${(scene.scriptBlocks || []).map((block) => block.content).join("\n")}`;
    if (!/停顿|选择|等待|hold|pause|player|choice/i.test(text)) {
      issues.push(issue(`scene.${scene.id}.interactiveHold`, "互动节点剧本缺少选择前停顿或 Interactive Hold。", "warning"));
    }
    if (!/安全区|UI|字幕|选项|safe area|choice area/i.test(text)) {
      issues.push(issue(`scene.${scene.id}.uiSafeArea`, "互动节点剧本缺少 UI 安全区/选项区域提示。", "warning"));
    }
  });
  return issues;
};

export const validateInteractiveStoryboardRules = (episodes: Episode[]) => {
  const issues: ProductionQAIssue[] = [];
  episodes.flatMap((episode) => episode.scenes || []).forEach((scene) => {
    if (!scene.sourceNodeId) return;
    (scene.shots || []).forEach((shot) => {
      const text = `${shot.visualAction || ""} ${shot.videoPrompt || ""}`;
      if (!/loop|idle|微动|循环|breathing|hold/i.test(text)) {
        issues.push(issue(`shot.${shot.id}.idleLoop`, "互动待机镜头缺少循环/微动态提示。", "warning"));
      }
      if (!/safe area|UI|choice|选项|安全区/i.test(text)) {
        issues.push(issue(`shot.${shot.id}.uiComposition`, "互动镜头缺少 UI 选项安全构图约束。", "warning"));
      }
    });
  });
  return issues;
};

export const validateInteractiveProjectionRules = (episodes: Episode[]) => {
  const issues: ProductionQAIssue[] = [];
  episodes.forEach((episode) => {
    const gameData = episode.gameData as GameProjectData | undefined;
    if (!gameData?.nodes?.length) return;

    const scenes = episode.scenes || [];
    const scenesByNodeId = new Map(
      scenes
        .filter((scene) => scene.sourceNodeId || scene.id)
        .map((scene) => [scene.sourceNodeId || scene.id, scene]),
    );
    const nodeIds = new Set(gameData.nodes.map((node) => node.id));
    const projectionScenes = scenes.filter((scene) => scene.sourceNodeId || nodeIds.has(scene.id));

    if (projectionScenes.length !== gameData.nodes.length) {
      issues.push(issue(
        `episode.${episode.id}.interactiveProjection.count`,
        `互动投影 Scene 数量与 gameData 节点数量不一致：${projectionScenes.length}/${gameData.nodes.length}。`,
        "warning",
        "保存 gameData 后应自动执行 syncGameDataToEpisodeScenes，并与 gameData 同次保存。",
      ));
    }

    gameData.nodes.forEach((node) => {
      const scene = scenesByNodeId.get(node.id);
      if (!scene) {
        issues.push(issue(
          `node.${node.id}.interactiveProjection.missingScene`,
          `互动节点「${node.title || node.id}」缺少 sourceNodeId 对应的 Scene 投影。`,
          "warning",
        ));
        return;
      }
      if (scene.sourceNodeId !== node.id) {
        issues.push(issue(
          `scene.${scene.id}.interactiveProjection.sourceNodeId`,
          `Scene「${scene.title || scene.id}」没有明确声明 sourceNodeId=${node.id}。`,
          "warning",
        ));
      }
      if ((node.scriptBlocks || []).length > 0 && (scene.scriptBlocks || []).length !== (node.scriptBlocks || []).length) {
        issues.push(issue(
          `node.${node.id}.interactiveProjection.scriptBlocks`,
          `互动节点「${node.title || node.id}」的剧本块没有完整投影到 Scene。`,
          "warning",
        ));
      }
      if ((node.shots || []).length > 0 && (scene.shots || []).length !== (node.shots || []).length) {
        issues.push(issue(
          `node.${node.id}.interactiveProjection.shots`,
          `互动节点「${node.title || node.id}」的分镜没有完整投影到 Scene。`,
          "warning",
        ));
      }
      const nodeImageUrl = node.multiGrid?.imageUrl || node.shots?.[0]?.imageUrl || node.imageAssetUrl;
      const sceneImageUrl = scene.multiGrid?.imageUrl || scene.shots?.[0]?.imageUrl;
      if (nodeImageUrl && sceneImageUrl && nodeImageUrl !== sceneImageUrl) {
        issues.push(issue(
          `node.${node.id}.interactiveProjection.image`,
          `互动节点「${node.title || node.id}」的图片媒体与 Scene 投影不一致。`,
          "warning",
        ));
      }
      const nodeVideoUrl = node.multiGrid?.videoUrl || node.shots?.[0]?.videoUrl || node.videoAssetUrl;
      const sceneVideoUrl = scene.multiGrid?.videoUrl || scene.shots?.[0]?.videoUrl;
      if (nodeVideoUrl && sceneVideoUrl && nodeVideoUrl !== sceneVideoUrl) {
        issues.push(issue(
          `node.${node.id}.interactiveProjection.video`,
          `互动节点「${node.title || node.id}」的视频媒体与 Scene 投影不一致。`,
          "warning",
        ));
      }
    });

    projectionScenes.forEach((scene) => {
      const sourceNodeId = scene.sourceNodeId || scene.id;
      if (sourceNodeId && !nodeIds.has(sourceNodeId)) {
        issues.push(issue(
          `scene.${scene.id}.interactiveProjection.orphan`,
          `Scene「${scene.title || scene.id}」引用了不存在的互动节点 ${sourceNodeId}。`,
          "warning",
        ));
      }
    });
  });
  return issues;
};

export const validateGameDataRules = (gameData: GameProjectData) => {
  const issues: ProductionQAIssue[] = [];
  const variableIds = new Set((gameData.variables || []).map((variable) => variable.id).filter(Boolean));
  const variableNames = new Set((gameData.variables || []).map((variable) => variable.name).filter(Boolean));
  const impossibleConditions = (gameData.edges || []).filter((edge) => {
    const expression = edge.conditionExpression || "";
    return /1\s*==\s*0|false\s*===?\s*true|never/i.test(expression);
  });
  if (impossibleConditions.length > 0) {
    issues.push(issue("edges.conditions.impossible", `存在 ${impossibleConditions.length} 条疑似永远不成立的条件。`, "warning"));
  }
  const timerNodes = (gameData.nodes || []).filter((node) => node.uiLayout === "timer");
  const timerWithoutDefault = timerNodes.filter((node) =>
    !(gameData.edges || []).some((edge) => edge.sourceNodeId === node.id && /默认|timeout|超时|default/i.test(edge.displayText)),
  );
  if (timerWithoutDefault.length > 0) {
    issues.push(issue("nodes.timeoutDefault", `存在 ${timerWithoutDefault.length} 个 timer 节点缺少超时默认路径。`, "warning"));
  }
  const invalidActions = (gameData.nodes || []).flatMap((node) =>
    (node.onEnterActions || []).filter((action) => !variableIds.has(action.targetVariableId) && !variableNames.has(action.targetVariableId)),
  );
  if (invalidActions.length > 0) {
    issues.push(issue("nodes.onEnterActions", `存在 ${invalidActions.length} 个 onEnterAction 引用未知变量。`, "blocking"));
  }
  const nodesById = new Map((gameData.nodes || []).map((node) => [node.id, node]));
  (gameData.nodes || []).forEach((node) => {
    const outgoing = (gameData.edges || []).filter((edge) => edge.sourceNodeId === node.id);
    if (outgoing.length <= 1) return;
    const uniqueTargets = new Set(outgoing.map((edge) => edge.targetNodeId));
    const meaningfulChoices = outgoing.filter((edge) => {
      const target = nodesById.get(edge.targetNodeId);
      return Boolean(
        edge.conditionExpression ||
        target?.isEnding ||
        (target?.onEnterActions || []).length > 0 ||
        /信任|钥匙|线索|关系|代价|风险|结局|变量|trust|key|clue|risk|ending|cost/i.test(`${edge.displayText} ${target?.scriptContent || ""}`),
      );
    });
    if (uniqueTargets.size === 1) {
      issues.push(issue(
        `node.${node.id}.choices.fake`,
        `节点「${node.title}」的多个选项都指向同一目标，疑似假选择。`,
        "warning",
        "让至少一个选择改变变量、信息、关系、路径或结局概率；否则合并为单一按钮。",
      ));
    }
    if (meaningfulChoices.length < outgoing.length) {
      issues.push(issue(
        `node.${node.id}.choices.impact`,
        `节点「${node.title}」有 ${outgoing.length - meaningfulChoices.length} 个选择缺少变量、信息、关系、路径或结局影响证据。`,
        "warning",
        "为选择增加 conditionExpression、onEnterActions、不同路径、结局概率或明确的信息差。",
      ));
    }
  });
  return issues;
};

export const validateWhiteboardConsistency = (project: Project, cards: any[]): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!project || !cards || cards.length === 0) return issues;

  const cardText = cards.map(c => `${c.title} ${c.content}`).join(' ').toLowerCase();

  // 1. 人物检验
  const characters = project.characters || [];
  if (characters.length > 0) {
    const missingChars = characters.filter(c => c.name && !cardText.includes(c.name.toLowerCase()));
    if (missingChars.length === characters.length) {
      issues.push(issue(
        `whiteboard.characters.none`,
        `全局白板大纲未提及任何项目已设定的角色（如：${characters.map(c => c.name).join('、')}），这会导致故事结构与角色人设脱节。`,
        "warning"
      ));
    } else if (missingChars.length > 0) {
      issues.push(issue(
        `whiteboard.characters.partial`,
        `白板大纲中未提及部分核心角色（如：${missingChars.map(c => c.name).join('、')}）。请确认是否需要在大纲中引入。`,
        "warning"
      ));
    }
  }

  // 2. 世界观规则检验
  const rules = project.worldBuildingRules || [];
  if (rules.length > 0) {
    const matchedRules = rules.filter(r => {
      const categoryMatch = r.category && cardText.includes(r.category.toLowerCase());
      const contentKeywords = (r.content || '').split(/[,.，。\s]+/).filter((w: string) => w.length > 1);
      const keywordMatch = contentKeywords.some((w: string) => cardText.includes(w.toLowerCase()));
      return categoryMatch || keywordMatch;
    });
    if (matchedRules.length === 0) {
      issues.push(issue(
        `whiteboard.worldRules.none`,
        `全局白板大纲未消费世界观规则中的核心设定，可能导致故事背景沦为大众化套路。`,
        "warning"
      ));
    }
  }

  // 3. 结局/高潮与核心冲突/Stakes 契合度检验
  const climaxCards = cards.filter(c => c.type === 'climax');
  if (climaxCards.length === 0) {
    issues.push(issue(
      `whiteboard.climax.missing`,
      `白板结构中缺少大结局/高潮 (climax) 类型的卡片。请规划终极收尾节拍。`,
      "warning"
    ));
  }

  // 检查核心冲突/Stakes 的关键词是否在大纲中提及
  const conflictText = (project.coreConflict || '').toLowerCase();
  
  if (conflictText) {
    const conflictWords = conflictText.split(/[,.，。\s]+/).filter((w: string) => w.length > 1);
    const hasConflictWord = conflictWords.some((w: string) => cardText.includes(w));
    if (!hasConflictWord && conflictWords.length > 0) {
      issues.push(issue(
        `whiteboard.conflict.ignored`,
        `白板大纲似乎忽略了项目的核心冲突「${project.coreConflict}」。请确认大纲事件是否围绕该冲突展开。`,
        "warning"
      ));
    }
  }

  return issues;
};
