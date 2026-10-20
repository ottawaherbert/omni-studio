import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSkillFile, updateSkillFile, readSkills, parseSkillFile } from '../src/server/routes/skillFileStore';
import { snapshotCreativeSkill } from '../packages/domain/src/creativeDirection';
import { methodFromSkill, selectSharedMethods } from '../packages/script/src/methods';
import { skillApplicabilityHint, skillTaskForPrompt } from '../packages/domain/src/skillMetadata';

test('optional Skill metadata survives files, partial edits and versioned task snapshots', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-skill-'));
  try {
    const legacy = parseSkillFile('old.md', '未迁移的旧规则正文');
    assert.equal(legacy.content, '未迁移的旧规则正文');
    assert.equal(legacy.purposes, undefined);
    assert.equal(skillApplicabilityHint(legacy, { task: 'video' }), '未标注适用范围');
    const input = { title: '电影结构', content: '原文\n不要推测标题的适用性。', purposes: ['technique', 'future-purpose'], applicability: { tasks: ['video'], projectFormats: ['movie'], note: '只提供接续建议' } };
    const created = await createSkillFile(dir, input);
    let saved = (await readSkills(dir))[0];
    assert.deepEqual(saved.purposes, input.purposes);
    assert.deepEqual(saved.applicability, input.applicability);
    assert.equal(saved.content, input.content);
    assert.match(skillApplicabilityHint(saved, { task: 'writing', projectFormat: 'movie' }), /标注任务为视频生成/);
    assert.match(skillApplicabilityHint(saved, { task: 'video', projectFormat: 'movie' }), /适用于当前已知任务范围/);
    const taskSnapshot = selectSharedMethods([saved], [saved.id])[0];
    const creativeSnapshot = snapshotCreativeSkill(saved);
    await updateSkillFile(dir, saved.id, { title: '改名后的规则', purposes: ['structure'], applicability: { tasks: ['writing'] } });
    saved = (await readSkills(dir))[0];
    assert.equal(saved.revision, 2);
    assert.equal(saved.content, input.content);
    assert.deepEqual(taskSnapshot.purposes, input.purposes);
    assert.deepEqual(taskSnapshot.applicability, input.applicability);
    assert.deepEqual(creativeSnapshot.applicability, input.applicability);
    assert.equal(methodFromSkill(saved).version, '2');
    await updateSkillFile(dir, saved.id, { content: '只改正文' });
    saved = (await readSkills(dir))[0];
    assert.deepEqual(saved.applicability, { tasks: ['writing'] });
    assert.deepEqual(saved.purposes, ['structure']);
    assert.equal(created.kind, 'general');
    assert.equal(skillTaskForPrompt('generateVideo', 'expensive_generation_planning'), 'video');
    assert.equal(skillTaskForPrompt('unknown movie structure title'), undefined);
    await assert.rejects(createSkillFile(dir, { title: 'invalid', content: 'x', purposes: 'video' as any }), /用途/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
