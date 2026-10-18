import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { ChatMessage } from '../packages/script/src/ideation';
import type { AgentRun } from '../packages/agent-core/src';
import type { ScriptConversationView } from '../apps/web/src/clients/scriptConversationClient';

const keys = {
  active: 'omni.script.conversation.active.v1', thread: 'omni.script.conversation.thread.v1',
  pending: 'omni.script.conversation.pending.v1', restart: 'omni.script.conversation.restart.v1',
};
type HttpCall = { path: string; method: string; body: Record<string, any> | null };
type HookSnapshot = {
  id: string | null; version: number | null; mode: string; pending: boolean; canReset: boolean;
  needsReconcile: boolean; goalWorking: boolean; goalNeedsReconcile: boolean;
  error: string; input: string; messages: ChatMessage[]; actionErrors: string[];
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function conversation(id = 'thread-old', version = 7, status?: string): ScriptConversationView {
  return { id, version, seed: [{ role: 'ai', text: '旧对话种子' }], turns: status ? [{
    id: 'turn-old', runId: 'run-old', ordinal: 1, input: { text: '旧创作要求', intent: 'AUTO' },
    response: null, status,
  }] : [] };
}
function run(id: string, threadId: string, status: AgentRun['status'], kind: AgentRun['kind'] = 'CHAT', version = 31): AgentRun {
  return { id, threadId, status, kind, version, ownerId: 'fixture-owner', scopeId: 'fixture-scope',
    input: {}, policyRevision: 'fixture-policy', generation: 1, controlGeneration: 0, fence: 1,
    leaseOwner: null, leaseUntil: null, maxInvocations: 1, invocationCount: 1, result: null,
    reason: null, activeStepId: null };
}
class MemoryHttp {
  calls: HttpCall[] = [];
  conversations = new Map<string, ScriptConversationView>();
  runs = new Map<string, AgentRun>();
  handler?: (call: HttpCall) => unknown | Promise<unknown>;
  inFlightMutations = 0;
  maxConcurrentMutations = 0;
  private restartReceipts = new Map<string, ScriptConversationView>();
  private messageReceipts = new Map<string, unknown>();
  constructor(initial: ScriptConversationView) { this.conversations.set(initial.id, structuredClone(initial)); }
  matching(suffix: string) { return this.calls.filter(call => call.path.endsWith(suffix)); }
  answer(call: HttpCall): unknown {
    if (call.path === '/api/script-assistant/features') return { durableChat: true };
    if (call.path === '/api/skills') return { skills: [] };
    const threadMatch = call.path.match(/^\/api\/script-assistant\/conversations\/([^/]+)(?:\/(messages|restart))?$/);
    if (threadMatch) {
      const id = decodeURIComponent(threadMatch[1]), operation = threadMatch[2];
      const current = this.conversations.get(id);
      assert.ok(current, `Unknown fixture thread ${id}`);
      if (!operation) return { conversation: structuredClone(current) };
      const receiptId = `${id}:${call.body!.requestId}`;
      if (operation === 'restart') {
        let next = this.restartReceipts.get(receiptId);
        if (!next) {
          next = { id: `thread-new-${this.restartReceipts.size + 1}`, version: 1, seed: [], turns: [] };
          this.restartReceipts.set(receiptId, next); this.conversations.set(next.id, next);
          current.restartedTo = next.id;
        }
        return { conversation: structuredClone(next) };
      }
      let receipt = this.messageReceipts.get(receiptId);
      if (!receipt) {
        assert.equal(call.body!.expectedVersion, current.version, 'each new message must use the confirmed conversation version');
        current.version++;
        const turnId = `turn-${current.turns.length + 1}`;
        current.turns.push({ id: turnId, runId: `run-${turnId}`, ordinal: current.turns.length + 1,
          input: { text: call.body!.text, intent: call.body!.intent }, status: 'SUCCEEDED',
          response: { role: 'ai', text: `已收到：${call.body!.text}` } });
        receipt = { conversation: structuredClone(current), turnId };
        this.messageReceipts.set(receiptId, receipt);
      }
      return structuredClone(receipt);
    }
    if (call.path.startsWith('/api/script-runs?')) {
      const threadId = new URL(call.path, 'http://fixture.invalid').searchParams.get('threadId');
      return { runs: [...this.runs.values()].filter(value => value.threadId === threadId)
        .map(value => ({ run: structuredClone(value), workspaceId: 'fixture-workspace', goalId: null })) };
    }
    const runMatch = call.path.match(/^\/api\/agent\/runs\/([^/?]+)(\?view=state|\/reconcile)$/);
    if (runMatch) {
      const current = this.runs.get(decodeURIComponent(runMatch[1]));
      assert.ok(current, `Unknown fixture run ${runMatch[1]}`);
      if (runMatch[2] === '?view=state') return { run: structuredClone(current), externalRequests: [] };
      assert.equal(call.body!.expectedVersion, current.version, 'reconcile must use the freshly fetched run version');
      current.status = 'SUCCEEDED'; current.version++;
      const thread = this.conversations.get(current.threadId)!;
      for (const turn of thread.turns.filter(value => value.runId === current.id)) {
        turn.status = 'SUCCEEDED'; turn.response = { role: 'ai', text: '已核对旧请求返回' };
      }
      thread.version++;
      return { run: structuredClone(current) };
    }
    throw new Error(`Unexpected fixture HTTP request: ${call.method} ${call.path}`);
  }
  fetch: typeof fetch = async (input, init) => {
    const call = { path: String(input), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    this.calls.push(call);
    const mutation = call.method !== 'GET';
    if (mutation) { this.inFlightMutations++; this.maxConcurrentMutations = Math.max(this.maxConcurrentMutations, this.inFlightMutations); }
    try {
      const intercepted = await this.handler?.(call), value = intercepted === undefined ? this.answer(call) : intercepted;
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally { if (mutation) this.inFlightMutations--; }
  };
}
type Session = {
  http: MemoryHttp; window: JSDOM['window']; document: Document; storage: Storage;
  snapshot: () => HookSnapshot; click: (action: string) => Promise<void>; type: (text: string) => Promise<void>;
  poll: () => Promise<void>; flush: () => Promise<void>; remount: (initialInput?: string) => Promise<void>;
  unmount: () => Promise<void>;
};
async function withHook(initial: ScriptConversationView, execute: (session: Session) => Promise<void>, prepare?: (storage: Storage) => void,
  options: { page?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://fixture.invalid/', pretendToBeVisual: true,
  });
  const http = new MemoryHttp(initial), window = dom.window, document = window.document;
  const timers = new Map<number, () => void>(); let nextTimerId = 900000;
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  const values: Record<string, unknown> = {
    window, document, navigator: window.navigator, localStorage: window.localStorage,
    Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event, MouseEvent: window.MouseEvent, MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window), fetch: http.fetch,
    IS_REACT_ACT_ENVIRONMENT: true,
    setTimeout: ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
      if (delay === 750 || delay === 5000) { const id = nextTimerId++; timers.set(id, () => callback(...args)); return id; }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout,
    clearTimeout: ((id: ReturnType<typeof setTimeout>) => {
      if (!timers.delete(Number(id))) realClearTimeout(id);
    }) as typeof clearTimeout,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let root: Root | undefined;
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    window.localStorage.setItem(keys.active, 'old-client-key'); window.localStorage.setItem(keys.thread, initial.id);
    prepare?.(window.localStorage);
    const { createRoot } = await import('react-dom/client');
    const { useScriptConversation } = await import('../apps/web/src/features/script/useScriptConversation');
    const ScriptLibrary = options.page ? (await import('../apps/web/src/features/script/ScriptLibrary')).ScriptLibrary : null;
    function Harness({ initialInput = '' }: { initialInput?: string }) {
      const [messages, setMessages] = useState<ChatMessage[]>([]), [input, setInput] = useState(initialInput);
      const [actionErrors, setActionErrors] = useState<string[]>([]);
      const hook = useScriptConversation([], setMessages, setInput);
      const invoke = (action: string) => {
        const operation = action === 'send' ? () => hook.send(input, ['fixture-skill'], '{{conversation}}{{taskContract}}')
          : action === 'reset' ? hook.reset : action === 'reconcile' ? hook.reconcile : hook.refresh;
        void operation().catch(error => setActionErrors(old => [...old, error.message]));
      };
      const snapshot: HookSnapshot = { id: hook.conversation?.id || null, version: hook.conversation?.version ?? null,
        mode: hook.mode, pending: hook.pending, canReset: hook.canReset, needsReconcile: hook.needsReconcile,
        goalWorking: hook.goalWorking, goalNeedsReconcile: hook.goalNeedsReconcile,
        error: hook.error, input, messages, actionErrors };
      return React.createElement('div', null,
        React.createElement('input', { 'aria-label': '创作消息', value: input, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setInput(event.target.value) }),
        ...['send', 'reset', 'reconcile', 'refresh'].map(action => React.createElement('button', { key: action, 'data-action': action, onClick: () => invoke(action) }, action)),
        React.createElement('output', { id: 'hook-state' }, JSON.stringify(snapshot)));
    }
    const flush = async () => { await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); };
    const unmount = async () => { if (root) { await act(async () => { root!.unmount(); }); root = undefined; } };
    const remount = async (initialInput = '') => {
      await unmount(); root = createRoot(document.getElementById('root')!);
      await act(async () => { root!.render(ScriptLibrary
        ? React.createElement(ScriptLibrary, { projects: [], error: '', onOpen: () => { throw new Error('Unexpected page navigation'); },
          onCreate: async () => { throw new Error('Unexpected project creation'); } })
        : React.createElement(Harness, { initialInput })); }); await flush();
    };
    const session: Session = { http, window, document, storage: window.localStorage,
      snapshot: () => JSON.parse(document.getElementById('hook-state')!.textContent!), flush, unmount, remount,
      click: async action => {
        const element = options.page
          ? Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === action)
          : document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
        assert.ok(element, `Missing action ${action}`); await act(async () => { element.click(); }); await flush();
      },
      type: async text => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="创作消息"]')!;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        await act(async () => { setter.call(input, text); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
        assert.equal(session.snapshot().input, text, 'the real React input handler must receive the typed message');
      },
      poll: async () => {
        const entry = timers.entries().next().value as [number, () => void] | undefined;
        assert.ok(entry, 'the real hook must schedule its next poll'); timers.delete(entry[0]);
        await act(async () => { entry[1](); }); await flush();
      },
    };
    await remount(); await execute(session);
  } finally {
    try { if (root) await act(async () => { root!.unmount(); }); }
    finally { window.close(); for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } }
  }
}
async function settle(session: Session, action: () => void) { await act(async () => { action(); }); await session.flush(); }
const unknownMessage = { threadId: 'thread-old', body: { requestId: 'unknown-send-1', expectedVersion: 7,
  text: '接收结果未知的旧消息', methodIds: [], template: '{{conversation}}{{taskContract}}', intent: 'AUTO', executionChannel: 'api' } };

