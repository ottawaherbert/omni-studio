import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectShotEditingEvidence, withSceneVisualCoherenceContract } from '../packages/production/src/services/production/sceneVisualCoherence';
import { projectStoryboardVisualPromptSourceShot } from '../src/services/production/storyboardVisualPromptAgent';
import { buildVideoContinuityContext } from '../packages/production/src/services/production/videoContinuityContext';

const authored = { id: 'reverse', motivation: '给观众看角色反应', editingNote: '有意越轴，由开门声建立新方向', continuityNote: '玉佩已破，追兵已退场' };
assert.deepEqual(projectShotEditingEvidence(authored), { motivation: authored.motivation, editingNote: authored.editingNote, continuityNote: authored.continuityNote });
const qaInput = projectStoryboardVisualPromptSourceShot(authored);
assert.equal(qaInput.editingNote, authored.editingNote);
assert.equal(qaInput.continuityNote, authored.continuityNote);
const customPrompt = '作者自定义：保留原对白，允许反打。';
const upgraded = withSceneVisualCoherenceContract(customPrompt);
assert.ok(upgraded.startsWith(customPrompt), 'Persisted custom text must survive upgrading');
assert.equal(withSceneVisualCoherenceContract(upgraded), upgraded);
const shots = [{ id: 'a', visualAction: '放下剑' }, authored, { id: 'c', visualAction: '走出门' }];
assert.equal(buildVideoContinuityContext({ sceneId: 'scene', shots, unitShotIds: ['c', 'a'] }), '');
assert.equal(buildVideoContinuityContext({ sceneId: 'scene', shots, unitShotIds: ['a', 'c'] }), '');
assert.equal(buildVideoContinuityContext({ sceneId: 'scene', shots, unitShotIds: ['foreign'] }), '');
assert.match(buildVideoContinuityContext({ sceneId: 'scene', shots, unitShotIds: ['reverse'] }), /有意越轴，由开门声建立新方向/);

// Regression for the actual image authoring path, where continuity was previously video-only.
const hook = readFileSync('src/hooks/useStoryboardAI.ts', 'utf8');
const projection = hook.slice(hook.indexOf('const projectShotForVisualPrompt ='), hook.indexOf('const meaningfulStoryboardPromptValue'));
assert.match(projection, /\.\.\.projectShotEditingEvidence\(shot\)/);
assert.doesNotMatch(projection, /promptKind === "video"[^\n]*continuityNote/);
console.log('Scene visual coherence evidence and custom-template regression passed.');
