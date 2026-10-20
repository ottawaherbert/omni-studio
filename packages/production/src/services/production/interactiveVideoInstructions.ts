import type { VideoGenerationIntent } from "./videoGenerationIntent";

export const interactiveDescription = (intent: VideoGenerationIntent) => {
  const context = intent.interactiveContext;
  if (!context) return "";
  const state = context.visibleStateFacts.length
    ? `Keep these visible state facts: ${context.visibleStateFacts.join("; ")}.`
    : "";
  if (context.contentSlot === "entry") {
    return [
      "Interactive entry: show the visible result carried in from the previous choice before the node's main action begins.",
      context.incomingPhysicalResult ? `Incoming result: ${context.incomingPhysicalResult}.` : "",
      "Do not replay the player's choice and do not render interface text or buttons.",
      state,
    ].filter(Boolean).join(" ");
  }
  if (context.contentSlot === "choice_hold") {
    return [
      "Interactive choice wait: create a seamless idle loop that can hold while the player decides.",
      "Do not perform any outgoing choice, consequence, transition, selection gesture, interface text, or button inside the video.",
      context.uiSafeArea === "center_clear"
        ? "Keep the central interaction area visually clear while preserving the subject at a readable edge-safe position."
        : "Keep the declared interface-safe area clear.",
      "Use only small repeatable breathing, eye, cloth, light, smoke, dust, or environmental motion; make the first and last pose and sound bed loop cleanly.",
      ...context.outgoingChoices.filter(choice => choice.timeoutSeconds !== undefined).map(choice => `Timeout ${choice.timeoutSeconds}s${choice.isDefaultTimeout ? ' (default)' : ''} is controlled by the interactive runtime; keep waiting until it fires, never bake its outcome into the loop.`),
      state,
    ].filter(Boolean).join(" ");
  }
  if (context.contentSlot === "exit") {
    return [
      "Interactive exit: complete the current node's visible action and prepare a clean continuity handoff without showing the next choice result.",
      state,
    ].filter(Boolean).join(" ");
  }
  return ["Interactive main content: play the node's authored action without rendering interface text or buttons.", state].filter(Boolean).join(" ");
};

