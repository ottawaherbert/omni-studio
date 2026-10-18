import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ModelRequest } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';

// Mechanical protocol fixtures through the real command/worker/candidate/check
// composition. These sentences are not an artistic-quality or duration test.
const envelope=(kind:string,fields:Record<string,unknown>={})=>({kind,capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null,...fields});
const call=(capabilityId:string,args:unknown)=>envelope('CALL',{capabilityId,capabilityVersion:'1',arguments:args});
const sections=(request:ModelRequest)=>request.prompt.split('\n\n').flatMap(part=>{try{return [JSON.parse(part)];}catch{return [];}});
for(const scopeKind of ['film','node'] as const)test(`BODY ${scopeKind}: two calls append to one scene, actual outline review completes, author adoption stays separate`,async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());let writes=0,checks=0;
 const doc=createScriptProject('机械覆盖验收',createScriptCreationProfile('feature-film',1,90)),unit=doc.units[0],scene=unit.scenes[0];
 doc.brief.outline='人物发现证据。\n人物递交证据，故事结束。';scene.purpose='发现并交付证据';scene.location='档案室';scene.blocks=[];
 if(scopeKind==='node'){
   unit.structureNodes=[{id:'opening',title:'前段',purpose:'不属于本次写入'},{id:'resolution',title:'第二段',purpose:doc.brief.outline}];
   const outside=newScene('范围外原稿');outside.structureNodeId='opening';outside.blocks[0].text='范围外原稿保持不动';
   scene.structureNodeId='resolution';unit.scenes.unshift(outside);
 }
 const targets=[{unitId:unit.id,...(scopeKind==='node'?{nodeIds:['resolution']}:{})}];
 scene.outlineRequirementIds=collectOutlineRequirements(doc,targets).items.map(item=>item.id);
 const requests:ModelRequest[]=[];
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   requests.push(request);if(requests.length>60)throw new Error('MECHANICAL_REQUEST_LIMIT');let output:unknown;
   if(request.operationKey.startsWith('decision:')){
     const parts=sections(request),goal=parts.find(part=>part.authorizationRef&&part.contract),index=parts.find(part=>part.meaning==='PLAN_INDEX_NOT_MANUSCRIPT'),review=parts.find(part=>typeof part.available==='boolean');
     const candidates=parts.find(part=>Array.isArray(part.candidates))?.candidates??[],pending=candidates.find((candidate:any)=>candidate.status==='VALID'&&!candidate.appliedRevision);
     if(pending)output=call('script.apply_patch',{authorizationRef:goal.authorizationRef,candidateId:pending.id,expectedRevision:Number(index.workspaceRef.version),writerEpoch:index.writerEpoch});
     else if(writes<2){
       const current=index.scenes.find((item:any)=>item.sceneId===scene.id);
       output=call('script.propose',{authorizationRef:goal.authorizationRef,operation:'append_scene_body',instruction:'机械协议：保存本场下一批',unitId:unit.id,sceneId:scene.id,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null,continuationCheckpoint:current.continuationCheckpoint});
     }else{
       const ready=review.tasks.find((task:any)=>task.status==='READY');
       output=ready?call('script.check_batch',{authorizationRef:goal.authorizationRef,taskId:ready.id}):envelope('FINISH',{artifactRefs:[index.workspaceRef],summary:'机械范围及检查完成，等待作者审阅'});
     }
   }else if(request.operationKey==='draft'){
     writes++;output={summary:'机械同场续写',blocks:[{localKey:`part${writes}`,type:'action',text:writes===1?'人物发现证据。':'人物递交证据，故事结束。',speakerId:null,speakerName:null}],isComplete:writes===2};
   }else{
     checks++;const batch=JSON.parse(request.prompt.split('SCRIPT_CHECK_INPUT\n')[1].split('\n')[0]);
     const raw=batch.payload.raw.map(({sceneId,blockId,start,end}:any)=>({sceneId,blockId,start,end}));
     const inherited=batch.payload.evidence.flatMap((receipt:any)=>receipt.outlineCoverage??[]).flatMap((item:any)=>item.evidence);
     const refs=[...new Map([...raw,...inherited].map(ref=>[JSON.stringify(ref),ref])).values()];
     output={summary:'机械检查：仅证明实际来源与范围齐备',findings:[],resolvedFindingIds:[],...(batch.payload.outline?{outlineCoverage:batch.payload.outline.map((item:any)=>({requirementId:item.id,status:refs.length?'DRAFT_READY':'PLANNED',reason:refs.length?'已读取对应正文区间':'索引不能证明正文完成',evidence:refs}))}:{})};
   }
   return {text:JSON.stringify(output),provenance:{channel:'provider',producer:'MECHANICAL_STORY_PROTOCOL_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};
 }},'story-goal-test',{trustedLegacyProjectOwner:'author'});
 const saved=host.scripts.saveProject(doc,0),thread=host.conversations.open('author','script:home','story-goal-test');
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:1,
   source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},task:'WRITE',stopAfter:'BODY',objective:'机械测试：只完成指定故事范围',
   target:{unitIds:[unit.id],...(scopeKind==='node'?{structureTargets:[{unitId:unit.id,nodeId:'resolution'}]}:{wholeUnitIds:[unit.id]})},methodIds:[]},
   {resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'mechanical'})});
 for(let n=0;n<100;n++){
   const run=host.store.readRun(receipt.runId);if(run.status==='QUEUED')await host.worker.runOnce(run.id);else if(run.status==='WAITING_STEP')await host.childWorker.runOnce(run.id);else break;
 }
 const run=host.store.readRun(receipt.runId);assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));assert.equal(writes,2);assert.ok(checks>3);
 const workspace=host.workspaces.read(receipt.workspaceId,'author'),result=workspace.document.units[0].scenes.find(item=>item.id===scene.id)!;
 assert.deepEqual(result.blocks.map(block=>block.text),['人物发现证据。','人物递交证据，故事结束。']);assert.equal(result.generation?.status,'complete');
 const applications=db.prepare('SELECT count(*) n FROM script_draft_applications').get() as any;assert.equal(applications.n,2);
 assert.deepEqual(host.scripts.getProject(saved.id),saved,'saving Agent work does not implicitly publish to the author manuscript');
 if(scopeKind==='node')assert.deepEqual(workspace.document.units[0].scenes[0],saved.units[0].scenes[0]);
 const status=host.reviews.readAuthorStatus(run);assert.ok(status.storyProgress?.length);assert.ok(status.storyProgress.every(item=>item.status==='DRAFT_READY'));
 assert.ok(requests.filter(request=>request.operationKey==='draft')[1].prompt.includes('人物发现证据。'),'the second call must receive its own already-saved prior body');
 const edited=structuredClone(workspace.document);edited.brief.outline='作者在完成后另行修订，不覆盖历史验收';
 host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'after-finish',expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document:edited});
 const historical=host.reviews.readAuthorStatus(host.store.readRun(run.id));assert.equal(historical.workspaceRevision,workspace.revision);assert.equal(historical.reviewId,status.reviewId);assert.deepEqual(historical.outlineGaps,[]);
});

