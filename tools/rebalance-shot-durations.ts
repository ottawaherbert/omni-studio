import { rebalanceShotDurations } from "../src/services/production/shotDurationPolicy";

type Args = {
  baseUrl: string;
  projectId: string;
  episodeId?: string;
  targetDurationSeconds: number;
  apply: boolean;
};

const parseArgs = (): Args => {
  const values = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  const projectId = values.get("projectId")?.trim();
  if (!projectId) throw new Error("Please pass --projectId=<project-id>.");
  const targetDurationSeconds = Number(values.get("targetDurationSeconds") || 0);
  if (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds <= 0) {
    throw new Error("Please pass a positive integer --targetDurationSeconds=<seconds>.");
  }
  return {
    baseUrl: values.get("baseUrl")?.trim() || "http://127.0.0.1:3000",
    projectId,
    episodeId: values.get("episodeId")?.trim() || undefined,
    targetDurationSeconds,
    apply: process.argv.includes("--apply"),
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
};

const replacePromptDuration = (prompt: unknown, duration: number) => {
  const value = String(prompt || "");
  return /^\s*\d+(?:\.\d+)?\s*秒/.test(value)
    ? value.replace(/^\s*\d+(?:\.\d+)?\s*秒/, `${duration}秒`)
    : value;
};

const staleVideoTake = (take: any, previousDuration: number, nextDuration: number) => take.videoUrl
  ? {
      ...take,
      videoMedia: {
        ...(take.videoMedia || {}),
        status: "stale",
        updatedAt: Date.now(),
        note: `Shot duration changed from ${previousDuration}s to ${nextDuration}s; regenerate before adoption.`,
      },
    }
  : take;

const main = async () => {
  const args = parseArgs();
  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  const episodeId = args.episodeId || project.episodes?.[0]?.id;
  if (!episodeId) throw new Error("Project has no episode.");
  const episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${episodeId}`);
  const orderedShots = (episode.scenes || []).flatMap((scene: any) => scene.shots || []);
  const rebalanced = rebalanceShotDurations(orderedShots, args.targetDurationSeconds);
  const durationById = new Map(rebalanced.map((shot: any) => [shot.id, Number(shot.duration)]));
  const changes: Array<{ shotId: string; from: number; to: number }> = [];

  const scenes = (episode.scenes || []).map((scene: any) => {
    const shots = (scene.shots || []).map((shot: any) => {
      const previousDuration = Number(shot.duration || 0);
      const nextDuration = durationById.get(shot.id) || previousDuration;
      if (nextDuration === previousDuration) return shot;
      changes.push({ shotId: shot.id, from: previousDuration, to: nextDuration });
      const takes = (shot.takes || []).map((take: any) => staleVideoTake(take, previousDuration, nextDuration));
      const activeVideoTake = takes.find((take: any) => take.id === shot.activeTakeId)?.videoUrl;
      const fallbackImageTake = [...takes].reverse().find((take: any) => take.imageUrl && !take.videoUrl);
      return {
        ...shot,
        duration: nextDuration,
        videoPrompt: replacePromptDuration(shot.videoPrompt, nextDuration),
        takes,
        activeTakeId: activeVideoTake ? fallbackImageTake?.id : shot.activeTakeId,
        videoUrl: activeVideoTake ? undefined : shot.videoUrl,
        videoMedia: activeVideoTake ? undefined : shot.videoMedia,
      };
    });
    const sceneDuration = shots.reduce((total: number, shot: any) => total + Number(shot.duration || 0), 0);
    return { ...scene, shots, targetDuration: sceneDuration / 60 };
  });

  if (args.apply) {
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${episodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...episode, scenes }),
    });
  }

  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId,
    applied: args.apply,
    targetDurationSeconds: args.targetDurationSeconds,
    shotCount: orderedShots.length,
    changes,
    sceneDurations: scenes.map((scene: any) => ({
      sceneId: scene.id,
      durationSeconds: (scene.shots || []).reduce((total: number, shot: any) => total + Number(shot.duration || 0), 0),
    })),
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
