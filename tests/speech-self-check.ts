import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { QWEN_TTS_MODEL, speechProviderBody } from '../packages/domain/src/speech';
import { speechAudioDataUrl } from '../src/utils/speechAudio';
import { pcmWavDurationSeconds } from '../src/server/speechWav';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-speech-check-'));
process.env.OMNI_DB_PATH = path.join(directory, 'test.db');
const { dbHelpers, db } = await import('../src/server/db');
const { registerSpeechRoutes } = await import('../src/server/routes/speechRoutes');
const { defaultAIConfig } = await import('../src/config/aiConfigDefaults');
const wav = Buffer.alloc(44 + 4800);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4800, 40);
assert.equal(pcmWavDurationSeconds(wav), 0.1);
assert.equal(pcmWavDurationSeconds(wav.subarray(0, 100)), undefined, 'truncated PCM must not look like a short valid recording');
const withMetadata = Buffer.concat([wav.subarray(0, 36), Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 0, 0]), wav.subarray(36)]);
withMetadata.writeUInt32LE(withMetadata.length - 8, 4);
assert.equal(pcmWavDurationSeconds(withMetadata), 0.1, 'metadata chunks and odd-byte padding do not change duration');
const requests: any[] = [];
let heldResponse: import('express').Response | undefined;
let markHeld: () => void;
const held = new Promise<void>(resolve => { markHeld = resolve; });
const provider = express(); provider.use(express.json());
provider.post('/v1/audio/speech', (req, res) => {
  requests.push(req.body);
  if (req.body.input === '等待取消') {
    heldResponse = res;
    res.type('audio/wav').write(wav.subarray(0, 44));
    markHeld();
  } else if (req.body.input === '重复达到上限') {
    const capped = Buffer.alloc(44 + req.body.max_tokens * 1920 * 2);
    wav.copy(capped, 0, 0, 44);
    capped.writeUInt32LE(capped.length - 8, 4); capped.writeUInt32LE(capped.length - 44, 40);
    res.type('audio/wav').send(capped);
  } else res.type('audio/wav').send(wav);
});
const upstream = provider.listen(0, '127.0.0.1'); await new Promise<void>(resolve => upstream.once('listening', resolve));
const upstreamPort = (upstream.address() as any).port;
dbHelpers.saveAIConfig({ ...defaultAIConfig, channels: [{ id: 'local-test', name: 'Local test', type: 'custom', baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: '' }], models: [{ id: 'tts', channelId: 'local-test', alias: 'Qwen', modelId: QWEN_TTS_MODEL, capabilities: ['audio'] }], routing: { ...defaultAIConfig.routing, audioGen: 'tts' } });
const app = express(); app.use(express.json()); registerSpeechRoutes(app, { mediaAssetsDir: path.join(directory, 'media') });
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const post = (body: unknown) => fetch(`http://127.0.0.1:${(server.address() as any).port}/api/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await post({ text: '别着急，我在这里。', voice: 'Serena', language: 'Chinese', instructions: '低声说', projectId: 'voice-test' });
  assert.equal(result.status, 200);
  const { url } = await result.json();
  assert.ok(url.startsWith('/media/voice-test/voice_'));
  assert.deepEqual(await fs.readFile(path.join(directory, url)), wav);
  assert.equal(requests[0].lang_code, 'chinese'); assert.equal(requests[0].instruct, '低声说'); assert.equal(requests[0].voice, 'Serena');
  assert.ok(requests[0].max_tokens <= 300, 'short lines need a bounded generation budget');
  for (const body of [{ text: 'x', voice: 'Puck' }, { text: '', voice: 'Serena' }, { text: 'x', voice: 'Serena', language: 'Belarusian' }, { text: 'x', voice: 'Serena', projectId: '..' }, { text: 'x', voice: 'Serena', modelConfigId: 'missing' }]) assert.equal((await post(body)).status, 400);
  assert.equal(requests.length, 1, 'invalid inputs must not call the provider');
  assert.equal(speechProviderBody(QWEN_TTS_MODEL, { text: '长段对白。'.repeat(100), voice: 'Serena' }).max_tokens, 4096);
  assert.equal(speechProviderBody('other-tts', { text: 'hello', voice: 'alloy' }).max_tokens, undefined);
  const cappedResult = await post({ text: '重复达到上限', voice: 'Serena', projectId: 'capped-voice' });
  assert.equal(cappedResult.status, 400);
  assert.match((await cappedResult.json()).error, /达到本句生成上限/);
  await assert.rejects(fs.access(path.join(directory, 'media/capped-voice')), /ENOENT/);
  assert.equal(speechProviderBody('other-tts', { text: 'hello', voice: 'alloy', instructions: 'calm' }).instructions, 'calm');
  assert.throws(() => speechProviderBody(QWEN_TTS_MODEL.replace('1.7B', '0.6B'), { text: 'hello', voice: 'Serena', instructions: 'calm' }), /不支持表演/);
  assert.throws(() => speechProviderBody(QWEN_TTS_MODEL, { text: 'hello', voice: 'Serena', speed: 1.2 }), /不支持数值语速/);
  assert.equal(speechProviderBody('tts-1', { text: 'hello', voice: 'alloy', speed: 0.85 }).speed, 0.85);
  const pcm = Buffer.alloc(48000);
  const wrapped = Buffer.from(speechAudioDataUrl(pcm.toString('base64'), 'audio/L16;codec=pcm;rate=24000').split(',')[1], 'base64');
  assert.equal(wrapped.toString('ascii', 0, 4), 'RIFF'); assert.equal(wrapped.readUInt32LE(24), 24000);
  assert.equal(wrapped.readUInt32LE(40), 48000); assert.equal(wrapped.length, 48044);
  const controller = new AbortController();
  const interrupted = fetch(`http://127.0.0.1:${(server.address() as any).port}/api/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ text: '等待取消', voice: 'Serena', projectId: 'cancelled-voice' }),
  });
  const interruptedAssertion = assert.rejects(interrupted, /abort/i);
  await held;
  const upstreamClosed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Disconnected speech request left upstream open')), 2000);
    heldResponse!.once('close', () => { clearTimeout(timer); resolve(); });
  });
  controller.abort();
  await Promise.all([interruptedAssertion, upstreamClosed]);
  await assert.rejects(fs.access(path.join(directory, 'media/cancelled-voice')), /ENOENT/);
  console.log('Speech HTTP checks passed: saved provider routing, WAV persistence, voice/language/style mapping, invalid inputs rejected without calls.');
  console.log('Client disconnect cancels the upstream audio stream without saving a partial recording.');
} finally {
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  db.close(); await fs.rm(directory, { recursive: true, force: true });
}
