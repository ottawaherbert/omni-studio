import type {
  VisualArtifactIntent,
  VisualCompileManifest,
  VisualRecipeRequiredInput,
  VisualRecipeRuntimeAcceptanceCheck,
  VisualRecipeRuntimeContract,
  VisualRecipeRuntimeEnforcement,
  VisualRecipeRuntimeEvidence,
  VisualRecipeWorkflowStage,
  VisualTaskRecipeDefinition,
} from "../../../../domain/src/visualArtifact";
import type { VisualStyleTreatmentSection } from "../../../../domain/src/visualStyle";

const finalSections: VisualStyleTreatmentSection[] = [
  "palette", "color", "surface", "linework", "lighting", "camera", "movement",
  "composition", "materials", "finish", "readability", "constraints", "directives",
];

const assetSections: VisualStyleTreatmentSection[] = [
  "palette", "color", "linework", "readability", "constraints",
];

const storyboardSections: VisualStyleTreatmentSection[] = [
  "palette", "color", "linework", "lighting", "camera", "movement", "composition",
  "readability", "constraints",
];

const recipe = (
  intent: VisualArtifactIntent,
  defaultPresentation: VisualTaskRecipeDefinition["defaultPresentation"],
  treatmentSections: VisualStyleTreatmentSection[],
  specificationProjection: VisualTaskRecipeDefinition["specificationProjection"],
  requiredInputs: VisualRecipeRequiredInput[],
  neutralDirectives: string[],
  acceptanceChecks: string[],
): VisualTaskRecipeDefinition => ({
  id: `visual-task.${intent}`,
  version: "1.0.0",
  intent,
  defaultPresentation,
  treatmentSections,
  appearanceProjection: specificationProjection,
  specificationProjection,
  requiredInputs,
  workflowStages: ["deconstruct", "diagnose", "develop", "deliver"],
  neutralDirectives,
  acceptanceChecks,
});

const recipes: VisualTaskRecipeDefinition[] = [
  recipe("asset_identity", "clean_reference", assetSections, "identity", ["identity_facts"],
    ["Present one canonical identity clearly without inventing a different project medium."],
    ["identity_readable", "materials_consistent", "no_unrequested_text"]),
  recipe("asset_state", "clean_reference", assetSections, "identity", ["base_identity", "state_delta"],
    ["Show only the declared state change while preserving canonical identity."],
    ["identity_preserved", "state_change_visible", "no_unrequested_text"]),
  recipe("storyboard_control", "control_drawing", storyboardSections, "control", ["shot_facts", "visible_action", "continuity"],
    ["Prioritize shot, action, staging, light direction, and continuity readability over final rendering."],
    ["shot_readable", "action_readable", "continuity_preserved", "presentation_is_control_artifact"]),
  recipe("direction_preview", "final_render", finalSections, "full", ["shot_facts", "visible_action", "continuity"],
    ["Render a provisional direction preview without promoting it to canonical production media."],
    ["direction_visible", "identity_preserved", "preview_remains_provisional"]),
  recipe("effect_look", "final_render", finalSections, "full", ["identity_facts", "shot_facts"],
    ["Express the intended final look while preserving canonical subject and location facts."],
    ["look_coherent", "identity_preserved", "source_not_copied"]),
  recipe("final_frame", "final_render", finalSections, "full", ["identity_facts", "shot_facts", "visible_action", "continuity"],
    ["Render the final frame from approved facts, continuity, and visual style."],
    ["facts_preserved", "continuity_preserved", "style_consistent"]),
  recipe("image_edit", "final_render", finalSections, "full", ["source_edit", "requested_changes", "preserve_constraints"],
    ["Change only explicitly requested visual properties and preserve every unspecified property."],
    ["requested_change_only", "identity_preserved", "layout_preserved"]),
  recipe("video_clip", "final_render", finalSections, "full", ["start_state", "end_state", "motion_intent", "continuity"],
    ["Carry the resolved visual implementation through motion without changing canonical identities."],
    ["start_end_coherent", "motion_intent_preserved", "identity_preserved"]),
];

const clone = <T>(value: T): T => structuredClone(value);

export const listVisualTaskRecipes = (): VisualTaskRecipeDefinition[] => clone(recipes);

