import type { Asset, AssetVariant, Character, Project } from "../../../../../src/types/project";
import type { ContentLockPackage, ProductionBlockLock, ScriptLockPackage } from "./productionLock";
import type { CastingRequirement, DepartmentPrepPackage, ProductionBreakdownReport } from "./productionPrep";
import type { CastingDecision } from "./productionCasting";
import { collectProjectAssetsForContext } from "../../../../../src/utils/projectAssetContext";
import { IMAGE_MODEL_PROFILES } from "./videoStoryboardSystem";
import {
  buildProductionAssetVisualStyleProjection,
  type ProductionAssetVisualStyleTarget,
} from "./productionAssetVisualStyle";

export type AssetBoardKind =
  | "character_board"
  | "scene_board"
  | "prop_board"
  | "vehicle_board"
  | "variant_board";

export type AssetBoardReadiness =
  | "reference_ready"
  | "prompt_ready"
  | "needs_prompt";

export type AssetBoardProductionReadiness =
  | "development_only"
  | "formal_blocked"
  | "formal_ready";

export interface AssetBoardLayoutContract {
  schemaVersion: "asset-board-layout-contract.v1";
  contractId: string;
  canvasAspectRatio: "16:9";
  outputForm: "single_composite_production_sheet";
  requiredViews: string[];
  requiredStudies: string[];
  identityLock: string;
  forbiddenContent: string[];
}

export interface VideoStoryboardAssetBoardItem {
  id: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  variantId?: string;
  variantName?: string;
  boardKind: AssetBoardKind;
  strategyId?: string;
  layoutContract: AssetBoardLayoutContract;
  imageModelProfileId: string;
  prompt?: string;
  cleanPrompt?: string;
  productionReferenceImageUrl?: string;
  cleanReferenceImageUrl?: string;
  /** Downstream-preferred reference. Text-free references take priority when present. */
  referenceImageUrl?: string;
  requiredForStages: Array<"storyboard" | "prompt" | "expensive_generation_planning">;
  readiness: AssetBoardReadiness;
  continuityRole: string;
  styleLockSummary?: string;
  productionUse: "development_reference" | "formal_asset_board";
}

export interface VideoStoryboardAssetBoardPlan {
  id: string;
  projectId: string;
  imageModelProfileId: string;
  generatedFromStage: "asset_detail";
  productionReadiness: AssetBoardProductionReadiness;
  formalAssetIntent: boolean;
  productionPrepRefs: {
    scriptLockPackageId?: string;
    contentLockPackageId?: string;
    productionBlockLockId?: string;
    productionBreakdownReportId?: string;
    castingRequirementIds: string[];
    castingDecisionIds: string[];
    departmentPrepPackageIds: string[];
  };
  formalAssetBlockers: string[];
  characterBoards: VideoStoryboardAssetBoardItem[];
  sceneBoards: VideoStoryboardAssetBoardItem[];
  propBoards: VideoStoryboardAssetBoardItem[];
  vehicleBoards: VideoStoryboardAssetBoardItem[];
  variantBoards: VideoStoryboardAssetBoardItem[];
}

export interface BuildVideoStoryboardAssetBoardPlanOptions {
  formalAssetIntent?: boolean;
  scriptLockPackage?: Partial<ScriptLockPackage>;
  contentLockPackage?: Partial<ContentLockPackage>;
  productionBlockLock?: Partial<ProductionBlockLock>;
  productionBreakdownReport?: Partial<ProductionBreakdownReport>;
  castingRequirements?: Partial<CastingRequirement>[];
  castingDecisions?: Partial<CastingDecision>[];
  departmentPrepPackages?: Partial<DepartmentPrepPackage>[];
}

export interface VideoStoryboardAssetBoardIssue {
  severity: "blocking" | "warning";
  code: string;
  target: string;
  message: string;
}

const firstAssetBoardProfileId = () =>
  IMAGE_MODEL_PROFILES.find((profile) => profile.supportsAssetBoards)?.id || IMAGE_MODEL_PROFILES[0]?.id || "image.asset_board_reference.configurable.v1";

const clean = (value: unknown) => String(value || "").trim();

const contract = (
  contractId: string,
  requiredViews: string[],
  requiredStudies: string[],
  identityLock: string,
  forbiddenContent: string[],
): AssetBoardLayoutContract => ({
  schemaVersion: "asset-board-layout-contract.v1",
  contractId,
  canvasAspectRatio: "16:9",
  outputForm: "single_composite_production_sheet",
  requiredViews,
  requiredStudies,
  identityLock,
  forbiddenContent,
});

