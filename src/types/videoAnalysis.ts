import type { QAVerdict } from "./production";
import type {
  ReferenceGovernanceMetadata,
  SourceArtifact,
} from "./referenceGovernance";

export interface VideoAnalysisSkill {
  id: string;
  name: string;
  sourceType: "director" | "franchise" | "genre" | "actor" | "writer" | "worldbuilding" | "custom" | "video-analysis";
  category?: "character" | "structure" | "beat" | "visual" | "custom";
  sourceProjectId?: string;
  description?: string;

  narrative: {
    themeFocus: string[];
    characterArchetypes: string;
    conflictMechanics?: string;
    dialogueStyle: string;
    pacingAndStructure: string;
  };

  directing: {
    colorPalette: string;
    cameraMovement: string;
    shotSizePreference: string;
    lightingStyle: string;
  };

  audioEditorial: {
    soundscape: string;
    editingRhythm: string;
  };

  promptModifiers: {
    scriptInstruction: string;
    imageAppendedTags: string;
    videoAppendedTags: string;
    audioAppendedTags?: string;
  };

  forbiddenCliches?: string[];
  formatCompatibility?: {
    recommendedFormats?: string[];
    riskyFormats?: string[];
    conflictWarnings?: string[];
    notes?: string;
  };
  referenceStrength?: "subtle" | "balanced" | "strong" | "override";
  referenceGovernance?: ReferenceGovernanceMetadata;

  createdAt: number;
  updatedAt: number;
}

export interface VideoAnalysisProject {
  id: string;
  title: string;
  type: "movie" | "tv-series" | "short-drama";
  createdAt: number;
  updatedAt: number;

  macroDNA?: {
    overview?: string;
    structureSkeleton?: string;     // 宏观骨架 (Skeleton)
    coreDriver?: string;            // 核心驱动力
    commonBeats?: string;           // 通用叙事节拍模型 (Beats/Rhythm)
    evidenceSegmentIds?: string[];
    sourceArtifacts?: SourceArtifact[];
    qaVerdicts?: QAVerdict[];
    referenceGovernance?: ReferenceGovernanceMetadata;
  };

  segments: AnalysisSegment[];
  skills?: VideoAnalysisSkill[];
}

export interface AnalysisSegment {
  id: string;
  projectId: string;
  title: string;   // e.g. "第1集", "第1段"
  mediaType: "video" | "image" | "text";
  sourceContent?: string; // Users can paste text/script for analysis
  
  // 局部微观拉片结果
  analysisResult?: {
    overview?: string;
    // 1. 叙事功能分镜表
    shotListInfo?: Array<{
      timestamp: string;
      cameraMovement: string;
      shotSize: string;
      action: string;
      dialogue: string;
    }>;
    // 2. 单集节奏点波段
    rhythmWaves?: string;
    // 3. 场景剧本逻辑
    sceneLogic?: string;
    // 4. 视听风格
    audiovisualStyle?: string;
    // 5. 生图独立 Tag
    visualKeywords?: string[];
    // 6. 人设高光
    characterHighlights?: string;
    sourceArtifact?: SourceArtifact;
    qaVerdicts?: QAVerdict[];
    referenceGovernance?: ReferenceGovernanceMetadata;
  };

  createdAt: number;
  updatedAt: number;
}
