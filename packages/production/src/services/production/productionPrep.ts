import type { Episode, Project, Scene, ScriptBreakdown, Shot } from "../../../../../src/types/project";
import type { GameAction, GameChoice, GameNode, GameProjectData } from "../../../../../src/types/game";
import type { ProductionQAIssue } from "../../../../../src/types/production";
import {
  ContentLockPackage,
  ProductionBlockLock,
  ProductionLockFormat,
  ScriptLockPackage,
} from "./productionLock";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";
import { resolveAssetRef } from "../../../../../src/utils/assetRefs";

export type ProductionPrepDepartment =
  | "directing"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "casting"
  | "wardrobe_makeup"
  | "props"
  | "location_art"
  | "continuity"
  | "vfx_sfx"
  | "ui_interaction"
  | "sound_music"
  | "extras_stunts"
  | "production";

export const PRODUCTION_PREP_CANONICAL_DEPARTMENTS = [
  "directing",
  "cinematography",
  "lighting",
  "production_design",
  "wardrobe",
  "makeup_hair",
  "performance_directing",
  "action_choreography",
  "casting",
  "props",
  "continuity",
  "vfx_sfx",
  "ui_interaction",
  "sound_music",
  "extras_stunts",
  "production",
] as const satisfies readonly ProductionPrepDepartment[];

export const PRODUCTION_PREP_LEGACY_DEPARTMENTS = [
  "wardrobe_makeup",
  "location_art",
] as const satisfies readonly ProductionPrepDepartment[];

export const PRODUCTION_PREP_DEPARTMENTS = [
  ...PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  ...PRODUCTION_PREP_LEGACY_DEPARTMENTS,
] as const satisfies readonly ProductionPrepDepartment[];

export const PRODUCTION_PREP_DEPARTMENT_ALIASES = {
  wardrobe_makeup: ["wardrobe", "makeup_hair"],
  location_art: ["production_design"],
} as const satisfies Record<Extract<ProductionPrepDepartment, "wardrobe_makeup" | "location_art">, readonly ProductionPrepDepartment[]>;

export const expandProductionPrepDepartment = (
  department: ProductionPrepDepartment,
): ProductionPrepDepartment[] => [
  department,
  ...((PRODUCTION_PREP_DEPARTMENT_ALIASES as Partial<Record<ProductionPrepDepartment, readonly ProductionPrepDepartment[]>>)[department] || []),
];

export const isProductionPrepDepartment = (department: unknown): department is ProductionPrepDepartment =>
  PRODUCTION_PREP_DEPARTMENTS.includes(department as ProductionPrepDepartment);

export interface ProductionBreakdownScope {
  mode: ProductionLockFormat;
  blockId?: string;
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
  sourceLockIds: string[];
}

export interface ProductionSceneMatrixRow {
  sourceType: "scene" | "node";
  episodeId?: string;
  sceneId?: string;
  nodeId?: string;
  title: string;
  locationId?: string;
  locationName?: string;
  locationState?: string;
  timeOfDay?: string;
  characterIds: string[];
  characterNames: string[];
  characterStates?: ProductionSceneAssetState[];
  propIds: string[];
  propNames: string[];
  propStates?: ProductionSceneAssetState[];
  wardrobe: string[];
  makeupHair: string[];
  vfx: string[];
  sfx: string[];
  vehicles: string[];
  vehicleIds?: string[];
  extrasAtmosphere: string[];
  specialEquipment: string[];
  bgm: string[];
  variantRefs: string[];
  variantRefsByAsset?: Record<string, string>;
  shotIds: string[];
  shotBriefs?: ProductionShotPrepBrief[];
  interactive?: ProductionInteractiveNodeState;
}

export interface ProductionSceneAssetState {
  assetId?: string;
  name: string;
  state?: string;
  variantId?: string;
  requiresCanonicalAsset?: boolean;
}

export interface ProductionShotPrepBrief {
  shotId: string;
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  focalLength?: string;
  lighting?: string;
  lightingAtmo?: string;
  composition?: string;
  blocking?: string;
  continuityNote?: string;
  visualAction?: string;
  duration?: number;
  motivation?: string;
  microExpression?: string;
  characterIds: string[];
  propIds: string[];
  locationId?: string;
  dialogueLineCount: number;
}

export interface ProductionInteractiveNodeState {
  graphRevision?: string;
  pathRole: "golden_path" | "branch_path" | "ending_path" | "failure_path";
  uiLayout?: GameNode["uiLayout"];
  incomingChoiceIds: string[];
  incomingChoiceLabels: string[];
  outgoingChoiceIds: string[];
  outgoingChoiceLabels: string[];
  outgoingChoiceConditions: string[];
  variableStateIds: string[];
  variableEffects: string[];
  endingStateRefs: string[];
  failureStateRefs: string[];
}

export interface ProductionAssetAppearance {
  id: string;
  type:
    | "character"
    | "location"
    | "prop"
    | "wardrobe_makeup"
    | "vfx_sfx"
    | "vehicle"
    | "sound_music"
    | "extra"
    | "special_equipment"
    | "ui_asset"
    | "interactive_state"
    | "directing_brief"
    | "camera_plan"
    | "lighting_state"
    | "production_design"
    | "performance_beat"
    | "action_beat"
    | "production_coordination";
  name: string;
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
  shotIds: string[];
  variantIds: string[];
  stateNotes: string[];
  departments: ProductionPrepDepartment[];
}

export interface ProductionVariantNeed {
  id: string;
  assetId?: string;
  assetName: string;
  variantKind: "wardrobe" | "makeup_hair" | "prop_state" | "location_state" | "vfx_state" | "sound_state" | "ui_state" | "choice_state" | "interactive_variable_state" | "ending_state" | "failure_state" | "other";
  reason: string;
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
}

export interface WardrobeMakeupContinuityRow {
  characterId?: string;
  characterName: string;
  scope?: "character" | "scene";
  episodeId?: string;
  sceneId?: string;
  nodeId?: string;
  wardrobe: string[];
  makeupHair: string[];
  continuityIn: string;
  continuityOut: string;
}

export interface ProductionBreakdownReport {
  schemaVersion: "production-breakdown-report.v1";
  id: string;
  projectId: string;
  scope: ProductionBreakdownScope;
  interactiveCoverage?: ProductionInteractiveCoverage;
  sceneMatrix: ProductionSceneMatrixRow[];
  characterAppearances: ProductionAssetAppearance[];
  locationAppearances: ProductionAssetAppearance[];
  propAppearances: ProductionAssetAppearance[];
  wardrobeMakeupContinuity: WardrobeMakeupContinuityRow[];
  variantNeeds: ProductionVariantNeed[];
  departmentCounts: Record<ProductionPrepDepartment, number>;
  openQuestions: string[];
  createdAt: number;
}

export interface ProductionInteractiveCoverage {
  graphRevision?: string;
  nodeIds: string[];
  lockedNodeIds: string[];
  goldenPathNodeIds: string[];
  endingNodeIds: string[];
  failurePathNodeIds: string[];
  variableStateIds: string[];
  coveredNodeIds: string[];
  coveredGoldenPathNodeIds: string[];
  coveredEndingNodeIds: string[];
  coveredFailurePathNodeIds: string[];
  coveredVariableStateIds: string[];
  missingLockedNodeIds: string[];
  missingGoldenPathNodeIds: string[];
  missingEndingNodeIds: string[];
  missingFailurePathNodeIds: string[];
  hasLinearSceneFallback: boolean;
}

export interface CastingRequirement {
  schemaVersion: "casting-requirement.v1";
  id: string;
  projectId: string;
  productionBreakdownReportId: string;
  roleSlotId: string;
  characterId?: string;
  displayName: string;
  priority: "lead" | "supporting" | "day_player" | "extra";
  sceneAppearances: Array<{
    episodeId?: string;
    sceneId?: string;
    nodeId?: string;
    title: string;
  }>;
  ageRange?: string;
  physicality: string[];
  performanceRange: string[];
  voice: string[];
  stuntNeeds: string[];
  costumeConstraints: string[];
  emotionalTurns: string[];
  status: "draft" | "ready_for_director_review" | "approved";
  createdAt: number;
}

export interface DepartmentPrepAsset {
  assetId?: string;
  name: string;
  type: string;
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
  shotIds: string[];
  stateNotes: string[];
}

export interface DepartmentPrepPackage {
  schemaVersion: "department-prep-package.v1";
  id: string;
  projectId: string;
  productionBreakdownReportId: string;
  department: ProductionPrepDepartment;
  ownerAgentId: string;
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
  requiredAssets: DepartmentPrepAsset[];
  variants: ProductionVariantNeed[];
  departmentPlanType?: "legacy_combined" | "creative_direction" | "technical_plan" | "asset_state" | "continuity" | "performance" | "coordination";
  sceneRefs?: string[];
  shotRefs?: string[];
  continuityRefs?: string[];
  styleLockRefs?: string[];
  qaChecklist?: string[];
  specialistPayload?: Record<string, unknown>;
  continuityInOut: Array<{
    targetId: string;
    inState: string;
    outState: string;
    episodeId?: string;
    sceneId?: string;
    nodeId?: string;
  }>;
  readiness: "blocked" | "needs_review" | "ready_for_department_review";
  openQuestions: string[];
  createdAt: number;
}

type DepartmentPrepRequiredAsset = DepartmentPrepPackage["requiredAssets"][number];

export interface BuildProductionBreakdownInput {
  project: Project;
  episodes?: Episode[];
  scriptLockPackage?: Partial<ScriptLockPackage>;
  contentLockPackage?: Partial<ContentLockPackage>;
  productionBlockLock?: Partial<ProductionBlockLock>;
  scope?: Partial<ProductionBreakdownScope>;
  createdAt?: number;
}

