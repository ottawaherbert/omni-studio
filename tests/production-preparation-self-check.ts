import assert from "node:assert/strict";

import type { Episode, Project, Scene } from "../src/types/project";
import { MANUAL_FILM_TEAM_DEPARTMENTS, manualFilmTeamScriptHash } from "../src/services/production/manualFilmTeam";
import type { ManualFilmTeamReadModel } from "../src/services/production/manualFilmTeamReadModel";
import type { ManualProductionAssetReadModel } from "../src/services/production/manualProductionAssets";
import { buildProductionPreparationGate } from "../src/services/production/productionPreparationGate";
import {
  bindProductionBreakdownAssetsToCanonicalRegistry,
  finalizeProductionBreakdownQaResult,
  normalizeProductionBreakdown,
  productionBreakdownAdoptionUpdates,
  productionBreakdownName,
  productionBreakdownQaChecklistPrompt,
  productionBreakdownRequiredSourceRefs,
  productionBreakdownSourceEvidenceLedger,
} from "../src/services/production/manualSceneBreakdown";
import {
  breakdownSourceChanged,
  breakdownStatus,
  buildProductionPreparationCurrentTask,
  buildProductionPreparationTabStatuses,
  hasProductionEpisodeSource,
  hasProductionSceneSource,
  nextIncompleteProductionSceneId,
  preparationStartTab,
  preparationStepSummaries,
  recommendedDepartmentsForScene,
} from "../src/features/production/preparation/productionPreparationViewModel";
import { syncCharactersFromCharacterAssets } from "../src/store/slices/projectSlice";
import {
  buildDepartmentPrepPackages,
  buildProductionBreakdownReport,
} from "../packages/production/src/services/production/productionPrep";
import { buildContinuityMatrix } from "../packages/production/src/services/production/productionContinuity";
import { resolveWorkspaceProjectId } from "../src/utils/activeProjectStorage";

const workspaceProjects = [
  { id: "project-a", episodes: [{ id: "episode-a" }] },
  { id: "project-b", episodes: [{ id: "episode-b" }] },
];
assert.equal(resolveWorkspaceProjectId({ projects: workspaceProjects, requestedProjectId: "project-b", requestedEpisodeId: "episode-a", storedProjectId: "project-a" }), "project-b", "an explicit project deep link must win");
assert.equal(resolveWorkspaceProjectId({ projects: workspaceProjects, requestedEpisodeId: "episode-b", storedProjectId: "project-a" }), "project-b", "an episode deep link must restore its owning project after refresh");
assert.equal(resolveWorkspaceProjectId({ projects: workspaceProjects, storedProjectId: "project-a" }), "project-a", "workspace routes must retain the last active project when no deep-link scope exists");

const sourceText = "内景。会议室。林夏把录音笔放在桌上，要求陆沉当场解释。";
const sourceHash = manualFilmTeamScriptHash(sourceText);

const baseScene: Scene = {
  id: "scene-preparation",
  title: "会议室对峙",
  description: "林夏以录音笔逼迫陆沉表态。",
  valueCharge: "negative",
  script: sourceText,
  breakdown: {
    setting: "INT.",
    location: { name: "会议室" },
    locationId: "location-meeting-room",
    time: "DAY",
    characters: [{ name: "林夏" }, { name: "陆沉" }],
    characterIds: ["character-linxia", "character-luchen"],
    props: [{ name: "录音笔" }],
    propIds: ["prop-recorder"],
  },
  productionPreparation: {
    schemaVersion: "production-preparation.v1",
    sceneId: "scene-preparation",
    breakdown: { status: "confirmed", sourceHash, confirmedAt: 1 },
    updatedAt: 1,
  },
};

assert.equal(hasProductionSceneSource(baseScene), true);
assert.equal(hasProductionSceneSource({ ...baseScene, script: "", description: "" }), false, "empty scenes must stay out of the production rail");
assert.equal(hasProductionEpisodeSource({ id: "episode-preparation", title: "有效单元", inspiration: "", scenes: [baseScene] }), true);
assert.equal(hasProductionEpisodeSource({ id: "episode-empty", title: "空单元", inspiration: "", scenes: [{ ...baseScene, script: "", description: "" }] }), false, "empty episodes must stay out of production navigation");
assert.equal(hasProductionEpisodeSource({ id: "episode-source-only", sourceDocumentId: "source-1", title: "剧本来源单元", inspiration: "", scenes: [] }), true, "a source work range must be reachable before it has production scenes");
assert.equal(breakdownStatus(baseScene), "已确认");
const legacyBreakdownScene: Scene = { ...baseScene, productionPreparation: undefined };
assert.equal(breakdownStatus(legacyBreakdownScene), "待确认", "legacy structured breakdowns require an explicit author confirmation before entering department preparation");
assert.equal(preparationStartTab(legacyBreakdownScene), "assets", "existing scene information can be used without a preparation approval");

