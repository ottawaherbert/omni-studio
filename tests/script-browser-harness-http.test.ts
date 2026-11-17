import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { createScriptCreationProfile } from '../packages/script/src/creation';

test('the actual browser harness serves isolated writing CRUD, external result adoption and save conflicts', { timeout: 45_000 }, async t => {
  const directory = mkdtempSync('/tmp/a22-browser-harness-http-');
  let child: ReturnType<typeof spawn> | undefined;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const databasePath = join(directory, 'acceptance.sqlite');
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  child = spawn(process.execPath, ['--import', 'tsx', 'tests/script-browser-harness.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, OMNI_DB_PATH: databasePath, SCRIPT_BROWSER_DB: databasePath, SCRIPT_BROWSER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25_000;
  while (!output.includes(`http://127.0.0.1:${port}/writing`)) {
    assert.equal(child.exitCode, null, output);
    assert.ok(Date.now() < deadline, `harness did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  let requests = 0;
  const request = async (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    requests += 1;
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  };
  assert.deepEqual((await request('/api/scripts')).projects, []);
  let project = (await request('/api/scripts', { title: '隔离 harness 回归', profile: createScriptCreationProfile('short-film', 1, 3) }, 'POST', 201)).project;
  assert.equal((await request('/api/scripts')).projects.length, 1);
  project.units[0].scenes[0].blocks[0].text = '作者原稿：把灯留在门边。';
  project = (await request(`/api/scripts/${project.id}`, { project, expectedRevision: project.revision }, 'PUT')).project;
  await request(`/api/scripts/${project.id}`, { project, expectedRevision: project.revision - 1 }, 'PUT', 409);
  assert.equal((await request(`/api/scripts/${project.id}`)).project.units[0].scenes[0].blocks[0].text, '作者原稿：把灯留在门边。');
  const job = (await request(`/api/scripts/${project.id}/jobs`, { operation: 'scene', unitId: project.units[0].id, sceneId: project.units[0].scenes[0].id, prompt: '只改灯的位置', expectedRevision: project.revision }, 'POST', 201)).job;
  const returned = await request(`/api/scripts/${project.id}/jobs/${job.id}/result`, {
    rawResult: JSON.stringify({ summary: '改为桌边', blocks: [{ type: 'action', text: '回填候选：把灯留在桌边。' }] }),
    provenance: { source: 'manual_external', provider: 'isolated-test', modelId: 'authored-fixture' },
  });
  assert.equal(returned.job.status, 'ready');
  assert.equal((await request(`/api/scripts/${project.id}`)).project.units[0].scenes[0].blocks[0].text, '作者原稿：把灯留在门边。');
  project = (await request(`/api/scripts/${project.id}/jobs/${job.id}/approve`, {})).project;
  assert.equal(project.units[0].scenes[0].blocks[0].text, '回填候选：把灯留在桌边。');
  assert.equal((await request(`/api/scripts/${project.id}/jobs/${job.id}`)).job.status, 'approved');
  await request('/api/model-provider-not-installed', undefined, 'GET', 503);
  t.diagnostic(`${requests} actual HTTP requests passed on ${origin}; isolated SQLite; zero model calls.`);
  assert.equal(requests, 12);
});
