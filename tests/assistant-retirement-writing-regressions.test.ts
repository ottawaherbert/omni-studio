import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptProject,newUnit,newScene} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {SCRIPT_OPERATIONS,type ScriptProject,type ScriptOperation} from '../packages/script/src/schema';
import {anchorFor,getOutlineGuide,outlineGuideId,outlineText,type OutlineOwner} from '../packages/script/src/outlineGuides';
import {buildScriptTaskContext} from '../packages/script/src/methods';
import {SCRIPT_TASK_CONTRACTS,OUTLINE_RANGE_CONTRACT} from '../packages/script/src/taskContracts';
import {outlineBeatChangeRequest} from '../apps/web/src/features/script/components/OutlineBeats';
import {scriptTaskAnchor} from '../apps/web/src/features/script/scriptTaskIntent';
import {resolveTaskUnit} from '../apps/web/src/features/script/scriptTaskShortcuts';

// Set before importing any API storage code. This suite never opens the author workspace.
process.env.OMNI_DB_PATH=':memory:';
const {createScriptRepository}=await import('../apps/api/src/repositories/scriptStore');
const provenance={source:'manual_external' as const,provider:'regression-fixture',modelId:'no-model'};

function fixture() {
 const p=createScriptProject('退出助手后的独立写作测试',createScriptCreationProfile('tv-series',4,5,[],'mixed'));
 const u=p.units[0];u.scopeId='story_a';u.seasonId='season_a';u.summary='本集开头。目标关键变化。本集结尾。';
 u.scenes[0].blocks[0].text='本集第一场原文';u.scenes[0].purpose='已写场景';
 const second=newUnit('第二集',300000,'story_a');second.seasonId='season_a';second.scenes[0].blocks[0].text='第二集原文';
 const projectUnit=newUnit('全剧所属单元',300000,p.id);projectUnit.scenes[0].blocks[0].text='全剧所属单元原文';
 p.units.push(second,projectUnit,newUnit('另一故事',300000,'story_b'));
 p.seasons=[{id:'season_a',title:'第一季',arc:'季开头。目标关键变化。季结尾。'},{id:'season_b',title:'第二季',arc:'另一季原文'}];
 p.storyOutlines=[{scopeId:'story_a',outline:'故事开头。目标关键变化。故事结尾。'},{scopeId:'story_b',outline:'另一故事原文'}];
 p.brief.outline='全剧开头。目标关键变化。全剧结尾。';
 return p;
}
const operationFor=(kind:OutlineOwner['kind']):ScriptOperation=>({project:'outline',story:'story_outline',season:'season_outline',unit:'unit_outline'} as const)[kind];
function selectedFixture(kind:OutlineOwner['kind']) {
 const p=fixture(),u=p.units[kind==='project'?2:0];
 const owner:OutlineOwner={kind,id:kind==='project'?p.id:kind==='unit'?u.id:kind==='season'?'season_a':'story_a'};
 const text=outlineText(p,owner),start=text.indexOf('目标关键变化。'),end=start+'目标关键变化。'.length;
 const beat={id:`beat_${kind}`,title:'目标',change:'原变化',anchors:[anchorFor(text,start,end)],unitIds:[u.id],sceneRefs:[{unitId:u.id,sceneId:u.scenes[0].id}]};
 const outside={id:`outside_${kind}`,title:'开头',change:'原开头',anchors:[anchorFor(text,0,start)],unitIds:[u.id],sceneRefs:[]};
 p.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[outside,beat]}];
 return {p,u,owner,beat,guide:p.outlineGuides[0],text,start,end};
}
function repoFixture(p:ScriptProject) {const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();return {db,repo,p:repo.saveProject(p,0)};}

