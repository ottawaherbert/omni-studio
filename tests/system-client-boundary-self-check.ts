import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const settingsSource = read("src/pages/Settings.tsx");
const systemClientSource = read("apps/web/src/clients/systemClient.ts");
const domainIndexSource = read("packages/domain/src/index.ts");
const systemDtoSource = read("packages/domain/src/system.ts");

assert.ok(settingsSource.includes("systemClient"), "Settings should use systemClient");
assert.equal(settingsSource.includes("/api/system/gc"), false, "Settings should not hard-code system GC API paths");
assert.ok(systemClientSource.includes("/api/system/gc"), "systemClient should own system API paths");
assert.ok(systemClientSource.includes("packages/domain/src/system"), "systemClient should use shared system DTOs");
assert.ok(domainIndexSource.includes("./system"), "domain package should export system DTOs");
assert.ok(systemDtoSource.includes("SystemGarbageCollectionResponse"), "shared domain package should define system response DTOs");

console.log("System client boundary self-check passed.");
