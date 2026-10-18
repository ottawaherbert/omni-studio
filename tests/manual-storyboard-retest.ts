import fs from "node:fs";
import path from "node:path";
import { Type } from "@google/genai";
import { defaultTemplates } from "../src/config/prompts";
import { getIndustryStandardMetrics } from "../src/config/industryStandards";
import { generateAIContent } from "../src/services/ai";
import { SCRIPT_BLOCK_TYPES } from "../src/constants";
import { validateStoryboardRules } from "../src/services/production/ruleQa";
import { gatherContextOptions } from "../src/utils/contextMapper";
import { collectProjectAssetsForContext } from "../src/utils/projectAssetContext";
import { createSceneScopedContextSelection } from "../src/utils/sceneContextSelection";
import { canonicalAssetId, isLikelySameAssetName, normalizeBreakdownAssetIds, resolveAssetRef } from "../src/utils/assetRefs";
import {
  extractScriptSceneHeadingLocationName,
  getBreakdownLocationCandidateNames,
  getScriptCharacterNameCandidates,
  inferDiscoveredCharacterRoleType,
  normalizeLocationCandidateName,
  normalizeScriptCharacterCueName,
} from "../src/utils/breakdownAssets";
import { formatVisualCreativeVision } from "../src/utils/projectUtils";

type Args = {
  projectId?: string;
  episodeId?: string;
  sceneId?: string;
  baseUrl: string;
  apply: boolean;
  render: boolean;
  renderOnly: boolean;
};

type ShotLike = {
  id: string;
  duration?: number;
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  focalLength?: string;
  lighting?: string;
  composition?: string;
  blocking?: string;
  continuityNote?: string;
  visualAction?: string;
  lightingAtmo?: string;
  motivation?: string;
  microExpression?: string;
  characterIdsInShot?: string[];
  locationId?: string;
  propIds?: string[];
  dialogueLines?: { characterId?: string; text: string }[];
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
  let render = true;
  let renderOnly = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--render-only") {
      renderOnly = true;
      continue;
    }
    if (arg === "--no-render") {
      render = false;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) rawArgs.set(match[1], match[2]);
  }
  return {
    projectId: rawArgs.get("projectId"),
    episodeId: rawArgs.get("episodeId"),
    sceneId: rawArgs.get("sceneId") || undefined,
    baseUrl: rawArgs.get("baseUrl") || "http://127.0.0.1:3000",
    apply,
    render,
    renderOnly,
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

const parseJsonArrayResponse = (text: string) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Storyboard response was not a JSON array.");
  }
};

const unique = <T,>(items: T[]) => Array.from(new Set(items.filter(Boolean)));

const calculateMinDuration = (text: string) => {
  if (!text) return 0;
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const englishWords = text.replace(/[\u4e00-\u9fa5]/g, "").split(/\s+/).filter((word) => word.length > 0).length;
  return Math.ceil(chineseChars / 4) + Math.ceil(englishWords / 3);
};

const collectStoryboardCharactersForContext = (project: any) => {
  const detailedCharacters = project.characters || [];
  const existingNames = new Set(detailedCharacters.map((character: any) => character.name));
  const plannedCharacters = (project.plannedCharacters || [])
    .filter((character: any) => character.name && !existingNames.has(character.name))
    .map((character: any) => ({
      id: character.id,
      name: character.name,
      roleType: character.roleType,
    }));
  return [...detailedCharacters, ...plannedCharacters];
};

const collectStoryboardAssetCandidates = (project: any, type: "character" | "location" | "prop") => {
  if (type === "character") return collectStoryboardCharactersForContext(project);
  return collectProjectAssetsForContext(project, type);
};

const canonicalStoryboardAssetId = (project: any, type: "character" | "location" | "prop", idOrName?: string) => {
  const resolved = resolveAssetRef(project, type, idOrName);
  if (resolved) return resolved.canonicalId;
  const rawValue = (idOrName || "").trim();
  if (!rawValue) return undefined;
  const looseMatch = collectStoryboardAssetCandidates(project, type).find((asset: any) =>
    isLikelySameAssetName(asset.id, rawValue) || isLikelySameAssetName(asset.name, rawValue)
  );
  return looseMatch?.id;
};