const compact = (value: unknown) => String(value || "").trim();

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  options: {
    suggestion?: string;
    issueType?: string;
    retryable?: boolean;
    resolutionClass?: ProductionQAIssue["resolutionClass"];
  } = {},
): ProductionQAIssue => ({
  id: nowId("production_prep_issue"),
  severity,
  target,
  message,
  suggestion: options.suggestion,
  repairInstruction: options.suggestion || message,
  issueType: options.issueType || "production_prep_contract",
  retryable: options.retryable ?? severity !== "blocking",
  resolutionClass: options.resolutionClass,
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const normalizeItem = (value: string | { name?: string; state?: string; requiresAsset?: boolean } | undefined) => {
  if (typeof value === "string") return { name: compact(value), state: "", requiresAsset: undefined };
  return {
    name: compact(value?.name),
    state: compact(value?.state),
    requiresAsset: value?.requiresAsset,
  };
};

const normalizeNamedItems = (items: Array<string | { name?: string; state?: string; requiresAsset?: boolean }> = []) =>
  items
    .map(normalizeItem)
    .filter((item) => item.name);

const getEpisodes = (project: Project, episodes?: Episode[]): Episode[] => {
  if (Array.isArray(episodes) && episodes.length > 0) return episodes;
  return Array.isArray((project as any).episodes)
    ? ((project as any).episodes as Episode[]).filter((episode) => Array.isArray((episode as any).scenes))
    : [];
};

const getGameData = (project: Project, episodes: Episode[]): GameProjectData | undefined => {
  for (const episode of episodes) {
    if ((episode as any).gameData?.nodes) return (episode as any).gameData as GameProjectData;
  }
  if ((project as any).gameData?.nodes) return (project as any).gameData as GameProjectData;
  return undefined;
};

const inferMode = (project: Project): ProductionLockFormat =>
  project.projectModel === "interactive" || project.interactiveTemplate ? "interactive" : project.type;

const resolveScope = (input: BuildProductionBreakdownInput, episodes: Episode[]): ProductionBreakdownScope => {
  const block = input.productionBlockLock;
  const scriptLock = input.scriptLockPackage;
  const contentLock = input.contentLockPackage;
  const sourceLockIds = uniq([
    input.scope?.sourceLockIds,
    block?.id,
    scriptLock?.id,
    contentLock?.id,
  ].flat() as Array<string | undefined>);
  const lockedEpisodeIds = uniq([
    input.scope?.episodeIds,
    block?.episodeIds,
    scriptLock?.episodeIds,
  ].flat() as string[]);
  const episodeIds = lockedEpisodeIds.length ? lockedEpisodeIds : uniq(episodes.map((episode) => episode.id));
  const sceneIds = uniq([
    input.scope?.sceneIds,
    block?.sceneIds,
    scriptLock?.sceneIds,
  ].flat() as string[]);
  const nodeIds = uniq([
    input.scope?.nodeIds,
    block?.nodeIds,
    contentLock?.nodeIds,
  ].flat() as string[]);
  return {
    mode: input.scope?.mode || block?.mode || inferMode(input.project),
    blockId: input.scope?.blockId || block?.blockId,
    episodeIds,
    sceneIds,
    nodeIds,
    sourceLockIds,
  };
};

const getCharacterName = (project: Project, id: string) =>
  resolveAssetRef(project, "character", id)?.displayName ||
  project.characters.find((character) => character.id === id)?.name ||
  id;

const getAssetName = (project: Project, id: string) =>
  resolveAssetRef(project, "location", id)?.displayName ||
  resolveAssetRef(project, "prop", id)?.displayName ||
  resolveAssetRef(project, "character", id)?.displayName ||
  project.assets.find((asset) => asset.id === id)?.name ||
  id;

const getLocationName = (project: Project, id: string | undefined, fallback?: string) =>
  id ? getAssetName(project, id) : compact(fallback);

const collectShotIds = (shots?: Shot[]) => asArray<Shot>(shots).map((shot) => shot.id).filter(Boolean);

const collectShotBriefs = (shots?: Shot[]): ProductionShotPrepBrief[] =>
  asArray<Shot>(shots).map((shot) => ({
    shotId: shot.id,
    shotSize: compact(shot.shotSize),
    cameraAngle: compact(shot.cameraAngle),
    cameraMovement: compact(shot.cameraMovement),
    focalLength: compact(shot.focalLength),
    lighting: compact(shot.lighting),
    lightingAtmo: compact(shot.lightingAtmo),
    composition: compact(shot.composition),
    blocking: compact(shot.blocking),
    continuityNote: compact(shot.continuityNote),
    visualAction: compact(shot.visualAction),
    duration: Number.isFinite(shot.duration) ? Number(shot.duration) : undefined,
    motivation: compact(shot.motivation),
    microExpression: compact(shot.microExpression),
    characterIds: uniq(shot.characterIdsInShot || []),
    propIds: uniq(shot.propIds || []),
    locationId: compact(shot.locationId),
    dialogueLineCount: asArray(shot.dialogueLines).length,
  }));

const collectShotCharacterIds = (shots?: Shot[]) =>
  uniq(asArray<Shot>(shots).flatMap((shot) => shot.characterIdsInShot || []));

const collectShotPropIds = (shots?: Shot[]) =>
  uniq(asArray<Shot>(shots).flatMap((shot) => shot.propIds || []));

const collectShotLocationIds = (shots?: Shot[]) =>
  uniq(asArray<Shot>(shots).map((shot) => shot.locationId));

const bgmLabels = (breakdown?: ScriptBreakdown) =>
  asArray<{ prompt?: string; linkedAssetId?: string; description?: string }>(breakdown?.bgm)
    .map((item) => compact(item.linkedAssetId || item.prompt || item.description))
    .filter(Boolean);

const interactiveText = (node: GameNode) =>
  compact([node.title, node.scriptContent, node.detailedScript, node.sceneGoal, node.cliffhanger, node.hook].join(" "));

const looksLikeFailureNode = (node: GameNode) =>
  /失败|失误|死亡|坏结局|断线|game over|fail|failure|dead|bad ending/i.test(interactiveText(node));

const variableStateMatchesAction = (
  stateId: string,
  action: { targetVariableId?: string },
  variables: GameProjectData["variables"],
) => {
  const variableId = compact(action.targetVariableId);
  const variableName = compact(variables.find((variable) => variable.id === variableId)?.name);
  const lowered = stateId.toLowerCase();
  return Boolean(variableId && lowered.includes(variableId.toLowerCase())) ||
    Boolean(variableName && lowered.includes(variableName.toLowerCase()));
};

const variableStateMatchesCondition = (
  stateId: string,
  condition: string,
  variables: GameProjectData["variables"],
) => {
  const loweredState = stateId.toLowerCase();
  const loweredCondition = condition.toLowerCase();
  return variables.some((variable) =>
    loweredState.includes(variable.id.toLowerCase()) && loweredCondition.includes(variable.id.toLowerCase()) ||
    Boolean(variable.name && loweredState.includes(variable.name.toLowerCase()) && loweredCondition.includes(variable.name.toLowerCase())),
  );
};

const buildInteractiveNodeState = (
  node: GameNode,
  gameData: GameProjectData,
  contentLockPackage?: Partial<ContentLockPackage>,
): ProductionInteractiveNodeState => {
  const incoming = asArray<GameChoice>(gameData.edges).filter((edge) => edge.targetNodeId === node.id || edge.target === node.id);
  const outgoing = asArray<GameChoice>(gameData.edges).filter((edge) => edge.sourceNodeId === node.id || edge.source === node.id);
  const endingNodeIds = uniq([
    contentLockPackage?.endingNodeIds,
    gameData.nodes.filter((item) => item.isEnding).map((item) => item.id),
  ].flat() as string[]);
  const failurePathNodeIds = uniq([
    contentLockPackage?.failurePathNodeIds,
    gameData.nodes.filter(looksLikeFailureNode).map((item) => item.id),
  ].flat() as string[]);
  const variableStateIds = uniq([
    ...asArray<string>(contentLockPackage?.variableStateIds).filter((stateId) =>
      asArray<GameAction>(node.onEnterActions).some((action) => variableStateMatchesAction(stateId, action, gameData.variables)) ||
      incoming.some((edge) => edge.conditionExpression && variableStateMatchesCondition(stateId, edge.conditionExpression, gameData.variables)) ||
      outgoing.some((edge) => edge.conditionExpression && variableStateMatchesCondition(stateId, edge.conditionExpression, gameData.variables)),
    ),
    ...asArray<GameAction>(node.onEnterActions).map((action) => compact(action.targetVariableId)).filter(Boolean),
  ]);
  const isFailure = failurePathNodeIds.includes(node.id);
  const isEnding = endingNodeIds.includes(node.id) || Boolean(node.isEnding);
  const isGolden = asArray<string>(contentLockPackage?.goldenPathNodeIds).includes(node.id);
  const pathRole: ProductionInteractiveNodeState["pathRole"] = isFailure
    ? "failure_path"
    : isEnding
      ? "ending_path"
      : isGolden
        ? "golden_path"
        : "branch_path";
  return {
    graphRevision: contentLockPackage?.graphRevision,
    pathRole,
    uiLayout: node.uiLayout,
    incomingChoiceIds: uniq(incoming.map((edge) => edge.id)),
    incomingChoiceLabels: uniq(incoming.map((edge) => edge.displayText)),
    outgoingChoiceIds: uniq(outgoing.map((edge) => edge.id)),
    outgoingChoiceLabels: uniq(outgoing.map((edge) => edge.displayText)),
    outgoingChoiceConditions: uniq(outgoing.map((edge) => edge.conditionExpression)),
    variableStateIds,
    variableEffects: uniq(asArray<GameAction>(node.onEnterActions).map((action) =>
      `${action.targetVariableId}:${action.operation}:${String(action.value)}`,
    )),
    endingStateRefs: isEnding ? uniq([node.id, node.title]) : [],
    failureStateRefs: isFailure ? uniq([node.id, node.title]) : [],
  };
};

const buildRowFromScene = (
  project: Project,
  episode: Episode,
  scene: Scene,
): ProductionSceneMatrixRow => {
  const breakdown = scene.breakdown;
  const rawCharacters = normalizeNamedItems(breakdown?.characters || []);
  const rawProps = normalizeNamedItems(breakdown?.props || []);
  const rawLocation = normalizeItem(breakdown?.location as any);
  const shotCharacterIds = collectShotCharacterIds(scene.shots);
  const shotPropIds = collectShotPropIds(scene.shots);
  const shotLocationIds = collectShotLocationIds(scene.shots);
  const characterIds = uniq([...(breakdown?.characterIds || []), ...shotCharacterIds]);
  const propIds = uniq([...(breakdown?.propIds || []), ...shotPropIds]);
  const locationId = breakdown?.locationId || shotLocationIds[0];
  const variantRefsByAsset = Object.fromEntries(
    Object.entries(breakdown?.assetVariantMap || {})
      .map(([assetId, variantId]) => [compact(assetId), compact(variantId)] as const)
      .filter(([assetId, variantId]) => Boolean(assetId && variantId)),
  );
  const characterStates: ProductionSceneAssetState[] = [
    ...characterIds.map((assetId) => {
      const name = getCharacterName(project, assetId);
      const source = rawCharacters.find((item) => item.name === name);
      return {
        assetId,
        name,
        state: source?.state || undefined,
        variantId: variantRefsByAsset[assetId],
        requiresCanonicalAsset: true,
      };
    }),
    ...rawCharacters
      .filter((item) => !characterIds.some((assetId) => getCharacterName(project, assetId) === item.name))
      .map((item) => ({
        name: item.name,
        state: item.state || undefined,
        requiresCanonicalAsset: Boolean(resolveAssetRef(project, "character", item.name)),
      })),
  ];
  const propStates: ProductionSceneAssetState[] = [
    ...propIds.map((assetId) => {
      const name = getAssetName(project, assetId);
      const source = rawProps.find((item) => item.name === name);
      return {
        assetId,
        name,
        state: source?.state || undefined,
        variantId: variantRefsByAsset[assetId],
        requiresCanonicalAsset: true,
      };
    }),
    ...rawProps
      .filter((item) => !propIds.some((assetId) => getAssetName(project, assetId) === item.name))
      .map((item) => ({
        name: item.name,
        state: item.state || undefined,
        requiresCanonicalAsset: item.requiresAsset === true || Boolean(resolveAssetRef(project, "prop", item.name)),
      })),
  ];
  return {
    sourceType: "scene",
    episodeId: episode.id,
    sceneId: scene.id,
    title: scene.title || scene.sceneNumber || scene.id,
    locationId,
    locationName: getLocationName(project, locationId, rawLocation.name || scene.environment),
    locationState: rawLocation.state || undefined,
    timeOfDay: compact(breakdown?.time || scene.timeOfDay),
    characterIds,
    characterNames: uniq(characterStates.map((item) => item.name)),
    characterStates,
    propIds,
    propNames: uniq(propStates.map((item) => item.name)),
    propStates,
    wardrobe: uniq(breakdown?.wardrobe || []),
    makeupHair: uniq(breakdown?.makeupHair || []),
    vfx: uniq(breakdown?.vfx || []),
    sfx: uniq(breakdown?.sfx || []),
    vehicles: uniq(breakdown?.vehicles || []),
    vehicleIds: uniq([...(breakdown?.vehicleIds || []), ...(scene.shots || []).flatMap((shot) => shot.vehicleIds || [])]),
    extrasAtmosphere: uniq(breakdown?.extrasAtmosphere || []),
    specialEquipment: uniq(breakdown?.specialEquipment || []),
    bgm: uniq(bgmLabels(breakdown)),
    variantRefs: uniq(Object.values(variantRefsByAsset)),
    variantRefsByAsset,
    shotIds: collectShotIds(scene.shots),
    shotBriefs: collectShotBriefs(scene.shots),
  };
};

const buildRowFromNode = (
  project: Project,
  episodeId: string | undefined,
  node: GameNode,
  gameData: GameProjectData,
  contentLockPackage?: Partial<ContentLockPackage>,
): ProductionSceneMatrixRow => {
  const pseudoScene: Scene = {
    id: node.id,
    sourceNodeId: node.id,
    title: node.title,
    description: node.scriptContent || node.detailedScript || node.sceneGoal || "",
    valueCharge: node.valueCharge || "neutral",
    script: node.detailedScript || node.scriptContent,
    scriptBlocks: node.scriptBlocks,
    shots: node.shots,
    breakdown: node.breakdown,
    sceneGoal: node.sceneGoal,
    sceneAssets: node.sceneAssets,
    environment: node.environment,
    timeOfDay: node.timeOfDay,
  };
  return {
    ...buildRowFromScene(project, {
      id: episodeId || "interactive-project",
      title: episodeId || "互动项目",
      inspiration: "",
      scenes: [pseudoScene],
    }, pseudoScene),
    sourceType: "node",
    nodeId: node.id,
    sceneId: undefined,
    interactive: buildInteractiveNodeState(node, gameData, contentLockPackage),
  };
};

const buildInteractiveCoverage = (
  rows: ProductionSceneMatrixRow[],
  scope: ProductionBreakdownScope,
  gameData?: GameProjectData,
  contentLockPackage?: Partial<ContentLockPackage>,
): ProductionInteractiveCoverage | undefined => {
  if (scope.mode !== "interactive") return undefined;
  const nodeRows = rows.filter((row) => row.sourceType === "node");
  const coveredNodeIds = uniq(nodeRows.map((row) => row.nodeId));
  const graphNodeIds = uniq(asArray<GameNode>(gameData?.nodes).map((node) => node.id));
  const lockedNodeIds = uniq([
    scope.nodeIds,
    contentLockPackage?.nodeIds,
  ].flat() as string[]);
  const goldenPathNodeIds = uniq(asArray<string>(contentLockPackage?.goldenPathNodeIds));
  const endingNodeIds = uniq([
    contentLockPackage?.endingNodeIds,
    asArray<GameNode>(gameData?.nodes).filter((node) => node.isEnding).map((node) => node.id),
  ].flat() as string[]);
  const failurePathNodeIds = uniq([
    contentLockPackage?.failurePathNodeIds,
    asArray<GameNode>(gameData?.nodes).filter(looksLikeFailureNode).map((node) => node.id),
  ].flat() as string[]);
  const coveredGoldenPathNodeIds = coveredNodeIds.filter((nodeId) => goldenPathNodeIds.includes(nodeId));
  const coveredEndingNodeIds = coveredNodeIds.filter((nodeId) => endingNodeIds.includes(nodeId));
  const coveredFailurePathNodeIds = coveredNodeIds.filter((nodeId) => failurePathNodeIds.includes(nodeId));
  const coveredVariableStateIds = uniq(nodeRows.flatMap((row) => row.interactive?.variableStateIds || []));
  return {
    graphRevision: contentLockPackage?.graphRevision,
    nodeIds: graphNodeIds,
    lockedNodeIds,
    goldenPathNodeIds,
    endingNodeIds,
    failurePathNodeIds,
    variableStateIds: uniq(asArray<string>(contentLockPackage?.variableStateIds)),
    coveredNodeIds,
    coveredGoldenPathNodeIds,
    coveredEndingNodeIds,
    coveredFailurePathNodeIds,
    coveredVariableStateIds,
    missingLockedNodeIds: lockedNodeIds.filter((nodeId) => !coveredNodeIds.includes(nodeId)),
    missingGoldenPathNodeIds: goldenPathNodeIds.filter((nodeId) => !coveredNodeIds.includes(nodeId)),
    missingEndingNodeIds: endingNodeIds.filter((nodeId) => !coveredNodeIds.includes(nodeId)),
    missingFailurePathNodeIds: failurePathNodeIds.filter((nodeId) => !coveredNodeIds.includes(nodeId)),
    hasLinearSceneFallback: rows.some((row) => row.sourceType === "scene"),
  };
};

const createAppearanceMap = () => new Map<string, ProductionAssetAppearance>();

const mergeAppearance = (
  map: Map<string, ProductionAssetAppearance>,
  key: string,
  input: Omit<ProductionAssetAppearance, "episodeIds" | "sceneIds" | "nodeIds" | "shotIds" | "variantIds" | "stateNotes"> &
    Partial<Pick<ProductionAssetAppearance, "episodeIds" | "sceneIds" | "nodeIds" | "shotIds" | "variantIds" | "stateNotes">>,
) => {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...input,
      episodeIds: uniq(input.episodeIds || []),
      sceneIds: uniq(input.sceneIds || []),
      nodeIds: uniq(input.nodeIds || []),
      shotIds: uniq(input.shotIds || []),
      variantIds: uniq(input.variantIds || []),
      stateNotes: uniq(input.stateNotes || []),
    });
    return;
  }
  map.set(key, {
    ...existing,
    episodeIds: uniq([...existing.episodeIds, ...(input.episodeIds || [])]),
    sceneIds: uniq([...existing.sceneIds, ...(input.sceneIds || [])]),
    nodeIds: uniq([...existing.nodeIds, ...(input.nodeIds || [])]),
    shotIds: uniq([...existing.shotIds, ...(input.shotIds || [])]),
    variantIds: uniq([...existing.variantIds, ...(input.variantIds || [])]),
    stateNotes: uniq([...existing.stateNotes, ...(input.stateNotes || [])]),
    departments: uniq([...existing.departments, ...input.departments]) as ProductionPrepDepartment[],
  });
};

