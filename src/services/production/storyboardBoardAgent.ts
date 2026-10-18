import { Type } from "../../clients/aiSchemaClient";
import type {
  ManualStoryboardAgentQuality,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardStrategyDecision,
  Shot,
} from "../../types/project";
import {
  buildManualStoryboardModelCatalog,
  buildManualStoryboardStrategyCatalog,
  buildManualStoryboardStrategyContext,
  manualStoryboardLegendCatalog,
  normalizeManualStoryboardBoard,
  normalizeManualStoryboardStrategy,
  validateManualStoryboardBoard,
  validateManualStoryboardStrategy,
  type ManualVideoStoryboardIssue,
  projectShotForManualStoryboardPrompt,
} from "./manualVideoStoryboard";
import {
  normalizeStoryboardAgentQuality,
  projectStoryboardRepairQuality,
  resolveStoryboardQualityTargetShotId,
} from "./storyboardShotAgent";
import { composePromptBlocks, promptBlocksFromText } from "./promptComposition";

export const STORYBOARD_BOARD_AGENT_MAX_REPAIRS = 2;
export const STORYBOARD_BOARD_AGENT_SHOTS_PER_CALL = 4;
export const STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES = 1;

export const storyboardRepairIssueFingerprint = (issues: string[]) =>
  Array.from(new Set(issues.map((issue) => issue.trim()).filter(Boolean)))
    .sort()
    .join("|");

export const shouldStopStoryboardRepairCycle = ({
  repairCount,
  maxRepairs,
  previousIssueFingerprint,
  currentIssues,
}: {
  repairCount: number;
  maxRepairs: number;
  previousIssueFingerprint?: string;
  currentIssues: string[];
}) => {
  const currentIssueFingerprint = storyboardRepairIssueFingerprint(currentIssues);
  return {
    stop: repairCount >= maxRepairs || Boolean(
      currentIssueFingerprint && currentIssueFingerprint === previousIssueFingerprint,
    ),
    currentIssueFingerprint,
    reason: repairCount >= maxRepairs
      ? "repair_budget_exhausted" as const
      : currentIssueFingerprint && currentIssueFingerprint === previousIssueFingerprint
        ? "same_issue_loop" as const
        : undefined,
  };
};

export interface StoryboardBoardBatchValue {
  shotId: string;
  strategyDecision: ManualStoryboardStrategyDecision;
  workflow: Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board">;
}

export interface StoryboardBoardBatchIssue extends ManualVideoStoryboardIssue {
  targetShotId?: string;
}

