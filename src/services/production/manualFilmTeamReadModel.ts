import type {
  Episode,
  ManualFilmTeamDepartment,
  ManualFilmTeamOutput,
  Project,
} from "../../types/project";
import {
  buildDepartmentPrepPackages,
  buildProductionBreakdownReport,
  type DepartmentPrepPackage,
  type ProductionBreakdownReport,
  type ProductionPrepDepartment,
} from "./productionPrep";
import {
  buildContinuityMatrix,
  type ContinuityMatrix,
} from "./productionContinuity";
import {
  MANUAL_FILM_TEAM_DEPARTMENTS,
  manualFilmTeamBreakdownHash,
  manualFilmTeamFullScriptHash,
  manualFilmTeamMissingSceneIds,
  manualFilmTeamOutputFor,
  manualFilmTeamScriptHash,
  manualFilmTeamUnitScenes,
  manualFilmTeamUnitSource,
} from "./manualFilmTeam";
import {
  buildManualFilmTeamCommunicationState,
  manualFilmTeamCollaborationIsStale,
} from "./manualFilmTeamCommunication";

export type ManualFilmTeamReadiness = "ready" | "needs_review" | "blocked";

export interface ManualFilmTeamCoverageRow {
  department: ManualFilmTeamDepartment;
  canonicalDepartment: ProductionPrepDepartment;
  name: string;
  readiness: ManualFilmTeamReadiness;
  outputStatus: ManualFilmTeamOutput["status"] | "missing";
  qaScore?: number;
  requiredAssetCount: number;
  variantCount: number;
  openQuestionCount: number;
  incomingHandoffCount: number;
  pendingHandoffCount: number;
  reasons: string[];
}

export interface ManualFilmTeamFinding {
  id: string;
  department: ManualFilmTeamDepartment;
  canonicalDepartment: ProductionPrepDepartment;
  severity: "blocking" | "warning" | "advisory";
  resolutionClass: "hard_blocking" | "soft_hold" | "advisory";
  message: string;
  repairInstruction?: string;
}

export interface ManualDirectorCockpitReadModel {
  status: ManualFilmTeamReadiness;
  readyForStoryboard: boolean;
  confirmedDepartments: number;
  needsReviewDepartments: number;
  blockedDepartments: number;
  staleDepartments: number;
  staleCollaborations: number;
  openHandoffs: number;
  continuityRows: number;
  continuityNeedsReview: number;
  continuityBlocked: number;
  openQuestions: string[];
  nextActions: string[];
}

export interface ManualFilmTeamReadModel {
  schemaVersion: "manual-film-team-read-model.v2";
  projectId: string;
  episodeId: string;
  sourceDocumentId?: string;
  sceneIds: string[];
  sourceScriptHash: string;
  sourceBreakdownHash: string;
  fullScriptHash: string;
  productionBreakdownReport: ProductionBreakdownReport;
  departmentPrepPackages: DepartmentPrepPackage[];
  continuityMatrix: ContinuityMatrix;
  coverage: ManualFilmTeamCoverageRow[];
  findings: ManualFilmTeamFinding[];
  directorCockpit: ManualDirectorCockpitReadModel;
  generatedAt: number;
}

const MANUAL_TO_CANONICAL: Record<ManualFilmTeamDepartment, ProductionPrepDepartment> = {
  directing: "directing",
  production_coordination: "production",
  cinematography: "cinematography",
  lighting: "lighting",
  production_design: "production_design",
  wardrobe: "wardrobe",
  makeup_hair: "makeup_hair",
  performance_directing: "performance_directing",
  action_choreography: "action_choreography",
  props: "props",
  continuity: "continuity",
  sound_music: "sound_music",
};

const uniq = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const emptyDepartmentPackage = (
  project: Project,
  report: ProductionBreakdownReport,
  department: ProductionPrepDepartment,
  createdAt: number,
): DepartmentPrepPackage => ({
  schemaVersion: "department-prep-package.v1",
  id: `department-prep-${department}-${report.id}`,
  projectId: project.id,
  productionBreakdownReportId: report.id,
  department,
  ownerAgentId: `manual.department.${department}`,
  episodeIds: report.scope.episodeIds,
  sceneIds: report.scope.sceneIds,
  nodeIds: report.scope.nodeIds,
  requiredAssets: [],
  variants: [],
  departmentPlanType: department === "directing" ? "creative_direction" : "coordination",
  sceneRefs: report.scope.sceneIds,
  shotRefs: report.sceneMatrix.flatMap((row) => row.shotIds),
  continuityRefs: [],
  styleLockRefs: [],
  qaChecklist: [],
  specialistPayload: {},
  continuityInOut: [],
  readiness: "needs_review",
  openQuestions: [],
  createdAt,
});