test('RECONCILIATION_REQUIRED can restart through the cancellation endpoint and select an empty new conversation', { concurrency: false }, async () => {
  await withHook(conversation('thread-old', 7, 'RECONCILIATION_REQUIRED'), async session => {
    assert.equal(session.snapshot().needsReconcile, true); assert.equal(session.snapshot().canReset, true);
    await session.type('尚未发送的输入'); await session.click('reset');
    const restart = session.http.matching('/restart'); assert.equal(restart.length, 1);
    assert.equal(restart[0].method, 'POST'); assert.equal(restart[0].body!.expectedVersion, 7);
    assert.deepEqual(Object.keys(restart[0].body!).sort(), ['clientKey', 'expectedVersion', 'requestId']);
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.deepEqual(session.snapshot().messages, []);
    assert.equal(session.snapshot().input, ''); assert.equal(session.snapshot().needsReconcile, false);
    assert.equal(session.storage.getItem(keys.active), restart[0].body!.clientKey);
    assert.equal(session.storage.getItem(keys.thread), 'thread-new-1'); assert.equal(session.storage.getItem(keys.restart), null);
    assert.equal(session.http.calls.some(call => call.path === '/api/script-assistant/conversations'), false,
      'reset must cancel through restart rather than merely open an unrelated conversation');
    assert.equal(session.http.conversations.get('thread-old')!.turns[0].input.text, '旧创作要求');
  });
});

