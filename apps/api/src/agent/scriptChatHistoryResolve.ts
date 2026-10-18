import { AgentError, hashValue, invokeModel, type ExecutionToken, type ModelRequest, type ModelResult, type ModelTransport, type ResourceRef } from '../../../../packages/agent-core/src';
import { compileContext } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';
import { readScriptChatHistoryPage } from './scriptConversationRead';
import { parseModelJson } from '../../../../packages/model-output/src';

const readSchema={type:'object',additionalProperties:false,required:['kind','entryId','cursor'],properties:{
  kind:{type:'string',enum:['READ']},entryId:{type:'string'},cursor:{type:['string','null']}}};
// Strict structured outputs require an object root. The branch belongs inside
// one required property; external/manual replies from older runs remain readable.
export const withDirectHistoryRead=(answerSchema:Record<string,unknown>)=>({type:'object',additionalProperties:false,
  required:['response'],properties:{response:{anyOf:[answerSchema,readSchema]}}});
export const directHistoryInstruction='只输出完整 JSON 根对象的 response 字段，不要 Markdown 代码块、说明前缀或后缀。如需较早对话的精确原文，可先返回 {"response":{"kind":"READ","entryId":"索引中的 id","cursor":null}}。服务端只会读取本次冻结会话的一页并再次请求回答；不要把索引当作原文，也不要猜测未读内容。';

function responseText(raw:string):string{
  let value:any;try{value=parseModelJson(raw);}catch{return raw;}
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'response'))
    return JSON.stringify(value.response);
  return JSON.stringify(value);
}

function requestedRead(raw:string):{entryId:string;cursor:string|null}|null{
  let value:any;try{value=JSON.parse(responseText(raw));}catch{return null;}
  if(value?.kind!=='READ')return null;
  if(!value||Array.isArray(value)||Object.keys(value).sort().join()!=='cursor,entryId,kind'||
    typeof value.entryId!=='string'||!value.entryId||value.entryId.length>200||
    !(value.cursor===null||typeof value.cursor==='string'))throw new AgentError('CHAT_HISTORY_READ_INVALID','旧对话读取请求格式无效');
  return {entryId:value.entryId,cursor:value.cursor};
}

/** One bounded model requested read. The follow-up invocation is durable so
 * an external return can resume without creating a different context ID. */
export async function resolveDirectChatHistory(input:{store:AgentSqliteStore;journal:SqliteModelJournal;contexts:SqliteContextStore;
  conversations:SqliteConversationStore;transport:ModelTransport;token:ExecutionToken;signal:AbortSignal;
  threadId:string;turnId:string;model:ModelRequest}):Promise<{result:ModelResult;model:ModelRequest;answerText:string}>{
  const {store,journal,contexts,conversations,transport,token,signal,model}=input;
  const first=await invokeModel(journal,transport,token,model,signal),read=requestedRead(first.text);
  if(!read)return {result:first,model,answerText:responseText(first.text)};
  const run=store.assertExecution(token),source=model.inputManifest?.history as ResourceRef|undefined;
  if(!source||!model.contextRef)throw new AgentError('CHAT_HISTORY_READ_DENIED','对话没有冻结历史来源');
  const access={ownerId:run.ownerId,scopeId:run.scopeId,branch:'author'};
  const original=contexts.assertAllowed(model.contextRef,access);
  const page=readScriptChatHistoryPage({store,contexts,conversations,implementationDigest:''},run,
    {threadId:input.threadId,throughTurnId:input.turnId,entryId:read.entryId,cursor:read.cursor,maxChars:6000},source);
  const pageHash=hashValue(page.projection),key=`${model.operationKey}:history-read`;
  const existing=store.db.prepare('SELECT request_json FROM agent_invocations WHERE run_id=? AND input_revision=? AND operation_key=?')
    .get(run.id,token.inputRevision,key) as {request_json:string}|undefined;
  let follow:ModelRequest;
  if(existing){
    follow=JSON.parse(existing.request_json);
    if(follow.inputManifest?.historyPageHash!==pageHash||follow.inputManifest?.historyEntryId!==read.entryId||
      follow.inputManifest?.historyCursor!==read.cursor)throw new AgentError('CHAT_HISTORY_CHANGED','读取的旧原文与已冻结追问不同');
  }else{
    const bundle=compileContext({systemInstruction:model.systemInstruction||'',skills:[],outputSchema:model.outputSchema,
      sections:[
        {id:'original-request',text:model.prompt,required:true,priority:100,dependencies:original.dependencies},
        {id:'exact-history-page',text:JSON.stringify(page.projection),required:true,priority:100,dependencies:[{ref:page.ref,freshness:'EXACT'}]},
        {id:'answer-now',text:'已读取上面标记为 EXACT_CONVERSATION_TEXT 的原文页。现在按照原请求格式回答；本次不能再请求读取。若原文仍不足，明确说明缺少哪段，不猜测。',required:true,priority:100,dependencies:[]},
      ]});
    const contextRef=contexts.capture(access,bundle);
    follow={...model,operationKey:key,prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,
      outputSchema:bundle.outputSchema,contextRef,inputManifest:{...model.inputManifest,historyPageHash:pageHash,
        historyEntryId:read.entryId,historyCursor:read.cursor,historyPageSource:page.ref}};
  }
  const result=await invokeModel(journal,transport,token,follow,signal);
  if(requestedRead(result.text))throw new AgentError('CHAT_HISTORY_READ_LIMIT','本次聊天只允许一次按需读取，请明确指出仍需哪段原文');
  return {result,model:follow,answerText:responseText(result.text)};
}
