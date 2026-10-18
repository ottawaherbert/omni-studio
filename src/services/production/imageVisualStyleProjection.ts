import { resolveProductionCreativeVisual, creativeExecutionManifest, hasShotVisualDirection, creativeStyleReferences, renderProductionCreativeContext, type ProductionCreativeScope } from "../../../packages/production/src/services/production/creativeDirection";
import type { VisualArtifactIntent, VisualProjectionTarget } from "../../../packages/domain/src/visualArtifact";
import type { VisualLocalOverride } from "../../../packages/domain/src/visualOverride";
import { isVisualEntityType } from "../../../packages/domain/src/visualStyle";
import {
  buildProductionAssetVisualStyleProjection,
  type ProductionAssetVisualStyleTarget,
} from "../../../packages/production/src/services/production/productionAssetVisualStyle";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
} from "../../../packages/production/src/services/production/visualStyleProjection";
import { assertVisualStyleReadyForExecution } from "../../../packages/production/src/services/production/visualMediumProfiles";
import type { Project, Shot } from "../../types/project";
import type { ImageVisualStyleProjection } from "./imageGenerationRequest";
import {
  createVisualRecipeInputEvidence,
  type ImageGenerationRequest,
} from "./imageGenerationRequest";

export interface BuildImageVisualStyleProjectionInput {
  project: Partial<Project>;
  creativeScope?: ProductionCreativeScope;
  intent: VisualArtifactIntent;
  target?: VisualProjectionTarget;
  targets?: VisualProjectionTarget[];
  assetOverride?: VisualLocalOverride;
  shotOverride?: VisualLocalOverride;
  requestOverride?: VisualLocalOverride;
  assignmentTargetLabels?: Record<string, string>;
}

export interface ImageVisualStyleProjectionContext {
  targets: VisualProjectionTarget[];
  assignmentTargetLabels: Record<string, string>;
}

export type ImageVisualRecipeInputEvidence = NonNullable<ImageGenerationRequest["visualRecipeInputEvidence"]>;

export const buildAssetImageVisualRecipeInputEvidence = ({
  intent,
  identityFacts,
  stateDelta,
  identitySource = "Project.asset.identityFacts",
  stateSource = "Project.asset.variantState",
}: {
  intent: Extract<VisualArtifactIntent, "asset_identity" | "asset_state">;
  identityFacts: unknown;
  stateDelta?: unknown;
  identitySource?: string;
  stateSource?: string;
}): ImageVisualRecipeInputEvidence => intent === "asset_state"
  ? {
      base_identity: createVisualRecipeInputEvidence(identitySource, identityFacts),
      state_delta: createVisualRecipeInputEvidence(stateSource, stateDelta),
    }
  : {
      identity_facts: createVisualRecipeInputEvidence(identitySource, identityFacts),
    };

export const buildProductionAssetVisualRecipeInputEvidence = ({
  project,
  asset,
}: {
  project: Pick<Project, "characters" | "assets">;
  asset: ProductionAssetVisualStyleTarget;
}): ImageVisualRecipeInputEvidence => {
  const character = asset.assetType === "character"
    ? project.characters.find((entry) => entry.id === asset.assetId)
    : undefined;
  const productionAsset = asset.assetType === "character"
    ? undefined
    : project.assets.find((entry) => entry.id === asset.assetId);
  const identityFacts = character ? [
    character.visualIdentity,
    character.boardPrompt,
    character.multiViewPrompt,
    character.defaultReferenceUrl,
    character.referenceImageUrl,
    character.cleanReferenceImageUrl,
    character.boardImageUrl,
    character.multiViewUrl,
  ] : productionAsset ? [
    productionAsset.description,
    productionAsset.prompt,
    productionAsset.boardPrompt,
    productionAsset.multiViewPrompt,
    productionAsset.defaultReferenceUrl,
    productionAsset.imageUrl,
    productionAsset.cleanReferenceImageUrl,
    productionAsset.boardImageUrl,
    productionAsset.multiViewUrl,
    productionAsset.panoramaUrl,
  ] : [];
  const variant = asset.variantId
    ? (character || productionAsset)?.variants?.find((entry) => entry.id === asset.variantId)
    : undefined;
  return buildAssetImageVisualRecipeInputEvidence({
    intent: asset.variantId ? "asset_state" : "asset_identity",
    identityFacts,
    stateDelta: asset.variantId ? [
      variant?.description,
      variant?.promptModifiers,
      variant?.boardPrompt,
      variant?.cleanReferencePrompt,
      variant?.cleanReferenceImageUrl,
      variant?.boardImageUrl,
      variant?.imageUrl,
    ] : undefined,
    identitySource: "Project.asset.canonicalIdentityFacts",
    stateSource: "Project.asset.variants.canonicalStateDelta",
  });
};

