import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { OPERATOR_CORE_DOCUMENTS, buildOperatorCapabilityManifest } from "../src/services/operator/capabilities";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import { createOperatorSecurityPolicy } from "../src/services/operator/security";
import { readOperatorHandbookFromPath, registerOperatorMetadataRoutes } from "../src/server/operatorMetadataRoutes";

// Research and implementation records may coexist with the three entry-point
// documents. Validate the published contract, not an obsolete directory list.
for (const file of ["doc/design.md", "doc/handoff.md", "doc/script-agent-acceptance-matrix.md"]) {
  assert.ok(fs.statSync(file).isFile(), `Required document is missing: ${file}`);
}
assert.equal(fs.existsSync("docs"), false);
assert.equal(fs.existsSync("docs_collab"), false);
assert.deepEqual(OPERATOR_CORE_DOCUMENTS, ["README.md", "doc/design.md", "doc/handoff.md"]);

for (const file of OPERATOR_CORE_DOCUMENTS) {
  const content = fs.readFileSync(file, "utf8");
  for (const [, target] of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target.split("#")[0])), `${file} has broken link: ${target}`);
  }
}

const documentPath = path.resolve("doc/design.md");
const expectedContent = fs.readFileSync(documentPath, "utf8");
const expectedVersion = expectedContent.match(/handbookVersion：`([^`]+)`/)?.[1];
assert.equal(expectedVersion, OPERATOR_HANDBOOK_VERSION, "The served document must explicitly declare the current contract version");
await assert.rejects(readOperatorHandbookFromPath(path.resolve("doc/missing-document.md")), { code: "ENOENT" });

const app = express();
registerOperatorMetadataRoutes(app, { operatorHandbookPath: documentPath, operatorSecurityPolicy: createOperatorSecurityPolicy({}) });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const response = await fetch(`${base}/api/operator/handbook`);
  assert.equal(response.status, 200);
  const handbook = await response.json();
  assert.equal(handbook.path, "doc/design.md");
  assert.equal(handbook.content, expectedContent);
  assert.equal(handbook.handbookVersion, expectedVersion);
  assert.equal(handbook.updatedAt, Math.floor(fs.statSync(documentPath).mtimeMs));

  const capabilities = await (await fetch(`${base}/api/operator/capabilities`)).json();
  assert.equal(capabilities.handbookVersion, handbook.handbookVersion);
  assert.deepEqual(capabilities.upgradeContract.requiredUpdateTargets, buildOperatorCapabilityManifest().upgradeContract.requiredUpdateTargets);
  assert.ok(capabilities.upgradeContract.requiredUpdateTargets.includes("doc/design.md"));
  const workflows = await (await fetch(`${base}/api/operator/workflows`)).json();
  assert.equal(workflows.stageExitPolicy.appliesToEveryStage, true, "Document replacement must preserve batch execution gates");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log("Documentation passed: three current documents, valid links, explicit version, HTTP handbook/capability agreement, preserved batch gates, missing-file failure.");
