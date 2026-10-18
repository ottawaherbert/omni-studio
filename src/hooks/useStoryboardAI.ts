import { validateDirectorShotEdits } from "../clients/creativeDirectionClient";
import { upgradeDirectorPlanTemplate } from "../config/prompts/directorPlanContract";
import type { SceneDirectorPlan } from "../clients/domainTypes";
import { renderProductionCreativeContext, projectDirectorMediaContext, normalizeDirectorPlan, directorBindingHash, directorPlanSourceHash, applyDirectorAudioPlan } from "../clients/creativeDirectionClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import { appearanceContentHash, preserveAppearanceChoices, reviseShotAppearances, normalizeShotAppearances, appearanceSourceShots, appearanceAssetPatch, appearancePrompt, requireAppearanceReady, appearanceBoards } from "../clients/productionStoryboardWorkflowClient";
import { useRef, useState } from 'react';
import { Type } from "../clients/aiSchemaClient";
import toast from "react-hot-toast";
import { flushDebouncedProjectSave, useProjectStore, usePromptStore } from "../clients/stateClient";
import { useGameStore } from "../clients/stateClient";
import { useAIConfigStore } from "../clients/stateClient";
import { loadProductionPromptTemplate } from "../clients/productionPromptClient";
import { generateAIContent, generateAIImage } from "../clients/aiClient";
import { appendShotTakeCandidate } from "../clients/productionMediaReviewClient";
import {
  buildImageVisualStyleProjection,
  buildShotImageVisualRecipeInputEvidence,
  resolveCreativeVisionVisualFallback,
  resolveImageVisualStyleProjectionContext,
} from "../clients/productionVisualImageClient";
import { safeParseAIResponse } from "../utils/aiParser";
import { SCRIPT_BLOCK_TYPES } from "../constants";
import { Shot, AudioTrack, Scene, Project, Episode, Character, type ManualStudioTakeAudit } from "../clients/domainTypes";
import { buildVisualPrompt } from '../lib/promptBuilder';
import { gatherContextOptions } from "../utils/contextMapper";
import { collectProjectAssetsForContext } from "../utils/projectAssetContext";
import { createSceneScopedContextSelection } from "../utils/sceneContextSelection";
import { getIndustryStandardMetrics } from "../config/industryStandards";
import { buildInteractiveProductionContext } from "../utils/interactiveProductionContext";
import { buildInteractiveSceneVisualContext } from "../utils/interactiveSceneVisualContext";
import { buildInteractiveStoryboardInstruction } from "../utils/interactiveStoryboardInstruction";
import {
  createAIGeneratedMediaReference,
} from "../utils/mediaProvenance";
import { summarizeUnknownError } from "../utils/logging";
import { isLikelySameAssetName, resolveAssetRef } from "../utils/assetRefs";
import type {
  PromptEditorConfirmMetadata,
  PromptEditorImageReference,
} from "../components/PromptEditorModal";
import type { ManualProductionAssetBoard } from "../clients/productionAssetWorkflowClient";
import {
  createImageGenerationReference,
  type CompiledImageGenerationRequest,
  type ImageVisualStyleProjection,
  type ImageReferenceRole,
} from "../clients/productionStudioWorkflowClient";
import type {
  ManualStoryboardAgentExecutionAudit,
  ManualStoryboardAgentQuality,
  ManualStoryboardPromptAudit,
  ManualStoryboardWorkspace,
} from "../clients/domainTypes";
import {
  buildManualShotPlanHash,
  buildManualImagePromptHash,
  buildManualVideoPromptHash,
  buildManualVisualPromptSourceHash,
  canRebaseManualStoryboardAuthorEdit,
  manualStoryboardHash,
  rebaseManualStoryboardAfterAuthorEdit,
} from "../clients/productionStoryboardWorkflowClient";
import {
  buildStoryboardShotQualityPrompt,
  buildStoryboardShotRepairPrompt,
  isStoryboardAgentQualityPassing,
  normalizeStoryboardAgentQuality,
  resolveStoryboardQualityTargetShotId,
  STORYBOARD_AGENT_MAX_REPAIRS,
  STORYBOARD_AGENT_QUALITY_THRESHOLD,
  storyboardShotQualitySchema,
  storyboardShotSchema,
  validateStoryboardShotContract,
  resolveStoryboardVehicleId,
  type StoryboardAssetScope,
} from "../clients/productionStoryboardWorkflowClient";
import {
  buildStoryboardImagePromptQualityPrompt,
  buildStoryboardImagePromptRepairPrompt,
  buildStoryboardVideoPromptQualityPrompt,
  buildStoryboardVideoPromptRepairPrompt,
  normalizeStoryboardImagePrompts,
  normalizeStoryboardVideoPrompts,
  STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS,
  storyboardImagePromptSchema,
  storyboardVisualPromptQualitySchema,
  storyboardVideoPromptSchema,
  validateStoryboardImagePromptContract,
  validateStoryboardVideoPromptContract,
  type StoryboardImagePromptValue,
  type StoryboardVideoPromptValue,
} from "../clients/productionStoryboardWorkflowClient";
import {
  allocateDialogueLineDurations,
} from "../clients/productionStoryboardWorkflowClient";

export interface StoryboardReviewIssue {
  severity: "blocking" | "warning";
  message: string;
}

export const resolveStoryboardCandidateDisposition = (
  quality: ManualStoryboardAgentQuality | undefined,
  contractIssueCount: number,
) => quality && isStoryboardAgentQualityPassing(quality) && contractIssueCount === 0
  ? "awaiting_author_adoption" as const
  : "needs_author_decision" as const;

export type StoryboardAgentPhase =
  | "idle"
  | "generating"
  | "checking"
  | "repairing"
  | "completed"
  | "needs_decision"
  | "failed";

export interface StoryboardAgentProgress {
  phase: StoryboardAgentPhase;
  label: string;
  sceneId?: string;
  sceneTitle?: string;
  attempt: number;
  maxAttempts: number;
  completedScenes: number;
  totalScenes: number;
  score?: number;
  issues?: string[];
}

export type StoryboardShotBatchAction = "image_prompt" | "video_prompt" | "image";

export interface StoryboardShotBatchProgress {
  action: StoryboardShotBatchAction;
  status: "running" | "completed";
  total: number;
  currentIndex: number;
  currentShotId?: string;
  completed: number;
  failures: Array<{ shotId: string; message: string }>;
}

export type StoryboardReviewCandidate =
  | {
      kind: "shots";
      projectId?: string;
      directorPlan?: SceneDirectorPlan;
      directorBindingHash?: string;
      previousShotPlanHash?: string;
      sceneId: string;
      sceneTitle: string;
      episodeId: string;
      shots: Shot[];
      audioTracks: AudioTrack[];
      appearanceHistory?: Shot[];
      sourceHash: string;
      audit: ManualStoryboardPromptAudit;
      targetDurationSeconds?: number;
      issues: StoryboardReviewIssue[];
      authorEdited?: boolean;
    }
  | {
      kind: "image_prompts" | "video_prompts";
      sceneId: string;
      sceneTitle: string;
      episodeId: string;
      shots: Shot[];
      sourceHash: string;
      audit: ManualStoryboardPromptAudit;
      issues: StoryboardReviewIssue[];
      authorEdited?: boolean;
    };

export interface StoryboardBatchSceneContext {
  scene: Scene;
  productionReady: boolean;
  shotPlanComplete: boolean;
  visualPromptReady: boolean;
  visualPromptComplete: boolean;
  imagePromptReady?: boolean;
  imagePromptComplete?: boolean;
  videoPromptReady?: boolean;
  videoPromptComplete?: boolean;
  sourceHash: string;
  manualTeamContext: string;
  manualAssetContext: string;
  allowedAssetIds: StoryboardAssetScope;
}

interface StoryboardWorkflowOptions {
  manualReview?: boolean;
  productionReady?: boolean;
  visualPromptReady?: boolean;
  imagePromptReady?: boolean;
  videoPromptReady?: boolean;
  sourceHash?: string;
  manualTeamContext?: string;
  loadManualTeamContext?: () => Promise<string>;
  manualAssetContext?: string;
  allowedAssetIds?: {
    character: string[];
    location: string[];
    prop: string[];
  };
  manualAssetBoards?: ManualProductionAssetBoard[];
  batchScenes?: StoryboardBatchSceneContext[];
}

const collectStoryboardCharactersForContext = (project: Project | null) => {
  if (!project) return [];
  const detailedCharacters = project.characters || [];
  const existingNames = new Set(detailedCharacters.map((character) => character.name));
  const plannedCharacters = (project.plannedCharacters || [])
    .filter((character) => character.name && !existingNames.has(character.name))
    .map((character) => ({
      id: character.id,
      name: character.name,
      roleType: character.roleType,
    }));
  return [...detailedCharacters, ...plannedCharacters] as Array<Character & { roleType?: string }>;
};

const compileQueuedPromptTemplate = (template: string, variables: Record<string, string>) => {
  let content = template;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, "g"), () => value || "");
  }
  content = content
    .replace(/{{(?:skills|selectedContext|userIntent)}}/g, "")
    .replace(/{{versionCount}}/g, "1")
    .replace(/{{[^}]+}}/g, "");
  let previousContent = "";
  while (previousContent !== content) {
    previousContent = content;
    content = content.replace(/【[^】]+】[:：]?\n\s*(?=【|$)/g, "");
  }
  return content.trim();
};

const collectStoryboardAssetCandidates = (project: Project | null, type: "character" | "location" | "prop") => {
  if (!project) return [];
  if (type === "character") return collectStoryboardCharactersForContext(project);
  return collectProjectAssetsForContext(project, type);
};

const resolveShotImageReferences = ({
  project,
  shot,
  manualAssetBoards = [],
  variantMap = {},
}: {
  project: Project;
  shot: Shot;
  manualAssetBoards?: ManualProductionAssetBoard[];
  variantMap?: Record<string, string>;
}): PromptEditorImageReference[] => {
  const roleFor = (assetType: "character" | "location" | "prop" | "vehicles", hasVariant: boolean): ImageReferenceRole =>
    assetType === "character"
      ? hasVariant ? "wardrobe_state" : "character_identity"
      : assetType === "location" ? "location_design" : assetType === "vehicles" ? "vehicle_design" : "prop_design";
  const requested = [
    ...(shot.characterIdsInShot || []).map((assetId) => ({ assetId, assetType: "character" as const })),
    ...(shot.locationId ? [{ assetId: shot.locationId, assetType: "location" as const }] : []),
    ...(shot.propIds || []).map((assetId) => ({ assetId, assetType: "prop" as const })),
    ...(shot.vehicleIds || []).map((assetId) => ({ assetId, assetType: "vehicles" as const })),
  ];
  const uniqueRequested = requested.filter((item, index, list) =>
    list.findIndex((candidate) => candidate.assetId === item.assetId && candidate.assetType === item.assetType) === index,
  );
  const references = uniqueRequested.flatMap((item): PromptEditorImageReference[] => {
    const state = shot.appearance?.states.find(s => s.assetId === item.assetId && s.decision === 'accepted');
    if (state) {
      const board = appearanceBoards(project, [shot], manualAssetBoards, 'image').find(itemBoard => itemBoard.assetId === item.assetId);
      if (!board?.referenceImageUrl) return [];
      return [{ ...createImageGenerationReference({ imageUrl: board.referenceImageUrl, label: `${board.assetName} · ${board.variantName}`, role: roleFor(item.assetType, Boolean(board.variantId)) }), id: board.boardItemId, label: `${board.assetName} · ${board.variantName}`, sourceLabel: board.variantId ? '本镜头外观状态' : '基础身份参考，外观按本镜头文字' }];
    }
    const desiredVariantId = variantMap[item.assetId] || variantMap[`${item.assetType}_${item.assetId}`];
    const governedAssetBoards = manualAssetBoards.filter((board) =>
      board.assetId === item.assetId && board.assetType === item.assetType,
    );
    const governedMatches = governedAssetBoards.filter((board) =>
      board.approvalState === "confirmed" && Boolean(board.referenceImageUrl),
    );
    const governed = (desiredVariantId
      ? governedMatches.find((board) => board.variantId === desiredVariantId)
      : undefined)
      || governedMatches.find((board) => !board.variantId)
      || governedMatches[0];
    if (governed?.referenceImageUrl) {
      return [{
        ...createImageGenerationReference({
          imageUrl: governed.referenceImageUrl,
          label: `${governed.assetName}${governed.variantName ? ` · ${governed.variantName}` : ""}`,
          role: roleFor(item.assetType, Boolean(governed.variantId)),
        }),
        id: governed.boardItemId,
        label: `${item.assetType === "character" ? "角色" : item.assetType === "location" ? "场景" : item.assetType === "vehicles" ? "交通工具" : "道具"} · ${governed.assetName}${governed.variantName ? ` · ${governed.variantName}` : ""}`,
        sourceLabel: "已确认正式资产参考图",
      }];
    }
    if (governedAssetBoards.length > 0) return [];

    if (item.assetType === "character") {
      const character = project.characters.find((candidate) => candidate.id === item.assetId);
      if (!character) return [];
      const variant = character.variants?.find((candidate) => candidate.id === desiredVariantId);
      const imageUrl = variant?.cleanReferenceImageUrl
        || variant?.boardImageUrl
        || variant?.imageUrl
        || character.cleanReferenceImageUrl
        || character.defaultReferenceUrl
        || character.boardImageUrl
        || character.referenceImageUrl
        || character.multiViewUrl;
      return imageUrl ? [{
        ...createImageGenerationReference({
          imageUrl,
          label: `${character.name}${variant?.name ? ` · ${variant.name}` : ""}`,
          role: roleFor("character", Boolean(variant)),
        }),
        id: `character:${character.id}:${variant?.id || "base"}`,
        label: `角色 · ${character.name}${variant?.name ? ` · ${variant.name}` : ""}`,
        sourceLabel: "项目资产参考图",
      }] : [];
    }

    const asset = project.assets.find((candidate) => candidate.id === item.assetId);
    if (!asset) return [];
    const variant = asset.variants?.find((candidate) => candidate.id === desiredVariantId);
    const imageUrl = variant?.cleanReferenceImageUrl
      || variant?.boardImageUrl
      || variant?.imageUrl
      || asset.cleanReferenceImageUrl
      || asset.defaultReferenceUrl
      || asset.boardImageUrl
      || asset.imageUrl
      || asset.multiViewUrl
      || asset.panoramaUrl;
    return imageUrl ? [{
      ...createImageGenerationReference({
        imageUrl,
        label: `${asset.name}${variant?.name ? ` · ${variant.name}` : ""}`,
        role: roleFor(item.assetType, Boolean(variant)),
      }),
      id: `${item.assetType}:${asset.id}:${variant?.id || "base"}`,
      label: `${item.assetType === "location" ? "场景" : item.assetType === "vehicles" ? "交通工具" : "道具"} · ${asset.name}${variant?.name ? ` · ${variant.name}` : ""}`,
      sourceLabel: "项目资产参考图",
    }] : [];
  });
  return references;
};

const canonicalStoryboardAssetId = (project: Project | null, type: "character" | "location" | "prop" | "vehicles", idOrName?: string) => {
  if (type === "vehicles") return resolveStoryboardVehicleId(project, idOrName);
  const resolved = resolveAssetRef(project || undefined, type, idOrName);
  if (resolved) return resolved.canonicalId;
  const rawValue = (idOrName || "").trim();
  if (!rawValue) return undefined;
  const looseMatch = collectStoryboardAssetCandidates(project, type).find((asset: any) =>
    isLikelySameAssetName(asset.id, rawValue) || isLikelySameAssetName(asset.name, rawValue)
  );
  return looseMatch?.id;
};

const canonicalStoryboardAssetIds = (project: Project | null, type: "character" | "location" | "prop" | "vehicles", ids?: string[]) =>
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

const inferCharacterIdsFromShotText = (project: Project | null, shot: any) => {
  if (!project) return [];
  const detailedCharacters = project.characters || [];
  const plannedCharacters = collectStoryboardCharactersForContext(project).filter((character: any) =>
    !(project.characters || []).some((detailed: any) => detailed.id === character.id),
  );
  const screenText = [
    shot.visualAction,
    shot.microExpression,
    shot.blocking,
    shot.composition,
  ].filter(Boolean).join(" ");
  if (!screenText) return [];
  const detailedIds = detailedCharacters
    .filter((character) => character.name && screenText.includes(character.name))
    .map((character) => character.id);
  const plannedIds = plannedCharacters
    .filter((character: any) =>
      character.name &&
      !isAmbiguousPlannedCharacterCue(character.name) &&
      screenText.includes(character.name)
    )
    .map((character: any) => character.id);
  return [...detailedIds, ...plannedIds];
};

