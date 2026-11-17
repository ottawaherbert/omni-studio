import type { PrevisWorld, ScenePrevis } from '../packages/domain/src/previs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {previsFixture} from './fixtures/previs';
import {sceneVideoClips, sceneAudioTracks} from '../src/utils/sceneVideoClips';
import {buildEpisodeAudioExportItems} from '../src/utils/episodeAudioExport';
import {observedReferenceIssue} from '../src/services/production/productionCollaboration';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omni-collaboration-'));process.env.OMNI_DB_PATH=path.join(root,'test.db');
const {db,dbHelpers}=await import('../src/server/db');
const {registerLegacyProjectRoutes}=await import('../src/server/routes/legacyProjectRoutes');
const {loadGenerationContext}=await import('../src/server/generation/context');
const {registerPrevisRoutes}=await import('../src/server/routes/previsRoutes');
const {GenerationMediaStore}=await import('../src/server/generation/media');
const {savePrevisDocument,previsSceneKey}=await import('../src/server/previsStore');
const app=express();app.use(express.json());registerLegacyProjectRoutes(app);registerPrevisRoutes(app,new GenerationMediaStore(path.join(root,'media')));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const url=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();await fs.rm(root,{recursive:true,force:true});});
function fixture(id:string){const f=previsFixture(id);f.scene.script='来访者进入庭院。';f.scene.shots![0].videoUrl='/media/original.mp4';f.scene.shots![0].duration=5;f.scene.shots![1].videoUrl='/media/second.mp4';dbHelpers.saveProject(f.project);return {...f,base:`/api/projects/${id}/episodes/${id}-episode/scenes/${id}-scene`};}
const read=(f:ReturnType<typeof fixture>)=>dbHelpers.getEpisodeById(f.project.id,f.episodes[0].id)!;
async function patch(route:string,body:unknown){const response=await fetch(url+route,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
test('one scoped save hands requirements and events to scene context without approval or revision input',async()=>{
 const f=fixture('collab-shared');
 await patch(`${f.base}/collaboration`,{direction:{requirements:[{id:'door',department:'摄影',description:'门内反打看见街道',targetIds:[f.scene.shots![0].id]}],assumptions:['只验证静态取景']},eventStates:[{id:'drop',event:'放下佩剑',entityId:'sword',before:'在手',after:'落地',shotIds:[f.scene.shots![0].id]}]});
 const before=read(f).productionRevision;
 const get=()=>fetch(url+`/api/projects/${f.project.id}/episodes/${f.episodes[0].id}/storyboard-team-context?sceneId=${f.scene.id}`).then(r=>r.json());
 const context=JSON.parse((await get()).productionTeamContext);
 assert.equal(context.productionBasis.direction.requirements[0].description,'门内反打看见街道');
 assert.equal(context.productionBasis.continuity.eventStates[0].after,'落地');
 await get();assert.equal(read(f).productionRevision,before,'context reads never schedule work or write progress');
});
test('functional asset data is saved narrowly and reaches the shared scene basis',async()=>{
 const f=fixture('collab-asset');
 await patch(`/api/projects/${f.project.id}/assets/${f.project.assets[0].id}/production-use`,{shotScale:'中近景',dimensions:'门净宽1.5米',operations:'人物可通过并转身'});
 const data=await fetch(url+`${f.base}/collaboration`).then(r=>r.json());
 assert.equal(data.productionBasis.assets[0].productionUse.operations,'人物可通过并转身');
 assert.equal(read(f).scenes[0].script,f.scene.script);
});
test('work limits survive reads and hand off without suggesting another retry',async()=>{
 const f=fixture('collab-work');
 await patch(`${f.base}/collaboration`,{workRecords:[{scopeKey:'pool',originTaskId:'original-task',reviewsUsed:1,repairsUsed:1,maxRepairs:1,lastAction:'修了池沿',nextStep:'交付现有静帧'}]});
 const a=await fetch(url+`${f.base}/collaboration`).then(r=>r.json());const before=read(f).productionRevision;
 const b=await fetch(url+`${f.base}/collaboration`).then(r=>r.json());
 assert.deepEqual(a.nextActions,b.nextActions);assert.equal(a.nextActions[0].action,'handoff');assert.equal(read(f).productionRevision,before);
 await patch(`${f.base}/collaboration`,{workRecords:[{scopeKey:'pool',originTaskId:'new-task',reviewsUsed:0,repairsUsed:0,maxRepairs:1}]});
 const kept=read(f).scenes[0].productionPreparation!.workRecords![0];assert.equal(kept.repairsUsed,1);assert.equal(kept.originTaskId,'original-task');
});
test('split, move, trim and replace edit pinned clips while narrative shots stay intact',async()=>{
 const f=fixture('collab-edit');const episode=read(f);const scene=episode.scenes[0];scene.audioTracks=[{id:'voice',type:'dialogue',url:'/media/voice.wav',shotId:scene.shots![0].id,startTime:1.2,duration:0.7}];
 scene.shots![0].takes=[{id:'new-take',videoUrl:'/media/new-take.mp4'} as any];dbHelpers.updateEpisode(f.project.id,episode.id,episode);
 const original=structuredClone(read(f).scenes[0].shots);
 const split=await patch(`${f.base}/edit`,{operation:'split',clipId:scene.shots![0].id,offsetSeconds:2});
 assert.deepEqual(split.scenes[0].shots,original);assert.equal(split.scenes[0].edit.clips.length,3);assert.equal(split.scenes[0].edit.clips[1].sourceInSeconds,2);
 const second=split.scenes[0].edit.clips[1].id;
 const moved=await patch(`${f.base}/edit`,{operation:'move',clipId:second,toIndex:0});
 assert.equal(sceneAudioTracks(moved.scenes[0])[0].startTime,4.2);
 await patch(`${f.base}/edit`,{operation:'trim',clipId:second,sourceInSeconds:3,durationSeconds:1});
 const latest=read(f);latest.scenes[0].shots![0].videoUrl='/media/changed-adoption.mp4';dbHelpers.updateEpisode(f.project.id,latest.id,latest);
 assert.equal(sceneVideoClips(read(f).scenes[0])[0].videoUrl,'/media/original.mp4');
 const replaced=await patch(`${f.base}/edit`,{operation:'replace',clipId:second,takeId:'new-take'});
 assert.equal(sceneVideoClips(replaced.scenes[0])[0].videoUrl,'/media/new-take.mp4');
 assert.equal(replaced.scenes[0].shots.length,2);
 assert.ok(buildEpisodeAudioExportItems(replaced.scenes).length);
 await patch(f.base,{shots:[{duration:2,visualAction:'重拆后的分镜'}]});
 const archivedEdit=await patch(`${f.base}/edit`,{operation:'trim',clipId:second,sourceInSeconds:0,durationSeconds:0.5});
 assert.equal(archivedEdit.scenes[0].shots.length,1);
 assert.equal(sceneVideoClips(archivedEdit.scenes[0])[0].videoUrl,'/media/new-take.mp4');
});
test('generation freezes relevant decisions, ignores notes and unrelated-shot requirements',async()=>{
 const f=fixture('collab-generation');
 const target={projectId:f.project.id,episodeId:f.episodes[0].id,sceneId:f.scene.id,kind:'shot' as const,shotIds:[f.scene.shots![0].id]};
 await patch(`${f.base}/collaboration`,{direction:{intent:'先看清空间',rhythm:'动作后反应',requirements:[{id:'other',department:'摄影',description:'只用于第二镜',targetIds:[f.scene.shots![1].id]}]}});
 const a=loadGenerationContext(target);assert.match(a.videoPrompt,/先看清空间/);assert.doesNotMatch(a.videoPrompt,/只用于第二镜/);
 await patch(`${f.base}/collaboration`,{direction:{requirements:[{id:'other',department:'摄影',description:'修改第二镜要求',targetIds:[f.scene.shots![1].id]}]},observations:[{id:'note',impact:'note',note:'远山还可丰富'}]});
 assert.equal(loadGenerationContext(target).sourceHash,a.sourceHash);
 await patch(`${f.base}/collaboration`,{direction:{intent:'先看人物反应'}});
 assert.notEqual(loadGenerationContext(target).sourceHash,a.sourceHash);
});
test('only an exact explicitly unusable reference is restricted; advice does not block',()=>{
 const f=fixture('collab-observation');f.scene.productionPreparation={schemaVersion:'production-preparation.v1',sceneId:f.scene.id,updatedAt:0,observations:[{id:'note',impact:'issue',note:'可以更丰富',mediaUrl:'/ref.png'},{id:'bad',impact:'unusable',note:'脚埋入地面',mediaUrl:'/bad.png',contentHash:'old-bytes'}]};
 assert.equal(observedReferenceIssue(f.scene,{mediaUrl:'/ref.png'},[]),undefined);
 assert.equal(observedReferenceIssue(f.scene,{mediaUrl:'/bad.png',contentHash:'new-bytes'},[]),undefined);
 assert.equal(observedReferenceIssue(f.scene,{mediaUrl:'/bad.png',contentHash:'old-bytes'},[]),'脚埋入地面');
});
test('invalid clip edits leave the current cut and original shots unchanged',async()=>{
 const f=fixture('collab-invalid');const before=read(f);
 const response=await fetch(url+`${f.base}/edit`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'split',clipId:f.scene.shots![0].id,offsetSeconds:99})});
 assert.equal(response.status,400);assert.deepEqual(read(f),before);
});


