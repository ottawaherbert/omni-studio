import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { readScriptGoalEnvelope } from '../packages/script/src/agentGoal';
import { stageDelivery, type ScriptStage } from '../packages/script/src/agentStages';
import { newGoalSelection } from '../apps/web/src/features/script/scriptGoalAuthoring';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';
const provenance={channel:'provider' as const,producer:'MECHANICAL_FIXTURE_NO_EXTERNAL_MODEL'};
const base={question:'【机械协议】阶段产出',options:[],title:null,format:null,plannedUnits:null,targetMinutes:null,blueprint:null,stopAfter:null};
const envelope=(kind:string,fields:Record<string,unknown>={})=>({kind,capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null,...fields});
function setup(t:any,reply:any){
 const db=new Database(':memory:');t.after(()=>db.close());
 const host=createScriptAgentHost(db,{sendOnce:async()=>({text:JSON.stringify(reply),provenance})},'stage-fixture');
 const thread=host.conversations.open('author','script:home','stage-test');
 const send=async(intent:string,stopAfter?:ScriptStage)=>{const accepted=host.conversations.accept({ownerId:'author',threadId:thread.id,requestId:'fixture-turn',expectedVersion:1,requestEnvelope:{intent},payload:{intent,text:'【机械作者要求】生成当前阶段',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'fixture',...(stopAfter?{stopAfter}:{})},capabilityId:'script.assistant_start',maxInvocations:1});await host.worker.runOnce(accepted.conversation.turns[0].runId);return {accepted,run:host.store.readRun(accepted.conversation.turns[0].runId),response:host.conversations.turn(thread.id,accepted.turnId,'author').turn.response};};
 return {db,host,thread,send};
}
for(const kind of ['READY','START'])test(`ordinary ${kind} never creates a Goal`,async t=>{
 const h=setup(t,{...base,kind,...(kind==='START'?{title:'机械',format:'short-film',plannedUnits:1,targetMinutes:3,stopAfter:'BODY'}:{})});
 const {run,response}=await h.send('AUTO');assert.equal(run.status,'SUCCEEDED');assert.equal(response.replyKind,'READY');
 assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
test('ordinary blueprint stops, persists once, and adopts into a real blueprint without outline or body',async t=>{
 const h=setup(t,{...base,kind:'BLUEPRINT',title:'机械蓝图',format:'short-film',plannedUnits:1,targetMinutes:3,blueprint:{concept:'机械构想',theme:'机械主题',characters:[{name:'机械人物',voice:'',desire:'',need:''}],facts:['机械设定']}});
 const {run,response}=await h.send('BLUEPRINT');assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));assert.equal(response.replyKind,'BLUEPRINT');
 const workspace=h.host.workspaces.read(response.blueprintWorkspaceId,'author');assert.equal(workspace.projectId,null);assert.equal(workspace.document.brief.concept,'机械构想');assert.equal(workspace.document.brief.outline,'');assert.ok(workspace.document.units.every(u=>!u.summary&&u.scenes.every(s=>s.blocks.every(b=>!b.text))));
 await h.host.worker.runOnce(run.id);assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,1);assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
 const proposal=h.host.workspaces.prepareAdoption({workspaceId:workspace.id,ownerId:'author',workspaceRevision:workspace.revision,expectedAuthorRevision:0});
 const input={workspaceId:workspace.id,ownerId:'author',requestId:'adopt-fixture',proposalId:proposal.id,digest:proposal.digest};
 const receipt=h.host.workspaces.adopt(input);assert.deepEqual(h.host.workspaces.adopt(input),receipt);
 assert.equal(h.host.scripts.getProject(workspace.documentId)?.brief.concept,'机械构想');
});
for(const stopAfter of [undefined,'BODY'] as const)test(`Agent refuses missing or mismatched stop ${stopAfter}`,async t=>{
 const h=setup(t,{...base,kind:'START',title:'机械',format:'short-film',plannedUnits:1,targetMinutes:3,stopAfter});
 const {run}=await h.send('AGENT','OUTLINE');assert.notEqual(run.status,'SUCCEEDED');assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
});
for(const scenario of ['BLUEPRINT','OUTLINE','BEATS','SCENES','EMPTY_SCENES','TOTAL_OUTLINE'] as const)test(`formal ${scenario} Goal commits only stage material and FINISH stops without body checks`,async t=>{
 const stage=scenario==='EMPTY_SCENES'?'SCENES':scenario==='TOTAL_OUTLINE'?'OUTLINE':scenario;
 const db=new Database(':memory:');t.after(()=>db.close());let decisions=0;let outlineRequirementIds:string[]=[];
 const operations=stage==='BLUEPRINT'?['concept','audienceExperience','constraints','update_character','update_fact']:stage==='OUTLINE'?['outline_development']:scenario==='EMPTY_SCENES'?['plan_scenes']:['scene_plan'];
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   if(request.operationKey==='draft'&&['update_character','update_fact'].includes((request.inputManifest?.scriptDraft as any)?.operation)){
     const character=(request.inputManifest?.scriptDraft as any).operation==='update_character';
     return {text:JSON.stringify({summary:'机械资料修改',changes:[{field:character?'bio':'text',value:'机械资料新内容'}]}),provenance};
   }
   if(request.operationKey==='draft'&&stage==='OUTLINE')return {text:JSON.stringify({summary:'机械联合大纲',content:'机械阶段内容',nodes:[],beats:[]}),provenance};
   if(request.operationKey==='draft')return {text:JSON.stringify(scenario==='EMPTY_SCENES'?{summary:'机械分场',scenes:[{localKey:'first',title:'机械新场',purpose:'机械分场事件',location:'机械地点',timeOfDay:'日',outlineRequirementIds}]}:stage==='BEATS'||stage==='SCENES'?{summary:'机械规划',title:'机械场',purpose:'机械分场事件',location:'机械地点',timeOfDay:'日',entryState:'前',exitState:'后',...(stage==='SCENES'?{outlineRequirementIds}:{})}:{summary:'机械阶段稿',content:'机械阶段内容'}),provenance};
   assert.ok(request.operationKey.startsWith('decision:'),'planning must not run body checks');decisions++;
   const sections=request.prompt.split('\n\n').flatMap(text=>{try{return [JSON.parse(text)];}catch{return [];}});
   const goal=sections.find(v=>v.contract&&v.authorizationRef),index=sections.find(v=>v.workspaceRef&&v.meaning==='PLAN_INDEX_NOT_MANUSCRIPT'),candidates=sections.find(v=>v.candidates)?.candidates||[];
   const done=candidates.filter((c:any)=>c.appliedRevision),pending=candidates.find((c:any)=>c.status==='VALID'&&!c.appliedRevision);
   let decision;
   if(decisions===1)decision=envelope('FINISH',{summary:'机械过早完成',artifactRefs:[index.workspaceRef]});
   else if(pending)decision=envelope('CALL',{capabilityId:'script.apply_patch',capabilityVersion:'1',arguments:{authorizationRef:goal.authorizationRef,candidateId:pending.id,expectedRevision:Number(index.workspaceRef.version),writerEpoch:index.writerEpoch}});
   else if(done.length<operations.length){const operation=operations[done.length];decision=envelope('CALL',{capabilityId:'script.propose',capabilityVersion:'1',arguments:{authorizationRef:goal.authorizationRef,operation,instruction:'机械阶段生成',unitId:['outline_development','unit_outline','scene_plan','plan_scenes','update_character','update_fact'].includes(operation)?index.units[0].id:null,sceneId:operation==='scene_plan'?index.scenes[0].sceneId:null,slotId:null,scopeId:null,entityId:operation==='update_character'?'char_blueprint':operation==='update_fact'?'fact_blueprint':null,blockIds:null,selection:null}});}
   else decision=envelope('FINISH',{summary:'机械阶段完成',artifactRefs:[index.workspaceRef]});
   return {text:JSON.stringify(decision),provenance};
 }},'stage-formal');
 const thread=host.conversations.open('author','script:home','formal-stage');
 const project=createScriptProject('机械阶段',createScriptCreationProfile(scenario==='TOTAL_OUTLINE'?'tv-series':'short-film',scenario==='TOTAL_OUTLINE'?5:1,3));
 if(stage==='BLUEPRINT'){
   project.characters.push({id:'char_blueprint',scopeId:project.id,name:'机械人物',desire:'',need:'',voice:'',contradiction:'',arc:''});
   project.facts.push({id:'fact_blueprint',scopeId:project.id,text:'机械旧设定',status:'approved'});
 }
 if(scenario==='EMPTY_SCENES')project.units[0].scenes=[];
 if(stage==='SCENES'){project.brief.outline='机械分场事件';outlineRequirementIds=collectOutlineRequirements(project,[{unitId:project.units[0].id}]).items.map(item=>item.id);}
 const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'base',source:{document:project}});
 const target=newGoalSelection(project,project.units[0],workspace,'WRITE',0,4,stage,undefined,scenario==='TOTAL_OUTLINE'?{kind:'project'}:{kind:'unit'}).target;
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',stopAfter:stage,requestId:'goal',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},target,objective:'机械协议：做到指定阶段停止',task:'WRITE',methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'fixture'})});
 const contract=readScriptGoalEnvelope(host.goals.read(receipt.goalId!,'author').revision.contract);assert.equal(contract.stopAfter,stage);assert.ok(!contract.scope.operations.includes('scene_body'));
 for(let n=0;n<35;n++){const run=host.store.readRun(receipt.runId);if(run.status==='QUEUED')await host.worker.runOnce(run.id);else if(run.status==='WAITING_STEP')await host.childWorker.runOnce(run.id);else break;}
 const run=host.store.readRun(receipt.runId);assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));
 const after=host.workspaces.read(workspace.id,'author');assert.ok(stageDelivery(after.document,contract.scope,stage).ready);assert.ok(after.document.units.every(u=>u.scenes.every(s=>s.blocks.every(b=>!b.text))));
 if(stage==='SCENES'){const status=host.reviews.readAuthorStatus(run);assert.deepEqual(status.storyProgress?.map(item=>item.status),['PLANNED']);assert.deepEqual(status.outlineGaps,[]);}
 assert.equal((db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,0);assert.ok(decisions>2,'premature FINISH was rejected');
 if(scenario==='TOTAL_OUTLINE'){assert.ok(after.document.units.every(unit=>!unit.summary));assert.ok(contract.scope.operations.includes('outline_development'));assert.ok(!contract.scope.operations.includes('scene_plan'));}
 if(stage==='BLUEPRINT'){
   assert.equal(after.document.characters.length,1);assert.equal(after.document.characters[0].bio,'机械资料新内容');
   assert.equal(after.document.facts.length,1);assert.equal(after.document.facts[0].text,'机械资料新内容');assert.equal(after.document.facts[0].status,'approved');
   assert.equal(after.document.brief.audienceExperience,'机械阶段内容');assert.equal(after.document.brief.constraints,'机械阶段内容');
 }
 assert.equal(after.writerRunId,null);const count=decisions;await host.worker.runOnce(receipt.runId);assert.equal(decisions,count);
});

