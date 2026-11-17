import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
/** Derived only from this runtime's current immutable world. Never persisted across edits. */
export function mergeSpatialCluster(parts:Array<{geometry:THREE.BufferGeometry;matrix:THREE.Matrix4;id:string}>,material:THREE.Material){
 const ranges:Array<{end:number;id:string}>=[];let faces=0;
 const geometries=parts.map(({geometry,matrix,id})=>{
  const out=new THREE.BufferGeometry(),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),colour=geometry.getAttribute('color');
  for(const [name,a,fallback]of [['position',position,[0,0,0]],['normal',normal,[0,1,0]],['color',colour,[1,1,1]]] as const){
   const values=new Float32Array(position.count*3);for(let i=0;i<position.count;i++){values[i*3]=a?a.getX(i):fallback[0];values[i*3+1]=a?a.getY(i):fallback[1];values[i*3+2]=a?a.getZ(i):fallback[2];}out.setAttribute(name,new THREE.BufferAttribute(values,3));
  }
  out.setIndex(geometry.index?Array.from(geometry.index.array):Array.from({length:position.count},(_,i)=>i));out.applyMatrix4(matrix);
  faces+=out.index!.count/3;ranges.push({end:faces,id});return out;
 });
 const merged=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());if(!merged)throw new Error('远景分区合并失败');
 const mesh=new THREE.Mesh(merged,material);mesh.userData.spatialShared=true;mesh.userData.spatialRanges=ranges;mesh.receiveShadow=true;mesh.castShadow=false;return mesh;
}
export function geometryBytes(g:THREE.BufferGeometry){return Object.values(g.attributes).reduce((n,a)=>n+('array'in a?a.array.byteLength:0),g.index?.array.byteLength||0);}
