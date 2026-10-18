import { buildCastingCandidates, buildCastingDecision, buildRoleSlots } from "../production/productionCasting";
import { createOperatorArtifact } from "./artifacts";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorArtifactEnvelope } from "./types";
import {
  appendAutoQAToArtifact,
  getOrCreateOperatorRun,
  normalizeStringArray,
  OperatorUseCaseError,
  requireAccessibleProject,
  type OperatorRunArtifactStore,
} from "./useCaseShared";

export interface OperatorCastingStore extends OperatorRunArtifactStore {
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
}

const collectCastingRequirements = (
  relatedArtifacts: OperatorArtifactEnvelope[],
  requestedRequirementIds: Set<string>,
) => relatedArtifacts
  .filter((artifact) => artifact.kind === "casting_requirement")
  .flatMap((artifact) => {
    const data: any = artifact.data || {};
    const requirements = Array.isArray(data.castingRequirements)
      ? data.castingRequirements
      : data.castingRequirement
        ? [data.castingRequirement]
        : Array.isArray(data)
          ? data
          : [];
    return requestedRequirementIds.size
      ? requirements.filter((requirement: any) => requestedRequirementIds.has(String(requirement?.id || "")))
      : requirements;
  });

const findCastingRequirement = (
  relatedArtifacts: OperatorArtifactEnvelope[],
  castingRequirementId: string,
) => {
  for (const artifact of relatedArtifacts.filter((item) => item.kind === "casting_requirement")) {
    const data: any = artifact.data || {};
    const requirements = Array.isArray(data.castingRequirements)
      ? data.castingRequirements
      : data.castingRequirement
        ? [data.castingRequirement]
        : Array.isArray(data)
          ? data
          : [];
    const match = requirements.find((requirement: any) => requirement?.id === castingRequirementId);
    if (match) {
      return { castingRequirement: match, castingRequirementArtifactId: artifact.id };
    }
  }
  return { castingRequirement: null, castingRequirementArtifactId: "" };
};

const findRoleSlot = (
  relatedArtifacts: OperatorArtifactEnvelope[],
  roleSlotId: string,
) => {
  for (const artifact of relatedArtifacts.filter((item) => item.kind === "role_slot")) {
    const data: any = artifact.data || {};
    const slots = Array.isArray(data.roleSlots)
      ? data.roleSlots
      : data.roleSlot
        ? [data.roleSlot]
        : [];
    const match = slots.find((slot: any) => slot?.id === roleSlotId);
    if (match) return match;
  }
  return null;
};

const createCastingRun = (
  store: OperatorCastingStore,
  {
    projectId,
    input,
    handbookVersion,
    defaultUserRequest,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
    defaultUserRequest: string;
  },
) => getOrCreateOperatorRun(store, {
  projectId,
  input,
  handbookVersion,
  mode: "asset_generation",
  defaultUserRequest,
});

export const createRoleSlotsForProject = (
  store: OperatorCastingStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const run = createCastingRun(store, {
    projectId,
    input,
    handbookVersion,
    defaultUserRequest: "Create role slots for casting workflow",
  });
  const relatedArtifacts = store.listOperatorArtifacts({ projectId });
  const requestedRequirementIds = new Set(normalizeStringArray(input?.castingRequirementIds));
  const castingRequirements = Array.isArray(input?.castingRequirements)
    ? input.castingRequirements
    : collectCastingRequirements(relatedArtifacts, requestedRequirementIds);
  const roleSlots = buildRoleSlots({ project, castingRequirements });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "role_slot",
    targetPath: `operator.productionCasting.roleSlots.${Date.now()}`,
    entityIds: [projectId, ...roleSlots.map((slot) => slot.id)],
    data: { roleSlots },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Role slots created for casting workflow.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, roleSlotCount: roleSlots.length },
  });
  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    emitRunEvent: false,
    messagePrefix: "Role slots",
  });
  return { run, artifact: finalArtifact, roleSlots };
};

