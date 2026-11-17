/** Content-authoring example. Writes only this example directory; no project DB or application edits. */
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, flatten, join, weld } from '@gltf-transform/functions';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const palette = ['#bcc0bd', '#89938f', '#59635f', '#d1cec3'];
function makeSet(detailed: boolean) {
  const group = new THREE.Group(), materials = palette.map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  const mesh = (geometry: THREE.BufferGeometry, position: number[], shade = 0, rotation = [0, 0, 0]) => {
    const m = new THREE.Mesh(geometry, materials[shade]); m.position.set(...position as [number, number, number]); m.rotation.set(...rotation as [number, number, number]); group.add(m); return m;
  };
  const box = (s: number[], p: number[], c = 0) => mesh(new THREE.BoxGeometry(...s as [number, number, number]), p, c);
  const bar = (a: number[], b: number[], r = .025, c = 2) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), d = end.clone().sub(start);
    const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), start.clone().add(end).multiplyScalar(.5).toArray(), c);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
  };
  box([60, .15, 40], [0, -.075, 5], 1);
  box([60, .04, 8], [0, .01, 11], 2);
  for (const z of [5, 17]) box([60, .18, 3.5], [0, .09, z], 3);
  // Main workshop: real door and windows, not a textured closed facade.
  box([8, 3.4, .2], [0, 1.7, -3]); box([.2, 3.4, 6], [-4, 1.7, 0]); box([.2, 3.4, 6], [4, 1.7, 0]);
  box([8.2, .2, 6.2], [0, 3.5, 0]); box([8, .5, .2], [0, 3.15, 3]);
  for (const x of [-3.9, -.5, 2, 3.9]) box([.18, 2.9, .2], [x, 1.45, 3]);
  for (const [x, w] of [[-2.2, 3.2], [3, 1.8]]) {
    box([w, .7, .2], [x, .35, 3]); box([w, .07, .32], [x, .75, 3], 2);
    for (const px of [x - w / 2, x, x + w / 2]) box([.045, 2.2, .06], [px, 1.8, 3], 2);
  }
  // Work surface 0.95m high; 0.72m stool; operation zone kept clear.
  box([3.2, .09, 1], [-1, .905, -1.8], 1);
  for (const x of [-2.4, .4]) for (const z of [-2.15, -1.45]) box([.08, .86, .08], [x, .43, z], 2);
  box([3, .07, .8], [-1, .25, -1.8], 1);
  box([.5, .06, .5], [-1, .69, -.8], 1);
  for (const x of [-1.2, -.8]) for (const z of [-1, -.6]) box([.05, .66, .05], [x, .33, z], 2);
  box([3.3, 1.15, .08], [-1, 1.75, -2.83], 1);
  for (const y of [.3, .9, 1.5, 2.1]) box([1, .06, 1.8], [3.25, y, -1.6], 1);
  for (const x of [2.8, 3.7]) for (const z of [-2.4, -.8]) box([.05, 2.5, .05], [x, 1.25, z], 2);
  if (detailed) {
    // Clearly separated screwdriver handles/blades, open-jaw spanners and pliers.
    for (let i = 0; i < 5; i++) {
      const x = -2.4 + i * .27;
      bar([x, 1.48, -2.72], [x, 1.77, -2.72], .045, 2);
      bar([x, 1.77, -2.72], [x, 2.1, -2.72], .012, 3);
    }
    for (let i = 0; i < 3; i++) {
      const x = -.8 + i * .3;
      bar([x, 1.5, -2.72], [x, 1.98, -2.72], .024, 3);
      mesh(new THREE.TorusGeometry(.065, .018, 6, 16, Math.PI * 1.6), [x, 2.04, -2.72], 3, [0, 0, Math.PI * .7]);
    }
    bar([-.45, .975, -1.7], [-.1, .975, -1.5], .025); bar([-.45, .975, -1.5], [-.1, .975, -1.7], .025);
    mesh(new THREE.CylinderGeometry(.035, .035, .035, 12), [-.27, .975, -1.6], 3);
    for (const z of [-2.1, -1.75, -1.4]) for (const y of [.47, 1.07, 1.67]) {
      box([.7, .25, .28], [3.25, y, z], 0); box([.25, .05, .012], [3.25, y + .02, z + .15], 2);
    }
    // Bench vice with open jaws, drawer storage, cable reel and articulated task light.
    box([.23, .07, .2], [.2, .985, -1.65], 2); box([.18, .14, .12], [.2, 1.06, -1.65], 1);
    for (const x of [.08, .32]) box([.05, .08, .22], [x, 1.16, -1.65], 3);
    bar([.1, 1.06, -1.48], [.1, 1.06, -1.28], .012); bar([.1, 1, -1.28], [.1, 1.13, -1.28], .012);
    box([.85, .7, .68], [-2, .55, -1.8], 1);
    for (const y of [.32, .53, .74]) { box([.79, .18, .03], [-2, y, -1.44], 0); bar([-2.15, y, -1.4], [-1.85, y, -1.4], .014, 2); }
    for (let i = 0; i < 5; i++) mesh(new THREE.TorusGeometry(.15, .012, 6, 20), [-.5, .447, -1.7 + i * .025], 2);
    mesh(new THREE.CylinderGeometry(.13, .13, .025, 16), [-2.25, .9625, -2], 2);
    bar([-2.25, .98, -2], [-2.25, 1.45, -2], .018); bar([-2.25, 1.45, -2], [-1.95, 1.65, -1.85], .018);
    mesh(new THREE.CylinderGeometry(.045, .14, .12, 16, 1, true), [-1.94, 1.59, -1.85], 3);
    for (const z of [-2.1, -1.4]) { box([.55, .04, .4], [1.1, .02, z], 1); for (const x of [.84, 1.36]) box([.025, .3, .4], [x, .19, z], 0); for (const dz of [-.19, .19]) box([.55, .3, .025], [1.1, .19, z + dz], 0); }
    // Lamp casing/shade, base switch and physical carry handle; no texturing required.
    mesh(new THREE.CylinderGeometry(.12, .12, .26, 20), [-1.35, 1.12, -1.7], 3);
    for (const y of [.9775, 1.27]) mesh(new THREE.CylinderGeometry(.14, .14, .055, 20), [-1.35, y, -1.7], 2);
    mesh(new THREE.TorusGeometry(.16, .012, 6, 20, Math.PI), [-1.35, 1.28, -1.7], 2);
    box([.045, .035, .015], [-1.35, .98, -1.555], 0);
    for (const x of [-1.75, -1.69]) mesh(new THREE.CylinderGeometry(.014, .014, .05, 10), [x, .975, -1.65], 2);
    // Bicycle: joined frame, hubs/spokes, handlebar, saddle and pedals.
    const bicycleStart = group.children.length;
    const wheels: THREE.Mesh[] = [];
    const ox = -4.9, z = 4.3;
    for (const x of [ox, ox + 1.12]) {
      wheels.push(mesh(new THREE.TorusGeometry(.32, .025, 6, 32), [x, .34, z], 2));
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; bar([x, .34, z], [x + Math.cos(a) * .3, .34 + Math.sin(a) * .3, z], .003, 3); }
    }
    const a = [ox, .34, z], b = [ox + .48, .32, z], c = [ox + .38, .85, z], d = [ox + .92, .87, z], e = [ox + 1.12, .34, z];
    for (const [u, v] of [[a, b], [a, c], [b, c], [c, d], [b, d], [d, e]]) bar(u, v, .02);
    box([.25, .045, .13], [c[0], .91, z], 2); bar(d, [d[0], 1.08, z], .02); bar([d[0], 1.08, z - .18], [d[0], 1.08, z + .18], .02);
    bar([b[0], b[1], z - .18], [b[0], b[1], z + .18], .015); box([.1, .03, .08], [b[0], b[1], z + .19], 2);
    // Contact uses actual geometry, including tyre tube radius, and the raised
    // pavement top. Zero world Y is not the road surface.
    const bicycle = new THREE.Group();
    for (const part of group.children.slice(bicycleStart)) bicycle.add(part);
    group.add(bicycle);
    bicycle.position.y += .18 - new THREE.Box3().setFromObject(bicycle).min.y;
    bicycle.updateMatrixWorld(true);
    for (const wheel of wheels) {
      const actualBottom = new THREE.Box3().setFromObject(wheel).min.y;
      if (Math.abs(actualBottom - .18) > 1e-6) throw new Error('Bicycle tyre/pavement contact failed');
    }
  } else {
    for (let i = 0; i < 5; i++) box([.25, .1, .18], [-2.3 + i * .4, 1, -1.8], 1);
    box([1.4, 1, .2], [-4.4, .5, 4.3], 1);
  }
  // Connected local frontage and opposite side; intentionally a set study, not a whole city.
  for (const [x, z, w, floors] of [[-11, 0, 12, 2], [11, 0, 12, 3], [-20, 22, 10, 2], [-8, 23, 10, 3], [6, 24, 12, 2], [20, 24, 12, 4]]) {
    const front = z > 10 ? z - 5 : z + 3;
    box([w, floors * 3, 8], [x, floors * 1.5, z > 10 ? z + .5 : z - 1.5], floors % 3);
    for (let f = 0; f < floors; f++) for (let bay = -w / 2 + 1; bay < w / 2; bay += 2.4) {
      box([1.3, 1.5, .12], [x + bay, f * 3 + 1.7, front - (z > 10 ? .1 : -.1)], 2);
      if (detailed && f === 0) box([2.1, .09, 1.1], [x + bay, 2.6, front + (z > 10 ? -.4 : .4)], 1);
    }
    if (detailed) { box([w, .15, .7], [x, .12, front], 3); box([1.1, .55, .45], [x + w / 2 - 1, .35, front + (z > 10 ? -.8 : .8)], 1); }
  }
  if (detailed) {
    for (const x of [-18, 16]) { bar([x, .1, 5], [x, 2.8, 5], .1, 2); mesh(new THREE.IcosahedronGeometry(1.05, 1), [x, 3.1, 5], 1); }
    for (let i = 0; i < 6; i++) box([1.5, .02, .45], [7, .04, 8 + i * 1.1], 3);
    box([1.5, .08, .4], [9, .78, 4.2], 1); for (const x of [8.4, 9.6]) box([.07, .6, .3], [x, .48, 4.2], 2);
  }
  return group;
}

