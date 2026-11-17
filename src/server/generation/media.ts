import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPublicRemoteUrl } from '../routes/assetRoutes';
import { GenerationError, type GenerationMediaKind } from '../../../packages/domain/src/generation';
const run = promisify(execFile);
const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' };
export class GenerationMediaStore {
  constructor(readonly root: string) {}
  async localPath(url: string) {
    if (!url.startsWith('/media/')) throw new GenerationError('MEDIA_NOT_LOCAL', '素材尚未导入项目媒体。');
    const root = await fs.realpath(this.root);
    const file = await fs.realpath(path.resolve(root, decodeURIComponent(url.slice(7))));
    if (!file.startsWith(root + path.sep)) throw new GenerationError('MEDIA_PATH', '素材路径不在项目媒体目录中。');
    return file;
  }
  async freeze(url: string, kind: GenerationMediaKind, limit = 50 * 1024 * 1024) {
    let bytes: Buffer, extension: string;
    if (url.startsWith('/media/')) {
      const file = await this.localPath(url), stat = await fs.stat(file);
      if (!stat.size || stat.size > limit) throw new GenerationError('MEDIA_SIZE', '素材为空或超过本次支持的大小。');
      bytes = await fs.readFile(file); extension = path.extname(file).toLowerCase(); if (extension === '.jpeg') extension = '.jpg';
    } else {
      const data = /^data:((?:image|video|audio)\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
      if (data) {
        if (!data[1].startsWith(kind + '/') || data[2].length > limit * 1.4) throw new GenerationError('MEDIA_TYPE', '素材类型或大小不符合要求。');
        bytes = Buffer.from(data[2], 'base64'); extension = extensions[data[1]] || '';
      } else {
        const target = await assertPublicRemoteUrl(url);
        const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(120000) });
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!response.ok || !response.body || !mime.startsWith(kind + '/')) throw new GenerationError('MEDIA_DOWNLOAD', '无法读取该参考素材，请先导入正确的媒体文件。');
        let size = 0; const parts: Uint8Array[] = [];
        for await (const chunk of response.body as any) { size += chunk.length; if (size > limit) { await response.body.cancel().catch(() => {}); throw new GenerationError('MEDIA_SIZE', '素材超过本次支持的大小。'); } parts.push(chunk); }
        bytes = Buffer.concat(parts); extension = extensions[mime] || '';
      }
    }
    if (!bytes.length || bytes.length > limit || !extension || !Object.keys(extensions).some(mime => mime.startsWith(kind + '/') && extensions[mime] === extension)) throw new GenerationError('MEDIA_TYPE', '素材类型或大小不符合要求。');
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const directory = path.join(this.root, 'generation', 'snapshots'); await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, contentHash + extension);
    try { await fs.writeFile(file, bytes, { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== contentHash) throw new GenerationError('MEDIA_CONTENT_CHANGED', '已保存快照的内容发生变化，不能继续生成。'); }
    return { mediaUrl: `/media/generation/snapshots/${contentHash}${extension}`, contentHash };
  }
  async asDataURL(url: string, kind: GenerationMediaKind) {
    const file = await this.localPath(url), ext = path.extname(file);
    const mime = Object.entries(extensions).find(([k, v]) => v === ext && k.startsWith(kind + '/'))?.[0];
    if (!mime) throw new GenerationError('MEDIA_TYPE', '素材格式不支持。');
    const bytes = await fs.readFile(file), expected = path.basename(file).split('.')[0];
    if (url.startsWith('/media/generation/snapshots/') && createHash('sha256').update(bytes).digest('hex') !== expected) throw new GenerationError('MEDIA_CONTENT_CHANGED', '固定素材内容发生变化，已停止提交，请重新检查。');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  async inspect(url: string, kind: GenerationMediaKind) {
    const file = await this.localPath(url);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_type,width,height,duration:format=duration', '-of', 'json', file], { timeout: 30000, maxBuffer: 131072 });
    const data = JSON.parse(stdout), stream = data.streams?.find((s: any) => s.codec_type === (kind === 'image' ? 'video' : kind));
    if (!stream) throw new GenerationError('OUTPUT_DECODE', '生成文件未包含预期媒体，不能采用。');
    return { ...(kind === 'video' ? { hasAudio: data.streams.some((s: { codec_type: string }) => s.codec_type === 'audio') } : {}), width: stream.width as number | undefined, height: stream.height as number | undefined, durationSeconds: kind === 'image' ? undefined : Number(stream.duration || data.format?.duration || 0) };
  }
}
