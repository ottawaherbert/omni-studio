import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptRepository, ScriptConflictError } from '../apps/api/src/repositories/scriptStore';
import { scriptClient } from '../apps/web/src/clients/scriptClient';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { applyScenePlans, sceneHasAuthorWork } from '../packages/script/src/planning';
import { buildScriptTaskContext } from '../packages/script/src/methods';

const source={source:'manual_external' as const,provider:'acceptance',modelId:'self-written'};
const authorHistoryCount=(db:InstanceType<typeof Database>)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='script_revisions'").get()?(db.prepare('SELECT count(*) AS n FROM script_revisions').get() as {n:number}).n:0;
const body=JSON.stringify({summary:'用动作表现守候，不添加反转',blocks:[{type:'action',text:'林夏把第二只碗放回碗柜，留着灶上的火。'}]});
function setup(){
  const db=new Database(':memory:');
  const repo=createScriptRepository(db);repo.ensureSchema();
  const project=repo.saveProject(createScriptProject('留一盏灯',createScriptCreationProfile('short-film',1,5)),0);
  return {db,repo,project};
}
test('验收：仅填写故事时间、人物或时长的卡片也属于作者稿，重新拆场必须保留',()=>{
  for(const field of ['storyTime','characterIds','targetDurationMs','storyOrder','storylineIds'] as const){
    const project=createScriptProject('空卡不是空稿',createScriptCreationProfile('short-film',1,5));
    const scene=project.units[0].scenes[0];
    Object.assign(scene,{[field]:field==='storyTime'?'三年前':field==='characterIds'?['character']:field==='storylineIds'?['line']:1});
    assert.equal(sceneHasAuthorWork(scene),true,field);
    applyScenePlans(project,[{scenes:[{title:'新场',purpose:'模型提出的新场'}]}]);
    assert.equal(project.units[0].scenes[0].id,scene.id,field);
  }
});
test('验收：客户端删除实际使用 DELETE，读取接口使用 GET',async()=>{
  const fetchBefore=globalThis.fetch;
  const methods:string[]=[];
  globalThis.fetch=async(_input,init)=>{
    methods.push(init?.method||'GET');
    return new Response(JSON.stringify({success:true,projects:[]}),{status:200});
  };
  try{await scriptClient.deleteProject('only-test');await scriptClient.listProjects();assert.deepEqual(methods,['DELETE','GET']);}
  finally{globalThis.fetch=fetchBefore;}
});
test('验收：过期返回保留正文与实际修改过的提示词，但不能采用覆盖作者新稿',()=>{
  const {db,repo,project}=setup();
  try{
    const job=repo.createJob(project.id,{operation:'scene',unitId:project.units[0].id,sceneId:project.units[0].scenes[0].id,prompt:'原提示词',expectedRevision:project.revision});
    project.units[0].scenes[0].blocks[0].text='作者在请求期间改了正文';
    const saved=repo.saveProject(project,project.revision);
    const executionPrompt={prompt:'实际发出的提示词：保留灶火',systemInstruction:'不用对白'};
    const returned=repo.submitJob(project.id,job.id,body,source,executionPrompt);
    assert.equal(returned.status,'failed');assert.match(returned.error!,/基线/);
    assert.equal(returned.rawResult,body);assert.deepEqual(returned.attempts![0].executionPrompt,executionPrompt);
    assert.throws(()=>repo.transition(project.id,job.id,'approve'),/基线/);
    assert.deepEqual(repo.getProject(project.id),saved);
  }finally{db.close();}
});
test('验收：审阅意见关联改稿和复查，保留任务输入与证据，不以点击准备修改伪装成已解决',()=>{
  const {db,repo,project}=setup();
  try{
    project.units[0].scenes[0].blocks[0].text='林夏对空屋说：回来自己盛。';
    let saved=repo.saveProject(project,project.revision);
    const target={unitId:saved.units[0].id,sceneId:saved.units[0].scenes[0].id};
    const review=repo.createJob(saved.id,{...target,operation:'review',prompt:'核对克制表达',expectedRevision:saved.revision});
    repo.submitJob(saved.id,review.id,JSON.stringify({summary:'一句台词可转为行动',findings:[{sceneId:target.sceneId,issue:'对空屋说话直接说明意图',suggestion:'把饭勺留在父亲惯用的一边'}]}),source);
    repo.recordReviewDecision(saved.id,review.id,0,'to_fix');
    const reviewSource={jobId:review.id,index:0};
    const revision=repo.createJob(saved.id,{...target,operation:'scene',prompt:'用摆勺动作代替自言自语',expectedRevision:saved.revision,reviewSource});
    repo.submitJob(saved.id,revision.id,JSON.stringify({summary:'改为可见动作',blocks:[{type:'action',text:'林夏把勺柄转向父亲惯坐的位置，留着厨房的灯。'}]}),source);
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].status,'to_fix');
    saved=repo.transition(saved.id,revision.id,'approve').project!;
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].status,'revised');
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].revisionJobId,revision.id);
    const recheck=repo.createJob(saved.id,{...target,operation:'review',prompt:'只复查原问题是否仍存在',expectedRevision:saved.revision,reviewSceneIds:[target.sceneId],reviewSource});
    repo.submitJob(saved.id,recheck.id,JSON.stringify({summary:'原句已删，勺柄方向承担留饭意图，本轮未再发现原问题。',findings:[]}),source);
    const resolution=repo.getJob(saved.id,review.id).reviewDecisions![0];
    assert.equal(resolution.status,'verified');assert.equal(resolution.revision,saved.revision);assert.equal(resolution.recheckJobId,recheck.id);
    assert.equal(repo.getJobInput(saved.id,revision.id).units[0].scenes[0].blocks[0].text,'林夏对空屋说：回来自己盛。');
    assert.throws(()=>repo.createJob(saved.id,{...target,operation:'outline',prompt:'不能扩大到全剧',expectedRevision:saved.revision,reviewSource}),/不匹配/);
  }finally{db.close();}
});

