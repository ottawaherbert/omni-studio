import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { sha256 } from 'js-sha256';
import { AgentError, AgentWorker, DecisionDriver, CapabilityRegistry, hashValue, decisionOutputSchema, type PreparedCall, type ModelRequest } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { AgentSqliteStore, SqliteBudgetStore, SqliteGoalStore, SqliteHistoryStore, SqliteContextStore, SqliteModelJournal, SqliteConversationStore } from '../packages/agent-sqlite/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore,workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { ScriptDraftStore } from '../apps/api/src/repositories/scriptDraftStore';
import { ScriptReviewStore } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptGoalPlugin,matchesScriptToolSchema } from '../apps/api/src/agent/scriptGoalPlugin';
import { createScriptHistoryPolicy,createScriptHistorySourceResolver,readScriptHistoryResult } from '../apps/api/src/agent/scriptHistory';
import { registerScriptReadCapability,scriptReadInputSchema } from '../apps/api/src/agent/scriptReadCapability';
import { registerScriptDraftCapabilities } from '../apps/api/src/agent/scriptDraftCapabilities';
import { registerScriptReviewCapabilities } from '../apps/api/src/agent/scriptReviewCapabilities';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { parseScriptProject } from '../packages/script/src/schema';
import { scriptGoalEnvelope,defaultScriptChecks } from '../packages/script/src/agentGoal';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';
import {validateScriptDraftScope,type ScriptDraftScope} from '../packages/script/src/agentScope';
const signal=new AbortController().signal;
function setup(t:any,longBody=false,filmOutline:boolean|'scenes'=false,nodeCoverage=false,bodyFilm=false,bodyScopeStart:number|null=null){
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','plugin-mechanical');
 const scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts);workspaces.ensureSchema();
 const fixture=filmOutline?JSON.parse(readFileSync(new URL(filmOutline==='scenes'?'./fixtures/script-goal-film-scenes-workspace.json':'./fixtures/script-goal-film-outline-workspace.json',import.meta.url),'utf8')):null;
 const document=filmOutline
   ? parseScriptProject(fixture.document??fixture)
   : createScriptProject('【机械决策测试】',createScriptCreationProfile('short-film',1,3));
 if(nodeCoverage)document.units[0].structureNodes=[{id:'node_film_window',title:'拖轮窗口',purpose:'早期可控渗水时拒绝拖轮，失去救援窗口后必须靠岸撤离。'}];
 if(filmOutline==='scenes')document.revision=0; // New in-memory workspace, not the live author project.
 if(filmOutline==='scenes')while(document.units[0].scenes.length<36){
   // Capacity-only additions to the actual 23-scene failure snapshot; this is
   // not a claim that the remaining story scenes were generated or accepted.
   const index=document.units[0].scenes.length;
   const scene=structuredClone(document.units[0].scenes[index%23]);
   scene.structureNodeId=document.units[0].scenes.at(-1)!.structureNodeId;
   scene.id=`scene_capacity_${index}`;scene.blocks=scene.blocks.map((block,i)=>({...block,id:`block_capacity_${index}_${i}`}));
   document.units[0].scenes.push(scene);
 }
 if(bodyFilm)for(const [index,scene] of document.units[0].scenes.slice(0,4).entries()){
   scene.blocks=[{id:`block_body_fixture_${index}`,type:'action',text:`已保存的第 ${index+1} 场正文。`.repeat(40)}];
   scene.generation={status:'complete',checkpointId:`checkpoint_${index}`,appliedSteps:[]};
 }
 if(!filmOutline)document.units[0].scenes[0].blocks[0].text=longBody?'机械协议正文区间。'.repeat(100):'【机械正文标记】';
 const w=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}}),access={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
 let history:SqliteHistoryStore,reviews:ScriptReviewStore,allowed=true;
 const authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(scope,w)=>validateScriptDraftScope(w.document,scope as ScriptDraftScope),readSource:()=>{throw new Error('fixture has no external grants');}});authorizations.ensureSchema();
 const source=(dep:any,a:any)=>allowed&&(dep.ref.uri.startsWith('resource://agent-history/')?createScriptHistorySourceResolver(history)(dep,a):dep.ref.uri.includes('/check-receipts/')?reviews.sourceAllowed(dep.ref,a,dep.freshness):workspaces.sourceAllowed(dep.ref,a,dep.freshness));
 const contexts=new SqliteContextStore(store,source,()=>authorizations.readerDigest());contexts.ensureSchema();
 const assertInput=(request:ModelRequest,run:any,phase:any)=>authorizations.withRunAuthorization(run,phase,()=>{const bundle=phase==='VIEW'?contexts.assertVisible(request.contextRef!,access):contexts.assertAllowed(request.contextRef!,access);assert.equal(bundle.prompt,request.prompt);assert.deepEqual(bundle.outputSchema,request.outputSchema);});
 const journal=new SqliteModelJournal(store,assertInput);journal.ensureSchema();const goals=new SqliteGoalStore(store,new SqliteBudgetStore(store),(run,proof)=>authorizations.withRunAuthorization(run,'CONSUME',()=>reviews.verifyCompletionForRun(run,proof)),assertInput);goals.ensureSchema();
 history=new SqliteHistoryStore(store,goals,createScriptHistoryPolicy({store,contexts,authorizations,assertSource:(ref,a,f)=>{if(!source({ref,freshness:f},a))throw new AgentError('SOURCE_REVOKED','mechanical source revoked');}}));history.ensureSchema();
 const bodySceneIds=bodyScopeStart===null?null:w.document.units[0].scenes.slice(bodyScopeStart,bodyScopeStart+7).map(scene=>scene.id);
 const scope:ScriptDraftScope={workspaceId:w.id,documentId:w.documentId,originRevision:1,originContentHash:hashValue(w.document),operations:filmOutline&&!bodyFilm?['unit_outline','plan_scenes','plan_structure','scene_plan']:['scene_body','plan_scenes'],units:[{unitId:w.document.units[0].id,allowSummary:true,allowAllScenes:bodySceneIds===null,allowStructure:Boolean(filmOutline&&!bodyFilm),maxNewScenes:filmOutline&&!bodyFilm?36:3,scenes:bodySceneIds?.map(sceneId=>({sceneId,allowPlan:false,allowBody:true,blockIds:null}))??[]}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
 const auth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:w.id,commandId:'goal',scope,sources:[]});
 const checks=defaultScriptChecks([document.units[0].id],1,bodyFilm?scope:undefined,filmOutline?{originRevision:1,targets:[{unitId:document.units[0].id,...(nodeCoverage?{nodeIds:['node_film_window']}:{})}]}:undefined);
 const methods=filmOutline==='scenes'?fixture.skillManifest:[{id:'mechanical-method',version:'frozen-v1',title:'机械完整方法',content:'【全文前半】\n【全文末尾不可漏】',usage:{operations:['scene' as const],inputs:[],note:'只用于正文工具'}}];
 const accepted=goals.accept({ownerId:'author',scopeId:'script:home',threadId:thread.id,requestId:'goal',requestEnvelope:{fixture:true},policyRevision:'1',objective:filmOutline==='scenes'?fixture.objective:'【机械目标】完成本单元正文与检查',contract:scriptGoalEnvelope({workspaceId:w.id,documentId:w.documentId,task:'WRITE',scope,checks,...(filmOutline&&!bodyFilm?{stopAfter:'SCENES' as const}:{}),strategy:{id:'SCRIPT_GOAL_V1',maxNoProgressStreak:3}}),authorizationRef:auth.id,workspaceRef:workspaceRef(w),sourceRefs:[],skillManifest:methods,route:{channel:'api',routeRef:'mechanical-no-provider'},stopPolicy:'CONTRACT_COMPLETE',turnLimits:{maxDecisions:30,maxToolCalls:30},budgetLimits:{maxInvocations:40,maxToolCalls:40,maxTurns:10,maxRepairRounds:2}});
 authorizations.bind(auth.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:1});
 const drafts=new ScriptDraftStore(store,workspaces,authorizations,contexts,journal);drafts.ensureSchema();
 reviews=new ScriptReviewStore(store,workspaces,contexts,journal,{forRun:run=>({reviewScopeId:accepted.goalId,workspaceId:w.id,authorizationRef:authorizations.forRun(run).id,contract:checks}),completionState:()=>({unresolvedUnknown:false,outOfScopeWrites:false})});reviews.ensureSchema();
 const registry=new CapabilityRegistry({assertExecution:async c=>{store.assertExecution(c.execution);},authorize:async()=>{}}),deps={store,contexts,journal,authorizations,workspaces,drafts,reviews,transport:{sendOnce:async()=>{throw new Error('NO MODEL CALLS');}},executionSettings:()=>({channel:'api' as const,routeRef:'mechanical-no-provider',methods,authorRequest:'mechanical'})};
 registerScriptReadCapability(registry,deps,hashValue('read-fixture'));registerScriptDraftCapabilities(registry,deps,hashValue('draft-fixture'));registerScriptReviewCapabilities(registry,deps,hashValue('check-fixture'));
 const plugin=createScriptGoalPlugin({store,goals,history,contexts,authorizations,workspaces,drafts,reviews,registry});let claimed=store.claim('plugin-test',30000,accepted.runId)!;
 const execution=()=>goals.execution(claimed.token),frame=<T>(fn:()=>T)=>authorizations.withRunAuthorization(execution().run,'CONSUME',fn);
 async function input(){const turn=goals.openTurn(claimed.token);return {turn,...await plugin.buildDecisionInput(execution(),turn,signal)};}
 async function receipt(data:any,ownSource=false,consume=true){
   const before=await plugin.projectProgress(execution(),signal),built=await input(),token=claimed.token,modelRequest:ModelRequest={operationKey:`decision:${built.turn.id}:${built.turn.nextDecisionIndex}`,channel:'api',routeRef:'mechanical-no-provider',prompt:built.prompt,systemInstruction:built.systemInstruction,outputSchema:decisionOutputSchema(built.allowedTools),contextRef:built.contextRef,inputManifest:{...built.inputManifest,allowedGoalTools:built.allowedTools}},sampling=goals.saveSampling(token,{turnId:built.turn.id,index:built.turn.nextDecisionIndex,modelRequest,allowedToolsDigest:hashValue(built.allowedTools),progressFingerprint:before.fingerprint});
   const args={authorizationRef:auth.id,sourceId:null,view:'BODY',unitId:document.units[0].id,sceneId:null,cursor:null,maxChars:100,limit:20};
   const decision=goals.acceptDecision(token,sampling.id,{kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:args,planUpdate:null});
   const bundle=compileContext({systemInstruction:'【机械读取来源】',sections:[{id:'read',text:'PRIVATE_PREPARED_PROMPT',required:true,priority:1,dependencies:[{ref:workspaceRef(w),freshness:'CURRENT'}]}],skills:[]}),ref=contexts.capture(access,bundle);
   const preparedInput={...args,frozen:{contextRef:ref}},p:PreparedCall={request:{capabilityId:'script.read',capabilityVersion:'1',callId:decision.callId!,input:preparedInput},implementationDigest:hashValue('read-fixture'),contractDigest:hashValue('mechanical-contract'),inputDigest:hashValue(preparedInput),binding:{ownerId:'author',scopeId:'script:home',commandRevision:String(token.inputRevision),policyRevision:'1'},sources:[workspaceRef(w)],targets:[],preparedDigest:''};const{preparedDigest,...rest}=p;p.preparedDigest=hashValue(rest);
   const step=store.savePrepared(token,p,hashValue({...p.request,input:args})),childToken={...token,stepId:step.id};
   if(ownSource){const request=journal.prepare(childToken,{operationKey:'child-source',channel:'api',routeRef:'mechanical',prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,contextRef:ref});const attempt=journal.startAttempt(childToken,request.id);journal.recordResult(request.id,attempt.attemptId,{text:'PRIVATE_RAW_MODEL_TEXT',provenance:{channel:'provider'}});}
   store.commitStep(childToken,decision.callId!,{status:'SUCCEEDED',summary:'【机械页回执】',data,evidence:[workspaceRef(w)],artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'},()=>{});if(consume)goals.consumeReceipt(token,decision.id);
   return {sampling,step,ref,decision};
 }
 const page=(start=0,text='【页正文】')=>({meaning:'MANUSCRIPT_EXCERPTS',sourceRef:workspaceRef(w),rows:[{unitId:document.units[0].id,sceneId:document.units[0].scenes[0].id,title:'机械场',blockId:document.units[0].scenes[0].blocks[0].id,type:'action',text,start,end:start+text.length,length:100}],nextCursor:'mechanical-next',hasMore:true,totalEntries:1});
 return {db,store,goals,history,contexts,journal,authorizations,drafts,reviews,registry,workspaces,w,auth,access,accepted,scope,methods,plugin,execution,input,receipt,page,frame,token:()=>claimed.token,allow:(v:boolean)=>{allowed=v;},resume:()=>{const run=store.readRun(accepted.runId);if(run.status==='RUNNING')store.control(run.id,'author',run.version,'pause',`pause-${run.version}`);const paused=store.readRun(run.id),goal=goals.read(accepted.goalId,'author');goals.continue({goalId:goal.id,ownerId:'author',expectedVersion:goal.version,expectedRunVersion:paused.version,requestId:`continue-${paused.version}`,requestEnvelope:{resume:true}});claimed=store.claim('resume',30000,run.id)!;}};
}

test('first Goal decision freezes actual strict output schema and full configured methods without saving a fictitious review',async t=>{
 const h=setup(t),built=await h.input();const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));assert.deepEqual(bundle.outputSchema,decisionOutputSchema(built.allowedTools));assert.equal(bundle.prompt,built.prompt);
 assert.match(built.prompt,/全文末尾不可漏/);assert.match(built.prompt,/CATALOG_NOT_BLANKET_APPLIED/);assert.match(built.prompt,/只用于正文工具/);assert.ok(built.allowedTools.some(tool=>tool.id==='script.read'));assert.equal((h.db.prepare('SELECT count(*) n FROM script_review_sets').get() as any).n,0);assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n,0);
 assert.match(built.prompt,/TARGET_ESTIMATE_PLAN_PREVIEW_MEASUREMENT_ARE_DISTINCT/);
 assert.match(built.prompt,/"targetDurationMs":180000/);
 assert.match(built.prompt,/"dialogueEstimate":null/);
 assert.match(built.prompt,/"plannedCoverage":\{"coverageMs":0/);
 assert.match(built.prompt,/"measuredFinal":null/);
 h.methods[0].content='CURRENT_CHANGED_METHOD';assert.doesNotMatch((await h.input()).prompt,/CURRENT_CHANGED_METHOD/);
 const progress=await h.plugin.projectProgress(h.execution(),signal);assert.ok(progress.remainingWork.length);assert.equal((await h.plugin.assessCompletion(h.execution(),{kind:'FINISH',summary:'model claimed complete',artifactRefs:[]},signal)).complete,false);
});
test('adopted real film outline stays visible in the next bounded Goal decision',async t=>{
 const h=setup(t,false,true);
 const built=await h.input();
 const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));
 const outline=h.w.document.units[0].summary;
 assert.ok(outline.length>3000);
 const section=(id:string)=>JSON.parse(bundle.sections.find(item=>item.id===id)!.text);
 const index=section('workspace-index'),basis=section('writing-basis'),range=section('outline-range');
 assert.equal(index.sectionId,'workspace-index');assert.equal(range.sectionId,'outline-range');
 assert.match(built.prompt,/"sectionId":"workspace-index"/);assert.match(built.prompt,/"sectionId":"outline-range"/);
 assert.equal(index.blueprint.planning.units[0].summary,outline);
 assert.equal(index.units[0].summary,undefined);
 assert.deepEqual(index.units[0].summaryRef,{sectionId:'workspace-index',path:'blueprint.planning.units',unitId:index.units[0].id});
 assert.equal(basis.currentUnits[0].summary,undefined);
 assert.equal(basis.blueprintHash,sha256(JSON.stringify(index.blueprint)));
 assert.equal(basis.planningHash,sha256(JSON.stringify(index.blueprint.planning)));
 assert.deepEqual(basis.blueprintRef,{sectionId:'workspace-index',path:'blueprint',sourceHash:basis.blueprintHash});
 assert.deepEqual(basis.planningRef,{sectionId:'workspace-index',path:'blueprint.planning',sourceHash:basis.planningHash});
 assert.equal(index.blueprint.planning.units.find((unit:any)=>unit.id===basis.currentUnits[0].summaryRef.unitId).summary,outline);
 const resolved=range.items.map(({textRef,...item}:any)=>({...item,text:textRef?index.blueprint.planning.units.find((unit:any)=>unit.id===textRef.unitId)[textRef.field].slice(textRef.start,textRef.end):item.text}));
 assert.deepEqual(resolved,collectOutlineRequirements(h.w.document,[{unitId:h.w.document.units[0].id}]).items);
 assert.deepEqual(basis.outlineRequirementsRef,{sectionId:'outline-range',path:'items',itemCount:range.items.length});
 assert.ok(resolved.every((item:any)=>outline.slice(item.start,item.end)===item.text));
 assert.equal(basis.outlineRequirements,undefined);
});
test('node-scoped coverage reference counts the actual range, not the entire unit outline',async t=>{
 const h=setup(t,false,true,true),built=await h.input();
 const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));
 const section=(id:string)=>JSON.parse(bundle.sections.find(item=>item.id===id)!.text);
 const basis=section('writing-basis'),range=section('outline-range');
 const expected=collectOutlineRequirements(h.w.document,[{unitId:h.w.document.units[0].id,nodeIds:['node_film_window']}]);
 assert.deepEqual(range.items,expected.items);
 assert.equal(basis.outlineRequirementsRef.itemCount,expected.items.length);
 assert.notEqual(expected.items.length,collectOutlineRequirements(h.w.document,[{unitId:h.w.document.units[0].id}]).items.length);
 assert.ok(range.items.every((item:any)=>item.ownerKind==='node'&&item.text==='早期可控渗水时拒绝拖轮，失去救援窗口后必须靠岸撤离。'));
});
test('a feature-film controller retains all 36 scene plans without repeating source text',async t=>{
 const h=setup(t,false,'scenes'),built=await h.input();
 const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));
 const index=JSON.parse(bundle.sections.find(item=>item.id==='workspace-index')!.text);
 const basis=JSON.parse(bundle.sections.find(item=>item.id==='writing-basis')!.text);
 assert.equal(basis.sectionId,'writing-basis');
 for(const unit of index.units)assert.deepEqual(basis.currentUnits.find((item:any)=>item.id===unit.structureRef.unitId)[unit.structureRef.field],h.w.document.units.find(item=>item.id===unit.id)!.structureNodes);
 assert.equal(index.totalScenes,36);assert.equal(index.scenes.length,36);
 assert.ok(index.scenes.every((scene:any)=>scene.continuationCheckpoint===null));
 assert.match(index.continuationGuidance,/script.read/);
 for(const scene of h.w.document.units[0].scenes){
   const visible=index.scenes.find((item:any)=>item.sceneId===scene.id);
   assert.equal(visible.purpose,scene.purpose);assert.equal(visible.entryState,scene.entryState);assert.equal(visible.exitState,scene.exitState);
 }
});
test('BODY feature-film controller keeps an ordered directory and a bounded current plan',async t=>{
 const h=setup(t,false,'scenes',false,true),built=await h.input();
 const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));
 const index=JSON.parse(bundle.sections.find(item=>item.id==='workspace-index')!.text);
 const source=h.w.document.units[0].scenes;
 assert.equal(index.totalScenes,36);assert.equal(index.scenes.length,36);
 assert.deepEqual(index.scenes.map((scene:any)=>scene.sceneId),source.map(scene=>scene.id));
 assert.deepEqual(index.scenes.filter((scene:any)=>scene.planDetail==='INLINE').map((scene:any)=>scene.sceneId),
   source.slice(3,6).map(scene=>scene.id));
 assert.equal(index.scenes[4].purpose,source[4].purpose);
 assert.deepEqual(index.scenes[4].continuationCheckpoint?.sceneId,source[4].id);
 assert.equal(index.scenes[7].planDetail,'READ_INDEX');
 assert.equal(index.scenes[7].purpose,undefined);
 assert.match(index.planReadGuidance,/script\.read/);
 assert.equal(index.blueprint.planning.units[0].summary,h.w.document.units[0].summary);
});
test('BODY focus and continuation never advance from an empty scene outside the author scope',async t=>{
 const h=setup(t,false,'scenes',false,true,7),built=await h.input();
 const bundle=h.frame(()=>h.contexts.assertAllowed(built.contextRef!,h.access));
 const index=JSON.parse(bundle.sections.find(item=>item.id==='workspace-index')!.text);
 const source=h.w.document.units[0].scenes;
 assert.equal(index.scenes[0].planDetail,'READ_INDEX');
 assert.equal(index.scenes[0].inGoalScope,false);
 assert.deepEqual(index.scenes.filter((scene:any)=>scene.planDetail==='INLINE').map((scene:any)=>scene.sceneId),
   source.slice(6,9).map(scene=>scene.id));
 assert.equal(index.scenes[6].inGoalScope,false);
 assert.equal(index.scenes[6].continuationCheckpoint,null);
 assert.equal(index.scenes[7].inGoalScope,true);
 assert.equal(index.scenes[7].continuationCheckpoint.sceneId,source[7].id);
});
test('frozen tool schema denies extra parameters and a different authorization before any effect',async t=>{
 const h=setup(t),built=await h.input(),sampling=h.goals.saveSampling(h.token(),{turnId:built.turn.id,index:0,modelRequest:{operationKey:`decision:${built.turn.id}:0`,channel:'api',routeRef:'mechanical-no-provider',prompt:built.prompt,contextRef:built.contextRef,inputManifest:{allowedGoalTools:built.allowedTools}},allowedToolsDigest:hashValue(built.allowedTools)}),args={authorizationRef:h.auth.id,sourceId:null,view:'BODY',unitId:h.w.document.units[0].id,sceneId:null,cursor:null,maxChars:100,limit:20};
 assert.ok(matchesScriptToolSchema(args,scriptReadInputSchema));assert.equal(matchesScriptToolSchema({...args,frozen:{}},scriptReadInputSchema),false);
 await assert.rejects(h.plugin.authorizeCall(h.execution(),{kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:{...args,authorizationRef:'foreign'},planUpdate:null},sampling,signal),/当前作者授权/);
 await assert.rejects(h.plugin.authorizeCall(h.execution(),{kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:{...args,unitId:'foreign-unit'},planUpdate:null},sampling,signal),/范围/);
});
test('consumed page results reach the next decision through exact history sources without raw frozen inputs',async t=>{
 const h=setup(t);await h.receipt({...h.page(),PRIVATE_LEAK:'NEVER_COPY_THIS'});const next=await h.input();assert.match(next.prompt,/页正文/);assert.match(next.prompt,/mechanical-next/);assert.doesNotMatch(next.prompt,/NEVER_COPY_THIS|PRIVATE_PREPARED_PROMPT|PRIVATE_RAW_MODEL_TEXT/);
 const page=h.frame(()=>h.history.listReceiptViews(h.token()));assert.equal(page.items[0].state,'VISIBLE');const item=page.items[0];if(item.state==='VISIBLE')assert.throws(()=>h.frame(()=>readScriptHistoryResult({store:h.store,history:h.history},h.token(),{...item,projection:{...item.projection,summary:'forged'}},h.access)),/变化/);
});
test('four distinct real pages advance read coverage while repeated same page does not refresh progress',async t=>{
 const h=setup(t),fingerprints:string[]=[(await h.plugin.projectProgress(h.execution(),signal)).fingerprint];
 for(let i=0;i<4;i++){const r=await h.receipt(h.page(i*10,`【机械页${i}】`),false,false);fingerprints.push((await h.plugin.projectProgress(h.execution(),signal)).fingerprint);assert.equal(h.frame(()=>h.history.listReceiptViews(h.token())).items.length,i);h.goals.consumeReceipt(h.token(),r.decision.id,undefined,{before:fingerprints.at(-2)!,after:fingerprints.at(-1)!});}
 assert.equal(new Set(fingerprints).size,5);await h.receipt(h.page(30,'【机械页3】'));assert.equal((await h.plugin.projectProgress(h.execution(),signal)).fingerprint,fingerprints.at(-1));
});
test('history reopens after pause with old contexts visible, but actual source withdrawal redacts tool output',async t=>{
 const h=setup(t);await h.receipt(h.page(),true);const page=h.frame(()=>h.history.listReceiptViews(h.token())),view=page.items[0];assert.equal(view.state,'VISIBLE');h.resume();assert.match((await h.input()).prompt,/页正文/);
 h.allow(false);const changed=h.frame(()=>h.history.listReceiptViews(h.token()));assert.equal(changed.items[0].state,'REDACTED');assert.equal(changed.sourceUsable,false);assert.doesNotMatch(JSON.stringify(changed),/页正文|PRIVATE_/);
});


