import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptProject,registerDialogueSpeaker} from '../packages/script/src/project';
import {createScriptCreationProfile,createScriptProjectFromMaterial} from '../packages/script/src/creation';
import {unitCharacters} from '../packages/script/src/continuity';
import {buildScriptTaskContext} from '../packages/script/src/methods';
import {agentTaskTarget,agentReviewSceneIds} from '../packages/script/src/agent';
import {exportText,createScriptDelivery} from '../packages/script/src/exporters';
import type {ScriptProject,ScriptOperation} from '../packages/script/src/schema';
import {independentStories,serialOutlines,serialScenes,microScenes,type CreativeScene} from './fixtures/script-creative-samples';
const provenance={source:'manual_external' as const,provider:'self-written-acceptance',modelId:'no-external-model'};
function open(){const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();return {db,repo};}
type Repo=ReturnType<typeof createScriptRepository>;
test('作品对话接收普通文本和 JSON 示例，不把聊天返回当作正文修改',()=>{
  const {db,repo}=open();try{
    const p=repo.saveProject(createScriptProject('对话验收',createScriptCreationProfile('short-film',1,5)),0);
    for(const raw of ['可以让女儿接过扳手。','{"blocks":[{"text":"只是聊天中的示例"}]}']){
      const job=repo.createJob(p.id,{operation:'consult',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,expectedRevision:p.revision,prompt:'回应作者的问题',authorRequest:'帮我想一句话'});
      const result=repo.submitJob(p.id,job.id,raw,provenance);
      assert.equal(result.status,'ready');assert.equal(result.result?.answer,raw);
      assert.deepEqual(repo.getProject(p.id),p);
    }
    const write=repo.createJob(p.id,{operation:'scene',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,expectedRevision:p.revision,prompt:'写本场正文'});
    assert.equal(repo.submitJob(p.id,write.id,'这不是结构化正文返回',provenance).status,'failed');
    assert.deepEqual(repo.getProject(p.id),p);
  }finally{db.close();}
});
test('带入单场原件逐字留存，局部改写与保存不改写原件或未选段落',()=>{
  const {db,repo}=open();try{
    const raw='  内景 修车铺 - 傍晚\n\n父亲拧紧螺帽。\n\n女儿\n（低声）\n灯还亮着。\n\n';
    let project=repo.saveProject(createScriptProjectFromMaterial('原件保护',createScriptCreationProfile('short-film',1,10),{concept:'',theme:'',outline:'',sceneText:raw}),0);
    project=repo.getProject(project.id)!;
    const original=structuredClone(project);
    assert.equal(project.originalMaterial?.text,raw);
    assert.equal(repo.getProject(project.id)?.originalMaterial?.text,raw);
    const unit=project.units[0],scene=unit.scenes[0];
    const job=repo.createJob(project.id,{unitId:unit.id,sceneId:scene.id,operation:'rewrite',blockIds:[scene.blocks[1].id],expectedRevision:project.revision,prompt:'仅改这一段'});
    repo.submitJob(project.id,job.id,JSON.stringify({summary:'本地模拟返回',blocks:[{type:'action',text:'父亲松开螺帽。'}]}),provenance);
    project=repo.transition(project.id,job.id,'approve').project!;
    assert.equal(project.originalMaterial?.text,raw);
    assert.deepEqual(project.units[0].scenes[0].blocks.slice(2),original.units[0].scenes[0].blocks.slice(2));
    const overwritten=structuredClone(project);overwritten.originalMaterial!.text='错误覆盖';
    assert.throws(()=>repo.saveProject(overwritten,overwritten.revision),/输入原件不可改写/);
    assert.deepEqual(repo.getJobInput(project.id,job.id),original);
    assert.deepEqual(repo.getProject(project.id),project);
    project=repo.saveProject({...project,title:'原件保护：作者新标题'},project.revision);
    assert.deepEqual(project.units[0].scenes[0].blocks.slice(2),original.units[0].scenes[0].blocks.slice(2));
    assert.equal(project.originalMaterial?.text,raw);
    assert.doesNotMatch(JSON.stringify(buildScriptTaskContext(project,project.units[0],'scene',[],scene.id).context),/originalMaterial/);
  }finally{db.close();}
});
function propose(repo:Repo,project:ScriptProject,unitIndex:number,operation:ScriptOperation,result:unknown){
  const unit=project.units[unitIndex];const task=buildScriptTaskContext(project,unit,operation,[],unit.scenes[0].id);
  const job=repo.createJob(project.id,{unitId:unit.id,sceneId:unit.scenes[0].id,operation,expectedRevision:project.revision,prompt:JSON.stringify(task)});
  assert.equal(repo.submitJob(project.id,job.id,JSON.stringify(result),provenance).status,'ready');
  return repo.transition(project.id,job.id,'approve').project!;
}
function writeOne(repo:Repo,project:ScriptProject,unitIndex:number,sample:CreativeScene){
  project=propose(repo,project,unitIndex,'plan',{summary:'作者自写的分场返回，只推进这件小事',scenePlans:[{title:sample.title,location:sample.location,timeOfDay:sample.timeOfDay,purpose:sample.purpose}]});
  const unit=project.units[unitIndex];const others=project.units.filter(item=>item.id!==unit.id);
  let run=repo.createAgentRun(project.id,{unitId:unit.id,goal:sample.purpose+'。不强制反转，保留有用的留白。',strategy:'write_existing',maxScenes:1,maxCalls:2,executionMode:'manual',methodIds:project.methods.map(method=>method.id)});
  run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
  for(let count=0;count<2;count++){
    const draft=repo.getAgentDraft(project.id,run.id);const target=agentTaskTarget(run,draft)!;const currentUnit=draft.units[unitIndex];
    const reviewSceneIds=target.operation==='review'?agentReviewSceneIds(run,draft):undefined;
    const task=buildScriptTaskContext(draft,currentUnit,target.operation,run.methodIds,target.sceneId,reviewSceneIds);
    const step=repo.createAgentStep(project.id,run.id,run.version,{unitId:unit.id,sceneId:target.sceneId,operation:target.operation,expectedRevision:draft.revision,prompt:JSON.stringify(task),methodIds:run.methodIds,reviewSceneIds});run=step.run;
    const claimed=repo.claimAgentExecution(project.id,run.id,step.job.id,'creative-fixture');run=claimed.run;
    const result=target.operation==='scene'?{summary:'按作者提供的完整样稿返回，体量不视为实测时长',blocks:sample.blocks.map(block=>{const known=block.speakerName&&unitCharacters(draft,currentUnit).find(character=>character.name===block.speakerName);if(!known)return block;const {speakerName,...rest}=block;return {...rest,speakerId:known.id};})}:{summary:`本次只读《${sample.title}》完整正文。动作的前因后果见实际稿件；没有把人物数、反转数当质量分。时长须排练确认。`,findings:[]};
    assert.equal(repo.submitJob(project.id,step.job.id,JSON.stringify(result),provenance,undefined,claimed.job.execution!.id).status,'ready');
    if(target.operation==='scene')repo.transition(project.id,step.job.id,'approve');
    run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
  }
  assert.equal(run.status,'complete');assert.equal(run.callsUsed,2);
  const result=repo.publishAgentRun(project.id,run.id,run.version,project.revision).project;
  assert.deepEqual(result.units.filter(item=>item.id!==unit.id),others);
  return result;
}
function artifact(name:string,project:ScriptProject,notes:unknown){
  const folder=process.env.SCRIPT_CREATIVE_ARTIFACTS;if(!folder)return;
  mkdirSync(folder,{recursive:true});
  for(const format of ['markdown','fountain'] as const)writeFileSync(resolve(folder,`${name}.${format==='markdown'?'md':'fountain'}`),exportText(project,format));
  writeFileSync(resolve(folder,`${name}.json`),JSON.stringify({project,notes},null,2));
}
test('创作流程：三个独立故事写作、登记人物、跨故事保护、修订与当前稿交付',()=>{
  const {db,repo}=open();try{
    let project=repo.saveProject(createScriptProject('三件小事',createScriptCreationProfile('anthology',3,3)),0);
    project.brief.concept='三个互不串场的日常故事：雨夜留伞、送错的信和一本缺页书；不要求反转。';project=repo.saveProject(project,project.revision);
    project=propose(repo,project,0,'unit_outlines',{summary:'三条独立生活线',units:independentStories.map((scene,index)=>({unitIndex:index+1,title:scene.title,summary:scene.purpose}))});
    for(let index=0;index<3;index++){
      project=writeOne(repo,project,index,independentStories[index]);
      const unit=project.units[index];for(const name of new Set(independentStories[index].blocks.map(block=>block.speakerName).filter((name):name is string=>Boolean(name))))registerDialogueSpeaker(project,unit.id,unit.scenes[0].id,name);
      project=repo.saveProject(project,project.revision);
      const context=buildScriptTaskContext(project,unit,'scene',[],unit.scenes[0].id).context;
      assert.ok(context.characters.every(character=>character.scopeId===unit.scopeId));assert.equal(context.otherUnits.length,0);
    }
    assert.equal(project.units.length,3);assert.ok(project.units.every(unit=>unit.scenes[0].blocks.some(block=>block.type==='dialogue'&&block.speakerId)));
    const before=structuredClone(project);const changed=structuredClone(independentStories[1].blocks);changed.at(-1)!.text+='门内，陈姨把信封收进抽屉，没有再拿它垫花架。';
    project=propose(repo,project,1,'scene',{summary:'补回信封去向，其他故事保持原稿',blocks:changed});
    assert.deepEqual(project.units[0],before.units[0]);assert.deepEqual(project.units[2],before.units[2]);
    assert.ok(exportText(project,'fountain').includes('陈姨'));assert.equal(createScriptDelivery(project).sourceRevision,project.revision);
    artifact('independent-stories',project,{kind:'3 independent authored scenes',writtenUnits:3,externalModelCalls:0,scope:'工程与创作操作样稿，非作者艺术验收或成片实测'});
  }finally{db.close();}
});
test('创作流程：12 集连续剧规划，三集接力写作，修改第二集不重写其他集，Skill 与跨集摘要贯通',()=>{
  const {db,repo}=open();try{
    let project=repo.saveProject(createScriptProject('雨声档案',createScriptCreationProfile('tv-series',12,5)),0);
    project.brief.concept='整理城市旧声音的日常连续故事。两位管理员从坚持自己的记忆到允许目录保留不确定性。';
    project.methods=[{id:'skill-voices',title:'对白与不确定性',version:'author-1',content:'许禾说话短、先确认来源；顾川常从具体声音开始回忆。新证据可以纠正记忆，保留档案来源而不强行统一结论。',usage:{operations:['scene','review'],inputs:[],note:'不增加反派和硬反转。'}}];
    project=repo.saveProject(project,project.revision);
    project=propose(repo,project,0,'unit_outlines',{summary:'按实际 12 集配置规划连续推进',units:serialOutlines.map((summary,index)=>({unitIndex:index+1,title:`档案 ${index+1}`,summary}))});assert.equal(project.units.length,12);
    for(let index=0;index<3;index++){
      project=writeOne(repo,project,index,serialScenes[index]);
      const context=buildScriptTaskContext(project,project.units[index],'scene',['skill-voices'],project.units[index].scenes[0].id);
      assert.equal(context.context.otherUnits.length,11);assert.ok(context.instructions.includes('许禾说话短'));assert.ok(repo.listAgentRuns(project.id).every(run=>run.methods[0].version==='author-1'));
    }
    const before=structuredClone(project);const revised=structuredClone(serialScenes[1].blocks);revised[4].text+='备注旁的小方框仍未勾选。';project=propose(repo,project,1,'scene',{summary:'强化地点暂未确认的可见标记',blocks:revised});
    assert.deepEqual(project.units.filter((_,i)=>i!==1),before.units.filter((_,i)=>i!==1));assert.equal(project.units.filter(unit=>unit.scenes.some(scene=>scene.blocks.some(block=>block.text.trim()))).length,3);
    artifact('serialized-12-plan-3-drafts',project,{plannedUnits:12,writtenUnits:3,externalModelCalls:0,scope:'三集短样与十二集规划，不宣称整季已写完'});
  }finally{db.close();}
});
test('创作流程：微短剧可选择不反转，两集具体事件推进，导出保留新人物姓名',()=>{
  const {db,repo}=open();try{
    let project=repo.saveProject(createScriptProject('空白边',createScriptCreationProfile('micro-drama',2,1)),0);
    project.brief.constraints='一集约一分钟，温和喜剧，不设置固定秒数钩子，不让老人承担被嘲笑的功能。';project=repo.saveProject(project,project.revision);
    project=propose(repo,project,0,'unit_outlines',{summary:'两集用图画与留白往返',units:microScenes.map((scene,index)=>({unitIndex:index+1,title:scene.title,summary:scene.purpose}))});
    for(let index=0;index<2;index++)project=writeOne(repo,project,index,microScenes[index]);
    assert.equal(project.profile.targetDurationMs,60000);assert.equal(project.units.length,2);assert.ok(project.units.every(unit=>unit.targetDurationMs===60000));assert.ok(exportText(project,'fountain').includes('冯奶奶'));
    artifact('micro-drama',project,{plannedUnits:2,writtenUnits:2,targetMinutesPerUnit:1,externalModelCalls:0,scope:'目标时长，未进行演读计时'});
  }finally{db.close();}
});

