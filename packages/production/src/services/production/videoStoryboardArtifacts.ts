import {
  getStoryboardPromptStrategyById,
  getVideoModelProfileById,
  STORYBOARD_ARROW_LEGEND,
  StoryboardBoardMode,
  StoryboardStrategyDecision,
  StoryboardStrategySelectionContext,
  StoryboardStrategySelectionIssue,
  validateStoryboardStrategyDecision,
} from "./videoStoryboardSystem";
import type { VisualCompileManifest } from "../../../../domain/src/visualArtifact";
import type { Project } from "../../../../../src/types/project";

export type VideoStoryboardArtifactKind =
  | "performance_beats"
  | "storyboard_board"
  | "scene_visual_pack"
  | "asset_reference_pack"
  | "video_generation_unit";

export type PerformanceBeatType =
  | "dialogue"
  | "action"
  | "combat"
  | "emotion"
  | "reveal"
  | "transition"
  | "interactive_idle";

export interface PerformanceBeat {
  id: string;
  episodeId: string;
  sceneId: string;
  scriptBlockIds: string[];
  beatType: PerformanceBeatType;
  summary: string;
  visibleChange: string;
  startState: string;
  endState: string;
  durationSeconds: number;
  characterIds: string[];
  locationId?: string;
  propIds: string[];
  dialogueLineCount?: number;
  actionBeatCount?: number;
  combatBeatCount?: number;
  emotionalBeatCount?: number;
  soundCues: string[];
  continuityIn: string;
  continuityOut: string;
}

export interface StoryboardBoardPanel {
  id: string;
  panelNumber: number;
  performanceBeatId?: string;
  shotId?: string;
  videoUnitId?: string;
  durationSeconds?: number;
  durationBeat?: string;
  framePurpose: string;
  shotType?: string;
  visualBeat?: string;
  cameraNote?: string;
  framing?: string;
  lens?: string;
  angle?: string;
  cameraMove?: string;
  subjectAction?: string;
  bodyMotion?: string;
  blocking?: string;
  lightingCue?: string;
  soundCue?: string;
  emotionCue?: string;
  compositionNote?: string;
  continuityIn?: string;
  continuityOut?: string;
  assetRefs?: string[];
  annotationLegendIds?: string[];
  renderInstruction?: string;
  actionArrowLegendIds: string[];
  dialogueOrSoundCue?: string;
  departmentRefIds?: string[];
}

export type StoryboardDepartmentRefDepartment =
  | "cinematography"
  | "lighting"
  | "performance_directing"
  | "action_choreography";

export interface StoryboardDepartmentPrepRef {
  id: string;
  department: StoryboardDepartmentRefDepartment;
  packageId: string;
  ownerAgentId: string;
  schemaVersion?: string;
  sceneRefs: string[];
  shotRefs: string[];
  payloadPath: string;
  summary: string;
}

export interface StoryboardBoard {
  id: string;
  episodeId: string;
  sceneId: string;
  strategyDecision: StoryboardStrategyDecision;
  boardMode: StoryboardBoardMode;
  layout: string;
  lineArtPrompt: string;
  arrowLegendIds: string[];
  performanceBeatIds: string[];
  scriptBlockIds: string[];
  shotIds: string[];
  assetReferencePackId?: string;
  videoGenerationUnitId?: string;
  styleLockVersion?: string;
  strategyOrigin?: "built_in" | "project_local" | "production_block_local" | "scene_range_local" | "global_candidate";
  templateScope?: string;
  visualStyleLockRefs?: string[];
  annotationLegendVersion?: string;
  strategyDraftId?: string;
  panels: StoryboardBoardPanel[];
  startState: string;
  endState: string;
  cinematographyRefs?: StoryboardDepartmentPrepRef[];
  lightingRefs?: StoryboardDepartmentPrepRef[];
  performanceRefs?: StoryboardDepartmentPrepRef[];
  actionRefs?: StoryboardDepartmentPrepRef[];
  /** Explicitly adopted composite-board media. Generated candidates live outside this contract until review. */
  generatedImageUrl?: string;
  visualReview?: {
    mode: "manual";
    status: "pending" | "approved" | "rejected";
    technicalQA?: "passed" | "failed";
    warningCodes?: string[];
    modelConfigId?: string;
    generatedAt?: number;
    reviewedAt?: number;
    reviewedBy?: "user";
  };
}

export interface AssetReferencePackItem {
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles" | "style" | "frame";
  variantId?: string;
  referenceAssetId?: string;
  referenceImageUrl?: string;
  roleInUnit: string;
  required: boolean;
}