export const createCastingCandidatesForProject = (
  store: OperatorCastingStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const run = createCastingRun(store, {
    projectId,
    input,
    handbookVersion,
    defaultUserRequest: `Create casting candidates: ${input?.castingRequirementId || input?.roleSlotId || "role"}`,
  });
  const relatedArtifacts = store.listOperatorArtifacts({ projectId });
  const castingRequirementId = String(input?.castingRequirementId || input?.castingRequirement?.id || "").trim();
  const roleSlotId = String(input?.roleSlotId || input?.roleSlot?.id || input?.castingRequirement?.roleSlotId || "").trim();
  let castingRequirement = input?.castingRequirement || null;
  let roleSlot = input?.roleSlot || null;
  if (!castingRequirement && castingRequirementId) {
    castingRequirement = findCastingRequirement(relatedArtifacts, castingRequirementId).castingRequirement;
  }
  if (!roleSlot && roleSlotId) {
    roleSlot = findRoleSlot(relatedArtifacts, roleSlotId);
  }
  if (!roleSlot && castingRequirement) {
    roleSlot = buildRoleSlots({ project, castingRequirements: [castingRequirement] })[0];
  }
  if (!roleSlot && !castingRequirement) {
    throw new OperatorUseCaseError(
      400,
      "casting_candidate_source_required",
      "Missing roleSlot/roleSlotId or castingRequirement/castingRequirementId",
    );
  }

  const inputCandidates = Array.isArray(input?.candidates)
    ? input.candidates
    : input?.candidate
      ? [input.candidate]
      : [];
  const castingCandidates = buildCastingCandidates({
    projectId,
    roleSlot,
    castingRequirement,
    candidates: inputCandidates,
  });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "casting_candidate",
    targetPath: `operator.productionCasting.candidates.${Date.now()}`,
    entityIds: [
      projectId,
      ...castingCandidates.map((candidate) => candidate.roleSlotId),
      ...castingCandidates.map((candidate) => candidate.id),
    ],
    data: { castingCandidates },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Casting candidates created for director review.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, castingCandidateCount: castingCandidates.length },
  });
  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    emitRunEvent: false,
    messagePrefix: "Casting candidates",
  });
  return { run, artifact: finalArtifact, castingCandidates };
};

export const createCastingDecisionForProject = (
  store: OperatorCastingStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
  },
) => {
  requireAccessibleProject(store, access, projectId);
  const run = createCastingRun(store, {
    projectId,
    input,
    handbookVersion,
    defaultUserRequest: `Create casting decision: ${input?.castingRequirementId || input?.displayName || "role"}`,
  });
  const relatedArtifacts = store.listOperatorArtifacts({ projectId });
  const castingRequirementId = String(input?.castingRequirementId || input?.castingRequirement?.id || "").trim();
  let castingRequirement = input?.castingRequirement || null;
  let castingRequirementArtifactId = String(input?.castingRequirementArtifactId || "").trim();
  if (!castingRequirement && castingRequirementId) {
    const resolved = findCastingRequirement(relatedArtifacts, castingRequirementId);
    castingRequirement = resolved.castingRequirement;
    castingRequirementArtifactId = resolved.castingRequirementArtifactId;
  }
  if (!castingRequirement) {
    throw new OperatorUseCaseError(400, "casting_requirement_required", "Missing castingRequirement or castingRequirementId");
  }

  const castingDecision = buildCastingDecision({
    projectId,
    castingRequirement,
    decisionType: input?.decisionType || "needs_human_casting",
    status: input?.status,
    candidate: input?.candidate,
    directorNotes: input?.directorNotes,
    castingRequirementArtifactId,
    scriptLockPackageId: input?.scriptLockPackageId,
    contentLockPackageId: input?.contentLockPackageId,
    productionBlockLockId: input?.productionBlockLockId,
    approvedBy: input?.approvedBy,
  });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "casting_decision",
    targetPath: `operator.productionCasting.decisions.${castingDecision.id}`,
    entityIds: [
      projectId,
      castingDecision.castingRequirementId,
      castingDecision.roleSlotId,
      ...castingDecision.affectedEpisodeIds,
      ...castingDecision.affectedSceneIds,
      ...castingDecision.affectedNodeIds,
    ],
    data: { castingDecision },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Casting decision created from casting_requirement.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      castingDecisionId: castingDecision.id,
      decisionType: castingDecision.decisionType,
      status: castingDecision.status,
    },
  });

  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    messagePrefix: "Casting decision",
  });

  return {
    run,
    artifact: finalArtifact,
    castingDecision,
  };
};