export const getVisualTaskRecipeForIntent = (
  intent: VisualArtifactIntent,
): VisualTaskRecipeDefinition => {
  const found = recipes.find((entry) => entry.intent === intent);
  if (!found) throw new Error(`Unknown visual artifact intent: ${intent}`);
  return clone(found);
};

export const getVisualTaskRecipeById = (id: string): VisualTaskRecipeDefinition => {
  const found = recipes.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown visual task recipe: ${id}`);
  return clone(found);
};

export type VisualRecipeRuntimeEvidenceMap<Key extends string> = Partial<Record<Key, VisualRecipeRuntimeEvidence[]>>;

export interface EvaluateVisualRecipeRuntimeContractInput {
  intent: VisualArtifactIntent;
  enforcement: VisualRecipeRuntimeEnforcement;
  inputEvidence?: VisualRecipeRuntimeEvidenceMap<VisualRecipeRequiredInput>;
  stageEvidence?: VisualRecipeRuntimeEvidenceMap<VisualRecipeWorkflowStage>;
  acceptanceResults?: Partial<Record<string, Pick<VisualRecipeRuntimeAcceptanceCheck, "status" | "evidence">>>;
  manifest?: Pick<VisualCompileManifest, "recipeId" | "recipeVersion" | "intent">;
}

const cleanEvidence = (items: VisualRecipeRuntimeEvidence[] | undefined) => (items || [])
  .map((item) => ({
    source: String(item?.source || "").trim(),
    ...(item?.summary?.trim() ? { summary: item.summary.trim() } : {}),
  }))
  .filter((item) => Boolean(item.source));

const issueSeverity = (enforcement: VisualRecipeRuntimeEnforcement) => (
  enforcement === "formal" ? "blocking" as const : "warning" as const
);

/**
 * Evaluates one artifact request only. It does not mutate project workflow
 * state, invalidate adopted results, or claim that the eventual pixels have
 * passed review.
 */
export const evaluateVisualRecipeRuntimeContract = ({
  intent,
  enforcement,
  inputEvidence = {},
  stageEvidence = {},
  acceptanceResults = {},
  manifest,
}: EvaluateVisualRecipeRuntimeContractInput): VisualRecipeRuntimeContract => {
  const definition = getVisualTaskRecipeForIntent(intent);
  const issues: VisualRecipeRuntimeContract["issues"] = [];
  if (manifest && (
    manifest.intent !== definition.intent
    || manifest.recipeId !== definition.id
    || manifest.recipeVersion !== definition.version
  )) {
    issues.push({
      severity: issueSeverity(enforcement),
      code: "VISUAL_RECIPE_MANIFEST_MISMATCH",
      subject: "compileManifest",
      message: `视觉 Recipe 清单与当前 ${intent} 任务不一致。`,
    });
  }
  const requiredInputs = definition.requiredInputs.map((input) => {
    const evidence = cleanEvidence(inputEvidence[input]);
    if (!evidence.length) {
      issues.push({
        severity: issueSeverity(enforcement),
        code: "VISUAL_RECIPE_INPUT_MISSING",
        subject: input,
        message: `视觉任务 ${intent} 缺少 ${input} 的结构化证据。`,
      });
    }
    return { input, status: evidence.length ? "satisfied" as const : "missing" as const, evidence };
  });
  const workflowStages = definition.workflowStages.map((stage) => {
    const evidence = cleanEvidence(stageEvidence[stage]);
    if (!evidence.length) {
      issues.push({
        severity: issueSeverity(enforcement),
        code: "VISUAL_RECIPE_STAGE_PENDING",
        subject: stage,
        message: `视觉任务 ${intent} 的 ${stage} 阶段尚未形成可审计结果。`,
      });
    }
    return { stage, status: evidence.length ? "completed" as const : "pending" as const, evidence };
  });
  const acceptanceChecks = definition.acceptanceChecks.map((check) => {
    const result = acceptanceResults[check];
    const status = result?.status || "pending_review";
    const evidence = cleanEvidence(result?.evidence);
    if (status === "passed" && !evidence.length) {
      issues.push({
        severity: issueSeverity(enforcement),
        code: "VISUAL_RECIPE_ACCEPTANCE_UNREGISTERED",
        subject: check,
        message: `验收项 ${check} 不能在没有证据时被标记为通过。`,
      });
    }
    if (status === "failed") {
      issues.push({
        severity: "blocking",
        code: "VISUAL_RECIPE_ACCEPTANCE_FAILED",
        subject: check,
        message: `验收项 ${check} 未通过；当前结果不能被静默采用。`,
      });
    }
    return { check, status, evidence };
  });
  const unknownAcceptanceChecks = Object.keys(acceptanceResults)
    .filter((check) => !definition.acceptanceChecks.includes(check));
  unknownAcceptanceChecks.forEach((check) => issues.push({
    severity: issueSeverity(enforcement),
    code: "VISUAL_RECIPE_ACCEPTANCE_UNREGISTERED",
    subject: check,
    message: `验收项 ${check} 不属于 Recipe ${definition.id}@${definition.version}。`,
  }));
  return {
    schemaVersion: "visual-recipe-runtime.v1",
    recipeId: definition.id,
    recipeVersion: definition.version,
    intent,
    enforcement,
    requiredInputs,
    workflowStages,
    acceptanceChecks,
    issues,
  };
};

export const assertVisualRecipeRuntimeContractReady = (
  contract: VisualRecipeRuntimeContract,
) => {
  const definition = getVisualTaskRecipeForIntent(contract.intent);
  const exactDefinition = contract.recipeId === definition.id
    && contract.recipeVersion === definition.version
    && contract.requiredInputs.map((entry) => entry.input).join("|") === definition.requiredInputs.join("|")
    && contract.workflowStages.map((entry) => entry.stage).join("|") === definition.workflowStages.join("|")
    && contract.acceptanceChecks.map((entry) => entry.check).join("|") === definition.acceptanceChecks.join("|");
  if (contract.enforcement !== "formal" || !exactDefinition) {
    throw new Error("正式视觉生成缺少与当前 Recipe 完全一致的运行时合同。");
  }
  const blocking = contract.issues.find((issue) => issue.severity === "blocking")
    || contract.requiredInputs.find((entry) => entry.status === "missing")
    || contract.workflowStages.find((entry) => entry.status === "pending")
    || contract.acceptanceChecks.find((entry) => entry.status === "failed");
  if (blocking) {
    const message = "message" in blocking
      ? blocking.message
      : "input" in blocking
        ? `视觉任务缺少 ${blocking.input} 的结构化证据。`
        : "stage" in blocking
          ? `视觉任务的 ${blocking.stage} 阶段尚未完成。`
          : `视觉任务验收项 ${blocking.check} 未通过。`;
    throw new Error(message);
  }
};

const humanizeContractKey = (value: string) => value.replace(/_/g, " ");

/** Public task instructions only; no hidden reasoning or database ids. */
export const renderVisualRecipeRuntimeInstruction = (
  contract: VisualRecipeRuntimeContract,
) => [
  "[Task recipe execution contract]",
  `Required evidence: ${contract.requiredInputs.map((entry) => humanizeContractKey(entry.input)).join(", ")}.`,
  "Workflow: deconstruct the declared facts and references; diagnose conflicts and continuity risks; develop only the requested artifact; deliver one result after checking every acceptance gate.",
  `Acceptance gates: ${contract.acceptanceChecks.map((entry) => humanizeContractKey(entry.check)).join(", ")}.`,
  "Do not invent missing canonical facts. Do not report these gates as approved; output review remains a separate human or QC decision.",
].join("\n");

export const attachVisualRecipeContractToManifest = ({
  manifest,
  contract,
  blockId,
}: {
  manifest: VisualCompileManifest;
  contract: VisualRecipeRuntimeContract;
  blockId: string;
}): VisualCompileManifest => {
  if (
    manifest.intent !== contract.intent
    || manifest.recipeId !== contract.recipeId
    || manifest.recipeVersion !== contract.recipeVersion
  ) {
    throw new Error("视觉 Recipe 运行时合同与风格编译清单不一致。");
  }
  return {
    ...clone(manifest),
    blockIds: Array.from(new Set([...manifest.blockIds, blockId])),
    recipeContract: clone(contract),
  };
};
