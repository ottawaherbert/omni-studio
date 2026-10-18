import type { Scene } from "../types/project";

/**
 * Production-facing rule projection for an interactive scene. It deliberately
 * describes physical continuity and UI staging without exposing state keys.
 */
export const buildInteractiveStoryboardInstruction = (scene?: Scene): string => {
  const metadata = scene?.interactiveMetadata;
  if (!metadata?.nodeIds?.length) return "";
  const incomingInstruction = metadata.incomingContext
    ? `上一节点的选择结果是：【${metadata.incomingContext}】。第一镜必须在动作、道具、人物状态、空间方位和情绪上直接承接这个物理结果。`
    : "第一镜必须承接已确认的入场物理状态，不得凭空重置人物、道具或环境。";
  if (!metadata.outboundChoices?.length) {
    return `\n【互动分镜连续性】\n${incomingInstruction}`;
  }
  return `\n【互动分镜强制范式】
${incomingInstruction}
最后一镜必须是“互动待机循环”：角色只保持可循环的轻微动作，不替玩家做出选择。
末镜必须使用明确的偏移构图，并为选项 UI 保留左侧或右侧三分之一安全区。`;
};
