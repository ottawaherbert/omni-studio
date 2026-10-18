import { appearanceContract } from "../../config/prompts/appearanceContract";
import { directorPlanContract } from "../../config/prompts/directorPlanContract";
import type { SceneDirectorPlan } from "../../../packages/domain/src/directorPlan";
import { Type } from "../../clients/aiSchemaClient";
import type {
  ManualStoryboardAgentQuality,
  Project,
  Shot,
} from "../../types/project";
import { estimateShotDialogueDurationSeconds } from "./storyboardDialogueTiming";
import { projectShotForManualStoryboardPrompt } from "./manualVideoStoryboard";

export const STORYBOARD_AGENT_QUALITY_THRESHOLD = 90;
export const STORYBOARD_AGENT_MAX_REPAIRS = 3;
export const STORYBOARD_DURATION_TOLERANCE_RATIO = 0.12;
export const STORYBOARD_DURATION_TOLERANCE_FLOOR_SECONDS = 8;

export interface StoryboardShotContractIssue {
  code:
    | "empty_output"
    | "missing_visual_action"
    | "invalid_duration"
    | "missing_continuity"
    | "missing_staging"
    | "unknown_character"
    | "unknown_prop"
    | "unknown_vehicle"
    | "unknown_location"
    | "asset_out_of_scope"
    | "invalid_dialogue_speaker"
    | "dialogue_capacity_exceeded"
    | "duration_mismatch";
  severity: "blocking" | "warning";
  message: string;
  targetShotIndex?: number;
}

export interface StoryboardAssetScope {
  character: string[];
  location: string[];
  prop: string[];
  vehicles?: string[];
}

interface ValidateStoryboardShotContractOptions {
  rawShots: Array<Record<string, unknown>>;
  normalizedShots: Shot[];
  targetDurationSeconds: number;
  enforceAssetScope: boolean;
  allowedAssetIds?: StoryboardAssetScope;
  allowedUnboundSpeakerNames?: string[];
  requireLocation?: boolean;
  resolveAssetId: (type: keyof StoryboardAssetScope, value: string) => string | undefined;
}

const cleanText = (value: unknown) => String(value || "").trim();

export const resolveStoryboardVehicleId = (project: Project | null, value?: string): string | undefined => {
  const raw = cleanText(value);
  if (!raw) return undefined;
  const vehicles = (project?.assets || []).filter((asset) => asset.type === "vehicles");
  const exact = vehicles.find((asset) => asset.id === raw);
  if (exact) return exact.id;
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, "");
  const normalized = normalize(raw);
  const matches = vehicles.filter((asset) => [asset.name, ...(asset.aliases || [])]
    .some((name) => normalize(name) === normalized));
  return matches.length === 1 ? matches[0].id : undefined;
};

const cleanStringList = (value: unknown) =>
  Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];

export const projectStoryboardRepairQuality = (quality?: ManualStoryboardAgentQuality) => {
  if (!quality) return undefined;
  return {
    summary: cleanText(quality.summary),
    issues: quality.issues
      .filter((issue) => issue.severity !== "advisory")
      .map((issue) => ({
        severity: issue.severity,
        targetShotId: issue.targetShotId,
        targetPanelId: issue.targetPanelId,
        description: issue.description,
        suggestion: issue.suggestion,
      })),
  };
};

const pushUniqueIssue = (
  issues: StoryboardShotContractIssue[],
  issue: StoryboardShotContractIssue,
) => {
  if (issues.some((item) => item.code === issue.code && item.message === issue.message)) return;
  issues.push(issue);
};

