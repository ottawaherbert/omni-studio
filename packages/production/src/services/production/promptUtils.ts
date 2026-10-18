export const renderPromptTemplate = (
  template: string,
  variables: Record<string, string | number | undefined>,
) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });

export const extractPromptTemplateVariables = (template: string) =>
  Array.from(new Set(
    Array.from(template.matchAll(/\{\{(\w+)\}\}/g)).map((match) => match[1]),
  ));

export const compactJson = (value: unknown) => JSON.stringify(value, null, 2);

export const estimateTokens = (text: string) => Math.ceil(text.length / 3.8);

export const truncateForStorage = (text: string | undefined, maxChars = 12000) => {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  return [
    text.slice(0, headLength),
    `\n\n[... trimmed ${text.length - maxChars} chars for localStorage safety ...]\n\n`,
    text.slice(text.length - tailLength),
  ].join("");
};

export const summarizeForCheckpoint = (value: unknown, maxChars = 12000) => {
  if (typeof value === "string") return truncateForStorage(value, maxChars);
  try {
    return JSON.parse(truncateForStorage(JSON.stringify(value), maxChars) || "null");
  } catch {
    return truncateForStorage(String(value), maxChars);
  }
};
