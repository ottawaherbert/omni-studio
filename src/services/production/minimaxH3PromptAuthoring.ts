import { validateMiniMaxH3FinalPrompt } from "./minimaxH3Adapter";
import type { VideoGenerationAdapterPlan } from "./videoModelAdapter";

export interface MiniMaxH3PromptAuthoringInput {
  baselinePrompt: string;
  currentPrompt: string;
  creativePrompt: string;
  userIntent?: string;
  references: Array<{
    label: string;
    providerLabel?: string;
    name: string;
    relationship: string;
    mediaKind: "image" | "video" | "audio";
  }>;
  timeline: Array<{
    label: string;
    time: string;
    action: string;
    camera?: string;
    dialogue?: string;
    sound?: string;
  }>;
}

export interface MiniMaxH3PromptAuthoringResult {
  modelPrompt: string;
  warnings: string[];
}

export const buildMiniMaxH3PromptAuthoringRequest = (input: MiniMaxH3PromptAuthoringInput) => ({
  systemInstruction: [
    "You prepare the final model prompt for MiniMax H3 video generation.",
    "The structured production facts and the deterministic baseline are authoritative.",
    "Improve clarity, cinematic action, performance, camera continuity, sound, and reference responsibilities without changing any factual relationship.",
    "Keep every existing <Subject N>, <Picture N>, <Video N>, and <Audio N> token exactly. Never invent, remove, renumber, or reassign a token.",
    "Keep every [Shot N] marker, exact At MM:SS.mmm cut time, and every <d> dialogue block exactly. Do not add shots or dialogue.",
    "Keep the order and repetition count of dialogue lines. Multiple speakers can speak in one shot; never merge their lines or invent a camera cut for each speaker change.",
    "Use the same global (S1), (S2) speaker identities in the dialogue and corresponding audio references; database IDs are not speaker labels.",
    "If the baseline contains a <project_visual_style> block, keep that entire block byte-for-byte unchanged.",
    "For reference generation, output these sections exactly once and in order: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music.",
    "For strict-frame generation, keep the integrated_multimodal_description, overall_soundscape, and non_diegetic_music sections.",
    "When the baseline begins with a frame-alignment instruction, preserve that first line exactly before the core sections.",
    "Keep the author's creative direction in every generation mode. A storyboard annotation must not erase authored signs or other text that belongs in the depicted scene.",
    "Use concise English for model instructions. Preserve dialogue and on-screen text in their authored language.",
    "Return JSON only with modelPrompt and warnings. warnings must describe any ambiguity you could not safely resolve.",
  ].join("\n"),
  prompt: [
    "AUTHOR-FACING CREATIVE PROMPT:",
    input.creativePrompt.trim(),
    input.userIntent?.trim() && !input.creativePrompt.includes(input.userIntent.trim())
      ? `\nAUTHOR'S EXTRA DIRECTION:\n${input.userIntent.trim()}`
      : "",
    "\nAUTHORITATIVE REFERENCE FACTS:",
    JSON.stringify(input.references, null, 2),
    "\nAUTHORITATIVE SHOT TIMELINE:",
    JSON.stringify(input.timeline, null, 2),
    "\nDETERMINISTIC H3 BASELINE (facts and labels must be preserved):",
    input.baselinePrompt,
    "\nCURRENT EDITABLE MODEL PROMPT:",
    input.currentPrompt.trim() || input.baselinePrompt,
    "\nReturn the improved MiniMax H3 prompt now.",
  ].filter(Boolean).join("\n"),
  schema: {
    type: "object",
    properties: {
      modelPrompt: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["modelPrompt", "warnings"],
  },
});

export const parseMiniMaxH3PromptAuthoringResult = (
  raw: string,
  plan: VideoGenerationAdapterPlan,
): MiniMaxH3PromptAuthoringResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("大模型返回的 H3 提示词不是有效数据，请重新整理。");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("大模型没有返回可用的 H3 提示词。");
  }
  const value = parsed as { modelPrompt?: unknown; warnings?: unknown };
  const modelPrompt = typeof value.modelPrompt === "string" ? value.modelPrompt.trim() : "";
  const issues = validateMiniMaxH3FinalPrompt(plan, modelPrompt);
  if (issues.length > 0) {
    throw new Error(`大模型整理结果未通过 H3 规则检查：${issues[0].message}`);
  }
  return {
    modelPrompt,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim())).map((warning) => warning.trim())
      : [],
  };
};
