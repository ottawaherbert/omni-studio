export type VideoGenerationMode = "shot" | "storyboard";

export const normalizeVideoGenerationMode = (value: unknown): VideoGenerationMode =>
  value === "storyboard" ? "storyboard" : "shot";
