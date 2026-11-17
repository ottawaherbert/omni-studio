import { reviewFixtureStage } from './helpers/productionQualityFixture';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {previsFixture} from './fixtures/previs';
import {previsHash} from '../packages/domain/src/previs';
import type {WorldBlueprint} from '../packages/domain/src/worldBuild';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omni-world-build-'));process.env.OMNI_DB_PATH=path.join(root,'test.db');
const {db,dbHelpers}=await import('../src/server/db');
const {ProductionQuality}=await import('../src/server/productionQuality');
const {GenerationStore}=await import('../src/server/generation/store');
const {createBuild,readBuild,returnBuild,applyBuild,buildReturns}=await import('../src/server/spatial/worldBuild');
const {readPrevisDocument,savePrevisDocument}=await import('../src/server/previsStore');
const {compileWorldBlueprint}=await import('../src/server/spatial/worldBuildCompiler');
const {publishStudio}=await import('../src/server/spatial/catalog');
after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
async function project(id:string){const f=previsFixture(id);f.scene.script='旅客从古城街道进入客栈，门外仍看得见街巷。';dbHelpers.saveProject(f.project);await reviewFixtureStage(new ProductionQuality(new GenerationStore(db),root),'project_plan',{projectId:id});return f;}
const blueprint=():WorldBlueprint=>({summary:'接口验收用结构候选，不代表完整影视城创作验收。',worldBrief:{scope:'district',description:'古街',geography:'山脚',circulation:'街巷连通',services:'客栈',skyline:'远山待建',gaps:['测试候选仍需外围环境']},locations:[{id:'new-street',name:'古街',description:'街巷',spaceId:'ancient-town',usage:'街道',detailTier:'shootable',origin:[40,0,0],ground:[100,100],sourceSceneIds:[]}],objects:[{id:'inn',label:'客栈',locationId:'new-street',kind:'model',modelId:'kit:inn',position:[10,0,0],rotation:[0,0,0],size:[13,9,13],color:'#b9bfc1',pose:'stand',repeat:{count:2,step:[25,0,0]}}],viewpoints:[{id:'view',name:'街道',locationId:'new-street',note:'实际检查',camera:{position:[0,2,30],target:[10,2,0],focalLength:28}}]});
test('external candidate creates real optimized geometry, preserves old IDs and only mutates world on apply',async()=>{
 const f=await project('build-external');savePrevisDocument(f.project.id,'world',{plan:f.world},0);const input={commandId:'external-1',mode:'external' as const,instructions:'扩建古街，保留旧院落'};const t=createBuild(root,f.project.id,input);assert.equal(createBuild(root,f.project.id,input).id,t.id);assert.match(t.prompt,/扩建古街/);assert.match(t.prompt,/旅客从古城/);
 const raw=JSON.stringify(blueprint());const ready=await returnBuild(root,f.project.id,t.id,raw);assert.equal(ready.status,'ready');assert.equal(readPrevisDocument<any>(f.project.id,'world').revision,1);assert.deepEqual(ready.candidate!.objects.find(o=>o.id===f.world.objects[0].id),f.world.objects[0]);assert.ok(ready.candidate!.objects.some(o=>o.id==='inn.1'));assert.ok(ready.candidate!.models!.every(m=>m.lods.length===3));const saved=applyBuild(f.project.id,t.id);assert.equal(saved.world!.revision,2);assert.equal(applyBuild(f.project.id,t.id).world!.revision,2);assert.equal((await returnBuild(root,f.project.id,t.id,raw)).status,'applied');await assert.rejects(returnBuild(root,f.project.id,t.id,JSON.stringify({...blueprint(),summary:'different'})),/新修改/);
});
test('script or world change rejects stale adoption without deleting the candidate',async()=>{
 const f=await project('build-stale');const t=createBuild(root,f.project.id,{commandId:'stale',mode:'external',instructions:'构建'});await returnBuild(root,f.project.id,t.id,JSON.stringify(blueprint()));savePrevisDocument(f.project.id,'world',{plan:f.world},0);assert.equal(readBuild(f.project.id,t.id).sourceCurrent,false);assert.throws(()=>applyBuild(f.project.id,t.id),/已变化/);assert.ok(readBuild(f.project.id,t.id).candidate);
});
test('invalid returns remain inspectable, can be corrected and never mutate world',async()=>{
 const f=await project('build-invalid');const t=createBuild(root,f.project.id,{commandId:'invalid',mode:'external',instructions:'构建'});await assert.rejects(returnBuild(root,f.project.id,t.id,'not json'));assert.equal(readBuild(f.project.id,t.id).status,'failed');assert.equal(readBuild(f.project.id,t.id).rawResult,'not json');assert.equal(readPrevisDocument(f.project.id,'world'),null);assert.equal((await returnBuild(root,f.project.id,t.id,JSON.stringify(blueprint()))).status,'ready');assert.equal(buildReturns(f.project.id,t.id).length,2);assert.throws(()=>readBuild('another',t.id),/不存在/);
});
test('human API task runs once, persists candidate without auto adopting and uses same compiler',async()=>{
 const f=await project('build-api');let calls=0;const task=createBuild(root,f.project.id,{commandId:'api-1',mode:'api',instructions:'古街扩建'},async prompt=>{calls++;assert.match(prompt,/当前剧本与世界/);return blueprint() as any;});
 for(let n=0;n<100&&['generating','compiling'].includes(readBuild(f.project.id,task.id).status);n++)await new Promise(r=>setTimeout(r,50));assert.equal(readBuild(f.project.id,task.id).status,'ready');assert.equal(calls,1);assert.equal(readPrevisDocument(f.project.id,'world'),null);
});
test('failed provider is surfaced without repeated calls or invented geometry',async()=>{
 const f=await project('build-provider-failed');let calls=0;const task=createBuild(root,f.project.id,{commandId:'failed-api',mode:'api',instructions:''},async()=>{calls++;throw new Error('模型服务不可用');});for(let n=0;n<30&&readBuild(f.project.id,task.id).status==='generating';n++)await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.match(readBuild(f.project.id,task.id).error!,/不可用/);assert.equal(readBuild(f.project.id,task.id).candidate,undefined);
});
test('declarative compiler rejects duplicate IDs, zero/oversized repetition, forged models and invalid geometry budgets',async()=>{
 const f=await project('build-invalid-geometry');for(const count of [0,101]){const b=blueprint();b.objects[0].repeat!.count=count;await assert.rejects(compileWorldBlueprint(root,f.project,f.world,b),/重复布置/);}const b=blueprint();b.locations.push(b.locations[0]);await assert.rejects(compileWorldBlueprint(root,f.project,f.world,b),/重复/);const forged=blueprint();forged.objects[0].modelId='https://untrusted/model.glb';await assert.rejects(compileWorldBlueprint(root,f.project,f.world,forged),/未导入/);const bad=blueprint();bad.modelRecipes=[{id:'custom',name:'bad',parts:[{kind:'box',size:[Infinity,2,3],position:[0,0,0]}]}];await assert.rejects(compileWorldBlueprint(root,f.project,f.world,bad),/部件尺寸/);
});

