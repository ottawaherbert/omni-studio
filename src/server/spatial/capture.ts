import { chromium, type Browser } from 'playwright-core';
import fs from 'node:fs';
import { readPrevisVideo, PrevisVideoService } from '../previsVideo';
import { PREVIS_RENDER_VERSION } from '../../../packages/domain/src/previs';
const pending=new Map<string,()=>Promise<void>>();
let active:string|undefined;
const paused=new Set<string>();
const states=new Map<string,{status:string;error?:string}>();
async function drain(){if(active)return;const first=pending.entries().next().value;if(!first)return;const [id,work]=first;pending.delete(id);active=id;try{await work();}finally{active=undefined;void drain();}}
export function enqueueSpatialCapture(id:string,work:()=>Promise<void>){
 if(active===id||pending.has(id))return;states.set(id,{status:'queued'});pending.set(id,async()=>{states.set(id,{status:'rendering'});try{await work();states.set(id,{status:'complete'});}catch(e){states.set(id,{status:'failed',error:(e as Error).message});}});void drain();
}
export async function runSpatialBrowser(port:number,handler:(action:string,payload:any)=>Promise<unknown>){
 const executable=[process.env.OMNI_CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));if(!executable)throw new Error('后台预览需要本机 Chrome/Chromium。');
 const browser=await chromium.launch({executablePath:executable,headless:true,args:['--use-angle=metal']});let timer:ReturnType<typeof setTimeout>|undefined;
 try{const page=await browser.newPage({viewport:{width:1280,height:720}});let resolve!:()=>void,reject!:(e:Error)=>void;const done=new Promise<void>((r,j)=>{resolve=r;reject=j;});
 await page.exposeFunction('omniSpatialCapture',async(action:string,payload:any)=>{try{if(action==='error')throw new Error(String(payload?.message||'预览失败'));const result=await handler(action,payload);if(action==='finish')resolve();return result;}catch(e){reject(e as Error);throw e;}});page.on('crash',()=>reject(new Error('预览浏览器中断')));timer=setTimeout(()=>reject(new Error('预览超过10分钟，请检查场景资源。')),600000);await Promise.all([page.goto(`http://127.0.0.1:${port}/production/world?renderWorker=1`),done]);
 }finally{clearTimeout(timer);await browser.close();}
}
export function captureStatus(id:string){const state=states.get(id);if(state)return state;try{const video=readPrevisVideo(id);return {status:video.status==='rendering'||video.status==='encoding'?'paused':video.status,error:video.error};}catch{return {status:'idle'};}}
export function pauseCapture(id:string){if(pending.has(id)){pending.delete(id);states.set(id,{status:'paused'});}else if(active===id){paused.add(id);states.set(id,{status:'pausing'});}return captureStatus(id);}
export function startCapture(id:string,root:string,port:number){
  if(active===id||pending.has(id))return captureStatus(id);
  paused.delete(id);const video=readPrevisVideo(id);if(video.status==='complete')return {status:'complete'};if(video.status==='cancelled')throw new Error('任务已取消，请新建拍摄任务。');
  if(video.timeline.renderVersion!==PREVIS_RENDER_VERSION)throw new Error('该任务属于旧渲染版本，请新建预演任务；原视频和已拍帧保留。');
  const executable=[process.env.OMNI_CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
  if(!executable)throw new Error('后台拍摄需要本机 Chrome/Chromium。可设置 OMNI_CHROME_PATH，或使用前台拍摄。');
  states.set(id,{status:'queued'});
  pending.set(id,async()=>{let browser:Browser|undefined;const service=new PrevisVideoService(root);try{
    if(readPrevisVideo(id).status==='cancelled'){states.set(id,{status:'cancelled'});return;}
    states.set(id,{status:'rendering'});browser=await chromium.launch({executablePath:executable,headless:true,args:['--use-angle=metal']});
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    let resolve!:()=>void,reject!:(error:Error)=>void;const done=new Promise<void>((r,j)=>{resolve=r;reject=j;});
    // Callbacks are scoped to this server-created page; payloads never choose project or job IDs.
    await page.exposeFunction('omniSpatialCapture',async(action:string,payload:any)=>{
      if(action==='init')return readPrevisVideo(id);
      if(action==='frames'){const result=await service.frames(id,payload.start,payload.images);if(paused.has(id)){resolve();return {...result,capturePaused:true};}return result;}
      if(action==='finish'){await service.finish(id);resolve();return;}
      if(action==='error'){reject(new Error(String(payload?.message||'拍摄失败')));return;}
      throw new Error('未知拍摄动作');
    });
    page.on('crash',()=>reject(new Error('拍摄浏览器中断，可从已保存帧继续。')));
    const timer=setTimeout(()=>reject(new Error('后台拍摄超过 2 小时，可从已保存帧继续。')),2*60*60*1000);
    try{await Promise.all([page.goto(`http://127.0.0.1:${port}/production/world?renderWorker=1`),done]);}finally{clearTimeout(timer);}
    states.set(id,{status:paused.has(id)?'paused':'complete'});
  }catch(e){states.set(id,{status:readPrevisVideo(id).status==='cancelled'?'cancelled':'failed',error:(e as Error).message});}finally{await browser?.close();}});
  void drain();return captureStatus(id);
}
