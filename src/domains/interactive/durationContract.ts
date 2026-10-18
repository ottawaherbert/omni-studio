import type {
  DurationBudget,
  InteractionFormatProfile,
} from './types/schema';

export const durationBudgetForFormat = (
  current: DurationBudget | undefined,
  formatProfile?: InteractionFormatProfile,
): DurationBudget | undefined => {
  if (!formatProfile) return current;
  return {
    p50TargetSec: Math.max(60, Math.round(formatProfile.targetSessionMinutes * 60)),
    p90TargetSec: Math.max(
      Math.round(formatProfile.targetSessionMinutes * 60),
      Math.round(formatProfile.targetCompleteMinutes * 60),
    ),
    maxSecondsWithoutChoice: current?.maxSecondsWithoutChoice || 360,
    tolerancePercent: current?.tolerancePercent || 20,
  };
};