export const buildRuleBasedStoryboardBoardValue = ({
  episodeId,
  sceneId,
  shot,
  referenceImageCount,
}: {
  episodeId: string;
  sceneId: string;
  shot: Shot;
  referenceImageCount: number;
}): StoryboardBoardBatchValue => {
  const hasDialogue = Boolean(shot.dialogueLines?.some((line) => line.text.trim()));
  const selectedStrategyId = hasDialogue
    ? "storyboard.single_shot_dialogue.v1"
    : "storyboard.action_continuity.v1";
  const strategy = buildManualStoryboardStrategyCatalog().find((item) => item.id === selectedStrategyId)!;
  const assetRefs = Array.from(new Set([
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
  ].filter((value): value is string => Boolean(value))));
  const dialogue = (shot.dialogueLines || []).map((line) => line.text.trim()).filter(Boolean).join(" ");
  const action = shot.visualAction?.trim() || shot.visualSummary?.trim() || shot.motivation?.trim() || "完成当前镜头动作";
  const startState = shot.continuityNote?.trim() || `保持上一镜的角色、道具与空间状态，准备执行：${action}`;
  const endState = `完成当前镜头动作并保持末态：${action}`;
  const decision = normalizeManualStoryboardStrategy({
    selectedStrategyId,
    selectedStrategyVersion: strategy.version,
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: hasDialogue
      ? "文本模型未及时返回时，按已确认 Shot 的对白、站位和连续性生成四格执行板。"
      : "文本模型未及时返回时，按已确认 Shot 的动作起点、过程、结果和连续性生成四格执行板。",
    rejectedStrategyIds: [hasDialogue ? "storyboard.action_continuity.v1" : "storyboard.single_shot_dialogue.v1"],
    riskNotes: ["规则降级只整理已确认 Shot，不新增剧情；最终整板仍需创作者看图采用。"],
    expectedBoardShape: "2x2 4格故事板",
    expectedVideoUnitDurationSeconds: Number(shot.duration || 0),
    expectedReferenceImageCount: Math.max(0, referenceImageCount),
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
    qaChecklist: strategy.qaChecklist,
    strategyResolution: {
      mode: "built_in_preset",
      primaryStrategyId: selectedStrategyId,
      modifierStrategyIds: [],
      requiredCapabilityIds: [],
      coveredCapabilityIds: [],
      uncoveredCapabilityIds: [],
      fallbackStrategyId: selectedStrategyId,
      confidence: 0.9,
      requiresHumanApproval: true,
      maxAutomaticRevisionAttempts: 1,
    },
  });
  const phases = [
    { purpose: "建立镜头入口", beat: `动作开始前的明确状态：${startState}`, action: `主体保持入口姿态，视线和道具位置清楚。` },
    { purpose: "启动主要动作", beat: `开始执行：${action}`, action: `主体启动主要动作，保持既定屏幕方向。` },
    { purpose: "呈现信息变化", beat: action, action: `完成动作过程中的关键信息变化；${dialogue ? `对白节拍：${dialogue}` : "保留必要环境声和动作声。"}` },
    { purpose: "锁定镜头末态", beat: endState, action: "动作收束，角色、道具和视线停在可供下一镜承接的位置。" },
  ];
  const workflow = normalizeManualStoryboardBoard({
    value: {
      performanceBeat: {
        scriptBlockIds: [],
        beatType: hasDialogue ? "dialogue" : "action",
        summary: shot.motivation || action,
        visibleChange: action,
        startState,
        endState,
        durationSeconds: Number(shot.duration || 0),
        characterIds: shot.characterIdsInShot || [],
        locationId: shot.locationId,
        propIds: shot.propIds || [],
        soundCues: dialogue ? [dialogue] : [],
        continuityIn: startState,
        continuityOut: endState,
      },
      board: {
        layout: "2x2",
        startState,
        endState,
        panels: phases.map((phase, index) => ({
          durationSeconds: Number(shot.duration || 0) / phases.length,
          framePurpose: phase.purpose,
          shotType: shot.shotSize || "中景",
          visualBeat: phase.beat,
          cameraNote: `${shot.cameraAngle || "平视"}；${shot.cameraMovement || "固定机位"}`,
          framing: shot.composition || "主体、动作方向和关键道具完整入画。",
          lens: shot.focalLength || "35mm",
          angle: shot.cameraAngle || "平视",
          cameraMove: shot.cameraMovement || "固定机位",
          subjectAction: phase.action,
          blocking: shot.blocking || "保持角色站位和动作方向连续。",
          lightingCue: shot.lighting || shot.lightingAtmo || "延续本场光线。",
          soundCue: dialogue || "环境声与动作声",
          emotionCue: shot.microExpression || "表情随动作产生可见变化。",
          compositionNote: shot.composition || "保持主体轮廓清楚，不遮挡关键动作。",
          continuityIn: index === 0 ? startState : phases[index - 1].beat,
          continuityOut: phase.beat,
          assetRefs,
          annotationLegendIds: ["subject_action_red", "camera_motion_blue"],
          actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"],
          dialogueOrSoundCue: dialogue || "环境声与动作声",
          renderInstruction: action,
        })),
      },
    },
    episodeId,
    sceneId,
    shot,
    decision,
  });
  return { shotId: shot.id, strategyDecision: decision, workflow };
};