test('an active remote turn does not prevent an explicit restart once no local HTTP mutation is in flight', { concurrency: false }, async () => {
  await withHook(conversation('thread-old', 7, 'RUNNING'), async session => {
    assert.equal(session.snapshot().pending, true); assert.equal(session.snapshot().canReset, true);
    await session.click('reset'); assert.equal(session.snapshot().id, 'thread-new-1');
    assert.equal(session.snapshot().pending, false); assert.equal(session.http.matching('/restart').length, 1);
  });
});

test('an unknown send receipt can be abandoned without re-sending it, and pointers change only after restart confirmation', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    session.http.handler = call => { if (call.path.endsWith('/messages')) throw new TypeError('模拟丢失消息回执'); };
    await session.type('发送后丢失回执'); await session.click('send');
    const pending = JSON.parse(session.storage.getItem(keys.pending)!);
    assert.equal(pending.body.text, '发送后丢失回执'); assert.equal(session.snapshot().canReset, true);
    const response = deferred<unknown>();
    session.http.handler = call => call.path.endsWith('/restart') ? response.promise : undefined;
    await session.click('reset'); const receipt = JSON.parse(session.storage.getItem(keys.restart)!);
    assert.equal(receipt.pendingRequestId, pending.body.requestId);
    assert.equal(session.storage.getItem(keys.active), 'old-client-key'); assert.equal(session.storage.getItem(keys.thread), 'thread-old');
    assert.equal(session.storage.getItem(keys.pending), JSON.stringify(pending));
    await session.click('send'); await session.click('reset');
    assert.equal(session.http.matching('/messages').length, 1); assert.equal(session.http.matching('/restart').length, 1);
    assert.equal(session.http.maxConcurrentMutations, 1);
    await settle(session, () => response.resolve(session.http.answer(session.http.matching('/restart')[0])));
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.equal(session.storage.getItem(keys.pending), null);
    assert.equal(session.storage.getItem(keys.restart), null); assert.equal(session.snapshot().input, '');
    await session.type('新对话第一条消息'); await session.click('send');
    const calls = session.http.matching('/messages'); assert.equal(calls[1].path, '/api/script-assistant/conversations/thread-new-1/messages');
    assert.equal(calls[1].body!.expectedVersion, 1); assert.equal(session.snapshot().messages[0].text, '新对话第一条消息');
  });
});