const canonicalStoryboardAssetIds = (project: any, type: "character" | "location" | "prop", ids?: string[]) =>
  (ids || []).map((id) => canonicalStoryboardAssetId(project, type, id)).filter(Boolean) as string[];

const AMBIGUOUS_PLANNED_CHARACTER_CUES = [
  "黑影",
  "人影",
  "身影",
  "背影",
  "影子",
  "蒙面人",
];

const isAmbiguousPlannedCharacterCue = (name?: string) => {
  const compactName = (name || "").trim().replace(/\s+/g, "");
  return AMBIGUOUS_PLANNED_CHARACTER_CUES.includes(compactName);
};

const inferCharacterIdsFromShotText = (project: any, shot: any) => {
  const detailedCharacters = project.characters || [];
  const plannedCharacters = collectStoryboardCharactersForContext(project).filter((character: any) =>
    !(project.characters || []).some((detailed: any) => detailed.id === character.id),
  );
  const screenText = [shot.visualAction, shot.microExpression, shot.blocking, shot.composition].filter(Boolean).join(" ");
  if (!screenText) return [];
  const detailedIds = detailedCharacters
    .filter((character: any) => character.name && screenText.includes(character.name))
    .map((character: any) => character.id);
  const plannedIds = plannedCharacters
    .filter((character: any) =>
      character.name &&
      !isAmbiguousPlannedCharacterCue(character.name) &&
      screenText.includes(character.name)
    )
    .map((character: any) => character.id);
  return [...detailedIds, ...plannedIds];
};

const filterVisibleCharacterIds = (project: any, shot: any, characterIds: string[]) => {
  const screenText = [shot.visualAction, shot.microExpression, shot.blocking, shot.composition].filter(Boolean).join(" ");
  const characterById = new Map(collectStoryboardCharactersForContext(project).map((character: any) => [character.id, character]));
  return characterIds.filter((id) => {
    const character: any = characterById.get(id);
    return !character?.name || screenText.includes(character.name);
  });
};

const compactSearchText = (value: string = "") => value.replace(/\s+/g, "");

const propNameTerms = (propName: string) => {
  const compactName = compactSearchText(propName);
  const terms = new Set([compactName]);
  const possessiveName = compactName.split("的").pop();
  if (possessiveName && possessiveName.length >= 2) terms.add(possessiveName);
  if (compactName.length > 4) terms.add(compactName.slice(-3));
  if (compactName.length > 3) terms.add(compactName.slice(-2));
  if (compactName.endsWith("种") && compactName.length > 2) terms.add(compactName.slice(0, -1));
  return Array.from(terms).filter((term) => term.length >= 2);
};

const shotPropSearchText = (shot: ShotLike | any) => [
  shot.visualAction,
  shot.blocking,
  shot.composition,
  shot.motivation,
  shot.microExpression,
  shot.continuityNote,
  ...(shot.dialogueLines || []).map((line: any) => line.text),
].filter(Boolean).join("\n");

const filterVisiblePropIds = (project: any, shot: ShotLike | any, propIds: string[]) => {
  const propAssets = collectProjectAssetsForContext(project, "prop");
  const searchText = compactSearchText(shotPropSearchText(shot));
  return propIds.filter((propId) => {
    const prop = propAssets.find((asset: any) => asset.id === propId);
    return !prop?.name || propNameTerms(prop.name).some((term) => searchText.includes(term));
  });
};

const normalizeShotDialogueLines = (project: any, shot: any) => {
  const rawLines = Array.isArray(shot.dialogueLines) && shot.dialogueLines.length > 0
    ? shot.dialogueLines
    : shot.voiceover
      ? [{ characterId: shot.characterId, text: shot.voiceover }]
      : [];

  return rawLines
    .map((line: any) => ({
      characterId: canonicalStoryboardAssetId(project, "character", line?.characterId),
      text: typeof line?.text === "string" ? line.text.trim() : "",
    }))
    .filter((line: any) => line.text);
};

