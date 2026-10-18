import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {anchorFor,anchorCurrent,freezeOutlineGrant,outlineGuideId} from '../packages/script/src/outlineGuides';
import {assertOutlineDevelopment,buildOutlineDevelopment} from '../packages/script/src/outlineDevelopment';
import {applyWorkspacePatch} from '../packages/script/src/workspacePatch';
import type {ScriptDraftScope} from '../packages/script/src/agentScope';
import type {ScriptProject} from '../packages/script/src/schema';

const route={channel:'external' as const,routeRef:'MECHANICAL_NO_EXTERNAL_MODEL'};
const resolvers={resolveMethods:async()=>[],resolveExecution:()=>route};
function fixture(t:TestContext,prepare?:(project:ScriptProject)=>void){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},'beat-command',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','beat-command');
  const project=createScriptProject('同原文节拍',createScriptCreationProfile('short-film',1,2));project.brief.outline='敲门以后，发现旧信。';
  const unit=project.units[0],owner={kind:'project' as const,id:project.id};unit.scenes[0].blocks[0].text='KEEP_BODY';unit.structureNodes=[{id:'node_keep',title:'原段',purpose:'原用途'}];
  project.storylines=[{id:'line_keep',scopeId:project.id,lane:'A',title:'追信',premise:'原前提',resolution:'原结局'}];
  project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[{unitId:unit.id,nodeId:'node_keep',anchor:anchorFor(project.brief.outline,0,project.brief.outline.length)}],beats:['beat_target','beat_other'].map((id,i)=>({id,title:i?'其他关键事件':'所选关键事件',change:'原变化',anchors:[anchorFor(project.brief.outline,0,project.brief.outline.length)],unitIds:[unit.id],sceneRefs:[{unitId:unit.id,sceneId:unit.scenes[0].id}],storylineIds:['line_keep']}))}];
  prepare?.(project);
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:project}});
  return {host,db,thread,project,unit,owner,workspace};
}
const result=(h:ReturnType<typeof fixture>)=>({summary:'只改所选事件',content:'敲门以后，发现新信。',nodes:null,beats:[{id:'beat_target',localKey:'target',title:'发现新信',change:'获得新线索',quotes:['敲门以后，发现新信。'],unitIds:[h.unit.id]}]});
async function freeze(h:ReturnType<typeof fixture>,runId:string){
  await h.host.worker.runOnce(runId);await h.host.childWorker.runOnce(runId);
  const frozen=h.host.journal.listExternal(runId,'author').at(-1);assert.ok(frozen,JSON.stringify(h.host.store.readRun(runId)));return frozen;
}
async function finish(h:ReturnType<typeof fixture>,runId:string,frozen:Awaited<ReturnType<typeof freeze>>){
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify(result(h)),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let i=0;i<8&&h.host.store.readRun(runId).status!=='SUCCEEDED';i++){await h.host.childWorker.runOnce(runId);await h.host.worker.runOnce(runId);}
  assert.equal(h.host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(runId)));
}
function compare(h:ReturnType<typeof fixture>,candidate:NonNullable<ReturnType<typeof h.host.drafts.readCandidate>['candidate']>){
  const adopted=applyWorkspacePatch(h.workspace.document,candidate.patch),guide=adopted.outlineGuides![0],original=h.workspace.document.outlineGuides![0];
  assert.equal(adopted.brief.outline,'敲门以后，发现新信。');assert.equal(guide.beats[0].id,'beat_target');assert.equal(guide.beats[0].title,'发现新信');
  assert.deepEqual(guide.beats[1],original.beats[1]);assert.equal(anchorCurrent(guide.beats[1].anchors[0],adopted.brief.outline),false);
  assert.deepEqual(guide.beats[0].sceneRefs,original.beats[0].sceneRefs);assert.deepEqual(guide.beats[0].storylineIds,['line_keep']);
  assert.deepEqual(adopted.units,h.workspace.document.units);assert.deepEqual(adopted.storylines,h.workspace.document.storylines);assert.deepEqual(guide.nodeLinks,original.nodeLinks);
  assert.deepEqual(candidate.delivery?.missing,[]);assert.equal(guide.development!.full,false);assert.equal(guide.development!.nodes,false);assert.deepEqual(guide.development!.beatIds,['beat_target']);return adopted;
}

