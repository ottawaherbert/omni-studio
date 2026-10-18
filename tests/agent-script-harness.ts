import {registerScriptConversationRoutes} from '../apps/api/src/routes/scriptConversationRoutes';
import {scriptChatSkills} from './fixtures/script-chat-skills';
import {methodFromSkill} from '../packages/script/src/methods';
import express from 'express';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { registerAgentRoutes } from '../apps/api/src/routes/agentRoutes';
import { registerAgentContextRoutes } from '../apps/api/src/routes/agentContextRoutes';
import { registerScriptRoutes } from '../apps/api/src/routes/scriptRoutes';
import { AgentError } from '../packages/agent-core/src';

const filename = process.env.SCRIPT_AGENT_DB;
if (!filename || !filename.startsWith('/tmp/')) throw new Error('Acceptance requires an explicit /tmp/ database');
const db = new Database(filename);
const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('Acceptance never calls external providers'); } }, 'acceptance-api-does-not-execute',
  {trustedLegacyProjectOwner:'isolated-author'});
const app = express(); app.use(express.json({ limit: '4mb' }));
registerAgentRoutes(app, { ...host, owner: () => 'isolated-author', validateCommand: value => {
  const command = value as any;
  if (command?.kind !== 'CAPABILITY' || command?.input?.request?.capabilityId !== 'script.rewrite' || command?.input?.request?.input?.channel !== 'external') throw new AgentError('ACCEPTANCE_CHANNEL_ONLY', '本验收入口只接受局部改写的持久模拟返回', 400);
} });
registerScriptRoutes(app, host.scripts);
registerScriptConversationRoutes(app, { ...host, owner: () => 'isolated-author', channel:'external', routeRef:'simulation:gpt-6-sol', resolveMethods:async ids=>ids.flatMap(id=>{const skill=scriptChatSkills.find(s=>s.id===id);return skill?[methodFromSkill(skill)]:[];}) });
registerAgentContextRoutes(app, { contexts: host.contexts, owner: () => 'isolated-author', authorizeScope: access => {
  if (access.branch !== 'author' || (access.scopeId !== 'script:home' && !host.scripts.getProject(access.scopeId))) throw new AgentError('CONTEXT_SCOPE_DENIED', '验收上下文不属于当前作者作品', 403);
} });
app.use('/api', (_req, res) => res.status(503).json({ error: '验收环境拒绝外部服务' }));
const server = app.listen(Number(process.env.SCRIPT_AGENT_PORT || 0), '127.0.0.1', () => {
  const address = server.address() as { port: number };
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, database: filename }));
  process.send?.({ ready: true, port: address.port });
});
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, () => server.close(() => { db.close(); process.exit(0); }));