export const storyboardShotSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      sourceShotId: { type: Type.STRING },
      directorPlan: { type: Type.OBJECT, properties: {
        intent: { type: Type.STRING }, rhythm: { type: Type.STRING },
        applications: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          skillId: { type: Type.STRING }, methodId: { type: Type.STRING }, dimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
          method: { type: Type.STRING }, evidence: { type: Type.STRING }, decision: { type: Type.STRING },
          shotNumbers: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        } } }, exceptions: { type: Type.ARRAY, items: { type: Type.STRING } },
      } },
      directing: { type: Type.OBJECT, properties: {
        sourceShotId: { type: Type.STRING },
        dialogue: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          lineIndex: { type: Type.NUMBER }, instruction: { type: Type.STRING }, startSeconds: { type: Type.NUMBER },
        } } },
        soundCues: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          type: { type: Type.STRING, enum: ["sfx", "bgm"] }, description: { type: Type.STRING },
          startSeconds: { type: Type.NUMBER }, durationSeconds: { type: Type.NUMBER }, linkedAssetId: { type: Type.STRING },
        } } },
      } },
      appearance: { type: Type.OBJECT, properties: { states: { type: Type.ARRAY, items: {
        type: Type.OBJECT, properties: {
          ...Object.fromEntries(["assetId", "assetName", "timelineKey", "origin", "evidence", "event", "continuity", "inheritFromShotId", "imageMoment", "referenceNeed", "existingVariantId"].map(key => [key, { type: Type.STRING }])),
          ...Object.fromEntries(["startChanges", "endChanges"].map(key => [key, { type: Type.OBJECT, properties: Object.fromEntries(["clothing", "dirt", "injury", "hair", "makeup", "other"].map(field => [field, { type: Type.STRING }])) }])),
        },
      } } } },
      motivation: { type: Type.STRING },
      visualAction: { type: Type.STRING },
      microExpression: { type: Type.STRING },
      soundDesign: { type: Type.STRING },
      editingNote: { type: Type.STRING },
      transition: { type: Type.STRING, enum: ["none", "fade", "black"] },
      shotSize: { type: Type.STRING },
      cameraAngle: { type: Type.STRING },
      cameraMovement: { type: Type.STRING },
      focalLength: { type: Type.STRING },
      lighting: { type: Type.STRING },
      composition: { type: Type.STRING },
      blocking: { type: Type.STRING },
      continuityNote: { type: Type.STRING },
      lightingAtmo: { type: Type.STRING },
      voiceover: { type: Type.STRING },
      characterId: { type: Type.STRING },
      dialogueLines: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            characterId: { type: Type.STRING },
            speakerName: { type: Type.STRING },
            delivery: { type: Type.STRING, enum: ["on_screen", "off_screen", "voice_over", "phone"] },
            text: { type: Type.STRING },
          },
          required: ["text"],
        },
      },
      characterIdsInShot: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      locationId: { type: Type.STRING },
      propIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      vehicleIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      duration: { type: Type.NUMBER },
    },
    required: [
      "motivation",
      "visualAction",
      "shotSize",
      "cameraAngle",
      "cameraMovement",
      "focalLength",
      "composition",
      "blocking",
      "continuityNote",
      "duration",
      "characterIdsInShot",
    ],
  },
};

