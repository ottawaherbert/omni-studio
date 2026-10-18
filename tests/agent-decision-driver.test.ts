import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentError, ExecutionInvalidated } from '../packages/agent-core/src/errors';
import { DecisionDriver, parseDecision, type DomainGoalPlugin, type GoalTool } from '../packages/agent-core/src/decisionDriver';
import { hashValue } from '../packages/agent-core/src/identity';
import { ExecutionSuspended, type Invocation, type ModelJournal, type ModelRequest, type ModelResult, type ModelTransport } from '../packages/agent-core/src/model';
import type { Decision, DecisionReceipt, ExecutionTurn, GoalExecution, GoalStorePort, ProgressComparison, Sampling, SamplingPreparation } from '../packages/agent-core/src/goals';
import type { CapabilityRequest, ExecutionToken, Observation } from '../packages/agent-core/src/protocol';
import type { RunContext } from '../packages/agent-core/src/worker';

const tool: GoalTool = { id: 'test.write', version: '1', description: '机械写入', inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'number' } } } };
const token: ExecutionToken = { runId: 'run', workerId: 'worker', fence: 1, generation: 1, inputRevision: 1 };
const signal = new AbortController().signal;
const ref = { uri: 'resource://test/artifact', version: '2', contentHash: 'hash', branch: 'candidate' };
const raw = (kind: Decision['kind'], fields: Record<string, unknown> = {}) => JSON.stringify({
  kind, capabilityId: null, capabilityVersion: null, arguments: null, planUpdate: null,
  message: null, choices: null, artifactRefs: null, summary: null, reason: null, remainingWork: null, ...fields,
});
const call = (value: number) => raw('CALL', { capabilityId: tool.id, capabilityVersion: tool.version, arguments: { value } });
const finish = () => raw('FINISH', { artifactRefs: [ref], summary: '机械完成申请' });
const observation: Observation = { status: 'SUCCEEDED', summary: '机械回执', data: {}, evidence: [], artifacts: [ref], effectState: 'CANDIDATE_PRESERVED', retry: 'NEVER' };
const modelResult = (text: string): ModelResult => ({ text, provenance: { channel: 'provider', producer: 'mechanical protocol stub' } });

class FakeJournal implements ModelJournal {
  records = new Map<string, Invocation>();
  inputRevoked = false;
  inputChecks = 0;
  prepare(_token: ExecutionToken, request: ModelRequest): Invocation {
    const old = this.records.get(request.operationKey);
    if (old) { assert.equal(hashValue(old.request), hashValue(request)); return old; }
    const invocation: Invocation = { id: `inv:${request.operationKey}`, runId: 'run', inputRevision: 1, ownerKey: 'run', operationKey: request.operationKey,
      status: 'PREPARED', inputHash: hashValue(request), request, result: null };
    this.records.set(request.operationKey, invocation);
    return invocation;
  }
  startAttempt(_token: ExecutionToken, invocationId: string) {
    const record = [...this.records.values()].find(item => item.id === invocationId)!;
    record.status = 'SENT';
    return { attemptId: `attempt:${invocationId}`, request: record.request };
  }
  recordResult(invocationId: string, _attemptId: string, result: ModelResult) {
    const record = [...this.records.values()].find(item => item.id === invocationId)!;
    record.status = 'RECEIVED'; record.result = result;
    return result;
  }
  markUnknown() { throw new Error('Unexpected unknown result'); }
  waitExternal(): never { throw new Error('Unexpected external route'); }
  assertExecution() {}
  assertInput() { this.inputChecks++; if (this.inputRevoked) throw new AgentError('INPUT_REVOKED', '决策输入已撤回'); }
  seedReceived(request: ModelRequest, text: string) {
    const record = this.prepare(token, request);
    record.status = 'RECEIVED'; record.result = modelResult(text);
  }
}

