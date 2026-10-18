import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const collectTypeScriptFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectTypeScriptFiles(fullPath);
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });

const writingClientSource = read("apps/web/src/clients/writingClient.ts");
const assetClientSource = read("apps/web/src/clients/assetClient.ts");
const productionClientSource = read("apps/web/src/clients/productionClient.ts");
const skillClientSource = read("apps/web/src/clients/skillClient.ts");
const aiConfigClientSource = read("apps/web/src/clients/aiConfigClient.ts");
const systemClientSource = read("apps/web/src/clients/systemClient.ts");
const domainTypesClientSource = read("apps/web/src/clients/domainTypes.ts");
const writingRoutesSource = read("apps/api/src/routes/writing/writingRoutes.ts");
const domainIndexSource = read("packages/domain/src/index.ts");

assert.ok(domainIndexSource.includes("./aiConfig"), "domain package should export AI config DTOs");
assert.ok(domainIndexSource.includes("./asset"), "domain package should export asset DTOs");
assert.ok(domainIndexSource.includes("./creativeSource"), "domain package should export creative source projection DTOs");
assert.ok(domainIndexSource.includes("./game"), "domain package should export game DTOs");
assert.ok(domainIndexSource.includes("./project"), "domain package should export project DTOs");
assert.ok(domainIndexSource.includes("./writing"), "domain package should export writing DTOs");
assert.ok(domainIndexSource.includes("./production"), "domain package should export production DTOs");
assert.ok(domainIndexSource.includes("./skill"), "domain package should export skill DTOs");
assert.ok(domainIndexSource.includes("./system"), "domain package should export system DTOs");
assert.ok(domainIndexSource.includes("./videoAnalysis"), "domain package should export video analysis DTOs");
assert.ok(assetClientSource.includes("packages/domain/src/asset"), "assetClient should consume shared asset DTOs");
assert.ok(writingClientSource.includes("packages/domain/src/writing"), "writingClient should consume shared writing DTOs");
assert.ok(writingRoutesSource.includes("packages/domain/src/writing"), "writingRoutes should consume shared writing DTOs");
assert.ok(productionClientSource.includes("packages/domain/src/production"), "productionClient should consume shared production DTOs");
assert.ok(skillClientSource.includes("packages/domain/src/skill"), "skillClient should consume shared skill DTOs");
assert.ok(aiConfigClientSource.includes("packages/domain/src/aiConfig"), "aiConfigClient should consume shared AI config DTOs");
assert.ok(systemClientSource.includes("packages/domain/src/system"), "systemClient should consume shared system DTOs");
assert.ok(domainTypesClientSource.includes("packages/domain/src/project"), "domainTypes should consume shared project DTOs");
assert.ok(domainTypesClientSource.includes("packages/domain/src/production"), "domainTypes should consume shared production DTOs");
assert.equal(
  writingClientSource.includes("export interface CreateWritingProjectRequest"),
  false,
  "writingClient must not define API request DTOs locally",
);
assert.equal(productionClientSource.includes("../types/production"), false, "productionClient should use shared DTOs");
assert.equal(productionClientSource.includes("../types/project"), false, "productionClient should use shared DTOs");

for (const filePath of collectTypeScriptFiles("packages/domain/src")) {
  const source = read(filePath);
  const lineCount = source.trimEnd().split(/\r?\n/).length;
  assert.ok(lineCount <= 180, `${filePath} should stay small; found ${lineCount} lines`);
  assert.equal(source.includes("from \"react\""), false, `${filePath} should not depend on React`);
  assert.equal(source.includes("fetch("), false, `${filePath} should not perform HTTP`);
}

console.log("Domain DTO boundary self-check passed.");
