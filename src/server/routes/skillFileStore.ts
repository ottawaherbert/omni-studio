import { validateSkillMetadata } from "../../../packages/domain/src/skillMetadata";
import { validateCreativeSkill, isDirectorProfileV2, directorProfileText } from "../../../packages/domain/src/creativeDirection";
import fs from "fs/promises";
import { randomUUID } from "node:crypto";
import path from "path";

import type { SkillCategoryDTO, SkillDTO } from "../../../packages/domain/src/skill";
import { isPathSafe } from "./fileRouteUtils";

const categoriesFileName = "categories.json";

export const now = () => Date.now();
export const clean = (value: unknown) => String(value || "").trim();

const slug = (value: string) => clean(value).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 48) || "skill";
const categoryPath = (skillsDir: string) => path.join(skillsDir, categoriesFileName);
const frontmatterValue = (value: string) => JSON.stringify(value);
const skillFileName = (skill: Pick<SkillDTO, "id" | "title">) => `${slug(skill.title)}_${slug(skill.id)}.md`;

export const ensureSkillDir = async (skillsDir: string) => {
  await fs.mkdir(skillsDir, { recursive: true });
};

export const readCategories = async (skillsDir: string): Promise<SkillCategoryDTO[]> => {
  await ensureSkillDir(skillsDir);
  try {
    const raw = await fs.readFile(categoryPath(skillsDir), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item, index) => ({
      id: clean(item.id) || `cat_${index}`,
      name: clean(item.name) || "未分类",
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      createdAt: Number(item.createdAt) || now(),
      updatedAt: Number(item.updatedAt) || now(),
    })) : [];
  } catch {
    return [];
  }
};

export const writeCategories = async (skillsDir: string, categories: SkillCategoryDTO[]) => {
  await ensureSkillDir(skillsDir);
  await fs.writeFile(categoryPath(skillsDir), `${JSON.stringify(categories, null, 2)}\n`);
};

const parseFrontmatter = (content: string) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  match[1].split("\n").forEach((line) => {
    const index = line.indexOf(":");
    if (index < 0) return;
    const key = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    let value = raw;
    if (raw.startsWith('"')) { try { value = JSON.parse(raw); } catch { value = raw.replace(/^"(.*)"$/, "$1"); } }
    if (key) meta[key] = value;
  });
  return { meta, body: match[2].trim() };
};

const parseLegacyJsonSkill = (content: string) => {
  const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/);
  let metadata: Record<string, any> = {};
  if (jsonMatch?.[1]) {
    try {
      metadata = JSON.parse(jsonMatch[1]);
    } catch {
      metadata = {};
    }
  }
  return { metadata, description: content.replace(/```json\n[\s\S]+?\n```/, "").trim() };
};

const readableLegacyContent = (metadata: Record<string, any>, description: string) => {
  if (description) return description;
  return [
    metadata.narrative?.themeFocus?.length ? `主题焦点：${metadata.narrative.themeFocus.join("、")}` : "",
    metadata.narrative?.characterArchetypes ? `人物方法：${metadata.narrative.characterArchetypes}` : "",
    metadata.narrative?.conflictMechanics ? `冲突机制：${metadata.narrative.conflictMechanics}` : "",
    metadata.narrative?.dialogueStyle ? `对白方式：${metadata.narrative.dialogueStyle}` : "",
    metadata.narrative?.pacingAndStructure ? `节奏结构：${metadata.narrative.pacingAndStructure}` : "",
    metadata.promptModifiers?.scriptInstruction ? `剧本文本指令：${metadata.promptModifiers.scriptInstruction}` : "",
    metadata.forbiddenCliches?.length ? `注意避免：${metadata.forbiddenCliches.join("；")}` : "",
  ].filter(Boolean).join("\n");
};

