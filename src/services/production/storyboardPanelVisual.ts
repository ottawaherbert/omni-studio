import type {
  ManualStoryboardAgentQuality,
  ManualStoryboardBoard,
  ManualStoryboardBoardPanel,
  ManualStoryboardPanelVisualTake,
  Project,
  Scene,
  Shot,
} from "../../types/project";
import type {
  ManualProductionAssetBoard,
  ManualProductionAssetReadModel,
} from "./manualProductionAssets";
import { manualStoryboardHash } from "./manualStoryboard";
import { resolveVisualStyleLock } from "./visualStyleLock";

export const STORYBOARD_PANEL_VISUAL_CONTRACT_VERSION = "storyboard-panel-visual.v6";
export const STORYBOARD_PANEL_VISUAL_MAX_REFERENCES = 5;
export const STORYBOARD_PANEL_VISUAL_MAX_REPAIRS = 2;
export const STORYBOARD_PANEL_VISUAL_QUALITY_THRESHOLD = 90;
export const STORYBOARD_PANEL_VISUAL_ASPECT_RATIO_TOLERANCE = 0.2;

export interface StoryboardPanelVisualReferenceSelection {
  selected: ManualProductionAssetBoard[];
  omitted: ManualProductionAssetBoard[];
  missingAssetIds: string[];
  styleAnchor?: {
    panelId: string;
    takeId: string;
    imageUrl: string;
  };
}

export const isStoryboardPanelAspectRatioCompatible = ({
  width,
  height,
  targetAspectRatio,
  tolerance = STORYBOARD_PANEL_VISUAL_ASPECT_RATIO_TOLERANCE,
}: {
  width: number;
  height: number;
  targetAspectRatio: string;
  tolerance?: number;
}) => {
  if (!(width > 0) || !(height > 0)) return false;
  const ratioParts = String(targetAspectRatio || "16:9").split(":").map(Number);
  if (ratioParts.length !== 2 || !(ratioParts[0] > 0) || !(ratioParts[1] > 0)) return true;
  const expectedRatio = ratioParts[0] / ratioParts[1];
  const actualRatio = width / height;
  const expectedOrientation = Math.sign(expectedRatio - 1);
  const actualOrientation = Math.sign(actualRatio - 1);
  if (expectedOrientation !== actualOrientation) return false;
  return Math.abs(actualRatio - expectedRatio) / expectedRatio <= tolerance;
};

const panelStructure = (panel: ManualStoryboardBoardPanel) => ({
  id: panel.id,
  panelNumber: panel.panelNumber,
  shotId: panel.shotId,
  durationSeconds: panel.durationSeconds || 0,
  framePurpose: panel.framePurpose,
  shotType: panel.shotType || "",
  visualBeat: panel.visualBeat || "",
  cameraNote: panel.cameraNote || "",
  framing: panel.framing || "",
  lens: panel.lens || "",
  angle: panel.angle || "",
  cameraMove: panel.cameraMove || "",
  subjectAction: panel.subjectAction || "",
  blocking: panel.blocking || "",
  lightingCue: panel.lightingCue || "",
  emotionCue: panel.emotionCue || "",
  compositionNote: panel.compositionNote || "",
  continuityIn: panel.continuityIn || "",
  continuityOut: panel.continuityOut || "",
  assetRefs: panel.assetRefs,
  renderInstruction: panel.renderInstruction || "",
});

const panelPromptStructure = (panel: ManualStoryboardBoardPanel) => ({
  panelNumber: panel.panelNumber,
  durationSeconds: panel.durationSeconds || 0,
  framePurpose: panel.framePurpose,
  shotType: panel.shotType || "",
  visualBeat: panel.visualBeat || "",
  cameraNote: panel.cameraNote || "",
  framing: panel.framing || "",
  lens: panel.lens || "",
  angle: panel.angle || "",
  cameraMove: panel.cameraMove || "",
  subjectAction: panel.subjectAction || "",
  blocking: panel.blocking || "",
  lightingCue: panel.lightingCue || "",
  emotionCue: panel.emotionCue || "",
  compositionNote: panel.compositionNote || "",
  continuityIn: panel.continuityIn || "",
  continuityOut: panel.continuityOut || "",
  renderInstruction: panel.renderInstruction || "",
});

