import { db, dbHelpers } from '../../../../src/server/db';
import { AgentError } from '../../../../packages/agent-core/src';
import { createScriptRuntime } from '../agent/scriptRuntime';
import { createAgentModelTransport } from '../providers/agentModelTransport';
import { resolveSharedScriptMethods } from '../services/scriptSkills';
import { normalizeOpenAICompatibleBaseUrl, parseProviderText, resolveOpenAICompatibleApiKey, resolveMiniMaxApiKey, resolveDatabaseChannelApiKey } from '../../../../src/server/routes/providerProxyUtils';
import { normalizeCredentialedProviderTarget } from '../../../../src/server/routes/providerTargetPolicy';
import { parseOpenAICompatibleProviderText } from '../../../../src/server/routes/openAICompatibleEventStream';

const transport = createAgentModelTransport({
  getConfig: () => dbHelpers.getAIConfig().config,
  providerAccess: {
    normalizeOpenAIBaseUrl: normalizeOpenAICompatibleBaseUrl,
    normalizeCredentialedTarget: normalizeCredentialedProviderTarget,
    parseOpenAIResponse: parseOpenAICompatibleProviderText,
    parseResponse: parseProviderText,
    resolveCredential: (provider, configured, channelId) => provider === 'gemini'
      ? (configured.trim() || resolveDatabaseChannelApiKey(channelId,'gemini') || process.env.GEMINI_API_KEY || '').trim()
      : provider === 'minimax' ? resolveMiniMaxApiKey(configured,channelId)
      : resolveOpenAICompatibleApiKey(provider,configured,channelId),
  },
});
// This application is a local, single-author host. This is a server identity,
// not an assertion that remotely exposed requests have multi-user auth.
export const scriptRuntime = createScriptRuntime(db, {
  transport,
  owner: () => 'local-author',
  trustedLegacyProjectOwner: 'local-author',
  resolveMethods: resolveSharedScriptMethods,
  resolveExecution: request => {
    if (request.get('X-Manual-AI-Session')) throw new AgentError('DURABLE_MANUAL_SESSION_REQUIRED', '旧手动会话不能转为后台接口请求；请使用持久任务的回填渠道', 409);
    if (request.body.executionChannel === 'external') return { channel:'external',routeRef:'author:external-return' };
    if (request.body.executionChannel !== undefined && request.body.executionChannel !== 'api') throw new AgentError('INVALID_EXECUTION_CHANNEL','执行渠道无效',400);
    const route = transport.resolveRoute('scriptGen');
    transport.preflight({ ...route, operationKey:'route-preflight', prompt:'Validate local provider configuration only.' });
    return route;
  },
  onError: () => { console.error('剧本持久执行遇到错误；任务记录已保留，将继续检查队列。'); },
});
export const scriptRepository = scriptRuntime.scripts;
export const ensureScriptSchema = () => scriptRepository.ensureSchema();
