import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type RuleId =
  | "production-store-import"
  | "production-browser-fetch"
  | "production-browser-storage"
  | "service-react-import"
  | "service-ui-import";

interface BoundaryRule {
  id: RuleId;
  description: string;
  roots: string[];
  pattern: RegExp;
  debtCeiling: number;
}

interface BoundaryViolation {
  ruleId: RuleId;
  filePath: string;
  line: number;
  text: string;
}

const rootDir = process.cwd();

const sourceFileExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const rules: BoundaryRule[] = [
  {
    id: "production-store-import",
    description: "Production domain services should not import UI/application stores directly. Use repository ports or edge adapters.",
    roots: ["src/services/production"],
    pattern: /from\s+["'](?:\.\.\/)+store\/[^"']+["']/,
    debtCeiling: 5,
  },
  {
    id: "production-browser-fetch",
    description: "Production domain services should not call browser fetch directly. Use repositories or model/media provider ports.",
    roots: ["src/services/production"],
    pattern: /\bfetch\s*\(/,
    debtCeiling: 11,
  },
  {
    id: "production-browser-storage",
    description: "Production domain services should not use browser storage directly. Use edge adapters.",
    roots: ["src/services/production"],
    pattern: /\b(?:localStorage|sessionStorage)\b(?:\.|\s*[!=]=|\s+===|\s+!==)|typeof\s+(?:localStorage|sessionStorage)\b/,
    debtCeiling: 5,
  },
  {
    id: "service-react-import",
    description: "Service/server layers must not import React.",
    roots: ["src/services/production", "src/services/operator", "src/server"],
    pattern: /from\s+["']react(?:\/[^"']*)?["']/,
    debtCeiling: 0,
  },
  {
    id: "service-ui-import",
    description: "Service/server layers must not import pages or components.",
    roots: ["src/services/production", "src/services/operator", "src/server"],
    pattern: /from\s+["'](?:\.\.\/)+(?:components|pages)\//,
    debtCeiling: 0,
  },
];

const requiredDocs = ["doc/design.md", "doc/handoff.md"];

const walkFiles = (dirPath: string): string[] => {
  const absoluteDir = path.join(rootDir, dirPath);
  const entries = readdirSync(absoluteDir).sort();
  return entries.flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) return walkFiles(relativePath);
    return sourceFileExtensions.has(path.extname(entry)) ? [relativePath] : [];
  });
};

const collectViolations = (rule: BoundaryRule): BoundaryViolation[] => {
  const files = Array.from(new Set(rule.roots.flatMap(walkFiles)));
  return files.flatMap((filePath) => {
    const source = readFileSync(path.join(rootDir, filePath), "utf8");
    return source.split(/\r?\n/).flatMap((lineText, index) =>
      rule.pattern.test(lineText)
        ? [{
            ruleId: rule.id,
            filePath,
            line: index + 1,
            text: lineText.trim(),
          }]
        : [],
    );
  });
};

const assertRequiredDocs = () => {
  for (const documentPath of requiredDocs) {
    assert.ok(existsSync(path.join(rootDir, documentPath)), `Missing current document: ${documentPath}`);
  }
};

