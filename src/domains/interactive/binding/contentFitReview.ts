import type { NodeContentBinding } from '../types/schema.ts';
import { bindingScriptSceneRefs } from './nodeContentBinding.ts';
import { bindingNeedsContentReview } from './sourceReview.ts';

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

export { MIN_RATIONALE_LENGTH };
