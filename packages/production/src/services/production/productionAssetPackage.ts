import type { Project } from "../../../../../src/types/project";
import type { ProductionQAIssue } from "../../../../../src/types/production";
import type { CastingDecision } from "./productionCasting";
import type { DepartmentPrepPackage, ProductionBreakdownReport, ProductionPrepDepartment, ProductionSceneMatrixRow } from "./productionPrep";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";
import type { SceneVisualPack } from "./videoStoryboardArtifacts";
import type { VideoStoryboardAssetBoardItem, VideoStoryboardAssetBoardPlan } from "./videoStoryboardAssetBoards";

export type FormalAssetPackageStatus = "blocked" | "ready_for_department_review" | "approved";

export interface FormalAssetUsageRef {
  episodeId?: string;
  sceneId?: string;
  nodeId?: string;
  shotIds: string[];
  title?: string;
}

export interface AssetIdentityBoard {
  schemaVersion: "asset-identity-board.v1";
  id: string;
  projectId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  boardItemId: string;
  boardKind: VideoStoryboardAssetBoardItem["boardKind"];
  strategyId?: string;
  prompt?: string;
  referenceImageUrl?: string;
  readiness: VideoStoryboardAssetBoardItem["readiness"];
  productionUse: VideoStoryboardAssetBoardItem["productionUse"];
  styleLockSummary?: string;
  sourceRefs: {
    assetBoardPlanId: string;
    castingDecisionIds: string[];
    productionBreakdownReportId?: string;
    departmentPrepPackageIds: string[];
  };
  usageRefs: FormalAssetUsageRef[];
}

export interface FormalAssetPackage {
  schemaVersion: "formal-asset-package.v1";
  id: string;
  projectId: string;
  status: FormalAssetPackageStatus;
  productionReadiness: VideoStoryboardAssetBoardPlan["productionReadiness"];
  sourceRefs: {
    assetBoardPlanId: string;
    scriptLockPackageId?: string;
    contentLockPackageId?: string;
    productionBlockLockId?: string;
    productionBreakdownReportId?: string;
    castingRequirementIds: string[];
    castingDecisionIds: string[];
    departmentPrepPackageIds: string[];
  };
  identityBoards: AssetIdentityBoard[];
  packageBlockers: string[];
  departments: ProductionPrepDepartment[];
  usageRefs: FormalAssetUsageRef[];
  createdAt: number;
}

export interface AssetVariantFingerprint {
  schemaVersion: "asset-variant-fingerprint.v1";
  id: string;
  fingerprint: string;
  projectId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  variantId?: string;
  stateSummary: string;
}

export interface SceneAssetVariantPack {
  schemaVersion: "scene-asset-variant-pack.v1";
  id: string;
  projectId: string;
  formalAssetPackageId: string;
  sceneVisualPackId?: string;
  visualFingerprint: string;
  reuseOfPackId?: string;
  sourceSceneIds: string[];
  linkedSceneIds: string[];
  usageRefs: FormalAssetUsageRef[];
  variantFingerprints: AssetVariantFingerprint[];
  readiness: "reusable" | "single_use" | "blocked";
  qaChecklist: string[];
  createdAt: number;
}

export interface BuildFormalAssetPackageInput {
  project: Project;
  assetBoardPlan: VideoStoryboardAssetBoardPlan;
  productionBreakdownReport?: Partial<ProductionBreakdownReport>;
  castingDecisions?: Partial<CastingDecision>[];
  departmentPrepPackages?: Partial<DepartmentPrepPackage>[];
  createdAt?: number;
}

export interface BuildSceneAssetVariantPacksInput {
  projectId: string;
  formalAssetPackage: FormalAssetPackage;
  sceneVisualPacks?: Partial<SceneVisualPack>[];
  createdAt?: number;
}

const clean = (value: unknown) => String(value || "").trim();

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map(clean).filter(Boolean)));

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const createAssetVariantFingerprint = (input: {
  projectId: string;
  assetId: string;
  assetType: AssetVariantFingerprint["assetType"];
  variantId?: string;
  stateSummary?: string;
}) => `avf.${stableHash(stableStringify({
  projectId: input.projectId,
  assetId: input.assetId,
  assetType: input.assetType,
  variantId: clean(input.variantId),
  stateSummary: clean(input.stateSummary),
}))}`;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: nowId("formal_asset_package_issue"),
  severity,
  target,
  message,
  suggestion,
  repairInstruction: suggestion || message,
  issueType: "formal_asset_package_contract",
  retryable: severity !== "blocking",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "soft_hold",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const boardItems = (plan: VideoStoryboardAssetBoardPlan): VideoStoryboardAssetBoardItem[] => [
  ...asArray<VideoStoryboardAssetBoardItem>(plan.characterBoards),
  ...asArray<VideoStoryboardAssetBoardItem>(plan.sceneBoards),
  ...asArray<VideoStoryboardAssetBoardItem>(plan.propBoards),
  ...asArray<VideoStoryboardAssetBoardItem>(plan.vehicleBoards),
  ...asArray<VideoStoryboardAssetBoardItem>(plan.variantBoards),
];

