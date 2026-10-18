import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const listTypeScriptFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listTypeScriptFiles(fullPath);
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });

const clientSource = read("apps/web/src/clients/productionClient.ts");
const persistenceSource = read("src/services/production/persistence.ts");
const storeRepositorySource = read("src/services/production/storeProductionRepository.ts");

assert.ok(clientSource.includes("/api/production-runs"), "productionClient should own ProductionRun HTTP paths");
assert.ok(clientSource.includes("/api/projects/"), "productionClient should own legacy episode HTTP reads for production");
assert.ok(clientSource.includes("/api/operator/artifacts"), "productionClient should own operator artifact HTTP reads for production");
assert.ok(clientSource.includes("/api/operator/runs"), "productionClient should own operator run HTTP writes for production");
assert.ok(clientSource.includes("/api/prompts/"), "productionClient should own production template HTTP reads");
assert.ok(clientSource.includes("X-Production-Run-Base-Revision"), "productionClient should preserve run conflict headers");
assert.equal(persistenceSource.includes("fetch("), false, "ProductionRun persistence should not call fetch directly");
assert.ok(persistenceSource.includes("productionClient"), "ProductionRun persistence should go through productionClient");
assert.equal(storeRepositorySource.includes("fetch("), false, "storeProductionRepository should not call fetch directly");
assert.ok(storeRepositorySource.includes("productionClient"), "storeProductionRepository should go through productionClient");

for (const filePath of [
  ...listTypeScriptFiles("src/services/production"),
  ...listTypeScriptFiles("packages/production/src/services/production"),
]) {
  const source = read(filePath);
  assert.equal(source.includes("fetch("), false, `${filePath} should go through productionClient instead of fetch`);
}

const clientLineCount = clientSource.trimEnd().split(/\r?\n/).length;
assert.ok(clientLineCount <= 180, `productionClient should stay small; found ${clientLineCount} lines`);

console.log("Production client boundary self-check passed.");
