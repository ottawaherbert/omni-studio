import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { buildRequiredWritingContext } from '../packages/script/src/writingContext';
import { resolveStoryOutline } from '../packages/script/src/outlines';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile, createScriptProjectFromMaterial } from '../packages/script/src/creation';
import { unitCharacters, unitFacts, sceneStateHash, changeUnitStoryScope } from '../packages/script/src/continuity';

function anthology(){
  const p=createScriptProject('机械上下文验证',createScriptCreationProfile('anthology',3,2));
  const first=p.units[0];first.scopeId='story_a';first.summary='A_FIRST_PLAN';first.scenes[0].blocks[0].text='A_PREVIOUS_END';
  const other=newUnit('同名故事',120000,'story_b');other.summary='B_FORBIDDEN_PLAN';other.scenes[0].blocks[0].text='B_FORBIDDEN_BODY';
  const current=newUnit('同名故事',90000,'story_a');current.summary='A_CURRENT_PLAN';current.scenes[0].purpose='CURRENT_SCENE_PLAN';current.scenes[0].blocks[0].text='A_CURRENT_BODY';
  p.units.push(other,current);p.brief.concept='SHARED_CONCEPT';p.brief.outline='MIXED_GLOBAL_FORBIDDEN';
  p.seasons=[{id:'season_compilation',title:'同名故事',arc:'COMPILATION_ARC_FORBIDDEN'}];p.units.forEach(unit=>unit.seasonId='season_compilation');
  p.storyOutlines=[{scopeId:'story_a',outline:'A_FULL_STORY_PLAN'},{scopeId:'story_b',outline:'B_FULL_STORY_FORBIDDEN'}];
  p.characters=[{id:'char_a',scopeId:'story_a',name:'同名人物',bio:'A_CHARACTER',voice:'',desire:'',need:'',arc:'',contradiction:''},{id:'char_b',scopeId:'story_b',name:'同名人物',bio:'B_CHARACTER_FORBIDDEN',voice:'',desire:'',need:'',arc:'',contradiction:''}];
  return {p,first,other,current};
}

test('same-story continuation reads the actual earlier ending, real unit duration and precise outline owner',()=>{
  const {p,first,current}=anthology(),context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id,operation:'scene_body',source:{kind:'WORKSPACE',id:'work',version:7}}),serialized=JSON.stringify(context);
  assert.match(serialized,/A_PREVIOUS_END|A_FULL_STORY_PLAN/);assert.doesNotMatch(serialized,/FORBIDDEN/);
  assert.equal(context.currentUnits[0].targetDurationMs,90000);assert.equal(context.currentUnits[0].projectDefaultDurationMs,120000);
  assert.equal(context.manuscript.excerpts[0].sceneHash,sceneStateHash(first.scenes[0]));assert.equal(context.source.version,7);
  assert.equal(context.planning.meaning,'AUTHOR_PLANNING_NOT_OCCURRED_EVENTS');assert.equal(context.manuscript.excerpts[0].reason,'PREVIOUS_SAME_STORY_UNIT_END');
  assert.equal(context.outlineRequirements!.items[0].text,'A_CURRENT_PLAN');
  assert.equal(resolveStoryOutline(p,'story_a').kind,'story');assert.equal(resolveStoryOutline(p,'season_compilation').kind,'season');assert.equal(resolveStoryOutline(p,p.id).kind,'project');
});

test('long previous scene preserves its tail and exact partial-read offsets rather than implying a full read',()=>{
  const {p,first,current}=anthology();first.scenes[0].blocks[0].text='HIDDEN_HEAD_'+ '早'.repeat(7000)+'REAL_TAIL';
  const context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id,maxExcerptChars:100}),e=context.manuscript.excerpts[0];
  assert.equal(e.coverage.mode,'TAIL_EXCERPT');assert.equal(e.coverage.readChars,100);assert.equal(e.blocks[0].text,first.scenes[0].blocks[0].text.slice(-100));
  assert.equal(e.blocks[0].end,first.scenes[0].blocks[0].text.length);assert.ok(e.blocks[0].start>0);assert.match(e.notice,/不能声称已通读全场/);
});

