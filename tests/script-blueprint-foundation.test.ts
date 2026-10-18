import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blueprintContext, parseBlueprint, blueprintSchema } from '../packages/script/src/blueprint';
import { buildAgentDraft } from '../packages/script/src/agentDraft';
import { emptyScriptDraftCreationLedger, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';
import { hashValue } from '../packages/agent-core/src';
import { parseIdeationDraft } from '../packages/script/src/ideation';
import { resolveAssistantUnit } from '../apps/web/src/features/script/scriptAssistantShortcuts';

const provenance={channel:'provider' as const,producer:'MECHANICAL_BLUEPRINT_FIXTURE_NO_EXTERNAL_MODEL'};
const resolvers={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical'})};
function document(){
  const p=createScriptProject('蓝图链路机械验收',createScriptCreationProfile('anthology',2,5));
  p.brief={concept:'CONCEPT_SENTINEL',theme:'THEME_SENTINEL',audienceExperience:'TONE_SENTINEL',constraints:'LIMIT_SENTINEL',outline:'MIXED_OUTLINE_NOT_LOCAL_SENTINEL'};
  p.storyOutlines=[{scopeId:p.units[0].scopeId,outline:'LOCAL_OUTLINE_SENTINEL'}];
  p.characters=[{id:'char_current',scopeId:p.units[0].scopeId,name:'角色甲',bio:'BIO_SENTINEL',desire:'DESIRE_SENTINEL',need:'',contradiction:'CONTRADICTION_SENTINEL',arc:'ARC_SENTINEL',voice:'VOICE_SENTINEL'}];
  p.facts=[{id:'fact_current',text:'RULE_SENTINEL',scopeId:p.units[0].scopeId,status:'approved'},
    {id:'fact_pending',text:'PENDING_SENTINEL',scopeId:p.id,status:'draft'}];
  const other=newUnit('独立故事乙',300000,'other_story');p.units.push(other);
  p.characters.push({...p.characters[0],id:'char_other',scopeId:other.scopeId,name:'OTHER_CHARACTER_SENTINEL'});
  p.facts.push({id:'fact_other',scopeId:other.scopeId,text:'OTHER_FACT_SENTINEL',status:'approved'});
  return p;
}
function fixture(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},'blueprint-foundation',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','blueprint-test');
  const doc=document(),w=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:doc}});
  const send=async(operation:string,entityId?:string,selectedEntity?:{kind:'character'|'fact';id:string},unitId=doc.units[0].id)=>{
    const selection={workspaceId:w.id,expectedRevision:w.revision,unitId,...(selectedEntity?{entity:selectedEntity}:{})};
    const accepted=host.commands.acceptChatTurn({ownerId:'author',threadId:thread.id,requestId:'chat',expectedVersion:1,
      requestEnvelope:{text:'机械协议：修改当前资料',selection},payload:{text:'机械协议：修改当前资料',methods:[],template:'{{taskContract}}\n{{conversation}}',channel:'external',routeRef:'mechanical',selection},
      text:'机械协议：修改当前资料',methods:[],route:{channel:'external',routeRef:'mechanical'},selection});
    const runId=accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId;
    await host.worker.runOnce(runId);const first=host.journal.listExternal(runId,'author')[0];assert.ok(first);
    host.journal.submitExternal(first.id,'author',first.inputHash,JSON.stringify({kind:'CALL',operation,entityId:entityId??null,question:'',options:[]}),{name:'mechanical-dispatch'});
    await host.worker.runOnce(runId);await host.childWorker.runOnce(runId);
    const child=host.journal.listExternal(runId,'author').find(item=>item.id!==first.id);
    return {runId,first,child,accepted};
  };
  return {db,host,thread,doc,w,send};
}

test('chat and downstream outline read the same current blueprint, status and scoped characters without a Skill',async t=>{
  const h=fixture(t),result=await h.send('unit_outline');assert.ok(result.child);
  for(const request of [result.first.request,result.child.request]){
    for(const marker of ['CONCEPT_SENTINEL','THEME_SENTINEL','TONE_SENTINEL','LIMIT_SENTINEL','LOCAL_OUTLINE_SENTINEL','BIO_SENTINEL','DESIRE_SENTINEL','CONTRADICTION_SENTINEL','ARC_SENTINEL','VOICE_SENTINEL','RULE_SENTINEL','PENDING_SENTINEL'])assert.ok(request.prompt.includes(marker),marker);
    assert.match(request.prompt,/"status":"approved"/);assert.match(request.prompt,/"status":"draft"/);
    assert.doesNotMatch(request.prompt,/OTHER_CHARACTER_SENTINEL|OTHER_FACT_SENTINEL|MIXED_OUTLINE_NOT_LOCAL_SENTINEL/);
  }
});

