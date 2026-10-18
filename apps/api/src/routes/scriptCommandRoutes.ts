import type { Express, Request, Response } from 'express';
import { AgentError } from '../../../../packages/agent-core/src';
import type { MethodBinding } from '../../../../packages/script/src/schema';
import type { ScriptCommandService } from '../agent/scriptCommands';

/** Only an author selection enters here. The service derives authorization,
 * execution route, prepared capabilities and Goal proof on the server. */
export function registerScriptCommandRoutes(app:Express,deps:{
  commands:ScriptCommandService;owner(req:Request):string;
  resolveMethods(ids:string[]):Promise<MethodBinding[]>;
  resolveExecution(req:Request):{channel:'api'|'external';routeRef:string};
}){
  const fail=(res:Response,error:unknown)=>res.status(error instanceof AgentError?error.status:400).json({
    error:error instanceof Error?error.message:'剧本命令失败',code:error instanceof AgentError?error.code:'INVALID_SCRIPT_COMMAND'});
  app.post('/api/script-commands',async(req,res)=>{
    try{res.status(202).json(await deps.commands.submit(deps.owner(req),req.body,{
      resolveMethods:deps.resolveMethods,resolveExecution:()=>deps.resolveExecution(req)}));}
    catch(error){fail(res,error);}
  });
  app.get('/api/script-goals/:id/budget',(req,res)=>{
    try{res.json({budget:deps.commands.goalBudget(deps.owner(req),req.params.id)});}
    catch(error){fail(res,error);}
  });
  app.post('/api/script-goals/:id/budget',(req,res)=>{
    try{res.json({budget:deps.commands.increaseGoalBudget(deps.owner(req),req.params.id,req.body)});}
    catch(error){fail(res,error);}
  });
}
