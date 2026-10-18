import type {
  Asset,
  AssetVariant,
  Character,
  Episode,
  Project,
  Scene,
} from "../../../../../src/types/project";
import {
  SceneVisualPack,
  SceneVisualPackCharacter,
  SceneVisualPackProp,
  SceneVisualPackReferenceSlot,
  VideoStoryboardArtifactIssue,
  validateSceneVisualPack,
} from "./videoStoryboardArtifacts";
import {
  buildVideoStoryboardAssetBoardPlan,
  VideoStoryboardAssetBoardItem,
  VideoStoryboardAssetBoardPlan,
} from "./videoStoryboardAssetBoards";
import type { DepartmentPrepPackage, ProductionBreakdownReport } from "./productionPrep";

export interface ProductionSceneVisualPackDrafts {
  sceneVisualPacks: SceneVisualPack[];
  issues: VideoStoryboardArtifactIssue[];
  packSceneIds: string[];
  reusedPackIds: string[];
}

export interface BuildProductionSceneVisualPackDraftsOptions {
  productionBreakdownReport?: Partial<ProductionBreakdownReport>;
  departmentPrepPackages?: Partial<DepartmentPrepPackage>[];
  requireProductionPrep?: boolean;
}

const clean = (value: unknown) =>
  String(value || "").trim().replace(/\s+/g, " ");

const compact = (values: unknown[]) =>
  values.map(clean).filter(Boolean).join("；");

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

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

export const createSceneVisualFingerprint = (value: unknown) =>
  `svp.${stableHash(stableStringify(value))}`;

const variantById = (variants: AssetVariant[] | undefined, variantId?: string) =>
  variantId ? (variants || []).find((variant) => variant.id === variantId) : undefined;

const variantText = (variant?: AssetVariant) =>
  compact([variant?.name, variant?.description, variant?.promptModifiers]);

const assetReferenceUrl = (asset?: Asset) =>
  clean(asset?.cleanReferenceImageUrl || asset?.boardImageUrl || (asset?.type === "location" ? asset?.panoramaUrl : asset?.multiViewUrl));

const characterReferenceUrl = (character?: Character) =>
  clean(character?.cleanReferenceImageUrl || character?.boardImageUrl || character?.multiViewUrl);

const boardItems = (plan: VideoStoryboardAssetBoardPlan): VideoStoryboardAssetBoardItem[] => [
  ...(plan.characterBoards || []),
  ...(plan.sceneBoards || []),
  ...(plan.propBoards || []),
  ...(plan.vehicleBoards || []),
  ...(plan.variantBoards || []),
];

const findBoardItem = (
  plan: VideoStoryboardAssetBoardPlan,
  assetId: string,
  variantId?: string,
) => {
  const items = boardItems(plan);
  return (variantId ? items.find((item) => item.assetId === assetId && item.variantId === variantId) : undefined)
    || items.find((item) => item.assetId === assetId && !item.variantId);
};

const collectCharacterIds = (scene: Scene, project: Project) => {
  const characterIds = new Set((project.characters || []).map((character) => character.id));
  return unique([
    ...(scene.breakdown?.characterIds || []),
    ...(scene.shots || []).flatMap((shot) => shot.characterIdsInShot || []),
    ...(scene.scriptBlocks || []).map((block) => block.linkedAssetId).filter((id) => id && characterIds.has(id)),
  ]).filter((id) => characterIds.has(id));
};

const collectLocationId = (scene: Scene, project: Project) => {
  const locationIds = new Set((project.assets || []).filter((asset) => asset.type === "location").map((asset) => asset.id));
  const candidates = [
    scene.breakdown?.locationId,
    ...(scene.shots || []).map((shot) => shot.locationId),
    ...(scene.scriptBlocks || []).map((block) => block.locationId),
  ].map(clean).filter(Boolean);
  return candidates.find((id) => locationIds.has(id)) || candidates[0] || "";
};

const collectPropIds = (scene: Scene, project: Project) => {
  const propIds = new Set((project.assets || []).filter((asset) => asset.type === "prop").map((asset) => asset.id));
  return unique([
    ...(scene.breakdown?.propIds || []),
    ...(scene.shots || []).flatMap((shot) => shot.propIds || []),
    ...(scene.scriptBlocks || []).flatMap((block) => [
      ...(block.propIds || []),
      block.linkedAssetId && propIds.has(block.linkedAssetId) ? block.linkedAssetId : undefined,
    ]),
  ]).filter((id) => propIds.has(id));
};

