import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const violations: string[] = [];

const assertMissing = (content: string, pattern: RegExp, message: string) => {
  if (pattern.test(content)) violations.push(message);
};

const app = read('src/App.tsx');
[
  /interactive\/episodes\/:episodeId/,
  /episodes\/:episodeId\/game-editor/,
  /node-script\/:nodeId/,
].forEach((pattern) => assertMissing(app, pattern, `App still exposes legacy route: ${pattern}`));

const interactivePageFiles = [
  'src/pages/InteractiveProduction.tsx',
  'src/pages/NewInteractiveProjectWizard.tsx',
  'src/pages/InteractiveGraphWorkspace.tsx',
  'src/pages/InteractivePlaytestPlayer.tsx',
];

if (fs.existsSync(path.join(ROOT, 'src/pages/InteractiveScriptBindingWorkspace.tsx'))) {
  violations.push('InteractiveScriptBindingWorkspace.tsx should be deleted');
}

for (const file of interactivePageFiles) {
  const content = read(file);
  assertMissing(content, /gameData/, `${file} reads or writes legacy gameData`);
  assertMissing(content, /conditionExpression/, `${file} uses free-string conditions`);
  assertMissing(content, /\/legacy\/new-project/, `${file} routes through legacy project creation`);
  assertMissing(content, /node_clue_found|node_interrogate|clueCount|trustSuspect/, `${file} contains sample mystery data`);
}

const server = read('server.ts');
if (!/registerInteractiveRoutes\(app(?:,\s*\{[\s\S]*?\})?\)/.test(server) || !/ensureInteractiveSchema\(\)/.test(server)) {
  violations.push('Server does not register and initialize the interactive domain');
}

const repository = read('src/server/interactiveRepository.ts');
for (const table of ['interactive_experiences', 'interactive_versions', 'interactive_node_content_bindings']) {
  if (!repository.includes(table)) violations.push(`Interactive repository is missing ${table}`);
}

if (violations.length) {
  throw new Error(`Interactive architecture boundary failed:\n- ${violations.join('\n- ')}`);
}

console.log('[Interactive Architecture Boundary] PASSED. New UI uses persisted domain APIs and exposes no legacy routes.');