test('scoped scene and shot tools preserve other current edits without a version argument',async()=>{
 const f=fixture('collab-scoped');
 await patch(f.base,{sceneGoal:'让观众看清退路'});
 await patch(`${f.base}/shots/${f.scene.shots![0].id}`,{motivation:'确认来访者的视线',duration:1.5});
 const current=read(f).scenes[0];assert.equal(current.sceneGoal,'让观众看清退路');assert.equal(current.shots![0].motivation,'确认来访者的视线');assert.equal(current.shots![1].duration,2);
 await patch(f.base,{shots:[{duration:3,visualAction:'新的镜头草案'}]});
 assert.equal(read(f).scenes[0].shotHistory?.at(-1)?.shots.length,2);
 assert.ok(read(f).scenes[0].shots![0].id);
});

test('unit planning saves timed panels separately, preserves media and never overwrites another unit or scene overview',async()=>{
 const f=fixture('collab-units');
 const [a,b]=f.scene.shots!;
 await patch(f.base,{visualPlan:{geography:'池西南石座，东北入口',overview:{imageUrl:'/media/opening.png',shotIds:[a.id]}}});
 const plan=(shotId:string,action:string)=>({shotIds:[shotId],performanceBeat:{summary:action,startState:'剑在鞘',endState:'剑在手'},board:{layout:'2x1',panels:[
  {shotId,durationSeconds:0.5,framePurpose:'确认起点',subjectAction:'右手握住剑柄'},
  {shotId,durationSeconds:(shotId===a.id?5:2)-0.5,framePurpose:'变化结果',subjectAction:action},
 ]}});
 await Promise.all([patch(`${f.base}/storyboard-units/u1`,plan(a.id,'拔剑')),patch(`${f.base}/storyboard-units/u2`,plan(b.id,'将剑放低'))]);
 let saved=read(f);let scene=saved.scenes[0];
 assert.equal(scene.manualStoryboard!.boards!.length,2);
 const first=scene.manualStoryboard!.boards!.find(unit=>unit.id==='u1')!;
 const second=scene.manualStoryboard!.boards!.find(unit=>unit.id==='u2')!;
 assert.deepEqual(first.board!.panels.map(p=>p.durationSeconds),[0.5,4.5]);
 assert.equal(first.board!.visualReferenceMode,'director_board');
 assert.notEqual(first.board!.visualPages![0].id,second.board!.visualPages![0].id);
 assert.equal(first.board!.continuityBasis!.geography,'池西南石座，东北入口');
 // Fixture an already saved candidate; plan editing must not erase or adopt it.
 const page=first.board!.visualPages![0];page.visualTakes=[{id:'old-candidate',imageUrl:'/media/old.png',status:'candidate',sourceHash:'old'} as any];
 dbHelpers.updateEpisode(f.project.id,saved.id,{...saved,__requireProductionRevision:true} as any);
 const beforeContext=loadGenerationContext({projectId:f.project.id,episodeId:saved.id,sceneId:scene.id,kind:'board',boardId:second.board!.id,pageId:second.board!.visualPages![0].id,shotIds:[b.id]});
 await patch(`${f.base}/storyboard-units/u1`,{board:{endState:'右手持剑，空鞘留在腰间'}});
 scene=read(f).scenes[0];
 assert.deepEqual(scene.manualStoryboard!.boards!.find(unit=>unit.id==='u2'),second);
 const changed=scene.manualStoryboard!.boards!.find(unit=>unit.id==='u1')!;
 assert.deepEqual(changed.board!.visualPages![0].visualTakes,page.visualTakes);
 assert.equal(changed.board!.visualPages![0].activeVisualTakeId,undefined);
 assert.equal(scene.visualPlan!.overview!.imageUrl,'/media/opening.png');
 assert.deepEqual(scene.manualStoryboard!.unitHistory!.at(-1)!.boards[0],first);
 const afterContext=loadGenerationContext(beforeContext.target);assert.equal(afterContext.sourceHash,beforeContext.sourceHash);
 const count=scene.manualStoryboard!.unitHistory!.length;
 await patch(`${f.base}/storyboard-units/u1`,{board:{endState:'右手持剑，空鞘留在腰间'}});
 assert.equal(read(f).scenes[0].manualStoryboard!.unitHistory!.length,count,'same plan does not append duplicate history');
});

