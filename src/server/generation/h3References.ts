import type { ComfyAPIGraph, ComfyAPITemplate } from '../../../packages/domain/src/comfyWorkflow';
import type { GenerationReference } from '../../../packages/domain/src/generation';
import { generationRoleLabels } from '../../../packages/domain/src/generation';

/** Native H3 R2V protocol capacities, not the author's example slot counts.
 * Only adapt known reference conditioning; never replace an I2V/T2V model.
 * Service compatibility and creative quality must still be verified separately.
 */
export function expandH3References(original: ComfyAPITemplate): ComfyAPITemplate | undefined {
  const graph = original.workflowJson as ComfyAPIGraph;
  const conditioning = Object.entries(graph).filter(([, node]) => node.class_type === 'MiniMaxH3ReferenceToVideo');
  if (original.api?.operation !== 'reference_video' || conditioning.length !== 1
    || !Object.values(graph).some(node => node.class_type === 'SelfLiftH3Sampler')) return;
  const [conditionId, node] = conditioning[0];
  if (!node.inputs.audio_vae || !node.inputs.vae) return;
  // Preserve unknown/custom media pipelines rather than silently removing them.
  const mediaMappings = original.mappings.filter(m => /^(image|video|audio):/.test(m.systemParam));
  const sourceNodes = new Set(mediaMappings.map(m => m.nodeId));
  for (const id of sourceNodes) {
    if (graph[id]?.class_type !== 'LoadImage') return;
    for (const [consumerId, consumer] of Object.entries(graph)) for (const [input, value] of Object.entries(consumer.inputs)) {
      if (Array.isArray(value) && value[0] === id && (consumerId !== conditionId || !/^ref_images\.ref_image_\d+$/.test(input))) return;
    }
  }
  if (Object.keys(node.inputs).some(key => /^ref_(?:videos|video_audios|audios)\./.test(key))) return;
  const template = structuredClone(original), out = template.workflowJson as ComfyAPIGraph;
  sourceNodes.forEach(id => delete out[id]);
  for (const key of Object.keys(out[conditionId].inputs)) if (/^ref_images\.ref_image_\d+$/.test(key)) delete out[conditionId].inputs[key];
  template.mappings = template.mappings.filter(m => !sourceNodes.has(m.nodeId));
  template.optionalMediaBranches = [];
  const groups = [
    { field: 'images' as const, kind: 'image', count: 9, prefix: 'ref_images.ref_image_', classType: 'LoadImage', input: 'image' },
    { field: 'videos' as const, kind: 'video', count: 3, prefix: 'ref_videos.ref_video_', classType: 'VHS_LoadVideo', input: 'video' },
    { field: 'audio' as const, kind: 'audio', count: 3, prefix: 'ref_audios.ref_audio_', classType: 'LoadAudio', input: 'audio' },
  ];
  for (const group of groups) for (let index = 0; index < group.count; index++) {
    const id = `omni_h3_${group.kind}_${index}`, input = `${group.prefix}${index}`;
    if (out[id]) return; // Never overwrite an existing author node.
    out[id] = { class_type: group.classType, inputs: { [group.input]: '', ...(group.kind === 'video' ? {
      force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1,
    } : {}) } };
    out[conditionId].inputs[input] = [id, 0];
    template.mappings.push({ systemParam: `${group.kind}:${index}`, nodeId: id, nodeInput: group.input });
    template.optionalMediaBranches.push({ field: group.field, index, removeNodes: [id], removeInputs: [{ nodeId: conditionId, input }] });
  }
  template.api = { ...template.api!, imageInputs: 9, videoInputs: 3, audioInputs: 3,
    minimumInputs: { images: 0, videos: 0, audio: 0 }, multiShot: true };
  return template;
}

/** Tags use the same per-modality order as the compiled graph. Video soundtrack
 * is not connected implicitly, so standalone audio numbering starts at one.
 */
export function h3ReferencePrompt(references: GenerationReference[]): string {
  const lines = (['image', 'video', 'audio'] as const).flatMap(kind => references.filter(r => r.mediaKind === kind).map((ref, i) => {
    const tag = `<${{ image: 'Picture', video: 'Video', audio: 'Audio' }[kind]} ${i + 1}>`;
    const intent = ref.role === 'voice_timbre' ? '只参考说话人的音色与发声特征；使用本镜剧本台词，不复制样本中的话语或情绪。'
      : ref.role === 'full_dialogue' ? '参考本镜完整对白的内容、表演和节奏；不视为已保证原音频波形复用，成片需核对台词与声音。'
      : kind === 'video' ? '仅参考明确指定的动作或机位；未接入该视频原声，不继承其他人物和事件。' : '';
    return `${tag}：${ref.label}；用途：${generationRoleLabels[ref.role]}。${intent}${ref.usageNote ? ` 具体要求：${ref.usageNote}` : ''}`;
  }));
  return lines.length ? `本次实际发送的参考（标签与节点顺序一致）：\n${lines.join('\n')}\n按上述用途取用素材，不要求所有人物或物件出现在每个镜头。` : '';
}