export const splitStoryboardBoardShots = (
  shots: Shot[],
  size = STORYBOARD_BOARD_AGENT_SHOTS_PER_CALL,
) => {
  const safeSize = Math.max(1, Math.floor(size));
  return Array.from(
    { length: Math.ceil(shots.length / safeSize) },
    (_, index) => shots.slice(index * safeSize, (index + 1) * safeSize),
  );
};

export const mergeStoryboardBoardBatchValues = (
  current: StoryboardBoardBatchValue[],
  incoming: StoryboardBoardBatchValue[],
  scoreCandidate: (value: StoryboardBoardBatchValue) => number = () => 0,
) => {
  const byShotId = new Map(current.map((item) => [item.shotId, item]));
  incoming.forEach((item) => {
    const existing = byShotId.get(item.shotId);
    if (!existing || scoreCandidate(item) <= scoreCandidate(existing)) {
      byShotId.set(item.shotId, item);
    }
  });
  return Array.from(byShotId.values());
};

export const getActionableStoryboardBoardIssues = (issues: StoryboardBoardBatchIssue[]) =>
  issues.filter((issue) => issue.severity !== "advisory");

export const scoreStoryboardBoardIssues = (issues: StoryboardBoardBatchIssue[]) =>
  issues.reduce((score, issue) => score + (
    issue.severity === "blocking" ? 1_000_000
      : issue.severity === "warning" ? 1_000
        : 1
  ), 0);

export const scoreStoryboardBoardCandidateCompleteness = (value: StoryboardBoardBatchValue) => {
  const beat = value.workflow.performanceBeat;
  const board = value.workflow.board;
  let missing = 0;
  if (!value.strategyDecision.selectedStrategyId) missing += 1;
  if (!beat?.summary) missing += 1;
  if (!beat?.visibleChange) missing += 1;
  if (!beat?.startState) missing += 1;
  if (!beat?.endState) missing += 1;
  if (!board?.startState) missing += 1;
  if (!board?.endState) missing += 1;
  if (!board?.panels?.length) return missing + 100;
  for (const panel of board.panels) {
    if (!panel.framePurpose) missing += 1;
    if (!panel.visualBeat) missing += 1;
    if (!panel.subjectAction) missing += 1;
    if (!panel.continuityIn) missing += 1;
    if (!panel.continuityOut) missing += 1;
  }
  return missing;
};

export const getIncompleteStoryboardBoardShotIds = (
  values: StoryboardBoardBatchValue[],
  shots: Shot[],
) => shots
  .filter((shot) => {
    const candidate = values.find((value) => value.shotId === shot.id);
    return !candidate || scoreStoryboardBoardCandidateCompleteness(candidate) > 0;
  })
  .map((shot) => shot.id);

const strategySchema = {
  type: Type.OBJECT,
  properties: {
    selectedStrategyId: { type: Type.STRING },
    selectedStrategyVersion: { type: Type.STRING },
    selectedModelProfileId: { type: Type.STRING },
    rationale: { type: Type.STRING },
    rejectedStrategyIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    riskNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    expectedBoardShape: { type: Type.STRING },
    expectedVideoUnitDurationSeconds: { type: Type.NUMBER },
    expectedReferenceImageCount: { type: Type.NUMBER },
    expectedReferenceVideoCount: { type: Type.NUMBER },
    arrowLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    qaChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
    strategyResolution: {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING },
        primaryStrategyId: { type: Type.STRING },
        modifierStrategyIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        requiredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        coveredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        uncoveredCapabilityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        fallbackStrategyId: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        requiresHumanApproval: { type: Type.BOOLEAN },
        maxAutomaticRevisionAttempts: { type: Type.NUMBER },
      },
    },
  },
  required: ["selectedStrategyId", "selectedStrategyVersion", "selectedModelProfileId", "rationale", "expectedBoardShape", "expectedVideoUnitDurationSeconds", "expectedReferenceImageCount", "expectedReferenceVideoCount", "arrowLegendIds", "qaChecklist"],
};

