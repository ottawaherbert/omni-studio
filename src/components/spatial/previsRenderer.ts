import { SpatialRuntime } from './spatialRuntime';
import { createActorRig } from './actorRig';
import * as THREE from 'three';
import type { PrevisWorldPlan, PrevisPlan, PrevisFrame, PrevisObject, PrevisTimeline } from '../../clients/previsClient';
import { previsAspect, previsTimelineAt, previsVisibleLocations } from '../../clients/previsClient';

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function buildPrevisObject(o: PrevisObject, time = 0) {
  if (o.kind === 'actor') { const actor = createActorRig(o); actor.position.fromArray(o.position); actor.rotation.set(...o.rotation); return actor; }
  const group = new THREE.Group(); group.userData.objectId = o.id;
  const material = new THREE.MeshStandardMaterial({ color: o.color, roughness: .9 });
  const [w, h, d] = o.size;
  if (o.kind === 'stairs') {
    for (let i = 0; i < 6; i++) group.add(mesh(new THREE.BoxGeometry(w, h * (i + 1) / 6, d / 6), material, 0, h * (i + 1) / 12, -d / 2 + d * (i + .5) / 6));
  } else group.add(mesh(o.kind === 'cylinder' ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24) : new THREE.BoxGeometry(w, h, d), material, 0, h / 2, 0));
  if(o.pivot)for(const child of group.children)child.position.sub(new THREE.Vector3(...o.pivot));
  group.position.fromArray(o.position);if(o.pivot)group.position.add(new THREE.Vector3(...o.pivot)); group.rotation.set(...o.rotation);
  return group;
}
export function buildPrevisScene(world: PrevisWorldPlan, plan?: PrevisPlan, frame?: PrevisFrame, time = 0) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#343b40');
  scene.add(new THREE.HemisphereLight('#e7f2f5', '#6c747c', 2));
  const sun = new THREE.DirectionalLight('#ffffff', plan?.light.intensity ?? 2); sun.position.fromArray(plan?.light.position || [8, 16, 12]);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, far: 150 }); sun.shadow.bias = -.00002; scene.add(sun);
  const locations = previsVisibleLocations(world, plan);
  const primary = world.locations.find(l => l.id === plan?.locationId);
  for (const l of locations) {
    const base = primary ? l.origin.map((v, i) => v - primary.origin[i]) : l.origin;
    const ground = mesh(new THREE.BoxGeometry(l.ground[0], .12, l.ground[1]), new THREE.MeshStandardMaterial({ color: '#747d82', roughness: 1 }), base[0], base[1] - .06, base[2]);
    ground.userData.locationId = l.id; if(l.groundVisible!==false)scene.add(ground);else {ground.geometry.dispose();(ground.material as THREE.Material).dispose();}
    for (const raw of world.objects.filter(o => o.locationId === l.id)) {
      const state = frame?.states[raw.id]; if (state?.visible === false || raw.kind === 'model') continue;
      const object = buildPrevisObject({ ...raw, ...state }, time); object.position.add(new THREE.Vector3(...base)); scene.add(object);
    }
  }
  for (const raw of plan?.objects || []) {
    const state = frame?.states[raw.id]; if (state?.visible === false || raw.kind === 'model') continue;
    scene.add(buildPrevisObject({ ...raw, ...state }, time));
  }
  return scene;
}
export function previsCamera(frame: PrevisFrame, aspect: number) {
  const camera = new THREE.PerspectiveCamera(50, aspect, .05, 10000);
  camera.filmGauge = 36; camera.setFocalLength(frame.camera.focalLength);
  camera.position.fromArray(frame.camera.position); camera.lookAt(new THREE.Vector3(...frame.camera.target)); camera.updateProjectionMatrix(); return camera;
}
export function disposePrevisScene(scene: THREE.Scene) {
  scene.traverse(obj => { if (obj instanceof THREE.Light && 'shadow' in obj) (obj as THREE.DirectionalLight).shadow?.dispose(); if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose(); } });
}
export function createPrevisRenderer(width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height); renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; return renderer;
}
export async function renderPrevisGrid(world: PrevisWorldPlan, plan: PrevisPlan, aspectRatio: string, frameIds: string[], columns: number) {
  const aspect = previsAspect(aspectRatio), rows = Math.ceil(frameIds.length / columns);
  const height = Math.floor(Math.min(960, 960 / aspect, 8192 / rows, 8192 / columns / aspect)), width = Math.round(height * aspect);
  const frames = frameIds.map(id => plan.frames.find(f => f.id === id)!);
  const canvas = document.createElement('canvas'); canvas.width = width * columns; canvas.height = height * Math.ceil(frames.length / columns);
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#343b40'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const renderer = createPrevisRenderer(width, height), runtime = new SpatialRuntime(world, plan);
  try {
    await runtime.prepareCapture(frames.map(f=>previsCamera(f,aspect)));
    for (const [i, frame] of frames.entries()) { runtime.update(frame, frame.timeInShot); const camera = previsCamera(frame, aspect); await renderer.compileAsync(runtime.scene, camera); renderer.render(runtime.scene, camera); ctx.drawImage(renderer.domElement, (i % columns) * width, Math.floor(i / columns) * height); }
    return canvas.toDataURL('image/png');
  } finally { runtime.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
}
export function createPrevisVideoRenderer(timeline: PrevisTimeline, width: number, height: number) {
  const renderer = createPrevisRenderer(width, height);
  let runtime: SpatialRuntime | undefined, plan: PrevisPlan | undefined;
  return {
    async frame(time: number) {
      const sample = previsTimelineAt(timeline, time);
      if (plan !== sample.shot.plan) { const previous = runtime; plan = sample.shot.plan; runtime = new SpatialRuntime(timeline.world, plan); try { await runtime.prepareCapture(plan.frames.map(f=>previsCamera(f,width/height))); } finally { previous?.dispose(); } await renderer.compileAsync(runtime.scene, previsCamera(sample.frame, width / height)); }
      runtime!.update(sample.frame, Math.max(0, time - sample.shot.start)); renderer.render(runtime!.scene, previsCamera(sample.frame, width / height)); return renderer.domElement.toDataURL('image/jpeg', .9);
    },
    dispose() { runtime?.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
