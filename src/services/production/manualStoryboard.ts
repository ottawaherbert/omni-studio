import { sha256 } from "js-sha256";
import type {
  ManualStoryboardAgentQuality,
  ManualStoryboardAction,
  ManualStoryboardPromptAudit,
  ManualStoryboardStepRecord,
  ManualStoryboardWorkspace,
  Scene,
  Shot,
} from "../../types/project";
import type { ManualFilmTeamReadModel } from "./manualFilmTeamReadModel";
import type { ManualProductionAssetReadModel } from "./manualProductionAssets";
import {
  isStoryboardAgentQualityPassing,
  STORYBOARD_AGENT_QUALITY_THRESHOLD,
} from "./storyboardShotAgent";

export type ManualStoryboardStepStatus = "missing" | "ready" | "stale";
export type ManualStoryboardQAStatus = "missing" | "ready" | "confirmed" | "needs_revision" | "stale";

export interface ManualStoryboardReadModel {
  schemaVersion: "manual-storyboard-read-model.v1";
  sourceHash: string;
  shotPlanHash: string;
  imagePromptSourceHash: string;
  imagePromptHash: string;
  videoPromptSourceHash: string;
  videoPromptHash: string;
  visualPromptSourceHash: string;
  visualPromptHash: string;
  qaSourceHash: string;
  automaticQAScore?: number;
  automaticQASummary?: string;
  shotPlanStatus: ManualStoryboardStepStatus;
  shotPlanQAStatus: ManualStoryboardQAStatus;
  imagePromptStatus: ManualStoryboardStepStatus;
  imagePromptQAStatus: ManualStoryboardQAStatus;
  videoPromptStatus: ManualStoryboardStepStatus;
  videoPromptQAStatus: ManualStoryboardQAStatus;
  visualPromptStatus: ManualStoryboardStepStatus;
  qaStatus: ManualStoryboardQAStatus;
  shotPlanAccepted: boolean;
  imagePromptAccepted: boolean;
  videoPromptAccepted: boolean;
  readyForShotGeneration: boolean;
  readyForVisualPromptGeneration: boolean;
  readyForImagePromptGeneration: boolean;
  readyForVideoPromptGeneration: boolean;
  readyForStudioVideoGeneration: boolean;
  readyForStoryboardDraftGeneration: boolean;
  readyForStoryboardFormalAdoption: boolean;
  /** @deprecated Use readyForStoryboardFormalAdoption. */
  readyForStoryboardBoardGeneration: boolean;
  staleReasons: string[];
}

const shotPlanValue = (shot: Shot) => ({
  ...(shot.directing ? { directing: shot.directing } : {}),
  id: shot.id,
  ...(shot.appearance ? { appearance: shot.appearance } : {}),
  ...(shot.creativeDirection ? { creativeDirection: shot.creativeDirection } : {}),
  ...(shot.soundDesign ? { soundDesign: shot.soundDesign } : {}),
  ...(shot.editingNote ? { editingNote: shot.editingNote } : {}),
  ...(shot.transition ? { transition: shot.transition } : {}),
  duration: shot.duration || 0,
  motivation: shot.motivation || "",
  shotSize: shot.shotSize || "",
  cameraAngle: shot.cameraAngle || "",
  cameraMovement: shot.cameraMovement || "",
  focalLength: shot.focalLength || "",
  composition: shot.composition || "",
  blocking: shot.blocking || "",
  continuityNote: shot.continuityNote || "",
  visualAction: shot.visualAction || "",
  microExpression: shot.microExpression || "",
  lightingAtmo: shot.lightingAtmo || "",
  characterIdsInShot: shot.characterIdsInShot || [],
  locationId: shot.locationId || "",
  propIds: shot.propIds || [],
  vehicleIds: shot.vehicleIds || [],
  dialogueLines: shot.dialogueLines || [],
  compositionData: shot.compositionData || null,
});

const visualPromptValue = (shot: Shot) => ({
  id: shot.id,
  visualSummary: shot.visualSummary || "",
  imagePrompt: shot.imagePrompt || "",
  videoPrompt: shot.videoPrompt || "",
});

