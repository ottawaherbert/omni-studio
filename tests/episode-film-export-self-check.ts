import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeEpisodeFilm } from "../src/server/media/episodeFilmComposition";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "episode-film-check-"));
try {
  const videoPath = path.join(directory, "shot-video.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=0.5:r=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-shortest", "-c:a", "aac",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
  ]);
  const imagePath = path.join(directory, "shot-image.jpg");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180",
    "-frames:v", "1", imagePath,
  ]);
  const output = await composeEpisodeFilm({
    shots: [
      { media: fs.readFileSync(videoPath), kind: "video", durationSeconds: 0.5 },
      { media: fs.readFileSync(imagePath), kind: "image", durationSeconds: 0.5 },
    ],
    aspectRatio: "16:9",
    subtitles: Buffer.from("1\n00:00:00,000 --> 00:00:00,800\n霜线\n", "utf8"),
  });
  const outputPath = path.join(directory, "film.mp4");
  fs.writeFileSync(outputPath, output);
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath,
  ], { encoding: "utf8" }));
  const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const audio = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
  const subtitle = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "subtitle");
  assert.equal(video?.width, 854);
  assert.equal(video?.height, 480);
  assert.ok(audio, "episode film must contain an audio stream");
  assert.ok(subtitle, "episode film must contain a subtitle stream");
  assert.ok(Number(probe.format.duration) >= 0.95 && Number(probe.format.duration) <= 1.1);
  console.log("Episode film export self-check passed.");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