class FakeGoals implements GoalStorePort {
  turnOrdinal = 1;
  turn: ExecutionTurn = this.makeTurn(1);
  samplings = new Map<string, Sampling>();
  steps = new Map<string, Observation>();
  noProgressStreak = 0;
  progressPairs: ProgressComparison[] = [];
  yielded = 0;
  executionValue: GoalExecution = {
    token,
    run: { id: 'run', threadId: 'thread', ownerId: 'owner', scopeId: 'scope', kind: 'GOAL', input: {}, policyRevision: '1', status: 'RUNNING', version: 1, generation: 1,
      controlGeneration: 1, fence: 1, leaseOwner: 'worker', leaseUntil: 999999, maxInvocations: 20, invocationCount: 0, result: null, reason: null, activeStepId: null },
    link: { runId: 'run', goalId: 'goal', goalRevision: 1, role: 'GOAL_CONTROLLER', workspaceRef: ref, authorizationRef: 'grant', budgetId: 'budget', activeTurnId: 'turn:1', activePlanRef: null, noProgressStreak: 0, lastFeedback: [] },
    goal: { id: 'goal', ownerId: 'owner', threadId: 'thread', scopeId: 'scope', version: 1, activeRevision: 1, activeRunId: 'run', revision: null as never },
    revision: { goalId: 'goal', revision: 1, authorCommandId: 'author', budgetId: 'budget', supersedesRevision: null, objective: '机械目标', contract: { pluginId: 'test', version: '1', value: {}, digest: 'contract' }, authorizationRef: 'grant', workspaceRef: ref, sourceRefs: [], skillManifest: {}, route: { channel: 'api', routeRef: 'test:no-network' }, stopPolicy: 'CONTRACT_COMPLETE', turnLimits: { maxDecisions: 5, maxToolCalls: 5 } },
    budget: { id: 'budget', ownerId: 'owner', version: 1, limits: { maxInvocations: 20, maxToolCalls: 10, maxTurns: 5, maxRepairRounds: 2 }, used: { invocations: 0, toolCalls: 0, turns: 1, repairRounds: 0, attempts: 0, inputTokens: 0, outputTokens: 0, unknownUsageAttempts: 0, activeMs: 0 } },
  };
  private makeTurn(ordinal: number): ExecutionTurn { return { id: `turn:${ordinal}`, runId: 'run', ordinal, inputGeneration: 1, source: ordinal === 1 ? 'AUTHOR_COMMAND' : 'CONTINUATION', sourceCommandId: ordinal === 1 ? 'author' : null,
    planRef: null, state: 'OPEN', nextDecisionIndex: 0, decisionsUsed: 0, toolsUsed: 0, pendingDecisionId: null, limits: { maxDecisions: 5, maxToolCalls: 5 } }; }
  execution() { if (this.executionValue.run.status !== 'RUNNING') throw new AgentError('LEASE_LOST', '运行已原子结算'); this.executionValue.link.noProgressStreak = this.noProgressStreak; return this.executionValue; }
  openTurn() { return this.turn; }
  readSampling(turnId: string, index: number) { return this.samplings.get(`${turnId}:${index}`) ?? null; }
  saveSampling(_token: ExecutionToken, input: SamplingPreparation) {
    const key = `${input.turnId}:${input.index}`;
    if (this.samplings.has(key)) return this.samplings.get(key)!;
    const value: Sampling = { id: `sample:${key}`, turnId: input.turnId, index: input.index, inputGeneration: 1, modelRequest: input.modelRequest,
      allowedToolsDigest: input.allowedToolsDigest, progressFingerprint: input.progressFingerprint ?? null, acceptedDecision: null };
    this.samplings.set(key, value);
    return value;
  }
  acceptDecision(_token: ExecutionToken, samplingId: string, decision: Decision): DecisionReceipt {
    const sample = [...this.samplings.values()].find(item => item.id === samplingId)!;
    if (sample.acceptedDecision) { assert.deepEqual(sample.acceptedDecision.decision, decision); return sample.acceptedDecision; }
    const accepted: DecisionReceipt = { id: `decision:${samplingId}`, samplingId, turnId: sample.turnId, decision,
      callId: decision.kind === 'CALL' ? `call:${samplingId}` : null, stepId: null, consumed: false };
    sample.acceptedDecision = accepted; this.turn.decisionsUsed++;
    if (decision.kind === 'CALL') { this.turn.toolsUsed++; this.turn.state = 'WAITING_TOOL'; }
    this.turn.pendingDecisionId = accepted.id;
    return accepted;
  }
  linkStep() {}
  consumeReceipt(_token: ExecutionToken, decisionId: string, _stepId?: string, progress?: ProgressComparison) {
    const accepted = [...this.samplings.values()].map(item => item.acceptedDecision).find(item => item?.id === decisionId)!;
    const result = this.steps.get(accepted.callId!);
    assert.ok(result, 'Only a real committed mechanical step may be consumed');
    this.advance(accepted, progress);
    return result;
  }
  advanceDecision(_token: ExecutionToken, decisionId: string, progress?: ProgressComparison, feedback?: string[]) {
    const accepted = [...this.samplings.values()].map(item => item.acceptedDecision).find(item => item?.id === decisionId)!;
    assert.notEqual(accepted.decision.kind, 'CALL');
    this.advance(accepted, progress);
    if (feedback) this.executionValue.link.lastFeedback = feedback;
  }
  awaitDecision(_token: ExecutionToken, decisionId: string, progress?: ProgressComparison) {
    const accepted = [...this.samplings.values()].map(item => item.acceptedDecision).find(item => item?.id === decisionId)!;
    assert.equal(accepted.decision.kind, 'ASK');
    this.advance(accepted, progress);
    this.turn.state = 'WAITING_INPUT'; this.executionValue.run.status = 'WAITING_INPUT';
  }
  finishDecision(_token: ExecutionToken, decisionId: string, outcome: { status: 'SUCCEEDED' | 'PARTIAL'; result: unknown }, progress?: ProgressComparison, proof?: unknown) {
    const accepted = [...this.samplings.values()].map(item => item.acceptedDecision).find(item => item?.id === decisionId)!;
    assert.ok(accepted.decision.kind === 'FINISH' || accepted.decision.kind === 'STOP');
    if (outcome.status === 'SUCCEEDED') assert.deepEqual(proof, { manifestHash: 'mechanical-current-manifest' });
    this.advance(accepted, progress);
    this.executionValue.run.status = outcome.status; this.executionValue.run.result = outcome.result;
  }
  private advance(accepted: DecisionReceipt, progress?: ProgressComparison) {
    if (accepted.consumed) return;
    accepted.consumed = true; this.turn.nextDecisionIndex++; this.turn.pendingDecisionId = null; this.turn.state = 'OPEN';
    if (progress) { this.progressPairs.push(progress); this.noProgressStreak = progress.before === progress.after ? this.noProgressStreak + 1 : 0; }
  }
  yieldTurn() {
    this.yielded++; this.turn.state = 'YIELDED'; this.turnOrdinal++; this.turn = this.makeTurn(this.turnOrdinal);
    this.turn.limits = this.executionValue.revision.turnLimits;
    this.executionValue.link.activeTurnId = this.turn.id; this.executionValue.budget.used.turns++;
  }
}

