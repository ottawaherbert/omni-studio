import {
  Episode,
  Project,
  Scene,
  ScriptBlock,
  Shot,
} from "../../../../../src/types/project";
import {
  PerformanceBeat,
  StoryboardBoard,
  StoryboardBoardPanel,
  StoryboardDepartmentRefDepartment,
  VideoStoryboardArtifactIssue,
  validatePerformanceBeats,
  validateStoryboardBoard,
} from "./videoStoryboardArtifacts";
import type { DepartmentPrepPackage } from "./productionPrep";
import {
  StoryboardDepartmentPrepRefSet,
  buildStoryboardDepartmentPrepRefs,
  missingStoryboardDepartmentPrepRefs,
  sceneNeedsPerformancePrep,
  storyboardDepartmentLabel,
  storyboardDepartmentPrepRefIdsForShot,
} from "./videoStoryboardDepartmentRefs";
import {
  StoryboardBoardMode,
  StoryboardStrategyDecision,
  StoryboardStrategySelectionContext,
  VIDEO_MODEL_PROFILES,
  getStoryboardPromptStrategyById,
  recommendStoryboardPromptStrategies,
  resolveStoryboardStrategyCoverage,
} from "./videoStoryboardSystem";
import { renderStoryboardBoardPrompt } from "./videoStoryboardTemplateRenderer";
import { resolveVisualStyleLock } from "./visualStyleLock";

export interface ProductionStoryboardBoardDrafts {
  performanceBeats: PerformanceBeat[];
  storyboardBoards: StoryboardBoard[];
  issues: VideoStoryboardArtifactIssue[];
  boardSceneIds: string[];
}

export interface ProductionStoryboardBoardDraftOptions {
  departmentPrepPackages?: DepartmentPrepPackage[];
  requireDepartmentPrepRefs?: boolean;
  requiredDepartmentRefs?: StoryboardDepartmentRefDepartment[];
}

const PANEL_RANGE_BY_MODE: Record<StoryboardBoardMode, { min: number; max: number; preferred: number }> = {
  single_shot_performance: { min: 3, max: 4, preferred: 4 },
  dialogue_blocking: { min: 4, max: 6, preferred: 6 },
  multi_shot_narrative: { min: 6, max: 9, preferred: 8 },
  spatial_geography: { min: 4, max: 8, preferred: 6 },
  montage_compression: { min: 6, max: 12, preferred: 9 },
  procedural_insert: { min: 4, max: 10, preferred: 6 },
  parallel_intercut: { min: 6, max: 12, preferred: 8 },
  subjective_suspense: { min: 4, max: 8, preferred: 6 },
  action_continuity: { min: 4, max: 12, preferred: 8 },
  fight_choreography: { min: 12, max: 16, preferred: 12 },
  dance_choreography: { min: 12, max: 20, preferred: 16 },
  emotional_reaction: { min: 3, max: 5, preferred: 4 },
  emotional_performance: { min: 3, max: 5, preferred: 4 },
  reveal_or_twist: { min: 4, max: 8, preferred: 6 },
  effect_reveal: { min: 4, max: 8, preferred: 6 },
  transition_bridge: { min: 2, max: 4, preferred: 4 },
  interactive_idle_loop: { min: 2, max: 6, preferred: 4 },
  interactive_ui_safe: { min: 4, max: 8, preferred: 6 },
  ai_video_control: { min: 6, max: 12, preferred: 8 },
  rhythm_sheet: { min: 16, max: 24, preferred: 20 },
};

const COMBAT_PATTERN = /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|爆发|法术|仙术/iu;
const ACTION_PATTERN = /run|rush|chase|grab|turn|fall|jump|push|pull|throw|open|close|move|follow|track|pan|tilt|dolly|奔|跑|追|抓|转身|跌|跳|推|拉|甩|拔|冲|移动|跟拍|摇|推镜|拉镜/iu;
const ACTION_DEPARTMENT_PATTERN = /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|stunt|chase|run|rush|fall|jump|throw|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|爆发|法术|仙术|追逐|奔跑|冲入|冲出|跌|跳|摔|危险|特技/iu;
const EMOTION_PATTERN = /tear|cry|smile|hesitate|tremble|breath|gaze|silence|心碎|落泪|哽咽|微笑|迟疑|颤抖|呼吸|凝视|沉默|道侣|诀别/iu;
const REVEAL_PATTERN = /reveal|twist|secret|truth|cliffhanger|discover|反转|揭示|真相|秘密|悬念|钩子|发现|身份/iu;
const TRANSITION_BRIDGE_PATTERN = /transition|转场|过场|过渡|空镜|建立镜头|转场承接|桥接镜头|离场转场|入场转场|从.+切到|切至/iu;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const textOf = (...values: Array<unknown>) =>
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

