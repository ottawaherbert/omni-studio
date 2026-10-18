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
  /from\s+["'][^"']*store\/use[A-Za-z0-9]+["']/,
  /from\s+["'][^"']*features\/legacy\/legacyStores["']/,
];

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  for (const pattern of forbiddenImports) {
    assert.equal(pattern.test(source), false, `${filePath} should access UI state through clients/stateClient`);
  }
}

const stateClientSource = read("apps/web/src/clients/stateClient.ts");
for (const edge of [
  "../../../../src/features/legacy/legacyStores",
  "../../../../src/store/useAIConfigStore",
  "../../../../src/store/useGameStore",
  "../../../../src/store/useGlobalStore",
  "../../../../src/store/usePromptStore",
  "../../../../src/store/useSettingsStore",
  "../../../../src/store/useSkillStore",
  "../../../../src/store/useSpatialStore",
  "../../../../src/store/useVideoAnalysisStore",
]) {
  assert.ok(stateClientSource.includes(edge), `stateClient should own compatibility edge to ${edge}`);
}

console.log("Frontend state client boundary self-check passed.");