export const normalizeSkill = (skill: Partial<SkillDTO>, fallback: Partial<SkillDTO> = {}): SkillDTO => {
  validateCreativeSkill(skill);
  validateSkillMetadata(skill);
  const timestamp = now();
  const title = clean(skill.title || fallback.title || "未命名 Skill");
  const content = isDirectorProfileV2(skill.profile?.director) ? directorProfileText(skill.profile.director) : clean(skill.content || fallback.content || "");
  const id = clean(skill.id || fallback.id) || `skill_${timestamp}`;
  return {
    id,
    title,
    purposes: skill.purposes ?? fallback.purposes,
    applicability: skill.applicability ?? fallback.applicability,
    kind: skill.kind || fallback.kind || "general",
    revision: Number(skill.revision || fallback.revision) || 1,
    profile: skill.profile,
    references: skill.references || [],
    referenceWork: skill.referenceWork || undefined,
    analysisNotes: skill.analysisNotes,
    analysisBasis: skill.analysisBasis,
    categoryId: clean(Object.prototype.hasOwnProperty.call(skill, "categoryId") ? skill.categoryId : fallback.categoryId) || undefined,
    content,
    source: skill.source === "ai" || fallback.source === "ai" ? "ai" : "manual",
    createdAt: Number(skill.createdAt || fallback.createdAt) || timestamp,
    updatedAt: Number(skill.updatedAt || timestamp),
    _filename: skill._filename || fallback._filename,
  };
};

export const parseSkillFile = (fileName: string, content: string): SkillDTO => {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter) {
    return normalizeSkill({
      ...parseCreativeMetadata(frontmatter.meta.creativeMetadata),
      id: frontmatter.meta.id,
      title: frontmatter.meta.title,
      categoryId: frontmatter.meta.categoryId,
      source: frontmatter.meta.source === "ai" ? "ai" : "manual",
      createdAt: Number(frontmatter.meta.createdAt),
      updatedAt: Number(frontmatter.meta.updatedAt),
      content: frontmatter.body,
      _filename: fileName,
    });
  }
  const legacy = parseLegacyJsonSkill(content);
  return normalizeSkill({
    id: legacy.metadata.id || `skill-file-${fileName}`,
    title: legacy.metadata.title || legacy.metadata.name || fileName.replace(/\.md$/, ""),
    categoryId: legacy.metadata.categoryId || legacy.metadata.category,
    source: legacy.metadata.source === "ai" ? "ai" : "manual",
    createdAt: legacy.metadata.createdAt,
    updatedAt: legacy.metadata.updatedAt,
    content: readableLegacyContent(legacy.metadata, legacy.description),
    _filename: fileName,
  });
};

const parseCreativeMetadata = (value?: string): Partial<SkillDTO> => {
  if (!value) return {};
  const parsed = JSON.parse(value);
  validateCreativeSkill(parsed);
  return parsed;
};

const skillToFileContent = (skill: SkillDTO) => `---
id: ${frontmatterValue(skill.id)}
title: ${frontmatterValue(skill.title)}
creativeMetadata: ${JSON.stringify({ purposes: skill.purposes, applicability: skill.applicability, kind: skill.kind || "general", revision: skill.revision || 1, profile: skill.profile, references: skill.references || [], referenceWork: skill.referenceWork, analysisNotes: skill.analysisNotes, analysisBasis: skill.analysisBasis })}
${skill.categoryId ? `categoryId: ${frontmatterValue(skill.categoryId)}\n` : ""}source: ${skill.source}
createdAt: ${skill.createdAt}
updatedAt: ${skill.updatedAt}
---

${skill.content}
`;

const listSkillFiles = async (skillsDir: string) => {
  await ensureSkillDir(skillsDir);
  return (await fs.readdir(skillsDir)).filter((fileName) => fileName.endsWith(".md"));
};

const findSkillFile = async (skillsDir: string, skillId: string) => {
  for (const fileName of await listSkillFiles(skillsDir)) {
    const parsed = parseSkillFile(fileName, await fs.readFile(path.join(skillsDir, fileName), "utf-8"));
    if (parsed.id === skillId) return fileName;
  }
  return "";
};