test('explicit Agent outline cannot silently return only a blueprint',async t=>{
 const h=setup(t,{...base,kind:'BLUEPRINT',blueprint:{concept:'机械构想',theme:'',characters:[],facts:[]}});
 const {run}=await h.send('AGENT','OUTLINE');assert.notEqual(run.status,'SUCCEEDED');assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
for(const [operation,stage] of [['outline_goal','OUTLINE'],['project_outline_goal','OUTLINE'],['blueprint_goal','BLUEPRINT'],['scenes_goal','SCENES']] as const)test(`natural-language ${operation} delegates the selected stage`,async t=>{
 const h=setup(t,{kind:'CALL',operation,question:'机械协议委托',options:[]});
 const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'chat-base',source:{document:createScriptProject('机械聊天',createScriptCreationProfile('short-film',1,3))}});
 const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.thread.id,requestId:operation,expectedVersion:1,requestEnvelope:{operation},text:'机械协议：交给 Agent 做到指定阶段',methods:[],route:{channel:'api',routeRef:'fixture'},payload:{text:'机械协议委托',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'fixture'},selection:{workspaceId:workspace.id,expectedRevision:1,unitId:workspace.document.units[0].id}});
 const runId=accepted.conversation.turns[0].runId;await h.host.worker.runOnce(runId);assert.equal(h.host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(runId)));
 const receipt=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response.goal;
 const contract=readScriptGoalEnvelope(h.host.goals.read(receipt.goalId,'author').revision.contract);assert.equal(contract.stopAfter,stage);assert.ok(!contract.scope.operations.includes('scene_body'));
 if(stage==='OUTLINE')assert.ok(contract.scope.sharedFields.includes('outline'));
 if(operation==='project_outline_goal'){assert.ok(contract.scope.operations.includes('outline_development'));assert.ok(!contract.scope.operations.includes('scene_plan'));assert.ok(contract.scope.units.every(unit=>!unit.allowSummary&&!unit.allowAllScenes));}
 if(stage==='BLUEPRINT')assert.deepEqual(contract.scope.characterScopeIds,[workspace.document.id]);
});