const imagePromptValue = (shot: Shot) => ({
  id: shot.id,
  visualSummary: shot.visualSummary || "",
  imagePrompt: shot.imagePrompt || "",
});

const videoPromptValue = (shot: Shot) => ({
  id: shot.id,
  videoPrompt: shot.videoPrompt || "",
});

export const manualStoryboardHash = (value: unknown) => sha256(JSON.stringify(value));

const semanticSceneVisualPack = (assets: ManualProductionAssetReadModel) => assets.sceneVisualPack ? {
  visualFingerprint: assets.sceneVisualPack.visualFingerprint,
  location: assets.sceneVisualPack.location,
  characters: assets.sceneVisualPack.characters,
  props: assets.sceneVisualPack.props,
  continuityIn: assets.sceneVisualPack.continuityIn,
  continuityOut: assets.sceneVisualPack.continuityOut,
} : null;

const semanticDepartmentOutput = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = value as Record<string, unknown>;
  return {
    taskSummary: output.taskSummary || "",
    handoffNotes: output.handoffNotes || [],
    handoffs: output.handoffs || [],
    collaborationSourceVersions: output.collaborationSourceVersions || {},
    collaborationHandoffIds: output.collaborationHandoffIds || [],
    version: output.version || 0,
    promptHash: output.promptHash || "",
  };
};

const confirmationSensitiveDepartmentOutput = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = value as Record<string, unknown>;
  return {
    ...semanticDepartmentOutput(value),
    status: output.status || "",
    qaVerdict: output.qaVerdict || "",
    qaScore: output.qaScore ?? null,
    openQuestionCount: output.openQuestionCount || 0,
    reviewedSceneIds: output.reviewedSceneIds || [],
  };
};

const legacySummaryDepartmentOutput = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>), content: "" };
};

export const buildManualStoryboardSourceHash = (
  filmTeam: ManualFilmTeamReadModel,
  assets: ManualProductionAssetReadModel,
) => manualStoryboardHash({
  sourceScriptHash: filmTeam.sourceScriptHash,
  departmentOutputs: filmTeam.departmentPrepPackages.map((item) => ({
    department: item.department,
    manualOutput: semanticDepartmentOutput(item.specialistPayload?.manualOutput),
  })),
  sceneVisualPack: semanticSceneVisualPack(assets),
  assetBoards: assets.assetBoards.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    prompt: item.prompt || "",
  })),
});

// Compatibility for storyboard records created before confirmation/readiness
// metadata was removed from the semantic dependency hash.
export const buildConfirmationSensitiveManualStoryboardSourceHash = (
  filmTeam: ManualFilmTeamReadModel,
  assets: ManualProductionAssetReadModel,
) => manualStoryboardHash({
  sourceScriptHash: filmTeam.sourceScriptHash,
  departmentOutputs: filmTeam.departmentPrepPackages.map((item) => ({
    department: item.department,
    readiness: item.readiness,
    manualOutput: confirmationSensitiveDepartmentOutput(item.specialistPayload?.manualOutput),
  })),
  sceneVisualPack: semanticSceneVisualPack(assets),
  assetBoards: assets.assetBoards.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    approvalState: item.approvalState,
  })),
});

// Read-only compatibility for records adopted from the compact storyboard view,
// where department bodies were intentionally omitted.
export const buildLegacySummaryManualStoryboardSourceHash = (
  filmTeam: ManualFilmTeamReadModel,
  assets: ManualProductionAssetReadModel,
) => manualStoryboardHash({
  sourceScriptHash: filmTeam.sourceScriptHash,
  departmentOutputs: filmTeam.departmentPrepPackages.map((item) => ({
    department: item.department,
    readiness: item.readiness,
    manualOutput: legacySummaryDepartmentOutput(item.specialistPayload?.manualOutput),
  })),
  sceneVisualPack: semanticSceneVisualPack(assets),
  assetBoards: assets.assetBoards.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    approvalState: item.approvalState,
  })),
});

