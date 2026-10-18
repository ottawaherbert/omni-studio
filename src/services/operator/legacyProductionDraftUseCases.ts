import type { Project } from "../../types/project";
import { buildProductionCockpit } from "../production/productionCockpit";
import { buildLegacyProductionLockDraftBundle } from "../production/productionLock";
import {
  buildCastingRequirements,
  buildDepartmentPrepPackages,
  buildProductionBreakdownReport,
} from "../production/productionPrep";
import { createOperatorArtifact } from "./artifacts";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import { runOperatorArtifactQA } from "./qa";
import { createOperatorRunRecord } from "./runs";
import type { OperatorArtifactEnvelope, OperatorRun } from "./types";
import {
  requireAccessibleProject,
  resolveEpisodesForRequest,
  type OperatorRunArtifactStore,
} from "./useCaseShared";
import { resolveProductionCockpitEnvironment } from "./productionCockpitUseCases";

export interface OperatorLegacyProductionDraftStore extends OperatorRunArtifactStore {
  saveOperatorRun(run: OperatorRun): OperatorRun;
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
  appendOperatorArtifactQA(id: string, verdict: any): OperatorArtifactEnvelope | null;
  listProductionRuns(projectId?: string): any[];
}

export const createLegacyProductionDraftForProject = (
  store: OperatorLegacyProductionDraftStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
    environment,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
    environment?: unknown;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const { episodes, episodeIds } = resolveEpisodesForRequest(project, input || {});
  const run = store.saveOperatorRun(createOperatorRunRecord({
    projectId,
    provider: input?.provider || "other",
    mode: "repair",
    userRequest: input?.userRequest || "Create legacy production lock and breakdown draft.",
    scope: {
      projectId,
      episodeIds,
    },
  }, handbookVersion));
  const createdAt = Date.now();
  const lockDraft = buildLegacyProductionLockDraftBundle({ project: project as Project, episodes, createdAt });
  const productionBreakdownReport = buildProductionBreakdownReport({
    project,
    episodes,
    scriptLockPackage: lockDraft.scriptLockPackage,
    contentLockPackage: lockDraft.contentLockPackage,
    productionBlockLock: lockDraft.productionBlockLock,
    createdAt,
  });
  const castingRequirements = buildCastingRequirements(project, productionBreakdownReport, createdAt);
  const departmentPrepPackages = buildDepartmentPrepPackages(project, productionBreakdownReport, createdAt);
  const draftArtifacts = [
    ...lockDraft.developmentAssetBriefs.map((developmentAssetBrief) => ({
      kind: "development_asset_brief",
      targetPath: `operator.legacyProductionDraft.developmentAssets.${developmentAssetBrief.id}`,
      entityIds: [projectId, developmentAssetBrief.id],
      data: {
        developmentAssetBrief,
        legacyAssetPackageDraft: lockDraft.legacyAssetPackageDraft,
      },
    })),
    lockDraft.scriptLockPackage ? {
      kind: "script_lock_package",
      targetPath: `operator.legacyProductionDraft.scriptLock.${lockDraft.scriptLockPackage.id}`,
      entityIds: [projectId, ...episodeIds],
      data: { scriptLockPackage: lockDraft.scriptLockPackage },
    } : undefined,
    lockDraft.contentLockPackage ? {
      kind: "content_lock_package",
      targetPath: `operator.legacyProductionDraft.contentLock.${lockDraft.contentLockPackage.id}`,
      entityIds: [projectId, ...lockDraft.contentLockPackage.nodeIds],
      data: { contentLockPackage: lockDraft.contentLockPackage },
    } : undefined,
    {
      kind: "production_block_lock",
      targetPath: `operator.legacyProductionDraft.blockLock.${lockDraft.productionBlockLock.id}`,
      entityIds: [projectId, ...episodeIds, ...lockDraft.productionBlockLock.nodeIds],
      data: { productionBlockLock: lockDraft.productionBlockLock },
    },
    {
      kind: "production_breakdown_report",
      targetPath: `operator.legacyProductionDraft.breakdown.${productionBreakdownReport.id}`,
      entityIds: [projectId, ...episodeIds, ...productionBreakdownReport.scope.sceneIds, ...productionBreakdownReport.scope.nodeIds],
      data: { productionBreakdownReport },
    },
    {
      kind: "casting_requirement",
      targetPath: `operator.legacyProductionDraft.casting.${productionBreakdownReport.id}`,
      entityIds: [projectId, ...castingRequirements.map((requirement) => requirement.id)],
      data: { castingRequirements },
    },
    {
      kind: "department_prep_package",
      targetPath: `operator.legacyProductionDraft.departmentPrep.${productionBreakdownReport.id}`,
      entityIds: [projectId, ...departmentPrepPackages.map((item) => item.id)],
      data: { departmentPrepPackages },
    },
  ].filter(Boolean) as any[];

  const artifacts = draftArtifacts.map((draftInput) => {
    const artifact = store.saveOperatorArtifact(createOperatorArtifact({
      runId: run.id,
      ...draftInput,
    }, run));
    store.appendOperatorRunEvent(run.id, {
      type: "artifact_generated",
      message: `Legacy production draft artifact created: ${artifact.kind}`,
      targetPath: artifact.targetPath,
      entityIds: artifact.entityIds,
      data: { artifactId: artifact.id, kind: artifact.kind },
    });
    return artifact;
  });
  const qaArtifacts = artifacts.map((artifact) => {
    const verdict = runOperatorArtifactQA({
      artifact,
      relatedArtifacts: store.listOperatorArtifacts({ projectId: artifact.projectId, runId: artifact.runId }),
    });
    if (!verdict) return artifact;
    const qaArtifact = store.appendOperatorArtifactQA(artifact.id, verdict) || artifact;
    store.appendOperatorRunEvent(run.id, {
      type: qaArtifact.status === "qa_failed" ? "qa_failed" : "qa_passed",
      message: `Legacy production draft QA ${qaArtifact.status}: ${qaArtifact.kind}`,
      targetPath: qaArtifact.targetPath,
      entityIds: qaArtifact.entityIds,
      data: { artifactId: qaArtifact.id, qaAgentId: verdict.qaAgentId },
    });
    return qaArtifact;
  });
  const operatorArtifacts = store.listOperatorArtifacts({ projectId, runId: run.id });
  const cockpit = buildProductionCockpit({
    project,
    episodes,
    operatorArtifacts,
    productionRuns: store.listProductionRuns(projectId),
    operatorRunId: run.id,
    scope: "manual_audit",
    stageType: "production_breakdown",
    environment: resolveProductionCockpitEnvironment(environment),
  });
  return {
    run,
    artifacts: qaArtifacts,
    lockDraft,
    developmentAssetBriefs: lockDraft.developmentAssetBriefs,
    legacyAssetPackageDraft: lockDraft.legacyAssetPackageDraft,
    productionBreakdownReport,
    castingRequirements,
    departmentPrepPackages,
    cockpit,
  };
};
