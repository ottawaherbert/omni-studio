import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact } from "../src/services/operator/artifacts";
import { runOperatorArtifactQA, runOperatorQA } from "../src/services/operator/qa";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import type { OperatorArtifactEnvelope, OperatorRegisteredAsset } from "../src/services/operator/types";
import {
  buildMediaStoryboardControlTemplateSvg,
  buildStoryboardBoardMediaPrompt,
  MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION,
  resolvePanelSourceShotLabel,
  selectStoryboardReferenceItems,
} from "../src/services/production/mediaProductionWorker";
import { buildProductionCoordinationWrapQA } from "../src/services/production/productionCoordination";
import type {
  AssetReferencePack,
  StoryboardBoard,
  VideoGenerationUnit,
} from "../src/services/production/videoStoryboardArtifacts";
import type { Episode, Project, Shot } from "../src/types/project";

const valueAfter = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const projectId = String(valueAfter("--project") || "").trim();
assert.ok(projectId, "Missing required --project <projectId>.");
const renderDir = String(valueAfter("--render-dir") || "").trim();
const requireMedia = process.argv.includes("--require-media");
const project = dbHelpers.getProjectById(projectId) as Project | null;
assert.ok(project, `Project not found: ${projectId}`);

const artifacts = dbHelpers.listOperatorArtifacts({ projectId });
const registeredAssets = dbHelpers.listOperatorAssets({ projectId });
const episodes = (project.episodes || []) as Episode[];
const scenes = episodes.flatMap((episode) => episode.scenes || []);
const shots = scenes.flatMap((scene) => scene.shots || []);
const shotById = new Map(shots.map((shot) => [shot.id, shot]));
const stableHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const latestByEntityId = <T>(
  kind: OperatorArtifactEnvelope["kind"],
  extract: (artifact: OperatorArtifactEnvelope) => T | undefined,
  idOf: (value: T) => string,
) => {
  const result = new Map<string, T>();
  const ordered = artifacts.filter((artifact) => artifact.kind === kind)
    .sort((left, right) => left.updatedAt - right.updatedAt);
  for (const artifact of ordered) {
    const value = extract(artifact);
    if (value) result.set(idOf(value), value);
  }
  return [...result.values()];
};

