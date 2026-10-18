import { aiAwareFetch } from "./manualAIClient";
import type {
  SkillCategoryDTO,
  SkillCategoryListResponse,
  SkillCategoryMutationResponse,
  SkillAIDraftRequest,
  SkillAIDraftResponse,
  SkillDTO,
  SkillDeleteResponse,
  SkillListResponse,
  SkillMutationResponse,
  SkillRecommendationRequest,
  SkillRecommendationResponse,
} from "../../../../packages/domain/src/skill";

const parseSkillResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    let message = payload;
    try { message = JSON.parse(payload).error || payload; } catch { /* Plain-text errors are also supported. */ }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
};

const skillPath = (id?: string) =>
  id ? `/api/skills/${encodeURIComponent(id)}` : "/api/skills";

const categoryPath = (id?: string) =>
  id ? `/api/skills/categories/${encodeURIComponent(id)}` : "/api/skills/categories";

const writeSkill = (url: string, method: "POST" | "PATCH" | "PUT", body: Partial<SkillDTO>) =>
  aiAwareFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => parseSkillResponse<SkillMutationResponse>(response));

const writeCategory = (url: string, method: "POST" | "PATCH", body: Partial<SkillCategoryDTO>) =>
  aiAwareFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => parseSkillResponse<SkillCategoryMutationResponse>(response));

export const skillClient = {
  listSkills: async (): Promise<SkillDTO[]> => {
    const response = await aiAwareFetch(skillPath());
    const payload = await parseSkillResponse<SkillListResponse>(response);
    return payload.skills || [];
  },

  listCategories: async (): Promise<SkillCategoryDTO[]> => {
    const response = await aiAwareFetch(categoryPath());
    const payload = await parseSkillResponse<SkillCategoryListResponse>(response);
    return payload.categories || [];
  },

  createCategory: async (category: Partial<SkillCategoryDTO>): Promise<SkillCategoryDTO> => {
    const payload = await writeCategory(categoryPath(), "POST", category);
    return payload.category;
  },

  updateCategory: async (id: string, category: Partial<SkillCategoryDTO>): Promise<SkillCategoryDTO> => {
    const payload = await writeCategory(categoryPath(id), "PATCH", category);
    return payload.category;
  },

  deleteCategory: (id: string) =>
    aiAwareFetch(categoryPath(id), { method: "DELETE" }).then((response) =>
      parseSkillResponse<SkillDeleteResponse>(response),
    ),

  createSkill: async (skill: Partial<SkillDTO>): Promise<SkillDTO> => {
    const payload = await writeSkill(skillPath(), "POST", skill);
    return payload.skill;
  },

  updateSkill: async (id: string, skill: Partial<SkillDTO>): Promise<SkillDTO> => {
    const payload = await writeSkill(skillPath(id), "PATCH", skill);
    return payload.skill;
  },

  deleteSkill: (id: string) =>
    aiAwareFetch(skillPath(id), { method: "DELETE" }).then((response) =>
      parseSkillResponse<SkillDeleteResponse>(response),
    ),

  draftSkillWithAI: async (request: SkillAIDraftRequest) => {
    const response = await aiAwareFetch("/api/skills/ai-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await parseSkillResponse<SkillAIDraftResponse>(response);
    return payload.draft;
  },

  recommendSkills: async (request: SkillRecommendationRequest) => {
    const response = await aiAwareFetch("/api/skills/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await parseSkillResponse<SkillRecommendationResponse>(response);
    return payload.result;
  },
};
