import assert from "node:assert/strict";
import {
  createProductionScriptWorkspace,
  currentProductionScriptRevision,
  previewWritingScriptSync,
  productionScriptWorkspaceForProject,
} from "../src/services/production/productionScriptWorkspace";

const project = {
  id: "copy-test",
  title: "制片副本",
  episodes: [],
  productionSourceSnapshot: {
    sourceType: "writing_export",
    sourceWritingProjectId: "source-script",
  },
} as any;
const documents = [{ id: "document", order: 1, kind: "episode", title: "第一集", content: "首次交付正文", isWorkRange: true }] as any;
const workspace = createProductionScriptWorkspace(project, documents, 100);
assert.equal(workspace.syncPolicy, "manual");
const originalText = currentProductionScriptRevision(workspace)!.units[0].content;
const packageWithNewText = {
  schemaVersion: "script-delivery.v1",
  sourceRevision: 2,
  exportedAt: 200,
  sourceWritingProjectId: "source-script",
  title: "剧本当前稿",
  format: "movie",
  characters: [],
  lore: [],
  styleGuide: { voice: "", pacing: "", dialogue: "" },
  units: [{ id: "document", index: 1, kind: "sequence", title: "第一集", summary: "", prose: "上游后来修改" }],
} as any;
const proposal = previewWritingScriptSync(project, workspace, packageWithNewText);
assert.ok(proposal.changes.length > 0);
assert.equal(currentProductionScriptRevision(workspace)!.units[0].content, originalText);
assert.equal(currentProductionScriptRevision(proposal.workspace)!.units[0].content, "上游后来修改");
const historical = productionScriptWorkspaceForProject({ ...project, productionScriptWorkspace: { ...workspace, syncPolicy: "safe_auto" } }, documents);
assert.equal(historical.syncPolicy, "manual", "historical automatic policy is treated as manual");
assert.equal(currentProductionScriptRevision(historical)!.units[0].content, originalText);
console.log("production source copy: initial and historical imports require explicit adoption");
