import { isOperatorArtifactApproved, createOperatorArtifact } from "./artifacts";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorArtifactEnvelope } from "./types";
import { buildStoryboardStrategyDraftTrial } from "../production/storyboardStrategyTrial";
import type { StoryboardStrategyDraft } from "../production/storyboardStrategyDraft";
import {
  appendAutoQAToArtifact,
  getOrCreateOperatorRun,
  normalizeStringArray,
  OperatorUseCaseError,
  requireAccessibleProject,
  resolveEpisodesForRequest,
  type OperatorRunArtifactStore,
} from "./useCaseShared";

export interface OperatorStoryboardStrategyStore extends OperatorRunArtifactStore {
  getOperatorArtifactById(id: string): OperatorArtifactEnvelope | null;
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
}

const unwrapStoryboardStrategyDraftArtifact = (artifact: OperatorArtifactEnvelope | null | undefined): StoryboardStrategyDraft | undefined => {
  const data: any = artifact?.data;
  const draft = data?.storyboardStrategyDraft || data?.strategyDraft || data?.draft ||
    (artifact?.kind === "storyboard_strategy_draft" ? data : undefined);
  return draft?.schemaVersion === "storyboard-strategy-draft.v1" ? draft as StoryboardStrategyDraft : undefined;
};

const unwrapStoryboardStrategyTrialArtifact = (artifact: OperatorArtifactEnvelope | null | undefined): any | undefined => {
  const data: any = artifact?.data;
  const trial = data?.storyboardStrategyDraftTrial || data?.strategyTrial || data?.trial ||
    (artifact?.kind === "storyboard_strategy_draft_trial" ? data : undefined);
  return trial?.schemaVersion === "storyboard-strategy-draft-trial.v1" ? trial : undefined;
};

const resolveDraftForTrial = (
  store: Pick<OperatorStoryboardStrategyStore, "getOperatorArtifactById">,
  projectId: string,
  input: any,
) => {
  const draftArtifactId = String(input?.draftArtifactId || input?.storyboardStrategyDraftArtifactId || "").trim();
  const draftArtifact = draftArtifactId ? store.getOperatorArtifactById(draftArtifactId) : null;
  if (draftArtifactId && !draftArtifact) {
    throw new OperatorUseCaseError(404, "storyboard_strategy_draft_not_found", "Storyboard strategy draft artifact not found");
  }
  if (draftArtifact && (draftArtifact.projectId !== projectId || draftArtifact.kind !== "storyboard_strategy_draft")) {
    throw new OperatorUseCaseError(409, "storyboard_strategy_draft_project_mismatch", "Artifact is not a storyboard_strategy_draft for this project");
  }

  const draftFromBody = input?.storyboardStrategyDraft || input?.strategyDraft || input?.draft;
  const draft = (draftFromBody?.schemaVersion === "storyboard-strategy-draft.v1"
    ? draftFromBody
    : unwrapStoryboardStrategyDraftArtifact(draftArtifact)) as StoryboardStrategyDraft | undefined;
  if (!draft) {
    throw new OperatorUseCaseError(400, "storyboard_strategy_draft_required", "Missing storyboardStrategyDraft or draftArtifactId");
  }
  if (draft.projectId && draft.projectId !== projectId) {
    throw new OperatorUseCaseError(409, "storyboard_strategy_draft_project_mismatch", "Storyboard strategy draft does not belong to project");
  }
  return { draft, draftArtifact };
};

const requireDraftArtifactForPromotion = (
  store: Pick<OperatorStoryboardStrategyStore, "getOperatorArtifactById">,
  projectId: string,
  input: any,
) => {
  const draftArtifactId = String(input?.draftArtifactId || input?.storyboardStrategyDraftArtifactId || "").trim();
  const draftArtifact = draftArtifactId ? store.getOperatorArtifactById(draftArtifactId) : null;
  if (!draftArtifact) {
    throw new OperatorUseCaseError(404, "storyboard_strategy_draft_not_found", "Storyboard strategy draft artifact not found");
  }
  if (draftArtifact.projectId !== projectId || draftArtifact.kind !== "storyboard_strategy_draft") {
    throw new OperatorUseCaseError(409, "storyboard_strategy_draft_project_mismatch", "Artifact is not a storyboard_strategy_draft for this project");
  }
  const draft = unwrapStoryboardStrategyDraftArtifact(draftArtifact);
  if (!draft) {
    throw new OperatorUseCaseError(400, "storyboard_strategy_draft_invalid", "Storyboard strategy draft artifact has no structured draft");
  }
  return { draft, draftArtifact };
};

