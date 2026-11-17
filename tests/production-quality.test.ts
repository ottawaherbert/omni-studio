import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import sharp from 'sharp';
import { qualityStages, type ProductionQualityStage, type QualityTarget, type QualityEvidenceInput } from '../packages/domain/src/productionQuality';
import type { GenerationReference, GenerationTarget } from '../packages/domain/src/generation';
import { fixtureDirectorPlan } from './helpers/productionQualityFixture';

const root = await fs.mkdtemp(path.join(os.tmpdir(),'omni-quality-'));
process.env.OMNI_DB_PATH=path.join(root,'fixture.db');
const {db,dbHelpers}=await import('../src/server/db');
assert.equal(db.name,process.env.OMNI_DB_PATH);
const {GenerationStore}=await import('../src/server/generation/store');
const {ProductionQuality}=await import('../src/server/productionQuality');
const {registerProductionQualityRoutes}=await import('../src/server/routes/productionQualityRoutes');
const quality=new ProductionQuality(new GenerationStore(db),root);
for(const [file,color] of [['a.png','red'],['b.png','blue']] as const)await sharp({create:{width:160,height:90,channels:3,background:color}}).png().toFile(path.join(root,file));
await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(root,'clip.mp4')]);
await promisify(execFile)('ffmpeg',['-v','error','-i',path.join(root,'clip.mp4'),'-vn',path.join(root,'voice.wav')]);
await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'blue.mp4')]);
await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=880:duration=2',path.join(root,'music.wav')]);
after(()=>{db.close();});

function fixture(count=2):QualityTarget {
  const projectId=`quality-${randomUUID()}`,episodeId=projectId+'-ep',sceneId=projectId+'-scene';
  dbHelpers.saveProject({id:projectId,title:'质量协议隔离夹具',aspectRatio:'16:9',type:'movie',characters:[],assets:[],episodes:[{id:episodeId,title:'第一集',scenes:[{id:sceneId,title:'池边',script:'甲坐在池边放下竹枝，乙从台阶走入。',manualStoryboard:{directorPlan:fixtureDirectorPlan('池边两个人物按明确方位完成入场与反应。')},shots:Array.from({length:count},(_,i)=>({id:`${projectId}-shot-${i}`,duration:1,visualAction:i?'乙走入':'甲放下竹枝',editingNote:'动作完成后切到下一人物的反应',imageUrl:`/media/${i?'b':'a'}.png`}))}]}]} as any);
  quality.saveResponsibility(projectId,{director:'测试导演',coordinator:'测试统筹',intent:'呈现一场连贯的池边冲突',visualDirection:'保持同一池沿、台阶与人物身份；本用例只验证软件合同',spatialMode:'scene_plan'});
  return {projectId,episodeId,sceneId};
}
function change(target:QualityTarget,fn:(scene:any,episode:any,project:any)=>void){
  const project=dbHelpers.getProjectById(target.projectId) as any,episode=project.episodes.find((e:any)=>e.id===target.episodeId),scene=episode.scenes.find((s:any)=>s.id===target.sceneId);
  fn(scene,episode,project);dbHelpers.saveProject(project);
}
async function inspectAndReview(stage:ProductionQualityStage,target:QualityTarget,passed=true,evidence?:QualityEvidenceInput[]){
  const inspection=await quality.inspect(stage,target,evidence);
  return quality.review(inspection.id,{verdict:passed?'passed':'failed',reviewerName:'测试导演',findings:qualityStages[stage].checks.map((check,index)=>({check,passed:passed||index!==0,note:`隔离协议测试：${check} 对应冻结内容；本记录不代表真实作品验收。`}))},'external_agent');
}
async function prepare(target:QualityTarget,through:ProductionQualityStage='preparation'){
  for(const stage of ['project_plan','scene_plan','shot_plan','preparation','visuals','segments'] as const){
    await inspectAndReview(stage,target);if(stage===through)break;
  }
}
const sid=(target:QualityTarget,index:number)=>`${target.projectId}-shot-${index}`;
function genTarget(target:QualityTarget,shotIds=[sid(target,0),sid(target,1)]):GenerationTarget{return {...target,kind:'shot',shotIds};}
const reference=(mediaUrl:string,contentHash?:string):GenerationReference=>({id:randomUUID(),label:'已审画面',mediaKind:'image',mediaUrl,contentHash,role:'composition',enabled:true,locked:false,mediaVersionId:'fixture',source:'user',status:'adopted'});

