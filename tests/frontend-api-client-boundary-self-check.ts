import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);
const frontendRoots = ["src/pages", "src/components", "src/hooks", "src/store", "src/utils", "apps/web/src/features/writing"];

const collectFiles = (entry: string): string[] => {
  const stat = statSync(entry);
  if (stat.isFile()) return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  return readdirSync(entry).flatMap((child) => collectFiles(path.join(entry, child)));
};

const read = (filePath: string) => readFileSync(filePath, "utf8");

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  assert.equal(source.includes("\"/api/"), false, `${filePath} should not hard-code local API paths`);
  assert.equal(source.includes("'/api/"), false, `${filePath} should not hard-code local API paths`);
  assert.equal(source.includes("`/api/"), false, `${filePath} should not hard-code local API paths`);
}

console.log("Frontend API client boundary self-check passed.");