export const readSkills = async (skillsDir: string) => Promise.all((await listSkillFiles(skillsDir)).map(async (fileName) =>
  parseSkillFile(fileName, await fs.readFile(path.join(skillsDir, fileName), "utf-8")),
));

export class SkillInputError extends Error {}

const validateSkillContent = (input: Partial<SkillDTO>) => {
  if (typeof input.title !== "string" || !input.title.trim()) throw new SkillInputError("请填写技能名称。");
  if (!isDirectorProfileV2(input.profile?.director) && (typeof input.content !== "string" || !input.content.trim())) throw new SkillInputError("请填写技能规则与要求。");
  try { validateCreativeSkill(input); validateSkillMetadata(input); } catch (err) { throw new SkillInputError((err as Error).message); }
};

export const createSkillFile = async (skillsDir: string, input: Partial<SkillDTO>) => {
  validateSkillContent(input);
  if (input.id && await findSkillFile(skillsDir, input.id)) throw new SkillInputError("该技能已存在，请通过编辑更新。");
  const skill = normalizeSkill({ ...input, id: input.id || `skill_${randomUUID()}`, createdAt: now(), updatedAt: now() });
  const fileName = skillFileName(skill);
  await ensureSkillDir(skillsDir);
  await fs.writeFile(path.join(skillsDir, fileName), skillToFileContent({ ...skill, _filename: fileName }), { flag: "wx" });
  return { ...skill, _filename: fileName };
};

export const updateSkillFile = async (skillsDir: string, skillId: string, body: Partial<SkillDTO>) => {
  const fileName = await findSkillFile(skillsDir, skillId);
  if (!fileName) return undefined;
  if (!isPathSafe(skillsDir, fileName)) throw new Error("Access Denied: Path Traversal Detected");
  const fullPath = path.join(skillsDir, fileName);
  const current = parseSkillFile(fileName, await fs.readFile(fullPath, "utf-8"));
  if (body.kind && body.kind !== current.kind) throw new SkillInputError("已有技能不能更换类型，请新建技能。");
  validateSkillContent({ ...current, ...body });
  if (isDirectorProfileV2(current.profile?.director) && Object.prototype.hasOwnProperty.call(body, "profile") && !isDirectorProfileV2(body.profile?.director)) throw new SkillInputError("已分类导演方法不能清空或降级为正文，请在方法编辑器中修改。");
  if (isDirectorProfileV2(current.profile?.director) && body?.content !== undefined && body.content !== current.content && !Object.prototype.hasOwnProperty.call(body, "profile")) throw new SkillInputError("请在导演方法编辑器中修改分类指导，正文由方法自动生成。");
  if (body?.content !== undefined && body.content !== current.content && !Object.prototype.hasOwnProperty.call(body, "profile")) {
    body = { ...body, profile: current.profile?.visual ? { visual: { medium: current.profile.visual.medium, mediumSelection: current.profile.visual.mediumSelection, treatment: { directives: [body.content] } } } : undefined };
  }
  const skill = normalizeSkill({ ...current, ...(body || {}), revision: (current.revision || 1) + 1, id: current.id, createdAt: current.createdAt, updatedAt: now(), _filename: fileName }, current);
  await fs.writeFile(fullPath, skillToFileContent(skill));
  return skill;
};

export const deleteSkillFile = async (skillsDir: string, skillId: string) => {
  const fileName = await findSkillFile(skillsDir, skillId);
  if (!fileName) return false;
  await fs.unlink(path.join(skillsDir, fileName));
  return true;
};

export const moveSkillsFromCategory = async (skillsDir: string, categoryId: string) => {
  await Promise.all((await listSkillFiles(skillsDir)).map(async (fileName) => {
    const fullPath = path.join(skillsDir, fileName);
    const skill = parseSkillFile(fileName, await fs.readFile(fullPath, "utf-8"));
    if (skill.categoryId !== categoryId) return;
    await fs.writeFile(fullPath, skillToFileContent(normalizeSkill({ ...skill, categoryId: undefined, updatedAt: now() }, skill)));
  }));
};
