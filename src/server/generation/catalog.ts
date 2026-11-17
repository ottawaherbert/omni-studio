import { buildComfyUIH3Prompt } from '../providers/comfyUIH3Video';
import { createHash } from 'node:crypto';
import { COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS, COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND, type AIConfigSnapshot, type ComfyWorkflow } from '../../config/aiConfigDefaults';
import { isKieGptImage2ModelId, isKieGrokImageModelId, isKieGrokVideoModelId } from '../../config/aiConfigDefaults';
import type { GenerationCapability, GenerationParameter, GenerationRole } from '../../../packages/domain/src/generation';
import type { ComfyAPITemplate, ComfyAPIGraph } from '../../../packages/domain/src/comfyWorkflow';
import { validateComfyTemplate } from '../../../packages/domain/src/comfyWorkflow';
import { expandH3References } from './h3References';

export const stableJSON = (v: unknown): string => JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
export const generationHash = (v: unknown) => createHash('sha256').update(stableJSON(v)).digest('hex');
export interface GenerationRecipe { capability: GenerationCapability; template?: ComfyAPITemplate; presetVariants: Array<{ id: string; label: string; values: Record<string, string | number | boolean> }>; legacyModelIds: string[] }
const imageRoles: GenerationRole[] = ['character_identity', 'environment', 'prop_identity', 'style', 'composition', 'board_sequence'];
const basicParameters = (video: boolean, min = 1, max = 14): GenerationParameter[] => [
  { key: 'aspectRatio', label: '画幅', type: 'string', default: '16:9', choices: ['16:9', '9:16', '1:1'] },
  ...(video ? [{ key: 'duration', label: '请求时长（秒）', type: 'number' as const, default: Math.max(min, Math.min(max, 10)), min, max }] : []),
  { key: 'seed', label: '种子', type: 'number', default: -1, min: -1, max: Number.MAX_SAFE_INTEGER, integer: true, advanced: true, description: '-1 为随机；预检后固定。' },
];

