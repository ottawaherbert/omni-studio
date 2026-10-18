import { AgentError } from './errors';
import { checkpointLease } from './leaseGuard';
import type { ExecutionToken } from './protocol';
import { hashValue } from './identity';
import { ModelOutputError, parseModelJson } from '../../model-output/src';

export type ModelRequest = {
  operationKey: string;
  channel: 'api' | 'external';
  routeRef: string;
  prompt: string;
  systemInstruction?: string;
  outputSchema?: Record<string, unknown>;
  outputFormat?: 'text' | 'json';
  inputManifest?: Record<string, unknown>;
  contextRef?: { id: string; digest: string };
  formatCorrection?: { sourceInvocationId: string; sourceResultHash: string; invalidText: string; problem: string };
};
export type ModelResult = {
  text: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  provenance: { channel: 'provider' | 'external-return'; producer?: string; model?: string; [key: string]: unknown };
  validationErrors?: string[];
  metadataSnapshot?: string;
  failure?: { kind: 'HTTP' | 'REFUSAL' | 'INCOMPLETE' | 'INVALID_RESPONSE'; code: string; message: string; httpStatus?: number };
  correctionInvocationId?: string;
};
export type Invocation = {
  id: string; runId: string; inputRevision: number; ownerKey: string; operationKey: string;
  status: 'PREPARED' | 'SENT' | 'RECEIVED' | 'UNKNOWN' | 'WAITING_EXTERNAL' | 'SUPERSEDED';
  inputHash: string; request: ModelRequest; result: ModelResult | null;
};
export type ExternalRequest = { id: string; invocationId: string; runId: string; status: 'WAITING' | 'RECEIVED' | 'SUPERSEDED'; request: ModelRequest; inputHash: string; redacted?: boolean; contextError?: string };
export interface ModelJournal {
  prepare(token: ExecutionToken, request: ModelRequest): Invocation;
  startAttempt(token: ExecutionToken, invocationId: string): { attemptId: string; request: ModelRequest };
  recordResult(invocationId: string, attemptId: string, result: ModelResult): ModelResult;
  markUnknown(token: ExecutionToken, invocationId: string, reason: string): void;
  waitExternal(token: ExecutionToken, invocationId: string): ExternalRequest;
  assertExecution(token: ExecutionToken): void;
  assertInput(token: ExecutionToken, request: ModelRequest, phase?: 'CONSUME' | 'VIEW'): void;
  resolvedResult?(invocationId: string): ModelResult | null;
}
export interface ModelTransport {
  // Local validation only: must not send a provider request. Failure here is
  // known not dispatched, so it must precede physical attempt accounting.
  preflight?(request: ModelRequest): void | Promise<void>;
  // The host must disable hidden SDK/proxy retries: one call is one attempt.
  sendOnce(request: ModelRequest, context: { attemptId: string; signal: AbortSignal }): Promise<ModelResult>;
  // Read only the frozen route; never use newly edited channel settings here.
  outputPolicy?(request: ModelRequest): { validateSchema: boolean; maxFormatCorrections: 0 | 1 };
}
/** A complete provider response that reports failure is received evidence, not
 * network uncertainty. The journal records it before surfacing the error. */
export class ModelResponseError extends AgentError {
  constructor(public readonly result: ModelResult) {
    super(result.failure!.code, result.failure!.message, 502);
  }
}

export function formatCorrectionRequest(source: Invocation): ModelRequest {
  if (!source.result || source.status !== 'RECEIVED' || source.request.channel !== 'api' || source.request.formatCorrection || source.result.failure || source.result.validationErrors?.length || !source.request.outputSchema)
    throw new AgentError('MODEL_CORRECTION_DENIED', '当前返回不能进行格式纠正');
  if (source.result.text.length > 128_000 || source.request.prompt.length + source.result.text.length > 1_900_000)
    throw new AgentError('MODEL_CORRECTION_LIMIT', '返回内容过长，原文已保留；请缩小本次生成范围', 422);
  let problem: string;
  try { parseModelJson(source.result.text, source.request.outputSchema); throw new AgentError('MODEL_CORRECTION_DENIED', '有效返回不需要格式纠正'); }
  catch (error) {
    if (!(error instanceof ModelOutputError) || error.kind === 'CONTRACT') throw error;
    problem = error.message;
  }
  return { ...source.request, operationKey: `${source.request.operationKey}:format-correction`,
    formatCorrection: { sourceInvocationId: source.id, sourceResultHash: hashValue(source.result), invalidText: source.result.text, problem } };
}
export class ExecutionSuspended extends AgentError {
  constructor(code: 'WAITING_STEP' | 'WAITING_EXTERNAL' | 'RECONCILIATION_REQUIRED' | 'BUDGET_EXHAUSTED', message: string) { super(code, message); }
}

