import { create } from "zustand";
import type { SkillCategoryDTO, SkillDTO } from "../clients/domainTypes";
import { skillClient } from "../clients/skillClient";

export interface SkillState {
  skills: SkillDTO[];
  categories: SkillCategoryDTO[];
  isLoading: boolean;
  error: string | null;
  fetchSkills: (force?: boolean) => Promise<void>;
  fetchCategories: () => Promise<void>;
  addSkill: (skill: Partial<SkillDTO>) => Promise<void>;
  updateSkill: (id: string, updates: Partial<SkillDTO>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
}

let skillCatalogLoaded = false;
let skillCatalogRequest: Promise<void> | null = null;

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [], categories: [], isLoading: false, error: null,
  fetchSkills: (force = false) => {
    if (skillCatalogLoaded && !force) return Promise.resolve();
    if (skillCatalogRequest) return skillCatalogRequest;
    const request = (async () => {
      set({ isLoading: true, error: null });
      try {
        const [skills, categories] = await Promise.all([skillClient.listSkills(), skillClient.listCategories()]);
        skillCatalogLoaded = true;
        set({ skills, categories: categories.sort((a, b) => a.sortOrder - b.sortOrder) });
      } catch {
        skillCatalogLoaded = false;
        // Keep the last server-confirmed view; do not invent a different local library.
        set({ error: "技能库加载失败，当前显示的内容可能不是最新的，请重试。" });
      } finally { set({ isLoading: false }); }
    })();
    skillCatalogRequest = request;
    return request.finally(() => { if (skillCatalogRequest === request) skillCatalogRequest = null; });
  },
  fetchCategories: async () => { await get().fetchSkills(true); },
  addSkill: async skill => {
    const saved = await skillClient.createSkill(skill);
    set(state => ({ skills: [...state.skills.filter(item => item.id !== saved.id), saved] }));
  },
  updateSkill: async (id, updates) => {
    const saved = await skillClient.updateSkill(id, updates);
    set(state => ({ skills: state.skills.map(skill => skill.id === id ? saved : skill) }));
  },
  deleteSkill: async id => {
    await skillClient.deleteSkill(id);
    set(state => ({ skills: state.skills.filter(skill => skill.id !== id) }));
  },
}));
