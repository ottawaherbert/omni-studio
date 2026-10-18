import assert from "node:assert/strict";
import type { Episode, ManualFilmTeamOutput, Project, Scene } from "../src/types/project";
import {
  MANUAL_FILM_TEAM_MIN_PASS_SCORE,
  MANUAL_FILM_TEAM_QA_MAX_ATTEMPTS_PER_BATCH,
  MANUAL_FILM_TEAM_QA_BATCH_EVIDENCE_BUDGET,
  combineManualFilmTeamQAParts,
  manualFilmTeamDefaultContextIds,
  MANUAL_FILM_TEAM_DEPARTMENTS,
  manualFilmTeamBreakdownHash,
  manualFilmTeamFullScriptHash,
  manualFilmTeamQaEvidenceCatalog,
  manualFilmTeamQaOutputBatches,
  manualFilmTeamQaOutputContext,
  manualFilmTeamOutputFor,
  manualFilmTeamScriptHash,
  manualFilmTeamSceneSource,
  manualFilmTeamUnitSource,
  normalizeManualFilmTeamDraft,
  normalizeManualFilmTeamQA,
  projectManualFilmTeamRepairQa,
  upsertManualFilmTeamOutput,
} from "../src/services/production/manualFilmTeam";
import {
  findProductionAgent,
  findWorkflowStepDefinition,
} from "../src/services/production/agents";
import { runManualPromptGatewayReview } from "../src/services/production/manualGateway";
import { buildManualFilmTeamReadModel } from "../src/services/production/manualFilmTeamReadModel";
import {
  buildManualFilmTeamCommunicationState,
  MANUAL_FILM_TEAM_COLLABORATION_WAVES,
  MANUAL_FILM_TEAM_DEPARTMENT_ORDER,
  manualFilmTeamCollaborationContext,
  manualFilmTeamCollaborationIsStale,
  manualFilmTeamCollaborationSnapshot,
  manualFilmTeamUnresolvedWrapHandoffs,
  manualFilmTeamDependencies,
  manualFilmTeamMissingConfirmationPrerequisites,
  manualFilmTeamMissingPrerequisites,
  manualFilmTeamPendingCollaborationReviews,
  normalizeManualFilmTeamHandoffs,
} from "../src/services/production/manualFilmTeamCommunication";
import { gatherContextOptions } from "../src/utils/contextMapper";
import { productionBreakdownContextEntityScope } from "../src/services/production/manualSceneBreakdown";

const scene: Scene = {
  id: "scene-manual-team",
  title: "雨夜天台",
  description: "主角发现证据被调包。",
  valueCharge: "negative",
  script: "外景。雨夜。主角打开文件袋，里面只剩一张白纸。",
};

assert.equal(MANUAL_FILM_TEAM_DEPARTMENTS.length, 12, "manual film team should expose the twelve agreed departments");
assert.equal(new Set(MANUAL_FILM_TEAM_DEPARTMENTS.map((item) => item.id)).size, 12, "department ids must remain unique");
assert.equal(MANUAL_FILM_TEAM_DEPARTMENT_ORDER.length, 12, "collaboration waves must cover every department exactly once");
assert.equal(new Set(MANUAL_FILM_TEAM_DEPARTMENT_ORDER).size, 12, "collaboration waves must not duplicate a specialist department");
assert.equal(MANUAL_FILM_TEAM_DEPARTMENT_ORDER[0], "directing", "director intent must be the first preparation dependency");
assert.equal(MANUAL_FILM_TEAM_DEPARTMENT_ORDER.at(-1), "continuity", "continuity must close the preparation process");
assert.equal(MANUAL_FILM_TEAM_COLLABORATION_WAVES.every((wave) => wave.purpose.length > 0), true, "each collaboration wave must explain its user-facing purpose");
assert.deepEqual(manualFilmTeamDependencies("lighting"), ["cinematography", "production_design"], "lighting must consume camera and production-design decisions");
const dependencyOrder = new Map(MANUAL_FILM_TEAM_DEPARTMENT_ORDER.map((department, index) => [department, index]));
for (const department of MANUAL_FILM_TEAM_DEPARTMENT_ORDER) {
  for (const dependency of manualFilmTeamDependencies(department)) {
    assert.ok(
      dependencyOrder.get(dependency)! < dependencyOrder.get(department)!,
      `${department} must not create a circular default dependency on ${dependency}`,
    );
  }
}
assert.equal(MANUAL_FILM_TEAM_MIN_PASS_SCORE, 85, "department QA must enforce the agreed professional passing floor");
assert.equal(MANUAL_FILM_TEAM_QA_MAX_ATTEMPTS_PER_BATCH, 2, "each semantic QA batch must have a finite technical attempt budget");
assert.equal(MANUAL_FILM_TEAM_QA_BATCH_EVIDENCE_BUDGET, 16, "structured QA output must have a system-owned evidence budget");
assert.deepEqual(
  manualFilmTeamDefaultContextIds(["ctx_longFormMemory", "ctx_creativeVision", "ctx_char_1", "ctx_asset_1"]),
  [],
  "department prompts already receive governed source, continuity and collaboration projections, so generic context remains opt-in",
);
assert.ok(findProductionAgent("manual.production.department_prepare"), "manual film team producer must be registered");
const manualDepartmentStep = findWorkflowStepDefinition("manual.production.department_prepare");
assert.equal(manualDepartmentStep?.trigger, "manual");
assert.equal(manualDepartmentStep?.humanGatePolicyId, "human_gate.manual_review_after_ai.v1");
assert.deepEqual(manualDepartmentStep?.qaAgentIds, ["qa.manual.prompt_preview"]);
const gatewayReview = await runManualPromptGatewayReview({
  templateId: "productionTeamGenerate",
  workflowStepId: "manual.production.department_prepare",
  finalPrompt: "摄影组根据当前场景生成可执行筹备结果，并返回约定 JSON。",
  currentTemplate: "{{departmentName}} {{scriptContent}}",
  variables: { departmentName: "摄影组", scriptContent: scene.script || "" },
  selectedContextIds: [],
  selectedSkillIds: [],
});
assert.equal(gatewayReview.qaVerdicts.some((verdict) => verdict.blocking), false, "manual department prompt gateway should accept a visible non-empty prompt");

