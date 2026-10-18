import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

type LegacySkillRecord = Record<string, any>;

export interface SkillMigrationOptions {
  skillsDir?: string;
  dryRun?: boolean;
  deleteJson?: boolean;
  timestamp?: number;
}

export interface SkillMigrationResult {
  skillsDir: string;
  migrated: string[];
  skipped: string[];
  deleted: string[];
  categoriesCreated: string[];
}

const clean = (value: unknown) => String(value || "").trim();

const slug = (value: string) =>
  clean(value).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 48) || "skill";

const quoted = (value: string) => JSON.stringify(value);
const titleKey = (value: string) => clean(value).replace(/[（(][^）)]*[）)]/g, "").trim().toLowerCase();

const categoryFileName = "categories.json";

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
};

const readExistingSkillIndex = async (skillsDir: string) => {
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const fileName of await fs.readdir(skillsDir)) {
    if (!fileName.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(skillsDir, fileName), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      titles.add(titleKey(fileName.replace(/\.md$/, "")));
      continue;
    }
    const metaLines = match[1].split("\n");
    const idLine = metaLines.find((line) => line.trim().startsWith("id:"));
    const titleLine = metaLines.find((line) => line.trim().startsWith("title:"));
    const rawId = clean(idLine?.slice(idLine.indexOf(":") + 1));
    const rawTitle = clean(titleLine?.slice(titleLine.indexOf(":") + 1));
    const id = clean(rawId.replace(/^"(.*)"$/, "$1"));
    const title = clean(rawTitle.replace(/^"(.*)"$/, "$1"));
    if (id) ids.add(id);
    if (title) titles.add(titleKey(title));
  }
  return { ids, titles };
};

const normalizeCategoryName = (legacy: LegacySkillRecord) =>
  clean(legacy.categoryName || legacy.category || legacy.categoryId);

const normalizeSource = (legacy: LegacySkillRecord): "manual" | "ai" => {
  const source = clean(legacy.source || legacy.sourceType || legacy.generatedBy).toLowerCase();
  return source === "ai" || source.includes("ai") ? "ai" : "manual";
};

const fallbackContentFromLegacyFields = (legacy: LegacySkillRecord) => [
  Array.isArray(legacy.narrative?.themeFocus) && legacy.narrative.themeFocus.length
    ? `主题焦点：${legacy.narrative.themeFocus.join("、")}`
    : "",
  legacy.narrative?.characterArchetypes ? `人物方法：${legacy.narrative.characterArchetypes}` : "",
  legacy.narrative?.conflictMechanics ? `冲突机制：${legacy.narrative.conflictMechanics}` : "",
  legacy.narrative?.dialogueStyle ? `对白方式：${legacy.narrative.dialogueStyle}` : "",
  legacy.narrative?.pacingAndStructure ? `节奏结构：${legacy.narrative.pacingAndStructure}` : "",
  legacy.promptModifiers?.scriptInstruction ? `剧本文本指令：${legacy.promptModifiers.scriptInstruction}` : "",
  Array.isArray(legacy.forbiddenCliches) && legacy.forbiddenCliches.length
    ? `注意避免：${legacy.forbiddenCliches.join("；")}`
    : "",
].filter(Boolean).join("\n\n");

const normalizeLegacySkill = (
  fileName: string,
  legacy: LegacySkillRecord,
  categoryId: string | undefined,
  timestamp: number,
  index: number,
) => {
  const title = clean(legacy.title || legacy.name || fileName.replace(/\.json$/, "")) || "未命名 Skill";
  const content = clean(legacy.content || legacy.description) || fallbackContentFromLegacyFields(legacy);
  const id = clean(legacy.id) || `skill_${timestamp}_${index}`;

  return {
    id,
    title,
    categoryId,
    content: clean(content) || `请在这里补充 ${title} 的 Skill 内容。`,
    source: normalizeSource(legacy),
    createdAt: Number(legacy.createdAt) || timestamp,
    updatedAt: timestamp,
  };
};

const skillToMarkdown = (skill: ReturnType<typeof normalizeLegacySkill>) => `---
id: ${quoted(skill.id)}
title: ${quoted(skill.title)}
${skill.categoryId ? `categoryId: ${quoted(skill.categoryId)}\n` : ""}source: ${skill.source}
createdAt: ${skill.createdAt}
updatedAt: ${skill.updatedAt}
---

${skill.content}
`;

