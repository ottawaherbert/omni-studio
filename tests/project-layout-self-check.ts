import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Run without importing the application or opening a user database.
const root = process.cwd();
const developmentDirectory = /^(tests|tools|scripts)(\/|$)/;
const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
const sourceFiles = ["src", "apps", "packages"].flatMap(walk)
  .concat(["server.ts", "server-entry.ts", "vite.config.ts"]);
const violations: string[] = [];
for (const file of sourceFiles) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    // Includes literal imports, exports, require(), new URL(), and fs path arguments.
    if (ts.isStringLiteralLike(node)) {
      const value = node.text;
      const target = value.startsWith("@/") ? value.slice(2)
        : value.startsWith(".") ? path.normalize(path.join(path.dirname(file), value))
        : path.isAbsolute(value) ? path.relative(root, value) : value;
      if (developmentDirectory.test(target)) violations.push(`${file}: ${value}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(violations, [], "Application code must not depend on development tests, fixtures or maintenance tools");

const { scripts: commands } = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
for (const [name, command] of Object.entries(commands)) {
  for (const match of command.matchAll(/(?:apps|tests|tools|scripts)\/[\w./-]+\.(?:ts|sh)\b/g)) {
    assert.ok(fs.existsSync(match[0]), `${name} refers to a missing entry: ${match[0]}`);
    if (/^(dev(?::|$)|start$|build$|preview$|tts:|produce:)/.test(name)) {
      assert.equal(developmentDirectory.test(match[0]), false, `${name} must use a runtime entry`);
    }
  }
}
assert.equal(fs.existsSync("scripts"), false, "Do not recreate a mixed scripts directory");
assert.ok(fs.existsSync("tests/fixtures/production/appearance/fixture.json"));
assert.ok(fs.existsSync("tests/fixtures/production/simple-preparation/fixture.json"));
console.log(`Project layout passed: ${sourceFiles.length} source files isolated from development files; command entries exist.`);
