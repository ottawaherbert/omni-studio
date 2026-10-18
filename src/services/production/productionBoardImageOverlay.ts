import type {
  ManualStoryboardBoard,
  ManualStoryboardBoardVisualPage,
  Project,
  Scene,
} from "../../types/project";
import type { VideoStoryboardAssetBoardItem } from "./videoStoryboardAssetBoards";
import { STORYBOARD_ARROW_LEGEND } from "./videoStoryboardSystem";

export interface ProductionBoardOverlayLabel {
  id: string;
  label: string;
  color: string;
}

export interface StoryboardBoardOverlaySpec {
  kind: "storyboard_board";
  title: string;
  subtitle: string;
  pageLabel: string;
  columns: number;
  rows: number;
  panels: Array<{
    id: string;
    panelNumber: number;
    row: number;
    column: number;
    note: string;
  }>;
  legend: ProductionBoardOverlayLabel[];
}

export interface AssetBoardOverlaySpec {
  kind: "asset_board";
  title: string;
  subtitle: string;
  sections: string[];
  palette: string[];
}

export interface StoryboardCompositeContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  detected: boolean;
}

interface StoryboardCompositePixelData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const STORYBOARD_VIDEO_REFERENCE_SANITIZER_VERSION = "storyboard-video-reference-sanitizer.v3";

export interface StoryboardVideoReferencePanelCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
}

export interface StoryboardVideoReferenceNumberBadge {
  panelNumber: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface StoryboardShotGridCellRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const buildStoryboardVideoReferencePanelCrops = (
  bounds: Omit<StoryboardCompositeContentBounds, "detected">,
  columns: number,
  rows: number,
): StoryboardVideoReferencePanelCrop[] => {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const cellWidth = bounds.width / safeColumns;
  const cellHeight = bounds.height / safeRows;
  const cropScale = 0.84;
  const horizontalInset = (1 - cropScale) / 2;
  const topInset = 1 - cropScale;
  return Array.from({ length: safeColumns * safeRows }, (_, index) => {
    const column = index % safeColumns;
    const row = Math.floor(index / safeColumns);
    const targetX = bounds.x + column * cellWidth;
    const targetY = bounds.y + row * cellHeight;
    return {
      sourceX: targetX + cellWidth * horizontalInset,
      sourceY: targetY + cellHeight * topInset,
      sourceWidth: cellWidth * cropScale,
      sourceHeight: cellHeight * cropScale,
      targetX,
      targetY,
      targetWidth: cellWidth,
      targetHeight: cellHeight,
    };
  });
};

export const buildStoryboardVideoReferenceNumberBadges = (
  bounds: Omit<StoryboardCompositeContentBounds, "detected">,
  columns: number,
  rows: number,
  panelNumbers: number[],
): StoryboardVideoReferenceNumberBadge[] => {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const cellWidth = bounds.width / safeColumns;
  const cellHeight = bounds.height / safeRows;
  const radius = Math.max(12, Math.min(28, Math.min(cellWidth, cellHeight) * 0.055));
  const inset = Math.max(radius + 8, Math.min(cellWidth, cellHeight) * 0.075);
  return panelNumbers.slice(0, safeColumns * safeRows).map((panelNumber, index) => ({
    panelNumber,
    centerX: bounds.x + ((index % safeColumns) + 1) * cellWidth - inset,
    centerY: bounds.y + Math.floor(index / safeColumns) * cellHeight + inset,
    radius,
  }));
};

const clean = (value: unknown) => String(value || "").trim();

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map(clean).filter(Boolean)));

const parseGrid = (layout: string, panelCount: number) => {
  const match = clean(layout).toLowerCase().replace("×", "x").match(/^(\d+)x(\d+)$/);
  if (match) {
    const columns = Number(match[1]);
    const rows = Number(match[2]);
    if (columns > 0 && rows > 0 && columns * rows >= panelCount) return { columns, rows };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, panelCount))));
  return { columns, rows: Math.max(1, Math.ceil(panelCount / columns)) };
};

/**
 * Produces exactly one visible cell per Shot. A partial final row expands to
 * the full canvas width instead of leaving model-confusing blank cells.
 */