const rowsToAppearances = (project: Project, rows: ProductionSceneMatrixRow[]) => {
  const characters = createAppearanceMap();
  const locations = createAppearanceMap();
  const props = createAppearanceMap();
  const variantNeeds: ProductionVariantNeed[] = [];
  const wardrobeMakeupContinuity: WardrobeMakeupContinuityRow[] = [];

  for (const row of rows) {
    const common = {
      episodeIds: row.episodeId ? [row.episodeId] : [],
      sceneIds: row.sceneId ? [row.sceneId] : [],
      nodeIds: row.nodeId ? [row.nodeId] : [],
      shotIds: row.shotIds,
    };
    for (const id of row.characterIds) {
      const characterState = asArray<ProductionSceneAssetState>(row.characterStates)
        .find((item) => item.assetId === id);
      const variantIds = uniq([row.variantRefsByAsset?.[id], characterState?.variantId]);
      mergeAppearance(characters, `character:${id}`, {
        id,
        type: "character",
        name: getCharacterName(project, id),
        departments: ["casting", "performance_directing", "wardrobe", "makeup_hair", "wardrobe_makeup", "continuity"],
        stateNotes: uniq([
          characterState?.state,
          ...(row.characterIds.length === 1 ? [...row.wardrobe, ...row.makeupHair] : []),
          ...variantIds,
        ]),
        variantIds,
        ...common,
      });
    }
    for (const name of row.characterNames.filter((name) => !row.characterIds.some((id) => getCharacterName(project, id) === name))) {
      const characterState = asArray<ProductionSceneAssetState>(row.characterStates)
        .find((item) => !item.assetId && item.name === name);
      mergeAppearance(characters, `character-name:${name}`, {
        id: `role-slot-${name}`,
        type: "character",
        name,
        departments: ["casting", "performance_directing", "wardrobe", "makeup_hair", "wardrobe_makeup", "continuity"],
        stateNotes: uniq([
          characterState?.state,
          ...(row.characterNames.length === 1 ? [...row.wardrobe, ...row.makeupHair] : []),
        ]),
        variantIds: [],
        ...common,
      });
    }
    if (row.locationId || row.locationName) {
      const id = row.locationId || `location-slot-${row.locationName}`;
      const variantIds = uniq([row.locationId ? row.variantRefsByAsset?.[row.locationId] : undefined]);
      mergeAppearance(locations, `location:${id}`, {
        id,
        type: "location",
        name: row.locationName || getAssetName(project, id),
        departments: ["production_design", "location_art", "lighting", "continuity"],
        stateNotes: uniq([row.locationState, row.timeOfDay, ...variantIds]),
        variantIds,
        ...common,
      });
    }
    for (const id of row.propIds) {
      const propState = asArray<ProductionSceneAssetState>(row.propStates)
        .find((item) => item.assetId === id);
      const variantIds = uniq([row.variantRefsByAsset?.[id], propState?.variantId]);
      mergeAppearance(props, `prop:${id}`, {
        id,
        type: "prop",
        name: getAssetName(project, id),
        departments: ["props", "production_design", "continuity"],
        stateNotes: uniq([propState?.state, ...variantIds]),
        variantIds,
        ...common,
      });
    }
    for (const name of row.propNames.filter((name) => !row.propIds.some((id) => getAssetName(project, id) === name))) {
      const propState = asArray<ProductionSceneAssetState>(row.propStates)
        .find((item) => !item.assetId && item.name === name);
      mergeAppearance(props, `prop-name:${name}`, {
        id: `prop-slot-${name}`,
        type: "prop",
        name,
        departments: ["props", "production_design", "continuity"],
        stateNotes: uniq([propState?.state]),
        variantIds: [],
        ...common,
      });
    }
    if (row.wardrobe.length || row.makeupHair.length) {
      const characterName = row.characterNames.length === 1 ? row.characterNames[0] : "本场服化妆总表";
      const characterId = row.characterNames.length === 1
        ? row.characterIds.find((id) => getCharacterName(project, id) === characterName)
        : undefined;
      const characterVariantIds = uniq(row.characterIds.map((id) => row.variantRefsByAsset?.[id]));
      wardrobeMakeupContinuity.push({
        characterId,
        characterName,
        scope: row.characterNames.length === 1 ? "character" : "scene",
        episodeId: row.episodeId,
        sceneId: row.sceneId,
        nodeId: row.nodeId,
        wardrobe: row.wardrobe,
        makeupHair: row.makeupHair,
        continuityIn: row.timeOfDay ? `${row.timeOfDay} 入场` : "未声明入场状态",
        continuityOut: characterVariantIds.length ? `带出变体：${characterVariantIds.join(", ")}` : "未声明出场变化",
      });
    }
    const mappedVariantIds = new Set<string>();
    for (const [assetId, variantId] of Object.entries(row.variantRefsByAsset || {})) {
      mappedVariantIds.add(variantId);
      const variantKind: ProductionVariantNeed["variantKind"] = assetId === row.locationId
        ? "location_state"
        : row.propIds.includes(assetId)
          ? "prop_state"
          : "other";
      variantNeeds.push({
        id: `variant-need-${variantId}`,
        assetId,
        assetName: getAssetName(project, assetId),
        variantKind,
        reason: "breakdown.assetVariantMap 声明了非默认视觉状态。",
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
      });
    }
    for (const variantId of row.variantRefs.filter((id) => !mappedVariantIds.has(id))) {
      variantNeeds.push({
        id: `variant-need-${variantId}`,
        assetName: variantId,
        variantKind: "other",
        reason: "breakdown 声明了非默认视觉状态，但缺少 canonical assetId 绑定。",
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
      });
    }
    for (const item of row.wardrobe) {
      variantNeeds.push({
        id: `variant-need-wardrobe-${row.sceneId || row.nodeId}-${item}`,
        assetName: item,
        variantKind: "wardrobe",
        reason: "锁定内容声明了服装状态，需要服装部门确认基础 look 或场次变体。",
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
      });
    }
    for (const item of row.makeupHair) {
      variantNeeds.push({
        id: `variant-need-makeup-${row.sceneId || row.nodeId}-${item}`,
        assetName: item,
        variantKind: "makeup_hair",
        reason: "锁定内容声明了妆发状态，需要妆发部门确认连续性。",
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
      });
    }
    if (row.interactive) {
      if (row.interactive.uiLayout) {
        variantNeeds.push({
          id: `variant-need-ui-${row.nodeId}-${row.interactive.uiLayout}`,
          assetName: `UI layout: ${row.interactive.uiLayout}`,
          variantKind: "ui_state",
          reason: "互动节点声明了 UI layout，需要 UI 安全区、选项停顿和状态反馈资产。",
          episodeIds: row.episodeId ? [row.episodeId] : [],
          sceneIds: row.sceneId ? [row.sceneId] : [],
          nodeIds: row.nodeId ? [row.nodeId] : [],
        });
      }
      for (const choiceLabel of row.interactive.outgoingChoiceLabels) {
        variantNeeds.push({
          id: `variant-need-choice-${row.nodeId}-${choiceLabel}`,
          assetName: choiceLabel,
          variantKind: "choice_state",
          reason: "互动节点存在玩家选择，需要选择文案、状态反馈和分支承接资产。",
          episodeIds: row.episodeId ? [row.episodeId] : [],
          sceneIds: row.sceneId ? [row.sceneId] : [],
          nodeIds: row.nodeId ? [row.nodeId] : [],
        });
      }
      for (const variableStateId of row.interactive.variableStateIds) {
        variantNeeds.push({
          id: `variant-need-variable-${row.nodeId}-${variableStateId}`,
          assetName: variableStateId,
          variantKind: "interactive_variable_state",
          reason: "互动节点读写变量状态，正式资产需要标明该状态下的角色/道具/场景变化。",
          episodeIds: row.episodeId ? [row.episodeId] : [],
          sceneIds: row.sceneId ? [row.sceneId] : [],
          nodeIds: row.nodeId ? [row.nodeId] : [],
        });
      }
      for (const endingRef of row.interactive.endingStateRefs) {
        variantNeeds.push({
          id: `variant-need-ending-${row.nodeId}-${endingRef}`,
          assetName: endingRef,
          variantKind: "ending_state",
          reason: "互动结局节点需要独立结局状态、收束画面和后续交付标记。",
          episodeIds: row.episodeId ? [row.episodeId] : [],
          sceneIds: row.sceneId ? [row.sceneId] : [],
          nodeIds: row.nodeId ? [row.nodeId] : [],
        });
      }
      for (const failureRef of row.interactive.failureStateRefs) {
        variantNeeds.push({
          id: `variant-need-failure-${row.nodeId}-${failureRef}`,
          assetName: failureRef,
          variantKind: "failure_state",
          reason: "互动失败路径需要独立失败状态、重试反馈和风险提示资产。",
          episodeIds: row.episodeId ? [row.episodeId] : [],
          sceneIds: row.sceneId ? [row.sceneId] : [],
          nodeIds: row.nodeId ? [row.nodeId] : [],
        });
      }
    }
  }
  return {
    characterAppearances: Array.from(characters.values()),
    locationAppearances: Array.from(locations.values()),
    propAppearances: Array.from(props.values()),
    wardrobeMakeupContinuity,
    variantNeeds,
  };
};