test('a lost restart receipt survives refresh and replays the exact restart before any abandoned send', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    session.http.handler = call => { if (call.path.endsWith('/messages')) throw new TypeError('模拟未知发送结果'); };
    await session.type('旧消息'); await session.click('send');
    session.http.handler = call => { if (call.path.endsWith('/restart')) { session.http.answer(call); throw new TypeError('模拟重开已完成但回执丢失'); } };
    await session.click('reset');
    const receipt = JSON.parse(session.storage.getItem(keys.restart)!); assert.ok(session.storage.getItem(keys.pending));
    assert.equal(session.storage.getItem(keys.thread), 'thread-old');
    const replay = deferred<unknown>();
    session.http.handler = call => call.path.endsWith('/restart') ? replay.promise : undefined;
    await session.remount('刷新后输入');
    const restarts = session.http.matching('/restart'); assert.equal(restarts.length, 2);
    assert.deepEqual(restarts[1].body, restarts[0].body, 'request id, expected version and client key must all survive a reload');
    assert.deepEqual(restarts[1].body, receipt.body); assert.equal(session.http.matching('/messages').length, 1);
    await session.click('send'); await session.click('reset'); assert.equal(session.http.matching('/restart').length, 2);
    assert.equal(session.http.maxConcurrentMutations, 1);
    await settle(session, () => replay.resolve(session.http.answer(restarts[1])));
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.deepEqual(session.snapshot().messages, []);
    assert.equal(session.storage.getItem(keys.active), receipt.body.clientKey); assert.equal(session.storage.getItem(keys.thread), 'thread-new-1');
    assert.equal(session.storage.getItem(keys.pending), null); assert.equal(session.storage.getItem(keys.restart), null);
    session.http.handler = undefined; await session.remount();
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.equal(session.http.matching('/restart').length, 2);
    assert.equal(session.http.matching('/messages').length, 1, 'a second reload must not replay a confirmed restart or the abandoned message');
  });
});

