export interface OperatorRegisteredAsset {
  id: string;
  projectId: string;
  runId?: string;
  artifactId?: string;
  kind: "image" | "audio" | "video" | "document" | "audit";
  mediaUrl?: string;
  localPath?: string;
  prompt?: string;
  targetEntity?: {
    type: "project" | "character" | "asset" | "episode" | "scene" | "shot";
    id?: string;
    episodeId?: string;
    sceneId?: string;
    field?: string;
  };
  qaStatus?: "passed" | "warning" | "failed";
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
