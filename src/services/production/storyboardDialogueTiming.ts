export interface StoryboardDialogueTimingLine {
  text: string;
}

const dialogueUnits = (text: string) => {
  const chineseCharacters = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const englishWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
  return { chineseCharacters, englishWords };
};

export const estimateDialogueLineDurationSeconds = (text: string) => {
  const { chineseCharacters, englishWords } = dialogueUnits(text);
  if (!chineseCharacters && !englishWords) return 0;
  return Math.ceil(chineseCharacters / 4 + englishWords / 3);
};

export const estimateShotDialogueDurationSeconds = (lines: StoryboardDialogueTimingLine[]) =>
  lines.reduce((sum, line) => sum + estimateDialogueLineDurationSeconds(String(line.text || "")), 0);

export const allocateDialogueLineDurations = (
  lines: StoryboardDialogueTimingLine[],
  shotDurationSeconds: number,
) => {
  if (!lines.length) return [];
  const shotDuration = Math.max(0, Number(shotDurationSeconds) || 0);
  if (lines.length === 1) return [shotDuration];
  const weights = lines.map((line) => Math.max(0.001, estimateDialogueLineDurationSeconds(String(line.text || ""))));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(0, Number((shotDuration - assigned).toFixed(3)));
    const duration = Number((shotDuration * weight / totalWeight).toFixed(3));
    assigned += duration;
    return duration;
  });
};
