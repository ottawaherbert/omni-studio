import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {createScriptProject, newUnit} from '../packages/script/src/project';
import {anchorFor, outlineGuideId} from '../packages/script/src/outlineGuides';
import {analysisEvidence, type StructureAnalysis} from '../packages/script/src/structureAnalysis';
import {assertAgentDraftScope, emptyScriptDraftCreationLedger, type ScriptDraftScope} from '../packages/script/src/agentScope';
import {applyWorkspacePatch, createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {buildOutlineDevelopment} from '../packages/script/src/outlineDevelopment';

const route={channel:'external' as const,routeRef:'MECHANICAL_PROTOCOL_ONLY'};
const resolvers={resolveMethods:async()=>[],resolveExecution:()=>route};
const seasonId='season_current';
function fixture(t:TestContext){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},'explicit-season',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','explicit-season');
  const project=createScriptProject('明确季大纲机械样本',createScriptCreationProfile('anthology',5,5));
  project.seasons=[{id:seasonId,title:'当前季',arc:'SEASON_CURRENT_ARC'},{id:'season_other',title:'另一季',arc:'OTHER_SEASON_ARC_FORBIDDEN'}];
  const unit=project.units[0];unit.scopeId='story_current';unit.seasonId=seasonId;
  unit.summary='CURRENT_UNIT_PLAN';unit.scenes[0].blocks[0].text='CURRENT_UNIT_BODY';
  const other=newUnit('同季独立故事',300000,'story_other');other.seasonId=seasonId;
  other.summary='OTHER_STORY_PLAN_FORBIDDEN';other.scenes[0].blocks[0].text='OTHER_STORY_BODY_FORBIDDEN';
  const later=newUnit('另一季故事',300000,'story_later');later.seasonId='season_other';
  later.summary='LATER_STORY_PLAN_FORBIDDEN';later.scenes[0].blocks[0].text='LATER_STORY_BODY_FORBIDDEN';
  const previous=newUnit('当前故事前篇',300000,unit.scopeId);previous.seasonId=seasonId;
  previous.summary='PREVIOUS_CURRENT_STORY_PLAN';previous.scenes[0].blocks[0].text='PREVIOUS_SAME_STORY_BODY';
  const legacySeasonUnit=newUnit('季内旧scope故事',300000,seasonId);legacySeasonUnit.seasonId=seasonId;
  legacySeasonUnit.summary='LEGACY_SEASON_MEMBER_PLAN_FORBIDDEN';legacySeasonUnit.scenes[0].blocks[0].text='LEGACY_SEASON_MEMBER_BODY_FORBIDDEN';
  project.characters.push({id:'legacy_private_character',scopeId:legacySeasonUnit.id,name:'LEGACY_MEMBER_CHARACTER_FORBIDDEN',desire:'',need:'',voice:'',arc:'',contradiction:''});
  project.facts.push({id:'legacy_private_fact',scopeId:legacySeasonUnit.id,text:'LEGACY_MEMBER_FACT_FORBIDDEN',status:'draft'});
  project.units=[previous,unit,other,later,legacySeasonUnit];
  project.storyOutlines=[{scopeId:unit.scopeId,outline:'CURRENT_STORY_OUTLINE'},{scopeId:other.scopeId,outline:'OTHER_STORY_OUTLINE_FORBIDDEN'}];
  project.brief.outline='MIXED_PROJECT_OUTLINE_FORBIDDEN';
  const owner={kind:'season' as const,id:seasonId};
  project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{
    id:'beat_other_member',title:'季规划中的转折',change:'SEASON_BEAT_CHANGE',
    anchors:[anchorFor(project.seasons[0].arc,0,project.seasons[0].arc.length)],
    unitIds:[other.id],sceneRefs:[{unitId:other.id,sceneId:other.scenes[0].id}],
  }]}];
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:project}});
  return {db,host,thread,project,unit,other,later,workspace};
}
function accept(h:ReturnType<typeof fixture>,selected:Record<string,unknown>,text='整理明确选中的季大纲及关键节拍，保留已有正文。'){
  const selection={workspaceId:h.workspace.id,expectedRevision:h.workspace.revision,unitId:h.unit.id,...selected};
  const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.thread.id,requestId:'season-chat',expectedVersion:1,
    requestEnvelope:{text,selection},payload:{text,methods:[],template:'{{taskContract}}\n{{conversation}}',...route,selection},
    text,methods:[],route,selection});
  const runId=accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId;
  return {accepted,runId,input:h.host.store.readRun(runId).input as any};
}
async function freeze(h:ReturnType<typeof fixture>,runId:string){
  await h.host.worker.runOnce(runId);await h.host.childWorker.runOnce(runId);
  const frozen=h.host.journal.listExternal(runId,'author').at(-1);
  assert.ok(frozen,JSON.stringify(h.host.store.readRun(runId)));
  return frozen;
}
const proposal=(h:ReturnType<typeof fixture>)=>({summary:'机械季大纲候选',content:'SEASON_REVISED_ARC',nodes:null,beats:[
  {id:'beat_other_member',localKey:'existing',title:'季转折',change:'SEASON_BEAT_REVISED',quotes:['SEASON_REVISED_ARC'],unitIds:[h.other.id]},
  {id:null,localKey:'current',title:'本集展开',change:'CURRENT_UNIT_BEAT',quotes:['SEASON_REVISED_ARC'],unitIds:[h.unit.id]},
]});

