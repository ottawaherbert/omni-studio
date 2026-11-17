import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareProductionWorkspace, productionSandboxProfile } from '../tools/production-workspace.mjs';

test('production workspace preserves existing instructions and rejects repository paths including symlinks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-production-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => prepareProductionWorkspace(path.resolve('.')), /仓库/);
  fs.symlinkSync(path.resolve('.'), path.join(root, 'system'));
  assert.throws(() => prepareProductionWorkspace(path.join(root, 'system', 'new-output')), /仓库/);
  assert.throws(() => prepareProductionWorkspace(path.join(root, 'credentials'), 'http://user:secret@localhost:3000'), /凭证/);
  const folder = prepareProductionWorkspace(path.join(root, 'work'));
  assert.equal(prepareProductionWorkspace(folder), folder);
  const instructions = path.join(folder, 'AGENTS.md');
  assert.match(fs.readFileSync(instructions, 'utf8'), /npm run dev:fullstack/);
  fs.writeFileSync(instructions, '用户原有说明');
  assert.throws(() => prepareProductionWorkspace(folder), /保留原文件/);
  assert.equal(fs.readFileSync(instructions, 'utf8'), '用户原有说明');
});

test('macOS production child can read source and write content but cannot modify protected files even via a symlink', { skip: process.platform !== 'darwin' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-sandbox-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protectedDirectory = path.join(root, 'source'); fs.mkdirSync(protectedDirectory);
  fs.writeFileSync(path.join(protectedDirectory, 'app.ts'), 'original');
  fs.mkdirSync(path.join(protectedDirectory, 'OMNI_Workspace'));
  fs.mkdirSync(path.join(protectedDirectory, 'node_modules/.vite'), { recursive: true });
  fs.symlinkSync(path.join(protectedDirectory, 'app.ts'), path.join(protectedDirectory, 'OMNI_Workspace/source-alias'));
  fs.symlinkSync(protectedDirectory, path.join(root, 'alias'));
  const script = `const fs=require('fs'),path=require('path');const root=process.argv[1];
    if(fs.readFileSync(path.join(root,'source/app.ts'),'utf8')!=='original')process.exit(10);
    for(const file of ['source/app.ts','source/new.ts','alias/app.ts','source/OMNI_Workspace/source-alias','source/node_modules/new-dependency.js']){try{fs.writeFileSync(path.join(root,file),'changed');process.exit(11)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}}
    fs.writeFileSync(path.join(root,'source/OMNI_Workspace/runtime.json'),'{}');
    fs.writeFileSync(path.join(root,'source/node_modules/.vite/cache.json'),'{}');
    fs.writeFileSync(path.join(root,'scene.json'),'{}');`;
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', productionSandboxProfile(protectedDirectory), process.execPath, '-e', script, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(fs.readFileSync(path.join(protectedDirectory, 'app.ts'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(root, 'scene.json'), 'utf8'), '{}');
});
