import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  isKieGptImage2ModelId,
} from "../../../src/config/aiConfigDefaults";
import {
  compileImageGenerationRequest,
  createImageGenerationReference,
  type ImageReferenceRole,
} from "../../../src/services/production/imageGenerationRequest";

type Phase = "plan" | "frames" | "videos" | "fallback" | "assemble" | "all";

type Args = {
  baseUrl: string;
  projectId: string;
  episodeId?: string;
  outputDir?: string;
  phase: Phase;
  limit: number;
  allowExternalUpload: boolean;
};

type RenderSegment = {
  id: string;
  shotId: string;
  sceneId: string;
  index: number;
  count: number;
  durationSeconds: number;
  prompt: string;
  firstFramePath?: string;
  videoPath?: string;
  taskId?: string;
  source?: "kie" | "still_fallback";
  error?: string;
};

type RenderShot = {
  id: string;
  sceneId: string;
  order: number;
  durationSeconds: number;
  imagePrompt: string;
  videoPrompt: string;
  references?: Array<{ imageUrl: string; label: string; role: ImageReferenceRole }>;
  referenceUrl?: string;
  firstFramePath?: string;
  outputPath?: string;
  persistedAt?: number;
  segments: RenderSegment[];
};

type RenderManifest = {
  version: 1 | 2;
  projectId: string;
  episodeId: string;
  expectedDurationSeconds: number;
  aspectRatio: "16:9" | "9:16";
  resolution: "480p" | "720p";
  imageChannelId: string;
  imageModelConfigId: string;
  imageModelId: string;
  imageResolution?: "1K" | "2K" | "4K";
  videoChannelId: string;
  videoModelConfigId: string;
  createdAt: number;
  updatedAt: number;
  shots: RenderShot[];
  roughCutPath?: string;
  finalFilmPath?: string;
};

const values = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

