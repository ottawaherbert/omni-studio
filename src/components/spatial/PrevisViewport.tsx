import { SpatialRuntime, spatialPoolStats } from './spatialRuntime';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { PrevisWorldPlan, PrevisPlan, PrevisFrame, PrevisCamera, PrevisVector, PrevisAttachment } from '../../clients/previsClient';
import { samplePrevisFrame } from '../../clients/previsClient';
import { createPrevisRenderer } from './previsRenderer';
import { rigidSocketMatrix } from './actorRig';

type Props = {
  world: PrevisWorldPlan; plan?: PrevisPlan; frame?: PrevisFrame; aspect: number; cameraView: boolean;
  readOnly?: boolean; selectedId?: string; focusLocationId?: string; focusRequest?: number; time?: number;
  onSelect: (id: string) => void; onMove: (id: string, position: PrevisVector) => void;
  onCaptureCamera?: (read: (() => PrevisCamera) | undefined) => void;
  onCaptureObjectTransform?: (read: ((id:string,attachment?:PrevisAttachment|null)=>{position:PrevisVector;rotation:PrevisVector}|undefined) | undefined) => void;
};
export function PrevisViewport(input: Props) {
  const [tour,setTour]=useState(''),[tourTime,setTourTime]=useState(0),[playing,setPlaying]=useState(false);
  const route=input.world.routes?.find(r=>`route:${r.id}`===tour),view=input.world.viewpoints?.find(v=>`view:${v.id}`===tour);
  useEffect(()=>{setTour('');setPlaying(false);setTourTime(0);},[input.focusLocationId,input.focusRequest,input.plan?.locationId]);
  useEffect(()=>{if(!playing||!route)return;let handle=0,previous=performance.now();const tick=(now:number)=>{const dt=(now-previous)/1000;previous=now;setTourTime(t=>{if(t+dt>=route.duration){setPlaying(false);return route.duration;}return t+dt;});handle=requestAnimationFrame(tick);};handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);},[playing,route]);
  let tourFrame:PrevisFrame|undefined;
  if(!input.plan&&(route||view)){
    const base:PrevisFrame={id:'tour',shotId:'tour',label:'场地巡视',note:'',timeInShot:tourTime,camera:view?.camera||route!.keys[0].camera,states:{}};
    tourFrame=route?samplePrevisFrame({schemaVersion:'scene-previs.v1',locationId:route.locationId,light:{position:[10,30,20],intensity:2},objects:[],frames:route.keys.map((k,i)=>({...base,id:String(i),timeInShot:k.time,camera:k.camera}))},'tour',tourTime):base;
    const origin=input.world.locations.find(l=>l.id===(route||view)!.locationId)?.origin||[0,0,0];tourFrame={...tourFrame,camera:{...tourFrame.camera,position:tourFrame.camera.position.map((n,i)=>n+origin[i]) as PrevisVector,target:tourFrame.camera.target.map((n,i)=>n+origin[i]) as PrevisVector}};
  }
  const props:Props=tourFrame?{...input,frame:tourFrame,cameraView:true,time:tourTime}:input;
  const host = useRef<HTMLDivElement>(null), current = useRef(props); current.current = props;
  const runtime = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; orbit: OrbitControls; transform: TransformControls; scene: THREE.Scene; spatial?: SpatialRuntime; sceneKey?: string; cameraView: boolean; focus?: string; editor?: { p: THREE.Vector3; t: THREE.Vector3 } }>(undefined);
  const sceneKey = useMemo(()=>JSON.stringify([props.world, props.plan && {locationId:props.plan.locationId,includedLocationIds:props.plan.includedLocationIds,light:props.plan.light,objects:props.plan.objects}]),[props.world,props.plan?.locationId,props.plan?.includedLocationIds,props.plan?.light,props.plan?.objects]);
  const [error, setError] = useState(''), [stats, setStats] = useState(''), [showStats, setShowStats] = useState(false);
  useEffect(() => {
    const container = host.current; if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = createPrevisRenderer(640, 360); } catch { setError('无法启动 WebGL，请开启浏览器硬件加速后重试。'); return; }
    const camera = new THREE.PerspectiveCamera(45, 1, .05, 100000), orbit = new OrbitControls(camera, renderer.domElement);
    const transform = new TransformControls(camera, renderer.domElement); transform.setMode('translate'); transform.setSpace('world'); transform.size = .8;
    const state = { renderer, camera, orbit, transform, scene: new THREE.Scene(), cameraView: false } as NonNullable<typeof runtime.current>; runtime.current = state;
    let dragging = false, down: [number, number] | undefined;
    transform.addEventListener('dragging-changed', e => { dragging = Boolean(e.value); orbit.enabled = !dragging && !current.current.cameraView; });
    transform.addEventListener('mouseUp', () => {
      const selected = transform.object, p = current.current; if (!selected) return;
      const position = selected.position.clone(),raw=p.plan?.objects.find(o=>o.id===selected.userData.objectId)||p.world.objects.find(o=>o.id===selected.userData.objectId);
      if(raw?.attachment){const socket=state.spatial?.object(raw.attachment.objectId)?.getObjectByName(`socket:${raw.attachment.socket}`);if(socket){position.applyMatrix4(rigidSocketMatrix(socket).invert());p.onMove(selected.userData.objectId,position.toArray() as PrevisVector);return;}}
      if(raw?.pivot)position.sub(new THREE.Vector3(...raw.pivot));
      if (p.plan) position.sub(selected.userData.base || new THREE.Vector3());
      if (!p.plan) { const raw = p.world.objects.find(o => o.id === selected.userData.objectId), location = p.world.locations.find(l => l.id === raw?.locationId); if (location) position.sub(new THREE.Vector3(...location.origin)); }
      p.onMove(selected.userData.objectId, position.toArray() as PrevisVector);
    });
    renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (current.current.readOnly || current.current.cameraView || dragging || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(state.scene.children.filter(c => c.userData.objectId || c.userData.spatialShared), true)[0];
      const id = hit && state.spatial?.hit(hit); if (id) current.current.onSelect(id);
    });
    container.appendChild(renderer.domElement);
    const resize = () => { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = current.current.cameraView ? current.current.aspect : w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let animation = 0, last = performance.now(), tick = 0; const durations: number[] = [];
    const render = () => {
      const w = container.clientWidth, h = container.clientHeight, p = current.current;
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.clear();
      if (p.cameraView) { const vw = Math.min(w, h * p.aspect), vh = vw / p.aspect; renderer.setViewport((w - vw) / 2, (h - vh) / 2, vw, vh); renderer.setScissor((w - vw) / 2, (h - vh) / 2, vw, vh); renderer.setScissorTest(true); }
      const now = performance.now(); durations.push(now - last); last = now; if(durations.length > 240)durations.shift();
      if(now - tick > 1000) { tick = now; const d = state.spatial?.diagnostics; const sorted = [...durations].sort((a,b)=>a-b); setStats(`${renderer.info.render.triangles.toLocaleString()} 三角面 · ${renderer.info.render.calls} 绘制 · p95 ${Math.round(sorted[Math.floor(sorted.length*.95)] || 0)}ms · ${((d?.loadedBytes||0)/1048576).toFixed(1)}MB 文件缓存 · ${spatialPoolStats().resources} 资源 · ${d?.clusters||0} 远景区 · ${((d?.geometryBytes||0)/1048576).toFixed(1)}MB 几何估算${d?.budgetWarning ? ' · '+d.budgetWarning : ''}${d?.loading ? ' · 加载中' : ''}`); void state.spatial?.prepare(camera).catch(e=>setError(e.message)); }
      renderer.render(state.scene, camera); animation = requestAnimationFrame(render);
    }; render();
    return () => { cancelAnimationFrame(animation); observer.disconnect(); transform.detach(); state.scene.remove(transform.getHelper()); transform.dispose(); orbit.dispose(); state.spatial?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); current.current.onCaptureCamera?.(undefined); runtime.current = undefined; };
  }, []);
  useEffect(() => {
    const state = runtime.current, container = host.current; if (!state || !container) return;
    const { world, plan, frame, cameraView, aspect, focusLocationId, selectedId, time = 0 } = props;
    const { camera, orbit, transform } = state;
    state.spatial?.setPlan(plan);
    transform.detach(); state.scene.remove(transform.getHelper());
    if (sceneKey !== state.sceneKey) { state.spatial?.dispose(); state.spatial = new SpatialRuntime(world, plan); state.scene = state.spatial.scene; state.sceneKey = sceneKey; setError(''); void state.spatial.prepare(camera).catch(e=>setError(e.message)); }
    state.spatial!.update(frame, time);
    const focus = `${plan ? 'stage' : 'world'}:${plan?.locationId || focusLocationId || ''}:${props.focusRequest || 0}`;
    if (state.focus !== focus) { state.editor = undefined; state.focus = focus; }
    else if (!state.cameraView) state.editor = { p: camera.position.clone(), t: orbit.target.clone() };
    if (cameraView && frame) {
      camera.aspect = aspect; camera.filmGauge = 36; camera.setFocalLength(frame.camera.focalLength); camera.position.fromArray(frame.camera.position); camera.lookAt(new THREE.Vector3(...frame.camera.target));
    } else {
      const location = world.locations.find(l => l.id === focusLocationId), origin = plan ? [0, 0, 0] : location?.origin || [0, 0, 0];
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); camera.fov = 45;
      if (!plan && !focusLocationId && world.locations.length && !state.editor) {
        const bounds = new THREE.Box3();
        world.locations.forEach(l => { bounds.expandByPoint(new THREE.Vector3(l.origin[0] - l.ground[0] / 2, l.origin[1], l.origin[2] - l.ground[1] / 2)); bounds.expandByPoint(new THREE.Vector3(l.origin[0] + l.ground[0] / 2, l.origin[1] + 5, l.origin[2] + l.ground[1] / 2)); });
        const centre = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()), distance = Math.max(size.x, size.z) * 1.15;
        state.editor = { p: centre.clone().add(new THREE.Vector3(distance * .6, distance, distance)), t: centre };
      }
      camera.position.copy(state.editor?.p || new THREE.Vector3(origin[0] + 15, origin[1] + 15, origin[2] + 20));
      orbit.target.copy(state.editor?.t || new THREE.Vector3(origin[0], origin[1] + 1, origin[2])); orbit.update();
      const selected = state.spatial?.object(selectedId || ''); if (selected) { transform.attach(selected); state.scene.add(transform.getHelper()); }
    }
    camera.updateProjectionMatrix(); orbit.enabled = !cameraView; state.cameraView = cameraView;
    props.onCaptureCamera?.(cameraView ? undefined : () => ({ position: camera.position.toArray() as PrevisVector, target: orbit.target.toArray() as PrevisVector, focalLength: camera.getFocalLength() }));
    props.onCaptureObjectTransform?.((id,attachment)=>{
      const root=state.spatial?.object(id);if(!root)return;root.updateMatrixWorld(true);const matrix=root.matrixWorld.clone();
      if(attachment){const socket=state.spatial?.object(attachment.objectId)?.getObjectByName(`socket:${attachment.socket}`);if(!socket)return;socket.updateMatrixWorld(true);matrix.premultiply(rigidSocketMatrix(socket).invert());}
      const position=new THREE.Vector3(),rotation=new THREE.Quaternion();matrix.decompose(position,rotation,new THREE.Vector3());
      const euler=new THREE.Euler().setFromQuaternion(rotation);return{position:position.toArray() as PrevisVector,rotation:[euler.x,euler.y,euler.z]};
    });
  }, [props.world, props.plan, props.frame, props.aspect, props.cameraView, props.selectedId, props.focusLocationId, props.focusRequest, props.time]);
  return <div className="relative h-full min-h-64 w-full bg-bg-primary" aria-label={props.cameraView ? '白模摄影机画面' : '3D 影视城编辑视图'}><div ref={host} className="absolute inset-0" />{!input.plan&&Boolean(input.world.viewpoints?.length||input.world.routes?.length)&&<div className="absolute left-3 top-3 flex max-w-[80%] flex-wrap items-center gap-2 rounded bg-black/80 p-2 text-xs text-white"><select aria-label="取景与巡视" className="max-w-64 bg-transparent p-1" value={tour} onChange={e=>{setTour(e.target.value);setTourTime(0);setPlaying(false);}}><option value="">自由查看</option><optgroup label="检查机位">{input.world.viewpoints?.map(v=><option key={v.id} value={`view:${v.id}`}>{v.name}</option>)}</optgroup><optgroup label="巡视路线">{input.world.routes?.map(r=><option key={r.id} value={`route:${r.id}`}>{r.name}</option>)}</optgroup></select>{route&&<><button onClick={()=>{if(tourTime>=route.duration)setTourTime(0);setPlaying(p=>!p);}} className="px-2 py-1">{playing?'暂停':'播放路线'}</button><input aria-label="巡视进度" type="range" min={0} max={route.duration} step={.05} value={tourTime} onChange={e=>{setTourTime(Number(e.target.value));setPlaying(false);}}/><span>{tourTime.toFixed(1)} / {route.duration}s</span></>}{view&&<span className="max-w-xs text-white/65">{view.note}</span>}</div>}<div className="absolute right-3 top-3 flex flex-col items-end gap-2"><button type="button" onClick={()=>setShowStats(v=>!v)} className="rounded bg-black/65 px-3 py-2 text-xs text-white">性能</button>{showStats && <p className="max-w-md rounded bg-black/75 p-2 text-xs text-white">{stats}<br/>文件大小不等于显存。远处按视距加载，拍摄按机位路径预载并固定细节。</p>}</div>{error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-red-400">{error}</p>}<p className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/65 px-3 py-2 text-xs text-white/80">{props.cameraView ? '摄影机画幅 · 白模预演' : props.readOnly?'左键环绕 · 右键平移 · 滚轮缩放 · 候选只读预览':'左键环绕 · 右键平移 · 滚轮缩放 · 选中物体后拖动坐标轴'}</p></div>;
}
