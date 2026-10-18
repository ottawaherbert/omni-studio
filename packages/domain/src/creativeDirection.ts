import { directorProfileText, isDirectorProfileV2, validateDirectorProfile, type DirectorProfileV2 } from "./directorProfile";
export * from "./directorProfile";
import type { SkillDTO } from "./skill";
import type { ConcreteVisualProductionMode, VisualProductionMode, VisualStyleTreatment } from "./visualStyle";

export type CreativeSkillKind = "general" | "director" | "visual_style";
export const DIRECTOR_DIMENSIONS = {
  viewpoint: "叙事视角与信息揭示",
  drama: "场内戏剧与情绪",
  performance: "表演与人物关系",
  blocking: "场面调度",
  coverage: "镜头体系与覆盖",
  camera: "摄影机、光学与构图",
  movement: "运镜与焦点变化",
  lighting: "灯光的戏剧用途",
  art: "美术与道具的叙事使用",
  action: "动作、特效与动画表演",
  sound: "声音叙事",
  editing: "剪辑、节奏与转场",
  timeSpace: "时空表达",
  continuity: "跨场与跨集一致性",
} as const;
export type DirectorDimension = keyof typeof DIRECTOR_DIMENSIONS;
export const DIRECTOR_EXECUTION_BOUNDARY = "导演方法仅调整当前剧本已有情节的呈现。先核对每条方法的适用条件；条件不存在就跳过，不制造情境来套用风格。不得因此新增笑料、误会、突发事件、情感转折、人物目标、关系或时间回返，不引入参考作品的人物、道具、时代、世界规则或对白，不改变已确认画风、时长和镜头。下列规则与正式剧本冲突时，以正式剧本为准。";
export interface CreativeSkillProfile {
  director?: Partial<Record<DirectorDimension, string>> | DirectorProfileV2;
  visual?: { medium: VisualProductionMode; mediumSelection?: "auto" | "manual"; subjectMedium?: ConcreteVisualProductionMode; backgroundMedium?: ConcreteVisualProductionMode; treatment: Partial<VisualStyleTreatment> };
}
export interface CreativeSkillReference {
  id: string;
  url: string;
  label: string;
  purpose: string;
}
export type CreativeSkillSnapshot = Pick<SkillDTO, "id" | "title" | "content" | "kind" | "revision" | "profile" | "references" | "referenceWork">;
export interface CreativeSkillBinding {
  mode: "inherit" | "replace" | "adjust" | "off";
  /** Direct visual instruction; new visual settings do not reference a Skill. */
  stylePrompt?: string;
  skill?: CreativeSkillSnapshot;
  notes?: string;
  /** Optional dimension borrowing, rather than replacing the whole medium. */
  visualSections?: Array<keyof VisualStyleTreatment>;
}
export interface CreativeDirectionBindings {
  director?: CreativeSkillBinding;
  visual?: CreativeSkillBinding;
  /** Overrides for named subjects in this shot; they never become full-frame style. */
  objects?: Record<string, CreativeSkillBinding>;
}
export interface CreativeStyleVersion {
  id: string;
  title: string;
  binding: CreativeSkillBinding;
  createdAt: number;
  /** Kept separate from story-state variants. */
  referenceImageUrl?: string;
}
export type CreativeStage = "planning" | "image" | "video" | "asset" | "asset_character" | "asset_location" | "asset_prop" | "performance" | "sound" | "music" | "sfx" | "editing" | "review";
export interface CreativeScope {
  label: string;
  bindings?: CreativeDirectionBindings;
}
export interface ResolvedCreativeRole {
  enabled: boolean;
  skill?: CreativeSkillSnapshot;
  notes: string[];
  source: string;
  visualSections?: Array<keyof VisualStyleTreatment>;
}
export const snapshotCreativeSkill = (skill: SkillDTO): CreativeSkillSnapshot => structuredClone({
  id: skill.id, title: skill.title, content: skill.content,
  kind: skill.kind || "general", revision: skill.revision || 1,
  profile: skill.profile, references: skill.references, referenceWork: skill.referenceWork,
});
export function resolveCreativeRole(scopes: CreativeScope[], role: "director" | "visual"): ResolvedCreativeRole {
  let result: ResolvedCreativeRole = { enabled: false, notes: [], source: "未设置" };
  for (const scope of scopes) {
    const binding = scope.bindings?.[role];
    if (!binding || binding.mode === "inherit") continue;
    if (binding.mode === "off") { result = { enabled: false, notes: [], source: scope.label }; continue; }
    if (binding.mode === "replace") result = {
      enabled: true, skill: binding.skill, notes: [], source: scope.label,
      visualSections: binding.visualSections,
    };
    if (binding.mode === "adjust") {
      result = { ...result, enabled: true, source: scope.label };
      if (binding.skill) result.skill = binding.skill;
      if (binding.visualSections) result.visualSections = binding.visualSections;
    }
    if (binding.notes?.trim()) result.notes.push(binding.notes.trim());
    if (role === "visual" && binding.stylePrompt?.trim()) result.notes.push(binding.stylePrompt.trim());
  }
  return result;
}