export const buildShotImageVisualRecipeInputEvidence = ({
  project,
  shots,
}: {
  project: Pick<Project, "characters" | "assets">;
  shots: Array<Pick<Shot,
    | "shotSize"
    | "cameraAngle"
    | "cameraMovement"
    | "focalLength"
    | "lighting"
    | "composition"
    | "blocking"
    | "continuityNote"
    | "visualAction"
    | "characterIdsInShot"
    | "locationId"
    | "propIds"
  >>;
}): ImageVisualRecipeInputEvidence => {
  const selectedAssetIds = new Set(shots.flatMap((shot) => [
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
  ].filter((value): value is string => Boolean(value))));
  const identityFacts = [
    ...project.characters
      .filter((character) => selectedAssetIds.has(character.id))
      .map((character) => [
        character.visualIdentity,
        character.boardPrompt,
        character.defaultReferenceUrl,
        character.referenceImageUrl,
      ]),
    ...project.assets
      .filter((asset) => selectedAssetIds.has(asset.id))
      .map((asset) => [
        asset.description,
        asset.prompt,
        asset.boardPrompt,
        asset.defaultReferenceUrl,
        asset.imageUrl,
      ]),
  ];
  const shotFacts = shots.map((shot) => [
    shot.shotSize,
    shot.cameraAngle,
    shot.cameraMovement,
    shot.focalLength,
    shot.lighting,
    shot.composition,
  ]);
  const visibleActions = shots.map((shot) => [shot.visualAction, shot.blocking]);
  const continuityFacts = shots.map((shot) => [
    shot.continuityNote,
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
  ]);
  return {
    identity_facts: createVisualRecipeInputEvidence("Project.assets.canonicalVisualFacts", identityFacts),
    shot_facts: createVisualRecipeInputEvidence("Scene.shots.cameraAndCompositionFacts", shotFacts),
    visible_action: createVisualRecipeInputEvidence("Scene.shots.visibleAction", visibleActions),
    continuity: createVisualRecipeInputEvidence("Scene.shots.continuityFacts", continuityFacts),
  };
};

export const resolveManualStudioImageVisualArtifactIntent = (
  draftPreview?: boolean,
): Extract<VisualArtifactIntent, "direction_preview" | "final_frame"> => (
  draftPreview ? "direction_preview" : "final_frame"
);

export const resolveManualStudioTargetShotOverride = (
  shotOverride: VisualLocalOverride | undefined,
  targetShotIds?: readonly string[],
): VisualLocalOverride | undefined => {
  const targetShotCount = new Set(
    (targetShotIds || []).map((shotId) => shotId.trim()).filter(Boolean),
  ).size;
  return targetShotCount <= 1 ? shotOverride : undefined;
};