export const resolveAssetBoardLayoutContract = (
  boardKind: AssetBoardKind,
  assetType: VideoStoryboardAssetBoardItem["assetType"],
): AssetBoardLayoutContract => {
  if (boardKind === "character_board") return contract(
    "asset-board.character.production-sheet.v1",
    ["大型正面全身英雄视角", "正面全身", "侧面全身", "背面全身", "头部正面与侧面"],
    ["3-6 个可执行姿态与身体重心", "至少 8 格表情与眼神矩阵", "发型/服装/饰品/鞋/手部细节", "至少 3 个轮廓剪影", "项目色板"],
    "所有区域必须是同一人物、同一年龄、同一脸型体型、同一发型和同一 canonical 服装。",
    ["剧情场景截图", "不同演员拼贴", "不同服装状态混排", "裁断头脸或关键肢体", "依赖图片模型书写长文字"],
  );
  if (boardKind === "scene_board") return contract(
    "asset-board.scene.production-sheet.v1",
    ["大型主空间全景", "俯视拓扑/平面关系", "入口与出口", "主通道与反打方向", "3-6 个可拍机位"],
    ["固定陈设与关键道具位置", "材质与建筑细节", "遮挡物/危险区", "主光方向与日夜基准", "尺度参照"],
    "所有视图必须属于同一个可拍空间，门窗、通道、陈设和方向关系不得互相矛盾。",
    ["无关角色表演", "把场景板画成剧情截图", "互相冲突的空间版本", "无来源的新地点事实", "依赖图片模型书写长文字"],
  );
  if (boardKind === "prop_board") return contract(
    "asset-board.prop.production-sheet.v1",
    ["大型英雄视角", "正面", "侧面", "背面", "顶视", "底部/接口"],
    ["手持或角色比例", "材质与磨损细节", "可交互部件", "开启/关闭或使用方式", "尺寸参照"],
    "所有视图必须保持同一轮廓、尺寸、材质、接口和功能结构。",
    ["互斥状态混排", "改变核心结构", "无关场景表演", "品牌/水印/UI", "依赖图片模型书写长文字"],
  );
  if (boardKind === "vehicle_board") return contract(
    "asset-board.vehicle.production-sheet.v1",
    ["大型三分之四主视图", "前视", "后视", "左侧视", "右侧视"],
    ["整体比例与尺度参照", "外观结构、出入口与可交互部位", "材质、标记与可拍机位"],
    "所有视图必须为资产描述指定的同一交通工具，保持轮廓、比例、结构、左右方位及出入口一致；不得添加描述中没有的专用设施。",
    ["不同交通工具拼接", "无依据改变结构或尺寸", "左右方向互换", "剧情截图", "品牌/水印/UI"],
  );
  const variantViews = assetType === "character"
    ? ["当前状态大型全身", "当前状态正面全身", "当前状态侧面全身", "当前状态背面全身"]
    : assetType === "location"
      ? ["当前状态主空间全景", "当前状态入口/出口", "当前状态反打方向", "当前状态俯视拓扑"]
      : assetType === "vehicles"
        ? ["当前状态三分之四主视图", "当前状态前视", "当前状态后视", "当前状态左右侧视"]
      : ["当前状态英雄视角", "当前状态正面", "当前状态侧面", "当前状态背面"];
  return contract(
    `asset-board.variant.${assetType}.state-sheet.v1`,
    variantViews,
    ["仅展示本状态的差异细节", "本状态的材质/服化道/损毁/激活证据", "尺度与 canonical 身份一致性"],
    "只允许改变声明的 variant 状态；canonical 身份、轮廓、比例、空间骨架或核心结构必须继承基础板。",
    ["前后对比", "变化时间线", "基础状态小窗", "其他变体或未来状态", "重新设计 canonical 身份", "依赖图片模型书写长文字"],
  );
};

const readinessFor = (prompt?: string, referenceImageUrl?: string): AssetBoardReadiness => {
  if (referenceImageUrl) return "reference_ready";
  if (prompt) return "prompt_ready";
  return "needs_prompt";
};

const refsForCharacter = (character: Character) => ({
  production: clean(character.boardImageUrl),
  clean: clean(character.cleanReferenceImageUrl || (!character.boardImageUrl ? character.multiViewUrl : "")),
});

const refsForAsset = (asset: Asset) => ({
  production: clean(asset.boardImageUrl),
  clean: clean(asset.cleanReferenceImageUrl || (!asset.boardImageUrl
    ? asset.type === "location" ? asset.panoramaUrl : asset.multiViewUrl
    : "")),
});

