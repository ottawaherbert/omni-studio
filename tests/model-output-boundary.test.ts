import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseModelJson, ModelOutputError, assertModelSchema, providerCompletionFailure, jsonTransportMode } from '../packages/model-output/src';
import { resolveTextOutputProfile } from '../src/config/textModelOutput';

const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const signal = () => new AbortController().signal;

test('shared JSON boundary only removes an entire code fence; rejects ambiguity and incomplete data', () => {
  for (const raw of ['{"text":"ok"}', '\uFEFF  {"text":"ok"} ', '```json\n{"text":"ok"}\n```', '```\r\n{"text":"ok"}\r\n```'])
    assert.deepEqual(parseModelJson(raw, schema), { text: 'ok' });
  for (const raw of ['', 'explanation {"text":"ok"}', '{"text":"ok"} trailing', '{"text":"ok",}', '{"text":"ok"', '{"text":"a"}{"text":"b"}', '```json\n{}\n```\n```json\n{}\n```'])
    assert.throws(() => parseModelJson(raw), (e: any) => e instanceof ModelOutputError && e.kind === 'SYNTAX');
});

test('schema boundary neither coerces fields, drops unknown keys nor inserts defaults', () => {
  for (const value of [{ text: 1 }, {}, { text: 'ok', tool: 'delete' }]) {
    const before = structuredClone(value);
    assert.throws(() => parseModelJson(JSON.stringify(value), schema), (e: any) => e.kind === 'SCHEMA');
    assert.deepEqual(value, before);
  }
  assert.throws(() => assertModelSchema({ type: 'not-a-type' }), (e: any) => e.kind === 'CONTRACT');
  assert.equal(jsonTransportMode('json-schema', schema), 'json-schema');
  assert.equal(jsonTransportMode('json-schema', { type: 'array', items: schema }), 'prompt-json');
  assert.equal(jsonTransportMode('json-schema', { type: 'object', properties: { text: { type: 'string' } } }), 'json-object');
});

test('capability selection uses endpoint/configuration and defaults unknown gateways to prompt JSON', () => {
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://proxy.example/v1', modelId: 'gpt-any' }).mode, 'prompt-json');
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://api.openai.com/v1', modelId: 'fixture' }).mode, 'json-schema');
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://proxy.example/v1', modelId: 'fixture', mode: 'json-object' }).source, 'configured');
  assert.throws(() => resolveTextOutputProfile({ provider: 'minimax', endpoint: 'https://api.minimaxi.com', modelId: 'fixture', mode: 'json-schema' }));
});

test('provider completion classification covers refusals and all supported token-limit spellings', () => {
  assert.equal(providerCompletionFailure({ choices: [{ message: { refusal: 'no' } }] })?.kind, 'REFUSAL');
  assert.equal(providerCompletionFailure({ promptFeedback: { blockReason: 'SAFETY' } })?.kind, 'REFUSAL');
  for (const reason of ['length', 'MAX_TOKENS', 'max_tokens']) assert.equal(providerCompletionFailure({ stop_reason: reason })?.kind, 'INCOMPLETE');
  assert.equal(providerCompletionFailure({ error: { message: 'bad' } })?.kind, 'INVALID_RESPONSE');
});
