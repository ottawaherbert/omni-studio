import { defaultTemplates } from "../../../../../src/config/prompts";
import type { Project, Scene } from "../../../../../src/types/project";
import type { StoryboardBoard, StoryboardBoardPanel } from "./videoStoryboardArtifacts";
import { renderStoryboardDepartmentPrepRefNotes } from "./videoStoryboardDepartmentRefs";
import type { StoryboardStrategyDraft } from "./storyboardStrategyDraft";
import { createStoryboardPromptStrategyFromDraft } from "./storyboardStrategyDraft";
import {
  buildStoryboardRhythmTrack,
  buildStoryboardRhythmTrackSystem,
  renderStoryboardRhythmTrack,
  shouldRenderStoryboardRhythmTrack,
  validateStoryboardRhythmTrack,
  type StoryboardRhythmTrack,
} from "./storyboardRhythmTrack";
import {
  getStoryboardPromptStrategyById,
  STORYBOARD_ARROW_LEGEND,
  type StoryboardBoardMode,
  type StoryboardPromptStrategy,
} from "./videoStoryboardSystem";
import { resolveVisualStyleLock } from "./visualStyleLock";

export interface StoryboardTemplateRenderInput {
  project: Project;
  scene: Scene;
  board: StoryboardBoard;
  strategy?: StoryboardPromptStrategy;
  strategyDraft?: StoryboardStrategyDraft;
  fallbackStrategy?: StoryboardPromptStrategy;
}

export interface StoryboardTemplateRenderResult {
  schemaVersion: "storyboard-template-render.v1";
  boardId: string;
  strategyId: string;
  strategyVersion: string;
  modifierStrategyIds: string[];
  strategyOrigin: StoryboardBoard["strategyOrigin"];
  templateId: string;
  boardMode: StoryboardBoardMode;
  rhythmTrack?: StoryboardRhythmTrack;
  prompt: string;
  boardContext: string;
  promptSections: {
    styleLock: string;
    strategy: string;
    scene: string;
    departments: string;
    legend: string;
    rhythmTrack: string;
    panels: string;
    renderRules: string;
  };
  warnings: string[];
}

const clean = (value: unknown) => String(value || "").trim();

const unique = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));

const templateText = (templateId: string) => clean((defaultTemplates as Record<string, { template?: string } | undefined>)[templateId]?.template);

const replaceTemplateVariables = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template);

const compactLine = (...items: unknown[]) =>
  items.map(clean).filter(Boolean).join(" / ");

const resolveStrategy = (
  input: StoryboardTemplateRenderInput,
): { strategy: StoryboardPromptStrategy; warnings: string[] } => {
  const warnings: string[] = [];
  if (input.strategyDraft) {
    return { strategy: createStoryboardPromptStrategyFromDraft(input.strategyDraft), warnings };
  }
  if (input.strategy) return { strategy: input.strategy, warnings };
  const fromDecision = getStoryboardPromptStrategyById(input.board.strategyDecision.selectedStrategyId);
  if (fromDecision) return { strategy: fromDecision, warnings };
  const fallback = input.fallbackStrategy ||
    getStoryboardPromptStrategyById(input.strategyDraft?.fallbackStrategyId || "") ||
    getStoryboardPromptStrategyById("storyboard.multi_shot_narrative.v1");
  if (!fallback) {
    throw new Error(`No storyboard strategy available for board ${input.board.id}`);
  }
  warnings.push(`Unknown selected strategy ${input.board.strategyDecision.selectedStrategyId}; rendered with ${fallback.id}.`);
  return { strategy: fallback, warnings };
};

const renderLegend = (legendIds: string[]) => {
  const ids = unique(legendIds);
  const entries = ids
    .map((id) => STORYBOARD_ARROW_LEGEND.find((item) => item.id === id))
    .filter((entry): entry is (typeof STORYBOARD_ARROW_LEGEND)[number] => Boolean(entry) && entry!.id !== "shot_note_black")
    .map((entry) => `${entry.marker} = ${entry.meaning}`);
  return entries.length
    ? entries.join("\n")
    : "红色实线箭头表示主体动作；蓝色实线箭头表示摄影机或画框运动。";
};