test('missing or failed overall checks block dependents; empty scenes can start overall planning',async()=>{
  const target=fixture(0);
  assert.equal(quality.status(target).stages[0].status,'pending');
  await assert.rejects(quality.inspect('scene_plan',target),/全剧总体方案未通过/);
  const failed=await inspectAndReview('project_plan',target,false);
  assert.equal(quality.state('project_plan',target).status,'failed');
  assert.throws(()=>quality.require('scene_plan',target),/整场设计未通过/);
  await inspectAndReview('project_plan',target);
  assert.equal(quality.inspection(failed.id).verdict,'failed','a later check must not rewrite failed evidence');
  await inspectAndReview('scene_plan',target);
  await assert.rejects(quality.inspect('shot_plan',target),/镜头动作/);
  assert.equal(quality.status(target).stages.find(s=>s.stage==='preparation')!.status,'blocked');
});

test('reviews require explicit observations, actual director and immutable evidence; body cannot forge scope',async()=>{
  const target=fixture(),inspection=await quality.inspect('project_plan',target);
  const input={verdict:'passed' as const,reviewerName:'测试导演',findings:qualityStages.project_plan.checks.map(check=>({check,passed:true,note:'协议检查观察'}))};
  assert.throws(()=>quality.review(inspection.id,{...input,findings:[]},'external_agent'),/逐项/);
  assert.throws(()=>quality.review(inspection.id,{...input,reviewerName:'其他导演'},'external_agent'),/总导演/);
  const record=quality.review(inspection.id,{...input,stage:'episode_cut',target:{projectId:'forged'},sourceHash:'forged',evidence:[],reviewer:'creator'} as any,'external_agent');
  assert.equal(record.stage,'project_plan');assert.equal(record.target.projectId,target.projectId);assert.equal(record.sourceHash,inspection.sourceHash);assert.equal(record.reviewer,'external_agent');
  assert.deepEqual(quality.review(inspection.id,input,'external_agent'),record);
  assert.throws(()=>quality.review(inspection.id,{...input,verdict:'failed',findings:input.findings.map(f=>({...f,passed:false}))},'external_agent'),/不能改写/);
  assert.deepEqual(quality.inspection(inspection.id),record);
});

test('script changes invalidate overall and downstream while observations and storage defaults do not',async()=>{
  const target=fixture();await prepare(target);
  const inspection=await quality.inspect('visuals',target);
  change(target,scene=>{scene.visualPlan={schemaVersion:'scene-visual-plan.v1',geography:'',lighting:'',entryState:'',exitState:'',transition:{kind:'unspecified',carryOver:'',changes:'',cue:''},references:[],updatedAt:123};scene.productionObservations=[{note:'仅工作记录'}];scene.shots[0].takes=[{id:'unused-candidate',imageUrl:'/media/b.png'}];});
  assert.equal(quality.state('preparation',target).status,'passed');
  quality.review(inspection.id,{verdict:'passed',reviewerName:'测试导演',findings:qualityStages.visuals.checks.map(check=>({check,passed:true,note:'检查冻结画面'}))},'external_agent');
  const next=await quality.inspect('visuals',target);
  change(target,scene=>{scene.script+=' 无依据地将池边改成大殿。';});
  assert.equal(quality.state('project_plan',target).status,'stale');
  assert.equal(quality.state('visuals',target).status,'blocked');
  assert.throws(()=>quality.review(next.id,{verdict:'passed',reviewerName:'测试导演',findings:qualityStages.visuals.checks.map(check=>({check,passed:true,note:'旧画面'}))},'external_agent'),/已经变化/);
});