for(const withScopeId of [false,true])test(`explicit season ${withScopeId?'with matching scopeId':'alone'} freezes one owner and adopts only its arc and permitted beats`,async t=>{
  const h=fixture(t),chat=accept(h,{seasonId,...(withScopeId?{scopeId:seasonId}:{}),outlineStructure:true,outlineSceneOrder:true});
  assert.deepEqual(chat.input.dispatchOptions.map((choice:any)=>choice.operation),['outline_development','season_outline']);
  assert.deepEqual(chat.input.dispatchGoals,[]);
  const scope=h.host.authorizations.read(chat.input.authorizationRef,'author').scope as ScriptDraftScope;
  assert.deepEqual(scope.units,[{unitId:h.unit.id,allowSummary:false,allowAllScenes:false,maxNewScenes:0,scenes:[],nodeScopes:[]}]);
  assert.deepEqual(scope.sharedFields,[]);assert.deepEqual(scope.characterScopeIds,[]);assert.deepEqual(scope.factScopeIds,[]);
  assert.deepEqual(scope.storyOutlineScopeIds,[]);assert.deepEqual(scope.seasonOutlineIds,[seasonId]);
  const grant=scope.outlineGrants![0];assert.deepEqual(grant.owner,{kind:'season',id:seasonId});
  assert.equal(grant.allowStructure,false);assert.equal(grant.allowSceneOrder,false);
  const decision=await freeze(h,chat.runId);
  assert.match(decision.request.prompt,/SEASON_CURRENT_ARC/);assert.doesNotMatch(decision.request.prompt,/FORBIDDEN|CURRENT_UNIT_BODY|PREVIOUS_SAME_STORY_BODY/);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify({kind:'CALL',operation:'outline_development',entityId:null,analysis:null,question:'',options:[]}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  const child=await freeze(h,chat.runId);assert.notEqual(child.id,decision.id);
  assert.match(child.request.prompt,/SEASON_CURRENT_ARC/);assert.doesNotMatch(child.request.prompt,/FORBIDDEN|CURRENT_UNIT_BODY|PREVIOUS_SAME_STORY_BODY/);
  assert.match(child.request.systemInstruction,/nodes 必须为 null/);
  const manifest=(child.request.inputManifest as any).scriptDraft;
  assert.equal(manifest.unitId,h.unit.id);assert.equal(manifest.seasonId,seasonId);
  h.host.journal.submitExternal(child.id,'author',child.inputHash,JSON.stringify(proposal(h)),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let tick=0;tick<8&&h.host.store.readRun(chat.runId).status!=='SUCCEEDED';tick++){
    await h.host.childWorker.runOnce(chat.runId);await h.host.worker.runOnce(chat.runId);
  }
  assert.equal(h.host.store.readRun(chat.runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(chat.runId)));
  const response=h.host.conversations.turn(h.thread.id,chat.accepted.turnId,'author').turn.response;
  const record=h.host.drafts.readCandidate('author',response.dispatch.candidateId);
  assert.equal(record.status,'VALID');assert.deepEqual(record.candidate!.delivery?.missing,[]);
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document,'candidate remains reviewable before adoption');
  const adopted=applyWorkspacePatch(h.workspace.document,record.candidate!.patch);
  assert.equal(adopted.seasons![0].arc,'SEASON_REVISED_ARC');
  assert.deepEqual(adopted.units,h.workspace.document.units);assert.deepEqual(adopted.storyOutlines,h.workspace.document.storyOutlines);
  assert.deepEqual(adopted.brief,h.workspace.document.brief);assert.deepEqual(adopted.seasons![1],h.workspace.document.seasons![1]);
  assert.deepEqual(adopted.outlineGuides![0].beats.find(beat=>beat.id==='beat_other_member')!.sceneRefs,h.project.outlineGuides![0].beats[0].sceneRefs);
  const version=h.host.conversations.read(h.thread.id,'author').version,current=h.host.workspaces.read(h.workspace.id,'author');
  const apply=await h.host.commands.submit('author',{kind:'APPLY',requestId:'adopt-season',threadId:h.thread.id,expectedConversationVersion:version,
    workspaceId:h.workspace.id,candidateId:record.id,expectedRevision:current.revision,writerEpoch:current.writerEpoch},resolvers);
  await h.host.worker.runOnce(apply.runId);
  assert.equal(h.host.store.readRun(apply.runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(apply.runId)));
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document.units,h.workspace.document.units);
  assert.equal(h.host.workspaces.read(h.workspace.id,'author').document.seasons![0].arc,'SEASON_REVISED_ARC');
});