for(const kind of ['project','story','season','unit'] as const) {
 test(`${kind}: beat button → real repository return/adopt preserves owner, outside text, IDs and scene links`,()=>{
  const f=selectedFixture(kind),{db,repo,p}=repoFixture(f.p);
  try {
   const request=outlineBeatChangeRequest(p,f.guide,f.beat,f.u.id,f.owner)!;
   assert.ok(request);assert.equal(request.operation,operationFor(kind));assert.deepEqual(request.outlineBeatIds,[f.beat.id]);
   const job=repo.createJob(p.id,{operation:request.operation!,unitId:request.unitId,sceneId:scriptTaskAnchor(f.u,request.operation!),expectedRevision:p.revision,prompt:request.text,methodIds:[],outlineRange:request.outlineRange,outlineBeatIds:request.outlineBeatIds,...(kind==='story'?{scopeId:request.scopeId}:{}),...(kind==='season'?{seasonId:request.seasonId}:{})});
   assert.deepEqual(job.outlineGrant?.owner,f.owner);
   const payload={summary:'仅改所选',content:'目标已经改变且保留因果。',nodes:null,beats:[{id:f.beat.id,localKey:'target',title:'改后标题',change:'新变化',quotes:['目标已经改变且保留因果。'],unitIds:[f.u.id]}]};
   assert.equal(repo.submitJob(p.id,job.id,JSON.stringify(payload),provenance).status,'ready');
   const after=repo.transition(p.id,job.id,'approve').project!;
   assert.equal(outlineText(after,f.owner),f.text.slice(0,f.start)+payload.content+f.text.slice(f.end));
   const beat=getOutlineGuide(after,f.owner)!.beats.find(b=>b.id===f.beat.id)!;
   assert.equal(beat.id,f.beat.id);assert.deepEqual(beat.unitIds,f.beat.unitIds);assert.deepEqual(beat.sceneRefs,f.beat.sceneRefs);
   assert.equal(getOutlineGuide(after,f.owner)!.beats[0].change,'原开头');
   const expected=structuredClone(p); // Verify all unrelated prose and every scene retain identity/content.
   for(const other of [{kind:'project',id:p.id},{kind:'story',id:'story_a'},{kind:'season',id:'season_a'},{kind:'unit',id:p.units[0].id}] as OutlineOwner[])if(other.kind!==kind)assert.equal(outlineText(after,other),outlineText(p,other));
   assert.deepEqual(after.units.map(u=>u.scenes),expected.units.map(u=>u.scenes));
   assert.equal(repo.getJobInput(p.id,job.id).revision,p.revision);
  } finally {db.close();}
 });
 test(`${kind}: full outline contract parses and adopts only the declared owner`,()=>{
  const f=selectedFixture(kind),{db,repo,p}=repoFixture(f.p);
  try {
   const op=operationFor(kind);assert.match(SCRIPT_TASK_CONTRACTS[op],/summary/);assert.match(SCRIPT_TASK_CONTRACTS[op],/outline/);
   const job=repo.createJob(p.id,{operation:op,unitId:f.u.id,sceneId:f.u.id,expectedRevision:p.revision,prompt:SCRIPT_TASK_CONTRACTS[op],...(kind==='story'?{scopeId:f.owner.id}:{}),...(kind==='season'?{seasonId:f.owner.id}:{})});
   assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'完整大纲',outline:'新完整大纲'}),provenance).status,'ready');
   const after=repo.transition(p.id,job.id,'approve').project!;
   assert.equal(outlineText(after,f.owner),'新完整大纲');assert.deepEqual(after.units.map(u=>u.scenes),p.units.map(u=>u.scenes));
   if(kind!=='project')assert.equal(after.brief.outline,p.brief.outline);
  } finally {db.close();}
 });
}