// Read-only compatibility for records created before reference images became a visual-only dependency.
export const buildLegacyManualStoryboardSourceHash = (
  filmTeam: ManualFilmTeamReadModel,
  assets: ManualProductionAssetReadModel,
) => manualStoryboardHash({
  sourceScriptHash: filmTeam.sourceScriptHash,
  departmentOutputs: filmTeam.departmentPrepPackages.map((item) => ({
    department: item.department,
    readiness: item.readiness,
    manualOutput: item.specialistPayload?.manualOutput || null,
  })),
  sceneVisualPack: assets.sceneVisualPack || null,
  assetBoards: assets.assetBoards.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    promptHash: item.promptHash,
    referenceImageUrl: item.referenceImageUrl || "",
    approvalState: item.approvalState,
  })),
});

export const buildManualShotPlanHash = (shots: Shot[] = []) =>
  manualStoryboardHash(shots.map(shotPlanValue));

export const buildManualVisualPromptSourceHash = (sourceHash: string, shots: Shot[] = []) =>
  manualStoryboardHash({ sourceHash, shotPlan: shots.map(shotPlanValue) });

export const buildManualVisualPromptHash = (shots: Shot[] = []) =>
  manualStoryboardHash(shots.map(visualPromptValue));

export const buildManualImagePromptHash = (shots: Shot[] = []) =>
  manualStoryboardHash(shots.map(imagePromptValue));

export const buildManualVideoPromptHash = (shots: Shot[] = []) =>
  manualStoryboardHash(shots.map(videoPromptValue));

export const getManualVideoPromptLayerStatus = ({
  scene,
  sourceHash: _sourceHash,
}: {
  scene: Scene | undefined;
  sourceHash: string;
}): ManualStoryboardStepStatus => {
  const shots = scene?.shots || [];
  const record = scene?.manualStoryboard?.videoPrompts;
  const quality = record?.qa || record?.audit.agentQuality;
  if (!shots.length || !record || !record.confirmedAt || !(isAuthorConfirmedRecord(record) || quality && isStoryboardAgentQualityPassing(quality))) {
    return "missing";
  }
  return shots.every((shot) => Boolean(shot.videoPrompt?.trim()))
    && record.outputHash === buildManualVideoPromptHash(shots)
    ? "ready"
    : "stale";
};

export const isManualVideoPromptLayerConfirmed = (input: {
  scene: Scene | undefined;
  sourceHash: string;
}) => getManualVideoPromptLayerStatus(input) === "ready";

export const buildManualStoryboardQASourceHash = (
  sourceHash: string,
  shotPlanHash: string,
  visualPromptHash: string,
) => manualStoryboardHash({ sourceHash, shotPlanHash, visualPromptHash });

const buildAuthorConfirmationAudit = ({
  action,
  sourceHash,
  outputHash,
  now,
}: {
  action: ManualStoryboardAction;
  sourceHash: string;
  outputHash: string;
  now: number;
}): ManualStoryboardPromptAudit => ({
  action,
  templateId: "storyboard.author-confirmation",
  promptHash: manualStoryboardHash({ sourceHash, outputHash, confirmedAt: now }),
  modelId: "manual-author",
  selectedSkillIds: [],
  selectedSkillTitles: [],
  selectedContextIds: [],
  createdAt: now,
});

const isAuthorConfirmedRecord = (record?: ManualStoryboardStepRecord) => Boolean(
  record?.confirmedAt
  && record.audit.templateId === "storyboard.author-confirmation"
  && record.audit.modelId === "manual-author",
);

// Older author saves contained a fabricated 100-point QA. Preserve their adoption,
// but never count that placeholder (or an author's self-review) as independent QA.
const independentStepQuality = (record?: ManualStoryboardStepRecord) => {
  const quality = record?.qa || record?.audit.agentQuality;
  return isAuthorConfirmedRecord(record) || quality?.reviewKind === "author_self_review" ? undefined : quality;
};

export const canRebaseManualStoryboardAuthorEdit = (
  workspace: ManualStoryboardWorkspace | undefined,
  sourceHash: string | undefined,
) => Boolean(
  sourceHash
  && (!workspace?.shotPlan || workspace.shotPlan.sourceHash === sourceHash),
);