const outputReadiness = (
  output: ManualFilmTeamOutput | undefined,
  episode: Episode,
  sourceScriptHash: string,
  sourceBreakdownHash: string,
  fullScriptHash: string,
): {
  readiness: ManualFilmTeamReadiness;
  reasons: string[];
  sourceChanged: boolean;
  collaborationChanged: boolean;
} => {
  if (!output) {
    return {
      readiness: "blocked",
      reasons: ["尚未生成部门筹备结果。"],
      sourceChanged: false,
      collaborationChanged: false,
    };
  }
  const sourceChanged = Boolean(
    output.sourceScriptHash !== sourceScriptHash
    || output.sourceBreakdownHash !== sourceBreakdownHash
    || output.fullScriptHash !== fullScriptHash
  );
  const collaborationChanged = manualFilmTeamCollaborationIsStale(episode, output);
  const state = (readiness: ManualFilmTeamReadiness, reasons: string[]) => ({
    readiness,
    reasons,
    sourceChanged,
    collaborationChanged,
  });
  const missingSceneIds = manualFilmTeamMissingSceneIds(output, episode);
  if (missingSceneIds.length && !(output.preparationOrigin === 'simple' && output.department === 'action_choreography')) return state("blocked", [`部门方案缺少 ${missingSceneIds.length} 个正式场次的执行明细。`]);
  if (output.qa?.issues.some((item) => item.severity === "blocking")) {
    return state("blocked", ["部门 QA 存在阻断问题。"]);
  }
  if (output.qa?.verdict === "revise" || output.status === "needs_revision") {
    return state("blocked", ["部门 QA 要求修改。"]);
  }
  if (output.qa?.issues.some((item) => item.severity === "warning")) {
    return state("needs_review", ["部门 QA 仍有警告需要复核。"]);
  }
  if (output.status !== "confirmed") {
    return state("needs_review", [output.qa?.verdict === "pass" ? "QA 已通过，等待作者确认。" : "等待部门 QA 和作者确认。"]);
  }
  return state("ready", []);
};