const refsForVariant = (variant: AssetVariant) => ({
  production: clean(variant.boardImageUrl),
  clean: clean(variant.cleanReferenceImageUrl || (!variant.boardImageUrl ? variant.imageUrl : "")),
});

const boardCanvasRules = [
  "最终成品必须是一张复合制作参考板，不是散图、普通肖像、气氛图或单一视角图片。",
  "使用清楚分区、留白充足、制作信息可扫描的参考页布局；主视图、正侧背、研究区、细节区和色板区必须能一眼区分。",
  "所有研究图必须清晰分离，不重叠、不裁脸、不隐藏关键肢体或结构，不把多个姿势合并成一个角色/资产。",
  "画布顶部和底部保留干净的信息带，不生成中文标题、标签、色板名称、水印或长文字；系统会在出图后确定性叠加真实名称、板型、研究区说明和色板，避免模型乱码。",
  "资产真实名称、角色、视觉标志、variantId 和状态必须保存在结构化字段中，图片模型不得自行编造制作文字。",
].join("\n");

const characterBoardPrompt = (character: Character) =>
  clean([
    "【资产板策略】assetBoard.characterIdentity.artbook.v1",
    boardCanvasRules,
    `【主体】角色：${character.name}`,
    character.visualIdentity ? `【可见身份锚点】${character.visualIdentity}` : "",
    "【制作目标】创建一张制作级角色身份板，用于后续图像和视频模型锁定同一角色身份，而不是普通角色参考表。",
    "【主要构图】一个大型英雄全身视角略微偏离中心作为视觉锚点；围绕它放置中性全身、背面、侧面、坐姿、倾斜姿势、蹲姿、俯视身体角度、仰视身体角度和富有表现力的肖像研究。",
    "【身份锁定】所有视角保持相同面部、面部比例、发型、服装、身体比例、姿势语言和视觉个性；不得在不同视角里改变年龄、脸型、发型、体型或服装基准。",
    "【有用参考细节】清晰呈现面部形状、发型轮廓、服装轮廓、身体形状、手部、姿势、表情范围和角色视觉标志。",
    "【研究区】包含 2-3 个简化黑色轮廓；包含细微情感变化的表情研究；包含面部、头发、服装关键特征的细节研究。",
    "【信息区】只预留干净版面，不绘制中文名称或标签；名称、角色、核心情绪和视觉标志由系统确定性排版器叠加。允许少量不含文字的细微箭头。",
  ].filter(Boolean).join("\n"));

const locationBoardPrompt = (asset: Asset) =>
  clean([
    "【资产板策略】assetBoard.locationSetIdentity.production.v1",
    boardCanvasRules,
    `【主体】场景/置景：${asset.name}`,
    asset.description ? `【基础描述】${asset.description}` : "",
    "【制作目标】创建一张场景/置景身份板，用于锁定空间结构、可拍机位、光线方向、关键陈设和状态变化，而不是单张气氛图。",
    "【主要构图】一个大型主空间全景作为视觉锚点；周围排列入口/出口、主通道、反打方向、俯视平面感、可拍机位、关键陈设、材质细节和光线方向研究。",
    "【状态研究】如有日夜、雨雪、火灾、损毁、修复、战后等状态，只作为场景变体研究出现；不要把不同状态误合成同一个基础场景。",
    "【禁止】不要放入无关角色表演，不要把场景画成剧情截图；场景板服务布景、机位和连续性。",
  ].filter(Boolean).join("\n"));

const propBoardPrompt = (asset: Asset) =>
  clean([
    "【资产板策略】assetBoard.propIdentity.production.v1",
    boardCanvasRules,
    `【主体】道具/装备：${asset.name}`,
    asset.description ? `【基础描述】${asset.description}` : "",
    "【制作目标】创建一张道具身份板，用于锁定外形、尺寸、材质、持握方式、交互部件和状态变化，便于故事板和视频模型稳定复用。",
    "【主要构图】一个大型英雄视角作为视觉锚点；周围排列正面、侧面、背面、顶视图、底部/接口、持握方式、与手部或角色比例关系、可交互部件和关键细节研究。",
    "【身份锁定】所有视角保持同一 canonical 道具，不得改变标志性轮廓、材质逻辑、尺寸比例或功能结构。",
    "【状态研究】如有开启、破损、发光、污染、封印解除、耗尽等状态，只作为变体研究；不要把状态变化当成新道具身份。",
  ].filter(Boolean).join("\n"));

