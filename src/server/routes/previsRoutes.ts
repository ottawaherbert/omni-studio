import { saveWorldPlan } from '../spatial/worldSave';
import { registerWorldBuildRoutes } from '../spatial/worldBuildRoutes';
import { registerContactChecks } from '../spatial/contactChecks';
import { startCapture, captureStatus, pauseCapture } from '../spatial/capture';
import { registerSpatialLibrary } from '../spatial/routes';
import { validateModelReferences } from '../spatial/catalog';
import type { Express, Request, Response } from 'express';
import { db, dbHelpers } from '../db';
import type { Project, Episode, Scene } from '../../types/project';
import { previsExportSpec, previsVisibleLocations, validatePrevisPlan, validatePrevisWorld, type PrevisWorld, type ScenePrevis, type PrevisExport } from '../../../packages/domain/src/previs';
import { readPrevisDocument, savePrevisDocument, previsSceneKey, listPrevisScenes } from '../previsStore';
import type { GenerationMediaStore } from '../generation/media';
import { PrevisVideoService, readPrevisVideo, listPrevisVideos, previsVideoCurrent } from '../previsVideo';
import { ProductionQuality } from '../productionQuality';
import { GenerationStore } from '../generation/store';

export function registerPrevisRoutes(app: Express, media: GenerationMediaStore, options: { basePath?: string; assertProjectAccess?: (id: string) => void } = {}) {
  const base = options.basePath || '/api/production/previs';
  registerSpatialLibrary(app, media.root, base);
  registerWorldBuildRoutes(app,media.root,base,options.assertProjectAccess);
  registerContactChecks(app,base,options.assertProjectAccess);
  const videos = new PrevisVideoService(media.root);
  const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { options.assertProjectAccess?.(req.params.projectId); await fn(req, res); }
    catch (e: any) { res.status(e.statusCode || 400).json({ error: e.message || '白模操作失败，原内容保留。' }); }
  };
  const project = (id: string) => { const p = dbHelpers.getProjectById(id) as Project; if (!p) throw Object.assign(new Error('项目不存在。'), { statusCode: 404 }); return p; };
  const brief = (p: Project) => ({ id: p.id, title: p.title, aspectRatio: p.aspectRatio, characters: p.characters, assets: p.assets });
  const worldWorkspace = (p: Project) => ({ project: brief(p), world: readPrevisDocument<PrevisWorld>(p.id, 'world'), scenes: (p.episodes as Episode[] || []).flatMap(e => (e.scenes || []).map(s => ({ episodeId: e.id, episodeTitle: e.title, id: s.id, title: s.title, script: s.script || s.scriptBlocks?.map(b => b.content).join('\n') || '', description: s.description || '', locationIds: [...new Set((s.shots || []).map(s => s.locationId).filter(Boolean))] }))) });
  const workspace = (req: Request) => {
    const p = dbHelpers.getProjectShellById(req.params.projectId) as Project;
    const episode = dbHelpers.getEpisodeById(req.params.projectId, req.params.episodeId) as Episode;
    const scene = episode?.scenes?.find(s => s.id === req.params.sceneId);
    if (!p || !episode || !scene) throw Object.assign(new Error('项目、分集或场次不存在。'), { statusCode: 404 });
    return { project: brief(p), scene, episodeRevision: episode.productionRevision || 0, world: readPrevisDocument<PrevisWorld>(p.id, 'world'), document: readPrevisDocument<ScenePrevis>(p.id, previsSceneKey(episode.id, scene.id)) };
  };
  // Scoped upserts preserve current unrelated geometry and hide storage stamps.
  const upsert=(current:any[]=[],patch:any[])=>{
    if(!Array.isArray(patch)||patch.some(item=>!item||typeof item.id!=='string'))throw new Error('请为修改项提供稳定ID。');
    const items=new Map(current.map(item=>[item.id,item]));
    for(const item of patch){const old=items.get(item.id);const next={...old,...item};
      if(old?.camera&&item.camera)next.camera={...old.camera,...item.camera};
      if(item.states){next.states={...old?.states};for(const [id,state] of Object.entries(item.states))next.states[id]={...old?.states?.[id],...state as object};}
      items.set(item.id,next);
    }
    return [...items.values()];
  };
  app.patch(`${base}/:projectId`,wrap((req,res)=>{
    const result=db.transaction(()=>{
      const p=project(req.params.projectId),old=readPrevisDocument<PrevisWorld>(p.id,'world');
      const plan:any=structuredClone(old?.plan || {schemaVersion:'previs-world.v1',title:p.title,description:'',locations:[],objects:[]});
      const input=req.body || {};
      if(Object.keys(input).some(k=>!['locations','objects','viewpoints','routes','connections','worldBrief','title','description'].includes(k)))throw new Error('请只提交本次布景修改。');
      for(const key of ['locations','objects','viewpoints','routes','connections'])if(input[key]!==undefined)plan[key]=upsert(plan[key],input[key]);
      if(input.worldBrief)plan.worldBrief={...plan.worldBrief,...input.worldBrief};
      for(const key of ['title','description'])if(input[key]!==undefined)plan[key]=input[key];
      saveWorldPlan(p,plan,old?.revision || 0);
      return worldWorkspace(p);
    })();res.json(result);
  }));
  app.get(`${base}/:projectId`, wrap((req, res) => res.json(worldWorkspace(project(req.params.projectId)))));
  app.put(`${base}/:projectId`, wrap((req, res) => {
    const p = project(req.params.projectId);
    saveWorldPlan(p,req.body.plan,req.body.expectedRevision);
    res.json(worldWorkspace(p));
  }));
  const scope = `${base}/:projectId/:episodeId/:sceneId`;
  const videoAccess = (req: Request) => { const video = readPrevisVideo(req.params.videoId); if (video.projectId !== req.params.projectId) throw Object.assign(new Error('白模视频不属于当前项目。'), { statusCode: 404 }); return video; };
  app.get(`${base}/:projectId/videos`, wrap((req, res) => res.json({ videos: listPrevisVideos(req.params.projectId).slice(0, 50).map(({ timeline, ...v }) => ({ ...v, duration: timeline.duration, sourceCurrent: v.status === 'complete' ? previsVideoCurrent({ ...v, timeline }) : undefined })) })));
  app.post(`${base}/:projectId/videos`, wrap(async (req, res) => res.status(201).json({ video: await videos.create(req.params.projectId, req.body || {}) })));
  app.get(`${base}/:projectId/videos/:videoId/capture`, wrap((req,res)=>{videoAccess(req);res.json(captureStatus(req.params.videoId));}));
  app.post(`${base}/:projectId/videos/:videoId/capture`, wrap((req,res)=>{videoAccess(req);res.json(startCapture(req.params.videoId,media.root,req.socket.localPort!));}));
  app.post(`${base}/:projectId/videos/:videoId/capture/pause`,wrap((req,res)=>{videoAccess(req);res.json(pauseCapture(req.params.videoId));}));
  app.get(`${base}/:projectId/videos/:videoId`, wrap((req, res) => res.json({ video: videoAccess(req) })));
  app.post(`${base}/:projectId/videos/:videoId/frames`, wrap(async (req, res) => { videoAccess(req); const { timeline, ...video } = await videos.frames(req.params.videoId, req.body.start, req.body.images); res.json({ video }); }));
  app.post(`${base}/:projectId/videos/:videoId/finish`, wrap(async (req, res) => { videoAccess(req); const { timeline, ...video } = await videos.finish(req.params.videoId); res.json({ video }); }));
  app.post(`${base}/:projectId/videos/:videoId/cancel`, wrap((req, res) => { videoAccess(req); const { timeline, ...video } = videos.cancel(req.params.videoId); res.json({ video }); }));
  app.get(scope, wrap((req, res) => res.json(workspace(req))));
  app.patch(scope,wrap((req,res)=>{
    const result=db.transaction(()=>{
      const current=workspace(req);if(!current.world)throw new Error('请先建立本剧影视城。');
      const input=req.body || {};
      if(Object.keys(input).some(k=>!['locationId','includedLocationIds','objects','frames','light'].includes(k)))throw new Error('请只提交本场排演修改。');
      const plan:any=structuredClone(current.document?.plan || {schemaVersion:'scene-previs.v1',locationId:input.locationId,objects:[],frames:[],light:{position:[5,10,5],intensity:2}});
      for(const key of ['locationId','includedLocationIds'])if(input[key]!==undefined)plan[key]=input[key];
      if(input.light)plan.light={...plan.light,...input.light};
      for(const key of ['objects','frames'])if(input[key]!==undefined)plan[key]=upsert(plan[key],input[key]);
      validatePrevisPlan(plan,current.scene,current.project as Project,current.world.plan);
      const document=savePrevisDocument<ScenePrevis>(req.params.projectId,previsSceneKey(req.params.episodeId,req.params.sceneId),{plan,exports:current.document?.exports || []},current.document?.revision || 0);
      return {...current,document};
    })();res.json(result);
  }));
  app.put(scope, wrap((req, res) => {
    const current = workspace(req);
    if (!current.world) throw new Error('请先建立本剧影视城，再安排场次机位。');
    if (req.body.expectedWorldRevision !== current.world.revision) throw Object.assign(new Error('影视城已更新，请重新读取布景后调整机位；当前草稿仍保留。'), { statusCode: 409 });
    if (req.body.expectedEpisodeRevision !== current.episodeRevision) throw Object.assign(new Error('剧本或镜头已更新，请重新读取场次；白模草稿仍保留。'), { statusCode: 409 });
    validatePrevisPlan(req.body.plan, current.scene, current.project as Project, current.world.plan);
    const document = savePrevisDocument<ScenePrevis>(req.params.projectId, previsSceneKey(req.params.episodeId, req.params.sceneId), { plan: req.body.plan, exports: current.document?.exports || [] }, req.body.expectedRevision);
    res.json({ ...current, document });
  }));
  app.post(`${scope}/exports`, wrap(async (req, res) => {
    const current = workspace(req), input = req.body;
    new ProductionQuality(new GenerationStore(db),media.root).require('shot_plan',{projectId:req.params.projectId,episodeId:req.params.episodeId,sceneId:req.params.sceneId});
    if (!current.world || !current.document) throw new Error('请先保存影视城和本场机位。');
    if (current.document.revision !== input.expectedRevision) throw Object.assign(new Error('拍摄方案已变化，请重新导出。'), { statusCode: 409 });
    if (typeof input.commandId !== 'string' || !/^[\w-]{1,100}$/.test(input.commandId)) throw new Error('导出编号无效。');
    validatePrevisPlan(current.document.plan, current.scene, current.project as Project, current.world.plan);
    const spec = previsExportSpec(current.document.plan, current.scene, current.project.aspectRatio, input.frameIds, input.columns, current.world.plan);
    if (spec.sourceHash !== input.sourceHash) throw Object.assign(new Error('布景、机位或分镜已变化，请重新导出当前画面。'), { statusCode: 409 });
    const id = `previs-${input.commandId}`, old = current.document.exports.find(e => e.id === id);
    if (old) { if (old.sourceHash !== spec.sourceHash) throw new Error('导出编号已被其它内容使用。'); return res.json({ document: current.document, item: old, episodeRevision: current.episodeRevision }); }
    if (typeof input.imageUrl !== 'string' || !/^(?:data:image\/png;base64,|\/media\/)/.test(input.imageUrl)) throw new Error('请上传本机渲染的 PNG 白模宫格。');
    const frozen = await media.freeze(input.imageUrl, 'image', 20 * 1024 * 1024);
    const metadata = await media.inspect(frozen.mediaUrl, 'image');
    if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width < spec.columns * 128 || metadata.height < spec.rows * 128) throw new Error('宫格尺寸无效，每格至少 128 像素，整图最长边不超过 8192。');
    const [aw, ah] = current.project.aspectRatio.split(':').map(Number);
    if (Math.abs((metadata.width / spec.columns) / (metadata.height / spec.rows) - aw / ah) > .02) throw new Error('每格画幅必须与项目画幅一致。');
    const latest = workspace(req);
    if (!latest.world || !latest.document || latest.document.revision !== current.document.revision || previsExportSpec(latest.document.plan, latest.scene, latest.project.aspectRatio, input.frameIds, input.columns, latest.world.plan).sourceHash !== spec.sourceHash) throw Object.assign(new Error('导出期间来源变化，文件已保留但未登记参考。'), { statusCode: 409 });
    const item: PrevisExport = { ...spec, id, imageUrl: frozen.mediaUrl, contentHash: frozen.contentHash, width: metadata.width, height: metadata.height, createdAt: Date.now() };
    const document = savePrevisDocument<ScenePrevis>(req.params.projectId, previsSceneKey(req.params.episodeId, req.params.sceneId), { plan: latest.document.plan, exports: [...latest.document.exports, item] }, latest.document.revision);
    res.status(201).json({ document, item, episodeRevision: latest.episodeRevision });
  }));
}
