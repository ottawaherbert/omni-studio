import fs from "node:fs";
import path from "node:path";
import { generateAIImage } from "../src/services/ai";
import { createImageGenerationReference } from "../src/services/production/imageGenerationRequest";
import { collectProjectAssetsForContext } from "../src/utils/projectAssetContext";

type Args = {
  projectId: string;
  episodeId: string;
  shotIds: string[];
  baseUrl: string;
  apply: boolean;
};

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) {
    return originalFetch(`http://127.0.0.1:3000${input}`, init);
  }
  return originalFetch(input, init);
}) as typeof fetch;

const parseArgs = (): Args => {
  const rawArgs = new Map<string, string>();
  let apply = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) rawArgs.set(match[1], match[2]);
  }
  const shotIds = (rawArgs.get("shotIds") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    projectId: rawArgs.get("projectId") || "1780698638711",
    episodeId: rawArgs.get("episodeId") || "17807018642763",
    shotIds,
    baseUrl: rawArgs.get("baseUrl") || "http://127.0.0.1:3000",
    apply,
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text) as T;
};

const imageExtensionFromDataUrl = (dataUrl: string) => {
  const mime = dataUrl.match(/^data:([^;]+);base64,/)?.[1] || "image/png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
};

const saveGeneratedImage = async (outputDir: string, fileStem: string, imageUrl: string) => {
  fs.mkdirSync(outputDir, { recursive: true });
  if (imageUrl.startsWith("data:image")) {
    const base64 = imageUrl.split(",")[1] || "";
    const ext = imageExtensionFromDataUrl(imageUrl);
    const filePath = path.join(outputDir, `${fileStem}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    return filePath;
  }
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Download generated image failed ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const filePath = path.join(outputDir, `${fileStem}.${ext}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return filePath;
};

const uploadGeneratedImage = async (baseUrl: string, projectId: string, imageUrl: string) => {
  if (!imageUrl.startsWith("data:image")) return imageUrl;
  const response = await fetch(`${baseUrl}/api/assets/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dataUrl: imageUrl }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Upload generated image failed ${response.status}: ${text.slice(0, 240)}`);
  return (JSON.parse(text) as { url: string }).url;
};

const findShot = (episode: any, shotId: string) => {
  for (const scene of episode.scenes || []) {
    const shot = (scene.shots || []).find((item: any) => item.id === shotId);
    if (shot) return { scene, shot };
  }
  return undefined;
};

const finalImagePrompt = (shot: any) => shot.imagePrompt;

const referencesForShot = (project: any, scene: any, shot: any) => {
  const variantMap = scene.breakdown?.assetVariantMap || {};
  const characterReferences = (shot.characterIdsInShot || []).flatMap((id: string) => {
    const character = project.characters?.find((item: any) => item.id === id);
    if (!character) return [];
    const variantId = variantMap[id] || variantMap[`character_${id}`];
    const variant = character.variants?.find((item: any) => item.id === variantId);
    const imageUrl = variant?.cleanReferenceImageUrl
      || variant?.boardImageUrl
      || variant?.imageUrl
      || character.cleanReferenceImageUrl
      || character.defaultReferenceUrl
      || character.boardImageUrl
      || character.referenceImageUrl
      || character.multiViewUrl;
    return imageUrl ? [createImageGenerationReference({
      imageUrl,
      label: `${character.name}${variant?.name ? ` · ${variant.name}` : ""}`,
      role: variant ? "wardrobe_state" : "character_identity",
    })] : [];
  });
  const assetReference = (id: string, type: "location" | "prop") => {
    const asset = collectProjectAssetsForContext(project, type).find((item: any) => item.id === id);
    if (!asset) return [];
    const variantId = variantMap[id] || variantMap[`${type}_${id}`];
    const variant = asset.variants?.find((item: any) => item.id === variantId);
    const imageUrl = variant?.cleanReferenceImageUrl
      || variant?.boardImageUrl
      || variant?.imageUrl
      || asset.cleanReferenceImageUrl
      || asset.defaultReferenceUrl
      || asset.boardImageUrl
      || asset.imageUrl
      || asset.multiViewUrl
      || asset.panoramaUrl;
    return imageUrl ? [createImageGenerationReference({
      imageUrl,
      label: `${asset.name}${variant?.name ? ` · ${variant.name}` : ""}`,
      role: type === "location" ? "location_design" : "prop_design",
    })] : [];
  };
  return [
    ...characterReferences,
    ...(shot.locationId ? assetReference(shot.locationId, "location") : []),
    ...(shot.propIds || []).flatMap((id: string) => assetReference(id, "prop")),
  ];
};

const main = async () => {
  const args = parseArgs();
  if (args.shotIds.length === 0) throw new Error("Please pass --shotIds=<shot_id>[,<shot_id>...]");
  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  let episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  const outputDir = path.join(process.cwd(), "OMNI_Workspace", "storyboard-image-samples", args.projectId, args.episodeId);
  const results: any[] = [];

  for (const [index, shotId] of args.shotIds.entries()) {
    const target = findShot(episode, shotId);
    if (!target) throw new Error(`Shot not found: ${shotId}`);
    const { scene, shot } = target;
    if (!shot.imagePrompt) throw new Error(`Shot ${shotId} has no imagePrompt. Run manual-visual-prompt-retest first.`);
    const prompt = finalImagePrompt(shot);
    const generatedUrl = await generateAIImage({
      promptCore: prompt,
      aspectRatio: project.aspectRatio || "9:16",
      references: referencesForShot(project, scene, shot),
    });
    const filePath = await saveGeneratedImage(outputDir, `${String(index + 1).padStart(2, "0")}-${shotId}`, generatedUrl);
    const storedUrl = args.apply ? await uploadGeneratedImage(args.baseUrl, args.projectId, generatedUrl) : generatedUrl;
    results.push({
      sceneId: scene.id,
      sceneTitle: scene.title,
      shotId,
      filePath,
      storedUrl: args.apply ? storedUrl : undefined,
      promptChars: prompt.length,
    });

    if (args.apply) {
      episode = {
        ...episode,
        scenes: (episode.scenes || []).map((candidateScene: any) => candidateScene.id === scene.id
          ? {
              ...candidateScene,
              shots: (candidateScene.shots || []).map((candidateShot: any) => candidateShot.id === shotId
                ? { ...candidateShot, imageUrl: storedUrl }
                : candidateShot),
            }
          : candidateScene),
      };
    }
  }

  if (args.apply) {
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(episode),
    });
  }

  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId: args.episodeId,
    applied: args.apply,
    results,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
