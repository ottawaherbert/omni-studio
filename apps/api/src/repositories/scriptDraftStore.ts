import {continuedPlanningScope,type PlanningRepairContract} from '../../../../packages/script/src/planningRepair';
import {freezeSceneOrder} from '../../../../packages/script/src/sceneOrder';
import {freezeOutlineGrant,outlineHash,outlineText,unitBelongsToSeason} from '../../../../packages/script/src/outlineGuides';
import { BLUEPRINT_BRIEF_FIELDS } from '../../../../packages/script/src/blueprint';
import { AgentError, ExecutionInvalidated, hashValue, stableJson, type AgentRun, type ExecutionToken, type ModelRequest, type Observation, type PreparedCall, type ResourceRef } from '../../../../packages/agent-core/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';
import { buildAgentDraft, agentDraftOutputSchema, type AgentDraftCandidate, type AgentDraftRequest } from '../../../../packages/script/src/agentDraft';
import { assertAgentDraftScope, emptyScriptDraftCreationLedger, selectionBlockIds, type ScriptDraftCreationLedger, type ScriptDraftScope } from '../../../../packages/script/src/agentScope';
import { applyWorkspacePatch, createWorkspacePatch, type WorkspacePatch } from '../../../../packages/script/src/workspacePatch';
import { blocksToScreenplayText } from '../../../../packages/script/src/fountainAdapter';
import { unitCharacters } from '../../../../packages/script/src/continuity';
import type { ScriptProject } from '../../../../packages/script/src/schema';
import { readScriptGoalEnvelope } from '../../../../packages/script/src/agentGoal';
import { workspaceRef, type ScriptWorkspace, type ScriptWorkspaceStore } from './scriptWorkspaceStore';
import { assertStructureScopesCurrent } from '../../../../packages/script/src/agentScope';
import { assertSceneContinuationCheckpoint } from '../../../../packages/script/src/continuation';
import { collectOutlineRequirements } from '../../../../packages/script/src/goalCoverage';
import type { ScriptAuthorizationStore } from './scriptAuthorizationStore';

export type ScriptDraftRecord = {
  id:string; ownerId:string; workspaceId:string; authorizationId:string; runId:string; stepId:string; callId:string;
  invocationId:string; modelRequest:ModelRequest; modelInputHash:string; modelResult:unknown; raw:string;
  contextRef:{id:string;digest:string}; baseRef:ResourceRef; request:AgentDraftRequest;
  status:'VALID'|'INVALID'; error:string|null; candidate:AgentDraftCandidate|null;
};
export type ScriptDraftApplication = {candidateId:string;workspaceId:string;beforeRevision:number;afterRevision:number;
  runId:string;stepId:string;authorizationRef:string;ref:ResourceRef};
type DraftManifest = {authorizationRef:string;workspaceRef:ResourceRef}&Omit<AgentDraftRequest,'candidateId'>;
type Stored = {record:ScriptDraftRecord;receipt:Observation;contentHash:string};
const denied=(reason:string):never=>{throw new AgentError('SCRIPT_DRAFT_DENIED',reason,403);};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
const id=(value:unknown)=>typeof value==='string'&&/^[\w-]{1,120}$/.test(value);
export const scriptDraftCandidateRef=(record:ScriptDraftRecord):ResourceRef=>({uri:`resource://script/draft-candidates/${record.id}`,version:'1',contentHash:hashValue(record),branch:`workspace:${record.workspaceId}`});
const access=(ownerId:string,workspaceId:string)=>({ownerId,scopeId:workspaceId,branch:`workspace:${workspaceId}`});

/** Synchronous host-only repository. PROPOSE records source evidence without
 * changing the draft; WRITE uses the exact persisted candidate and commits its
 * workspace version, provenance, receipt and cumulative ledger atomically. */
