import { AgentError, ExecutionInvalidated, hashValue, type AgentRun, type ResourceRef } from '../../../../packages/agent-core/src';
import type { AgentSqliteStore, SqliteGoalStore } from '../../../../packages/agent-sqlite/src';
import { readScriptGoalEnvelope } from '../../../../packages/script/src/agentGoal';
import { assertAgentDraftScope, assertStructureScopesCurrent, emptyScriptDraftCreationLedger, type ScriptDraftScope, type ScriptDraftCreationLedger } from '../../../../packages/script/src/agentScope';
import type { ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';
import type { ScriptDraftStore } from '../repositories/scriptDraftStore';
import type { ScriptReviewPolicy } from '../repositories/scriptReviewStore';
import { workspaceRef, type ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import { collectOutlineRequirements, outlineSourcesChanged, type OutlineRequirement } from '../../../../packages/script/src/goalCoverage';
import { structureNodeSceneIds } from '../../../../packages/script/src/structure';
import type { GoalCheckContract } from '../../../../packages/script/src/goalChecks';

const deny=(message:string):never=>{throw new AgentError('SCRIPT_REVIEW_DENIED',message,403);};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
/** Completion derives evidence from committed effects across every run of the
 * Goal. Neither a model's FINISH nor a browser-supplied flag proves completion. */
export function createScriptReviewPolicy(deps:{store:AgentSqliteStore;goals:SqliteGoalStore;authorizations:ScriptAuthorizationStore;workspaces:ScriptWorkspaceStore;drafts:ScriptDraftStore}):ScriptReviewPolicy{
  const {store,goals,authorizations,workspaces,drafts}=deps;
  const authority=(run:AgentRun,phase:'VIEW'|'CONSUME')=>{
    const link=goals.readRunLink(run.id),auth=authorizations.forRun(run,phase);
    if(!link?.goalId||!link.goalRevision||link.authorizationRef!==auth.id)deny('检查任务没有对应的作者委托');
    const row=store.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision=?').get(link.goalId,link.goalRevision) as {data_json:string}|undefined;
    if(!row)deny('检查任务缺少固定目标版本');
    const revision=JSON.parse(row.data_json),contract=readScriptGoalEnvelope(revision.contract);
    if(contract.workspaceId!==auth.workspaceId||link.role==='GOAL_CONTROLLER'&&!same(contract.scope,auth.scope))deny('检查范围与作者授权不一致');
    const checks:GoalCheckContract=structuredClone(contract.checks);
    let workspace=workspaces.read(auth.workspaceId,run.ownerId);
    if(run.status==='SUCCEEDED'){
      const final=(run.result as {artifactRefs?:ResourceRef[]}|null)?.artifactRefs?.find(ref=>ref.uri===`resource://script/workspaces/${workspace.id}`&&ref.branch===`workspace:${workspace.id}`);
      if(final){const document=workspaces.version(workspace.id,run.ownerId,Number(final.version));workspace={...workspace,document,revision:document.revision};}
    }
    // A node can create scenes under its original grant. Derive the check set
    // from current membership; the write policy still verifies frozen scope.
    for(const grant of contract.scope.units)if(grant.nodeScopes?.length){
      const unit=workspace.document.units.find(item=>item.id===grant.unitId);
      if(unit&&grant.nodeScopes.every(node=>unit.structureNodes?.some(item=>item.id===node.nodeId))){
        const sceneIds=[...new Set(grant.nodeScopes.flatMap(node=>structureNodeSceneIds(unit,node.nodeId)))];
        {checks.targetScenes=(checks.targetScenes??[]).filter(item=>item.unitId!==unit.id);checks.targetScenes.push({unitId:unit.id,sceneIds});}
      }
    }
    if(checks.storyCoverage){
      const items:OutlineRequirement[]=[],gaps:string[]=[];
      const origin=workspaces.version(workspace.id,run.ownerId,checks.storyCoverage.originRevision);
      for(const target of checks.storyCoverage.targets){
        let basis=collectOutlineRequirements(origin,[target]);
        if(!basis.items.length||basis.gaps.length){
          // Outline preparation can improve freely until the first actual
          // expansion. Every such operation requires a usable range in preflight.
          const first=store.db.prepare(`SELECT c.data_json FROM script_draft_applications a JOIN script_draft_candidates c ON c.id=a.candidate_id
            JOIN agent_run_links l ON l.run_id=a.run_id WHERE l.goal_id=? AND c.workspace_id=? AND a.workspace_revision>? AND a.workspace_revision<=?
            AND json_extract(c.data_json,'$.request.unitId')=? AND json_extract(c.data_json,'$.request.operation') IN ('plan_scenes','scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection')
            ORDER BY a.workspace_revision LIMIT 1`).get(link.goalId,workspace.id,checks.storyCoverage.originRevision,workspace.revision,target.unitId) as {data_json:string}|undefined;
          const baseRevision=first?Number(JSON.parse(first.data_json).baseRef.version):workspace.revision;
          basis=collectOutlineRequirements(workspaces.version(workspace.id,run.ownerId,baseRevision),[target]);
        }
        const current=collectOutlineRequirements(workspace.document,[target]);
        items.push(...basis.items);gaps.push(...basis.gaps,...current.gaps);
        if(outlineSourcesChanged(basis.items,current.items))gaps.push(`单元 ${target.unitId} 的约定大纲已变化，请同步并明确修订委托后重新核对覆盖`);
      }
      checks.outlineRequirements=items;checks.outlineGaps=[...new Set(gaps)];
    }
    return {reviewScopeId:link.goalId,workspaceId:auth.workspaceId,authorizationRef:auth.id,contract:checks,...(contract.stopAfter&&contract.stopAfter!=='BODY'?{stage:contract.stopAfter,stageScope:contract.scope}:{})};
  };
  const application=(run:AgentRun,ref:ResourceRef)=>{
    const current=authority(run,'CONSUME'),result=drafts.readApplication(ref,run.ownerId,'VIEW'),link=goals.readRunLink(result.runId);
    if(result.workspaceId!==current.workspaceId||link?.goalId!==current.reviewScopeId)deny('返修采用不属于本次委托');
    return result;
  };
  return {
    forRun:authority,
    withRunAuthorization:(run,phase,read)=>authorizations.withRunAuthorization(run,phase,read),
    repairApplication:application,
    reserveRepair:(token,operationId)=>goals.reserveRepair(token,operationId),
    completionState:(run,review)=>{
      const current=authority(run,'CONSUME');
      const unresolvedUnknown=Boolean(store.db.prepare("SELECT 1 FROM agent_invocations i JOIN agent_run_links l ON l.run_id=i.run_id WHERE l.goal_id=? AND i.status IN ('SENT','UNKNOWN') LIMIT 1").get(current.reviewScopeId));
      let outOfScopeWrites=false;
      // Rebuild each authorization's ledger in commit order: the final ledger
      // must not retroactively legitimize an earlier unauthorized effect.
      const ledgers=new Map<string,ScriptDraftCreationLedger>();
      const rows=store.db.prepare("SELECT s.id,s.run_id,s.prepared_json,s.observation_json,a.candidate_id,a.workspace_revision FROM agent_steps s JOIN agent_run_links l ON l.run_id=s.run_id LEFT JOIN script_draft_applications a ON a.step_id=s.id WHERE l.goal_id=? AND s.status='COMMITTED' ORDER BY a.workspace_revision,s.rowid").all(current.reviewScopeId) as any[];
      for(const row of rows){
        const prepared=JSON.parse(row.prepared_json);
        if(prepared.request.capabilityId!=='script.apply_patch')continue;
        try{
          if(!row.candidate_id||!row.observation_json)deny('正文写入没有采用台账');
          const candidate=drafts.readCandidate(run.ownerId,row.candidate_id,'VIEW');
          if(candidate.workspaceId!==review.workspaceId||!candidate.candidate)deny('正文写入属于其他工作稿');
          const document=workspaces.version(review.workspaceId,run.ownerId,row.workspace_revision);
          const verified=drafts.readApplication(workspaceRef({id:review.workspaceId,revision:row.workspace_revision,document}),run.ownerId,'VIEW');
          if(verified.stepId!==row.id||verified.runId!==row.run_id)deny('正文写入回执身份改变');
          const auth=authorizations.read(verified.authorizationRef,run.ownerId),scope=auth.scope as ScriptDraftScope;
          const origin=workspaces.version(review.workspaceId,run.ownerId,scope.originRevision),before=workspaces.version(review.workspaceId,run.ownerId,verified.beforeRevision);
          const ledger=ledgers.get(auth.id)??emptyScriptDraftCreationLedger(),request=candidate.request;
          assertAgentDraftScope(before,candidate.candidate.patch,scope,request.operation,{...request,origin,ledger});
          ledgers.set(auth.id,drafts.applicationLedger(before,document,candidate,ledger));
        }catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;outOfScopeWrites=true;break;}
      }
      try{
        const auth=authorizations.forRun(run,'CONSUME');
        const ledgerRow=store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?').get(current.reviewScopeId,goals.readRunLink(run.id)?.goalRevision) as {data_json:string}|undefined;
        assertStructureScopesCurrent(workspaces.read(current.workspaceId,run.ownerId).document,auth.scope as ScriptDraftScope,ledgerRow?JSON.parse(ledgerRow.data_json):ledgers.get(auth.id)??emptyScriptDraftCreationLedger());
      }catch{outOfScopeWrites=true;}
      return {unresolvedUnknown,outOfScopeWrites};
    },
  };
}
