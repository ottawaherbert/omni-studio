import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { OPERATOR_CORE_DOCUMENTS, buildOperatorCapabilityManifest } from "../src/services/operator/capabilities";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import { OPERATOR_DOCUMENTS } from "../src/services/operator/documents";
import { createOperatorSecurityPolicy } from "../src/services/operator/security";
import { readOperatorHandbookFromPath, registerOperatorMetadataRoutes } from "../src/server/operatorMetadataRoutes";
import { createHash } from 'node:crypto';
import { validatePrevisWorld, validatePrevisPlan, samplePrevisFrame } from '../packages/domain/src/previs';
import type { Project, Scene } from '../src/types/project';

// Research and implementation records may coexist with the entry-point
// documents. Validate the published contract, not an obsolete directory list.
for (const file of ["doc/design.md", "doc/handoff.md", "doc/assistant-removal-checklist.md"]) {
  assert.ok(fs.statSync(file).isFile(), `Required document is missing: ${file}`);
}
assert.equal(fs.existsSync("docs"), false);
assert.equal(fs.existsSync("docs_collab"), false);
assert.deepEqual(OPERATOR_CORE_DOCUMENTS, ["README.md", "doc/agent-guide.md", "doc/design.md", "doc/handoff.md"]);

for (const file of new Set([...OPERATOR_CORE_DOCUMENTS, ...OPERATOR_DOCUMENTS.filter(doc => doc.kind === 'guide').map(doc => doc.path)])) {
  const content = fs.readFileSync(file, "utf8");
  for (const [, target] of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target.split("#")[0])), `${file} has broken link: ${target}`);
  }
}

const documentPath = path.resolve("doc/agent-guide.md");
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
  assert.equal(handbook.path, "doc/agent-guide.md");
  assert.equal(handbook.content, expectedContent);
  assert.equal(handbook.handbookVersion, expectedVersion);
  assert.equal(handbook.updatedAt, Math.floor(fs.statSync(documentPath).mtimeMs));

  const capabilities = await (await fetch(`${base}/api/operator/capabilities`)).json();
  assert.equal(capabilities.handbookVersion, handbook.handbookVersion);
  assert.deepEqual(capabilities.upgradeContract.requiredUpdateTargets, buildOperatorCapabilityManifest().upgradeContract.requiredUpdateTargets);
  assert.ok(capabilities.upgradeContract.requiredUpdateTargets.includes("doc/design.md"));
  assert.ok(capabilities.upgradeContract.requiredUpdateTargets.includes("doc/agent-guide.md"));
  assert.equal(capabilities.interactiveWorkspace.basePath, '/api/interactive/experiences');
  assert.equal(capabilities.workflowCoverage.find((entry: { id: string }) => entry.id === 'interactive-game').coverage, 'legacy_batch_projection_only');
  const { documents } = await (await fetch(`${base}/api/operator/documents`)).json();
  assert.ok(documents.some((doc: { id: string }) => doc.id === 'production-quality'));
  assert.ok(documents.some((doc: { id: string }) => doc.id === 'domain-productionQuality'));
  assert.equal(capabilities.productionQuality.basePath, '/api/operator/quality');
  assert.equal(capabilities.productionQuality.uiBasePath, '/api/production/quality');

  assert.equal(new Set(documents.map((doc: { id: string }) => doc.id)).size, documents.length);
  assert.ok(!documents.some((doc: { path: string }) => /doc\/handoff\.md|auth\.json|\.env/.test(doc.path)));
  for (const doc of documents) {
    const response = await fetch(base + doc.url);
    assert.equal(response.status, 200, doc.path);
    const saved = await response.json();
    assert.equal(saved.path, doc.path);
    assert.equal(saved.content, fs.readFileSync(doc.path, 'utf8'));
  }
  for (const id of ['handoff', 'auth.json', '..%2F..%2F.env', 'unknown']) {
    assert.equal((await fetch(`${base}/api/operator/documents/${id}`)).status, 404);
  }
  const exampleDocument = documents.find((doc: { id: string }) => doc.id === 'production-examples');
  for (const file of exampleDocument.files) {
    const response = await fetch(`${base}/api/operator/documents/production-examples/files/${file}`);
    assert.equal(response.status, 200, file);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join('examples/virtual-production', file)));
  }
  for (const file of ['.env', 'unknown.glb', '..%2F..%2F.env']) {
    assert.equal((await fetch(`${base}/api/operator/documents/production-examples/files/${file}`)).status, 404);
  }
  const example = JSON.parse(fs.readFileSync('examples/virtual-production/case.json', 'utf8'));
  const project = { characters: [], assets: [], episodes: [] } as unknown as Project;
  validatePrevisWorld(example.preparedWorld, project);
  validatePrevisWorld(example.blockoutWorld, project);
  validatePrevisPlan(example.plan, example.scene as Scene, project, example.preparedWorld);
  for (const entry of example.models) assert.equal(createHash('sha256').update(fs.readFileSync(path.join('examples/virtual-production', entry.file))).digest('hex'), entry.model.hash);
  assert.deepEqual(samplePrevisFrame(example.plan, 'example-shot-0', 8).states['bg-walker'].position, samplePrevisFrame(example.plan, 'example-shot-1', 0).states['bg-walker'].position);
  const inspection = JSON.parse(fs.readFileSync('examples/virtual-production/inspection.json', 'utf8'));
  assert.equal(inspection.caseHash, createHash('sha256').update(fs.readFileSync('examples/virtual-production/case.json')).digest('hex'), 'Screenshots must belong to the shipped case version');
  assert.match(capabilities.discovery.productionBoundary, /read-only/);
  assert.match(capabilities.generationWorkbench.assetPurpose, /do not generate both by default/);
  const workflows = await (await fetch(`${base}/api/operator/workflows`)).json();
  assert.equal(workflows.stageExitPolicy.appliesToEveryStage, true, "Document replacement must preserve batch execution gates");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log("Documentation passed: current entry points, valid links, version agreement, public contract reads, unknown/private paths rejected, native interactive discovery and preserved batch gates.");
