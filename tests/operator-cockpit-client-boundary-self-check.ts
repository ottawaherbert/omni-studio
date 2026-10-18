import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const hookSource = read("src/hooks/useProductionCockpit.ts");
const operatorClientSource = read("apps/web/src/clients/operatorClient.ts");

assert.ok(hookSource.includes("getProductionCockpit"), "useProductionCockpit should use operatorClient");
assert.equal(hookSource.includes("/api/operator/projects"), false, "useProductionCockpit should not hard-code operator API paths");
assert.equal(hookSource.includes("fetch("), false, "useProductionCockpit should not call fetch directly");
assert.ok(operatorClientSource.includes("/production-cockpit"), "operatorClient should own production cockpit path");

console.log("Operator cockpit client boundary self-check passed.");
