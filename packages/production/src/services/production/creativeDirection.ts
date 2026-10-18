import { sha256 } from "js-sha256";
import type { Episode, EpisodeMeta, Project, Scene, Shot, VisualStyleLock } from "../../../../../src/types/project";
import type { CreativeDirectionBindings, CreativeScope, CreativeSkillBinding, CreativeStage } from "../../../../domain/src/creativeDirection";
import { resolveCreativeRole, renderDirectorDirection, visualBindingPrompt } from "../../../../domain/src/creativeDirection";
import type { VisualImplementationMedium, VisualStyleTreatment } from "../../../../domain/src/visualStyle";
import { createNeutralVisualImplementation } from "./visualMediumProfiles";
import { createEmptyVisualStyleTreatment, visualStyleContentHash } from "./visualStyleMigration";
import { productionCreativeScopes, type ProductionCreativeScope } from "./creativeScopes";
import { directorShotInstruction, directorPlanStatus } from "./directorPlan";
export { productionCreativeScopes, type ProductionCreativeScope } from "./creativeScopes";
function styleImplementation(medium: VisualImplementationMedium["productionMode"], text: string): VisualImplementationMedium {
  const implementation = createNeutralVisualImplementation(medium);
  implementation.appearance = {
    ...implementation.appearance,
    realism: medium === "live_action" ? "naturalistic" : "stylized",
    finish: medium === "live_action" ? "clean" : "painterly",
    descriptors: [text],
  };
  // Explicit neutral policies defer shot-specific choices to the director.
  const specification = implementation.specification as unknown as Record<string, unknown>;
  for (const key of Object.keys(specification)) {
    if (Array.isArray(specification[key])) specification[key] = ["遵循选定视觉特征、正式身份与已确认镜头；未特别指定的细节保持一致。"];
  }
  if (specification.captureProcess === "unspecified") specification.captureProcess = "digital";
  if (specification.animationMethod === "unspecified") specification.animationMethod = "hand_drawn";
  return implementation;
}
export function applyCreativeVisualBinding(base: VisualStyleLock | undefined, binding: CreativeSkillBinding | undefined): VisualStyleLock | undefined {
  if (!binding || binding.mode === "inherit") return base;
  if (binding.mode === "off") return undefined;
  // A legacy local override must remain effective after the project switches to text.
  if (base?.stylePrompt !== undefined && binding.stylePrompt === undefined) {
    const text = visualBindingPrompt(binding);
    return text ? applyCreativeVisualBinding(base, { mode: binding.mode, stylePrompt: text }) : base;
  }
  if (binding.stylePrompt !== undefined) {
    const previous = base?.stylePrompt || base?.treatment?.directives?.join("\n") || "";
    const text = binding.mode === "adjust" ? [previous, binding.stylePrompt.trim()].filter(Boolean).join("\n") : binding.stylePrompt.trim();
    const lock: VisualStyleLock = {
      schemaVersion: "visual-style-lock.v3", revision: (base?.revision || 0) + 1,
      stylePrompt: text,
      visualImplementation: createNeutralVisualImplementation("live_action"),
      treatment: { ...createEmptyVisualStyleTreatment(), directives: [text] }, mediumAssignments: [],
      humanApprovalState: "approved", source: "manual",
      sourceReview: { status: "current", changedFields: [], detectedAt: 0 },
    };
    lock.contentHash = visualStyleContentHash(lock);
    return lock;
  }
  const visual = binding.skill?.profile?.visual;
  if (!visual && !binding.notes?.trim() && !binding.skill?.content) return base;
  const borrow = Boolean(binding.visualSections?.length);
  const replace = binding.mode === "replace" && !borrow;
  const text = [binding.skill?.profile?.visual?.treatment.directives?.join("；") || binding.skill?.content, binding.notes].filter(Boolean).join("；") || "按项目自定义画风呈现";
  const treatment: VisualStyleTreatment = replace ? createEmptyVisualStyleTreatment() : { ...createEmptyVisualStyleTreatment(), ...structuredClone(base?.treatment || {}) };
  for (const [key, value] of Object.entries(visual?.treatment || {})) {
    if (!borrow || binding.visualSections!.includes(key as keyof VisualStyleTreatment)) treatment[key as keyof VisualStyleTreatment] = [...value];
  }
  // Plain-text Skills can lend one visual dimension without requiring extracted fields.
  if (borrow && binding.skill?.content && !binding.visualSections!.some(key => visual?.treatment[key]?.length)) {
    const labels: Partial<Record<keyof VisualStyleTreatment, string>> = { color: "色彩", palette: "配色", linework: "线条", materials: "材质" };
    const instruction = `仅从以下参考文字借用${binding.visualSections!.map(key => labels[key] || key).join("、")}，忽略其中其他维度及媒介要求，保持当前画面表现：${binding.skill.content}`;
    for (const key of binding.visualSections!) treatment[key] = [instruction];
  }
  if (!borrow) treatment.directives = Array.from(new Set([...treatment.directives, text]));
  if (binding.notes?.trim()) treatment.directives.push(binding.notes.trim());
  const defaults: Partial<VisualStyleTreatment> = {
    color: ["保留身份配色，在选定画风下统一色彩关系。"],
    palette: ["按画风与既有身份配色。"],
    lighting: ["光向和可见性采用已确认镜头，资产参考保持清楚照明。"],
    camera: ["遵循已确认机位、透视与焦点。"],
    movement: ["遵循导演的动作与运动方案，不由画风改写时长。"],
    composition: ["保留已确认构图和身份，画风不改变站位。"],
    materials: ["保留身份材质，以选定媒介一致呈现。"],
    linework: ["轮廓系统遵循选定媒介，保持身份可读。"],
    readability: ["身份、动作与空间关系清楚。"],
    constraints: ["不改变正式剧情、台词、身份与已确认镜头。"],
  };
  for (const [key, value] of Object.entries(defaults)) if (!treatment[key as keyof VisualStyleTreatment].length) treatment[key as keyof VisualStyleTreatment] = value;
  const medium = visual?.medium;
  const implementation = medium && !borrow ? styleImplementation(medium, text) : base?.visualImplementation || styleImplementation("live_action", text);
  const lock: VisualStyleLock = {
    ...(!replace ? base : {}),
    schemaVersion: "visual-style-lock.v3",
    revision: (base?.revision || 0) + 1,
    visualImplementation: implementation,
    treatment,
    mediumAssignments: !replace ? structuredClone(base?.mediumAssignments || []) : [],
    humanApprovalState: "approved", source: "manual",
    sourceReview: { status: "current", changedFields: [], detectedAt: 0 },
    styleSourceRefs: binding.skill?.references?.map(ref => ref.id) || base?.styleSourceRefs || [],
  };
  // A full-frame mixed preset gets a concrete base layer; object assignments can refine it.
  if (implementation.productionMode === "mixed_media" && !lock.mediumAssignments?.length) {
    lock.mediumAssignments = [{ id: "creative-base", compositingRole: "base", target: { scope: "whole" }, implementation: styleImplementation(visual?.backgroundMedium || "live_action", text + "；作为背景与未指定对象的默认媒介；单独指定的对象采用自己的媒介。") as Exclude<VisualImplementationMedium, { productionMode: "mixed_media" }> }];
  }
  lock.contentHash = visualStyleContentHash(lock);
  return lock;
}
export function resolveProductionCreativeVisual(project: Partial<Project>, scope: ProductionCreativeScope = {}): VisualStyleLock | undefined {
  let lock = project.visualStyleLock?.humanApprovalState === "rejected" || project.creativeDirection?.visual?.mode === "off" ? undefined : project.visualStyleLock;
  // Root visual binding is materialized into visualStyleLock on save, so Bible and production have one source.
  const scopes = productionCreativeScopes(project, scope).slice(1);
  for (const current of scopes) lock = applyCreativeVisualBinding(lock, current.bindings?.visual);
  if (!scope.shot) return lock;
  const shot = scope.shot;
  const ids = new Set([...(shot.characterIdsInShot || []), ...(shot.propIds || []), shot.locationId].filter(Boolean));
  const promptObjects = lock?.stylePrompt !== undefined || [...ids].some(id => {
    const owner = [...(project.characters || []), ...(project.assets || [])].find(item => item.id === id);
    return [owner?.creativeDirection?.visual, shot.creativeDirection?.objects?.[id!], scope.request?.objects?.[id!]]
      .some(binding => binding && binding.mode !== "inherit" && binding.mode !== "off" && binding.stylePrompt !== undefined);
  });
  const assignments = [];
  for (const id of ids) {
    const owner = project.characters?.find(item => item.id === id) || project.assets?.find(item => item.id === id);
    const objectBindings = [owner?.creativeDirection?.visual, shot.creativeDirection?.objects?.[id!], scope.request?.objects?.[id!]].filter((item): item is CreativeSkillBinding => Boolean(item && item.mode !== "inherit"));
    const binding = objectBindings[objectBindings.length - 1];
    if (!binding || binding.mode === "off") continue;
    if (promptObjects) {
      let objectPrompt = "";
      for (const item of objectBindings) {
        if (item.mode === "off") objectPrompt = "";
        else if (item.mode === "replace") objectPrompt = visualBindingPrompt(item);
        else objectPrompt = [objectPrompt, visualBindingPrompt(item)].filter(Boolean).join("\n");
      }
      const basePrompt = lock?.stylePrompt || lock?.treatment.directives.join("\n") || "保持当前画面风格";
      lock = applyCreativeVisualBinding(lock, { mode: "replace", stylePrompt: `${basePrompt}\n【仅作用于${owner?.name || id}】\n${objectPrompt}\n其他对象保持其各自风格，统一透视、接触与遮挡。` });
      continue;
    }
    let objectLock = lock;
    for (const objectBinding of objectBindings) objectLock = applyCreativeVisualBinding(objectLock, objectBinding);
    const objectImplementation = objectLock?.visualImplementation;
    const implementation = objectImplementation?.productionMode === "mixed_media" ? styleImplementation(binding.skill?.profile?.visual?.subjectMedium || "2d_animation", [objectImplementation.appearance.descriptors.join("；"), ...(objectLock?.treatment?.directives || [])].join("；")) : objectImplementation ? structuredClone(objectImplementation) : undefined;
    if (implementation && binding.visualSections?.length) implementation.appearance.descriptors = [...implementation.appearance.descriptors, ...binding.visualSections.flatMap(key => objectLock?.treatment[key] || []), binding.notes || ""].filter(Boolean);
    if (!implementation || implementation.productionMode === "mixed_media") continue;
    const entityType = project.characters?.some(item => item.id === id) ? "character" as const : project.assets?.find(item => item.id === id)?.type;
    if (!entityType || entityType === "sfx" || entityType === "bgm") continue;
    assignments.push({ id: "creative-object-" + id, target: { scope: "entity" as const, entityId: id!, entityType }, implementation, compositingRole: "embedded" as const, priority: 100 });
  }
  if (assignments.length) {
    const original = lock?.visualImplementation || styleImplementation("live_action", "使用项目原有影像实现方式。");
    lock = { ...lock, schemaVersion: "visual-style-lock.v3", revision: lock?.revision || 1, treatment: lock?.treatment || createEmptyVisualStyleTreatment(),
      visualImplementation: styleImplementation("mixed_media", "各对象保持指定媒介，统一透视、光向、接触与遮挡。"),
      mediumAssignments: [
        ...(original.productionMode === "mixed_media" ? lock?.mediumAssignments || [] : [{ id: "creative-whole", compositingRole: "base" as const, target: { scope: "whole" as const }, implementation: original }]),
        ...assignments,
      ],
      source: "manual", humanApprovalState: "approved", sourceReview: { status: "current", changedFields: [], detectedAt: 0 },
    };
    lock.contentHash = visualStyleContentHash(lock);
  }
  return lock;
}
export function renderProductionCreativeContext(project: Partial<Project>, scope: ProductionCreativeScope = {}, stage: CreativeStage = "planning", includeVisual = true): string {
  const scopes = productionCreativeScopes(project, scope);
  const role = resolveCreativeRole(scopes, "director");
  const plan = scope.scene?.manualStoryboard?.directorPlan;
  const execution = ["image", "video", "performance", "sound", "music", "sfx", "editing"].includes(stage);
  const adopted = scope.shot && plan && scope.shot.directing?.planId === plan.id ? plan : undefined;
  const director = execution && scope.shot
    ? adopted
      ? directorShotInstruction(scope.shot, stage, scope.shot.directing?.skillTitle || adopted.skillTitle, scope.dialogueLineIndex)
      : directorShotInstruction(scope.shot, stage, "当前镜头", scope.dialogueLineIndex)
    : execution ? "" : renderDirectorDirection(role, stage);
  const visual = includeVisual ? resolveProductionCreativeVisual(project, scope) : undefined;
  const visualText = !["sound", "music", "sfx", "performance", "editing"].includes(stage) && visual?.humanApprovalState !== "rejected"
    ? [visual?.visualImplementation?.appearance.descriptors.join("；"), ...(visual?.treatment?.directives || [])].filter(Boolean).join("\n") : "";
  const perShot = !scope.shot && scope.scene?.shots?.some(shot => execution || shot.creativeDirection || [...(project.characters || []), ...(project.assets || [])].some(owner => owner.creativeDirection?.visual && [...(shot.characterIdsInShot || []), ...(shot.propIds || []), shot.locationId].includes(owner.id)))
    ? scope.scene.shots.map(shot => "镜头 " + shot.id + " 局部设置：\n" + renderProductionCreativeContext(project, { ...scope, shot }, stage, includeVisual)).join("\n\n") : "";
  const objectText = visual?.mediumAssignments?.filter(item => item.target.scope === "entity" && (!scope.shot || [...(scope.shot.characterIdsInShot || []), ...(scope.shot.propIds || []), scope.shot.locationId].includes(item.target.entityId))).map(item => {
    if (item.target.scope !== "entity") return "";
    const targetId = item.target.entityId;
    const name = [...(project.characters || []), ...(project.assets || [])].find(owner => owner.id === targetId)?.name || "指定对象";
    return name + "：" + item.implementation.appearance.descriptors.join("；");
  }).join("\n");
  return [director, ["video", "planning"].includes(stage) && scope.shot?.soundDesign ? "声音设计：" + scope.shot.soundDesign : "", stage === "planning" && scope.shot?.editingNote ? "剪辑说明：" + scope.shot.editingNote : "", !["sound", "music", "sfx", "performance", "editing"].includes(stage) && objectText ? "【对象画风，仅作用于列出的对象】\n" + objectText : "", visualText ? "【当前画风】\n" + visualText : "", perShot].filter(Boolean).join("\n\n");
}

