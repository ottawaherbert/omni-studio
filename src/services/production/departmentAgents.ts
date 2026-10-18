import type { ProductionStageType } from "../../types/production";
import {
  PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  PRODUCTION_PREP_DEPARTMENT_ALIASES,
  PRODUCTION_PREP_LEGACY_DEPARTMENTS,
  type ProductionPrepDepartment,
} from "./productionPrep";
import {
  MANUAL_FILM_TEAM_COLLABORATION_WAVES,
  MANUAL_FILM_TEAM_DEPARTMENT_ORDER,
  manualFilmTeamDependencies,
} from "./manualFilmTeamCommunication";

export interface DepartmentAgentSpec {
  id: string;
  traditionalGroup: string;
  prepDepartments: ProductionPrepDepartment[];
  coordinationDepartment: string;
  owns: string[];
  primaryInputs: string[];
  primaryOutputs: string[];
  requiredBeforeStageTypes: ProductionStageType[];
  qaFocus: string[];
  modePolicy: "required_for_formal" | "conditional" | "sample_optional";
}

export interface DepartmentCoordinationPoint {
  scope: "stage_exit" | "episode_wrap" | "phase_wrap" | "manual_audit";
  stageTypes: ProductionStageType[];
  coordinates: ProductionPrepDepartment[];
  purpose: string;
}

