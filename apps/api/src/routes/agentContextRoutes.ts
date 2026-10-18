import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import type { ContextAccess } from '../../../../packages/agent-context/src';
import type { SqliteContextStore } from '../../../../packages/agent-sqlite/src';

export function registerAgentContextRoutes(app: Express, deps: { contexts: SqliteContextStore; owner(req: Request): string; authorizeScope(access: ContextAccess): void }) {
  const access = (req: Request): ContextAccess => {
    const value = { ownerId: deps.owner(req), scopeId: req.params.scopeId, branch: typeof req.query.branch === 'string' ? req.query.branch : 'author' };
    deps.authorizeScope(value); return value;
  };
  const fail = (res: Response, error: unknown) => res.status(error instanceof AgentError ? error.status : 400).json({ error: error instanceof Error ? error.message : '上下文请求失败', code: error instanceof AgentError ? error.code : 'INVALID_REQUEST' });
  app.get('/api/agent/scopes/:scopeId/memories', (req, res) => {
    try { res.json(deps.contexts.listMemories(access(req), { ...(typeof req.query.kind === 'string' ? { kind: req.query.kind as any } : {}), ...(typeof req.query.query === 'string' ? { query: req.query.query } : {}) })); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/agent/scopes/:scopeId/memories', (req, res) => {
    try { res.status(201).json(deps.contexts.createMemory(access(req), 'author', req.body.requestId, req.body.memory)); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/agent/scopes/:scopeId/memories/:id', (req, res) => {
    try { res.json(deps.contexts.updateMemory(access(req), req.body.requestId, req.params.id, req.body.expectedRevision, req.body.action, req.body.content)); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/agent/scopes/:scopeId/contexts/:id', (req, res) => {
    try { res.json(deps.contexts.view({ id: req.params.id, digest: typeof req.query.digest === 'string' ? req.query.digest : '' }, access(req))); }
    catch (error) { fail(res, error); }
  });
}
