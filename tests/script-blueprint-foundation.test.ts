import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blueprintContext, parseBlueprint, blueprintSchema } from '../packages/script/src/blueprint';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';
import { resolveTaskUnit } from '../apps/web/src/features/script/scriptTaskShortcuts';

const provenance={channel:'provider' as const,producer:'MECHANICAL_BLUEPRINT_FIXTURE_NO_EXTERNAL_MODEL'};
const resolvers={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical'})};
function document(){
  const p=createScriptProject('蓝图链路机械验收',createScriptCreationProfile('anthology',2,5));
  p.brief={concept:'CONCEPT_SENTINEL',theme:'THEME_SENTINEL',audienceExperience:'TONE_SENTINEL',constraints:'LIMIT_SENTINEL',outline:'MIXED_OUTLINE_NOT_LOCAL_SENTINEL'};
  p.storyOutlines=[{scopeId:p.units[0].scopeId,outline:'LOCAL_OUTLINE_SENTINEL'}];
  p.characters=[{id:'char_current',scopeId:p.units[0].scopeId,name:'角色甲',bio:'BIO_SENTINEL',desire:'DESIRE_SENTINEL',need:'',contradiction:'CONTRADICTION_SENTINEL',arc:'ARC_SENTINEL',voice:'VOICE_SENTINEL'}];
  p.facts=[{id:'fact_current',text:'RULE_SENTINEL',scopeId:p.units[0].scopeId,status:'approved'},
    {id:'fact_pending',text:'PENDING_SENTINEL',scopeId:p.id,status:'draft'}];
  const other=newUnit('独立故事乙',300000,'other_story');p.units.push(other);
  p.characters.push({...p.characters[0],id:'char_other',scopeId:other.scopeId,name:'OTHER_CHARACTER_SENTINEL'});
  p.facts.push({id:'fact_other',scopeId:other.scopeId,text:'OTHER_FACT_SENTINEL',status:'approved'});
  return p;
}

test('assistant shortcuts preserve the current shared scope and reject deleted or unassigned entities',()=>{
  const p=document(),preferred=p.units[1];
  assert.equal(resolveTaskUnit(p,preferred.id,{kind:'fact',id:'fact_pending'})?.id,preferred.id);
  assert.equal(resolveTaskUnit(p,preferred.id)?.id,preferred.id);
  assert.equal(resolveTaskUnit(p,preferred.id,{kind:'character',id:'deleted'}),undefined);
  p.facts[0].scopeId='empty_season';
  assert.equal(resolveTaskUnit(p,preferred.id,{kind:'fact',id:'fact_current'}),undefined);
});

test('old blueprints and characters without a bio remain usable, and old dense replies remain readable',()=>{
  const old={concept:'旧构想',theme:'',characters:[{name:'旧人物',voice:'',need:'',desire:''}],facts:Array(14).fill('旧设定')};
  assert.equal(parseBlueprint(old).facts.length,14);
  const p=document();delete p.characters[0].bio;assert.equal(blueprintContext(p,[p.units[0].id]).characters[0].bio,undefined);
});
