import { withCharacterReferenceUsage } from '../services/production/characterReferenceLayouts';
import { appearanceBoards } from '../services/production/productionAppearance';
import { renderLocationSpatialAnchor } from '../services/production/locationViews';
import { locationViewBoards } from '../services/production/locationViewReferences';
import { createHash, randomUUID } from 'node:crypto';
import { dbHelpers } from './db';
import { GenerationStore } from './generation/store';
import { GenerationMediaStore } from './generation/media';
import { GenerationError, type GenerationTarget, type GenerationReference, type GenerationOperation } from '../../packages/domain/src/generation';
import { qualityStages, qualityCheckLabels, type QualityTarget, type ProductionQualityStage, type ProductionResponsibility, type QualityInspection, type QualityEvidenceInput, type QualityFinding, type QualityStageState } from '../../packages/domain/src/productionQuality';
import { sceneVideoClips } from '../utils/sceneVideoClips';
import { sceneAudioExportTracks, resolveAudioLibraryUrl } from '../utils/episodeAudioExport';
import { buildManualProductionAssetReadModel } from '../services/production/manualProductionAssets';
import { emptySceneVisualPlan, sceneStoryboardContentHash } from '../services/production/sceneVisualPlan';

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const pick = (value: any, keys: string[]) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const fail = (message: string, code = 'PRODUCTION_QUALITY_BLOCKED'): never => { throw new GenerationError(code, message, 409); };
const groupStages = new Set<ProductionQualityStage>(['preparation', 'visuals', 'segments']);
const shotFields = ['id','duration','shotSize','cameraAngle','cameraMovement','focalLength','lighting','lightingAtmo','composition','blocking','visualAction','microExpression','motivation','editingNote','continuityNote','soundDesign','dialogueLines','characterIdsInShot','propIds','vehicleIds','locationId','locationReferenceViews','beatIds','eventIds','directing','creativeDirection','appearance','activeVisualLayerIds','storyboardCapabilityIds'];

// Archived shots remain reviewable while a current edit uses them.
const reviewShots = (scene: any): any[] => {
  const edited = new Set((scene.edit?.clips || []).map((clip: any) => clip.shotId));
  const history = (scene.shotHistory || []).flatMap((entry: any) => entry.shots).filter((shot: any) => edited.has(shot.id));
  return [...new Map([...history, ...(scene.shots || [])].map(shot => [shot.id, shot])).values()];
};
const reviewBoards = (scene: any): any[] => {
  const currentIds = new Set((scene.shots || []).map((shot: any) => shot.id));
  const archivedIds = new Set((scene.edit?.clips || []).map((clip: any) => clip.shotId).filter((id: string) => !currentIds.has(id)));
  const history = (scene.shotHistory || []).flatMap((entry: any) => entry.manualStoryboard?.boards || [])
    .filter((unit: any) => (unit.shotIds || unit.board?.shotIds || [unit.shotId]).some((id: string) => archivedIds.has(id)));
  return [...new Map([...history, ...(scene.manualStoryboard?.boards || [])].map(unit => [unit.id, unit])).values()];
};