async function exportModel(detailed: boolean) {
  const root = makeSet(detailed), bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  const anchor = bounds.getCenter(new THREE.Vector3()); anchor.y = bounds.min.y;
  root.position.sub(anchor); root.updateMatrixWorld(true);
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('local-set-study');
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const g = object.geometry.clone().applyMatrix4(object.matrixWorld), primitive = doc.createPrimitive();
    for (const [attribute, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL']]) primitive.setAttribute(semantic, doc.createAccessor('', buffer).setType('VEC3').setArray(new Float32Array(g.getAttribute(attribute).array)));
    if (g.index) primitive.setIndices(doc.createAccessor('', buffer).setType('SCALAR').setArray(new Uint32Array(g.index.array)));
    const c = (object.material as THREE.MeshStandardMaterial).color;
    primitive.setMaterial(doc.createMaterial().setBaseColorFactor([c.r, c.g, c.b, 1]).setRoughnessFactor(1).setMetallicFactor(0));
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive))); g.dispose();
  });
  await doc.transform(dedup(), flatten(), join(), weld());
  const bytes = await new NodeIO().writeBinary(doc), hash = createHash('sha256').update(bytes).digest('hex');
  const file = detailed ? 'prepared.glb' : 'blockout.glb'; await fs.writeFile(directory + file, bytes);
  const triangles = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() || 0) / 3, 0), 0);
  return { model: { id: `model-${hash}`, hash, name: detailed ? '局部修理铺与街边陈设' : '反例：仅体块', size: size.toArray(), sourceBytes: bytes.length, createdAt: 0, license: 'Original example, reusable with this repository', lods: [{ hash, url: `/media/spatial/models/${hash}.glb`, bytes: bytes.length, triangles, distance: 0 }] }, position: anchor.toArray(), file };
}