const assertProductionRunnerRepositoryBoundary = () => {
  const runnerSource = readFileSync(path.join(rootDir, "src/services/production/runners.ts"), "utf8");
  const runnerRepositoryAccessSource = readFileSync(path.join(rootDir, "src/services/production/runnerRepositoryAccess.ts"), "utf8");
  const productionLockStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionLockStageRunners.ts"), "utf8");
  const productionPrepStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionPrepStageRunners.ts"), "utf8");
  const productionAssetSyncStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionAssetSyncStageRunner.ts"), "utf8");
  const productionGenerationPlanningStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionGenerationPlanningStageRunner.ts"), "utf8");
  const productionPlanningStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionPlanningStageRunners.ts"), "utf8");
  const productionConceptStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionConceptStageRunner.ts"), "utf8");
  const productionBibleStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionBibleStageRunner.ts"), "utf8");
  const productionAssetDetailStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionAssetDetailStageRunner.ts"), "utf8");
  const productionStructureStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionStructureStageRunner.ts"), "utf8");
  const productionSceneStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionSceneStageRunner.ts"), "utf8");
  const productionScriptStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionScriptStageRunner.ts"), "utf8");
  const productionStoryboardStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionStoryboardStageRunner.ts"), "utf8");
  const productionPromptStageRunnerSource = readFileSync(path.join(rootDir, "src/services/production/productionPromptStageRunner.ts"), "utf8");
  const productionAssetReferenceContextSource = readFileSync(path.join(rootDir, "packages/production/src/services/production/productionAssetReferenceContext.ts"), "utf8");
  const videoStoryboardIssueAdapterSource = readFileSync(path.join(rootDir, "src/services/production/videoStoryboardIssueAdapter.ts"), "utf8");
  const productionPromptRuntimeSource = readFileSync(path.join(rootDir, "src/services/production/productionPromptRuntime.ts"), "utf8");
  const productionPromptContextSource = readFileSync(path.join(rootDir, "src/services/production/productionPromptContext.ts"), "utf8");
  const productionAgentManifestSource = readFileSync(path.join(rootDir, "src/services/production/agentManifest.ts"), "utf8");
  const linearStoryboardAgentModuleSource = readFileSync(path.join(rootDir, "src/services/production/agentModules/linearStoryboard.ts"), "utf8");
  const linearCoreAgentModuleSource = readFileSync(path.join(rootDir, "src/services/production/agentModules/linearCore.ts"), "utf8");
  const manualAgentModuleSource = readFileSync(path.join(rootDir, "src/services/production/agentModules/manual.ts"), "utf8");
  const interactiveAgentModuleSource = readFileSync(path.join(rootDir, "src/services/production/agentModules/interactive.ts"), "utf8");
  const upstreamReferenceAgentModuleSource = readFileSync(path.join(rootDir, "src/services/production/agentModules/upstreamReference.ts"), "utf8");
  const coordinationArtifactsSource = readFileSync(path.join(rootDir, "src/services/production/coordination/artifacts.ts"), "utf8");
  const coordinationStageRequirementsSource = readFileSync(path.join(rootDir, "src/services/production/coordination/stageRequirements.ts"), "utf8");
  const coordinationVideoStoryboardIssuesSource = readFileSync(path.join(rootDir, "src/services/production/coordination/videoStoryboardIssues.ts"), "utf8");
  const coordinationTraceSource = readFileSync(path.join(rootDir, "src/services/production/coordination/trace.ts"), "utf8");
  const assetDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/asset.ts"), "utf8");
  const continuityDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/continuity.ts"), "utf8");
  const mediaReadinessDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/mediaReadiness.ts"), "utf8");
  const creativeCommercialDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/creativeCommercial.ts"), "utf8");
  const departmentCoverageDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/departmentCoverage.ts"), "utf8");
  const operatorGovernanceDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/operatorGovernance.ts"), "utf8");
  const styleStrategyDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/styleStrategy.ts"), "utf8");
  const storyboardVideoUnitDepartmentSource = readFileSync(path.join(rootDir, "src/services/production/coordination/departments/storyboardVideoUnit.ts"), "utf8");
  const coordinationSharedSource = readFileSync(path.join(rootDir, "src/services/production/coordination/shared.ts"), "utf8");
  const repositorySource = readFileSync(path.join(rootDir, "packages/production/src/services/production/repositories.ts"), "utf8");
  assert.equal(
    /from\s+["'](?:\.\.\/)+store\/[^"']+["']/.test(runnerSource),
    false,
    "production runners must use repository ports instead of importing application stores directly",
  );
  assert.equal(
    /\bfetch\s*\(/.test(runnerSource),
    false,
    "production runners must use repository/provider ports instead of calling browser fetch directly",
  );
  assert.ok(
    runnerSource.includes("./runnerRepositoryAccess"),
    "production runners should resolve state access through runnerRepositoryAccess helpers",
  );
  assert.equal(
    runnerSource.includes("getProductionRepository"),
    false,
    "production runners should not import the repository runtime directly",
  );
  const runnerLineCount = runnerSource.trimEnd().split(/\r?\n/).length;
  assert.ok(
    runnerLineCount <= 140,
    `production runners.ts should remain registry/wiring only; found ${runnerLineCount} lines`,
  );
  const localStageExecuteNames = Array.from(
    runnerSource.matchAll(/\b(?:export\s+)?(?:const|async function)\s+(execute[A-Za-z0-9]+Stage)\s*(?:=|\()/g),
  )
    .map((match) => match[1])
    .filter((name) => name !== "executeProductionStage");
  assert.deepEqual(
    localStageExecuteNames,
    [],
    "production runners.ts must not reintroduce stage-specific execute implementations",
  );
  [
    "generateStageAIContent",
    "loadProductionTemplate",
    "makeArtifact(",
    "makeQA(",
    "makeIssue(",
    "updateProject(",
    "updateEpisode(",
    "loadFullEpisodes(",
    "loadEpisodeOrFallback(",
    "saveInteractiveEpisode(",
    "loadInteractiveEpisodes(",
  ].forEach((forbiddenSnippet) => {
    assert.equal(
      runnerSource.includes(forbiddenSnippet),
      false,
      `production runners.ts must not reintroduce business runner logic: ${forbiddenSnippet}`,
    );
  });
  assert.ok(runnerRepositoryAccessSource.includes("getProductionRepository"));
  assert.ok(runnerSource.includes("./productionLockStageRunners"));
  assert.ok(productionLockStageRunnerSource.includes("executeScriptLockStage"));
  assert.ok(productionLockStageRunnerSource.includes("executeContentLockStage"));
  assert.ok(runnerSource.includes("./productionPrepStageRunners"));
  assert.ok(productionPrepStageRunnerSource.includes("executeProductionBreakdownStage"));
  assert.ok(productionPrepStageRunnerSource.includes("executeProductionAssetDetailStage"));
  assert.ok(runnerSource.includes("./productionAssetSyncStageRunner"));
  assert.ok(productionAssetSyncStageRunnerSource.includes("executeAssetSyncStage"));
  assert.ok(runnerSource.includes("./productionGenerationPlanningStageRunner"));
  assert.ok(productionGenerationPlanningStageRunnerSource.includes("executeMediaGenerationPlanningStage"));
  assert.ok(runnerSource.includes("retiredInteractiveStage"));
  for (const retiredStage of [
    "interactive_bible",
    "game_blueprint",
    "graph_generation",
    "interactive_graph_qa",
    "node_to_scene",
    "interactive_script",
    "interactive_storyboard",
    "playtest_simulation",
  ]) {
    assert.match(
      runnerSource,
      new RegExp(`${retiredStage}:\\s*\\([^)]*\\)\\s*=>\\s*retiredInteractiveStage\\(stage\\)`),
      `retired stage ${retiredStage} must not execute the legacy GameData compiler`,
    );
  }
  assert.ok(runnerSource.includes("./productionPlanningStageRunners"));
  assert.ok(productionPlanningStageRunnerSource.includes("executeIntakeStage"));
  assert.ok(productionPlanningStageRunnerSource.includes("executeContextPlanningStage"));
  assert.ok(runnerSource.includes("./productionConceptStageRunner"));
  assert.ok(productionConceptStageRunnerSource.includes("executeConceptStage"));
  assert.ok(productionConceptStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(runnerSource.includes("./productionBibleStageRunner"));
  assert.ok(productionBibleStageRunnerSource.includes("executeBibleStage"));
  assert.ok(productionBibleStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(runnerSource.includes("./productionAssetDetailStageRunner"));
  assert.ok(productionAssetDetailStageRunnerSource.includes("executeAssetDetailStage"));
  assert.ok(productionAssetDetailStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(runnerSource.includes("./productionStructureStageRunner"));
  assert.ok(productionStructureStageRunnerSource.includes("executeStructureStage"));
  assert.ok(productionStructureStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(runnerSource.includes("./productionSceneStageRunner"));
  assert.ok(productionSceneStageRunnerSource.includes("executeSceneStage"));
  assert.ok(productionSceneStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(runnerSource.includes("./productionScriptStageRunner"));
  assert.ok(productionScriptStageRunnerSource.includes("executeScriptStage"));
  assert.ok(productionScriptStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(productionScriptStageRunnerSource.includes("./productionAssetReferenceContext"));
  assert.ok(runnerSource.includes("./productionStoryboardStageRunner"));
  assert.ok(productionStoryboardStageRunnerSource.includes("executeStoryboardStage"));
  assert.ok(productionStoryboardStageRunnerSource.includes("./productionPromptContext"));
  assert.ok(productionStoryboardStageRunnerSource.includes("./productionAssetReferenceContext"));
  assert.ok(runnerSource.includes("./productionPromptStageRunner"));
  assert.ok(productionPromptStageRunnerSource.includes("executePromptStage"));
  assert.ok(productionPromptStageRunnerSource.includes("./productionPromptContext"));
  for (const retiredFile of [
    "interactiveAgents.ts",
    "productionInteractiveAssemblyStageRunners.ts",
    "productionInteractiveBibleStageRunner.ts",
    "productionGameBlueprintStageRunner.ts",
    "productionGraphGenerationStageRunner.ts",
    "productionInteractiveGraphStageRunner.ts",
    "productionInteractiveScriptStageRunner.ts",
    "productionInteractiveStoryboardStageRunner.ts",
    "interactiveGraphPlanning.ts",
  ]) {
    assert.equal(
      existsSync(path.join(rootDir, "src/services/production", retiredFile)),
      false,
      `${retiredFile} must stay deleted after the current whiteboard/runtime migration`,
    );
    assert.equal(
      runnerSource.includes(`./${retiredFile.replace(/\.ts$/, "")}`),
      false,
      `${retiredFile} must not return to the production runner registry`,
    );
  }
  assert.ok(productionAssetReferenceContextSource.includes("resolveBreakdownAssetIds"));
  assert.ok(productionAssetReferenceContextSource.includes("sceneAssetReferenceContext"));
  assert.ok(videoStoryboardIssueAdapterSource.includes("toVideoStoryboardProductionIssues"));
  assert.ok(runnerSource.includes("./productionPromptRuntime"));
  assert.ok(productionPromptRuntimeSource.includes("PromptApprovalRequiredError"));
  assert.ok(productionPromptRuntimeSource.includes("generateStageAIContent"));
  assert.ok(productionPromptRuntimeSource.includes("clearActiveApprovedStageExecutionSession"));
  assert.ok(productionPromptContextSource.includes("projectContext"));
  assert.ok(productionPromptContextSource.includes("revisionGuidance"));
  assert.ok(productionPromptContextSource.includes("renderStageContextEnvelope"));
  assert.ok(productionPromptContextSource.includes("buildStageContextTrace"));
  assert.ok(productionAgentManifestSource.includes("ProductionAgentModuleManifest"));
  assert.ok(productionAgentManifestSource.includes("createProductionAgentModuleManifests"));
  assert.ok(productionAgentManifestSource.includes("validateProductionAgentModuleManifests"));
  assert.ok(productionAgentManifestSource.includes("production-agent-module-manifest.v1"));
  assert.ok(linearStoryboardAgentModuleSource.includes("linearStoryboardAgentDefinitions"));
  assert.ok(linearStoryboardAgentModuleSource.includes("linearStoryboardQAAgentDefinitions"));
  assert.ok(linearStoryboardAgentModuleSource.includes("linearStoryboardWorkflowStepDefinitions"));
  assert.ok(linearStoryboardAgentModuleSource.includes("linear.storyboard.board_planner"));
  assert.ok(linearCoreAgentModuleSource.includes("linearCoreAgentDefinitions"));
  assert.ok(linearCoreAgentModuleSource.includes("linearCoreQAAgentDefinitions"));
  assert.ok(linearCoreAgentModuleSource.includes("linearCorePreStoryboardWorkflowStepDefinitions"));
  assert.ok(linearCoreAgentModuleSource.includes("linearCorePostStoryboardWorkflowStepDefinitions"));
  assert.ok(manualAgentModuleSource.includes("manualAgentDefinitions"));
  assert.ok(manualAgentModuleSource.includes("manualQAAgentDefinitions"));
  assert.ok(manualAgentModuleSource.includes("manualGenerationWorkflowStepDefinitions"));
  assert.ok(manualAgentModuleSource.includes("manual.game.editor.commit"));
  assert.ok(interactiveAgentModuleSource.includes("interactiveAgentDefinitions"));
  assert.ok(interactiveAgentModuleSource.includes("interactiveQAAgentDefinitions"));
  assert.ok(interactiveAgentModuleSource.includes("interactiveWorkflowStepDefinitions"));
  assert.ok(interactiveAgentModuleSource.includes("interactive.runtime.compile"));
  assert.ok(upstreamReferenceAgentModuleSource.includes("upstreamReferenceAgentDefinitions"));
  assert.ok(upstreamReferenceAgentModuleSource.includes("upstreamReferenceQAAgentDefinitions"));
  assert.ok(upstreamReferenceAgentModuleSource.includes("upstreamReferenceWorkflowStepDefinitions"));
  assert.ok(upstreamReferenceAgentModuleSource.includes("rights.source_clearance"));
  assert.ok(coordinationArtifactsSource.includes("collectProductionCoordinationArtifacts"));
  assert.ok(coordinationArtifactsSource.includes("ProductionCoordinationArtifactBundle"));
  assert.ok(coordinationStageRequirementsSource.includes("stageRequires"));
  assert.ok(coordinationVideoStoryboardIssuesSource.includes("videoStoryboardIssueToProductionIssue"));
  assert.ok(coordinationTraceSource.includes("buildProductionCoordinationTraceIndex"));
  assert.ok(coordinationTraceSource.includes("validateProductionCoordinationTraceIndex"));
  assert.ok(coordinationTraceSource.includes("production-coordination-trace.v1"));
  assert.ok(assetDepartmentSource.includes("runAssetCoordinationQA"));
  assert.ok(assetDepartmentSource.includes("../artifacts"));
  assert.ok(assetDepartmentSource.includes("../videoStoryboardIssues"));
  assert.ok(continuityDepartmentSource.includes("runContinuityCoordinationQA"));
  assert.ok(continuityDepartmentSource.includes("../artifacts"));
  assert.ok(continuityDepartmentSource.includes("../shared"));
  assert.ok(mediaReadinessDepartmentSource.includes("runMediaReadinessCoordinationQA"));
  assert.ok(mediaReadinessDepartmentSource.includes("../artifacts"));
  assert.ok(mediaReadinessDepartmentSource.includes("../shared"));
  assert.ok(creativeCommercialDepartmentSource.includes("runCreativeCommercialCoordinationQA"));
  assert.ok(creativeCommercialDepartmentSource.includes("../shared"));
  assert.ok(departmentCoverageDepartmentSource.includes("runDepartmentCoverageCoordinationQA"));
  assert.ok(departmentCoverageDepartmentSource.includes("../shared"));
  assert.ok(operatorGovernanceDepartmentSource.includes("runOperatorGovernanceCoordinationQA"));
  assert.ok(operatorGovernanceDepartmentSource.includes("../shared"));
  assert.ok(styleStrategyDepartmentSource.includes("runStyleStrategyCoordinationQA"));
  assert.ok(styleStrategyDepartmentSource.includes("../artifacts"));
  assert.ok(styleStrategyDepartmentSource.includes("validateStoryboardStrategyDraft"));
  assert.ok(styleStrategyDepartmentSource.includes("validateStoryboardStrategyDraftTrial"));
  assert.ok(storyboardVideoUnitDepartmentSource.includes("runStoryboardVideoUnitCoordinationQA"));
  assert.ok(storyboardVideoUnitDepartmentSource.includes("../stageRequirements"));
  assert.ok(storyboardVideoUnitDepartmentSource.includes("../videoStoryboardIssues"));
  assert.ok(coordinationSharedSource.includes("departmentFindingFromIssues"));
  assert.ok(coordinationSharedSource.includes("refsForSnapshot"));
  assert.ok(repositorySource.includes("export interface ProjectRepository"));
  assert.ok(repositorySource.includes("export interface EpisodeRepository"));
  assert.ok(repositorySource.includes("export interface OperatorArtifactRepository"));
};

const formatViolations = (violations: BoundaryViolation[]) =>
  violations
    .map((violation) => `  - ${violation.filePath}:${violation.line} ${violation.text}`)
    .join("\n");

assertRequiredDocs();
assertProductionRunnerRepositoryBoundary();

const results = rules.map((rule) => ({
  rule,
  violations: collectViolations(rule),
}));

const failures = results.filter(({ rule, violations }) => violations.length > rule.debtCeiling);

if (failures.length > 0) {
  console.error("Architecture boundary check failed:");
  failures.forEach(({ rule, violations }) => {
    console.error(`\n${rule.id}: ${rule.description}`);
    console.error(`Allowed current debt ceiling: ${rule.debtCeiling}; found: ${violations.length}`);
    console.error(formatViolations(violations));
  });
  process.exit(1);
}

console.log("Architecture boundary check passed.");
results.forEach(({ rule, violations }) => {
  const debtDelta = rule.debtCeiling - violations.length;
  const suffix = debtDelta > 0
    ? ` (${debtDelta} below current ceiling; consider lowering the ceiling)`
    : "";
  console.log(`- ${rule.id}: ${violations.length}/${rule.debtCeiling}${suffix}`);
});