const draft = normalizeManualFilmTeamDraft({
  taskSummary: "  保住证据被调包的戏剧瞬间  ",
  content: "自由段落\n- 不限定固定字段\n- 允许专业判断",
  openQuestions: ["是否让白纸被雨水浸透？", ""],
  handoffNotes: ["摄影与道具确认白纸的可见性"],
  scenePlans: [{
    sceneId: scene.id,
    sceneTitle: "模型返回标题不会覆盖正式标题",
    summary: "保住证据被调包的戏剧瞬间",
    executionNotes: ["雨线中保持白纸可见"],
    assetNeeds: ["白纸湿润状态"],
    continuityNotes: ["承接上一场干燥文件袋"],
    handoffNotes: ["与道具组确认"],
  }],
  ignoredField: "should not become a rigid domain field",
}, [scene]);
assert.equal(draft.taskSummary, "保住证据被调包的戏剧瞬间");
assert.ok(draft.content.includes("不限定固定字段"), "free-form department content must be preserved");
assert.deepEqual(draft.openQuestions, ["是否让白纸被雨水浸透？"]);
assert.equal(draft.scenePlans[0].sceneTitle, scene.title, "scene plan titles must come from formal scenes rather than model text");

assert.equal(manualFilmTeamSceneSource(scene).source, "script");
assert.equal(manualFilmTeamSceneSource({ ...scene, script: "", scriptBlocks: [{ id: "b1", type: "action", content: "她抬头。" }] }).text, "她抬头。");
assert.equal(manualFilmTeamSceneSource({ ...scene, script: "" }).source, "scene_description", "scene summary fallback must remain explicit");

const qa = normalizeManualFilmTeamQA({
  score: 108,
  verdict: "pass",
  summary: "可执行",
  strengths: ["叙事目的明确"],
  issues: [
    { severity: "blocking", sceneId: scene.id, description: "缺少道具状态", suggestion: "补充白纸湿润程度", outputEvidence: "未说明白纸状态", sourceEvidence: "白纸被雨淋湿" },
    { severity: "unknown", description: "构图可更清楚", suggestion: "交给摄影组判断" },
  ],
});
assert.equal(qa.score, 84, "blocking findings must cap an overconfident model score below the professional passing floor");
assert.equal(qa.verdict, "revise", "a blocking issue must prevent a passing verdict");
assert.equal(qa.issues[1].severity, "warning", "unknown severities should degrade safely");
assert.equal(qa.issues[0].sceneId, scene.id, "QA evidence should preserve the formal scene locator");
assert.equal(qa.issues[0].sourceEvidence, "白纸被雨淋湿", "QA issues should retain source evidence for author audit");
const repairQa = projectManualFilmTeamRepairQa({
  ...qa,
  strengths: ["已经正确的内容"],
  issues: [...qa.issues, { severity: "advisory", description: "可选偏好", suggestion: "现场决定" }],
  audit: {
    action: "qa",
    templateId: "productionTeamQa",
    promptHash: "qa-prompt",
    selectedSkillIds: [],
    selectedSkillTitles: [],
    selectedContextIds: [],
    createdAt: 1,
  },
  reviewedAt: 1,
});
assert.equal("score" in repairQa!, false, "repair prompts must omit QA scoring metadata");
assert.equal("strengths" in repairQa!, false, "repair prompts must omit QA strengths");
assert.equal(repairQa!.issues.some((issue) => issue.severity === "advisory"), false, "repair prompts must omit non-actionable advice");

const tenPointPassingQa = normalizeManualFilmTeamQA({
  score: 9,
  verdict: "pass",
  summary: "整体可执行",
  strengths: [],
  issues: [{ severity: "advisory", description: "可补充演员走位", suggestion: "在导演说明中写明" }],
});
assert.equal(tenPointPassingQa.score, 90, "unambiguous passing 1-10 scores should be normalized to the 0-100 contract");
assert.equal(tenPointPassingQa.verdict, "pass");

const advisoryPassingQa = normalizeManualFilmTeamQA({
  score: 99,
  verdict: "pass",
  summary: "可通过但仍有一项非阻断改进",
  strengths: [],
  issues: [{ severity: "advisory", description: "可补充备选方案", suggestion: "列入开放问题" }],
});
assert.equal(advisoryPassingQa.score, 94, "a result with an advisory must not masquerade as a near-perfect score");
assert.equal(advisoryPassingQa.verdict, "pass");

const warningPassingQa = normalizeManualFilmTeamQA({
  score: 96,
  verdict: "pass",
  summary: "仍有会误导下游的事实边界问题",
  strengths: [],
  issues: [{ severity: "warning", description: "建议被写成事实", suggestion: "标记为部门建议" }],
});
assert.equal(warningPassingQa.score, 84, "warnings must cap the score below the professional passing floor");
assert.equal(warningPassingQa.verdict, "revise", "warnings must be resolved before department confirmation");

const belowProfessionalFloorQa = normalizeManualFilmTeamQA({
  score: MANUAL_FILM_TEAM_MIN_PASS_SCORE - 1,
  verdict: "pass",
  summary: "格式完整但执行深度不足",
  strengths: [],
  issues: [],
});
assert.equal(belowProfessionalFloorQa.verdict, "revise", "a model pass below the professional score floor must still require revision");

const ambiguousTenPointQa = normalizeManualFilmTeamQA({
  score: 7,
  verdict: "revise",
  summary: "仍需修改",
  strengths: [],
  issues: [],
});
assert.equal(ambiguousTenPointQa.score, 7, "non-passing scores must not be guessed or rescaled");

const episode = {
  id: "episode-manual-team",
  title: "第一集",
  inspiration: "证据被调包",
  scenes: [scene],
} as Episode;
const project = {
  id: "project-manual-team",
  title: "雨夜证据",
  type: "movie",
  aspectRatio: "16:9",
  logline: "主角必须在雨夜找回被调包的证据。",
  coreConflict: "真相与权力对抗。",
  characters: [],
  assets: [],
  episodes: [{ id: episode.id, title: episode.title, inspiration: episode.inspiration }],
} as unknown as Project;
const unitSourceHash = manualFilmTeamScriptHash(manualFilmTeamUnitSource(project, episode).text);
const breakdownHash = manualFilmTeamBreakdownHash(episode);
const fullScriptHash = manualFilmTeamFullScriptHash(project);

