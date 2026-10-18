import { sha256 } from "js-sha256";
import type {
  Episode,
  ManualFilmTeamDepartment,
  ManualFilmTeamOutput,
  ManualFilmTeamQA,
  ManualFilmTeamScenePlan,
  ManualFilmTeamWorkspace,
  Project,
  Scene,
} from "../../types/project";
import {
  productionFullScriptText,
  productionSourceDocumentForEpisode,
} from "./productionSourceDocuments";

export interface ManualFilmTeamDepartmentSpec {
  id: ManualFilmTeamDepartment;
  name: string;
  shortName: string;
  responsibility: string;
  task: string;
}

export const MANUAL_FILM_TEAM_DEPARTMENTS: ManualFilmTeamDepartmentSpec[] = [
  { id: "directing", name: "导演组", shortName: "导演", responsibility: "戏剧目标、场面调度、镜头表达与创意取舍", task: "先建立本集或本段的导演策略，再逐场明确观众应看见和感受到什么、场面调度重点与下游创作边界。" },
  { id: "production_coordination", name: "制片统筹", shortName: "统筹", responsibility: "拍摄需求、部门依赖、风险、资源与流转准备度", task: "汇总本集或本段的拍摄需求、跨场依赖、执行风险和待确认事项，指出进入资产与分镜前必须解决的问题。" },
  { id: "cinematography", name: "摄影组", shortName: "摄影", responsibility: "景别、机位、焦段、运动、构图、轴线与覆盖", task: "建立本集或本段统一的摄影语言，并逐场给出覆盖策略、轴线、运动原则和衔接约束。" },
  { id: "lighting", name: "灯光组", shortName: "灯光", responsibility: "光源逻辑、情绪光、时段与跨镜连续性", task: "建立本集或本段的光源和情绪变化逻辑，逐场说明主辅光、实景光源、负面约束及跨场连续性。" },
  { id: "production_design", name: "美术组", shortName: "美术", responsibility: "空间、置景、材质、色彩、年代和可拍区域", task: "统筹本集或本段的空间、置景和视觉母题，逐场指出可复用资产、状态变化与必须新增的制作内容。" },
  { id: "wardrobe", name: "服装组", shortName: "服装", responsibility: "角色服装、层次、污损、血迹与换装连续性", task: "沿人物剧情时点规划本集或本段服装状态和换装连续性，并落实到每个场次的可见状态变体。" },
  { id: "makeup_hair", name: "化妆组", shortName: "化妆", responsibility: "妆发、伤妆、汗水、泪痕、年龄和状态连续性", task: "沿人物状态变化规划本集或本段妆发和身体状态，并逐场指出特写参考及前后衔接要求。" },
  { id: "performance_directing", name: "表演指导", shortName: "表演", responsibility: "目标、潜台词、动作、微表情、对白和情绪递进", task: "先梳理本集或本段的角色表演弧线，再逐场拆解可见动作、潜台词、情绪变化和衔接。" },
  { id: "action_choreography", name: "动作组", shortName: "动作", responsibility: "打斗、追逐、危险动作、空间与道具交互", task: "统筹本集或本段动作内容的因果、空间、衔接与安全风险；无动作的场次也要明确无需介入。" },
  { id: "props", name: "道具组", shortName: "道具", responsibility: "道具身份、归属、状态、使用动作和连续性", task: "建立本集或本段关键道具的持有、使用和状态流转，再逐场落实进出场和动作要求。" },
  { id: "continuity", name: "场记/连续性", shortName: "场记", responsibility: "人物、服化、道具、空间、时间、动作、轴线连续性", task: "建立覆盖本集或本段全部正式场次的连续性矩阵，明确每场入场、出场和前后场匹配点。" },
  { id: "sound_music", name: "声音/音乐", shortName: "声音", responsibility: "对白、环境声、音效、静默、音乐动机与进出点", task: "规划本集或本段声音叙事和音乐动机，再逐场落实环境层次、关键音效、静默和进出点。" },
];