for(const [operation,entityId,changes] of [
  ['update_character','char_current',[{field:'bio',value:'新的身份与处境'},{field:'voice',value:'说话简短直接'}]],
  ['update_fact','fact_current',[{field:'text',value:'修改后的规则，保留已确认状态'}]],
  ['update_fact','fact_pending',[{field:'status',value:'approved'}]],
  ['audienceExperience',undefined,null],['constraints',undefined,null],
] as const)test(`${operation} routes, applies and adopts only the requested fields`,async t=>{
  const h=fixture(t),result=await h.send(operation,entityId);assert.ok(result.child);
  const output={summary:'机械定向修改',...(changes?{changes}:{content:'新创作要求'})};
  h.host.journal.submitExternal(result.child.id,'author',result.child.inputHash,JSON.stringify(output),{name:'mechanical-candidate'});
  await h.host.childWorker.runOnce(result.runId);await h.host.worker.runOnce(result.runId);
  const row=h.db.prepare('SELECT data_json FROM script_draft_candidates WHERE run_id=?').get(result.runId) as any;
  assert.ok(row);const candidate=JSON.parse(row.data_json);assert.equal(candidate.status,'VALID',candidate.error);
  const before=h.host.workspaces.read(h.w.id,'author');
  assert.deepEqual(before.document,h.w.document,'candidate must not silently change the document');
  const applied=await h.host.commands.submit('author',{kind:'APPLY',requestId:'apply',threadId:h.thread.id,
    expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,workspaceId:h.w.id,candidateId:candidate.id,
    expectedRevision:before.revision,writerEpoch:before.writerEpoch},resolvers);
  await h.host.worker.runOnce(applied.runId);
  const after=h.host.workspaces.read(h.w.id,'author');assert.equal(after.revision,before.revision+1);
  assert.equal(after.document.characters.length,before.document.characters.length);assert.equal(after.document.facts.length,before.document.facts.length);
  assert.deepEqual(after.document.units,before.document.units);
  assert.deepEqual(after.document.characters[1],before.document.characters[1]);
  const modified=createWorkspacePatch(before.document,after.document).operations;
  assert.deepEqual(modified.map(change=>change.field).sort(),changes?changes.map(change=>change.field).sort():[operation]);
  const proposal=h.host.workspaces.prepareAdoption({workspaceId:after.id,ownerId:'author',workspaceRevision:after.revision,expectedAuthorRevision:0});
  h.host.workspaces.adopt({workspaceId:after.id,ownerId:'author',requestId:'adopt',proposalId:proposal.id,digest:proposal.digest});
  const saved=h.host.scripts.getProject(after.documentId)!;assert.ok(saved);
  assert.deepEqual(saved.brief,after.document.brief);assert.deepEqual(saved.characters,after.document.characters);assert.deepEqual(saved.facts,after.document.facts);
});

test('a field shortcut cannot be redirected to another existing entity by a model response',async t=>{
  const h=fixture(t),result=await h.send('update_fact','fact_pending',{kind:'fact',id:'fact_current'});
  assert.equal(result.child,undefined);
  const response=h.host.conversations.turn(h.thread.id,result.accepted.turnId,'author').turn.response!;
  assert.match(response.text,/超出当前选定范围/);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_candidates').get() as any).n,0);
});

