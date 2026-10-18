import type { ArtifactRef, NodeContentBinding } from '../types/schema';

export const sameArtifactRef = (left?: ArtifactRef, right?: ArtifactRef) => {
  if (!left || !right) return left === right;
  return left.kind === right.kind
    && left.artifactId === right.artifactId
    && left.versionId === right.versionId
    && left.checksum === right.checksum;
};

/** New bindings own an ordered list; the singular field is read-only legacy input. */
export const bindingScriptSceneRefs = (
  binding?: Pick<NodeContentBinding, 'scriptSceneRefs' | 'scriptSceneRef'>,
): ArtifactRef[] => {
  if (!binding) return [];
  if (binding.scriptSceneRefs) return [...binding.scriptSceneRefs];
  return binding.scriptSceneRef ? [binding.scriptSceneRef] : [];
};

export const bindingMediaTakeRefs = (
  binding?: Pick<NodeContentBinding, 'mediaTakeRefs' | 'mediaTakeRef' | 'mediaScenarios'>,
): ArtifactRef[] => {
  if (!binding) return [];
  if (binding.mediaTakeRefs) return [...binding.mediaTakeRefs];
  if (binding.mediaScenarios?.length) {
    const seen = new Set<string>();
    return binding.mediaScenarios.flatMap((scenario) => scenario.mediaTakeRefs)
      .filter((ref) => {
        const identity = artifactRefIdentity(ref);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
  }
  return binding.mediaTakeRef ? [binding.mediaTakeRef] : [];
};

export const artifactRefListEquals = (left: ArtifactRef[], right: ArtifactRef[]) =>
  left.length === right.length && left.every((ref, index) => sameArtifactRef(ref, right[index]));

export const artifactRefIdentity = (ref: ArtifactRef) =>
  `${ref.kind}:${ref.artifactId}:${ref.versionId}:${ref.checksum}`;

export const hasDuplicateArtifactRefs = (refs: ArtifactRef[]) =>
  new Set(refs.map(artifactRefIdentity)).size !== refs.length;
