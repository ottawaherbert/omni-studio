import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { applyWorkspacePatch, createWorkspacePatch, workspacePatchConflicts } from '../packages/script/src/workspacePatch';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

function document() { const p=createScriptProject('机械流程验收',createScriptCreationProfile('tv-series',3,20));p.units[0].scenes[0].blocks[0].text='【人工协议测试原文】保留整句与空格。';return p; }
test('structural patch adds a new unit, character and scene with references and preserves unrelated author edits',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);
  const unit=newUnit('第2集',1200000,draft.id),character={id:'person_new',name:'协议人物',scopeId:draft.id,desire:'',need:'',contradiction:'',arc:'',voice:''};
  draft.characters.push(character);unit.scenes[0].characterIds=[character.id];draft.units.push(unit);
  draft.units[0].scenes[0].title='工作稿调整标题';author.units[0].scenes[0].blocks[0].text='【作者改稿】另一个字段必须保留';
  const merged=applyWorkspacePatch(author,createWorkspacePatch(base,draft));
  assert.equal(merged.units.length,2);assert.equal(merged.characters[0].id,character.id);assert.equal(merged.units[0].scenes[0].title,'工作稿调整标题');
  assert.equal(merged.units[0].scenes[0].blocks[0].text,author.units[0].scenes[0].blocks[0].text);assert.deepEqual(base.units.length,1);
});
test('same-field conflicts, broken references, orphan entities, unknown paths and immutable originals fail without mutation',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);draft.units[0].scenes[0].blocks[0].text='工作稿修改';author.units[0].scenes[0].blocks[0].text='作者修改';
  const snapshot=structuredClone(author);assert.throws(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)),/分别改动/);assert.deepEqual(author,snapshot);
  author.units[0].scenes[0].blocks[0].text=draft.units[0].scenes[0].blocks[0].text;assert.doesNotThrow(()=>applyWorkspacePatch(author,createWorkspacePatch(base,draft)));
  assert.throws(()=>applyWorkspacePatch(base,{projectId:base.id,operations:[{key:'project/id',beforeHash:null,after:{present:true,value:'override'}}]}),/格式无效/);
  const orphan=newScene();assert.throws(()=>applyWorkspacePatch(base,{projectId:base.id,operations:[{key:`scene/${base.units[0].id}/${orphan.id}`,beforeHash:null,after:{present:true,value:orphan}}]}),/未引用/);
  draft.originalMaterial={kind:'scene',text:'伪造原件'};assert.throws(()=>createWorkspacePatch(base,draft),/身份|原件/);
  const broken=structuredClone(base);broken.units[0].scenes[0].characterIds=['missing'];assert.throws(()=>createWorkspacePatch(base,broken),/引用不存在/);
});
test('scene reordering is explicit and concurrent structure edits conflict',()=>{
  const base=document();base.units[0].scenes.push(newScene('第二场'));const draft=structuredClone(base);draft.units[0].scenes.reverse();
  const patch=createWorkspacePatch(base,draft);assert.deepEqual(applyWorkspacePatch(base,patch).units[0].scenes.map(s=>s.id),draft.units[0].scenes.map(s=>s.id));
  const author=structuredClone(base);author.units[0].scenes.push(newScene('作者新场'));assert.throws(()=>applyWorkspacePatch(author,patch),/分别改动/);
});
test('explicit structural choices preserve either an author-deleted scene or the fixed workspace scene',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes[1].blocks[0].text='WORKSPACE_BODY';draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[0].scenes.pop();
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);assert.equal(conflicts[0].authorPresent,false);
  assert.equal(applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft).units[0].scenes.length,1);
  const revived=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(revived.units[0].scenes[1].blocks[0].text,'WORKSPACE_BODY');
  assert.equal(revived.units[0].summary,'WORKSPACE_SUMMARY');
  assert.throws(()=>applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}]),/固定工作稿/);
});
test('author choice keeps a concurrently edited deleted scene and unit in their parent orders',()=>{
  const base=document();base.units.push(newUnit('机械第二单元',1000,base.id));
  const draft=structuredClone(base);draft.units.pop();draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[1].scenes[0].blocks[0].text='AUTHOR_BODY';
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);
  const kept=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft);
  assert.equal(kept.units.length,2);assert.equal(kept.units[1].scenes[0].blocks[0].text,'AUTHOR_BODY');
  assert.equal(kept.units[0].summary,'WORKSPACE_SUMMARY');
  const removed=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(removed.units.length,1);
});
test('author order choice restores referenced scenes and drops excluded workspace additions',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes.pop();draft.units[0].scenes.push(newScene('工作稿新增场'));
  const author=structuredClone(base);author.units[0].scenes.push(newScene('作者新增场'));
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  const order=conflicts.find(item=>item.key===`sceneOrder/${base.units[0].id}`);
  assert.ok(order);
  const kept=applyWorkspacePatch(author,patch,[{id:order.id,choice:'AUTHOR'}],draft);
  assert.deepEqual(kept.units[0].scenes.map(scene=>scene.id),author.units[0].scenes.map(scene=>scene.id));
});
test('workspace order choice removes author-only descendants excluded by a chosen scene or unit deletion',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes.pop();draft.units[0].summary='WORKSPACE_SUMMARY';
  const author=structuredClone(base);author.units[0].scenes[1].blocks[0].text='AUTHOR_EDIT';author.units[0].scenes.push(newScene('作者新增场'));
  const patch=createWorkspacePatch(base,draft),choices=workspacePatchConflicts(author,patch).map(item=>({id:item.id,choice:'WORKSPACE' as const}));
  const merged=applyWorkspacePatch(author,patch,choices,draft);
  assert.equal(merged.units[0].scenes.length,1);assert.equal(merged.units[0].summary,'WORKSPACE_SUMMARY');
  assert.equal(author.units[0].scenes.length,3,'预览不得改写作者原稿');

  const unitBase=document();unitBase.units.push(newUnit('机械第二单元',1000,unitBase.id));
  const unitDraft=structuredClone(unitBase);unitDraft.units.pop();unitDraft.units[0].summary='WORKSPACE_UNIT_SUMMARY';
  const unitAuthor=structuredClone(unitBase);unitAuthor.units[1].scenes.push(newScene('作者新增场'));
  const unitPatch=createWorkspacePatch(unitBase,unitDraft),unitChoices=workspacePatchConflicts(unitAuthor,unitPatch).map(item=>({id:item.id,choice:'WORKSPACE' as const}));
  const unitMerged=applyWorkspacePatch(unitAuthor,unitPatch,unitChoices,unitDraft);
  assert.equal(unitMerged.units.length,1);assert.equal(unitMerged.units[0].summary,'WORKSPACE_UNIT_SUMMARY');
  assert.equal(unitAuthor.units.length,2,'单元删除预览不得改写作者原稿');
});
test('conflict choices bind to exact author and workspace values',()=>{
  const base=document(),draft=structuredClone(base),author=structuredClone(base);
  draft.title='WORKSPACE_TITLE';author.title='AUTHOR_TITLE';
  const patch=createWorkspacePatch(base,draft),first=workspacePatchConflicts(author,patch);
  author.title='AUTHOR_TITLE_V2';
  const second=workspacePatchConflicts(author,patch);assert.notEqual(first[0].id,second[0].id);
  assert.throws(()=>applyWorkspacePatch(author,patch,[{id:first[0].id,choice:'WORKSPACE'}],draft),/分别改动|冲突集合/);
});
test('an optional field added to a scene deleted by the author still requires an explicit choice',()=>{
  const base=document();base.units[0].scenes.push(newScene('机械第二场'));
  const draft=structuredClone(base);draft.units[0].scenes[1].storyOrder=2;
  const author=structuredClone(base);author.units[0].scenes.pop();
  const patch=createWorkspacePatch(base,draft),conflicts=workspacePatchConflicts(author,patch);
  assert.equal(conflicts.length,1);assert.equal(conflicts[0].authorPresent,false);
  const kept=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'AUTHOR'}],draft);
  assert.equal(kept.units[0].scenes.length,1);
  const revived=applyWorkspacePatch(author,patch,[{id:conflicts[0].id,choice:'WORKSPACE'}],draft);
  assert.equal(revived.units[0].scenes[1].storyOrder,2);
});
