import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);

const collectFiles = (entry: string): string[] => {
  const stat = statSync(entry);
  if (stat.isFile()) return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  return readdirSync(entry).flatMap((child) => collectFiles(path.join(entry, child)));
};

const read = (filePath: string) => readFileSync(filePath, "utf8");

const frontendRoots = ["src/pages", "src/components", "src/hooks", "apps/web/src/features/writing"];
const projectStoreImport = /from\s+["'][^"']*store\/useProjectStore["']/;
const productionStoreImport = /from\s+["'][^"']*store\/useProductionStore["']/;
const directProjectStoreAllowlist = new Set([
  "src/components/Layout.tsx",
  "src/components/assistant/GlobalAssistant.tsx",
]);

for (const filePath of frontendRoots.flatMap(collectFiles)) {
  const source = read(filePath);
  assert.equal(
    productionStoreImport.test(source),
    false,
    `${filePath} must not reintroduce the retired AutoStudio execution store`,
  );
  if (projectStoreImport.test(source)) {
    assert.equal(
      directProjectStoreAllowlist.has(filePath),
      true,
      `${filePath} should use the compatibility client rather than importing ProjectStore directly`,
    );
  }
}

const bridgeSource = read("src/features/legacy/legacyStores.ts");
assert.ok(bridgeSource.includes("useProjectStore"), "legacy store bridge should expose project compatibility");
assert.equal(
  bridgeSource.includes("useProductionStore"),
  false,
  "retired AutoStudio state must not remain in the frontend legacy-store bridge",
);
assert.equal(
  existsSync("src/store/useProductionStore.ts"),
  false,
  "the unmounted AutoStudio execution store must stay deleted",
);

console.log("Frontend legacy store boundary self-check passed.");