const output = (department: ManualFilmTeamOutput["department"], version: number): ManualFilmTeamOutput => ({
  department,
  sourceScriptHash: unitSourceHash,
  sourceBreakdownHash: breakdownHash,
  fullScriptHash,
  sourceSceneIds: [scene.id],
  taskSummary: draft.taskSummary,
  content: draft.content,
  scenePlans: draft.scenePlans,
  openQuestions: draft.openQuestions,
  handoffNotes: draft.handoffNotes,
  status: "draft",
  version,
  audit: {
    action: "generate",
    templateId: "productionTeamGenerate",
    promptHash: "prompt-hash",
    selectedSkillIds: ["skill-cinematography"],
    selectedSkillTitles: ["摄影方法"],
    selectedContextIds: ["ctx_creativeVision"],
    createdAt: 1,
  },
  updatedAt: 1,
});

const routedHandoffs = normalizeManualFilmTeamHandoffs([
  {
    toDepartments: ["cinematography", "continuity", "directing", "unknown"],
    sceneId: scene.id,
    topic: "白纸可见性",
    request: "摄影与场记确认雨水中的白纸状态和前后镜连续性。",
    priority: "review",
  },
  { toDepartments: [], request: "没有接收部门的消息不能进入交接总线。" },
], "directing", 2);
assert.equal(routedHandoffs.length, 1, "only directed handoffs with a concrete request should enter the collaboration bus");
assert.deepEqual(routedHandoffs[0].toDepartments, ["cinematography", "continuity"], "self and unknown department ids must be removed from handoffs");
assert.equal(routedHandoffs[0].fromDepartment, "directing");
assert.ok(routedHandoffs[0].id.startsWith("handoff-"), "handoffs must receive a stable audit id");
assert.equal(
  normalizeManualFilmTeamHandoffs([{
    toDepartments: ["cinematography", "continuity"],
    sceneId: scene.id,
    topic: "白纸可见性",
    request: "摄影与场记确认雨水中的白纸状态和前后镜连续性。",
    priority: "review",
  }], "directing", 99)[0].id,
  routedHandoffs[0].id,
  "an unchanged semantic handoff must retain its id across source output versions",
);

