import type { Episode, Project } from "../../../../../src/types/project";
import type { ProductionQAIssue } from "../../../../../src/types/production";
import type { SceneAssetVariantPack } from "./productionAssetPackage";
import type {
  DepartmentPrepPackage,
  ProductionBreakdownReport,
  ProductionPrepDepartment,
  ProductionSceneAssetState,
  ProductionSceneMatrixRow,
} from "./productionPrep";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";

export type ContinuityTargetType =
  | "character"
  | "wardrobe_makeup"
  | "prop"
  | "location"
  | "time_weather"
  | "vfx_sfx";

export type ContinuityRiskLevel = "clear" | "needs_review" | "blocked";

export interface ContinuityMatrixRow {
  id: string;
  projectId: string;
  sourceType: "scene" | "node";
  episodeId?: string;
  sceneId?: string;
  nodeId?: string;
  title: string;
  sequenceIndex: number;
  targetType: ContinuityTargetType;
  targetId?: string;
  targetName: string;
  requiresCanonicalAsset?: boolean;
  department: ProductionPrepDepartment;
  visibleState: string;
  continuityIn: string;
  continuityOut: string;
  previousRowId?: string;
  nextRowId?: string;
  variantIds: string[];
  shotIds: string[];
  sceneAssetVariantPackIds: string[];
  reviewedByAgent?: boolean;
  reviewAgentId?: string;
  reviewQaScore?: number;
  riskLevel: ContinuityRiskLevel;
  riskNotes: string[];
}

export interface ContinuityMatrixIssue {
  id: string;
  severity: "warning" | "blocking";
  target: string;
  message: string;
  rowIds: string[];
}

export interface ContinuityMatrix {
  schemaVersion: "continuity-matrix.v1";
  id: string;
  projectId: string;
  sourceRefs: {
    productionBreakdownReportId?: string;
    departmentPrepPackageIds: string[];
    sceneAssetVariantPackIds: string[];
  };
  scope: {
    episodeIds: string[];
    sceneIds: string[];
    nodeIds: string[];
    blockId?: string;
    mode?: string;
  };
  rows: ContinuityMatrixRow[];
  issues: ContinuityMatrixIssue[];
  totals: {
    rows: number;
    blocked: number;
    needsReview: number;
    clear: number;
    byTargetType: Partial<Record<ContinuityTargetType, number>>;
    byDepartment: Partial<Record<ProductionPrepDepartment, number>>;
  };
  createdAt: number;
}

export interface BuildContinuityMatrixInput {
  project: Project;
  episodes?: Episode[];
  productionBreakdownReport?: Partial<ProductionBreakdownReport>;
  departmentPrepPackages?: Partial<DepartmentPrepPackage>[];
  sceneAssetVariantPacks?: Partial<SceneAssetVariantPack>[];
  createdAt?: number;
}

const clean = (value: unknown) => String(value || "").trim();

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map(clean).filter(Boolean)));

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: nowId("continuity_matrix_issue"),
  severity,
  target,
  message,
  suggestion,
  repairInstruction: suggestion || message,
  issueType: "continuity_matrix_contract",
  retryable: severity !== "blocking",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "soft_hold",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const stateText = (items: unknown[], fallback = "未记录") => {
  const value = uniq(items.map((item) => clean(item)));
  return value.length ? value.join(" / ") : fallback;
};

const rowScopeKey = (row: Partial<ProductionSceneMatrixRow>) =>
  `${clean(row.episodeId)}:${clean(row.sceneId)}:${clean(row.nodeId)}`;

const continuityPrepKey = (targetId: string | undefined, row: Partial<ProductionSceneMatrixRow>) =>
  `${clean(targetId)}:${rowScopeKey(row)}`;

const buildPrepContinuityIndex = (packages: Partial<DepartmentPrepPackage>[]) => {
  const index = new Map<string, { inState?: string; outState?: string; priority: number }>();
  for (const prepPackage of packages) {
    const priority = prepPackage.department === "continuity"
      ? 3
      : ["props", "location_art", "wardrobe_makeup", "wardrobe", "makeup_hair"].includes(clean(prepPackage.department))
        ? 2
        : 1;
    for (const entry of asArray<any>(prepPackage.continuityInOut)) {
      const key = `${clean(entry.targetId)}:${clean(entry.episodeId)}:${clean(entry.sceneId)}:${clean(entry.nodeId)}`;
      if (!clean(entry.targetId)) continue;
      const existing = index.get(key);
      if (existing && existing.priority > priority) continue;
      index.set(key, {
        inState: clean(entry.inState),
        outState: clean(entry.outState),
        priority,
      });
    }
  }
  return index;
};

