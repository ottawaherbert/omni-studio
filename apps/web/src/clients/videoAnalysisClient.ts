import { aiAwareFetch } from "./manualAIClient";
import type { AnalysisSegment, VideoAnalysisProject } from "../../../../src/types/videoAnalysis";

export interface VideoAnalysisProjectListResponse {
  projects: VideoAnalysisProject[];
  total: number;
}

export interface VideoAnalysisProjectListQuery {
  page: number;
  limit: number;
  search?: string;
}

const parseVideoAnalysisResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `HTTP ${response.status}`);
  }
  return response.json();
};

const projectPath = (projectId?: string, suffix = "") =>
  projectId
    ? `/api/video-analysis/projects/${encodeURIComponent(projectId)}${suffix}`
    : "/api/video-analysis/projects";

const writeJson = <T,>(url: string, method: "POST" | "PUT", body: unknown) =>
  aiAwareFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => parseVideoAnalysisResponse<T>(response));

export const videoAnalysisClient = {
  listProjects: (query: VideoAnalysisProjectListQuery) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
      search: query.search || "",
    });
    return aiAwareFetch(`${projectPath()}?${params.toString()}`).then((response) =>
      parseVideoAnalysisResponse<VideoAnalysisProjectListResponse>(response),
    );
  },

  createProject: (project: VideoAnalysisProject) =>
    writeJson<VideoAnalysisProject>(projectPath(), "POST", project),

  updateProject: (project: VideoAnalysisProject) =>
    writeJson<VideoAnalysisProject>(projectPath(project.id), "PUT", project),

  deleteProject: async (projectId: string) => {
    await aiAwareFetch(projectPath(projectId), { method: "DELETE" }).then((response) =>
      parseVideoAnalysisResponse<{ success: boolean }>(response),
    );
  },

  createSegment: (projectId: string, segment: AnalysisSegment) =>
    writeJson<AnalysisSegment>(projectPath(projectId, "/segments"), "POST", segment),

  updateSegment: (projectId: string, segment: AnalysisSegment) =>
    writeJson<AnalysisSegment>(
      projectPath(projectId, `/segments/${encodeURIComponent(segment.id)}`),
      "PUT",
      segment,
    ),

  deleteSegment: async (projectId: string, segmentId: string) => {
    await aiAwareFetch(projectPath(projectId, `/segments/${encodeURIComponent(segmentId)}`), { method: "DELETE" }).then(
      (response) => parseVideoAnalysisResponse<{ success: boolean }>(response),
    );
  },
};