const parseArgs = (): Args => {
  const projectId = values.get("projectId")?.trim();
  if (!projectId) throw new Error("Please pass --projectId=<project-id>.");
  const phase = (values.get("phase") || "plan") as Phase;
  if (!["plan", "frames", "videos", "fallback", "assemble", "all"].includes(phase)) {
    throw new Error(`Unsupported phase: ${phase}.`);
  }
  const rawLimit = Number(values.get("limit") || Number.POSITIVE_INFINITY);
  return {
    baseUrl: (values.get("baseUrl") || "http://127.0.0.1:3000").replace(/\/$/, ""),
    projectId,
    episodeId: values.get("episodeId")?.trim() || undefined,
    outputDir: values.get("outputDir")?.trim() || undefined,
    phase,
    limit: Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : Number.POSITIVE_INFINITY,
    allowExternalUpload: process.argv.includes("--allowExternalUpload"),
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8 * 60 * 1000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-");
const mediaRoot = path.resolve("OMNI_Workspace/Media_Assets");
const mediaPath = (url: string) => url.startsWith("/media/")
  ? path.join(mediaRoot, url.slice("/media/".length))
  : undefined;

const imageDataUrl = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
};

const saveManifest = (manifestPath: string, manifest: RenderManifest) => {
  manifest.updatedAt = Date.now();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const splitDuration = (durationSeconds: number) => {
  const count = Math.max(1, Math.ceil(durationSeconds / 15));
  const base = Math.floor(durationSeconds / count);
  const remainder = durationSeconds - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

const segmentPrompt = (shot: any, _durationSeconds: number, index: number, count: number, _aspectRatio: "16:9" | "9:16") => {
  const phase = index === 0 ? "opening phase" : index === count - 1 ? "closing phase" : "middle continuation";
  const action = String(shot.visualAction || shot.videoPrompt || "").trim();
  if (!action) throw new Error(`Shot ${shot.id} is missing visible action and videoPrompt; the video model will not receive an invented fallback action.`);
  return [
    `Cinematic live-action, ${phase} of shot ${index + 1}/${count}.`,
    shot.cameraMovement || shot.focalLength ? `Camera: ${[shot.cameraMovement, shot.focalLength].filter(Boolean).join(", ")}.` : "",
    `Action: ${action}`,
    shot.microExpression ? `Performance: ${shot.microExpression}.` : "",
    "Continue the action forward without restarting it. Preserve the exact face, hairstyle, wardrobe, location, weather, props, eyeline and screen direction from the input frame.",
    "Use physically coherent motion and realistic hands. No face morphing, wardrobe change, captions, text or watermark.",
  ].filter(Boolean).join(" ");
};

const resolveShotReferences = (project: any, scene: any, shot: any): NonNullable<RenderShot["references"]> => {
  const characters = Array.isArray(project.characters) ? project.characters : [];
  const assets = Array.isArray(project.assets) ? project.assets : [];
  const variantMap = scene?.breakdown?.assetVariantMap || {};
  const references: NonNullable<RenderShot["references"]> = [];
  const push = (imageUrl: unknown, label: string, role: ImageReferenceRole) => {
    const normalized = String(imageUrl || "").trim();
    if (!normalized || references.some((item) => item.imageUrl === normalized)) return;
    references.push({ imageUrl: normalized, label, role });
  };
  push(shot.compositionData?.imageUrl, "当前镜头 3D 构图快照", "composition_anchor");
  for (const id of shot.characterIdsInShot || []) {
    const character = characters.find((item: any) => item.id === id);
    if (!character) continue;
    const characterName = String(character.name || "").trim();
    if (!characterName) throw new Error(`Character ${id} is missing a readable name; database IDs will not be sent to the image model.`);
    const overrideUrl = shot.assetOverrides?.[id];
    const variantId = variantMap[id] || variantMap[`character_${id}`];
    const variant = character.variants?.find((item: any) => item.id === variantId);
    const imageUrl = overrideUrl || variant?.imageUrl || character.boardImageUrl || character.defaultReferenceUrl || character.multiViewUrl || character.referenceImageUrl;
    push(imageUrl, variant ? `${characterName} · ${variant.name}` : characterName, overrideUrl || variant ? "wardrobe_state" : "character_identity");
  }
  for (const id of [shot.locationId, ...(shot.propIds || [])].filter(Boolean)) {
    const asset = assets.find((item: any) => item.id === id);
    if (!asset) continue;
    const assetName = String(asset.name || "").trim();
    if (!assetName) throw new Error(`Asset ${id} is missing a readable name; database IDs will not be sent to the image model.`);
    const overrideUrl = shot.assetOverrides?.[id];
    const variantId = variantMap[id] || variantMap[`${asset.type}_${id}`];
    const variant = asset.variants?.find((item: any) => item.id === variantId);
    const imageUrl = overrideUrl || variant?.imageUrl || asset.boardImageUrl || asset.defaultReferenceUrl || asset.multiViewUrl || asset.panoramaUrl || asset.imageUrl;
    push(imageUrl, variant ? `${assetName} · ${variant.name}` : assetName, asset.type === "location" ? "location_design" : "prop_design");
  }
  return references;
};

const renderShotReferences = (shot: RenderShot): NonNullable<RenderShot["references"]> => {
  if (shot.references?.length) return shot.references;
  const legacyUrl = shot.referenceUrl?.trim();
  return legacyUrl ? [{ imageUrl: legacyUrl, label: "旧版镜头参考图", role: "continuity_frame" }] : [];
};

const buildManifest = (project: any, episode: any, config: any, outputDir: string): RenderManifest => {
  const imageModelConfigId = config.routing?.imageGen;
  const videoModelConfigId = config.routing?.videoGen;
  const imageModel = (config.models || []).find((item: any) => item.id === imageModelConfigId);
  const videoModel = (config.models || []).find((item: any) => item.id === videoModelConfigId);
  const imageChannel = (config.channels || []).find((item: any) => item.id === imageModel?.channelId);
  const videoChannel = (config.channels || []).find((item: any) => item.id === videoModel?.channelId);
  if (!imageModel || !imageChannel || imageChannel.type !== "kie") throw new Error("Image routing must resolve to a configured Kie model.");
  if (!videoModel || !videoChannel || videoChannel.type !== "kie") throw new Error("Video routing must resolve to a configured Kie model.");
  const resolution = videoModel.kieGrokVideo?.resolution === "480p" ? "480p" : "720p";
  const aspectRatio = project.aspectRatio === "9:16" ? "9:16" : "16:9";
  let order = 0;
  const shots: RenderShot[] = [];
  for (const scene of episode.scenes || []) {
    for (const shot of scene.shots || []) {
      const durationSeconds = Math.max(1, Math.round(Number(shot.duration || 0)));
      const durations = splitDuration(durationSeconds);
      const shotDir = path.join(outputDir, safeName(scene.id), safeName(shot.id));
      shots.push({
        id: shot.id,
        sceneId: scene.id,
        order: order++,
        durationSeconds,
        imagePrompt: String(shot.imagePrompt || ""),
        videoPrompt: String(shot.videoPrompt || ""),
        references: resolveShotReferences(project, scene, shot),
        firstFramePath: path.join(shotDir, "first-frame.jpg"),
        outputPath: path.join(shotDir, `${safeName(shot.id)}.mp4`),
        segments: durations.map((duration, index) => ({
          id: `${shot.id}-seg-${String(index + 1).padStart(2, "0")}`,
          shotId: shot.id,
          sceneId: scene.id,
          index,
          count: durations.length,
          durationSeconds: duration,
          prompt: segmentPrompt(shot, duration, index, durations.length, aspectRatio),
          videoPath: path.join(shotDir, `segment-${String(index + 1).padStart(2, "0")}.mp4`),
        })),
      });
    }
  }
  return {
    version: 2,
    projectId: project.id,
    episodeId: episode.id,
    expectedDurationSeconds: shots.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    aspectRatio,
    resolution,
    imageChannelId: imageChannel.id,
    imageModelConfigId: imageModel.id,
    imageModelId: imageModel.modelId,
    imageResolution: isKieGptImage2ModelId(imageModel.modelId)
      ? imageModel.kieGptImage2?.resolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution
      : undefined,
    videoChannelId: videoChannel.id,
    videoModelConfigId: videoModel.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    shots,
  };
};

const download = async (url: string, outputPath: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(3 * 60 * 1000) });
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
};

const sourceFileForUrl = async (baseUrl: string, url: string, cachePath: string) => {
  const local = mediaPath(url);
  if (local && fs.existsSync(local)) return local;
  if (!fs.existsSync(cachePath)) await download(url.startsWith("/media/") ? `${baseUrl}${url}` : url, cachePath);
  return cachePath;
};

const generateFrame = async (args: Args, manifest: RenderManifest, shot: RenderShot) => {
  if (shot.firstFramePath && fs.existsSync(shot.firstFramePath)) return;
  if (!shot.firstFramePath) throw new Error(`No frame output path for ${shot.id}.`);
  fs.mkdirSync(path.dirname(shot.firstFramePath), { recursive: true });
  const references = await Promise.all(renderShotReferences(shot).map(async (reference, index) => ({
    ...reference,
    imageUrl: imageDataUrl(await sourceFileForUrl(
      args.baseUrl,
      reference.imageUrl,
      path.join(path.dirname(shot.firstFramePath!), `reference-${String(index + 1).padStart(2, "0")}.jpg`),
    )),
  })));
  const gptImage2 = isKieGptImage2ModelId(manifest.imageModelId);
  const compiled = compileImageGenerationRequest({
    promptCore: shot.imagePrompt,
    aspectRatio: manifest.aspectRatio,
    references: references.map((reference) => createImageGenerationReference(reference)),
  });
  if (!gptImage2 && compiled.referenceImages.length > 1) {
    throw new Error(`Kie Grok 图生图只接受 1 张参考图，镜头 ${shot.id} 需要 ${compiled.referenceImages.length} 张；已阻止静默丢弃资产。`);
  }
  const request = gptImage2
    ? compiled.referenceImages.length
      ? {
          model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
          prompt: compiled.providerPrompt,
          imageUrls: compiled.referenceImages,
          aspectRatio: compiled.aspectRatio,
          resolution: manifest.imageResolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution,
        }
      : {
          model: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
          prompt: compiled.providerPrompt,
          aspectRatio: compiled.aspectRatio,
          resolution: manifest.imageResolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution,
        }
    : compiled.referenceImages.length
      ? {
          model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
          prompt: compiled.providerPrompt,
          imageUrl: compiled.referenceImages[0],
        }
      : {
          model: KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
          prompt: compiled.providerPrompt,
          aspectRatio: compiled.aspectRatio,
        };
  const result = await fetchJson<{ imageUrl: string; taskId: string }>(`${args.baseUrl}/api/proxy/kie-grok-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId: manifest.imageChannelId, modelConfigId: manifest.imageModelConfigId, request }),
  });
  await download(result.imageUrl, shot.firstFramePath);
  console.log(`[frame] ${shot.id} -> ${shot.firstFramePath}`);
};

const extractLastFrame = (videoPath: string, framePath: string) => {
  fs.mkdirSync(path.dirname(framePath), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-sseof", "-0.08", "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath], { stdio: "ignore" });
};

const generateSegment = async (args: Args, manifest: RenderManifest, shot: RenderShot, segment: RenderSegment) => {
  if (segment.videoPath && fs.existsSync(segment.videoPath) && (segment.source === "kie" || segment.taskId)) return;
  if (!segment.videoPath || !shot.firstFramePath) throw new Error(`Incomplete output paths for ${segment.id}.`);
  const startFramePath = segment.index === 0
    ? shot.firstFramePath
    : path.join(path.dirname(segment.videoPath), `segment-${String(segment.index).padStart(2, "0")}-last-frame.jpg`);
  if (segment.index > 0 && !fs.existsSync(startFramePath)) {
    const previous = shot.segments[segment.index - 1];
    if (!previous?.videoPath || !fs.existsSync(previous.videoPath)) throw new Error(`Previous segment is missing for ${segment.id}.`);
    extractLastFrame(previous.videoPath, startFramePath);
  }
  segment.firstFramePath = startFramePath;
  const result = await fetchJson<{ videoUrl: string; taskId: string }>(`${args.baseUrl}/api/proxy/kie-grok-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: manifest.videoChannelId,
      modelConfigId: manifest.videoModelConfigId,
      request: {
        model: "grok-imagine-video-1-5-preview",
        prompt: segment.prompt,
        duration: segment.durationSeconds,
        resolution: manifest.resolution,
        aspectRatio: manifest.aspectRatio,
        imageUrl: imageDataUrl(startFramePath),
      },
    }),
  });
  await download(result.videoUrl, segment.videoPath);
  segment.taskId = result.taskId;
  segment.source = "kie";
  delete segment.error;
  console.log(`[video] ${segment.id} ${segment.durationSeconds}s -> ${segment.videoPath}`);
};