export const storyboardShotQualitySchema = {
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

export const validateStoryboardShotContract = ({
  rawShots,
  normalizedShots,
  targetDurationSeconds,
  enforceAssetScope,
  allowedAssetIds,
  allowedUnboundSpeakerNames = [],
  requireLocation = Boolean(allowedAssetIds?.location.length),
  resolveAssetId,
}: ValidateStoryboardShotContractOptions): StoryboardShotContractIssue[] => {
  const issues: StoryboardShotContractIssue[] = [];
  if (!rawShots.length || !normalizedShots.length) {
    return [{ code: "empty_output", severity: "blocking", message: "模型没有返回可执行的 Shot。" }];
  }

  rawShots.forEach((rawShot, index) => {
    const shotNumber = index + 1;
    if (!cleanText(rawShot.visualAction)) {
      pushUniqueIssue(issues, {
        code: "missing_visual_action",
        severity: "blocking",
        message: `Shot ${shotNumber} 缺少可见动作。`,
        targetShotIndex: index,
      });
    }
    if (!(Number(rawShot.duration) > 0)) {
      pushUniqueIssue(issues, {
        code: "invalid_duration",
        severity: "blocking",
        message: `Shot ${shotNumber} 缺少有效时长。`,
        targetShotIndex: index,
      });
    }
    if (!cleanText(rawShot.continuityNote)) {
      pushUniqueIssue(issues, {
        code: "missing_continuity",
        severity: "blocking",
        message: `Shot ${shotNumber} 缺少轴线、视线、动作和空间连续性说明。`,
        targetShotIndex: index,
      });
    }
    if (!cleanText(rawShot.blocking) || !cleanText(rawShot.composition)) {
      pushUniqueIssue(issues, {
        code: "missing_staging",
        severity: "blocking",
        message: `Shot ${shotNumber} 缺少可执行的调度或构图。`,
        targetShotIndex: index,
      });
    }

    const validateRefs = (
      type: keyof StoryboardAssetScope,
      values: string[],
      unknownCode: StoryboardShotContractIssue["code"],
      label: string,
    ) => {
      values.forEach((value) => {
        const canonicalId = resolveAssetId(type, value);
        if (!canonicalId) {
          pushUniqueIssue(issues, {
            code: unknownCode,
            severity: "blocking",
            message: `Shot ${shotNumber} 引用了未知${label} ID：${value}`,
            targetShotIndex: index,
          });
          return;
        }
        if (enforceAssetScope && allowedAssetIds && !(allowedAssetIds[type] || []).includes(canonicalId)) {
          pushUniqueIssue(issues, {
            code: "asset_out_of_scope",
            severity: "blocking",
            message: `Shot ${shotNumber} 引用了不属于当前场景正式资产包的${label}：${value}`,
            targetShotIndex: index,
          });
        }
      });
    };

    validateRefs("character", cleanStringList(rawShot.characterIdsInShot), "unknown_character", "角色");
    validateRefs("prop", cleanStringList(rawShot.propIds), "unknown_prop", "道具");
    validateRefs("vehicles", cleanStringList(rawShot.vehicleIds), "unknown_vehicle", "交通工具");
    const locationId = cleanText(rawShot.locationId);
    if (locationId) {
      validateRefs("location", [locationId], "unknown_location", "场景");
    } else if (enforceAssetScope && requireLocation) {
      pushUniqueIssue(issues, {
        code: "unknown_location",
        severity: "blocking",
        message: `Shot ${shotNumber} 缺少当前场景地点 ID。`,
        targetShotIndex: index,
      });
    }

    const dialogueLines = Array.isArray(rawShot.dialogueLines) ? rawShot.dialogueLines : [];
    dialogueLines.forEach((line, lineIndex) => {
      const record = line && typeof line === "object" ? line as Record<string, unknown> : {};
      if (!cleanText(record.text)) return;
      const speakerId = cleanText(record.characterId);
      const speakerName = cleanText(record.speakerName);
      const validFormalSpeaker = Boolean(speakerId && resolveAssetId("character", speakerId));
      const validSceneLocalSpeaker = Boolean(!speakerId && speakerName && allowedUnboundSpeakerNames.includes(speakerName));
      if (!validFormalSpeaker && !validSceneLocalSpeaker) {
        pushUniqueIssue(issues, {
          code: "invalid_dialogue_speaker",
          severity: "blocking",
          message: `Shot ${shotNumber} 台词 ${lineIndex + 1} 缺少有效正式角色 ID 或本场临时人物名称。`,
          targetShotIndex: index,
        });
      }
    });
    const declaredDuration = Number(rawShot.duration);
    const estimatedDialogueDuration = estimateShotDialogueDurationSeconds(dialogueLines.map((line) => ({
      text: cleanText(line && typeof line === "object" ? (line as Record<string, unknown>).text : ""),
    })));
    if (declaredDuration > 0 && estimatedDialogueDuration > declaredDuration) {
      pushUniqueIssue(issues, {
        code: "dialogue_capacity_exceeded",
        severity: "warning",
        message: `Shot ${shotNumber} 的对白估算需要 ${estimatedDialogueDuration} 秒，但作者明确镜头时长为 ${declaredDuration} 秒；系统已保留原时长，请拆分镜头、精简对白或把对白分配到相邻镜头。`,
        targetShotIndex: index,
      });
    }
  });

  if (targetDurationSeconds > 0) {
    const totalDuration = normalizedShots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
    const tolerance = Math.max(
      STORYBOARD_DURATION_TOLERANCE_FLOOR_SECONDS,
      targetDurationSeconds * STORYBOARD_DURATION_TOLERANCE_RATIO,
    );
    if (Math.abs(totalDuration - targetDurationSeconds) > tolerance) {
      pushUniqueIssue(issues, {
        code: "duration_mismatch",
        severity: "warning",
        message: `Shot 总时长 ${Math.round(totalDuration)} 秒，与本场目标 ${Math.round(targetDurationSeconds)} 秒偏差超过 ${Math.round(tolerance)} 秒。`,
      });
    }
  }

  return issues;
};

export const normalizeStoryboardAgentQuality = (value: unknown): ManualStoryboardAgentQuality => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawScore = Number(record.score) || 0;
  const normalizedScore = rawScore > 0 && rawScore <= 10 ? rawScore * 10 : rawScore;
  const rawIssues = Array.isArray(record.issues) ? record.issues : [];
  const issues = rawIssues.map((value) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const severity: "blocking" | "warning" | "advisory" = item.severity === "blocking" || item.severity === "advisory"
      ? item.severity
      : "warning";
    return {
      severity,
      targetShotId: cleanText(item.targetShotId) || undefined,
      description: cleanText(item.description),
      suggestion: cleanText(item.suggestion),
    };
  }).filter((item) => item.description);

  return {
    ...(record.reviewKind === "author_self_review" ? { reviewKind: "author_self_review" as const } : {}),
    score: Math.max(0, Math.min(100, normalizedScore)),
    verdict: record.verdict === "pass" ? "pass" : "revise",
    summary: cleanText(record.summary),
    strengths: cleanStringList(record.strengths),
    issues,
  };
};