const vehicleBoardPrompt = (asset: Asset) => clean([
  "【资产板策略】assetBoard.vehicleIdentity.production.v1",
  boardCanvasRules,
  `【主体】交通工具：${asset.name}`,
  asset.description ? `【基础描述】${asset.description}` : "",
  "【制作目标】锁定同一交通工具的外观结构、尺度、左右方位、出入口与可拍机位，供场次和分镜连续使用；专有构造只依据资产描述。",
  "【主要构图】一张复合参考板，包含三分之四主视图、前后视、左右侧视及描述中明确的关键结构；各视图保持相同比例与身份。",
].filter(Boolean).join("\n"));

const variantPrompt = (
  baseName: string,
  variant: AssetVariant,
) => clean([
  "【资产板策略】assetBoard.variantDelta.stateLock.v1",
  boardCanvasRules,
  `【主体】${baseName} 的状态变体：${variant.name}`,
  "【基础身份】canonical 身份、结构、比例、材质和空间骨架只从输入的继承参考板读取；参考板不作为另一状态画进成品。",
  variant.description ? `【变体描述】${variant.description}` : "",
  variant.promptModifiers ? `【变体提示词补充】${variant.promptModifiers}` : "",
  "【制作目标】创建单一当前状态参考板，供分镜与视频模型直接锁定这个变体；不是变化过程说明图。",
  "【布局要求】整张板的英雄视角、正面、侧面、背面和关键差异细节都必须是当前声明的同一状态。禁止基础状态小参考区、变化时间线、状态前后对比、其他变体、未来状态和连续性文字标记。",
  "【身份锁定】只表现当前状态，不改变 canonical 身份；脸、体型、基础轮廓、道具核心结构、地点空间骨架必须与输入参考板一致。",
].filter(Boolean).join("\n"));

const targetedAssetStyleInstruction = (
  project: Project,
  asset: ProductionAssetVisualStyleTarget,
) => buildProductionAssetVisualStyleProjection({ project, asset }).rendered.instruction;

const boardItem = ({
  assetId,
  assetType,
  assetName,
  variant,
  boardKind,
  strategyId,
  layoutContract,
  imageModelProfileId,
  prompt,
  cleanPrompt,
  productionReferenceImageUrl,
  cleanReferenceImageUrl,
  continuityRole,
  styleLockSummary,
  productionUse,
}: {
  assetId: string;
  assetType: VideoStoryboardAssetBoardItem["assetType"];
  assetName: string;
  variant?: AssetVariant;
  boardKind: AssetBoardKind;
  strategyId?: string;
  layoutContract: AssetBoardLayoutContract;
  imageModelProfileId: string;
  prompt?: string;
  cleanPrompt?: string;
  productionReferenceImageUrl?: string;
  cleanReferenceImageUrl?: string;
  continuityRole: string;
  styleLockSummary?: string;
  productionUse: VideoStoryboardAssetBoardItem["productionUse"];
}): VideoStoryboardAssetBoardItem => ({
  id: variant ? `${assetId}.${variant.id}.variant_board` : `${assetId}.${boardKind}`,
  assetId,
  assetType,
  assetName,
  variantId: variant?.id,
  variantName: variant?.name,
  boardKind,
  strategyId,
  layoutContract,
  imageModelProfileId,
  prompt: clean(prompt) || undefined,
  cleanPrompt: clean(cleanPrompt) || undefined,
  productionReferenceImageUrl: clean(productionReferenceImageUrl) || undefined,
  cleanReferenceImageUrl: clean(cleanReferenceImageUrl) || undefined,
  referenceImageUrl: clean(cleanReferenceImageUrl || productionReferenceImageUrl) || undefined,
  requiredForStages: ["storyboard", "prompt", "expensive_generation_planning"],
  readiness: readinessFor(prompt, cleanReferenceImageUrl || productionReferenceImageUrl),
  continuityRole,
  styleLockSummary,
  productionUse,
});

const approved = (value?: { approvalState?: string }) => value?.approvalState === "approved";

