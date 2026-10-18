import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const scripts = [
  'interactive-legacy-purge-self-check.ts',
  'interactive-domain-core-self-check.ts',
  'interactive-ai-graph-draft-self-check.ts',
  'interactive-architecture-boundary-self-check.ts',
  'interactive-story-architecture-self-check.ts',
  'interactive-semantic-contract-self-check.ts',
  'interactive-graph-layout-self-check.ts',
  'interactive-graph-duration-story-units-self-check.ts',
  'interactive-graph-qa-self-check.ts',
  'interactive-script-binding-self-check.ts',
  'interactive-legacy-binding-read-self-check.ts',
  'interactive-legacy-node-capabilities-self-check.ts',
  'interactive-content-plan-self-check.ts',
  'interactive-production-workspace-self-check.ts',
  'interactive-proposal-adoption-self-check.ts',
  'interactive-media-take-mapping-self-check.ts',
  'interactive-visual-context-self-check.ts',
  'interactive-playtest-sim-self-check.ts',
  'interactive-production-ui-self-check.ts',
];

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-interactive-domain-'));
const dbPath = path.join(tempDirectory, 'interactive-domain.db');
try {
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join("tests", script)], {
      cwd: process.cwd(),
      env: { ...process.env, OMNI_DB_PATH: dbPath },
      encoding: "utf8",
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}`);
    }
  }
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
