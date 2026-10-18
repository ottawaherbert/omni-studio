import type { CapabilityRequest, ExecutionToken, Observation, PreparedCall } from './protocol';

export type RunStatus = 'QUEUED' | 'RUNNING' | 'WAITING_STEP' | 'WAITING_INPUT' | 'WAITING_EXTERNAL' | 'PAUSED' | 'NEEDS_REBASE' | 'RECONCILIATION_REQUIRED' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELED';
export type AgentCommand = {
  requestId: string;
  threadId?: string;
  ownerId: string;
  scopeId: string;
  kind: 'CAPABILITY' | 'CHAT' | 'GOAL';
  input: unknown;
  policyRevision: string;
  maxInvocations: number;
};
export type AgentRun = {
  id: string; threadId: string; ownerId: string; scopeId: string;
  kind: AgentCommand['kind']; input: unknown; policyRevision: string;
  status: RunStatus; version: number; generation: number; controlGeneration: number;
  fence: number; leaseOwner: string | null; leaseUntil: number | null;
  maxInvocations: number; invocationCount: number;
  result: unknown; reason: string | null;
  activeStepId: string | null;
};
export type AgentStep = {
  id: string; runId: string; generation: number;
  requestHash: string;
  status: 'PREPARED' | 'COMMITTED' | 'SUPERSEDED';
  prepared: PreparedCall; observation: Observation | null;
};
export type AgentEvent = { threadId: string; seq: number; runId: string; type: string; data: unknown };
export type ClaimedRun = { run: AgentRun; token: ExecutionToken };
export type ClaimedChild = ClaimedRun & { step: AgentStep; leaseUntil: number };
export type CapabilityCommandInput = { request: CapabilityRequest };
