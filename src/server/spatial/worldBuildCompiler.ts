import * as THREE from 'three';
import type { Project } from '../../types/project';
import type { PrevisWorldPlan, PrevisVector } from '../../../packages/domain/src/previs';
import type { SpatialModel } from '../../../packages/domain/src/spatial';
import { composeStudio } from '../../../packages/domain/src/spatial';
import type { WorldBlueprint, WorldBuildPart } from '../../../packages/domain/src/worldBuild';
import { readModel, readStudio, saveModel, listModels } from './catalog';
import { CityKit, cityAsset } from './cityKit';
import { architecturalSample, groupGlb } from './samples';
import { queueModelImport } from './importQueue';
import { worldBuildKits } from './worldBuildContract';
import { validateWorldSave } from './worldSave';
const validId=(s:unknown):s is string=>typeof s==='string'&&/^[\w\u3400-\u9fff:.-]{1,140}$/u.test(s);
const vector=(v:unknown,positive=false):v is PrevisVector=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=(positive ? 0.01 : -1000)&&n<=1000);
function kit(name:string){if(!Object.hasOwn(worldBuildKits,name))throw new Error(`未知结构组件：${name}`);return ['inn','tower','gate','pavilion'].includes(name)?architecturalSample(name as 'inn'):cityAsset(name);}
function validatePart(p:WorldBuildPart){if(!p||!['box','cylinder','stairs','kit'].includes(p.kind)||!vector(p.size,true)||!vector(p.position)||p.rotation&&!vector(p.rotation)||p.color&&!/^#[\da-f]{6}$/i.test(p.color)||p.kind==='kit'&&!Object.hasOwn(worldBuildKits,p.kit||''))throw new Error('自定义结构部件尺寸、形状或变换无效。');}
function recipe(parts:WorldBuildPart[]){const group=new THREE.Group();for(const p of parts){let object:THREE.Object3D;if(p.kind==='kit')object=kit(p.kit!);else{const k=new CityKit();const [w,h,d]=p.size;if(p.kind==='box')k.box(w,h,d,0,h/2,0,p.color);else if(p.kind==='cylinder')k.cylinder(w/2,h,0,h/2,0,p.color);else for(let i=0;i<16;i++)k.box(w,h*(i+1)/16,d/16,0,h*(i+1)/32,-d/2+d*(i+.5)/16,p.color);object=k.group;}
 object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());const wrapper=new THREE.Group();object.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));wrapper.add(object);if(p.kind==='kit'||p.kind==='cylinder')wrapper.scale.set(...p.size.map((n,i)=>n/Math.max(.001,size.getComponent(i))) as PrevisVector);wrapper.position.fromArray(p.position);wrapper.rotation.fromArray([...(p.rotation||[0,0,0]),'XYZ']);group.add(wrapper);}return group;}