/** Carry source images as typed media, never as URLs embedded in prompt text. */
export function creativeStyleReferences(project: Partial<Project>, scope: ProductionCreativeScope = {}) {
  const collect = (bindings: Array<CreativeSkillBinding | undefined>) => {
    let refs: NonNullable<CreativeSkillBinding['skill']>['references'] = [];
    for (const binding of bindings) {
      if (!binding || binding.mode === 'inherit') continue;
      if (binding.mode === 'off' || binding.mode === 'replace') refs = [];
      if (binding.mode !== 'off') refs.push(...(binding.skill?.references || []));
    }
    return refs;
  };
  const wrap = (refs: ReturnType<typeof collect>, target: string) => refs.map(ref => ({
    imageUrl: ref.url, label: `${target}画风：${ref.label}`, role: 'style_reference' as const,
    preserve: [`仅对${target}借用视觉特征：${ref.purpose}`],
    allowChange: ['主体身份、剧情、动作、构图、机位采用当前任务。'],
    exclude: ['不得复制参考图的人物身份、文字、水印或具体构图；不得把局部画风扩散到其他对象。'],
  }));
  const result = !scope.shot && scope.scene?.shots?.length
    ? scope.scene.shots.flatMap((shot, index) => creativeStyleReferences(project, { ...scope, shot }).map(ref => ({ ...ref, label: `本单元第 ${index + 1} 镜：${ref.label}`, preserve: ref.preserve.map(rule => `仅本单元第 ${index + 1} 镜：${rule}`) })))
    : wrap(collect(productionCreativeScopes(project, scope).map(item => item.bindings?.visual)), '整体');
  if (scope.shot) {
    const ids = new Set([...(scope.shot.characterIdsInShot || []), ...(scope.shot.propIds || []), scope.shot.locationId].filter(Boolean));
    for (const id of ids) {
      const owner = [...(project.characters || []), ...(project.assets || [])].find(item => item.id === id);
      result.push(...wrap(collect([owner?.creativeDirection?.visual, scope.shot.creativeDirection?.objects?.[id!], scope.request?.objects?.[id!]]), owner?.name || '指定对象'));
    }
  }
  // One media attachment can carry multiple explicit object responsibilities.
  return Array.from(new Set(result.map(ref => ref.imageUrl))).map(url => {
    const matches = result.filter(ref => ref.imageUrl === url);
    return { ...matches[0], label: matches.map(ref => ref.label).join('；'), preserve: matches.flatMap(ref => ref.preserve) };
  });
}