export const buildManualFilmTeamReadModel = ({
  project,
  episode,
  requiredDepartments,
  createdAt = Date.now(),
}: {
  project: Project;
  episode: Episode;
  requiredDepartments?: ManualFilmTeamDepartment[];
  createdAt?: number;
}): ManualFilmTeamReadModel => {
  const requestedSpecs = requiredDepartments?.length
    ? MANUAL_FILM_TEAM_DEPARTMENTS.filter((spec) => requiredDepartments.includes(spec.id))
    : MANUAL_FILM_TEAM_DEPARTMENTS;
  const departmentSpecs = episode.preparationMode === 'professional' ? requestedSpecs : requestedSpecs.filter(spec => spec.id !== 'action_choreography' || episode.productionTeam?.outputs.some(output => output.department === spec.id && output.status === 'confirmed'));
  const unitSource = manualFilmTeamUnitSource(project, episode);
  const unitScenes = manualFilmTeamUnitScenes(episode);
  const isProductionWorkspaceShell = Boolean(
    (project as Project & { __productionWorkspaceShell?: boolean }).__productionWorkspaceShell,
  );
  const sourceScriptHash = isProductionWorkspaceShell
    ? episode.productionTeam?.sourceScriptHash || manualFilmTeamScriptHash(unitSource.text)
    : manualFilmTeamScriptHash(unitSource.text);
  const sourceBreakdownHash = manualFilmTeamBreakdownHash(episode);
  // Production workspace shells intentionally omit non-active scene bodies.
  // Reuse the authoritative unit snapshot instead of treating projection as a
  // script change; full-project reads still recompute the hash normally.
  const fullScriptHash = isProductionWorkspaceShell
    ? episode.productionTeam?.fullScriptHash || manualFilmTeamFullScriptHash(project)
    : manualFilmTeamFullScriptHash(project);
  const scopedEpisode: Episode = { ...episode, scenes: unitScenes };
  const productionBreakdownReport = buildProductionBreakdownReport({
    project,
    episodes: [scopedEpisode],
    scope: {
      mode: project.type,
      episodeIds: [episode.id],
      sceneIds: unitScenes.map((scene) => scene.id),
      sourceLockIds: [],
    },
    createdAt,
  });
  const canonicalPackages = buildDepartmentPrepPackages(project, productionBreakdownReport, createdAt);

  const departmentPrepPackages = departmentSpecs.map((spec) => {
    const canonicalDepartment = MANUAL_TO_CANONICAL[spec.id];
    const base = canonicalPackages.find((item) => item.department === canonicalDepartment)
      || emptyDepartmentPackage(project, productionBreakdownReport, canonicalDepartment, createdAt);
    const output = manualFilmTeamOutputFor(episode, spec.id);
    const state = outputReadiness(output, episode, sourceScriptHash, sourceBreakdownHash, fullScriptHash);
    return {
      ...base,
      ownerAgentId: `manual.department.${canonicalDepartment}`,
      specialistPayload: {
        ...(base.specialistPayload || {}),
        manualOutput: output ? {
          taskSummary: output.taskSummary,
          content: output.content,
          handoffNotes: output.handoffNotes,
          handoffs: output.handoffs || [],
          collaborationSourceVersions: output.collaborationSourceVersions || {},
          collaborationHandoffIds: output.collaborationHandoffIds || [],
          version: output.version,
          status: output.status,
          qaVerdict: output.qa?.verdict,
          qaScore: output.qa?.score,
          openQuestionCount: output.openQuestions?.length || 0,
          reviewedSceneIds: uniq((output.scenePlans || []).map((plan) => plan.sceneId)),
          promptHash: output.audit.promptHash,
          updatedAt: output.updatedAt,
          confirmedAt: output.confirmedAt,
        } : undefined,
      },
      readiness: state.readiness === "ready"
        ? "ready_for_department_review" as const
        : state.readiness === "blocked" ? "blocked" as const : "needs_review" as const,
      openQuestions: uniq([
        ...(base.openQuestions || []),
        ...(output?.openQuestions || []),
        ...state.reasons,
      ]),
    } satisfies DepartmentPrepPackage;
  });

  const continuityMatrix = buildContinuityMatrix({
    project,
    episodes: [scopedEpisode],
    productionBreakdownReport,
    departmentPrepPackages,
    createdAt,
  });

  const coverage = departmentSpecs.map((spec) => {
    const canonicalDepartment = MANUAL_TO_CANONICAL[spec.id];
    const prep = departmentPrepPackages.find((item) => item.department === canonicalDepartment)!;
    const output = manualFilmTeamOutputFor(episode, spec.id);
    const state = outputReadiness(output, episode, sourceScriptHash, sourceBreakdownHash, fullScriptHash);
    const communication = buildManualFilmTeamCommunicationState(episode, spec.id);
    return {
      department: spec.id,
      canonicalDepartment,
      name: spec.name,
      readiness: state.readiness,
      outputStatus: output?.status || "missing",
      qaScore: output?.qa?.score,
      requiredAssetCount: prep.requiredAssets.length,
      variantCount: prep.variants.length,
      openQuestionCount: prep.openQuestions.length,
      incomingHandoffCount: communication.incomingHandoffs.length,
      pendingHandoffCount: communication.incomingHandoffs.filter((handoff) => !handoff.acknowledged).length,
      reasons: state.reasons,
    } satisfies ManualFilmTeamCoverageRow;
  });

  const actionFindings = departmentSpecs.flatMap((spec): ManualFilmTeamFinding[] => {
    const canonicalDepartment = MANUAL_TO_CANONICAL[spec.id];
    const output = manualFilmTeamOutputFor(episode, spec.id);
    const state = outputReadiness(output, episode, sourceScriptHash, sourceBreakdownHash, fullScriptHash);
    const qaFindings = (output?.qa?.issues || []).map((qaIssue, index): ManualFilmTeamFinding => ({
      id: `manual-${episode.id}-${spec.id}-qa-${index + 1}`,
      department: spec.id,
      canonicalDepartment,
      severity: qaIssue.severity,
      resolutionClass: qaIssue.severity === "blocking"
        ? "hard_blocking"
        : qaIssue.severity === "warning" ? "soft_hold" : "advisory",
      message: qaIssue.description,
      repairInstruction: qaIssue.suggestion,
    }));
    const stateFindings = state.reasons.map((reason, index): ManualFilmTeamFinding => ({
      id: `manual-${episode.id}-${spec.id}-state-${index + 1}`,
      department: spec.id,
      canonicalDepartment,
      severity: state.readiness === "blocked" ? "blocking" : "warning",
      resolutionClass: state.readiness === "blocked" ? "hard_blocking" : "soft_hold",
      message: reason,
      repairInstruction: output
        ? `回到制片筹备的${spec.name}执行质检、优化或确认。`
        : `回到制片筹备生成${spec.name}筹备结果。`,
    }));
    return [...stateFindings, ...qaFindings];
  });

  const ready = coverage.filter((item) => item.readiness === "ready");
  const needsReview = coverage.filter((item) => item.readiness === "needs_review");
  const blocked = coverage.filter((item) => item.readiness === "blocked");
  const stale = departmentSpecs.filter((spec) => {
    const output = manualFilmTeamOutputFor(episode, spec.id);
    return outputReadiness(output, episode, sourceScriptHash, sourceBreakdownHash, fullScriptHash).sourceChanged;
  });
  const staleCollaborations = departmentSpecs.filter((spec) => {
    const output = manualFilmTeamOutputFor(episode, spec.id);
    return outputReadiness(output, episode, sourceScriptHash, sourceBreakdownHash, fullScriptHash).collaborationChanged;
  });
  const advisoryDepartment = (stale[0] || staleCollaborations[0] || departmentSpecs[0])?.id;
  const findings: ManualFilmTeamFinding[] = [
    ...actionFindings,
    ...(stale.length && advisoryDepartment ? [{
      id: `manual-${episode.id}-source-change-advisory`,
      department: advisoryDepartment,
      canonicalDepartment: MANUAL_TO_CANONICAL[advisoryDepartment],
      severity: "advisory" as const,
      resolutionClass: "advisory" as const,
      message: `剧本或场次拆解有更新；已保留 ${stale.length} 个部门的现有确认，可按需复核。`,
      repairInstruction: "按需打开相关部门查看差异。",
    }] : []),
    ...(staleCollaborations.length && advisoryDepartment ? [{
      id: `manual-${episode.id}-collaboration-change-advisory`,
      department: advisoryDepartment,
      canonicalDepartment: MANUAL_TO_CANONICAL[advisoryDepartment],
      severity: "advisory" as const,
      resolutionClass: "advisory" as const,
      message: `部门协作信息有更新；已保留 ${staleCollaborations.length} 个部门的现有确认，可按需复核。`,
      repairInstruction: "按需打开相关部门查看最新交接。",
    }] : []),
  ];
  const openHandoffs = coverage.reduce((sum, item) => sum + item.pendingHandoffCount, 0);
  const openQuestions = uniq([
    ...departmentPrepPackages.flatMap((item) => item.openQuestions),
    ...continuityMatrix.issues.map((item) => item.message),
  ]);
  const nextActions = uniq([
    ...blocked.map((item) => `${item.name}：${item.reasons[0]}`),
    ...needsReview.map((item) => `${item.name}：${item.reasons[0]}`),
    ...continuityMatrix.issues.map((item) => `场记：${item.message}`),
  ]);
  const continuityBlocked = continuityMatrix.totals.blocked;
  const status: ManualFilmTeamReadiness = continuityBlocked || blocked.length
    ? "blocked"
    : needsReview.length || continuityMatrix.totals.needsReview ? "needs_review" : "ready";

  return {
    schemaVersion: "manual-film-team-read-model.v2",
    projectId: project.id,
    episodeId: episode.id,
    sourceDocumentId: unitSource.sourceDocumentId,
    sceneIds: unitScenes.map((scene) => scene.id),
    sourceScriptHash,
    sourceBreakdownHash,
    fullScriptHash,
    productionBreakdownReport,
    departmentPrepPackages,
    continuityMatrix,
    coverage,
    findings,
    directorCockpit: {
      status,
      readyForStoryboard: blocked.length === 0 && continuityBlocked === 0,
      confirmedDepartments: ready.length,
      needsReviewDepartments: needsReview.length,
      blockedDepartments: blocked.length,
      staleDepartments: stale.length,
      staleCollaborations: staleCollaborations.length,
      openHandoffs,
      continuityRows: continuityMatrix.totals.rows,
      continuityNeedsReview: continuityMatrix.totals.needsReview,
      continuityBlocked,
      openQuestions,
      nextActions,
    },
    generatedAt: createdAt,
  };
};
