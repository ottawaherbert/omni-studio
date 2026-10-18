import { appearanceFields, appearanceSummary } from "./productionAppearance";
import type { AssetVariant, Project } from "../../types/project";
import { assetDesignOwner, assetVisualDescription } from './productionAssetDesign';
import type { VideoStoryboardAssetBoardItem } from "./videoStoryboardAssetBoards";
import { buildProductionAssetVisualStyleProjection } from "./productionAssetVisualStyle";
import {
  resolveProductionAssetReferenceModeSpec,
  type ProductionAssetReferenceMode,
} from "./productionAssetReferenceMode";

export const PRODUCTION_ASSET_BOARD_PLAN_START = "<production-asset-board-execution-plan>";
export const PRODUCTION_ASSET_BOARD_PLAN_END = "</production-asset-board-execution-plan>";

const assetStyleInstruction = (project: Project, board: VideoStoryboardAssetBoardItem) => {
  const { projection, rendered } = buildProductionAssetVisualStyleProjection({ project, asset: board });
  return projection.stylePrompt !== undefined
    ? projection.stylePrompt.trim() ? `【风格提示词】\n${projection.stylePrompt.trim()}` : ""
    : rendered.blocks.filter(block => block.id !== 'visual.artifact' && block.id !== 'visual.directives').map(block => block.content).join('\n\n');
};

/** Upgrade only recognizable boilerplate from our older saved briefs. Do not
 * infer story semantics or rewrite an author's free-form visual description. */
export const visualOnlySavedAssetBrief = (prompt: string) => {
  const legacyPurpose = '，这是供图片与视频生成模型直接读取的无额外说明排版的视觉参考，不是资料海报。';
  if (!prompt.includes(legacyPurpose)) return prompt;
  return prompt.replace(legacyPurpose, '。')
    .replace('生成一张纯净三视图。', '生成一张纯净角色参考图（三视图及上半身身份特写）。')
    .replace(/^视觉继承来源：[^\n]*\n?/m, '')
    .replace('基础身份、结构、比例、材质和空间骨架只从输入参考读取；整张图只表现当前状态，不做前后对比。', '以输入参考图为基础，保留未列出的外观，明确指定的局部变化优先。所有视图呈现同一外观，不做前后对比。')
    .replace('资产档案或作者明确要求的铭文、编号、招牌、印刷内容及屏幕文字属于资产身份，必须保留原文及所在部位，不得按说明文字删除；未声明的文字不得编造。', '保留参考图中以及明确指定的铭文、编号、招牌、印刷内容和屏幕文字，保持原文及所在部位；不添加其他文字。')
    .replaceAll('无关人物、剧情表演或额外资产', '无关人物或物件')
    .replaceAll('展示台、复杂阴影或剧情环境', '展示台、复杂阴影或场景背景')
    .replaceAll('角色、临时可移动道具或剧情动作', '人物或未指定的可移动物件');
};

/** Include the effective asset style in the editable/copyable prompt, including saved clean briefs. */
export const buildProductionAssetBoardPromptPreview = (project: Project, board: VideoStoryboardAssetBoardItem, mode: ProductionAssetReferenceMode) => {
  if (board.variantId && !sourceForBoard(project, board).variant) throw new Error('状态变体已移除，请刷新并复用基础参考。');
  const owner = assetDesignOwner(project, board.assetId);
  const source = board.variantId ? owner?.variants?.find(v => v.id === board.variantId) : owner;
  const saved = mode === "clean_reference" ? source?.cleanReferencePrompt || board.cleanPrompt : source?.boardPrompt;
  const core = saved ? visualOnlySavedAssetBrief(saved) : buildProductionAssetBoardExecutionPrompt(project, board, mode);
  return withProductionAssetBoardStyle(core, project, board);
};

/** Saved layout briefs can predate a profile edit. Refresh only our managed block;
 * preserve the author's brief and give current identity explicit precedence. */
export const withProductionAssetBoardStyle = (prompt: string, project: Project, board: VideoStoryboardAssetBoardItem) => {
  const core = prompt.replace(/\n*【当前角色外观】[\s\S]*?【当前角色外观结束】/g, "").replace(/\n*【当前资产外观】[\s\S]*?【当前资产外观结束】/g, "").trimEnd();
  const identity = assetVisualDescription(assetDesignOwner(project, board.assetId));
  const label = board.assetType === 'character' ? '当前角色外观' : '当前资产外观';
  const currentIdentity = identity && !core.includes(identity)
    ? `【${label}】\n${identity}\n基础外观以本段为准；明确列出的局部变化优先，其余外观保持一致。\n【${label}结束】` : "";
  return [core, currentIdentity, assetStyleInstruction(project, board)].filter(Boolean).join("\n\n");
};

/** The image compiler adds the same style through its audited projection. */
export const productionAssetBoardPromptCore = (prompt: string, project: Project, board: VideoStoryboardAssetBoardItem) => {
  const style = assetStyleInstruction(project, board);
  const text = prompt.trim();
  return style && text.endsWith(style) ? text.slice(0, -style.length).trimEnd() : text;
};

