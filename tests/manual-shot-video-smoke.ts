import fs from "node:fs";
import path from "node:path";
import { evaluateStandaloneShotDuration } from "../src/services/production/shotDurationPolicy";

type Args = {
  baseUrl: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  durationSeconds?: number;
  imagePath: string;
  allowExternalUpload: boolean;
};

const parseArgs = (): Args => {
  const values = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  const projectId = values.get("projectId")?.trim();
  const imagePath = values.get("imagePath")?.trim();
  const allowExternalUpload = process.argv.includes("--allowExternalUpload");
  if (!projectId) throw new Error("Please pass --projectId=<project-id>.");
  if (!imagePath) throw new Error("Please pass --imagePath=<absolute-image-path>.");
  if (!allowExternalUpload) {
    throw new Error("This test uploads the image and prompt to the configured video provider. Pass --allowExternalUpload only after the user explicitly authorizes it.");
  }
  return {
    baseUrl: values.get("baseUrl")?.trim() || "http://127.0.0.1:3000",
    projectId,
    episodeId: values.get("episodeId")?.trim() || undefined,
    shotId: values.get("shotId")?.trim() || undefined,
    durationSeconds: values.has("durationSeconds") ? Number(values.get("durationSeconds")) : undefined,
    imagePath: path.resolve(imagePath),
    allowExternalUpload,
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
};

const imageMimeType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
};

