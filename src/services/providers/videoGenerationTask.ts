export interface VideoGenerationTask {
  id: string;
  idempotencyKey: string;
  provider: "minimax_h3" | "kie_grok" | "comfyui_h3" | "comfyui";
  providerTaskId?: string;
  status: "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  videoUrl?: string;
  outputs?: Array<{ url: string; kind: "image" | "video" | "audio"; filename: string }>;
  embeddedAudio: boolean;
  requestHash: string;
  audit?: Record<string, unknown>;
  error?: string;
  duplicate?: boolean;
  createdAt: number;
  updatedAt: number;
}
