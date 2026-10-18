export interface VideoGenerationTask {
  id: string;
  idempotencyKey: string;
  provider: "minimax_h3" | "kie_grok" | "comfyui_h3";
  providerTaskId?: string;
  status: "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  videoUrl?: string;
  embeddedAudio: boolean;
  requestHash: string;
  audit?: Record<string, unknown>;
  error?: string;
  duplicate?: boolean;
  createdAt: number;
  updatedAt: number;
}