export async function invokeModel(journal: ModelJournal, transport: ModelTransport, token: ExecutionToken, request: ModelRequest, signal: AbortSignal): Promise<ModelResult> {
  signal.throwIfAborted();
  journal.assertExecution(token);
  // prepare rechecks owner, execution and frozen sources in its transaction.
  // Doing the same deep source walk here can consume an entire lease before
  // the durable invocation is even recorded.
  if (token.leaseKind === 'step') await checkpointLease(signal);
  const invocation = journal.prepare(token, request);
  await checkpointLease(signal);
  if (invocation.status === 'RECEIVED') {
    journal.assertInput(token, request);
    signal.throwIfAborted();
    return consumeOutput(invocation, invocation.result!);
  }
  if (invocation.status === 'SENT' || invocation.status === 'UNKNOWN') {
    journal.markUnknown(token, invocation.id, '先前请求已发送但结果未确定，不能自动重发');
    throw new ExecutionSuspended('RECONCILIATION_REQUIRED', '模型请求结果未知，已保留记录等待核对');
  }
  if (request.channel === 'external') {
    // External waiting performs another guarded transaction.
    await checkpointLease(signal);
    journal.waitExternal(token, invocation.id);
    throw new ExecutionSuspended('WAITING_EXTERNAL', '提示词和请求已保存，等待回填');
  }
  await transport.preflight?.(request);
  await checkpointLease(signal);
  journal.assertExecution(token);
  journal.assertInput(token, request);
  await checkpointLease(signal);
  const attempt = journal.startAttempt(token, invocation.id);
  let result: ModelResult;
  try {
    result = await transport.sendOnce(attempt.request, { attemptId: attempt.attemptId, signal });
  } catch (error) {
    if (error instanceof ModelResponseError) {
      const received = journal.recordResult(invocation.id, attempt.attemptId, error.result);
      journal.assertExecution(token); journal.assertInput(token, request);
      return consumableResult(received);
    }
    // A network error cannot prove that the provider did not receive the request.
    journal.markUnknown(token, invocation.id, error instanceof Error ? error.message : '模型请求结果未知');
    throw new ExecutionSuspended('RECONCILIATION_REQUIRED', '模型请求结果未知，未自动重试');
  }
  // Evidence may arrive after cancellation/lease loss. Preserve it before
  // checking authority to consume it, without changing the author's draft.
  const received = journal.recordResult(invocation.id, attempt.attemptId, result);
  await checkpointLease(signal);
  journal.assertExecution(token);
  journal.assertInput(token, request);
  signal.throwIfAborted();
  return consumeOutput({ ...invocation, status: 'RECEIVED', result: received }, received);

  async function consumeOutput(source: Invocation, value: ModelResult): Promise<ModelResult> {
    const result = consumableResult(value), policy = request.channel === 'api' ? transport.outputPolicy?.(request) : undefined;
    if (!request.outputSchema || !policy?.validateSchema) return result;
    try { parseModelJson(result.text, request.outputSchema); return result; }
    catch (error) {
      if (!(error instanceof ModelOutputError)) throw error;
      if (error.kind === 'CONTRACT' || request.formatCorrection || policy.maxFormatCorrections !== 1 || request.channel !== 'api')
        throw new AgentError('MODEL_OUTPUT_INVALID', error.message, 422);
      // The same derived operation key replays the correction after interruption.
      // prepare/startAttempt reserve and account for it like any other invocation.
      const correction = formatCorrectionRequest({ ...source, result });
      const corrected = await invokeModel(journal, transport, token, correction, signal);
      const saved = journal.prepare(token, correction);
      return { ...corrected, correctionInvocationId: saved.id };
    }
  }
}

function consumableResult(result: ModelResult) {
  if (result.failure) throw new ModelResponseError(result);
  if (result.validationErrors?.length) throw new AgentError('MODEL_RESULT_METADATA_INVALID', `返回原文已保存，但元数据无效：${result.validationErrors.join('；')}`, 502);
  return result;
}