const adoptedBreakdown = productionBreakdownAdoptionUpdates({
  scene: { ...legacyBreakdownScene, id: "scene-pending-1" },
  breakdown: baseScene.breakdown!,
  prompt: "按当前场次剧本生成制片拆解",
  metadata: { selectedSkillIds: ["skill-breakdown"], selectedContextIds: ["episode-preparation"] },
  now: 100,
});
assert.equal(adoptedBreakdown.productionPreparation?.breakdown?.status, "confirmed");
assert.equal(adoptedBreakdown.productionPreparation?.breakdown?.promptAudit?.promptHash, manualFilmTeamScriptHash("按当前场次剧本生成制片拆解"));
assert.deepEqual(adoptedBreakdown.productionPreparation?.breakdown?.promptAudit?.selectedSkillIds, ["skill-breakdown"], "every sequential model result must preserve its editable prompt and Skill audit");
const normalizedStructuredBreakdown = normalizeProductionBreakdown({
  characters: [{ name: "林夏", state: "雨衣湿透" }],
  props: [{ name: "录音笔", state: "正在录音" }],
});
assert.deepEqual(normalizedStructuredBreakdown.characters, [{ name: "林夏", state: "雨衣湿透" }], "structured character states from the model must survive normalization");
assert.deepEqual(normalizedStructuredBreakdown.props, [{ name: "录音笔", state: "正在录音" }], "structured prop states from the model must survive normalization");

const promptProject = {
  id: "project-preparation",
  title: "制片项目",
  type: "movie",
  aspectRatio: "16:9",
  logline: "",
  coreConflict: "",
  characters: [],
  episodes: [],
  assets: [],
} as Project;
const qaChecklistPrompt = productionBreakdownQaChecklistPrompt([
  { id: "identity_stability", label: "稳定资产命名", instruction: "核对稳定身份。" },
  { id: "media_containment", label: "媒介承载边界", instruction: "核对媒介与现场。" },
]);
assert.ok(qaChecklistPrompt.includes('"identity_stability"'), "system-owned QA ids must be present in the audited prompt");
assert.ok(qaChecklistPrompt.includes('"media_containment"'), "every required QA dimension must have a stable response slot");
assert.ok(qaChecklistPrompt.includes('"requiredChecks"'), "the QA response contract must not depend on model-authored subject labels");
const ledgerScene: Scene = {
  ...baseScene,
  scriptBlocks: [
    { id: "heading", type: "scene_heading", content: "内景. 会议室 - 日" },
    { id: "action", type: "action", content: "林夏拿起录音笔，递给陆沉。" },
    { id: "character", type: "character", content: "林夏" },
    { id: "dialogue", type: "dialogue", content: "现在解释。" },
  ],
};
assert.deepEqual(
  productionBreakdownSourceEvidenceLedger(ledgerScene).map((entry) => [entry.ref, entry.type, entry.requiredForQa]),
  [["SRC-001", "source_window", true]],
  "structured screenplay blocks must be compressed into stable evidence windows instead of forcing the model to echo every block id",
);
assert.ok(productionBreakdownSourceEvidenceLedger(ledgerScene)[0].text.includes("[action] 林夏拿起录音笔，递给陆沉。"));
assert.ok(productionBreakdownSourceEvidenceLedger(ledgerScene)[0].text.includes("[dialogue] 现在解释。"));
assert.deepEqual(
  productionBreakdownRequiredSourceRefs(ledgerScene).map((entry) => entry.ref),
  ["SRC-001"],
  "source coverage QA must cover each compact source window without producing an unbounded checklist",
);
const warningQa = finalizeProductionBreakdownQaResult({
  score: 96,
  verdict: "pass",
  summary: "存在需要修改的问题。",
  checks: [{ checkId: "recorder_state", dimension: "连续性", subject: "录音笔", status: "warning", sourceEvidence: "正在录音", candidateEvidence: "状态缺失" }],
  issues: [{ severity: "warning", description: "录音笔状态缺失", suggestion: "补充正在录音状态", checkIds: ["recorder_state"] }],
});
assert.equal(warningQa.verdict, "revise", "a warning must never be silently accepted as a passing breakdown review");
assert.equal(warningQa.score, 84, "material review findings must stay below the passing score threshold");
assert.throws(() => finalizeProductionBreakdownQaResult({
  score: 0,
  verdict: "revise",
  summary: "返回内容不完整。",
  checks: [],
  issues: [],
}), /没有给出可执行的问题和修改建议/, "an incomplete revise response must not become an unusable adopted QA record");
assert.throws(() => finalizeProductionBreakdownQaResult({
  score: 70,
  verdict: "revise",
  summary: "两项检查未通过，但只给出一项修改建议。",
  checks: [
    { checkId: "identity", dimension: "身份", subject: "人物", status: "warning", sourceEvidence: "林夏", candidateEvidence: "林霞" },
    { checkId: "prop_state", dimension: "连续性", subject: "录音笔", status: "warning", sourceEvidence: "正在录音", candidateEvidence: "状态缺失" },
  ],
  issues: [{ severity: "warning", description: "人物名错误", suggestion: "改回林夏", checkIds: ["identity"] }],
}), /未覆盖全部 blocking\/warning 检查：prop_state/, "every material check must have a visible, actionable issue before the QA result can be adopted");

