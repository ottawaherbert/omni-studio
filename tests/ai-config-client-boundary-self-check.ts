import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const storeSource = read("src/store/useAIConfigStore.ts");
const clientSource = read("apps/web/src/clients/aiConfigClient.ts");
const domainIndexSource = read("packages/domain/src/index.ts");
const aiConfigDtoSource = read("packages/domain/src/aiConfig.ts");

assert.ok(storeSource.includes("aiConfigClient"), "useAIConfigStore should use aiConfigClient");
assert.equal(storeSource.includes("fetch("), false, "useAIConfigStore should not call fetch directly");
assert.equal(storeSource.includes("/api/ai-config"), false, "useAIConfigStore should not hard-code AI config API paths");
assert.ok(clientSource.includes("/api/ai-config"), "aiConfigClient should own AI config API paths");
assert.ok(clientSource.includes("/api/provider-key-status"), "aiConfigClient should own provider status API paths");
assert.ok(clientSource.includes("packages/domain/src/aiConfig"), "aiConfigClient should use shared AI config DTOs");
assert.ok(domainIndexSource.includes("./aiConfig"), "domain package should export AI config DTOs");
assert.ok(aiConfigDtoSource.includes("AIConfigDTO"), "shared domain package should define AIConfigDTO");

console.log("AI config client boundary self-check passed.");
