import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from 'js-sha256';
import { hashValue } from '../packages/agent-core/src/identity';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { collectOutlineRequirements, outlineSourcesChanged, type OutlineCoverageEntry } from '../packages/script/src/goalCoverage';
import { assessGoalCandidate, createCheckPlan, createGoalBodyManifest, validateCheckReceipt, type CheckReceipt, type GoalCheckContract } from '../packages/script/src/goalChecks';
import { stageDelivery } from '../packages/script/src/agentStages';
import { emptyScriptDraftCreationLedger, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { freezeStructureScope, insertScenesInStructure } from '../packages/script/src/structure';

function fixture(withEnding=true){
  const project=createScriptProject('机械大纲覆盖',{organization:'standalone',continuity:'serialized',workType:'电影',genres:[],language:'zh-CN',plannedUnits:1,targetDurationMs:60000,toleranceMs:0,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'});
  project.revision=1;project.brief.outline='甲发现钥匙。\n甲归还钥匙后独自离开。';const unit=project.units[0];
  unit.scenes=[{...newScene('发现'),id:'scene_open',purpose:'甲发现钥匙',location:'房间',blocks:[{id:'block_open',type:'action',text:'甲拉开抽屉，看见钥匙。'}]},
    ...(withEnding?[{...newScene('结局'),id:'scene_end',purpose:'甲归还钥匙后离开',location:'门口',blocks:[{id:'block_end',type:'action' as const,text:'甲把钥匙放回门内，独自走远。'}]}]:[])];
  const storyCoverage={originRevision:1,targets:[{unitId:unit.id}]},requirements=collectOutlineRequirements(project,storyCoverage.targets);
  const contract:GoalCheckContract={revision:1,targetUnitIds:[unit.id],localChecks:[{id:'local',dependency:'EXACT_BLOCKS'}],globalChecks:[{id:'story_coverage',dependency:'WHOLE_MANUSCRIPT'}],maxRawChars:1000,maxIndexEntries:10,maxRepairRounds:1,storyCoverage,outlineRequirements:requirements.items,outlineGaps:requirements.gaps};
  unit.scenes.forEach((scene,index)=>scene.outlineRequirementIds=[requirements.items[index].id]);
  return {project,contract};
}
function reviewed(h:ReturnType<typeof fixture>){
  const manifest=createGoalBodyManifest(h.project,h.contract.targetUnitIds),plan=createCheckPlan(manifest,h.contract),receipts:CheckReceipt[]=[];
  const rawByTask=new Map<string,ReturnType<typeof createCheckPlan>['tasks'][number]['requiredRaw']>();
  for(const task of plan.tasks){
    const linked=task.requiredEvidenceTaskIds.map(id=>receipts.find(receipt=>receipt.taskId===id)!);
    const raw=[...task.requiredRaw,...task.requiredEvidenceTaskIds.flatMap(id=>rawByTask.get(id)??[])];rawByTask.set(task.id,raw);
    const entries:OutlineCoverageEntry[]|undefined=task.requiredOutline?.map((requirement,index)=>{
      const scene=h.project.units[0].scenes[index],block=scene?.blocks[0],read=block&&raw.some(span=>span.blockId===block.id&&span.start===0&&span.end===block.text.length);
      return {requirementId:requirement.id,status:!scene?'UNEXPANDED':read?'DRAFT_READY':'PLANNED',reason:!scene?'缺少结局分场':read?'原文已实现本项事件':'仅有规划或本批未读原文',evidence:read?[{sceneId:scene.id,blockId:block.id,start:0,end:block.text.length}]:[]};
    });
    const receipt:CheckReceipt={id:`receipt_${task.id}`,taskId:task.id,taskFingerprint:task.fingerprint,manifestHash:manifest.hash,status:'SUCCEEDED',schemaValidated:true,findings:[],summary:'机械核对，不代表创作质量验收',
      input:{source:'FROZEN_SENT_REQUEST',contextRef:{id:`context_${task.id}`,digest:'mechanical_digest'},invocationId:`invocation_${task.id}`,inputHash:'mechanical_input',raw:structuredClone(task.requiredRaw),index:structuredClone(task.requiredIndex),omittedRaw:[],omittedIndex:[],
        evidence:linked.map(source=>({taskId:source.taskId,receiptId:source.id,receiptDigest:sha256(JSON.stringify(source)),summary:source.summary,findings:source.findings,...(source.outlineCoverage?{outlineCoverage:source.outlineCoverage}:{})})),...(task.requiredOutline?{outline:structuredClone(task.requiredOutline)}:{})},...(entries?{outlineCoverage:entries}:{})};
    receipts.push(receipt);
  }
  const artifact={kind:'complete_candidate' as const,projectId:h.project.id,revision:h.project.revision,manifestHash:manifest.hash,unitIds:h.contract.targetUnitIds};
  const input={project:h.project,contract:h.contract,manifest,plan,receipts,artifact,findings:[],repairRoundsUsed:0,unresolvedUnknown:false,outOfScopeWrites:false};
  const root=plan.tasks.find(task=>task.checkId==='story_coverage'&&task.phase==='SYNTHESIS'&&!plan.tasks.some(other=>other.requiredEvidenceTaskIds.includes(task.id)))!;
  return {...input,root,final:receipts.find(receipt=>receipt.taskId===root.id)!};
}

test('an outline ending remains a gap even when every existing scene has body and all read tasks succeeded',()=>{
  const h=reviewed(fixture(false));assert.ok(h.receipts.every(receipt=>validateCheckReceipt(h.manifest,h.plan,receipt,h.receipts).valid));
  const result=assessGoalCandidate(h);assert.equal(result.coverage.localComplete,true);assert.equal(result.coverage.globalComplete,true);assert.equal(result.complete,false);
  assert.equal(result.storyProgress?.[1].status,'UNEXPANDED');assert.match(result.gaps.join(' '),/尚未成稿/);
});

test('invented, omitted, note-only and out-of-read-range outline evidence cannot prove completion',()=>{
  const h=reviewed(fixture());assert.equal(assessGoalCandidate(h).complete,true);
  for(const edit of [(receipt:CheckReceipt)=>{receipt.outlineCoverage![1].evidence[0].blockId='invented';},(receipt:CheckReceipt)=>{receipt.outlineCoverage!.pop();},(receipt:CheckReceipt)=>{receipt.outlineCoverage![1].evidence[0].end=9999;}]){
    const forged=structuredClone(h.final);edit(forged);const receipts=h.receipts.map(receipt=>receipt.id===forged.id?forged:receipt);
    assert.equal(validateCheckReceipt(h.manifest,h.plan,forged,receipts).valid,false);assert.equal(assessGoalCandidate({...h,receipts}).complete,false);
  }
  const note=fixture();note.project.units[0].scenes[1].blocks[0].type='note';const checked=reviewed(note);assert.equal(assessGoalCandidate(checked).complete,false);
});

test('partial generation, UNKNOWN model state, missing synthesis and changed sources all block completion',()=>{
  const partial=fixture();partial.project.units[0].scenes[1].generation={status:'partial',checkpointId:'partial_checkpoint',appliedSteps:[]};
  const p=assessGoalCandidate(reviewed(partial));assert.equal(p.complete,false);assert.match(p.gaps.join(' '),/正文未完/);
  const h=reviewed(fixture());assert.equal(assessGoalCandidate({...h,unresolvedUnknown:true}).complete,false);
  assert.equal(assessGoalCandidate({...h,receipts:h.receipts.filter(receipt=>receipt.id!==h.final.id)}).complete,false);
  const changed=structuredClone(h.project);changed.brief.outline+='\n乙拿走抽屉。';changed.revision++;
  const current=collectOutlineRequirements(changed,h.contract.storyCoverage!.targets);assert.equal(outlineSourcesChanged(h.contract.outlineRequirements!,current.items),true);
  assert.equal(assessGoalCandidate({...h,project:changed}).complete,false);
  const fresh=reviewed({project:changed,contract:{...h.contract,outlineGaps:['约定大纲已变化，请确认新范围']}});assert.equal(assessGoalCandidate(fresh).complete,false);
  const staleContract=reviewed({project:changed,contract:h.contract});assert.equal(assessGoalCandidate(staleContract).complete,false,'fresh body checks cannot reauthorize a changed outline source');
});

test('valid complete raw evidence plus a final synthesis yields a complete candidate with item-level progress',()=>{
  const h=reviewed(fixture()),result=assessGoalCandidate(h);assert.equal(result.complete,true);assert.equal(result.resultType,'complete_candidate');
  assert.deepEqual(result.storyProgress?.map(item=>item.status),['DRAFT_READY','DRAFT_READY']);assert.ok(result.storyProgress?.every(item=>item.evidence.length));
  const index=h.receipts.find(receipt=>h.plan.tasks.find(task=>task.id===receipt.taskId)?.phase==='INDEX')!;assert.ok(index.outlineCoverage?.every(item=>item.status==='PLANNED'));
});

test('SCENES requires every frozen outline range mapped, not merely nonempty existing scene cards',()=>{
  const h=fixture(false),unit=h.project.units[0],scope:ScriptDraftScope={workspaceId:'stage',documentId:h.project.id,originRevision:1,originContentHash:hashValue(h.project),operations:['plan_scenes'],units:[{unitId:unit.id,allowAllScenes:true,allowSummary:false,maxNewScenes:10,scenes:[]}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
  const partial=stageDelivery(h.project,scope,'SCENES',{contract:h.contract});assert.equal(partial.ready,false);assert.match(partial.gaps.join(' '),/尚未映射/);
  const complete=fixture();const all=structuredClone(scope);all.documentId=complete.project.id;all.units[0].unitId=complete.project.units[0].id;
  assert.equal(stageDelivery(complete.project,all,'SCENES',{contract:complete.contract}).ready,true);
  assert.equal(stageDelivery(complete.project,all,'SCENES',{contract:{...complete.contract,outlineGaps:['大纲源变化']}}).ready,false);
});

test('SCENES includes a legal new node member from the ledger and excludes a neighboring node',()=>{
  const h=fixture(),p=h.project,u=p.units[0];u.structureNodes=[{id:'selected',title:'开场',purpose:'发现钥匙'},{id:'neighbor',title:'结局',purpose:'归还钥匙'}];u.scenes[0].structureNodeId='selected';u.scenes[1].structureNodeId='neighbor';
  const frozen=freezeStructureScope(p,u.id,'selected',{allowCreate:true}),scope:ScriptDraftScope={workspaceId:'node_stage',documentId:p.id,originRevision:1,originContentHash:hashValue(p),operations:['plan_scenes'],units:[{unitId:u.id,allowAllScenes:false,allowSummary:false,maxNewScenes:2,scenes:[],nodeScopes:[frozen]}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
  const added={...newScene('检查抽屉'),id:'scene_added',purpose:'检查抽屉',location:'房间'},next=insertScenesInStructure(p,u.id,[added],{nodeId:'selected'}),ledger=emptyScriptDraftCreationLedger();ledger.scenes.push({unitId:u.id,sceneId:added.id});
  const requirement=collectOutlineRequirements(p,[{unitId:u.id,nodeIds:['selected']}]),contract={...h.contract,storyCoverage:{originRevision:1,targets:[{unitId:u.id,nodeIds:['selected']}]},outlineRequirements:requirement.items,outlineGaps:[]};
  const good=stageDelivery(next,scope,'SCENES',{ledger,contract});assert.equal(good.ready,true);assert.deepEqual((good.content as any)[0].map((scene:any)=>scene.id),['scene_open','scene_added']);
  assert.equal(stageDelivery(next,scope,'SCENES',{contract}).ready,false,'incoming scenes need a trusted creation ledger');
});
