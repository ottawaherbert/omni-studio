import type { NodeContentBinding } from '../types/schema.ts';

export type BindingSourceReviewReason = NonNullable<NodeContentBinding['sourceReview']>['reasons'][number];

const MEDIA_ONLY_REASONS = new Set<BindingSourceReviewReason>([
  'binding_source_updated',
  'visual_projection_updated',
]);

const reviewTimestampIsCurrent = (reviewedAt: string | undefined, detectedAt: string) => {
  if (!reviewedAt) return false;
  const reviewTime = Date.parse(reviewedAt);
  const detectedTime = Date.parse(detectedAt);
  return Number.isFinite(reviewTime) && Number.isFinite(detectedTime) && reviewTime >= detectedTime;
};

export const bindingNeedsContentReview = (binding: NodeContentBinding) => {
  const sourceReview = binding.sourceReview;
  if (!sourceReview || sourceReview.status !== 'review_recommended') return false;
  if (sourceReview.reasons.every((reason) => MEDIA_ONLY_REASONS.has(reason))) return false;
  return !reviewTimestampIsCurrent(
    binding.contentFitReview?.reviewedAt,
    sourceReview.contentDetectedAt || sourceReview.detectedAt,
  );
};

export const bindingNeedsMediaReview = (binding: NodeContentBinding) => {
  const sourceReview = binding.sourceReview;
  if (!sourceReview || sourceReview.status !== 'review_recommended') return false;
  const hasMedia = Boolean(binding.mediaTakeRefs?.length || binding.mediaTakeRef);
  return hasMedia && !reviewTimestampIsCurrent(
    binding.mediaFitReview?.reviewedAt,
    sourceReview.mediaDetectedAt || sourceReview.detectedAt,
  );
};

const eventTimestamp = (
  requestedAt: string,
  previousAt: string | undefined,
  reviewedAt: string | undefined,
) => {
  const requestedTime = Date.parse(requestedAt);
  const previousTime = Date.parse(previousAt || '');
  if (
    Number.isFinite(requestedTime)
    && Number.isFinite(previousTime)
    && requestedTime <= previousTime
  ) return previousAt!;
  const reviewTime = Date.parse(reviewedAt || '');
  return new Date(Math.max(
    Number.isFinite(requestedTime) ? requestedTime : Date.now(),
    Number.isFinite(previousTime) ? previousTime : 0,
    Number.isFinite(reviewTime) ? reviewTime + 1 : 0,
  )).toISOString();
};

export const recommendBindingSourceReview = (
  binding: NodeContentBinding,
  reasons: BindingSourceReviewReason[],
  detectedAt: string,
): NodeContentBinding => {
  const previousReview = binding.sourceReview?.status === 'review_recommended'
    ? binding.sourceReview
    : undefined;
  const previousHasContentReason = previousReview?.reasons.some((reason) => !MEDIA_ONLY_REASONS.has(reason));
  const nextHasContentReason = reasons.some((reason) => !MEDIA_ONLY_REASONS.has(reason));
  const contentDetectedAt = nextHasContentReason
    ? eventTimestamp(
        detectedAt,
        previousHasContentReason
          ? previousReview?.contentDetectedAt || previousReview?.detectedAt
          : undefined,
        binding.contentFitReview?.reviewedAt,
      )
    : previousHasContentReason
      ? previousReview?.contentDetectedAt || previousReview?.detectedAt
      : undefined;
  const mediaDetectedAt = reasons.length > 0
    ? eventTimestamp(
        detectedAt,
        previousReview?.mediaDetectedAt || previousReview?.detectedAt,
        binding.mediaFitReview?.reviewedAt,
      )
    : previousReview?.mediaDetectedAt || previousReview?.detectedAt;
  const effectiveDetectedAt = [contentDetectedAt, mediaDetectedAt]
    .map((value) => Date.parse(value || ''))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), Date.parse(detectedAt));
  return {
    ...binding,
    sourceReview: {
      status: 'review_recommended',
      reasons: [...new Set([
        ...(previousReview?.reasons || []),
        ...reasons,
      ])],
      contentDetectedAt,
      mediaDetectedAt,
      detectedAt: new Date(Number.isFinite(effectiveDetectedAt) ? effectiveDetectedAt : Date.now()).toISOString(),
    },
  };
};

export const reconcileBindingSourceReview = (binding: NodeContentBinding): NodeContentBinding => {
  if (binding.sourceReview?.status !== 'review_recommended') return binding;
  if (bindingNeedsContentReview(binding) || bindingNeedsMediaReview(binding)) return binding;
  return {
    ...binding,
    sourceReview: {
      status: 'current',
      reasons: [],
      detectedAt: binding.sourceReview.detectedAt,
    },
  };
};
