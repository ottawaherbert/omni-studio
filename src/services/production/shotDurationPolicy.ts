import type { Shot } from "../../types/project";

export const DEFAULT_MIN_STANDALONE_SHOT_SECONDS = 3;
export const DEFAULT_MAX_REBALANCED_SHOT_SECONDS = 30;

const allowedShortShotPurposes = new Set([
  "flash_cut",
  "insert",
  "impact_frame",
  "transition",
]);

export interface ShotDurationPolicyResult {
  valid: boolean;
  durationSeconds: number;
  requiresGrouping: boolean;
  reason?: string;
}

export const evaluateStandaloneShotDuration = (
  shot: Pick<Shot, "duration" | "shortDurationOverride">,
): ShotDurationPolicyResult => {
  const durationSeconds = Number(shot.duration || 0);
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    return { valid: false, durationSeconds, requiresGrouping: false, reason: "镜头时长必须是正整数秒。" };
  }
  if (durationSeconds >= DEFAULT_MIN_STANDALONE_SHOT_SECONDS) {
    return { valid: true, durationSeconds, requiresGrouping: false };
  }
  const override = shot.shortDurationOverride;
  const validOverride = Boolean(
    override
    && allowedShortShotPurposes.has(override.purpose)
    && override.reason.trim().length >= 8,
  );
  if (validOverride) return { valid: true, durationSeconds, requiresGrouping: false };
  return {
    valid: false,
    durationSeconds,
    requiresGrouping: true,
    reason: `普通独立生成镜头默认不少于 ${DEFAULT_MIN_STANDALONE_SHOT_SECONDS} 秒；请延长镜头、与相邻短镜头编组，或为必要的闪切/插入/冲击帧/转场填写用途和理由。`,
  };
};

export const evaluateVideoUnitDuration = (durationSeconds: number): ShotDurationPolicyResult => {
  const normalized = Number(durationSeconds);
  if (!Number.isInteger(normalized) || normalized < DEFAULT_MIN_STANDALONE_SHOT_SECONDS) {
    return {
      valid: false,
      durationSeconds: normalized,
      requiresGrouping: true,
      reason: `视频生成单元默认不少于 ${DEFAULT_MIN_STANDALONE_SHOT_SECONDS} 秒，请合并相邻短镜头后再生成。`,
    };
  }
  return { valid: true, durationSeconds: normalized, requiresGrouping: false };
};

export const rebalanceShotDurations = <T extends { duration?: number }>(
  shots: T[],
  targetDurationSeconds: number,
  minimumSeconds = DEFAULT_MIN_STANDALONE_SHOT_SECONDS,
  maximumSeconds = DEFAULT_MAX_REBALANCED_SHOT_SECONDS,
): T[] => {
  if (!shots.length) return [];
  if (!Number.isInteger(targetDurationSeconds)) throw new Error("Target duration must be an integer.");
  const minimumTotal = shots.length * minimumSeconds;
  const maximumTotal = shots.length * maximumSeconds;
  if (targetDurationSeconds < minimumTotal || targetDurationSeconds > maximumTotal) {
    throw new Error(`Target duration ${targetDurationSeconds}s cannot fit ${shots.length} shots within ${minimumSeconds}-${maximumSeconds}s.`);
  }

  const assigned = shots.map(() => minimumSeconds);
  const original = shots.map((shot) => Math.max(minimumSeconds, Number(shot.duration || minimumSeconds)));
  let remaining = targetDurationSeconds - minimumTotal;
  while (remaining > 0) {
    const candidate = assigned
      .map((duration, index) => ({ index, duration, score: original[index] / duration }))
      .filter((item) => item.duration < maximumSeconds)
      .sort((left, right) => right.score - left.score || left.index - right.index)[0];
    if (!candidate) throw new Error("Unable to distribute the remaining duration within the maximum shot duration.");
    assigned[candidate.index] += 1;
    remaining -= 1;
  }
  return shots.map((shot, index) => ({ ...shot, duration: assigned[index] }));
};