test('multi-shot units preserve authored timing and reject invalid membership or injected adoption',async()=>{
 const f=fixture('collab-unit-validation');const [a,b]=f.scene.shots!;
 b.characterIdsInShot=[];dbHelpers.saveProject(f.project);
 const body={shotIds:[a.id,b.id],board:{layout:'2x2',panels:[
  {shotId:a.id,durationSeconds:0.7,framePurpose:'建立',subjectAction:'走近'},
  {shotId:a.id,durationSeconds:4.3,framePurpose:'动作',subjectAction:'停下'},
  {shotId:b.id,durationSeconds:2,framePurpose:'反应',subjectAction:'抬头'},
 ]}};
 await patch(`${f.base}/storyboard-units/group`,body);
 const before=read(f);const unit=before.scenes[0].manualStoryboard!.boards![0];
 assert.deepEqual(unit.board!.panels.map(p=>p.shotId),[a.id,a.id,b.id]);
 assert.ok(unit.board!.panels[0].assetRefs.includes(f.project.characters[0].id));
 assert.ok(!unit.board!.panels[2].assetRefs.includes(f.project.characters[0].id),'an absent actor from another shot is not copied into this panel');
 assert.equal(unit.performanceBeat!.durationSeconds,7);assert.deepEqual(unit.shotIds,[a.id,b.id]);
 for(const invalid of [
  {shotIds:['missing']}, {shotIds:[a.id,a.id]}, {activeTakeId:'fake'},
  {board:{visualPages:[{activeVisualTakeId:'fake'}]}},
  {board:{panels:body.board.panels.map((p,i)=>i? p:{...p,durationSeconds:5})}},
  {board:{panels:body.board.panels.map((p,i)=>i? p:{...p,activeVisualTakeId:'fake'})}},
 ]) {
  const response=await fetch(url+`${f.base}/storyboard-units/group`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)});
  assert.equal(response.status,400,JSON.stringify(invalid));assert.deepEqual(read(f),before);
 }
});


