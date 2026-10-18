import crypto from "node:crypto";
import assert from "node:assert/strict";

import sharp from "sharp";

import { dbHelpers } from "../../../src/server/db";
import { createOperatorArtifact } from "../../../src/services/operator/artifacts";
import { runOperatorArtifactQA } from "../../../src/services/operator/qa";
import { createOperatorRunRecord } from "../../../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION, type OperatorArtifactEnvelope, type OperatorRegisteredAsset, type OperatorRun } from "../../../src/services/operator/types";
import {
  resolveProductionAssetBoardGenerationReference,
} from "../../../src/services/production/productionAssetBoardProfile";
import {
  productionAssetBoardCandidateSourceContentHash,
  stageProductionAssetBoardReferenceCandidate,
} from "../../../src/services/production/productionAssetBoardCandidate";
import { buildProductionAssetBoardCanonicalReference } from "../../../src/services/production/productionAssetBoardVisual";
import type { AssetIdentityBoard, FormalAssetPackage } from "../../../src/services/production/productionAssetPackage";
import { buildVideoStoryboardAssetBoardPlan } from "../../../src/services/production/videoStoryboardAssetBoards";
import {
  buildAssetBoardMediaPrompt,
  buildMediaStoryboardControlTemplateSvg,
  buildStoryboardBoardMediaPrompt,
  classifyStoryboardReferenceReadiness,
  compareMediaProductionOrder,
  evaluateMediaProductionCircuitBreaker,
  MEDIA_PRODUCTION_CIRCUIT_BREAKER_FAILURES,
  MEDIA_PRODUCTION_DEFAULT_MAX_ATTEMPTS,
  MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION,
  MEDIA_STORYBOARD_SOURCE_FOOTER_FRACTION,
  MEDIA_STORYBOARD_SOURCE_HEADER_FRACTION,
  MEDIA_STORYBOARD_SOURCE_VISUAL_FRACTION,
  normalizeMediaWorkerConcurrency,
  normalizeMediaWorkerMaxAttempts,
  resolveMediaStoryboardCompositeLayout,
  resolveMediaStoryboardGrid,
  resolvePanelSourceShotLabel,
  selectStoryboardReferenceItems,
} from "../../../src/services/production/mediaProductionWorker";
import type { AssetReferencePack, StoryboardBoard } from "../../../src/services/production/videoStoryboardArtifacts";
import { buildStoryboardMediaCandidateSourceHash } from "../../../src/services/production/storyboardMediaCandidateSource";
import { buildProductionStoryboardBoardDrafts } from "../../../src/services/production/videoStoryboardStageBoards";
import type { DepartmentPrepPackage } from "../../../src/services/production/productionPrep";
import { buildDepartmentPrepPackages, buildProductionBreakdownReport } from "../../../src/services/production/productionPrep";
import type { Episode, ImageGenerationReferenceAudit, Project, Scene, VisualCompileManifest } from "../../../src/types/project";
import {
  KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  isKieGptImage2ModelId,
  isKieImageModelId,
} from "../../../src/config/aiConfigDefaults";
import {
  compileImageGenerationRequest,
  createImageGenerationReference,
  type ImageGenerationRequest,
  type ImageGenerationReference,
} from "../../../src/services/production/imageGenerationRequest";
import {
  buildProductionAssetVisualRecipeInputEvidence,
  buildImageVisualStyleProjection,
  buildProductionAssetImageVisualStyleProjection,
  buildShotImageVisualRecipeInputEvidence,
  resolveImageVisualStyleProjectionContext,
} from "../../../src/services/production/imageVisualStyleProjection";

type WorkerPhase = "assets" | "storyboards" | "contracts" | "all" | "status";

interface WorkerOptions {
  projectId: string;
  phase: WorkerPhase;
  limit: number;
  concurrency: number;
  maxAttempts: number;
  baseUrl: string;
}

interface MediaAttemptState {
  attempts: number;
  promptHash?: string;
  lastAttemptAt?: number;
  lastError?: string;
}

interface ImageProviderConfig {
  channelId: string;
  modelConfigId: string;
  modelId: string;
  resolution?: "1K" | "2K" | "4K";
}

interface GeneratedImage {
  mediaUrl: string;
  width: number;
  height: number;
  bytes: number;
  requestId?: string;
  usage?: unknown;
  imageReferenceManifest: ImageGenerationReferenceAudit[];
  promptCompositionManifest: ReturnType<typeof compileImageGenerationRequest>["manifest"];
  visualStyleCompileManifest?: VisualCompileManifest;
}

interface WorkResult<T> {
  item: T;
  status: "generated" | "skipped" | "failed";
  image?: GeneratedImage;
  prompt?: string;
  sourceContentHash?: string;
  warningCodes?: string[];
  error?: string;
}

const argValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const parseOptions = (): WorkerOptions => {
  const projectId = String(argValue("--project") || "").trim();
  if (!projectId) throw new Error("Missing required --project <projectId>.");
  const phase = String(argValue("--phase") || "status") as WorkerPhase;
  if (!["assets", "storyboards", "contracts", "all", "status"].includes(phase)) {
    throw new Error(`Unsupported --phase ${phase}.`);
  }
  const rawLimit = Number(argValue("--limit") || Number.POSITIVE_INFINITY);
  return {
    projectId,
    phase,
    limit: Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : Number.POSITIVE_INFINITY,
    concurrency: normalizeMediaWorkerConcurrency(argValue("--concurrency") || 1),
    maxAttempts: normalizeMediaWorkerMaxAttempts(argValue("--max-attempts") || MEDIA_PRODUCTION_DEFAULT_MAX_ATTEMPTS),
    baseUrl: String(argValue("--base-url") || "http://127.0.0.1:3013").replace(/\/$/, ""),
  };
};

const stableHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const stableId = (prefix: string, value: string) => `${prefix}_${stableHash(value).slice(0, 24)}`;
const clean = (value: unknown) => String(value || "").trim();
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const absoluteMediaUrl = (baseUrl: string, value?: string) => value?.startsWith("/media/") ? `${baseUrl}${value}` : value;

const escapeSvg = (value: unknown) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const latestArtifact = (artifacts: OperatorArtifactEnvelope[], kind: OperatorArtifactEnvelope["kind"]) =>
  artifacts.filter((artifact) => artifact.kind === kind).sort((left, right) => right.updatedAt - left.updatedAt)[0];

const artifactData = <T>(artifact?: OperatorArtifactEnvelope) => artifact?.data as T | undefined;
const storyboardBoardContractData = (board: StoryboardBoard) => {
  const {
    generatedImageUrl: _generatedImageUrl,
    visualReview: _visualReview,
    ...contract
  } = board;
  return contract;
};

const persistAutoQAArtifact = (artifact: OperatorArtifactEnvelope, relatedArtifacts: OperatorArtifactEnvelope[] = []) => {
  const saved = dbHelpers.saveOperatorArtifact(artifact);
  const verdict = runOperatorArtifactQA({ artifact: saved, relatedArtifacts });
  if (!verdict) throw new Error(`No automatic QA is registered for ${saved.kind}.`);
  const reviewed = dbHelpers.appendOperatorArtifactQA(saved.id, verdict);
  if (!reviewed || verdict.blocking) {
    throw new Error(`${saved.kind} refresh failed automatic QA: ${verdict.issues.map((issue) => issue.message).join("; ")}`);
  }
  return reviewed;
};

const sourcePromptKeysByAdoptionStatus = (
  assets: OperatorRegisteredAsset[],
  phase: string,
  adoptionStatus: "adopted" | "awaiting_review",
) => new Set(
  assets
    .filter((asset) => asset.metadata?.workerContract === MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION)
    .filter((asset) => asset.metadata?.phase === phase)
    .filter((asset) => asset.metadata?.adoptionStatus === adoptionStatus)
    .map((asset) => `${clean(asset.metadata?.sourceId)}:${clean(asset.metadata?.promptHash)}`)
    .filter((key) => !key.startsWith(":")),
);

const ensureRuntimeReady = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/api/operator/capabilities`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Runtime unavailable (${response.status}).`);
  const capabilities = await response.json() as { handbookVersion?: string };
  if (capabilities.handbookVersion !== OPERATOR_HANDBOOK_VERSION) {
    throw new Error(`Runtime handbook ${capabilities.handbookVersion || "unknown"} does not match source ${OPERATOR_HANDBOOK_VERSION}.`);
  }
};

const resolveImageProviderConfig = (): ImageProviderConfig => {
  const { config } = dbHelpers.getAIConfig();
  const modelConfigId = clean(config.routing.imageGen);
  const model = config.models.find((item) => item.id === modelConfigId);
  if (!model) throw new Error(`Configured imageGen model was not found: ${modelConfigId || "empty"}.`);
  const channel = config.channels.find((item) => item.id === model.channelId);
  if (!channel?.apiKey?.trim()) throw new Error(`Configured imageGen channel has no API key: ${model.channelId}.`);
  if (channel.type !== "kie" || !isKieImageModelId(model.modelId)) {
    throw new Error(`The resumable media worker does not yet support configured image adapter ${channel.type}/${model.modelId}.`);
  }
  return {
    channelId: channel.id,
    modelConfigId: model.id,
    modelId: model.modelId,
    resolution: isKieGptImage2ModelId(model.modelId)
      ? model.kieGptImage2?.resolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution
      : undefined,
  };
};

