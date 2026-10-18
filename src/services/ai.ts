import { parseModelJson, assertProviderCompletion, jsonTransportMode, assertModelSchema } from '../../packages/model-output/src';
import { resolveTextOutputProfile } from '../config/textModelOutput';
import { resolveManualAIRequest, isManualAIExecution, manualAIMediaHasAudio } from "../../apps/web/src/clients/manualAIClient";
import { manualAIPromptText, type ManualAIPromptReview } from "../../packages/domain/src/manualAI";
import { Modality } from "@google/genai";
import { speechClient } from '../../apps/web/src/clients/speechClient';
import { assetClient } from '../../apps/web/src/clients/assetClient';
import { speechAudioDataUrl } from '../utils/speechAudio';
import { useAIConfigStore, AIChannel, AIModel } from "../store/useAIConfigStore";
import { usePromptCompositionAuditStore } from "../store/usePromptCompositionAuditStore";
import {
  isOpenAICompatibleTextChannelType,
  MINIMAX_H3_MODEL_ID,
  openAICompatibleReasoningParams,
  resolveKieOpenAICompatibleTextBaseUrl,
} from "../config/aiConfigDefaults";

import { useGlobalStore } from "../store/useGlobalStore";
import {
  generateKieGrokVideo,
  queryKieGrokVideoTask,
  submitKieGrokVideoTask,
} from "./providers/kieGrokVideo";
import { generateKieGrokImage } from "./providers/kieGrokImage";
import { assertImageGenerationRequestSupported } from "./providers/imageModelCapabilities";
import { createLegacyVideoGenerationIntent } from "./production/videoGenerationIntent";
import { resolveVideoModelAdapter } from "./production/videoModelAdapterRegistry";
import { buildLegacyGenericVideoRequest, KIE_GROK_I2V_ADAPTER_ID } from "./production/genericVideoAdapter";
import {
  assertFinalVideoPromptPreservesVisualStyleContract,
  buildVideoVisualRecipeBoundary,
  type VideoGenerationAdapterPlan,
} from "./production/videoModelAdapter";
import type { VideoGenerationIntent } from "./production/videoGenerationIntent";
import { buildVideoGenerationTaskAudit } from "./production/videoGenerationTaskAudit";
import {
  buildMiniMaxH3VideoRequest,
  miniMaxH3GenerationModeForAdapter,
  MINIMAX_H3_REF2VA_ADAPTER_ID,
} from "./production/minimaxH3Adapter";
import {
  queryMiniMaxH3VideoTask,
} from "./providers/minimaxH3Video";
import {
  prepareComfyUIH3Intent,
  queryComfyUIH3VideoTask,
  submitComfyUIH3VideoTask,
} from "./providers/comfyUIH3Video";
import type { VideoGenerationTask } from "./providers/videoGenerationTask";
import {
  compileVideoProviderPrompt,
  resolveVideoProviderType,
  resolveVisualPromptLanguageProfile,
  type VideoMotionContract,
  type VideoProviderPromptAudit,
} from "./production/visualPromptLanguageProfile";
import {
  comfyUIImageDimensionsForAspectRatio,
  compileImageGenerationRequest,
  doubaoImageSizeForAspectRatio,
  openAIImageSizeForAspectRatio,
  type CompiledImageGenerationRequest,
  type ImageGenerationRequest,
} from "./production/imageGenerationRequest";
import {
  composePromptBlocks,
  markPromptBlocksDuplicatedByManifest,
  promptBlocksFromText,
  promptContentHash,
  type PromptCompositionBlockInput,
  type PromptCompositionManifest,
} from "./production/promptComposition";
import type { AIExecutionProvenance, VisualCompileManifest } from "../clients/domainTypes";

// Helper to get channel and model
function getModelAndChannel(
  taskId: keyof ReturnType<typeof useAIConfigStore.getState>['routing'],
  modelConfigId?: string,
) {
  const state = useAIConfigStore.getState();
  const modelId = modelConfigId || state.routing[taskId];
  const model = state.models.find(m => m.id === modelId);
  if (!model) return null;
  const channel = state.channels.find(c => c.id === model.channelId);
  if (!channel) return null;
  return { model, channel };
}

const requiredCapabilityByTask: Partial<Record<keyof ReturnType<typeof useAIConfigStore.getState>['routing'], AIModel['capabilities'][number]>> = {
  scriptGen: 'text',
  storyboardGen: 'text',
  imageGen: 'image',
  videoGen: 'video',
  audioGen: 'audio',
  videoExtraction: 'text',
  qcAnalyzer: 'text',
  visualQc: 'vision',
};

const ensureAIConfigHydrated = async () => {
  await useAIConfigStore.getState().hydrate();
};

export const ensureAIProviderTaskReady = async (
  taskId: keyof ReturnType<typeof useAIConfigStore.getState>['routing'],
  taskLabel: string,
) => {
  if (isManualAIExecution()) return getModelAndChannel(taskId);
  await ensureAIConfigHydrated();
  const config = getModelAndChannel(taskId);
  if (!config) throw new Error(`No model configured for task: ${taskId}`);
  const { model, channel } = config;
  if (!model.modelId) {
    throw new Error(`Model ID is missing for the selected model (${model.alias}). Please check your AI settings.`);
  }
  const requiredCapability = requiredCapabilityByTask[taskId];
  if (requiredCapability && !model.capabilities.includes(requiredCapability)) {
    throw new Error(`${taskLabel} 已选择 ${model.alias}，但该模型未声明 ${requiredCapability} 能力。请在设置页选择兼容模型。`);
  }
  await ensureServerEnvKeyAvailable(model, channel, taskLabel);
  return config;
};

const resolveClientApiKey = (model: AIModel, channel: AIChannel) => {
  const modelOverride = (model.apiKeyOverride || '').trim();
  if (modelOverride) return modelOverride;
  return (channel.apiKey || '').trim();
};

const supportsServerEnvKey = (channel: AIChannel) =>
  channel.type === 'openai' ||
  channel.type === 'gemini' ||
  channel.type === 'deepseek' ||
  channel.type === 'doubao' ||
  channel.type === 'minimax' ||
  channel.type === 'kie';

const ensureServerEnvKeyAvailable = async (model: AIModel, channel: AIChannel, taskLabel: string) => {
  if (model.apiKeyOverride?.trim() || channel.apiKey?.trim() || !supportsServerEnvKey(channel)) {
    return;
  }
  const response = await fetch('/api/provider-key-status');
  if (!response.ok) {
    throw new Error(`无法确认 ${channel.name} 的密钥状态，请在设置页确认渠道配置后重试。`);
  }
  const status = await response.json();
  if (!status?.[channel.type]) {
    throw new Error(`${taskLabel} 已选择 ${channel.name}，但数据库渠道 API Key 和 ${channel.type} 环境变量都没有检测到。请在设置页填写渠道 API Key 后重试。`);
  }
};

const DEFAULT_CUSTOM_BGM_ENV_NAME = 'OMNI_CUSTOM_BGM_API_KEY';

