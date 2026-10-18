import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const sourceExtensions = new Set([".ts", ".tsx"]);

const collectFiles = (entry: string): string[] => {
  const stat = statSync(entry);
  if (stat.isFile()) return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  return readdirSync(entry).flatMap((child) => collectFiles(path.join(entry, child)));
};

const checkedSources = [
  "src/store/slices/projectSlice.ts",
  "src/store/slices/episodeSlice.ts",
  "src/utils/saveFailureRecovery.ts",
];

for (const filePath of checkedSources) {
  const source = read(filePath);
  assert.ok(source.includes("legacyProjectClient"), `${filePath} should use legacyProjectClient`);
  assert.equal(source.includes("/api/projects"), false, `${filePath} should not hard-code legacy project API paths`);
  assert.equal(source.includes("fetch("), false, `${filePath} should not call fetch directly`);
}

const clientSource = read("apps/web/src/clients/legacyProjectClient.ts");
assert.ok(clientSource.includes("/api/projects"), "legacyProjectClient should own legacy project API paths");
assert.ok(clientSource.includes("?view=summary"), "project lists should request lightweight summaries");
assert.ok(clientSource.includes('LegacyProjectView = "shell" | "production-workspace"'), "project loading should distinguish general and production workspace shells");
assert.ok(clientSource.includes("new URLSearchParams({ view })"), "project loading should build a named, encoded view query");
assert.ok(clientSource.includes('"production-preparation"'), "production preparation should request a workspace-sized episode payload");
assert.ok(clientSource.includes('"storyboard"'), "storyboard should request a workspace-sized episode payload");
assert.ok(clientSource.includes("projectRequests"), "concurrent project shell reads should be deduplicated");
assert.ok(clientSource.includes("episodeRequests"), "concurrent episode reads should be deduplicated");
assert.ok(clientSource.includes("getEpisode"), "legacyProjectClient should expose episode reads");
assert.ok(clientSource.includes("saveEpisode"), "legacyProjectClient should expose episode writes");

const originalFetch = globalThis.fetch;
const requestedUrls: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  requestedUrls.push(String(input));
  return new Response(JSON.stringify({ id: "project-boundary" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;
try {
  const { legacyProjectClient } = await import("../apps/web/src/clients/legacyProjectClient");
  await legacyProjectClient.getProject("project/with spaces", "production-workspace", {
    sourceDocumentId: "unit/01",
  });
  assert.equal(
    requestedUrls[0],
    "/api/projects/project%2Fwith%20spaces?view=production-workspace&sourceDocumentId=unit%2F01",
    "project loading should request the named shell with encoded identifiers before loading episode bodies",
  );
} finally {
  globalThis.fetch = originalFetch;
}

const frontendRoots = ["src/pages", "src/components", "src/hooks", "src/store", "src/utils", "apps/web/src/features/writing"];
for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  assert.equal(source.includes("/api/projects"), false, `${filePath} should use legacyProjectClient for project API paths`);
}

console.log("Legacy project client boundary self-check passed.");