const uniqueFileName = async (skillsDir: string, baseName: string) => {
  let fileName = `${baseName}.md`;
  let counter = 2;
  while (true) {
    try {
      await fs.access(path.join(skillsDir, fileName));
      fileName = `${baseName}_${counter}.md`;
      counter += 1;
    } catch {
      return fileName;
    }
  }
};

const upsertCategory = (
  categories: any[],
  categoryName: string,
  timestamp: number,
  created: string[],
) => {
  if (!categoryName) return undefined;
  const existing = categories.find((item) => clean(item.name).toLowerCase() === categoryName.toLowerCase());
  if (existing?.id) return clean(existing.id);

  const category = {
    id: `cat_${slug(categoryName)}_${timestamp}`,
    name: categoryName,
    sortOrder: categories.length * 10,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  categories.push(category);
  created.push(categoryName);
  return category.id;
};

export const migrateLegacySkillsToUniversal = async (
  options: SkillMigrationOptions = {},
): Promise<SkillMigrationResult> => {
  const skillsDir = path.resolve(options.skillsDir || path.join(process.cwd(), "skills"));
  const timestamp = options.timestamp || Date.now();
  await fs.mkdir(skillsDir, { recursive: true });

  const categoriesPath = path.join(skillsDir, categoryFileName);
  const categories = await readJson<any[]>(categoriesPath, []);
  const existingSkills = await readExistingSkillIndex(skillsDir);
  const result: SkillMigrationResult = {
    skillsDir,
    migrated: [],
    skipped: [],
    deleted: [],
    categoriesCreated: [],
  };

  const jsonFiles = (await fs.readdir(skillsDir)).filter((fileName) =>
    fileName.endsWith(".json") && fileName !== categoryFileName
  );

  for (const [index, fileName] of jsonFiles.entries()) {
    const filePath = path.join(skillsDir, fileName);
    const legacy = await readJson<LegacySkillRecord | undefined>(filePath, undefined);
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
      result.skipped.push(`${fileName}: invalid json`);
      continue;
    }

    const legacyTitle = clean(legacy.title || legacy.name || fileName.replace(/\.json$/, "")) || "未命名 Skill";
    const legacyId = clean(legacy.id) || `skill_${timestamp}_${index}`;
    if (existingSkills.ids.has(legacyId)) {
      result.skipped.push(`${fileName}: skill id already exists`);
      continue;
    }
    if (existingSkills.titles.has(titleKey(legacyTitle))) {
      result.skipped.push(`${fileName}: skill title already exists`);
      continue;
    }

    const categoryId = upsertCategory(categories, normalizeCategoryName(legacy), timestamp, result.categoriesCreated);
    const skill = normalizeLegacySkill(fileName, legacy, categoryId, timestamp, index);
    const outputFileName = await uniqueFileName(skillsDir, `${slug(skill.title)}_${slug(skill.id)}`);
    result.migrated.push(`${fileName} -> ${outputFileName}`);

    if (options.dryRun) continue;

    await fs.writeFile(path.join(skillsDir, outputFileName), skillToMarkdown(skill));
    existingSkills.ids.add(skill.id);
    existingSkills.titles.add(titleKey(skill.title));
    if (options.deleteJson) {
      await fs.unlink(filePath);
      result.deleted.push(fileName);
    }
  }

  if (!options.dryRun && result.categoriesCreated.length) {
    await fs.writeFile(categoriesPath, `${JSON.stringify(categories, null, 2)}\n`);
  }

  return result;
};

const parseCliOptions = (): SkillMigrationOptions => {
  const args = process.argv.slice(2);
  return {
    skillsDir: args.find((arg) => !arg.startsWith("--")) || path.join(process.cwd(), "skills"),
    dryRun: args.includes("--dry-run"),
    deleteJson: args.includes("--delete-json"),
  };
};

const runCli = async () => {
  const result = await migrateLegacySkillsToUniversal(parseCliOptions());
  console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export const createTempSkillMigrationDir = () =>
  fs.mkdtemp(path.join(os.tmpdir(), "universal-skill-migration-"));
