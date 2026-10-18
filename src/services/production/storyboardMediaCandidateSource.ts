import crypto from "node:crypto";

import type { Project, Scene, Shot } from "../../types/project";
import type { AssetReferencePackItem, StoryboardBoard } from "./videoStoryboardArtifacts";
import { normalizeLegacyVisualStyleLock } from "./visualStyleMigration";

export const STORYBOARD_MEDIA_CANDIDATE_SOURCE_VERSION = "storyboard-media-source.v2";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]));
};

export const storyboardBoardSourceContract = (board: StoryboardBoard) => {
  const {
    generatedImageUrl: _generatedImageUrl,
    visualReview: _visualReview,
    ...contract
  } = board;
  return contract;
};

const relevantShotSource = (shot: Shot) => ({
  id: shot.id,
  shotSize: shot.shotSize,
  cameraAngle: shot.cameraAngle,
  cameraMovement: shot.cameraMovement,
  focalLength: shot.focalLength,
  lighting: shot.lighting,
  composition: shot.composition,
  blocking: shot.blocking,
  continuityNote: shot.continuityNote,
  visualAction: shot.visualAction,
  lightingAtmo: shot.lightingAtmo,
  duration: shot.duration,
  shortDurationOverride: shot.shortDurationOverride,
  motivation: shot.motivation,
  microExpression: shot.microExpression,
  storyboardCapabilityIds: shot.storyboardCapabilityIds || [],
  imagePrompt: shot.imagePrompt,
  videoPrompt: shot.videoPrompt,
  visualSummary: shot.visualSummary,
  characterIdsInShot: shot.characterIdsInShot || [],
  locationId: shot.locationId,
  propIds: shot.propIds || [],
  activeVisualLayerIds: shot.activeVisualLayerIds || [],
  dialogueLines: shot.dialogueLines || [],
  compositionData: shot.compositionData,
  assetOverrides: shot.assetOverrides,
  visualOverride: shot.visualOverride,
});

const currentStoryboardScene = (
  project: Project,
  board: StoryboardBoard,
) => {
  const episode = (project.episodes as unknown as Array<{ id: string; scenes?: Scene[] }>)
    .find((candidate) => candidate.id === board.episodeId);
  return episode?.scenes?.find((candidate) => candidate.id === board.sceneId)
    || project.scenes?.find((candidate) => candidate.id === board.sceneId)
    || (project.episodes as unknown as Array<{ scenes?: Scene[] }>)
      .flatMap((candidate) => candidate.scenes || [])
      .find((candidate) => candidate.id === board.sceneId);
};

const referencedEntitySource = (
  project: Project,
  item: AssetReferencePackItem,
) => {
  const entity = item.assetType === "character"
    ? project.characters.find((candidate) => candidate.id === item.assetId)
    : project.assets.find((candidate) => candidate.id === item.assetId);
  const variant = entity?.variants?.find((candidate) => candidate.id === item.variantId);
  if (!entity) return { id: item.assetId, type: item.assetType, missing: true };
  return {
    id: entity.id,
    type: item.assetType,
    name: entity.name,
    visualIdentity: "visualIdentity" in entity ? entity.visualIdentity : undefined,
    description: "description" in entity ? entity.description : undefined,
    prompt: "prompt" in entity ? entity.prompt : undefined,
    boardPrompt: entity.boardPrompt,
    boardImageUrl: entity.boardImageUrl,
    cleanReferenceImageUrl: entity.cleanReferenceImageUrl,
    referenceImageUrl: "referenceImageUrl" in entity ? entity.referenceImageUrl : undefined,
    variant: variant ? {
      id: variant.id,
      name: variant.name,
      description: variant.description,
      promptModifiers: variant.promptModifiers,
      referenceVariantId: variant.referenceVariantId,
      boardPrompt: variant.boardPrompt,
      boardImageUrl: variant.boardImageUrl,
      cleanReferenceImageUrl: variant.cleanReferenceImageUrl,
    } : undefined,
  };
};

export const buildStoryboardMediaCandidateSourceSnapshot = ({
  project,
  board,
  referenceItems,
}: {
  project: Project;
  board: StoryboardBoard;
  referenceItems: AssetReferencePackItem[];
}) => {
  const scene = currentStoryboardScene(project, board);
  const currentShotById = new Map((scene?.shots || []).map((shot) => [shot.id, shot]));
  const shots = (board.shotIds || [])
    .map((shotId) => currentShotById.get(shotId))
    .filter((shot): shot is Shot => Boolean(shot));
  const visualStyle = project.visualStyleLock
    ? normalizeLegacyVisualStyleLock(project.visualStyleLock).lock
    : undefined;
  return canonicalize({
    version: STORYBOARD_MEDIA_CANDIDATE_SOURCE_VERSION,
    projectTitle: project.title,
    sceneTitle: scene?.title,
    board: storyboardBoardSourceContract(board),
    referenceItems: referenceItems.map((item) => ({
      assetId: item.assetId,
      assetType: item.assetType,
      variantId: item.variantId,
      referenceAssetId: item.referenceAssetId,
      referenceImageUrl: item.referenceImageUrl,
      roleInUnit: item.roleInUnit,
      required: item.required,
    })),
    referencedEntities: referenceItems.map((item) => referencedEntitySource(project, item)),
    shots: shots.map(relevantShotSource),
    visualStyleContentHash: visualStyle?.contentHash,
    visualStyleImplementation: visualStyle?.visualImplementation,
    visualStyleTreatment: visualStyle?.treatment,
    mediumAssignments: visualStyle?.mediumAssignments || [],
  });
};

export const buildStoryboardMediaCandidateSourceHash = (input: {
  project: Project;
  board: StoryboardBoard;
  referenceItems: AssetReferencePackItem[];
}) => `sha256-${crypto.createHash("sha256")
  .update(JSON.stringify(buildStoryboardMediaCandidateSourceSnapshot(input)))
  .digest("hex")}`;
