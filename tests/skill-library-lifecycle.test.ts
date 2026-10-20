import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { useSkillStore } from '../src/store/useSkillStore';
import { skillClient } from '../apps/web/src/clients/skillClient';
import { snapshotCreativeSkill, renderDirectorDirection, isGeneralSkill } from '../packages/domain/src/creativeDirection';

// File persistence and model responses are isolated from the author's library.
test('Skill lifecycle: create, AI review, classify, edit, use, delete', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-lifecycle-'));
  process.env.OMNI_DB_PATH = path.join(dir, 'test.db');
  const { registerSkillRoutes } = await import('../src/server/routes/skillRoutes');
  const app = express(); app.use(express.json());
  let prompts: string[] = [];
  registerSkillRoutes(app, { skillsDir: path.join(dir, 'skills'), generateJson: async input => {
    prompts.push(input.prompt);
    return { title: '保持画面空间连续', categoryName: '视听方法', content: '检查镜头之间的人物位置、动作接点和光线方向。' };
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const res = await fetch(base + '/api/skills' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await res.json(); assert.equal(res.status, status, JSON.stringify(value)); return value;
  };
  try {
    const category = (await request('/categories', 'POST', { name: '视听方法' })).category;
    let manual: any, ai: any, director: any;
    await t.test('manual content and quoted names survive save/reload, duplicate IDs cannot overwrite', async () => {
      manual = (await request('', 'POST', { title: '动作 "接点" \\ 检查', content: '不要添加原有故事中不存在的动作。\n核对前后镜头。', purposes: ["technique"], applicability: { tasks: ["video"], projectFormats: ["movie"], note: "核对动作接点" }, categoryId: category.id, source: 'manual' })).skill;
      assert.equal((await request('')).skills[0].title, manual.title);
      assert.deepEqual((await request('')).skills[0].purposes, ["technique"]);
      assert.deepEqual((await request('')).skills[0].applicability, manual.applicability);
      await request('', 'POST', { ...manual, content: '重复写入' }, 400);
      assert.equal((await request('')).skills[0].content, manual.content);
      await request('', 'POST', { title: '', content: 'x' }, 400);
      await request('/' + manual.id, 'PATCH', { content: ' ' }, 400);
    });
    await t.test('AI draft never saves until author adopts and saves; AI source round-trips', async () => {
      const draft = (await request('/ai-draft', 'POST', { userIdea: '制作镜头的空间连续性规则', categoryHint: '视听方法' })).draft;
      assert.match(prompts[0], /制作镜头/);
      assert.equal((await request('')).skills.length, 1);
      ai = (await request('', 'POST', { ...draft, title: draft.title + '（经作者修改）', categoryId: category.id, source: 'ai', kind: 'general' })).skill;
      assert.equal((await request('')).skills.find((s: any) => s.id === ai.id).source, 'ai');
    });
    await t.test('editing targets ID, clears category and retains a frozen task snapshot', async () => {
      const pinned = snapshotCreativeSkill(manual);
      const updated = (await request('/' + manual.id, 'PATCH', { _filename: ai._filename, content: '人工修订后的规则', categoryId: '' })).skill;
      assert.equal(updated.id, manual.id); assert.equal(updated.categoryId, undefined); assert.equal(updated.revision, 2);
      assert.equal(pinned.content, manual.content);
      const reloaded = (await request('')).skills;
      assert.equal(reloaded.find((s: any) => s.id === ai.id).content, ai.content);
      assert.equal(reloaded.find((s: any) => s.id === manual.id).categoryId, undefined);
    });
    await t.test('director methods share categories but keep specialist routing', async () => {
      const profile = { schemaVersion: 'director-profile.v2', principles: ['关注人物反应'], methods: [{ id: 'reaction', title: '等待反应', priority: 'core', when: '人物听到消息', purpose: '表现判断变化', directions: { performance: { physical: ['停下手中动作'] }, productionDesign: { characterAppearance: ['工作服保持磨损质感'] } }, exceptions: [], checks: [] }] };
      director = (await request('', 'POST', { title: '观察反应', kind: 'director', profile: { director: profile }, categoryId: category.id, source: 'ai' })).skill;
      const saved = (await request('')).skills.find((s: any) => s.id === director.id);
      assert.deepEqual(saved.profile.director, profile);
      assert.equal(isGeneralSkill(saved), false); assert.equal(isGeneralSkill(ai), true);
      const text = renderDirectorDirection({ enabled: true, skill: snapshotCreativeSkill(saved), notes: [], source: 'test' }, 'asset_character');
      assert.match(text, /工作服/); assert.doesNotMatch(text, /停下手中动作/);
      await request('/' + director.id, 'PATCH', { profile: {}, content: '清空结构' }, 400);
      await request('/' + director.id, 'PATCH', { kind: 'general' }, 400);
    });
    await t.test('category names validate; deletion preserves general and director skills', async () => {
      await request('/categories', 'POST', { name: '视听方法' }, 400);
      await request('/categories', 'POST', { name: ' ' }, 400);
      await request('/categories/' + category.id, 'PATCH', { name: '制作与视听' });
      assert.equal((await request('/categories')).categories[0].name, '制作与视听');
      await request('/categories/' + category.id, 'DELETE');
      const reloaded = (await request('')).skills;
      assert.equal(reloaded.length, 3); assert.ok(reloaded.every((s: any) => !s.categoryId));
      assert.equal(reloaded.find((s: any) => s.id === director.id).profile.director.methods.length, 1);
    });
    await t.test('deletion removes only the chosen library skill', async () => {
      const pinned = snapshotCreativeSkill(director);
      await request('/' + director.id, 'DELETE');
      assert.equal((await request('')).skills.length, 2);
      assert.match(pinned.content, /工作服/);
      await request('/' + director.id, 'PATCH', { title: '已不存在' }, 404);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dir, { recursive: true, force: true }); }
});

test('shared store never reports a failed server write as a successful local edit', async t => {
  const oldFetch = globalThis.fetch;
  const original = { id: 'confirmed', title: '服务端已保存', content: '保留原规则', source: 'manual' as const, createdAt: 1, updatedAt: 1 };
  useSkillStore.setState({ skills: [original], categories: [] });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '模拟服务不可用' }), { status: 503 });
  t.after(() => { globalThis.fetch = oldFetch; });
  await assert.rejects(useSkillStore.getState().addSkill({ title: '新技能', content: 'x' }), /模拟服务不可用/);
  await assert.rejects(useSkillStore.getState().updateSkill(original.id, { content: '不得被误报保存' }), /模拟服务不可用/);
  await assert.rejects(useSkillStore.getState().deleteSkill(original.id), /模拟服务不可用/);
  assert.deepEqual(useSkillStore.getState().skills, [original]);
  await useSkillStore.getState().fetchSkills(true);
  assert.match(useSkillStore.getState().error!, /加载失败/);
  assert.deepEqual(useSkillStore.getState().skills, [original]);
  globalThis.fetch = async input => new Response(JSON.stringify(String(input).endsWith('/categories') ? { categories: [] } : { skills: [original] }));
  await useSkillStore.getState().fetchSkills();
  assert.equal(useSkillStore.getState().error, null);
  assert.deepEqual(await skillClient.listSkills(), [original]);
});