test('world and staging scoped edits preserve current geometry and camera fields without storage tokens',async()=>{
 const f=fixture('collab-spatial');
 const {ProductionQuality}=await import('../src/server/productionQuality'),{GenerationStore}=await import('../src/server/generation/store'),{reviewFixtureStage}=await import('./helpers/productionQualityFixture');
 await reviewFixtureStage(new ProductionQuality(new GenerationStore(db),path.join(root,'media')),'project_plan',{projectId:f.project.id});
 savePrevisDocument<PrevisWorld>(f.project.id,'world',{plan:f.world},0);
 savePrevisDocument<ScenePrevis>(f.project.id,previsSceneKey(f.episodes[0].id,f.scene.id),{plan:f.plan,exports:[]},0);
 const worldPath=`/api/production/previs/${f.project.id}`;
 await patch(worldPath,{objects:[{id:'wall-west',position:[-6.1,0,-2]}]});
 const world=await patch(worldPath,{objects:[{id:'column',position:[4.1,0,-2]}]});
 assert.equal(world.world.plan.objects.find((o:any)=>o.id==='wall-west').position[0],-6.1);
 const scope=`${worldPath}/${f.episodes[0].id}/${f.scene.id}`;
 const staged=await patch(scope,{frames:[{id:'wide-start',camera:{focalLength:35}}]});
 assert.equal(staged.document.plan.frames[0].camera.focalLength,35);
 assert.deepEqual(staged.document.plan.frames[0].camera.position,f.plan.frames[0].camera.position);
 assert.equal(staged.document.plan.frames.length,f.plan.frames.length);
 assert.equal(staged.document.plan.objects.length,f.plan.objects.length);
});

