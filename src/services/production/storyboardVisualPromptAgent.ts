import { Type } from "../../clients/aiSchemaClient";
import type {
  ManualStoryboardAgentQuality,
  Shot,
} from "../../types/project";
import {
  projectStoryboardRepairQuality,
  STORYBOARD_AGENT_QUALITY_THRESHOLD,
} from "./storyboardShotAgent";
import { imagePromptHasEmbeddedAspectRatio } from "./imageGenerationRequest";

export const STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS = 3;

export interface StoryboardVisualPromptContractIssue {
  code:
    | "empty_output"
    | "duplicate_shot_id"
    | "unknown_shot_id"
    | "missing_shot"
    | "missing_visual_summary"
    | "missing_image_prompt"
    | "missing_video_prompt"
    | "platform_parameter"
    | "embedded_aspect_ratio";
  severity: "blocking" | "warning";
  message: string;
  targetShotId?: string;
}

export interface StoryboardVisualPromptValue {
  id: string;
  visualSummary: string;
  microExpression: string;
  imagePrompt: string;
  videoPrompt: string;
}

export interface StoryboardImagePromptValue {
  id: string;
  visualSummary: string;
  imagePrompt: string;
}

export interface StoryboardVideoPromptValue {
  id: string;
  videoPrompt: string;
}

export interface StoryboardVisualPromptSourceShot {
  id: string;
  duration?: number;
  motivation?: string;
  visualAction?: string;
  microExpression?: string;
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  focalLength?: string;
  lighting?: string;
  lightingAtmo?: string;
  composition?: string;
  blocking?: string;
  continuityNote?: string;
  characterIdsInShot?: string[];
  locationId?: string;
  propIds?: string[];
  dialogueLines?: Shot["dialogueLines"];
  appearance?: Shot["appearance"];
}

export const projectStoryboardVisualPromptSourceShot = (shot: StoryboardVisualPromptSourceShot) => ({
  ...(shot.appearance ? { appearance: shot.appearance } : {}),
  id: shot.id,
  duration: shot.duration || 0,
  motivation: shot.motivation || "",
  visualAction: shot.visualAction || "",
  microExpression: shot.microExpression || "",
  shotSize: shot.shotSize || "",
  cameraAngle: shot.cameraAngle || "",
  cameraMovement: shot.cameraMovement || "",
  focalLength: shot.focalLength || "",
  lighting: shot.lighting || shot.lightingAtmo || "",
  composition: shot.composition || "",
  blocking: shot.blocking || "",
  continuityNote: shot.continuityNote || "",
  characterIdsInShot: shot.characterIdsInShot || [],
  locationId: shot.locationId || "",
  propIds: shot.propIds || [],
  dialogueLines: shot.dialogueLines || [],
});

interface StoryboardVisualPromptContext {
  sceneId: string;
  sceneTitle: string;
  script: string;
  shots: StoryboardVisualPromptSourceShot[];
  productionTeamContext: string;
  formalAssetContext: string;
}

const cleanText = (value: unknown) => String(value || "").trim();

const pushUniqueIssue = (
  issues: StoryboardVisualPromptContractIssue[],
  issue: StoryboardVisualPromptContractIssue,
) => {
  if (issues.some((item) => item.code === issue.code && item.message === issue.message)) return;
  issues.push(issue);
};

const forbiddenPlatformParameters = ["--ar", "--v ", "--q ", "--stylize", "--seed"];

const storyboardRepairTargetShotIds = ({
  shots,
  contractIssues,
  quality,
}: {
  shots: StoryboardVisualPromptSourceShot[];
  contractIssues: StoryboardVisualPromptContractIssue[];
  quality?: ManualStoryboardAgentQuality;
}) => {
  const expectedShotIds = new Set(shots.map((shot) => shot.id));
  const actionableQualityIssues = (quality?.issues || []).filter((issue) => issue.severity !== "advisory");
  const repairIssues = [...contractIssues, ...actionableQualityIssues];
  const hasUntargetedIssue = repairIssues.some((issue) => (
    !issue.targetShotId || !expectedShotIds.has(issue.targetShotId)
  ));
  if (hasUntargetedIssue || repairIssues.length === 0) return shots.map((shot) => shot.id);
  return Array.from(new Set(repairIssues.map((issue) => issue.targetShotId as string)));
};

