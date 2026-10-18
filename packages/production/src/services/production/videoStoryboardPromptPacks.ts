import type {
  Asset,
  AssetVariant,
  Character,
  Episode,
  Project,
  Scene,
  Shot,
} from "../../../../../src/types/project";
import {
  AssetReferencePack,
  AssetReferencePackItem,
  SceneVisualPack,
  SceneVisualPackReferenceSlot,
  StoryboardDepartmentRefDepartment,
  VideoStoryboardArtifactIssue,
  validateAssetReferencePack,
} from "./videoStoryboardArtifacts";
import { VIDEO_MODEL_PROFILES } from "./videoStoryboardSystem";
import { buildProductionSceneVisualPackDrafts } from "./videoStoryboardSceneVisualPacks";
import type { DepartmentPrepPackage } from "./productionPrep";
import {
  StoryboardDepartmentPrepRefSet,
  buildStoryboardDepartmentPrepRefs,
  missingStoryboardDepartmentPrepRefs,
  renderStoryboardDepartmentPrepRefNotes,
  sceneNeedsPerformancePrep,
  storyboardDepartmentLabel,
} from "./videoStoryboardDepartmentRefs";
import { resolveVisualStyleLock } from "./visualStyleLock";

export interface ProductionAssetReferencePackDrafts {
  assetReferencePacks: AssetReferencePack[];
  issues: VideoStoryboardArtifactIssue[];
  packSceneIds: string[];
}

export interface ProductionAssetReferencePackDraftOptions {
  departmentPrepPackages?: DepartmentPrepPackage[];
  requireDepartmentPrepRefs?: boolean;
}

const clean = (value: unknown) => String(value || "").trim();

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const selectVideoModelProfile = (project: Project) =>
  VIDEO_MODEL_PROFILES.find((profile) =>
    profile.supportsStoryboardReference &&
    (!project.aspectRatio || profile.aspectRatios.includes(project.aspectRatio)),
  ) || VIDEO_MODEL_PROFILES.find((profile) => profile.supportsReferenceImages) || VIDEO_MODEL_PROFILES[0];

const characterReferenceUrl = (character: Character) =>
  clean(character.cleanReferenceImageUrl || character.boardImageUrl || character.multiViewUrl);

const assetReferenceUrl = (asset: Asset) =>
  clean(asset.cleanReferenceImageUrl || asset.boardImageUrl || (asset.type === "location" ? asset.panoramaUrl : asset.multiViewUrl));

const variantReferenceUrl = (variant?: AssetVariant) =>
  clean(variant?.cleanReferenceImageUrl || variant?.boardImageUrl || variant?.imageUrl);

const collectSceneShotIds = (scene: Scene) =>
  (scene.shots || []).map((shot) => shot.id).filter(Boolean);

const collectCharacterIds = (scene: Scene) =>
  unique([
    ...(scene.breakdown?.characterIds || []),
    ...(scene.shots || []).flatMap((shot) => shot.characterIdsInShot || []),
  ]);

const collectLocationIds = (scene: Scene) =>
  unique([
    scene.breakdown?.locationId,
    ...(scene.shots || []).map((shot) => shot.locationId),
  ]);

const collectPropIds = (scene: Scene) =>
  unique([
    ...(scene.breakdown?.propIds || []),
    ...(scene.shots || []).flatMap((shot) => shot.propIds || []),
  ]);

const collectVehicleIds = (scene: Scene) => unique([
  ...(scene.breakdown?.vehicleIds || []),
  ...(scene.shots || []).flatMap((shot) => shot.vehicleIds || []),
]);

const collectVariantMap = (scene: Scene) =>
  scene.breakdown?.assetVariantMap || {};

const referenceCollector = () => {
  return (referenceImageUrl?: string) => {
    const normalized = clean(referenceImageUrl);
    if (!normalized) return undefined;
    return normalized;
  };
};

const characterItem = (
  character: Character,
  variant: AssetVariant | undefined,
  allowReference: (referenceImageUrl?: string) => string | undefined,
  referenceImageUrlOverride?: string,
): AssetReferencePackItem => {
  const variantUrl = variantReferenceUrl(variant);
  const baseUrl = characterReferenceUrl(character);
  return {
    assetId: character.id,
    assetType: "character",
    variantId: variant?.id,
    referenceImageUrl: allowReference(referenceImageUrlOverride || variantUrl || baseUrl),
    referenceAssetId: character.globalAssetId,
    roleInUnit: [
      `角色参考：${character.name}`,
      variant ? `变体：${variant.name}` : "使用默认角色板",
      "优先锁定外貌、服装、表情范围和身份连续性。",
    ].join("；"),
    required: true,
  };
};

