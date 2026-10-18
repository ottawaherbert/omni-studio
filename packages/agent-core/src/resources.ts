import { AgentError } from './errors';
import { hashValue, jsonCopy } from './identity';
import type { AccessContext, ResourcePage, ResourceProvider, ResourceQuery, ResourceRef } from './protocol';

const bounded = (value: number | undefined, fallback: number, maximum: number) => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new AgentError('INVALID_RESOURCE_LIMIT', '读取范围必须是有限数字', 400);
  return Math.max(1, Math.min(maximum, Math.floor(value)));
};
export function assertResourceRef(ref: ResourceRef) {
  if (!ref || typeof ref.uri !== 'string' || !ref.version || !ref.branch || !/^[a-f0-9]{64}$/.test(ref.contentHash)) throw new AgentError('INVALID_RESOURCE_REF', '资源引用缺少版本或内容摘要', 400);
  let url: URL;
  try { url = new URL(ref.uri); } catch { throw new AgentError('INVALID_RESOURCE_REF', '资源地址无效', 400); }
  if (url.protocol !== 'resource:' || !/^[a-z][a-z0-9_-]*$/.test(url.hostname) || url.username || url.password || url.port || url.hash) throw new AgentError('INVALID_RESOURCE_REF', '资源地址必须使用已注册的本地命名空间', 400);
  return url.hostname;
}

// Adapted from duilang ResourceCatalog, with domain-neutral resource identity
// and host-supplied access checks. It never fetches a URI over the network.
export class ResourceCatalog {
  private readonly providers = new Map<string, ResourceProvider>();
  constructor(private readonly authorize: (namespace: string, action: 'list' | 'search' | 'open', input: unknown, context: AccessContext) => Promise<void>) {}
  register(provider: ResourceProvider) {
    if (!/^[a-z][a-z0-9_-]*$/.test(provider.namespace) || this.providers.has(provider.namespace)) throw new AgentError('RESOURCE_PROVIDER_CONFLICT', '资源命名空间无效或已注册');
    this.providers.set(provider.namespace, provider);
    return this;
  }
  private require(namespace: string) {
    const provider = this.providers.get(namespace);
    if (!provider) throw new AgentError('RESOURCE_NOT_FOUND', '资源命名空间不存在', 404);
    return provider;
  }
  private query(query: ResourceQuery): ResourceQuery {
    if (query.cursor && query.cursor.length > 512) throw new AgentError('INVALID_CURSOR', '读取游标无效', 400);
    return { ...query, limit: bounded(query.limit, 20, 100) };
  }
  private page(page: ResourcePage) {
    assertResourceRef(page.collection);
    for (const item of page.items) assertResourceRef(item.ref);
    if (page.truncated && !page.nextCursor) throw new AgentError('INCOMPLETE_RESOURCE_PAGE', '截断的结果缺少继续读取游标', 502);
    return jsonCopy(page);
  }
  async list(namespace: string, query: ResourceQuery, context: AccessContext) {
    const provider = this.require(namespace);
    const input = this.query(query);
    context.signal.throwIfAborted();
    await this.authorize(namespace, 'list', input, context);
    const result = this.page(await provider.list(input, context));
    await this.authorize(namespace, 'list', input, context);
    context.signal.throwIfAborted();
    return result;
  }
  async search(namespace: string, query: ResourceQuery & { query: string }, context: AccessContext) {
    const provider = this.require(namespace);
    const input = { ...this.query(query), query: query.query.trim() };
    if (!input.query || input.query.length > 2_000) throw new AgentError('INVALID_QUERY', '资源检索词为空或过长', 400);
    context.signal.throwIfAborted();
    await this.authorize(namespace, 'search', input, context);
    const result = this.page(await provider.search(input, context));
    await this.authorize(namespace, 'search', input, context);
    context.signal.throwIfAborted();
    return result;
  }
  async open(ref: ResourceRef, options: { cursor?: string; limit?: number }, context: AccessContext) {
    const namespace = assertResourceRef(ref);
    const provider = this.require(namespace);
    if (options.cursor && options.cursor.length > 512) throw new AgentError('INVALID_CURSOR', '读取游标无效', 400);
    const input = { ...options, ...(options.limit === undefined ? {} : { limit: bounded(options.limit, 1, 24_000) }) };
    context.signal.throwIfAborted();
    await this.authorize(namespace, 'open', { ref, ...input }, context);
    const result = await provider.open(jsonCopy(ref), input, context);
    await this.authorize(namespace, 'open', { ref, ...input }, context);
    context.signal.throwIfAborted();
    assertResourceRef(result.ref);
    if (hashValue(result.ref) !== hashValue(ref)) throw new AgentError('RESOURCE_VERSION_CHANGED', '读取结果与指定资源版本不一致');
    if (result.truncated && !result.nextCursor) throw new AgentError('INCOMPLETE_RESOURCE_PAGE', '截断的原文缺少继续读取游标', 502);
    return jsonCopy(result);
  }
}
