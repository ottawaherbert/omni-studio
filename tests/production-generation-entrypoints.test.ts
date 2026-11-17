import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import sharp from 'sharp';
import { defaultAIConfig } from '../src/config/aiConfigDefaults';
import { submitGenerationRequest, waitForGenerationResult } from '../src/clients/generationSubmission';
import { buildVideoStoryboardAssetBoardPlan } from '../src/services/production/videoStoryboardAssetBoards';
import { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } from '../src/services/production/manualVideoStoryboard';
import { buildStoryboardCompositeVisualPages } from '../src/services/production/storyboardCompositeBoard';
import { fixtureDirectorPlan, reviewFixturePreparation, reviewFixtureStage } from './helpers/productionQualityFixture';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'production-entrypoints-'));
process.env.OMNI_DB_PATH = path.join(directory, 'fixture.db');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { GenerationStore } = await import('../src/server/generation/store');
const { GenerationEngine } = await import('../src/server/generation/engine');
const { registerGenerationRoutes } = await import('../src/server/generation/routes');
const { registerProductionAssetBoardCandidateRoutes } = await import('../src/server/routes/productionAssetBoardCandidateRoutes');
const { registerStudioCandidateRoutes } = await import('../src/server/routes/studioCandidateRoutes');
after(() => db.close());

