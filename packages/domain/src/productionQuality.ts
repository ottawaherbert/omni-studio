/** Creative production checks. A pass is a review of concrete work, never an automatic score. */
export const qualityStages = {
  project_plan: { label: '全剧总体方案', scope: 'project', owner: '总导演', checks: ['story', 'visual_direction', 'production_scope'] },
  scene_plan: { label: '整场设计', scope: 'scene', owner: '总导演', checks: ['dramatic_cause', 'space_and_people', 'event_states'] },
  shot_plan: { label: '拆镜与制作单元', scope: 'scene', owner: '导演 / 摄影 / 剪辑', checks: ['story_coverage', 'shot_purpose', 'timing_and_cuts'] },
  preparation: { label: '资产、布景与调度', scope: 'group', owner: '美术 / 副导演 / 群演协调', checks: ['identities_and_props', 'space_and_population', 'staging_basis'] },
  visuals: { label: '整组画面总检', scope: 'group', owner: '总导演 / 摄影 / 场记', checks: ['frame_coverage', 'spatial_continuity', 'identity_and_states'] },
  segments: { label: '视频与声音质检', scope: 'group', owner: '导演 / 场记 / 声音', checks: ['action_and_performance', 'boundary_continuity', 'sound_and_dialogue'] },
  scene_cut: { label: '整场合成总检', scope: 'scene', owner: '总导演 / 剪辑 / 声音', checks: ['complete_scene', 'edit_and_rhythm', 'sound_picture'] },
  episode_cut: { label: '整集总检与交付', scope: 'episode', owner: '总导演', checks: ['complete_episode', 'scene_transitions', 'delivery_picture_sound'] },
} as const;
export type ProductionQualityStage = keyof typeof qualityStages;
export const qualityCheckLabels: Record<string, string> = {
  story: '故事目标、冲突与人物关系明确', visual_direction: '画面、空间和声音方向一致', production_scope: '制作范围、职责与有限返工安排明确',
  dramatic_cause: '本场事件因果和情绪转折成立', space_and_people: '空间、出入口、演员与群演安排明确', event_states: '持物、损坏、入退场等事件状态有依据',
  story_coverage: '拆分完整覆盖本场剧情', shot_purpose: '景别、机位和反应镜头服务叙事', timing_and_cuts: '估时、生成单元和切点有实际依据',
  identities_and_props: '角色、服装与道具可辨且适合拍摄', space_and_population: '布景、远近景、群演与通行空间符合剧情', staging_basis: '已选空间或3D预演落实到本组调度',
  frame_coverage: '实际画面覆盖本组镜头', spatial_continuity: '按顺序对照画面与空间依据，位置关系成立', identity_and_states: '身份、光影、持物与事件前后状态一致',
  action_and_performance: '实际观看动作和表演，剧情可理解', boundary_continuity: '与相邻片段的入出状态、视线和因果接得上', sound_and_dialogue: '实际听审对白、音色与声音；无对白时核对声音安排',
  complete_scene: '完整观看整场，无缺戏或占位冒充成片', edit_and_rhythm: '按实际表演、对白和动作选择切点', sound_picture: '声音、口型、字幕和画面对应',
  complete_episode: '完整观看整集，所有必需场次齐全', scene_transitions: '跨场空间、时间、状态与叙事承接成立', delivery_picture_sound: '实际成片画面和声音达到本次交付要求',
};
export interface QualityTarget { projectId: string; episodeId?: string; sceneId?: string; shotIds?: string[] }
export interface ProductionResponsibility {
  director: string; coordinator: string; intent: string; visualDirection: string;
  /** Chosen by the production team; 3D remains optional. */
  spatialMode: 'scene_plan' | 'previs';
}
export interface QualityEvidenceInput { mediaUrl: string; mediaKind: 'image' | 'video' | 'audio'; shotIds?: string[]; note?: string }
export interface QualityEvidence extends QualityEvidenceInput { contentHash: string; durationSeconds?: number; hasAudio?: boolean }
export interface QualityFinding { check: string; passed: boolean; note: string }
export interface QualityInspection {
  id: string; target: QualityTarget; stage: ProductionQualityStage; sourceHash: string;
  snapshot: unknown; evidence: QualityEvidence[]; createdAt: number;
  verdict?: 'passed' | 'failed'; findings?: QualityFinding[]; reviewedAt?: number;
  reviewer?: 'creator' | 'external_agent'; reviewerName?: string;
}
export interface QualityStageState {
  stage: ProductionQualityStage; label: string; owner: string;
  status: 'pending' | 'passed' | 'failed' | 'stale' | 'blocked';
  inspectionId?: string; blockers: string[]; checks: { id: string; label: string }[];
}
export interface ProductionQualityStatus {
  responsibility?: ProductionResponsibility; stages: QualityStageState[];
  instruction: string;
}
