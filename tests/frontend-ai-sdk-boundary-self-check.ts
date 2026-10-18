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

const forbiddenSdkImports = [
  /from\s+["']@google\/genai["']/,
  /import\s*\(\s*["']@google\/genai["']\s*\)/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /import\s*\(\s*["']@anthropic-ai\/sdk["']\s*\)/,
  /from\s+["']openai["']/,
  /import\s*\(\s*["']openai["']\s*\)/,
];

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  for (const pattern of forbiddenSdkImports) {
    assert.equal(pattern.test(source), false, `${filePath} should access AI SDK helpers through clients`);
  }
}

const aiSchemaClientSource = read("apps/web/src/clients/aiSchemaClient.ts");
assert.ok(aiSchemaClientSource.includes("@google/genai"), "aiSchemaClient should own the schema SDK edge");

console.log("Frontend AI SDK boundary self-check passed.");
