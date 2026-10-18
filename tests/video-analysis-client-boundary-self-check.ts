import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = readFileSync("apps/web/src/clients/videoAnalysisClient.ts", "utf8");
const storeSource = readFileSync("src/store/useVideoAnalysisStore.ts", "utf8");

assert.ok(clientSource.includes("/api/video-analysis/projects"), "videoAnalysisClient should own video-analysis API paths");
assert.ok(storeSource.includes("videoAnalysisClient"), "video analysis store should use videoAnalysisClient");
assert.equal(storeSource.includes("fetch("), false, "video analysis store should not call fetch directly");

const clientLineCount = clientSource.trimEnd().split(/\r?\n/).length;
assert.ok(clientLineCount <= 180, `videoAnalysisClient should stay small; found ${clientLineCount} lines`);

console.log("Video analysis client boundary self-check passed.");