test('direct author command freezes exact beat IDs; candidate and real APPLY preserve overlapping beat and explicit relations',async t=>{
  const h=fixture(t),receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'beat-direct',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'只改当前关键事件',target:{unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target'],outlineStructure:true,outlineSceneOrder:true},methodIds:[],...{executionChannel:'external'}},resolvers);
  const scope=h.host.authorizations.read(receipt.authorizationRef,'author').scope as ScriptDraftScope,grant=scope.outlineGrants![0];
  assert.deepEqual(grant.outlineBeatIds,['beat_target']);assert.equal(grant.allowStructure,false);assert.equal(grant.allowSceneOrder,false);assert.deepEqual(scope.units[0].scenes,[]);
  const frozen=await freeze(h,receipt.runId);assert.match(frozen.request.systemInstruction,/outlineBeatIds.*nodes 必须为 null/);await finish(h,receipt.runId,frozen);
  const candidateId=(h.host.store.readRun(receipt.runId).result as any).data.candidateId,record=h.host.drafts.readCandidate('author',candidateId);assert.equal(record.status,'VALID');const expected=compare(h,record.candidate!);
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
  const current=h.host.workspaces.read(h.workspace.id,'author');
  const apply=await h.host.commands.submit('author',{kind:'APPLY',requestId:'beat-apply',threadId:h.thread.id,expectedConversationVersion:1,workspaceId:h.workspace.id,candidateId,expectedRevision:current.revision,writerEpoch:current.writerEpoch},resolvers);await h.host.worker.runOnce(apply.runId);
  assert.equal(h.host.store.readRun(apply.runId).status,'SUCCEEDED');const actual=h.host.workspaces.read(h.workspace.id,'author').document;
  assert.deepEqual({...actual,revision:expected.revision,updatedAt:expected.updatedAt},expected);
});

test('CHAT selection freezes one outline operation with no delegation or scene/structure powers through CALL and candidate',async t=>{
  const h=fixture(t),text='只改这条关键事件',selection={workspaceId:h.workspace.id,expectedRevision:1,unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target'],outlineRange:{start:0,end:h.project.brief.outline.length,text:h.project.brief.outline}};
  const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.thread.id,requestId:'beat-chat',expectedVersion:1,requestEnvelope:{text,selection},payload:{text,methods:[],template:'{{taskContract}}\n{{conversation}}',...route,selection},text,methods:[],route,selection});
  const runId=accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId,input=h.host.store.readRun(runId).input as any;
  assert.deepEqual(input.dispatchOptions.map((entry:any)=>entry.operation),['outline_development']);assert.deepEqual(input.dispatchGoals,[]);assert.deepEqual(input.dispatchSelection.outlineBeatIds,['beat_target']);
  const scope=h.host.authorizations.read(input.authorizationRef,'author').scope as ScriptDraftScope;assert.deepEqual(scope.outlineGrants![0].outlineBeatIds,['beat_target']);assert.deepEqual(scope.units[0].scenes,[]);assert.equal(scope.units[0].allowStructure,undefined);
  const decision=await freeze(h,runId);assert.match(decision.request.prompt,/selectedOutlineBeatIds/);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify({kind:'CALL',operation:'outline_development',entityId:null,analysis:null,question:'',options:[]}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  const child=await freeze(h,runId);assert.notEqual(child.id,decision.id);assert.match(child.request.prompt,/"outlineBeatIds":\["beat_target"\]/);await finish(h,runId,child);
  const response=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response;compare(h,h.host.drafts.readCandidate('author',response.dispatch.candidateId).candidate!);
});

test('targeted grants reject missing/stale/duplicate IDs and any attempt to include other beat metadata, nodes or relationships',t=>{
  const h=fixture(t),grant=freezeOutlineGrant(h.project,h.owner,{outlineBeatIds:['beat_target']});
  for(const outlineBeatIds of [[],['missing'],['beat_target','beat_target']])assert.throws(()=>freezeOutlineGrant(h.project,h.owner,{outlineBeatIds}),/节拍/);
  const stale=structuredClone(h.project);stale.brief.outline+='改';assert.throws(()=>freezeOutlineGrant(stale,h.owner,{outlineBeatIds:['beat_target']}),/有效原文/);
  assert.throws(()=>freezeOutlineGrant(h.project,h.owner,{outlineBeatIds:['beat_target'],allowStructure:true}),/写权/);
  assert.throws(()=>buildOutlineDevelopment(h.project,grant,h.unit.id,'candidate',{...result(h),beats:[{...result(h).beats[0],id:'beat_other'}]}),/获准目标/);
  assert.throws(()=>buildOutlineDevelopment(h.project,grant,h.unit.id,'candidate',{...result(h),beats:[{...result(h).beats[0],id:null}]}),/获准目标/);
  assert.throws(()=>buildOutlineDevelopment(h.project,grant,h.unit.id,'candidate',{...result(h),nodes:[]}),/结构关联/);
  assert.throws(()=>buildOutlineDevelopment(h.project,grant,h.unit.id,'candidate',{...result(h),beats:[]}),/解除.*关联/);
  const valid=buildOutlineDevelopment(h.project,grant,h.unit.id,'candidate',result(h));
  for(const mutate of [(p:typeof valid)=>{p.outlineGuides![0].beats[1].title='夹带改名';},(p:typeof valid)=>{p.outlineGuides![0].beats[0].storylineIds=[];},(p:typeof valid)=>{p.outlineGuides![0].beats[0].sceneRefs=[];}]){const hostile=structuredClone(valid);mutate(hostile);assert.throws(()=>assertOutlineDevelopment(h.project,hostile,grant,h.unit.id),/未选中|关联写权/);}
});

test('a broad original candidate cannot replace a narrower explicit beat selection during repair',async t=>{
  const h=fixture(t),receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'broad-original',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'整理整篇大纲节拍',target:{unitId:h.unit.id,scopeId:h.project.id},methodIds:[],executionChannel:'external'},resolvers);
  const frozen=await freeze(h,receipt.runId),beats=h.project.outlineGuides![0].beats.map(beat=>({id:beat.id,localKey:beat.id,title:beat.title,change:beat.change,quotes:[h.project.brief.outline],unitIds:beat.unitIds}));
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({summary:'完整原候选',content:h.project.brief.outline,nodes:null,beats}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let i=0;i<6&&h.host.store.readRun(receipt.runId).status!=='SUCCEEDED';i++){await h.host.childWorker.runOnce(receipt.runId);await h.host.worker.runOnce(receipt.runId);}
  assert.equal(h.host.store.readRun(receipt.runId).status,'SUCCEEDED');
  const candidateId=(h.host.store.readRun(receipt.runId).result as any).data.candidateId;
  await assert.rejects(()=>h.host.commands.submit('author',{kind:'PROPOSE',requestId:'narrow-repair',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'只补当前节拍',target:{unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target'],repairCandidateId:candidateId},methodIds:[],executionChannel:'external'},resolvers),/不能扩大所选节拍目标/);
  await assert.rejects(()=>h.host.commands.submit('author',{kind:'PROPOSE',requestId:'wrong-operation',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'unit_outline',instruction:'改本集',target:{unitId:h.unit.id,outlineBeatIds:['beat_target']},methodIds:[],executionChannel:'external'},resolvers),/只接受大纲开发/);
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
});

test('repair preserves an explicit narrower original range, owner and node selection even when beat IDs match',async t=>{
  const h=fixture(t,p=>{p.outlineGuides![0].beats[0].anchors=[anchorFor(p.brief.outline,0,4)];});
  const receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'same-beat-wide',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'改当前节拍',target:{unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target']},methodIds:[],executionChannel:'external'},resolvers);
  const frozen=await freeze(h,receipt.runId),value={...result(h),content:h.project.brief.outline,beats:[{...result(h).beats[0],quotes:[h.project.brief.outline.slice(0,4)]}]};
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify(value),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let i=0;i<6&&h.host.store.readRun(receipt.runId).status!=='SUCCEEDED';i++){await h.host.childWorker.runOnce(receipt.runId);await h.host.worker.runOnce(receipt.runId);}
  assert.equal(h.host.store.readRun(receipt.runId).status,'SUCCEEDED');
  const candidateId=(h.host.store.readRun(receipt.runId).result as any).data.candidateId,record=h.host.drafts.readCandidate('author',candidateId);
  const base={kind:'PROPOSE',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'补齐当前目标',methodIds:[],executionChannel:'external'};
  await assert.rejects(()=>h.host.commands.submit('author',{...base,requestId:'same-beat-narrow',target:{unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target'],outlineRange:{start:0,end:4,text:h.project.brief.outline.slice(0,4)},repairCandidateId:candidateId}},resolvers),/不能扩大.*原文范围/);
  await assert.rejects(()=>h.host.commands.submit('author',{...base,requestId:'different-owner',target:{unitId:h.unit.id,repairCandidateId:candidateId}},resolvers),/大纲归属.*不同/);
  await assert.rejects(()=>h.host.commands.submit('author',{...base,requestId:'different-node',target:{unitId:h.unit.id,scopeId:h.project.id,nodeId:'node_keep',repairCandidateId:candidateId}},resolvers),/段落权限/);
  assert.deepEqual(h.host.drafts.readCandidate('author',candidateId),record,'rejected repair preserves the immutable original candidate');
  assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
  const compatible=await h.host.commands.submit('author',{...base,requestId:'same-compatible',target:{unitId:h.unit.id,scopeId:h.project.id,outlineBeatIds:['beat_target'],outlineRange:{start:0,end:h.project.brief.outline.length,text:h.project.brief.outline},repairCandidateId:candidateId}},resolvers);
  const compatibleScope=h.host.authorizations.read(compatible.authorizationRef,'author').scope as ScriptDraftScope;
  assert.deepEqual(compatibleScope.outlineGrants,(h.host.authorizations.read(receipt.authorizationRef,'author').scope as ScriptDraftScope).outlineGrants);
});

test('repair cannot restore old structural or scene-order powers after the author explicitly narrows them',async t=>{
  const h=fixture(t),receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'old-structural',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'整篇与结构',target:{unitId:h.unit.id,scopeId:h.project.id,outlineStructure:true,outlineSceneOrder:true},methodIds:[],executionChannel:'external'},resolvers);
  const frozen=await freeze(h,receipt.runId),beats=h.project.outlineGuides![0].beats.map(beat=>({id:beat.id,localKey:beat.id,title:beat.title,change:beat.change,quotes:[h.project.brief.outline],unitIds:beat.unitIds}));
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({summary:'保留原稿的待补候选',content:h.project.brief.outline,nodes:null,beats}),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let i=0;i<6&&h.host.store.readRun(receipt.runId).status!=='SUCCEEDED';i++){await h.host.childWorker.runOnce(receipt.runId);await h.host.worker.runOnce(receipt.runId);}
  assert.equal(h.host.store.readRun(receipt.runId).status,'SUCCEEDED');
  const candidateId=(h.host.store.readRun(receipt.runId).result as any).data.candidateId,record=h.host.drafts.readCandidate('author',candidateId);
  for(const [i,permission] of [{outlineStructure:false},{outlineStructure:true,outlineSceneOrder:false},{outlineRange:{start:0,end:h.project.brief.outline.length,text:h.project.brief.outline}}].entries()){
    await assert.rejects(()=>h.host.commands.submit('author',{kind:'PROPOSE',requestId:`narrow-power-${i}`,threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'outline_development',instruction:'补齐更窄许可',target:{unitId:h.unit.id,scopeId:h.project.id,repairCandidateId:candidateId,...permission},methodIds:[],executionChannel:'external'},resolvers),/结构或场序权限/);
  }
  assert.deepEqual(h.host.drafts.readCandidate('author',candidateId),record);assert.deepEqual(h.host.workspaces.read(h.workspace.id,'author').document,h.workspace.document);
});
