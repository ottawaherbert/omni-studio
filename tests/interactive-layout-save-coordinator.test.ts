import assert from 'node:assert/strict';
import { createGraphLayoutSaveCoordinator } from '../src/features/interactive/graphLayoutSaveCoordinator.ts';
import type { GraphLayoutRevision } from '../src/domains/interactive/types/schema.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const initial = {
  id: 'layout-1', experienceId: 'experience-1', versionIndex: 1,
  createdAt: '2026-10-09T00:00:00.000Z',
  nodes: { chapterA: { x: 10, y: 20 }, chapterB: { x: 30, y: 40 } },
  viewport: { x: 0, y: 0, zoom: 1 },
} as GraphLayoutRevision;

const writes: Array<{ expected: number; nodes: GraphLayoutRevision['nodes']; pending: ReturnType<typeof deferred<GraphLayoutRevision>> }> = [];
let latest = initial;
const errors: unknown[] = [];
const saver = createGraphLayoutSaveCoordinator({
  initial,
  persist: (layout, expected) => {
    const pending = deferred<GraphLayoutRevision>();
    writes.push({ expected, nodes: structuredClone(layout.nodes), pending });
    return pending.promise;
  },
  onChange: (value) => { latest = value; },
  onError: (error) => { errors.push(error); },
});

saver.update({ nodes: { chapterA: { x: 100, y: 200 } }, viewport: initial.viewport });
assert.equal(writes.length, 1);
assert.deepEqual(writes[0].nodes.chapterB, initial.nodes.chapterB, 'Hidden chapter must remain in persisted layout');
assert.equal(writes[0].expected, 1);

saver.update({ nodes: { chapterB: { x: 300, y: 400 } }, viewport: initial.viewport });
assert.equal(writes.length, 1, 'Updates during a write must be serialized');
writes[0].pending.resolve({ ...initial, id: 'layout-2', versionIndex: 2, nodes: writes[0].nodes });
await Promise.resolve();
await Promise.resolve();
assert.equal(writes.length, 2);
assert.equal(writes[1].expected, 2, 'Next write must use the acknowledged revision');
assert.deepEqual(writes[1].nodes, { chapterA: { x: 100, y: 200 }, chapterB: { x: 300, y: 400 } });

const failed = new Error('layout conflict');
writes[1].pending.reject(failed);
await assert.rejects(saver.flush(), /layout conflict/);
assert.equal(errors[0], failed);
assert.equal(saver.pending, true);
assert.deepEqual(latest.nodes.chapterA, { x: 100, y: 200 });

const retry = saver.flush();
assert.equal(writes.length, 3, 'Explicit flush should retry the unsaved position');
assert.equal(writes[2].expected, 2);
writes[2].pending.resolve({ ...initial, id: 'layout-3', versionIndex: 3, nodes: writes[2].nodes });
await retry;
assert.equal(saver.pending, false);
assert.equal(latest.versionIndex, 3);
assert.deepEqual(latest.nodes.chapterB, { x: 300, y: 400 });
console.log('[Interactive Layout Save Coordinator] PASSED');
