import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expandH3References, h3ReferencePrompt } from '../src/server/generation/h3References';
import { comfyAPIPresets } from '../src/config/comfyPresets';
import { compileComfyGraph, type ComfyAPIGraph } from '../packages/domain/src/comfyWorkflow';
import { validateGenerationDraft, type GenerationReference, type GenerationTarget } from '../packages/domain/src/generation';
import { defaultAIConfig, type AIConfigSnapshot } from '../src/config/aiConfigDefaults';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-h3-multimodal-'));
process.env.OMNI_DB_PATH = path.join(dir, 'test.db');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { buildGenerationCatalog } = await import('../src/server/generation/catalog');
const { GenerationEngine } = await import('../src/server/generation/engine');
const { GenerationStore } = await import('../src/server/generation/store');
const { loadGenerationContext } = await import('../src/server/generation/context');
after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
function config(): AIConfigSnapshot {
  const presets = comfyAPIPresets.filter(p => ['h3-reference-3', 'h3-storyboard-4', 'h3-action-3', 'h3-first-frame'].includes(p.id));
  return { ...structuredClone(defaultAIConfig), channels: [{ id: 'comfy', name: '隔离服务', type: 'comfyui', baseUrl: 'https://example.com', apiKey: '' }],
    comfyWorkflows: presets.map(p => ({ ...structuredClone(p.template), id: p.id, channelId: 'comfy' })),
    models: presets.map(p => ({ id: p.id, alias: p.label, channelId: 'comfy', modelId: p.id, capabilities: ['video'], comfyWorkflowId: p.id })),
    routing: { ...defaultAIConfig.routing, videoGen: 'h3-reference-3' } };
}
const recipe = () => buildGenerationCatalog(config()).find(r => r.capability.referenceAdapter && r.legacyModelIds.includes('h3-reference-3'))!;
const input = () => ({ prompt: '人物放下杯子', aspectRatio: '16:9', duration: 5, seed: 3, parameters: recipe().capability.defaults });
const params = () => Object.fromEntries(recipe().template!.parameters!.map(p => [p.key, recipe().capability.defaults[p.key]]));