/** Shared by human and operator routes. No model calls, automatic retries or user-managed versions. */
export class ProductionQuality {
  constructor(readonly store: GenerationStore, readonly mediaRoot: string) {}
  responsibility(projectId: string) { return this.store.get<ProductionResponsibility>('production-responsibility', projectId); }
  saveResponsibility(projectId: string, input: ProductionResponsibility) {
    this.context({ projectId });
    if (!input || ['director','coordinator','intent','visualDirection'].some(k => typeof (input as any)[k] !== 'string' || !(input as any)[k].trim() || (input as any)[k].length > 4000) || !['scene_plan','previs'].includes(input.spatialMode)) fail('请明确总导演、制片统筹、总体目标、视听方向和空间依据。', 'QUALITY_RESPONSIBILITY_REQUIRED');
    const value = { ...pick(input, ['director','coordinator','intent','visualDirection','spatialMode']) } as ProductionResponsibility;
    return this.store.put('production-responsibility', projectId, projectId, value);
  }
  private context(target: QualityTarget) {
    const project = dbHelpers.getProjectById(target.projectId) as any;
    const episode = target.episodeId ? project?.episodes?.find((e: any) => e.id === target.episodeId) : undefined;
    const scene = target.sceneId ? episode?.scenes?.find((s: any) => s.id === target.sceneId) : undefined;
    if (!project || target.episodeId && !episode || target.sceneId && !scene) fail('检查对象不存在。', 'QUALITY_TARGET_NOT_FOUND');
    return { project, episode, scene };
  }
  private target(stage: ProductionQualityStage, raw: QualityTarget): QualityTarget {
    if (!Object.hasOwn(qualityStages, stage)) fail('检查阶段无效。', 'QUALITY_STAGE_INVALID');
    const { episode, scene } = this.context(raw), scope = qualityStages[stage].scope;
    if (scope === 'project') return { projectId: raw.projectId };
    if (!episode || scope !== 'episode' && !scene) fail('请选择本次检查的分集和场次。', 'QUALITY_SCOPE_REQUIRED');
    const target: QualityTarget = { projectId: raw.projectId, episodeId: raw.episodeId };
    if (scope !== 'episode') target.sceneId = raw.sceneId;
    if (scope === 'group') {
      const shots = reviewShots(scene);
      const ids = stage === 'segments' ? [...new Set(sceneVideoClips(scene).map(clip => clip.sourceShotId!))] : shots.map(shot => shot.id);
      target.shotIds = raw.shotIds?.length ? [...raw.shotIds] : ids;
      if (!target.shotIds?.length || new Set(target.shotIds).size !== target.shotIds.length || target.shotIds.some(id => !shots.some(s => s.id === id) || stage === 'segments' && !ids.includes(id))) fail('检查范围须对应当前实际镜头或剪辑使用的原镜头。', 'QUALITY_SHOT_RANGE');
    }
    return target;
  }
  private spatial(target: QualityTarget) {
    if (!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='previs_documents'").get()) return null;
    const keys = ['world', 'scene:' + JSON.stringify([target.episodeId, target.sceneId])];
    return keys.map(key => {
      const row = this.store.db.prepare('SELECT data FROM previs_documents WHERE project_id=? AND scope_key=?').get(target.projectId,key) as {data:string}|undefined;
      if (!row) return null;
      const document = JSON.parse(row.data); return document.plan;
    });
  }
  private assets(target:QualityTarget){
    const {project,episode,scene}=this.context(target);
    const shots=reviewShots(scene);
    const ids=new Set(shots.filter((s:any)=>!target.shotIds?.length||target.shotIds.includes(s.id)).flatMap((s:any)=>[...(s.characterIdsInShot||[]),...(s.propIds||[]),...(s.vehicleIds||[]),s.locationId].filter(Boolean)));
    const boards=buildManualProductionAssetReadModel({project,episode,scene:{...scene,shots}}).assetBoards;
    const selected=shots.filter(s=>!target.shotIds?.length||target.shotIds.includes(s.id));
    const appearance = selected.some(s=>s.appearance?.states.some((state:any)=>state.decision==='accepted')) ? selected.flatMap(shot=>appearanceBoards(project,[shot],boards,'image')) : boards;
    return withCharacterReferenceUsage(project,(selected.some(s=>s.locationReferenceViews?.length) ? locationViewBoards(project,selected,appearance) : appearance)).filter(a=>ids.has(a.assetId)).map((a):Record<string,any>=>({ ...pick(a,['boardItemId','assetId','assetName','assetType','referenceImageUrl','approvalState',...(a.characterReferenceLayout ? ['characterReferenceLayout','referenceUsageNote'] : []),...(a.locationView ? ['locationView','locationViewIssue','promptHash'] : [])]), ...(a.assetType === 'location' ? { spatialAnchor: renderLocationSpatialAnchor(project.assets.find((item:any)=>item.id===a.assetId)!, a.locationView || 'main', a.variantId) || undefined } : {}) }));
  }
  private images(scene:any,shotIds:string[]):QualityEvidenceInput[]{
    const images:QualityEvidenceInput[]=reviewShots(scene).filter((s:any)=>shotIds.includes(s.id)&&s.imageUrl).map((s:any)=>({mediaUrl:s.imageUrl,mediaKind:'image',shotIds:[s.id]}));
    for(const unit of reviewBoards(scene))for(const page of unit.board?.visualPages||[]){
      const take=page.visualTakes?.find((t:any)=>t.id===page.activeVisualTakeId&&t.status==='adopted'&&t.review?.status==='approved');
      const ids=[...new Set<string>((unit.board.panels||[]).filter((p:any)=>page.panelIds.includes(p.id)).map((p:any)=>p.shotId))];
      if(take&&ids.some(id=>shotIds.includes(id)))images.push({mediaUrl:take.videoReferenceImageUrl||take.sourceImageUrl||take.imageUrl,mediaKind:'image',shotIds:ids.filter(id=>shotIds.includes(id))});
    }
    const overview=scene.visualPlan?.overview;
    if(overview?.imageUrl&&(!overview.contentHash||overview.contentHash===sceneStoryboardContentHash(scene))&&overview.shotIds?.some((id:string)=>shotIds.includes(id)))images.push({mediaUrl:overview.imageUrl,mediaKind:'image',shotIds:overview.shotIds.filter((id:string)=>shotIds.includes(id))});
    return images;
  }
  private clips(scene: any, target: QualityTarget) {
    return sceneVideoClips(scene).filter(clip => !target.shotIds?.length || target.shotIds.includes(clip.sourceShotId!));
  }
  private audio(project: any, scene: any, target: QualityTarget) {
    const usedShots = new Set(sceneVideoClips(scene).map(clip=>clip.sourceShotId));
    return sceneAudioExportTracks(scene, id => resolveAudioLibraryUrl(id, project.assets || []))
      .map(track => {
        const shotId = track.clipAnchor ? scene.edit?.clips.find((clip: any) => clip.id === track.clipAnchor!.clipId)?.shotId || track.shotId : track.shotId;
        return { ...track, shotId: usedShots.has(shotId) ? shotId : undefined };
      })
      .filter(track => !target.shotIds?.length || !track.shotId || target.shotIds.includes(track.shotId));
  }
  private snapshot(stage: ProductionQualityStage, target: QualityTarget): any {
    const { project, episode, scene } = this.context(target), responsibility = this.responsibility(target.projectId);
    const overall = { project: pick(project,['title','logline','aspectRatio','visualStyleLock','visualStyle','creativeDirection']), direction: pick(responsibility,['intent','visualDirection','spatialMode']) };
    if (stage === 'project_plan') return { ...overall, story:(project.episodes||[]).map((e:any)=>({id:e.id,title:e.title,scenes:(e.scenes||[]).map((s:any)=>pick(s,['id','title','script','scriptBlocks','description','sceneGoal']))})) };
    if (stage === 'episode_cut') return { overall, title: episode.title, scenes: (episode.scenes || []).map((s: any) => {
      const sceneTarget = {projectId:target.projectId,episodeId:target.episodeId,sceneId:s.id};
      return { id: s.id, cut: this.snapshot('scene_cut',sceneTarget),
        // Rechecking the same file does not invalidate a cut; replacing it does.
        reviewedMedia: this.latest('scene_cut',sceneTarget)?.evidence.filter(e=>e.mediaKind==='video').map(e=>e.contentHash) };
    }) };
    const scenePlan = { overall, episodeDirection: episode.creativeDirection, scene: pick(scene,['id','title','script','scriptBlocks','description','sceneGoal','breakdown','creativeDirection']), direction: pick(scene.manualStoryboard?.directorPlan,['intent','rhythm','requirements','beatDirections','assumptions']), space: pick({...emptySceneVisualPlan(),...scene.visualPlan},['geography','lighting','entryState','exitState','eventStates','transition']) };
    if (stage === 'scene_plan') return scenePlan;
    const selected = reviewShots(scene).filter((s: any) => !target.shotIds?.length || target.shotIds.includes(s.id));
    const shotPlan = { scenePlan, shots: selected.map((s: any) => pick(s,shotFields)), units:reviewBoards(scene).filter((unit:any)=>(unit.shotIds||unit.board?.shotIds||[unit.shotId]).some((id:string)=>selected.some((s:any)=>s.id===id))).map((unit:any)=>({
      ...pick(unit,['id','shotId','shotIds','unitSchema','decision','performanceBeat']),
      board:{...pick(unit.board,['id','shotIds','layout','visualReferenceMode','videoPrompt']),panels:unit.board?.panels?.map(({visualTakes:_takes,activeVisualTakeId:_active,...authored}:any)=>authored)},
      pages:unit.board?.visualPages?.map((page:any)=>pick(page,['id','panelIds','layout','durationSeconds'])),
    })) };
    if (stage === 'shot_plan') return shotPlan;
    const ids = new Set(selected.flatMap((s: any) => [...(s.characterIdsInShot || []),...(s.propIds || []),...(s.vehicleIds || []),s.locationId].filter(Boolean)));
    const preparation = { shotPlan, assets: [...(project.characters||[]),...(project.assets||[])].filter(a=>ids.has(a.id)).map(a=>pick(a,['id','name','type','description','visualIdentity','productionUse','voiceSettings','voiceReferences'])), assetReferences:this.assets(target), spatial: responsibility?.spatialMode === 'previs' ? this.spatial(target) : pick({...emptySceneVisualPlan(),...scene.visualPlan},['references']) };
    if (stage === 'preparation') return preparation;
    const visuals = { preparation, images:this.images(scene,selected.map((s:any)=>s.id)) };
    if (stage === 'visuals') return visuals;
    const segments = { visuals, videos:this.clips(scene,target).map(s=>pick(s,['id','sourceShotId','sourceTakeId','videoUrl','sourceStartSeconds','duration'])), audioTracks:this.audio(project,scene,target) };
    if (stage === 'segments') return segments;
    return { segments, edit:sceneVideoClips(scene).map(s=>pick(s,['id','sourceShotId','sourceTakeId','videoUrl','imageUrl','duration','sourceStartSeconds','transition'])) };
  }
  private prerequisites(stage: ProductionQualityStage, target: QualityTarget): { stage: ProductionQualityStage; target: QualityTarget }[] {
    if (stage === 'project_plan') return [];
    if (stage === 'episode_cut') return (this.context(target).episode.scenes || []).map((s:any)=>({stage:'scene_cut' as const,target:{...target,sceneId:s.id}}));
    const prior: Partial<Record<ProductionQualityStage,ProductionQualityStage>> = {scene_plan:'project_plan',shot_plan:'scene_plan',preparation:'shot_plan',visuals:'preparation',segments:'visuals',scene_cut:'segments'};
    return [{stage:prior[stage]!,target}];
  }
  private latest(stage: ProductionQualityStage, target: QualityTarget) {
    return this.store.list<QualityInspection>('production-quality-review',target.projectId).filter(r=>r.stage===stage && r.target.episodeId===target.episodeId && r.target.sceneId===target.sceneId && (!groupStages.has(stage) || (target.shotIds || []).every(id=>r.target.shotIds?.includes(id)))).sort((a,b)=>(b.reviewedAt||0)-(a.reviewedAt||0))[0];
  }
  state(stage: ProductionQualityStage, raw: QualityTarget): QualityStageState {
    const target = this.target(stage,raw), definition = qualityStages[stage];
    const state:QualityStageState={stage,label:definition.label,owner:definition.owner,status:'pending',blockers:[],checks:definition.checks.map(id=>({id,label:qualityCheckLabels[id]}))};
    if (!this.responsibility(target.projectId)) state.blockers.push('先指定总导演和制片统筹并保存总体目标。');
    for (const parent of this.prerequisites(stage,target)) {
      const prior = this.state(parent.stage,parent.target);
      if (prior.status!=='passed') state.blockers.push(`${prior.label}尚未通过当前内容的检查。`);
    }
    if (groupStages.has(stage)) {
      const perShot = (target.shotIds || []).map(id=>this.latest(stage,{...target,shotIds:[id]}));
      if (perShot.some(r=>!r)) state.status='pending';
      else if (perShot.some(r=>r!.sourceHash!==digest(this.snapshot(stage,r!.target)))) state.status='stale';
      else if (perShot.some(r=>r!.verdict==='failed')) state.status='failed';
      else state.status='passed';
      state.inspectionId=perShot.find(Boolean)?.id;
    } else {
      const record=this.latest(stage,target);
      if(record){state.inspectionId=record.id;state.status=record.sourceHash!==digest(this.snapshot(stage,target))?'stale':record.verdict || 'pending';}
    }
    if (state.blockers.length) state.status='blocked';
    return state;
  }
  require(stage: ProductionQualityStage, target: QualityTarget) {
    const state=this.state(stage,target);
    if(state.status!=='passed') fail(`${state.label}未通过，不能进入依赖它的下一流程。${state.status==='stale'?'检查来源已变化。':''}${state.blockers.join(' ')} 请由${state.owner}查看实际内容并记录检查；失败不触发自动返工。`);
  }
  status(target: QualityTarget) {
    this.context(target);
    const stages=(Object.keys(qualityStages) as ProductionQualityStage[]).filter(s=>qualityStages[s].scope==='project'||qualityStages[s].scope==='episode'&&target.episodeId||!['project','episode'].includes(qualityStages[s].scope)&&target.sceneId);
    return {responsibility:this.responsibility(target.projectId),stages:stages.map(s=>{
      try{return this.state(s,target);}catch(error){if(!(error instanceof GenerationError)||error.code!=='QUALITY_SHOT_RANGE')throw error;return {stage:s,label:qualityStages[s].label,owner:qualityStages[s].owner,status:'blocked' as const,blockers:['先完成当前场次的镜头拆分。'],checks:qualityStages[s].checks.map(id=>({id,label:qualityCheckLabels[id]}))};}
    }),instruction:'先总体、再拆分、再总体。通过只针对已检查的实际内容；未通过不进入依赖流程。允许保存候选和修复草稿，不自动返工，不要求作者逐步审批。'};
  }
  private defaultEvidence(stage: ProductionQualityStage,target:QualityTarget):QualityEvidenceInput[] {
    const {scene,project}=this.context(target);
    if(!scene)return [];
    if(stage==='preparation')return this.assets(target).filter(a=>a.referenceImageUrl).map(a=>({mediaUrl:a.referenceImageUrl,mediaKind:'image',shotIds:target.shotIds,note:a.assetName}));
    if(stage==='visuals')return this.images(scene,target.shotIds||[]);
    if(stage==='segments')return [
      ...this.clips(scene,target).filter(s=>s.videoUrl).map(s=>({mediaUrl:s.videoUrl!,mediaKind:'video' as const,shotIds:[s.sourceShotId!]})),
      ...this.audio(project,scene,target).filter(track=>track.url).map(track=>({mediaUrl:track.url,mediaKind:'audio' as const,shotIds:track.shotId?[track.shotId]:target.shotIds,note:track.text||track.type})),
    ];
    return [];
  }
  async inspect(stage: ProductionQualityStage,raw:QualityTarget,input?:QualityEvidenceInput[]) {
    const target=this.target(stage,raw);
    for(const parent of this.prerequisites(stage,target))this.require(parent.stage,parent.target);
    if(!this.responsibility(target.projectId))fail('请先明确总导演和制片统筹。','QUALITY_RESPONSIBILITY_REQUIRED');
    const snapshot=this.snapshot(stage,target), sourceHash=digest(snapshot);
    const {scene,episode,project}=this.context(target);
    if(stage==='scene_plan' && (!String(scene.script||scene.scriptBlocks?.map((b:any)=>b.content).join('\n')||scene.description||'').trim() || !scene.manualStoryboard?.directorPlan?.intent?.trim()))fail('本场剧本和导演意图尚未形成，不能将空表判为通过。');
    if(stage==='shot_plan' && (!reviewShots(scene).length || reviewShots(scene).some(s=>!(s.duration>0)||!s.visualAction?.trim()||!s.editingNote?.trim())))fail('请完成镜头动作、内容估时与切出依据，再检查拆分方案。');
    if(stage==='preparation' && this.responsibility(target.projectId)?.spatialMode==='previs' && (!this.spatial(target)||this.spatial(target)!.some(x=>!x)))fail('已选择3D依据，请先完成世界与本场调度。');
    if(stage==='preparation'&&this.assets(target).some(a=>!a.referenceImageUrl||a.approvalState==='stale'))fail('本组所需的正式资产图尚未形成或来源已变化，请先核对资产。');
    if(stage==='episode_cut'&&!episode.scenes?.length)fail('分集尚无实际场次。');
    if(stage==='segments'&&this.audio(project,scene,target).some(track=>track.linkedAssetId&&!track.url))fail('关联声音素材尚未保存到本场，请重新从资产库选择该声音后听审。','QUALITY_AUDIO_EVIDENCE_REQUIRED');
    const media=new GenerationMediaStore(this.mediaRoot), evidence=[];
    const requested=input===undefined?this.defaultEvidence(stage,target):input;
    if(!Array.isArray(requested)||requested.length>200)fail('检查证据格式无效。','QUALITY_EVIDENCE_REQUIRED');
    for(const item of requested){
      if(!item||typeof item.mediaUrl!=='string'||!['image','video','audio'].includes(item.mediaKind)||item.shotIds && (!Array.isArray(item.shotIds)||item.shotIds.some(id=>!scene||!reviewShots(scene).some(s=>s.id===id)||target.shotIds?.length&&!target.shotIds.includes(id))))fail('检查证据须关联本范围的实际媒体。','QUALITY_EVIDENCE_REQUIRED');
      const frozen=await media.freeze(item.mediaUrl,item.mediaKind,256*1024*1024),metadata=await media.inspect(frozen.mediaUrl,item.mediaKind);
      evidence.push({...item,...frozen,...metadata});
    }
    if(['visuals','segments'].includes(stage)){
      const kind=stage==='visuals'?'image':'video';
      if(target.shotIds?.some(id=>!evidence.some(e=>e.mediaKind===kind&&e.shotIds?.includes(id))))fail('每个本次镜头都须有对应的实际媒体；占位或缺项不能放行。','QUALITY_EVIDENCE_REQUIRED');
      const current=await Promise.all(this.defaultEvidence(stage,target).map(async e=>({...e,sourceUrl:e.mediaUrl,...await media.freeze(e.mediaUrl,e.mediaKind,256*1024*1024)})));
      if(evidence.some(e=>e.mediaKind===kind&&e.shotIds?.some(id=>!current.some(c=>c.shotIds?.includes(id)&&c.contentHash===e.contentHash))))fail('检查媒体不是该镜头当前选用的实际成果，不能用其他素材代替。','QUALITY_EVIDENCE_MISMATCH');
      if(stage==='segments'){
        if(current.some(c=>c.mediaKind==='audio'&&!evidence.some(e=>e.mediaKind==='audio'&&e.contentHash===c.contentHash)))fail('本组当前使用的独立声音尚未纳入听审，不能只看无配音视频。','QUALITY_AUDIO_EVIDENCE_REQUIRED');
        for(const clip of this.clips(scene,target)){
          const frozen=current.find(e=>e.mediaKind==='video'&&e.sourceUrl===clip.videoUrl&&e.shotIds?.includes(clip.sourceShotId!));
          const actual=frozen&&evidence.find(e=>e.mediaKind==='video'&&e.contentHash===frozen.contentHash&&e.shotIds?.includes(clip.sourceShotId!));
          if(!actual)fail('本组实际剪辑使用的每份视频都须纳入检查。','QUALITY_EVIDENCE_REQUIRED');
          if(!actual.durationSeconds||actual.durationSeconds+.1<(clip.sourceStartSeconds||0)+clip.duration)fail('实际视频未覆盖本镜选定的源入点和时长，不能用缺失或定格延长部分通过视频检查。','QUALITY_MEDIA_INCOMPLETE');
        }
      }
    }
    if(stage==='preparation'&&(this.assets(target).length||this.responsibility(target.projectId)?.spatialMode==='previs')&&!evidence.some(e=>e.mediaKind==='image'))fail('布景和资产质检须查看实际图像，不能只确认表单。','QUALITY_EVIDENCE_REQUIRED');
    if(['scene_cut','episode_cut'].includes(stage)&&evidence.filter(e=>e.mediaKind==='video'&&e.durationSeconds).length!==1)fail('请提供一份实际整场/整集回看视频，单镜全通过不能代替总体检查。','QUALITY_EVIDENCE_REQUIRED');
    if(sourceHash!==digest(this.snapshot(stage,target)))fail('准备检查期间内容已变化，请重新打开检查。','QUALITY_SOURCE_CHANGED');
    const inspection:QualityInspection={id:`quality-${randomUUID()}`,target,stage,sourceHash,snapshot,evidence,createdAt:Date.now()};
    return this.store.put('production-quality-inspection',inspection.id,target.projectId,inspection,0);
  }
  inspection(id:string){const inspection=this.store.get<QualityInspection>('production-quality-review',id)||this.store.get<QualityInspection>('production-quality-inspection',id);if(!inspection)fail('检查对象不存在。','QUALITY_INSPECTION_NOT_FOUND');return inspection;}
  review(id:string,input:{verdict:'passed'|'failed';findings:QualityFinding[];reviewerName:string},reviewer:'creator'|'external_agent'){
    const inspection=this.inspection(id),{stage,target}=inspection;
    if(!['passed','failed'].includes(input.verdict)||typeof input.reviewerName!=='string'||!input.reviewerName.trim()||!Array.isArray(input.findings))fail('请记录实际检查人与结论。','QUALITY_REVIEW_REQUIRED');
    const expected=qualityStages[stage].checks;
    if(input.findings.length!==expected.length||expected.some(check=>input.findings.filter(f=>f.check===check&&typeof f.passed==='boolean'&&typeof f.note==='string'&&f.note.trim()).length!==1)||input.verdict==='passed'&&input.findings.some(f=>!f.passed)||input.verdict==='failed'&&!input.findings.some(f=>!f.passed))fail('逐项写明实际观察，未通过项不能整体放行。','QUALITY_REVIEW_REQUIRED');
    if(['project_plan','scene_plan','visuals','scene_cut','episode_cut'].includes(stage)&&input.reviewerName!==this.responsibility(target.projectId)?.director)fail('总体检查由已指定的总导演负责；可以是同一名人类或外部Agent，不增加第二轮审批。','QUALITY_DIRECTOR_REQUIRED');
    return this.store.db.transaction(()=>{
      const previous=this.store.get<QualityInspection>('production-quality-review',id);
      if(previous){if(previous.verdict===input.verdict&&JSON.stringify(previous.findings)===JSON.stringify(input.findings)&&previous.reviewerName===input.reviewerName)return previous;fail('已记录的检查不能改写，请针对实际修改后的内容重新打开检查。','QUALITY_REVIEW_IMMUTABLE');}
      if(inspection.sourceHash!==digest(this.snapshot(stage,target)))fail('被检查的内容已经变化，旧结论不能放行新内容。','QUALITY_SOURCE_CHANGED');
      for(const parent of this.prerequisites(stage,target))this.require(parent.stage,parent.target);
      const lastTime=this.store.list<QualityInspection>('production-quality-review',target.projectId).reduce((last,item)=>Math.max(last,item.reviewedAt||0),0);
      const record:QualityInspection={...inspection,verdict:input.verdict,findings:input.findings.map(f=>({check:f.check,passed:f.passed,note:f.note.trim()})),reviewerName:input.reviewerName,reviewer,reviewedAt:Math.max(Date.now(),lastTime+1)};
      this.store.put('production-quality-review',id,target.projectId,record);
      return record;
    })();
  }
  /** Check again at submission and dispatch, including queued and imported work. */
  assertGeneration(target:GenerationTarget,operation:GenerationOperation,references:GenerationReference[],checkReferences=true){
    if(target.kind==='scratch'||['crop','extract_frame','upscale'].includes(operation))return;
    this.require('project_plan',target);
    if(target.kind==='asset')return;
    this.require(operation==='video'?'visuals':'preparation',target);
    if(!checkReferences)return;
    if(operation!=='video'&&this.responsibility(target.projectId)?.spatialMode==='previs'&&target.shotIds.some(id=>!references.some(r=>r.enabled&&r.previsSource?.sceneId===target.sceneId&&r.role==='composition'&&r.sourceShotIds?.includes(id))))fail('本项目选用3D拍摄依据：本组每个镜头都须实际发送对应白模构图，环境风格图不能代替调度。','QUALITY_PREVIS_REFERENCE_REQUIRED');
    if(operation==='video'){
      const shots=target.shotIds||[];
      for(const id of shots){
        const checked=this.latest('visuals',this.target('visuals',{...target,shotIds:[id]}));
        if(!checked?.evidence.some(e=>e.shotIds?.includes(id)&&references.some(r=>r.enabled&&r.mediaKind==='image'&&['first_frame','composition','board_sequence'].includes(r.role)&&(r.contentHash===e.contentHash||r.mediaUrl===e.mediaUrl))))fail('视频输入未包含本镜已通过整组检查的画面，不能换成未经核对的独立参考。','QUALITY_VISUAL_REFERENCE_REQUIRED');
      }
    }
  }
  assertAudioGeneration(target:QualityTarget){this.require('preparation',target);}
  delivery(inspectionId:string){
    const inspection=this.inspection(inspectionId);
    if(!['scene_cut','episode_cut'].includes(inspection.stage))fail('正式交付须使用整体总检。');
    this.require(inspection.stage,inspection.target);
    const current=this.latest(inspection.stage,inspection.target);
    if(current?.id!==inspectionId)fail('请选择当前总体检查对应的成片。');
    return {target:inspection.target,inspectionId,media:current.evidence.filter(e=>e.mediaKind==='video'),status:'quality_passed' as const};
  }
}