test('partial group reviews cannot unlock other shots or relabel another shot image',async()=>{
  const target=fixture();await prepare(target);
  await assert.rejects(quality.inspect('visuals',target,[{mediaUrl:'/media/a.png',mediaKind:'image',shotIds:[sid(target,0),sid(target,1)]}]),/其他素材代替/);
  await inspectAndReview('visuals',{...target,shotIds:[sid(target,0)]});
  assert.equal(quality.state('visuals',{...target,shotIds:[sid(target,0)]}).status,'passed');
  assert.equal(quality.state('visuals',target).status,'pending');
  await inspectAndReview('visuals',{...target,shotIds:[sid(target,1)]});
  assert.equal(quality.state('visuals',target).status,'passed');
  await inspectAndReview('visuals',{...target,shotIds:[sid(target,0)]},false);
  assert.equal(quality.state('visuals',target).status,'failed');
  assert.equal(quality.state('visuals',{...target,shotIds:[sid(target,1)]}).status,'passed');
});

test('video input must use actual checked imagery and changed image invalidates downstream',async()=>{
  const target=fixture();await prepare(target,'visuals');
  const checked=quality.inspection(quality.state('visuals',target).inspectionId!);
  const refs=checked.evidence.map(e=>reference(e.mediaUrl,e.contentHash));
  assert.doesNotThrow(()=>quality.assertGeneration(genTarget(target),'video',refs));
  assert.throws(()=>quality.assertGeneration(genTarget(target),'video',refs.slice(0,1)),/本镜已通过/);
  assert.throws(()=>quality.assertGeneration(genTarget(target),'video',[reference('/media/unreviewed.png')]),/本镜已通过/);
  change(target,scene=>{scene.shots[1].imageUrl='/media/a.png';});
  assert.equal(quality.state('preparation',target).status,'passed');
  assert.equal(quality.state('visuals',target).status,'stale');
  assert.throws(()=>quality.assertGeneration(genTarget(target),'video',refs),/整组画面总检未通过/);
});

test('unit planning changes invalidate shot plan but appending unused panel candidates does not',async()=>{
  const target=fixture();
  change(target,scene=>{scene.manualStoryboard.boards=[{id:'unit',shotIds:[sid(target,0),sid(target,1)],board:{id:'board',layout:'1x2',panels:[{id:'panel',shotId:sid(target,0),subjectAction:'放竹枝'}]}}];});
  await prepare(target);
  change(target,scene=>{scene.manualStoryboard.boards[0].board.panels[0].visualTakes=[{id:'candidate',imageUrl:'/media/b.png'}];});
  assert.equal(quality.state('preparation',target).status,'passed');
  change(target,scene=>{scene.manualStoryboard.boards[0].board.panels[0].subjectAction='先拔剑';});
  assert.equal(quality.state('shot_plan',target).status,'stale');
  assert.equal(quality.state('preparation',target).status,'blocked');
});

test('authored appearance and global creative direction changes invalidate the relevant design checks',async()=>{
  const target=fixture();await prepare(target);
  change(target,scene=>{scene.shots[0].appearance={notes:'服装改为已破损状态'};});
  assert.equal(quality.state('shot_plan',target).status,'stale');
  assert.equal(quality.state('project_plan',target).status,'passed');
  change(target,(_scene,_episode,project)=>{project.creativeDirection={notes:'全剧由写实改为黑白剪影'};});
  assert.equal(quality.state('project_plan',target).status,'stale');
});