export interface AssetReferencePack {
  id: string;
  episodeId?: string;
  sceneId?: string;
  sceneVisualPackId?: string;
  modelInputFingerprint?: string;
  modelProfileId: string;
  purpose: string;
  items: AssetReferencePackItem[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  packagingNotes: string;
  styleLockVersion?: string;
  visualStyleLockRefs?: string[];
  storyboardStrategyIds?: string[];
  storyboardStrategyOrigin?: StoryboardBoard["strategyOrigin"];
  annotationLegendVersion?: string;
  cameraRefs?: StoryboardDepartmentPrepRef[];
  lightingRefs?: StoryboardDepartmentPrepRef[];
  performanceRefs?: StoryboardDepartmentPrepRef[];
  actionRefs?: StoryboardDepartmentPrepRef[];
}

export interface SceneVisualPackLocation {
  assetId: string;
  variantId?: string;
  setDressingState: string;
  timeOfDay?: string;
  weather?: string;
  lightingState?: string;
  damageState?: string;
}

export interface SceneVisualPackCharacter {
  characterId: string;
  variantId?: string;
  continuityState?: string;
  costumeState?: string;
  makeupState?: string;
  hairState?: string;
  injuryState?: string;
  emotionalBaseline?: string;
}

export interface SceneVisualPackProp {
  assetId: string;
  variantId?: string;
  ownerCharacterId?: string;
  usageState?: string;
  continuityState?: string;
}

export interface SceneVisualPackVehicle {
  assetId: string;
  variantId?: string;
  continuityState: string;
  referenceImageUrl?: string;
}

export interface SceneVisualPackReferenceSlot {
  slotId: string;
  assetId: string;
  variantId?: string;
  boardItemId?: string;
  referenceImageUrl?: string;
  purpose: "identity" | "costume" | "set" | "prop" | "vehicle" | "state" | "continuity";
  priority: number;
}

export interface SceneVisualPack {
  id: string;
  projectId: string;
  episodeId: string;
  sourceSceneIds: string[];
  linkedSceneIds: string[];
  baseAssetBoardPlanId: string;
  visualFingerprint: string;
  reuseOfPackId?: string;
  location: SceneVisualPackLocation;
  characters: SceneVisualPackCharacter[];
  props: SceneVisualPackProp[];
  vehicles?: SceneVisualPackVehicle[];
  referenceSlots: SceneVisualPackReferenceSlot[];
  continuityIn: string;
  continuityOut: string;
  qaChecklist: string[];
}

export interface VideoGenerationUnit {
  id: string;
  episodeId: string;
  sceneId: string;
  modelProfileId: string;
  durationSeconds: number;
  performanceBeatIds: string[];
  storyboardBoardId: string;
  assetReferencePackId: string;
  shotIds: string[];
  startState: string;
  endState: string;
  previousUnitId?: string;
  nextUnitId?: string;
  promptTemplateId: string;
  videoPrompt: string;
  audioPlan?: string;
  styleLockVersion?: string;
  visualStyleLockRefs?: string[];
  /** Audit-only projection lineage. Provider text is compiled once at the execution boundary. */
  visualStyleCompileManifest?: VisualCompileManifest;
  storyboardStrategyId?: string;
  storyboardStrategyVersion?: string;
  storyboardStrategyOrigin?: StoryboardBoard["strategyOrigin"];
  annotationLegendIds?: string[];
  annotationLegendVersion?: string;
  cameraRefs?: StoryboardDepartmentPrepRef[];
  lightingRefs?: StoryboardDepartmentPrepRef[];
  performanceRefs?: StoryboardDepartmentPrepRef[];
  actionRefs?: StoryboardDepartmentPrepRef[];
}

export interface VideoStoryboardPlan {
  performanceBeats: PerformanceBeat[];
  storyboardBoards: StoryboardBoard[];
  sceneVisualPacks?: SceneVisualPack[];
  assetReferencePacks: AssetReferencePack[];
  videoGenerationUnits: VideoGenerationUnit[];
}

export interface VideoStoryboardArtifactIssue {
  severity: "blocking" | "warning";
  code: string;
  target: string;
  message: string;
}

export interface VideoStoryboardArtifactContract {
  kind: VideoStoryboardArtifactKind;
  stage: "script" | "asset_sync" | "storyboard" | "prompt" | "expensive_generation_planning";
  commitBehavior: "operator_artifact_only";
  requiredFields: string[];
  qaFunction: string;
  promptTemplateIds: string[];
  purpose: string;
}

const nowIssueTarget = (kind: string, id?: string) => id ? `${kind}.${id}` : kind;

const isNonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const isPositiveNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;

const issue = (
  severity: VideoStoryboardArtifactIssue["severity"],
  code: string,
  target: string,
  message: string,
): VideoStoryboardArtifactIssue => ({ severity, code, target, message });

const normalizeArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const validateDepartmentPrepRefs = (
  value: unknown,
  expectedDepartment: StoryboardDepartmentRefDepartment,
  target: string,
  field: string,
): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  if (value === undefined) return issues;
  if (!Array.isArray(value)) {
    issues.push(issue("blocking", "DEPARTMENT_PREP_REFS_INVALID", `${target}.${field}`, `${field} 必须是部门 prep 引用数组。`));
    return issues;
  }
  for (const ref of normalizeArray<Partial<StoryboardDepartmentPrepRef>>(value)) {
    const refTarget = `${target}.${field}.${ref?.id || ref?.packageId || "unknown"}`;
    if (!isNonEmptyString(ref?.id)) issues.push(issue("blocking", "DEPARTMENT_PREP_REF_ID_MISSING", refTarget, "部门 prep 引用缺少 id。"));
    if (ref?.department !== expectedDepartment) {
      issues.push(issue("blocking", "DEPARTMENT_PREP_REF_DEPARTMENT_MISMATCH", refTarget, `部门 prep 引用应为 ${expectedDepartment}，实际为 ${ref?.department || "(empty)"}。`));
    }
    if (!isNonEmptyString(ref?.packageId)) issues.push(issue("blocking", "DEPARTMENT_PREP_REF_PACKAGE_MISSING", refTarget, "部门 prep 引用缺少 packageId。"));
    if (!isNonEmptyString(ref?.ownerAgentId)) issues.push(issue("warning", "DEPARTMENT_PREP_REF_OWNER_MISSING", refTarget, "部门 prep 引用建议记录 ownerAgentId。"));
    if (!Array.isArray(ref?.sceneRefs)) issues.push(issue("blocking", "DEPARTMENT_PREP_REF_SCENES_INVALID", refTarget, "部门 prep 引用 sceneRefs 必须是数组。"));
    if (!Array.isArray(ref?.shotRefs)) issues.push(issue("blocking", "DEPARTMENT_PREP_REF_SHOTS_INVALID", refTarget, "部门 prep 引用 shotRefs 必须是数组。"));
    if (!isNonEmptyString(ref?.payloadPath)) issues.push(issue("blocking", "DEPARTMENT_PREP_REF_PAYLOAD_PATH_MISSING", refTarget, "部门 prep 引用缺少 payloadPath，无法追溯 specialistPayload。"));
    if (!isNonEmptyString(ref?.summary)) issues.push(issue("warning", "DEPARTMENT_PREP_REF_SUMMARY_MISSING", refTarget, "部门 prep 引用建议包含 summary，供故事板/prompt/video 单元继承。"));
  }
  return issues;
};

const collectDepartmentPrepRefIds = (
  refs: Array<StoryboardDepartmentPrepRef[] | undefined>,
) => new Set(refs.flatMap((items) => normalizeArray<StoryboardDepartmentPrepRef>(items).map((ref) => ref.id).filter(Boolean)));

const boardPanelRangeByMode: Record<StoryboardBoardMode, { min: number; max: number }> = {
  single_shot_performance: { min: 3, max: 4 },
  dialogue_blocking: { min: 4, max: 6 },
  multi_shot_narrative: { min: 6, max: 9 },
  spatial_geography: { min: 4, max: 8 },
  montage_compression: { min: 6, max: 12 },
  procedural_insert: { min: 4, max: 10 },
  parallel_intercut: { min: 6, max: 12 },
  subjective_suspense: { min: 4, max: 8 },
  action_continuity: { min: 4, max: 12 },
  fight_choreography: { min: 12, max: 16 },
  dance_choreography: { min: 12, max: 20 },
  emotional_reaction: { min: 3, max: 5 },
  emotional_performance: { min: 3, max: 5 },
  reveal_or_twist: { min: 4, max: 8 },
  effect_reveal: { min: 4, max: 8 },
  transition_bridge: { min: 2, max: 4 },
  interactive_idle_loop: { min: 2, max: 6 },
  interactive_ui_safe: { min: 4, max: 8 },
  ai_video_control: { min: 6, max: 12 },
  rhythm_sheet: { min: 16, max: 24 },
};