const filterVisibleCharacterIds = (project: Project | null, shot: any, characterIds: string[]) => {
  if (!project) return characterIds;
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

const shotPropSearchText = (shot: any) => [
  shot.visualAction,
  shot.blocking,
  shot.composition,
  shot.motivation,
  shot.microExpression,
  shot.continuityNote,
  ...(shot.dialogueLines || []).map((line: any) => line.text),
].filter(Boolean).join("\n");

const filterVisiblePropIds = (project: Project | null, shot: any, propIds: string[]) => {
  if (!project) return propIds;
  const propAssets = collectProjectAssetsForContext(project, "prop");
  const searchText = compactSearchText(shotPropSearchText(shot));
  return propIds.filter((propId) => {
    const prop: any = propAssets.find((asset: any) => asset.id === propId);
    return !prop?.name || propNameTerms(prop.name).some((term) => searchText.includes(term));
  });
};

const sceneLocalSpeakerNames = (project: Project | null, scene: Scene) =>
  Array.from(new Set((scene.breakdown?.characters || [])
    .map((value) => typeof value === "string" ? value.trim() : String(value?.name || "").trim())
    .filter((name) => name && !resolveAssetRef(project || undefined, "character", name))));

const normalizeShotDialogueLines = (project: Project | null, shot: any) => {
  const rawLines = Array.isArray(shot.dialogueLines) && shot.dialogueLines.length > 0
    ? shot.dialogueLines
    : shot.voiceover
      ? [{ characterId: shot.characterId, text: shot.voiceover }]
      : [];

  return rawLines
    .map((line: any) => {
      const characterId = canonicalStoryboardAssetId(project, "character", line?.characterId);
      return {
        characterId,
        speakerName: characterId ? undefined : typeof line?.speakerName === "string" ? line.speakerName.trim() : undefined,
        delivery: ["on_screen", "off_screen", "voice_over", "phone"].includes(line?.delivery) ? line.delivery : undefined,
        text: typeof line?.text === "string" ? line.text.trim() : "",
      };
    })
    .filter((line: any) => line.text);
};

const projectShotForVisualPrompt = (project: Project, shot: Shot, promptKind: "image" | "video", episode?: Episode, scene?: Scene) => {
  const assetName = (type: "character" | "location" | "prop", id?: string) =>
    id ? resolveAssetRef(project, type, id)?.displayName : undefined;
  const compositionAnchors = (shot.compositionData?.entities || []).map((entity: any) => {
    const name = assetName(entity.type === "prop" ? "prop" : "character", entity.id);
    if (!name || !entity.screenBox) return "";
    return `${name}: x=${Math.round(entity.screenBox.x)}, y=${Math.round(entity.screenBox.y)}, w=${Math.round(entity.screenBox.w)}, h=${Math.round(entity.screenBox.h)}`;
  }).filter(Boolean);
  const dialogue = promptKind === "video"
    ? (shot.dialogueLines || []).map((line) => ({
        speaker: assetName("character", line.characterId) || line.speakerName,
        text: line.text,
      })).filter((line) => line.speaker && line.text)
    : undefined;

  return {
    id: shot.id,
    creativeDirection: renderProductionCreativeContext(project, { episode, scene, shot }, promptKind),
    ...(shot.appearance ? { appearance: appearancePrompt(shot, promptKind) } : {}),
    ...(promptKind === "video" ? { duration: shot.duration } : {}),
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    ...(promptKind === "video" ? { cameraMovement: shot.cameraMovement, continuityNote: shot.continuityNote } : {}),
    focalLength: shot.focalLength,
    composition: shot.composition,
    blocking: shot.blocking,
    visualAction: shot.visualAction,
    microExpression: shot.microExpression,
    lighting: shot.lighting || shot.lightingAtmo,
    visibleCharacters: (shot.characterIdsInShot || []).map((id) => assetName("character", id)).filter(Boolean),
    location: assetName("location", shot.locationId),
    visibleProps: (shot.propIds || []).map((id) => assetName("prop", id)).filter(Boolean),
    ...(compositionAnchors.length ? { compositionAnchors } : {}),
    ...(dialogue?.length ? { dialogue } : {}),
  };
};

const meaningfulStoryboardPromptValue = (...values: Array<string | undefined>) => values
  .map((value) => String(value || "").trim())
  .find((value) => value && !/(?:\{\{[^}]+\}\}|未设置|暂无|待补全|待确认)/.test(value)) || "";

const snapshotInteractiveNode = (project: Project | null, nodeId: string, reason: string) => {
  if (project?.projectModel === "interactive") {
    useGameStore.getState().createNodeSnapshot(nodeId, reason);
  }
};

const buildInteractiveVisualContext = (
  project: Project | null,
  episode: Episode | null,
  scene: Scene | undefined,
) => {
  const projectedContext = buildInteractiveSceneVisualContext(scene);
  if (projectedContext) return projectedContext;
  if (project?.projectModel !== "interactive" || !episode?.gameData || !scene) return "";
  const nodeId = scene.sourceNodeId || scene.id;
  const context = buildInteractiveProductionContext(project, episode, episode.gameData, nodeId);
  return [
    "本场景是互动节点场景，不是线性影视普通场景。",
    context.incomingContext ? `【可见入场约束】\n${context.incomingContext}` : "",
    context.outgoingContext ? `【可见出口与待机约束】\n${context.outgoingContext}` : "",
  ].filter(Boolean).join("\n");
};

