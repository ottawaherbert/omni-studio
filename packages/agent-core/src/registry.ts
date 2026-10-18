import { AgentError, ExecutionInvalidated } from './errors';
import { assertSamePayload, hashValue, jsonCopy } from './identity';
import type { AccessContext, Capability, CapabilityRequest, CapabilitySpec, ExecutionPolicy, Observation, PreparedCall } from './protocol';

const key = (id: string, version: string) => `${id}@${version}`;
const binding = (context: AccessContext) => ({ ownerId: context.ownerId, scopeId: context.scopeId, commandRevision: context.commandRevision, policyRevision: context.policyRevision });
export const describeCapability = (spec: CapabilitySpec) => ({
  id: spec.id, version: spec.version, implementationDigest: spec.implementationDigest,
  description: spec.description, effect: spec.effect, cost: spec.cost, dispatch: spec.dispatch, replay: spec.replay,
  inputSchema: spec.input.jsonSchema, outputSchema: spec.output.jsonSchema,
});

// The prepare -> parse again -> pin -> attest -> execute -> validate sequence
// comes from duilang's registry. Host DB/lease and book URI dependencies are ports.
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();
  constructor(private readonly policy: ExecutionPolicy) {}

  register(capability: Capability): this {
    const spec = capability.spec;
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(spec.id) || !/^[a-zA-Z0-9._-]+$/.test(spec.version)) {
      throw new AgentError('INVALID_CAPABILITY', '能力名称或版本无效', 400);
    }
    if (!/^[a-f0-9]{64}$/.test(spec.implementationDigest)) throw new AgentError('INVALID_IMPLEMENTATION_DIGEST', '能力缺少实现摘要', 400);
    const identity = key(spec.id, spec.version);
    if (this.capabilities.has(identity)) throw new AgentError('CAPABILITY_CONFLICT', `能力已注册：${identity}`);
    // Isolate registration metadata from mutable provider objects.
    const snapshot: Capability = {
      spec: { ...jsonCopy(describeCapability(spec)), input: { jsonSchema: jsonCopy(spec.input.jsonSchema), parse: spec.input.parse.bind(spec.input) }, output: { jsonSchema: jsonCopy(spec.output.jsonSchema), parse: spec.output.parse.bind(spec.output) } },
      prepare: capability.prepare?.bind(capability), execute: capability.execute.bind(capability),
    };
    this.capabilities.set(identity, snapshot);
    return this;
  }

  describe() { return [...this.capabilities.values()].map(c => jsonCopy(describeCapability(c.spec))).sort((a, b) => key(a.id, a.version).localeCompare(key(b.id, b.version))); }
  private require(request: CapabilityRequest) {
    const capability = this.capabilities.get(key(request.capabilityId, request.capabilityVersion));
    if (!capability) throw new AgentError('CAPABILITY_NOT_FOUND', '能力或指定版本不可用', 404);
    return capability;
  }
  private async check(context: AccessContext) {
    context.signal.throwIfAborted();
    await this.policy.assertExecution(context);
    context.signal.throwIfAborted();
  }

  async prepare(request: CapabilityRequest, context: AccessContext): Promise<PreparedCall> {
    await this.check(context);
    const capability = this.require(request);
    const input = jsonCopy(capability.spec.input.parse(jsonCopy(request.input)));
    let call: PreparedCall = {
      request: { ...request, input }, implementationDigest: capability.spec.implementationDigest,
      contractDigest: hashValue(describeCapability(capability.spec)), inputDigest: hashValue(input),
      binding: binding(context), sources: [], targets: [], preparedDigest: '',
    };
    // Authorize before a provider may read sensitive resources while preparing.
    await this.policy.authorize(capability.spec, jsonCopy(call), context, 'PREPARE');
    if (capability.prepare) {
      const prepared = await capability.prepare(jsonCopy(input), context);
      const canonicalInput = jsonCopy(capability.spec.input.parse(prepared.input));
      call = { ...call, request: { ...request, input: canonicalInput }, inputDigest: hashValue(canonicalInput), sources: jsonCopy(prepared.sources), targets: jsonCopy(prepared.targets) };
    }
    await this.check(context);
    await this.policy.authorize(capability.spec, jsonCopy(call), context, 'PREPARE');
    call.preparedDigest = preparedCallDigest(call);
    return jsonCopy(call);
  }

  async attest(prepared: PreparedCall, context: AccessContext, phase: 'EXECUTE' | 'REPLAY' = 'EXECUTE'): Promise<void> {
    const call = jsonCopy(prepared);
    await this.check(context);
    const { spec } = this.require(call.request);
    assertSamePayload(preparedCallDigest(call), call.preparedDigest);
    assertSamePayload(hashValue(binding(context)), hashValue(call.binding));
    // A deployment may replace the capability after a request was frozen and
    // its model result received. Keep that evidence and require an explicit
    // rebase instead of reporting the child as an ordinary failed execution.
    if(spec.implementationDigest!==call.implementationDigest)
      throw new ExecutionInvalidated('CAPABILITY_IMPLEMENTATION_CHANGED','能力实现已变化，请基于当前版本继续');
    assertSamePayload(hashValue(describeCapability(spec)), call.contractDigest);
    assertSamePayload(hashValue(call.request.input), call.inputDigest);
    const parsed = jsonCopy(spec.input.parse(call.request.input));
    assertSamePayload(hashValue(parsed), call.inputDigest);
    if (spec.dispatch === 'DURABLE' && !context.execution.stepId) throw new AgentError('DURABLE_STEP_REQUIRED', '此能力需要持久执行步骤');
    await this.policy.authorize(spec, jsonCopy(call), context, phase);
    await this.check(context);
  }

  /** Replaying an already committed fact checks identity and present read access,
   * not the old write preconditions invalidated by that very effect. */
  attestReceipt(prepared: PreparedCall, context: AccessContext) { return this.attest(prepared, context, 'REPLAY'); }

  async execute(prepared: PreparedCall, context: AccessContext): Promise<Observation> {
    const call = jsonCopy(prepared);
    await this.attest(call, context);
    const { spec, execute } = this.require(call.request);
    if (spec.dispatch === 'DURABLE' && context.execution.leaseKind !== 'step') throw new AgentError('CHILD_LEASE_REQUIRED', '耐久能力只能由独立子执行租约执行');
    const observation = await execute(call, context);
    await this.check(context);
    return this.validateObservation(call, observation);
  }

  validateObservation(call: PreparedCall, observation: Observation): Observation {
    const { spec } = this.require(call.request);
    // Side effects need the host's fenced transaction, not just this check.
    // A malformed result must not be reported as proof that no effect happened.
    if (!['SUCCEEDED', 'FAILED', 'DENIED', 'CAPABILITY_GAP'].includes(observation.status)
      || !['NO_EFFECT', 'CANDIDATE_PRESERVED', 'EFFECT_VERIFIED', 'EFFECT_UNKNOWN'].includes(observation.effectState)
      || !['NEVER', 'SAME_INPUT', 'REPLAN', 'RECONCILE'].includes(observation.retry)
      || typeof observation.summary !== 'string' || !Array.isArray(observation.evidence) || !Array.isArray(observation.artifacts)) {
      throw new AgentError('INVALID_OBSERVATION', '能力返回缺少有效结果和副作用信息', 502);
    }
    return jsonCopy({ ...observation, data: observation.status === 'SUCCEEDED' ? spec.output.parse(observation.data) : observation.data });
  }
}

function preparedCallDigest(call: PreparedCall) {
  const { preparedDigest: _digest, ...payload } = call;
  return hashValue(payload);
}
