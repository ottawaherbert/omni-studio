import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { previewUnusedMedia, quarantineUnusedMedia, restoreRecycledMedia } from '../src/server/media/mediaGarbageCollection';

const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-media-gc-test-'));
  const media = path.join(directory, 'media');
  fs.mkdirSync(media);
  const db = new Database(':memory:');
  t.after(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const put = (relative: string, body = relative, aged = true) => {
    const file = path.join(media, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    if (aged) fs.utimesSync(file, old, old);
    return file;
  };
  return { directory, media, db, put };
}

test('GC preserves registered 3D originals, fixed preview evidence and resumable frames without URL records', t => {
  const { media, db, put } = fixture(t);
  db.exec('CREATE TABLE spatial_models (id TEXT, data TEXT); CREATE TABLE spatial_studios (id TEXT, revision INTEGER, data TEXT); CREATE TABLE spatial_builds (id TEXT, data TEXT); CREATE TABLE previs_videos (id TEXT, data TEXT)');
  const hash = 'a'.repeat(64);
  db.prepare('INSERT INTO spatial_models VALUES (?, ?)').run('model-original', JSON.stringify({ hash, lods: [{ url: '/media/spatial/models/lod.glb' }] }));
  db.prepare('INSERT INTO spatial_studios VALUES (?, ?, ?)').run('library', 1, JSON.stringify({ id: 'library', revision: 1 }));
  db.prepare('INSERT INTO spatial_builds VALUES (?, ?)').run('world-build-test', JSON.stringify({ id: 'world-build-test', resultHash: 'b'.repeat(64), status: 'ready' }));
  const files = [
    `spatial/sources/${hash}.glb`,
    'spatial/models/lod.glb',
    'spatial/previews/studio-library-v1/index.json',
    'spatial/previews/studio-library-v1/view-1.png',
    'spatial/previews/studio-build-world-build-test-bbbbbbbbbbbb-v1/index.json',
    'spatial/previews/studio-build-world-build-test-bbbbbbbbbbbb-v1/view-1.png',
  ];
  for (const status of ['rendering', 'encoding', 'failed', 'cancelled']) {
    const id = `previs-video-${status}`;
    db.prepare('INSERT INTO previs_videos VALUES (?, ?)').run(id, JSON.stringify({ id, status, receivedFrames: 1, totalFrames: 12 }));
    files.push(`previs/${id}/00000000.jpg`);
  }
  files.forEach(file => put(file));
  put('orphan.png');

  assert.deepEqual(previewUnusedMedia(db, media).map(file => file.relativePath), ['orphan.png']);
  assert.equal(quarantineUnusedMedia(db, media), 1);
  for (const file of files) assert.equal(fs.readFileSync(path.join(media, file), 'utf8'), file);
  assert.equal(fs.existsSync(path.join(media, 'orphan.png')), false);
});

test('missing 3D ownership records do not turn interrupted or historical files into garbage', t => {
  const { media, db, put } = fixture(t);
  const files = [
    'spatial/sources/unregistered.glb',
    'spatial/models/interrupted-import.glb',
    'spatial/previews/interrupted-preview/view-1.png',
    'spatial/previews/interrupted-preview/index.tmp',
    'previs/previs-video-unregistered/00000000.jpg',
    'previs/previs-video-unregistered/previs.mp4',
  ];
  files.forEach(file => put(file));
  assert.deepEqual(previewUnusedMedia(db, media), []);
  assert.equal(quarantineUnusedMedia(db, media), 0);
  for (const file of files) assert.equal(fs.readFileSync(path.join(media, file), 'utf8'), file);
  assert.equal(fs.existsSync(`${media}.recycle`), false);
});

test('ordinary media still honors persisted references, the grace period and symbolic links', t => {
  const { directory, media, db, put } = fixture(t);
  db.exec('CREATE TABLE documents (data TEXT, plain_url TEXT)');
  db.prepare('INSERT INTO documents VALUES (?, ?)').run(JSON.stringify({ history: [{ images: ['/media/history/old image.png?version=1#preview'] }] }), 'https://local.example/media/used.mp4');
  put('history/old image.png');
  put('used.mp4');
  put('recent.png', 'recent upload', false);
  put('unreferenced.png');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'original.png'), 'outside source');
  fs.utimesSync(path.join(outside, 'original.png'), old, old);
  fs.symlinkSync(outside, path.join(media, 'linked-directory'));
  fs.symlinkSync(path.join(outside, 'original.png'), path.join(media, 'linked-file.png'));

  assert.deepEqual(previewUnusedMedia(db, media).map(file => file.relativePath), ['unreferenced.png']);
  assert.equal(quarantineUnusedMedia(db, media), 1);
  assert.equal(fs.readFileSync(path.join(outside, 'original.png'), 'utf8'), 'outside source');
  assert.equal(fs.lstatSync(path.join(media, 'linked-file.png')).isSymbolicLink(), true);
});

test('recycled media can be restored without overwriting a newer file or losing the older copy', t => {
  const { media, db, put } = fixture(t);
  put('restore.png', 'original restore');
  put('conflict.png', 'original conflict');
  assert.equal(quarantineUnusedMedia(db, media), 2);
  put('conflict.png', 'newer content', false);
  assert.equal(restoreRecycledMedia(media), 1);
  assert.equal(fs.readFileSync(path.join(media, 'restore.png'), 'utf8'), 'original restore');
  assert.equal(fs.readFileSync(path.join(media, 'conflict.png'), 'utf8'), 'newer content');
  const batch = fs.readdirSync(`${media}.recycle`)[0];
  assert.equal(fs.readFileSync(path.join(`${media}.recycle`, batch, 'files', 'conflict.png'), 'utf8'), 'original conflict');
  assert.equal(restoreRecycledMedia(media), 0);
});

test('a reference scan failure leaves media in place and creates no recycle batch', t => {
  const { media, db, put } = fixture(t);
  put('original.png');
  db.close();
  assert.throws(() => quarantineUnusedMedia(db, media));
  assert.equal(fs.readFileSync(path.join(media, 'original.png'), 'utf8'), 'original.png');
  assert.equal(fs.existsSync(`${media}.recycle`), false);
});