export const isStoryboardAgentQualityPassing = (quality: ManualStoryboardAgentQuality) =>
  quality.score >= STORYBOARD_AGENT_QUALITY_THRESHOLD
  && !quality.issues.some((issue) => issue.severity === "blocking" || issue.severity === "warning");

export const resolveStoryboardQualityTargetShotId = (value: unknown, shots: Shot[]) => {
  const target = cleanText(value);
  if (!target) return undefined;
  const exact = shots.find((shot) => shot.id === target);
  if (exact) return exact.id;
  const normalizedTarget = target.toLowerCase();
  for (let index = 0; index < shots.length; index += 1) {
    const ordinal = index + 1;
    const aliases = [
      String(ordinal),
      `shot-${ordinal}`,
      `shot_${ordinal}`,
      `shot ${ordinal}`,
      `shot ${String(ordinal).padStart(2, "0")}`,
    ];
    if (aliases.includes(normalizedTarget)) return shots[index].id;
  }
  return undefined;
};

interface StoryboardAgentPromptContext {
  directorPlan?: SceneDirectorPlan;
  sceneId: string;
  sceneTitle: string;
  script: string;
  targetDurationSeconds: number;
  productionTeamContext: string;
  formalAssetContext: string;
}

export const buildStoryboardShotQualityPrompt = ({
  context,
  shots,
}: {
  context: StoryboardAgentPromptContext;
  shots: Shot[];
}) => {
  const preparationBlocks = [
    context.productionTeamContext ? `【原文、相邻场次与已采用制作结果】\n${context.productionTeamContext}` : "",
    context.formalAssetContext ? `【当前场正式资产】\n${context.formalAssetContext}` : "",
  ].filter(Boolean).join("\n\n");
  return `你负责独立检查候选 Shot 是否忠于事实、可执行且可剪接。只返回评分、简短结论和可定位问题。

【通过门槛】
- 总分必须达到 ${STORYBOARD_AGENT_QUALITY_THRESHOLD} 分。
- 不得存在 blocking 或 warning 问题；仅 advisory 可以随通过结论保留。
- verdict 只有在同时满足上述条件时才能为 pass，否则必须为 revise。
- issues.targetShotId 必须从候选 Shot 的 id 字段逐字复制完整 ID；不得写 shot-1、镜头1等简写。

【评分维度】
1. 剧本覆盖与事实忠实 25 分：动作、对白、转折、信息揭示完整，无新增剧情事实。
2. 导演叙事与节奏 20 分：每个镜头有叙事功能，长短节奏有起伏，不靠无意义空镜补时长。
3. 空间、轴线、视线、动作连续性 15 分：前后镜头可实际剪接。
4. 表演与潜台词可见化 15 分：心理信息被翻译为眼神、肌肉、姿态和动作。
5. 摄影与调度可执行性 10 分：景别、机位、运动、构图和 blocking 协同。
6. 时长与对白承载 10 分：总时长接近目标，每镜时长足以承载动作和对白。
7. 正式资产与状态一致性 5 分：按原文选择项目中的有效资产 ID，角色、场景、道具及变体状态正确；不因缺少部门报告或预先绑定而判错。

【场次事实源】
sceneId: ${context.sceneId}
sceneTitle: ${context.sceneTitle}
targetDurationSeconds: ${context.targetDurationSeconds}
script:
${context.script}

${preparationBlocks}

【候选 Shot】
${JSON.stringify(shots.map(projectShotForManualStoryboardPrompt), null, 2)}
${context.directorPlan ? `【本次导演方案】\n${JSON.stringify(context.directorPlan)}\n核对方法是否有来源、是否在关联镜头中落实、是否与声音和剪辑一致；指出具体差异，不以导演名称或相似度自评分代替核对。` : ""}
外观元数据中的待确认、缺少参考图或旧返回未检查，不单独阻挡分镜采用；只指出与原文实际冲突的问题。

请只返回 JSON 对象：
{
  "score": 0-100,
  "verdict": "pass" | "revise",
  "summary": "简洁结论",
  "strengths": ["已达标项"],
  "issues": [{
    "severity": "blocking" | "warning" | "advisory",
    "targetShotId": "可选的 Shot id",
    "description": "基于剧本或候选的具体问题",
    "suggestion": "可执行修正"
  }]
}`;
};

