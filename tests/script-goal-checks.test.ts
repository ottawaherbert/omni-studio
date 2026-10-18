import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from 'js-sha256';
import { createScriptProject } from '../packages/script/src/project';
import type { ScriptProject } from '../packages/script/src/schema';
import {
  acceptFindingByAuthor, assessCheckCoverage, assessGoalCandidate, carryForwardUnchangedLocalReceipts,
  createCheckPlan, createGoalBodyManifest, markFindingRevised, validateCheckReceipt, verifyFinding,
  type CheckPlan, type CheckReceipt, type CheckTask, type GoalBodyManifest, type GoalCheckContract, type ReviewFinding,
} from '../packages/script/src/goalChecks';

const profile = { organization: 'standalone' as const, continuity: 'serialized' as const, workType: '电影短片', genres: ['剧情'], language: 'zh-CN',
  plannedUnits: 1, targetDurationMs: 300000, toleranceMs: 0, includeCredits: false, aspectRatio: '16:9' as const, productionMode: 'live-action' as const };
const project = (sceneCount = 1): ScriptProject => {
  const value = createScriptProject('机械验收', profile), unit = value.units[0];
  unit.scenes = Array.from({ length: sceneCount }, (_, index) => ({ id: `scene_${index}`, title: `第 ${index + 1} 场`, location: '门口', timeOfDay: '夜', storyTime: '', purpose: '计划，不作正文事实',
    entryState: '', exitState: '', characterIds: [], targetDurationMs: 0,
    blocks: [{ id: `block_${index}`, type: 'action' as const, text: `动作 ${index}：门口的脚步停下。` }] }));
  value.revision = 1;
  return value;
};
const contract = (unitId: string, patch: Partial<GoalCheckContract> = {}): GoalCheckContract => ({ revision: 1, targetUnitIds: [unitId],
  localChecks: [{ id: 'body-source', dependency: 'EXACT_BLOCKS' }],
  globalChecks: [{ id: 'cross-scene-continuity', dependency: 'WHOLE_MANUSCRIPT' }],
  maxRawChars: 4000, maxIndexEntries: 10, maxRepairRounds: 2, ...patch });
const receipt = (task: CheckTask, manifest: GoalBodyManifest, patch: Partial<CheckReceipt> = {}): CheckReceipt => ({
  id: `receipt:${task.id}`, taskId: task.id, taskFingerprint: task.fingerprint, manifestHash: manifest.hash,
  status: 'SUCCEEDED', schemaValidated: true,
  input: { source: 'FROZEN_SENT_REQUEST', contextRef: { id: `context:${task.id}`, digest: 'actual-context-digest' }, invocationId: `invocation:${task.id}`,
    inputHash: 'actual-request-hash', raw: structuredClone(task.requiredRaw), index: structuredClone(task.requiredIndex), omittedRaw: [], omittedIndex: [], evidence: [] },
  findings: [], summary: '机械检查摘要', modelClaimedAll: true, ...patch,
});
function completeReceipts(plan: CheckPlan, manifest: GoalBodyManifest): CheckReceipt[] {
  const results: CheckReceipt[] = [];
  for (const task of plan.tasks) {
    const evidence = task.requiredEvidenceTaskIds.map(taskId => {
      const source = results.find(item => item.taskId === taskId)!;
      return { taskId, receiptId: source.id, receiptDigest: sha256(JSON.stringify(source)), summary: source.summary, findings: source.findings };
    });
    const base = receipt(task, manifest);
    results.push({ ...base, input: { ...base.input, evidence } });
  }
  return results;
}
const artifact = (p: ScriptProject, manifest: GoalBodyManifest) => ({ kind: 'complete_candidate' as const, projectId: p.id, revision: p.revision,
  manifestHash: manifest.hash, unitIds: manifest.targetUnitIds });
function setup(p = project(), options: Partial<GoalCheckContract> = {}) {
  const c = contract(p.units[0].id, options), manifest = createGoalBodyManifest(p, c.targetUnitIds), plan = createCheckPlan(manifest, c);
  return { p, c, manifest, plan, receipts: completeReceipts(plan, manifest) };
}

