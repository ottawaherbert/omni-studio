import type { InteractiveExperienceAggregate, InteractiveRuntimeBuild } from '../types/schema';
import type { InteractiveRuntimeStoryManifest } from '../ports/writingPort';
import type { InteractiveRuntimeMediaManifest } from '../ports/productionPrepPort';

export interface InteractiveStandalonePackage {
  schemaVersion: 'interactive-player.v1';
  aggregate: InteractiveExperienceAggregate;
  build: InteractiveRuntimeBuild;
  story: InteractiveRuntimeStoryManifest;
  media: InteractiveRuntimeMediaManifest | null;
}
