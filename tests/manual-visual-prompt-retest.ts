import { defaultTemplates } from "../src/config/prompts";
import { generateAIContent } from "../src/services/ai";
import { validatePromptRules } from "../src/services/production/ruleQa";
import { gatherContextOptions } from "../src/utils/contextMapper";
import { collectProjectAssetsForContext } from "../src/utils/projectAssetContext";
import { safeParseAIResponse } from "../src/utils/aiParser";
import { buildVisualPrompt } from "../src/lib/promptBuilder";
const getInspirationContext = (project: any | null) => {
  if (!project) return '';
  return [
    project.originalInspiration ? `【原初创意】\n${project.originalInspiration}\n` : '',
    project.refinedInspiration ? `【系统精炼套路与核心准则】\n${project.refinedInspiration}\n` : ''
  ].filter(Boolean).join('\n');
};

import {
  normalizeStoryboardImagePrompts,
  normalizeStoryboardVideoPrompts,
  storyboardImagePromptSchema,
  storyboardVideoPromptSchema,
} from "../src/services/production/storyboardVisualPromptAgent";

type Args = {
  projectId: string;
  episodeId: string;
  sceneId?: string;
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
  return {
    projectId: rawArgs.get("projectId") || "1780698638711",
    episodeId: rawArgs.get("episodeId") || "17807018642763",
    sceneId: rawArgs.get("sceneId") || undefined,
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

const replaceTemplateVars = (template: string, variables: Record<string, string>) =>
  template.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, key) => variables[key] ?? "");

const selectedContext = (project: any, taskId: "generateImagePrompts" | "generateVideoPrompts") => {
  const { options, defaultIds } = gatherContextOptions(project, taskId);
  return options
    .filter((option: any) => defaultIds.includes(option.id))
    .map((option: any) => option.value)
    .join("\n\n");
};

const collectSceneAssetDescriptions = (project: any, scene: any) => {
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const propIds = new Set<string>();
  (scene.shots || []).forEach((shot: any) => {
    (shot.characterIdsInShot || []).forEach((id: string) => characterIds.add(id));
    if (shot.locationId) locationIds.add(shot.locationId);
    (shot.propIds || []).forEach((id: string) => propIds.add(id));
  });

  const descriptions: string[] = [];
  const variantMap = scene.breakdown?.assetVariantMap || {};
  (project.characters || []).forEach((character: any) => {
    if (!characterIds.has(character.id)) return;
    let desc = character.visualIdentity || character.actingStyle || "";
    const variantId = variantMap[character.id] || variantMap[`character_${character.id}`];
    const variant = variantId && variantId !== "default" ? character.variants?.find((item: any) => item.id === variantId) : null;
    if (variant) desc += ` [状态: ${variant.name}] ${variant.description || ""} ${variant.promptModifiers || ""}`;
    if (desc.trim()) descriptions.push(`[角色] ${character.name}: ${desc.trim()}`);
  });
  (project.plannedCharacters || []).forEach((character: any) => {
    if (!characterIds.has(character.id)) return;
    if (character.brief?.trim()) descriptions.push(`[计划角色] ${character.name}: ${character.brief.trim()}`);
  });
  collectProjectAssetsForContext(project, "location").forEach((location: any) => {
    if (!locationIds.has(location.id)) return;
    let desc = location.description || "";
    const variantId = variantMap[location.id] || variantMap[`location_${location.id}`];
    const variant = variantId && variantId !== "default" ? location.variants?.find((item: any) => item.id === variantId) : null;
    if (variant) desc += ` [状态: ${variant.name}] ${variant.description || ""} ${variant.promptModifiers || ""}`;
    if (desc.trim()) descriptions.push(`[场景] ${location.name}: ${desc.trim()}`);
  });
  collectProjectAssetsForContext(project, "prop").forEach((prop: any) => {
    if (!propIds.has(prop.id)) return;
    let desc = prop.description || "";
    const variantId = variantMap[prop.id] || variantMap[`prop_${prop.id}`];
    const variant = variantId && variantId !== "default" ? prop.variants?.find((item: any) => item.id === variantId) : null;
    if (variant) desc += ` [状态: ${variant.name}] ${variant.description || ""} ${variant.promptModifiers || ""}`;
    if (desc.trim()) descriptions.push(`[道具] ${prop.name}: ${desc.trim()}`);
  });
  return descriptions.join("\n");
};

const worldBuildingRules = (project: any) =>
  project.worldBuildingRules?.length
    ? project.worldBuildingRules.map((rule: any) => `- ${rule.category}: ${rule.content}`).join("\n")
    : "";

const relationships = (project: any) =>
  project.relationships?.length
    ? project.relationships.flatMap((relationship: any) => {
        const source = project.characters?.find((character: any) => character.id === relationship.sourceId)?.name;
        const target = project.characters?.find((character: any) => character.id === relationship.targetId)?.name;
        return source && target ? [`- ${source} -> ${target}: [${relationship.type}] ${relationship.description}`] : [];
      }).join("\n")
    : "";

