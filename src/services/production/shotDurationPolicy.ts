import type { Shot } from "../../types/project";

export interface ShotDurationPolicyResult {
  valid: boolean;
  durationSeconds: number;
  requiresGrouping: boolean;
  reason?: string;
}
/** Editorial shots may be fractional and short. Provider limits are checked on the generation request. */
export const evaluateStandaloneShotDuration = (shot: Pick<Shot, "duration" | "shortDurationOverride">): ShotDurationPolicyResult => {
  const durationSeconds = Number(shot.duration || 0);
  const valid = Number.isFinite(durationSeconds) && durationSeconds > 0;
  return { valid, durationSeconds, requiresGrouping: false, ...(valid ? {} : { reason: "镜头时长须为有效的正数秒，可用小数；请按内容估时。" }) };
};
export const evaluateVideoUnitDuration = (durationSeconds: number): ShotDurationPolicyResult => evaluateStandaloneShotDuration({ duration: durationSeconds });