test('all current operations have an explicit output contract; selected owner source reaches task context',()=>{
 for(const op of SCRIPT_OPERATIONS)assert.ok(typeof SCRIPT_TASK_CONTRACTS[op]==='string'&&!SCRIPT_TASK_CONTRACTS[op].includes('undefined'),op);
 assert.match(OUTLINE_RANGE_CONTRACT,/content/);assert.match(OUTLINE_RANGE_CONTRACT,/unitIds/);
 for(const kind of ['project','story','season','unit'] as const) {
  const f=selectedFixture(kind),request=outlineBeatChangeRequest(f.p,f.guide,f.beat,f.u.id,f.owner)!;
  const {context}=buildScriptTaskContext(f.p,f.u,request.operation!,[],undefined,undefined,{scopeId:request.scopeId,seasonId:request.seasonId,outlineRange:request.outlineRange,outlineBeatIds:request.outlineBeatIds});
  assert.deepEqual(context.outlineTarget?.owner,f.owner);assert.equal(context.outlineTarget?.text,f.text);assert.deepEqual(context.outlineTarget?.selectedRange,request.outlineRange);assert.deepEqual(context.outlineTarget?.beats.map(b=>b.id),[f.beat.id]);
 }
});

test('selected beat rejects ID replacement, reassignment, node writes, stale text and obsolete revision without changing author稿',()=>{
 const f=selectedFixture('story'),{db,repo,p}=repoFixture(f.p);
 try {
  const input={operation:'story_outline' as const,unitId:f.u.id,sceneId:f.u.id,scopeId:'story_a',expectedRevision:p.revision,prompt:'局部候选',outlineRange:{start:f.start,end:f.end,text:f.text.slice(f.start,f.end)},outlineBeatIds:[f.beat.id]};
  const base={summary:'测试拒绝',content:'合法变化。',nodes:null,beats:[{id:f.beat.id,localKey:'target',title:'标题',change:'变化',quotes:['合法变化。'],unitIds:[f.u.id]}]};
  for(const payload of [{...base,beats:[{...base.beats[0],id:'new_identity'}]},{...base,beats:[{...base.beats[0],unitIds:[p.units[1].id]}]},{...base,nodes:[]},{...base,beats:null}]) {
   const job=repo.createJob(p.id,input);assert.equal(repo.submitJob(p.id,job.id,JSON.stringify(payload),provenance).status,'failed');assert.deepEqual(repo.getProject(p.id),p);
  }
  assert.throws(()=>repo.createJob(p.id,{...input,outlineRange:{...input.outlineRange,text:'过时原文'}}),/区间不一致/);
  const job=repo.createJob(p.id,input);assert.equal(repo.submitJob(p.id,job.id,JSON.stringify(base),provenance).status,'ready');
  const edit=structuredClone(p);edit.title='作者新稿';const saved=repo.saveProject(edit,p.revision);
  assert.throws(()=>repo.transition(p.id,job.id,'approve'),/基线已改变/);assert.deepEqual(repo.getProject(p.id),saved);assert.equal(repo.getJob(p.id,job.id).rawResult,JSON.stringify(base));
 } finally {db.close();}
});

test('mismatched story/season owner cannot use a unit from another scope',()=>{
 const {db,repo,p}=repoFixture(fixture());try {
  for(const input of [{operation:'story_outline' as const,scopeId:'story_a'},{operation:'season_outline' as const,seasonId:'season_a'}])assert.throws(()=>repo.createJob(p.id,{...input,unitId:p.units[3].id,sceneId:p.units[3].id,expectedRevision:p.revision,prompt:'不得跨范围'}),/任务单元不属于/);
 }finally{db.close();}
});

test('non-active and empty units can plan via their own unit anchors and preserve active unit content',()=>{
 for(const empty of [false,true]) {
  const f=fixture();if(empty)f.units[1].scenes=[];
  const {db,repo,p}=repoFixture(f);try {
   const target=resolveTaskUnit(p,p.units[1].id)!;assert.equal(target.id,p.units[1].id);
   const job=repo.createJob(p.id,{operation:'plan',unitId:target.id,sceneId:scriptTaskAnchor(target,'plan'),expectedRevision:p.revision,prompt:'只补第二集'});
   const ctx=buildScriptTaskContext(p,target,'plan',[]).context;assert.equal((ctx.unit as {id:string}).id,target.id);
   assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'只新增第二集',scenePlans:[{title:'新增场',purpose:'新事件',location:'码头',timeOfDay:'夜'}]}),provenance).status,'ready');
   const after=repo.transition(p.id,job.id,'approve').project!;assert.deepEqual(after.units[0],p.units[0]);
   assert.equal(after.units[1].scenes.at(-1)?.title,'新增场');if(!empty)assert.deepEqual(after.units[1].scenes[0],p.units[1].scenes[0]);
  } finally {db.close();}
 }
});

