import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);
const frontendRoots = ["src/pages", "src/components", "src/hooks", "apps/web/src/features/script"];

const collectFiles = (entry: string): string[] => {
  const stat = statSync(entry);
  if (stat.isFile()) return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  return readdirSync(entry).flatMap((child) => collectFiles(path.join(entry, child)));
};

const read = (filePath: string) => readFileSync(filePath, "utf8");

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  assert.equal(source.includes("services/ai"), false, `${filePath} should use aiClient for AI calls`);
}

const clientSource = read("apps/web/src/clients/aiClient.ts");
assert.ok(clientSource.includes("../../../../src/services/ai"), "aiClient should be the compatibility edge for existing AI runtime");

const unrestrictedModelRuntimeFiles = [
  "src/services/ai.ts",
  "apps/api/src/providers/genericAIProvider.ts",
  "apps/web/src/clients/interactiveAuthoringClient.ts",
  "src/services/interactive/interactiveContentPlanningService.ts",
  "src/services/interactive/interactiveGraphAuthoringService.ts",
  "src/server/providers/kieGrokImage.ts",
  "src/server/providers/kieGrokVideo.ts",
  "src/server/providers/comfyUIH3Video.ts",
];
for (const filePath of unrestrictedModelRuntimeFiles) {
  const source = read(filePath);
  assert.equal(/max_tokens|maxOutputTokens|maxTotalOutputTokens/i.test(source), false, `${filePath} must not impose model output limits`);
  // Transport deadlines prevent endless pending requests; they are not output limits.
}
assert.ok(read("apps/api/src/providers/genericAIProvider.ts").includes("AbortSignal.timeout(180_000)"), "Provider transports must have a finite timeout rather than hanging indefinitely");

console.log("AI client boundary self-check passed.");