function extendTemplate(workflow: ComfyWorkflow): { template: ComfyAPITemplate; parameters: GenerationParameter[]; family: string } {
  const template = structuredClone(workflow) as ComfyAPITemplate;
  const graph = template.workflowJson as ComfyAPIGraph;
  const entries = Object.entries(graph);
  const h3 = entries.some(([, n]) => n.class_type === 'SelfLiftH3Sampler');
  const moss = entries.some(([, n]) => n.class_type === 'CLIPLoader' && n.inputs.type === 'moss_image');
  const parameters = basicParameters(template.api!.operation.endsWith('v') || template.api!.operation === 'reference_video', template.api!.minDuration, template.api!.maxDuration);
  const add = (id: string, input: string, key: string, label: string, min?: number, max?: number, choices?: Array<string | number>) => {
    const value = graph[id].inputs[input];
    if (!['number', 'string', 'boolean'].includes(typeof value)) return;
    if (template.mappings.some(m => m.nodeId === id && m.nodeInput === input)) return;
    const p: GenerationParameter = { key, label, type: typeof value as GenerationParameter['type'], default: value as string | number | boolean, min, max, choices, integer: key === 'steps' || key === 'firstSteps', advanced: true, mappings: [{ nodeId: id, input }] };
    parameters.push(p); template.mappings.push({ systemParam: `parameter:${key}`, nodeId: id, nodeInput: input });
  };
  for (const [id, node] of entries) {
    if (node.class_type === 'BasicScheduler' || (!h3 && node.class_type === 'KSampler')) add(id, 'steps', 'steps', '总采样步数', 2, 60);
    if (moss && node.class_type === 'KSampler') {
      add(id, 'cfg', 'cfg', '提示词引导强度', .1, 20);
      const negative = node.inputs.negative;
      if (Array.isArray(negative) && graph[negative[0]]?.class_type === 'CLIPTextEncode') add(negative[0], 'text', 'negativePrompt', '负面提示词');
    }
    if (node.class_type === 'SelfLiftH3Sampler') {
      add(id, 'transition_step', 'firstSteps', '一采步数', 1, 59); add(id, 'lowres_scale', 'lowresScale', '一采宽高比例', .25, 1);
      add(id, 'cfg', 'cfg', '提示词引导强度', .1, 20); add(id, 'highres_tiling', 'highresTiling', '高分辨率分块'); add(id, 'upscaler_unload', 'upscalerUnload', '放大后卸载');
    }
    if (node.class_type === 'ResolutionSelector') add(id, 'megapixels', 'megapixels', '最终像素量（MP）', .25, 2);
    if (node.class_type === 'LoraLoaderModelOnly' && typeof node.inputs.strength_model === 'number') {
      const name = String(node.inputs.lora_name || 'LoRA'), speed = /speed|速度/i.test(name);
      add(id, 'strength_model', `lora_${id}`, `${name.split(/[\\/]/).at(-1)} · 强度`, speed ? -5 : 0, speed ? 5 : 1);
      const strength = parameters.find(p => p.key === `lora_${id}`), mapping = template.mappings.find(m => m.systemParam === `parameter:lora_${id}`);
      if (strength && mapping) { const accelerationCore = (h3 && id === '53') || /dmd|s600|step.?600|distill|accel|加速/i.test(name); if (accelerationCore && Number(node.inputs.strength_model) !== 0) strength.min = .05; const key = `lora_enabled_${id}`; strength.enabledBy = key; mapping.enabledBy = key; parameters.push({ key, label: '启用此 LoRA', type: 'boolean', default: Number(node.inputs.strength_model) !== 0, advanced: true, locked: accelerationCore }); }
    }
  }
  const aspect = parameters.find(p => p.key === 'aspectRatio');
  if (aspect && template.api!.aspectRatios?.length) aspect.choices = [...template.api!.aspectRatios];
  const mappedDefault = (key: string, fallback: number) => {
    const mapping = template.mappings.find(m => m.systemParam === key);
    const value = mapping && graph[mapping.nodeId]?.inputs[mapping.nodeInput];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  if (!h3) {
    if (template.mappings.some(m => m.systemParam === 'width')) parameters.push({ key: 'width', label: '输出宽度', type: 'number', default: mappedDefault('width', 1536), min: 256, max: 4096, integer: true });
    if (template.mappings.some(m => m.systemParam === 'height')) parameters.push({ key: 'height', label: '输出高度', type: 'number', default: mappedDefault('height', 864), min: 256, max: 4096, integer: true });
  }
  template.parameters = parameters.filter(p => p.mappings || p.key.startsWith('lora_enabled_')).map(p => ({ key: p.key, type: p.type, min: p.min, max: p.max, choices: p.choices, integer: p.key === 'steps' || p.key === 'firstSteps' }));
  // Only known variadic image inputs are eligible. Other templates retain exact counts.
  const minInputs: Partial<Record<'images', number>> = {};
  const branches: NonNullable<ComfyAPITemplate['optionalMediaBranches']> = [];
  for (let index = 1; index < template.api!.imageInputs; index++) {
    const mapping = template.mappings.find(m => m.systemParam === `image:${index}`);
    if (!mapping || graph[mapping.nodeId]?.class_type !== 'LoadImage') continue;
    const sinks = entries.flatMap(([nodeId, n]) => Object.entries(n.inputs).flatMap(([input, value]) => Array.isArray(value) && value[0] === mapping.nodeId ? [{ nodeId, input, classType: n.class_type }] : []));
    if (sinks.length && sinks.every(s => (s.classType === 'MiniMaxH3ReferenceToVideo' && /^ref_images\.ref_image_\d+$/.test(s.input)) || (s.classType === 'TextEncodeQwenImage21' && /^images\.image_\d+$/.test(s.input)))) branches.push({ field: 'images', index, removeNodes: [mapping.nodeId], removeInputs: sinks.map(({ nodeId, input }) => ({ nodeId, input })) });
  }
  if (branches.length === template.api!.imageInputs - 1 && branches.length) minInputs.images = 1;
  template.api = { ...template.api!, minimumInputs: { ...template.api!.minimumInputs, ...minInputs } };
  template.optionalMediaBranches = minInputs.images ? branches : template.optionalMediaBranches;
  validateComfyTemplate(template);
  return { template, parameters, family: h3 ? 'yz_h3' : moss ? 'moss_image' : entries.some(([, n]) => n.class_type.includes('Qwen')) ? 'qwen_image' : 'comfy_custom' };
}

/** Compile the existing native reference recipe without rewriting saved settings or substituting the YZ core. */
function migrateLegacyWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  if (workflow.kind === 'generic_image' || !workflow.kind) return { ...workflow, kind: 'api_graph', api: { operation: workflow.mappings.some(m => m.systemParam.startsWith('image:')) ? 'i2i' : 't2i', imageInputs: workflow.mappings.filter(m => m.systemParam.startsWith('image:')).length, videoInputs: 0, audioInputs: 0, minDuration: 1, maxDuration: 14, nativeAudio: false } };
  if (workflow.kind !== COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND) return workflow;
  const settings = { ...COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS, ...workflow.minimaxH3Reference };
  const graph = buildComfyUIH3Prompt({ request: { model: 'MiniMax-H3', content: [{ type: 'text', text: '' }], ratio: '16:9', resolution: '768P', duration: 5 }, settings, uploadedImages: Array.from({ length: 9 }, (_, i) => `reference-${i}.png`), seed: 1, filenamePrefix: 'omni-h3' });
  const frames = Object.fromEntries(Array.from({ length: 10 }, (_, i) => { const seconds = i + 5; return [seconds, 5 + Math.floor((seconds * 24 - 5) / 17) * 17]; }));
  return { ...workflow, kind: 'api_graph', workflowJson: graph, api: { operation: 'reference_video', imageInputs: 9, videoInputs: 0, audioInputs: 0, nativeAudio: true, minDuration: 5, maxDuration: 14 }, mappings: [
    { systemParam: 'prompt', nodeId: '6', nodeInput: 'prompt' }, { systemParam: 'width', nodeId: '6', nodeInput: 'width' }, { systemParam: 'height', nodeId: '6', nodeInput: 'height' }, { systemParam: 'duration', nodeId: '6', nodeInput: 'length', valueMap: frames }, { systemParam: 'seed', nodeId: '7', nodeInput: 'noise_seed' },
    ...Array.from({ length: 9 }, (_, i) => ({ systemParam: `image:${i}`, nodeId: String(100 + i), nodeInput: 'image' })),
  ] };
}