for(const kind of ['character','fact'] as const)test(`blueprint ${kind} shortcut resolves another story's unit without mixing its context`,async t=>{
  const h=fixture(t),entity={kind,id:kind==='character'?'char_other':'fact_other'};
  const unit=resolveAssistantUnit(h.doc,h.doc.units[0].id,entity);assert.equal(unit?.id,h.doc.units[1].id);
  const result=await h.send(kind==='character'?'update_character':'update_fact',entity.id,entity,unit!.id);assert.ok(result.child);
  for(const request of [result.first.request,result.child.request]){
    assert.match(request.prompt,/OTHER_CHARACTER_SENTINEL/);assert.match(request.prompt,/OTHER_FACT_SENTINEL/);
    assert.doesNotMatch(request.prompt,/RULE_SENTINEL|角色甲/);
  }
  const field=kind==='character'?'bio':'text',value='仅修改选中故事的资料';
  h.host.journal.submitExternal(result.child.id,'author',result.child.inputHash,JSON.stringify({summary:'机械跨集修改',changes:[{field,value}]}),{name:'mechanical-candidate'});
  await h.host.childWorker.runOnce(result.runId);await h.host.worker.runOnce(result.runId);
  const candidate=JSON.parse((h.db.prepare('SELECT data_json FROM script_draft_candidates WHERE run_id=?').get(result.runId) as any).data_json);
  assert.equal(candidate.status,'VALID',candidate.error);
  const before=h.host.workspaces.read(h.w.id,'author');
  const applied=await h.host.commands.submit('author',{kind:'APPLY',requestId:'apply-other',threadId:h.thread.id,
    expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,workspaceId:h.w.id,candidateId:candidate.id,
    expectedRevision:before.revision,writerEpoch:before.writerEpoch},resolvers);
  await h.host.worker.runOnce(applied.runId);
  const after=h.host.workspaces.read(h.w.id,'author');
  assert.deepEqual(after.document.characters[0],before.document.characters[0]);assert.deepEqual(after.document.facts[0],before.document.facts[0]);
  assert.deepEqual(after.document.units,before.document.units);
  const changes=createWorkspacePatch(before.document,after.document).operations;
  assert.equal(changes.length,1);assert.equal(changes[0].field,field);
  const target=kind==='character'?after.document.characters.find(item=>item.id===entity.id)?.bio:after.document.facts.find(item=>item.id===entity.id)?.text;
  assert.equal(target,value);
});

test('assistant shortcuts preserve the current shared scope and reject deleted or unassigned entities',()=>{
  const p=document(),preferred=p.units[1];
  assert.equal(resolveAssistantUnit(p,preferred.id,{kind:'fact',id:'fact_pending'})?.id,preferred.id);
  assert.equal(resolveAssistantUnit(p,preferred.id)?.id,preferred.id);
  assert.equal(resolveAssistantUnit(p,preferred.id,{kind:'character',id:'deleted'}),undefined);
  p.facts[0].scopeId='empty_season';
  assert.equal(resolveAssistantUnit(p,preferred.id,{kind:'fact',id:'fact_current'}),undefined);
});

test('entity edits reject scope changes, another ID, duplicate fields and stale author versions',()=>{
  const p=document();p.revision=1;const scope:ScriptDraftScope={workspaceId:'workspace',documentId:p.id,originRevision:1,originContentHash:hashValue(p),
    operations:['update_character'],units:[],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[],characterIds:['char_current']};
  const request={candidateId:'candidate',operation:'update_character' as const,entityId:'char_current'};
  const build=(changes:any,entityId=request.entityId)=>buildAgentDraft(JSON.stringify({summary:'机械',changes}),{...request,entityId},p,scope,{origin:p,ledger:emptyScriptDraftCreationLedger()});
  assert.throws(()=>build([{field:'scopeId',value:p.id}]),/未知|越过/);
  assert.throws(()=>build([{field:'name',value:'误改'}],'char_other'),/指定人物/);
  assert.throws(()=>build([{field:'name',value:'甲'},{field:'name',value:'乙'}]),/重复/);
  const candidate=build([{field:'bio',value:'新简介'}]),changed=structuredClone(p);changed.characters[0].bio='作者刚刚改过';
  assert.throws(()=>applyWorkspacePatch(changed,candidate.patch),/作者与工作稿分别改动/);
});

