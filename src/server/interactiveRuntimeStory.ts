import type { InteractiveRuntimeBuild } from '../domains/interactive/types/schema';
import type { InteractiveWritingPort, InteractiveRuntimeStoryManifest } from '../domains/interactive/ports/writingPort';

export const resolveInteractiveRuntimeStory = (build: InteractiveRuntimeBuild, port: InteractiveWritingPort): InteractiveRuntimeStoryManifest => {
  const nodes = build.nodeManifests.map((manifest) => {
    const scenes = manifest.scriptSceneRefs.map((ref) => port.resolveScene(ref)).filter(Boolean);
    if (scenes.length !== manifest.scriptSceneRefs.length && build.kind !== 'structure_preview') {
      throw Object.assign(
        new Error(`“${manifest.title}”引用的剧本场次已不可读取，请重新生成试玩。`),
        { statusCode: 422 },
      );
    }
    if (scenes.length > 0) {
      return {
        nodeId: manifest.nodeId,
        scenes: scenes.map((scene) => ({ ...scene!, sourceKind: 'writing_scene' as const })),
      };
    }
    const summary = build.previewTextByNodeId?.[manifest.nodeId] || manifest.title;
    return {
      nodeId: manifest.nodeId,
      scenes: [{
        ref: {
          artifactId: manifest.nodeId,
          versionId: build.graphVersionId,
          kind: 'script_scene' as const,
          checksum: `${build.graphVersionId}:${manifest.nodeId}:structure-preview`,
        },
        writingProjectId: '',
        writingProjectTitle: '结构试玩',
        writingProjectRevision: build.graphVersionIndex,
        unitId: 'structure-preview',
        unitIndex: 0,
        unitTitle: '结构试玩',
        sceneId: manifest.nodeId,
        sceneIndex: 1,
        sceneTitle: manifest.title,
        synopsis: summary,
        characters: [],
        targetDurationSeconds: (() => {
          const range = build.graphSnapshot?.nodes.find((node) => node.id === manifest.nodeId)
            ?.interaction?.durationRangeSec;
          return range ? (range[0] + range[1]) / 2 : 60;
        })(),
        scriptBlocks: [{ type: 'action' as const, content: summary }],
        sourceKind: 'node_summary' as const,
      }],
    };
  });
  return { buildId: build.id, experienceId: build.experienceId, nodes };
};