const variantsForTarget = (row: Partial<ProductionSceneMatrixRow>, targetId?: string) =>
  targetId ? uniq([row.variantRefsByAsset?.[targetId]]) : [];

const characterStatesForRow = (row: ProductionSceneMatrixRow): ProductionSceneAssetState[] => {
  const structured = asArray<ProductionSceneAssetState>(row.characterStates);
  if (structured.length) return structured;
  return row.characterNames.map((name, index) => ({
    assetId: row.characterIds[index],
    name,
  }));
};

const propStatesForRow = (row: ProductionSceneMatrixRow): ProductionSceneAssetState[] => {
  const structured = asArray<ProductionSceneAssetState>(row.propStates);
  if (structured.length) return structured;
  return row.propNames.map((name, index) => ({
    assetId: row.propIds[index],
    name,
  }));
};

const sameStringSet = (left: string[], right: string[]) => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const buildContinuityAgentReview = (packages: Partial<DepartmentPrepPackage>[]) => {
  const continuityPackage = [...packages].reverse().find((item) => item.department === "continuity");
  const manualOutput = asRecord(asRecord(continuityPackage?.specialistPayload).manualOutput);
  const reviewedSceneIds = uniq(asArray<string>(manualOutput.reviewedSceneIds));
  return {
    passed: manualOutput.status === "confirmed" &&
      manualOutput.qaVerdict === "pass" &&
      reviewedSceneIds.length > 0,
    reviewedSceneIds,
    agentId: clean(continuityPackage?.ownerAgentId) || undefined,
    qaScore: Number.isFinite(Number(manualOutput.qaScore)) ? Number(manualOutput.qaScore) : undefined,
  };
};

const sceneVariantPackIdsForRow = (
  row: Partial<ProductionSceneMatrixRow>,
  packs: Partial<SceneAssetVariantPack>[],
) => {
  const sceneIds = new Set(uniq([row.sceneId, row.nodeId]));
  return uniq(packs
    .filter((pack) =>
      asArray<string>(pack.linkedSceneIds).some((id) => sceneIds.has(id)) ||
      asArray<string>(pack.sourceSceneIds).some((id) => sceneIds.has(id)) ||
      asArray<any>(pack.usageRefs).some((ref) => sceneIds.has(clean(ref.sceneId || ref.nodeId))),
    )
    .map((pack) => pack.id));
};

const rowId = (
  projectId: string,
  row: Partial<ProductionSceneMatrixRow>,
  sequenceIndex: number,
  targetType: ContinuityTargetType,
  targetId: string | undefined,
  targetName: string,
) => [
  projectId,
  clean(row.episodeId) || "episode",
  clean(row.sceneId) || clean(row.nodeId) || `row-${sequenceIndex}`,
  targetType,
  clean(targetId) || clean(targetName).toLowerCase().replace(/\s+/g, "-") || "unknown",
].join(".");

