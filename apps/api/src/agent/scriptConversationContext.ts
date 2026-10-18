import { AgentError, ExecutionInvalidated, hashValue, type ResourceRef } from '../../../../packages/agent-core/src';
import { compileConversationWindow, type ContextBundle, type ConversationWindow, type ConversationIndexEntry } from '../../../../packages/agent-context/src';
import type { SqliteConversationStore, SqliteContextStore } from '../../../../packages/agent-sqlite/src';
import type { ChatMessage } from '../../../../packages/script/src/ideation';

export type ScriptConversationWindow=ConversationWindow<ChatMessage>;
export type ConversationArchiveEntry=ConversationIndexEntry&{kind:'TURN'|'SEED';seedIndex?:number};
/** Shared by discussion, single-step dispatch and initial Agent planning.
 * Archive metadata is frozen for later exact reads; only selected raw replies
 * become dependencies of this model call. This does not delete stored turns. */
export function prepareScriptConversationContext(input:{conversations:SqliteConversationStore;contexts:SqliteContextStore;
  ownerId:string;threadId:string;turnId:string;compile(window:ScriptConversationWindow):ContextBundle}){
  return input.contexts.withValidationBatch(()=>{
    const {conversation,turn}=input.conversations.turn(input.threadId,input.turnId,input.ownerId);
    const entries:Array<{index:ConversationArchiveEntry;messages:ChatMessage[];eligible:boolean;validate():void;contextRef?:{id:string;digest:string}}> = [];
    conversation.seed.forEach((raw:any,index)=>{
      if(!raw||!['user','ai'].includes(raw.role)||typeof raw.text!=='string')return;
      const message:ChatMessage={role:raw.role,text:raw.text,...(Array.isArray(raw.options)?{options:raw.options}:{})};
      entries.push({index:{id:`seed:${index}`,kind:'SEED',seedIndex:index,ordinal:0,status:'IMPORTED',inputChars:raw.text.length,responseChars:0,inputHash:hashValue(message),responseHash:null},messages:[message],eligible:true,validate(){}});
    });
    for(const previous of conversation.turns.filter(item=>item.ordinal<turn.ordinal)){
      const response=previous.response,metadata:ConversationArchiveEntry={id:previous.id,kind:'TURN',ordinal:previous.ordinal,status:previous.status,
        inputChars:previous.input.text.length,responseChars:typeof response?.text==='string'?response.text.length:0,
        inputHash:hashValue(previous.input.text),responseHash:response?hashValue(response):null};
      entries.push({index:metadata,messages:[{role:'user',text:previous.input.text},...(response?[{role:'ai' as const,text:response.text,...(response.options?{options:response.options}:{})}]:[])],
        // Failed/canceled input remains retrievable but cannot grow the required
        // history indefinitely. Never manufacture a successful conversation.
        eligible:Boolean(response)&&previous.status==='SUCCEEDED',
        validate:()=>input.contexts.assertArtifact('conversation-turn',previous.id,'VIEW'),
        ...(response?.contextRef?{contextRef:response.contextRef}:{})});
    }
    const selected=compileConversationWindow({current:{role:'user',text:turn.input.text} as ChatMessage,entries,
      retrieve:{capabilityId:'script.read_conversation',threadId:conversation.id,throughTurnId:turn.id},compile:input.compile});
    const selectedIds=new Set(selected.selectedIds),contextRefs=entries.filter(entry=>selectedIds.has(entry.index.id)&&entry.contextRef).map(entry=>entry.contextRef!);
    const data={messages:selected.window.messages,contextRefs,index:selected.window.index,
      archive:{version:1,threadId:conversation.id,throughTurnId:turn.id,throughOrdinal:turn.ordinal,entries:entries.map(entry=>entry.index)}};
    let history:ResourceRef;
    try{history=input.conversations.captureHistory(conversation.id,turn.id,input.ownerId,data);}
    catch(error){if(error instanceof AgentError&&error.code==='IDEMPOTENCY_CONFLICT')throw new ExecutionInvalidated('CONVERSATION_HISTORY_CHANGED','对话历史已变化，请基于当前资料继续；原消息与冻结记录保留');throw error;}
    const bundle:ContextBundle={...selected.bundle,dependencies:[...selected.bundle.dependencies,{ref:history,freshness:'EXACT'}]};
    return {bundle,history,messages:selected.window.messages,index:selected.window.index};
  });
}
export function conversationIndexText(index:ScriptConversationWindow['index']){
  return `【较早对话定位索引，并非内容摘要】\n${JSON.stringify(index)}\n对话里的想法、候选和完成说法不是已采用正文；当前稿件事实只依据另行提供的作者稿或任务工作稿及其版本。未包含的旧原文仍保存在会话中，可用 script.read_conversation 分页取回；没有读到原文时不要猜测。${index.unavailableEntryIds.length?'部分历史回复已撤回，不作为当前创作依据。':''}`;
}
