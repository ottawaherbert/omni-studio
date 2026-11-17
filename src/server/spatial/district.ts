import * as THREE from 'three';
import { CityKit, cityAsset } from './cityKit';
import { groupGlb } from './samples';
import { importSpatialModel } from './models';
import { saveModel, listStudios, publishStudio } from './catalog';
import type { SpatialModel } from '../../../packages/domain/src/spatial';
import type { PrevisWorldPlan, PrevisVector, PrevisCamera } from '../../../packages/domain/src/previs';
const VERSION='district-qingshui-v5';
let installing:Promise<unknown>|undefined;
/** Authored neighborhood plan. This content pack is data, never a mandatory generation workflow. */
export function installDistrict(root:string){if(installing)return installing;installing=build(root).finally(()=>{installing=undefined;});return installing;}
async function build(root:string){
 const old=listStudios().find(s=>s.id==='qingshui-district');if(old?.commandId===VERSION)return old;
 const assets=new Map<string,{model:SpatialModel;anchor:THREE.Vector3}>();
 async function asset(key:string,group:THREE.Group,name=key){group.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(group),anchor=new THREE.Vector3((b.min.x+b.max.x)/2,b.min.y,(b.min.z+b.max.z)/2);const bytes=await groupGlb(group);const model=saveModel(await importSpatialModel(root,bytes,name,'Omni 原创结构模型，允许在本系统复用与改造'));assets.set(key,{model,anchor});return model;}
 for(const [key,name]of Object.entries({apartment:'六层住宅 · 阳台与室内',walkup:'三层社区住宅',hospital:'综合医院 · 门诊大厅与雨棚',clinic:'急诊附楼',school:'教学楼 · 外廊与教室',shop:'沿街店铺 · 独立门面',office:'九层写字楼 · 仅外景',civic:'社区服务中心',tree:'街树',lamp:'路灯',bench:'长椅',car:'小汽车代理',bus:'公交车代理',shelter:'公交站台',fence:'校园围栏',sports:'校园运动场',hill:'远景丘陵'}))await asset(key,cityAsset(key),name);
 const plan:PrevisWorldPlan={schemaVersion:'previs-world.v1',title:'清水 · 河岸社区',description:'可复用现代社区结构参考。住宅、沿街商业、学校、医院、公园与河岸共同组织；道路通向周边城区。',worldBrief:{scope:'world',description:'近现代沿河混合生活社区，用于日常、悬疑、医疗、校园与都市题材取景。建筑无贴图，按真实比例保留结构。',geography:'核心约600×600米，东侧河流、两座桥、滨河步道；外围延续街坊，远处丘陵和高层形成地平线。',circulation:'三横三纵主次路网，主干道双向通行、交叉口保留过街空间；学校主门、医院门诊/急诊/后勤及社区入口有明确联系。沿街人行道、斑马线、站台、停车区和公园步道连续。',services:'住宅社区、沿街商铺、综合医院及急诊附楼、学校教学楼与运动场、社区服务中心、公园及公交站台按相邻用地组织。',skyline:'周边街坊延续核心道路；远郊轮廓、高层组团和丘陵在高机位、街口及窗外可见，不将纯天空当背景补丁。',gaps:['写字楼和外围背景建筑仅供外景，精细特写须换用专门资产','医院为结构与门诊大厅参考，未建手术室和完整医疗设备','角色代理无面部表演；白模不能代替最终美术和动作验收']},locations:[],objects:[],connections:[],models:[],viewpoints:[],routes:[]};
 function loc(id:string,name:string,origin:PrevisVector,usage:string,tier:'shootable'|'context'|'horizon'='shootable',parentId?:string){plan.locations.push({id,name,description:usage,usage,spaceId:'qingshui',detailTier:tier,groundVisible:false,parentId,origin,ground:[160,160],sourceSceneIds:[]});return id;}
 loc('roads','清水路网',[0,0,0],'连续主次道路、街口和公交设施','context');
 loc('residential','梧桐里社区',[-95,0,-95],'六层住宅、楼间步道、公共庭院；主入口通向南侧街道');
 loc('hospital','清水综合医院',[98,0,-90],'门诊主楼、急诊附楼、门前落客、急救停车与独立后勤');
 loc('school','清水学校',[-95,0,100],'教学楼、校园主门、操场与围栏；与公共道路分隔');
 loc('park','滨城公园',[95,0,95],'步道、草地、树阵、长椅和社区服务设施');
 loc('shops','清水沿街商业',[0,0,0],'独立店铺、连续门面及街角公共空间');
 loc('riverside','清水河与滨河道',[340,0,0],'河道、驳岸、步道和两座公路桥；水面为灰阶代理','context');
 loc('outer-west','西侧生活街坊',[-265,0,0],'外围社区沿原有路网延续；仅外景','context');
 loc('outer-north','北侧城市街坊',[0,0,-275],'居住与商务混合街坊；仅外景','context');
 loc('outer-south','南侧生活街坊',[0,0,275],'延续生活社区及滨河方向道路；仅外景','context');
 loc('skyline','周边天际线',[0,0,0],'远景城市轮廓和山体，保持高机位四向环境','horizon');
 function place(key:string,id:string,locationId:string,x:number,z:number,rotation=0,y=0){const a=assets.get(key)!;const offset=a.anchor.clone().applyAxisAngle(new THREE.Vector3(0,1,0),rotation);plan.objects.push({id,locationId,label:id,kind:'model',modelId:a.model.id,position:[x+offset.x,y+offset.y,z+offset.z],rotation:[0,rotation,0],size:a.model.size,color:'#bbc1c2',pose:'stand'});}
 // Pavement and street markings are authored as a continuous network, without stacked intersections.
 const street=new CityKit();for(const x of [-180,0,180]){street.box(16,.1,720,x,-.05,0,'#6f7b80');for(const side of [-1,1])street.box(3,.18,720,x+side*9.5,.09,0,'#abb6b7');}
 for(const z of [-180,0,180]){for(const [a,b]of [[-360,-191],[-169,-11],[11,169],[191,360]]){street.box(b-a,.1,16,(a+b)/2,-.05,z,'#6f7b80');for(const side of [-1,1])street.box(b-a,.18,3,(a+b)/2,.09,z+side*9.5,'#abb6b7');}for(const x of [-180,0,180]){street.box(22,.1,22,x,-.05,z,'#6f7b80');for(const side of [-1,1])for(let t=-6;t<=6;t+=1.4){street.box(.7,.02,3,x+t,.015,z+side*13);street.box(3,.02,.7,x+side*13,.015,z+t);}}}
 for(const road of [-180,0,180])for(let t=-350;t<350;t+=9)if([-180,0,180].every(n=>Math.abs(n-t)>22)){street.box(.12,.02,4,road,.015,t,'#d2d9d7');street.box(4,.02,.12,t,.015,road,'#d2d9d7');}
 await asset('roads',street.group,'连续主次路网与人行道');place('roads','roads-network','roads',0,0);
 // Terrain tiles keep the entire ground continuous without an enormous single GLB.
 const terrain=new CityKit();terrain.box(240,.2,240,0,-.13,0,'#99a6a0');await asset('terrain',terrain.group,'地面分区');
 for(let x=-480;x<=0;x+=240)for(let z=-480;z<=480;z+=240)place('terrain',`terrain-${x}-${z}`,'skyline',x,z);
 const westBank=new CityKit();westBank.box(190,.2,240,0,-.13,0,'#99a6a0');await asset('west-bank',westBank.group,'西岸地面');const eastBank=new CityKit();eastBank.box(280,.2,240,0,-.13,0,'#99a6a0');await asset('east-bank',eastBank.group,'东岸地面');for(let z=-480;z<=480;z+=240){place('west-bank',`west-bank-${z}`,'skyline',215,z);place('east-bank',`east-bank-${z}`,'skyline',510,z);}
 // Six residential buildings face a coherent shared courtyard; entrances meet the paths below.
 for(const [i,p]of [[-40,-40],[0,-40],[40,-40],[-40,35],[0,35],[40,35]].entries())place('apartment',`住宅-${i+1}`,'residential',p[0],p[1],p[1]>0?Math.PI:0);
 const residential=new CityKit();residential.box(126,.12,5,0,.06,0,'#aeb8b9');for(const x of [-40,0,40])residential.box(3,.12,92,x,.06,-2,'#aeb8b9');residential.box(5,.12,76,0,.06,38,'#aeb8b9');residential.box(28,.12,18,0,.06,0,'#bac2c1');await asset('res-path',residential.group,'社区步道与中心庭院');place('res-path','社区步道','residential',0,0);
 for(let i=0;i<8;i++){place('bench',`社区长椅-${i}`,'residential',-30+i*9,7);place('tree',`社区树-${i}`,'residential',-30+i*9,-8);}
 // Hospital organization: public front, emergency annex west, service yard north.
 place('hospital','门诊主楼','hospital',0,-20);place('clinic','急诊附楼','hospital',-47,18,Math.PI/2);place('walkup','后勤楼','hospital',42,-48);
 const hospital=new CityKit();hospital.box(76,.12,26,0,.06,16,'#acb8ba');hospital.box(8,.1,115,-35,.02,-5,'#78888d');hospital.box(8,.1,70,42,.02,0,'#78888d');hospital.box(84,.1,7,0,.02,48,'#78888d');for(let x=-22;x<30;x+=3){hospital.box(.08,.02,5,x,.09,23,'#d4d9d8');}await asset('hospital-ground',hospital.group,'医院落客与急救后勤动线');place('hospital-ground','医院院区道路','hospital',0,0);
 for(let i=0;i<9;i++)if(Math.abs(-20+i*3)>=5)place('car',`医院停车-${i}`,'hospital',-20+i*3,23,Math.PI/2);place('car','急救车辆代理','hospital',-35,20);
 // School has a distinct external corridor, classroom furniture, sports ground and gated perimeter.
 place('school','教学楼','school',0,-40);place('civic','校园综合楼','school',-48,5,Math.PI/2);place('sports','操场','school',5,32);
 const school=new CityKit();school.box(90,.12,8,0,.06,-22,'#afb9ba');school.box(7,.12,103,0,.06,16,'#afb9ba');school.box(8,3,.35,-10,1.5,69,'#a2afb2');school.box(8,3,.35,10,1.5,69,'#a2afb2');school.box(26,.45,1,0,3.2,69,'#778b92');await asset('school-path',school.group,'校园步道与主门');place('school-path','校园入口与步道','school',0,0);
 for(let x=-65;x<=65;x+=10){if(Math.abs(x)>15)place('fence',`南围栏${x}`,'school',x,70);place('fence',`北围栏${x}`,'school',x,-65);}for(let z=-60;z<=60;z+=10)for(const side of [-1,1])place('fence',`侧围栏${side}-${z}`,'school',side*70,z,Math.PI/2);
 // Ground-floor storefronts have separate doors, awnings and shelving; no relabelled office blocks.
 for(const [i,x]of [-125,-85,-45,45,85,125].entries()){if(x<0)place('shop',`清水路商铺-${i}`,'shops',x,-20);else place('shop',`清水路商铺-${i}`,'shops',x,20,Math.PI);}
 for(const [i,z]of [-125,-85,-45,45,85,125].entries())place('shop',`西街商铺-${i}`,'shops',-205,z,Math.PI/2);
 // Park circulation and civic building, no vehicle road through the lawn.
 place('civic','社区服务中心','park',38,-43);const park=new CityKit();for(const z of [-25,25])park.box(110,.12,3,0,.06,z,'#b3bebc');for(const x of [-40,0,40])park.box(3,.12,110,x,.06,0,'#b3bebc');park.mesh(new THREE.CylinderGeometry(12,12,.15,40),[0,.075,0],'#bbc6c2');park.mesh(new THREE.CylinderGeometry(5,5,.5,32),[0,.25,0],'#8a9f9e');await asset('park-path',park.group,'公园环路与中心广场');place('park-path','公园步道','park',0,0);
 for(let i=0;i<18;i++){const angle=i*Math.PI*2/18;place('tree',`公园树-${i}`,'park',Math.cos(angle)*50,Math.sin(angle)*50);if(i%2===0)place('bench',`公园长椅-${i}`,'park',Math.cos(angle)*20,Math.sin(angle)*20,-angle);}
 // River and bridges are actual continuous geometry with walkable bridge decks and rails.
 const river=new CityKit();river.box(56,.08,960,0,-1.4,0,'#7f979f');for(const side of [-1,1]){river.box(3,1.4,960,side*29,-.7,0,'#889b9e');river.box(6,.15,960,side*33,.075,0,'#afbdbb');}
 for(const z of [0,180]){river.box(76,.4,16,0,.2,z,'#839196');for(const side of [-1,1]){river.box(76,.25,2,0,.35,z+side*9);river.rail(76,0,.5,z+side*9.8);}}
 const riverTail=new CityKit();riverTail.box(56,.08,480,0,-1.4,0,'#7f979f');for(const side of [-1,1]){riverTail.box(3,1.4,480,side*29,-.7,0,'#889b9e');riverTail.box(6,.15,480,side*33,.075,0,'#afbdbb');}await asset('river-tail',riverTail.group,'外围河道');place('river-tail','河道上游','riverside',0,-720);place('river-tail','河道下游','riverside',0,720);
 await asset('river',river.group,'清水河、驳岸、步道与双桥');place('river','河流与桥梁','riverside',0,0);
 // Roads connect bridgeheads to the city, not to a void at the edge of the render.
 const east=new CityKit();for(const z of [0,180])east.box(180,.1,16,0,-.05,z,'#78878b');await asset('eastroad',east.group,'桥东道路');place('eastroad','桥东连接','riverside',115,0);
 // Context blocks follow the road grid, with varied building functions and heights.
 for(const [area,baseX,baseZ]of [['outer-west',0,0],['outer-north',0,0],['outer-south',0,0]] as const){for(let i=0;i<8;i++){const x=area==='outer-west'?(i%2)*44-20:(i%4)*80-120,z=area==='outer-west'?Math.floor(i/2)*65-100:Math.floor(i/4)*46-20;place(i%3===0?'office':'walkup',`${area}-建筑${i}`,area,x+baseX,z+baseZ,i%2?Math.PI:0);}}
 // Planned outer blocks continue the street pattern, rather than scattering skyline buildings in a ring.
 for(const x of [-500,-410,-320,410,500])for(const z of [-500,-410,-320,320,410,500])place((Math.abs(x)+Math.abs(z))%3===0?'office':'walkup',`外围街坊-${x}-${z}`,'skyline',x,z,z>0?Math.PI:0);
 const outerRoad=new CityKit();for(const x of [-440,-270,450]){outerRoad.box(12,.1,1080,x,-.05,0,'#78878b');for(const side of [-1,1])outerRoad.box(2,.12,1080,x+side*7,.04,0,'#abb6b7');}for(const z of [-450,-270,270,450]){outerRoad.box(750,.1,12,-65,-.05,z,'#78878b');outerRoad.box(170,.1,12,455,-.05,z,'#78878b');for(const side of [-1,1])outerRoad.box(750,.12,2,-65,.04,z+side*7,'#abb6b7');}
 // Split the road mesh into bounded halves before import.
 const roadWest=new THREE.Group(),roadEast=new THREE.Group();for(const mesh of [...outerRoad.group.children]){if(mesh.position.z>0)roadEast.add(mesh);else roadWest.add(mesh);} // Each long vertical road is bounded by the GLB size contract below.
 for(const group of [roadWest,roadEast])group.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry instanceof THREE.BoxGeometry&&o.geometry.parameters.depth>1000)o.scale.z=.9;});
 await asset('outer-road-west',roadWest,'外围街坊路网A');await asset('outer-road-east',roadEast,'外围街坊路网B');place('outer-road-west','外围道路A','skyline',0,0);place('outer-road-east','外围道路B','skyline',0,0);
 // Continuous outer terrain supports high angles and the mountain foothills, without covering the river.
 for(let x=-960;x<=960;x+=240)for(let z=-960;z<=960;z+=240){if(Math.abs(z)<=480&&x>=-480&&x<=480)continue;if(x===240||x===480){place(x===240?'west-bank':'east-bank',`outer-bank-${x}-${z}`,'skyline',x===240?215:510,z);continue;}place('terrain',`outer-terrain-${x}-${z}`,'skyline',x,z);}
 for(let i=0;i<8;i++){const a=i*Math.PI/4;place('hill',`丘陵-${i}`,'skyline',Math.cos(a)*800,Math.sin(a)*800,a);}
 // Street furniture is reused through GPU instancing while retaining semantic object IDs.
 for(const road of [-180,0,180])for(let t=-300;t<=300;t+=36)if([-180,0,180].every(n=>Math.abs(n-t)>24))for(const side of [-1,1]){place('tree',`行道树-${road}-${t}-${side}`,'roads',road+side*12,t);if(side===1)place('lamp',`路灯-${road}-${t}`,'roads',road+10.8,t+5);}
 for(const [i,p]of [[13,70],[-13,-70],[80,-13],[-80,13]].entries()){place('shelter',`公交站${i}`,'roads',p[0],p[1],i>1?Math.PI/2:0);place('bus',`公交车${i}`,'roads',p[0]>0?5:-5,p[1]+5);}
 for(let i=0;i<16;i++)place('car',`道路车辆${i}`,'roads',i%2?3.5:-3.5,-300+i*36, i%2?Math.PI:0);
 for(const [from,to,note]of [['residential','roads','社区步道接入公共人行道'],['hospital','roads','门诊与急诊分别接入公共道路'],['school','roads','校园主门接南侧街道'],['park','roads','公园步道接四周人行空间'],['shops','roads','店铺沿街入口'],['roads','riverside','两座桥连接两岸'],['roads','outer-west','道路向西延续'],['roads','outer-north','道路向北延续'],['roads','outer-south','道路向南延续']])plan.connections!.push({id:`${from}-${to}`,from,to,kind:'physical',note});
 const camera=(position:PrevisVector,target:PrevisVector,focalLength=28):PrevisCamera=>({position,target,focalLength});
 const view=(id:string,name:string,locationId:string,position:PrevisVector,target:PrevisVector,note:string,focal=28)=>plan.viewpoints!.push({id,name,locationId,camera:camera(position,target,focal),note});
 view('overview','01 世界鸟瞰','roads',[420,360,480],[0,0,0],'同时检查核心社区、路网、河岸和远景',24);
 view('mainstreet','02 主街正向','roads',[3,1.7,120],[3,1.7,-160],'沿主街向北，医院、学校、商铺与街景');
 view('reverse','03 主街反向','roads',[-3,1.7,-110],[-3,1.7,180],'反向应保持同一道路与地标，不能空场');
 view('hospital-front','04 医院入口','hospital',[18,1.7,46],[0,2,-20],'门诊雨棚、落客空间与急诊区');
 view('hospital-in','05 门诊内看外','hospital',[0,1.7,-17],[0,1.7,32],'大厅与入口真实连通，窗外接院区而非空场',24);
 view('school-front','06 校园主门','school',[0,1.7,82],[0,3,-30],'主门、步道、操场和教学楼的实际关系',24);
 view('classroom','07 教室内景','school',[-12,1.7,-36],[-12,1.5,-44],'真实窗洞、桌椅与外廊',24);
 view('neighborhood','08 住宅庭院','residential',[14,1.7,18],[0,3,-35],'楼间距、步道、公共空间与入口');
 view('shop','09 沿街店内','shops',[-85,1.7,-21],[-85,1.7,8],'店内向街道观察，门面与人行道相连',24);
 view('river','10 河岸远眺','riverside',[-30,1.7,95],[18,2,-80],'河道纵深、桥梁和两岸远景');
 view('rooftop','11 高机位四向环境','hospital',[0,20,-20],[100,8,140],'高处应看到公园、学校与周边城区',24);
 view('corner','12 街角关系','roads',[13,1.7,14],[-45,2,-25],'转角尺度、斑马线和沿街建筑',24);
 plan.routes!.push({id:'street-walk',name:'主街穿行 · 20秒',locationId:'roads',duration:20,keys:[{time:0,camera:camera([9.5,1.7,145],[9.5,1.7,70])},{time:8,camera:camera([9.5,1.7,55],[10,2,-20])},{time:14,camera:camera([9.5,1.7,-18],[52,2,-50])},{time:20,camera:camera([12,1.7,-40],[80,3,-85])}]});
 plan.routes!.push({id:'hospital-entry',name:'从院区进入门诊 · 14秒',locationId:'hospital',duration:14,keys:[{time:0,camera:camera([0,1.7,35],[0,1.7,-20],24)},{time:6,camera:camera([0,1.7,-3],[0,1.7,-22],24)},{time:10,camera:camera([0,1.7,-17],[-3,1.7,-22],24)},{time:14,camera:camera([0,1.7,-17],[0,1.7,30],24)}]});
 plan.models=[...assets.values()].map(a=>a.model);
 return publishStudio({id:'qingshui-district',expectedRevision:old?.revision||0,commandId:VERSION,name:'清水 · 河岸社区',description:plan.description,tags:['现代','完整世界','社区','街道','医院','学校','商铺','河岸'],license:'Omni 原创参考影视城。结构白模，不包含第三方贴图或模型。场次动作与最终视觉需要另外验收。',plan});
}
