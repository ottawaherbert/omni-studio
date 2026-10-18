import { hashValue, type AgentRun, type Observation, type PreparedCall } from '../../packages/agent-core/src';

// Transaction fixture only: this contains no model-generated content.
export function preparedFixture(run: AgentRun): PreparedCall {
  const input = { text: 'transaction fixture' };
  const base = {
    request: { capabilityId: 'checklist.save', capabilityVersion: '1', input, callId: 'call-1' },
    implementationDigest: hashValue('fixture'), contractDigest: hashValue('fixture-contract'), inputDigest: hashValue(input),
    binding: { ownerId: run.ownerId, scopeId: run.scopeId, commandRevision: String(run.generation), policyRevision: run.policyRevision },
    sources: [], targets: [],
  };
  return { ...base, preparedDigest: hashValue(base) };
}
export const observationFixture: Observation = { status: 'SUCCEEDED', summary: 'transaction fixture committed', data: { value: 1 }, evidence: [], artifacts: [], effectState: 'EFFECT_VERIFIED', retry: 'NEVER' };
