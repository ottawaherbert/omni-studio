import type { SystemGarbageCollectionResponse } from "../../../../packages/domain/src/system";

const parseSystemResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `HTTP ${response.status}`);
  }
  return response.json();
};

export const systemClient = {
  previewGarbageCollection: () => fetch("/api/system/gc").then(parseSystemResponse<SystemGarbageCollectionResponse>),
  restoreRecycledMedia: () => fetch("/api/system/gc/restore", { method: "POST" }).then(parseSystemResponse<SystemGarbageCollectionResponse>),
  runGarbageCollection: () =>
    fetch("/api/system/gc", { method: "POST" }).then((response) =>
      parseSystemResponse<SystemGarbageCollectionResponse>(response),
    ),
};
