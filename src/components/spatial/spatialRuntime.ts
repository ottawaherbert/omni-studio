import * as THREE from 'three';
import { mergeSpatialCluster, geometryBytes } from './spatialClusters';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildPrevisScene, disposePrevisScene } from './previsRenderer';
import { updateActorRig, rigidSocketMatrix } from './actorRig';
import { actorMotion } from './actorMotion';
import { contactPart, surfaceAt, inspectContacts, solePoints, contactTolerance, type ContactPart } from './spatialPhysics';
import { previsVisibleLocations, type PrevisWorldPlan, type PrevisPlan, type PrevisFrame, type PrevisObject, type PrevisContactIssue } from '../../clients/previsClient';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
type PoolItem = { refs:number; promise:Promise<THREE.Group>; value?:THREE.Group };
const pool=new Map<string,PoolItem>();
function release(url:string){const item=pool.get(url);if(!item)return;if(--item.refs===0){pool.delete(url);void item.promise.then(root=>disposeModel(root)).catch(()=>{});}}
function disposeModel(root:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);}}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());}
async function acquire(url:string){let item=pool.get(url);if(!item){item={refs:0,promise:loader.loadAsync(url).then(g=>g.scene)};pool.set(url,item);}item.refs++;try{return await item.promise;}catch(e){release(url);throw e;}}
export const spatialPoolStats=()=>({resources:pool.size,references:[...pool.values()].reduce((n,p)=>n+p.refs,0)});