export class ScriptDraftStore {
  private writeFrame:{stepId:string;candidateId:string}|null=null;
  private readonly recordContents=new Map<string,{data:string;record:ScriptDraftRecord;contentHash:string}>();
  private recordContentSize=0;
  constructor(private readonly store:AgentSqliteStore,private readonly workspaces:ScriptWorkspaceStore,
    private readonly authorizations:ScriptAuthorizationStore,private readonly contexts:SqliteContextStore,
    private readonly journal:SqliteModelJournal){}
  ensureSchema(){this.store.db.exec(`
    CREATE TABLE IF NOT EXISTS script_draft_candidates(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES agent_runs(id),step_id TEXT NOT NULL REFERENCES agent_steps(id),invocation_id TEXT NOT NULL UNIQUE REFERENCES agent_invocations(id),payload_hash TEXT NOT NULL,data_json TEXT NOT NULL,receipt_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_draft_ledgers(authorization_id TEXT PRIMARY KEY REFERENCES script_authorizations(id),revision INTEGER NOT NULL,data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_goal_creation_ledgers(goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(goal_id,goal_revision));
    CREATE TABLE IF NOT EXISTS script_draft_applications(candidate_id TEXT PRIMARY KEY REFERENCES script_draft_candidates(id),run_id TEXT NOT NULL REFERENCES agent_runs(id),step_id TEXT NOT NULL REFERENCES agent_steps(id),workspace_revision INTEGER NOT NULL);
  `);}
  private step(token:ExecutionToken){
    this.store.assertExecution(token);
    if(!token.stepId)denied('候选操作缺少真实能力步骤');
    const row=this.store.db.prepare('SELECT call_id FROM agent_steps WHERE id=? AND run_id=? AND generation=?').get(token.stepId,token.runId,token.inputRevision) as {call_id:string}|undefined;
    if(!row)denied('能力步骤身份与执行令牌不一致');
    const step=this.store.getStep(token.runId,token.inputRevision,row.call_id);
    if(!step||step.id!==token.stepId)denied('能力步骤已改变');
    return {step,callId:row.call_id};
  }
  private input(call:PreparedCall):Record<string,unknown>{
    const value=call.request.input;
    if(!value||typeof value!=='object'||Array.isArray(value))denied('步骤输入缺少冻结参数');
    return value as Record<string,unknown>;
  }
  private envelope(token:ExecutionToken){
    const {step,callId}=this.step(token),run=this.store.readRun(token.runId),auth=this.authorizations.forRun(run,step.status==='COMMITTED'?'VIEW':'CONSUME');
    if(step.prepared.binding.ownerId!==run.ownerId||step.prepared.binding.commandRevision!==String(token.inputRevision))denied('步骤作者或输入版本不一致');
    const input=this.input(step.prepared);
    if(input.authorizationRef!==auth.id)denied('步骤没有绑定本次作者授权');
    return {step,callId,run,auth,input};
  }
  private ledger(authorizationId:string):ScriptDraftCreationLedger{
    const row=this.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(authorizationId) as {data_json:string}|undefined;
    return row?JSON.parse(row.data_json):emptyScriptDraftCreationLedger();
  }
  private goalCreation(run:AgentRun){
    if(!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_run_links'").get())return null;
    const link=this.store.db.prepare('SELECT goal_id,goal_revision,role FROM agent_run_links WHERE run_id=?').get(run.id) as
      {goal_id:string|null;goal_revision:number|null;role:string}|undefined;
    if(!link?.goal_id||!link.goal_revision||!['GOAL_CONTROLLER','MANUAL_STEP'].includes(link.role))return null;
    const row=this.store.db.prepare(`SELECT g.owner_id,g.thread_id,g.active_revision,r.data_json
      FROM agent_goals g JOIN agent_goal_revisions r ON r.goal_id=g.id AND r.revision=? WHERE g.id=?`)
      .get(link.goal_revision,link.goal_id) as {owner_id:string;thread_id:string;active_revision:number;data_json:string}|undefined;
    if(!row||row.owner_id!==run.ownerId||row.thread_id!==run.threadId||row.active_revision!==link.goal_revision)
      denied('关联委托版本已改变');
    const revision=JSON.parse(row.data_json),contract=readScriptGoalEnvelope(revision.contract);
    const ledgerRow=this.store.db.prepare('SELECT revision,data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
      .get(link.goal_id,link.goal_revision) as {revision:number;data_json:string}|undefined;
    const legacy=!ledgerRow?this.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?')
      .get(revision.authorizationRef) as {data_json:string}|undefined:undefined;
    return {goalId:link.goal_id,goalRevision:link.goal_revision,scope:contract.scope,checks:contract.checks,
      ledger:ledgerRow?JSON.parse(ledgerRow.data_json) as ScriptDraftCreationLedger:
        legacy?JSON.parse(legacy.data_json) as ScriptDraftCreationLedger:emptyScriptDraftCreationLedger(),
      ledgerRevision:ledgerRow?.revision??0};
  }
  /** Rebase only the finite repair run's own verified application chain.
   * Any author save, unrelated run or missing receipt keeps the old grant fenced. */
  scopeForRun(run:AgentRun):ScriptDraftScope{
    const auth=this.authorizations.forRun(run),scope=auth.scope as ScriptDraftScope;
    const contract=(run.input as any)?.planningRepair as PlanningRepairContract|undefined;
    if(!contract)return scope;
    if(contract.version!==1||contract.maxRepairRounds!==2)denied('规划返修合同无效');
    const workspace=this.workspaces.read(auth.workspaceId,run.ownerId);
    let revision=Number(auth.workspaceRef.version),before=this.workspaces.version(workspace.id,run.ownerId,revision);
    const origin=before;
    const rows=this.store.db.prepare('SELECT candidate_id,workspace_revision FROM script_draft_applications WHERE run_id=? ORDER BY workspace_revision').all(run.id) as Array<{candidate_id:string;workspace_revision:number}>;
    if(rows.length>2)denied('规划返修最多两轮');
    for(const row of rows){
      const record=this.readCandidate(run.ownerId,row.candidate_id,'VIEW');
      if(record.runId!==run.id||record.authorizationId!==auth.id||!record.candidate||record.request.operation!==contract.operation||
        Number(record.baseRef.version)!==revision||record.baseRef.contentHash!==hashValue(before)||row.workspace_revision!==revision+1)denied('规划返修采用链不连续');
      const after=this.workspaces.version(workspace.id,run.ownerId,row.workspace_revision);
      if(createWorkspacePatch(applyWorkspacePatch(before,record.candidate.patch),after).operations.length)denied('规划返修采用内容与回执不符');
      revision=row.workspace_revision;before=after;
    }
    if(workspace.revision!==revision||hashValue(workspace.document)!==hashValue(before))denied('工作稿在规划返修期间被独立修改，请重新检查');
    return rows.length?continuedPlanningScope(scope,origin,workspace.document):scope;
  }
  /** Cheap, no-model preflight. It reads the same trusted cumulative ledger as
   * commit; the returned model candidate is still rechecked from scratch. */
  assertProposalTarget(run:AgentRun,request:Omit<AgentDraftRequest,'candidateId'>):void{
    const auth=this.authorizations.forRun(run,'CONSUME'),scope=this.scopeForRun(run);
    const planning=(run.input as any)?.planningRepair as PlanningRepairContract|undefined;
    if(planning){const count=(this.store.db.prepare('SELECT COUNT(*) AS n FROM script_draft_candidates WHERE run_id=?').get(run.id) as {n:number}).n;
      if(count>=2||request.operation!==planning.operation||request.unitId!==planning.target.unitId||request.sceneId!==planning.target.sceneId||request.nodeId!==planning.target.nodeId)denied('规划返修超出两轮或固定目标');}
    if(!scope.operations.includes(request.operation))denied('写作操作未授权');
    if(request.sceneId&&!['scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection'].includes(request.operation))denied('当前操作不接受场景正文目标');
    if((request.beforeSceneId||request.afterSceneId)&&request.operation!=='plan_scenes')denied('插入锚点只用于分场');
    if(request.continuationCheckpoint&&request.operation!=='append_scene_body')denied('续写检查点只用于本场追加');
    const workspace=this.workspaces.read(auth.workspaceId,run.ownerId),ledger=this.ledger(auth.id),goal=this.goalCreation(run);
    assertStructureScopesCurrent(workspace.document,scope,ledger);
    if(goal){
      assertStructureScopesCurrent(workspace.document,goal.scope,goal.ledger);
      if(goal.checks.storyCoverage&&['plan_scenes','scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection'].includes(request.operation)){
        const targets=goal.checks.storyCoverage.targets.filter(target=>target.unitId===request.unitId),basis=collectOutlineRequirements(workspace.document,targets);
        if(targets.length&&(!basis.items.length||basis.gaps.length))denied('先完成获准的大纲准备，再按约定范围展开分场或正文');
      }
      if(goal.scope.workspaceId!==workspace.id||!goal.scope.operations.includes(request.operation))denied('步骤超出关联委托');
      if(request.operation==='add_unit'&&(!goal.scope.newUnitSlots.some(slot=>slot.slotId===request.slotId)||
        goal.ledger.units.some(item=>item.slotId===request.slotId)))denied('关联委托新单元槽已用尽');
      if(request.operation==='plan_scenes'&&(!goal.scope.units.some(unit=>unit.unitId===request.unitId&&
        goal.ledger.scenes.filter(scene=>scene.unitId===request.unitId).length<unit.maxNewScenes)))denied('关联委托新场景额度已用尽');
    }
    if(request.unitId&&!scope.units.some(unit=>unit.unitId===request.unitId))denied('目标单元未授权');
    const unit=workspace.document.units.find(item=>item.id===request.unitId),unitGrant=scope.units.find(item=>item.unitId===request.unitId);
    const scene=unit?.scenes.find(item=>item.id===request.sceneId);
    const sceneGrant=unitGrant?.scenes.find(item=>item.sceneId===request.sceneId)??
      (unitGrant&&(unitGrant.allowAllScenes||ledger.scenes.some(item=>item.unitId===request.unitId&&item.sceneId===request.sceneId))
        ?{allowBody:true,allowPlan:true,blockIds:null,selection:undefined}:null);
    const field=request.operation==='project_outline'?'outline':request.operation;
    if(request.operation==='scene_order'){const grant=scope.sceneOrderGrants?.find(g=>g.unitId===request.unitId&&g.nodeId===request.nodeId);if(!unit||!grant||!same(grant,freezeSceneOrder(workspace.document,unit.id,request.nodeId)))denied('场序范围或成员已变化');
    }else if(request.operation==='outline_development'){const grant=scope.outlineGrants?.[0];if(!unit||!grant||grant.nodeId!==request.nodeId||outlineHash(outlineText(workspace.document,grant.owner))!==grant.sourceHash)denied('大纲原文授权缺失或版本已变化');
      if(grant.owner.kind==='season'?request.seasonId!==grant.owner.id||request.scopeId&&request.scopeId!==grant.owner.id:Boolean(request.seasonId))denied('大纲目标与冻结归属不符');
    }else if([...BLUEPRINT_BRIEF_FIELDS,'project_outline'].includes(request.operation)){
      if(!scope.sharedFields.includes(field as any))denied('共享字段未授权');
    }else if(request.operation==='story_outline'){
      if(!request.scopeId||!scope.storyOutlineScopeIds?.includes(request.scopeId)||unit&&unit.scopeId!==request.scopeId)denied('故事大纲未授权或所属单元不匹配');
    }else if(request.operation==='season_outline'){
      if(!unit||!request.seasonId||!scope.seasonOutlineIds?.includes(request.seasonId)||request.scopeId&&request.scopeId!==request.seasonId||!unitBelongsToSeason(workspace.document,unit,request.seasonId))denied('季大纲未授权或所属单元不匹配');
    }else if(request.operation==='add_unit'){
      if(!scope.newUnitSlots.some(slot=>slot.slotId===request.slotId&&!workspace.document.units.some(item=>item.id===slot.unitId)&&
        !ledger.units.some(item=>item.slotId===slot.slotId)))denied('新单元槽不存在或已使用');
    }else if(request.operation==='unit_outline'){
      if(!unit||!unitGrant?.allowSummary)denied('单元大纲未授权');
    }else if(request.operation==='plan_scenes'){
      if(!unit||!unitGrant||ledger.scenes.filter(item=>item.unitId===unit.id).length>=unitGrant.maxNewScenes)denied('新场景累计额度已用尽');
      if(unitGrant.nodeScopes?.length&&!unitGrant.nodeScopes.some(node=>node.allowCreate&&(node.nodeId===request.nodeId||node.descendantNodeIds.includes(request.nodeId!))))denied('分场必须插入本次获准的段落');
    }else if(request.operation==='scene_plan'){
      if(!scene||!sceneGrant?.allowPlan)denied('场景规划未授权');
    }else if(request.operation==='plan_structure'){
      if(!unitGrant?.allowStructure||!unitGrant.allowAllScenes||unit?.structureNodes?.length)denied('仅可在获准的整单元首次建立结构目录');
    }else if(['scene_body','append_scene_body','replace_blocks','replace_selection'].includes(request.operation)){
      if(!scene||!sceneGrant?.allowBody)denied('场景正文不在授权范围');
      if(['scene_body','append_scene_body'].includes(request.operation)&&(sceneGrant.blockIds!==null||sceneGrant.selection))denied('局部授权不能替换或续写整场');
      if(request.operation==='append_scene_body'){
        if(!request.continuationCheckpoint||request.continuationCheckpoint.unitId!==request.unitId||request.continuationCheckpoint.sceneId!==request.sceneId)denied('续写需要本场的固定检查点');
        assertSceneContinuationCheckpoint(workspace.document,request.continuationCheckpoint);
      }
      if(request.operation==='replace_blocks'){
        const ids=request.blockIds||[],start=scene.blocks.findIndex(block=>block.id===ids[0]);
        if(!ids.length||new Set(ids).size!==ids.length||start<0||ids.some((id,index)=>scene.blocks[start+index]?.id!==id)||sceneGrant.selection)denied('待改正文块不在连续授权范围');
        if(sceneGrant.blockIds!==null){
          const allowed=new Set([...sceneGrant.blockIds,...ledger.blocks.filter(item=>item.sceneId===scene.id&&
            item.originBlockIds.some(id=>sceneGrant.blockIds!.includes(id))).map(item=>item.blockId)]);
          if(ids.some(id=>!allowed.has(id)))denied('待改正文块不在授权范围');
        }
      }
      if(request.operation==='replace_selection'){
        const selection=request.selection,rendered=blocksToScreenplayText(scene.blocks,unitCharacters(workspace.document,unit!));
        if(!selection||rendered.slice(selection.start,selection.end)!==selection.text||
          sceneGrant.selection&&!same(sceneGrant.selection,selection))denied('文字选区不在冻结范围');
        if(sceneGrant.blockIds!==null){
          const allowed=new Set([...sceneGrant.blockIds,...ledger.blocks.filter(item=>item.sceneId===scene.id&&
            item.originBlockIds.some(id=>sceneGrant.blockIds!.includes(id))).map(item=>item.blockId)]);
          if(selectionBlockIds(workspace.document,unit!.id,scene.id,selection).some(id=>!allowed.has(id)))denied('文字选区跨出授权块');
        }
      }
    }else if(request.operation==='update_character'||request.operation==='update_fact'){
      const key=request.operation==='update_character'?'characterIds':'factIds';
      if(!request.entityId||!scope[key]?.includes(request.entityId)||goal&&!goal.scope[key]?.includes(request.entityId))denied('资料修改标识未授权');
      if(!(key==='characterIds'?workspace.document.characters:workspace.document.facts).some(item=>item.id===request.entityId))denied('资料已删除');
      if(request.unitId&&!unitGrant)denied('资料读取单元未授权');
    }else if(request.operation==='add_character'){
      if(!request.scopeId||!scope.characterScopeIds.includes(request.scopeId))denied('人物作用域未授权');
    }else if(request.operation==='add_fact'){
      if(!request.scopeId||!scope.factScopeIds.includes(request.scopeId))denied('事实作用域未授权');
    }
  }
  private stored(candidateId:string,ownerId:string):Stored{
    const row=this.store.db.prepare('SELECT * FROM script_draft_candidates WHERE id=? AND owner_id=?').get(candidateId,ownerId) as any;
    if(!row)throw new AgentError('SCRIPT_DRAFT_NOT_FOUND','候选不存在或不属于作者',404);
    const previous=this.recordContents.get(candidateId);
    const content=previous?.data===row.data_json?previous:(()=>{
      const record=JSON.parse(row.data_json) as ScriptDraftRecord;
      return {data:row.data_json as string,record,contentHash:hashValue(record)};
    })();
    const {record,contentHash}=content;
    // A content hit is never permission: read the row and compare every bound
    // identity/digest again. Provenance is checked separately on every access.
    if(record.id!==row.id||record.ownerId!==row.owner_id||record.workspaceId!==row.workspace_id||record.runId!==row.run_id||record.stepId!==row.step_id||record.invocationId!==row.invocation_id||contentHash!==row.payload_hash)denied('候选持久记录已损坏');
    if(content!==previous){
      if(previous){this.recordContents.delete(candidateId);this.recordContentSize-=previous.data.length;}
      if(content.data.length<=16_000_000){
        while(this.recordContents.size>=128||this.recordContentSize+content.data.length>16_000_000){
          const key=this.recordContents.keys().next().value!;
          this.recordContentSize-=this.recordContents.get(key)!.data.length;this.recordContents.delete(key);
        }
        this.recordContents.set(candidateId,content);this.recordContentSize+=content.data.length;
      }
    }
    // Public readers may edit their returned candidate. Never lend out the
    // cached object, including its nested request, model input or patch.
    return {record:structuredClone(record),receipt:JSON.parse(row.receipt_json),contentHash};
  }
  readCandidate(ownerId:string,candidateId:string,phase:'VIEW'|'CONSUME'='VIEW'):ScriptDraftRecord{
    const record=this.stored(candidateId,ownerId).record;
    this.assertCandidateContext(record,phase);
    return record;
  }
  private assertCandidateContext(record:ScriptDraftRecord,phase:'VIEW'|'CONSUME'){
    // The exact original source can be viewed by a later author command, but
    // a withdrawn dependency cannot be laundered through a candidate row.
    this.contexts.assertArtifact('script-draft-candidate',record.id,'VIEW');
    if(phase==='CONSUME')this.contexts.assertAllowed(record.contextRef,access(record.ownerId,record.workspaceId));
  }
  /** A decision sees only this bounded persisted fact, never model prompts or
   * raw candidate bodies. Call under the current authorization reader frame. */
  readCandidateView(ownerId:string,candidateId:string){
    const {record,contentHash}=this.stored(candidateId,ownerId);
    this.assertCandidateContext(record,'VIEW');
    const ref:ResourceRef={uri:`resource://script/draft-candidates/${record.id}`,version:'1',contentHash,branch:`workspace:${record.workspaceId}`};
    const row=this.store.db.prepare('SELECT generation,call_id FROM agent_steps WHERE id=? AND run_id=?').get(record.stepId,record.runId) as any;
    const step=row?this.store.getStep(record.runId,row.generation,row.call_id):null;
    if(!step||step.status!=='COMMITTED'||!step.observation||step.prepared.request.capabilityId!=='script.propose'||
      !step.observation.artifacts.some(artifact=>same(artifact,ref)))denied('候选尚无已提交步骤证据');
    const application=this.store.db.prepare('SELECT workspace_revision FROM script_draft_applications WHERE candidate_id=?').get(record.id) as any;
    return {id:record.id,workspaceId:record.workspaceId,status:record.status,delivery:record.candidate?.delivery??null,operation:record.request.operation,
      unitId:record.request.unitId??null,sceneId:record.request.sceneId??null,baseRef:record.baseRef,
      appliedRevision:application?.workspace_revision??null,ref};
  }
  /** A review can cite only a real COMMITTED workspace write, never a model's
   * claim that its proposed text was applied. Call under the current reader's
   * authorization frame when using this in a later Goal or manual step. */
  readApplication(ref:ResourceRef,ownerId:string,phase:'VIEW'|'CONSUME'='VIEW'):ScriptDraftApplication{
    const url=new URL(ref.uri),match=/^\/workspaces\/(workspace_[\w-]+)$/.exec(url.pathname);
    const revision=Number(ref.version);
    if(url.protocol!=='resource:'||url.hostname!=='script'||url.username||url.password||url.port||url.search||url.hash||
      !match||!Number.isSafeInteger(revision)||revision<2||String(revision)!==ref.version||ref.branch!==`workspace:${match[1]}`)
      denied('返修引用不是精确工作稿版本');
    const document=this.workspaces.version(match[1],ownerId,revision);
    if(hashValue(document)!==ref.contentHash)denied('返修引用内容身份不一致');
    const row=this.store.db.prepare(`SELECT a.candidate_id,a.run_id,a.step_id,c.owner_id,c.workspace_id,c.data_json
      FROM script_draft_applications a JOIN script_draft_candidates c ON c.id=a.candidate_id
      WHERE c.workspace_id=? AND a.workspace_revision=?`).get(match[1],revision) as any;
    if(!row||row.owner_id!==ownerId||row.workspace_id!==match[1])denied('该工作稿版本不是已提交的候选采用');
    const record=this.readCandidate(ownerId,row.candidate_id,phase);
    const step=this.store.db.prepare('SELECT * FROM agent_steps WHERE id=?').get(row.step_id) as any;
    if(!step||step.run_id!==row.run_id||step.status!=='COMMITTED'||!step.observation_json||
      record.id!==row.candidate_id||record.workspaceId!==match[1])denied('候选采用缺少真实步骤回执');
    const receipt=JSON.parse(step.observation_json) as Observation;
    if(receipt.status!=='SUCCEEDED'||receipt.effectState!=='EFFECT_VERIFIED'||!receipt.artifacts.some(item=>same(item,ref)))
      denied('真实步骤回执没有确认此工作稿版本');
    const prepared=JSON.parse(step.prepared_json) as PreparedCall,{preparedDigest,...preparedValue}=prepared;
    const input=this.input(prepared);
    if(preparedDigest!==hashValue(preparedValue)||prepared.inputDigest!==hashValue(input)||
      prepared.request.capabilityId!=='script.apply_patch'||prepared.binding.ownerId!==ownerId||
      input.candidateId!==record.id||input.expectedRevision!==revision-1||typeof input.authorizationRef!=='string')denied('采用步骤范围证据已改变');
    const authorization=this.authorizations.read(input.authorizationRef as string,ownerId);
    if(authorization.workspaceId!==match[1]||!record.candidate)denied('采用步骤缺少对应作者授权');
    const before=this.workspaces.version(match[1],ownerId,revision-1),applied=applyWorkspacePatch(before,record.candidate.patch);
    if(!same({...applied,revision,updatedAt:document.updatedAt},document))denied('已提交工作稿与实际候选补丁不一致');
    return {candidateId:record.id,workspaceId:match[1],beforeRevision:revision-1,afterRevision:revision,
      runId:row.run_id,stepId:row.step_id,authorizationRef:authorization.id,ref};
  }
  sourceAllowed(ref:ResourceRef,sourceAccess:{ownerId:string;scopeId:string;branch:string},freshness:'EXACT'|'CURRENT'|'COLLECTION'){
    try{
      const url=new URL(ref.uri),match=/^\/draft-candidates\/(draft_[\w-]+)$/.exec(url.pathname);
      if(url.protocol!=='resource:'||url.hostname!=='script'||url.username||url.password||url.port||url.search||url.hash||!match||freshness==='COLLECTION')return false;
      const candidate=this.readCandidateView(sourceAccess.ownerId,match[1]);
      return candidate.workspaceId===sourceAccess.scopeId&&sourceAccess.branch===`workspace:${candidate.workspaceId}`&&same(ref,candidate.ref);
    }catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;return false;}
  }
  repairGrants(workspace:ScriptWorkspace,prior:ScriptDraftRecord){
    const scope=this.authorizations.read(prior.authorizationId,workspace.ownerId).scope as ScriptDraftScope;
    if(same(prior.baseRef,workspaceRef(workspace)))return structuredClone(scope.outlineGrants);
    const applied=this.store.db.prepare('SELECT workspace_revision FROM script_draft_applications WHERE candidate_id=?').get(prior.id);
    const original=this.workspaces.version(workspace.id,workspace.ownerId,Number(prior.baseRef.version));
    if(!applied||!prior.candidate||createWorkspacePatch(applyWorkspacePatch(original,prior.candidate.patch),workspace.document).operations.length)denied('原候选采用后又有其他修改，请重新核对补齐范围');
    return scope.outlineGrants?.map(grant=>{
      const local=Boolean(grant.nodeId)||grant.start!==0||grant.end!==outlineText(original,grant.owner).length;
      const end=grant.start+String(prior.candidate!.result.content).length;
      const renewed=freezeOutlineGrant(workspace.document,grant.owner,{nodeId:grant.nodeId,outlineBeatIds:grant.outlineBeatIds,allowStructure:grant.allowStructure,allowSceneOrder:grant.allowSceneOrder,structureUnitId:grant.structureUnitId,
        ...(local&&!grant.nodeId?{range:{start:grant.start,end,quote:outlineText(workspace.document,grant.owner).slice(grant.start,end)}}:{})});
      if(local&&(renewed.start!==grant.start||renewed.end!==end))denied('已采用段落的原文关联改变，请重新选择待补齐范围');
      return renewed;
    });
  }
  repairSource(run:AgentRun,request:Partial<AgentDraftRequest>):ScriptDraftRecord{
    return this.authorizations.withRunAuthorization(run,'CONSUME',()=>{
      const auth=this.authorizations.forRun(run),workspace=this.workspaces.read(auth.workspaceId,run.ownerId);
      const repairs=(this.store.db.prepare('SELECT data_json FROM script_draft_candidates WHERE run_id=?').all(run.id) as Array<{data_json:string}>).filter(row=>JSON.parse(row.data_json).request.repairCandidateId);
      if(repairs.length>=2)denied('本轮格式补齐已达两次，保留已有结果，请明确继续');
      const prior=this.readCandidate(run.ownerId,request.repairCandidateId!,'CONSUME');
      if(request.operation!=='outline_development'||prior.request.operation!==request.operation||prior.workspaceId!==workspace.id||
        prior.request.unitId!==request.unitId||prior.request.nodeId!==request.nodeId)
        denied('补齐请求与原候选目标或版本不一致');
      const originalAuth=this.authorizations.read(prior.authorizationId,run.ownerId);
      if(!same(this.repairGrants(workspace,prior),(auth.scope as ScriptDraftScope).outlineGrants))denied('补齐请求的大纲授权与原候选不同');
      return prior;
    });
  }
  private proposalInput(input:Record<string,unknown>,baseRef:ResourceRef):{request:AgentDraftRequest;manifest:DraftManifest;model:ModelRequest}{
    const allowed=['authorizationRef','operation','instruction','unitId','sceneId','slotId','scopeId','seasonId','entityId','blockIds','selection','nodeId','beforeSceneId','afterSceneId','continuationCheckpoint','repairCandidateId','frozen'];
    if(Object.keys(input).some(key=>!allowed.includes(key))||!id(input.authorizationRef))denied('候选步骤输入不符合合同');
    if(typeof input.instruction!=='string'||!input.instruction.trim())denied('候选步骤缺少作者指令');
    const operation=input.operation as AgentDraftRequest['operation'];
    agentDraftOutputSchema(operation);
    for(const key of ['unitId','sceneId','slotId','scopeId','seasonId','entityId','nodeId','beforeSceneId','afterSceneId','repairCandidateId'] as const)if(input[key]!=null&&!id(input[key]))denied(`${key} 无效`);
    if(input.blockIds!=null&&(!Array.isArray(input.blockIds)||!input.blockIds.every(id)))denied('块目标无效');
    if(input.selection!=null&&(!input.selection||typeof input.selection!=='object'||Array.isArray(input.selection)||
      Object.keys(input.selection).sort().join()!=='end,start,text'))denied('选区无效');
    const frozen=input.frozen as any;
    if(!frozen||typeof frozen!=='object'||Object.keys(frozen).sort().join()!=='baseRef,model'||!same(frozen.baseRef,baseRef)||!frozen.model)denied('冻结模型请求或工作稿基线不一致');
    const manifest:DraftManifest={authorizationRef:input.authorizationRef as string,workspaceRef:baseRef,operation};
    const request:AgentDraftRequest={candidateId:'',operation};
    for(const key of ['unitId','sceneId','slotId','scopeId','seasonId','entityId','blockIds','selection','nodeId','beforeSceneId','afterSceneId','continuationCheckpoint','repairCandidateId'] as const)if(input[key]!=null){(manifest as any)[key]=structuredClone(input[key]);(request as any)[key]=structuredClone(input[key]);}
    return {request,manifest,model:frozen.model};
  }
  recordResult(input:{token:ExecutionToken;invocationId:string}):Observation{
    return this.store.atomic(()=>{
      const {step,callId,run,auth,input:stepInput}=this.envelope(input.token);
      if(step.status==='COMMITTED'){
        const old=this.store.db.prepare('SELECT id FROM script_draft_candidates WHERE step_id=?').get(step.id) as {id:string}|undefined;
        if(!old)denied('候选回执缺少持久记录');
        const stored=this.stored(old.id,run.ownerId);
        if(stored.record.invocationId!==input.invocationId)denied('回放用了另一模型请求');
        this.authorizations.withRunAuthorization(run,'VIEW',()=>this.readCandidate(run.ownerId,old.id,'VIEW'));
        return this.store.commitStep(input.token,callId,stored.receipt,()=>{});
      }
      if(step.status!=='PREPARED')denied('候选步骤不能记录模型结果');
      const workspace=this.workspaces.read(auth.workspaceId,run.ownerId),baseRef=workspaceRef(workspace);
      const frozen=this.proposalInput(stepInput,baseRef);
      if(!step.prepared.sources.some(ref=>same(ref,baseRef)))denied('候选步骤缺少当前工作稿来源');
      const invocation=this.journal.read(input.invocationId);
      invocation.result=this.journal.resolvedResult(invocation.id);
      if(invocation.runId!==run.id||invocation.inputRevision!==input.token.inputRevision||invocation.ownerKey!==step.id||
        invocation.status!=='RECEIVED'||!invocation.result||!same(invocation.request,frozen.model)||
        !same(invocation.request.inputManifest?.scriptDraft,frozen.manifest)||invocation.inputHash!==hashValue(invocation.request)||
        invocation.request.inputManifest?.authorInstruction!==stepInput.instruction||
        !same(invocation.request.outputSchema,agentDraftOutputSchema(frozen.request.operation))||!invocation.request.contextRef)denied('实际模型请求与候选步骤不一致');
      this.journal.assertInput(input.token,invocation.request);
      const candidateId=`draft_${hashValue({stepId:step.id,invocationId:invocation.id}).slice(0,48)}`;
      const repair=frozen.request.repairCandidateId?this.repairSource(run,frozen.request):null;
      const request={...frozen.request,candidateId,...(repair?{identitySeed:repair.request.identitySeed||repair.id}:{})};
      const origin=(run.input as any)?.planningRepair?workspace.document:this.workspaces.version(workspace.id,run.ownerId,Number(auth.workspaceRef.version));
      let candidate:AgentDraftCandidate|null=null,error:string|null=null;
      try{
        if(invocation.result.failure)throw new Error(invocation.result.failure.message);
        if(invocation.result.validationErrors?.length)throw new Error(invocation.result.validationErrors.join('；'));
        candidate=buildAgentDraft(invocation.result.text,request,workspace.document,this.scopeForRun(run),
          {origin,ledger:this.ledger(auth.id)});
        if(repair?.candidate){
          for(const field of ['content','nodes','beats'])if(repair.candidate.result[field]!==null&&!same(candidate.result[field],repair.candidate.result[field]))
            throw new Error(`补齐请求改变了已交付的 ${field}，原候选仍保留`);
        }
      }catch(cause){candidate=null;error=cause instanceof Error?cause.message:'候选解析失败';}
      const record:ScriptDraftRecord={id:candidateId,ownerId:run.ownerId,workspaceId:workspace.id,authorizationId:auth.id,
        runId:run.id,stepId:step.id,callId,invocationId:invocation.id,modelRequest:invocation.request,modelInputHash:invocation.inputHash,
        modelResult:invocation.result,raw:invocation.result.text,contextRef:invocation.request.contextRef,baseRef,request,
        status:candidate?'VALID':'INVALID',error,candidate};
      const ref=scriptDraftCandidateRef(record);
      const receipt:Observation={status:candidate?'SUCCEEDED':'FAILED',summary:candidate?'剧本候选已保存':'模型原文已保存，候选格式或范围无效',
        data:{candidateId,status:record.status,error,...(candidate?.delivery?{delivery:candidate.delivery}:{})},evidence:[baseRef],artifacts:[ref],effectState:'CANDIDATE_PRESERVED',retry:'NEVER'};
      return this.store.commitStep(input.token,callId,receipt,()=>{
        this.store.db.prepare('INSERT INTO script_draft_candidates VALUES(?,?,?,?,?,?,?,?,?)').run(record.id,record.ownerId,record.workspaceId,record.runId,
          record.stepId,record.invocationId,hashValue(record),stableJson(record),stableJson(receipt));
        // The frozen prompt's memory collection was evaluated inside this
        // run's author grant. Bind its result under the same reader range.
        this.authorizations.withRunAuthorization(run,'CONSUME',()=>
          this.contexts.bindArtifact('script-draft-candidate',record.id,record.contextRef,access(record.ownerId,record.workspaceId)));
      });
    });
  }
  private applyInput(input:Record<string,unknown>){
    if(Object.keys(input).sort().join()!=='authorizationRef,candidateId,expectedRevision,writerEpoch'||!id(input.candidateId)||
      !Number.isSafeInteger(input.expectedRevision)||!Number.isSafeInteger(input.writerEpoch))denied('采用步骤输入无效');
    return {candidateId:input.candidateId as string,expectedRevision:input.expectedRevision as number,writerEpoch:input.writerEpoch as number};
  }
  /** Used during Capability.prepare, before a Step exists. All checks are
   * repeated under the persisted Step in the WRITE transaction. */
  preflightCandidate(run:AgentRun,candidateId:string):{record:ScriptDraftRecord;workspace:ScriptWorkspace;ref:ResourceRef}{
    const auth=this.authorizations.forRun(run,'CONSUME');
    const record=this.authorizations.withRunAuthorization(run,'CONSUME',()=>{
      return this.readCandidate(run.ownerId,candidateId,'VIEW');
    });
    const workspace=this.workspaces.read(auth.workspaceId,run.ownerId);
    if(record.status!=='VALID'||!record.candidate||record.workspaceId!==workspace.id||
      !same(record.baseRef,workspaceRef(workspace)))denied('候选不属于当前授权工作稿版本');
    const origin=(run.input as any)?.planningRepair?workspace.document:this.workspaces.version(workspace.id,run.ownerId,Number(auth.workspaceRef.version));
    const rebuilt=buildAgentDraft(record.raw,record.request,workspace.document,this.scopeForRun(run),
      {origin,ledger:this.ledger(auth.id)});
    if(!same(rebuilt.patch,record.candidate.patch)||!same(rebuilt.idMap,record.candidate.idMap)||rebuilt.patchDigest!==record.candidate.patchDigest)denied('候选身份或补丁已变化');
    return {record,workspace,ref:scriptDraftCandidateRef(record)};
  }
  private checkedWrite(input:{workspace:ScriptWorkspace;token:ExecutionToken;patch:WorkspacePatch;contextRef:{id:string;digest:string}}){
    const {step,run,auth,input:stepInput}=this.envelope(input.token),args=this.applyInput(stepInput);
    const {record,workspace}=this.preflightCandidate(run,args.candidateId);
    if(!same(workspaceRef(workspace),workspaceRef(input.workspace))||
      input.workspace.revision!==args.expectedRevision||
      !same(record.contextRef,input.contextRef)||!same(record.candidate.patch,input.patch)||
      !step.prepared.sources.some(ref=>same(ref,scriptDraftCandidateRef(record)))||
      !step.prepared.targets.some(ref=>same(ref,workspaceRef(input.workspace))))denied('采用步骤没有绑定此候选和当前工作稿');
    const applied=this.store.db.prepare('SELECT * FROM script_draft_applications WHERE candidate_id=?').get(record.id) as any;
    if(applied&&applied.step_id!==step.id)denied('候选已由另一步骤采用');
    const origin=(run.input as any)?.planningRepair?input.workspace.document:this.workspaces.version(input.workspace.id,run.ownerId,Number(auth.workspaceRef.version));
    assertAgentDraftScope(input.workspace.document,input.patch,this.scopeForRun(run),record.request.operation,
      {...record.request,origin,ledger:this.ledger(auth.id)});
    return {record,auth,args,step,run};
  }
  assertWorkspaceWrite(input:{workspace:ScriptWorkspace;token:ExecutionToken;patch:WorkspacePatch;contextRef:{id:string;digest:string}}):void{
    const checked=this.checkedWrite(input);
    if(!this.writeFrame||this.writeFrame.stepId!==checked.step.id||this.writeFrame.candidateId!==checked.record.id)
      denied('工作稿模型写入必须经过候选仓储的同事务采用路径');
  }
  private extendLedger(before:ScriptProject,after:ScriptProject,record:ScriptDraftRecord,ledger:ScriptDraftCreationLedger){
    const next=structuredClone(ledger),request=record.request;
    if(request.operation==='add_unit')next.units.push({slotId:request.slotId!,unitId:after.units.at(-1)!.id});
    for(const unit of after.units){const prior=before.units.find(item=>item.id===unit.id);
      for(const scene of unit.scenes){const oldScene=prior?.scenes.find(item=>item.id===scene.id);
        if(!oldScene){if(prior)next.scenes.push({unitId:unit.id,sceneId:scene.id});continue;}
        const added=scene.blocks.filter(block=>!oldScene.blocks.some(old=>old.id===block.id));
        let roots=request.blockIds||[];
        if(request.operation==='replace_selection'&&request.selection){
          const characters=unitCharacters(before,prior!),selection=request.selection;let offset=0;
          roots=oldScene.blocks.flatMap(block=>{const rendered=blocksToScreenplayText([block],characters);if(!rendered)return [];
            const touched=selection.start<offset+rendered.length&&selection.end>offset;offset+=rendered.length+2;return touched?[block.id]:[];});
        }
        const originBlockIds=[...new Set(roots.flatMap(id=>ledger.blocks.find(item=>item.sceneId===scene.id&&item.blockId===id)?.originBlockIds||[id]))];
        for(const block of added)next.blocks.push({sceneId:scene.id,blockId:block.id,originBlockIds});
      }
    }
    if(request.operation==='add_character')next.characters.push({scopeId:request.scopeId!,id:after.characters.at(-1)!.id});
    if(request.operation==='add_fact')next.facts.push({scopeId:request.scopeId!,id:after.facts.at(-1)!.id});
    return next;
  }
  /** Read-only replay for the host's completion proof. No ledger is persisted. */
  applicationLedger(before:ScriptProject,after:ScriptProject,record:ScriptDraftRecord,ledger:ScriptDraftCreationLedger){
    return this.extendLedger(before,after,record,ledger);
  }
  apply(input:{token:ExecutionToken}):Observation{
    return this.store.atomic(()=>{
      const {step,callId,run,input:stepInput}=this.envelope(input.token),args=this.applyInput(stepInput);
      const persisted=this.stored(args.candidateId,run.ownerId);
      if(step.status==='COMMITTED'){
        const applied=this.store.db.prepare('SELECT step_id FROM script_draft_applications WHERE candidate_id=?').get(args.candidateId) as any;
        if(applied?.step_id!==step.id||!step.observation)denied('采用回执与候选不一致');
        this.authorizations.withRunAuthorization(run,'VIEW',()=>this.readCandidate(run.ownerId,args.candidateId,'VIEW'));
        return this.store.commitStep(input.token,callId,step.observation,()=>{});
      }
      const workspace=this.workspaces.read(persisted.record.workspaceId,run.ownerId);
      const checked=this.checkedWrite({workspace,token:input.token,patch:persisted.record.candidate?.patch!,contextRef:persisted.record.contextRef});
      const oldLedger=this.ledger(checked.auth.id),goal=this.goalCreation(run),after=applyWorkspacePatch(workspace.document,checked.record.candidate!.patch);
      const newLedger=this.extendLedger(workspace.document,after,checked.record,oldLedger);
      const sharedLedger=goal?this.extendLedger(workspace.document,after,checked.record,goal.ledger):null;
      if(goal){
        const origin=this.workspaces.version(workspace.id,run.ownerId,goal.scope.originRevision);
        assertAgentDraftScope(workspace.document,checked.record.candidate!.patch,goal.scope,checked.record.request.operation,
          {...checked.record.request,origin,ledger:goal.ledger});
      }
      if(this.writeFrame)denied('不能嵌套采用候选');
      this.writeFrame={stepId:step.id,candidateId:checked.record.id};
      let observation:Observation;
      try{observation=this.authorizations.withRunAuthorization(run,'CONSUME',()=>this.workspaces.applyFromRun({
        workspaceId:workspace.id,ownerId:run.ownerId,token:input.token,callId,
        expectedRevision:args.expectedRevision,writerEpoch:args.writerEpoch,patch:checked.record.candidate!.patch,
        contextRef:checked.record.contextRef}));}
      finally{this.writeFrame=null;}
      const previous=this.store.db.prepare('SELECT revision FROM script_draft_ledgers WHERE authorization_id=?').get(checked.auth.id) as {revision:number}|undefined;
      if(previous){
        if(this.store.db.prepare('UPDATE script_draft_ledgers SET revision=?,data_json=? WHERE authorization_id=? AND revision=?').run(previous.revision+1,stableJson(newLedger),checked.auth.id,previous.revision).changes!==1)denied('创建台账并发变化');
      }else this.store.db.prepare('INSERT INTO script_draft_ledgers VALUES(?,?,?)').run(checked.auth.id,1,stableJson(newLedger));
      if(goal&&sharedLedger){
        if(goal.ledgerRevision){
          if(this.store.db.prepare('UPDATE script_goal_creation_ledgers SET revision=?,data_json=? WHERE goal_id=? AND goal_revision=? AND revision=?')
            .run(goal.ledgerRevision+1,stableJson(sharedLedger),goal.goalId,goal.goalRevision,goal.ledgerRevision).changes!==1)denied('委托共享创建台账并发变化');
        }else this.store.db.prepare('INSERT INTO script_goal_creation_ledgers VALUES(?,?,?,?)')
          .run(goal.goalId,goal.goalRevision,1,stableJson(sharedLedger));
      }
      this.store.db.prepare('INSERT INTO script_draft_applications VALUES(?,?,?,?)').run(checked.record.id,run.id,step.id,args.expectedRevision+1);
      return observation;
    });
  }
}
