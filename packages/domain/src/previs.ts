import { validateSpatialMetadata, type SpatialModel, type StudioInstance, type StudioConnection } from './spatial';
import { sha256 } from 'js-sha256';
import type { Project, Scene, Episode } from './project';

export type PrevisVector = [number, number, number];
/** Geometry and motion changes invalidate renders, never saved drafts. */
export const PREVIS_RENDER_VERSION = 'previs-render.v2';
export type PrevisPose = 'stand' | 'walk' | 'reach' | 'crouch' | 'sit' | 'lean' | 'run' | 'kneel';
export interface PrevisAttachment { objectId: string; socket: 'leftHand' | 'rightHand' | 'waist' }
export interface PrevisObjectState {
  position?: PrevisVector; rotation?: PrevisVector; visible?: boolean; pose?: PrevisPose;
  leftArm?: PrevisVector; rightArm?: PrevisVector;
  /** Actor-local metres. Explicit hand targets take precedence over legacy arm angles. */
  leftHand?: PrevisVector; rightHand?: PrevisVector;
  /** Preferred elbow bend directions, actor-local vectors, not forced elbow positions. */
  leftElbow?: PrevisVector; rightElbow?: PrevisVector;
  leftHandRotation?: PrevisVector; rightHandRotation?: PrevisVector;
  /** Omitted inherits the object binding; null releases into scene coordinates. */
  attachment?: PrevisAttachment | null;
}
export interface PrevisObject {
  id: string; label: string; kind: 'box' | 'cylinder' | 'stairs' | 'actor' | 'model';
  modelId?: string; pivot?: PrevisVector; attachment?: PrevisAttachment;
  /** Opt-in surface following. Authored mode preserves the saved placements. */
  grounding?: { mode: 'authored' | 'surface'; maxStep?: number };
  /** Seat top above the support plane, in metres; used only by sit. */
  seatHeight?: number;
  /** Position is the bottom centre in metres; Y is up. Rotation is in radians. */
  position: PrevisVector; rotation: PrevisVector; size: PrevisVector;
  color: string; assetId?: string; pose: PrevisPose;
  /** Scene casting metadata, not a second animation track. Old actors remain valid. */
  performanceRole?: 'principal' | 'background'; activity?: string;
}
export interface PrevisCamera { position: PrevisVector; target: PrevisVector; focalLength: number }
export interface PrevisFrame {
  id: string; shotId: string; label: string; timeInShot: number; note: string;
  camera: PrevisCamera;
  states: Record<string, PrevisObjectState>;
}
export interface PrevisPlan {
  schemaVersion: 'scene-previs.v1'; locationId: string;
  /** Explicit physically shared zones in this shot, never inferred from map layout. */
  includedLocationIds?: string[];
  light: { position: PrevisVector; intensity: number };
  objects: PrevisObject[]; frames: PrevisFrame[];
}
export interface PrevisLocation {
  id: string; name: string; description: string; origin: PrevisVector;
  parentId?: string; groundVisible?: boolean;
  spaceId?: string; detailTier?: 'shootable' | 'context' | 'horizon'; usage?: string;
  ground: [number, number]; assetId?: string; sourceSceneIds: string[];
}
export interface PrevisWorldPlan {
  schemaVersion: 'previs-world.v1'; title: string; description: string;
  worldBrief?: { scope: 'component' | 'district' | 'world'; description: string; geography: string; circulation: string; services: string; skyline: string; gaps: string[] };
  viewpoints?: Array<{id:string;name:string;locationId:string;camera:PrevisCamera;note:string}>;
  routes?: Array<{id:string;name:string;locationId:string;duration:number;keys:Array<{time:number;camera:PrevisCamera}>}>;
  models?: SpatialModel[]; instances?: StudioInstance[]; connections?: StudioConnection[];
  locations: PrevisLocation[]; objects: Array<PrevisObject & { locationId: string }>;
}
export interface PrevisWorld { revision: number; plan: PrevisWorldPlan; updatedAt: number }
export interface PrevisExport {
  id: string; imageUrl: string; contentHash: string; sourceHash: string;
  frameIds: string[]; shotIds: string[]; columns: number; rows: number;
  width: number; height: number; narrativeSeconds: number; createdAt: number;
}
export interface ScenePrevis { revision: number; plan: PrevisPlan; exports: PrevisExport[]; updatedAt: number }
export interface PrevisContactIssue {
  kind: 'penetration' | 'floating' | 'unsupported' | 'unreachable' | 'transition';
  severity: 'error' | 'review'; objectId: string; otherId?: string; part: string; message: string;
  point?: PrevisVector; distance?: number; shotId?: string; sceneId?: string; time?: number; endTime?: number; samples?: number;
}
export interface PrevisContactReport {
  renderVersion: string; sourceHash: string; fps: number; sampledFrames: number; checkedObjectIds: string[];
  issues: PrevisContactIssue[]; passed: boolean; complete: boolean; limitations: string[];
}
export interface PrevisContactCheck {
  id: string; projectId: string; scope: 'world' | 'scene' | 'episode' | 'project';
  episodeId?: string; sceneId?: string; shotIds?: string[]; objectIds?: string[];
  status: 'queued' | 'running' | 'complete' | 'failed'; sourceHash: string;
  worldRevision: number; fps: number; report?: PrevisContactReport; error?: string; createdAt: number; updatedAt: number; sourceCurrent?: boolean;
}
export interface PrevisTimelineShot { sceneId: string; episodeId: string; shotId: string; label: string; start: number; duration: number; plan: PrevisPlan }
export interface PrevisTimeline { renderVersion?: string; world: PrevisWorldPlan; aspectRatio: string; shots: PrevisTimelineShot[]; duration: number; sourceHash: string }
export interface PrevisVideo {
  id: string; projectId: string; scope: 'scene' | 'episode' | 'project'; episodeId?: string; sceneId?: string;
  shotIds?: string[];
  timeline: PrevisTimeline; fps: number; width: number; height: number; totalFrames: number; receivedFrames: number;
  status: 'rendering' | 'encoding' | 'complete' | 'failed' | 'cancelled'; error?: string;
  videoUrl?: string; createdAt: number; updatedAt: number;
}
export function samplePrevisFrame(plan: PrevisPlan, shotId: string, time: number, world?: PrevisWorldPlan): PrevisFrame {
  const keys = plan.frames.filter(f => f.shotId === shotId).sort((a, b) => a.timeInShot - b.timeInShot);
  if (!keys.length) throw new Error('镜头缺少机位关键帧。');
  const right = keys.findIndex(f => f.timeInShot > time);
  const a = right === 0 ? keys[0] : right === -1 ? keys[keys.length - 1] : keys[right - 1];
  const b = right <= 0 ? a : keys[right];
  const mix = a === b ? 0 : Math.max(0, Math.min(1, (time - a.timeInShot) / (b.timeInShot - a.timeInShot)));
  const vec = (x: PrevisVector, y: PrevisVector): PrevisVector => x.map((n, i) => n + (y[i] - n) * mix) as PrevisVector;
  const states: PrevisFrame['states'] = {};
  for (const id of new Set([...Object.keys(a.states), ...Object.keys(b.states)])) {
    const base = plan.objects.find(o => o.id === id) || world?.objects.find(o => o.id === id), x = a.states[id] || {}, y = b.states[id] || {};
    // A missing override inherits the scene base, never the previous shot's accidental UI state.
    const attachment = (s: PrevisObjectState) => s.attachment === undefined ? base?.attachment : s.attachment;
    const sameSpace = JSON.stringify(attachment(x) || null) === JSON.stringify(attachment(y) || null);
    const xp = x.position || base?.position, yp = y.position || base?.position;
    const xr = x.rotation || base?.rotation, yr = y.rotation || base?.rotation;
    const rest: PrevisVector = [0, 0, 0];
    states[id] = { ...x, ...(xp && yp ? { position: sameSpace ? vec(xp, yp) : xp } : {}), ...(xr && yr ? { rotation: sameSpace ? vec(xr, yr) : xr } : {}),
      ...(x.leftArm || y.leftArm ? { leftArm: vec(x.leftArm || rest, y.leftArm || rest) } : {}),
      ...(x.rightArm || y.rightArm ? { rightArm: vec(x.rightArm || rest, y.rightArm || rest) } : {}) };
    for (const field of ['leftHand', 'rightHand', 'leftElbow', 'rightElbow', 'leftHandRotation', 'rightHandRotation'] as const) {
      if (x[field] && y[field]) states[id][field] = vec(x[field]!, y[field]!);
    }
  }
  return { ...a, states, timeInShot: time, camera: { position: vec(a.camera.position, b.camera.position), target: vec(a.camera.target, b.camera.target), focalLength: a.camera.focalLength + (b.camera.focalLength - a.camera.focalLength) * mix } };
}
export function previsTimelineAt(timeline: PrevisTimeline, time: number) {
  const shot = timeline.shots.find(s => time < s.start + s.duration) || timeline.shots.at(-1);
  if (!shot) throw new Error('没有可拍摄的镜头。');
  return { shot, frame: samplePrevisFrame(shot.plan, shot.shotId, Math.max(0, time - shot.start), timeline.world) };
}
export const previsPoses: Record<PrevisPose, string> = { stand: '站立', walk: '迈步', reach: '伸手', crouch: '蹲伏', sit: '坐姿', lean: '伏台', run: '奔跑', kneel: '跪姿' };
export const previsKinds: Record<PrevisObject['kind'], string> = { box: '方块 / 墙体', cylinder: '圆柱', stairs: '台阶', actor: '人物', model: '三维模型' };
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}` : JSON.stringify(v);
export const previsHash = (value: unknown) => sha256(stable(value));
export function previsAspect(aspectRatio: string): number {
  const [w, h] = aspectRatio.split(':').map(Number);
  return w > 0 && h > 0 && w / h >= .25 && w / h <= 4 ? w / h : 16 / 9;
}
export function createPrevisPlan(scene: Scene, project: Project, locationId: string): PrevisPlan {
  const ids = [...new Set((scene.shots || []).flatMap(s => s.characterIdsInShot || []))];
  return { schemaVersion: 'scene-previs.v1', locationId, light: { position: [5, 9, 4], intensity: 2 },
    objects: ids.flatMap((id, i) => { const c = project.characters?.find(c => c.id === id); return c ? [{ id: `actor-${id}`, label: c.name, kind: 'actor' as const, assetId: id, position: [(i - (ids.length - 1) / 2) * 2, 0, 0] as PrevisVector, rotation: [0, 0, 0] as PrevisVector, size: [.6, 1.8, .4] as PrevisVector, color: ['#aebbc2', '#c2aca5', '#a8b7a4'][i % 3], pose: 'stand' as const }] : []; }),
    frames: (scene.shots || []).map((s, i) => ({ id: `frame-${s.id}`, shotId: s.id, label: `镜头 ${i + 1}`, timeInShot: 0, note: '', camera: { position: [0, 2.4, 8], target: [0, 1, 0], focalLength: 35 }, states: {} })),
  };
}
export function validatePrevisPlan(raw: unknown, scene: Scene, project: Project, world: PrevisWorldPlan): asserts raw is PrevisPlan {
  const fail = (s: string): never => { throw new Error(s); };
  const record = (x: any, keys: string[], label: string) => { if (!x || Array.isArray(x) || typeof x !== 'object' || Object.keys(x).some(k => !keys.includes(k))) fail(`${label}格式无效或包含未知字段。`); };
  const text = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;
  const id = (x: unknown) => typeof x === 'string' && /^[\w\u3400-\u9fff:.-]{1,160}$/u.test(x);
  const num = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const vector = (x: unknown, positive = false) => Array.isArray(x) && x.length === 3 && x.every(n => num(n, positive ? .01 : -1000, 1000));
  const p = raw as PrevisPlan;
  record(p, ['schemaVersion', 'locationId', 'includedLocationIds', 'light', 'objects', 'frames'], '白模方案');
  if (p.schemaVersion !== 'scene-previs.v1' || !world.locations.some(l => l.id === p.locationId)) fail('请先在本剧影视城建立并选择已有地点。');
  if (p.includedLocationIds && (!Array.isArray(p.includedLocationIds) || new Set(p.includedLocationIds).size !== p.includedLocationIds.length || p.includedLocationIds.some(id => !world.locations.some(l => l.id === id)))) fail('共同取景地点不存在或重复。');
  record(p.light, ['position', 'intensity'], '光源');
  if (!vector(p.light.position) || !num(p.light.intensity, 0, 10)) fail('光源参数无效。');
  if (!Array.isArray(p.objects) || p.objects.length > 150 || !Array.isArray(p.frames) || p.frames.length > 120) fail('最多保存 150 个物体、120 个关键画格。');
  const assets = new Set([...(project.characters || []), ...(project.assets || [])].map(a => a.id));
  const visibleLocationIds = new Set(previsVisibleLocations(world, p).map(l => l.id));
  const objects = new Set<string>(world.objects.filter(o => visibleLocationIds.has(o.locationId)).map(o => o.id));
  for (const o of p.objects) {
    record(o, ['id', 'label', 'kind', 'position', 'rotation', 'size', 'color', 'assetId', 'pose', 'modelId', 'pivot', 'attachment', 'performanceRole', 'activity', 'grounding', 'seatHeight'], '物体');
    if(o.seatHeight!==undefined&&(o.kind!=='actor'||!num(o.seatHeight,.1,1.5)))fail('座面高度只适用于人物，范围为0.1–1.5米。');
    if (o.grounding) { record(o.grounding, ['mode', 'maxStep'], '接地设置'); if (o.kind !== 'actor' || !['authored', 'surface'].includes(o.grounding.mode) || o.grounding.maxStep !== undefined && !num(o.grounding.maxStep, .01, 1)) fail('接地设置只适用于人物，最大跟随高度为0.01–1米。'); }
    if (o.performanceRole !== undefined && (o.kind !== 'actor' || !['principal', 'background'].includes(o.performanceRole)) || o.activity !== undefined && (o.kind !== 'actor' || !text(o.activity, 1000))) fail('表演角色与活动说明只适用于人物。');
    if (!id(o.id) || objects.has(o.id) || !text(o.label, 160) || !Object.hasOwn(previsKinds, o.kind) || !vector(o.position) || !vector(o.rotation) || !vector(o.size, true) || !/^#[\da-f]{6}$/i.test(o.color) || !Object.hasOwn(previsPoses, o.pose)) fail('物体编号、形状或变换参数无效。');
    if (o.kind === 'model' ? !world.models?.some(m => m.id === o.modelId) : o.modelId !== undefined) fail('模型资源不存在或形状不匹配。');
    if(o.pivot && (!vector(o.pivot)||o.kind==='actor'))fail('旋转枢轴无效。');
    if(o.attachment){record(o.attachment,['objectId','socket'],'道具挂点');if(o.kind==='actor'||!['leftHand','rightHand','waist'].includes(o.attachment.socket)||!p.objects.some(a=>a.id===o.attachment!.objectId&&a.kind==='actor'))fail('挂点必须引用本场人物的手或腰。');}
    if (o.assetId && !assets.has(o.assetId)) fail(`“${o.label}”绑定的资产不属于当前项目。`);
    objects.add(o.id);
  }
  const frames = new Set<string>(), times = new Set<string>();
  for (const f of p.frames) {
    record(f, ['id', 'shotId', 'label', 'timeInShot', 'note', 'camera', 'states'], '画格');
    const shot = scene.shots?.find(s => s.id === f.shotId);
    if (!id(f.id) || frames.has(f.id) || !shot || !text(f.label, 160) || !text(f.note, 2000) || !num(f.timeInShot, 0, Number(shot.duration || 0))) fail('画格编号、所属镜头或镜内时间无效；请核对当前分镜。');
    const moment = `${f.shotId}:${f.timeInShot}`;
    if (times.has(moment)) fail('同一镜头的关键帧时间不能重复；请选择已有关键帧修改。');
    times.add(moment);
    record(f.camera, ['position', 'target', 'focalLength'], '机位');
    if (!vector(f.camera.position) || !vector(f.camera.target) || !num(f.camera.focalLength, 8, 300) || f.camera.position.every((v, i) => Math.abs(v - f.camera.target[i]) < .0001)) fail('机位参数无效；摄影机不能与取景目标重合。');
    if (!f.states || Array.isArray(f.states) || typeof f.states !== 'object') fail('画格状态格式无效。');
    for (const [key, state] of Object.entries(f.states)) {
      if (!objects.has(key)) fail('画格引用了不存在的物体。');
      record(state, ['position', 'rotation', 'visible', 'pose', 'leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftElbow', 'rightElbow', 'leftHandRotation', 'rightHandRotation', 'attachment'], '画格物体状态');
      if (state.position && !vector(state.position) || state.rotation && !vector(state.rotation) || state.visible !== undefined && typeof state.visible !== 'boolean' || state.pose !== undefined && !Object.hasOwn(previsPoses, state.pose) || [state.leftArm, state.rightArm].some(v => v && (!vector(v) || v.some(n => Math.abs(n) > Math.PI * 2))) || (state.leftArm || state.rightArm) && !p.objects.some(o => o.id === key && o.kind === 'actor')) fail('画格物体状态无效。');
      const actor = [...p.objects, ...world.objects].find(o => o.id === key)?.kind === 'actor';
      if (['leftHand', 'rightHand', 'leftElbow', 'rightElbow', 'leftHandRotation', 'rightHandRotation'].some(k => {
        const value = state[k as keyof PrevisObjectState]; return value !== undefined && (!actor || !vector(value) || k.endsWith('Rotation') && (value as number[]).some(n => Math.abs(n) > Math.PI * 2));
      })) fail('手部目标、肘向和握持方向只适用于人物。');
      if([state.leftElbow,state.rightElbow].some(v=>v&&Math.hypot(...v)<1e-6))fail('肘部弯曲方向不能为零向量。');
      if (state.attachment !== undefined) {
        if (actor || !p.objects.some(o => o.id === key)) fail('持物切换只适用于本场道具。');
        if (state.attachment !== null) { record(state.attachment, ['objectId', 'socket'], '持物切换'); if (!['leftHand', 'rightHand', 'waist'].includes(state.attachment.socket) || !p.objects.some(o => o.id === state.attachment!.objectId && o.kind === 'actor')) fail('持物切换必须引用本场人物挂点。'); }
      }
    }
    frames.add(f.id);
  }
}
/** Frame order comes from the saved plan; a caller cannot silently reorder a shot sequence. */
export function previsExportSpec(plan: PrevisPlan, scene: Scene, aspectRatio: string, frameIds: string[], columns: number, world: PrevisWorldPlan) {
  if (!Array.isArray(frameIds) || !frameIds.length || frameIds.length > 24 || new Set(frameIds).size !== frameIds.length || !Number.isInteger(columns) || columns < 1 || columns > Math.min(4, frameIds.length)) throw new Error('请选择 1–24 个画格及有效列数。');
  const frames = plan.frames.filter(f => frameIds.includes(f.id));
  if (frames.length !== frameIds.length || frames.some((f, i) => f.id !== frameIds[i])) throw new Error('画格已变化或顺序不符，请重新选择。');
  const shotIds = [...new Set(frames.map(f => f.shotId))];
  const shots = shotIds.map(id => scene.shots?.find(s => s.id === id));
  if (shots.some(s => !s)) throw new Error('画格所属镜头已被删除。');
  const narrativeSeconds = shots.reduce((n, s) => n + Number(s!.duration || 0), 0);
  const rows = Math.ceil(frames.length / columns);
  const sourceHash = previsFrameSourceHash(plan, scene, aspectRatio, frameIds, columns, world);
  return { frameIds, shotIds, columns, rows, narrativeSeconds, sourceHash };
}
/** Independent of grid capacity so a movie can use all authored motion keys. */
export function previsFrameSourceHash(plan: PrevisPlan, scene: Scene, aspectRatio: string, frameIds: string[], columns: number, world: PrevisWorldPlan) {
  const frames = plan.frames.filter(f => frameIds.includes(f.id));
  const shots = [...new Set(frames.map(f => f.shotId))].map(id => scene.shots?.find(s => s.id === id));
  if (shots.some(s => !s)) throw new Error('画格所属镜头已不存在。');
  const location = world.locations.find(l => l.id === plan.locationId);
  if (!location) throw new Error('影视城地点已不存在。');
  const visible = previsVisibleLocations(world, plan), buildings = world.objects.filter(o => visible.some(l => l.id === o.locationId));
  const resources = (world.models || []).filter(m => [...buildings, ...plan.objects].some(o => o.modelId === m.id)).map(m => ({ id: m.id, size: m.size, lods: m.lods }));
  return previsHash({ renderVersion: PREVIS_RENDER_VERSION, ...(resources.length ? { resources } : {}), ...(visible.length > 1 ? { surrounding: visible.map(l => ({ id: l.id, ground: l.ground, groundVisible:l.groundVisible, offset: l.origin.map((v, i) => v - location.origin[i]) })) } : {}), location: { id: location.id, ground: location.ground, ...(location.groundVisible!==undefined?{groundVisible:location.groundVisible}:{}), assetId: location.assetId }, buildings, light: plan.light, objects: plan.objects, frames, columns, aspectRatio,
    shots: shots.map(s => ({ id: s!.id, duration: s!.duration, visualAction: s!.visualAction, blocking: s!.blocking, continuityNote: s!.continuityNote, editingNote: s!.editingNote })) });
}
export function previsExportCurrent(plan: PrevisPlan, item: PrevisExport, scene: Scene, aspectRatio: string, world: PrevisWorldPlan) {
  try { return item.sourceHash === previsExportSpec(plan, scene, aspectRatio, item.frameIds, item.columns, world).sourceHash; } catch { return false; }
}
export function validatePrevisWorld(raw: unknown, project: Project): asserts raw is PrevisWorldPlan {
  const p = raw as PrevisWorldPlan;
  if (!p || p.schemaVersion !== 'previs-world.v1' || typeof p.title !== 'string' || p.title.length > 200 || typeof p.description !== 'string' || p.description.length > 20000 || !Array.isArray(p.locations) || p.locations.length > 200 || !Array.isArray(p.objects) || p.objects.length > 3000 || Object.keys(p).some(k => !['schemaVersion', 'title', 'description', 'locations', 'objects', 'models', 'instances', 'connections', 'worldBrief', 'viewpoints', 'routes'].includes(k))) throw new Error('影视城格式无效：最多 200 个地点、3000 个布景物体。');
  validateSpatialMetadata(p);
  const ids = new Set<string>(), objectIds = new Set<string>();
  const sceneIds = new Set((project.episodes as Episode[] || []).flatMap(e => (e.scenes || []).map(s => s.id)));
  for (const l of p.locations) {
    if (!l || !/^[\w\u3400-\u9fff:.-]{1,160}$/u.test(l.id) || ids.has(l.id) || typeof l.name !== 'string' || !l.name.trim() || l.name.length > 160 || typeof l.description !== 'string' || l.description.length > 4000 || !Array.isArray(l.origin) || l.origin.length !== 3 || l.origin.some(v => !Number.isFinite(v) || Math.abs(v) > 10000) || !Array.isArray(l.ground) || l.ground.length !== 2 || l.ground.some(v => !Number.isFinite(v) || v < 1 || v > 500) || !Array.isArray(l.sourceSceneIds) || l.sourceSceneIds.some(id => !sceneIds.has(id)) || l.assetId && !project.assets?.some(a => a.id === l.assetId) || Object.keys(l).some(k => !['id', 'name', 'description', 'origin', 'ground', 'assetId', 'sourceSceneIds', 'spaceId', 'detailTier', 'usage', 'groundVisible', 'parentId'].includes(k))) throw new Error('地点编号、尺寸、剧本依据或场景资产绑定无效。');
    if (l.spaceId !== undefined && !/^[\w.-]{1,100}$/.test(l.spaceId) || l.detailTier !== undefined && !['shootable','context','horizon'].includes(l.detailTier) || l.usage !== undefined && (typeof l.usage !== 'string' || l.usage.length > 500)) throw new Error('地点空间、拍摄层级或用途无效。');
    if(l.groundVisible!==undefined && typeof l.groundVisible!=='boolean' || l.parentId!==undefined && (!p.locations.some(x=>x.id===l.parentId)||l.parentId===l.id)) throw new Error('地点层级或地面显示无效。');
    let ancestor=l.parentId;const seen=new Set([l.id]);while(ancestor){if(seen.has(ancestor))throw new Error('地点层级存在循环。');seen.add(ancestor);ancestor=p.locations.find(x=>x.id===ancestor)?.parentId;}
    ids.add(l.id);
  }
  for (const o of p.objects) {
    if (!ids.has(o.locationId) || objectIds.has(o.id)) throw new Error('布景物体的地点或编号无效。');
    objectIds.add(o.id);
    const { locationId, ...object } = o;
    // Reuse transform/asset validation, with no authored world objects in this temporary scope.
    validatePrevisPlan({ schemaVersion: 'scene-previs.v1', locationId, light: { position: [5, 9, 4], intensity: 2 }, objects: [object], frames: [] }, { shots: [] } as unknown as Scene, project, { ...p, objects: [] });
  }
}
export function previsReferenceNote(plan: PrevisPlan, item: PrevisExport) {
  return `这是三维白模构图参考，不是最终美术或已验收故事板。${item.columns} 列 × ${item.rows} 行，从左到右、从上到下阅读。` +
    item.frameIds.map((id, i) => { const f = plan.frames.find(f => f.id === id); return f ? `第 ${i + 1} 格：${f.shotId}，镜内 ${f.timeInShot} 秒，${(f.note || f.label).slice(0, 40)}。` : ''; }).join('').slice(0, 1500) +
    '沿用空间关系、站位和机位；人物身份、服装及环境材质遵循各自独立资产参考，不保留灰模材质、人偶外观、网格或拼屏边框。不要求所有切镜动作无缝。';
}

export function previsVisibleLocations(world: PrevisWorldPlan, plan?: PrevisPlan) {
  if (!plan) return world.locations;
  const visible=new Set([plan.locationId,...(plan.includedLocationIds||[])]);let changed=true;
  while(changed){changed=false;const spaces=new Set(world.locations.filter(l=>visible.has(l.id)&&l.spaceId).map(l=>l.spaceId));for(const l of world.locations)if(l.spaceId&&spaces.has(l.spaceId)&&!visible.has(l.id)){visible.add(l.id);changed=true;}for(const c of world.connections||[])if(c.kind==='physical'&&(visible.has(c.from)||visible.has(c.to))){for(const id of [c.from,c.to])if(!visible.has(id)){visible.add(id);changed=true;}}}
  return world.locations.filter(l=>visible.has(l.id));
}