const canonicalBinding = bindProductionBreakdownAssetsToCanonicalRegistry({
  ...promptProject,
  characters: [{ id: "character-linlan", name: "林岚" }],
  plannedCharacters: [{ id: "character-guyan", name: "顾言", roleType: "supporting", brief: "已由剧本规划的正式配角", isDetailed: false }],
  plannedProps: [{ id: "planned-prop-recorder", name: "老式录音机", type: "prop", brief: "剧本规划中曾提及的普通物件", isDetailed: false }],
}, [
  {
    sceneId: "scene-asset-1",
    breakdown: normalizeProductionBreakdown({
      setting: "INT.", time: "NIGHT",
      location: { name: "东站寄存柜大厅", state: "雨夜停电" },
      characters: [{ name: "林岚", state: "右手完好" }, { name: "顾言", state: "湿红色雨衣" }, { name: "围观群众", state: "仅本场背景" }],
      props: [{ name: "黄铜钥匙", state: "完整", requiresAsset: true, assetReason: "跨场状态变化" }],
    }),
  },
  {
    sceneId: "scene-asset-2",
    breakdown: normalizeProductionBreakdown({
      setting: "INT.", time: "CONTINUOUS",
      location: { name: "东站寄存柜大厅", state: "应急灯熄灭" },
      characters: [{ name: "林岚", state: "右手掌割伤" }, { name: "顾言", state: "湿红色雨衣" }],
      props: [
        { name: "黄铜钥匙", state: "齿部开裂", requiresAsset: true, assetReason: "跨场状态变化" },
        { name: "老式录音机", state: "完好", requiresAsset: false, assetReason: "只在本场作为普通物件" },
      ],
    }),
  },
]);
assert.equal(canonicalBinding.characters.length, 2, "repeated character names must resolve to one canonical identity");
assert.equal(canonicalBinding.characters.some((item) => item.name === "围观群众"), false, "incidental scene characters must stay in the breakdown without consuming a formal character board");
assert.equal(canonicalBinding.assets.filter((item) => item.type === "location").length, 1, "location state changes must not create another location identity");
assert.equal(canonicalBinding.assets.filter((item) => item.type === "prop").length, 1, "only identity-critical props should become formal project assets");
const ordinaryRecorder = canonicalBinding.entries[1].breakdown.props.find((item) => productionBreakdownName(item) === "老式录音机");
assert.equal(typeof ordinaryRecorder === "object" && ordinaryRecorder?.requiresAsset, false, "ordinary props must retain the explicit non-asset decision for later review and repair");
assert.equal(canonicalBinding.entries[0].breakdown.characterIds?.[0], "character-linlan", "an existing canonical character id must be reused");
assert.equal(canonicalBinding.entries[0].breakdown.locationId, canonicalBinding.entries[1].breakdown.locationId);
assert.equal(canonicalBinding.entries[0].breakdown.propIds?.[0], canonicalBinding.entries[1].breakdown.propIds?.[0]);
assert.equal((canonicalBinding.entries[1].breakdown.props[0] as { state?: string }).state, "齿部开裂", "state stays on the scene breakdown instead of becoming a second asset");
assert.equal(canonicalBinding.entries[1].breakdown.propIds?.length, 1, "ordinary scene props stay in the breakdown without consuming a formal asset slot");
assert.equal(canonicalBinding.assets.some((item) => item.name === "老式录音机"), false, "a planned prop still needs an explicit key-prop decision before it consumes a formal asset board");

const importedCastBinding = bindProductionBreakdownAssetsToCanonicalRegistry({
  ...promptProject,
  characters: [],
  productionSourceDocuments: [{
    id: "source-cast-list",
    order: 1,
    kind: "episode",
    title: "第一集",
    content: "人物设定\n林渊（男主）：现代古武传人。\n陆天霸（画外/降临BOSS）：化神期太上长老。",
    sourceHash: "source-cast-list-hash",
    createdAt: 1,
  }],
}, [{
  sceneId: "scene-imported-cast",
  breakdown: normalizeProductionBreakdown({
    setting: "EXT.", time: "NIGHT",
    location: { name: "九幽诛仙台", state: "暴雨" },
    characters: [
      { name: "林渊", state: "受伤" },
      { name: "陆天霸", state: "画外传音" },
      { name: "围观群众", state: "仅本场背景" },
    ],
    props: [],
  }),
}]);
assert.deepEqual(
  importedCastBinding.characters.map((item) => item.name),
  ["林渊", "陆天霸"],
  "explicit character profiles in an imported script must become formal character assets without promoting incidental crowds",
);