const qaOutput = output("directing", 1);
const qaCoverage = manualFilmTeamQaEvidenceCatalog(qaOutput).map((item) => ({
  itemId: item.itemId,
  judgment: item.itemId.endsWith("executionNotes.1") ? "issue" : "boundary_clear",
  outputEvidence: item.text,
  sourceEvidence: "测试来源依据",
  note: "测试逐项覆盖",
}));
const qaOutputContext = manualFilmTeamQaOutputContext(qaOutput);
assert.ok(qaOutputContext.includes(`scenePlans.${scene.id}.executionNotes.1`), "QA context should preserve one stable locator per array item");
assert.ok(qaOutputContext.includes('"itemId"'), "QA context should expose evidence boundaries structurally");
const secondScenePlan = {
  ...qaOutput.scenePlans[0],
  sceneId: "scene-manual-team-second",
  sceneTitle: "楼梯间",
  summary: "第二场保持证据袋状态",
};
const qaBatchOutput = { ...qaOutput, scenePlans: [...qaOutput.scenePlans, secondScenePlan] };
const qaBatches = manualFilmTeamQaOutputBatches(qaBatchOutput);
assert.equal(qaBatches.length, 3, "QA should keep unit-level evidence together and split scene plans only at scene boundaries");
const expectedBatchEvidenceIds = manualFilmTeamQaEvidenceCatalog(qaBatchOutput).map((item) => item.itemId).sort();
const actualBatchEvidenceIds = qaBatches.flatMap((batch) => batch.evidenceIds).sort();
assert.deepEqual(actualBatchEvidenceIds, expectedBatchEvidenceIds, "bounded QA batches must cover every evidence item exactly once");
assert.equal(new Set(actualBatchEvidenceIds).size, actualBatchEvidenceIds.length, "bounded QA batches must not duplicate evidence across calls");
const missingSummaryEvidence = manualFilmTeamQaEvidenceCatalog({
  ...qaOutput,
  scenePlans: [{ ...qaOutput.scenePlans[0], summary: "" }],
}).find((item) => item.itemId === `scenePlans.${scene.id}.summary`);
assert.ok(missingSummaryEvidence?.text.startsWith("【缺失】"), "required empty scene summaries must remain addressable QA evidence instead of disappearing from review");
const scopedSummaryEvidence = manualFilmTeamQaEvidenceCatalog({
  ...qaOutput,
  scenePlans: [{
    sceneId: "scene-summary-only",
    __workspaceScenePlanSummary: true,
  } as unknown as (typeof qaOutput.scenePlans)[number]],
});
assert.deepEqual(
  scopedSummaryEvidence
    .map((item) => item.itemId)
    .filter((itemId) => itemId.startsWith("scenePlans.")),
  ["scenePlans.scene-summary-only.summary"],
  "a scene-scoped read summary must remain renderable without pretending omitted detail arrays were loaded",
);
const denseScenePlan = (sceneId: string) => ({
  ...qaOutput.scenePlans[0],
  sceneId,
  sceneTitle: sceneId,
  executionNotes: Array.from({ length: 20 }, (_, index) => `【部门建议】执行项 ${index + 1}`),
});
const evidenceBoundedBatches = manualFilmTeamQaOutputBatches({
  ...qaOutput,
  scenePlans: [denseScenePlan("dense-scene-a"), denseScenePlan("dense-scene-b")],
}, Number.MAX_SAFE_INTEGER);
assert.ok(evidenceBoundedBatches.length > 3, "evidence-heavy scenes must split even when their input character count remains under budget");
assert.ok(evidenceBoundedBatches.every((batch) => batch.evidenceIds.length <= MANUAL_FILM_TEAM_QA_BATCH_EVIDENCE_BUDGET), "every structured QA response must remain inside the evidence budget");
assert.ok(evidenceBoundedBatches.slice(1).every((batch) => {
  const scenePrefixes = new Set(batch.evidenceIds.map((itemId) => itemId.split(".").slice(0, 2).join(".")));
  return scenePrefixes.size === 1;
}), "a split scene may span calls, but one batch must never mix unrelated scene contexts");
const cleanBatchQaParts = qaBatches.map((batch) => normalizeManualFilmTeamQA({
  score: 90,
  verdict: "pass",
  summary: "本批证据边界清楚",
  strengths: ["逐项可追溯"],
  coverage: batch.evidenceIds.map((itemId) => ({
    itemId,
    judgment: "boundary_clear",
    sourceEvidence: "测试来源依据",
    note: "本批通过",
  })),
  issues: [],
}, batch.output, batch.evidenceIds));
const cleanCombinedQa = combineManualFilmTeamQAParts(cleanBatchQaParts, expectedBatchEvidenceIds.length);
assert.equal(cleanCombinedQa.verdict, "pass", "all complete passing batches should produce one passing QA decision");
const warningCombinedQa = combineManualFilmTeamQAParts([
  ...cleanBatchQaParts.slice(0, -1),
  {
    ...cleanBatchQaParts.at(-1)!,
    score: 84,
    verdict: "revise",
    issues: [{ severity: "warning", description: "需要修正", suggestion: "限一次内容优化" }],
  },
], expectedBatchEvidenceIds.length);
assert.equal(warningCombinedQa.verdict, "revise", "one warning batch must stop the combined QA from passing");
assert.equal(warningCombinedQa.score, 84, "combined QA must retain the professional warning score cap");
const locatedQa = normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "一条建议需要调整",
  strengths: [],
  coverage: qaCoverage,
  issues: [{
    severity: "warning",
    sceneId: scene.id,
    description: "执行项需要明确建议边界",
    suggestion: "改为部门建议",
    outputEvidenceId: `scenePlans.${scene.id}.executionNotes.1`,
    outputEvidence: "雨线中保持白纸可见",
    sourceEvidence: "剧本只说明雨夜",
  }],
}, qaOutput);
assert.equal(locatedQa.issues[0].outputEvidenceId, `scenePlans.${scene.id}.executionNotes.1`);
const abbreviatedCoverageQa = normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "覆盖表省略了长文本，但保留了稳定 itemId",
  strengths: [],
  coverage: qaCoverage.map((item) => item.itemId === "content" ? { ...item, outputEvidence: "总体方案：..." } : item),
  issues: [{
    severity: "warning",
    sceneId: scene.id,
    description: "执行项需要明确建议边界",
    suggestion: "改为部门建议",
    outputEvidenceId: `scenePlans.${scene.id}.executionNotes.1`,
    outputEvidence: "雨线中保持白纸可见",
    sourceEvidence: "剧本只说明雨夜",
  }],
}, qaOutput);
assert.equal(abbreviatedCoverageQa.coverage?.find((item) => item.itemId === "content")?.outputEvidence, qaOutput.content, "coverage should persist canonical evidence text for a valid itemId");
const paraphrasedIssueQa = normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "问题定位正确，但供应商多返回了改写后的证据摘要",
  strengths: [],
  coverage: qaCoverage.map((item) => item.itemId === "content"
    ? { ...item, judgment: "boundary_clear" }
    : { ...item, judgment: "boundary_clear" }),
  issues: [{
    severity: "warning",
    description: "总体方案混入未确认判断",
    suggestion: "标成部门建议",
    outputEvidenceId: "content",
    outputEvidence: "供应商改写过的摘要，不应成为审计事实",
    sourceEvidence: "当前剧本没有确认该判断",
  }],
}, qaOutput);
assert.equal(paraphrasedIssueQa.issues[0].outputEvidence, qaOutput.content, "a valid itemId must canonicalize provider-authored evidence echoes instead of rejecting or persisting them");
assert.equal(paraphrasedIssueQa.coverage?.find((item) => item.itemId === "content")?.judgment, "issue", "an explicit issue must safely override a contradictory passing coverage judgment");
const idOnlyIssueQa = normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "问题只返回稳定定位，系统附加完整原文",
  strengths: [],
  coverage: qaCoverage.map(({ outputEvidence: _outputEvidence, ...item }) => item),
  issues: [{
    severity: "warning",
    sceneId: scene.id,
    description: "执行项需要明确建议边界",
    suggestion: "改为部门建议",
    outputEvidenceId: `scenePlans.${scene.id}.executionNotes.1`,
    sourceEvidence: "剧本只说明雨夜",
  }],
}, qaOutput);
assert.equal(idOnlyIssueQa.issues[0].outputEvidence, qaOutput.scenePlans[0].executionNotes[0], "QA should attach canonical evidence from a valid itemId");
const emptyCollectionPlaceholderQa = normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "空集合占位不属于文本证据",
  strengths: [],
  coverage: [...qaCoverage, { itemId: "openQuestions", judgment: "boundary_clear", outputEvidence: "", sourceEvidence: "无待确认问题", note: "空数组" }],
  issues: [{
    severity: "warning",
    sceneId: scene.id,
    description: "执行项需要明确建议边界",
    suggestion: "改为部门建议",
    outputEvidenceId: `scenePlans.${scene.id}.executionNotes.1`,
    sourceEvidence: "剧本只说明雨夜",
  }],
}, qaOutput);
assert.equal(emptyCollectionPlaceholderQa.coverage?.length, qaCoverage.length, "QA should ignore only empty collection placeholders outside the evidence catalog");
assert.throws(() => normalizeManualFilmTeamQA({
  score: 84,
  verdict: "revise",
  summary: "返回了无法定位的证据编号",
  strengths: [],
  coverage: qaCoverage,
  issues: [{
    severity: "warning",
    description: "错误证据",
    suggestion: "重试",
    outputEvidenceId: `scenePlans.${scene.id}.executionNotes.999`,
    outputEvidence: "不存在的证据",
    sourceEvidence: "剧本只说明雨夜",
  }],
}, qaOutput), /单一输出项/, "QA evidence must retain a valid stable locator instead of inventing an item id");

const firstWorkspace = upsertManualFilmTeamOutput(project, episode, output("directing", 1));
assert.equal(firstWorkspace.schemaVersion, "manual-film-team.v2");
assert.equal(firstWorkspace.sourceScriptHash, unitSourceHash);
assert.equal(firstWorkspace.outputs.length, 1);

const episodeWithWorkspace = { ...episode, productionTeam: firstWorkspace };
const secondWorkspace = upsertManualFilmTeamOutput(project, episodeWithWorkspace, output("cinematography", 1));
assert.equal(secondWorkspace.outputs.length, 2, "adding a department should preserve other department results");

const replacedWorkspace = upsertManualFilmTeamOutput(project, { ...episode, productionTeam: secondWorkspace }, output("directing", 2));
assert.equal(replacedWorkspace.outputs.length, 2, "regeneration should replace only the target department");
assert.equal(replacedWorkspace.outputs.find((item) => item.department === "directing")?.version, 2);

const scopedContextProject = {
  ...project,
  targetEpisodeCount: 10,
  activeEpisodeId: "episode-later",
  episodes: [
    { ...episode, id: "episode-current", title: "第一集", inspiration: "能力首次觉醒", scenes: [scene] },
    { ...episode, id: "episode-later", title: "第二集", inspiration: "能力已经稳定使用", scenes: [{ ...scene, id: "scene-later", title: "能力强化" }] },
  ],
} as unknown as Project;
const scopedLongFormContext = gatherContextOptions(scopedContextProject, "breakdown", { episodeIds: ["episode-current"] })
  .options.find((option) => option.id === "ctx_longFormMemory")?.value || "";
