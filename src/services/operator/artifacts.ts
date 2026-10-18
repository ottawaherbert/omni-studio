import {
  OperatorArtifactEnvelope,
  OperatorArtifactKind,
  OperatorArtifactStatus,
  OperatorQANextAction,
  OperatorQAStatus,
  OperatorQAVerdict,
  OperatorRegisteredAsset,
  OperatorRun,
} from "./types";

const artifactKinds: OperatorArtifactKind[] = [
  "project_patch",
  "episode_patch",
  "scene_patch",
  "storyboard_shots",
  "shot_patch",
  "character_patch",
  "asset_patch",
  "media_reference",
  "performance_beats",
  "storyboard_board",
  "scene_visual_pack",
  "formal_asset_package",
  "asset_identity_board",
  "scene_asset_variant_pack",
  "asset_variant_fingerprint",
  "asset_reference_pack",
  "video_generation_unit",
  "style_reference_analysis",
  "visual_style_lock_candidate",
  "style_lock_change_order",
  "storyboard_strategy_draft",
  "storyboard_strategy_draft_trial",
  "production_coordination_report",
  "coordination_repair_ticket",
  "development_asset_brief",
  "script_lock_package",
  "content_lock_package",
  "production_block_lock",
  "production_breakdown_report",
  "continuity_matrix",
  "role_slot",
  "casting_candidate",
  "casting_requirement",
  "casting_decision",
  "department_prep_package",
  "creative_change_request",
  "series_change_order",
  "pending_asset",
  "variant_request",
  "local_resync_plan",
  "qa_report",
  "custom",
];

const artifactStatuses: OperatorArtifactStatus[] = ["draft", "qa_failed", "approved", "committed", "quarantined"];
const qaStatuses: OperatorQAStatus[] = ["passed", "warning", "failed"];
const nextActions: OperatorQANextAction[] = ["commit", "retry", "human_review", "waiveable", "blocked"];
const assetKinds: OperatorRegisteredAsset["kind"][] = ["image", "audio", "video", "document", "audit"];

const createId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
);

const normalizeIssue = (issue: any) => ({
  id: String(issue?.id || issue?.fingerprint || createId("operator_issue")),
  severity: String(issue?.severity || "warning"),
  target: issue?.target ? String(issue.target) : undefined,
  message: String(issue?.message || issue?.suggestion || "").trim(),
  sourceRunId: issue?.sourceRunId ? String(issue.sourceRunId) : undefined,
  createdAt: issue?.createdAt ? Number(issue.createdAt) : Date.now(),
});

export const normalizeOperatorQAVerdict = (input: any): OperatorQAVerdict => {
  const status = qaStatuses.includes(input?.status) ? input.status : "warning";
  const blocking = Boolean(input?.blocking || status === "failed");
  const nextAction = nextActions.includes(input?.nextAction)
    ? input.nextAction
    : blocking
      ? "retry"
      : "commit";
  return {
    qaAgentId: String(input?.qaAgentId || "operator.manual_qa"),
    status,
    blocking,
    score: Number.isFinite(Number(input?.score)) ? Number(input.score) : blocking ? 0 : 100,
    issues: Array.isArray(input?.issues) ? input.issues.map(normalizeIssue) : [],
    nextAction,
    createdAt: Number(input?.createdAt || Date.now()),
  };
};

export const createOperatorArtifact = (
  input: any,
  run: OperatorRun,
): OperatorArtifactEnvelope => {
  const now = Date.now();
  const kind = artifactKinds.includes(input?.kind) ? input.kind : "custom";
  const status = artifactStatuses.includes(input?.status) ? input.status : "draft";
  return {
    id: String(input?.id || createId("operator_artifact")),
    runId: run.id,
    projectId: run.projectId,
    kind,
    targetPath: String(input?.targetPath || kind),
    entityIds: normalizeStringArray(input?.entityIds),
    status,
    data: input?.data ?? {},
    qaVerdicts: Array.isArray(input?.qaVerdicts)
      ? input.qaVerdicts.map(normalizeOperatorQAVerdict)
      : [],
    provenance: {
      provider: run.provider,
      handbookVersion: run.handbookVersion,
      source: "operator",
      inputContextHash: input?.provenance?.inputContextHash ? String(input.provenance.inputContextHash) : undefined,
      userRequestHash: input?.provenance?.userRequestHash ? String(input.provenance.userRequestHash) : undefined,
      generatedAt: Number(input?.provenance?.generatedAt || now),
    },
    commitResult: input?.commitResult,
    createdAt: Number(input?.createdAt || now),
    updatedAt: Number(input?.updatedAt || now),
  };
};

export const appendOperatorArtifactQAVerdict = (
  artifact: OperatorArtifactEnvelope,
  verdictInput: any,
): OperatorArtifactEnvelope => {
  const verdict = normalizeOperatorQAVerdict(verdictInput);
  const qaVerdicts = [...(artifact.qaVerdicts || []), verdict];
  const status: OperatorArtifactStatus = verdict.blocking || verdict.status === "failed"
    ? "qa_failed"
    : "approved";
  return {
    ...artifact,
    qaVerdicts,
    status,
    updatedAt: Date.now(),
  };
};

export const isOperatorArtifactApproved = (artifact: OperatorArtifactEnvelope) => {
  if (artifact.status !== "approved" && artifact.status !== "draft" && artifact.status !== "qa_failed") return false;
  const verdicts = artifact.qaVerdicts || [];
  const latestVerdict = verdicts[verdicts.length - 1];
  return Boolean(latestVerdict && !latestVerdict.blocking && latestVerdict.status !== "failed");
};

export const markOperatorArtifactCommitted = (
  artifact: OperatorArtifactEnvelope,
  commitResult: NonNullable<OperatorArtifactEnvelope["commitResult"]>,
): OperatorArtifactEnvelope => ({
  ...artifact,
  status: "committed",
  commitResult,
  updatedAt: Date.now(),
});

export const createOperatorRegisteredAsset = (input: any): OperatorRegisteredAsset => {
  const now = Date.now();
  const projectId = String(input?.projectId || "").trim();
  if (!projectId) throw new Error("Operator asset requires projectId.");
  return {
    id: String(input?.id || createId("operator_asset")),
    projectId,
    runId: input?.runId ? String(input.runId) : undefined,
    artifactId: input?.artifactId ? String(input.artifactId) : undefined,
    kind: assetKinds.includes(input?.kind) ? input.kind : "image",
    mediaUrl: input?.mediaUrl ? String(input.mediaUrl) : undefined,
    localPath: input?.localPath ? String(input.localPath) : undefined,
    prompt: input?.prompt ? String(input.prompt) : undefined,
    targetEntity: input?.targetEntity && typeof input.targetEntity === "object"
      ? {
          type: input.targetEntity.type || "project",
          id: input.targetEntity.id ? String(input.targetEntity.id) : undefined,
          episodeId: input.targetEntity.episodeId ? String(input.targetEntity.episodeId) : undefined,
          sceneId: input.targetEntity.sceneId ? String(input.targetEntity.sceneId) : undefined,
          field: input.targetEntity.field ? String(input.targetEntity.field) : undefined,
        }
      : undefined,
    qaStatus: qaStatuses.includes(input?.qaStatus) ? input.qaStatus : undefined,
    metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    createdAt: Number(input?.createdAt || now),
    updatedAt: Number(input?.updatedAt || now),
  };
};
