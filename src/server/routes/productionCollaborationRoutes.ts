import { readSceneMediaProgress } from '../generation/store';
import type { Express } from 'express';
import { db, dbHelpers } from '../db';
import type { Scene } from '../../types/project';
import { normalizeDirectorPlan } from '../../../packages/production/src/services/production/directorPlan';
import { readCollaborationPatch, readProductionUse, readEventStates, productionNextActions } from '../../services/production/productionCollaboration';
import { productionSceneBasis } from '../../services/production/productionSceneBasis';
import { emptySceneVisualPlan } from '../../services/production/sceneVisualPlan';
import { saveStoryboardUnitPlan } from '../../services/production/storyboardUnitPlan';
import { audioForEdit, editFromTimelineShots, readSceneEdit, sceneVideoClips, storyboardTakeSourceStart } from '../../utils/sceneVideoClips';

export function registerProductionCollaborationRoutes(app: Express) {
  const base='/api/projects/:id/episodes/:epId/scenes/:sceneId';
  const route=(handler:(req:any,res:any)=>unknown)=>(req:any,res:any)=>{try{return handler(req,res);}catch(error:any){return res.status(error.statusCode || 400).json({error:error.message});}};
  const editScene=(req:any, change:(scene:Scene,project:any,episode:any)=>void)=>db.transaction(()=>{
    const project=dbHelpers.getProjectShellById(req.params.id);
    const episode=dbHelpers.getEpisodeById(req.params.id,req.params.epId);
    const scene=episode?.scenes.find(item=>item.id===req.params.sceneId);
    if(!project || !episode || !scene)throw Object.assign(new Error('场次不存在。'),{statusCode:404});
    change(scene,project,episode);
    return dbHelpers.updateEpisode(req.params.id,req.params.epId,{...episode,__requireProductionRevision:true});
  })();
  const pick=(body:any,keys:string[])=>{
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!keys.includes(k)))throw new Error('请只提交当前要编辑的字段。');
    return structuredClone(body);
  };
  app.patch(base,route((req,res)=>res.json(editScene(req,scene=>{
    const patch=pick(req.body,['title','script','scriptBlocks','sceneGoal','breakdown','visualPlan','audioTracks','shots']);
    if(['title','script','sceneGoal'].some(k=>patch[k]!==undefined&&typeof patch[k]!=='string'))throw new Error('场次文字格式无效。');
    if(patch.scriptBlocks!==undefined){
      if(!Array.isArray(patch.scriptBlocks) || patch.scriptBlocks.some((b:any)=>!b || typeof b.content!=='string'))throw new Error('剧本文本块格式无效。');
      const script=patch.scriptBlocks.map((b:any)=>b.content).join('\n');
      if(patch.script!==undefined && patch.script.replace(/\s/g,'')!==script.replace(/\s/g,''))throw new Error('正文与文本块不一致，请提交同一份剧本。');
      patch.script=script;
    }else if(patch.script!==undefined){
      // A plain-text replacement must not remain shadowed by old structured text.
      patch.scriptBlocks=[];
    }
    if(patch.visualPlan!==undefined){
      const incoming=patch.visualPlan;
      if(!incoming || typeof incoming!=='object' || Array.isArray(incoming) || incoming.transition!==undefined && (!incoming.transition || typeof incoming.transition!=='object' || Array.isArray(incoming.transition)))throw new Error('场面设计格式无效。');
      const current=scene.visualPlan || emptySceneVisualPlan();
      patch.visualPlan={...current,...incoming,transition:{...current.transition,...incoming.transition},updatedAt:Date.now()};
      const plan=patch.visualPlan;
      if(['geography','lighting','entryState','exitState'].some(k=>typeof plan[k]!=='string') || !Array.isArray(plan.references) || plan.references.some((r:any)=>!r || typeof r.id!=='string' || typeof r.imageUrl!=='string' || !['space','boundary'].includes(r.role)) || !['unspecified','continuous','time_jump','parallel','flashback','independent'].includes(plan.transition.kind))throw new Error('场面设计的空间、参考或跨场关系无效。');
      if(plan.eventStates!==undefined)plan.eventStates=readEventStates(plan.eventStates);
    }
    if(patch.shots!==undefined){
      if(!Array.isArray(patch.shots) || patch.shots.some((shot:any)=>!shot || !Number.isFinite(shot.duration) || shot.duration<=0))throw new Error('请提供有效镜头及预计时长。');
      if(patch.shots.some((shot:any)=>shot.id!==undefined && (typeof shot.id!=='string' || !shot.id.trim())) || new Set(patch.shots.filter((shot:any)=>shot.id).map((shot:any)=>shot.id)).size!==patch.shots.filter((shot:any)=>shot.id).length)throw new Error('镜头ID须有效且不能重复。');
      patch.shots=patch.shots.map((shot:any)=>({...shot,id:shot.id || crypto.randomUUID()}));
      scene.shotHistory=[...(scene.shotHistory||[]),{at:Date.now(),shots:structuredClone(scene.shots||[]),audioTracks:scene.audioTracks,manualStoryboard:scene.manualStoryboard}];
    }
    Object.assign(scene,patch);
  }))));
  app.patch(`${base}/shots/:shotId`,route((req,res)=>res.json(editScene(req,scene=>{
    const shot=scene.shots?.find(s=>s.id===req.params.shotId);
    if(!shot)throw Object.assign(new Error('镜头不存在。'),{statusCode:404});
    const patch=pick(req.body,['duration','shotSize','cameraAngle','cameraMovement','focalLength','lighting','lightingAtmo','composition','blocking','visualAction','microExpression','motivation','editingNote','continuityNote','soundDesign','dialogueLines','characterIdsInShot','propIds','vehicleIds','locationId','locationReferenceViews','imagePrompt','videoPrompt','beatIds','eventIds']);
    if(patch.duration!==undefined&&(!Number.isFinite(patch.duration)||patch.duration<=0))throw new Error('请填写有效预计时长。');
    for(const key of ['characterIdsInShot','propIds','vehicleIds','beatIds','eventIds'])if(patch[key]!==undefined && (!Array.isArray(patch[key]) || patch[key].some((id:any)=>typeof id!=='string')))throw new Error('镜头关联须为ID列表。');
    if(patch.locationReferenceViews!==undefined && (!Array.isArray(patch.locationReferenceViews) || patch.locationReferenceViews.some((v:any)=>!['main','reverse','oblique','top'].includes(v)) || new Set(patch.locationReferenceViews).size!==patch.locationReferenceViews.length))throw new Error('场景参考视角须为不重复的主视图、反向平视图、斜俯视全景或顶视布局图。');
    if(patch.dialogueLines!==undefined && (!Array.isArray(patch.dialogueLines) || patch.dialogueLines.some((line:any)=>!line || typeof line.text!=='string')))throw new Error('对白格式无效。');
    Object.assign(shot,patch);
  }))));
  app.patch(`${base}/storyboard-units/:unitId`,route((req,res)=>res.json(editScene(req,(scene,_project,episode)=>{
    saveStoryboardUnitPlan(scene,episode.id,req.params.unitId,req.body);
  }))));
  app.get(`${base}/collaboration`,route((req,res)=>{
    const project=dbHelpers.getProjectById(req.params.id);
    const episode=dbHelpers.getEpisodeById(req.params.id,req.params.epId);
    const scene=episode?.scenes.find(item=>item.id===req.params.sceneId);
    if(!project || !scene)return res.status(404).json({error:'场次不存在。'});
    return res.json({mediaProgress:readSceneMediaProgress(db,req.params.id,req.params.epId,scene.id),sceneId:scene.id,productionBasis:productionSceneBasis(project,scene),...productionNextActions(scene),observations:scene.productionPreparation?.observations || [],edit:scene.edit});
  }));
  app.patch(`${base}/collaboration`,route((req,res)=>{
    const patch=readCollaborationPatch(req.body);
    return res.json(editScene(req,(scene,project,episode)=>{
      if(patch.direction){
        const old=scene.manualStoryboard?.directorPlan;
        const plan=old ? {...old,...patch.direction} : normalizeDirectorPlan({project,episode,scene,shots:scene.shots||[],rawShots:[],rawPlan:{intent:'',rhythm:'',...patch.direction}}).plan;
        scene.manualStoryboard={...scene.manualStoryboard,schemaVersion:'manual-storyboard.v1',directorPlan:plan,updatedAt:Date.now()};
      }
      if(patch.eventStates)scene.visualPlan={...(scene.visualPlan || emptySceneVisualPlan()),eventStates:patch.eventStates,updatedAt:Date.now()};
      if(patch.beats){
        if(!scene.breakdown)throw new Error('请先保存本场拆解，再补节拍。');
        scene.breakdown={...scene.breakdown,beats:patch.beats};
      }
      const prep=scene.productionPreparation || {schemaVersion:'production-preparation.v1' as const,sceneId:scene.id,updatedAt:0};
      if(patch.observations){const items=new Map((prep.observations||[]).map(o=>[o.id,o]));for(const o of patch.observations)items.set(o.id,{...o,checkedAt:Date.now(),reviewer:undefined});prep.observations=[...items.values()];}
      if(patch.workRecords){const items=new Map((prep.workRecords||[]).map(w=>[w.scopeKey,w]));for(const w of patch.workRecords){const old=items.get(w.scopeKey);items.set(w.scopeKey,{...old,...w,originTaskId:old?.originTaskId || w.originTaskId,reviewsUsed:Math.max(old?.reviewsUsed || 0,w.reviewsUsed),repairsUsed:Math.max(old?.repairsUsed || 0,w.repairsUsed)});}prep.workRecords=[...items.values()];}
      if(patch.observations || patch.workRecords){scene.productionPreparation={...prep,updatedAt:Date.now()};}
    }));
  }));
  app.patch('/api/projects/:id/assets/:assetId/production-use',route((req,res)=>{
    const patch=readProductionUse(req.body);
    const project=dbHelpers.getProjectShellById(req.params.id);
    if(!project)return res.status(404).json({error:'项目不存在。'});
    const character=project.characters?.find(c=>c.id===req.params.assetId);
    const asset=project.assets?.find(a=>a.id===req.params.assetId);
    if(!character && !asset)return res.status(404).json({error:'资产不存在。'});
    const productionUse={...(character || asset)?.productionUse,...patch};
    const field=character?'characters':'assets';
    dbHelpers.updateProjectMeta(req.params.id,{[field]:project[field].map(item=>item.id===req.params.assetId?{...item,productionUse}:item)});
    return res.json({assetId:req.params.assetId,productionUse});
  }));
  app.patch(`${base}/edit`,route((req,res)=>res.json(editScene(req,scene=>{
    let edit=editFromTimelineShots(sceneVideoClips(scene));
    const input=req.body || {};
    if(Array.isArray(input.clips))edit=readSceneEdit(scene,input);
    else {
      const index=edit.clips.findIndex(c=>c.id===input.clipId);
      if(index<0)throw new Error('剪辑片段不存在。');
      const clip=edit.clips[index];
      switch(input.operation){
        case 'split': {
          if(!Number.isFinite(input.offsetSeconds) || !(input.offsetSeconds>0 && input.offsetSeconds<clip.durationSeconds))throw new Error('分割点须在片段内部。');
          edit.clips.splice(index,1,{...clip,durationSeconds:input.offsetSeconds},{...clip,id:crypto.randomUUID(),sourceInSeconds:clip.sourceInSeconds+input.offsetSeconds,durationSeconds:clip.durationSeconds-input.offsetSeconds,transition:'none'});break;
        }
        case 'trim': edit.clips[index]={...clip,sourceInSeconds:input.sourceInSeconds,durationSeconds:input.durationSeconds};break;
        case 'move': if(!Number.isInteger(input.toIndex)||input.toIndex<0||input.toIndex>=edit.clips.length)throw new Error('目标片段位置无效。');edit.clips.splice(index,1);edit.clips.splice(input.toIndex,0,clip);break;
        case 'remove': edit.clips.splice(index,1);break;
        case 'duplicate': edit.clips.splice(index+1,0,{...clip,id:crypto.randomUUID()});break;
        case 'transition': edit.clips[index]={...clip,transition:input.transition};break;
        case 'replace': {
          const history=[...(scene.shotHistory || [])].reverse();
          const shotTake=[...(scene.shots || []),...history.flatMap(h=>h.shots)].filter(s=>s.id===clip.shotId).flatMap(s=>s.takes || []).find(t=>t.id===input.takeId);
          const sources=[{shots:scene.shots,manualStoryboard:scene.manualStoryboard},...history];
          const source=sources.find(s=>s.shots?.some(shot=>shot.id===clip.shotId) && s.manualStoryboard?.boards?.some(b=>(b.shotIds || b.board?.shotIds || [b.shotId]).includes(clip.shotId) && b.takes?.some(t=>t.id===input.takeId)));
          const workflow=source?.manualStoryboard?.boards?.find(b=>(b.shotIds || b.board?.shotIds || [b.shotId]).includes(clip.shotId) && b.takes?.some(t=>t.id===input.takeId));
          const take=shotTake || workflow?.takes?.find(t=>t.id===input.takeId);
          if(!take?.videoUrl)throw new Error('请选择该镜头的已有视频候选。');
          edit.clips[index]={...clip,takeId:take.id,videoUrl:take.videoUrl,sourceInSeconds:input.sourceInSeconds ?? (workflow ? storyboardTakeSourceStart({...scene,shots:source!.shots},workflow,take,clip.shotId) : 0)};break;
        }
        default: throw new Error('请选择分割、修剪、排序、复制、移除、转场或替换素材。');
      }
      edit=readSceneEdit(scene,edit);
    }
    scene.audioTracks=audioForEdit(scene,edit);
    scene.edit=edit;
  }))));
}