const performanceBeatSchema = {
  type: Type.OBJECT,
  properties: {
    scriptBlockIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    beatType: { type: Type.STRING },
    summary: { type: Type.STRING },
    visibleChange: { type: Type.STRING },
    startState: { type: Type.STRING },
    endState: { type: Type.STRING },
    durationSeconds: { type: Type.NUMBER },
    characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    locationId: { type: Type.STRING },
    propIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    soundCues: { type: Type.ARRAY, items: { type: Type.STRING } },
    continuityIn: { type: Type.STRING },
    continuityOut: { type: Type.STRING },
  },
  required: ["beatType", "summary", "visibleChange", "startState", "endState", "durationSeconds", "characterIds", "propIds", "soundCues", "continuityIn", "continuityOut"],
};

const panelSchema = {
  type: Type.OBJECT,
  properties: {
    durationSeconds: { type: Type.NUMBER },
    framePurpose: { type: Type.STRING },
    shotType: { type: Type.STRING },
    visualBeat: { type: Type.STRING },
    cameraNote: { type: Type.STRING },
    framing: { type: Type.STRING },
    lens: { type: Type.STRING },
    angle: { type: Type.STRING },
    cameraMove: { type: Type.STRING },
    subjectAction: { type: Type.STRING },
    blocking: { type: Type.STRING },
    lightingCue: { type: Type.STRING },
    soundCue: { type: Type.STRING },
    emotionCue: { type: Type.STRING },
    compositionNote: { type: Type.STRING },
    continuityIn: { type: Type.STRING },
    continuityOut: { type: Type.STRING },
    assetRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
    annotationLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    actionArrowLegendIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    dialogueOrSoundCue: { type: Type.STRING },
    renderInstruction: { type: Type.STRING },
  },
  required: ["framePurpose", "visualBeat", "cameraNote", "subjectAction", "continuityIn", "continuityOut", "assetRefs", "annotationLegendIds", "actionArrowLegendIds"],
};

const boardSchema = {
  type: Type.OBJECT,
  properties: {
    layout: { type: Type.STRING },
    lineArtPrompt: { type: Type.STRING },
    startState: { type: Type.STRING },
    endState: { type: Type.STRING },
    panels: { type: Type.ARRAY, items: panelSchema },
  },
  required: ["layout", "lineArtPrompt", "startState", "endState", "panels"],
};

export const storyboardBoardBatchSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      shotId: { type: Type.STRING },
      strategyDecision: strategySchema,
      performanceBeat: performanceBeatSchema,
      board: boardSchema,
    },
    required: ["shotId", "strategyDecision", "performanceBeat", "board"],
  },
};

export const storyboardBoardQualitySchema = {
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
          evidence: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ["path", "value"],
            },
          },
        },
        required: ["severity", "targetShotId", "description", "suggestion", "evidence"],
      },
    },
  },
  required: ["score", "verdict", "summary", "strengths", "issues"],
};

const resolveJsonPointer = (root: unknown, pointer: string) => {
  if (!pointer.startsWith("/")) return undefined;
  let current = root;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

export const normalizeStoryboardBoardQualityWithEvidence = ({
  value,
  values,
  shots,
}: {
  value: unknown;
  values: StoryboardBoardBatchValue[];
  shots: Shot[];
}): ManualStoryboardAgentQuality => {
  const normalized = normalizeStoryboardAgentQuality(value);
  const rawIssues = Array.isArray(object(value).issues) ? object(value).issues as unknown[] : [];
  const issues = normalized.issues.map((issue, index) => {
    const rawIssue = object(rawIssues[index]);
    const targetShotId = resolveStoryboardQualityTargetShotId(issue.targetShotId, shots);
    const candidate = values.find((item) => item.shotId === targetShotId);
    const evidence = Array.isArray(rawIssue.evidence) ? rawIssue.evidence.map(object) : [];
    const evidenceMatches = Boolean(candidate && evidence.length) && evidence.every((item) => {
      const actual = resolveJsonPointer(candidate, text(item.path));
      return actual !== undefined && String(actual) === text(item.value);
    });
    return {
      ...issue,
      targetShotId,
      severity: evidenceMatches ? issue.severity : "advisory" as const,
      suggestion: evidenceMatches
        ? issue.suggestion
        : `${issue.suggestion}（候选证据路径或精确值未匹配，已自动降为建议项。）`,
    };
  });
  const hasActionableIssue = issues.some((issue) => issue.severity === "blocking" || issue.severity === "warning");
  return {
    ...normalized,
    score: hasActionableIssue ? normalized.score : Math.max(90, normalized.score),
    verdict: hasActionableIssue ? "revise" : "pass",
    issues,
  };
};

const object = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown) => String(value || "").trim();

