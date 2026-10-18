import express from 'express';
import { readFileSync, appendFileSync } from 'node:fs';
const filename=process.env.OMNI_DB_PATH,skills=process.env.OMNI_SKILLS_DIR,log=process.env.AGENT_ACCEPTANCE_SEND_LOG;
if(!filename?.startsWith('/tmp/')||!skills?.startsWith('/tmp/')||!log?.startsWith('/tmp/'))throw new Error('Production composition acceptance requires explicit isolated paths');
const raw=readFileSync(new URL('./fixtures/agent-sol-chat-first-result.json',import.meta.url),'utf8');
// Only the provider's HTTP boundary is replaced. Production singleton, target
// policy, config resolution, transport, journal, registry, routes and worker run.
globalThis.fetch=async(input,init)=>{
 const target=String(input);
 if(target!=='http://127.0.0.1:18889/v1/chat/completions')throw new Error('Acceptance refuses every external service');
 const body=JSON.parse(String(init?.body));
 appendFileSync(log,JSON.stringify({url:target,model:body.model,prompt:body.messages,redirect:init?.redirect,purpose:body.messages.some((message:any)=>String(message.content).startsWith('你是受控记忆提取器'))?'memory':'chat'})+'\n');
 return new Response(JSON.stringify({id:'sol-saved-fixture-replay',choices:[{message:{content:raw}}],usage:{prompt_tokens:100,completion_tokens:80}}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {dbHelpers,db}=await import('../src/server/db');
if(!dbHelpers.getAIConfig().hasSavedConfig)dbHelpers.saveAIConfig({channels:[{id:'local-acceptance',name:'隔离模拟响应',type:'llamacpp',baseUrl:'http://127.0.0.1:18889/v1',apiKey:''}],models:[{id:'saved-sol-replay',channelId:'local-acceptance',alias:'GPT-6 Sol 保存回复回放',modelId:'sol-fixture-replay',capabilities:['text']}],routing:{...dbHelpers.getAIConfig().config.routing,scriptGen:'saved-sol-replay'}});
const {scriptRuntime,scriptRepository}=await import('../apps/api/src/repositories/scriptRepository');
const {registerScriptRoutes}=await import('../apps/api/src/routes/scriptRoutes');
const {registerAiConfigRoutes}=await import('../src/server/routes/aiConfigRoutes');
const app=express();app.use(express.json());scriptRuntime.register(app);registerScriptRoutes(app,scriptRepository);registerAiConfigRoutes(app,{getProviderKeyStatus:()=>({})});
const server=app.listen(0,'127.0.0.1',()=>{process.send?.({ready:true,port:(server.address() as any).port,sameRepository:scriptRuntime.scripts===scriptRepository});if(process.env.AGENT_ACCEPTANCE_AUTOSTART!=='0')scriptRuntime.start();});
process.on('message',message=>{if((message as any)?.action==='start-worker')scriptRuntime.start();});
for(const event of ['SIGINT','SIGTERM'] as const)process.on(event,()=>{void scriptRuntime.stop().finally(()=>server.close(()=>{db.close();process.exit(0);}));});