test('normal generation uses formal quality scope, retains one candidate and allows unrelated concurrent edits', async () => {
  const target = { projectId:'entrypoints', episodeId:'episode', sceneId:'scene' };
  const shot = { id:'shot', duration:1, visualAction:'杯子落桌', editingNote:'杯子落定后切出' } as any;
  const normalized = normalizeManualStoryboardBoard({ episodeId:target.episodeId, sceneId:target.sceneId, shot,
    decision:normalizeManualStoryboardStrategy({ selectedStrategyId:'storyboard.action_continuity.v1', selectedModelProfileId:'video.storyboard_reference.configurable.short_unit.v1', expectedVideoUnitDurationSeconds:1 }),
    value:{ performanceBeat:{summary:'放杯子',startState:'杯在手中',endState:'杯在桌上'}, board:{layout:'1x1',panels:[{visualBeat:'杯子落定',subjectAction:'放杯子',framePurpose:'动作结果',durationSeconds:1}]} },
  });
  normalized.board!.visualReferenceMode='director_board';
  normalized.board!.visualPages=buildStoryboardCompositeVisualPages(normalized.board!);
  const workflow={...normalized,id:'unit',shotId:shot.id,shotIds:[shot.id],boardId:normalized.board!.id,updatedAt:1};
  dbHelpers.saveProject({id:target.projectId,title:'隔离普通生成入口',type:'movie',aspectRatio:'16:9',characters:[{id:'character',name:'甲',visualIdentity:'白衣男子'}],assets:[],episodes:[{id:target.episodeId,title:'第一集',scenes:[{
    id:target.sceneId,title:'杯子',script:'人物把杯子放到桌上。',manualStoryboard:{directorPlan:fixtureDirectorPlan(),boards:[workflow]},shots:[shot],
  }]}]} as any);
  await sharp({create:{width:160,height:90,channels:3,background:'blue'}}).png().toFile(path.join(directory,'output.png'));
  const config={...structuredClone(defaultAIConfig),channels:[{id:'fixture',name:'未连接真实服务',type:'openai',baseUrl:'https://fixture.invalid',apiKey:''}],models:[{id:'image',channelId:'fixture',modelId:'gpt-image-1',alias:'测试图片',capabilities:['image']}]} as any;
  const engine=new GenerationEngine(new GenerationStore(db),()=>config,directory);
  let providerCalls=0;
  engine.providers.submit=async()=>({providerTaskId:`fixture-${++providerCalls}`});
  engine.providers.poll=async()=>({status:'succeeded',outputs:[{url:'/media/output.png',kind:'image'}]});
  const app=express();app.use(express.json());
  registerGenerationRoutes(app,engine);registerProductionAssetBoardCandidateRoutes(app,directory);registerStudioCandidateRoutes(app);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const baseUrl=`http://127.0.0.1:${(server.address() as any).port}`;
  const post=async(route:string,body:unknown)=>{const response=await fetch(baseUrl+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  const project=()=>dbHelpers.getProjectById(target.projectId) as any;
  const scene=()=>project().episodes[0].scenes[0];
  try {
    const board=buildVideoStoryboardAssetBoardPlan(project()).characterBoards[0];
    const assetTarget={projectId:target.projectId,kind:'asset' as const,assetId:board.id,referenceMode:'production_board' as const,shotIds:[]};
    const input={baseUrl,projectId:target.projectId,modelConfigId:'image',prompt:'画独立角色资料板',aspectRatio:'16:9'};
    await assert.rejects(submitGenerationRequest(input),/实际资产/);
    await assert.rejects(submitGenerationRequest({...input,target:assetTarget}),/全剧总体/);
    assert.equal(providerCalls,0);
    const staged=await post(`/api/projects/${target.projectId}/production-asset-board-candidates`,{candidateId:'uploaded-draft',boardItemId:board.id,imageUrl:'/media/output.png',source:'upload',referenceMode:'production_board'});
    assert.equal(staged.status,200,'draft uploads remain possible');
    const denied=await post(`/api/projects/${target.projectId}/production-asset-board-candidates/uploaded-draft/adopt`,{});
    assert.equal(denied.status,409);assert.equal(denied.body.code,'PRODUCTION_QUALITY_BLOCKED');
    await reviewFixtureStage(engine.quality,'project_plan',target);
    const submitted=await submitGenerationRequest({...input,target:assetTarget});
    const result=await waitForGenerationResult(submitted,10000);
    assert.equal(engine.plan(engine.execution(result.executionId).planId).target.kind,'asset');
    assert.equal(providerCalls,1);
    assert.equal(project().manualProductionAssets.pendingReferences.filter((item:any)=>item.id===result.candidateId).length,1);
    const enriched=await post(`/api/projects/${target.projectId}/production-asset-board-candidates`,{candidateId:result.candidateId,boardItemId:board.id,imageUrl:result.url,source:'ai_generation',referenceMode:'production_board',sourceRunId:result.executionId});
    assert.equal(enriched.status,200);assert.equal(enriched.body.manualProductionAssets.pendingReferences.filter((item:any)=>item.id===result.candidateId).length,1);
    assert.equal((await post(`/api/projects/${target.projectId}/production-asset-board-candidates/${result.candidateId}/adopt`,{})).status,200);

    const page=normalized.board!.visualPages![0];
    const boardTarget={...target,kind:'board' as const,boardId:workflow.boardId,pageId:page.id,shotIds:[shot.id]};
    await assert.rejects(submitGenerationRequest({...input,target:boardTarget,operation:'joint_storyboard'}),/未通过/);
    await reviewFixturePreparation(engine.quality,target);
    const generated=await waitForGenerationResult(await submitGenerationRequest({...input,target:boardTarget,operation:'joint_storyboard'}),10000);
    assert.equal(providerCalls,2);
    const currentPage=()=>scene().manualStoryboard.boards[0].board.visualPages[0];
    const take=currentPage().visualTakes.find((item:any)=>item.id===generated.candidateId);
    assert.ok(take);
    const episode=dbHelpers.getEpisodeById(target.projectId,target.episodeId) as any;
    episode.scenes[0].productionObservations=[{id:'concurrent-note',note:'生成期间保存的观察'}];
    dbHelpers.updateEpisode(target.projectId,target.episodeId,episode);
    const append=await post(`/api/projects/${target.projectId}/episodes/${target.episodeId}/scenes/${target.sceneId}/studio-candidates`,{shotId:shot.id,boardId:workflow.boardId,pageId:page.id,visualTake:{...take,review:{mode:'manual',status:'pending',notes:'已补齐候选观察'}}});
    assert.equal(append.status,200);
    assert.equal(currentPage().visualTakes.filter((item:any)=>item.id===generated.candidateId).length,1);
    assert.equal(currentPage().visualTakes.find((item:any)=>item.id===generated.candidateId).review.notes,'已补齐候选观察');
    assert.equal(scene().productionObservations[0].id,'concurrent-note');
    assert.equal(currentPage().activeVisualTakeId,undefined,'saving a candidate cannot adopt it');
  } finally {
    engine.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
