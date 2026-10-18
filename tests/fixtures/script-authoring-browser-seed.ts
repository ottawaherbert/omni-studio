/** Isolated, authored UI stress sample; never reads a production database. */
import Database from 'better-sqlite3';
import {writeFileSync} from 'node:fs';
import {createScriptRepository} from '../../apps/api/src/repositories/scriptStore';
import {createScriptProject,newScene} from '../../packages/script/src/project';
import {createScriptCreationProfile} from '../../packages/script/src/creation';
import {anchorFor,outlineGuideId} from '../../packages/script/src/outlineGuides';

const databasePath=process.env.SCRIPT_BROWSER_DB;
if(!databasePath?.startsWith('/tmp/'))throw new Error('Set an isolated /tmp SCRIPT_BROWSER_DB');
const db=new Database(databasePath),repo=createScriptRepository(db);repo.ensureSchema();
const project=createScriptProject('长稿验收 · 三十场雨夜',createScriptCreationProfile('feature-film',1,90));
const paragraphs=Array.from({length:30},(_,i)=>`第${i+1}个事件：老周来到站台的第${i+1}处位置，核对值班记录与乘客留下的证言。他发现当年记下的时间和眼前列车时刻不同，于是决定找出遗漏的交接记录。女儿递来的信让他重新理解离开的原因，他把新的发现写在记录旁，继续下一步调查。`);
project.brief.concept='父女在最后一个雨夜重建事故的真相。';
project.brief.outline=paragraphs.join('\n\n');
const unit=project.units[0];
unit.structureNodes=['追查记录','核对证词','作出选择'].map((title,i)=>({id:`stress_part_${i}`,title,purpose:paragraphs[i*10]}));
unit.scenes=paragraphs.map((purpose,i)=>({...newScene(`第${i+1}场 · ${['站台','值班室','出站口'][i%3]}`),purpose,location:['站台','值班室','出站口'][i%3],timeOfDay:'夜',entryState:'尚有疑问',exitState:'得到下一条线索',...(i<29?{structureNodeId:unit.structureNodes![Math.floor(i/10)].id}:{})}));
const owner={kind:'project' as const,id:project.id};
project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:unit.structureNodes.map((node,i)=>{const start=project.brief.outline.indexOf(paragraphs[i*10]),end=project.brief.outline.indexOf(paragraphs[i*10+9])+paragraphs[i*10+9].length;return {unitId:unit.id,nodeId:node.id,anchor:anchorFor(project.brief.outline,start,end)};}),beats:[{id:'stress_beat_choice',title:'从回避转为核对真相',change:'老周开始承担责任',anchors:[anchorFor(project.brief.outline,0,paragraphs[0].length)],unitIds:[unit.id],sceneRefs:unit.scenes.slice(0,3).map(scene=>({unitId:unit.id,sceneId:scene.id}))}]}];
const saved=repo.saveProject(project,0);
const output={projectId:saved.id,unitId:unit.id,sceneId:unit.scenes[0].id};
writeFileSync('/tmp/script-authoring-stress-fixture.json',JSON.stringify(output));
console.log(JSON.stringify(output));db.close();
