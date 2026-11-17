/** Renders the public example through the real spatial runtime; no production DB or providers. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';

const directory = path.resolve('examples/virtual-production');
const example = JSON.parse(await fs.readFile(path.join(directory, 'case.json'), 'utf8'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-example-capture-'));
const server = await createServer({ configFile: false, cacheDir:path.join(temp,'vite-cache'), optimizeDeps: { entries: ['examples/virtual-production/preview.ts'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'example-only', configureServer(vite) {
  vite.middlewares.use(async (req, res, next) => {
    const match = example.models.find((entry: any) => req.url === entry.model.lods[0].url);
    if (match) { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(await fs.readFile(path.join(directory, match.file))); return; }
    if (req.url === '/case') { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/case', '<!doctype html><script type="module" src="/examples/virtual-production/preview.ts"></script>')); return; }
    next();
  });
} }] });
await server.listen();
const address = server.httpServer!.address() as { port: number };
const browser = await chromium.launch({ executablePath: process.env.OMNI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.error(e));
  await page.goto(`http://127.0.0.1:${address.port}/case`); await page.waitForFunction(() => !!(window as any).exampleCapture);
  for (const id of ['workshop', 'street', 'reverse']) for (const prepared of id === 'reverse' ? [true] : [false, true]) {
    const data = await page.evaluate(({ id, prepared }) => (window as any).exampleCapture.still(id, prepared), { id, prepared });
    await fs.writeFile(path.join(directory, `${id}-${prepared ? 'prepared' : 'blockout'}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  for (let i = 0; i < 192; i++) {
    const data = await page.evaluate(i => (window as any).exampleCapture.movieFrame(i), i);
    await fs.writeFile(path.join(temp, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '12', '-i', path.join(temp, '%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', path.join(directory, 'background-motion.mp4')]);
  const measurements = await page.evaluate(() => (window as any).exampleCapture.measure());
  const contactReport = await page.evaluate(() => (window as any).exampleCapture.inspect());
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const evidence = { recordedAt: new Date().toISOString(), caseHash: sha256(await fs.readFile(path.join(directory, 'case.json'))), models: example.models.map((m: any) => ({ file: m.file, hash: m.model.hash, bytes: m.model.sourceBytes, triangles: m.model.lods[0].triangles })), movie: { seconds: 16, fps: 12, frames: 192, scope: '两镜背景承接预演，非单次H3输入' }, measurements, contactReport, visualAcceptance: 'pending human/Agent inspection; rendering success is not creative acceptance' };
  await fs.writeFile(path.join(directory, 'inspection.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await server.close(); await fs.rm(temp, { recursive: true, force: true }); }