export const buildStoryboardShotRepairPrompt = ({
  context,
  shots,
  contractIssues,
  quality,
}: {
  context: StoryboardAgentPromptContext;
  shots: Shot[];
  contractIssues: Array<Pick<StoryboardShotContractIssue, "severity" | "message">>;
  quality?: ManualStoryboardAgentQuality;
}) => {
  const preparationBlocks = [
    context.productionTeamContext ? `【原文、相邻场次与已采用制作结果】\n${context.productionTeamContext}` : "",
    context.formalAssetContext ? `【当前场正式资产】\n${context.formalAssetContext}` : "",
  ].filter(Boolean).join("\n\n");
  return `你负责根据事实源和质检意见修订整份候选 Shot。直接返回完整 JSON 数组，不要解释。

【不可改变的边界】
1. 忠实覆盖剧本中的动作、对白、转折和信息揭示，不新增剧情事实、角色、场景或道具。
2. 只使用正式资产上下文中存在的 ID，并保持资产状态、人物方位、道具流转、轴线和视线连续。
3. 目标总时长为 ${context.targetDurationSeconds} 秒，允许误差不超过 ${Math.max(STORYBOARD_DURATION_TOLERANCE_FLOOR_SECONDS, Math.round(context.targetDurationSeconds * STORYBOARD_DURATION_TOLERANCE_RATIO))} 秒。不得用无叙事功能的空镜凑时长。
4. 可以调整镜头数量、拆分或合并镜头，但每个镜头必须有明确叙事功能且可拍摄、可剪接。
5. 保留原提示词要求的完整字段和 JSON 结构。
6. 采取最小修改：只修改结构检查或独立质检明确指出的镜头和字段；未被问题点名的镜头顺序、对白、动作、时长和资产 ID 必须保持不变。
7. 修订后按剧本从头到尾逐句复核 dialogueLines 的说话人、原文和先后顺序。不得为了修复局部问题而删掉、改写或重排其他对白。

【场次事实源】
sceneId: ${context.sceneId}
sceneTitle: ${context.sceneTitle}
script:
${context.script}

${preparationBlocks}

【当前候选 Shot】
${JSON.stringify(shots.map(projectShotForManualStoryboardPrompt), null, 2)}
${appearanceContract}
${directorPlanContract}
${context.directorPlan ? `【本次导演方案，修订镜头后同步更新序号与落实说明】\n${JSON.stringify(context.directorPlan)}` : ""}

${contractIssues.length ? `【结构检查问题】\n${contractIssues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n")}` : ""}

【独立质检意见】
${quality ? JSON.stringify(projectStoryboardRepairQuality(quality), null, 2) : "本轮仅处理上述结构检查问题。"}

请返回修订后的完整 Shot JSON 数组。`;
};
