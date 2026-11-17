import { renderLocationSpatialAnchor } from '../src/services/production/locationViews';
import { mergeShotAuthorDraft, buildManualShotPlanHash } from '../src/services/production/manualStoryboard';
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Project, Episode, Shot, LocationSupplementaryView } from '../src/types/project';
import { buildVideoStoryboardAssetBoardPlan } from '../src/services/production/videoStoryboardAssetBoards';
import { buildProductionAssetBoardPromptUpdate } from '../src/services/production/productionAssetBoardProfile';
import { buildProductionAssetBoardPromptPreview, productionAssetBoardPromptCore } from '../src/services/production/productionAssetBoardExecution';
import { stageProductionAssetBoardReferenceCandidate, adoptProductionAssetBoardReferenceCandidate, returnProductionAssetBoardReferenceCandidateToReview } from '../src/services/production/productionAssetBoardCandidate';
import { locationViewCurrentIssue, locationViewInputIssue, locationViewSourceHash } from '../src/services/production/locationViews';
import { buildManualProductionAssetReadModel } from '../src/services/production/manualProductionAssets';
import { selectStoryboardCompositeBoardReferences } from '../src/services/production/storyboardCompositeBoard';
import { locationViewBoards } from '../src/services/production/locationViewReferences';
import { fixtureDirectorPlan, reviewFixtureStage, reviewFixturePreparation } from './helpers/productionQualityFixture';
import { defaultAIConfig } from '../src/config/aiConfigDefaults';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-location-views-'));
process.env.OMNI_DB_PATH = path.join(directory, 'fixture.db');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { loadGenerationContext } = await import('../src/server/generation/context');
const { GenerationEngine } = await import('../src/server/generation/engine');
const { GenerationStore } = await import('../src/server/generation/store');
const { registerProductionCollaborationRoutes } = await import('../src/server/routes/productionCollaborationRoutes');
const { registerProductionAssetBoardCandidateRoutes } = await import('../src/server/routes/productionAssetBoardCandidateRoutes');
after(() => db.close());
afterEach(() => { for (const row of db.prepare('SELECT id FROM projects').all() as {id:string}[]) dbHelpers.deleteProject(row.id); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4QAAAABJRU5ErkJggg==','base64');
for (const name of ['main','reverse','oblique','top','night-main','night-reverse']) await fs.writeFile(path.join(directory, `${name}.png`), png);
const fixture = (): Project => ({ id: randomUUID(), title:'场景视角隔离夹具', logline:'空间视角测试', coreConflict:'仅用于协议验证', type:'movie', aspectRatio:'16:9', characters:[], assets:[{ id:'room', type:'location', name:'客厅', description:'窗在东墙，长桌靠北墙，南墙设门。', cleanReferenceImageUrl:'/media/main.png', variants:[{id:'night',name:'夜间',description:'同一客厅夜间开灯',cleanReferenceImageUrl:'/media/night-main.png'}]}], episodes:[{id:'episode',title:'本集',scenes:[{id:'scene',title:'客厅对话',script:'人物观察桌子。',manualStoryboard:{directorPlan:fixtureDirectorPlan()},shots:[{id:'shot',locationId:'room',duration:3,visualAction:'观察桌子',editingNote:'目光落定停顿后切出',imagePrompt:'客厅空场',locationReferenceViews:['reverse']}]}]}] } as unknown as Project);
const viewBoard = (p:Project, view:LocationSupplementaryView, variantId?:string) => buildVideoStoryboardAssetBoardPlan(p).sceneViewBoards.find(b=>b.locationView===view&&b.variantId===variantId)!;
function stage(p:Project, view:LocationSupplementaryView, variantId?:string) {
  const board=viewBoard(p,view,variantId), candidateId=randomUUID();
  return { candidateId, project:{...p,...stageProductionAssetBoardReferenceCandidate({project:p,candidateId,boardItemId:board.id,imageUrl:`/media/${variantId ? variantId+'-' : ''}${view}.png`,source:'upload',referenceMode:'clean_reference',finalPrompt:board.cleanPrompt || ''})} };
}
function adopt(p:Project,view:LocationSupplementaryView,variantId?:string) {
  const candidate=stage(p,view,variantId);
  return {...candidate.project,...adoptProductionAssetBoardReferenceCandidate({project:candidate.project,candidateId:candidate.candidateId})};
}
const full = () => adopt(adopt(adopt(fixture(),'reverse'),'oblique'),'top');
const target = (p:Project,view:LocationSupplementaryView) => ({projectId:p.id,kind:'asset' as const,assetId:viewBoard(p,view).id,referenceMode:'clean_reference' as const,shotIds:[]});
const shotTarget = (p:Project) => ({projectId:p.id,episodeId:'episode',sceneId:'scene',kind:'shot' as const,shotIds:['shot']});
const config = (count=3) => ({...structuredClone(defaultAIConfig), channels:[{id:'mock',name:'隔离测试',type:'comfyui',baseUrl:'https://fixture.invalid',apiKey:''}],
  models:[{id:'image',channelId:'mock',modelId:'qwen',alias:'联合图片',capabilities:['image'],comfyWorkflowId:'flow'}],
  comfyWorkflows:[{id:'flow',name:'测试图片',channelId:'mock',kind:'api_graph',
    workflowJson:{'1':{class_type:'TextEncodeQwenImage21',inputs:{prompt:'',...Object.fromEntries(Array.from({length:count},(_,i)=>[`images.image_${i+1}`,[String(90+i),0]]))}},'2':{class_type:'EmptyLatentImage',inputs:{width:512,height:288}},...Object.fromEntries(Array.from({length:count},(_,i)=>[String(90+i),{class_type:'LoadImage',inputs:{image:'input.png'}}]))},
    mappings:[{systemParam:'prompt',nodeId:'1',nodeInput:'prompt'},{systemParam:'width',nodeId:'2',nodeInput:'width'},{systemParam:'height',nodeId:'2',nodeInput:'height'},...Array.from({length:count},(_,i)=>({systemParam:`image:${i}`,nodeId:String(90+i),nodeInput:'image'}))],
    api:{operation:'i2i',imageInputs:count,videoInputs:0,audioInputs:0,nativeAudio:false,minDuration:1,maxDuration:15}}]} as any);

test('view candidates stay on the same asset; states and independent siblings remain isolated', () => {
  let p=fixture();
  assert.equal(buildVideoStoryboardAssetBoardPlan(p).sceneBoards.length,1);
  assert.equal(buildVideoStoryboardAssetBoardPlan(p).sceneViewBoards.length,6);
  assert.match(locationViewInputIssue(p,p.assets[0],'top')!,/反向/);
  const reverseHash=locationViewSourceHash(p,p.assets[0],'reverse');
  p=adopt(p,'reverse');
  assert.equal(locationViewSourceHash(p,p.assets[0],'reverse'),reverseHash,'own output does not invalidate its source');
  assert.equal(locationViewCurrentIssue(p,p.assets[0],'reverse'),undefined);
  const reverse=structuredClone(p.assets[0].locationViews!.reverse);
  p=adopt(p,'oblique');p=adopt(p,'top');p=adopt(p,'reverse','night');
  assert.deepEqual(p.assets[0].locationViews!.reverse,reverse);
  assert.equal(p.assets[0].cleanReferenceImageUrl,'/media/main.png');
  assert.equal(p.assets[0].variants![0].cleanReferenceImageUrl,'/media/night-main.png');
  assert.equal(p.assets[0].variants![0].locationViews!.reverse!.imageUrl,'/media/night-reverse.png');
  assert.equal(locationViewCurrentIssue(p,p.assets[0],'top'),undefined);
  p.assets[0].cleanReferenceImageUrl='/media/replacement.png';
  assert.match(locationViewCurrentIssue(p,p.assets[0],'reverse')!,/变化/);
  assert.match(locationViewCurrentIssue(p,p.assets[0],'top')!,/反向/);
  assert.equal(locationViewCurrentIssue(p,p.assets[0],'reverse','night'),undefined,'base replacement cannot invalidate a separate night main');
});

test('stale pending candidates cannot overwrite current references; rejection only clears its own view', () => {
  const staged=stage(fixture(),'reverse');
  staged.project.assets[0].cleanReferenceImageUrl='/media/new-main.png';
  assert.throws(()=>adoptProductionAssetBoardReferenceCandidate({project:staged.project,candidateId:staged.candidateId}),/来源已变化/);
  const p=full(), reverse=p.manualProductionAssets!.references.find(r=>r.locationView==='reverse')!;
  const next={...p,...returnProductionAssetBoardReferenceCandidateToReview({project:p,candidateId:reverse.candidateId!,reviewer:'creator',notes:'门窗不符'})};
  assert.equal(next.assets[0].cleanReferenceImageUrl,p.assets[0].cleanReferenceImageUrl);
  assert.equal(next.assets[0].locationViews!.reverse!.imageUrl,undefined);
  assert.equal(next.assets[0].locationViews!.oblique!.imageUrl,p.assets[0].locationViews!.oblique!.imageUrl);
  assert.match(locationViewCurrentIssue(next,next.assets[0],'top')!,/反向/);
});

test('editing a view prompt is stable and does not change the main or a state prompt',()=>{
  const p=fixture(),board=viewBoard(p,'reverse'),preview=buildProductionAssetBoardPromptPreview(p,board,'clean_reference');
  const next={...p,...buildProductionAssetBoardPromptUpdate({project:p,assetId:'room',locationView:'reverse',prompt:productionAssetBoardPromptCore(preview,p,board),referenceMode:'clean_reference'})};
  assert.equal(buildProductionAssetBoardPromptPreview(next,viewBoard(next,'reverse'),'clean_reference'),preview);
  assert.equal(next.assets[0].cleanReferencePrompt,p.assets[0].cleanReferencePrompt);
});

test('storyboard references follow per-shot view and state selection; missing views never fall back',()=>{
  const p=full(),episode=p.episodes[0] as Episode,scene=episode.scenes[0],shot=scene.shots[0];
  const assets=buildManualProductionAssetReadModel({project:p,episode,scene});
  const board={panels:[{shotId:shot.id,assetRefs:['room']}],shotIds:[shot.id]} as any;
  const selected=selectStoryboardCompositeBoardReferences({project:p,board,shots:[shot],assets}).selected;
  assert.deepEqual(selected.map(r=>r.referenceImageUrl),['/media/reverse.png']);
  shot.locationReferenceViews=['reverse','top'];
  assert.deepEqual(selectStoryboardCompositeBoardReferences({project:p,board,shots:[shot],assets}).selected.map(r=>r.locationView),['reverse','top']);
  const sameViewShots=[shot,{...shot,id:'second'}];
  assert.equal(locationViewBoards(p,sameViewShots,assets.assetBoards).filter(b=>b.locationView==='reverse').length,1,'shared location views only consume one input slot');
  const stateShot={...shot,locationReferenceViews:['reverse'],appearance:{analysis:'reviewed',states:[{assetId:'room',assetName:'客厅',decision:'accepted',start:{timeOfDay:'夜晚'},end:{timeOfDay:'夜晚'},imageMoment:'start',startVariantId:'night',endVariantId:'night',referenceNeed:'image'}]}} as unknown as Shot;
  const missing=locationViewBoards(p,[stateShot],assets.assetBoards).find(r=>r.locationView==='reverse')!;
  assert.equal(missing.variantId,'night');assert.equal(missing.referenceImageUrl,undefined);assert.match(missing.locationViewIssue!,/尚未采用/);
  p.assets[0].variants![0].cleanReferenceImageUrl=undefined;
  const missingStateMain=locationViewBoards(p,[stateShot],assets.assetBoards).find(r=>r.locationView==='reverse')!;
  assert.equal(missingStateMain.variantId,'night');assert.equal(missingStateMain.referenceImageUrl,undefined,'a missing state main must not substitute the base reverse view');
});

test('real context supplies all three top-view inputs and retains source identity after its adoption',()=>{
  let p=adopt(adopt(fixture(),'reverse'),'oblique');dbHelpers.saveProject(p);
  const t=target(p,'top'),before=loadGenerationContext(t);
  assert.deepEqual(before.references.filter(r=>r.enabled).map(r=>r.locationView),['main','reverse','oblique']);
  assert.equal(before.requiredLocationReferenceIds?.length,3);
  p=adopt(p,'top');dbHelpers.updateProjectMeta(p.id,{assets:p.assets,manualProductionAssets:p.manualProductionAssets});
  assert.equal(loadGenerationContext(t).sourceHash,before.sourceHash);
  dbHelpers.updateProjectMeta(p.id,{assets:[...p.assets,{id:'elsewhere',type:'location',name:'别处',imageUrl:'/media/other.png'}]});
  assert.equal(loadGenerationContext(t).sourceHash,before.sourceHash,'unrelated assets must not invalidate the view');
  const shot=loadGenerationContext(shotTarget(p));
  assert.deepEqual(shot.references.filter(r=>r.enabled&&r.sourceAssetId).map(r=>r.locationView),['reverse']);
});

test('real engine freezes dependencies, blocks removed references and detects a changed main before dispatch',async()=>{
  const p=full();dbHelpers.saveProject(p);
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(),directory);
  await reviewFixtureStage(engine.quality,'project_plan',{projectId:p.id});
  let task=engine.create({target:target(p,'top'),operation:'asset_image',commandId:randomUUID()});
  engine.updatePolicy(p.id,{allowExperimental:true},engine.store.policy(p.id).revision);
  const checked=await engine.preflight(task.id,task.revision);
  assert.ok(checked.plan,JSON.stringify(checked.issues));
  assert.deepEqual(checked.plan.references.map(r=>r.locationView),['main','reverse','oblique']);
  assert.ok(checked.plan.references.every(r=>r.contentHash),'preflight freezes actual reference bytes');
  task=engine.update(task.id,{expectedRevision:task.revision,patch:{references:task.references.map(r=>({...r,enabled:r.locationView!=='oblique'}))}});
  const missing=await engine.preflight(task.id,task.revision);
  assert.ok(missing.issues.some(i=>i.code==='LOCATION_VIEW_REQUIRED'));
  const current=dbHelpers.getProjectById(p.id)!;current.assets[0].cleanReferenceImageUrl='/media/changed.png';dbHelpers.updateProjectMeta(p.id,{assets:current.assets});
  assert.throws(()=>engine.assertAllowed(checked.plan!),/来源已变化/);
});

test('insufficient model capacity cannot silently discard a required top-view input',async()=>{
  const p=full();dbHelpers.saveProject(p);
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(2),directory);
  await reviewFixtureStage(engine.quality,'project_plan',{projectId:p.id});
  const task=engine.create({target:target(p,'top'),operation:'asset_image',commandId:randomUUID()});
  assert.equal(task.references.filter(r=>r.enabled).length,2);
  const result=await engine.preflight(task.id,task.revision);
  assert.equal(result.plan,undefined);assert.ok(result.issues.some(i=>i.code==='LOCATION_VIEW_REQUIRED'&&i.message.includes('容量不足')));
});