export const useStoryboardAI = (
  currentProject: Project | null,
  activeEpisode: Episode | null,
  activeScene: Scene | undefined,
  updateScene: ReturnType<typeof useProjectStore.getState>["updateScene"],
  setActiveShotId: (id: string | null) => void,
  workflowOptions: StoryboardWorkflowOptions = {},
) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingShotImageId, setGeneratingShotImageId] = useState<string | null>(null);
  const [generatingShotPrompt, setGeneratingShotPrompt] = useState<{
    shotId: string;
    kind: "image" | "video";
  } | null>(null);
  const [shotBatchProgress, setShotBatchProgress] = useState<StoryboardShotBatchProgress | null>(null);
  const shotBatchRunningRef = useRef(false);
  const sceneShotPlanHash = (scene: Scene) => (scene as Scene & { __workspaceShotPlanHash?: string }).__workspaceShotPlanHash || buildManualShotPlanHash(scene.shots || []);
  const directorRequests = useRef(new Map<string, { project: Project; episode: Episode; scene: Scene }>());
  const rememberDirectorRequest = (project: Project, episode: Episode, scene: Scene, shared?: { project: Project; episode: Episode }) => {
    const snapshot = shared ? { ...shared, scene: structuredClone(scene) } : structuredClone({ project, episode, scene });
    directorRequests.current.set(scene.id, snapshot);
    return snapshot;
  };
  const readDirectorRequest = (project: Project, episode: Episode, scene: Scene) => {
    const snapshot = directorRequests.current.get(scene.id) || rememberDirectorRequest(project, episode, scene);
    const live = useProjectStore.getState();
    const liveScene = live.activeEpisode?.scenes.find(item => item.id === scene.id);
    if (live.currentProject?.id !== project.id || live.activeEpisode?.id !== episode.id || !liveScene
      || directorPlanSourceHash(snapshot.project, { episode: snapshot.episode, scene: snapshot.scene }, []) !== directorPlanSourceHash(live.currentProject, { episode: live.activeEpisode, scene: liveScene }, [])
      || sceneShotPlanHash(snapshot.scene) !== sceneShotPlanHash(liveScene)) {
      throw new Error("导演、原文或已有镜头在提示词打开后发生变化，请重新打开生成。");
    }
    return snapshot;
  };
  const [reviewCandidate, setReviewCandidateState] = useState<StoryboardReviewCandidate | null>(null);
  const [isReviewCandidateOpen, setIsReviewCandidateOpen] = useState(false);
  const [agentProgress, setAgentProgress] = useState<StoryboardAgentProgress>({
    phase: "idle",
    label: "",
    attempt: 0,
    maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
    completedScenes: 0,
    totalScenes: 1,
  });
  const setReviewCandidate = (candidate: StoryboardReviewCandidate | null) => {
    setReviewCandidateState(candidate);
    setIsReviewCandidateOpen(Boolean(candidate));
  };
  const [promptModalState, setPromptModalState] = useState<{
    isOpen: boolean;
    templateId: string;
    title?: string;
    variables: Record<string, string>;
    onConfirm: (finalPrompt: string, userIntent?: string, metadata?: PromptEditorConfirmMetadata) => void;
    contextOptions?: { id: string; label: string; value: string }[];
    defaultSelectedContextIds?: string[];
    imageReferences?: PromptEditorImageReference[];
    defaultSelectedImageReferenceIds?: string[];
    imageVisualStyleProjection?: ImageVisualStyleProjection;
  }>({
    isOpen: false,
    templateId: '',
    variables: {},
    onConfirm: () => {},
  });
  const resolveManualTeamContext = async () => {
    if (!workflowOptions.manualReview || !workflowOptions.loadManualTeamContext) {
      return [workflowOptions.manualTeamContext || "", currentProject ? renderProductionCreativeContext(currentProject, { episode: activeEpisode || undefined, scene: activeScene }, "planning") : ""].filter(Boolean).join("\n\n");
    }
    try {
      return await workflowOptions.loadManualTeamContext();
    } catch (error) {
      console.error("Failed to load Storyboard production context:", summarizeUnknownError(error));
      toast.error("场次来源加载失败，请重试。");
      return null;
    }
  };

  const handlePrepareGenerateShots = async (estimatedSceneDuration: string, targetDurationMins: number) => {
    if (!activeScene || isGenerating || !currentProject) return;
    if (workflowOptions.manualReview && !workflowOptions.productionReady) {
      toast.error("请先补充当前场次的剧本原文。");
      return;
    }
    if (!activeScene.script) {
      toast.error("该场景还没有剧本，请先在剧本页面生成剧本。");
      return;
    }

    if (activeEpisode) rememberDirectorRequest(currentProject, activeEpisode, activeScene);
    const scriptBlocks = activeScene.scriptBlocks || [];
    if (!workflowOptions.manualReview && scriptBlocks.length === 0) {
      toast.error("请先在剧本页面将剧本转换为结构化剧本，并关联角色和场地资产。");
      return;
    }

    const unlinkedCharacters = scriptBlocks.filter(b => b.type === SCRIPT_BLOCK_TYPES.CHARACTER && !b.linkedAssetId);
    const unlinkedLocations = scriptBlocks.filter(b => b.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING && !b.locationId);
    
    if (!workflowOptions.manualReview && (unlinkedCharacters.length > 0 || unlinkedLocations.length > 0)) {
      toast.error("剧本中存在未关联资产的角色或场地，请先在剧本页面完成关联。");
      return;
    }

    // Use scene breakdown assets, fallback to block-level linked assets if breakdown is missing
    const blockCharacterIds = scriptBlocks.filter(b => b.type === SCRIPT_BLOCK_TYPES.CHARACTER && b.linkedAssetId).map(b => b.linkedAssetId!);
    const breakdownCharacterIds = activeScene.breakdown?.characterIds || [];
    const linkedCharacterIds = workflowOptions.manualReview
      ? workflowOptions.allowedAssetIds?.character || []
      : [...new Set([...blockCharacterIds, ...breakdownCharacterIds])];

    const blockLocationIds = scriptBlocks.filter(b => b.type === SCRIPT_BLOCK_TYPES.SCENE_HEADING && b.locationId).map(b => b.locationId!);
    const breakdownLocationId = activeScene.breakdown?.locationId ? [activeScene.breakdown.locationId] : [];
    const linkedLocationIds = workflowOptions.manualReview
      ? workflowOptions.allowedAssetIds?.location || []
      : [...new Set([...blockLocationIds, ...breakdownLocationId])];

    const blockPropIds = scriptBlocks.flatMap(b => b.propIds || []);
    const breakdownPropIds = activeScene.breakdown?.propIds || [];
    const linkedPropIds = workflowOptions.manualReview
      ? workflowOptions.allowedAssetIds?.prop || []
      : [...new Set([...blockPropIds, ...breakdownPropIds])];

    const scriptContent = scriptBlocks.length > 0
      ? scriptBlocks.map(b => {
          let line = `[${b.type.toUpperCase()}] ${b.content}`;
          if (b.acting) line += ` [ACTING: ${b.acting}]`;
          if (!b.acting && b.emotion) line += ` [EMOTION: ${b.emotion}]`;
          if (b.camera) line += ` [CAMERA: ${b.camera}]`;
          return line;
        }).join('\n')
      : activeScene.script || "";

    const stylePrompt = resolveCreativeVisionVisualFallback(currentProject);

    const variantMap = activeScene.breakdown?.assetVariantMap || {};

    const storyboardCharacters = collectStoryboardCharactersForContext(currentProject);
    const linkedCharacterAssets = storyboardCharacters.filter(c => linkedCharacterIds.includes(c.id));
    const characterPrompt = linkedCharacterAssets.length > 0 ? `
【角色表演与列表 (Character Performance List)】
以下列出项目可用角色的可执行表演约束，仅选择原文中实际出场的角色。请把已提供的表演方式和说话特征落实成镜头内可观察动作，并准确填写 characterIdsInShot；不要补写人格档案或心理类型。
${linkedCharacterAssets.map(c => {
  const variantId = variantMap[c.id] || variantMap[`character_${c.id}`];
  const variant = variantId && variantId !== 'default' ? c.variants?.find(v => v.id === variantId) : null;
  const stateStr = variant ? ` (状态: ${variant.name})` : '';
  const behaviorStr = [c.actingStyle && `表演:${c.actingStyle}`, c.vocalQuirk && `语言:${c.vocalQuirk}`].filter(Boolean).join(' | ');
  return [`- ID: ${c.id} | 名字: ${c.name}${stateStr}`, behaviorStr].filter(Boolean).join(' | ');
}).join("\n")}
` : "";

    const linkedLocationAssets = collectProjectAssetsForContext(currentProject, "location").filter(a => linkedLocationIds.includes(a.id));
    const locationPrompt = linkedLocationAssets.length > 0 ? `
【场地列表 (Location List)】
以下是项目可选场地，仅选择符合本场原文的地点。请将对应的场地 ID 填入 locationId 字段。
${linkedLocationAssets.map(l => {
  const variantId = variantMap[l.id] || variantMap[`location_${l.id}`];
  const variant = variantId && variantId !== 'default' ? l.variants?.find(v => v.id === variantId) : null;
  const stateStr = variant ? ` (状态: ${variant.name})` : '';
  return `- ID: ${l.id} | 名字: ${l.name}${stateStr}`;
}).join("\n")}
` : "";

    const linkedPropAssets = collectProjectAssetsForContext(currentProject, "prop").filter(a => linkedPropIds.includes(a.id));
    const propPrompt = linkedPropAssets.length > 0 ? `
【道具列表 (Prop List)】
以下是项目可选道具，仅选择符合本场原文的物件。请根据剧情判断每个镜头中出现了哪些道具，并将它们的 ID 填入 propIds 字段。
${linkedPropAssets.map(p => {
  const variantId = variantMap[p.id] || variantMap[`prop_${p.id}`];
  const variant = variantId && variantId !== 'default' ? p.variants?.find(v => v.id === variantId) : null;
  const stateStr = variant ? ` (状态: ${variant.name})` : '';
  return `- ID: ${p.id} | 名字: ${p.name}${stateStr}`;
}).join("\n")}
` : "";

    const isVertical = currentProject.aspectRatio === "9:16";
    const framingInstruction = isVertical 
      ? `\n【竖屏构图强制要求】\n由于是竖屏拍摄（9:16），请多使用特写（CU）、中近景（MCU）和过肩镜头（OTS）。`
      : "";

    const pacingPref = currentProject.pacingPreference || 'medium';
    let pacingInstruction = "";
    if (pacingPref === 'fast') {
      pacingInstruction = `【节奏偏好：快节奏 / 碎剪优先 (短剧/短视频)】
- **总体剪辑策略**：镜头切得快而密。单镜头平均时长应在 2-4 秒之间。
- **动态曲线构建**：大多数对白、动作都切碎（如正反打快切、局部细节特写），但在**情绪爆发的哭戏或极剧烈反转的焦点位置**可以偶尔安排超过 6 秒的长镜头反差打底。`;
    } else if (pacingPref === 'slow') {
      pacingInstruction = `【节奏偏好：慢节奏 / 情绪留白 (电影/文艺片)】
- **总体剪辑策略**：靠调度叙事，给演员留有极大的表演空间与留白。单镜头平均时长应在 6-12 秒（甚至更长）之间。
- **动态曲线构建**：大基调长且平缓（靠长镜头、大调度的景深镜），多全景或长连镜；但必须在**激烈的物理冲突局或高潮动作点**穿插数个 0.5-2 秒的快切拉升张力。`;
    } else {
      pacingInstruction = `【节奏偏好：中等节奏 / 叙事呼吸 (常规剧集)】
- **总体剪辑策略**：适中的节奏，日常对话或走位稳健交代。单镜头平均时长在 4-7 秒之间。
- **动态曲线构建**：长短镜头混合，贴近自然心流，不盲目快切也不刻意拖长。`;
    }

    const metrics = getIndustryStandardMetrics(currentProject.type, targetDurationMins);
    let expectedShotCount = metrics?.shots.min || 1;
    
    // 双轨校验机制：如果实际剧本字数很少，防止凭空出现极多的分镜
    const scriptLength = activeScene.script ? activeScene.script.length : 0;
    if (scriptLength > 0) {
      const maxShotsByLength = Math.ceil(scriptLength / 30); // 假定平均每个分镜的台词/动作描写占据至少30个字
      expectedShotCount = Math.min(expectedShotCount, Math.max(3, maxShotsByLength));
    } else {
      expectedShotCount = Math.max(3, expectedShotCount);
    }
    
    const expectedShotCountInstruction = metrics
      ? `\n【建议镜头颗粒度】\n基于项目类型、场景目标时长与剧本文本长度，本场建议生成约 ${expectedShotCount} 个核心镜头。可因动作密度、强反转、关键微表情适度增减，但不要为了凑时长凭空添加无叙事功能的空镜，也不要把多个关键动作压进一个镜头。`
      : '\n镜头数量由作者意图和实际呈现内容决定，不按字数或分钟数推算；一个持续镜头也可以成立。';
    const durationInstruction = estimatedSceneDuration
      ? `\n【目标时长约束】\n本场景的目标总时长约为 ${estimatedSceneDuration} 秒。请确保生成的各分镜时长(duration)累加后总体接近此目标（允许适度浮动）。请勿只给出匀速切割，必须服从上述【节奏偏好】并具备明确的长短起伏曲线！\n${expectedShotCountInstruction}\n\n${pacingInstruction}`
      : `\n${expectedShotCountInstruction}\n\n${pacingInstruction}`;

    const interactiveProductionContext = buildInteractiveVisualContext(currentProject, activeEpisode, activeScene);
    const interactiveInstruction = currentProject.projectModel === "interactive"
      ? buildInteractiveStoryboardInstruction(activeScene)
      : "";

    const { options: baseContextOptions, defaultIds: baseDefaultSelectedContextIds } = gatherContextOptions(currentProject, "generateShots");
    const scopedContext = createSceneScopedContextSelection(
      currentProject,
      baseContextOptions,
      baseDefaultSelectedContextIds,
      activeScene,
      scriptContent,
    );
    const productionTeamContext = await resolveManualTeamContext();
    if (productionTeamContext === null) return;

    setPromptModalState({
      isOpen: true,
      templateId: 'generateShots',
      variables: {
        stylePrompt,
        characterPrompt,
        locationPrompt,
        propPrompt,
        framingInstruction,
        durationInstruction,
        interactiveInstruction,
        interactiveProductionContext,
        productionTeamContext,
        formalAssetContext: workflowOptions.manualAssetContext || "",
        scriptContent,
        inspirationContext: "",
        environment: activeScene.environment || activeScene.breakdown?.setting || "原文未指定",
        timeOfDay: activeScene.timeOfDay || activeScene.breakdown?.time || "原文未指定",
        scenePhysicalContext: [
          activeScene.environment || activeScene.breakdown?.setting
            ? `空间属性 (INT/EXT): ${activeScene.environment || activeScene.breakdown?.setting}`
            : "",
          activeScene.timeOfDay || activeScene.breakdown?.time
            ? `时间属性 (DAY/NIGHT/DAWN/DUSK): ${activeScene.timeOfDay || activeScene.breakdown?.time}`
            : "",
        ].filter(Boolean).join("\n"),
      },
      contextOptions: scopedContext.contextOptions,
      defaultSelectedContextIds: scopedContext.defaultSelectedContextIds,
      onConfirm: (finalPrompt, _userIntent, metadata) => handleGenerateShots(finalPrompt, metadata)
    });
  };


  const handlePrepareGenerateSegmentShots = async () => {
    if (!workflowOptions.manualReview || !currentProject || !activeEpisode || isGenerating) return;
    const batchScenes = workflowOptions.batchScenes || [];
    if (!batchScenes.length) {
      toast.error("当前分段没有可生成的场次。");
      return;
    }
    const pendingScenes = batchScenes.filter((item) => !item.shotPlanComplete);
    if (!pendingScenes.length) {
      toast.success("本段所有场次的 Shot 已通过独立质检。");
      return;
    }
    const blockedScene = pendingScenes.find((item) => !item.productionReady || !item.scene.script);
    if (blockedScene) {
      toast.error(`“${blockedScene.scene.title}”尚无可用于分镜的剧本原文。`);
      return;
    }

    const batchSnapshot = structuredClone({ project: currentProject, episode: activeEpisode });
    pendingScenes.forEach(item => rememberDirectorRequest(currentProject, activeEpisode, item.scene, batchSnapshot));
    const { options: baseContextOptions, defaultIds: baseDefaultSelectedContextIds } = gatherContextOptions(currentProject, "generateShots");
    const completedSceneContinuity = batchScenes
      .filter((item) => item.shotPlanComplete && item.scene.shots?.length)
      .map((item) => {
        const finalShot = item.scene.shots![item.scene.shots!.length - 1];
        return [
          `${item.scene.title}：已通过质检，仅作连续性参考，不得重做。`,
          finalShot.visualAction ? `出场可见状态：${finalShot.visualAction}` : "",
          finalShot.continuityNote ? `承接约束：${finalShot.continuityNote}` : "",
        ].filter(Boolean).join("\n");
      })
      .join("\n\n");
    const contextOptions = completedSceneContinuity
      ? [...baseContextOptions, {
          id: "ctx_batch_completed_shots",
          label: "本段已完成场次的出场连续性",
          value: `【本段已完成场次边界】\n${completedSceneContinuity}`,
        }]
      : baseContextOptions;
    const defaultSelectedContextIds = completedSceneContinuity
      ? [...baseDefaultSelectedContextIds, "ctx_batch_completed_shots"]
      : baseDefaultSelectedContextIds;
    const isVertical = currentProject.aspectRatio === "9:16";
    setPromptModalState({
      isOpen: true,
      templateId: "generateShots",
      variables: {
        stylePrompt: resolveCreativeVisionVisualFallback(currentProject),
        characterPrompt: "",
        locationPrompt: "",
        propPrompt: "",
        framingInstruction: isVertical
          ? "【竖屏构图】本段为 9:16，优先使用适合竖屏的信息层级和人物关系构图。"
          : "【横屏构图】本段按项目画幅保持统一的空间关系和视线方向。",
        durationInstruction: `【整段自动执行】本段共 ${batchScenes.length} 个场次，其中 ${batchScenes.length - pendingScenes.length} 场已通过并保留，本次按顺序执行剩余 ${pendingScenes.length} 场。每场总时长必须接近该场 targetDurationSeconds，并在生成后自动质检和修订。`,
        interactiveInstruction: "",
        interactiveProductionContext: "",
        productionTeamContext: "",
        formalAssetContext: "",
        scriptContent: "",
        scenePhysicalContext: "",
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: (finalPrompt, _userIntent, metadata) => handleGenerateSegmentShots(finalPrompt, metadata),
    });
  };

  const normalizeGeneratedShotPlan = (
    scene: Scene,
    generatedShots: Array<Record<string, any>>,
    enforceAssetScope: boolean,
    previousShots: Shot[] = [],
  ) => {
    const runId = `${scene.id}-${Date.now()}`;
    const normalized = generatedShots.map((shot, index): Shot => {
      const dialogueLines = normalizeShotDialogueLines(currentProject, shot);
      const rawDuration = Number(shot.duration) > 0 ? Number(shot.duration) : 3;
      const explicitCharacterIds = canonicalStoryboardAssetIds(currentProject, "character", shot.characterIdsInShot);
      const characterIdsInShot = enforceAssetScope
        ? Array.from(new Set(explicitCharacterIds))
        : filterVisibleCharacterIds(currentProject, shot, Array.from(new Set([
            ...explicitCharacterIds,
            ...inferCharacterIdsFromShotText(currentProject, shot),
          ])));

      return {
        id: `${runId}-shot-${index + 1}`,
        duration: rawDuration,
        shotSize: shot.shotSize,
        cameraAngle: shot.cameraAngle,
        cameraMovement: shot.cameraMovement,
        focalLength: shot.focalLength,
        lighting: shot.lighting,
        composition: shot.composition,
        blocking: shot.blocking,
        continuityNote: shot.continuityNote,
        visualAction: shot.visualAction,
        microExpression: shot.microExpression,
        soundDesign: typeof shot.soundDesign === "string" ? shot.soundDesign : undefined,
        editingNote: typeof shot.editingNote === "string" ? shot.editingNote : undefined,
        transition: ["none", "fade", "black"].includes(shot.transition) ? shot.transition : undefined,
        lightingAtmo: shot.lightingAtmo,
        motivation: shot.motivation,
        characterIdsInShot,
        locationId: canonicalStoryboardAssetId(currentProject, "location", shot.locationId),
        propIds: enforceAssetScope
          ? canonicalStoryboardAssetIds(currentProject, "prop", shot.propIds)
          : filterVisiblePropIds(currentProject, shot, canonicalStoryboardAssetIds(currentProject, "prop", shot.propIds)),
        vehicleIds: canonicalStoryboardAssetIds(currentProject, "vehicles", shot.vehicleIds),
        dialogueLines,
        compositionData: shot.compositionData,
        imagePrompt: "",
        videoPrompt: "",
        visualSummary: "",
        generationMetadata: {
          timestamp: Date.now(),
          modelId: useAIConfigStore.getState().routing.storyboardGen,
          promptSummary: "generateShots",
        },
      };
    });
    return preserveAppearanceChoices(scene.shots || [], normalizeShotAppearances(currentProject!, scene, normalized, generatedShots, previousShots));
  };

  const buildShotAudioTracks = (scene: Scene, shots: Shot[]) => {
    const audioTracks: AudioTrack[] = [];
    let currentStartTime = 0;
    shots.forEach((shot, shotIndex) => {
      let dialogueOffset = 0;
      const dialogueLines = shot.dialogueLines || [];
      const dialogueDurations = allocateDialogueLineDurations(dialogueLines, shot.duration || 0);
      dialogueLines.forEach((line, lineIndex) => {
        const lineDuration = dialogueDurations[lineIndex] || 0;
        audioTracks.push({
          id: `audio-${scene.id}-${Date.now()}-${shotIndex}-${lineIndex}`,
          type: "dialogue",
          url: "",
          startTime: currentStartTime + dialogueOffset,
          duration: lineDuration,
          characterId: line.characterId,
          speakerName: line.speakerName,
          text: line.text,
          shotId: shot.id,
        });
        dialogueOffset += lineDuration;
      });
      currentStartTime += shot.duration || 0;
    });

    (scene.breakdown?.bgm || []).forEach((bgm, index) => {
      if (shots.some(shot => shot.directing?.soundCues.some(cue => cue.type === "bgm"))) return;
      if (!bgm.linkedAssetId) return;
      audioTracks.push({
        id: `bgm-${scene.id}-${Date.now()}-${index}`,
        type: "bgm",
        url: "",
        startTime: 0,
        duration: currentStartTime,
        text: bgm.prompt,
        linkedAssetId: bgm.linkedAssetId,
      });
    });
    return audioTracks;
  };

  const runManualShotAgentForScene = async ({
    scene,
    episode,
    confirmedPrompt,
    userConfirmedPrompt,
    metadata,
    sceneWorkflow,
    completedScenes,
    totalScenes,
    showDecision,
  }: {
    scene: Scene;
    episode: Episode;
    confirmedPrompt: string;
    userConfirmedPrompt?: string;
    metadata?: PromptEditorConfirmMetadata;
    sceneWorkflow: StoryboardBatchSceneContext;
    completedScenes: number;
    totalScenes: number;
    showDecision: boolean;
  }) => {
    const { project: requestProject, episode: requestEpisode, scene: requestScene } = readDirectorRequest(currentProject!, episode, scene);
    const requestDirectorHash = directorBindingHash(requestProject, { episode: requestEpisode, scene: requestScene });
    const executions: ManualStoryboardAgentExecutionAudit[] = [];
    const modelId = useAIConfigStore.getState().routing.storyboardGen;
    const targetDurationSeconds = scene.targetDuration
      ? scene.targetDuration * 60
      : activeEpisode?.targetDuration && totalScenes > 0
        ? activeEpisode.targetDuration * 60 / totalScenes
        : 60;
    const sourceContext = (await legacyProjectClient.getStoryboardTeamContext(currentProject!.id, episode.id, scene.id)).productionTeamContext;
    if (sourceContext === null) throw new Error("无法读取场次来源，请重试。");
    const promptContext = {
      sceneId: scene.id,
      sceneTitle: scene.title,
      script: scene.script || "",
      targetDurationSeconds,
      productionTeamContext: sourceContext,
      formalAssetContext: sceneWorkflow.manualAssetContext,
    };

    const executeModel = async <T,>(
      action: ManualStoryboardAgentExecutionAudit["action"],
      executionPrompt: string,
      schema: unknown,
    ) => {
      const startedAt = Date.now();
      try {
        const response = await generateAIContent({
          taskType: "storyboardGen",
          prompt: executionPrompt,
          requireJson: true,
          schema,
        });
        const parsed = safeParseAIResponse<T>(response, null as T);
        const execution: ManualStoryboardAgentExecutionAudit = {
          action,
          prompt: executionPrompt,
          promptHash: manualStoryboardHash(executionPrompt),
          modelId,
          status: "succeeded",
          resultHash: manualStoryboardHash(response),
          startedAt,
          completedAt: Date.now(),
        };
        executions.push(execution);
        return { parsed, execution };
      } catch (error) {
        executions.push({
          action,
          prompt: executionPrompt,
          promptHash: manualStoryboardHash(executionPrompt),
          modelId,
          status: "failed",
          startedAt,
          completedAt: Date.now(),
          error: summarizeUnknownError(error).message,
        });
        throw error;
      }
    };

    setAgentProgress({
      phase: "generating",
      label: "分镜 Agent 正在生成 Shot",
      sceneId: scene.id,
      sceneTitle: scene.title,
      attempt: 1,
      maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
    });

    const initial = await executeModel<unknown>("generate", upgradeDirectorPlanTemplate(confirmedPrompt), storyboardShotSchema);
    let rawShots = Array.isArray(initial.parsed)
      ? initial.parsed.filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
      : [];
    let shots = normalizeGeneratedShotPlan(scene, rawShots, true, appearanceSourceShots(episode, sourceContext));
    let direction = normalizeDirectorPlan({ project: requestProject, episode: requestEpisode, scene: requestScene, rawShots, shots });
    shots = direction.shots;
    let contractIssues = validateStoryboardShotContract({
      rawShots,
      normalizedShots: shots,
      targetDurationSeconds,
      enforceAssetScope: true,
      allowedAssetIds: sceneWorkflow.allowedAssetIds,
      allowedUnboundSpeakerNames: sceneLocalSpeakerNames(currentProject, scene),
      requireLocation: Boolean(scene.breakdown?.locationId),
      resolveAssetId: (type, value) => canonicalStoryboardAssetId(currentProject, type, value),
    });
    initial.execution.issueSummary = contractIssues.map((issue) => issue.message);

    let quality: ManualStoryboardAgentQuality | undefined;
    let bestAttempt: {
      rawShots: Array<Record<string, any>>;
      shots: Shot[];
      contractIssues: ReturnType<typeof validateStoryboardShotContract>;
      quality: ManualStoryboardAgentQuality;
      direction: ReturnType<typeof normalizeDirectorPlan>;
    } | undefined;
    let repairCount = 0;
    while (true) {
      if (contractIssues.length === 0) {
        setAgentProgress({
          phase: "checking",
          label: "独立质检 Agent 正在检查剧本覆盖、节奏与连续性",
          sceneId: scene.id,
          sceneTitle: scene.title,
          attempt: repairCount + 1,
          maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
          completedScenes,
          totalScenes,
        });
        const qualityPrompt = buildStoryboardShotQualityPrompt({ context: { ...promptContext, directorPlan: direction.plan }, shots });
        const qualityResult = await executeModel<unknown>("qa", qualityPrompt, storyboardShotQualitySchema);
        const shotQuality = normalizeStoryboardAgentQuality(qualityResult.parsed);
        const normalizedShotQuality = {
          ...shotQuality,
          issues: shotQuality.issues.map((issue) => ({
            ...issue,
            targetShotId: resolveStoryboardQualityTargetShotId(issue.targetShotId, shots),
          })),
        };
        qualityResult.execution.score = normalizedShotQuality.score;
        qualityResult.execution.verdict = normalizedShotQuality.verdict;
        qualityResult.execution.issueSummary = normalizedShotQuality.issues.map((issue) => issue.description);

        quality = normalizedShotQuality;
        if (!bestAttempt || quality.score > bestAttempt.quality.score) {
          bestAttempt = { rawShots, shots, contractIssues, quality, direction };
        }
        if (isStoryboardAgentQualityPassing(quality)) break;
      }

      if (repairCount >= STORYBOARD_AGENT_MAX_REPAIRS) break;
      if (quality && bestAttempt && bestAttempt.quality.score > quality.score) {
        rawShots = bestAttempt.rawShots;
        shots = bestAttempt.shots;
        contractIssues = bestAttempt.contractIssues;
        quality = bestAttempt.quality;
        direction = bestAttempt.direction;
      }
      repairCount += 1;
      setAgentProgress({
        phase: "repairing",
        label: quality
          ? `质检 ${quality.score} 分，分镜总监 Agent 正在自动修订`
          : "结构检查未通过，分镜总监 Agent 正在自动修订",
        sceneId: scene.id,
        sceneTitle: scene.title,
        attempt: repairCount + 1,
        maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
        completedScenes,
        totalScenes,
        score: quality?.score,
        issues: [
          ...contractIssues.map((issue) => issue.message),
          ...(quality?.issues || [])
            .filter((issue) => issue.severity !== "advisory")
            .map((issue) => issue.description),
        ],
      });
      const repairPrompt = buildStoryboardShotRepairPrompt({
        context: { ...promptContext, directorPlan: direction.plan },
        shots,
        contractIssues,
        quality,
      });
      const repair = await executeModel<unknown>("repair", repairPrompt, storyboardShotSchema);
      rawShots = Array.isArray(repair.parsed)
        ? repair.parsed.filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
        : [];
      shots = normalizeGeneratedShotPlan(scene, rawShots, true, appearanceSourceShots(episode, sourceContext));
      direction = normalizeDirectorPlan({ project: requestProject, episode: requestEpisode, scene: requestScene, rawShots, shots });
      shots = direction.shots;
      contractIssues = validateStoryboardShotContract({
        rawShots,
        normalizedShots: shots,
        targetDurationSeconds,
        enforceAssetScope: true,
        allowedAssetIds: sceneWorkflow.allowedAssetIds,
        allowedUnboundSpeakerNames: sceneLocalSpeakerNames(currentProject, scene),
      requireLocation: Boolean(scene.breakdown?.locationId),
        resolveAssetId: (type, value) => canonicalStoryboardAssetId(currentProject, type, value),
      });
      repair.execution.issueSummary = contractIssues.map((issue) => issue.message);
      quality = undefined;
    }

    if ((!quality || !isStoryboardAgentQualityPassing(quality)) && bestAttempt && (!quality || bestAttempt.quality.score > quality.score)) {
      rawShots = bestAttempt.rawShots;
      shots = bestAttempt.shots;
      contractIssues = bestAttempt.contractIssues;
      quality = bestAttempt.quality;
      direction = bestAttempt.direction;
    }

    const now = Date.now();
    const audit: ManualStoryboardPromptAudit = {
      action: "generate_shots",
      templateId: metadata?.templateId || "generateShots",
      promptHash: manualStoryboardHash(userConfirmedPrompt || confirmedPrompt),
      modelId,
      selectedSkillIds: metadata?.selectedSkillIds || [],
      selectedSkillTitles: metadata?.selectedSkillTitles || [],
      selectedContextIds: metadata?.selectedContextIds || [],
      createdAt: now,
      confirmedPrompt: userConfirmedPrompt || confirmedPrompt,
      promptExecutions: executions,
      agentQuality: quality,
    };
    const sourceHash = sceneWorkflow.sourceHash || manualStoryboardHash({ sceneId: scene.id, script: scene.script || "" });
    const candidateIssues: StoryboardReviewIssue[] = [
      ...contractIssues.map((issue) => ({ severity: issue.severity, message: issue.message })),
      ...(quality?.issues || [])
        .filter((issue) => issue.severity !== "advisory")
        .map((issue) => ({
          severity: issue.severity === "blocking" ? "blocking" as const : "warning" as const,
          message: issue.description,
        })),
    ];
    if (quality && quality.score < STORYBOARD_AGENT_QUALITY_THRESHOLD && candidateIssues.length === 0) {
      candidateIssues.push({
        severity: "warning",
        message: `独立质检得分 ${quality.score}，未达到 ${STORYBOARD_AGENT_QUALITY_THRESHOLD} 分通过线。`,
      });
    }
    const directedAudio = applyDirectorAudioPlan(shots, buildShotAudioTracks(scene, shots));
    candidateIssues.push(...[...direction.issues, ...directedAudio.issues].map(message => ({ severity: "warning" as const, message })));
    const candidate: StoryboardReviewCandidate = {
      kind: "shots",
      projectId: requestProject.id,
      directorPlan: direction.plan,
      directorBindingHash: requestDirectorHash,
      previousShotPlanHash: sceneShotPlanHash(requestScene),
      sceneId: scene.id,
      sceneTitle: scene.title,
      episodeId: episode.id,
      shots,
      audioTracks: directedAudio.tracks,
      appearanceHistory: appearanceSourceShots(episode, sourceContext),
      sourceHash,
      audit,
      issues: candidateIssues,
    };
    const disposition = resolveStoryboardCandidateDisposition(quality, contractIssues.length);

    if (disposition === "needs_author_decision") {
      setReviewCandidateState(candidate);
      setIsReviewCandidateOpen(showDecision);
      setAgentProgress({
        phase: "needs_decision",
        label: "Agent 多轮修订后仍未达标，需要创作者决策",
        sceneId: scene.id,
        sceneTitle: scene.title,
        attempt: repairCount + 1,
        maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
        completedScenes,
        totalScenes,
        score: quality?.score,
        issues: candidateIssues.map((issue) => issue.message),
      });
      return { passed: false, awaitingAdoption: false, candidate, quality };
    }

    setReviewCandidateState(candidate);
    setIsReviewCandidateOpen(showDecision);
    setAgentProgress({
      phase: "needs_decision",
      label: `分镜 Agent 已通过独立质检（${quality.score} 分），等待创作者采用`,
      sceneId: scene.id,
      sceneTitle: scene.title,
      attempt: repairCount + 1,
      maxAttempts: STORYBOARD_AGENT_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
      score: quality.score,
    });
    return { passed: true, awaitingAdoption: true, candidate, quality };
  };

  const handleGenerateSegmentShots = async (prompt: string, metadata?: PromptEditorConfirmMetadata) => {
    if (!currentProject || !activeEpisode || !workflowOptions.manualReview) return;
    const batchScenes = workflowOptions.batchScenes || [];
    if (!batchScenes.length) return;
    const pendingScenes = batchScenes.filter((item) => !item.shotPlanComplete);
    if (!pendingScenes.length) {
      setPromptModalState((previous) => ({ ...previous, isOpen: false }));
      toast.success("本段所有场次的 Shot 已通过独立质检。");
      return;
    }
    const blockedScene = pendingScenes.find((item) => !item.productionReady || !item.scene.script);
    if (blockedScene) {
      toast.error(`“${blockedScene.scene.title}”的剧本已变化，请刷新场次后重试。`);
      return;
    }

    setIsGenerating(true);
    setPromptModalState((previous) => ({ ...previous, isOpen: false }));
    setReviewCandidateState(null);
    setIsReviewCandidateOpen(false);
    let completedScenes = batchScenes.length - pendingScenes.length;
    try {
      for (const sceneWorkflow of pendingScenes) {
        const scene = sceneWorkflow.scene;
        const sceneExecutionPrompt = [
          prompt,
          [
            "【本次只执行一个场次】",
            `sceneId: ${scene.id}`,
            `sceneTitle: ${scene.title}`,
            `targetDurationSeconds: ${(scene.targetDuration || 1) * 60}`,
            scene.environment || scene.breakdown?.setting
              ? `environment: ${scene.environment || scene.breakdown?.setting}`
              : "",
            scene.timeOfDay || scene.breakdown?.time
              ? `timeOfDay: ${scene.timeOfDay || scene.breakdown?.time}`
              : "",
          ].filter(Boolean).join("\n"),
          `【本场完整剧本】\n${scene.script}`,
          sceneWorkflow.manualTeamContext
            ? `【本场原文与制作参考】\n${sceneWorkflow.manualTeamContext}`
            : "",
          sceneWorkflow.manualAssetContext
            ? `【本场正式资产与状态】\n${sceneWorkflow.manualAssetContext}`
            : "",
          "只返回这个场次的完整 Shot JSON 数组。不要返回其他场次，不要返回 scene 包装对象。",
        ].filter(Boolean).join("\n\n");
        const result = await runManualShotAgentForScene({
          scene,
          episode: activeEpisode,
          confirmedPrompt: sceneExecutionPrompt,
          userConfirmedPrompt: prompt,
          metadata,
          sceneWorkflow,
          completedScenes,
          totalScenes: batchScenes.length,
          showDecision: false,
        });
        if (result.awaitingAdoption) {
          setIsReviewCandidateOpen(true);
          toast.success(`“${scene.title}”已通过独立质检，批次暂停等待创作者采用。`, { duration: 7000 });
          return;
        }
        if (!result.passed) {
          setIsReviewCandidateOpen(true);
          toast.error(`“${scene.title}”多轮自动修订后仍未达标，批次已暂停。`, { duration: 7000 });
          return;
        }
        completedScenes += 1;
      }
      toast.success(`本段 ${batchScenes.length} 场 Shot 分镜已全部生成并通过独立质检。`);
    } catch (error) {
      console.error("Storyboard segment agent failed:", summarizeUnknownError(error));
      setAgentProgress((previous) => ({
        ...previous,
        phase: "failed",
        label: "整段分镜 Agent 执行失败",
        completedScenes,
        totalScenes: batchScenes.length,
        issues: [summarizeUnknownError(error).message],
      }));
      toast.error("整段分镜执行失败。", { duration: 7000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateShots = async (prompt: string, metadata?: PromptEditorConfirmMetadata) => {
    if (!activeScene || !activeEpisode) return;
    if (workflowOptions.manualReview && !workflowOptions.productionReady) {
      toast.error("当前场次来源已变化，请刷新场次后重试。");
      return;
    }
    if (workflowOptions.manualReview) {
      setIsGenerating(true);
      setPromptModalState((previous) => ({ ...previous, isOpen: false }));
      try {
        const result = await runManualShotAgentForScene({
          scene: activeScene,
          episode: activeEpisode,
          confirmedPrompt: prompt,
          metadata,
          sceneWorkflow: {
            scene: activeScene,
            productionReady: Boolean(workflowOptions.productionReady),
            shotPlanComplete: false,
            visualPromptReady: false,
            visualPromptComplete: false,
            sourceHash: workflowOptions.sourceHash || manualStoryboardHash({ sceneId: activeScene.id, script: activeScene.script || "" }),
            manualTeamContext: workflowOptions.manualTeamContext || "",
            manualAssetContext: workflowOptions.manualAssetContext || "",
            allowedAssetIds: workflowOptions.allowedAssetIds || { character: [], location: [], prop: [] },
          },
          completedScenes: 0,
          totalScenes: 1,
          showDecision: true,
        });
        if (result.passed) {
          toast.success(`Shot 分镜已通过独立质检（${result.quality?.score || 0} 分），请审阅后采用。`);
        } else {
          toast.error("Agent 多轮修订后仍未达标，请查看问题并决定。", { duration: 7000 });
        }
      } catch (error) {
        console.error("Storyboard shot agent failed:", summarizeUnknownError(error));
        setAgentProgress((previous) => ({
          ...previous,
          phase: "failed",
          label: "分镜 Agent 执行失败",
          issues: [summarizeUnknownError(error).message],
        }));
        toast.error(summarizeUnknownError(error).message || "生成分镜失败。");
      } finally {
        setIsGenerating(false);
      }
      return;
    }
    setIsGenerating(true);
    setPromptModalState(prev => ({ ...prev, isOpen: false }));
    try {
      const requestSnapshot = readDirectorRequest(currentProject!, activeEpisode, activeScene);
      const responseText = await generateAIContent({
        taskType: 'storyboardGen',
        prompt: upgradeDirectorPlanTemplate(prompt),
        requireJson: true,
        schema: storyboardShotSchema,
      });

      let generatedShots = safeParseAIResponse(responseText, [], (data: any[]) => {
        const warnings: string[] = [];
        let totalDuration = 0;
        data.forEach((s, i) => {
           if (s.duration) totalDuration += s.duration;
           if (s.characterIdsInShot) {
              s.characterIdsInShot.forEach((cid: string) => {
                 if (!resolveAssetRef(currentProject || undefined, "character", cid)) {
                    warnings.push(`镜头 ${i+1}: 引用了未知的角色ID (${cid})`);
                 }
              });
           }
           if (s.propIds) {
              s.propIds.forEach((pid: string) => {
                 if (!resolveAssetRef(currentProject || undefined, "prop", pid)) {
                    warnings.push(`镜头 ${i+1}: 引用了未知的道具ID (${pid})`);
                 }
                 if (resolveAssetRef(currentProject || undefined, "character", pid)) {
                    warnings.push(`镜头 ${i+1}: 将角色错当成了道具 (${pid})`);
                 }
              });
           }
           if (Array.isArray(s.dialogueLines)) {
              s.dialogueLines.forEach((line: any, lineIndex: number) => {
                 const hasFormalSpeaker = Boolean(resolveAssetRef(currentProject || undefined, "character", line?.characterId));
                 const hasSceneLocalSpeaker = !line?.characterId
                   && sceneLocalSpeakerNames(currentProject, activeScene).includes(String(line?.speakerName || "").trim());
                 if (line?.text && !hasFormalSpeaker && !hasSceneLocalSpeaker) {
                    warnings.push(`镜头 ${i+1} 台词 ${lineIndex+1}: 缺少有效正式角色 ID 或本场临时人物名称`);
                 }
              });
           }
        });
        if (activeScene.targetDuration && Math.abs(totalDuration - activeScene.targetDuration * 60) > 30) {
           warnings.push(`分镜总时长 (${totalDuration}s) 与目标时长 (${activeScene.targetDuration * 60}s) 偏差较大`);
        }
        return warnings;
      });
      const reviewIssues: StoryboardReviewIssue[] = [];
      if (!generatedShots.length) {
        reviewIssues.push({ severity: "blocking", message: "模型没有返回可采用的 Shot。" });
      }
      generatedShots.forEach((shot: any, index: number) => {
        if (!String(shot.visualAction || "").trim()) {
          reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 缺少可见动作。` });
        }
        if (!(Number(shot.duration) > 0)) {
          reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 缺少有效时长。` });
        }
        if (!String(shot.continuityNote || "").trim()) {
          reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 缺少轴线、视线和动作连续性说明。` });
        }
        if (!String(shot.blocking || "").trim() || !String(shot.composition || "").trim()) {
          reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 缺少可执行的调度或构图。` });
        }
        (shot.characterIdsInShot || []).forEach((id: string) => {
          const resolved = resolveAssetRef(currentProject || undefined, "character", id);
          if (!resolved) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了未知角色 ID：${id}` });
          } else if (workflowOptions.manualReview && !workflowOptions.allowedAssetIds?.character.includes(resolved.canonicalId)) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了不属于当前项目的角色：${id}` });
          }
        });
        (shot.propIds || []).forEach((id: string) => {
          const resolved = resolveAssetRef(currentProject || undefined, "prop", id);
          if (!resolved) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了未确认的道具 ID：${id}` });
          } else if (workflowOptions.manualReview && !workflowOptions.allowedAssetIds?.prop.includes(resolved.canonicalId)) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了不属于当前项目的道具：${id}` });
          }
        });
        if (shot.locationId) {
          const resolved = resolveAssetRef(currentProject || undefined, "location", shot.locationId);
          if (!resolved) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了未确认的场景 ID：${shot.locationId}` });
          } else if (workflowOptions.manualReview && !workflowOptions.allowedAssetIds?.location.includes(resolved.canonicalId)) {
            reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 引用了不属于当前项目的地点：${shot.locationId}` });
          }
        } else if (workflowOptions.manualReview && activeScene.breakdown?.locationId) {
          reviewIssues.push({ severity: "blocking", message: `Shot ${index + 1} 缺少当前场景地点 ID。` });
        }
      });
      
      let shotsWithIds: Shot[] = generatedShots.map(
        (s: any, idx: number) => {
          const dialogueLines = normalizeShotDialogueLines(currentProject, s);
          const rawDuration = Number(s.duration) > 0 ? Number(s.duration) : 3;

          const explicitCharacterIds = canonicalStoryboardAssetIds(currentProject, "character", s.characterIdsInShot);
          const characterIdsInShot = workflowOptions.manualReview
            ? Array.from(new Set(explicitCharacterIds))
            : filterVisibleCharacterIds(currentProject, s, Array.from(new Set([
                ...explicitCharacterIds,
                ...inferCharacterIdsFromShotText(currentProject, s),
              ])));

          return {
            id: Date.now().toString() + idx,
            duration: rawDuration,
            shotSize: s.shotSize,
            cameraAngle: s.cameraAngle,
            cameraMovement: s.cameraMovement,
            focalLength: s.focalLength,
            lighting: s.lighting,
            composition: s.composition,
            blocking: s.blocking,
            continuityNote: s.continuityNote,
            visualAction: s.visualAction,
            microExpression: s.microExpression,
            soundDesign: typeof s.soundDesign === "string" ? s.soundDesign : undefined,
            editingNote: typeof s.editingNote === "string" ? s.editingNote : undefined,
            transition: ["none", "fade", "black"].includes(s.transition) ? s.transition : undefined,
            lightingAtmo: s.lightingAtmo,
            motivation: s.motivation,
            characterIdsInShot,
            locationId: canonicalStoryboardAssetId(currentProject, "location", s.locationId),
            propIds: workflowOptions.manualReview
              ? canonicalStoryboardAssetIds(currentProject, "prop", s.propIds)
              : filterVisiblePropIds(currentProject, s, canonicalStoryboardAssetIds(currentProject, "prop", s.propIds)),
            vehicleIds: canonicalStoryboardAssetIds(currentProject, "vehicles", s.vehicleIds),
            dialogueLines,
            compositionData: s.compositionData,
            generationMetadata: {
              timestamp: Date.now(),
              modelId: useAIConfigStore.getState().routing.storyboardGen,
              promptSummary: "generateShots"
            }
          };
        }
      );

      const direction = normalizeDirectorPlan({ ...requestSnapshot, rawShots: generatedShots, shots: shotsWithIds });
      shotsWithIds = direction.shots;
      reviewIssues.push(...direction.issues.map(message => ({ severity: "warning" as const, message })));
      let currentStartTime = 0;
      const audioTracks: AudioTrack[] = [];
      generatedShots.forEach((s: any, idx: number) => {
        const shot = shotsWithIds[idx];
        const dialogueLines = shot.dialogueLines || [];
        const dialogueDurations = allocateDialogueLineDurations(dialogueLines, shot.duration || 0);
        let dialogueOffset = 0;
        dialogueLines.forEach((line: any, lineIdx: number) => {
          const lineDuration = dialogueDurations[lineIdx] || 0;
          audioTracks.push({
            id: 'audio-' + Date.now().toString() + idx + '-' + lineIdx,
            type: 'dialogue',
            url: '',
            startTime: currentStartTime + dialogueOffset,
            duration: lineDuration,
            characterId: line.characterId,
            text: line.text,
            shotId: shot.id,
          });
          dialogueOffset += lineDuration;
        });
        currentStartTime += shot.duration || s.duration || 0;
      });

      // Add BGM tracks from breakdown
      if (activeScene.breakdown?.bgm?.length && !shotsWithIds.some(shot => shot.directing?.soundCues.some(cue => cue.type === "bgm"))) {
        activeScene.breakdown.bgm.forEach((bgm, idx) => {
          if (bgm.linkedAssetId) {
            audioTracks.push({
              id: 'bgm-' + Date.now().toString() + idx,
              type: 'bgm',
              url: '', // Will be resolved by Studio.tsx using linkedAssetId
              startTime: 0,
              duration: currentStartTime, // BGM spans the whole scene by default
              text: bgm.prompt,
              linkedAssetId: bgm.linkedAssetId,
            });
          }
        });
      }

      const live = useProjectStore.getState();
      const latestScene = live.activeEpisode?.scenes.find(item => item.id === activeScene.id);
      const sourceChanged = !live.currentProject || live.currentProject.id !== currentProject!.id || live.activeEpisode?.id !== activeEpisode.id || !latestScene
        || directorPlanSourceHash(requestSnapshot.project, { episode: requestSnapshot.episode, scene: requestSnapshot.scene }, direction.plan?.assetIds || []) !== directorPlanSourceHash(live.currentProject, { episode: live.activeEpisode, scene: latestScene }, direction.plan?.assetIds || [])
        || sceneShotPlanHash(requestSnapshot.scene) !== sceneShotPlanHash(latestScene);
      if (workflowOptions.manualReview || sourceChanged) {
        const totalDuration = shotsWithIds.reduce((sum, shot) => sum + (shot.duration || 0), 0);
        const targetDuration = activeScene.targetDuration ? activeScene.targetDuration * 60 : 0;
        if (targetDuration && Math.abs(totalDuration - targetDuration) > Math.max(15, targetDuration * 0.2)) {
          reviewIssues.push({
            severity: "warning",
            message: `Shot 总时长 ${Math.round(totalDuration)} 秒，与本场目标 ${Math.round(targetDuration)} 秒偏差较大。`,
          });
        }
        const now = Date.now();
        setReviewCandidate({
          kind: "shots",
          projectId: requestSnapshot.project.id,
          sceneId: activeScene.id,
          sceneTitle: activeScene.title,
          episodeId: activeEpisode.id,
          shots: shotsWithIds,
          directorPlan: direction.plan,
          directorBindingHash: directorBindingHash(requestSnapshot.project, { episode: requestSnapshot.episode, scene: requestSnapshot.scene }),
          previousShotPlanHash: sceneShotPlanHash(requestSnapshot.scene),
          audioTracks: applyDirectorAudioPlan(shotsWithIds, audioTracks).tracks,
          sourceHash: workflowOptions.sourceHash || manualStoryboardHash({ sceneId: activeScene.id, script: activeScene.script || "" }),
          audit: {
            action: "generate_shots",
            templateId: "generateShots",
            promptHash: manualStoryboardHash(prompt),
            modelId: useAIConfigStore.getState().routing.storyboardGen,
            selectedSkillIds: metadata?.selectedSkillIds || [],
            selectedSkillTitles: metadata?.selectedSkillTitles || [],
            selectedContextIds: metadata?.selectedContextIds || [],
            createdAt: now,
          },
          issues: reviewIssues,
        });
        toast.success("Shot 草案已生成，请预览后采用。");
        return;
      }

      const directedAudio = applyDirectorAudioPlan(shotsWithIds, audioTracks);
      snapshotInteractiveNode(currentProject, activeScene.id, "AI 生成节点分镜前");
      await updateScene(activeScene.id, { shots: shotsWithIds, audioTracks: directedAudio.tracks, manualStoryboard: { ...(activeScene.manualStoryboard || {}), schemaVersion: "manual-storyboard.v1", directorPlan: direction.plan, updatedAt: Date.now() } }, activeEpisode.id, { expectedProjectId: currentProject!.id, archiveReplacedShots: true });
      if (direction.issues.length || directedAudio.issues.length) toast.error([...direction.issues, ...directedAudio.issues].join("；"));
      if (shotsWithIds.length > 0) {
        setActiveShotId(shotsWithIds[0].id);
      }
      toast.success("分镜生成成功！");
    } catch (error) {
      console.error("Storyboard shot generation failed:", summarizeUnknownError(error));
      toast.error(summarizeUnknownError(error).message || "生成分镜失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  const applyVisualPromptValues = (
    scene: Scene,
    prompts: Array<StoryboardImagePromptValue | StoryboardVideoPromptValue>,
    promptKind: "image" | "video",
  ) => {
    const promptByShotId = new Map(prompts.map((item) => [item.id, item]));
    return (scene.shots || []).map((shot) => {
      const promptData = promptByShotId.get(shot.id);
      if (!promptData) return shot;
      const imagePrompt = "imagePrompt" in promptData
        ? buildVisualPrompt({ ...shot, imagePrompt: promptData.imagePrompt }, currentProject, scene).imagePrompt
        : shot.imagePrompt;
      const videoPrompt = "videoPrompt" in promptData
        ? buildVisualPrompt({ ...shot, videoPrompt: promptData.videoPrompt }, currentProject, scene).videoPrompt
        : shot.videoPrompt;
      return {
        ...shot,
        ...(promptKind === "image" && "visualSummary" in promptData ? {
          visualSummary: promptData.visualSummary,
          imagePrompt,
          imagePromptAppearanceHash: appearanceContentHash(shot, "image"),
        } : { videoPrompt, videoPromptAppearanceHash: appearanceContentHash(shot, "video") }),
      };
    });
  };

  const mergePromptLayer = (
    currentShots: Shot[],
    generatedShots: Shot[],
    promptKind: "image" | "video",
  ) => {
    const generatedById = new Map(generatedShots.map((shot) => [shot.id, shot]));
    return currentShots.map((shot) => {
      const generated = generatedById.get(shot.id);
      if (!generated) return shot;
      return promptKind === "image"
        ? {
            ...shot,
            visualSummary: generated.visualSummary,
            imagePrompt: generated.imagePrompt,
            imagePromptAppearanceHash: generated.imagePromptAppearanceHash,
          }
        : {
            ...shot,
            videoPrompt: generated.videoPrompt,
            videoPromptAppearanceHash: generated.videoPromptAppearanceHash,
          };
    });
  };

  const runManualVisualPromptAgentForScene = async ({
    promptKind,
    scene,
    episode,
    confirmedPrompt,
    userConfirmedPrompt,
    metadata,
    sceneWorkflow,
    completedScenes,
    totalScenes,
    showDecision,
  }: {
    promptKind: "image" | "video";
    scene: Scene;
    episode: Episode;
    confirmedPrompt: string;
    userConfirmedPrompt?: string;
    metadata?: PromptEditorConfirmMetadata;
    sceneWorkflow: StoryboardBatchSceneContext;
    completedScenes: number;
    totalScenes: number;
    showDecision: boolean;
  }) => {
    const executions: ManualStoryboardAgentExecutionAudit[] = [];
    const generationModelId = useAIConfigStore.getState().routing.storyboardGen;
    const reviewModelId = useAIConfigStore.getState().routing.qcAnalyzer;
    const sourceContext = (await legacyProjectClient.getStoryboardTeamContext(currentProject!.id, episode.id, scene.id)).productionTeamContext;
    if (sourceContext === null) throw new Error("无法读取场次来源，请重试。");
    const promptContext = {
      sceneId: scene.id,
      sceneTitle: scene.title,
      script: scene.script || "",
      shots: scene.shots || [],
      productionTeamContext: projectDirectorMediaContext(sourceContext, currentProject!, { episode, scene }, promptKind),
      formalAssetContext: sceneWorkflow.manualAssetContext,
    };

    const executeModel = async <T,>(
      action: ManualStoryboardAgentExecutionAudit["action"],
      executionPrompt: string,
      schema: unknown,
    ) => {
      const startedAt = Date.now();
      const taskType = action === "qa" ? "qcAnalyzer" : "storyboardGen";
      const modelId = action === "qa" ? reviewModelId : generationModelId;
      try {
        const response = await generateAIContent({
          taskType,
          prompt: executionPrompt,
          requireJson: true,
          schema,
        });
        const parsed = safeParseAIResponse<T>(response, null as T);
        const execution: ManualStoryboardAgentExecutionAudit = {
          action,
          prompt: executionPrompt,
          promptHash: manualStoryboardHash(executionPrompt),
          modelId,
          status: "succeeded",
          resultHash: manualStoryboardHash(response),
          startedAt,
          completedAt: Date.now(),
        };
        executions.push(execution);
        return { parsed, execution };
      } catch (error) {
        executions.push({
          action,
          prompt: executionPrompt,
          promptHash: manualStoryboardHash(executionPrompt),
          modelId,
          status: "failed",
          startedAt,
          completedAt: Date.now(),
          error: summarizeUnknownError(error).message,
        });
        throw error;
      }
    };

    setAgentProgress({
      phase: "generating",
      label: promptKind === "image" ? "图片提示词 Agent 正在编译画面" : "视频提示词 Agent 正在编译动作与运镜",
      sceneId: scene.id,
      sceneTitle: scene.title,
      attempt: 1,
      maxAttempts: STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
    });

    const initial = await executeModel<unknown>(
      "generate",
      confirmedPrompt,
      promptKind === "image" ? storyboardImagePromptSchema : storyboardVideoPromptSchema,
    );
    let prompts: Array<StoryboardImagePromptValue | StoryboardVideoPromptValue> = promptKind === "image"
      ? normalizeStoryboardImagePrompts(initial.parsed)
      : normalizeStoryboardVideoPrompts(initial.parsed);
    let candidateShots = applyVisualPromptValues(scene, prompts, promptKind);
    let contractIssues = promptKind === "image"
      ? validateStoryboardImagePromptContract({ prompts: prompts as StoryboardImagePromptValue[], shots: scene.shots || [] })
      : validateStoryboardVideoPromptContract({ prompts: prompts as StoryboardVideoPromptValue[], shots: scene.shots || [] });
    initial.execution.issueSummary = contractIssues.map((issue) => issue.message);

    let quality: ManualStoryboardAgentQuality | undefined;
    let bestAttempt: {
      prompts: Array<StoryboardImagePromptValue | StoryboardVideoPromptValue>;
      candidateShots: Shot[];
      contractIssues: typeof contractIssues;
      quality: ManualStoryboardAgentQuality;
    } | undefined;
    let repairCount = 0;

    while (true) {
      if (contractIssues.length === 0) {
        setAgentProgress({
          phase: "checking",
          label: promptKind === "image" ? "独立质检正在检查构图、资产与光影" : "独立质检正在检查动作、运镜与时长",
          sceneId: scene.id,
          sceneTitle: scene.title,
          attempt: repairCount + 1,
          maxAttempts: STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS + 1,
          completedScenes,
          totalScenes,
        });
        const qualityResult = await executeModel<unknown>(
          "qa",
          promptKind === "image"
            ? buildStoryboardImagePromptQualityPrompt({ context: promptContext, candidateShots })
            : buildStoryboardVideoPromptQualityPrompt({ context: promptContext, candidateShots }),
          storyboardVisualPromptQualitySchema,
        );
        quality = normalizeStoryboardAgentQuality(qualityResult.parsed);
        quality = {
          ...quality,
          issues: quality.issues.map((issue) => ({
            ...issue,
            targetShotId: resolveStoryboardQualityTargetShotId(issue.targetShotId, candidateShots),
          })),
        };
        qualityResult.execution.score = quality.score;
        qualityResult.execution.verdict = quality.verdict;
        qualityResult.execution.issueSummary = quality.issues.map((issue) => issue.description);
        if (!bestAttempt || quality.score > bestAttempt.quality.score) {
          bestAttempt = { prompts, candidateShots, contractIssues, quality };
        }
        if (isStoryboardAgentQualityPassing(quality)) break;
      }

      if (repairCount >= STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS) break;
      if (quality && bestAttempt && bestAttempt.quality.score > quality.score) {
        prompts = bestAttempt.prompts;
        candidateShots = bestAttempt.candidateShots;
        contractIssues = bestAttempt.contractIssues;
        quality = bestAttempt.quality;
      }
      repairCount += 1;
      setAgentProgress({
        phase: "repairing",
        label: quality
          ? `${promptKind === "image" ? "图片" : "视频"}提示词质检 ${quality.score} 分，Agent 正在自动修订`
          : `${promptKind === "image" ? "图片" : "视频"}提示词结构未通过，Agent 正在自动修订`,
        sceneId: scene.id,
        sceneTitle: scene.title,
        attempt: repairCount + 1,
        maxAttempts: STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS + 1,
        completedScenes,
        totalScenes,
        score: quality?.score,
        issues: [
          ...contractIssues.map((issue) => issue.message),
          ...(quality?.issues || [])
            .filter((issue) => issue.severity !== "advisory")
            .map((issue) => issue.description),
        ],
      });
      const repair = await executeModel<unknown>(
        "repair",
        promptKind === "image"
          ? buildStoryboardImagePromptRepairPrompt({
              context: promptContext,
              values: prompts as StoryboardImagePromptValue[],
              contractIssues,
              quality,
            })
          : buildStoryboardVideoPromptRepairPrompt({
              context: promptContext,
              values: prompts as StoryboardVideoPromptValue[],
              contractIssues,
              quality,
            }),
        promptKind === "image" ? storyboardImagePromptSchema : storyboardVideoPromptSchema,
      );
      const repairedPrompts: Array<StoryboardImagePromptValue | StoryboardVideoPromptValue> = promptKind === "image"
        ? normalizeStoryboardImagePrompts(repair.parsed)
        : normalizeStoryboardVideoPrompts(repair.parsed);
      const expectedShotIds = new Set((scene.shots || []).map((shot) => shot.id));
      const repairedByShotId = new Map(repairedPrompts
        .filter((item) => expectedShotIds.has(item.id))
        .map((item) => [item.id, item]));
      const currentByShotId = new Map(prompts
        .filter((item) => expectedShotIds.has(item.id))
        .map((item) => [item.id, item]));
      prompts = (scene.shots || [])
        .map((shot) => repairedByShotId.get(shot.id) || currentByShotId.get(shot.id))
        .filter((item): item is StoryboardImagePromptValue | StoryboardVideoPromptValue => Boolean(item));
      candidateShots = applyVisualPromptValues(scene, prompts, promptKind);
      contractIssues = promptKind === "image"
        ? validateStoryboardImagePromptContract({ prompts: prompts as StoryboardImagePromptValue[], shots: scene.shots || [] })
        : validateStoryboardVideoPromptContract({ prompts: prompts as StoryboardVideoPromptValue[], shots: scene.shots || [] });
      repair.execution.issueSummary = contractIssues.map((issue) => issue.message);
      quality = undefined;
    }

    if ((!quality || !isStoryboardAgentQualityPassing(quality)) && bestAttempt && (!quality || bestAttempt.quality.score > quality.score)) {
      prompts = bestAttempt.prompts;
      candidateShots = bestAttempt.candidateShots;
      contractIssues = bestAttempt.contractIssues;
      quality = bestAttempt.quality;
    }

    const now = Date.now();
    const sourceHash = buildManualVisualPromptSourceHash(sceneWorkflow.sourceHash, scene.shots || []);
    const audit: ManualStoryboardPromptAudit = {
      action: promptKind === "image" ? "generate_image_prompts" : "generate_video_prompts",
      templateId: metadata?.templateId || (promptKind === "image" ? "generateImagePrompts" : "generateVideoPrompts"),
      promptHash: manualStoryboardHash(userConfirmedPrompt || confirmedPrompt),
      modelId: generationModelId,
      selectedSkillIds: metadata?.selectedSkillIds || [],
      selectedSkillTitles: metadata?.selectedSkillTitles || [],
      selectedContextIds: metadata?.selectedContextIds || [],
      createdAt: now,
      confirmedPrompt: userConfirmedPrompt || confirmedPrompt,
      promptExecutions: executions,
      agentQuality: quality,
    };
    const candidateIssues: StoryboardReviewIssue[] = [
      ...contractIssues.map((issue) => ({ severity: issue.severity, message: issue.message })),
      ...(quality?.issues || [])
        .filter((issue) => issue.severity !== "advisory")
        .map((issue) => ({
          severity: issue.severity === "blocking" ? "blocking" as const : "warning" as const,
          message: issue.description,
        })),
    ];
    if (quality && quality.score < STORYBOARD_AGENT_QUALITY_THRESHOLD && candidateIssues.length === 0) {
      candidateIssues.push({
        severity: "warning",
        message: `独立质检得分 ${quality.score}，未达到 ${STORYBOARD_AGENT_QUALITY_THRESHOLD} 分通过线。`,
      });
    }
    const candidate: StoryboardReviewCandidate = {
      kind: promptKind === "image" ? "image_prompts" : "video_prompts",
      sceneId: scene.id,
      sceneTitle: scene.title,
      episodeId: episode.id,
      shots: candidateShots,
      sourceHash,
      audit,
      issues: candidateIssues,
    };
    const disposition = resolveStoryboardCandidateDisposition(quality, contractIssues.length);

    if (disposition === "needs_author_decision") {
      setReviewCandidateState(candidate);
      setIsReviewCandidateOpen(showDecision);
      setAgentProgress({
        phase: "needs_decision",
        label: `${promptKind === "image" ? "图片" : "视频"}提示词多轮修订后仍未达标，需要创作者决策`,
        sceneId: scene.id,
        sceneTitle: scene.title,
        attempt: repairCount + 1,
        maxAttempts: STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS + 1,
        completedScenes,
        totalScenes,
        score: quality?.score,
        issues: candidateIssues.map((issue) => issue.message),
      });
      return { passed: false, awaitingAdoption: false, candidate, quality };
    }

    setReviewCandidateState(candidate);
    setIsReviewCandidateOpen(showDecision);
    setAgentProgress({
      phase: "needs_decision",
      label: `${promptKind === "image" ? "图片" : "视频"}提示词已通过独立质检（${quality.score} 分），等待创作者采用`,
      sceneId: scene.id,
      sceneTitle: scene.title,
      attempt: repairCount + 1,
      maxAttempts: STORYBOARD_VISUAL_PROMPT_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
      score: quality.score,
    });
    return { passed: true, awaitingAdoption: true, candidate, quality };
  };

  const handlePrepareGeneratePrompts = async (promptKind: "image" | "video", episode?: Episode, scene?: Scene) => {
    if (!activeScene || !activeScene.shots || activeScene.shots.length === 0 || isGenerating || !currentProject) return;
    const promptReady = promptKind === "image"
      ? workflowOptions.imagePromptReady
      : workflowOptions.videoPromptReady;
    if (workflowOptions.manualReview && !promptReady) {
      toast.error(`分镜尚未生成、确认或已经过期，暂不能生成${promptKind === "image" ? "图片" : "视频"}提示词。`);
      return;
    }

    const stylePrompt = resolveCreativeVisionVisualFallback(currentProject);
    const shotsData = activeScene.shots.map((shot) => projectShotForVisualPrompt(currentProject, shot, promptKind, activeEpisode || undefined, activeScene));

    // Gather all asset IDs from shots
    const characterIds = new Set<string>();
    const locationIds = new Set<string>();
    const propIds = new Set<string>();

    activeScene.shots.forEach(s => {
      s.characterIdsInShot?.forEach(id => characterIds.add(id));
      if (s.locationId) locationIds.add(s.locationId);
      s.propIds?.forEach(id => propIds.add(id));
    });

    // Build asset descriptions
    const assetDescriptions: string[] = [];
    const variantMap = activeScene.breakdown?.assetVariantMap || {};

    // Characters
    currentProject.characters?.forEach(c => {
      if (characterIds.has(c.id)) {
        let desc = c.visualIdentity || "";
        const variantId = variantMap[c.id] || variantMap[`character_${c.id}`];
        if (variantId && variantId !== 'default' && c.variants) {
          const variant = c.variants.find(v => v.id === variantId);
          if (variant) {
            desc += ` [状态: ${variant.name}] ${variant.description || ''} ${variant.promptModifiers || ''}`;
          }
        }
        if (desc) {
          assetDescriptions.push(`[角色] ${c.name}: ${desc}`);
        }
      }
    });

    // Locations
    collectProjectAssetsForContext(currentProject, 'location').forEach(l => {
      if (locationIds.has(l.id)) {
        let desc = l.description || "";
        const variantId = variantMap[l.id] || variantMap[`location_${l.id}`];
        if (variantId && variantId !== 'default' && l.variants) {
          const variant = l.variants.find(v => v.id === variantId);
          if (variant) {
            desc += ` [状态: ${variant.name}] ${variant.description || ''} ${variant.promptModifiers || ''}`;
          }
        }
        if (desc) {
          assetDescriptions.push(`[场景] ${l.name}: ${desc}`);
        }
      }
    });

    // Props
    collectProjectAssetsForContext(currentProject, 'prop').forEach(p => {
      if (propIds.has(p.id)) {
        let desc = p.description || "";
        const variantId = variantMap[p.id] || variantMap[`prop_${p.id}`];
        if (variantId && variantId !== 'default' && p.variants) {
          const variant = p.variants.find(v => v.id === variantId);
          if (variant) {
            desc += ` [状态: ${variant.name}] ${variant.description || ''} ${variant.promptModifiers || ''}`;
          }
        }
        if (desc) {
          assetDescriptions.push(`[道具] ${p.name}: ${desc}`);
        }
      }
    });

    const assetDescriptionsText = workflowOptions.manualReview && workflowOptions.manualAssetContext
      ? workflowOptions.manualAssetContext
      : assetDescriptions.length > 0
        ? assetDescriptions.join('\n')
        : "";

    const templateId = promptKind === "image" ? "generateImagePrompts" : "generateVideoPrompts";
    const sceneEnvironment = meaningfulStoryboardPromptValue(activeScene.environment, activeScene.breakdown?.setting);
    const sceneTime = meaningfulStoryboardPromptValue(activeScene.timeOfDay, activeScene.breakdown?.time);

    setPromptModalState({
      isOpen: true,
      templateId,
      variables: {
        ...(promptKind === "image"
          ? { creativeVision: stylePrompt, productionTeamContext: "" }
          : {}),
        environment: sceneEnvironment,
        timeOfDay: sceneTime,
        scenePhysicalContext: [
          sceneEnvironment ? `空间：${sceneEnvironment}` : "",
          sceneTime ? `时间：${sceneTime}` : "",
        ].filter(Boolean).join("；"),
        assetDescriptions: assetDescriptionsText,
        shotsData: JSON.stringify(shotsData, null, 2),
      },
      contextOptions: [],
      defaultSelectedContextIds: [],
      onConfirm: (finalPrompt, _userIntent, metadata) => handleGeneratePrompts(finalPrompt, metadata, promptKind)
    });
  };

  const buildSingleShotAssetDescriptions = (shot: Shot) => {
    if (!currentProject || !activeScene) return "";
    const variantMap = activeScene.breakdown?.assetVariantMap || {};
    const lines: string[] = [];
    const cleanDescription = (...parts: Array<string | undefined>) => parts
      .flatMap((part) => String(part || "").split(/[；。\n]/))
      .map((part) => part.trim())
      .filter((part) => part && !/(?:\{\{[^}]+\}\}|未设置|暂无|待补全|待确认|从已采用的制片场次拆解登记|基础视觉身份待)/.test(part))
      .join("；");

    currentProject.characters
      .filter((character) => (shot.characterIdsInShot || []).includes(character.id))
      .forEach((character) => {
        const variantId = variantMap[character.id] || variantMap[`character_${character.id}`];
        const variant = variantId && variantId !== "default"
          ? character.variants?.find((item) => item.id === variantId)
          : undefined;
        const description = cleanDescription(
          character.visualIdentity,
          variant?.name ? `状态：${variant.name}` : "",
          variant?.description,
          variant?.promptModifiers,
        );
        if (description) lines.push(`[角色] ${character.name}：${description}`);
      });

    collectProjectAssetsForContext(currentProject, "location")
      .filter((asset) => asset.id === shot.locationId)
      .forEach((asset) => {
        const variantId = variantMap[asset.id] || variantMap[`location_${asset.id}`];
        const variant = variantId && variantId !== "default"
          ? asset.variants?.find((item) => item.id === variantId)
          : undefined;
        const description = cleanDescription(
          asset.description,
          variant?.name ? `状态：${variant.name}` : "",
          variant?.description,
          variant?.promptModifiers,
        );
        if (description) lines.push(`[场景] ${asset.name}：${description}`);
      });

    collectProjectAssetsForContext(currentProject, "prop")
      .filter((asset) => (shot.propIds || []).includes(asset.id))
      .forEach((asset) => {
        const variantId = variantMap[asset.id] || variantMap[`prop_${asset.id}`];
        const variant = variantId && variantId !== "default"
          ? asset.variants?.find((item) => item.id === variantId)
          : undefined;
        const description = cleanDescription(
          asset.description,
          variant?.name ? `状态：${variant.name}` : "",
          variant?.description,
          variant?.promptModifiers,
        );
        if (description) lines.push(`[道具] ${asset.name}：${description}`);
      });

    return lines.join("\n");
  };

  const buildSingleShotPromptVariables = (shot: Shot, promptKind: "image" | "video", episode?: Episode, scene?: Scene) => {
    if (!currentProject || !activeScene) return {};
    const sceneEnvironment = meaningfulStoryboardPromptValue(activeScene.environment, activeScene.breakdown?.setting);
    const sceneTime = meaningfulStoryboardPromptValue(activeScene.timeOfDay, activeScene.breakdown?.time);
    return {
      ...(promptKind === "image"
        ? { creativeVision: resolveCreativeVisionVisualFallback(currentProject) }
        : {}),
      environment: sceneEnvironment,
      timeOfDay: sceneTime,
      scenePhysicalContext: [
        sceneEnvironment ? `空间：${sceneEnvironment}` : "",
        sceneTime ? `时间：${sceneTime}` : "",
      ].filter(Boolean).join("；"),
      assetDescriptions: buildSingleShotAssetDescriptions(shot),
      productionTeamContext: "",
      shotsData: JSON.stringify([projectShotForVisualPrompt(currentProject, shot, promptKind, activeEpisode || undefined, activeScene)], null, 2),
    };
  };

  const handlePrepareGenerateShotPrompt = (shotId: string, promptKind: "image" | "video", episode?: Episode, scene?: Scene) => {
    if (!activeScene || !currentProject || isGenerating) return;
    const shot = activeScene.shots?.find((item) => item.id === shotId);
    if (!shot) {
      toast.error("找不到当前分镜。");
      return;
    }
    const promptLabel = promptKind === "image" ? "图片提示词" : "视频提示词";
    const templateId = promptKind === "image" ? "generateImagePrompts" : "generateVideoPrompts";
    setPromptModalState({
      isOpen: true,
      templateId,
      title: `${shot[promptKind === "image" ? "imagePrompt" : "videoPrompt"] ? "重新生成" : "生成"}此镜头${promptLabel}`,
      variables: buildSingleShotPromptVariables(shot, promptKind),
      contextOptions: [],
      defaultSelectedContextIds: [],
      onConfirm: (finalPrompt, _userIntent, metadata) =>
        handleGenerateShotPrompt(shotId, finalPrompt, metadata, promptKind),
    });
  };

  const requestSingleShotPrompt = async (
    shot: Shot,
    prompt: string,
    promptKind: "image" | "video",
  ) => {
    if (!activeScene) throw new Error("找不到当前场次。");
    const responseText = await generateAIContent({
      taskType: "storyboardGen",
      prompt,
      requireJson: true,
      schema: promptKind === "image" ? storyboardImagePromptSchema : storyboardVideoPromptSchema,
    });
    const raw = safeParseAIResponse<unknown[]>(responseText, []);
    const generatedPrompts = promptKind === "image"
      ? normalizeStoryboardImagePrompts(raw)
      : normalizeStoryboardVideoPrompts(raw);
    const contractIssues = promptKind === "image"
      ? validateStoryboardImagePromptContract({
          prompts: generatedPrompts as StoryboardImagePromptValue[],
          shots: [shot],
        })
      : validateStoryboardVideoPromptContract({
          prompts: generatedPrompts as StoryboardVideoPromptValue[],
          shots: [shot],
        });
    const blockingIssue = contractIssues.find((issue) => issue.severity === "blocking");
    if (blockingIssue) throw new Error(blockingIssue.message);
    const updatedTarget = applyVisualPromptValues(
      { ...activeScene, shots: [shot] },
      generatedPrompts,
      promptKind,
    )[0];
    if (!updatedTarget) throw new Error("模型没有返回当前分镜的提示词。");
    return updatedTarget;
  };

  const handleGenerateShotPrompt = async (
    shotId: string,
    prompt: string,
    metadata: PromptEditorConfirmMetadata | undefined,
    promptKind: "image" | "video",
  ) => {
    if (!activeScene || !activeEpisode || !currentProject || generatingShotPrompt) return;
    const shot = activeScene.shots?.find((item) => item.id === shotId);
    if (!shot) return;
    setIsGenerating(true);
    setGeneratingShotPrompt({ shotId, kind: promptKind });
    setPromptModalState((previous) => ({ ...previous, isOpen: false }));
    try {
      const updatedTarget = await requestSingleShotPrompt(shot, prompt, promptKind);
      const updatedShots = (activeScene.shots || []).map((item) =>
        item.id === shotId ? { ...item, ...updatedTarget } : item);
      const canRebase = workflowOptions.manualReview
        && workflowOptions.sourceHash
        && canRebaseManualStoryboardAuthorEdit(activeScene.manualStoryboard, workflowOptions.sourceHash);
      const manualStoryboard = canRebase && workflowOptions.sourceHash
        ? rebaseManualStoryboardAfterAuthorEdit({
            workspace: activeScene.manualStoryboard,
            shots: updatedShots,
            sourceHash: workflowOptions.sourceHash,
            confirmShotPlan: false,
            confirmImagePrompts: promptKind === "image",
            confirmVideoPrompts: promptKind === "video",
          })
        : activeScene.manualStoryboard;
      snapshotInteractiveNode(currentProject, activeScene.id, `AI 单独生成镜头${promptKind === "image" ? "图片" : "视频"}提示词前`);
      updateScene(activeScene.id, {
        shots: updatedShots,
        ...(manualStoryboard ? { manualStoryboard } : {}),
      }, activeEpisode.id);
      toast.success(`当前镜头${promptKind === "image" ? "图片" : "视频"}提示词已生成。`);
    } catch (error) {
      console.error("Single-shot prompt generation failed:", summarizeUnknownError(error));
      toast.error(error instanceof Error ? error.message : "当前镜头提示词生成失败。");
    } finally {
      setGeneratingShotPrompt(null);
      setIsGenerating(false);
    }
  };

  const handlePrepareGenerateSegmentPrompts = async (promptKind: "image" | "video", episode?: Episode, scene?: Scene) => {
    if (!currentProject || !activeEpisode || isGenerating || !workflowOptions.manualReview) return;
    const batchScenes = workflowOptions.batchScenes || [];
    const pendingScenes = batchScenes.filter((item) => promptKind === "image"
      ? !item.imagePromptComplete
      : !item.videoPromptComplete);
    if (!pendingScenes.length) {
      toast.success(`本段所有场次的${promptKind === "image" ? "图片" : "视频"}提示词已通过独立质检。`);
      return;
    }
    const blockedScene = pendingScenes.find((item) => !(promptKind === "image"
      ? item.imagePromptReady
      : item.videoPromptReady) || !item.scene.shots?.length);
    if (blockedScene) {
      toast.error(`“${blockedScene.scene.title}”的分镜尚未生成、确认或已经过期。`);
      return;
    }

    const templateId = promptKind === "image" ? "generateImagePrompts" : "generateVideoPrompts";
    setPromptModalState({
      isOpen: true,
      templateId,
      variables: {
        ...(promptKind === "image"
          ? { creativeVision: resolveCreativeVisionVisualFallback(currentProject) }
          : {}),
        environment: "",
        timeOfDay: "",
        scenePhysicalContext: "",
        assetDescriptions: "",
        shotsData: "",
        productionTeamContext: "",
      },
      contextOptions: [],
      defaultSelectedContextIds: [],
      onConfirm: (finalPrompt, _userIntent, metadata) => handleGenerateSegmentPrompts(finalPrompt, metadata, promptKind),
    });
  };

  const handleGenerateSegmentPrompts = async (
    prompt: string,
    metadata: PromptEditorConfirmMetadata | undefined,
    promptKind: "image" | "video",
  ) => {
    if (!currentProject || !activeEpisode || !workflowOptions.manualReview) return;
    const batchScenes = workflowOptions.batchScenes || [];
    const pendingScenes = batchScenes.filter((item) => promptKind === "image"
      ? !item.imagePromptComplete
      : !item.videoPromptComplete);
    if (!pendingScenes.length) {
      setPromptModalState((previous) => ({ ...previous, isOpen: false }));
      toast.success(`本段所有场次的${promptKind === "image" ? "图片" : "视频"}提示词已通过独立质检。`);
      return;
    }
    const blockedScene = pendingScenes.find((item) => !(promptKind === "image"
      ? item.imagePromptReady
      : item.videoPromptReady) || !item.scene.shots?.length);
    if (blockedScene) {
      toast.error(`“${blockedScene.scene.title}”的上游状态已变化，请重新确认 Shot 和正式资产。`);
      return;
    }

    setIsGenerating(true);
    setPromptModalState((previous) => ({ ...previous, isOpen: false }));
    setReviewCandidateState(null);
    setIsReviewCandidateOpen(false);
    let completedScenes = batchScenes.length - pendingScenes.length;
    try {
      for (const sceneWorkflow of pendingScenes) {
        const scene = sceneWorkflow.scene;
        const physicalContext = [
          scene.environment || scene.breakdown?.setting
            ? `空间：${scene.environment || scene.breakdown?.setting}`
            : "",
          scene.timeOfDay || scene.breakdown?.time
            ? `时间：${scene.timeOfDay || scene.breakdown?.time}`
            : "",
        ].filter(Boolean).join("；");
        const shotProjection = (scene.shots || []).map((shot) =>
          projectShotForVisualPrompt(currentProject, shot, promptKind, activeEpisode || undefined, activeScene));
        const sceneExecutionPrompt = [
          prompt,
          `【本次只执行一个场次】\nsceneId: ${scene.id}\nsceneTitle: ${scene.title}`,
          physicalContext ? `【场景物理属性】\n${physicalContext}` : "",
          `【本场已确认 Shot】\n${JSON.stringify(shotProjection, null, 2)}`,
          sceneWorkflow.manualAssetContext
            ? `【本场正式资产、变体与参考板】\n${sceneWorkflow.manualAssetContext}`
            : "",
          `只返回这个场次全部 Shot 的${promptKind === "image" ? "图片" : "视频"}提示词 JSON 数组。必须逐一沿用上述 Shot 的原始 id，不要返回其他场次，不要返回 scene 包装对象。`,
        ].filter(Boolean).join("\n\n");
        const result = await runManualVisualPromptAgentForScene({
          promptKind,
          scene,
          episode: activeEpisode,
          confirmedPrompt: sceneExecutionPrompt,
          userConfirmedPrompt: prompt,
          metadata,
          sceneWorkflow,
          completedScenes,
          totalScenes: batchScenes.length,
          showDecision: false,
        });
        if (result.awaitingAdoption) {
          setIsReviewCandidateOpen(true);
          toast.success(`“${scene.title}”的${promptKind === "image" ? "图片" : "视频"}提示词已通过独立质检，批次暂停等待创作者采用。`, { duration: 7000 });
          return;
        }
        if (!result.passed) {
          setIsReviewCandidateOpen(true);
          toast.error(`“${scene.title}”的${promptKind === "image" ? "图片" : "视频"}提示词多轮修订后仍未达标，批次已暂停。`, { duration: 7000 });
          return;
        }
        completedScenes += 1;
      }
      toast.success(`本段 ${batchScenes.length} 场${promptKind === "image" ? "图片" : "视频"}提示词已全部生成并通过独立质检。`);
    } catch (error) {
      console.error("Storyboard segment visual prompt agent failed:", summarizeUnknownError(error));
      setAgentProgress((previous) => ({
        ...previous,
        phase: "failed",
        label: `整段${promptKind === "image" ? "图片" : "视频"}提示词 Agent 执行失败`,
        completedScenes,
        totalScenes: batchScenes.length,
        issues: [summarizeUnknownError(error).message],
      }));
      toast.error(`整段${promptKind === "image" ? "图片" : "视频"}提示词执行失败。`, { duration: 7000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGeneratePrompts = async (
    prompt: string,
    metadata: PromptEditorConfirmMetadata | undefined,
    promptKind: "image" | "video",
  ) => {
    if (!activeScene || !activeEpisode || !currentProject) return;
    const promptReady = promptKind === "image"
      ? workflowOptions.imagePromptReady
      : workflowOptions.videoPromptReady;
    if (workflowOptions.manualReview && !promptReady) {
      toast.error(`分镜尚未生成、确认或已经过期，暂不能生成${promptKind === "image" ? "图片" : "视频"}提示词。`);
      return;
    }
    if (workflowOptions.manualReview) {
      setIsGenerating(true);
      setPromptModalState((previous) => ({ ...previous, isOpen: false }));
      try {
        const result = await runManualVisualPromptAgentForScene({
          promptKind,
          scene: activeScene,
          episode: activeEpisode,
          confirmedPrompt: prompt,
          metadata,
          sceneWorkflow: {
            scene: activeScene,
            productionReady: Boolean(workflowOptions.productionReady),
            shotPlanComplete: true,
            visualPromptReady: Boolean(promptReady),
            visualPromptComplete: false,
            imagePromptReady: Boolean(workflowOptions.imagePromptReady),
            imagePromptComplete: false,
            videoPromptReady: Boolean(workflowOptions.videoPromptReady),
            videoPromptComplete: false,
            sourceHash: workflowOptions.sourceHash || manualStoryboardHash({ sceneId: activeScene.id, script: activeScene.script || "" }),
            manualTeamContext: workflowOptions.manualTeamContext || "",
            manualAssetContext: workflowOptions.manualAssetContext || "",
            allowedAssetIds: workflowOptions.allowedAssetIds || { character: [], location: [], prop: [] },
          },
          completedScenes: 0,
          totalScenes: 1,
          showDecision: true,
        });
        if (result.passed) {
          toast.success(`${promptKind === "image" ? "图片" : "视频"}提示词已通过独立质检（${result.quality?.score || 0} 分），请审阅后采用。`);
        } else {
          toast.error(`${promptKind === "image" ? "图片" : "视频"}提示词 Agent 多轮修订后仍未达标，请查看问题并决定。`, { duration: 7000 });
        }
      } catch (error) {
        console.error("Storyboard prompt agent failed:", summarizeUnknownError(error));
        setAgentProgress((previous) => ({
          ...previous,
          phase: "failed",
          label: `${promptKind === "image" ? "图片" : "视频"}提示词 Agent 执行失败`,
          issues: [summarizeUnknownError(error).message],
        }));
        toast.error(`生成${promptKind === "image" ? "图片" : "视频"}提示词失败。`);
      } finally {
        setIsGenerating(false);
      }
      return;
    }
    setIsGenerating(true);
    setPromptModalState(prev => ({ ...prev, isOpen: false }));
    try {
      const responseText = await generateAIContent({
        taskType: 'storyboardGen',
        prompt,
        requireJson: true,
        schema: promptKind === "image" ? storyboardImagePromptSchema : storyboardVideoPromptSchema,
      });
      const raw = safeParseAIResponse<unknown[]>(responseText, []);
      const generatedPrompts = promptKind === "image"
        ? normalizeStoryboardImagePrompts(raw)
        : normalizeStoryboardVideoPrompts(raw);
      const contractIssues = promptKind === "image"
        ? validateStoryboardImagePromptContract({ prompts: generatedPrompts as StoryboardImagePromptValue[], shots: activeScene.shots })
        : validateStoryboardVideoPromptContract({ prompts: generatedPrompts as StoryboardVideoPromptValue[], shots: activeScene.shots });
      const blockingIssue = contractIssues.find((issue) => issue.severity === "blocking");
      if (blockingIssue) throw new Error(blockingIssue.message);
      const updatedShots = applyVisualPromptValues(activeScene, generatedPrompts, promptKind);
      snapshotInteractiveNode(currentProject, activeScene.id, `AI 生成节点${promptKind === "image" ? "图片" : "视频"}提示词前`);
      updateScene(activeScene.id, { shots: updatedShots }, activeEpisode.id);
      toast.success(`${promptKind === "image" ? "图片" : "视频"}提示词生成成功！`);
    } catch (error) {
      console.error("Storyboard prompt generation failed:", summarizeUnknownError(error));
      toast.error(`生成${promptKind === "image" ? "图片" : "视频"}提示词失败。`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRerollShot = async (shotId: string) => {
    const shotToReroll = activeScene?.shots?.find(s => s.id === shotId);
    if (!shotToReroll || !activeScene || !activeEpisode || !currentProject) return;

    if (generatingShotImageId) {
      toast("请等当前分镜画面生成完成后再操作。", { id: "storyboard-shot-image-busy" });
      return;
    }

    if (!shotToReroll.imagePrompt) {
      toast.error("请先生成视觉提示词", { id: `reroll-${shotId}` });
      return;
    }

    try {
      const context = await resolveManualTeamContext();
      requireAppearanceReady(currentProject, activeScene, [shotToReroll], appearanceSourceShots(activeEpisode, context || ""), 'image');
    } catch (error) { toast.error(error instanceof Error ? error.message : '请复核外观状态'); return; }
    const variantMap = activeScene.breakdown?.assetVariantMap || {};
    const imageReferences = resolveShotImageReferences({
      project: currentProject,
      shot: shotToReroll,
      manualAssetBoards: workflowOptions.manualAssetBoards,
      variantMap,
    });
    let imageVisualStyleProjection: ImageVisualStyleProjection;
    try {
      const projectionContext = resolveImageVisualStyleProjectionContext({
        project: currentProject,
        shots: [shotToReroll],
      });
      imageVisualStyleProjection = buildImageVisualStyleProjection({
        project: currentProject,
        intent: "final_frame",
        ...projectionContext,
        shotOverride: shotToReroll.visualOverride,
          creativeScope: { episode: activeEpisode || undefined, scene: activeScene, shot: shotToReroll },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "当前视觉规范无法投影到分镜画面，请先复核项目视觉规范。");
      return;
    }
    setPromptModalState({
      isOpen: true,
      templateId: "generateImage",
      variables: {
        imagePrompt: [shotToReroll.imagePrompt, appearancePrompt(shotToReroll, "image")].filter(Boolean).join("\n\n"),
      },
      contextOptions: [],
      defaultSelectedContextIds: [],
      imageReferences,
      defaultSelectedImageReferenceIds: imageReferences.map((reference) => reference.id),
      imageVisualStyleProjection,
      onConfirm: (finalPrompt, _userIntent, metadata) => {
        const orderedSelectedIds = metadata?.selectedImageReferenceIds || imageReferences.map((reference) => reference.id);
        const referenceById = new Map(imageReferences.map((reference) => [reference.id, reference]));
        return executeRerollShot(
          shotId,
          finalPrompt,
          orderedSelectedIds.map((id) => referenceById.get(id)).filter((reference): reference is PromptEditorImageReference => Boolean(reference)),
          metadata,
        );
      },
    });
  };

  const requestShotImageTake = async ({
    shot,
    finalPrompt,
    references,
    metadata,
    sceneShots,
  }: {
    shot: Shot;
    finalPrompt: string;
    references: PromptEditorImageReference[];
    metadata?: PromptEditorConfirmMetadata;
    sceneShots: Shot[];
  }): Promise<Shot> => {
    if (!activeScene || !currentProject) throw new Error("找不到当前场次。");
    const appearanceContext = await resolveManualTeamContext();
    requireAppearanceReady(currentProject, activeScene, [shot], appearanceSourceShots(activeEpisode!, appearanceContext || ""), 'image');
    let compiledRequest: CompiledImageGenerationRequest | undefined;
    const projectionContext = resolveImageVisualStyleProjectionContext({
      project: currentProject,
      shots: [shot],
    });
    const visualStyleProjection = buildImageVisualStyleProjection({
      project: currentProject,
      intent: "final_frame",
      ...projectionContext,
      shotOverride: shot.visualOverride,
          creativeScope: { episode: activeEpisode || undefined, scene: activeScene, shot },
    });
    const statePrompt = appearancePrompt(shot, 'image');
    const imageUrl = await generateAIImage({
      promptCore: statePrompt && !finalPrompt.includes(statePrompt) ? `${finalPrompt}\n\n${statePrompt}` : finalPrompt,
      aspectRatio: currentProject.aspectRatio as any || "16:9",
      references: references.length > 0 ? references : undefined,
      visualStyleProjection,
      visualRecipeInputEvidence: buildShotImageVisualRecipeInputEvidence({
        project: currentProject,
        shots: [shot],
      }),
      onPromptCompiled: (compiled) => {
        compiledRequest = compiled;
      },
    });
    const imageMedia = createAIGeneratedMediaReference(
      "image",
      imageUrl,
      useAIConfigStore.getState().routing.imageGen,
    );
    const createdAt = Date.now();
    const newTakeId = `take-${createdAt}-${shot.id}`;
    const referenceBoardIds = new Set((workflowOptions.manualAssetBoards || []).map((board) => board.boardItemId));
    const selectedAssetIds = [
      ...(shot.characterIdsInShot || []),
      shot.locationId,
      ...(shot.propIds || []),
    ].filter((id): id is string => Boolean(id));
    const generationAudit: ManualStudioTakeAudit = {
      action: "generate_image",
      targetKind: "shot",
      shotId: shot.id,
      sourceHash: buildManualVisualPromptSourceHash(
        workflowOptions.sourceHash || manualStoryboardHash({ sceneId: activeScene.id }),
        sceneShots,
      ),
      authorPrompt: finalPrompt,
      finalProviderPrompt: compiledRequest?.providerPrompt || finalPrompt,
      promptHash: manualStoryboardHash(finalPrompt),
      providerPromptHash: manualStoryboardHash(compiledRequest?.providerPrompt || finalPrompt),
      modelId: useAIConfigStore.getState().routing.imageGen,
      selectedSkillIds: metadata?.selectedSkillIds || [],
      selectedSkillTitles: metadata?.selectedSkillTitles || [],
      selectedContextIds: metadata?.selectedContextIds || [],
      selectedAssetIds,
      selectedAssetBoardItemIds: references.map((reference) => reference.id).filter((id) => referenceBoardIds.has(id)),
      referenceImageUrls: compiledRequest?.referenceImages || references.map((reference) => reference.imageUrl),
      imageReferenceManifest: compiledRequest?.references.map((reference, index) => ({
        index: index + 1,
        imageUrl: reference.imageUrl,
        label: reference.label,
        role: reference.role,
        preserve: reference.preserve,
        allowChange: reference.allowChange,
        exclude: reference.exclude,
      })),
      promptCompositionManifest: compiledRequest?.manifest,
      visualStyleCompileManifest: compiledRequest?.visualStyleProjection?.compileManifest,
      createdAt,
    };
    return appendShotTakeCandidate(shot, {
      id: newTakeId,
      appearanceSnapshot: shot.appearance,
      imageUrl,
      imageMedia,
      generationAudit,
      createdAt,
    });
  };

  const executeRerollShot = async (
    shotId: string,
    finalPrompt: string,
    references: PromptEditorImageReference[],
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    const shotToReroll = activeScene?.shots?.find((shot) => shot.id === shotId);
    if (!shotToReroll || !activeScene || !activeEpisode || !currentProject) return;
    setPromptModalState((previous) => ({ ...previous, isOpen: false }));
    setGeneratingShotImageId(shotId);
    toast.loading("正在重新生成该镜头...", { id: `reroll-${shotId}` });
    try {
      const updatedShot = await requestShotImageTake({
        shot: shotToReroll,
        finalPrompt,
        references,
        metadata,
        sceneShots: activeScene.shots || [],
      });
      const updatedShots = activeScene.shots!.map((shot) => shot.id === shotId ? updatedShot : shot);

      snapshotInteractiveNode(currentProject, activeScene.id, "重新生成节点镜头图片前");
      updateScene(activeScene.id, { shots: updatedShots }, activeEpisode.id);
      toast.success("图片候选已生成，请预览后明确采用", { id: `reroll-${shotId}` });
    } catch (error) {
      console.error("Storyboard reroll failed:", summarizeUnknownError(error));
      toast.error("重新生成失败", { id: `reroll-${shotId}` });
    } finally {
      setGeneratingShotImageId((current) => current === shotId ? null : current);
    }
  };

  const runShotBatchQueue = async (
    requestedShotIds: string[],
    action: StoryboardShotBatchAction,
  ) => {
    if (!activeScene || !activeEpisode || !currentProject || shotBatchRunningRef.current) return;
    const requested = new Set(requestedShotIds);
    const queuedShots = (activeScene.shots || []).filter((shot) => requested.has(shot.id));
    if (queuedShots.length === 0) {
      toast.error("请先选择要处理的分镜。");
      return;
    }

    shotBatchRunningRef.current = true;
    setIsGenerating(true);
    setShotBatchProgress({
      action,
      status: "running",
      total: queuedShots.length,
      currentIndex: 0,
      completed: 0,
      failures: [],
    });
    const actionLabel = action === "image_prompt"
      ? "图片提示词"
      : action === "video_prompt"
        ? "视频提示词"
      : "分镜图片候选";
    const toastId = `storyboard-shot-batch-${action}`;
    toast.loading(`${actionLabel}队列已开始，共 ${queuedShots.length} 项。`, { id: toastId });

    let workingShots = [...(activeScene.shots || [])];
    let workingWorkspace = activeScene.manualStoryboard;
    let completed = 0;
    const failures: Array<{ shotId: string; message: string }> = [];
    try {
      const templateId = action === "image_prompt"
        ? "generateImagePrompts"
        : action === "video_prompt"
          ? "generateVideoPrompts"
          : "generateImage";
      const fallbackTemplate = usePromptStore.getState().templates[templateId];
      const loadedTemplate = await loadProductionPromptTemplate(templateId, fallbackTemplate);
      snapshotInteractiveNode(currentProject, activeScene.id, `批量生成${actionLabel}前`);

      for (let index = 0; index < queuedShots.length; index += 1) {
        const queuedShot = queuedShots[index];
        const shot = workingShots.find((item) => item.id === queuedShot.id);
        if (!shot) continue;
        const shotNumber = Math.max(1, (activeScene.shots || []).findIndex((item) => item.id === shot.id) + 1);
        setShotBatchProgress({
          action,
          status: "running",
          total: queuedShots.length,
          currentIndex: index + 1,
          currentShotId: shot.id,
          completed,
          failures: [...failures],
        });
        toast.loading(`${actionLabel} ${index + 1}/${queuedShots.length}：SHOT ${shotNumber}`, { id: toastId });

        try {
          if (action === "image_prompt" || action === "video_prompt") {
            const promptKind = action === "image_prompt" ? "image" : "video";
            setGeneratingShotPrompt({ shotId: shot.id, kind: promptKind });
            const prompt = compileQueuedPromptTemplate(
              loadedTemplate.template,
              buildSingleShotPromptVariables(shot, promptKind),
            );
            const updatedTarget = await requestSingleShotPrompt(shot, prompt, promptKind);
            workingShots = workingShots.map((item) => item.id === shot.id ? { ...item, ...updatedTarget } : item);
            const canRebase = workflowOptions.manualReview
              && workflowOptions.sourceHash
              && canRebaseManualStoryboardAuthorEdit(workingWorkspace, workflowOptions.sourceHash);
            if (canRebase && workflowOptions.sourceHash) {
              workingWorkspace = rebaseManualStoryboardAfterAuthorEdit({
                workspace: workingWorkspace,
                shots: workingShots,
                sourceHash: workflowOptions.sourceHash,
                confirmShotPlan: false,
                confirmImagePrompts: promptKind === "image",
                confirmVideoPrompts: promptKind === "video",
              });
            }
            await updateScene(activeScene.id, {
              shots: workingShots,
              ...(workingWorkspace ? { manualStoryboard: workingWorkspace } : {}),
            }, activeEpisode.id);
          } else {
            if (!shot.imagePrompt?.trim()) {
              throw new Error("缺少图片提示词，请先生成该镜头的图片提示词。");
            }
            setGeneratingShotImageId(shot.id);
            const references = resolveShotImageReferences({
              project: currentProject,
              shot,
              manualAssetBoards: workflowOptions.manualAssetBoards,
              variantMap: activeScene.breakdown?.assetVariantMap || {},
            });
            const finalPrompt = compileQueuedPromptTemplate(loadedTemplate.template, {
              imagePrompt: shot.imagePrompt,
            });
            const updatedShot = await requestShotImageTake({
              shot,
              finalPrompt,
              references,
              sceneShots: workingShots,
            });
            workingShots = workingShots.map((item) => item.id === shot.id ? updatedShot : item);
            await updateScene(activeScene.id, { shots: workingShots }, activeEpisode.id);
          }
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : `${actionLabel}生成失败。`;
          failures.push({ shotId: shot.id, message });
          console.error("Storyboard shot batch item failed:", shot.id, summarizeUnknownError(error));
        } finally {
          setGeneratingShotPrompt((current) => current?.shotId === shot.id ? null : current);
          setGeneratingShotImageId((current) => current === shot.id ? null : current);
        }
      }

      setShotBatchProgress({
        action,
        status: "completed",
        total: queuedShots.length,
        currentIndex: queuedShots.length,
        completed,
        failures,
      });
      if (failures.length > 0) {
        toast.error(`${actionLabel}队列完成：成功 ${completed}，失败 ${failures.length}。`, { id: toastId });
      } else {
        toast.success(`${actionLabel}队列完成，共 ${completed} 项。`, { id: toastId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${actionLabel}队列启动失败。`;
      toast.error(message, { id: toastId });
      setShotBatchProgress({
        action,
        status: "completed",
        total: queuedShots.length,
        currentIndex: 0,
        completed,
        failures: [...failures, { shotId: "queue", message }],
      });
    } finally {
      shotBatchRunningRef.current = false;
      setGeneratingShotPrompt(null);
      setGeneratingShotImageId(null);
      setIsGenerating(false);
    }
  };

  const handlePrepareGenerateShotSpatial = async (shot: Shot) => {
    if (!activeScene || !activeEpisode || !currentProject) return;

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(currentProject, 'generateShotSpatial');
    const interactiveProductionContext = buildInteractiveVisualContext(currentProject, activeEpisode, activeScene);

    setPromptModalState({
      isOpen: true,
      templateId: 'generateShotSpatial',
      variables: {
        motivation: shot.motivation || '',
        visualAction: shot.visualAction || '',
        shotSize: shot.shotSize || '',
        cameraAngle: shot.cameraAngle || '',
        cameraMovement: shot.cameraMovement || '',
        lightingAtmo: shot.lightingAtmo || '',
        characterIds: (shot.characterIdsInShot || []).join(', '),
        locationId: shot.locationId || '',
        propIds: (shot.propIds || []).join(', '),
        interactiveProductionContext,
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: (finalPrompt) => handleGenerateShotSpatial(shot.id, finalPrompt)
    });
  };

  const handleGenerateShotSpatial = async (shotId: string, prompt: string) => {
    if (!activeScene || !activeEpisode) return;
    setIsGenerating(true);
    setPromptModalState(prev => ({ ...prev, isOpen: false }));
    try {
      const responseText = await generateAIContent({
        taskType: 'storyboardGen',
        prompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            compositionData: {
              type: Type.OBJECT,
              properties: {
                cameraState: {
                  type: Type.OBJECT,
                  properties: {
                    position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                    target: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                    fov: { type: Type.NUMBER }
                  }
                },
                entities: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      type: { type: Type.STRING },
                      position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                      rotationY: { type: Type.NUMBER }
                    }
                  }
                }
              }
            }
          }
        },
      });

      const result = safeParseAIResponse(responseText, null);
      if (result && result.compositionData) {
        const updatedShots = activeScene.shots!.map(s => {
          if (s.id === shotId) {
            return {
              ...s,
              compositionData: result.compositionData
            };
          }
          return s;
        });
        snapshotInteractiveNode(currentProject, activeScene.id, "生成节点镜头空间构图前");
        updateScene(activeScene.id, { shots: updatedShots }, activeEpisode.id);
        toast.success("3D空间数据生成成功！");
      }
    } catch (error) {
      console.error("Storyboard spatial generation failed:", summarizeUnknownError(error));
      toast.error("生成3D空间数据失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  const adoptReviewCandidate = async () => {
    if (!reviewCandidate || !activeEpisode || !currentProject) return;
    if (reviewCandidate.issues.some((issue) => issue.severity === "blocking")) {
      toast.error("草案仍有阻断问题，不能采用。");
      return;
    }
    if (reviewCandidate.episodeId !== activeEpisode.id) {
      toast.error("当前分集已切换，候选仍未采用；请返回原分集重新审阅。");
      return;
    }
    const batchTarget = workflowOptions.batchScenes?.find((item) => item.scene.id === reviewCandidate.sceneId);
    const targetScene = activeScene?.id === reviewCandidate.sceneId
      ? activeScene
      : batchTarget?.scene || activeEpisode.scenes?.find((scene) => scene.id === reviewCandidate.sceneId);
    if (!targetScene) {
      toast.error("候选对应的场次已不存在，不能采用。");
      return;
    }
    const editIssues = reviewCandidate.kind === "shots" ? validateDirectorShotEdits(reviewCandidate.shots) : [];
    if (editIssues.length) { toast.error(editIssues[0]); return; }
    const targetStoryboardSourceHash = batchTarget?.sourceHash
      || (targetScene.id === activeScene?.id ? workflowOptions.sourceHash : undefined)
      || manualStoryboardHash({ sceneId: targetScene.id, script: targetScene.script || "" });
    const nextCompletedScenes = Math.min(
      agentProgress.totalScenes,
      agentProgress.completedScenes + 1,
    );
    if (reviewCandidate.kind === "shots") {
      if (reviewCandidate.sourceHash !== targetStoryboardSourceHash) {
        toast.error("剧本或制作参考已变化，请重新生成镜头草案。");
        return;
      }
      const now = Date.now();
      const liveProject = useProjectStore.getState().currentProject || currentProject;
      const liveEpisode = useProjectStore.getState().activeEpisode || activeEpisode;
      if ((reviewCandidate.projectId && reviewCandidate.projectId !== liveProject.id) || reviewCandidate.episodeId !== liveEpisode.id) {
        toast.error("当前项目或分集已经切换，候选未写入。请回到生成时的项目采用。"); return;
      }
      const liveScene = liveEpisode.scenes.find(scene => scene.id === targetScene.id) || targetScene;
      const liveScope = { episode: liveEpisode, scene: liveScene };
      if (reviewCandidate.previousShotPlanHash && reviewCandidate.previousShotPlanHash !== sceneShotPlanHash(liveScene)) {
        toast.error("已有镜头在生成后被修改，候选已保留，请重新设计以保留这些修改。"); return;
      }
      if (reviewCandidate.directorBindingHash && reviewCandidate.directorBindingHash !== directorBindingHash(liveProject, liveScope)) {
        toast.error("导演设置在生成期间发生变化，候选已保留，请按当前设置重新设计。"); return;
      }
      if (reviewCandidate.directorPlan && reviewCandidate.directorPlan.sourceHash !== directorPlanSourceHash(liveProject, liveScope, reviewCandidate.directorPlan.assetIds)) {
        toast.error("本场导演方案的剧本、形象或画风依据已变化，候选已保留，请重新设计。"); return;
      }
      const prepared = appearanceAssetPatch(liveProject, reviseShotAppearances(liveProject, targetScene, reviewCandidate.shots, reviewCandidate.appearanceHistory || appearanceSourceShots(activeEpisode, batchTarget?.manualTeamContext || workflowOptions.manualTeamContext || "")));
      const directedAudio = applyDirectorAudioPlan(prepared.shots, buildShotAudioTracks(targetScene, prepared.shots));
      if (directedAudio.issues.length) {
        setReviewCandidate({ ...reviewCandidate, issues: [...reviewCandidate.issues, ...directedAudio.issues.map(message => ({ severity: "blocking" as const, message }))] });
        toast.error("声音安排仍有冲突，请在候选中调整台词或声音进入时间。");
        return;
      }
      const shotPlanHash = buildManualShotPlanHash(prepared.shots);
      const authorQuality: ManualStoryboardAgentQuality = {
        score: 100,
        verdict: "pass",
        reviewKind: "author_self_review",
        summary: "创作者已审阅并采用本次镜头方案。",
        strengths: ["镜头结构已由创作者明确确认。"],
        issues: [],
      };
      const workspace: ManualStoryboardWorkspace = {
        ...(targetScene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const }),
        schemaVersion: "manual-storyboard.v1",
        directorPlan: reviewCandidate.directorPlan,
        shotPlan: {
          sourceHash: reviewCandidate.sourceHash,
          outputHash: shotPlanHash,
          audit: reviewCandidate.audit,
          qa: reviewCandidate.authorEdited ? authorQuality : reviewCandidate.audit.agentQuality || authorQuality,
          adoptedAt: now,
          confirmedAt: now,
        },
        imagePrompts: undefined,
        videoPrompts: undefined,
        visualPrompts: undefined,
        qa: undefined,
        updatedAt: now,
      };
      snapshotInteractiveNode(currentProject, targetScene.id, "采用镜头草案前");
      await updateScene(targetScene.id, {
        shots: prepared.shots,
        audioTracks: directedAudio.tracks,
        ...(reviewCandidate.targetDurationSeconds
          ? { targetDuration: reviewCandidate.targetDurationSeconds / 60 }
          : {}),
        manualStoryboard: workspace,
      }, reviewCandidate.episodeId, { expectedProjectId: currentProject.id, archiveReplacedShots: true, appearanceAssets: { characters: prepared.characters, assets: prepared.assets } });
      try {
        await flushDebouncedProjectSave(currentProject.id);
      } catch (error) {
        console.error("Failed to persist adopted storyboard shots:", summarizeUnknownError(error));
        toast.error("镜头草案已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。");
        return;
      }
      if (targetScene.id === activeScene?.id) setActiveShotId(reviewCandidate.shots[0]?.id || null);
      setReviewCandidate(null);
      setAgentProgress({
        phase: "completed",
        label: "镜头方案已采用，可分别生成图片提示词和视频提示词。",
        sceneId: targetScene.id,
        sceneTitle: targetScene.title,
        attempt: 1,
        maxAttempts: 1,
        completedScenes: nextCompletedScenes,
        totalScenes: agentProgress.totalScenes,
        score: reviewCandidate.audit.agentQuality?.score,
        issues: [],
      });
      toast.success("镜头草案已采用。");
      return;
    }

    const currentSourceHash = buildManualVisualPromptSourceHash(
      targetStoryboardSourceHash,
      targetScene.shots || [],
    );
    if (reviewCandidate.sourceHash !== currentSourceHash) {
      toast.error("镜头方案或上游资产已变化，请重新生成视觉提示词。");
      return;
    }
    const now = Date.now();
    const promptKind = reviewCandidate.kind === "image_prompts" ? "image" : "video";
    const authorQuality: ManualStoryboardAgentQuality = {
      score: 100,
      verdict: "pass",
      reviewKind: "author_self_review",
      summary: `创作者已审阅并采用本次${promptKind === "image" ? "图片" : "视频"}提示词。`,
      strengths: [`${promptKind === "image" ? "图片" : "视频"}提示词已由创作者明确确认。`],
      issues: [],
    };
    const promptRecord = {
      sourceHash: reviewCandidate.sourceHash,
      outputHash: promptKind === "image"
        ? buildManualImagePromptHash(reviewCandidate.shots)
        : buildManualVideoPromptHash(reviewCandidate.shots),
      audit: reviewCandidate.audit,
      qa: reviewCandidate.authorEdited ? authorQuality : reviewCandidate.audit.agentQuality || authorQuality,
      adoptedAt: now,
      confirmedAt: now,
    };
    const workspace: ManualStoryboardWorkspace = {
      ...(targetScene.manualStoryboard || { schemaVersion: "manual-storyboard.v1" as const }),
      schemaVersion: "manual-storyboard.v1",
      ...(promptKind === "image" ? { imagePrompts: promptRecord } : { videoPrompts: promptRecord }),
      visualPrompts: undefined,
      qa: undefined,
      updatedAt: now,
    };
    snapshotInteractiveNode(currentProject, targetScene.id, `采用${promptKind === "image" ? "图片" : "视频"}提示词草案前`);
    const adoptedShots = mergePromptLayer(targetScene.shots || [], reviewCandidate.shots, promptKind);
    await updateScene(targetScene.id, { shots: adoptedShots, manualStoryboard: workspace }, reviewCandidate.episodeId);
    try {
      await flushDebouncedProjectSave(currentProject.id);
    } catch (error) {
      console.error("Failed to persist adopted storyboard prompts:", summarizeUnknownError(error));
      toast.error(`${promptKind === "image" ? "图片" : "视频"}提示词已保留在本地，但写入数据库失败；失败保存已保留，请稍后重试。`);
      return;
    }
    setReviewCandidate(null);
    setAgentProgress({
      phase: "completed",
      label: `${promptKind === "image" ? "图片" : "视频"}提示词已采用。`,
      sceneId: targetScene.id,
      sceneTitle: targetScene.title,
      attempt: 1,
      maxAttempts: 1,
      completedScenes: nextCompletedScenes,
      totalScenes: agentProgress.totalScenes,
      score: reviewCandidate.audit.agentQuality?.score,
      issues: [],
    });
    toast.success(`${promptKind === "image" ? "图片" : "视频"}提示词草案已采用。`);
  };

  return {
    isGenerating,
    generatingShotImageId,
    generatingShotPrompt,
    shotBatchProgress,
    agentProgress,
    promptModalState,
    setPromptModalState,
    reviewCandidate,
    isReviewCandidateOpen,
    openReviewCandidate: () => reviewCandidate && setIsReviewCandidateOpen(true),
    closeReviewCandidate: () => setIsReviewCandidateOpen(false),
    setReviewCandidate,
    adoptReviewCandidate,
    updateReviewShot: (shot: Shot) => {
      if (!reviewCandidate || !currentProject || !activeEpisode) return;
      const scene = activeScene?.id === reviewCandidate.sceneId ? activeScene : workflowOptions.batchScenes?.find(s => s.scene.id === reviewCandidate.sceneId)?.scene;
      if (!scene) return;
      let shots = reviewCandidate.shots.map(s => s.id === shot.id ? shot : s);
      if (reviewCandidate.kind === "shots") shots = reviseShotAppearances(currentProject, scene, shots, reviewCandidate.appearanceHistory || appearanceSourceShots(activeEpisode, workflowOptions.manualTeamContext || ""));
      const allowed = workflowOptions.batchScenes?.find(s => s.scene.id === scene.id)?.allowedAssetIds || workflowOptions.allowedAssetIds;
      const contract = reviewCandidate.kind === "shots" ? validateStoryboardShotContract({
        rawShots: shots.map(item => ({ ...item })), normalizedShots: shots, targetDurationSeconds: reviewCandidate.targetDurationSeconds,
        enforceAssetScope: Boolean(allowed), allowedAssetIds: allowed, allowedUnboundSpeakerNames: sceneLocalSpeakerNames(currentProject, scene),
        requireLocation: Boolean(scene.breakdown?.locationId), resolveAssetId: (type, value) => canonicalStoryboardAssetId(currentProject, type, value),
      }) : reviewCandidate.kind === "image_prompts" ? validateStoryboardImagePromptContract({ prompts: shots.map(s => ({ id: s.id, imagePrompt: s.imagePrompt, visualSummary: s.visualSummary })) as StoryboardImagePromptValue[], shots })
        : validateStoryboardVideoPromptContract({ prompts: shots.map(s => ({ id: s.id, videoPrompt: s.videoPrompt })) as StoryboardVideoPromptValue[], shots });
      const issues: StoryboardReviewIssue[] = contract.map(issue => ({ severity: issue.severity, message: issue.message }));
      if (reviewCandidate.kind === "shots") issues.push(...validateDirectorShotEdits(shots).map(message => ({ severity: "blocking" as const, message })));
      issues.push(...(reviewCandidate.audit.agentQuality?.issues || []).filter(issue => issue.severity !== "advisory").map(issue => ({ severity: "warning" as const, message: "生成时质检，请核对修改后是否解决：" + issue.description })));
      setReviewCandidate({ ...reviewCandidate, shots, issues, authorEdited: true });
    },
    updateReviewPlan: (plan: SceneDirectorPlan) => { if (reviewCandidate?.kind === "shots") setReviewCandidate({ ...reviewCandidate, directorPlan: plan, authorEdited: true }); },
    handlePrepareGenerateShots,
    handlePrepareGenerateSegmentShots,
    handlePrepareGenerateImagePrompts: () => handlePrepareGeneratePrompts("image"),
    handlePrepareGenerateVideoPrompts: () => handlePrepareGeneratePrompts("video"),
    handlePrepareGenerateShotPrompt,
    runShotBatchQueue,
    handlePrepareGenerateSegmentImagePrompts: () => handlePrepareGenerateSegmentPrompts("image"),
    handlePrepareGenerateSegmentVideoPrompts: () => handlePrepareGenerateSegmentPrompts("video"),
    handleRerollShot,
    handlePrepareGenerateShotSpatial,
  };
};
