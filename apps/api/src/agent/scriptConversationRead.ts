import { AgentError, ExecutionInvalidated, hashValue, type AgentRun, type CapabilityRegistry, type ExecutionPolicy, type ResourceRef } from '../../../../packages/agent-core/src';
import { compileContext } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteConversationStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';
import type { ConversationArchiveEntry } from './scriptConversationContext';

type Input={authorizationRef:string|null;threadId:string;throughTurnId:string;view:'INDEX'|'BODY';entryId:string|null;cursor:string|null;maxChars:number;limit:number;frozen?:any};
type Deps={store:AgentSqliteStore;contexts:SqliteContextStore;conversations:SqliteConversationStore;authorizations?:ScriptAuthorizationStore;implementationDigest:string};
const nullable={type:['string','null']},str={type:'string',minLength:1,maxLength:200};
export const conversationReadSchema={type:'object',additionalProperties:false,required:['authorizationRef','threadId','throughTurnId','view','entryId','cursor','maxChars','limit'],properties:{authorizationRef:nullable,threadId:str,throughTurnId:str,view:{type:'string',enum:['INDEX','BODY']},entryId:nullable,cursor:nullable,maxChars:{type:'integer',minimum:100,maximum:16000},limit:{type:'integer',minimum:1,maximum:50}}};
const denied=(message:string):never=>{throw new AgentError('CONVERSATION_READ_DENIED',message,403);};
const parse=(value:unknown):Input=>{
 const v=value as Input;if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(key=>!['authorizationRef','threadId','throughTurnId','view','entryId','cursor','maxChars','limit','frozen'].includes(key))||
   typeof v.threadId!=='string'||!v.threadId||typeof v.throughTurnId!=='string'||!v.throughTurnId||!['INDEX','BODY'].includes(v.view)||
   ![v.authorizationRef,v.entryId,v.cursor].every(item=>item===null||typeof item==='string')||
   !Number.isSafeInteger(v.maxChars)||v.maxChars<100||v.maxChars>16000||!Number.isSafeInteger(v.limit)||v.limit<1||v.limit>50||v.view==='BODY'&&!v.entryId)denied('对话原文读取参数无效');
 return structuredClone(v);
};
function source(deps:Deps,run:AgentRun,input:Input,phase:'VIEW'|'CONSUME'){
 const {conversation,turn}=deps.conversations.turn(input.threadId,input.throughTurnId,run.ownerId);
 if(conversation.id!==run.threadId)denied('不能读取另一会话');
 const row=deps.store.db.prepare('SELECT id,content_hash,data_json FROM agent_conversation_sources WHERE thread_id=? AND turn_id=?').get(input.threadId,input.throughTurnId) as any;
 if(!row)denied('指定回合尚无冻结历史');
 const data=JSON.parse(row.data_json),archive=data.archive;
 if(hashValue(data)!==row.content_hash||archive?.version!==1||archive.threadId!==conversation.id||archive.throughTurnId!==turn.id||archive.throughOrdinal!==turn.ordinal||!Array.isArray(archive.entries))denied('冻结历史缺少精确原文索引');
 const origin:ResourceRef={uri:`resource://conversation/${row.id}`,version:'1',contentHash:row.content_hash,branch:'author'};
 let ref=origin,access={ownerId:run.ownerId,scopeId:conversation.scopeId,branch:'author'};
 if(run.kind==='GOAL'||input.authorizationRef!==null){
   const authorizations=deps.authorizations;if(!authorizations)denied('对话来源没有宿主授权策略');
   const auth=authorizations.forRun(run,phase);if(input.authorizationRef!==auth.id)denied('对话来源授权不是当前委托');
   const grant=authorizations.grants(auth.id,run.ownerId).find(item=>item.source.purpose==='CONVERSATION'&&hashValue(item.source.ref)===hashValue(origin));
   if(!grant)denied('历史截止回合不在作者明确选择的对话来源中');
   ref=authorizations.ref(grant);access={ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`};
   authorizations.readGranted(ref,access,'EXACT');
 }else{
   const currentId=(run.input as any)?.request?.input?.turnId;
   if(run.kind!=='CHAT'||!currentId)denied('读取缺少作者当前回合');
   const current=deps.conversations.turn(run.threadId,currentId,run.ownerId).turn;
   if(turn.ordinal>current.ordinal)denied('不能读取接收消息之后的回合');
 }
 return {conversation,archive:archive as {entries:ConversationArchiveEntry[]},origin,ref,access};
}
function page(deps:Deps,run:AgentRun,input:Input){
 const resolved=source(deps,run,input,'CONSUME'),{conversation,archive,origin}=resolved;
 let offset=0;
 if(input.cursor){let cursor:any;try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{denied('历史分页游标无效');}
   if(cursor.hash!==origin.contentHash||cursor.entryId!==input.entryId||cursor.view!==input.view||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)denied('历史分页不属于这个冻结来源');offset=cursor.offset;}
 let total:number,rows:any[];
 if(input.view==='INDEX'){total=archive.entries.length;rows=archive.entries.slice(offset,offset+input.limit);}
 else{
   const entry=archive.entries.find(item=>item.id===input.entryId);if(!entry)denied('原文不在这个冻结历史范围');
   let messages:any[];
   if(entry.kind==='SEED'){const raw=conversation.seed[entry.seedIndex!];if(hashValue(raw)!==entry.inputHash)denied('导入历史原文已改变');messages=[raw];}
   else{const turn=conversation.turns.find(item=>item.id===entry.id);
     if(!turn||turn.ordinal!==entry.ordinal||hashValue(turn.input.text)!==entry.inputHash)denied('作者原消息已改变');
     messages=[{role:'user',text:turn.input.text}];
     if(entry.responseHash){if(!turn.response||hashValue(turn.response)!==entry.responseHash)denied('历史回复不匹配冻结版本');deps.contexts.assertArtifact('conversation-turn',turn.id,'VIEW');messages.push({role:'ai',text:turn.response.text,...(turn.response.options?{options:turn.response.options}:{})});}
   }
   const raw=JSON.stringify(messages);total=raw.length;rows=[{entryId:entry.id,format:'JSON_MESSAGES_FRAGMENT',start:offset,end:Math.min(offset+input.maxChars,total),text:raw.slice(offset,offset+input.maxChars)}];
 }
 if(offset>total)denied('历史分页超出范围');
 const next=offset+(input.view==='INDEX'?rows.length:input.maxChars),hasMore=next<total;
 return {...resolved,projection:{meaning:input.view==='INDEX'?'HISTORY_INDEX_NOT_CONTENT':'EXACT_CONVERSATION_TEXT',sourceRef:resolved.ref,throughTurnId:input.throughTurnId,rows,total,hasMore,
   nextCursor:hasMore?Buffer.from(JSON.stringify({hash:origin.contentHash,entryId:input.entryId,view:input.view,offset:next})).toString('base64url'):null}};
}
/** Direct chat runs use their own frozen cutoff. This is the same guarded
 * page reader used by the Goal capability, without a workspace write grant. */
export function readScriptChatHistoryPage(deps:Deps,run:AgentRun,input:{threadId:string;throughTurnId:string;entryId:string;cursor:string|null;maxChars:number},expectedSource:ResourceRef){
 if(run.kind!=='CHAT')denied('只有当前聊天可直接读取会话历史');
 const request:Input={authorizationRef:null,threadId:input.threadId,throughTurnId:input.throughTurnId,
   view:'BODY',entryId:input.entryId,cursor:input.cursor,maxChars:input.maxChars,limit:1};
 return framed(deps,run,request,'CONSUME',()=>{
   const result=page(deps,run,request);
   if(hashValue(result.origin)!==hashValue(expectedSource))denied('所读历史不是本次冻结来源');
   return {projection:result.projection,ref:result.ref};
 });
}
const framed=<T>(deps:Deps,run:AgentRun,input:Input,phase:'VIEW'|'CONSUME',read:()=>T):T=>deps.contexts.withValidationBatch(()=>{
  if(run.kind==='GOAL'||input.authorizationRef!==null){
    if(!deps.authorizations)denied('缺少作者授权');
    return deps.authorizations!.withRunAuthorization(run,phase,read);
  }
  return read();
});
export function createScriptConversationReadAuthorization(deps:Deps):ExecutionPolicy['authorize']{
 return async(_spec,call,context,phase)=>{
   const run=deps.store.assertExecution(context.execution),input=parse(call.request.input),mode=phase==='REPLAY'?'VIEW':'CONSUME';
   if(run.ownerId!==context.ownerId||run.scopeId!==context.scopeId||String(run.generation)!==context.commandRevision||run.policyRevision!==context.policyRevision)denied('历史读取与实际执行身份不同');
   framed(deps,run,input,mode,()=>{const resolved=source(deps,run,input,mode);if(phase!=='PREPARE'){
     if(!input.frozen?.contextRef||hashValue(input.frozen.projection)!==input.frozen.projectionHash)denied('历史原文缺少冻结证据');
     if(mode==='VIEW')deps.contexts.assertVisible(input.frozen.contextRef,resolved.access);else deps.contexts.assertAllowed(input.frozen.contextRef,resolved.access);
   }});
 };
}
export function registerScriptConversationRead(registry:CapabilityRegistry,deps:Deps){
 registry.register({spec:{id:'script.read_conversation',version:'1',implementationDigest:deps.implementationDigest,description:'按冻结截止回合分页读取较早对话的索引或完整原文；索引不是内容摘要。',effect:'READ',cost:'NONE',dispatch:'INLINE',replay:'TRANSACTIONAL',input:{jsonSchema:conversationReadSchema,parse},output:{jsonSchema:{type:'object'},parse:value=>value}},
   async prepare(value,context){const input=parse(value);delete input.frozen;const run=deps.store.assertExecution(context.execution);
     return framed(deps,run,input,'CONSUME',()=>{const value=page(deps,run,input),bundle=compileContext({systemInstruction:'对话原文只读，不授予新的执行或写作权限。',skills:[],sections:[{id:'history-page',text:JSON.stringify(value.projection),required:true,priority:100,dependencies:[{ref:value.ref,freshness:'EXACT'}]}]}),contextRef=deps.contexts.capture(value.access,bundle);
       return {input:{...input,frozen:{contextRef,projection:value.projection,projectionHash:hashValue(value.projection)}},sources:[value.ref],targets:[]};});},
   async execute(call,context){const input=parse(call.request.input),run=deps.store.assertExecution(context.execution);return framed(deps,run,input,'CONSUME',()=>{
     const current=page(deps,run,input);if(!input.frozen||hashValue(current.projection)!==input.frozen.projectionHash)throw new ExecutionInvalidated('CONVERSATION_HISTORY_CHANGED','原文或可见范围已改变');
     return deps.store.commitStep(context.execution,call.request.callId,{status:'SUCCEEDED',summary:'已读取冻结对话原文页',data:input.frozen.projection,evidence:call.sources,artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'},()=>{});
   });}});
}
