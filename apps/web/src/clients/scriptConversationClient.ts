import type {StructureAnalysis} from '../../../../packages/script/src/structureAnalysis';
import { checkTestSubmission } from './testMode';
import type { ScriptStage } from '../../../../packages/script/src/agentStages';
import type { ChatMessage } from '../../../../packages/script/src/ideation';
import type { ExternalRequest } from '../../../../packages/agent-core/src';
export type ScriptConversationView = { id: string; version: number; restartedTo?: string|null; seed: ChatMessage[]; turns: Array<{ id: string; runId: string; ordinal: number; input: { text: string; stopAfter?:ScriptStage;intent?: 'AUTO'|'AGENT'|'BLUEPRINT' }; response: (ChatMessage & { analysis?:StructureAnalysis; redacted?: boolean; goal?: { goalId: string } }) | null; status: string; reason?: string | null; errorMessage?: string; externalRequests?: ExternalRequest[] }> };
async function request(path: string, body?: unknown) {
  checkTestSubmission(body);
  const response = await fetch(`/api/script-assistant${path}`, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw Object.assign(new Error(data.error || `对话请求失败 ${response.status}`), { status: response.status }); }
  return response.json();
}
export const scriptConversationClient = {
  async available() { try { return Boolean((await request('/features')).durableChat); } catch (error) { if ((error as any).status === 404) return false; throw error; } },
  open: (seed: ChatMessage[], clientKey = 'script-home', view?: 'state') => request(`/conversations${view === 'state' ? '?view=state' : ''}`, { seed, clientKey }) as Promise<{ conversation: ScriptConversationView }>,
  get: (id: string, view?: 'state') => request(`/conversations/${encodeURIComponent(id)}${view === 'state' ? '?view=state' : ''}`) as Promise<{ conversation: ScriptConversationView }>,
  restart: (id: string, body: { requestId: string; expectedVersion: number; clientKey: string }) => request(`/conversations/${encodeURIComponent(id)}/restart`, body) as Promise<{ conversation: ScriptConversationView }>,
  send: (id: string, body: { requestId: string; expectedVersion: number; text: string; methodIds: string[]; template: string; stopAfter?:ScriptStage;intent?:'AUTO'|'AGENT'|'BLUEPRINT'; executionChannel?:'api'|'external' }) => request(`/conversations/${encodeURIComponent(id)}/messages`, body) as Promise<{ conversation: ScriptConversationView; turnId: string }>,
};
