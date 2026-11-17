export type ComfyOperation = 't2i' | 'i2i' | 't2v' | 'i2v' | 'reference_video';
export interface ComfyCapabilities {
  operation: ComfyOperation;
  imageInputs: number;
  videoInputs: number;
  audioInputs: number;
  nativeAudio: boolean;
  /** Explicit workflow support for several timed shots within one generated clip. */
  multiShot?: boolean;
  aspectRatios?: string[];
  minDuration: number;
  maxDuration: number;
  /** Maximum inputs stay in imageInputs etc.; old templates remain exact-count. */
  minimumInputs?: Partial<Record<'images' | 'videos' | 'audio', number>>;
}
export interface ComfyParameterMapping {
  systemParam: string;
  nodeId: string;
  nodeInput: string;
  enabledBy?: string;
  /** e.g. {"16:9":"16:9 (Widescreen)"}; provider-specific enum spelling. */
  valueMap?: Record<string, string | number>;
}
export interface ComfyAPIGraph { [id: string]: { class_type: string; inputs: Record<string, unknown>; _meta?: unknown } }
export interface ComfyAPITemplate {
  workflowJson: unknown;
  mappings: ComfyParameterMapping[];
  api?: ComfyCapabilities;
  parameters?: Array<{ key: string; type: 'number' | 'boolean' | 'string'; min?: number; max?: number; integer?: boolean; choices?: Array<string | number> }>;
  optionalMediaBranches?: Array<{ field: 'images' | 'videos' | 'audio'; index: number; removeNodes: string[]; removeInputs: Array<{ nodeId: string; input: string }> }>;
}
export interface ComfyGenerationInput {
  prompt: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  duration?: number;
  seed?: number;
  images?: string[];
  videos?: string[];
  audio?: string[];
  parameters?: Record<string, string | number | boolean>;
}
export const comfyMediaKind = (operation: ComfyOperation) => operation === 't2i' || operation === 'i2i' ? 'image' : 'video';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validateComfyTemplate(template: ComfyAPITemplate): void {
  const graph = template.workflowJson;
  if (!object(graph) || !Object.keys(graph).length || Object.keys(graph).length > 10000
    || Object.values(graph).some(node => !object(node) || typeof node.class_type !== 'string' || !node.class_type || !object(node.inputs))) {
    throw new Error('需要 ComfyUI「导出（API）」节点图，不能使用画布 JSON 或重复包装 prompt。');
  }
  const api = template.api;
  if (!api || !['t2i', 'i2i', 't2v', 'i2v', 'reference_video'].includes(api.operation)) throw new Error('请选择工作流实际支持的生成方式。');
  if (typeof api.nativeAudio !== 'boolean') throw new Error('请明确声明工作流是否生成原生声音。');
  if (api.multiShot !== undefined && typeof api.multiShot !== 'boolean') throw new Error('多镜头能力须为布尔值。');
  if (comfyMediaKind(api.operation) === 'image' && api.multiShot) throw new Error('图片工作流不能声明视频多镜头能力。');
  if (comfyMediaKind(api.operation) === 'image' && (api.videoInputs || api.audioInputs || api.nativeAudio)) throw new Error('图片工作流只能配置图片输入，不能声明视频、音频或声音输出。');
  for (const key of ['imageInputs', 'videoInputs', 'audioInputs'] as const)
    if (!Number.isInteger(api[key]) || api[key] < 0 || api[key] > 16) throw new Error('参考素材数量须为 0–16 的整数。');
  if ((api.operation === 't2i' || api.operation === 't2v') && (api.imageInputs || api.videoInputs || api.audioInputs)) throw new Error('纯文本工作流不能声明参考素材能力。');
  if (['i2i', 'i2v'].includes(api.operation) && api.imageInputs < 1) throw new Error('图生工作流至少需要一个图片输入。');
  if (api.operation === 'reference_video' && !(api.imageInputs + api.videoInputs + api.audioInputs)) throw new Error('参考视频工作流需要配置参考素材。');
  if (!Number.isFinite(api.minDuration) || !Number.isFinite(api.maxDuration) || api.minDuration <= 0 || api.maxDuration < api.minDuration || api.maxDuration > 3600) throw new Error('工作流时长范围无效。');
  if (!Array.isArray(template.mappings) || template.mappings.length > 1000) throw new Error('参数映射须为最多 1000 项的数组。');
  const targets = new Set<string>();
  for (const mapping of template.mappings) {
    if (!object(mapping) || !/^(prompt|width|height|aspectRatio|duration|seed|(?:image|video|audio):\d+|parameter:[a-zA-Z][\w.-]*)$/.test(mapping.systemParam)) throw new Error('工作流参数映射无效。');
    if (mapping.systemParam.startsWith('parameter:') && !template.parameters?.some(p => p.key === mapping.systemParam.slice(10))) throw new Error('工作流参数未在可调白名单中声明。');
    if (mapping.enabledBy && (!mapping.systemParam.startsWith('parameter:') || !template.parameters?.some(p => p.key === mapping.enabledBy && p.type === 'boolean'))) throw new Error('LoRA 开关未在白名单中声明。');
    const node = graph[mapping.nodeId];
    if (!object(node) || !object(node.inputs) || !Object.hasOwn(node.inputs, mapping.nodeInput)) throw new Error(`参数 ${mapping.systemParam} 对应的节点输入不存在。`);
    const target = `${mapping.nodeId}:${mapping.nodeInput}`;
    if (targets.has(target)) throw new Error('同一节点输入不能映射两个参数。');
    targets.add(target);
    if (mapping.valueMap !== undefined && (!object(mapping.valueMap) || Object.values(mapping.valueMap).some(v => typeof v !== 'string' && typeof v !== 'number'))) throw new Error('参数枚举转换表无效。');
  }
  for (const [field, count] of [['images', api.imageInputs], ['videos', api.videoInputs], ['audio', api.audioInputs]] as const) {
    const min = api.minimumInputs?.[field] ?? count;
    if (!Number.isInteger(min) || min < 0 || min > count) throw new Error('可选参考的最小数量无效。');
    for (let index = min; index < count; index++) {
      const branch = template.optionalMediaBranches?.find(b => b.field === field && b.index === index);
      if (!branch || !branch.removeNodes.length || branch.removeNodes.some(id => !Object.hasOwn(graph, id)) || branch.removeInputs.some(i => !object(graph[i.nodeId]) || !Object.hasOwn((graph[i.nodeId] as any).inputs, i.input))) throw new Error('可选参考缺少完整的节点分支处理规则。');
    }
  }
  const params = new Set(template.mappings.map(m => m.systemParam));
  if (!params.has('prompt')) throw new Error('工作流缺少提示词映射。');
  if (!(params.has('width') && params.has('height')) && !params.has('aspectRatio')) throw new Error('工作流需要宽高或画幅映射，防止忽略作品画幅。');
  if (comfyMediaKind(api.operation) === 'video' && !params.has('duration')) throw new Error('视频工作流缺少时长映射。');
  for (const [kind, count] of [['image', api.imageInputs], ['video', api.videoInputs], ['audio', api.audioInputs]] as const) {
    for (let i = 0; i < count; i++) if (!params.has(`${kind}:${i}`)) throw new Error(`缺少 ${kind}:${i} 上传素材映射。`);
    for (const p of params) if (p.startsWith(`${kind}:`) && Number(p.split(':')[1]) >= count) throw new Error(`${p} 超出声明的参考素材数量。`);
  }
}
export function validateComfyInput(template: ComfyAPITemplate, input: ComfyGenerationInput): void {
  validateComfyTemplate(template);
  if (!object(input)) throw new Error('需要包含提示词、画幅与素材的生成参数。');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 200000) throw new Error('提示词为空或过长。');
  for (const [field, limit] of [['images', template.api!.imageInputs], ['videos', template.api!.videoInputs], ['audio', template.api!.audioInputs]] as const) {
    const values = input[field] || [];
    const min = template.api!.minimumInputs?.[field] ?? limit;
    if (!Array.isArray(values) || values.length < min || values.length > limit || values.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`此工作流需要 ${min === limit ? limit : `${min}–${limit}`} 个 ${field} 输入；不会忽略或补造参考素材。`);
  }
  if (template.api!.operation === 'reference_video' && !(input.images?.length || input.videos?.length || input.audio?.length)) throw new Error('多素材参考至少需要一份图片、视频或音频。');
  if (comfyMediaKind(template.api!.operation) === 'video' && (!Number.isFinite(input.duration) || input.duration! < template.api!.minDuration || input.duration! > template.api!.maxDuration)) throw new Error(`视频时长须在 ${template.api!.minDuration}–${template.api!.maxDuration} 秒内。`);
  if (!['16:9', '9:16', '1:1'].includes(input.aspectRatio || '')) throw new Error('请选择有效画幅。');
  for (const key of ['width', 'height'] as const) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key]! < 64 || input[key]! > 8192)) throw new Error('宽高须为 64–8192 的整数。');
  if (input.seed !== undefined && (!Number.isSafeInteger(input.seed) || input.seed < 0)) throw new Error('种子须为非负安全整数。');
  for (const [key, value] of Object.entries(input.parameters || {})) {
    const p = template.parameters?.find(p => p.key === key);
    if (!p || typeof value !== p.type || (typeof value === 'number' && (!Number.isFinite(value) || (p.integer && !Number.isSafeInteger(value)) || (p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max))) || (p.choices && !p.choices.includes(value as string | number))) throw new Error(`参数 ${key} 不在工作流允许范围内。`);
  }
  if (input.parameters?.steps !== undefined && input.parameters?.firstSteps !== undefined && Number(input.parameters.firstSteps) >= Number(input.parameters.steps)) throw new Error('一采步数必须小于总步数。');
}
/** Called after uploads; uploaded filenames are kept verbatim. */
export function compileComfyGraph(template: ComfyAPITemplate, input: ComfyGenerationInput): ComfyAPIGraph {
  validateComfyInput(template, input);
  const graph = structuredClone(template.workflowJson) as ComfyAPIGraph;
  const values: Record<string, unknown> = { ...input, seed: input.seed ?? Math.floor(Math.random() * 2147483647) };
  const removed = new Set<string>();
  for (const branch of template.optionalMediaBranches || []) if ((input[branch.field]?.length || 0) <= branch.index) {
    branch.removeNodes.forEach(id => { removed.add(id); delete graph[id]; });
    branch.removeInputs.forEach(i => { if (graph[i.nodeId]) delete graph[i.nodeId].inputs[i.input]; });
  }
  for (const [key, value] of Object.entries(input.parameters || {})) values[`parameter:${key}`] = value;
  for (const [kind, files] of [['image', input.images], ['video', input.videos], ['audio', input.audio]] as const)
    (files || []).forEach((filename, index) => { values[`${kind}:${index}`] = filename; });
  for (const mapping of template.mappings) {
    if (removed.has(mapping.nodeId)) continue;
    let value = values[mapping.systemParam];
    if (value === undefined) throw new Error(`生成请求缺少 ${mapping.systemParam}。`);
    if (mapping.enabledBy) { const enabled = values[`parameter:${mapping.enabledBy}`]; if (typeof enabled !== 'boolean') throw new Error('缺少 LoRA 开关值。'); if (!enabled) value = 0; }
    if (mapping.valueMap) {
      if (!Object.hasOwn(mapping.valueMap, String(value))) throw new Error(`工作流未配置 ${mapping.systemParam}=${value} 的节点枚举值。`);
      value = mapping.valueMap[String(value)];
    }
    graph[mapping.nodeId].inputs[mapping.nodeInput] = value;
  }
  for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && removed.has(value[0])) throw new Error('可选参考分支仍有悬空引用，已停止提交。');
  }
  if (new TextEncoder().encode(JSON.stringify({ prompt: graph })).length > 8 * 1024 * 1024) throw new Error('工作流请求超过 8 MiB。');
  return graph;
}
