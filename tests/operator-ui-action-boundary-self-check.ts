import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const source = (filePath: string) => readFileSync(path.join(rootDir, filePath), "utf8");

const operatorClientSource = source("apps/web/src/clients/operatorClient.ts");
for (const snippet of [
  "createCreativeChange",
  "createCastingDecision",
  "createCastingCandidate",
  "createStoryboardStrategyTrial",
  "createStoryboardStrategyPromotion",
  "getOperatorRuns",
  "getOperatorArtifacts",
  "getOperatorAssets",
  "getProductionCockpit",
  "createLegacyProductionDraft",
  "createStyleReferenceAnalysis",
  "createStyleLockChangeOrder",
]) {
  assert.ok(operatorClientSource.includes(snippet), `operatorClient missing ${snippet}`);
}

// DepartmentBoardsPanel was retired. Check the current advanced UI through its shared client.
const previsPage = source("src/pages/Previs.tsx");
assert.equal(/fetch\s*\(/.test(previsPage), false, "virtual production UI must use its shared transport client");
assert.ok(previsPage.includes("clients/previsClient"));
const server = source("server.ts");
assert.ok(server.includes("registerPrevisRoutes(app, generationEngine.media)"));
assert.ok(server.includes("basePath: '/api/operator/previs', assertProjectAccess: assertOperatorProjectAccess"));

console.log("Operator UI action boundary self-check passed.");