const resolveCustomBgmKeySource = (settings: ReturnType<typeof useGlobalStore.getState>['bgmSettings']) =>
  settings.customKeySource || (settings.customApiKey?.trim() ? 'local' : 'serverEnv');

const ensureCustomBgmServerEnvKeyAvailable = async (envName: string) => {
  const params = new URLSearchParams({ customBgmKeySlot: envName });
  const response = await fetch(`/api/provider-key-status?${params.toString()}`);
  if (!response.ok) {
    throw new Error('无法确认自定义 BGM 的服务端密钥状态，请在设置页刷新 Server Env 状态后重试。');
  }
  const status = await response.json();
  if (!status?.customBgm?.ready) {
    const serverMessage = status?.customBgm?.error ? ` ${status.customBgm.error}` : '';
    throw new Error(`自定义 BGM 已选择 serverEnv 密钥来源，但服务端没有检测到 ${envName}。请在设置页切换到 Local Key，或配置服务端 env 后刷新状态。${serverMessage}`);
  }
};

const redactProviderText = (value: unknown, maxLength = 500) => {
  const raw = typeof value === "string" ? value : value instanceof Error ? value.message : JSON.stringify(value ?? "");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[redacted]"')
    .slice(0, maxLength);
};

const providerErrorSummary = (error: unknown) => ({
  name: error instanceof Error ? error.name : typeof error,
  message: redactProviderText(error, 300),
});

const callGeminiProxy = async (action: string, payload: any, apiKey?: string, channelId?: string) => {
  const res = await fetch('/api/proxy/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      payload,
      apiKey: apiKey || undefined,
      channelId: channelId || undefined,
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini proxy ${action} error (${res.status}): ${redactProviderText(errText)}`);
  }
  return res.json();
};

const downloadGeminiVideoViaProxy = async (uri: string, apiKey?: string) => {
  const res = await fetch('/api/proxy/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'downloadVideo',
      payload: { uri },
      apiKey: apiKey || undefined,
    })
  });
  if (!res.ok) {
    throw new Error(`Proxy video download error: ${res.statusText}`);
  }
  return res.blob();
};

const combineReviewedMediaPrompt = (review: ManualAIPromptReview) => [review.systemInstruction, review.prompt].filter(Boolean).join("\n\n").trim();

const recordReviewedAudioPrompt = (prompt: string, instructions: string | undefined, channelType: string, modelId: string) => {
  const composition = composePromptBlocks([
    { blockId: "audio.instructions", source: "audio_prompt_review", purpose: "声音表演或音乐要求", content: instructions, required: false },
    { blockId: "audio.prompt", source: "audio_prompt_review", purpose: "已确认的声音生成内容", content: prompt, required: true },
  ]);
  usePromptCompositionAuditStore.getState().record({ phase: "initial", taskType: "audioGen", channelType, modelId, manifest: composition.manifest });
};

export async function generateAIImage(options: ImageGenerationRequest & {
  onPromptCompiled?: (compiled: CompiledImageGenerationRequest) => void;
  onExecutionProvenance?: (audit: AIExecutionProvenance) => void;
}): Promise<string> {
  let manualCompiled = compileImageGenerationRequest(options, { enforcement: "draft" });
  const references = manualCompiled.referenceImages.map((url, index) => ({ url, label: `参考图 ${index + 1}` }));
  const imageContext = `画幅：${manualCompiled.aspectRatio}（通过请求参数传递）。参考图职责、视觉规范与输出约束保留在完整请求中。`;
  const manual = await resolveManualAIRequest({
    kind: "image", prompt: options.promptCore, context: imageContext, references,
    previewPrompt: review => manualAIPromptText({ kind: "image", prompt: compileImageGenerationRequest({ ...options, promptCore: combineReviewedMediaPrompt(review) }, { enforcement: "draft" }).providerPrompt, context: imageContext, references }),
  }, review => {
    const reviewedOptions = { ...options, promptCore: combineReviewedMediaPrompt(review) };
    const compiled = compileImageGenerationRequest(reviewedOptions, { enforcement: "draft" });
    options = reviewedOptions;
    manualCompiled = compiled;
  });
  if (manual !== undefined) {
    options.onExecutionProvenance?.({ source: "manual_external", provider: "manual_external", modelId: "manual_external", requestedModelId: useAIConfigStore.getState().routing.imageGen });
    options.onPromptCompiled?.(manualCompiled);
    usePromptCompositionAuditStore.getState().record({ phase: "image_generation", taskType: "imageGen", channelType: "manual_external", modelId: "external-image", manifest: manualCompiled.manifest });
    return manual;
  }
  const config = await ensureAIProviderTaskReady('imageGen', '图片生成');
  const { model, channel } = config;
  const compiled = compileImageGenerationRequest(options, { enforcement: "formal" });
  options.onExecutionProvenance?.({ source: "api", provider: channel.type, modelId: model.modelId, requestedModelId: model.id });
  options.onPromptCompiled?.(compiled);
  const referenceImages = compiled.referenceImages;
  assertImageGenerationRequestSupported({ channel, model, referenceImages });
  usePromptCompositionAuditStore.getState().record({
    phase: "image_generation",
    taskType: "imageGen",
    channelType: channel.type,
    modelId: model.modelId,
    manifest: compiled.manifest,
  });
  const normalizedOptions = {
    ...options,
    prompt: compiled.providerPrompt,
    aspectRatio: compiled.aspectRatio,
    referenceImages: referenceImages.length ? referenceImages : undefined,
  };

  if (channel.type === 'kie') {
    return generateKieGrokImage({ channel, model, options: normalizedOptions });
  }

  let apiKey = resolveClientApiKey(model, channel);
  
  // Remove "Bearer " prefix if user accidentally included it
  if (apiKey.startsWith('Bearer ')) {
    apiKey = apiKey.substring(7);
  }
  if (channel.type === 'gemini') {
    // Runtime compatibility mapping:
    let resolvedModelId = model.modelId;
    if (resolvedModelId === 'gemini-2.5-flash-image') {
      resolvedModelId = 'imagen-3.0-generate-002';
    }

    const response = await callGeminiProxy('generateImages', {
      model: resolvedModelId,
      prompt: compiled.providerPrompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: compiled.aspectRatio,
      }
    }, apiKey, channel.id);

    if (response.generatedImages && response.generatedImages.length > 0) {
      const base64EncodeString = response.generatedImages[0].image.imageBytes;
      return `data:image/png;base64,${base64EncodeString}`;
    }
    throw new Error("No image generated");
  } else if (channel.type === 'openai') {
    const response = await fetch('/api/proxy/openai-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: channel.baseUrl || "https://api.openai.com/v1",
        channelId: channel.id,
        apiKey,
        body: {
          model: model.modelId,
          prompt: compiled.providerPrompt,
          n: 1,
          size: openAIImageSizeForAspectRatio(compiled.aspectRatio),
          response_format: "b64_json",
        }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI image proxy error (${response.status}): ${redactProviderText(data)}`);
    }
    if (data.data?.[0]?.b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    }
    throw new Error("No image generated");
  } else if (channel.type === 'doubao') {
    // Direct fetch for Doubao to avoid OpenAI SDK body serialization issues
    const doubaoUrl = channel.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
    
    const requestBody: any = {
      model: model.modelId,
      prompt: compiled.providerPrompt,
      size: doubaoImageSizeForAspectRatio(compiled.aspectRatio),
      response_format: "url",
      watermark: false
    };

    if (referenceImages.length > 0) {
      requestBody.image = referenceImages;
      requestBody.sequential_image_generation = "disabled";
    }

    let response;
    try {
      response = await fetch('/api/proxy/doubao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${doubaoUrl}/images/generations`,
          channelId: channel.id,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          rawBody: JSON.stringify(requestBody)
        })
      });
    } catch (e: any) {
      console.error("Doubao client-side fetch failed:", providerErrorSummary(e));
      throw new Error(`豆包供应商网络请求失败：${redactProviderText(e?.message || e, 300)}`);
    }

    if (!response.ok) {
      const dataStr = await response.text();
      throw new Error(`Doubao API Error (${response.status}): ${redactProviderText(dataStr)}`);
    }

    const data = await response.json();


    if (data.data && data.data.length > 0 && data.data[0].url) {
      return data.data[0].url;
    }
    
    throw new Error("No image generated from Doubao");
  } else if (channel.type === 'comfyui') {
    // ComfyUI implementation
    const state = useAIConfigStore.getState();
    // For simplicity, we just find the first comfy workflow
    const workflow = state.comfyWorkflows[0];
    if (!workflow) throw new Error("No ComfyUI workflow configured");

    const promptJson = JSON.parse(JSON.stringify(workflow.workflowJson));
    const dimensionMappings = new Set(workflow.mappings.map((mapping) => mapping.systemParam));
    if (!dimensionMappings.has("width") || !dimensionMappings.has("height")) {
      throw new Error("ComfyUI 图片工作流缺少 width/height 结构化映射，已阻止忽略画幅继续生成。请在工作流参数对应中补齐宽高节点。");
    }
    const dimensions = comfyUIImageDimensionsForAspectRatio(compiled.aspectRatio);
    workflow.mappings.forEach(mapping => {
      if (mapping.systemParam === 'prompt' && promptJson[mapping.nodeId]) {
        promptJson[mapping.nodeId].inputs[mapping.nodeInput] = compiled.providerPrompt;
      }
      if (mapping.systemParam === 'width' && promptJson[mapping.nodeId]) {
        promptJson[mapping.nodeId].inputs[mapping.nodeInput] = dimensions.width;
      }
      if (mapping.systemParam === 'height' && promptJson[mapping.nodeId]) {
        promptJson[mapping.nodeId].inputs[mapping.nodeInput] = dimensions.height;
      }
      if (mapping.systemParam === 'seed' && promptJson[mapping.nodeId]) {
        promptJson[mapping.nodeId].inputs[mapping.nodeInput] = Math.floor(Math.random() * 1000000000);
      }
    });

    const baseUrl = channel.baseUrl.replace(/\/$/, '');
    const submitRes = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptJson })
    });
    const submitData = await submitRes.json();
    const promptId = submitData.prompt_id;

    // Poll for history
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const historyRes = await fetch(`${baseUrl}/history/${promptId}`);
      const historyData = await historyRes.json();
      if (historyData[promptId]) {
        const outputs = historyData[promptId].outputs;
        for (const nodeId in outputs) {
          if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
            const image = outputs[nodeId].images[0];
            // Fetch the actual image
            const imgRes = await fetch(`${baseUrl}/view?filename=${image.filename}&subfolder=${image.subfolder}&type=${image.type}`);
            const imgBlob = await imgRes.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(imgBlob);
            });
          }
        }
        throw new Error("No image in ComfyUI output");
      }
    }
  } else {
    throw new Error(`Unsupported channel type for image generation: ${channel.type}`);
  }
}