test('optional 3D mode requires actual world, scene plan and matching composition for every shot',async()=>{
  const target=fixture();quality.saveResponsibility(target.projectId,{...quality.responsibility(target.projectId)!,spatialMode:'previs'});
  await prepare(target,'shot_plan');
  await assert.rejects(quality.inspect('preparation',target),/世界与本场调度/);
  db.exec('CREATE TABLE IF NOT EXISTS previs_documents(project_id TEXT,scope_key TEXT,data TEXT,revision INTEGER,PRIMARY KEY(project_id,scope_key))');
  for(const key of ['world','scene:'+JSON.stringify([target.episodeId,target.sceneId])])db.prepare('INSERT INTO previs_documents(project_id,scope_key,data,revision) VALUES(?,?,?,1)').run(target.projectId,key,JSON.stringify({plan:{objects:[],frames:[],purpose:'仅验证空间存在和关联范围，不替代实际布景验收'}}));
  await inspectAndReview('preparation',target,true,[{mediaUrl:'/media/a.png',mediaKind:'image',shotIds:[sid(target,0),sid(target,1)],note:'隔离空间参考'}]);
  const ref={...reference('/media/a.png'),sourceShotIds:[sid(target,0)],previsSource:{exportId:'fixture',sceneId:target.sceneId!,sourceHash:'fixture',kind:'grid' as const}};
  assert.throws(()=>quality.assertGeneration(genTarget(target),'joint_storyboard',[ref]),/每个镜头/);
  assert.doesNotThrow(()=>quality.assertGeneration(genTarget(target),'joint_storyboard',[{...ref,sourceShotIds:[sid(target,0),sid(target,1)]}]));
});

test('missing video, still placeholders and short source ranges cannot pass segment review',async()=>{
  const target=fixture();await prepare(target,'visuals');
  await assert.rejects(quality.inspect('segments',target),/每个本次镜头/);
  await assert.rejects(quality.inspect('segments',target,[{mediaUrl:'/media/a.png',mediaKind:'image',shotIds:[sid(target,0),sid(target,1)]}]),/每个本次镜头/);
  change(target,scene=>{for(const shot of scene.shots)shot.videoUrl='/media/clip.mp4';scene.shots[1].sourceStartSeconds=1.5;});
  await assert.rejects(quality.inspect('segments',target),/源入点和时长/);
  change(target,scene=>{scene.shots[1].sourceStartSeconds=1;});
  await inspectAndReview('segments',target);
  await assert.rejects(quality.inspect('scene_cut',target),/整场\/整集回看视频/);
});

test('whole-scene and episode reviews are required; delivery returns exactly the checked movie',async()=>{
  const target=fixture();change(target,scene=>{for(const shot of scene.shots)shot.videoUrl='/media/clip.mp4';});await prepare(target,'segments');
  await assert.rejects(quality.inspect('episode_cut',target,[{mediaUrl:'/media/clip.mp4',mediaKind:'video'}]),/整场合成总检未通过/);
  const scene=await inspectAndReview('scene_cut',target,true,[{mediaUrl:'/media/clip.mp4',mediaKind:'video'}]);
  const episode=await inspectAndReview('episode_cut',target,true,[{mediaUrl:'/media/clip.mp4',mediaKind:'video'}]);
  assert.equal(episode.evidence[0].hasAudio,true);
  assert.equal(quality.delivery(episode.id).media[0].mediaUrl,episode.evidence[0].mediaUrl);
  assert.deepEqual(await fs.readFile(path.join(root,episode.evidence[0].mediaUrl.slice(7))),await fs.readFile(path.join(root,'clip.mp4')));
  assert.equal(quality.delivery(scene.id).target.sceneId,target.sceneId);
  change(target,scene=>{scene.audioTracks=[{id:'new-sound',url:'/media/replaced.wav',startTime:0,duration:2}];});
  assert.throws(()=>quality.delivery(episode.id),/整集总检与交付未通过/);
});

test('separate dialogue must be included in actual listening evidence before video/sound passes',async()=>{
  const target=fixture();change(target,scene=>{for(const shot of scene.shots)shot.videoUrl='/media/clip.mp4';scene.audioTracks=[{id:'dialogue',type:'dialogue',url:'/media/voice.wav',duration:1,startTime:0,shotId:sid(target,0),text:'放下竹枝。'}];});
  await prepare(target,'visuals');
  await assert.rejects(quality.inspect('segments',target,[{mediaUrl:'/media/clip.mp4',mediaKind:'video',shotIds:[sid(target,0),sid(target,1)]}]),/独立声音尚未纳入听审/);
  const inspection=await quality.inspect('segments',target);
  assert.ok(inspection.evidence.some(e=>e.mediaKind==='audio'&&e.durationSeconds!>=1));
});