assert.ok(scopedLongFormContext.includes("【当前/最近几集具体内容】\n- 第 1 集 第一集"));
assert.equal(scopedLongFormContext.includes("【当前/最近几集具体内容】\n- 第 2 集 第二集"), false, "an explicit preparation episode must not inherit another episode as its current window");

const entityScopedProject = {
  ...scopedContextProject,
  characters: [
    { id: "character-visible", name: "当前场角色" },
    { id: "character-unrelated", name: "其他场角色" },
  ],
  assets: [
    { id: "prop-visible", type: "prop", name: "当前场道具", description: "证据" },
    { id: "prop-unrelated", type: "prop", name: "其他场道具", description: "不应默认注入" },
  ],
} as unknown as Project;
const entityScopedScene = {
  ...scene,
  scriptBlocks: [{ id: "entity-link", type: "character", content: "当前场角色", linkedAssetId: "character-visible", propIds: ["prop-visible"] }],
} as Scene;
const entityScope = productionBreakdownContextEntityScope(entityScopedProject, entityScopedScene);
const entityContext = gatherContextOptions(entityScopedProject, "breakdown", {
  episodeIds: ["episode-current"],
  ...entityScope,
  restrictEntityDefaults: true,
});
assert.ok(entityContext.defaultIds.includes("ctx_char_character-visible"), "current-scene character evidence should be selected by default");
assert.ok(entityContext.defaultIds.includes("ctx_asset_prop-visible"), "current-scene asset evidence should be selected by default");
assert.equal(entityContext.defaultIds.includes("ctx_char_character-unrelated"), false, "unrelated characters must remain opt-in instead of polluting the current-scene prompt");
assert.equal(entityContext.defaultIds.includes("ctx_asset_prop-unrelated"), false, "unrelated assets must remain opt-in instead of polluting the current-scene prompt");

const emptyReadModel = buildManualFilmTeamReadModel({ project, episode: { ...episode, preparationMode: 'professional' }, createdAt: 10 });
assert.equal(emptyReadModel.productionBreakdownReport.sceneMatrix.length, 1);
assert.equal(emptyReadModel.departmentPrepPackages.length, 12, "manual read model should project all visible departments into prep packages");
assert.equal(emptyReadModel.coverage.length, 12);
assert.equal(emptyReadModel.findings.length, 12, "every missing manual department should produce a visible blocking finding");
assert.equal(emptyReadModel.findings.every((item) => item.resolutionClass === "hard_blocking"), true);
assert.equal(emptyReadModel.directorCockpit.blockedDepartments, 12);
assert.equal(emptyReadModel.directorCockpit.readyForStoryboard, false);

const confirmedOutputs = MANUAL_FILM_TEAM_DEPARTMENTS.map((department) => ({
  ...output(department.id, 1),
  status: "confirmed" as const,
  qa: {
    ...qa,
    verdict: "pass" as const,
    issues: [],
    audit: output(department.id, 1).audit,
    reviewedAt: 9,
  },
}));
const confirmedEpisode: Episode = {
  ...episode,
  productionTeam: {
    schemaVersion: "manual-film-team.v2",
    episodeId: episode.id,
    sourceScriptHash: unitSourceHash,
    sourceBreakdownHash: breakdownHash,
    fullScriptHash,
    sourceSceneIds: [scene.id],
    outputs: confirmedOutputs,
    updatedAt: 9,
  },
};

const directingWithHandoff: ManualFilmTeamOutput = {
  ...confirmedOutputs.find((item) => item.department === "directing")!,
  version: 2,
  handoffs: routedHandoffs,
};
const collaborationEpisode: Episode = {
  ...episode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: [directingWithHandoff],
  },
};
const cameraSnapshotV2 = manualFilmTeamCollaborationSnapshot(collaborationEpisode, "cinematography");
assert.equal(cameraSnapshotV2.incomingHandoffs.length, 1, "a confirmed directed handoff must reach its recipient inbox");
assert.equal(cameraSnapshotV2.peerVersions.directing, 2, "recipient collaboration snapshots must record the source department version");
const wardrobeContext = manualFilmTeamCollaborationContext(collaborationEpisode, "wardrobe");
assert.equal(wardrobeContext.includes("白纸可见性"), false, "a handoff addressed to camera and continuity must not pollute wardrobe context");
const cameraContext = manualFilmTeamCollaborationContext(collaborationEpisode, "cinematography");
assert.ok(cameraContext.includes("白纸可见性"), "the camera prompt must receive its directed handoff");
assert.ok(cameraContext.includes("导演组"), "the camera prompt must receive confirmed relevant peer briefs");
assert.equal(cameraContext.includes('"version"'), false, "prompt context must not include peer audit versions");
assert.equal(cameraContext.includes('"sceneId"'), false, "prompt context must not include database scene ids");
assert.equal(cameraContext.includes('"id"'), false, "prompt context must not include handoff or department ids");

const cameraOutputV1: ManualFilmTeamOutput = {
  ...confirmedOutputs.find((item) => item.department === "cinematography")!,
  collaborationSourceHash: cameraSnapshotV2.hash,
  collaborationSourceVersions: cameraSnapshotV2.peerVersions,
  collaborationHandoffIds: cameraSnapshotV2.incomingHandoffs.map((handoff) => handoff.id),
};
const episodeWithAcknowledgedCamera: Episode = {
  ...collaborationEpisode,
  productionTeam: {
    ...collaborationEpisode.productionTeam!,
    outputs: [directingWithHandoff, cameraOutputV1],
  },
};
assert.equal(buildManualFilmTeamCommunicationState(episodeWithAcknowledgedCamera, "cinematography").incomingHandoffs[0].acknowledged, true, "a target generated from the current peer version must acknowledge the handoff");
assert.equal(manualFilmTeamCollaborationIsStale(episodeWithAcknowledgedCamera, cameraOutputV1), false);