export const VIDEO_STORYBOARD_ARTIFACT_CONTRACTS: VideoStoryboardArtifactContract[] = [
  {
    kind: "performance_beats",
    stage: "script",
    commitBehavior: "operator_artifact_only",
    requiredFields: ["performanceBeats[].id", "performanceBeats[].durationSeconds", "performanceBeats[].visibleChange", "performanceBeats[].continuityIn", "performanceBeats[].continuityOut"],
    qaFunction: "validatePerformanceBeats",
    promptTemplateIds: ["storyboard.performanceBeats.plan"],
    purpose: "把 scriptBlocks 旁路切成可用于故事板和视频单元的表演、动作、对白、声音节拍。",
  },
  {
    kind: "storyboard_board",
    stage: "storyboard",
    commitBehavior: "operator_artifact_only",
    requiredFields: ["storyboardBoard.strategyDecision", "storyboardBoard.panels", "storyboardBoard.lineArtPrompt", "storyboardBoard.arrowLegendIds"],
    qaFunction: "validateStoryboardBoard",
    promptTemplateIds: ["storyboard.strategy.select", "storyboard.board.*"],
    purpose: "记录一段视频生成单元的线稿故事板计划、panel、箭头 legend 和策略选择证据。",
  },
  {
    kind: "scene_visual_pack",
    stage: "asset_sync",
    commitBehavior: "operator_artifact_only",
    requiredFields: ["sceneVisualPack.visualFingerprint", "sceneVisualPack.location", "sceneVisualPack.characters", "sceneVisualPack.props", "sceneVisualPack.referenceSlots", "sceneVisualPack.continuityIn", "sceneVisualPack.continuityOut"],
    qaFunction: "validateSceneVisualPack",
    promptTemplateIds: ["storyboard.sceneVisualPack.plan"],
    purpose: "在 asset_sync 阶段把当前场真正需要的角色变体、场景布置、服化道、道具状态和参考槽位整理成可复用视觉包。",
  },
  {
    kind: "asset_reference_pack",
    stage: "prompt",
    commitBehavior: "operator_artifact_only",
    requiredFields: ["assetReferencePack.modelProfileId", "assetReferencePack.items", "assetReferencePack.packagingNotes"],
    qaFunction: "validateAssetReferencePack",
    promptTemplateIds: ["storyboard.assetReferencePack.plan"],
    purpose: "把角色板、场景板、道具板、变体板和首尾帧参考打包，避免把外貌材质塞进视频长 prompt。",
  },
  {
    kind: "video_generation_unit",
    stage: "expensive_generation_planning",
    commitBehavior: "operator_artifact_only",
    requiredFields: ["videoGenerationUnit.modelProfileId", "videoGenerationUnit.durationSeconds", "videoGenerationUnit.storyboardBoardId", "videoGenerationUnit.assetReferencePackId"],
    qaFunction: "validateVideoGenerationUnit",
    promptTemplateIds: ["storyboard.videoGenerationUnit.plan"],
    purpose: "记录一次视频模型调用的最小生产包，包含时长、模型 profile、故事板、资产参考包和首尾状态。",
  },
];

export const validatePerformanceBeats = (beats: PerformanceBeat[]): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const ids = new Set<string>();
  for (const beat of normalizeArray<PerformanceBeat>(beats)) {
    const target = nowIssueTarget("performanceBeats", beat?.id);
    if (!isNonEmptyString(beat?.id)) issues.push(issue("blocking", "PERFORMANCE_BEAT_ID_MISSING", target, "performanceBeat 缺少 id。"));
    if (ids.has(beat.id)) issues.push(issue("blocking", "PERFORMANCE_BEAT_ID_DUPLICATE", target, `performanceBeat id 重复：${beat.id}`));
    ids.add(beat.id);
    if (!isNonEmptyString(beat?.episodeId)) issues.push(issue("blocking", "PERFORMANCE_BEAT_EPISODE_MISSING", target, "performanceBeat 缺少 episodeId。"));
    if (!isNonEmptyString(beat?.sceneId)) issues.push(issue("blocking", "PERFORMANCE_BEAT_SCENE_MISSING", target, "performanceBeat 缺少 sceneId。"));
    if (!isNonEmptyString(beat?.summary)) issues.push(issue("blocking", "PERFORMANCE_BEAT_SUMMARY_MISSING", target, "performanceBeat 缺少剧情节拍摘要。"));
    if (!isNonEmptyString(beat?.visibleChange)) issues.push(issue("blocking", "PERFORMANCE_BEAT_VISIBLE_CHANGE_MISSING", target, "performanceBeat 必须说明该短时片段内的可见变化。"));
    if (!isNonEmptyString(beat?.startState) || !isNonEmptyString(beat?.endState)) {
      issues.push(issue("blocking", "PERFORMANCE_BEAT_STATE_MISSING", target, "performanceBeat 必须有 startState 和 endState。"));
    }
    if (!isPositiveNumber(beat?.durationSeconds)) issues.push(issue("blocking", "PERFORMANCE_BEAT_DURATION_INVALID", target, "performanceBeat durationSeconds 必须是正数。"));
    if (!Array.isArray(beat?.scriptBlockIds) || beat.scriptBlockIds.length === 0) {
      issues.push(issue("warning", "PERFORMANCE_BEAT_SCRIPT_LINK_WEAK", target, "performanceBeat 建议绑定 scriptBlockIds，避免故事板脱离剧本。"));
    }
    if (!Array.isArray(beat?.characterIds)) issues.push(issue("blocking", "PERFORMANCE_BEAT_CHARACTER_IDS_INVALID", target, "performanceBeat characterIds 必须是数组。"));
    if (!Array.isArray(beat?.propIds)) issues.push(issue("blocking", "PERFORMANCE_BEAT_PROP_IDS_INVALID", target, "performanceBeat propIds 必须是数组。"));
    if (!Array.isArray(beat?.soundCues)) issues.push(issue("blocking", "PERFORMANCE_BEAT_SOUND_CUES_INVALID", target, "performanceBeat soundCues 必须是数组。"));
    if (!isNonEmptyString(beat?.continuityIn) || !isNonEmptyString(beat?.continuityOut)) {
      issues.push(issue("blocking", "PERFORMANCE_BEAT_CONTINUITY_MISSING", target, "performanceBeat 必须记录 continuityIn 和 continuityOut。"));
    }
  }
  if (!Array.isArray(beats) || beats.length === 0) {
    issues.push(issue("blocking", "PERFORMANCE_BEATS_EMPTY", "performanceBeats", "performance_beats artifact 必须包含 performanceBeats 数组。"));
  }
  return issues;
};

