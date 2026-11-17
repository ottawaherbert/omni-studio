import test, {after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Project,Episode,CharacterReferenceLayout} from '../src/types/project';
import {buildVideoStoryboardAssetBoardPlan} from '../src/services/production/videoStoryboardAssetBoards';
import {buildProductionAssetBoardPromptPreview} from '../src/services/production/productionAssetBoardExecution';
import {buildProductionAssetBoardReferenceUpdate,buildProductionAssetBoardPromptUpdate} from '../src/services/production/productionAssetBoardProfile';
import {characterReferenceSourceHash} from '../src/services/production/characterReferenceLayouts';
import {stageProductionAssetBoardReferenceCandidate,adoptProductionAssetBoardReferenceCandidate,returnProductionAssetBoardReferenceCandidateToReview} from '../src/services/production/productionAssetBoardCandidate';
import {buildManualProductionAssetReadModel} from '../src/services/production/manualProductionAssets';
import {selectStoryboardCompositeBoardReferences,buildStoryboardCompositeBoardPrompt} from '../src/services/production/storyboardCompositeBoard';
import {defaultAIConfig} from '../src/config/aiConfigDefaults';
import {fixtureDirectorPlan,reviewFixtureStage,reviewFixturePreparation} from './helpers/productionQualityFixture';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'character-layout-'));process.env.OMNI_DB_PATH=path.join(dir,'fixture.db');
const {db,dbHelpers}=await import('../src/server/db');assert.equal(db.name,process.env.OMNI_DB_PATH);
const {GenerationEngine}=await import('../src/server/generation/engine');const {GenerationStore}=await import('../src/server/generation/store');const {loadGenerationContext}=await import('../src/server/generation/context');
after(()=>db.close());afterEach(()=>{for(const r of db.prepare('SELECT id FROM projects').all() as {id:string}[])dbHelpers.deleteProject(r.id);});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4QAAAABJRU5ErkJggg==','base64');
for(const name of ['original','body_face','standard','wounded'])await fs.writeFile(path.join(dir,name+'.png'),png);
function fixture():Project{return {id:randomUUID(),title:'角色版式测试',logline:'身份与状态分工',coreConflict:'协议夹具',type:'movie',aspectRatio:'16:9',characters:[{id:'actor',name:'女主',visualIdentity:'红发白衣年轻女子',cleanReferenceImageUrl:'/media/original.png',variants:[{id:'hurt',name:'鼻梁创可贴',description:'鼻梁白色创可贴，红发白衣不变',promptModifiers:'创可贴只在鼻梁',cleanReferenceImageUrl:'/media/wounded.png'}]}],assets:[],episodes:[{id:'ep',title:'本集',scenes:[{id:'scene',title:'对话',script:'女主抬头。',manualStoryboard:{directorPlan:fixtureDirectorPlan()},breakdown:{characterIds:['actor'],characters:[{name:'女主',state:'基础'}]},shots:[{id:'shot',duration:3,characterIdsInShot:['actor'],visualAction:'抬头',editingNote:'抬头后切出',imagePrompt:'女主抬头'}]}]}]} as unknown as Project;}
const board=(p:Project,layout:CharacterReferenceLayout='body_face',variantId?:string)=>buildVideoStoryboardAssetBoardPlan(p).characterReferenceBoards.find(b=>b.characterReferenceLayout===layout&&b.variantId===variantId)!;
function stage(p:Project,layout:CharacterReferenceLayout='body_face',variantId?:string){const b=board(p,layout,variantId),id=randomUUID();return {id,p:{...p,...stageProductionAssetBoardReferenceCandidate({project:p,candidateId:id,boardItemId:b.id,imageUrl:`/media/${variantId?'wounded':layout}.png`,source:'upload',finalPrompt:'测试版式',referenceMode:'clean_reference'})}};}
function adopt(p:Project,layout:CharacterReferenceLayout='body_face',variantId?:string){const s=stage(p,layout,variantId);return {...s.p,...adoptProductionAssetBoardReferenceCandidate({project:s.p,candidateId:s.id})};}
const scope=(p:Project)=>({projectId:p.id,episodeId:'ep',sceneId:'scene',kind:'shot' as const,shotIds:['shot']});
const config=()=>({...structuredClone(defaultAIConfig),channels:[{id:'mock',name:'隔离模型',type:'doubao',baseUrl:'https://fixture.invalid',apiKey:''}],models:[{id:'image',channelId:'mock',modelId:'seedream',alias:'联合图片',capabilities:['image']}]} as any);

