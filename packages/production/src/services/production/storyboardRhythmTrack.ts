import type { StoryboardBoard, StoryboardBoardPanel } from "./videoStoryboardArtifacts";
import {
  STORYBOARD_STRATEGY_CAPABILITIES,
  type StoryboardPromptStrategy,
} from "./videoStoryboardSystem";

export type StoryboardRhythmLaneId =
  | "shot"
  | "action"
  | "camera"
  | "sound"
  | "lighting"
  | "state";

export interface StoryboardRhythmCue {
  panelId: string;
  panelNumber: number;
  shotId?: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  label: string;
  annotationLegendIds: string[];
}

export interface StoryboardRhythmLane {
  id: StoryboardRhythmLaneId;
  label: string;
  cues: StoryboardRhythmCue[];
}

export interface StoryboardRhythmBeat {
  panelId: string;
  panelNumber: number;
  shotId?: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  actionCue: string;
  cameraCue: string;
  soundCue: string;
  lightingCue: string;
  stateIn: string;
  stateOut: string;
  annotationLegendIds: string[];
  emphasis: Array<"impact" | "sound" | "lighting" | "camera" | "subject">;
}

export interface StoryboardRhythmTrack {
  schemaVersion: "storyboard-rhythm-track.v1";
  boardId: string;
  videoGenerationUnitId?: string;
  totalDurationSeconds: number;
  panelCount: number;
  timingSource: "panel_duration_weights" | "even_distribution";
  beats: StoryboardRhythmBeat[];
  lanes: StoryboardRhythmLane[];
}

const RHYTHM_CAPABILITY_IDS = new Set([
  "control:rhythm_timeline",
  "control:body_rhythm",
  "control:action_choreography",
  "control:sound_rhythm",
  "temporal:dense_beats",
]);

const EPSILON = 0.001;
const PRECISION = 1000;

const clean = (value: unknown) => String(value || "").trim();
const roundTime = (value: number) => Math.round(value * PRECISION) / PRECISION;
const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map(clean).filter(Boolean)));

const panelLegendIds = (panel: StoryboardBoardPanel) => unique([
  ...(panel.annotationLegendIds || []),
  ...(panel.actionArrowLegendIds || []),
]);

const panelEmphasis = (legendIds: string[]): StoryboardRhythmBeat["emphasis"] => {
  const emphasis: StoryboardRhythmBeat["emphasis"] = [];
  if (legendIds.includes("energy_impact_orange")) emphasis.push("impact");
  if (legendIds.includes("sound_emotion_purple")) emphasis.push("sound");
  if (legendIds.includes("lighting_direction_orange")) emphasis.push("lighting");
  if (legendIds.includes("camera_motion_blue")) emphasis.push("camera");
  if (legendIds.includes("subject_action_red")) emphasis.push("subject");
  return emphasis;
};

const laneLabel = (laneId: StoryboardRhythmLaneId) => ({
  shot: "镜头轨",
  action: "动作轨",
  camera: "摄影机轨",
  sound: "声音/节拍轨",
  lighting: "灯光/光效轨",
  state: "状态变化轨",
}[laneId]);

const laneCue = (beat: StoryboardRhythmBeat, laneId: StoryboardRhythmLaneId) => {
  const labels: Record<StoryboardRhythmLaneId, string> = {
    shot: beat.shotId || `P${beat.panelNumber}`,
    action: beat.actionCue,
    camera: beat.cameraCue,
    sound: beat.soundCue,
    lighting: beat.lightingCue,
    state: `${beat.stateIn} -> ${beat.stateOut}`,
  };
  return {
    panelId: beat.panelId,
    panelNumber: beat.panelNumber,
    shotId: beat.shotId,
    startSeconds: beat.startSeconds,
    endSeconds: beat.endSeconds,
    durationSeconds: beat.durationSeconds,
    label: labels[laneId] || "未声明",
    annotationLegendIds: beat.annotationLegendIds,
  } satisfies StoryboardRhythmCue;
};

export const shouldRenderStoryboardRhythmTrack = (
  strategies: StoryboardPromptStrategy[],
  requiredCapabilityIds: string[] = [],
) => [
  ...requiredCapabilityIds,
  ...strategies.flatMap((strategy) => STORYBOARD_STRATEGY_CAPABILITIES[strategy.boardMode] || []),
].some((capabilityId) => RHYTHM_CAPABILITY_IDS.has(capabilityId));