const hasActionSignal = (row: ProductionSceneMatrixRow) =>
  [
    ...row.vfx,
    ...row.sfx,
    ...row.vehicles,
    ...row.specialEquipment,
    ...row.extrasAtmosphere,
    row.title,
  ].some((item) => /战|打|追|摔|跌|跑|爆|火|危险|搏|杀|逃|跳|撞|fight|chase|stunt|combat|fall|run|explosion/i.test(item));

const countDepartment = (rows: ProductionSceneMatrixRow[], appearances: ReturnType<typeof rowsToAppearances>) => {
  const wardrobeCount = appearances.wardrobeMakeupContinuity.length + appearances.variantNeeds.filter((need) => need.variantKind === "wardrobe").length;
  const makeupHairCount = appearances.wardrobeMakeupContinuity.length + appearances.variantNeeds.filter((need) => need.variantKind === "makeup_hair").length;
  const locationCount = appearances.locationAppearances.length;
  const actionCount = rows.filter(hasActionSignal).length;
  return {
    directing: rows.length,
    cinematography: rows.reduce((total, row) => total + Math.max(row.shotIds.length, 1), 0),
    lighting: rows.filter((row) => row.timeOfDay || row.locationName || row.vfx.length).length,
    production_design: locationCount + appearances.propAppearances.length,
    wardrobe: wardrobeCount,
    makeup_hair: makeupHairCount,
    performance_directing: appearances.characterAppearances.length,
    action_choreography: actionCount,
    casting: appearances.characterAppearances.length,
    wardrobe_makeup: wardrobeCount + makeupHairCount,
    props: appearances.propAppearances.length,
    location_art: locationCount,
    continuity: rows.length + appearances.variantNeeds.length,
    vfx_sfx: rows.reduce((total, row) => total + row.vfx.length + row.sfx.length + row.specialEquipment.length, 0),
    ui_interaction: rows.reduce((total, row) =>
      total +
      (row.interactive?.uiLayout ? 1 : 0) +
      (row.interactive?.outgoingChoiceIds.length || 0) +
      (row.interactive?.variableStateIds.length || 0),
    0),
    sound_music: rows.reduce((total, row) => total + row.bgm.length + row.sfx.length, 0),
    extras_stunts: rows.reduce((total, row) => total + row.extrasAtmosphere.length + row.vehicles.length, 0),
    production: rows.length,
  } satisfies Record<ProductionPrepDepartment, number>;
};

export const buildProductionBreakdownReport = (input: BuildProductionBreakdownInput): ProductionBreakdownReport => {
  const episodes = getEpisodes(input.project, input.episodes);
  const scope = resolveScope(input, episodes);
  const includeEpisode = (episodeId: string) => scope.episodeIds.length === 0 || scope.episodeIds.includes(episodeId);
  const includeScene = (sceneId: string) => scope.sceneIds.length === 0 || scope.sceneIds.includes(sceneId);
  const rows: ProductionSceneMatrixRow[] = [];
  const gameData = getGameData(input.project, episodes);

  if (scope.mode !== "interactive") {
    for (const episode of episodes) {
      if (!includeEpisode(episode.id)) continue;
      for (const scene of episode.scenes || []) {
        if (!includeScene(scene.id)) continue;
        rows.push(buildRowFromScene(input.project, episode, scene));
      }
    }
  }

  if (scope.mode === "interactive" && gameData?.nodes?.length) {
    const nodeEpisodeId = episodes.find((episode) => (episode as any).gameData === gameData)?.id;
    for (const node of gameData.nodes) {
      if (scope.nodeIds.length && !scope.nodeIds.includes(node.id)) continue;
      rows.push(buildRowFromNode(input.project, nodeEpisodeId, node, gameData, input.contentLockPackage));
    }
  }

  const appearances = rowsToAppearances(input.project, rows);
  const interactiveCoverage = buildInteractiveCoverage(rows, scope, gameData, input.contentLockPackage);
  return {
    schemaVersion: "production-breakdown-report.v1",
    id: `production-breakdown-${input.project.id}-${scope.blockId || scope.sourceLockIds[0] || "unlocked"}`,
    projectId: input.project.id,
    scope,
    ...(interactiveCoverage ? { interactiveCoverage } : {}),
    sceneMatrix: rows,
    ...appearances,
    departmentCounts: countDepartment(rows, appearances),
    openQuestions: scope.sourceLockIds.length
      ? []
      : ["缺少 script/content/block lock 来源，只能作为 breakdown 草案，不能驱动正式资产筹备。"],
    createdAt: Number(input.createdAt || Date.now()),
  };
};

