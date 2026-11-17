import draco3d from 'draco3dgltf';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, flatten, join, simplify, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpatialModel } from '../../../packages/domain/src/spatial';
let dracoDecoder: unknown;
export const spatialIO = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder, ...(dracoDecoder ? {'draco3d.decoder': dracoDecoder} : {}) });
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const WRITE_TEMP_PATTERN = /^\.omni-spatial-write-[a-f0-9]{64}-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.tmp$/;
const WRITE_TEMP_GRACE_MS = 24 * 60 * 60 * 1000;

/** Only our abandoned write staging files are disposable; source/LOD GLBs are not. */
export async function cleanupSpatialWriteTemps(folder: string): Promise<number> {
  let entries: string[];
  try { entries = await fs.readdir(folder); }
  catch (error: any) { if (error.code === 'ENOENT') return 0; throw error; }
  const cutoff = Date.now() - WRITE_TEMP_GRACE_MS;
  let removed = 0;
  for (const name of entries) {
    if (!WRITE_TEMP_PATTERN.test(name)) continue;
    const file = path.join(folder, name);
    try {
      const stat = await fs.lstat(file);
      // The import worker has a five-minute limit. A day also protects other
      // active imports, while allowing a later import to reclaim killed writes.
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
      await fs.unlink(file);
      removed += 1;
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return removed;
}

/** Publish complete bytes atomically; a previous interrupted write is repaired on retry. */
export async function persistSpatialGlb(folder: string, bytes: Uint8Array): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  await cleanupSpatialWriteTemps(folder);
  const hash = digest(bytes), target = path.join(folder, `${hash}.glb`);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile()) throw new Error('模型资源路径不是普通文件，不能覆盖。');
    if (digest(await fs.readFile(target)) === hash) return hash;
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(folder, `.omni-spatial-write-${hash}-${randomUUID()}.tmp`);
  // Only enter cleanup after this call owns the staging file; an EEXIST/open
  // failure must never remove somebody else's file.
  const file = await fs.open(temporary, 'wx');
  try {
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    // Same-directory rename never exposes a partial GLB, including when a
    // second importer publishes these same content-addressed bytes first.
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  return hash;
}
/** GLB-only: never fetch external buffers, textures or decoder URLs from an import. */
export function inspectGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 20 || bytes.byteLength > 100 * 1024 * 1024) throw new Error('请提供 100 MB 以内的独立 GLB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('不是有效的 GLB 2.0 文件。');
  const n = view.getUint32(12, true); if (n > bytes.length - 20) throw new Error('GLB 文件不完整。');
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + n)));
  if ([...(json.buffers || []), ...(json.images || [])].some(x => x.uri)) throw new Error('GLB 必须内嵌资源，不能引用外部文件或网络。');
  if (json.skins?.length || json.animations?.length) throw new Error('布景库接收静态模型；角色动作请使用场次人物与关键帧，不能静默丢弃骨骼动画。');
  if ((json.accessors || []).reduce((n, a) => n + (a.count || 0), 0) > 12_000_000) throw new Error('模型数据量过大，请先拆分为建筑或街区组件。');
  return json;
}
export async function importSpatialModel(root: string, bytes: Uint8Array, name: string, license: string): Promise<SpatialModel> {
  inspectGlb(bytes); await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  dracoDecoder ||= await draco3d.createDecoderModule();
  const io = spatialIO(), original = await io.readBinary(bytes), scene = original.getRoot().getDefaultScene() || original.getRoot().listScenes()[0];
  if (!scene) throw new Error('模型没有场景。');
  original.getRoot().listExtensionsUsed().filter(e=>e.extensionName==='KHR_draco_mesh_compression').forEach(e=>e.dispose());
  // Runtime is an untextured reference set; retain the original GLB, not its texture GPU cost.
  original.getRoot().listTextures().forEach(t => t.dispose());
  original.getRoot().listMaterials().forEach(m => { m.setMetallicFactor(0).setRoughnessFactor(.9); });
  const bounds = getBounds(scene), size = bounds.max.map((v, i) => v - bounds.min[i]) as SpatialModel['size'];
  if (size.some(n => !Number.isFinite(n) || n < .001 || n > 1000)) throw new Error('请将模型按米制导出；边长应在 1 毫米至 1000 米以内。');
  // Rebase the complete hierarchy, preserving child transforms and real door/window geometry.
  const anchor = original.createNode('metres-y-up-bottom-centre').setTranslation([-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], -(bounds.min[2] + bounds.max[2]) / 2]);
  scene.listChildren().forEach(n => { scene.removeChild(n); anchor.addChild(n); }); scene.addChild(anchor);
  // Untextured sets retain authored tonal differences as vertex colours, sharing one material.
  const shared=original.createMaterial('whitebox-vertex-colours').setMetallicFactor(0).setRoughnessFactor(.9);
  const buffer=original.getRoot().listBuffers()[0]||original.createBuffer();
  for(const mesh of original.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
    const position=p.getAttribute('POSITION');if(!position)continue;
    const factor=p.getMaterial()?.getBaseColorFactor()||[1,1,1,1],previous=p.getAttribute('COLOR_0'),colour=new Float32Array(position.getCount()*3),value:number[]=[];
    for(let i=0;i<position.getCount();i++){if(previous)previous.getElement(i,value);for(let j=0;j<3;j++)colour[i*3+j]=factor[j]*(previous?value[j]:1);}
    p.setAttribute('COLOR_0',original.createAccessor('',buffer).setType('VEC3').setArray(colour)).setMaterial(shared);
  }
  await original.transform(dedup(), flatten(), join(), weld(), prune());
  const normalized = await io.writeBinary(original), folder = path.join(root, 'spatial', 'models');
  const hash = await persistSpatialGlb(path.join(root, 'spatial', 'sources'), bytes);
  const lods: SpatialModel['lods'] = [];
  for (const [i, ratio] of [1, .5, .18].entries()) {
    const doc = await io.readBinary(normalized);
    if (i) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: .002, lockBorder: true }));
    const triangles = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() || p.getAttribute('POSITION')?.getCount() || 0) / 3, 0), 0);
    if (!Number.isInteger(triangles) || triangles < 1) throw new Error('仅支持有三角网格的布景。');
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const output = await io.writeBinary(doc), content = await persistSpatialGlb(folder, output);
    lods.push({ url: `/media/spatial/models/${content}.glb`, hash: content, bytes: output.length, triangles, distance: [0, 35, 100][i] });
  }
  return { id: `model-${digest(new TextEncoder().encode(`whitebox-pipeline-v2:${hash}`))}`, name: name.slice(0, 160), hash, size, lods, sourceBytes: bytes.length, license: license.slice(0, 2000), createdAt: Date.now() };
}
