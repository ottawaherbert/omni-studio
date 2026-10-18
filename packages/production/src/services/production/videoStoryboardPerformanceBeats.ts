import type { Episode, Project, Scene, ScriptBlock } from "../../../../../src/types/project";
import {
  PerformanceBeat,
  VideoStoryboardArtifactIssue,
  validatePerformanceBeats,
} from "./videoStoryboardArtifacts";
import { VIDEO_MODEL_PROFILES } from "./videoStoryboardSystem";

export interface ProductionPerformanceBeatDrafts {
  performanceBeats: PerformanceBeat[];
  issues: VideoStoryboardArtifactIssue[];
  beatSceneIds: string[];
}

const ACTION_PATTERN = /run|rush|chase|grab|turn|fall|jump|push|pull|throw|open|close|move|奔|跑|追|抓|转身|跌|跳|推|拉|甩|拔|冲|移动/iu;
const COMBAT_PATTERN = /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|法术|仙术/iu;
const EMOTION_PATTERN = /tear|cry|smile|hesitate|tremble|breath|gaze|silence|心碎|落泪|哽咽|微笑|迟疑|颤抖|呼吸|凝视|沉默|道侣|诀别/iu;
const REVEAL_PATTERN = /reveal|twist|secret|truth|cliffhanger|discover|反转|揭示|真相|秘密|悬念|钩子|发现|身份/iu;

const clean = (value: unknown) => String(value || "").trim();

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const textOf = (...values: Array<unknown>) =>
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

const selectVideoModelProfile = (project: Project) =>
  VIDEO_MODEL_PROFILES.find((profile) =>
    profile.supportsStoryboardReference &&
    (!project.aspectRatio || profile.aspectRatios.includes(project.aspectRatio)),
  ) || VIDEO_MODEL_PROFILES.find((profile) => profile.supportsStoryboardReference) || VIDEO_MODEL_PROFILES[0];

const targetVideoDuration = (project: Project) => {
  const profile = selectVideoModelProfile(project);
  const maxDuration = profile.maxDurationSeconds || 15;
  const preferred = profile.preferredDurationsSeconds
    .filter((duration) => duration <= maxDuration)
    .sort((a, b) => b - a)[0];
  return preferred || Math.min(maxDuration, 10);
};

const blockDurationSeconds = (block: ScriptBlock) => {
  if (block.type === "dialogue") return Math.max(2, Math.ceil(clean(block.content).length / 12));
  if (block.type === "action") return 4;
  if (block.type === "parenthetical") return 1;
  if (block.type === "transition") return 1;
  return 2;
};

const chunkScriptBlocks = (blocks: ScriptBlock[], targetDurationSeconds: number) => {
  const chunks: ScriptBlock[][] = [];
  let current: ScriptBlock[] = [];
  let currentDuration = 0;

  for (const block of blocks) {
    const duration = blockDurationSeconds(block);
    if (current.length > 0 && currentDuration + duration > targetDurationSeconds) {
      chunks.push(current);
      current = [];
      currentDuration = 0;
    }
    current.push(block);
    currentDuration += duration;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

const beatTypeFromBlocks = (
  scene: Scene,
  blocks: ScriptBlock[],
): PerformanceBeat["beatType"] => {
  const text = textOf(scene.title, scene.description, scene.hook, scene.cliffhanger, blocks.map((block) => `${block.type}:${block.content} ${block.acting || ""}`));
  if (COMBAT_PATTERN.test(text)) return "combat";
  if (REVEAL_PATTERN.test(text) || scene.cliffhanger) return "reveal";
  if (blocks.some((block) => block.type === "transition")) return "transition";
  if (ACTION_PATTERN.test(text) || blocks.some((block) => block.type === "action")) return "action";
  if (EMOTION_PATTERN.test(text)) return "emotion";
  if (blocks.some((block) => block.type === "dialogue")) return "dialogue";
  return "action";
};

const summaryForBlocks = (scene: Scene, blocks: ScriptBlock[]) => {
  const meaningful = blocks
    .filter((block) => block.type !== "scene_heading")
    .map((block) => clean(block.content))
    .filter(Boolean);
  return meaningful.join(" / ") || clean(scene.sceneGoal || scene.description || scene.title);
};

const stateText = (scene: Scene, blocks: ScriptBlock[], fallback: string) => {
  const block = blocks.find((item) => clean(item.content)) || blocks[0];
  return clean(block?.content || scene.description || scene.sceneGoal || scene.title || fallback);
};

const soundCuesForScene = (scene: Scene) =>
  unique([
    ...(scene.breakdown?.sfx || []),
    ...(scene.breakdown?.bgm || []).map((item) => item.description || item.prompt),
  ]);

const buildBeat = (
  episode: Episode,
  scene: Scene,
  blocks: ScriptBlock[],
  index: number,
): PerformanceBeat => {
  const id = `${episode.id}.${scene.id}.performance_beat.${index + 1}`;
  const summary = summaryForBlocks(scene, blocks);
  const startState = stateText(scene, blocks, "节拍开始");
  const endState = stateText(scene, [...blocks].reverse(), "节拍结束");
  const text = textOf(summary, blocks.map((block) => `${block.type}:${block.content} ${block.acting || ""}`));

  return {
    id,
    episodeId: episode.id,
    sceneId: scene.id,
    scriptBlockIds: blocks.map((block) => block.id).filter(Boolean),
    beatType: beatTypeFromBlocks(scene, blocks),
    summary,
    visibleChange: `${startState} -> ${endState}`,
    startState,
    endState,
    durationSeconds: blocks.reduce((sum, block) => sum + blockDurationSeconds(block), 0),
    characterIds: scene.breakdown?.characterIds || [],
    locationId: scene.breakdown?.locationId || blocks.find((block) => block.locationId)?.locationId,
    propIds: unique([
      ...(scene.breakdown?.propIds || []),
      ...blocks.flatMap((block) => block.propIds || []),
    ]),
    dialogueLineCount: blocks.filter((block) => block.type === "dialogue").length,
    actionBeatCount: blocks.filter((block) => block.type === "action").length + (ACTION_PATTERN.test(text) ? 1 : 0),
    combatBeatCount: COMBAT_PATTERN.test(text) ? 1 : 0,
    emotionalBeatCount: EMOTION_PATTERN.test(text) ? 1 : 0,
    soundCues: soundCuesForScene(scene),
    continuityIn: clean(scene.interactiveMetadata?.incomingContext || scene.valueShift?.from || startState),
    continuityOut: clean(scene.interactiveMetadata?.outgoingContext || scene.valueShift?.to || endState),
  };
};

export const buildProductionPerformanceBeatDrafts = (
  project: Project,
  episodes: Episode[],
): ProductionPerformanceBeatDrafts => {
  const targetDurationSeconds = targetVideoDuration(project);
  const performanceBeats = episodes.flatMap((episode) =>
    (episode.scenes || []).flatMap((scene) => {
      const blocks = (scene.scriptBlocks || []).filter((block) => block.id && clean(block.content));
      if (blocks.length === 0) return [];
      return chunkScriptBlocks(blocks, targetDurationSeconds).map((chunk, index) => buildBeat(episode, scene, chunk, index));
    }),
  );
  const issues = validatePerformanceBeats(performanceBeats);

  return {
    performanceBeats,
    issues,
    beatSceneIds: unique(performanceBeats.map((beat) => beat.sceneId)),
  };
};