test('expansion preserves author model, LoRAs, sampler and LMS byte-for-byte', () => {
  const original = config().comfyWorkflows[0], before = JSON.stringify(original), expanded = expandH3References(original)!;
  const old = original.workflowJson as ComfyAPIGraph, out = expanded.workflowJson as ComfyAPIGraph;
  assert.ok(expanded);
  for (const [id, node] of Object.entries(old)) if (node.class_type !== 'LoadImage' && node.class_type !== 'MiniMaxH3ReferenceToVideo') assert.deepEqual(out[id], node, id);
  assert.equal(JSON.stringify(original), before);
  assert.equal(expanded.api!.audioInputs, 3); assert.equal(expanded.api!.videoInputs, 3); assert.equal(expanded.api!.imageInputs, 9);
  assert.equal(expanded.api!.maxDuration, 14);
  assert.equal(expandH3References(config().comfyWorkflows.find(w => w.api?.operation === 'i2v')!), undefined, 'never convert an I2V model into R2V');
});
test('unknown media dependencies are preserved rather than forcefully upgraded', () => {
  const original = config().comfyWorkflows[0];
  (original.workflowJson as ComfyAPIGraph).custom = { class_type: 'CustomReference', inputs: { image: ['900', 0] } };
  assert.equal(expandH3References(original), undefined);
});
test('new catalog merges three/four image examples and keeps exact old recipes for history', () => {
  const cfg = config(), before = JSON.stringify(cfg), all = buildGenerationCatalog(cfg);
  const original = all.find(r => r.legacyModelIds.includes('h3-reference-3') && !r.capability.referenceAdapter)!;
  const upgraded = all.find(r => r.capability.id === original.capability.supersededBy)!;
  assert.equal(original.capability.inputs.image.max, 3);
  assert.equal(upgraded.capability.inputs.audio.roles.includes('voice_timbre'), true);
  assert.equal(upgraded.capability.inputs.image.min, 0);
  assert.equal(upgraded.capability.multiShot, true);
  assert.ok(upgraded.legacyModelIds.includes(original.capability.id));
  assert.ok(upgraded.legacyModelIds.includes('h3-storyboard-4'), 'slot count is not a separate core');
  assert.equal(all.filter(r => r.capability.referenceAdapter).length, 2, 'standard and combat cores only');
  assert.equal(JSON.stringify(cfg), before);
});
test('selected inputs compile exactly; unused loaders are removed across all modalities', () => {
  const r = recipe();
  for (const [images, videos, audio] of [[1, 0, 1], [5, 1, 2], [0, 0, 1], [9, 3, 3]]) {
    const files = (count: number, ext: string) => Array.from({ length: count }, (_, i) => `account-${i}.${ext}`);
    const graph = compileComfyGraph(r.template!, { ...input(), parameters: params(), images: files(images, 'png'), videos: files(videos, 'mp4'), audio: files(audio, 'wav') });
    const node = Object.values(graph).find(n => n.class_type === 'MiniMaxH3ReferenceToVideo')!;
    for (const [kind, count, prefix] of [['image', images, 'ref_images.ref_image_'], ['video', videos, 'ref_videos.ref_video_'], ['audio', audio, 'ref_audios.ref_audio_']] as const) {
      assert.equal(Object.keys(graph).filter(id => id.startsWith(`omni_h3_${kind}_`)).length, count);
      assert.equal(Object.keys(node.inputs).filter(key => key.startsWith(prefix)).length, count);
    }
    assert.equal(Object.keys(node.inputs).some(key => key.startsWith('ref_video_audios')), false, 'no implicit soundtrack');
  }
  assert.throws(() => compileComfyGraph(r.template!, { ...input(), parameters: params() }), /至少/);
  assert.throws(() => compileComfyGraph(r.template!, { ...input(), parameters: params(), images: Array(10).fill('x.png') }), /0–9/);
});
test('prompt tags follow actual per-modality order and separate timbre from dialogue', () => {
  const ref = (id: string, mediaKind: GenerationReference['mediaKind'], role: GenerationReference['role']) => ({ id, mediaKind, role, label: id, usageNote: '只用于角色甲' } as GenerationReference);
  const result = h3ReferencePrompt([ref('甲音色', 'audio', 'voice_timbre'), ref('人物', 'image', 'character_identity'), ref('动作', 'video', 'motion'), ref('乙对白', 'audio', 'full_dialogue')]);
  assert.match(result, /<Picture 1>：人物/); assert.match(result, /<Video 1>：动作/);
  assert.match(result, /<Audio 1>：甲音色/); assert.match(result, /<Audio 2>：乙对白/);
  assert.match(result, /不复制样本中的话语/); assert.match(result, /不视为已保证原音频波形复用/);
});
async function fixture() {
  const projectId = `h3-${randomUUID()}`, episodeId = `${projectId}-ep`, sceneId = `${projectId}-scene`, shotId = `${projectId}-shot`;
  const root = path.join(dir, projectId); await fs.mkdir(root);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(root, 'image.png'), png);
  const wav = Buffer.alloc(44 + 4800); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(4800,40);
  await fs.writeFile(path.join(root, 'voice.wav'), wav);
  dbHelpers.saveProject({ id: projectId, title: '隔离参考测试', type: 'film', characters: [{ id: 'actor', name: '甲', voiceReferences: [{ id: 'voice1', url: '/media/voice.wav', usage: 'voice_timbre', isDefault: true }] }], assets: [], episodes: [{ id: episodeId, title: '测试', scenes: [{ id: sceneId, title: '本场', sceneNumber: 1, shots: [{ id: shotId, duration: 5, characterIdsInShot: ['actor'], visualAction: '甲放下杯子', imagePrompt: '甲放下杯子', imageUrl: '/media/image.png' }] }] }] } as any);
  const target: GenerationTarget = { projectId, episodeId, sceneId, kind: 'shot', shotIds: [shotId] };
  const engine = new GenerationEngine(new GenerationStore(db), config, root);
  let task = engine.create({ target, operation: 'video', commandId: randomUUID() });
  const cap = engine.recipe(task.capabilityId).capability;
  assert.equal(cap.referenceAdapter, 'h3_multimodal_v1');
  task = engine.update(task.id, { expectedRevision: task.revision, patch: { references: task.references.filter(r => r.mediaKind === 'audio').map(r => ({ ...r, enabled: true, source: 'user' })) } });
  return { projectId, target, engine, task, cap };
}
test('shared engine freezes real voice bytes, compiles tags and preserves pause enforcement', async () => {
  const f = await fixture();
  const result = await f.engine.preflight(f.task.id, f.task.revision);
  assert.equal(result.issues.length, 0); assert.ok(result.plan);
  assert.equal(result.plan.references[0].sourceCharacterId, 'actor');
  assert.match(result.plan.references[0].mediaUrl, /snapshots/); assert.match(result.plan.prompt, /<Audio 1>：甲/);
  const policy = f.engine.store.policy(f.projectId); f.engine.updatePolicy(f.projectId, { videoPaused: true }, policy.revision);
  const grant = f.engine.grant({ projectId: f.projectId, kind: 'fixed_plans', planIds: [result.plan.id], operations: ['video'], coreFamilies: ['yz_h3'], maxAttempts: 1, allowUnknownCost: true, expiresAt: Date.now() + 10000 });
  assert.throws(() => f.engine.submit(result.plan!.id, result.plan!.planHash, grant.id, randomUUID()), /暂停/);
});
test('voice ownership, media and settings participate in fresh source checks', async () => {
  const f = await fixture(), old = loadGenerationContext(f.target);
  const project = dbHelpers.getProjectById(f.projectId) as any;
  project.characters[0].voiceReferences[0].isDefault = false; project.characters[0].voiceSettings = { voice: 'new' };
  dbHelpers.saveProject(project);
  assert.notEqual(loadGenerationContext(f.target).sourceHash, old.sourceHash);
  assert.ok((await f.engine.preflight(f.task.id, f.task.revision)).issues.some(i => i.code === 'SOURCE_CHANGED'));
});
test('H3 frame ceiling and semantic role checks remain enforced', async () => {
  const f = await fixture();
  assert.ok(validateGenerationDraft({ ...f.task, parameters: { ...f.task.parameters, duration: { value: 14, locked: false, source: 'user' } } }, f.cap).some(i => i.code === 'DURATION_FRAME_LIMIT'));
  assert.ok(validateGenerationDraft({ ...f.task, references: f.task.references.map(r => ({ ...r, role: 'first_frame' })) }, f.cap).some(i => i.code === 'REFERENCE_ROLE_UNSUPPORTED'));
});