type Batch={ mesh:THREE.InstancedMesh; ids:string[]; locals:THREE.Matrix4[] };
type Zone={id:string;base:THREE.Vector3;models:Map<string,{level:number;url:string;batches:Batch[]}>};
/** One persistent scene. Geometry is loaded once; animation changes matrices, not scenes. */
export class SpatialRuntime {
  readonly scene:THREE.Scene;
  private zones:Zone[]=[];
  private raw=new Map<string,PrevisObject>();
  private roots=new Map<string,THREE.Object3D>();
  private frame?:PrevisFrame;
  private time=0;
  private disposed=false;
  private loading?:Promise<void>;
  private clusters:THREE.Mesh[]=[];
  private clusterCache=new Map<string,{signature:string;mesh:THREE.Mesh}>();
  private clusterKey='';
  private frozenCameras?:THREE.Vector3[];
  private staticInitialized=false;
  private supportParts?:ContactPart[];
  readonly diagnostics={loadedBytes:0,modelInstances:0,loading:false,error:'',sceneBuilds:1,geometryBytes:0,clusters:0,budgetWarning:''};
  constructor(readonly world:PrevisWorldPlan,public plan?:PrevisPlan){
    this.scene=buildPrevisScene({...world,objects:world.objects.filter(o=>o.kind!=='model')},plan?{...plan,objects:plan.objects.filter(o=>o.kind!=='model')}:undefined);
    const primary=world.locations.find(l=>l.id===plan?.locationId);
    for(const l of previsVisibleLocations(world,plan)){
      const base=new THREE.Vector3(...l.origin);if(primary)base.sub(new THREE.Vector3(...primary.origin));
      this.zones.push({id:l.id,base,models:new Map()});
      for(const o of world.objects.filter(o=>o.locationId===l.id))this.addRoot(o,base);
    }
    if(plan){this.zones.push({id:'__stage',base:new THREE.Vector3(),models:new Map()});for(const o of plan.objects)this.addRoot(o,new THREE.Vector3());}
  }
  private addRoot(o:PrevisObject,base:THREE.Vector3){this.raw.set(o.id,o);let root=this.scene.children.find(c=>c.userData.objectId===o.id);if(!root){root=new THREE.Group();root.userData.objectId=o.id;this.scene.add(root);}root.userData.base=base;this.roots.set(o.id,root);root.position.fromArray(o.position).add(base).add(new THREE.Vector3(...(o.pivot||[0,0,0])));root.rotation.set(...o.rotation);}
  object(id:string){return this.roots.get(id);}
  setPlan(plan?:PrevisPlan){if(plan===this.plan)return;this.plan=plan;this.staticInitialized=false;this.clusterKey='';}
  /** Stable IDs survive GPU batching and LOD changes. */
  hit(intersection:THREE.Intersection){const ranges=intersection.object.userData.spatialRanges;if(ranges)return ranges.find((r:{end:number})=>(intersection.faceIndex||0)<r.end)?.id;if(intersection.object instanceof THREE.InstancedMesh)return intersection.object.userData.ids?.[intersection.instanceId!];let o:THREE.Object3D|null=intersection.object;while(o&&!o.userData.objectId)o=o.parent;return o?.userData.objectId;}
  update(frame?:PrevisFrame,time=0){this.frame=frame;this.time=time;this.supportParts=undefined;
    for(const [id,raw]of this.raw){if(this.staticInitialized&&!this.plan?.objects.some(o=>o.id===id)&&!this.plan?.frames.some(f=>f.states[id]))continue;let root=this.roots.get(id)!;const state=frame?.states[id],pose=state?.pose||raw.pose;
      root.visible=state?.visible!==false;root.scale.set(1,1,1);root.position.fromArray(state?.position||raw.position).add(root.userData.base).add(new THREE.Vector3(...(raw.pivot||[0,0,0])));root.rotation.set(...(state?.rotation||raw.rotation));
      if(raw.kind==='actor'){
        const motion=actorMotion(this.plan,raw,frame);
        updateActorRig(root,raw,{...state,pose:motion.pose||pose},time,{...motion,...(raw.grounding?.mode==='surface'?{support:(point:THREE.Vector3,y:number,step:number)=>this.supportAt(point,y,step,id)}:{})});
      }root.updateMatrixWorld(true);
    }
    for(const [id,raw]of this.raw){const state=frame?.states[id],attachment=state?.attachment===undefined?raw.attachment:state.attachment;if(!attachment)continue;const actor=this.roots.get(attachment.objectId),socket=actor?.getObjectByName(`socket:${attachment.socket}`),root=this.roots.get(id)!;if(!socket)continue;actor!.updateMatrixWorld(true);const local=new THREE.Matrix4().compose(new THREE.Vector3(...(state?.position||raw.position)),new THREE.Quaternion().setFromEuler(new THREE.Euler(...(state?.rotation||raw.rotation))),new THREE.Vector3(1,1,1));const result=rigidSocketMatrix(socket).multiply(local);result.decompose(root.position,root.quaternion,root.scale);root.visible=actor!.visible&&state?.visible!==false;root.updateMatrixWorld(true);}
    for(const zone of this.zones)for(const entry of zone.models.values())for(const batch of entry.batches){if(this.staticInitialized&&batch.mesh.userData.initialized&&!batch.ids.some(id=>this.plan?.objects.some(o=>o.id===id)||this.plan?.frames.some(f=>f.states[id])))continue;for(let i=0;i<batch.ids.length;i++){const root=this.roots.get(batch.ids[i])!,m=root.matrixWorld.clone().multiply(batch.locals[i]);if(!root.visible)m.scale(new THREE.Vector3(0,0,0));batch.mesh.setMatrixAt(i,m);}batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.computeBoundingSphere();batch.mesh.userData.initialized=true;}
    this.staticInitialized=true;
  }
  /** Actual transformed source meshes, retaining IDs even when GPU instances are merged into HLOD. */
  contactParts():ContactPart[]{
    this.scene.updateMatrixWorld(true);const parts:ContactPart[]=[];
    for(const [id,root]of this.roots){if(!root.visible)continue;const raw=this.raw.get(id)!;if(raw.kind==='model')continue;
      root.traverse(o=>{if(o instanceof THREE.Mesh&&o.visible)parts.push(contactPart(id,raw.label,o.name||raw.kind,o.geometry,o.matrixWorld.clone(),raw.kind==='actor'));});}
    for(const zone of this.zones)for(const entry of zone.models.values())for(const batch of entry.batches)for(let i=0;i<batch.ids.length;i++){
      const id=batch.ids[i],root=this.roots.get(id);if(root?.visible)parts.push(contactPart(id,this.raw.get(id)!.label,'model',batch.mesh.geometry,root.matrixWorld.clone().multiply(batch.locals[i])));}
    for(const o of this.scene.children)if(o instanceof THREE.Mesh&&o.userData.locationId)parts.push(contactPart(`ground:${o.userData.locationId}`,'地面','ground',o.geometry,o.matrixWorld.clone(),false,true));
    return parts;
  }
  private supportAt(point:THREE.Vector3,y:number,step:number,ignore:string){
    this.supportParts??=this.contactParts().filter(p=>!p.actor&&!this.plan?.objects.some(o=>o.id===p.objectId));
    return surfaceAt(this.supportParts,point,y,step,[ignore]);
  }
  inspectionTargets(objectIds?:string[]){
    const ids=objectIds||(!this.plan?[...this.raw.keys()]:[...new Set([...this.plan.objects.map(o=>o.id),...[...this.raw.values()].filter(o=>o.kind==='actor'||this.plan!.frames.some(f=>f.states[o.id])).map(o=>o.id)])]);
    return ids.filter(id=>this.roots.get(id)?.visible);
  }
  inspect(objectIds?:string[]):PrevisContactIssue[]{
    const parts=this.contactParts(),heldBy=new Map<string,{objectId:string;socket:string}>();
    for(const [id,o]of this.raw){const state=this.frame?.states[id],attachment=state?.attachment===undefined?o.attachment:state.attachment;if(attachment)heldBy.set(id,attachment);}
    const selected=this.inspectionTargets(objectIds);
    const issues=inspectContacts(parts,{objectIds:this.plan||objectIds?selected:undefined,heldBy});
    for(const [id,raw]of this.raw){if(!this.roots.get(id)?.visible||selected.length&&!selected.includes(id))continue;const root=this.roots.get(id)!;
      if(raw.kind==='actor'){
        for(const contact of root.userData.actorContacts||[]){const foot=parts.find(p=>p.objectId===id&&p.part===`foot:${contact.side}`);if(!foot)continue;
          for(const point of solePoints(foot)){
            const surface=surfaceAt(parts,point,point.y,.65,[id,...[...heldBy].filter(([,a])=>a.objectId===id).map(([prop])=>prop)],point.y+.002);
            if(!surface){if(contact.grounded)issues.push({kind:'unsupported',severity:'error',objectId:id,part:foot.part,message:`${raw.label}的支撑脚下没有可用支撑面`,point:point.toArray() as [number,number,number]});break;}
            const gap=point.y-surface.height;
            if(gap < -contactTolerance || contact.grounded&&gap>contactTolerance*2){issues.push({kind:gap<0?'penetration':'floating',severity:'error',objectId:id,otherId:surface.objectId,part:foot.part,message:`${raw.label}的${contact.side==='left'?'左':'右'}脚${gap<0?'穿入':'悬离'}支撑面${Math.abs(gap).toFixed(3)}米`,point:point.toArray() as [number,number,number],distance:Math.abs(gap)});break;}
          }
        }
        for(const reach of root.userData.actorReach||[])issues.push({kind:'unreachable',severity:'error',objectId:id,part:reach.part,message:`${raw.label}的${reach.part}目标超出肢体可达范围${reach.error.toFixed(3)}米`,distance:reach.error});
      }
    }
    return issues;
  }
  async prepareCapture(cameras:THREE.PerspectiveCamera[]){this.frozenCameras=cameras.map(c=>c.position.clone());await this.prepare(cameras[0],true);}
  private distance(point:THREE.Vector3,camera?:THREE.PerspectiveCamera){
    if(!this.frozenCameras?.length)return camera?camera.position.distanceTo(point):0;
    let best=Infinity;for(let i=0;i<this.frozenCameras.length;i++){const a=this.frozenCameras[i],b=this.frozenCameras[i+1];best=Math.min(best,a.distanceTo(point));if(b){const segment=new THREE.Line3(a,b),nearest=segment.closestPointToPoint(point,true,new THREE.Vector3());best=Math.min(best,nearest.distanceTo(point));}}return best;
  }
  async prepare(camera?:THREE.PerspectiveCamera,capture=false){if(this.disposed)return;if(this.loading){await this.loading;if(capture)return this.prepare(camera,true);return;}
    this.loading=this.load(camera,capture);try{await this.loading;}finally{this.loading=undefined;}
  }
  private async load(camera?:THREE.PerspectiveCamera,capture=false){this.diagnostics.loading=true;this.diagnostics.error='';try{
    for(const zone of this.zones){
      const objects=zone.id==='__stage'?this.plan!.objects:this.world.objects.filter(o=>o.locationId===zone.id);
      const buckets=new Map<string,PrevisObject[]>();
      for(const o of objects.filter(o=>o.kind==='model')){const key=`${o.modelId}@${Math.floor(o.position[0]/48)},${Math.floor(o.position[2]/48)}`;buckets.set(key,[...(buckets.get(key)||[]),o]);}
      for(const [id,members] of buckets){if(this.disposed)return;const model=this.world.models?.find(m=>m.id===members[0].modelId);if(!model)throw new Error(`缺少模型资源：${id}`);
        const distance=Math.min(...members.map(o=>this.distance(new THREE.Vector3(...o.position).add(zone.base),camera)));
        const old=zone.models.get(id),effective=distance/(camera?camera.getFocalLength()/35:1);
        // Distant context must retain an actual low-detail representation, never disappear into void.
        const distant=distance>350;
        let level=distant?model.lods.length-1:capture&&distance<100?0:model.lods.reduce((level,l,i)=>effective>=l.distance?i:level,0);
        if(old&&!capture&&level!==old.level){const boundary=model.lods[Math.max(level,old.level)].distance;if(Math.abs(effective-boundary)<boundary*.12)level=old.level;}
        if(old?.level===level){old.batches.forEach(b=>{b.mesh.castShadow=distance<100;b.mesh.userData.far=distance>160;});continue;}
        const lod=model.lods[level],resource=await acquire(lod.url);if(this.disposed){release(lod.url);return;}
        if(old)this.unload(zone,id);
        resource.updateMatrixWorld(true);const batches:Batch[]=[];
        resource.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
          const mesh=new THREE.InstancedMesh(o.geometry,o.material,members.length);mesh.castShadow=distance<100;mesh.receiveShadow=true;mesh.userData.ids=members.map(o=>o.id);mesh.userData.spatialShared=true;mesh.userData.far=distance>160;
          const locals=members.map(member=>new THREE.Matrix4().makeTranslation(...(member.pivot||[0,0,0]).map(n=>-n) as [number,number,number]).multiply(new THREE.Matrix4().makeScale(...member.size.map((n,i)=>n/model.size[i]) as [number,number,number])).multiply(o.matrixWorld));
          batches.push({mesh,ids:members.map(o=>o.id),locals});this.scene.add(mesh);
        });zone.models.set(id,{level,url:lod.url,batches});
      }
    }
    this.update(this.frame,this.time);
    await this.clusterFar();
    const urls=new Set(this.zones.flatMap(z=>[...z.models.values()].map(m=>m.url)));
    this.diagnostics.loadedBytes=(this.world.models||[]).flatMap(m=>m.lods).filter(l=>urls.has(l.url)).reduce((n,l)=>n+l.bytes,0);
    this.diagnostics.modelInstances=this.zones.reduce((n,z)=>n+[...z.models.values()].reduce((n,m)=>n+(m.batches[0]?.ids.length||0),0),0);
  }catch(e){this.diagnostics.error=(e as Error).message;throw e;}finally{this.diagnostics.loading=false;}}
  private async clusterFar(){
    const batches=this.zones.flatMap(z=>[...z.models.values()].flatMap(e=>e.batches));
    const far=batches.filter(b=>b.mesh.userData.far&&!b.ids.some(id=>this.plan?.frames.some(f=>f.states[id])||this.plan?.objects.some(o=>o.id===id)));
    const signature=far.map(b=>b.mesh.uuid).join('|');if(signature===this.clusterKey)return;this.clusterKey=signature;
    const cells=new Map<string,{parts:Array<{geometry:THREE.BufferGeometry;matrix:THREE.Matrix4;id:string}>,material:THREE.Material}>();
    let budget=0;for(const b of far){const candidates:Array<{geometry:THREE.BufferGeometry;matrix:THREE.Matrix4;id:string}>=[];for(let i=0;i<b.ids.length;i++){const matrix=new THREE.Matrix4();b.mesh.getMatrixAt(i,matrix);candidates.push({geometry:b.mesh.geometry,matrix,id:b.ids[i]});}
      const cost=candidates.reduce((n,p)=>n+p.geometry.getAttribute('position').count*36+(p.geometry.index?.count||0)*4,0);if(budget+cost>96*1048576)continue;budget+=cost;
      for(const p of candidates){const v=new THREE.Vector3().setFromMatrixPosition(p.matrix),material=Array.isArray(b.mesh.material)?b.mesh.material[0]:b.mesh.material;const key=`${Math.floor(v.x/192)},${Math.floor(v.z/192)}:${(material as THREE.MeshStandardMaterial).vertexColors?'vertex':material.uuid}`;let cell=cells.get(key);if(!cell){cell={parts:[],material};cells.set(key,cell);}cell.parts.push(p);}
    }
    for(const [key,cell]of cells){if(this.disposed)return;const token=cell.parts.map(p=>`${p.id}:${p.geometry.uuid}`).join('|'),old=this.clusterCache.get(key);if(old?.signature===token)continue;
      const mesh=mergeSpatialCluster(cell.parts,cell.material.clone());if(old){this.scene.remove(old.mesh);old.mesh.geometry.dispose();(old.mesh.material as THREE.Material).dispose();}this.scene.add(mesh);this.clusterCache.set(key,{signature:token,mesh});
      // Yield between changed cells. Existing valid proxies remain visible until replacements are ready.
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    for(const [key,old]of this.clusterCache)if(!cells.has(key)){this.scene.remove(old.mesh);old.mesh.geometry.dispose();(old.mesh.material as THREE.Material).dispose();this.clusterCache.delete(key);}
    this.clusters=[...this.clusterCache.values()].map(c=>c.mesh);const covered=new Set([...cells.values()].flatMap(c=>c.parts.map(p=>p.id)));batches.forEach(b=>{b.mesh.visible=!b.ids.every(id=>covered.has(id));});
    const geometries=new Set(batches.map(b=>b.mesh.geometry));this.diagnostics.geometryBytes=[...geometries,...this.clusters.map(c=>c.geometry)].reduce((n,g)=>n+geometryBytes(g),0);this.diagnostics.clusters=this.clusters.length;this.diagnostics.budgetWarning=this.diagnostics.geometryBytes>256*1048576?'几何资源超过256MB，请拆分主体场地或优化模型':'';
  }
  private unload(zone:Zone,id:string){const entry=zone.models.get(id);if(!entry)return;for(const batch of entry.batches){this.scene.remove(batch.mesh);batch.mesh.dispose();}release(entry.url);zone.models.delete(id);}
  dispose(){if(this.disposed)return;this.disposed=true;for(const {mesh:c} of this.clusterCache.values()){this.scene.remove(c);c.geometry.dispose();(c.material as THREE.Material).dispose();}this.clusterCache.clear();this.clusters=[];for(const zone of this.zones)for(const id of [...zone.models.keys()])this.unload(zone,id);disposePrevisScene(this.scene);this.scene.clear();}
}
