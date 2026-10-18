import path from 'node:path';
import type { InteractiveStandalonePackage } from '../domains/interactive/runtime/standalonePackage';
import { readVideoSource } from './media/videoComposition';
import { assertPublicRemoteUrl } from './routes/assetRoutes';

let bundlePromise: Promise<{ javascript: string; css: string }> | undefined;
const playerBundle = () => {
  if (!bundlePromise) bundlePromise = (async () => {
    const { build } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const { default: tailwindcss } = await import('@tailwindcss/vite');
    const built = await build({
      configFile: false, logLevel: 'error', plugins: [react(), tailwindcss()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      esbuild: { jsxDev: false },
      resolve: { alias: { '@': process.cwd() } },
      build: {
        write: false, cssCodeSplit: false, emptyOutDir: false,
        lib: { entry: path.resolve('src/interactive-export/main.tsx'), name: 'InteractivePlayer', formats: ['iife'] },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const output = (Array.isArray(built) ? built[0] : built) as import('rollup').RollupOutput;
    return {
      javascript: output.output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n'),
      css: output.output.flatMap((item) => item.type === 'asset' && item.fileName.endsWith('.css') ? [String(item.source)] : []).join('\n'),
    };
  })().catch((error) => { bundlePromise = undefined; throw error; });
  return bundlePromise;
};

export const createInteractiveStandaloneHtml = async (snapshot: InteractiveStandalonePackage, mediaAssetsDir: string) => {
  if (!snapshot.build.graphSnapshot || !snapshot.build.stateSchemaSnapshot || snapshot.build.status === 'stale') {
    throw new Error('试玩快照无效，请重新生成试玩后导出。');
  }
  const data = structuredClone(snapshot);
  const urls = new Map<string, string>();
  const processedClips = new Set<object>();
  let totalBytes = 0;
  for (const node of data.media?.nodes || []) {
    for (const clip of [...node.clips, ...(node.scenarios || []).flatMap((scenario) => scenario.clips)]) {
      if (processedClips.has(clip)) continue;
      processedClips.add(clip);
      if (!urls.has(clip.url)) {
        const bytes = await readVideoSource({ sourceUrl: clip.url, mediaAssetsDir, assertPublicRemoteUrl, maximumBytes: 100 * 1024 * 1024, accept: clip.mediaKind === 'image' ? 'image/*' : 'video/*' });
        totalBytes += bytes.length;
        if (totalBytes > 150 * 1024 * 1024) throw new Error('单文件导出目前支持最多 150 MB 媒体，请使用更小的预览素材。');
        // Browsers sniff media codecs; image containers need their real MIME type.
        const mime = clip.mediaKind === 'video' ? 'video/mp4'
          : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
            : bytes.subarray(0, 6).toString().startsWith('GIF8') ? 'image/gif'
              : bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
                : bytes.subarray(4, 12).toString() === 'ftypavif' ? 'image/avif' : 'image/jpeg';
        urls.set(clip.url, `data:${mime};base64,${bytes.toString('base64')}`);
      }
      clip.url = urls.get(clip.url)!;
    }
  }
  const bundle = await playerBundle();
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = data.aggregate.experience.title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'"><title>${title}</title><style>${bundle.css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script id="interactive-package" type="application/json">${json}</script><script>${bundle.javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
};