function harness(outputs: string[], options: { maxNoProgressStreak?: number; decisionsPerTurn?: number; completion?: () => boolean; onCall?: (request: CapabilityRequest) => void } = {}) {
  const goals = new FakeGoals(), journal = new FakeJournal();
  if (options.decisionsPerTurn) { goals.turn.limits.maxDecisions = options.decisionsPerTurn; goals.executionValue.revision.turnLimits.maxDecisions = options.decisionsPerTurn; }
  let sent = 0, progress = 'workspace:v1', authorized = 0, completed = 0;
  const transport: ModelTransport = { async sendOnce() { const text = outputs[sent++]; assert.ok(text, 'unexpected extra model sampling'); return modelResult(text); } };
  const plugin: DomainGoalPlugin = {
    async buildDecisionInput() { return { prompt: 'Choose one bounded mechanical action', allowedTools: [tool] }; },
    async authorizeCall(_execution, decision) { authorized++; if (typeof (decision.arguments as any)?.value !== 'number') throw new AgentError('ARGUMENT_DENIED', 'bad mechanical input'); },
    async projectProgress() { return { fingerprint: progress, remainingWork: ['mechanical artifact'] }; },
    async assessCompletion() { completed++; const complete = options.completion?.() ?? true; return { complete, gaps: complete ? [] : ['artifact missing'], verifiedArtifactRefs: complete ? [ref] : [], evidence: [ref], completionProof: complete ? { manifestHash: 'mechanical-current-manifest' } : undefined }; },
  };
  const context: RunContext = { run: goals.executionValue.run, token, signal, async checkpoint() {}, async call(request, beforeExecute) {
    beforeExecute?.();
    options.onCall?.(request);
    progress = `workspace:v${(request.input as any).value}`;
    goals.steps.set(request.callId, observation);
    return observation;
  } };
  return { goals, journal, plugin, transport, context, driver: new DecisionDriver(goals, journal, transport, plugin, { maxNoProgressStreak: options.maxNoProgressStreak }),
    get sent() { return sent; }, get authorized() { return authorized; }, get completed() { return completed; }, setProgress(value: string) { progress = value; } };
}