/** Merge only fields the author changed; never roll back media generated while editing. */
export function mergeShotAuthorDraft(original: Shot, draft: Partial<Shot>, current: Shot) {
  if (original.id !== current.id || (draft.id && draft.id !== current.id)) throw new Error("镜头已变化，请重新打开编辑。");
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const editable: Array<keyof Shot> = ['visualAction', 'shotSize', 'cameraAngle', 'cameraMovement', 'lighting', 'lightingAtmo', 'microExpression', 'motivation', 'activeVisualLayerIds', 'imagePrompt', 'videoPrompt', 'visualSummary', 'focalLength', 'composition', 'blocking', 'continuityNote', 'soundDesign', 'editingNote', 'duration', 'transition', 'directing'];
  const changedKeys = editable.filter(key => Object.prototype.hasOwnProperty.call(draft, key) && !same(draft[key], original[key]));
  if (changedKeys.some(key => !same(current[key], original[key]) && !same(current[key], draft[key]))) throw new Error("正在编辑的镜头字段已被其他操作修改，草稿仍保留，请核对后重新编辑。");
  return { shot: { ...current, ...Object.fromEntries(changedKeys.map(key => [key, draft[key]])) } as Shot, changedKeys };
}

export const rebaseManualStoryboardAfterAuthorEdit = ({
  workspace,
  shots,
  sourceHash,
  confirmShotPlan,
  confirmImagePrompts,
  confirmVideoPrompts,
  now = Date.now(),
}: {
  workspace?: ManualStoryboardWorkspace;
  shots: Shot[];
  sourceHash: string;
  confirmShotPlan: boolean;
  confirmImagePrompts: boolean;
  confirmVideoPrompts: boolean;
  now?: number;
}): ManualStoryboardWorkspace => {
  const shotPlanHash = buildManualShotPlanHash(shots);
  const promptSourceHash = buildManualVisualPromptSourceHash(sourceHash, shots);
  const imagePromptHash = buildManualImagePromptHash(shots);
  const videoPromptHash = buildManualVideoPromptHash(shots);
  const authorRecord = (
    action: ManualStoryboardAction,
    recordSourceHash: string,
    outputHash: string,
  ) => ({
    sourceHash: recordSourceHash,
    outputHash,
    audit: buildAuthorConfirmationAudit({ action, sourceHash: recordSourceHash, outputHash, now }),
    adoptedAt: now,
    confirmedAt: now,
  });

  return {
    ...(workspace || { schemaVersion: "manual-storyboard.v1" as const, updatedAt: now }),
    schemaVersion: "manual-storyboard.v1",
    shotPlan: confirmShotPlan
      ? authorRecord("generate_shots", sourceHash, shotPlanHash)
      : workspace?.shotPlan,
    imagePrompts: confirmImagePrompts && shots.every((shot) => Boolean(shot.imagePrompt?.trim()))
      ? authorRecord("generate_image_prompts", promptSourceHash, imagePromptHash)
      : workspace?.imagePrompts,
    videoPrompts: confirmVideoPrompts && shots.every((shot) => Boolean(shot.videoPrompt?.trim()))
      ? authorRecord("generate_video_prompts", promptSourceHash, videoPromptHash)
      : workspace?.videoPrompts,
    visualPrompts: undefined,
    qa: undefined,
    boards: workspace?.boards || [],
    updatedAt: now,
  };
};

export const rebaseManualStoryboardAfterShotDeletion = ({
  workspace,
  shots,
  sourceHash,
  now,
}: {
  workspace?: ManualStoryboardWorkspace;
  shots: Shot[];
  sourceHash?: string;
  now?: number;
}): ManualStoryboardWorkspace | undefined => {
  if (!sourceHash || !canRebaseManualStoryboardAuthorEdit(workspace, sourceHash)) return workspace;
  return rebaseManualStoryboardAfterAuthorEdit({
    workspace,
    shots,
    sourceHash,
    confirmShotPlan: true,
    confirmImagePrompts: false,
    confirmVideoPrompts: false,
    now,
  });
};