export const createStoryboardStrategyTrialForProject = (
  store: OperatorStoryboardStrategyStore,
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
  const { draft } = resolveDraftForTrial(store, projectId, input);
  const run = getOrCreateOperatorRun(store, {
    projectId,
    input,
    handbookVersion,
    mode: "produce",
    defaultUserRequest: `Trial storyboard strategy draft ${draft.id}.`,
  });

  const sampleSceneIds = normalizeStringArray(input?.sampleSceneIds || input?.sceneIds);
  const trialDraft: StoryboardStrategyDraft = {
    ...draft,
    projectId,
    sampleSceneIds: sampleSceneIds.length ? sampleSceneIds : (draft.sampleSceneIds || []),
  };
  const { episodes } = resolveEpisodesForRequest(project, input || {});
  const storyboardStrategyDraftTrial = buildStoryboardStrategyDraftTrial({
    project,
    episodes,
    draft: trialDraft,
    maxBoards: Number(input?.maxBoards || 1),
  });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "storyboard_strategy_draft_trial",
    targetPath: `operator.storyboardStrategyTrials.${storyboardStrategyDraftTrial.id}`,
    entityIds: [
      projectId,
      trialDraft.id,
      ...storyboardStrategyDraftTrial.sampleSceneIds,
    ].filter(Boolean),
    data: { storyboardStrategyDraftTrial },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Storyboard strategy draft trial created.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      draftId: trialDraft.id,
      status: storyboardStrategyDraftTrial.status,
      renderedBoardCount: storyboardStrategyDraftTrial.renderedBoards.length,
    },
  });

  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    messagePrefix: "Storyboard strategy draft trial",
  });

  return {
    run,
    artifact: finalArtifact,
    storyboardStrategyDraftTrial,
  };
};

export const createStoryboardStrategyPromotionForProject = (
  store: OperatorStoryboardStrategyStore,
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
  const { draft } = requireDraftArtifactForPromotion(store, projectId, input);
  const requestedTrialArtifactIds = normalizeStringArray(input?.trialArtifactIds || input?.storyboardStrategyTrialArtifactIds);
  const requiredSampleSceneIds = normalizeStringArray(input?.requiredSampleSceneIds || input?.sampleSceneIds || input?.sceneIds);
  const allProjectArtifacts = store.listOperatorArtifacts({ projectId });
  const trialArtifacts = requestedTrialArtifactIds.length
    ? requestedTrialArtifactIds.map((trialArtifactId) => {
        const artifact = store.getOperatorArtifactById(trialArtifactId);
        if (!artifact) {
          throw new OperatorUseCaseError(404, "storyboard_strategy_trial_not_found", `Storyboard strategy trial artifact not found: ${trialArtifactId}`);
        }
        if (artifact.projectId !== projectId || artifact.kind !== "storyboard_strategy_draft_trial") {
          throw new OperatorUseCaseError(409, "storyboard_strategy_trial_project_mismatch", `Artifact is not a storyboard_strategy_draft_trial for this project: ${trialArtifactId}`);
        }
        return artifact;
      })
    : allProjectArtifacts.filter((artifact) => artifact.kind === "storyboard_strategy_draft_trial");
  const passedTrials = trialArtifacts
    .map((artifact) => ({ artifact, trial: unwrapStoryboardStrategyTrialArtifact(artifact) }))
    .filter((item) => item.trial?.draftId === draft.id && item.trial?.status === "passed" && isOperatorArtifactApproved(item.artifact));
  if (passedTrials.length === 0) {
    throw new OperatorUseCaseError(
      400,
      "storyboard_strategy_promotion_requires_passed_trial",
      "Global candidate promotion requires at least one QA-approved passed storyboard_strategy_draft_trial for this draft",
    );
  }
  if (requiredSampleSceneIds.length > 0) {
    const coveredSceneIds = new Set(passedTrials.flatMap((item) => item.trial.sampleSceneIds || []));
    const missingSceneIds = requiredSampleSceneIds.filter((sceneId) => !coveredSceneIds.has(sceneId));
    if (missingSceneIds.length > 0) {
      throw new OperatorUseCaseError(
        400,
        "storyboard_strategy_promotion_missing_sample_coverage",
        `Global candidate promotion requires passed trial coverage for sampleSceneIds: ${missingSceneIds.join(", ")}`,
      );
    }
  }

  const run = getOrCreateOperatorRun(store, {
    projectId,
    input,
    handbookVersion,
    mode: "produce",
    defaultUserRequest: `Create global candidate promotion for storyboard strategy draft ${draft.id}.`,
  });
  const globalCandidateDraft: StoryboardStrategyDraft = {
    ...draft,
    id: `global_candidate.${draft.id}.${Date.now()}`,
    projectId,
    scope: "global_candidate",
    status: "approved",
    sampleSceneIds: Array.from(new Set([
      ...(draft.sampleSceneIds || []),
      ...passedTrials.flatMap((item) => item.trial.sampleSceneIds || []),
    ])),
    promotionNotes: [
      draft.promotionNotes,
      input?.promotionNotes,
      requiredSampleSceneIds.length ? `Required sample coverage: ${requiredSampleSceneIds.join(", ")}` : "",
      `Global candidate only. Evidence: ${passedTrials.map((item) => item.artifact.id).join(", ")}`,
    ].filter(Boolean).join("\n"),
  };
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "storyboard_strategy_draft",
    targetPath: `operator.storyboardStrategyPromotions.${globalCandidateDraft.id}`,
    entityIds: [
      projectId,
      draft.id,
      ...passedTrials.map((item) => item.artifact.id),
      ...globalCandidateDraft.sampleSceneIds,
    ].filter(Boolean),
    data: { storyboardStrategyDraft: globalCandidateDraft },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Storyboard strategy global candidate created from passed trial evidence.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      sourceDraftId: draft.id,
      promotionDraftId: globalCandidateDraft.id,
      passedTrialCount: passedTrials.length,
    },
  });

  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    messagePrefix: "Storyboard strategy global candidate",
  });

  return {
    run,
    artifact: finalArtifact,
    storyboardStrategyDraft: globalCandidateDraft,
    passedTrialArtifactIds: passedTrials.map((item) => item.artifact.id),
  };
};
