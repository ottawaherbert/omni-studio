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

for (const filePath of [
  "src/components/storyboard/DepartmentBoardsPanel.tsx",
]) {
  const text = source(filePath);
  assert.equal(
    /fetch\(`?\/api\/operator/.test(text),
    false,
    `${filePath} must call apps/web/src/clients/operatorClient.ts instead of direct Operator fetch`,
  );
  assert.equal(
    text.includes("parseOperatorResponse") || text.includes("parseOperatorAuditResponse"),
    false,
    `${filePath} should not duplicate Operator HTTP parsing`,
  );
  assert.ok(
    text.includes("clients/operatorClient"),
    `${filePath} should import the Operator action client`,
  );
}

console.log("Operator UI action boundary self-check passed.");