const confirmedDependencyPredates = (value: unknown, adoptedAt: number) =>
  Number.isFinite(Number(value)) && Number(value) <= adoptedAt;

const canTrustPersistedShotLineage = ({
  scene,
  filmTeam,
  assets,
  shotPlanHash,
}: {
  scene: Scene;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
  shotPlanHash: string;
}) => {
  const shotRecord = scene.manualStoryboard?.shotPlan;
  if (
    !shotRecord
    || !shotRecord.audit.agentQuality
    || !Number.isFinite(shotRecord.adoptedAt)
  ) return false;
  const adoptedAt = shotRecord.adoptedAt;
  if (
    shotRecord.outputHash !== shotPlanHash
    || !isStoryboardAgentQualityPassing(shotRecord.audit.agentQuality)
    || !filmTeam.directorCockpit?.readyForStoryboard
    || !assets.readyForShotPlanning
  ) return false;

  const breakdownConfirmedAt = scene.productionPreparation?.breakdown?.confirmedAt;
  if (!confirmedDependencyPredates(breakdownConfirmedAt, adoptedAt)) return false;
  const departmentsPredateAdoption = filmTeam.departmentPrepPackages.every((item) => {
    const output = item.specialistPayload?.manualOutput as Record<string, unknown> | undefined;
    return output?.status === "confirmed"
      && confirmedDependencyPredates(output.updatedAt, adoptedAt)
      && confirmedDependencyPredates(output.confirmedAt, adoptedAt);
  });
  const assetsPredateAdoption = assets.assetBoards.every((board) =>
    board.approvalState === "confirmed"
    && confirmedDependencyPredates(board.approvalConfirmedAt, adoptedAt));
  return departmentsPredateAdoption && assetsPredateAdoption;
};

