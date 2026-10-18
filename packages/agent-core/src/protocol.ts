export type Effect = 'READ' | 'PROPOSE' | 'WRITE' | 'PUBLISH' | 'DELETE' | 'EXTERNAL_EFFECT';
export type ResourceRef = { uri: string; version: string; contentHash: string; branch: string };
export type ExecutionToken = { runId: string; workerId: string; fence: number; generation: number; inputRevision: number; stepId?: string; leaseKind?: 'step' };
export type AccessContext = {
  ownerId: string;
  scopeId: string;
  commandRevision: string;
  policyRevision: string;
  execution: ExecutionToken;
  signal: AbortSignal;
};
export interface RuntimeSchema<T = unknown> {
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T;
}
export type CapabilitySpec = {
  id: string;
  version: string;
  implementationDigest: string;
  description: string;
  effect: Effect;
  cost: 'NONE' | 'MODEL' | 'EXTERNAL';
  dispatch: 'INLINE' | 'DURABLE';
  replay: 'TRANSACTIONAL' | 'IDEMPOTENT' | 'RECONCILE_REQUIRED';
  input: RuntimeSchema;
  output: RuntimeSchema;
};
export type CapabilityRequest = { capabilityId: string; capabilityVersion: string; input: unknown; callId: string };
export type PreparedCall = {
  request: CapabilityRequest;
  implementationDigest: string;
  contractDigest: string;
  inputDigest: string;
  binding: { ownerId: string; scopeId: string; commandRevision: string; policyRevision: string };
  sources: ResourceRef[];
  targets: ResourceRef[];
  preparedDigest: string;
};
export type Observation = {
  status: 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'CAPABILITY_GAP';
  summary: string;
  data: unknown;
  evidence: ResourceRef[];
  artifacts: ResourceRef[];
  effectState: 'NO_EFFECT' | 'CANDIDATE_PRESERVED' | 'EFFECT_VERIFIED' | 'EFFECT_UNKNOWN';
  retry: 'NEVER' | 'SAME_INPUT' | 'REPLAN' | 'RECONCILE';
};
export interface Capability {
  spec: CapabilitySpec;
  prepare?(input: unknown, context: AccessContext): Promise<{ input: unknown; sources: ResourceRef[]; targets: ResourceRef[] }>;
  execute(call: PreparedCall, context: AccessContext): Promise<Observation>;
}
// The host must enforce actual resource authorization and execution fencing.
// Metadata is not an authorization implementation.
export interface ExecutionPolicy {
  assertExecution(context: AccessContext): Promise<void>;
  authorize(spec: CapabilitySpec, call: PreparedCall, context: AccessContext, phase: 'PREPARE' | 'EXECUTE' | 'REPLAY'): Promise<void>;
}
export type ResourceQuery = { query?: string; cursor?: string; limit?: number };
export type ResourcePage = {
  items: Array<{ ref: ResourceRef; title: string }>;
  // Also required for empty query results, so additions invalidate old reads.
  collection: ResourceRef;
  nextCursor: string | null;
  truncated: boolean;
};
export type ResourceSnapshot = { ref: ResourceRef; data: unknown; truncated: boolean; nextCursor: string | null };
export interface ResourceProvider {
  namespace: string;
  list(query: ResourceQuery, context: AccessContext): Promise<ResourcePage>;
  search(query: ResourceQuery & { query: string }, context: AccessContext): Promise<ResourcePage>;
  open(ref: ResourceRef, options: { cursor?: string; limit?: number }, context: AccessContext): Promise<ResourceSnapshot>;
}