const findLocationForName = (project: any, rawName: string) => {
  const name = normalizeLocationCandidateName(rawName);
  if (!name) return undefined;
  const resolved = resolveAssetRef(project, "location", name);
  if (resolved) return { id: resolved.canonicalId, name: resolved.displayName };
  const loose = collectProjectAssetsForContext(project, "location").find((asset: any) =>
    isLikelySameAssetName(asset.name, name)
  );
  return loose ? { id: loose.id, name: loose.name } : undefined;
};

const getOrCreatePlannedLocation = (project: any, rawName: string, newLocations: any[]) => {
  const name = normalizeLocationCandidateName(rawName);
  if (!name) return undefined;
  const existing = findLocationForName(project, name);
  if (existing) return existing;
  const existingNew = newLocations.find((location) => isLikelySameAssetName(location.name, name));
  if (existingNew) return existingNew;
  const planned = {
    id: `planned-location-${Date.now()}-${crypto.randomUUID()}`,
    name,
    type: "location" as const,
    brief: "由已确认剧本场景头识别。",
    isDetailed: false,
  };
  newLocations.push(planned);
  return planned;
};

const getOrCreatePlannedCharacter = (project: any, rawName: string, newCharacters: any[]) => {
  const candidates = getScriptCharacterNameCandidates(rawName);
  const name = candidates[0] || normalizeScriptCharacterCueName(rawName);
  if (!name) return undefined;
  const existing = candidates
    .map((candidate) => resolveAssetRef(project, "character", candidate))
    .find(Boolean);
  if (existing) return { id: existing.canonicalId, name: existing.displayName };
  const existingNew = newCharacters.find((character) => isLikelySameAssetName(character.name, name));
  if (existingNew) return existingNew;
  const planned = {
    id: `planned-char-${Date.now()}-${crypto.randomUUID()}`,
    name,
    roleType: inferDiscoveredCharacterRoleType(name),
    brief: "由已确认剧本角色提示识别。",
    isDetailed: false,
  };
  newCharacters.push(planned);
  return planned;
};

const prepareEpisodeForStoryboard = async (args: Args, project: any, episode: any, targetScenes: any[]) => {
  const newLocations: any[] = [];
  const newCharacters: any[] = [];
  let changed = false;

  for (const scene of targetScenes) {
    const characterCandidates = [
      ...(Array.isArray(scene.breakdown?.characters) ? scene.breakdown.characters : [])
        .map((character: any) => typeof character === "string" ? character : character?.name),
      ...(scene.scriptBlocks || [])
        .filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.CHARACTER)
        .map((block: any) => block.content),
    ].filter(Boolean);
    characterCandidates.forEach((candidate) => getOrCreatePlannedCharacter(project, candidate, newCharacters));

    const locationCandidates = [
      ...getBreakdownLocationCandidateNames(scene.breakdown?.location),
      ...(scene.scriptBlocks || [])
        .filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING)
        .map((block: any) => extractScriptSceneHeadingLocationName(block.content) || block.content),
    ];

    locationCandidates.forEach((candidate) => getOrCreatePlannedLocation(project, candidate, newLocations));
  }

  if (newLocations.length > 0 || newCharacters.length > 0) {
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plannedCharacters: [...(project.plannedCharacters || []), ...newCharacters],
        plannedLocations: [...(project.plannedLocations || []), ...newLocations],
      }),
    });
    project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
    changed = true;
  }

  const updatedScenes = (episode.scenes || []).map((scene: any) => {
    if (!targetScenes.some((target) => target.id === scene.id)) return scene;
    const scriptBlocks = (scene.scriptBlocks || []).map((block: any) => {
      if (block.type === SCRIPT_BLOCK_TYPES.CHARACTER) {
        const matched = getScriptCharacterNameCandidates(block.content)
          .map((candidate) => resolveAssetRef(project, "character", candidate))
          .find(Boolean);
        return matched?.canonicalId ? { ...block, linkedAssetId: matched.canonicalId } : block;
      }
      if (block.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING) {
        const headingLocationName = extractScriptSceneHeadingLocationName(block.content) || block.content;
        const matched = findLocationForName(project, headingLocationName);
        return matched?.id ? { ...block, locationId: matched.id } : block;
      }
      return block;
    });
    const breakdown = normalizeBreakdownAssetIds(project, scene.breakdown || {}) || scene.breakdown || {};
    const nextScene = { ...scene, scriptBlocks, breakdown };
    changed = true;
    return nextScene;
  });

  if (changed) {
    episode = { ...episode, scenes: updatedScenes };
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(episode),
    });
    episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  }

  return { project, episode, newLocations, newCharacters };
};

