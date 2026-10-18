import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(repoRoot, 'tests', 'fixtures');

// This harness exposes only repository fixtures. It never opens a database or calls a model.
export async function startDirectoryBrowserHarness(port = 3040) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SCRIPT_DIRECTORY_BROWSER_PORT must be an integer between 1 and 65535');
  }
  const cacheDir = await mkdtemp(join(tmpdir(), 'script-directory-vite-'));
  let server;
  try {
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      cacheDir,
      plugins: [
        {
          name: 'directory-fixture-isolation',
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.startsWith('/api/')) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: '验收夹具不连接数据库或模型' }));
                return;
              }
              next();
            });
          },
        },
        react(),
        tailwindcss(),
      ],
      resolve: { dedupe: ['react', 'react-dom'] },
      optimizeDeps: { entries: ['script-directory-memory.html'] },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repoRoot] } },
    });
    await server.listen();
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/script-directory-memory.html`;
    return {
      url,
      async close() {
        try { await server.close(); } finally { await rm(cacheDir, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    try { await server?.close(); } finally { await rm(cacheDir, { recursive: true, force: true }); }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = process.env.SCRIPT_DIRECTORY_BROWSER_PORT || '3040';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort)) {
    throw new Error('SCRIPT_DIRECTORY_BROWSER_PORT must be an integer between 1 and 65535');
  }
  const harness = await startDirectoryBrowserHarness(port);
  console.log(JSON.stringify({ url: harness.url, scope: 'in-memory fixture; no database or model' }));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      try { await harness.close(); } catch (error) { console.error(error); process.exitCode = 1; }
      process.exit(process.exitCode || 0);
    });
  }
}