test('验收：十二集大纲任务严格校验、持久恢复，仅填空白且保留正文与结尾',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const draft=createScriptProject('末班车',createScriptCreationProfile('tv-series',12,45));
    draft.units[0].summary='作者已确定：母亲决定回乡。';draft.units[0].endingHook='车停在桥头。';draft.units[0].scenes[0].blocks[0].text='车窗上结了一层雾。';
    const project=repo.saveProject(draft,0);const unit=project.units[0];
    const job=repo.createJob(project.id,{operation:'unit_outlines',unitId:unit.id,sceneId:unit.id,prompt:'按十二集规划，只填空白',expectedRevision:project.revision});
    const bad=repo.submitJob(project.id,job.id,JSON.stringify({summary:'错误越权',units:[{unitIndex:2,summary:'第二集',scenes:[]}]}),source);
    assert.equal(bad.status,'failed');assert.match(bad.error!,/不可修改/);
    const units=Array.from({length:12},(_,i)=>({unitIndex:i+1,title:`旅途 ${i+1}`,summary:`第 ${i+1} 段旅程，在一座不同的车站停留。`}));
    assert.equal(repo.submitJob(project.id,job.id,JSON.stringify({summary:'每集独立一段行程',units}),source).status,'ready');
    const reopened=createScriptRepository(db);reopened.ensureSchema();const adopted=reopened.transition(project.id,job.id,'approve').project!;
    assert.equal(adopted.units.length,12);assert.deepEqual(adopted.units[0],project.units[0]);assert.equal(adopted.units[11].summary,units[11].summary);
    assert.equal(reopened.getJob(project.id,job.id).attempts!.length,2);
    assert.equal(reopened.transition(project.id,job.id,'approve').project!.revision,adopted.revision);
  }finally{db.close();}
});
test('验收：单元大纲只替换指定单元，任务输入可追溯且不写入故事总纲',()=>{
  const {db,repo,project}=setup();try{
    project.brief.outline='全片总纲';project.units[0].summary='原摘要';project.units[0].endingHook='留白';
    const saved=repo.saveProject(project,project.revision);const unit=saved.units[0];
    const job=repo.createJob(saved.id,{operation:'unit_outline',unitId:unit.id,sceneId:unit.id,prompt:'细化摘要',expectedRevision:saved.revision});
    repo.submitJob(saved.id,job.id,JSON.stringify({summary:'补上行为',outline:'林夏留下一盏灯，然后离开。'}),source);
    const next=repo.transition(saved.id,job.id,'approve').project!;
    assert.equal(next.brief.outline,'全片总纲');assert.equal(next.units[0].endingHook,'留白');assert.deepEqual(next.units[0].scenes,unit.scenes);assert.equal(repo.getJobInput(saved.id,job.id).units[0].summary,'原摘要');
  }finally{db.close();}
});
test('验收：蓝图建议使用 Skill 快照，一次只采用一个方案；设定保持待确认且不串故事',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const draft=createScriptProject('三条街',createScriptCreationProfile('anthology',3,20));
    draft.methods=[{id:'everyday',title:'日常观察',version:'2',content:'先观察动作，不套冲突公式。',usage:{operations:['fact'],inputs:[],note:'保留日常语气'}}];
    const project=repo.saveProject(draft,0);const unit=project.units[0];
    const input={operation:'fact' as const,unitId:unit.id,sceneId:unit.id,prompt:'提出街道设定',expectedRevision:project.revision,methodIds:['everyday']};
    assert.throws(()=>repo.createJob(project.id,{...input,scopeId:'missing'}),/范围/);
    const job=repo.createJob(project.id,input);assert.equal(job.methods[0].content,draft.methods[0].content);
    repo.submitJob(project.id,job.id,JSON.stringify({summary:'仅提供生活细节',suggestions:[{title:'收摊时间',content:'这条街的修鞋摊每晚七点收摊。'},{title:'雨棚',content:'巷口雨棚漏水。'}]}),source);
    const next=repo.transition(project.id,job.id,'approve',0).project!;
    assert.equal(next.facts.length,1);assert.equal(next.facts[0].status,'draft');assert.equal(next.facts[0].scopeId,unit.scopeId);
    assert.equal(repo.transition(project.id,job.id,'approve',0).project!.revision,next.revision);assert.throws(()=>repo.transition(project.id,job.id,'approve',1),/另一方案/);
    assert.throws(()=>repo.createJob(project.id,{...input,operation:'character',expectedRevision:next.revision}),/不适用/);
  }finally{db.close();}
});
test('验收：讨论记录在作者继续写作后仍保存答复，不能当作正文提案采用',()=>{
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const job=repo.createJob(project.id,{operation:'consult',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'已读当前场，讨论灯的作用',authorRequest:'灯是否太直白？',expectedRevision:project.revision});
    project.units[0].scenes[0].blocks[0].text='作者继续写：林夏拔掉了插头。';repo.saveProject(project,project.revision);
    assert.equal(repo.submitJob(project.id,job.id,JSON.stringify({summary:'谈灯的作用',answer:'就本轮读取的旧稿而言，灯可以承担行动结果，不必再用独白解释。'}),source).status,'ready');
    assert.equal(repo.getJob(project.id,job.id).authorRequest,'灯是否太直白？');assert.throws(()=>repo.transition(project.id,job.id,'approve'));
    assert.equal(repo.getProject(project.id)!.units[0].scenes[0].blocks[0].text,'作者继续写：林夏拔掉了插头。');
  }finally{db.close();}
});
test('验收：选中部分对白润色，未经选中的正文与数据保持原样，过期选择被拒绝',async()=>{
  const {blocksToScreenplayText}=await import('../packages/script/src/fountainAdapter');
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const scene=unit.scenes[0];
    scene.blocks=[{id:'untouched',type:'action',text:'误会\n这是动作说明，不能被误读成对白。'},{id:'line',type:'dialogue',speakerName:'林夏',text:'饭在锅里，回来记得吃。'},{id:'after',type:'note',text:'保留停顿'}];
    const saved=repo.saveProject(project,project.revision);const original=blocksToScreenplayText(scene.blocks,[]);const start=original.indexOf('回来记得吃');
    const input={operation:'text_rewrite' as const,unitId:unit.id,sceneId:scene.id,prompt:'只改选中部分',expectedRevision:saved.revision,selection:{start,end:start+5,text:'回来记得吃'}};
    assert.throws(()=>repo.createJob(saved.id,{...input,selection:{...input.selection,text:'错误选中'}}),/不一致/);
    const job=repo.createJob(saved.id,input);repo.submitJob(saved.id,job.id,JSON.stringify({summary:'少解释',replacement:'趁热吃'}),source);
    const next=repo.transition(saved.id,job.id,'approve').project!;
    assert.deepEqual(next.units[0].scenes[0].blocks[0],scene.blocks[0]);assert.deepEqual(next.units[0].scenes[0].blocks[2],scene.blocks[2]);
    assert.equal(next.units[0].scenes[0].blocks[1].speakerName,'林夏');assert.equal(next.units[0].scenes[0].blocks[1].text,'饭在锅里，趁热吃。');
  }finally{db.close();}
});