export const buildStoryboardPanelVisualSourceHash = ({
  storyboardSourceHash,
  boardOutputHash,
  panel,
  project,
  references,
  styleAnchor,
  imagePrompt,
}: {
  storyboardSourceHash: string;
  boardOutputHash: string;
  panel: ManualStoryboardBoardPanel;
  project?: Project;
  references?: ManualProductionAssetBoard[];
  styleAnchor?: StoryboardPanelVisualReferenceSelection["styleAnchor"];
  imagePrompt?: string;
}) => manualStoryboardHash({
  contractVersion: STORYBOARD_PANEL_VISUAL_CONTRACT_VERSION,
  storyboardSourceHash,
  boardOutputHash,
  panel: panelStructure(panel),
  imagePrompt: imagePrompt || "",
  projectVisualContract: project ? {
    aspectRatio: project.aspectRatio || "16:9",
    visualStyleLock: project.visualStyleLock || null,
    creativeVisualStyle: project.creativeVision?.visualStyle || "",
  } : null,
  references: references?.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    promptHash: item.promptHash,
    referenceImageUrl: item.referenceImageUrl || "",
  })) || null,
  styleAnchor: styleAnchor || null,
});

export const getActiveStoryboardPanelVisualTake = (panel: ManualStoryboardBoardPanel) =>
  panel.visualTakes?.find((take) => take.id === panel.activeVisualTakeId);

export const getLatestStoryboardPanelVisualCandidate = (
  panel: ManualStoryboardBoardPanel,
  sourceHash?: string,
) => [...(panel.visualTakes || [])]
  .reverse()
  .find((take) => take.status === "candidate" && (!sourceHash || take.sourceHash === sourceHash));

export const isStoryboardPanelVisualQualityPassing = (quality?: ManualStoryboardAgentQuality) => Boolean(
  quality
  && quality.verdict === "pass"
  && quality.score >= STORYBOARD_PANEL_VISUAL_QUALITY_THRESHOLD
  && !quality.issues.some((issue) => issue.severity === "blocking"),
);

export const isStoryboardPanelVisualTakeApproved = (take?: ManualStoryboardPanelVisualTake) => Boolean(
  take
  && (
    (take.review?.mode === "manual" && take.review.status === "approved")
    || isStoryboardPanelVisualQualityPassing(take.quality)
  ),
);

export const getStoryboardSceneVisualStyleAnchor = (
  scene: Scene,
  excludePanelId?: string,
): StoryboardPanelVisualReferenceSelection["styleAnchor"] => {
  for (const workflow of scene.manualStoryboard?.boards || []) {
    if (workflow.unitSchema !== "storyboard_unit.v1") continue;
    for (const panel of workflow.board?.panels || []) {
      const take = getActiveStoryboardPanelVisualTake(panel);
      if (take?.imageUrl && take.status === "adopted" && isStoryboardPanelVisualTakeApproved(take)) {
        if (panel.id === excludePanelId) return undefined;
        return { panelId: panel.id, takeId: take.id, imageUrl: take.imageUrl };
      }
    }
  }
  return undefined;
};

export const isStoryboardPanelVisualReady = ({
  panel,
  sourceHash,
}: {
  panel: ManualStoryboardBoardPanel;
  sourceHash: string;
}) => {
  const take = getActiveStoryboardPanelVisualTake(panel);
  return Boolean(
    take
    && take.status === "adopted"
    && take.sourceHash === sourceHash
    && isStoryboardPanelVisualTakeApproved(take),
  );
};

export const selectStoryboardPanelVisualReferences = ({
  panel,
  shot,
  assets,
  scene,
  maxReferences = STORYBOARD_PANEL_VISUAL_MAX_REFERENCES,
}: {
  panel: ManualStoryboardBoardPanel;
  shot: Shot;
  assets: ManualProductionAssetReadModel;
  scene?: Scene;
  maxReferences?: number;
}): StoryboardPanelVisualReferenceSelection => {
  const requestedAssetIds = Array.from(new Set((panel.assetRefs.length
    ? panel.assetRefs
    : [...(shot.characterIdsInShot || []), shot.locationId, ...(shot.propIds || [])]
  ).filter(Boolean) as string[]));
  const groups: ManualProductionAssetBoard[][] = [];
  const missingAssetIds: string[] = [];

  for (const assetId of requestedAssetIds) {
    const matches = assets.assetBoards
      .filter((board) => board.assetId === assetId && board.referenceImageUrl)
      .sort((left, right) => Number(Boolean(right.variantId)) - Number(Boolean(left.variantId)));
    if (!matches.length) missingAssetIds.push(assetId);
    if (matches.length) groups.push(matches);
  }

  const coverageFirst = [
    ...groups.map((matches) => matches[0]),
    ...groups.flatMap((matches) => matches.slice(1)),
  ];
  const deduped = coverageFirst.filter((board, index, list) =>
    list.findIndex((candidate) => candidate.referenceImageUrl === board.referenceImageUrl) === index,
  );
  const styleAnchor = requestedAssetIds.length < maxReferences
    ? (scene ? getStoryboardSceneVisualStyleAnchor(scene, panel.id) : undefined)
    : undefined;
  const assetLimit = Math.max(1, maxReferences - Number(Boolean(styleAnchor)));
  return {
    selected: deduped.slice(0, assetLimit),
    omitted: deduped.slice(assetLimit),
    missingAssetIds,
    styleAnchor,
  };
};

