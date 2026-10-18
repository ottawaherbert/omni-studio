import { parseModelJson } from '../../../../packages/model-output/src';
import { BLUEPRINT_GUIDANCE, blueprintSchema, parseBlueprint, type BlueprintDraft } from '../../../../packages/script/src/blueprint';
import { SCRIPT_STAGES, COMPATIBLE_SCRIPT_STAGES, SCRIPT_WORKFLOW_GUIDANCE, type ScriptStage } from '../../../../packages/script/src/agentStages';
import type { ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import { parseIdeationDraft, discussionTurnsSinceMilestone } from '../../../../packages/script/src/ideation';
import { AgentError, type CapabilityRegistry, type ModelRequest, type ModelTransport, type Observation } from '../../../../packages/agent-core/src';
import { compileContext, freezeSkills } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';
import { createScriptCreationProfile, createScriptProjectFromMaterial, type ScriptCreationFormat } from '../../../../packages/script/src/creation';
import type { MethodBinding } from '../../../../packages/script/src/schema';
import { parseChatInput } from './scriptConversation';
import { prepareScriptConversationContext } from './scriptConversationContext';
import { directHistoryInstruction, resolveDirectChatHistory, withDirectHistoryRead } from './scriptChatHistoryResolve';
import type { ScriptCommandService } from './scriptCommands';

const formats=['short-film','feature-film','tv-series','procedural','anthology','micro-drama'];
const schema={type:'object',additionalProperties:false,required:['kind','question','options','title','format','plannedUnits','targetMinutes','blueprint','stopAfter'],properties:{
  kind:{type:'string',enum:['START','ASK','REPLY','READY','BLUEPRINT']},question:{type:'string'},options:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['tag','text'],properties:{tag:{type:'string'},text:{type:'string'}}}},
  stopAfter:{type:['string','null'],enum:[...SCRIPT_STAGES,null]},
  blueprint:{anyOf:[blueprintSchema,{type:'null'}]},
  title:{type:['string','null']},format:{type:['string','null'],enum:[...formats,null]},plannedUnits:{type:['integer','null']},targetMinutes:{type:['number','null']},
}};
type StartReply={stopAfter?:ScriptStage|null;blueprint?:BlueprintDraft|null;kind:'START'|'ASK'|'REPLY'|'READY'|'BLUEPRINT';question:string;options:Array<{tag:string;text:string}>;title:string|null;format:ScriptCreationFormat|null;plannedUnits:number|null;targetMinutes:number|null};
function parseReply(raw:string):StartReply{
  let v:any;try{v=parseModelJson(raw);}catch{throw new AgentError('ASSISTANT_START_INVALID','助手返回需要有效 JSON');}
  if(!v||Object.keys(v).filter(k=>!['blueprint','stopAfter'].includes(k)).sort().join()!=='format,kind,options,plannedUnits,question,targetMinutes,title'||!['START','ASK','REPLY','READY','BLUEPRINT'].includes(v.kind)||
    typeof v.question!=='string'||!v.question.trim()||v.question.length>8000||!Array.isArray(v.options)||v.options.length>3||
    v.options.some((o:any)=>!o||Object.keys(o).sort().join()!=='tag,text'||typeof o.tag!=='string'||typeof o.text!=='string'||o.tag.length>100||o.text.length>2000))
    throw new AgentError('ASSISTANT_START_INVALID','助手决定格式无效');
  if(v.stopAfter!=null&&!COMPATIBLE_SCRIPT_STAGES.includes(v.stopAfter))throw new AgentError('INVALID_STOP_STAGE','停止阶段无效');
  if(v.kind==='START'){
    if(typeof v.title!=='string'||!v.title.trim()||v.title.length>300||!formats.includes(v.format))throw new AgentError('ASSISTANT_START_INVALID','新作品计划无效');
    createScriptCreationProfile(v.format,v.plannedUnits,v.targetMinutes);
  }else if(v.kind!=='BLUEPRINT'&&[v.title,v.format,v.plannedUnits,v.targetMinutes].some(x=>x!==null))throw new AgentError('ASSISTANT_START_INVALID','讨论不创建作品');
  if(v.kind==='BLUEPRINT'){
    try{v.blueprint=parseBlueprint(v.blueprint);}catch(error){throw new AgentError('BLUEPRINT_INVALID',(error as Error).message);}
  }else if(v.blueprint!=null)throw new AgentError('BLUEPRINT_INVALID','当前回复不能夹带蓝图');
  return v;
}