test('frozen raw model result is parsed after restart without another physical sample', async () => {
  const h = harness([call(2), finish()]);
  const input = await h.plugin.buildDecisionInput(h.goals.execution(), h.goals.turn, signal);
  const request: ModelRequest = { operationKey: 'decision:turn:1:0', channel: 'api', routeRef: 'test:no-network', prompt: input.prompt,
    outputSchema: {}, inputManifest: { allowedGoalTools: [tool] } };
  h.goals.saveSampling(token, { turnId: 'turn:1', index: 0, modelRequest: request, allowedToolsDigest: hashValue([tool]), progressFingerprint: 'workspace:v1' });
  h.journal.seedReceived(request, call(2));
  let resumedSends = 0;
  const resumed = new DecisionDriver(h.goals, h.journal, { sendOnce: async request => {
    assert.equal(request.operationKey, 'decision:turn:1:1', 'first received choice must not be sent again');
    resumedSends++;
    return modelResult(finish());
  } }, h.plugin);
  const result = await resumed.handle(h.context);
  assert.deepEqual(result, { kind: 'SETTLED' }); assert.equal(h.goals.executionValue.run.status, 'SUCCEEDED');
  assert.equal(h.sent, 0); assert.equal(resumedSends, 1); assert.equal(h.goals.samplings.get('turn:1:0')?.acceptedDecision?.consumed, true);
  assert.deepEqual(h.goals.progressPairs[0], { before: 'workspace:v1', after: 'workspace:v2' });
});

test('accepted CALL resumes with the same server callId after suspension; no second model choice', async () => {
  let attempts = 0; const calls: string[] = [];
  const h = harness([call(2), finish()], { decisionsPerTurn: 1, onCall(request) { calls.push(request.callId); if (++attempts === 1) throw new ExecutionSuspended('WAITING_STEP', 'mechanical child handoff'); } });
  await assert.rejects(h.driver.handle(h.context), error => error instanceof ExecutionSuspended && error.code === 'WAITING_STEP');
  const accepted = h.goals.samplings.get('turn:1:0')?.acceptedDecision;
  assert.ok(accepted?.callId); assert.equal(h.sent, 1);
  const resumed = new DecisionDriver(h.goals, h.journal, h.transport, h.plugin);
  const afterPause: RunContext = { ...h.context, token: { ...token, generation: 2, inputRevision: 1 } };
  assert.deepEqual(await resumed.handle(afterPause), { kind: 'YIELD' });
  assert.equal(h.sent, 1, 'pending CALL must be consumed before the Turn yields');
  const result = await resumed.handle(afterPause);
  assert.deepEqual(result, { kind: 'SETTLED' }); assert.equal(h.goals.executionValue.run.status, 'SUCCEEDED'); assert.equal(h.sent, 2);
  assert.deepEqual(calls, [accepted.callId, accepted.callId]);
  assert.equal(h.goals.steps.size, 1);
});

test('Turn limit yields the same Run and later Turn uses remaining shared budget', async () => {
  const h = harness([call(2), finish()], { decisionsPerTurn: 1 });
  const first = await h.driver.handle(h.context);
  assert.deepEqual(first, { kind: 'YIELD' }); assert.equal(h.goals.yielded, 1);
  assert.equal(h.goals.executionValue.run.id, 'run'); assert.equal(h.goals.executionValue.budget.used.turns, 2);
  assert.deepEqual(await h.driver.handle(h.context), { kind: 'SETTLED' }); assert.equal(h.goals.executionValue.run.status, 'SUCCEEDED');
  assert.equal(h.sent, 2); assert.equal(h.goals.noProgressStreak, 1);
});

