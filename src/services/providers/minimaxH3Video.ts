import type { AIChannel, AIModel } from "../../config/aiConfigDefaults";
import type { MiniMaxH3VideoRequest } from "../production/minimaxH3Adapter";
import type { VideoGenerationTask } from "./videoGenerationTask";

export type MiniMaxH3VideoTask = VideoGenerationTask & {
  provider: "minimax_h3";
  embeddedAudio: true;
};

const taskResponse = async (response: Response) => {
  const data = await response.json().catch(() => ({})) as { task?: MiniMaxH3VideoTask; error?: string };
  if (!data.task) throw new Error("MiniMax H3 视频接口没有返回本地任务记录。");
  return data.task;
};

export const submitMiniMaxH3VideoTask = async ({
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
}) => taskResponse(await fetch("/api/proxy/minimax-h3-video/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channelId: channel.id, modelConfigId: model.id, request, idempotencyKey, audit }),
}));

export const queryMiniMaxH3VideoTask = async (taskId: string) =>
  taskResponse(await fetch(`/api/proxy/minimax-h3-video/tasks/${encodeURIComponent(taskId)}`));