test('mock provider output registers as a view candidate and adopts through the existing generation review',async()=>{
  const p=fixture();dbHelpers.saveProject(p);
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(),directory);
  await reviewFixtureStage(engine.quality,'project_plan',{projectId:p.id});
  engine.updatePolicy(p.id,{allowExperimental:true},engine.store.policy(p.id).revision);
  const task=engine.create({target:target(p,'reverse'),operation:'asset_image',commandId:randomUUID()});
  const checked=await engine.preflight(task.id,task.revision);assert.ok(checked.plan,JSON.stringify(checked.issues));
  engine.providers.submit=async(plan)=>{assert.equal(plan.references.length,1);assert.equal(plan.references[0].locationView,'main');return {providerTaskId:'mock'};};
  engine.providers.poll=async()=>({status:'succeeded',outputs:[{url:'/media/reverse.png',kind:'image'}]});
  engine.media.inspect=async()=>({width:1,height:1,durationSeconds:undefined});
  const execution=engine.submit(checked.plan.id,checked.plan.planHash,undefined,randomUUID());await engine.process(execution.id);
  const done=engine.execution(execution.id);assert.equal(done.status,'succeeded',done.error);assert.ok(done.results[0].candidateId);
  const reviewed=engine.review(done.id,done.results[0].id,'adopted',undefined,'隔离协议夹具：视角候选采用路径，非作品验收。');
  assert.equal(reviewed.results[0].review,'adopted');
  const saved=dbHelpers.getProjectById(p.id)!;assert.equal(saved.assets[0].cleanReferenceImageUrl,'/media/main.png');assert.ok(saved.assets[0].locationViews!.reverse!.imageUrl);
  assert.equal(locationViewCurrentIssue(saved,saved.assets[0],'reverse'),undefined);
});

