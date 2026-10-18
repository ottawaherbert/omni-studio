/** Data contracts retained for historical adaptation artifacts; no legacy editor state. */
import type {
  ReferenceGovernanceMetadata,
  SourceArtifact,
} from './referenceGovernance';
import type { QAVerdict } from './production';

export type SourceType = 'novel' | 'outline' | 'script' | 'other';
export type TargetFormat = 'short-drama' | 'tv-series' | 'movie';
export type AdaptationTone = 'faithful' | 'dramatic';

export interface CharacterAsset {
  id: string;
  name: string;
  traits: string[];
  motivation: string;
}

export interface LocationAsset {
  id: string;
  name: string;
  description: string;
}

export interface GlobalAssets {
  logline: string;
  coreConflict?: string;
  genre?: string[];
  visualStyle?: string;
  narrativeStyle?: string;
  referenceWorks?: string;
  globalLook?: {
    baseTexture: string[];
    colorGrading: string[];
    conditionalEffects: { tag: string; condition: string }[];
  };
  globalLookTags?: string; // Legacy
  characters: CharacterAsset[];
  locations: LocationAsset[];
}

export interface Beat {
  id: string;
  title: string;
  summary: string;
  isCliffhanger: boolean;
  status: 'pending' | 'generating' | 'completed' | 'error';
  generatedScript?: any[];
}

export interface AdaptationDraftState {
  sourceArtifact?: SourceArtifact;
  sourceGovernance?: ReferenceGovernanceMetadata;
  sourceEnvelope?: unknown;
  assetDraft?: {
    status: 'draft' | 'approved' | 'qa_failed' | 'quarantined';
    data: GlobalAssets;
    qaVerdicts: QAVerdict[];
  };
  beatDraft?: {
    status: 'draft' | 'approved' | 'qa_failed' | 'quarantined';
    data: Beat[];
    qaVerdicts: QAVerdict[];
  };
  scriptDraft?: {
    status: 'draft' | 'approved' | 'qa_failed' | 'quarantined';
    data: Array<{ beatId: string; generatedScript: any[] }>;
    qaVerdicts: QAVerdict[];
  };
}
