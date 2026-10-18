import { AgentError } from '../../agent-core/src';
import type { ContextBundle } from './types';

export type ConversationIndexEntry={id:string;ordinal:number;status:string;inputChars:number;responseChars:number;inputHash:string;responseHash:string|null};
export type BoundedConversationIndex={
  meaning:'HISTORY_INDEX_NOT_CONTENT';totalEntries:number;includedIds:string[];
  omittedEntries:number;indexTruncated:boolean;entries:ConversationIndexEntry[];
  unavailableEntryIds:string[];
  retrieve:{capabilityId:string;threadId:string;throughTurnId:string};
};
export type ConversationWindow<Message>={messages:Message[];index:BoundedConversationIndex};

/** The caller supplies immutable identities and validates only material that
 * is selected. Current input and selected messages are never shortened. The
 * metadata index is a locator, not an invented summary of omitted messages. */
export function compileConversationWindow<Message>(input:{current:Message;entries:Array<{index:ConversationIndexEntry;messages:Message[];eligible:boolean;validate():void}>;
  retrieve:BoundedConversationIndex['retrieve'];compile(window:ConversationWindow<Message>):ContextBundle;maxRecentEntries?:number;maxIndexEntries?:number}){
  const maxRecent=input.maxRecentEntries??24,maxIndex=input.maxIndexEntries??32;
  if(!Number.isSafeInteger(maxRecent)||maxRecent<0||maxRecent>100||!Number.isSafeInteger(maxIndex)||maxIndex<0||maxIndex>100)
    throw new AgentError('CONVERSATION_WINDOW_INVALID','历史窗口上限无效');
  const selected:typeof input.entries=[];
  const unavailableEntryIds:string[]=[];
  const window=():ConversationWindow<Message>=>({messages:[...selected.flatMap(entry=>entry.messages),input.current],index:{
    meaning:'HISTORY_INDEX_NOT_CONTENT',totalEntries:input.entries.length,includedIds:selected.map(entry=>entry.index.id),
    omittedEntries:input.entries.length-selected.length,indexTruncated:input.entries.length>maxIndex,
    entries:(maxIndex?input.entries.slice(-maxIndex):[]).map(entry=>entry.index),unavailableEntryIds,retrieve:input.retrieve}});
  for(const entry of [...input.entries].reverse()){
    if(!entry.eligible||selected.length>=maxRecent)continue;
    selected.unshift(entry);
    try{entry.validate();}catch(error){selected.shift();if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;if(error instanceof AgentError){unavailableEntryIds.push(entry.index.id);continue;}throw error;}
  }
  // Inclusion counts must describe the final selected set, including rejected
  // revoked candidates; no raw body from an unsuccessful trial is retained.
  const value=window();return {window:value,bundle:input.compile(value),selectedIds:selected.map(entry=>entry.index.id)};
}
