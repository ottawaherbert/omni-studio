/** Text evidence only. Neighbours must come from the owning scene's ordered shots. */
export interface ContinuityShotEvidence {
  id: string;
  visualAction?: string;
  videoPrompt?: string;
  blocking?: string;
  continuityNote?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lightingAtmo?: string;
}
const compact = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();
const describe = (shot: ContinuityShotEvidence) => [
  `镜头 ${shot.id}`,
  compact(shot.visualAction || shot.videoPrompt),
  shot.videoPrompt && compact(shot.videoPrompt) !== compact(shot.visualAction) ? `视频动作：${compact(shot.videoPrompt)}` : "",
  shot.lightingAtmo ? `光影：${compact(shot.lightingAtmo)}` : "",
  shot.blocking ? `调度：${compact(shot.blocking)}` : '',
  shot.continuityNote ? `连续性要求：${compact(shot.continuityNote)}` : '',
  [shot.cameraAngle, shot.cameraMovement].filter(Boolean).length ? `摄影：${[shot.cameraAngle, shot.cameraMovement].filter(Boolean).map(compact).join('，')}` : '',
].filter(Boolean).join('；');

export function buildVideoContinuityContext({ sceneId, shots, unitShotIds }: {
  sceneId: string; shots: readonly ContinuityShotEvidence[]; unitShotIds: readonly string[];
}): string {
  const selected = new Set(unitShotIds);
  const indices = shots.flatMap((shot, index) => selected.has(shot.id) ? [index] : []);
  // An invalid / foreign unit has no usable context. Never borrow another scene.
  if (!indices.length || selected.size !== unitShotIds.length || indices.length !== selected.size) return '';
  // Gapped/reordered units have no single adjacent range; do not invent a handoff.
  if (indices.some((index, offset) => index !== indices[0] + offset || shots[index].id !== unitShotIds[offset])) return '';
  const first = indices[0], last = indices[indices.length - 1];
  const before = first > 0 ? shots[first - 1] : undefined;
  const after = last + 1 < shots.length ? shots[last + 1] : undefined;
  return [
    `【本场视频连续性｜${sceneId}】`,
    `当前单元镜头：${indices.map(index => shots[index].id).join(' → ')}`,
    before ? `前一镜头（仅承接参考，不在本单元重演）：${describe(before)}` : '本单元位于本场开头，无本场前镜头。',
    ...indices.map(index => `单元内：${describe(shots[index])}`),
    after ? `后一镜头（仅衔接参考，不提前表演）：${describe(after)}` : '本单元位于本场结尾，无本场后镜头。',
    '依据已写明的空间、人物位置、视线对象和动作起止衔接。正反打的视线可相反；保留作者明确的越轴、转场与时空跳切，不把所有视线强制为同一方向。',
    '未说明的连续性事实保持未指定。这些文字约束不新增媒体参考，生成后仍需检查实际接续。',
  ].join('\n');
}