const rowUsesAsset = (row: ProductionSceneMatrixRow, item: VideoStoryboardAssetBoardItem) => {
  if (item.assetType === "character") return asArray<string>(row.characterIds).includes(item.assetId);
  if (item.assetType === "location") return row.locationId === item.assetId;
  if (item.assetType === "prop") return asArray<string>(row.propIds).includes(item.assetId);
  if (item.assetType === "vehicles") return asArray<string>(row.vehicleIds).includes(item.assetId);
  return false;
};

const usageRefsForItem = (
  item: VideoStoryboardAssetBoardItem,
  report?: Partial<ProductionBreakdownReport>,
): FormalAssetUsageRef[] => asArray<ProductionSceneMatrixRow>(report?.sceneMatrix)
  .filter((row) => rowUsesAsset(row, item) || (item.variantId ? asArray<string>(row.variantRefs).includes(item.variantId) : false))
  .map((row) => ({
    episodeId: row.episodeId,
    sceneId: row.sceneId,
    nodeId: row.nodeId,
    shotIds: asArray<string>(row.shotIds),
    title: row.title,
  }));

const departmentsFromPrep = (packages: Partial<DepartmentPrepPackage>[]) =>
  uniq(packages.map((item) => item.department)).filter((department): department is ProductionPrepDepartment => Boolean(department));

const approvedDecisionIds = (decisions: Partial<CastingDecision>[]) =>
  decisions.filter((decision) => decision.status === "approved").map((decision) => clean(decision.id)).filter(Boolean);

export const buildFormalAssetPackage = ({
  project,
  assetBoardPlan,
  productionBreakdownReport,
  castingDecisions = [],
  departmentPrepPackages = [],
  createdAt = Date.now(),
}: BuildFormalAssetPackageInput): FormalAssetPackage => {
  const decisions = asArray<Partial<CastingDecision>>(castingDecisions);
  const prepPackages = asArray<Partial<DepartmentPrepPackage>>(departmentPrepPackages);
  const sourceRefs = {
    assetBoardPlanId: assetBoardPlan.id,
    scriptLockPackageId: assetBoardPlan.productionPrepRefs?.scriptLockPackageId,
    contentLockPackageId: assetBoardPlan.productionPrepRefs?.contentLockPackageId,
    productionBlockLockId: assetBoardPlan.productionPrepRefs?.productionBlockLockId,
    productionBreakdownReportId: clean(productionBreakdownReport?.id || assetBoardPlan.productionPrepRefs?.productionBreakdownReportId) || undefined,
    castingRequirementIds: uniq(assetBoardPlan.productionPrepRefs?.castingRequirementIds || []),
    castingDecisionIds: uniq([
      ...approvedDecisionIds(decisions),
      ...asArray<string>(assetBoardPlan.productionPrepRefs?.castingDecisionIds),
    ]),
    departmentPrepPackageIds: uniq([
      ...prepPackages.map((item) => item.id),
      ...asArray<string>(assetBoardPlan.productionPrepRefs?.departmentPrepPackageIds),
    ]),
  };
  const identityBoards: AssetIdentityBoard[] = boardItems(assetBoardPlan)
    .filter((item) => item.productionUse === "formal_asset_board")
    .map((item) => ({
      schemaVersion: "asset-identity-board.v1",
      id: `${item.id}.identity_board`,
      projectId: project.id,
      assetId: item.assetId,
      assetType: item.assetType,
      assetName: item.assetName,
      boardItemId: item.id,
      boardKind: item.boardKind,
      strategyId: item.strategyId,
      prompt: item.prompt,
      referenceImageUrl: item.referenceImageUrl,
      readiness: item.readiness,
      productionUse: item.productionUse,
      styleLockSummary: item.styleLockSummary,
      sourceRefs: {
        assetBoardPlanId: assetBoardPlan.id,
        castingDecisionIds: sourceRefs.castingDecisionIds,
        productionBreakdownReportId: sourceRefs.productionBreakdownReportId,
        departmentPrepPackageIds: sourceRefs.departmentPrepPackageIds,
      },
      usageRefs: usageRefsForItem(item, productionBreakdownReport),
    }));
  const usageRefs = Array.from(new Map(identityBoards.flatMap((item) => item.usageRefs).map((ref) => [
    `${ref.episodeId || ""}:${ref.sceneId || ""}:${ref.nodeId || ""}`,
    ref,
  ])).values());
  const packageBlockers = [
    assetBoardPlan.productionReadiness === "formal_ready" ? "" : `asset_board_plan 未 formal_ready：${assetBoardPlan.productionReadiness}`,
    sourceRefs.productionBreakdownReportId ? "" : "缺少 production_breakdown_report。",
    sourceRefs.castingDecisionIds.length ? "" : "缺少 approved casting_decision。",
    sourceRefs.departmentPrepPackageIds.length ? "" : "缺少 department_prep_package。",
    identityBoards.length ? "" : "缺少 formal_asset_board identity board。",
  ].filter(Boolean);
  return {
    schemaVersion: "formal-asset-package.v1",
    id: `${project.id}.formal_asset_package.${stableHash(assetBoardPlan.id + sourceRefs.castingDecisionIds.join("|"))}`,
    projectId: project.id,
    status: packageBlockers.length ? "blocked" : "ready_for_department_review",
    productionReadiness: assetBoardPlan.productionReadiness,
    sourceRefs,
    identityBoards,
    packageBlockers,
    departments: departmentsFromPrep(prepPackages),
    usageRefs,
    createdAt,
  };
};

