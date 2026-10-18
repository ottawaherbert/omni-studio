import type {
  Asset,
  Character,
  VisualImageAdoptionAudit,
  VisualImageCandidate,
  VisualStyleLock,
} from "../../types/project";
import type { CompiledImageGenerationRequest } from "./imageGenerationRequest";
import { manualStoryboardHash } from "./manualStoryboard";
import { createAIGeneratedMediaReference } from "../../utils/mediaProvenance";
import { normalizeLegacyVisualStyleLock } from "./visualStyleMigration";

export type VisualImageCandidateStyleSourceStatus = "current" | "review_recommended" | "unknown";

export interface VisualImageCandidateSourceOwner {
  id: string;
  name: string;
  type?: string;
  visualIdentity?: string;
  description?: string;
  prompt?: string;
  referenceImageUrl?: string;
  imageUrl?: string;
  imageUrls?: string[];
  boardPrompt?: string;
  boardImageUrl?: string;
  cleanReferencePrompt?: string;
  cleanReferenceImageUrl?: string;
  multiViewPrompt?: string;
  multiViewUrl?: string;
  defaultReferenceUrl?: string;
  visualOverride?: Asset["visualOverride"];
  tags?: string[];
  variants?: Asset["variants"];
  defaultVariantId?: string;
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const visualImageCandidateSourceContentHash = ({
  owner,
  kind,
  variantId,
  visualStyleLock,
}: {
  owner: VisualImageCandidateSourceOwner;
  kind: VisualImageCandidate["kind"];
  variantId?: string;
  visualStyleLock?: VisualStyleLock;
}) => {
  const variant = variantId
    ? owner.variants?.find((candidate) => candidate.id === variantId)
    : undefined;
  const inheritedVariant = variant?.referenceVariantId
    ? owner.variants?.find((candidate) => candidate.id === variant.referenceVariantId)
    : undefined;
  const style = visualStyleLock ? normalizeLegacyVisualStyleLock(visualStyleLock).lock : undefined;
  return manualStoryboardHash(stableStringify({
    schemaVersion: "visual-image-candidate-source.v1",
    kind,
    variantId,
    owner: {
      id: owner.id,
      name: owner.name,
      visualIdentity: "visualIdentity" in owner ? owner.visualIdentity : undefined,
      description: "description" in owner ? owner.description : undefined,
      type: "type" in owner ? owner.type : "character",
      prompt: "prompt" in owner ? owner.prompt : undefined,
      referenceImageUrl: "referenceImageUrl" in owner ? owner.referenceImageUrl : undefined,
      imageUrl: "imageUrl" in owner ? owner.imageUrl : undefined,
      imageUrls: "imageUrls" in owner ? owner.imageUrls : undefined,
      boardPrompt: owner.boardPrompt,
      boardImageUrl: owner.boardImageUrl,
      cleanReferencePrompt: owner.cleanReferencePrompt,
      cleanReferenceImageUrl: owner.cleanReferenceImageUrl,
      multiViewPrompt: owner.multiViewPrompt,
      multiViewUrl: owner.multiViewUrl,
      defaultReferenceUrl: owner.defaultReferenceUrl,
      defaultVariantId: owner.defaultVariantId,
      visualOverride: owner.visualOverride,
      tags: "tags" in owner ? owner.tags : undefined,
    },
    variant,
    inheritedVariant,
    visualStyleContentHash: style?.contentHash,
  }));
};

export const resolveVisualImageCandidateSourceStatus = (
  candidate: Pick<VisualImageCandidate, "kind" | "variantId" | "sourceContentHash" | "visualStyleCompileManifest">,
  owner: VisualImageCandidateSourceOwner,
  visualStyleLock: VisualStyleLock | undefined,
): VisualImageCandidateStyleSourceStatus => {
  if (!candidate.sourceContentHash) {
    // Legacy candidates only prove which style projection was used. They do not
    // prove that the owner identity, variant, or reference inputs are unchanged.
    return "review_recommended";
  }
  return candidate.sourceContentHash === visualImageCandidateSourceContentHash({
    owner,
    kind: candidate.kind,
    variantId: candidate.variantId,
    visualStyleLock,
  }) ? "current" : "review_recommended";
};

export const resolveVisualImageCandidateStyleSourceStatus = (
  candidate: Pick<VisualImageCandidate, "visualStyleCompileManifest">,
  visualStyleLock: VisualStyleLock | undefined,
): VisualImageCandidateStyleSourceStatus => {
  const candidateSourceHash = candidate.visualStyleCompileManifest?.sourceStyle.resolvedContentHash?.trim();
  if (!candidateSourceHash || !visualStyleLock) return "unknown";
  const currentSourceHash = normalizeLegacyVisualStyleLock(visualStyleLock).lock.contentHash?.trim();
  if (!currentSourceHash) return "unknown";
  return candidateSourceHash === currentSourceHash ? "current" : "review_recommended";
};

export const isProjectCharacterVisualOwner = (
  owner: Asset | Character,
): owner is Character => !("type" in owner);

export const createVisualImageCandidate = ({
  kind,
  variantId,
  imageUrl,
  prompt,
  modelId,
  compiledRequest,
  sourceContentHash,
  createdAt = Date.now(),
}: {
  kind: VisualImageCandidate["kind"];
  variantId?: string;
  imageUrl: string;
  prompt: string;
  modelId: string;
  compiledRequest?: CompiledImageGenerationRequest;
  sourceContentHash: string;
  createdAt?: number;
}): VisualImageCandidate => {
  if (!compiledRequest) {
    throw new Error("图片生成缺少编译审计，结果不能进入待采用候选。");
  }
  if (!/^[a-f0-9]{64}$/u.test(sourceContentHash)) {
    throw new Error("图片生成缺少有效来源指纹，结果不能进入待采用候选。");
  }
  return {
    id: `visual-image-candidate-${createdAt}-${crypto.randomUUID()}`,
    kind,
    ...(variantId ? { variantId } : {}),
    imageUrl,
    imageMedia: createAIGeneratedMediaReference("image", imageUrl, modelId),
    prompt,
    promptHash: manualStoryboardHash(prompt),
    modelId,
    imageReferenceManifest: compiledRequest.references.map((reference, index) => ({
      index: index + 1,
      imageUrl: reference.imageUrl,
      label: reference.label,
      role: reference.role,
      preserve: [...reference.preserve],
      allowChange: [...reference.allowChange],
      exclude: [...reference.exclude],
    })),
    promptCompositionManifest: structuredClone(compiledRequest.manifest),
    visualStyleCompileManifest: compiledRequest.visualStyleProjection?.compileManifest
      ? structuredClone(compiledRequest.visualStyleProjection.compileManifest)
      : undefined,
    sourceContentHash,
    createdAt,
  };
};

const adoptionSlot = (
  candidate: Pick<VisualImageCandidate, "kind" | "variantId">,
): VisualImageAdoptionAudit["slot"] => candidate.kind === "variant"
  ? `variant:${candidate.variantId || "missing"}`
  : candidate.kind;

export const upsertVisualImageCandidate = (
  candidates: VisualImageCandidate[] | undefined,
  candidate: VisualImageCandidate,
) => [
  ...(candidates || []).filter((entry) => entry.id !== candidate.id),
  candidate,
].sort((left, right) => left.createdAt - right.createdAt);

type VisualImageCandidateOwner = {
  visualImageCandidates?: VisualImageCandidate[];
  visualImageAdoptionAudits?: VisualImageAdoptionAudit[];
};

const prepareVisualImageAdoption = (
  owner: VisualImageCandidateOwner,
  candidateId: string,
  adoptedAt: number,
  sourceReview?: VisualImageAdoptionAudit["sourceReview"],
) => {
  const candidate = owner.visualImageCandidates?.find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error("图片候选已不存在，请刷新后重试。");
  const remaining = (owner.visualImageCandidates || []).filter((entry) => entry.id !== candidateId);
  const adoptionAudit: VisualImageAdoptionAudit = {
    ...structuredClone(candidate),
    slot: adoptionSlot(candidate),
    sourceReview,
    adoptedAt,
  };
  return {
    candidate,
    remaining,
    visualImageAdoptionAudits: [
      ...(owner.visualImageAdoptionAudits || []),
      adoptionAudit,
    ],
  };
};

const visualImageCandidateSourceReview = (
  candidate: Pick<VisualImageCandidate, "sourceContentHash">,
  status: VisualImageCandidateStyleSourceStatus,
  detectedAt: number,
): NonNullable<VisualImageAdoptionAudit["sourceReview"]> => ({
  status: status === "current" ? "current" : "review_recommended",
  reasons: status === "current"
    ? []
    : [candidate.sourceContentHash ? "source_updated" : "source_fingerprint_missing"],
  detectedAt,
});

export const rejectVisualImageCandidate = <Owner extends VisualImageCandidateOwner>(
  owner: Owner,
  candidateId: string,
): Owner => ({
  ...owner,
  visualImageCandidates: (owner.visualImageCandidates || []).filter((candidate) => candidate.id !== candidateId),
});

export const adoptVisualImageCandidate = <Owner extends Character | Asset>(
  owner: Owner,
  candidateId: string,
  adoptedAt = Date.now(),
  visualStyleLock?: VisualStyleLock,
): Owner => {
  const pending = owner.visualImageCandidates?.find((entry) => entry.id === candidateId);
  const status = pending
    ? resolveVisualImageCandidateSourceStatus(pending, owner, visualStyleLock)
    : "unknown";
  const { candidate, remaining, visualImageAdoptionAudits } = prepareVisualImageAdoption(
    owner,
    candidateId,
    adoptedAt,
    pending ? visualImageCandidateSourceReview(pending, status, adoptedAt) : undefined,
  );
  if (candidate.kind === "variant") {
    if (!candidate.variantId) throw new Error("变体图片候选缺少目标变体，不能采用。");
    const variants = (owner.variants || []).map((variant) => variant.id === candidate.variantId
      ? { ...variant, imageUrl: candidate.imageUrl }
      : variant);
    if (!variants.some((variant) => variant.id === candidate.variantId)) {
      throw new Error("目标变体已不存在，不能采用该候选。");
    }
    return { ...owner, variants, visualImageCandidates: remaining, visualImageAdoptionAudits };
  }
  if (candidate.kind === "multiview") {
    return { ...owner, multiViewUrl: candidate.imageUrl, visualImageCandidates: remaining, visualImageAdoptionAudits };
  }
  return {
    ...owner,
    ...(isProjectCharacterVisualOwner(owner)
      ? { referenceImageUrl: candidate.imageUrl }
      : { imageUrl: candidate.imageUrl }),
    ...(!owner.defaultReferenceUrl ? { defaultReferenceUrl: candidate.imageUrl } : {}),
    visualImageCandidates: remaining,
    visualImageAdoptionAudits,
  };
};

export const adoptGlobalVisualImageCandidate = <Owner extends VisualImageCandidateOwner & { imageUrls: string[] }>(
  owner: Owner,
  candidateId: string,
  adoptedAt = Date.now(),
  visualStyleLock?: VisualStyleLock,
): Owner => {
  const pending = owner.visualImageCandidates?.find((entry) => entry.id === candidateId);
  const status = pending
    ? resolveVisualImageCandidateSourceStatus(pending, owner as Owner & VisualImageCandidateSourceOwner, visualStyleLock)
    : "unknown";
  const { candidate, remaining, visualImageAdoptionAudits } = prepareVisualImageAdoption(
    owner,
    candidateId,
    adoptedAt,
    pending ? visualImageCandidateSourceReview(pending, status, adoptedAt) : undefined,
  );
  if (candidate.kind !== "base") {
    throw new Error("全局资产当前只支持采用基础形象候选。");
  }
  return {
    ...owner,
    imageUrls: [candidate.imageUrl, ...owner.imageUrls.filter((url) => url !== candidate.imageUrl)],
    visualImageCandidates: remaining,
    visualImageAdoptionAudits,
  };
};
