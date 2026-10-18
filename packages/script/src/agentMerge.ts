import { parseScriptProject, type Scene, type ScriptProject } from './schema';
import { sceneHasAuthorWork } from './planning';

export class ScriptAgentMergeConflict extends Error {
  statusCode=409;
}

const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const fail=(message:string):never=>{throw new ScriptAgentMergeConflict(message);};
const sceneFields=(scene:Scene)=>scene as unknown as Record<string,unknown>;
const withoutScenes=(project:ScriptProject)=>{
  const {revision: _revision,updatedAt: _updatedAt,units,...rest}=project;
  return {...rest,units:units.map(({scenes: _scenes,...unit})=>unit)};
};

/** Merge only the scene changes made in an Agent draft. Published author edits remain authoritative. */
export function mergeAgentDraft(base:ScriptProject,published:ScriptProject,draft:ScriptProject,options:{preferAuthor?:boolean;allowUnchanged?:boolean}={}):{
  project:ScriptProject; changedSceneIds:string[]; addedSceneIds:string[]; removedSceneIds:string[]; overriddenSceneIds:string[];
}{
  if(base.id!==published.id||base.id!==draft.id||base.revision>published.revision||base.revision>draft.revision)
    fail('Agent 草稿与正式稿的项目基线不一致');
  if(!same(withoutScenes(base),withoutScenes(draft)))
    fail('Agent 草稿包含场景以外的改动，暂不能自动合并');
  const merged=structuredClone(published);
  const changedSceneIds:string[]=[];
  const addedSceneIds:string[]=[];
  const removedSceneIds:string[]=[];
  const overriddenSceneIds=new Set<string>();
  const allOriginalSceneIds=new Set(base.units.flatMap(unit=>unit.scenes.map(scene=>scene.id)));
  for(let unitIndex=0;unitIndex<base.units.length;unitIndex++){
    const originalUnit=base.units[unitIndex];
    const agentUnit=draft.units[unitIndex];
    const authorUnit=merged.units.find(unit=>unit.id===originalUnit.id);
    const originalIds=originalUnit.scenes.map(scene=>scene.id);
    const originalSet=new Set(originalIds);
    const draftIds=agentUnit.scenes.map(scene=>scene.id);
    const retainedIds=draftIds.filter(id=>originalSet.has(id));
    if(!same(retainedIds,originalIds.filter(id=>retainedIds.includes(id))))
      fail(`「${originalUnit.title}」的 Agent 草稿调整了已有场景顺序，需手动合并`);
    const deleted=originalUnit.scenes.filter(scene=>!draftIds.includes(scene.id));
    const added=agentUnit.scenes.filter(scene=>!originalSet.has(scene.id));
    if(!same(draftIds,[...retainedIds,...added.map(scene=>scene.id)])||added.some(scene=>allOriginalSceneIds.has(scene.id)))
      fail(`「${originalUnit.title}」的 Agent 草稿移动或插入了已有场景，需手动合并`);
    if(deleted.some(scene=>sceneHasAuthorWork(scene,base)))
      fail(`「${originalUnit.title}」的 Agent 草稿删去了作者规划的场景，不能自动合并`);
    const modified=originalUnit.scenes.filter(scene=>{
      const next=agentUnit.scenes.find(item=>item.id===scene.id);
      return next&&!same(scene,next);
    });
    if(!deleted.length&&!added.length&&!modified.length)continue;
    if(!authorUnit){
      if(options.preferAuthor){[...modified,...added,...deleted].forEach(scene=>overriddenSceneIds.add(scene.id));continue;}
      fail(`「${originalUnit.title}」已被作者删除，无法合并 Agent 改动`);
    }
    if(!options.preferAuthor&&(deleted.length||added.length)&&!same(authorUnit.scenes.map(scene=>scene.id),originalIds))
      fail(`「${originalUnit.title}」的场景结构已由作者调整，无法自动合并 Agent 的增删场景`);
    for(const originalScene of modified){
      const agentScene=agentUnit.scenes.find(scene=>scene.id===originalScene.id)!;
      const authorScene=authorUnit.scenes.find(scene=>scene.id===originalScene.id);
      if(!authorScene){
        if(options.preferAuthor){overriddenSceneIds.add(originalScene.id);continue;}
        fail(`「${originalScene.title}」已被作者删除，无法合并 Agent 改动`);
      }
      const original=sceneFields(originalScene);
      const agent=sceneFields(agentScene);
      const author=sceneFields(authorScene);
      for(const key of new Set([...Object.keys(original),...Object.keys(agent)])){
        if(same(original[key],agent[key]))continue;
        if(!same(author[key],original[key])&&!same(author[key],agent[key])){
          if(options.preferAuthor){overriddenSceneIds.add(originalScene.id);continue;}
          fail(`「${originalScene.title}」的${key==='blocks'?'正文':`字段 ${key}`}已被作者和 Agent 分别修改，请手动选择`);
        }
        if(Object.hasOwn(agent,key))author[key]=agent[key]===undefined?undefined:structuredClone(agent[key]);
        else delete author[key];
      }
      changedSceneIds.push(originalScene.id);
    }
    for(const scene of deleted){
      const authorScene=authorUnit.scenes.find(item=>item.id===scene.id);
      if(!authorScene||!same(authorScene,scene)||sceneHasAuthorWork(authorScene,published)){
        if(options.preferAuthor){overriddenSceneIds.add(scene.id);continue;}
        fail(`「${scene.title}」已被作者修改，不能按 Agent 草稿删去`);
      }
      authorUnit.scenes=authorUnit.scenes.filter(item=>item.id!==scene.id);
      removedSceneIds.push(scene.id);
    }
    if(added.length){
      authorUnit.scenes.push(...structuredClone(added));
      addedSceneIds.push(...added.map(scene=>scene.id));
    }
  }
  if(!options.allowUnchanged&&!changedSceneIds.length&&!addedSceneIds.length&&!removedSceneIds.length)
    fail('此 Agent 没有需要采用的场景改动');
  try{return {project:parseScriptProject(merged),changedSceneIds,addedSceneIds,removedSceneIds,overriddenSceneIds:[...overriddenSceneIds]};}
  catch(cause){fail(`合并后场景引用无效：${cause instanceof Error?cause.message:'请检查人物与故事线引用'}`);}
}
