import type { ProductionStageType } from "../../../types/production";
import type { OperatorArtifactEnvelope } from "../../operator/types";

export const stageRequires = (stageType?: ProductionStageType): OperatorArtifactEnvelope["kind"][] => {
  switch (stageType) {
    case "script":
      return ["performance_beats"];
    case "asset_sync":
      return ["scene_visual_pack"];
    case "storyboard":
      return ["scene_visual_pack", "storyboard_board"];
    case "prompt":
      return ["scene_visual_pack", "storyboard_board", "asset_reference_pack"];
    case "expensive_generation_planning":
      return ["storyboard_board", "asset_reference_pack", "video_generation_unit"];
    default:
      return [];
  }
};