const plainScriptProject = {
  ...promptProject,
  characters: [],
  plannedCharacters: [],
  assets: [],
  productionSourceDocuments: [{ id: "plain-script", order: 1, kind: "episode" as const, title: "纯剧本", content: "宁观澜跪在阵盘旁。苏挽伸出手。年轻弟子：阵盘坏了吗？", sourceHash: "plain-script-hash", createdAt: 1 }],
};
const plainScriptBinding = bindProductionBreakdownAssetsToCanonicalRegistry(plainScriptProject, [
  { sceneId: "plain-scene-1", breakdown: normalizeProductionBreakdown({ location: "撤离阵", characters: [{ name: "宁观澜", state: "半边袍子烧焦" }, { name: "苏挽", state: "指尖出血" }, { name: "年轻弟子", state: "脸色发白并开口询问" }], props: [] }) },
  { sceneId: "plain-scene-2", breakdown: normalizeProductionBreakdown({ location: "撤离阵", characters: ["苏挽", "年轻阵师", "围观群众"], props: [] }) },
]);
assert.deepEqual(plainScriptBinding.characters.map((item) => item.name), ["宁观澜", "苏挽", "年轻弟子", "年轻阵师"], "plain scripts register adopted individual roles without requiring a cast list, and do not guess that similar role names are the same person");
assert.equal(plainScriptBinding.entries[0].breakdown.characterIds?.length, 3);
assert.equal(plainScriptBinding.entries[0].breakdown.characterIds?.[1], plainScriptBinding.entries[1].breakdown.characterIds?.[0], "subsequent scenes reuse the adopted stable identity");
assert.equal(plainScriptBinding.characters.some((item) => Boolean(item.boardImageUrl || item.referenceImageUrl)), false, "registering an identity does not fabricate a character reference image");
assert.deepEqual(plainScriptProject.characters, [], "adoption binding does not mutate the caller's source snapshot");
const reboundPlainScript = bindProductionBreakdownAssetsToCanonicalRegistry({ ...plainScriptProject, characters: plainScriptBinding.characters, assets: plainScriptBinding.assets }, plainScriptBinding.entries);
assert.deepEqual(reboundPlainScript.entries.map((entry) => entry.breakdown.characterIds), plainScriptBinding.entries.map((entry) => entry.breakdown.characterIds));
assert.equal(reboundPlainScript.createdCounts.characters, 0, "re-adopting a previously broken breakdown repairs its links without duplicating registered roles");

const frozenCharacter = Object.freeze({
  id: "character-linlan",
  name: "林岚",
  variants: Object.freeze([{ id: "variant-base", name: "基础状态", description: "右手完好" }]),
});
const syncedCharacters = syncCharactersFromCharacterAssets(
  [frozenCharacter as any],
  [{
    id: "char-character-linlan",
    type: "character",
    name: "林岚",
    variants: [{ id: "variant-injured", name: "受伤状态", description: "右手掌割伤" }],
  } as any],
);
assert.notEqual(syncedCharacters[0], frozenCharacter, "asset synchronization must clone persisted character records instead of mutating frozen project state");
assert.equal(syncedCharacters[0].variants?.[0]?.id, "variant-injured", "cross-episode asset variants must synchronize through immutable character updates");

const requiredDepartments = recommendedDepartmentsForScene(baseScene);
const physicalConflictDepartments = recommendedDepartmentsForScene({
  ...baseScene,
  id: "scene-physical-conflict",
  breakdown: {
    ...baseScene.breakdown!,
    characters: [
      { name: "陆成", state: "护住设备，与来人爆发剧烈物理对抗" },
      { name: "老周", state: "手持重型扳手并发生剧烈推搡" },
    ],
  },
});
assert.ok(
  physicalConflictDepartments.includes("action_choreography"),
  "structured physical conflict must require action preparation before Shot planning introduces choreography details",
);
const scriptedActionDepartments = recommendedDepartmentsForScene({
  ...baseScene,
  id: "scene-scripted-action",
  script: "老周突然冲向接收台，陆成侧身护住设备，重型扳手砸碎台灯。",
});
assert.ok(
  scriptedActionDepartments.includes("action_choreography"),
  "action evidence already present in the screenplay must require action preparation before storyboard adoption",
);
const departmentReadyScene: Scene = {
  ...baseScene,
};
assert.ok(requiredDepartments.length < MANUAL_FILM_TEAM_DEPARTMENTS.length, "the current scene must require only departments justified by its structured breakdown");
const departmentReadyEpisode: Episode = {
  id: "episode-preparation",
  title: "有效单元",
  inspiration: "",
  scenes: [departmentReadyScene],
  productionTeam: {
    schemaVersion: "manual-film-team.v2",
    episodeId: "episode-preparation",
    sourceScriptHash: sourceHash,
    sourceBreakdownHash: "breakdown-hash",
    fullScriptHash: "full-script-hash",
    sourceSceneIds: [baseScene.id],
    outputs: MANUAL_FILM_TEAM_DEPARTMENTS.map(({ id: department }) => ({
      department,
      sourceScriptHash: sourceHash,
      sourceBreakdownHash: "breakdown-hash",
      fullScriptHash: "full-script-hash",
      status: "confirmed",
    })) as any,
    updatedAt: 1,
  },
};

assert.equal(preparationStartTab(departmentReadyScene, departmentReadyEpisode), "assets", "after all unit departments are confirmed, the next task is scene asset confirmation");
assert.deepEqual(preparationStepSummaries(departmentReadyScene, departmentReadyEpisode).map((step) => step.state), ["complete", "pending"]);

