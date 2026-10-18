import { hashValue } from '../../agent-core/src/identity';
import { parseScriptProject, type Scene, type ScriptBlock, type ScriptProject } from './schema';

export type SceneContinuationCheckpoint = { unitId:string; sceneId:string; baseRevision:number; tailBlockId:string|null; blockCount:number; contentHash:string; structureHash:string; checkpointId:string };
const get=(project:ScriptProject,unitId:string,sceneId:string)=>{const unit=project.units.find(item=>item.id===unitId),scene=unit?.scenes.find(item=>item.id===sceneId);if(!unit||!scene)throw new Error('续写场景不存在');return {unit,scene};};
export function createSceneContinuationCheckpoint(project:ScriptProject,unitId:string,sceneId:string):SceneContinuationCheckpoint{
  const {unit,scene}=get(project,unitId,sceneId),index=unit.scenes.indexOf(scene);
  const node=unit.structureNodes?.find(item=>item.id===scene.structureNodeId);
  const value={unitId,sceneId,baseRevision:project.revision,tailBlockId:scene.blocks.at(-1)?.id??null,blockCount:scene.blocks.length,
    contentHash:hashValue(scene),structureHash:hashValue({scopeId:unit.scopeId,nodeId:scene.structureNodeId??null,parentId:node?.parentId??null,before:unit.scenes[index-1]?.id??null,after:unit.scenes[index+1]?.id??null})};
  return {...value,checkpointId:hashValue(value)};
}
export function assertSceneContinuationCheckpoint(project:ScriptProject,checkpoint:SceneContinuationCheckpoint):void{
  if(!checkpoint||hashValue(createSceneContinuationCheckpoint(project,checkpoint.unitId,checkpoint.sceneId))!==hashValue(checkpoint))throw new Error('续写检查点已过期，场尾、场序或工作稿版本改变，请重新读取');
}
const blockContent=(block:ScriptBlock)=>({type:block.type,text:block.text,speakerId:block.speakerId??null,speakerName:block.speakerName??null});
export function generatedSceneState(scene:Scene,stepId:string,digest:string,isComplete:boolean):NonNullable<Scene['generation']>{
  const previous=scene.generation?.appliedSteps??[];
  return {status:isComplete?'complete':'partial',checkpointId:hashValue({blocks:scene.blocks,status:isComplete?'complete':'partial',stepId}),appliedSteps:[...previous.filter(step=>step.id!==stepId),{id:stepId,digest}]};
}
/** An exact retry is a no-op; a changed payload under the same stable step is an error. */
export function appendSceneContinuation(project:ScriptProject,unitId:string,sceneId:string,blocks:ScriptBlock[],options:{stepId:string;checkpoint:SceneContinuationCheckpoint;isComplete:boolean}):{project:ScriptProject;applied:boolean}{
  const {scene}=get(project,unitId,sceneId);
  if(!/^[\w-]{1,120}$/.test(options.stepId)||typeof options.isComplete!=='boolean'||!blocks.length)throw new Error('续写需要稳定步骤ID、完整状态及完整正文块');
  if(options.checkpoint?.unitId!==unitId||options.checkpoint.sceneId!==sceneId)throw new Error('续写检查点属于其他场景');
  const digest=hashValue({blocks,checkpoint:options.checkpoint,isComplete:options.isComplete}),previous=scene.generation?.appliedSteps.find(step=>step.id===options.stepId);
  if(previous){if(previous.digest!==digest)throw new Error('同一步续写返回了不同内容');return {project:structuredClone(project),applied:false};}
  assertSceneContinuationCheckpoint(project,options.checkpoint);
  if(!blocks.some(block=>block.text.trim()))throw new Error('续写不能只有空白块');
  const old=scene.blocks.map(blockContent),fresh=blocks.map(blockContent);
  // Reject exact repeated output, never delete/normalize a possibly intentional line.
  for(let count=1;count<=Math.min(old.length,fresh.length);count++)if(hashValue(old.slice(-count))===hashValue(fresh.slice(0,count)))throw new Error('续写重复了已经保存的场尾，请仅提交新内容');
  if(fresh.length<=old.length)for(let i=0;i<=old.length-fresh.length;i++)if(hashValue(old.slice(i,i+fresh.length))===hashValue(fresh))throw new Error('续写重复了已经保存的正文块');
  const next=structuredClone(project),target=get(next,unitId,sceneId).scene;
  target.blocks.push(...structuredClone(blocks));target.generation=generatedSceneState(target,options.stepId,digest,options.isComplete);
  return {project:parseScriptProject(next),applied:true};
}
