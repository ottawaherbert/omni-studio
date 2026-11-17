import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAIVoice, generateAIBgm } from '../src/services/ai';
import { useAIConfigStore } from '../src/store/useAIConfigStore';
import { useGlobalStore } from '../src/store/useGlobalStore';

test('audio clients send explicit production context and Gemini TTS never silently re-generates after failure', async () => {
  const config = useAIConfigStore.getState(), global = useGlobalStore.getState(), originalFetch = globalThis.fetch;
  const target = { projectId: 'fixture', episodeId: 'ep', sceneId: 'scene', shotIds: ['shot'] };
  const calls: { url: string; body: any }[] = [];
  let fail = true;
  useAIConfigStore.setState({ hasHydrated: true, channels: [{ id: 'gemini-audio', name: 'Mock audio', type: 'gemini', baseUrl: '', apiKey: 'fixture-key' }], models: [{ id: 'voice', channelId: 'gemini-audio', alias: 'voice', modelId: 'gemini-tts-fixture', capabilities: ['audio'] }], routing: { ...config.routing, audioGen: 'voice' } });
  globalThis.fetch = async (input, options) => {
    const url = String(input), body = JSON.parse(String(options?.body)); calls.push({ url, body });
    if (url === '/api/assets/upload') return Response.json({ url: '/media/voice.wav' });
    if (fail) return new Response(JSON.stringify({ error: 'fixture provider failed' }), { status: 503 });
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: 'AAAAAAAAAAA=', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] });
  };
  try {
    await assert.rejects(generateAIVoice({ text: '一句话', voiceName: 'Kore', purpose: 'production', target }), /503/);
    assert.equal(calls.length, 1, 'supplier failure must not silently make another generation call');
    assert.equal(calls[0].body.purpose, 'production'); assert.deepEqual(calls[0].body.target, target);
    fail = false;
    assert.equal(await generateAIVoice({ text: '音色试听', voiceName: 'Kore', purpose: 'preview' }), '/media/voice.wav');
    assert.equal(calls[1].body.purpose, 'preview'); assert.equal(calls[1].body.target, undefined);
    assert.equal(await generateAIVoice({ text: '正式台词', voiceName: 'Kore', purpose: 'production', target }), '/media/voice.wav');
    assert.equal(calls.at(-1)!.body.projectId, target.projectId, 'formal voice persistence follows target project');
    useGlobalStore.setState({ bgmSettings: { ...global.bgmSettings, provider: 'custom', customApiUrl: 'https://fixture.invalid/music', customKeySource: 'local', customApiKey: 'fixture-key' } });
    globalThis.fetch = async (input, options) => { calls.push({ url: String(input), body: JSON.parse(String(options?.body)) }); return Response.json({ audio_url: '/media/music.wav' }); };
    assert.equal(await generateAIBgm({ prompt: '一段配乐', purpose: 'production', target }), '/media/music.wav');
    assert.equal(calls.at(-1)!.body.purpose, 'production'); assert.deepEqual(calls.at(-1)!.body.target, target);
  } finally { globalThis.fetch = originalFetch; useAIConfigStore.setState(config); useGlobalStore.setState(global); }
});