/**
 * Selects the departments that must contribute to the current scene from its
 * structured breakdown. The result is intentionally data-driven: adding a
 * prop, VFX requirement, or sound cue changes the required team without any
 * project- or genre-specific branching.
 */
export const manualFilmTeamRequiredDepartmentsForScene = (
  scene: Scene,
): ManualFilmTeamDepartment[] => {
  const breakdown = scene.breakdown;
  if (!breakdown) return ["directing"];

  const departments = new Set<ManualFilmTeamDepartment>([
    "directing",
    "production_coordination",
    "continuity",
  ]);
  if (breakdown.characters?.length) {
    departments.add("performance_directing");
    departments.add("wardrobe");
    departments.add("makeup_hair");
  }
  if (breakdown.location || breakdown.setting) {
    departments.add("cinematography");
    departments.add("lighting");
    departments.add("production_design");
  }
  if (breakdown.props?.length || breakdown.vehicles?.length || breakdown.specialEquipment?.length) {
    departments.add("props");
  }
  if (breakdown.sfx?.length || breakdown.bgm?.length) departments.add("sound_music");
  const actionEvidence = JSON.stringify({
    title: scene.title,
    description: scene.description,
    script: scene.script,
    scriptBlocks: scene.scriptBlocks,
    characters: breakdown.characters,
    props: breakdown.props,
    vehicles: breakdown.vehicles,
    specialEquipment: breakdown.specialEquipment,
    vfx: breakdown.vfx,
    shots: (scene.shots || []).map((shot) => ({
      visualAction: shot.visualAction,
      blocking: shot.blocking,
      motivation: shot.motivation,
    })),
  });
  if (
    breakdown.vfx?.length
    || /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|stunt|chase|run|rush|fall|jump|throw|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|爆发|法术|仙术|追逐|奔跑|冲入|冲出|冲向|冲刺|跑向|跑出|跑过|跌倒|跌落|跳下|跃起|摔倒|危险|特技|物理对抗|推搡/iu.test(actionEvidence)
  ) departments.add("action_choreography");

  return MANUAL_FILM_TEAM_DEPARTMENTS
    .filter((department) => departments.has(department.id))
    .map((department) => department.id);
};

export const MANUAL_FILM_TEAM_DEPARTMENT_GROUPS: Array<{ name: string; departments: ManualFilmTeamDepartment[] }> = [
  { name: "导演与表演", departments: ["directing", "performance_directing", "action_choreography"] },
  { name: "画面设计", departments: ["cinematography", "lighting"] },
  { name: "美术与造型", departments: ["production_design", "wardrobe", "makeup_hair", "props"] },
  { name: "制片与连续性", departments: ["production_coordination", "continuity"] },
  { name: "声音", departments: ["sound_music"] },
];

export const manualFilmTeamDepartment = (id: ManualFilmTeamDepartment) =>
  MANUAL_FILM_TEAM_DEPARTMENTS.find((department) => department.id === id) || MANUAL_FILM_TEAM_DEPARTMENTS[0];

export const MANUAL_FILM_TEAM_MIN_PASS_SCORE = 85;

export const projectManualFilmTeamRepairQa = (qa?: ManualFilmTeamQA) => qa ? ({
  summary: qa.summary,
  issues: qa.issues
    .filter((issue) => issue.severity !== "advisory")
    .map((issue) => ({
      severity: issue.severity,
      sceneId: issue.sceneId,
      description: issue.description,
      suggestion: issue.suggestion,
      outputEvidenceId: issue.outputEvidenceId,
      sourceEvidence: issue.sourceEvidence,
    })),
}) : undefined;

export const manualFilmTeamDefaultContextIds = (_defaultIds: string[]) => [];

export const manualFilmTeamScriptHash = (script: string) => sha256(script || "");

export const manualFilmTeamSceneSource = (scene: Scene) => {
  const blockText = (scene.scriptBlocks || []).map((block) => block.content.trim()).filter(Boolean).join("\n");
  if (blockText) return { text: blockText, source: "script_blocks" as const };
  if (scene.script?.trim()) return { text: scene.script.trim(), source: "script" as const };
  return { text: scene.description?.trim() || "", source: "scene_description" as const };
};

