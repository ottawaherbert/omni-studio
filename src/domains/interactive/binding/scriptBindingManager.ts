import type { ArtifactRef, NodeContentBinding } from '../types/schema.ts';
import {
  artifactRefListEquals,
  bindingScriptSceneRefs,
  hasDuplicateArtifactRefs,
} from './nodeContentBinding.ts';

export interface BindingValidationResult {
  valid: boolean;
  message?: string;
}

export function validateNodeScriptBinding(
  nodeId: string,
  slot: NodeContentBinding['slot'],
  scriptSceneRefs: ArtifactRef | ArtifactRef[],
  existingBindings: NodeContentBinding[]
): BindingValidationResult {
  const refs = Array.isArray(scriptSceneRefs) ? scriptSceneRefs : [scriptSceneRefs];
  if (refs.some((ref) => !ref.artifactId || !ref.versionId || ref.kind !== 'script_scene')) {
    return { valid: false, message: '无效的共享剧本 Artifact 引用（缺失 ID 或 Version）' };
  }
  if (hasDuplicateArtifactRefs(refs)) return { valid: false, message: '同一节点不能重复播放相同剧本场次' };

  // 1:1 or 1:N or N:1 Check
  const sameSlotBinding = existingBindings.find(
    (b) => b.nodeId === nodeId && b.slot === slot
  );

  if (sameSlotBinding && artifactRefListEquals(bindingScriptSceneRefs(sameSlotBinding), refs)) {
    return { valid: true, message: '绑定已存在且一致' };
  }

  return { valid: true };
}

export function computeBindingsNeedingSourceReview(
  updatedScriptRef: ArtifactRef,
  allBindings: NodeContentBinding[]
): string[] {
  const affectedNodeIds: string[] = [];

  for (const binding of allBindings) {
    for (const scriptSceneRef of bindingScriptSceneRefs(binding)) {
      if (
        scriptSceneRef.artifactId === updatedScriptRef.artifactId
        && scriptSceneRef.versionId !== updatedScriptRef.versionId
      ) {
        affectedNodeIds.push(binding.nodeId);
      }
    }
  }

  return Array.from(new Set(affectedNodeIds));
}
