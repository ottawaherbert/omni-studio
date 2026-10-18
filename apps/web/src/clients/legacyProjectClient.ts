import type {
  Episode,
  ManualProductionAssetReferenceAudit,
  ProductionCanonicalScriptUnit,
  ProductionScriptWorkspace,
  ProductionSourceDocument,
  Project,
  Shot,
  Scene,
} from "../../../../src/types/project";
import type { ManualStudioPriorVideoReferenceCandidate } from "../../../../src/services/production/manualStudioReferenceCandidates";

export type LegacyEpisodeView = "production-preparation" | "storyboard" | "storyboard-index";
export type LegacyProjectView = "shell" | "production-workspace";

const parseLegacyProjectResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    let message = payload;
    try { message = JSON.parse(payload).error || payload; } catch { /* plain response */ }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
};

const projectPath = (projectId?: string, suffix = "") =>
  projectId ? `/api/projects/${encodeURIComponent(projectId)}${suffix}` : "/api/projects";

const episodePath = (projectId: string, episodeId: string) =>
  projectPath(projectId, `/episodes/${encodeURIComponent(episodeId)}`);

const projectRequests = new Map<string, Promise<Project | null>>();
const episodeRequests = new Map<string, Promise<Episode | null>>();

const writeJson = <T,>(url: string, method: "POST" | "PUT" | "PATCH", body: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => parseLegacyProjectResponse<T>(response));