test('创作流程：单元剧常驻人物、两个同名访客与明确续篇共享，各自实际写作不串身份',()=>{
 const {db,repo}=open();try{
  let project=repo.saveProject(createScriptProject('借阅台',createScriptCreationProfile('procedural',3,2)),0);
  const scenes:CreativeScene[]=[
   {title:'书脊里的便条',location:'社区图书馆',timeOfDay:'日',purpose:'教师林敏归还父亲借的书，管理员杜青保留夹在书里的手写便条。',blocks:[{type:'action',text:'林敏把书放在柜台上，书脊开了。杜青扶住散页，一张折过的便条落出来。林敏去拿，又把手缩回去。'},{type:'dialogue',speakerName:'林敏',text:'是我父亲写的。他总怕找不到上次读到哪儿。'},{type:'action',text:'杜青拿来修书胶带，把便条推到林敏面前。她展开一半，看见熟悉的笔迹，没有继续展开。'},{type:'dialogue',speakerName:'杜青',text:'这张不属于馆里。你带回去。'},{type:'action',text:'林敏把便条夹进自己的教案本。杜青在登记页写下书页破损，划掉罚款一栏里的横线，改为“正常修补”。'}]},
   {title:'车篮里的收据',location:'社区图书馆',timeOfDay:'午',purpose:'另一位同名林敏是骑车送件的青年，他找回忘记盖章的收据。',blocks:[{type:'action',text:'青年林敏把自行车停在门外，举着一张起皱的收据。杜青指了指门边的架子，让他先放好头盔。'},{type:'dialogue',speakerName:'林敏',text:'昨天送的纸，忘了盖章。'},{type:'action',text:'杜青找到签收本，核对箱数。他数到第三箱，青年林敏补了一句“两箱大的，一个小包”。杜青翻回另一页，找到了夹在中间的小单。'},{type:'dialogue',speakerName:'杜青',text:'这回给你钉在一起。'},{type:'action',text:'青年把盖好章的收据装进透明袋，先放入车篮，又取出来塞进贴身口袋。杜青隔着窗指指头盔，青年笑着回来拿。'}]},
   {title:'便条背面',location:'社区图书馆',timeOfDay:'日',purpose:'第一集的教师林敏回来，展示父亲便条背面的借阅清单，杜青帮她保留扫描件。',blocks:[{type:'action',text:'教师林敏从教案本里拿出那张便条，已经摊平。杜青认出上回的折痕，把修好的书拿到柜台。'},{type:'dialogue',speakerName:'林敏',text:'背面还有五本。能帮我查查吗？'},{type:'action',text:'杜青转过显示器，两人照着手写书名逐字输入。第一本没有结果，林敏将便条凑近，指着一个连笔字。'},{type:'dialogue',speakerName:'杜青',text:'可能不是这个“河”。先扫一份，原件你收好。'},{type:'action',text:'扫描仪亮起。林敏把便条重新夹进教案本，柜台上留下印着五行书名的一张纸。杜青在第一行旁边画了一个问号。'}]},
  ];
  project=propose(repo,project,0,'unit_outlines',{summary:'三个单元，第三个是第一个故事的明确续篇',units:scenes.map((scene,index)=>({unitIndex:index+1,title:scene.title,summary:scene.purpose}))});
  project.units[2].scopeId=project.units[0].scopeId;
  const character=(id:string,name:string,scopeId:string,arc:string)=>({id,name,scopeId,desire:'',need:'',contradiction:'',voice:'',arc});
  project.characters=[character('librarian','杜青',project.id,'常驻管理员，温和但认真核对资料'),character('teacher','林敏',project.units[0].scopeId,'教师，父亲留下了一张便条'),character('courier','林敏',project.units[1].scopeId,'青年送件员，需要带回签收单')];
  project.facts=[{id:'private-note',scopeId:project.units[0].scopeId,text:'父亲便条背面有五本待查书目',status:'approved'}];project=repo.saveProject(project,project.revision);
  for(let index=0;index<3;index++){
   const unit=project.units[index];const context=buildScriptTaskContext(project,unit,'scene',[],unit.scenes[0].id).context;
   assert.deepEqual(context.characters.map(character=>character.id).sort(),['librarian',index===1?'courier':'teacher'].sort());assert.equal(context.facts.length,index===1?0:1);
   project=writeOne(repo,project,index,scenes[index]);
   assert.ok(project.units[index].scenes[0].blocks.some(block=>block.speakerId===(index===1?'courier':'teacher')));
  }
  const text=exportText(project,'markdown');assert.ok(text.includes('教案本'));assert.ok(text.includes('签收本'));
  artifact('procedural-shared-and-sequel',project,{writtenUnits:3,sharedCharacter:'杜青',sameNameDifferentPeople:'林敏',explicitSequel:[1,3],externalModelCalls:0});
 }finally{db.close();}
});
