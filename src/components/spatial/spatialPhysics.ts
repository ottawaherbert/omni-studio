import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ActorSupport } from './actorRig';
import type { PrevisContactIssue } from '../../clients/previsClient';

export interface ContactPart {
  objectId: string; label: string; part: string; geometry: THREE.BufferGeometry; matrix: THREE.Matrix4;
  bounds: THREE.Box3; actor?: boolean; ground?: boolean;
}
type Acceleration = { geometry: THREE.BufferGeometry; tree: MeshBVH; closed: boolean };
const geometryCache = new WeakMap<THREE.BufferGeometry, Acceleration>();
const down = new THREE.Vector3(0, -1, 0);
const tolerance = .001;
function acceleration(source: THREE.BufferGeometry): Acceleration {
  const old = geometryCache.get(source); if (old) return old;
  // Decode normalized quantized GLB attributes, without changing shared render geometry or its index.
  const geometry = new THREE.BufferGeometry(), p = source.getAttribute('position'), values = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { values[i * 3] = p.getX(i); values[i * 3 + 1] = p.getY(i); values[i * 3 + 2] = p.getZ(i); }
  geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
  geometry.setIndex(source.index ? Array.from(source.index.array) : Array.from({ length: p.count }, (_, i) => i));
  const edges = new Map<string, number>(), index = geometry.index!;
  const vertex = (i: number) => [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]].map(n => Math.round(n * 100000)).join(',');
  for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = vertex(index.getX(i + j)), b = vertex(index.getX(i + (j + 1) % 3)); if (a === b) continue;
    const edge = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(edge, (edges.get(edge) || 0) + 1);
  }
  const result = { geometry, tree: new MeshBVH(geometry, { maxLeafTris: 12 }), closed: edges.size > 0 && [...edges.values()].every(n => n % 2 === 0) };
  geometryCache.set(source, result); return result;
}
export function contactPart(objectId: string, label: string, name: string, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, actor = false, ground = false): ContactPart {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return { objectId, label, part: name, geometry, matrix, actor, ground, bounds: geometry.boundingBox!.clone().applyMatrix4(matrix) };
}
function hits(part: ContactPart, origin: THREE.Vector3, direction: THREE.Vector3) {
  const inverse = part.matrix.clone().invert(), ray = new THREE.Ray(origin.clone(), direction.clone()).applyMatrix4(inverse);
  return acceleration(part.geometry).tree.raycast(ray, THREE.DoubleSide).map(hit => {
    const point = hit.point.clone().applyMatrix4(part.matrix);
    const normal = hit.face?.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(part.matrix)) || new THREE.Vector3(0, 1, 0);
    return { point, normal, distance: point.distanceTo(origin) };
  }).sort((a, b) => a.distance - b.distance);
}
export function surfaceAt(parts: ContactPart[], point: THREE.Vector3, referenceY: number, range: number, ignore: string[] = [], ceiling = referenceY + range): ActorSupport | undefined {
  let best: ActorSupport | undefined;
  const origin = new THREE.Vector3(point.x, referenceY + range + .001, point.z);
  for (const part of parts) {
    if (part.actor || ignore.includes(part.objectId) || point.x < part.bounds.min.x - .001 || point.x > part.bounds.max.x + .001 || point.z < part.bounds.min.z - .001 || point.z > part.bounds.max.z + .001 || part.bounds.max.y < referenceY - range || part.bounds.min.y > referenceY + range) continue;
    for (const hit of hits(part, origin, down)) {
      if (hit.normal.y < .35 || hit.point.y > ceiling || Math.abs(hit.point.y - referenceY) > range + .002) continue;
      if (!best || hit.point.y > best.height) best = { height: hit.point.y, normal: hit.normal, objectId: part.objectId };
      break;
    }
  }
  return best;
}
function inside(point: THREE.Vector3, part: ContactPart) {
  if (!part.bounds.containsPoint(point) || !acceleration(part.geometry).closed) return false;
  const local = point.clone().applyMatrix4(part.matrix.clone().invert()), a = acceleration(part.geometry);
  const closest = a.tree.closestPointToPoint(local); if (!closest || closest.distance < tolerance / new THREE.Vector3().setFromMatrixScale(part.matrix).length()) return false;
  return [new THREE.Vector3(.923, .271, .273).normalize(), new THREE.Vector3(.213, .957, .197).normalize()].every(direction => {
    const distances = a.tree.raycast(new THREE.Ray(local, direction), THREE.DoubleSide).map(h => h.distance).sort((x, y) => x - y);
    return distances.filter((d, i) => !i || d - distances[i - 1] > 1e-5).length % 2 === 1;
  });
}
function samples(part: ContactPart, matrix = part.matrix) {
  const p = part.geometry.getAttribute('position'), result: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 12))) result.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix));
  return result;
}
/** Broad-phase boxes only prune; the decision uses triangles and closed-volume containment. */
function penetrating(a: ContactPart, b: ContactPart) {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  const box = a.geometry.boundingBox!, centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const scales = new THREE.Vector3().setFromMatrixScale(a.matrix);
  const shrink = new THREE.Vector3(...[0, 1, 2].map(i => Math.max(.8, 1 - tolerance * 2 / Math.max(size.getComponent(i) * Math.abs(scales.getComponent(i)), .0001))) as [number, number, number]);
  const matrix = a.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(...centre.toArray())).multiply(new THREE.Matrix4().makeScale(...shrink.toArray())).multiply(new THREE.Matrix4().makeTranslation(...centre.clone().negate().toArray()));
  const relative = b.matrix.clone().invert().multiply(matrix);
  if (acceleration(b.geometry).tree.intersectsGeometry(acceleration(a.geometry).geometry, relative)) return true;
  return samples(a, matrix).some(p => inside(p, b)) || samples(b).some(p => inside(p, { ...a, matrix }));
}
export interface ContactInspectionOptions { objectIds?: string[]; heldBy?: Map<string, { objectId: string; socket: string }> }
export function inspectContacts(parts: ContactPart[], options: ContactInspectionOptions = {}): PrevisContactIssue[] {
  const ids = options.objectIds && new Set(options.objectIds), selected = parts.filter(p => !p.ground && (!ids || ids.has(p.objectId)));
  const issues: PrevisContactIssue[] = [], seen = new Set<string>();
  for (const a of selected) for (const ground of parts.filter(p => p.ground)) {
    if (a.bounds.min.y >= ground.bounds.max.y - tolerance || a.bounds.max.x < ground.bounds.min.x || a.bounds.min.x > ground.bounds.max.x || a.bounds.max.z < ground.bounds.min.z || a.bounds.min.z > ground.bounds.max.z) continue;
    const attribute = a.geometry.getAttribute('position'); let point: THREE.Vector3 | undefined;
    for (let i = 0; i < attribute.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(a.matrix);
      if (p.y < ground.bounds.max.y - tolerance && p.x >= ground.bounds.min.x && p.x <= ground.bounds.max.x && p.z >= ground.bounds.min.z && p.z <= ground.bounds.max.z) { point = p; break; }
    }
    if (point) issues.push({ kind:'penetration',severity: !a.actor&&!ids?'review':'error',objectId:a.objectId,otherId:ground.objectId,part:a.part,message:`${a.label}（${a.part}）穿入地面`,point:point.toArray() as [number,number,number],distance:ground.bounds.max.y-point.y });
  }
  for (const a of selected) for (const b of parts) {
    if (b.ground) continue;
    if (a.objectId === b.objectId) {
      if (!a.actor || !b.actor || a.part === b.part) continue;
      const limbs = ['hand','forearm'], bodies = ['head','torso','pelvis'];
      const ap=a.part.split(':')[0],bp=b.part.split(':')[0];
      if (!(limbs.includes(ap)&&bodies.includes(bp)||limbs.includes(bp)&&bodies.includes(ap)||ap==='hand'&&bp==='hand')) continue;
    }
    const held = options.heldBy?.get(a.objectId);
    if (held?.objectId === b.objectId && b.part === `hand:${held.socket === 'leftHand' ? 'left' : held.socket === 'rightHand' ? 'right' : 'waist'}`) continue;
    const reverse = options.heldBy?.get(b.objectId);
    if (reverse?.objectId === a.objectId && a.part === `hand:${reverse.socket === 'leftHand' ? 'left' : reverse.socket === 'rightHand' ? 'right' : 'waist'}`) continue;
    const key = [a.objectId, a.part, b.objectId, b.part].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    if (!penetrating(a, b)) continue;
    const construction = !a.actor && !b.actor && !ids;
    issues.push({ kind: 'penetration', severity: construction ? 'review' : 'error', objectId: a.objectId, otherId: b.objectId, part: a.part,
      message: `${a.label}（${a.part}）与${b.label}（${b.part}）几何相交`, point: a.bounds.clone().intersect(b.bounds).getCenter(new THREE.Vector3()).toArray() as [number, number, number] });
  }
  return issues;
}
export function solePoints(part: ContactPart) {
  const box = part.geometry.boundingBox!, y = box.min.y;
  return [[box.min.x, y, box.min.z], [box.min.x, y, box.max.z], [box.max.x, y, box.min.z], [box.max.x, y, box.max.z], [0, y, 0]].map(p => new THREE.Vector3(...p).applyMatrix4(part.matrix));
}
export const contactTolerance = tolerance;