export const legacyProjectClient = {
  listProjects: () =>
    fetch(`${projectPath()}?view=summary`).then((response) => parseLegacyProjectResponse<Project[]>(response)),

  createProject: (project: Project) =>
    writeJson<Project>(projectPath(), "POST", project),

  getProject: (projectId: string, view: LegacyProjectView = "shell", options?: { sourceDocumentId?: string }): Promise<Project | null> => {
    const query = new URLSearchParams({ view });
    if (options?.sourceDocumentId) query.set("sourceDocumentId", options.sourceDocumentId);
    const path = `${projectPath(projectId)}?${query.toString()}`;
    const existing = projectRequests.get(path);
    if (existing) return existing;
    const request = fetch(path)
      .then((response) => response.status === 404
        ? null
        : parseLegacyProjectResponse<Project>(response))
      .finally(() => projectRequests.delete(path));
    projectRequests.set(path, request);
    return request;
  },

  /** Full project reads are intentionally reserved for on-demand history. */
  getProjectFull: (projectId: string) =>
    fetch(`${projectPath(projectId)}?view=full`)
      .then((response) => response.status === 404 ? null : parseLegacyProjectResponse<Project>(response)),

  getManualStudioPriorVideoReferences: (projectId: string) =>
    fetch(projectPath(projectId, "/manual-studio/prior-video-references"))
      .then((response) => parseLegacyProjectResponse<ManualStudioPriorVideoReferenceCandidate[]>(response)),

  getProductionScriptUnit: (projectId: string, sourceDocumentId: string) =>
    fetch(projectPath(projectId, `/script-units/${encodeURIComponent(sourceDocumentId)}`))
      .then((response) => response.status === 404
        ? null
        : parseLegacyProjectResponse<{
          unit: ProductionCanonicalScriptUnit;
          originalSourceDocument?: ProductionSourceDocument;
        }>(response)),

  getProductionScriptWorkspace: (projectId: string) =>
    fetch(projectPath(projectId, "/script-workspace"))
      .then((response) => response.status === 404
        ? null
        : parseLegacyProjectResponse<ProductionScriptWorkspace>(response)),

  saveAppearanceSnapshot: (projectId: string, project: Project, episodes: Episode[]) =>
    writeJson<Project & { __savedEpisodeRevisions?: Record<string, number> }>(projectPath(projectId, "/appearance-snapshot"), "PUT", { project, episodes }),

  patchProject: (projectId: string, updates: Partial<Project>) =>
    writeJson<Project>(projectPath(projectId), "PATCH", updates),

  stageProductionAssetBoardCandidate: (
    projectId: string,
    candidate: {
      candidateId: string;
      boardItemId: string;
      imageUrl: string;
      source: ManualProductionAssetReferenceAudit["source"];
      finalPrompt: string;
      modelId?: string;
      executionProvenance?: ManualProductionAssetReferenceAudit["executionProvenance"];
      inputReferenceUrl?: string;
      imageReferenceManifest?: ManualProductionAssetReferenceAudit["imageReferenceManifest"];
      promptCompositionManifest?: ManualProductionAssetReferenceAudit["promptCompositionManifest"];
      visualStyleCompileManifest?: ManualProductionAssetReferenceAudit["visualStyleCompileManifest"];
      sourceContentHash?: string;
      selectedSkillIds?: string[];
      selectedSkillTitles?: string[];
      selectedContextIds?: string[];
      quality?: ManualProductionAssetReferenceAudit["quality"];
      review?: ManualProductionAssetReferenceAudit["review"];
      referenceMode?: "production_board" | "clean_reference";
    },
  ) => writeJson<Project>(projectPath(projectId, "/production-asset-board-candidates"), "POST", candidate),

  adoptProductionAssetBoardCandidate: (projectId: string, candidateId: string) =>
    writeJson<Project>(
      projectPath(projectId, `/production-asset-board-candidates/${encodeURIComponent(candidateId)}/adopt`),
      "POST",
      {},
    ),

  discardProductionAssetBoardCandidate: async (projectId: string, candidateId: string) => {
    const response = await fetch(
      projectPath(projectId, `/production-asset-board-candidates/${encodeURIComponent(candidateId)}`),
      { method: "DELETE" },
    );
    return parseLegacyProjectResponse<Project>(response);
  },

  /**
   * Screenplay edits are based on a named immutable revision. Keep that
   * revision in the request so another tab cannot silently overwrite a newer
   * formal screenplay revision.
   */
  patchProductionScriptWorkspace: (
    projectId: string,
    updates: Partial<Project>,
    expectedRevisionId: string,
  ) => writeJson<Project>(projectPath(projectId), "PATCH", {
    ...updates,
    __expectedProductionScriptRevisionId: expectedRevisionId,
  }),


  deleteProject: async (projectId: string) => {
    const response = await fetch(projectPath(projectId), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      await parseLegacyProjectResponse(response);
    }
  },

  getEpisode: (
    projectId: string,
    episodeId: string,
    view?: LegacyEpisodeView,
    options?: { sceneId?: string; shotId?: string; scope?: "episode" },
  ): Promise<Episode | null> => {
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (options?.sceneId) params.set("sceneId", options.sceneId);
    if (options?.shotId) params.set("shotId", options.shotId);
    if (options?.scope) params.set("scope", options.scope);
    const query = params.toString();
    const path = `${episodePath(projectId, episodeId)}${query ? `?${query}` : ""}`;
    const existing = episodeRequests.get(path);
    if (existing) return existing;
    const request = fetch(path)
      .then((response) => response.status === 404
        ? null
        : parseLegacyProjectResponse<Episode>(response))
      .finally(() => episodeRequests.delete(path));
    episodeRequests.set(path, request);
    return request;
  },

  getStoryboardTeamContext: (
    projectId: string,
    episodeId: string,
    sceneId: string,
  ) => {
    const params = new URLSearchParams({ sceneId });
    return fetch(`${episodePath(projectId, episodeId)}/storyboard-team-context?${params}`)
      .then((response) => parseLegacyProjectResponse<{
        sceneId: string;
        productionTeamContext: string;
      }>(response));
  },

  saveEpisode: (projectId: string, episode: Episode) =>
    writeJson<Episode>(episodePath(projectId, episode.id), "PUT", episode),

  appendStudioCandidate: (projectId: string, episodeId: string, sceneId: string, candidate: {
    shotId: string;
    boardId?: string;
    take?: NonNullable<Shot["takes"]>[number];
    draftPreview?: Shot["draftPreview"];
  }) => writeJson<{ scene: Scene; episode: Episode }>(`${episodePath(projectId, episodeId)}/scenes/${encodeURIComponent(sceneId)}/studio-candidates`, "POST", candidate),

  deleteEpisode: async (projectId: string, episodeId: string) => {
    const response = await fetch(episodePath(projectId, episodeId), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      await parseLegacyProjectResponse(response);
    }
  },
};
