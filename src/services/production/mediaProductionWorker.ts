import type { AssetIdentityBoard } from "./productionAssetPackage";
import type { AssetReferencePack, StoryboardBoard } from "./videoStoryboardArtifacts";
import { getStoryboardPromptStrategyById } from "./videoStoryboardSystem";

export const MEDIA_PRODUCTION_WORKER_CONTRACT_VERSION = "media-production-worker.v1";
export const MEDIA_PRODUCTION_MAX_CONCURRENCY = 3;
export const MEDIA_PRODUCTION_CIRCUIT_BREAKER_FAILURES = 3;
export const MEDIA_PRODUCTION_DEFAULT_MAX_ATTEMPTS = 3;
export const MEDIA_STORYBOARD_COMPOSITE_WIDTH = 1920;
export const MEDIA_STORYBOARD_COMPOSITE_HEIGHT = 1080;
export const MEDIA_STORYBOARD_TEMPLATE_WIDTH = 1536;
export const MEDIA_STORYBOARD_TEMPLATE_HEIGHT = 1024;
export const MEDIA_STORYBOARD_SOURCE_HEADER_FRACTION = 0.08;
export const MEDIA_STORYBOARD_SOURCE_FOOTER_FRACTION = 0.08;
export const MEDIA_STORYBOARD_SOURCE_VISUAL_FRACTION = 0.76;

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const naturalProductionOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const escapeSvgText = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const truncate = (value: unknown, maxLength: number) => {
  const text = clean(value);
  if (Array.from(text).length <= maxLength) return text;
  return `${Array.from(text).slice(0, Math.max(1, maxLength - 1)).join("")}…`;
};

const sectionValue = (prompt: string, labels: string[]) => {
  const lines = String(prompt || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const label of labels) {
    const line = lines.find((item) => item.startsWith(`【${label}】`));
    if (line) return line.slice(label.length + 2).trim();
  }
  return "";
};

export const normalizeMediaWorkerConcurrency = (value: unknown) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MEDIA_PRODUCTION_MAX_CONCURRENCY, parsed));
};

export const normalizeMediaWorkerMaxAttempts = (value: unknown) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return MEDIA_PRODUCTION_DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.min(10, parsed));
};

export const compareMediaProductionOrder = (left: unknown, right: unknown) =>
  naturalProductionOrder.compare(clean(left), clean(right));

export const evaluateMediaProductionCircuitBreaker = ({
  consecutiveFailures,
  threshold = MEDIA_PRODUCTION_CIRCUIT_BREAKER_FAILURES,
}: {
  consecutiveFailures: number;
  threshold?: number;
}) => ({
  open: Math.max(0, Math.floor(consecutiveFailures)) >= Math.max(1, Math.floor(threshold)),
  reason: Math.max(0, Math.floor(consecutiveFailures)) >= Math.max(1, Math.floor(threshold))
    ? `连续 ${Math.max(0, Math.floor(consecutiveFailures))} 个媒体任务失败，已停止自动调用并转人工检查渠道或输入。`
    : undefined,
});

const assetBoardLayout = (board: AssetIdentityBoard) => {
  if (board.boardKind === "character_board") return "大型英雄全身锚点；正面、侧面、背面全身；头部正侧；3-6个姿态；8格表情；服装、发型、手部、鞋和色板研究。";
  if (board.boardKind === "scene_board") return "大型主空间全景；俯视拓扑；入口出口；主通道与反打方向；3-6个可拍机位；固定陈设、材质、危险区和主光方向。";
  if (board.boardKind === "prop_board") return "大型英雄视角；正面、侧面、背面、顶视和接口；手持比例；材质磨损；可交互部件和尺寸参照。";
  return "只展示当前声明状态的大型主视图、正面、侧面、背面和差异细节；所有视角保持同一状态，禁止前后对比和其他变体。";
};

export const buildAssetBoardMediaPrompt = (board: AssetIdentityBoard) => {
  const prompt = board.prompt || "";
  const style = sectionValue(prompt, ["视觉风格", "风格关键词", "项目风格锁定"])
    || board.styleLockSummary
    || "继承项目已锁定视觉风格";
  const identity = sectionValue(prompt, ["角色外观事实", "可见身份锚点", "基础描述", "变体描述", "主体"]);
  const lock = sectionValue(prompt, ["身份锁定", "空间锁定", "基础身份"]);
  const result = [
    "生成一张单画布、制作级复合资产身份板。不是普通肖像、剧情截图、气氛图或散图拼贴。",
    `资产：${board.assetName}；制作类型：${board.boardKind === "character_board" ? "角色身份板" : board.boardKind === "scene_board" ? "场景身份板" : board.boardKind === "prop_board" ? "道具身份板" : "资产状态变体板"}。`,
    `项目风格：${clean(style)}。`,
    identity ? `身份事实：${clean(identity)}。` : "",
    `版式：${assetBoardLayout(board)}`,
    lock ? `一致性锁：${clean(lock)}。` : "所有区域必须属于同一人物、空间或道具，比例、结构、材质和状态一致。",
    "各研究图清晰分区、不重叠、不裁切关键结构；顶部和底部保留干净信息带。不得生成中文长文字、乱码、水印、品牌、UI或无关人物；系统稍后确定性叠加标题和技术标签。",
  ].filter(Boolean).join("\n");
  return result;
};

