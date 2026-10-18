import assert from "node:assert/strict";

import type { Project } from "../src/types/project";
import { buildProductionProjectAssetReadModel } from "../src/services/production/productionProjectAssets";
import { buildVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";

const project = {
  id: "voice-only-assets",
  title: "声音角色视觉边界",
  type: "movie",
  aspectRatio: "16:9",
  logline: "",
  coreConflict: "",
  episodes: [],
  characters: [
    { id: "character-lead", name: "主角", visualPresence: "onscreen" },
    { id: "character-caller", name: "来电者（声音）", visualPresence: "voice_only" },
  ],
  assets: [
    { id: "char-character-caller", type: "character", name: "来电者（声音）", description: "声音角色镜像" },
  ],
} as Project;

const library = buildProductionProjectAssetReadModel(project, []);
assert.deepEqual(library.assets.map((asset) => asset.id), ["character-lead"]);
const boards = buildVideoStoryboardAssetBoardPlan(project);
assert.deepEqual(boards.characterBoards.map((board) => board.assetId), ["character-lead"]);

console.log("Production voice-only assets self-check passed.");
