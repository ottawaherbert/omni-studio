import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenerationMediaStore } from '../src/server/generation/media';

test('video inspection records actual audio presence independently of provider capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-audio-provenance-'));
  try {
    const run = promisify(execFile);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(root, 'audio.mp4')]);
    await run('ffmpeg', ['-v', 'error', '-i', path.join(root, 'audio.mp4'), '-an', '-c:v', 'copy', path.join(root, 'silent.mp4')]);
    const media = new GenerationMediaStore(root);
    assert.equal((await media.inspect('/media/audio.mp4', 'video')).hasAudio, true);
    assert.equal((await media.inspect('/media/silent.mp4', 'video')).hasAudio, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
