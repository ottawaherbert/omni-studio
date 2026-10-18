import type {
  ManualStoryboardBoard,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardUnitVideoPrompt,
  Shot,
} from "../../types/project";
import { manualStoryboardHash } from "./manualStoryboard";

const compact = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

const orderedUnitShots = (workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board">, shots: Shot[]) => {
  const ids = workflow.shotIds?.length
    ? workflow.shotIds
    : workflow.board?.shotIds?.length
      ? workflow.board.shotIds
      : [workflow.shotId];
  return ids
    .map((id) => shots.find((shot) => shot.id === id))
    .filter((shot): shot is Shot => Boolean(shot));
};

const unitPromptShotValue = (shot: Shot, board?: ManualStoryboardBoard) => {
  const panels = (board?.panels || []).filter((panel) => panel.shotId === shot.id);
  return {
    id: shot.id,
    durationSeconds: Number(shot.duration || 0),
    videoPrompt: compact(shot.videoPrompt),
    visualAction: compact(shot.visualAction),
    microExpression: compact(shot.microExpression),
    camera: [shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength]
      .map(compact)
      .filter(Boolean),
    blocking: compact(shot.blocking),
    continuityNote: compact(shot.continuityNote),
    lightingAtmo: compact(shot.lightingAtmo),
    dialogue: (shot.dialogueLines || []).map((line) => ({
      speaker: compact(line.speakerName || line.characterId),
      text: compact(line.text),
    })),
    panelTimeline: panels.map((panel) => ({
      durationSeconds: Number(panel.durationSeconds || 0),
      visualBeat: compact(panel.visualBeat),
      subjectAction: compact(panel.subjectAction),
      cameraNote: compact(panel.cameraNote),
      soundCue: compact(panel.soundCue || panel.dialogueOrSoundCue),
      continuityIn: compact(panel.continuityIn),
      continuityOut: compact(panel.continuityOut),
    })),
  };
};

export const buildStoryboardUnitVideoPromptSourceHash = ({
  workflow,
  shots,
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board">;
  shots: Shot[];
}) => manualStoryboardHash({
  startState: compact(workflow.board?.startState),
  endState: compact(workflow.board?.endState),
  shots: orderedUnitShots(workflow, shots).map((shot) => unitPromptShotValue(shot, workflow.board)),
});

export const buildStoryboardUnitVideoPromptText = ({
  workflow,
  shots,
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board">;
  shots: Shot[];
}) => {
  const unitShots = orderedUnitShots(workflow, shots);
  let cursor = 0;
  const shotBlocks = unitShots.map((shot, index) => {
    const panels = (workflow.board?.panels || []).filter((panel) => panel.shotId === shot.id);
    const duration = Math.max(0, Number(shot.duration || 0));
    const start = cursor;
    cursor += duration;
    const action = compact(shot.videoPrompt);
    const camera = [shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength]
      .map(compact)
      .filter(Boolean)
      .join("，");
    const performance = [shot.blocking, shot.microExpression].map(compact).filter(Boolean).join("；");
    const lighting = compact(shot.lightingAtmo);
    const dialogue = (shot.dialogueLines || [])
      .map((line) => `${compact(line.speakerName || line.characterId || "对白")}：${compact(line.text)}`)
      .filter((line) => !line.endsWith("："))
      .join("；");
    const sound = Array.from(new Set(panels.flatMap((panel) => [panel.soundCue, panel.dialogueOrSoundCue]).map(compact).filter(Boolean))).join("；");
    const continuity = [
      panels[0]?.continuityIn || (index === 0 ? workflow.board?.startState : undefined),
      panels[panels.length - 1]?.continuityOut || (index === unitShots.length - 1 ? workflow.board?.endState : shot.continuityNote),
    ].map(compact).filter(Boolean).join(" -> ");
    return [
      `【镜头 ${index + 1}｜${start.toFixed(1)}-${cursor.toFixed(1)}s】`,
      `画面与动作：${action}`,
      camera ? `摄影机：${camera}` : "",
      lighting ? `光影氛围：${lighting}` : "",
      performance ? `表演与调度：${performance}` : "",
      dialogue ? `对白：${dialogue}` : "",
      sound ? `声音：${sound}` : "",
      continuity ? `连续性：${continuity}` : "",
    ].filter(Boolean).join("\n");
  });
  return [
    `视频单元时长约 ${cursor.toFixed(1)} 秒，按以下镜头顺序连续执行。`,
    workflow.board?.startState ? `起始状态：${compact(workflow.board.startState)}` : "",
    ...shotBlocks,
    workflow.board?.endState ? `结束状态：${compact(workflow.board.endState)}` : "",
  ].filter(Boolean).join("\n\n");
};

export const buildStoryboardUnitVideoPromptRecord = ({
  workflow,
  shots,
  previous,
  now = Date.now(),
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board">;
  shots: Shot[];
  previous?: ManualStoryboardUnitVideoPrompt;
  now?: number;
}): ManualStoryboardUnitVideoPrompt => {
  const sourceHash = buildStoryboardUnitVideoPromptSourceHash({ workflow, shots });
  const hasFormalVideoPrompts = orderedUnitShots(workflow, shots).every((shot) => compact(shot.videoPrompt));
  if (!hasFormalVideoPrompts) {
    return {
      text: "",
      sourceHash,
      source: "derived",
      status: "stale",
      updatedAt: now,
    };
  }
  if (previous?.sourceHash === sourceHash && compact(previous.text)) {
    return { ...previous, status: "ready" };
  }
  return {
    text: buildStoryboardUnitVideoPromptText({ workflow, shots }),
    sourceHash,
    source: "derived",
    status: "ready",
    updatedAt: now,
  };
};

export const resolveStoryboardUnitVideoPrompt = ({
  workflow,
  shots,
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board" | "unitVideoPrompt">;
  shots: Shot[];
}) => {
  const sourceHash = buildStoryboardUnitVideoPromptSourceHash({ workflow, shots });
  const stored = workflow.unitVideoPrompt;
  const hasFormalVideoPrompts = orderedUnitShots(workflow, shots).every((shot) => compact(shot.videoPrompt));
  const status = !hasFormalVideoPrompts
    ? "missing" as const
    : stored?.sourceHash === sourceHash
    ? "ready" as const
    : stored
      ? "stale" as const
      : "missing" as const;
  const rebuiltText = buildStoryboardUnitVideoPromptText({ workflow, shots });
  const text = status === "ready" && compact(stored?.text)
    ? stored!.text.trim()
    : rebuiltText;
  return {
    text,
    sourceHash,
    status,
    promptHash: manualStoryboardHash({ text }),
    storedText: compact(stored?.text) ? stored!.text.trim() : undefined,
  };
};

export const buildShotUpstreamPromptHash = (shot: Pick<Shot, "id" | "videoPrompt" | "appearance">) => manualStoryboardHash({
  sourceKind: "shot",
  ...(shot.appearance ? { appearance: shot.appearance } : {}),
  sourceId: shot.id,
  text: compact(shot.videoPrompt),
});

export const buildStoryboardUnitUpstreamPromptHash = ({
  workflow,
  shots,
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "shotId" | "shotIds" | "board" | "unitVideoPrompt" | "videoGenerationUnitId">;
  shots: Shot[];
}) => {
  const resolved = resolveStoryboardUnitVideoPrompt({ workflow, shots });
  return manualStoryboardHash({
    sourceKind: "storyboard_unit",
    sourceId: workflow.videoGenerationUnitId || workflow.board?.videoGenerationUnitId || workflow.board?.id || workflow.shotId,
    sourceHash: resolved.sourceHash,
    text: resolved.text,
  });
};