export const manualFilmTeamUnitScenes = (episode: Episode) => episode.scenes
  .filter((scene) => Boolean(manualFilmTeamSceneSource(scene).text.trim()));

export const manualFilmTeamUnitSource = (project: Project, episode: Episode) => {
  const sourceDocument = productionSourceDocumentForEpisode(project, episode);
  if (sourceDocument?.content.trim()) {
    return {
      title: sourceDocument.title,
      text: sourceDocument.content.trim(),
      sourceDocumentId: sourceDocument.id,
      source: "production_source_document" as const,
    };
  }
  const text = manualFilmTeamUnitScenes(episode)
    .map((scene, index) => `【场次 ${index + 1} · ${scene.title}】\n${manualFilmTeamSceneSource(scene).text}`)
    .join("\n\n");
  return {
    title: episode.title,
    text,
    sourceDocumentId: episode.sourceDocumentId,
    source: "formal_scenes" as const,
  };
};

const manualFilmTeamSourceBreakdown = (scene: Scene) => scene.breakdown
  ? { ...scene.breakdown, assetVariantMap: undefined }
  : null;

export const manualFilmTeamBreakdownHash = (episode: Episode) => manualFilmTeamScriptHash(JSON.stringify(
  manualFilmTeamUnitScenes(episode).map((scene) => ({
    id: scene.id,
    title: scene.title,
    sourceHash: manualFilmTeamScriptHash(manualFilmTeamSceneSource(scene).text),
    breakdown: manualFilmTeamSourceBreakdown(scene),
    breakdownStatus: scene.productionPreparation?.breakdown?.status || null,
    breakdownSourceHash: scene.productionPreparation?.breakdown?.sourceHash || null,
  })),
));

export const manualFilmTeamUnitBreakdownsReady = (episode: Episode) => {
  const scenes = manualFilmTeamUnitScenes(episode);
  return Boolean(scenes.length) && scenes.every((scene) => {
    const record = scene.productionPreparation?.breakdown;
    return Boolean(
      scene.breakdown
      && record
      && (record.status === "confirmed" || record.status === "stale"),
    );
  });
};

export const manualFilmTeamFullScriptHash = (project: Project) =>
  manualFilmTeamScriptHash(productionFullScriptText(project));

export const manualFilmTeamOutputFor = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
) => episode.productionTeam?.outputs.find((output) => output.department === department);

export const manualFilmTeamScenePlanFor = (
  output: ManualFilmTeamOutput | undefined,
  sceneId: string,
) => output?.scenePlans?.find((item) => item.sceneId === sceneId);

export const manualFilmTeamMissingSceneIds = (
  output: ManualFilmTeamOutput | undefined,
  episode: Episode,
) => {
  const plannedIds = new Set(output?.scenePlans?.map((item) => item.sceneId) || []);
  return manualFilmTeamUnitScenes(episode).map((scene) => scene.id).filter((sceneId) => !plannedIds.has(sceneId));
};

export const upsertManualFilmTeamOutput = (
  project: Project,
  episode: Episode,
  output: ManualFilmTeamOutput,
): ManualFilmTeamWorkspace => {
  const current = episode.productionTeam;
  const unitSource = manualFilmTeamUnitSource(project, episode);
  const outputs = [...(current?.outputs || []).filter((item) => item.department !== output.department), output];
  return {
    schemaVersion: "manual-film-team.v2",
    episodeId: episode.id,
    sourceDocumentId: unitSource.sourceDocumentId,
    sourceScriptHash: manualFilmTeamScriptHash(unitSource.text),
    sourceBreakdownHash: manualFilmTeamBreakdownHash(episode),
    fullScriptHash: manualFilmTeamFullScriptHash(project),
    sourceSceneIds: manualFilmTeamUnitScenes(episode).map((scene) => scene.id),
    outputs,
    updatedAt: Date.now(),
  };
};