const locked = (value?: { status?: string }) => value?.status === "locked";

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const resolveProductionReadiness = (
  options: BuildVideoStoryboardAssetBoardPlanOptions = {},
): Pick<VideoStoryboardAssetBoardPlan, "productionReadiness" | "formalAssetIntent" | "productionPrepRefs" | "formalAssetBlockers"> => {
  const formalAssetIntent = options.formalAssetIntent === true;
  const castingRequirements = asArray<Partial<CastingRequirement>>(options.castingRequirements);
  const castingDecisions = asArray<Partial<CastingDecision>>(options.castingDecisions);
  const departmentPrepPackages = asArray<Partial<DepartmentPrepPackage>>(options.departmentPrepPackages);
  const approvedCastingRequirementIds = new Set(castingDecisions
    .filter((decision) => decision.status === "approved")
    .map((decision) => clean(decision.castingRequirementId))
    .filter(Boolean));
  const refs = {
    scriptLockPackageId: clean(options.scriptLockPackage?.id) || undefined,
    contentLockPackageId: clean(options.contentLockPackage?.id) || undefined,
    productionBlockLockId: clean(options.productionBlockLock?.id) || undefined,
    productionBreakdownReportId: clean(options.productionBreakdownReport?.id) || undefined,
    castingRequirementIds: castingRequirements.map((item) => clean(item.id)).filter(Boolean),
    castingDecisionIds: castingDecisions.map((item) => clean(item.id)).filter(Boolean),
    departmentPrepPackageIds: departmentPrepPackages.map((item) => clean(item.id)).filter(Boolean),
  };
  if (!formalAssetIntent) {
    return {
      productionReadiness: "development_only",
      formalAssetIntent,
      productionPrepRefs: refs,
      formalAssetBlockers: [
        "asset_board_plan 当前作为开发期身份板方向，不能被当作正式可拍/可生成资产锁。",
      ],
    };
  }
  const hasApprovedContentLock = approved(options.scriptLockPackage) || approved(options.contentLockPackage);
  const missingApprovedCastingDecisionCount = castingRequirements.filter((requirement) =>
    !approvedCastingRequirementIds.has(clean(requirement.id)),
  ).length;
  const blockers = [
    hasApprovedContentLock ? "" : "缺少 approved script_lock_package 或 content_lock_package。",
    locked(options.productionBlockLock) ? "" : "缺少 locked production_block_lock。",
    asArray(options.productionBreakdownReport?.sceneMatrix).length ? "" : "缺少可用 production_breakdown_report.sceneMatrix。",
    castingRequirements.length ? "" : "缺少 casting_requirement。",
    castingRequirements.length && missingApprovedCastingDecisionCount === 0 ? "" : "缺少 approved casting_decision。",
    departmentPrepPackages.length ? "" : "缺少 department_prep_package。",
  ].filter(Boolean);
  return {
    productionReadiness: blockers.length ? "formal_blocked" : "formal_ready",
    formalAssetIntent,
    productionPrepRefs: refs,
    formalAssetBlockers: blockers,
  };
};

