import type { ProductionQAIssue } from "../../../../../src/types/production";
import type { Project } from "../../../../../src/types/project";
import type { CastingRequirement } from "./productionPrep";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";

export type CastingDecisionType =
  | "approve_identity_board"
  | "reject_identity_board"
  | "request_identity_generation"
  | "assign_existing_character"
  | "needs_human_casting";

export type CastingDecisionStatus =
  | "draft"
  | "pending_director_review"
  | "approved"
  | "rejected"
  | "needs_revision";

export interface RoleSlot {
  schemaVersion: "role-slot.v1";
  id: string;
  projectId: string;
  displayName: string;
  narrativeFunction: string;
  source: "bible" | "structure" | "production_breakdown" | "interactive_graph";
  priority: "lead" | "supporting" | "day_player" | "extra";
  characterId?: string;
  castingRequirementId?: string;
  lockedRefs: Array<{
    episodeId?: string;
    sceneId?: string;
    nodeId?: string;
    title?: string;
  }>;
  status: "development_only" | "ready_for_casting" | "consumed_by_casting_requirement";
  createdAt: number;
}

export interface CastingCandidate {
  schemaVersion: "casting-candidate.v1";
  id: string;
  projectId: string;
  roleSlotId: string;
  castingRequirementId?: string;
  characterId?: string;
  identityBoardArtifactId?: string;
  displayName: string;
  source: "existing_character" | "generated_identity_board" | "human_casting" | "reference_image" | "placeholder";
  candidateStatus: "draft" | "ready_for_director_review" | "approved_for_decision" | "rejected";
  identityBoardPrompt?: string;
  referenceAssetIds: string[];
  suitabilityNotes: string[];
  riskNotes: string[];
  styleLockSummary?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface CastingDecisionCandidate {
  candidateId?: string;
  characterId?: string;
  identityBoardArtifactId?: string;
  referenceAssetIds: string[];
  name: string;
  source: "existing_character" | "generated_identity_board" | "human_casting" | "placeholder";
  suitabilityNotes: string[];
  riskNotes: string[];
}

export interface CastingDecision {
  schemaVersion: "casting-decision.v1";
  id: string;
  projectId: string;
  productionBreakdownReportId: string;
  castingRequirementId: string;
  roleSlotId: string;
  characterId?: string;
  displayName: string;
  decisionType: CastingDecisionType;
  status: CastingDecisionStatus;
  candidate: CastingDecisionCandidate;
  directorNotes: string;
  affectedEpisodeIds: string[];
  affectedSceneIds: string[];
  affectedNodeIds: string[];
  requiredFollowups: Array<{
    id: string;
    department: "casting" | "asset" | "wardrobe_makeup" | "production" | "continuity";
    action: string;
    requiredBeforeStage: string;
  }>;
  sourceRefs: {
    castingRequirementArtifactId?: string;
    productionBreakdownReportId: string;
    scriptLockPackageId?: string;
    contentLockPackageId?: string;
    productionBlockLockId?: string;
  };
  approvedBy?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface BuildCastingDecisionInput {
  projectId: string;
  castingRequirement: Partial<CastingRequirement>;
  decisionType: CastingDecisionType;
  status?: CastingDecisionStatus;
  candidate?: Partial<CastingDecisionCandidate>;
  directorNotes?: string;
  castingRequirementArtifactId?: string;
  scriptLockPackageId?: string;
  contentLockPackageId?: string;
  productionBlockLockId?: string;
  approvedBy?: string;
  createdAt?: number;
}

export interface BuildRoleSlotsInput {
  project: Project;
  castingRequirements?: Partial<CastingRequirement>[];
  createdAt?: number;
}

export interface BuildCastingCandidatesInput {
  projectId: string;
  roleSlot?: Partial<RoleSlot>;
  castingRequirement?: Partial<CastingRequirement>;
  candidates?: Partial<CastingCandidate>[];
  createdAt?: number;
}

const compact = (value: unknown) => String(value || "").trim();

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: nowId("casting_decision_issue"),
  severity,
  target,
  message,
  suggestion,
  repairInstruction: suggestion || message,
  issueType: "casting_decision_contract",
  retryable: severity !== "blocking",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "soft_hold",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const rolePriorityFromText = (value: unknown): RoleSlot["priority"] => {
  const text = compact(value).toLowerCase();
  if (/lead|主角|男主|女主|protagonist|hero/.test(text)) return "lead";
  if (/extra|群演|路人|背景/.test(text)) return "extra";
  if (/客串|证人|守卫|day/.test(text)) return "day_player";
  return "supporting";
};

const roleSlotIdFrom = (projectId: string, value: unknown) =>
  `role-slot-${projectId}-${compact(value).replace(/\s+/g, "-").replace(/[^\w\u3400-\u9fff-]/g, "").slice(0, 48) || nowId("unnamed")}`;

const roleSlotFromRequirement = (
  projectId: string,
  requirement: Partial<CastingRequirement>,
  createdAt: number,
): RoleSlot => ({
  schemaVersion: "role-slot.v1",
  id: compact(requirement.roleSlotId) || roleSlotIdFrom(projectId, requirement.displayName || requirement.id),
  projectId,
  displayName: compact(requirement.displayName || requirement.roleSlotId) || "未命名角色功能位",
  narrativeFunction: compact(requirement.performanceRange?.[0] || requirement.displayName) || "锁定剧本反推角色功能",
  source: "production_breakdown",
  priority: requirement.priority || "supporting",
  characterId: compact(requirement.characterId) || undefined,
  castingRequirementId: compact(requirement.id) || undefined,
  lockedRefs: asArray<NonNullable<CastingRequirement["sceneAppearances"]>[number]>(requirement.sceneAppearances).map((appearance) => ({
    episodeId: appearance.episodeId,
    sceneId: appearance.sceneId,
    nodeId: appearance.nodeId,
    title: appearance.title,
  })),
  status: "consumed_by_casting_requirement",
  createdAt,
});

export const buildRoleSlots = ({
  project,
  castingRequirements = [],
  createdAt = Date.now(),
}: BuildRoleSlotsInput): RoleSlot[] => {
  const slots = new Map<string, RoleSlot>();
  for (const requirement of castingRequirements) {
    const slot = roleSlotFromRequirement(project.id, requirement, createdAt);
    slots.set(slot.id, slot);
  }
  for (const planned of asArray<any>((project as any).plannedCharacters)) {
    const id = compact(planned.id) || roleSlotIdFrom(project.id, planned.name || planned.roleType || planned.brief);
    if (slots.has(id)) continue;
    slots.set(id, {
      schemaVersion: "role-slot.v1",
      id,
      projectId: project.id,
      displayName: compact(planned.name || planned.roleType) || "未命名角色功能位",
      narrativeFunction: compact(planned.brief || planned.roleType || planned.externalGoal) || "项目圣经阶段角色功能位",
      source: "bible",
      priority: rolePriorityFromText(planned.roleType || planned.priority || planned.brief),
      lockedRefs: [],
      status: "development_only",
      createdAt,
    });
  }
  return Array.from(slots.values());
};

const candidateIdFrom = (projectId: string, roleSlotId: string, value: unknown, createdAt: number) =>
  `casting-candidate-${projectId}-${roleSlotId}-${compact(value).replace(/\s+/g, "-").replace(/[^\w\u3400-\u9fff-]/g, "").slice(0, 40) || createdAt}`;

const defaultCandidatePrompt = (
  displayName: string,
  requirement?: Partial<CastingRequirement>,
) => [
  `为角色功能位「${displayName}」生成候选角色身份板方向。`,
  requirement?.physicality?.length ? `身体/动作需求：${requirement.physicality.join("，")}` : "",
  requirement?.performanceRange?.length ? `表演范围：${requirement.performanceRange.join("，")}` : "",
  requirement?.costumeConstraints?.length ? `服装/妆发限制：${requirement.costumeConstraints.join("，")}` : "",
  "只生成候选方向，不得直接晋升为正式角色；必须等待 casting_decision。",
].filter(Boolean).join("\n");

export const buildCastingCandidates = ({
  projectId,
  roleSlot,
  castingRequirement,
  candidates = [],
  createdAt = Date.now(),
}: BuildCastingCandidatesInput): CastingCandidate[] => {
  const roleSlotId = compact(roleSlot?.id || castingRequirement?.roleSlotId);
  const displayName = compact(castingRequirement?.displayName || roleSlot?.displayName) || "未命名角色候选";
  const sourceDefault: CastingCandidate["source"] = castingRequirement?.characterId ? "existing_character" : "generated_identity_board";
  const seedCandidates = candidates.length ? candidates : [{
    displayName,
    source: sourceDefault,
    characterId: castingRequirement?.characterId,
    suitabilityNotes: castingRequirement?.performanceRange || [],
    riskNotes: castingRequirement?.costumeConstraints || [],
  }];
  return seedCandidates.map((candidate, index) => {
    const candidateName = compact(candidate.displayName || displayName) || `候选 ${index + 1}`;
    return {
      schemaVersion: "casting-candidate.v1",
      id: compact(candidate.id) || candidateIdFrom(projectId, roleSlotId || "missing-role-slot", candidateName || index, createdAt),
      projectId,
      roleSlotId,
      castingRequirementId: compact(candidate.castingRequirementId || castingRequirement?.id) || undefined,
      characterId: compact(candidate.characterId || castingRequirement?.characterId) || undefined,
      identityBoardArtifactId: compact(candidate.identityBoardArtifactId) || undefined,
      displayName: candidateName,
      source: candidate.source || sourceDefault,
      candidateStatus: candidate.candidateStatus || "ready_for_director_review",
      identityBoardPrompt: compact(candidate.identityBoardPrompt) || defaultCandidatePrompt(candidateName, castingRequirement),
      referenceAssetIds: uniq(candidate.referenceAssetIds || []),
      suitabilityNotes: uniq(candidate.suitabilityNotes || castingRequirement?.performanceRange || []),
      riskNotes: uniq(candidate.riskNotes || castingRequirement?.costumeConstraints || []),
      styleLockSummary: compact(candidate.styleLockSummary) || undefined,
      createdAt,
      updatedAt: createdAt,
    };
  });
};

export const validateRoleSlots = (
  roleSlots?: Partial<RoleSlot>[],
): ProductionQAIssue[] => {
  const items = asArray<Partial<RoleSlot>>(roleSlots);
  const issues: ProductionQAIssue[] = [];
  if (!items.length) {
    return normalizeProductionQAIssues([issue("role_slot", "role_slot artifact 必须包含至少一个角色功能位。", "blocking")]);
  }
  items.forEach((slot, index) => {
    const target = `role_slot.${index}`;
    if (slot.schemaVersion !== "role-slot.v1") issues.push(issue(`${target}.schemaVersion`, "schemaVersion 必须是 role-slot.v1。", "blocking"));
    if (!compact(slot.id)) issues.push(issue(`${target}.id`, "role_slot 缺少 id。", "blocking"));
    if (!compact(slot.projectId)) issues.push(issue(`${target}.projectId`, "role_slot 缺少 projectId。", "blocking"));
    if (!compact(slot.displayName)) issues.push(issue(`${target}.displayName`, "role_slot 缺少 displayName。", "blocking"));
    if (!compact(slot.narrativeFunction)) issues.push(issue(`${target}.narrativeFunction`, "role_slot 必须描述叙事功能。", "blocking"));
    if (!slot.source) issues.push(issue(`${target}.source`, "role_slot 缺少 source。", "blocking"));
    if (!slot.status) issues.push(issue(`${target}.status`, "role_slot 缺少 status。", "blocking"));
    if (slot.status === "development_only" && asArray(slot.lockedRefs).length > 0) {
      issues.push(issue(`${target}.status`, "development_only role_slot 不应伪装成已锁定剧本需求。", "warning"));
    }
  });
  return normalizeProductionQAIssues(issues);
};

export const validateCastingCandidates = (
  candidates?: Partial<CastingCandidate>[],
): ProductionQAIssue[] => {
  const items = asArray<Partial<CastingCandidate>>(candidates);
  const issues: ProductionQAIssue[] = [];
  if (!items.length) {
    return normalizeProductionQAIssues([issue("casting_candidate", "casting_candidate artifact 必须包含至少一个候选角色。", "blocking")]);
  }
  items.forEach((candidate, index) => {
    const target = `casting_candidate.${index}`;
    if (candidate.schemaVersion !== "casting-candidate.v1") issues.push(issue(`${target}.schemaVersion`, "schemaVersion 必须是 casting-candidate.v1。", "blocking"));
    if (!compact(candidate.id)) issues.push(issue(`${target}.id`, "casting_candidate 缺少 id。", "blocking"));
    if (!compact(candidate.projectId)) issues.push(issue(`${target}.projectId`, "casting_candidate 缺少 projectId。", "blocking"));
    if (!compact(candidate.roleSlotId)) issues.push(issue(`${target}.roleSlotId`, "casting_candidate 必须绑定 roleSlotId。", "blocking"));
    if (!compact(candidate.displayName)) issues.push(issue(`${target}.displayName`, "casting_candidate 缺少 displayName。", "blocking"));
    if (!candidate.source) issues.push(issue(`${target}.source`, "casting_candidate 缺少 source。", "blocking"));
    if (!candidate.candidateStatus) issues.push(issue(`${target}.candidateStatus`, "casting_candidate 缺少 candidateStatus。", "blocking"));
    if (!compact(candidate.castingRequirementId)) {
      issues.push(issue(`${target}.castingRequirementId`, "没有 castingRequirementId 的候选只能用于开发期比较，不能进入正式角色身份板。", "warning"));
    }
    if (!compact(candidate.characterId) && !compact(candidate.identityBoardArtifactId) && !compact(candidate.identityBoardPrompt)) {
      issues.push(issue(`${target}.identity`, "候选角色必须提供既有 characterId、identityBoardArtifactId 或身份板生成提示。", "blocking"));
    }
    if (candidate.candidateStatus === "approved_for_decision" && !compact(candidate.characterId) && !compact(candidate.identityBoardArtifactId)) {
      issues.push(issue(`${target}.approvedForDecision`, "批准进入 casting_decision 的候选必须引用 characterId 或 identityBoardArtifactId。", "blocking"));
    }
  });
  return normalizeProductionQAIssues(issues);
};

const defaultStatusForDecision = (decisionType: CastingDecisionType): CastingDecisionStatus =>
  decisionType === "approve_identity_board" || decisionType === "assign_existing_character"
    ? "approved"
    : decisionType === "reject_identity_board"
      ? "rejected"
      : decisionType === "request_identity_generation"
        ? "needs_revision"
        : "pending_director_review";

const followupsForDecision = (
  decisionType: CastingDecisionType,
  candidate: CastingDecisionCandidate,
): CastingDecision["requiredFollowups"] => {
  if (decisionType === "approve_identity_board" || decisionType === "assign_existing_character") {
    return [
      {
        id: "sync-formal-asset-board",
        department: "asset",
        action: "把导演批准的角色身份/候选写入正式角色资产板，并重跑 asset_board_plan QA。",
        requiredBeforeStage: "production_asset_detail",
      },
      {
        id: "sync-department-prep",
        department: "wardrobe_makeup",
        action: "确认该角色的服装、妆发、伤妆和场次变体是否需要补充。",
        requiredBeforeStage: "asset_sync",
      },
    ];
  }
  if (decisionType === "reject_identity_board" || decisionType === "request_identity_generation") {
    return [
      {
        id: "regenerate-character-identity-board",
        department: "asset",
        action: candidate.identityBoardArtifactId
          ? "根据导演意见重做角色身份板并保留旧 artifact 为 rejected 证据。"
          : "根据 casting_requirement 生成新的角色身份板候选。",
        requiredBeforeStage: "production_asset_detail",
      },
      {
        id: "director-re-review",
        department: "casting",
        action: "新候选生成后必须再次提交 casting_decision。",
        requiredBeforeStage: "storyboard",
      },
    ];
  }
  return [
    {
      id: "human-casting-review",
      department: "casting",
      action: "角色需求需要导演/选角人工确认后才能进入正式资产板。",
      requiredBeforeStage: "production_asset_detail",
    },
  ];
};

export const buildCastingDecision = (input: BuildCastingDecisionInput): CastingDecision => {
  const createdAt = input.createdAt || Date.now();
  const requirement = input.castingRequirement;
  const appearances = asArray<NonNullable<CastingRequirement["sceneAppearances"]>[number]>(requirement.sceneAppearances);
  const candidate: CastingDecisionCandidate = {
    candidateId: compact(input.candidate?.candidateId) || undefined,
    characterId: compact(input.candidate?.characterId || requirement.characterId) || undefined,
    identityBoardArtifactId: compact(input.candidate?.identityBoardArtifactId) || undefined,
    referenceAssetIds: uniq(input.candidate?.referenceAssetIds || []),
    name: compact(input.candidate?.name || requirement.displayName) || "未命名角色候选",
    source: input.candidate?.source || (requirement.characterId ? "existing_character" : "placeholder"),
    suitabilityNotes: uniq(input.candidate?.suitabilityNotes || []),
    riskNotes: uniq(input.candidate?.riskNotes || []),
  };
  const decisionType = input.decisionType;
  return {
    schemaVersion: "casting-decision.v1",
    id: `casting-decision-${input.projectId}-${requirement.id || requirement.roleSlotId || createdAt}`,
    projectId: input.projectId,
    productionBreakdownReportId: compact(requirement.productionBreakdownReportId),
    castingRequirementId: compact(requirement.id),
    roleSlotId: compact(requirement.roleSlotId),
    characterId: compact(requirement.characterId || candidate.characterId) || undefined,
    displayName: compact(requirement.displayName || candidate.name),
    decisionType,
    status: input.status || defaultStatusForDecision(decisionType),
    candidate,
    directorNotes: compact(input.directorNotes) || "导演/选角已根据锁定剧本角色需求作出决定。",
    affectedEpisodeIds: uniq(appearances.map((item) => item.episodeId)),
    affectedSceneIds: uniq(appearances.map((item) => item.sceneId)),
    affectedNodeIds: uniq(appearances.map((item) => item.nodeId)),
    requiredFollowups: followupsForDecision(decisionType, candidate),
    sourceRefs: {
      castingRequirementArtifactId: compact(input.castingRequirementArtifactId) || undefined,
      productionBreakdownReportId: compact(requirement.productionBreakdownReportId),
      scriptLockPackageId: compact(input.scriptLockPackageId) || undefined,
      contentLockPackageId: compact(input.contentLockPackageId) || undefined,
      productionBlockLockId: compact(input.productionBlockLockId) || undefined,
    },
    approvedBy: compact(input.approvedBy) || undefined,
    createdAt,
    updatedAt: createdAt,
  };
};

export const validateCastingDecision = (
  decision?: Partial<CastingDecision>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!decision || typeof decision !== "object") {
    return normalizeProductionQAIssues([issue("casting_decision", "casting_decision artifact 必须包含结构化导演/选角决定。", "blocking")]);
  }
  if (decision.schemaVersion !== "casting-decision.v1") issues.push(issue("casting_decision.schemaVersion", "schemaVersion 必须是 casting-decision.v1。", "blocking"));
  if (!compact(decision.id)) issues.push(issue("casting_decision.id", "casting_decision 缺少 id。", "blocking"));
  if (!compact(decision.projectId)) issues.push(issue("casting_decision.projectId", "casting_decision 缺少 projectId。", "blocking"));
  if (!compact(decision.productionBreakdownReportId)) issues.push(issue("casting_decision.productionBreakdownReportId", "casting_decision 必须绑定 production_breakdown_report。", "blocking"));
  if (!compact(decision.castingRequirementId)) issues.push(issue("casting_decision.castingRequirementId", "casting_decision 必须绑定 casting_requirement。", "blocking"));
  if (!compact(decision.roleSlotId)) issues.push(issue("casting_decision.roleSlotId", "casting_decision 必须绑定 roleSlotId。", "blocking"));
  if (!compact(decision.displayName)) issues.push(issue("casting_decision.displayName", "casting_decision 缺少角色显示名。", "blocking"));
  if (!decision.decisionType) issues.push(issue("casting_decision.decisionType", "casting_decision 缺少 decisionType。", "blocking"));
  if (!decision.status) issues.push(issue("casting_decision.status", "casting_decision 缺少 status。", "blocking"));
  if (!compact(decision.directorNotes)) issues.push(issue("casting_decision.directorNotes", "导演/选角决定必须写明理由。", "blocking"));
  if (!decision.candidate || !compact(decision.candidate.name)) {
    issues.push(issue("casting_decision.candidate", "casting_decision 必须记录候选角色或身份板。", "blocking"));
  }
  if (
    (decision.decisionType === "approve_identity_board" || decision.decisionType === "assign_existing_character") &&
    decision.status !== "approved"
  ) {
    issues.push(issue("casting_decision.status", "批准身份板或指派既有角色时 status 必须为 approved。", "blocking"));
  }
  if (
    decision.decisionType === "approve_identity_board" &&
    !compact(decision.candidate?.identityBoardArtifactId) &&
    !compact(decision.candidate?.characterId)
  ) {
    issues.push(issue("casting_decision.candidate.identityBoardArtifactId", "批准角色身份板必须引用 identityBoardArtifactId 或既有 characterId。", "blocking"));
  }
  if (
    (decision.decisionType === "reject_identity_board" || decision.decisionType === "request_identity_generation") &&
    !asArray(decision.requiredFollowups).length
  ) {
    issues.push(issue("casting_decision.requiredFollowups", "驳回或要求生成身份板时必须列出后续返工动作。", "blocking"));
  }
  if (!asArray(decision.affectedSceneIds).length && !asArray(decision.affectedNodeIds).length) {
    issues.push(issue("casting_decision.affectedScenes", "casting_decision 应从 casting_requirement 继承场次/节点覆盖范围。", "warning"));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildCastingDecisionSystem = () => ({
  schemaVersion: "casting-decision-system.v1",
  status: "role_slot_candidate_decision_chain_and_autostudio_bridge_available",
  artifactKinds: ["role_slot", "casting_candidate", "casting_decision"],
  builderFunctions: ["buildRoleSlots", "buildCastingCandidates", "buildCastingDecision"],
  qaFunctions: ["validateRoleSlots", "validateCastingCandidates", "validateCastingDecision"],
  requiredInputs: [
    "role_slot from bible/structure or production breakdown",
    "casting_requirement from productionPrep",
    "candidate character or identity board reference",
    "directorNotes explaining approval, rejection, or generation request",
  ],
  requiredBehavior: [
    "Bible/structure may create role_slot only; formal casting requirements must come from locked script/content breakdown.",
    "Casting candidates are not formal characters until a casting_decision approves or assigns them.",
    "Director/Casting decisions must reference a casting_requirement instead of selecting characters from the global pool blindly.",
    "AutoStudio production_breakdown may create an approved assign_existing_character casting_decision when the casting_requirement already resolves to an existing or stabilized planned characterId.",
    "The manual casting-candidate route remains required when a requirement has no resolved characterId, needs identity-board generation, or needs human casting review.",
    "Approved identity boards must cite an identityBoardArtifactId or an existing characterId.",
    "Rejected or missing candidates must produce follow-up actions before production_asset_detail can be trusted.",
  ],
});
