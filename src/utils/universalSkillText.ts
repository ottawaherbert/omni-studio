export const skillTitleText = (skill: unknown, fallback = "未命名 Skill") => {
  const record = (skill || {}) as Record<string, unknown>;
  return String(record.title || fallback).trim();
};

export const skillBodyText = (skill: unknown) => {
  const record = (skill || {}) as Record<string, unknown>;
  return String(record.content || "").trim();
};

export const renderUniversalSkillLines = (skills: unknown[] | undefined, separator = "\n") =>
  (skills || [])
    .map((skill, index) => {
      const body = skillBodyText(skill);
      if (!body) return "";
      return `【Skill：${skillTitleText(skill, `Skill ${index + 1}`)}】${separator}${body}`;
    })
    .filter(Boolean)
    .join(separator === "\n" ? "\n\n" : separator);
