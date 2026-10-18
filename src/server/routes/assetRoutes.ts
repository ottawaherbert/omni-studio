import crypto from "crypto";
import { lookup } from "node:dns/promises";
import fs from "fs/promises";
import { isIP } from "node:net";
import path from "path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MAX_ASSET_UPLOAD_BYTES } from "../../../packages/domain/src/asset";
import { composeEpisodeFilm } from "../media/episodeFilmComposition";
import { composeVideoSegments, extractLastVideoFrame, inspectUploadedVideo, readLocalMediaSource, readVideoSource } from "../media/videoComposition";
import { registerVideoAudioRoutes } from "./videoAudioRoutes";

export interface AssetRoutesOptions {
  mediaAssetsDir: string;
}
const MAX_REMOTE_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 5;

const extensionForMimeType = (mimeType: string) => {
  if (mimeType.includes("image/png")) return "png";
  if (mimeType.includes("image/jpeg")) return "jpg";
  if (mimeType.includes("image/webp")) return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/avif") return "avif";
  if (mimeType.includes("audio/mpeg")) return "mp3";
  if (mimeType.includes("audio/wav")) return "wav";
  if (mimeType.includes("audio/mp4") || mimeType.includes("audio/x-m4a")) return "m4a";
  if (mimeType.includes("subrip") || mimeType.includes("text/plain")) return "srt";
  if (mimeType.includes("video/mp4")) return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/x-matroska") return "mkv";
  if (mimeType === "video/x-msvideo") return "avi";
  if (mimeType === "video/mpeg") return "mpeg";
  return "bin";
};

const normalizedProjectId = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new Error("Invalid projectId");
  }
  return normalized;
};

const isPrivateIpAddress = (address: string) => {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedIpv4 ? isPrivateIpAddress(mappedIpv4) : false;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
};

const isSyntheticProxyIpAddress = (address: string) => {
  const [a, b] = address.split(".").map(Number);
  return a === 198 && (b === 18 || b === 19);
};

export const assertPublicRemoteUrl = async (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Remote asset URL must use public HTTP(S)");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Remote asset URL cannot target a local address");
  }
  const literalIp = Boolean(isIP(hostname));
  const addresses = literalIp
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  const resolvesPrivately = addresses.some((item) =>
    isPrivateIpAddress(item.address) || (literalIp && isSyntheticProxyIpAddress(item.address))
  );
  if (!addresses.length || resolvesPrivately) {
    throw new Error("Remote asset URL resolved to a private address");
  }
  return url;
};

