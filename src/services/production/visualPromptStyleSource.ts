import type { Project, VisualStyleLock } from "../../types/project";
import { formatVisualCreativeVision } from "../../utils/projectUtils";
import { normalizeLegacyVisualStyleLock } from "./visualStyleMigration";

const hasProjectedStyleContent = (lock: VisualStyleLock) => {
  const normalized = normalizeLegacyVisualStyleLock(lock).lock;
  return Boolean(
    normalized.visualImplementation
    || Object.values(normalized.treatment || {}).some((section) => section.length > 0)
    || normalized.mediumAssignments?.length,
  );
};

export const resolveCreativeVisionVisualFallback = (
  project: Pick<Project, "creativeVision" | "visualStyleLock"> | undefined,
) => {
  const styleLock = project?.visualStyleLock;
  if (styleLock && styleLock.humanApprovalState !== "rejected" && hasProjectedStyleContent(styleLock)) {
    return "";
  }
  return formatVisualCreativeVision(project?.creativeVision);
};