const gridForPanelCount = (panelCount: number) => {
  const count = Math.max(1, Math.floor(panelCount));
  if (count <= 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  if (count <= 9) return { columns: 3, rows: 3 };
  if (count <= 12) return { columns: 4, rows: 3 };
  if (count <= 16) return { columns: 4, rows: 4 };
  if (count <= 20) return { columns: 5, rows: 4 };
  return { columns: 6, rows: 4 };
};

export const resolveMediaStoryboardGrid = (board: Pick<StoryboardBoard, "panels">) =>
  gridForPanelCount(board.panels.length);

export const resolveMediaStoryboardCompositeLayout = (board: Pick<StoryboardBoard, "panels">) => {
  const grid = resolveMediaStoryboardGrid(board);
  const headerHeight = 82;
  const margin = 18;
  const gap = 12;
  const availableWidth = MEDIA_STORYBOARD_COMPOSITE_WIDTH - margin * 2 - gap * (grid.columns - 1);
  const availableHeight = MEDIA_STORYBOARD_COMPOSITE_HEIGHT - headerHeight - margin * 2 - gap * (grid.rows - 1);
  const cellWidth = Math.floor(availableWidth / grid.columns);
  const cellHeight = Math.floor(availableHeight / grid.rows);
  const captionHeight = Math.max(54, Math.min(72, Math.floor(cellHeight * 0.2)));
  return {
    ...grid,
    width: MEDIA_STORYBOARD_COMPOSITE_WIDTH,
    height: MEDIA_STORYBOARD_COMPOSITE_HEIGHT,
    headerHeight,
    margin,
    gap,
    cellWidth,
    cellHeight,
    imageHeight: cellHeight - captionHeight,
    captionHeight,
  };
};

export const resolvePanelSourceShotLabel = (
  board: Pick<StoryboardBoard, "shotIds">,
  panel: Pick<StoryboardBoard["panels"][number], "shotId">,
) => {
  const shotId = clean(panel.shotId);
  const numericSuffix = shotId.match(/(?:^|[-_.])shot[-_.]?(\d+)$/i)?.[1]
    || shotId.match(/(?:^|[-_.])(\d+)$/)?.[1];
  if (numericSuffix) return `S${numericSuffix.padStart(2, "0")}`;
  const boardIndex = Math.max(0, board.shotIds.indexOf(shotId));
  return `S${String(boardIndex + 1).padStart(2, "0")}`;
};

const normalizeStoryboardShotSize = (value: unknown) => clean(value).toUpperCase().replace(/[\s_-]+/g, "");

export const resolveMediaStoryboardFramingConstraint = (value: unknown) => {
  const shotSize = normalizeStoryboardShotSize(value);
  if (/^(ECU|XCU|EXTREMECLOSEUP)$/.test(shotSize)) return "极特写：只取眼睛、嘴、手或道具细节，不得扩大到完整头部";
  if (/^(CU|CLOSEUP)$/.test(shotSize)) return "特写：头肩或单一关键道具占画面主体，人物胸部以下不得进入画面";
  if (/^(MCU|MEDIUMCLOSEUP)$/.test(shotSize)) return "中近景：人物胸部以上入画，头顶和肩线留白比例各格一致";
  if (/^(MS|MEDIUMSHOT)$/.test(shotSize)) return "中景：人物腰部以上入画，人物高度约占画面55%-75%";
  if (/^(MWS|MLS|MEDIUMLONGSHOT|COWBOY)$/.test(shotSize)) return "中远景：人物膝部或大腿以上入画，人物高度约占画面45%-65%";
  if (/^(FS|FULLSHOT)$/.test(shotSize)) return "全身景：人物从头到脚完整入画，人物高度约占画面55%-80%";
  if (/^(EWS|ELS|EXTREMEWIDESHOT|EXTREMELONGSHOT)$/.test(shotSize)) return "大远景：环境主导，人物高度不超过画面20%，不得推近人物";
  if (/^(WS|LS|WIDESHOT|LONGSHOT)$/.test(shotSize)) return "远景：环境关系主导，人物全身完整且高度约占画面20%-40%，不得切中景或特写";
  if (/^(INSERT|DETAIL|MACRO)$/.test(shotSize)) return "插入特写：只展示声明的手部、道具或操作细节，不得擅自切回人物全景";
  if (/^(OTS|OVERSHOULDER)$/.test(shotSize)) return "过肩镜头：前景肩部和对方主体占比、视线方向与轴线在同一源镜头内保持一致";
  if (/^(POV|POINTOFVIEW)$/.test(shotSize)) return "主观镜头：保持同一观察者视点、眼高和视野范围，不得反打观察者本人";
  return `${clean(value) || "既定景别"}：严格维持源 Shot 声明的取景范围与主体画面占比`;
};

export const buildMediaStoryboardCameraContract = (
  board: Pick<StoryboardBoard, "shotIds" | "panels">,
) => {
  const groups = new Map<string, StoryboardBoard["panels"]>();
  for (const panel of board.panels) {
    const label = resolvePanelSourceShotLabel(board, panel);
    groups.set(label, [...(groups.get(label) || []), panel]);
  }
  const groupContracts = [...groups.entries()].map(([label, panels]) => {
    const first = panels[0];
    const panelRange = panels.map((panel) => `P${panel.panelNumber}`).join("/");
    const camera = [first.framing || first.shotType, first.lens, first.angle, first.cameraMove]
      .filter(Boolean)
      .join("+");
    return `${label}(${panelRange})=${camera || "源镜头合同"}；${resolveMediaStoryboardFramingConstraint(first.framing || first.shotType)}`;
  });
  const lockedGroups = [...groups.values()].filter((panels) => panels.length > 1);
  const lockRule = lockedGroups.length
    ? "同一S是一个源镜头的时间关键帧：复制相同视锥、地平线、背景边界、主体大小与轴线；只改动作/表演/物证。禁止推近、裁切、换镜位或伪造反打。"
    : "每个S严格服从自己的源镜头合同；只有S编号变化才允许切换机位。";
  return `${lockRule} 摄影合同:${groupContracts.join("；")}`;
};

export const buildMediaStoryboardControlTemplateSvg = (board: Pick<StoryboardBoard, "panels" | "shotIds">) => {
  const grid = resolveMediaStoryboardGrid(board);
  const width = MEDIA_STORYBOARD_TEMPLATE_WIDTH;
  const height = MEDIA_STORYBOARD_TEMPLATE_HEIGHT;
  const sourceTop = Math.floor(height * MEDIA_STORYBOARD_SOURCE_HEADER_FRACTION);
  const sourceBottom = Math.ceil(height * (1 - MEDIA_STORYBOARD_SOURCE_FOOTER_FRACTION));
  const cellWidth = width / grid.columns;
  const cellHeight = (sourceBottom - sourceTop) / grid.rows;
  const visualHeight = cellHeight * MEDIA_STORYBOARD_SOURCE_VISUAL_FRACTION;
  const cells = Array.from({ length: grid.columns * grid.rows }, (_, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const x = column * cellWidth;
    const y = sourceTop + row * cellHeight;
    const panel = board.panels[index];
    const active = Boolean(panel);
    const panelLabel = panel ? `P${panel.panelNumber}` : "";
    const shotLabel = panel ? resolvePanelSourceShotLabel(board, panel) : "";
    const framing = panel ? truncate(panel.framing || panel.shotType || "source framing", 18) : "";
    const labelWidth = Math.min(cellWidth - 24, Math.max(176, cellWidth * 0.58));
    return [
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${active ? "#f7f7f4" : "#d4d4d0"}" stroke="#181818" stroke-width="5"/>`,
      `<rect x="${x + 5}" y="${y + 5}" width="${Math.max(1, cellWidth - 10)}" height="${Math.max(1, visualHeight - 10)}" fill="${active ? "#ffffff" : "#c4c4c0"}"/>`,
      active
        ? [
          `<rect x="${x + 12}" y="${y + 12}" width="${labelWidth}" height="58" rx="4" fill="#171717" opacity="0.92"/>`,
          `<text x="${x + 24}" y="${y + 38}" fill="#ffffff" font-size="24" font-family="Arial, PingFang SC, sans-serif" font-weight="700">${escapeSvgText(`${panelLabel} · ${shotLabel}`)}</text>`,
          `<text x="${x + 24}" y="${y + 60}" fill="#d7d7d2" font-size="16" font-family="Arial, PingFang SC, sans-serif">${escapeSvgText(framing)}</text>`,
        ].join("")
        : `<line x1="${x + 12}" y1="${y + 12}" x2="${x + cellWidth - 12}" y2="${y + cellHeight - 12}" stroke="#999" stroke-width="5"/><line x1="${x + cellWidth - 12}" y1="${y + 12}" x2="${x + 12}" y2="${y + cellHeight - 12}" stroke="#999" stroke-width="5"/>`,
    ].join("");
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#eceae4"/>${cells}</svg>`;
};

export const selectStoryboardReferenceItems = (
  board: Pick<StoryboardBoard, "panels">,
  items: AssetReferencePack["items"] | undefined,
) => {
  const availableItems = Array.isArray(items) ? items : [];
  const boardAssetIds = new Set(board.panels.flatMap((panel) => Array.isArray(panel.assetRefs) ? panel.assetRefs : []).filter(Boolean));
  if (!boardAssetIds.size) return availableItems;
  return availableItems.filter((item) => boardAssetIds.has(item.assetId));
};

export const classifyStoryboardReferenceReadiness = (
  items: AssetReferencePack["items"],
  pendingCandidateKeys: ReadonlySet<string>,
) => {
  const missingRequired = items.filter((item) => item.required && !item.referenceImageUrl);
  const missingWithoutCandidate = missingRequired.filter((item) => (
    !pendingCandidateKeys.has(`${item.assetId}:${item.variantId || ""}`)
  ));
  return {
    status: missingRequired.length === 0
      ? "ready" as const
      : missingWithoutCandidate.length > 0
        ? "missing_asset_reference" as const
        : "awaiting_asset_review" as const,
    missingRequired,
    missingWithoutCandidate,
  };
};

const panelSummary = (
  board: Pick<StoryboardBoard, "shotIds">,
  panel: StoryboardBoard["panels"][number],
  assetLabels: Array<{ assetId: string; assetType: string; name: string }>,
) => {
  const event = clean(panel.visualBeat || panel.subjectAction || panel.framePurpose)
    .replace(/^.*?(?=动作进度\d+%)/u, "");
  const camera = [panel.framing || panel.shotType, panel.lens, panel.angle]
    .filter(Boolean)
    .join("/");
  const panelAssetIds = new Set(Array.isArray(panel.assetRefs) ? panel.assetRefs : []);
  const cast = assetLabels
    .filter((item) => item.assetType === "character" && panelAssetIds.has(item.assetId))
    .map((item) => item.name);
  const castContract = cast.length ? `在场:${cast.join("、")}；` : "";
  return `P${panel.panelNumber}[${resolvePanelSourceShotLabel(board, panel)} ${camera || "按合同"}] ${castContract}${clean(event)}`;
};

export const buildStoryboardBoardMediaPrompt = ({
  projectTitle,
  sceneTitle,
  board,
  assetNames = [],
  assetLabels = [],
}: {
  projectTitle: string;
  sceneTitle: string;
  board: StoryboardBoard;
  assetNames?: string[];
  assetLabels?: Array<{ assetId: string; assetType: string; name: string }>;
}) => {
  const grid = resolveMediaStoryboardGrid(board);
  const cameraContract = buildMediaStoryboardCameraContract(board);
  const strategyNames = [
    getStoryboardPromptStrategyById(board.strategyDecision.selectedStrategyId)?.name,
    ...(board.strategyDecision.strategyResolution?.modifierStrategyIds || [])
      .map((strategyId) => getStoryboardPromptStrategyById(strategyId)?.name),
  ].filter(Boolean);
  const prompt = [
    `编辑首张空白模板，输出单画布${grid.columns}x${grid.rows}电影铅笔故事板，共${board.panels.length}格；不是单格剧照、漫画页或多张图。`,
    `只填P1-P${board.panels.length}；多余叉号格留空。禁止格内再分格、拼贴、文字、编号、字幕、水印或UI。`,
    `按从左到右、从上到下逐格执行，不漏格、不重复、不换序。${clean(cameraContract)}`,
    `身份参考只锁人物/空间/道具，不复制参考图排版。身份:${assetNames.length ? clean(assetNames.join("；")) : "按输入参考锁定"}。`,
    `项目:${clean(projectTitle)}；场次:${clean(sceneTitle)}${strategyNames.length ? `；故事板方法:${clean(strategyNames.join("、"))}` : ""}。`,
    ...board.panels.map((panel) => panelSummary(board, panel, assetLabels)),
    "保持人物身份服装、空间拓扑和道具状态一致。灰度线稿；红箭头=动作，蓝=摄影机，绿=视线，橙=灯光。系统稍后叠加准确标签。",
  ].join("\n");
  return prompt;
};