const collectVehicleIds = (scene: Scene, project: Project) => {
  const vehicleIds = new Set((project.assets || []).filter((asset) => asset.type === "vehicles").map((asset) => asset.id));
  return unique([
    ...(scene.breakdown?.vehicleIds || []),
    ...(scene.shots || []).flatMap((shot) => shot.vehicleIds || []),
    ...(scene.scriptBlocks || []).map((block) => block.linkedAssetId).filter((id) => id && vehicleIds.has(id)),
  ]).filter((id) => vehicleIds.has(id));
};

const namedStateFor = (
  values: unknown[] | undefined,
  displayName?: string,
) => {
  if (!displayName) return "";
  for (const value of values || []) {
    if (typeof value === "string") continue;
    const record = value as { name?: string; state?: string };
    if (clean(record.name) === clean(displayName)) return clean(record.state);
  }
  return "";
};

const sceneLightingState = (scene: Scene) =>
  compact([
    (scene.shots || []).find((shot) => shot.lighting)?.lighting,
    (scene.shots || []).find((shot) => shot.lightingAtmo)?.lightingAtmo,
    scene.timeOfDay,
    scene.breakdown?.time,
  ]);

const sceneContinuityIn = (scene: Scene) =>
  clean(scene.interactiveMetadata?.incomingContext)
  || clean(scene.valueShift?.from)
  || clean((scene.shots || [])[0]?.continuityNote)
  || clean(scene.description)
  || "承接上一场的角色、场景、道具状态。";

const sceneContinuityOut = (scene: Scene) =>
  clean(scene.interactiveMetadata?.outgoingContext)
  || clean(scene.valueShift?.to)
  || clean((scene.shots || []).slice(-1)[0]?.continuityNote)
  || clean(scene.cliffhanger)
  || "输出本场结束时的角色、场景、道具状态。";

const referenceSlot = ({
  slotId,
  assetId,
  variantId,
  boardItem,
  fallbackReferenceImageUrl,
  purpose,
  priority,
}: {
  slotId: string;
  assetId: string;
  variantId?: string;
  boardItem?: VideoStoryboardAssetBoardItem;
  fallbackReferenceImageUrl?: string;
  purpose: SceneVisualPackReferenceSlot["purpose"];
  priority: number;
}): SceneVisualPackReferenceSlot => ({
  slotId,
  assetId,
  variantId,
  boardItemId: boardItem?.id,
  referenceImageUrl: clean(boardItem?.referenceImageUrl || fallbackReferenceImageUrl) || undefined,
  purpose,
  priority,
});