test('selected missing views block preflight and preparation; top references cannot become first frames',async()=>{
  const p=full();(p.episodes[0] as Episode).scenes[0].shots[0].locationReferenceViews=['top'];dbHelpers.saveProject(p);
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(),directory);
  await reviewFixturePreparation(engine.quality,shotTarget(p));
  let task=engine.create({target:shotTarget(p),operation:'asset_image',commandId:randomUUID()});
  task=engine.update(task.id,{expectedRevision:task.revision,patch:{references:task.references.map(r=>({...r,role:'first_frame',locationView:undefined}))}});
  const result=await engine.preflight(task.id,task.revision);
  assert.ok(result.issues.some(i=>i.code==='LOCATION_VIEW_ROLE'));
  const episode=dbHelpers.getEpisodeById(p.id,'episode')!;episode.scenes[0].shots[0].locationReferenceViews=['reverse'];
  dbHelpers.updateEpisode(p.id,episode.id,episode);
  const current=dbHelpers.getProjectById(p.id)!;current.assets[0].locationViews!.reverse=undefined;dbHelpers.updateProjectMeta(p.id,{assets:current.assets});
  const missing=engine.create({target:shotTarget(p),operation:'asset_image',commandId:randomUUID()});
  assert.ok((await engine.preflight(missing.id,missing.revision)).issues.some(i=>i.code==='LOCATION_VIEW_NOT_READY'));
  await assert.rejects(engine.quality.inspect('preparation',shotTarget(p)),/未通过|正式资产图/);
});

