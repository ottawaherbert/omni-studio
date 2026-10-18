import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbHelpers } from '../db';
import { speechProviderBody, type SpeechRequest } from '../../../packages/domain/src/speech';
import { pcmWavDurationSeconds } from '../speechWav';

export function registerSpeechRoutes(app: Express, { mediaAssetsDir }: { mediaAssetsDir: string }) {
  app.post('/api/audio/speech', async (req, res) => {
    const disconnected = new AbortController();
    const cancelOnClose = () => { if (!res.writableEnded) disconnected.abort(); };
    req.once('aborted', cancelOnClose);
    res.once('close', cancelOnClose);
    try {
      const config = dbHelpers.getAIConfig().config;
      const input = req.body as SpeechRequest;
      const model = config.models.find(item => item.id === (input.modelConfigId || config.routing.audioGen));
      const channel = config.channels.find(item => item.id === model?.channelId);
      if (!model?.capabilities.includes('audio') || !channel || !['custom', 'openai', 'llamacpp'].includes(channel.type)) throw new Error('请选择已保存的兼容语音接口和音频模型。');
      // Resolve the destination only from the saved configuration, never a request URL.
      const target = new URL(channel.baseUrl.replace(/\/+$/, '') + '/audio/speech');
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
      if (target.username || target.password || target.search || target.hash || (target.protocol !== 'https:' && !(loopback && target.protocol === 'http:'))) throw new Error('音频接口需使用 HTTPS；本机服务可使用 HTTP。');
      const projectId = input.projectId || 'voice-previews';
      if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(projectId)) throw new Error('项目标识无效。');
      const body = speechProviderBody(model.modelId, input);
      const key = model.apiKeyOverride || channel.apiKey || (channel.type === 'openai' && !loopback ? process.env.OPENAI_API_KEY : '') || '';
      const response = await fetch(target, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(600_000), disconnected.signal]),
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`语音服务返回 ${response.status}，请检查模型、音色和本地服务日志。`); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('语音服务未返回声音。');
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 100 * 1024 * 1024) { await reader.cancel(); throw new Error('单次音频超过 100 MiB，请分段生成。'); }
        chunks.push(part.value);
      }
      const audio = Buffer.concat(chunks);
      disconnected.signal.throwIfAborted();
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('语音接口未返回有效 WAV 音频。');
      if (body.max_tokens !== undefined) {
        const duration = pcmWavDurationSeconds(audio);
        if (duration === undefined || duration <= 0) throw new Error('本地语音接口未返回完整 PCM WAV 音频。');
        if (duration >= (body.max_tokens - 1) / 12.5) throw new Error('本地配音达到本句生成上限，可能存在重复或截断；请简化表演要求后重试，长对白请分段生成。');
      }
      const name = `voice_${randomUUID()}.wav`;
      const directory = path.join(mediaAssetsDir, projectId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, name), audio);
      res.json({ url: `/media/${projectId}/${name}` });
    } catch (error) {
      if (!disconnected.signal.aborted) res.status(400).json({ error: error instanceof Error ? error.message : '语音生成失败' });
    } finally {
      req.off('aborted', cancelOnClose);
      res.off('close', cancelOnClose);
    }
  });
}
