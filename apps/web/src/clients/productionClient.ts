import type {
  AppendProductionOperatorRunEventRequest,
  CreateProductionOperatorRunRequest,
  ProductionEpisodeDTO,
  ProductionOperatorArtifactQuery,
  ProductionOperatorRunDTO,
  ProductionRunDTO,
  UpdateProductionOperatorRunRequest,
} from "../../../../packages/domain/src/production";

const parseProductionResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `HTTP ${response.status}`);
  }
  return response.json();
};

const productionRunPath = (runId?: string) =>
  runId ? `/api/production-runs/${encodeURIComponent(runId)}` : "/api/production-runs";

const projectEpisodePath = (projectId: string, episodeId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}`;

const operatorArtifactsPath = (filters: ProductionOperatorArtifactQuery) =>
  withQuery("/api/operator/artifacts", filters);

const operatorRunPath = (runId?: string, suffix = "") =>
  runId ? `/api/operator/runs/${encodeURIComponent(runId)}${suffix}` : "/api/operator/runs";

const promptPath = (id: string) => `/api/prompts/${encodeURIComponent(id)}`;

const withQuery = (url: string, query: object) => {
  const params = new URLSearchParams();
  Object.entries(query as Record<string, string | undefined>).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const text = params.toString();
  return text ? `${url}?${text}` : url;
};

export const productionClient = {
  editScene: (projectId:string,episodeId:string,sceneId:string,patch:object) =>
    fetch(`${projectEpisodePath(projectId,episodeId)}/scenes/${encodeURIComponent(sceneId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}).then(response=>parseProductionResponse<ProductionEpisodeDTO>(response)),
  editShot: (projectId:string,episodeId:string,sceneId:string,shotId:string,patch:object) =>
    fetch(`${projectEpisodePath(projectId,episodeId)}/scenes/${encodeURIComponent(sceneId)}/shots/${encodeURIComponent(shotId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}).then(response=>parseProductionResponse<ProductionEpisodeDTO>(response)),
  saveSceneCollaboration: (projectId: string, episodeId: string, sceneId: string, patch: import("../../../../packages/domain/src/productionCollaboration").CollaborationPatch) =>
    fetch(`${projectEpisodePath(projectId,episodeId)}/scenes/${encodeURIComponent(sceneId)}/collaboration`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}).then(response=>parseProductionResponse<ProductionEpisodeDTO>(response)),
  editSceneClips: (projectId: string, episodeId: string, sceneId: string, edit: object) =>
    fetch(`${projectEpisodePath(projectId,episodeId)}/scenes/${encodeURIComponent(sceneId)}/edit`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)}).then(response=>parseProductionResponse<ProductionEpisodeDTO>(response)),
  saveAssetProductionUse: (projectId: string, assetId: string, use: import("../../../../packages/domain/src/productionCollaboration").AssetProductionUse) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/production-use`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(use)}).then(response=>parseProductionResponse<{assetId:string;productionUse:import("../../../../packages/domain/src/productionCollaboration").AssetProductionUse}>(response)),
  saveSceneDirection: (projectId: string, episodeId: string, sceneId: string, brief: { intent: string; rhythm: string }) =>
    fetch(`${projectEpisodePath(projectId, episodeId)}/scenes/${encodeURIComponent(sceneId)}/director-plan`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief),
    }).then(response => parseProductionResponse<ProductionEpisodeDTO>(response)),

  listRuns: (projectId?: string) =>
    fetch(withQuery(productionRunPath(), { projectId })).then((response) =>
      parseProductionResponse<ProductionRunDTO[]>(response),
    ),

  getRun: async (runId: string) => {
    const response = await fetch(productionRunPath(runId));
    if (response.status === 404) return null;
    return parseProductionResponse<ProductionRunDTO>(response);
  },

  upsertRun: (run: ProductionRunDTO, baseRevision: number) =>
    fetch(productionRunPath(run.id), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Production-Run-Base-Revision": String(baseRevision),
      },
      body: JSON.stringify(run),
    }).then((response) => parseProductionResponse<ProductionRunDTO>(response)),

  deleteRun: async (runId: string) => {
    const response = await fetch(productionRunPath(runId), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      await parseProductionResponse(response);
    }
  },

  getProjectEpisode: async (projectId: string, episodeId: string): Promise<ProductionEpisodeDTO | null> => {
    if (typeof fetch !== "function") return null;
    const response = await fetch(projectEpisodePath(projectId, episodeId));
    if (!response.ok) return null;
    const episode = await response.json();
    return { ...episode, scenes: episode.scenes || [] } as ProductionEpisodeDTO;
  },

  listOperatorArtifacts: async (filters: ProductionOperatorArtifactQuery): Promise<unknown[]> => {
    if (typeof fetch !== "function") return [];
    const response = await fetch(operatorArtifactsPath(filters));
    if (!response.ok) return [];
    const artifacts = await response.json();
    return Array.isArray(artifacts) ? artifacts : [];
  },

  createOperatorRun: async <T extends ProductionOperatorRunDTO = ProductionOperatorRunDTO>(
    body: CreateProductionOperatorRunRequest,
  ): Promise<T | null> => {
    if (typeof fetch !== "function") return null;
    const response = await fetch(operatorRunPath(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
  },

  appendOperatorRunEvent: async (runId: string, body: AppendProductionOperatorRunEventRequest): Promise<void> => {
    if (typeof fetch !== "function") return;
    await fetch(operatorRunPath(runId, "/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  updateOperatorRun: async (runId: string, body: UpdateProductionOperatorRunRequest): Promise<void> => {
    if (typeof fetch !== "function") return;
    await fetch(operatorRunPath(runId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  getPromptTemplateContent: async (id: string): Promise<string | undefined> => {
    if (typeof fetch === "undefined") return undefined;
    const response = await fetch(promptPath(id));
    if (!response.ok) return undefined;
    const data = await response.json();
    return typeof data?.content === "string" && data.content.trim() ? data.content : undefined;
  },
};