const mapStrategyIssues = (
  issues: StoryboardStrategySelectionIssue[],
  targetPrefix: string,
): VideoStoryboardArtifactIssue[] =>
  issues.map((item) => issue(item.severity, item.code, `${targetPrefix}.${item.field || "strategyDecision"}`, item.message));

export const validateStoryboardBoard = (
  board: StoryboardBoard,
  context: StoryboardStrategySelectionContext = {},
): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const target = nowIssueTarget("storyboardBoard", board?.id);
  const strategy = board?.strategyDecision?.selectedStrategyId
    ? getStoryboardPromptStrategyById(board.strategyDecision.selectedStrategyId)
    : undefined;
  const knownLegendIds = new Set(STORYBOARD_ARROW_LEGEND.map((entry) => entry.id));
  issues.push(...mapStrategyIssues(validateStoryboardStrategyDecision(board?.strategyDecision || {}, context), target));

  if (!isNonEmptyString(board?.id)) issues.push(issue("blocking", "STORYBOARD_BOARD_ID_MISSING", target, "StoryboardBoard 缺少 id。"));
  if (!isNonEmptyString(board?.episodeId)) issues.push(issue("blocking", "STORYBOARD_BOARD_EPISODE_MISSING", target, "StoryboardBoard 缺少 episodeId。"));
  if (!isNonEmptyString(board?.sceneId)) issues.push(issue("blocking", "STORYBOARD_BOARD_SCENE_MISSING", target, "StoryboardBoard 缺少 sceneId。"));
  if (!isNonEmptyString(board?.layout)) issues.push(issue("blocking", "STORYBOARD_BOARD_LAYOUT_MISSING", target, "StoryboardBoard 缺少 layout。"));
  if (!isNonEmptyString(board?.lineArtPrompt)) issues.push(issue("blocking", "STORYBOARD_BOARD_PROMPT_MISSING", target, "StoryboardBoard 缺少 lineArtPrompt。"));
  if (!Array.isArray(board?.arrowLegendIds) || board.arrowLegendIds.length === 0) {
    issues.push(issue("blocking", "STORYBOARD_BOARD_LEGEND_MISSING", target, "StoryboardBoard 必须记录 arrowLegendIds。"));
  } else {
    for (const legendId of board.arrowLegendIds) {
      if (!knownLegendIds.has(legendId)) issues.push(issue("blocking", "STORYBOARD_BOARD_UNKNOWN_LEGEND", target, `StoryboardBoard 使用未知 arrow legend：${legendId}`));
    }
  }
  if (!Array.isArray(board?.performanceBeatIds) || board.performanceBeatIds.length === 0) {
    issues.push(issue("blocking", "STORYBOARD_BOARD_BEATS_MISSING", target, "StoryboardBoard 必须绑定 performanceBeatIds。"));
  }
  issues.push(...validateDepartmentPrepRefs(board?.cinematographyRefs, "cinematography", target, "cinematographyRefs"));
  issues.push(...validateDepartmentPrepRefs(board?.lightingRefs, "lighting", target, "lightingRefs"));
  issues.push(...validateDepartmentPrepRefs(board?.performanceRefs, "performance_directing", target, "performanceRefs"));
  issues.push(...validateDepartmentPrepRefs(board?.actionRefs, "action_choreography", target, "actionRefs"));
  const boardDepartmentRefIds = collectDepartmentPrepRefIds([
    board?.cinematographyRefs,
    board?.lightingRefs,
    board?.performanceRefs,
    board?.actionRefs,
  ]);
  if (!Array.isArray(board?.panels) || board.panels.length === 0) {
    issues.push(issue("blocking", "STORYBOARD_BOARD_PANELS_EMPTY", target, "StoryboardBoard 必须包含 panels。"));
  } else if (strategy) {
    const range = boardPanelRangeByMode[strategy.boardMode];
    if (range && (board.panels.length < range.min || board.panels.length > range.max)) {
      issues.push(issue("warning", "STORYBOARD_BOARD_PANEL_COUNT_OUTSIDE_STRATEGY", target, `panel 数量 ${board.panels.length} 不在策略 ${strategy.id} 的建议范围 ${range.min}-${range.max}。`));
    }
  }
  for (const panel of normalizeArray<StoryboardBoardPanel>(board?.panels)) {
    const panelTarget = `${target}.panels.${panel?.id || panel?.panelNumber || "unknown"}`;
    if (!isPositiveNumber(panel?.panelNumber)) issues.push(issue("blocking", "STORYBOARD_PANEL_NUMBER_INVALID", panelTarget, "panelNumber 必须是正数。"));
    if (!isNonEmptyString(panel?.framePurpose)) issues.push(issue("blocking", "STORYBOARD_PANEL_PURPOSE_MISSING", panelTarget, "panel 缺少 framePurpose。"));
    if (!isNonEmptyString(panel?.visualBeat) && !isNonEmptyString(panel?.subjectAction)) {
      issues.push(issue("blocking", "STORYBOARD_PANEL_VISUAL_BEAT_MISSING", panelTarget, "panel 必须包含 visualBeat 或 subjectAction。"));
    }
    if (!isNonEmptyString(panel?.cameraNote) && !isNonEmptyString(panel?.cameraMove)) {
      issues.push(issue("blocking", "STORYBOARD_PANEL_CAMERA_NOTE_MISSING", panelTarget, "panel 必须包含 cameraNote 或 cameraMove。"));
    }
    const panelLegendIds = [
      ...normalizeArray<string>(panel?.actionArrowLegendIds),
      ...normalizeArray<string>(panel?.annotationLegendIds),
    ];
    if (panelLegendIds.length === 0) {
      issues.push(issue("warning", "STORYBOARD_PANEL_ARROW_WEAK", panelTarget, "panel 建议绑定 actionArrowLegendIds 或 annotationLegendIds，避免标注含义不清。"));
    }
    for (const legendId of panelLegendIds) {
      if (!knownLegendIds.has(legendId)) {
        issues.push(issue("blocking", "STORYBOARD_PANEL_UNKNOWN_LEGEND", panelTarget, `panel 使用未知 legend：${legendId}`));
      }
    }
    if (panel?.assetRefs !== undefined && !Array.isArray(panel.assetRefs)) {
      issues.push(issue("blocking", "STORYBOARD_PANEL_ASSET_REFS_INVALID", panelTarget, "panel.assetRefs 必须是数组。"));
    }
    if (panel?.continuityIn !== undefined && !isNonEmptyString(panel.continuityIn)) {
      issues.push(issue("warning", "STORYBOARD_PANEL_CONTINUITY_IN_WEAK", panelTarget, "panel.continuityIn 为空，建议补齐单格连续性入口。"));
    }
    if (panel?.continuityOut !== undefined && !isNonEmptyString(panel.continuityOut)) {
      issues.push(issue("warning", "STORYBOARD_PANEL_CONTINUITY_OUT_WEAK", panelTarget, "panel.continuityOut 为空，建议补齐单格连续性出口。"));
    }
    if (panel?.departmentRefIds !== undefined && !Array.isArray(panel.departmentRefIds)) {
      issues.push(issue("blocking", "STORYBOARD_PANEL_DEPARTMENT_REFS_INVALID", panelTarget, "panel.departmentRefIds 必须是数组。"));
    }
    for (const refId of normalizeArray<string>(panel?.departmentRefIds)) {
      if (boardDepartmentRefIds.size === 0 || !boardDepartmentRefIds.has(refId)) {
        issues.push(issue("blocking", "STORYBOARD_PANEL_UNKNOWN_DEPARTMENT_REF", `${panelTarget}.departmentRefIds`, `panel 引用了 board 未声明的部门 prep ref：${refId}`));
      }
    }
  }
  const panelActions = normalizeArray<StoryboardBoardPanel>(board?.panels)
    .map((panel) => [panel?.visualBeat, panel?.subjectAction]
      .filter((value) => isNonEmptyString(value))
      .join("|")
      .replace(/[\s，。；;,.!?！？]/gu, "")
      .trim())
    .filter(Boolean);
  const uniquePanelActions = new Set(panelActions);
  if (panelActions.length >= 3 && uniquePanelActions.size === 1) {
    issues.push(issue(
      "blocking",
      "STORYBOARD_PANEL_SEQUENCE_REPEATED",
      target,
      "整张故事板的 panel 使用了同一可见动作，必须拆出首帧、起势、核心变化、反应/结果和尾帧，不能机械复制同一句描述。",
    ));
  } else if (panelActions.length >= 4 && uniquePanelActions.size / panelActions.length < 0.5) {
    issues.push(issue(
      "warning",
      "STORYBOARD_PANEL_SEQUENCE_LOW_VARIETY",
      target,
      `整张故事板仅有 ${uniquePanelActions.size}/${panelActions.length} 个不同可见动作，建议复核动作递进与镜头节奏。`,
    ));
  }
  if (!isNonEmptyString(board?.startState) || !isNonEmptyString(board?.endState)) {
    issues.push(issue("blocking", "STORYBOARD_BOARD_STATE_MISSING", target, "StoryboardBoard 必须记录 startState 和 endState。"));
  }
  return issues;
};