const assetItem = (
  asset: Asset,
  variant: AssetVariant | undefined,
  allowReference: (referenceImageUrl?: string) => string | undefined,
  referenceImageUrlOverride?: string,
): AssetReferencePackItem => {
  const variantUrl = variantReferenceUrl(variant);
  const baseUrl = assetReferenceUrl(asset);
  return {
    assetId: asset.id,
    assetType: asset.type === "location" ? "location" : asset.type === "vehicles" ? "vehicles" : "prop",
    variantId: variant?.id,
    referenceImageUrl: allowReference(referenceImageUrlOverride || variantUrl || baseUrl),
    referenceAssetId: asset.globalAssetId,
    roleInUnit: [
      asset.type === "location" ? `场景参考：${asset.name}` : asset.type === "vehicles" ? `交通工具参考：${asset.name}` : `道具参考：${asset.name}`,
      variant ? `变体：${variant.name}` : "使用默认资产板",
      asset.type === "vehicles" && variant ? `可见状态：${[variant.description, variant.promptModifiers].filter(Boolean).join("；")}` : "",
      asset.type === "location" ? "优先锁定空间布局、光线方向和可拍机位。" : asset.type === "vehicles" ? "优先锁定资产描述中的结构、比例、左右方位、出入口与状态。" : "优先锁定材质、尺寸、持握方式和状态变化。",
    ].filter(Boolean).join("；"),
    required: true,
  };
};

const styleFallbackItem = (project: Project): AssetReferencePackItem => ({
  assetId: `${project.id}.creative_vision`,
  assetType: "style",
  roleInUnit: "项目风格参考：仅承载整体影像风格，不替代角色板、场景板或道具板。",
  required: false,
});

const findVariant = (variants: AssetVariant[] | undefined, variantId: string | undefined) =>
  variantId ? (variants || []).find((variant) => variant.id === variantId) : undefined;

const sceneHasPromptedShots = (scene: Scene) =>
  (scene.shots || []).some((shot: Shot) => shot.imagePrompt || shot.videoPrompt);

const sceneNeedsActionPrep = (scene: Scene) =>
  // A character rushing into a room is blocking, not automatically a choreography
  // requirement. Keep this focused on sustained, dangerous, or combat movement.
  /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|stunt|chase|run|rush|fall|jump|throw|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|爆发|法术|仙术|追逐|奔跑|冲入|冲出|冲向|冲刺|跑向|跑出|跑过|跌倒|跌落|跳下|跃起|摔倒|危险|特技/iu.test([
    scene.title,
    scene.description,
    ...(scene.shots || []).flatMap((shot) => [shot.visualAction, shot.blocking, shot.cameraMovement, shot.motivation]),
  ].filter(Boolean).join(" "));

const packForScene = (sceneVisualPacks: SceneVisualPack[], sceneId: string) =>
  sceneVisualPacks.find((pack) => pack.linkedSceneIds?.includes(sceneId) || pack.sourceSceneIds?.includes(sceneId));

const modelInputFingerprint = (sceneVisualPack: SceneVisualPack | undefined, modelProfileId: string) =>
  sceneVisualPack
    ? `mif.${sceneVisualPack.visualFingerprint.replace(/^svp\./, "")}.${modelProfileId.replace(/[^a-z0-9]+/gi, "_")}`
    : undefined;

const styleLockVersionForProject = (project: Project) =>
  project.visualStyleLock?.version ||
  (project.visualStyleLock?.lockedAt ? `visual-style-lock.${project.visualStyleLock.lockedAt}` : undefined);

const sortReferenceSlots = (slots: SceneVisualPackReferenceSlot[] | undefined) =>
  [...(slots || [])].sort((a, b) => (a.priority || 0) - (b.priority || 0));

