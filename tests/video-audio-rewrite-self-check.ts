import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { rewriteVideoAudio } from "../src/server/media/videoComposition.ts";

const execFileAsync = promisify(execFile);

const hasAudio = async (filePath: string) => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath,
  ]);
  return stdout.trim().length > 0;
};

const run = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-audio-rewrite-check-"));
  try {
    const videoPath = path.join(directory, "native.mp4");
    const audioPath = path.join(directory, "replacement.wav");
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=0.6", audioPath,
    ]);
    const video = await fs.readFile(videoPath);
    const stripped = await rewriteVideoAudio(video);
    const strippedPath = path.join(directory, "stripped.mp4");
    await fs.writeFile(strippedPath, stripped);
    assert.equal(await hasAudio(strippedPath), false, "Explicit strip must remove the native audio stream");

    const replaced = await rewriteVideoAudio(video, await fs.readFile(audioPath));
    const replacedPath = path.join(directory, "replaced.mp4");
    await fs.writeFile(replacedPath, replaced);
    assert.equal(await hasAudio(replacedPath), true, "Explicit replacement must create one output audio stream");
    assert.ok(replaced.length > 0, "Audio replacement must produce a playable MP4 buffer");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log("Video audio rewrite self-check passed.");
};

await run();