for(const fenced of [false,true])test(`bounded AI blueprint ${fenced?'inside a JSON fence ':''}saves optional fields, profiles and fact status before entering any outline`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const blueprint={concept:'城市渡口的故事',theme:'归属与选择',audienceExperience:'【建议】轻松中有紧张',constraints:'【暂定】三分钟动画短片',
    characters:[{name:'林舟',bio:'【建议】渡口管理员，刚回到故乡',desire:'保住渡口',need:'接受帮助',contradiction:'热心却怕麻烦',arc:'【建议】开始信任同伴',voice:'短句，务实'}],
    facts:[{text:'末班船十点停航',status:'approved' as const},{text:'【建议】码头即将改造',status:'draft' as const}],
    profile:{workType:'动画短片',organization:'standalone' as const,continuity:'serialized' as const,genres:['剧情','轻喜剧'],language:'zh-CN',productionMode:'animation' as const,aspectRatio:'16:9' as const}};
  let model:any;
  const host=createScriptAgentHost(db,{sendOnce:async request=>{model=request;const reply={kind:'BLUEPRINT',question:'精简蓝图已整理。',options:[],title:'渡口',format:'short-film',plannedUnits:1,targetMinutes:3,blueprint,stopAfter:null};return {text:fenced?'```json\n'+JSON.stringify({response:reply})+'\n```':JSON.stringify(reply),provenance};}},'blueprint-complete');
  const thread=host.conversations.open('author','script:home','complete-blueprint');
  const accepted=host.conversations.accept({ownerId:'author',threadId:thread.id,requestId:'blueprint',expectedVersion:1,
    requestEnvelope:{text:'机械蓝图请求'},payload:{text:'生成作品蓝图',intent:'BLUEPRINT',methods:[],channel:'api',routeRef:'fixture'},capabilityId:'script.assistant_start',maxInvocations:1});
  await host.worker.runOnce(accepted.conversation.turns[0].runId);
  const response=host.conversations.turn(thread.id,accepted.turnId,'author').turn.response!;assert.ok(response?.blueprintWorkspaceId);
  assert.match(model.systemInstruction,/3–5 位主要人物/);assert.match(model.systemInstruction,/非必填项/);
  const workspace=host.workspaces.read(response.blueprintWorkspaceId,'author');
  assert.equal(workspace.document.brief.audienceExperience,blueprint.audienceExperience);assert.equal(workspace.document.brief.constraints,blueprint.constraints);
  assert.equal(workspace.document.characters[0].bio,blueprint.characters[0].bio);assert.equal(workspace.document.characters[0].arc,blueprint.characters[0].arc);
  assert.deepEqual(workspace.document.facts.map(item=>item.status),['approved','draft']);assert.equal(workspace.document.profile.productionMode,'animation');
  assert.equal(workspace.document.profile.workType,blueprint.profile.workType);
  assert.equal(workspace.document.profile.targetDurationMs,180000);assert.deepEqual(workspace.document.profile.genres,blueprint.profile.genres);
  assert.equal(workspace.document.brief.outline,'');assert.equal((db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
  assert.ok(workspace.document.units.every(unit=>!unit.summary&&unit.scenes.every(scene=>scene.blocks.every(block=>!block.text))));
  const proposal=host.workspaces.prepareAdoption({workspaceId:workspace.id,ownerId:'author',workspaceRevision:workspace.revision,expectedAuthorRevision:0});
  host.workspaces.adopt({workspaceId:workspace.id,ownerId:'author',requestId:'adopt-blueprint',proposalId:proposal.id,digest:proposal.digest});
  assert.equal(host.scripts.getProject(workspace.documentId)!.characters[0].bio,blueprint.characters[0].bio);
  assert.throws(()=>parseBlueprint({...blueprint,characters:Array(7).fill(blueprint.characters[0])}),/篇幅/);
  assert.throws(()=>parseBlueprint({...blueprint,facts:Array(13).fill(blueprint.facts[0])}),/篇幅/);
  assert.throws(()=>parseBlueprint({...blueprint,facts:[{text:'伪造状态',status:'whatever'}]}),/设定/);
  assert.equal((blueprintSchema.properties.characters as any).maxItems,6);
});

test('old blueprints and characters without a bio remain usable, and old dense replies remain readable',()=>{
  const old={concept:'旧构想',theme:'',characters:[{name:'旧人物',voice:'',need:'',desire:''}],facts:Array(14).fill('旧设定')};
  assert.equal(parseBlueprint(old).facts.length,14);
  const p=document();delete p.characters[0].bio;assert.equal(blueprintContext(p,[p.units[0].id]).characters[0].bio,undefined);
});

test('explicit blueprint specs win over presets while legacy drafts still receive preset defaults',()=>{
  const draft=(value:Record<string,unknown>)=>parseIdeationDraft(JSON.stringify({concept:'渡口故事',outline:'',...value}),[]).profile;
  const explicit=draft({format:'short-film',workType:'动画短片合集',organization:'episodic',plannedUnits:4,continuity:'anthology',productionMode:'animation'});
  assert.equal(explicit.workType,'动画短片合集');assert.equal(explicit.organization,'episodic');assert.equal(explicit.plannedUnits,4);
  assert.equal(explicit.continuity,'anthology');assert.equal(explicit.productionMode,'animation');
  const legacy=draft({format:'tv-series'});assert.equal(legacy.workType,'连续剧集');assert.equal(legacy.organization,'episodic');assert.equal(legacy.plannedUnits,8);
  assert.equal(draft({format:'short-film'}).targetDurationMs,300000);assert.equal(draft({}).workType,'原创剧本');
});