const mediaReference = (
  kind: "image" | "video",
  url: string,
  modelId: string,
  generationJobId: string,
) => ({
  url,
  kind,
  source: "ai_generation",
  status: "ready",
  generationJobId,
  modelId,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const findShot = (episode: any, requestedShotId?: string) => {
  for (const scene of episode.scenes || []) {
    for (const shot of scene.shots || []) {
      if (!requestedShotId || shot.id === requestedShotId) return { scene, shot };
    }
  }
  throw new Error(requestedShotId ? `Shot not found: ${requestedShotId}` : "Episode has no shots.");
};

const replaceShot = (episode: any, sceneId: string, shotId: string, replacement: any) => ({
  ...episode,
  scenes: (episode.scenes || []).map((scene: any) => scene.id === sceneId
    ? {
        ...scene,
        shots: (scene.shots || []).map((shot: any) => shot.id === shotId ? replacement : shot),
      }
    : scene),
});

const saveEpisode = (args: Args, episode: any) => fetchJson(
  `${args.baseUrl}/api/projects/${args.projectId}/episodes/${episode.id}`,
  {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(episode),
  },
);

const main = async () => {
  const args = parseArgs();
  if (!fs.existsSync(args.imagePath)) throw new Error(`Image not found: ${args.imagePath}`);

  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  const episodeId = args.episodeId || project.episodes?.[0]?.id;
  if (!episodeId) throw new Error("Project has no episode.");
  let episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${episodeId}`);
  const target = findShot(episode, args.shotId);
  const durationPolicy = evaluateStandaloneShotDuration(target.shot);
  if (!durationPolicy.valid) throw new Error(durationPolicy.reason);
  const duration = args.durationSeconds ?? durationPolicy.durationSeconds;
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
    throw new Error("Kie smoke-test duration must be an integer between 1 and 15 seconds.");
  }
  if (!String(target.shot.videoPrompt || "").trim()) throw new Error("Target shot has no videoPrompt.");
  const videoPrompt = String(target.shot.videoPrompt).trim().replace(/^\d+\s*seconds?\b/i, `${duration} seconds`);
  const aspectRatio = project.aspectRatio === "9:16" ? "9:16" : "16:9";

  const imageBuffer = fs.readFileSync(args.imagePath);
  const imageDataUrl = `data:${imageMimeType(args.imagePath)};base64,${imageBuffer.toString("base64")}`;
  const selectedAssetIds = [
    ...(target.shot.characterIdsInShot || []),
    ...(target.shot.propIds || []),
    target.shot.locationId,
  ].filter(Boolean);
  const existingImageTake = [...(target.shot.takes || [])]
    .reverse()
    .find((take: any) => take.imageUrl && !take.videoUrl && take.generationAudit?.modelId === "codex-imagegen");
  const upload = existingImageTake?.imageUrl
    ? { url: existingImageTake.imageUrl }
    : await fetchJson<{ url: string }>(`${args.baseUrl}/api/assets/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: args.projectId, dataUrl: imageDataUrl }),
      });

  const imageCreatedAt = existingImageTake?.createdAt || Date.now();
  const imageTakeId = existingImageTake?.id || `take-codex-image-${imageCreatedAt}`;
  const imageMedia = existingImageTake?.imageMedia
    || mediaReference("image", upload.url, "codex-imagegen", `codex-imagegen-${imageCreatedAt}`);
  const imageTake = existingImageTake || {
    id: imageTakeId,
    imageUrl: upload.url,
    imageMedia,
    generationAudit: {
      action: "generate_image",
      targetKind: "shot",
      shotId: target.shot.id,
      sourceHash: `manual-smoke:${target.shot.id}:${imageCreatedAt}`,
      promptHash: `manual-smoke:${String(target.shot.imagePrompt || "").length}`,
      modelId: "codex-imagegen",
      selectedSkillIds: [],
      selectedSkillTitles: [],
      selectedContextIds: [],
      selectedAssetIds,
      selectedAssetBoardItemIds: [],
      referenceImageUrls: [],
      createdAt: imageCreatedAt,
    },
    createdAt: imageCreatedAt,
  };
  const imageTakes = existingImageTake
    ? target.shot.takes || []
    : [...(target.shot.takes || []), imageTake].slice(-12);
  const shotWithImage = {
    ...target.shot,
    takes: imageTakes,
    activeTakeId: imageTakeId,
    imageUrl: upload.url,
    imageMedia,
  };
  episode = replaceShot(episode, target.scene.id, target.shot.id, shotWithImage);
  await saveEpisode(args, episode);

  const configPayload = await fetchJson<any>(`${args.baseUrl}/api/ai-config`);
  const config = configPayload.config || configPayload;
  const modelConfigId = config.routing?.videoGen;
  const model = (config.models || []).find((item: any) => item.id === modelConfigId);
  if (!model) throw new Error("Current video routing does not resolve to a configured model.");
  const channel = (config.channels || []).find((item: any) => item.id === model.channelId);
  if (!channel || channel.type !== "kie") {
    throw new Error("Current video routing is not a configured Kie channel.");
  }
  const resolution = model.kieGrokVideo?.resolution || "480p";
  if (resolution !== "480p" && resolution !== "720p") throw new Error("Kie resolution must be 480p or 720p.");

  const generated = await fetchJson<{ videoUrl: string; taskId: string }>(`${args.baseUrl}/api/proxy/kie-grok-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: channel.id,
      modelConfigId: model.id,
      request: {
        model: model.modelId,
        prompt: videoPrompt,
        duration,
        resolution,
        aspectRatio,
        imageUrl: imageDataUrl,
      },
    }),
  });
  if (!generated.videoUrl) throw new Error("Kie completed without a video URL.");

  const outputDir = path.dirname(args.imagePath);
  const videoBaseName = path.parse(args.imagePath).name.replace(/-first-frame(?:-v\d+)?$/, "");
  const videoPath = path.join(outputDir, `${videoBaseName}-video-${duration}s-${generated.taskId.slice(0, 8)}.mp4`);
  let storedVideoUrl = generated.videoUrl;
  let downloaded = false;
  try {
    const videoResponse = await fetch(generated.videoUrl);
    if (!videoResponse.ok) throw new Error(`Video download failed ${videoResponse.status}.`);
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    fs.writeFileSync(videoPath, videoBuffer);
    const archivedVideo = await fetchJson<{ url: string }>(`${args.baseUrl}/api/assets/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: args.projectId,
        dataUrl: `data:video/mp4;base64,${videoBuffer.toString("base64")}`,
      }),
    });
    storedVideoUrl = archivedVideo.url;
    downloaded = true;
  } catch (error) {
    console.warn(`Video will use the provider URL because local archival failed: ${error instanceof Error ? error.message : error}`);
  }

  const videoCreatedAt = Date.now();
  const videoTakeId = `take-kie-video-${videoCreatedAt}`;
  const videoMedia = mediaReference("video", storedVideoUrl, model.id, generated.taskId || `kie-${videoCreatedAt}`);
  const videoTake = {
    id: videoTakeId,
    imageUrl: upload.url,
    imageMedia,
    videoUrl: storedVideoUrl,
    videoMedia,
    generationAudit: {
      action: "generate_video",
      targetKind: "shot",
      shotId: target.shot.id,
      sourceHash: `manual-smoke:${target.shot.id}:${videoCreatedAt}`,
      promptHash: `manual-smoke:${videoPrompt.length}`,
      modelId: model.id,
      selectedSkillIds: [],
      selectedSkillTitles: [],
      selectedContextIds: [],
      selectedAssetIds,
      selectedAssetBoardItemIds: [],
      referenceImageUrls: [upload.url],
      startFrameUrl: upload.url,
      createdAt: videoCreatedAt,
    },
    createdAt: videoCreatedAt,
  };

  const latestEpisode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${episodeId}`);
  const latestTarget = findShot(latestEpisode, target.shot.id);
  const shotWithVideo = {
    ...latestTarget.shot,
    takes: [...(latestTarget.shot.takes || []), videoTake].slice(-12),
    activeTakeId: videoTakeId,
    imageUrl: upload.url,
    imageMedia,
    videoUrl: storedVideoUrl,
    videoMedia,
  };
  await saveEpisode(args, replaceShot(latestEpisode, latestTarget.scene.id, latestTarget.shot.id, shotWithVideo));

  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId,
    sceneId: target.scene.id,
    shotId: target.shot.id,
    duration,
    aspectRatio,
    resolution,
    imageUrl: upload.url,
    imagePath: args.imagePath,
    videoUrl: storedVideoUrl,
    videoPath: downloaded ? videoPath : undefined,
    taskId: generated.taskId,
    persisted: true,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