export const buildStoryboardRhythmTrack = (
  board: StoryboardBoard,
): StoryboardRhythmTrack => {
  const expectedDuration = positive(board.strategyDecision.expectedVideoUnitDurationSeconds);
  const panelDurationSum = board.panels.reduce((sum, panel) => sum + positive(panel.durationSeconds), 0);
  const totalDurationSeconds = roundTime(expectedDuration || panelDurationSum);
  const hasCompletePanelDurations = board.panels.length > 0 && board.panels.every((panel) => positive(panel.durationSeconds) > 0);
  const weights = board.panels.map((panel) => hasCompletePanelDurations ? positive(panel.durationSeconds) : 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  const beats = board.panels.map((panel, index) => {
    const remaining = Math.max(0, totalDurationSeconds - cursor);
    const durationSeconds = index === board.panels.length - 1
      ? roundTime(remaining)
      : roundTime(totalWeight > 0 ? totalDurationSeconds * weights[index] / totalWeight : 0);
    const startSeconds = roundTime(cursor);
    const endSeconds = roundTime(Math.min(totalDurationSeconds, startSeconds + durationSeconds));
    cursor = endSeconds;
    const annotationLegendIds = panelLegendIds(panel);
    return {
      panelId: panel.id,
      panelNumber: panel.panelNumber,
      shotId: panel.shotId,
      startSeconds,
      endSeconds,
      durationSeconds: roundTime(endSeconds - startSeconds),
      actionCue: clean(panel.subjectAction || panel.visualBeat || panel.bodyMotion) || "保持主体动作连续",
      cameraCue: clean(panel.cameraMove || panel.cameraNote) || "保持轴线和运动方向连续",
      soundCue: clean(panel.soundCue || panel.dialogueOrSoundCue) || "无新增声音提示",
      lightingCue: clean(panel.lightingCue) || "继承上一格灯光状态",
      stateIn: clean(panel.continuityIn) || (index === 0
        ? clean(board.startState)
        : clean(board.panels[index - 1]?.continuityOut) || "承接上一格"),
      stateOut: clean(panel.continuityOut) || (index === board.panels.length - 1 ? clean(board.endState) : "进入下一格"),
      annotationLegendIds,
      emphasis: panelEmphasis(annotationLegendIds),
    } satisfies StoryboardRhythmBeat;
  });

  const laneIds: StoryboardRhythmLaneId[] = ["shot", "action", "camera", "sound", "lighting", "state"];
  return {
    schemaVersion: "storyboard-rhythm-track.v1",
    boardId: board.id,
    videoGenerationUnitId: board.videoGenerationUnitId,
    totalDurationSeconds,
    panelCount: board.panels.length,
    timingSource: hasCompletePanelDurations ? "panel_duration_weights" : "even_distribution",
    beats,
    lanes: laneIds.map((id) => ({
      id,
      label: laneLabel(id),
      cues: beats.map((beat) => laneCue(beat, id)),
    })),
  };
};

export const validateStoryboardRhythmTrack = (
  track: StoryboardRhythmTrack,
  board?: StoryboardBoard,
) => {
  const issues: string[] = [];
  const expectedLaneIds: StoryboardRhythmLaneId[] = ["shot", "action", "camera", "sound", "lighting", "state"];
  if (track.schemaVersion !== "storyboard-rhythm-track.v1") issues.push("schemaVersion must be storyboard-rhythm-track.v1.");
  if (!clean(track.boardId)) issues.push("boardId is required.");
  if (!(track.totalDurationSeconds > 0)) issues.push("totalDurationSeconds must be positive.");
  if (track.panelCount !== track.beats.length) issues.push("panelCount must match beats.length.");
  if (track.lanes.length !== 6) issues.push("rhythm track must include six production lanes.");
  if (expectedLaneIds.some((laneId) => !track.lanes.some((lane) => lane.id === laneId))) {
    issues.push("rhythm track must include shot, action, camera, sound, lighting, and state lanes.");
  }

  const panelIds = new Set<string>();
  const panelNumbers = new Set<number>();
  let cursor = 0;
  for (const beat of track.beats) {
    if (!clean(beat.panelId)) issues.push("every rhythm beat must reference a panelId.");
    if (panelIds.has(beat.panelId)) issues.push(`panelId must be unique in rhythm track: ${beat.panelId}.`);
    panelIds.add(beat.panelId);
    if (!Number.isInteger(beat.panelNumber) || beat.panelNumber <= 0) issues.push(`rhythm beat ${beat.panelId} has an invalid panelNumber.`);
    if (panelNumbers.has(beat.panelNumber)) issues.push(`panelNumber must be unique in rhythm track: ${beat.panelNumber}.`);
    panelNumbers.add(beat.panelNumber);
    if (Math.abs(beat.startSeconds - cursor) > EPSILON) issues.push(`rhythm beat ${beat.panelId} is not contiguous.`);
    if (!(beat.endSeconds > beat.startSeconds)) issues.push(`rhythm beat ${beat.panelId} must have positive duration.`);
    if (!clean(beat.actionCue) || !clean(beat.cameraCue) || !clean(beat.stateIn) || !clean(beat.stateOut)) {
      issues.push(`rhythm beat ${beat.panelId} is missing action, camera, or state continuity cues.`);
    }
    if (Math.abs((beat.endSeconds - beat.startSeconds) - beat.durationSeconds) > EPSILON) {
      issues.push(`rhythm beat ${beat.panelId} duration does not match its time range.`);
    }
    cursor = beat.endSeconds;
  }
  if (track.beats.length > 0 && Math.abs(cursor - track.totalDurationSeconds) > EPSILON) {
    issues.push("rhythm beats must close exactly at totalDurationSeconds.");
  }
  for (const lane of track.lanes) {
    if (lane.cues.length !== track.beats.length) issues.push(`${lane.id} lane must represent every rhythm beat.`);
    if (lane.cues.some((cue, index) => cue.panelId !== track.beats[index]?.panelId)) {
      issues.push(`${lane.id} lane cue order must match rhythm beats.`);
    }
  }
  if (board) {
    const boardPanelIds = board.panels.map((panel) => panel.id);
    const expectedDuration = positive(board.strategyDecision.expectedVideoUnitDurationSeconds);
    if (track.boardId !== board.id) issues.push("rhythm track boardId does not match source board.");
    if (expectedDuration > 0 && Math.abs(track.totalDurationSeconds - expectedDuration) > EPSILON) {
      issues.push("rhythm track total duration does not match the source video-unit duration.");
    }
    if (boardPanelIds.length !== track.beats.length || boardPanelIds.some((panelId) => !panelIds.has(panelId))) {
      issues.push("rhythm track must represent every source board panel exactly once.");
    }
    if (board.panels.some((panel, index) => (
      track.beats[index]?.panelId !== panel.id || track.beats[index]?.panelNumber !== panel.panelNumber
    ))) {
      issues.push("rhythm beat order and panel numbers must match the source composite board.");
    }
  }
  return issues;
};

const formatSeconds = (value: number) => `${Number(value.toFixed(3))}s`;

export const renderStoryboardRhythmTrack = (track: StoryboardRhythmTrack) => [
  `总时长：${formatSeconds(track.totalDurationSeconds)}；画格数：${track.panelCount}`,
  ...track.lanes.map((lane) => `${lane.label}: ${lane.cues.map((cue) => [
    `P${String(cue.panelNumber).padStart(2, "0")}`,
    `${formatSeconds(cue.startSeconds)}-${formatSeconds(cue.endSeconds)}`,
    cue.label,
  ].join(" ")).join(" | ")}`),
].join("\n");

export const buildStoryboardRhythmTrackSystem = () => ({
  schemaVersion: "storyboard-rhythm-track-system.v1",
  status: "available",
  builderFunction: "buildStoryboardRhythmTrack",
  validationFunction: "validateStoryboardRhythmTrack",
  activationPolicy: {
    source: "selected strategy recipe capabilities",
    capabilityIds: Array.from(RHYTHM_CAPABILITY_IDS),
    forbiddenShortcut: "Do not infer rhythm-track activation from genre names or prose keywords.",
  },
  lanes: ["shot", "action", "camera", "sound", "lighting", "state"],
  timingPolicy: [
    "Preserve explicit panel durations as relative weights when all panels provide positive durations.",
    "Otherwise distribute the video-unit duration evenly; never invent genre-specific timings.",
    "The final beat must close exactly at the declared video-unit duration.",
  ],
});
