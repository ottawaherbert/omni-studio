import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);
const frontendRoots = ["src/pages", "src/components", "src/hooks", "apps/web/src/features/writing"];

const collectFiles = (entry: string): string[] => {
  const stat = statSync(entry);
  if (stat.isFile()) return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  return readdirSync(entry).flatMap((child) => collectFiles(path.join(entry, child)));
};

const read = (filePath: string) => readFileSync(filePath, "utf8");

const forbiddenImports = [
  /from\s+["'][^"']*services\//,
  /from\s+["'][^"']*store\/use[A-Za-z0-9]+["']/,
  /from\s+["'][^"']*features\/legacy\/legacyStores["']/,
  /from\s+["'][^"']*types\//,
  /from\s+["']@google\/genai["']/,
  /import\s*\(\s*["']@google\/genai["']\s*\)/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /import\s*\(\s*["']@anthropic-ai\/sdk["']\s*\)/,
  /from\s+["']openai["']/,
  /import\s*\(\s*["']openai["']\s*\)/,
];

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  for (const pattern of forbiddenImports) {
    assert.equal(pattern.test(source), false, `${filePath} should depend on clients and DTO boundaries`);
  }

  assert.equal(source.includes("\"/api/"), false, `${filePath} should not hard-code local API paths`);
  assert.equal(source.includes("'/api/"), false, `${filePath} should not hard-code local API paths`);
  assert.equal(source.includes("`/api/"), false, `${filePath} should not hard-code local API paths`);
}
const writingClientSource = read("apps/web/src/clients/writingClient.ts");
const writingDtoSource = read("packages/domain/src/writingApi.ts");
assert.equal(writingClientSource.includes("WritingAgentRetryRequest"), false, "Writing client should not expose the legacy direct-retry DTO");
assert.equal(writingClientSource.includes("retryAgentJob"), false, "Writing client should not expose direct job retry");
assert.ok(writingClientSource.includes("WritingPromptExecutionManifestPreviewResponse"), "Writing client should consume the shared manifest-preview DTO");
assert.ok(writingClientSource.includes("previewAgentJobManifest"), "Writing client should preview the execution manifest before regenerated work");
assert.ok(writingClientSource.includes("createAgentJob"), "Writing client should create confirmed replacement jobs through the guarded create endpoint");
assert.ok(writingClientSource.includes("WritingAgentResourceDraftActionRequest"), "Writing client should use shared resource draft DTO");
assert.ok(writingClientSource.includes("adoptAgentResourceDraft"), "Writing client should expose resource draft adoption");
assert.ok(writingClientSource.includes("discardAgentResourceDraft"), "Writing client should expose resource draft discard");
assert.ok(writingDtoSource.includes("resourceTypes"), "Writing resource draft DTO should expose resource type selection");

console.log("Frontend client/DTO boundary self-check passed.");