test('a count-only work update preserves the agreed limit and next step',async()=>{
 const f=fixture('audit-work');await patch(`${f.base}/collaboration`,{workRecords:[{scopeKey:'pool',reviewsUsed:0,repairsUsed:0,maxRepairs:1,nextStep:'交付作者'}]});
 await patch(`${f.base}/collaboration`,{workRecords:[{scopeKey:'pool',reviewsUsed:1,repairsUsed:1}]});
 const state=await fetch(url+`${f.base}/collaboration`).then(r=>r.json());assert.equal(state.workRecords[0].maxRepairs,1);assert.equal(state.nextActions[0].description,'交付作者');
 await patch(`${f.base}/collaboration`,{workRecords:[{scopeKey:'pool',reviewsUsed:1,repairsUsed:1,maxRepairs:null}]});
 const cleared=await fetch(url+`${f.base}/collaboration`).then(r=>r.json());assert.equal(cleared.nextActions[0].action,'continue','explicitly clearing a limit is different from omitting it');
});
test('generation receives scoped beat facts and vehicle needs without later-beat contamination',async()=>{
 const f=fixture('audit-beats');const ep=read(f),s=ep.scenes[0];
 s.breakdown={...s.breakdown,beats:[{id:'enter',action:'推门进入',visibleChange:'门由关到开'},{id:'escape',action:'后来逃离'}]} as any;
 s.shots[0].beatIds=['enter'];s.shots[1].beatIds=['escape'];s.shots[0].vehicleIds=['cart'];
 dbHelpers.updateEpisode(f.project.id,ep.id,ep);
 dbHelpers.updateProjectMeta(f.project.id,{assets:[...f.project.assets,{id:'cart',name:'马车',type:'vehicles',productionUse:{operations:'可从车尾登车'}}]});
 await patch(`${f.base}/collaboration`,{direction:{requirements:[{id:'later',department:'摄影',description:'逃离时才使用烟雾',beatIds:['escape']},{id:'door',department:'美术',description:'门把手可转动',beatIds:['enter']}],beatDirections:[{beatId:'escape',intent:'逃离要急促'},{beatId:'enter',intent:'进门要迟疑'}]}});
 const ctx=loadGenerationContext({projectId:f.project.id,episodeId:ep.id,sceneId:s.id,kind:'shot',shotIds:[s.shots[0].id]});
 assert.match(ctx.videoPrompt,/门由关到开/);assert.match(ctx.videoPrompt,/可从车尾登车/);assert.doesNotMatch(ctx.videoPrompt,/逃离时才使用烟雾|逃离要急促/);
});
test('duplicate shot identities are rejected without losing narrative or archive data',async()=>{
 const f=fixture('audit-duplicate');const before=read(f);
 const response=await fetch(url+f.base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({shots:[{id:'duplicate',duration:1},{id:'duplicate',duration:2}]})});
 assert.equal(response.status,400);assert.deepEqual(read(f),before);
});