test('only body_face is generated, including legacy targets and saved old prompts',()=>{
 const p=fixture();assert.equal(buildVideoStoryboardAssetBoardPlan(p).characterReferenceBoards.length,2);
 const body=buildProductionAssetBoardPromptPreview(p,board(p),'clean_reference');assert.match(body,/颈部以上省略头部/);assert.match(body,/右侧.*完整正脸大特写/);assert.doesNotMatch(body,/正面上半身身份特写/);
 for(const base of [...buildVideoStoryboardAssetBoardPlan(p).characterBoards,...buildVideoStoryboardAssetBoardPlan(p).variantBoards.filter(b=>b.assetType==='character')]) {
  const prompt=buildProductionAssetBoardPromptPreview(p,base,'clean_reference');assert.match(prompt,/颈部以上省略头部/);assert.doesNotMatch(prompt,/正面上半身身份特写/);
 }
 p.characters[0].cleanReferencePrompt='旧版正面上半身身份特写';
 assert.doesNotMatch(buildProductionAssetBoardPromptPreview(p,buildVideoStoryboardAssetBoardPlan(p).characterBoards[0],'clean_reference'),/旧版/);
 assert.equal(board(p,'standard'),undefined);
 const next={...p,...buildProductionAssetBoardPromptUpdate({project:p,assetId:'actor',characterReferenceLayout:'body_face',referenceMode:'clean_reference',prompt:'作者要求保留蕾丝领口'})};
 assert.match(buildProductionAssetBoardPromptPreview(next,board(next),'clean_reference'),/保留蕾丝领口/);assert.equal(next.characters[0].cleanReferencePrompt,'旧版正面上半身身份特写');
});
test('staging cannot change the active reference; adopting keeps the old layout and a stable source',()=>{
 const p=fixture(),s=stage(p);assert.equal(s.p.characters[0].cleanReferenceImageUrl,'/media/original.png');
 const hash=characterReferenceSourceHash(p,p.characters[0],'body_face');const next={...s.p,...adoptProductionAssetBoardReferenceCandidate({project:s.p,candidateId:s.id})};
 assert.equal(next.characters[0].cleanReferenceImageUrl,'/media/body_face.png');assert.equal(next.characters[0].characterReferenceLayouts!.standard!.imageUrl,'/media/original.png');
 assert.equal(characterReferenceSourceHash(next,next.characters[0],'body_face'),hash);

});
test('state layouts preserve the base identity and reject candidates after state changes',()=>{
 const p=adopt(fixture());const s=stage(p,'body_face','hurt');s.p.characters[0].variants![0].description='另一处伤势';
 assert.throws(()=>adoptProductionAssetBoardReferenceCandidate({project:s.p,candidateId:s.id}),/来源已变化/);
 const next=adopt(p,'body_face','hurt');assert.equal(next.characters[0].cleanReferenceImageUrl,p.characters[0].cleanReferenceImageUrl);assert.equal(next.characters[0].variants![0].cleanReferenceLayout,'body_face');
 assert.equal(next.characters[0].variants![0].characterReferenceLayouts!.standard!.imageUrl,'/media/wounded.png');
});
test('real generation freezes the original character input and adopts through the existing review',async()=>{
 const p=fixture();dbHelpers.saveProject(p);const engine=new GenerationEngine(new GenerationStore(db),config,dir);await reviewFixtureStage(engine.quality,'project_plan',{projectId:p.id});
 const target={projectId:p.id,kind:'asset' as const,assetId:board(p).id,referenceMode:'clean_reference' as const,shotIds:[]};
 const ctx=loadGenerationContext(target);assert.equal(ctx.references.length,1);assert.equal(ctx.references[0].mediaUrl,'/media/original.png');
 const task=engine.create({target,operation:'asset_image',commandId:randomUUID()});const checked=await engine.preflight(task.id,task.revision);assert.ok(checked.plan,JSON.stringify(checked.issues));
 engine.providers.submit=async()=>({providerTaskId:'mock'});engine.providers.poll=async()=>({status:'succeeded',outputs:[{url:'/media/body_face.png',kind:'image'}]});engine.media.inspect=async()=>({width:1,height:1,durationSeconds:undefined});
 const execution=engine.submit(checked.plan.id,checked.plan.planHash,undefined,randomUUID());await engine.process(execution.id);const done=engine.execution(execution.id);assert.equal(done.status,'succeeded',done.error);
 const reviewed=engine.review(done.id,done.results[0].id,'adopted',undefined,'隔离协议夹具采用路径，非实际作品验收');assert.equal(reviewed.results[0].review,'adopted');
 assert.equal(dbHelpers.getProjectById(p.id)!.characters[0].cleanReferenceLayout,'body_face');
 assert.equal(board(dbHelpers.getProjectById(p.id)!,'standard'),undefined);
});
test('scene references carry body/face duties and cannot be disguised as a first frame',async()=>{
 const p=adopt(fixture());dbHelpers.saveProject(p);const ctx=loadGenerationContext(scope(p));const ref=ctx.references.find(r=>r.sourceAssetId)!;
 assert.equal(ref.characterReferenceLayout,'body_face');assert.match(ref.usageNote!,/完整头部/);assert.match(ref.usageNote!,/右侧脸部/);
 const engine=new GenerationEngine(new GenerationStore(db),config,dir);await reviewFixturePreparation(engine.quality,scope(p));let task=engine.create({target:scope(p),operation:'asset_image',commandId:randomUUID()});
 task=engine.update(task.id,{expectedRevision:task.revision,patch:{references:task.references.map(r=>({...r,role:'first_frame',characterReferenceLayout:undefined}))}});
 assert.ok((await engine.preflight(task.id,task.revision)).issues.some(i=>i.code==='CHARACTER_REFERENCE_ROLE'));
});
test('an accepted wound state supplies its actual reference and state-specific duties',()=>{
 const p=adopt(adopt(fixture()),'body_face','hurt');const episode=p.episodes[0] as Episode,scene=episode.scenes[0],shot=scene.shots[0];
 shot.appearance={analysis:'complete',states:[{assetId:'actor',assetName:'女主',assetType:'character',decision:'accepted',start:{injury:'鼻梁创可贴'},end:{injury:'鼻梁创可贴'},imageMoment:'start',startVariantId:'hurt',endVariantId:'hurt',referenceNeed:'image'} as any]};dbHelpers.saveProject(p);
 const ctx=loadGenerationContext(scope(p));const refs=ctx.references.filter(r=>r.sourceAssetId);assert.equal(refs.length,1);assert.equal(refs[0].mediaUrl,'/media/wounded.png');assert.match(refs[0].usageNote!,/状态/);
 const assets=buildManualProductionAssetReadModel({project:p,episode,scene});const b={shotIds:['shot'],panels:[{shotId:'shot',assetRefs:['actor']}]} as any;
 const selected=selectStoryboardCompositeBoardReferences({project:p,board:b,shots:[shot],assets}).selected;assert.equal(selected[0].variantId,'hurt');assert.equal(selected[0].characterReferenceLayout,'body_face');
 const baseShot={...shot,id:'base-shot',appearance:{analysis:'complete',states:[{...shot.appearance!.states[0],start:{},end:{},startVariantId:undefined,endVariantId:undefined}]}} as any;
 scene.shots.push(baseShot);dbHelpers.updateEpisode(p.id,episode.id,episode);
 const mixed=loadGenerationContext({...scope(p),shotIds:['shot','base-shot']}).references.filter(r=>r.sourceAssetId);assert.equal(mixed.length,2,'base and wound references both remain when explicitly required by separate shots');
 p.characters[0].variants![0].cleanReferenceImageUrl=undefined;p.characters[0].variants![0].imageUrl=undefined;p.characters[0].variants![0].boardImageUrl=undefined;dbHelpers.updateProjectMeta(p.id,{characters:p.characters});
 assert.ok(loadGenerationContext(scope(p)).locationViewIssues.some(s=>s.includes('角色状态参考')));
});


test('legacy clean-character target adopts the new format and retains historical images',()=>{
 const p=fixture();const base=buildVideoStoryboardAssetBoardPlan(p).characterBoards[0];
 const next={...p,...buildProductionAssetBoardReferenceUpdate({project:p,boardItemId:base.id,imageUrl:'/media/new-standard.png',source:'upload',finalPrompt:'普通三视图',referenceMode:'clean_reference'})};
 assert.equal(next.characters[0].cleanReferenceLayout,'body_face');assert.equal(next.characters[0].characterReferenceBasisUrl,'/media/new-standard.png');
 assert.equal(next.characters[0].characterReferenceLayouts!.standard!.imageUrl,'/media/original.png');
});
