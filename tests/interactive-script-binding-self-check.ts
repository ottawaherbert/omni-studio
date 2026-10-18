import assert from 'node:assert/strict';
import { validateNodeScriptBinding, computeBindingsNeedingSourceReview } from '../src/domains/interactive/binding/scriptBindingManager.ts';
import {
  bindingNeedsContentReview,
  bindingNeedsMediaReview,
  recommendBindingSourceReview,
  reconcileBindingSourceReview,
} from '../src/domains/interactive/binding/sourceReview.ts';
import type { NodeContentBinding, ArtifactRef } from '../src/domains/interactive/types/schema.ts';

function runScriptBindingSelfCheck() {
  console.log('[Interactive Script Binding Self-Check] Running 1:1/1:N/N:1 binding and source-review impact tests...');

  const refV1: ArtifactRef = {
    artifactId: 'scene_101',
    versionId: 'v1.0.0',
    kind: 'script_scene',
    checksum: 'hash_v1',
  };

  const refV2: ArtifactRef = {
    artifactId: 'scene_101',
    versionId: 'v2.0.0',
    kind: 'script_scene',
    checksum: 'hash_v2',
  };

  const initialBindings: NodeContentBinding[] = [
    { nodeId: 'node_1', slot: 'main', scriptSceneRefs: [refV1] },
    { nodeId: 'node_2', slot: 'main', scriptSceneRefs: [refV1] }, // N:1 binding (2 nodes sharing 1 script scene)
    { nodeId: 'node_3', slot: 'main', scriptSceneRefs: [{ artifactId: 'scene_102', versionId: 'v1.0.0', kind: 'script_scene', checksum: 'hash_other' }] },
  ];

  // 1. Validation test
  const valResult = validateNodeScriptBinding('node_1', 'main', refV1, initialBindings);
  if (!valResult.valid) {
    throw new Error('Valid 1:1 script binding was rejected unexpectedly');
  }

  // 2. Source-review impact test
  const affectedNodes = computeBindingsNeedingSourceReview(refV2, initialBindings);
  if (!affectedNodes.includes('node_1') || !affectedNodes.includes('node_2')) {
    throw new Error(`Source review impact failed: expected node_1 & node_2, got ${JSON.stringify(affectedNodes)}`);
  }
  if (affectedNodes.includes('node_3')) {
    throw new Error('Source review impact incorrectly included unrelated node_3');
  }

  const pendingMediaBinding: NodeContentBinding = {
    nodeId: 'node_review_clock',
    slot: 'main',
    status: 'approved',
    scriptSceneRefs: [refV1],
    mediaTakeRefs: [{ artifactId: 'take_1', versionId: 'v1', kind: 'media_take', checksum: 'take_hash' }],
    contentFitReview: {
      verdict: 'pass',
      rationale: '作者已经复核当前节点内容仍匹配。',
      reviewedAt: '2026-01-01T00:00:02.000Z',
      sceneChecksums: [refV1.checksum],
    },
    mediaFitReview: {
      verdict: 'pass',
      rationale: '旧媒体复核发生在来源变化之前。',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      mediaChecksums: ['take_hash'],
    },
    sourceReview: {
      status: 'review_recommended',
      reasons: ['graph_updated'],
      detectedAt: '2026-01-01T00:00:01.000Z',
    },
  };
  assert.equal(bindingNeedsContentReview(pendingMediaBinding), false);
  assert.equal(bindingNeedsMediaReview(pendingMediaBinding), true);
  const withProjectionRefresh = recommendBindingSourceReview(
    pendingMediaBinding,
    ['visual_projection_updated'],
    '2026-01-01T00:00:03.000Z',
  );
  assert.equal(
    withProjectionRefresh.sourceReview?.detectedAt,
    '2026-01-01T00:00:03.000Z',
    'A newer media-only refresh must advance the media review clock',
  );
  assert.equal(withProjectionRefresh.sourceReview?.contentDetectedAt, '2026-01-01T00:00:01.000Z');
  assert.equal(withProjectionRefresh.sourceReview?.mediaDetectedAt, '2026-01-01T00:00:03.000Z');
  assert.equal(bindingNeedsContentReview(withProjectionRefresh), false);
  assert.equal(bindingNeedsMediaReview(withProjectionRefresh), true);
  const duplicateRefresh = recommendBindingSourceReview(
    withProjectionRefresh,
    ['visual_projection_updated'],
    '2026-01-01T00:00:03.000Z',
  );
  assert.equal(
    duplicateRefresh.sourceReview?.mediaDetectedAt,
    withProjectionRefresh.sourceReview?.mediaDetectedAt,
    'Repeating the same source event must not move the review clock again',
  );
  const lateOldReview = reconcileBindingSourceReview({
    ...withProjectionRefresh,
    mediaFitReview: {
      ...withProjectionRefresh.mediaFitReview!,
      reviewedAt: '2026-01-01T00:00:02.000Z',
    },
  });
  assert.equal(
    lateOldReview.sourceReview?.status,
    'review_recommended',
    'An in-flight review started before the latest media event must not clear that event',
  );
  const currentReview = reconcileBindingSourceReview({
    ...withProjectionRefresh,
    mediaFitReview: {
      ...withProjectionRefresh.mediaFitReview!,
      reviewedAt: '2026-01-01T00:00:04.000Z',
    },
  });
  assert.equal(currentReview.sourceReview?.status, 'current');

  console.log('[Interactive Script Binding Self-Check] PASSED. N:1/1:1 binding validation & focused source review verified.');
}

runScriptBindingSelfCheck();
