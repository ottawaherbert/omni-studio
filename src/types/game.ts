import {
  Shot,
  AudioTrack,
  ScriptBlock,
  ScriptBreakdown,
  Scene,
  MediaAssetReference,
} from "./project";

export interface GameVariable {
  id: string;
  name: string; // e.g., 'trust', 'hasKey'
  type: "number" | "boolean" | "string";
  defaultValue?: number | boolean | string;
  initialValue?: number | boolean | string;
}

export interface GameAction {
  targetVariableId: string;
  operation: "add" | "set" | "subtract";
  value: number | boolean;
}

export interface GameChoice {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  source?: string; // React flow compatibility
  target?: string; // React flow compatibility
  displayText: string; // The text displayed to the player
  conditionExpression?: string; // Optional condition string, e.g., 'trust > 50'
  transitionConstraint?: {
    type: "seamless" | "hard-cut" | "crossfade";
    seedImageRef?: string; // Reference image URI
  };
}

export interface GameNode {
  id: string;
  type?: string; // React flow type
  data?: any; // React flow data
  title: string; // Node title
  scriptContent: string; // The script for this node
  detailedScript?: string; // Hollywood standard expanded script
  scriptBlocks?: ScriptBlock[]; // Structured script blocks generated from the node scene
  breakdown?: ScriptBreakdown; // Production breakdown generated from the node scene
  valueCharge?: Scene["valueCharge"];
  valueShift?: Scene["valueShift"];
  hook?: string;
  cliffhanger?: string;
  targetDuration?: number;
  sceneGoal?: string;
  sceneAssets?: string;
  environment?: Scene["environment"];
  timeOfDay?: Scene["timeOfDay"];
  imageAssetUrl?: string; // The preview/backdrop image URL (deprecated functionally, kept for legacy)
  videoAssetUrl?: string; // The finalized video URL (deprecated functionally, kept for legacy)
  imageAssetMedia?: MediaAssetReference;
  imageGenerationAudit?: ManualInteractiveNodeMediaAudit;
  videoAssetMedia?: MediaAssetReference;
  audioAssetUrl?: string; // Voiceover or ambient audio
  shots?: Shot[]; // ++ Node-specific sequence of shots
  audioTracks?: AudioTrack[]; // ++ Node-specific sequence of audio tracks
  multiGrid?: Scene["multiGrid"]; // ++ Multi-grid generation settings/assets
  overrideSkills?: Scene["overrideSkills"]; // ++ Style/skill override settings
  generationMetadata?: Scene["generationMetadata"]; // ++ AI generation metadata
  onEnterContext?: string; // Context to supply to AI or notes
  onEnterActions: GameAction[]; // Variables manipulated when this node starts
  isEnding: boolean;
  nextEpisodeId?: string; // (New) The episode ID to transition to if this is an ending
  nextEpisodeNodeId?: string; // (New) The specific node ID to start at in the next episode
  isNeedsBranching?: boolean; // AI flag for future expansion
  uiLayout: "standard" | "qte" | "timer"; // How to present choices to the player
  position: { x: number; y: number }; // For React Flow canvas
}

export interface ManualInteractiveNodeMediaAudit {
  action: "generate_concept_image";
  nodeId: string;
  promptHash: string;
  pathContextHash: string;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  createdAt: number;
}

export interface GameGraphPlanSnapshot {
  scale: "light" | "standard" | "3a";
  targetNodeCount: number;
  targetEndingCount: number;
  playDurationMin: number;
  explorationDurationMin: number;
  templateProfile: string;
  chapterCount: number;
  currentChapterIndex: number;
  currentChapterId?: string;
  chapterNodeTarget: number;
  nodeRange: {
    min: number;
    max: number;
  };
  chapterEndingTarget: number;
  branchDepthTarget: number;
  branchingStyle: string;
}

export interface GameGraphChapterPlanSnapshot {
  index: number;
  episodeId: string;
  title: string;
  role: "opening" | "development" | "convergence" | "finale";
  nodeTarget: number;
  nodeRange: {
    min: number;
    max: number;
  };
  endingTarget: number;
  branchDepthTarget: number;
  entryNodeId: string;
  nextEpisodeId?: string;
}

