import assert from 'node:assert/strict';

import {
  createProposalAdoptionRun,
  finishProposalAdoptionRun,
  pendingProposalAdoptions,
  recordProposalAdoptionResult,
} from '../src/domains/interactive/authoring/proposalBundle.ts';

const refs = [
  { kind: 'media_plan' as const, candidateId: 'media-1' },
  { kind: 'interactive_graph' as const, candidateId: 'graph-1' },
  { kind: 'production_plan' as const, candidateId: 'production-1' },
  { kind: 'content_plan' as const, candidateId: 'content-1' },
];
let run = createProposalAdoptionRun('adopt-compatible-1', refs);
assert.deepEqual(
  run.candidateRefs.map((ref) => ref.kind),
  ['interactive_graph', 'content_plan', 'production_plan', 'media_plan'],
  'Compatible proposals must always be attempted in dependency order',
);
run = recordProposalAdoptionResult(run, {
  kind: 'interactive_graph',
  candidateId: 'graph-1',
  status: 'adopted',
  message: 'ok',
});
run = recordProposalAdoptionResult(run, {
  kind: 'content_plan',
  candidateId: 'content-1',
  status: 'failed',
  message: 'stale',
});
run = finishProposalAdoptionRun(run);
assert.equal(run.status, 'partial');
assert.deepEqual(
  pendingProposalAdoptions(run).map((ref) => ref.candidateId),
  ['content-1', 'production-1', 'media-1'],
  'Retry must preserve adopted items and resume failed or unfinished items only',
);
run = recordProposalAdoptionResult(run, {
  kind: 'content_plan',
  candidateId: 'content-1',
  status: 'skipped',
  message: 'no longer compatible',
});
run = recordProposalAdoptionResult(run, {
  kind: 'production_plan',
  candidateId: 'production-1',
  status: 'adopted',
  message: 'ok',
});
run = recordProposalAdoptionResult(run, {
  kind: 'media_plan',
  candidateId: 'media-1',
  status: 'adopted',
  message: 'ok',
});
run = finishProposalAdoptionRun(run);
assert.equal(run.status, 'complete');
assert.deepEqual(pendingProposalAdoptions(run), [], 'A repeated completed request must have no work left');
console.log('Interactive proposal adoption self-check passed.');
