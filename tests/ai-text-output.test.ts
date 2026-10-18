import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAIContent } from '../src/services/ai';
import { safeParseAIResponse } from '../src/utils/aiParser';
import { useAIConfigStore } from '../src/store/useAIConfigStore';
import { normalizeAIConfig, type ChannelType } from '../src/config/aiConfigDefaults';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const options = { prompt: 'Mechanical JSON boundary test', requireJson: true, schema, skipManualPrompt: true };

for (const provider of ['openai', 'deepseek', 'gemini', 'minimax'] as ChannelType[]) test(`browser text generator ${provider}: validate complete output and never retry failures`, async t => {
  const saved = useAIConfigStore.getState(), originalFetch = globalThis.fetch;
  useAIConfigStore.setState({ hasHydrated: true, channels: [{ id: 'fixture', name: 'Fixture', type: provider, baseUrl: provider === 'openai' ? 'https://gateway.example/v1' : '', apiKey: 'mock-no-network' }],
    models: [{ id: 'fixture', channelId: 'fixture', alias: 'Fixture', modelId: 'fixture-model', capabilities: ['text'] }], routing: { ...saved.routing, scriptGen: 'fixture' } });
  let calls = 0, content = '```json\n{"ok":true}\n```', status = 200, finish = 'stop';
  globalThis.fetch = (async (_url, init) => {
    calls++;
    const wire = JSON.parse(init!.body as string), body = wire.body || wire.payload;
    if (calls <= 5 && (provider === 'openai' || provider === 'deepseek')) { assert.equal(body.response_format, undefined); assert.match(body.messages[0].content, /JSON Schema/); }
    if (calls <= 5 && provider === 'gemini') { assert.equal(body.config.responseMimeType, 'application/json'); assert.match(body.config.systemInstruction, /JSON Schema/); }
    if (status !== 200) return new Response('provider rejected request', { status });
    return Response.json(provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: finish === 'stop' ? 'STOP' : 'MAX_TOKENS' }] }
      : provider === 'minimax' ? { content: [{ type: 'text', text: content }], stop_reason: finish === 'stop' ? 'end_turn' : 'max_tokens' }
      : { choices: [{ message: { content }, finish_reason: finish }] });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; useAIConfigStore.setState(saved); });
  assert.equal(await generateAIContent(options), '{"ok":true}'); assert.equal(calls, 1);
  content = '{"ok":"true"}'; await assert.rejects(generateAIContent(options), /不符合约定/); assert.equal(calls, 2);
  content = 'prose {"ok":true}'; await assert.rejects(generateAIContent(options), /完整有效/); assert.equal(calls, 3);
  content = '{"ok":true}'; finish = 'length'; await assert.rejects(generateAIContent(options), /未完成/); assert.equal(calls, 4);
  status = 400; await assert.rejects(generateAIContent(options), /400/); assert.equal(calls, 5);
  status = 200; finish = 'stop'; content = 'ordinary discussion'; assert.equal(await generateAIContent({ prompt: 'Discuss', skipManualPrompt: true }), content);
});

test('strict mode is selected before dispatch and does not fall back by resending a 400', async t => {
  const saved = useAIConfigStore.getState(), originalFetch = globalThis.fetch;
  useAIConfigStore.setState({ hasHydrated: true, channels: [{ id: 'fixture', name: 'Fixture', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'mock' }],
    models: [{ id: 'fixture', channelId: 'fixture', alias: 'Fixture', modelId: 'fixture', capabilities: ['text'] }], routing: { ...saved.routing, scriptGen: 'fixture' } });
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++; const body = JSON.parse(init!.body as string).body;
    assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true);
    return new Response('format unsupported', { status: 400 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; useAIConfigStore.setState(saved); });
  await assert.rejects(generateAIContent(options), /400/); assert.equal(calls, 1);
});

test('common parser rejects empty/truncated output instead of returning a default value', () => {
  for (const raw of ['', '{"ok":', '{"ok":true,}']) assert.throws(() => safeParseAIResponse(raw, {}));
  assert.deepEqual(safeParseAIResponse('```json\n{"ok":true}\n```', {}), { ok: true });
});

test('model output mode survives config normalization and invalid mode resets to auto', () => {
  const input: any = { channels: [{ id: 'fixture', name: 'Fixture', type: 'openai', baseUrl: 'https://gateway.example', apiKey: '' }], models: [{ id: 'fixture', channelId: 'fixture', modelId: 'fixture', capabilities: ['text'], textOutputMode: 'json-object' }] };
  assert.equal(normalizeAIConfig(input).models[0].textOutputMode, 'json-object');
  input.models[0].textOutputMode = 'invented'; assert.equal(normalizeAIConfig(input).models[0].textOutputMode, 'auto');
});


test('manual external result uses the same schema boundary without making a provider call',async t=>{
  const {withManualAIResult}=await import('../apps/web/src/clients/manualAIClient');
  const {useSettingsStore}=await import('../src/store/useSettingsStore');
  const oldTestMode=useSettingsStore.getState().isTestMode;useSettingsStore.setState({isTestMode:true});
  t.after(()=>useSettingsStore.setState({isTestMode:oldTestMode}));
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;throw new Error('Manual result must not call fetch');}) as typeof fetch;
  t.after(()=>{globalThis.fetch=previous;});
  const generate=(text:string)=>withManualAIResult('fixture',{kind:'text',text},()=>generateAIContent({prompt:'fixture',requireJson:true,schema}));
  assert.equal(await generate('```json\n{"ok":true}\n```'),'{"ok":true}');
  await assert.rejects(generate('{"ok":true,"extra":1}'),/不符合约定/);
  assert.equal(calls,0);
});
