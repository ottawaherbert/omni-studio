import type { AgentRun, AgentStep } from './execution';
import type { GoalRevision, PlanRevision, RunLink, Sampling } from './goals';
import type { Observation, ResourceRef } from './protocol';
import type { Invocation, ModelRequest } from './model';

/** Created and registered only under a current execution token. The ID/digest
 * locates a durable binding; these fields are not a bearer authorization. */
export type HistoryReaderDescriptor = {
  id: string; digest: string; runId: string; goalId: string; goalRevision: number;
  authorizationRef: string; workspaceRef: ResourceRef;
};
export type HistoryPrincipal = { run: AgentRun; link: RunLink; revision: GoalRevision };
export type HistoryPolicyContext = { reader: HistoryPrincipal; origin: HistoryPrincipal };
export interface HistoryReadPolicy {
  /** Host-owned synchronous read snapshot, shared by nested provenance checks. */
  withValidationBatch?<T>(read:()=>T):T;
  /** Effective authorization intersection for memoizing successful synchronous
   * history reads. Omit when the host cannot provide a stable reader identity. */
  validationKey?(): string;
  /** Current access and the semantic intersection of source/current grants.
   * Historical VIEW has no activeReader; CONSUME always supplies one. */
  authorizeReader(input: { reader: HistoryPrincipal; phase: 'VIEW' | 'CONSUME'; activeReader?: HistoryPrincipal; sourceAccess?: { ownerId: string; scopeId: string; branch: string } }): void;
  authorize(input: HistoryPolicyContext & ({ kind: 'PLAN'; plan: PlanRevision } | { kind: 'RECEIPT'; step: AgentStep })): void;
  assertSamplingView(input: HistoryPolicyContext & { sampling: Sampling }): void;
  /** Verify the tool's own frozen contexts and all output/evidence resources,
   * including manual commands with no parent model Sampling. */
  assertReceiptView(input: HistoryPolicyContext & { step: AgentStep; invocations: Array<{ id: string; status: Invocation['status']; request: ModelRequest; inputHash: string }> }): void;
}
export type PlanProjection = {
  id: string; goalRevision: number; summary: string; summaryTruncated: boolean;
  intentions: PlanRevision['intentions']; intentionsTruncated: boolean;
  meaning: 'PLAN_NOT_EXECUTION';
  planDigest: string; referencesTruncated: boolean;
};
export type ReceiptProjection = {
  stepId: string; callId: string; capabilityId: string; capabilityVersion: string;
  origin: { runId: string; goalRevision: number; role: RunLink['role'] };
  status: Observation['status']; effectState: Observation['effectState'];
  summary: string; summaryTruncated: boolean;
  artifactRefs: ResourceRef[]; evidenceRefs: ResourceRef[];
  receiptDigest: string; referencesTruncated: boolean;
};
export type UnavailableHistory = { state: 'REDACTED'; id: string; reason: 'HISTORY_UNAVAILABLE'; sourceUsable: false };
export type PlanView = { state: 'VISIBLE'; projection: PlanProjection; exactRef: ResourceRef; sourceUsable: true } | UnavailableHistory;
export type ReceiptView = { state: 'VISIBLE'; projection: ReceiptProjection; exactRef: ResourceRef; sourceUsable: true } | UnavailableHistory;
export type ReceiptPage = {
  reader: HistoryReaderDescriptor; items: ReceiptView[]; nextCursor: string | null;
  collectionRef: ResourceRef; truncated: boolean; sourceUsable: boolean;
};
