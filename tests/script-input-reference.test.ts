import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createInteractiveWritingPort } from '../src/server/interactiveWritingPort';

test('interactive bindings and production preparation retain explicitly selected input after author saves',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'script-input-reference-'));
  const previousPath=process.env.OMNI_DB_PATH;
  process.env.OMNI_DB_PATH=path.join(directory,'production.sqlite');
  const scriptsDb=new Database(':memory:');
  let productionDb:InstanceType<typeof Database>|undefined;
  try {
    // Import only after choosing the isolated path; this module otherwise opens
    // the application's real production database as a module side effect.
    const {db,dbHelpers}=await import('../src/server/db');productionDb=db;
    const {interactiveRepository}=await import('../src/server/interactiveRepository');
    const {createInteractiveProductionPrepPort}=await import('../src/server/interactiveProductionPrepPort');
    const scripts=createScriptRepository(scriptsDb);scripts.ensureSchema();
    const initial=createScriptProject('机械引用验收',createScriptCreationProfile('short-film',1,3));
    initial.units[0].scenes[0].blocks[0].text='MECHANICAL_SELECTED_ORIGINAL';
    const author=scripts.saveProject(initial,0),writing=createInteractiveWritingPort(scripts);
    assert.equal((scriptsDb.prepare('SELECT count(*) n FROM script_project_inputs').get() as any).n,0);
    const selected=writing.listScenes(author.id)[0];
    assert.equal((scriptsDb.prepare('SELECT count(*) n FROM script_project_inputs').get() as any).n,1);
    const next=structuredClone(author);next.units[0].scenes[0].blocks[0].text='MECHANICAL_LATER_AUTHOR_BODY';
    scripts.saveProject(next,author.revision);
    assert.equal(writing.resolveScene({...selected.ref,checksum:'forged'}),null);
    assert.equal(writing.resolveScene(selected.ref)!.scriptBlocks[0].content,'MECHANICAL_SELECTED_ORIGINAL');
    const experience=interactiveRepository.createExperience({
      title:'机械固定来源筹备',genre:'悬疑',
      formatProfile:{format:'branching_fmv',aspectRatio:'16:9',platforms:['web'],primaryLanguage:'zh-CN',targetSessionMinutes:3,targetCompleteMinutes:3},
      experienceSpec:{playerRole:'调查者',playerPersona:'谨慎',interactionPromise:'选择改变结果',coreVerbs:['选择'],
        dramaticContract:{genre:'悬疑',theme:'代价',centralConflict:'决定是否离开'},choiceCadence:{targetChoicesPerTenMinutes:1,maxMinutesWithoutChoice:3},
        consequenceHorizon:['immediate'],failStatePolicy:'rollback',savePolicy:'auto_checkpoint',
        accessibilitySettings:{closedCaptions:true,timedChoiceOption:'extended',colorBlindSafe:true}},
      storyArchitecture:{premise:'门前决定',protagonistGoal:'离开',thematicQuestion:'是否值得',mandatoryNodes:[],variableNodes:[],endings:[],branchBudget:{maxDepth:1,maxParallelBranches:1}},
      storySource:{mode:'bind_writing',writingProjectId:author.id},
      productionBoundary:{maxBranchDepth:1,maxParallelBranches:1,exclusiveContentPercent:0,maxAutomaticRepairAttempts:1},
    });
    interactiveRepository.saveGraph(experience.experience.id,{entryNodeId:'mechanical_end',nodes:[{
      id:'mechanical_end',brief:{nodeId:'mechanical_end',title:'离开',intent:'结束调查',dramaticFunction:'ending',narrativeSummary:'决定离开。'},
      contract:{readVariables:[],writeVariables:[],requiredFacts:[],producedFacts:[]},
      interaction:{capabilities:['play_content','terminal'],contentPolicy:'compatible_state_reuse',durationRangeSec:[1,60],playerKnowledgeIn:[],playerKnowledgeOut:[]},choices:[],
    }]});
    interactiveRepository.saveBinding(experience.experience.id,{nodeId:'mechanical_end',slot:'main',scriptSceneRefs:[selected.ref],status:'approved',
      contentFitReview:{verdict:'pass',rationale:'机械验收确认来源',reviewedAt:new Date().toISOString(),sceneChecksums:[selected.ref.checksum]}});
    const preparation=createInteractiveProductionPrepPort({scriptRepository:scripts,writingPort:writing});
    const target=preparation.ensureTarget(experience.experience.id);
    assert.equal(target.sourceWritingRevision,author.revision);
    const project=dbHelpers.getProjectById(target.productionProjectId)!;
    assert.match(project.productionSourceDocuments![0].content,/MECHANICAL_SELECTED_ORIGINAL/);
    assert.doesNotMatch(JSON.stringify(project.productionSourceSnapshot),/MECHANICAL_LATER_AUTHOR_BODY/);
    assert.equal(preparation.ensureTarget(experience.experience.id).productionProjectId,target.productionProjectId);
    scripts.deleteProject(author.id);
    assert.equal(writing.resolveScene(selected.ref),null);
    assert.throws(()=>preparation.ensureTarget(experience.experience.id),/引用不完整|失效/);
  } finally {
    productionDb?.close();scriptsDb.close();
    if(previousPath===undefined)delete process.env.OMNI_DB_PATH;else process.env.OMNI_DB_PATH=previousPath;
    rmSync(directory,{recursive:true,force:true});
  }
});
