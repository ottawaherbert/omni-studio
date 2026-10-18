import { createSceneContinuationCheckpoint } from '../../../../packages/script/src/continuation';
import { AgentError, hashValue, type CapabilityRegistry, type Observation, type ResourceRef } from '../../../../packages/agent-core/src';
import { compileContext } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptDraftScope } from '../../../../packages/script/src/agentScope';
import { workspaceRef, type ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import type { ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';

type ReadInput={authorizationRef:string;sourceId:string|null;view:'INDEX'|'BODY';unitId:string|null;sceneId:string|null;cursor:string|null;maxChars:number;limit:number;frozen?:any};
const str={type:'string'},nullable=(v:unknown)=>({anyOf:[v,{type:'null'}]}),object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const scriptReadInputSchema=object({authorizationRef:str,sourceId:nullable(str),view:{type:'string',enum:['INDEX','BODY']},unitId:nullable(str),sceneId:nullable(str),cursor:nullable(str),maxChars:{type:'integer'},limit:{type:'integer'}});
const rowSchema=object({unitId:str,sceneId:str,title:str,blockId:nullable(str),type:nullable(str),speakerId:nullable(str),speakerName:nullable(str),text:str,start:{type:'integer'},end:{type:'integer'},length:{type:'integer'}});
const refSchema=object({uri:str,version:str,contentHash:str,branch:str});
const outputSchema=object({meaning:{type:'string',enum:['PLAN_INDEX_NOT_ACTUAL_EVENTS','MANUSCRIPT_EXCERPTS']},sourceRef:refSchema,rows:{type:'array',items:rowSchema},nextCursor:nullable(str),hasMore:{type:'boolean'},totalEntries:{type:'integer'}});
const fail=(message:string):never=>{throw new AgentError('SCRIPT_READ_INPUT',message,400);};
const parse=(v:unknown):ReadInput=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return fail('读稿参数需要对象');const a=v as any;
  if(Object.keys(a).some(k=>![...scriptReadInputSchema.required,'frozen'].includes(k))||typeof a.authorizationRef!=='string'||!['INDEX','BODY'].includes(a.view))return fail('读稿参数无效');
  for(const k of ['sourceId','unitId','sceneId','cursor'])if(a[k]!==null&&(typeof a[k]!=='string'||!a[k]||a[k].length>2000))return fail('读稿目标或分页无效');
  if(!Number.isSafeInteger(a.limit)||a.limit<1||a.limit>100||!Number.isSafeInteger(a.maxChars)||a.maxChars<100||a.maxChars>20000)return fail('读稿批次超出范围');
  if(a.sceneId&&!a.unitId)return fail('读取场景必须指定所在单元');return structuredClone(a);
};
export function registerScriptReadCapability(registry:CapabilityRegistry,deps:{store:AgentSqliteStore;contexts:SqliteContextStore;authorizations:ScriptAuthorizationStore;workspaces:ScriptWorkspaceStore},implementationDigest:string){
  const {store,contexts,authorizations,workspaces}=deps;
  registry.register({spec:{id:'script.read',version:'1',implementationDigest,description:'分页读取当前授权单元或明确选定的前集正文；索引与真实正文分开，完整返回已读区间和后续页。',effect:'READ',cost:'NONE',dispatch:'INLINE',replay:'TRANSACTIONAL',input:{jsonSchema:scriptReadInputSchema,parse},output:{jsonSchema:outputSchema,parse:v=>v}},
    async prepare(value,context){const input=parse(value);delete input.frozen;const run=store.assertExecution(context.execution);
      return authorizations.withRunAuthorization(run,'CONSUME',()=>contexts.withValidationBatch(()=>{
        const auth=authorizations.forRun(run),workspace=workspaces.read(auth.workspaceId,run.ownerId),access={ownerId:run.ownerId,scopeId:workspace.id,branch:`workspace:${workspace.id}`};
        let units:any[],characters:any[],ref:ResourceRef;
        if(input.sourceId){
          const grant=authorizations.grants(auth.id,run.ownerId).find(g=>g.id===input.sourceId&&g.source.purpose==='PREVIOUS_SCRIPT');
          if(!grant)throw new AgentError('SCRIPT_SCOPE_DENIED','读稿来源不是作者所选稿件',403);
          const selected=authorizations.readGranted(authorizations.ref(grant),access,'CURRENT');units=(selected.data as any).units;characters=(selected.data as any).characters;ref=selected.ref;
        }else{
          const scope=auth.scope as ScriptDraftScope;units=workspace.document.units.filter(u=>scope.units.some(s=>s.unitId===u.id));characters=workspace.document.characters;ref=workspaceRef(workspace);
        }
        const characterNames=new Map(characters.map(character=>[character.id,character.name]));
        if(input.unitId&&!units.some(u=>u.id===input.unitId))throw new AgentError('SCRIPT_SCOPE_DENIED','此单元不在本次读取范围',403);
        const selected=units.filter(u=>!input.unitId||u.id===input.unitId);
        if(input.sceneId&&!selected.some(u=>u.scenes.some((s:any)=>s.id===input.sceneId)))throw new AgentError('SCRIPT_SCOPE_DENIED','此场不在本次读取范围',403);
        const entries=selected.flatMap(u=>u.scenes.filter((s:any)=>!input.sceneId||s.id===input.sceneId).flatMap((s:any)=>input.view==='INDEX'?
          [{unitId:u.id,sceneId:s.id,title:s.title,blockId:null,type:null,speakerId:null,speakerName:null,text:JSON.stringify({unitTitle:u.title,location:s.location,timeOfDay:s.timeOfDay,purpose:s.purpose??null,entryState:s.entryState??null,exitState:s.exitState??null,structureNodeId:s.structureNodeId??null,outlineRequirementIds:s.outlineRequirementIds??[],generation:s.generation??null,...(!input.sourceId?{continuationCheckpoint:createSceneContinuationCheckpoint(workspace.document,u.id,s.id)}:{})}),start:0,end:0,length:0}]:
          s.blocks.map((b:any)=>({unitId:u.id,sceneId:s.id,title:s.title,blockId:b.id,type:b.type,speakerId:b.speakerId??null,speakerName:(b.speakerId?characterNames.get(b.speakerId):b.speakerName)??null,text:b.text,start:0,end:0,length:b.text.length}))));
        const queryHash=hashValue({ref,view:input.view,unitId:input.unitId,sceneId:input.sceneId});let index=0,offset=0;
        if(input.cursor){let cursor:any;try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));}catch{return fail('分页游标无效');}
          if(Object.keys(cursor).sort().join()!=='index,offset,queryHash'||cursor.queryHash!==queryHash||!Number.isSafeInteger(cursor.index)||!Number.isSafeInteger(cursor.offset)||cursor.index<0||cursor.index>entries.length||cursor.offset<0||cursor.offset>(entries[cursor.index]?.text.length??0))return fail('稿件或读取条件已变化，请重新读取');index=cursor.index;offset=cursor.offset;}
        const rows:any[]=[];let remaining=input.maxChars;
        while(index<entries.length&&rows.length<input.limit&&remaining>0){const entry=entries[index],end=Math.min(entry.text.length,offset+remaining);rows.push({...entry,text:entry.text.slice(offset,end),start:offset,end,length:entry.text.length});remaining-=end-offset;if(end<entry.text.length){offset=end;break;}index++;offset=0;}
        const hasMore=index<entries.length,projection={meaning:input.view==='INDEX'?'PLAN_INDEX_NOT_ACTUAL_EVENTS':'MANUSCRIPT_EXCERPTS',sourceRef:ref,rows,nextCursor:hasMore?Buffer.from(JSON.stringify({queryHash,index,offset})).toString('base64url'):null,hasMore,totalEntries:entries.length};
        const bundle=compileContext({systemInstruction:'受控读稿记录，索引不是正文已发生事件。',sections:[{id:'read-page',text:JSON.stringify(projection),required:true,priority:100,dependencies:[{ref,freshness:'CURRENT'}]}],skills:[]});
        return {input:{...input,frozen:{projection,contextRef:contexts.capture(access,bundle)}},sources:[ref],targets:[]};
      }));
    },
    async execute(call,context){const input=parse(call.request.input),run=store.assertExecution(context.execution);
      return authorizations.withRunAuthorization(run,'CONSUME',()=>{const auth=authorizations.forRun(run);if(!input.frozen)throw new AgentError('SCRIPT_INPUT_NOT_PREPARED','读取结果没有冻结');contexts.assertAllowed(input.frozen.contextRef,{ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`});
        const observation:Observation={status:'SUCCEEDED',summary:input.frozen.projection.hasMore?'已读取本页，仍有后续稿件':'已读取本页，当前查询没有后续稿件',data:input.frozen.projection,evidence:call.sources,artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'};return store.commitStep(context.execution,call.request.callId,observation,()=>{});});
    },
  });
}