const pushRow = (
  rows: ContinuityMatrixRow[],
  input: Omit<ContinuityMatrixRow, "continuityIn" | "continuityOut" | "previousRowId" | "nextRowId" | "riskLevel" | "riskNotes"> & {
    prepIn?: string;
    prepOut?: string;
  },
) => {
  const targetKey = `${input.targetType}:${clean(input.targetId) || clean(input.targetName)}`;
  const previous = [...rows].reverse().find((row) => `${row.targetType}:${clean(row.targetId) || clean(row.targetName)}` === targetKey);
  const continuityIn = clean(input.prepIn) || previous?.continuityOut || input.visibleState;
  const continuityOut = clean(input.prepOut) || input.visibleState;
  const riskNotes: string[] = [];
  const hasDeclaredVariantTransition = Boolean(previous) &&
    !sameStringSet(previous?.variantIds || [], input.variantIds) &&
    Boolean((previous?.variantIds.length || 0) + input.variantIds.length);
  const handoffMismatch = Boolean(previous && previous.continuityOut !== continuityIn);
  const visibleStateChanged = Boolean(previous && previous.visibleState !== input.visibleState);
  const missingRequiredCanonicalAsset = !clean(input.targetId) && (
    input.targetType === "location" ||
    (["character", "prop"].includes(input.targetType) && input.requiresCanonicalAsset !== false)
  );
  if (missingRequiredCanonicalAsset) {
    riskNotes.push("缺少 canonical assetId，正式生成前需要资产统筹确认。");
  }
  if (handoffMismatch && !hasDeclaredVariantTransition && !input.reviewedByAgent) {
    riskNotes.push("上一场/节点出状态与本场入状态不一致，需要场记复核。");
  }
  if (visibleStateChanged && !handoffMismatch && !hasDeclaredVariantTransition && !input.reviewedByAgent && !clean(input.prepIn) && !clean(input.prepOut)) {
    riskNotes.push("可见状态发生变化但未绑定 variant 或部门 continuity in/out。");
  }
  if (input.visibleState === "未记录") {
    riskNotes.push("缺少可见状态描述。");
  }
  const riskLevel: ContinuityRiskLevel = riskNotes.some((note) => note.includes("canonical assetId"))
    ? "blocked"
    : riskNotes.length
      ? "needs_review"
      : "clear";
  const next: ContinuityMatrixRow = {
    ...input,
    continuityIn,
    continuityOut,
    previousRowId: previous?.id,
    riskLevel,
    riskNotes,
  };
  if (previous) previous.nextRowId = next.id;
  rows.push(next);
};