const assetConfirmedScene: Scene = {
  ...departmentReadyScene,
  productionPreparation: {
    ...departmentReadyScene.productionPreparation!,
    assetPack: { sourceHash: "asset-pack-hash", confirmedAt: 2 },
    updatedAt: 2,
  },
};
assert.equal(preparationStartTab(assetConfirmedScene, departmentReadyEpisode), "assets");
assert.deepEqual(preparationStepSummaries(assetConfirmedScene, departmentReadyEpisode).map((step) => step.state), ["complete", "complete"]);

const coordinationConfirmedScene: Scene = {
  ...assetConfirmedScene,
  shots: [{ id: "manual-shot", visualAction: "A manually authored shot" } as Scene["shots"][number]],
  productionPreparation: {
    ...assetConfirmedScene.productionPreparation!,
    coordination: { sourceHash: "asset-pack-hash", confirmedAt: 3 },
    updatedAt: 3,
  },
};
assert.deepEqual(preparationStepSummaries(coordinationConfirmedScene, departmentReadyEpisode).map((step) => step.state), ["complete", "complete"]);

const readyFilmTeam = {
  sourceScriptHash: sourceHash,
  directorCockpit: {
    readyForStoryboard: true,
    blockedDepartments: 0,
    needsReviewDepartments: 0,
    confirmedDepartments: 0,
  },
  coverage: [],
} as ManualFilmTeamReadModel;
const assetContinuityPendingFilmTeam = {
  ...readyFilmTeam,
  directorCockpit: { ...readyFilmTeam.directorCockpit, readyForStoryboard: false, continuityNeedsReview: 2 },
} as ManualFilmTeamReadModel;
const readyAssets = {
  assetPackHash: "asset-pack-hash",
  readyForShotPlanning: true,
  readyForStoryboardGeneration: true,
  issues: [],
} as ManualProductionAssetReadModel;
const blockedDepartmentFilmTeam = {
  sourceScriptHash: sourceHash,
  coverage: [{ department: "cinematography", name: "摄影", readiness: "blocked", reasons: ["尚未生成部门筹备结果。"] }],
} as ManualFilmTeamReadModel;
assert.deepEqual(
  buildProductionPreparationCurrentTask({ scene: baseScene, filmTeam: blockedDepartmentFilmTeam, assets: readyAssets }),
  { tab: "assets", title: "进入分镜制作", detail: "可直接根据本场原文制作分镜，资产按需补充。", state: "complete" },
  "missing department reports must not insert another task before storyboard production",
);
assert.equal(
  buildProductionPreparationCurrentTask({ scene: departmentReadyScene, filmTeam: readyFilmTeam, assets: readyAssets }).title,
  "进入分镜制作",
  "scene facts can proceed directly to storyboard production",
);
assert.equal(
  nextIncompleteProductionSceneId([{ id: "scene-1" }, { id: "scene-2" }, { id: "scene-3" }] as Scene[], "scene-1", (scene) => scene.id !== "scene-3"),
  "scene-2",
  "next scene navigation must skip the current scene and preserve scene order",
);
assert.equal(
  nextIncompleteProductionSceneId([{ id: "scene-1" }, { id: "scene-2" }, { id: "scene-3" }] as Scene[], "scene-2", (scene) => scene.id === "scene-1"),
  "scene-1",
  "next scene navigation must wrap within the current episode",
);
assert.equal(
  buildProductionPreparationCurrentTask({ scene: coordinationConfirmedScene, filmTeam: readyFilmTeam, assets: readyAssets }).title,
  "进入分镜制作",
  "a fully confirmed scene must guide the author to the next manual workflow stage",
);
assert.equal(buildProductionPreparationGate({ scene: assetConfirmedScene, filmTeam: readyFilmTeam, assets: readyAssets }).readyForStoryboard, false, "asset confirmation alone must not unlock storyboard generation");
assert.equal(
  buildProductionPreparationGate({ scene: assetConfirmedScene, filmTeam: readyFilmTeam, assets: readyAssets }).readyForShotPlanning,
  true,
  "shot planning must not wait for the later coordination confirmation once scene facts are ready",
);
const missingReferenceAssets = {
  ...readyAssets,
  readyForStoryboardGeneration: false,
  missingReferenceCount: 2,
} as ManualProductionAssetReadModel;
const missingReferenceGate = buildProductionPreparationGate({
  scene: coordinationConfirmedScene,
  filmTeam: readyFilmTeam,
  assets: missingReferenceAssets,
});
assert.equal(missingReferenceGate.readyForShotPlanning, true, "missing reference images must not block the text-level Shot plan");
assert.equal(missingReferenceGate.readyForStoryboard, true, "manual work may continue without asset approval");
assert.equal(missingReferenceGate.storyboardReason, undefined);
assert.ok(missingReferenceGate.advisories.some((item) => item.includes("2 项资产未提供参考图")), "Missing references must remain visible as advice");
const readyGate = buildProductionPreparationGate({ scene: coordinationConfirmedScene, filmTeam: readyFilmTeam, assets: readyAssets });
assert.equal(readyGate.readyForShotPlanning, true);
assert.equal(readyGate.readyForStoryboard, true);
assert.equal(readyGate.reason, undefined);
const continuityPendingGate = buildProductionPreparationGate({ scene: coordinationConfirmedScene, filmTeam: assetContinuityPendingFilmTeam, assets: readyAssets });
assert.equal(continuityPendingGate.departmentsReady, true, "confirmed department outputs remain complete while continuity is reviewed");
assert.equal(continuityPendingGate.continuityReady, true, "continuity review suggestions must remain advisory");
assert.equal(continuityPendingGate.readyForShotPlanning, true, "continuity suggestions must not block Shot planning");
assert.equal(continuityPendingGate.readyForStoryboard, true, "continuity suggestions must not revoke author-confirmed coordination");
assert.equal(continuityPendingGate.shotPlanningReason, undefined);
const multiSceneUnitFilmTeam = { ...readyFilmTeam, sourceScriptHash: manualFilmTeamScriptHash(`${sourceText}\n第二场正文`) } as ManualFilmTeamReadModel;
assert.equal(
  buildProductionPreparationGate({ scene: coordinationConfirmedScene, filmTeam: multiSceneUnitFilmTeam, assets: readyAssets }).breakdownReady,
  true,
  "a confirmed scene breakdown must be checked against its own source hash, not the whole-unit department source hash",
);
assert.deepEqual(
  buildProductionPreparationTabStatuses({ scene: coordinationConfirmedScene, filmTeam: readyFilmTeam, assets: readyAssets }).map((status) => status.label),
  ["已导入", "已确认", "已确认"],
  "the visible tabs must reflect the same approved facts as the production gate",
);
assert.deepEqual(
  buildProductionPreparationTabStatuses({ scene: departmentReadyScene, filmTeam: readyFilmTeam, assets: readyAssets }).map((status) => status.label),
  ["已导入", "已确认", "可编辑"],
  "asset and review tabs must expose the next author action instead of a generic progress light",
);
assert.equal(
  buildProductionPreparationTabStatuses({ scene: departmentReadyScene, filmTeam: assetContinuityPendingFilmTeam, assets: readyAssets }).find((status) => status.id === "departments")?.label,
  undefined,
  "removed department work must not appear in the visible tabs",
);
const changedAssetPack = { ...readyAssets, assetPackHash: "asset-pack-hash-v2" } as ManualProductionAssetReadModel;
const staleAssetPackGate = buildProductionPreparationGate({ scene: coordinationConfirmedScene, filmTeam: readyFilmTeam, assets: changedAssetPack });
assert.equal(staleAssetPackGate.assetPackConfirmed, true, "a changed formal asset pack must preserve the prior author confirmation");
assert.equal(staleAssetPackGate.coordinationConfirmed, true, "a changed formal asset pack must preserve coordination confirmation");
assert.equal(staleAssetPackGate.assetPackSourceChanged, true);
assert.equal(staleAssetPackGate.coordinationSourceChanged, true);
assert.equal(staleAssetPackGate.readyForShotPlanning, true, "asset pack reconfirmation belongs to formal storyboard generation, not Shot planning");
assert.equal(staleAssetPackGate.readyForStoryboard, true);
assert.equal(staleAssetPackGate.reason, undefined);
assert.ok(staleAssetPackGate.advisories.some((item) => item.includes("已保留本场资产包确认")));
assert.deepEqual(
  buildProductionPreparationTabStatuses({ scene: coordinationConfirmedScene, filmTeam: readyFilmTeam, assets: changedAssetPack }).map((status) => status.label),
  ["已导入", "已确认", "已确认"],
  "source changes must not revoke visible author confirmations",
);

