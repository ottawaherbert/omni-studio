import { PlannedAsset, PlannedCharacter } from "../types/project";

const SECTION_BOUNDARY_CHARS = String.raw`(?:^|[\n\r；;。])\s*`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const UNIVERSAL_SECTION_LABELS = [
  "项目名称",
  "项目标题",
  "标题",
  "剧名",
  "片名",
  "项目类型",
  "类型",
  "题材",
  "集数",
  "单集时长",
  "主要角色",
  "核心角色",
  "人物",
  "角色",
  "关键场景",
  "核心场景",
  "场景",
  "关键道具",
  "核心道具",
  "道具",
  "测试验收重点",
  "测试验收",
  "验收重点",
  "验收要求",
  "测试要求",
  "短剧要求",
  "第一季目标",
  "最终要求",
];

const ACCEPTANCE_TEXT_PATTERN =
  /(?:测试|验收|要求|必须|总时长|镜头语言|集与集|连续|人物动机|项目类型|短剧要求|第一季目标|分镜|分钟|最终)/;

export const splitOutsideParentheses = (value: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "（" || char === "(") depth += 1;
    if (char === "）" || char === ")") depth = Math.max(0, depth - 1);

    if (depth === 0 && /[、,，；;\n\r]/.test(char)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
};

export const cleanExplicitName = (value: string): string =>
  value
    .trim()
    .replace(/^[-*•\d.、\s]+/, "")
    .replace(/[。.!！]$/, "")
    .trim();

const sectionLabelPattern = (labels: string[]): RegExp =>
  new RegExp(`${SECTION_BOUNDARY_CHARS}(?:${labels.map(escapeRegExp).join("|")})\\s*[：:]`, "g");

const extractLabeledSection = (source: string, labels: string[]): string => {
  const startPattern = sectionLabelPattern(labels);
  const startMatch = startPattern.exec(source);
  if (!startMatch) return "";

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = source.slice(contentStart);
  const stopPattern = sectionLabelPattern(UNIVERSAL_SECTION_LABELS);
  const stopMatch = stopPattern.exec(remainder);

  return (stopMatch ? remainder.slice(0, stopMatch.index) : remainder).trim();
};

const projectSource = (project: any | null): string =>
  `${project?.originalInspiration || ""}\n${project?.refinedInspiration || ""}`;

const parseNameAndBrief = (item: string): { name: string; brief?: string } | null => {
  const cleaned = cleanExplicitName(item);
  if (!cleaned) return null;

  const match = cleaned.match(/^([^（(]+)(?:[（(]([^）)]*)[）)])?/);
  const name = match?.[1] ? cleanExplicitName(match[1]) : "";
  if (!name) return null;

  return {
    name,
    brief: match?.[2]?.trim() || undefined,
  };
};

export const looksLikeSectionOrAcceptanceText = (value: string): boolean => {
  const cleaned = cleanExplicitName(value);
  if (!cleaned) return true;
  return ACCEPTANCE_TEXT_PATTERN.test(cleaned);
};

export const extractRequiredNamedCharacters = (project: any | null): PlannedCharacter[] => {
  const section = extractLabeledSection(projectSource(project), ["主要角色", "核心角色", "人物", "角色"]);
  if (!section) return [];

  return splitOutsideParentheses(section)
    .map(parseNameAndBrief)
    .filter((item): item is { name: string; brief?: string } => Boolean(item))
    .filter((item) => !looksLikeSectionOrAcceptanceText(item.name))
    .map((item) => ({
      id: `required_${item.name}`,
      name: item.name,
      roleType: "lead",
      brief: item.brief || "用户原始输入中明确点名的核心角色，必须纳入角色阵容并保持跨集连续。",
      isDetailed: false,
    }));
};

export const extractRequiredNamedItems = (
  project: any | null,
  labels: string[],
  type: "location" | "prop",
  fallbackBrief: string,
): PlannedAsset[] => {
  const section = extractLabeledSection(projectSource(project), labels);
  if (!section) return [];

  return splitOutsideParentheses(section)
    .map(parseNameAndBrief)
    .filter((item): item is { name: string; brief?: string } => Boolean(item))
    .filter((item) => !looksLikeSectionOrAcceptanceText(item.name))
    .map((item) => ({
      id: `${type}_required_${item.name}`,
      name: item.name,
      type,
      brief: item.brief || fallbackBrief,
      isDetailed: false,
    }));
};

export const mergeRequiredPlannedItems = <T extends { id: string; name: string; brief?: string; isDetailed?: boolean }>(
  plannedItems: T[],
  requiredItems: T[],
): T[] => {
  const existingNames = new Set(plannedItems.map((item) => cleanExplicitName(item.name)));
  const missingRequired = requiredItems
    .filter((item) => !existingNames.has(cleanExplicitName(item.name)))
    .map((item) => ({
      ...item,
      id: `${item.id}_${Date.now()}${Math.random().toString(36).substring(2, 6)}`,
    }));

  return [...missingRequired, ...plannedItems];
};

export const filterMissingPlannedItems = <T extends { name: string }>(
  existingItems: T[],
  incomingItems: T[],
): T[] => {
  const existingNames = new Set(existingItems.map((item) => cleanExplicitName(item.name)));
  return incomingItems.filter((item) => !existingNames.has(cleanExplicitName(item.name)));
};

export const mergeRequiredPlannedCharacters = (
  plannedCharacters: PlannedCharacter[],
  requiredCharacters: PlannedCharacter[],
): PlannedCharacter[] => {
  const existingNames = new Set(plannedCharacters.map((character) => cleanExplicitName(character.name)));
  const missingRequired = requiredCharacters
    .filter((character) => !existingNames.has(cleanExplicitName(character.name)))
    .map((character) => ({
      ...character,
      id: `char_${Date.now()}${Math.random().toString(36).substring(2, 6)}`,
    }));

  return [...missingRequired, ...plannedCharacters];
};
