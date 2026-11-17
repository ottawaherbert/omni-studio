import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { cleanupSpatialWriteTemps, digest, importSpatialModel, persistSpatialGlb } from '../src/server/spatial/models';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-spatial-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function tetrahedronGlb() {
  const doc = new Document(), buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])).setBuffer(buffer);
  const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])).setBuffer(buffer);
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices));
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

test('real GLB import repairs corrupt source and LOD bytes on retry without changing valid files', async t => {
  const root = await fixture(t), input = await tetrahedronGlb();
  const first = await importSpatialModel(root, input, '原件保护', '测试模型');
  const source = path.join(root, 'spatial', 'sources', `${first.hash}.glb`);
  const lods = [...new Set(first.lods.map(lod => path.join(root, lod.url.slice('/media/'.length))))];
  const sourceMtime = (await fs.stat(source)).mtimeMs;
  await importSpatialModel(root, input, '重复导入', '测试模型');
  assert.equal((await fs.stat(source)).mtimeMs, sourceMtime, 'valid content-addressed originals are reused without rewriting');
  await fs.writeFile(source, input.slice(0, 16));
  await fs.writeFile(lods[0], new Uint8Array([1, 2, 3]));

  const repaired = await importSpatialModel(root, input, '修复导入', '测试模型');
  assert.equal(repaired.id, first.id);
  assert.deepEqual(await fs.readFile(source), Buffer.from(input));
  for (const lod of repaired.lods) assert.equal(digest(await fs.readFile(path.join(root, lod.url.slice('/media/'.length)))), lod.hash);
  for (const folder of ['sources', 'models']) assert.ok((await fs.readdir(path.join(root, 'spatial', folder))).every(name => name.endsWith('.glb')));
});

test('publication exposes complete content only and concurrent identical writes remain valid', async t => {
  const root = await fixture(t), bytes = Buffer.from('complete resource bytes'), target = path.join(root, `${digest(bytes)}.glb`);
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (source: string, destination: string) => {
    assert.equal(path.dirname(source), path.dirname(destination));
    assert.deepEqual(await fs.readFile(source), bytes);
    try { assert.deepEqual(await fs.readFile(target), bytes); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    await rename(source, destination);
  });
  const hashes = await Promise.all(Array.from({ length: 3 }, () => persistSpatialGlb(root, bytes)));
  assert.ok(hashes.every(hash => hash === digest(bytes)));
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.deepEqual(await fs.readdir(root), [path.basename(target)]);
});

test('a partial staging write is removed and never replaces the prior resource', async t => {
  const root = await fixture(t), bytes = Buffer.from('complete replacement bytes'), target = path.join(root, `${digest(bytes)}.glb`);
  await fs.writeFile(target, 'pre-existing incomplete file');
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file: string, flags: string) => {
    const handle = await open(file, flags), writeFile = handle.writeFile.bind(handle);
    t.mock.method(handle, 'writeFile', async (contents: Uint8Array) => {
      await writeFile(contents.slice(0, 4));
      throw new Error('simulated interrupted write');
    });
    return handle;
  });
  await assert.rejects(persistSpatialGlb(root, bytes), /simulated interrupted write/);
  assert.equal(await fs.readFile(target, 'utf8'), 'pre-existing incomplete file');
  assert.deepEqual(await fs.readdir(root), [path.basename(target)]);
});

test('later LOD publication failure preserves the completed original and cleans only its staging file', async t => {
  const root = await fixture(t), input = await tetrahedronGlb(), rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (source: string, destination: string) => {
    if (path.basename(path.dirname(destination)) === 'models') throw new Error('simulated LOD publication failure');
    await rename(source, destination);
  });
  await assert.rejects(importSpatialModel(root, input, '失败重试', '测试模型'), /simulated LOD publication failure/);
  assert.deepEqual(await fs.readFile(path.join(root, 'spatial', 'sources', `${digest(input)}.glb`)), Buffer.from(input));
  assert.deepEqual(await fs.readdir(path.join(root, 'spatial', 'models')), []);
});

test('stale write cleanup only removes aged regular files with the exact owned staging name', async t => {
  const root = await fixture(t), hash = 'a'.repeat(64), aged = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const temporary = () => `.omni-spatial-write-${hash}-${randomUUID()}.tmp`;
  const stale = temporary(), fresh = temporary(), link = temporary(), directory = temporary();
  const preserved = [`${hash}.glb`, 'unknown.tmp', `.omni-spatial-write-${hash}-unknown.tmp`, fresh, link, directory];
  for (const name of [stale, ...preserved.slice(0, 4)]) {
    await fs.writeFile(path.join(root, name), name);
    if (name !== fresh) await fs.utimes(path.join(root, name), aged, aged);
  }
  await fs.symlink(path.join(root, `${hash}.glb`), path.join(root, link));
  await fs.lutimes(path.join(root, link), aged, aged);
  await fs.mkdir(path.join(root, directory));
  await fs.utimes(path.join(root, directory), aged, aged);

  assert.equal(await cleanupSpatialWriteTemps(root), 1);
  assert.deepEqual((await fs.readdir(root)).sort(), preserved.sort());
  assert.equal(await fs.readFile(path.join(root, `${hash}.glb`), 'utf8'), `${hash}.glb`);
});

test('a non-file content-addressed target is preserved and reported instead of being replaced', async t => {
  const root = await fixture(t), bytes = Buffer.from('expected bytes'), target = path.join(root, `${digest(bytes)}.glb`);
  const original = path.join(root, 'original.glb');
  await fs.writeFile(original, bytes);
  await fs.symlink(original, target);
  await assert.rejects(persistSpatialGlb(root, bytes), /不是普通文件/);
  assert.equal((await fs.lstat(target)).isSymbolicLink(), true);
  assert.deepEqual(await fs.readFile(original), bytes);
});