export const storyboardVisualPromptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      visualSummary: { type: Type.STRING },
      microExpression: { type: Type.STRING },
      imagePrompt: { type: Type.STRING },
      videoPrompt: { type: Type.STRING },
    },
    required: ["id", "visualSummary", "microExpression", "imagePrompt", "videoPrompt"],
  },
};

export const storyboardImagePromptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      visualSummary: { type: Type.STRING },
      imagePrompt: { type: Type.STRING },
    },
    required: ["id", "visualSummary", "imagePrompt"],
  },
};

export const storyboardVideoPromptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      videoPrompt: { type: Type.STRING },
    },
    required: ["id", "videoPrompt"],
  },
};

export const storyboardVisualPromptQualitySchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    verdict: { type: Type.STRING },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING },
          targetShotId: { type: Type.STRING },
          description: { type: Type.STRING },
          suggestion: { type: Type.STRING },
        },
        required: ["severity", "description", "suggestion"],
      },
    },
  },
  required: ["score", "verdict", "summary", "strengths", "issues"],
};

export const normalizeStoryboardVisualPrompts = (value: unknown): StoryboardVisualPromptValue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: cleanText(item.id),
      visualSummary: cleanText(item.visualSummary),
      microExpression: cleanText(item.microExpression),
      imagePrompt: cleanText(item.imagePrompt),
      videoPrompt: cleanText(item.videoPrompt),
    }));
};

export const normalizeStoryboardImagePrompts = (value: unknown): StoryboardImagePromptValue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: cleanText(item.id),
      visualSummary: cleanText(item.visualSummary),
      imagePrompt: cleanText(item.imagePrompt),
    }));
};

export const normalizeStoryboardVideoPrompts = (value: unknown): StoryboardVideoPromptValue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ id: cleanText(item.id), videoPrompt: cleanText(item.videoPrompt) }));
};

const validatePromptCoverage = <T extends { id: string }>({
  values,
  shots,
  validateValue,
}: {
  values: T[];
  shots: Shot[];
  validateValue: (value: T) => StoryboardVisualPromptContractIssue[];
}) => {
  if (!values.length) {
    return [{ code: "empty_output", severity: "blocking", message: "模型没有返回提示词。" }] as StoryboardVisualPromptContractIssue[];
  }
  const issues: StoryboardVisualPromptContractIssue[] = [];
  const expectedIds = new Set(shots.map((shot) => shot.id));
  const returnedIds = new Set<string>();
  values.forEach((value) => {
    if (!expectedIds.has(value.id)) {
      pushUniqueIssue(issues, {
        code: "unknown_shot_id",
        severity: "blocking",
        message: `模型返回了不属于当前场的 Shot ID：${value.id || "空 ID"}`,
        targetShotId: value.id || undefined,
      });
      return;
    }
    if (returnedIds.has(value.id)) {
      pushUniqueIssue(issues, {
        code: "duplicate_shot_id",
        severity: "blocking",
        message: `Shot ${value.id} 被重复返回。`,
        targetShotId: value.id,
      });
    }
    returnedIds.add(value.id);
    validateValue(value).forEach((issue) => pushUniqueIssue(issues, issue));
  });
  shots.forEach((shot) => {
    if (returnedIds.has(shot.id)) return;
    pushUniqueIssue(issues, {
      code: "missing_shot",
      severity: "blocking",
      message: `模型没有返回 Shot ${shot.id} 的提示词。`,
      targetShotId: shot.id,
    });
  });
  return issues;
};

export const validateStoryboardImagePromptContract = ({
  prompts,
  shots,
}: {
  prompts: StoryboardImagePromptValue[];
  shots: Shot[];
}) => validatePromptCoverage({
  values: prompts,
  shots,
  validateValue: (prompt) => {
    const issues: StoryboardVisualPromptContractIssue[] = [];
    if (!prompt.visualSummary) issues.push({ code: "missing_visual_summary", severity: "blocking", message: `Shot ${prompt.id} 缺少画面摘要。`, targetShotId: prompt.id });
    if (!prompt.imagePrompt) issues.push({ code: "missing_image_prompt", severity: "blocking", message: `Shot ${prompt.id} 缺少图片提示词。`, targetShotId: prompt.id });
    const platformParameter = forbiddenPlatformParameters.find((token) => prompt.imagePrompt.toLowerCase().includes(token));
    if (platformParameter) issues.push({ code: "platform_parameter", severity: "blocking", message: `Shot ${prompt.id} 包含平台专属参数 ${platformParameter.trim()}。`, targetShotId: prompt.id });
    if (imagePromptHasEmbeddedAspectRatio(prompt.imagePrompt)) {
      issues.push({ code: "embedded_aspect_ratio", severity: "blocking", message: `Shot ${prompt.id} 在图片提示词中重复写入画幅比例；画幅只由执行层结构化参数传递。`, targetShotId: prompt.id });
    }
    return issues;
  },
});