const generateStillFallbackSegment = (shot: RenderShot, segment: RenderSegment) => {
  if (segment.videoPath && fs.existsSync(segment.videoPath)) return;
  if (!segment.videoPath || !shot.firstFramePath || !fs.existsSync(shot.firstFramePath)) {
    throw new Error(`Cannot build still fallback for ${segment.id}; first frame is missing.`);
  }
  fs.mkdirSync(path.dirname(segment.videoPath), { recursive: true });
  const duration = segment.durationSeconds;
  const x = segment.index % 2 === 0
    ? `(iw-ow)*t/${duration}`
    : `(iw-ow)*(1-t/${duration})`;
  const y = segment.index % 2 === 0
    ? `(ih-oh)*(1-t/${duration})`
    : `(ih-oh)*t/${duration}`;
  execFileSync("ffmpeg", [
    "-y", "-loop", "1", "-i", shot.firstFramePath,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-t", String(duration), "-vf", `scale=800:435:force_original_aspect_ratio=increase,crop=736:400:x='${x}':y='${y}',fps=24`,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-shortest", segment.videoPath,
  ], { stdio: "ignore" });
  segment.source = "still_fallback";
  delete segment.error;
  console.log(`[fallback] ${segment.id} ${duration}s -> ${segment.videoPath}`);
};

