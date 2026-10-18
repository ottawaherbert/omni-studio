import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { UploadedVideoMetadata } from "../../../packages/domain/src/asset";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const execFileAsync = promisify(execFile);

const mediaFileHasAudio = async (filePath: string) => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath,
  ], { timeout: 30_000, maxBuffer: 64 * 1024 });
  return stdout.trim().length > 0;
};

export const readLocalMediaSource = async ({
  sourceUrl,
  mediaAssetsDir,
  maximumBytes = MAX_VIDEO_BYTES,
}: {
  sourceUrl: string;
  mediaAssetsDir: string;
  maximumBytes?: number;
}) => {
  if (!sourceUrl.startsWith("/media/")) throw new Error("Media source must be uploaded to the project first");
  const root = path.resolve(mediaAssetsDir);
  const filePath = path.resolve(root, decodeURIComponent(sourceUrl.slice("/media/".length)));
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw new Error("Invalid local media path");
  const buffer = await fs.readFile(filePath);
  if (!buffer.length || buffer.length > maximumBytes) throw new Error("Media file is empty or too large");
  return buffer;
};

const withTempDir = async <T,>(operation: (directory: string) => Promise<T>) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omni-media-"));
  try {
    return await operation(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

export const inspectUploadedVideo = (buffer: Buffer): Promise<UploadedVideoMetadata> => withTempDir(async (directory) => {
  const input = path.join(directory, "upload.media");
  await fs.writeFile(input, buffer);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpeg,mpegts,ogg",
    "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", input,
  ], { timeout: 30_000, maxBuffer: 128 * 1024 });
  const result = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
  const video = result.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds = Number(video?.duration || result.format?.duration || 0);
  if (!video?.width || !video.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("视频缺少有效画面或时长。");
  }
  return { durationSeconds, width: video.width, height: video.height, hasAudio: Boolean(result.streams?.some((stream) => stream.codec_type === "audio")) };
});

export const readVideoSource = async ({
  sourceUrl,
  mediaAssetsDir,
  assertPublicRemoteUrl,
  maximumBytes = MAX_VIDEO_BYTES,
  accept = "video/mp4,video/*",
}: {
  sourceUrl: string;
  mediaAssetsDir: string;
  assertPublicRemoteUrl: (value: string) => Promise<URL>;
  maximumBytes?: number;
  accept?: string;
}) => {
  if (sourceUrl.startsWith("/media/")) {
    return readLocalMediaSource({ sourceUrl, mediaAssetsDir, maximumBytes });
  }
  let currentUrl = await assertPublicRemoteUrl(sourceUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: { Accept: accept },
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Remote video redirected too many times");
      currentUrl = await assertPublicRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Remote video download failed (${response.status})`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maximumBytes) throw new Error("Remote media exceeds size limit");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maximumBytes) throw new Error("Remote media is empty or exceeds size limit");
    return buffer;
  }
  throw new Error("Remote video download failed");
};

export const extractLastVideoFrame = (video: Buffer) => withTempDir(async (directory) => {
  const inputPath = path.join(directory, "input.mp4");
  const outputPath = path.join(directory, "last-frame.jpg");
  await fs.writeFile(inputPath, video);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-sseof", "-0.1", "-i", inputPath,
    "-frames:v", "1", "-q:v", "2", outputPath,
  ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  return fs.readFile(outputPath);
});

export const rewriteVideoAudio = (
  video: Buffer,
  replacementAudio?: Buffer,
) => withTempDir(async (directory) => {
  const inputPath = path.join(directory, "input.mp4");
  const outputPath = path.join(directory, "output.mp4");
  await fs.writeFile(inputPath, video);
  if (!replacementAudio) {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", outputPath,
    ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
    return fs.readFile(outputPath);
  }
  const audioPath = path.join(directory, "replacement-audio");
  await fs.writeFile(audioPath, replacementAudio);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-i", audioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-af", "apad", "-shortest", "-movflags", "+faststart", outputPath,
  ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
  return fs.readFile(outputPath);
});

export const composeVideoSegments = (buffers: Buffer[], aspectRatio: "16:9" | "9:16") => withTempDir(async (directory) => {
  const [width, height] = aspectRatio === "9:16" ? [480, 854] : [854, 480];
  const normalizedPaths: string[] = [];
  for (let index = 0; index < buffers.length; index += 1) {
    const inputPath = path.join(directory, `input-${index}.mp4`);
    const outputPath = path.join(directory, `segment-${index}.mp4`);
    await fs.writeFile(inputPath, buffers[index]);
    const hasAudio = await mediaFileHasAudio(inputPath);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath];
    if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    args.push(
      "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0",
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-af", "apad", "-shortest", outputPath,
    );
    await execFileAsync("ffmpeg", args, { timeout: 180_000, maxBuffer: 1024 * 1024 });
    normalizedPaths.push(outputPath);
  }
  const concatPath = path.join(directory, "segments.txt");
  const outputPath = path.join(directory, "output.mp4");
  await fs.writeFile(concatPath, normalizedPaths.map((filePath) => `file '${filePath}'`).join("\n"));
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
    "-c", "copy", "-movflags", "+faststart", outputPath,
  ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
  return fs.readFile(outputPath);
});