test('real Driver and worker can consume four distinct read pages before ASK without a false no-progress stop',async t=>{
 const h=setup(t,true);let sends=0;const seen:string[]=[];
 const driver=new DecisionDriver(h.goals,h.journal,{sendOnce:async(request)=>{
   sends++;assert.ok(request.contextRef);let cursor:string|null=null;
   const lines=request.prompt.split('\n\n');const facts=lines.flatMap(line=>{try{const data=JSON.parse(line);return data.facts?[data.facts]:[];}catch{return [];}})[0];
   const reads=(facts?.items??[]).filter((item:any)=>item.capabilityId==='script.read');if(reads.length)cursor=reads.at(-1).result.nextCursor;
   if(sends>1){assert.ok(reads.length===sends-1);seen.push(cursor!);}
   const empty={kind:'ASK',capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null};
   const value=sends<=4?{...empty,kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:{authorizationRef:h.auth.id,sourceId:null,view:'BODY',unitId:h.w.document.units[0].id,sceneId:null,cursor,maxChars:100,limit:20}}:{...empty,message:'【机械暂停点】已读取四页，等待作者',choices:[]};
   return {text:JSON.stringify(value),provenance:{channel:'provider',producer:'mechanical decision fixture; no external model'}};
 }},h.plugin);
 h.store.yieldRun(h.token());const worker=new AgentWorker(h.store,h.registry,{workerId:'real-plugin-worker',handlers:{GOAL:ctx=>driver.handle(ctx)}});await worker.runOnce(h.accepted.runId);
 const run=h.store.readRun(h.accepted.runId);assert.equal(run.status,'WAITING_INPUT',JSON.stringify(run));assert.equal(sends,5);assert.equal(new Set(seen).size,4);assert.equal(h.goals.readRunLink(run.id)!.noProgressStreak,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_steps WHERE status='COMMITTED'").get() as any).n,4);
});


test('tokenless historical source VIEW intersects the active narrowed workspace grant',async t=>{
 const h=setup(t);await h.receipt(h.page());const original=h.frame(()=>h.history.listReceiptViews(h.token())),item=original.items[0];assert.equal(item.state,'VISIBLE');if(item.state!=='VISIBLE')return;
 const scene=h.w.document.units[0].scenes[0],scope={...h.scope,units:[{...h.scope.units[0],allowAllScenes:false,scenes:[{sceneId:scene.id,allowBody:true,allowPlan:false,blockIds:[scene.blocks[0].id]}]}]};
 const auth=h.authorizations.issue({ownerId:'author',threadId:h.execution().run.threadId,workspaceId:h.w.id,commandId:'narrow-reader',scope,sources:[]});
 const accepted=h.store.accept({ownerId:'author',threadId:h.execution().run.threadId,scopeId:'script:home',requestId:'narrow-reader',kind:'CAPABILITY',input:{authorizationRef:auth.id},policyRevision:'1',maxInvocations:1});h.authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});
 const read=()=>createScriptHistorySourceResolver(h.history)({ref:item.exactRef,freshness:'EXACT'},h.access);
 assert.equal(h.frame(read),true);assert.equal(h.authorizations.withRunAuthorization(h.store.readRun(accepted.runId),'VIEW',read),false);assert.equal(h.frame(read),true);
 const wide=(fn:()=>string)=>h.authorizations.withAuthorization(h.auth.id,'author','VIEW',fn),narrow=(fn:()=>string)=>h.authorizations.withAuthorization(auth.id,'author','VIEW',fn);
 const digest=()=>h.authorizations.readerDigest();assert.equal(wide(digest),wide(()=>wide(digest)),'same-reader recursion retains the memo identity');assert.notEqual(wide(()=>narrow(digest)),narrow(()=>wide(digest)),'outermost current reader remains part of the cache key');
});

