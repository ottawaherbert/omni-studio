import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src/identity';
import { buildAgentDraft, agentDraftOutputSchema } from '../packages/script/src/agentDraft';
import { assertAgentDraftScope, emptyScriptDraftCreationLedger, validateScriptDraftScope,
  type AgentDraftOperation, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { createScriptProject } from '../packages/script/src/project';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';
import type { ScriptProject } from '../packages/script/src/schema';

const profile = { organization: 'episodic' as const, continuity: 'serialized' as const, workType: '剧情', genres: ['剧情'], language: 'zh-CN',
  plannedUnits: 2, targetDurationMs: 2400000, toleranceMs: 0, includeCredits: false, aspectRatio: '16:9' as const,
  productionMode: 'live-action' as const };
function project(): ScriptProject {
  const p = createScriptProject('机械稿', profile); p.revision = 1;
  p.units[0].scenes[0].blocks = [
    { id: 'block_before', type: 'action', text: '门开了。' },
    { id: 'block_target', type: 'action', text: '脚步停下。' },
    { id: 'block_after', type: 'action', text: '灯灭了。' },
  ];
  return p;
}
const operations: AgentDraftOperation[] = ['concept', 'theme', 'project_outline', 'unit_outline', 'add_unit', 'plan_scenes',
  'scene_body', 'replace_blocks', 'replace_selection', 'add_character', 'add_fact'];
function grant(origin = project(), patch: Partial<ScriptDraftScope> = {}): ScriptDraftScope {
  const unit = origin.units[0], scene = unit.scenes[0];
  return { workspaceId: 'workspace_test', documentId: origin.id, originRevision: origin.revision, originContentHash: hashValue(origin), operations,
    units: [{ unitId: unit.id, allowSummary: true, allowAllScenes: true, maxNewScenes: 31,
      scenes: [{ sceneId: scene.id, allowPlan: true, allowBody: true, blockIds: null }] },
      { unitId: 'unit_reserved', allowSummary: true, allowAllScenes: true, maxNewScenes: 40, scenes: [] }],
    newUnitSlots: [{ slotId: 'episode_2', unitId: 'unit_reserved', scopeId: origin.id, targetDurationMs: 2400000, maxNewScenes: 40 }],
    sharedFields: ['concept', 'theme', 'outline'], characterScopeIds: [origin.id], factScopeIds: [origin.id], ...patch };
}
const result = (operation: AgentDraftOperation, data: Record<string, unknown>, base = project(), scope = grant(base), candidateId = `candidate_${operation}`) =>
  buildAgentDraft(JSON.stringify({ summary: '机械候选', ...data }), { candidateId, operation, unitId: base.units[0].id,
    sceneId: base.units[0].scenes[0].id, scopeId: base.id }, base, scope, { origin: base, ledger: emptyScriptDraftCreationLedger() });
const block = (localKey: string, text: string) => ({ localKey, type: 'action', text, speakerId: null, speakerName: null });

test('strict recursive schemas reject extra model fields, fake IDs, and timing evidence', () => {
  for (const operation of operations) {
    const schema = agentDraftOutputSchema(operation);
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required.sort(), Object.keys(node.properties).sort()); }
      for (const child of Object.values(node)) visit(child);
    };
    visit(schema);
  }
  const p = project(), s = grant(p);
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: 'x', blocks: [block('a', '正文')], timingEvidence: [] }),
    { candidateId: 'candidate_bad', operation: 'scene_body', unitId: p.units[0].id, sceneId: p.units[0].scenes[0].id }, p, s,
    { origin: p, ledger: emptyScriptDraftCreationLedger() }), /严格合同/);
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: 'x', blocks: [{ ...block('a', '正文'), id: 'forged' }] }),
    { candidateId: 'candidate_bad', operation: 'scene_body', unitId: p.units[0].id, sceneId: p.units[0].scenes[0].id }, p, s,
    { origin: p, ledger: emptyScriptDraftCreationLedger() }), /严格合同/);
});