const buildItemsFromSceneVisualPack = (
  project: Project,
  sceneVisualPack: SceneVisualPack,
  allowReference: (referenceImageUrl?: string) => string | undefined,
) => {
  const characterById = new Map((project.characters || []).map((character) => [character.id, character]));
  const assetById = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const items: AssetReferencePackItem[] = [];
  for (const slot of sortReferenceSlots(sceneVisualPack.referenceSlots)) {
    const character = characterById.get(slot.assetId);
    if (character) {
      items.push(characterItem(character, findVariant(character.variants, slot.variantId), allowReference, slot.referenceImageUrl));
      continue;
    }
    const asset = assetById.get(slot.assetId);
    if (asset && (asset.type === "location" || asset.type === "prop" || asset.type === "vehicles")) {
      items.push(assetItem(asset, findVariant(asset.variants, slot.variantId), allowReference, slot.referenceImageUrl));
    }
  }
  return items;
};

const buildPackForScene = (
  project: Project,
  episode: Episode,
  scene: Scene,
  sceneVisualPack?: SceneVisualPack,
  options: ProductionAssetReferencePackDraftOptions = {},
): AssetReferencePack | undefined => {
  if (!scene.shots?.length) return undefined;
  const modelProfile = selectVideoModelProfile(project);
  const styleLock = resolveVisualStyleLock(project);
  const styleLockVersion = styleLockVersionForProject(project) || styleLock.version;
  const shotIds = collectSceneShotIds(scene);
  const departmentRefs = buildStoryboardDepartmentPrepRefs(options.departmentPrepPackages, scene.id, shotIds);
  const includeDepartmentRefs = Boolean(options.departmentPrepPackages?.length) || options.requireDepartmentPrepRefs;
  const allowReference = referenceCollector();
  const variantMap = collectVariantMap(scene);
  const characterById = new Map((project.characters || []).map((character) => [character.id, character]));
  const assetById = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const items: AssetReferencePackItem[] = sceneVisualPack
    ? buildItemsFromSceneVisualPack(project, sceneVisualPack, allowReference)
    : [];

  if (items.length === 0) {
    for (const characterId of collectCharacterIds(scene)) {
      const character = characterById.get(characterId);
      if (!character) continue;
      items.push(characterItem(character, findVariant(character.variants, variantMap[character.id]), allowReference));
    }
    for (const locationId of collectLocationIds(scene)) {
      const asset = assetById.get(locationId);
      if (!asset || asset.type !== "location") continue;
      items.push(assetItem(asset, findVariant(asset.variants, variantMap[asset.id]), allowReference));
    }
    for (const propId of collectPropIds(scene)) {
      const asset = assetById.get(propId);
      if (!asset || asset.type !== "prop") continue;
      items.push(assetItem(asset, findVariant(asset.variants, variantMap[asset.id]), allowReference));
    }
    for (const vehicleId of collectVehicleIds(scene)) {
      const asset = assetById.get(vehicleId);
      if (!asset || asset.type !== "vehicles") continue;
      items.push(assetItem(asset, findVariant(asset.variants, variantMap[asset.id]), allowReference));
    }
  }
  if (items.length === 0) items.push(styleFallbackItem(project));

  return {
    id: `${episode.id}.${scene.id}.asset_reference_pack`,
    episodeId: episode.id,
    sceneId: scene.id,
    sceneVisualPackId: sceneVisualPack?.id,
    modelInputFingerprint: modelInputFingerprint(sceneVisualPack, modelProfile.id),
    modelProfileId: modelProfile.id,
    purpose: sceneVisualPack
      ? `从 SceneVisualPack ${sceneVisualPack.id} 投影模型输入参考包，供当前场故事板和视频生成单元使用。`
      : sceneHasPromptedShots(scene)
      ? "为已完成镜头级 imagePrompt/videoPrompt 的场景提供结构化资产参考包，供后续视频输入包和 video unit 使用。"
      : "为待补提示词场景预备结构化资产参考包，避免把资产细节全部塞进单条视频 prompt。",
    items,
    maxReferenceImages: modelProfile.maxReferenceImages || 0,
    maxReferenceVideos: modelProfile.maxReferenceVideos || 0,
    packagingNotes: [
      "资产参考包只携带角色板、场景板、道具板、交通工具板、变体板和可用参考图引用。",
      sceneVisualPack ? `本包来自 scene_visual_pack=${sceneVisualPack.id}，不能从全项目资产池额外抓取无关参考。` : "当前未找到 scene_visual_pack，使用旧版场景资产引用 fallback。",
      `项目风格锁来源：${styleLock.sourceFields.join(", ") || "project defaults"}；版本：${styleLockVersion || "unversioned"}。`,
      styleLock.assetBoardInstruction,
      "镜头运动、表演、节奏和连续性仍以 scene.shots 的 imagePrompt/videoPrompt/storyboard_board 为准。",
      includeDepartmentRefs && renderStoryboardDepartmentPrepRefNotes(departmentRefs)
        ? `专业部门引用：\n${renderStoryboardDepartmentPrepRefNotes(departmentRefs)}`
        : "",
      shotIds.length > 0 ? `本包覆盖镜头：${shotIds.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    styleLockVersion,
    visualStyleLockRefs: styleLock.styleSourceRefs,
    storyboardStrategyIds: [],
    storyboardStrategyOrigin: "built_in",
    annotationLegendVersion: styleLockVersion,
    ...(includeDepartmentRefs ? {
      cameraRefs: departmentRefs.cinematographyRefs,
      lightingRefs: departmentRefs.lightingRefs,
      performanceRefs: departmentRefs.performanceRefs,
      actionRefs: departmentRefs.actionRefs,
    } : {}),
  };
};

const departmentRefsForPack = (
  pack: AssetReferencePack,
): StoryboardDepartmentPrepRefSet => ({
  cinematographyRefs: pack.cameraRefs || [],
  lightingRefs: pack.lightingRefs || [],
  performanceRefs: pack.performanceRefs || [],
  actionRefs: pack.actionRefs || [],
});

const requiredDepartmentsForPack = (
  scene: Scene | undefined,
): StoryboardDepartmentRefDepartment[] => [
  "cinematography",
  "lighting",
  ...(sceneNeedsPerformancePrep(scene) ? ["performance_directing" as const] : []),
  ...(scene && sceneNeedsActionPrep(scene) ? ["action_choreography" as const] : []),
];

const departmentPrepIssuesForPack = (
  pack: AssetReferencePack,
  scene: Scene | undefined,
  requireDepartmentPrepRefs: boolean,
): VideoStoryboardArtifactIssue[] =>
  missingStoryboardDepartmentPrepRefs(departmentRefsForPack(pack), requiredDepartmentsForPack(scene)).map((department) => ({
    severity: requireDepartmentPrepRefs ? "blocking" : "warning",
    code: "ASSET_REFERENCE_PACK_DEPARTMENT_REFS_MISSING",
    target: `assetReferencePack.${pack.id}.${department}`,
    message: `${scene?.title || pack.sceneId || pack.id} 的资产参考包缺少${storyboardDepartmentLabel(department)}部门 prep 引用，后续视频输入可能丢失正式制片约束。`,
  }));

export const buildProductionAssetReferencePackDrafts = (
  project: Project,
  episodes: Episode[],
  sceneVisualPacks: SceneVisualPack[] = buildProductionSceneVisualPackDrafts(project, episodes).sceneVisualPacks,
  options: ProductionAssetReferencePackDraftOptions = {},
): ProductionAssetReferencePackDrafts => {
  const sceneById = new Map(episodes.flatMap((episode) => (episode.scenes || []).map((scene) => [scene.id, scene] as const)));
  const assetReferencePacks = episodes.flatMap((episode) =>
    (episode.scenes || [])
      .map((scene) => buildPackForScene(project, episode, scene, packForScene(sceneVisualPacks, scene.id), options))
      .filter((pack): pack is AssetReferencePack => Boolean(pack)),
  );
  const includeDepartmentRefIssues = Boolean(options.departmentPrepPackages?.length) || options.requireDepartmentPrepRefs;
  const issues = assetReferencePacks.flatMap((pack) => [
    ...validateAssetReferencePack(pack),
    ...(includeDepartmentRefIssues ? departmentPrepIssuesForPack(pack, pack.sceneId ? sceneById.get(pack.sceneId) : undefined, Boolean(options.requireDepartmentPrepRefs)) : []),
  ]);

  return {
    assetReferencePacks,
    issues,
    packSceneIds: unique(assetReferencePacks.map((pack) => pack.sceneId)),
  };
};
