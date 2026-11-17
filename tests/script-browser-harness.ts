import {scriptChatSkills as skills} from './fixtures/script-chat-skills';
import express from 'express';
import Database from 'better-sqlite3';
import {createServer} from 'vite';
import {resolve} from 'node:path';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {selectSharedMethods} from '../packages/script/src/methods';
import {registerScriptRoutes} from '../apps/api/src/routes/scriptRoutes';
const app=express();app.use(express.json({limit:'4mb'}));
const databasePath=process.env.SCRIPT_BROWSER_DB||'/tmp/script-acceptance-20260925.sqlite';
const port=Number(process.env.SCRIPT_BROWSER_PORT)||3011;
if (!databasePath.startsWith('/tmp/')) throw new Error('Browser acceptance requires an isolated /tmp database');
const db=new Database(databasePath);
const repo=createScriptRepository(db);repo.ensureSchema();
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
app.use('/api',(_req,res)=>res.status(503).json({error:'验收环境不连接外部服务，请使用手动返回。'}));
const vite=await createServer({configFile:'apps/web/vite.config.ts',server:{middlewareMode:true,hmr:false},appType:'custom'});
app.get(['/writing','/writing/library'],async(req,res)=>res.type('html').send(await vite.transformIndexHtml(req.originalUrl,`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>剧本独立验收</title></head><body><div id="root"></div><script type="module" src="/@fs/${resolve('tests/fixtures/script-browser.tsx')}"></script></body></html>`)));
app.use(vite.middlewares);
const server=app.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/writing`,databasePath})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{server.close();void vite.close();db.close();process.exit(0);});
