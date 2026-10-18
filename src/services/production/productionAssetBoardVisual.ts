import type { ManualStoryboardAgentQuality, Project } from "../../types/project";
import type { VideoStoryboardAssetBoardItem } from "./videoStoryboardAssetBoards";
import { buildProductionAssetBoardExecutionPrompt } from "./productionAssetBoardExecution";
import {
  createCanonicalAssetGenerationReference,
  createPreviousOutputRepairOperation,
  type ImageGenerationOperation,
  type ImageGenerationReference,
} from "./imageGenerationRequest";
import {
  resolveProductionAssetReferenceModeSpec,
  type ProductionAssetReferenceMode,
} from "./productionAssetReferenceMode";

export const PRODUCTION_ASSET_BOARD_VISUAL_CONTRACT_VERSION = "production-asset-board-visual.v1";
export const PRODUCTION_ASSET_BOARD_VISUAL_QUALITY_THRESHOLD = 90;
export const PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS = 3;

const boardLabel = (board: VideoStoryboardAssetBoardItem) => board.variantId
  ? `${board.assetName} · ${board.variantName || "状态变体"}`
  : board.assetName;

export const buildProductionAssetBoardCanonicalReference = ({
  board,
  imageUrl,
}: {
  board: VideoStoryboardAssetBoardItem;
  imageUrl: string;
}): ImageGenerationReference => createCanonicalAssetGenerationReference({
  imageUrl,
  label: board.assetType === "character" ? "人物外观参考图" : board.assetType === "location" ? "场景外观参考图" : board.assetType === "vehicles" ? "交通工具结构参考图" : "物件外观参考图",
  assetType: board.assetType,
  stateChange: Boolean(board.variantId),
});

export const buildProductionAssetBoardPreviousOutputRepairOperation = ({
  issues,
}: {
  board: VideoStoryboardAssetBoardItem;
  issues: string[];
}): Extract<ImageGenerationOperation, { kind: "edit" }> => createPreviousOutputRepairOperation({
  goal: "只修正输入图片中列出的画面问题",
  issues,
  preserve: [
    "上一版已正确的主体身份、轮廓、比例、视图数量、版式、材质与精确颜色",
    "未指定修改的外观细节、空间结构、物件结构、照明关系与展示视角",
    "明确指定的铭文、编号、招牌、印刷及屏幕文字的原文与位置",
  ],
  exclude: [
    "指定修改之外的重新设计、身份变化、外观变化、视图增删或版式改动",
    "额外主体、错误状态、未声明的文字、工具 UI、水印与说明排版",
  ],
});

export const buildProductionAssetBoardVisualQAPrompt = ({
  project,
  board,
  referenceMode = "production_board",
}: {
  project: Project;
  board: VideoStoryboardAssetBoardItem;
  referenceMode?: ProductionAssetReferenceMode;
}) => {
  const spec = resolveProductionAssetReferenceModeSpec(board, referenceMode);
  const isClean = referenceMode === "clean_reference";
  return [
  "你是独立的影视制作资产参考板视觉质检总监。只做质检，不生成内容。",
  "【输入图职责】输入图1=待验收资产板，只检查其结果；如有输入图2，输入图2=canonical 身份或上游状态参考，必须用来核对主体身份、结构、材质和已声明状态，但不得要求复制其背景、排版、构图或无关姿态。不得互换两张图的职责。",
  `项目：${project.title || ""}；资产板：${boardLabel(board)}；模式：${spec.label}。`,
  isClean
    ? spec.outputForm === "single_image"
      ? "首先确认待检结果是一张完整、无额外说明排版的场景主视图，输出方向与结构化目标画幅一致，不是拼贴、资料海报、多机位小窗或带标注的技术图。"
      : "首先确认待检结果是一张干净的多视图参考图，输出方向与结构化目标画幅一致，分区明确，没有额外资料标题、标尺、色板文字、工具 Logo、水印或工具 UI。"
    : "首先确认待检结果是一张宽度大于高度的复合制作参考板，而不是普通肖像、单张气氛图、剧情截图、散图集合或单一视角图片。",
  `必需视图：${spec.requiredViews.join("、")}。`,
  ...(spec.requiredStudies.length ? [`必需研究区：${spec.requiredStudies.join("、")}。`] : []),
  `身份/空间锁：${spec.identityLock}`,
  `禁止内容：${spec.forbiddenContent.join("、")}。`,
  `【资产事实与生成要求】\n${buildProductionAssetBoardExecutionPrompt(project, board, referenceMode)}`,
  board.variantId
    ? "状态变体板必须让整张板所有视角都处于同一个声明状态；不得出现基础状态小窗、前后对比、变化时间线、其他变体或未来状态。"
    : "canonical 基础板不得混入互斥服装、伤势、损毁、激活或其他状态。",
  "检查所有视角是否属于同一人物/空间/道具，比例、结构、材质、服化道与可识别细节是否一致；检查必需视图是否齐全、清楚、无遮挡、不重复贴图。",
  "以下必须 blocking：输出形态错误、必需主视图或正侧背缺失、身份不一致、空间拓扑矛盾、道具结构改变、variant 混入多个状态。轻微布局或细节清晰度问题可 warning；纯审美偏好只能 advisory。",
  isClean
    ? "纯净参考中新增资料标题、视图编号、标尺文字、色板文字、乱码、水印或工具 UI 应记为 warning；明显影响模型读取时记为 blocking。"
    : "不要因为图片没有长中文标签而扣分；资料名称、色板标签和技术文字由系统确定性叠加。额外的乱码、说明排版、水印或工具 UI 应记录为 warning/blocking。",
  "资产档案或作者要求的铭文、编号、招牌、印刷及屏幕文字是作品内容，必须核对原文与位置，不得因它可读而要求删除。",
  "严格返回 JSON：score(0-100)、verdict(pass/revise)、summary、strengths[]、issues[]。每条 issue 包含 severity(blocking/warning/advisory)、description、suggestion。",
  "issue 的 description 和 suggestion 将用于图片修改，只写可见的画面问题和目标外观，不附带剧情原因、事件先后、项目背景、资料出处或流程说明。",
].join("\n\n");
};

export const buildProductionAssetBoardVisualRepairPrompt = (
  approvedPrompt: string,
  issues: string[],
) => issues.length
  ? `${approvedPrompt}\n\n保持原图中正确的主体外观和版式，只修改以下画面问题：${issues.join("；")}`
  : approvedPrompt;

export const isProductionAssetBoardVisualQualityPassing = (
  quality?: ManualStoryboardAgentQuality,
) => Boolean(
  quality
  && quality.verdict === "pass"
  && quality.score >= PRODUCTION_ASSET_BOARD_VISUAL_QUALITY_THRESHOLD
  && quality.issues.every((item) => item.severity === "advisory"),
);
