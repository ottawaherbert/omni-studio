import { applyCreativeVisualBinding, resolveProductionCreativeVisual } from "./creativeDirection";
import type {
  VisualArtifactIntent,
  VisualProjectionTarget,
  VisualStyleProjection,
} from "../../../../domain/src/visualArtifact";
import type { VisualLocalOverride } from "../../../../domain/src/visualOverride";
import type { Project } from "../../../../../src/types/project";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
  type RenderedVisualStyleProjectionInstruction,
} from "./visualStyleProjection";

export interface ProductionAssetVisualStyleTarget {
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  variantId?: string;
  variantName?: string;
}

export interface ProductionAssetVisualStyleProjection {
  intent: Extract<VisualArtifactIntent, "asset_identity" | "asset_state">;
  target: VisualProjectionTarget;
  assetOverride?: VisualLocalOverride;
  overrideSource: "project.characters" | "project.assets" | "none";
  projection: VisualStyleProjection;
  rendered: RenderedVisualStyleProjectionInstruction;
}

const assetTypeLabel = (assetType: ProductionAssetVisualStyleTarget["assetType"]) => {
  if (assetType === "character") return "角色";
  if (assetType === "location") return "地点";
  if (assetType === "vehicles") return "交通工具";
  return "道具";
};

const resolveCanonicalAssetOverride = (
  project: Pick<Project, "characters" | "assets">,
  asset: ProductionAssetVisualStyleTarget,
): Pick<ProductionAssetVisualStyleProjection, "assetOverride" | "overrideSource"> => {
  if (asset.assetType === "character") {
    const character = project.characters.find((entry) => entry.id === asset.assetId);
    return {
      assetOverride: character?.visualOverride,
      overrideSource: character ? "project.characters" : "none",
    };
  }
  const canonicalAsset = project.assets.find((entry) =>
    entry.id === asset.assetId && entry.type === asset.assetType);
  return {
    assetOverride: canonicalAsset?.visualOverride,
    overrideSource: canonicalAsset ? "project.assets" : "none",
  };
};

export const buildProductionAssetVisualStyleProjection = ({
  project,
  asset,
}: {
  project: Pick<Project, "visualStyleLock" | "characters" | "assets">;
  asset: ProductionAssetVisualStyleTarget;
}): ProductionAssetVisualStyleProjection => {
  const intent = asset.variantId ? "asset_state" as const : "asset_identity" as const;
  const target: VisualProjectionTarget = {
    entityType: asset.assetType,
    entityId: asset.assetId,
  };
  const canonical = resolveCanonicalAssetOverride(project, asset);
  const projection = projectVisualStyleForArtifact({
    styleLock: applyCreativeVisualBinding(resolveProductionCreativeVisual(project), [...project.characters, ...project.assets].find(owner => owner.id === asset.assetId)?.creativeDirection?.visual),
    intent,
    target,
    assetOverride: canonical.assetOverride,
  });
  const readableAssetTarget = `${assetTypeLabel(asset.assetType)}“${asset.assetName}”${
    asset.variantName ? `（状态“${asset.variantName}”）` : ""
  }`;
  const assignmentTargetLabels = Object.fromEntries(projection.mediumAssignments.map((assignment) => {
    if (assignment.target.scope === "whole") return [assignment.id, "整个制作画面"];
    if (assignment.target.scope === "entity") {
      return [assignment.id, readableAssetTarget];
    }
    return [assignment.id, "当前资产视觉层"];
  }));
  return {
    intent,
    target,
    ...canonical,
    projection,
    rendered: renderVisualStyleProjectionInstruction(projection, { assignmentTargetLabels }),
  };
};
