import { createContext } from "react";
import type { interactiveClient } from "../../clients/interactiveProductionClient";

export type InteractivePlayerClient = Pick<typeof interactiveClient,
  "getExperience" | "getLatestRuntimeBuild" | "getPlaytestCheckpoint" | "savePlaytestCheckpoint"
  | "createRuntimeBuild" | "createStructurePreviewBuild" | "getRuntimeStoryManifest" | "getRuntimeMediaManifest">;

// The exported player uses the same UI and interpreter, with a local snapshot adapter.
export const InteractivePlayerServices = createContext<{ client: InteractivePlayerClient; standalone?: boolean } | null>(null);