/** A durable first turn selects only a NEW work's editable profile. All actual
 * writing, review and completion run through the regular domain Goal. */
export function registerScriptAssistantStart(registry:CapabilityRegistry,deps:{store:AgentSqliteStore;journal:SqliteModelJournal;
  contexts:SqliteContextStore;conversations:SqliteConversationStore;commands:ScriptCommandService;workspaces:ScriptWorkspaceStore;transport:ModelTransport;implementationDigest:string}){
  const {store,journal,contexts,conversations,commands,workspaces,transport}=deps;
  registry.register({spec:{id:'script.assistant_start',version:'1',implementationDigest:deps.implementationDigest,
    description:'理解首页自由输入；讨论或询问必要方向，也可交接完整的新作品委托。',effect:'PROPOSE',cost:'MODEL',dispatch:'INLINE',replay:'TRANSACTIONAL',
    input:{jsonSchema:{type:'object',required:['threadId','turnId']},parse:parseChatInput},output:{jsonSchema:{type:'object'},parse:v=>v}},
    async prepare(value,access){
      const input=parseChatInput(value);delete input.frozen;
      return contexts.withValidationBatch(()=>{
        const {turn}=conversations.turn(input.threadId,input.turnId,access.ownerId);
        const payload=turn.input as {text:string;intent:'AUTO'|'AGENT'|'BLUEPRINT';methods:MethodBinding[];channel:'api'|'external';routeRef:string;stopAfter?:ScriptStage};
        if(!['AUTO','AGENT','BLUEPRINT'].includes(payload.intent))throw new AgentError('CHAT_SCOPE_DENIED','缺少作者入口意图');
        const skills=freezeSkills(payload.methods.map(m=>({id:m.id,title:m.title,version:m.version,content:m.content,variables:{},configuration:{...(m.usage||{})},overflow:'ERROR' as const})));
        const {conversation}=conversations.turn(input.threadId,input.turnId,access.ownerId);
        const discussionTurns=discussionTurnsSinceMilestone(conversation.turns.filter(item=>item.ordinal<turn.ordinal));
        const replySchema=payload.stopAfter==='BEATS'?{...schema,properties:{...schema.properties,stopAfter:{type:['string','null'],enum:[...COMPATIBLE_SCRIPT_STAGES,null]}}}:schema;
        const contract=`你是剧本专家助手。当前入口意图为 ${payload.intent}。
AUTO 是普通模式：回应作者本次要求，分析、局部试写、修改或整理都只完成这一项后停止，不启动后台委托。只有 AGENT 允许 START；普通模式提到“开始写”时先完成明确的单次产出，若希望连续创作则说明可以选择“交给 Agent 继续创作”。
讨论规则：作者选中方向后先沿用并推进，不重新给一轮互斥方向；明确过的事项不重复追问。每轮最多问一个会实质改变当前产出的关键问题，选项最多三个且可为空，不必每次提供选项。只在作者要求发散或关键选择未定时给方向选项。
收敛规则：现有内容足够完成有价值的下一步（如作品蓝图）时返回 READY。question 中简要整理“已确定的方向”“尚可边写边定的事项”“建议下一步”，明确说已经可以整理作品蓝图；options 为空。不要求姓名、完整世界观、所有人物关系齐备，不套固定剧情理论。作者明确要继续探索时尊重其意图。本次距上次整理建议/方案已有 ${discussionTurns} 轮普通回复；达到三轮后优先检查是否已能产出，避免同一问题无限细化；轮数不代表完成度，不能强行结束或虚构作者决定。
BLUEPRINT 表示作者选择了“生成作品蓝图”：本次必须返回 BLUEPRINT，question 中只用 1–3 句说明完成情况（不要重复 blueprint 正文），blueprint 中给出核心构想 concept、主题 theme、风格 audienceExperience、作者要求 constraints、主要人物完整资料 characters、基础设定 facts 及作品规格 profile，options 为空；标题和形态等尽量一并提出精简可修改的方案，未经作者确定须标暂定。只交付作品蓝图，不生成故事大纲、节拍、分场或正文，并清楚区分作者已确定内容、AI 候选建议、暂用假设和开放问题。没有充分信息也先给有用的初步方案并列出开放处，不能又退回一轮问卷；只整理这一份后停止，不启动 Goal；服务端保存独立蓝图工作稿，作者明确采用后进入全案蓝图页，再由作者逐步发起后续大纲、分场与正文。作者说“差不多了”“先整理一下”时，AUTO 也应返回 BLUEPRINT。
资料规则：只有作者明确说过或选过的内容是已确定方向；AI 建议未经选择不能当作确认；否定过的方向不能重新混入。小结只是可修订的讨论成果，不取代原始对话。相关原话不在近期窗口时按历史工具取回，不凭索引猜测。
AGENT 表示作者把指定范围的流程交给你。当前作者明确选择的停止阶段是 ${payload.stopAfter??'未选择，请从原话理解；原话也未明确时 ASK'}。可以从任意已有阶段接手，只做到约定位置；不得默认完成整集或全部流程。只做到蓝图时返回 BLUEPRINT；其他阶段理解任务与范围后 START 并填写 stopAfter；若电影还是分集、本次交付范围等实质方向不清，用 ASK 在同一对话询问。不要要求分类输入、填表、预先取名或挂载 Skill。START 只规划新作品标题、形态、总计划集数及本单元目标分钟；服务端按 stopAfter 收紧权限：OUTLINE 只交付大纲；SCENES 交付分场规划（含节拍与节奏）；BODY 才写约定范围正文并检查、有限返修。BEATS 仅兼容旧请求，不用于新委托。不得越过停止阶段，不谎称已完成。若要求一次完成多集，先 ASK 明确本次停止点。尊重作者明确的时长、形式和方法；没有明确时长时可提出可修改的目标，不能把估算称为实测。
${BLUEPRINT_GUIDANCE}
${SCRIPT_WORKFLOW_GUIDANCE}
格式为 ${JSON.stringify(replySchema)}，非 START/BLUEPRINT 时 title/format/plannedUnits/targetMinutes 都为 null；非 BLUEPRINT 时 blueprint 为 null。${directHistoryInstruction}`;
        const prepared=prepareScriptConversationContext({conversations,contexts,ownerId:access.ownerId,threadId:input.threadId,turnId:input.turnId,
          compile:window=>compileContext({systemInstruction:contract,sections:[{id:'conversation',text:JSON.stringify(window),required:true,priority:100,dependencies:[]}],skills,outputSchema:withDirectHistoryRead(replySchema)})});
        const ref=contexts.capture({ownerId:access.ownerId,scopeId:access.scopeId,branch:'author'},prepared.bundle);
        const model:ModelRequest={operationKey:'assistant-start',channel:payload.channel,routeRef:payload.routeRef,prompt:prepared.bundle.prompt,
          systemInstruction:prepared.bundle.systemInstruction,outputSchema:prepared.bundle.outputSchema,contextRef:ref,inputManifest:{history:prepared.history,skillTrace:prepared.bundle.skillTrace}};
        return {input:{...input,frozen:{model,methods:payload.methods}},sources:[prepared.history],targets:[]};
      });
    },
    async execute(call,access){
      const input=parseChatInput(call.request.input),model=input.frozen?.model;
      if(!model?.contextRef)throw new AgentError('CONTEXT_REQUIRED','缺少冻结的作者要求');
      const {result:returned,model:usedModel,answerText}=await resolveDirectChatHistory({store,journal,contexts,conversations,transport,token:access.execution,signal:access.signal,
        threadId:input.threadId,turnId:input.turnId,model}),reply=parseReply(answerText);
      const {turn}=conversations.turn(input.threadId,input.turnId,access.ownerId);
      if(reply.kind==='START'&&turn.input.intent==='AGENT'&&(!reply.stopAfter||reply.stopAfter==='BLUEPRINT'))throw new AgentError('STOP_STAGE_REQUIRED','请明确本次停止阶段；只做到蓝图应返回蓝图。');
      if(reply.kind==='BLUEPRINT'&&turn.input.intent==='AGENT'&&turn.input.stopAfter&&turn.input.stopAfter!=='BLUEPRINT')throw new AgentError('STOP_STAGE_MISMATCH','本次委托不是仅蓝图，不能以蓝图替代所选阶段。');
      if(turn.input.stopAfter&&reply.kind==='START'&&reply.stopAfter!==turn.input.stopAfter)throw new AgentError('STOP_STAGE_MISMATCH','返回超出作者选择的停止阶段，原要求已保留。');
      if(turn.input.intent==='BLUEPRINT'&&reply.kind!=='BLUEPRINT')throw new AgentError('BLUEPRINT_RESULT_REQUIRED','本次只整理作品蓝图，返回未按此要求完成；原对话已保留，请重试。');
      // Model output cannot turn an ordinary discussion into a continuous delegation.
      if(reply.kind==='START'&&turn.input.intent!=='AGENT'){
        reply.kind='READY';reply.question='当前方向可以继续整理。尚未启动连续创作：你可以先生成作品蓝图，或明确选择“交给 Agent 继续创作”。';
      }
      if(['READY','BLUEPRINT'].includes(reply.kind))reply.options=[];
      return store.atomic(()=>{
        store.assertExecution(access.execution);
        contexts.assertAllowed(usedModel.contextRef!,{ownerId:access.ownerId,scopeId:access.scopeId,branch:'author'});
        const goal=reply.kind==='START'?commands.startGoalFromChat(access.execution,input.turnId,{kind:'NEW',title:reply.title!,
          profile:createScriptCreationProfile(reply.format!,reply.plannedUnits!,reply.targetMinutes!),...(reply.stopAfter?{stopAfter:reply.stopAfter}:{}),history:model.inputManifest!.history as any}):null;
        let blueprintWorkspaceId:string|undefined;
        if(reply.kind==='BLUEPRINT'){
          const parsed=parseIdeationDraft(JSON.stringify({...reply.blueprint,...reply.blueprint?.profile,title:reply.title??'未命名作品',format:reply.format??'custom',...(reply.plannedUnits!==null?{plannedUnits:reply.plannedUnits}:{}),...(reply.targetMinutes!==null?{targetMinutes:reply.targetMinutes}:{}),outline:''}),input.frozen!.methods);
          const document=createScriptProjectFromMaterial(parsed.title,parsed.profile,parsed.initialBrief);
          blueprintWorkspaceId=workspaces.create({ownerId:access.ownerId,threadId:input.threadId,requestId:`blueprint:${input.turnId}`,source:{document}}).id;
          reply.question=[reply.question,`故事构想：${document.brief.concept}`,document.brief.theme?`主题：${document.brief.theme}`:'',document.brief.audienceExperience?`风格与观众感受：${document.brief.audienceExperience}`:'',document.brief.constraints?`作者要求与暂定事项：${document.brief.constraints}`:'',`当前规格（可修改）：${document.profile.workType} · ${document.profile.organization==='episodic'?`${document.profile.plannedUnits} 集，每集`:'全片'} ${document.profile.targetDurationMs/60000} 分钟 · ${document.profile.genres.join('、')}`, ...document.characters.map(c=>[`人物：${c.name}`,c.bio,`目标：${c.desire}；内在需要：${c.need}`,`矛盾：${c.contradiction}；变化方向：${c.arc}`,`说话方式：${c.voice}`].filter(Boolean).join('\n')),...document.facts.map(f=>`设定（${f.status==='approved'?'已确认':'待确认'}）：${f.text}`)].filter(Boolean).join('\n\n');
        }
        const observation:Observation={status:'SUCCEEDED',summary:goal?'已启动指定阶段的创作委托':'助手已回复',data:{kind:reply.kind,goal,blueprintWorkspaceId:blueprintWorkspaceId??null},
          evidence:call.sources,artifacts:[],effectState:goal?'CANDIDATE_PRESERVED':'NO_EFFECT',retry:'NEVER'};
        return store.commitStep(access.execution,call.request.callId,observation,()=>{
          contexts.bindArtifact('conversation-turn',input.turnId,usedModel.contextRef!,{ownerId:access.ownerId,scopeId:access.scopeId,branch:'author'});
          conversations.writeResponse(input.threadId,input.turnId,access.ownerId,{text:reply.question,options:reply.options,replyKind:reply.kind,...(blueprintWorkspaceId?{blueprintWorkspaceId}:{}),
            ...(goal?{goal}:{}) ,methods:input.frozen!.methods,contextRef:usedModel.contextRef,prompt:usedModel.prompt,rawResult:returned.text,
            provenance:{source:returned.provenance.channel==='provider'?'api':'manual_external',provider:returned.provenance.producer||returned.provenance.channel}});
        });
      });
    },
  });
}
