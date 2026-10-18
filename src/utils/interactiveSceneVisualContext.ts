import type { Scene } from "../types/project";
import {
  buildVisualScenarios,
  isObservableStateFact,
} from "../domains/interactive/projection/interactiveVisualContextProjection";

export const buildInteractiveSceneVisualContext = (scene?: Scene): string => {
  const metadata = scene?.interactiveMetadata;
  if (!metadata?.nodeIds?.length) return "";
  const projectedScenarios = metadata.visualScenarios || [];
  const selectedProjectedScenario = projectedScenarios.find(
    (scenario) => scenario.id === metadata.activeVisualScenarioId,
  ) || projectedScenarios[0];
  const observableFacts = [...new Set([
    ...(metadata.requiredFacts || []),
    ...(metadata.producedFacts || []),
  ].filter(isObservableStateFact))];
  const scenario = buildVisualScenarios({
    nodeId: metadata.nodeIds.join("_"),
    facts: observableFacts,
    environmentNotes: [metadata.incomingContext || ""].filter(Boolean),
    continuityIn: [metadata.incomingContext || ""].filter(Boolean),
    continuityOut: [metadata.outgoingContext || ""].filter(Boolean),
  })[0];
  const activeScenario = selectedProjectedScenario || scenario;
  return [
    "本场属于互动故事。只表现观众能够看见或听见的状态变化，不要把内部变量名画进画面。",
    metadata.incomingContext ? `【入场结果】${metadata.incomingContext}` : "",
    activeScenario.shotPromptDelta
      ? `【可见状态】${activeScenario.shotPromptDelta}`
      : "",
    projectedScenarios.length > 1
      ? `【画面状态版本】当前为“${activeScenario.label}”；本场共有 ${projectedScenarios.length} 种可见状态，正式素材不得跨状态误用。`
      : "",
    metadata.outgoingContext ? `【离场连续性】${metadata.outgoingContext}` : "",
    metadata.outboundChoices?.length
      ? `【选择前待机】${metadata.outboundChoices.map((choice) => choice.label).join(" / ")}；末镜为选项保留安全区。`
      : "",
  ].filter(Boolean).join("\n");
};