const staleScene: Scene = { ...coordinationConfirmedScene, script: `${sourceText}\n林夏转身离开。` };
assert.equal(breakdownStatus(staleScene), "已确认");
assert.equal(breakdownSourceChanged(staleScene), true);
assert.equal(preparationStartTab(staleScene, departmentReadyEpisode), "assets", "script changes must preserve the user's completed workflow and surface only an advisory");
const staleSceneGate = buildProductionPreparationGate({ scene: staleScene, filmTeam: readyFilmTeam, assets: readyAssets });
assert.equal(staleSceneGate.breakdownReady, true);
assert.ok(staleSceneGate.advisories.some((item) => item.includes("已保留原拆解确认")));

const revisionRequiredScene: Scene = {
  ...coordinationConfirmedScene,
  productionPreparation: {
    ...coordinationConfirmedScene.productionPreparation!,
    breakdown: { ...coordinationConfirmedScene.productionPreparation!.breakdown!, status: "needs_revision" },
  },
};
assert.equal(breakdownStatus(revisionRequiredScene), "需优化");
assert.equal(preparationStartTab(revisionRequiredScene), "assets");

const continuityProject = {
  id: "continuity-structured-project",
  title: "结构化连续性测试",
  type: "movie",
  aspectRatio: "16:9",
  logline: "验证多角色状态与资产变体保持独立。",
  coreConflict: "",
  characters: [
    { id: "character-a", name: "角色甲" },
    { id: "character-b", name: "角色乙" },
  ],
  assets: [
    { id: "location-room", type: "location", name: "工作室" },
    { id: "prop-photo", type: "prop", name: "相片" },
  ],
  episodes: [{
    id: "continuity-episode",
    title: "连续性单元",
    inspiration: "",
    scenes: [
      {
        id: "continuity-scene-1",
        title: "初始状态",
        description: "两名角色查看尚未显影的相片。",
        valueCharge: "negative",
        breakdown: {
          setting: "INT.",
          location: { name: "工作室", state: "暖光" },
          locationId: "location-room",
          time: "NIGHT",
          characters: [
            { name: "角色甲", state: "深色外套" },
            { name: "角色乙", state: "银色耳钉" },
          ],
          characterIds: ["character-a", "character-b"],
          props: [{ name: "相片", state: "尚未显影" }],
          propIds: ["prop-photo"],
          wardrobe: ["角色甲：深色外套", "角色乙：浅色衬衫"],
          makeupHair: ["角色甲：短发", "角色乙：银色耳钉"],
          assetVariantMap: {
            "location-room": "location-warm",
            "prop-photo": "photo-initial",
          },
        },
      },
      {
        id: "continuity-scene-2",
        title: "计划内变化",
        description: "灯光转红，相片进入显影状态。",
        valueCharge: "positive",
        breakdown: {
          setting: "INT.",
          location: { name: "工作室", state: "红光" },
          locationId: "location-room",
          time: "NIGHT",
          characters: [
            { name: "角色甲", state: "深色外套" },
            { name: "角色乙", state: "银色耳钉" },
          ],
          characterIds: ["character-a", "character-b"],
          props: [{ name: "相片", state: "显影中" }],
          propIds: ["prop-photo"],
          wardrobe: ["角色甲：深色外套", "角色乙：浅色衬衫"],
          makeupHair: ["角色甲：短发", "角色乙：银色耳钉"],
          assetVariantMap: {
            "location-room": "location-red",
            "prop-photo": "photo-developing",
          },
        },
      },
    ],
  }],
} as unknown as Project;
const continuityReport = buildProductionBreakdownReport({
  project: continuityProject,
  episodes: continuityProject.episodes as Episode[],
  scope: {
    mode: "movie",
    episodeIds: ["continuity-episode"],
    sceneIds: ["continuity-scene-1", "continuity-scene-2"],
    sourceLockIds: ["continuity-lock"],
  },
  createdAt: 10,
});
const continuityPackages = buildDepartmentPrepPackages(continuityProject, continuityReport, 11);
const structuredContinuityMatrix = buildContinuityMatrix({
  project: continuityProject,
  productionBreakdownReport: continuityReport,
  departmentPrepPackages: continuityPackages,
  createdAt: 12,
});
const characterASecondScene = structuredContinuityMatrix.rows.find((row) =>
  row.sceneId === "continuity-scene-2" && row.targetType === "character" && row.targetId === "character-a",
);
assert.ok(characterASecondScene);
assert.equal(characterASecondScene.continuityIn.includes("银色耳钉"), false, "one character must never inherit another character's structured state");
assert.equal(characterASecondScene.riskLevel, "clear", "stable character state must not become a false handoff warning");
assert.equal(
  structuredContinuityMatrix.rows.find((row) => row.sceneId === "continuity-scene-2" && row.targetType === "location")?.riskLevel,
  "clear",
  "a location state change with an asset-specific variant transition must be accepted",
);
assert.equal(
  structuredContinuityMatrix.rows.find((row) => row.sceneId === "continuity-scene-2" && row.targetType === "prop")?.riskLevel,
  "clear",
  "a prop state change with an asset-specific variant transition must be accepted",
);
assert.equal(
  structuredContinuityMatrix.rows.filter((row) => row.targetType === "wardrobe_makeup").length,
  2,
  "multi-character wardrobe and makeup notes must remain one scene-level ledger instead of being copied onto every character",
);

