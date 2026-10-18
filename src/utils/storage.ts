import localforage from 'localforage';
import { assetClient } from '../clients/assetClient';
import { rebaseStoryboardGridMediaSources } from '../clients/productionStoryboardWorkflowClient';

export const assetStore = localforage.createInstance({
  name: 'OMNI_Studio',
  storeName: 'assets' // Retained only for global cache if needed, but not used for media locally
});

export const persistMediaBlob = async (blob: Blob, projectId?: string): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取生成的媒体文件"));
    reader.readAsDataURL(blob);
  });
  const result = await assetClient.uploadAsset({ dataUrl, projectId });
  if (!result.url) throw new Error(result.error || "素材保存失败，请重试");
  return result.url;
};

export const normalizeMediaDataUrlForUpload = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^data:(?:image|video|audio)\//i.test(value)) return null;
  if (/^data:[^,]+;base64,/i.test(value)) return value;
  const match = /^data:([^;,]+)(?:;[^,]*)?,([\s\S]*)$/i.exec(value);
  if (!match) return null;
  try {
    const bytes = new TextEncoder().encode(decodeURIComponent(match[2]));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${match[1]};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
};

export const extractAndSaveAssets = async (obj: any, projectId?: string): Promise<any> => {
  if (!obj) return obj;
  if (typeof obj === 'string' && obj.startsWith('blob:')) {
    const response = await fetch(obj);
    if (!response.ok) throw new Error("临时素材已失效，请重新导入");
    return persistMediaBlob(await response.blob(), projectId);
  }
  
  const mediaDataUrl = normalizeMediaDataUrlForUpload(obj);
  if (mediaDataUrl) {
    try {
      const data = await assetClient.uploadAsset({ dataUrl: mediaDataUrl, projectId });
      if (!data.url) throw new Error(data.error || "Upload failed without media URL");
      return data.url; // Returns the /media/... URL, which doesn't need IndexedDB
    } catch (e) {
      console.error("Asset upload failed", e);
      throw e;
    }
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => extractAndSaveAssets(item, projectId)));
  }

  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = await extractAndSaveAssets(obj[key], projectId);
      }
    }
    return Array.isArray(obj.shots) && obj.manualStoryboard?.boards
      ? rebaseStoryboardGridMediaSources(obj, newObj) : newObj;
  }

  return obj;
};

export const restoreAssets = async (obj: any): Promise<any> => {
  return obj;
};

export const setItemNow = async (key: string, value: any) => {
  await localforage.setItem(key, value);
};

export const getItemRestored = async <T>(key: string): Promise<T | null> => {
  const data = await localforage.getItem<T>(key);
  if (!data) return null;
  return data;
};

export const cleanupExpiredTakes = async (episodes: any[], assets: any[], characters: any[], projectId?: string) => {
  // Empty shim, takes are handled by the backend directly or not needed locally
};
