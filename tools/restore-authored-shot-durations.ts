import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allocateDialogueLineDurations } from "../src/services/production/storyboardDialogueTiming";

type Args = {
  baseUrl: string;
  projectId: string;
  episodeId: string;
  sourceFiles: string[];
  apply: boolean;
};

const parseArgs = (): Args => {
  const values = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  const projectId = values.get("projectId")?.trim();
  const episodeId = values.get("episodeId")?.trim();
  const sourceFiles = String(values.get("sources") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!projectId || !episodeId || sourceFiles.length === 0) {
    throw new Error("Pass --projectId, --episodeId and comma-separated --sources.");
  }
  return {
    baseUrl: values.get("baseUrl")?.trim() || "http://127.0.0.1:3000",
    projectId,
    episodeId,
    sourceFiles,
    apply: process.argv.includes("--apply"),
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
};

const readAuthoredScenes = async (sourceFiles: string[]) => {
  const scenes: any[] = [];
  for (const sourceFile of sourceFiles) {
    const parsed = JSON.parse(await readFile(resolve(sourceFile), "utf8"));
    if (!Array.isArray(parsed?.scenes)) throw new Error(`${sourceFile} does not contain a scenes array.`);
    scenes.push(...parsed.scenes);
  }
  return scenes;
};

const staleChangedDurationTakes = (takes: any[], previousDuration: number, nextDuration: number) =>
  (takes || []).map((take) => take.videoUrl
    ? {
        ...take,
        videoMedia: {
          ...(take.videoMedia || {}),
          status: "stale",
          updatedAt: Date.now(),
          note: `Shot duration restored from ${previousDuration}s to ${nextDuration}s; regenerate before adoption.`,
        },
      }
    : take);

const rebuildDialogueTracks = (scene: any, shots: any[]) => {
  const priorTracks = Array.isArray(scene.audioTracks) ? scene.audioTracks : [];
  const rebuilt: any[] = priorTracks.filter((track: any) => track.type !== "dialogue");
  let shotStart = 0;
  for (const shot of shots) {
    const lines = Array.isArray(shot.dialogueLines) ? shot.dialogueLines : [];
    const durations = allocateDialogueLineDurations(lines, Number(shot.duration || 0));
    let lineStart = shotStart;
    lines.forEach((line: any, index: number) => {
      const existing = priorTracks.find((track: any) =>
        track.type === "dialogue"
        && track.shotId === shot.id
        && track.characterId === line.characterId
        && track.text === line.text,
      );
      const duration = durations[index] || 0;
      rebuilt.push({
        ...(existing || {}),
        id: existing?.id || `audio-${shot.id}-${index}`,
        type: "dialogue",
        url: existing?.url || "",
        startTime: lineStart,
        duration,
        characterId: line.characterId,
        text: line.text,
        shotId: shot.id,
      });
      lineStart += duration;
    });
    shotStart += Number(shot.duration || 0);
  }
  return rebuilt;
};

const main = async () => {
  const args = parseArgs();
  const authoredScenes = await readAuthoredScenes(args.sourceFiles);
  const authoredByTitle = new Map(authoredScenes.map((scene) => [String(scene.title || "").trim(), scene]));
  const episodeUrl = `${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`;
  const episode = await fetchJson<any>(episodeUrl);
  const changes: Array<{ sceneTitle: string; shotId: string; from: number; to: number }> = [];

  const scenes = (episode.scenes || []).map((scene: any) => {
    const authored = authoredByTitle.get(String(scene.title || "").trim());
    if (!authored) throw new Error(`No authored timing source found for scene: ${scene.title}`);
    if (!Array.isArray(authored.shots) || authored.shots.length !== (scene.shots || []).length) {
      throw new Error(`Shot count mismatch for scene ${scene.title}.`);
    }
    const shots = (scene.shots || []).map((shot: any, index: number) => {
      const nextDuration = Number(authored.shots[index]?.duration || 0);
      if (!Number.isInteger(nextDuration) || nextDuration <= 0 || nextDuration > 15) {
        throw new Error(`Invalid authored duration for ${scene.title} shot ${index + 1}: ${nextDuration}`);
      }
      const previousDuration = Number(shot.duration || 0);
      if (previousDuration === nextDuration) return shot;
      changes.push({ sceneTitle: scene.title, shotId: shot.id, from: previousDuration, to: nextDuration });
      const takes = staleChangedDurationTakes(shot.takes, previousDuration, nextDuration);
      const activeVideoChanged = takes.some((take: any) => take.id === shot.activeTakeId && take.videoUrl);
      return {
        ...shot,
        duration: nextDuration,
        takes,
        activeTakeId: activeVideoChanged ? undefined : shot.activeTakeId,
        videoUrl: activeVideoChanged ? undefined : shot.videoUrl,
        videoMedia: activeVideoChanged ? undefined : shot.videoMedia,
      };
    });
    const durationSeconds = shots.reduce((total: number, shot: any) => total + Number(shot.duration || 0), 0);
    return {
      ...scene,
      shots,
      targetDuration: durationSeconds / 60,
      audioTracks: rebuildDialogueTracks(scene, shots),
    };
  });

  if (args.apply) {
    await fetchJson(episodeUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...episode, scenes }),
    });
  }

  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId: args.episodeId,
    applied: args.apply,
    changes,
    totalDurationSeconds: scenes.flatMap((scene: any) => scene.shots || [])
      .reduce((total: number, shot: any) => total + Number(shot.duration || 0), 0),
    sceneDurations: scenes.map((scene: any) => ({
      sceneTitle: scene.title,
      durationSeconds: (scene.shots || []).reduce((total: number, shot: any) => total + Number(shot.duration || 0), 0),
    })),
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