const buildStoryboardPrompt = (project: any, episode: any, scene: any) => {
  const targetDurationMins = Number(scene.targetDuration || episode.targetDuration || 1);
  const targetDurationSeconds = Math.max(1, Math.round(targetDurationMins * 60));
  const linkedCharacterIds = unique([
    ...(scene.breakdown?.characterIds || []),
    ...(scene.scriptBlocks || []).filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.CHARACTER).map((block: any) => block.linkedAssetId),
  ]);
  const linkedLocationIds = unique([
    scene.breakdown?.locationId,
    ...(scene.scriptBlocks || []).filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING).map((block: any) => block.locationId),
  ]);
  const linkedPropIds = unique([
    ...(scene.breakdown?.propIds || []),
    ...(scene.scriptBlocks || []).flatMap((block: any) => block.propIds || []),
  ]);

  const scriptContent = scene.scriptBlocks?.length
    ? scene.scriptBlocks.map((block: any) => {
        let line = `[${String(block.type).toUpperCase()}] ${block.content}`;
        if (block.acting) line += ` [ACTING: ${block.acting}]`;
        if (!block.acting && block.emotion) line += ` [EMOTION: ${block.emotion}]`;
        if (block.camera) line += ` [CAMERA: ${block.camera}]`;
        return line;
      }).join("\n")
    : String(scene.script || "").trim();
  if (!scriptContent) throw new Error(`Scene ${scene.id} has no script content; storyboard generation will not receive an empty placeholder.`);

  const linkedCharacterAssets = collectStoryboardCharactersForContext(project).filter((character: any) => linkedCharacterIds.includes(character.id));
  const linkedLocationAssets = collectProjectAssetsForContext(project, "location").filter((location: any) => linkedLocationIds.includes(location.id));
  const linkedPropAssets = collectProjectAssetsForContext(project, "prop").filter((prop: any) => linkedPropIds.includes(prop.id));
  const isVertical = project.aspectRatio === "9:16";
  const { shots } = getIndustryStandardMetrics(project.type, targetDurationMins);
  const expectedShotCount = Math.max(3, Math.min(shots.min, Math.ceil((scene.script || scriptContent).length / 30)));

  const { options: baseContextOptions, defaultIds } = gatherContextOptions(project, "generateShots");
  const scopedContext = createSceneScopedContextSelection(project, baseContextOptions, defaultIds, scene, scriptContent);
  const selectedContext = scopedContext.contextOptions
    .filter((option: any) => scopedContext.defaultSelectedContextIds.includes(option.id))
    .map((option: any) => option.value)
    .join("\n\n");

  const variables = {
    stylePrompt: formatVisualCreativeVision(project.creativeVision),
    selectedContext,
    interactiveProductionContext: "",
    characterPrompt: linkedCharacterAssets.length > 0
      ? `\n${linkedCharacterAssets.map((character: any) => [
          `- 角色ID: ${character.id} | 名字: ${character.name}`,
          character.visualIdentity && `  视觉身份: ${character.visualIdentity}`,
          character.actingStyle && `  可观察表演方式: ${character.actingStyle}`,
          character.vocalQuirk && `  台词声音: ${character.vocalQuirk}`,
        ].filter(Boolean).join("\n")).join("\n")}`
      : "",
    locationPrompt: linkedLocationAssets.length > 0
      ? `\n${linkedLocationAssets.map((location: any) => `- ID: ${location.id} | 名字: ${location.name}`).join("\n")}`
      : "",
    propPrompt: linkedPropAssets.length > 0
      ? `\n${linkedPropAssets.map((prop: any) => `- ID: ${prop.id} | 名字: ${prop.name}`).join("\n")}`
      : "",
    framingInstruction: isVertical
      ? "\n【竖屏构图强制要求】由于是竖屏拍摄（9:16），主体脸部、手部动作和关键道具必须在手机端清晰可读；多使用 CU/MCU/OTS，避免人物过小。"
      : "",
    durationInstruction: `\n【目标时长约束】本场景目标总时长约为 ${targetDurationSeconds} 秒。建议生成约 ${expectedShotCount} 个核心镜头，总时长必须接近目标；镜头之间必须有清晰信息递进，不能重复同一动作。\n【专业分镜字段硬性要求】每个镜头必须填写 focalLength、lighting、composition、blocking、continuityNote。continuityNote 必须同时包含「180 度轴线」「视线匹配」「动作顺接」「空间方位连续性」四类信息；不要只写在 blocking，因为系统 QA 会读取 continuityNote。若本场包含多个 scene_heading，每个镜头必须填写对应 locationId。`,
    interactiveInstruction: "",
    scriptContent,
    scenePhysicalContext: [
      (scene.environment || scene.breakdown?.setting) && `空间：${scene.environment || scene.breakdown?.setting}`,
      (scene.timeOfDay || scene.breakdown?.time) && `时间：${scene.timeOfDay || scene.breakdown?.time}`,
    ].filter(Boolean).join("\n"),
  };

  return {
    prompt: replaceTemplateVars(defaultTemplates.generateShots.template, variables),
    targetDurationSeconds,
  };
};

const storyboardSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      motivation: { type: Type.STRING },
      visualAction: { type: Type.STRING },
      microExpression: { type: Type.STRING },
      shotSize: { type: Type.STRING },
      cameraAngle: { type: Type.STRING },
      cameraMovement: { type: Type.STRING },
      focalLength: { type: Type.STRING },
      lighting: { type: Type.STRING },
      composition: { type: Type.STRING },
      blocking: { type: Type.STRING },
      continuityNote: { type: Type.STRING },
      lightingAtmo: { type: Type.STRING },
      voiceover: { type: Type.STRING },
      characterId: { type: Type.STRING },
      dialogueLines: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            characterId: { type: Type.STRING },
            text: { type: Type.STRING },
          },
          required: ["characterId", "text"],
        },
      },
      characterIdsInShot: { type: Type.ARRAY, items: { type: Type.STRING } },
      locationId: { type: Type.STRING },
      propIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      duration: { type: Type.NUMBER },
    },
    required: ["motivation", "visualAction", "duration", "characterIdsInShot", "shotSize", "cameraAngle", "cameraMovement", "locationId"],
  },
};

const processGeneratedShots = (project: any, scene: any, rawShots: any[]): ShotLike[] =>
  rawShots.map((shot, index) => {
    const dialogueLines = normalizeShotDialogueLines(project, shot);
    const rawDuration = Number(shot.duration || 3);
    const minVoiceDuration = dialogueLines.reduce((sum: number, line: any) => sum + calculateMinDuration(line.text), 0);
    const locationIds = unique([
      ...((scene.scriptBlocks || []).filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING).map((block: any) => block.locationId)),
      scene.breakdown?.locationId,
    ]);
    const canonicalLocationId = canonicalStoryboardAssetId(project, "location", shot.locationId);
    return {
      id: `shot-${scene.id}-${Date.now()}-${index}`,
      duration: Math.max(rawDuration, minVoiceDuration),
      shotSize: shot.shotSize || "",
      cameraAngle: shot.cameraAngle || "",
      cameraMovement: shot.cameraMovement || "",
      focalLength: shot.focalLength || "",
      lighting: shot.lighting || shot.lightingAtmo || "",
      composition: shot.composition || "",
      blocking: shot.blocking || "",
      continuityNote: shot.continuityNote || "",
      visualAction: shot.visualAction || "",
      microExpression: shot.microExpression || "",
      lightingAtmo: shot.lightingAtmo || shot.lighting || "",
      motivation: shot.motivation || "",
      characterIdsInShot: filterVisibleCharacterIds(project, shot, unique([
        ...canonicalStoryboardAssetIds(project, "character", shot.characterIdsInShot),
        ...inferCharacterIdsFromShotText(project, shot),
      ])),
      locationId: canonicalLocationId || (locationIds.length === 1 ? locationIds[0] : undefined),
      propIds: filterVisiblePropIds(project, shot, canonicalStoryboardAssetIds(project, "prop", shot.propIds)),
      dialogueLines,
    };
  });