const directingV3 = { ...directingWithHandoff, version: 3, updatedAt: 3, confirmedAt: 3 };
const episodeWithUpdatedDirector: Episode = {
  ...episodeWithAcknowledgedCamera,
  productionTeam: {
    ...episodeWithAcknowledgedCamera.productionTeam!,
    outputs: [directingV3, cameraOutputV1],
  },
};
assert.equal(manualFilmTeamCollaborationIsStale(episodeWithUpdatedDirector, cameraOutputV1), false, "a metadata-only upstream version change must not reopen a QA-reviewed downstream result");
const directingV4 = {
  ...directingV3,
  version: 4,
  content: `${directingV3.content}\n新增真实机位约束。`,
  updatedAt: 4,
  confirmedAt: 4,
};
const episodeWithChangedDirector: Episode = {
  ...episodeWithAcknowledgedCamera,
  productionTeam: {
    ...episodeWithAcknowledgedCamera.productionTeam!,
    outputs: [directingV4, cameraOutputV1],
  },
};
assert.equal(manualFilmTeamCollaborationIsStale(episodeWithChangedDirector, cameraOutputV1), true, "a materially changed upstream result must invalidate the downstream collaboration snapshot");
const updatedCameraReadModel = buildManualFilmTeamReadModel({
  project,
  episode: episodeWithChangedDirector,
  requiredDepartments: ["cinematography"],
  createdAt: 10,
});
assert.equal(updatedCameraReadModel.coverage[0].readiness, "ready", "peer changes must remain advisory and preserve the author's confirmation");
assert.equal(updatedCameraReadModel.directorCockpit.staleCollaborations, 1);
assert.equal(updatedCameraReadModel.findings.some((item) => item.severity === "advisory" && item.message.includes("协作信息有更新")), true);
assert.equal(updatedCameraReadModel.coverage[0].pendingHandoffCount, 0, "an unchanged semantic handoff must remain acknowledged while an upstream dependency version requests review");

const irrelevantSound = confirmedOutputs.find((item) => item.department === "sound_music")!;
const episodeWithIrrelevantSound: Episode = {
  ...collaborationEpisode,
  productionTeam: {
    ...collaborationEpisode.productionTeam!,
    outputs: [directingWithHandoff, irrelevantSound],
  },
};
assert.equal(
  manualFilmTeamCollaborationSnapshot(episodeWithIrrelevantSound, "cinematography").hash,
  cameraSnapshotV2.hash,
  "an unrelated department update must not invalidate the camera collaboration snapshot",
);
const initialCoordinationSnapshot = manualFilmTeamCollaborationSnapshot(collaborationEpisode, "production_coordination");
const closingCoordinationSnapshot = manualFilmTeamCollaborationSnapshot(confirmedEpisode, "production_coordination");
assert.deepEqual(Object.keys(initialCoordinationSnapshot.peerVersions), ["directing"], "the first coordination pass should consume the director brief without waiting for every craft");
assert.ok(Object.keys(closingCoordinationSnapshot.peerVersions).length > 8, "after all crafts confirm, production coordination must receive one final reconciliation snapshot");
assert.notEqual(initialCoordinationSnapshot.hash, closingCoordinationSnapshot.hash, "the final production meeting must invalidate the initial coordination snapshot once");

const designBaselineSnapshot = manualFilmTeamCollaborationSnapshot(confirmedEpisode, "production_design");
const actionBaselineSnapshot = manualFilmTeamCollaborationSnapshot(confirmedEpisode, "action_choreography");
const actionToDesignHandoff = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["production_design"],
  sceneId: scene.id,
  topic: "动作安全区复核",
  request: "美术组复核控制板安全区；动作组当前版本先完成确认，接收部门随后定向复核。",
  priority: "review",
}], "action_choreography", 2);
const episodeWithActionToDesignReview: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedOutputs.map((item) => {
      if (item.department === "production_design") return {
        ...item,
        collaborationSourceHash: designBaselineSnapshot.hash,
        collaborationSourceVersions: designBaselineSnapshot.peerVersions,
      };
      if (item.department === "action_choreography") return {
        ...item,
        version: 2,
        handoffs: actionToDesignHandoff,
        collaborationSourceHash: actionBaselineSnapshot.hash,
        collaborationSourceVersions: actionBaselineSnapshot.peerVersions,
      };
      return item;
    }),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(
    episodeWithActionToDesignReview,
    manualFilmTeamOutputFor(episodeWithActionToDesignReview, "production_design"),
  ),
  true,
  "a directed review must still reopen its actual recipient",
);
assert.deepEqual(
  manualFilmTeamMissingPrerequisites(episodeWithActionToDesignReview, "action_choreography"),
  [],
  "an advisory collaboration change must not block a dependent department from continuing",
);
assert.deepEqual(
  manualFilmTeamMissingConfirmationPrerequisites(episodeWithActionToDesignReview, "action_choreography"),
  [],
  "an emitter whose own QA snapshot is current must not be reverse-blocked by the review it just sent",
);
assert.equal(
  manualFilmTeamCollaborationIsStale(
    episodeWithActionToDesignReview,
    manualFilmTeamOutputFor(episodeWithActionToDesignReview, "action_choreography"),
  ),
  false,
  "the emitter remains confirmable until a dependency publishes a materially reviewed version",
);