export const validateStoryboardVideoPromptContract = ({
  prompts,
  shots,
}: {
  prompts: StoryboardVideoPromptValue[];
  shots: Shot[];
}) => validatePromptCoverage({
  values: prompts,
  shots,
  validateValue: (prompt) => {
    const issues: StoryboardVisualPromptContractIssue[] = [];
    if (!prompt.videoPrompt) issues.push({ code: "missing_video_prompt", severity: "blocking", message: `Shot ${prompt.id} 缺少视频提示词。`, targetShotId: prompt.id });
    const platformParameter = forbiddenPlatformParameters.find((token) => prompt.videoPrompt.toLowerCase().includes(token));
    if (platformParameter) issues.push({ code: "platform_parameter", severity: "blocking", message: `Shot ${prompt.id} 包含平台专属参数 ${platformParameter.trim()}。`, targetShotId: prompt.id });
    return issues;
  },
});

export const validateStoryboardVisualPromptContract = ({
  prompts,
  shots,
}: {
  prompts: StoryboardVisualPromptValue[];
  shots: Shot[];
}): StoryboardVisualPromptContractIssue[] => {
  if (!prompts.length) {
    return [{ code: "empty_output", severity: "blocking", message: "模型没有返回视觉提示词。" }];
  }

  const issues: StoryboardVisualPromptContractIssue[] = [];
  const expectedIds = new Set(shots.map((shot) => shot.id));
  const returnedIds = new Set<string>();

  prompts.forEach((prompt) => {
    if (!expectedIds.has(prompt.id)) {
      pushUniqueIssue(issues, {
        code: "unknown_shot_id",
        severity: "blocking",
        message: `模型返回了不属于当前场的 Shot ID：${prompt.id || "空 ID"}`,
        targetShotId: prompt.id || undefined,
      });
      return;
    }
    if (returnedIds.has(prompt.id)) {
      pushUniqueIssue(issues, {
        code: "duplicate_shot_id",
        severity: "blocking",
        message: `Shot ${prompt.id} 被重复返回。`,
        targetShotId: prompt.id,
      });
    }
    returnedIds.add(prompt.id);

    if (!prompt.visualSummary) {
      pushUniqueIssue(issues, {
        code: "missing_visual_summary",
        severity: "warning",
        message: `Shot ${prompt.id} 缺少视觉摘要。`,
        targetShotId: prompt.id,
      });
    }
    if (!prompt.imagePrompt) {
      pushUniqueIssue(issues, {
        code: "missing_image_prompt",
        severity: "blocking",
        message: `Shot ${prompt.id} 缺少图片提示词。`,
        targetShotId: prompt.id,
      });
    }
    if (!prompt.videoPrompt) {
      pushUniqueIssue(issues, {
        code: "missing_video_prompt",
        severity: "blocking",
        message: `Shot ${prompt.id} 缺少视频提示词。`,
        targetShotId: prompt.id,
      });
    }
    const combinedPrompt = `${prompt.imagePrompt} ${prompt.videoPrompt}`.toLowerCase();
    const platformParameter = forbiddenPlatformParameters.find((token) => combinedPrompt.includes(token));
    if (platformParameter) {
      pushUniqueIssue(issues, {
        code: "platform_parameter",
        severity: "blocking",
        message: `Shot ${prompt.id} 包含平台专属参数 ${platformParameter.trim()}。`,
        targetShotId: prompt.id,
      });
    }
    if (imagePromptHasEmbeddedAspectRatio(prompt.imagePrompt)) {
      pushUniqueIssue(issues, {
        code: "embedded_aspect_ratio",
        severity: "blocking",
        message: `Shot ${prompt.id} 在图片提示词中重复写入画幅比例；画幅只由执行层结构化参数传递。`,
        targetShotId: prompt.id,
      });
    }
  });

  shots.forEach((shot) => {
    if (returnedIds.has(shot.id)) return;
    pushUniqueIssue(issues, {
      code: "missing_shot",
      severity: "blocking",
      message: `模型没有返回 Shot ${shot.id} 的视觉提示词。`,
      targetShotId: shot.id,
    });
  });
  return issues;
};