export const normalizeStoryboardBoardBatch = ({
  value,
  episodeId,
  sceneId,
  shots,
}: {
  value: unknown;
  episodeId: string;
  sceneId: string;
  shots: Shot[];
}): StoryboardBoardBatchValue[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = object(item);
    const shotId = resolveStoryboardQualityTargetShotId(text(source.shotId), shots);
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!shot) return [];
    const normalizedStrategyDecision = normalizeManualStoryboardStrategy(source.strategyDecision);
    const strategyDecision = {
      ...normalizedStrategyDecision,
      expectedVideoUnitDurationSeconds: Number(shot.duration || 0) || normalizedStrategyDecision.expectedVideoUnitDurationSeconds,
    };
    return [{
      shotId: shot.id,
      strategyDecision,
      workflow: normalizeManualStoryboardBoard({
        value: { performanceBeat: source.performanceBeat, board: source.board },
        episodeId,
        sceneId,
        shot,
        decision: strategyDecision,
      }),
    }];
  });
};

export const validateStoryboardBoardBatch = ({
  values,
  shots,
  projectFormat,
  aspectRatio,
  referenceImageCount,
  allowedAssetIds,
}: {
  values: StoryboardBoardBatchValue[];
  shots: Shot[];
  projectFormat: string;
  aspectRatio: string;
  referenceImageCount: number;
  allowedAssetIds: string[];
}): StoryboardBoardBatchIssue[] => {
  const issues: StoryboardBoardBatchIssue[] = [];
  const countById = new Map<string, number>();
  values.forEach((item) => countById.set(item.shotId, (countById.get(item.shotId) || 0) + 1));
  for (const shot of shots) {
    const count = countById.get(shot.id) || 0;
    if (count === 0) issues.push({ severity: "blocking", code: "BOARD_SHOT_MISSING", message: `缺少 Shot ${shot.id} 的故事板。`, targetShotId: shot.id });
    if (count > 1) issues.push({ severity: "blocking", code: "BOARD_SHOT_DUPLICATE", message: `Shot ${shot.id} 返回了重复故事板。`, targetShotId: shot.id });
  }
  for (const value of values) {
    const shot = shots.find((item) => item.id === value.shotId);
    if (!shot) continue;
    const strategyContext = buildManualStoryboardStrategyContext({
      shot,
      projectFormat,
      aspectRatio,
      referenceImageCount,
    });
    issues.push(...validateManualStoryboardStrategy(value.strategyDecision, strategyContext).map((issue) => ({ ...issue, targetShotId: shot.id })));
    issues.push(...validateManualStoryboardBoard({
      workflow: value.workflow,
      strategyContext,
      allowedAssetIds,
      shot,
    }).map((issue) => ({ ...issue, targetShotId: shot.id })));
  }
  return Array.from(new Map(issues.map((issue) => [`${issue.targetShotId || "scene"}:${issue.code}:${issue.message}`, issue])).values());
};

