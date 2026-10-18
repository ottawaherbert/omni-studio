/**
 * Interactive Graph Draft Adoption & QA Engine
 * Current architecture and boundaries: doc/design.md.
 */

import { NarrativeGraphVersion, StateSchema, DurationBudget, normalizeNarrativeGraph } from '../types/schema';
import { auditNarrativeGraph, GraphQAResult } from '../qa/graphQAEngine';
import { InteractiveGraphDraft, GraphDraftQA } from './graphDraft';
import { applyGraphPatch } from './graphDraftPatch';
import { canAdoptDraft } from './graphDraftValidation';

export interface DraftAuditResult {
  candidateGraph: NarrativeGraphVersion;
  qaResult: GraphQAResult;
  draftQA: GraphDraftQA;
}

export function auditDraftCandidateGraph(
  baseGraph: NarrativeGraphVersion,
  draft: InteractiveGraphDraft,
  stateSchema?: StateSchema,
  durationBudget?: DurationBudget
): DraftAuditResult {
  const candidateGraph = applyGraphPatch(baseGraph, draft.operations);
  const qaResult = auditNarrativeGraph(candidateGraph, stateSchema, durationBudget);

  const blocking = qaResult.issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = qaResult.issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  const coverageIncomplete = Boolean(qaResult.durationAudit?.truncated);

  const draftQA: GraphDraftQA = {
    blocking,
    warnings,
    coverageIncomplete,
    checkerId: 'graph-qa-engine-v1',
    issueFingerprints: qaResult.issues.map((i) => `${i.category}:${i.id}`),
  };

  return {
    candidateGraph,
    qaResult,
    draftQA,
  };
}

export function adoptGraphDraft(
  currentGraph: NarrativeGraphVersion,
  draft: InteractiveGraphDraft
): { success: boolean; newGraph?: NarrativeGraphVersion; reason?: string } {
  const check = canAdoptDraft(draft, currentGraph);
  if (!check.canAdopt) {
    return { success: false, reason: check.reason };
  }

  const candidateGraph = applyGraphPatch(currentGraph, draft.operations);
  const newGraphIndex = currentGraph.versionIndex + 1;
  const newGraphId = `graph-${draft.experienceId}-v${newGraphIndex}`;

  const newGraph: NarrativeGraphVersion = {
    ...candidateGraph,
    id: newGraphId,
    experienceId: draft.experienceId,
    versionIndex: newGraphIndex,
    status: 'approved',
    updatedAt: new Date().toISOString(),
  };

  draft.status = 'adopted';
  return { success: true, newGraph };
}

export function rejectGraphDraft(draft: InteractiveGraphDraft): InteractiveGraphDraft {
  return {
    ...draft,
    status: 'rejected',
  };
}
