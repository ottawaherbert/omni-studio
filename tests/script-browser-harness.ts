import {scriptChatSkills as skills} from './fixtures/script-chat-skills';
import express from 'express';
import Database from 'better-sqlite3';
import {createServer} from 'vite';
import {resolve} from 'node:path';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {registerScriptConversationRoutes} from '../apps/api/src/routes/scriptConversationRoutes';
import {registerAgentRoutes} from '../apps/api/src/routes/agentRoutes';
import {registerScriptWorkspaceRoutes} from '../apps/api/src/routes/scriptWorkspaceRoutes';
import {registerScriptCommandRoutes} from '../apps/api/src/routes/scriptCommandRoutes';
import {registerScriptReadRoutes} from '../apps/api/src/routes/scriptReadRoutes';
import {registerScriptMemoryRoutes} from '../apps/api/src/routes/scriptMemoryRoutes';
import {registerAgentContextRoutes} from '../apps/api/src/routes/agentContextRoutes';
import {AgentError} from '../packages/agent-core/src';
import {selectSharedMethods,methodFromSkill} from '../packages/script/src/methods';
import {registerScriptRoutes} from '../apps/api/src/routes/scriptRoutes';
const app=express();app.use(express.json({limit:'4mb'}));
const databasePath=process.env.SCRIPT_BROWSER_DB||'/tmp/script-acceptance-20260925.sqlite';
const port=Number(process.env.SCRIPT_BROWSER_PORT)||3011;
if (!databasePath.startsWith('/tmp/')) throw new Error('Browser acceptance requires an isolated /tmp database');
const db=new Database(databasePath);
const host=process.env.SCRIPT_BROWSER_AGENT==='1'?createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('验收禁止外部模型请求');}},'browser-acceptance',
 {trustedLegacyProjectOwner:'isolated-author'}):null;