export const DEPARTMENT_AGENT_SPECS: DepartmentAgentSpec[] = [
  {
    id: "department.directing",
    traditionalGroup: "导演组",
    prepDepartments: ["directing"],
    coordinationDepartment: "creative_commercial",
    owns: ["creative intent", "blocking purpose", "shot motivation", "director approvals", "creative change triage"],
    primaryInputs: ["script_lock_package", "content_lock_package", "casting_requirement", "performance_beats", "storyboard_chain"],
    primaryOutputs: ["director notes", "casting_decision", "creative_change_request", "storyboard intent"],
    requiredBeforeStageTypes: ["production_asset_detail", "storyboard", "prompt"],
    qaFocus: ["scene purpose", "performance motivation", "camera motivation", "change governance"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.cinematography",
    traditionalGroup: "摄影组",
    prepDepartments: ["cinematography"],
    coordinationDepartment: "storyboard_video_unit",
    owns: ["coverage plan", "axis plan", "lens and framing language", "camera movement continuity"],
    primaryInputs: ["production_breakdown_report", "shots", "storyboard_board", "visualStyleLock"],
    primaryOutputs: ["camera plan", "coverage notes", "storyboard camera refs", "video unit camera refs"],
    requiredBeforeStageTypes: ["storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["eyeline", "screen direction", "coverage completeness", "camera movement executability"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.lighting",
    traditionalGroup: "灯光组",
    prepDepartments: ["lighting"],
    coordinationDepartment: "storyboard_video_unit",
    owns: ["light source logic", "time and weather continuity", "mood lighting", "negative lighting constraints"],
    primaryInputs: ["production_breakdown_report", "scene_visual_pack", "visualStyleLock", "continuity_matrix"],
    primaryOutputs: ["lighting plan", "prompt lighting refs", "video unit lighting refs"],
    requiredBeforeStageTypes: ["storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["source logic", "day/night continuity", "mood continuity", "prompt executability"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.production_design",
    traditionalGroup: "美术组",
    prepDepartments: ["production_design", "location_art"],
    coordinationDepartment: "asset",
    owns: ["set dressing", "spatial logic", "materials", "palette", "world/period consistency"],
    primaryInputs: ["production_breakdown_report", "location identity boards", "scene_asset_variant_pack"],
    primaryOutputs: ["production design package", "location/set state", "scene_visual_pack constraints"],
    requiredBeforeStageTypes: ["production_asset_detail", "asset_sync", "storyboard"],
    qaFocus: ["space continuity", "set reuse", "material consistency", "asset contamination"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.wardrobe",
    traditionalGroup: "服装组",
    prepDepartments: ["wardrobe", "wardrobe_makeup"],
    coordinationDepartment: "asset",
    owns: ["costume state", "layers", "damage/wet/blood state", "costume continuity"],
    primaryInputs: ["casting_decision", "asset_identity_board", "production_breakdown_report", "continuity_matrix"],
    primaryOutputs: ["wardrobe package", "wardrobe variant request", "scene_asset_variant_pack refs"],
    requiredBeforeStageTypes: ["production_asset_detail", "asset_sync", "storyboard"],
    qaFocus: ["costume continuity", "identity consistency", "damage/wet/blood state", "variant accuracy"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.makeup_hair",
    traditionalGroup: "化妆组",
    prepDepartments: ["makeup_hair", "wardrobe_makeup"],
    coordinationDepartment: "asset",
    owns: ["makeup state", "hair state", "injury makeup", "sweat/tears/aging continuity"],
    primaryInputs: ["casting_decision", "asset_identity_board", "production_breakdown_report", "continuity_matrix"],
    primaryOutputs: ["makeup/hair package", "makeup_hair variant request", "scene_asset_variant_pack refs"],
    requiredBeforeStageTypes: ["production_asset_detail", "asset_sync", "storyboard"],
    qaFocus: ["injury position", "hair continuity", "sweat/tears state", "variant accuracy"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.performance",
    traditionalGroup: "演员组",
    prepDepartments: ["performance_directing", "casting"],
    coordinationDepartment: "creative_commercial",
    owns: ["acting beats", "micro expressions", "dialogue delivery", "emotional arc"],
    primaryInputs: ["scriptBlocks", "performance_beats", "casting_requirement", "role_slot"],
    primaryOutputs: ["performance prep", "storyboard performance refs", "video unit performance refs"],
    requiredBeforeStageTypes: ["storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["character consistency", "emotional progression", "line motivation", "visible performance change"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.action",
    traditionalGroup: "动作组",
    prepDepartments: ["action_choreography", "extras_stunts"],
    coordinationDepartment: "storyboard_video_unit",
    owns: ["action beats", "fight/chase continuity", "stunt risk", "prop and space interaction"],
    primaryInputs: ["production_breakdown_report", "stuntNeeds", "props", "location geography", "performance_beats"],
    primaryOutputs: ["action choreography package", "safety/cost notes", "storyboard action refs"],
    requiredBeforeStageTypes: ["storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["action causality", "motion continuity", "safety/cost risk", "prop interaction"],
    modePolicy: "conditional",
  },
  {
    id: "department.props",
    traditionalGroup: "道具组",
    prepDepartments: ["props"],
    coordinationDepartment: "asset",
    owns: ["prop state", "ownership", "breakage", "hero prop continuity"],
    primaryInputs: ["propAppearances", "sceneMatrix", "scene_visual_pack", "continuity_matrix"],
    primaryOutputs: ["prop prep package", "prop variant request", "scene_asset_variant_pack refs"],
    requiredBeforeStageTypes: ["production_asset_detail", "asset_sync", "storyboard"],
    qaFocus: ["ownership", "usage state", "breakage continuity", "shot appearance"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.continuity",
    traditionalGroup: "场记/连续性",
    prepDepartments: ["continuity"],
    coordinationDepartment: "continuity",
    owns: ["continuity matrix", "in/out state", "match-on-action", "soft/hard holds"],
    primaryInputs: ["production_breakdown_report", "department_prep_package", "scene_asset_variant_pack", "shots"],
    primaryOutputs: ["continuity_matrix", "continuity findings", "coordination soft/hard holds"],
    requiredBeforeStageTypes: ["production_breakdown", "asset_sync", "storyboard", "prompt"],
    qaFocus: ["state handoff", "time/weather", "props", "wardrobe/makeup", "axis and eyeline"],
    modePolicy: "required_for_formal",
  },
  {
    id: "department.vfx_sfx",
    traditionalGroup: "VFX/SFX",
    prepDepartments: ["vfx_sfx"],
    coordinationDepartment: "asset",
    owns: ["effect state", "practical/generated boundary", "safety/cost flags"],
    primaryInputs: ["variantNeeds", "sceneMatrix", "action plan", "video model profile"],
    primaryOutputs: ["VFX/SFX state package", "prompt effect refs", "video unit constraints"],
    requiredBeforeStageTypes: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["effect continuity", "model executability", "cost risk", "safety boundary"],
    modePolicy: "conditional",
  },
  {
    id: "department.sound_music",
    traditionalGroup: "声音/音乐",
    prepDepartments: ["sound_music"],
    coordinationDepartment: "storyboard_video_unit",
    owns: ["sound cue", "BGM entry/exit", "ambience", "silence and impact beats"],
    primaryInputs: ["scriptBlocks", "performance_beats", "scene emotion", "environment"],
    primaryOutputs: ["sound/music package", "video unit audio plan"],
    requiredBeforeStageTypes: ["prompt", "expensive_generation_planning"],
    qaFocus: ["audio motivation", "BGM continuity", "ambience consistency", "silence timing"],
    modePolicy: "conditional",
  },
  {
    id: "department.ui_interaction",
    traditionalGroup: "互动/UI",
    prepDepartments: ["ui_interaction"],
    coordinationDepartment: "asset",
    owns: ["UI layout", "choice state", "variable feedback", "ending/failure state"],
    primaryInputs: ["content_lock_package", "interactiveCoverage", "game graph", "node matrix"],
    primaryOutputs: ["UI/interaction prep", "interactive scene visual constraints"],
    requiredBeforeStageTypes: ["production_breakdown", "production_asset_detail", "interactive_storyboard"],
    qaFocus: ["UI safe area", "choice readability", "variable state continuity", "ending/failure coverage"],
    modePolicy: "conditional",
  },
  {
    id: "department.production_coordination",
    traditionalGroup: "制片/统筹",
    prepDepartments: ["production"],
    coordinationDepartment: "operator_governance",
    owns: ["department coverage", "handoff manifest", "stage gate", "wrap QA", "repair ticket routing"],
    primaryInputs: ["production_breakdown_report", "department_prep_package", "operator artifacts", "QA reports", "gate verdicts"],
    primaryOutputs: ["production_coordination_report", "department_handoff_manifest", "coordination_repair_ticket"],
    requiredBeforeStageTypes: ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
    qaFocus: ["missing departments", "blocking issues", "soft holds", "retry budget", "human intervention"],
    modePolicy: "required_for_formal",
  },
];

export const DEPARTMENT_COORDINATION_POINTS: DepartmentCoordinationPoint[] = [
  {
    scope: "stage_exit",
    stageTypes: ["production_breakdown"],
    coordinates: ["production", "directing", "casting", "production_design", "wardrobe", "makeup_hair", "props", "continuity", "ui_interaction"],
    purpose: "After script/content/block lock is broken down, verify role, scene, asset, continuity, UI, and department prep coverage before formal assets.",
  },
  {
    scope: "stage_exit",
    stageTypes: ["production_asset_detail"],
    coordinates: ["production", "directing", "casting", "production_design", "wardrobe", "makeup_hair", "props", "continuity", "vfx_sfx"],
    purpose: "Before asset_sync, verify formal asset packages, identity boards, casting decisions, and department prep are traceable.",
  },
  {
    scope: "stage_exit",
    stageTypes: ["asset_sync"],
    coordinates: ["production", "production_design", "wardrobe", "makeup_hair", "props", "lighting", "continuity", "vfx_sfx", "ui_interaction"],
    purpose: "Before storyboard, verify scene_visual_pack and scene_asset_variant_pack reflect only the current scene/node state and reusable fingerprints.",
  },
  {
    scope: "stage_exit",
    stageTypes: ["storyboard"],
    coordinates: ["production", "directing", "cinematography", "lighting", "performance_directing", "action_choreography", "continuity", "sound_music"],
    purpose: "Before prompt/ref-pack work, verify storyboard panels carry camera, lighting, performance, action, timing, and continuity intent.",
  },
  {
    scope: "stage_exit",
    stageTypes: ["prompt", "expensive_generation_planning"],
    coordinates: ["production", "cinematography", "lighting", "performance_directing", "action_choreography", "props", "continuity", "vfx_sfx", "sound_music"],
    purpose: "Before media generation, verify prompt, reference, and video-unit readiness.",
  },
  {
    scope: "episode_wrap",
    stageTypes: ["expensive_generation_planning"],
    coordinates: [...PRODUCTION_PREP_CANONICAL_DEPARTMENTS],
    purpose: "At episode or production-block wrap, summarize all department readiness, repair tickets, soft holds, and human intervention tasks.",
  },
  {
    scope: "phase_wrap",
    stageTypes: ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning"],
    coordinates: [...PRODUCTION_PREP_CANONICAL_DEPARTMENTS],
    purpose: "At major production phase wrap, verify cross-department coverage without inserting a new formal workflow stage.",
  },
];

export const buildDepartmentAgentSystem = () => ({
  schemaVersion: "department-agent-system.v1",
  status: "department_agent_contract_available",
  coordinationPrinciple: "Department agents are horizontal specialists. They do not add or reorder formal workflow stages; production coordination runs at stage exits and wrap scopes.",
  canonicalPrepDepartments: PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  legacyPrepDepartments: PRODUCTION_PREP_LEGACY_DEPARTMENTS,
  legacyAliases: PRODUCTION_PREP_DEPARTMENT_ALIASES,
  departmentAgents: DEPARTMENT_AGENT_SPECS,
  coordinationPoints: DEPARTMENT_COORDINATION_POINTS,
  coordinationScopes: ["stage_exit", "episode_wrap", "phase_wrap", "manual_audit"],
  coordinationArtifacts: ["production_coordination_report", "department_handoff_manifest", "coordination_repair_ticket"],
  manualPreparationCollaboration: {
    schemaVersion: "manual-film-team-collaboration.v1",
    waves: MANUAL_FILM_TEAM_COLLABORATION_WAVES,
    orderedDepartments: MANUAL_FILM_TEAM_DEPARTMENT_ORDER,
    dependencies: Object.fromEntries(MANUAL_FILM_TEAM_DEPARTMENT_ORDER.map((department) => [department, manualFilmTeamDependencies(department)])),
    handoffContract: ["fromDepartment", "toDepartments", "sceneId", "topic", "request", "priority"],
    sourceSnapshotContract: ["collaborationSourceHash", "collaborationSourceVersions", "collaborationHandoffIds"],
    productionCoordinationPasses: ["initial_dependency_brief", "final_specialist_reconciliation"],
  },
  modeDepartmentPolicies: {
    "movie": {
      requiredForFormal: ["production_design", "wardrobe", "makeup_hair", "props", "continuity", "cinematography", "lighting", "performance_directing"],
      conditional: ["action_choreography", "vfx_sfx", "extras_stunts", "sound_music"],
      note: "Feature/film production should keep full department coverage for formal delivery.",
    },
    "tv-series": {
      requiredForFormal: ["production_design", "wardrobe", "makeup_hair", "props", "continuity", "cinematography", "lighting", "performance_directing"],
      conditional: ["action_choreography", "vfx_sfx", "extras_stunts", "sound_music"],
      note: "Series production may lock by block, but the current block still needs full formal department coverage.",
    },
    "short-drama": {
      requiredForFormal: ["production_design", "wardrobe", "makeup_hair", "props", "continuity", "cinematography", "lighting", "performance_directing"],
      conditional: ["action_choreography", "vfx_sfx", "extras_stunts", "sound_music"],
      note: "Short drama uses the same formal department coverage within the locked episode block.",
    },
    "unit-series": {
      requiredForFormal: ["production_design", "wardrobe", "makeup_hair", "props", "continuity", "cinematography", "lighting", "performance_directing"],
      conditional: ["action_choreography", "vfx_sfx", "extras_stunts", "sound_music"],
      note: "Unit series may reuse departments per unit, but each locked unit needs formal prep coverage.",
    },
    "interactive": {
      requiredForFormal: ["production_design", "wardrobe", "makeup_hair", "props", "continuity", "cinematography", "lighting", "performance_directing", "ui_interaction"],
      conditional: ["action_choreography", "vfx_sfx", "extras_stunts", "sound_music"],
      note: "Interactive production also requires UI/interaction coverage for locked graph nodes, choices, variables, endings, and failure paths.",
    },
    "ai-video-sample": {
      requiredForFormal: ["continuity", "cinematography", "lighting", "performance_directing"],
      conditional: ["action_choreography", "vfx_sfx"],
      optionalSoftHold: ["production_design", "wardrobe", "makeup_hair", "props", "extras_stunts", "sound_music"],
      note: "Sample/prototype mode keeps minimal camera, lighting, performance, and continuity coverage; asset departments remain visible as optional soft holds instead of hard blocks.",
    },
  },
  requiredBehavior: [
    "Use production_breakdown as the first department-wide coordination point after script/content/block lock.",
    "Use production_coordination_report at asset_sync, storyboard, prompt, and expensive_generation_planning exits; do not insert a new formal stage.",
    "Use episode_wrap or phase_wrap to coordinate all department agents for a delivered episode, block, or authorized production batch.",
    "Missing formal department prep may be a soft_hold in draft/sample mode, but formal delivery must expose the gap in cockpit and coordination reports.",
    "Manual and automatic preparation must follow the same acyclic collaboration waves; specialists consume confirmed upstream briefs and directed handoffs instead of every department's raw output.",
    "A relevant peer version or directed handoff change invalidates only affected downstream outputs; production coordination performs one final reconciliation before continuity closes the unit.",
    "Legacy wardrobe_makeup/location_art artifacts must remain readable and must expand to wardrobe + makeup_hair and production_design for coverage.",
  ],
});