test('ordinary unit selection does not infer a season owner or read another story',async t=>{
  const h=fixture(t),chat=accept(h,{}),frozen=await freeze(h,chat.runId);
  assert.ok(!chat.input.dispatchOptions.some((choice:any)=>choice.operation==='season_outline'));
  const scope=h.host.authorizations.read(chat.input.authorizationRef,'author').scope as ScriptDraftScope;
  assert.deepEqual(scope.outlineGrants![0].owner,{kind:'unit',id:h.unit.id});assert.deepEqual(scope.seasonOutlineIds,[]);
  assert.doesNotMatch(frozen.request.prompt,/SEASON_CURRENT_ARC|SEASON_BEAT_CHANGE|FORBIDDEN/);
  assert.match(frozen.request.prompt,/PREVIOUS_SAME_STORY_BODY/);
});

test('explicit text-only season command targets the selected arc without reading member story manuscripts',async t=>{
  const h=fixture(t),receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'explicit-season-text',threadId:h.thread.id,expectedConversationVersion:1,
    source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:h.workspace.revision},operation:'season_outline',
    instruction:'只修改明确选中的季大纲原文。',target:{unitId:h.unit.id,scopeId:seasonId,seasonId},methodIds:[]},resolvers);
  const frozen=await freeze(h,receipt.runId);
  assert.match(frozen.request.prompt,/SEASON_CURRENT_ARC/);assert.doesNotMatch(frozen.request.prompt,/FORBIDDEN|CURRENT_UNIT_BODY|PREVIOUS_SAME_STORY_BODY/);
  const scope=h.host.authorizations.read(receipt.authorizationRef,'author').scope as ScriptDraftScope;
  assert.deepEqual(scope.seasonOutlineIds,[seasonId]);assert.deepEqual(scope.units.map(unit=>unit.unitId),[h.unit.id]);
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({summary:'机械季原文',content:'SEASON_TEXT_ONLY_REVISION'}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let tick=0;tick<6&&h.host.store.readRun(receipt.runId).status!=='SUCCEEDED';tick++){
    await h.host.childWorker.runOnce(receipt.runId);await h.host.worker.runOnce(receipt.runId);
  }
  assert.equal(h.host.store.readRun(receipt.runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(receipt.runId)));
  const candidateId=(h.host.store.readRun(receipt.runId).result as any).data.candidateId;
  const candidate=h.host.drafts.readCandidate('author',candidateId).candidate!,adopted=applyWorkspacePatch(h.workspace.document,candidate.patch);
  assert.equal(adopted.seasons![0].arc,'SEASON_TEXT_ONLY_REVISION');
  assert.deepEqual(adopted.units,h.workspace.document.units);assert.deepEqual(adopted.outlineGuides,h.workspace.document.outlineGuides);
});

