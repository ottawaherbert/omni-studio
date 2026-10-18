export type ChannelType = 'openai' | 'gemini' | 'minimax' | 'deepseek' | 'doubao' | 'kie' | 'llamacpp' | 'comfyui' | 'custom';

const OPENAI_COMPATIBLE_TEXT_CHANNEL_TYPES: readonly ChannelType[] = ['openai', 'deepseek', 'doubao', 'kie', 'llamacpp'];
export const isOpenAICompatibleTextChannelType = (type: ChannelType) =>
  OPENAI_COMPATIBLE_TEXT_CHANNEL_TYPES.includes(type);

export interface AIChannel {
  id: string;
  name: string;
  type: ChannelType;
  baseUrl: string;
  apiKey: string;
  managedBy?: 'comfyui_h3_workflow';
}

export const KIE_GROK_VIDEO_RESOLUTIONS = ['480p', '720p'] as const;
export type KieGrokVideoResolution = (typeof KIE_GROK_VIDEO_RESOLUTIONS)[number];

export interface KieGrokVideoModelSettings {
  resolution: KieGrokVideoResolution;
}

export const KIE_GPT_IMAGE_2_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export type KieGptImage2Resolution = (typeof KIE_GPT_IMAGE_2_RESOLUTIONS)[number];

export interface KieGptImage2ModelSettings {
  resolution: KieGptImage2Resolution;
}

export const KIE_GPT_IMAGE_2_DEFAULT_SETTINGS: KieGptImage2ModelSettings = {
  resolution: '1K',
};

export const MINIMAX_H3_DEFAULT_BASE_URL = 'https://api.minimax.io';
export const MINIMAX_H3_MODEL_ID = 'MiniMax-H3';
export const MINIMAX_H3_RESOLUTIONS = ['768P', '2K'] as const;
export type MiniMaxH3Resolution = (typeof MINIMAX_H3_RESOLUTIONS)[number];
export const MINIMAX_H3_GENERATION_MODES = [
  'multimodal_reference',
  'first_frame',
  'first_last_frame',
  'last_frame',
  'text_only',
] as const;
export type MiniMaxH3GenerationMode = (typeof MINIMAX_H3_GENERATION_MODES)[number];

export interface MiniMaxH3VideoModelSettings {
  defaultMode: MiniMaxH3GenerationMode;
  resolution: MiniMaxH3Resolution;
  audioMode: 'provider_native' | 'reuse_dialogue' | 'post_dub';
}

export const MINIMAX_H3_VIDEO_DEFAULT_SETTINGS: MiniMaxH3VideoModelSettings = {
  defaultMode: 'multimodal_reference',
  resolution: '768P',
  audioMode: 'provider_native',
};

export const VIDEO_MODEL_ADAPTER_OPTIONS = [
  { id: 'auto', label: '自动识别' },
  { id: 'video.generic.i2v.v1', label: '通用首帧' },
  { id: 'video.generic.fl2v.v1', label: '通用首尾画面' },
  { id: 'video.kie.grok.i2v.v1', label: 'KIE Grok 视频' },
  { id: 'video.minimax.h3.ref2va.v1', label: 'MiniMax H3 多素材参考' },
  { id: 'video.minimax.h3.t2va.v1', label: 'MiniMax H3 纯文本' },
  { id: 'video.minimax.h3.i2va.v1', label: 'MiniMax H3 图生视频' },
  { id: 'video.minimax.h3.fl2va.v1', label: 'MiniMax H3 首尾帧' },
  { id: 'video.minimax.h3.l2va.v1', label: 'MiniMax H3 尾帧驱动' },
] as const;

export type VideoModelAdapterId = (typeof VIDEO_MODEL_ADAPTER_OPTIONS)[number]['id'];
export const isMiniMaxH3VideoAdapterId = (adapterId: string | undefined) => (
  Boolean(adapterId?.startsWith('video.minimax.h3.'))
);

export interface VideoGenerationModelDefaults {
  mode?: string;
  resolution?: string;
  audioMode?: 'provider_native' | 'reuse_dialogue' | 'post_dub';
}

