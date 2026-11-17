import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeStudio } from '../packages/domain/src/spatial';
import { validatePrevisWorld, validatePrevisPlan, previsFrameSourceHash } from '../packages/domain/src/previs';
import { previsFixture } from './fixtures/previs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omni-spatial-'));process.env.OMNI_DB_PATH=path.join(root,'test.db');
const {db}=await import('../src/server/db');
const {installSamples,sampleGlb}=await import('../src/server/spatial/samples');
const {listStudios,readStudio,publishStudio,validateModelReferences}=await import('../src/server/spatial/catalog');
const {inspectGlb,spatialIO}=await import('../src/server/spatial/models');
after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
test('two usable structural studios produce bounded immutable GLB resources, LODs and shared versions',async()=>{
 await installSamples(root);await installSamples(root);const studios=listStudios();assert.equal(studios.length,2);
 for(const s of studios){assert.equal(s.revision,1);assert.equal(s.plan.models?.length,2);validateModelReferences(s.plan);
  for(const m of s.plan.models!){assert.ok(m.size[1]>3);assert.equal(m.lods.length,3);assert.ok(m.lods[2].triangles<=m.lods[0].triangles);for(const l of m.lods){const file=await fs.readFile(path.join(root,l.url.replace('/media/','')));assert.equal(file.length,l.bytes);assert.ok(file.length<2*1024*1024);const doc=await spatialIO().readBinary(file);assert.ok(doc.getRoot().listMeshes().length<=3,'static parts joined by material to bound draws');}}
 }
 const s=studios[0],{revision,createdAt,...input}=s;assert.equal(publishStudio({...input,expectedRevision:0}).revision,1);
 assert.throws(()=>publishStudio({...input,name:'different',expectedRevision:0}),/同一发布编号/);
 assert.throws(()=>publishStudio({...input,commandId:'new-command',expectedRevision:0}),/已更新/);
 const next=publishStudio({...input,name:'revised',commandId:'publish-v2',expectedRevision:1});assert.equal(next.revision,2);assert.equal(readStudio(s.id,1).name,s.name);
});
test('composed worlds keep stable local IDs and shared model bytes; cross-zone source invalidation is scoped',()=>{
 const f=previsFixture('spatial'),s=readStudio('sample-ancient',1);
 let world=composeStudio(f.world,s,'ancient',[50,0,0]);world=composeStudio(world,s,'other',[150,0,0]);
 validatePrevisWorld(world,f.project);assert.equal(world.models?.length,2);assert.equal(world.instances?.length,2);
 assert.throws(()=>composeStudio(world,s,'ancient',[0,0,0]),/已使用/);
 const base=previsFrameSourceHash(f.plan,f.scene,'16:9',f.plan.frames.map(f=>f.id),1,world);
 const changed=structuredClone(world);changed.locations.find(l=>l.id==='other.street')!.origin[0]+=20;
 assert.equal(previsFrameSourceHash(f.plan,f.scene,'16:9',f.plan.frames.map(f=>f.id),1,changed),base);
 const combined={...f.plan,includedLocationIds:['other.street']};validatePrevisPlan(combined,f.scene,f.project,world);
 assert.notEqual(previsFrameSourceHash(combined,f.scene,'16:9',combined.frames.map(f=>f.id),1,world),previsFrameSourceHash(combined,f.scene,'16:9',combined.frames.map(f=>f.id),1,changed));
 changed.models![0].lods[0].url='https://attacker/model.glb';assert.throws(()=>validatePrevisWorld(changed,f.project));
 assert.deepEqual(readStudio(s.id,1),s,'project modifications never mutate library revision');
});
test('GLB import refuses external resources and malformed or animated inputs',async()=>{
 const glb=await sampleGlb('gate');assert.ok(inspectGlb(glb));assert.throws(()=>inspectGlb(new Uint8Array([1,2])));
 const json=inspectGlb(glb);json.buffers[0].uri='http://localhost/private';const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),buffer=Buffer.alloc(20+padded.length);buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(padded.length,12);buffer.writeUInt32LE(0x4e4f534a,16);padded.copy(buffer,20);assert.throws(()=>inspectGlb(buffer),/外部/);
});
test('a physical world retains context and horizon automatically; narrative worlds remain separate',async()=>{
 const {previsVisibleLocations}=await import('../packages/domain/src/previs');const {worldCoverageNotes}=await import('../packages/domain/src/spatial');const f=previsFixture('surrounding');
 const world=structuredClone(f.world);world.locations[0].spaceId='city';world.locations.push({...world.locations[0],id:'skyline',name:'城市远景',origin:[300,0,0],detailTier:'horizon',sourceSceneIds:[]});world.locations.push({...world.locations[0],id:'other-world',spaceId:'ancient',sourceSceneIds:[]});
 validatePrevisWorld(world,f.project);assert.deepEqual(previsVisibleLocations(world,f.plan).map(l=>l.id),[world.locations[0].id,'skyline']);
 const h=previsFrameSourceHash(f.plan,f.scene,'16:9',f.plan.frames.map(f=>f.id),1,world);world.locations[1].origin[0]+=20;assert.notEqual(previsFrameSourceHash(f.plan,f.scene,'16:9',f.plan.frames.map(f=>f.id),1,world),h);
 assert.ok(worldCoverageNotes(readStudio('sample-ancient').plan).some(n=>n.includes('不能当作完整街区')));
});
test('import optimization executes in a worker and preserves source',async()=>{
 const {queueModelImport}=await import('../src/server/spatial/importQueue');const bytes=await sampleGlb('gate');const m=await queueModelImport(root,bytes,'入口组件','原创测试');assert.equal((await fs.readFile(path.join(root,'spatial','sources',m.hash+'.glb'))).length,bytes.length);
 const doc=await spatialIO().readBinary(await fs.readFile(path.join(root,m.lods[0].url.replace('/media/',''))));assert.ok(doc.getRoot().listMaterials().every(m=>m.getMetallicFactor()===0),'untextured references must remain legible indoors');
});
test('complete community installs coherent facilities, reusable viewpoints and stable revisions',async()=>{
 const {installDistrict}=await import('../src/server/spatial/district');const s=await installDistrict(root) as import('../packages/domain/src/spatial').StudioRevision;const repeat=await installDistrict(root) as typeof s;
 assert.equal(s.revision,repeat.revision);assert.equal(s.plan.worldBrief?.scope,'world');assert.ok(s.plan.objects.length>350);assert.equal(s.plan.viewpoints?.length,12);assert.equal(s.plan.routes?.length,2);validateModelReferences(s.plan);
 for(const name of ['hospital','school','residential','park','shops','riverside','skyline'])assert.ok(s.plan.locations.some(l=>l.id===name));
 assert.ok(s.plan.locations.every(l=>l.spaceId==='qingshui'&&l.groundVisible===false));assert.ok(s.plan.connections!.length>=9);
 for(const m of s.plan.models!){assert.ok(m.lods[0].bytes<1024*1024);const d=await spatialIO().readBinary(await fs.readFile(path.join(root,m.lods[0].url.replace('/media/',''))));assert.equal(d.getRoot().listMaterials().length,1,'single vertex-colour material keeps model draws bounded');}
 const f=previsFixture('whole-city');const world=composeStudio(f.world,s,'city',[40,0,0]);validatePrevisWorld(world,f.project);assert.ok(world.viewpoints!.every(v=>v.locationId.startsWith('city.')));assert.ok(world.routes!.every(v=>v.locationId.startsWith('city.')));
 const malformed=structuredClone(world);malformed.routes![0].keys[1].time=0;assert.throws(()=>validatePrevisWorld(malformed,f.project));
 const hierarchy=structuredClone(f.world);hierarchy.locations.push({...hierarchy.locations[0],id:'child',parentId:hierarchy.locations[0].id});hierarchy.locations[0].parentId='child';assert.throws(()=>validatePrevisWorld(hierarchy,f.project),/循环/);
});
test('architectural openings admit a human-height camera and school has real classroom partitions',async()=>{
 const THREE=await import('three'),{cityAsset}=await import('../src/server/spatial/cityKit');const hospital=cityAsset('hospital');hospital.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,1.7,35),new THREE.Vector3(0,0,-1));const hits=ray.intersectObject(hospital,true);assert.ok(hits.length);assert.ok(hits[0].point.z<0,'central entry and lobby aisle must not be blocked by a wall or bench');
 const school=cityAsset('school');school.updateMatrixWorld(true);const roomRay=new THREE.Raycaster(new THREE.Vector3(-12,1.7,-2),new THREE.Vector3(1,0,0));assert.ok(roomRay.intersectObject(school,true)[0].distance<10,'classrooms must not be a single 52-metre hall');
 for(const group of [hospital,school])group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
});
test('articulated sockets follow actor poses and held props; pivot stays fixed while opening a door',async()=>{
 const THREE=await import('three');const {SpatialRuntime}=await import('../src/components/spatial/spatialRuntime');const f=previsFixture('sockets');
 const actor={id:'a',label:'演员',kind:'actor' as const,position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],size:[.6,1.8,.4] as [number,number,number],color:'#aabbcc',pose:'stand' as const};
 const prop={...actor,id:'prop',kind:'box' as const,size:[.1,.1,.4] as [number,number,number],attachment:{objectId:'a',socket:'rightHand' as const}};const door={...prop,id:'door',attachment:undefined,size:[1,2,.1] as [number,number,number],pivot:[-.5,0,0] as [number,number,number]};
 const plan={...f.plan,frames:f.plan.frames.map(f=>({...f,states:{}})),objects:[actor,prop,door]};validatePrevisPlan(plan,f.scene,f.project,f.world);const rt=new SpatialRuntime(f.world,plan);rt.update();const before=rt.object('prop')!.position.clone();const frame={...plan.frames[0],states:{a:{pose:'reach' as const},door:{rotation:[0,Math.PI/2,0] as [number,number,number]}}};rt.update(frame,0);const hand=rt.object('a')!.getObjectByName('socket:rightHand')!.getWorldPosition(new THREE.Vector3());assert.ok(rt.object('prop')!.position.distanceTo(hand)<.00001);assert.ok(before.distanceTo(hand)>.1);assert.deepEqual(rt.object('door')!.position.toArray(),[-.5,0,0]);
 const moved={...frame,states:{...frame.states,a:{pose:'reach' as const,rightArm:[.5,.2,0] as [number,number,number]}}};rt.update(moved,0);const movedHand=rt.object('a')!.getObjectByName('socket:rightHand')!.getWorldPosition(new THREE.Vector3());assert.ok(movedHand.distanceTo(hand)>.1,'explicit arm direction changes hand position');assert.ok(rt.object('prop')!.position.distanceTo(movedHand)<.00001,'held prop follows the animated hand');rt.dispose();
 assert.throws(()=>validatePrevisPlan({...plan,objects:[actor,{...prop,attachment:{objectId:'missing',socket:'rightHand'}}]},f.scene,f.project,f.world),/挂点/);
});
test('physical studio connections retain surroundings while partial reuse does not import excluded locations',async()=>{
 const {previsVisibleLocations}=await import('../packages/domain/src/previs');const f=previsFixture('links'),s=readStudio('sample-ancient',1);const world=composeStudio(f.world,s,'part',[50,0,0],['street']);assert.ok(world.locations.some(l=>l.id==='part.street'));assert.ok(!world.locations.some(l=>l.id==='part.court'));assert.equal(world.connections?.length,0);validatePrevisWorld(world,f.project);
 world.connections=[{id:'portal',from:'courtyard',to:'part.street',kind:'narrative',note:'穿越转场'}];assert.deepEqual(previsVisibleLocations(world,f.plan).map(l=>l.id),['courtyard']);world.connections[0].kind='physical';assert.deepEqual(previsVisibleLocations(world,f.plan).map(l=>l.id),['courtyard','part.street']);
 assert.throws(()=>composeStudio(world,s,'invalid',[0,0,0],['missing']),/不存在/);
});
