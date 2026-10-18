import type {
  InteractiveProposalAdoptionResult,
  InteractiveProposalAdoptionRun,
  InteractiveProposalKind,
} from './taskCoordination';

export const proposalAdoptionOrder: InteractiveProposalKind[] = [
  'interactive_graph',
  'content_plan',
  'production_plan',
  'media_plan',
];

export const createProposalAdoptionRun = (
  idempotencyKey: string,
  candidateRefs: InteractiveProposalAdoptionRun['candidateRefs'],
): InteractiveProposalAdoptionRun => ({
  idempotencyKey,
  candidateRefs: [...candidateRefs].sort(
    (left, right) => proposalAdoptionOrder.indexOf(left.kind) - proposalAdoptionOrder.indexOf(right.kind),
  ),
  results: [],
  status: 'working',
  updatedAt: new Date().toISOString(),
});

export const pendingProposalAdoptions = (run: InteractiveProposalAdoptionRun) =>
  run.candidateRefs.filter((ref) => !run.results.some((result) => (
    result.kind === ref.kind
    && result.candidateId === ref.candidateId
    && result.status !== 'failed'
  )));

export const recordProposalAdoptionResult = (
  run: InteractiveProposalAdoptionRun,
  result: InteractiveProposalAdoptionResult,
): InteractiveProposalAdoptionRun => {
  const results = [
    ...run.results.filter((item) => item.kind !== result.kind || item.candidateId !== result.candidateId),
    result,
  ].sort((left, right) => (
    run.candidateRefs.findIndex((ref) => ref.kind === left.kind && ref.candidateId === left.candidateId)
    - run.candidateRefs.findIndex((ref) => ref.kind === right.kind && ref.candidateId === right.candidateId)
  ));
  return {
    ...run,
    results,
    status: 'working',
    updatedAt: new Date().toISOString(),
  };
};

export const finishProposalAdoptionRun = (
  run: InteractiveProposalAdoptionRun,
): InteractiveProposalAdoptionRun => ({
  ...run,
  status: run.results.some((item) => item.status === 'failed') ? 'partial' : 'complete',
  updatedAt: new Date().toISOString(),
});
