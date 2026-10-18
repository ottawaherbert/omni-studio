/** Stable routing contract. Text remains editable; unclassified text is never executable. */
export const DIRECTOR_FIELDS = {
  dramaticFocus: { label: "戏剧重点", group: "观看与信息", stages: ["planning", "review"] },
  informationReveal: { label: "信息揭示", group: "观看与信息", stages: ["planning", "review"] },
  "performance.physical": { label: "身体表演与反应", group: "表演与调度", stages: ["planning", "video", "image", "review"] },
  "performance.dialogueDelivery": { label: "台词表达", group: "表演与调度", stages: ["planning", "performance", "video", "review"] },
  blocking: { label: "人物位置与调度", group: "表演与调度", stages: ["planning", "video", "image", "review"] },
  "cinematography.framing": { label: "景别、机位与构图", group: "摄影与灯光", stages: ["planning", "image", "video", "review"] },
  "cinematography.movement": { label: "运镜与焦点变化", group: "摄影与灯光", stages: ["planning", "video", "review"] },
  lighting: { label: "灯光的表达用途", group: "摄影与灯光", stages: ["planning", "image", "video", "review"] },
  "productionDesign.characterAppearance": { label: "角色基础外观", group: "美术设计", stages: ["planning", "asset_character", "review"] },
  "productionDesign.locationSpace": { label: "场景空间设计", group: "美术设计", stages: ["planning", "asset_location", "review"] },
  "productionDesign.props": { label: "道具外观设计", group: "美术设计", stages: ["planning", "asset_prop", "review"] },
  "productionDesign.onSetUse": { label: "布景与道具的场内使用", group: "美术设计", stages: ["planning", "review"] },
  actionVfx: { label: "动作、视效与尺度", group: "动作与视效", stages: ["planning", "video", "review"] },
  editing: { label: "剪辑、节奏与时空", group: "剪辑与声音", stages: ["planning", "editing", "review"] },
  "sound.ambience": { label: "环境声音", group: "剪辑与声音", stages: ["planning", "sound", "sfx", "review"] },
  "sound.effects": { label: "动作与事件音效", group: "剪辑与声音", stages: ["planning", "sound", "sfx", "review"] },
  "sound.music": { label: "音乐", group: "剪辑与声音", stages: ["planning", "sound", "music", "review"] },
  "sound.mix": { label: "声音层次、留白与衔接", group: "剪辑与声音", stages: ["planning", "sound", "editing", "review"] },
} as const;
export type DirectorField = keyof typeof DIRECTOR_FIELDS;
export interface DirectorDirections {
  dramaticFocus?: string[];
  informationReveal?: string[];
  performance?: { physical?: string[]; dialogueDelivery?: string[] };
  blocking?: string[];
  cinematography?: { framing?: string[]; movement?: string[] };
  lighting?: string[];
  productionDesign?: { characterAppearance?: string[]; locationSpace?: string[]; props?: string[]; onSetUse?: string[] };
  actionVfx?: string[];
  editing?: string[];
  sound?: { ambience?: string[]; effects?: string[]; music?: string[]; mix?: string[] };
}
export interface DirectorMethod {
  id: string;
  title: string;
  priority: "core" | "supporting";
  when: string;
  purpose: string;
  directions: DirectorDirections;
  exceptions: string[];
  checks: string[];
}
export interface DirectorProfileV2 {
  schemaVersion: "director-profile.v2";
  principles: string[];
  methods: DirectorMethod[];
  /** Kept for author review only, never included in task prompts. */
  unclassified?: string[];
  legacySource?: string;
}
export const directorFields = Object.keys(DIRECTOR_FIELDS) as DirectorField[];
export const isDirectorProfileV2 = (value: unknown): value is DirectorProfileV2 =>
  Boolean(value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === "director-profile.v2");