const selectiveAssetContinuityProject = {
  ...continuityProject,
  id: "continuity-selective-asset-project",
  episodes: [{
    ...(continuityProject.episodes as Episode[])[0],
    scenes: [{
      id: "continuity-selective-asset-scene",
      title: "按需正式资产",
      description: "主角经过路人身边，桌上放着普通纸杯和需要跨场保持一致的钥匙。",
      valueCharge: "positive",
      breakdown: {
        setting: "INT.",
        location: { name: "工作室", state: "暖光" },
        locationId: "location-room",
        time: "DAY",
        characters: [{ name: "角色甲" }, { name: "路人" }],
        characterIds: [],
        props: [
          { name: "普通纸杯", requiresAsset: false },
          { name: "关键钥匙", requiresAsset: true, assetReason: "跨场传递线索" },
          { name: "相片" },
        ],
        propIds: [],
      },
    }],
  }],
} as unknown as Project;
const selectiveAssetContinuityReport = buildProductionBreakdownReport({
  project: selectiveAssetContinuityProject,
  episodes: selectiveAssetContinuityProject.episodes as Episode[],
  scope: {
    mode: "movie",
    episodeIds: ["continuity-episode"],
    sceneIds: ["continuity-selective-asset-scene"],
    sourceLockIds: ["continuity-selective-asset-lock"],
  },
  createdAt: 13,
});
const selectiveAssetContinuityMatrix = buildContinuityMatrix({
  project: selectiveAssetContinuityProject,
  productionBreakdownReport: selectiveAssetContinuityReport,
  departmentPrepPackages: buildDepartmentPrepPackages(selectiveAssetContinuityProject, selectiveAssetContinuityReport, 14),
  createdAt: 15,
});
const selectiveAssetRow = (targetType: "character" | "prop", targetName: string) =>
  selectiveAssetContinuityMatrix.rows.find((row) => row.targetType === targetType && row.targetName === targetName);
