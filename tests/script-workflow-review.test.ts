import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptProject,newUnit,newScene} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {detectWorkflowChanges} from '../packages/script/src/workflowReview';
import {SCRIPT_STAGES,COMPATIBLE_SCRIPT_STAGES,} from '../packages/script/src/writingStages';

function fixture(){
  const project=createScriptProject('机械流程',createScriptCreationProfile('tv-series',3,10));
  project.brief.outline='原总纲';project.units[0].summary='原集纲';
  project.units[0].scenes[0].purpose='原分场';project.units[0].scenes[0].blocks[0].text='已有正文';
  return project;
}
test('four new stages retain legacy BEATS contract compatibility',()=>{
  assert.deepEqual(SCRIPT_STAGES,['BLUEPRINT','OUTLINE','SCENES','BODY']);
  assert.ok(COMPATIBLE_SCRIPT_STAGES.includes('BEATS'));
});
test('upstream changes flag existing downstream material without touching the manuscript',()=>{
  const before=fixture(),after=structuredClone(before);after.brief.concept='新方向';after.units[0].summary='新集纲';
  after.units[0].scenes[0].purpose='新场景安排';const saved=JSON.stringify(after);
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.target),['outline','board','studio']);
  assert.equal(JSON.stringify(after),saved);
  const bodyOnly=structuredClone(before);bodyOnly.units[0].scenes[0].blocks[0].text='修改对白';
  assert.deepEqual(detectWorkflowChanges(before,bodyOnly),[]);
});
test('initial planning without downstream text does not create a false review task',()=>{
  const before=createScriptProject('机械新稿',createScriptCreationProfile('short-film',1,3));
  const after=structuredClone(before);after.brief.concept='构想';after.brief.outline='故事';after.units[0].scenes[0].purpose='第一场';
  assert.deepEqual(detectWorkflowChanges(before,after),[]);
});
test('author completing a partial scene does not falsely report changed planning',()=>{
  const before=fixture();before.units[0].scenes[0].generation={status:'partial',checkpointId:'fixture',appliedSteps:[]};
  const after=structuredClone(before);after.units[0].scenes[0].blocks[0].text+='，作者补完结尾。';after.units[0].scenes[0].generation!.status='complete';
  assert.deepEqual(detectWorkflowChanges(before,after),[]);
});
test('structure purpose changes flag the existing body even when membership stays fixed',()=>{
  const before=fixture();before.units[0].structureNodes=[{id:'node-a',title:'开场',purpose:'旧安排'}];
  const after=structuredClone(before);after.units[0].structureNodes![0].purpose='新安排';
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.key),[`scenes:${before.units[0].id}`]);
});
test('a local story outline change flags its own episode and leaves unrelated stories alone',()=>{
  const before=fixture(),a=before.units[0];a.scopeId='story-a';before.units.push(newUnit('另一个故事',60000));
  const b=before.units[1];b.scenes[0].blocks[0].text='无关故事原文';
  before.storyOutlines=[{scopeId:a.scopeId,outline:'旧故事大纲'},{scopeId:b.scopeId,outline:'无关故事大纲'}];
  const after=structuredClone(before);after.storyOutlines![0].outline='新故事大纲';
  assert.deepEqual(detectWorkflowChanges(before,after).map(item=>item.unitId),[a.id]);
});
test('review notices survive repository reopen and unrelated saves; stale acknowledgement cannot clear a new change',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const repo=createScriptRepository(db);repo.ensureSchema();
  let project=repo.saveProject(fixture(),0);project.brief.outline='新总纲';project=repo.saveProject(project,project.revision);
  const original=repo.workflowReviews(project.id);assert.equal(original.length,1);
  const reopened=createScriptRepository(db);reopened.ensureSchema();assert.deepEqual(reopened.workflowReviews(project.id),original);
  project.units[0].scenes[0].blocks[0].text='正文修订';project=reopened.saveProject(project,project.revision);
  assert.deepEqual(reopened.workflowReviews(project.id),original);
  project.brief.outline='再次修改总纲';project=reopened.saveProject(project,project.revision);
  assert.throws(()=>reopened.acknowledgeWorkflowReviews(project.id,project.revision-1,original.map(item=>item.id)),
    (error: unknown) => error instanceof Error && (error as Error & {statusCode?: number}).statusCode === 409);
  reopened.acknowledgeWorkflowReviews(project.id,project.revision,original.map(item=>item.id));
  assert.equal(reopened.workflowReviews(project.id).length,1);
  const manuscript=JSON.stringify(reopened.getProject(project.id));
  reopened.acknowledgeWorkflowReviews(project.id,project.revision,reopened.workflowReviews(project.id).map(item=>item.id));
  assert.deepEqual(reopened.workflowReviews(project.id),[]);assert.equal(JSON.stringify(reopened.getProject(project.id)),manuscript);
});