const text = (value: unknown) => String(value || "").trim();
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

export interface ManualFilmTeamQaEvidenceItem {
  itemId: string;
  text: string;
}

const qaEvidenceItem = (itemId: string, value: unknown): ManualFilmTeamQaEvidenceItem => ({
  itemId,
  text: text(value),
});

const requiredQaEvidenceItem = (itemId: string, value: unknown, label: string): ManualFilmTeamQaEvidenceItem => ({
  itemId,
  text: text(value) || `【缺失】${label}`,
});

export const manualFilmTeamQaEvidenceCatalog = (output: ManualFilmTeamOutput): ManualFilmTeamQaEvidenceItem[] => [
  requiredQaEvidenceItem("taskSummary", output.taskSummary, "本部门任务摘要为空"),
  requiredQaEvidenceItem("content", output.content, "本单元总体方案为空"),
  ...(output.scenePlans || []).flatMap((plan) => [
    requiredQaEvidenceItem(`scenePlans.${plan.sceneId}.summary`, plan.summary, `${plan.sceneTitle || plan.sceneId}的逐场任务概述为空`),
    ...(plan.executionNotes || []).map((item, index) => qaEvidenceItem(`scenePlans.${plan.sceneId}.executionNotes.${index + 1}`, item)),
    ...(plan.assetNeeds || []).map((item, index) => qaEvidenceItem(`scenePlans.${plan.sceneId}.assetNeeds.${index + 1}`, item)),
    ...(plan.continuityNotes || []).map((item, index) => qaEvidenceItem(`scenePlans.${plan.sceneId}.continuityNotes.${index + 1}`, item)),
    ...(plan.handoffNotes || []).map((item, index) => qaEvidenceItem(`scenePlans.${plan.sceneId}.handoffNotes.${index + 1}`, item)),
  ]),
  ...(output.openQuestions || []).map((item, index) => qaEvidenceItem(`openQuestions.${index + 1}`, item)),
  ...(output.handoffNotes || []).map((item, index) => qaEvidenceItem(`handoffNotes.${index + 1}`, item)),
  ...(output.handoffs || []).flatMap((handoff) => [
    qaEvidenceItem(`handoffs.${handoff.id}.topic`, handoff.topic),
    qaEvidenceItem(`handoffs.${handoff.id}.request`, handoff.request),
  ]),
].filter((item) => item.text);