test('false FINISH cannot complete; verified artifact after a CALL can complete', async () => {
  let complete = false;
  const h = harness([finish(), call(2), finish()], { completion: () => complete, onCall() { complete = true; } });
  const result = await h.driver.handle(h.context);
  assert.deepEqual(result, { kind: 'SETTLED' }); assert.equal(h.goals.executionValue.run.status, 'SUCCEEDED'); assert.equal(h.completed, 2); assert.equal(h.sent, 3);
  assert.equal(h.goals.progressPairs[0].before, h.goals.progressPairs[0].after);
  assert.equal(h.goals.noProgressStreak, 1);
});

test('no-progress calls stop at a frozen bound without spending another model choice', async () => {
  const h = harness([call(1), call(1), call(1)], { maxNoProgressStreak: 2 });
  const result = await h.driver.handle(h.context);
  assert.equal((result as any).status, 'PARTIAL'); assert.equal((result as any).result.reason, 'NO_PROGRESS_LIMIT');
  assert.equal(h.sent, 2); assert.equal(h.goals.noProgressStreak, 2);
});

test('no-progress bound persists across yielded Turns and driver reconstruction', async () => {
  const h = harness([call(1), call(1), call(1)], { decisionsPerTurn: 1, maxNoProgressStreak: 2 });
  assert.deepEqual(await h.driver.handle(h.context), { kind: 'YIELD' });
  const resumed = new DecisionDriver(h.goals, h.journal, h.transport, h.plugin, { maxNoProgressStreak: 2 });
  const stopped = await resumed.handle(h.context);
  assert.equal((stopped as any).result.reason, 'NO_PROGRESS_LIMIT'); assert.equal(h.sent, 2);
  assert.equal(h.goals.yielded, 1); assert.equal(h.goals.noProgressStreak, 2);
});

test('ASK waits for author input and STOP records partial work without claiming completion', async () => {
  const asking = harness([raw('ASK', { message: '请选择下一步', choices: [{ id: 'a', text: '继续' }] })]);
  assert.deepEqual(await asking.driver.handle(asking.context), { kind: 'SETTLED' });
  assert.equal(asking.goals.executionValue.run.status, 'WAITING_INPUT');
  assert.equal(asking.goals.turn.nextDecisionIndex, 1); assert.equal(asking.completed, 0);
  const stopping = harness([raw('STOP', { reason: '预算内无法继续', remainingWork: ['核对正文'] })]);
  const result = await stopping.driver.handle(stopping.context);
  assert.deepEqual(result, { kind: 'SETTLED' }); assert.equal(stopping.goals.executionValue.run.status, 'PARTIAL');
  assert.deepEqual(stopping.goals.executionValue.run.result, { reason: '预算内无法继续', remainingWork: ['核对正文'] });
  assert.equal(stopping.completed, 0);
});

test('unknown tool, malformed schema and forged completion are bounded and never call a capability', async () => {
  assert.throws(() => parseDecision('{"kind":"CALL"}'), error => error instanceof AgentError && error.code === 'DECISION_INVALID');
  let capabilityCalls = 0;
  const unknown = harness([raw('CALL', { capabilityId: 'test.unknown', capabilityVersion: '1', arguments: { value: 2 } })], { onCall() { capabilityCalls++; } });
  const denied = await unknown.driver.handle(unknown.context);
  assert.equal((denied as any).status, 'PARTIAL'); assert.equal((denied as any).result.reason, 'DECISION_TOOL_DENIED');
  const outOfScope = harness([raw('CALL', { capabilityId: tool.id, capabilityVersion: tool.version, arguments: { other: 2 } })], { onCall() { capabilityCalls++; } });
  const refused = await outOfScope.driver.handle(outOfScope.context);
  assert.equal((refused as any).status, 'PARTIAL'); assert.equal((refused as any).result.reason, 'ARGUMENT_DENIED');
  const forged = harness([finish(), finish(), finish()], { completion: () => false, maxNoProgressStreak: 2, onCall() { capabilityCalls++; } });
  const incomplete = await forged.driver.handle(forged.context);
  assert.equal((incomplete as any).status, 'PARTIAL'); assert.equal((incomplete as any).result.reason, 'NO_PROGRESS_LIMIT');
  assert.equal(forged.sent, 2); assert.equal(capabilityCalls, 0);
});