async function executeAIVideo(options: {
  prompt: string;
  imageUrl: string;
  durationSeconds: number;
  endImageUrl?: string;
  aspectRatio?: "16:9" | "9:16";
  modelConfigId?: string;
  adapterId?: string;
  motionContract?: VideoMotionContract;
  visualStyleCompileManifest?: VisualCompileManifest;
  onProviderPromptPrepared?: (audit: VideoProviderPromptAudit) => void;
  onAdapterPlanPrepared?: (plan: VideoGenerationAdapterPlan) => void;
}, alreadyReviewed = false): Promise<string> {
  const manual = alreadyReviewed ? undefined : await resolveManualAIRequest({ kind: "video", prompt: options.prompt, references: [options.imageUrl, options.endImageUrl].filter(Boolean).map((url, index) => ({ url, label: `参考帧 ${index + 1}` })) }, review => { options = { ...options, prompt: combineReviewedMediaPrompt(review) }; });
  if (manual !== undefined) {
    const composition = composePromptBlocks([{ blockId: "manual.video", source: "manual_external", purpose: "已确认的外部视频提示词", content: options.prompt, required: true }]);
    options.onProviderPromptPrepared?.({ authorPrompt: options.prompt, finalProviderPrompt: options.prompt, profile: resolveVisualPromptLanguageProfile({ providerId: "manual_external", modelId: "external-video" }), providerType: "default", motionContract: options.motionContract, technicalDeltas: [], nativeOptions: {}, manifest: composition.manifest });
    usePromptCompositionAuditStore.getState().record({ phase: "video_generation", taskType: "videoGen", channelType: "manual_external", modelId: "external-video", manifest: composition.manifest });
    return manual;
  }
  await ensureAIConfigHydrated();
  const config = getModelAndChannel('videoGen', options.modelConfigId);
  if (!config) throw new Error(`No model configured for task: videoGen`);
  const { model, channel } = config;
  const baseProviderPromptAudit = compileVideoProviderPrompt({
    authorPrompt: options.prompt,
    profile: resolveVisualPromptLanguageProfile({
      providerId: channel.type,
      modelId: model.modelId,
      policy: model.visualPromptLanguagePolicy,
    }),
    providerType: resolveVideoProviderType(channel.type, model.modelId),
    motionContract: options.motionContract,
  });
  const directIntent = {
    ...createLegacyVideoGenerationIntent(options),
    ...(options.visualStyleCompileManifest
      ? { visualStyleCompileManifest: options.visualStyleCompileManifest }
      : {}),
  };
  const directRecipeBoundary = buildVideoVisualRecipeBoundary({
    intent: directIntent,
    adapterId: options.adapterId || "video.legacy.direct.v1",
    enforcement: "formal",
  });
  const existingRecipeBlocks = options.prompt.match(/<visual_recipe_contract>[\s\S]*?<\/visual_recipe_contract>/g) || [];
  if (existingRecipeBlocks.length > 1 || (existingRecipeBlocks.length === 1 && existingRecipeBlocks[0] !== directRecipeBoundary.promptBlock)) {
    throw new Error("视频提示词中的视觉任务 Recipe 合同缺失、重复或已被修改。");
  }
  const providerComposition = existingRecipeBlocks.length
    ? { prompt: baseProviderPromptAudit.finalProviderPrompt, manifest: baseProviderPromptAudit.manifest }
    : composePromptBlocks([
        {
          blockId: "video.provider_task",
          source: "compileVideoProviderPrompt",
          purpose: "供应商视频任务与结构化运动约束",
          content: baseProviderPromptAudit.finalProviderPrompt,
          required: true,
        },
        {
          blockId: "video.recipe_contract",
          source: `VisualTaskRecipe.${directRecipeBoundary.contract.recipeId}@${directRecipeBoundary.contract.recipeVersion}`,
          purpose: "视频产物的输入、工作步骤与待复核验收合同",
          content: directRecipeBoundary.promptBlock,
          required: true,
        },
      ]);
  const providerPromptAudit: VideoProviderPromptAudit = {
    ...baseProviderPromptAudit,
    finalProviderPrompt: providerComposition.prompt,
    manifest: providerComposition.manifest,
    visualStyleCompileManifest: directRecipeBoundary.visualStyleCompileManifest,
    visualRecipeContract: directRecipeBoundary.contract,
  };
  options.onProviderPromptPrepared?.(providerPromptAudit);
  const providerPrompt = providerPromptAudit.finalProviderPrompt;
  usePromptCompositionAuditStore.getState().record({
    phase: "video_generation",
    taskType: "videoGen",
    channelType: channel.type,
    modelId: model.modelId,
    manifest: providerPromptAudit.manifest,
  });
  let apiKey = resolveClientApiKey(model, channel);

  // Remove "Bearer " prefix if user accidentally included it
  if (apiKey.startsWith('Bearer ')) {
    apiKey = apiKey.substring(7);
  }
  await ensureServerEnvKeyAvailable(model, channel, '视频生成');

  if (channel.type === 'kie') {
    if (options.endImageUrl) {
      throw new Error(`${model.alias} 只支持单张首帧图片，不能发送尾帧。`);
    }
    const intent = directIntent;
    const adapter = resolveVideoModelAdapter({
      channelType: channel.type,
      modelId: model.modelId,
      configuredAdapterId: options.adapterId || model.videoAdapterId,
    });
    const adapterPlan = adapter.compile({
      intent,
      modelConfigId: model.id,
      mode: model.videoGenerationDefaults?.mode,
      resolution: model.videoGenerationDefaults?.resolution,
      contractEnforcement: "formal",
    });
    const confirmedAdapterPlan = {
      ...adapterPlan,
      finalConfirmedPrompt: providerPrompt,
    };
    options.onAdapterPlanPrepared?.(confirmedAdapterPlan);
    const request = buildLegacyGenericVideoRequest(intent, confirmedAdapterPlan);
    return generateKieGrokVideo({
      channel,
      model,
      options: {
        prompt: request.prompt,
        imageUrl: request.imageUrl,
        durationSeconds: request.durationSeconds,
        aspectRatio: request.aspectRatio,
      },
    });
  }

  if (channel.type === 'gemini') {
    const imageToInlineData = async (url: string) => {
      let dataUrl = url;
      if (!url.startsWith("data:")) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to read frame image: ${response.status}`);
        const blob = await response.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("Unable to read frame image"));
          reader.readAsDataURL(blob);
        });
      }
      const separator = dataUrl.indexOf(",");
      const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
      if (separator < 0 || !mimeMatch) throw new Error("Frame image must be a readable image URL or base64 data URL");
      return { imageBytes: dataUrl.slice(separator + 1), mimeType: mimeMatch[1] };
    };
    const firstFrame = await imageToInlineData(options.imageUrl);
    const supportsLastFrame = /(?:^|\/)veo-3\.1(?:-|$)/i.test(model.modelId);
    if (options.endImageUrl && !supportsLastFrame) {
      throw new Error(`Configured video model ${model.modelId} does not support last-frame interpolation`);
    }
    const lastFrame = options.endImageUrl ? await imageToInlineData(options.endImageUrl) : undefined;

    let operation = await callGeminiProxy('generateVideos', {
      model: model.modelId,
      prompt: providerPrompt,
      image: firstFrame,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: options.aspectRatio || '16:9',
        ...(lastFrame ? { lastFrame } : {}),
      }
    }, apiKey, channel.id);

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await callGeminiProxy('getVideosOperation', { operation }, apiKey, channel.id);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("No video generated");

    const blob = await downloadGeminiVideoViaProxy(downloadLink, apiKey);
    const { persistMediaBlob } = await import("../utils/storage");
    return persistMediaBlob(blob);
  } else {
    throw new Error(`Unsupported channel type for video generation: ${channel.type}`);
  }
}

export const generateAIVideo = (options: Parameters<typeof executeAIVideo>[0]): Promise<string> => executeAIVideo(options);

export interface GenerateVideoFromIntentOptions {
  intent: VideoGenerationIntent;
  modelConfigId?: string;
  adapterId?: string;
  mode?: string;
  resolution?: string;
  finalConfirmedPrompt?: string;
  idempotencyKey: string;
  audit?: Record<string, unknown>;
  onAdapterPlanPrepared?: (plan: VideoGenerationAdapterPlan) => void;
}

export type VideoGenerationExecutionResult =
  | {
      kind: "completed";
      videoUrl: string;
      embeddedAudio: boolean;
      adapterPlan: VideoGenerationAdapterPlan;
    }
  | {
      kind: "task";
      task: VideoGenerationTask;
      adapterPlan: VideoGenerationAdapterPlan;
    };

export const generateVideoFromIntent = async (
  options: GenerateVideoFromIntentOptions,
): Promise<VideoGenerationExecutionResult> => {
  const originalReviewedPrompt = options.finalConfirmedPrompt || options.intent.directorIntent;
  const manual = await resolveManualAIRequest({ kind: "video", prompt: originalReviewedPrompt, references: options.intent.referenceBindings.map((binding, index) => ({ url: binding.mediaUrl, label: `参考素材 ${index + 1}` })) }, review => {
    const prompt = combineReviewedMediaPrompt(review);
    if (prompt !== originalReviewedPrompt) options = options.finalConfirmedPrompt
      ? { ...options, finalConfirmedPrompt: prompt }
      : { ...options, intent: { ...options.intent, directorIntent: prompt } };
  });
  if (manual !== undefined) {
    const boundary = buildVideoVisualRecipeBoundary({ intent: options.intent, adapterId: "manual_external", enforcement: "draft" });
    const prompt = options.finalConfirmedPrompt || options.intent.directorIntent;
    const adapterPlan: VideoGenerationAdapterPlan = {
      schemaVersion: "video-generation-adapter-plan.v1", adapterId: "manual_external", adapterVersion: "v1", modelConfigId: "external-video", mode: "manual_upload",
      referenceManifest: [], timelinePlan: options.intent.timelineBeats, canonicalPrompt: prompt, adapterPrompt: prompt, finalConfirmedPrompt: prompt,
      visualRecipeContract: boundary.contract, visualStyleCompileManifest: boundary.visualStyleCompileManifest,
      requestPreview: { imageCount: 0, videoCount: 0, audioCount: 0, durationSeconds: options.intent.durationSeconds, nativeAudioExpected: false }, issues: [], sourceHash: options.intent.sourceHash,
    };
    options.onAdapterPlanPrepared?.(adapterPlan);
    const composition = composePromptBlocks([{ blockId: "manual.video.intent", source: "manual_external", purpose: "已确认的外部视频提示词", content: prompt, required: true }]);
    usePromptCompositionAuditStore.getState().record({ phase: "video_generation", taskType: "videoGen", channelType: "manual_external", modelId: "external-video", manifest: composition.manifest });
    return { kind: "completed", videoUrl: manual, embeddedAudio: manualAIMediaHasAudio(manual), adapterPlan };
  }
  await ensureAIConfigHydrated();
  const config = getModelAndChannel("videoGen", options.modelConfigId);
  if (!config) throw new Error("没有找到当前视频生成模型。");
  const { model, channel } = config;
  if (!model.capabilities.includes("video")) throw new Error(`${model.alias} 没有声明视频生成能力。`);
  if (channel.type === "minimax" && model.modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase()) {
    throw new Error("云端 MiniMax H3 已从模型配置下线；请在“本地 ComfyUI”中保存 H3 工作流后再生成视频。");
  }
  await ensureServerEnvKeyAvailable(model, channel, "视频生成");
  const adapter = resolveVideoModelAdapter({
    channelType: channel.type,
    modelId: model.modelId,
    configuredAdapterId: options.adapterId || model.videoAdapterId,
  });
  if (channel.type === "comfyui" && adapter.id !== MINIMAX_H3_REF2VA_ADAPTER_ID) {
    throw new Error("当前本地 ComfyUI 只配置了 MiniMax H3 图片参考生成方式。");
  }
  const effectiveIntent = channel.type === "comfyui" ? prepareComfyUIH3Intent(options.intent) : options.intent;
  const plan = adapter.compile({
    intent: effectiveIntent,
    modelConfigId: model.id,
    mode: options.mode || model.minimaxH3Video?.defaultMode || model.videoGenerationDefaults?.mode,
    resolution: options.resolution || model.minimaxH3Video?.resolution || model.videoGenerationDefaults?.resolution,
    contractEnforcement: "formal",
  });
  const finalConfirmedPrompt = options.finalConfirmedPrompt?.trim() || plan.adapterPrompt;
  assertFinalVideoPromptPreservesVisualStyleContract(effectiveIntent, plan, finalConfirmedPrompt);
  const confirmedPlan = {
    ...plan,
    finalConfirmedPrompt,
  };
  options.onAdapterPlanPrepared?.(confirmedPlan);

  const adapterPromptComposition = composePromptBlocks([{
    blockId: "video.adapter_task",
    source: `VideoGenerationAdapter.${confirmedPlan.adapterId}`,
    purpose: "适配器确认后的视频生成任务",
    content: confirmedPlan.finalConfirmedPrompt,
    required: true,
  }]);

  if (!options.idempotencyKey.trim()) throw new Error("视频生成任务缺少重复提交保护信息。");
  const taskAudit = buildVideoGenerationTaskAudit({
    intent: effectiveIntent,
    plan: confirmedPlan,
    promptCompositionManifest: adapterPromptComposition.manifest,
    extra: options.audit,
  });

  if (miniMaxH3GenerationModeForAdapter(adapter.id)) {
    const request = buildMiniMaxH3VideoRequest(effectiveIntent, confirmedPlan);
    if (channel.type === "comfyui") {
      usePromptCompositionAuditStore.getState().record({
        phase: "video_generation",
        taskType: "videoGen",
        channelType: channel.type,
        modelId: model.modelId,
        manifest: adapterPromptComposition.manifest,
      });
      const task = await submitComfyUIH3VideoTask({
        channel,
        model,
        request,
        idempotencyKey: options.idempotencyKey,
        audit: taskAudit,
      });
      return { kind: "task", task, adapterPlan: confirmedPlan };
    }
    throw new Error("云端 MiniMax H3 已下线；当前 H3 生成只允许使用本地 ComfyUI 工作流。");
  }

  const request = buildLegacyGenericVideoRequest(options.intent, confirmedPlan);
  if (adapter.id === KIE_GROK_I2V_ADAPTER_ID) {
    usePromptCompositionAuditStore.getState().record({
      phase: "video_generation",
      taskType: "videoGen",
      channelType: channel.type,
      modelId: model.modelId,
      manifest: adapterPromptComposition.manifest,
    });
    const task = await submitKieGrokVideoTask({
      channel,
      model,
      options: request,
      idempotencyKey: options.idempotencyKey,
      audit: taskAudit,
    });
    return { kind: "task", task, adapterPlan: confirmedPlan };
  }
  const videoUrl = await executeAIVideo({
    ...request,
    modelConfigId: model.id,
    adapterId: adapter.id,
    visualStyleCompileManifest: confirmedPlan.visualStyleCompileManifest,
  }, true);
  return { kind: "completed", videoUrl, embeddedAudio: false, adapterPlan: confirmedPlan };
};

export const queryVideoGenerationTask = (
  taskId: string,
  provider: VideoGenerationTask["provider"] = "minimax_h3",
) => provider === "kie_grok"
  ? queryKieGrokVideoTask(taskId)
  : provider === "comfyui_h3" ? queryComfyUIH3VideoTask(taskId) : queryMiniMaxH3VideoTask(taskId);

export async function generateAIVoice(options: {
  text: string;
  voiceName: string;
  modelConfigId?: string;
  language?: string;
  instructions?: string;
  speed?: number;
  projectId?: string;
}): Promise<string> {
  const manual = await resolveManualAIRequest({ kind: "audio", prompt: options.text, systemInstruction: options.instructions, context: [`固定音色：${options.voiceName}`, `语言：${options.language || 'Auto'}`, `语速参数：${options.speed ?? 1}（以模型支持为准）`].join('\n') }, review => { options = { ...options, text: review.prompt, instructions: review.systemInstruction }; });
  if (manual !== undefined) {
    recordReviewedAudioPrompt(options.text, options.instructions, "manual_external", "external-audio");
    return manual;
  }
  await ensureAIConfigHydrated();
  const config = getModelAndChannel('audioGen', options.modelConfigId);
  if (!config) throw new Error(`No model configured for task: audioGen`);
  const { model, channel } = config;
  recordReviewedAudioPrompt(options.text, options.instructions, channel.type, model.modelId);
  if (['custom', 'openai', 'llamacpp'].includes(channel.type)) return (await speechClient.generate({ ...options, voice: options.voiceName, modelConfigId: model.id })).url;
  let apiKey = resolveClientApiKey(model, channel);

  // Remove "Bearer " prefix if user accidentally included it
  if (apiKey.startsWith('Bearer ')) {
    apiKey = apiKey.substring(7);
  }
  await ensureServerEnvKeyAvailable(model, channel, '语音生成');

  if (channel.type === 'gemini') {
    const maxRetries = 2;
    let lastError: any;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const response = await callGeminiProxy('generateContent', {
          model: model.modelId,
          contents: [{ parts: [{ text: [options.language && options.language !== 'Auto' ? `Language: ${options.language}` : '', options.instructions, options.text].filter(Boolean).join('\n') }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voiceName } },
            },
          },
        }, apiKey, channel.id);

        const inlineAudio = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
        const base64Audio = inlineAudio?.data;
        if (!base64Audio) throw new Error("No audio generated");
        const saved = await assetClient.uploadAsset({ dataUrl: speechAudioDataUrl(base64Audio, inlineAudio.mimeType), projectId: options.projectId });
        if (!saved.url) throw new Error('语音文件保存失败');
        return saved.url;
      } catch (err: any) {
        lastError = err;
        console.warn(`Gemini TTS attempt ${i + 1} failed:`, providerErrorSummary(err));
        if (i < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  } else {
    throw new Error(`Unsupported channel type for audio generation: ${channel.type}`);
  }
}
export async function generateAIBgm(options: {
  prompt: string;
}): Promise<string> {
  const manual = await resolveManualAIRequest({ kind: "audio", prompt: options.prompt }, review => { options = { ...options, prompt: combineReviewedMediaPrompt(review) }; });
  if (manual !== undefined) {
    recordReviewedAudioPrompt(options.prompt, undefined, "manual_external", "external-audio");
    return manual;
  }
  const state = useGlobalStore.getState();
  const settings = state.bgmSettings;
  recordReviewedAudioPrompt(options.prompt, undefined, settings.provider, settings.provider === "gemini" ? "lyria-3-clip-preview" : settings.customModelId || "suno-v3.5");

  if (settings.provider === 'gemini') {
    let audioBase64 = "";
    let mimeType = "audio/wav";

    const clientKey = (settings.customApiKey || '').trim();
    const data = await callGeminiProxy('generateContentStream', {
      model: "lyria-3-clip-preview",
      contents: options.prompt,
      config: {
        responseModalities: [Modality.AUDIO],
      }
    }, clientKey);
    audioBase64 = data.audioBase64;
    mimeType = data.mimeType || mimeType;

    if (!audioBase64) {
      throw new Error("No audio generated from Gemini Lyria");
    }

    // Decode base64 audio into a playable Blob URL
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const { persistMediaBlob } = await import("../utils/storage");
    return persistMediaBlob(blob);
  } else if (settings.provider === 'custom') {
    if (!settings.customApiUrl) {
      throw new Error("Custom API URL is not configured");
    }
    const keySource = resolveCustomBgmKeySource(settings);
    const apiKeyEnvName = settings.customApiKeyEnvName || DEFAULT_CUSTOM_BGM_ENV_NAME;
    if (keySource === 'serverEnv') {
      await ensureCustomBgmServerEnvKeyAvailable(apiKeyEnvName);
    } else if (!settings.customApiKey?.trim()) {
      throw new Error('自定义 BGM 已选择 Local Key，但本地 API Key 为空。请在设置页填写 API Key，或切换到 serverEnv。');
    }

    const response = await fetch('/api/proxy/custom-bgm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: settings.customApiUrl,
        keySource,
        apiKey: keySource === 'local' ? settings.customApiKey || undefined : undefined,
        apiKeyEnvName: keySource === 'serverEnv' ? apiKeyEnvName : undefined,
        prompt: options.prompt,
        model: settings.customModelId || 'suno-v3.5',
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom BGM proxy error (${response.status}): ${redactProviderText(errorText)}`);
    }

    const data = await response.json();
    // Assuming the custom API returns { audio_url: "..." } or similar
    // You might need to adjust this based on the actual custom API response format
    const audioUrl = data.audio_url || data.url || data.data?.[0]?.url;
    
    if (!audioUrl) {
      throw new Error("No audio URL found in custom API response");
    }
    
    return audioUrl;
  }

  throw new Error("Unsupported BGM provider");
}

