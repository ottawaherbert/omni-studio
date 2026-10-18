import type {
  AssetUploadRequest,
  AssetUploadResponse,
  ComposeVideoSegmentsRequest,
  ComposeVideoSegmentsResponse,
  ComposeEpisodeFilmRequest,
  ComposeEpisodeFilmResponse,
  RemoteAssetImportRequest,
  RemoteAssetImportResponse,
  RewriteVideoAudioRequest,
  RewriteVideoAudioResponse,
  VideoLastFrameRequest,
  VideoLastFrameResponse,
} from "../../../../packages/domain/src/asset";
import { MAX_ASSET_UPLOAD_BYTES } from "../../../../packages/domain/src/asset";

const parseAssetResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    let message = payload;
    try { const parsed = JSON.parse(payload); if (typeof parsed?.error === "string") message = parsed.error; } catch { /* Non-JSON proxy errors retain their response text. */ }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
};

export const assetClient = {
  uploadFile: async (file: File, projectId?: string) => {
    if (!file.size) throw new Error("文件为空，请重新选择文件。");
    if (file.size > MAX_ASSET_UPLOAD_BYTES) throw new Error("文件超过 100 MiB，请裁剪或压缩后再导入。");
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return fetch(`/api/assets/upload-file${query}`, {
      method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
    }).then((response) => parseAssetResponse<AssetUploadResponse>(response));
  },
  uploadAsset: (body: AssetUploadRequest) =>
    fetch("/api/assets/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<AssetUploadResponse>(response)),
  importRemoteAsset: (body: RemoteAssetImportRequest) =>
    fetch("/api/assets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<RemoteAssetImportResponse>(response)),
  extractVideoLastFrame: (body: VideoLastFrameRequest) =>
    fetch("/api/assets/video-last-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<VideoLastFrameResponse>(response)),
  rewriteVideoAudio: (body: RewriteVideoAudioRequest) =>
    fetch("/api/assets/rewrite-video-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<RewriteVideoAudioResponse>(response)),
  composeVideoSegments: (body: ComposeVideoSegmentsRequest) =>
    fetch("/api/assets/compose-video-segments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<ComposeVideoSegmentsResponse>(response)),
  composeEpisodeFilm: (body: ComposeEpisodeFilmRequest) =>
    fetch("/api/assets/compose-episode-film", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => parseAssetResponse<ComposeEpisodeFilmResponse>(response)),
};
