import { parentPort } from 'node:worker_threads';
import { importSpatialModel } from './models';
parentPort!.once('message',async({root,bytes,name,license})=>{try{parentPort!.postMessage({model:await importSpatialModel(root,new Uint8Array(bytes),name,license)});}catch(e){parentPort!.postMessage({error:(e as Error).message});}});
