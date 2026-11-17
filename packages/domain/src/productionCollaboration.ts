/** Small production records, shared by human editors and external tools. */
export interface ProductionRequirement {
  id: string; department: string; description: string; reason?: string;
  beatIds?: string[]; targetIds?: string[];
}
export interface BeatDirection { beatId: string; intent: string; shotIds?: string[] }
export interface ProductionEventState {
  id: string; event: string; entityId: string; before: string; after: string;
  shotIds?: string[];
}
export interface ProductionObservation {
  id: string; note: string; impact: 'note' | 'issue' | 'unusable';
  targetIds?: string[]; mediaUrl?: string; contentHash?: string; viewpointId?: string;
  startSeconds?: number; endSeconds?: number; fixTargetId?: string;
  checkedAt?: number; reviewer?: 'creator' | 'external_agent';
}
export interface AssetProductionUse {
  shotScale?: string; dimensions?: string; operations?: string; limitations?: string;
}
export interface ProductionWorkRecord {
  scopeKey: string; originTaskId?: string; reviewsUsed: number; repairsUsed: number;
  maxReviews?: number | null; maxRepairs?: number | null;
  lastAction?: string; nextStep?: string; handoff?: boolean;
}
export interface EditorialClip {
  id: string; shotId: string; videoUrl?: string; imageUrl?: string; takeId?: string;
  sourceInSeconds: number; durationSeconds: number; timelineStartSeconds: number;
  transition?: 'none' | 'fade' | 'black';
}
export interface SceneEdit { clips: EditorialClip[] }

export type CollaborationPatch = {
  direction?: Partial<Pick<import('./directorPlan').SceneDirectorPlan,'intent'|'rhythm'|'requirements'|'beatDirections'|'assumptions'>>;
  eventStates?: ProductionEventState[]; observations?: ProductionObservation[];
  workRecords?: ProductionWorkRecord[];
  beats?: {id:string;action:string;visibleChange?:string}[];
};
