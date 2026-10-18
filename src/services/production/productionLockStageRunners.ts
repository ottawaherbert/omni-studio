import type {
  ProductionRun,
  ProductionStageExecutionResult,
} from "../../types/production";
import {
  validateContentLockPackage,
  validateProductionBlockLock,
  validateScriptLockPackage,
} from "./productionLock";
import {
  createContentLockBundle,
  createScriptLockBundle,
} from "./productionPrepRuntime";
import { getProject, loadFullEpisodes } from "./runnerRepositoryAccess";
import { makeArtifact, makeQA } from "./runnerArtifacts";

export const executeScriptLockStage = async (
  _run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const { scriptLockPackage, productionBlockLock } = createScriptLockBundle(project, episodes);
  const issues = [
    ...validateScriptLockPackage(scriptLockPackage),
    ...validateProductionBlockLock(productionBlockLock),
  ];
  return {
    summary: `已锁定线性生产范围：${scriptLockPackage.episodeIds.length} 集、${scriptLockPackage.sceneIds.length} 场，生成 production block ${productionBlockLock.blockId}。`,
    artifacts: [
      makeArtifact("script_lock_package", "run.outputSnapshot.scriptLockPackage", "剧本锁定包", [scriptLockPackage.id]),
      makeArtifact("production_block_lock", "run.outputSnapshot.productionBlockLock", "生产批次锁", [productionBlockLock.id]),
    ],
    qaReports: [makeQA("production.lock.script.qa", issues, issues.some((issue) => issue.severity === "blocking") ? 0 : issues.length ? 84 : 100)],
    outputSnapshot: {
      scriptLockPackage,
      productionBlockLock,
    },
  };
};

export const executeContentLockStage = async (
  _run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const { contentLockPackage, productionBlockLock } = createContentLockBundle(project, episodes);
  const issues = [
    ...validateContentLockPackage(contentLockPackage),
    ...validateProductionBlockLock(productionBlockLock),
  ];
  return {
    summary: `已锁定互动生产范围：${contentLockPackage.nodeIds.length} 个节点、${contentLockPackage.variableStateIds.length} 个变量状态，生成 production block ${productionBlockLock.blockId}。`,
    artifacts: [
      makeArtifact("content_lock_package", "run.outputSnapshot.contentLockPackage", "互动内容锁定包", [contentLockPackage.id]),
      makeArtifact("production_block_lock", "run.outputSnapshot.productionBlockLock", "互动生产批次锁", [productionBlockLock.id]),
    ],
    qaReports: [makeQA("production.lock.content.qa", issues, issues.some((issue) => issue.severity === "blocking") ? 0 : issues.length ? 84 : 100)],
    outputSnapshot: {
      contentLockPackage,
      productionBlockLock,
    },
  };
};
