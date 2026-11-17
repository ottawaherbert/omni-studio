import * as THREE from 'three';
import { SpatialRuntime } from './spatialRuntime';
import { previsCamera } from './previsRenderer';
import { samplePrevisFrame, PREVIS_RENDER_VERSION, type PrevisContactReport, type PrevisContactIssue, type PrevisTimeline, type PrevisWorldPlan } from '../../clients/previsClient';

export interface ContactSnapshot { world: PrevisWorldPlan; timeline?: PrevisTimeline; sourceHash: string; fps: number; objectIds?: string[] }
/** Same runtime and decoded geometry as the editor/export, not approximate server-side boxes. */
export async function inspectSnapshot(snapshot: ContactSnapshot, progress?: (frames: number) => void): Promise<PrevisContactReport> {
  const report: PrevisContactReport = { renderVersion: PREVIS_RENDER_VERSION, sourceHash: snapshot.sourceHash, fps: snapshot.fps, sampledFrames: 0, checkedObjectIds: [], issues: [], passed: false, complete: true,
    limitations: ['毫米级数值容差用于排除表面接触；不代替实际图像和动作验收。', '检查实际加载LOD与可见物体的三角网格；结构装配相交须按用途复核。', '按速度/尺寸自适应采样，最高240Hz；并非任意速度下的数学连续碰撞证明。', '无刚体物理、自动寻路或手指模拟。'] };
  const aggregated = new Map<string, PrevisContactIssue>();
  const checked = new Set<string>();
  const record = (issue: PrevisContactIssue) => {
    const key = [issue.sceneId, issue.shotId, issue.objectId, issue.otherId, issue.part, issue.kind].join('|'), old = aggregated.get(key);
    if (old) { if(old.endTime!==issue.time)old.samples=(old.samples||1)+1;old.endTime = issue.time; old.distance = Math.max(old.distance || 0, issue.distance || 0); }
    else { issue.samples = 1; issue.endTime = issue.time; aggregated.set(key, issue); }
  };
  const shots = snapshot.timeline?.shots;
  if (!shots) {
    const runtime = new SpatialRuntime(snapshot.world);
    try { await runtime.prepare(undefined, true); runtime.update(); runtime.inspectionTargets(snapshot.objectIds).forEach(id=>checked.add(id));for (const issue of runtime.inspect(snapshot.objectIds)) record(issue); report.sampledFrames = 1; }
    finally { runtime.dispose(); }
  } else {
    let runtime: SpatialRuntime | undefined, activePlan: unknown;
    try {
      for (const shot of shots) {
        if (activePlan !== shot.plan) { runtime?.dispose(); runtime = new SpatialRuntime(snapshot.world, shot.plan); activePlan = shot.plan; }
        const keys = shot.plan.frames.filter(k => k.shotId === shot.shotId).sort((a, b) => a.timeInShot - b.timeInShot);
        await runtime!.prepareCapture(keys.map(k => previsCamera(k, 16 / 9)));
        for(let i=1;i<keys.length;i++)for(const object of shot.plan.objects.filter(o=>o.kind!=='actor')){
          const a=keys[i-1],b=keys[i],binding=(key:typeof a)=>key.states[object.id]?.attachment===undefined?object.attachment:key.states[object.id].attachment;
          if(JSON.stringify(binding(a)||null)===JSON.stringify(binding(b)||null))continue;
          runtime!.update(samplePrevisFrame(shot.plan,shot.shotId,b.timeInShot-Math.min(.0001,(b.timeInShot-a.timeInShot)/100),snapshot.world));
          const before=runtime!.object(object.id)!.matrixWorld.clone();
          runtime!.update(samplePrevisFrame(shot.plan,shot.shotId,b.timeInShot,snapshot.world));
          const after=runtime!.object(object.id)!.matrixWorld.clone();
          const delta=new THREE.Vector3().setFromMatrixPosition(before).distanceTo(new THREE.Vector3().setFromMatrixPosition(after));
          const turn=new THREE.Quaternion().setFromRotationMatrix(before).angleTo(new THREE.Quaternion().setFromRotationMatrix(after));
          if(delta>.005||turn>.06)record({kind:'transition',severity:'error',objectId:object.id,part:'attachment',message:`${object.label}拿放瞬间跳变${delta.toFixed(3)}米/${(turn*180/Math.PI).toFixed(1)}度；请换算挂点坐标保持连续`,distance:delta,shotId:shot.shotId,sceneId:shot.sceneId,time:b.timeInShot});
        }
        const times = new Set<number>([0, shot.duration, ...keys.map(k => k.timeInShot)]);
        // Subsample by actual authored speed and size, so a fast prop cannot skip a thin wall between video frames.
        let rate = snapshot.fps;
        for (let i = 1; i < keys.length; i++) {
          const a = keys[i - 1], b = keys[i], seconds = b.timeInShot - a.timeInShot;
          for (const o of [...snapshot.world.objects, ...shot.plan.objects]) {
            const x = a.states[o.id], y = b.states[o.id]; if (!x && !y) continue;
            const p = x?.position || o.position, q = y?.position || o.position;
            const binding=(state:typeof x)=>state?.attachment===undefined?o.attachment:state.attachment;
            const sameSpace=JSON.stringify(binding(x)||null)===JSON.stringify(binding(y)||null);
            const travel = sameSpace?Math.hypot(...p.map((n, j) => n - q[j])):0;
            const r = x?.rotation || o.rotation, s = y?.rotation || o.rotation;
            const turn = sameSpace?Math.hypot(...r.map((n, j) => n - s[j])) * Math.max(...o.size) / 2:0;
            rate = Math.max(rate, Math.ceil((travel + turn) / seconds / Math.min(.02, Math.min(...o.size) / 4)));
            if (o.kind === 'actor') {
              if (['walk','run'].includes(x?.pose||o.pose)||['walk','run'].includes(y?.pose||o.pose)||x?.pose!==y?.pose) rate=Math.max(rate,60);
              for(const key of ['leftHand','rightHand','leftElbow','rightElbow','leftArm','rightArm'] as const)if(x?.[key]&&y?.[key])rate=Math.max(rate,Math.ceil(Math.hypot(...x[key]!.map((n,j)=>n-y[key]![j]))/seconds/.01));
            }
          }
        }
        if (rate > 240) { report.complete = false; report.limitations.push(`${shot.shotId}需要${rate}Hz检查，超过240Hz上限；必须减慢动作、拆段或另做连续碰撞验证，不能判通过。`); }
        rate = Math.min(240, rate);
        for (let i = 0; i <= Math.ceil(shot.duration * rate); i++) times.add(Math.min(shot.duration, i / rate));
        if (times.size > 100000) throw new Error('本镜检查超过10万采样点，请分镜或分场检查，不能省略中途动作。');
        for (const time of [...times].sort((a, b) => a - b)) {
          runtime!.update(samplePrevisFrame(shot.plan, shot.shotId, time, snapshot.world), time);
          runtime!.inspectionTargets(snapshot.objectIds).forEach(id=>checked.add(id));
          for (const issue of runtime!.inspect(snapshot.objectIds)) record({ ...issue, sceneId: shot.sceneId, shotId: shot.shotId, time });
          report.sampledFrames++;
          if (report.sampledFrames % 24 === 0) { progress?.(report.sampledFrames); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
        }
      }
    } finally { runtime?.dispose(); }
  }
  report.checkedObjectIds = [...checked];
  if(snapshot.objectIds?.some(id=>!checked.has(id))){report.complete=false;report.limitations.push('指定物体在本范围内未实际加载/可见，不能声称已检查。');}
  if(!checked.size)report.limitations.push('本范围没有可见的检查目标；未认证固定布景之间的装配与支撑。');
  report.issues = [...aggregated.values()]; report.passed = report.complete && report.issues.length === 0;
  return report;
}
