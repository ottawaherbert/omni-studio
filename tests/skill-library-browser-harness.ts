/** Isolated manual browser acceptance. AI requests use deterministic fixtures, never a real provider. */
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-browser-'));
process.env.OMNI_DB_PATH = path.join(dir, 'fixture.db');
const { registerSkillRoutes } = await import('../src/server/routes/skillRoutes');
const { createSkillFile, writeCategories } = await import('../src/server/routes/skillFileStore');
const skillsDir = path.join(dir, 'skills');
await writeCategories(skillsDir, ['角色与表演', '故事结构', '节奏与钩子', '导演与视听', '台词风格', '分场节拍', '声音设计', '剪辑方法', '互动叙事', '场景美术', '质量检查', '素材整理'].map((name, i) => ({ id: `cat-${i}`, name, sortOrder: i, createdAt: 1, updatedAt: 1 })));
await createSkillFile(skillsDir, { title: '检查镜头空间连续性', content: '检查相邻镜头的人物位置、视线方向与动作接点。发现矛盾时先指出问题，再建议局部调整。', kind: 'general', categoryId: 'cat-3' });
await createSkillFile(skillsDir, { title: '互动分支的选择与后果', content: '每个选项应有明确动机与不同后果，保证分支汇合时人物状态前后一致。', kind: 'general', categoryId: 'cat-8' });
await createSkillFile(skillsDir, { title: '旧版观察反应', content: '人物说完话后，留出听者反应，再切镜。', kind: 'director', categoryId: 'cat-3' });
const app = express(); app.use(express.json());
let failNextSave = false;
app.post('/api/acceptance/fail-save', (_req, res) => { failNextSave = true; res.json({ success: true }); });
app.use('/api/skills', (req, res, next) => {
  if (failNextSave && (req.method === 'PATCH' || req.method === 'POST') && !req.path.includes('ai-draft')) { failNextSave = false; res.status(503).json({ error: '模拟保存失败，输入已保留，请重试。' }); return; }
  next();
});
registerSkillRoutes(app, { skillsDir, generateJson: async ({ prompt }) => {
  if (prompt.includes('模拟失败')) throw new Error('Simulated AI failure');
  return { title: '镜头动作衔接检查', categoryName: '导演与视听', content: '逐一核对相邻镜头的动作起止、人物朝向和视线。\n发现跳变时给出最小调整方案。' };
} });
app.use('/api', (req, res) => {
  if (req.method !== 'GET') return res.status(501).json({ error: '隔离验收禁止其他写入或真实 AI 调用' });
  if (req.path === '/projects') return res.json({ projects: [] });
  res.json({});
});
const vite = await createServer({ server: { middlewareMode: true, proxy: {}, hmr: false }, appType: 'custom' });
app.get('/skills', async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>技能库 · 隔离验收</title></head><body><div id="root"></div><script type="module" src="/@fs/${path.resolve('tests/fixtures/skill-library-browser.tsx')}"></script></body></html>`)));
app.use(vite.middlewares);
const port = Number(process.env.SKILL_BROWSER_PORT || 3021);
const server = app.listen(port, '127.0.0.1', () => console.log(`Skill browser fixture: http://127.0.0.1:${port}/skills (${dir})`));
async function close() { await vite.close(); server.close(); }
process.once('SIGTERM', () => void close()); process.once('SIGINT', () => void close());
