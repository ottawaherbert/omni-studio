export interface AssetUploadRequest {
  dataUrl: string;
  projectId?: string;
}

export interface AssetUploadResponse {
  url?: string;
  error?: string;
  videoMetadata?: UploadedVideoMetadata;
}

export const MAX_ASSET_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadedVideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface RemoteAssetImportRequest {
  sourceUrl: string;
  projectId?: string;
}

export type RemoteAssetImportResponse = AssetUploadResponse;

export interface VideoLastFrameRequest {
  videoUrl: string;
  projectId?: string;
}

export type VideoLastFrameResponse = AssetUploadResponse;

export interface RewriteVideoAudioRequest {
  videoUrl: string;
  projectId?: string;
  mode: "strip" | "replace";
  replacementAudioUrl?: string;
}

export type RewriteVideoAudioResponse = AssetUploadResponse;

export interface ComposeVideoSegmentsRequest {
  videoUrls: string[];
  projectId?: string;
  aspectRatio?: "16:9" | "9:16";
}

export type ComposeVideoSegmentsResponse = AssetUploadResponse;

export interface EpisodeFilmShotInput {
  sourceStartSeconds?: number;
  transition?: "none" | "fade" | "black";
  videoUrl?: string;
  imageUrl?: string;
  durationSeconds: number;
}

export interface ComposeEpisodeFilmRequest {
  shots: EpisodeFilmShotInput[];
  resolution?: 480 | 720 | 1080 | 2160;
  frameRate?: 24 | 25 | 30 | 60;
  projectId?: string;
  aspectRatio?: "16:9" | "9:16";
  masterAudioUrl?: string;
  subtitleUrl?: string;
  audioTracks?: EpisodeFilmAudioInput[];
}

export interface EpisodeFilmAudioInput {
  sourceStartSeconds?: number;
  url: string;
  startTime: number;
  duration: number;
  volume?: number;
}

export type ComposeEpisodeFilmResponse = AssetUploadResponse;
