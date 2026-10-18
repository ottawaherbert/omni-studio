import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';
import { buildAgentDraft } from '../packages/script/src/agentDraft';
import { emptyScriptDraftCreationLedger, selectionBlockIds, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { applyWorkspacePatch } from '../packages/script/src/workspacePatch';

// Independent mechanical scope faults: no creative model output is simulated.
function scopeFixture() {
  const current = createScriptProject('机械范围测试', createScriptCreationProfile('tv-series', 2, 20));
  const unit = current.units[0], scene = unit.scenes[0];
  scene.blocks = [
    { id: 'allowed_block', type: 'action', text: 'ALLOWED_MARKER' },
    { id: 'protected_block', type: 'action', text: 'PROTECTED_MARKER' },
  ];
  const scope: ScriptDraftScope = {
    workspaceId: 'workspace_scope_review', documentId: current.id, originRevision: current.revision, originContentHash: hashValue(current),
    operations: ['replace_blocks', 'replace_selection', 'scene_body'],
    units: [{ unitId: unit.id, allowSummary: false, allowAllScenes: false, maxNewScenes: 0,
      scenes: [{ sceneId: scene.id, allowPlan: false, allowBody: true, blockIds: ['allowed_block'] }] }],
    newUnitSlots: [], sharedFields: [], characterScopeIds: [], factScopeIds: [],
  };
  return { current, unit, scene, scope, check: { origin: structuredClone(current), ledger: emptyScriptDraftCreationLedger() } };
}

test('block-only authority cannot select protected text through the selection operation', () => {
  const h = scopeFixture(), rendered = blocksToScreenplayText(h.scene.blocks);
  const start = rendered.indexOf('PROTECTED_MARKER');
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: 'MECHANICAL_SCOPE_PROBE', replacement: 'CHANGED_MARKER' }),
    { candidateId: 'candidate_scope_probe', operation: 'replace_selection', unitId: h.unit.id, sceneId: h.scene.id,
      selection: { start, end: start + 'PROTECTED_MARKER'.length, text: 'PROTECTED_MARKER' } }, h.current, h.scope, h.check));
  assert.equal(h.current.units[0].scenes[0].blocks[1].text, 'PROTECTED_MARKER');
});

test('an exact text-selection grant cannot be escalated to whole-scene replacement', () => {
  const h = scopeFixture();
  h.scope.units[0].scenes[0].blockIds = null;
  h.scope.units[0].scenes[0].selection = { start: 0, end: 'ALLOWED_MARKER'.length, text: 'ALLOWED_MARKER' };
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: 'MECHANICAL_SCOPE_PROBE', blocks: [{ localKey: 'b', type: 'action', text: 'WHOLE_SCENE_CHANGED', speakerId: null, speakerName: null }] }),
    { candidateId: 'candidate_scene_probe', operation: 'scene_body', unitId: h.unit.id, sceneId: h.scene.id }, h.current, h.scope, h.check));
});

test('an exact text-selection grant cannot be escalated to replacement of the enclosing block', () => {
  const h = scopeFixture();
  h.scope.units[0].scenes[0].selection = { start: 0, end: 3, text: 'ALL' };
  assert.throws(() => buildAgentDraft(JSON.stringify({ summary: 'MECHANICAL_SCOPE_PROBE', blocks: [{ localKey: 'b', type: 'action', text: 'ENTIRE_ALLOWED_BLOCK_CHANGED', speakerId: null, speakerName: null }] }),
    { candidateId: 'candidate_block_probe', operation: 'replace_blocks', unitId: h.unit.id, sceneId: h.scene.id, blockIds: ['allowed_block'] }, h.current, h.scope, h.check));
});