export const emptyDirectorProfile = (): DirectorProfileV2 => ({ schemaVersion: "director-profile.v2", principles: [], methods: [] });
export function directorFieldValues(directions: DirectorDirections, path: DirectorField): string[] {
  let value: unknown = directions;
  for (const key of path.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];
}
export function setDirectorField(directions: DirectorDirections, path: DirectorField, lines: string[]): DirectorDirections {
  const result = structuredClone(directions) as Record<string, unknown>;
  const [group, key] = path.split(".");
  if (key) {
    const section = { ...(result[group] as Record<string, unknown> || {}) };
    if (lines.length) section[key] = lines; else delete section[key];
    if (Object.keys(section).length) result[group] = section; else delete result[group];
  } else if (lines.length) result[group] = lines; else delete result[group];
  return result as DirectorDirections;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label}含未支持字段：${unknown.join("、")}`);
}
function lines(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some(line => typeof line !== "string" || !line.trim())) throw new Error(`${label}须为非空文字组成的列表`);
}
export function validateDirectorProfile(value: unknown): asserts value is DirectorProfileV2 {
  const profile = object(value, "导演方法");
  keys(profile, ["schemaVersion", "principles", "methods", "unclassified", "legacySource"], "导演方法");
  if (profile.schemaVersion !== "director-profile.v2") throw new Error("不支持的导演方法版本，请先转换旧版");
  lines(profile.principles, "整体原则");
  if (profile.unclassified !== undefined) lines(profile.unclassified, "待整理内容");
  if (profile.legacySource !== undefined && typeof profile.legacySource !== "string") throw new Error("旧版原文须为文字");
  if (!Array.isArray(profile.methods) || !profile.methods.length) throw new Error("请至少添加一条导演方法");
  const ids = new Set<string>();
  for (const [index, raw] of profile.methods.entries()) {
    const label = `方法 ${index + 1}`;
    const method = object(raw, label);
    keys(method, ["id", "title", "priority", "when", "purpose", "directions", "exceptions", "checks"], label);
    for (const field of ["id", "title", "when", "purpose"]) if (typeof method[field] !== "string" || !String(method[field]).trim()) throw new Error(`${label}缺少${({ id: "标识", title: "名称", when: "适用情境", purpose: "表达目的" } as Record<string, string>)[field]}`);
    if (ids.has(String(method.id))) throw new Error(`${label}的标识重复`);
    ids.add(String(method.id));
    if (!["core", "supporting"].includes(String(method.priority))) throw new Error(`${label}须选择核心或辅助方法`);
    lines(method.exceptions, `${label}的例外`); lines(method.checks, `${label}的检查点`);
    const directions = object(method.directions, `${label}的指导`);
    keys(directions, [...new Set(directorFields.map(path => path.split(".")[0]))], label);
    for (const [group, content] of Object.entries(directions)) {
      const nested = directorFields.filter(path => path.startsWith(group + "."));
      if (nested.length) {
        const section = object(content, group);
        keys(section, nested.map(path => path.split(".")[1]), group);
        for (const [key, value] of Object.entries(section)) lines(value, `${group}.${key}`);
      } else lines(content, group);
    }
    if (!directorFields.some(path => directorFieldValues(directions, path).length)) throw new Error(`${label}至少需要一项具体拍摄指导`);
  }
}
export function parseDirectorProfile(raw: string): DirectorProfileV2 {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("返回内容不是有效的导演方法 JSON，原有内容已保留。可修改返回内容后再导入。"); }
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") throw new Error("未生成导演方法：" + value.error);
  validateDirectorProfile(value);
  return value;
}
/** Reading text is derived, so edits cannot desynchronize routing and preview. */
export function directorProfileText(profile: DirectorProfileV2, stage = "planning", forExecution = false): string {
  const whole = stage === "planning" || stage === "review";
  return [whole && profile.principles.length ? `整体原则：${profile.principles.join("；")}` : "", ...profile.methods.flatMap(method => {
    const fields = directorFields.filter(path => (DIRECTOR_FIELDS[path].stages as readonly string[]).includes(stage) && directorFieldValues(method.directions, path).length);
    if (!fields.length) return [];
    return [[`方法 ${forExecution ? method.id + " · " : ""}${method.title}（${method.priority === "core" ? "核心" : "辅助"}）`, `适用情境：${method.when}`, `表达目的：${method.purpose}`,
      ...fields.map(path => `${DIRECTOR_FIELDS[path].label}${forExecution ? " [" + path + "]" : ""}：${directorFieldValues(method.directions, path).join("；")}`),
      method.exceptions.length ? `例外与让位：${method.exceptions.join("；")}` : "",
      whole && method.checks.length ? `检查点：${method.checks.join("；")}` : ""].filter(Boolean).join("\n")];
  })].filter(Boolean).join("\n\n");
}
export const isGeneralSkill = (skill: { kind?: string; profile?: { director?: unknown } }) => (!skill.kind || skill.kind === "general") && !skill.profile?.director;