const buildPackForScene = (
  project: Project,
  episode: Episode,
  scene: Scene,
  assetBoardPlan: VideoStoryboardAssetBoardPlan,
  options: BuildProductionSceneVisualPackDraftsOptions = {},
): SceneVisualPack => {
  const characterById = new Map((project.characters || []).map((character) => [character.id, character]));
  const assetById = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const variantMap = scene.breakdown?.assetVariantMap || {};
  const locationId = collectLocationId(scene, project);
  const location = assetById.get(locationId);
  const locationVariant = variantById(location?.variants, variantMap[locationId]);
  const setDressingState = compact([
    namedStateFor(scene.breakdown?.location ? [scene.breakdown.location] : [], location?.name),
    scene.sceneAssets,
    locationVariant ? variantText(locationVariant) : "",
    location?.description,
  ]) || "使用基础场景板布置。";
  const locationState = {
    assetId: locationId,
    variantId: locationVariant?.id,
    setDressingState,
    timeOfDay: clean(scene.timeOfDay || scene.breakdown?.time) || undefined,
    lightingState: sceneLightingState(scene) || undefined,
    damageState: locationVariant ? variantText(locationVariant) : undefined,
  };

  const sceneCharacterIds = collectCharacterIds(scene, project).sort();
  const characters: SceneVisualPackCharacter[] = sceneCharacterIds
    .map((characterId) => {
      const character = characterById.get(characterId);
      const variant = variantById(character?.variants, variantMap[characterId]);
      const continuityState = namedStateFor(scene.breakdown?.characters, character?.name);
      const sharedWardrobe = sceneCharacterIds.length === 1 ? scene.breakdown?.wardrobe || [] : [];
      const sharedMakeupHair = sceneCharacterIds.length === 1 ? scene.breakdown?.makeupHair || [] : [];
      return {
        characterId,
        variantId: variant?.id,
        continuityState: continuityState || undefined,
        costumeState: compact([...sharedWardrobe, variantText(variant)]) || (variant ? undefined : "使用基础角色板服装。"),
        makeupState: compact(sharedMakeupHair) || undefined,
        hairState: compact(sharedMakeupHair) || undefined,
        emotionalBaseline: compact([scene.valueShift?.from, scene.valueShift?.to, scene.valueCharge]) || undefined,
      };
    });

  const visibleCharacterIds = characters.map((character) => character.characterId);
  const props: SceneVisualPackProp[] = collectPropIds(scene, project)
    .sort()
    .map((assetId) => {
      const asset = assetById.get(assetId);
      const variant = variantById(asset?.variants, variantMap[assetId]);
      const propState = namedStateFor(scene.breakdown?.props, asset?.name);
      return {
        assetId,
        variantId: variant?.id,
        ownerCharacterId: visibleCharacterIds.length === 1 ? visibleCharacterIds[0] : undefined,
        usageState: compact([propState, variantText(variant), asset?.description]) || "使用基础道具板状态。",
        continuityState: variant ? variantText(variant) : propState || undefined,
      };
    });

  const vehicleIds = collectVehicleIds(scene, project).sort();
  const vehicles = vehicleIds.map((assetId) => {
    const asset = assetById.get(assetId);
    const variant = variantById(asset?.variants, variantMap[assetId]);
    const board = findBoardItem(assetBoardPlan, assetId, variant?.id);
    return {
      assetId,
      variantId: variant?.id,
      continuityState: compact([asset?.description, variantText(variant)]) || "使用基础交通工具结构。",
      referenceImageUrl: clean(board?.referenceImageUrl || assetReferenceUrl(asset)) || undefined,
    };
  });

  const referenceSlots: SceneVisualPackReferenceSlot[] = [
    ...characters.map((character, index) => {
      const base = characterById.get(character.characterId);
      return referenceSlot({
        slotId: `character-${character.characterId}`,
        assetId: character.characterId,
        variantId: character.variantId,
        boardItem: findBoardItem(assetBoardPlan, character.characterId, character.variantId),
        fallbackReferenceImageUrl: characterReferenceUrl(base),
        purpose: character.variantId ? "costume" : "identity",
        priority: 10 + index,
      });
    }),
    ...(locationId ? [referenceSlot({
      slotId: `location-${locationId}`,
      assetId: locationId,
      variantId: locationVariant?.id,
      boardItem: findBoardItem(assetBoardPlan, locationId, locationVariant?.id),
      fallbackReferenceImageUrl: assetReferenceUrl(location),
      purpose: "set",
      priority: 30,
    })] : []),
    ...props.map((prop, index) => referenceSlot({
      slotId: `prop-${prop.assetId}`,
      assetId: prop.assetId,
      variantId: prop.variantId,
      boardItem: findBoardItem(assetBoardPlan, prop.assetId, prop.variantId),
      fallbackReferenceImageUrl: assetReferenceUrl(assetById.get(prop.assetId)),
      purpose: prop.variantId ? "state" : "prop",
      priority: 50 + index,
    })),
    ...vehicles.map((vehicle, index) => referenceSlot({
      slotId: `vehicle-${vehicle.assetId}`,
      assetId: vehicle.assetId,
      variantId: vehicle.variantId,
      boardItem: findBoardItem(assetBoardPlan, vehicle.assetId, vehicle.variantId),
      fallbackReferenceImageUrl: vehicle.referenceImageUrl,
      purpose: "vehicle",
      priority: 40 + index,
    })),
  ];

  const fingerprintPayload = {
    projectId: project.id,
    location: locationState,
    characters: characters.map((character) => ({
      characterId: character.characterId,
      variantId: character.variantId,
      continuityState: character.continuityState,
      costumeState: character.costumeState,
      makeupState: character.makeupState,
      hairState: character.hairState,
      injuryState: character.injuryState,
    })),
    props: props.map((prop) => ({
      assetId: prop.assetId,
      variantId: prop.variantId,
      ownerCharacterId: prop.ownerCharacterId,
      usageState: prop.usageState,
      continuityState: prop.continuityState,
    })),
    vehicles,
  };
  const visualFingerprint = createSceneVisualFingerprint(fingerprintPayload);

  return {
    id: `${project.id}.scene_visual_pack.${visualFingerprint.replace(/^svp\./, "")}`,
    projectId: project.id,
    episodeId: episode.id,
    sourceSceneIds: [scene.id],
    linkedSceneIds: [scene.id],
    baseAssetBoardPlanId: assetBoardPlan.id,
    visualFingerprint,
    location: locationState,
    characters,
    props,
    vehicles,
    referenceSlots,
    continuityIn: sceneContinuityIn(scene),
    continuityOut: sceneContinuityOut(scene),
    qaChecklist: [
      ...(options.productionBreakdownReport?.id ? [`来源 production_breakdown_report：${options.productionBreakdownReport.id}`] : []),
      ...(options.departmentPrepPackages?.length ? [`已读取 department_prep_package 数量：${options.departmentPrepPackages.length}`] : []),
      "只包含当前场可见或会影响连续性的资产。",
      "相同 visualFingerprint 的场景复用同一个视觉包。",
      "换装、伤势、破损、场景损毁和关键光线变化必须通过 variant 表达。",
      "后续 asset_reference_pack 只能从本视觉包投影模型输入。",
    ],
  };
};

