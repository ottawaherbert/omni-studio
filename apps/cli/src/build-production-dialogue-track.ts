import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type DialogueCue = { start: number; speaker: string; voice: string; text: string };
type CueSheet = { projectId: string; language?: string; cues: DialogueCue[] };

const values = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

const inputPath = path.resolve(values.get("input") || "");
const outputDir = path.resolve(values.get("outputDir") || "");
const totalDuration = Number(values.get("duration") || 0);
const speakingRate = Math.max(80, Math.min(260, Number(values.get("rate") || 175)));
if (!fs.existsSync(inputPath)) throw new Error("Pass an existing --input=<dialogue-cues.json>.");
if (!outputDir) throw new Error("Pass --outputDir=<directory>.");
if (!Number.isFinite(totalDuration) || totalDuration <= 0) throw new Error("Pass --duration=<seconds>.");

const sheet = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CueSheet;
const cues = [...sheet.cues].sort((left, right) => left.start - right.start);
fs.mkdirSync(outputDir, { recursive: true });
const clipsDir = path.join(outputDir, "dialogue-clips");
fs.mkdirSync(clipsDir, { recursive: true });

const durationOf = (filePath: string) => {
  const duration = Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { encoding: "utf8" }).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Audio file has no measurable duration: ${filePath}`);
  return duration;
};

const usableAudio = (filePath: string) => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 512) return false;
  try { return durationOf(filePath) > 0.1; } catch { return false; }
};

const formatSrtTime = (seconds: number) => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

const rendered = cues.map((cue, index) => {
  const stem = `${String(index + 1).padStart(3, "0")}-${cue.speaker.replace(/[^\p{L}\p{N}_-]+/gu, "-")}-r${speakingRate}`;
  const aiffPath = path.join(clipsDir, `${stem}.aiff`);
  const wavPath = path.join(clipsDir, `${stem}.wav`);
  if (!usableAudio(aiffPath)) {
    execFileSync("say", ["-v", cue.voice, "-r", String(speakingRate), "-o", aiffPath, cue.text], { stdio: "ignore" });
  }
  if (!usableAudio(wavPath)) {
    execFileSync("ffmpeg", [
      "-y", "-i", aiffPath, "-af", "highpass=f=90,lowpass=f=9000,loudnorm=I=-18:TP=-2:LRA=7",
      "-ar", "48000", "-ac", "1", wavPath,
    ], { stdio: "ignore" });
  }
  return { ...cue, wavPath, duration: durationOf(wavPath) };
});

for (let index = 0; index < rendered.length - 1; index += 1) {
  const current = rendered[index];
  const next = rendered[index + 1];
  if (current.start + current.duration > next.start + 0.5) {
    throw new Error(`Dialogue overlap: ${current.speaker} at ${current.start}s runs ${current.duration.toFixed(2)}s into the next cue.`);
  }
}

const srt = rendered.map((cue, index) => {
  const nextStart = rendered[index + 1]?.start ?? totalDuration;
  const end = Math.min(nextStart - 0.2, cue.start + Math.max(2.2, cue.duration + 0.35));
  return `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(end)}\n${cue.speaker}：${cue.text}\n`;
}).join("\n");
const srtPath = path.join(outputDir, "dialogue.zh-CN.srt");
fs.writeFileSync(srtPath, srt);

const trackPath = path.join(outputDir, "dialogue-track.m4a");
const ffmpegArgs = ["-y", "-f", "lavfi", "-t", String(totalDuration), "-i", "anullsrc=r=48000:cl=stereo"];
for (const cue of rendered) ffmpegArgs.push("-i", cue.wavPath);
const filters = rendered.map((cue, index) => {
  const delay = Math.round(cue.start * 1000);
  return `[${index + 1}:a]adelay=${delay}|${delay},pan=stereo|c0=c0|c1=c0[v${index}]`;
});
filters.push(`[0:a]${rendered.map((_, index) => `[v${index}]`).join("")}amix=inputs=${rendered.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[out]`);
ffmpegArgs.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(totalDuration), "-c:a", "aac", "-b:a", "192k", trackPath);
execFileSync("ffmpeg", ffmpegArgs, { stdio: "ignore" });

console.log(JSON.stringify({
  projectId: sheet.projectId,
  cues: rendered.length,
  durationSeconds: durationOf(trackPath),
  subtitlePath: srtPath,
  dialogueTrackPath: trackPath,
}, null, 2));
