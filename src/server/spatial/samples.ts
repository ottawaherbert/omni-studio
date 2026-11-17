import * as THREE from 'three';
import { Document } from '@gltf-transform/core';
import { spatialIO, importSpatialModel } from './models';
import { listStudios, publishStudio, saveModel } from './catalog';
import type { PrevisWorldPlan, PrevisVector } from '../../../packages/domain/src/previs';

/** Authored architectural kit. Walls are constructed around apertures, never opaque boxes over doors. */
export function architecturalSample(kind: 'inn'|'tower'|'gate'|'pavilion') {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({color:'#b9bfc1'}), trim = new THREE.MeshStandardMaterial({color:'#707a7e'}), roof = new THREE.MeshStandardMaterial({color:'#4b565c'});
  const add = (g: THREE.BufferGeometry, p: number[], m = stone, rotation = 0) => { const mesh = new THREE.Mesh(g,m); mesh.position.set(p[0],p[1],p[2]); mesh.rotation.z=rotation; group.add(mesh); };
  const box = (w:number,h:number,d:number,x:number,y:number,z:number,m=stone) => add(new THREE.BoxGeometry(w,h,d),[x,y,z],m);
  const column = (x:number,z:number,h:number,y=0) => { add(new THREE.CylinderGeometry(.14,.18,h,12),[x,y+h/2,z],trim); box(.5,.2,.5,x,y+.1,z); };
  const wall = (z:number,y:number,door=false) => {
    // Repeated pier + lintel rhythm leaves real windows and a 2.4 m doorway.
    for (const x of [-5.85,-3.8,3.8,5.85]) box(.3,3,.3,x,y+1.5,z);
    for (const x of [-4.8,4.8]) { box(1.8,.8,.3,x,y+.4,z); box(1.8,.5,.3,x,y+2.75,z); box(1.8,.1,.5,x,y+.85,z,trim); }
    box(7.3,.5,.3,0,y+2.75,z); if(!door) box(7.3,.8,.3,0,y+.4,z);
    if(door) {box(2.35,2.5,.3,-2.5,y+1.25,z);box(2.35,2.5,.3,2.5,y+1.25,z);}
  };
  const stairs = (x:number,z:number,base=0) => { for(let i=0;i<18;i++) box(1.8,(i+1)*3.2/18,.26,x,base+(i+1)*3.2/36,z+i*.26,trim); for(const sx of [-.95,.95]) for(let i=0;i<10;i++) box(.06,1,.06,x+sx,base+i*3.2/9+1,z+i*.48); };
  const rail = (z:number,y:number) => {box(12,.1,.12,0,y+1,z,trim); for(let i=0;i<=24;i++) box(.055,.95,.055,-6+i*.5,y+.48,z,trim);};
  if(kind==='gate') {
    for(const x of [-3.5,3.5]) {column(x,0,5);box(1,1,1,x,.5,0);} box(9,.5,1,0,4.8,0,trim);
    for(const side of [-1,1]) {const slab=new THREE.BoxGeometry(5,.18,3);add(slab,[side*2.1,5.8,0],roof,side*-.22);}
  } else if(kind==='pavilion') {
    box(8,.3,6,0,.15,0);for(const x of [-3.5,3.5])for(const z of [-2.5,2.5])column(x,z,3.6,.3);
    for(const side of [-1,1])add(new THREE.BoxGeometry(4.7,.2,7),[side*2,4.4,0],roof,side*-.3);
    box(7,.3,1,0,.7,2,trim);
  } else {
    const modern=kind==='tower', levels=modern?3:2;
    box(13,.25,11,0,-.125,0);box(3,.125,.7,0,-.1875,5.6,trim);
    for(let level=0;level<levels;level++) {
      const y=level*3.2;
      wall(-5,y);wall(5,y,level===0||!modern);
      for(const x of [-6,6]) {box(.3,3,10,x,y+1.5,0);for(const z of [-4,0,4])column(x,z,3.2,y);}
      for(const x of [-3,0,3])column(x,0,3.2,y);
      if(level<levels-1) { // Upper floors retain a stairwell in the rear-right corner.
        box(9,.2,10,-1.5,y+3.1,0);box(3,.2,4.8,4.5,y+3.1,2.6); stairs(4.6,-4.8,y);
      }
      if(!modern&&level===1){box(13,.2,1.6,0,y,5.7);rail(6.4,y);}
    }
    if(modern) {
      box(9,.2,10.6,-1.5,9.6,0);box(3.6,.2,4.8,4.8,9.6,2.6);rail(5,9.7);rail(-5,9.7);
      // Walkable roof access and recognisable laboratory benches/equipment.
      stairs(4.6,-4.8,6.4);for(const x of [-3,0,3]) {box(1.8,.12,.9,x,.85,-3);for(const sx of [-.7,.7])box(.07,.8,.07,x+sx,.4,-3);box(.5,.55,.35,x,1.18,-3,trim);}
      box(2,.12,2,0,3.25,0,trim);
    } else {
      for(const side of [-1,1])add(new THREE.BoxGeometry(7,.25,13),[side*3.1,7.35,0],roof,side*-.3);
      box(.25,.35,13,0,8.4,0,trim);
      for(let z=-6;z<=6;z+=.5)for(const side of [-1,1])add(new THREE.BoxGeometry(7,.09,.09),[side*3.1,7.5,z],trim,side*-.3);
      for(const x of [-3,0,3]){box(1.3,.12,1.3,x,.8,2);for(const sx of [-.5,.5])box(.08,.75,.08,x+sx,.375,2);box(1.2,.45,.4,x,.225,3.2,trim);}
    }
  }
  return group;
}
export async function sampleGlb(kind: Parameters<typeof architecturalSample>[0]) {
  return groupGlb(architecturalSample(kind));
}
export async function groupGlb(root: THREE.Group) {
  const doc=new Document(), buffer=doc.createBuffer(), scene=doc.createScene('structural-set');
  root.updateMatrixWorld(true);
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return; const geo=o.geometry.clone().applyMatrix4(o.matrixWorld), p=doc.createPrimitive();
    for(const [name,semantic] of [['position','POSITION'],['normal','NORMAL']] as const){const a=geo.getAttribute(name);if(a)p.setAttribute(semantic,doc.createAccessor('',buffer).setType('VEC3').setArray(new Float32Array(a.array)));}
    if(geo.index)p.setIndices(doc.createAccessor('',buffer).setType('SCALAR').setArray(new Uint32Array(geo.index.array)));
    const m=o.material as THREE.MeshStandardMaterial; p.setMaterial(doc.createMaterial().setBaseColorFactor([m.color.r,m.color.g,m.color.b,1]).setRoughnessFactor(.9).setMetallicFactor(0));
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(p))); geo.dispose();
  });
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
  return spatialIO().writeBinary(doc);
}
let installing:Promise<void>|undefined;
export function installSamples(root:string) {
  if(installing)return installing;
  installing=(async()=>{
    for(const category of ['ancient','modern'] as const){const id=`sample-${category}`, current=listStudios().find(s=>s.id===id);if(current?.commandId===`install-${id}-v3`)continue;
      const primary=saveModel(await importSpatialModel(root,await sampleGlb(category==='ancient'?'inn':'tower'),category==='ancient'?'双层客栈':'现代实验楼','Omni 原创参数化建筑，可在本系统复用和改造'));
      const secondary=saveModel(await importSpatialModel(root,await sampleGlb(category==='ancient'?'gate':'pavilion'),category==='ancient'?'街口牌楼':'庭院凉亭','Omni 原创参数化建筑，可在本系统复用和改造'));
      const locations=[{id:'street',spaceId:'sample-lot',detailTier:'shootable' as const,usage:'建筑组件试拍',name:category==='ancient'?'客栈街区':'实验楼园区',description:category==='ancient'?'街道、可进入双层客栈、楼梯及二层回廊。门洞朝 +Z。':'可进入实验楼、逐层楼梯、实验台及屋顶。入口朝 +Z。',origin:[0,0,0] as PrevisVector,ground:[44,32] as [number,number],sourceSceneIds:[]},{id:'court',spaceId:'sample-lot',detailTier:'context' as const,usage:'组件陈列与入口',name:'院落与入口',description:'与主街区共用物理坐标，可跨区取景。',origin:[0,0,27] as PrevisVector,ground:[44,22] as [number,number],sourceSceneIds:[]}];
      const objects:PrevisWorldPlan['objects']=[];
      for(const [i,x] of [-14,0,14].entries())objects.push({id:`building-${i}`,label:`${primary.name} ${i+1}`,kind:'model',modelId:primary.id,locationId:'street',position:[x,0,-4],rotation:[0,0,0],size:primary.size,color:'#b9bfc1',pose:'stand'});
      objects.push({id:'entry',label:secondary.name,kind:'model',modelId:secondary.id,locationId:'court',position:[0,0,0],rotation:[0,0,0],size:secondary.size,color:'#b9bfc1',pose:'stand'});
      publishStudio({id,expectedRevision:current?.revision||0,commandId:`install-${id}-v3`,name:category==='ancient'?'建筑组件 · 双层客栈':'建筑组件 · 现代实验楼',description:locations[0].description,tags:category==='ancient'?['古代','街道','客栈','室内','楼梯','院落']:['现代','都市','实验室','楼梯','屋顶'],license:'Omni 原创示范，可复用与改造。无贴图结构模型，不是最终美术资产。',plan:{schemaVersion:'previs-world.v1',worldBrief:{scope:'component',description:'结构模型与性能测试组件，不是建成街区或影视城。',geography:'',circulation:'',services:'',skyline:'',gaps:['缺少完整道路、地块组织与生活配套','缺少周边街区和地平线，不能验收为完整世界']},title:category==='ancient'?'客栈街区':'实验楼园区',description:locations[0].description,locations,objects,models:[primary,secondary],connections:[{id:'street-court',from:'street',to:'court',kind:'physical',note:'同一地面，主街区南侧连接院落；拍摄时可显式同时选入。'}]}});
    }
  })().finally(()=>{installing=undefined;});return installing;
}