/** Generation captures this digest; edits while a request runs require review. */
export function creativeExecutionManifest(project: Partial<Project>, scope: ProductionCreativeScope = {}, stage: CreativeStage = "planning") {
  const scopes = productionCreativeScopes(project, scope);
  const refs = creativeStyleReferences(project, scope);
  const direction = resolveCreativeRole(scopes, "director");
  const plan = scope.scene?.manualStoryboard?.directorPlan;
  if (!plan && !scope.shot?.directing && !scopes.some(item => item.bindings?.director || item.bindings?.visual || Object.keys(item.bindings?.objects || {}).length) && !refs.length && !scope.scene?.shots?.some(item => item.creativeDirection || item.directing)) return undefined;
  const adopted = scope.shot && plan && scope.shot.directing?.planId === plan.id && stage !== "planning" ? plan : undefined;
  // Hash effective instructions. A shadowed ancestor or a newly selected director
  // must not relabel unchanged, already adopted shot decisions as new production.
  const sourceHash = sha256(JSON.stringify({ direction: renderProductionCreativeContext(project, scope, stage), refs, ...(adopted ? { directorPlanId: adopted.id } : {}) }));
  return { sourceHash, directorSkillId: adopted ? scope.shot?.directing?.skillId || adopted.skillId : direction.skill?.id, directorRevision: adopted ? scope.shot?.directing?.skillRevision ?? adopted.skillRevision : direction.skill?.revision, sources: scopes.filter(item => item.bindings).map(item => item.label),
    ...(plan ? { directorPlanId: plan.id, directorPlanStatus: directorPlanStatus(project, scope), appliedMethods: plan.applications.filter(item => !scope.shot || item.shotIds.includes(scope.shot.id)).map(item => item.method), execution: "instructions" as const } : {}),
  };
}

/** Project our own planning envelope for media QA/repair, preserving author text and factual evidence. */
export function projectDirectorMediaContext(context: string, project: Partial<Project>, scope: ProductionCreativeScope, stage: "image" | "video") {
  try {
    const value = JSON.parse(context);
    if (!value || Array.isArray(value) || !value.currentScene || typeof value.sourcePolicy !== "string") return context;
    const { historicalPlans: _history, directingAcrossScenes: _rhythm, ...facts } = value;
    return JSON.stringify({ ...facts,
      sourcePolicy: value.sourcePolicy + " 当前任务执行已采用镜头；不得重新选择导演方法、增删镜头或改变已定调度。",
      creativeDirection: renderProductionCreativeContext(project, scope, stage),
    }, null, 2);
  } catch { return context; }
}

export function hasShotVisualDirection(project: Partial<Project>, shot: Shot): boolean {
  const ids = new Set([...(shot.characterIdsInShot || []), ...(shot.propIds || []), shot.locationId]);
  return Boolean(shot.visualOverride || shot.creativeDirection?.visual || Object.keys(shot.creativeDirection?.objects || {}).length || [...(project.characters || []), ...(project.assets || [])].some(owner => ids.has(owner.id) && owner.creativeDirection?.visual));
}