const mergePackReuse = (packs: SceneVisualPack[]) => {
  const byFingerprint = new Map<string, SceneVisualPack>();
  for (const pack of packs) {
    const existing = byFingerprint.get(pack.visualFingerprint);
    if (!existing) {
      byFingerprint.set(pack.visualFingerprint, pack);
      continue;
    }
    byFingerprint.set(pack.visualFingerprint, {
      ...existing,
      linkedSceneIds: unique([...existing.linkedSceneIds, ...pack.linkedSceneIds]),
      sourceSceneIds: unique([...existing.sourceSceneIds, ...pack.sourceSceneIds]),
    });
  }
  return Array.from(byFingerprint.values());
};

export const buildProductionSceneVisualPackDrafts = (
  project: Project,
  episodes: Episode[],
  assetBoardPlan: VideoStoryboardAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(project),
  options: BuildProductionSceneVisualPackDraftsOptions = {},
): ProductionSceneVisualPackDrafts => {
  const lockedSceneIds = new Set((options.productionBreakdownReport?.sceneMatrix || [])
    .map((row: any) => clean(row?.sceneId))
    .filter(Boolean));
  const shouldIncludeScene = (scene: Scene) => lockedSceneIds.size === 0 || lockedSceneIds.has(scene.id);
  const candidatePacks = episodes.flatMap((episode) =>
    (episode.scenes || [])
      .filter(shouldIncludeScene)
      .map((scene) => buildPackForScene(project, episode, scene, assetBoardPlan, options)),
  );
  const sceneVisualPacks = mergePackReuse(candidatePacks);
  const issues = [
    ...(options.requireProductionPrep && !options.productionBreakdownReport?.id ? [{
      severity: "blocking" as const,
      code: "SCENE_VISUAL_PACK_PRODUCTION_BREAKDOWN_MISSING",
      target: "sceneVisualPackDrafts.productionBreakdownReport",
      message: "正式 scene_visual_pack 必须由 production_breakdown_report 限定锁定场次，不能从全项目资产池猜测。",
    }] : []),
    ...(options.requireProductionPrep && !options.departmentPrepPackages?.length ? [{
      severity: "warning" as const,
      code: "SCENE_VISUAL_PACK_DEPARTMENT_PREP_MISSING",
      target: "sceneVisualPackDrafts.departmentPrepPackages",
      message: "正式 scene_visual_pack 建议读取 department_prep_package，以便服化道/场景/连续性状态来自部门筹备事实。",
    }] : []),
    ...sceneVisualPacks.flatMap((pack) => validateSceneVisualPack(pack, sceneVisualPacks, project)),
  ];

  return {
    sceneVisualPacks,
    issues,
    packSceneIds: unique(sceneVisualPacks.flatMap((pack) => pack.linkedSceneIds)),
    reusedPackIds: sceneVisualPacks.filter((pack) => pack.linkedSceneIds.length > 1).map((pack) => pack.id),
  };
};

export const buildSceneVisualPackSystem = () => ({
  status: "scene_visual_pack_contract_available_operator_artifact_only",
  stage: "asset_sync",
  artifactKind: "scene_visual_pack",
  plannerFunction: "buildProductionSceneVisualPackDrafts",
  qaFunction: "validateSceneVisualPack",
  fingerprintFunction: "createSceneVisualFingerprint",
  sourceOfTruth: [
    "asset_board_plan",
    "production_breakdown_report when available",
    "department_prep_package when available",
    "project.characters/assets variants",
    "scene.breakdown characterIds/locationId/propIds/vehicleIds/assetVariantMap",
    "scene scriptBlocks and shots",
    "asset-continuity context",
  ],
  boundary: [
    "SceneVisualPack is a reusable scene-level visual context, not a new canonical workflow stage.",
    "It does not replace AssetBoardPlan; base character/location/prop/vehicle boards remain project-level.",
    "It does not replace AssetReferencePack; model-specific packs should be projected from scene visual packs.",
    "Formal scene visual packs should be scoped by production_breakdown_report instead of scanning the whole project.",
  ],
  reusePolicy: [
    "visualFingerprint is model-independent and includes only visual facts that affect continuity.",
    "Scenes with the same visualFingerprint reuse one pack via linkedSceneIds.",
    "Costume, makeup, injury, prop state, location damage, time, or lighting changes require a variant-backed new fingerprint.",
    "Model profile limits, reference image budget, and start/end frame strategy belong to modelInputFingerprint in AssetReferencePack, not SceneVisualPack.",
  ],
  requiredBefore: ["storyboard", "prompt", "expensive_generation_planning"],
});