test('old mixed anthology outline is never a missing-story fallback, and shared knowledge changes cannot import another story event',()=>{
  const {p,other,current}=anthology();p.storyOutlines=[];
  p.continuityTracks=[{id:'track',scopeId:p.id,kind:'knowledge',perspective:'audience',label:'共有记录',characterIds:[],initialValue:'起点',changes:[{id:'change',sceneId:other.scenes[0].id,value:'B_SECRET_FORBIDDEN',reason:'另一故事',sourceHash:sceneStateHash(other.scenes[0])}]}];
  const context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id});
  assert.equal(context.planning.missing[0].scopeId,'story_a');assert.doesNotMatch(JSON.stringify(context),/FORBIDDEN/);
});

test('procedural initial recurring canon is shared, anthology initial canon remains local',()=>{
  for(const format of ['procedural','anthology'] as const){
    const p=createScriptProjectFromMaterial('机械初始资料',createScriptCreationProfile(format,2,20),{concept:'前提',theme:'主题',outline:'',characters:[{name:'常驻'}],facts:['约定']});
    const next=newUnit('下一集',1200000,'story_next');p.units.push(next);
    assert.equal(unitCharacters(p,next).length,format==='procedural'?1:0);assert.equal(unitFacts(p,next).length,format==='procedural'?1:0);
  }
});

function hostFixture(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},'required-context-fixture',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','required-context'),fixture=anthology();
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{document:fixture.p}});
  return {db,host,thread,workspace,...fixture};
}

test('actual frozen narrow proposal receives required context without another anthology story or unselected target block',async t=>{
  const h=hostFixture(t),w=h.host.workspaces.read(h.workspace.id,'author'),document=structuredClone(w.document),unit=document.units[2],scene=unit.scenes[0];
  scene.blocks.push({id:'unselected',type:'action',text:'UNSELECTED_TARGET_FORBIDDEN'});
  const updated=h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:w.id,requestId:'edit',expectedRevision:w.revision,expectedEpoch:w.writerEpoch,document});
  const receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'narrow',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:w.id,expectedRevision:updated.revision},operation:'replace_blocks',instruction:'改写所选段落',target:{unitId:unit.id,sceneId:scene.id,blockIds:[scene.blocks[0].id]},methodIds:[],executionChannel:'external'},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-only'})});
  await h.host.worker.runOnce(receipt.runId);await h.host.childWorker.runOnce(receipt.runId);
  const frozen=h.host.journal.listExternal(receipt.runId,'author')[0];assert.ok(frozen,JSON.stringify(h.host.store.readRun(receipt.runId)));
  assert.match(frozen.request.prompt,/A_PREVIOUS_END/);assert.match(frozen.request.prompt,/A_FULL_STORY_PLAN/);assert.match(frozen.request.prompt,/90000/);
  assert.match(frozen.request.prompt,/A_CURRENT_BODY/);assert.doesNotMatch(frozen.request.prompt,/FORBIDDEN/);
  assert.equal((frozen.request.inputManifest as any).scriptDraft.workspaceRef.version,String(updated.revision));
});

test('actual frozen story-outline candidate reads and targets only the selected story owner',async t=>{
  const h=hostFixture(t),receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId:'story-outline',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},operation:'story_outline',instruction:'修订故事完整走向',target:{unitId:h.current.id,scopeId:'story_a'},methodIds:[],executionChannel:'external'},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-only'})});
  await h.host.worker.runOnce(receipt.runId);await h.host.childWorker.runOnce(receipt.runId);
  const frozen=h.host.journal.listExternal(receipt.runId,'author')[0];assert.ok(frozen,JSON.stringify(h.host.store.readRun(receipt.runId)));
  assert.match(frozen.request.prompt,/A_FULL_STORY_PLAN/);assert.doesNotMatch(frozen.request.prompt,/FORBIDDEN/);
  assert.equal((frozen.request.inputManifest as any).scriptDraft.scopeId,'story_a');
});


test('changing the sole story owner cannot orphan or overwrite its saved complete outline',()=>{
  const {p,other}=anthology(),before=JSON.stringify(p);
  assert.throws(()=>changeUnitStoryScope(p,other.id,'story_a'),/已有完整大纲/);assert.equal(JSON.stringify(p),before);
});

