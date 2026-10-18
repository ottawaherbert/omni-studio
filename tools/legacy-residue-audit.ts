/** Read-only inventory. Unreachable does not mean safe to delete: scripts and compatibility exports matter. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
const files = ["src", "apps", "packages", "tests", "tools"].filter(fs.existsSync).flatMap(walk)
  .concat(["server.ts", "server-entry.ts", "vite.config.ts"]);
const fileSet = new Set(files);
const graph = new Map<string, string[]>();
const reverse = new Map<string, string[]>();
const sources = new Map<string, string>();
const roots = [
  "src/main.tsx", "apps/web/src/main.tsx", "server-entry.ts",
  "apps/api/src/index.ts", "apps/worker/src/index.ts",
  "apps/worker/src/production-media-worker.ts",
  "apps/cli/src/kie-production-film-render.ts", "apps/cli/src/build-production-dialogue-track.ts",
  "vite.config.ts", "apps/web/vite.config.ts", "src/interactive-export/main.tsx",
].filter(file => fileSet.has(file));
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  sources.set(file, source);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const dependencies = new Set<string>();
  const visit = (node: ts.Node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) specifier = node.arguments[0].text;
    if (specifier?.startsWith(".") || specifier?.startsWith("@/")) {
      const base = specifier.startsWith("@/") ? specifier.slice(2) : path.normalize(path.join(path.dirname(file), specifier));
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base.replace(/\.js$/, ".ts")]
        .find(candidate => fileSet.has(candidate));
      if (target) dependencies.add(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  graph.set(file, [...dependencies]);
  for (const target of dependencies) reverse.set(target, [...(reverse.get(target) || []), file]);
}
const reachable = (seeds: string[]) => {
  const found = new Set<string>();
  const visit = (file: string) => {
    if (found.has(file)) return;
    found.add(file);
    for (const dependency of graph.get(file) || []) visit(dependency);
  };
  seeds.forEach(visit);
  return found;
};
const runtime = reachable(roots);
const isDevelopmentFile = (file: string) => /^(tests|tools)\//.test(file);
const developmentReachable = reachable(files.filter(isDevelopmentFile));
const pureReexport = (file: string) => {
  const ast = ts.createSourceFile(file, sources.get(file)!, ts.ScriptTarget.Latest, true);
  return ast.statements.length > 0 && ast.statements.every(statement => ts.isExportDeclaration(statement));
};
const sourceFiles = files.filter(file => !isDevelopmentFile(file) && !file.endsWith(".d.ts"));
const candidates = sourceFiles.filter(file => !runtime.has(file)).map(file => ({
  file,
  category: pureReexport(file) ? "compatibility-reexport" : developmentReachable.has(file) ? "offline-or-test-implementation" : "no-static-entry",
  importedBy: reverse.get(file) || [],
}));
const legacyNamedRuntime = sourceFiles.filter(file => runtime.has(file) && /legacy|retired|\/bible\/|useBibleAI|types\/adaptation/i.test(file))
  .map(file => ({ file, importedBy: (reverse.get(file) || []).filter(parent => runtime.has(parent)) }));
const report = {
  roots,
  limitations: "Static local import graph, including type imports and literal dynamic imports. Does not establish per-export usage, HTTP callers, dynamically constructed paths or historical data ownership. Do not delete from this list automatically.",
  summary: {
    scannedFiles: files.length,
    runtimeReachableFiles: runtime.size,
    candidates: candidates.length,
    candidateCategories: Object.fromEntries([...new Set(candidates.map(item => item.category))]
      .map(category => [category, candidates.filter(item => item.category === category).length])),
    legacyNamedRuntimeFiles: legacyNamedRuntime.length,
  },
  legacyNamedRuntime,
  candidates,
};
console.log(JSON.stringify(process.argv.includes("--json") ? report : report.summary, null, 2));