for (const type of ['action', 'dialogue', 'parenthetical', 'transition', 'note'] as const) test(`editing a word preserves raw whitespace outside the selected word in ${type}`, () => {
  const h = scopeFixture();
  h.scene.blocks[0] = { ...h.scene.blocks[0], type, text: '  KEEP_PREFIX ALLOWED KEEP_SUFFIX  ', ...(type === 'dialogue' ? { speakerName: '协议角色' } : {}) };
  h.scope.originContentHash = hashValue(h.current); h.check.origin = structuredClone(h.current);
  const rendered = blocksToScreenplayText(h.scene.blocks), start = rendered.indexOf('ALLOWED');
  const selection = { start, end: start + 'ALLOWED'.length, text: 'ALLOWED' };
  h.scope.units[0].scenes[0].selection = selection;
  const candidate = buildAgentDraft(JSON.stringify({ summary: 'MECHANICAL_WHITESPACE_PROBE', replacement: 'CHANGED' }),
    { candidateId: 'candidate_whitespace_probe', operation: 'replace_selection', unitId: h.unit.id, sceneId: h.scene.id, selection }, h.current, h.scope, h.check);
  const changed = applyWorkspacePatch(h.current, candidate.patch);
  assert.equal(changed.units[0].scenes[0].blocks[0].text, '  KEEP_PREFIX CHANGED KEEP_SUFFIX  ');
  assert.deepEqual(changed.units[0].scenes[0].blocks[1], h.scene.blocks[1]);
});

test('repeated rendered text across a block boundary does not change the raw selection origin',()=>{
  const h=scopeFixture();h.scene.blocks[0].text='KEEP\n\nKEEP';h.scene.blocks[1].text='KEEP';
  h.scope.originContentHash=hashValue(h.current);h.check.origin=structuredClone(h.current);
  const selection={start:6,end:10,text:'KEEP'};h.scope.units[0].scenes[0].selection=selection;
  const candidate=buildAgentDraft(JSON.stringify({summary:'MECHANICAL_REPEATED_BLOCK_PROBE',replacement:'CHANGED'}),
    {candidateId:'candidate_repeated_block',operation:'replace_selection',unitId:h.unit.id,sceneId:h.scene.id,selection},h.current,h.scope,h.check);
  const changed=applyWorkspacePatch(h.current,candidate.patch);
  assert.equal(changed.units[0].scenes[0].blocks[0].text,'KEEP\n\nCHANGED');
  assert.deepEqual(changed.units[0].scenes[0].blocks[1],h.scene.blocks[1]);
});

for(const target of ['parenthetical','dialogue'] as const)test(`paired dialogue selection changes only ${target} raw text`,()=>{
  const h=scopeFixture();
  h.scene.blocks=[
    {id:'before',type:'action',text:'前一段。'},
    {id:'parenthetical',type:'parenthetical',text:'  （低声）  '},
    {id:'dialogue',type:'dialogue',speakerName:'阿明',text:'  别出声。  '},
    {id:'after',type:'action',text:'后一段。'},
  ];
  const original=structuredClone(h.scene.blocks);
  h.scope.originContentHash=hashValue(h.current);h.check.origin=structuredClone(h.current);
  h.scope.units[0].scenes[0].blockIds=[target];
  const rendered=blocksToScreenplayText(h.scene.blocks);
  const selected=target==='parenthetical'?'低声':'别出声。';
  const start=rendered.indexOf(selected);
  const selection={start,end:start+selected.length,text:selected};
  assert.deepEqual(selectionBlockIds(h.current,h.unit.id,h.scene.id,selection),[target]);
  h.scope.units[0].scenes[0].selection=selection;
  const replacement=target==='parenthetical'?'耳语':'别开门。';
  const candidate=buildAgentDraft(JSON.stringify({summary:'组合对白局部改写',replacement}),
    {candidateId:`paired_${target}`,operation:'replace_selection',unitId:h.unit.id,sceneId:h.scene.id,selection},h.current,h.scope,h.check);
  const changed=applyWorkspacePatch(h.current,candidate.patch).units[0].scenes[0].blocks;
  assert.equal(changed[1].text,target==='parenthetical'?'  （耳语）  ':original[1].text);
  assert.equal(changed[2].text,target==='dialogue'?'  别开门。  ':original[2].text);
  assert.deepEqual(changed.map(block=>block.id),original.map(block=>block.id));
  assert.deepEqual(changed[0],original[0]);
  assert.deepEqual(changed[3],original[3]);
  assert.deepEqual(h.scene.blocks,original);
});
