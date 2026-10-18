import type {
  DepartmentPrepPackage,
  ProductionPrepDepartment,
} from "./productionPrep";
import type {
  StoryboardDepartmentPrepRef,
  StoryboardDepartmentRefDepartment,
} from "./videoStoryboardArtifacts";
import type { Scene, Shot } from "../../../../../src/types/project";

export interface StoryboardDepartmentPrepRefSet {
  cinematographyRefs: StoryboardDepartmentPrepRef[];
  lightingRefs: StoryboardDepartmentPrepRef[];
  performanceRefs: StoryboardDepartmentPrepRef[];
  actionRefs: StoryboardDepartmentPrepRef[];
}

export const STORYBOARD_DEPARTMENT_REF_DEPARTMENTS = [
  "cinematography",
  "lighting",
  "performance_directing",
  "action_choreography",
] as const satisfies readonly StoryboardDepartmentRefDepartment[];

const departmentFieldByDepartment = {
  cinematography: "cinematographyRefs",
  lighting: "lightingRefs",
  performance_directing: "performanceRefs",
  action_choreography: "actionRefs",
} as const satisfies Record<StoryboardDepartmentRefDepartment, keyof StoryboardDepartmentPrepRefSet>;

const departmentLabelByDepartment = {
  cinematography: "摄影",
  lighting: "灯光",
  performance_directing: "表演导演",
  action_choreography: "动作",
} as const satisfies Record<StoryboardDepartmentRefDepartment, string>;

const clean = (value: unknown) => String(value || "").trim();

const unique = (values: Array<string | undefined | null>) =>
  Array.from(new Set(values.map(clean).filter(Boolean)));

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const isStoryboardDepartment = (
  department: ProductionPrepDepartment,
): department is StoryboardDepartmentRefDepartment =>
  STORYBOARD_DEPARTMENT_REF_DEPARTMENTS.includes(department as StoryboardDepartmentRefDepartment);

const intersects = (left: string[], right: string[]) =>
  left.length === 0 || right.length === 0 || left.some((item) => right.includes(item));

export const sceneNeedsPerformancePrep = (
  scene: Scene | undefined,
  shots: Shot[] = scene?.shots || [],
) => Boolean(
  scene?.breakdown?.characters?.length
  || scene?.breakdown?.characterIds?.length
  || shots.some((shot) => (
    Boolean(shot.characterIdsInShot?.length)
    || Boolean(shot.dialogueLines?.length)
  )),
);

const packageSceneRefs = (pack: DepartmentPrepPackage) => unique([
  ...(pack.sceneRefs || []),
  ...(pack.sceneIds || []),
  ...asArray<DepartmentPrepPackage["requiredAssets"][number]>(pack.requiredAssets).flatMap((asset) => asset.sceneIds || []),
  ...asArray<DepartmentPrepPackage["continuityInOut"][number]>(pack.continuityInOut).map((row) => row.sceneId),
]);

const packageShotRefs = (pack: DepartmentPrepPackage) => unique([
  ...(pack.shotRefs || []),
  ...asArray<DepartmentPrepPackage["requiredAssets"][number]>(pack.requiredAssets).flatMap((asset) => asset.shotIds || []),
]);

const payloadRows = (pack: DepartmentPrepPackage) => {
  const payload = asRecord(pack.specialistPayload);
  if (pack.department === "cinematography") return asArray<Record<string, unknown>>(payload.coveragePlan);
  if (pack.department === "lighting") return asArray<Record<string, unknown>>(payload.lightingPlan);
  if (pack.department === "performance_directing") return asArray<Record<string, unknown>>(payload.actingBeats);
  if (pack.department === "action_choreography") return asArray<Record<string, unknown>>(payload.actionBeats);
  return [];
};

const rowSceneRefs = (row: Record<string, unknown>) => unique([
  clean(row.sceneId),
  clean(row.nodeId),
  ...asArray<string>(row.sceneRefs),
]);

const rowShotRefs = (row: Record<string, unknown>) => unique([
  ...asArray<string>(row.shotRefs),
  clean(row.shotId),
]);

const rowMatchesScope = (
  row: Record<string, unknown>,
  sceneId: string,
  shotIds: string[],
) => {
  const sceneRefs = rowSceneRefs(row);
  const shotRefs = rowShotRefs(row);
  return (sceneRefs.length === 0 || sceneRefs.includes(sceneId)) && intersects(shotRefs, shotIds);
};

const packMatchesScope = (
  pack: DepartmentPrepPackage,
  sceneId: string,
  shotIds: string[],
) => {
  const sceneRefs = packageSceneRefs(pack);
  const shotRefs = packageShotRefs(pack);
  return (sceneRefs.length === 0 || sceneRefs.includes(sceneId)) && intersects(shotRefs, shotIds);
};

const listText = (value: unknown) =>
  asArray<unknown>(value)
    .map(clean)
    .filter(Boolean)
    .join("、");

