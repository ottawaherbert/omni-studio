import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SpatialRuntime } from '../src/components/spatial/spatialRuntime';
import { buildPrevisObject } from '../src/components/spatial/previsRenderer';
import { inspectSnapshot } from '../src/components/spatial/contactInspection';
import { contactPart, inspectContacts, surfaceAt } from '../src/components/spatial/spatialPhysics';
import { samplePrevisFrame, type PrevisObject, type PrevisPlan, type PrevisWorldPlan } from '../packages/domain/src/previs';

const actor = (pose: PrevisObject['pose'] = 'stand'): PrevisObject => ({ id:'performer',label:'演员',kind:'actor',size:[.6,1.8,.4],position:[0,0,0],rotation:[0,0,0],color:'#aabbcc',pose });
const world = (): PrevisWorldPlan => ({ schemaVersion:'previs-world.v1',title:'接触验收',description:'',locations:[{id:'street',name:'街道',description:'',ground:[20,20],origin:[0,0,0],sourceSceneIds:[]}],objects:[] });
const plan = (object=actor()): PrevisPlan => ({schemaVersion:'scene-previs.v1',locationId:'street',light:{position:[4,8,5],intensity:2},objects:[object],frames:[0,4].map((t,i)=>({id:`k${i}`,shotId:'shot',label:'',timeInShot:t,note:'',camera:{position:[4,2,6],target:[0,1,0],focalLength:35},states:{[object.id]:{position:[0,0,object.pose==='walk'?t*.8:0]}}}))});