export const buildStoryboardBoardBatchPrompt = ({
  confirmedPrompt,
  sceneContext,
  shots,
  filmTeamContext,
  assetContext,
}: {
  confirmedPrompt: string;
  sceneContext: { id?: string; title?: string; description?: string; script?: string };
  shots: Shot[];
  filmTeamContext: string;
  assetContext: string;
}) => {
  const sceneOwnedSections = new Set([
    "已确认策略",
    "当前视频单元/已确认 Shot",
    "已确认制片筹备结果",
    "当前场景正式资产与参考图",
  ]);
  const confirmedBlocks = promptBlocksFromText({
    prompt: confirmedPrompt,
    blockIdPrefix: "storyboard.board.confirmed",
    source: "storyboard.board.plan.confirmedPrompt",
    purpose: "作者确认的故事板规则",
  }).filter((block) => !sceneOwnedSections.has(block.purpose));
  const scopedScene = {
    id: sceneContext.id,
    title: sceneContext.title,
    description: sceneContext.description || "",
    script: sceneContext.script || "",
    shots: shots.map(projectShotForManualStoryboardPrompt),
  };
  return composePromptBlocks([
    ...confirmedBlocks,
    {
      blockId: "storyboard.board.scene_scope",
      source: "storyboard.board.runtime.scene",
      purpose: "本轮唯一场次与 Shot 事实",
      content: `【本轮唯一场次与已确认 Shot】\n${JSON.stringify(scopedScene, null, 2)}`,
      required: true,
    },
    {
      blockId: "storyboard.board.department_context",
      source: "storyboard.board.runtime.filmTeamContext",
      purpose: "本轮场次制片筹备",
      content: filmTeamContext ? `【本轮场次制片筹备】\n${filmTeamContext}` : "",
    },
    {
      blockId: "storyboard.board.asset_context",
      source: "storyboard.board.runtime.assetContext",
      purpose: "本轮场次正式资产与参考图",
      content: assetContext ? `【本轮场次正式资产与参考图】\n${assetContext}` : "",
    },
    {
      blockId: "storyboard.board.execution_scope",
      source: "storyboard.board.runtime.scope",
      purpose: "输出范围",
      content: `【本轮执行范围】\n只为 Shot ID ${shots.map((shot) => shot.id).join("、")} 生成结果，不得返回其他场次或 Shot。每项必须使用完整 shotId。`,
      required: true,
    },
  ]).prompt;
};

export const buildStoryboardBoardBatchQualityPrompt = ({
  sceneContext,
  shots,
  values,
  reviewShotIds,
  filmTeamContext,
  assetContext,
}: {
  sceneContext: unknown;
  shots: Shot[];
  values: StoryboardBoardBatchValue[];
  reviewShotIds?: string[];
  filmTeamContext: string;
  assetContext: string;
}) => `你负责独立审查当前场全部 Shot 的故事板，不生成内容，也不替上游结果辩护。

【场次】
${JSON.stringify(sceneContext, null, 2)}
【已确认 Shot】
${JSON.stringify(shots.map(projectShotForManualStoryboardPrompt), null, 2)}
【候选故事板】
${JSON.stringify(values, null, 2)}
【本轮负责质检的 Shot】
${JSON.stringify(reviewShotIds || shots.map((shot) => shot.id), null, 2)}
【有效 legend 目录】
${JSON.stringify(manualStoryboardLegendCatalog, null, 2)}
【制片筹备】
${filmTeamContext}
【正式资产与参考图】
${assetContext}

检查：剧情与 Shot 忠实度；每格可见变化；首尾状态；动作、轴线、视线、屏幕方向和道具位置、持有者、开合、显影、损伤状态连续性，不能因为对白或视线提到道具就推断其转移；正式资产与变体；摄影、灯光、声音和表演可执行性；策略、格数、时长与模型能力；跨 Shot 衔接和整场节奏。距离和台词保留在结构字段，单 panel 的 renderInstruction 不得要求真实画格绘制说明文字、对白、数字、距离单位或引号内容。
blocking 只用于事实错误、资产越界、连续性断裂或不可生成的关键缺失；warning 必须自动修复；纯偏好只能 advisory。
必须只依据【候选故事板】当前文本提出问题，不得沿用上一轮已经不存在的描述。每条 blocking/warning 都要在 description 中指出候选里的具体字段或原文证据；找不到证据时不得报错。
每条 issue 必须提供 evidence 数组。evidence.path 使用以候选单项为根的标准 JSON Pointer，例如 /workflow/board/panels/0/shotType；evidence.value 必须是该路径当前实际标量值的精确字符串。比较两个字段或判断前后矛盾时，必须把支撑结论的所有字段分别列入 evidence。系统会逐条校验路径和值，不匹配的问题只会作为 advisory，不能触发自动修订。
控制关键帧不等于剪辑镜头，不能用“Shot 时长 ÷ panel 数量”推断剪辑抖动；只有 panel 时长总和不等于已确认 Shot、策略格数越界或动作无法执行时才可报错。
legend 已在 annotationLegendIds/actionArrowLegendIds 声明，并在 renderInstruction、cameraNote 或 subjectAction 中说明颜色与方向，即视为已经应用；不要求每格重复画所有箭头。
例如“绿色视线箭头从眼睛指向锁扣”是在表达人物视线落点，不应误判为角色或摄影机发生位移。若当前候选已写明正确的左右手、道具归属或动作方向，不得引用旧版本的相反说法。
输入可能包含负责范围前后的相邻 Shot，它们只用于检查边界连续性；issues 的 targetShotId 只能填写【本轮负责质检的 Shot】中的完整 id。相邻 Shot 自身的问题由它所属批次报告，不得跨批重复报错。
targetShotId 必须填写输入中的完整 shotId，不得写 shot-1 等简称。严格返回 score、verdict、summary、strengths、issues 的 JSON。`;