test('the real preparation read model exposes saved requirements and roundtrips without dropping storyboard media',async()=>{
 const f=fixture('audit-preparation');await patch(`${f.base}/collaboration`,{direction:{intent:'看清出入口',requirements:[{id:'door',department:'摄影',description:'门内反打'}]}});
 const ep=read(f);ep.scenes[0].manualStoryboard!.boards=[{id:'keep-board',shotId:ep.scenes[0].shots[0].id,takes:[{id:'keep-take',videoUrl:'/keep.mp4'}]} as any];dbHelpers.updateEpisode(f.project.id,ep.id,ep);
 const projected=dbHelpers.getEpisodeById(f.project.id,ep.id,'production-preparation',f.scene.id)!;
 assert.equal(projected.scenes[0].manualStoryboard?.directorPlan?.requirements?.[0].description,'门内反打');
 assert.equal(projected.scenes[0].manualStoryboard?.boards,undefined,'the preparation view does not fetch heavy media payloads');
 projected.scenes[0].title='只修改标题';dbHelpers.updateEpisode(f.project.id,ep.id,projected);
 assert.equal(read(f).scenes[0].manualStoryboard!.boards![0].takes![0].videoUrl,'/keep.mp4');
});

test('asset use partial saves retain current other fields and feed actual asset generation',async()=>{
 const f=fixture('audit-asset-use');const assetId=f.project.assets[0].id;
 await patch(`/api/projects/${f.project.id}/assets/${assetId}/production-use`,{shotScale:'远景',operations:'大门可推开'});
 await patch(`/api/projects/${f.project.id}/assets/${assetId}/production-use`,{shotScale:'近景'});
 const project=dbHelpers.getProjectById(f.project.id)!;assert.equal(project.assets[0].productionUse?.operations,'大门可推开');
 const {buildVideoStoryboardAssetBoardPlan}=await import('../src/services/production/videoStoryboardAssetBoards');
 const board=buildVideoStoryboardAssetBoardPlan(project).sceneBoards[0];
 const ctx=loadGenerationContext({projectId:f.project.id,kind:'asset',assetId:board.id,shotIds:[]});assert.match(ctx.prompt,/大门可推开/);
});

test('asset generation uses the selected clean layout and preserves authored briefs without falling back to a production sheet',async()=>{
 const f=fixture('audit-asset-layout');
 f.project.assets.push({id:'sword',name:'佩剑',type:'prop',description:'黑柄银刃，完整剑鞘'} as any);
 dbHelpers.saveProject(f.project);
 const {buildVideoStoryboardAssetBoardPlan}=await import('../src/services/production/videoStoryboardAssetBoards');
 const {buildProductionAssetBoardPromptPreview}=await import('../src/services/production/productionAssetBoardExecution');
 const project=dbHelpers.getProjectById(f.project.id)!;
 const boards=buildVideoStoryboardAssetBoardPlan(project);
 for(const board of [boards.sceneBoards[0],boards.propBoards[0]]){
  const target={projectId:f.project.id,kind:'asset' as const,assetId:board.id,shotIds:[]};
  const clean=loadGenerationContext({...target,referenceMode:'clean_reference'});
  assert.equal(clean.prompt,buildProductionAssetBoardPromptPreview(project,board,'clean_reference'));
  assert.equal(loadGenerationContext(target).prompt,clean.prompt,'default generation and UI use the same clean layout');
  const production=loadGenerationContext({...target,referenceMode:'production_board'});
  assert.equal(production.prompt,buildProductionAssetBoardPromptPreview(project,board,'production_board'));
  assert.notEqual(clean.prompt,production.prompt);
  if(board.assetType==='location')assert.match(clean.prompt,/输出一张完整的空场主视图，不做拼贴/);
 }
 project.assets.find(a=>a.id==='sword')!.cleanReferencePrompt='一把佩剑与一个剑鞘，单一角度，白色背景。';
 dbHelpers.updateProjectMeta(project.id,{assets:project.assets});
 const target={projectId:project.id,kind:'asset' as const,assetId:boards.propBoards[0].id,shotIds:[],referenceMode:'clean_reference' as const};
 const saved=loadGenerationContext(target);
 assert.match(saved.prompt,/一把佩剑与一个剑鞘，单一角度/);
 assert.match(saved.prompt,/黑柄银刃，完整剑鞘/,'current identity accompanies the author brief');
 assert.doesNotMatch(saved.prompt,/纯净多视图|剧情涉及的操作部位/,'no competing fallback layout is added');
});