const fetchRemoteImage = async (sourceUrl: string) => {
  let currentUrl = await assertPublicRemoteUrl(sourceUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REMOTE_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REMOTE_REDIRECTS) throw new Error("Remote asset redirected too many times");
      currentUrl = await assertPublicRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Remote asset download failed (${response.status})`);
    const mimeType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    if (!mimeType.startsWith("image/") || extensionForMimeType(mimeType) === "bin") {
      throw new Error("Remote asset is not a supported image");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_REMOTE_ASSET_BYTES) throw new Error("Remote asset exceeds 20 MiB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_REMOTE_ASSET_BYTES) throw new Error("Remote asset is empty or exceeds 20 MiB");
    return { buffer, mimeType };
  }
  throw new Error("Remote asset download failed");
};

const saveMediaBuffer = async ({
  mediaAssetsDir,
  projectId,
  mimeType,
  buffer,
}: {
  mediaAssetsDir: string;
  projectId?: string;
  mimeType: string;
  buffer: Buffer;
}) => {
  const dirPath = projectId ? path.join(mediaAssetsDir, projectId) : mediaAssetsDir;
  await fs.mkdir(dirPath, { recursive: true });
  const filename = `asset_${crypto.createHash("md5").update(buffer).digest("hex")}.${extensionForMimeType(mimeType)}`;
  const filePath = path.join(dirPath, filename);
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, buffer);
  }
  return projectId ? `/media/${projectId}/${filename}` : `/media/${filename}`;
};

export const registerAssetRoutes = (app: Express, { mediaAssetsDir }: AssetRoutesOptions) => {
  app.use("/media", express.static(mediaAssetsDir));
  registerVideoAudioRoutes(app, { mediaAssetsDir, normalizedProjectId, assertPublicRemoteUrl, saveVideo: (projectId, buffer) => saveMediaBuffer({ mediaAssetsDir, projectId, mimeType: "video/mp4", buffer }) });

  app.post("/api/assets/upload-file", express.raw({ type: () => true, limit: MAX_ASSET_UPLOAD_BYTES }), async (req, res) => {
    let projectId: string | undefined;
    try { projectId = normalizedProjectId(req.query.projectId); }
    catch { return res.status(400).json({ error: "项目标识无效，请重新打开作品后导入。" }); }
    const mimeType = (req.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (extensionForMimeType(mimeType) === "bin") return res.status(415).json({ error: "不支持此文件格式，请选择常见图片、视频或音频文件。" });
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(400).json({ error: "文件为空或未完整上传，请重新选择文件。" });
    let videoMetadata;
    if (mimeType.startsWith("video/")) {
      try { videoMetadata = await inspectUploadedVideo(buffer); }
      catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return res.status(503).json({ error: "服务器缺少视频检查工具 ffprobe，请安装后重试；原文件没有修改。" });
        return res.status(422).json({ error: "无法读取这个视频，请检查文件是否完整，并使用 MP4、MOV 或 WebM 等常见视频格式。" });
      }
    }
    try {
      const url = await saveMediaBuffer({ mediaAssetsDir, projectId, mimeType, buffer });
      return res.json({ url, videoMetadata });
    } catch (error) {
      console.error("File upload storage error:", error);
      return res.status(500).json({ error: "文件保存失败，请检查磁盘空间和项目目录权限后重试。" });
    }
  }, (error: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (error.type === "entity.too.large") return res.status(413).json({ error: "文件超过 100 MiB，请裁剪或压缩后再导入。" });
    next(error);
  });

  app.post("/api/assets/upload", async (req, res) => {
    try {
      const { dataUrl, projectId } = req.body;
      if (!dataUrl) return res.status(400).json({ error: "Missing dataUrl" });
      if (dataUrl.startsWith("/media/") || dataUrl.startsWith("http")) return res.json({ url: dataUrl });

      const matches = dataUrl.match(/^data:([A-Za-z0-9+.\/-]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return res.status(400).json({ error: "Invalid base64 format" });

      const mimeType = matches[1].split(";", 1)[0].trim().toLowerCase();
      if (extensionForMimeType(mimeType) === "bin") {
        return res.status(415).json({ error: "不支持此素材格式。图片请先转换为 PNG、JPEG 或 WebP 后再导入。" });
      }
      const buffer = Buffer.from(matches[2], "base64");
      const relativeUrl = await saveMediaBuffer({
        mediaAssetsDir,
        projectId: normalizedProjectId(projectId),
        mimeType,
        buffer,
      });
      return res.json({ url: relativeUrl });
    } catch (err: any) {
      console.error("Asset upload error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/assets/import", async (req, res) => {
    try {
      const sourceUrl = typeof req.body?.sourceUrl === "string" ? req.body.sourceUrl.trim() : "";
      if (!sourceUrl) return res.status(400).json({ error: "Missing sourceUrl" });
      const remote = await fetchRemoteImage(sourceUrl);
      const url = await saveMediaBuffer({
        mediaAssetsDir,
        projectId: normalizedProjectId(req.body?.projectId),
        mimeType: remote.mimeType,
        buffer: remote.buffer,
      });
      return res.json({ url });
    } catch (err: any) {
      console.error("Remote asset import error:", err);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/assets/video-last-frame", async (req, res) => {
    try {
      const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
      if (!videoUrl) return res.status(400).json({ error: "Missing videoUrl" });
      const projectId = normalizedProjectId(req.body?.projectId);
      const video = await readVideoSource({ sourceUrl: videoUrl, mediaAssetsDir, assertPublicRemoteUrl });
      const frame = await extractLastVideoFrame(video);
      const url = await saveMediaBuffer({ mediaAssetsDir, projectId, mimeType: "image/jpeg", buffer: frame });
      return res.json({ url });
    } catch (err: any) {
      console.error("Video last-frame extraction error:", err);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/assets/compose-video-segments", async (req, res) => {
    try {
      const videoUrls = Array.isArray(req.body?.videoUrls)
        ? req.body.videoUrls.map((value: unknown) => typeof value === "string" ? value.trim() : "").filter(Boolean)
        : [];
      if (videoUrls.length < 2 || videoUrls.length > 10) {
        return res.status(400).json({ error: "videoUrls must contain 2-10 segments" });
      }
      const projectId = normalizedProjectId(req.body?.projectId);
      const aspectRatio = req.body?.aspectRatio === "9:16" ? "9:16" : "16:9";
      const buffers = await Promise.all(videoUrls.map((url: string) => readVideoSource({ sourceUrl: url, mediaAssetsDir, assertPublicRemoteUrl })));
      const output = await composeVideoSegments(buffers, aspectRatio);
      const url = await saveMediaBuffer({ mediaAssetsDir, projectId, mimeType: "video/mp4", buffer: output });
      return res.json({ url });
    } catch (err: any) {
      console.error("Video segment composition error:", err);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/assets/compose-episode-film", async (req, res) => {
    try {
      const shots = Array.isArray(req.body?.shots) ? req.body.shots : [];
      if (!shots.length || shots.length > 200) return res.status(400).json({ error: "shots must contain 1-200 items" });
      const validatedShots = shots.map((shot: unknown) => {
        const record = shot && typeof shot === "object" ? shot as Record<string, unknown> : {};
        const videoUrl = typeof record.videoUrl === "string" ? record.videoUrl.trim() : "";
        const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
        const durationSeconds = Number(record.durationSeconds);
        if ((!videoUrl && !imageUrl) || (videoUrl && imageUrl) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 600) {
          throw new Error("Each film shot needs exactly one videoUrl or imageUrl and a duration greater than 0 and no more than 600 seconds");
        }
        const sourceStartSeconds = Number(record.sourceStartSeconds ?? 0);
        const transition = record.transition ?? "none";
        if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds < 0 || sourceStartSeconds > 120_000) throw new Error("素材入点无效。");
        if (!["none", "fade", "black"].includes(String(transition))) throw new Error("转场类型无效。");
        return { videoUrl, imageUrl, durationSeconds, sourceStartSeconds, transition: transition as "none" | "fade" | "black" };

      });
      const projectId = normalizedProjectId(req.body?.projectId);
      const aspectRatio = req.body?.aspectRatio === "9:16" ? "9:16" : "16:9";
      const shotBuffers = [];
      for (const shot of validatedShots) {
        shotBuffers.push({
          media: shot.videoUrl
            ? await readVideoSource({ sourceUrl: shot.videoUrl, mediaAssetsDir, assertPublicRemoteUrl })
            : await readVideoSource({ sourceUrl: shot.imageUrl, mediaAssetsDir, assertPublicRemoteUrl, maximumBytes: 25 * 1024 * 1024, accept: "image/*" }),
          kind: shot.videoUrl ? "video" as const : "image" as const,
          durationSeconds: shot.durationSeconds,
          sourceStartSeconds: shot.sourceStartSeconds,
          transition: shot.transition,
        });
      }
      const masterAudioUrl = typeof req.body?.masterAudioUrl === "string" ? req.body.masterAudioUrl.trim() : "";
      const subtitleUrl = typeof req.body?.subtitleUrl === "string" ? req.body.subtitleUrl.trim() : "";
      const rawAudioTracks = req.body?.audioTracks ?? [];
      if (!Array.isArray(rawAudioTracks) || rawAudioTracks.length > 500) throw new Error("音轨列表最多包含 500 项。");
      const audioTracks = [];
      for (const track of rawAudioTracks) {
        if (!track || typeof track.url !== "string" || !track.url.trim()
          || ![track.startTime, track.duration, track.volume ?? 1, track.sourceStartSeconds ?? 0].every(Number.isFinite)
          || (track.sourceStartSeconds ?? 0) < 0 || (track.sourceStartSeconds ?? 0) > 120_000 || track.startTime < 0 || track.startTime > 120_000 || track.duration <= 0 || track.duration > 120_000
          || (track.volume ?? 1) < 0 || (track.volume ?? 1) > 1) throw new Error("音轨地址、时间或音量无效。");
        audioTracks.push({
          media: await readVideoSource({ sourceUrl: track.url, mediaAssetsDir, assertPublicRemoteUrl, maximumBytes: 250 * 1024 * 1024, accept: "audio/*" }),
          startTime: track.startTime,
          duration: track.duration,
          volume: track.volume ?? 1,
          sourceStartSeconds: track.sourceStartSeconds ?? 0,
        });
      }
      const output = await composeEpisodeFilm({
        shots: shotBuffers,
        resolution: req.body?.resolution ?? 480,
        frameRate: req.body?.frameRate ?? 24,
        aspectRatio,
        audioTracks,
        masterAudio: masterAudioUrl ? await readLocalMediaSource({ sourceUrl: masterAudioUrl, mediaAssetsDir, maximumBytes: 250 * 1024 * 1024 }) : undefined,
        subtitles: subtitleUrl ? await readLocalMediaSource({ sourceUrl: subtitleUrl, mediaAssetsDir, maximumBytes: 5 * 1024 * 1024 }) : undefined,
      });
      const url = await saveMediaBuffer({ mediaAssetsDir, projectId, mimeType: "video/mp4", buffer: output });
      return res.json({ url });
    } catch (err: any) {
      console.error("Episode film composition error:", err);
      return res.status(400).json({ error: err.message });
    }
  });
};