test('author outline revision requires explicit goal revision and refreshes only its story baseline',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_MODEL');}},'outline-revision');
 const thread=host.conversations.open('author','script:home','outline-revision'),document=createScriptProject('机械修订',createScriptCreationProfile('feature-film',1,90));
 document.brief.outline='旧结尾';
 const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
 const resolvers={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical'})};
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:1,
   source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},task:'WRITE',stopAfter:'BODY',objective:'完成本片',
   target:{unitIds:[document.units[0].id],wholeUnitIds:[document.units[0].id]},methodIds:[]},resolvers);
 const before=host.store.readRun(receipt.runId);host.store.control(before.id,'author',before.version,'pause','author-pause');
 const current=host.workspaces.read(workspace.id,'author'),edited=structuredClone(current.document);edited.brief.outline='作者决定保留另一种结尾';
 const saved=host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'author-save',expectedRevision:current.revision,expectedEpoch:current.writerEpoch,document:edited});
 const goal=host.goals.read(receipt.goalId!,'author'),run=host.store.readRun(receipt.runId);
 const next=await host.commands.submit('author',{kind:'GOAL_REVISE',requestId:'revise',threadId:thread.id,expectedConversationVersion:1,
   goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:run.version},resolvers);
 const contract=host.goals.read(next.goalId!,'author').revision.contract.value as any;
 assert.equal(contract.checks.storyCoverage.originRevision,saved.revision);
 assert.equal(contract.checks.revision,2);assert.equal(contract.scope.sharedFields.length,0,'changed baseline does not grant project outline writes');
});

