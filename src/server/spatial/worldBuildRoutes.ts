import {readSnapshotPreview,startSnapshotPreview} from './libraryPreview';
import { dbHelpers } from '../db';
import type { Express, Request, Response } from 'express';
import { createBuild,listBuilds,readBuild,returnBuild,applyBuild,buildReturns } from './worldBuild';
import { worldBuildContract } from './worldBuildContract';
export function registerWorldBuildRoutes(app:Express,root:string,base:string,access?:(id:string)=>void){
 const wrap=(fn:(req:Request,res:Response)=>unknown)=>async(req:Request,res:Response)=>{try{access?.(req.params.projectId);await fn(req,res);}catch(e:any){res.status(e.statusCode||400).json({error:e.message});}};
 app.get(`${base}/build-contract`,(_req,res)=>res.json(worldBuildContract));
 app.get(`${base}/:projectId/build-options`,wrap((_req,res)=>{const {config}=dbHelpers.getAIConfig();res.json({defaultModelId:config.routing.scriptGen,models:config.models.filter(m=>m.capabilities.includes('text')).map(m=>({id:m.id,name:m.modelId,provider:config.channels.find(c=>c.id===m.channelId)?.type||''}))});}));
 app.get(`${base}/:projectId/builds`,wrap((req,res)=>res.json({tasks:listBuilds(req.params.projectId)})));
 app.post(`${base}/:projectId/builds`,wrap((req,res)=>res.status(202).json({task:createBuild(root,req.params.projectId,req.body)})));
 app.get(`${base}/:projectId/builds/:id`,wrap((req,res)=>res.json({task:readBuild(req.params.projectId,req.params.id)})));
 app.post(`${base}/:projectId/builds/:id/result`,wrap(async(req,res)=>res.json({task:await returnBuild(root,req.params.projectId,req.params.id,req.body.rawResult)})));
 const snapshot=(req:Request)=>{const t=readBuild(req.params.projectId,req.params.id);if(!t.candidate)throw new Error('尚无可拍摄候选。');return {id:`build-${t.id}-${t.resultHash!.slice(0,12)}`,revision:1,plan:t.candidate};};
 app.get(`${base}/:projectId/builds/:id/previews`,wrap(async(req,res)=>res.json(await readSnapshotPreview(root,snapshot(req)))));
 app.post(`${base}/:projectId/builds/:id/previews`,wrap(async(req,res)=>res.json(await startSnapshotPreview(root,snapshot(req),req.socket.localPort!))));
 app.get(`${base}/:projectId/builds/:id/returns`,wrap((req,res)=>res.json({returns:buildReturns(req.params.projectId,req.params.id)})));
 app.post(`${base}/:projectId/builds/:id/apply`,wrap((req,res)=>res.json(applyBuild(req.params.projectId,req.params.id))));
}