test('more than 24k characters and 30 scenes produce complete raw/index batches without dropping the tail', () => {
  const p = project(31);
  p.units[0].scenes[0].blocks[0].text = '前段'.repeat(13000);
  p.units[0].scenes[30].blocks[0].text = '尾场：母亲已离开，女儿却仍看见她站在门口。';
  const h = setup(p), local = h.plan.tasks.filter(task => task.kind === 'LOCAL'), global = h.plan.tasks.filter(task => task.kind === 'GLOBAL');
  assert.ok(local.length >= 7); assert.ok(global.length > 4);
  assert.ok(local.flatMap(task => task.requiredRaw).some(span => span.sceneId === 'scene_30'));
  assert.ok(global.flatMap(task => task.requiredIndex).some(entry => entry.sceneId === 'scene_30'));
  assert.ok(global.flatMap(task => task.requiredRaw).some(span => span.sceneId === 'scene_30'), 'last scene needs boundary raw evidence');
  assert.ok(h.plan.tasks.every(task => task.requiredRaw.reduce((total, span) => total + span.end - span.start, 0) <= h.c.maxRawChars));
  assert.deepEqual(assessCheckCoverage(h.manifest, h.plan, h.receipts), { localComplete: true, globalComplete: true, missingTaskIds: [], invalidReceipts: [] });
});

test('model checkedAll cannot replace sent tail raw, omitted input, global task, or original index source', () => {
  const h = setup(project(3)), tail = h.manifest.units[0].scenes[2].blocks[0];
  const localTask = h.plan.tasks.find(task => task.kind === 'LOCAL' && task.requiredRaw.some(span => span.blockId === tail.blockId))!;
  const lied = receipt(localTask, h.manifest, { input: { ...receipt(localTask, h.manifest).input,
    raw: receipt(localTask, h.manifest).input.raw.filter(span => span.blockId !== tail.blockId), omittedRaw: [], omittedIndex: [] }, modelClaimedAll: true });
  assert.equal(validateCheckReceipt(h.manifest, h.plan, lied).valid, false);
  const trimmed = receipt(localTask, h.manifest, { input: { ...receipt(localTask, h.manifest).input, omittedRaw: [localTask.requiredRaw[0]] } });
  assert.equal(validateCheckReceipt(h.manifest, h.plan, trimmed).valid, false);
  const withoutGlobal = h.receipts.filter(item => h.plan.tasks.find(task => task.id === item.taskId)?.kind === 'LOCAL');
  const coverage = assessCheckCoverage(h.manifest, h.plan, withoutGlobal);
  assert.equal(coverage.localComplete, true); assert.equal(coverage.globalComplete, false);
  const indexTask = h.plan.tasks.find(task => task.phase === 'INDEX')!;
  const inventedIndex = receipt(indexTask, h.manifest, { input: { ...receipt(indexTask, h.manifest).input, index: [] } });
  assert.equal(validateCheckReceipt(h.manifest, h.plan, inventedIndex).valid, false);
  const finalSynthesis = [...h.plan.tasks].reverse().find(task => task.phase === 'SYNTHESIS')!;
  const synthesized = h.receipts.find(item => item.taskId === finalSynthesis.id)!;
  const fabricated = { ...synthesized, input: { ...synthesized.input,
    evidence: synthesized.input.evidence.map((source, index) => index ? source : { ...source, receiptDigest: 'fabricated' }) } };
  assert.equal(validateCheckReceipt(h.manifest, h.plan, fabricated, h.receipts).valid, false);
  assert.equal(assessCheckCoverage(h.manifest, h.plan, h.receipts.filter(item => item.taskId !== finalSynthesis.id)).globalComplete, false);
});

