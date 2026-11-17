/** Shared authoring guidance; text completion is not a visual acceptance result. */
export const SCENE_VISUAL_COHERENCE_CONTRACT = `【场内视觉统一与切镜合同】
以本场剧本和正式资产为事实源，先统一空间地标、人物身份、光源与事件状态，再设计各镜头。相邻场次仅供理解，不把别场人物、地标或后续事件混入本场。
motivation 说明本镜给观众什么信息；editingNote 说明为何在此切镜、与前镜如何衔接（本场首镜说明建立的信息）。blocking 写本镜可见空间；continuityNote 写相关的入镜/出镜状态、持物、伤势、退场和信息揭示。只写简短可观察依据，不输出思维链，不编造未知事实。
画面统一不等于动作必须连拍或人物永远占同一画面侧。允许正反打、反应、插入镜头、蒙太奇、时间省略和有意越轴，注明可辨认的空间、声音、视线或叙事承接；不机械强制同向视线或动作匹配。
按事件先后检查状态变化，不能让已经退场的角色无依据重新出现、破损物件复原、道具换手或后段揭示提前。场景资产中的固定环境与剧情时刻的特效/人物分开。
按实际景别和时长安排可读动作，不为固定镜头数或视频模型单次时长上限压缩剧情；后续单独拆分生成单元。
文字计划和模型自评分仅是计划检查。实际媒体必须按相邻镜头和整场播放检查空间、切点状态、画风、光影、声音与节奏；没有看过画面不得声称视觉验收通过。`;

export function withSceneVisualCoherenceContract(prompt: string): string {
  return prompt.includes(SCENE_VISUAL_COHERENCE_CONTRACT)
    ? prompt
    : `${prompt}\n\n${SCENE_VISUAL_COHERENCE_CONTRACT}`;
}

export interface ShotEditingEvidence {
  motivation?: string;
  editingNote?: string;
  continuityNote?: string;
}

/** Both still-image and video authoring need the same cut/state evidence. */
export function projectShotEditingEvidence(shot: ShotEditingEvidence) {
  return { motivation: shot.motivation || '', editingNote: shot.editingNote || '', continuityNote: shot.continuityNote || '' };
}
