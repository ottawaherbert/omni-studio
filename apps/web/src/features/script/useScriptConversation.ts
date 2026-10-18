import type { ScriptStage } from '../../../../../packages/script/src/agentStages';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage } from '../../../../../packages/script/src/ideation';
import { scriptConversationClient as client, type ScriptConversationView } from '../../clients/scriptConversationClient';

import { scriptAgentClient } from '../../clients/scriptClient';
import { goalActiveMessage, goalUnresolvedMessage, isUnresolvedGoal, isWorkingGoal, pauseThreadGoals } from './scriptGoalControl';

const activeKey = 'omni.script.conversation.active.v1';
const activeThreadKey = 'omni.script.conversation.thread.v1';
const pendingKey = 'omni.script.conversation.pending.v1';
const restartKey = 'omni.script.conversation.restart.v1';
const activeStatuses = ['QUEUED', 'RUNNING', 'WAITING_STEP', 'WAITING_EXTERNAL'];
type PendingCommand = { threadId: string; body: Parameters<typeof client.send>[1] };
type PendingRestart = { threadId: string; body: Parameters<typeof client.restart>[1]; pendingRequestId?: string };
const readRestart = (): PendingRestart | null => {
  const saved = localStorage.getItem(restartKey);
  if (!saved) return null;
  const value = JSON.parse(saved);
  if (!value?.threadId || !value.body?.requestId || !value.body?.clientKey || !Number.isSafeInteger(value.body.expectedVersion)) throw new Error('重新开始的本地记录无法读取，请保留浏览器数据。');
  return value;
};
const clearRestart = (command: PendingRestart) => {
  if (readRestart()?.body.requestId === command.body.requestId) localStorage.removeItem(restartKey);
};
const readPending = (): PendingCommand | null => {
  const saved = localStorage.getItem(pendingKey);
  if (!saved) return null;
  const value = JSON.parse(saved);
  if (!value?.threadId || !value.body?.requestId || typeof value.body.text !== 'string') throw new Error('未确认消息的本地记录无法读取，请保留浏览器数据。');
  return value;
};
const clearPending = (command: PendingCommand) => {
  if (readPending()?.body.requestId === command.body.requestId) localStorage.removeItem(pendingKey);
};
export function useScriptConversation(seed: ChatMessage[], showMessages: (messages: ChatMessage[]) => void, restoreInput: Dispatch<SetStateAction<string>>) {
  const [goalWorking,setGoalWorking]=useState(false),[goalNeedsReconcile,setGoalNeedsReconcile]=useState(false);
  const [mode, setMode] = useState<'loading' | 'legacy' | 'durable' | 'error'>('loading');
  const [conversationView,setConversationView]=useState<ScriptConversationView|null>(null);
  const [pending, setPending] = useState(false), [switching, setSwitching] = useState(false), [error, setError] = useState('');
  const current = useRef<ScriptConversationView | null>(null), alive = useRef(false), version = useRef(0), mutation = useRef(false);
  const generation = useRef(0);
  const lastMessages = useRef('');
  const seedRef = useRef(seed), showRef = useRef(showMessages), inputRef = useRef(restoreInput);
  showRef.current = showMessages; inputRef.current = restoreInput;
  const apply = (conversation: ScriptConversationView) => {
    if (!alive.current || (current.current && conversation.id !== current.current.id) || conversation.version < version.current) return;
    current.current = conversation; version.current = conversation.version;setConversationView(conversation);
    const messages: ChatMessage[] = [...conversation.seed];
    for (const turn of conversation.turns) {
      messages.push({ role: 'user', text: turn.input.text });
      if (turn.response) messages.push({ ...turn.response, role: 'ai' });
      else if (!activeStatuses.includes(turn.status)) messages.push({ role: 'ai', text: turn.status === 'RECONCILIATION_REQUIRED' ? '上次请求已发送，但尚未收到可确认的结果。可以核对返回，或清空重来开始新对话；旧记录会保留。' : turn.status === 'NEEDS_REBASE' ? '本次使用的资料已变化，原消息已保留。' : turn.errorMessage || '本次回复未完成，原消息已保留。', isError: true, ...(turn.status === 'RECONCILIATION_REQUIRED' ? {} : { retryKind: turn.input.intent === 'BLUEPRINT' ? 'blueprint' as const : turn.input.intent === 'AGENT' ? 'agent' as const : 'chat' as const }) });
    }
    const serialized = JSON.stringify(messages);
    if (lastMessages.current !== serialized) { lastMessages.current = serialized; showRef.current(messages); }
    setPending(conversation.turns.some(turn => activeStatuses.includes(turn.status)));
    setError(conversation.restartedTo?'旧对话已停止。请再次点击清空重来，或刷新进入新对话。':'');
  };
  const finishRestart = (command: PendingRestart, conversation: ScriptConversationView) => {
    localStorage.setItem(activeKey, command.body.clientKey);
    localStorage.setItem(activeThreadKey, conversation.id);
    const pendingCommand = readPending();
    if (pendingCommand?.threadId === command.threadId && pendingCommand.body.requestId === command.pendingRequestId) clearPending(pendingCommand);
    clearRestart(command);
    current.current = null; version.current = 0; lastMessages.current = '';
    setGoalWorking(false); setGoalNeedsReconcile(false);
    apply(conversation); inputRef.current('');
  };
  useEffect(() => {
    alive.current = true;
    mutation.current=false;setSwitching(false);setMode('loading');
    let canceled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (canceled || !alive.current || !current.current) return;
      const threadId=current.current.id, epoch=generation.current;
      try { const [result, activity] = await Promise.all([client.get(threadId),scriptAgentClient.runs(threadId)]); if (!canceled && epoch===generation.current && current.current?.id===threadId) {apply(result.conversation);setGoalWorking(activity.runs.some(({run})=>isWorkingGoal(run)));setGoalNeedsReconcile(activity.runs.some(({run})=>isUnresolvedGoal(run)));} }
      catch (e) { if (!canceled && alive.current && epoch===generation.current && current.current?.id===threadId) setError((e as Error).message); }
      if (!canceled && alive.current) timer = setTimeout(poll, current.current?.turns.some(turn => activeStatuses.includes(turn.status)) ? 750 : 5000);
    };
    void (async () => {
      try {
        if (!await client.available()) { if (!canceled && alive.current) setMode('legacy'); return; }
        if (canceled) return;
        // A pending receipt takes precedence over another tab's selected thread.
        // Recover the exact original command instead of stranding or resending it.
        const restarting=readRestart(), command = readPending(), threadId = restarting?.threadId || command?.threadId || localStorage.getItem(activeThreadKey);
        let conversation = (threadId ? await client.get(threadId) : await client.open(seedRef.current, localStorage.getItem(activeKey) || 'script-home')).conversation;
        if (canceled || !alive.current) return;
        const retired=Boolean(conversation.restartedTo);
        // Another tab may have completed the restart while this tab still held
        // the original receipt. Never submit that receipt as a new model call.
        if(!restarting){
          let remaining=20;
          while(conversation.restartedTo){
            if(!remaining--)throw new Error('重新开始的对话记录无法读取，请保留浏览器数据。');
            conversation=(await client.get(conversation.restartedTo)).conversation;
            if(canceled||!alive.current)return;
          }
          if(retired&&command){clearPending(command);inputRef.current(text=>text===command.body.text?'':text);}
        }
        localStorage.setItem(activeThreadKey, conversation.id);
        setMode('durable'); apply(conversation);
        if (restarting) {
          mutation.current=true; setSwitching(true);
          const epoch=++generation.current;
          try {
            const result=await client.restart(restarting.threadId,restarting.body);
            if (canceled || !alive.current || epoch!==generation.current) return;
            finishRestart(restarting,result.conversation);
          } catch(e) {
            if(canceled || epoch!==generation.current)return;
            if((e as any).status===409)clearRestart(restarting);
            setError((e as Error).message);
          } finally {if(epoch===generation.current)mutation.current=false;if(!canceled)setSwitching(false);}
        } else if (command&&!retired) {
          mutation.current=true;
          const epoch=generation.current;
          try {
            const result = await client.send(conversation.id, command.body);
            if (canceled || epoch!==generation.current || current.current?.id!==command.threadId) return;
            apply(result.conversation); clearPending(command);
            inputRef.current(text => text === command.body.text ? '' : text);
          } catch (e) {
            if (canceled || epoch!==generation.current || current.current?.id!==command.threadId) return;
            inputRef.current(text => text || command.body.text);
            if ((e as any).status === 409) clearPending(command);
            setError((e as Error).message);
          } finally {if(epoch===generation.current)mutation.current=false;}
        }
        if (!canceled && alive.current) timer = setTimeout(poll, current.current?.turns.some(turn => activeStatuses.includes(turn.status)) ? 750 : 5000);
      } catch (e) { if (!canceled && alive.current) { setMode('error'); setError((e as Error).message); } }
    })();
    return () => { canceled = true; alive.current = false; generation.current++; if (timer) clearTimeout(timer); };
  }, []);
  const send = async (text: string, methodIds: string[], template: string, intent:'AUTO'|'AGENT'|'BLUEPRINT'='AUTO', executionChannel:'api'|'external'='api',stopAfter?:ScriptStage) => {
    if (mutation.current) throw new Error('上一项操作尚未完成，当前输入已保留。');
    if(readRestart())throw new Error('上次重新开始的结果尚未确认，请再次点击清空重来，或刷新恢复。');
    if (!current.current) throw new Error('对话尚未加载');
    if(current.current.restartedTo)throw new Error('这段对话已重新开始，请刷新进入新对话；当前输入已保留。');
    if (current.current.turns.some(turn => turn.status === 'RECONCILIATION_REQUIRED')) throw new Error('上次请求的结果尚未确定，请先核对返回，不能重复发送。');
    if (goalNeedsReconcile) throw new Error(goalUnresolvedMessage);
    if (goalWorking) throw new Error(goalActiveMessage);
    const old = readPending();
    if (old && (old.body.text !== text || old.threadId !== current.current.id)) throw new Error('上一条消息的接收结果尚未确认，请刷新恢复后继续；当前输入已保留。');
    const command = old || { threadId: current.current.id, body: { requestId: crypto.randomUUID(), expectedVersion: current.current.version, text, methodIds, template, intent, executionChannel,...(stopAfter?{stopAfter}:{}) } };
    localStorage.setItem(pendingKey, JSON.stringify(command)); mutation.current = true; setPending(true);
    const epoch=generation.current;
    try { const result = await client.send(command.threadId, command.body); if(alive.current&&epoch===generation.current&&current.current?.id===command.threadId){apply(result.conversation); clearPending(command);} }
    catch (e) { if ((e as any).status === 409) clearPending(command); if (alive.current&&epoch===generation.current&&current.current?.id===command.threadId) { setPending(false); setError((e as Error).message); } throw e; }
    finally { if(epoch===generation.current)mutation.current = false; }
  };
  const reset = async () => {
    if (mutation.current) throw new Error('上一项操作尚未完成，请稍后重试。');
    if(!current.current)throw new Error('对话尚未加载');
    const pendingCommand=readPending();
    if(pendingCommand&&pendingCommand.threadId!==current.current.id)throw new Error('另一对话有未确认消息，请刷新后核对。');
    const command=readRestart() || {threadId:current.current.id,body:{requestId:crypto.randomUUID(),expectedVersion:current.current.version,clientKey:crypto.randomUUID()},...(pendingCommand?{pendingRequestId:pendingCommand.body.requestId}:{})};
    localStorage.setItem(restartKey,JSON.stringify(command));
    const epoch=++generation.current;
    mutation.current = true; setSwitching(true);
    try {
      const result=await client.restart(command.threadId,command.body);
      if (!alive.current || epoch!==generation.current) return;
      finishRestart(command,result.conversation);
    } catch(e) {
      if((e as any).status===409)clearRestart(command);
      if(alive.current&&epoch===generation.current)setError((e as Error).message);
      throw e;
    } finally { if(epoch===generation.current)mutation.current = false; if (alive.current&&epoch===generation.current) setSwitching(false); }
  };
  const refresh=async()=>{if(!current.current)return;const result=await client.get(current.current.id);apply(result.conversation);};
  const pauseGoals=async()=>{
    if(readRestart())throw new Error('上次重新开始的结果尚未确认，请再次点击清空重来，或刷新恢复。');
    if(mutation.current||pending||readPending())throw new Error('当前消息尚未确认，请等待回复后切换；输入已保留。');
    if(!current.current)throw new Error('对话尚未加载，请稍后重试。');
    mutation.current=true;setSwitching(true);
    try{await pauseThreadGoals(current.current.id);setGoalWorking(false);}finally{mutation.current=false;setSwitching(false);}
  };
  const reconcile=async()=>{
    if(mutation.current)throw new Error('上一项操作尚未完成，请稍后重试。');
    if(readRestart())throw new Error('上次重新开始的结果尚未确认，请再次点击清空重来，或刷新恢复。');
    if(!current.current)throw new Error('对话尚未加载');
    const threadId=current.current.id,epoch=generation.current;
    mutation.current=true;setSwitching(true);
    try{
      const command=readPending();
      if(command){
        if(command.threadId!==threadId)throw new Error('另一对话有未确认消息，请刷新后核对。');
        const received=await client.send(threadId,command.body);
        if(epoch!==generation.current||current.current?.id!==threadId)return;
        apply(received.conversation);clearPending(command);
      }
      const [{conversation},{runs}]=await Promise.all([client.get(threadId),scriptAgentClient.runs(threadId)]);
      const runIds=new Set([...conversation.turns.filter(turn=>turn.status==='RECONCILIATION_REQUIRED').map(turn=>turn.runId),...runs.filter(({run})=>isUnresolvedGoal(run)).map(({run})=>run.id)]);
      for(const runId of runIds){const {run}=await scriptAgentClient.run(runId);if(run.status==='RECONCILIATION_REQUIRED')await scriptAgentClient.reconcile(run);}
      if(alive.current&&epoch===generation.current&&current.current?.id===threadId){await refresh();setGoalNeedsReconcile(false);}
    }catch(e){
      const message=(e as any).code==='EVIDENCE_MISSING'?'尚未收到可核对的返回。可以继续等待，或清空重来开始新对话；旧记录会保留。':(e as Error).message;
      if(alive.current&&epoch===generation.current)setError(message);
      throw new Error(message);
    }finally{if(epoch===generation.current)mutation.current=false;if(alive.current&&epoch===generation.current)setSwitching(false);}
  };
  return { goalWorking, goalNeedsReconcile, pauseGoals, mode, pending: pending || switching, canReset:mode==='durable'&&!mutation.current&&!switching, needsReconcile:goalNeedsReconcile||Boolean(conversationView?.turns.some(turn=>turn.status==='RECONCILIATION_REQUIRED')), error, send, reset, reconcile, refresh, conversation:conversationView };
}
