import { readLibraryPreview, startLibraryPreview } from './libraryPreview';
import { installDistrict } from './district';
import express, {type Express,type Request,type Response} from 'express';
import { listStudios, readStudio, publishStudio, listModels, saveModel } from './catalog';
import { queueModelImport } from './importQueue';
import { installSamples } from './samples';
export function registerSpatialLibrary(app:Express,root:string,base:string) {
  const wrap=(fn:(req:Request,res:Response)=>unknown)=>async(req:Request,res:Response)=>{try{await fn(req,res);}catch(e:any){res.status(e.statusCode||400).json({error:e.message});}};
  app.get(`${base}/library/studios`,wrap((_req,res)=>res.json({studios:listStudios()})));
  app.get(`${base}/library/studios/:id`,wrap((req,res)=>res.json({studio:readStudio(req.params.id,req.query.revision?Number(req.query.revision):undefined)})));
  app.get(`${base}/library/studios/:id/previews`,wrap(async(req,res)=>res.json(await readLibraryPreview(root,req.params.id,req.query.revision?Number(req.query.revision):undefined))));
  app.post(`${base}/library/studios/:id/previews`,wrap(async(req,res)=>res.json(await startLibraryPreview(root,req.params.id,req.body.revision,req.socket.localPort!))));
  app.post(`${base}/library/studios`,wrap((req,res)=>res.status(201).json({studio:publishStudio(req.body)})));
  app.post(`${base}/library/samples`,wrap(async(_req,res)=>{await installSamples(root);res.json({studios:listStudios()});}));
  app.post(`${base}/library/district`,wrap(async(_req,res)=>{const studio=await installDistrict(root);res.json({studio});}));
  app.get(`${base}/library/models`,wrap((_req,res)=>res.json({models:listModels()})));
  app.post(`${base}/library/models`,express.raw({type:'model/gltf-binary',limit:'100mb'}),wrap(async(req,res)=>{
    if(!Buffer.isBuffer(req.body))throw new Error('请上传独立 GLB，Content-Type: model/gltf-binary。');
    const name=String(req.query.name||'导入模型'),license=String(req.query.license||'');if(!license.trim())throw new Error('请注明模型来源及使用许可。');
    const model=saveModel(await queueModelImport(root,req.body,name,license));res.status(201).json({model});
  }));
}