test('concept and unit outline change only their authorized fields', () => {
  const p = project(), s = grant(p);
  const concept = result('concept', { content: '门口等待的故事' }, p, s);
  const changed = applyWorkspacePatch(p, concept.patch);
  assert.equal(changed.brief.concept, '门口等待的故事'); assert.equal(changed.brief.theme, p.brief.theme);
  const outline = result('unit_outline', { content: '第二段回到门口' }, p, s);
  assert.equal(applyWorkspacePatch(p, outline.patch).units[0].summary, '第二段回到门口');
  const forged = structuredClone(p); forged.methods.push({ id: 'fake', title: 'fake', version: '1', content: 'fake' });
  assert.throws(() => assertAgentDraftScope(p, createWorkspacePatch(p, forged), s, 'concept', { origin: p, ledger: emptyScriptDraftCreationLedger() }), /禁止修改/);
});

test('scene planning is capped per batch but can continue past 30 scenes under cumulative grant', () => {
  const p = project(), s = grant(p), unitId = p.units[0].id;
  const scenes = Array.from({ length: 30 }, (_, i) => ({ localKey: `scene_${i}`, title: `场 ${i}`, purpose: '机械目的', location: '', timeOfDay: '' }));
  const first = result('plan_scenes', { scenes }, p, s, 'candidate_batch_1');
  const after = applyWorkspacePatch(p, first.patch); after.revision++;
  assert.equal(after.units[0].scenes.length, 31);
  const ledger = emptyScriptDraftCreationLedger();
  ledger.scenes = after.units[0].scenes.slice(1).map(scene => ({ unitId, sceneId: scene.id }));
  const second = buildAgentDraft(JSON.stringify({ summary: '第二批', scenes: [{ localKey: 'tail', title: '尾场', purpose: '结束', location: '', timeOfDay: '' }] }),
    { candidateId: 'candidate_batch_2', operation: 'plan_scenes', unitId }, after, s, { origin: p, ledger });
  assert.equal(applyWorkspacePatch(after, second.patch).units[0].scenes.length, 32);
  const over = structuredClone(ledger); over.scenes.push({ unitId, sceneId: 'scene_not_yet' });
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: '第三批', scenes: [{ localKey: 'too_many', title: '再添', purpose: '越额', location: '', timeOfDay: '' }] }),
    { candidateId: 'candidate_batch_3', operation: 'plan_scenes', unitId }, after, s, { origin: p, ledger: over }), /额度|台账/);
  assert.throws(() => result('plan_scenes', { scenes: [...scenes, { localKey: '31', title: '多一场', purpose: '', location: '', timeOfDay: '' }] }, p, s), /1–30/);
});

test('new reserved unit and localKey mapping are stable, model cannot change timing or prior episode', () => {
  const p = project(), s = grant(p);
  const request = { candidateId: 'candidate_new_unit', operation: 'add_unit' as const, slotId: 'episode_2' };
  const first = buildAgentDraft(JSON.stringify({ summary: '新集', title: '第二集', unitSummary: '门外' }), request, p, s,
    { origin: p, ledger: emptyScriptDraftCreationLedger() });
  const replay = buildAgentDraft(JSON.stringify({ summary: '新集', title: '第二集', unitSummary: '门外' }), request, p, s,
    { origin: p, ledger: emptyScriptDraftCreationLedger() });
  assert.deepEqual(first.idMap, replay.idMap); assert.equal(first.patchDigest, replay.patchDigest);
  const after = applyWorkspacePatch(p, first.patch);
  assert.equal(after.units[1].id, 'unit_reserved'); assert.equal(after.units[1].targetDurationMs, 2400000);
  assert.deepEqual(after.units[0], p.units[0]); assert.deepEqual(after.units[1].timingEvidence, []);
  const forged = structuredClone(p); forged.units[0].timingEvidence.push({ id: 'fake_evidence', kind: 'final', source: 'synthetic', contentHash: 'x', durationMs: 1, assumptions: '' });
  assert.throws(() => assertAgentDraftScope(p, createWorkspacePatch(p, forged), s, 'add_unit', { origin: p, ledger: emptyScriptDraftCreationLedger(), slotId: 'episode_2' }), /禁止修改|字段/);
});

