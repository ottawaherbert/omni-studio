import imageGraph from './qwen-image-2.1-t2i.json';
import videoGraph from './minimax-h3-t2v.json';
import referenceVideoGraph from './minimax-h3-reference-3.json';
import actionVideoGraph from './minimax-h3-action-3.json';
import imageReferenceGraph from './qwen-image-2.1-reference.json';
import firstFrameGraph from './minimax-h3-first-frame.json';
import mossImageGraph from './moss-image-sft-bf16-t2i.json';
import type { ComfyWorkflow } from '../aiConfigDefaults';
// Reference-only conditioning: the fourth image is a planning sheet, not the first frame.
const storyboardReferenceGraph = structuredClone(referenceVideoGraph) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
storyboardReferenceGraph['903'] = { class_type: 'LoadImage', inputs: { image: '' } };
storyboardReferenceGraph['265'].inputs['ref_images.ref_image_3'] = ['903', 0];
storyboardReferenceGraph['252'].inputs.megapixels = 1.2;
storyboardReferenceGraph['261'].inputs.steps = 8;
storyboardReferenceGraph['397'].inputs.transition_step = 4;
const standardFirstFrameGraph = structuredClone(firstFrameGraph) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
standardFirstFrameGraph['261'].inputs.steps = 10;
standardFirstFrameGraph['397'].inputs.transition_step = 6;
export const comfyAPIPresets: Array<{ id: string; label: string; template: Omit<ComfyWorkflow, 'id' | 'channelId'> }> = [
  { id: 'qwen-t2i', label: 'Qwen Image 2.1 文生图', template: { name: 'Qwen Image 2.1 文生图', kind: 'api_graph', enabled: true, workflowJson: imageGraph,
    api: { operation: 't2i', imageInputs: 0, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 15 },
    mappings: [{ systemParam: 'prompt', nodeId: '4', nodeInput: 'prompt' }, { systemParam: 'width', nodeId: '5', nodeInput: 'width' }, { systemParam: 'height', nodeId: '5', nodeInput: 'height' }, { systemParam: 'seed', nodeId: '6', nodeInput: 'seed' }] } },
  { id: 'h3-t2v', label: 'MiniMax H3 文生视频', template: { name: 'MiniMax H3 文生视频', kind: 'api_graph', enabled: true, workflowJson: videoGraph,
    api: { operation: 't2v', imageInputs: 0, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' }] } },
  { id: 'h3-reference-3', label: 'YZ H3 文戏 · 三图参考', template: { name: 'YZ H3 文戏 · 三图参考 10/6 · 1.5 MP', kind: 'api_graph', enabled: true, workflowJson: referenceVideoGraph,
    api: { operation: 'reference_video', imageInputs: 3, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' },
      ...[0, 1, 2].map(i => ({ systemParam: `image:${i}`, nodeId: String(900 + i), nodeInput: 'image' }))] } },
  { id: 'h3-action-3', label: 'YZ H3 武戏 · 三图参考', template: { name: 'YZ H3 武戏 · 三图参考 12/6 · 2 MP', kind: 'api_graph', enabled: true, workflowJson: actionVideoGraph,
    api: { operation: 'reference_video', imageInputs: 3, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' },
      ...[0, 1, 2].map(i => ({ systemParam: `image:${i}`, nodeId: String(900 + i), nodeInput: 'image' }))] } },
  { id: 'qwen-reference-1', label: 'Qwen Image 2.1 单图参考重绘', template: { name: 'Qwen Image 2.1 单图参考重绘', kind: 'api_graph', enabled: true, workflowJson: imageReferenceGraph,
    api: { operation: 'i2i', imageInputs: 1, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 15 },
    mappings: [{ systemParam: 'prompt', nodeId: '4', nodeInput: 'prompt' }, { systemParam: 'width', nodeId: '5', nodeInput: 'width' }, { systemParam: 'height', nodeId: '5', nodeInput: 'height' }, { systemParam: 'seed', nodeId: '6', nodeInput: 'seed' }, { systemParam: 'image:0', nodeId: '90', nodeInput: 'image' }] } },
  { id: 'h3-first-frame', label: 'YZ H3 分镜首帧 · 快速档', template: { name: 'YZ H3 分镜首帧快速档 8/4 · 1.2 MP', kind: 'api_graph', enabled: true, workflowJson: firstFrameGraph,
    api: { operation: 'i2v', imageInputs: 1, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' }, { systemParam: 'image:0', nodeId: '900', nodeInput: 'image' }] } },
  { id: 'h3-storyboard-4', label: 'YZ H3 四图参考 · 宫格实验档', template: { name: 'YZ H3 四图参考 · 宫格实验档 8/4 · 1.2 MP（需逐段验收）', kind: 'api_graph', enabled: true, workflowJson: storyboardReferenceGraph,
    api: { operation: 'reference_video', imageInputs: 4, videoInputs: 0, audioInputs: 0, nativeAudio: true, multiShot: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' },
      ...[0, 1, 2, 3].map(i => ({ systemParam: `image:${i}`, nodeId: String(900 + i), nodeInput: 'image' }))] } },
  { id: 'h3-first-frame-standard', label: 'YZ H3 分镜首帧 · 标准文戏档', template: { name: 'YZ H3 分镜首帧标准档 10/6 · 1.2 MP', kind: 'api_graph', enabled: true, workflowJson: standardFirstFrameGraph,
    api: { operation: 'i2v', imageInputs: 1, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 },
    mappings: [{ systemParam: 'prompt', nodeId: '263', nodeInput: 'value' }, { systemParam: 'duration', nodeId: '259', nodeInput: 'value' }, { systemParam: 'aspectRatio', nodeId: '252', nodeInput: 'aspect_ratio', valueMap: { '16:9': '16:9 (Widescreen)' } }, { systemParam: 'seed', nodeId: '397', nodeInput: 'seed' }, { systemParam: 'image:0', nodeId: '900', nodeInput: 'image' }] } },
  { id: 'moss-image-t2i', label: 'MOSS Image SFT BF16 文生图', template: { name: 'MOSS Image SFT BF16', sourceWorkflowName: 'MOSS-Image-SFT-BF16-api.json', kind: 'api_graph', enabled: true, workflowJson: mossImageGraph,
    api: { operation: 't2i', imageInputs: 0, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 15 },
    mappings: [{ systemParam: 'prompt', nodeId: '4', nodeInput: 'text' }, { systemParam: 'width', nodeId: '6', nodeInput: 'width' }, { systemParam: 'height', nodeId: '6', nodeInput: 'height' }, { systemParam: 'seed', nodeId: '7', nodeInput: 'seed' }] } },
];