const renderPanel = (panel: StoryboardBoardPanel) => [
  `P${panel.panelNumber} / ${compactLine(panel.shotType, panel.framing, panel.lens, panel.angle, panel.durationBeat || `${panel.durationSeconds || ""}s`)}`,
  clean(panel.framePurpose) ? `目的：${clean(panel.framePurpose)}` : "",
  clean(panel.subjectAction || panel.visualBeat || panel.bodyMotion) ? `主体动作：${clean(panel.subjectAction || panel.visualBeat || panel.bodyMotion)}` : "",
  clean(panel.cameraMove || panel.cameraNote) ? `镜头：${clean(panel.cameraMove || panel.cameraNote)}` : "",
  clean(panel.lightingCue) ? `灯光：${panel.lightingCue}` : "",
  clean(panel.soundCue || panel.dialogueOrSoundCue) ? `声音/台词：${clean(panel.soundCue || panel.dialogueOrSoundCue)}` : "",
  clean(panel.emotionCue) ? `情绪：${panel.emotionCue}` : "",
  clean(panel.compositionNote) ? `构图：${panel.compositionNote}` : "",
  clean(panel.continuityIn) || clean(panel.continuityOut)
    ? `连续性：${clean(panel.continuityIn) ? `承接 ${clean(panel.continuityIn)}` : ""}${clean(panel.continuityIn) && clean(panel.continuityOut) ? "；" : ""}${clean(panel.continuityOut) ? `交给 ${clean(panel.continuityOut)}` : ""}`
    : "",
  `运动标记：${renderLegend(unique([...(panel.annotationLegendIds || []), ...(panel.actionArrowLegendIds || [])]))}`,
  clean(panel.renderInstruction) ? `渲染补充：${panel.renderInstruction}` : "",
].filter(Boolean).join("\n");

const commonModeRules = [
    "所有 panel 必须保持角色、道具、空间方向和首尾状态可追溯。",
    "故事板是控制图，不是最终美术图；优先线条可读、动作清楚、标注清楚。",
    "资产外貌、材质和身份细节由结构化参考图职责负责，不要在板面里堆满外貌描述。",
];

const modeRules: Partial<Record<StoryboardBoardMode, string[]>> = {
    ai_video_control: ["用红/蓝/绿/橙/紫/黑标注同时表达主体动作、镜头运动、构图、灯光、声音/情绪和镜头笔记。"],
    rhythm_sheet: ["底部必须有节奏轨道：镜头轨、动作轨、声音/节拍轨、灯光/光效轨、状态变化轨。", "每格下方保留节奏编号和状态变化，不要只画姿态。"],
    dance_choreography: ["每格必须有身体动能、重心变化或姿态承接。", "紫色标注音乐节拍，红色标注身体轨迹，蓝色标注摄影机节奏。"],
    fight_choreography: ["攻防因果、距离、受击反馈和能量方向必须逐格清楚。", "武器/道具不能跳手，角色不能瞬移。"],
    action_continuity: ["动作方向、受力点、match-on-action 承接点必须明确。"],
    effect_reveal: ["效果从无到有、增长、峰值、残留必须有阶段，不替代资产身份。"],
    emotional_performance: ["把抽象情绪翻译成眼神、手、呼吸、肩颈、身体重心和停顿。"],
    emotional_reaction: ["每格动作少但必须有可见表演变化，不能只写抽象情绪词。"],
    dialogue_blocking: ["轴线、视线、站位和道具流转必须清楚。"],
    spatial_geography: ["先锁定出入口、障碍、空间轴线和人物路线，再展开镜头；必要时加入简化拓扑小区。"],
    montage_compression: ["每格必须产生时间或阶段进展，并用视觉/声音母题解释省略关系。"],
    procedural_insert: ["步骤、手、道具部件和状态变化必须按顺序可验证，插入特写要能回到主空间。"],
    parallel_intercut: ["行动线必须有稳定分栏或标记，各自连续，并标明切换动机和共同时间点。"],
    subjective_suspense: ["标清主观视角拥有者、遮挡、画外声音和现实锚点，不能靠篡改资产事实制造悬念。"],
    interactive_ui_safe: ["保留 UI 安全区，选择前不要替玩家行动。"],
    interactive_idle_loop: ["首尾状态必须可循环，等待动作不能改变剧情事实。"],
    transition_bridge: ["前尾帧、过渡帧、后首帧必须能接上运动方向和光线状态。"],
};