test('atomic ASK, STOP and FINISH leave no resumable model decision after a worker crash', async () => {
  for (const decision of [raw('ASK', { message: '作者决定', choices: [] }), raw('STOP', { reason: '暂止', remainingWork: ['待核对'] }), finish()]) {
    const h = harness([decision]);
    assert.deepEqual(await h.driver.handle(h.context), { kind: 'SETTLED' });
    assert.equal(h.sent, 1);
    await assert.rejects(new DecisionDriver(h.goals, h.journal, h.transport, h.plugin).handle(h.context),
      error => error instanceof AgentError && error.code === 'LEASE_LOST');
    assert.equal(h.sent, 1, 'settled decision cannot produce another paid choice');
  }
});

test('rejected FINISH gaps survive a crash before the next sampling', async () => {
  const h = harness([finish()], { completion: () => false, maxNoProgressStreak: 1 });
  const advance = h.goals.advanceDecision.bind(h.goals);
  h.goals.advanceDecision = (...args) => { advance(...args); throw new ExecutionSuspended('WAITING_STEP', 'crash after durable feedback'); };
  await assert.rejects(h.driver.handle(h.context), error => error instanceof ExecutionSuspended);
  assert.deepEqual(h.goals.executionValue.link.lastFeedback, ['artifact missing']);
  h.goals.advanceDecision = advance;
  const result = await new DecisionDriver(h.goals, h.journal, h.transport, h.plugin, { maxNoProgressStreak: 1 }).handle(h.context);
  assert.deepEqual(result, { status: 'PARTIAL', result: { reason: 'NO_PROGRESS_LIMIT', remainingWork: ['artifact missing'] } });
  assert.equal(h.sent, 1);
});

test('accepted CALL rechecks frozen decision input before any new Step effect', async () => {
  let attempts = 0;
  const h = harness([call(2)], { onCall() { if (++attempts === 1) throw new ExecutionSuspended('WAITING_STEP', 'interrupt before step'); } });
  await assert.rejects(h.driver.handle(h.context), error => error instanceof ExecutionSuspended);
  h.journal.inputRevoked = true;
  await assert.rejects(new DecisionDriver(h.goals, h.journal, h.transport, h.plugin).handle(h.context),
    error => error instanceof ExecutionInvalidated && error.code === 'INPUT_REVOKED');
  assert.equal(h.sent, 1); assert.equal(attempts, 1);
  assert.equal(h.goals.steps.size, 0);
});

test('format correction returns through authorization and commits a tool exactly once',async()=>{
  let effects=0;const h=harness(['not-json',call(2),finish()],{onCall:()=>{effects++;}});
  h.transport.outputPolicy=()=>({validateSchema:true,maxFormatCorrections:1});
  const result=await h.driver.handle(h.context);
  assert.equal(result.kind,'SETTLED');assert.equal(h.goals.executionValue.run.status,'SUCCEEDED');assert.equal(h.sent,3);assert.equal(effects,1);assert.equal(h.authorized,1);assert.equal(h.completed,1);
  assert.equal([...h.journal.records.values()].filter(row=>row.request.formatCorrection).length,1);
  assert.equal([...h.journal.records.values()][0].result?.text,'not-json');
});

test('valid structured request for an unlisted tool fails authorization without format correction',async()=>{
  const h=harness([raw('CALL',{capabilityId:'unlisted.delete',capabilityVersion:'1',arguments:{value:1}})]);
  h.transport.outputPolicy=()=>({validateSchema:true,maxFormatCorrections:1});
  const result=await h.driver.handle(h.context);
  assert.equal('status' in result ? result.status : undefined,'PARTIAL');assert.equal(h.sent,1);assert.equal(h.goals.steps.size,0);
});
