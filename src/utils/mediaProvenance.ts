import { isManualAIMedia } from "../../apps/web/src/clients/manualAIClient";
import {
  MediaAssetKind,
  MediaAssetReference,
  MediaAssetSource,
  MediaAssetStatus,
} from "../types/project";

const trustedReadySources = new Set<MediaAssetSource>([
  "ai_generation",
  "upload",
  "asset_library",
]);

const randomId = () =>
  globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

export const createMediaAssetReference = ({
  url,
  kind,
  source,
  status = "ready",
  generationJobId,
  modelId,
  createdAt = Date.now(),
  errorMessage,
  note,
}: {
  url?: string;
  kind: MediaAssetKind;
  source: MediaAssetSource;
  status?: MediaAssetStatus;
  generationJobId?: string;
  modelId?: string;
  createdAt?: number;
  errorMessage?: string;
  note?: string;
}): MediaAssetReference => ({
  url,
  kind,
  source,
  status,
  generationJobId,
  modelId,
  createdAt,
  updatedAt: createdAt,
  errorMessage,
  note,
});

export const createAIGeneratedMediaReference = (
  kind: MediaAssetKind,
  url: string,
  modelId?: string,
): MediaAssetReference =>
  createMediaAssetReference({
    url,
    kind,
    source: isManualAIMedia(url) ? "upload" : "ai_generation",
    status: "ready",
    generationJobId: isManualAIMedia(url) ? undefined : `generation-${Date.now()}-${randomId()}`,
    modelId: isManualAIMedia(url) ? undefined : modelId,
    note: isManualAIMedia(url) ? "作者上传的外部 AI 返回，未调用模型接口。" : undefined,
  });

export const createLegacyMediaReference = (
  kind: MediaAssetKind,
  url?: string,
): MediaAssetReference | undefined =>
  url
    ? createMediaAssetReference({
        url,
        kind,
        source: "legacy",
        status: "ready",
        note: "Backfilled from a legacy URL-only media reference.",
      })
    : undefined;

export const isTrustedReadyMediaReference = (
  ref: MediaAssetReference | undefined,
  kind?: MediaAssetKind,
) =>
  Boolean(
    ref?.url &&
      ref.status === "ready" &&
      trustedReadySources.has(ref.source) &&
      (ref.source !== "ai_generation" || Boolean(ref.generationJobId)) &&
      (!kind || ref.kind === kind),
  );
