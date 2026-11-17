import type { NodeContentBinding } from '../types/schema.ts';
import { bindingMediaTakeRefs, bindingScriptSceneRefs } from './nodeContentBinding.ts';
import { bindingNeedsContentReview, bindingNeedsMediaReview } from './sourceReview.ts';

const MIN_RATIONALE_LENGTH = 8;

/**
 * Content fit is an explicit editorial decision, not a brittle automatic
 * similarity score. Upstream revisions keep the adopted binding intact and
 * require a newer explicit review through its source-review marker.
 */
export const hasCurrentContentFitReview = (binding: NodeContentBinding) => {
  const review = binding.contentFitReview;
  const sceneRefs = bindingScriptSceneRefs(binding);
  const reviewedChecksums = review?.sceneChecksums
    || (review?.scriptChecksum ? [review.scriptChecksum] : []);
  return binding.slot === 'main'
    && binding.status === 'approved'
    && sceneRefs.length > 0
    && review?.verdict === 'pass'
    && reviewedChecksums.length === sceneRefs.length
    && sceneRefs.every((ref, index) => reviewedChecksums[index] === ref.checksum)
    && review.rationale.trim().length >= MIN_RATIONALE_LENGTH
    && !bindingNeedsContentReview(binding);
};

/** Shared by formal build readiness and the player's preserved-build notice. */
export const hasCurrentMediaFitReview = (binding?: NodeContentBinding) => {
  if (!binding) return false;
  const refs = bindingMediaTakeRefs(binding);
  const reviewedChecksums = new Set(binding.mediaFitReview?.mediaChecksums || []);
  return refs.length > 0
    && reviewedChecksums.size === refs.length
    && refs.every((ref) => reviewedChecksums.has(ref.checksum))
    && !bindingNeedsMediaReview(binding);
};

export { MIN_RATIONALE_LENGTH };