const prepared = await exportModel(true), blockout = await exportModel(false);
const world = (entry: typeof prepared) => ({ schemaVersion: 'previs-world.v1', title: '修理铺局部布景教学', description: '只演示指定机位的结构与背景调度，不是完整社区。', worldBrief: { scope: 'component', description: '局部布景案例', geography: '修理铺与一段街道', circulation: '门前人行道与两侧街边', services: '修理铺与相邻门面', skyline: '只覆盖案例机位，不作为全剧远景', gaps: ['其他店铺仅外景代理；未建立全城', '人物为简化排演，不含手指/IK', '未制作最终AI故事板或视频'] }, models: [entry.model], locations: [{ id: 'example-set', name: '修理铺与街边', description: '教学场地', origin: [0, 0, 0], ground: [60, 40], groundVisible: false, sourceSceneIds: [] }], objects: [{ id: 'set', label: '固定布景', locationId: 'example-set', kind: 'model', modelId: entry.model.id, position: entry.position, rotation: [0, 0, 0], size: entry.model.size, color: '#bbbbbb', pose: 'stand' }] });
const objects = [
  { id: 'bg-walker', label: '下班行人', position: [-10, .18, 5], rotation: [0, Math.PI / 2, 0], pose: 'walk', activity: '沿人行道以0.8米/秒向东；切镜保持时刻和身份。' },
  { id: 'bg-neighbor', label: '等候邻居', position: [8.5, .18, 4.5], rotation: [0, .3, 0], pose: 'stand', activity: '在长椅附近等待，不遮挡店门。' },
  { id: 'bg-shopkeeper', label: '门口店员', position: [-9, .18, 3.8], rotation: [0, 0, 0], pose: 'stand', activity: '在相邻店铺门口留守；本案例不声称已排演收摊动作。' },
].map(o => ({ ...o, kind: 'actor', performanceRole: 'background', size: [.6, 1.8, .4], color: '#768489' }));
const cameras = [
  { position: [2.8, 1.65, 2.3], target: [-.3, 1.2, -1.8], focalLength: 24 },
  { position: [6, 1.7, 14], target: [0, 1.5, 1], focalLength: 28 },
  { position: [-2.8, 1.65, -.8], target: [2, 1.5, 7], focalLength: 24 },
];
const frames = [0, 1].flatMap(shot => [0, 8].map(time => ({ id: `shot-${shot}-${time}`, shotId: `example-shot-${shot}`, label: shot ? '内向外反打' : '街边向店铺', timeInShot: time, note: '背景行人以场次累计时刻推进，切镜不重置；仅构图和背景调度示范。', camera: cameras[shot + 1], states: { 'bg-walker': { position: [-10 + .8 * (shot * 8 + time), .18, 5], pose: 'walk', visible: true } } })));
const plan = { schemaVersion: 'scene-previs.v1', locationId: 'example-set', light: { position: [12, 20, 8], intensity: 2 }, objects, frames };
await fs.writeFile(directory + 'case.json', JSON.stringify({ scope: 'local-set-study', models: [prepared, blockout], preparedWorld: world(prepared), blockoutWorld: world(blockout), plan, inspections: [{ id: 'workshop', camera: cameras[0] }, { id: 'street', camera: cameras[1] }, { id: 'reverse', camera: cameras[2] }], scene: { id: 'example-scene', shots: [0, 1].map(i => ({ id: `example-shot-${i}`, duration: 8, characterIdsInShot: [] })) } }, null, 2) + '\n');
console.log('局部布景和调度案例已生成；未读写任何项目数据库。');
