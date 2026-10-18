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
  assert.equal(source.includes("services/"), false, `${filePath} should access service capabilities through clients`);
}

const clientEdges = [
  ["apps/web/src/clients/interactiveProductionClient.ts", "../../../../src/services/interactive/interactiveAuthoringStatusProjection"],
  ["apps/web/src/clients/operatorTypes.ts", "../../../../src/services/operator/types"],
  ["apps/web/src/clients/productionAutomationClient.ts", "../../../../src/services/production/agents"],
  ["apps/web/src/clients/productionModeClient.ts", "../../../../src/services/production/productionMode"],
  ["apps/web/src/clients/productionPromptClient.ts", "../../../../src/services/production/templateLoader"],
  ["apps/web/src/clients/productionRuleQaClient.ts", "../../../../src/services/production/ruleQa"],
  ["apps/web/src/clients/referenceGovernanceClient.ts", "../../../../src/services/production/referenceGovernance"],
] as const;

for (const [clientPath, serviceEdge] of clientEdges) {
  assert.ok(read(clientPath).includes(serviceEdge), `${clientPath} should own the compatibility edge to ${serviceEdge}`);
}

console.log("Frontend service client boundary self-check passed.");