export const buildCastingRequirements = (
  project: Project,
  report: ProductionBreakdownReport,
  createdAt = Date.now(),
): CastingRequirement[] => report.characterAppearances.map((appearance, index) => {
  const characterRef = resolveAssetRef(project, "character", appearance.id) || resolveAssetRef(project, "character", appearance.name);
  const character = project.characters.find((item) => item.id === characterRef?.canonicalId);
  const sceneAppearances = report.sceneMatrix
    .filter((row) =>
      appearance.sceneIds.includes(row.sceneId || "") ||
      appearance.nodeIds.includes(row.nodeId || "") ||
      row.characterNames.includes(appearance.name),
    )
    .map((row) => ({
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      title: row.title,
    }));
  return {
    schemaVersion: "casting-requirement.v1",
    id: `casting-requirement-${appearance.id}`,
    projectId: project.id,
    productionBreakdownReportId: report.id,
    roleSlotId: appearance.id.startsWith("role-slot-") ? appearance.id : `role-slot-${appearance.id}`,
    characterId: characterRef?.canonicalId || character?.id,
    displayName: character?.name || characterRef?.displayName || appearance.name,
    priority: index === 0 || sceneAppearances.length >= 3 ? "lead" : sceneAppearances.length >= 2 ? "supporting" : "day_player",
    sceneAppearances,
    physicality: uniq([
      character?.actingStyle,
      appearance.stateNotes.find((note) => /伤|血|打|跑|跌|战|追/.test(note)) ? "需要动作/身体状态连续性" : undefined,
    ]),
    performanceRange: uniq([
      character?.psychologicalProfile,
      character?.mbti ? `MBTI 行为偏好：${character.mbti}` : undefined,
      character?.enneagram ? `九型压力模式：${character.enneagram}` : undefined,
      character?.internalDesire ? `内在渴望：${character.internalDesire}` : undefined,
      character?.externalGoal ? `外在目标：${character.externalGoal}` : undefined,
      character?.flaw ? `压力弱点：${character.flaw}` : undefined,
      character?.sliders && Object.keys(character.sliders).length
        ? `情绪基线：${Object.entries(character.sliders).map(([key, value]) => `${key}:${value}`).join("；")}`
        : undefined,
      ...sceneAppearances.map((scene) => scene.title),
    ]).slice(0, 10),
    voice: uniq([character?.voiceName, character?.vocalQuirk]),
    stuntNeeds: appearance.stateNotes.some((note) => /战|打|跌|追|爆|火|伤/.test(note)) ? ["动作/特技协调需复核"] : [],
    costumeConstraints: appearance.stateNotes,
    emotionalTurns: uniq(sceneAppearances.map((scene) => scene.title)).slice(0, 5),
    status: sceneAppearances.length ? "ready_for_director_review" : "draft",
    createdAt,
  };
});

const packageFromAppearances = (
  projectId: string,
  report: ProductionBreakdownReport,
  department: ProductionPrepDepartment,
  appearances: ProductionAssetAppearance[],
  variants: ProductionVariantNeed[] = [],
  createdAt = Date.now(),
): DepartmentPrepPackage => {
  const canonicalAssetId = (appearance: ProductionAssetAppearance) =>
    appearance.id.startsWith(`${appearance.type}-slot-`) || appearance.id.startsWith("role-slot-")
      ? undefined
      : appearance.id;
  const targetIdFor = (appearance: ProductionAssetAppearance) => canonicalAssetId(appearance) || appearance.name;
  const rowMatchesScope = (appearance: ProductionAssetAppearance, row: ProductionSceneMatrixRow) =>
    (!appearance.episodeIds.length || Boolean(row.episodeId && appearance.episodeIds.includes(row.episodeId))) &&
    (!appearance.sceneIds.length || Boolean(row.sceneId && appearance.sceneIds.includes(row.sceneId))) &&
    (!appearance.nodeIds.length || Boolean(row.nodeId && appearance.nodeIds.includes(row.nodeId)));
  const rowMatchesTarget = (appearance: ProductionAssetAppearance, row: ProductionSceneMatrixRow) => {
    if (!rowMatchesScope(appearance, row)) return false;
    if (appearance.type === "character") {
      const states = asArray<ProductionSceneAssetState>(row.characterStates);
      return states.length
        ? states.some((item) => item.assetId === canonicalAssetId(appearance) || (!item.assetId && item.name === appearance.name))
        : row.characterIds.includes(appearance.id) || row.characterNames.includes(appearance.name);
    }
    if (appearance.type === "location") {
      return row.locationId === canonicalAssetId(appearance) || (!canonicalAssetId(appearance) && row.locationName === appearance.name);
    }
    if (appearance.type === "prop") {
      const states = asArray<ProductionSceneAssetState>(row.propStates);
      return states.length
        ? states.some((item) => item.assetId === canonicalAssetId(appearance) || (!item.assetId && item.name === appearance.name))
        : row.propIds.includes(appearance.id) || row.propNames.includes(appearance.name);
    }
    return true;
  };
  const continuityStateFor = (appearance: ProductionAssetAppearance, row: ProductionSceneMatrixRow) => {
    const assetId = canonicalAssetId(appearance);
    const variantId = assetId ? row.variantRefsByAsset?.[assetId] : undefined;
    if (appearance.type === "character") {
      const target = asArray<ProductionSceneAssetState>(row.characterStates)
        .find((item) => item.assetId === assetId || (!item.assetId && item.name === appearance.name));
      return uniq([
        appearance.name,
        target?.state,
        variantId,
      ]).join(" / ") || "未记录";
    }
    if (appearance.type === "location") {
      return uniq([
        row.locationName || appearance.name,
        row.locationState,
        row.timeOfDay,
        ...row.vfx,
        ...row.extrasAtmosphere,
        variantId,
      ]).join(" / ") || "未记录";
    }
    if (appearance.type === "prop") {
      const target = asArray<ProductionSceneAssetState>(row.propStates)
        .find((item) => item.assetId === assetId || (!item.assetId && item.name === appearance.name));
      return uniq([appearance.name, target?.state, variantId]).join(" / ") || "未记录";
    }
    return uniq([appearance.name, ...appearance.stateNotes, variantId]).join(" / ") || "未记录";
  };
  const requiredAssets = appearances.map((appearance) => ({
    assetId: canonicalAssetId(appearance),
    name: appearance.name,
    type: appearance.type,
    episodeIds: appearance.episodeIds,
    sceneIds: appearance.sceneIds,
    nodeIds: appearance.nodeIds,
    shotIds: appearance.shotIds,
    stateNotes: appearance.stateNotes,
  }));
  const continuityEntries = appearances.flatMap((appearance) => {
    const scopedRows = report.sceneMatrix.filter((row) => rowMatchesTarget(appearance, row));
    if (!scopedRows.length) {
      const fallbackState = uniq([appearance.name, ...appearance.stateNotes]).join(" / ") || "未记录";
      return [{
        targetId: targetIdFor(appearance),
        inState: fallbackState,
        outState: fallbackState,
        episodeId: appearance.episodeIds[0],
        sceneId: appearance.sceneIds[0],
        nodeId: appearance.nodeIds[0],
      }];
    }
    return scopedRows.map((row) => {
      const visibleState = continuityStateFor(appearance, row);
      return {
        targetId: targetIdFor(appearance),
        inState: visibleState,
        outState: visibleState,
        episodeId: row.episodeId,
        sceneId: row.sceneId,
        nodeId: row.nodeId,
      };
    });
  });
  const continuityInOut = Array.from(new Map(continuityEntries.map((entry) => [
    `${entry.targetId}:${entry.episodeId || ""}:${entry.sceneId || ""}:${entry.nodeId || ""}`,
    entry,
  ])).values());
  const openQuestions = requiredAssets.length === 0
    ? [`${department} 没有从锁定内容中抽取到明确资产，需确认是否为空部门或 breakdown 缺失。`]
    : [];
  const packageSceneRefs = uniq([
    ...requiredAssets.flatMap((asset) => asset.sceneIds),
    ...report.sceneMatrix.map((row) => row.sceneId),
  ]);
  const packageShotRefs = uniq([
    ...requiredAssets.flatMap((asset) => asset.shotIds),
    ...report.sceneMatrix.flatMap((row) => row.shotIds),
  ]);
  return {
    schemaVersion: "department-prep-package.v1",
    id: `department-prep-${department}-${report.id}`,
    projectId,
    productionBreakdownReportId: report.id,
    department,
    ownerAgentId: `department.${department}.prep`,
    episodeIds: report.scope.episodeIds,
    sceneIds: report.scope.sceneIds.length ? report.scope.sceneIds : uniq(report.sceneMatrix.map((row) => row.sceneId)),
    nodeIds: report.scope.nodeIds.length ? report.scope.nodeIds : uniq(report.sceneMatrix.map((row) => row.nodeId)),
    requiredAssets,
    variants,
    departmentPlanType: departmentPlanType(department),
    sceneRefs: packageSceneRefs,
    shotRefs: packageShotRefs,
    continuityRefs: continuityInOut.map((row) => row.targetId),
    styleLockRefs: [],
    qaChecklist: departmentQaChecklist(department),
    specialistPayload: buildDepartmentSpecialistPayload(department, report, requiredAssets, variants),
    continuityInOut,
    readiness: report.sceneMatrix.length === 0 ? "blocked" : openQuestions.length ? "needs_review" : "ready_for_department_review",
    openQuestions,
    createdAt,
  };
};

const departmentPlanType = (
  department: ProductionPrepDepartment,
): NonNullable<DepartmentPrepPackage["departmentPlanType"]> => {
  if (department === "wardrobe_makeup" || department === "location_art") return "legacy_combined";
  if (department === "directing" || department === "casting") return "creative_direction";
  if (department === "cinematography" || department === "lighting" || department === "vfx_sfx" || department === "sound_music") return "technical_plan";
  if (department === "continuity") return "continuity";
  if (department === "performance_directing" || department === "action_choreography" || department === "extras_stunts") return "performance";
  if (department === "production") return "coordination";
  return "asset_state";
};