export const manualFilmTeamQaOutputContext = (output?: ManualFilmTeamOutput, scopedEvidenceIds?: string[]) => {
  if (!output) return "尚未生成本部门结果。";
  const scopedIds = scopedEvidenceIds ? new Set(scopedEvidenceIds) : undefined;
  const includesEvidence = (itemId: string) => !scopedIds || scopedIds.has(itemId);
  const evidenceById = new Map(
    manualFilmTeamQaEvidenceCatalog(output)
      .filter((evidence) => includesEvidence(evidence.itemId))
      .map((evidence) => [evidence.itemId, evidence]),
  );
  const item = (itemId: string) => evidenceById.get(itemId) || qaEvidenceItem(itemId, "");
  return JSON.stringify({
    ...(includesEvidence("taskSummary") ? { taskSummary: item("taskSummary") } : {}),
    ...(includesEvidence("content") ? { content: item("content") } : {}),
    scenePlans: (output.scenePlans || []).filter((plan) => (
      [...evidenceById.keys()].some((itemId) => itemId.startsWith(`scenePlans.${plan.sceneId}.`))
    )).map((plan) => ({
      sceneId: plan.sceneId,
      sceneTitle: plan.sceneTitle,
      ...(includesEvidence(`scenePlans.${plan.sceneId}.summary`) ? { summary: item(`scenePlans.${plan.sceneId}.summary`) } : {}),
      executionNotes: (plan.executionNotes || []).map((_, index) => item(`scenePlans.${plan.sceneId}.executionNotes.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
      assetNeeds: (plan.assetNeeds || []).map((_, index) => item(`scenePlans.${plan.sceneId}.assetNeeds.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
      continuityNotes: (plan.continuityNotes || []).map((_, index) => item(`scenePlans.${plan.sceneId}.continuityNotes.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
      handoffNotes: (plan.handoffNotes || []).map((_, index) => item(`scenePlans.${plan.sceneId}.handoffNotes.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
    })),
    openQuestions: (output.openQuestions || []).map((_, index) => item(`openQuestions.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
    handoffNotes: (output.handoffNotes || []).map((_, index) => item(`handoffNotes.${index + 1}`)).filter((evidence) => includesEvidence(evidence.itemId)),
    handoffs: (output.handoffs || []).filter((handoff) => (
      includesEvidence(`handoffs.${handoff.id}.topic`) || includesEvidence(`handoffs.${handoff.id}.request`)
    )).map((handoff) => ({
      id: handoff.id,
      fromDepartment: handoff.fromDepartment,
      toDepartments: handoff.toDepartments,
      sceneId: handoff.sceneId,
      priority: handoff.priority,
      ...(includesEvidence(`handoffs.${handoff.id}.topic`) ? { topic: item(`handoffs.${handoff.id}.topic`) } : {}),
      ...(includesEvidence(`handoffs.${handoff.id}.request`) ? { request: item(`handoffs.${handoff.id}.request`) } : {}),
    })),
  }, null, 2);
};

export const MANUAL_FILM_TEAM_QA_BATCH_CHAR_BUDGET = 12_000;
export const MANUAL_FILM_TEAM_QA_BATCH_EVIDENCE_BUDGET = 16;
export const MANUAL_FILM_TEAM_QA_MAX_ATTEMPTS_PER_BATCH = 2;

/**
 * Keeps QA evidence boundaries semantic and finite. Unit-level decisions are
 * reviewed separately from scene evidence. Large scenes retain their canonical
 * scene context while their evidence sections are split across finite calls.
 * These budgets are transport limits, not content rules.
 */
export interface ManualFilmTeamQaOutputBatch {
  output: ManualFilmTeamOutput;
  evidenceIds: string[];
}

export const manualFilmTeamQaOutputBatches = (
  output: ManualFilmTeamOutput,
  charBudget = MANUAL_FILM_TEAM_QA_BATCH_CHAR_BUDGET,
): ManualFilmTeamQaOutputBatch[] => {
  const evidence = manualFilmTeamQaEvidenceCatalog(output);
  const batches: ManualFilmTeamQaOutputBatch[] = [];
  const appendEvidenceGroups = (items: ManualFilmTeamQaEvidenceItem[]) => {
    let group: ManualFilmTeamQaEvidenceItem[] = [];
    let groupLength = 0;
    const flush = () => {
      if (!group.length) return;
      batches.push({ output, evidenceIds: group.map((item) => item.itemId) });
      group = [];
      groupLength = 0;
    };
    items.forEach((evidenceItem) => {
      const itemLength = evidenceItem.itemId.length + evidenceItem.text.length;
      if (group.length && (
        group.length >= MANUAL_FILM_TEAM_QA_BATCH_EVIDENCE_BUDGET
        || groupLength + itemLength > charBudget
      )) flush();
      group.push(evidenceItem);
      groupLength += itemLength;
    });
    flush();
  };

  appendEvidenceGroups(evidence.filter((item) => !item.itemId.startsWith("scenePlans.")));
  (output.scenePlans || []).forEach((plan) => {
    appendEvidenceGroups(evidence.filter((item) => item.itemId.startsWith(`scenePlans.${plan.sceneId}.`)));
  });
  return batches;
};

type ManualFilmTeamQaPart = Omit<ManualFilmTeamQA, "audit" | "reviewedAt">;

export const combineManualFilmTeamQAParts = (
  parts: ManualFilmTeamQaPart[],
  expectedEvidenceCount: number,
): ManualFilmTeamQaPart => {
  const coverage = parts.flatMap((part) => part.coverage || []);
  const issues = parts.flatMap((part) => part.issues || []);
  const strengths = [...new Set(parts.flatMap((part) => part.strengths || []))];
  const coveredCount = new Set(coverage.map((item) => item.itemId)).size;
  const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.coverage?.length || 0), 0);
  const weightedScore = totalWeight
    ? Math.round(parts.reduce((sum, part) => sum + part.score * Math.max(1, part.coverage?.length || 0), 0) / totalWeight)
    : 0;
  const hasBlockingOrWarning = issues.some((item) => item.severity === "blocking" || item.severity === "warning");
  const hasAdvisory = issues.some((item) => item.severity === "advisory");
  const coverageComplete = coveredCount === expectedEvidenceCount;
  const score = !coverageComplete || hasBlockingOrWarning
    ? Math.min(84, weightedScore)
    : hasAdvisory ? Math.min(94, weightedScore) : weightedScore;
  return {
    score,
    verdict: coverageComplete && score >= MANUAL_FILM_TEAM_MIN_PASS_SCORE && !hasBlockingOrWarning ? "pass" : "revise",
    summary: parts.map((part) => part.summary).filter(Boolean).join("；"),
    strengths,
    coverage,
    issues,
  };
};

export const normalizeManualFilmTeamDraft = (value: unknown, scenes: Scene[] = []) => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const rawScenePlans = Array.isArray(source.scenePlans) ? source.scenePlans : [];
  const scenePlans = rawScenePlans.flatMap((item): ManualFilmTeamScenePlan[] => {
    const plan = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const sceneId = text(plan.sceneId);
    const canonicalScene = scenesById.get(sceneId);
    if (!sceneId || (scenes.length && !canonicalScene)) return [];
    return [{
      sceneId,
      sceneTitle: canonicalScene?.title || text(plan.sceneTitle) || sceneId,
      summary: text(plan.summary),
      executionNotes: list(plan.executionNotes),
      assetNeeds: list(plan.assetNeeds),
      continuityNotes: list(plan.continuityNotes),
      handoffNotes: list(plan.handoffNotes),
    }];
  });
  return {
    taskSummary: text(source.taskSummary),
    content: text(source.content),
    scenePlans,
    openQuestions: list(source.openQuestions),
    handoffNotes: list(source.handoffNotes),
  };
};

export const normalizeManualFilmTeamQA = (
  value: unknown,
  reviewedOutput?: ManualFilmTeamOutput,
  scopedEvidenceIds?: string[],
): Omit<ManualFilmTeamQA, "audit" | "reviewedAt"> => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawIssues = Array.isArray(source.issues) ? source.issues : [];
  const scopedIds = scopedEvidenceIds ? new Set(scopedEvidenceIds) : undefined;
  const evidenceById = reviewedOutput
    ? new Map(manualFilmTeamQaEvidenceCatalog(reviewedOutput)
      .filter((item) => !scopedIds || scopedIds.has(item.itemId))
      .map((item) => [item.itemId, item.text]))
    : undefined;
  const issues = rawIssues.map((item) => {
    const issue = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const severity: "blocking" | "warning" | "advisory" = issue.severity === "blocking" || issue.severity === "advisory" ? issue.severity : "warning";
    const outputEvidenceId = text(issue.outputEvidenceId) || undefined;
    const reportedOutputEvidence = text(issue.outputEvidence) || undefined;
    let outputEvidence = reportedOutputEvidence;
    if (evidenceById) {
      const evidenceItem = outputEvidenceId ? evidenceById.get(outputEvidenceId) : undefined;
      if (!evidenceItem) {
        throw new Error("质检结果未能把问题定位到单一输出项，请重新运行质检。");
      }
      // The stable itemId is the audited locator. Providers may still echo,
      // truncate, or paraphrase outputEvidence despite being told to omit it;
      // never persist that model-authored copy over the canonical source text.
      outputEvidence = evidenceItem;
    }
    return {
      severity,
      sceneId: text(issue.sceneId) || undefined,
      description: text(issue.description),
      suggestion: text(issue.suggestion),
      outputEvidenceId,
      outputEvidence,
      sourceEvidence: text(issue.sourceEvidence) || undefined,
    };
  }).filter((issue) => issue.description);
  const rawCoverage = Array.isArray(source.coverage) ? source.coverage : [];
  const coverage = rawCoverage.flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const itemId = text(row.itemId);
    const reportedOutputEvidence = text(row.outputEvidence);
    const evidenceItem = evidenceById?.get(itemId);
    if (evidenceById && (!itemId || !evidenceItem)) {
      // Providers occasionally emit a collection placeholder for an empty array.
      // It is not an evidence item, so ignore only the provably empty placeholder.
      if (itemId && !reportedOutputEvidence) return [];
      throw new Error("质检覆盖表包含无法定位的结果证据，请重新运行质检。");
    }
    // itemId is the audited locator. Keep the raw model response in PromptExecution,
    // but persist canonical output text so harmless truncation cannot fail the batch.
    const outputEvidence = evidenceItem || reportedOutputEvidence;
    const judgment: NonNullable<ManualFilmTeamQA["coverage"]>[number]["judgment"] = row.judgment === "grounded_fact"
      || row.judgment === "marked_proposal"
      || row.judgment === "marked_pending"
      || row.judgment === "boundary_clear"
      || row.judgment === "issue"
      ? row.judgment
      : "issue";
    return [{
      itemId,
      judgment,
      outputEvidence,
      sourceEvidence: text(row.sourceEvidence),
      note: text(row.note),
    }];
  }).filter((item) => item.itemId);
  if (evidenceById) {
    const coveredIds = new Set(coverage.map((item) => item.itemId));
    if (coveredIds.size !== coverage.length || evidenceById.size !== coveredIds.size || [...evidenceById.keys()].some((itemId) => !coveredIds.has(itemId))) {
      throw new Error(`质检覆盖不完整：必须逐项审计全部 ${evidenceById.size} 条结果证据。`);
    }
    const issueEvidenceIds = new Set(issues.map((issue) => issue.outputEvidenceId).filter(Boolean));
    if (coverage.some((item) => item.judgment === "issue" && !issueEvidenceIds.has(item.itemId))) {
      throw new Error("质检覆盖表标记了问题，但 issues 未提供对应证据，请重新运行质检。");
    }
    // An explicit issue is the stricter signal. Some providers correctly
    // locate an issue but forget to mirror `judgment=issue` in coverage;
    // reconcile only in the fail-safe direction so the finding cannot pass.
    coverage.forEach((item) => {
      if (issueEvidenceIds.has(item.itemId)) item.judgment = "issue";
    });
  }
  const hasBlockingIssue = issues.some((issue) => issue.severity === "blocking");
  const hasWarningIssue = issues.some((issue) => issue.severity === "warning");
  const hasAdvisoryIssue = issues.some((issue) => issue.severity === "advisory");
  const reportedScore = Math.max(0, Math.min(100, Number(source.score) || 0));
  // Some providers still return a 1-10 score despite the visible 0-100 contract.
  // Only convert an unambiguously passing result; ambiguous revise scores remain untouched.
  const requestedPass = source.verdict === "pass" && !hasBlockingIssue;
  const normalizedReportedScore = requestedPass && reportedScore > 0 && reportedScore <= 10
    ? reportedScore * 10
    : reportedScore;
  const score = hasBlockingIssue || hasWarningIssue
    ? Math.min(normalizedReportedScore, MANUAL_FILM_TEAM_MIN_PASS_SCORE - 1)
    : hasAdvisoryIssue ? Math.min(normalizedReportedScore, 94) : normalizedReportedScore;
  const verdict = requestedPass && !hasWarningIssue && score >= MANUAL_FILM_TEAM_MIN_PASS_SCORE ? "pass" : "revise";
  return {
    score,
    verdict,
    summary: text(source.summary),
    strengths: list(source.strengths),
    coverage,
    issues,
  };
};