test('author editor saves selected views without reverting concurrently arriving media',()=>{
  const shot=(fixture().episodes[0] as Episode).scenes[0].shots[0];
  const current={...shot,imageUrl:'/media/new-frame.png'};
  const saved=mergeShotAuthorDraft(shot,{...shot,locationReferenceViews:['reverse','top']},current);
  assert.deepEqual(saved.changedKeys,['locationReferenceViews']);assert.deepEqual(saved.shot.locationReferenceViews,['reverse','top']);
  assert.equal(saved.shot.imageUrl,current.imageUrl);assert.notEqual(buildManualShotPlanHash([saved.shot]),buildManualShotPlanHash([shot]));
  assert.throws(()=>mergeShotAuthorDraft(shot,{locationReferenceViews:['top']},{...current,locationReferenceViews:['oblique']}),/草稿仍保留/);
});

test('HTTP shot editing validates views and imported view adoption persists without replacing the main',async()=>{
  const p=fixture();dbHelpers.saveProject(p);const staged=stage(p,'reverse');dbHelpers.updateProjectMeta(p.id,{manualProductionAssets:staged.project.manualProductionAssets});
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(),directory);await reviewFixtureStage(engine.quality,'project_plan',{projectId:p.id});
  const app=express();app.use(express.json());registerProductionCollaborationRoutes(app);registerProductionAssetBoardCandidateRoutes(app,directory);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/projects/${p.id}`;
  try {
    const patch=async(value:unknown)=>fetch(url+'/episodes/episode/scenes/scene/shots/shot',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationReferenceViews:value})});
    assert.equal((await patch(['reverse','top'])).status,200);assert.deepEqual(dbHelpers.getEpisodeById(p.id,'episode')!.scenes[0].shots[0].locationReferenceViews,['reverse','top']);
    assert.equal((await patch(['reverse','reverse'])).status,400);assert.equal((await patch(['wrong'])).status,400);
    const response=await fetch(url+`/production-asset-board-candidates/${staged.candidateId}/adopt`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200,await response.text());
    const stored=dbHelpers.getProjectById(p.id)!;assert.equal(stored.assets[0].cleanReferenceImageUrl,'/media/main.png');assert.equal(stored.assets[0].locationViews!.reverse!.imageUrl,'/media/reverse.png');
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test('spatial anchors are explicit, inherited by states and refreshed around saved image prompts',()=>{
  let p=fixture();
  p.assets[0].locationSpatialAnchor={layout:'北墙书柜，东窗西门',cameras:{main:{position:'南侧平视',lookAt:'北墙书柜'},oblique:{position:'东北角平视',lookAt:'西南侧入口'}}};
  let b=viewBoard(p,'oblique');
  let prompt=buildProductionAssetBoardPromptPreview(p,b,'clean_reference');
  assert.match(prompt,/摄影机位置=东北角平视；朝向\/拍摄目标=西南侧入口/);
  assert.match(prompt,/北墙书柜，东窗西门/);
  p={...p,...buildProductionAssetBoardPromptUpdate({project:p,assetId:'room',locationView:'oblique',prompt:productionAssetBoardPromptCore(prompt,p,b),referenceMode:'clean_reference'})};
  p.assets[0].locationSpatialAnchor.cameras!.oblique!.position='东南角平视';
  b=viewBoard(p,'oblique');prompt=buildProductionAssetBoardPromptPreview(p,b,'clean_reference');
  assert.match(prompt,/东南角平视/);assert.doesNotMatch(prompt,/东北角平视/);
  assert.equal(prompt.split('【场景空间锚点】').length,2);
  assert.match(renderLocationSpatialAnchor(p.assets[0],'oblique','night'),/东南角平视/);
  p.assets[0].variants![0].locationSpatialAnchor={cameras:{main:{lookAt:'北墙灯下书柜'}}};
  const night=renderLocationSpatialAnchor(p.assets[0],'main','night');
  assert.match(night,/南侧平视/);assert.match(night,/北墙灯下书柜/);
  assert.doesNotMatch(renderLocationSpatialAnchor(p.assets[0],'main'),/灯下/);
});

test('anchor edits invalidate only dependent view sources and flow into actual scene references',()=>{
  let p=fixture();
  p.assets[0].locationSpatialAnchor={layout:'北柜东窗西门',cameras:{main:{position:'南侧',lookAt:'北墙'},reverse:{position:'北侧',lookAt:'南墙'}}};
  p=adopt(adopt(p,'reverse'),'oblique');
  const reverseHash=locationViewSourceHash(p,p.assets[0],'reverse');
  p.assets[0].locationSpatialAnchor!.cameras!.oblique={position:'东北角',lookAt:'西南'};
  assert.equal(locationViewSourceHash(p,p.assets[0],'reverse'),reverseHash,'unrelated camera edits do not stale sibling views');
  assert.match(locationViewCurrentIssue(p,p.assets[0],'oblique')!,/变化/);
  dbHelpers.saveProject(p);
  const ctx=loadGenerationContext(shotTarget(p));
  assert.match(ctx.references.find(r=>r.locationView==='reverse')!.usageNote!,/北柜东窗西门/);
  p.assets[0].locationSpatialAnchor!.layout='北柜东门西窗';dbHelpers.updateProjectMeta(p.id,{assets:p.assets});
  assert.match(locationViewCurrentIssue(p,p.assets[0],'reverse')!,/变化/);
  assert.notEqual(loadGenerationContext(shotTarget(p)).sourceHash,ctx.sourceHash);
  const mainBoard=buildVideoStoryboardAssetBoardPlan(p).sceneBoards[0];
  assert.match(buildProductionAssetBoardPromptPreview(p,mainBoard,'clean_reference'),/北柜东门西窗/);
});


test('preparation tracks only the spatial anchor used by its selected view',async()=>{
  let p=fixture();p.assets[0].locationSpatialAnchor={layout:'东窗西门',cameras:{main:{position:'南侧',lookAt:'北墙'}}};
  p=adopt(p,'reverse');dbHelpers.saveProject(p);
  const engine=new GenerationEngine(new GenerationStore(db),()=>config(),directory);
  const scope=shotTarget(p);await reviewFixturePreparation(engine.quality,scope);
  assert.equal(engine.quality.state('preparation',scope).status,'passed');
  p.assets[0].locationSpatialAnchor!.cameras!.oblique={position:'东北角',lookAt:'西南'};
  dbHelpers.updateProjectMeta(p.id,{assets:p.assets});
  assert.equal(engine.quality.state('preparation',scope).status,'passed');
  p.assets[0].locationSpatialAnchor!.layout='西窗东门';dbHelpers.updateProjectMeta(p.id,{assets:p.assets});
  assert.equal(engine.quality.state('preparation',scope).status,'stale');
});
