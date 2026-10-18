/**
 * Interactive Graph Draft Validation & CAS Engine
 * Current architecture and boundaries: doc/design.md.
 */

import { NarrativeGraphVersion } from '../types/schema';
import { InteractiveGraphDraft } from './graphDraft';

export interface CasValidationResult {
  valid: boolean;
  reason?: 'BASE_GRAPH_VERSION_MISMATCH' | 'DRAFT_STALE' | 'INVALID_STATUS';
}

export function validateDraftCas(
  draft: InteractiveGraphDraft,
  currentGraph: NarrativeGraphVersion
): CasValidationResult {
  if (draft.status === 'stale') {
    return { valid: false, reason: 'DRAFT_STALE' };
  }

  if (
    draft.baseGraphVersionId !== currentGraph.id ||
    draft.baseGraphVersionIndex !== currentGraph.versionIndex
  ) {
    return { valid: false, reason: 'BASE_GRAPH_VERSION_MISMATCH' };
  }

  return { valid: true };
}

export function canAdoptDraft(
  draft: InteractiveGraphDraft,
  currentGraph: NarrativeGraphVersion
): { canAdopt: boolean; reason?: string } {
  if (draft.status !== 'candidate') {
    return { canAdopt: false, reason: `Draft is in ${draft.status} status` };
  }

  const cas = validateDraftCas(draft, currentGraph);
  if (!cas.valid) {
    return { canAdopt: false, reason: cas.reason };
  }

  if (draft.qa.blocking && draft.qa.blocking.length > 0) {
    return {
      canAdopt: false,
      reason: `Draft has ${draft.qa.blocking.length} blocking QA issue(s): ${draft.qa.blocking.join(', ')}`,
    };
  }

  return { canAdopt: true };
}
