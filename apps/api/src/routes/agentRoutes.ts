import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';

/** Authentication belongs to the host. Never accept ownerId from the request. */
export function registerAgentRoutes(app: Express, deps: { store: AgentSqliteStore; journal: SqliteModelJournal; owner: (request: Request) => string; validateCommand?: (input: unknown) => void }) {
  const { store, journal } = deps;
  const respond = (res: Response, error: unknown) => res.status(error instanceof AgentError ? error.status : Number((error as any)?.statusCode) || 400).json({ error: error instanceof Error ? error.message : '任务请求失败', code: error instanceof AgentError ? error.code : 'INVALID_REQUEST' });
  app.post('/api/agent/runs', (req, res) => {
    try {
      deps.validateCommand?.(req.body);
      const ownerId = deps.owner(req);
      const { requestId, threadId, scopeId, kind, input, maxInvocations } = req.body;
      res.status(202).json(store.accept({ requestId, ...(threadId ? { threadId } : {}), ownerId, scopeId, kind, input, policyRevision: 'local-author.v1', maxInvocations }));
    } catch (error) { respond(res, error); }
  });
  app.get('/api/agent/runs/:id', (req, res) => {
    try {
      const ownerId = deps.owner(req), run = store.readRun(req.params.id, ownerId);
      if (req.query.view === 'state') return res.json({ run: journal.stateRun(run), externalRequests: journal.listExternal(run.id, ownerId, 'WAITING') });
      res.json(journal.withViewBatch(() => ({ run: journal.viewRun(run), externalRequests: journal.listExternal(run.id, ownerId) })));
    } catch (error) { respond(res, error); }
  });
  app.post('/api/agent/runs/:id/control', (req, res) => {
    try { res.json({ run: journal.viewRun(store.control(req.params.id, deps.owner(req), req.body.expectedVersion, req.body.action, req.body.requestId)) }); }
    catch (error) { respond(res, error); }
  });
  app.post('/api/agent/runs/:id/reconcile', (req, res) => {
    try { res.json({ run: journal.viewRun(journal.reconcileReceived(req.params.id, deps.owner(req), req.body.expectedVersion, req.body.requestId)) }); }
    catch (error) { respond(res, error); }
  });
  app.get('/api/agent/threads/:id/events', (req, res) => {
    try { res.json({ events: journal.viewEvents(store.events(req.params.id, deps.owner(req), req.query.after === undefined ? 0 : Number(req.query.after), req.query.limit === undefined ? 100 : Number(req.query.limit))) }); }
    catch (error) { respond(res, error); }
  });
  app.get('/api/agent/external/:id', (req, res) => {
    try { res.json({ request: journal.externalRequest(req.params.id, deps.owner(req)) }); }
    catch (error) { respond(res, error); }
  });
  app.post('/api/agent/external/:id/result', (req, res) => {
    try { res.json({ request: journal.submitExternal(req.params.id, deps.owner(req), req.body.inputHash, req.body.text, req.body.producer) }); }
    catch (error) { respond(res, error); }
  });
}
