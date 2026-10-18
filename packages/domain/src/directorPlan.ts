/** Director decisions are adopted with the shots, never a second screenplay. */
export interface SceneDirectorPlan {
  schemaVersion: "scene-director.v1";
  id: string;
  bindingHash: string;
  sourceHash: string;
  skillId?: string;
  skillTitle: string;
  skillRevision?: number;
  assetIds: string[];
  intent: string;
  rhythm: string;
  applications: Array<{
    methodId?: string;
    skillId?: string;
    dimensions?: import("./directorProfile").DirectorField[];
    status?: "planned";
    method: string;
    evidence: string;
    decision: string;
    shotIds: string[];
  }>;
  exceptions: string[];
  createdAt: number;
}

export interface ShotDirecting {
  /** Original shot correspondence retained through QA repairs. */
  sourceShotId?: string;
  planId?: string;
  bindingHash?: string;
  skillId?: string;
  skillTitle?: string;
  skillRevision?: number;
  /** Instructions for an existing dialogue line, never replacement dialogue. */
  dialogue: Array<{ lineIndex: number; instruction: string; startSeconds?: number }>;
  /** Relative to this shot's start; may cross cuts within the same scene. */
  soundCues: Array<{
    id: string;
    type: "sfx" | "bgm";
    description: string;
    startSeconds: number;
    durationSeconds: number;
    linkedAssetId?: string;
  }>;
}