const renderModeRules = (modes: StoryboardBoardMode[]) => Array.from(new Set([
  ...commonModeRules,
  ...modes.flatMap((mode) => modeRules[mode] || []),
])).join("\n");

export const renderStoryboardBoardContext = (
  input: StoryboardTemplateRenderInput,
  strategy: StoryboardPromptStrategy,
  modifierStrategies: StoryboardPromptStrategy[] = [],
  preparedRhythmTrack?: StoryboardRhythmTrack,
): StoryboardTemplateRenderResult["promptSections"] => {
  const styleLock = resolveVisualStyleLock(input.project);
  const departmentNotes = renderStoryboardDepartmentPrepRefNotes(input.board);
  const strategies = [strategy, ...modifierStrategies];
  const rhythmTrack = preparedRhythmTrack || (shouldRenderStoryboardRhythmTrack(
    strategies,
    input.board.strategyDecision.strategyResolution?.requiredCapabilityIds,
  ) ? buildStoryboardRhythmTrack(input.board) : undefined);
  return {
    styleLock: [
      styleLock.storyboardInstruction,
      input.project.visualStyleLock?.noSourceCopyRules?.length
        ? `禁止照搬来源内容：${input.project.visualStyleLock.noSourceCopyRules.join(" / ")}`
        : "",
    ].filter(Boolean).join("\n"),
    strategy: [
      `故事板方法：${strategy.name}`,
      modifierStrategies.length ? `附加控制：${modifierStrategies.map((item) => item.name).join("、")}` : "",
      `画面合同：${Array.from(new Set([strategy, ...modifierStrategies].flatMap((item) => item.outputContract))).join("；")}`,
      `检查要点：${Array.from(new Set([strategy, ...modifierStrategies].flatMap((item) => item.qaChecklist))).join("；")}`,
    ].filter(Boolean).join("\n"),
    scene: [
      input.scene.title ? `场景：${input.scene.title}` : "",
      clean(input.scene.description) ? `场景描述：${input.scene.description}` : "",
      clean(input.board.startState) ? `首帧状态：${input.board.startState}` : "",
      clean(input.board.endState) ? `尾帧状态：${input.board.endState}` : "",
      `复合版式：${input.board.layout}，共 ${input.board.panels.length} 格`,
    ].filter(Boolean).join("\n"),
    departments: departmentNotes,
    legend: renderLegend(input.board.arrowLegendIds),
    rhythmTrack: rhythmTrack ? renderStoryboardRhythmTrack(rhythmTrack) : "",
    panels: input.board.panels.map(renderPanel).join("\n\n"),
    renderRules: renderModeRules([strategy.boardMode, ...modifierStrategies.map((item) => item.boardMode)]),
  };
};

export const renderStoryboardBoardPrompt = (
  input: StoryboardTemplateRenderInput,
): StoryboardTemplateRenderResult => {
  const { strategy, warnings } = resolveStrategy(input);
  const modifierStrategies = (input.board.strategyDecision.strategyResolution?.modifierStrategyIds || [])
    .map((strategyId) => getStoryboardPromptStrategyById(strategyId))
    .filter((item): item is StoryboardPromptStrategy => Boolean(item));
  const templateId = strategy.promptTemplateId;
  const baseTemplate = templateText(templateId) ||
    templateText(input.fallbackStrategy?.promptTemplateId || "") ||
    "【任务】生成结构化线稿故事板。\n\n【输入】\n{{boardContext}}\n\n【输出要求】\n严格按照 panel 合同、标注 legend、风格锁和部门 refs 绘制。";
  if (!templateText(templateId)) {
    warnings.push(`Prompt template not found: ${templateId}; rendered with fallback shell.`);
  }
  const strategies = [strategy, ...modifierStrategies];
  const rhythmTrack = shouldRenderStoryboardRhythmTrack(
    strategies,
    input.board.strategyDecision.strategyResolution?.requiredCapabilityIds,
  )
    ? buildStoryboardRhythmTrack(input.board)
    : undefined;
  if (rhythmTrack) {
    const rhythmTrackIssues = validateStoryboardRhythmTrack(rhythmTrack, input.board);
    if (rhythmTrackIssues.length > 0) warnings.push(...rhythmTrackIssues.map((issue) => `Rhythm track: ${issue}`));
  }
  const promptSections = renderStoryboardBoardContext(input, strategy, modifierStrategies, rhythmTrack);
  const boardContext = [
    "【风格锁】",
    promptSections.styleLock,
    "",
    "【策略/模板】",
    promptSections.strategy,
    "",
    "【场景与首尾状态】",
    promptSections.scene,
    "",
    "【专业部门约束】",
    promptSections.departments,
    "",
    "【标注 legend】",
    promptSections.legend,
    "",
    ...(promptSections.rhythmTrack ? ["【结构化节奏轨】", promptSections.rhythmTrack, ""] : []),
    "【Panel 合同】",
    promptSections.panels,
    "",
    "【渲染规则】",
    promptSections.renderRules,
  ].join("\n");
  const prompt = replaceTemplateVariables(baseTemplate, {
    boardContext,
    styleLockContext: promptSections.styleLock,
    strategyContext: promptSections.strategy,
    sceneContext: promptSections.scene,
    departmentContext: promptSections.departments,
    annotationLegendContext: promptSections.legend,
    rhythmTrackContext: promptSections.rhythmTrack,
    panelContract: promptSections.panels,
    renderRules: promptSections.renderRules,
  });

  return {
    schemaVersion: "storyboard-template-render.v1",
    boardId: input.board.id,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    modifierStrategyIds: modifierStrategies.map((item) => item.id),
    strategyOrigin: input.board.strategyOrigin || (input.strategyDraft ? input.strategyDraft.scope : "built_in"),
    templateId,
    boardMode: strategy.boardMode,
    rhythmTrack,
    prompt,
    boardContext,
    promptSections,
    warnings,
  };
};

