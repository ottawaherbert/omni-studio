import { createHash } from 'node:crypto';
import type { ScriptRepository } from '../../apps/api/src/repositories/scriptStore';
import { createScriptDelivery } from '../../packages/script/src/exporters';
import type { ScriptProject } from '../../packages/script/src/schema';
import type { ScriptExportScene, ScriptDeliveryBlock } from '../../packages/domain/src/scriptDelivery';
import type { InteractiveWritingPort, InteractiveWritingSceneOption } from '../domains/interactive/ports/writingPort';
const checksum=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Rebuild the exact pre-v2 scene block order for references saved before the
// delivery fix. Only a matching digest for the same immutable revision passes.
const legacyScene=(project:ScriptProject,unitId:string,sceneId:string,delivery:ScriptExportScene)=>{
  const source=project.units.find(unit=>unit.id===unitId)?.scenes.find(scene=>scene.id===sceneId);
  if(!source)return undefined;
  const blocks=source.blocks.filter(block=>block.type!=='note').flatMap((block):ScriptDeliveryBlock[]=>
    block.type==='dialogue'
      ? [{id:`${block.id}_speaker`,type:'character',content:project.characters.find(c=>c.id===block.speakerId)?.name||block.speakerName||'未指定人物'},
        {id:block.id,type:'dialogue',content:block.text}]
      : [{id:block.id,type:block.type as ScriptDeliveryBlock['type'],content:block.text}]);
  return {...delivery,blocks};
};
// Old scene references hashed additional block metadata. Validate against the
// immutable source version without exposing that retired metadata in new output.
const archivedSceneChecksum=(project:ScriptProject,unitId:string,sceneId:string)=>{
  const source=project.units.find(unit=>unit.id===unitId)?.scenes.find(scene=>scene.id===sceneId);
  const delivery=createScriptDelivery(project).units.find(unit=>unit.id===unitId)?.scenes?.find(scene=>scene.id===sceneId);
  if(!source||!delivery)return undefined;
  const old=legacyScene(project,unitId,sceneId,delivery);
  if(!old)return undefined;
  const blocks=old.blocks.map(block=>{
    const stored=source.blocks.find(item=>item.id===block.id);
    if(!stored)return block;
    const {id,type,text,speakerId,speakerName,...metadata}=stored;
    return {...block,...metadata};
  });
  return checksum({s:{...old,blocks},revision:project.revision});
};
const scenes=(p:ScriptProject):InteractiveWritingSceneOption[]=>createScriptDelivery(p).units.flatMap(u=>(u.scenes||[]).map(s=>{
  const blocks=s.blocks.filter(b=>b.content.trim()).map(b=>({type:b.type,content:b.content}));
  return {ref:{kind:'script_scene' as const,artifactId:`script-scene:${p.id}:${u.id}:${s.id}`,versionId:`script-revision:${p.revision}`,checksum:checksum({s,revision:p.revision})},
    writingProjectId:p.id,writingProjectTitle:p.title,writingProjectRevision:p.revision,unitId:u.id,unitIndex:u.index,unitTitle:u.title,
    sceneId:s.id,sceneIndex:s.index,sceneTitle:s.title,synopsis:s.synopsis,characters:s.characters,targetDurationSeconds:s.targetDurationSeconds,scriptBlocks:blocks};
}));
export const createInteractiveWritingPort=(repository:ScriptRepository):InteractiveWritingPort=>({
  listProjects:()=>repository.listProjects(),hasProject:id=>Boolean(repository.getProject(id)),
  listScenes:id=>{const p=repository.getProject(id);return p?scenes(repository.captureProjectInput(p)):[];},
  getGenerationStatus:id=>({state:repository.getProject(id)?.units.some(u=>u.scenes.some(s=>s.blocks.some(b=>b.text.trim()&&b.type!=='note')))?'ready':'idle',message:'在剧本工作区编辑，保存后选择要绑定的场景内容。'}),
  resolveScene:ref=>{
    const m=/^script-scene:([^:]+):([^:]+):([^:]+)$/.exec(ref.artifactId);const r=/^script-revision:(\d+)$/.exec(ref.versionId);
    if(!m||!r)return null;const p=repository.readProjectInput(m[1],Number(r[1]));
    if(!p)return null;
    const scene=scenes(p).find(s=>s.ref.artifactId===ref.artifactId);
    if(!scene)return null;
    if(scene.ref.checksum===ref.checksum)return scene;
    const delivery=createScriptDelivery(p).units.find(unit=>unit.id===m[2])?.scenes?.find(item=>item.id===m[3]);
    const old=delivery&&legacyScene(p,m[2],m[3],delivery);
    return (old&&checksum({s:old,revision:p.revision})===ref.checksum
      || archivedSceneChecksum(p,m[2],m[3])===ref.checksum)?{...scene,ref:{...ref}}:null;
  },
});