test('shot-to-event links scope both image and video prompts without leaking later action',async()=>{
 const f=fixture('audit-event-links');await patch(`${f.base}/collaboration`,{eventStates:[{id:'open',event:'推开门',entityId:'door',before:'关闭',after:'打开'},{id:'shatter',event:'随后破门',entityId:'door',before:'完整',after:'碎裂'}]});
 await patch(`${f.base}/shots/${f.scene.shots[0].id}`,{eventIds:['open']});await patch(`${f.base}/shots/${f.scene.shots[1].id}`,{eventIds:['shatter']});
 const ctx=loadGenerationContext({projectId:f.project.id,episodeId:f.episodes[0].id,sceneId:f.scene.id,kind:'shot',shotIds:[f.scene.shots[0].id]});
 for(const prompt of [ctx.prompt,ctx.videoPrompt]){assert.match(prompt,/推开门/);assert.doesNotMatch(prompt,/随后破门/);}
});

test('scoped script edits replace the actual readable source, including scenes with text blocks',async()=>{
 const f=fixture('audit-script');await patch(f.base,{scriptBlocks:[{id:'b',type:'action',content:'旧剧本'}]});
 await patch(f.base,{script:'新剧本'});
 const {manualFilmTeamSceneSource}=await import('../src/services/production/manualFilmTeam');
 assert.equal(manualFilmTeamSceneSource(read(f).scenes[0]).text,'新剧本');
 await patch(f.base,{scriptBlocks:[{id:'b2',type:'action',content:'最新分块剧本'}]});assert.equal(read(f).scenes[0].script,'最新分块剧本');
});
test('partial visual plans retain working defaults and malformed shot links never poison saved data',async()=>{
 const f=fixture('audit-shapes');await patch(f.base,{visualPlan:{lighting:'日光'}});
 const ctx=await fetch(url+`${f.base}/collaboration`);assert.equal(ctx.status,200);assert.equal(read(f).scenes[0].visualPlan?.references.length,0);
 const before=read(f);const response=await fetch(url+`${f.base}/shots/${f.scene.shots[0].id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({beatIds:'not-an-array'})});
 assert.equal(response.status,400);assert.deepEqual(read(f),before);
});

test('replacing a clip with a multi-shot take uses that shot source range instead of the first shot',async()=>{
 const f=fixture('audit-replace-unit');const ep=read(f),s=ep.scenes[0];
 s.manualStoryboard={schemaVersion:'manual-storyboard.v1',updatedAt:1,boards:[{id:'unit',unitSchema:'storyboard_unit.v1',shotId:s.shots[0].id,shotIds:s.shots.map(shot=>shot.id),updatedAt:1,takes:[{id:'unit-take',videoUrl:'/unit.mp4',createdAt:1}]}]};dbHelpers.updateEpisode(f.project.id,ep.id,ep);
 await patch(`${f.base}/edit`,{operation:'replace',clipId:s.shots[1].id,takeId:'unit-take'});
 assert.equal(read(f).scenes[0].edit!.clips[1].sourceInSeconds,5);
 await patch(f.base,{shots:[{duration:1,visualAction:'新分镜'}]});
 await patch(`${f.base}/edit`,{operation:'replace',clipId:s.shots[1].id,takeId:'unit-take'});
 assert.equal(read(f).scenes[0].edit!.clips[1].sourceInSeconds,5,'archived unit timing remains usable');
});