export const resolveImageVisualStyleProjectionContext = ({
  project,
  shots = [],
  assetIds = [],
  layerIds = [],
}: {
  project: Pick<Project, "title" | "visualStyleLock" | "characters" | "assets">;
  shots?: Array<Pick<Shot, "characterIdsInShot" | "locationId" | "propIds"> & { activeVisualLayerIds?: string[] }>;
  assetIds?: string[];
  layerIds?: string[];
}): ImageVisualStyleProjectionContext => {
  const selectedAssetIds = Array.from(new Set([
    ...assetIds,
    ...shots.flatMap((shot) => [
      ...(shot.characterIdsInShot || []),
      shot.locationId,
      ...(shot.propIds || []),
    ]),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  const targets = selectedAssetIds.flatMap<VisualProjectionTarget>((assetId) => {
    if (project.characters.some((character) => character.id === assetId)) {
      return [{ entityType: "character", entityId: assetId }];
    }
    const asset = project.assets.find((entry) => entry.id === assetId);
    if (!asset) return [];
    return isVisualEntityType(asset.type)
      ? [{ entityType: asset.type, entityId: assetId }]
      : [];
  });
  const selectedLayerIds = [
    ...layerIds,
    ...shots.flatMap((shot) => shot.activeVisualLayerIds || []),
  ];
  targets.push(...Array.from(new Set(selectedLayerIds.map((value) => value.trim()).filter(Boolean)))
    .map((layerId) => ({ layerId })));

  const rawAssignments = project.visualStyleLock?.mediumAssignments;
  const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];
  const assignmentTargetLabels: Record<string, string> = {};
  assignments.forEach((assignment, index) => {
    if (!assignment || typeof assignment.id !== "string" || !assignment.id.trim() || !assignment.target) return;
    const target = assignment.target;
    if (target.scope === "whole") {
      assignmentTargetLabels[assignment.id] = project.title?.trim()
        ? `项目“${project.title.trim()}”的完整画面`
        : "整个制作画面";
      return;
    }
    if (target.scope === "layer") {
      assignmentTargetLabels[assignment.id] = `图层“${target.label}”：${target.description}`;
      return;
    }
    const name = target.entityType === "character"
      ? project.characters.find((entry) => entry.id === target.entityId)?.name
        || project.assets.find((entry) => entry.id === target.entityId)?.name
      : project.assets.find((entry) => entry.id === target.entityId)?.name;
    const kind = {
      character: "角色",
      location: "场景",
      prop: "道具",
      vfx: "视觉效果",
      wardrobe: "服装",
      makeupHair: "妆发",
      vehicles: "车辆",
      extrasAtmosphere: "群演与气氛",
      specialEquipment: "特殊设备",
    }[target.entityType];
    assignmentTargetLabels[assignment.id] = name?.trim() ? `${kind}“${name.trim()}”` : `当前镜头${kind}`;
  });
  return { targets, assignmentTargetLabels };
};

const toImageVisualStyleProjection = (
  projection: ReturnType<typeof projectVisualStyleForArtifact>,
  rendered: ReturnType<typeof renderVisualStyleProjectionInstruction>,
): ImageVisualStyleProjection => ({
  artifactIntent: projection.intent,
  recipeId: projection.recipeId,
  recipeVersion: projection.recipeVersion,
  instruction: projection.intent === 'asset_identity' || projection.intent === 'asset_state'
    ? projection.stylePrompt !== undefined ? projection.stylePrompt.trim()
      : rendered.blocks.filter(block => block.id !== 'visual.artifact' && block.id !== 'visual.directives').map(block => block.content).join('\n\n')
    : rendered.instruction,
  sourceRevision: projection.sourceStyle.revision === undefined
    ? undefined
    : `r${projection.sourceStyle.revision}`,
  sourceHash: projection.sourceStyle.resolvedContentHash,
  includedPaths: projection.fieldOrigins
    .filter((origin) => origin.action !== "suppress")
    .map((origin) => origin.path)
    .filter((path, index, paths) => paths.indexOf(path) === index),
  suppressedPaths: projection.suppressedFields,
  targetSelection: structuredClone(projection.targetSelection),
  compileManifest: structuredClone(rendered.manifest),
});

export const buildImageVisualStyleProjection = ({
  project,
  intent,
  target,
  targets,
  assetOverride,
  shotOverride,
  requestOverride,
  assignmentTargetLabels,
  creativeScope,
}: BuildImageVisualStyleProjectionInput): ImageVisualStyleProjection => {
  const styleLock = resolveProductionCreativeVisual(project, creativeScope);
  assertVisualStyleReadyForExecution(styleLock, intent);
  const projection = projectVisualStyleForArtifact({
    styleLock: styleLock?.humanApprovalState === "rejected" ? undefined : styleLock,
    intent,
    target,
    targets,
    assetOverride,
    shotOverride,
    requestOverride,
  });
  const rendered = renderVisualStyleProjectionInstruction(projection, { assignmentTargetLabels });
  const perShot = !creativeScope?.shot && project.characters && project.assets
    ? (creativeScope?.scene?.shots || []).flatMap((shot, index) => {
      if (!hasShotVisualDirection(project, shot)) return [];
      const context = resolveImageVisualStyleProjectionContext({ project: { title: project.title || "", visualStyleLock: styleLock, characters: project.characters!, assets: project.assets! }, shots: [shot] });
      const local = buildImageVisualStyleProjection({ project, intent, ...context, shotOverride: shot.visualOverride, creativeScope: { ...creativeScope, shot } });
      return [`【本单元第 ${index + 1} 镜专用规范，仅在对应分格内生效】\n${local.instruction}`];
    }) : [];
  const creativeDirection = creativeExecutionManifest(project, creativeScope, "image");
  return { ...toImageVisualStyleProjection(projection, rendered),
    instruction: [rendered.instruction, renderProductionCreativeContext(project, creativeScope, "image", false), ...perShot].filter(Boolean).join("\n\n"),
    styleReferences: creativeStyleReferences(project, creativeScope),
    compileManifest: { ...rendered.manifest, ...(creativeDirection ? { creativeDirection } : {}) },
  };
};

export const buildProductionAssetImageVisualStyleProjection = ({
  project,
  asset,
}: {
  project: Pick<Project, "visualStyleLock" | "characters" | "assets">;
  asset: ProductionAssetVisualStyleTarget;
}): ImageVisualStyleProjection => {
  const intent = asset.variantId ? "asset_state" : "asset_identity";
  assertVisualStyleReadyForExecution(project.visualStyleLock, intent);
  const resolved = buildProductionAssetVisualStyleProjection({ project, asset });
  const owner = [...project.characters, ...project.assets].find(item => item.id === asset.assetId);
  const creativeScope = { request: { visual: owner?.creativeDirection?.visual } };
  const creativeDirection = creativeExecutionManifest(project, creativeScope, "asset");
  return {
    ...toImageVisualStyleProjection(resolved.projection, resolved.rendered),
    compileManifest: { ...resolved.rendered.manifest, ...(creativeDirection ? { creativeDirection } : {}) },
    styleReferences: creativeStyleReferences(project, creativeScope),
  };
};