const usageRefsFromSceneVisualPack = (pack: Partial<SceneVisualPack>): FormalAssetUsageRef[] =>
  uniq([...(pack.linkedSceneIds || []), ...(pack.sourceSceneIds || [])]).map((sceneId) => ({
    episodeId: pack.episodeId,
    sceneId,
    shotIds: [],
  }));

const scenePackAssetFingerprints = (
  projectId: string,
  pack: Partial<SceneVisualPack>,
): AssetVariantFingerprint[] => {
  const fingerprints: AssetVariantFingerprint[] = [];
  const push = (
    assetId: string | undefined,
    assetType: AssetVariantFingerprint["assetType"],
    variantId: string | undefined,
    stateSummary: string,
  ) => {
    if (!assetId) return;
    const fingerprint = createAssetVariantFingerprint({ projectId, assetId, assetType, variantId, stateSummary });
    fingerprints.push({
      schemaVersion: "asset-variant-fingerprint.v1",
      id: `${assetId}.${variantId || "base"}.${fingerprint}`,
      fingerprint,
      projectId,
      assetId,
      assetType,
      variantId: clean(variantId) || undefined,
      stateSummary: clean(stateSummary) || "base",
    });
  };
  push(pack.location?.assetId, "location", pack.location?.variantId, [
    pack.location?.setDressingState,
    pack.location?.timeOfDay,
    pack.location?.lightingState,
    pack.location?.damageState,
  ].map(clean).filter(Boolean).join(" / "));
  for (const character of asArray<any>(pack.characters)) {
    push(character.characterId, "character", character.variantId, [
      character.continuityState,
      character.costumeState,
      character.makeupState,
      character.hairState,
      character.injuryState,
      character.emotionalBaseline,
    ].map(clean).filter(Boolean).join(" / "));
  }
  for (const prop of asArray<any>(pack.props)) {
    push(prop.assetId, "prop", prop.variantId, [
      prop.usageState,
      prop.continuityState,
      prop.ownerCharacterId,
    ].map(clean).filter(Boolean).join(" / "));
  }
  return Array.from(new Map(fingerprints.map((item) => [item.fingerprint, item])).values());
};