test('review includes only selected body evidence and rejects findings from omitted or foreign scenes',()=>{
 const f=fixture(),u=f.units[0];u.scenes.push(newScene('未选择'),newScene('已选择'));
 u.scenes[1].blocks[0].text='不得读取的正文';u.scenes[2].blocks[0].text='读取正文乙';
 const {db,repo,p}=repoFixture(f);try {
  const ids=[u.scenes[0].id,u.scenes[2].id],context=buildScriptTaskContext(p,p.units[0],'review',[],ids[0],ids).context;
  const serialized=JSON.stringify(context);assert.ok(serialized.includes('读取正文乙'));assert.ok(!serialized.includes('不得读取的正文'));
  assert.deepEqual((context.bodyCoverage as {sceneIds:string[]}).sceneIds,ids);
  const job=repo.createJob(p.id,{operation:'review',unitId:u.id,sceneId:ids[0],reviewSceneIds:ids,expectedRevision:p.revision,prompt:'审阅两场'});
  for(const sceneId of [u.scenes[1].id,p.units[1].scenes[0].id])assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'越范围',findings:[{sceneId,issue:'问题',suggestion:'建议'}]}),provenance).status,'failed');
  assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'选定场景',findings:ids.map(sceneId=>({sceneId,issue:'检查',suggestion:'保留'}))}),provenance).status,'ready');
  assert.deepEqual(repo.getProject(p.id),p);assert.throws(()=>repo.transition(p.id,job.id,'approve'),/没有可采用/);
 }finally{db.close();}
});

test('retired jobs identified by context binding stay read-only across every writing mutation',()=>{
 const {db,repo,p}=repoFixture(fixture());try {
  const job=repo.createJob(p.id,{operation:'review',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,expectedRevision:p.revision,prompt:'历史检查'});
  repo.submitJob(p.id,job.id,JSON.stringify({summary:'保留',findings:[{sceneId:p.units[0].scenes[0].id,issue:'旧问题',suggestion:'旧建议'}]}),provenance);
  db.exec('CREATE TABLE agent_context_artifacts(domain TEXT,artifact_id TEXT)');db.prepare('INSERT INTO agent_context_artifacts VALUES(?,?)').run('script-job',job.id);
  assert.equal(repo.getJob(p.id,job.id).readOnly,true);
  for(const action of ['approve','reject','cancel'] as const)assert.throws(()=>repo.transition(p.id,job.id,action),/历史助手任务/);
  assert.throws(()=>repo.submitJob(p.id,job.id,'{}',provenance),/历史助手任务/);assert.throws(()=>repo.failJob(p.id,job.id,'x'),/历史助手任务/);assert.throws(()=>repo.recordReviewDecision(p.id,job.id,0,'to_fix'),/历史助手任务/);
  assert.deepEqual(repo.getProject(p.id),p);
 }finally{db.close();}
});