/** Read legacy snapshots without rewriting the stored project until the author saves. */
export function visualBindingPrompt(binding?: CreativeSkillBinding): string {
  if (binding?.stylePrompt !== undefined) return binding.stylePrompt;
  const text = [binding?.skill?.content, binding?.notes].filter(Boolean).join("\n\n");
  if (!binding?.visualSections?.length) return text;
  const names: Partial<Record<keyof VisualStyleTreatment, string>> = { color: "色彩", palette: "配色", linework: "线条", materials: "材质" };
  return `仅借用${binding.visualSections.map(key => names[key] || key).join("、")}，其余画面表现沿用上级：\n${text}`;
}
export function renderDirectorDirection(role: ResolvedCreativeRole, stage: CreativeStage): string {
  if (!role.enabled) return "";
  const profile = role.skill?.profile?.director;
  const whole = stage === "planning" || stage === "review";
  // Legacy prose and unclassified author notes may inform planning, never a specialist task.
  let rules = "";
  if (isDirectorProfileV2(profile)) {
    try { validateDirectorProfile(profile); rules = directorProfileText(profile, stage, true); } catch { return ""; }
  } else if (whole) {
    rules = profile ? Object.entries(profile).map(([key, value]) => `${DIRECTOR_DIMENSIONS[key as DirectorDimension] || key}：${value}`).join("\n") : role.skill?.content?.trim() || "";
  }
  const notes = whole ? role.notes : [];
  if (!rules && !notes.length) return "";
  return [
    "【当前导演方法：" + (role.skill?.title || "自定义") + "；来源：" + role.source + "】",
    whole && role.skill?.id ? "Skill 标识：" + role.skill.id : "",
    DIRECTOR_EXECUTION_BOUNDARY,
    rules, ...notes.map(note => "作者补充：" + note),
    "仅将适合本任务的导演方法落实为具体决定；保留正式剧情、对白、身份、时长与已确认镜头。不能因导演名称改变画风、音色或添加剧情。",
    stage === "planning" ? "将决定落实到景别、机位、焦距、运镜、构图、调度、动作、表演、时长及声音剪辑说明。未适用的方法不要机械套用。每镜声音设计写入 soundDesign，剪辑理由写入 editingNote；转场 transition 仅选 none（硬切）、fade（叠化）、black（黑场），镜头时长写入 duration。声音进入点可按本次返回合同写入 directing；未提供有效时点的 J/L cut 等建议只留作说明，不宣称已经执行。" : "",
    stage === "image" ? "静帧只表现一个明确时刻；采用已确认机位与动作，不重新编排镜头或把连续运镜画成多重曝光。" : "",
    stage === "video" ? "采用已确认运动、动作起终态与时间顺序；不要重新导演或改写镜头。声音和剪辑建议仅在相应执行能力支持时落实。" : "",
  ].filter(Boolean).join("\n");
}

/** Reject malformed portable metadata instead of accepting silent partial saves. */
export function validateCreativeSkill(skill: Partial<SkillDTO>): void {
  if (skill.analysisBasis !== undefined && !["work_knowledge", "provided_analysis", "author"].includes(skill.analysisBasis)) throw new Error("参考依据类型无效");
  if (skill.analysisNotes !== undefined && typeof skill.analysisNotes !== "string") throw new Error("参考依据必须是文字");
  if (skill.referenceWork) {
    if (typeof skill.referenceWork.title !== "string" || !skill.referenceWork.title.trim()) throw new Error("参考作品名称不能为空");
    for (const value of Object.values(skill.referenceWork)) if (value !== undefined && typeof value !== "string") throw new Error("参考作品信息必须是文字");
  }
  if (skill.kind && !["general", "director", "visual_style"].includes(skill.kind)) throw new Error("未知 Skill 类型");
  if (skill.references && (!Array.isArray(skill.references) || skill.references.length > 8)) throw new Error("参考素材最多 8 项");
  for (const ref of skill.references || []) {
    if (!ref.id || !ref.url || !ref.label || typeof ref.purpose !== "string") throw new Error("参考素材信息不完整");
    if (!/^(\/media\/|https?:\/\/)/.test(ref.url)) throw new Error("请先保存参考图片，再保存 Skill");
  }
  const visual = skill.profile?.visual;
  if (visual?.mediumSelection && !["auto", "manual"].includes(visual.mediumSelection)) throw new Error("画风媒介选择方式无效");
  if (visual && !["live_action", "2d_animation", "3d_animation", "stop_motion", "mixed_media"].includes(visual.medium)) throw new Error("画风媒介无效");
  if (visual) for (const medium of [visual.subjectMedium, visual.backgroundMedium]) {
    if (medium && !["live_action", "2d_animation", "3d_animation", "stop_motion"].includes(medium)) throw new Error("混合画风的主体与背景须指定具体媒介");
  }
  if (visual) for (const value of Object.values(visual.treatment || {})) {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("画风特征必须是文字列表");
  }
  if (isDirectorProfileV2(skill.profile?.director)) validateDirectorProfile(skill.profile.director);
  else if (skill.profile?.director) for (const [key, value] of Object.entries(skill.profile.director)) {
    if (!(key in DIRECTOR_DIMENSIONS) || typeof value !== "string") throw new Error("导演规则格式无效，请转换为结构化方法");
  }
}
