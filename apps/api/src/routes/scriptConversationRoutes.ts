import { COMPATIBLE_SCRIPT_STAGES } from '../../../../packages/script/src/agentStages';
import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import type { SqliteContextStore, SqliteConversationStore, AgentSqliteStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';
import type { MethodBinding } from '../../../../packages/script/src/schema';
import type { ChatMessage } from '../../../../packages/script/src/ideation';
import { SCRIPT_CHAT_SCOPE, SCRIPT_CHAT_TEMPLATE, type ConversationValidationScope } from '../agent/scriptConversation';
import type { ScriptCommandService } from '../agent/scriptCommands';

export function registerScriptConversationRoutes(app: Express, deps: { store: AgentSqliteStore; journal: SqliteModelJournal; contexts: SqliteContextStore; conversations: SqliteConversationStore; commands?:ScriptCommandService; owner(req: Request): string; resolveMethods(ids: string[]): Promise<MethodBinding[]>; channel?: 'api' | 'external'; routeRef?: string; resolveExecution?(req: Request): { channel: 'api' | 'external'; routeRef: string }; withConversationValidation?: ConversationValidationScope }) {
  const fail = (res: Response, error: unknown) => res.status(error instanceof AgentError ? error.status : 400).json({ error: error instanceof Error ? error.message : '对话请求失败', code: error instanceof AgentError ? error.code : 'INVALID_CONVERSATION' });
  const withConversationValidation = deps.withConversationValidation ?? (read => read());
  const view = (threadId: string, ownerId: string, stateOnly = false) => withConversationValidation(() => {
    const conversation = deps.conversations.read(threadId, ownerId);
    if (conversation.scopeId !== SCRIPT_CHAT_SCOPE) throw new AgentError('CHAT_SCOPE_DENIED', '不是剧本首页对话', 403);
    return { ...conversation, turns: conversation.turns.map(turn => {
      const actualRun=deps.store.readRun(turn.runId, ownerId);
      const run = stateOnly&&actualRun.status!=='FAILED'?deps.journal.stateRun(actualRun):deps.journal.viewRun(actualRun);
      let response = turn.response;
      if (response) { try { deps.contexts.assertArtifact('conversation-turn', turn.id, 'VIEW'); } catch { response = { text: '这条回复的上下文已撤回，原记录保留但不再显示或继续使用。', options: [], redacted: true }; } }
      // The chat display does not consume archived model prompts. Keep the
      // complete audited view available, and still validate every visible reply
      // and every pending external request before projecting polling state.
      if (stateOnly && response) { const { prompt: _prompt, ...display } = response; response = display; }
      return { ...turn, response, reason: run.reason, errorMessage: run.status === 'FAILED' && typeof (run.result as any)?.error === 'string' ? (run.result as any).error : undefined, externalRequests: deps.journal.listExternal(run.id, ownerId, stateOnly ? 'WAITING' : undefined) };
    }) };
  });
  app.get('/api/script-assistant/features', (_req, res) => res.json({ durableChat: true }));
  app.post('/api/script-assistant/conversations', (req, res) => {
    try {
      const seed: ChatMessage[] = [];
      if (req.body.seed !== undefined) {
        if (!Array.isArray(req.body.seed) || req.body.seed.length > 500) throw new AgentError('INVALID_HISTORY', '历史对话格式无效', 400);
        for (const message of req.body.seed) {
          if (!message || !['user', 'ai'].includes(message.role) || typeof message.text !== 'string') throw new AgentError('INVALID_HISTORY', '历史对话消息格式无效', 400);
          if (!message.isError) seed.push({ role: message.role, text: message.text, ...(Array.isArray(message.options) ? { options: message.options.filter((option: any) => typeof option?.tag === 'string' && typeof option?.text === 'string').map((option: any) => ({ tag: option.tag, text: option.text })) } : {}) });
        }
      }
      const clientKey = req.body.clientKey === undefined ? 'script-home' : req.body.clientKey;
      if (typeof clientKey !== 'string' || !clientKey.trim() || clientKey.length > 200) throw new AgentError('INVALID_CONVERSATION', '对话标识无效', 400);
      const owner = deps.owner(req), conversation = deps.conversations.open(owner, SCRIPT_CHAT_SCOPE, clientKey, seed);
      res.json({ conversation: view(conversation.id, owner, req.query?.view === 'state') });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/script-assistant/conversations/:id', (req, res) => { try { res.json({ conversation: view(req.params.id, deps.owner(req), req.query?.view === 'state') }); } catch (error) { fail(res, error); } });
  app.post('/api/script-assistant/conversations/:id/restart', (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some(key => !['requestId', 'expectedVersion', 'clientKey'].includes(key))) throw new AgentError('INVALID_CONVERSATION_RESTART', '清空重来请求格式无效', 400);
      const owner = deps.owner(req), old = deps.conversations.read(req.params.id, owner);
      if (old.scopeId !== SCRIPT_CHAT_SCOPE) throw new AgentError('CHAT_SCOPE_DENIED', '不是剧本首页对话', 403);
      const { requestId, expectedVersion, clientKey } = req.body;
      const { conversation } = deps.conversations.restart({ threadId: old.id, ownerId: owner, requestId, expectedVersion, clientKey });
      res.json({ conversation: view(conversation.id, owner) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/script-assistant/conversations/:id/messages', async (req, res) => {
    try {
      const { text, methodIds = [], template = SCRIPT_CHAT_TEMPLATE, requestId, expectedVersion } = req.body;
      const owner = deps.owner(req); view(req.params.id, owner);
      if(req.body.intent!==undefined&&!['AUTO','AGENT','BLUEPRINT'].includes(req.body.intent))throw new AgentError('INVALID_CHAT_INTENT','对话模式无效',400);
      if(req.body.stopAfter!==undefined&&(req.body.intent!=='AGENT'||!COMPATIBLE_SCRIPT_STAGES.includes(req.body.stopAfter)))throw new AgentError('INVALID_STOP_STAGE','停止阶段需要明确的 Agent 任务',400);
      const identity = { threadId: req.params.id, ownerId: owner, requestId, expectedVersion, requestEnvelope: structuredClone(req.body) };
      let accepted = deps.conversations.received(identity);
      if (accepted) { res.status(202).json({ turnId: accepted.turnId, conversation: view(accepted.conversation.id, owner) }); return; }
      deps.conversations.assertActive(req.params.id, owner);
      if (typeof text !== 'string' || !text.trim() || text.length > 100000 || !Array.isArray(methodIds) || methodIds.length > 100 || methodIds.some(id => typeof id !== 'string') || new Set(methodIds).size !== methodIds.length || typeof template !== 'string' || template.length > 100000 || !template.includes('{{conversation}}') || !template.includes('{{taskContract}}')) throw new AgentError('INVALID_CHAT_MESSAGE', '消息、Skill 或对话模板无效', 400);
      let methods: MethodBinding[] = [];
      try { methods = await deps.resolveMethods(methodIds); }
      catch (error) { accepted = deps.conversations.received(identity); if (!accepted) throw error; }
      // Another process may have accepted this same command during async Skill
      // resolution. Its frozen snapshot wins even if the current Skill vanished.
      accepted ??= deps.conversations.received(identity);
      if (!accepted) {
        if (methods.length !== methodIds.length || methods.some((method, index) => method.id !== methodIds[index] && method.id !== `skill:${methodIds[index]}`) || new Set(methods.map(method => method.id)).size !== methodIds.length) throw new AgentError('SKILL_NOT_FOUND', '所选 Skill 已删除或不可访问', 409);
        const execution = deps.resolveExecution ? deps.resolveExecution(req) : { channel: deps.channel, routeRef: deps.routeRef };
        if (!['api','external'].includes(execution.channel || '') || !execution.routeRef) throw new AgentError('EXECUTION_NOT_CONFIGURED','剧本模型执行渠道尚未配置',400);
        if (req.body.selection !== undefined) {
          if (!deps.commands) throw new AgentError('MANUAL_DISPATCH_UNAVAILABLE', '当前宿主未接入单步写作派发');
          accepted = deps.commands.acceptChatTurn({ownerId:owner,threadId:req.params.id,requestId,expectedVersion,requestEnvelope:identity.requestEnvelope,
            payload:{text,methods,template,...execution,selection:req.body.selection},text,methods,route:execution,selection:req.body.selection});
        } else accepted = deps.conversations.accept({ ...identity, payload: { text, methods, template, ...execution, ...(req.body.intent?{intent:req.body.intent}:{}),...(req.body.stopAfter?{stopAfter:req.body.stopAfter}:{}) }, capabilityId: req.body.intent?'script.assistant_start':'script.converse', maxInvocations: 4 });
      }
      res.status(202).json({ turnId: accepted.turnId, conversation: view(accepted.conversation.id, owner) });
    } catch (error) { fail(res, error); }
  });
}
