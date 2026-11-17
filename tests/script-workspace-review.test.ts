import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { createWorkspacePatch, applyWorkspacePatch } from '../packages/script/src/workspacePatch';
import { createScriptProject, newUnit, unitContentHash } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { analyseTimeline } from '../packages/script/src/runtime';
import type { ScriptProject, TimingEvidence } from '../packages/script/src/schema';

// Independent mechanical fault cases; no model output or external service.
const document = () => createScriptProject('独立仓储故障测试', createScriptCreationProfile('tv-series', 3, 20));
const evidence = (): TimingEvidence => ({ id:'mechanical_measurement',kind:'final',source:'ffprobe',durationMs:1000,contentHash:'mechanical-content',assumptions:'',mediaHash:'mechanical-media',toolVersion:'test-only',rawMeasurement:'{}',settingsHash:'mechanical-settings' });

test('deleting a unit cannot discard concurrent author work inside its scene', () => {
  const base=document(); base.units.push(newUnit('机械第二单元',1000,base.id));
  const draft=structuredClone(base); draft.units.pop();
  const author=structuredClone(base); author.units[1].scenes[0].blocks[0].text='机械作者未保存到草稿的改动';
  const snapshot=structuredClone(author);
  assert.throws(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)),/分别改动/);
  assert.deepEqual(author,snapshot);
});
