import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Express, Request } from 'express';
import { AgentError, type ModelTransport } from '../../../../packages/agent-core/src';
import type { MethodBinding } from '../../../../packages/script/src/schema';
import { createScriptAgentHost } from './scriptHost';
import { registerAgentRoutes } from '../routes/agentRoutes';
import { registerAgentContextRoutes } from '../routes/agentContextRoutes';
import { registerScriptConversationRoutes } from '../routes/scriptConversationRoutes';
import { registerScriptWorkspaceRoutes } from '../routes/scriptWorkspaceRoutes';
import { registerScriptCommandRoutes } from '../routes/scriptCommandRoutes';
import { registerScriptReadRoutes } from '../routes/scriptReadRoutes';
import { registerScriptMemoryRoutes } from '../routes/scriptMemoryRoutes';
import { installScriptValidationTrace } from './scriptValidationTrace';

/** Production and acceptance use this same composition. The runtime never
 * infers a database, owner, credentials or an external execution channel. */
export function createScriptRuntime(db: InstanceType<typeof Database>, options: {
  transport: ModelTransport;
  owner(req: Request): string;
  trustedLegacyProjectOwner?: string;
  resolveMethods(ids: string[]): Promise<MethodBinding[]>;
  resolveExecution(req: Request): { channel: 'api' | 'external'; routeRef: string };
  onError?(error: unknown): void;
}) {
  const host = createScriptAgentHost(db, options.transport, `script-host-${randomUUID()}`,
    {trustedLegacyProjectOwner:options.trustedLegacyProjectOwner});
  installScriptValidationTrace(db, [
    {name:'journal',object:host.journal,methods:['assertInput','prepare','waitExternal','submitExternal','assertRunInput']},
    {name:'store',object:host.store,methods:['assertDecisionInput','savePrepared','commitStep']},
    {name:'goals',object:host.goals,methods:['saveSampling','acceptDecision','consumeReceipt','advanceDecision','finishDecision']},
    {name:'contexts',object:host.contexts,methods:['withValidationBatch','assertSnapshotValue']},
    {name:'history',object:host.history,methods:['withValidationBatch','receiptRecord']},
    {name:'drafts',object:host.drafts,methods:['readCandidateView']},
  ]);
  let controller: AbortController | null = null, loop: Promise<void> | null = null;
  const authorizeScope = (access: {ownerId:string;scopeId:string;branch:string}) => {
    if (access.branch === `workspace:${access.scopeId}`) { host.workspaces.read(access.scopeId, access.ownerId); return; }
    if (access.branch !== 'author' || (access.scopeId !== 'script:home' && !host.workspaces.ownsProject(access.scopeId,access.ownerId)))
      throw new AgentError('CONTEXT_SCOPE_DENIED', '上下文不属于当前剧本范围', 403);
  };
  const register = (app: Express) => {
    registerScriptWorkspaceRoutes(app, { workspaces: host.workspaces, owner: options.owner, withReadBatch:read=>host.journal.withViewBatch(read) });
    registerScriptCommandRoutes(app, { commands: host.commands, owner: options.owner, resolveMethods: options.resolveMethods, resolveExecution: options.resolveExecution });
    registerScriptReadRoutes(app, { ...host, owner: options.owner });
    registerScriptMemoryRoutes(app, { memory: host.memory, owner: options.owner, authorizeScope });
    registerScriptConversationRoutes(app, { ...host, owner: options.owner, resolveMethods: options.resolveMethods, resolveExecution: options.resolveExecution });
    registerAgentRoutes(app, { ...host, owner: options.owner, validateCommand: () => { throw new AgentError('DOMAIN_COMMAND_REQUIRED', '请从剧本助手或写作任务入口发起工作', 400); } });
    registerAgentContextRoutes(app, { contexts: host.contexts, owner: options.owner, authorizeScope });
  };
  const start = () => {
    if (loop) return;
    controller = new AbortController(); const signal = controller.signal;
    const sleep = () => new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort',done); resolve(); }; const timer = setTimeout(done,75); signal.addEventListener('abort',done,{once:true}); if(signal.aborted)done(); });
    loop = (async () => {
      while (!signal.aborted) {
        try { await host.worker.runOnce(undefined,signal); if (!signal.aborted) await host.childWorker.runOnce(undefined,signal);
          if (!signal.aborted) await host.memory.runOnce(signal); }
        catch (error) { if (!signal.aborted) options.onError?.(error); }
        if (!signal.aborted) await sleep();
      }
    })().finally(() => { loop = null; controller = null; });
  };
  const stop = async () => { controller?.abort(); await loop; };
  return { ...host, register, start, stop };
}
