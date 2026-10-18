import type { ArtifactRef, NodeContentBinding } from '../types/schema.ts';

export interface MediaTakeRecord {
  takeId: string;
  isPrimary: boolean;
  videoUrl: string;
  durationSeconds: number;
  checksum: string;
}

export function switchPrimaryMediaTake(
  currentBinding: NodeContentBinding,
  newTake: MediaTakeRecord
): NodeContentBinding {
  const updatedRef: ArtifactRef = {
    artifactId: newTake.takeId,
    versionId: `take_${newTake.takeId}`,
    kind: 'media_take',
    checksum: newTake.checksum,
  };

  return {
    ...currentBinding,
    mediaTakeRef: undefined,
    mediaTakeRefs: [updatedRef],
    // A new take changes the visual performance. It requires a fresh author
    // confirmation before a RuntimeBuild can call the node media-ready.
    mediaFitReview: undefined,
    lockedAt: new Date().toISOString(),
  };
}