test('segment review follows pinned edit media and actual trim instead of current Shot adoption',async()=>{
  const target=fixture(1);
  change(target,scene=>{scene.shots[0].videoUrl='/media/clip.mp4';});
  await prepare(target,'segments');
  change(target,scene=>{scene.edit={clips:[{id:'fixed-blue',shotId:sid(target,0),videoUrl:'/media/blue.mp4',sourceInSeconds:.5,durationSeconds:1,timelineStartSeconds:0}]};});
  assert.equal(quality.state('visuals',target).status,'passed');
  assert.equal(quality.state('segments',target).status,'stale');
  await assert.rejects(quality.inspect('segments',target,[{mediaUrl:'/media/clip.mp4',mediaKind:'video',shotIds:[sid(target,0)]}]),/其他素材代替/);
  const checked=await inspectAndReview('segments',target);
  assert.equal(checked.evidence[0].hasAudio,false,'the blue fixed clip, not the current red take, was inspected');

  const trimmed=fixture(1);
  change(trimmed,scene=>{
    scene.shots[0].duration=4;scene.shots[0].videoUrl='/media/clip.mp4';
    scene.edit={clips:[{id:'trim',shotId:sid(trimmed,0),videoUrl:'/media/blue.mp4',sourceInSeconds:.5,durationSeconds:1,timelineStartSeconds:0}]};
  });
  await prepare(trimmed,'segments');
  assert.equal(quality.state('segments',trimmed).status,'passed','a one-second cut from a two-second source need not cover the narrative four seconds');
});

test('all edited files for one source shot must be watched and each source range must fit',async()=>{
  const target=fixture(1);
  change(target,scene=>{scene.edit={clips:[
    {id:'part-a',shotId:sid(target,0),videoUrl:'/media/clip.mp4',sourceInSeconds:0,durationSeconds:1,timelineStartSeconds:0},
    {id:'part-b',shotId:sid(target,0),videoUrl:'/media/blue.mp4',sourceInSeconds:1,durationSeconds:1,timelineStartSeconds:1},
  ]};});
  await prepare(target,'visuals');
  await assert.rejects(quality.inspect('segments',target,[{mediaUrl:'/media/clip.mp4',mediaKind:'video',shotIds:[sid(target,0)]}]),/每份视频/);
  await inspectAndReview('segments',target);
  change(target,scene=>{scene.edit.clips[1].sourceInSeconds=1.5;});
  await assert.rejects(quality.inspect('segments',target),/源入点和时长/);
});

test('an edit referencing archived shots remains reviewable without restoring them to the shot list',async()=>{
  const target=fixture();
  change(target,scene=>{
    const archived=scene.shots.pop();
    scene.shotHistory=[{at:1,shots:[archived]}];
    scene.edit={clips:[{id:'old-source',shotId:archived.id,videoUrl:'/media/blue.mp4',sourceInSeconds:0,durationSeconds:1,timelineStartSeconds:0}]};
  });
  await prepare(target,'segments');
  const checked=quality.inspection(quality.state('segments',target).inspectionId!);
  assert.deepEqual(checked.target.shotIds,[sid(target,1)]);
  assert.deepEqual(checked.evidence[0].shotIds,[sid(target,1)]);
});

test('an archived board-only shot can supply the checked image for an edit with no current shots',async()=>{
  const target=fixture(1);
  change(target,scene=>{
    const archived=scene.shots.pop();delete archived.imageUrl;
    const board={id:'old-board',shotIds:[archived.id],panels:[{id:'panel',shotId:archived.id,subjectAction:'放下竹枝'}],visualPages:[{
      id:'page',panelIds:['panel'],activeVisualTakeId:'take',visualTakes:[{id:'take',status:'adopted',review:{status:'approved'},imageUrl:'/media/a.png'}],
    }]};
    scene.shotHistory=[{at:1,shots:[archived],manualStoryboard:{boards:[{id:'old-unit',shotId:archived.id,board}]}}];
    scene.edit={clips:[{id:'old-source',shotId:archived.id,videoUrl:'/media/blue.mp4',sourceInSeconds:0,durationSeconds:1,timelineStartSeconds:0}]};
  });
  await prepare(target,'segments');
  const checked=quality.inspection(quality.state('visuals',target).inspectionId!);
  assert.equal(checked.evidence.length,1);
  assert.deepEqual(checked.evidence[0].shotIds,[sid(target,0)]);
});

