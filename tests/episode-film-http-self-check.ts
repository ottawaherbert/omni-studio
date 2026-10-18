import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import express from "express";
import type { Scene } from "../src/types/project";
import { buildEpisodeAudioExportItems } from "../src/utils/episodeAudioExport";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a22-film-http-"));
const media = path.join(directory, "media");
fs.mkdirSync(media);
process.env.OMNI_DB_PATH = path.join(directory, "test.db");
const { db, dbHelpers } = await import("../src/server/db");
const { registerAssetRoutes } = await import("../src/server/routes/assetRoutes");
const { registerLegacyProjectRoutes } = await import("../src/server/routes/legacyProjectRoutes");
const { buildSceneVideoExportItems, buildSceneStoryboardExportItems } = await import("../src/hooks/useEpisodeFilmExport");
const modelPath = process.argv.find((arg) => arg.startsWith("--model-result="))?.slice(15);
const seed = modelPath ? JSON.parse(fs.readFileSync(modelPath, "utf8")) : null;
if (seed) assert.ok(seed.status === "succeeded" || seed.source === "subagent_simulation");
const content = seed?.result || { title: "隔离导出验证", prose: "两段观察画面。", shots: [{ visualAction: "第一镜头" }, { visualAction: "第二镜头" }] };
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(media, "red.mp4")]);
ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(media, "blue.mp4")]);
ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", path.join(media, "blue.jpg")]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", path.join(media, "tone.wav")]);
const app = express();
app.use(express.json({ limit: "50mb" }));
registerAssetRoutes(app, { mediaAssetsDir: media });
registerLegacyProjectRoutes(app);
app.use("/media", express.static(media));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
const request = async (url: string, body?: unknown, method = "POST") => {
  const response = await fetch(base + url, body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
};
const scenes = [0, 1].map((index) => ({
  id: `scene-${index}`, title: `验收场景 ${index + 1}`, script: content.prose,
  shots: [{ id: `shot-${index}`, ...content.shots[index], duration: 6, videoUrl: `/media/${index ? "blue" : "red"}.mp4`, imageUrl: "/media/blue.jpg" }],
  audioTracks: [
    { id: `sound-${index}`, type: "bgm", url: "/media/tone.wav", startTime: 0.5, duration: 0.8, volume: index ? 0.5 : 0.25 },
    { id: `muted-${index}`, type: "sfx", url: "/media/tone.wav", startTime: 2, duration: 1, muted: true },
  ],
})) as Scene[];
try {
  await request("/api/projects", { id: "film-test", title: `[验收] ${content.title}`, type: "movie", assets: [], characters: [], episodes: [] });
  await request("/api/projects/film-test/episodes/ep-1", { id: "ep-1", title: content.title, scenes }, "PUT");
  const saved = await request("/api/projects/film-test/episodes/ep-1");
  assert.equal(saved.scenes[0].script, content.prose, "generated content must survive HTTP persistence");
  assert.equal(saved.scenes[0].audioTracks[0].volume, 0.25);
  assert.equal(saved.scenes[0].audioTracks[1].muted, true);
  await request("/api/projects/film-test/episodes/ep-2", { id: "ep-2", title: "第二集", scenes: [{ ...scenes[0], id: "ep2-scene", title: "第二集独立修改", shots: [{ ...scenes[0].shots![0], id: "ep2-shot", visualAction: "第二集不同的镜头内容" }] }] }, "PUT");
  assert.deepEqual(await request("/api/projects/film-test/episodes/ep-1"), saved, "second episode must not alter the first");
  await request("/api/projects", { id: "foreign-project", title: "另一个作品", episodes: [] });
  for (const [url, conflictingBody] of [
    ["/api/projects/foreign-project/episodes/ep-1", { title: "覆盖分集", scenes: [] }],
    ["/api/projects/foreign-project/episodes/foreign-ep", { title: "覆盖场景", scenes: [{ ...scenes[0], title: "不得覆盖" }] }],
    ["/api/projects/film-test/episodes/ep-2", { title: "覆盖镜头", scenes: [{ ...scenes[0], id: "ep2-scene", shots: [{ ...scenes[0].shots![0], visualAction: "不得覆盖" }] }] }],
    ["/api/projects/foreign-project", { title: "整体覆盖", episodes: [{ id: "ep-1", title: "不得覆盖", scenes: [] }] }],
  ] as const) {
    const rejected = await fetch(base + url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(conflictingBody) });
    assert.equal(rejected.status, 409, "colliding IDs must reject atomically rather than overwrite another content owner");
    assert.deepEqual(await request("/api/projects/film-test/episodes/ep-1"), saved);
  }
  const audioTracks = buildEpisodeAudioExportItems(saved.scenes);
  assert.deepEqual(audioTracks.map((track) => track.startTime), [0.5, 6.5]);
  assert.equal(audioTracks.length, 2, "muted tracks must not enter the render");
  const linked = [{ ...scenes[0], audioTracks: [{ ...scenes[0].audioTracks![0], url: "", linkedAssetId: "global-tone" }] }];
  assert.equal(buildEpisodeAudioExportItems(linked, () => "/media/tone.wav")[0].url, "/media/tone.wav");
  assert.throws(() => buildEpisodeAudioExportItems(linked));
  const body = { projectId: "film-test", shots: saved.scenes.flatMap(buildSceneVideoExportItems), audioTracks };
  const invalid = await fetch(base + "/api/assets/compose-episode-film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, audioTracks: [{ ...audioTracks[0], duration: -1 }] }) });
  assert.equal(invalid.status, 400, "invalid timing must fail without producing a film");
  const rendered = await request("/api/assets/compose-episode-film", body);
  const film = Buffer.from(await (await fetch(base + rendered.url)).arrayBuffer());
  const filmPath = path.join(directory, "film.mp4");
  fs.writeFileSync(filmPath, film);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filmPath], { encoding: "utf8" }));
  assert.ok(Math.abs(Number(probe.format.duration) - 12) < 0.1);
  assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio"));
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", filmPath, "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 });
  const rms = (start: number, end: number) => {
    let sum = 0; let count = 0;
    for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++) { const n = pcm.readInt16LE(i * 2) / 32768; sum += n * n; count++; }
    return Math.sqrt(sum / count);
  };
  const firstRms = rms(0.7, 1.1); const secondRms = rms(6.7, 7.1);
  assert.ok(firstRms > 0.01 && secondRms / firstRms > 1.8 && secondRms / firstRms < 2.2, "saved volume must affect real output samples");
  for (const [start, end] of [[0.1, 0.3], [1.6, 1.8], [2.2, 2.7], [6.1, 6.3]]) assert.ok(rms(start, end) < 0.001, `unexpected audio at ${start}s`);
  for (const [time, channel] of [[2, 0], [8, 2]]) {
    const pixel = execFileSync("ffmpeg", ["-v", "error", "-ss", String(time), "-i", filmPath, "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
    assert.ok(pixel[channel] > 180, "scene order and rendered picture must match the timeline");
  }
  const storyboard = await request("/api/assets/compose-episode-film", { ...body, shots: saved.scenes.flatMap(buildSceneStoryboardExportItems).map(({ shotIds: _ids, ...item }: { shotIds: string[] }) => item) });
  assert.ok(storyboard.url && storyboard.url !== rendered.url, "retry and alternate export must produce distinct usable artifacts");
  assert.deepEqual(dbHelpers.getEpisodeById("film-test", "ep-1"), saved, "export must not mutate source data");
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify({ source: seed?.source || "deterministic_fixture", modelId: seed?.modelId, title: content.title, result: content, filmPath, duration: probe.format.duration, firstRms, secondRms, passed: true }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, filmPath, source: seed?.source || "deterministic_fixture", assertions: "HTTP write/reload, second episode isolation, persisted volume/mute, scene offsets, audio waveform, picture order, failure recovery, video and image exports" }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  if (!process.argv.includes("--keep")) fs.rmSync(directory, { recursive: true, force: true });
}