test('验收：创建与原始资料一次保存，拒绝非法资料时不留下空项目',async()=>{
  const {createScriptProjectFromMaterial}=await import('../packages/script/src/creation');
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const profile=createScriptCreationProfile('anthology',3,20);
    assert.throws(()=>repo.saveProject(createScriptProjectFromMaterial('非法资料',profile,{concept:42 as unknown as string,theme:'',outline:''}),0));
    assert.equal(repo.listProjects().length,0);
    const saved=repo.saveProject(createScriptProjectFromMaterial('三条街',profile,{concept:'三条街各有一个独立故事。',theme:'',outline:'',sceneText:'修鞋匠\n明天再来。',facts:['街口每天七点熄灯。']}),0);
    assert.equal(saved.revision,1);assert.equal(saved.brief.concept,'三条街各有一个独立故事。');
    assert.equal(saved.units[0].scenes[0].blocks[0].speakerName,'修鞋匠');assert.equal(saved.facts[0].status,'draft');assert.equal(saved.facts[0].scopeId,saved.units[0].scopeId);
    assert.equal(saved.characters.length,0,'不能从故事描述中猜出人物名');
  }finally{db.close();}
});

test('验收：持久任务按范围分页，新增任务不造成旧页遗漏，讨论不被其他步骤挤出',()=>{
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const created=[];
    for(let index=0;index<105;index++)created.push(repo.createJob(project.id,{operation:'consult',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:`讨论 ${index}`,authorRequest:`第 ${index} 个问题`,expectedRevision:project.revision}));
    const first=repo.listJobs(project.id,{operation:'consult',limit:100});assert.equal(first.length,100);
    repo.createJob(project.id,{operation:'scene',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'新的正文任务',expectedRevision:project.revision});
    const older=repo.listJobs(project.id,{operation:'consult',before:first.at(-1)!.id,limit:100});assert.equal(older.length,5);
    assert.equal(new Set([...first,...older].map(job=>job.id)).size,105);assert.equal(older.at(-1)!.id,created[0].id);
    assert.equal(repo.listJobs(project.id,{operation:'consult',sceneId:'other-scene'}).length,0);
    assert.throws(()=>repo.listJobs(project.id,{limit:101}),/1–100/);
  }finally{db.close();}
});

