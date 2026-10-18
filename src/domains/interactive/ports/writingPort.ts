import type { ArtifactRef } from '../types/schema';

/**
 * Read-only boundary between Interactive and Writing. Interactive never owns
 * script text: it selects immutable scene references exposed by this port.
 */
export interface InteractiveWritingProjectOption {
  id: string;
  title: string;
  format: string;
  revision: number;
  plannedUnitCount: number;
  writtenUnitCount: number;
}

export interface InteractiveWritingSceneOption {
  ref: ArtifactRef;
  writingProjectId: string;
  writingProjectTitle: string;
  writingProjectRevision: number;
  unitId: string;
  unitIndex: number;
  unitTitle: string;
  sceneId: string;
  sceneIndex: number;
  sceneTitle: string;
  synopsis: string;
  characters: string[];
  targetDurationSeconds?: number;
  scriptBlocks?: Array<{
    type: 'scene_heading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'prose';
    content: string;
  }>;
}

export interface InteractiveRuntimeStoryManifest {
  buildId: string;
  experienceId: string;
  nodes: Array<{
    nodeId: string;
    scenes: Array<InteractiveWritingSceneOption & {
      sourceKind?: 'writing_scene' | 'content_summary' | 'node_summary';
    }>;
  }>;
}

export interface InteractiveWritingGenerationStatus {
  state: 'idle' | 'working' | 'review' | 'failed' | 'ready';
  message?: string;
  checkpoint?: 'blueprint' | 'structure' | 'script';
  summary?: string;
}

export interface InteractiveWritingPort {
  listProjects(): InteractiveWritingProjectOption[];
  hasProject(projectId: string): boolean;
  listScenes(projectId: string): InteractiveWritingSceneOption[];
  getGenerationStatus(projectId: string): InteractiveWritingGenerationStatus;
  resolveScene(ref: ArtifactRef): InteractiveWritingSceneOption | null;
}