export const validateAssetReferencePack = (pack: AssetReferencePack): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const target = nowIssueTarget("assetReferencePack", pack?.id);
  const modelProfile = pack?.modelProfileId ? getVideoModelProfileById(pack.modelProfileId) : undefined;
  if (!isNonEmptyString(pack?.id)) issues.push(issue("blocking", "ASSET_REFERENCE_PACK_ID_MISSING", target, "AssetReferencePack 缺少 id。"));
  if (!isNonEmptyString(pack?.sceneVisualPackId)) {
    issues.push(issue("warning", "ASSET_REFERENCE_PACK_SCENE_VISUAL_PACK_MISSING", target, "AssetReferencePack 建议绑定 sceneVisualPackId，避免从全项目资产池抓取参考资产。"));
  }
  if (!isNonEmptyString(pack?.modelInputFingerprint)) {
    issues.push(issue("warning", "ASSET_REFERENCE_PACK_MODEL_INPUT_FINGERPRINT_MISSING", target, "AssetReferencePack 建议记录 modelInputFingerprint，区分场景视觉事实和模型输入限制。"));
  }
  if (!modelProfile) issues.push(issue("blocking", "ASSET_REFERENCE_PACK_MODEL_UNKNOWN", target, `未知视频模型 profile：${pack?.modelProfileId || "(empty)"}`));
  if (!Array.isArray(pack?.items) || pack.items.length === 0) {
    issues.push(issue("blocking", "ASSET_REFERENCE_PACK_EMPTY", target, "AssetReferencePack 必须包含 items。"));
  }
  if (!isNonEmptyString(pack?.packagingNotes)) issues.push(issue("blocking", "ASSET_REFERENCE_PACK_NOTES_MISSING", target, "AssetReferencePack 必须说明如何避免提示词污染。"));
  issues.push(...validateDepartmentPrepRefs(pack?.cameraRefs, "cinematography", target, "cameraRefs"));
  issues.push(...validateDepartmentPrepRefs(pack?.lightingRefs, "lighting", target, "lightingRefs"));
  issues.push(...validateDepartmentPrepRefs(pack?.performanceRefs, "performance_directing", target, "performanceRefs"));
  issues.push(...validateDepartmentPrepRefs(pack?.actionRefs, "action_choreography", target, "actionRefs"));
  const imageRefCount = normalizeArray<AssetReferencePackItem>(pack?.items).filter((item) => item.referenceImageUrl || item.referenceAssetId).length;
  if (modelProfile && !modelProfile.supportsReferenceImages && imageRefCount > 0) {
    issues.push(issue("blocking", "ASSET_REFERENCE_IMAGES_UNSUPPORTED", target, "所选模型 profile 不支持参考图，但 AssetReferencePack 包含参考图。"));
  }
  if (modelProfile && typeof modelProfile.maxReferenceImages === "number" && imageRefCount > modelProfile.maxReferenceImages) {
    issues.push(issue("blocking", "ASSET_REFERENCE_IMAGES_EXCEED_MODEL_MAX", target, `参考图数量 ${imageRefCount} 超过模型 profile 上限 ${modelProfile.maxReferenceImages}。`));
  }
  for (const item of normalizeArray<AssetReferencePackItem>(pack?.items)) {
    const itemTarget = `${target}.items.${item?.assetId || "unknown"}`;
    if (!isNonEmptyString(item?.assetId)) issues.push(issue("blocking", "ASSET_REFERENCE_ITEM_ID_MISSING", itemTarget, "参考资产 item 缺少 assetId。"));
    if (!isNonEmptyString(item?.roleInUnit)) issues.push(issue("blocking", "ASSET_REFERENCE_ITEM_ROLE_MISSING", itemTarget, "参考资产 item 必须说明 roleInUnit。"));
    if (item?.required && !item.referenceImageUrl && !item.referenceAssetId) {
      issues.push(issue("warning", "ASSET_REFERENCE_REQUIRED_WITHOUT_IMAGE", itemTarget, "required 参考资产尚未绑定 referenceImageUrl/referenceAssetId。"));
    }
  }
  return issues;
};