export async function generateAI3DModel(options: {
  prompt: string;
  referenceImage?: string;
}): Promise<string> {
  throw new Error("capability_unavailable: 3D模型生成功能尚未接入真实供应商");
}

export async function generateAIPanorama(options: {
  prompt: string;
}): Promise<string> {
  throw new Error("capability_unavailable: 全景图生成功能尚未接入真实供应商");
}

export interface TextPromptCompositionAudit {
  prompt: string;
  systemInstruction: string;
  manifest: PromptCompositionManifest;
}

export const PROMPT_COMPOSITION_AUDIT_EVENT = "prompt-composition-audit";

const normalizeJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    key === "type" && typeof item === "string" ? item.toLowerCase() : normalizeJsonSchema(item),
  ]));
};

export async function generateAIContent(options: {
  prompt: string;
  promptBlocks?: PromptCompositionBlockInput[];
  systemInstruction?: string;
  requireJson?: boolean;
  schema?: any;
  taskType?: keyof ReturnType<typeof useAIConfigStore.getState>['routing'];
  mediaData?: { base64: string; mimeType: string };
  mediaDataList?: Array<{ base64: string; mimeType: string }>;
  onPromptComposed?: (audit: TextPromptCompositionAudit) => void;
  onExecutionProvenance?: (audit: AIExecutionProvenance) => void;
  skipManualPrompt?: boolean;
}): Promise<string> {
  const normalizedSchema = options.schema ? normalizeJsonSchema(options.schema) as Record<string, unknown> : undefined;
  if (normalizedSchema) assertModelSchema(normalizedSchema);
  const acceptText = (text: string): string => {
    if (!text?.trim()) throw new Error('模型未返回正文，请核对服务商返回');
    return options.requireJson ? JSON.stringify(parseModelJson(text, normalizedSchema)) : text;
  };
  const reviewedTaskPrompt = options.promptBlocks?.length ? composePromptBlocks(options.promptBlocks).prompt : options.prompt;
  const manual = options.skipManualPrompt
    ? undefined
    : await resolveManualAIRequest({ kind: "text", prompt: reviewedTaskPrompt, systemInstruction: options.systemInstruction, requireJson: options.requireJson, schema: options.schema, references: [options.mediaData, ...(options.mediaDataList || [])].filter(Boolean).map((media, index) => ({ url: `data:${media.mimeType};base64,${media.base64}`, label: `参考素材 ${index + 1}` })) }, review => {
    options = { ...options, prompt: review.prompt, systemInstruction: review.systemInstruction, ...(review.prompt !== reviewedTaskPrompt ? { promptBlocks: undefined } : {}) };
  });
  if (manual !== undefined) {
    const composition = composePromptBlocks([{ blockId: "manual.system", source: "manual_external", purpose: "系统要求", content: options.systemInstruction, required: false }, { blockId: "manual.prompt", source: "manual_external", purpose: "手动返回对应提示词", content: options.prompt, required: true }]);
    options.onExecutionProvenance?.({ source: "manual_external", provider: "manual_external", modelId: "manual_external", requestedModelId: useAIConfigStore.getState().routing[options.taskType || "scriptGen"] });
    options.onPromptComposed?.({ prompt: options.prompt, systemInstruction: options.systemInstruction || "", manifest: composition.manifest });
    usePromptCompositionAuditStore.getState().record({ phase: "initial", taskType: options.taskType || "scriptGen", channelType: "manual_external", modelId: "external-chat", manifest: composition.manifest });
    return acceptText(manual);
  }
  await ensureAIConfigHydrated();
  if (typeof globalThis !== 'undefined' && (globalThis as any).__mockAIResponse) {
    return acceptText(await (globalThis as any).__mockAIResponse(options));
  }
  const taskType = options.taskType || 'scriptGen';
  const visualPromptFieldPattern = /image\s*prompt|video\s*prompt|visual\s*prompt|imagePrompt|videoPrompt|multiViewPrompt|panoramaPrompt|stable diffusion|comfyui|midjourney/i;
  const isVisualPromptGen = 
    taskType === 'imageGen' || 
    taskType === 'videoGen' ||
    (taskType !== 'qcAnalyzer' && Boolean(
      (options.prompt && visualPromptFieldPattern.test(options.prompt))
      || (options.systemInstruction && visualPromptFieldPattern.test(options.systemInstruction)),
    ));

  const userLang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  let langName = 'English';
  let langCode = 'en-US';
  if (userLang.startsWith('zh')) {
    langName = '简体中文 (Simplified Chinese)';
    langCode = 'zh-CN';
  } else {
    langCode = userLang;
  }

  let langInstruction = '';
  if (isVisualPromptGen) {
    const state = useAIConfigStore.getState();
    const isVideoPrompt = taskType === 'videoGen'
      || /video\s*prompt|videoPrompt/i.test(options.prompt || '')
      || /video\s*prompt|videoPrompt/i.test(options.systemInstruction || '');
    const targetModelConfigId = isVideoPrompt ? state.routing.videoGen : state.routing.imageGen;
    const targetModel = state.models.find((item) => item.id === targetModelConfigId);
    const targetChannel = state.channels.find((item) => item.id === targetModel?.channelId);
    const profile = resolveVisualPromptLanguageProfile({
      providerId: targetChannel?.type,
      modelId: targetModel?.modelId,
      policy: targetModel?.visualPromptLanguagePolicy,
    });
    const visualLanguage = profile.policy === 'zh'
      ? '简体中文'
      : profile.policy === 'en'
        ? 'English'
        : profile.policy === 'bilingual'
          ? '简体中文与 English 双语'
          : '目标媒体模型最擅长的原生提示词语言';
    langInstruction = `【语言】视觉生成提示词字段使用${visualLanguage}；资产名称、镜头术语和专有名词保持准确。`;
  } else {
    langInstruction = `【语言】除字段级语言约束外，使用 ${langName} (${langCode}) 输出。`;
  }

  const config = getModelAndChannel(taskType);

  if (!config) {
    throw new Error(`No model configured for task: ${taskType}`);
  }

  const { model, channel } = config;
  options.onExecutionProvenance?.({ source: "api", provider: channel.type, modelId: model.modelId, requestedModelId: model.id });
  const existingContractText = `${options.systemInstruction || ""}\n${options.prompt || ""}`;
  const hasLanguageContract = /(?:输出|回答|内容|使用|respond|language).{0,32}(?:简体中文|中文为主|English|英文|zh-CN|en-US)|(?:简体中文|中文为主|English|英文).{0,24}(?:输出|回答|内容|使用)|(?:使用|保持).{0,16}(?:源文本|原文).{0,12}(?:相同|一致).{0,8}语言|same\s+language\s+as\s+(?:the\s+)?(?:source|input)|视觉生成提示词字段使用/iu.test(existingContractText);
  const hasJsonContract = /(?<!不要)(?<!禁止)(?<!不得)只(?:能|需|返回).{0,12}JSON|合法的 JSON|纯 JSON|JSON Schema|严格按照.{0,12}JSON|JSON 格式返回|(?<!不要)(?<!禁止)(?<!不得)(?:请|必须|严格|直接)?\s*只?返回[^\n。]{0,160}JSON(?:\s*(?:数组|对象|格式|数据))?|(?:^|\n)\s*返回[^\n。]{0,160}JSON|responseMimeType/iu.test(existingContractText);
  if (hasLanguageContract) langInstruction = "";
  const outputProfile = resolveTextOutputProfile({ provider: channel.type, modelId: model.modelId,
    endpoint: channel.baseUrl || (channel.type === 'gemini' ? 'https://generativelanguage.googleapis.com'
      : channel.type === 'openai' ? 'https://api.openai.com/v1' : 'https://configured-provider.invalid'), mode: model.textOutputMode });
  const outputMode = jsonTransportMode(outputProfile.mode, normalizedSchema);
  const nativeJsonFormatContract = Boolean(options.requireJson && outputMode !== 'prompt-json');
  const nativeJsonSchemaContract = Boolean(options.requireJson && normalizedSchema && outputMode === 'json-schema');
  const jsonContract = options.requireJson
    ? [
        !nativeJsonFormatContract && !hasJsonContract
          ? "【输出合同】只能返回合法 JSON，不要 Markdown 或解释文字。"
          : "",
        normalizedSchema && !nativeJsonSchemaContract
          ? `JSON Schema：\n${JSON.stringify(normalizedSchema, null, 2)}`
          : "",
      ].filter(Boolean).join("\n")
    : "";
  const systemComposition = composePromptBlocks([
    {
      blockId: "text.system",
      source: "generateAIContent.systemInstruction",
      purpose: "系统角色与边界",
      content: options.systemInstruction,
      required: false,
    },
    {
      blockId: "text.language",
      source: "generateAIContent.languagePolicy",
      purpose: "本次任务唯一语言合同",
      content: langInstruction,
      required: false,
      ...(hasLanguageContract ? { omissionReason: "already_declared_by_business_prompt" } : {}),
    },
    {
      blockId: "text.output_contract",
      source: "generateAIContent.structuredOutput",
      purpose: "本次任务唯一 JSON 输出合同",
      content: jsonContract,
      required: false,
      ...(options.requireJson && !jsonContract ? {
        omissionReason: nativeJsonFormatContract || nativeJsonSchemaContract
          ? "provider_native_structured_output"
          : "already_declared_by_business_prompt",
      } : {}),
    },
  ]);
  const rawUserPromptBlocks = options.promptBlocks?.length
    ? options.promptBlocks
    : promptBlocksFromText({ prompt: options.prompt });
  const userComposition = composePromptBlocks(markPromptBlocksDuplicatedByManifest(
    rawUserPromptBlocks,
    systemComposition.manifest,
  ));
  if (userComposition.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK")) {
    throw new Error("AI 文本请求缺少必需的任务提示词，已在发送前阻断。");
  }
  const finalPrompt = userComposition.prompt;
  const finalSystemInstruction = systemComposition.prompt;
  const combinedPromptText = [finalSystemInstruction, finalPrompt].filter(Boolean).join("\n\n");
  const compositionManifest: PromptCompositionManifest = {
    version: "prompt-composition/v1",
    blocks: [...systemComposition.manifest.blocks, ...userComposition.manifest.blocks],
    finalCharCount: Array.from(combinedPromptText).length,
    finalHash: promptContentHash(combinedPromptText),
    issues: [...systemComposition.manifest.issues, ...userComposition.manifest.issues],
  };
  const publishCompositionAudit = (
    audit: TextPromptCompositionAudit,
    phase: "initial" | "structured_output_fallback",
  ) => {
    options.onPromptComposed?.(audit);
    usePromptCompositionAuditStore.getState().record({
      phase,
      taskType,
      channelType: channel.type,
      modelId: model.modelId,
      manifest: audit.manifest,
    });
    if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
      globalThis.dispatchEvent(new CustomEvent(PROMPT_COMPOSITION_AUDIT_EVENT, {
        detail: { taskType, phase, ...audit },
      }));
    }
  };
  publishCompositionAudit({ prompt: finalPrompt, systemInstruction: finalSystemInstruction, manifest: compositionManifest }, "initial");

  let apiKey = resolveClientApiKey(model, channel);

  // Remove "Bearer " prefix if user accidentally included it
  if (apiKey.startsWith('Bearer ')) {
    apiKey = apiKey.substring(7);
  }
  await ensureServerEnvKeyAvailable(model, channel, '文本生成');

  if (isOpenAICompatibleTextChannelType(channel.type)) {
    const baseUrl = channel.type === 'kie'
      ? resolveKieOpenAICompatibleTextBaseUrl(channel.baseUrl, model.modelId)
      : channel.baseUrl || (
      channel.type === 'deepseek' ? "https://api.deepseek.com" :
      channel.type === 'doubao' ? "https://ark.cn-beijing.volces.com/api/v3" :
      "https://api.openai.com/v1"
    );

    const messages: any[] = [];
    if (finalSystemInstruction) {
      messages.push({ role: "system", content: finalSystemInstruction });
    }
    const mediaItems = [options.mediaData, ...(options.mediaDataList || [])].filter(Boolean) as Array<{ base64: string; mimeType: string }>;
    messages.push({
      role: "user",
      content: mediaItems.length
        ? [
            { type: "text", text: finalPrompt },
            ...mediaItems.map((item) => ({
              type: "image_url",
              image_url: { url: `data:${item.mimeType};base64,${item.base64}` },
            })),
          ]
        : finalPrompt,
    });

    const completionParams: any = {
      messages,
      model: model.modelId,
      ...(channel.type !== 'kie' ? openAICompatibleReasoningParams(model) : {}),
    };
    if (channel.type === 'kie') {
      delete completionParams.model;
      completionParams.stream = true;
    }
    if (nativeJsonFormatContract) {
      completionParams.response_format = nativeJsonSchemaContract
        ? { type: "json_schema", json_schema: { name: "generated_response", strict: true, schema: normalizedSchema } }
        : { type: "json_object" };
      if (nativeJsonSchemaContract) completionParams.stream = true;
    }

    const createCompletion = async (body: any) => {
      const response = await fetch('/api/proxy/openai-compatible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: channel.type,
          baseUrl,
          channelId: channel.id,
          apiKey,
          body,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI-compatible proxy error (${response.status}): ${redactProviderText(text)}`);
      }

      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`OpenAI-compatible proxy returned invalid JSON: ${redactProviderText(err)}`);
      }
    };

    const completionText = (value: any) => {
      const messageContent = value?.choices?.[0]?.message?.content;
      if (typeof messageContent === 'string') return messageContent;
      if (Array.isArray(messageContent)) {
        return messageContent.map((part: any) => {
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.text?.value === 'string') return part.text.value;
          return '';
        }).join('');
      }
      return value?.candidates?.[0]?.content?.parts
        ?.map((part: any) => typeof part?.text === 'string' ? part.text : '')
        .join('') || '';
    };

    const completion = await createCompletion(completionParams);
    assertProviderCompletion(completion);
    return acceptText(completionText(completion));
  } else if (channel.type === 'gemini') {
    const genConfig: any = { httpOptions: { retryOptions: { attempts: 1 } } };
    if (finalSystemInstruction) {
      genConfig.systemInstruction = finalSystemInstruction;
    }
    if (nativeJsonFormatContract) genConfig.responseMimeType = "application/json";
    
    // Construct contents
    let contents: any = finalPrompt;
    const mediaItems = [options.mediaData, ...(options.mediaDataList || [])].filter(Boolean) as Array<{ base64: string; mimeType: string }>;
    if (mediaItems.length) {
      contents = [
        ...mediaItems.map((item) => item.base64 ? { inlineData: { data: item.base64, mimeType: item.mimeType } } : null),
        { text: finalPrompt }
      ].filter(Boolean);
    }

    const response = await callGeminiProxy('generateContent', {
      model: model.modelId, contents, config: genConfig,
    }, apiKey, channel.id);
    assertProviderCompletion(response);
    return acceptText(response.text || response.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text || '').join('') || '');
  } else if (channel.type === 'minimax') {
    const minimaxBaseUrl = (channel.baseUrl || "https://api.minimaxi.com/anthropic").replace(/\/+$/, "");
    const messagesUrl = minimaxBaseUrl.endsWith("/v1") ? `${minimaxBaseUrl}/messages` : `${minimaxBaseUrl}/v1/messages`;
    const response = await fetch('/api/proxy/minimax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: messagesUrl,
        channelId: channel.id,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: {
          model: model.modelId,
        system: finalSystemInstruction,
          messages: [
            { role: "user", content: finalPrompt }
          ],
        },
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax proxy error (${response.status}): ${redactProviderText(errorText)}`);
    }

    const responseData = await response.json();

    const messageContent = responseData.content || [];
    let text = "";
    for (const part of messageContent) {
      if (part.type === 'text') {
        text = part.text;
        break;
      }
    }

    if (!text && typeof responseData.output_text === 'string') {
      text = responseData.output_text;
    }

    if (!text && typeof responseData.text === 'string') {
      text = responseData.text;
    }

    if (!text) {
      text = "";
    }

    assertProviderCompletion(responseData);
    return acceptText(text);
  } else {
    throw new Error(`Unsupported channel type for text generation: ${channel.type}`);
  }
}