const ffprobeDuration = (filePath: string) => Number(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
], { encoding: "utf8" }).trim());

const concatVideos = (inputs: string[], outputPath: string, expectedDuration?: number) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const listPath = `${outputPath}.concat.txt`;
  fs.writeFileSync(listPath, inputs.map((input) => `file '${input.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    ...(expectedDuration ? ["-t", String(expectedDuration)] : []), outputPath,
  ], { stdio: "ignore" });
  const duration = ffprobeDuration(outputPath);
  if (expectedDuration && Math.abs(duration - expectedDuration) > 0.2) {
    throw new Error(`${path.basename(outputPath)} duration ${duration.toFixed(3)}s does not match ${expectedDuration}s.`);
  }
  return duration;
};

const masterFilm = ({
  roughCutPath,
  dialogueTrackPath,
  subtitlePath,
  outputPath,
  durationSeconds,
}: {
  roughCutPath: string;
  dialogueTrackPath: string;
  subtitlePath: string;
  outputPath: string;
  durationSeconds: number;
}) => {
  execFileSync("ffmpeg", [
    "-y", "-i", roughCutPath, "-i", dialogueTrackPath, "-i", subtitlePath,
    "-filter_complex", "[0:a]volume=0.42[location];[1:a]volume=1.0[dialogue];[location][dialogue]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[audio]",
    "-map", "0:v:0", "-map", "[audio]", "-map", "2:s:0", "-t", String(durationSeconds),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-c:s", "mov_text", "-metadata:s:s:0", "language=chi",
    "-movflags", "+faststart", outputPath,
  ], { stdio: "ignore" });
  const duration = ffprobeDuration(outputPath);
  if (Math.abs(duration - durationSeconds) > 0.2) {
    throw new Error(`${path.basename(outputPath)} duration ${duration.toFixed(3)}s does not match ${durationSeconds}s.`);
  }
  return duration;
};

const uploadFile = async (args: Args, filePath: string, mimeType: string) => fetchJson<{ url: string }>(`${args.baseUrl}/api/assets/upload`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ projectId: args.projectId, dataUrl: `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}` }),
});

const persistShotVideo = async (args: Args, manifest: RenderManifest, shot: RenderShot) => {
  if (!shot.outputPath) return;
  const episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${manifest.episodeId}`);
  let targetScene: any;
  let targetShot: any;
  for (const scene of episode.scenes || []) {
    const found = (scene.shots || []).find((item: any) => item.id === shot.id);
    if (found) { targetScene = scene; targetShot = found; break; }
  }
  if (!targetShot) throw new Error(`Shot disappeared while persisting: ${shot.id}.`);
  const uploaded = await uploadFile(args, shot.outputPath, "video/mp4");
  const createdAt = Date.now();
  const takeId = `take-kie-render-${createdAt}`;
  const generationJobId = `kie-render-${crypto.createHash("sha1").update(shot.id + createdAt).digest("hex").slice(0, 12)}`;
  const videoMedia = { url: uploaded.url, kind: "video", source: "ai_generation", status: "ready", generationJobId, modelId: manifest.videoModelConfigId, createdAt, updatedAt: createdAt };
  const take = {
    id: takeId,
    imageUrl: targetShot.imageUrl,
    imageMedia: targetShot.imageMedia,
    videoUrl: uploaded.url,
    videoMedia,
    generationAudit: {
      action: "generate_video", targetKind: "shot", shotId: shot.id,
      sourceHash: `kie-render:${shot.id}:${createdAt}`, promptHash: crypto.createHash("sha1").update(shot.videoPrompt).digest("hex"),
      modelId: manifest.videoModelConfigId, selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [],
      selectedAssetIds: [...(targetShot.characterIdsInShot || []), ...(targetShot.propIds || []), targetShot.locationId].filter(Boolean),
      selectedAssetBoardItemIds: [], referenceImageUrls: renderShotReferences(shot).map((reference) => reference.imageUrl), startFrameUrl: targetShot.imageUrl, createdAt,
    },
    createdAt,
  };
  const replacement = { ...targetShot, takes: [...(targetShot.takes || []), take].slice(-12), activeTakeId: takeId, videoUrl: uploaded.url, videoMedia };
  const updatedEpisode = {
    ...episode,
    scenes: (episode.scenes || []).map((scene: any) => scene.id === targetScene.id
      ? { ...scene, shots: (scene.shots || []).map((item: any) => item.id === shot.id ? replacement : item) }
      : scene),
  };
  await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${manifest.episodeId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updatedEpisode),
  });
};