export const buildStoryboardVisualPromptQualityPrompt = ({
  context,
  candidateShots,
}: {
  context: StoryboardVisualPromptContext;
  candidateShots: Shot[];
}) => {
  const preparationBlocks = [
    context.productionTeamContext ? `【原文、相邻场次与已采用制作结果】\n${context.productionTeamContext}` : "",
    context.formalAssetContext ? `【当前场正式资产、变体与参考板】\n${context.formalAssetContext}` : "",
  ].filter(Boolean).join("\n\n");
  return `你负责独立检查视觉提示词是否忠实、可执行并能维持跨镜头资产一致性。只返回评分、简短结论和可定位问题。

【通过门槛】
- 总分必须达到 ${STORYBOARD_AGENT_QUALITY_THRESHOLD} 分。
- 不得存在 blocking 或 warning 问题；仅 advisory 可以随通过结论保留。
- verdict 只有在同时满足上述条件时才能为 pass，否则必须为 revise。
- issues.targetShotId 必须从候选 Shot 的 id 字段逐字复制完整 ID；不得写 shot-1、镜头1等简写。

【评分维度】
1. Shot 忠实度 25 分：提示词不得改变导演 Shot 的人物、动作、对白原文、说话人、重复次数、先后顺序、道具状态、构图、机位、镜头运动和信息揭示顺序。作者要求的画内文字与屏幕内容必须保留，不得当成杂字删除。
2. 资产身份与状态一致性 20 分：角色、场景、道具必须使用正式资产和当前变体；跨镜头身份、服化、伤痕、持物、空间方位连续。
3. 图片提示词可执行性 15 分：描述一个明确可生成的静止关键帧，主体、位置、构图、光线、镜头光学和可见动作清晰，不依赖时间过程才能成立。
4. 视频提示词可执行性 15 分：明确起始状态、主体动作、物体位移、镜头运动和结束状态，动作幅度适配 Shot 时长，不与图片起始帧冲突。
5. 摄影、灯光与空间物理 10 分：时间、内外景、实际光源、轴线、视线、景深和焦点变化合理。
6. 可观察表演落地 10 分：只依据剧本、已确认台词样本与表演方式检查眼神、肌肉、呼吸、姿态和动作选择；不得要求或补造人格类型与心理档案。
7. 整场统一性 5 分：画幅、视觉风格、色光逻辑、角色称谓和资产锚点在全部 Shot 中稳定。

【必须判为需修订的情况】
- 使用抽象情绪代替可见表演，或只写空泛的画质词。
- imagePrompt 主要描述连续运动，无法确定单帧画面。
- 对确实要求变化的镜头，videoPrompt 漏掉已声明的动作、变化或摄影机运动；作者要求静止、等待、沉默或固定镜头时，明确保持状态与时长即可，不得为通过质检强加动作、切镜或拟音。
- 漏写镜头内可见角色、关键道具或正式资产状态，或凭空增加资产与剧情事实。
- 使用任何具体图像/视频平台的命令参数。

【场次事实源】
sceneId: ${context.sceneId}
sceneTitle: ${context.sceneTitle}
script:
${context.script}

${preparationBlocks}

【已确认 Shot 计划】
${JSON.stringify(context.shots.map(projectStoryboardVisualPromptSourceShot), null, 2)}

【候选视觉提示词】
${JSON.stringify(candidateShots.map((shot) => ({
  id: shot.id,
  visualSummary: shot.visualSummary,
  microExpression: shot.microExpression,
  imagePrompt: shot.imagePrompt,
  videoPrompt: shot.videoPrompt,
})), null, 2)}

请只返回 JSON 对象：
{
  "score": 0-100,
  "verdict": "pass" | "revise",
  "summary": "简洁结论",
  "strengths": ["已达标项"],
  "issues": [{
    "severity": "blocking" | "warning" | "advisory",
    "targetShotId": "可选的 Shot id",
    "description": "基于事实源的具体问题",
    "suggestion": "可执行修正"
  }]
}`;
};