test('a manual committed page uses its independent narrow authorization when the controller resumes',async t=>{
 const h=setup(t),run=h.execution().run;h.store.control(run.id,'author',run.version,'pause','manual-takeover');
 const scene=h.w.document.units[0].scenes[0],scope={...h.scope,units:[{...h.scope.units[0],allowAllScenes:false,scenes:[{sceneId:scene.id,allowBody:true,allowPlan:false,blockIds:[scene.blocks[0].id]}]}]};
 const auth=h.authorizations.issue({ownerId:'author',threadId:run.threadId,workspaceId:h.w.id,commandId:'manual-read',scope,sources:[]});const request={capabilityId:'script.read',capabilityVersion:'1',callId:'manual-read',input:{authorizationRef:auth.id,sourceId:null,view:'BODY',unitId:h.w.document.units[0].id,sceneId:scene.id,cursor:null,maxChars:100,limit:20}};
 const accepted=h.store.accept({ownerId:'author',threadId:run.threadId,scopeId:'script:home',requestId:'manual-read',kind:'CAPABILITY',input:{authorizationRef:auth.id,request},policyRevision:'1',maxInvocations:1});h.authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});h.goals.attachManualRun({runId:accepted.runId,ownerId:'author',goalId:h.accepted.goalId,expectedGoalVersion:h.goals.read(h.accepted.goalId,'author').version,authorizationRef:auth.id,workspaceRef:workspaceRef(h.w)});
 const worker=new AgentWorker(h.store,h.registry,{workerId:'manual'});await worker.runOnce(accepted.runId);assert.equal(h.store.readRun(accepted.runId).status,'SUCCEEDED');h.resume();
 const page=h.frame(()=>h.history.listReceiptViews(h.token()));assert.equal(page.items[0].state,'VISIBLE');if(page.items[0].state==='VISIBLE')assert.equal(page.items[0].projection.origin.role,'MANUAL_STEP');assert.match((await h.input()).prompt,/机械正文标记/);
});