export const buildContinuityMatrix = ({
  project,
  productionBreakdownReport,
  departmentPrepPackages = [],
  sceneAssetVariantPacks = [],
  createdAt = Date.now(),
}: BuildContinuityMatrixInput): ContinuityMatrix => {
  const matrixRows = asArray<ProductionSceneMatrixRow>(productionBreakdownReport?.sceneMatrix);
  const prepPackages = asArray<Partial<DepartmentPrepPackage>>(departmentPrepPackages);
  const variantPacks = asArray<Partial<SceneAssetVariantPack>>(sceneAssetVariantPacks);
  const prepContinuity = buildPrepContinuityIndex(prepPackages);
  const continuityAgentReview = buildContinuityAgentReview(prepPackages);
  const rows: ContinuityMatrixRow[] = [];
  matrixRows.forEach((matrixRow, index) => {
    const sceneAssetVariantPackIds = sceneVariantPackIdsForRow(matrixRow, variantPacks);
    const reviewScopeId = clean(matrixRow.sceneId || matrixRow.nodeId);
    const reviewedByAgent = continuityAgentReview.passed && continuityAgentReview.reviewedSceneIds.includes(reviewScopeId);
    const base = {
      projectId: project.id,
      sourceType: matrixRow.sourceType,
      episodeId: matrixRow.episodeId,
      sceneId: matrixRow.sceneId,
      nodeId: matrixRow.nodeId,
      title: matrixRow.title,
      sequenceIndex: index + 1,
      shotIds: asArray<string>(matrixRow.shotIds),
      sceneAssetVariantPackIds,
      reviewedByAgent,
      reviewAgentId: reviewedByAgent ? continuityAgentReview.agentId : undefined,
      reviewQaScore: reviewedByAgent ? continuityAgentReview.qaScore : undefined,
    };

    if (matrixRow.locationId || matrixRow.locationName) {
      const variantIds = variantsForTarget(matrixRow, matrixRow.locationId);
      const prep = prepContinuity.get(continuityPrepKey(matrixRow.locationId || matrixRow.locationName, matrixRow));
      const visibleState = stateText([
        matrixRow.locationName,
        matrixRow.locationState,
        matrixRow.timeOfDay,
        ...asArray<string>(matrixRow.vfx),
        ...asArray<string>(matrixRow.extrasAtmosphere),
        ...variantIds,
      ]);
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "location", matrixRow.locationId, matrixRow.locationName || "location"),
        targetType: "location",
        targetId: matrixRow.locationId,
        targetName: matrixRow.locationName || matrixRow.locationId || "未命名场景",
        department: "location_art",
        visibleState,
        variantIds,
        prepIn: prep?.inState,
        prepOut: prep?.outState,
      });
    }

    const characterStates = characterStatesForRow(matrixRow);
    characterStates.forEach((characterState) => {
      const name = characterState.name;
      const targetId = characterState.assetId;
      const variantIds = variantsForTarget(matrixRow, targetId);
      const prep = prepContinuity.get(continuityPrepKey(targetId || name, matrixRow));
      const visibleState = stateText([
        name,
        characterState.state,
        ...variantIds,
      ]);
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "character", targetId, name),
        targetType: "character",
        targetId,
        targetName: name || targetId || "未命名角色",
        requiresCanonicalAsset: characterState.requiresCanonicalAsset,
        department: "continuity",
        visibleState,
        variantIds,
        prepIn: prep?.inState,
        prepOut: prep?.outState,
      });
    });

    if (matrixRow.wardrobe.length || matrixRow.makeupHair.length) {
      const variantIds = uniq(characterStates.flatMap((item) => variantsForTarget(matrixRow, item.assetId)));
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "wardrobe_makeup", undefined, "本场服化妆总表"),
        targetType: "wardrobe_makeup",
        targetName: "本场服化妆总表",
        department: "wardrobe_makeup",
        visibleState: stateText([...matrixRow.wardrobe, ...matrixRow.makeupHair]),
        variantIds,
      });
    }

    propStatesForRow(matrixRow).forEach((propState) => {
      const name = propState.name;
      const targetId = propState.assetId;
      const variantIds = variantsForTarget(matrixRow, targetId);
      const prep = prepContinuity.get(continuityPrepKey(targetId || name, matrixRow));
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "prop", targetId, name),
        targetType: "prop",
        targetId,
        targetName: name || targetId || "未命名道具",
        requiresCanonicalAsset: propState.requiresCanonicalAsset,
        department: "props",
        visibleState: stateText([name, propState.state, ...variantIds]),
        variantIds,
        prepIn: prep?.inState,
        prepOut: prep?.outState,
      });
    });

    if (matrixRow.timeOfDay || matrixRow.vfx.length || matrixRow.sfx.length) {
      const variantIds = variantsForTarget(matrixRow, matrixRow.locationId);
      const environmentTargetName = `${matrixRow.locationName || matrixRow.locationId || "场景"} 环境/时间`;
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "time_weather", matrixRow.locationId, environmentTargetName),
        targetType: "time_weather",
        targetId: matrixRow.locationId,
        targetName: environmentTargetName,
        department: "continuity",
        visibleState: stateText([matrixRow.timeOfDay, ...matrixRow.vfx, ...matrixRow.sfx]),
        variantIds,
      });
    }

    if (matrixRow.vfx.length || matrixRow.sfx.length) {
      const effectTargetName = `${matrixRow.locationName || matrixRow.locationId || "场景"} VFX/SFX`;
      pushRow(rows, {
        ...base,
        id: rowId(project.id, matrixRow, index + 1, "vfx_sfx", matrixRow.locationId, effectTargetName),
        targetType: "vfx_sfx",
        targetId: matrixRow.locationId,
        targetName: effectTargetName,
        department: "vfx_sfx",
        visibleState: stateText([...matrixRow.vfx, ...matrixRow.sfx]),
        variantIds: [],
      });
    }
  });

  const issues: ContinuityMatrixIssue[] = rows
    .filter((row) => row.riskLevel !== "clear")
    .map((row) => ({
      id: `${row.id}.issue`,
      severity: row.riskLevel === "blocked" ? "blocking" : "warning",
      target: row.id,
      message: row.riskNotes.join("；"),
      rowIds: [row.id],
    }));
  const byTargetType: Partial<Record<ContinuityTargetType, number>> = {};
  const byDepartment: Partial<Record<ProductionPrepDepartment, number>> = {};
  for (const row of rows) {
    byTargetType[row.targetType] = (byTargetType[row.targetType] || 0) + 1;
    byDepartment[row.department] = (byDepartment[row.department] || 0) + 1;
  }
  return {
    schemaVersion: "continuity-matrix.v1",
    id: `${project.id}.continuity_matrix.${clean(productionBreakdownReport?.id) || "draft"}`,
    projectId: project.id,
    sourceRefs: {
      productionBreakdownReportId: clean(productionBreakdownReport?.id) || undefined,
      departmentPrepPackageIds: uniq(prepPackages.map((item) => item.id)),
      sceneAssetVariantPackIds: uniq(variantPacks.map((item) => item.id)),
    },
    scope: {
      episodeIds: uniq(matrixRows.map((row) => row.episodeId)),
      sceneIds: uniq(matrixRows.map((row) => row.sceneId)),
      nodeIds: uniq(matrixRows.map((row) => row.nodeId)),
      blockId: productionBreakdownReport?.scope?.blockId,
      mode: productionBreakdownReport?.scope?.mode,
    },
    rows,
    issues,
    totals: {
      rows: rows.length,
      blocked: rows.filter((row) => row.riskLevel === "blocked").length,
      needsReview: rows.filter((row) => row.riskLevel === "needs_review").length,
      clear: rows.filter((row) => row.riskLevel === "clear").length,
      byTargetType,
      byDepartment,
    },
    createdAt,
  };
};