export const buildVideoStoryboardAssetBoardPlan = (
  project: Project,
  options: BuildVideoStoryboardAssetBoardPlanOptions = {},
): VideoStoryboardAssetBoardPlan => {
  const imageModelProfileId = firstAssetBoardProfileId();
  const productionState = resolveProductionReadiness(options);
  const productionUse: VideoStoryboardAssetBoardItem["productionUse"] = productionState.productionReadiness === "formal_ready"
    ? "formal_asset_board"
    : "development_reference";
  const detailedCharacters = project.characters || [];
  const detailedCharacterNames = new Set(detailedCharacters.map((character) => clean(character.name)));
  const plannedCharacters = collectProjectAssetsForContext(project, "character")
    .filter((asset) => !detailedCharacterNames.has(clean(asset.name)))
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      visualIdentity: asset.description,
    }) as Character);
  const characters = [...detailedCharacters, ...plannedCharacters]
    .filter((character) => character.visualPresence !== "voice_only");
  const locations = collectProjectAssetsForContext(project, "location");
  const props = collectProjectAssetsForContext(project, "prop");
  const vehicles = (project.assets || []).filter((asset) => asset.type === "vehicles");
  const characterBoards = characters.map((character) => {
    const styleInstruction = targetedAssetStyleInstruction(project, {
      assetId: character.id,
      assetType: "character",
      assetName: character.name,
    });
    return boardItem({
      assetId: character.id,
      assetType: "character",
      assetName: character.name,
      boardKind: "character_board",
      strategyId: "assetBoard.characterIdentity.artbook.v1",
      layoutContract: resolveAssetBoardLayoutContract("character_board", "character"),
      imageModelProfileId,
      prompt: character.boardPrompt || characterBoardPrompt(character),
      cleanPrompt: character.cleanReferencePrompt,
      productionReferenceImageUrl: refsForCharacter(character).production,
      cleanReferenceImageUrl: refsForCharacter(character).clean,
      continuityRole: "锁定角色外貌、服装基准、表情范围和后续变体身份。",
      styleLockSummary: styleInstruction,
      productionUse,
    });
  });
  const sceneBoards = locations.map((asset) => {
    const styleInstruction = targetedAssetStyleInstruction(project, {
      assetId: asset.id,
      assetType: "location",
      assetName: asset.name,
    });
    return boardItem({
      assetId: asset.id,
      assetType: "location",
      assetName: asset.name,
      boardKind: "scene_board",
      strategyId: "assetBoard.locationSetIdentity.production.v1",
      layoutContract: resolveAssetBoardLayoutContract("scene_board", "location"),
      imageModelProfileId,
      prompt: asset.boardPrompt || locationBoardPrompt(asset),
      cleanPrompt: asset.cleanReferencePrompt,
      productionReferenceImageUrl: refsForAsset(asset).production,
      cleanReferenceImageUrl: refsForAsset(asset).clean,
      continuityRole: "锁定地点空间布局、光线方向、关键陈设和可拍机位。",
      styleLockSummary: styleInstruction,
      productionUse,
    });
  });
  const propBoards = props.map((asset) => {
    const styleInstruction = targetedAssetStyleInstruction(project, {
      assetId: asset.id,
      assetType: "prop",
      assetName: asset.name,
    });
    return boardItem({
      assetId: asset.id,
      assetType: "prop",
      assetName: asset.name,
      boardKind: "prop_board",
      strategyId: "assetBoard.propIdentity.production.v1",
      layoutContract: resolveAssetBoardLayoutContract("prop_board", "prop"),
      imageModelProfileId,
      prompt: asset.boardPrompt || propBoardPrompt(asset),
      cleanPrompt: asset.cleanReferencePrompt,
      productionReferenceImageUrl: refsForAsset(asset).production,
      cleanReferenceImageUrl: refsForAsset(asset).clean,
      continuityRole: "锁定道具外观、材质、尺寸、持握方式和状态变化基准。",
      styleLockSummary: styleInstruction,
      productionUse,
    });
  });
  const vehicleBoards = vehicles.map((asset) => boardItem({
    assetId: asset.id,
    assetType: "vehicles",
    assetName: asset.name,
    boardKind: "vehicle_board",
    strategyId: "assetBoard.vehicleIdentity.production.v1",
    layoutContract: resolveAssetBoardLayoutContract("vehicle_board", "vehicles"),
    imageModelProfileId,
    prompt: asset.boardPrompt || vehicleBoardPrompt(asset),
    cleanPrompt: asset.cleanReferencePrompt,
    productionReferenceImageUrl: refsForAsset(asset).production,
    cleanReferenceImageUrl: refsForAsset(asset).clean,
    continuityRole: "锁定交通工具结构、空间方向、入口及损坏状态。",
    styleLockSummary: targetedAssetStyleInstruction(project, { assetId: asset.id, assetType: "vehicles", assetName: asset.name }),
    productionUse,
  }));
  const characterVariantBoards = characters.flatMap((character) =>
    (character.variants || []).map((variant) => {
      const styleInstruction = targetedAssetStyleInstruction(project, {
        assetId: character.id,
        assetType: "character",
        assetName: character.name,
        variantId: variant.id,
        variantName: variant.name,
      });
      return boardItem({
        assetId: character.id,
        assetType: "character",
        assetName: character.name,
        variant,
        boardKind: "variant_board",
        strategyId: "assetBoard.variantDelta.stateLock.v1",
        layoutContract: resolveAssetBoardLayoutContract("variant_board", "character"),
        imageModelProfileId,
        prompt: variant.boardPrompt || variantPrompt(character.name, variant),
        cleanPrompt: variant.cleanReferencePrompt,
        productionReferenceImageUrl: refsForVariant(variant).production,
        cleanReferenceImageUrl: refsForVariant(variant).clean,
        continuityRole: "锁定角色服装、妆发、伤势、战损或情绪状态变体。",
        styleLockSummary: styleInstruction,
        productionUse,
      });
    }),
  );
  const assetVariantBoards = [...locations, ...props, ...vehicles].flatMap((asset) =>
    (asset.variants || []).map((variant) => {
      const assetType = asset.type === "location" ? "location" as const : asset.type === "vehicles" ? "vehicles" as const : "prop" as const;
      const styleInstruction = targetedAssetStyleInstruction(project, {
        assetId: asset.id,
        assetType,
        assetName: asset.name,
        variantId: variant.id,
        variantName: variant.name,
      });
      return boardItem({
        assetId: asset.id,
        assetType,
        assetName: asset.name,
        variant,
        boardKind: "variant_board",
        strategyId: "assetBoard.variantDelta.stateLock.v1",
        layoutContract: resolveAssetBoardLayoutContract("variant_board", assetType),
        imageModelProfileId,
        prompt: variant.boardPrompt || variantPrompt(asset.name, variant),
        cleanPrompt: variant.cleanReferencePrompt,
        productionReferenceImageUrl: refsForVariant(variant).production,
        cleanReferenceImageUrl: refsForVariant(variant).clean,
        continuityRole: "锁定地点损毁、道具破损、激活状态或使用状态变体。",
        styleLockSummary: styleInstruction,
        productionUse,
      });
    }),
  );
  return {
    id: `${project.id}.asset_board_plan`,
    projectId: project.id,
    imageModelProfileId,
    generatedFromStage: "asset_detail",
    ...productionState,
    characterBoards,
    sceneBoards,
    propBoards,
    vehicleBoards,
    variantBoards: [...characterVariantBoards, ...assetVariantBoards],
  };
};