test('complete candidate requires current body, both check classes, no blocking or UNKNOWN, and exact artifact identity', () => {
  const h = setup(project(2));
  const base = { project: h.p, contract: h.c, manifest: h.manifest, plan: h.plan, receipts: h.receipts,
    findings: [] as ReviewFinding[], artifact: artifact(h.p, h.manifest), repairRoundsUsed: 0, unresolvedUnknown: false, outOfScopeWrites: false };
  const valid = assessGoalCandidate(base);
  assert.equal(valid.complete, true); assert.equal(valid.resultType, 'complete_candidate');
  for (const kind of ['LOCAL', 'GLOBAL'] as const) {
    const incompletePlan = { ...h.plan, tasks: h.plan.tasks.filter(task => task.kind !== kind) };
    assert.match(assessGoalCandidate({ ...base, plan: incompletePlan, receipts: [] }).gaps.join(' '), /检查计划缺少/);
  }
  assert.equal(assessGoalCandidate({ ...base, receipts: h.receipts.filter(item => h.plan.tasks.find(task => task.id === item.taskId)?.kind === 'LOCAL') }).complete, false);
  assert.match(assessGoalCandidate({ ...base, unresolvedUnknown: true }).gaps.join(' '), /未核对/);
  assert.match(assessGoalCandidate({ ...base, outOfScopeWrites: true }).gaps.join(' '), /范围外/);
  assert.match(assessGoalCandidate({ ...base, artifact: { ...artifact(h.p, h.manifest), revision: 99 } }).gaps.join(' '), /交付引用/);
  const stale = structuredClone(h.p); stale.units[0].scenes[1].blocks[0].text = '作者改了尾场正文'; stale.revision++;
  assert.match(assessGoalCandidate({ ...base, project: stale }).gaps.join(' '), /manifest/);
  const note = structuredClone(h.p); note.units[0].scenes[1].blocks = [{ id: 'note-only', type: 'note', text: '之后再写正文' }]; note.revision++;
  const noteManifest = createGoalBodyManifest(note, h.c.targetUnitIds), notePlan = createCheckPlan(noteManifest, h.c), noteReceipts = completeReceipts(notePlan, noteManifest);
  assert.match(assessGoalCandidate({ ...base, project: note, manifest: noteManifest, plan: notePlan, receipts: noteReceipts, artifact: artifact(note, noteManifest) }).gaps.join(' '), /空壳或笔记/);
  const missing = structuredClone(h.p); missing.units = [];
  assert.match(assessGoalCandidate({ ...base, project: missing }).gaps.join(' '), /目标单元/);
  const source = h.manifest.units[0].scenes[0].blocks[0];
  const untrackedFinding = { id: 'untracked', issue: '门口动作矛盾', suggestion: '检查相邻动作', severity: 'BLOCKING' as const,
    basis: 'RAW' as const, source: { unitId: source.unitId, sceneId: source.sceneId, blockId: source.blockId, start: 0, end: 2 }, uncertainty: '' };
  const localTask = h.plan.tasks.find(task => task.kind === 'LOCAL' && task.requiredRaw.some(span => span.blockId === source.blockId))!;
  const withUntracked = h.receipts.map(item => item.taskId === localTask.id ? { ...item, findings: [untrackedFinding] } : item);
  assert.match(assessGoalCandidate({ ...base, receipts: withUntracked }).gaps.join(' '), /未进入 ReviewSet/);
});

