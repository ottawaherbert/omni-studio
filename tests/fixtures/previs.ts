import type { Project, Scene, Episode } from '../../src/types/project';
import type { PrevisWorldPlan, PrevisPlan } from '../../packages/domain/src/previs';
export function previsFixture(id = 'previs-test') {
  const scene = { id: `${id}-scene`, title: '走进庭院', description: '人物从门口走向台阶，停下并望向窗边。', script: '外景，庭院，日。来访者穿过门洞，在台阶前停下，抬头看向窗边。', shots: [
    { id: `${id}-shot-1`, duration: 2, visualAction: '人物从门口走向台阶', characterIdsInShot: [`${id}-actor`], imagePrompt: '人物走向台阶', locationId: `${id}-yard` },
    { id: `${id}-shot-2`, duration: 2, visualAction: '人物抬头看向窗边', characterIdsInShot: [`${id}-actor`], imagePrompt: '人物抬头', locationId: `${id}-yard` },
  ] } as Scene;
  const otherScene = { ...structuredClone(scene), id: `${id}-scene-2`, title: '次日重访', shots: [{ ...scene.shots![0], id: `${id}-shot-3` }] };
  const episodes = [{ id: `${id}-episode`, title: '第一集', scenes: [scene] }, { id: `${id}-episode-2`, title: '第二集', scenes: [otherScene] }] as Episode[];
  const project = { id, title: '庭院预演 · 隔离验收', type: 'movie', aspectRatio: '16:9', characters: [{ id: `${id}-actor`, name: '来访者' }], assets: [{ id: `${id}-yard`, name: '庭院', type: 'location' }], episodes } as unknown as Project;
  const world: PrevisWorldPlan = { schemaVersion: 'previs-world.v1', title: '全剧影视城', description: '两集共用同一个庭院；第二集没有重新搭景。', locations: [{ id: 'courtyard', name: '庭院', description: '北面门洞，西侧台阶；窗与出入口固定。', origin: [0, 0, 0], ground: [18, 14], assetId: `${id}-yard`, sourceSceneIds: [scene.id, otherScene.id] }], objects: [
    { id: 'wall-west', label: '西墙', kind: 'box', locationId: 'courtyard', position: [-6, 0, -2], rotation: [0, 0, 0], size: [.5, 3.8, 8], color: '#aab2b5', pose: 'stand' },
    { id: 'gate-left', label: '门洞左侧', kind: 'box', locationId: 'courtyard', position: [-3, 0, -5], rotation: [0, 0, 0], size: [4, 3.8, .5], color: '#aab2b5', pose: 'stand' },
    { id: 'gate-right', label: '门洞右侧', kind: 'box', locationId: 'courtyard', position: [3, 0, -5], rotation: [0, 0, 0], size: [4, 3.8, .5], color: '#aab2b5', pose: 'stand' },
    { id: 'lintel', label: '门楣', kind: 'box', locationId: 'courtyard', position: [0, 3, -5], rotation: [0, 0, 0], size: [2, .8, .5], color: '#aab2b5', pose: 'stand' },
    { id: 'steps', label: '台阶', kind: 'stairs', locationId: 'courtyard', position: [-4, 0, 1], rotation: [0, -Math.PI / 2, 0], size: [3, 1.4, 3], color: '#c2c7ca', pose: 'stand' },
    { id: 'column', label: '石柱地标', kind: 'cylinder', locationId: 'courtyard', position: [4, 0, -2], rotation: [0, 0, 0], size: [.7, 3, .7], color: '#aab2b5', pose: 'stand' },
  ] };
  const actorId = 'visitor';
  const plan: PrevisPlan = { schemaVersion: 'scene-previs.v1', locationId: 'courtyard', light: { position: [5, 10, 4], intensity: 2 }, objects: [{ id: actorId, assetId: `${id}-actor`, label: '来访者', kind: 'actor', position: [-1, 0, -3], rotation: [0, 0, 0], size: [.6, 1.8, .4], color: '#b5c8d0', pose: 'walk' }], frames: [
    { id: 'wide-start', shotId: scene.shots![0].id, label: '庭院全景', timeInShot: 0, note: '从门口进入', camera: { position: [8, 4, 10], target: [0, 1, -1], focalLength: 28 }, states: {} },
    { id: 'wide-end', shotId: scene.shots![0].id, label: '向台阶靠近', timeInShot: 2, note: '沿原路线走到台阶前', camera: { position: [5, 3, 8], target: [-2, 1, 0], focalLength: 32 }, states: { [actorId]: { position: [-2, 0, 0] } } },
    { id: 'close-start', shotId: scene.shots![1].id, label: '反应近景', timeInShot: 0, note: '停下，视线望向西侧', camera: { position: [-.5, 2, 4], target: [-2, 1.3, 0], focalLength: 50 }, states: { [actorId]: { position: [-2, 0, 0], rotation: [0, -.8, 0], pose: 'stand' } } },
  ] };
  const otherPlan = { ...structuredClone(plan), frames: [{ ...structuredClone(plan.frames[0]), id: 'next-day', shotId: otherScene.shots[0].id }] };
  return { project, episodes, scene, otherScene, world, plan, otherPlan };
}

/** Offline provider metadata for handoff tests; callers must not submit to this URL. */
export async function previsGenerationConfig() {
  const { defaultAIConfig } = await import('../../src/config/aiConfigDefaults');
  return { ...structuredClone(defaultAIConfig), channels: [{ id: 'preview-only', name: '隔离参数验收', type: 'comfyui' as const, baseUrl: 'https://example.invalid', apiKey: '' }],
    models: [{ id: 'preview-model', modelId: 'qwen', alias: '隔离参考图能力', channelId: 'preview-only', capabilities: ['image' as const], comfyWorkflowId: 'preview-workflow' }],
    comfyWorkflows: [{ id: 'preview-workflow', name: '隔离参考图能力', channelId: 'preview-only', kind: 'api_graph' as const,
      workflowJson: { '1': { class_type: 'TextEncodeQwenImage21', inputs: { prompt: '', 'images.image_1': ['90', 0], 'images.image_2': ['91', 0] } }, '2': { class_type: 'EmptyLatentImage', inputs: { width: 640, height: 360 } }, '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 12 } }, '90': { class_type: 'LoadImage', inputs: { image: '' } }, '91': { class_type: 'LoadImage', inputs: { image: '' } } },
      mappings: [{ systemParam: 'prompt' as const, nodeId: '1', nodeInput: 'prompt' }, { systemParam: 'width' as const, nodeId: '2', nodeInput: 'width' }, { systemParam: 'height' as const, nodeId: '2', nodeInput: 'height' }, { systemParam: 'seed' as const, nodeId: '3', nodeInput: 'seed' }, { systemParam: 'image:0' as const, nodeId: '90', nodeInput: 'image' }, { systemParam: 'image:1' as const, nodeId: '91', nodeInput: 'image' }],
      api: { operation: 'i2i' as const, imageInputs: 2, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 14 } }] };
}
