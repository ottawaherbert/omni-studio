import type { CreativeSkillKind, CreativeSkillProfile, CreativeSkillReference } from "./creativeDirection";

export interface SkillReferenceWork {
  title: string;
  version?: string;
  director?: string;
  focus?: string;
}

export interface SkillCategoryDTO {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SkillDTO {
  kind?: CreativeSkillKind;
  revision?: number;
  profile?: CreativeSkillProfile;
  references?: CreativeSkillReference[];
  referenceWork?: SkillReferenceWork | null;
  /** Reference analysis is for the author, never an instruction to production. */
  analysisNotes?: string;
  analysisBasis?: "work_knowledge" | "provided_analysis" | "author";
  builtin?: boolean;
  id: string;
  title: string;
  categoryId?: string;
  content: string;
  source: "manual" | "ai";
  createdAt: number;
  updatedAt: number;
  _filename?: string;
}

export interface SkillListResponse {
  skills: SkillDTO[];
}

export interface SkillCategoryListResponse {
  categories: SkillCategoryDTO[];
}

export interface SkillMutationResponse {
  success: boolean;
  skill: SkillDTO;
}

export interface SkillCategoryMutationResponse {
  success: boolean;
  category: SkillCategoryDTO;
}

export interface SkillDeleteResponse {
  success: boolean;
}

export interface SkillAIDraftRequest {
  userIdea: string;
  categoryHint?: string;
  prompt?: string;
}

export interface SkillAIDraftDTO {
  title: string;
  categoryName: string;
  content: string;
}

export interface SkillAIDraftResponse {
  draft: SkillAIDraftDTO;
}

export interface SkillRecommendationTaskContext {
  taskLabel: string;
  stage?: string;
  projectFormat?: string;
  targetUnitCount?: number;
  targetDurationMinutes?: number;
  blueprintSummary?: string;
  currentPromptPreview?: string;
  selectedSkillIds?: string[];
  preferredCategoryIds?: string[];
}

export interface SkillRecommendationRequest {
  prompt?: string;
  task: SkillRecommendationTaskContext;
  skillIds?: string[];
}

export interface SkillRecommendationItem {
  skillId: string;
  title: string;
  reason: string;
  suggestedUse?: string;
  confidence?: number;
}

export interface SkillRecommendationResult {
  recommended: SkillRecommendationItem[];
  optional: SkillRecommendationItem[];
  notRecommended: SkillRecommendationItem[];
}

export interface SkillRecommendationResponse {
  result: SkillRecommendationResult;
}