const repo=host?.scripts||createScriptRepository(db);repo.ensureSchema();
const saveFaults={delayNextSaveMs:0};
app.post('/api/acceptance/script-save-faults',(req,res)=>{
 saveFaults.delayNextSaveMs=Math.min(15000,Math.max(0,Number(req.body.delayNextSaveMs)||0));
 res.json(saveFaults);
});
app.use('/api/scripts',(req,_res,next)=>{
 if(req.method==='PUT'&&/^\/[^/]+$/.test(req.path)&&saveFaults.delayNextSaveMs){
  const delay=saveFaults.delayNextSaveMs;saveFaults.delayNextSaveMs=0;setTimeout(next,delay);return;
 }
 next();
});
registerScriptRoutes(app,repo,async ids=>selectSharedMethods(skills,ids));
// Explicitly authored fixture; never reads or mutates the user's shared Skill library.
app.get('/api/skills',(_req,res)=>res.json({skills}));
let workerTimer: ReturnType<typeof setTimeout> | undefined;
let stopped=false;
if(host){
 const faults={loseNextMessageAck:false,delayNextOpenMs:0,rejectNextWorkspaceCreate:false,loseNextWorkspaceAck:false,loseNextAdoptionAck:false,loseNextBudgetAck:false};
 app.post('/api/acceptance/chat-faults',(req,res)=>{faults.loseNextMessageAck=req.body.loseNextMessageAck===true;faults.delayNextOpenMs=Math.min(5000,Math.max(0,Number(req.body.delayNextOpenMs)||0));res.json(faults);});
 app.post('/api/acceptance/workspace-faults',(req,res)=>{faults.rejectNextWorkspaceCreate=req.body.rejectNextWorkspaceCreate===true;
  faults.loseNextWorkspaceAck=req.body.loseNextWorkspaceAck===true;
  faults.loseNextAdoptionAck=req.body.loseNextAdoptionAck===true;
  faults.loseNextBudgetAck=req.body.loseNextBudgetAck===true;res.json(faults);});
 app.use('/api/script-workspaces',(req,res,next)=>{
  if(req.method==='POST'&&req.path==='/'){
   if(faults.rejectNextWorkspaceCreate){faults.rejectNextWorkspaceCreate=false;res.status(409).json({error:'验收注入：作者稿版本已变化',code:'WORKSPACE_CONFLICT'});return;}
   if(faults.loseNextWorkspaceAck){const json=res.json.bind(res);res.json=body=>{
    if(res.statusCode===201){faults.loseNextWorkspaceAck=false;res.status(503);return json({error:'验收注入：工作稿已创建但回执丢失'});}return json(body);
   };}
  }
  if(req.method==='POST'&&req.path.endsWith('/adopt')&&faults.loseNextAdoptionAck){const json=res.json.bind(res);res.json=body=>{
   if(res.statusCode===200){faults.loseNextAdoptionAck=false;res.status(503);return json({error:'验收注入：作者稿已采用但回执丢失'});}return json(body);
  };}
  next();
 });
 app.use('/api/script-goals',(req,res,next)=>{
  if(req.method==='POST'&&/^\/[^/]+\/budget$/.test(req.path)&&faults.loseNextBudgetAck){
   const json=res.json.bind(res);res.json=body=>{
    if(res.statusCode===200){faults.loseNextBudgetAck=false;res.status(503);return json({error:'验收注入：额度已增加但回执丢失'});}return json(body);
   };
  }
  next();
 });
 app.use('/api/script-assistant/conversations',(req,res,next)=>{
  if(req.method==='POST'&&req.path.endsWith('/messages')&&faults.loseNextMessageAck){
   const json=res.json.bind(res);
   res.json=body=>{if(res.statusCode===202){faults.loseNextMessageAck=false;res.status(503);return json({error:'验收注入：消息已接收但提交回执丢失'});}return json(body);};
  }
  if(req.method==='POST'&&req.path==='/'&&faults.delayNextOpenMs){const delay=faults.delayNextOpenMs;faults.delayNextOpenMs=0;setTimeout(next,delay);return;}
  next();
 });
 registerScriptConversationRoutes(app,{...host,owner:()=> 'isolated-author',channel:'external',routeRef:'simulation:mechanical-no-model',resolveMethods:async ids=>ids.flatMap(id=>{const skill=skills.find(s=>s.id===id);return skill?[methodFromSkill(skill)]:[];})});
 registerScriptWorkspaceRoutes(app,{workspaces:host.workspaces,owner:()=> 'isolated-author'});
 registerScriptCommandRoutes(app,{commands:host.commands,owner:()=> 'isolated-author',resolveMethods:async ids=>ids.flatMap(id=>{const skill=skills.find(s=>s.id===id);return skill?[methodFromSkill(skill)]:[];}),resolveExecution:()=>({channel:'external',routeRef:'simulation:mechanical-no-model'})});
 registerScriptReadRoutes(app,{...host,owner:()=> 'isolated-author'});
 const authorizeScope=(access:{ownerId:string;scopeId:string;branch:string})=>{
  if(access.branch===`workspace:${access.scopeId}`){host.workspaces.read(access.scopeId,access.ownerId);return;}
  if(access.branch!=='author'||(access.scopeId!=='script:home'&&!host.workspaces.ownsProject(access.scopeId,access.ownerId)))
   throw new AgentError('CONTEXT_SCOPE_DENIED','上下文不属于当前剧本范围',403);
 };
 registerScriptMemoryRoutes(app,{memory:host.memory,owner:()=> 'isolated-author',authorizeScope});
 registerAgentRoutes(app,{...host,owner:()=> 'isolated-author',validateCommand:()=>{throw new Error('请通过剧本对话入口开始验收');}});
 registerAgentContextRoutes(app,{contexts:host.contexts,owner:()=> 'isolated-author',authorizeScope});
 const tick=async()=>{try{await host.worker.runOnce();await host.childWorker.runOnce();await host.memory.runOnce(new AbortController().signal);}catch(error){console.error(error);}finally{if(!stopped)workerTimer=setTimeout(tick,75);}};
 workerTimer=setTimeout(tick,75);
}else app.get('/api/script-assistant/features',(_req,res)=>res.json({durableChat:false}));
app.use('/api',(_req,res)=>res.status(503).json({error:'验收环境不连接外部服务，请使用手动返回。'}));
const vite=await createServer({define:{__SCRIPT_IDEATION_ACCEPTANCE__:JSON.stringify(process.env.SCRIPT_BROWSER_IDEATION==='1')},configFile:'apps/web/vite.config.ts',server:{middlewareMode:true,hmr:false},appType:'custom'});
app.get(['/writing','/writing/library'],async(req,res)=>res.type('html').send(await vite.transformIndexHtml(req.originalUrl,`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>剧本独立验收</title></head><body><div id="root"></div><script type="module" src="/@fs/${resolve('tests/fixtures/script-browser.tsx')}"></script></body></html>`)));
app.use(vite.middlewares);
const server=app.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/writing`,databasePath})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopped=true;if(workerTimer)clearTimeout(workerTimer);server.close();void vite.close();db.close();process.exit(0);});
