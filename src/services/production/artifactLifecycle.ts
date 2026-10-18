import {
  ArtifactApprovalRecord,
  ArtifactDependencyEdge,
  HumanInterventionTask,
  ProductionArtifact,
  ProductionArtifactLifecycleStatus,
  ProductionGateId,
  ProductionGateVerdict,
  ProductionQAIssue,
  ProductionQAReport,
  ProductionRun,
  ProductionStageRun,
  QAWarningWaiver,
} from "../../types/production";

const nonWaiveableGates = new Set<ProductionGateId>([
  "CONTRACT",
  "GRAPH",
  "PLAYTEST",
]);

const dependencySourceTypes = new Set([
  "concept",
  "bible",
  "character",
  "location",
  "prop",
  "episode",
  "scene",
  "script",
  "breakdown",
  "storyboard",
  "image_prompt",
  "video_prompt",
  "game_graph",
]);

export const canWaiveQAIssue = (
  issue: ProductionQAIssue,
  gateId?: ProductionGateId,
) => {
  if (issue.severity === "blocking" || issue.severity === "error") return false;
  if (gateId && nonWaiveableGates.has(gateId)) return false;
  return Boolean(issue.fingerprint);
};

export const createQAWarningWaiver = (input: {
  stageId: string;
  issue: ProductionQAIssue;
  reason: string;
  artifactId?: string;
  gateId?: ProductionGateId;
  waivedBy?: "author" | "system";
}): QAWarningWaiver => {
  if (!canWaiveQAIssue(input.issue, input.gateId)) {
    throw new Error("该 QA issue 不允许 waiver。");
  }
  if (!input.reason.trim()) {
    throw new Error("waiver 必须记录原因。");
  }
  return {
    id: `qa-waiver-${Date.now()}-${crypto.randomUUID()}`,
    artifactId: input.artifactId,
    stageId: input.stageId,
    issueFingerprint: input.issue.fingerprint!,
    reason: input.reason.trim(),
    downstreamRisk: input.issue.repairInstruction || input.issue.suggestion || input.issue.message,
    waivedBy: input.waivedBy || "author",
    expiresOnUpstreamChange: true,
    createdAt: Date.now(),
  };
};

export const createApprovalRecord = (input: {
  artifactId: string;
  stageId: string;
  action: ArtifactApprovalRecord["action"];
  actor: ArtifactApprovalRecord["actor"];
  reason?: string;
  waiverId?: string;
  now?: number;
}): ArtifactApprovalRecord => ({
  id: `artifact-approval-${input.now || Date.now()}-${crypto.randomUUID()}`,
  artifactId: input.artifactId,
  stageId: input.stageId,
  action: input.action,
  actor: input.actor,
  reason: input.reason,
  waiverId: input.waiverId,
  createdAt: input.now || Date.now(),
});

export const resolveArtifactLifecycleStatus = (input: {
  blocking: boolean;
  hasBlockingGate: boolean;
  requiresHumanReview: boolean;
}): ProductionArtifactLifecycleStatus => {
  if (input.blocking && input.hasBlockingGate) return "quarantined";
  if (input.blocking) return "qa_failed";
  if (input.requiresHumanReview) return "approved";
  return "committed";
};

export const initializeArtifactLifecycle = (input: {
  artifact: ProductionArtifact;
  stage: ProductionStageRun;
  qaReports: ProductionQAReport[];
  gateVerdicts: ProductionGateVerdict[];
  blocking: boolean;
  requiresHumanReview: boolean;
  now: number;
}): ProductionArtifact => {
  const hasBlockingGate = input.gateVerdicts.some((verdict) => verdict.blocking);
  const lifecycleStatus = resolveArtifactLifecycleStatus({
    blocking: input.blocking,
    hasBlockingGate,
    requiresHumanReview: input.requiresHumanReview,
  });
  const approvalRecords: ArtifactApprovalRecord[] = [];
  if (!input.blocking) {
    approvalRecords.push(createApprovalRecord({
      artifactId: input.artifact.id,
      stageId: input.stage.id,
      action: "approve",
      actor: "qa",
      reason: "QA chain passed without blocking issues.",
      now: input.now,
    }));
  }
  if (lifecycleStatus === "committed") {
    approvalRecords.push(createApprovalRecord({
      artifactId: input.artifact.id,
      stageId: input.stage.id,
      action: "lock",
      actor: "system",
      reason: "Auto-approved low-risk stage committed immediately.",
      now: input.now,
    }));
  }

  return {
    ...input.artifact,
    lifecycleStatus,
    draftEnvelopeId: `draft-${input.artifact.id}`,
    qaReportIds: input.qaReports.map((report) => report.id),
    gateIds: input.gateVerdicts.map((verdict) => verdict.gateId),
    approvalRecords,
    waiverIds: [],
    dependencyIds: [],
    approvedAt: !input.blocking ? input.now : undefined,
    committedAt: lifecycleStatus === "committed" ? input.now : undefined,
    locked: lifecycleStatus === "committed",
    lockedAt: lifecycleStatus === "committed" ? input.now : undefined,
  };
};