test('replacing a reviewed scene cut cannot revive an episode review of the previous cut',async()=>{
  const target=fixture(1);change(target,scene=>{scene.shots[0].videoUrl='/media/clip.mp4';});
  await prepare(target,'segments');
  const red=[{mediaUrl:'/media/clip.mp4',mediaKind:'video' as const}];
  const blue=[{mediaUrl:'/media/blue.mp4',mediaKind:'video' as const}];
  await inspectAndReview('scene_cut',target,true,red);
  const oldEpisode=await inspectAndReview('episode_cut',target,true,red);
  await inspectAndReview('scene_cut',target,true,red);
  assert.equal(quality.state('episode_cut',target).status,'passed','another inspection of identical content need not force another episode review');
  await inspectAndReview('scene_cut',target,true,[...red,{mediaUrl:'/media/a.png',mediaKind:'image'}]);
  assert.equal(quality.state('episode_cut',target).status,'passed','additional notes and reference images do not replace the reviewed scene movie');
  const opened=await quality.inspect('episode_cut',target,red);
  await inspectAndReview('scene_cut',target,false,blue);
  assert.equal(quality.state('episode_cut',target).status,'blocked');
  await inspectAndReview('scene_cut',target,true,blue);
  assert.equal(quality.state('episode_cut',target).status,'stale');
  assert.throws(()=>quality.delivery(oldEpisode.id),/未通过/);
  assert.throws(()=>quality.review(opened.id,{verdict:'passed',reviewerName:'测试导演',findings:qualityStages.episode_cut.checks.map(check=>({check,passed:true,note:'旧检查中的旧整场媒体'}))},'creator'),/已经变化/);
  const current=await inspectAndReview('episode_cut',target,true,blue);
  assert.equal(quality.delivery(current.id).media[0].contentHash,current.evidence[0].contentHash);
});

test('episode creative direction invalidates its scene checks without invalidating another episode or project plan',async()=>{
  const target=fixture(1);
  change(target,(scene,episode,project)=>{project.episodes.push({...structuredClone(episode),id:'other-episode',productionRevision:undefined,scenes:[{...structuredClone(scene),id:'other-scene',shots:scene.shots.map((shot:any)=>({...structuredClone(shot),id:shot.id+'-other'}))}]});});
  const other={projectId:target.projectId,episodeId:'other-episode',sceneId:'other-scene'};
  await prepare(target,'visuals');await prepare(other,'visuals');
  change(target,(_scene,episode)=>{episode.creativeDirection={visual:{mode:'replace',stylePrompt:'黑白剪影'}};});
  assert.equal(quality.state('project_plan',target).status,'passed');
  assert.equal(quality.state('scene_plan',target).status,'stale');
  assert.equal(quality.state('visuals',target).status,'blocked');
  assert.equal(quality.state('visuals',other).status,'passed');
});