export interface ProductionAssetBoardExecutionItem {
  boardItemId: string;
  assetName: string;
  variantName?: string;
  executionPrompt: string;
}

export interface ProductionAssetBoardExecutionPlan {
  schemaVersion: "production-asset-board-execution-plan.v1";
  items: ProductionAssetBoardExecutionItem[];
}

const addOptionalLine = (lines: string[], label: string, value: unknown) => {
  const normalized = String(value || "").trim();
  if (normalized) lines.push(`${label}${normalized}`);
};

const boardTypeLabel = (board: VideoStoryboardAssetBoardItem) => {
  if (board.variantId) return "状态变体板";
  if (board.assetType === "character") return "角色身份板";
  if (board.assetType === "location") return "场景空间板";
  return "道具身份板";
};

const sourceForBoard = (project: Project, board: VideoStoryboardAssetBoardItem) => {
  if (board.assetType === "character") {
    const character = project.characters.find((item) => item.id === board.assetId);
    return {
      description: assetVisualDescription(character),
      variant: character?.variants?.find((item) => item.id === board.variantId),
    };
  }
  const asset = project.assets.find((item) => item.id === board.assetId);
  return {
    description: assetVisualDescription(asset),
    variant: asset?.variants?.find((item) => item.id === board.variantId),
  };
};

/** A list label is never a visual instruction. Auto-generated summary wrappers
 * add no new information; distinct author additions remain intact. */
export const assetVariantVisualInstructions = (variant: AssetVariant, parent?: AssetVariant) => {
  const fields = appearanceFields(variant.appearanceFields);
  const summary = appearanceSummary(fields);
  const description = variant.description?.trim() || '';
  const automatic = Object.keys(fields).length && description === summary;
  const changes = automatic && parent?.appearanceFields
    ? Object.fromEntries(Object.entries(fields).filter(([key, value]) => parent.appearanceFields?.[key as keyof typeof fields] !== value)) : fields;
  const visual = automatic ? Object.keys(changes).length ? appearanceSummary(changes) : '' : description || (Object.keys(fields).length ? summary : variant.name);
  const modifiers = variant.promptModifiers?.trim() || '';
  const generatedModifiers = `保持人物身份、基本长相和未指定部位不变。当前完整可见状态：${summary}。`;
  return [visual, modifiers && modifiers !== generatedModifiers && modifiers !== description && modifiers !== visual ? modifiers : ''].filter(Boolean).join('\n');
};

const variantInstructions = (project: Project, board: VideoStoryboardAssetBoardItem, variant: AssetVariant) => {
  const owner = board.assetType === 'character' ? project.characters.find(c => c.id === board.assetId) : project.assets.find(a => a.id === board.assetId);
  return assetVariantVisualInstructions(variant, owner?.variants?.find(v => v.id === variant.referenceVariantId));
};

const layoutInstruction = (board: VideoStoryboardAssetBoardItem) => {
  const contract = board.layoutContract;
  return [
    "输出一张复合参考图，各视图清楚分区。",
    `必需视图：${contract.requiredViews.join("、")}。`,
    `研究区：${contract.requiredStudies.join("、")}。`,
    `禁止：${contract.forbiddenContent.join("、")}。`,
  ].join("\n");
};

const identityInstruction = (board: VideoStoryboardAssetBoardItem) => {
  return `身份/空间锁：${board.layoutContract.identityLock}`;
};

const singleAssetInstruction = (board: VideoStoryboardAssetBoardItem) => {
  if (board.assetType === "character") {
    return "单资产规则：画面里只能出现当前角色；多视角和表情必须仍是同一角色，不得加入其他人物、动物、手持道具或场景背景。全图保持指定的绘画或摄影风格。";
  }
  if (board.assetType === "location") {
    return "单资产规则：画面里只能研究当前同一个空场景；固定装修和固有家具可以保留，但不得加入角色，也不得把可移动道具另做英雄视图或研究分区。";
  }
  return "单资产规则：画面里只能出现当前一个道具及其多视角、细节或状态；不得加入角色、其他道具、场景背景或额外比例参照物。";
};

