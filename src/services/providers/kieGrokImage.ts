import {
  KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  isKieGptImage2ModelId,
  isKieGrokImageModelId,
  type AIChannel,
  type AIModel,
} from "../../config/aiConfigDefaults";

export type KieImageAspectRatio = "2:3" | "3:2" | "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

export interface GenerateKieGrokImageOptions {
  prompt: string;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  referenceImages?: string[];
}

export interface KieImageProxyRequest {
  model:
    | typeof KIE_GROK_TEXT_TO_IMAGE_MODEL_ID
    | typeof KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID
    | typeof KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID
    | typeof KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID;
  prompt: string;
  aspectRatio?: KieImageAspectRatio;
  resolution?: "1K" | "2K" | "4K";
  imageUrl?: string;
  imageUrls?: string[];
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const isLocalHttpUrl = (value: string) => {
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname); } catch { return false; }
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图转换失败。"));
  reader.onerror = () => reject(reader.error || new Error("参考图读取失败。"));
  reader.readAsDataURL(blob);
});

const resolveReferenceImage = async (imageUrl: string) => {
  const trimmed = imageUrl.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (isHttpUrl(trimmed) && !isLocalHttpUrl(trimmed)) return trimmed;
  const response = await fetch(trimmed);
  if (!response.ok) throw new Error(`无法读取 Kie 图片参考图 (${response.status})。`);
  return blobToDataUrl(await response.blob());
};

const grokAspectRatioMap: Record<NonNullable<GenerateKieGrokImageOptions["aspectRatio"]>, KieImageAspectRatio> = {
  "1:1": "1:1",
  "3:4": "2:3",
  "4:3": "3:2",
  "9:16": "9:16",
  "16:9": "16:9",
};

export const buildKieGrokImageRequest = (
  model: AIModel,
  options: GenerateKieGrokImageOptions,
): KieImageProxyRequest => {
  const gptImage2 = isKieGptImage2ModelId(model.modelId);
  if (!gptImage2 && !isKieGrokImageModelId(model.modelId)) {
    throw new Error(`Kie 图片适配器不支持模型 ID：${model.modelId || "（空）"}。`);
  }
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("Kie 图片生成提示词不能为空。");
  const references = (options.referenceImages || []).filter((item) => item.trim());
  if (gptImage2) {
    if (references.length > 16) {
      throw new Error("Kie GPT Image 2 图生图最多接受 16 张参考图。");
    }
    const resolution = model.kieGptImage2?.resolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution;
    const aspectRatio = options.aspectRatio || "16:9";
    return references.length > 0
      ? {
          model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
          prompt,
          aspectRatio,
          resolution,
          imageUrls: references.map((item) => item.trim()),
        }
      : {
          model: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
          prompt,
          aspectRatio,
          resolution,
        };
  }
  if (references.length > 1) {
    throw new Error("Kie Grok 图生图目前只接受 1 张参考图；请先合并角色、场景参考板后再生成。");
  }
  if (references.length === 1) {
    return {
      model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
      prompt,
      imageUrl: references[0].trim(),
    };
  }
  return {
    model: KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
    prompt,
    aspectRatio: grokAspectRatioMap[options.aspectRatio || "16:9"],
  };
};

const safeErrorMessage = (value: unknown) => {
  if (!value || typeof value !== "object") return "Kie Grok 图片生成失败。";
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error.slice(0, 500) : "Kie Grok 图片生成失败。";
};

export const generateKieGrokImage = async ({
  channel,
  model,
  options,
}: {
  channel: AIChannel;
  model: AIModel;
  options: GenerateKieGrokImageOptions;
}) => {
  const request = buildKieGrokImageRequest(model, options);
  if (request.imageUrl) request.imageUrl = await resolveReferenceImage(request.imageUrl);
  if (request.imageUrls) request.imageUrls = await Promise.all(request.imageUrls.map(resolveReferenceImage));
  const response = await fetch("/api/proxy/kie-grok-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId: channel.id, modelConfigId: model.id, request }),
  });
  const data = await response.json().catch(() => ({})) as { imageUrl?: string; error?: string };
  if (!response.ok) {
    throw Object.assign(new Error(`Kie 图片请求失败 (${response.status})：${safeErrorMessage(data)}`), { retryable: false });
  }
  if (!data.imageUrl) throw new Error("Kie 图片模型没有返回可用图片。");
  return data.imageUrl;
};
