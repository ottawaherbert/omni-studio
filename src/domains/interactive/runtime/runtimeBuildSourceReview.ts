import type { InteractiveExperienceAggregate, InteractiveRuntimeBuild } from '../types/schema';
import { artifactRefListEquals, bindingMediaTakeRefs, bindingScriptSceneRefs } from '../binding/nodeContentBinding';
import { hasCurrentMediaFitReview } from '../binding/contentFitReview';

/** Source changes offer a new build without mutating the existing playable snapshot. */
export const runtimeBuildHasSourceChanges = (
  build: InteractiveRuntimeBuild,
  aggregate: InteractiveExperienceAggregate,
) => build.graphVersionId !== aggregate.graph.id
  || build.stateSchemaVersionId !== aggregate.stateSchema.id
  || JSON.stringify(build.experienceSpecSnapshot) !== JSON.stringify(aggregate.experienceSpec.data)
  || aggregate.bindings.some((binding) => binding.sourceReview?.status === 'review_recommended')
  || build.nodeManifests.some((manifest) => {
    const binding = aggregate.bindings.find((item) => item.nodeId === manifest.nodeId && item.slot === 'main');
    if (!artifactRefListEquals(bindingScriptSceneRefs(manifest), bindingScriptSceneRefs(binding))) return true;
    if (manifest.bindingVersionIndex !== undefined) {
      const approvedVersion = binding?.status === 'approved' && bindingScriptSceneRefs(binding).length
        ? binding.versionIndex || 0 : 0;
      return manifest.bindingVersionIndex !== approvedVersion;
    }
    // Legacy builds did not freeze a binding revision. Compare their preserved
    // selections and review readiness, using the same rule as formal builds.
    if (Date.parse(binding?.updatedAt || '') > Date.parse(build.createdAt)) return true;
    if (build.kind === 'structure_preview') return false;
    if (!artifactRefListEquals(manifest.mediaTakeRefs, bindingMediaTakeRefs(binding))) return true;
    if (!manifest.requiresMedia || !manifest.mediaTakeRefs.length) return false;
    return build.pendingMediaReviewNodeIds.includes(manifest.nodeId) === hasCurrentMediaFitReview(binding);
  });
