export interface ComfyUIConnectionStatus {
  ready: boolean;
  baseUrl: string;
  version: string;
  deviceName: string;
  sourceWorkflowName: string;
  installed: {
    diffusionModel: boolean;
    textEncoder: boolean;
    videoVae: boolean;
    audioVae: boolean;
    referenceNode: boolean;
    teSpeedNode: boolean;
    sourceWorkflow: boolean;
  };
}

export const comfyUIClient = {
  checkConnection: async (baseUrl: string): Promise<ComfyUIConnectionStatus> => {
    const response = await fetch("/api/proxy/comfyui/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl }),
    });
    const data = await response.json().catch(() => ({})) as Partial<ComfyUIConnectionStatus> & { error?: string };
    if (!response.ok) throw new Error(data.error || "无法连接 ComfyUI。");
    return data as ComfyUIConnectionStatus;
  },
};