const appendPromptSegment = (segments: string[], value: string) => {
  const next = value.trim();
  if (!next) return;
  segments.push(next);
};

export const buildStoryboardPanelControlStyleContract = ({
  project,
  board,
}: {
  project: Project;
  board: ManualStoryboardBoard;
}) => {
  const styleLock = resolveVisualStyleLock(project);
  const explicitStoryboardStyle = [
    styleLock.storyboardStylePolicy,
    styleLock.linework.length ? `线条：${styleLock.linework.join("、")}` : "",
    styleLock.sketchDensity ? `草图密度：${styleLock.sketchDensity}` : "",
    styleLock.strokeWeight ? `线条粗细：${styleLock.strokeWeight}` : "",
    styleLock.finishLevel ? `完成度：${styleLock.finishLevel}` : "",
    styleLock.boardAnnotationPolicy,
  ].filter(Boolean).join("；");
  const mediumContract = explicitStoryboardStyle
    || "使用线稿故事板能力槽的统一控制图媒介，保持同一线条、灰度底色、草图密度和完成度";
  return [
    "产物是单格电影制作故事板控制图，不是照片、最终成片帧或概念效果图",
    mediumContract,
    "项目最终视觉风格只转译为构图、光线、色温和情绪，不得把正式资产参考板的照片渲染方式复制成故事板画风",
    "正式参考板是人物身份、性别、年龄、脸、发型、服装、场景拓扑、道具形态与状态的硬约束，优先于风格锚点；风格锚点不得覆盖这些事实；全部 panel 必须保持同一绘制语言",
    "正式角色板定义的辨识标记所在部位一旦入画就必须清楚保留，例如固定耳饰、疤痕、痣、发型和服装细节，不得因景别或故事板媒介省略",
    "道具的位置、持有者、开合、显影和损伤状态只能按结构化动作与连续性改变；未明确拿起、放下、交接或开启时必须保持原状态，禁止因对白、视线或构图提及而把道具塞进人物手中、复制或迁移",
    "legend 只定义运动箭头颜色，不代表必须画标注；只有结构化主体动作或摄影机运动明确存在可见运动时才画对应箭头，静态或“无”必须完全无箭头",
    "禁止额外的局部放大框、圆形插图、引线、定位点、指物箭头和图例文字；道具细节只用景别、焦点、光线与构图强调；不添加工具界面、水印或拼贴边框。剧本或作者要求的画内文字、字幕及屏幕内容必须按原文保留",
  ].join("；");
};

export const buildStoryboardPanelVisualPrompt = ({
  project,
  shot,
  board,
  panel,
  references,
  styleAnchor,
  repairIssues = [],
}: {
  project: Project;
  shot: Shot;
  board: ManualStoryboardBoard;
  panel: ManualStoryboardBoardPanel;
  references: ManualProductionAssetBoard[];
  styleAnchor?: StoryboardPanelVisualReferenceSelection["styleAnchor"];
  repairIssues?: string[];
}) => {
  const segments: string[] = [];
  appendPromptSegment(segments, buildStoryboardPanelControlStyleContract({ project, board }));
  appendPromptSegment(segments, `画格目的：${panel.framePurpose}`);
  appendPromptSegment(segments, `已确认图片提示词：${shot.imagePrompt || ""}`);
  appendPromptSegment(segments, `画面变化：${panel.visualBeat || panel.subjectAction || board.startState}`);
  appendPromptSegment(segments, `摄影：${[shot.shotSize, shot.cameraAngle, shot.focalLength, panel.framing, panel.angle, panel.lens, panel.cameraNote].filter(Boolean).join("，")}`);
  appendPromptSegment(segments, `调度与动作：${[panel.subjectAction, panel.blocking, shot.blocking].filter(Boolean).join("，")}`);
  appendPromptSegment(segments, `光线与情绪：${[panel.lightingCue, shot.lightingAtmo, panel.emotionCue].filter(Boolean).join("，")}`);
  appendPromptSegment(segments, `连续性：${[panel.continuityIn, panel.continuityOut, shot.continuityNote].filter(Boolean).join("，")}`);
  const projectLook = project.visualStyleLock
    ? resolveVisualStyleLock(project).summary
    : project.creativeVision?.visualStyle;
  if (projectLook) appendPromptSegment(segments, `项目最终影像方向：${projectLook}`);
  appendPromptSegment(segments, "渲染转换规则：renderInstruction 中的制作说明、镜号、焦距和时长不画进场景；剧本或作者要求的招牌、信件、屏幕数字等画内文字必须保留原文，不得仅因带引号或包含数字而删除");
  appendPromptSegment(segments, `渲染要求：${panel.renderInstruction || "只落实本画格已确认的动作、构图、光线和连续性"}`);
  if (repairIssues.length) appendPromptSegment(segments, `本轮必须修复：${repairIssues.join("；")}`);
  return segments.join("；");
};