export const buildStoryboardVisualPromptRepairPrompt = ({
  context,
  prompts,
  contractIssues,
  quality,
}: {
  context: StoryboardVisualPromptContext;
  prompts: StoryboardVisualPromptValue[];
  contractIssues: StoryboardVisualPromptContractIssue[];
  quality?: ManualStoryboardAgentQuality;
}) => {
  const targetShotIds = storyboardRepairTargetShotIds({ shots: context.shots, contractIssues, quality });
  const targetShotIdSet = new Set(targetShotIds);
  const targetShots = context.shots.filter((shot) => targetShotIdSet.has(shot.id));
  const targetPrompts = prompts.filter((prompt) => targetShotIdSet.has(prompt.id));
  const preparationBlocks = [
    context.productionTeamContext ? `【原文、相邻场次与已采用制作结果】\n${context.productionTeamContext}` : "",
    context.formalAssetContext ? `【当前场正式资产、变体与参考板】\n${context.formalAssetContext}` : "",
  ].filter(Boolean).join("\n\n");

  return `你是视觉提示词 Agent 的修订环节。根据已确认 Shot、正式资产和质检意见只修订被点名的候选，直接返回本轮允许修改的 Shot JSON 数组，不要解释，也不要输出内部思维链。

【不可改变的边界】
1. Shot ID、镜头顺序、人物、道具、地点、动作、构图、机位、镜头运动、时长和剧情事实都以已确认 Shot 为准，不得重写导演方案。
2. 只使用正式资产上下文中的身份和状态。人物档案只用于推演可见表演，不得推导外貌、族裔、阶层、年龄或服装刻板印象。
3. imagePrompt 必须是明确的静止关键帧；videoPrompt 必须在该关键帧基础上说明动作、位移、镜头运动和结束状态。
4. 不使用空泛画质词、平台参数、生成工具 UI 或水印。情绪要有适合媒介的可见依据；剧本或作者要求的画内文字、字幕、信件和屏幕界面必须保留原文及叙事作用，不得当成杂字删除。
5. 采取最小修改：只返回并修改结构检查或独立质检点名的 Shot 与字段；未被点名的提示词由系统保留，不要在本轮返回。
6. 只允许返回下方“本轮允许修改的 Shot ID”，每个允许 ID 恰好返回一次，不得缺失、重复或增加。
7. 本轮必须实际改动每个被点名 Shot 的相关字段，不得原样返回质检已经判定有问题的文本。修正后逐条对照质检描述自检。
8. imagePrompt 固定一个精确时刻；videoPrompt 必须从同一个时刻出发。例如质检指出动作时序矛盾时，可把 imagePrompt 改成动作的明确起始态或中间态，再让 videoPrompt 从该状态运动到明确结束态。
9. 质检指出视频缺少状态变化时，先核对 Shot 是否要求变化；有变化则写明起始、过程和结束。作者要求静止或等待时保留保持状态与时长，不因质检意见擅自增加动作、切镜或声音。

【场次事实源】
sceneId: ${context.sceneId}
sceneTitle: ${context.sceneTitle}
script:
${context.script}

【本轮允许修改的 Shot ID】
${targetShotIds.join("\n")}

【这些 Shot 的已确认导演计划】
${JSON.stringify(targetShots.map(projectStoryboardVisualPromptSourceShot), null, 2)}

${preparationBlocks}

【修订依据】
只依据上方边界、已确认 Shot、制片筹备、正式资产和下方质检意见修订，不要重做未点名的 Shot。

【这些 Shot 的当前候选】
${JSON.stringify(targetPrompts, null, 2)}

【结构检查问题】
${contractIssues.length ? contractIssues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n") : "结构检查已通过。"}

【独立质检意见】
${quality ? JSON.stringify(projectStoryboardRepairQuality(quality), null, 2) : "本轮仅处理上述结构问题。"}

请只返回上述允许 ID 的修订后视觉提示词 JSON 数组。`;
};

