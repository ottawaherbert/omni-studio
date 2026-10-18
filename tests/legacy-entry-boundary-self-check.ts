import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const appSource = read("src/App.tsx");
const layoutSource = read("src/components/Layout.tsx");
const legacyDomainSource = read("src/domains/legacy/project.ts");

assert.ok(appSource.includes('<Route index element={<Navigate to="/writing" replace />} />'), "root route should enter Writing");
assert.ok(appSource.includes('path="projects" element={<Navigate to="/writing" replace />}'), "/projects should only remain as a Writing compatibility redirect");
assert.ok(appSource.includes('path="new-project" element={<Navigate to="/writing" replace />}'), "/new-project should redirect to Writing");
assert.ok(appSource.includes('path="legacy/new-project" element={<LegacyNewProjectRedirect />}'), "legacy new-project links should use the compatibility redirect");
assert.ok(appSource.includes('params.get("projectModel") === "interactive" ? "/interactive/new" : "/writing"'), "legacy intake should route to the current interactive or Writing creator");
assert.equal(existsSync("src/pages/Home.tsx"), false, "legacy mixed project intake must not remain in the product");
assert.equal(appSource.includes('import("./pages/AutoStudio")'), false, "AutoStudio must not remain a current product route");
assert.equal(appSource.includes('import("./pages/AutoStudioAudit")'), false, "AutoStudio audit must not remain a current product route");
assert.ok(appSource.includes("LegacyAutoStudioRedirect"), "Historical AutoStudio links should have an explicit compatibility redirect");
assert.ok(appSource.includes("/production/preparation"), "Historical AutoStudio links should enter current production preparation");
assert.equal(existsSync("src/pages/Projects.tsx"), false, "Project Plaza page must not remain in the product");
assert.equal(layoutSource.includes('path: "/projects"'), false, "main navigation must not expose Project Plaza");
assert.equal(layoutSource.includes("legacyProjectNavItems"), false, "the retired Bible-to-Studio workflow must not remain in the global header");
assert.ok(layoutSource.includes(": isInteractiveProductionRoute ? interactiveProductionNavItems : []"), "legacy pages must not fall back to a retired workflow header");
assert.equal(existsSync("src/pages/AutoStudio.tsx"), false, "retired AutoStudio page must stay deleted");
assert.equal(existsSync("src/pages/AutoStudioAudit.tsx"), false, "retired AutoStudio audit page must stay deleted");
assert.ok(legacyDomainSource.includes("Legacy types are read-only compatibility aliases."), "legacy namespace should be read-only");
assert.ok(legacyDomainSource.includes("not expanded for new capabilities"), "legacy namespace should forbid new capabilities");

console.log("Legacy entry boundary self-check passed.");