export const validateStoryboardTemplateRender = (
  render: Partial<StoryboardTemplateRenderResult> | undefined,
) => {
  const issues: string[] = [];
  if (!render || typeof render !== "object") return ["storyboard-template-render.v1 result is required."];
  if (render.schemaVersion !== "storyboard-template-render.v1") issues.push("schemaVersion must be storyboard-template-render.v1.");
  if (!clean(render.boardId)) issues.push("boardId is required.");
  if (!clean(render.strategyId)) issues.push("strategyId is required.");
  if (!clean(render.templateId)) issues.push("templateId is required.");
  if (!clean(render.prompt) || clean(render.prompt).length < 120) issues.push("prompt is too short for production storyboard rendering.");
  if (!clean(render.boardContext).includes("【Panel 合同】")) issues.push("boardContext must include Panel contract.");
  if (!clean(render.boardContext).includes("【标注 legend】")) issues.push("boardContext must include annotation legend.");
  if (!clean(render.boardContext).includes("【风格锁】")) issues.push("boardContext must include visual style lock.");
  return issues;
};

export const buildStoryboardTemplateRendererSystem = () => ({
  schemaVersion: "storyboard-template-renderer-system.v1",
  status: "available",
  purpose: "Render built-in or project-local storyboard strategies from the same structured StoryboardBoard panel contract.",
  rendererFunction: "renderStoryboardBoardPrompt",
  validationFunction: "validateStoryboardTemplateRender",
  outputSchema: "storyboard-template-render.v1",
  templateVariableContract: [
    "boardContext",
    "styleLockContext",
    "strategyContext",
    "sceneContext",
    "departmentContext",
    "annotationLegendContext",
    "rhythmTrackContext",
    "panelContract",
    "renderRules",
  ],
  requiredInputs: [
    "project.visualStyleLock or resolved fallback style lock",
    "scene",
    "StoryboardBoard.panels",
    "StoryboardPromptStrategy or storyboard_strategy_draft",
    "annotation legend ids",
    "department prep refs when formal prep exists",
  ],
  requiredBehavior: [
    "Do not build a universal mega-prompt; choose a promptTemplateId from the selected strategy or approved draft.",
    "Use the structured panel contract as source of truth; storyboard images are rendered projections, not facts.",
    "Render visual style lock, no-source-copy rules, annotation legend, department refs, and continuity in the board context.",
    "When the selected strategy recipe declares rhythm capabilities, render the structured storyboard-rhythm-track.v1 lanes from panel facts instead of inferring timing from genre prose.",
    "If a project-local draft cannot render or validate, fall back to fallbackStrategyId and keep the draft in QA instead of using it for media generation.",
  ],
  rhythmTrackSystem: buildStoryboardRhythmTrackSystem(),
});
