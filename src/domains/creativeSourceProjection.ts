type CreativeRiskLevel = "low" | "medium" | "high";
type CreativeUse = "conflict" | "pacing" | "structure" | "cadence" | "character" | "dialogue" | "theme" | "world" | "scene" | "style" | "pattern" | "reference";

export type CreativeDomain = "writing" | "production" | "game";

export interface CreativeSourceBlockedItem {
  field: string;
  blockedFor: CreativeDomain[];
  reason: string;
  safeAlternative?: string;
}

export interface WritingCreativeProjection {
  allowed: boolean;
  uses: CreativeUse[];
  guidance: string[];
  mustNotCopy: string[];
  risk: CreativeRiskLevel;
}

export interface ProductionCreativeProjection {
  allowed: boolean;
  uses: Array<
    | "visual_style"
    | "cinematography"
    | "lighting"
    | "editing"
    | "performance"
    | "sound"
    | "storyboard"
    | "image_prompt"
    | "video_prompt"
    | "asset_board"
  >;
  guidance: string[];
  requiredApproval?: "style_lock" | "storyboard_strategy" | "department_prep";
  risk: CreativeRiskLevel;
}

export interface GameCreativeProjection {
  allowed: boolean;
  uses: Array<
    | "branch_structure"
    | "quest_pacing"
    | "choice_design"
    | "variable_feedback"
    | "ending_design"
    | "ui_interaction"
    | "interactive_cinematic"
  >;
  guidance: string[];
  risk: CreativeRiskLevel;
}

export interface CreativeSourceProjection {
  sourceId: string;
  writing?: WritingCreativeProjection;
  production?: ProductionCreativeProjection;
  game?: GameCreativeProjection;
  blocked: CreativeSourceBlockedItem[];
}

export interface CreativeSourceRoutingInput {
  sourceId: string;
  writingGuidance?: string[];
  writingUses?: CreativeUse[];
  downstreamGuidance?: string[];
  gameGuidance?: string[];
  mustNotCopy?: string[];
  risk?: CreativeRiskLevel;
}

export const routeCreativeSourceProjection = (
  input: CreativeSourceRoutingInput,
): CreativeSourceProjection => {
  const risk = input.risk || "low";
  const mustNotCopy = input.mustNotCopy || [];
  return {
    sourceId: input.sourceId,
    writing: {
      allowed: risk !== "high" && Boolean(input.writingGuidance?.length),
      uses: input.writingUses || [],
      guidance: risk === "high" ? [] : input.writingGuidance || [],
      mustNotCopy,
      risk,
    },
    production: input.downstreamGuidance?.length ? {
      allowed: true,
      uses: ["visual_style", "cinematography", "lighting", "editing", "performance"],
      guidance: input.downstreamGuidance,
      risk,
    } : undefined,
    game: input.gameGuidance?.length ? {
      allowed: true,
      uses: ["choice_design", "quest_pacing", "variable_feedback"],
      guidance: input.gameGuidance,
      risk,
    } : undefined,
    blocked: mustNotCopy.map((item) => ({
      field: item,
      blockedFor: ["writing", "production", "game"],
      reason: "来源内容只能作为不可复制边界，不进入生成上下文。",
      safeAlternative: "提炼为抽象冲突、节奏或人物关系机制。",
    })),
  };
};
