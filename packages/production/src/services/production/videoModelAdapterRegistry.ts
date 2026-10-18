import {
  GENERIC_I2V_ADAPTER_ID,
  GENERIC_VIDEO_ADAPTERS,
} from "./adapters/genericVideoAdapter";
import type { VideoModelAdapterDefinition } from "./videoModelAdapter";
import {
  MINIMAX_H3_REF2VA_ADAPTER_ID,
  MINIMAX_H3_VIDEO_ADAPTERS,
} from "./adapters/minimaxH3Adapter";

export const VIDEO_MODEL_ADAPTERS: VideoModelAdapterDefinition[] = [
  ...MINIMAX_H3_VIDEO_ADAPTERS,
  ...GENERIC_VIDEO_ADAPTERS,
];

export const getVideoModelAdapterById = (adapterId: string) =>
  VIDEO_MODEL_ADAPTERS.find((adapter) => adapter.id === adapterId);

const adapterMatchesModel = (
  adapter: VideoModelAdapterDefinition,
  channelType: string,
  modelId: string,
  selectable = false,
) => (selectable ? adapter.selectableMatches || adapter.matches : adapter.matches).some((match) =>
  (!match.channelType || match.channelType === channelType) && match.modelIdPattern.test(modelId)
);

const adapterForChannel = (
  adapter: VideoModelAdapterDefinition,
  channelType: string,
): VideoModelAdapterDefinition => {
  if (channelType !== "comfyui" || adapter.id !== MINIMAX_H3_REF2VA_ADAPTER_ID) return adapter;
  return {
    ...adapter,
    displayName: "MiniMax H3 本地工作流参考图",
    limits: {
      ...adapter.limits,
      maxReferenceVideos: 0,
      maxReferenceAudios: 0,
    },
    capabilities: {
      ...adapter.capabilities,
      referenceVideos: false,
      referenceAudios: false,
      dialogueVoiceReference: false,
    },
  };
};

export const listCompatibleVideoModelAdapters = ({
  channelType,
  modelId,
}: {
  channelType: string;
  modelId: string;
}) => VIDEO_MODEL_ADAPTERS
  .filter((adapter) => adapterMatchesModel(adapter, channelType, modelId, true))
  .map((adapter) => adapterForChannel(adapter, channelType));

export const resolveVideoModelAdapter = ({
  channelType,
  modelId,
  configuredAdapterId,
}: {
  channelType: string;
  modelId: string;
  configuredAdapterId?: string;
}): VideoModelAdapterDefinition => {
  const configured = configuredAdapterId && configuredAdapterId !== "auto"
    ? getVideoModelAdapterById(configuredAdapterId)
    : undefined;
  if (configured) return adapterForChannel(configured, channelType);
  const resolved = VIDEO_MODEL_ADAPTERS.find((adapter) => adapterMatchesModel(adapter, channelType, modelId))
    || getVideoModelAdapterById(GENERIC_I2V_ADAPTER_ID)!;
  return adapterForChannel(resolved, channelType);
};