export const buildStoryboardBoardBatchRepairPrompt = ({
  sceneContext,
  shots,
  values,
  contractIssues,
  quality,
  filmTeamContext,
  assetContext,
}: {
  sceneContext: unknown;
  shots: Shot[];
  values: StoryboardBoardBatchValue[];
  contractIssues: StoryboardBoardBatchIssue[];
  quality?: ManualStoryboardAgentQuality;
  filmTeamContext: string;
  assetContext: string;
}) => `你负责修订故事板。只修复结构检查和独立质检明确指出的问题，保留已经正确的导演设计，不新增剧情事实。

【场次】${JSON.stringify(sceneContext, null, 2)}
【本轮必须修订的已确认 Shot】${JSON.stringify(shots.map(projectShotForManualStoryboardPrompt), null, 2)}
【本轮当前候选】${JSON.stringify(values, null, 2)}
${contractIssues.length ? `【结构问题】${JSON.stringify(contractIssues, null, 2)}` : ""}
${quality ? `【独立质检】${JSON.stringify(projectStoryboardRepairQuality(quality), null, 2)}` : ""}
【有效策略目录】${JSON.stringify(buildManualStoryboardStrategyCatalog(), null, 2)}
【视频模型能力目录】${JSON.stringify(buildManualStoryboardModelCatalog(), null, 2)}
【有效 legend 目录】${JSON.stringify(manualStoryboardLegendCatalog, null, 2)}
【制片筹备】${filmTeamContext}
【正式资产】${assetContext}

只返回本轮列出的全部 Shot，不得省略、不得返回本轮之外的 Shot。每项必须使用完整 shotId。必须实际修改被指出的字段；不得删除未被指出的正确内容。strategyDecision.selectedStrategyId 和 selectedModelProfileId 只能逐字使用目录中存在的 id，不得创造近义策略名。凡 renderInstruction、cameraNote 或动作说明使用某种 legend 颜色，strategyDecision.arrowLegendIds、annotationLegendIds 和 actionArrowLegendIds 必须使用目录中的对应 id；也可以删除不必要的彩色标注，不得只写颜色文字而不声明 legend。renderInstruction 只能描述线稿媒介、构图和运动标记，不得要求真实画格写入说明文字、对白、数字、距离单位或引号内容。修订道具连续性时必须在 subjectAction、blocking 和 continuityIn/continuityOut 写清位置、持有者与状态；未有明确拿起、放下、交接、开启或改变动作时保持原状态，不得凭空迁移或复制。`;