const departmentQaChecklist = (department: ProductionPrepDepartment): string[] => {
  const shared = [
    "sourceRefs must trace back to locked scene/node matrix",
    "readiness must not be treated as formal delivery without artifact QA",
  ];
  const specific: Partial<Record<ProductionPrepDepartment, string[]>> = {
    directing: ["creative intent, blocking, and performance purpose are explicit"],
    cinematography: ["coverage, axis, lens/movement, and composition risks are visible"],
    lighting: ["light source logic, time continuity, and mood lighting are consistent"],
    production_design: ["set dressing, spatial logic, materials, and reuse scope are clear"],
    wardrobe: ["costume state, damage, wet/blood status, and continuity are clear"],
    makeup_hair: ["makeup, hair, injury, sweat/tears, and continuity are clear"],
    performance_directing: ["acting beats, micro expressions, and emotional arc are clear"],
    action_choreography: ["action causality, prop interaction, safety, and motion continuity are clear"],
    props: ["ownership, usage state, breakage, and hero-prop continuity are clear"],
    continuity: ["in/out state, previous/next scene links, and soft/hard holds are clear"],
    vfx_sfx: ["practical/generated boundaries, effect state, and cost/safety risk are clear"],
    sound_music: ["sound cue, BGM entry/exit, ambience, and silence are motivated"],
    ui_interaction: ["UI layout, choice state, variable state, endings, and failure paths are covered"],
    extras_stunts: ["crowd blocking, stunt risk, and background action are clear"],
    production: ["department handoff, approval state, and missing package risk are visible"],
    wardrobe_makeup: ["legacy combined costume/makeup package remains readable"],
    location_art: ["legacy location/set package maps to production design"],
    casting: ["role slot, casting requirement, candidate, and director decision are traceable"],
  };
  return [...(specific[department] || []), ...shared];
};

const rowRef = (row: ProductionSceneMatrixRow) => row.sceneId || row.nodeId || row.title;

const rowShotBriefs = (row: ProductionSceneMatrixRow) => asArray<ProductionShotPrepBrief>(row.shotBriefs);

const shotTextSignals = (shot: ProductionShotPrepBrief) => [
  shot.visualAction,
  shot.blocking,
  shot.cameraMovement,
  shot.continuityNote,
  shot.motivation,
].join(" ");

const hasActionShotSignal = (shot: ProductionShotPrepBrief) =>
  /战|打|追|摔|跌|跑|爆|火|危险|搏|杀|逃|跳|撞|fight|chase|stunt|combat|fall|run|explosion/i.test(shotTextSignals(shot));

const buildCinematographyPayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "cinematography-prep.v1",
  coveragePlan: report.sceneMatrix.map((row) => {
    const shots = rowShotBriefs(row);
    return {
      sourceType: row.sourceType,
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      title: row.title,
      shotRefs: row.shotIds,
      shotCount: row.shotIds.length,
      cameraLanguage: uniq(shots.flatMap((shot) => [shot.shotSize, shot.cameraAngle, shot.cameraMovement])),
      lensRange: uniq(shots.map((shot) => shot.focalLength)),
      movementPlan: uniq(shots.map((shot) => shot.cameraMovement)),
      axisPlan: uniq(shots.map((shot) => shot.continuityNote)).slice(0, 6),
      compositionRules: uniq(shots.map((shot) => shot.composition)).slice(0, 6),
      missingShotBriefs: row.shotIds.filter((shotId) => !shots.some((shot) => shot.shotId === shotId)),
    };
  }),
  globalConstraints: [
    "Storyboard panels must preserve eyeline, screen direction, shot size, camera angle, movement, lens and composition refs.",
    "Prompt/video unit generation should inherit camera refs from this package instead of inventing ad hoc camera language.",
  ],
});

const buildLightingPayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "lighting-prep.v1",
  lightingPlan: report.sceneMatrix.map((row) => {
    const shots = rowShotBriefs(row);
    const shotLighting = uniq(shots.flatMap((shot) => [shot.lighting, shot.lightingAtmo]));
    return {
      sourceType: row.sourceType,
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      title: row.title,
      locationName: row.locationName,
      timeOfDay: row.timeOfDay,
      lightSourceLogic: shotLighting.length
        ? shotLighting
        : uniq([row.timeOfDay, row.locationName, ...row.vfx]).filter(Boolean),
      moodLighting: shotLighting.slice(0, 4),
      practicalLights: uniq(row.vfx.filter((item) => /灯|火|烛|霓虹|屏|光|lamp|fire|neon|screen|light/i.test(item))),
      continuityRisks: row.timeOfDay ? [] : ["timeOfDay missing; lighting continuity needs department review"],
    };
  }),
  negativeLightingConstraints: [
    "Do not change project visual style lock through lighting notes.",
    "Do not mix day/night or practical/generated light sources without continuity justification.",
  ],
});

const buildProductionDesignPayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "production-design-prep.v1",
  setPlans: report.sceneMatrix.map((row) => ({
    sourceType: row.sourceType,
    episodeId: row.episodeId,
    sceneId: row.sceneId,
    nodeId: row.nodeId,
    title: row.title,
    locationId: row.locationId,
    locationName: row.locationName,
    timeOfDay: row.timeOfDay,
    propIds: row.propIds,
    propNames: row.propNames,
    setDressingSignals: uniq([
      row.locationName,
      row.timeOfDay,
      ...row.extrasAtmosphere,
      ...row.specialEquipment,
      ...row.variantRefs,
    ]),
    spatialContinuityRefs: row.shotIds,
    reuseBoundary: row.variantRefs.length
      ? "requires scene-specific set/location variant"
      : "can reuse canonical set/location if continuity matrix stays clear",
  })),
  qaFocus: ["space continuity", "set dressing reuse", "material/world consistency", "location state variants"],
});

const buildWardrobePayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "wardrobe-prep.v1",
  wardrobeStates: report.wardrobeMakeupContinuity
    .filter((row) => row.wardrobe.length)
    .map((row) => ({
      characterId: row.characterId,
      characterName: row.characterName,
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      wardrobe: row.wardrobe,
      continuityIn: row.continuityIn,
      continuityOut: row.continuityOut,
    })),
  variantNeeds: report.variantNeeds.filter((need) => need.variantKind === "wardrobe"),
  continuityRule: "Costume layer, damage, wet/blood state, and change reason must remain stable across continuity-linked scenes.",
});

const buildMakeupHairPayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "makeup-hair-prep.v1",
  makeupHairStates: report.wardrobeMakeupContinuity
    .filter((row) => row.makeupHair.length)
    .map((row) => ({
      characterId: row.characterId,
      characterName: row.characterName,
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      makeupHair: row.makeupHair,
      continuityIn: row.continuityIn,
      continuityOut: row.continuityOut,
    })),
  variantNeeds: report.variantNeeds.filter((need) => need.variantKind === "makeup_hair"),
  continuityRule: "Hair shape, injury makeup, sweat, tears, blood, aging and dirt state must be variant-backed when visible.",
});

const buildPerformancePayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "performance-directing-prep.v1",
  actingBeats: report.sceneMatrix.map((row) => {
    const shots = rowShotBriefs(row);
    return {
      sourceType: row.sourceType,
      episodeId: row.episodeId,
      sceneId: row.sceneId,
      nodeId: row.nodeId,
      title: row.title,
      characterNames: row.characterNames,
      shotRefs: row.shotIds,
      visibleActions: uniq(shots.map((shot) => shot.visualAction)).slice(0, 8),
      microExpressions: uniq(shots.map((shot) => shot.microExpression)).slice(0, 8),
      dialogueLineCount: shots.reduce((total, shot) => total + Number(shot.dialogueLineCount || 0), 0),
      emotionalArcRefs: uniq(shots.flatMap((shot) => [shot.motivation, shot.continuityNote])).slice(0, 8),
    };
  }),
  qaFocus: ["character motivation", "emotional progression", "dialogue/action purpose", "micro-expression visibility"],
});

const buildActionChoreographyPayload = (report: ProductionBreakdownReport) => ({
  schemaVersion: "action-choreography-prep.v1",
  actionBeats: report.sceneMatrix
    .filter((row) => hasActionSignal(row) || rowShotBriefs(row).some(hasActionShotSignal))
    .map((row) => {
      const shots = rowShotBriefs(row);
      return {
        sourceType: row.sourceType,
        episodeId: row.episodeId,
        sceneId: row.sceneId,
        nodeId: row.nodeId,
        title: row.title,
        shotRefs: row.shotIds,
        actionShotRefs: shots.filter(hasActionShotSignal).map((shot) => shot.shotId),
        propIds: row.propIds,
        propNames: row.propNames,
        vehicles: row.vehicles,
        specialEquipment: row.specialEquipment,
        actionSignals: uniq([
          ...row.vfx,
          ...row.sfx,
          ...shots.flatMap((shot) => [shot.visualAction, shot.blocking, shot.cameraMovement]),
        ]).slice(0, 12),
        safetyRisk: row.specialEquipment.length || row.vehicles.length || row.vfx.length
          ? "needs safety/cost review"
          : "standard motion continuity review",
        motionContinuity: uniq(shots.map((shot) => shot.continuityNote)).slice(0, 8),
      };
    }),
  qaFocus: ["action causality", "motion continuity", "prop/space interaction", "safety and cost risk"],
});

const buildDepartmentSpecialistPayload = (
  department: ProductionPrepDepartment,
  report: ProductionBreakdownReport,
  requiredAssets: DepartmentPrepRequiredAsset[],
  variants: ProductionVariantNeed[],
): Record<string, unknown> => {
  switch (department) {
    case "cinematography":
      return buildCinematographyPayload(report);
    case "lighting":
      return buildLightingPayload(report);
    case "production_design":
      return buildProductionDesignPayload(report);
    case "wardrobe":
      return buildWardrobePayload(report);
    case "makeup_hair":
      return buildMakeupHairPayload(report);
    case "performance_directing":
      return buildPerformancePayload(report);
    case "action_choreography":
      return buildActionChoreographyPayload(report);
    default:
      return {
        schemaVersion: "department-prep-generic.v1",
        department,
        requiredAssetCount: requiredAssets.length,
        variantCount: variants.length,
        sourceSceneCount: report.sceneMatrix.filter((row) => row.sourceType === "scene").length,
        sourceNodeCount: report.sceneMatrix.filter((row) => row.sourceType === "node").length,
      };
  }
};

