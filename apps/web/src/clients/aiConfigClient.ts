import type {
  AIConfigDTO,
  AIConfigResponse,
  ProviderKeyStatusResponse,
} from "../../../../packages/domain/src/aiConfig";

const readAiConfigResponse = async <T,>(response: Response, label: string): Promise<T> => {
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${bodyText.slice(0, 160)}`);
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    const preview = bodyText.trim().slice(0, 80) || contentType || "empty response";
    throw new Error(`${label} did not return JSON. 请确认当前端口是 npm run dev 启动的 O.M.N.I. 服务，而不是纯 Vite 静态前端。响应预览: ${preview}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch (err: any) {
    throw new Error(`${label} returned invalid JSON: ${err?.message || "parse failed"}`);
  }
};

export const aiConfigClient = {
  getProviderKeyStatus: (customBgmKeySlot?: string) => {
    const params = new URLSearchParams();
    if (customBgmKeySlot) params.set("customBgmKeySlot", customBgmKeySlot);
    const query = params.toString();
    return fetch(`/api/provider-key-status${query ? `?${query}` : ""}`).then((response) =>
      readAiConfigResponse<ProviderKeyStatusResponse>(response, "Provider key status load"),
    );
  },

  loadConfig: () =>
    fetch("/api/ai-config").then((response) =>
      readAiConfigResponse<AIConfigResponse>(response, "AI config load"),
    ),

  saveConfig: (config: AIConfigDTO) =>
    fetch("/api/ai-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then((response) =>
      readAiConfigResponse<AIConfigResponse>(response, "AI config save"),
    ),
};