test('mount follows another tab\'s retired thread and clears only its matching old receipt without replaying old messages', { concurrency: false }, async () => {
  for (const scenario of ['active-pointer', 'old-pending', 'replaced-pending']) await withHook(conversation(), async session => {
    await session.unmount();
    session.http.conversations.get('thread-old')!.restartedTo = 'fresh';
    session.http.conversations.set('fresh', { id: 'fresh', version: 4, seed: [{ role: 'ai', text: '新对话内容' }], turns: [] });
    session.storage.setItem(keys.active, 'fresh-client-key'); session.storage.setItem(keys.thread, 'thread-old');
    if (scenario !== 'active-pointer') session.storage.setItem(keys.pending, JSON.stringify(unknownMessage));
    const freshResponse = deferred<unknown>();
    session.http.handler = call => call.path === '/api/script-assistant/conversations/fresh' ? freshResponse.promise : undefined;
    const callsBeforeMount = session.http.calls.length;
    const initialInput = scenario === 'old-pending' ? unknownMessage.body.text : '另写的未发送输入';
    await session.remount(initialInput);
    assert.deepEqual(session.http.calls.slice(callsBeforeMount).map(call => call.path), [
      '/api/script-assistant/features', '/api/script-assistant/conversations/thread-old', '/api/script-assistant/conversations/fresh',
    ]);
    assert.equal(session.storage.getItem(keys.thread), 'thread-old', 'the pointer must wait for the fresh thread response');
    const newer = { threadId: 'fresh', body: { ...unknownMessage.body, requestId: 'fresh-request', expectedVersion: 4, text: '另一标签的新消息' } };
    if (scenario === 'replaced-pending') session.storage.setItem(keys.pending, JSON.stringify(newer));
    const getFresh = session.http.calls.find(call => call.path === '/api/script-assistant/conversations/fresh')!;
    await settle(session, () => freshResponse.resolve(session.http.answer(getFresh)));
    assert.equal(session.snapshot().mode, 'durable'); assert.equal(session.snapshot().id, 'fresh');
    assert.equal(session.snapshot().version, 4); assert.deepEqual(session.snapshot().messages, [{ role: 'ai', text: '新对话内容' }]);
    assert.equal(session.storage.getItem(keys.active), 'fresh-client-key'); assert.equal(session.storage.getItem(keys.thread), 'fresh');
    assert.equal(session.storage.getItem(keys.pending), scenario === 'replaced-pending' ? JSON.stringify(newer) : null,
      'retired-thread recovery must not delete a newer receipt written while the fresh GET was pending');
    assert.equal(session.snapshot().input, scenario === 'old-pending' ? '' : initialInput,
      'only input matching the abandoned old receipt may be cleared');
    assert.equal(session.http.matching('/messages').length, 0); assert.equal(session.http.matching('/restart').length, 0);
  });
});

test('an unresolved restart blocks old-message send and reconcile before refresh, while reset reuses its exact receipt', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    session.http.handler = call => { if (call.path.endsWith('/messages')) throw new TypeError('模拟消息回执丢失'); };
    await session.type('旧消息'); await session.click('send');
    session.http.handler = call => { if (call.path.endsWith('/restart')) { session.http.answer(call); throw new TypeError('模拟重开回执丢失'); } };
    await session.click('reset');
    const receipt = JSON.parse(session.storage.getItem(keys.restart)!);
    session.http.handler = undefined;
    await session.click('send'); await session.click('reconcile');
    assert.equal(session.http.matching('/messages').length, 1, 'a persisted restart receipt must prevent replay of the abandoned message before reload');
    assert.equal(session.storage.getItem(keys.restart), JSON.stringify(receipt));
    await session.click('reset');
    const restarts = session.http.matching('/restart'); assert.equal(restarts.length, 2);
    assert.deepEqual(restarts[1].body, receipt.body); assert.equal(session.snapshot().id, 'thread-new-1');
    assert.equal(session.storage.getItem(keys.pending), null); assert.equal(session.storage.getItem(keys.restart), null);
  });
});