test('refinement starts from the unapplied candidate and script changes invalidate it',async()=>{
 const f=await project('build-refine');const a=createBuild(root,f.project.id,{commandId:'refine-a',mode:'external',instructions:'古街'});await returnBuild(root,f.project.id,a.id,JSON.stringify(blueprint()));
 const b=createBuild(root,f.project.id,{commandId:'refine-b',mode:'external',sourceTaskId:a.id,instructions:'客栈东移五米'});const edit=blueprint();edit.objects[0].position[0]+=5;edit.objects[0].repeat=undefined;const ready=await returnBuild(root,f.project.id,b.id,JSON.stringify(edit));assert.equal(ready.candidate!.objects.find(o=>o.id==='inn')!.position[0],15);assert.ok(ready.candidate!.objects.some(o=>o.id==='inn.1'));assert.equal(readPrevisDocument(f.project.id,'world'),null);
 f.scene.script+=' 新增了医院急诊。';dbHelpers.saveProject(f.project);assert.equal(readBuild(f.project.id,b.id).sourceCurrent,false);assert.throws(()=>applyBuild(f.project.id,b.id),/已变化/);assert.throws(()=>createBuild(root,f.project.id,{commandId:'refine-c',mode:'external',sourceTaskId:b.id,instructions:'继续'}),/已变化/);
});
test('custom structure recipes compile to LOD geometry with requested noncircular footprint',async()=>{
 const f=await project('build-recipe'),b=blueprint();b.objects[0].modelId='custom';b.modelRecipes=[{id:'custom',name:'椭圆廊柱',parts:[{kind:'cylinder',size:[2,3,5],position:[0,0,0]}]}];const r=await compileWorldBlueprint(root,f.project,f.world,b);const m=r.plan.models!.find(m=>m.name==='椭圆廊柱')!;assert.equal(m.lods.length,3);assert.ok(Math.abs(m.size[0]-2)<.01);assert.ok(Math.abs(m.size[2]-5)<.01);
});