test('linked project audio is heard and changing it invalidates segments; fixed library selections stay fixed',async()=>{
  const target=fixture(1);
  change(target,(scene,_episode,project)=>{
    scene.shots[0].videoUrl='/media/clip.mp4';
    project.assets=[{id:'music',name:'音乐',type:'bgm',imageUrl:'/media/voice.wav'}];
    scene.audioTracks=[{id:'linked',type:'bgm',linkedAssetId:'music',url:'',startTime:0,duration:1}];
  });
  await prepare(target,'visuals');
  await assert.rejects(quality.inspect('segments',target,[{mediaUrl:'/media/clip.mp4',mediaKind:'video',shotIds:[sid(target,0)]}]),/独立声音/);
  const before=await inspectAndReview('segments',target);
  change(target,(_scene,_episode,project)=>{project.assets[0].imageUrl='/media/music.wav';});
  assert.equal(quality.state('preparation',target).status,'passed');
  assert.equal(quality.state('segments',target).status,'stale');
  const after=await inspectAndReview('segments',target);
  assert.notEqual(before.evidence.find(e=>e.mediaKind==='audio')!.contentHash,after.evidence.find(e=>e.mediaKind==='audio')!.contentHash);
  change(target,scene=>{scene.audioTracks[0].url='/media/music.wav';});
  await inspectAndReview('segments',target);
  change(target,(_scene,_episode,project)=>{project.assets[0].imageUrl='/media/voice.wav';});
  assert.equal(quality.state('segments',target).status,'passed','the actual pinned track did not change');
  change(target,scene=>{scene.audioTracks[0].url='';scene.audioTracks[0].linkedAssetId='browser-only-old-library-id';});
  await assert.rejects(quality.inspect('segments',target),/重新从资产库选择/);
});

test('listening evidence follows audible edit ranges, including sound left after a shot was cut',async()=>{
  const target=fixture();
  change(target,scene=>{
    scene.edit={clips:[{id:'only-first',shotId:sid(target,0),videoUrl:'/media/clip.mp4',sourceInSeconds:0,durationSeconds:1,timelineStartSeconds:0}]};
    scene.audioTracks=[
      {id:'remaining',type:'dialogue',shotId:sid(target,1),url:'/media/voice.wav',startTime:0,duration:1},
      {id:'silent',type:'bgm',linkedAssetId:'not-available',startTime:0,duration:1,volume:0},
      {id:'outside',type:'bgm',linkedAssetId:'not-available',startTime:3,duration:1},
    ];
  });
  await prepare(target,'visuals');
  const inspection=await quality.inspect('segments',target);
  assert.equal(inspection.evidence.filter(e=>e.mediaKind==='audio').length,1);
  assert.deepEqual(inspection.evidence.find(e=>e.mediaKind==='audio')!.shotIds,[sid(target,0)]);
});

test('human and operator HTTP share checks, enforce project access and cannot forge review identity',async()=>{
  const target=fixture(),denied=fixture(),app=express();app.use(express.json());
  registerProductionQualityRoutes(app,quality.store,root);
  registerProductionQualityRoutes(app,quality.store,root,{basePath:'/api/operator/quality',operator:true,assertProjectAccess:id=>{if(id!==target.projectId)throw Object.assign(new Error('项目访问被拒绝'),{statusCode:403});}});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
    const request=async(p:string,body?:unknown)=>{const res=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json() as any};};
    const block=await request('/api/operator/quality/inspections',{target,stage:'scene_plan'});assert.equal(block.status,409);assert.equal(block.data.code,'PRODUCTION_QUALITY_BLOCKED');
    const invisible=await request('/api/operator/quality/status?target='+encodeURIComponent(JSON.stringify(denied)));assert.equal(invisible.status,403);
    const opened=await request('/api/operator/quality/inspections',{target,stage:'project_plan'});assert.equal(opened.status,201);
    const review=await request(`/api/operator/quality/inspections/${opened.data.inspection.id}/review`,{verdict:'passed',reviewerName:'测试导演',reviewer:'creator',stage:'episode_cut',findings:qualityStages.project_plan.checks.map(check=>({check,passed:true,note:'HTTP协议隔离测试观察'}))});
    assert.equal(review.status,200);assert.equal(review.data.inspection.reviewer,'external_agent');assert.equal(review.data.inspection.stage,'project_plan');
    const human=await request('/api/production/quality/status?target='+encodeURIComponent(JSON.stringify(target)));assert.equal(human.data.stages[0].status,'passed');
    const read=await request(`/api/production/quality/inspections/${opened.data.inspection.id}`);assert.equal(read.data.inspection.verdict,'passed');
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
