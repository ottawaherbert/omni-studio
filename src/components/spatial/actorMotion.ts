import * as THREE from 'three';
import type { PrevisPlan, PrevisObject, PrevisFrame } from '../../clients/previsClient';
import type { ActorMotion } from './actorRig';

/** Travel-based gait: stopping the authored path also stops the feet; no accumulated render state. */
export function actorMotion(plan: PrevisPlan | undefined, object: PrevisObject, frame?: PrevisFrame): ActorMotion & { pose?: PrevisObject['pose'] } {
  if (!plan || !frame) return {};
  const keys = plan.frames.filter(k => k.shotId === frame.shotId).sort((a, b) => a.timeInShot - b.timeInShot);
  if (!keys.length) return {};
  let distance = 0, direction = new THREE.Vector3(0, 0, 1);
  const shotIds=[...new Set(plan.frames.map(k=>k.shotId))],currentIndex=shotIds.indexOf(frame.shotId);
  for(let i=0;i<currentIndex;i++){
    const previous=plan.frames.filter(k=>k.shotId===shotIds[i]).sort((a,b)=>a.timeInShot-b.timeInShot);
    const next=plan.frames.filter(k=>k.shotId===shotIds[i+1]).sort((a,b)=>a.timeInShot-b.timeInShot);
    const last=previous.at(-1)!,first=next[0];
    const a=last.states[object.id],b=first.states[object.id];
    if(!['walk','run'].includes(a?.pose||object.pose)||!['walk','run'].includes(b?.pose||object.pose)||new THREE.Vector3(...(a?.position||object.position)).distanceTo(new THREE.Vector3(...(b?.position||object.position)))>.001){distance=0;continue;}
    for(let j=1;j<previous.length;j++){const x=previous[j-1].states[object.id]?.position||object.position,y=previous[j].states[object.id]?.position||object.position;distance+=Math.hypot(x[0]-y[0],x[2]-y[2]);}
  }
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i]; if (frame.timeInShot <= a.timeInShot) break;
    const from = new THREE.Vector3(...(a.states[object.id]?.position || object.position));
    const to = new THREE.Vector3(...(b.states[object.id]?.position || object.position));
    const delta = to.sub(from); delta.y = 0;
    const fraction = Math.min(1, (frame.timeInShot - a.timeInShot) / (b.timeInShot - a.timeInShot));
    distance += delta.length() * fraction;
    if (delta.lengthSq() > 1e-8) direction.copy(delta).normalize();
    if (fraction < 1) break;
  }
  direction.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(frame.states[object.id]?.rotation || object.rotation))).invert());
  const right = keys.findIndex(k => k.timeInShot > frame.timeInShot);
  const a = right > 0 ? keys[right - 1] : undefined, b = right > 0 ? keys[right] : undefined;
  const from = a?.states[object.id]?.pose || object.pose, to = b?.states[object.id]?.pose || object.pose;
  return { distance, direction, ...(a && b && from !== to ? { pose: to, transition: { from, mix: (frame.timeInShot - a.timeInShot) / (b.timeInShot - a.timeInShot) } } : {}) };
}