test('a late old-thread poll cannot restore old messages, goal locks or errors after restart', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    const oldConversation = deferred<unknown>(), oldRuns = deferred<unknown>();
    session.http.handler = call => call.path === '/api/script-assistant/conversations/thread-old' ? oldConversation.promise
      : call.path.startsWith('/api/script-runs?threadId=thread-old') ? oldRuns.promise : undefined;
    await session.poll(); await session.click('reset'); assert.equal(session.snapshot().id, 'thread-new-1');
    const stale = conversation('thread-old', 999, 'RECONCILIATION_REQUIRED');
    await settle(session, () => { oldConversation.resolve({ conversation: stale }); oldRuns.resolve({ runs: [{
      run: run('old-goal', 'thread-old', 'RUNNING', 'GOAL'), workspaceId: 'old-workspace', goalId: 'old-goal',
    }] }); });
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.deepEqual(session.snapshot().messages, []);
    assert.equal(session.snapshot().goalWorking, false); assert.equal(session.snapshot().goalNeedsReconcile, false);
    assert.equal(session.snapshot().needsReconcile, false); assert.equal(session.snapshot().error, '');
    session.http.handler = undefined; await session.poll();
    assert.ok(session.http.calls.some(call => call.path === '/api/script-runs?threadId=thread-new-1&view=state'));
    await session.type('新对话可以继续'); await session.click('send');
    assert.equal(session.snapshot().messages[0].text, '新对话可以继续');
  });
});

test('a failed old poll that returns after restart cannot put an error on the new conversation', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    const oldPoll = deferred<unknown>();
    session.http.handler = call => call.path === '/api/script-assistant/conversations/thread-old' ? oldPoll.promise : undefined;
    await session.poll(); await session.click('reset');
    await settle(session, () => oldPoll.reject(new Error('迟到的旧对话轮询错误')));
    assert.equal(session.snapshot().id, 'thread-new-1'); assert.equal(session.snapshot().error, '');
  });
});

test('initial send recovery and normal sends serialize local mutations and preserve confirmed ordering', { concurrency: false }, async () => {
  await withHook(conversation(), async session => {
    // Start recovery through the real mount path, with the exact durable pending command.
    await session.unmount(); session.storage.setItem(keys.pending, JSON.stringify(unknownMessage));
    const response = deferred<unknown>(); session.http.handler = call => call.path.endsWith('/messages') ? response.promise : undefined;
    await session.remount('不能并发的新输入');
    assert.equal(session.http.matching('/messages').length, 1);
    await session.click('send'); await session.click('reset');
    assert.equal(session.http.matching('/messages').length, 1); assert.equal(session.http.matching('/restart').length, 0);
    assert.equal(session.snapshot().input, '不能并发的新输入');
    const recovered = session.http.matching('/messages')[0]; assert.deepEqual(recovered.body, unknownMessage.body);
    await settle(session, () => response.resolve(session.http.answer(recovered)));
    assert.equal(session.storage.getItem(keys.pending), null); assert.equal(session.snapshot().input, '不能并发的新输入');
    const next = deferred<unknown>(); session.http.handler = call => call.path.endsWith('/messages') ? next.promise : undefined;
    await session.click('send'); await session.type('下一条仍在输入'); await session.click('send'); await session.click('reset');
    assert.equal(session.http.matching('/messages').length, 2); assert.equal(session.http.matching('/restart').length, 0);
    const second = session.http.matching('/messages')[1]; assert.equal(second.body!.expectedVersion, 8);
    await settle(session, () => next.resolve(session.http.answer(second)));
    assert.equal(session.snapshot().input, '下一条仍在输入');
    session.http.handler = undefined; await session.click('send');
    assert.equal(session.http.matching('/messages')[2].body!.expectedVersion, 9);
    assert.deepEqual(session.snapshot().messages.filter(message => message.role === 'user').map(message => message.text),
      ['接收结果未知的旧消息', '不能并发的新输入', '下一条仍在输入']);
    assert.equal(session.http.maxConcurrentMutations, 1);
  });
});

