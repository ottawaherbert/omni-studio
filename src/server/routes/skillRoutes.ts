import { isGeneralSkill, validateCreativeSkill } from "../../../packages/domain/src/creativeDirection";
import { randomUUID } from "node:crypto";
import type { Express, Response } from "express";

import type {
  SkillAIDraftDTO,
  SkillCategoryDTO,
  SkillDTO,
  SkillRecommendationItem,
  SkillRecommendationResult,
} from "../../../packages/domain/src/skill";
import { buildSkillAIDraftPrompt, buildSkillRecommendationPrompt, skillContentForRecommendation } from "../../../packages/domain/src/skillPrompt";
import { generateServerGenericAIJson } from "../../../apps/api/src/providers/genericAIProvider";
import {
  clean,
  SkillInputError,
  createSkillFile,
  deleteSkillFile,
  moveSkillsFromCategory,
  now,
  readCategories,
  readSkills,
  updateSkillFile,
  writeCategories,
} from "./skillFileStore";

export interface SkillRoutesOptions {
  skillsDir: string;
  generateJson?: typeof generateServerGenericAIJson;
}

const sendSkillRouteError = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof SkillInputError) return res.status(400).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: "操作失败，请重试。" });
};

const normalizeSkillDraft = (raw: Record<string, unknown>, fallback: { userIdea: string; categoryHint?: string }): SkillAIDraftDTO => {
  const title = clean(raw.title) || clean(fallback.userIdea).slice(0, 16) || "通用 Skill";
  const categoryName = clean(raw.categoryName || fallback.categoryHint) || "未分类";
  const content = clean(raw.content);
  if (!content) throw new Error("Skill AI draft missing content");
  return { title: title.slice(0, 32), categoryName: categoryName.slice(0, 24), content };
};

const normalizeSkillRecommendation = (
  raw: Record<string, unknown>,
  skills: SkillDTO[],
): SkillRecommendationResult => {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const skillByTitle = new Map(skills.map((skill) => [skill.title.trim(), skill]));
  const used = new Set<string>();
  const normalizeList = (value: unknown, allowDuplicate = false): SkillRecommendationItem[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const rawId = clean(record.skillId || record.id);
      const rawTitle = clean(record.title);
      const skill = skillById.get(rawId) || skillByTitle.get(rawTitle);
      if (!skill) {
        console.warn("Dropped unknown Skill recommendation", { rawId, rawTitle });
        return [];
      }
      if (!allowDuplicate && used.has(skill.id)) return [];
      used.add(skill.id);
      const confidence = Number(record.confidence);
      return [{
        skillId: skill.id,
        title: skill.title,
        reason: clean(record.reason) || "适合当前任务。",
        suggestedUse: clean(record.suggestedUse),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : undefined,
      }];
    });
  };
  const recommended = normalizeList(raw.recommended).slice(0, 8);
  const optional = normalizeList(raw.optional).slice(0, 8);
  const notRecommended = normalizeList(raw.notRecommended, true).slice(0, 8);
  return { recommended, optional, notRecommended };
};

