export const PROJECT_TYPES = {
  MOVIE: "movie",
  TV_SERIES: "tv-series",
  SHORT_DRAMA: "short-drama",
} as const;

export const ASSET_TYPES = {
  CHARACTER: "character",
  LOCATION: "location",
  PROP: "prop",
  BGM: "bgm",
} as const;

export const SCRIPT_BLOCK_TYPES = {
  SCENE_HEADING: "scene_heading",
  ACTION: "action",
  CHARACTER: "character",
  DIALOGUE: "dialogue",
  PARENTHETICAL: "parenthetical",
  TRANSITION: "transition",
} as const;

export const VALUE_CHARGES = {
  POSITIVE: "positive",
  NEGATIVE: "negative",
  NEUTRAL: "neutral",
} as const;

export const AUDIO_TRACK_TYPES = {
  DIALOGUE: "dialogue",
  BGM: "bgm",
  SFX: "sfx",
} as const;

export const SHOT_SIZES = {
  EWS: "EWS",
  WS: "WS",
  FS: "FS",
  MS: "MS",
  MCU: "MCU",
  CU: "CU",
  ECU: "ECU",
} as const;

export const CAMERA_ANGLES = {
  EYE_LEVEL: "Eye-Level",
  HIGH: "High",
  LOW: "Low",
  BIRD: "Bird",
  WORM: "Worm",
  DUTCH: "Dutch",
} as const;

export const CAMERA_MOVEMENTS = {
  STATIC: "Static",
  PAN: "Pan",
  TILT: "Tilt",
  TRACK: "Track",
  ZOOM: "Zoom",
  PUSH_IN: "Push-in",
  PULL_OUT: "Pull-out",
  HANDHELD: "Handheld",
} as const;

export const SHOT_TRANSITIONS = {
  NONE: "none",
  FADE: "fade",
  BLACK: "black",
} as const;
