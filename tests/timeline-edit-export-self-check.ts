import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeEpisodeFilm } from '../src/server/media/episodeFilmComposition';
import { splitTimelineShot } from '../src/utils/timelineEditing';
import { buildSceneVideoExportItems } from '../src/hooks/useEpisodeFilmExport';
import { buildEpisodeAudioExportItems } from '../src/utils/episodeAudioExport';
import type { Scene } from '../src/types/project';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a22-edit-export-'));
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });
try {
  const source = path.join(dir, 'source.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=25:d=1', '-f', 'lavfi', '-i', 'color=lime:s=320x180:r=25:d=1', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=25:d=1', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  const sound = path.join(dir, 'sound.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1:sample_rate=48000', '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', sound]);
  const shots = splitTimelineShot({ id: 'a', duration: 3, videoUrl: source }, 1, 'b');
  shots[1].transition = 'black';
  const scene = { shots, audioTracks: [{ id: 'voice', type: 'dialogue', url: sound, startTime: 0.4, duration: 0.8, sourceStartSeconds: 1 }] } as Scene;
  const output = await composeEpisodeFilm({
    shots: buildSceneVideoExportItems(scene).map(item => ({ ...item, media: fs.readFileSync(source), kind: 'video' })),
    audioTracks: buildEpisodeAudioExportItems([scene]).map(item => ({ ...item, media: fs.readFileSync(sound) })),
    aspectRatio: '16:9', resolution: 1080, frameRate: 25,
  });
  const film = path.join(dir, 'film.mp4'); fs.writeFileSync(film, output);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', film], { encoding: 'utf8' }));
  const video = probe.streams.find((s: any) => s.codec_type === 'video');
  assert.deepEqual([video.width, video.height, video.r_frame_rate], [1920, 1080, '25/1']);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1, 'transitions must not shift the edit duration');
  const pixels: Record<string, number[]> = {};
  for (const [time, channel] of [[0.5, 0], [1.5, 1], [2.5, 2]]) {
    const pixel = ffmpeg(['-ss', String(time), '-i', film, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    pixels[time] = [...pixel];
    assert.ok(pixel[channel] > 200 && pixel[(channel + 1) % 3] < 30, `wrong source segment at ${time}s: ${pixel}`);
  }
  const boundary = ffmpeg(['-ss', '1.04', '-i', film, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  assert.ok([...boundary].every(value => value < 20), 'black transition must exist in rendered frames');
  const pcm = ffmpeg(['-i', film, '-f', 's16le', '-ac', '1', '-ar', '48000', 'pipe:1']);
  let crossings = 0;
  for (let i = 28801; i < 43200; i++) if (pcm.readInt16LE((i - 1) * 2) <= 0 && pcm.readInt16LE(i * 2) > 0) crossings++;
  assert.ok(crossings > 255 && crossings < 273, `expected 880 Hz from source in-point, got ${crossings / 0.3} Hz`);
  const high = await composeEpisodeFilm({ shots: [{ media: fs.readFileSync(source), kind: 'video', sourceStartSeconds: 2, durationSeconds: 0.2 }], aspectRatio: '9:16', resolution: 2160, frameRate: 30 });
  const highPath = path.join(dir, 'vertical.mp4'); fs.writeFileSync(highPath, high);
  const highProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', highPath], { encoding: 'utf8' }));
  assert.deepEqual([highProbe.streams[0].width, highProbe.streams[0].height], [2160, 3840]);
  console.log(JSON.stringify({ passed: true, directory: dir, dimensions: [video.width, video.height], frameRate: video.r_frame_rate, duration: probe.format.duration, pixels, boundary: [...boundary], audioHz: crossings / 0.3, vertical4k: true }));
} finally {
  if (!process.argv.includes('--keep')) fs.rmSync(dir, { recursive: true, force: true });
}
