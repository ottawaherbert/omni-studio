import type { VideoStoryboardAssetBoardItem } from "./videoStoryboardAssetBoards";

export type ProductionAssetReferenceMode = "production_board" | "clean_reference";

export interface ProductionAssetReferenceModeSpec {
  mode: ProductionAssetReferenceMode;
  label: string;
  contractId: string;
  outputForm: "composite_sheet" | "single_image";
  requiredViews: string[];
  requiredStudies: string[];
  identityLock: string;
  forbiddenContent: string[];
  compositionInstruction: string;
}

const cleanForbiddenContent = [
  "额外的资料标题、资产名称标签、视图编号或制作说明",
  "排版用标尺、色板文字、工具 UI、工具 Logo 或水印",
  "无关人物或物件",
  "互相矛盾的身份、结构、材质或状态",
];

export const resolveProductionAssetReferenceModeSpec = (
  board: VideoStoryboardAssetBoardItem,
  mode: ProductionAssetReferenceMode,
): ProductionAssetReferenceModeSpec => {
  if (board.characterReferenceLayout) mode = 'clean_reference';
  if (board.locationView) return {
    mode: 'clean_reference', label: '场景视角参考', contractId: `asset-reference.location.${board.locationView}.v1`,
    outputForm: 'single_image', requiredViews: [board.assetName], requiredStudies: [],
    identityLock: '同一场景、同一状态、同一固定陈设和光线，只改变观察方向。',
    forbiddenContent: ['分格拼贴', '角色表演', '无依据的剧情状态变化'],
    compositionInstruction: board.cleanPrompt || '',
  };
  if (board.assetType === 'character' && mode === 'clean_reference') return {
    mode: 'clean_reference', label: '去头身体三视图＋脸部特写', contractId: 'asset-reference.character.body-face.v1', outputForm: 'composite_sheet',
    requiredViews: ['无头正面身体全身图（颈部至鞋底）', '无头严格90度侧面身体全身图（颈部至鞋底）', '无头背面身体全身图（颈部至鞋底）', '完整正脸大特写，包含发型、五官、妆容与脸部当前状态'],
    requiredStudies: [], identityLock: '同一角色、同一服装体型和同一状态。身体三视图同尺度、同地线，保留领口和衣物结构；头部身份只从右侧完整脸部特写读取。',
    forbiddenContent: [...cleanForbiddenContent, '前三栏出现小脸、头部或头发', '血腥切口、伤口或断头效果', '将不同伤势、服装或妆容状态混在同一版', '道具、武器或场景背景'],
    compositionInstruction: '输出一张四栏纯净角色参考图：左侧三栏为正面、严格侧面、背面的身体与服装，统一从颈部以上省略头部及头发，切口干净自然，无血腥效果；右侧为同一角色清晰完整正脸大特写，保留完整发型和当前妆容、伤势或创可贴。身体负责服装与比例，脸部负责身份，不再从身体栏生成小脸。纯白不透明实底，不生成透明背景、半透明背景或棋盘格，无字无标签无水印。',
  };
  if (mode === "production_board") {
    return {
      mode,
      label: "制作资料板（设计审查）",
      contractId: board.layoutContract.contractId,
      outputForm: "composite_sheet",
      requiredViews: board.layoutContract.requiredViews,
      requiredStudies: board.layoutContract.requiredStudies,
      identityLock: board.layoutContract.identityLock,
      forbiddenContent: board.layoutContract.forbiddenContent,
      compositionInstruction: "按本次设计需求组织主视图和必要细节；研究区与色板按需，不要求同时再制作纯净图。",
    };
  }

  const statePrefix = board.variantId ? "当前状态" : "";
  if (board.assetType === "prop") {
    return {
      mode,
      label: "纯净多视图",
      contractId: "asset-reference.prop.clean-multiview.v1",
      outputForm: "composite_sheet",
      requiredViews: [
        `${statePrefix}可识别整体轮廓的主视图`,
        `${statePrefix}剧情涉及的操作部位与必要补充角度`,
      ],
      requiredStudies: [],
      identityLock: "所有视图必须是同一个道具、同一尺寸比例、同一轮廓、同一材质、同一接口和同一状态。",
      forbiddenContent: [...cleanForbiddenContent, "手持演示、人物比例参照、拆解爆炸图或状态对比", "展示台、复杂阴影或场景背景"],
      compositionInstruction: "一张横图清楚展示主视图和剧情需要的补充角度或操作细节，不固定四栏，不为对称排版添加无用角度。整体视图同尺度，细节放大须清楚分区。背景使用纯白色实底，整张图片完全不透明；不生成透明背景或棋盘格。",
    };
  }
  if (board.assetType === "vehicles") return {
    mode,
    label: "纯净交通工具参考",
    contractId: "asset-reference.vehicle.clean-multiview.v1",
    outputForm: "composite_sheet",
    requiredViews: [`${statePrefix}前视`, `${statePrefix}后视`, `${statePrefix}左侧视`, `${statePrefix}右侧视`],
    requiredStudies: [],
    identityLock: "四视图必须为同一交通工具、同一外观结构与尺度；左右侧及出入口方位不得互换，专有构造只依据资产描述。",
    forbiddenContent: [...cleanForbiddenContent, "另一种交通工具或无依据新增的结构", "人物表演、剧情截图"],
    compositionInstruction: "一张横图分成四个清晰视区，展示同一交通工具的前、后、左、右视图；保持轮廓、尺度和出入口方位一致。",
  };
  return {
    mode,
    label: "纯净场景参考",
    contractId: "asset-reference.location.clean-master-view.v1",
    outputForm: "single_image",
    requiredViews: [`${statePrefix}单张大型空场主视图`],
    requiredStudies: [],
    identityLock: "只展示同一个场景的空间、固定陈设、材质和当前状态，不得改变门窗、通道、主要家具或光线基准。",
    forbiddenContent: [...cleanForbiddenContent, "拼贴、多机位小窗、俯视平面图或技术分析区", "人物或未指定的可移动物件"],
    compositionInstruction: "输出一张完整的空场主视图，不做拼贴、不分栏；使用最能识别空间结构、入口、主通道和固定陈设的平视广角机位。",
  };
};

export const referenceImageUrlForMode = (
  board: VideoStoryboardAssetBoardItem | undefined,
  mode: ProductionAssetReferenceMode,
) => mode === "clean_reference"
  ? board?.cleanReferenceImageUrl
  : board?.productionReferenceImageUrl;