export const REASONING_EFFORT_OPTIONS = ['provider_default', 'low', 'medium', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number];

export interface AIModel {
  id: string;
  channelId: string;
  alias: string;
  modelId: string;
  capabilities: ('text' | 'vision' | 'image' | 'video' | 'audio')[];
  apiKeyOverride?: string;
  reasoningEffort?: ReasoningEffort;
  textOutputMode?: import('./textModelOutput').TextOutputMode;
  visualPromptLanguagePolicy?: 'provider_default' | 'zh' | 'en' | 'bilingual';
  imageAdapterId?: ImageModelAdapterId | string;
  videoAdapterId?: VideoModelAdapterId | string;
  videoGenerationDefaults?: VideoGenerationModelDefaults;
  minimaxH3Video?: MiniMaxH3VideoModelSettings;
  kieGrokVideo?: KieGrokVideoModelSettings;
  kieGptImage2?: KieGptImage2ModelSettings;
  comfyWorkflowId?: string;
  managedBy?: 'comfyui_h3_workflow';
}

export const openAICompatibleReasoningParams = (model: Pick<AIModel, 'reasoningEffort'>) =>
  model.reasoningEffort && model.reasoningEffort !== 'provider_default'
    ? { chat_template_kwargs: { reasoning_effort: model.reasoningEffort } }
    : {};

export interface TaskRouting {
  scriptGen: string;
  storyboardGen: string;
  imageGen: string;
  videoGen: string;
  audioGen: string;
  videoExtraction: string;
  qcAnalyzer: string;
  visualQc: string;
}

export const taskCapabilityRequirements: Record<keyof TaskRouting, AIModel['capabilities'][number]> = {
  scriptGen: 'text',
  storyboardGen: 'text',
  imageGen: 'image',
  videoGen: 'video',
  audioGen: 'audio',
  videoExtraction: 'text',
  qcAnalyzer: 'text',
  visualQc: 'vision',
};

export interface ComfyNodeMapping {
  systemParam: string;
  nodeId: string;
  nodeInput: string;
}

export const COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND = 'minimax_h3_reference_video' as const;

export interface ComfyMiniMaxH3ReferenceSettings {
  diffusionModel: string;
  textEncoder: string;
  videoVae: string;
  audioVae: string;
  refImageSize: 'match' | 'max';
  scheduler: string;
  steps: number;
  teSpeedEnabled: boolean;
  megapixels: number;
}

export interface ComfyWorkflow {
  id: string;
  name: string;
  workflowJson: any;
  mappings: ComfyNodeMapping[];
  channelId?: string;
  kind?: 'generic_image' | typeof COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND;
  sourceWorkflowName?: string;
  minimaxH3Reference?: ComfyMiniMaxH3ReferenceSettings;
}

export interface AIConfigSnapshot {
  schemaVersion: number;
  channels: AIChannel[];
  models: AIModel[];
  routing: TaskRouting;
  visualQcEnabled: boolean;
  comfyWorkflows: ComfyWorkflow[];
}