test('new whole-story goal cannot freeze an empty outline via a local body rewrite',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_MODEL');}},'outline-before-body');
 const thread=host.conversations.open('author','script:home','outline-before-body'),document=createScriptProject('待规划旧片段',createScriptCreationProfile('feature-film',1,90));
 const scene=document.units[0].scenes[0];scene.blocks[0].text='作者已有一个片段';
 const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},task:'WRITE',stopAfter:'BODY',objective:'先规划再完成全片',target:{unitIds:[document.units[0].id],wholeUnitIds:[document.units[0].id]},methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
 const run=host.store.readRun(receipt.runId);
 for(const operation of ['plan_scenes','scene_plan','scene_body','append_scene_body','replace_blocks','replace_selection'] as const)assert.throws(()=>host.drafts.assertProposalTarget(run,{operation,unitId:document.units[0].id,
   ...(operation!=='plan_scenes'?{sceneId:scene.id}:{}),...(operation==='replace_blocks'?{blockIds:[scene.blocks[0].id]}:{}),
   ...(operation==='replace_selection'?{selection:{start:0,end:scene.blocks[0].text.length,text:scene.blocks[0].text}}:{})}),/先完成获准的大纲/);
 assert.doesNotThrow(()=>host.drafts.assertProposalTarget(run,{operation:'unit_outline',unitId:document.units[0].id}));
});

test('SCENES goal freezes its outline when expansion starts, so deleting the ending remains a gap',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());let proposals=0;
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   let output:unknown;
   if(request.operationKey==='draft'){proposals++;output=proposals===2?{summary:'机械分场',scenes:[{localKey:'opening',title:'发现',purpose:'发现线索',location:'门口',timeOfDay:'日'}]}:{summary:'机械纲要',content:proposals===1?'开头：发现线索。\n结尾：交付线索。':'开头：发现线索。'};}
   else{
     const parts=sections(request),goal=parts.find(part=>part.authorizationRef&&part.contract),index=parts.find(part=>part.meaning==='PLAN_INDEX_NOT_MANUSCRIPT');
     const pending=parts.find(part=>Array.isArray(part.candidates))?.candidates.find((candidate:any)=>candidate.status==='VALID'&&!candidate.appliedRevision);
     output=pending?call('script.apply_patch',{authorizationRef:goal.authorizationRef,candidateId:pending.id,expectedRevision:Number(index.workspaceRef.version),writerEpoch:index.writerEpoch}):proposals<3?
       call('script.propose',{authorizationRef:goal.authorizationRef,operation:proposals===1?'plan_scenes':'unit_outline',instruction:'机械规划',unitId:index.units[0].id,sceneId:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null}):envelope('STOP',{reason:'MECHANICAL_SOURCE_CHECK',remainingWork:['删减结尾须作者决定']});
   }
   return {text:JSON.stringify(output),provenance:{channel:'provider',producer:'MECHANICAL_OUTLINE_SOURCE_NO_EXTERNAL_MODEL'}};
 }},'planning-baseline');
 const thread=host.conversations.open('author','script:home','planning-baseline');
 const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'start',threadId:thread.id,expectedConversationVersion:1,source:{kind:'NEW',title:'机械分场',profile:createScriptCreationProfile('short-film',1,10)},task:'WRITE',stopAfter:'SCENES',objective:'完成约定故事分场',target:{initialUnit:true},methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'mechanical'})});
 for(let i=0;i<15;i++){const run=host.store.readRun(receipt.runId);if(run.status==='QUEUED')await host.worker.runOnce(run.id);else if(run.status==='WAITING_STEP')await host.childWorker.runOnce(run.id);else break;}
 const run=host.store.readRun(receipt.runId);assert.equal(run.status,'PARTIAL',JSON.stringify(run));assert.equal(proposals,3);
 const review=host.reviews.readAuthorStatus(run);assert.ok(review.outlineGaps?.some(gap=>gap.includes('约定大纲已变化')));assert.equal(review.storyProgress?.length,2);assert.ok(review.storyProgress?.some(item=>item.text.includes('结尾')));
 const original=host.goals.read(receipt.goalId!,'author'),originRevision=(original.revision.contract.value as any).checks.storyCoverage.originRevision;
 const revised=await host.commands.submit('author',{kind:'GOAL_REVISE',requestId:'change-execution',threadId:thread.id,expectedConversationVersion:host.conversations.read(thread.id,'author').version,
   goalId:original.id,expectedGoalVersion:original.version,expectedRunVersion:run.version,objective:'继续按约定故事规划，语气更克制',executionChannel:'external'},
   {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'another-mechanical-route'})});
 assert.equal((host.goals.read(original.id,'author').revision.contract.value as any).checks.storyCoverage.originRevision,originRevision,'changing wording and execution route must not accept an Agent-deleted ending');
 const remaining=host.reviews.readAuthorStatus(host.store.readRun(revised.runId));assert.ok(remaining.outlineGaps?.some(gap=>gap.includes('约定大纲已变化')));assert.ok(remaining.storyProgress?.some(item=>item.text.includes('结尾')));
});