function upsert<T extends {id:string}>(prior:T[], additions:T[], label:string):T[]{if(!Array.isArray(additions)||new Set(additions.map(x=>x?.id)).size!==additions.length||additions.some(x=>!validId(x?.id)))throw new Error(`${label}编号缺失或重复。`);const map=new Map(prior.map(x=>[x.id,x]));additions.forEach(x=>map.set(x.id,x));return [...map.values()];}
export async function compileWorldBlueprint(root:string,project:Project,base:PrevisWorldPlan,raw:unknown):Promise<{plan:PrevisWorldPlan;summary:string}>{
 const b=raw as WorldBlueprint;
 if(b&&typeof b==='object'&&!Array.isArray(b)){const unknown=Object.keys(b).filter(k=>!['version','summary','worldBrief','locations','objects','viewpoints','routes','connections','reuse','modelRecipes'].includes(k));if(unknown.length)throw new Error(`返回包含非建造字段：${unknown.join('、')}。请返回本剧的 summary/worldBrief/locations/objects/viewpoints 等实际方案，不能复制接口说明。`);}
 if(!b||b.version!==undefined&&b.version!=='world-blueprint.v1'||Object.keys(b).some(k=>!['version','summary','worldBrief','locations','objects','viewpoints','routes','connections','reuse','modelRecipes'].includes(k))||typeof b.summary!=='string'||!b.summary.trim()||b.summary.length>8000||!b.worldBrief||!Array.isArray(b.locations)||b.locations.length>200||!Array.isArray(b.objects)||b.objects.length>3000||!Array.isArray(b.viewpoints))throw new Error('构建结果需包含说明、世界规划、地点、布景和实际检查机位。');
 const recipes=b.modelRecipes||[];if(!Array.isArray(recipes)||recipes.length>40||new Set(recipes.map(r=>r?.id)).size!==recipes.length||recipes.reduce((n,r)=>n+(r.parts?.length||0),0)>1600)throw new Error('自定义模型数量或部件预算超限。');
 for(const r of recipes){if(!validId(r.id)||r.id.startsWith('kit:')||typeof r.name!=='string'||r.name.length>160||!Array.isArray(r.parts)||!r.parts.length||r.parts.length>240)throw new Error('自定义结构模型格式无效。');r.parts.forEach(validatePart);}
 let plan=structuredClone(base);
 const reusedLocations=new Map<string,string[]>();
 if(!Array.isArray(b.reuse||[])||(b.reuse?.length||0)>20)throw new Error('影视城复用列表无效。');
 for(const r of b.reuse||[]){if(!validId(r.instanceId)||!vector(r.origin))throw new Error('复用编号或位置无效。');const studio=readStudio(r.studioId,r.revision);plan=composeStudio(plan,studio,r.instanceId,r.origin,r.locationIds);for(const l of studio.plan.locations.filter(l=>!r.locationIds||r.locationIds.includes(l.id)))reusedLocations.set(l.id,[...(reusedLocations.get(l.id)||[]),`${r.instanceId}.${l.id}`]);}
 // A library-local reference is unambiguous for a single newly reused instance.
 // Resolve it once at the compiler boundary; multiple instances require an
 // explicit qualified ID and must never be chosen based on array order.
 const locationReference=(id:string)=>{if(plan.locations.some(l=>l.id===id)||b.locations.some(l=>l.id===id))return id;const matches=reusedLocations.get(id)||[];if(matches.length>1)throw new Error(`地点 ${id} 对应多个影视城实例，请使用完整编号：${matches.join('、')}`);return matches[0]||id;};
 const models=new Map<string,SpatialModel>((plan.models||[]).map(m=>[m.id,m]));const aliases=new Map<string,SpatialModel>();
 // Validate IDs/repetition before spending time on mesh processing.
 const objects:PrevisWorldPlan['objects']=[];
 for(const object of b.objects){const {repeat,...o}=object;const count=repeat?.count??1;if(repeat&&(!Number.isSafeInteger(count)||count<1||count>100||!vector(repeat.step)))throw new Error('重复布置需1–100个及有效步长。');if(!vector(o.position))throw new Error('布景位置无效。');for(let i=0;i<count;i++)objects.push({...o,id:i?`${o.id}.${i}`:o.id,position:o.position.map((v,k)=>v+(repeat?.step[k]||0)*i) as PrevisVector});if(objects.length>3000)throw new Error('展开后超过3000件布景，请按街区划分。');}
 plan.locations=upsert(plan.locations,b.locations.map(l=>({...l,...(l.parentId?{parentId:locationReference(l.parentId)}:{})})),'地点');plan.objects=upsert(plan.objects,objects.map(o=>({...o,locationId:locationReference(o.locationId)})),'布景');plan.viewpoints=upsert(plan.viewpoints||[],b.viewpoints.map(v=>({...v,locationId:locationReference(v.locationId)})),'检查机位');plan.routes=upsert(plan.routes||[],(b.routes||[]).map(r=>({...r,locationId:locationReference(r.locationId)})),'巡视路线');plan.connections=upsert(plan.connections||[],(b.connections||[]).map(c=>({...c,from:locationReference(c.from),to:locationReference(c.to)})),'空间连接');plan.worldBrief=b.worldBrief;
 for(const v of plan.viewpoints||[])if(!plan.locations.some(l=>l.id===v.locationId))throw new Error(`检查机位“${v.name}”引用的地点 ${v.locationId} 不存在；请选择当前世界或复用实例中的实际地点编号。`);
 for(const o of plan.objects){if(o.kind!=='model'||!o.modelId)continue;if(models.has(o.modelId))continue;if(aliases.has(o.modelId)){o.modelId=aliases.get(o.modelId)!.id;continue;}
  const key=o.modelId,r=recipes.find(r=>r.id===key);let model:SpatialModel;
  if(key.startsWith('kit:')||r){const name=key.startsWith('kit:')?`Omni 结构组件 v1 · ${key.slice(4)}`:r!.name;const cached=key.startsWith('kit:')?listModels().find(m=>m.name===name):undefined;model=cached||saveModel(await queueModelImport(root,await groupGlb(r?recipe(r.parts):kit(key.slice(4))),name,'Omni 结构组件及声明式模型；项目用途参考，原件保留'));}
  else model=readModel(key);
  models.set(model.id,model);aliases.set(key,model);o.modelId=model.id;
 }
 plan.models=[...models.values()];validateWorldSave(project,plan);
 if(!plan.viewpoints?.length)throw new Error('请提供实际检查机位，或复用带有检查机位的影视城。');
 return {plan,summary:b.summary};
}