test('library reuse inherits real inspection viewpoints without forcing duplicate cameras',async()=>{
 const f=await project('build-reuse'),plan=structuredClone(f.world);plan.locations.forEach(l=>{delete l.assetId;l.sourceSceneIds=[];});
 plan.viewpoints=[{id:'gate',name:'门洞检查',locationId:'courtyard',camera:{position:[0,2,10],target:[0,2,-5],focalLength:28},note:'检查入口'}];
 publishStudio({id:'builder-fixture-yard',expectedRevision:0,commandId:'builder-fixture-library',name:'验收庭院',description:'仅协议验收',tags:[],license:'测试自制',plan});
 const b=blueprint();b.version='world-blueprint.v1';b.locations=[];b.objects=[];b.viewpoints=[];b.reuse=[{studioId:'builder-fixture-yard',revision:1,instanceId:'reuse',origin:[100,0,0]}];
 const r=await compileWorldBlueprint(root,f.project,{...f.world,locations:[],objects:[]},b);
 assert.equal(r.plan.objects.length,plan.objects.length);assert.equal(r.plan.viewpoints![0].locationId,'reuse.courtyard');assert.deepEqual(r.plan.viewpoints![0].camera.position,[0,2,10]);assert.deepEqual(r.plan.locations[0].origin,[100,0,0]);
 b.viewpoints=[{...plan.viewpoints[0],id:'extra-check'}];const shorthand=await compileWorldBlueprint(root,f.project,{...f.world,locations:[],objects:[]},b);assert.equal(shorthand.plan.viewpoints!.find(v=>v.id==='extra-check')!.locationId,'reuse.courtyard');
 b.reuse.push({...b.reuse[0],instanceId:'second',origin:[200,0,0]});await assert.rejects(compileWorldBlueprint(root,f.project,{...f.world,locations:[],objects:[]},b),/多个影视城实例/);
 const t=createBuild(root,f.project.id,{commandId:'contract-reuse',mode:'external',instructions:'复用'});assert.match(t.prompt,/instanceId/);assert.match(t.prompt,/相对其locationId/);
});


test('build tasks expose the working agreement without invalidating geometry or rewriting frozen prompts',async()=>{
 const f=await project('build-working-agreement');
 const input={commandId:'agreement-build',mode:'external' as const,instructions:'仅做静态取景参考'};
 const legacy=createBuild(root,f.project.id,input);
 assert.equal(legacy.productionWorkingAgreement,undefined);
 const agreement='本作只粗审静态机位一轮，最多返工一轮；不用动态预演，剩余交作者。';
 dbHelpers.updateProjectMeta(f.project.id,{productionWorkingAgreement:agreement});
 const current=readBuild(f.project.id,legacy.id);
 assert.equal(current.productionWorkingAgreement,agreement);
 assert.equal(current.sourceCurrent,true);
 assert.equal(current.prompt,legacy.prompt,'old task evidence remains immutable');
 assert.equal(createBuild(root,f.project.id,input).id,legacy.id,'reading revised preferences never recreates a task');
 const next=createBuild(root,f.project.id,{...input,commandId:'agreement-build-next'});
 assert.ok(next.prompt.includes(agreement));
 assert.equal(next.sourceHash,legacy.sourceHash,'review preferences are not world geometry');
 assert.equal(readPrevisDocument(f.project.id,'world'),null);
});


test('builds consume shared scene decisions and ignore review timestamps',async()=>{
 const f=await project('build-scene-direction');
 f.scene.manualStoryboard={schemaVersion:'manual-storyboard.v1',updatedAt:1,directorPlan:{schemaVersion:'scene-director.v1',id:'brief',sourceHash:'internal',bindingHash:'internal',skillTitle:'本场方案',assetIds:[],intent:'门内外必须能互相取景',rhythm:'进门后停留',applications:[],exceptions:[],createdAt:1}};
 dbHelpers.saveProject(f.project);
 const t=createBuild(root,f.project.id,{commandId:'shared-direction',mode:'external',instructions:'按本场拍法布景'});
 assert.match(t.prompt,/门内外必须能互相取景/);
 f.scene.manualStoryboard.directorPlan!.createdAt=2;dbHelpers.saveProject(f.project);
 assert.equal(readBuild(f.project.id,t.id).sourceCurrent,true);
 f.scene.manualStoryboard.directorPlan!.intent='增加反向取景空间';dbHelpers.saveProject(f.project);
 assert.equal(readBuild(f.project.id,t.id).sourceCurrent,false);
});


test('legacy frozen builds remain current when new context fields are introduced',async()=>{
 const f=await project('build-legacy-context');
 const t=createBuild(root,f.project.id,{commandId:'legacy-context',mode:'external',instructions:'保留原任务'});
 const row=db.prepare('SELECT data FROM spatial_builds WHERE id=?').get(t.id) as {data:string};
 const stored=JSON.parse(row.data);
 for(const scene of stored.context.scenes)delete scene.productionBasis;
 delete stored.context.assetScope;
 stored.sourceHash=previsHash(stored.context);
 db.prepare('UPDATE spatial_builds SET data=? WHERE id=?').run(JSON.stringify(stored),t.id);
 assert.equal(readBuild(f.project.id,t.id).sourceCurrent,true);
});


test('background music edits do not invalidate a visual world build',async()=>{
 const f=await project('build-audio-is-unrelated');
 f.project.assets.push({id:'background-music',name:'背景音乐',type:'bgm',description:'低音'});dbHelpers.saveProject(f.project);
 const t=createBuild(root,f.project.id,{commandId:'visual-only',mode:'external',instructions:'只设计视觉布景'});
 f.project.assets.find(a=>a.id==='background-music')!.description='改为弦乐';dbHelpers.saveProject(f.project);
 assert.equal(readBuild(f.project.id,t.id).sourceCurrent,true);
});
