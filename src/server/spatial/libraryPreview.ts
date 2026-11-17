import type { StudioRevision } from '../../../packages/domain/src/spatial';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readStudio } from './catalog';
import { enqueueSpatialCapture, runSpatialBrowser, captureStatus } from './capture';
const key=(id:string,revision:number)=>`studio-${id}-v${revision}`;
export async function readLibraryPreview(root:string,id:string,revision?:number){const studio=readStudio(id,revision);return readSnapshotPreview(root,studio);}
export async function readSnapshotPreview(root:string,studio:Pick<StudioRevision,'id'|'revision'>){const job=key(studio.id,studio.revision);try{return {...JSON.parse(await fs.readFile(path.join(root,'spatial','previews',job,'index.json'),'utf8')),status:'complete'};}catch(e:any){if(e.code!=='ENOENT')throw e;return {status:captureStatus(job).status,images:[],error:captureStatus(job).error};}}
export async function startLibraryPreview(root:string,id:string,revision:number|undefined,port:number){
 return startSnapshotPreview(root,readStudio(id,revision),port);
}
export async function startSnapshotPreview(root:string,studio:Pick<StudioRevision,'id'|'revision'|'plan'>,port:number){
 const {id}=studio;if(!studio.plan.viewpoints?.length)throw new Error('先在影视城方案中保存检查机位 viewpoints，再拍摄预览。');
 const prior=await readSnapshotPreview(root,studio);if(prior.status==='complete')return prior;
 const job=key(id,studio.revision),folder=path.join(root,'spatial','previews',job);
 enqueueSpatialCapture(job,async()=>{const images:Array<{id:string;name:string;locationId:string;url:string;note:string}>=[];await fs.mkdir(folder,{recursive:true});await runSpatialBrowser(port,async(action,payload)=>{
  if(action==='init')return {kind:'studio-preview',studio};
  if(action==='preview'){
   const view=studio.plan.viewpoints![images.length];if(!view||payload.id!==view.id||typeof payload.image!=='string'||!payload.image.startsWith('data:image/png;base64,')||payload.image.length>16*1048576)throw new Error('机位预览顺序或图片无效。');
   const bytes=Buffer.from(payload.image.slice('data:image/png;base64,'.length),'base64'),file=`view-${images.length+1}.png`;await sharp(bytes,{limitInputPixels:1920*1080}).png().toFile(path.join(folder,file));images.push({id:view.id,name:view.name,locationId:view.locationId,note:view.note,url:`/media/spatial/previews/${job}/${file}`});return;
  }
  if(action==='finish'){if(images.length!==studio.plan.viewpoints!.length)throw new Error('机位尚未全部拍摄。');const data={studioId:id,revision:studio.revision,createdAt:Date.now(),images};await fs.writeFile(path.join(folder,'index.tmp'),JSON.stringify(data));await fs.rename(path.join(folder,'index.tmp'),path.join(folder,'index.json'));return;}
  throw new Error('未知影视城预览操作');
 });});return readSnapshotPreview(root,studio);
}