const validateSceneStoryboard = (project: any, episode: any, scene: any, shots: ShotLike[], targetDurationSeconds: number) => {
  const totalDuration = shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const issues: string[] = [];
  const headingCount = (scene.scriptBlocks || []).filter((block: any) => block.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING).length;
  const minDuration = Math.max(8, targetDurationSeconds * 0.65);
  const maxDuration = Math.max(18, targetDurationSeconds * 1.45);
  const propAssets = collectProjectAssetsForContext(project, "prop");

  if (shots.length === 0) issues.push("未生成分镜");
  if (totalDuration < minDuration || totalDuration > maxDuration) {
    issues.push(`分镜总时长 ${totalDuration}s 与目标 ${targetDurationSeconds}s 偏差过大`);
  }
  shots.forEach((shot, index) => {
    if (!shot.visualAction?.trim()) issues.push(`镜头 ${index + 1} 缺少 visualAction`);
    if (!shot.blocking?.trim()) issues.push(`镜头 ${index + 1} 缺少 blocking`);
    if (!shot.continuityNote?.trim()) issues.push(`镜头 ${index + 1} 缺少 continuityNote`);
    if (headingCount > 1 && !shot.locationId) issues.push(`镜头 ${index + 1} 缺少多地点场景所需 locationId`);
    (shot.propIds || []).forEach((propId) => {
      const prop = propAssets.find((asset: any) => asset.id === propId);
      if (!prop) return;
      const searchText = compactSearchText(shotPropSearchText(shot));
      const appearsInShot = propNameTerms(prop.name).some((term) => searchText.includes(term));
      if (!appearsInShot) {
        issues.push(`镜头 ${index + 1} 道具 ${prop.name} 未出现在镜头文本中，疑似误绑定`);
      }
    });
    (shot.dialogueLines || []).forEach((line, lineIndex) => {
      if (line.text && !line.characterId) issues.push(`镜头 ${index + 1} 台词 ${lineIndex + 1} 缺少 characterId`);
    });
  });

  const validatedEpisode = {
    ...episode,
    scenes: [{ ...scene, shots }],
  };
  const ruleIssues = validateStoryboardRules([validatedEpisode], project)
    .filter((issue: any) => issue.severity === "blocking")
    .map((issue: any) => issue.message);
  return { valid: issues.length === 0 && ruleIssues.length === 0, issues: [...issues, ...ruleIssues], totalDuration };
};

const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const truncateText = (text: string, maxChars: number) => {
  const chars = Array.from(String(text || ""));
  return chars.length > maxChars ? `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…` : chars.join("");
};