const issue = (
  severity: VideoStoryboardAssetBoardIssue["severity"],
  code: string,
  target: string,
  message: string,
): VideoStoryboardAssetBoardIssue => ({ severity, code, target, message });

export const validateVideoStoryboardAssetBoardPlan = (
  plan: VideoStoryboardAssetBoardPlan,
  project: Project,
): VideoStoryboardAssetBoardIssue[] => {
  const issues: VideoStoryboardAssetBoardIssue[] = [];
  const detailedCharacters = project.characters || [];
  const detailedCharacterNames = new Set(detailedCharacters.map((character) => clean(character.name)));
  const plannedCharacters = collectProjectAssetsForContext(project, "character")
    .filter((asset) => !detailedCharacterNames.has(clean(asset.name)))
    .map((asset) => ({ id: asset.id, name: asset.name }) as Character);
  const characters = [...detailedCharacters, ...plannedCharacters]
    .filter((character) => character.visualPresence !== "voice_only");
  const locations = collectProjectAssetsForContext(project, "location");
  const props = collectProjectAssetsForContext(project, "prop");
  const vehicles = (project.assets || []).filter((asset) => asset.type === "vehicles");
  const items = [
    ...(plan.characterBoards || []),
    ...(plan.sceneBoards || []),
    ...(plan.propBoards || []),
    ...(plan.vehicleBoards || []),
    ...(plan.variantBoards || []),
  ];
  const itemIds = new Set<string>();
  const itemByAsset = new Map(items.map((item) => [item.assetId, item]));

  if (plan.formalAssetIntent && plan.productionReadiness !== "formal_ready") {
    issues.push(issue(
      "blocking",
      "FORMAL_ASSET_BOARD_LOCK_MISSING",
      "assetBoardPlan.productionReadiness",
      `正式资产板缺少生产锁定/筹备前置条件：${(plan.formalAssetBlockers || []).join("；") || "未知阻断"}`,
    ));
  }
  if (!plan.formalAssetIntent || plan.productionReadiness === "development_only") {
    issues.push(issue(
      "warning",
      "ASSET_BOARD_DEVELOPMENT_ONLY",
      "assetBoardPlan.productionReadiness",
      "当前 asset_board_plan 只能作为开发期身份板方向；正式角色/场景/道具资产板必须由 script/content lock、production breakdown、casting requirement、approved casting decision 和 department prep 驱动。",
    ));
  }
  if (plan.productionReadiness === "formal_ready" && !plan.productionPrepRefs?.productionBreakdownReportId) {
    issues.push(issue(
      "blocking",
      "FORMAL_ASSET_BOARD_BREAKDOWN_REF_MISSING",
      "assetBoardPlan.productionPrepRefs.productionBreakdownReportId",
      "正式资产板必须绑定 production_breakdown_report。",
    ));
  }
  if (plan.productionReadiness === "formal_ready" && !plan.productionPrepRefs?.castingDecisionIds?.length) {
    issues.push(issue(
      "blocking",
      "FORMAL_ASSET_BOARD_CASTING_DECISION_MISSING",
      "assetBoardPlan.productionPrepRefs.castingDecisionIds",
      "正式角色资产板必须绑定 approved casting_decision。",
    ));
  }

  for (const item of items) {
    if (!item.id) issues.push(issue("blocking", "ASSET_BOARD_ID_MISSING", "assetBoardPlan.items", "资产板 item 缺少 id。"));
    if (itemIds.has(item.id)) issues.push(issue("blocking", "ASSET_BOARD_ID_DUPLICATE", `assetBoardPlan.items.${item.id}`, `资产板 item id 重复：${item.id}`));
    itemIds.add(item.id);
    if (!item.assetId) issues.push(issue("blocking", "ASSET_BOARD_ASSET_ID_MISSING", `assetBoardPlan.items.${item.id}`, "资产板 item 缺少 assetId。"));
    if (!item.imageModelProfileId) issues.push(issue("blocking", "ASSET_BOARD_MODEL_PROFILE_MISSING", `assetBoardPlan.items.${item.id}`, "资产板 item 缺少 imageModelProfileId。"));
    if (!item.layoutContract || item.layoutContract.schemaVersion !== "asset-board-layout-contract.v1") {
      issues.push(issue(
        plan.productionReadiness === "formal_ready" ? "blocking" : "warning",
        "ASSET_BOARD_LAYOUT_CONTRACT_MISSING",
        `assetBoardPlan.items.${item.id}.layoutContract`,
        "资产板必须绑定明确的单图复合制作板版式合同。",
      ));
    } else {
      if (item.layoutContract.outputForm !== "single_composite_production_sheet" || item.layoutContract.canvasAspectRatio !== "16:9") {
        issues.push(issue("blocking", "ASSET_BOARD_OUTPUT_FORM_INVALID", `assetBoardPlan.items.${item.id}.layoutContract`, "资产板最终形态必须是一张 16:9 横向复合制作参考板。"));
      }
      if (!item.layoutContract.requiredViews.length || !item.layoutContract.identityLock) {
        issues.push(issue("blocking", "ASSET_BOARD_REQUIRED_VIEWS_MISSING", `assetBoardPlan.items.${item.id}.layoutContract`, "资产板版式合同缺少必需视图或身份锁规则。"));
      }
    }
    if (plan.productionReadiness === "formal_ready" && item.productionUse !== "formal_asset_board") {
      issues.push(issue("blocking", "FORMAL_ASSET_BOARD_ITEM_NOT_FORMAL", `assetBoardPlan.items.${item.id}`, "正式资产板 item 必须标记 productionUse=formal_asset_board。"));
    }
    if (plan.productionReadiness !== "formal_ready" && item.productionUse === "formal_asset_board") {
      issues.push(issue("blocking", "DEVELOPMENT_ASSET_BOARD_ITEM_MARKED_FORMAL", `assetBoardPlan.items.${item.id}`, "开发期资产板 item 不能标记为 formal_asset_board。"));
    }
    if (!item.prompt && !item.referenceImageUrl) {
      issues.push(issue("warning", "ASSET_BOARD_PROMPT_OR_REFERENCE_MISSING", `assetBoardPlan.items.${item.id}`, "资产板 item 缺少 prompt/referenceImageUrl，后续无法稳定生成参考图。"));
    }
    if (item.variantId) {
      const owner = item.assetType === "character"
        ? characters.find((character) => character.id === item.assetId)
        : [...locations, ...props, ...vehicles].find((asset) => asset.id === item.assetId);
      if (!owner?.variants?.some((variant) => variant.id === item.variantId)) {
        issues.push(issue("blocking", "ASSET_BOARD_UNKNOWN_VARIANT", `assetBoardPlan.items.${item.id}`, `资产板引用了不存在的 variant：${item.variantId}`));
      }
    }
  }

  for (const character of characters) {
    if (!itemByAsset.has(character.id)) {
      issues.push(issue("warning", "CHARACTER_BOARD_MISSING", `character.${character.id}`, `角色「${character.name}」缺少角色板计划。`));
    }
  }
  for (const asset of locations) {
    if (!itemByAsset.has(asset.id)) {
      issues.push(issue("warning", "SCENE_BOARD_MISSING", `asset.${asset.id}`, `地点「${asset.name}」缺少场景板计划。`));
    }
  }
  for (const asset of props) {
    if (!itemByAsset.has(asset.id)) {
      issues.push(issue("warning", "PROP_BOARD_MISSING", `asset.${asset.id}`, `道具「${asset.name}」缺少道具板计划。`));
    }
  }
  for (const asset of vehicles) {
    if (!itemByAsset.has(asset.id)) issues.push(issue("warning", "VEHICLE_BOARD_MISSING", `asset.${asset.id}`, `交通工具「${asset.name}」缺少资产板计划。`));
  }

  return issues;
};