export function buildGenerationCatalog(config: AIConfigSnapshot): GenerationRecipe[] {
  const recipes: GenerationRecipe[] = [];
  for (const model of config.models) {
    const channel = config.channels.find(c => c.id === model.channelId && c.enabled !== false);
    if (!channel) continue;
    try {
      const savedWorkflow = config.comfyWorkflows.find(w => w.id === model.comfyWorkflowId && w.enabled !== false);
      const workflow = savedWorkflow ? migrateLegacyWorkflow(savedWorkflow) : undefined;
      if (channel.type === 'comfyui' && workflow?.api) {
        const { template, parameters, family } = extendTemplate(workflow);
        const video = !['t2i', 'i2i'].includes(template.api!.operation), api = template.api!;
        const mode = !video ? api.imageInputs ? 'reference_image' : 'text_to_image' : api.operation === 't2v' ? 'text_to_video' : api.operation === 'i2v' ? 'first_frame_video' : api.multiShot ? 'board_guided_video' : 'reference_video';
        const normalized = structuredClone(template) as ComfyAPITemplate;
        for (const m of normalized.mappings) if (m.systemParam.startsWith('parameter:') || m.systemParam === 'seed') (normalized.workflowJson as ComfyAPIGraph)[m.nodeId].inputs[m.nodeInput] = `__${m.systemParam}__`;
        const coreHash = generationHash({ graph: normalized.workflowJson, api, mappings: normalized.mappings, branches: normalized.optionalMediaBranches });
        const id = `recipe-${generationHash({ channelId: channel.id, coreHash, mode }).slice(0, 24)}`;
        const defaults = Object.fromEntries(parameters.map(p => [p.key, p.default]));
        const diagnostic = /diagnostic|诊断|scale0|测试/.test(`${model.id} ${model.alias}`);
        const variant = { id: model.id, label: model.alias, values: defaults };
        const existing = recipes.find(r => r.capability.id === id);
        if (existing) { existing.legacyModelIds.push(model.id); existing.presetVariants.push(variant); existing.capability.diagnostic = existing.capability.diagnostic && diagnostic; continue; }
        const capability: GenerationCapability = {
          id, recipeRevisionId: `core-${coreHash}`, modelConfigId: model.id, connectionId: channel.id, connectionName: channel.name,
          label: `${family === 'yz_h3' ? 'YZ H3' : family === 'qwen_image' ? 'Qwen Image' : workflow.name} · ${{ text_to_image: '文字生图', reference_image: api.imageInputs === 1 ? '单图参考' : `${api.minimumInputs?.images ?? api.imageInputs}–${api.imageInputs} 图参考`, text_to_video: '文字生视频', first_frame_video: '首帧视频', reference_video: '多参考视频', board_guided_video: '宫格指导视频' }[mode]}`,
          coreLabel: workflow.sourceWorkflowName || workflow.name, provider: 'comfyui', mediaKind: video ? 'video' : 'image', mode,
          minDuration: api.minDuration, maxDuration: family === 'yz_h3' ? Math.min(14, api.maxDuration) : api.maxDuration, aspectRatios: api.aspectRatios || ['16:9', '9:16', '1:1'],
          inputs: { image: { min: api.minimumInputs?.images ?? api.imageInputs, max: api.imageInputs, roles: mode === 'first_frame_video' ? ['first_frame'] : imageRoles }, video: { min: api.minimumInputs?.videos ?? api.videoInputs, max: api.videoInputs, roles: ['motion'] }, audio: { min: api.minimumInputs?.audio ?? api.audioInputs, max: api.audioInputs, roles: ['full_dialogue'] } },
          nativeAudio: api.nativeAudio, multiShot: !!api.multiShot, experimental: mode === 'board_guided_video' || !!api.minimumInputs?.images, diagnostic,
          evidence: 'compiled', evidenceNotes: ['已验证本地映射；不代表新可选输入组合或宫格切镜质量已实测。'], parameters, defaults, fixedCoreHash: coreHash, coreFamily: family,
          deploymentFingerprint: generationHash({ url: channel.baseUrl, graphModels: Object.values(normalized.workflowJson as ComfyAPIGraph).filter(n => /Loader/.test(n.class_type)).map(n => n.inputs) }),
          allowedOperations: video ? ['video'] : api.imageInputs ? ['asset_image', 'joint_storyboard', 'image_edit'] : ['asset_image', 'joint_storyboard'],
        };
        recipes.push({ capability, template, legacyModelIds: [model.id], presetVariants: [variant] });
      } else if (channel.type === 'gemini' && model.capabilities.includes('video') && /veo-/i.test(model.modelId)) {
        const lastFrame = /veo-3\.1/i.test(model.modelId);
        const parameters = basicParameters(true, 4, 8).filter(p => p.key !== 'seed');
        parameters.find(p => p.key === 'duration')!.choices = [4, 6, 8];
        parameters.find(p => p.key === 'duration')!.default = 8;
        parameters.find(p => p.key === 'aspectRatio')!.choices = ['16:9', '9:16'];
        parameters.push({ key: 'resolution', label: '分辨率', type: 'string', default: '720p', choices: ['720p'] });
        const hash = generationHash({ provider: 'gemini', model: model.modelId, adapter: 'veo.v1' });
        const capability: GenerationCapability = { id: `recipe-${generationHash({ channel: channel.id, hash }).slice(0, 24)}`, recipeRevisionId: hash, modelConfigId: model.id, connectionId: channel.id, connectionName: channel.name, label: `${model.alias} · 首帧视频`, coreLabel: model.modelId, provider: 'gemini', mediaKind: 'video', mode: 'first_frame_video', minDuration: 4, maxDuration: 8, aspectRatios: ['16:9', '9:16'], inputs: { image: { min: 1, max: lastFrame ? 2 : 1, roles: lastFrame ? ['first_frame', 'last_frame'] : ['first_frame'] }, video: { min: 0, max: 0, roles: [] }, audio: { min: 0, max: 0, roles: [] } }, nativeAudio: /veo-3/i.test(model.modelId), multiShot: false, experimental: false, diagnostic: false, evidence: 'declared', evidenceNotes: ['沿用已有 Veo 首帧/尾帧接口；本次未调用真实服务。'], parameters, defaults: Object.fromEntries(parameters.map(p => [p.key, p.default])), fixedCoreHash: hash, coreFamily: 'veo', deploymentFingerprint: generationHash({ model: model.modelId, provider: 'gemini' }), allowedOperations: ['video'] };
        recipes.push({ capability, legacyModelIds: [model.id], presetVariants: [{ id: model.id, label: model.alias, values: capability.defaults }] });
      } else if (['openai', 'gemini', 'doubao'].includes(channel.type) && model.capabilities.includes('image')) {
        const max = channel.type === 'doubao' ? 14 : 0;
        for (const mode of (max ? ['text_to_image', 'reference_image'] : ['text_to_image']) as Array<'text_to_image' | 'reference_image'>) {
          const parameters = basicParameters(false).filter(p => p.key !== 'seed');
          parameters.find(p => p.key === 'aspectRatio')!.choices = ['16:9', '9:16', '1:1', '3:4', '4:3'];
          const coreHash = generationHash({ provider: channel.type, model: model.modelId, adapter: 'image.v1' });
          const capability: GenerationCapability = { id: `recipe-${generationHash({ channelId: channel.id, coreHash, mode }).slice(0, 24)}`, recipeRevisionId: coreHash, modelConfigId: model.id, connectionId: channel.id, connectionName: channel.name, label: `${model.alias} · ${mode === 'text_to_image' ? '文字生图' : '图片参考'}`, coreLabel: model.modelId, provider: channel.type, mediaKind: 'image', mode, minDuration: 0, maxDuration: 0, aspectRatios: ['16:9', '9:16', '1:1', '3:4', '4:3'], inputs: { image: { min: mode === 'reference_image' ? 1 : 0, max: mode === 'reference_image' ? max : 0, roles: imageRoles }, video: { min: 0, max: 0, roles: [] }, audio: { min: 0, max: 0, roles: [] } }, nativeAudio: false, multiShot: false, experimental: false, diagnostic: false, evidence: 'declared', evidenceNotes: ['保留原供应商图片合同；不虚构未接通的参考输入能力。'], parameters, defaults: Object.fromEntries(parameters.map(p => [p.key, p.default])), fixedCoreHash: coreHash, coreFamily: `${channel.type}_image`, deploymentFingerprint: generationHash({ url: channel.baseUrl, model: model.modelId }), allowedOperations: mode === 'reference_image' ? ['asset_image', 'joint_storyboard', 'image_edit'] : ['asset_image', 'joint_storyboard'] };
          recipes.push({ capability, legacyModelIds: [model.id], presetVariants: [{ id: model.id, label: model.alias, values: capability.defaults }] });
        }
      } else if (channel.type === 'kie' && (isKieGptImage2ModelId(model.modelId) || isKieGrokImageModelId(model.modelId) || isKieGrokVideoModelId(model.modelId))) {
        const video = isKieGrokVideoModelId(model.modelId), gpt = isKieGptImage2ModelId(model.modelId), coreHash = generationHash({ type: 'kie', model: model.modelId, adapter: 'generation-kie.v1' });
        const modes = video ? ['first_frame_video'] as const : ['text_to_image', 'reference_image'] as const;
        for (const mode of modes) {
          const parameters = basicParameters(video, 1, 15).filter(p => p.key !== 'seed');
          parameters.push({ key: 'resolution', label: '输出尺寸档位', type: 'string', default: video ? '720p' : '1K', choices: video ? ['480p', '720p'] : gpt ? ['1K', '2K', '4K'] : ['1K'] });
          parameters.find(p => p.key === 'aspectRatio')!.choices = video ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1', '3:4', '4:3'];
          const defaults = Object.fromEntries(parameters.map(p => [p.key, p.default]));
          const capability: GenerationCapability = { id: `recipe-${generationHash({ channelId: channel.id, coreHash, mode }).slice(0, 24)}`, recipeRevisionId: coreHash, modelConfigId: model.id, connectionId: channel.id, connectionName: channel.name, label: `${model.alias} · ${video ? '首帧视频' : mode === 'text_to_image' ? '文字生图' : '图片参考'}`, coreLabel: model.modelId, provider: 'kie', mediaKind: video ? 'video' : 'image', mode, minDuration: 1, maxDuration: 15, aspectRatios: video ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1', '3:4', '4:3'], inputs: { image: { min: mode === 'text_to_image' ? 0 : 1, max: mode === 'text_to_image' ? 0 : gpt ? 16 : 1, roles: video ? ['first_frame'] : imageRoles }, video: { min: 0, max: 0, roles: [] }, audio: { min: 0, max: 0, roles: [] } }, nativeAudio: false, multiShot: false, experimental: false, diagnostic: false, evidence: 'declared', evidenceNotes: ['沿用已接通的 KIE 适配合同；本次未新增真实试跑。'], parameters, defaults, fixedCoreHash: coreHash, coreFamily: `kie_${model.modelId}`, deploymentFingerprint: generationHash({ url: channel.baseUrl, model: model.modelId }), allowedOperations: video ? ['video'] : mode === 'text_to_image' ? ['asset_image', 'joint_storyboard'] : ['asset_image', 'joint_storyboard', 'image_edit'] };
          recipes.push({ capability, legacyModelIds: [model.id], presetVariants: [{ id: model.id, label: model.alias, values: defaults }] });
        }
      }
    } catch { /* Invalid/unsupported legacy graphs remain in settings/history, never advertised as runnable. */ }
  }
  // Retain exact old recipes for saved plans. Derive one full-reference recipe
  // per actual core, rather than exposing a separate workflow for each slot count.
  const expanded: GenerationRecipe[] = [];
  for (const recipe of recipes) {
    if (recipe.capability.coreFamily !== 'yz_h3' || !recipe.template) continue;
    const template = expandH3References(recipe.template);
    if (!template) continue;
    validateComfyTemplate(template);
    const normalized = structuredClone(template);
    for (const m of normalized.mappings) if (m.systemParam.startsWith('parameter:') || m.systemParam === 'seed') (normalized.workflowJson as ComfyAPIGraph)[m.nodeId].inputs[m.nodeInput] = `__${m.systemParam}__`;
    const coreHash = generationHash({ adapter: 'h3_multimodal_v1', graph: normalized.workflowJson, api: normalized.api, mappings: normalized.mappings, branches: normalized.optionalMediaBranches, parameters: normalized.parameters });
    const id = `recipe-${generationHash({ channelId: recipe.capability.connectionId, coreHash }).slice(0, 24)}`;
    recipe.capability.supersededBy = id;
    const previous = expanded.find(r => r.capability.id === id);
    const presets = recipe.presetVariants.map(p => ({ ...p, label: p.label.replace(/三图参考|四图参考|四图宫格实验档/g, '多素材参考') }));
    if (previous) { previous.legacyModelIds.push(recipe.capability.id, ...recipe.legacyModelIds); previous.presetVariants.push(...presets); continue; }
    expanded.push({ template, legacyModelIds: [recipe.capability.id, ...recipe.legacyModelIds], presetVariants: presets, capability: {
      ...recipe.capability, id, supersededBy: undefined, recipeRevisionId: `core-${coreHash}`, fixedCoreHash: coreHash,
      sourceCoreHash: recipe.capability.fixedCoreHash, referenceAdapter: 'h3_multimodal_v1',
      label: 'YZ H3 · 多素材参考', coreLabel: Object.values(template.workflowJson as ComfyAPIGraph).some(n => /combat|fight/i.test(String(n.inputs.lora_name || ''))) ? '动作 LoRA · 双采与放大' : '标准 · 双采与放大', mode: 'reference_video', multiShot: true,
      inputs: { image: { min: 0, max: 9, roles: imageRoles }, video: { min: 0, max: 3, roles: ['motion'] }, audio: { min: 0, max: 3, roles: ['voice_timbre', 'full_dialogue'] } },
      experimental: true, evidence: 'compiled', evidenceNotes: [
        '沿用源工作流的模型、LoRA、双采与放大节点，仅扩展 H3 原生参考输入；输入上限来自节点协议，不是作者示例槽位。',
        '图片、视频、音频均按需勾选，至少一份；视频仅传画面，原声需作为独立音频选择。',
        '新组合已接入本地编译，服务器节点、声音效果与画面质量仍需实测。当前不声明已完成服务或创作验收。',
      ],
    } });
  }
  recipes.push(...expanded);
  for (const operation of ['extract_frame', 'crop'] as const) {
    const parameters: GenerationParameter[] = [{ key: 'aspectRatio', label: '目标画幅', type: 'string', default: '16:9', choices: ['16:9', '9:16', '1:1'] }, ...(operation === 'crop' ? [{ key: 'cropX', label: '左侧起点（像素）', type: 'number' as const, default: 0, min: 0, max: 16384, integer: true }, { key: 'cropY', label: '顶部起点（像素）', type: 'number' as const, default: 0, min: 0, max: 16384, integer: true }, { key: 'cropWidth', label: '裁切宽度（像素）', type: 'number' as const, default: 512, min: 1, max: 8192, integer: true }, { key: 'cropHeight', label: '裁切高度（像素）', type: 'number' as const, default: 288, min: 1, max: 8192, integer: true }] : [{ key: 'framePosition', label: '取帧位置', type: 'string' as const, default: 'end', choices: ['end', 'time'], description: 'end：文件末尾；time：指定实际切点时间' }, { key: 'frameTimeSeconds', label: '指定时间（秒）', type: 'number' as const, default: 0, min: 0, description: '取帧位置为 time 时生效，按原视频时间计算。' }])];
    const cap: GenerationCapability = { id: `local:${operation}`, recipeRevisionId: `local:${operation}:v2`, modelConfigId: `local:${operation}`, connectionId: 'local-media', connectionName: '本机媒体处理', label: operation === 'crop' ? '裁切参考图片（不生成新内容）' : '提取视频画面', coreLabel: '系统媒体工具', provider: 'local', mediaKind: 'image', mode: 'image_edit', minDuration: 0, maxDuration: 3600, aspectRatios: ['16:9', '9:16', '1:1'], inputs: { image: { min: operation === 'crop' ? 1 : 0, max: operation === 'crop' ? 1 : 0, roles: imageRoles }, video: { min: operation === 'extract_frame' ? 1 : 0, max: operation === 'extract_frame' ? 1 : 0, roles: ['motion'] }, audio: { min: 0, max: 0, roles: [] } }, nativeAudio: false, multiShot: false, experimental: false, diagnostic: false, evidence: 'compiled', evidenceNotes: ['本地确定性媒体处理，不是 AI 联合生成，也不代表画面质量通过。'], parameters, defaults: Object.fromEntries(parameters.map(p => [p.key, p.default])), fixedCoreHash: generationHash({ operation, adapter: 'local-media.v2' }), coreFamily: 'local_media', deploymentFingerprint: 'local-media.v2', allowedOperations: [operation] };
    recipes.push({ capability: cap, legacyModelIds: [], presetVariants: [] });
  }
  return recipes.sort((a, b) => Number(a.capability.diagnostic) - Number(b.capability.diagnostic));
}