export const buildProductionAssetBoardExecutionPrompt = (
  project: Project,
  board: VideoStoryboardAssetBoardItem,
  referenceMode: ProductionAssetReferenceMode = "production_board",
) => {
  const source = sourceForBoard(project, board);
  if (board.variantId && !source.variant) throw new Error('状态变体已移除，请刷新并复用基础参考。');
  if (referenceMode === "clean_reference") {
    const spec = resolveProductionAssetReferenceModeSpec(board, referenceMode);
    const lines = [
      `生成一张${board.assetType === "character" ? "纯净角色参考图（三视图及上半身身份特写）" : spec.label}。`,
      `主体：${board.assetName}。`,
    ];
    if (board.variantId) {
      lines.push("以输入参考为基础，只改变下方明确列出的外观；未列出的身份特征、部位和物件保持一致。指定变化优先于参考图中的旧状态。所有视图呈现下述同一外观，不做前后对比。");
    } else {
      addOptionalLine(lines, board.assetType === "location" ? "空间与材质：" : "稳定可见身份：", source.description);
    }
    if (source.variant) {
      addOptionalLine(lines, "本次外观变化：", variantInstructions(project, board, source.variant));
    }
    lines.push(
      `纯净画面要求：${spec.compositionInstruction}`,
      `必需视图：${spec.requiredViews.join("、")}。`,
      `一致性锁：${spec.identityLock}`,
      `绝对禁止：${spec.forbiddenContent.join("、")}。`,
      "画面必须保持中性、清晰、无遮挡和足够留白；不添加标题栏、页脚、注释区、标尺区或色板区。保留参考图中以及明确指定的铭文、编号、招牌、印刷内容和屏幕文字，保持原文及所在部位；不添加其他文字。",
    );
    return lines.join("\n");
  }
  const lines = [
    `生成一张${boardTypeLabel(board)}。`,
    `主体：${board.assetName}。`,
  ];
  if (board.variantId) {
    lines.push("以输入的继承参考板为基础，只改变下方明确列出的外观；未列出的特征保持一致，指定变化优先于参考图中的旧状态。不得把参考板作为另一状态画进成品。");
  } else {
    addOptionalLine(lines, "基础身份/空间/材质：", source.description);
  }
  if (source.variant) {
    addOptionalLine(lines, "本次外观变化：", variantInstructions(project, board, source.variant));
  }
  if (board.variantId) {
    lines.push("所有视图保持同一外观，不排列多种造型，不做前后对比。");
  }
  lines.push(
    layoutInstruction(board),
    identityInstruction(board),
    singleAssetInstruction(board),
    "画面使用干净中性背景，不添加无关人物、品牌、说明文字、标签、水印或界面元素；各分区清楚分离，多视角不得重叠或重复贴图。保留参考图中以及明确指定的铭文、编号、招牌、印刷内容和屏幕文字，保持原文及所在部位。",
  );
  return lines.join("\n");
};

export const buildProductionAssetBoardExecutionPlan = (
  project: Project,
  boards: VideoStoryboardAssetBoardItem[],
): ProductionAssetBoardExecutionPlan => ({
  schemaVersion: "production-asset-board-execution-plan.v1",
  items: boards.map((board) => ({
    boardItemId: board.id,
    assetName: board.assetName,
    variantName: board.variantName,
    executionPrompt: productionAssetBoardPromptCore(buildProductionAssetBoardPromptPreview(project, board, 'production_board'), project, board),
  })),
});

export const serializeProductionAssetBoardExecutionPlan = (
  plan: ProductionAssetBoardExecutionPlan,
) => `${PRODUCTION_ASSET_BOARD_PLAN_START}\n${JSON.stringify(plan, null, 2)}\n${PRODUCTION_ASSET_BOARD_PLAN_END}`;

export const parseProductionAssetBoardExecutionPlan = (
  finalPrompt: string,
  expectedBoardItemIds: string[],
) => {
  const start = finalPrompt.indexOf(PRODUCTION_ASSET_BOARD_PLAN_START);
  const end = finalPrompt.indexOf(PRODUCTION_ASSET_BOARD_PLAN_END, start + PRODUCTION_ASSET_BOARD_PLAN_START.length);
  if (start < 0 || end < 0) throw new Error("确认提示词缺少资产板执行计划，未开始生成。");
  const json = finalPrompt.slice(start + PRODUCTION_ASSET_BOARD_PLAN_START.length, end).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("资产板执行计划不是有效 JSON，请修正确认窗中的计划后重试。");
  }
  const source = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  if (source.schemaVersion !== "production-asset-board-execution-plan.v1" || !Array.isArray(source.items)) {
    throw new Error("资产板执行计划版本或 items 结构无效，未开始生成。");
  }
  const items = source.items.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const boardItemId = String(record.boardItemId || "").trim();
    const executionPrompt = String(record.executionPrompt || "").trim();
    if (!boardItemId || !executionPrompt) throw new Error("资产板执行计划存在空的 boardItemId 或 executionPrompt。");
    return {
      boardItemId,
      assetName: String(record.assetName || "").trim(),
      variantName: String(record.variantName || "").trim() || undefined,
      executionPrompt,
    } satisfies ProductionAssetBoardExecutionItem;
  });
  const expectedIds = new Set(expectedBoardItemIds);
  const actualIds = new Set(items.map((item) => item.boardItemId));
  if (actualIds.size !== items.length) throw new Error("资产板执行计划包含重复的 boardItemId。");
  if (expectedIds.size !== actualIds.size || expectedBoardItemIds.some((id) => !actualIds.has(id))) {
    throw new Error("资产板执行计划与当前待生成清单不一致，请关闭确认窗后重新打开。");
  }
  return {
    schemaVersion: "production-asset-board-execution-plan.v1",
    items,
  } satisfies ProductionAssetBoardExecutionPlan;
};