export const registerSkillRoutes = (app: Express, { skillsDir, generateJson = generateServerGenericAIJson }: SkillRoutesOptions) => {
  app.post("/api/skills/ai-draft", async (req, res) => {
    try {
      const userIdea = clean(req.body?.userIdea);
      if (!userIdea) return res.status(400).json({ error: "请填写技能需求" });
      const categoryHint = clean(req.body?.categoryHint);
      const prompt = clean(req.body?.prompt) || buildSkillAIDraftPrompt({ userIdea, categoryHint });
      const data = await generateJson({
        prompt,
      });
      return res.json({ draft: normalizeSkillDraft(data, { userIdea, categoryHint }) });
    } catch (err) {
      return sendSkillRouteError(res, err, "Failed to generate skill draft");
    }
  });

  app.post("/api/skills/recommend", async (req, res) => {
    try {
      const allSkills = (await readSkills(skillsDir)).filter(isGeneralSkill);
      const categories = await readCategories(skillsDir);
      const requestedIds = Array.isArray(req.body?.skillIds) ? req.body.skillIds.map(String) : [];
      const candidateSkills = requestedIds.length
        ? allSkills.filter((skill) => requestedIds.includes(skill.id))
        : allSkills;
      if (!candidateSkills.length) return res.status(400).json({ error: "Skill candidates are required" });
      const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
      const task = req.body?.task && typeof req.body.task === "object" ? req.body.task : {};
      const selectedSkillIds = Array.isArray(task.selectedSkillIds) ? task.selectedSkillIds.map(String) : [];
      const selectedSkillTitles = allSkills.filter((skill) => selectedSkillIds.includes(skill.id)).map((skill) => skill.title);
      const prompt = clean(req.body?.prompt) || buildSkillRecommendationPrompt({
        taskLabel: clean(task.taskLabel) || "推荐 Skill",
        stage: clean(task.stage),
        projectFormat: clean(task.projectFormat),
        targetUnitCount: Number.isFinite(Number(task.targetUnitCount)) ? Number(task.targetUnitCount) : undefined,
        targetDurationMinutes: Number.isFinite(Number(task.targetDurationMinutes)) ? Number(task.targetDurationMinutes) : undefined,
        blueprintSummary: clean(task.blueprintSummary),
        currentPromptPreview: clean(task.currentPromptPreview),
        selectedSkillTitles,
        categories: categories.map((category) => ({ id: category.id, name: category.name })),
        skills: candidateSkills.map((skill) => ({
          id: skill.id,
          title: skill.title,
          categoryName: skill.categoryId ? categoryNameById.get(skill.categoryId) : undefined,
          content: skillContentForRecommendation(skill.content),
          selected: selectedSkillIds.includes(skill.id),
        })),
      });
      const data = await generateJson({
        prompt,
      });
      return res.json({ result: normalizeSkillRecommendation(data, candidateSkills) });
    } catch (err) {
      return sendSkillRouteError(res, err, "Failed to recommend skills");
    }
  });

  app.get("/api/skills/categories", async (_req, res) => {
    try {
      res.json({ categories: await readCategories(skillsDir) });
    } catch (err) {
      sendSkillRouteError(res, err, "Failed to load skill categories");
    }
  });

  app.post("/api/skills/categories", async (req, res) => {
    try {
      const categories = await readCategories(skillsDir);
      const category: SkillCategoryDTO = {
        id: clean(req.body?.id) || `cat_${randomUUID()}`,
        name: clean(req.body?.name),
        sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : categories.length * 10,
        createdAt: now(),
        updatedAt: now(),
      };
      validateCategoryName(category.name, categories);
      if (categories.some(item => item.id === category.id)) throw new SkillInputError("分类已存在。");
      await writeCategories(skillsDir, [...categories, category]);
      res.json({ success: true, category });
    } catch (err) {
      sendSkillRouteError(res, err, "Failed to save skill category");
    }
  });

  app.patch("/api/skills/categories/:categoryId", async (req, res) => {
    try {
      const categories = await readCategories(skillsDir);
      const current = categories.find((item) => item.id === req.params.categoryId);
      if (!current) return res.status(404).json({ error: "Skill category not found" });
      const category = normalizeSkillCategory(current, req.body);
      validateCategoryName(category.name, categories.filter(item => item.id !== category.id));
      await writeCategories(skillsDir, categories.map((item) => item.id === category.id ? category : item));
      return res.json({ success: true, category });
    } catch (err) {
      return sendSkillRouteError(res, err, "Failed to update skill category");
    }
  });

  app.delete("/api/skills/categories/:categoryId", async (req, res) => {
    try {
      const categories = await readCategories(skillsDir);
      if (!categories.some(item => item.id === req.params.categoryId)) return res.status(404).json({ error: "分类不存在" });
      await moveSkillsFromCategory(skillsDir, req.params.categoryId);
      await writeCategories(skillsDir, categories.filter(item => item.id !== req.params.categoryId));
      return res.json({ success: true });
    } catch (err) {
      return sendSkillRouteError(res, err, "Failed to delete skill category");
    }
  });

  app.get("/api/skills", async (_req, res) => {
    try {
      res.json({ skills: (await readSkills(skillsDir)).filter(skill => skill.kind !== "visual_style") });
    } catch (err) {
      sendSkillRouteError(res, err, "Failed to load skills");
    }
  });

  app.post("/api/skills", async (req, res) => {
    try {
      if (req.body?.kind === "visual_style") return res.status(400).json({ error: "请在制作页面直接填写风格提示词。" });
      try { validateCreativeSkill(req.body || {}); } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
      res.json({ success: true, skill: await createSkillFile(skillsDir, req.body || {}) });
    } catch (err) {
      sendSkillRouteError(res, err, "Failed to save skill");
    }
  });

  app.patch("/api/skills/:id", async (req, res) => updateSkillById(skillsDir, req.params.id, req.body, res));
  app.put("/api/skills/:id", async (req, res) => updateSkillById(skillsDir, req.params.id, req.body, res));

  app.delete("/api/skills/:id", async (req, res) => {
    try {
      if (!await deleteSkillFile(skillsDir, req.params.id)) return res.status(404).json({ error: "Skill not found" });
      return res.json({ success: true });
    } catch (err) {
      return sendSkillRouteError(res, err, "Failed to delete skill");
    }
  });
};

const validateCategoryName = (name: string, categories: SkillCategoryDTO[]) => {
  if (!name || name.length > 40) throw new SkillInputError("分类名称须为 1 到 40 个字符。");
  if (categories.some(category => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new SkillInputError("已有同名分类，请使用其他名称。");
};

const normalizeSkillCategory = (current: SkillCategoryDTO, body: any): SkillCategoryDTO => ({
  ...current,
  name: body?.name === undefined ? current.name : clean(body.name),
  sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : current.sortOrder,
  updatedAt: now(),
});

const updateSkillById = async (skillsDir: string, id: string, body: any, res: Response) => {
  try {
    try { validateCreativeSkill(body || {}); } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
    const skill = await updateSkillFile(skillsDir, id, body || {});
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    return res.json({ success: true, skill });
  } catch (err) {
    if (String((err as Error)?.message || err).includes("Access Denied")) return res.status(403).json({ error: "Access Denied: Path Traversal Detected" });
    return sendSkillRouteError(res, err, "Failed to update skill");
  }
};
