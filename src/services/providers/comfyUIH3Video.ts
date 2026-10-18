import type { AIChannel, AIModel } from "../../config/aiConfigDefaults";
import type { MiniMaxH3VideoRequest } from "../production/minimaxH3Adapter";
import type { VideoGenerationIntent, VideoReferenceBinding } from "../production/videoGenerationIntent";
import type { VideoGenerationTask } from "./videoGenerationTask";

const unsupportedLocalH3ReferenceTypes = new Set([
  "motion_reference_video",
  "editing_reference_video",
  "voice_reference_audio",
  "final_dialogue_audio",
  "start_frame",
  "end_frame",
]);

const strongestPreservation = (
  left: VideoReferenceBinding["preservation"],
  right: VideoReferenceBinding["preservation"],
) => {
  const rank = { flexible: 0, strong: 1, required: 2 } as const;
  return rank[right] > rank[left] ? right : left;
};

const identifiedDescription = (binding: VideoReferenceBinding) => {
  const description = binding.description?.trim();
  const name = binding.displayName?.trim();
  if (!description || !name || description.includes(name)) return description;
  return `${name}：${description}`;
};

const deduplicateLocalH3Images = (bindings: VideoReferenceBinding[]) => {
  const byUrl = new Map<string, VideoReferenceBinding>();
  for (const binding of bindings) {
    const key = binding.mediaUrl.trim();
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...binding, mediaUrl: key, description: identifiedDescription(binding) });
      continue;
    }
    const displayNames = Array.from(new Set([existing.displayName, binding.displayName].filter(Boolean)));
    const descriptions = Array.from(new Set([
      existing.description,
      identifiedDescription(binding),
    ].filter(Boolean)));
    byUrl.set(key, {
      ...existing,
      semanticEntityId: existing.semanticEntityId === binding.semanticEntityId
        ? existing.semanticEntityId
        : undefined,
      displayName: displayNames.join("、") || existing.displayName,
      description: descriptions.join("；") || existing.description || binding.description,
      required: existing.required || binding.required,
      priority: Math.max(existing.priority, binding.priority),
      preservation: strongestPreservation(existing.preservation, binding.preservation),
    });
  }
  return [...byUrl.values()];
};

export const prepareComfyUIH3Intent = (intent: VideoGenerationIntent): VideoGenerationIntent => {
  const unsupported = intent.referenceBindings.filter((binding) => (
    unsupportedLocalH3ReferenceTypes.has(binding.sourceType)
  ));
  if (unsupported.length) {
    throw new Error(`当前本地 H3 工作流不支持所选的${unsupported.map((binding) => binding.displayName || binding.sourceType).join("、")}，请改用参考图或切换视频模型。`);
  }
  return {
    ...intent,
    referenceBindings: deduplicateLocalH3Images(intent.referenceBindings),
    audioPolicy: { mode: "provider_native" },
  };
};

export type ComfyUIH3VideoTask = VideoGenerationTask & {
  provider: "comfyui_h3";
  embeddedAudio: true;
};

const taskResponse = async (response: Response) => {
  const data = await response.json().catch(() => ({})) as { task?: ComfyUIH3VideoTask; error?: string };
  if (!data.task) throw new Error(data.error || "本地 H3 接口没有返回任务记录。");
  return data.task;
};

export const submitComfyUIH3VideoTask = async ({
  channel,
  model,
  request,
  idempotencyKey,
  audit,
}: {
  channel: AIChannel;
  model: AIModel;
  request: MiniMaxH3VideoRequest;
  idempotencyKey: string;
  audit?: Record<string, unknown>;
}) => taskResponse(await fetch("/api/proxy/comfyui-h3-video/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channelId: channel.id, modelConfigId: model.id, request, idempotencyKey, audit }),
}));

export const queryComfyUIH3VideoTask = async (taskId: string) => (
  taskResponse(await fetch(`/api/proxy/comfyui-h3-video/tasks/${encodeURIComponent(taskId)}`))
);
