import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import type { ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';

/** Author-owned document endpoints. Tool execution uses the same repository
 * with its fenced Step token; clients cannot post a token or claim a writer. */
export function registerScriptWorkspaceRoutes(app:Express, deps:{workspaces:ScriptWorkspaceStore;owner(req:Request):string;withReadBatch?<T>(read:()=>T):T}) {
  const {workspaces}=deps;
  const withReadBatch=deps.withReadBatch??(<T>(read:()=>T)=>read());
  const fail=(res:Response,error:unknown)=>res.status(error instanceof AgentError?error.status:Number((error as any)?.statusCode)||400).json({error:error instanceof Error?error.message:'工作稿操作失败',code:error instanceof AgentError?error.code:'INVALID_WORKSPACE'});
  const access=(req:Request)=>({workspaceId:req.params.id,ownerId:deps.owner(req)});
  app.get('/api/script-workspaces',(req,res)=>{try{return withReadBatch(()=>{
    if(req.query.view!=='state')return res.json({workspaces:workspaces.list(deps.owner(req))});
    const {threadId,documentId}=req.query;
    if(typeof threadId!=='string'||typeof documentId!=='string'||![threadId,documentId].every(id=>/^[\w-]{1,120}$/.test(id)))
      throw new AgentError('INVALID_WORKSPACE_SCOPE','请指定有效的作品会话',400);
    const known=typeof req.query.known==='string'?JSON.parse(req.query.known):[];
    if(!Array.isArray(known)||known.length>100||known.some(item=>!Array.isArray(item)||item.length!==2||typeof item[0]!=='string'||!Number.isSafeInteger(item[1])||item[1]<1))
      throw new AgentError('INVALID_WORKSPACE_REVISIONS','工作稿读取版本无效',400);
    const revisions=new Map<string,number>(known);
    // Always read and authorize the current row. Only the immutable document
    // already held by this caller is omitted; status and revocation stay live.
    res.json({workspaces:workspaces.list(deps.owner(req),{threadId,documentId}).map(workspace=>{
      const {document,...state}=workspace;
      return revisions.get(workspace.id)===workspace.revision?state:workspace;
    })});
  });}catch(error){fail(res,error);}});
  app.post('/api/script-workspaces',(req,res)=>{try{res.status(201).json({workspace:workspaces.create({ownerId:deps.owner(req),threadId:req.body.threadId,requestId:req.body.requestId,source:req.body.source})});}catch(error){fail(res,error);}});
  app.get('/api/script-workspaces/:id',(req,res)=>{try{res.json({workspace:workspaces.read(req.params.id,deps.owner(req))});}catch(error){fail(res,error);}});
  app.put('/api/script-workspaces/:id',(req,res)=>{try{res.json({workspace:workspaces.saveAuthor({...access(req),requestId:req.body.requestId,expectedRevision:req.body.expectedRevision,expectedEpoch:req.body.expectedEpoch,document:req.body.document,...(req.body.takeover?{takeover:req.body.takeover}:{})})});}catch(error){fail(res,error);}});
  app.post('/api/script-workspaces/:id/sync-author',(req,res)=>{try{res.json(workspaces.syncAuthor({...access(req),requestId:req.body.requestId,
    expectedRevision:req.body.expectedRevision,expectedEpoch:req.body.expectedEpoch,expectedAuthorRevision:req.body.expectedAuthorRevision,
    ...(req.body.takeover?{takeover:req.body.takeover}:{})}));}catch(error){fail(res,error);}});
  app.get('/api/script-workspaces/:id/revisions/:revision',(req,res)=>{try{res.json({document:workspaces.version(req.params.id,deps.owner(req),Number(req.params.revision))});}catch(error){fail(res,error);}});
  app.get('/api/script-workspaces/:id/author-baseline',(req,res)=>{try{res.json({document:workspaces.authorBaseline(req.params.id,deps.owner(req))});}catch(error){fail(res,error);}});
  app.post('/api/script-workspaces/:id/merge',(req,res)=>{try{
    const input={...access(req),workspaceRevision:req.body.workspaceRevision,expectedAuthorRevision:req.body.expectedAuthorRevision};
    if(req.body.resolutions!==undefined&&!Array.isArray(req.body.resolutions))throw new AgentError('INVALID_WORKSPACE_RESOLUTIONS','合并选择格式无效',400);
    if(req.body.resolutions===undefined){
      const conflicts=workspaces.inspectAdoption(input);
      if(conflicts.length){res.json({proposal:null,conflicts});return;}
    }
    res.json({proposal:workspaces.prepareAdoption({...input,resolutions:req.body.resolutions,outlineOnly:req.body.outlineOnly===true}),conflicts:[]});
  }catch(error){fail(res,error);}});
  app.post('/api/script-workspaces/:id/adopt',(req,res)=>{try{res.json({receipt:workspaces.adopt({...access(req),requestId:req.body.requestId,proposalId:req.body.proposalId,digest:req.body.digest})});}catch(error){fail(res,error);}});
  app.post('/api/script-workspaces/:id/export',(req,res)=>{try{res.json(workspaces.exportVersion({...access(req),revision:req.body.revision,unitIds:req.body.unitIds,format:req.body.format}));}catch(error){fail(res,error);}});
}