export const buildSceneAssetVariantPacks = ({
  projectId,
  formalAssetPackage,
  sceneVisualPacks = [],
  createdAt = Date.now(),
}: BuildSceneAssetVariantPacksInput): SceneAssetVariantPack[] => {
  const grouped = new Map<string, Partial<SceneVisualPack>[]>();
  for (const pack of sceneVisualPacks) {
    const fingerprint = clean(pack.visualFingerprint);
    if (!fingerprint) continue;
    grouped.set(fingerprint, [...(grouped.get(fingerprint) || []), pack]);
  }
  return Array.from(grouped.entries()).map(([visualFingerprint, packs]) => {
    const primary = packs[0];
    const linkedSceneIds = uniq(packs.flatMap((pack) => pack.linkedSceneIds || pack.sourceSceneIds || []));
    const sourceSceneIds = uniq(packs.flatMap((pack) => pack.sourceSceneIds || []));
    const usageRefs = Array.from(new Map(packs.flatMap(usageRefsFromSceneVisualPack).map((ref) => [
      `${ref.episodeId || ""}:${ref.sceneId || ""}:${ref.nodeId || ""}`,
      ref,
    ])).values());
    return {
      schemaVersion: "scene-asset-variant-pack.v1",
      id: `${projectId}.scene_asset_variant_pack.${visualFingerprint.replace(/^svp\./, "")}`,
      projectId,
      formalAssetPackageId: formalAssetPackage.id,
      sceneVisualPackId: primary?.id,
      visualFingerprint,
      sourceSceneIds,
      linkedSceneIds,
      usageRefs,
      variantFingerprints: scenePackAssetFingerprints(projectId, primary || {}),
      readiness: linkedSceneIds.length > 1 ? "reusable" : "single_use",
      qaChecklist: [
        `formal_asset_package：${formalAssetPackage.id}`,
        "相同 visualFingerprint 只能生成一个 scene_asset_variant_pack。",
        "每个变体指纹必须来自角色/场景/道具的可见状态。",
        "usageRefs 必须记录复用到哪些 scene/node。",
      ],
      createdAt,
    };
  });
};