test('season identity and membership must both match the selected unit',t=>{
  const h=fixture(t);
  assert.throws(()=>accept(h,{scopeId:seasonId}),/不属于当前故事/,'membership cannot turn a generic story scope into a season target');
  assert.throws(()=>accept(h,{seasonId:'season_other'}),/不属于当前故事/);
  assert.throws(()=>accept(h,{seasonId:'missing_season'}),/不属于当前故事/);
  assert.throws(()=>accept(h,{scopeId:'season_other',seasonId}),/归属不一致/);
  assert.throws(()=>accept(h,{seasonId,sceneId:h.unit.scenes[0].id}),/季大纲目标/);
  assert.throws(()=>analysisEvidence(h.project,{unitId:h.unit.id,seasonId:'season_other'}),/超出当前故事/);
});

test('proposal preflight cannot change the season identity in a frozen outline grant',async t=>{
  const h=fixture(t),chat=accept(h,{seasonId,draftOperation:'outline_development'});
  const claim=h.host.store.claim('season-preflight',30000,chat.runId)!;assert.ok(claim);
  h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>{
    const request={operation:'outline_development' as const,unitId:h.unit.id,seasonId};
    assert.doesNotThrow(()=>h.host.drafts.assertProposalTarget(claim.run,request));
    for(const changed of [{...request,seasonId:'season_other'},{...request,seasonId:undefined},{...request,scopeId:'story_other'}])
      assert.throws(()=>h.host.drafts.assertProposalTarget(claim.run,changed),/冻结归属/);
  });
  await assert.rejects(()=>h.host.commands.submit('author',{kind:'PROPOSE',requestId:'ambiguous-season',threadId:h.thread.id,expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,
    source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:h.workspace.revision},operation:'outline_development',
    instruction:'明确季大纲',target:{unitId:h.unit.id,scopeId:'story_other',seasonId},methodIds:[]},resolvers),/归属不一致/);
});

test('a frozen unit-outline owner cannot acquire a season identity in proposal preflight',t=>{
  const h=fixture(t),chat=accept(h,{draftOperation:'outline_development'});
  const claim=h.host.store.claim('unit-preflight',30000,chat.runId)!;assert.ok(claim);
  h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>{
    assert.throws(()=>h.host.drafts.assertProposalTarget(claim.run,{operation:'outline_development',unitId:h.unit.id,seasonId}),/冻结归属/);
  });
});

test('a text-only season grant must retain its authorized current-unit anchor',t=>{
  const h=fixture(t),chat=accept(h,{seasonId}),claim=h.host.store.claim('season-text-preflight',30000,chat.runId)!;
  assert.ok(claim);
  h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>{
    const request={operation:'season_outline' as const,unitId:h.unit.id,seasonId};
    assert.doesNotThrow(()=>h.host.drafts.assertProposalTarget(claim.run,request));
    for(const changed of [{...request,unitId:undefined},{...request,unitId:h.other.id},{...request,scopeId:h.other.scopeId}])
      assert.throws(()=>h.host.drafts.assertProposalTarget(claim.run,changed),/未授权|不匹配/);
  });
});

