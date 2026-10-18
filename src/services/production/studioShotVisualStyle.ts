import { resolveProductionCreativeVisual, creativeExecutionManifest, renderProductionCreativeContext, type ProductionCreativeScope } from "../../../packages/production/src/services/production/creativeDirection";
import type { VisualProjectionTarget } from "../../../packages/domain/src/visualArtifact";
import { isVisualEntityType } from "../../../packages/domain/src/visualStyle";
import type { Project, Shot } from "../../types/project";
import { buildImageVisualStyleProjection } from "./imageVisualStyleProjection";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
} from "./visualStyleProjection";
import { assertVisualStyleReadyForExecution } from "./visualMediumProfiles";

const currentStyleLock = (project: Project) => project.visualStyleLock?.humanApprovalState === "rejected"
  ? undefined
  : project.visualStyleLock;

export const buildStudioShotVisualTargets = (
  project: Pick<Project, "characters" | "assets">,
  shot: Pick<Shot, "characterIdsInShot" | "locationId" | "propIds" | "activeVisualLayerIds">,
): VisualProjectionTarget[] => {
  const assetIds = Array.from(new Set([
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
  ].filter((assetId): assetId is string => Boolean(assetId))));
  const entityTargets = assetIds.flatMap<VisualProjectionTarget>((assetId) => {
    if (project.characters.some((character) => character.id === assetId)) {
      return [{ entityType: "character", entityId: assetId }];
    }
    const asset = project.assets.find((entry) => entry.id === assetId);
    if (!asset) return [];
    return isVisualEntityType(asset.type)
      ? [{ entityType: asset.type, entityId: assetId }]
      : [];
  });
  const layerTargets = Array.from(new Set(shot.activeVisualLayerIds || []))
    .map((layerId) => layerId.trim())
    .filter(Boolean)
    .map((layerId) => ({ layerId }));
  return [...entityTargets, ...layerTargets];
};

const assignmentTargetLabels = (project: Project) => Object.fromEntries(
  (project.visualStyleLock?.mediumAssignments || []).map((assignment) => {
    const target = assignment.target;
    if (target.scope === "whole") return [assignment.id, "当前镜头整体"];
    if (target.scope === "layer") return [assignment.id, `图层“${target.label}”：${target.description}`];
    const name = target.entityType === "character"
      ? project.characters.find((entry) => entry.id === target.entityId)?.name
      : project.assets.find((entry) => entry.id === target.entityId)?.name;
    return [assignment.id, name || "当前镜头主体"];
  }),
);

export const buildStudioShotImageVisualStyleProjection = ({
  project,
  shot,
  episode, scene,
}: {
  project: Project;
  shot: Shot;
  episode?: ProductionCreativeScope["episode"];
  scene?: ProductionCreativeScope["scene"];
}) => buildImageVisualStyleProjection({
  project,
  creativeScope: { episode, scene, shot },
  intent: "final_frame",
  targets: buildStudioShotVisualTargets(project, shot),
  shotOverride: shot.visualOverride,
  assignmentTargetLabels: assignmentTargetLabels(project),
});

export const buildStudioShotVideoVisualStyleProjection = ({
  project,
  shot,
  episode, scene,
}: {
  project: Project;
  shot: Shot;
  episode?: ProductionCreativeScope["episode"];
  scene?: ProductionCreativeScope["scene"];
}) => {
  const styleLock = resolveProductionCreativeVisual(project, { episode, scene, shot });
  assertVisualStyleReadyForExecution(styleLock, "video_clip");
  const projection = projectVisualStyleForArtifact({
    styleLock: styleLock?.humanApprovalState === "rejected" ? undefined : styleLock,
    intent: "video_clip",
    targets: buildStudioShotVisualTargets(project, shot),
    shotOverride: shot.visualOverride,
  });
  const rendered = renderVisualStyleProjectionInstruction(projection, { assignmentTargetLabels: assignmentTargetLabels(project) });
  const creativeDirection = creativeExecutionManifest(project, { episode, scene, shot }, "video");
  return {
    projection,
    rendered: { ...rendered, manifest: { ...rendered.manifest, ...(creativeDirection ? { creativeDirection } : {}) }, instruction: [rendered.instruction, renderProductionCreativeContext(project, { episode, scene, shot }, "video", false)].filter(Boolean).join("\n\n") },
  };
};