const virtualAppearances = (
  rows: ProductionSceneMatrixRow[],
  type: ProductionAssetAppearance["type"],
  department: ProductionPrepDepartment,
  selector: (row: ProductionSceneMatrixRow) => string[],
): ProductionAssetAppearance[] => {
  const map = createAppearanceMap();
  for (const row of rows) {
    for (const name of selector(row)) {
      mergeAppearance(map, `${type}:${name}`, {
        id: `${type}-${name}`,
        type,
        name,
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
        shotIds: row.shotIds,
        variantIds: row.variantRefs,
        stateNotes: row.variantRefs,
        departments: [department],
      });
    }
  }
  return Array.from(map.values());
};

const virtualPlanAppearances = (
  rows: ProductionSceneMatrixRow[],
  type: ProductionAssetAppearance["type"],
  department: ProductionPrepDepartment,
  selector: (row: ProductionSceneMatrixRow) => string[],
): ProductionAssetAppearance[] => {
  const map = createAppearanceMap();
  for (const row of rows) {
    for (const name of selector(row)) {
      const label = compact(name || row.title);
      if (!label) continue;
      mergeAppearance(map, `${type}:${rowRef(row)}:${label}`, {
        id: `${type}-slot-${rowRef(row)}-${label}`,
        type,
        name: label,
        episodeIds: row.episodeId ? [row.episodeId] : [],
        sceneIds: row.sceneId ? [row.sceneId] : [],
        nodeIds: row.nodeId ? [row.nodeId] : [],
        shotIds: row.shotIds,
        variantIds: row.variantRefs,
        stateNotes: uniq([row.timeOfDay, row.locationName, ...row.variantRefs]),
        departments: [department],
      });
    }
  }
  return Array.from(map.values());
};

const wardrobeDepartmentAppearances = (
  report: ProductionBreakdownReport,
  department: Extract<ProductionPrepDepartment, "wardrobe" | "makeup_hair">,
): ProductionAssetAppearance[] => {
  const map = createAppearanceMap();
  for (const row of report.wardrobeMakeupContinuity) {
    const stateNotes = department === "wardrobe" ? row.wardrobe : row.makeupHair;
    if (!stateNotes.length) continue;
    const matrixRow = report.sceneMatrix.find((item) =>
      item.sceneId && item.sceneId === row.sceneId ||
      item.nodeId && item.nodeId === row.nodeId,
    );
    const id = row.characterId || `wardrobe_makeup-slot-${row.sceneId || row.nodeId || row.characterName}`;
    const variantIds = row.characterId
      ? uniq([matrixRow?.variantRefsByAsset?.[row.characterId]])
      : uniq((matrixRow?.characterIds || []).map((characterId) => matrixRow?.variantRefsByAsset?.[characterId]));
    mergeAppearance(map, `${department}:${id}:${row.sceneId || row.nodeId || "scope"}`, {
      id,
      type: "wardrobe_makeup",
      name: row.characterName,
      episodeIds: row.episodeId ? [row.episodeId] : [],
      sceneIds: row.sceneId ? [row.sceneId] : [],
      nodeIds: row.nodeId ? [row.nodeId] : [],
      shotIds: matrixRow?.shotIds || [],
      variantIds,
      stateNotes,
      departments: [department],
    });
  }
  return Array.from(map.values());
};

const actionRows = (report: ProductionBreakdownReport) =>
  report.sceneMatrix.filter((row) => hasActionSignal(row) || rowShotBriefs(row).some(hasActionShotSignal));

export const buildDepartmentPrepPackages = (
  project: Project,
  report: ProductionBreakdownReport,
  createdAt = Date.now(),
): DepartmentPrepPackage[] => [
  packageFromAppearances(project.id, report, "cinematography", virtualPlanAppearances(report.sceneMatrix, "camera_plan", "cinematography", (row) => [
    `${row.title} coverage`,
  ]), [], createdAt),
  packageFromAppearances(project.id, report, "lighting", virtualPlanAppearances(report.sceneMatrix, "lighting_state", "lighting", (row) => {
    const lightingSignals = uniq([
      ...rowShotBriefs(row).flatMap((shot) => [shot.lighting, shot.lightingAtmo]),
      row.timeOfDay,
      row.locationName,
      ...row.vfx,
    ]);
    return lightingSignals.length ? [`${row.title} lighting`] : [];
  }), [], createdAt),
  packageFromAppearances(project.id, report, "production_design", [
    ...report.locationAppearances,
    ...report.propAppearances,
    ...virtualPlanAppearances(report.sceneMatrix, "production_design", "production_design", (row) => uniq([
      row.locationName,
      ...row.extrasAtmosphere,
      ...row.specialEquipment,
    ]).map((item) => `${row.title}: ${item}`)),
  ], report.variantNeeds.filter((need) => need.variantKind === "location_state" || need.variantKind === "prop_state" || need.variantKind === "other"), createdAt),
  packageFromAppearances(project.id, report, "wardrobe", wardrobeDepartmentAppearances(report, "wardrobe"), report.variantNeeds.filter((need) => need.variantKind === "wardrobe"), createdAt),
  packageFromAppearances(project.id, report, "makeup_hair", wardrobeDepartmentAppearances(report, "makeup_hair"), report.variantNeeds.filter((need) => need.variantKind === "makeup_hair"), createdAt),
  packageFromAppearances(project.id, report, "performance_directing", [
    ...report.characterAppearances,
    ...virtualPlanAppearances(report.sceneMatrix, "performance_beat", "performance_directing", (row) => row.characterNames.length
      ? row.characterNames.map((name) => `${row.title}: ${name}`)
      : [row.title]),
  ], [], createdAt),
  packageFromAppearances(project.id, report, "action_choreography", virtualPlanAppearances(actionRows(report), "action_beat", "action_choreography", (row) => [
    `${row.title} action choreography`,
  ]), [], createdAt),
  packageFromAppearances(project.id, report, "wardrobe_makeup", report.characterAppearances, report.variantNeeds.filter((need) => need.variantKind === "wardrobe" || need.variantKind === "makeup_hair"), createdAt),
  packageFromAppearances(project.id, report, "props", report.propAppearances, report.variantNeeds.filter((need) => need.variantKind === "prop_state" || need.variantKind === "other"), createdAt),
  packageFromAppearances(project.id, report, "location_art", report.locationAppearances, report.variantNeeds.filter((need) => need.variantKind === "location_state"), createdAt),
  packageFromAppearances(project.id, report, "continuity", [
    ...report.characterAppearances,
    ...report.locationAppearances,
    ...report.propAppearances,
  ], report.variantNeeds, createdAt),
  packageFromAppearances(project.id, report, "vfx_sfx", [
    ...virtualAppearances(report.sceneMatrix, "vfx_sfx", "vfx_sfx", (row) => [...row.vfx, ...row.sfx]),
    ...virtualAppearances(report.sceneMatrix, "special_equipment", "vfx_sfx", (row) => row.specialEquipment),
  ], report.variantNeeds.filter((need) => need.variantKind === "vfx_state" || need.variantKind === "failure_state"), createdAt),
  packageFromAppearances(project.id, report, "ui_interaction", [
    ...virtualAppearances(report.sceneMatrix, "ui_asset", "ui_interaction", (row) =>
      row.interactive?.uiLayout ? [`UI layout: ${row.interactive.uiLayout}`] : [],
    ),
    ...virtualAppearances(report.sceneMatrix, "interactive_state", "ui_interaction", (row) => [
      ...(row.interactive?.outgoingChoiceLabels || []),
      ...(row.interactive?.variableStateIds || []),
      ...(row.interactive?.endingStateRefs || []),
      ...(row.interactive?.failureStateRefs || []),
    ]),
  ], report.variantNeeds.filter((need) =>
    need.variantKind === "ui_state" ||
    need.variantKind === "choice_state" ||
    need.variantKind === "interactive_variable_state" ||
    need.variantKind === "ending_state" ||
    need.variantKind === "failure_state",
  ), createdAt),
  packageFromAppearances(project.id, report, "sound_music", virtualAppearances(report.sceneMatrix, "sound_music", "sound_music", (row) => [...row.bgm, ...row.sfx]), [], createdAt),
  packageFromAppearances(project.id, report, "extras_stunts", virtualAppearances(report.sceneMatrix, "extra", "extras_stunts", (row) => [...row.extrasAtmosphere, ...row.vehicles]), [], createdAt),
];