test('real HTTP routes and browser client preserve local outline details, plan targets and selected review IDs',async()=>{
 const {default:express}=await import('express');
 const {registerScriptRoutes}=await import('../apps/api/src/routes/scriptRoutes');
 const {scriptClient}=await import('../apps/web/src/clients/scriptClient');
 const {db,repo,p}=repoFixture(selectedFixture('season').p),app=express();app.use(express.json());registerScriptRoutes(app,repo,async()=>[]);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`,originalFetch=globalThis.fetch;
 globalThis.fetch=(input,init)=>originalFetch(typeof input==='string'&&input.startsWith('/')?base+input:input,init);
 try {
  const u=p.units[0],owner:OutlineOwner={kind:'season',id:'season_a'},guide=getOutlineGuide(p,owner)!,beat=guide.beats[1];
  const request=outlineBeatChangeRequest(p,guide,beat,u.id,owner)!;
  const {job}=await scriptClient.createJob(p,u.id,scriptTaskAnchor(u,request.operation!),request.operation!,request.text,undefined,[],undefined,undefined,undefined,{outlineRange:request.outlineRange,outlineBeatIds:request.outlineBeatIds,seasonId:request.seasonId});
  assert.deepEqual(job.outlineGrant?.owner,owner);assert.deepEqual(job.outlineGrant?.outlineBeatIds,[beat.id]);
  const result=await scriptClient.submitJob(job,JSON.stringify({summary:'HTTP 局部改稿',content:'目标变化已更新。',nodes:null,beats:[{id:beat.id,localKey:'kept',title:beat.title,change:'变化',quotes:['目标变化已更新。'],unitIds:beat.unitIds}]}),provenance);
  assert.equal(result.job.status,'ready');const saved=(await scriptClient.transitionJob(result.job,'approve')).project!;
  assert.equal(saved.seasons![0].arc,'季开头。目标变化已更新。季结尾。');assert.equal(saved.brief.outline,p.brief.outline);
  const target=saved.units[1],plan=(await scriptClient.createJob(saved,target.id,scriptTaskAnchor(target,'plan'),'plan','只补第二集')).job;
  assert.equal(plan.unitId,target.id);assert.equal(plan.sceneId,target.id);
  const review=(await scriptClient.createJob(saved,target.id,target.scenes[0].id,'review','只审阅第二集',undefined,[],[target.scenes[0].id])).job;
  assert.deepEqual(review.reviewSceneIds,[target.scenes[0].id]);
  const revived=await originalFetch(base+`/api/scripts/${saved.id}/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'concept',unitId:u.id,sceneId:u.id,prompt:'旧助手复活',expectedRevision:saved.revision,agentRunId:'revived'})});assert.equal(revived.status,410);
  const stale=await originalFetch(base+`/api/scripts/${saved.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p,expectedRevision:p.revision})});assert.equal(stale.status,409);
  assert.deepEqual(repo.getProject(saved.id),saved);
 } finally {globalThis.fetch=originalFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});

test('range-only edits cannot create or replace beats without an explicit beat scope',()=>{
 const f=selectedFixture('project'),{db,repo,p}=repoFixture(f.p);
 try {
  const job=repo.createJob(p.id,{operation:'outline',unitId:f.u.id,sceneId:f.u.id,expectedRevision:p.revision,prompt:'只改选中原文',outlineRange:{start:f.start,end:f.end,text:f.text.slice(f.start,f.end)}});
  const base={summary:'只改文字',content:'目标已有新变化。',nodes:null};
  const unauthorized={...base,beats:[{id:null,localKey:'new',title:'越权新节拍',change:'变化',quotes:['目标已有新变化。'],unitIds:[f.u.id]}]};
  assert.equal(repo.submitJob(p.id,job.id,JSON.stringify(unauthorized),provenance).status,'failed');
  assert.deepEqual(repo.getProject(p.id),p);
  assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({...base,beats:null}),provenance).status,'ready');
  const after=repo.transition(p.id,job.id,'approve').project!;
  assert.equal(after.brief.outline,f.text.slice(0,f.start)+base.content+f.text.slice(f.end));
  assert.deepEqual(getOutlineGuide(after,f.owner)!.beats.map(b=>[b.id,b.change,b.unitIds,b.sceneRefs]),getOutlineGuide(p,f.owner)!.beats.map(b=>[b.id,b.change,b.unitIds,b.sceneRefs]));
 }finally{db.close();}
});