const cameraBaselineSnapshot = manualFilmTeamCollaborationSnapshot(confirmedEpisode, "cinematography");
const cameraBeforePropsHandoff: ManualFilmTeamOutput = {
  ...confirmedOutputs.find((item) => item.department === "cinematography")!,
  collaborationSourceHash: cameraBaselineSnapshot.hash,
  collaborationSourceVersions: cameraBaselineSnapshot.peerVersions,
};
const propsBackHandoff = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["cinematography"],
  sceneId: scene.id,
  topic: "钥匙反光与取证动作",
  request: "摄影组需调整机位，确保演员取钥匙时既能看清齿形又不穿帮。",
  priority: "review",
}], "props", 2);
const episodeWithLatePropsHandoff: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedOutputs.map((item) => {
      if (item.department === "cinematography") return cameraBeforePropsHandoff;
      if (item.department === "props") return { ...item, version: 2, handoffs: propsBackHandoff };
      if (item.department === "production_coordination" || item.department === "continuity") {
        return { ...item, collaborationSourceHash: "stale-closing-pass" };
      }
      return item;
    }),
  },
};
assert.deepEqual(
  manualFilmTeamPendingCollaborationReviews(episodeWithLatePropsHandoff),
  ["cinematography"],
  "a late directed handoff must reopen only the affected specialist, not the final coordinator or continuity wrap",
);
const latePropsSnapshot = manualFilmTeamCollaborationSnapshot(episodeWithLatePropsHandoff, "cinematography");
const cameraAfterPropsReview: ManualFilmTeamOutput = {
  ...cameraBeforePropsHandoff,
  version: 2,
  collaborationSourceHash: latePropsSnapshot.hash,
  collaborationSourceVersions: latePropsSnapshot.peerVersions,
  collaborationHandoffIds: latePropsSnapshot.incomingHandoffs.map((handoff) => handoff.id),
};
const episodeWithRepeatedPropsVersion: Episode = {
  ...episodeWithLatePropsHandoff,
  productionTeam: {
    ...episodeWithLatePropsHandoff.productionTeam!,
    outputs: episodeWithLatePropsHandoff.productionTeam!.outputs.map((item) => {
      if (item.department === "cinematography") return cameraAfterPropsReview;
      if (item.department === "props") return { ...item, version: 3, handoffs: propsBackHandoff };
      return item;
    }),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithRepeatedPropsVersion, cameraAfterPropsReview),
  false,
  "an incoming-only peer version change must not reopen a department when the directed handoff is semantically unchanged",
);
assert.equal(
  buildManualFilmTeamCommunicationState(episodeWithRepeatedPropsVersion, "cinematography").incomingHandoffs[0].acknowledged,
  true,
  "stable semantic handoff ids must keep an unchanged request acknowledged across source versions",
);
const changedPropsHandoff = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["cinematography"],
  sceneId: scene.id,
  topic: "钥匙反光与取证动作",
  request: "摄影组改用更低机位，同时确保钥匙齿形、演员手位和柜门反射都可辨。",
  priority: "review",
}], "props", 4);
const episodeWithChangedPropsRequest: Episode = {
  ...episodeWithRepeatedPropsVersion,
  productionTeam: {
    ...episodeWithRepeatedPropsVersion.productionTeam!,
    outputs: episodeWithRepeatedPropsVersion.productionTeam!.outputs.map((item) => item.department === "props"
      ? { ...item, version: 4, handoffs: changedPropsHandoff }
      : item),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithChangedPropsRequest, cameraAfterPropsReview),
  true,
  "a materially changed directed request must still reopen its recipient",
);
assert.equal(
  buildManualFilmTeamReadModel({
    project,
    episode: episodeWithChangedPropsRequest,
    requiredDepartments: ["cinematography"],
    createdAt: 10,
  }).coverage[0].pendingHandoffCount,
  1,
  "the read model must expose a materially changed directed request as unacknowledged",
);

const cameraAdvisoryToAction = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["action_choreography"],
  sceneId: scene.id,
  topic: "安全机位补充",
  request: "拍摄前向动作组同步摄影安全距离，作为现场提示，不要求动作组返工。",
  priority: "advisory",
}], "cinematography", 2);
const actionBeforeCameraAdvisory = manualFilmTeamOutputFor(confirmedEpisode, "action_choreography")!;
const episodeWithCameraAdvisory: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedEpisode.productionTeam!.outputs.map((item) => item.department === "cinematography"
      ? { ...item, version: 2, handoffs: cameraAdvisoryToAction }
      : item),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithCameraAdvisory, actionBeforeCameraAdvisory),
  false,
  "an advisory handoff must remain informational and must not reopen a confirmed recipient",
);
assert.equal(
  buildManualFilmTeamCommunicationState(episodeWithCameraAdvisory, "action_choreography").incomingHandoffs[0]?.acknowledged,
  true,
  "an advisory handoff must be visible without creating a pending acknowledgement loop",
);
assert.deepEqual(
  manualFilmTeamPendingCollaborationReviews(episodeWithCameraAdvisory),
  [],
  "an advisory handoff must not enter the focused collaboration review queue",
);
const coordinationAdvisoryToDesign = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["production_design"],
  topic: "最终统筹执行同步",
  request: "同步最终状态矩阵，仅供执行，不要求美术组重开已经确认的设计。",
  priority: "advisory",
}], "production_coordination", 2);
const designBeforeCoordinationAdvisory = manualFilmTeamOutputFor(confirmedEpisode, "production_design")!;
const episodeWithCoordinationAdvisory: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedEpisode.productionTeam!.outputs.map((item) => item.department === "production_coordination"
      ? { ...item, version: 2, handoffs: coordinationAdvisoryToDesign }
      : item),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithCoordinationAdvisory, designBeforeCoordinationAdvisory),
  false,
  "a later required-peer version with an explicit advisory must not reopen a confirmed department",
);
assert.equal(
  buildManualFilmTeamCommunicationState(episodeWithCoordinationAdvisory, "production_design").incomingHandoffs[0]?.acknowledged,
  true,
  "a required peer advisory must be visible and automatically acknowledged",
);

const designBeforeCoordinationWrap = manualFilmTeamOutputFor(confirmedEpisode, "production_design")!;
const wrapCoordinationSnapshot = manualFilmTeamCollaborationSnapshot(confirmedEpisode, "production_coordination");
const coordinationWrapToContinuity = normalizeManualFilmTeamHandoffs([{
  toDepartments: ["continuity"],
  sceneId: scene.id,
  topic: "最终连续性收口",
  request: "场记核对全组确认后的角色状态、道具归属与镜头衔接。",
  priority: "blocking",
}], "production_coordination", 2);
const episodeWithCoordinationWrap: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedEpisode.productionTeam!.outputs.map((item) => item.department === "production_coordination"
      ? {
        ...item,
        version: 2,
        coordinationPhase: "wrap" as const,
        collaborationSourceHash: wrapCoordinationSnapshot.hash,
        collaborationSourceVersions: wrapCoordinationSnapshot.peerVersions,
        handoffs: coordinationWrapToContinuity,
      }
      : item),
  },
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithCoordinationWrap, designBeforeCoordinationWrap),
  false,
  "a closing coordination pass must not reopen already confirmed specialists without a directed request",
);
assert.equal(
  buildManualFilmTeamCommunicationState(episodeWithCoordinationWrap, "continuity").incomingHandoffs.some((handoff) => (
    handoff.fromDepartment === "production_coordination" && handoff.priority === "blocking"
  )),
  true,
  "the final coordinator must still route explicit blocking closeout work to continuity",
);
assert.deepEqual(
  manualFilmTeamUnresolvedWrapHandoffs(
    episodeWithCoordinationWrap,
    manualFilmTeamOutputFor(episodeWithCoordinationWrap, "production_coordination"),
  ),
  [],
  "a final coordinator may route blocking closeout work to continuity",
);
const invalidCoordinationWrap = {
  ...manualFilmTeamOutputFor(episodeWithCoordinationWrap, "production_coordination")!,
  handoffs: normalizeManualFilmTeamHandoffs([{
    toDepartments: ["production_design", "continuity"],
    topic: "最终资产同步",
    request: "美术组重新处理已经确认的资产，同时由场记收口。",
    priority: "blocking",
  }], "production_coordination", 3),
};
assert.equal(
  manualFilmTeamUnresolvedWrapHandoffs(episodeWithCoordinationWrap, invalidCoordinationWrap).length,
  1,
  "a final coordinator must not reopen an already confirmed specialist with blocking or review handoffs",
);
const cameraWithLegacyHash = {
  ...cameraOutputV1,
  collaborationSourceHash: "legacy-collaboration-hash",
};
assert.equal(
  manualFilmTeamCollaborationIsStale(episodeWithAcknowledgedCamera, cameraWithLegacyHash),
  false,
  "a hash-algorithm migration must not reopen a QA-reviewed result when peer versions and actionable handoffs are unchanged",
);

