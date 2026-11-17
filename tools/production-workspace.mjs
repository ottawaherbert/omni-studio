import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

export function prepareProductionWorkspace(directory, baseUrl = 'http://127.0.0.1:3000') {
  if (!directory || !path.isAbsolute(directory)) throw new Error('请提供仓库外的绝对制作目录。');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('服务地址只包含 HTTP(S) origin，不包含凭证、路径或查询。');
  const resolved = path.resolve(directory);
  // Resolve the nearest existing ancestor before creating anything, including symlink parents.
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = path.join(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  if (inside(repository, canonical) || inside(canonical, repository)) throw new Error('制作目录不能位于系统仓库内，也不能是仓库的上级目录。');
  fs.mkdirSync(canonical, { recursive: true });
  const instructions = `# Omni Studio 制作工作区\n\n本目录保存作品脚本、GLB、蓝图、媒体与项目交接。系统源码只读：${repository}\n\n先读取 ${url.origin}/api/operator/handbook 的 content，再按任务读取 capabilities 与 documents。手册只从服务获取，不维护副本。本机服务未启动时可以在系统仓库运行 npm run dev:fullstack，并检查 /api/health；先复用已有服务，必要时确认所属进程和任务状态后正常重启。启动服务不等于获准修改系统源码；缺依赖或配置时报告具体缺项，不重置配置或数据。\n\n默认只做作品：可以写本目录的 Blender/Three.js 建模脚本并通过正式 API 保存剧本、影视城、机位与互动内容；不能修改系统源码、测试、依赖、全局模板或说明书，也不能直接写数据库；已有服务正常写入业务数据和缓存不受此限制。接口失败记录复现到本目录交接，继续不受影响的工作。修正作品不等于授权修改系统。\n\n已有项目先读取当前版本和用户要求，不照抄案例ID。不覆盖他人稿件，不自造审核或删除旧媒体。不需要逐阶段授权表。生成沿用用户指定核心、暂停与实际输入容量。背景人物属于场次调度，资产空场图不代表正式拍摄必须无人。\n\n结束保存项目ID、版本、证据、未完成项与下一步。不要记录密钥。只有通过隔离启动或宿主只读挂载才有文件系统保护；本文件本身不提供沙箱。\n`;
  const file = path.join(canonical, 'AGENTS.md');
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== instructions) throw new Error('已有 AGENTS.md 不同，保留原文件；请选择新的制作目录。');
  } else fs.writeFileSync(file, instructions, { flag: 'wx' });
  return canonical;
}

export function productionSandboxProfile(protectedPath = repository) {
  // Allow the existing server to persist runtime data and Vite caches, while
  // keeping application source, dependency code and configuration read-only.
  // This is source protection, not a database access-control boundary.
  const root = fs.realpathSync(protectedPath);
  const runtimePaths = ['OMNI_Workspace', 'node_modules/.vite', 'node_modules/.vite-temp', 'apps/web/node_modules/.vite'];
  const exceptions = runtimePaths.map(relative => `(require-not (subpath ${JSON.stringify(path.join(root, relative))}))`).join(' ');
  return `(version 1) (allow default) (deny file-write* (require-all (subpath ${JSON.stringify(root)}) ${exceptions}))`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), split = args.indexOf('--');
    const flags = split < 0 ? args : args.slice(0, split);
    const option = name => flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined;
    const directory = prepareProductionWorkspace(option('--directory'), option('--base-url'));
    if (!flags.includes('--run')) console.log(`制作目录已准备：${directory}\n尚未启动隔离进程。`);
    else {
      if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) throw new Error('本平台不支持此隔离启动器；请使用宿主只读挂载，不会无保护执行。');
      const command = split < 0 ? [] : args.slice(split + 1);
      if (!command.length) throw new Error('--run 后需要 -- 与外部 Agent 命令。');
      const result = spawnSync('/usr/bin/sandbox-exec', ['-p', productionSandboxProfile(), ...command], { cwd: directory, stdio: 'inherit' });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