test('验收：作者显式关联续篇时迁移本集专属资料但不合并同名人物，拆出时保护已有引用',async()=>{
  const {changeUnitStoryScope,unitCharacters}=await import('../packages/script/src/continuity');
  const {newUnit}=await import('../packages/script/src/project');
  const project=createScriptProject('独立和续篇',createScriptCreationProfile('anthology',3,3));
  project.units.push(newUnit('第二集',180000),newUnit('第三集',180000));
  project.characters=[{id:'first',name:'林敏',scopeId:project.units[0].scopeId,desire:'',need:'',contradiction:'',arc:'教师',voice:''},{id:'third',name:'林敏',scopeId:project.units[2].scopeId,desire:'',need:'',contradiction:'',arc:'另一位访客',voice:''}];
  project.units[2].scenes[0].characterIds=['third'];
  const joined=changeUnitStoryScope(project,project.units[2].id,project.units[0].scopeId);
  assert.equal(joined.characters.length,2);assert.equal(joined.characters[1].scopeId,joined.units[0].scopeId);assert.equal(unitCharacters(joined,joined.units[2]).length,2);assert.equal(unitCharacters(joined,joined.units[1]).length,0);
  assert.notEqual(project.units[2].scopeId,joined.units[2].scopeId);assert.deepEqual(project.units[2].scenes,joined.units[2].scenes);
  assert.throws(()=>changeUnitStoryScope(joined,joined.units[2].id,'independent'),/仍引用/);
  joined.units[2].scenes[0].characterIds=[];
  const separated=changeUnitStoryScope(joined,joined.units[2].id,'independent');assert.notEqual(separated.units[2].scopeId,joined.units[0].scopeId);assert.equal(unitCharacters(separated,separated.units[2]).length,0);assert.equal(unitCharacters(separated,separated.units[0]).length,2);
});
