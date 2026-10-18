import { AgentError } from './errors';

const checkpoints = new WeakMap<AbortSignal, () => Promise<void>>();

/** Use the owning worker's lease guard at boundaries inside nested operations. */
export async function checkpointLease(signal: AbortSignal) {
  const checkpoint = checkpoints.get(signal);
  if (checkpoint) await checkpoint();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

// Adapted from duilang turnExecutionGuard.ts. Renewal returns the actual DB
// deadline; a slow heartbeat never manufactures additional execution time.
export function createLeaseGuard(params: {
  leaseUntil: number;
  heartbeatMs: number;
  renew: (minimumLeaseMs?: number) => Promise<number | null>;
  onHeartbeatError: (error: unknown) => void;
  parentSignal?: AbortSignal;
}) {
  if (!Number.isFinite(params.leaseUntil) || !Number.isFinite(params.heartbeatMs) || params.heartbeatMs <= 0) throw new AgentError('INVALID_LEASE', '租约时间无效', 400);
  const controller = new AbortController();
  let disposed = false;
  let renewing: Promise<boolean> | null = null;
  let expiry: ReturnType<typeof setTimeout>;
  let confirmedUntil = params.leaseUntil;
  const loseLease = () => controller.abort(new AgentError('LEASE_LOST', '执行权已失效，停止当前执行'));
  const armExpiry = (until: number) => {
    clearTimeout(expiry);
    if (!Number.isFinite(until) || until <= Date.now()) { loseLease(); return; }
    confirmedUntil = Math.max(confirmedUntil, until);
    expiry = setTimeout(loseLease, Math.min(2_147_483_647, confirmedUntil - Date.now()));
    expiry.unref?.();
  };
  const parentAborted = () => controller.abort(params.parentSignal?.reason);
  if (params.parentSignal?.aborted) parentAborted();
  else params.parentSignal?.addEventListener('abort', parentAborted, { once: true });
  armExpiry(params.leaseUntil);
  const refresh = (minimumLeaseMs?: number): Promise<boolean> => {
    if (disposed || controller.signal.aborted) return Promise.resolve(false);
    if (renewing) return minimumLeaseMs === undefined ? renewing : renewing.then(ok => ok ? refresh(minimumLeaseMs) : false);
    let request: Promise<number | null>;
    try { request = Promise.resolve(params.renew(minimumLeaseMs)); }
    catch (error) { request = Promise.reject(error); }
    renewing = request.then(until => {
      if (disposed || controller.signal.aborted) return false;
      if (until === null) { loseLease(); return false; }
      armExpiry(until);
      return true;
    }).catch(error => {
      if (!disposed) { try { params.onHeartbeatError(error); } catch { /* diagnostics cannot extend ownership */ } }
      return false;
    }).finally(() => { renewing = null; });
    return renewing;
  };
  const heartbeat = setInterval(() => { void refresh(); }, params.heartbeatMs);
  heartbeat.unref?.();
  const checkpoint = async (minimumLeaseMs?: number) => {
    if (minimumLeaseMs !== undefined && (!Number.isSafeInteger(minimumLeaseMs) || minimumLeaseMs < 1 || minimumLeaseMs > 300000)) throw new AgentError('INVALID_LEASE', '续租时长无效', 400);
    if (!await refresh(minimumLeaseMs) && !controller.signal.aborted)
      controller.abort(new AgentError('LEASE_RENEWAL_UNAVAILABLE', '租约未能确认续期，停止当前执行'));
    controller.signal.throwIfAborted();
  };
  checkpoints.set(controller.signal, checkpoint);
  return {
    signal: controller.signal,
    checkpoint,
    dispose() {
      disposed = true;
      checkpoints.delete(controller.signal);
      clearInterval(heartbeat);
      clearTimeout(expiry);
      params.parentSignal?.removeEventListener('abort', parentAborted);
    },
  };
}