const wrapText = (text: string, maxChars: number, maxLines = 4) => {
  const chars = Array.from(text);
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(""));
  }
  if (lines.length > maxLines) {
    const lastLine = Array.from(lines[maxLines - 1] || "");
    lines[maxLines - 1] = `${lastLine.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
  }
  return lines.slice(0, maxLines);
};

const renderStoryboardSvg = (project: any, episode: any) => {
  const scenes = episode.scenes || [];
  const shots = scenes.flatMap((scene: any) => (scene.shots || []).map((shot: any) => ({ scene, shot })));
  const columns = 2;
  const panelWidth = 520;
  const panelHeight = 330;
  const gap = 18;
  const headerHeight = 86;
  const width = columns * panelWidth + (columns + 1) * gap;
  const rows = Math.ceil(shots.length / columns);
  const height = headerHeight + rows * panelHeight + (rows + 1) * gap;
  const locationName = (id?: string) => collectProjectAssetsForContext(project, "location").find((asset: any) => asset.id === id)?.name || id || "未绑定地点";
  const characterNames = (ids?: string[]) => (ids || [])
    .map((id) =>
      project.characters?.find((character: any) => character.id === id)?.name ||
      project.plannedCharacters?.find((character: any) => character.id === id)?.name ||
      id
    )
    .join(" / ");
  const propNames = (ids?: string[]) => (ids || [])
    .map((id) => collectProjectAssetsForContext(project, "prop").find((asset: any) => asset.id === id)?.name || id)
    .join(" / ");

  const panels = shots.map(({ scene, shot }: any, index: number) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + col * (panelWidth + gap);
    const y = headerHeight + gap + row * (panelHeight + gap);
    const textLines = wrapText(shot.visualAction || "", 33, 4);
    const actionText = textLines.map((line, lineIndex) => `<text x="${x + 18}" y="${y + 104 + lineIndex * 20}" class="action">${escapeXml(line)}</text>`).join("");
    return `
      <g>
        <rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="8" class="panel"/>
        <rect x="${x + 14}" y="${y + 42}" width="${panelWidth - 28}" height="128" rx="6" class="frame"/>
        <text x="${x + 18}" y="${y + 28}" class="meta">#${index + 1} ${escapeXml(scene.title)} | ${escapeXml(shot.duration)}s | ${escapeXml(shot.shotSize)} ${escapeXml(shot.cameraMovement)}</text>
        <text x="${x + 24}" y="${y + 76}" class="lens">${escapeXml(shot.cameraAngle || "")} / ${escapeXml(shot.focalLength || "")}</text>
        ${actionText}
        <text x="${x + 18}" y="${y + 196}" class="small">地点: ${escapeXml(truncateText(locationName(shot.locationId), 34))}</text>
        <text x="${x + 18}" y="${y + 220}" class="small">角色: ${escapeXml(truncateText(characterNames(shot.characterIdsInShot), 34))}</text>
        <text x="${x + 18}" y="${y + 244}" class="small">道具: ${escapeXml(truncateText(propNames(shot.propIds), 34) || "无")}</text>
        <text x="${x + 18}" y="${y + 268}" class="small">调度: ${escapeXml(truncateText(shot.blocking || "", 34))}</text>
        <text x="${x + 18}" y="${y + 292}" class="small">连续: ${escapeXml(truncateText(shot.continuityNote || "", 34))}</text>
      </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg{fill:#f5f1e8}.title{font:700 24px sans-serif;fill:#1f2933}.subtitle{font:14px sans-serif;fill:#52606d}
    .panel{fill:#fffaf0;stroke:#2f3a3f;stroke-width:1.5}.frame{fill:#d9e6dc;stroke:#65737e;stroke-width:1}
    .meta{font:700 13px sans-serif;fill:#1f2933}.lens{font:12px sans-serif;fill:#334e68}.action{font:14px sans-serif;fill:#102a43}
    .small{font:12px sans-serif;fill:#486581}
  </style>
  <rect width="100%" height="100%" class="bg"/>
  <text x="${gap}" y="34" class="title">${escapeXml(project.title)} / ${escapeXml(episode.title)} 分镜验收板</text>
  <text x="${gap}" y="62" class="subtitle">Generated from real storyboard JSON in SQLite. Panels show shot order, visual action, location, character, blocking and continuity.</text>
  ${panels}
</svg>`;
};

const main = async () => {
  const args = parseArgs();
  if (!args.projectId || !args.episodeId) {
    throw new Error(
      "Usage: npm run test:manual-storyboard-retest -- --projectId=<projectId> --episodeId=<episodeId> [--sceneId=<sceneId>] [--apply] [--no-render].",
    );
  }
  let project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  let episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  let targetScenes = args.sceneId
    ? (episode.scenes || []).filter((scene: any) => scene.id === args.sceneId)
    : (episode.scenes || []);
  if (targetScenes.length === 0) throw new Error("No target scenes found.");

  if (args.renderOnly) {
    const outputDir = path.join(process.cwd(), "OMNI_Workspace", "storyboard-previews");
    fs.mkdirSync(outputDir, { recursive: true });
    const previewPath = path.join(outputDir, `${args.projectId}-${args.episodeId}.svg`);
    fs.writeFileSync(previewPath, renderStoryboardSvg(project, episode), "utf8");
    console.log(JSON.stringify({
      projectId: args.projectId,
      episodeId: args.episodeId,
      renderOnly: true,
      previewPath,
      sceneCount: episode.scenes?.length || 0,
      shotCount: (episode.scenes || []).reduce((sum: number, scene: any) => sum + (scene.shots?.length || 0), 0),
    }, null, 2));
    return;
  }

  const prepared = await prepareEpisodeForStoryboard(args, project, episode, targetScenes);
  project = prepared.project;
  episode = prepared.episode;
  targetScenes = args.sceneId
    ? (episode.scenes || []).filter((scene: any) => scene.id === args.sceneId)
    : (episode.scenes || []);

  const updatedScenes: any[] = [];
  const results: any[] = [];

  for (const scene of episode.scenes || []) {
    if (!targetScenes.some((target: any) => target.id === scene.id)) {
      updatedScenes.push(scene);
      continue;
    }
    const { prompt, targetDurationSeconds } = buildStoryboardPrompt(project, episode, scene);
    const responseText = await generateAIContent({
      taskType: "storyboardGen",
      prompt,
      requireJson: true,
      schema: storyboardSchema,
    });
    const rawShots = parseJsonArrayResponse(responseText);
    const shots = processGeneratedShots(project, scene, rawShots);
    const qa = validateSceneStoryboard(project, episode, scene, shots, targetDurationSeconds);
    results.push({
      sceneId: scene.id,
      title: scene.title,
      targetDurationSeconds,
      shotCount: shots.length,
      totalDuration: qa.totalDuration,
      valid: qa.valid,
      issues: qa.issues,
    });
    updatedScenes.push(qa.valid ? { ...scene, shots } : scene);
  }

  const allValid = results.every((result) => result.valid);
  if (args.apply && allValid) {
    episode = { ...episode, scenes: updatedScenes };
    await fetchJson(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(episode),
    });
    episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  }

  let previewPath = "";
  if (args.render && (args.apply ? allValid : true)) {
    const outputDir = path.join(process.cwd(), "OMNI_Workspace", "storyboard-previews");
    fs.mkdirSync(outputDir, { recursive: true });
    previewPath = path.join(outputDir, `${args.projectId}-${args.episodeId}.svg`);
    fs.writeFileSync(previewPath, renderStoryboardSvg(project, args.apply && allValid ? episode : { ...episode, scenes: updatedScenes }), "utf8");
  }

  console.log(JSON.stringify({
    projectId: args.projectId,
    episodeId: args.episodeId,
    applied: args.apply && allValid,
    newCharacters: prepared.newCharacters.map((character: any) => ({ id: character.id, name: character.name })),
    newLocations: prepared.newLocations.map((location: any) => ({ id: location.id, name: location.name })),
    results,
    previewPath,
  }, null, 2));

  if (!allValid) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