export const buildStoryboardShotGridCellRects = ({
  layout,
  cellCount,
  width,
  height,
}: {
  layout: string;
  cellCount: number;
  width: number;
  height: number;
}): StoryboardShotGridCellRect[] => {
  const count = Math.max(0, Math.floor(cellCount));
  if (!count) return [];
  const grid = parseGrid(layout, count);
  const rowCount = Math.ceil(count / grid.columns);
  const rowHeight = height / rowCount;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / grid.columns);
    const firstIndexInRow = row * grid.columns;
    const cellsInRow = Math.min(grid.columns, count - firstIndexInRow);
    const column = index - firstIndexInRow;
    const cellWidth = width / cellsInRow;
    return {
      index,
      x: column * cellWidth,
      y: row * rowHeight,
      width: cellWidth,
      height: rowHeight,
    };
  });
};

const pixelAt = (image: StoryboardCompositePixelData, x: number, y: number) => {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]] as const;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

const estimateBackground = (image: StoryboardCompositePixelData) => {
  const insetX = Math.max(0, Math.min(image.width - 1, Math.floor(image.width * 0.015)));
  const insetY = Math.max(0, Math.min(image.height - 1, Math.floor(image.height * 0.015)));
  const samples = [
    pixelAt(image, insetX, insetY),
    pixelAt(image, image.width - 1 - insetX, insetY),
    pixelAt(image, insetX, image.height - 1 - insetY),
    pixelAt(image, image.width - 1 - insetX, image.height - 1 - insetY),
    pixelAt(image, Math.floor(image.width / 2), insetY),
    pixelAt(image, Math.floor(image.width / 2), image.height - 1 - insetY),
  ];
  return [
    median(samples.map((sample) => sample[0])),
    median(samples.map((sample) => sample[1])),
    median(samples.map((sample) => sample[2])),
  ] as const;
};

const pixelDistance = (left: readonly number[], right: readonly number[]) => (
  Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2])
);

const findDominantActiveRange = (
  scores: number[],
  groupCount: number,
) => {
  const threshold = Math.max(0.018, Math.min(0.08, 0.055 / Math.max(1, groupCount)));
  const active = scores.map((score) => score >= threshold);
  const gapTolerance = Math.max(6, Math.floor(scores.length / Math.max(12, groupCount * 8)));
  const groups: Array<{ start: number; end: number; score: number; activeCount: number }> = [];
  let cursor = 0;
  while (cursor < active.length) {
    while (cursor < active.length && !active[cursor]) cursor += 1;
    if (cursor >= active.length) break;
    const start = cursor;
    let end = cursor;
    let lastActive = cursor;
    let score = 0;
    let activeCount = 0;
    while (cursor < active.length) {
      if (active[cursor]) {
        lastActive = cursor;
        end = cursor;
        score += scores[cursor];
        activeCount += 1;
      } else if (cursor - lastActive > gapTolerance) {
        break;
      }
      cursor += 1;
    }
    groups.push({ start, end, score, activeCount });
  }
  return groups.sort((left, right) => (
    (right.activeCount + right.score * 4) - (left.activeCount + left.score * 4)
  ))[0];
};

export const detectStoryboardCompositeContentBounds = (
  image: StoryboardCompositePixelData,
  columns: number,
  rows: number,
  fallback: Omit<StoryboardCompositeContentBounds, "detected">,
): StoryboardCompositeContentBounds => {
  if (image.width < 2 || image.height < 2 || image.data.length < image.width * image.height * 4) {
    return { ...fallback, detected: false };
  }
  const background = estimateBackground(image);
  const stepX = Math.max(1, Math.floor(image.width / 420));
  const stepY = Math.max(1, Math.floor(image.height / 260));
  const rowScores = Array.from({ length: image.height }, (_, y) => {
    let active = 0;
    let total = 0;
    for (let x = 0; x < image.width; x += stepX) {
      if (pixelDistance(pixelAt(image, x, y), background) >= 54) active += 1;
      total += 1;
    }
    return total ? active / total : 0;
  });
  const rowRange = findDominantActiveRange(rowScores, rows);
  if (!rowRange) return { ...fallback, detected: false };

  const columnScores = Array.from({ length: image.width }, (_, x) => {
    let active = 0;
    let total = 0;
    for (let y = rowRange.start; y <= rowRange.end; y += stepY) {
      if (pixelDistance(pixelAt(image, x, y), background) >= 54) active += 1;
      total += 1;
    }
    return total ? active / total : 0;
  });
  const columnRange = findDominantActiveRange(columnScores, columns);
  if (!columnRange) return { ...fallback, detected: false };

  const paddingX = Math.max(0, Math.floor(image.width * 0.004));
  const paddingY = Math.max(0, Math.floor(image.height * 0.004));
  const x = Math.max(0, columnRange.start - paddingX);
  const y = Math.max(0, rowRange.start - paddingY);
  const width = Math.min(image.width - x, columnRange.end - columnRange.start + 1 + paddingX * 2);
  const height = Math.min(image.height - y, rowRange.end - rowRange.start + 1 + paddingY * 2);
  if (width < image.width * 0.55 || height < image.height * 0.35) {
    return { ...fallback, detected: false };
  }
  return { x, y, width, height, detected: true };
};