const boards = latestByEntityId(
  "storyboard_board",
  (artifact) => (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard,
  (board) => board.id,
);
const units = latestByEntityId(
  "video_generation_unit",
  (artifact) => (artifact.data as { videoGenerationUnit?: VideoGenerationUnit }).videoGenerationUnit,
  (unit) => unit.id,
);
const referencePacks = latestByEntityId(
  "asset_reference_pack",
  (artifact) => (artifact.data as { assetReferencePack?: AssetReferencePack }).assetReferencePack,
  (pack) => pack.id,
);
const unitByBoardId = new Map(units.map((unit) => [unit.storyboardBoardId, unit]));
const boardById = new Map(boards.map((board) => [board.id, board]));
const referencePackById = new Map(referencePacks.map((pack) => [pack.id, pack]));
const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
const assetSummaryById = new Map([
  ...project.characters.map((item) => [
    item.id,
    [item.name, item.visualIdentity || item.multiViewPrompt || item.boardPrompt].filter(Boolean).join("："),
  ] as const),
  ...project.assets.map((item) => [
    item.id,
    [item.name, item.description || item.multiViewPrompt || item.boardPrompt || item.prompt].filter(Boolean).join("："),
  ] as const),
]);
const assetNameById = new Map([
  ...project.characters.map((item) => [item.id, item.name] as const),
  ...project.assets.map((item) => [item.id, item.name] as const),
]);

const issues: string[] = [];
const record = (condition: boolean, message: string) => {
  if (!condition) issues.push(message);
};

record(boards.length === units.length, `复合故事板 ${boards.length} 与视频生成单元 ${units.length} 数量不一致。`);
record(boards.length > 0, "没有可验收的复合故事板。 ");
record(referencePacks.length > 0, "没有可验收的资产参考包。 ");

for (const board of boards) {
  const unit = unitByBoardId.get(board.id);
  record(Boolean(unit), `故事板 ${board.id} 没有对应视频生成单元。`);
  record(board.panels.length > 0, `故事板 ${board.id} 没有 panel。`);
  board.panels.forEach((panel, index) => {
    record(panel.panelNumber === index + 1, `${board.id} 的 Panel 编号在索引 ${index} 处错位。`);
    record(Boolean(panel.shotId && board.shotIds.includes(panel.shotId)), `${board.id}/P${panel.panelNumber} 未映射到 board.shotIds。`);
    record(Boolean(panel.shotId && shotById.has(panel.shotId)), `${board.id}/P${panel.panelNumber} 引用了未知 Shot ${panel.shotId || "empty"}。`);
    record(Boolean(resolvePanelSourceShotLabel(board, panel)), `${board.id}/P${panel.panelNumber} 缺少可视 Source Shot 标签。`);
  });
  const panelDuration = board.panels.reduce((sum, panel) => sum + Number(panel.durationSeconds || 0), 0);
  if (unit) {
    record(Math.abs(panelDuration - unit.durationSeconds) <= 0.15, `${board.id} 的 Panel 总时长 ${panelDuration}s 与视频单元 ${unit.durationSeconds}s 不一致。`);
    record(unit.shotIds.every((shotId) => board.shotIds.includes(shotId)), `${board.id} 未覆盖视频单元声明的全部 Shot。`);
  }
  const resolution = board.strategyDecision.strategyResolution;
  record(Boolean(resolution), `${board.id} 缺少策略能力求解记录。`);
  if (resolution) {
    record(resolution.uncoveredCapabilityIds.length === 0, `${board.id} 仍有未覆盖能力：${resolution.uncoveredCapabilityIds.join(", ")}`);
    record(resolution.modifierStrategyIds.length <= 2, `${board.id} 使用了超过两个修饰策略。`);
    record(resolution.maxAutomaticRevisionAttempts === 1, `${board.id} 的项目级策略草案自动返工预算不为 1。`);
  }
}

for (const unit of units) {
  record(boardById.has(unit.storyboardBoardId), `视频生成单元 ${unit.id} 引用了未知故事板 ${unit.storyboardBoardId}。`);
  record(Boolean(unit.videoPrompt?.trim()), `视频生成单元 ${unit.id} 缺少正式视频提示词。`);
}

const requiredReferenceItems = referencePacks.flatMap((pack) => pack.items.filter((item) => item.required));
const missingRequiredReferenceImages = requiredReferenceItems.filter((item) => !item.referenceImageUrl);
record(missingRequiredReferenceImages.length === 0, `仍有 ${missingRequiredReferenceImages.length} 个必需资产引用未绑定参考图。`);

const fullQA = runOperatorQA({ check: "full", project, episodes });
record(!fullQA.blocking, `项目级 Operator QA 有 ${fullQA.issues.length} 个问题。`);

const sourceShotHash = stableHash(JSON.stringify(shots.map((shot: Shot) => ({
  id: shot.id,
  visualAction: shot.visualAction,
  characterIdsInShot: shot.characterIdsInShot,
  propIds: shot.propIds,
}))));
const currentPrepArtifact = artifacts
  .filter((artifact) => artifact.kind === "department_prep_package")
  .sort((left, right) => right.updatedAt - left.updatedAt)
  .find((artifact) => String((artifact.data as { sourceShotHash?: string }).sourceShotHash || "") === sourceShotHash);
record(Boolean(currentPrepArtifact), "部门筹备交接包没有跟上当前 Shot 内容版本。 ");
const departmentPackages = currentPrepArtifact
  ? ((currentPrepArtifact.data as { departmentPrepPackages?: unknown[] }).departmentPrepPackages || [])
  : [];
record(departmentPackages.length > 0, "当前 Shot 版本没有部门筹备交接包。 ");

const totalDurationSeconds = shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
const declaredDurationSeconds = Number(project.durationMinutes || 0) * 60;
if (declaredDurationSeconds > 0) {
  record(Math.abs(totalDurationSeconds - declaredDurationSeconds) <= Math.max(1, declaredDurationSeconds * 0.01), `分镜总时长 ${totalDurationSeconds}s 与项目声明 ${declaredDurationSeconds}s 不一致。`);
}

const strategyDistribution = Object.fromEntries([...boards.reduce((counts, board) => {
  const id = board.strategyDecision.selectedStrategyId;
  counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}, new Map<string, number>()).entries()].sort(([left], [right]) => left.localeCompare(right)));
const panelDistribution = Object.fromEntries([...boards.reduce((counts, board) => {
  const count = String(board.panels.length);
  counts.set(count, (counts.get(count) || 0) + 1);
  return counts;
}, new Map<string, number>()).entries()].sort(([left], [right]) => Number(left) - Number(right)));

if (renderDir) {
  await mkdir(renderDir, { recursive: true });
  const examples = new Map<string, StoryboardBoard>();
  for (const board of boards) {
    const strategyId = board.strategyDecision.selectedStrategyId;
    if (!examples.has(strategyId)) examples.set(strategyId, board);
  }
  let index = 0;
  for (const [strategyId, board] of [...examples.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    index += 1;
    const baseName = `${String(index).padStart(2, "0")}-${strategyId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
    const svg = buildMediaStoryboardControlTemplateSvg(board);
    await writeFile(path.join(renderDir, `${baseName}.svg`), svg, "utf8");
    await sharp(Buffer.from(svg)).png().toFile(path.join(renderDir, `${baseName}.png`));
  }
}

const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
  id: `operator_acceptance_run_${stableHash(`${projectId}:${sourceShotHash}`).slice(0, 20)}`,
  projectId,
  provider: "codex",
  mode: "qa",
  status: "running",
  userRequest: "对当前项目执行完整制片合同、故事板、资产、交接与全局 wrap QA。",
  scope: { projectId, episodeIds: episodes.map((episode) => episode.id) },
}));
const wrap = buildProductionCoordinationWrapQA({
  project,
  episodes,
  operatorArtifacts: artifacts,
  scope: "phase_wrap",
  environment: "test",
  runId: run.id,
});
const coordinationArtifact = createOperatorArtifact({
  id: `operator_acceptance_coordination_${stableHash(`${projectId}:${sourceShotHash}`).slice(0, 20)}`,
  runId: run.id,
  projectId,
  kind: "production_coordination_report",
  targetPath: "productionAcceptance.phaseWrap",
  entityIds: [projectId, ...episodes.map((episode) => episode.id)],
  status: wrap.blocking ? "qa_failed" : "approved",
  data: { productionCoordinationReport: wrap.report, gateResult: wrap },
}, run);
const savedCoordinationArtifact = dbHelpers.saveOperatorArtifact(coordinationArtifact);
const coordinationVerdict = runOperatorArtifactQA({ artifact: savedCoordinationArtifact, relatedArtifacts: artifacts });
if (coordinationVerdict) dbHelpers.appendOperatorArtifactQA(savedCoordinationArtifact.id, coordinationVerdict);
record(!wrap.blocking, `全局制片统筹 wrap QA 阻断：${wrap.reason}`);

const imageAssets = registeredAssets.filter((asset: OperatorRegisteredAsset) => asset.kind === "image");
const registeredAssetImages = imageAssets.filter((asset) => asset.metadata?.workerContract === MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION && asset.metadata?.phase === "assets");
const formalAssetImages = registeredAssetImages.filter((asset) => asset.metadata?.adoptionStatus === "adopted");
const storyboardImages = imageAssets.filter((asset) => asset.metadata?.workerContract === MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION && asset.metadata?.phase === "storyboards");
const expectedStoryboardPromptHashes = new Map(boards.flatMap((board) => {
  const unit = unitByBoardId.get(board.id);
  const scene = sceneById.get(board.sceneId);
  const pack = unit ? referencePackById.get(unit.assetReferencePackId) : undefined;
  if (!unit || !scene) return [];
  const items = selectStoryboardReferenceItems(board, pack?.items);
  const prompt = buildStoryboardBoardMediaPrompt({
    projectTitle: project.title,
    sceneTitle: scene.title,
    board,
    assetNames: items.map((item) => assetSummaryById.get(item.assetId) || item.assetId),
    assetLabels: items.map((item) => ({
      assetId: item.assetId,
      assetType: item.assetType,
      name: assetNameById.get(item.assetId) || item.assetId,
    })),
  });
  return [[board.id, stableHash(prompt)] as const];
}));
const currentStoryboardImages = storyboardImages.filter((asset) => {
  if (asset.metadata?.adoptionStatus !== "adopted") return false;
  const sourceId = String(asset.metadata?.sourceId || "");
  const promptHash = String(asset.metadata?.promptHash || "");
  return Boolean(sourceId && expectedStoryboardPromptHashes.get(sourceId) === promptHash);
});
const { config } = dbHelpers.getAIConfig();
const routeStatus = Object.fromEntries((["imageGen", "videoGen", "audioGen"] as const).map((route) => {
  const modelId = config.routing[route];
  const model = config.models.find((item) => item.id === modelId);
  const channel = model ? config.channels.find((item) => item.id === model.channelId) : undefined;
  return [route, { configured: Boolean(model && channel?.apiKey?.trim()), model: model?.modelId || null }];
}));
const latestMediaRun = dbHelpers.listOperatorRuns(projectId)
  .find((candidate) => candidate.mode === "asset_generation");
const latestMediaFailure = latestMediaRun?.events
  .filter((event) => event.type === "qa_failed" || event.type === "blocked")
  .at(-1);
const mediaBlockers = [
  ...(currentStoryboardImages.length < boards.length
    ? [`当前提示词版本只有 ${currentStoryboardImages.length}/${boards.length} 张正式复合故事板图片。`]
    : []),
  ...(!routeStatus.videoGen.configured ? ["视频生成路由未配置。"] : []),
  ...(!routeStatus.audioGen.configured ? ["音频生成路由未配置。"] : []),
  ...(latestMediaRun?.status === "needs_human_review" && latestMediaFailure?.message
    ? [`媒体批次已熔断并等待人工检查：${latestMediaFailure.message}`]
    : []),
];

const acceptance = {
  schemaVersion: "production-project-acceptance.v1",
  overallStatus: issues.length
    ? "contract_failed"
    : mediaBlockers.length
      ? "contract_ready_media_blocked"
      : "completed",
  projectId,
  projectTitle: project.title,
  createdAt: Date.now(),
  counts: {
    episodes: episodes.length,
    scenes: scenes.length,
    shots: shots.length,
    storyboardBoards: boards.length,
    storyboardPanels: boards.reduce((sum, board) => sum + board.panels.length, 0),
    videoGenerationUnits: units.length,
    requiredReferenceItems: requiredReferenceItems.length,
    missingRequiredReferenceImages: missingRequiredReferenceImages.length,
    departmentPackages: departmentPackages.length,
    registeredAssetImages: registeredAssetImages.length,
    formalAssetImages: formalAssetImages.length,
    registeredStoryboardImages: storyboardImages.length,
    currentStoryboardImages: currentStoryboardImages.length,
  },
  duration: { declaredSeconds: declaredDurationSeconds, shotSeconds: totalDurationSeconds },
  strategyDistribution,
  panelDistribution,
  fullQA: { status: fullQA.status, score: fullQA.score, issueCount: fullQA.issues.length },
  wrapQA: { blocking: wrap.blocking, canProceed: wrap.canProceed, nextAction: wrap.nextAction, reason: wrap.reason },
  mediaReadiness: {
    status: mediaBlockers.length ? "blocked" : "ready",
    blockers: mediaBlockers,
  },
  routeStatus,
  issueCount: issues.length,
  issues,
};
const acceptanceArtifact = dbHelpers.saveOperatorArtifact(createOperatorArtifact({
  id: `operator_acceptance_summary_${stableHash(`${projectId}:${sourceShotHash}`).slice(0, 20)}`,
  runId: run.id,
  projectId,
  kind: "custom",
  targetPath: "productionAcceptance.summary",
  entityIds: [projectId],
  status: issues.length || mediaBlockers.length ? "qa_failed" : "approved",
  data: acceptance,
}, run));
dbHelpers.appendOperatorArtifactQA(acceptanceArtifact.id, {
  qaAgentId: "operator.qa.production_project_acceptance",
  status: issues.length || mediaBlockers.length ? "failed" : "passed",
  blocking: issues.length > 0 || mediaBlockers.length > 0,
  score: issues.length || mediaBlockers.length ? 0 : 100,
  issues: [
    ...issues.map((message, index) => ({ id: `acceptance_issue_${index + 1}`, severity: "blocking", target: projectId, message, createdAt: Date.now() })),
    ...mediaBlockers.map((message, index) => ({ id: `media_readiness_issue_${index + 1}`, severity: "blocking", target: `${projectId}.mediaReadiness`, message, createdAt: Date.now() })),
  ],
  nextAction: issues.length || mediaBlockers.length ? "human_review" : "commit",
  createdAt: Date.now(),
});
dbHelpers.patchOperatorRun(run.id, {
  status: issues.length || mediaBlockers.length ? "needs_human_review" : "completed",
  outputs: [
    { artifactId: savedCoordinationArtifact.id, kind: "production_coordination_report" },
    { artifactId: acceptanceArtifact.id, kind: "custom" },
  ],
  qaSummary: {
    passed: issues.length ? 0 : 1,
    warnings: fullQA.status === "warning" ? 1 : 0,
    failed: issues.length || mediaBlockers.length ? 1 : 0,
    blocked: issues.length || mediaBlockers.length ? 1 : 0,
  },
});

console.log(JSON.stringify(acceptance, null, 2));
if (issues.length || (requireMedia && mediaBlockers.length)) process.exitCode = 1;