test('explicit season analysis quotes only frozen evidence and retains its selected owner',async t=>{
  const h=fixture(t),chat=accept(h,{scopeId:seasonId,seasonId,analysis:true},'请分析明确选中的季大纲结构。'),frozen=await freeze(h,chat.runId);
  const source=(frozen.request.inputManifest as any).analysisSource;
  assert.doesNotMatch(frozen.request.prompt,/FORBIDDEN|CURRENT_UNIT_BODY|PREVIOUS_SAME_STORY_BODY/);
  const evidence=source.evidence.find((item:any)=>item.kind==='OUTLINE_SPAN');assert.ok(evidence);
  assert.deepEqual(evidence.owner,{kind:'season',id:seasonId});assert.equal(evidence.text,'SEASON_CURRENT_ARC');
  assert.ok(source.evidence.every((item:any)=>item.unitId===h.unit.id));
  assert.ok(source.evidence.every((item:any)=>['OUTLINE_SPAN','NODE_BEAT'].includes(item.kind)));
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({kind:'REPLY',operation:null,entityId:null,
    question:'季大纲意见',options:[],analysis:{summary:'机械季分析',target:{unitId:h.other.id,seasonId:'season_other'},
      findings:[{evidenceId:evidence.id,quote:evidence.text,issue:'转折需要解释',suggestion:'补充原因',severity:'ADVISORY'}]}}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  await h.host.worker.runOnce(chat.runId);
  assert.equal(h.host.store.readRun(chat.runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(chat.runId)));
  const analysis=h.host.conversations.turn(h.thread.id,chat.accepted.turnId,'author').turn.response.analysis as StructureAnalysis;
  assert.deepEqual(analysis.target,{unitId:h.unit.id,seasonId});assert.deepEqual(analysis.findings[0].evidence,evidence);
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
});

for(const operation of ['outline_goal','scene_body'])test(`a season selection cannot dispatch ${operation}`,async t=>{
  const h=fixture(t),chat=accept(h,{seasonId}),frozen=await freeze(h,chat.runId);
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({kind:'CALL',operation,entityId:null,analysis:null,question:'',options:[]}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  await h.host.worker.runOnce(chat.runId);
  assert.equal(h.host.store.readRun(chat.runId).status,'SUCCEEDED');
  const response=h.host.conversations.turn(h.thread.id,chat.accepted.turnId,'author').turn.response;
  assert.equal(response.dispatch.kind,'ASK');assert.equal(response.goal,undefined);assert.equal(response.dispatch.candidateId,undefined);
  assert.equal(h.host.journal.listExternal(chat.runId,'author').length,1);
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
});

test('a season grant cannot change other unit relationships, structures or bodies',t=>{
  const h=fixture(t),chat=accept(h,{seasonId,draftOperation:'outline_development'});
  const scope=h.host.authorizations.read(chat.input.authorizationRef,'author').scope as ScriptDraftScope,grant=scope.outlineGrants![0],result=proposal(h),base=h.workspace.document;
  const valid=buildOutlineDevelopment(base,grant,h.unit.id,'season_candidate',result);
  for(const changed of [
    {...result,nodes:[]},
    {...result,beats:[{...result.beats[0],unitIds:[]},result.beats[1]]},
    {...result,beats:[result.beats[1]]},
    {...result,beats:[result.beats[0],{...result.beats[1],unitIds:[h.other.id]}]},
  ])assert.throws(()=>buildOutlineDevelopment(base,grant,h.unit.id,'season_candidate',changed),/季大纲/);
  const request={candidateId:'season_candidate',operation:'outline_development' as const,unitId:h.unit.id,seasonId};
  for(const mutate of [
    (next:typeof valid)=>{next.units.find(unit=>unit.id===h.other.id)!.scenes[0].blocks[0].text='ILLICIT_BODY';},
    (next:typeof valid)=>{next.units.find(unit=>unit.id===h.other.id)!.structureNodes=[{id:'illicit_node',title:'越权目录'}];},
    (next:typeof valid)=>{next.outlineGuides![0].beats[0].sceneRefs=[];},
    (next:typeof valid)=>{next.outlineGuides![0].beats[0].unitIds=[];},
  ]){
    const forged=structuredClone(valid);mutate(forged);
    assert.throws(()=>assertAgentDraftScope(base,createWorkspacePatch(base,forged),scope,'outline_development',
      {origin:base,ledger:emptyScriptDraftCreationLedger(),...request}),/获准|场景关联|其他集/);
  }
});