const legendColor = (id: string) => {
  if (id.includes("red")) return "#dc2626";
  if (id.includes("blue")) return "#2563eb";
  if (id.includes("green")) return "#16a34a";
  if (id.includes("orange")) return "#ea580c";
  if (id.includes("purple")) return "#9333ea";
  return "#171717";
};

const legendLabel = (id: string) => {
  if (id === "subject_action_red") return "主体动作";
  if (id === "camera_motion_blue") return "摄影机运动";
  if (id === "eyeline_attention_green") return "视线/注意力";
  if (id === "composition_note_green") return "构图/安全区";
  if (id === "energy_impact_orange") return "能量/冲击";
  if (id === "lighting_direction_orange") return "灯光方向";
  if (id === "sound_emotion_purple") return "声音/情绪";
  if (id === "offscreen_handoff_dashed") return "离屏承接";
  return STORYBOARD_ARROW_LEGEND.find((item) => item.id === id)?.meaning || id;
};

export const buildStoryboardBoardOverlaySpec = ({
  project,
  scene,
  board,
  page,
}: {
  project: Project;
  scene: Scene;
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
}): StoryboardBoardOverlaySpec => {
  const pagePanelIds = new Set(page.panelIds);
  const panels = board.panels.filter((panel) => pagePanelIds.has(panel.id));
  const grid = parseGrid(page.layout, panels.length);
  const durationSeconds = Math.max(
    0,
    Number(board.strategyDecision.expectedVideoUnitDurationSeconds) || 0,
  );
  const shotIds = unique(panels.map((panel) => panel.shotId));
  const legendIds = unique([
    ...board.arrowLegendIds,
    ...panels.flatMap((panel) => [
      ...(panel.annotationLegendIds || []),
      ...(panel.actionArrowLegendIds || []),
    ]),
  ]).filter((id) => id !== "shot_note_black");
  return {
    kind: "storyboard_board",
    title: `${clean(project.title) || "未命名项目"} · ${clean(scene.title) || clean(scene.id)}`,
    subtitle: [
      `视频生成单元 ${clean(board.videoGenerationUnitId) || clean(board.id)}`,
      shotIds.length ? `SHOT ${shotIds.join(" / ")}` : "",
      durationSeconds > 0 ? `${durationSeconds}s` : "",
      clean(board.strategyDecision.selectedStrategyId),
    ].filter(Boolean).join(" · "),
    pageLabel: `第 ${page.pageIndex + 1} / ${page.pageCount} 页 · ${page.layout}`,
    columns: grid.columns,
    rows: grid.rows,
    panels: panels.map((panel, index) => ({
      id: panel.id,
      panelNumber: index + 1,
      row: Math.floor(index / grid.columns),
      column: index % grid.columns,
      note: [
        clean(panel.shotType || panel.framing),
        clean(panel.lens),
        clean(panel.angle),
        panel.durationSeconds ? `${panel.durationSeconds}s` : "",
      ].filter(Boolean).join(" · "),
    })),
    legend: legendIds.map((id) => ({ id, label: legendLabel(id), color: legendColor(id) })),
  };
};

const assetKindLabel: Record<VideoStoryboardAssetBoardItem["boardKind"], string> = {
  character_board: "角色身份板",
  scene_board: "场景空间板",
  prop_board: "道具身份板",
  vehicle_board: "交通工具身份板",
  variant_board: "状态变体板",
};

