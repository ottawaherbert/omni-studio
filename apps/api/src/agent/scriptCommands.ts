import type {PlanningRepairTarget} from '../../../../packages/script/src/planningRepair';
import {freezeSceneOrder} from '../../../../packages/script/src/sceneOrder';
import {freezeOutlineGrant, getOutlineGuide, anchorCurrent, outlineText, unitBelongsToSeason, type OutlineOwner} from '../../../../packages/script/src/outlineGuides';
import { BLUEPRINT_BRIEF_FIELDS, type BlueprintBriefField } from '../../../../packages/script/src/blueprint';
import { COMPATIBLE_SCRIPT_STAGES, restrictStageScope, isPlanningStage, type ScriptStage } from '../../../../packages/script/src/agentStages';
import { AgentError, assertSamePayload, hashValue, stableJson, type BudgetLimits, type BudgetSnapshot, type GoalRevisionInput, type ResourceRef, type ExecutionToken } from '../../../../packages/agent-core/src';
import type { AgentSqliteStore, SqliteConversationStore, SqliteGoalStore } from '../../../../packages/agent-sqlite/src';
import { AGENT_DRAFT_OPERATIONS, emptyScriptDraftCreationLedger, selectionBlockIds, validateScriptDraftScope, assertStructureScopesCurrent, type AgentDraftOperation, type DraftSelection, type DraftSceneScope, type DraftUnitScope, type ScriptDraftCreationLedger, type ScriptDraftScope } from '../../../../packages/script/src/agentScope';
import { defaultScriptChecks, scriptGoalEnvelope, readScriptGoalEnvelope } from '../../../../packages/script/src/agentGoal';
import { createScriptProject } from '../../../../packages/script/src/project';
import { blocksToScreenplayText } from '../../../../packages/script/src/fountainAdapter';
import { unitCharacters, visibleInUnit } from '../../../../packages/script/src/continuity';
import { parseProjectProfile, parseScriptProject, type ScriptProject, type MethodBinding, type ProjectProfile } from '../../../../packages/script/src/schema';
import { freezeStructureScope, structureNodeSceneIds, assertFrozenStructureScopeCurrent } from '../../../../packages/script/src/structure';
import { collectOutlineRequirements, outlineSourcesChanged, type StoryCoverageContract } from '../../../../packages/script/src/goalCoverage';
import type { AgentDraftRequest } from '../../../../packages/script/src/agentDraft';
import { createSceneContinuationCheckpoint } from '../../../../packages/script/src/continuation';
import type { ScriptAuthorizationStore, ScriptReadSource } from '../repositories/scriptAuthorizationStore';
import type { ScriptDraftStore } from '../repositories/scriptDraftStore';
import type { ScriptRepository } from '../repositories/scriptStore';
import { workspaceRef, type ScriptWorkspace, type ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';

type Route = {channel:'api'|'external';routeRef:string};
type Resolvers = {resolveMethods(ids:string[]):Promise<MethodBinding[]>;resolveExecution():Route};
type Source = {kind:'NEW';title:string;profile:ProjectProfile}|{kind:'PROJECT';projectId:string;revision:number;contentHash:string}|{kind:'WORKSPACE';workspaceId:string;expectedRevision:number};
type SourceChoice = {purpose:'CONVERSATION'|'PREVIOUS_SCRIPT';ref:ResourceRef;unitIds?:string[]|null};
type Target = {initialUnit?:boolean;unitId?:string;sceneId?:string;blockIds?:string[];selection?:DraftSelection;scopeId?:string;entityId?:string;
  initialScope?:'PROJECT'|'UNIT';maxNewScenes?:number;seasonId?:string;nodeId?:string;beforeSceneId?:string;afterSceneId?:string;outlineStructure?:boolean;outlineSceneOrder?:boolean;outlineRange?:DraftSelection;outlineBeatIds?:string[];repairCandidateId?:string};
type ManualGoal = {goalId:string;expectedGoalVersion:number};
type GoalTarget = {initialUnit?:boolean;initialMaxNewScenes?:number;unitIds?:string[];wholeUnitIds?:string[];sceneIds?:Array<{unitId:string;sceneId:string}>;maxNewScenes?:Array<{unitId:string;count:number}>;newUnitCount?:number;newUnitMaxScenes?:number;sharedFields?:Array<BlueprintBriefField|'outline'>;characterIds?:string[];factIds?:string[];characterScopeIds?:string[];factScopeIds?:string[];
  initialCharacterScope?:'PROJECT'|'UNIT';initialFactScope?:'PROJECT'|'UNIT';newUnitCharacterScopes?:boolean;newUnitFactScopes?:boolean;
  outlineTarget?:{unitId:string;scopeId?:string;seasonId?:string;nodeId?:string;allowStructure?:boolean;allowSceneOrder?:boolean};structureTargets?:Array<{unitId:string;nodeId:string}>;storyOutlineScopeIds?:string[];seasonOutlineIds?:string[];newUnitScopeId?:string};
type Base = {requestId:string;threadId:string;expectedConversationVersion:number;executionChannel?:'api'|'external'};
type ProposeCommand = Base & {kind:'PROPOSE';source:Source;operation:AgentDraftOperation;instruction:string;target:Target;methodIds:string[];sources?:SourceChoice[];manualGoal?:ManualGoal};
type ApplyCommand = Base & {kind:'APPLY';workspaceId:string;candidateId:string;expectedRevision:number;writerEpoch:number;manualGoal?:ManualGoal};
type GoalStartCommand = Base & {stopAfter?:ScriptStage;kind:'GOAL_START';source:Source;objective:string;task:'WRITE'|'REVISE'|'REVIEW';target:GoalTarget;methodIds:string[];sources?:SourceChoice[]};
type GoalContinueCommand = Base & {stopAfter?:ScriptStage;kind:'GOAL_CONTINUE'|'GOAL_REVISE';goalId:string;expectedGoalVersion:number;expectedRunVersion:number;objective?:string;task?:'WRITE'|'REVISE'|'REVIEW';target?:GoalTarget;methodIds?:string[];sources?:SourceChoice[];additionalSources?:SourceChoice[];answer?:{decisionId:string;text:string;choiceId?:string}};
type PlanningRepairCommand=Base&{kind:'PLANNING_REPAIR';source:Source;target:PlanningRepairTarget;instruction:string;methodIds:string[]};
export type ScriptAuthorCommand = ProposeCommand|ApplyCommand|GoalStartCommand|GoalContinueCommand|PlanningRepairCommand;
export type ScriptCommandReceipt = {kind:ScriptAuthorCommand['kind'];workspaceId:string;runId:string;threadId:string;authorizationRef:string;goalId?:string;goalRevision?:number;reservedUnitIds?:string[]};
export type ScriptChatSelection = {draftOperation?:'outline_development'|'scene_order'|'scene_plan'|'replace_selection';analysis?:boolean;workspaceId:string;expectedRevision:number;unitId:string;sceneId?:string;blockIds?:string[];selection?:DraftSelection;manualGoal?:ManualGoal;sources?:SourceChoice[];scopeId?:string;seasonId?:string;nodeId?:string;outlineBeatIds?:string[];localDraft?:ScriptProject};
const fail=(message:string,code='INVALID_SCRIPT_COMMAND',status=400):never=>{throw new AgentError(code,message,status);};
const obj=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:fail('作者命令必须是对象');
const exact=(value:Record<string,unknown>,allowed:string[],required:string[]=allowed)=>{if(Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('作者命令包含缺失或不允许的字段');};
const id=(value:unknown,label:string)=>typeof value==='string'&&/^[\w-]{1,200}$/.test(value)?value:fail(`${label}无效`);
const text=(value:unknown,label:string,max=20000)=>typeof value==='string'&&value.trim()&&value.length<=max?value:fail(`${label}无效`);
const int=(value:unknown,label:string,min=0,max=10000)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max?value as number:fail(`${label}无效`);
const ids=(value:unknown,label:string,max=1000)=>{if(!Array.isArray(value)||value.length>max)return fail(`${label}无效`);const result=value.map(item=>id(item,label));if(new Set(result).size!==result.length)fail(`${label}重复`);return result;};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
const defaults={policyRevision:'script-author-v1',manualMaxInvocations:2,budgetLimits:{maxInvocations:40,maxToolCalls:80,maxTurns:20,maxRepairRounds:4,maxActiveMs:60*60*1000} satisfies BudgetLimits,turnLimits:{maxDecisions:8,maxToolCalls:6}};
const scopedBudget=(base:BudgetLimits,workspace:ScriptWorkspace,scope:ScriptDraftScope,targetUnitIds:string[],target:GoalTarget,task:'WRITE'|'REVISE'|'REVIEW'):BudgetLimits=>{
  const existingScenes=scope.units.reduce((count,grant)=>count+
    (task==='REVIEW'||grant.allowAllScenes
      ?workspace.document.units.find(item=>item.id===grant.unitId)?.scenes.length||0
      :grant.scenes.length),0);
  const explicitlyPlannedScenes=(target.maxNewScenes||[]).reduce((count,item)=>count+item.count,0);
  const sceneCapacity=existingScenes+explicitlyPlannedScenes+(target.initialUnit?(target.initialMaxNewScenes??100):0)+
    (target.newUnitCount||0)*(target.newUnitMaxScenes??100);
  // Each body/check/repair step has both a bounded decision and a bounded
  // capability request. Freeze a larger finite budget for larger authorized work.
  const maxInvocations=Math.min(1000,Math.max(base.maxInvocations,20+4*sceneCapacity+22*targetUnitIds.length));
  return {...base,maxInvocations,maxToolCalls:Math.max(base.maxToolCalls,maxInvocations*2),
    maxTurns:Math.max(base.maxTurns,Math.ceil(maxInvocations/3)),
    maxActiveMs:Math.max(base.maxActiveMs||0,maxInvocations*60*1000)};
};
const empty=(workspace:ScriptWorkspace):ScriptDraftScope=>({workspaceId:workspace.id,documentId:workspace.documentId,originRevision:workspace.revision,originContentHash:hashValue(workspace.document),operations:[],units:[],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]});
const stable=(prefix:string,basis:unknown)=>`${prefix}_${hashValue(basis).slice(0,48)}`;
const scopeIdFor=(workspace:ScriptWorkspace,unitId:string)=>['anthology','procedural'].includes(workspace.document.profile.continuity)?unitId:workspace.document.id;
const unitGrant=(unitId:string):DraftUnitScope=>({unitId,allowSummary:false,allowAllScenes:false,maxNewScenes:0,scenes:[]});
const sceneGrant=(sceneId:string,blocks:string[]|null=null,selection?:DraftSelection):DraftSceneScope=>({sceneId,allowPlan:false,allowBody:true,blockIds:blocks,...(selection?{selection}:{})});
const selectedText=(value:unknown):DraftSelection=>{
  const row=obj(value);exact(row,['start','end','text']);
  const start=int(row.start,'选区起点',0,200000),end=int(row.end,'选区终点',1,200000);
  if(end<=start||typeof row.text!=='string'||row.text.length!==end-start)fail('文字选区无效');
  return {start,end,text:row.text};
};

/** Browser input is a selection, never an authorization record. All IDs and
 * budgets that confer new write power are derived under the server transaction. */
export class ScriptCommandService {
  constructor(private readonly deps:{store:AgentSqliteStore;conversations:SqliteConversationStore;workspaces:ScriptWorkspaceStore;
    authorizations:ScriptAuthorizationStore;drafts:ScriptDraftStore;goals:SqliteGoalStore;scripts:ScriptRepository},
    private readonly policy:typeof defaults=defaults){}
  ensureSchema(){this.deps.store.db.exec(`CREATE TABLE IF NOT EXISTS script_author_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,envelope_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(owner_id,request_id));
    CREATE TABLE IF NOT EXISTS script_goal_budget_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,envelope_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(owner_id,request_id))`);}
  goalBudget(ownerId:string,goalId:string):BudgetSnapshot{
    return this.deps.store.atomic(()=>{
      const goal=this.deps.goals.read(id(goalId,'委托'),ownerId);
      this.deps.workspaces.read(goal.revision.workspaceRef.uri.split('/').at(-1)!,ownerId);
      return this.deps.goals.budgets.read(goal.revision.budgetId,ownerId);
    });
  }
  increaseGoalBudget(ownerId:string,goalId:string,raw:unknown):BudgetSnapshot{
    const body=obj(raw);exact(body,['requestId','expectedGoalVersion','expectedBudgetVersion','maxInvocations']);
    const requestId=id(body.requestId,'请求标识'),goalVersion=int(body.expectedGoalVersion,'委托版本',1);
    const budgetVersion=int(body.expectedBudgetVersion,'预算版本',1),maxInvocations=int(body.maxInvocations,'模型调用总额度',1,1000);
    if(![80,160,320,640,1000].includes(maxInvocations))fail('请选择受支持的有限模型调用总额度');
    return this.deps.store.atomic(()=>{
      const goal=this.deps.goals.read(id(goalId,'委托'),ownerId);
      this.deps.workspaces.read(goal.revision.workspaceRef.uri.split('/').at(-1)!,ownerId);
      const envelopeHash=hashValue({goalId,body});
      const existing=this.deps.store.db.prepare('SELECT envelope_hash,receipt_json FROM script_goal_budget_commands WHERE owner_id=? AND request_id=?').get(ownerId,requestId) as {envelope_hash:string;receipt_json:string}|undefined;
      if(existing){assertSamePayload(existing.envelope_hash,envelopeHash);return JSON.parse(existing.receipt_json) as BudgetSnapshot;}
      if(goal.version!==goalVersion)fail('委托版本已改变','GOAL_VERSION_CONFLICT',409);
      const current=this.deps.goals.budgets.read(goal.revision.budgetId,ownerId);
      if(maxInvocations<=current.limits.maxInvocations)fail('新额度必须高于当前总额度','BUDGET_INCREASE_REQUIRED',409);
      const limits:BudgetLimits={...current.limits,
        maxInvocations,maxToolCalls:Math.max(current.limits.maxToolCalls,maxInvocations*2),
        maxTurns:Math.max(current.limits.maxTurns,Math.ceil(maxInvocations/2)),
        maxRepairRounds:Math.max(current.limits.maxRepairRounds+1,Math.ceil(maxInvocations/20)),
        maxActiveMs:Math.max(current.limits.maxActiveMs||0,maxInvocations*60*1000)};
      const result=this.deps.goals.budgets.increase({ownerId,budgetId:goal.revision.budgetId,expectedVersion:budgetVersion,requestId,limits});
      this.deps.store.db.prepare('INSERT INTO script_goal_budget_commands VALUES(?,?,?,?)').run(ownerId,requestId,envelopeHash,stableJson(result));
      return result;
    });
  }
  received(ownerId:string,raw:unknown):ScriptCommandReceipt|null{
    const command=obj(raw),requestId=id(command.requestId,'请求标识');
    const row=this.deps.store.db.prepare('SELECT envelope_hash,receipt_json FROM script_author_commands WHERE owner_id=? AND request_id=?').get(ownerId,requestId) as {envelope_hash:string;receipt_json:string}|undefined;
    if(!row)return null;assertSamePayload(row.envelope_hash,hashValue(raw));
    return JSON.parse(row.receipt_json);
  }
  private identity(raw:unknown):ScriptAuthorCommand{
    const input=obj(raw),common=['kind','requestId','threadId','expectedConversationVersion'];
    if(!['PROPOSE','APPLY','GOAL_START','GOAL_CONTINUE','GOAL_REVISE','PLANNING_REPAIR'].includes(input.kind))fail('作者命令类型无效');
    const allowed=input.kind==='PLANNING_REPAIR'?[...common,'source','instruction','target','methodIds','executionChannel']:input.kind==='PROPOSE'?[...common,'source','operation','instruction','target','methodIds','sources','executionChannel','manualGoal']:
      input.kind==='APPLY'?[...common,'workspaceId','candidateId','expectedRevision','writerEpoch','manualGoal']:
      input.kind==='GOAL_START'?[...common,'stopAfter','source','objective','task','target','methodIds','sources','executionChannel']:
      [...common,'stopAfter','goalId','expectedGoalVersion','expectedRunVersion','objective','task','target','methodIds','sources','executionChannel','answer','additionalSources'];
    exact(input,allowed,common);
    id(input.requestId,'请求标识');id(input.threadId,'会话');int(input.expectedConversationVersion,'对话版本',1);
    if(input.executionChannel!==undefined&&!['api','external'].includes(input.executionChannel))fail('执行渠道无效');
    if(input.answer!==undefined){
      if(input.kind!=='GOAL_CONTINUE')fail('回答只能用于继续当前问题');
      const answer=obj(input.answer);exact(answer,['decisionId','text','choiceId'],['decisionId','text']);
      id(answer.decisionId,'问题标识');text(answer.text,'作者回答');if(answer.choiceId!==undefined)text(answer.choiceId,'答案选项',200);
    }
    if(input.manualGoal!==undefined){
      const link=obj(input.manualGoal);exact(link,['goalId','expectedGoalVersion']);
      id(link.goalId,'接管委托');int(link.expectedGoalVersion,'委托版本',1);
      if(input.kind==='PROPOSE'&&obj(input.source).kind!=='WORKSPACE')fail('委托手动步骤必须沿用已有工作稿');
    }
    return input as ScriptAuthorCommand;
  }
  private conversation(ownerId:string,command:ScriptAuthorCommand){
    const conversation=this.deps.conversations.assertActive(command.threadId,ownerId);
    if(conversation.scopeId!=='script:home'||conversation.version!==command.expectedConversationVersion)
      fail('对话已更新，请从当前消息继续','CONVERSATION_VERSION_CONFLICT',409);
  }
  private source(ownerId:string,command:Base,raw:unknown):ScriptWorkspace{
    const source=obj(raw);if(!['NEW','PROJECT','WORKSPACE'].includes(source.kind))fail('工作稿来源无效');
    if(source.kind==='WORKSPACE'){
      exact(source,['kind','workspaceId','expectedRevision']);
      const workspace=this.deps.workspaces.read(id(source.workspaceId,'工作稿'),ownerId);
      if(workspace.threadId!==command.threadId||workspace.revision!==int(source.expectedRevision,'工作稿版本',1))fail('工作稿版本或会话已改变','WORKSPACE_CONFLICT',409);
      return workspace;
    }
    let document;
    if(source.kind==='NEW'){
      exact(source,['kind','title','profile']);
      const profile=parseProjectProfile(source.profile);
      document=createScriptProject(text(source.title,'作品标题',300),profile);
    }else{
      exact(source,['kind','projectId','revision','contentHash']);
      const projectId=id(source.projectId,'已有作品'),revision=int(source.revision,'作品版本',1);
      this.deps.workspaces.assertProjectOwner(projectId,ownerId);
      const version=this.deps.scripts.getProject(projectId);
      if(!version||version.revision!==revision||hashValue(version)!==source.contentHash)fail('当前作者稿已改变，请刷新后开始','SCRIPT_SOURCE_CONFLICT',409);
      return this.deps.workspaces.create({ownerId,threadId:command.threadId,requestId:`command:${command.requestId}:workspace`,source:{projectId,revision}});
    }
    return this.deps.workspaces.create({ownerId,threadId:command.threadId,requestId:`command:${command.requestId}:workspace`,source:{document}});
  }
  private sources(value:unknown,ownerId:string,threadId:string):ScriptReadSource[]{
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>200)return fail('来源选择无效');
    return value.map(item=>{
      const choice=obj(item);exact(choice,['purpose','ref','unitIds'],['purpose','ref']);
      if(!['CONVERSATION','PREVIOUS_SCRIPT'].includes(choice.purpose))fail('来源用途无效');
      const ref=obj(choice.ref);exact(ref,['uri','version','contentHash','branch']);
      const uri=text(ref.uri,'来源地址',500),url=new URL(uri);
      const frozen:ResourceRef={uri,version:text(ref.version,'来源版本',120),contentHash:text(ref.contentHash,'来源摘要',120),branch:text(ref.branch,'来源分支',200)};
      if(choice.purpose==='CONVERSATION'){
        if(choice.unitIds!==undefined||url.hostname!=='conversation'||!/^\/history_[\w-]+$/.test(url.pathname))fail('对话来源选择无效');
        const row=this.deps.store.db.prepare('SELECT c.thread_id,c.owner_id,c.scope_id FROM agent_conversation_sources s JOIN agent_conversations c ON c.thread_id=s.thread_id WHERE s.id=?').get(url.pathname.slice(1)) as any;
        if(!row||row.thread_id!==threadId||row.owner_id!==ownerId)fail('对话来源不属于当前作者和会话','SCRIPT_SCOPE_DENIED',403);
        return {ref:frozen,purpose:'CONVERSATION' as const,unitIds:null,access:{ownerId,scopeId:row.scope_id,branch:frozen.branch}};
      }
      const match=/^\/(projects|workspaces)\/([\w-]+)$/.exec(url.pathname);
      if(url.hostname!=='script'||!match)fail('前集来源地址无效');
      const unitIds=choice.unitIds==null?null:ids(choice.unitIds,'来源单元');
      if(unitIds!==null&&!unitIds.length)fail('来源单元选择为空');
      return {ref:frozen,purpose:'PREVIOUS_SCRIPT' as const,unitIds,access:{ownerId,scopeId:match[2],branch:frozen.branch}};
    });
  }
  private manualScope(workspace:ScriptWorkspace,command:ProposeCommand):{scope:ScriptDraftScope;target:Omit<AgentDraftRequest,'candidateId'|'operation'>;reservedUnitIds:string[]}{
    if(!AGENT_DRAFT_OPERATIONS.includes(command.operation)||!text(command.instruction,'写作要求'))fail('写作操作无效');
    const target=obj(command.target);exact(target,['initialUnit','unitId','sceneId','blockIds','selection','scopeId','entityId','initialScope','maxNewScenes','seasonId','nodeId','beforeSceneId','afterSceneId','outlineStructure','outlineSceneOrder','outlineRange','outlineBeatIds','repairCandidateId'],[]);
    const scope=empty(workspace);scope.operations=[command.operation];
    const goal=command.manualGoal?this.deps.goals.read(command.manualGoal.goalId,workspace.ownerId):null;
    const linked=goal?readScriptGoalEnvelope(goal.revision.contract).scope:null;
    const linkedLedgerRow=goal?(this.deps.store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
      .get(goal.id,goal.activeRevision) as {data_json:string}|undefined)??
      (this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?')
        .get(goal.revision.authorizationRef) as {data_json:string}|undefined):undefined;
    const linkedLedger:ScriptDraftCreationLedger=linkedLedgerRow?JSON.parse(linkedLedgerRow.data_json):emptyScriptDraftCreationLedger();
    const sourceKind=obj(command.source).kind;
    const initial=target.initialUnit===true;
    if(initial&&sourceKind!=='NEW'||initial&&target.unitId!==undefined)fail('初始单元只由新工作稿分配');
    const unitId=initial?workspace.document.units[0].id:target.unitId===undefined?undefined:id(target.unitId,'目标单元');
    const needsScene=['scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection'].includes(command.operation);
    const sceneId=initial&&needsScene&&target.sceneId===undefined?workspace.document.units[0].scenes[0].id:
      target.sceneId===undefined?undefined:id(target.sceneId,'目标场');
    const unit=workspace.document.units.find(item=>item.id===unitId),scene=unit?.scenes.find(item=>item.id===sceneId);
    const unitScope=unitId?unitGrant(unitId):null;
    if(target.seasonId!==undefined&&!['season_outline','outline_development'].includes(command.operation))fail('当前操作不接受季大纲目标');
    if(target.outlineBeatIds!==undefined&&command.operation!=='outline_development')fail('节拍目标只接受大纲开发');
    if(target.seasonId!==undefined&&target.scopeId!==undefined&&target.scopeId!==target.seasonId)fail('季大纲归属不一致');
    if([target.nodeId,target.beforeSceneId,target.afterSceneId].some(v=>v!==undefined)&&!['plan_scenes','scene_plan','scene_body','append_scene_body','plan_structure','outline_development','scene_order'].includes(command.operation))fail('当前操作不接受结构目标');
    if(target.entityId!==undefined&&!['update_character','update_fact'].includes(command.operation))fail('当前操作不接受资料标识');
    if(command.operation==='scene_order'){const unit=id(target.unitId,'目标单元');scope.units=[unitGrant(unit)];scope.sceneOrderGrants=[freezeSceneOrder(workspace.document,unit,target.nodeId)];
    }else if(command.operation==='outline_development'){
      if(!unit||!unitScope||sceneId||target.blockIds||target.selection||target.initialScope||target.beforeSceneId||target.afterSceneId)fail('大纲开发需要明确单元及原文范围');
      const owner:OutlineOwner=target.seasonId?{kind:'season',id:id(target.seasonId,'季')}:target.scopeId?{kind:target.scopeId===workspace.document.id?'project':'story',id:id(target.scopeId,'故事')}:{kind:'unit',id:unit.id};
      if(owner.kind==='season'?!unitBelongsToSeason(workspace.document,unit,owner.id):owner.kind!=='unit'&&owner.id!==workspace.document.id&&owner.id!==unit.scopeId)fail('大纲不属于当前故事');
      const structural=owner.kind==='unit'||owner.kind==='project'&&workspace.document.profile.organization==='standalone';
      scope.outlineGrants=[freezeOutlineGrant(workspace.document,owner,{nodeId:target.nodeId,...(target.outlineBeatIds!==undefined?{outlineBeatIds:ids(target.outlineBeatIds,'目标节拍')}:{}),allowStructure:structural&&!target.outlineBeatIds&&!target.nodeId&&!target.outlineRange&&target.outlineStructure===true,allowSceneOrder:structural&&!target.outlineBeatIds&&!target.nodeId&&!target.outlineRange&&target.outlineStructure===true&&target.outlineSceneOrder===true,structureUnitId:unit.id,...(target.outlineRange?{range:{...selectedText(target.outlineRange),quote:selectedText(target.outlineRange).text}}:{})})];scope.units=[unitScope];
      if(target.repairCandidateId){
        const record=this.deps.drafts.readCandidate(workspace.ownerId,id(target.repairCandidateId,'原候选'));
        if(record.workspaceId!==workspace.id||record.request.operation!=='outline_development'||record.request.unitId!==unit.id)fail('原候选目标或版本已变化');
        const renewed=this.deps.drafts.repairGrants(workspace,record),requested=scope.outlineGrants[0],prior=renewed?.[0];
        if(!prior||!same(requested.owner,prior.owner))fail('补齐请求的大纲归属与原候选不同');
        if(prior.start<requested.start||prior.end>requested.end)fail('补齐请求不能扩大明确选择的原文范围');
        if(target.outlineBeatIds!==undefined&&!same(requested.outlineBeatIds??null,prior.outlineBeatIds??null))fail('补齐请求不能扩大所选节拍目标');
        if(target.nodeId!==undefined&&requested.nodeId!==prior.nodeId||target.outlineRange!==undefined&&prior.nodeId!==undefined)fail('补齐请求不能改变明确选择的段落权限');
        const explicitRange=target.outlineRange!==undefined||target.outlineBeatIds!==undefined;
        if((explicitRange||target.outlineStructure!==undefined)&&prior.allowStructure&&!requested.allowStructure||
          (explicitRange||target.outlineSceneOrder!==undefined)&&prior.allowSceneOrder&&!requested.allowSceneOrder)fail('补齐请求不能扩大明确选择的结构或场序权限');
        scope.outlineGrants=renewed;
      }
    }else if([...BLUEPRINT_BRIEF_FIELDS,'project_outline'].includes(command.operation)){
      if(unitId||sceneId||target.scopeId||target.initialScope||target.blockIds||target.selection||target.maxNewScenes!==undefined)fail('作品字段命令含多余目标');
      scope.sharedFields=[command.operation==='project_outline'?'outline':command.operation as BlueprintBriefField];
    }else if(command.operation==='story_outline'||command.operation==='season_outline'){
      if(!unit||!unitScope||sceneId||target.blockIds||target.selection||target.initialScope)fail('故事大纲需要明确所属单元且不包含正文目标');
      if(command.operation==='story_outline'){
        const scopeId=id(target.scopeId,'故事范围');
        if(scopeId!==unit.scopeId||scopeId===workspace.document.id||workspace.document.seasons?.some(season=>season.id===scopeId))fail('故事大纲归属不匹配');
        scope.storyOutlineScopeIds=[scopeId];
      }else{
        const seasonId=id(target.seasonId,'季故事');
        if(!unitBelongsToSeason(workspace.document,unit,seasonId))fail('季大纲不属于当前单元');
        scope.seasonOutlineIds=[seasonId];
      }
      scope.units=[unitScope];
    }else if(command.operation==='add_unit'){
      if(unitId||sceneId||target.blockIds||target.selection||target.initialScope)fail('新单元不得指定旧目标');
      if(workspace.document.profile.organization==='standalone')fail('独立电影不能新增分集');
      const reserved=linked?.newUnitSlots.find(slot=>!workspace.document.units.some(unit=>unit.id===slot.unitId)&&
        !linkedLedger.units.some(item=>item.slotId===slot.slotId));
      if(linked&&!reserved)fail('关联委托没有可用的新单元槽','MANUAL_GOAL_SCOPE_DENIED',403);
      const slotId=reserved?.slotId??stable('slot',{requestId:command.requestId,workspaceId:workspace.id});
      const reservedId=reserved?.unitId??stable('unit',{requestId:command.requestId,workspaceId:workspace.id});
      const maxNewScenes=target.maxNewScenes===undefined?(reserved?.maxNewScenes??30):int(target.maxNewScenes,'新单元场数额度',0,1000);
      if(reserved&&maxNewScenes>reserved.maxNewScenes)
        fail('新增场数超过关联委托额度','MANUAL_GOAL_SCOPE_DENIED',403);
      const newScopeId=target.scopeId===undefined?scopeIdFor(workspace,reservedId):id(target.scopeId,'延续故事');
      if(target.scopeId!==undefined&&newScopeId!==workspace.document.id&&!workspace.document.units.some(unit=>unit.scopeId===newScopeId)&&!workspace.document.seasons?.some(season=>season.id===newScopeId))fail('延续故事不存在');
      if(reserved&&target.scopeId!==undefined&&reserved.scopeId!==newScopeId)fail('新集故事范围超出原委托');
      scope.newUnitSlots=[reserved?{...reserved,maxNewScenes}:{slotId,unitId:reservedId,scopeId:newScopeId,targetDurationMs:workspace.document.profile.targetDurationMs,maxNewScenes}];
      scope.units=[{...unitGrant(reservedId),allowSummary:true,allowAllScenes:true,maxNewScenes}];
      return {scope,target:{slotId},reservedUnitIds:[reservedId]};
    }else if(command.operation==='update_character'||command.operation==='update_fact'){
      if(sceneId||target.blockIds||target.selection||target.scopeId||target.initialScope||target.maxNewScenes!==undefined)fail('资料修改含多余目标');
      const isCharacter=command.operation==='update_character',entityId=id(target.entityId,'资料标识');
      const entity=(isCharacter?workspace.document.characters:workspace.document.facts).find(item=>item.id===entityId);
      if(!unit||!unitScope||!entity||!visibleInUnit(entity.scopeId,workspace.document,unit))fail('资料不属于当前故事范围');
      scope[isCharacter?'characterIds':'factIds']=[entityId];scope.units=[unitScope];
    }else if(command.operation==='add_character'||command.operation==='add_fact'){
      if(unitId||sceneId||target.blockIds||target.selection||target.maxNewScenes!==undefined)fail('共享实体命令含多余目标');
      if(target.initialScope!==undefined&&(sourceKind!=='NEW'||target.scopeId!==undefined||
        !['PROJECT','UNIT'].includes(target.initialScope)))fail('初始实体作用域无效');
      const entityScope=target.initialScope==='PROJECT'?workspace.document.id:
        target.initialScope==='UNIT'?workspace.document.units[0].scopeId:id(target.scopeId,'实体作用域');
      if(entityScope!==workspace.document.id&&!workspace.document.units.some(unit=>unit.id===entityScope||unit.scopeId===entityScope))fail('实体作用域不属于工作稿');
      if(command.operation==='add_character')scope.characterScopeIds=[entityScope];else scope.factScopeIds=[entityScope];
    }else{
      if(!unit||!unitScope)fail('必须明确选择已有单元');
      if(command.operation==='unit_outline'){
        if(sceneId||target.blockIds||target.selection||target.initialScope||target.maxNewScenes!==undefined)fail('单元大纲不能包含正文目标');
        unitScope.allowSummary=true;
      }else if(command.operation==='plan_scenes'){
        if(sceneId||target.blockIds||target.selection||target.initialScope)fail('分场目标只能是选中单元');
        const allowed=linked?.units.find(item=>item.unitId===unitId);
        const remaining=allowed?allowed.maxNewScenes-linkedLedger.scenes.filter(item=>item.unitId===unitId).length:30;
        if(linked&&remaining<1)fail('关联委托新增场数额度已用尽','MANUAL_GOAL_SCOPE_DENIED',403);
        unitScope.maxNewScenes=target.maxNewScenes===undefined?Math.min(30,remaining):int(target.maxNewScenes,'新增场数额度',1,1000);
        if(linked&&unitScope.maxNewScenes>remaining)fail('新增场数超过关联委托剩余额度','MANUAL_GOAL_SCOPE_DENIED',403);
        if(target.nodeId){unitScope.nodeScopes=[freezeStructureScope(workspace.document,unit.id,id(target.nodeId,'目标段落'),{allowCreate:true})];}
        else unitScope.allowAllScenes=linked?Boolean(allowed?.allowAllScenes):true;
      }else if(command.operation==='plan_structure'){
        if(sceneId||target.blockIds||target.selection||target.nodeId)fail('结构目录需要整个单元');
        unitScope.allowAllScenes=true;unitScope.allowStructure=true;
      }else if(command.operation==='scene_plan'){
        if(!scene||target.blockIds||target.selection||target.initialScope)fail('场景规划需要明确整场范围');
        unitScope.scenes=[{sceneId:scene.id,allowPlan:true,allowBody:false,blockIds:null}];
      }else{
        if(!scene||target.initialScope)fail('必须明确选择已有场景');
        const blockIds=target.blockIds===undefined?undefined:ids(target.blockIds,'正文块');
        const selection=target.selection===undefined?undefined:selectedText(target.selection);
        if(['scene_body','append_scene_body'].includes(command.operation)&&(blockIds||selection)||command.operation==='replace_blocks'&&(!blockIds?.length||selection)||
          command.operation==='replace_selection'&&(!selection||blockIds))fail('正文操作与所选范围不匹配');
        unitScope.scenes=[sceneGrant(sceneId,blockIds??null,selection)];
      }
      scope.units=[unitScope];
    }
    validateScriptDraftScope(workspace.document,scope);
    return {scope,target:{unitId,sceneId,entityId:target.entityId,scopeId:target.initialScope==='PROJECT'?workspace.document.id:
      target.initialScope==='UNIT'?workspace.document.units[0].scopeId:target.scopeId,
      blockIds:target.blockIds,selection:target.selection,...(target.repairCandidateId?{repairCandidateId:id(target.repairCandidateId,'原候选')} :{}),seasonId:target.seasonId,nodeId:target.nodeId,beforeSceneId:target.beforeSceneId,afterSceneId:target.afterSceneId,
      ...(command.operation==='append_scene_body'?{continuationCheckpoint:createSceneContinuationCheckpoint(workspace.document,unitId!,sceneId!)}:{})},reservedUnitIds:[]};
  }
  private goalScope(workspace:ScriptWorkspace,commandId:string,value:GoalTarget,fromNew:boolean,previous?:ScriptDraftScope){
    const target=obj(value);exact(target,['initialUnit','initialMaxNewScenes','unitIds','wholeUnitIds','sceneIds','maxNewScenes','newUnitCount','newUnitMaxScenes','sharedFields','characterScopeIds','factScopeIds','characterIds','factIds','initialCharacterScope','initialFactScope','newUnitCharacterScopes','newUnitFactScopes','structureTargets','storyOutlineScopeIds','seasonOutlineIds','newUnitScopeId','outlineTarget'],[]);
    if(target.initialUnit!==undefined&&target.initialUnit!==true)fail('初始单元标志无效');
    if(target.initialUnit&&!fromNew)fail('只有新工作稿可选择服务器初始单元');
    if(target.initialMaxNewScenes!==undefined&&!target.initialUnit)fail('初始场数额度只能用于新作品');
    const unitIds=target.initialUnit?[workspace.document.units[0].id]:ids(target.unitIds??[],'目标单元');
    const whole=target.initialUnit?[workspace.document.units[0].id]:ids(target.wholeUnitIds??[],'整单元授权');
    const scenes=target.sceneIds??[];if(!Array.isArray(scenes)||scenes.length>1000)fail('场景授权无效');
    const newSceneLimits=target.maxNewScenes??[];if(!Array.isArray(newSceneLimits)||newSceneLimits.length>1000)fail('新增场数授权无效');
    const scope=empty(workspace),units=unitIds.map(unitId=>{if(!workspace.document.units.some(unit=>unit.id===unitId))fail('目标单元不存在');return unitGrant(unitId);});
    if(whole.some(unitId=>!unitIds.includes(unitId)))fail('整单元超出目标');
    for(const grant of units)if(whole.includes(grant.unitId)){
      grant.allowAllScenes=true;grant.allowSummary=true;grant.maxNewScenes=100;grant.allowStructure=true;
    }
    if(target.initialUnit&&target.initialMaxNewScenes!==undefined)units[0].maxNewScenes=int(target.initialMaxNewScenes,'初始单元场数额度',1,1000);
    const sceneKeys=new Set<string>();
    for(const item of scenes){const entry=obj(item);exact(entry,['unitId','sceneId']);const unitId=id(entry.unitId,'场景单元'),sceneId=id(entry.sceneId,'目标场'),key=`${unitId}/${sceneId}`;
      if(sceneKeys.has(key))fail('场景授权重复');sceneKeys.add(key);
      const grant=units.find(unit=>unit.unitId===unitId),unit=workspace.document.units.find(unit=>unit.id===unitId);
      if(!grant||!unit?.scenes.some(scene=>scene.id===sceneId))fail('场景不在目标单元');
      grant.scenes.push(sceneGrant(sceneId));
    }
    const structureTargets=target.structureTargets??[];if(!Array.isArray(structureTargets)||structureTargets.length>1000)fail('结构范围无效');
    for(const raw of structureTargets){const entry=obj(raw);exact(entry,['unitId','nodeId']);
      const grant=units.find(unit=>unit.unitId===id(entry.unitId,'结构单元')),nodeId=id(entry.nodeId,'结构节点');
      if(!grant||grant.allowAllScenes||grant.nodeScopes?.some(node=>node.nodeId===nodeId))fail('结构范围重复或与整单元冲突');
      const frozen=freezeStructureScope(workspace.document,grant.unitId,nodeId,{allowCreate:true});
      grant.nodeScopes=[...grant.nodeScopes??[],frozen];grant.maxNewScenes=100;
      for(const sceneId of frozen.sceneIds)if(!grant.scenes.some(scene=>scene.sceneId===sceneId))grant.scenes.push({...sceneGrant(sceneId),allowPlan:true});
    }
    for(const grant of units)if(!grant.allowAllScenes&&!grant.scenes.length&&!grant.nodeScopes?.length&&
      ![target.sharedFields,target.characterIds,target.factIds,target.storyOutlineScopeIds,target.seasonOutlineIds,target.outlineTarget?[true]:undefined].some(values=>Array.isArray(values)&&values.length))fail('单元授权需要明确整单元、具体场或共享资料');
    const limited=new Set<string>();
    for(const row of newSceneLimits){const entry=obj(row);exact(entry,['unitId','count']);const unitId=id(entry.unitId,'新增场数单元'),grant=units.find(item=>item.unitId===unitId);
      if(!grant||limited.has(unitId))fail('新增场数额度重复或越界');limited.add(unitId);grant.maxNewScenes=int(entry.count,'新增场数额度',1,1000);
    }
    const count=target.newUnitCount===undefined?0:int(target.newUnitCount,'新单元数量',0,100);
    const explicitStory=target.newUnitScopeId===undefined?undefined:id(target.newUnitScopeId,'新集故事');
    if(explicitStory&&(!count||explicitStory!==workspace.document.id&&!workspace.document.units.some(unit=>unit.scopeId===explicitStory)&&!workspace.document.seasons?.some(season=>season.id===explicitStory)))fail('新集延续范围不存在');
    if(count&&workspace.document.profile.organization==='standalone')fail('独立电影不能新增分集');
    if((target.newUnitCharacterScopes!==undefined&&typeof target.newUnitCharacterScopes!=='boolean')||
      (target.newUnitFactScopes!==undefined&&typeof target.newUnitFactScopes!=='boolean')||
      !count&&(target.newUnitCharacterScopes||target.newUnitFactScopes))fail('新单元实体授权无效');
    const newUnitMaxScenes=target.newUnitMaxScenes===undefined?100:int(target.newUnitMaxScenes,'新单元新增场数',1,1000);
    if(!count&&target.newUnitMaxScenes!==undefined)fail('没有新单元，不能设置新单元场数');
    const reservedUnitIds:string[]=[];
    const pendingSlots=previous?.newUnitSlots.filter(slot=>!workspace.document.units.some(unit=>unit.id===slot.unitId))??[];
    for(let index=0;index<count;index++){
      const existing=pendingSlots[index];
      const slotId=existing?.slotId??stable('slot',{commandId,workspaceId:workspace.id,index}),unitId=existing?.unitId??stable('unit',{commandId,workspaceId:workspace.id,index});
      reservedUnitIds.push(unitId);scope.newUnitSlots.push({...(existing??{slotId,unitId,scopeId:explicitStory??scopeIdFor(workspace,unitId),targetDurationMs:workspace.document.profile.targetDurationMs}),...(explicitStory?{scopeId:explicitStory}:{}),maxNewScenes:newUnitMaxScenes});
      units.push({...unitGrant(unitId),allowSummary:true,allowAllScenes:true,allowStructure:true,maxNewScenes:newUnitMaxScenes});
    }
    if(!units.length)fail('必须明确选择目标单元或新单元');
    scope.units=units;
    scope.characterIds=ids(target.characterIds??[],'待修改人物');scope.factIds=ids(target.factIds??[],'待修改设定');
    scope.sharedFields=ids(target.sharedFields??[],'共享字段') as ScriptDraftScope['sharedFields'];
    scope.storyOutlineScopeIds=ids(target.storyOutlineScopeIds??[],'故事大纲范围');
    scope.seasonOutlineIds=ids(target.seasonOutlineIds??[],'季大纲范围');
    if(scope.storyOutlineScopeIds.some(scopeId=>!workspace.document.units.some(unit=>unitIds.includes(unit.id)&&unit.scopeId===scopeId))||
      scope.seasonOutlineIds.some(seasonId=>!workspace.document.units.some(unit=>unitIds.includes(unit.id)&&unit.scopeId===seasonId)))fail('故事大纲不属于目标单元');
    const initialScope=(choice:unknown,label:string)=>{
      if(choice===undefined)return null;
      if(!fromNew||!['PROJECT','UNIT'].includes(choice as string))fail(`${label}无效`);
      return choice==='PROJECT'?workspace.document.id:workspace.document.units[0].scopeId;
    };
    const initialCharacter=initialScope(target.initialCharacterScope,'初始人物作用域');
    const initialFact=initialScope(target.initialFactScope,'初始事实作用域');
    scope.characterScopeIds=ids(target.characterScopeIds??[],'人物作用域');
    scope.factScopeIds=ids(target.factScopeIds??[],'事实作用域');
    if(initialCharacter)scope.characterScopeIds.push(initialCharacter);
    if(initialFact)scope.factScopeIds.push(initialFact);
    if(target.newUnitCharacterScopes)scope.characterScopeIds.push(...scope.newUnitSlots.map(slot=>slot.scopeId));
    if(target.newUnitFactScopes)scope.factScopeIds.push(...scope.newUnitSlots.map(slot=>slot.scopeId));
    scope.characterScopeIds=[...new Set(scope.characterScopeIds)];scope.factScopeIds=[...new Set(scope.factScopeIds)];
    scope.operations=[...(units.some(unit=>unit.allowSummary)?['unit_outline'] as const:[]),
      ...(units.some(unit=>unit.maxNewScenes>0)?['plan_scenes'] as const:[]),
      ...(units.some(unit=>unit.allowStructure)?['plan_structure'] as const:[]),
      ...(units.some(unit=>unit.allowAllScenes||unit.scenes.length||unit.nodeScopes?.length)?['scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection'] as const:[]),
      ...(scope.storyOutlineScopeIds.length?['story_outline'] as const:[]),...(scope.seasonOutlineIds.length?['season_outline'] as const:[]),
      ...(count?['add_unit'] as const:[]),...scope.sharedFields.map(field=>field==='outline'?'project_outline':field) as AgentDraftOperation[],
      ...(scope.characterIds.length?['update_character'] as const:[]),...(scope.factIds.length?['update_fact'] as const:[]),...(scope.characterScopeIds.length?['add_character'] as const:[]),...(scope.factScopeIds.length?['add_fact'] as const:[])];
    if(target.outlineTarget){
      const entry=obj(target.outlineTarget);exact(entry,['unitId','scopeId','seasonId','nodeId','allowStructure','allowSceneOrder'],['unitId']);
      const unit=workspace.document.units.find(u=>u.id===entry.unitId);if(!unit||!unitIds.includes(unit.id))fail('联合大纲目标不属于所选单元');
      const owner:OutlineOwner=entry.seasonId?{kind:'season',id:entry.seasonId}:entry.scopeId?{kind:entry.scopeId===workspace.document.id?'project':'story',id:entry.scopeId}:{kind:'unit',id:unit.id};
      if(owner.kind!=='unit'&&owner.id!==workspace.document.id&&owner.id!==unit.scopeId)fail('联合大纲超出所选故事');
      const structural=owner.kind==='unit'||owner.kind==='project'&&workspace.document.profile.organization==='standalone';
      scope.outlineGrants=[freezeOutlineGrant(workspace.document,owner,{nodeId:entry.nodeId,structureUnitId:unit.id,allowStructure:structural&&entry.allowStructure===true&&!entry.nodeId,allowSceneOrder:structural&&entry.allowStructure===true&&entry.allowSceneOrder===true&&!entry.nodeId})];
      scope.operations.push('outline_development');
    }
    scope.operations=[...new Set(scope.operations)];
    validateScriptDraftScope(workspace.document,scope);
    return {scope,targetUnitIds:[...unitIds,...reservedUnitIds],reservedUnitIds};
  }
  private reviewScope(workspace:ScriptWorkspace,value:GoalTarget,fromNew:boolean){
    const target=obj(value);exact(target,['initialUnit','unitIds','structureTargets'],[]);
    if(target.initialUnit!==undefined&&target.initialUnit!==true||target.initialUnit&&!fromNew||
      target.initialUnit&&target.unitIds!==undefined)fail('审阅单元选择无效');
    const unitIds=target.initialUnit?[workspace.document.units[0].id]:ids(target.unitIds??[],'审阅单元');
    if(!unitIds.length||unitIds.some(unitId=>!workspace.document.units.some(unit=>unit.id===unitId)))fail('审阅必须选定已有正文单元');
    const scope=empty(workspace);scope.units=unitIds.map(unitGrant);
    if(target.structureTargets!==undefined){
      if(!Array.isArray(target.structureTargets)||!target.structureTargets.length)fail('审阅段落无效');
      for(const raw of target.structureTargets){const item=obj(raw);exact(item,['unitId','nodeId']);
        const grant=scope.units.find(unit=>unit.unitId===item.unitId);if(!grant)fail('审阅段落越界');
        grant.nodeScopes=[...grant.nodeScopes??[],freezeStructureScope(workspace.document,grant.unitId,id(item.nodeId,'审阅段落'),{allowCreate:false})];
      }
    }
    validateScriptDraftScope(workspace.document,scope);
    return {scope,targetUnitIds:unitIds,reservedUnitIds:[]};
  }
  private carryGoalScope(workspace:ScriptWorkspace,old:ScriptDraftScope,goalId:string,goalRevision:number,authorizationId:string,reselect=false){
    const row=this.deps.store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
      .get(goalId,goalRevision) as {data_json:string}|undefined ??
      this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(authorizationId) as {data_json:string}|undefined;
    const ledger:ScriptDraftCreationLedger=row?JSON.parse(row.data_json):emptyScriptDraftCreationLedger();
    const scope=structuredClone(old);
    scope.originRevision=workspace.revision;scope.originContentHash=hashValue(workspace.document);
    for(const slot of scope.newUnitSlots)if(workspace.document.units.some(unit=>unit.id===slot.unitId)&&
      !ledger.units.some(item=>item.slotId===slot.slotId&&item.unitId===slot.unitId))
      fail('预留单元已被非委托写入占用','SCRIPT_SCOPE_DENIED',403);
    scope.newUnitSlots=scope.newUnitSlots.filter(slot=>!ledger.units.some(item=>item.slotId===slot.slotId&&item.unitId===slot.unitId));
    if(!scope.newUnitSlots.length)scope.operations=scope.operations.filter(operation=>operation!=='add_unit');
    for(const grant of scope.units){
      const current=workspace.document.units.find(unit=>unit.id===grant.unitId);
      if(!current)continue;
      const created=ledger.scenes.filter(item=>item.unitId===grant.unitId);
      if(created.length>grant.maxNewScenes)
        fail('旧委托创建台账与当前稿不一致','SCRIPT_SCOPE_DENIED',403);
      grant.maxNewScenes-=created.length;
      for(const scene of created)if(!grant.allowAllScenes&&current.scenes.some(item=>item.id===scene.sceneId)&&
        !grant.scenes.some(item=>item.sceneId===scene.sceneId))grant.scenes.push({...sceneGrant(scene.sceneId),allowPlan:scope.operations.includes('scene_plan')});
    }
    if(!reselect){
      for(const grant of old.units)for(const node of grant.nodeScopes??[])assertFrozenStructureScopeCurrent(workspace.document,grant.unitId,node,ledger.scenes);
      for(const grant of scope.units)if(grant.nodeScopes?.length)grant.nodeScopes=grant.nodeScopes.map(node=>freezeStructureScope(workspace.document,grant.unitId,node.nodeId,{allowCreate:node.allowCreate,stopAfterSceneId:node.stopAfterSceneId}));
      validateScriptDraftScope(workspace.document,scope);
    }
    return scope;
  }
  goalCreatedSceneCounts(goalId:string,throughRevision:number){
    const rows=this.deps.store.db.prepare(`SELECT r.data_json,l.data_json AS ledger_json
      FROM agent_goal_revisions r LEFT JOIN script_goal_creation_ledgers l
      ON l.goal_id=r.goal_id AND l.goal_revision=r.revision
      WHERE r.goal_id=? AND r.revision<=? ORDER BY r.revision`).all(goalId,throughRevision) as
      Array<{data_json:string;ledger_json:string|null}>;
    const idsByUnit=new Map<string,Set<string>>();
    for(const row of rows){
      const revision=JSON.parse(row.data_json) as GoalRevisionInput;
      const legacy=!row.ledger_json?this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?')
        .get(revision.authorizationRef) as {data_json:string}|undefined:undefined;
      const ledger:ScriptDraftCreationLedger=row.ledger_json?JSON.parse(row.ledger_json):legacy?JSON.parse(legacy.data_json):emptyScriptDraftCreationLedger();
      for(const scene of ledger.scenes){
        if(!idsByUnit.has(scene.unitId))idsByUnit.set(scene.unitId,new Set());
        idsByUnit.get(scene.unitId)!.add(scene.sceneId);
      }
    }
    return new Map([...idsByUnit].map(([unitId,ids])=>[unitId,ids.size]));
  }
  private applyScope(workspace:ScriptWorkspace,candidateId:string,ownerId:string){
    const candidate=this.deps.drafts.readCandidate(ownerId,candidateId,'VIEW');
    if(candidate.status!=='VALID'||!candidate.candidate||candidate.workspaceId!==workspace.id||
      !same(candidate.baseRef,workspaceRef(workspace)))fail('候选与当前工作稿版本不一致','SCRIPT_DRAFT_DENIED',403);
    const old=this.deps.authorizations.read(candidate.authorizationId,ownerId),originalRun=this.deps.store.readRun(candidate.runId,ownerId),
      source=(originalRun.input as any)?.planningRepair?this.deps.drafts.scopeForRun(originalRun):old.scope as ScriptDraftScope,request=candidate.request;
    if(old.workspaceId!==workspace.id||!source.operations.includes(request.operation))fail('候选来源授权无效','SCRIPT_DRAFT_DENIED',403);
    const ledgerRow=this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(old.id) as {data_json:string}|undefined;
    const sourceLedger:ScriptDraftCreationLedger=ledgerRow?JSON.parse(ledgerRow.data_json):emptyScriptDraftCreationLedger();
    assertStructureScopesCurrent(workspace.document,source,sourceLedger);
    const scope=empty(workspace);scope.operations=[request.operation];
    if(request.operation==='scene_order'){scope.units=[unitGrant(request.unitId!)];scope.sceneOrderGrants=structuredClone(source.sceneOrderGrants);
    }else if(request.operation==='outline_development'){const unitId=id(request.unitId,'大纲单元'),grant=source.outlineGrants?.[0];if(!grant||!source.units.some(unit=>unit.unitId===unitId))fail('候选大纲未授权');scope.outlineGrants=structuredClone(source.outlineGrants);scope.units=[unitGrant(unitId)];
    }else if([...BLUEPRINT_BRIEF_FIELDS,'project_outline'].includes(request.operation)){
      const field=request.operation==='project_outline'?'outline':request.operation as BlueprintBriefField;
      if(!source.sharedFields.includes(field))fail('候选共享字段未授权');scope.sharedFields=[field];
    }else if(request.operation==='story_outline'||request.operation==='season_outline'){
      const key=request.operation==='story_outline'?'storyOutlineScopeIds':'seasonOutlineIds';
      const value=id(request.operation==='story_outline'?request.scopeId:request.seasonId,'大纲归属');
      if(!source[key]?.includes(value))fail('大纲归属未授权');scope[key]=[value];
      if(request.unitId)scope.units=[unitGrant(request.unitId)];
    }else if(request.operation==='update_character'||request.operation==='update_fact'){
      const field=request.operation==='update_character'?'characterIds':'factIds',entityId=id(request.entityId,'资料标识');
      if(!source[field]?.includes(entityId))fail('资料修改未授权');scope[field]=[entityId];
      if(request.unitId)scope.units=[unitGrant(request.unitId)];
    }else if(request.operation==='add_character'||request.operation==='add_fact'){
      const field=request.operation==='add_character'?'characterScopeIds':'factScopeIds',value=id(request.scopeId,'实体作用域');
      if(!source[field].includes(value))fail('候选实体范围未授权');scope[field]=[value];
    }else if(request.operation==='add_unit'){
      const slot=source.newUnitSlots.find(item=>item.slotId===request.slotId);
      if(!slot)fail('候选新单元槽未授权');scope.newUnitSlots=[slot];
      scope.units=[structuredClone(source.units.find(item=>item.unitId===slot.unitId)??unitGrant(slot.unitId))];
    }else{
      const unitId=id(request.unitId,'候选单元'),grant=source.units.find(item=>item.unitId===unitId);
      if(!grant)fail('候选单元未授权');
      const narrow=unitGrant(unitId);
      if(request.operation==='unit_outline')narrow.allowSummary=grant.allowSummary;
      else if(request.operation==='plan_scenes'){
        narrow.maxNewScenes=Array.isArray((candidate.candidate.result as any).scenes)?(candidate.candidate.result as any).scenes.length:0;
        narrow.allowAllScenes=grant.allowAllScenes;
        if(request.nodeId)narrow.nodeScopes=(grant.nodeScopes?.filter(node=>node.nodeId===request.nodeId)??[]).map(node=>freezeStructureScope(workspace.document,unitId,node.nodeId,{allowCreate:node.allowCreate,stopAfterSceneId:node.stopAfterSceneId}));
      }else if(request.operation==='plan_structure'){narrow.allowAllScenes=grant.allowAllScenes;narrow.allowStructure=grant.allowStructure;}
      else{
        const sceneId=id(request.sceneId,'候选场景'),oldScene=grant.scenes.find(item=>item.sceneId===sceneId);
        if(!oldScene&&!grant.allowAllScenes&&!sourceLedger.scenes.some(scene=>scene.unitId===unitId&&scene.sceneId===sceneId))fail('候选场景未授权');
        narrow.scenes=[request.operation==='scene_plan'?{sceneId,allowPlan:true,allowBody:false,blockIds:null}:sceneGrant(sceneId,request.blockIds??null,request.selection)];
      }
      scope.units=[narrow];
    }
    validateScriptDraftScope(workspace.document,scope);
    return {scope,sources:old.sources};
  }
  private methods(idsValue:unknown){return ids(idsValue,'Skill 标识',100);}
  private chatChoiceAllowed(scope:ScriptDraftScope,goal:ScriptDraftScope,ledger:ScriptDraftCreationLedger,workspace:ScriptWorkspace){
    if(scope.operations.some(operation=>!goal.operations.includes(operation))||
      scope.sharedFields.some(field=>!goal.sharedFields.includes(field))||
      scope.characterScopeIds.some(value=>!goal.characterScopeIds.includes(value))||
      scope.factScopeIds.some(value=>!goal.factScopeIds.includes(value))||
      (scope.sceneOrderGrants??[]).some(grant=>!goal.sceneOrderGrants?.some(allowed=>same(grant,allowed)))||
      (scope.outlineGrants??[]).some(grant=>!goal.outlineGrants?.some(allowed=>same(grant,allowed)))||
      (scope.storyOutlineScopeIds??[]).some(value=>!goal.storyOutlineScopeIds?.includes(value))||(scope.seasonOutlineIds??[]).some(value=>!goal.seasonOutlineIds?.includes(value))||
      (scope.characterIds??[]).some(value=>!goal.characterIds?.includes(value))||(scope.factIds??[]).some(value=>!goal.factIds?.includes(value)))return false;
    for(const slot of scope.newUnitSlots)if(!goal.newUnitSlots.some(item=>item.slotId===slot.slotId&&item.unitId===slot.unitId&&
      item.scopeId===slot.scopeId&&item.targetDurationMs===slot.targetDurationMs&&slot.maxNewScenes<=item.maxNewScenes)||
      ledger.units.some(item=>item.slotId===slot.slotId))return false;
    for(const selected of scope.units){
      const allowed=goal.units.find(unit=>unit.unitId===selected.unitId);
      if(!allowed||selected.allowSummary&&!allowed.allowSummary||selected.allowAllScenes&&!allowed.allowAllScenes||selected.allowStructure&&!allowed.allowStructure||
        (selected.nodeScopes??[]).some(node=>!allowed.allowAllScenes&&!allowed.nodeScopes?.some(permit=>permit.nodeId===node.nodeId&&(!node.allowCreate||permit.allowCreate)))||
        selected.maxNewScenes>allowed.maxNewScenes-ledger.scenes.filter(scene=>scene.unitId===selected.unitId).length)return false;
      for(const scene of selected.scenes){
        const original=allowed.scenes.find(item=>item.sceneId===scene.sceneId);
        if(!allowed.allowAllScenes&&!original&&!ledger.scenes.some(item=>item.unitId===selected.unitId&&item.sceneId===scene.sceneId)||original&&((scene.allowBody&&!original.allowBody)||(scene.allowPlan&&!original.allowPlan))||original?.selection&&!same(original.selection,scene.selection))return false;
        if(original?.blockIds!==null&&original?.blockIds!==undefined){
          const selectedBlocks=scene.selection?selectionBlockIds(workspace.document,selected.unitId,scene.sceneId,scene.selection):scene.blockIds;
          if(!selectedBlocks?.length||selectedBlocks.some(value=>!original.blockIds!.includes(value)))return false;
        }
        if(original?.selection&&!scope.operations.includes('replace_selection'))return false;
      }
    }
    return true;
  }
  private attachManualGoal(ownerId:string,command:ProposeCommand|ApplyCommand,auth:{id:string;workspaceRef:ResourceRef},runId:string){
    if(!command.manualGoal)return;
    const link=command.manualGoal;
    const goal=this.deps.goals.read(link.goalId,ownerId),goalScope=readScriptGoalEnvelope(goal.revision.contract).scope;
    const manual=this.deps.authorizations.read(auth.id,ownerId),scope=manual.scope as ScriptDraftScope;
    const workspace=this.deps.workspaces.read(manual.workspaceId,ownerId);
    if(goal.version!==link.expectedGoalVersion||goalScope.workspaceId!==workspace.id||
      !scope.operations.length||scope.operations.some(operation=>!goalScope.operations.includes(operation)))
      fail('手动接管超出当前委托范围','MANUAL_GOAL_SCOPE_DENIED',403);
    const ledgerRow=(this.deps.store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
      .get(goal.id,goal.activeRevision) as {data_json:string}|undefined)??
      (this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?')
        .get(goal.revision.authorizationRef) as {data_json:string}|undefined);
    const ledger:ScriptDraftCreationLedger=ledgerRow?JSON.parse(ledgerRow.data_json):emptyScriptDraftCreationLedger();
    for(const slot of scope.newUnitSlots)if(!goalScope.newUnitSlots.some(item=>item.slotId===slot.slotId&&item.unitId===slot.unitId&&
      item.scopeId===slot.scopeId&&item.targetDurationMs===slot.targetDurationMs&&slot.maxNewScenes<=item.maxNewScenes)||
      ledger.units.some(item=>item.slotId===slot.slotId))
      fail('手动新单元槽不在委托剩余额度内','MANUAL_GOAL_SCOPE_DENIED',403);
    const goalSources=this.deps.authorizations.read(goal.revision.authorizationRef,ownerId).sources;
    if(manual.sources.some(source=>!goalSources.some(allowed=>same(allowed.ref,source.ref)&&same(allowed.access,source.access)&&
      allowed.purpose===source.purpose&&(allowed.unitIds===null||source.unitIds!==null&&source.unitIds.every(id=>allowed.unitIds!.includes(id))))))
      fail('手动接管的来源超出当前委托选择','MANUAL_GOAL_SCOPE_DENIED',403);
    if(scope.sharedFields.some(field=>!goalScope.sharedFields.includes(field))||
      scope.characterScopeIds.some(id=>!goalScope.characterScopeIds.includes(id))||
      scope.factScopeIds.some(id=>!goalScope.factScopeIds.includes(id))||
      (scope.storyOutlineScopeIds??[]).some(id=>!goalScope.storyOutlineScopeIds?.includes(id))||(scope.seasonOutlineIds??[]).some(id=>!goalScope.seasonOutlineIds?.includes(id))||
      (scope.characterIds??[]).some(id=>!goalScope.characterIds?.includes(id))||(scope.factIds??[]).some(id=>!goalScope.factIds?.includes(id)))
      fail('手动接管的共享字段不在当前委托内','MANUAL_GOAL_SCOPE_DENIED',403);
    for(const selected of scope.units){
      const allowed=goalScope.units.find(unit=>unit.unitId===selected.unitId);
      if(!allowed||selected.allowSummary&&!allowed.allowSummary||selected.allowAllScenes&&!allowed.allowAllScenes||selected.allowStructure&&!allowed.allowStructure||
        (selected.nodeScopes??[]).some(node=>!allowed.allowAllScenes&&!allowed.nodeScopes?.some(permit=>permit.nodeId===node.nodeId&&(!node.allowCreate||permit.allowCreate)))||
        selected.maxNewScenes>allowed.maxNewScenes-ledger.scenes.filter(scene=>scene.unitId===selected.unitId).length)
        fail('手动接管的单元不在当前委托内','MANUAL_GOAL_SCOPE_DENIED',403);
      for(const scene of selected.scenes){
        const original=allowed.scenes.find(item=>item.sceneId===scene.sceneId);
        if(!allowed.allowAllScenes&&!original&&!ledger.scenes.some(item=>item.unitId===selected.unitId&&item.sceneId===scene.sceneId)||original&&((scene.allowBody&&!original.allowBody)||(scene.allowPlan&&!original.allowPlan))||original?.selection&&!same(original.selection,scene.selection))
          fail('手动接管的场景或文字选区超出当前委托','MANUAL_GOAL_SCOPE_DENIED',403);
        if(original?.blockIds!==null&&original?.blockIds!==undefined){
          const selectedBlocks=scene.selection?selectionBlockIds(workspace.document,selected.unitId,scene.sceneId,scene.selection):scene.blockIds;
          if(!selectedBlocks?.length||selectedBlocks.some(id=>!original.blockIds!.includes(id)))
            fail('手动接管的正文块超出当前委托','MANUAL_GOAL_SCOPE_DENIED',403);
        }
        if(original?.selection&&!scope.operations.includes('replace_selection'))
          fail('委托仅授权精确文字选区','MANUAL_GOAL_SCOPE_DENIED',403);
      }
    }
    this.deps.goals.attachManualRun({ownerId,runId,goalId:link.goalId,expectedGoalVersion:link.expectedGoalVersion,
      authorizationRef:auth.id,workspaceRef:auth.workspaceRef});
  }
  private async freezeMethods(methodIds:string[],resolve:Resolvers['resolveMethods']){
    const methods=await resolve(methodIds);
    if(methods.length!==methodIds.length||methods.some((method,index)=>method.id!==methodIds[index]&&method.id!==`skill:${methodIds[index]}`)||
      new Set(methods.map(method=>method.id)).size!==methods.length)fail('所选 Skill 已删除或不可访问','SKILL_NOT_FOUND',409);
    return structuredClone(methods);
  }
  /** Free text selects a current manuscript scope, then one operation from a
   * server-derived finite menu. Neither the browser nor model supplies IDs. */
  acceptChatTurn(input:{ownerId:string;threadId:string;requestId:string;expectedVersion:number;requestEnvelope:unknown;
    payload:unknown;text:string;methods:MethodBinding[];route:Route;selection?:unknown}){
    const identity={threadId:input.threadId,ownerId:input.ownerId,requestId:input.requestId,expectedVersion:input.expectedVersion,requestEnvelope:input.requestEnvelope};
    return this.deps.store.atomic(()=>{
      const prior=this.deps.conversations.received(identity);if(prior)return prior;
      let authorizationRef:string|undefined;
      let dispatchSelection:{workspaceId:string;unitId:string;sceneId:string|null;blockIds:string[]|null;selection:DraftSelection|null;entity?:{kind:'character'|'fact';id:string};scopeId?:string;seasonId?:string;nodeId?:string;outlineBeatIds?:string[]}|null=null;
      let dispatchDiscussionDraft:ScriptProject|undefined;
      const dispatchOptions:Array<{operation:AgentDraftOperation;input:Record<string,unknown>}> = [];
      if(input.selection!==undefined){
        const selected=obj(input.selection);exact(selected,['workspaceId','expectedRevision','unitId','sceneId','blockIds','selection','entity','manualGoal','sources','scopeId','seasonId','nodeId','outlineStructure','outlineSceneOrder','outlineRange','outlineBeatIds','analysis','localDraft','draftOperation'],['workspaceId','expectedRevision','unitId']);
        if(selected.draftOperation!==undefined&&!['outline_development','scene_order','scene_plan','replace_selection'].includes(selected.draftOperation))fail('指定的修改能力无效');
        const workspaceId=id(selected.workspaceId,'工作稿'),expectedRevision=int(selected.expectedRevision,'工作稿版本',1),unitId=id(selected.unitId,'目标单元');
        const workspace=this.deps.workspaces.read(workspaceId,input.ownerId);
        if(workspace.threadId!==input.threadId||workspace.revision!==expectedRevision)fail('当前选区的工作稿已变化','WORKSPACE_CONFLICT',409);
        if(selected.localDraft!==undefined){dispatchDiscussionDraft=parseScriptProject(structuredClone(selected.localDraft));if(dispatchDiscussionDraft.id!==workspace.documentId||selected.manualGoal)fail('本机讨论草稿须属于当前作品且不能关联写入委托');}
        const discussionProject=dispatchDiscussionDraft??workspace.document;
        if((selected.blockIds!==undefined||selected.selection!==undefined)&&selected.sceneId===undefined||
          selected.blockIds!==undefined&&selected.selection!==undefined)fail('正文选区必须唯一并属于选定场景');
        const selectedUnit=discussionProject.units.find(item=>item.id===unitId);
        if(!selectedUnit)fail('所选单元已变化','SCRIPT_UNIT_NOT_FOUND',409);
        const sceneId=selected.sceneId===undefined?null:id(selected.sceneId,'目标场');
        const selectedScene=sceneId?selectedUnit.scenes.find(item=>item.id===sceneId):null;
        if(sceneId&&!selectedScene)fail('所选场景已变化','SCRIPT_SCENE_NOT_FOUND',409);
        const blockIds=selected.blockIds===undefined?null:ids(selected.blockIds,'正文块');
        if(blockIds){
          const start=selectedScene!.blocks.findIndex(item=>item.id===blockIds[0]);
          if(!blockIds.length||start<0||blockIds.some((value,index)=>selectedScene!.blocks[start+index]?.id!==value))
            fail('正文块不在所选场景的连续范围');
        }
        const excerptSelection=selected.selection===undefined?null:selectedText(selected.selection);
        if(excerptSelection){
          const rendered=blocksToScreenplayText(selectedScene!.blocks,unitCharacters(discussionProject,selectedUnit));
          if(rendered.slice(excerptSelection.start,excerptSelection.end)!==excerptSelection.text)fail('文字选区与当前场原文不一致');
        }
        let entity:{kind:'character'|'fact';id:string}|undefined;
        if(selected.entity!==undefined){
          const value=obj(selected.entity);exact(value,['kind','id'],['kind','id']);
          if(!['character','fact'].includes(value.kind))fail('资料类型无效');
          const found=(value.kind==='character'?discussionProject.characters:discussionProject.facts).find(item=>item.id===value.id);
          if(!found||!visibleInUnit(found.scopeId,discussionProject,selectedUnit))fail('资料已删除或不属于当前故事');
          entity={kind:value.kind,id:found.id};
        }
        const scopeId=selected.scopeId===undefined?undefined:id(selected.scopeId,'大纲范围'),seasonId=selected.seasonId===undefined?undefined:id(selected.seasonId,'季大纲'),nodeId=selected.nodeId===undefined?undefined:id(selected.nodeId,'结构节点');
        const outlineBeatIds=selected.outlineBeatIds===undefined?undefined:ids(selected.outlineBeatIds,'目标节拍');
        if(outlineBeatIds&&(sceneId||blockIds||excerptSelection||nodeId||entity))fail('节拍目标不能包含结构、资料或场景正文');
        if(seasonId&&scopeId&&scopeId!==seasonId)fail('所选季大纲归属不一致');
        if(seasonId&&(sceneId||blockIds||excerptSelection||nodeId))fail('季大纲目标不能包含本集节点或场景正文');
        const explicitSeason=seasonId&&unitBelongsToSeason(discussionProject,selectedUnit,seasonId);
        if(scopeId&&scopeId!==discussionProject.id&&scopeId!==selectedUnit.scopeId&&!(explicitSeason&&scopeId===seasonId)||seasonId&&!explicitSeason||nodeId&&!selectedUnit.structureNodes?.some(node=>node.id===nodeId))fail('所选大纲或段落不属于当前故事');
        if(nodeId&&sceneId&&!structureNodeSceneIds(selectedUnit,nodeId).includes(sceneId))fail('所选场不属于当前段落');
        dispatchSelection={workspaceId,unitId,sceneId,blockIds,selection:excerptSelection,...(selected.analysis===true?{analysis:true}:{}),...(entity?{entity}:{}),...(scopeId?{scopeId}:{}),...(seasonId?{seasonId}:{}),...(nodeId?{nodeId}:{}),...(outlineBeatIds?{outlineBeatIds}:{})};
        const commandId=stable('chatstep',{ownerId:input.ownerId,requestId:input.requestId});
        const base={kind:'PROPOSE' as const,requestId:commandId,threadId:input.threadId,
          expectedConversationVersion:input.expectedVersion,source:{kind:'WORKSPACE' as const,workspaceId,expectedRevision},instruction:input.text,
          methodIds:[],...(selected.manualGoal!==undefined?{manualGoal:selected.manualGoal}:{}),...(selected.sources!==undefined?{sources:selected.sources}:{})};
        const scope=empty(workspace),unit=id(selected.unitId,'目标单元');
        const targetChoices:Array<{operation:AgentDraftOperation;target:Target}>=[
          {operation:'unit_outline',target:{unitId:unit}},
          {operation:'plan_scenes',target:{unitId:unit,...(nodeId?{nodeId}:{})}},...(!sceneId?[{operation:'scene_order' as const,target:{unitId:unit,...(nodeId?{nodeId}:{})}}]:[]),
          {operation:'add_character',target:{scopeId:selectedUnit.scopeId}},
          {operation:'add_fact',target:{scopeId:selectedUnit.scopeId}},
          ...BLUEPRINT_BRIEF_FIELDS.map(operation=>({operation,target:{}})),
        ];
        const outlineOwner:OutlineOwner=seasonId?{kind:'season',id:seasonId}:scopeId?{kind:scopeId===discussionProject.id?'project':'story',id:scopeId}:discussionProject.profile.organization==='standalone'?{kind:'project',id:discussionProject.id}:{kind:'unit',id:unit};
        if(!nodeId||getOutlineGuide(discussionProject,outlineOwner)?.nodeLinks.some(link=>link.nodeId===nodeId&&anchorCurrent(link.anchor,outlineText(discussionProject,outlineOwner))))targetChoices.unshift({operation:'outline_development',target:{unitId:unit,outlineStructure:selected.outlineStructure===true,outlineSceneOrder:selected.outlineSceneOrder===true,...(selected.outlineRange?{outlineRange:selectedText(selected.outlineRange)}:{}),...(outlineBeatIds?{outlineBeatIds}:{}),...(outlineOwner.kind==='project'||outlineOwner.kind==='story'?{scopeId:outlineOwner.id}:{}),...(outlineOwner.kind==='season'?{seasonId:outlineOwner.id}:{}),...(nodeId?{nodeId}:{})}});
        if(!nodeId&&!selectedUnit.structureNodes?.length)targetChoices.push({operation:'plan_structure',target:{unitId:unit}});
        if(!nodeId&&(selectedUnit.scopeId===workspace.document.id||scopeId===workspace.document.id))targetChoices.push({operation:'project_outline',target:{}});
        if(!nodeId&&seasonId)targetChoices.push({operation:'season_outline',target:{unitId:unit,seasonId}});
        else if(!nodeId&&scopeId&&scopeId!==workspace.document.id)targetChoices.push({operation:'story_outline',target:{unitId:unit,scopeId}});
        for(const [kind,entities] of [['character',workspace.document.characters],['fact',workspace.document.facts]] as const){
          for(const item of entities.filter(item=>visibleInUnit(item.scopeId,workspace.document,selectedUnit)&&(!entity||entity.kind===kind&&entity.id===item.id)))
            targetChoices.push({operation:kind==='character'?'update_character':'update_fact',target:{unitId:unit,entityId:item.id}});
        }
        if(selected.sceneId!==undefined)targetChoices.unshift({operation:selected.selection!==undefined?'replace_selection':
          selected.blockIds!==undefined?'replace_blocks':'scene_body',target:{unitId:unit,sceneId:selected.sceneId,
            ...(selected.blockIds!==undefined?{blockIds:selected.blockIds}:{}),...(selected.selection!==undefined?{selection:selected.selection}:{})}});
        if(sceneId&&!blockIds&&!excerptSelection)targetChoices.push({operation:'append_scene_body',target:{unitId:unit,sceneId}},{operation:'scene_plan',target:{unitId:unit,sceneId}});
        if(workspace.document.profile.organization!=='standalone')targetChoices.push({operation:'add_unit',target:{}});
        const linkedGoal=selected.manualGoal?this.deps.goals.read(id(obj(selected.manualGoal).goalId,'接管委托'),input.ownerId):null;
        const linked=linkedGoal?readScriptGoalEnvelope(linkedGoal.revision.contract).scope:null;
        const ledgerRow=linkedGoal?(this.deps.store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
          .get(linkedGoal.id,linkedGoal.activeRevision) as {data_json:string}|undefined)??
          (this.deps.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?')
            .get(linkedGoal.revision.authorizationRef) as {data_json:string}|undefined):undefined;
        const ledger:ScriptDraftCreationLedger=ledgerRow?JSON.parse(ledgerRow.data_json):emptyScriptDraftCreationLedger();
        for(const choice of targetChoices){
          if(seasonId&&!['outline_development','season_outline'].includes(choice.operation))continue;
          if(selected.draftOperation&&choice.operation!==selected.draftOperation||(selected.outlineRange||outlineBeatIds)&&choice.operation!=='outline_development')continue;
          if(dispatchDiscussionDraft)continue;
          if(nodeId&&!['scene_order','outline_development','plan_scenes','scene_body','append_scene_body','scene_plan','replace_blocks','replace_selection'].includes(choice.operation))continue;
          if(linked&&!linked.operations.includes(choice.operation))continue;
          let prepared:ReturnType<ScriptCommandService['manualScope']>;
          try{prepared=this.manualScope(workspace,{...base,operation:choice.operation,target:choice.target});}
          catch(error){if(linked&&error instanceof AgentError&&error.code==='MANUAL_GOAL_SCOPE_DENIED')continue;throw error;}
          const {scope:part,target}=prepared;
          if(linked&&!this.chatChoiceAllowed(part,linked,ledger,workspace))continue;
          scope.operations.push(choice.operation);
          if(part.sceneOrderGrants)scope.sceneOrderGrants=part.sceneOrderGrants;
          if(part.outlineGrants)scope.outlineGrants=part.outlineGrants;
          scope.sharedFields.push(...part.sharedFields);scope.characterScopeIds.push(...part.characterScopeIds);scope.factScopeIds.push(...part.factScopeIds);
          scope.characterIds=[...(scope.characterIds??[]),...(part.characterIds??[])];scope.factIds=[...(scope.factIds??[]),...(part.factIds??[])];
          scope.storyOutlineScopeIds=[...scope.storyOutlineScopeIds??[],...part.storyOutlineScopeIds??[]];scope.seasonOutlineIds=[...scope.seasonOutlineIds??[],...part.seasonOutlineIds??[]];
          scope.newUnitSlots.push(...part.newUnitSlots);
          for(const grant of part.units){
            const prior=scope.units.find(item=>item.unitId===grant.unitId);
            if(!prior)scope.units.push(grant);
            else {prior.allowSummary ||= grant.allowSummary;prior.allowAllScenes ||= grant.allowAllScenes;
              prior.allowStructure ||= grant.allowStructure;prior.nodeScopes=[...new Map([...prior.nodeScopes??[],...grant.nodeScopes??[]].map(node=>[node.nodeId,node])).values()];
              prior.maxNewScenes=Math.max(prior.maxNewScenes,grant.maxNewScenes);for(const scene of grant.scenes){const saved=prior.scenes.find(item=>item.sceneId===scene.sceneId);if(saved){if(!same(saved.blockIds,scene.blockIds)||!same(saved.selection??null,scene.selection??null))fail('重复场景范围不一致');saved.allowPlan ||= scene.allowPlan;saved.allowBody ||= scene.allowBody;}else prior.scenes.push(scene);}}
          }
          dispatchOptions.push({operation:choice.operation,input:{operation:choice.operation,instruction:input.text,
            unitId:target.unitId??null,sceneId:target.sceneId??null,entityId:target.entityId??null,slotId:target.slotId??null,scopeId:target.scopeId??null,
            blockIds:target.blockIds??null,selection:target.selection??null,...(target.repairCandidateId?{repairCandidateId:target.repairCandidateId}:{}),...('seasonId' in target&&target.seasonId?{seasonId:target.seasonId}:{}),...('nodeId' in target&&target.nodeId?{nodeId:target.nodeId}:{}),...('continuationCheckpoint' in target&&target.continuationCheckpoint?{continuationCheckpoint:target.continuationCheckpoint}:{})}});
        }
        if(dispatchOptions.length){
          scope.operations=[...new Set(scope.operations)];
          scope.sharedFields=[...new Set(scope.sharedFields)];scope.characterScopeIds=[...new Set(scope.characterScopeIds)];scope.factScopeIds=[...new Set(scope.factScopeIds)];scope.characterIds=[...new Set(scope.characterIds)];scope.factIds=[...new Set(scope.factIds)];
          scope.storyOutlineScopeIds=[...new Set(scope.storyOutlineScopeIds)];scope.seasonOutlineIds=[...new Set(scope.seasonOutlineIds)];
          validateScriptDraftScope(workspace.document,scope);
          const auth=this.deps.authorizations.issue({ownerId:input.ownerId,threadId:input.threadId,workspaceId,commandId,scope,
            sources:this.sources(selected.sources,input.ownerId,input.threadId)});
          authorizationRef=auth.id;
        }
      }
      const accepted=this.deps.conversations.accept({...identity,payload:input.payload,capabilityId:'script.dispatch',maxInvocations:dispatchOptions.length?6:2,
        runInput:{...(authorizationRef?{authorizationRef}:{}),dispatchOptions,dispatchSelection,...(dispatchDiscussionDraft?{dispatchDiscussionDraft}:{}),
          manualGoalLinked:Boolean((input.selection as ScriptChatSelection|undefined)?.manualGoal),
          dispatchGoals:authorizationRef&&dispatchSelection&&!dispatchSelection.outlineBeatIds&&!dispatchSelection.seasonId&&!dispatchSelection.blockIds&&!dispatchSelection.selection&&!(input.selection as ScriptChatSelection|undefined)?.manualGoal&&!(input.selection as ScriptChatSelection|undefined)?.draftOperation&&!obj(input.selection).outlineRange?['review_goal','write_goal','revise_goal',...(!dispatchSelection.nodeId?['blueprint_goal']:[]),...(dispatchOptions.some(option=>option.operation==='project_outline')?['project_outline_goal']:[]),'scenes_goal',...(!dispatchSelection.sceneId?['outline_goal']:[])]:[],
          ...(input.selection!==undefined&&!dispatchOptions.length?{dispatchUnavailableReason:'当前委托没有可用的写入范围，请调整目标或继续讨论。'}:{}),
          scriptExecution:{...input.route,methods:input.methods,authorRequest:input.text}}});
      if(authorizationRef){
        this.deps.authorizations.bind(authorizationRef,input.ownerId,{kind:'RUN',runId:accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId,inputRevision:1});
        const runId=accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId;
        const selected=input.selection as ScriptChatSelection;
        if(selected.manualGoal){
          const command={kind:'PROPOSE',requestId:stable('chatstep',{ownerId:input.ownerId,requestId:input.requestId}),threadId:input.threadId,
            expectedConversationVersion:input.expectedVersion,source:{kind:'WORKSPACE',workspaceId:selected.workspaceId,expectedRevision:selected.expectedRevision},
            operation:dispatchOptions[0].operation,instruction:input.text,target:{unitId:selected.unitId,sceneId:selected.sceneId,blockIds:selected.blockIds,selection:selected.selection},
            methodIds:[],manualGoal:selected.manualGoal} as ProposeCommand;
          const auth=this.deps.authorizations.read(authorizationRef,input.ownerId);
          this.attachManualGoal(input.ownerId,command,auth,runId);
        }
      }
      return accepted;
    });
  }
  /** Internal bridge from a committed, server-scoped chat decision. No model
   * supplied command, target IDs or authorization can enter this boundary. */
  startGoalFromChat(token:ExecutionToken,turnId:string,choice:{kind:'NEW';title:string;profile:ProjectProfile;stopAfter?:ScriptStage;history:ResourceRef}|{kind:'WRITE'|'REVISE'|'REVIEW';stopAfter?:ScriptStage;projectOutlineOnly?:boolean;history:ResourceRef}):ScriptCommandReceipt{
    return this.deps.store.atomic(()=>{
      const run=this.deps.store.assertExecution(token),{turn}=this.deps.conversations.turn(run.threadId,turnId,run.ownerId);
      if(turn.runId!==run.id||run.kind!=='CHAT')fail('对话决定不属于当前执行','CHAT_SCOPE_DENIED',403);
      const payload=turn.input as {text:string;methods:MethodBinding[];channel:'api'|'external';routeRef:string;intent?:string};
      const requestId=stable('chatgoal',{runId:run.id,turnId}),envelope={runId:run.id,turnId,choice};
      const old=this.deps.store.db.prepare('SELECT envelope_hash,receipt_json FROM script_author_commands WHERE owner_id=? AND request_id=?').get(run.ownerId,requestId) as any;
      if(old){assertSamePayload(old.envelope_hash,hashValue(envelope));return JSON.parse(old.receipt_json);}
      let source:Source,target:GoalTarget,task:GoalStartCommand['task'];
      if(choice.kind==='NEW'){
        if(payload.intent!=='AGENT'||(run.input as any).request?.capabilityId!=='script.assistant_start')fail('本条消息没有新作品委托入口','CHAT_SCOPE_DENIED',403);
        source={kind:'NEW',title:text(choice.title,'作品标题',300),profile:parseProjectProfile(choice.profile)};
        const minutes=choice.profile.targetDurationMs/60000;
        target={initialUnit:true,initialMaxNewScenes:Math.min(160,Math.max(16,Math.ceil(minutes*1.5))),
          sharedFields:[...BLUEPRINT_BRIEF_FIELDS,'outline'],initialCharacterScope:'PROJECT',initialFactScope:'PROJECT'};task='WRITE';
      }else{
        const selection=(run.input as any).dispatchSelection;
        if(!selection||(run.input as any).manualGoalLinked||selection.blockIds||selection.selection)
          fail('请明确整场或整集委托范围，当前局部选择不授予连续修改权限','CHAT_GOAL_SCOPE_DENIED',403);
        const auth=this.deps.authorizations.forRun(run),workspace=this.deps.workspaces.read(auth.workspaceId,run.ownerId);
        if(!same(workspaceRef(workspace),auth.workspaceRef))fail('工作稿在对话期间已变化','WORKSPACE_CONFLICT',409);
        source={kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision};task=choice.kind;
        target=selection.nodeId?{unitIds:[selection.unitId],structureTargets:[{unitId:selection.unitId,nodeId:selection.nodeId}]}:task==='REVIEW'?{unitIds:[selection.unitId]}:
          {unitIds:[selection.unitId],...(selection.sceneId?{sceneIds:[{unitId:selection.unitId,sceneId:selection.sceneId}]}:{wholeUnitIds:[selection.unitId]})};
        const selectedUnit=workspace.document.units.find(unit=>unit.id===selection.unitId)!;
        if(task!=='REVIEW'&&!selection.nodeId&&!selection.sceneId){
          target.characterScopeIds=[selectedUnit.scopeId];target.factScopeIds=[selectedUnit.scopeId];
          if(selection.scopeId&&selection.scopeId!==workspace.document.id){
            if(workspace.document.seasons?.some(season=>season.id===selection.scopeId))target.seasonOutlineIds=[selection.scopeId];
            else target.storyOutlineScopeIds=[selection.scopeId];
          }
        }
        if(choice.stopAfter==='OUTLINE'&&!selection.nodeId&&!selection.sceneId&&selection.scopeId&&selection.scopeId!==workspace.document.id)target={unitIds:[selection.unitId],...(target.seasonOutlineIds?{seasonOutlineIds:target.seasonOutlineIds}:{storyOutlineScopeIds:target.storyOutlineScopeIds})};
        if(choice.stopAfter==='BLUEPRINT')target={...target,sharedFields:[...BLUEPRINT_BRIEF_FIELDS],characterScopeIds:[workspace.document.id],factScopeIds:[workspace.document.id],characterIds:workspace.document.characters.filter(item=>visibleInUnit(item.scopeId,workspace.document,workspace.document.units.find(u=>u.id===selection.unitId)!)).map(item=>item.id),factIds:workspace.document.facts.filter(item=>visibleInUnit(item.scopeId,workspace.document,workspace.document.units.find(u=>u.id===selection.unitId)!)).map(item=>item.id)};
        if(!selection.nodeId&&choice.stopAfter==='OUTLINE'&&workspace.document.profile.organization==='standalone')target={...target,sharedFields:['outline']};
        if(choice.projectOutlineOnly){
          if(choice.stopAfter!=='OUTLINE'||task==='REVIEW')fail('仅总纲委托必须停在故事大纲');
          target={unitIds:[selection.unitId],sharedFields:['outline']};
        }
      }
      if(choice.kind!=='NEW'&&choice.kind!=='REVIEW'&&choice.stopAfter==='OUTLINE'){
        const selection=(run.input as any).dispatchSelection,grant=(this.deps.authorizations.forRun(run).scope as ScriptDraftScope).outlineGrants?.[0];
        if(grant)target.outlineTarget={unitId:selection.unitId,...(grant.owner.kind==='project'||grant.owner.kind==='story'?{scopeId:grant.owner.id}:{}),...(grant.owner.kind==='season'?{seasonId:grant.owner.id}:{}),nodeId:grant.nodeId,allowStructure:grant.allowStructure,allowSceneOrder:grant.allowSceneOrder};
      }
      const command:GoalStartCommand={kind:'GOAL_START',requestId,threadId:run.threadId,
        expectedConversationVersion:this.deps.conversations.read(run.threadId,run.ownerId).version,source,target,task,...(choice.stopAfter?{stopAfter:choice.stopAfter}:{}),
        objective:text(payload.text,'作者委托',100000),methodIds:[],sources:[{purpose:'CONVERSATION',ref:choice.history}]};
      const receipt=this.accept(run.ownerId,command,payload.methods,{channel:payload.channel,routeRef:payload.routeRef});
      this.deps.store.db.prepare('INSERT INTO script_author_commands VALUES(?,?,?,?)').run(run.ownerId,requestId,hashValue(envelope),stableJson(receipt));
      return receipt;
    });
  }
  async submit(ownerId:string,raw:unknown,resolvers:Resolvers):Promise<ScriptCommandReceipt>{
    const replay=this.received(ownerId,raw);if(replay)return replay;
    const command=this.identity(raw);
    const inherited=(command.kind==='GOAL_CONTINUE'||command.kind==='GOAL_REVISE')?this.deps.goals.read(command.goalId,ownerId).revision:null;
    const inheritMethods=Boolean(inherited&&command.kind!=='APPLY'&&command.methodIds===undefined);
    const methodIds=command.kind==='APPLY'||inheritMethods?[]:this.methods(command.methodIds??[]);
    let methods:MethodBinding[],route:Route|null;
    try{
      methods=command.kind==='APPLY'?[]:inheritMethods?structuredClone(inherited!.skillManifest as MethodBinding[]):await this.freezeMethods(methodIds,resolvers.resolveMethods);
      route=command.kind==='APPLY'?null:inherited&&command.executionChannel===undefined?inherited.route:resolvers.resolveExecution();
    }catch(error){const accepted=this.received(ownerId,raw);if(accepted)return accepted;throw error;}
    if(route&&(!['api','external'].includes(route.channel)||!route.routeRef))fail('剧本模型执行渠道尚未配置','EXECUTION_NOT_CONFIGURED');
    return this.deps.store.atomic(()=>{
      const again=this.received(ownerId,raw);if(again)return again;
      this.conversation(ownerId,command);
      const receipt=this.accept(ownerId,command,methods,route);
      this.deps.store.db.prepare('INSERT INTO script_author_commands VALUES(?,?,?,?)').run(ownerId,command.requestId,hashValue(raw),stableJson(receipt));
      return receipt;
    });
  }
  private authorChangedOutlineSince(workspace:ScriptWorkspace,coverage:StoryCoverageContract):boolean{
    const rows=this.deps.store.db.prepare("SELECT response_json,action FROM script_workspace_commands WHERE owner_id=? AND action IN ('save-author','restore','adopt','sync-author') ORDER BY rowid").all(workspace.ownerId) as Array<{response_json:string;action:string}>;
    return rows.some(row=>{
      const response=JSON.parse(row.response_json),revision=['adopt','sync-author'].includes(row.action)?response.synchronizedWorkspaceRevision:response.revision;
      if((response.id??response.workspaceId??response.workspace?.id)!==workspace.id||!Number.isSafeInteger(revision)||revision<=coverage.originRevision||revision<2)return false;
      const before=collectOutlineRequirements(this.deps.workspaces.version(workspace.id,workspace.ownerId,revision-1),coverage.targets);
      const after=collectOutlineRequirements(this.deps.workspaces.version(workspace.id,workspace.ownerId,revision),coverage.targets);
      return outlineSourcesChanged(before.items,after.items)||!same(before.gaps,after.gaps);
    });
  }
  private authorChangedSinceLastDecision(goalId:string,ownerId:string,workspace:ScriptWorkspace,targetUnitIds:string[]):boolean{
    const progress=this.deps.store.db.prepare('SELECT no_progress_streak FROM agent_goals WHERE id=? AND owner_id=?').get(goalId,ownerId) as {no_progress_streak:number}|undefined;
    if(!progress||progress.no_progress_streak<3)return false;
    const row=this.deps.store.db.prepare("SELECT s.data_json FROM agent_samplings s JOIN agent_run_links l ON l.run_id=s.run_id WHERE l.goal_id=? AND l.role='GOAL_CONTROLLER' AND s.progress_json IS NOT NULL ORDER BY s.rowid DESC LIMIT 1")
      .get(goalId) as {data_json:string}|undefined;
    const ref=row?(JSON.parse(row.data_json).modelRequest?.inputManifest?.scriptGoal?.workspaceRef as ResourceRef|undefined):undefined;
    if(!ref||ref.uri!==`resource://script/workspaces/${workspace.id}`||ref.branch!==`workspace:${workspace.id}`||
      !Number.isSafeInteger(Number(ref.version))||Number(ref.version)<1||Number(ref.version)>=workspace.revision)return false;
    return this.deps.workspaces.authorChangedTargetSince(workspace.id,ownerId,Number(ref.version),targetUnitIds);
  }
  private accept(ownerId:string,command:ScriptAuthorCommand,methods:MethodBinding[],route:Route|null):ScriptCommandReceipt{
    if(command.kind==='PLANNING_REPAIR'){
      const target=obj(command.target);exact(target,['unitId','sceneId','scopeId','seasonId','nodeId','outlineRange','outlineStructure'],['unitId']);
      text(command.instruction,'规划检查要求');id(target.unitId,'目标单元');
      const operation=target.sceneId?'scene_plan':'outline_development';
      if(target.sceneId&&['scopeId','seasonId','nodeId','outlineRange','outlineStructure'].some(key=>target[key]!==undefined))fail('本场规划返修不能同时指定大纲范围');
      const workspace=this.source(ownerId,command,command.source),manual:ProposeCommand={...command,kind:'PROPOSE',operation};
      const {scope}=this.manualScope(workspace,manual);
      const auth=this.deps.authorizations.issue({ownerId,threadId:command.threadId,workspaceId:workspace.id,commandId:command.requestId,scope,sources:[]});
      const accepted=this.deps.store.accept({ownerId,threadId:command.threadId,scopeId:'script:home',requestId:command.requestId,kind:'CAPABILITY',
        input:{authorizationRef:auth.id,planningRepair:{version:1,maxRepairRounds:2,operation,target:structuredClone(target),instruction:command.instruction},
          scriptExecution:{...route!,methods,authorRequest:command.instruction}},policyRevision:this.policy.policyRevision,maxInvocations:5});
      this.deps.authorizations.bind(auth.id,ownerId,{kind:'RUN',runId:accepted.runId,inputRevision:1});
      return {kind:command.kind,workspaceId:workspace.id,runId:accepted.runId,threadId:command.threadId,authorizationRef:auth.id};
    }
    if(command.kind==='PROPOSE'){
      const workspace=this.source(ownerId,command,command.source),{scope,target,reservedUnitIds}=this.manualScope(workspace,command);
      const auth=this.deps.authorizations.issue({ownerId,threadId:command.threadId,workspaceId:workspace.id,commandId:command.requestId,scope,sources:this.sources(command.sources,ownerId,command.threadId)});
      const input={authorizationRef:auth.id,operation:command.operation,instruction:command.instruction,
        unitId:target.unitId??null,sceneId:target.sceneId??null,entityId:target.entityId??null,slotId:target.slotId??null,scopeId:target.scopeId??null,
        blockIds:target.blockIds??null,selection:target.selection??null,...(target.repairCandidateId?{repairCandidateId:target.repairCandidateId}:{}),
        ...(target.seasonId?{seasonId:target.seasonId}:{}),...(target.nodeId?{nodeId:target.nodeId}:{}),...(target.beforeSceneId?{beforeSceneId:target.beforeSceneId}:{}),...(target.afterSceneId?{afterSceneId:target.afterSceneId}:{}),...(target.continuationCheckpoint?{continuationCheckpoint:target.continuationCheckpoint}:{})};
      const accepted=this.deps.store.accept({ownerId,threadId:command.threadId,scopeId:'script:home',requestId:command.requestId,
        kind:'CAPABILITY',input:{authorizationRef:auth.id,request:{capabilityId:'script.propose',capabilityVersion:'1',callId:command.requestId,input},
          scriptExecution:{...route!,methods,authorRequest:command.instruction}},policyRevision:this.policy.policyRevision,maxInvocations:this.policy.manualMaxInvocations});
      this.deps.authorizations.bind(auth.id,ownerId,{kind:'RUN',runId:accepted.runId,inputRevision:1});
      this.attachManualGoal(ownerId,command,auth,accepted.runId);
      return {kind:command.kind,workspaceId:workspace.id,runId:accepted.runId,threadId:command.threadId,authorizationRef:auth.id,reservedUnitIds};
    }
    if(command.kind==='APPLY'){
      const workspace=this.deps.workspaces.read(id(command.workspaceId,'工作稿'),ownerId);
      if(workspace.threadId!==command.threadId||workspace.revision!==int(command.expectedRevision,'工作稿版本',1)||
        workspace.writerEpoch!==int(command.writerEpoch,'写入权版本',1))fail('工作稿已变化，请比较候选后继续','WORKSPACE_CONFLICT',409);
      const {scope,sources}=this.applyScope(workspace,id(command.candidateId,'候选'),ownerId);
      const auth=this.deps.authorizations.issue({ownerId,threadId:command.threadId,workspaceId:workspace.id,commandId:command.requestId,scope,sources});
      const accepted=this.deps.store.accept({ownerId,threadId:command.threadId,scopeId:'script:home',requestId:command.requestId,
        kind:'CAPABILITY',input:{authorizationRef:auth.id,request:{capabilityId:'script.apply_patch',capabilityVersion:'1',callId:command.requestId,
          input:{authorizationRef:auth.id,candidateId:command.candidateId,expectedRevision:workspace.revision,writerEpoch:workspace.writerEpoch}}},
        policyRevision:this.policy.policyRevision,maxInvocations:this.policy.manualMaxInvocations});
      this.deps.authorizations.bind(auth.id,ownerId,{kind:'RUN',runId:accepted.runId,inputRevision:1});
      this.attachManualGoal(ownerId,command,auth,accepted.runId);
      return {kind:command.kind,workspaceId:workspace.id,runId:accepted.runId,threadId:command.threadId,authorizationRef:auth.id};
    }
    const start=command.kind==='GOAL_START',goal=start?null:this.deps.goals.read(command.goalId,ownerId);
    const workspace=start?this.source(ownerId,command,command.source):this.deps.workspaces.read(goal!.revision.workspaceRef.uri.split('/').at(-1)!,ownerId);
    if(workspace.threadId!==command.threadId||goal&&goal.threadId!==command.threadId)fail('委托不属于当前会话','SCRIPT_SCOPE_DENIED',403);
    if(goal&&command.kind==='GOAL_CONTINUE'){
      const lastId=goal.activeRunId??(this.deps.store.db.prepare('SELECT last_run_id FROM agent_goals WHERE id=?').get(goal.id) as {last_run_id:string}).last_run_id;
      const priorRun=this.deps.store.readRun(lastId,ownerId);
      if(['LEASE_STALL_LIMIT','CONTEXT_VALIDATION_LIMIT'].includes(priorRun.reason??'')){
        if(!['NEEDS_REBASE','PAUSED'].includes(priorRun.status))fail('原同步校验委托已停止，请明确修订目标','GOAL_REVISION_REQUIRED',409);
        if(['stopAfter','objective','task','target','methodIds','sources','additionalSources','executionChannel','answer'].some(key=>Object.hasOwn(command,key)))
          fail('同步校验恢复只接回原冻结步骤；改变目标、来源或方法请明确修订委托','GOAL_REVISION_REQUIRED',409);
        const resumed=this.deps.goals.recoverLeaseStall({goalId:goal.id,ownerId,expectedVersion:command.expectedGoalVersion,
          expectedRunVersion:command.expectedRunVersion,requestId:command.requestId,requestEnvelope:command});
        return {kind:command.kind,workspaceId:workspace.id,runId:resumed.runId,threadId:command.threadId,
          authorizationRef:goal.revision.authorizationRef,goalId:goal.id,goalRevision:goal.activeRevision,reservedUnitIds:[]};
      }
      if(priorRun.status==='PARTIAL'&&priorRun.reason==='BUDGET_EXHAUSTED'){
        if(['stopAfter','objective','task','target','methodIds','sources','additionalSources','executionChannel','answer'].some(key=>Object.hasOwn(command,key)))
          fail('预算恢复只接回原冻结步骤；改变目标、来源或方法请明确修订委托','GOAL_REVISION_REQUIRED',409);
        const resumed=this.deps.goals.recoverBudgetStopped({goalId:goal.id,ownerId,expectedVersion:command.expectedGoalVersion,
          expectedRunVersion:command.expectedRunVersion,requestId:command.requestId,requestEnvelope:command});
        return {kind:command.kind,workspaceId:workspace.id,runId:resumed.runId,threadId:command.threadId,
          authorizationRef:goal.revision.authorizationRef,goalId:goal.id,goalRevision:goal.activeRevision,reservedUnitIds:[]};
      }
    }
    if(goal&&command.kind!=='GOAL_START'){
      const lastId=goal.activeRunId??(this.deps.store.db.prepare('SELECT last_run_id FROM agent_goals WHERE id=?').get(goal.id) as {last_run_id:string}).last_run_id;
      if(goal.version!==int(command.expectedGoalVersion,'委托版本',1)||
        this.deps.store.readRun(lastId,ownerId).version!==int(command.expectedRunVersion,'执行版本',1))
        fail('委托执行版本已改变','GOAL_VERSION_CONFLICT',409);
    }
    const priorAuth=goal?this.deps.authorizations.read(goal.revision.authorizationRef,ownerId):null;
    const previous=goal?readScriptGoalEnvelope(goal.revision.contract).scope:null;
    const task=command.task??(goal?readScriptGoalEnvelope(goal.revision.contract).task:fail('委托缺少写作任务'));
    if(!['WRITE','REVISE','REVIEW'].includes(task))fail('委托任务无效');
    const stopAfter=command.stopAfter??(goal?readScriptGoalEnvelope(goal.revision.contract).stopAfter:undefined);
    if(stopAfter!==undefined&&!COMPATIBLE_SCRIPT_STAGES.includes(stopAfter))fail('停止阶段无效');
    if(task==='REVIEW'&&stopAfter&&stopAfter!=='BODY')fail('只检查正文不能同时要求生成前期阶段');
    const supplied=command.target!==undefined;
    if(goal&&!supplied&&readScriptGoalEnvelope(goal.revision.contract).task==='REVIEW'&&task!=='REVIEW')
      fail('从审阅改为写作必须重新选定写入范围','GOAL_REVISION_REQUIRED',409);
    const carried=previous?this.carryGoalScope(workspace,previous,goal!.id,goal!.activeRevision,priorAuth!.id,command.kind==='GOAL_REVISE'&&supplied):null;
    const selected=supplied?(task==='REVIEW'?this.reviewScope(workspace,command.target!,start&&command.source.kind==='NEW'):
      this.goalScope(workspace,command.requestId,command.target!,start&&command.source.kind==='NEW',carried??undefined)):
      carried?{scope:carried,targetUnitIds:readScriptGoalEnvelope(goal!.revision.contract).checks.targetUnitIds,reservedUnitIds:[]}:fail('委托缺少目标单元');
    if(stopAfter&&task!=='REVIEW')restrictStageScope(selected.scope,stopAfter);
    if(!selected.scope.operations.length&&task!=='REVIEW')fail('所选阶段没有获得对应内容的写入权限，请明确选择目标');
    if(goal&&supplied&&task!=='REVIEW'){
      const created=this.goalCreatedSceneCounts(goal.id,goal.activeRevision);
      for(const grant of selected.scope.units){
        if(!selected.scope.operations.includes('plan_scenes'))continue;
        const used=created.get(grant.unitId)??0;
        if(used>grant.maxNewScenes)fail('新增场数总上限低于本委托已创建的场数','SCRIPT_SCOPE_DENIED',403);
        grant.maxNewScenes-=used;
      }
      validateScriptDraftScope(workspace.document,selected.scope);
    }
    const objective=text(command.objective??goal?.revision.objective,'委托目标');
    let sourceChoices=command.sources===undefined&&priorAuth?priorAuth.sources:this.sources(command.sources,ownerId,command.threadId);
    if(command.kind!=='GOAL_START'&&command.additionalSources!==undefined){
      const added=this.sources(command.additionalSources,ownerId,command.threadId);
      sourceChoices=[...new Map([...sourceChoices,...added].map(source=>[hashValue(source),source])).values()];
    }
    const auth=this.deps.authorizations.issue({ownerId,threadId:command.threadId,workspaceId:workspace.id,commandId:command.requestId,scope:selected.scope,sources:sourceChoices});
    // A fresh grant and workspace baseline are execution identity, not a new
    // author objective. Compare only the rights and instructions the author
    // explicitly selected before allowing a progress-bound reset.
    const scopeIntent=(scope:ScriptDraftScope)=>({operations:scope.operations,outlineGrants:scope.outlineGrants,units:scope.units,newUnitSlots:scope.newUnitSlots,
      sharedFields:scope.sharedFields,storyOutlineScopeIds:scope.storyOutlineScopeIds??[],seasonOutlineIds:scope.seasonOutlineIds??[],characterIds:scope.characterIds,factIds:scope.factIds,characterScopeIds:scope.characterScopeIds,factScopeIds:scope.factScopeIds});
    const previousChecks=goal?readScriptGoalEnvelope(goal.revision.contract).checks:null;
    const authorOutlineRevision=command.kind==='GOAL_REVISE'&&previousChecks?.storyCoverage&&this.authorChangedOutlineSince(workspace,previousChecks.storyCoverage);
    const materialChange=!!goal&&(authorOutlineRevision||
      stopAfter!==readScriptGoalEnvelope(goal.revision.contract).stopAfter||objective!==goal.revision.objective||task!==readScriptGoalEnvelope(goal.revision.contract).task||
      supplied&&!same(scopeIntent(selected.scope),scopeIntent(carried!))||
      (command.sources!==undefined||command.kind!=='GOAL_START'&&command.additionalSources!==undefined)&&!same(sourceChoices,priorAuth!.sources)||
      command.methodIds!==undefined&&!same(methods,goal.revision.skillManifest)||
      command.executionChannel!==undefined&&!same(route,goal.revision.route));
    if(command.kind==='GOAL_CONTINUE'&&materialChange)fail('目标或方法已改变，请明确使用修订委托','GOAL_REVISION_REQUIRED',409);
    const authorEdit=!!goal&&this.authorChangedSinceLastDecision(goal.id,ownerId,workspace,selected.targetUnitIds);
    const coverageTargets=selected.scope.units.filter(unit=>unit.allowAllScenes||unit.nodeScopes?.length).map(unit=>({unitId:unit.unitId,...(unit.nodeScopes?.length?{nodeIds:unit.nodeScopes.map(node=>node.nodeId)}:{})}));
    // Execution settings and wording can change without authorizing removal of
    // story requirements. Only an authored outline edit or a newly selected
    // narrative range establishes a new outline baseline.
    const coverageIdentity=(targets:StoryCoverageContract['targets'])=>targets.map(target=>({unitId:target.unitId,nodeIds:[...target.nodeIds??[]].sort()})).sort((a,b)=>a.unitId.localeCompare(b.unitId));
    const preserveStoryBaseline=previousChecks?.storyCoverage&&!authorOutlineRevision&&same(coverageIdentity(previousChecks.storyCoverage.targets),coverageIdentity(coverageTargets));
    const storyCoverage=task!=='REVIEW'&&['BODY','SCENES'].includes(stopAfter??'')&&coverageTargets.length?
      {originRevision:preserveStoryBaseline?previousChecks!.storyCoverage!.originRevision:workspace.revision,targets:coverageTargets}:undefined;
    const contract=scriptGoalEnvelope({workspaceId:workspace.id,documentId:workspace.documentId,task,...(stopAfter?{stopAfter}:{}),scope:selected.scope,
      checks:defaultScriptChecks(selected.targetUnitIds,previousChecks?previousChecks.revision+(materialChange||authorEdit?1:0):1,isPlanningStage(stopAfter)&&!selected.scope.units.some(unit=>unit.nodeScopes?.length)?undefined:selected.scope,storyCoverage),
      strategy:{id:'SCRIPT_GOAL_V1',maxNoProgressStreak:3}});
    const revision:GoalRevisionInput={objective,contract,authorizationRef:auth.id,workspaceRef:workspaceRef(workspace),
      sourceRefs:auth.sources.map(source=>source.ref),skillManifest:methods,route:route!,stopPolicy:'CONTRACT_COMPLETE',turnLimits:this.policy.turnLimits};
    // A same-content REVISE is still a valid author takeover, but it must
    // preserve the existing no-progress assessment.
    const accepted=start?this.deps.goals.accept({...revision,requestId:command.requestId,requestEnvelope:command,ownerId,scopeId:'script:home',
      threadId:command.threadId,policyRevision:this.policy.policyRevision,budgetLimits:scopedBudget(this.policy.budgetLimits,workspace,selected.scope,selected.targetUnitIds,command.target!,task)}):
      this.deps.goals[(command.kind==='GOAL_REVISE'&&materialChange)||authorEdit?'revise':'continue']({goalId:goal!.id,ownerId,expectedVersion:(command as GoalContinueCommand).expectedGoalVersion,expectedRunVersion:(command as GoalContinueCommand).expectedRunVersion,
        requestId:command.requestId,requestEnvelope:command,revision,...(command.kind==='GOAL_CONTINUE'&&command.answer?{answer:command.answer}:{})});
    this.deps.authorizations.bind(auth.id,ownerId,{kind:'GOAL',goalId:accepted.goalId,revision:accepted.goalRevision});
    return {kind:command.kind,workspaceId:workspace.id,runId:accepted.runId,threadId:command.threadId,authorizationRef:auth.id,
      goalId:accepted.goalId,goalRevision:accepted.goalRevision,reservedUnitIds:selected.reservedUnitIds};
  }
}