const shotDuration = (shot: Shot) => {
  const duration = Number(shot.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 4;
};

const selectVideoModelProfile = (project: Project) =>
  VIDEO_MODEL_PROFILES.find((profile) =>
    profile.supportsStoryboardReference &&
    (!project.aspectRatio || profile.aspectRatios.includes(project.aspectRatio)),
  ) || VIDEO_MODEL_PROFILES.find((profile) => profile.supportsStoryboardReference) || VIDEO_MODEL_PROFILES[0];

const styleLockVersionForProject = (project: Project) =>
  project.visualStyleLock?.version ||
  (project.visualStyleLock?.lockedAt ? `visual-style-lock.${project.visualStyleLock.lockedAt}` : undefined);

const targetVideoDuration = (maxDurationSeconds: number, preferredDurationsSeconds: number[]) => {
  const preferred = preferredDurationsSeconds
    .filter((duration) => duration <= maxDurationSeconds)
    .sort((a, b) => b - a)[0];
  return preferred || Math.min(maxDurationSeconds, 10);
};

const chunkShotsByModelDuration = (shots: Shot[], maxDurationSeconds: number, preferredDurationsSeconds: number[]) => {
  const targetDurationSeconds = targetVideoDuration(maxDurationSeconds, preferredDurationsSeconds);
  const groups: Shot[][] = [];
  let current: Shot[] = [];
  let currentDuration = 0;

  for (const shot of shots) {
    const duration = shotDuration(shot);
    if (current.length > 0 && currentDuration + duration > targetDurationSeconds) {
      groups.push(current);
      current = [];
      currentDuration = 0;
    }
    current.push(shot);
    currentDuration += duration;
  }
  if (current.length > 0) groups.push(current);
  return groups;
};

const countScriptBlocks = (blocks: ScriptBlock[] | undefined, type: ScriptBlock["type"]) =>
  (blocks || []).filter((block) => block.type === type && block.content?.trim()).length;

const coversWholeScene = (scene: Scene, shots: Shot[]) => {
  const sceneShotIds = new Set((scene.shots || []).map((shot) => shot.id).filter(Boolean));
  return sceneShotIds.size > 0
    && sceneShotIds.size === shots.length
    && shots.every((shot) => sceneShotIds.has(shot.id));
};

const collectDialogueLines = (scene: Scene, shots: Shot[], includeSceneScript = coversWholeScene(scene, shots)) => {
  const scriptDialogue = includeSceneScript ? (scene.scriptBlocks || [])
    .filter((block) => block.type === "dialogue")
    .map((block) => block.content) : [];
  const shotDialogue = shots.flatMap((shot) => shot.dialogueLines || []).map((line) => line.text);
  return [...scriptDialogue, ...shotDialogue].filter(Boolean);
};

const collectCharacterIds = (scene: Scene, shots: Shot[]) => {
  const shotIds = unique(shots.flatMap((shot) => shot.characterIdsInShot || []));
  return shotIds.length ? shotIds : unique(scene.breakdown?.characterIds || []);
};

const collectPropIds = (scene: Scene, shots: Shot[]) => {
  const shotIds = unique(shots.flatMap((shot) => shot.propIds || []));
  return shotIds.length ? shotIds : unique(scene.breakdown?.propIds || []);
};

const collectLocationId = (scene: Scene, shots: Shot[]) =>
  shots.find((shot) => shot.locationId)?.locationId || scene.breakdown?.locationId;

const countAvailableReferenceImages = (project: Project, characterIds: string[], locationId: string | undefined, propIds: string[]) => {
  const characterRefs = (project.characters || [])
    .filter((character) => characterIds.includes(character.id))
    .filter((character) => character.cleanReferenceImageUrl || character.referenceImageUrl || character.multiViewUrl || character.defaultReferenceUrl)
    .length;
  const assetIds = unique([locationId, ...propIds]);
  const assetRefs = (project.assets || [])
    .filter((asset) => assetIds.includes(asset.id))
    .filter((asset) => asset.cleanReferenceImageUrl || asset.imageUrl || asset.multiViewUrl || asset.panoramaUrl || asset.defaultReferenceUrl)
    .length;
  return characterRefs + assetRefs;
};

const buildSelectionContext = (
  project: Project,
  scene: Scene,
  shots: Shot[],
  scope: { isFirstGroup: boolean; isLastGroup: boolean; isWholeScene: boolean },
): StoryboardStrategySelectionContext => {
  const modelProfile = selectVideoModelProfile(project);
  const joinedText = textOf(
    scope.isWholeScene ? scene.title : undefined,
    scope.isWholeScene ? scene.description : undefined,
    scope.isFirstGroup ? scene.hook : undefined,
    scope.isLastGroup ? scene.cliffhanger : undefined,
    scope.isWholeScene ? scene.script : undefined,
    scope.isWholeScene ? scene.scriptBlocks?.map((block) => `${block.type}:${block.content}`) : undefined,
    shots.map((shot) => `${shot.visualAction || ""} ${shot.blocking || ""} ${shot.cameraMovement || ""} ${shot.microExpression || ""}`),
  );
  const shotText = textOf(
    shots.map((shot) =>
      textOf(shot.visualAction, shot.blocking, shot.cameraMovement, shot.microExpression, shot.motivation, shot.continuityNote),
    ),
  );
  const scenePurposeText = textOf(
    scope.isWholeScene ? scene.sceneGoal : undefined,
    scope.isWholeScene ? scene.title : undefined,
    scope.isWholeScene ? scene.description : undefined,
    scope.isFirstGroup ? scene.hook : undefined,
    scope.isLastGroup ? scene.cliffhanger : undefined,
  );
  const dialogueLineCount = collectDialogueLines(scene, shots, scope.isWholeScene).length;
  const actionBeatCount = (scope.isWholeScene ? countScriptBlocks(scene.scriptBlocks, "action") : 0) +
    shots.filter((shot) => ACTION_PATTERN.test(textOf(shot.visualAction, shot.blocking, shot.cameraMovement))).length;
  const combatBeatCount = COMBAT_PATTERN.test(joinedText) ? Math.max(1, shots.filter((shot) => COMBAT_PATTERN.test(textOf(shot.visualAction, shot.blocking))).length) : 0;
  const emotionalBeatCount = EMOTION_PATTERN.test(joinedText)
    ? Math.max(1, shots.filter((shot) => EMOTION_PATTERN.test(textOf(shot.microExpression, shot.visualAction, shot.blocking))).length)
    : 0;
  const characterIds = collectCharacterIds(scene, shots);
  const referenceImageCount = countAvailableReferenceImages(project, characterIds, collectLocationId(scene, shots), collectPropIds(scene, shots));
  const expectedDuration = clamp(
    shots.reduce((sum, shot) => sum + shotDuration(shot), 0),
    modelProfile.minDurationSeconds || 1,
    modelProfile.maxDurationSeconds || 15,
  );

  return {
    projectFormat: project.type,
    scenePurpose: scene.sceneGoal || scene.hook || scene.cliffhanger || scene.description,
    beatSummary: shots.map((shot) => shot.visualAction || shot.blocking).filter(Boolean).join(" / "),
    dialogueLineCount,
    actionBeatCount,
    combatBeatCount,
    emotionalBeatCount,
    revealOrTwist: REVEAL_PATTERN.test(joinedText) || (scope.isLastGroup && Boolean(scene.cliffhanger)),
    transitionBridge: shots.length === 1 && (
      TRANSITION_BRIDGE_PATTERN.test(shotText) ||
      TRANSITION_BRIDGE_PATTERN.test(scenePurposeText)
    ),
    requiresDialogueBlocking: dialogueLineCount >= 2 && characterIds.length >= 2,
    requiresMultiShot: shots.length >= 2,
    expectedVideoUnitDurationSeconds: expectedDuration,
    expectedReferenceImageCount: referenceImageCount,
    expectedReferenceVideoCount: 0,
    modelProfileId: modelProfile.id,
    targetAspectRatio: project.aspectRatio,
    requiredCapabilityIds: unique([
      ...(scene.storyboardCapabilityIds || []),
      ...shots.flatMap((shot) => shot.storyboardCapabilityIds || []),
    ]),
  };
};

const selectArrowLegendIds = (context: StoryboardStrategySelectionContext) => {
  const legends = ["shot_note_black", "subject_action_red", "camera_motion_blue", "composition_note_green"];
  if ((context.dialogueLineCount || 0) > 0 || (context.emotionalBeatCount || 0) > 0) {
    legends.push("eyeline_attention_green", "sound_emotion_purple");
  }
  if ((context.combatBeatCount || 0) > 0 || context.revealOrTwist) {
    legends.push("energy_impact_orange", "lighting_direction_orange");
  }
  if (context.transitionBridge) legends.push("offscreen_handoff_dashed");
  if ((context.actionBeatCount || 0) >= 2) legends.push("primary_fast_motion_thick");
  return unique(legends);
};

const buildStrategyDecision = (context: StoryboardStrategySelectionContext): StoryboardStrategyDecision => {
  const recommendations = recommendStoryboardPromptStrategies(context, 4);
  const strategyResolution = resolveStoryboardStrategyCoverage(context);
  const selectedStrategy = getStoryboardPromptStrategyById(strategyResolution.primaryStrategyId) ||
    getStoryboardPromptStrategyById(recommendations[0]?.strategyId) ||
    getStoryboardPromptStrategyById("storyboard.multi_shot_narrative.v1")!;
  const modifierStrategies = strategyResolution.modifierStrategyIds
    .map((strategyId) => getStoryboardPromptStrategyById(strategyId))
    .filter((strategy): strategy is NonNullable<typeof strategy> => Boolean(strategy));

  return {
    selectedStrategyId: selectedStrategy.id,
    selectedStrategyVersion: selectedStrategy.version,
    selectedModelProfileId: context.modelProfileId || selectVideoModelProfile({ aspectRatio: "", type: "movie" } as Project).id,
    rationale: [
      `根据对白 ${context.dialogueLineCount || 0} 条、动作 ${context.actionBeatCount || 0} 个、打斗 ${context.combatBeatCount || 0} 个、情绪 ${context.emotionalBeatCount || 0} 个来选择故事板策略。`,
      strategyResolution.mode === "composed_recipe"
        ? `以 ${selectedStrategy.name} 决定主版式，并叠加 ${modifierStrategies.map((item) => item.name).join("、")} 的控制规则，不重复解释剧情事实。`
        : `该策略能服务当前场景目的，并且预计 ${context.expectedVideoUnitDurationSeconds || 0}s 不超过所选模型 profile 的单次生成边界。`,
    ].join(""),
    rejectedStrategyIds: recommendations
      .map((item) => item.strategyId)
      .filter((strategyId) => strategyId !== selectedStrategy.id && !strategyResolution.modifierStrategyIds.includes(strategyId))
      .slice(0, 3),
    riskNotes: recommendations[0]?.cautions.length ? recommendations[0].cautions : ["当前故事板为阶段内草案，后续 prompt/cost 阶段仍需复核资产包和视频单元。"],
    expectedBoardShape: `${selectedStrategy.name}，${selectedStrategy.outputContract.join("；")}，预计 ${context.expectedVideoUnitDurationSeconds || 0}s`,
    expectedVideoUnitDurationSeconds: context.expectedVideoUnitDurationSeconds || 8,
    expectedReferenceImageCount: context.expectedReferenceImageCount || 0,
    expectedReferenceVideoCount: context.expectedReferenceVideoCount || 0,
    arrowLegendIds: selectArrowLegendIds(context),
    qaChecklist: unique([selectedStrategy.qaChecklist, ...modifierStrategies.map((item) => item.qaChecklist)].flat()),
    strategyResolution,
  };
};

const beatTypeFromContext = (context: StoryboardStrategySelectionContext): PerformanceBeat["beatType"] => {
  if ((context.combatBeatCount || 0) > 0) return "combat";
  if (context.revealOrTwist) return "reveal";
  if ((context.actionBeatCount || 0) > 0) return "action";
  if ((context.emotionalBeatCount || 0) > 0) return "emotion";
  if ((context.dialogueLineCount || 0) > 0) return "dialogue";
  if (context.transitionBridge) return "transition";
  return "action";
};

const describeShot = (shot: Shot, scene: Scene) =>
  shot.visualAction || shot.blocking || shot.motivation || scene.description || scene.title;

const buildPerformanceBeat = (
  id: string,
  episodeId: string,
  scene: Scene,
  shots: Shot[],
  context: StoryboardStrategySelectionContext,
): PerformanceBeat => {
  const characterIds = collectCharacterIds(scene, shots);
  const propIds = collectPropIds(scene, shots);
  const startState = describeShot(shots[0], scene);
  const endState = describeShot(shots[shots.length - 1], scene);

  return {
    id,
    episodeId,
    sceneId: scene.id,
    scriptBlockIds: (scene.scriptBlocks || []).map((block) => block.id).filter(Boolean),
    beatType: beatTypeFromContext(context),
    summary: context.beatSummary || scene.sceneGoal || scene.description || scene.title,
    visibleChange: `${startState} -> ${endState}`,
    startState,
    endState,
    durationSeconds: context.expectedVideoUnitDurationSeconds || 8,
    characterIds,
    locationId: collectLocationId(scene, shots),
    propIds,
    dialogueLineCount: context.dialogueLineCount || 0,
    actionBeatCount: context.actionBeatCount || 0,
    combatBeatCount: context.combatBeatCount || 0,
    emotionalBeatCount: context.emotionalBeatCount || 0,
    soundCues: unique([...(scene.breakdown?.sfx || []), ...(scene.breakdown?.bgm || []).map((item) => item.description || item.prompt)]),
    continuityIn: shots[0]?.continuityNote || scene.interactiveMetadata?.incomingContext || startState,
    continuityOut: shots[shots.length - 1]?.continuityNote || scene.interactiveMetadata?.outgoingContext || endState,
  };
};

const visibleEventClauses = (shots: Shot[]) => unique(shots.flatMap((shot) => textOf(
  shot.visualAction,
  shot.microExpression,
).split(/[，。；;,.!?！？\n]+/u))
  .map((value) => value.trim())
  .filter((value) => value && !/^(?:可见角色|出镜角色|画面角色)[:：]/u.test(value)));

const targetPanelCount = (
  mode: StoryboardBoardMode,
  shots: Shot[],
  context: StoryboardStrategySelectionContext,
) => {
  const range = PANEL_RANGE_BY_MODE[mode];
  const durationDrivenCount = Math.ceil(Math.max(1, Number(context.expectedVideoUnitDurationSeconds || 8)) / 2);
  const eventDrivenCount = visibleEventClauses(shots).length + 2;
  const actionDrivenCount = Math.min(range.max, 3 + Math.max(0, context.actionBeatCount || 0) + Math.max(0, context.combatBeatCount || 0) * 2);
  const dialogueDrivenCount = 2 + Math.min(4, Math.max(0, context.dialogueLineCount || 0));
  return clamp(
    Math.max(shots.length, durationDrivenCount, eventDrivenCount, actionDrivenCount, dialogueDrivenCount),
    range.min,
    range.max,
  );
};

const panelDurationSeconds = (context: StoryboardStrategySelectionContext, totalPanels: number) => {
  const unitDuration = Number(context.expectedVideoUnitDurationSeconds || 0);
  const duration = Number.isFinite(unitDuration) && unitDuration > 0 ? unitDuration : 8;
  return Number((duration / Math.max(1, totalPanels)).toFixed(2));
};

const panelPurpose = (index: number, total: number) => {
  if (index === 0) return "建立视频单元首帧、空间方位和角色初始状态。";
  if (index === total - 1) return "收束尾帧状态，保证能接下一段视频单元。";
  if (index < total / 3) return "推进表演和动作起势，交代视线或道具方向。";
  if (index < total * 2 / 3) return "承接动作/对白核心变化，控制镜头运动和节奏。";
  return "呈现反应或结果，明确资产状态和空间位置。";
};

const panelTemporalPhase = (index: number, total: number) => {
  const progress = total <= 1 ? 100 : Math.round(index * 100 / (total - 1));
  if (index === 0) return `动作进度${progress}%：动作尚未开始，锁定起始姿态、视线、道具和空间位置`;
  if (index === total - 1) return `动作进度${progress}%：动作已经完成，锁定结果、反应和可接续尾帧`;
  if (progress < 30) return `动作进度${progress}%：起势阶段，身体重心、手部或视线开始发生变化`;
  if (progress < 65) return `动作进度${progress}%：执行阶段，核心动作正在发生但尚未完成`;
  if (progress < 90) return `动作进度${progress}%：结果出现，主体或道具状态发生可见变化`;
  return `动作进度${progress}%：余势收束，角色反应和道具落点稳定下来`;
};

const splitVisibleClauses = (...values: unknown[]) => unique(
  textOf(...values)
    .split(/[，。；;,.!?！？\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean),
);

const temporalizeVisibleChange = (value: string, index: number, total: number) => {
  if (total <= 1) return value;
  const progress = index / Math.max(1, total - 1);
  if (index === 0) return `动作前状态：${value}尚未发生，人物和道具保持起始位置`;
  if (index === total - 1) return `动作后状态：${value}已经完成，结果与人物反应稳定可见`;
  if (progress < 0.35) return `动作起势：${value}开始发生，手部、视线或身体重心出现第一处可见变化`;
  if (progress < 0.75) return `动作执行：${value}正在发生，核心操作和道具状态必须清楚可见`;
  return `动作结果：${value}接近完成，人物反应和道具落点开始稳定`;
};

const panelVisibleBeat = ({
  index,
  total,
  shot,
  scene,
}: {
  index: number;
  total: number;
  shot: Shot;
  scene: Scene;
}) => {
  const purpose = panelPurpose(index, total);
  const clauses = splitVisibleClauses(
    shot.visualAction,
    shot.microExpression,
  ).filter((value) => !/^(?:可见角色|出镜角色|画面角色)[:：]/u.test(value));
  const clauseIndex = Math.min(
    Math.max(0, clauses.length - 1),
    Math.floor(index * Math.max(1, clauses.length) / Math.max(1, total)),
  );
  const visibleChange = temporalizeVisibleChange(
    clauses[clauseIndex] || shot.visualAction || scene.description || scene.title,
    index,
    total,
  );
  const phasedAction = `${purpose} ${panelTemporalPhase(index, total)}；当前可见事件：${visibleChange}`;
  return {
    purpose,
    visualBeat: phasedAction,
    subjectAction: phasedAction,
  };
};

const cameraNoteForShot = (shot: Shot) =>
  [
    shot.shotSize,
    shot.cameraAngle,
    shot.cameraMovement,
    shot.focalLength,
    shot.composition,
    shot.continuityNote,
  ].filter(Boolean).join("；") || "保持轴线、视线和动作方向连续。";

const selectPanelArrows = (context: StoryboardStrategySelectionContext) => {
  const arrows = ["shot_note_black", "subject_action_red", "camera_motion_blue", "composition_note_green"];
  if ((context.dialogueLineCount || 0) > 0 || (context.emotionalBeatCount || 0) > 0) {
    arrows.push("eyeline_attention_green", "sound_emotion_purple");
  }
  if ((context.combatBeatCount || 0) > 0 || context.revealOrTwist) {
    arrows.push("energy_impact_orange", "lighting_direction_orange");
  }
  return unique(arrows);
};

const requiresActionDepartmentPrep = (
  scene: Scene,
  shots: Shot[],
  context: StoryboardStrategySelectionContext,
) => (context.combatBeatCount || 0) > 0 || ACTION_DEPARTMENT_PATTERN.test(textOf(
  scene.title,
  scene.description,
  scene.script,
  scene.scriptBlocks?.map((block) => block.content),
  shots.map((shot) => textOf(shot.visualAction, shot.blocking, shot.cameraMovement, shot.motivation, shot.continuityNote)),
));

const buildPanels = (
  boardId: string,
  beatId: string,
  scene: Scene,
  shots: Shot[],
  mode: StoryboardBoardMode,
  context: StoryboardStrategySelectionContext,
  departmentRefs?: StoryboardDepartmentPrepRefSet,
): StoryboardBoardPanel[] => {
  const total = targetPanelCount(mode, shots, context);
  const dialogueLines = collectDialogueLines(scene, shots);
  const panelArrows = selectPanelArrows(context);
  const durationSeconds = panelDurationSeconds(context, total);

  return Array.from({ length: total }, (_, index) => {
    const shot = shots[Math.min(shots.length - 1, Math.floor(index * shots.length / total))];
    const dialogue = dialogueLines[index % Math.max(1, dialogueLines.length)];
    const soundCue = dialogue || (scene.breakdown?.sfx || [])[index % Math.max(1, scene.breakdown?.sfx?.length || 1)];
    const visibleBeat = panelVisibleBeat({ index, total, shot, scene });
    const assetRefs = unique([
      ...(shot.characterIdsInShot || []),
      shot.locationId,
      ...(shot.propIds || []),
      scene.breakdown?.locationId,
      ...(scene.breakdown?.propIds || []),
    ]);
    return {
      id: `${boardId}.panel.${index + 1}`,
      panelNumber: index + 1,
      performanceBeatId: beatId,
      shotId: shot.id,
      durationSeconds,
      durationBeat: `${durationSeconds}s`,
      framePurpose: visibleBeat.purpose,
      shotType: [shot.shotSize, shot.cameraAngle].filter(Boolean).join(" / ") || "story beat keyframe",
      visualBeat: visibleBeat.visualBeat,
      cameraNote: cameraNoteForShot(shot),
      framing: shot.shotSize,
      lens: shot.focalLength,
      angle: shot.cameraAngle,
      cameraMove: shot.cameraMovement || cameraNoteForShot(shot),
      subjectAction: visibleBeat.subjectAction,
      bodyMotion: shot.blocking || shot.visualAction,
      blocking: shot.blocking,
      lightingCue: shot.lighting || textOf(scene.title, scene.description),
      soundCue,
      emotionCue: shot.microExpression || shot.motivation || textOf(scene.valueShift?.from, scene.valueShift?.to, scene.valueShift?.reason),
      compositionNote: shot.composition,
      continuityIn: shot.continuityNote || scene.interactiveMetadata?.incomingContext,
      continuityOut: shot.continuityNote || scene.interactiveMetadata?.outgoingContext,
      assetRefs,
      annotationLegendIds: panelArrows,
      renderInstruction: "Use line-art storyboard control style; prioritize readable motion, camera, lighting, sound/emotion annotations, and continuity over final render detail.",
      actionArrowLegendIds: panelArrows,
      dialogueOrSoundCue: soundCue,
      departmentRefIds: departmentRefs ? storyboardDepartmentPrepRefIdsForShot(departmentRefs, shot.id) : undefined,
    };
  });
};

const makeIssue = (
  severity: VideoStoryboardArtifactIssue["severity"],
  code: string,
  target: string,
  message: string,
): VideoStoryboardArtifactIssue => ({ severity, code, target, message });

export const buildProductionStoryboardBoardDrafts = (
  project: Project,
  episodes: Episode[],
  options: ProductionStoryboardBoardDraftOptions = {},
): ProductionStoryboardBoardDrafts => {
  const modelProfile = selectVideoModelProfile(project);
  const styleLock = resolveVisualStyleLock(project);
  const styleLockVersion = styleLockVersionForProject(project) || styleLock.version;
  const maxDuration = modelProfile.maxDurationSeconds || 15;
  const beats: PerformanceBeat[] = [];
  const boards: StoryboardBoard[] = [];
  const issues: VideoStoryboardArtifactIssue[] = [];
  const boardSceneIds: string[] = [];

  for (const episode of episodes) {
    for (const scene of episode.scenes || []) {
      const shots = (scene.shots || []).filter((shot) => shot.id);
      if (shots.length === 0) continue;

      const shotGroups = chunkShotsByModelDuration(shots, maxDuration, modelProfile.preferredDurationsSeconds);
      shotGroups.forEach((group, groupIndex) => {
        const context = buildSelectionContext(project, scene, group, {
          isFirstGroup: groupIndex === 0,
          isLastGroup: groupIndex === shotGroups.length - 1,
          isWholeScene: shotGroups.length === 1,
        });
        const decision = buildStrategyDecision(context);
        const strategy = getStoryboardPromptStrategyById(decision.selectedStrategyId);
        const boardId = `${episode.id}.${scene.id}.storyboard_board.${groupIndex + 1}`;
        const beatId = `${boardId}.beat.1`;
        const beat = buildPerformanceBeat(beatId, episode.id, scene, group, context);
        const departmentRefs = buildStoryboardDepartmentPrepRefs(options.departmentPrepPackages, scene.id, group.map((shot) => shot.id));
        const includeDepartmentRefs = Boolean(options.departmentPrepPackages?.length) || options.requireDepartmentPrepRefs;
        const panels = buildPanels(
          boardId,
          beatId,
          scene,
          group,
          strategy?.boardMode || "multi_shot_narrative",
          context,
          includeDepartmentRefs ? departmentRefs : undefined,
        );
        const startState = beat.startState;
        const endState = beat.endState;
        const layout = `${panels.length}格${strategy?.name || "线稿故事板"}`;
        const board: StoryboardBoard = {
          id: boardId,
          episodeId: episode.id,
          sceneId: scene.id,
          strategyDecision: decision,
          boardMode: strategy?.boardMode || "multi_shot_narrative",
          layout,
          lineArtPrompt: "",
          arrowLegendIds: decision.arrowLegendIds,
          performanceBeatIds: [beatId],
          scriptBlockIds: (scene.scriptBlocks || []).map((block) => block.id).filter(Boolean),
          shotIds: group.map((shot) => shot.id),
          styleLockVersion,
          strategyOrigin: "built_in",
          templateScope: "global_builtin",
          visualStyleLockRefs: styleLock.styleSourceRefs,
          annotationLegendVersion: styleLockVersion,
          panels,
          startState,
          endState,
          ...(includeDepartmentRefs ? departmentRefs : {}),
        };
        if (includeDepartmentRefs) {
          const requiredDepartments = options.requiredDepartmentRefs || unique([
            "cinematography",
            "lighting",
            sceneNeedsPerformancePrep(scene, group) ? "performance_directing" : undefined,
            requiresActionDepartmentPrep(scene, group, context) ? "action_choreography" : undefined,
          ] as Array<StoryboardDepartmentRefDepartment | undefined>) as StoryboardDepartmentRefDepartment[];
          for (const missingDepartment of missingStoryboardDepartmentPrepRefs(departmentRefs, requiredDepartments)) {
            issues.push(makeIssue(
              options.requireDepartmentPrepRefs ? "blocking" : "warning",
              "STORYBOARD_BOARD_DEPARTMENT_REFS_MISSING",
              `storyboardBoard.${boardId}.${missingDepartment}`,
              `${scene.title || scene.id} 的故事板缺少${storyboardDepartmentLabel(missingDepartment)}部门 prep 引用，无法确认该页是否继承正式制片统筹约束。`,
            ));
          }
        }
        board.lineArtPrompt = renderStoryboardBoardPrompt({ project, scene, board, strategy }).prompt;
        beats.push(beat);
        boards.push(board);
        boardSceneIds.push(scene.id);

        const groupDuration = group.reduce((sum, shot) => sum + shotDuration(shot), 0);
        if (groupDuration > maxDuration) {
          issues.push(makeIssue(
            "warning",
            "STORYBOARD_BOARD_GROUP_OVER_MODEL_MAX",
            `storyboardBoard.${boardId}.shotIds`,
            `该镜头组原始时长 ${groupDuration}s 超过模型 profile 单次上限 ${maxDuration}s，后续 video unit 阶段需要再拆分或重写镜头节奏。`,
          ));
        }
        issues.push(...validateStoryboardBoard(board, context));
      });
    }
  }

  issues.push(...validatePerformanceBeats(beats));
  if (boards.length === 0) {
    issues.push(makeIssue("warning", "STORYBOARD_BOARD_EMPTY", "storyboardBoards", "没有可派生的 storyboard_board；通常说明场景还没有 shots。"));
  }

  return {
    performanceBeats: beats,
    storyboardBoards: boards,
    issues,
    boardSceneIds: unique(boardSceneIds),
  };
};
