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

const forbiddenTypeImports = [
  "types/project",
  "types/production",
  "types/game",
  "types/videoAnalysis",
];

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  for (const forbidden of forbiddenTypeImports) {
    assert.equal(source.includes(forbidden), false, `${filePath} should import shared DTOs through clients/domainTypes`);
  }
}

const domainTypesSource = read("apps/web/src/clients/domainTypes.ts");
assert.ok(domainTypesSource.includes("packages/domain/src/project"), "domainTypes should expose project DTOs");
assert.ok(domainTypesSource.includes("packages/domain/src/production"), "domainTypes should expose production DTOs");
assert.ok(domainTypesSource.includes("packages/domain/src/game"), "domainTypes should expose game DTOs");
assert.ok(domainTypesSource.includes("packages/domain/src/videoAnalysis"), "domainTypes should expose video analysis DTOs");

console.log("Frontend domain types boundary self-check passed.");
