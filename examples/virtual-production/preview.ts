import * as THREE from 'three';
import { SpatialRuntime, spatialPoolStats } from '../../src/components/spatial/spatialRuntime';
import { createPrevisRenderer, previsCamera } from '../../src/components/spatial/previsRenderer';
import { samplePrevisFrame } from '../../packages/domain/src/previs';
import example from './case.json';
import type { PrevisPlan, PrevisWorldPlan } from '../../packages/domain/src/previs';
import { previsHash } from '../../packages/domain/src/previs';
import { inspectSnapshot } from '../../src/components/spatial/contactInspection';

const renderer = createPrevisRenderer(1280, 720);
document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
const plan = example.plan as unknown as PrevisPlan;
let runtime: SpatialRuntime;
async function setup(prepared: boolean) {
  runtime?.dispose();
  runtime = new SpatialRuntime((prepared ? example.preparedWorld : example.blockoutWorld) as PrevisWorldPlan, { ...plan, objects: prepared ? plan.objects : [], frames: prepared ? plan.frames : plan.frames.map(f => ({ ...f, states: {} })) });
}
async function draw(camera: any, frame = plan.frames[0], time = 0) {
  const c = previsCamera({ ...frame, camera }, 16 / 9);
  await runtime.prepare(c, true); runtime.update(frame, time); renderer.render(runtime.scene, c);
  return renderer.domElement.toDataURL('image/png');
}
(window as any).exampleCapture = {
  async inspect(){
    const world=example.preparedWorld as PrevisWorldPlan;
    return inspectSnapshot({world,sourceHash:previsHash({world,plan}),fps:24,timeline:{world,aspectRatio:'16:9',duration:16,sourceHash:'public-example',shots:[0,1].map(i=>({sceneId:'example-scene',episodeId:'example-episode',shotId:`example-shot-${i}`,label:'背景承接',start:i*8,duration:8,plan}))}});
  },
  async still(id: string, prepared: boolean) {
    await setup(prepared);
    const inspection = example.inspections.find(i => i.id === id)!;
    return draw(inspection.camera, prepared ? plan.frames[0] : { ...plan.frames[0], states: {} });
  },
  async movieFrame(frameIndex: number) {
    if (frameIndex === 0) await setup(true);
    const t = frameIndex / 12, shot = Math.min(1, Math.floor(t / 8));
    const f = samplePrevisFrame(plan, `example-shot-${shot}`, t - shot * 8);
    await draw(f.camera, f, t);
    return renderer.domElement.toDataURL('image/jpeg', .9);
  },
  async measure() {
    await setup(true);
    const camera = previsCamera(plan.frames[0], 16 / 9); await runtime.prepare(camera, true);
    await renderer.compileAsync(runtime.scene, camera);
    const samples: number[] = []; let previous = performance.now();
    for (let i = 0; i < 180; i++) {
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const f = samplePrevisFrame(plan, 'example-shot-0', i / 30);
      camera.position.x = f.camera.position[0] + Math.sin(i / 60); camera.lookAt(new THREE.Vector3(...f.camera.target));
      runtime.update(f, i / 30); renderer.render(runtime.scene, camera);
      const now = performance.now(); if (i > 30) samples.push(now - previous); previous = now;
    }
    samples.sort((a, b) => a - b);
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    const result = { browser: navigator.userAgent, gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown', resolution: [1280, 720], samples: samples.length, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)], triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, loadedBytes: runtime.diagnostics.loadedBytes };
    runtime.dispose(); await new Promise(r => setTimeout(r, 0));
    return { ...result, releasedPool: spatialPoolStats(), limitation: '局部案例短路线；不代表整城性能、所有设备或创作验收。' };
  },
};