test('unmounted send success or failure cannot clear a newer pending command or affect a newly mounted conversation', { concurrency: false }, async () => {
  for (const fail of [false, true]) await withHook(conversation(), async session => {
    const response = deferred<unknown>(); session.http.handler = call => call.path.endsWith('/messages') ? response.promise : undefined;
    await session.type('旧组件发出的消息'); await session.click('send'); const oldSend = session.http.matching('/messages')[0];
    await session.unmount();
    const newer = { ...unknownMessage, threadId: 'thread-new-tab', body: { ...unknownMessage.body, requestId: 'new-tab-request', text: '新页面输入' } };
    session.http.conversations.set('thread-new-tab', { id: 'thread-new-tab', version: 7, seed: [], turns: [] });
    session.storage.setItem(keys.thread, 'thread-new-tab'); session.storage.setItem(keys.active, 'new-tab-client');
    // Emulate another tab's confirmed restart receipt. Mounting only reads this selected thread;
    // no second HTTP mutation is sent while the old transport is still completing.
    session.storage.removeItem(keys.pending);
    await session.remount('新页面未发送输入');
    assert.equal(session.snapshot().id, 'thread-new-tab');
    session.storage.setItem(keys.pending, JSON.stringify(newer));
    await settle(session, () => fail ? response.reject(new Error('旧组件迟到失败')) : response.resolve(session.http.answer(oldSend)));
    assert.equal(session.storage.getItem(keys.pending), JSON.stringify(newer), 'an old callback must not delete a newer request receipt');
    assert.equal(session.snapshot().id, 'thread-new-tab'); assert.equal(session.snapshot().error, '');
    assert.deepEqual(session.snapshot().messages, []); assert.equal(session.snapshot().input, '新页面未发送输入');
    const newResponse = deferred<unknown>(); session.http.handler = call => call.path.endsWith('/messages') ? newResponse.promise : undefined;
    await session.remount('新页面未发送输入');
    assert.equal(session.snapshot().id, 'thread-new-tab'); assert.equal(session.snapshot().error, '');
    assert.deepEqual(session.snapshot().messages, []); assert.equal(session.snapshot().input, '新页面未发送输入');
    await settle(session, () => newResponse.resolve(session.http.answer(session.http.matching('/messages')[1])));
    assert.equal(session.snapshot().id, 'thread-new-tab'); assert.equal(session.snapshot().input, '新页面未发送输入');
    assert.equal(session.http.maxConcurrentMutations, 1);
  });
});

test('reconcile reads each unresolved run from the existing run API and submits its fresh version once', { concurrency: false }, async () => {
  await withHook(conversation('thread-old', 7, 'RECONCILIATION_REQUIRED'), async session => {
    // The same GOAL run appears in both the turn and activity list: reconcile it once.
    session.http.runs.set('run-old', run('run-old', 'thread-old', 'RECONCILIATION_REQUIRED', 'GOAL', 31));
    session.http.runs.set('goal-unresolved', run('goal-unresolved', 'thread-old', 'RECONCILIATION_REQUIRED', 'GOAL', 45));
    await session.click('reconcile');
    const reconcileCalls = session.http.matching('/reconcile'); assert.equal(reconcileCalls.length, 2);
    assert.deepEqual(reconcileCalls.map(call => [call.path, call.body!.expectedVersion]), [
      ['/api/agent/runs/run-old/reconcile', 31], ['/api/agent/runs/goal-unresolved/reconcile', 45],
    ]);
    for (const call of reconcileCalls) {
      const prefix = call.path.replace(/\/reconcile$/, '');
      const freshIndex = session.http.calls.findIndex(value => value.path === `${prefix}?view=state`);
      assert.ok(freshIndex >= 0 && freshIndex < session.http.calls.indexOf(call)); assert.ok(call.body!.requestId);
    }
    assert.equal(session.http.matching('/restart').length, 0); assert.equal(session.http.matching('/messages').length, 0);
    assert.equal(session.snapshot().needsReconcile, false); assert.equal(session.snapshot().error, '');
    assert.ok(session.snapshot().messages.some(message => message.text === '已核对旧请求返回'));
    assert.equal(session.http.maxConcurrentMutations, 1);
  });
});

