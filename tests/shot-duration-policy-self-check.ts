import assert from 'node:assert/strict';
import { evaluateStandaloneShotDuration, evaluateVideoUnitDuration } from '../src/services/production/shotDurationPolicy';
import { validateStoryboardRules } from '../src/services/production/ruleQa';
import { reviewProductionTiming } from '../src/services/production/productionTiming';
import { initialGenerationDuration, type GenerationCapability } from '../packages/domain/src/generation';

for (const duration of [0.4, 1, 2, 6.8, 45]) {
  assert.equal(evaluateStandaloneShotDuration({ duration }).valid, true);
  assert.equal(evaluateVideoUnitDuration(duration).valid, true);
}
for (const duration of [0, -1, NaN, Infinity]) assert.equal(evaluateStandaloneShotDuration({ duration }).valid, false);
const issues = validateStoryboardRules([{ id: 'ep', scenes: [{ id: 's', title: '短插入', shots: [{ id: 'short', duration: 0.4, visualAction: '开关弹下' }] }] }] as any);
assert.ok(!issues.some(i => i.target === 'shot.short.duration'));
const equal = ['a','b','c'].map(id => ({ id, duration: 12, visualAction: '开关弹下', cameraMovement: '缓慢推进' }));
const snapshot = JSON.stringify(equal), review = reviewProductionTiming(equal, ['a']);
assert.ok(review.issues.some(i => i.code === 'TIMING_UNIFORM_SCENE'));
assert.ok(review.issues.some(i => i.code === 'TIMING_BASIS_MISSING' && i.message.includes('a')));
assert.ok(review.issues.every(i => !i.blocking));
assert.equal(JSON.stringify(equal), snapshot, 'reading never redistributes durations or edits works');
const described = reviewProductionTiming(equal.map(s => ({ ...s, motivation: '让观众发现灯亮了', editingNote: '完成点亮后留一拍反应切出；有意等长的节奏实验' })), ['b']);
assert.equal(described.shots[0].basisStatus, 'described');
assert.equal(described.creativeStatus, 'not_assessed', 'notes are not creative approval');
assert.ok(described.issues.some(i => i.code === 'TIMING_UNIFORM_SCENE'));
assert.equal(reviewProductionTiming(equal, []).issues.length, 0);
const cap = { minDuration: 5, maxDuration: 14, parameters: [{key:'duration', default:10, integer:true}] } as GenerationCapability;
assert.equal(initialGenerationDuration(0.4, cap), 5);
assert.equal(initialGenerationDuration(6.8, cap), 7);
assert.equal(initialGenerationDuration(16, cap), 16, 'do not truncate narrative to fit provider');
assert.equal(initialGenerationDuration(6.8, { ...cap, durations:[5,10] }), 10);
console.log('Timing checks passed: fractional edits, scoped warnings, no false acceptance, provider padding.');
