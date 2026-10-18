import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import type { ContextAccess } from '../../../../packages/agent-context/src';
import type { ScriptMemoryScheduler } from '../agent/scriptMemory';

/** Manual model return is an execution channel for already frozen background
 * work. The caller cannot replace its prompt, source, route, or request hash. */
export function registerScriptMemoryRoutes(app: Express, deps: {
  memory: ScriptMemoryScheduler;
  owner(req: Request): string;
  authorizeScope(access: ContextAccess): void;
}) {
  const access = (req: Request): ContextAccess => {
    const scopeId = req.params.scopeId;
    const value = { ownerId: deps.owner(req), scopeId, branch: scopeId === 'script:home' ? 'author' : `workspace:${scopeId}` };
    deps.authorizeScope(value);
    return value;
  };
  const fail = (res: Response, error: unknown) => res.status(error instanceof AgentError ? error.status : 400).json({
    code: error instanceof AgentError ? error.code : 'INVALID_MEMORY_RETURN', error: error instanceof Error ? error.message : '记忆任务失败',
  });
  app.get('/api/script-memory/scopes/:scopeId/work', (req, res) => {
    try { res.json(deps.memory.work.list(access(req))); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/script-memory/scopes/:scopeId/work/:id', (req, res) => {
    try { res.json(deps.memory.work.view(deps.memory.work.read(req.params.id, access(req)))); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/script-memory/scopes/:scopeId/work/:id/return', (req, res) => {
    try {
      const who = access(req), body = req.body;
      if (!body || typeof body.requestHash !== 'string' || typeof body.text !== 'string' || body.text.length > 100000 || typeof body.producer !== 'string' || !body.producer.trim() || body.producer.length > 200)
        throw new AgentError('INVALID_MEMORY_RETURN', '回填需要原请求摘要、原文和来源标识', 400);
      const receipt = deps.memory.work.complete(req.params.id, who, body.requestHash, {
        text: body.text, provenance: { channel: 'external-return', producer: body.producer },
      }, typeof body.attemptId === 'string' ? body.attemptId : undefined);
      res.json(deps.memory.work.view(receipt));
    } catch (error) { fail(res, error); }
  });
}