const summaryForRow = (
  department: StoryboardDepartmentRefDepartment,
  row: Record<string, unknown>,
) => {
  const title = clean(row.title);
  if (department === "cinematography") {
    return unique([
      title,
      listText(row.cameraLanguage),
      listText(row.movementPlan),
      listText(row.axisPlan),
      listText(row.compositionRules),
    ]).join(" / ");
  }
  if (department === "lighting") {
    return unique([
      title,
      listText(row.lightSourceLogic),
      listText(row.moodLighting),
      listText(row.continuityRisks),
    ]).join(" / ");
  }
  if (department === "performance_directing") {
    return unique([
      title,
      listText(row.characterNames),
      listText(row.visibleActions),
      listText(row.microExpressions),
    ]).join(" / ");
  }
  return unique([
    title,
    listText(row.actionChain),
    listText(row.motionContinuity),
    listText(row.safetyRisks),
  ]).join(" / ");
};

const fallbackSummary = (
  pack: DepartmentPrepPackage,
  _sceneId: string,
  _shotIds: string[],
) => unique([
  departmentLabelByDepartment[pack.department as StoryboardDepartmentRefDepartment],
  pack.qaChecklist?.[0],
]).join(" / ");

const scopedPayloadRows = (
  pack: DepartmentPrepPackage,
  sceneId: string,
  shotIds: string[],
) => payloadRows(pack).filter((row) => rowMatchesScope(row, sceneId, shotIds));

export const emptyStoryboardDepartmentPrepRefSet = (): StoryboardDepartmentPrepRefSet => ({
  cinematographyRefs: [],
  lightingRefs: [],
  performanceRefs: [],
  actionRefs: [],
});

export const buildStoryboardDepartmentPrepRefs = (
  departmentPrepPackages: DepartmentPrepPackage[] | undefined,
  sceneId: string,
  shotIds: string[] = [],
): StoryboardDepartmentPrepRefSet => {
  const refs = emptyStoryboardDepartmentPrepRefSet();
  const normalizedShotIds = unique(shotIds);
  for (const pack of departmentPrepPackages || []) {
    if (!isStoryboardDepartment(pack.department)) continue;
    const department = pack.department;
    if (!packMatchesScope(pack, sceneId, normalizedShotIds)) continue;
    const rows = scopedPayloadRows(pack, sceneId, normalizedShotIds);
    if (payloadRows(pack).length > 0 && rows.length === 0) continue;
    const schemaVersion = clean(asRecord(pack.specialistPayload).schemaVersion);
    const rowSummary = rows
      .map((row) => summaryForRow(department, row))
      .filter(Boolean)
      .join("；");
    const ref: StoryboardDepartmentPrepRef = {
      id: `${department}:${pack.id}`,
      department,
      packageId: pack.id,
      ownerAgentId: pack.ownerAgentId,
      schemaVersion: schemaVersion || undefined,
      sceneRefs: packageSceneRefs(pack).filter((refSceneId) => !sceneId || refSceneId === sceneId),
      shotRefs: unique([
        ...normalizedShotIds.filter((shotId) => packageShotRefs(pack).includes(shotId)),
        ...rows.flatMap(rowShotRefs),
      ]),
      payloadPath: `departmentPrepPackages.${pack.id}.specialistPayload`,
      summary: rowSummary || fallbackSummary(pack, sceneId, normalizedShotIds),
    };
    refs[departmentFieldByDepartment[department]].push(ref);
  }
  return refs;
};

export const flattenStoryboardDepartmentPrepRefs = (
  refs: Partial<StoryboardDepartmentPrepRefSet>,
) => [
  ...(refs.cinematographyRefs || []),
  ...(refs.lightingRefs || []),
  ...(refs.performanceRefs || []),
  ...(refs.actionRefs || []),
];

export const storyboardDepartmentPrepRefIdsForShot = (
  refs: Partial<StoryboardDepartmentPrepRefSet>,
  shotId?: string,
) => flattenStoryboardDepartmentPrepRefs(refs)
  .filter((ref) => !shotId || ref.shotRefs.length === 0 || ref.shotRefs.includes(shotId))
  .map((ref) => ref.id);

export const renderStoryboardDepartmentPrepRefNotes = (
  refs: Partial<StoryboardDepartmentPrepRefSet>,
) => flattenStoryboardDepartmentPrepRefs(refs)
  .map((ref) => `${departmentLabelByDepartment[ref.department]}：${ref.summary}`)
  .join("\n");

export const missingStoryboardDepartmentPrepRefs = (
  refs: Partial<StoryboardDepartmentPrepRefSet>,
  requiredDepartments: StoryboardDepartmentRefDepartment[] = [...STORYBOARD_DEPARTMENT_REF_DEPARTMENTS],
) => requiredDepartments.filter((department) => refs[departmentFieldByDepartment[department]]?.length === 0);

export const storyboardDepartmentLabel = (
  department: StoryboardDepartmentRefDepartment,
) => departmentLabelByDepartment[department];
