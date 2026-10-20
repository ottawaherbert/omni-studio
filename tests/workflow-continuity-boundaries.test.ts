import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoContinuityContext, type ContinuityShotEvidence } from '../packages/production/src/services/production/videoContinuityContext';
import { buildStoryboardUnitVideoPromptText, buildStoryboardUnitVideoPromptSourceHash } from '../src/services/production/storyboardUnitVideoPrompt';
import { skillApplicabilityHint } from '../packages/domain/src/skillMetadata';

const shots: (ContinuityShotEvidence & { duration?: number })[] = [
  { id: 'a', visualAction: '抬手', videoPrompt: '用右手握住钥匙', lightingAtmo: '暖色侧光' },
  { id: 'b', videoPrompt: '保持钥匙位置', duration: 4 },
  { id: 'c', videoPrompt: '放下钥匙', duration: 3 },
];
const context = (ids: string[]) => buildVideoContinuityContext({ sceneId: 'local', shots, unitShotIds: ids });

test('continuity rejects foreign, gapped, duplicate and reversed unit ranges', () => {
  for (const ids of [[], ['b', 'foreign'], ['a', 'c'], ['b', 'b'], ['c', 'b']]) assert.equal(context(ids), '');
  assert.match(context(['b', 'c']), /前一镜头.*用右手握住钥匙.*暖色侧光/);
  assert.match(context(['b', 'c']), /无本场后镜头/);
});

test('real unit compiler must not silently filter an invalid unit into a valid context', () => {
  const workflow = { shotId: 'b', shotIds: ['b', 'foreign'] } as any;
  assert.doesNotMatch(buildStoryboardUnitVideoPromptText({ workflow, shots: shots as any }), /本场视频连续性/);
});

test('adjacent action or light changes invalidate the stored unit source', () => {
  const workflow = { shotId: 'b', shotIds: ['b'] } as any;
  const hash = (values: typeof shots) => buildStoryboardUnitVideoPromptSourceHash({ workflow, shots: values as any });
  for (const patch of [{ videoPrompt: '改用左手握住钥匙' }, { lightingAtmo: '冷色顶光' }]) {
    assert.notEqual(hash(shots), hash([{ ...shots[0], ...patch }, ...shots.slice(1)]));
  }
  assert.match(buildStoryboardUnitVideoPromptText({ workflow, shots: shots as any }), /暖色侧光/);
});

test('scope advice uses user-facing format labels while retaining unknown metadata', () => {
  assert.match(skillApplicabilityHint({ applicability: { projectFormats: ['movie', 'future-format'] } }, { projectFormat: 'tv-series' }), /电影、future-format/);
});