export const AI_CONFIG_SCHEMA_VERSION = 13;
const AI_CONFIG_LEGACY_BUILT_IN_REMOVAL_VERSION = 6;
export const LLAMACPP_DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';
export const KIE_DEFAULT_BASE_URL = 'https://api.kie.ai/api/v1';
export const isKieOpenAICompatibleTextModelId = (modelId: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*-openai$/.test(modelId.trim());
export const resolveKieOpenAICompatibleTextBaseUrl = (channelBaseUrl: string | undefined, modelId: string) => {
  const normalizedModelId = modelId.trim();
  if (!isKieOpenAICompatibleTextModelId(normalizedModelId)) {
    throw new Error('Kie 文本模型 ID 必须使用官网 OpenAI 兼容版本，并以 -openai 结尾。');
  }
  const channelUrl = new URL(channelBaseUrl || KIE_DEFAULT_BASE_URL);
  if (channelUrl.protocol !== 'https:' || channelUrl.hostname !== 'api.kie.ai') {
    throw new Error('Kie 文本模型只能使用 https://api.kie.ai 官方接口。');
  }
  return `${channelUrl.origin}/${normalizedModelId}/v1`;
};
export const KIE_FILE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';
export const KIE_GROK_IMAGE_FAMILY_ID = 'grok-imagine';
export const KIE_GPT_IMAGE_2_FAMILY_ID = 'gpt-image-2';
export const KIE_GROK_IMAGE_ADAPTER_ID = 'image.kie.grok.v1';
export const KIE_GPT_IMAGE_2_ADAPTER_ID = 'image.kie.gpt-image-2.v1';
export const IMAGE_MODEL_ADAPTER_IDS = [
  KIE_GROK_IMAGE_ADAPTER_ID,
  KIE_GPT_IMAGE_2_ADAPTER_ID,
] as const;
export type ImageModelAdapterId = (typeof IMAGE_MODEL_ADAPTER_IDS)[number];
export const KIE_GROK_TEXT_TO_IMAGE_MODEL_ID = 'grok-imagine/text-to-image';
export const KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID = 'grok-imagine/image-to-image';
export const KIE_GROK_IMAGE_MODEL_IDS = [
  KIE_GROK_IMAGE_FAMILY_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
] as const;
export const isKieGrokImageModelId = (modelId: string) =>
  KIE_GROK_IMAGE_MODEL_IDS.includes(modelId.trim() as (typeof KIE_GROK_IMAGE_MODEL_IDS)[number]);
export const KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID = 'gpt-image-2-text-to-image';
export const KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID = 'gpt-image-2-image-to-image';
export const KIE_GPT_IMAGE_2_MODEL_IDS = [
  KIE_GPT_IMAGE_2_FAMILY_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
] as const;
export const isKieGptImage2ModelId = (modelId: string) =>
  KIE_GPT_IMAGE_2_MODEL_IDS.includes(modelId.trim() as (typeof KIE_GPT_IMAGE_2_MODEL_IDS)[number]);
export const isKieImageModelId = (modelId: string) =>
  isKieGrokImageModelId(modelId) || isKieGptImage2ModelId(modelId);
export const KIE_IMAGE_OPERATION_IDS = [
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
] as const;
export const isKieImageOperationId = (modelId: string) =>
  KIE_IMAGE_OPERATION_IDS.includes(modelId.trim() as (typeof KIE_IMAGE_OPERATION_IDS)[number]);
export const imageAdapterIdForModelId = (modelId: string): ImageModelAdapterId | undefined =>
  isKieGptImage2ModelId(modelId)
    ? KIE_GPT_IMAGE_2_ADAPTER_ID
    : isKieGrokImageModelId(modelId)
      ? KIE_GROK_IMAGE_ADAPTER_ID
      : undefined;
export const imageFamilyIdForAdapter = (adapterId: string | undefined) =>
  adapterId === KIE_GPT_IMAGE_2_ADAPTER_ID
    ? KIE_GPT_IMAGE_2_FAMILY_ID
    : adapterId === KIE_GROK_IMAGE_ADAPTER_ID
      ? KIE_GROK_IMAGE_FAMILY_ID
      : undefined;
export const KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID = 'grok-imagine-video-1-5-preview';
export const KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID = 'grok-imagine/image-to-video';
export const KIE_GROK_VIDEO_MODEL_IDS = [
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
] as const;
export const isKieGrokVideoModelId = (modelId: string) =>
  KIE_GROK_VIDEO_MODEL_IDS.includes(modelId.trim() as (typeof KIE_GROK_VIDEO_MODEL_IDS)[number]);
export const KIE_GROK_VIDEO_MIN_DURATION_SECONDS = 1;
export const KIE_GROK_VIDEO_MAX_DURATION_SECONDS = 15;
export const KIE_GROK_VIDEO_DEFAULT_SETTINGS: KieGrokVideoModelSettings = {
  resolution: '480p',
};
export interface AIChannelPreset extends AIChannel {
  capabilityHints: AIModel['capabilities'];
}

export const channelPresets: AIChannelPreset[] = [
  {
    id: 'default-openai',
    name: 'OpenAI Compatible',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    capabilityHints: ['text', 'vision', 'image', 'video', 'audio'],
  },
  {
    id: 'default-gemini',
    name: 'Google Gemini (Default)',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    capabilityHints: ['text', 'vision', 'image', 'video', 'audio'],
  },
  {
    id: 'default-minimax',
    name: 'MiniMax (Anthropic Compatible)',
    type: 'minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: '',
    capabilityHints: ['text'],
  },
  {
    id: 'default-deepseek',
    name: 'DeepSeek',
    type: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    capabilityHints: ['text'],
  },
  {
    id: 'default-doubao',
    name: 'Doubao (Volcengine Ark)',
    type: 'doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    capabilityHints: ['text', 'vision', 'image'],
  },
  {
    id: 'default-kie',
    name: 'Kie AI',
    type: 'kie',
    baseUrl: KIE_DEFAULT_BASE_URL,
    apiKey: '',
    capabilityHints: ['text', 'vision', 'image', 'video'],
  },
  {
    id: 'default-llamacpp',
    name: 'llama.cpp (Local OpenAI Compatible)',
    type: 'llamacpp',
    baseUrl: LLAMACPP_DEFAULT_BASE_URL,
    apiKey: '',
    capabilityHints: ['text'],
  },
];

export const defaultChannels: AIChannel[] = channelPresets.map(({ capabilityHints: _capabilityHints, ...channel }) => ({ ...channel }));

// Channels describe supported provider connections. Concrete model instances are
// always created by the user and then explicitly bound to a task route.
export const defaultModels: AIModel[] = [];

export const defaultRouting: TaskRouting = {
  scriptGen: '',
  storyboardGen: '',
  imageGen: '',
  videoGen: '',
  audioGen: '',
  videoExtraction: '',
  qcAnalyzer: '',
  visualQc: '',
};

export const defaultAIConfig: AIConfigSnapshot = {
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  channels: defaultChannels,
  models: defaultModels,
  routing: defaultRouting,
  visualQcEnabled: true,
  comfyWorkflows: [],
};

export const COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS: ComfyMiniMaxH3ReferenceSettings = {
  diffusionModel: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  refImageSize: 'match',
  scheduler: 'simple',
  steps: 20,
  teSpeedEnabled: true,
  megapixels: 0.5,
};

export const channelPresetForType = (type: ChannelType) =>
  channelPresets.find((preset) => preset.type === type);

// One-time migration inventory from schema v1/v2. Runtime routing and provider
// selection never depend on these historical registry IDs.
const LEGACY_BUILT_IN_MODEL_IDS = new Set([
  'minimax-m2.7',
  'minimax-m2.5',
  'minimax-m2.1',
  'gemini-3-flash',
  'gemini-3.1-pro',
  'gemini-2.5-flash-image',
  'veo-3.1-fast',
  'gemini-tts',
  'deepseek-chat',
  'deepseek-reasoner',
  'doubao-seedream',
]);

const LEGACY_PRESET_NAMES: Partial<Record<string, string>> = {
  'default-openai': 'OpenAI (Default)',
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const allowedSetting = <T extends string>(values: readonly T[], value: unknown, fallback: T) =>
  values.includes(value as T) ? value as T : fallback;

const normalizeKieGrokVideoSettings = (input: unknown): KieGrokVideoModelSettings => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    resolution: allowedSetting(
      KIE_GROK_VIDEO_RESOLUTIONS,
      source.resolution,
      KIE_GROK_VIDEO_DEFAULT_SETTINGS.resolution,
    ),
  };
};