for(const range of ['whole','parent','before','scene'] as const)test(`frozen ${range} scene planning uses authorized outline IDs and the actual insertion predecessor`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let providerCalls=0;
  const host=createScriptAgentHost(db,{sendOnce:async()=>{providerCalls++;throw new Error('NO_EXTERNAL_MODEL');}},`planning-context-${range}`);
  const thread=host.conversations.open('author','script:home',`planning-${range}`);
  const project=createScriptProject('机械分场衔接',createScriptCreationProfile('feature-film',1,90)),unit=project.units[0];
  project.brief.outline='FULL_FILM_REQUIREMENT';
  unit.structureNodes=[{id:'parent',title:'父段',purpose:'PARENT_REQUIREMENT'},
    {id:'empty_child',parentId:'parent',title:'空子段',purpose:'CHILD_REQUIREMENT'},
    {id:'unrelated',title:'其他段',purpose:'UNRELATED_REQUIREMENT'}];
  unit.scenes=[{...newScene('父段已有场'),structureNodeId:'parent'},newScene('未归组尾场')];
  unit.scenes[0].blocks[0].text='ACTUAL_INSERTION_PREDECESSOR';
  unit.scenes[1].blocks[0].text='LATER_TAIL_MUST_NOT_BE_PREDECESSOR';
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'base',source:{document:project}});
  const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'plan',threadId:thread.id,expectedConversationVersion:1,
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},objective:'展开约定范围，完成分场即停',task:'WRITE',stopAfter:'SCENES',
    target:{unitIds:[unit.id],maxNewScenes:[{unitId:unit.id,count:2}],...(['parent','scene'].includes(range)?{structureTargets:[{unitId:unit.id,nodeId:'parent'}]}:{wholeUnitIds:[unit.id]})},methodIds:[]},
    {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-only'})});
  async function waiting(){
    for(let i=0;i<12;i++){
      const next=host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING');if(next)return next;
      await host.worker.runOnce(receipt.runId);await host.childWorker.runOnce(receipt.runId);
    }
    assert.fail(JSON.stringify(host.store.readRun(receipt.runId)));
  }
  const decision=await waiting();assert.match(decision.request.operationKey,/^decision:/);
  host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify({kind:'CALL',capabilityId:'script.propose',capabilityVersion:'1',
    arguments:{authorizationRef:receipt.authorizationRef,operation:range==='scene'?'scene_plan':'plan_scenes',instruction:'只展开已约定范围',unitId:unit.id,
      sceneId:range==='scene'?unit.scenes[0].id:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null,
      ...(range==='before'?{beforeSceneId:unit.scenes[1].id}:{nodeId:range==='scene'?'unrelated':'empty_child'})},
    planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null}),{name:'MECHANICAL_PROTOCOL_NO_EXTERNAL_MODEL',model:'fixture'});
  await host.worker.runOnce(receipt.runId);
  const draft=await waiting();assert.equal(draft.request.operationKey,'draft');
  const frozen=draft.request.prompt.split('\n\n').map(part=>{try{return JSON.parse(part);}catch{return null;}}).find(part=>part?.context&&part?.operation);
  assert.ok(frozen,'actual frozen draft context');
  const requirements=frozen.context.project.outlineRequirements.items.map((item:any)=>item.text);
  if(['parent','scene'].includes(range))assert.deepEqual(requirements,['PARENT_REQUIREMENT','CHILD_REQUIREMENT']);
  else {assert.ok(requirements.includes('FULL_FILM_REQUIREMENT'));if(range==='whole')assert.ok(requirements.includes('CHILD_REQUIREMENT'));}
  if(range==='scene')assert.equal(frozen.context.targetScene.id,unit.scenes[0].id);
  else {assert.equal(frozen.planningAnchor.id,unit.scenes[0].id);assert.match(JSON.stringify(frozen.planningAnchor),/ACTUAL_INSERTION_PREDECESSOR/);}
  assert.doesNotMatch(draft.request.prompt,/LATER_TAIL_MUST_NOT_BE_PREDECESSOR/);
  assert.equal(providerCalls,0);assert.deepEqual(host.workspaces.read(workspace.id,'author').document,workspace.document);
});
