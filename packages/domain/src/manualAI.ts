/** The external chat replaces only the model response, never business validation or adoption. */
export type ManualAIKind = "text" | "image" | "video" | "audio";
export interface ManualAIRequest {
  id: string;
  kind: ManualAIKind;
  prompt: string;
  systemInstruction?: string;
  /** Fixed request settings, copied for external use but not editable as prose. */
  context?: string;
  requireJson?: boolean;
  schema?: unknown;
  references?: Array<{ url: string; label: string }>;
  /** True only when the execution caller consumes the reviewed prompt. */
  promptEditable?: boolean;
}
export type ManualAIPromptReview = Pick<ManualAIRequest, "prompt" | "systemInstruction">;

export const normalizeManualAIPromptReview = (request: ManualAIPromptReview & { promptEditable?: boolean }, review?: ManualAIPromptReview): ManualAIPromptReview => {
  if (!review) return { prompt: request.prompt, systemInstruction: request.systemInstruction };
  if (typeof review.prompt !== "string" || !review.prompt.trim()) throw new Error("本步提示词不能为空。");
  if (review.systemInstruction !== undefined && typeof review.systemInstruction !== "string") throw new Error("系统要求必须是文字。");
  const changed = review.prompt !== request.prompt || (review.systemInstruction || "") !== (request.systemInstruction || "");
  if (changed && !request.promptEditable) throw new Error("本步骤尚未接入提示词编辑，已阻止使用未生效的修改。");
  return { prompt: review.prompt, systemInstruction: review.systemInstruction };
};
export interface ManualAIResult {
  kind: ManualAIKind;
  text?: string;
  url?: string;
  fileName?: string;
  sourcePrompt?: string;
  embeddedAudio?: boolean;
}

export const manualAIPromptText = (request: Omit<ManualAIRequest, "id">) => [
  request.context,
  request.systemInstruction,
  request.prompt,
  request.requireJson ? "请返回合法 JSON，保持要求的字段与结构。不要附加解释。" : "",
  request.schema ? `返回结构（JSON Schema）：\n${JSON.stringify(request.schema, null, 2)}` : "",
  request.references?.length ? `请同时附上以下参考素材（复制文字不会上传素材）：\n${request.references.map((item, index) => `${index + 1}. ${item.label}`).join("\n")}` : "",
].filter(Boolean).join("\n\n");

export const hasManualAIResult = (result?: ManualAIResult) => Boolean(result?.kind === "text" ? result.text?.trim() : result?.url);

const checkShape = (value: unknown, rawSchema: unknown, path = "返回值"): void => {
  if (!rawSchema || typeof rawSchema !== "object") return;
  const schema = rawSchema as Record<string, any>;
  const type = String(schema.type || "").toLowerCase();
  if (value === null && schema.nullable) return;
  const valid = !type || (type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value)
    : type === "number" ? typeof value === "number" && Number.isFinite(value) : type === typeof value);
  if (!valid) throw new Error(`${path} 的类型不符合提示词要求（${type}）。`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`${path} 不在允许的选项中。`);
  if (type === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!(key in record)) throw new Error(`${path} 缺少字段 ${key}。`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in record) checkShape(record[key], child, `${path}.${key}`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => checkShape(item, schema.items, `${path}[${index}]`));
};

export const normalizeManualAIResult = (request: Pick<ManualAIRequest, "kind" | "requireJson" | "schema">, result: ManualAIResult): string => {
  if (result.kind !== request.kind) throw new Error("返回内容的类型与本次任务不一致。");
  if (request.kind !== "text") {
    if (!result.url?.startsWith("/media/")) throw new Error("请先上传并保存生成结果文件。");
    return result.url;
  }
  const text = (result.text || "").trim();
  if (!text) throw new Error("请粘贴 AI 返回内容。");
  if (!request.requireJson) return text;
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const json = (fenced?.[1] || text).trim();
  let value: unknown;
  try { value = JSON.parse(json); if (value === null || typeof value !== "object") throw new Error("not structured"); } catch {
    throw new Error("这一步需要 JSON 对象或数组。请按提示词要求重新复制完整结果；不会自动调用接口。");
  }
  checkShape(value, request.schema);
  return JSON.stringify(value);
};