export const createArtifactDependencyEdges = (
  run: ProductionRun,
  newArtifacts: ProductionArtifact[],
  now = Date.now(),
) => {
  const edges: ArtifactDependencyEdge[] = [];
  newArtifacts.forEach((artifact) => {
    if (artifact.previousArtifactId) {
      edges.push({
        id: `artifact-dependency-${now}-${crypto.randomUUID()}`,
        sourceArtifactId: artifact.previousArtifactId,
        targetArtifactId: artifact.id,
        relation: "overwrites",
        createdAt: now,
      });
    }

    run.artifacts
      .filter((existing) =>
        existing.id !== artifact.previousArtifactId &&
        existing.stageId !== artifact.stageId &&
        dependencySourceTypes.has(existing.artifactType) &&
        existing.lifecycleStatus !== "qa_failed" &&
        existing.lifecycleStatus !== "quarantined",
      )
      .slice(-8)
      .forEach((existing) => {
        edges.push({
          id: `artifact-dependency-${now}-${crypto.randomUUID()}`,
          sourceArtifactId: existing.id,
          targetArtifactId: artifact.id,
          relation: "derived_from",
          createdAt: now,
        });
      });
  });
  return edges;
};

export const createInterventionTasksForStage = (input: {
  run: ProductionRun;
  stage: ProductionStageRun;
  artifacts: ProductionArtifact[];
  qaReports: ProductionQAReport[];
  gateVerdicts: ProductionGateVerdict[];
  now: number;
}): HumanInterventionTask[] => {
  const blockingIssues = [
    ...input.qaReports.flatMap((report) => report.issues.filter((issue) => report.blocking || issue.severity === "blocking")),
    ...input.gateVerdicts.flatMap((verdict) => (verdict.issues || []).filter((issue) => verdict.blocking || issue.severity === "blocking")),
  ];
  if (!blockingIssues.length) return [];
  const artifactId = input.artifacts[0]?.id || `stage:${input.stage.id}`;
  return [{
    id: `human-intervention-${input.now}-${crypto.randomUUID()}`,
    workflowStepId: `autostudio.stage.${input.stage.stageType}`,
    agentRunId: input.stage.agentId,
    reason: `阶段「${input.stage.title}」存在 ${blockingIssues.length} 个阻断问题，自动流程已停止。`,
    issueFingerprints: Array.from(new Set(blockingIssues.map((issue) => issue.fingerprint).filter(Boolean) as string[])),
    repairOptions: Array.from(new Set(blockingIssues.map((issue) => issue.repairInstruction || issue.suggestion || issue.message))),
    status: input.artifacts.some((artifact) => artifact.lifecycleStatus === "quarantined") ? "blocked" : "open",
    createdAt: input.now,
  }];
};

export const lockArtifactsForStage = (
  run: ProductionRun,
  stageId: string,
  reason = "作者批准当前阶段产物进入下游。",
) => {
  const now = Date.now();
  const approvalRecords: ArtifactApprovalRecord[] = [];
  const artifacts = run.artifacts.map((artifact) => {
    if (artifact.stageId !== stageId) return artifact;
    if (artifact.lifecycleStatus === "qa_failed" || artifact.lifecycleStatus === "quarantined") return artifact;
    const record = createApprovalRecord({
      artifactId: artifact.id,
      stageId,
      action: "lock",
      actor: "author",
      reason,
      now,
    });
    approvalRecords.push(record);
    return {
      ...artifact,
      lifecycleStatus: "locked" as const,
      locked: true,
      lockedAt: artifact.lockedAt || now,
      approvalRecords: [...(artifact.approvalRecords || []), record],
    };
  });
  if (!approvalRecords.length) return run;
  return {
    ...run,
    artifacts,
    artifactApprovals: [...(run.artifactApprovals || []), ...approvalRecords],
    updatedAt: now,
  };
};

export const expireWaiversForStaleArtifacts = (
  run: ProductionRun,
) => {
  const staleArtifactIds = new Set(run.artifacts.filter((artifact) => artifact.stale).map((artifact) => artifact.id));
  if (!staleArtifactIds.size || !run.qaWaivers?.length) return run;
  const retainedWaivers = run.qaWaivers.filter((waiver) =>
    !waiver.expiresOnUpstreamChange ||
    !waiver.artifactId ||
    !staleArtifactIds.has(waiver.artifactId),
  );
  const retainedWaiverIds = new Set(retainedWaivers.map((waiver) => waiver.id));
  return {
    ...run,
    qaWaivers: retainedWaivers,
    artifacts: run.artifacts.map((artifact) =>
      artifact.waiverIds?.length
        ? {
            ...artifact,
            waiverIds: artifact.waiverIds.filter((waiverId) => retainedWaiverIds.has(waiverId)),
          }
        : artifact,
    ),
  };
};