const main = async () => {
  const args = parseArgs();
  if (["frames", "videos", "all"].includes(args.phase) && !args.allowExternalUpload) {
    throw new Error("This phase sends images and prompts to Kie. Pass --allowExternalUpload after explicit authorization.");
  }
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  const episodeId = args.episodeId || project.episodes?.[0]?.id;
  if (!episodeId) throw new Error("Project has no episode.");
  const episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${episodeId}`);
  const configPayload = await fetchJson<any>(`${args.baseUrl}/api/ai-config`);
  const config = configPayload.config || configPayload;
  const outputDir = path.resolve(args.outputDir || path.join(mediaRoot, args.projectId, "film-render"));
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");
  let manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RenderManifest
    : buildManifest(project, episode, config, outputDir);
  if (manifest.projectId !== args.projectId || manifest.episodeId !== episodeId) throw new Error("Existing manifest targets a different project or episode.");
  if (manifest.version === 1) {
    for (const manifestShot of manifest.shots) {
      const sourceScene = (episode.scenes || []).find((scene: any) => scene.id === manifestShot.sceneId);
      const sourceShot = sourceScene?.shots?.find((shot: any) => shot.id === manifestShot.id);
      manifestShot.references = sourceShot
        ? resolveShotReferences(project, sourceScene, sourceShot)
        : renderShotReferences(manifestShot);
      delete manifestShot.referenceUrl;
    }
    manifest.version = 2;
  }
  const routedVideoModel = (config.models || []).find((item: any) => item.id === config.routing?.videoGen);
  manifest.resolution = routedVideoModel?.kieGrokVideo?.resolution === "720p" ? "720p" : "480p";
  for (const shot of manifest.shots) {
    if (!shot.persistedAt && shot.outputPath && fs.existsSync(shot.outputPath)
      && shot.segments.every((segment) => segment.videoPath && fs.existsSync(segment.videoPath))) {
      shot.persistedAt = fs.statSync(shot.outputPath).mtimeMs;
    }
  }
  saveManifest(manifestPath, manifest);

  console.log(JSON.stringify({
    projectId: manifest.projectId,
    episodeId: manifest.episodeId,
    shots: manifest.shots.length,
    segments: manifest.shots.reduce((sum, shot) => sum + shot.segments.length, 0),
    expectedDurationSeconds: manifest.expectedDurationSeconds,
    resolution: manifest.resolution,
    manifestPath,
  }, null, 2));
  if (args.phase === "plan") return;

  let completed = 0;
  if (["frames", "all"].includes(args.phase)) {
    for (const shot of manifest.shots) {
      if (completed >= args.limit) break;
      if (shot.firstFramePath && fs.existsSync(shot.firstFramePath)) continue;
      await generateFrame(args, manifest, shot);
      completed += 1;
      saveManifest(manifestPath, manifest);
    }
  }

  completed = 0;
  if (["videos", "all"].includes(args.phase)) {
    for (const shot of manifest.shots) {
      if (!shot.firstFramePath || !fs.existsSync(shot.firstFramePath)) await generateFrame(args, manifest, shot);
      for (const segment of shot.segments) {
        if (completed >= args.limit) break;
        if (segment.videoPath && fs.existsSync(segment.videoPath)) continue;
        try {
          await generateSegment(args, manifest, shot, segment);
        } catch (error) {
          segment.error = error instanceof Error ? error.message : String(error);
          saveManifest(manifestPath, manifest);
          throw error;
        }
        completed += 1;
        saveManifest(manifestPath, manifest);
      }
      if (!shot.persistedAt && shot.segments.every((segment) => segment.videoPath && fs.existsSync(segment.videoPath))) {
        if (!shot.outputPath) throw new Error(`No shot output path for ${shot.id}.`);
        concatVideos(shot.segments.map((segment) => segment.videoPath!), shot.outputPath, shot.durationSeconds);
        await persistShotVideo(args, manifest, shot);
        shot.persistedAt = Date.now();
        saveManifest(manifestPath, manifest);
        console.log(`[shot] ${shot.id} assembled and persisted.`);
      }
      if (completed >= args.limit) break;
    }
  }

  if (args.phase === "fallback") {
    for (const shot of manifest.shots) {
      let generatedFallback = false;
      for (const segment of shot.segments) {
        const existed = Boolean(segment.videoPath && fs.existsSync(segment.videoPath));
        generateStillFallbackSegment(shot, segment);
        if (!existed) generatedFallback = true;
      }
      if (!shot.outputPath) throw new Error(`No shot output path for ${shot.id}.`);
      if (generatedFallback || !fs.existsSync(shot.outputPath)) {
        concatVideos(shot.segments.map((segment) => segment.videoPath!), shot.outputPath, shot.durationSeconds);
      }
      if (!shot.persistedAt) {
        await persistShotVideo(args, manifest, shot);
        shot.persistedAt = Date.now();
      }
      saveManifest(manifestPath, manifest);
    }
  }

  if (["assemble", "all"].includes(args.phase)) {
    const missing = manifest.shots.filter((shot) => !shot.outputPath || !fs.existsSync(shot.outputPath));
    if (missing.length) throw new Error(`Cannot assemble film; ${missing.length} shot renders are missing.`);
    const outputStem = safeName(project.id || "film");
    const roughCutPath = path.join(outputDir, `${outputStem}-rough-cut.mp4`);
    const roughDuration = concatVideos(manifest.shots.sort((a, b) => a.order - b.order).map((shot) => shot.outputPath!), roughCutPath, manifest.expectedDurationSeconds);
    manifest.roughCutPath = roughCutPath;
    const dialogueTrackPath = path.join(outputDir, "audio", "dialogue-track.m4a");
    const subtitlePath = path.join(outputDir, "audio", "dialogue.zh-CN.srt");
    let finalPath = roughCutPath;
    let duration = roughDuration;
    if (fs.existsSync(dialogueTrackPath) && fs.existsSync(subtitlePath)) {
      finalPath = path.join(outputDir, `${outputStem}-master.mp4`);
      duration = masterFilm({ roughCutPath, dialogueTrackPath, subtitlePath, outputPath: finalPath, durationSeconds: manifest.expectedDurationSeconds });
    }
    manifest.finalFilmPath = finalPath;
    saveManifest(manifestPath, manifest);
    console.log(JSON.stringify({ roughCutPath, finalFilmPath: finalPath, durationSeconds: duration }, null, 2));
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