export const validateSceneVisualPack = (
  pack: SceneVisualPack,
  relatedPacks: SceneVisualPack[] = [],
  project?: Pick<Project, "characters" | "assets">,
): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const target = nowIssueTarget("sceneVisualPack", pack?.id);
  if (!isNonEmptyString(pack?.id)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_ID_MISSING", target, "SceneVisualPack 缺少 id。"));
  if (!isNonEmptyString(pack?.projectId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_PROJECT_MISSING", target, "SceneVisualPack 缺少 projectId。"));
  if (!isNonEmptyString(pack?.episodeId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_EPISODE_MISSING", target, "SceneVisualPack 缺少 episodeId。"));
  if (!Array.isArray(pack?.sourceSceneIds) || pack.sourceSceneIds.length === 0) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_SOURCE_SCENE_MISSING", target, "SceneVisualPack 必须记录 sourceSceneIds。"));
  }
  if (!Array.isArray(pack?.linkedSceneIds) || pack.linkedSceneIds.length === 0) {
    issues.push(issue("warning", "SCENE_VISUAL_PACK_LINKED_SCENES_EMPTY", target, "SceneVisualPack 建议记录 linkedSceneIds，用于多场复用审计。"));
  }
  if (!isNonEmptyString(pack?.baseAssetBoardPlanId)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_BASE_BOARD_MISSING", target, "SceneVisualPack 必须绑定 baseAssetBoardPlanId，不能脱离项目级基础资产板。"));
  }
  if (!isNonEmptyString(pack?.visualFingerprint)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_FINGERPRINT_MISSING", target, "SceneVisualPack 必须记录 visualFingerprint。"));
  }
  if (!isNonEmptyString(pack?.location?.assetId)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_LOCATION_MISSING", `${target}.location`, "SceneVisualPack 必须绑定当前场 location.assetId。"));
  }
  if (!isNonEmptyString(pack?.location?.setDressingState)) {
    issues.push(issue("warning", "SCENE_VISUAL_PACK_SET_DRESSING_WEAK", `${target}.location`, "SceneVisualPack 建议说明 setDressingState，避免场景布置不清。"));
  }
  if (!Array.isArray(pack?.characters)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_CHARACTERS_INVALID", `${target}.characters`, "SceneVisualPack characters 必须是数组。"));
  } else {
    const characterKeys = new Set<string>();
    for (const character of pack.characters) {
      const key = `${character?.characterId || ""}:${character?.variantId || ""}`;
      const itemTarget = `${target}.characters.${character?.characterId || "unknown"}`;
      if (!isNonEmptyString(character?.characterId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_CHARACTER_ID_MISSING", itemTarget, "角色视觉状态缺少 characterId。"));
      if (characterKeys.has(key)) issues.push(issue("warning", "SCENE_VISUAL_PACK_CHARACTER_DUPLICATE", itemTarget, `角色视觉状态重复：${key}`));
      characterKeys.add(key);
    }
  }
  if (!Array.isArray(pack?.props)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_PROPS_INVALID", `${target}.props`, "SceneVisualPack props 必须是数组。"));
  } else {
    const propKeys = new Set<string>();
    for (const prop of pack.props) {
      const key = `${prop?.assetId || ""}:${prop?.variantId || ""}`;
      const itemTarget = `${target}.props.${prop?.assetId || "unknown"}`;
      if (!isNonEmptyString(prop?.assetId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_PROP_ID_MISSING", itemTarget, "道具视觉状态缺少 assetId。"));
      if (propKeys.has(key)) issues.push(issue("warning", "SCENE_VISUAL_PACK_PROP_DUPLICATE", itemTarget, `道具视觉状态重复：${key}`));
      propKeys.add(key);
    }
  }
  if (!Array.isArray(pack?.referenceSlots) || pack.referenceSlots.length === 0) {
    issues.push(issue("warning", "SCENE_VISUAL_PACK_REFERENCE_SLOTS_EMPTY", `${target}.referenceSlots`, "SceneVisualPack 建议包含 referenceSlots，供故事板和模型输入投影。"));
  } else {
    const slotIds = new Set<string>();
    for (const slot of pack.referenceSlots) {
      const slotTarget = `${target}.referenceSlots.${slot?.slotId || "unknown"}`;
      if (!isNonEmptyString(slot?.slotId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_SLOT_ID_MISSING", slotTarget, "referenceSlot 缺少 slotId。"));
      if (slotIds.has(slot.slotId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_SLOT_DUPLICATE", slotTarget, `referenceSlot id 重复：${slot.slotId}`));
      slotIds.add(slot.slotId);
      if (!isNonEmptyString(slot?.assetId)) issues.push(issue("blocking", "SCENE_VISUAL_PACK_SLOT_ASSET_MISSING", slotTarget, "referenceSlot 缺少 assetId。"));
      if (!isPositiveNumber(slot?.priority)) issues.push(issue("warning", "SCENE_VISUAL_PACK_SLOT_PRIORITY_INVALID", slotTarget, "referenceSlot priority 建议使用正数，便于模型按参考图优先级排序。"));
    }
  }
  if (!isNonEmptyString(pack?.continuityIn) || !isNonEmptyString(pack?.continuityOut)) {
    issues.push(issue("blocking", "SCENE_VISUAL_PACK_CONTINUITY_MISSING", target, "SceneVisualPack 必须记录 continuityIn 和 continuityOut。"));
  }
  if (!Array.isArray(pack?.qaChecklist) || pack.qaChecklist.length === 0) {
    issues.push(issue("warning", "SCENE_VISUAL_PACK_QA_CHECKLIST_MISSING", target, "SceneVisualPack 建议携带 qaChecklist，便于片场视觉包验收。"));
  }

  if (project) {
    const characterById = new Map((project.characters || []).map((character) => [character.id, character]));
    const locationById = new Map((project.assets || []).filter((asset) => asset.type === "location").map((asset) => [asset.id, asset]));
    const propById = new Map((project.assets || []).filter((asset) => asset.type === "prop").map((asset) => [asset.id, asset]));
    const assetVariantExists = (assetId: string, variantId?: string) => {
      if (!variantId) return true;
      const owner = characterById.get(assetId) || locationById.get(assetId) || propById.get(assetId);
      return Boolean(owner?.variants?.some((variant) => variant.id === variantId));
    };
    if (pack?.location?.assetId && !locationById.has(pack.location.assetId)) {
      issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_LOCATION", `${target}.location.assetId`, `SceneVisualPack 引用了不存在的地点资产：${pack.location.assetId}`));
    }
    if (pack?.location?.assetId && !assetVariantExists(pack.location.assetId, pack.location.variantId)) {
      issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_LOCATION_VARIANT", `${target}.location.variantId`, `SceneVisualPack 地点引用了不存在的 variant：${pack.location.variantId}`));
    }
    for (const character of normalizeArray<SceneVisualPackCharacter>(pack?.characters)) {
      if (character.characterId && !characterById.has(character.characterId)) {
        issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_CHARACTER", `${target}.characters.${character.characterId}`, `SceneVisualPack 引用了不存在的角色：${character.characterId}`));
      }
      if (character.characterId && !assetVariantExists(character.characterId, character.variantId)) {
        issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_CHARACTER_VARIANT", `${target}.characters.${character.characterId}.variantId`, `SceneVisualPack 角色引用了不存在的 variant：${character.variantId}`));
      }
    }
    for (const prop of normalizeArray<SceneVisualPackProp>(pack?.props)) {
      if (prop.assetId && !propById.has(prop.assetId)) {
        issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_PROP", `${target}.props.${prop.assetId}`, `SceneVisualPack 引用了不存在的道具：${prop.assetId}`));
      }
      if (prop.assetId && !assetVariantExists(prop.assetId, prop.variantId)) {
        issues.push(issue("blocking", "SCENE_VISUAL_PACK_UNKNOWN_PROP_VARIANT", `${target}.props.${prop.assetId}.variantId`, `SceneVisualPack 道具引用了不存在的 variant：${prop.variantId}`));
      }
    }
  }

  const relatedById = new Map(relatedPacks.filter((item) => item?.id && item.id !== pack?.id).map((item) => [item.id, item]));
  if (pack?.reuseOfPackId) {
    const source = relatedById.get(pack.reuseOfPackId);
    if (source && source.visualFingerprint !== pack.visualFingerprint) {
      issues.push(issue("blocking", "SCENE_VISUAL_PACK_REUSE_FINGERPRINT_MISMATCH", target, `reuseOfPackId 指向的 pack 指纹不同：${pack.reuseOfPackId}`));
    }
  }
  for (const related of relatedPacks) {
    if (!related?.id || related.id === pack?.id) continue;
    if (related.visualFingerprint === pack?.visualFingerprint && pack?.reuseOfPackId !== related.id && related.reuseOfPackId !== pack?.id) {
      issues.push(issue("warning", "SCENE_VISUAL_PACK_DUPLICATE_FINGERPRINT", target, `发现相同 visualFingerprint 的场景视觉包 ${related.id}，应复用而不是重复创建。`));
    }
  }
  return issues;
};

export const validateVideoGenerationUnit = (
  unit: VideoGenerationUnit,
  pack?: AssetReferencePack,
): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const target = nowIssueTarget("videoGenerationUnit", unit?.id);
  const modelProfile = unit?.modelProfileId ? getVideoModelProfileById(unit.modelProfileId) : undefined;
  if (!isNonEmptyString(unit?.id)) issues.push(issue("blocking", "VIDEO_UNIT_ID_MISSING", target, "VideoGenerationUnit 缺少 id。"));
  if (!isNonEmptyString(unit?.episodeId)) issues.push(issue("blocking", "VIDEO_UNIT_EPISODE_MISSING", target, "VideoGenerationUnit 缺少 episodeId。"));
  if (!isNonEmptyString(unit?.sceneId)) issues.push(issue("blocking", "VIDEO_UNIT_SCENE_MISSING", target, "VideoGenerationUnit 缺少 sceneId。"));
  if (!modelProfile) issues.push(issue("blocking", "VIDEO_UNIT_MODEL_UNKNOWN", target, `未知视频模型 profile：${unit?.modelProfileId || "(empty)"}`));
  if (!isPositiveNumber(unit?.durationSeconds)) {
    issues.push(issue("blocking", "VIDEO_UNIT_DURATION_INVALID", target, "VideoGenerationUnit durationSeconds 必须是正数。"));
  } else if (modelProfile) {
    if (typeof modelProfile.minDurationSeconds === "number" && unit.durationSeconds < modelProfile.minDurationSeconds) {
      issues.push(issue("blocking", "VIDEO_UNIT_DURATION_BELOW_MODEL_MIN", target, `VideoGenerationUnit 时长 ${unit.durationSeconds}s 低于模型最小时长 ${modelProfile.minDurationSeconds}s。`));
    }
    if (typeof modelProfile.maxDurationSeconds === "number" && unit.durationSeconds > modelProfile.maxDurationSeconds) {
      issues.push(issue("blocking", "VIDEO_UNIT_DURATION_EXCEEDS_MODEL_MAX", target, `VideoGenerationUnit 时长 ${unit.durationSeconds}s 超过模型最大时长 ${modelProfile.maxDurationSeconds}s。`));
    }
  }
  if (!Array.isArray(unit?.performanceBeatIds) || unit.performanceBeatIds.length === 0) {
    issues.push(issue("blocking", "VIDEO_UNIT_BEATS_MISSING", target, "VideoGenerationUnit 必须绑定 performanceBeatIds。"));
  }
  if (!isNonEmptyString(unit?.storyboardBoardId)) issues.push(issue("blocking", "VIDEO_UNIT_BOARD_MISSING", target, "VideoGenerationUnit 缺少 storyboardBoardId。"));
  if (!isNonEmptyString(unit?.assetReferencePackId)) issues.push(issue("blocking", "VIDEO_UNIT_PACK_MISSING", target, "VideoGenerationUnit 缺少 assetReferencePackId。"));
  if (!isNonEmptyString(unit?.startState) || !isNonEmptyString(unit?.endState)) {
    issues.push(issue("blocking", "VIDEO_UNIT_STATE_MISSING", target, "VideoGenerationUnit 必须记录 startState 和 endState。"));
  }
  if (!isNonEmptyString(unit?.videoPrompt)) issues.push(issue("blocking", "VIDEO_UNIT_PROMPT_MISSING", target, "VideoGenerationUnit 缺少 videoPrompt。"));
  if (pack && pack.id !== unit.assetReferencePackId) {
    issues.push(issue("blocking", "VIDEO_UNIT_PACK_ID_MISMATCH", target, "VideoGenerationUnit 绑定的 assetReferencePackId 与传入 pack 不一致。"));
  }
  if (pack && pack.modelProfileId !== unit.modelProfileId) {
    issues.push(issue("blocking", "VIDEO_UNIT_PACK_MODEL_MISMATCH", target, "VideoGenerationUnit 与 AssetReferencePack 的 modelProfileId 不一致。"));
  }
  issues.push(...validateDepartmentPrepRefs(unit?.cameraRefs, "cinematography", target, "cameraRefs"));
  issues.push(...validateDepartmentPrepRefs(unit?.lightingRefs, "lighting", target, "lightingRefs"));
  issues.push(...validateDepartmentPrepRefs(unit?.performanceRefs, "performance_directing", target, "performanceRefs"));
  issues.push(...validateDepartmentPrepRefs(unit?.actionRefs, "action_choreography", target, "actionRefs"));
  if (pack?.cameraRefs?.length && !unit?.cameraRefs?.length) {
    issues.push(issue("warning", "VIDEO_UNIT_CAMERA_REFS_NOT_INHERITED", `${target}.cameraRefs`, "AssetReferencePack 已有 cameraRefs，VideoGenerationUnit 建议继承，避免生成时丢失摄影约束。"));
  }
  if (pack?.performanceRefs?.length && !unit?.performanceRefs?.length) {
    issues.push(issue("warning", "VIDEO_UNIT_PERFORMANCE_REFS_NOT_INHERITED", `${target}.performanceRefs`, "AssetReferencePack 已有 performanceRefs，VideoGenerationUnit 建议继承，避免表演节拍在生成前丢失。"));
  }
  return issues;
};

export const validateVideoStoryboardPlan = (plan: Partial<VideoStoryboardPlan>): VideoStoryboardArtifactIssue[] => {
  const issues: VideoStoryboardArtifactIssue[] = [];
  const beats = normalizeArray<PerformanceBeat>(plan.performanceBeats);
  const boards = normalizeArray<StoryboardBoard>(plan.storyboardBoards);
  const sceneVisualPacks = normalizeArray<SceneVisualPack>(plan.sceneVisualPacks);
  const packs = normalizeArray<AssetReferencePack>(plan.assetReferencePacks);
  const units = normalizeArray<VideoGenerationUnit>(plan.videoGenerationUnits);
  const beatIds = new Set(beats.map((beat) => beat.id));
  const boardIds = new Set(boards.map((board) => board.id));
  const sceneVisualPackIds = new Set(sceneVisualPacks.map((pack) => pack.id));
  const packIds = new Set(packs.map((pack) => pack.id));

  issues.push(...validatePerformanceBeats(beats));
  for (const sceneVisualPack of sceneVisualPacks) issues.push(...validateSceneVisualPack(sceneVisualPack, sceneVisualPacks));
  for (const board of boards) issues.push(...validateStoryboardBoard(board));
  for (const pack of packs) {
    issues.push(...validateAssetReferencePack(pack));
    if (pack.sceneVisualPackId && !sceneVisualPackIds.has(pack.sceneVisualPackId)) {
      issues.push(issue("blocking", "ASSET_REFERENCE_PACK_UNKNOWN_SCENE_VISUAL_PACK", `assetReferencePack.${pack.id}.sceneVisualPackId`, `AssetReferencePack 引用了不存在的 SceneVisualPack：${pack.sceneVisualPackId}`));
    }
  }
  for (const unit of units) {
    const pack = packs.find((item) => item.id === unit.assetReferencePackId);
    issues.push(...validateVideoGenerationUnit(unit, pack));
    for (const beatId of unit.performanceBeatIds || []) {
      if (!beatIds.has(beatId)) issues.push(issue("blocking", "VIDEO_UNIT_UNKNOWN_BEAT", `videoGenerationUnit.${unit.id}.performanceBeatIds`, `VideoGenerationUnit 引用了不存在的 performanceBeat：${beatId}`));
    }
    if (!boardIds.has(unit.storyboardBoardId)) issues.push(issue("blocking", "VIDEO_UNIT_UNKNOWN_BOARD", `videoGenerationUnit.${unit.id}.storyboardBoardId`, `VideoGenerationUnit 引用了不存在的 StoryboardBoard：${unit.storyboardBoardId}`));
    if (!packIds.has(unit.assetReferencePackId)) issues.push(issue("blocking", "VIDEO_UNIT_UNKNOWN_PACK", `videoGenerationUnit.${unit.id}.assetReferencePackId`, `VideoGenerationUnit 引用了不存在的 AssetReferencePack：${unit.assetReferencePackId}`));
  }
  for (const board of boards) {
    for (const beatId of board.performanceBeatIds || []) {
      if (!beatIds.has(beatId)) issues.push(issue("blocking", "STORYBOARD_BOARD_UNKNOWN_BEAT", `storyboardBoard.${board.id}.performanceBeatIds`, `StoryboardBoard 引用了不存在的 performanceBeat：${beatId}`));
    }
    if (board.assetReferencePackId && !packIds.has(board.assetReferencePackId)) {
      issues.push(issue("blocking", "STORYBOARD_BOARD_UNKNOWN_PACK", `storyboardBoard.${board.id}.assetReferencePackId`, `StoryboardBoard 引用了不存在的 AssetReferencePack：${board.assetReferencePackId}`));
    }
  }
  return issues;
};

export const buildVideoStoryboardArtifactSystem = () => ({
  status: "artifact_contracts_available_operator_artifact_only",
  nonDisruptivePolicy: "These contracts are stored as Operator artifacts first. They do not replace scene.shots, imagePrompt, videoPrompt, or canonical workflow stages.",
  artifactKinds: VIDEO_STORYBOARD_ARTIFACT_CONTRACTS.map((contract) => contract.kind),
  contracts: VIDEO_STORYBOARD_ARTIFACT_CONTRACTS,
  planContract: {
    kind: "custom",
    recommendedTargetPath: "videoStoryboardPlan",
    qaFunction: "validateVideoStoryboardPlan",
    contains: ["performanceBeats", "storyboardBoards", "sceneVisualPacks", "assetReferencePacks", "videoGenerationUnits"],
  },
  operatorQaApi: {
    artifactRoute: "POST /api/operator/artifacts/:artifactId/qa",
    autoQaBody: { auto: true },
    supportedKinds: ["performance_beats", "storyboard_board", "scene_visual_pack", "asset_reference_pack", "video_generation_unit", "custom videoStoryboardPlan"],
    behavior: [
      "When auto=true or qaAgentId is omitted, the backend runs the matching video storyboard artifact validator.",
      "Manual QA verdicts are still accepted when qaAgentId is supplied.",
      "The QA route approves or rejects the Operator artifact only; it does not commit these artifact-only contracts into project core data.",
    ],
  },
  strictQa: {
    artifactQaFunctions: [
      "validatePerformanceBeats",
      "validateStoryboardBoard",
      "validateSceneVisualPack",
      "validateAssetReferencePack",
      "validateVideoGenerationUnit",
      "validateVideoStoryboardPlan",
    ],
    blockingRules: [
      "performance beats must expose visible change, duration, and continuity in/out",
      "storyboard boards must carry strategy decision, panels, line-art prompt, and arrow legend",
      "scene visual packs must carry current-scene visual state, reusable fingerprint, references, and continuity in/out",
      "asset reference packs must respect selected model reference limits",
      "video generation units must respect selected model duration and be ready for direct generation",
      "cross references between beats, boards, packs, and units must resolve within the artifact bundle",
    ],
  },
});
