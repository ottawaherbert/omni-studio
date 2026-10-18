export interface ImageMediaData {
  base64: string;
  mimeType: string;
}

export interface ImageTechnicalMetadata {
  width: number;
  height: number;
  aspectRatio: number;
}

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("图片读取失败。"));
  reader.readAsDataURL(blob);
});

const parseDataUrl = (value: string): ImageMediaData => {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:image/") || comma < 0) throw new Error("图片数据格式无效。");
  const metadata = value.slice(5, comma);
  const mimeType = metadata.split(";")[0] || "image/jpeg";
  return { mimeType, base64: value.slice(comma + 1) };
};

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("故事板画格无法读取。"));
  image.src = url;
});

export const inspectImageTechnicalMetadata = async (url: string): Promise<ImageTechnicalMetadata> => {
  const image = await loadImage(url);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("故事板画格尺寸无效。");
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    aspectRatio: image.naturalWidth / image.naturalHeight,
  };
};

export const imageUrlToMediaData = async (
  url: string,
  maxSize = 768,
  quality = 0.72,
): Promise<ImageMediaData> => {
  if (url.startsWith("data:image/") && url.length < 1_800_000) return parseDataUrl(url);

  try {
    const image = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片质检画布。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return parseDataUrl(canvas.toDataURL("image/jpeg", quality));
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`图片读取失败（${response.status}）。`);
    return parseDataUrl(await readAsDataUrl(await response.blob()));
  }
};
