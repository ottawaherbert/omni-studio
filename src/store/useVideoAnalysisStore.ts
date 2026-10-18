import { create } from "zustand";
import { videoAnalysisClient } from "../clients/videoAnalysisClient";
import { VideoAnalysisProject, AnalysisSegment } from "../types/videoAnalysis";

export interface VideoAnalysisState {
  projects: VideoAnalysisProject[];
  totalProjects: number;
  currentPage: number;
  currentSearch: string;
  pageSize: number;
  isLoading: boolean;
  fetchProjects: (page?: number, search?: string) => Promise<void>;
  addProject: (project: VideoAnalysisProject) => Promise<void>;
  updateProject: (project: VideoAnalysisProject) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addSegment: (projectId: string, segment: AnalysisSegment) => Promise<void>;
  updateSegment: (projectId: string, segment: AnalysisSegment) => Promise<void>;
  deleteSegment: (projectId: string, segmentId: string) => Promise<void>;
}

export const useVideoAnalysisStore = create<VideoAnalysisState>((set, get) => ({
  projects: [],
  totalProjects: 0,
  currentPage: 1,
  currentSearch: "",
  pageSize: 10,
  isLoading: false,

  fetchProjects: async (page, search) => {
    const targetPage = page !== undefined ? page : get().currentPage;
    const targetSearch = search !== undefined ? search : get().currentSearch;
    
    set({ isLoading: true, currentPage: targetPage, currentSearch: targetSearch });
    try {
      const { projects, total } = await videoAnalysisClient.listProjects({
        page: targetPage,
        limit: get().pageSize,
        search: targetSearch,
      });
      
      set({ projects, totalProjects: total, isLoading: false });
    } catch (e) {
      console.error("Failed to fetch video analysis projects:", e);
      set({ isLoading: false });
    }
  },

  addProject: async (project) => {
    try {
      await videoAnalysisClient.createProject(project);
      await get().fetchProjects(1, "");
    } catch (e) {
      console.error("Failed to add project:", e);
      throw e;
    }
  },

  updateProject: async (project) => {
    try {
      await videoAnalysisClient.updateProject(project);
      await get().fetchProjects();
    } catch (e) {
      console.error("Failed to update project:", e);
      throw e;
    }
  },

  deleteProject: async (id) => {
    try {
      await videoAnalysisClient.deleteProject(id);
      
      const { currentPage, projects } = get();
      if (projects.length === 1 && currentPage > 1) {
        await get().fetchProjects(currentPage - 1);
      } else {
        await get().fetchProjects();
      }
    } catch (e) {
      console.error("Failed to delete project:", e);
      throw e;
    }
  },

  addSegment: async (projectId, segment) => {
    try {
      await videoAnalysisClient.createSegment(projectId, segment);
      await get().fetchProjects();
    } catch (e) {
      console.error("Failed to add segment:", e);
      throw e;
    }
  },

  updateSegment: async (projectId, segment) => {
    try {
      await videoAnalysisClient.updateSegment(projectId, segment);
      await get().fetchProjects();
    } catch (e) {
      console.error("Failed to update segment:", e);
      throw e;
    }
  },

  deleteSegment: async (projectId, segmentId) => {
    try {
      await videoAnalysisClient.deleteSegment(projectId, segmentId);
      await get().fetchProjects();
    } catch (e) {
      console.error("Failed to delete segment:", e);
      throw e;
    }
  }
}));