export const buildManualStoryboardReadModel = ({
  scene,
  filmTeam,
  assets,
}: {
  scene: Scene;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
}): ManualStoryboardReadModel => {
  const shots = scene.shots || [];
  const workspaceScene = scene as Scene & {
    __workspaceShotPlanHash?: string;
    __workspaceImagePromptHash?: string;
    __workspaceVideoPromptHash?: string;
    __workspaceVisualPromptHash?: string;
    __workspaceVisualPromptSourceHash?: string;
    __workspaceHasImagePrompts?: boolean;
    __workspaceHasVideoPrompts?: boolean;
    __workspaceHasVisualPrompts?: boolean;
  };
  const canonicalSourceHash = buildManualStoryboardSourceHash(filmTeam, assets);
  const preConfirmationAssets: ManualProductionAssetReadModel = {
    ...assets,
    assetBoards: assets.assetBoards.map((board) => board.approvalState === "confirmed"
      ? { ...board, approvalState: "needs_confirmation" }
      : board),
  };
  const compatibleSourceHashes = Array.from(new Set([
    canonicalSourceHash,
    buildConfirmationSensitiveManualStoryboardSourceHash(filmTeam, assets),
    buildConfirmationSensitiveManualStoryboardSourceHash(filmTeam, preConfirmationAssets),
    buildLegacyManualStoryboardSourceHash(filmTeam, assets),
    buildLegacyManualStoryboardSourceHash(filmTeam, preConfirmationAssets),
    buildLegacySummaryManualStoryboardSourceHash(filmTeam, assets),
    buildLegacySummaryManualStoryboardSourceHash(filmTeam, preConfirmationAssets),
  ]));
  const shotPlanHash = workspaceScene.__workspaceShotPlanHash || buildManualShotPlanHash(shots);
  const visualPromptHash = workspaceScene.__workspaceVisualPromptHash || buildManualVisualPromptHash(shots);
  const imagePromptHash = workspaceScene.__workspaceImagePromptHash || buildManualImagePromptHash(shots);
  const videoPromptHash = workspaceScene.__workspaceVideoPromptHash || buildManualVideoPromptHash(shots);
  const shotRecord = scene.manualStoryboard?.shotPlan;
  const imagePromptRecord = scene.manualStoryboard?.imagePrompts;
  const videoPromptRecord = scene.manualStoryboard?.videoPrompts;
  if (canTrustPersistedShotLineage({ scene, filmTeam, assets, shotPlanHash }) && shotRecord) {
    compatibleSourceHashes.push(shotRecord.sourceHash);
  }
  const shotSourceMatches = Boolean(shotRecord && compatibleSourceHashes.includes(shotRecord.sourceHash));
  // Preserve the dependency lineage of compatible historical records so
  // downstream storyboard-board hashes do not all become stale at once.
  const sourceHash = shotSourceMatches ? shotRecord!.sourceHash : canonicalSourceHash;
  const imagePromptSourceHash = workspaceScene.__workspaceVisualPromptSourceHash
    || buildManualVisualPromptSourceHash(sourceHash, shots);
  const videoPromptSourceHash = imagePromptSourceHash;
  const visualPromptSourceHash = imagePromptSourceHash;
  const imagePromptSourceMatches = imagePromptRecord?.sourceHash === imagePromptSourceHash;
  const videoPromptSourceMatches = videoPromptRecord?.sourceHash === videoPromptSourceHash;
  const qaSourceHash = buildManualStoryboardQASourceHash(sourceHash, shotPlanHash, visualPromptHash);
  const hasImagePrompts = workspaceScene.__workspaceHasImagePrompts
    ?? (shots.length > 0 && shots.every((shot) => Boolean(shot.imagePrompt?.trim())));
  const hasVideoPrompts = workspaceScene.__workspaceHasVideoPrompts
    ?? (shots.length > 0 && shots.every((shot) => Boolean(shot.videoPrompt?.trim())));
  const shotAgentQuality = independentStepQuality(shotRecord);
  const imageAgentQuality = independentStepQuality(imagePromptRecord);
  const videoAgentQuality = independentStepQuality(videoPromptRecord);
  const automaticQAScore = shotAgentQuality && imageAgentQuality && videoAgentQuality
    ? Math.min(shotAgentQuality.score, imageAgentQuality.score, videoAgentQuality.score)
    : undefined;
  const automaticQAPassing = Boolean(
    shotAgentQuality
    && imageAgentQuality
    && videoAgentQuality
    && isStoryboardAgentQualityPassing(shotAgentQuality)
    && isStoryboardAgentQualityPassing(imageAgentQuality)
    && isStoryboardAgentQualityPassing(videoAgentQuality)
    && automaticQAScore !== undefined
    && automaticQAScore >= STORYBOARD_AGENT_QUALITY_THRESHOLD,
  );

  const shotPlanStatus: ManualStoryboardStepStatus = !shots.length || !shotRecord
    ? "missing"
    : !shotSourceMatches || shotRecord.outputHash !== shotPlanHash
      ? "stale"
      : "ready";
  const imagePromptStatus: ManualStoryboardStepStatus = !hasImagePrompts || !imagePromptRecord
    ? "missing"
    : !imagePromptSourceMatches || imagePromptRecord.outputHash !== imagePromptHash
      ? "stale"
      : "ready";
  const videoPromptStatus: ManualStoryboardStepStatus = !hasVideoPrompts || !videoPromptRecord
    ? "missing"
    : !videoPromptSourceMatches || videoPromptRecord.outputHash !== videoPromptHash
      ? "stale"
      : "ready";
  const visualPromptStatus: ManualStoryboardStepStatus = imagePromptStatus === "ready" && videoPromptStatus === "ready"
    ? "ready"
    : imagePromptStatus === "stale" || videoPromptStatus === "stale"
      ? "stale"
      : "missing";
  const stepQAStatus = (
    record: typeof shotRecord,
    status: ManualStoryboardStepStatus,
    quality: ManualStoryboardAgentQuality | undefined,
  ): ManualStoryboardQAStatus => status === "stale"
    ? "stale"
    : status === "missing" || !record || !quality
      ? "missing"
      : !isStoryboardAgentQualityPassing(quality)
        ? "needs_revision"
        : record.confirmedAt ? "confirmed" : "ready";
  const shotPlanQAStatus = stepQAStatus(shotRecord, shotPlanStatus, shotAgentQuality);
  const imagePromptQAStatus = stepQAStatus(imagePromptRecord, imagePromptStatus, imageAgentQuality);
  const videoPromptQAStatus = stepQAStatus(videoPromptRecord, videoPromptStatus, videoAgentQuality);
  const qaStatus: ManualStoryboardQAStatus = shotPlanQAStatus === "confirmed"
    && imagePromptQAStatus === "confirmed"
    && videoPromptQAStatus === "confirmed"
    && automaticQAPassing
      ? "confirmed"
      : shotPlanQAStatus === "stale" || imagePromptQAStatus === "stale" || videoPromptQAStatus === "stale"
        ? "stale"
        : shotPlanQAStatus === "needs_revision" || imagePromptQAStatus === "needs_revision" || videoPromptQAStatus === "needs_revision"
          ? "needs_revision"
          : "missing";

  const staleReasons: string[] = [];
  if (!shotSourceMatches && shotRecord) staleReasons.push("剧本、制片筹备内容或资产状态有更新；已保留镜头方案确认，可按需复核。");
  if (shotRecord?.outputHash !== shotPlanHash && shotRecord) staleReasons.push("镜头方案已被人工编辑；已保留后续提示词确认，可按需更新。");
  if (imagePromptStatus === "stale") staleReasons.push("镜头方案或图片提示词有更新；已保留图片提示词确认，可按需更新。");
  if (videoPromptStatus === "stale") staleReasons.push("镜头方案或视频提示词有更新；已保留视频提示词确认，可按需更新。");

  const acceptedStep = (
    record: typeof shotRecord,
    status: ManualStoryboardStepStatus,
    quality: ManualStoryboardAgentQuality | undefined,
  ) => {
    const savedQuality = record?.qa || record?.audit.agentQuality;
    const authorReviewed = savedQuality?.reviewKind === "author_self_review"
      && isStoryboardAgentQualityPassing(savedQuality);
    return Boolean(record && status !== "missing" && record.confirmedAt
      && (isAuthorConfirmedRecord(record) || authorReviewed || quality && isStoryboardAgentQualityPassing(quality)));
  };
  const shotPlanAccepted = acceptedStep(shotRecord, shotPlanStatus, shotAgentQuality);
  const imagePromptAccepted = acceptedStep(imagePromptRecord, imagePromptStatus, imageAgentQuality);
  const videoPromptAccepted = Boolean(
    acceptedStep(videoPromptRecord, videoPromptStatus, videoAgentQuality)
    && videoPromptRecord?.outputHash === videoPromptHash,
  );
  const readyForStoryboardFormalAdoption = shots.length > 0;

  return {
    schemaVersion: "manual-storyboard-read-model.v1",
    sourceHash,
    shotPlanHash,
    imagePromptSourceHash,
    imagePromptHash,
    videoPromptSourceHash,
    videoPromptHash,
    visualPromptSourceHash,
    visualPromptHash,
    qaSourceHash,
    automaticQAScore,
    automaticQASummary: automaticQAPassing
      ? `镜头、图片提示词与视频提示词分别通过独立质检，综合最低分 ${automaticQAScore}。`
      : undefined,
    shotPlanStatus,
    shotPlanQAStatus,
    imagePromptStatus,
    imagePromptQAStatus,
    videoPromptStatus,
    videoPromptQAStatus,
    visualPromptStatus,
    qaStatus,
    shotPlanAccepted,
    imagePromptAccepted,
    videoPromptAccepted,
    readyForShotGeneration: Boolean(scene.script?.trim() || shots.length),
    readyForVisualPromptGeneration: shots.length > 0,
    readyForImagePromptGeneration: shots.length > 0,
    readyForVideoPromptGeneration: shots.length > 0,
    readyForStudioVideoGeneration: shots.length > 0,
    readyForStoryboardDraftGeneration: shots.length > 0,
    readyForStoryboardFormalAdoption,
    readyForStoryboardBoardGeneration: readyForStoryboardFormalAdoption,
    staleReasons: Array.from(new Set(staleReasons)),
  };
};