const buildSeparatedPromptQualityPrompt = ({
  kind,
  context,
  candidateShots,
}: {
  kind: "image" | "video";
  context: StoryboardVisualPromptContext;
  candidateShots: Shot[];
}) => {
  const preparationContext = [context.productionTeamContext, context.formalAssetContext].filter(Boolean).join("\n\n");
  return `你负责独立检查${kind === "image" ? "电影摄影与静帧" : "视频运动与剪辑"}提示词。只返回评分、简短结论和可定位问题。

【通过门槛】
- 总分达到 ${STORYBOARD_AGENT_QUALITY_THRESHOLD}，verdict=pass，且没有 blocking/warning。
- 只检查本次的${kind === "image" ? "图片提示词" : "视频提示词"}，不得因另一类提示词缺失而扣分。
- targetShotId 必须逐字复制候选 Shot id。

【检查重点】
${kind === "image"
    ? "1. 单帧构图、主体位置、资产身份、光线、景别和可见表演明确。\n2. 不依赖连续运动才能成立，不含平台专属参数。\n3. 与 Shot 调度、轴线、道具状态和正式资产一致。"
    : "1. 起始状态、主体动作、物体位移、镜头运动和结束状态明确。\n2. 动作量适配 Shot 时长，可直接用于视频生成，不含平台专属参数。\n3. 与 Shot 调度、连续性、资产状态和对白节奏一致。"}

【剧本与已确认 Shot】
${context.script}
${JSON.stringify(context.shots.map(projectStoryboardVisualPromptSourceShot), null, 2)}

${preparationContext ? `【正式筹备与资产】\n${preparationContext}` : ""}

【本次候选】
${JSON.stringify(candidateShots.map((shot) => kind === "image" ? {
    id: shot.id,
    visualSummary: shot.visualSummary,
    microExpression: shot.microExpression,
    imagePrompt: shot.imagePrompt,
  } : {
    id: shot.id,
    duration: shot.duration,
    videoPrompt: shot.videoPrompt,
  }), null, 2)}

只返回 JSON：{"score":0-100,"verdict":"pass"|"revise","summary":"结论","strengths":["达标项"],"issues":[{"severity":"blocking"|"warning"|"advisory","targetShotId":"Shot id","description":"问题","suggestion":"修正"}]}`;
};

export const buildStoryboardImagePromptQualityPrompt = (options: {
  context: StoryboardVisualPromptContext;
  candidateShots: Shot[];
}) => buildSeparatedPromptQualityPrompt({ kind: "image", ...options });

export const buildStoryboardVideoPromptQualityPrompt = (options: {
  context: StoryboardVisualPromptContext;
  candidateShots: Shot[];
}) => buildSeparatedPromptQualityPrompt({ kind: "video", ...options });

const buildSeparatedPromptRepairPrompt = ({
  kind,
  context,
  values,
  contractIssues,
  quality,
}: {
  kind: "image" | "video";
  context: StoryboardVisualPromptContext;
  values: StoryboardImagePromptValue[] | StoryboardVideoPromptValue[];
  contractIssues: StoryboardVisualPromptContractIssue[];
  quality?: ManualStoryboardAgentQuality;
}) => {
  const targetShotIds = storyboardRepairTargetShotIds({ shots: context.shots, contractIssues, quality });
  const targetShotIdSet = new Set(targetShotIds);
  const targetShots = context.shots.filter((shot) => targetShotIdSet.has(shot.id));
  const targetValues = values.filter((value) => targetShotIdSet.has(value.id));
  const preparationContext = [context.productionTeamContext, context.formalAssetContext].filter(Boolean).join("\n\n");
  return `你是${kind === "image" ? "图片" : "视频"}提示词修订 Agent。只修订本次提示词，不得改写 Shot 结构或另一类提示词。只返回本轮允许修改的 Shot JSON 数组。

【本轮允许修改的 Shot ID】
${targetShotIds.join("\n")}

每个允许 ID 恰好返回一次，不得缺失、重复、增加或返回未被点名的 Shot。系统会保留其他 Shot 的当前提示词。

【剧本与已确认 Shot】
${context.script}
${JSON.stringify(targetShots.map(projectStoryboardVisualPromptSourceShot), null, 2)}

${preparationContext ? `【正式筹备与资产】\n${preparationContext}` : ""}

【当前候选】
${JSON.stringify(targetValues, null, 2)}

【结构问题】
${contractIssues.length ? contractIssues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n") : "结构检查已通过。"}

【独立质检】
${quality ? JSON.stringify(projectStoryboardRepairQuality(quality), null, 2) : "本轮仅处理上述结构问题。"}

输出字段：${kind === "image"
    ? '[{"id":"原 Shot id","visualSummary":"画面摘要","imagePrompt":"图片提示词"}]'
    : '[{"id":"原 Shot id","videoPrompt":"视频提示词"}]'}`;
};

export const buildStoryboardImagePromptRepairPrompt = (options: Omit<Parameters<typeof buildSeparatedPromptRepairPrompt>[0], "kind">) =>
  buildSeparatedPromptRepairPrompt({ kind: "image", ...options });

export const buildStoryboardVideoPromptRepairPrompt = (options: Omit<Parameters<typeof buildSeparatedPromptRepairPrompt>[0], "kind">) =>
  buildSeparatedPromptRepairPrompt({ kind: "video", ...options });
