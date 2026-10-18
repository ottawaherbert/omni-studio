import { filmTransition, type FilmTransition } from '../../../packages/domain/src/filmTimeline';
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const mediaFileHasAudio = async (filePath: string) => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath,
  ], { timeout: 30_000, maxBuffer: 64 * 1024 });
  return stdout.trim().length > 0;
};

export interface EpisodeFilmShotBuffer {
  media: Buffer;
  kind: "video" | "image";
  durationSeconds: number;
  sourceStartSeconds?: number;
  transition?: FilmTransition;
}

const withTempDir = async <T,>(operation: (directory: string) => Promise<T>) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omni-film-"));
  try {
    return await operation(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

export const composeEpisodeFilm = ({
  shots,
  aspectRatio,
  masterAudio,
  subtitles,
  audioTracks = [],
  resolution = 480,
  frameRate = 24,
}: {
  shots: EpisodeFilmShotBuffer[];
  aspectRatio: "16:9" | "9:16";
  masterAudio?: Buffer;
  subtitles?: Buffer;
  audioTracks?: { media: Buffer; startTime: number; duration: number; volume?: number; sourceStartSeconds?: number }[];
  resolution?: 480 | 720 | 1080 | 2160;
  frameRate?: 24 | 25 | 30 | 60;
}) => withTempDir(async (directory) => {
  if (!shots.length) throw new Error("没有可导出的镜头。");
  if (![480, 720, 1080, 2160].includes(resolution) || ![24, 25, 30, 60].includes(frameRate)) throw new Error("导出分辨率或帧率无效。");
  for (const shot of shots) {
    if (![shot.durationSeconds, shot.sourceStartSeconds ?? 0].every(Number.isFinite) || (shot.sourceStartSeconds ?? 0) < 0 || ![undefined, "none", "fade", "black"].includes(shot.transition) || shot.durationSeconds <= 0) throw new Error("镜头时长无效。");
  }
  for (const track of audioTracks) {
    if (![track.startTime, track.duration, track.volume ?? 1, track.sourceStartSeconds ?? 0].every(Number.isFinite)
      || (track.sourceStartSeconds ?? 0) < 0 || track.startTime < 0 || track.duration <= 0 || (track.volume ?? 1) < 0 || (track.volume ?? 1) > 1) throw new Error("音轨时间或音量无效。");
  }
  const landscapeWidth = resolution === 480 ? 854 : Math.round(resolution * 16 / 9 / 2) * 2;
  const [width, height] = aspectRatio === "9:16" ? [resolution, landscapeWidth] : [landscapeWidth, resolution];
  // Round cumulative boundaries, not each clip independently: many fractional
  // edits must not accumulate frame drift against dialogue and scene offsets.
  let desiredSeconds = 0;
  let previousEndFrame = 0;
  const renderShots = shots.map(shot => {
    desiredSeconds += shot.durationSeconds;
    const endFrame = Math.max(previousEndFrame + 1, Math.round(desiredSeconds * frameRate));
    const durationSeconds = (endFrame - previousEndFrame) / frameRate;
    previousEndFrame = endFrame;
    return { ...shot, durationSeconds };
  });
  const normalizedPaths: string[] = [];
  let totalDurationSeconds = 0;

  for (let index = 0; index < shots.length; index += 1) {
    const shot = renderShots[index];
    const inputPath = path.join(directory, `input-${index}.${shot.kind === "image" ? "jpg" : "mp4"}`);
    const outputPath = path.join(directory, `shot-${index}.mp4`);
    await fs.writeFile(inputPath, shot.media);
    totalDurationSeconds += shot.durationSeconds;
    const hasAudio = shot.kind === "video" && await mediaFileHasAudio(inputPath);
    const normalizeArgs = ["-hide_banner", "-loglevel", "error", "-y"];
    if (shot.kind === "image") normalizeArgs.push("-loop", "1");
    if (shot.kind === "video" && shot.sourceStartSeconds) normalizeArgs.push("-ss", String(shot.sourceStartSeconds));
    normalizeArgs.push("-i", inputPath);
    if (!hasAudio) normalizeArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    let videoFilter = shot.kind === "image"
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${frameRate}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${frameRate},tpad=stop_mode=clone:stop_duration=${shot.durationSeconds}`;
    const incoming = filmTransition(shot.transition, shot.durationSeconds);
    const outgoing = filmTransition(renderShots[index + 1]?.transition, shot.durationSeconds);
    if (incoming.seconds) videoFilter += `,fade=t=in:st=${incoming.hold}:d=${incoming.seconds - incoming.hold}`;
    if (outgoing.seconds) videoFilter += `,fade=t=out:st=${shot.durationSeconds - outgoing.seconds}:d=${outgoing.seconds - outgoing.hold}`;
    normalizeArgs.push(
      "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0",
      "-vf", videoFilter,
      "-t", String(shot.durationSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-af", "apad", outputPath,
    );
    await execFileAsync("ffmpeg", normalizeArgs, { timeout: 240_000, maxBuffer: 2 * 1024 * 1024 });
    normalizedPaths.push(outputPath);
  }

  const concatPath = path.join(directory, "shots.txt");
  const timelinePath = path.join(directory, "timeline.mp4");
  await fs.writeFile(concatPath, normalizedPaths.map((filePath) => `file '${filePath}'`).join("\n"));
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
    "-c", "copy", timelinePath,
  ], { timeout: 240_000, maxBuffer: 2 * 1024 * 1024 });

  const audioPath = path.join(directory, "master-audio");
  const subtitlePath = path.join(directory, "subtitles.srt");
  const outputPath = path.join(directory, "episode-film.mp4");
  if (masterAudio) await fs.writeFile(audioPath, masterAudio);
  if (subtitles) await fs.writeFile(subtitlePath, subtitles);

  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", timelinePath];
  if (masterAudio) args.push("-i", audioPath);
  if (subtitles) args.push("-i", subtitlePath);
  const subtitleInputIndex = masterAudio ? 2 : 1;
  const firstTrackInputIndex = 1 + Number(Boolean(masterAudio)) + Number(Boolean(subtitles));
  for (let index = 0; index < audioTracks.length; index += 1) {
    const trackPath = path.join(directory, `audio-${index}`);
    await fs.writeFile(trackPath, audioTracks[index].media);
    args.push("-i", trackPath);
  }
  const baseAudioIndex = masterAudio ? 1 : 0;
  if (audioTracks.length) {
    const filters = [`[${baseAudioIndex}:a:0]apad,atrim=duration=${totalDurationSeconds},asetpts=PTS-STARTPTS[base]`];
    audioTracks.forEach((track, index) => {
      filters.push(`[${firstTrackInputIndex + index}:a:0]atrim=start=${track.sourceStartSeconds || 0}:duration=${track.duration},asetpts=PTS-STARTPTS,volume=${track.volume ?? 1},adelay=${Math.round(track.startTime * 1000)}:all=1[track${index}]`);
    });
    filters.push(`[base]${audioTracks.map((_track, index) => `[track${index}]`).join("")}amix=inputs=${audioTracks.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1[mixed]`);
    args.push("-filter_complex", filters.join(";"));
  }
  args.push(
    "-map", "0:v:0", "-map", audioTracks.length ? "[mixed]" : `${baseAudioIndex}:a:0`,
    ...(subtitles ? ["-map", `${subtitleInputIndex}:0`] : []),
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", ...(!audioTracks.length ? ["-af", "apad"] : []), "-t", String(totalDurationSeconds),
    ...(subtitles ? ["-c:s", "mov_text", "-metadata:s:s:0", "language=chi"] : []),
    "-movflags", "+faststart", outputPath,
  );
  await execFileAsync("ffmpeg", args, { cwd: directory, timeout: 900_000, maxBuffer: 4 * 1024 * 1024 });
  return fs.readFile(outputPath);
});