const confirmedReadModel = buildManualFilmTeamReadModel({ project, episode: confirmedEpisode, createdAt: 11 });
assert.equal(confirmedReadModel.directorCockpit.confirmedDepartments, 12);
assert.equal(confirmedReadModel.directorCockpit.blockedDepartments, 0);
assert.equal(confirmedReadModel.coverage.every((item) => item.readiness === "ready"), true);
assert.equal(confirmedReadModel.findings.some((item) => item.message.includes("尚未生成")), false);

const contradictoryQaEpisode: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedOutputs.map((item) => item.department === "directing" ? {
      ...item,
      qa: {
        ...item.qa!,
        issues: [{ severity: "blocking" as const, description: "导演意图与场景目标冲突", suggestion: "重新确认场景目标" }],
      },
    } : item),
  },
};
const contradictoryQaReadModel = buildManualFilmTeamReadModel({
  project,
  episode: contradictoryQaEpisode,
  createdAt: 12,
});
assert.equal(contradictoryQaReadModel.coverage.find((item) => item.department === "directing")?.readiness, "blocked");
assert.equal(contradictoryQaReadModel.directorCockpit.readyForStoryboard, false, "blocking QA details must win over a contradictory pass verdict");

const singleDepartmentStaleEpisode: Episode = {
  ...confirmedEpisode,
  productionTeam: {
    ...confirmedEpisode.productionTeam!,
    outputs: confirmedOutputs.map((item) => item.department === "cinematography"
      ? { ...item, sourceScriptHash: "outdated-cinematography-source" }
      : item),
  },
};
const singleDepartmentStaleReadModel = buildManualFilmTeamReadModel({
  project,
  episode: singleDepartmentStaleEpisode,
  createdAt: 13,
});
assert.equal(singleDepartmentStaleReadModel.coverage.find((item) => item.department === "cinematography")?.readiness, "ready");
assert.equal(singleDepartmentStaleReadModel.coverage.find((item) => item.department === "directing")?.readiness, "ready", "a stale cinematography result must not invalidate unrelated confirmed departments");
assert.equal(singleDepartmentStaleReadModel.directorCockpit.staleDepartments, 1);
assert.equal(singleDepartmentStaleReadModel.directorCockpit.blockedDepartments, 0);
assert.equal(singleDepartmentStaleReadModel.findings.some((item) => item.severity === "advisory" && item.message.includes("已保留 1 个部门")), true);

const secondScene: Scene = {
  ...scene,
  id: "scene-manual-team-2",
  title: "雨夜楼梯间",
  script: "内景。楼梯间。主角把白纸装回文件袋，听见楼上传来脚步声。",
};
const multiSceneBase: Episode = { ...episode, scenes: [scene, secondScene] };
const multiSceneScriptHash = manualFilmTeamScriptHash(manualFilmTeamUnitSource(project, multiSceneBase).text);
const multiSceneBreakdownHash = manualFilmTeamBreakdownHash(multiSceneBase);
const incompleteMultiSceneOutputs = confirmedOutputs.map((item) => ({
  ...item,
  sourceScriptHash: multiSceneScriptHash,
  sourceBreakdownHash: multiSceneBreakdownHash,
  sourceSceneIds: [scene.id, secondScene.id],
}));
const incompleteMultiSceneEpisode: Episode = {
  ...multiSceneBase,
  productionTeam: {
    schemaVersion: "manual-film-team.v2",
    episodeId: episode.id,
    sourceScriptHash: multiSceneScriptHash,
    sourceBreakdownHash: multiSceneBreakdownHash,
    fullScriptHash,
    sourceSceneIds: [scene.id, secondScene.id],
    outputs: incompleteMultiSceneOutputs,
    updatedAt: 14,
  },
};
const incompleteMultiSceneReadModel = buildManualFilmTeamReadModel({ project, episode: incompleteMultiSceneEpisode, createdAt: 14 });
assert.equal(incompleteMultiSceneReadModel.directorCockpit.readyForStoryboard, false);
assert.equal(incompleteMultiSceneReadModel.findings.some((item) => item.message.includes("缺少 1 个正式场次")), true, "a unit department package must cover every formal scene before confirmation can unlock downstream work");

const completeMultiSceneEpisode: Episode = {
  ...incompleteMultiSceneEpisode,
  productionTeam: {
    ...incompleteMultiSceneEpisode.productionTeam!,
    outputs: incompleteMultiSceneOutputs.map((item) => ({
      ...item,
      scenePlans: [
        ...(item.scenePlans || []),
        {
          sceneId: secondScene.id,
          sceneTitle: secondScene.title,
          summary: "承接证据状态并建立下一场悬念。",
          executionNotes: ["保持文件袋和白纸状态一致"],
          assetNeeds: [],
          continuityNotes: ["白纸已重新装袋"],
          handoffNotes: [],
        },
      ],
    })),
  },
};
assert.equal(buildManualFilmTeamReadModel({ project, episode: completeMultiSceneEpisode, createdAt: 15 }).directorCockpit.readyForStoryboard, true);

const projectedWorkspaceProject = {
  ...project,
  __productionWorkspaceShell: true,
  logline: "",
} as Project & { __productionWorkspaceShell: true };
const projectedWorkspaceReadModel = buildManualFilmTeamReadModel({
  project: projectedWorkspaceProject,
  episode: completeMultiSceneEpisode,
  createdAt: 15,
});
assert.equal(
  projectedWorkspaceReadModel.directorCockpit.readyForStoryboard,
  true,
  "a production workspace projection must reuse the persisted script snapshots instead of falsely marking departments stale",
);

console.log("Manual film team self-check passed.");