test('missing reconciliation evidence retains the old conversation and still allows explicit restart', { concurrency: false }, async () => {
  await withHook(conversation('thread-old', 7, 'RECONCILIATION_REQUIRED'), async session => {
    session.http.runs.set('run-old', run('run-old', 'thread-old', 'RECONCILIATION_REQUIRED'));
    session.http.handler = call => call.path.endsWith('/reconcile')
      ? new Response(JSON.stringify({ code: 'EVIDENCE_MISSING', error: '证据还未到达' }), { status: 409 }) : undefined;
    await session.click('reconcile');
    assert.match(session.snapshot().error, /尚未收到可核对的返回/); assert.equal(session.snapshot().needsReconcile, true);
    assert.equal(session.snapshot().id, 'thread-old'); assert.equal(session.snapshot().canReset, true);
    await session.click('reset'); assert.equal(session.snapshot().id, 'thread-new-1');
  });
});

test('the real ScriptLibrary restart button keeps an unknown conversation on cancel and restarts it on confirmation', { concurrency: false }, async () => {
  const draftKey = 'omni.script.ideation.v1';
  await withHook(conversation('thread-old', 7, 'RECONCILIATION_REQUIRED'), async session => {
    const button = Array.from(session.document.querySelectorAll('button')).find(element => element.textContent?.trim() === '清空重来');
    assert.ok(button, 'the real page must render the restart button while the old result is unknown');
    assert.equal(button.disabled, false, 'RECONCILIATION_REQUIRED must not disable the page restart action');
    const input = session.document.querySelector<HTMLTextAreaElement>('textarea[aria-label="给 AI 的消息"]');
    assert.ok(input); assert.equal(input.value, '保留的当前输入');
    assert.match(session.document.querySelector('main')!.textContent!, /旧创作要求/);
    assert.match(session.document.querySelector('main')!.textContent!, /上次请求已发送/);
    const beforeCancel = session.storage.getItem(draftKey);
    let confirm = false; const prompts: string[] = [];
    session.window.confirm = message => { prompts.push(String(message)); return confirm; };
    await session.click('清空重来');
    assert.equal(prompts.length, 1); assert.match(prompts[0], /停止当前对话并重新开始/);
    assert.match(prompts[0], /旧对话及已有成果会保留/);
    assert.equal(session.http.matching('/restart').length, 0); assert.equal(session.http.matching('/messages').length, 0);
    assert.equal(session.storage.getItem(keys.thread), 'thread-old'); assert.equal(session.storage.getItem(keys.active), 'old-client-key');
    assert.equal(session.storage.getItem(draftKey), beforeCancel, 'cancel must preserve the page conversation and input cache');
    assert.equal(input.value, '保留的当前输入'); assert.match(session.document.querySelector('main')!.textContent!, /旧创作要求/);

    confirm = true; await session.click('清空重来');
    assert.equal(prompts.length, 2);
    const restarts = session.http.matching('/restart'); assert.equal(restarts.length, 1);
    assert.equal(restarts[0].path, '/api/script-assistant/conversations/thread-old/restart');
    assert.equal(restarts[0].body!.expectedVersion, 7);
    assert.equal(session.storage.getItem(keys.thread), 'thread-new-1'); assert.equal(session.storage.getItem(keys.active), restarts[0].body!.clientKey);
    assert.equal(session.storage.getItem(keys.restart), null); assert.equal(session.http.matching('/messages').length, 0);
    assert.equal(input.value, '');
    const currentDraft = JSON.parse(session.storage.getItem(draftKey)!);
    assert.deepEqual(currentDraft.chatMessages, []); assert.equal(currentDraft.inputText, '');
    const currentPage = session.document.querySelector('main')!.textContent!;
    assert.doesNotMatch(currentPage, /旧创作要求|旧对话种子|上次请求已发送/);
    assert.ok(!Array.from(session.document.querySelectorAll('button')).some(element => element.textContent?.trim() === '清空重来'),
      'the new empty conversation must not retain the old message header');
  }, storage => storage.setItem(draftKey, JSON.stringify({ mode: 'interview', inputText: '保留的当前输入', chatMessages: [], selectedSkillIds: [] })),
  { page: true });
});
