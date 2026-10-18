import type { ProductionInteractivePrepProfile, ProductionScenePlanCandidate, ProductionScenePlanVersion, Scene } from "../../../types/project";
import { productionScenesFromPlanCandidate } from "../../../clients/productionPreparationWorkflowClient";

type PlanningNode = ProductionInteractivePrepProfile["nodes"][number];

/** Keep a scene's production identity and downstream work when its source excerpt is unchanged. */
export const reconcileProductionScenes = ({ sourceDocumentId, candidates, planId, nodes, priorPlan, currentScenes }: {
  sourceDocumentId: string;
  candidates: ProductionScenePlanCandidate[];
  planId: string;
  nodes: PlanningNode[];
  priorPlan?: ProductionScenePlanVersion;
  currentScenes: Scene[];
}) => {
  const projected = productionScenesFromPlanCandidate(sourceDocumentId, candidates, planId, nodes);
  const priorByCandidateId = new Map((priorPlan?.candidateScenes || []).map((candidate, index) => [candidate.id, {
    candidate,
    adopted: priorPlan!.adoptedSceneSnapshot[index],
  }]));
  const currentById = new Map(currentScenes.map((scene) => [scene.id, scene]));
  const scenes = projected.map((fresh, index) => {
    const next = candidates[index];
    const prior = priorByCandidateId.get(next.id);
    if (!prior || prior.candidate.sourceEvidence !== next.sourceEvidence || !prior.adopted) return fresh;
    const current = currentById.get(prior.adopted.id);
    if (!current) return fresh;
    const metadataChanged = prior.candidate.continuityIn !== next.continuityIn
      || prior.candidate.continuityOut !== next.continuityOut
      || JSON.stringify(prior.candidate.interactiveNodeIds || []) !== JSON.stringify(next.interactiveNodeIds || []);
    return {
      ...current,
      sceneNumber: fresh.sceneNumber,
      title: prior.candidate.title === next.title ? current.title : next.title,
      description: prior.candidate.description === next.description ? current.description : next.description,
      sceneGoal: prior.candidate.purpose === next.purpose ? current.sceneGoal : next.purpose,
      targetDuration: prior.candidate.targetDurationMinutes === next.targetDurationMinutes ? current.targetDuration : next.targetDurationMinutes,
      interactiveMetadata: metadataChanged ? { ...current.interactiveMetadata, ...fresh.interactiveMetadata } : current.interactiveMetadata,
    } satisfies Scene;
  });
  const retainedIds = new Set(scenes.map((scene) => scene.id));
  const replacedScenes = currentScenes.filter((scene) => !retainedIds.has(scene.id));
  return { scenes, replacedScenes };
};
