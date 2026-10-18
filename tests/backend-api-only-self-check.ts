import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const collectRouteFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectRouteFiles(fullPath);
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });

const packageSource = read("package.json");
const serverSource = read("server.ts");
const apiDoc = read("apps/api/README.md");

assert.ok(packageSource.includes("\"dev:backend\""), "package.json should expose a backend dev script");
assert.ok(packageSource.includes("OMNI_API_ONLY=true"), "backend dev script should start API-only mode");
assert.ok(serverSource.includes('process.env.OMNI_API_ONLY === "true"'), "server should read OMNI_API_ONLY");
assert.ok(serverSource.includes("if (!apiOnly && process.env.NODE_ENV !== \"production\")"), "Vite middleware must be disabled in API-only mode");
assert.ok(serverSource.includes("} else if (!apiOnly)"), "static frontend serving must be disabled in API-only mode");
assert.ok(serverSource.includes("WRITING_AGENT_WORKER_ENABLED"), "server should expose Writing Agent worker enable switch");
assert.ok(serverSource.includes("createWritingAgentScheduler"), "server should start the Writing Agent scheduler shell");
assert.ok(serverSource.indexOf('app.use("/api"') < serverSource.indexOf("const apiOnly"), "API fallback should be registered before frontend serving");
assert.ok(apiDoc.includes("API code must not import React pages or frontend stores"), "API split rules should forbid frontend imports");

for (const filePath of [
  ...collectRouteFiles("src/server/routes"),
  ...collectRouteFiles("apps/api/src/routes"),
]) {
  const source = read(filePath);
  assert.equal(source.includes("createServer as createViteServer"), false, `${filePath} must not depend on Vite`);
  assert.equal(source.includes("from \"react\""), false, `${filePath} must not import React`);
  assert.equal(source.includes("store/use"), false, `${filePath} must not import frontend stores`);
}

const lineCount = serverSource.trimEnd().split(/\r?\n/).length;
assert.ok(lineCount <= 420, `server.ts should stay slim after route extraction; found ${lineCount} lines`);

console.log("Backend API-only self-check passed.");
