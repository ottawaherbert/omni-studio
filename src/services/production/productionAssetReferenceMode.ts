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
  if (mode === "production_board") {
    return {
      mode,
      label: "资料资产板",
      contractId: board.layoutContract.contractId,
      outputForm: "composite_sheet",
      requiredViews: board.layoutContract.requiredViews,
      requiredStudies: board.layoutContract.requiredStudies,
      identityLock: board.layoutContract.identityLock,
      forbiddenContent: board.layoutContract.forbiddenContent,
      compositionInstruction: "按制作资料板合同组织主视图、研究区、细节区和色板区。",
    };
  }

  const statePrefix = board.variantId ? "当前状态" : "";
  if (board.assetType === "character") {
    return {
      mode,
      label: "纯净三视图",
      contractId: "asset-reference.character.clean-turnaround.v1",
      outputForm: "composite_sheet",
      requiredViews: [
        `${statePrefix}正面全身正交视图`,
        `${statePrefix}严格 90 度侧面全身视图`,
        `${statePrefix}背面全身正交视图`,
        `${statePrefix}正面上半身身份特写`,
      ],
      requiredStudies: [],
      identityLock: "四个分区必须是同一人物、同一年龄脸型体型、同一发型、同一服装和同一状态；前三个全身视图必须同尺度、同眼平线、同地线。",
      forbiddenContent: [...cleanForbiddenContent, "表情矩阵、姿态研究、材质小窗或额外视角", "道具、武器、场景背景或遮挡身体轮廓的元素"],
      compositionInstruction: "整张图严格分成四个相邻的干净竖向分区，依次为正面全身、严格侧面全身、背面全身、正面上半身特写；只允许极细无字分隔线。背景使用纯白色实底，整张图片完全不透明；不抠图，不生成透明背景、半透明背景或棋盘格。",
    };
  }
  if (board.assetType === "prop") {
    return {
      mode,
      label: "纯净多视图",
      contractId: "asset-reference.prop.clean-multiview.v1",
      outputForm: "composite_sheet",
      requiredViews: [
        `${statePrefix}三分之四英雄视角`,
        `${statePrefix}正面正交视图`,
        `${statePrefix}严格侧面正交视图`,
        `${statePrefix}背面正交视图`,
      ],
      requiredStudies: [],
      identityLock: "四个分区必须是同一个道具、同一尺寸比例、同一轮廓、同一材质、同一接口和同一状态。",
      forbiddenContent: [...cleanForbiddenContent, "手持演示、人物比例参照、拆解爆炸图或状态对比", "展示台、复杂阴影或场景背景"],
      compositionInstruction: "一张横图严格分成四个相邻的干净分区，依次展示同一道具的三分之四英雄视角、正面、严格侧面和背面；所有视图同尺度、同中心线。背景使用纯白色实底，整张图片完全不透明；不抠图，不生成透明背景、半透明背景或棋盘格。",
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