export const buildStoryboardPanelVisualQAPrompt = ({
  project,
  shot,
  panel,
  references,
  styleAnchor,
}: {
  project: Project;
  shot: Shot;
  panel: ManualStoryboardBoardPanel;
  references: ManualProductionAssetBoard[];
  styleAnchor?: StoryboardPanelVisualReferenceSelection["styleAnchor"];
}) => `你是独立的电影视觉故事板质检总监。输入图片第 1 张是待检故事板画格；随后是正式角色板、场景板、道具板或状态变体板；若存在故事板风格锚点，它位于最后 1 张。

必须检查真实图片，不得只检查文字：
1. 图片可读、非空白，输出方向与当前项目的结构化目标画幅一致；
2. 人物身份、脸、体型、服装、妆发与正式参考一致；
3. 场景空间、灯光、道具形态、归属和状态变体一致；
4. 落实来源 Shot 的景别、机位、构图、动作、屏幕方向和连续性；
5. 落实 panel 的画格目的和可见变化；
6. 不得出现额外人物、道具、工具界面、水印、拼贴错误或明显生成缺陷；剧本或作者要求的画内文字、字幕及屏幕内容必须保留原文，不得当成杂字要求删除。

【Shot】${JSON.stringify({ shotSize: shot.shotSize, cameraAngle: shot.cameraAngle, composition: shot.composition, blocking: shot.blocking, visualAction: shot.visualAction, continuityNote: shot.continuityNote })}
【Panel】${JSON.stringify(panelPromptStructure(panel))}
${styleAnchor ? `【输入图${references.length + 2}职责】故事板绘制风格锚点；只检查线条、灰度底色和标记语言一致性，不复制内容。` : ""}
【正式参考职责】${JSON.stringify(references.map((item, index) => ({ imageIndex: index + 2, name: item.assetName, variant: item.variantName || "", duty: item.assetType === "character" ? "核对角色身份与服装状态" : item.assetType === "location" ? "核对场景布局、固定陈设与材质" : "核对道具几何、比例与材质" })))}

严格返回 JSON：score(0-100)、verdict(pass/revise)、summary、strengths[]、issues[]。issues 每项包含 severity(blocking/warning/advisory)、description、suggestion。存在身份漂移、状态错误、缺失主体、错误构图、额外主体或图片不可用时必须 revise。`;

export const adoptStoryboardPanelVisualTake = ({
  panel,
  take,
  adoptedAt = Date.now(),
}: {
  panel: ManualStoryboardBoardPanel;
  take: ManualStoryboardPanelVisualTake;
  adoptedAt?: number;
}): ManualStoryboardBoardPanel => ({
  ...panel,
  visualTakes: [
    ...(panel.visualTakes || [])
      .filter((item) => item.id !== take.id)
      .map((item) => item.status === "adopted" ? { ...item, status: "rejected" as const } : item),
    { ...take, status: "adopted" as const, adoptedAt },
  ].slice(-8),
  activeVisualTakeId: take.id,
});

export const approveStoryboardPanelVisualTake = ({
  panel,
  takeId,
  reviewedAt = Date.now(),
}: {
  panel: ManualStoryboardBoardPanel;
  takeId: string;
  reviewedAt?: number;
}) => {
  const take = panel.visualTakes?.find((item) => item.id === takeId);
  if (!take || take.status !== "candidate") throw new Error("待采用的故事板候选画格不存在。");
  return adoptStoryboardPanelVisualTake({
    panel,
    adoptedAt: reviewedAt,
    take: {
      ...take,
      review: {
        mode: "manual",
        status: "approved",
        reviewer: "creator",
        reviewedAt,
      },
    },
  });
};
