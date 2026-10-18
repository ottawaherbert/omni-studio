import type { ProductionQAIssue } from "../../../types/production";
import type { VideoStoryboardArtifactIssue } from "../videoStoryboardArtifacts";
import { coordinationIssue } from "./shared";

export const videoStoryboardIssueToProductionIssue = (
  item: VideoStoryboardArtifactIssue,
  issueType: string,
): ProductionQAIssue => coordinationIssue(
  item.target,
  `${item.code}: ${item.message}`,
  item.severity,
  item.message,
  {
    issueType,
    retryable: true,
    fingerprint: `${item.code}:${item.target}`,
  },
);