export interface GameGraphCrossEpisodePlanSnapshot {
  chapterCount: number;
  currentChapterIndex: number;
  chapters: GameGraphChapterPlanSnapshot[];
  variableCarryover: {
    policy: "persistent";
    variableNames: string[];
    notes: string;
  };
  entryStrategy: string;
}

export interface GameBlueprintPlanSnapshot {
  blueprint: string;
  goldenPath: string[];
  branchingPrinciples: string[];
  variables: Partial<GameVariable>[];
  endings: { name: string; condition?: string }[];
  createdAt: number;
}

export interface InteractiveGameDesignDoc {
  playerVerbs: string[];
  coreLoop: string;
  failRetryModel: string;
  tutorialStrategy: string;
  uiUxRules: string[];
  accessibilityRules: string[];
  saveStrategy: string;
  createdAt: number;
}

export interface InteractiveContinuityState {
  nodeId: string;
  title: string;
  incomingChoiceLabels: string[];
  variableEffects: GameAction[];
  characterIds: string[];
  propIds: string[];
  locationId?: string;
  continuityNotes: string[];
}

export interface InteractiveContinuitySnapshot {
  schemaVersion: "interactive-continuity-state-v1";
  states: InteractiveContinuityState[];
  createdAt: number;
}

export interface InteractiveRuntimeCompilation {
  schemaVersion: "interactive-runtime-v1";
  startNodeId?: string;
  variables: Array<{
    id: string;
    name: string;
    type: GameVariable["type"];
    defaultValue: number | boolean | string;
  }>;
  nodes: Array<{
    id: string;
    title: string;
    isEnding: boolean;
    uiLayout: GameNode["uiLayout"];
    onEnterActions: GameAction[];
    choiceIds: string[];
    defaultChoiceId?: string;
    preloadNodeIds: string[];
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    displayText: string;
    conditionExpression?: string;
    transitionType?: NonNullable<GameChoice["transitionConstraint"]>["type"];
  }>;
  saveStateKeys: string[];
  compiledAt: number;
}

export interface InteractivePlaytestTelemetryEvent {
  pathId: string;
  nodeId: string;
  choiceId?: string;
  durationMs?: number;
  endingNodeId?: string;
  abandoned?: boolean;
}

export interface InteractivePlaytestTelemetryAnalysis {
  pathCount: number;
  choiceCounts: Record<string, number>;
  endingCoverage: Record<string, number>;
  dropOffNodeIds: string[];
  averageDurationMs: number;
  recommendations: string[];
  analyzedAt: number;
}

export interface InteractiveMediaAssemblyPlan {
  schemaVersion: "interactive-media-assembly-v1";
  nodes: Array<{
    nodeId: string;
    idleLoopReady: boolean;
    imageReady: boolean;
    videoReady: boolean;
    defaultTimeoutChoiceId?: string;
    preloadNodeIds: string[];
    transitionTypes: string[];
  }>;
  readyNodeCount: number;
  totalNodeCount: number;
  createdAt: number;
}

export interface GameProjectData {
  blueprint?: string; // The master narrative blueprint
  blueprintPlan?: GameBlueprintPlanSnapshot;
  gameDesignDoc?: InteractiveGameDesignDoc;
  currentStep?: number; // Current step in the AI Architect Wizard
  graphPlan?: GameGraphPlanSnapshot;
  crossEpisodePlan?: GameGraphCrossEpisodePlanSnapshot;
  runtimeCompilation?: InteractiveRuntimeCompilation;
  continuityState?: InteractiveContinuitySnapshot;
  telemetryAnalysis?: InteractivePlaytestTelemetryAnalysis;
  mediaAssemblyPlan?: InteractiveMediaAssemblyPlan;
  variables: GameVariable[];
  nodes: GameNode[];
  edges: GameChoice[];
  nodeSnapshots?: GameNodeSnapshot[];
}

export interface GameNodeSnapshot {
  id: string;
  nodeId: string;
  reason: string;
  node: GameNode;
  createdAt: number;
}