export const validateFormalAssetPackage = (
  formalAssetPackage?: Partial<FormalAssetPackage>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!formalAssetPackage || typeof formalAssetPackage !== "object") {
    return normalizeProductionQAIssues([issue("formal_asset_package", "formal_asset_package artifact 必须包含结构化正式资产包。", "blocking")]);
  }
  if (formalAssetPackage.schemaVersion !== "formal-asset-package.v1") issues.push(issue("formal_asset_package.schemaVersion", "schemaVersion 必须是 formal-asset-package.v1。", "blocking"));
  if (!clean(formalAssetPackage.id)) issues.push(issue("formal_asset_package.id", "formal_asset_package 缺少 id。", "blocking"));
  if (!clean(formalAssetPackage.projectId)) issues.push(issue("formal_asset_package.projectId", "formal_asset_package 缺少 projectId。", "blocking"));
  if (formalAssetPackage.productionReadiness !== "formal_ready") issues.push(issue("formal_asset_package.productionReadiness", "正式资产包必须来自 formal_ready asset_board_plan。", "blocking"));
  if (!clean(formalAssetPackage.sourceRefs?.assetBoardPlanId)) issues.push(issue("formal_asset_package.sourceRefs.assetBoardPlanId", "正式资产包必须绑定 asset_board_plan。", "blocking"));
  if (!clean(formalAssetPackage.sourceRefs?.productionBreakdownReportId)) issues.push(issue("formal_asset_package.sourceRefs.productionBreakdownReportId", "正式资产包必须绑定 production_breakdown_report。", "blocking"));
  if (!asArray(formalAssetPackage.sourceRefs?.castingDecisionIds).length) issues.push(issue("formal_asset_package.sourceRefs.castingDecisionIds", "正式资产包必须绑定 approved casting_decision。", "blocking"));
  if (!asArray(formalAssetPackage.sourceRefs?.departmentPrepPackageIds).length) issues.push(issue("formal_asset_package.sourceRefs.departmentPrepPackageIds", "正式资产包必须绑定 department_prep_package。", "blocking"));
  if (!asArray(formalAssetPackage.identityBoards).length) issues.push(issue("formal_asset_package.identityBoards", "正式资产包必须包含 asset_identity_board。", "blocking"));
  for (const board of asArray<Partial<AssetIdentityBoard>>(formalAssetPackage.identityBoards)) {
    const target = `formal_asset_package.identityBoards.${board.id || board.assetId || "unknown"}`;
    if (board.schemaVersion !== "asset-identity-board.v1") issues.push(issue(`${target}.schemaVersion`, "asset_identity_board schemaVersion 必须是 asset-identity-board.v1。", "blocking"));
    if (!clean(board.assetId)) issues.push(issue(`${target}.assetId`, "asset_identity_board 缺少 assetId。", "blocking"));
    if (board.productionUse !== "formal_asset_board") issues.push(issue(`${target}.productionUse`, "asset_identity_board 必须来自 formal_asset_board。", "blocking"));
    if (!asArray(board.sourceRefs?.castingDecisionIds).length && board.assetType === "character") {
      issues.push(issue(`${target}.sourceRefs.castingDecisionIds`, "角色 identity board 必须绑定 approved casting_decision。", "blocking"));
    }
  }
  for (const blocker of asArray<string>(formalAssetPackage.packageBlockers)) {
    issues.push(issue("formal_asset_package.packageBlockers", blocker, "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateSceneAssetVariantPacks = (
  sceneAssetVariantPacks?: Partial<SceneAssetVariantPack>[],
): ProductionQAIssue[] => {
  const items = asArray<Partial<SceneAssetVariantPack>>(sceneAssetVariantPacks);
  const issues: ProductionQAIssue[] = [];
  if (!items.length) return normalizeProductionQAIssues([issue("scene_asset_variant_pack", "scene_asset_variant_pack artifact 必须包含至少一个场次变体包。", "blocking")]);
  const fingerprints = new Map<string, string>();
  for (const pack of items) {
    const target = `scene_asset_variant_pack.${pack.id || pack.visualFingerprint || "unknown"}`;
    if (pack.schemaVersion !== "scene-asset-variant-pack.v1") issues.push(issue(`${target}.schemaVersion`, "schemaVersion 必须是 scene-asset-variant-pack.v1。", "blocking"));
    if (!clean(pack.id)) issues.push(issue(`${target}.id`, "scene_asset_variant_pack 缺少 id。", "blocking"));
    if (!clean(pack.projectId)) issues.push(issue(`${target}.projectId`, "scene_asset_variant_pack 缺少 projectId。", "blocking"));
    if (!clean(pack.formalAssetPackageId)) issues.push(issue(`${target}.formalAssetPackageId`, "scene_asset_variant_pack 必须绑定 formal_asset_package。", "blocking"));
    if (!clean(pack.visualFingerprint)) issues.push(issue(`${target}.visualFingerprint`, "scene_asset_variant_pack 缺少 visualFingerprint。", "blocking"));
    if (pack.visualFingerprint && fingerprints.has(pack.visualFingerprint)) {
      issues.push(issue(`${target}.visualFingerprint`, `visualFingerprint 重复，应复用同一个 scene_asset_variant_pack：${pack.visualFingerprint}`, "blocking"));
    }
    if (pack.visualFingerprint) fingerprints.set(pack.visualFingerprint, pack.id || pack.visualFingerprint);
    if (!asArray(pack.linkedSceneIds).length && !asArray(pack.usageRefs).length) {
      issues.push(issue(`${target}.usageRefs`, "scene_asset_variant_pack 必须记录 linkedSceneIds 或 usageRefs。", "blocking"));
    }
    if (!asArray(pack.variantFingerprints).length) {
      issues.push(issue(`${target}.variantFingerprints`, "scene_asset_variant_pack 必须包含 asset_variant_fingerprint。", "blocking"));
    }
  }
  return normalizeProductionQAIssues(issues);
};

export const buildFormalAssetPackageSystem = () => ({
  schemaVersion: "formal-asset-package-system.v1",
  status: "formal_asset_package_and_scene_variant_pack_available",
  artifactKinds: ["formal_asset_package", "asset_identity_board", "scene_asset_variant_pack", "asset_variant_fingerprint"],
  builderFunctions: ["buildFormalAssetPackage", "buildSceneAssetVariantPacks"],
  qaFunctions: ["validateFormalAssetPackage", "validateSceneAssetVariantPacks"],
  requiredInputs: [
    "formal_ready asset_board_plan",
    "production_breakdown_report",
    "approved casting_decision",
    "department_prep_package",
    "stable existing or planned character/location/prop asset refs",
    "scene_visual_pack for scene-level reuse",
  ],
  requiredBehavior: [
    "formal_asset_package is the production source of truth for approved identity boards.",
    "asset_identity_board must not be promoted from development-only boards.",
    "Stabilized planned characters, locations, and props may become formal identity-board inputs only after lock, production breakdown, casting/prep, and asset-board QA have bound them to stable asset refs.",
    "scene_asset_variant_pack deduplicates scenes by visualFingerprint and records linkedSceneIds/usageRefs.",
    "asset_variant_fingerprint must include assetId, variantId, assetType, and visible state summary.",
    "Three scenes with identical visible variants must reuse one scene_asset_variant_pack.",
  ],
});
