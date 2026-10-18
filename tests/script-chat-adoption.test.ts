import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createWorkspacePatch } from '../packages/script/src/workspacePatch';
import { candidateIsOnlyChange, authorStillMatchesAdoption } from '../apps/web/src/features/script/scriptCandidateAdoption';

function fixture(){
  const base=createScriptProject('采用边界验收',createScriptCreationProfile('short-film',1,5));
  base.brief.concept='原前提';base.brief.theme='原冲突';
  const candidate=structuredClone(base);candidate.brief.concept='新前提';
  return {base,candidate,patch:createWorkspacePatch(base,candidate)};
}
test('a fresh chat candidate can be applied and then adopted to the page',()=>{
  const {base,candidate,patch}=fixture();
  assert.equal(candidateIsOnlyChange(base,base,patch,false),true);
  assert.equal(candidateIsOnlyChange(base,candidate,patch,true),true);
  assert.equal(base.brief.concept,'原前提');
});
test('individual adoption cannot include an unrelated unpublished theme change',()=>{
  const {base,candidate,patch}=fixture();
  const other=structuredClone(base);other.brief.theme='另一份未采用方案';
  assert.equal(candidateIsOnlyChange(base,other,patch,false),false);
  candidate.brief.theme=other.brief.theme;
  assert.equal(candidateIsOnlyChange(base,candidate,patch,true),false);
});
test('a different candidate in the same field cannot be mistaken for this result',()=>{
  const {base,candidate,patch}=fixture();candidate.brief.concept='较晚的另一方案';
  assert.equal(candidateIsOnlyChange(base,candidate,patch,true),false);
});
test('adoption may resume only while the pinned author snapshot is unchanged',()=>{
  const {base}=fixture(),intent={authorRevision:base.revision,authorHash:hashValue(base)};
  assert.equal(authorStillMatchesAdoption(base,false,intent),true);
  assert.equal(authorStillMatchesAdoption(base,true,intent),false);
  const changed=structuredClone(base);changed.brief.theme='采用期间输入';
  assert.equal(authorStillMatchesAdoption(changed,false,intent),false);
  const saved=structuredClone(base);saved.revision++;
  assert.equal(authorStillMatchesAdoption(saved,false,intent),false);
});
