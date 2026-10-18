import { assetClient } from "../clients/assetClient";

export const persistProjectMediaUrl = async (value: string, projectId: string) => {
  const imageUrl = value.trim();
  if (!imageUrl) throw new Error("图片生成未返回可保存的结果。");
  if (imageUrl.startsWith("/media/")) return imageUrl;
  if (/^data:image\//i.test(imageUrl)) {
    const response = await assetClient.uploadAsset({ dataUrl: imageUrl, projectId });
    if (!response.url) throw new Error(response.error || "生成图片写入项目媒体库失败。");
    return response.url;
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await assetClient.importRemoteAsset({ sourceUrl: imageUrl, projectId });
    if (!response.url) throw new Error(response.error || "远程生成图片写入项目媒体库失败。");
    return response.url;
  }
  throw new Error("图片生成返回了不受支持的媒体地址。");
};
