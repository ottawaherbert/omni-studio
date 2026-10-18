import {
  KIE_GPT_IMAGE_2_ADAPTER_ID,
  KIE_GROK_IMAGE_ADAPTER_ID,
  imageAdapterIdForModelId,
  type AIChannel,
  type AIModel,
} from "../../config/aiConfigDefaults";

export interface ImageModelCapabilities {
  familyLabel: string;
  textToImage: boolean;
  imageToImage: boolean;
  maxReferenceImages: number;
}

export const resolveImageModelCapabilities = ({
  channel,
  model,
}: {
  channel: AIChannel;
  model: AIModel;
}): ImageModelCapabilities => {
  const adapterId = model.imageAdapterId || imageAdapterIdForModelId(model.modelId);
  if (channel.type === "kie" && adapterId === KIE_GPT_IMAGE_2_ADAPTER_ID) {
    return { familyLabel: "GPT Image 2", textToImage: true, imageToImage: true, maxReferenceImages: 16 };
  }
  if (channel.type === "kie" && adapterId === KIE_GROK_IMAGE_ADAPTER_ID) {
    return { familyLabel: "Grok Imagine", textToImage: true, imageToImage: true, maxReferenceImages: 1 };
  }
  if (channel.type === "doubao") {
    return { familyLabel: model.alias, textToImage: true, imageToImage: true, maxReferenceImages: 14 };
  }
  return {
    familyLabel: model.alias,
    textToImage: true,
    imageToImage: false,
    maxReferenceImages: 0,
  };
};

export const assertImageGenerationRequestSupported = ({
  channel,
  model,
  referenceImages,
}: {
  channel: AIChannel;
  model: AIModel;
  referenceImages: string[];
}) => {
  const capabilities = resolveImageModelCapabilities({ channel, model });
  if (!referenceImages.length) {
    if (!capabilities.textToImage) {
      throw new Error(`${capabilities.familyLabel} 不支持文生图，请选择支持文生图的图片模型。`);
    }
    return capabilities;
  }
  if (!capabilities.imageToImage) {
    throw new Error(`${capabilities.familyLabel} 当前没有接入图生图，不能忽略 ${referenceImages.length} 张参考图继续生成。请在“图像生成”路由选择支持图生图的模型。`);
  }
  if (referenceImages.length > capabilities.maxReferenceImages) {
    throw new Error(`${capabilities.familyLabel} 最多接受 ${capabilities.maxReferenceImages} 张参考图，当前选择了 ${referenceImages.length} 张；系统不会静默丢弃素材。`);
  }
  return capabilities;
};

export const imageModelCapabilitySummary = (capabilities: ImageModelCapabilities) => (
  capabilities.imageToImage
    ? `文生图 + 图生图（最多 ${capabilities.maxReferenceImages} 张参考图）`
    : "仅文生图"
);