const resolveAssetBoardPalette = (project: Project) => {
  const v3Palette = unique(project.visualStyleLock?.treatment?.palette || []);
  if (v3Palette.length) return v3Palette;
  return unique([
    ...(project.visualStyleLock?.allowedHex || []),
    ...(project.visualStyleLock?.colorPalette || []),
  ]);
};

export const buildAssetBoardOverlaySpec = ({
  project,
  board,
}: {
  project: Project;
  board: VideoStoryboardAssetBoardItem;
}): AssetBoardOverlaySpec => ({
  kind: "asset_board",
  title: `${board.assetName}${board.variantName ? ` · ${board.variantName}` : ""}`,
  subtitle: `${assetKindLabel[board.boardKind]} · ${clean(project.title) || "未命名项目"}`,
  sections: unique([...board.layoutContract.requiredViews, ...board.layoutContract.requiredStudies]),
  palette: resolveAssetBoardPalette(project).slice(0, 8),
});

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("无法读取待叠加的制作参考板图片。"));
  image.src = url;
});

const fitText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  const value = clean(text);
  if (context.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
};

const setFont = (context: CanvasRenderingContext2D, size: number, weight = 600) => {
  context.font = `${weight} ${Math.max(10, Math.round(size))}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.textBaseline = "middle";
};

const createOverlayCanvas = async (imageUrl: string) => {
  if (typeof document === "undefined") throw new Error("制作参考板确定性排版器只能在浏览器中运行。");
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建制作参考板排版画布。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
};

export const renderStoryboardShotGrid = async ({
  cells,
  layout,
  width = 1920,
  height = 1080,
}: {
  cells: Array<{ imageUrl: string; order: number }>;
  layout: string;
  width?: number;
  height?: number;
}) => {
  if (typeof document === "undefined") throw new Error("纯净分镜宫格排版器只能在浏览器中运行。");
  if (!cells.length) throw new Error("当前视频单元没有可用于宫格的分镜图。");
  if (cells.some((cell) => !cell.imageUrl.trim())) throw new Error("当前视频单元仍有分镜缺少已采用的代表图。");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建纯净分镜宫格画布。");
  context.fillStyle = "#f5f5f3";
  context.fillRect(0, 0, width, height);
  const rects = buildStoryboardShotGridCellRects({ layout, cellCount: cells.length, width, height });
  const images = await Promise.all(cells.map((cell) => loadImage(cell.imageUrl)));
  images.forEach((image, index) => {
    const rect = rects[index];
    // A grid is a reference sheet, not a new crop of the author's composition.
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    context.drawImage(image, rect.x + (rect.width - imageWidth) / 2, rect.y + (rect.height - imageHeight) / 2, imageWidth, imageHeight);
  });
  const scale = width / 1920;
  context.strokeStyle = "rgba(28, 28, 27, 0.9)";
  context.lineWidth = Math.max(1, 2 * scale);
  rects.forEach((rect) => context.strokeRect(rect.x, rect.y, rect.width, rect.height));
  for (const [index, rect] of rects.entries()) {
    const radius = Math.max(12, Math.min(28, Math.min(rect.width, rect.height) * 0.055));
    const inset = Math.max(radius + 8, Math.min(rect.width, rect.height) * 0.075);
    const badge = {
      panelNumber: cells[index].order,
      centerX: rect.x + rect.width - inset,
      centerY: rect.y + inset,
      radius,
    };
    context.beginPath();
    context.arc(badge.centerX, badge.centerY, badge.radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(250, 250, 248, 0.94)";
    context.fill();
    context.strokeStyle = "rgba(28, 28, 27, 0.9)";
    context.lineWidth = Math.max(1, 2 * scale);
    context.stroke();
    setFont(context, badge.radius * 0.95, 700);
    context.fillStyle = "#171717";
    context.textAlign = "center";
    context.fillText(String(badge.panelNumber), badge.centerX, badge.centerY + scale);
  }
  context.textAlign = "left";
  return canvas.toDataURL("image/png");
};

export const renderStoryboardVideoReferenceImage = async (
  imageUrl: string,
  spec: Pick<StoryboardBoardOverlaySpec, "columns" | "rows" | "panels">,
) => {
  const { canvas: sourceCanvas, context: sourceContext } = await createOverlayCanvas(imageUrl);
  const contentBounds = detectStoryboardCompositeContentBounds(
    sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height),
    spec.columns,
    spec.rows,
    { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height },
  );
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建纯净分镜宫格图画布。");

  context.fillStyle = "#f5f5f3";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const crop of buildStoryboardVideoReferencePanelCrops(contentBounds, spec.columns, spec.rows)) {
    context.drawImage(
      sourceCanvas,
      crop.sourceX,
      crop.sourceY,
      crop.sourceWidth,
      crop.sourceHeight,
      crop.targetX,
      crop.targetY,
      crop.targetWidth,
      crop.targetHeight,
    );
  }

  const scale = canvas.width / 1920;
  const cellWidth = contentBounds.width / Math.max(1, spec.columns);
  const cellHeight = contentBounds.height / Math.max(1, spec.rows);
  context.strokeStyle = "rgba(42, 42, 40, 0.72)";
  context.lineWidth = Math.max(1, 2 * scale);
  context.strokeRect(contentBounds.x, contentBounds.y, contentBounds.width, contentBounds.height);
  for (let column = 1; column < spec.columns; column += 1) {
    const x = contentBounds.x + column * cellWidth;
    context.beginPath();
    context.moveTo(x, contentBounds.y);
    context.lineTo(x, contentBounds.y + contentBounds.height);
    context.stroke();
  }
  for (let row = 1; row < spec.rows; row += 1) {
    const y = contentBounds.y + row * cellHeight;
    context.beginPath();
    context.moveTo(contentBounds.x, y);
    context.lineTo(contentBounds.x + contentBounds.width, y);
    context.stroke();
  }

  for (const badge of buildStoryboardVideoReferenceNumberBadges(
    contentBounds,
    spec.columns,
    spec.rows,
    spec.panels.map((panel) => panel.panelNumber),
  )) {
    context.beginPath();
    context.arc(badge.centerX, badge.centerY, badge.radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(250, 250, 248, 0.94)";
    context.fill();
    context.strokeStyle = "rgba(28, 28, 27, 0.9)";
    context.lineWidth = Math.max(1, 2 * scale);
    context.stroke();
    setFont(context, badge.radius * 0.95, 700);
    context.fillStyle = "#171717";
    context.textAlign = "center";
    context.fillText(String(badge.panelNumber), badge.centerX, badge.centerY + scale);
  }
  context.textAlign = "left";
  return canvas.toDataURL("image/png");
};

export const renderStoryboardBoardOverlay = async (
  imageUrl: string,
  spec: StoryboardBoardOverlaySpec,
) => {
  const { canvas, context } = await createOverlayCanvas(imageUrl);
  const scale = canvas.width / 1920;
  const headerHeight = Math.max(74 * scale, canvas.height * 0.085);
  const footerHeight = Math.max(54 * scale, canvas.height * 0.065);
  const fallbackBounds = {
    x: 0,
    y: headerHeight,
    width: canvas.width,
    height: canvas.height - headerHeight - footerHeight,
  };
  const contentBounds = detectStoryboardCompositeContentBounds(
    context.getImageData(0, 0, canvas.width, canvas.height),
    spec.columns,
    spec.rows,
    fallbackBounds,
  );
  const cellWidth = contentBounds.width / spec.columns;
  const cellHeight = contentBounds.height / spec.rows;

  context.fillStyle = "rgba(250, 248, 243, 0.94)";
  context.fillRect(0, 0, canvas.width, headerHeight);
  context.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
  context.strokeStyle = "rgba(82, 68, 53, 0.72)";
  context.lineWidth = Math.max(1, 2 * scale);
  context.beginPath();
  context.moveTo(0, headerHeight);
  context.lineTo(canvas.width, headerHeight);
  context.moveTo(0, canvas.height - footerHeight);
  context.lineTo(canvas.width, canvas.height - footerHeight);
  context.stroke();

  const padding = 28 * scale;
  setFont(context, 28 * scale, 700);
  context.fillStyle = "#201b16";
  context.fillText(fitText(context, spec.title, canvas.width * 0.68), padding, headerHeight * 0.34);
  setFont(context, 16 * scale, 500);
  context.fillStyle = "#5e5145";
  context.fillText(fitText(context, spec.subtitle, canvas.width * 0.76), padding, headerHeight * 0.72);
  setFont(context, 17 * scale, 700);
  context.textAlign = "right";
  context.fillStyle = "#3e342b";
  context.fillText(spec.pageLabel, canvas.width - padding, headerHeight * 0.36);
  context.textAlign = "left";

  spec.panels.forEach((panel) => {
    const x = contentBounds.x + panel.column * cellWidth;
    const y = contentBounds.y + panel.row * cellHeight;
    const badgeX = x + 12 * scale;
    const badgeY = y + 12 * scale;
    const badgeHeight = Math.max(25 * scale, 18);
    const badgeWidth = Math.min(cellWidth - 24 * scale, Math.max(90 * scale, 66));
    context.fillStyle = "rgba(250, 248, 243, 0.92)";
    context.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    context.strokeStyle = "rgba(178, 72, 52, 0.9)";
    context.lineWidth = Math.max(1, 2 * scale);
    context.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);
    setFont(context, 14 * scale, 700);
    context.fillStyle = "#8f2f21";
    context.fillText(`P${String(panel.panelNumber).padStart(2, "0")}`, badgeX + 8 * scale, badgeY + badgeHeight / 2);
    if (panel.note) {
      setFont(context, 12 * scale, 600);
      context.fillStyle = "#302923";
      const noteX = badgeX + badgeWidth + 8 * scale;
      const noteWidth = Math.max(0, cellWidth - badgeWidth - 34 * scale);
      context.fillText(fitText(context, panel.note, noteWidth), noteX, badgeY + badgeHeight / 2);
    }
  });

  const legendY = canvas.height - footerHeight / 2;
  let legendX = padding;
  setFont(context, 13 * scale, 600);
  for (const item of spec.legend) {
    const label = fitText(context, item.label, 180 * scale);
    const itemWidth = context.measureText(label).width + 42 * scale;
    if (legendX + itemWidth > canvas.width - padding) break;
    context.strokeStyle = item.color;
    context.lineWidth = Math.max(2, 5 * scale);
    context.beginPath();
    context.moveTo(legendX, legendY);
    context.lineTo(legendX + 24 * scale, legendY);
    context.stroke();
    context.fillStyle = "#302923";
    context.fillText(label, legendX + 31 * scale, legendY);
    legendX += itemWidth;
  }
  return canvas.toDataURL("image/png");
};

export const renderAssetBoardOverlay = async (
  imageUrl: string,
  spec: AssetBoardOverlaySpec,
) => {
  const { canvas, context } = await createOverlayCanvas(imageUrl);
  const scale = canvas.width / 1920;
  const headerHeight = Math.max(76 * scale, canvas.height * 0.09);
  const footerHeight = Math.max(60 * scale, canvas.height * 0.075);
  const padding = 28 * scale;

  context.fillStyle = "rgba(250, 248, 243, 0.94)";
  context.fillRect(0, 0, canvas.width, headerHeight);
  context.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
  context.strokeStyle = "rgba(82, 68, 53, 0.72)";
  context.lineWidth = Math.max(1, 2 * scale);
  context.strokeRect(0, 0, canvas.width, canvas.height);

  setFont(context, 30 * scale, 700);
  context.fillStyle = "#201b16";
  context.fillText(fitText(context, spec.title, canvas.width * 0.62), padding, headerHeight * 0.42);
  setFont(context, 16 * scale, 600);
  context.textAlign = "right";
  context.fillStyle = "#5e5145";
  context.fillText(fitText(context, spec.subtitle, canvas.width * 0.34), canvas.width - padding, headerHeight * 0.42);
  context.textAlign = "left";

  setFont(context, 13 * scale, 600);
  context.fillStyle = "#302923";
  const sectionText = fitText(context, spec.sections.join(" · "), canvas.width * 0.72);
  context.fillText(sectionText, padding, canvas.height - footerHeight / 2);
  let swatchX = canvas.width - padding;
  for (const color of [...spec.palette].reverse()) {
    const size = Math.max(18, 24 * scale);
    swatchX -= size;
    context.fillStyle = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#d6d0c7";
    context.fillRect(swatchX, canvas.height - footerHeight / 2 - size / 2, size, size);
    context.strokeStyle = "rgba(45, 39, 33, 0.65)";
    context.strokeRect(swatchX, canvas.height - footerHeight / 2 - size / 2, size, size);
    swatchX -= 8 * scale;
  }
  return canvas.toDataURL("image/png");
};