const uploadDataUrl = async (baseUrl: string, projectId: string, dataUrl: string) => {
  const response = await fetch(`${baseUrl}/api/assets/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, dataUrl }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error || `Media upload failed (${response.status}).`);
  return data.url;
};

const importRemoteImage = async (baseUrl: string, projectId: string, sourceUrl: string) => {
  const response = await fetch(`${baseUrl}/api/assets/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sourceUrl }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error || `Remote media import failed (${response.status}).`);
  return data.url;
};

const inspectMedia = async (baseUrl: string, mediaUrl: string) => {
  const response = await fetch(absoluteMediaUrl(baseUrl, mediaUrl), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Unable to inspect generated image (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) throw new Error("Generated image has no readable dimensions.");
  if (width <= height) throw new Error(`Generated image must be landscape, received ${width}x${height}.`);
  return { buffer, width, height, bytes: buffer.length };
};

const generateImage = async ({
  baseUrl,
  projectId,
  promptCore,
  provider,
  references = [],
  visualStyleProjection,
  visualRecipeInputEvidence,
}: {
  baseUrl: string;
  projectId: string;
  promptCore: string;
  provider: ImageProviderConfig;
  references?: ImageGenerationReference[];
  visualStyleProjection: NonNullable<ImageGenerationRequest["visualStyleProjection"]>;
  visualRecipeInputEvidence: NonNullable<ImageGenerationRequest["visualRecipeInputEvidence"]>;
}): Promise<GeneratedImage> => {
  const absoluteReferences = references.map((reference) => ({
    ...reference,
    imageUrl: absoluteMediaUrl(baseUrl, reference.imageUrl) || "",
  }));
  const compiled = compileImageGenerationRequest({
    promptCore,
    aspectRatio: "16:9",
    references: absoluteReferences,
    visualStyleProjection,
    visualRecipeInputEvidence,
  }, { enforcement: "formal" });
  const prompt = compiled.providerPrompt;
  const referenceImages = compiled.referenceImages;
  const gptImage2 = isKieGptImage2ModelId(provider.modelId);
  if (!gptImage2 && referenceImages.length > 1) {
    throw new Error("Kie 图片生成一次只接受一张参考图；当前职责清单包含多张素材，不能静默丢弃其余素材。");
  }
  if (gptImage2 && referenceImages.length > 16) throw new Error("Kie GPT Image 2 一次最多接受 16 张参考图；请在提交前减少引用，系统不会静默裁剪。");
  const request = gptImage2
    ? referenceImages.length
      ? { model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID, prompt, imageUrls: referenceImages, aspectRatio: compiled.aspectRatio, resolution: provider.resolution }
      : { model: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID, prompt, aspectRatio: compiled.aspectRatio, resolution: provider.resolution }
    : referenceImages.length
      ? { model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID, prompt, imageUrl: referenceImages[0] }
      : { model: KIE_GROK_TEXT_TO_IMAGE_MODEL_ID, prompt, aspectRatio: compiled.aspectRatio };
  const response = await fetch(`${baseUrl}/api/proxy/kie-grok-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId: provider.channelId, modelConfigId: provider.modelConfigId, request }),
    signal: AbortSignal.timeout(135_000),
  });
  const data = await response.json().catch(() => ({})) as {
    imageUrl?: string;
    taskId?: string;
    error?: string;
  };
  if (!response.ok || !data.imageUrl) throw new Error(data.error || `Image provider failed (${response.status}).`);
  const mediaUrl = data.imageUrl.startsWith("data:")
    ? await uploadDataUrl(baseUrl, projectId, data.imageUrl)
    : await importRemoteImage(baseUrl, projectId, data.imageUrl);
  if (!mediaUrl) throw new Error("Image provider returned no persistable result.");
  const inspected = await inspectMedia(baseUrl, mediaUrl);
  return {
    mediaUrl,
    width: inspected.width,
    height: inspected.height,
    bytes: inspected.bytes,
    requestId: data.taskId,
    imageReferenceManifest: compiled.references.map((reference, index) => ({
      index: index + 1,
      imageUrl: reference.imageUrl,
      label: reference.label,
      role: reference.role,
      preserve: reference.preserve,
      allowChange: reference.allowChange,
      exclude: reference.exclude,
    })),
    promptCompositionManifest: compiled.manifest,
    visualStyleCompileManifest: compiled.visualStyleProjection?.compileManifest,
  };
};

const storyboardCellSimilarityWarnings = async (panelImages: Buffer[]) => {
  const fingerprints = await Promise.all(panelImages.map((buffer) => sharp(buffer)
    .resize(16, 16, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer()));
  const warnings: string[] = [];
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      let total = 0;
      for (let index = 0; index < fingerprints[left].length; index += 1) {
        total += Math.abs(fingerprints[left][index] - fingerprints[right][index]);
      }
      const averageDifference = total / fingerprints[left].length;
      if (averageDifference < 2.5) warnings.push(`P${left + 1}_P${right + 1}_NEAR_DUPLICATE`);
    }
  }
  return warnings;
};

const compactLabel = (value: unknown, maxLength: number) => {
  const characters = Array.from(String(value || "").replace(/\s+/g, " ").trim());
  return characters.length <= maxLength ? characters.join("") : `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
};

const overlayStoryboardLabels = async ({
  baseUrl,
  projectId,
  image,
  board,
  projectTitle,
  sceneTitle,
}: {
  baseUrl: string;
  projectId: string;
  image: GeneratedImage;
  board: StoryboardBoard;
  projectTitle: string;
  sceneTitle: string;
}) => {
  const response = await fetch(absoluteMediaUrl(baseUrl, image.mediaUrl), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Unable to read storyboard for overlay (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const grid = resolveMediaStoryboardGrid(board);
  const layout = resolveMediaStoryboardCompositeLayout(board);
  const sourceTop = Math.max(0, Math.floor(height * MEDIA_STORYBOARD_SOURCE_HEADER_FRACTION));
  const sourceBottom = Math.min(height, Math.ceil(height * (1 - MEDIA_STORYBOARD_SOURCE_FOOTER_FRACTION)));
  const sourceCellWidth = Math.max(1, Math.floor(width / grid.columns));
  const sourceCellHeight = Math.max(1, Math.floor((sourceBottom - sourceTop) / grid.rows));
  const sourceVisualHeight = Math.max(1, Math.floor(sourceCellHeight * MEDIA_STORYBOARD_SOURCE_VISUAL_FRACTION));
  const panelImages = await Promise.all(board.panels.map(async (_, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const left = column * sourceCellWidth;
    const top = sourceTop + row * sourceCellHeight;
    const cropWidth = Math.min(sourceCellWidth, width - left);
    const cropHeight = Math.min(sourceVisualHeight, height - top);
    return sharp(buffer)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(layout.cellWidth, layout.imageHeight, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
  }));
  const panelComposites = panelImages.map((input, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    return {
      input,
      left: layout.margin + column * (layout.cellWidth + layout.gap),
      top: layout.headerHeight + layout.margin + row * (layout.cellHeight + layout.gap),
    };
  });
  const labels = board.panels.map((panel, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const x = layout.margin + column * (layout.cellWidth + layout.gap);
    const y = layout.headerHeight + layout.margin + row * (layout.cellHeight + layout.gap);
    const shotLabel = resolvePanelSourceShotLabel(board, panel);
    const captionTop = y + layout.imageHeight;
    const technicalLine = [
      panel.framing || panel.shotType || "story beat",
      panel.lens,
      panel.angle,
      panel.durationSeconds ? `${panel.durationSeconds}s` : undefined,
    ].filter(Boolean).join(" · ");
    return [
      `<rect x="${x}" y="${y}" width="${layout.cellWidth}" height="${layout.cellHeight}" fill="none" stroke="#191919" stroke-width="3"/>`,
      `<rect x="${x + 8}" y="${y + 8}" width="${Math.min(170, layout.cellWidth * 0.38)}" height="36" rx="3" fill="rgba(0,0,0,0.82)"/>`,
      `<text x="${x + 18}" y="${y + 33}" fill="#fff" font-size="22" font-weight="700">P${panel.panelNumber} · ${shotLabel}</text>`,
      `<rect x="${x}" y="${captionTop}" width="${layout.cellWidth}" height="${layout.captionHeight}" fill="#f4f1e9"/>`,
      `<text x="${x + 10}" y="${captionTop + 23}" fill="#171717" font-size="16" font-weight="700" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(compactLabel(technicalLine, 54))}</text>`,
      `<text x="${x + 10}" y="${captionTop + 47}" fill="#343434" font-size="15" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(compactLabel(panel.framePurpose, 38))}</text>`,
    ].join("");
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">
    <rect width="${layout.width}" height="${layout.headerHeight}" fill="#171717"/>
    <text x="${layout.margin}" y="32" fill="#fff" font-size="24" font-weight="700" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(compactLabel(`${projectTitle} · ${sceneTitle}`, 72))}</text>
    <text x="${layout.margin}" y="59" fill="#d4d4d4" font-size="15" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(compactLabel(`${board.videoGenerationUnitId || board.id} · ${board.strategyDecision.selectedStrategyId}`, 112))}</text>
    ${labels}
  </svg>`);
  const output = await sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: "#e8e5dc",
    },
  }).composite([...panelComposites, { input: svg, top: 0, left: 0 }]).png().toBuffer();
  const mediaUrl = await uploadDataUrl(baseUrl, projectId, `data:image/png;base64,${output.toString("base64")}`);
  const warnings = await storyboardCellSimilarityWarnings(panelImages);
  return { mediaUrl, warnings };
};

const createOrResumeRun = (project: Project) => {
  const runId = stableId("operator_media_run", project.id);
  const existing = dbHelpers.getOperatorRunById(runId);
  if (existing) return dbHelpers.patchOperatorRun(runId, { status: "running", handbookVersion: OPERATOR_HANDBOOK_VERSION })!;
  return dbHelpers.saveOperatorRun(createOperatorRunRecord({
    id: runId,
    projectId: project.id,
    provider: "codex",
    mode: "asset_generation",
    status: "running",
    handbookVersion: OPERATOR_HANDBOOK_VERSION,
    userRequest: `${MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION}: 在有限调用、可恢复和熔断约束下生成正式资产板、复合故事板和后续媒体。`,
    scope: { projectId: project.id, episodeIds: project.episodes.map((episode) => episode.id) },
  }));
};

const appendRunEvent = (run: OperatorRun, event: Record<string, unknown>) => {
  const saved = dbHelpers.appendOperatorRunEvent(run.id, event);
  if (!saved) throw new Error(`Unable to append event to ${run.id}.`);
  return saved;
};

const saveManifest = (run: OperatorRun, phase: string, data: Record<string, unknown>) => {
  const artifact = createOperatorArtifact({
    id: stableId("operator_media_manifest", `${run.projectId}:${phase}`),
    runId: run.id,
    projectId: run.projectId,
    kind: "custom",
    targetPath: `mediaProduction.${phase}.manifest`,
    entityIds: [run.projectId],
    status: "draft",
    data: { contractVersion: MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION, phase, ...data, updatedAt: Date.now() },
  }, run);
  return dbHelpers.saveOperatorArtifact(artifact);
};

const readAttemptState = ({
  artifacts,
  run,
  phase,
  sourceId,
  promptHash,
  entityId,
  failurePrefix,
}: {
  artifacts: OperatorArtifactEnvelope[];
  run: OperatorRun;
  phase: string;
  sourceId: string;
  promptHash: string;
  entityId: string;
  failurePrefix: string;
}): MediaAttemptState => {
  const manifestId = stableId("operator_media_manifest", `${run.projectId}:${phase}`);
  const manifest = artifacts.find((artifact) => artifact.id === manifestId);
  const persisted = (manifest?.data as { attemptsBySourceId?: Record<string, MediaAttemptState> } | undefined)
    ?.attemptsBySourceId?.[sourceId];
  if (persisted?.promptHash === promptHash) {
    return { ...persisted, attempts: Math.max(0, Math.floor(persisted.attempts || 0)) };
  }
  if (persisted) return { attempts: 0, promptHash };
  const historicalFailures = run.events.filter((event) => {
    if (event.type !== "qa_failed" || !event.message.startsWith(failurePrefix) || !asArray<string>(event.entityIds).includes(entityId)) return false;
    const eventPromptHash = clean((event.data as { promptHash?: string } | undefined)?.promptHash);
    return !eventPromptHash || eventPromptHash === promptHash;
  }).length;
  return { attempts: historicalFailures, promptHash };
};

const summarizeFailedWork = <T,>(
  results: WorkResult<T>[],
  identify: (item: T) => { sourceId: string; name: string },
  attemptsBySourceId: Record<string, MediaAttemptState>,
) => results.flatMap((result) => {
  if (result.status !== "failed") return [];
  const identity = identify(result.item);
  return [{
    ...identity,
    attempts: attemptsBySourceId[identity.sourceId]?.attempts || 0,
    error: result.error || "unknown",
  }];
});

const registerGeneratedAsset = ({
  run,
  sourceArtifactId,
  sourceId,
  phase,
  prompt,
  image,
  targetEntity,
  warningCodes = [],
  provider,
  candidateId,
  sourceContentHash,
}: {
  run: OperatorRun;
  sourceArtifactId?: string;
  sourceId: string;
  phase: "assets" | "storyboards";
  prompt: string;
  image: GeneratedImage;
  targetEntity: OperatorRegisteredAsset["targetEntity"];
  warningCodes?: string[];
  provider: ImageProviderConfig;
  candidateId?: string;
  sourceContentHash?: string;
}) => dbHelpers.saveOperatorAsset({
  id: stableId("operator_media_asset", `${run.projectId}:${phase}:${sourceId}${candidateId ? `:${candidateId}` : ""}`),
  projectId: run.projectId,
  runId: run.id,
  artifactId: sourceArtifactId,
  kind: "image",
  mediaUrl: image.mediaUrl,
  prompt,
  targetEntity,
  qaStatus: "warning",
  metadata: {
    workerContract: MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION,
    phase,
    sourceId,
    promptHash: stableHash(prompt),
    channelId: provider.channelId,
    modelConfigId: provider.modelConfigId,
    providerModelId: provider.modelId,
    providerRequestId: image.requestId,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    technicalQA: "passed",
    visualQA: "manual_review_required",
    warningCodes,
    usage: image.usage,
    imageReferenceManifest: image.imageReferenceManifest,
    promptCompositionManifest: image.promptCompositionManifest,
    visualStyleCompileManifest: image.visualStyleCompileManifest,
    ...(sourceContentHash ? { sourceContentHash } : {}),
    ...(candidateId ? { candidateId, adoptionStatus: "awaiting_review" } : {}),
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const runInBatches = async <T,>({
  items,
  concurrency,
  worker,
  onBatch,
}: {
  items: T[];
  concurrency: number;
  worker: (item: T) => Promise<WorkResult<T>>;
  onBatch: (results: WorkResult<T>[]) => Promise<void>;
}) => {
  let consecutiveFailures = 0;
  const results: WorkResult<T>[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(async (item) => {
      try {
        return await worker(item);
      } catch (error) {
        return { item, status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    for (const result of batchResults) {
      consecutiveFailures = result.status === "failed" ? consecutiveFailures + 1 : 0;
      results.push(result);
    }
    await onBatch(batchResults);
    const circuit = evaluateMediaProductionCircuitBreaker({ consecutiveFailures });
    if (circuit.open) return { results, stoppedReason: circuit.reason };
  }
  return { results, stoppedReason: undefined };
};

const saveSourceReviewRevision = ({
  artifact,
  data,
  projectionHash,
  reason,
}: {
  artifact: OperatorArtifactEnvelope;
  data: Record<string, unknown>;
  projectionHash: string;
  reason: string;
}) => {
  const now = Date.now();
  const draft = artifact.status === "draft";
  const previousSourceReview = (artifact.data as { sourceReview?: { sourceArtifactId?: string } } | undefined)?.sourceReview;
  return dbHelpers.saveOperatorArtifact({
    ...artifact,
    id: draft
      ? artifact.id
      : stableId("operator_source_review_revision", `${artifact.id}:${projectionHash}`),
    targetPath: draft ? artifact.targetPath : `${artifact.targetPath}.source-review.${projectionHash.slice(0, 8)}`,
    status: "draft",
    data: {
      ...data,
      sourceReview: {
        status: "review_recommended",
        reason,
        sourceArtifactId: previousSourceReview?.sourceArtifactId || artifact.id,
        detectedAt: now,
      },
    },
    qaVerdicts: [],
    provenance: {
      ...artifact.provenance,
      inputContextHash: projectionHash,
      generatedAt: now,
    },
    commitResult: undefined,
    createdAt: draft ? artifact.createdAt : now,
    updatedAt: now,
  });
};

const propagateAssetReferences = (project: Project, artifacts: OperatorArtifactEnvelope[]) => {
  const boardUrl = new Map<string, string | undefined>();
  const boardPlan = buildVideoStoryboardAssetBoardPlan(project);
  const boardItemUrl = new Map([
    ...boardPlan.characterBoards,
    ...boardPlan.sceneBoards,
    ...boardPlan.propBoards,
    ...boardPlan.variantBoards,
  ].map((board) => [board.id, board.productionReferenceImageUrl] as const));
  for (const character of project.characters) {
    boardUrl.set(`${character.id}:`, character.boardImageUrl);
    for (const variant of character.variants || []) boardUrl.set(`${character.id}:${variant.id}`, variant.boardImageUrl);
  }
  for (const asset of project.assets) {
    boardUrl.set(`${asset.id}:`, asset.boardImageUrl);
    for (const variant of asset.variants || []) boardUrl.set(`${asset.id}:${variant.id}`, variant.boardImageUrl);
  }
  const projectedReferenceUrl = (keys: string[], fallback?: string) => {
    const knownKey = keys.find((key) => boardUrl.has(key));
    return knownKey ? boardUrl.get(knownKey) : fallback;
  };
  let updated = 0;
  const seenProjectionKeys = new Set<string>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind === "formal_asset_package") {
      const data = artifact.data as { formalAssetPackage?: FormalAssetPackage };
      const formalPackage = data.formalAssetPackage;
      if (!formalPackage) continue;
      const projectionKey = "formal_asset_package";
      if (seenProjectionKeys.has(projectionKey)) continue;
      seenProjectionKeys.add(projectionKey);
      const identityBoards = formalPackage.identityBoards.map((item) => {
        const referenceImageUrl = boardItemUrl.has(item.boardItemId)
          ? boardItemUrl.get(item.boardItemId)
          : item.referenceImageUrl;
        return {
          ...item,
          referenceImageUrl,
          readiness: referenceImageUrl
            ? "reference_ready" as const
            : item.prompt
              ? "prompt_ready" as const
              : "needs_prompt" as const,
        };
      });
      const nextData = { ...data, formalAssetPackage: { ...formalPackage, identityBoards } };
      const currentHash = stableHash(JSON.stringify(formalPackage.identityBoards));
      const projectionHash = stableHash(JSON.stringify(identityBoards));
      if (currentHash === projectionHash) continue;
      saveSourceReviewRevision({ artifact, data: nextData, projectionHash, reason: "project_asset_reference_updated" });
      updated += 1;
    }
    if (artifact.kind === "asset_reference_pack") {
      const data = artifact.data as { assetReferencePack?: AssetReferencePack };
      const pack = data.assetReferencePack;
      if (!pack) continue;
      const projectionKey = `asset_reference_pack:${pack.id}`;
      if (seenProjectionKeys.has(projectionKey)) continue;
      seenProjectionKeys.add(projectionKey);
      const items = pack.items.map((item) => ({
        ...item,
        referenceImageUrl: projectedReferenceUrl(
          [`${item.assetId}:${item.variantId || ""}`, `${item.assetId}:`],
          item.referenceImageUrl,
        ),
      }));
      const currentHash = stableHash(JSON.stringify(pack.items));
      const projectionHash = stableHash(JSON.stringify(items));
      if (currentHash === projectionHash) continue;
      saveSourceReviewRevision({
        artifact,
        data: { ...data, assetReferencePack: { ...pack, items } },
        projectionHash,
        reason: "project_asset_reference_updated",
      });
      updated += 1;
    }
    if (artifact.kind === "scene_visual_pack") {
      const data = artifact.data as { sceneVisualPack?: { referenceSlots?: Array<Record<string, unknown>> } };
      const pack = data.sceneVisualPack;
      if (!pack?.referenceSlots) continue;
      const packId = clean((pack as { id?: string }).id) || artifact.targetPath;
      const projectionKey = `scene_visual_pack:${packId}`;
      if (seenProjectionKeys.has(projectionKey)) continue;
      seenProjectionKeys.add(projectionKey);
      const referenceSlots = pack.referenceSlots.map((slot) => ({
        ...slot,
        referenceImageUrl: projectedReferenceUrl(
          [`${clean(slot.assetId)}:${clean(slot.variantId)}`, `${clean(slot.assetId)}:`],
          clean(slot.referenceImageUrl) || undefined,
        ),
      }));
      const currentHash = stableHash(JSON.stringify(pack.referenceSlots));
      const projectionHash = stableHash(JSON.stringify(referenceSlots));
      if (currentHash === projectionHash) continue;
      saveSourceReviewRevision({
        artifact,
        data: { ...data, sceneVisualPack: { ...pack, referenceSlots } },
        projectionHash,
        reason: "project_asset_reference_updated",
      });
      updated += 1;
    }
  }
  return updated;
};

const produceAssetBoards = async ({
  options,
  project,
  run,
  provider,
}: {
  options: WorkerOptions;
  project: Project;
  run: OperatorRun;
  provider: ImageProviderConfig;
}) => {
  propagateAssetReferences(project, dbHelpers.listOperatorArtifacts({ projectId: project.id }));
  const artifacts = dbHelpers.listOperatorArtifacts({ projectId: project.id });
  const packageArtifact = latestArtifact(artifacts, "formal_asset_package");
  const packageData = artifactData<{ formalAssetPackage?: FormalAssetPackage }>(packageArtifact);
  const formalAssetPackage = packageData?.formalAssetPackage;
  if (!packageArtifact || !formalAssetPackage) throw new Error("Formal asset package artifact was not found.");
  const ordered = [...formalAssetPackage.identityBoards].sort((left, right) => Number(Boolean(left.boardKind === "variant_board")) - Number(Boolean(right.boardKind === "variant_board")));
  const promptFor = (board: AssetIdentityBoard) => {
    const currentPlan = buildVideoStoryboardAssetBoardPlan(dbHelpers.getProjectById(project.id) as Project);
    const currentBoard = [...currentPlan.characterBoards, ...currentPlan.sceneBoards, ...currentPlan.propBoards, ...currentPlan.variantBoards]
      .find((item) => item.id === board.boardItemId);
    return buildAssetBoardMediaPrompt({ ...board, prompt: currentBoard?.prompt || board.prompt });
  };
  const adoptedPromptHashes = new Map((project.manualProductionAssets?.references || [])
    .filter((reference) => (reference.referenceMode || "production_board") === "production_board")
    .map((reference) => [reference.boardItemId, reference.promptHash] as const));
  const pendingPromptHashes = new Map((project.manualProductionAssets?.pendingReferences || [])
    .filter((candidate) => (candidate.referenceMode || "production_board") === "production_board")
    .map((candidate) => [candidate.boardItemId, candidate.promptHash] as const));
  const adoptedCompletedIds = new Set(ordered.filter((board) => {
    const promptHash = stableHash(promptFor(board));
    return adoptedPromptHashes.get(board.boardItemId) === promptHash;
  }).map((board) => board.id));
  const existingPendingIds = new Set(ordered.filter((board) => {
    const promptHash = stableHash(promptFor(board));
    return pendingPromptHashes.get(board.boardItemId) === promptHash;
  }).map((board) => board.id));
  const resolvedGenerationIds = new Set([...adoptedCompletedIds, ...existingPendingIds]);
  const attemptsBySourceId = Object.fromEntries(ordered.map((board) => [board.id, readAttemptState({
    artifacts,
    run,
    phase: "assets",
    sourceId: board.id,
    promptHash: stableHash(promptFor(board)),
    entityId: board.assetId,
    failurePrefix: "资产板生成失败：",
  })]));
  const unresolved = ordered.filter((board) => !resolvedGenerationIds.has(board.id));
  const exhausted = unresolved.filter((board) => attemptsBySourceId[board.id].attempts >= options.maxAttempts);
  const pending = unresolved.filter((board) => attemptsBySourceId[board.id].attempts < options.maxAttempts).slice(0, options.limit);
  const completed = adoptedCompletedIds.size;
  let awaitingReviewCount = existingPendingIds.size;
  saveManifest(run, "assets", {
    status: pending.length ? "running" : exhausted.length ? "blocked" : awaitingReviewCount ? "awaiting_review" : "completed",
    total: ordered.length,
    completed,
    awaitingReview: awaitingReviewCount,
    pending: pending.length,
    exhausted: exhausted.map((board) => ({ sourceId: board.id, name: board.assetName, attempts: attemptsBySourceId[board.id].attempts })),
    concurrency: options.concurrency,
    maxAttempts: options.maxAttempts,
    attemptsBySourceId,
  });
  const outcome = await runInBatches({
    items: pending,
    concurrency: options.concurrency,
    worker: async (board) => {
      attemptsBySourceId[board.id] = {
        ...attemptsBySourceId[board.id],
        attempts: attemptsBySourceId[board.id].attempts + 1,
        lastAttemptAt: Date.now(),
        lastError: undefined,
      };
      const currentProject = dbHelpers.getProjectById(project.id) as Project;
      const currentPlan = buildVideoStoryboardAssetBoardPlan(currentProject);
      const currentBoard = [
        ...currentPlan.characterBoards,
        ...currentPlan.sceneBoards,
        ...currentPlan.propBoards,
        ...currentPlan.variantBoards,
      ].find((item) => item.id === board.boardItemId);
      if (!currentBoard) throw new Error(`Asset board item not found in project: ${board.boardItemId}`);
      const reference = resolveProductionAssetBoardGenerationReference(currentProject, currentBoard);
      if (reference.issue && board.boardKind === "variant_board") throw new Error(reference.issue);
      const prompt = buildAssetBoardMediaPrompt({ ...board, prompt: currentBoard.prompt || board.prompt });
      const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
        project: currentProject,
        boardItemId: currentBoard.id,
        referenceMode: "production_board",
      });
      const priorPromptHash = adoptedPromptHashes.get(board.boardItemId) || pendingPromptHashes.get(board.boardItemId);
      const staleExistingPrompt = Boolean(priorPromptHash && priorPromptHash !== stableHash(prompt));
      const visualStyleProjection = buildProductionAssetImageVisualStyleProjection({
        project: currentProject,
        asset: currentBoard,
      });
      const image = await generateImage({
        baseUrl: options.baseUrl,
        projectId: project.id,
        promptCore: prompt,
        provider,
        references: reference.imageUrl && (!staleExistingPrompt || board.boardKind === "variant_board")
          ? [buildProductionAssetBoardCanonicalReference({ board: currentBoard, imageUrl: reference.imageUrl })]
          : [],
        visualStyleProjection,
        visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project: currentProject, asset: currentBoard }),
      });
      return { item: board, status: "generated" as const, image, prompt, sourceContentHash };
    },
    onBatch: async (batchResults) => {
      for (const result of batchResults) {
        if (result.status !== "generated" || !result.image || !result.prompt) {
          attemptsBySourceId[result.item.id] = {
            ...attemptsBySourceId[result.item.id],
            lastError: result.error || "unknown",
          };
          appendRunEvent(run, {
            type: "qa_failed",
            message: `资产板生成失败：${result.item.assetName}；${result.error || "unknown"}`,
            entityIds: [result.item.assetId],
            data: { sourceId: result.item.id, promptHash: attemptsBySourceId[result.item.id].promptHash, attempt: attemptsBySourceId[result.item.id].attempts },
          });
          continue;
        }
        attemptsBySourceId[result.item.id] = {
          ...attemptsBySourceId[result.item.id],
          lastError: undefined,
        };
        const candidateId = stableId(
          "asset_board_candidate",
          `${project.id}:${result.item.id}:${result.image.mediaUrl}`,
        );
        const latestProject = dbHelpers.getProjectById(project.id) as Project | null;
        if (!latestProject) throw new Error(`Project disappeared while staging asset candidate: ${project.id}`);
        const update = stageProductionAssetBoardReferenceCandidate({
          project: latestProject,
          candidateId,
          boardItemId: result.item.boardItemId,
          imageUrl: result.image.mediaUrl,
          source: "ai_generation",
          finalPrompt: result.prompt,
          modelId: provider.modelConfigId,
          imageReferenceManifest: result.image.imageReferenceManifest,
          promptCompositionManifest: result.image.promptCompositionManifest,
          visualStyleCompileManifest: result.image.visualStyleCompileManifest,
          sourceContentHash: result.sourceContentHash,
          review: { mode: "manual", status: "pending" },
          sourceRunId: run.id,
        });
        dbHelpers.updateProjectMeta(project.id, update);
        registerGeneratedAsset({
          run,
          sourceArtifactId: packageArtifact.id,
          sourceId: result.item.id,
          phase: "assets",
          prompt: result.prompt,
          image: result.image,
          provider,
          candidateId,
          targetEntity: { type: result.item.assetType === "character" ? "character" : "asset", id: result.item.assetId, field: "pendingBoardImageCandidate" },
        });
        awaitingReviewCount += 1;
        appendRunEvent(run, {
          type: "user_decision_required",
          message: `资产板候选已生成并持久化，等待用户采用：${result.item.assetName}`,
          entityIds: [result.item.assetId],
          data: { candidateId, mediaUrl: result.image.mediaUrl, sourceId: result.item.id },
        });
      }
      saveManifest(run, "assets", {
        status: "awaiting_review",
        total: ordered.length,
        completed,
        awaitingReview: awaitingReviewCount,
        pending: Math.max(0, ordered.length - completed - awaitingReviewCount),
        concurrency: options.concurrency,
        maxAttempts: options.maxAttempts,
        attemptsBySourceId,
        failures: summarizeFailedWork(batchResults, (board) => ({ sourceId: board.id, name: board.assetName }), attemptsBySourceId),
      });
      console.log(`[media:assets] adopted=${completed}/${ordered.length} awaitingReview=${awaitingReviewCount} batchGenerated=${batchResults.filter((result) => result.status === "generated").length} batchFailed=${batchResults.filter((result) => result.status === "failed").length}`);
    },
  });
  const refreshedProject = dbHelpers.getProjectById(project.id) as Project;
  const propagated = propagateAssetReferences(refreshedProject, dbHelpers.listOperatorArtifacts({ projectId: project.id }));
  const exhaustedAfterRun = ordered.filter((board) => !resolvedGenerationIds.has(board.id)
    && !outcome.results.some((result) => result.item.id === board.id && result.status === "generated")
    && attemptsBySourceId[board.id].attempts >= options.maxAttempts);
  const failures = summarizeFailedWork(outcome.results, (board) => ({ sourceId: board.id, name: board.assetName }), attemptsBySourceId);
  const refreshedBoards = buildVideoStoryboardAssetBoardPlan(refreshedProject);
  const boardByItemId = new Map([
    ...refreshedBoards.characterBoards,
    ...refreshedBoards.sceneBoards,
    ...refreshedBoards.propBoards,
    ...refreshedBoards.variantBoards,
  ].map((board) => [board.id, board]));
  const relevantPendingCandidates = (refreshedProject.manualProductionAssets?.pendingReferences || [])
    .filter((candidate) => boardByItemId.has(candidate.boardItemId)
      && (candidate.referenceMode || "production_board") === "production_board");
  const awaitingReview = relevantPendingCandidates.length;
  const awaitingRequiredReview = relevantPendingCandidates
    .filter((candidate) => !boardByItemId.get(candidate.boardItemId)?.referenceImageUrl)
    .length;
  saveManifest(run, "assets", {
    status: outcome.stoppedReason || exhaustedAfterRun.length ? "blocked" : awaitingReview ? "awaiting_review" : completed >= ordered.length ? "completed" : "partial",
    total: ordered.length,
    completed,
    generatedThisRun: outcome.results.filter((result) => result.status === "generated").length,
    failedThisRun: outcome.results.filter((result) => result.status === "failed").length,
    propagatedArtifactCount: propagated,
    awaitingReview,
    awaitingRequiredReview,
    stoppedReason: outcome.stoppedReason,
    maxAttempts: options.maxAttempts,
    attemptsBySourceId,
    failures,
    exhausted: exhaustedAfterRun.map((board) => ({ sourceId: board.id, name: board.assetName, attempts: attemptsBySourceId[board.id].attempts })),
  });
  return { total: ordered.length, completed, outcome, propagated, awaitingReview, awaitingRequiredReview };
};

const sceneById = (project: Project, sceneId: string): Scene | undefined => project.episodes
  .flatMap((episode) => (episode as { scenes?: Scene[] }).scenes || [])
  .find((scene) => scene.id === sceneId);

const assetIdentitySummaryMap = (project: Project) => new Map([
  ...project.characters.map((item) => [
    item.id,
    [item.name, item.visualIdentity || item.multiViewPrompt || item.boardPrompt].filter(Boolean).join("："),
  ] as const),
  ...project.assets.map((item) => [
    item.id,
    [item.name, item.description || item.multiViewPrompt || item.boardPrompt || item.prompt].filter(Boolean).join("："),
  ] as const),
]);

const assetDisplayNameMap = (project: Project) => new Map([
  ...project.characters.map((item) => [item.id, item.name] as const),
  ...project.assets.map((item) => [item.id, item.name] as const),
]);

const refreshProductionHandoffs = ({
  project,
  artifacts,
  run,
}: {
  project: Project;
  artifacts: OperatorArtifactEnvelope[];
  run: OperatorRun;
}) => {
  const sourceShotHash = stableHash(JSON.stringify((project.episodes as Episode[]).flatMap((episode) =>
    (episode.scenes || []).flatMap((scene) => (scene.shots || []).map((shot) => ({
      id: shot.id,
      visualAction: shot.visualAction,
      characterIdsInShot: shot.characterIdsInShot,
      propIds: shot.propIds,
    }))),
  )));
  const currentPrepArtifact = artifacts.find((artifact) =>
    artifact.kind === "department_prep_package" && clean((artifact.data as any)?.sourceShotHash) === sourceShotHash,
  );
  if (currentPrepArtifact) return artifacts;

  const scriptLockPackage = artifactData<any>(latestArtifact(artifacts, "script_lock_package"))?.scriptLockPackage;
  const productionBlockLock = artifactData<any>(latestArtifact(artifacts, "production_block_lock"))?.productionBlockLock;
  const productionBreakdownReport = buildProductionBreakdownReport({
    project,
    episodes: project.episodes as Episode[],
    scriptLockPackage,
    productionBlockLock,
    createdAt: Date.now(),
  });
  const departmentPrepPackages = buildDepartmentPrepPackages(project, productionBreakdownReport, Date.now());
  const breakdownArtifact = createOperatorArtifact({
    id: stableId("operator_media_handoff_breakdown", `${project.id}:${sourceShotHash}`),
    runId: run.id,
    projectId: project.id,
    kind: "production_breakdown_report",
    targetPath: "mediaProduction.handoff.productionBreakdownReport",
    entityIds: [project.id, ...productionBreakdownReport.sceneMatrix.flatMap((row) => [row.sceneId, ...row.shotIds]).filter(Boolean)],
    status: "approved",
    data: { sourceShotHash, productionBreakdownReport },
  }, run);
  const reviewedBreakdown = persistAutoQAArtifact(breakdownArtifact, artifacts);
  const prepArtifact = createOperatorArtifact({
    id: stableId("operator_media_handoff_departments", `${project.id}:${sourceShotHash}`),
    runId: run.id,
    projectId: project.id,
    kind: "department_prep_package",
    targetPath: "mediaProduction.handoff.departmentPrepPackages",
    entityIds: [project.id, ...departmentPrepPackages.flatMap((item) => [...item.sceneRefs, ...item.shotRefs])],
    status: "approved",
    data: { sourceShotHash, productionBreakdownReportId: productionBreakdownReport.id, departmentPrepPackages },
  }, run);
  persistAutoQAArtifact(prepArtifact, [...artifacts, reviewedBreakdown]);
  appendRunEvent(run, {
    type: "artifact_refreshed",
    message: `Shot 内容变化后已刷新生产拆解与 ${departmentPrepPackages.length} 个部门筹备交接包。`,
    entityIds: [project.id],
    data: { sourceShotHash, productionBreakdownReportId: productionBreakdownReport.id },
  });
  return dbHelpers.listOperatorArtifacts({ projectId: project.id });
};

const refreshStoryboardBoardArtifacts = ({
  project,
  artifacts,
}: {
  project: Project;
  artifacts: OperatorArtifactEnvelope[];
}) => {
  const prepPackages = artifacts
    .filter((artifact) => artifact.kind === "department_prep_package")
    .flatMap((artifact) => {
      const data = artifact.data as {
        departmentPrepPackage?: DepartmentPrepPackage;
        departmentPrepPackages?: DepartmentPrepPackage[];
      };
      return [data.departmentPrepPackage, ...asArray<DepartmentPrepPackage>(data.departmentPrepPackages)]
        .filter((item): item is DepartmentPrepPackage => Boolean(item));
    });
  const departmentPrepPackages: DepartmentPrepPackage[] = [];
  const seenPrepPackageIds = new Set<string>();
  for (const item of prepPackages) {
    if (seenPrepPackageIds.has(item.id)) continue;
    seenPrepPackageIds.add(item.id);
    departmentPrepPackages.push(item);
  }
  const drafts = buildProductionStoryboardBoardDrafts(project, project.episodes as Episode[], {
    departmentPrepPackages,
    requireDepartmentPrepRefs: departmentPrepPackages.length > 0,
  });
  const blockingIssues = drafts.issues.filter((issue) => issue.severity === "blocking");
  if (blockingIssues.length) {
    throw new Error(`Refreshed storyboard contracts have ${blockingIssues.length} blocking issue(s): ${blockingIssues.slice(0, 3).map((issue) => issue.code).join(", ")}`);
  }
  const boardById = new Map(drafts.storyboardBoards.map((board) => [board.id, board]));
  const seenStoryboardIds = new Set<string>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind !== "storyboard_board") continue;
    const current = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    const refreshed = current ? boardById.get(current.id) : undefined;
    if (!current || !refreshed || seenStoryboardIds.has(current.id)) continue;
    seenStoryboardIds.add(current.id);
    const currentHash = stableHash(JSON.stringify(storyboardBoardContractData(current)));
    const projectionHash = stableHash(JSON.stringify(storyboardBoardContractData(refreshed)));
    if (currentHash === projectionHash) continue;
    const refreshedWithAdoptedVisual = {
      ...refreshed,
      ...(current.generatedImageUrl ? { generatedImageUrl: current.generatedImageUrl } : {}),
      ...(current.visualReview ? { visualReview: current.visualReview } : {}),
    };
    saveSourceReviewRevision({
      artifact,
      data: { ...(artifact.data as Record<string, unknown>), storyboardBoard: refreshedWithAdoptedVisual },
      projectionHash,
      reason: "project_shot_source_updated",
    });
  }
  const seenCustomTargets = new Set<string>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind !== "custom") continue;
    const data = artifact.data as Record<string, unknown>;
    const directBoards = asArray<StoryboardBoard>(data.storyboardBoards);
    const draftEnvelope = data.storyboardBoardDrafts as { storyboardBoards?: StoryboardBoard[] } | undefined;
    if (!directBoards.length && !asArray<StoryboardBoard>(draftEnvelope?.storyboardBoards).length) continue;
    if (seenCustomTargets.has(artifact.targetPath)) continue;
    seenCustomTargets.add(artifact.targetPath);
    const nextData = {
      ...data,
      ...(directBoards.length ? { storyboardBoards: directBoards.map((board) => boardById.get(board.id) || board) } : {}),
      ...(draftEnvelope ? {
        storyboardBoardDrafts: {
          ...draftEnvelope,
          storyboardBoards: asArray<StoryboardBoard>(draftEnvelope.storyboardBoards).map((board) => boardById.get(board.id) || board),
        },
      } : {}),
    };
    const currentHash = stableHash(JSON.stringify({ directBoards, storyboardBoardDrafts: draftEnvelope }));
    const projectionHash = stableHash(JSON.stringify({
      directBoards: (nextData as { storyboardBoards?: StoryboardBoard[] }).storyboardBoards,
      storyboardBoardDrafts: (nextData as { storyboardBoardDrafts?: unknown }).storyboardBoardDrafts,
    }));
    if (currentHash === projectionHash) continue;
    saveSourceReviewRevision({
      artifact,
      data: nextData,
      projectionHash,
      reason: "project_shot_source_updated",
    });
  }
  return {
    artifacts: dbHelpers.listOperatorArtifacts({ projectId: project.id }),
    refreshedCount: boardById.size,
  };
};

const produceStoryboardBoards = async ({
  options,
  project,
  run,
  provider,
}: {
  options: WorkerOptions;
  project: Project;
  run: OperatorRun;
  provider: ImageProviderConfig;
}) => {
  const beforePropagation = dbHelpers.listOperatorArtifacts({ projectId: project.id });
  propagateAssetReferences(project, beforePropagation);
  const existingArtifacts = dbHelpers.listOperatorArtifacts({ projectId: project.id });
  const handoffArtifacts = refreshProductionHandoffs({ project, artifacts: existingArtifacts, run });
  const refreshed = refreshStoryboardBoardArtifacts({ project, artifacts: handoffArtifacts });
  const artifacts = refreshed.artifacts;
  const boardArtifactById = new Map<string, OperatorArtifactEnvelope>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind !== "storyboard_board") continue;
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (board && !boardArtifactById.has(board.id)) boardArtifactById.set(board.id, artifact);
  }
  const boardArtifacts = [...boardArtifactById.values()]
    .sort((left, right) => compareMediaProductionOrder(left.targetPath, right.targetPath));
  const packById = new Map<string, { artifact: OperatorArtifactEnvelope; pack: AssetReferencePack }>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind !== "asset_reference_pack") continue;
    const pack = (artifact.data as { assetReferencePack?: AssetReferencePack }).assetReferencePack;
    if (pack && !packById.has(pack.id)) packById.set(pack.id, { artifact, pack });
  }
  const unitByBoardId = new Map<string, { storyboardBoardId?: string; assetReferencePackId?: string }>();
  for (const artifact of [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (artifact.kind !== "video_generation_unit") continue;
    const unit = (artifact.data as { videoGenerationUnit?: { storyboardBoardId?: string; assetReferencePackId?: string } }).videoGenerationUnit;
    if (unit?.storyboardBoardId && !unitByBoardId.has(unit.storyboardBoardId)) unitByBoardId.set(unit.storyboardBoardId, unit);
  }
  const displayNames = assetDisplayNameMap(project);
  const readableAssetName = (assetId: string) => {
    const name = displayNames.get(assetId)?.trim();
    if (!name) throw new Error(`Asset ${assetId} is missing a readable name; database IDs will not be sent to the image model.`);
    return name;
  };
  const registered = dbHelpers.listOperatorAssets({ projectId: project.id });
  const adoptedPromptKeys = sourcePromptKeysByAdoptionStatus(registered, "storyboards", "adopted");
  const pendingReviewPromptKeys = sourcePromptKeysByAdoptionStatus(registered, "storyboards", "awaiting_review");
  const promptForArtifact = (artifact: OperatorArtifactEnvelope) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (!board) return undefined;
    const scene = sceneById(project, board.sceneId);
    if (!scene) return undefined;
    const unit = unitByBoardId.get(board.id);
    const pack = unit?.assetReferencePackId ? packById.get(unit.assetReferencePackId)?.pack : undefined;
    const relevantItems = selectStoryboardReferenceItems(board, pack?.items);
    return buildStoryboardBoardMediaPrompt({
      projectTitle: project.title,
      sceneTitle: scene.title,
      board,
      assetNames: relevantItems.map((item) => readableAssetName(item.assetId)),
      assetLabels: relevantItems.map((item) => ({
        assetId: item.assetId,
        assetType: item.assetType,
        name: readableAssetName(item.assetId),
      })),
    });
  };
  const completedIds = new Set(boardArtifacts.flatMap((artifact) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (!board) return [];
    const prompt = promptForArtifact(artifact);
    if (!prompt) return [];
    return adoptedPromptKeys.has(`${board.id}:${stableHash(prompt)}`) ? [board.id] : [];
  }));
  const pendingReviewIds = new Set(boardArtifacts.flatMap((artifact) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (!board) return [];
    const prompt = promptForArtifact(artifact);
    if (!prompt) return [];
    return pendingReviewPromptKeys.has(`${board.id}:${stableHash(prompt)}`) ? [board.id] : [];
  }));
  if (options.phase === "contracts") {
    saveManifest(run, "storyboards", {
      status: completedIds.size >= boardArtifacts.length ? "completed" : "contracts_ready",
      total: boardArtifacts.length,
      completed: completedIds.size,
      pending: Math.max(0, boardArtifacts.length - completedIds.size),
      contractOnly: true,
      refreshedCount: refreshed.refreshedCount,
    });
    return { total: boardArtifacts.length, completed: completedIds.size, contractOnly: true, outcome: { results: [] } };
  }
  const attemptsBySourceId = Object.fromEntries(boardArtifacts.flatMap((artifact) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    const prompt = promptForArtifact(artifact);
    return board ? [[board.id, readAttemptState({
      artifacts,
      run,
      phase: "storyboards",
      sourceId: board.id,
      promptHash: stableHash(prompt || board.id),
      entityId: board.id,
      failurePrefix: "复合故事板生成失败：",
    })] as const] : [];
  }));
  const unresolved = boardArtifacts.filter((artifact) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    return Boolean(board && !completedIds.has(board.id) && !pendingReviewIds.has(board.id));
  });
  const pendingCandidateKeys = new Set((project.manualProductionAssets?.pendingReferences || [])
    .map((candidate) => `${candidate.assetId}:${candidate.variantId || ""}`));
  const referenceReadiness = (artifact: OperatorArtifactEnvelope) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (!board) return classifyStoryboardReferenceReadiness([], pendingCandidateKeys);
    const unit = unitByBoardId.get(board.id);
    const pack = unit?.assetReferencePackId ? packById.get(unit.assetReferencePackId)?.pack : undefined;
    return classifyStoryboardReferenceReadiness(
      selectStoryboardReferenceItems(board, pack?.items),
      pendingCandidateKeys,
    );
  };
  const awaitingAssetReview = unresolved.filter((artifact) => referenceReadiness(artifact).status === "awaiting_asset_review");
  const missingAssetReference = unresolved.filter((artifact) => referenceReadiness(artifact).status === "missing_asset_reference");
  const actionableUnresolved = unresolved.filter((artifact) => referenceReadiness(artifact).status === "ready");
  const exhausted = actionableUnresolved.filter((artifact) => {
    const board = (artifact.data as { storyboardBoard: StoryboardBoard }).storyboardBoard;
    return attemptsBySourceId[board.id].attempts >= options.maxAttempts;
  });
  const pending = actionableUnresolved.filter((artifact) => {
    const board = (artifact.data as { storyboardBoard: StoryboardBoard }).storyboardBoard;
    return attemptsBySourceId[board.id].attempts < options.maxAttempts;
  }).slice(0, options.limit);
  const completed = completedIds.size;
  let awaitingStoryboardReview = pendingReviewIds.size;
  saveManifest(run, "storyboards", {
    status: pending.length
      ? "running"
      : exhausted.length
        ? "blocked"
        : missingAssetReference.length
          ? "missing_asset_reference"
          : awaitingAssetReview.length
            ? "awaiting_asset_review"
            : awaitingStoryboardReview
              ? "awaiting_review"
              : "completed",
    total: boardArtifacts.length,
    completed,
    pending: pending.length,
    awaitingReview: awaitingStoryboardReview,
    awaitingAssetReview: awaitingAssetReview.length,
    awaitingAssetReviewBoardIds: awaitingAssetReview.flatMap((artifact) => {
      const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
      return board ? [board.id] : [];
    }),
    missingAssetReference: missingAssetReference.length,
    missingAssetReferenceBoards: missingAssetReference.flatMap((artifact) => {
      const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
      return board ? [{
        boardId: board.id,
        assetKeys: referenceReadiness(artifact).missingWithoutCandidate
          .map((item) => `${item.assetId}:${item.variantId || ""}`),
      }] : [];
    }),
    exhausted: exhausted.map((artifact) => {
      const board = (artifact.data as { storyboardBoard: StoryboardBoard }).storyboardBoard;
      return { sourceId: board.id, name: board.id, attempts: attemptsBySourceId[board.id].attempts };
    }),
    concurrency: options.concurrency,
    maxAttempts: options.maxAttempts,
    attemptsBySourceId,
  });
  const outcome = await runInBatches({
    items: pending,
    concurrency: options.concurrency,
    worker: async (artifact) => {
      const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard!;
      attemptsBySourceId[board.id] = {
        ...attemptsBySourceId[board.id],
        attempts: attemptsBySourceId[board.id].attempts + 1,
        lastAttemptAt: Date.now(),
        lastError: undefined,
      };
      const unit = unitByBoardId.get(board.id);
      const packEntry = unit?.assetReferencePackId ? packById.get(unit.assetReferencePackId) : undefined;
      const pack = packEntry?.pack;
      const packItems = selectStoryboardReferenceItems(board, pack?.items);
      const missingRequired = packItems.filter((item) => item.required && !item.referenceImageUrl);
      if (missingRequired.length) throw new Error(`Missing ${missingRequired.length} required asset reference boards.`);
      const scene = sceneById(project, board.sceneId);
      if (!scene) throw new Error(`Scene not found: ${board.sceneId}`);
      const prompt = buildStoryboardBoardMediaPrompt({
        projectTitle: project.title,
        sceneTitle: scene.title,
        board,
        assetNames: packItems.map((item) => readableAssetName(item.assetId)),
        assetLabels: packItems.map((item) => ({
          assetId: item.assetId,
          assetType: item.assetType,
          name: readableAssetName(item.assetId),
        })),
      });
      const controlTemplate = `data:image/svg+xml;base64,${Buffer.from(buildMediaStoryboardControlTemplateSvg(board)).toString("base64")}`;
      const shots = (scene.shots || []).filter((shot) => board.shotIds.includes(shot.id));
      const projectionContext = resolveImageVisualStyleProjectionContext({ project, shots });
      const visualStyleProjection = buildImageVisualStyleProjection({
        project,
        intent: "storyboard_control",
        ...projectionContext,
      });
      const image = await generateImage({
        baseUrl: options.baseUrl,
        projectId: project.id,
        promptCore: prompt,
        provider,
        references: [
          createImageGenerationReference({ imageUrl: controlTemplate, label: "故事板宫格与镜号控制模板", role: "composition_anchor" }),
          ...packItems.filter((item) => item.referenceImageUrl).map((item) => createImageGenerationReference({
            imageUrl: item.referenceImageUrl!,
            label: readableAssetName(item.assetId),
            role: item.assetType === "character" ? "character_identity" : item.assetType === "location" ? "location_design" : "prop_design",
          })),
        ],
        visualStyleProjection,
        visualRecipeInputEvidence: buildShotImageVisualRecipeInputEvidence({ project, shots }),
      });
      const overlaid = await overlayStoryboardLabels({
        baseUrl: options.baseUrl,
        projectId: project.id,
        image,
        board,
        projectTitle: project.title,
        sceneTitle: scene.title,
      });
      return {
        item: artifact,
        status: "generated" as const,
        image: { ...image, mediaUrl: overlaid.mediaUrl },
        prompt,
        warningCodes: overlaid.warnings,
      };
    },
    onBatch: async (batchResults) => {
      for (const result of batchResults) {
        const board = (result.item.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard!;
        if (result.status !== "generated" || !result.image || !result.prompt) {
          attemptsBySourceId[board.id] = {
            ...attemptsBySourceId[board.id],
            lastError: result.error || "unknown",
          };
          appendRunEvent(run, {
            type: "qa_failed",
            message: `复合故事板生成失败：${board.id}；${result.error || "unknown"}`,
            entityIds: [board.id, board.sceneId],
            data: { sourceId: board.id, promptHash: attemptsBySourceId[board.id].promptHash, attempt: attemptsBySourceId[board.id].attempts },
          });
          continue;
        }
        attemptsBySourceId[board.id] = {
          ...attemptsBySourceId[board.id],
          lastError: undefined,
        };
        const candidateId = stableId(
          "storyboard_board_candidate",
          `${project.id}:${board.id}:${result.image.mediaUrl}`,
        );
        const sourceUnit = unitByBoardId.get(board.id);
        const sourcePack = sourceUnit?.assetReferencePackId
          ? packById.get(sourceUnit.assetReferencePackId)?.pack
          : undefined;
        const sourceReferenceItems = selectStoryboardReferenceItems(board, sourcePack?.items);
        registerGeneratedAsset({
          run,
          sourceArtifactId: result.item.id,
          sourceId: board.id,
          phase: "storyboards",
          prompt: result.prompt,
          image: result.image,
          provider,
          candidateId,
          sourceContentHash: buildStoryboardMediaCandidateSourceHash({
            project,
            board,
            referenceItems: sourceReferenceItems,
          }),
          warningCodes: result.warningCodes,
          targetEntity: { type: "scene", id: board.sceneId, episodeId: board.episodeId, sceneId: board.sceneId, field: "pendingStoryboardBoardImageCandidate" },
        });
        awaitingStoryboardReview += 1;
        appendRunEvent(run, {
          type: "user_decision_required",
          message: `复合故事板候选已生成并持久化，等待用户采用：${board.id}`,
          entityIds: [board.id, board.sceneId],
          data: { candidateId, mediaUrl: result.image.mediaUrl, warningCodes: result.warningCodes || [] },
        });
      }
      saveManifest(run, "storyboards", {
        status: "running",
        total: boardArtifacts.length,
        completed,
        pending: Math.max(0, boardArtifacts.length - completed - awaitingStoryboardReview - awaitingAssetReview.length - missingAssetReference.length),
        awaitingReview: awaitingStoryboardReview,
        awaitingAssetReview: awaitingAssetReview.length,
        missingAssetReference: missingAssetReference.length,
        concurrency: options.concurrency,
        maxAttempts: options.maxAttempts,
        attemptsBySourceId,
        failures: summarizeFailedWork(batchResults, (artifact) => {
          const board = (artifact.data as { storyboardBoard: StoryboardBoard }).storyboardBoard;
          return { sourceId: board.id, name: board.id };
        }, attemptsBySourceId),
      });
      console.log(`[media:storyboards] completed=${completed}/${boardArtifacts.length} batchGenerated=${batchResults.filter((result) => result.status === "generated").length} batchFailed=${batchResults.filter((result) => result.status === "failed").length}`);
    },
  });
  const exhaustedAfterRun = boardArtifacts.flatMap((artifact) => {
    const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
    if (
      !board
      || completedIds.has(board.id)
      || pendingReviewIds.has(board.id)
      || referenceReadiness(artifact).status !== "ready"
    ) return [];
    if (outcome.results.some((result) => {
      const generatedBoard = (result.item.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
      return generatedBoard?.id === board.id && result.status === "generated";
    })) return [];
    return attemptsBySourceId[board.id].attempts >= options.maxAttempts ? [board] : [];
  });
  const failures = summarizeFailedWork(outcome.results, (artifact) => {
    const board = (artifact.data as { storyboardBoard: StoryboardBoard }).storyboardBoard;
    return { sourceId: board.id, name: board.id };
  }, attemptsBySourceId);
  saveManifest(run, "storyboards", {
    status: outcome.stoppedReason || exhaustedAfterRun.length
      ? "blocked"
      : missingAssetReference.length
        ? "missing_asset_reference"
        : awaitingAssetReview.length
          ? "awaiting_asset_review"
          : awaitingStoryboardReview
            ? "awaiting_review"
            : completed >= boardArtifacts.length
              ? "completed"
              : "partial",
    total: boardArtifacts.length,
    completed,
    generatedThisRun: outcome.results.filter((result) => result.status === "generated").length,
    failedThisRun: outcome.results.filter((result) => result.status === "failed").length,
    nearDuplicateWarningCount: outcome.results.reduce((sum, result) => sum + (result.warningCodes?.length || 0), 0),
    stoppedReason: outcome.stoppedReason,
    maxAttempts: options.maxAttempts,
    attemptsBySourceId,
    failures,
    awaitingReview: awaitingStoryboardReview,
    awaitingAssetReview: awaitingAssetReview.length,
    awaitingAssetReviewBoardIds: awaitingAssetReview.flatMap((artifact) => {
      const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
      return board ? [board.id] : [];
    }),
    missingAssetReference: missingAssetReference.length,
    missingAssetReferenceBoards: missingAssetReference.flatMap((artifact) => {
      const board = (artifact.data as { storyboardBoard?: StoryboardBoard }).storyboardBoard;
      return board ? [{
        boardId: board.id,
        assetKeys: referenceReadiness(artifact).missingWithoutCandidate
          .map((item) => `${item.assetId}:${item.variantId || ""}`),
      }] : [];
    }),
    exhausted: exhaustedAfterRun.map((board) => ({ sourceId: board.id, name: board.id, attempts: attemptsBySourceId[board.id].attempts })),
  });
  return {
    total: boardArtifacts.length,
    completed,
    outcome,
    awaitingReview: awaitingStoryboardReview,
    awaitingRequiredAssetReview: awaitingAssetReview.length,
    missingRequiredAssetReferences: missingAssetReference.length,
  };
};

const summarizeStatus = (projectId: string) => {
  const assets = dbHelpers.listOperatorAssets({ projectId });
  const mediaAssets = assets.filter((asset) => asset.metadata?.workerContract === MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION);
  const counts = mediaAssets.reduce<Record<string, number>>((accumulator, asset) => {
    const phase = clean(asset.metadata?.phase) || "unknown";
    accumulator[phase] = (accumulator[phase] || 0) + 1;
    return accumulator;
  }, {});
  return { projectId, counts, total: mediaAssets.length, assets: mediaAssets };
};

const main = async () => {
  const options = parseOptions();
  const project = dbHelpers.getProjectById(options.projectId) as Project | null;
  if (!project) throw new Error(`Project not found: ${options.projectId}`);
  if (options.phase === "status") {
    const status = summarizeStatus(project.id);
    console.log(JSON.stringify({ projectId: status.projectId, counts: status.counts, total: status.total }, null, 2));
    return;
  }
  await ensureRuntimeReady(options.baseUrl);
  const provider = resolveImageProviderConfig();
  const run = createOrResumeRun(project);
  appendRunEvent(run, {
    type: "plan_created",
    message: `媒体生产批次启动：phase=${options.phase}，limit=${Number.isFinite(options.limit) ? options.limit : "all"}，concurrency=${options.concurrency}，maxAttempts=${options.maxAttempts}。`,
    entityIds: [project.id],
    data: {
      circuitBreakerFailures: MEDIA_PRODUCTION_CIRCUIT_BREAKER_FAILURES,
      maxAttemptsPerItem: options.maxAttempts,
      automaticCreativeRetries: 0,
    },
  });
  const result: Record<string, unknown> = {};
  let awaitingRequiredAssetReview = 0;
  let missingRequiredAssetReferences = 0;
  if (options.phase === "assets" || options.phase === "all") {
    const assetResult = await produceAssetBoards({ options, project: dbHelpers.getProjectById(project.id) as Project, run, provider });
    result.assets = assetResult;
    awaitingRequiredAssetReview = assetResult.awaitingRequiredReview;
  }
  if (options.phase === "storyboards" || options.phase === "contracts" || options.phase === "all") {
    const storyboardResult = await produceStoryboardBoards({ options, project: dbHelpers.getProjectById(project.id) as Project, run, provider });
    result.storyboards = storyboardResult;
    awaitingRequiredAssetReview = Math.max(
      awaitingRequiredAssetReview,
      "awaitingRequiredAssetReview" in storyboardResult ? Number(storyboardResult.awaitingRequiredAssetReview || 0) : 0,
    );
    missingRequiredAssetReferences = "missingRequiredAssetReferences" in storyboardResult
      ? Number(storyboardResult.missingRequiredAssetReferences || 0)
      : 0;
  }
  const status = summarizeStatus(project.id);
  const resultSummary = Object.fromEntries(Object.entries(result).map(([phase, value]: [string, any]) => [phase, {
    total: value?.total || 0,
    completed: value?.completed || 0,
    generatedThisRun: value?.outcome?.results?.filter((item: WorkResult<unknown>) => item.status === "generated").length || 0,
    failedThisRun: value?.outcome?.results?.filter((item: WorkResult<unknown>) => item.status === "failed").length || 0,
    stoppedReason: value?.outcome?.stoppedReason,
    awaitingReview: value?.awaitingReview || value?.awaitingRequiredAssetReview || 0,
  }]));
  const failed = Object.values(resultSummary).some((value) => value.failedThisRun > 0 || Boolean(value.stoppedReason));
  const contractOnly = options.phase === "contracts";
  const awaitingReview = Object.values(resultSummary).reduce((sum, value) => sum + Number(value.awaitingReview || 0), 0);
  dbHelpers.patchOperatorRun(run.id, {
    status: failed ? "needs_human_review" : "needs_human_review",
    qaSummary: {
      passed: 0,
      warnings: status.total,
      failed: failed ? 1 : 0,
      blocked: failed ? 1 : 0,
    },
    outputs: status.assets.map((asset) => ({ kind: asset.kind, targetPath: clean(asset.metadata?.phase), entityIds: [clean(asset.metadata?.sourceId)], mediaPath: asset.mediaUrl })),
  });
  appendRunEvent(run, {
    type: failed
      ? "blocked"
      : contractOnly
        ? "artifact_refreshed"
        : awaitingReview || missingRequiredAssetReferences
          ? "user_decision_required"
          : "completed",
    message: failed
      ? "媒体批次触发熔断，已停止自动调用。"
      : missingRequiredAssetReferences
        ? `已继续处理无关故事板；另有 ${missingRequiredAssetReferences} 张故事板缺少必需资产参考，请补齐后复核。`
      : awaitingRequiredAssetReview
        ? "必需资产板候选已生成并等待用户采用；依赖这些资产的故事板阶段尚未启动。"
        : awaitingReview
          ? "媒体候选已生成并持久化，等待用户逐项预览和明确采用。"
        : contractOnly
        ? "复合故事板合同、部门交接和 prompt hash 已刷新；本次未调用图片模型。"
      : "当前媒体批次已完成；因多模态视觉质检渠道不可用，结果保留人工验收状态，不伪装为自动通过。",
    entityIds: [project.id],
    data: resultSummary,
  });
  console.log(JSON.stringify({
    status: failed
      ? "blocked"
      : missingRequiredAssetReferences
        ? "missing_asset_reference"
        : awaitingReview
          ? "awaiting_review"
          : contractOnly
            ? "contracts_ready"
            : "completed",
    projectId: project.id,
    runId: run.id,
    result: resultSummary,
    totals: status.counts,
  }, null, 2));
};

await main();