test('repair needs old baseline and bounded round; revision is not verification', () => {
  const h = setup(), source = h.manifest.units[0].scenes[0].blocks[0];
  const finding: ReviewFinding = { id: 'finding_1', issue: '行动前后不一致', suggestion: '核对门口动作', severity: 'BLOCKING', basis: 'RAW',
    source: { unitId: source.unitId, sceneId: source.sceneId, blockId: source.blockId, start: 0, end: 2 }, uncertainty: '', status: 'OPEN', manifestHash: h.manifest.hash };
  const changed = structuredClone(h.p); changed.revision++; changed.units[0].scenes[0].blocks[0].text = '修过的动作：门口的脚步停下。';
  const nextManifest = createGoalBodyManifest(changed, h.c.targetUnitIds), nextPlan = createCheckPlan(nextManifest, h.c);
  assert.throws(() => markFindingRevised(finding, { baselineManifestHash: h.manifest.hash, revisedManifestHash: nextManifest.hash, repairRound: 3, maxRepairRounds: 2 }), /返修轮数/);
  const revised = markFindingRevised(finding, { baselineManifestHash: h.manifest.hash, revisedManifestHash: nextManifest.hash, repairRound: 1, maxRepairRounds: 2 });
  assert.equal(revised.status, 'REVISED');
  const nextReceipts = completeReceipts(nextPlan, nextManifest), local = nextReceipts.find(item => nextPlan.tasks.find(task => task.id === item.taskId)?.kind === 'LOCAL')!;
  assert.match(assessGoalCandidate({ project: changed, contract: h.c, manifest: nextManifest, plan: nextPlan, receipts: nextReceipts,
    findings: [revised], artifact: artifact(changed, nextManifest), repairRoundsUsed: 1, unresolvedUnknown: false, outOfScopeWrites: false }).gaps.join(' '), /复查/);
  const stillThere = { ...local, findings: [{ ...finding }] };
  assert.throws(() => verifyFinding(revised, nextManifest, nextPlan, stillThere), /复查仍报告/);
  const verified = verifyFinding(revised, nextManifest, nextPlan, local);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(assessGoalCandidate({ project: changed, contract: h.c, manifest: nextManifest, plan: nextPlan, receipts: nextReceipts,
    findings: [verified], artifact: artifact(changed, nextManifest), repairRoundsUsed: 1, unresolvedUnknown: false, outOfScopeWrites: false }).complete, true);
  const later = structuredClone(changed); later.revision++; later.units[0].scenes[0].blocks[0].text += '之后又改。';
  const laterManifest = createGoalBodyManifest(later, h.c.targetUnitIds), laterPlan = createCheckPlan(laterManifest, h.c);
  assert.match(assessGoalCandidate({ project: later, contract: h.c, manifest: laterManifest, plan: laterPlan,
    receipts: completeReceipts(laterPlan, laterManifest), findings: [verified], artifact: artifact(later, laterManifest),
    repairRoundsUsed: 1, unresolvedUnknown: false, outOfScopeWrites: false }).gaps.join(' '), /复查回执已失效/);
  const accepted = acceptFindingByAuthor(finding, { authorCommandId: 'author-command', contractRevision: h.c.revision });
  assert.equal(accepted.status, 'AUTHOR_ACCEPTED');
  assert.throws(() => acceptFindingByAuthor(verified, { authorCommandId: 'fake-model', contractRevision: h.c.revision }), /不能由模型/);
});

test('only exact unchanged local tasks carry to new manifest; global and changed-block tasks expire', () => {
  const p = project(4), h = setup(p, { maxRawChars: 20, maxIndexEntries: 2 });
  const next = structuredClone(p); next.revision++; next.units[0].scenes[0].blocks[0].text = '动作 0：门口的脚步稍停。';
  const nextManifest = createGoalBodyManifest(next, h.c.targetUnitIds), nextPlan = createCheckPlan(nextManifest, h.c);
  const carried = carryForwardUnchangedLocalReceipts(h.manifest, h.plan, nextManifest, nextPlan, h.receipts);
  assert.ok(carried.length > 0);
  assert.ok(carried.every(item => nextPlan.tasks.find(task => task.id === item.taskId)?.kind === 'LOCAL'));
  assert.ok(carried.every(item => validateCheckReceipt(nextManifest, nextPlan, item).valid));
  assert.ok(carried.every(item => !nextPlan.tasks.find(task => task.id === item.taskId)?.requiredRaw.some(span => span.sceneId === 'scene_0')));
  const coverage = assessCheckCoverage(nextManifest, nextPlan, carried);
  assert.equal(coverage.localComplete, false); assert.equal(coverage.globalComplete, false);
});

test('large frozen index comparison is linear in serialization and rechecks mutated input next time',()=>{
 const h=setup(project(120),{maxIndexEntries:120}),task=h.plan.tasks.find(task=>task.phase==='INDEX'&&task.requiredIndex.length===120)!;
 const checked=h.receipts.find(receipt=>receipt.taskId===task.id)!;
 let reads=0;const entry=checked.input.index[119],original=entry.textHash;
 Object.defineProperty(entry,'textHash',{enumerable:true,configurable:true,get(){reads++;return original;}});
 assert.equal(validateCheckReceipt(h.manifest,h.plan,checked,h.receipts).valid,true);
 assert.ok(reads<10,`one frozen index entry was serialized ${reads} times`);
 Object.defineProperty(entry,'textHash',{enumerable:true,configurable:true,writable:true,value:'forged-after-validation'});
 assert.equal(validateCheckReceipt(h.manifest,h.plan,checked,h.receipts).valid,false);
 assert.equal(assessCheckCoverage(h.manifest,h.plan,h.receipts).globalComplete,false);
});