export const validateProductionBreakdownReport = (
  report?: Partial<ProductionBreakdownReport>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!report || typeof report !== "object") {
    return normalizeProductionQAIssues([issue("production_breakdown_report", "production_breakdown_report artifact 必须包含结构化报告。", "blocking", { retryable: false })]);
  }
  if (report.schemaVersion !== "production-breakdown-report.v1") {
    issues.push(issue("production_breakdown_report.schemaVersion", "schemaVersion 必须是 production-breakdown-report.v1。", "blocking", { retryable: false }));
  }
  if (!compact(report.projectId)) issues.push(issue("production_breakdown_report.projectId", "生产拆解报告缺少 projectId。", "blocking"));
  if (!report.scope || asArray(report.scope.sourceLockIds).length === 0) {
    issues.push(issue("production_breakdown_report.scope.sourceLockIds", "生产拆解报告缺少 script/content/block lock 来源，只能作为草案。", "warning", { resolutionClass: "soft_hold" }));
  }
  if (!asArray(report.sceneMatrix).length) {
    issues.push(issue("production_breakdown_report.sceneMatrix", "生产拆解报告没有 scene/node matrix，不能驱动正式资产筹备。", "blocking"));
  }
  if (!asArray(report.characterAppearances).length) {
    issues.push(issue("production_breakdown_report.characterAppearances", "生产拆解报告没有角色出现表；若该 block 确实无角色需人工确认。", "warning"));
  }
  if (!asArray(report.locationAppearances).length) {
    issues.push(issue("production_breakdown_report.locationAppearances", "生产拆解报告没有场景/地点出现表。", "warning"));
  }
  if (report.scope?.mode === "interactive") {
    const coverage = report.interactiveCoverage;
    const rows = asArray<Partial<ProductionSceneMatrixRow>>(report.sceneMatrix);
    if (!coverage) {
      issues.push(issue("production_breakdown_report.interactiveCoverage", "互动 production_breakdown_report 必须包含 graph/node/变量/结局覆盖摘要。", "blocking"));
    } else {
      if (coverage.hasLinearSceneFallback || rows.some((row) => row.sourceType !== "node")) {
        issues.push(issue("production_breakdown_report.sceneMatrix.sourceType", "互动生产拆解不能把线性 scene 投影当正式来源，必须使用锁定 graph node。", "blocking"));
      }
      if (!asArray(coverage.lockedNodeIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.lockedNodeIds", "互动生产拆解缺少锁定 nodeIds，不能驱动正式资产筹备。", "blocking"));
      }
      if (asArray(coverage.missingLockedNodeIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.missingLockedNodeIds", "互动生产拆解没有覆盖全部锁定节点。", "blocking", {
          suggestion: `补齐节点 breakdown：${coverage.missingLockedNodeIds.join(", ")}`,
        }));
      }
      if (asArray(coverage.missingGoldenPathNodeIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.missingGoldenPathNodeIds", "互动生产拆解缺少 Golden Path 节点覆盖。", "blocking", {
          suggestion: `补齐 Golden Path 节点：${coverage.missingGoldenPathNodeIds.join(", ")}`,
        }));
      }
      if (asArray(coverage.endingNodeIds).length && asArray(coverage.missingEndingNodeIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.missingEndingNodeIds", "互动生产拆解缺少结局节点资产筹备覆盖。", "blocking", {
          suggestion: `补齐结局节点：${coverage.missingEndingNodeIds.join(", ")}`,
        }));
      }
      if (asArray(coverage.failurePathNodeIds).length && asArray(coverage.missingFailurePathNodeIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.missingFailurePathNodeIds", "互动生产拆解缺少失败路径资产筹备覆盖。", "blocking", {
          suggestion: `补齐失败路径节点：${coverage.missingFailurePathNodeIds.join(", ")}`,
        }));
      }
      if (asArray(coverage.variableStateIds).length && !asArray(coverage.coveredVariableStateIds).length) {
        issues.push(issue("production_breakdown_report.interactiveCoverage.coveredVariableStateIds", "互动生产拆解没有把 content lock 的变量状态映射到节点资产需求。", "blocking"));
      }
    }
    if (rows.some((row) => !row.interactive)) {
      issues.push(issue("production_breakdown_report.sceneMatrix.interactive", "互动 node row 必须包含 UI、选择、变量状态和路径角色 metadata。", "blocking"));
    }
  }
  return normalizeProductionQAIssues(issues);
};

export const validateCastingRequirements = (
  requirements?: Partial<CastingRequirement>[],
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  const items = asArray<Partial<CastingRequirement>>(requirements);
  if (!items.length) {
    return normalizeProductionQAIssues([issue("casting_requirement", "casting_requirement artifact 必须包含至少一个角色需求。", "blocking")]);
  }
  items.forEach((item, index) => {
    const target = `casting_requirement.${index}`;
    if (item.schemaVersion !== "casting-requirement.v1") issues.push(issue(`${target}.schemaVersion`, "schemaVersion 必须是 casting-requirement.v1。", "blocking"));
    if (!compact(item.projectId)) issues.push(issue(`${target}.projectId`, "角色需求缺少 projectId。", "blocking"));
    if (!compact(item.productionBreakdownReportId)) issues.push(issue(`${target}.productionBreakdownReportId`, "角色需求必须绑定 productionBreakdownReportId。", "blocking"));
    if (!compact(item.roleSlotId)) issues.push(issue(`${target}.roleSlotId`, "角色需求缺少 roleSlotId。", "blocking"));
    if (!compact(item.displayName)) issues.push(issue(`${target}.displayName`, "角色需求缺少 displayName。", "blocking"));
    if (!asArray(item.sceneAppearances).length) issues.push(issue(`${target}.sceneAppearances`, "角色需求缺少出现集场/节点。", "warning"));
    if (!asArray(item.performanceRange).length) issues.push(issue(`${target}.performanceRange`, "角色需求建议补充表演范围。", "warning"));
  });
  return normalizeProductionQAIssues(issues);
};

export const validateDepartmentPrepPackages = (
  packages?: Partial<DepartmentPrepPackage>[],
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  const items = asArray<Partial<DepartmentPrepPackage>>(packages);
  if (!items.length) {
    return normalizeProductionQAIssues([issue("department_prep_package", "department_prep_package artifact 必须包含至少一个部门筹备包。", "blocking")]);
  }
  items.forEach((item, index) => {
    const target = `department_prep_package.${index}`;
    if (item.schemaVersion !== "department-prep-package.v1") issues.push(issue(`${target}.schemaVersion`, "schemaVersion 必须是 department-prep-package.v1。", "blocking"));
    if (!compact(item.projectId)) issues.push(issue(`${target}.projectId`, "部门筹备包缺少 projectId。", "blocking"));
    if (!compact(item.productionBreakdownReportId)) issues.push(issue(`${target}.productionBreakdownReportId`, "部门筹备包必须绑定 productionBreakdownReportId。", "blocking"));
    if (!compact(item.department)) issues.push(issue(`${target}.department`, "部门筹备包缺少 department。", "blocking"));
    if (compact(item.department) && !isProductionPrepDepartment(item.department)) {
      issues.push(issue(`${target}.department`, `未知部门 ${item.department}，必须先登记到 ProductionPrepDepartment 或 legacy alias。`, "blocking"));
    }
    if (!compact(item.ownerAgentId)) issues.push(issue(`${target}.ownerAgentId`, "部门筹备包缺少 ownerAgentId。", "blocking"));
    if (item.readiness === "blocked") issues.push(issue(`${target}.readiness`, "部门筹备包处于 blocked，不能进入正式资产制作。", "blocking"));
    if (!asArray(item.requiredAssets).length && item.readiness !== "needs_review") {
      issues.push(issue(`${target}.requiredAssets`, "部门筹备包没有 requiredAssets，应标记 needs_review 或补充部门资产清单。", "warning"));
    }
    if (item.sceneRefs && !Array.isArray(item.sceneRefs)) issues.push(issue(`${target}.sceneRefs`, "sceneRefs 必须是数组。", "blocking"));
    if (item.shotRefs && !Array.isArray(item.shotRefs)) issues.push(issue(`${target}.shotRefs`, "shotRefs 必须是数组。", "blocking"));
    if (item.qaChecklist && !Array.isArray(item.qaChecklist)) issues.push(issue(`${target}.qaChecklist`, "qaChecklist 必须是数组。", "blocking"));
    if (item.specialistPayload && (typeof item.specialistPayload !== "object" || Array.isArray(item.specialistPayload))) {
      issues.push(issue(`${target}.specialistPayload`, "specialistPayload 必须是部门专用结构化对象。", "blocking"));
    }
  });
  return normalizeProductionQAIssues(issues);
};

export const buildProductionPrepSystem = () => ({
  schemaVersion: "production-prep-system.v1",
  status: "production_prep_contract_stage_integrated",
  artifactKinds: ["production_breakdown_report", "continuity_matrix", "casting_requirement", "casting_decision", "department_prep_package"],
  builderFunctions: [
    "buildProductionBreakdownReport",
    "buildCastingRequirements",
    "buildAutostudioCastingDecisions",
    "buildDepartmentPrepPackages",
    "buildContinuityMatrix",
  ],
  qaFunctions: [
    "validateProductionBreakdownReport",
    "validateCastingRequirements",
    "validateCastingDecision",
    "validateDepartmentPrepPackages",
    "validateContinuityMatrix",
  ],
  requiredInputs: [
    "script_lock_package or content_lock_package",
    "production_block_lock for rolling series/short-drama/interactive production",
    "locked scenes or graph nodes with script/breakdown data",
  ],
  canonicalDepartments: PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  legacyDepartments: PRODUCTION_PREP_LEGACY_DEPARTMENTS,
  departmentAliases: PRODUCTION_PREP_DEPARTMENT_ALIASES,
  departmentEnvelopeFields: [
    "departmentPlanType",
    "sceneRefs",
    "shotRefs",
    "continuityRefs",
    "styleLockRefs",
    "qaChecklist",
    "specialistPayload",
  ],
  specialistPayloadSchemas: [
    { department: "cinematography", schemaVersion: "cinematography-prep.v1", keys: ["coveragePlan", "globalConstraints"] },
    { department: "lighting", schemaVersion: "lighting-prep.v1", keys: ["lightingPlan", "negativeLightingConstraints"] },
    { department: "production_design", schemaVersion: "production-design-prep.v1", keys: ["setPlans", "qaFocus"] },
    { department: "wardrobe", schemaVersion: "wardrobe-prep.v1", keys: ["wardrobeStates", "variantNeeds", "continuityRule"] },
    { department: "makeup_hair", schemaVersion: "makeup-hair-prep.v1", keys: ["makeupHairStates", "variantNeeds", "continuityRule"] },
    { department: "performance_directing", schemaVersion: "performance-directing-prep.v1", keys: ["actingBeats", "qaFocus"] },
    { department: "action_choreography", schemaVersion: "action-choreography-prep.v1", keys: ["actionBeats", "qaFocus"] },
  ],
  requiredBehavior: [
    "Build production_breakdown_report from locked script scenes or locked interactive nodes, not from the whole project by default.",
    "Interactive production_breakdown_report must include interactiveCoverage for graph revision, locked nodes, Golden Path, endings, failure paths, and variable states.",
    "Generate casting_requirement from the locked breakdown before final character identity boards.",
    "When a casting_requirement resolves to an existing or stabilized planned characterId, the production_breakdown runner may emit an approved assign_existing_character casting_decision through the AutoStudio casting bridge.",
    "Unresolved casting requirements remain in the Director/Casting candidate and decision path before production_asset_detail can be trusted.",
    "Generate department_prep_package for production design, wardrobe, makeup/hair, props, continuity, VFX/SFX, UI/interaction, sound/music, extras/stunts, and legacy wardrobe_makeup/location_art compatibility views from the same report.",
    "Generate continuity_matrix in the same production_breakdown stage so continuity reads the locked scene/node matrix, department prep, and scene variant facts instead of a second frontend reconstruction.",
    "Treat directing, cinematography, lighting, performance_directing, and action_choreography as canonical horizontal department agents; specialized builders may roll out by department without becoming formal workflow stages.",
    "Specialized department packages must include structured specialistPayload objects for camera, lighting, production design, wardrobe, makeup/hair, performance, and action prep.",
    "Expand legacy wardrobe_makeup to wardrobe + makeup_hair and legacy location_art to production_design when computing department coverage.",
    "Generate all production prep artifacts inside the production_breakdown stage before production_asset_detail and formal scene_visual_pack planning.",
  ],
  commitBehavior: "formal_stage_output_with_operator_artifact_qa",
});