test('block-range and selected-text revisions preserve the rest of the scene', () => {
  const p = project(), unit = p.units[0], scene = unit.scenes[0];
  const s = grant(p, { newUnitSlots: [], units: [{ unitId: unit.id, allowSummary: false, allowAllScenes: false, maxNewScenes: 0,
    scenes: [{ sceneId: scene.id, allowPlan: false, allowBody: true, blockIds: ['block_target'] }] }] });
  const edited = buildAgentDraft(JSON.stringify({ summary: '局部', blocks: [block('replace', '脚步继续。')] }),
    { candidateId: 'candidate_block', operation: 'replace_blocks', unitId: unit.id, sceneId: scene.id, blockIds: ['block_target'] }, p, s,
    { origin: p, ledger: emptyScriptDraftCreationLedger() });
  const next = applyWorkspacePatch(p, edited.patch);
  assert.deepEqual(next.units[0].scenes[0].blocks[0], scene.blocks[0]); assert.deepEqual(next.units[0].scenes[0].blocks[2], scene.blocks[2]);
  const malicious = structuredClone(p); malicious.units[0].scenes[0].blocks[0].text = '偷改开头';
  assert.throws(() => assertAgentDraftScope(p, createWorkspacePatch(p, malicious), s, 'replace_blocks',
    { origin: p, ledger: emptyScriptDraftCreationLedger(), blockIds: ['block_target'] }), /局部块以外/);
  const source = '门开了。\n\n脚步停下。\n\n灯灭了。';
  const start = source.indexOf('脚步停下。'), selection = { start, end: start + '脚步停下。'.length, text: '脚步停下。' };
  const selectionScope = grant(p, { newUnitSlots: [], units: [{ unitId: unit.id, allowSummary: false, allowAllScenes: false, maxNewScenes: 0,
    scenes: [{ sceneId: scene.id, allowPlan: false, allowBody: true, blockIds: ['block_target'], selection }] }] });
  const selected = buildAgentDraft(JSON.stringify({ summary: '字句', replacement: '脚步重新响起。' }),
    { candidateId: 'candidate_selection', operation: 'replace_selection', unitId: unit.id, sceneId: scene.id, selection }, p, selectionScope,
    { origin: p, ledger: emptyScriptDraftCreationLedger() });
  const selectedBlocks = applyWorkspacePatch(p, selected.patch).units[0].scenes[0].blocks;
  assert.deepEqual(selectedBlocks[0], scene.blocks[0]); assert.deepEqual(selectedBlocks.at(-1), scene.blocks.at(-1));
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: '字句', replacement: '不该写' }),
    { candidateId: 'candidate_stale', operation: 'replace_selection', unitId: unit.id, sceneId: scene.id,
      selection: { ...selection, text: '伪原文' } }, p, selectionScope, { origin: p, ledger: emptyScriptDraftCreationLedger() }), /原文已改变/);
});

test('character and fact addition require explicit shared scope and never self-approve facts', () => {
  const p = project(), s = grant(p);
  const character = result('add_character', { character: { localKey: 'mother', name: '母亲', desire: '', need: '', contradiction: '', arc: '', voice: '' } }, p, s);
  assert.equal(applyWorkspacePatch(p, character.patch).characters[0].scopeId, p.id);
  const fact = result('add_fact', { fact: { localKey: 'door', text: '门只在夜里打开' } }, p, s);
  assert.equal(applyWorkspacePatch(p, fact.patch).facts[0].status, 'draft');
  const denied = grant(p, { characterScopeIds: [], factScopeIds: [] });
  assert.throws(() => result('add_fact', { fact: { localKey: 'door', text: '门只在夜里打开' } }, p, denied), /越过冻结写作范围/);
});
