import { create } from "zustand";
import { createProjectSlice, ProjectSlice } from "./slices/projectSlice";
import { createEpisodeSlice, EpisodeSlice } from "./slices/episodeSlice";

export interface ProjectState extends ProjectSlice, EpisodeSlice {}

export const useProjectStore = create<ProjectState>((...a) => ({
  ...createProjectSlice(...a),
  ...createEpisodeSlice(...a),
}));

export { getItemRestored, setItemNow } from "../utils/storage";