test('all authored poses have a real floor contact, correct height, and distinct sitting/kneeling geometry',()=>{
  const positions=new Map<string,THREE.Vector3>();
  for(const pose of ['stand','walk','run','crouch','sit','lean','kneel','reach'] as const){
    const o=buildPrevisObject(actor(pose));o.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(o,true);
    assert.ok(Math.abs(bounds.min.y)<1e-6,`${pose} sole ${bounds.min.y}`);
    if(pose==='stand')assert.ok(Math.abs(bounds.max.y-1.8)<1e-6);
    positions.set(pose,o.getObjectByName('foot:left')!.getWorldPosition(new THREE.Vector3()));
    const box=(name:string)=>new THREE.Box3().setFromObject(o.getObjectByName(name)!,true);
    assert.ok(box('neck').intersectsBox(box('head'))&&box('neck').intersectsBox(box('torso')),`${pose} neck connects the body`);
    for(const side of ['left','right'])assert.ok(box(`ankle:${side}`).intersectsBox(box(`foot:${side}`))&&box(`ankle:${side}`).intersectsBox(box(`shin:${side}`)),`${pose} ankle connects the shoe`);
    assert.deepEqual(o.userData.actorReach,[],pose);
  }
  assert.ok(positions.get('sit')!.z-positions.get('kneel')!.z>.3);
  const kneeling=buildPrevisObject(actor('kneel'));kneeling.updateMatrixWorld(true);assert.ok(kneeling.getObjectByName('knee:left')!.getWorldPosition(new THREE.Vector3()).y<.08);
});
test('a moving actor plants each stance foot, bends knees, and stays grounded across scrub order',()=>{
  const p=plan(actor('walk')),r=new SpatialRuntime(world(),p),uuid=r.object('performer')!.uuid;
  const previous=new Map<string,THREE.Vector3>();
  for(let i=0;i<=240;i++){
    const t=i/60;r.update(samplePrevisFrame(p,'shot',t),t);const root=r.object('performer')!;
    for(const c of root.userData.actorContacts){const foot=root.getObjectByName(`foot:${c.side}`)!;const sole=foot.getWorldPosition(new THREE.Vector3());sole.y-=.045;
      assert.ok(sole.y>=-1e-6);if(c.grounded){assert.ok(Math.abs(sole.y)<1e-6);const old=previous.get(c.side);if(old)assert.ok(sole.distanceTo(old)<1e-5,`${c.side} stance slides`);previous.set(c.side,sole);}else previous.delete(c.side);}
    assert.deepEqual(root.userData.actorReach,[]);
  }
  const final=new THREE.Box3().setFromObject(r.object('performer')!,true).clone();r.update(samplePrevisFrame(p,'shot',.3),.3);r.update(samplePrevisFrame(p,'shot',4),4);
  assert.ok(final.equals(new THREE.Box3().setFromObject(r.object('performer')!,true)));assert.equal(r.object('performer')!.uuid,uuid);r.dispose();
});
test('surface following uses the actual raised support without changing saved actor coordinates',()=>{
  const w=world();w.objects.push({id:'paving',locationId:'street',label:'18厘米路面',kind:'box',size:[8,.18,8],position:[0,0,0],rotation:[0,0,0],color:'#aaaaaa',pose:'stand'});
  const o=actor();o.grounding={mode:'surface',maxStep:.35};const p=plan(o),before=JSON.stringify(p),r=new SpatialRuntime(w,p);r.update(p.frames[0]);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(r.object(o.id)!,true).min.y-.18)<1e-6);
  assert.deepEqual(r.inspect().filter(i=>i.severity==='error'),[]);assert.equal(JSON.stringify(p),before);r.dispose();
  const bad=plan(actor()),b=new SpatialRuntime(w,bad);b.update(bad.frames[0]);assert.ok(b.inspect().some(i=>i.kind==='penetration'));b.dispose();
});
test('mesh narrow phase allows a genuine doorway and catches enclosed geometry',()=>{
  const pieces=[new THREE.BoxGeometry(1,3,.2).translate(-1.1,1.5,0),new THREE.BoxGeometry(1,3,.2).translate(1.1,1.5,0),new THREE.BoxGeometry(1.2,.5,.2).translate(0,2.75,0)];
  const door=mergeGeometries(pieces)!,probe=new THREE.BoxGeometry(.5,1.8,.3).translate(0,.9,0);
  const part=(id:string,g:THREE.BufferGeometry,m=new THREE.Matrix4())=>contactPart(id,id,'mesh',g,m);
  assert.deepEqual(inspectContacts([part('door',door),part('actor',probe)],{objectIds:['actor']}),[]);
  assert.ok(inspectContacts([part('wall',new THREE.BoxGeometry(4,4,4)),part('prop',new THREE.BoxGeometry(.1,.1,.1))],{objectIds:['prop']}).some(i=>i.kind==='penetration'));
});
test('hand targets solve an elbow, flag unreachable targets, and move held props; release changes coordinate space',()=>{
  const p=plan(),prop:PrevisObject={id:'lamp',label:'灯',kind:'box',size:[.04,.1,.04],position:[2,1,0],rotation:[0,0,0],color:'#dddddd',pose:'stand'};p.objects.push(prop);
  p.frames[0].states.performer={rightHand:[.3,1.1,.4]};p.frames[0].states.lamp={attachment:{objectId:'performer',socket:'rightHand'},position:[0,0,0]};
  p.frames[1].states.performer={rightHand:[.4,1.15,.45]};p.frames[1].states.lamp={attachment:null,position:[.4,1.15,.45]};
  const r=new SpatialRuntime(world(),p);r.update(samplePrevisFrame(p,'shot',0),0);
  const hand=r.object('performer')!.getObjectByName('socket:rightHand')!.getWorldPosition(new THREE.Vector3());assert.ok(hand.distanceTo(new THREE.Vector3(.3,1.1,.4))<1e-5);assert.ok(r.object('lamp')!.position.distanceTo(hand)<1e-5);
  assert.deepEqual(samplePrevisFrame(p,'shot',2).states.lamp.position,[0,0,0]);r.update(samplePrevisFrame(p,'shot',4),4);assert.ok(r.object('lamp')!.position.distanceTo(new THREE.Vector3(.4,1.15,.45))<1e-5);
  r.update({...p.frames[0],states:{performer:{rightHand:[3,1,0]}}});assert.ok(r.inspect().some(i=>i.kind==='unreachable'));r.dispose();
});
test('a shot reports a thin-wall collision between safe endpoint keys, with shot/time/source identity',async()=>{
  const w=world();w.objects.push({id:'thin-wall',label:'薄墙',kind:'box',locationId:'street',position:[0,0,0],rotation:[0,0,0],size:[4,2,.01],color:'#aaaaaa',pose:'stand'});
  const p=plan();p.frames[0].states.performer={position:[0,0,-2]};p.frames[1].states.performer={position:[0,0,2]};
  const report=await inspectSnapshot({world:w,sourceHash:'saved-source',fps:24,timeline:{world:w,aspectRatio:'16:9',sourceHash:'saved-source',duration:4,shots:[{sceneId:'scene',episodeId:'episode',shotId:'shot',label:'',start:0,duration:4,plan:p}]}});
  assert.equal(report.passed,false);assert.ok(report.sampledFrames>24*4);assert.ok(report.issues.some(i=>i.kind==='penetration'&&i.otherId==='thin-wall'&&i.shotId==='shot'&&i.time!>0&&i.endTime!<4));assert.equal(report.sourceHash,'saved-source');
});
test('attachment keeps the prop dimensions on a resized performer and after release',()=>{
  const a=actor();a.size=[.9,2.1,.5];const p=plan(a);p.objects.push({id:'prop',label:'物件',kind:'box',size:[.1,.2,.3],position:[0,0,0],rotation:[0,0,0],pose:'stand',color:'#aaaaaa',attachment:{objectId:a.id,socket:'rightHand'}});
  const r=new SpatialRuntime(world(),p);r.update({...p.frames[0],states:{performer:{rightHand:[.4,1.3,.4]}}});
  const size=new THREE.Box3().setFromObject(r.object('prop')!,true).getSize(new THREE.Vector3());assert.ok(size.distanceTo(new THREE.Vector3(.1,.2,.3))<1e-6);
  r.update({...p.frames[0],states:{prop:{attachment:null,position:[1,1,1]}}});assert.ok(r.object('prop')!.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-8);r.dispose();
});
test('unreachable seat heights are reported rather than silently lowering the seated performer',()=>{
  const o=actor('sit');o.seatHeight=1.5;const p=plan(o),r=new SpatialRuntime(world(),p);r.update(p.frames[0]);
  assert.ok(r.object(o.id)!.getObjectByName('pelvis')!.getWorldPosition(new THREE.Vector3()).y>1.5);assert.ok(r.inspect().some(i=>i.kind==='unreachable'));r.dispose();
});
test('a shelf above a foot is not mistaken for a supporting surface',()=>{
  const floor=contactPart('ground','地面','ground',new THREE.BoxGeometry(4,.1,4),new THREE.Matrix4().makeTranslation(0,-.05,0),false,true);
  const bench=contactPart('bench','长椅','model',new THREE.BoxGeometry(2,.1,2),new THREE.Matrix4().makeTranslation(0,.55,0));
  assert.ok(Math.abs(surfaceAt([floor,bench],new THREE.Vector3(),0,.65,[],.002)!.height)<1e-8);
});
test('changed keyframes update the retained rig, and reachable self-penetrating hand targets are rejected',()=>{
  const p=plan(),r=new SpatialRuntime(world(),p),next=structuredClone(p);next.frames[0].states.performer={rightHand:[.3,1.1,.4]};r.setPlan(next);r.update(next.frames[0]);assert.ok(r.object('performer')!.getObjectByName('socket:rightHand')!.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(.3,1.1,.4))<1e-6);
  r.update({...next.frames[0],states:{performer:{rightHand:[0,1.35,0]}}});assert.ok(r.inspect().some(i=>i.kind==='penetration'&&i.otherId==='performer'));r.dispose();
});
test('a smooth squat/kneel/stand transition preserves the stance footprint',()=>{
  const p=plan();p.frames[0].states.performer={pose:'crouch'};p.frames[1].states.performer={pose:'kneel'};const r=new SpatialRuntime(world(),p);
  let start:THREE.Vector3|undefined;
  for(let i=0;i<=120;i++){const t=i/30;r.update(samplePrevisFrame(p,'shot',t),t);const foot=r.object('performer')!.getObjectByName('foot:left')!.getWorldPosition(new THREE.Vector3());start??=foot.clone();assert.ok(foot.distanceTo(start)<1e-6);assert.ok(new THREE.Box3().setFromObject(r.object('performer')!,true).min.y>=-1e-6);}
  r.dispose();
});