export const validateContinuityMatrix = (
  matrix?: Partial<ContinuityMatrix>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!matrix || typeof matrix !== "object") {
    return normalizeProductionQAIssues([issue("continuity_matrix", "continuity_matrix artifact 必须包含结构化场记连续性矩阵。", "blocking")]);
  }
  if (matrix.schemaVersion !== "continuity-matrix.v1") issues.push(issue("continuity_matrix.schemaVersion", "schemaVersion 必须是 continuity-matrix.v1。", "blocking"));
  if (!clean(matrix.id)) issues.push(issue("continuity_matrix.id", "continuity_matrix 缺少 id。", "blocking"));
  if (!clean(matrix.projectId)) issues.push(issue("continuity_matrix.projectId", "continuity_matrix 缺少 projectId。", "blocking"));
  if (!clean(matrix.sourceRefs?.productionBreakdownReportId)) issues.push(issue("continuity_matrix.sourceRefs.productionBreakdownReportId", "continuity_matrix 必须绑定 production_breakdown_report。", "blocking"));
  if (!asArray(matrix.rows).length) issues.push(issue("continuity_matrix.rows", "continuity_matrix 必须至少包含一条连续性 row。", "blocking"));
  for (const row of asArray<Partial<ContinuityMatrixRow>>(matrix.rows)) {
    const target = `continuity_matrix.rows.${row.id || row.targetName || "unknown"}`;
    if (!clean(row.id)) issues.push(issue(`${target}.id`, "连续性 row 缺少 id。", "blocking"));
    if (!clean(row.title)) issues.push(issue(`${target}.title`, "连续性 row 缺少场次/节点标题。", "warning"));
    if (!clean(row.targetName)) issues.push(issue(`${target}.targetName`, "连续性 row 缺少 targetName。", "blocking"));
    if (!clean(row.visibleState)) issues.push(issue(`${target}.visibleState`, "连续性 row 缺少 visibleState。", "warning"));
    if (row.riskLevel === "blocked") issues.push(issue(target, asArray<string>(row.riskNotes).join("；") || "连续性 row 存在 blocking 风险。", "blocking"));
    if (row.riskLevel === "needs_review") issues.push(issue(target, asArray<string>(row.riskNotes).join("；") || "连续性 row 需要场记复核。", "warning"));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildProductionContinuitySystem = () => ({
  schemaVersion: "production-continuity-system.v1",
  status: "continuity_matrix_available",
  artifactKinds: ["continuity_matrix"],
  builderFunctions: ["buildContinuityMatrix"],
  qaFunctions: ["validateContinuityMatrix"],
  requiredInputs: [
    "production_breakdown_report.sceneMatrix",
    "department_prep_package.continuityInOut",
    "scene_asset_variant_pack for reusable variant state",
  ],
  requiredBehavior: [
    "Continuity rows must explain visible state, continuity in/out, variants, previous row, and next row.",
    "Character, wardrobe/makeup, prop, location, time/weather, and VFX/SFX state must be visible to the cockpit.",
    "State changes without a variant or department continuity note should be soft_hold, not an immediate circuit breaker.",
    "Missing canonical asset ids for formal character/prop/location rows must block formal delivery.",
  ],
});