assert.equal(selectiveAssetRow("character", "路人")?.riskLevel, "clear", "an incidental character must not be forced into the formal asset library");
assert.equal(selectiveAssetRow("prop", "普通纸杯")?.riskLevel, "clear", "an ordinary scene prop must not be forced into the formal asset library");
assert.equal(selectiveAssetRow("prop", "关键钥匙")?.riskLevel, "blocked", "a prop explicitly marked for asset consistency must still require a canonical assetId");
assert.equal(selectiveAssetRow("character", "角色甲")?.riskLevel, "blocked", "an existing project character with a missing binding must remain blocked");
assert.equal(selectiveAssetRow("prop", "相片")?.riskLevel, "blocked", "an existing project prop with a missing binding must remain blocked");

const unmodeledContinuityProject = {
  ...continuityProject,
  id: "continuity-unmodeled-project",
  episodes: (continuityProject.episodes as Episode[]).map((episode) => ({
    ...episode,
    scenes: episode.scenes.map((scene) => ({
      ...scene,
      breakdown: {
        ...scene.breakdown!,
        assetVariantMap: { "location-room": scene.id === "continuity-scene-1" ? "location-warm" : "location-red" },
      },
    })),
  })),
} as unknown as Project;
const unmodeledContinuityReport = buildProductionBreakdownReport({
  project: unmodeledContinuityProject,
  episodes: unmodeledContinuityProject.episodes as Episode[],
  scope: {
    mode: "movie",
    episodeIds: ["continuity-episode"],
    sceneIds: ["continuity-scene-1", "continuity-scene-2"],
    sourceLockIds: ["continuity-lock"],
  },
  createdAt: 13,
});
const unmodeledContinuityMatrix = buildContinuityMatrix({
  project: unmodeledContinuityProject,
  productionBreakdownReport: unmodeledContinuityReport,
  departmentPrepPackages: buildDepartmentPrepPackages(unmodeledContinuityProject, unmodeledContinuityReport, 14),
  createdAt: 15,
});
assert.equal(
  unmodeledContinuityMatrix.rows.find((row) => row.sceneId === "continuity-scene-2" && row.targetType === "prop")?.riskLevel,
  "needs_review",
  "an actual prop state change without its own variant or reconciled handoff must remain visible to the continuity Agent",
);
const agentReviewedPackages = buildDepartmentPrepPackages(unmodeledContinuityProject, unmodeledContinuityReport, 16)
  .map((prepPackage) => prepPackage.department === "continuity" ? {
    ...prepPackage,
    ownerAgentId: "manual.department.continuity",
    specialistPayload: {
      ...prepPackage.specialistPayload,
      manualOutput: {
        status: "confirmed",
        qaVerdict: "pass",
        qaScore: 95,
        openQuestionCount: 0,
        reviewedSceneIds: ["continuity-scene-1", "continuity-scene-2"],
      },
    },
  } : prepPackage);
const agentReviewedContinuityMatrix = buildContinuityMatrix({
  project: unmodeledContinuityProject,
  productionBreakdownReport: unmodeledContinuityReport,
  departmentPrepPackages: agentReviewedPackages,
  createdAt: 17,
});
assert.equal(
  agentReviewedContinuityMatrix.rows.find((row) => row.sceneId === "continuity-scene-2" && row.targetType === "prop")?.riskLevel,
  "clear",
  "a confirmed, passing continuity Agent with complete scene coverage must resolve semantic transitions instead of sending them back to the creator",
);
assert.equal(
  agentReviewedContinuityMatrix.rows.every((row) => row.reviewedByAgent),
  true,
  "the continuity matrix must retain the Agent review audit on every covered row",
);

const reviewedWithDeferredQuestionPackages = agentReviewedPackages.map((prepPackage) => prepPackage.department === "continuity" ? {
  ...prepPackage,
  specialistPayload: {
    ...prepPackage.specialistPayload,
    manualOutput: {
      status: "confirmed",
      qaVerdict: "pass",
      qaScore: 95,
      openQuestionCount: 1,
      reviewedSceneIds: ["continuity-scene-1", "continuity-scene-2"],
    },
  },
  openQuestions: ["资产确认会在后续页面锁定同一套参考。"],
} : prepPackage);
const reviewedWithDeferredQuestionMatrix = buildContinuityMatrix({
  project: unmodeledContinuityProject,
  productionBreakdownReport: unmodeledContinuityReport,
  departmentPrepPackages: reviewedWithDeferredQuestionPackages,
  createdAt: 18,
});
assert.equal(
  reviewedWithDeferredQuestionMatrix.rows.every((row) => row.reviewedByAgent),
  true,
  "a confirmed passing continuity review must remain authoritative when it records a separately owned downstream follow-up",
);

console.log("Production preparation self-check passed.");
