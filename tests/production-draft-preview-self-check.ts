import assert from "node:assert";
import type { Shot } from "../src/types/project";
import {
  applyShotDraftPreview,
  resolveShotDraftPreviewReference,
} from "../src/services/production/shotDraftPreview";

const formalTake = {
  id: "take-formal",
  imageUrl: "https://example.com/formal.jpg",
  createdAt: 1,
};
const shot: Shot = {
  id: "shot_101",
  imageUrl: formalTake.imageUrl,
  activeTakeId: formalTake.id,
  takes: [formalTake],
};

const updated = applyShotDraftPreview(shot, {
  imageUrl: "https://example.com/draft.jpg",
  sourceHash: "source-v1",
  promptHash: "prompt-v1",
  modelId: "image-model",
  referenceImageUrls: ["https://example.com/reference.jpg"],
  createdAt: 2,
});

assert.notStrictEqual(updated, shot);
assert.equal(updated.draftPreview?.imageUrl, "https://example.com/draft.jpg");
assert.equal(updated.draftPreview?.isProvisional, true);
assert.deepEqual(updated.takes, shot.takes, "draft preview must not create or replace a formal take");
assert.equal(updated.activeTakeId, shot.activeTakeId, "draft preview must not select a formal take");
assert.equal(updated.imageUrl, shot.imageUrl, "draft preview must not replace the formal shot image");
assert.equal(shot.draftPreview, undefined, "draft preview helper must not mutate its input");
assert.deepEqual(
  resolveShotDraftPreviewReference(updated, "source-v1"),
  {
    imageUrl: "https://example.com/draft.jpg",
    sourceHash: "source-v1",
    promptHash: "prompt-v1",
  },
  "a matching preview may be passed to a later formal generation as reference provenance",
);
assert.equal(
  resolveShotDraftPreviewReference(updated, "source-v2"),
  null,
  "a preview from an older storyboard revision must not enter formal generation",
);

console.log("production draft preview self-check passed");