const normalizeKieGptImage2Settings = (input: unknown): KieGptImage2ModelSettings => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    resolution: allowedSetting(
      KIE_GPT_IMAGE_2_RESOLUTIONS,
      source.resolution,
      KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution,
    ),
  };
};

const normalizeMiniMaxH3VideoSettings = (input: unknown): MiniMaxH3VideoModelSettings => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const legacyMode = source.defaultMode === 'reference_materials'
    ? 'multimodal_reference'
    : source.defaultMode === 'strict_frames'
      ? 'first_last_frame'
      : source.defaultMode;
  return {
    defaultMode: allowedSetting(
      MINIMAX_H3_GENERATION_MODES,
      legacyMode,
      MINIMAX_H3_VIDEO_DEFAULT_SETTINGS.defaultMode,
    ),
    resolution: allowedSetting(
      MINIMAX_H3_RESOLUTIONS,
      source.resolution,
      MINIMAX_H3_VIDEO_DEFAULT_SETTINGS.resolution,
    ),
    audioMode: allowedSetting(
      ['provider_native', 'reuse_dialogue', 'post_dub'] as const,
      source.audioMode,
      MINIMAX_H3_VIDEO_DEFAULT_SETTINGS.audioMode,
    ),
  };
};

export function normalizeAIConfig(input?: Partial<AIConfigSnapshot> | null): AIConfigSnapshot {
  const channels = (Array.isArray(input?.channels) ? [...input.channels] : [...defaultChannels])
    .filter((channel: any) => channel?.type !== 'yunwu' && channel?.id !== 'default-yunwu');
  const sourceVersion = Number(input?.schemaVersion || 1);
  const inputModels = Array.isArray(input?.models) ? [...input.models] : [...defaultModels];
  const models = sourceVersion < AI_CONFIG_LEGACY_BUILT_IN_REMOVAL_VERSION
    ? inputModels.filter((model) => !LEGACY_BUILT_IN_MODEL_IDS.has(String(model?.id || '')))
    : inputModels;
  const normalizedChannels = channels.map((channel: any) => {
    const id = String(channel.id || `channel-${Date.now()}`);
    const preset = channelPresets.find((item) => item.id === id);
    const legacyPresetName = LEGACY_PRESET_NAMES[id];
    return {
      id,
      name: preset && sourceVersion < AI_CONFIG_LEGACY_BUILT_IN_REMOVAL_VERSION && channel.name === legacyPresetName
        ? preset.name
        : String(channel.name || 'New Channel'),
      type: (channel.type || 'openai') as ChannelType,
      baseUrl: String(channel.baseUrl || ''),
      apiKey: String(channel.apiKey || ''),
      managedBy: channel.managedBy === 'comfyui_h3_workflow' ? 'comfyui_h3_workflow' as const : undefined,
    };
  });
  const channelIds = new Set(normalizedChannels.map((channel) => channel.id));
  const comfyWorkflows = (Array.isArray(input?.comfyWorkflows) ? input.comfyWorkflows : [])
    .filter((workflow: any) => workflow && typeof workflow === 'object')
    .map((workflow: any, index) => {
      const kind = workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND
        ? COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND
        : 'generic_image';
      const sourceSettings = workflow.minimaxH3Reference && typeof workflow.minimaxH3Reference === 'object'
        ? workflow.minimaxH3Reference as Record<string, unknown>
        : {};
      return {
        id: String(workflow.id || `workflow-${Date.now()}-${index}`),
        name: String(workflow.name || '未命名工作流'),
        workflowJson: workflow.workflowJson && typeof workflow.workflowJson === 'object' ? workflow.workflowJson : {},
        mappings: Array.isArray(workflow.mappings) ? workflow.mappings : [],
        channelId: workflow.channelId ? String(workflow.channelId) : undefined,
        kind,
        sourceWorkflowName: workflow.sourceWorkflowName ? String(workflow.sourceWorkflowName) : undefined,
        ...(kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND
          ? {
              minimaxH3Reference: {
                diffusionModel: String(sourceSettings.diffusionModel || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.diffusionModel),
                textEncoder: String(sourceSettings.textEncoder || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.textEncoder),
                videoVae: String(sourceSettings.videoVae || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.videoVae),
                audioVae: String(sourceSettings.audioVae || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.audioVae),
                refImageSize: allowedSetting(['match', 'max'] as const, sourceSettings.refImageSize, COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.refImageSize),
                scheduler: String(sourceSettings.scheduler || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.scheduler),
                steps: Math.max(1, Math.min(100, Number(sourceSettings.steps) || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.steps)),
                teSpeedEnabled: sourceSettings.teSpeedEnabled !== false,
                megapixels: Math.max(0.2, Math.min(2, Number(sourceSettings.megapixels) || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.megapixels)),
              },
            }
          : {}),
      } as ComfyWorkflow;
    });
  const comfyWorkflowIds = new Set(comfyWorkflows.map((workflow) => workflow.id));
  const rawRouting = { ...clone(defaultRouting), ...(input?.routing || {}) };
  const normalizedModelCandidates = models
    .map((model: any) => {
      const sourceModelId = String(model.modelId || '');
      const modelChannel = normalizedChannels.find((channel) => channel.id === String(model.channelId || ''));
      const inferredImageAdapterId = modelChannel?.type === 'kie'
        ? imageAdapterIdForModelId(sourceModelId)
        : undefined;
      const imageAdapterId = modelChannel?.type === 'kie' && IMAGE_MODEL_ADAPTER_IDS.includes(model.imageAdapterId as ImageModelAdapterId)
        ? model.imageAdapterId as ImageModelAdapterId
        : inferredImageAdapterId;
      const modelId = imageFamilyIdForAdapter(imageAdapterId) || sourceModelId;
      const linkedH3Workflow = comfyWorkflows.find((workflow) => (
        workflow.id === String(model.comfyWorkflowId || '')
        && workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND
        && workflow.channelId === String(model.channelId || '')
      ));
      const managedLocalH3Candidate = modelChannel?.type === 'comfyui'
        && modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase()
        && Boolean(linkedH3Workflow);
      const allowedVideoAdapterIds = VIDEO_MODEL_ADAPTER_OPTIONS
        .filter((option) => managedLocalH3Candidate || !isMiniMaxH3VideoAdapterId(option.id))
        .map((option) => option.id);
      return {
        id: String(model.id || `model-${Date.now()}`),
        channelId: String(model.channelId || ''),
        alias: String(model.alias || model.modelId || 'Untitled Model'),
        modelId,
        capabilities: Array.isArray(model.capabilities) ? model.capabilities : ['text'],
        apiKeyOverride: model.apiKeyOverride ? String(model.apiKeyOverride) : '',
        reasoningEffort: allowedSetting(
          REASONING_EFFORT_OPTIONS,
          model.reasoningEffort,
          'provider_default',
        ),
        textOutputMode: allowedSetting(['auto', 'prompt-json', 'json-object', 'json-schema'] as const, model.textOutputMode, 'auto'),
        visualPromptLanguagePolicy: allowedSetting(
          ['provider_default', 'zh', 'en', 'bilingual'] as const,
          model.visualPromptLanguagePolicy,
          'provider_default',
        ),
        imageAdapterId,
        videoAdapterId: allowedSetting(
          allowedVideoAdapterIds,
          model.videoAdapterId,
          'auto',
        ),
        comfyWorkflowId: comfyWorkflowIds.has(String(model.comfyWorkflowId || ''))
          ? String(model.comfyWorkflowId)
          : undefined,
        managedBy: model.managedBy === 'comfyui_h3_workflow' ? 'comfyui_h3_workflow' as const : undefined,
        ...(model.videoGenerationDefaults && typeof model.videoGenerationDefaults === 'object'
          ? {
              videoGenerationDefaults: {
                mode: model.videoGenerationDefaults.mode ? String(model.videoGenerationDefaults.mode) : undefined,
                resolution: model.videoGenerationDefaults.resolution ? String(model.videoGenerationDefaults.resolution) : undefined,
                audioMode: allowedSetting(
                  ['provider_native', 'reuse_dialogue', 'post_dub'] as const,
                  model.videoGenerationDefaults.audioMode,
                  'post_dub',
                ),
              },
            }
          : {}),
        ...(isKieGrokVideoModelId(modelId)
          ? { kieGrokVideo: normalizeKieGrokVideoSettings(model.kieGrokVideo) }
          : {}),
        ...(isKieGptImage2ModelId(modelId)
          ? { kieGptImage2: normalizeKieGptImage2Settings(model.kieGptImage2) }
          : {}),
        ...(modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase()
          ? { minimaxH3Video: normalizeMiniMaxH3VideoSettings(model.minimaxH3Video) }
          : {}),
      } as AIModel;
    })
    .filter((model) => channelIds.has(model.channelId));
  const h3WorkflowById = new Map(comfyWorkflows
    .filter((workflow) => workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND)
    .map((workflow) => [workflow.id, workflow]));
  const h3WorkflowChannelIds = new Set(Array.from(h3WorkflowById.values())
    .map((workflow) => workflow.channelId)
    .filter((channelId): channelId is string => Boolean(channelId)));
  normalizedChannels.forEach((channel) => {
    if (channel.type === 'comfyui' && h3WorkflowChannelIds.has(channel.id)
      && (channel.managedBy === 'comfyui_h3_workflow' || channel.id.startsWith('channel-comfyui-h3-'))) {
      channel.managedBy = 'comfyui_h3_workflow';
    }
  });
  normalizedModelCandidates.forEach((model) => {
    const channel = normalizedChannels.find((item) => item.id === model.channelId);
    const workflow = model.comfyWorkflowId ? h3WorkflowById.get(model.comfyWorkflowId) : undefined;
    if (model.modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase()
      && channel?.type === 'comfyui'
      && workflow?.channelId === model.channelId) {
      model.managedBy = 'comfyui_h3_workflow';
    }
  });
  const invalidH3ModelIds = new Set(normalizedModelCandidates
    .filter((model) => {
      if (model.modelId.toLowerCase() !== MINIMAX_H3_MODEL_ID.toLowerCase()) return false;
      const channel = normalizedChannels.find((item) => item.id === model.channelId);
      const workflow = model.comfyWorkflowId ? h3WorkflowById.get(model.comfyWorkflowId) : undefined;
      return model.managedBy !== 'comfyui_h3_workflow'
        || channel?.type !== 'comfyui'
        || workflow?.channelId !== model.channelId;
    })
    .map((model) => model.id));
  const withoutInvalidH3 = normalizedModelCandidates.filter((model) => !invalidH3ModelIds.has(model.id));
  const imageFamilyGroups = new Map<string, AIModel[]>();
  withoutInvalidH3.forEach((model) => {
    if (!model.imageAdapterId) return;
    const key = `${model.channelId}:${model.imageAdapterId}`;
    imageFamilyGroups.set(key, [...(imageFamilyGroups.get(key) || []), model]);
  });
  const imageModelRedirects = new Map<string, string>();
  const removedDuplicateImageModelIds = new Set<string>();
  imageFamilyGroups.forEach((group) => {
    if (group.length < 2) return;
    const routed = group.find((model) => rawRouting.imageGen === model.id);
    const winner = routed || group[0];
    group.forEach((model) => {
      imageModelRedirects.set(model.id, winner.id);
      if (model.id !== winner.id) removedDuplicateImageModelIds.add(model.id);
    });
  });
  const normalizedModels = withoutInvalidH3.filter((model) => !removedDuplicateImageModelIds.has(model.id));
  const invalidH3ChannelIds = new Set(normalizedModelCandidates
    .filter((model) => invalidH3ModelIds.has(model.id))
    .map((model) => model.channelId));
  const remainingModelChannelIds = new Set(normalizedModels.map((model) => model.channelId));
  const finalChannels = normalizedChannels.filter((channel) => (
    !invalidH3ChannelIds.has(channel.id) || remainingModelChannelIds.has(channel.id)
  ));
  const modelIds = new Set(normalizedModels.map((model) => model.id));
  const routing = (Object.keys(defaultRouting) as (keyof TaskRouting)[]).reduce<TaskRouting>((result, task) => {
    const rawModelId = String(rawRouting[task] || '');
    const modelId = imageModelRedirects.get(rawModelId) || rawModelId;
    const model = modelIds.has(modelId) ? normalizedModels.find((item) => item.id === modelId) : undefined;
    result[task] = model?.capabilities.includes(taskCapabilityRequirements[task]) ? modelId : '';
    return result;
  }, { ...defaultRouting });
  return {
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    channels: finalChannels,
    models: normalizedModels,
    routing,
    visualQcEnabled: input?.visualQcEnabled !== false,
    comfyWorkflows,
  };
}
