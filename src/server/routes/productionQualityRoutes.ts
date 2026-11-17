import type { Express } from 'express';
import { ProductionQuality } from '../productionQuality';
import type { GenerationStore } from '../generation/store';

export function registerProductionQualityRoutes(app:Express,store:GenerationStore,mediaRoot:string,options:{basePath?:string;operator?:boolean;assertProjectAccess?:(id:string)=>void}={}){
  const base=options.basePath || '/api/production/quality',quality=new ProductionQuality(store,mediaRoot);
  const access=(id:string)=>options.assertProjectAccess?.(id);
  const route=(fn:(req:any,res:any)=>unknown)=>(req:any,res:any)=>Promise.resolve().then(()=>fn(req,res)).catch((e:any)=>res.status(e.statusCode||400).json({code:e.code||'QUALITY_INVALID',error:e.message}));
  app.get(`${base}/status`,route((req,res)=>{const target=JSON.parse(String(req.query.target||'{}'));access(target.projectId);res.json(quality.status(target));}));
  app.put(`${base}/projects/:id/responsibility`,route((req,res)=>{access(req.params.id);res.json(quality.saveResponsibility(req.params.id,req.body));}));
  app.post(`${base}/inspections`,route(async(req,res)=>{access(req.body?.target?.projectId);res.status(201).json({inspection:await quality.inspect(req.body.stage,req.body.target,req.body.evidence)});}));
  app.get(`${base}/inspections/:id`,route((req,res)=>{const inspection=quality.inspection(req.params.id);access(inspection.target.projectId);res.json({inspection});}));
  app.post(`${base}/inspections/:id/review`,route((req,res)=>{access(quality.inspection(req.params.id).target.projectId);res.json({inspection:quality.review(req.params.id,req.body,options.operator?'external_agent':'creator')});}));
  app.post(`${base}/deliveries`,route((req,res)=>{access(quality.inspection(req.body.inspectionId).target.projectId);res.json(quality.delivery(req.body.inspectionId));}));
}
