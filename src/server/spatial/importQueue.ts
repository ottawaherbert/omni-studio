import { Worker } from 'node:worker_threads';
import type { SpatialModel } from '../../../packages/domain/src/spatial';
let previous:Promise<unknown>=Promise.resolve();
/** CPU-heavy topology optimization runs off the API thread, one job at a time. */
export function queueModelImport(root:string,bytes:Uint8Array,name:string,license:string):Promise<SpatialModel>{
  const run=()=>new Promise<SpatialModel>((resolve,reject)=>{
    const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(`import {tsImport} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; await tsImport(${JSON.stringify(new URL('./modelWorker.ts',import.meta.url).href)},${JSON.stringify(import.meta.url)});`)),{execArgv:[]});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('模型优化超过 5 分钟，请拆分大模型后重试。原文件未改动。'));},300000);
    const done=()=>{clearTimeout(timer);void worker.terminate();};
    worker.once('message',r=>{done();r.error?reject(new Error(r.error)):resolve(r.model);});worker.once('error',e=>{done();reject(e);});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('模型处理进程中断，请重试。'));});
    worker.postMessage({root,bytes,name,license});
  });
  const result=previous.then(run,run);previous=result.catch(()=>{});return result;
}