const formatCreativeVision = (project: any) => {
  const vision = project.creativeVision || {};
  const globalLook = vision.globalLook
    ? [
        ...(vision.globalLook.baseTexture || []),
        ...(vision.globalLook.colorGrading || []),
        ...((vision.globalLook.conditionalEffects || []).map((effect: any) => `${effect.tag}: ${effect.condition}`)),
      ].filter(Boolean).join(", ")
    : "";
  return [
    vision.visualStyle ? `Visual style: ${vision.visualStyle}` : "",
    vision.narrativeStyle ? `Narrative rhythm: ${vision.narrativeStyle}` : "",
    globalLook ? `Global look: ${globalLook}` : "",
  ].filter(Boolean).join("\n");
};

const generateScenePrompts = async (project: any, scene: any) => {
  const shotsData = (scene.shots || []).map((shot: any) => ({
    id: shot.id,
    motivation: shot.motivation,
    visualAction: shot.visualAction,
    microExpression: shot.microExpression,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    focalLength: shot.focalLength,
    lightingAtmo: shot.lightingAtmo || shot.lighting,
    lighting: shot.lighting,
    composition: shot.composition,
    blocking: shot.blocking,
    continuityNote: shot.continuityNote,
    characterIdsInShot: shot.characterIdsInShot,
    locationId: shot.locationId,
    propIds: shot.propIds,
    duration: shot.duration,
  }));

  const variables = {
    inspirationContext: getInspirationContext(project),
    creativeVision: formatCreativeVision(project),
    scenePhysicalContext: [
      (scene.environment || scene.breakdown?.setting) && `空间：${scene.environment || scene.breakdown?.setting}`,
      (scene.timeOfDay || scene.breakdown?.time) && `时间：${scene.timeOfDay || scene.breakdown?.time}`,
    ].filter(Boolean).join("\n"),
    assetDescriptions: collectSceneAssetDescriptions(project, scene),
    shotsData: JSON.stringify(shotsData, null, 2),
    worldBuildingRules: worldBuildingRules(project),
    relationships: relationships(project),
    interactiveProductionContext: "",
    productionTeamContext: "",
  };
  const imagePrompt = replaceTemplateVars(defaultTemplates.generateImagePrompts.template, {
    ...variables,
    selectedContext: selectedContext(project, "generateImagePrompts"),
  });
  const videoPrompt = replaceTemplateVars(defaultTemplates.generateVideoPrompts.template, {
    ...variables,
    selectedContext: selectedContext(project, "generateVideoPrompts"),
  });
  const imageResponse = await generateAIContent({
    taskType: "storyboardGen",
    prompt: imagePrompt,
    requireJson: true,
    schema: storyboardImagePromptSchema,
  });
  const videoResponse = await generateAIContent({
    taskType: "storyboardGen",
    prompt: videoPrompt,
    requireJson: true,
    schema: storyboardVideoPromptSchema,
  });
  const imageById = new Map(normalizeStoryboardImagePrompts(safeParseAIResponse(imageResponse, [])).map((item) => [item.id, item]));
  const videoById = new Map(normalizeStoryboardVideoPrompts(safeParseAIResponse(videoResponse, [])).map((item) => [item.id, item]));
  let updatedCount = 0;
  const updatedShots = (scene.shots || []).map((shot: any) => {
    const imageData = imageById.get(shot.id);
    const videoData = videoById.get(shot.id);
    if (!imageData && !videoData) return shot;
    updatedCount += 1;
    const tempShot = {
      ...shot,
      visualSummary: imageData?.visualSummary || shot.visualSummary,
      imagePrompt: imageData?.imagePrompt || shot.imagePrompt,
      videoPrompt: videoData?.videoPrompt || shot.videoPrompt,
    };
    const finalPrompts = buildVisualPrompt(tempShot, project, scene);
    return {
      ...shot,
      visualSummary: imageData?.visualSummary || shot.visualSummary,
      imagePrompt: finalPrompts.imagePrompt,
      videoPrompt: finalPrompts.videoPrompt,
    };
  });
  return { updatedShots, updatedCount };
};

const main = async () => {
  const args = parseArgs();
  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  let episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  const targetSceneIds = new Set(args.sceneId ? [args.sceneId] : (episode.scenes || []).map((scene: any) => scene.id));
  const results: any[] = [];
  const scenes = [];

  for (const scene of episode.scenes || []) {
    if (!targetSceneIds.has(scene.id)) {
      scenes.push(scene);
      continue;
    }
    const { updatedShots, updatedCount } = await generateScenePrompts(project, scene);
    results.push({
      sceneId: scene.id,
      title: scene.title,
      shotCount: scene.shots?.length || 0,
      updatedCount,
    });
    scenes.push({ ...scene, shots: updatedShots });
  }

  const updatedEpisode = { ...episode, scenes };
  const promptIssues = validatePromptRules([updatedEpisode], project);
  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId: args.episodeId,
    results,
    promptIssues: promptIssues.map((issue: any) => ({
      target: issue.target,
      severity: issue.severity,
      message: issue.message,
    })),
  }, null, 2));

  if (promptIssues.some((issue: any) => issue.severity === "blocking")) {
    process.exitCode = 2;
    return;
  }

  if (args.apply) {
    episode = updatedEpisode;
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(episode),
    });
    console.log(JSON.stringify({
      applied: true,
      imagePromptCount: scenes.reduce((sum: number, scene: any) => sum + (scene.shots || []).filter((shot: any) => shot.imagePrompt).length, 0),
      videoPromptCount: scenes.reduce((sum: number, scene: any) => sum + (scene.shots || []).filter((shot: any) => shot.videoPrompt).length, 0),
    }, null, 2));
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
