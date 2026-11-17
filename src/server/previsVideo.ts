import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db, dbHelpers } from './db';
import { readPrevisDocument, previsSceneKey } from './previsStore';
import { PREVIS_RENDER_VERSION, previsAspect, previsFrameSourceHash, previsHash, validatePrevisPlan, type PrevisTimeline, type PrevisVideo, type PrevisWorld, type ScenePrevis } from '../../packages/domain/src/previs';
import type { Project, Episode } from '../types/project';
import { ProductionQuality } from './productionQuality';
import { GenerationStore } from './generation/store';
const run = promisify(execFile);
db.exec('CREATE TABLE IF NOT EXISTS previs_videos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL)');
export function readPrevisVideo(id: string): PrevisVideo {
  const row = db.prepare('SELECT data FROM previs_videos WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) throw new Error('找不到白模视频任务。'); return JSON.parse(row.data);
}
export function listPrevisVideos(projectId: string): PrevisVideo[] {
  return (db.prepare('SELECT data FROM previs_videos WHERE project_id = ? ORDER BY rowid DESC').all(projectId) as { data: string }[]).map(r => JSON.parse(r.data));
}
function save(video: PrevisVideo) { video.updatedAt = Date.now(); db.prepare('INSERT INTO previs_videos(id, project_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(video.id, video.projectId, JSON.stringify(video)); return video; }
export function buildPrevisTimeline(projectId: string, scope: PrevisVideo['scope'], episodeId?: string, sceneId?: string, shotIds?: string[]): PrevisTimeline {
  const project = dbHelpers.getProjectById(projectId) as Project;
  const world = readPrevisDocument<PrevisWorld>(projectId, 'world');
  if (!project || !world) throw new Error('请先建立本剧影视城。');
  if (!['scene', 'episode', 'project'].includes(scope) || scope !== 'project' && !episodeId || scope === 'scene' && !sceneId) throw new Error('请选择本场、本集或全剧范围。');
  if (shotIds && (scope !== 'scene' || !Array.isArray(shotIds) || !shotIds.length || new Set(shotIds).size !== shotIds.length)) throw new Error('镜头范围只适用于指定场次。');
  const shots: PrevisTimeline['shots'] = [], sources: unknown[] = [], missing: string[] = []; let duration = 0;
  for (const episode of project.episodes as Episode[] || []) {
    if (scope !== 'project' && episode.id !== episodeId) continue;
    for (const scene of episode.scenes || []) {
      if (scope === 'scene' && scene.id !== sceneId) continue;
      const doc = readPrevisDocument<ScenePrevis>(projectId, previsSceneKey(episode.id, scene.id));
      if (!doc || !scene.shots?.length) { missing.push(`${episode.title} / ${scene.title}：尚无镜头或拍摄方案`); continue; }
      validatePrevisPlan(doc.plan, scene, project, world.plan);
      for (const shot of scene.shots) {
        if (shotIds && !shotIds.includes(shot.id)) continue;
        const keys = doc.plan.frames.filter(f => f.shotId === shot.id), seconds = Number(shot.duration || 0);
        if (!keys.length || !Number.isFinite(seconds) || seconds <= 0) { missing.push(`${scene.title} / ${shot.id}：缺少机位或有效时长`); continue; }
        const sourceHash = previsFrameSourceHash(doc.plan, scene, project.aspectRatio, keys.map(f => f.id), 1, world.plan);
        sources.push({ sceneId: scene.id, shotId: shot.id, duration: seconds, sourceHash });
        shots.push({ sceneId: scene.id, episodeId: episode.id, shotId: shot.id, label: `${episode.title} / ${scene.title} / 镜头 ${scene.shots.indexOf(shot) + 1}`, start: duration, duration: seconds, plan: doc.plan }); duration += seconds;
      }
    }
  }
  if (missing.length) throw new Error(`以下内容尚未排演，不能跳过它们冒充完整预演：${missing.slice(0, 12).join('；')}${missing.length > 12 ? `；另有 ${missing.length - 12} 项` : ''}`);
  if (!shots.length) throw new Error('所选范围没有可拍摄的镜头。');
  if (shotIds && (shots.length !== shotIds.length || shots.some((s, i) => s.shotId !== shotIds[i]))) throw new Error('所选镜头已变化或顺序不符。');
  return { renderVersion: PREVIS_RENDER_VERSION, world: world.plan, aspectRatio: project.aspectRatio, shots, duration, sourceHash: previsHash({ aspectRatio: project.aspectRatio, sources }) };
}
export function previsVideoCurrent(video: PrevisVideo) {
  try { return buildPrevisTimeline(video.projectId, video.scope, video.episodeId, video.sceneId, video.shotIds).sourceHash === video.timeline.sourceHash; } catch { return false; }
}
const writing = new Set<string>(), encoding = new Set<string>();
export class PrevisVideoService {
  constructor(readonly root: string) {}
  private folder(id: string) { if (!/^previs-video-[\w-]+$/.test(id)) throw new Error('视频编号无效。'); return path.join(this.root, 'previs', id); }
  async create(projectId: string, input: { scope: PrevisVideo['scope']; episodeId?: string; sceneId?: string; shotIds?: string[]; fps?: number }) {
    const fps = input.fps ?? 12; if (![12, 24].includes(fps)) throw new Error('白模预演支持 12 或 24 帧每秒。');
    const timeline = buildPrevisTimeline(projectId, input.scope, input.episodeId, input.sceneId, input.shotIds), aspect = previsAspect(timeline.aspectRatio);
    const quality = new ProductionQuality(new GenerationStore(db),this.root);
    const scenes = new Map(timeline.shots.map(shot=>[JSON.stringify([shot.episodeId,shot.sceneId]),shot]));
    for(const shot of scenes.values())quality.require('shot_plan',{projectId,episodeId:shot.episodeId,sceneId:shot.sceneId});
    const width = Math.round((aspect >= 1 ? 960 : 960 * aspect) / 2) * 2, height = Math.round(width / aspect / 2) * 2;
    const id = `previs-video-${randomUUID()}`, now = Date.now(); await fs.mkdir(this.folder(id), { recursive: true });
    return save({ id, projectId, scope: input.scope, episodeId: input.episodeId, sceneId: input.sceneId, shotIds: input.shotIds, timeline, fps, width, height, totalFrames: Math.ceil(timeline.duration * fps), receivedFrames: 0, status: 'rendering', createdAt: now, updatedAt: now });
  }
  async frames(id: string, start: number, images: string[]) {
    if (writing.has(id) || encoding.has(id)) throw new Error('上批画面仍在处理，请稍后继续。');
    writing.add(id);
    try {
      const video = readPrevisVideo(id);
      if(video.timeline.renderVersion!==PREVIS_RENDER_VERSION)throw new Error('该预演使用旧渲染版本，原任务和帧保留；请创建新任务，避免混用新旧人偶画面。');
      if (video.status !== 'rendering' || !Number.isInteger(start) || start < 0 || start > video.receivedFrames || !Array.isArray(images) || !images.length || images.length > 12 || start + images.length > video.totalFrames) throw new Error('视频状态或帧范围无效，请重新读取进度。');
      if (start + images.length <= video.receivedFrames) return video;
      if (start !== video.receivedFrames) throw new Error('续传起点不一致，请读取已保存进度。');
      for (let i = 0; i < images.length; i++) {
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(images[i]); if (!match || match[1].length > 3 * 1024 * 1024) throw new Error('请提交有效的本机 JPEG 预演帧。');
        const bytes = Buffer.from(match[1], 'base64'), metadata = await sharp(bytes).metadata();
        if (metadata.format !== 'jpeg' || metadata.width !== video.width || metadata.height !== video.height) throw new Error('预演帧的实际尺寸与任务不一致。');
        await fs.writeFile(path.join(this.folder(id), `${String(start + i).padStart(8, '0')}.jpg`), bytes);
      }
      if (readPrevisVideo(id).status === 'cancelled') throw new Error('任务已取消。');
      return save({ ...video, receivedFrames: start + images.length });
    } finally { writing.delete(id); }
  }
  async finish(id: string) {
    if (encoding.has(id) || writing.has(id)) throw new Error('任务正在处理，请读取进度。');
    let video = readPrevisVideo(id); if (video.status === 'complete') return video;
    if (video.status === 'cancelled' || video.receivedFrames !== video.totalFrames) throw new Error('画面未全部渲染，不能导出不完整视频。');
    encoding.add(id); save({ ...video, status: 'encoding', error: undefined });
    try {
      const output = path.join(this.folder(id), 'previs.mp4');
      await run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(video.fps), '-i', path.join(this.folder(id), '%08d.jpg'), '-t', String(video.timeline.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { timeout: 60 * 60 * 1000, maxBuffer: 262144 });
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', output]);
      const metadata = JSON.parse(stdout);
      if (Math.abs(Number(metadata.format?.duration) - video.timeline.duration) > 1 / video.fps + .05) throw new Error('导出实际时长与预演时间线不符。');
      video = save({ ...video, status: 'complete', error: undefined, videoUrl: `/media/previs/${id}/previs.mp4` });
      // Only reproducible encoding intermediates are removed; MP4 and its snapshot stay intact.
      for (const name of await fs.readdir(this.folder(id)).catch(() => [])) if (/^\d{8}\.jpg$/.test(name)) await fs.unlink(path.join(this.folder(id), name)).catch(() => {});
      return video;
    } catch (e: any) { save({ ...video, status: 'failed', error: e.message }); throw e; }
    finally { encoding.delete(id); }
  }
  cancel(id: string) { if (encoding.has(id) || writing.has(id)) throw new Error('当前帧批次或编码正在完成，请稍后取消。'); const video = readPrevisVideo(id); if (video.status === 'complete') throw new Error('已完成视频会保留在导出历史中。'); return save({ ...video, status: 'cancelled' }); }
}
