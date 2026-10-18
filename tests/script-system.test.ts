import { useSettingsStore } from '../src/store/useSettingsStore';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseScriptProject, parseTimelineItem, parseTimingEvidence, type ProjectProfile, type TimelineItem } from '../packages/script/src/schema';
import { createScriptCreationProfile, createScriptProjectFromMaterial } from '../packages/script/src/creation';
import { createScriptProject, unitContentHash, createMockProposal, applyProposal, estimateDialogue, newId, registerDialogueSpeaker, setProjectContinuity, removeScriptScene, removeScriptUnit } from '../packages/script/src/project';
import { analyseTimeline, unionIntervals } from '../packages/script/src/runtime';
import { createScriptDelivery, exportText, scriptExportFilename } from '../packages/script/src/exporters';
import { createScriptRepository, ScriptConflictError } from '../apps/api/src/repositories/scriptStore';
import { agentReviewSceneIds, aggregateAgentReviewFindings } from '../packages/script/src/agent';
import { mergeAgentDraft } from '../packages/script/src/agentMerge';
import { registerScriptRoutes } from '../apps/api/src/routes/scriptRoutes';
import { createInteractiveWritingPort } from '../src/server/interactiveWritingPort';
import { newScene, newUnit } from '../packages/script/src/project';
import { sceneStateHash, sceneContinuity, threadDiagnostics, writingContext, storylineDiagnostics, unitCharacters } from '../packages/script/src/continuity';
import { createProductionProjectFromScriptExport } from '../packages/production/src/services/production/scriptImport';
import { buildScriptTaskContext, selectTaskMethods, availableMethods, methodFromSkill } from '../packages/script/src/methods';
import { applyScenePlans, applyWholeBoardPlan, applyUnitOutlines, parseProposedSceneUnits, parseScriptChoices } from '../packages/script/src/planning';
import { screenplayTextToBlocks, blocksToScreenplayText } from '../packages/script/src/fountainAdapter';
import { answerManualAI, getManualAIPending, resolveManualAIRequest, withManualAIResult } from '../apps/web/src/clients/manualAIClient';
import { boardAdviceBody } from '../apps/web/src/features/script/components/boardAdviceContext';
import {parseIdeationReply,parseIdeationDraft,buildIdeationPrompt,type ChatMessage} from '../packages/script/src/ideation';
import {scriptAssistTemplates} from '../src/config/prompts/scriptAssist';
import { ScriptLibrary } from '../apps/web/src/features/script/ScriptLibrary';
const profile:ProjectProfile={organization:'standalone',continuity:'serialized',workType:'短剧',genres:['悬疑'],language:'zh-CN',plannedUnits:1,targetDurationMs:300000,toleranceMs:15000,includeCredits:true,aspectRatio:'16:9',productionMode:'live-action'};
const project=()=>createScriptProject('钥匙',structuredClone(profile));
const authorHistoryCount=(db:InstanceType<typeof Database>)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='script_revisions'").get()?(db.prepare('SELECT count(*) AS n FROM script_revisions').get() as {n:number}).n:0;
test('创建入口的形态只提供起点，集数、单集时长与集间关系由作者决定',()=>{
  const selected=createScriptCreationProfile('micro-drama',36,3.5,['家庭'], 'mixed');
  assert.equal(selected.workType,'微短剧');
  assert.equal(selected.plannedUnits,36);
  assert.equal(selected.targetDurationMs,210_000);
  assert.equal(selected.continuity,'mixed');
  const film=createScriptCreationProfile('feature-film',8,112);
  assert.equal(film.organization,'standalone');
  assert.equal(film.plannedUnits,1);
  assert.equal(film.targetDurationMs,6_720_000);
  const custom=createScriptCreationProfile('custom',4,24,['喜剧'],'procedural',{workType:'广播剧',organization:'episodic'});
  assert.equal(custom.workType,'广播剧');
  assert.equal(custom.plannedUnits,4);
  assert.equal(custom.continuity,'procedural');
  assert.throws(()=>createScriptCreationProfile('custom',1,30,['剧情'],'serialized',{workType:'',organization:'standalone'}),/自定义作品类型/);
  assert.throws(()=>createScriptCreationProfile('tv-series',0,45),/计划集数/);
  assert.throws(()=>createScriptCreationProfile('tv-series',8,0),/目标时长/);
});
test('起点恢复原页聊天、模式下拉框与 Skill，不出现创建配置表单',()=>{
  const html=renderToStaticMarkup(React.createElement(ScriptLibrary,{projects:[],error:'',onOpen:()=>{},onCreate:async()=>{}}));
  assert.match(html,/给 AI 的消息/);
  assert.match(html,/普通模式/);
  assert.match(html,/选择 Skill/);
  assert.doesNotMatch(html,/发送方式|作品名称|作品形态|目标时长（分钟）|带入作品的材料|直接开始写作|上方文字是/);
});
test('构思对话：超过五轮仍保留选择与原文，完整 Skill 和实际版本进入请求',()=>{
  const messages:ChatMessage[]=Array.from({length:6},(_,i)=>({role:'user',text:`第 ${i+1} 次想法\n  原文不改。`}));
  messages.splice(1,0,{role:'ai',text:'你喜欢哪个？',options:[{tag:'留白',text:'两人坐下，不再解释。'}]});
  const method={id:'skill:test',title:'方法验收',version:'7',content:'甲'.repeat(220)+'尾部也应保留'};
  const prompt=buildIdeationPrompt('chat',messages,[method],scriptAssistTemplates.scriptIdeation.template);
  assert.ok(prompt.includes('尾部也应保留'));assert.ok(prompt.includes('版本：7'));assert.ok(prompt.includes('两人坐下，不再解释。'));
  assert.match(prompt,/第 6 次想法/);assert.match(prompt,/不按固定轮数结束/);assert.doesNotMatch(prompt,/黄金四问|经典爆款|主角软肋/);
  assert.ok(buildIdeationPrompt('chat',messages,[],scriptAssistTemplates.scriptIdeation.template).includes('本次未选择 Skill'));
  assert.throws(()=>buildIdeationPrompt('chat',messages,[],'缺少消息变量'),/占位符/);
});
test('构思结果：普通文字仍可读，选项可直接采用；无内容的蓝图不会创建空作品',()=>{
  assert.deepEqual(parseIdeationReply('这句可以更短。'),{text:'这句可以更短。',options:[]});
  assert.deepEqual(parseIdeationReply('```json\n{"question":"选哪个？","options":[{"tag":"日常","text":"留一盏灯。"},null]}\n```'),{text:'选哪个？',options:[{tag:'日常',text:'留一盏灯。'}]});
  assert.throws(()=>parseIdeationReply(' '),/为空/);
  assert.throws(()=>parseIdeationDraft('{"title":"空作品"}',[]),/缺少故事/);
  assert.throws(()=>parseIdeationDraft('{',[]),/格式/);
});
test('聊天确认后原子创建作品：保存选择的蓝图和完整 Skill，不插入虚构正文',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const method={id:'skill:test',title:'日常对话',version:'3',content:'保持平淡，结尾可以留白。'};
    const draft=parseIdeationDraft(JSON.stringify({title:'灯',concept:'父女一起补胎',outline:'女儿留下帮忙',format:'short-film',targetMinutes:7,characters:[{name:'女儿'}]}),[method]);
    const p=createScriptProjectFromMaterial(draft.title,draft.profile,draft.initialBrief);
    const saved=repo.saveProject(p,0);const loaded=repo.getProject(saved.id)!;
    assert.equal(loaded.brief.outline,'女儿留下帮忙');assert.deepEqual(loaded.methods,[method]);assert.equal(loaded.profile.targetDurationMs,420000);
    assert.ok(loaded.units[0].scenes[0].blocks.every(b=>!b.text));assert.equal(loaded.originalMaterial,undefined);
  }finally{db.close();}
});
test('Agent 执行方式：API 会话不弹手动请求，逐步回填必须收到本步结果',async t=>{
  useSettingsStore.setState({isTestMode:true});t.after(()=>useSettingsStore.setState({isTestMode:false}));
  const viaApi=await withManualAIResult('',undefined,()=>resolveManualAIRequest({kind:'text',prompt:'只规划分场'}));
  assert.equal(viaApi,undefined);
  const manual=withManualAIResult('',undefined,()=>resolveManualAIRequest({kind:'text',prompt:'只写第一场',requireJson:true}),false,true);
  await Promise.resolve();
  const pending=getManualAIPending();
  assert.equal(pending?.prompt,'只写第一场');
  assert.equal(pending?.manualOnly,true);
  answerManualAI(pending!.id,{kind:'text',text:'{"summary":"已写第一场"}'});
  assert.equal(await manual,'{"summary":"已写第一场"}');
});
test('手动 Agent 连续两步各有独立提示词与自写返回',async t=>{
  useSettingsStore.setState({isTestMode:true});t.after(()=>useSettingsStore.setState({isTestMode:false}));
  const workflow=withManualAIResult('',undefined,async()=>{
    const plan=await resolveManualAIRequest({kind:'text',prompt:'第一步：补分场',requireJson:true});
    const scene=await resolveManualAIRequest({kind:'text',prompt:'第二步：写正文',requireJson:true});
    return [plan,scene];
  },false,true);
  await Promise.resolve();
  const first=getManualAIPending();assert.equal(first?.prompt,'第一步：补分场');assert.equal(first.manualOnly,true);
  answerManualAI(first.id,{kind:'text',text:'{"summary":"补一场"}'});
  for(let attempt=0;attempt<10&&!getManualAIPending();attempt++)await new Promise(resolve=>setImmediate(resolve));
  const second=getManualAIPending();assert.equal(second?.prompt,'第二步：写正文');assert.notEqual(second.id,first.id);
  answerManualAI(second.id,{kind:'text',text:'{"summary":"写动作"}'});
  assert.deepEqual(await workflow,['{"summary":"补一场"}','{"summary":"写动作"}']);
  assert.equal(getManualAIPending(),undefined);
});
test('分集大纲与结尾安排独立；规划集数与已有正文不会被生成建议覆盖',()=>{
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=3;
  const first=p.units[0];first.summary='作者写好的第一集大纲';first.endingHook='平静地关上门';
  first.scenes[0].blocks[0].text='林遥把钥匙收了起来。';
  const originalSceneId=first.scenes[0].id;
  assert.equal(applyUnitOutlines(p,[{unitIndex:1,summary:'模型改写的大纲'},{unitIndex:2,summary:'第二集初稿'},{unitIndex:3,summary:'第三集初稿'}]),2);
  assert.equal(p.units.length,3);
  assert.equal(first.summary,'作者写好的第一集大纲');
  const result=applyWholeBoardPlan(p,[
    {unitIndex:1,cliffhanger:'坏消息',scenes:[{title:'模型替换场'}]},
    {unitIndex:2,cliffhanger:'电话响起',scenes:[{title:'第二集第一场',purpose:'调查来电'}]},
  ]);
  assert.deepEqual(result,{applied:1,preserved:1});
  assert.equal(first.scenes[0].id,originalSceneId);
  assert.equal(first.scenes[0].blocks[0].text,'林遥把钥匙收了起来。');
  assert.equal(first.summary,'作者写好的第一集大纲');
  assert.equal(first.endingHook,'平静地关上门');
  assert.equal(p.units[1].summary,'第二集初稿');
  assert.equal(p.units[1].endingHook,'电话响起');
  assert.equal(p.units[1].scenes[0].purpose,'调查来电');
  assert.equal(parseScriptProject(p).units.length,3);
});
test('十二集项目按规划建立十二个可保存的单元，独立故事默认隔离',()=>{
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=12;
  setProjectContinuity(p,'anthology');
  const written=Array.from({length:12},(_,index)=>({unitIndex:index+1,title:`第 ${index+1} 集`,summary:`第 ${index+1} 个独立故事从一次意外拜访开始。`}));
  assert.equal(applyUnitOutlines(p,written),12);
  assert.equal(p.units.length,12);
  assert.equal(new Set(p.units.map(unit=>unit.scopeId)).size,12);
  assert.ok(p.units.every(unit=>unit.scopeId===unit.id));
  assert.equal(parseScriptProject(p).units[11].summary,written[11].summary);
});
test('手工规划过的空正文场也不能被全盘拆场清除',()=>{
  const p=project();p.units[0].scenes[0].purpose='母亲找到旧照片';
  const sceneId=p.units[0].scenes[0].id;
  const result=applyWholeBoardPlan(p,[{summary:'模型的单元大纲',cliffhanger:'模型的结尾',scenes:[{title:'另一个场景',purpose:'新事件'}]}]);
  assert.deepEqual(result,{applied:0,preserved:1});
  assert.equal(p.units[0].scenes[0].id,sceneId);
  assert.equal(p.units[0].scenes[0].purpose,'母亲找到旧照片');
  assert.equal(p.units[0].summary,'');
  assert.equal(p.units[0].endingHook,'');
});
test('只有单元大纲时可以补分场，但不能改写作者大纲',()=>{
  const p=project();p.units[0].summary='作者已写的单元大纲。';
  const result=applyWholeBoardPlan(p,[{unitIndex:1,summary:'模型的新摘要',scenes:[{title:'模型想替换的场景',purpose:'新的场景事件'}]}]);
  assert.deepEqual(result,{applied:1,preserved:0});
  assert.equal(p.units[0].summary,'作者已写的单元大纲。');
  assert.equal(p.units[0].scenes[0].purpose,'新的场景事件');
});
test('整剧分场返回必须有明确场景事件，拒绝重复单元和超量方案',()=>{
  const good=parseProposedSceneUnits([{unitIndex:1,title:'全片',scenes:[{title:'医院走廊',purpose:'女儿拿到账单，发现父亲隐瞒病情。'}]}],1);
  assert.equal(good[0].scenes?.[0].purpose,'女儿拿到账单，发现父亲隐瞒病情。');
  assert.throws(()=>parseProposedSceneUnits([{unitIndex:1,scenes:[{title:'走廊',purpose:''}]}],1),/缺少“发生什么”/);
  assert.throws(()=>parseProposedSceneUnits([{unitIndex:1,scenes:[{purpose:'收到信'}]},{unitIndex:1,scenes:[{purpose:'读信'}]}],2),/序号无效.*重复/);
  assert.throws(()=>parseProposedSceneUnits([{unitIndex:1,scenes:Array.from({length:201},()=>({purpose:'占位'}))}],1),/1–200 场/);
});
test('结尾与场景建议只采用结构正确的文本字段，不写入模型返回的对象值',()=>{
  const choices=parseScriptChoices(JSON.stringify([{title:'平静离开',content:'两人各自关灯离开。',extra:{purpose:'结束这次会面',entryState:'仍在交谈',exitState:'暂时分开'}}]));
  assert.equal(choices[0].extra?.purpose,'结束这次会面');
  assert.throws(()=>parseScriptChoices(JSON.stringify([{title:'错误',content:'仍是文本',extra:{purpose:{malformed:true}}}])),/场景发生的事需要有效文本/);
  assert.throws(()=>parseScriptChoices(JSON.stringify([{title:'错误',content:'仍是文本',blocks:[{text:'越权正文'}]}])),/未授权字段/);
  assert.throws(()=>parseScriptChoices('不是 JSON'),/完整 JSON/);
});
test('场景建议明确读取本场正文，并声明长正文未覆盖的范围',()=>{
  const p=project(),scene=p.units[0].scenes[0];scene.blocks[0].text='摆渡员把十年前的船票压在灯下。';
  assert.match(boardAdviceBody(p,[scene]),/十年前的船票/);
  scene.blocks[0].text='早'.repeat(17000)+'船终于靠岸。';
  const excerpt=boardAdviceBody(p,[scene]);
  assert.match(excerpt,/未读取/);
  assert.match(excerpt,/船终于靠岸/);
  assert.equal(excerpt.includes('早'.repeat(2000)),true);
});
test('手写新人物和段落身份在转换、编辑与导出中保留',()=>{
  const p=project();const original='林夏\n你终于来了。';
  const first=screenplayTextToBlocks(original,[]);
  assert.equal(blocksToScreenplayText(first.blocks,[]),original);
  const edited=screenplayTextToBlocks('林夏\n你终于到了。',[],first.blocks);
  assert.equal(edited.blocks[0].id,first.blocks[0].id);
  p.units[0].scenes[0].blocks=edited.blocks;
  assert.equal(parseScriptProject(p).units[0].scenes[0].blocks[0].speakerName,'林夏');
  assert.match(exportText(p,'fountain'),/@林夏\n你终于到了。/);
  const oldId=p.units[0].scenes[0].blocks[0].id;
  const registered=registerDialogueSpeaker(p,p.units[0].id,p.units[0].scenes[0].id,'林夏');
  assert.equal(registered.name,'林夏');
  assert.equal(p.units[0].scenes[0].blocks[0].id,oldId);
  assert.equal(p.units[0].scenes[0].blocks[0].speakerId,registered.id);
  assert.equal(blocksToScreenplayText(p.units[0].scenes[0].blocks,p.characters),'林夏\n你终于到了。');
  assert.equal(parseScriptProject(p).characters.length,1);
});
test('无预设人物也可用自写 AI 返回生成对白，姓名保留待作者登记',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();let p=repo.saveProject(project(),0);
    const scene=p.units[0].scenes[0];
    const job=repo.createJob(p.id,{operation:'scene',unitId:p.units[0].id,sceneId:scene.id,prompt:'写一场渡口对话',expectedRevision:p.revision});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    const raw=JSON.stringify({summary:'让人物在行动中说话',blocks:[{type:'action',text:'林夏把钥匙放在桌上。'},{type:'dialogue',speakerName:'林夏',text:'你还要等到什么时候？'}]});
    assert.equal(repo.submitJob(p.id,job.id,raw,source).status,'ready');
    p=repo.transition(p.id,job.id,'approve').project!;
    assert.equal(p.characters.length,0);
    assert.equal(p.units[0].scenes[0].blocks[1].speakerName,'林夏');
    assert.match(exportText(p,'fountain'),/@林夏\n你还要等到什么时候/);
    assert.deepEqual(buildScriptTaskContext(p,p.units[0],'scene',[],scene.id).context.unregisteredSpeakerNames,['林夏']);
    const firstId=p.units[0].scenes[0].blocks[1].id;
    const registered=registerDialogueSpeaker(p,p.units[0].id,scene.id,'林夏');
    assert.equal(p.units[0].scenes[0].blocks[1].id,firstId);
    assert.equal(p.units[0].scenes[0].blocks[1].speakerId,registered.id);
    p=repo.saveProject(p,p.revision);assert.equal(p.characters.length,1);
    assert.equal(repo.submitJob(p.id,repo.createJob(p.id,{operation:'scene',unitId:p.units[0].id,sceneId:scene.id,prompt:'错误对白',expectedRevision:p.revision}).id,JSON.stringify({summary:'错误',blocks:[{type:'dialogue',speakerId:registered.id,speakerName:'林夏',text:'不能同时标注'}]}),source).status,'failed');
  }finally{db.close();}
});
test('改动跨集关系时保留人物和场景引用，独立故事可明确选择共享或局部资料',()=>{
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=2;
  p.units.push(newUnit('第二集',p.profile.targetDurationMs,p.id));
  p.characters.push({id:'char_shared',name:'值班员',scopeId:p.id,desire:'',need:'',contradiction:'',arc:'',voice:''});
  p.units[0].scenes[0].characterIds.push('char_shared');
  setProjectContinuity(p,'anthology');
  assert.notEqual(p.units[0].scopeId,p.units[1].scopeId);
  assert.equal(unitCharacters(p,p.units[1]).some(c=>c.id==='char_shared'),true);
  const local={id:'char_local',name:'访客',scopeId:p.units[1].scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''};
  p.characters.push(local);p.units[1].scenes[0].characterIds.push(local.id);
  assert.equal(unitCharacters(p,p.units[0]).some(c=>c.id===local.id),false);
  assert.equal(parseScriptProject(p).units.length,2);
  setProjectContinuity(p,'serialized');
  assert.equal(local.scopeId,p.id);
  assert.equal(unitCharacters(p,p.units[0]).some(c=>c.id===local.id),true);
  assert.equal(parseScriptProject(p).characters.length,2);
});
test('删除场景与独立单元后仍可保存：清理专属资料和时长引用，保留跨集证据待复核',()=>{
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=2;
  const second=newUnit('独立故事',300000);p.units.push(second);setProjectContinuity(p,'anthology');
  const extra=newScene('过渡');second.scenes.push(extra);
  second.timeline.push({id:'timing_scene',sceneId:extra.id,track:'画面',modality:'video',kind:'content',startMs:0,endMs:3000,included:true,label:'过渡画面',contentHash:'draft'});
  assert.equal(removeScriptScene(p,second.id,extra.id),1);
  assert.equal(second.timeline.length,0);
  const character={id:'private_char',name:'访客',scopeId:second.scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''};
  p.characters.push(character);second.scenes[0].characterIds.push(character.id);
  p.facts.push({id:'private_fact',scopeId:second.scopeId,text:'只属于这一集的旧站台',status:'draft'});
  p.storylines=[{id:'private_line',scopeId:second.scopeId,lane:'A',title:'寻人',premise:'',resolution:''}];
  second.scenes[0].storylineIds=['private_line'];
  p.continuityTracks=[
    {id:'private_track',scopeId:second.scopeId,kind:'knowledge',perspective:'character',label:'车票秘密',characterIds:[character.id],initialValue:'未知',changes:[]},
    {id:'global_track',scopeId:p.id,kind:'knowledge',perspective:'audience',label:'旧站台',characterIds:[],initialValue:'未知',changes:[{id:'old_evidence',sceneId:second.scenes[0].id,value:'出现',reason:'旧稿出现',sourceHash:'old'}]},
  ];
  p.units[0].scenes[0].characterIds.push(character.id);
  assert.throws(()=>removeScriptUnit(p,second.id),/其他单元仍引用/);
  p.units[0].scenes[0].characterIds=[];
  const counts=removeScriptUnit(p,second.id);
  assert.deepEqual(counts,{characters:1,facts:1,storylines:1,tracks:1});
  assert.equal(p.continuityTracks?.[0].changes[0].sceneId,second.scenes[0].id);
  assert.equal(p.units.length,1);
  assert.equal(p.characters.length,0);
  assert.equal(parseScriptProject(p).units.length,1);
  const serialized=project();serialized.profile.organization='episodic';serialized.profile.plannedUnits=2;
  const sharedUnit=newUnit('第二集',300000,serialized.id);serialized.units.push(sharedUnit);
  serialized.facts.push({id:'unit_id_scope',scopeId:sharedUnit.id,text:'旧版本遗留的单元作用域',status:'draft'});
  assert.equal(removeScriptUnit(serialized,sharedUnit.id).facts,1);
  assert.equal(parseScriptProject(serialized).facts.length,0);
});
test('剧本保存合同拒绝没有单元的作品，允许暂未拆场的规划单元',()=>{
  const emptyProject=project();emptyProject.units=[];
  assert.throws(()=>parseScriptProject(emptyProject),/至少需要一个交付单元/);
  const emptyUnit=project();emptyUnit.units[0].scenes=[];
  assert.equal(parseScriptProject(emptyUnit).units[0].scenes.length,0);
});
test('自写模型返回贯通 Skill、大纲、场景、审阅、局部改写与任务输入留存，不请求外部模型',()=>{
  const db=new Database(':memory:');
  try {
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=createScriptProject('末班灯',{...profile,workType:'电影短片',targetDurationMs:12*60000});
    draft.brief.concept='末班渡船停航前，值班员必须决定是否为一位陌生人重新开灯。';
    draft.facts=[{id:'fact_dock',text:'渡口十点停航',scopeId:draft.id,status:'draft'}];
    draft.characters=[{id:'lin_ye',name:'林野',scopeId:draft.id,desire:'准时下班',need:'正视自己没有帮助父亲的遗憾',contradiction:'熟悉救援流程却回避求助者',arc:'从躲避到主动留下',voice:'少说话，先看细节'}];
    draft.methods=[{id:'skill:quiet',title:'克制的动作描写',version:'1',content:'优先写可见动作；不要用旁白代替决定。'}];
    let saved=repo.saveProject(draft,0);
    const source={source:'manual_external' as const,provider:'codex_test_fixture',modelId:'self_written'};
    const task=(operation:'outline'|'scene'|'rewrite'|'review',blockIds?:string[])=>repo.createJob(saved.id,{operation,unitId:saved.units[0].id,sceneId:saved.units[0].scenes[0].id,prompt:`作者要求：${operation}。保留已确认设定。`,expectedRevision:saved.revision,methodIds:['skill:quiet'],blockIds});

    const outline=task('outline');
    assert.equal(outline.methods[0].content,'优先写可见动作；不要用旁白代替决定。');
    assert.equal(repo.submitJob(saved.id,outline.id,JSON.stringify({summary:'把抉择落在渡口开灯动作上',outline:'林野准备锁门。陌生人请求照亮水面寻找失踪者。他先拒绝，发现岸边留有父亲的旧救生哨，最终重新开灯并呼叫救援。'}),source).status,'ready');
    assert.equal(repo.getProject(saved.id)!.brief.outline,'');
    saved=repo.transition(saved.id,outline.id,'approve').project!;

    const scene=task('scene');
    const sceneReturn={summary:'以关灯和重新开灯呈现选择；陌生人的身份尚待作者确认',blocks:[
      {type:'action',text:'林野合上配电箱。码头只剩一盏灯，照着湿漉漉的空船。'},
      {type:'dialogue',speakerId:'lin_ye',text:'船走了。'},
      {type:'action',text:'岸边传来一声短促的哨响。他停住，手指还压在总闸上。'},
    ]};
    assert.equal(repo.submitJob(saved.id,scene.id,JSON.stringify(sceneReturn),source).status,'ready');
    assert.equal(repo.getProject(saved.id)!.units[0].scenes[0].blocks[0].text,'');
    saved=repo.transition(saved.id,scene.id,'approve').project!;
    const originalFirstBlock=saved.units[0].scenes[0].blocks[0];

    const review=task('review');
    const finding={sceneId:saved.units[0].scenes[0].id,issue:'“岸边传来一声短促的哨响”之后，林野认出哨声的依据未交代。',suggestion:'可让他看见旧哨的外形，也可保留悬念并在下一场解释。'};
    assert.equal(repo.submitJob(saved.id,review.id,JSON.stringify({summary:'动作清楚，哨声的识别依据需要作者决定',findings:[finding]}),source).status,'ready');
    assert.throws(()=>repo.transition(saved.id,review.id,'approve'),/没有可采用/);

    const lastId=saved.units[0].scenes[0].blocks[2].id;
    const rewrite=task('rewrite',[lastId]);
    assert.equal(repo.submitJob(saved.id,rewrite.id,JSON.stringify({summary:'让哨声的线索可见',blocks:[{type:'action',text:'岸边传来一声短促的哨响。林野看见陌生人手里那只裂了边的黄铜哨，松开总闸。'}]}),source).status,'ready');
    saved=repo.transition(saved.id,rewrite.id,'approve').project!;
    assert.equal(saved.units[0].scenes[0].blocks[0].id,originalFirstBlock.id);
    assert.equal(saved.units[0].scenes[0].blocks[0].text,originalFirstBlock.text);
    assert.match(exportText(saved,'fountain'),/@林野\n船走了。/);
    assert.match(createScriptDelivery(saved).units[0].prose!,/黄铜哨/);
    assert.equal(saved.revision,4);
    assert.equal(repo.getJobInput(saved.id,scene.id).units[0].scenes[0].blocks[0].text,'');
    assert.match(repo.getJobInput(saved.id,rewrite.id).units[0].scenes[0].blocks[2].text,/短促的哨响/);
    assert.doesNotMatch(repo.getJobInput(saved.id,rewrite.id).units[0].scenes[0].blocks[2].text,/黄铜哨/);
    assert.deepEqual(repo.getProject(saved.id),saved);
    assert.equal(authorHistoryCount(db),0);
  } finally { db.close(); }
});
test('自写分场提案只新增场景，保留已写场和规划，并可在下一步写正文',()=>{
  const db=new Database(':memory:');
  try {
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();
    draft.units[0].scenes[0].purpose='林野准备关灯';
    draft.units[0].scenes[0].blocks[0].text='林野把总闸盖上。';
    let saved=repo.saveProject(draft,0);
    const original=structuredClone(saved.units[0].scenes[0]);
    const source={source:'manual_external' as const,provider:'codex_test_fixture',modelId:'self_written'};
    const plan=repo.createJob(saved.id,{operation:'plan',unitId:saved.units[0].id,sceneId:original.id,prompt:'只补一场，不改开场',expectedRevision:saved.revision});
    const raw=JSON.stringify({summary:'让决定由行动呈现',scenePlans:[{title:'码头外 夜',purpose:'陌生人请求重新开灯，林野听见旧哨声。',location:'码头外',timeOfDay:'夜'}]});
    assert.equal(repo.submitJob(saved.id,plan.id,raw,source).status,'ready');
    assert.equal(repo.getProject(saved.id)!.units[0].scenes.length,1);
    saved=repo.transition(saved.id,plan.id,'approve').project!;
    assert.deepEqual(saved.units[0].scenes[0],original);
    assert.equal(saved.units[0].scenes[1].purpose,'陌生人请求重新开灯，林野听见旧哨声。');
    const newScene=saved.units[0].scenes[1];
    const writing=repo.createJob(saved.id,{operation:'scene',unitId:saved.units[0].id,sceneId:newScene.id,prompt:'根据本场计划写动作',expectedRevision:saved.revision});
    repo.submitJob(saved.id,writing.id,JSON.stringify({summary:'把请求写成可见行动',blocks:[{type:'action',text:'陌生人在灯下举起一只旧哨。林野又打开了配电箱。'}]}),source);
    saved=repo.transition(saved.id,writing.id,'approve').project!;
    assert.deepEqual(saved.units[0].scenes[0],original);
    assert.match(exportText(saved,'fountain'),/又打开了配电箱/);
  } finally { db.close(); }
});
test('持久全剧分场任务用手写返回规划三集，已有正文保持原样且只在采用时更新作者稿',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=createScriptProject('渡口三集',{...profile,organization:'episodic',plannedUnits:3});
    draft.units[0].scenes[0].purpose='值班员发现停航告示。';
    draft.units[0].scenes[0].blocks[0].text='值班员将停航告示贴在窗上。';
    draft.methods=[{id:'skill:scene-outline',title:'具体事件',version:'1',content:'每场写出可见事件。',usage:{operations:['board_plan'],inputs:[],note:''}}];
    const published=repo.saveProject(draft,0);
    const original=structuredClone(published.units[0].scenes[0]);
    const job=repo.createJob(published.id,{operation:'board_plan',unitId:published.units[0].id,sceneId:original.id,prompt:'为三集分别规划具体事件',expectedRevision:published.revision,methodIds:['skill:scene-outline']});
    assert.equal(job.methods[0].id,'skill:scene-outline');
    const raw=JSON.stringify({summary:'第一集建立停航问题，后二集推进求助与选择。',units:[
      {unitIndex:1,title:'停航',summary:'值班员贴出告示。',scenes:[{title:'模型想改第一场',purpose:'模型替换正文',blocks:[{text:'不应进入'}]}]},
      {unitIndex:2,title:'求助',summary:'陌生人抵达渡口。',scenes:[{title:'码头外',purpose:'陌生人向值班员求助。'}]},
      {unitIndex:3,title:'决定',summary:'值班员决定重新开灯。',scenes:[{title:'配电室',purpose:'值班员重新打开渡口的灯。'}]},
    ]});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    assert.equal(repo.submitJob(published.id,job.id,raw,source).status,'ready');
    assert.equal(repo.getProject(published.id)?.revision,published.revision);
    const accepted=repo.transition(published.id,job.id,'approve').project!;
    assert.equal(accepted.revision,published.revision+1);
    assert.equal(accepted.units.length,3);
    assert.deepEqual(accepted.units[0].scenes[0],original);
    assert.equal(accepted.units[0].summary,'');
    assert.equal(accepted.units[1].scenes[0].purpose,'陌生人向值班员求助。');
    assert.equal(accepted.units[2].scenes[0].purpose,'值班员重新打开渡口的灯。');
    assert.equal(repo.getJob(published.id,job.id).rawResult,raw);
    assert.equal(repo.listBoardPlanJobs(published.id)[0].status,'approved');
    assert.equal(authorHistoryCount(db),0);
  }finally{db.close();}
});
test('空白单元没有场景时仍可发起持久全剧分场任务',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.units[0].scenes=[];
    const p=repo.saveProject(draft,0);
    const job=repo.createJob(p.id,{operation:'board_plan',unitId:p.units[0].id,sceneId:p.units[0].id,prompt:'从空白单元开始分场',expectedRevision:p.revision});
    const raw=JSON.stringify({summary:'先让主角看见失物',units:[{unitIndex:1,scenes:[{title:'失物柜',purpose:'主角发现一把不属于自己的钥匙。'}]}]});
    assert.equal(repo.submitJob(p.id,job.id,raw,{source:'manual_external',provider:'self_written',modelId:'fixture'}).status,'ready');
    const accepted=repo.transition(p.id,job.id,'approve').project!;
    assert.equal(accepted.units[0].scenes.length,1);
    assert.equal(accepted.units[0].scenes[0].purpose,'主角发现一把不属于自己的钥匙。');
  }finally{db.close();}
});
test('结尾与场景变化建议作为持久任务按选定方案原子采用，正文保持原样',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.methods=[{id:'skill:quiet-ending',title:'克制的结尾',version:'2',content:'不强求悬念。',usage:{operations:['ending'],inputs:[],note:'允许平静落点'}}];
    let p=repo.saveProject(draft,0);
    const unit=p.units[0],scene=unit.scenes[0];
    const originalBlocks=structuredClone(scene.blocks);
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    const ending=repo.createJob(p.id,{operation:'ending',unitId:unit.id,sceneId:scene.id,prompt:'给出不同的结尾',expectedRevision:p.revision,methodIds:['skill:quiet-ending']});
    assert.equal(ending.methods[0].content,'不强求悬念。');
    assert.equal(repo.submitJob(p.id,ending.id,JSON.stringify({summary:'缺少方案',findings:[]}),source).status,'failed');
    const endingRaw=JSON.stringify({summary:'一明一暗的两种收尾',choices:[{title:'平静靠岸',content:'船稳稳靠岸，摆渡员把旧船票收好。'},{title:'灯亮起来',content:'岛上的旧灯亮起，摆渡员决定上岸。'}]});
    assert.equal(repo.submitJob(p.id,ending.id,endingRaw,source).status,'ready');
    assert.throws(()=>repo.transition(p.id,ending.id,'approve'),/请选择有效/);
    p=repo.transition(p.id,ending.id,'approve',1).project!;
    assert.equal(p.units[0].endingHook,'岛上的旧灯亮起，摆渡员决定上岸。');
    assert.deepEqual(p.units[0].scenes[0].blocks,originalBlocks);
    assert.equal(repo.getJob(p.id,ending.id).selectedChoiceIndex,1);
    assert.equal(repo.transition(p.id,ending.id,'approve',1).project!.revision,p.revision);
    assert.throws(()=>repo.transition(p.id,ending.id,'approve',0),/另一方案/);
    assert.throws(()=>repo.createJob(p.id,{operation:'scene_turn',unitId:unit.id,sceneId:scene.id,prompt:'不能借用结尾 Skill',expectedRevision:p.revision,methodIds:['skill:quiet-ending']}),/不适用于/);
    const turn=repo.createJob(p.id,{operation:'scene_turn',unitId:unit.id,sceneId:scene.id,prompt:'给本场两个推进方向',expectedRevision:p.revision});
    const turnRaw=JSON.stringify({summary:'行动与关系两种变化',choices:[{title:'上船',content:'乘客出示船票，摆渡员让她上船。',extra:{purpose:'乘客出示十年前的船票，摆渡员同意开船。',entryState:'准备收船',exitState:'驶向失踪岛'}},{title:'折返',content:'摆渡员拒绝靠岸。'}]});
    assert.equal(repo.submitJob(p.id,turn.id,turnRaw,source).status,'ready');
    p=repo.transition(p.id,turn.id,'approve',0).project!;
    assert.equal(p.units[0].scenes[0].purpose,'乘客出示十年前的船票，摆渡员同意开船。');
    assert.equal(p.units[0].scenes[0].entryState,'准备收船');
    assert.equal(p.units[0].scenes[0].exitState,'驶向失踪岛');
    assert.deepEqual(p.units[0].scenes[0].blocks,originalBlocks);
    assert.deepEqual(repo.transition(p.id,ending.id,'approve',1).project,p);
    assert.deepEqual(repo.getProject(p.id),p);
    assert.equal(repo.listBoardSuggestionJobs(p.id).length,2);
  }finally{db.close();}
});
test('逐步规划可交给 Agent 写完空白场并审阅，均使用自写返回',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    let p=repo.saveProject(project(),0);
    const source={source:'manual_external' as const,provider:'codex_test_fixture',modelId:'self_written'};
    const plan=repo.createJob(p.id,{operation:'plan',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,prompt:'按渡口故事补一场',expectedRevision:p.revision});
    repo.submitJob(p.id,plan.id,JSON.stringify({summary:'把迟疑与求助分成两场',scenePlans:[
      {title:'值班室 夜',purpose:'林野正要关掉渡口的灯。'},
      {title:'渡口 夜',purpose:'陌生人举起旧哨，请值班员重新开灯。'},
    ]}),source);
    p=repo.transition(p.id,plan.id,'approve').project!;
    let run=repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'按已有分场写动作简洁的短片初稿，最后审阅因果。',strategy:'write_existing',maxScenes:2,methodIds:[],workspace:'published'});
    run=repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version});
    const lines=['林野把总闸拨到一半，听见岸边的哨声。','陌生人举起裂边的黄铜哨。林野推回总闸，渡口的灯重新亮起。'];
    for(let index=0;index<2;index++){
      const sceneId=run.sceneIds[run.cursor];
      const job=repo.createJob(p.id,{operation:'scene',unitId:run.unitId,sceneId,prompt:`写第 ${index+1} 场`,expectedRevision:p.revision});
      run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
      repo.submitJob(p.id,job.id,JSON.stringify({summary:'用可见行动推进',blocks:[{type:'action',text:lines[index]}]}),source);
      p=repo.transition(p.id,job.id,'approve').project!;
      run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    }
    assert.equal(run.phase,'review');
    const review=repo.createJob(p.id,{operation:'review',unitId:run.unitId,sceneId:p.units[0].scenes[0].id,prompt:'按已写正文检查因果',expectedRevision:p.revision,reviewSceneIds:run.sceneIds});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:review.id});
    repo.submitJob(p.id,review.id,JSON.stringify({summary:'动作承接明确；旧哨与林野的关系仍需作者决定。',findings:[]}),source);
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
    assert.match(exportText(p,'fountain'),/黄铜哨/);
    assert.equal(authorHistoryCount(db),0);
  }finally{db.close();}
});
test('Agent 独立草稿逐步写作与审阅，作者稿仅在采用时更新',()=>{
  const db=new Database(':memory:');
  try{
    let repo=createScriptRepository(db);repo.ensureSchema();
    const published=repo.saveProject(project(),0);
    let run=repo.createAgentRun(published.id,{unitId:published.units[0].id,goal:'写出渡口值班员的选择，并检查动作因果。',strategy:'write_existing',maxScenes:1,methodIds:[],workspace:'draft'});
    assert.equal(run.baseRevision,published.revision);
    run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
    const draft=repo.getAgentDraft(published.id,run.id);
    const job=repo.createJob(published.id,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'只写可见行动',expectedRevision:draft.revision,agentRunId:run.id});
    run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    assert.equal(repo.submitJob(published.id,job.id,JSON.stringify({summary:'行动',blocks:[{type:'action',text:'值班员重新打开渡口的灯。'},{type:'dialogue',speakerName:'值班员',text:'船还没走。'}]}),source).status,'ready');
    const approved=repo.transition(published.id,job.id,'approve');
    assert.equal(approved.project!.revision,published.revision+1);
    assert.equal(repo.getProject(published.id)!.revision,published.revision);
    assert.equal(authorHistoryCount(db),0);
    run=repo.transitionAgentRun(published.id,run.id,{action:'pause',expectedVersion:run.version});
    repo=createScriptRepository(db);repo.ensureSchema();
    run=repo.getAgentRun(published.id,run.id);
    run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
    run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.phase,'review');
    const revisedDraft=repo.getAgentDraft(published.id,run.id);
    const review=repo.createJob(published.id,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'只审阅本场',expectedRevision:revisedDraft.revision,reviewSceneIds:run.sceneIds,agentRunId:run.id});
    run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:review.id});
    assert.equal(repo.submitJob(published.id,review.id,JSON.stringify({summary:'动作因果清晰',findings:[]}),source).status,'ready');
    run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
    assert.equal(repo.getProject(published.id)!.revision,published.revision);
    assert.match(exportText(repo.getAgentDraft(published.id,run.id),'fountain'),/重新打开渡口的灯/);
    const accepted=repo.publishAgentRun(published.id,run.id,run.version,published.revision);
    assert.equal(accepted.project.revision,published.revision+1);
    assert.equal(accepted.run.publicationStatus,'published');
    assert.equal(authorHistoryCount(db),0);
    assert.match(exportText(repo.getProject(published.id)!,'fountain'),/重新打开渡口的灯/);
    assert.match(exportText(repo.getProject(published.id)!,'fountain'),/@值班员\n船还没走/);
    assert.equal(repo.publishAgentRun(published.id,run.id,accepted.run.version,accepted.project.revision).project.revision,accepted.project.revision);
    assert.equal(authorHistoryCount(db),0);
  }finally{db.close();}
});
test('Agent 分场草稿与作者修改项目标题可以合并，取消任务不能采用',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    let published=repo.saveProject(project(),0);
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    let run=repo.createAgentRun(published.id,{unitId:published.units[0].id,goal:'补一场渡口冲突',strategy:'plan_only',maxScenes:1,workspace:'draft'});
    run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(published.id,{operation:'plan',unitId:run.unitId,sceneId:published.units[0].scenes[0].id,prompt:'补一场',expectedRevision:published.revision,agentRunId:run.id});
    run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    repo.submitJob(published.id,job.id,JSON.stringify({summary:'给值班员一个选择',scenePlans:[{title:'渡口夜',purpose:'陌生人请求重新开灯。'}]}),source);
    repo.transition(published.id,job.id,'approve');
    run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
    const draft=repo.getAgentDraft(published.id,run.id);
    published.title='作者新标题';published=repo.saveProject(published,published.revision);
    const merged=repo.publishAgentRun(published.id,run.id,run.version,published.revision);
    assert.deepEqual(repo.getAgentDraft(published.id,run.id),draft);
    assert.equal(merged.project.title,'作者新标题');
    assert.equal(merged.project.units[0].scenes[0].title,'渡口夜');
    assert.equal(authorHistoryCount(db),0);
    let cancelled=repo.createAgentRun(published.id,{unitId:published.units[0].id,goal:'另一项准备',strategy:'plan_only',maxScenes:1,workspace:'draft'});
    cancelled=repo.transitionAgentRun(published.id,cancelled.id,{action:'cancel',expectedVersion:cancelled.version});
    assert.throws(()=>repo.publishAgentRun(published.id,cancelled.id,cancelled.version,published.revision),/尚未完成/);
  }finally{db.close();}
});
test('Agent 与作者改不同场景时合并；同一场正文冲突时不丢失草稿和正式稿',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const initial=project();
    const second=newScene('值班室');second.purpose='调查谁关了灯';second.blocks[0].text='值班员翻开夜间记录。';
    initial.units[0].scenes.push(second);
    let published=repo.saveProject(initial,0);
    let run=repo.createAgentRun(published.id,{unitId:published.units[0].id,goal:'写渡口第一场',strategy:'write_existing',maxScenes:1,workspace:'draft'});
    run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(published.id,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'写第一场',expectedRevision:published.revision,agentRunId:run.id});
    run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    repo.submitJob(published.id,job.id,JSON.stringify({summary:'值班员决定开灯',blocks:[{type:'action',text:'值班员推开渡口的灯闸。'}]}),source);
    repo.transition(published.id,job.id,'approve');
    run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
    const review=repo.createJob(published.id,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'检查第一场',expectedRevision:repo.getAgentDraft(published.id,run.id).revision,reviewSceneIds:run.sceneIds,agentRunId:run.id});
    run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:review.id});
    repo.submitJob(published.id,review.id,JSON.stringify({summary:'动作完整',findings:[]}),source);
    run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
    published.units[0].scenes[1].blocks[0].text='值班员发现记录被撕去一页。';
    published=repo.saveProject(published,published.revision);
    const adopted=repo.publishAgentRun(published.id,run.id,run.version,published.revision);
    assert.equal(adopted.project.units[0].scenes[0].blocks[0].text,'值班员推开渡口的灯闸。');
    assert.equal(adopted.project.units[0].scenes[1].blocks[0].text,'值班员发现记录被撕去一页。');
    assert.equal(adopted.project.revision,published.revision+1);
    assert.equal(repo.getAgentRunInput(published.id,run.id).units[0].scenes[0].blocks[0].text,'');
    assert.equal(repo.publishAgentRun(published.id,run.id,adopted.run.version,adopted.project.revision).project.revision,adopted.project.revision);
  }finally{db.close();}
});
test('Agent 合并按字段判断：场景提纲与正文可并存，双边正文改动必须停下',()=>{
  const base=project();
  const draft=structuredClone(base);draft.revision++;
  draft.units[0].scenes[0].blocks[0].text='母亲把旧照片放进信封。';
  const published=structuredClone(base);published.revision++;
  published.units[0].scenes[0].purpose='母亲发现照片背后的日期。';
  const independent=mergeAgentDraft(base,published,draft);
  assert.equal(independent.project.units[0].scenes[0].purpose,'母亲发现照片背后的日期。');
  assert.equal(independent.project.units[0].scenes[0].blocks[0].text,'母亲把旧照片放进信封。');
  published.units[0].scenes[0].blocks[0].text='母亲烧掉了照片。';
  assert.throws(()=>mergeAgentDraft(base,published,draft),/正文.*分别修改/);
  assert.equal(published.units[0].scenes[0].blocks[0].text,'母亲烧掉了照片。');
  assert.equal(draft.units[0].scenes[0].blocks[0].text,'母亲把旧照片放进信封。');
});
test('Agent 增删场景遇到作者同时调整场景结构或占位内容时拒绝自动合并',()=>{
  const base=project();
  const draft=structuredClone(base);draft.revision++;
  draft.units[0].scenes=[newScene('码头夜'),newScene('值班室')];
  const published=structuredClone(base);published.revision++;
  published.units[0].scenes[0].blocks[0].text='作者已在第一场写下开头。';
  assert.throws(()=>mergeAgentDraft(base,published,draft),/已被作者修改/);
  assert.equal(published.units[0].scenes.length,1);
  const reordered=structuredClone(base);reordered.revision++;
  reordered.units[0].scenes.push(newScene('作者新增场'));
  assert.throws(()=>mergeAgentDraft(base,reordered,draft),/场景结构已由作者调整/);
  const unsafe=structuredClone(base);unsafe.revision++;
  unsafe.title='Agent 擅改标题';
  assert.throws(()=>mergeAgentDraft(base,base,unsafe),/场景以外的改动/);
});
test('Agent 场数上限扣除已有待写分场，足够时直接写作',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();const planned=newScene('值班室');planned.purpose='值班员决定关灯。';draft.units[0].scenes.push(planned);
    const saved=repo.saveProject(draft,0);
    const existing=repo.createAgentRun(saved.id,{unitId:saved.units[0].id,goal:'按已有分场写作',strategy:'plan_write',maxScenes:1});
    assert.equal(existing.phase,'write');assert.deepEqual(existing.sceneIds,[planned.id]);
    let run=repo.createAgentRun(saved.id,{unitId:saved.units[0].id,goal:'只补一场再写作',strategy:'plan_write',maxScenes:2});
    assert.equal(run.phase,'plan');
    run=repo.transitionAgentRun(saved.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(saved.id,{operation:'plan',unitId:run.unitId,sceneId:saved.units[0].scenes[0].id,prompt:'已有一场，最多补一场',expectedRevision:saved.revision,agentRunId:run.id});
    run=repo.transitionAgentRun(saved.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    const plans=[{title:'码头',purpose:'陌生人求助。'},{title:'回程',purpose:'值班员改主意。'}];
    assert.equal(repo.submitJob(saved.id,job.id,JSON.stringify({summary:'两场建议',scenePlans:plans}),source).status,'failed');
    assert.match(repo.getJob(saved.id,job.id).error!,/最多还能补 1 场/);
    assert.equal(repo.submitJob(saved.id,job.id,JSON.stringify({summary:'只补必要的一场',scenePlans:plans.slice(0,1)}),source).status,'ready');
    repo.transition(saved.id,job.id,'approve');
    run=repo.transitionAgentRun(saved.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.phase,'write');assert.equal(run.sceneIds.length,2);assert.equal(run.sceneIds[0],planned.id);
    assert.equal(repo.getProject(saved.id)?.revision,saved.revision);
  }finally{db.close();}
});
test('Agent 持久计划使用自写返回逐步推进，暂停后重开可续写并跳过作者已写场',()=>{
  const db=new Database(':memory:');
  try {
    let repo=createScriptRepository(db);repo.ensureSchema();
    let p=repo.saveProject(project(),0);
    const source={source:'manual_external' as const,provider:'codex_test_fixture',modelId:'self_written'};
    let run=repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'写一个克制的渡口短片；保留已有正文，最后检查人物动机。',strategy:'plan_write',maxScenes:2,methodIds:[],workspace:'published'});
    run=repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version});
    const plan=repo.createJob(p.id,{operation:'plan',unitId:run.unitId,sceneId:p.units[0].scenes[0].id,prompt:'分两场，保留作者已有内容',expectedRevision:p.revision});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:plan.id});
    repo.submitJob(p.id,plan.id,JSON.stringify({summary:'分开关灯与回头两个动作',scenePlans:[{title:'值班室 夜',purpose:'林野按下关灯开关。'},{title:'渡口 夜',purpose:'陌生人求助，林野重新开灯。'}]}),source);
    p=repo.transition(p.id,plan.id,'approve').project!;
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.phase,'write');assert.equal(run.sceneIds.length,2);

    const first=repo.createJob(p.id,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'只写第一场',expectedRevision:p.revision});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:first.id});
    repo.submitJob(p.id,first.id,JSON.stringify({summary:'用动作表现迟疑',blocks:[{type:'action',text:'林野把开关拨到一半，停住听了一秒。'}]}),source);
    run=repo.transitionAgentRun(p.id,run.id,{action:'pause',expectedVersion:run.version});
    assert.throws(()=>repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version}),/步骤与当前任务不匹配/);

    repo=createScriptRepository(db);repo.ensureSchema();
    run=repo.getAgentRun(p.id,run.id);
    assert.equal(run.activeJobId,first.id);
    run=repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version});
    p=repo.transition(p.id,first.id,'approve').project!;
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.cursor,1);

    p.units[0].scenes[1].blocks[0].text='陌生人举起一把旧哨。林野重新开灯。';
    p=repo.saveProject(p,p.revision);
    run=repo.transitionAgentRun(p.id,run.id,{action:'skip',expectedVersion:run.version});
    assert.equal(run.phase,'review');
    const review=repo.createJob(p.id,{operation:'review',unitId:run.unitId,sceneId:p.units[0].scenes[0].id,prompt:'指出有正文依据的问题',expectedRevision:p.revision,reviewSceneIds:run.sceneIds});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:review.id});
    repo.submitJob(p.id,review.id,JSON.stringify({summary:'两场的因果已连接',findings:[{sceneId:p.units[0].scenes[1].id,issue:'重新开灯发生得很快，尚不清楚旧哨为何改变林野的判断。',suggestion:'可在前文给旧哨一个可见的关联，也可保留悬念。'}]}),source);
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');assert.equal(run.completedJobIds.length,3);
    assert.equal(repo.getProject(p.id)!.units[0].scenes[1].blocks[0].text,'陌生人举起一把旧哨。林野重新开灯。');
    assert.throws(()=>repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version}),/已结束/);
  } finally { db.close(); }
});
test('Agent 在创建时固定 Skill 版本，后续变更不能混入任务',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.methods=[{id:'skill:visible',title:'可见动作',version:'1',content:'只写可见行动。'}];
    let saved=repo.saveProject(draft,0);
    let run=repo.createAgentRun(saved.id,{unitId:saved.units[0].id,goal:'补一场可见动作',strategy:'plan_only',maxScenes:1,methodIds:['skill:visible'],workspace:'published'});
    run=repo.transitionAgentRun(saved.id,run.id,{action:'resume',expectedVersion:run.version});
    const valid=repo.createJob(saved.id,{operation:'plan',unitId:run.unitId,sceneId:saved.units[0].scenes[0].id,prompt:'本次只补场',expectedRevision:saved.revision,methodIds:['skill:visible']});
    run=repo.transitionAgentRun(saved.id,run.id,{action:'attach',expectedVersion:run.version,jobId:valid.id});
    assert.equal(run.activeJobId,valid.id);
    run=repo.transitionAgentRun(saved.id,run.id,{action:'cancel',expectedVersion:run.version});
    const second=repo.createAgentRun(saved.id,{unitId:saved.units[0].id,goal:'补一场',strategy:'plan_only',maxScenes:1,methodIds:['skill:visible'],workspace:'published'});
    saved.methods[0].content='改为只写对白。';saved=repo.saveProject(saved,saved.revision);
    const changed=repo.createJob(saved.id,{operation:'plan',unitId:second.unitId,sceneId:saved.units[0].scenes[0].id,prompt:'本次补场',expectedRevision:saved.revision,methodIds:['skill:visible']});
    const resumed=repo.transitionAgentRun(saved.id,second.id,{action:'resume',expectedVersion:second.version});
    assert.throws(()=>repo.transitionAgentRun(saved.id,resumed.id,{action:'attach',expectedVersion:resumed.version,jobId:changed.id}),/Skill 已变化/);
  }finally{db.close();}
});

test('同一作品不会并行运行两个 Agent，也不能让两项计划认领同一条写作记录',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const p=repo.saveProject(project(),0);
    const input={unitId:p.units[0].id,goal:'补充下一场',strategy:'plan_only' as const,maxScenes:1,methodIds:[],workspace:'published' as const};
    let first=repo.createAgentRun(p.id,input);
    let second=repo.createAgentRun(p.id,input);
    first=repo.transitionAgentRun(p.id,first.id,{action:'resume',expectedVersion:first.version});
    assert.throws(()=>repo.transitionAgentRun(p.id,second.id,{action:'resume',expectedVersion:second.version}),/已有运行中的 Agent/);
    const job=repo.createJob(p.id,{operation:'plan',unitId:first.unitId,sceneId:p.units[0].scenes[0].id,prompt:'补充下一场',expectedRevision:p.revision});
    first=repo.transitionAgentRun(p.id,first.id,{action:'attach',expectedVersion:first.version,jobId:job.id});
    first=repo.transitionAgentRun(p.id,first.id,{action:'pause',expectedVersion:first.version});
    second=repo.transitionAgentRun(p.id,second.id,{action:'resume',expectedVersion:second.version});
    assert.throws(()=>repo.transitionAgentRun(p.id,second.id,{action:'attach',expectedVersion:second.version,jobId:job.id}),/属于另一项 Agent/);
  }finally{db.close();}
});
test('旧的暂停 Agent 不会因近期任务列表截断而失去恢复入口',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0);
    const first=repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'最早的待续任务',strategy:'plan_only',maxScenes:1});
    for(let index=0;index<31;index++)repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:`后续任务 ${index}`,strategy:'plan_only',maxScenes:1});
    assert.ok(repo.listAgentRuns(p.id).some(run=>run.id===first.id));
  }finally{db.close();}
});
test('只审阅 Agent 可从长片中间选择范围，完成后不改稿件版本',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.units[0].scenes=Array.from({length:20},(_,index)=>{
      const scene=newScene(`第 ${index+1} 场`);scene.blocks[0].text=`第 ${index+1} 场的手写正文。`;return scene;
    });
    const p=repo.saveProject(draft,0);
    let run=repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'只检查第十场后的衔接，不改正文。',strategy:'review_only',maxScenes:3,startSceneId:p.units[0].scenes[9].id,methodIds:[],workspace:'published'});
    assert.equal(run.phase,'review');
    assert.deepEqual(run.sceneIds,p.units[0].scenes.slice(9,12).map(scene=>scene.id));
    run=repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(p.id,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'核对指定三场的因果',expectedRevision:p.revision,reviewSceneIds:run.sceneIds});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'这三场没有确定性的衔接错误',findings:[]}),{source:'manual_external',provider:'codex_test_fixture',modelId:'self_written'}).status,'ready');
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
    assert.equal(repo.getProject(p.id)?.revision,p.revision);
    assert.throws(()=>repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'检查不存在的场',strategy:'review_only',maxScenes:2,startSceneId:'missing'}),/起点场景不存在/);
  }finally{db.close();}
});
test('65 场长篇可由 Agent 分三批审阅，跨批暂停恢复且只汇总实际读取范围',()=>{
  const db=new Database(':memory:');
  try{
    let repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.units[0].scenes=Array.from({length:65},(_,index)=>{
      const scene=newScene(`第 ${index+1} 场`);scene.blocks[0].text=`第 ${index+1} 场的作者正文。`;return scene;
    });
    const published=repo.saveProject(draft,0);
    let run=repo.createAgentRun(published.id,{unitId:published.units[0].id,goal:'分批检查全片因果和人物行为，不改正文。',strategy:'review_all',maxScenes:30,workspace:'draft'});
    assert.equal(run.sceneIds.length,65);assert.equal(run.phase,'review');
    run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    const covered:string[]=[];
    for(let batch=0;batch<3;batch++){
      const working=repo.getAgentDraft(published.id,run.id);
      const ids=agentReviewSceneIds(run,working);covered.push(...ids);
      assert.equal(ids.length,[30,30,5][batch]);
      const job=repo.createJob(published.id,{operation:'review',unitId:run.unitId,sceneId:ids[0],prompt:`只读第 ${batch+1} 批`,expectedRevision:working.revision,reviewSceneIds:ids,agentRunId:run.id});
      run=repo.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
      if(batch===1){
        const wrong=JSON.stringify({summary:'越界观察',findings:[{sceneId:covered[0],issue:'不属于本批',suggestion:'不应采用'}]});
        assert.equal(repo.submitJob(published.id,job.id,wrong,source).status,'failed');
      }
      const issue=`“第 ${batch*30+1} 场的作者正文”尚未交代人物为何在此刻决定行动。`;
      const findings=[{sceneId:ids[0],issue,suggestion:'检查前一场的行动依据。'}];
      if(batch===0)findings.push({...findings[0],issue:`  ${issue}  `});
      assert.equal(repo.submitJob(published.id,job.id,JSON.stringify({summary:`第 ${batch+1} 批只读 ${ids.length} 场`,findings}),source).status,'ready');
      run=repo.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
      if(batch===0){
        run=repo.transitionAgentRun(published.id,run.id,{action:'pause',expectedVersion:run.version});
        repo=createScriptRepository(db);repo.ensureSchema();run=repo.getAgentRun(published.id,run.id);
        run=repo.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
      }
    }
    assert.equal(run.status,'complete');assert.equal(run.cursor,65);
    assert.deepEqual(covered,published.units[0].scenes.map(scene=>scene.id));
    const reviews=repo.listAgentReviewJobs(published.id,run.id);
    assert.equal(reviews.length,3);assert.equal(aggregateAgentReviewFindings(reviews).length,3);
    repo.recordReviewDecision(published.id,reviews[1].id,0,'later','等待完整修订');
    assert.equal(repo.listAgentReviewJobs(published.id,run.id)[1].reviewDecisions?.[0]?.status,'later');
    assert.equal(repo.getProject(published.id)?.revision,published.revision);
    assert.equal(repo.getAgentDraft(published.id,run.id).revision,published.revision);
  }finally{db.close();}
});
test('审阅结果只能引用实际读取正文的场景，越界意见保留原文待修正',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const draft=project();draft.units[0].scenes.push(newScene('第二场'));
    const p=repo.saveProject(draft,0);
    const [first,second]=p.units[0].scenes;
    const job=repo.createJob(p.id,{operation:'review',unitId:p.units[0].id,sceneId:first.id,prompt:'只审阅第一场',expectedRevision:p.revision,reviewSceneIds:[first.id]});
    const raw=JSON.stringify({summary:'第一场观察',findings:[{sceneId:second.id,issue:'第二场的某句对白',suggestion:'改写'}]});
    const result=repo.submitJob(p.id,job.id,raw,{source:'manual_external',provider:'codex_test_fixture',modelId:'self_written'});
    assert.equal(result.status,'failed');
    assert.match(result.error!,/未读取正文/);
    assert.equal(result.rawResult,raw);
    assert.equal(repo.getProject(p.id)?.revision,p.revision);
  }finally{db.close();}
});
test('Agent 的场数上限约束实际回填，超量返回可修正且不会先写入作品',()=>{
  const db=new Database(':memory:');
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();
    const p=repo.saveProject(project(),0);
    let run=repo.createAgentRun(p.id,{unitId:p.units[0].id,goal:'只补一场',strategy:'plan_only',maxScenes:1,workspace:'published'});
    run=repo.transitionAgentRun(p.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(p.id,{operation:'plan',unitId:run.unitId,sceneId:p.units[0].scenes[0].id,prompt:'最多一场',expectedRevision:p.revision});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    const source={source:'manual_external' as const,provider:'self_written',modelId:'fixture'};
    const scenePlans=[{title:'第一场',purpose:'母亲锁门',location:'家门口',timeOfDay:'夜'},{title:'第二场',purpose:'女儿返回',location:'家门口',timeOfDay:'夜'}];
    assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'两场方案',scenePlans}),source).status,'failed');
    assert.equal(repo.getProject(p.id)!.units[0].scenes.length,1);
    assert.equal(repo.submitJob(p.id,job.id,JSON.stringify({summary:'精简为一场',scenePlans:scenePlans.slice(0,1)}),source).status,'ready');
    const applied=repo.transition(p.id,job.id,'approve').project!;
    assert.equal(applied.units[0].scenes.length,1);
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
  } finally { db.close(); }
});
function serialThread(){
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=3;
  p.units=[newUnit('埋设',300000,p.id),newUnit('期限',300000,p.id),newUnit('后续',300000,p.id)];
  p.units.forEach((u,i)=>{u.scenes[0].storyOrder=i;u.scenes[0].blocks[0].text=['她藏起一把旧钥匙。','门锁上有同样的刻痕。','她用钥匙打开门。'][i];});
  const [a,,c]=p.units;
  const track={id:'key_thread',scopeId:p.id,kind:'thread' as const,perspective:'audience' as const,label:'旧钥匙的用途',characterIds:[],initialValue:'尚未展示钥匙',changes:[{id:'unlock',sceneId:c.scenes[0].id,value:'旧钥匙打开了门',reason:'她用旧钥匙开门',sourceHash:sceneStateHash(c.scenes[0])}],threadPlan:{setupSceneId:a.scenes[0].id,setupSourceHash:sceneStateHash(a.scenes[0]),dueUnitId:p.units[1].id,payoffChangeId:undefined as string|undefined,waiver:undefined as string|undefined}};
  p.continuityTracks=[track];return {p,track};
}
const item=(patch:Partial<TimelineItem>={}):TimelineItem=>({id:'clip',track:'V1',modality:'video',kind:'content',startMs:0,endMs:128000,included:true,label:'实景计划',contentHash:'hash',...patch});
const fixtures=JSON.parse(readFileSync(new URL('../script_system_design_kit/fixtures/runtime_cases.json',import.meta.url),'utf8'));
for(const fixture of fixtures.cases)test(`合成时长：${fixture.id}`,()=>{
  const items=fixture.items.map((t:any)=>item({id:t.id,track:t.track,modality:t.track.startsWith('A')?'audio':'video',kind:t.kind,startMs:t.start_ms,endMs:t.end_ms,included:t.included}));
  const result=analyseTimeline(items,fixture.target_ms);
  assert.equal(result.spanMs,fixture.expected.export_span_ms);assert.equal(result.coverageMs,fixture.expected.content_union_ms);assert.equal(result.gapToTargetMs,fixture.expected.target_minus_content_ms);
  assert.equal(result.measured,false);assert.equal(result.creativeAccepted,false);
});
test('T14：拒绝负数、倒置、小数和不安全整数，并指向具体片段',()=>{
  for(const patch of [{startMs:-1},{endMs:-2},{startMs:5,endMs:4},{endMs:1.2},{endMs:Number.MAX_SAFE_INTEGER+1}]) assert.throws(()=>parseTimelineItem(item(patch),'timeline.clip'),/timeline.clip/);
  assert.throws(()=>parseTimelineItem(item({kind:'marker'})),/标记/);
});
test('半开区间相邻合并；输入顺序和原数组不改变结果',()=>{
  const values=[[20,30],[0,10],[10,20],[5,7]] as const;assert.deepEqual(unionIntervals(values),[[0,30]]);assert.deepEqual(values[0],[20,30]);
});
test('分轨/音画独立覆盖，声音不能补齐必需画面',()=>{
  const r=analyseTimeline([item({endMs:10000}),item({id:'audio',track:'A1',modality:'audio',endMs:20000})],20000);
  assert.equal(r.coverageMs,20000);assert.equal(r.modalities.video,10000);assert.equal(r.modalities.audio,20000);assert.deepEqual(r.tracks,{V1:10000,A1:20000});assert.equal(r.creativeAccepted,false);
});
test('T07：正文、设定或方法变化使旧计划和估算过期',()=>{
  const p=project(),u=p.units[0];u.scenes[0].blocks[0]={id:'b1',type:'dialogue',text:'钥匙不在这里。'};
  const hash=unitContentHash(p,u);u.timeline=[item({contentHash:hash})];const evidence=estimateDialogue(p,u)!;
  u.scenes[0].blocks[0].text='钥匙就在这里。';assert.notEqual(unitContentHash(p,u),evidence.contentHash);
  const result=analyseTimeline(u.timeline,u.targetDurationMs,unitContentHash(p,u));assert.equal(result.coverageMs,0);assert.equal(result.staleCount,1);assert.equal(result.spanMs,128000);
});
test('目标时长不会成为估算；没有对白时尚未估算',()=>{
  const p=project();assert.equal(estimateDialogue(p,p.units[0]),null);assert.equal(p.units[0].timingEvidence.length,0);
});
test('T08/T09：Mock 只产生提案；手工修改后不可采用旧提案',()=>{
  const p=project(),u=p.units[0],s=u.scenes[0];const proposal=createMockProposal(p,u.id,s.id);assert.equal(s.blocks[0].text,'');
  const adopted=applyProposal(p,proposal);assert.equal(adopted.units[0].scenes[0].blocks.length,2);assert.equal(s.blocks.length,1);
  p.brief.concept='新构想';assert.throws(()=>applyProposal(p,proposal),/基线已改变/);
});
test('合成/假设不可伪装成实测证据',()=>{
  assert.throws(()=>parseTimingEvidence({id:'e',kind:'preview',source:'assumption',durationMs:1000,contentHash:'x',assumptions:''}),/假设不能/);
  assert.throws(()=>parseTimingEvidence({id:'e',kind:'final',source:'ffprobe',durationMs:1000,contentHash:'x',assumptions:''}),/mediaHash/);
});
test('稳定 ID 验证重复和悬空引用；同名人物不合并',()=>{
  const p=project();const c={id:'c1',name:'小林',scopeId:p.id,desire:'',need:'',contradiction:'',arc:'',voice:''};
  p.characters=[c,{...c,id:'c2'}];assert.equal(parseScriptProject(p).characters.length,2);
  p.units[0].scenes[0].blocks[0].speakerId='missing';assert.throws(()=>parseScriptProject(p),/说话者不存在/);delete p.units[0].scenes[0].blocks[0].speakerId;
  p.characters[1].id='c1';assert.throws(()=>parseScriptProject(p),/标识重复/);
});
test('中文 Fountain 明确人物标记；交付正文只从块派生',()=>{
  const p=project(),s=p.units[0].scenes[0];p.characters=[{id:'lin',name:'林遥',scopeId:p.id,desire:'',need:'',contradiction:'',arc:'',voice:''}];
  s.location='内景 失物柜';s.timeOfDay='夜';s.blocks=[{id:'dialogue',type:'dialogue',speakerId:'lin',text:'不是这把钥匙。'}];
  const fountain=exportText(p,'fountain');assert.match(fountain,/@林遥\n不是这把钥匙。/);assert.match(fountain,/\.内景 失物柜 \/ 夜/);
  const delivery=createScriptDelivery(p);assert.equal(delivery.schemaVersion,'script-delivery.v2');assert.match(delivery.units[0].prose!,/不是这把钥匙/);
  const imported=createProductionProjectFromScriptExport({package:delivery,productionProjectId:'production',importId:'import'}).project;
  assert.equal(imported.episodes[0].scenes[0].scriptBlocks[1].content,'不是这把钥匙。');
});
test('CAS 原子保存不产生作者历史；已有旧表和旧行原样保留',()=>{
  const db=new Database(':memory:');db.exec("CREATE TABLE writing_projects(id TEXT PRIMARY KEY,data TEXT);INSERT INTO writing_projects VALUES('original','author manuscript')");
  try{
    const repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('script_revisions','script_agent_draft_revisions')").all().length,0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM script_project_inputs').get() as {n:number}).n,0);
    db.exec('CREATE TABLE script_revisions(project_id TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,revision))');
    const legacyData=JSON.stringify(p);
    db.prepare('INSERT INTO script_revisions VALUES(?,?,?,?)').run(p.id,p.revision,p.updatedAt,legacyData);
    const edited={...p,title:'作者新标题'},latest=repo.saveProject(edited,p.revision);
    assert.equal(latest.revision,2);assert.throws(()=>repo.saveProject(edited,p.revision),ScriptConflictError);
    assert.deepEqual(repo.getProject(p.id),latest);
    assert.equal('getProjectVersion' in repo,false);assert.equal('listVersions' in repo,false);assert.equal('restoreProject' in repo,false);
    const reopened=createScriptRepository(db);reopened.ensureSchema();
    assert.deepEqual(db.prepare('SELECT revision,data FROM script_revisions').all(),[{revision:p.revision,data:legacyData}]);
    assert.deepEqual(reopened.readProjectInput(p.id,p.revision),p);
    assert.deepEqual(db.prepare('SELECT * FROM writing_projects').get(),{id:'original',data:'author manuscript'});
  }finally{db.close();}
});
test('实测不得通过文档保存接口注入',()=>{
  const db=new Database(':memory:');try{const repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0);
    p.units[0].timingEvidence.push({id:'forged',kind:'final',source:'ffprobe',durationMs:300000,contentHash:'x',assumptions:'',mediaHash:'fake',toolVersion:'fake',rawMeasurement:'{}',settingsHash:'fake'});
    assert.throws(()=>repo.saveProject(p,1),/媒体测量流程/);assert.equal(repo.getProject(p.id)!.revision,1);
  }finally{db.close();}
});
test('互动读取明确冻结的剧本输入，校验校验和，不借用旧稿 ID',()=>{
  const db=new Database(':memory:');try{const repo=createScriptRepository(db);repo.ensureSchema();const p=project();p.units[0].scenes[0].blocks[0].text='林遥关上柜门。';const saved=repo.saveProject(p,0);
    repo.captureProjectInput(saved);const port=createInteractiveWritingPort(repo);const option=port.listScenes(saved.id)[0];assert.ok(port.resolveScene(option.ref));
    saved.units[0].scenes[0].blocks[0].text='林遥打开柜门。';repo.saveProject(saved,1);assert.equal(port.resolveScene(option.ref)!.scriptBlocks![0].content,'林遥关上柜门。');
    assert.equal(port.resolveScene({...option.ref,checksum:'tampered'}),null);assert.equal(port.resolveScene({...option.ref,artifactId:'writing-scene:old:unit:scene'}),null);
  }finally{db.close();}
});
test('无密钥 HTTP 闭环：创建、保存、冲突、Mock、移除历史入口、导出与校验',async()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();const app=express();app.use(express.json());registerScriptRoutes(app,repo);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}/api/scripts`;
  const send=(path:string,body:unknown,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const created=await send('',{title:'五分钟样例',profile});assert.equal(created.status,201);const {project:p}=await created.json();
    const agentCreated=await send(`/${p.id}/agent-runs`,{unitId:p.units[0].id,goal:'先规划一场，再写空白正文',strategy:'plan_write',maxScenes:2,methodIds:[]});
    assert.equal(agentCreated.status,201);
    const {run:agentRun}=await agentCreated.json();
    assert.equal(agentRun.workspace,'draft');
    assert.equal((await (await fetch(`${base}/${p.id}/agent-runs`)).json()).runs[0].id,agentRun.id);
    assert.equal((await send(`/${p.id}/agent-runs/${agentRun.id}/transition`,{action:'resume',expectedVersion:agentRun.version})).status,200);
    p.units[0].scenes[0].blocks[0].text='林遥把钥匙放回桌上。';assert.equal((await send(`/${p.id}`,{project:p,expectedRevision:1},'PUT')).status,200);
    assert.equal((await send(`/${p.id}`,{project:p,expectedRevision:1},'PUT')).status,409);
    const mock=await send(`/${p.id}/mock`,{expectedRevision:2,unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id});assert.equal(mock.status,200);assert.equal((await mock.json()).proposal.provider,'mock');
    assert.equal((await fetch(`${base}/${p.id}/versions`)).status,404);
    assert.equal((await fetch(`${base}/${p.id}/versions/1`)).status,404);
    assert.equal((await send(`/${p.id}/restore`,{revision:1,expectedRevision:2})).status,404);
    assert.equal(repo.getProject(p.id)!.revision,2);
    assert.match(await (await fetch(`${base}/${p.id}/export?format=fountain`)).text(),/林遥把钥匙/);
    const delivery=await (await fetch(`${base}/${p.id}/delivery`)).json();assert.equal(delivery.package.sourceRevision,2);
    assert.equal((await send('',{title:'未配置',profile:{}})).status,400);
    const boardCreated=await send(`/${p.id}/jobs`,{operation:'board_plan',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,prompt:'给全片分场建议',expectedRevision:2});
    assert.equal(boardCreated.status,201);const {job:boardJob}=await boardCreated.json();
    const provenance={source:'manual_external',provider:'self_written',modelId:'fixture'};
    const invalid=await send(`/${p.id}/jobs/${boardJob.id}/result`,{rawResult:JSON.stringify({summary:'无事件',units:[{unitIndex:1,scenes:[{title:'空场',purpose:''}]}]}),provenance});
    assert.equal((await invalid.json()).job.status,'failed');
    const corrected=await send(`/${p.id}/jobs/${boardJob.id}/result`,{rawResult:JSON.stringify({summary:'保留已写场，只补摘要',units:[{unitIndex:1,summary:'她找回钥匙。',scenes:[{title:'建议场',purpose:'她发现钥匙的来历。'}]}]}),provenance});
    assert.equal((await corrected.json()).job.status,'ready');
    assert.equal((await (await fetch(`${base}/${p.id}/jobs?operation=board_plan`)).json()).jobs[0].id,boardJob.id);
    assert.equal((await (await fetch(`${base}/${p.id}`)).json()).project.revision,2);
    const boardAccepted=await send(`/${p.id}/jobs/${boardJob.id}/approve`,{});
    assert.equal(boardAccepted.status,200);
    assert.equal((await boardAccepted.json()).project.revision,3);
    const endingCreated=await send(`/${p.id}/jobs`,{operation:'ending',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,prompt:'两个可选结尾',expectedRevision:3});
    assert.equal(endingCreated.status,201);const {job:endingJob}=await endingCreated.json();
    const endingSubmitted=await send(`/${p.id}/jobs/${endingJob.id}/result`,{rawResult:JSON.stringify({summary:'开放与平静两种方向',choices:[{title:'开放',content:'渡口的灯亮起。'},{title:'平静',content:'她关好门，保留那把钥匙。'}]}),provenance});
    assert.equal((await endingSubmitted.json()).job.status,'ready');
    assert.equal((await (await fetch(`${base}/${p.id}/jobs?operation=board`)).json()).jobs.length,2);
    assert.equal((await send(`/${p.id}/jobs/${endingJob.id}/approve`,{})).status,400);
    const endingAccepted=await send(`/${p.id}/jobs/${endingJob.id}/approve`,{choiceIndex:1});
    assert.equal(endingAccepted.status,200);
    const endingValue=await endingAccepted.json();
    assert.equal(endingValue.job.selectedChoiceIndex,1);
    assert.equal(endingValue.project.units[0].endingHook,'她关好门，保留那把钥匙。');
    assert.equal(endingValue.project.revision,4);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
});
test('交付只导出当前作者稿，文件名无版本号，历史选择参数拒绝',async()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  const app=express();registerScriptRoutes(app,repo);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/scripts`;
  try{
    let p=project();p.title='交付/钥匙';p.units[0].scenes[0].blocks[0].text='旧稿：把钥匙留在桌上。';
    const old=repo.saveProject(p,0);p=structuredClone(old);p.units[0].scenes[0].blocks[0].text='新稿：把钥匙装进口袋。';const current=repo.saveProject(p,1);
    for(const format of ['markdown','fountain','json']){
      const response=await fetch(`${base}/${p.id}/export?format=${format}`);
      assert.equal(response.status,200);
      const disposition=decodeURIComponent(response.headers.get('content-disposition')!);
      assert.match(disposition,/attachment;/);assert.ok(disposition.includes(`交付_钥匙.${format==='markdown'?'md':format}`));assert.doesNotMatch(disposition,/-v\d+/);
      const text=await response.text();assert.match(text,/新稿：把钥匙装进口袋/);assert.doesNotMatch(text,/旧稿：把钥匙留在桌上/);
      if(format==='json')assert.deepEqual(JSON.parse(text),current);
    }
    for(const revision of ['1','2','999','0','-1','1.5','NaN','1&revision=2','9007199254740992']){
      const response=await fetch(`${base}/${p.id}/export?format=json&revision=${revision}`);
      assert.equal(response.status,400);assert.equal(response.headers.get('content-disposition'),null);
    }
    assert.deepEqual(repo.getProject(p.id),current);
    assert.equal(authorHistoryCount(db),0);
    const filename=scriptExportFilename({title:'长标题🎬'.repeat(30)},'fountain',true);
    assert.ok(Buffer.byteLength(filename)<=255);assert.match(filename,/-未保存草稿\.fountain$/);assert.doesNotThrow(()=>encodeURIComponent(filename));
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});
test('Agent 草稿 HTTP 闭环：草稿隔离、手写返回、完成后采用',async()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();const app=express();app.use(express.json());registerScriptRoutes(app,repo);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/scripts`;
  const send=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const p=repo.saveProject(project(),0);
    const created=await send(`/${p.id}/agent-runs`,{unitId:p.units[0].id,goal:'写出渡口的选择',strategy:'write_existing',maxScenes:1,workspace:'draft'});
    assert.equal(created.status,201);let {run}=await created.json();
    assert.equal((await (await fetch(`${base}/${p.id}/agent-runs/${run.id}/draft`)).json()).project.revision,p.revision);
    run=(await (await send(`/${p.id}/agent-runs/${run.id}/transition`,{action:'resume',expectedVersion:run.version})).json()).run;
    const jobResponse=await send(`/${p.id}/jobs`,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'只写本场动作',expectedRevision:p.revision,agentRunId:run.id});
    assert.equal(jobResponse.status,201);const {job}=await jobResponse.json();
    run=(await (await send(`/${p.id}/agent-runs/${run.id}/transition`,{action:'attach',expectedVersion:run.version,jobId:job.id})).json()).run;
    for(let index=0;index<101;index++)repo.createJob(p.id,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:`历史列表截断样例 ${index}`,expectedRevision:p.revision});
    assert.equal(repo.listJobs(p.id).some(item=>item.id===job.id),false);
    assert.equal((await (await fetch(`${base}/${p.id}/jobs/${job.id}`)).json()).job.id,job.id);
    const submitted=await send(`/${p.id}/jobs/${job.id}/result`,{rawResult:JSON.stringify({summary:'用行动决定',blocks:[{type:'action',text:'她将渡口的灯重新打开。'}]}),provenance:{source:'manual_external',provider:'self_written',modelId:'fixture'}});
    assert.equal((await submitted.json()).job.status,'ready');
    assert.equal((await send(`/${p.id}/jobs/${job.id}/approve`,{})).status,200);
    assert.equal((await (await fetch(`${base}/${p.id}`)).json()).project.revision,p.revision);
    assert.match(exportText((await (await fetch(`${base}/${p.id}/agent-runs/${run.id}/draft`)).json()).project,'fountain'),/重新打开/);
    run=(await (await send(`/${p.id}/agent-runs/${run.id}/transition`,{action:'advance',expectedVersion:run.version})).json()).run;
    const draft=repo.getAgentDraft(p.id,run.id);
    const review=repo.createJob(p.id,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'检查动作因果',expectedRevision:draft.revision,reviewSceneIds:run.sceneIds,agentRunId:run.id});
    run=repo.transitionAgentRun(p.id,run.id,{action:'attach',expectedVersion:run.version,jobId:review.id});
    repo.submitJob(p.id,review.id,JSON.stringify({summary:'动作成立，动机可再核对',findings:[{sceneId:run.sceneIds[0],issue:'“她将渡口的灯重新打开”没有交代促使她回头的线索。',suggestion:'可在前文补一处她听见求助的声音。'}]}),{source:'manual_external',provider:'self_written',modelId:'fixture'});
    run=repo.transitionAgentRun(p.id,run.id,{action:'advance',expectedVersion:run.version});
    const decision=await send(`/${p.id}/jobs/${review.id}/findings/0/decision`,{status:'later',note:'作者先看完整片节奏'});
    assert.equal(decision.status,200);
    assert.equal((await decision.json()).job.reviewDecisions[0].status,'later');
    assert.equal((await (await fetch(`${base}/${p.id}`)).json()).project.revision,p.revision);
    assert.equal(repo.getJob(p.id,review.id).reviewDecisions?.[0]?.note,'作者先看完整片节奏');
    const reviewHistory=await fetch(`${base}/${p.id}/agent-runs/${run.id}/reviews`);
    assert.equal(reviewHistory.status,200);
    assert.equal((await reviewHistory.json()).jobs[0].reviewDecisions[0].status,'later');
    const reviewBaseline=await fetch(`${base}/${p.id}/jobs/${review.id}/input`);
    assert.equal(reviewBaseline.status,200);
    assert.match(exportText((await reviewBaseline.json()).project,'markdown'),/她将渡口的灯重新打开/);
    assert.doesNotMatch(exportText((await (await fetch(`${base}/${p.id}/agent-runs/${run.id}/input`)).json()).project,'markdown'),/她将渡口的灯重新打开/);
    assert.equal((await send(`/${p.id}/jobs/${review.id}/findings/9/decision`,{status:'keep'})).status,400);
    assert.equal((await send(`/${p.id}/jobs/${review.id}/findings/0/decision`,{status:'invented'})).status,400);
    const concurrent=repo.getProject(p.id)!;
    concurrent.title='作者同期修改的标题';
    repo.saveProject(concurrent,concurrent.revision);
    assert.equal((await send(`/${p.id}/agent-runs/${run.id}/publish`,{expectedVersion:run.version,expectedPublishedRevision:p.revision})).status,409);
    const published=await send(`/${p.id}/agent-runs/${run.id}/publish`,{expectedVersion:run.version,expectedPublishedRevision:p.revision+1});
    assert.equal(published.status,200);
    const adopted=(await published.json()).project;
    assert.equal(adopted.revision,p.revision+2);
    assert.equal(adopted.title,'作者同期修改的标题');
    assert.match(exportText(adopted,'fountain'),/重新打开/);
    assert.equal((await (await fetch(`${base}/${p.id}`)).json()).project.revision,p.revision+2);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}
});

test('旧剧本实现和设计入口不再参与运行',()=>{
  for(const path of ['packages/writing','apps/web/src/features/writing','src/features/writing','src/domains/writing','src/services/writing','src/pages/Writing.tsx','src/config/prompts/script.ts','src/server/interactiveWritingAuthoringPort.ts','src/server/writingAgentAIProvider.ts','src/hooks/useScriptAI/utils.ts','src/components/interactive/whiteboard/InteractiveWritingReview.tsx'])assert.equal(existsSync(path),false,path);
  const server=readFileSync('server.ts','utf8');assert.doesNotMatch(server,/createWritingAgentScheduler|registerWritingRoutes|ensureWritingSchema/);
  assert.match(server,/registerScriptRoutes/);
});

test('空场卡与备注不伪装成已写正文，导出保持原单元/场次顺序',()=>{
 const p=project();p.units[0].scenes[0].purpose='只有计划';assert.equal(createScriptDelivery(p).units.length,0);
 p.units[0].scenes.push({...structuredClone(p.units[0].scenes[0]),id:'written',title:'第二场',blocks:[{id:'writtenBlock',type:'action',text:'她把钥匙还了回去。'}]});
 const d=createScriptDelivery(p);assert.equal(d.units[0].scenes!.length,1);assert.equal(d.units[0].scenes![0].index,2);assert.doesNotMatch(d.units[0].prose!,/第 1 场/);
});

import { createLegacyProductionProjectFromWritingSource } from '../src/services/production/writingExportLegacyAdapter';
import { createProductionScriptWorkspace, resolveProductionScriptConflictKeepingProduction, currentProductionScriptRevision } from '../src/services/production/productionScriptWorkspace';
test('保留制片改稿会解除自动同步，源剧本及历史不被修改',()=>{
  const p=project();p.units[0].scenes[0].blocks[0].text='林遥收起钥匙。';
  const source=JSON.stringify(p);
  const production=createLegacyProductionProjectFromWritingSource({package:createScriptDelivery(p),productionProjectId:'production-test',importId:'import-test'});
  const workspace=createProductionScriptWorkspace(production,production.productionSourceDocuments||[]);
  workspace.syncStatus='conflict';
  const before=JSON.stringify(workspace);
  const result=resolveProductionScriptConflictKeepingProduction(production,workspace);
  assert.equal(result.workspace.authority,'production');assert.equal(result.workspace.syncPolicy,'manual');assert.equal(result.workspace.writingProjectId,undefined);
  assert.equal(result.workspace.revisions.length,workspace.revisions.length+1);
  assert.equal(currentProductionScriptRevision(result.workspace)?.units[0].content,currentProductionScriptRevision(workspace)?.units[0].content);
  assert.equal(JSON.stringify(workspace),before);assert.equal(JSON.stringify(p),source);
});

import { projectInteractiveAuthoringStatus } from '../src/services/interactive/interactiveAuthoringStatusProjection';
test('旧自动写作任务不阻塞新编辑器，也不再显示自动编剧操作',()=>{
  const db=new Database(':memory:');
  try {
    const repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0);
    const input={
      aggregate:{experience:{storySource:{writingProjectId:p.id}},graph:{nodes:[]},bindings:[]},
      coordination:{experienceId:'experience',executionPolicy:'autopilot',paused:false,adoptionRuns:[],updatedAt:'2026-09-20',taskRefs:[{owner:'writing',taskId:'retired',purpose:'按全图方案补齐分支剧本',dependsOn:[],inputFingerprint:'old',idempotencyKey:'old',status:'working'}]},
      latestContentPlan:null,writingPort:createInteractiveWritingPort(repo),
    } as Parameters<typeof projectInteractiveAuthoringStatus>[0];
    const empty=projectInteractiveAuthoringStatus(input);
    assert.equal(empty.writing.state,'idle');assert.equal(empty.nextActionLabel,'打开剧本工作区');
    p.units[0].scenes[0].blocks[0].text='林遥交还钥匙。';repo.saveProject(p,p.revision);
    const written=projectInteractiveAuthoringStatus(input);
    assert.equal(written.writing.state,'ready');assert.equal(written.nextAction,'prepare_content');
    assert.equal(input.coordination.taskRefs[0].status,'working');
  } finally { db.close(); }
});

test('T28：片头片尾范围独立统计，完整跨度与版本证据保持不变',()=>{
  const p=project(),unit=p.units[0],hash=unitContentHash(p,unit);
  const timeline=[item({endMs:128000,contentHash:hash,scope:'story'}),item({id:'credits',startMs:120000,endMs:138000,contentHash:hash,scope:'credits'})];
  const full=analyseTimeline(timeline,300000,hash,{includeCredits:true});
  const story=analyseTimeline(timeline,300000,hash,{includeCredits:false});
  assert.equal(full.spanMs,138000);assert.equal(story.spanMs,full.spanMs);
  assert.equal(full.coverageMs,138000);assert.equal(story.coverageMs,128000);
  assert.equal(story.fullCoverageMs,138000);assert.equal(story.creditsCoverageMs,18000);
  assert.equal(story.gapToTargetMs,172000);assert.equal(story.tracks.V1,128000);
  p.profile.includeCredits=false;assert.equal(unitContentHash(p,unit),hash);
  assert.equal(story.staleCount,0);assert.equal(story.measured,false);
  assert.equal(analyseTimeline([item()],300000,'hash',{includeCredits:false}).coverageMs,128000,'早期 v1 片段默认为故事正文');
  assert.throws(()=>parseTimelineItem({...item(),scope:'unknown'}),/scope/);
});
test('容差独立于内容缺口；超时可诊断但不会转为创作通过',()=>{
  for(const [duration,status] of [[284000,'under'],[285000,'within'],[315000,'within'],[316000,'over']] as const){
    const result=analyseTimeline([item({endMs:duration})],300000,'hash',{toleranceMs:15000});
    assert.equal(result.rangeStatus,status);assert.equal(result.creativeAccepted,false);
    assert.equal(result.overTargetMs,Math.max(0,duration-300000));
  }
  for(const toleranceMs of [-1,0.5,300001])assert.throws(()=>analyseTimeline([],300000,undefined,{toleranceMs}),/允许偏差/);
});
test('片头、占位、过期、备选均不能补足故事范围',()=>{
  const result=analyseTimeline([item({endMs:10000}),item({id:'credits',endMs:300000,scope:'credits'}),item({id:'placeholder',endMs:300000,kind:'placeholder'}),item({id:'stale',endMs:300000,contentHash:'old'}),item({id:'take',endMs:600000,included:false})],300000,'hash',{includeCredits:false});
  assert.equal(result.coverageMs,10000);assert.equal(result.spanMs,300000);assert.equal(result.staleCount,1);assert.equal(result.rangeStatus,'under');
});

test('P1B：真实回填合同、持久化预览、原子批准与重复批准幂等',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();
  const p=repo.saveProject(project(),0),u=p.units[0],s=u.scenes[0];
  const job=repo.createJob(p.id,{operation:'scene',unitId:u.id,sceneId:s.id,prompt:'确认后的提示词',expectedRevision:p.revision});
  const raw=JSON.stringify({summary:'用行动代替解释',blocks:[{type:'action',text:'林遥把钥匙按在桌面上。'}]});
  const provenance={source:'manual_external',provider:'manual_external',modelId:'manual_external'};
  assert.equal(repo.submitJob(p.id,job.id,raw,provenance).status,'ready');
  assert.equal(repo.getProject(p.id)!.units[0].scenes[0].blocks[0].text,'');
  assert.equal(createScriptRepository(db).listJobs(p.id)[0].prompt,'确认后的提示词');
  const adopted=repo.transition(p.id,job.id,'approve');
  assert.equal(adopted.project!.revision,2);assert.equal(adopted.project!.units[0].scenes[0].blocks[0].text,'林遥把钥匙按在桌面上。');
  assert.equal(repo.transition(p.id,job.id,'approve').project!.revision,2);
  const current=repo.saveProject({...adopted.project!,title:'作者采用后继续修改'},adopted.project!.revision);
  assert.deepEqual(repo.transition(p.id,job.id,'approve').project,current);
  assert.deepEqual(repo.getProject(p.id),current);
  assert.equal(authorHistoryCount(db),0);assert.equal(repo.getJobInput(p.id,job.id).units[0].scenes[0].blocks[0].text,'');
  repo.deleteProject(p.id);assert.equal(repo.readProjectInput(p.id,p.revision),null);assert.throws(()=>repo.transition(p.id,job.id,'approve'),/不存在/);assert.equal(repo.getProject(p.id),null);db.close();
});
test('P1B：错误 JSON、越权字段和未知人物保留返回原文，取消拒收迟到结果',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0),u=p.units[0];
  const start=()=>repo.createJob(p.id,{operation:'scene',unitId:u.id,sceneId:u.scenes[0].id,prompt:'写作',expectedRevision:p.revision});
  const source={source:'api',provider:'test-stub',modelId:'test-stub'};
  for(const raw of ['{"summary":',JSON.stringify({summary:'修改',facts:[],blocks:[]}),JSON.stringify({summary:'修改',blocks:[{type:'dialogue',text:'你好',speakerId:'ghost'}]})]){
    const job=start(),result=repo.submitJob(p.id,job.id,raw,source);assert.equal(result.status,'failed');assert.equal(result.rawResult,raw);assert.throws(()=>repo.transition(p.id,job.id,'approve'));
  }
  const cancelled=start();repo.transition(p.id,cancelled.id,'cancel');assert.throws(()=>repo.submitJob(p.id,cancelled.id,'{}',source),/迟到/);assert.equal(repo.getProject(p.id)!.revision,1);db.close();
});
test('P1B：生成与批准均检查基线；诊断不能直接写入',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0),u=p.units[0];
  const start=(operation:'scene'|'review'|'outline')=>repo.createJob(p.id,{operation,unitId:u.id,sceneId:u.scenes[0].id,prompt:'写作',expectedRevision:p.revision});
  const source={source:'manual_external',provider:'manual_external',modelId:'manual_external'};
  const outline=start('outline');repo.submitJob(p.id,outline.id,JSON.stringify({summary:'推进选择',outline:'林遥归还钥匙。'}),source);
  const review=start('review');repo.submitJob(p.id,review.id,JSON.stringify({summary:'需要补充动机',findings:[{sceneId:u.scenes[0].id,issue:'行动没有动机',suggestion:'补充她的目标'}]}),source);assert.throws(()=>repo.transition(p.id,review.id,'approve'),/没有可采用/);
  const pending=start('scene');p.brief.theme='信任';repo.saveProject(p,p.revision);
  assert.throws(()=>repo.transition(p.id,outline.id,'approve'),/基线/);assert.match(repo.submitJob(p.id,pending.id,'{}',source).error!,/基线/);
  db.close();
});

test('P1B 局部改写：只替换连续选区，未选正文和场景卡逐字保留',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();const draft=project(),scene=draft.units[0].scenes[0];
  scene.purpose='保留场景意图';scene.blocks=[{id:'left',type:'action',text:'父亲把钥匙收起来。'},{id:'middle',type:'action',text:'林遥站着。'},{id:'right',type:'action',text:'雨声变大。'}];
  const p=repo.saveProject(draft,0),u=p.units[0];
  const job=repo.createJob(p.id,{operation:'rewrite',unitId:u.id,sceneId:scene.id,blockIds:['middle'],prompt:'只改中间',expectedRevision:1});
  repo.submitJob(p.id,job.id,JSON.stringify({summary:'让犹豫可见',blocks:[{type:'action',text:'林遥伸出手，又缩了回去。'}]}),{source:'manual_external',provider:'manual_external',modelId:'manual_external'});
  const result=repo.transition(p.id,job.id,'approve').project!.units[0].scenes[0];
  assert.deepEqual(result.blocks[0],scene.blocks[0]);assert.deepEqual(result.blocks[2],scene.blocks[2]);assert.equal(result.blocks[1].text,'林遥伸出手，又缩了回去。');assert.equal(result.purpose,scene.purpose);db.close();
});
test('P1B 局部范围：拒绝跨场、重复、空和不连续选区，在模型请求前失败',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();const draft=project(),scene=draft.units[0].scenes[0];
  scene.blocks=['a','b','c'].map(id=>({id,type:'action',text:id}));const p=repo.saveProject(draft,0);
  for(const blockIds of [[],['missing'],['a','a'],['a','c']]) assert.throws(()=>repo.createJob(p.id,{operation:'rewrite',unitId:p.units[0].id,sceneId:scene.id,blockIds,prompt:'局部改写',expectedRevision:1}),/正文块/);
  assert.equal(repo.listJobs(p.id).length,0);db.close();
});
test('P1B 补交：重开仓库恢复任务，保留错误原文与成功返回；过期任务不可补交',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();const p=repo.saveProject(project(),0),u=p.units[0];
  const job=repo.createJob(p.id,{operation:'scene',unitId:u.id,sceneId:u.scenes[0].id,prompt:'原始提示词',expectedRevision:1});
  const source={source:'manual_external',provider:'manual_external',modelId:'manual_external'};
  repo.submitJob(p.id,job.id,'不完整的返回',source);
  const reopened=createScriptRepository(db);assert.equal(reopened.getJob(p.id,job.id).status,'failed');
  const raw=JSON.stringify({summary:'修正结构',blocks:[{type:'action',text:'她放下钥匙。'}]});
  const recovered=reopened.submitJob(p.id,job.id,raw,source);assert.equal(recovered.status,'ready');assert.equal(recovered.attempts?.length,2);assert.equal(recovered.attempts![0].rawResult,'不完整的返回');assert.ok(recovered.attempts![0].error);assert.equal(recovered.error,undefined);
  assert.equal(reopened.submitJob(p.id,job.id,raw,source).attempts!.length,2);
  const next=repo.createJob(p.id,{operation:'scene',unitId:u.id,sceneId:u.scenes[0].id,prompt:'另一个等待任务',expectedRevision:1});
  repo.transition(p.id,job.id,'approve');assert.match(reopened.submitJob(p.id,next.id,raw,source).error!,/基线/);db.close();
});

test('剧本模块移除媒体预演，保留写作时长能力',()=>{
  for(const file of ['apps/api/src/media/scriptAudio.ts','apps/web/src/features/script/ScriptAudio.tsx'])assert.equal(existsSync(file),false);
  const workspace=readFileSync('apps/web/src/features/script/ScriptWorkspace.tsx','utf8');assert.match(workspace,/ScriptTiming/);assert.doesNotMatch(workspace,/ScriptAudio/);
  const routes=readFileSync('apps/api/src/routes/scriptRoutes.ts','utf8');assert.doesNotMatch(routes,/measureScriptAudio|units\/:unitId\/audio/);
  const p=project();assert.equal(p.profile.targetDurationMs,300000);assert.deepEqual(analyseTimeline([item()],300000).coverageMs,128000);
});

test('三集独立单元：同名人物按 ID 隔离；共享人物和显式故事组可继承',async()=>{
  const {newUnit}=await import('../packages/script/src/project');const {unitCharacters,unitFacts,writingContext}=await import('../packages/script/src/continuity');
  const p=project();p.profile.organization='episodic';p.profile.continuity='anthology';p.profile.plannedUnits=3;
  p.units=[newUnit('甲故事',300000),newUnit('乙故事',300000),newUnit('乙故事续集',300000)];const [a,b,c]=p.units;c.scopeId=b.scopeId;
  const character=(id:string,scopeId:string)=>({id,name:'小林',scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''});
  p.characters=[character('lin_a',a.scopeId),character('lin_b',b.scopeId),{...character('shared',p.id),name:'旁观者'}];
  p.facts=[{id:'secret_a',scopeId:a.scopeId,text:'甲的秘密',status:'approved'},{id:'secret_b',scopeId:b.scopeId,text:'乙的秘密',status:'approved'}];
  assert.deepEqual(unitCharacters(p,a).map(x=>x.id),['lin_a','shared']);assert.deepEqual(unitCharacters(p,c).map(x=>x.id),['lin_b','shared']);assert.deepEqual(unitFacts(p,c).map(x=>x.id),['secret_b']);
  assert.equal(screenplayTextToBlocks('小林\n我认得这把钥匙。',unitCharacters(p,c)).blocks[0].speakerId,'lin_b');
  assert.doesNotMatch(JSON.stringify(writingContext(p,a)),/甲故事续集|乙的秘密|lin_b/);assert.deepEqual(writingContext(p,b).otherUnits.map(u=>u.id),[c.id]);assert.equal(parseScriptProject(p).characters.length,3);
});
test('人物作用域越界会定位到场景，模型请求与返回均阻断，改稿不丢失',async()=>{
  const {newUnit}=await import('../packages/script/src/project');const {continuityDiagnostics}=await import('../packages/script/src/continuity');
  const {createScriptJob,parseScriptResult}=await import('../packages/script/src/proposals');
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=2;p.units=[newUnit('一',300000),newUnit('二',300000)];const [a,b]=p.units;
  p.characters=[{id:'foreign',name:'小林',scopeId:b.scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''}];
  const input={operation:'scene' as const,unitId:a.id,sceneId:a.scenes[0].id,prompt:'写本场',expectedRevision:0};const job=createScriptJob(p,input);
  assert.throws(()=>parseScriptResult(JSON.stringify({summary:'对白',blocks:[{type:'dialogue',speakerId:'foreign',text:'我知道秘密。'}]}),p,job),/不属于本故事/);
  a.scenes[0].blocks[0]={id:'kept',type:'dialogue',speakerId:'foreign',text:'保留用户原稿'};
  assert.equal(continuityDiagnostics(p,a)[0].sceneId,a.scenes[0].id);assert.throws(()=>createScriptJob(p,input),/作用域/);assert.equal(parseScriptProject(p).units[0].scenes[0].blocks[0].text,'保留用户原稿');
  const hash=unitContentHash(p,a);a.scopeId=b.scopeId;assert.notEqual(unitContentHash(p,a),hash);assert.equal(continuityDiagnostics(p,a).length,0);
});
test('固定主角单元剧默认各集独立故事组；非法范围不落库',()=>{
  const p=createScriptProject('固定主角',{...profile,organization:'episodic',continuity:'procedural',plannedUnits:3});
  assert.notEqual(p.units[0].scopeId,p.id);p.facts.push({id:'bad',scopeId:'missing',text:'无来源作用域',status:'draft'});assert.throws(()=>parseScriptProject(p),/作用域不存在/);
});

test('倒叙：角色按故事顺序获得秘密，观众按展示顺序获得信息',async()=>{
  const {sceneContinuity,sceneStateHash}=await import('../packages/script/src/continuity');const {newScene}=await import('../packages/script/src/project');
  const p=project(),u=p.units[0];const reveal=newScene('揭露'),flashback=newScene('倒叙'),aftermath=newScene('后果');reveal.storyOrder=20;flashback.storyOrder=10;aftermath.storyOrder=30;u.scenes=[reveal,flashback,aftermath];
  p.continuityTracks=[{id:'secret',scopeId:u.scopeId,kind:'knowledge',perspective:'character',label:'证明是假的',characterIds:[],initialValue:'不知道',changes:[{id:'learn',sceneId:reveal.id,value:'知道',reason:'当面看见伪造签名',sourceHash:sceneStateHash(reveal)}]}];
  assert.equal(sceneContinuity(p,u,flashback.id)[0].entry,'不知道');assert.equal(sceneContinuity(p,u,reveal.id)[0].entry,'不知道');assert.equal(sceneContinuity(p,u,reveal.id)[0].exit,'知道');assert.equal(sceneContinuity(p,u,aftermath.id)[0].entry,'知道');
  p.continuityTracks[0].perspective='audience';assert.equal(sceneContinuity(p,u,flashback.id)[0].entry,'知道');
});
test('改稿与缺失依据：状态变更失效，不能越过未确认变化继续宣称已知',async()=>{
  const {sceneContinuity,sceneStateHash}=await import('../packages/script/src/continuity');const {newScene}=await import('../packages/script/src/project');
  const p=project(),u=p.units[0];u.scenes=[newScene('拿钥匙'),newScene('还钥匙'),newScene('最后')];u.scenes.forEach((s,i)=>s.storyOrder=i);
  const [take,give,end]=u.scenes;p.continuityTracks=[{id:'key',scopeId:u.scopeId,kind:'prop',perspective:'character',label:'钥匙持有人',characterIds:[],initialValue:'父亲',changes:[{id:'take',sceneId:take.id,value:'女儿',reason:'拿走钥匙',sourceHash:sceneStateHash(take)},{id:'give',sceneId:give.id,value:'邻居',reason:'交给邻居',sourceHash:sceneStateHash(give)}]}];
  assert.equal(sceneContinuity(p,u,end.id)[0].entry,'邻居');const before=unitContentHash(p,u);take.blocks[0].text='她没有拿走钥匙';const result=sceneContinuity(p,u,end.id)[0];assert.equal(result.status,'needs_review');assert.equal(result.entry,'父亲');assert.match(result.issues.join(),/改稿/);assert.notEqual(unitContentHash(p,u),before);
  u.scenes=u.scenes.filter(s=>s.id!==take.id);assert.match(sceneContinuity(p,u,end.id)[0].issues.join(),/删除/);assert.doesNotThrow(()=>parseScriptProject(p));
});
test('状态顺序不能猜测；独立故事组不继承关系、道具和伏笔',async()=>{
  const {sceneContinuity,sceneStateHash}=await import('../packages/script/src/continuity');const {newScene,newUnit}=await import('../packages/script/src/project');
  const p=project();p.profile.organization='episodic';p.profile.plannedUnits=3;p.units=[newUnit('一',300000),newUnit('二',300000),newUnit('三',300000)];const [a,b,c]=p.units;c.scopeId=a.scopeId;a.scenes[0].storyOrder=10;c.scenes[0].storyOrder=20;
  p.continuityTracks=[{id:'thread',scopeId:a.scopeId,kind:'thread',perspective:'character',label:'钥匙伏笔',characterIds:[],initialValue:'未埋下',changes:[{id:'plant',sceneId:a.scenes[0].id,value:'已埋下，待回收',reason:'钥匙掉进抽屉',sourceHash:sceneStateHash(a.scenes[0])}]}];
  assert.equal(sceneContinuity(p,b,b.scenes[0].id).length,0);assert.equal(sceneContinuity(p,c,c.scenes[0].id)[0].entry,'已埋下，待回收');
  c.scenes[0].storyOrder=10;assert.equal(sceneContinuity(p,c,c.scenes[0].id)[0].status,'needs_review');delete c.scenes[0].storyOrder;assert.match(sceneContinuity(p,c,c.scenes[0].id)[0].issues.join(),/未填写故事顺序/);
  c.scenes[0].storyOrder=1.5;assert.throws(()=>parseScriptProject(p),/storyOrder/);
});

test('跨集伏笔：期限按展示顺序，明确关联回收，不从状态文字猜测',()=>{
  const {p,track}=serialThread();const [a,b,c]=p.units;
  const before=JSON.stringify(p);
  assert.equal(threadDiagnostics(p,a)[0].status,'open');
  assert.equal(threadDiagnostics(p,b)[0].status,'due');
  assert.equal(threadDiagnostics(p,c)[0].status,'overdue'); // Even with a confirmed "opened" change.
  assert.equal(JSON.stringify(p),before);
  track.threadPlan.payoffChangeId='unlock';
  assert.equal(threadDiagnostics(p,b)[0].status,'due'); // A future payoff is not already fulfilled.
  const result=threadDiagnostics(p,c)[0];assert.equal(result.status,'paid_off');assert.match(result.issues.join(),/晚于/);
  c.scenes[0].storyOrder=0;assert.equal(threadDiagnostics(p,c)[0].status,'needs_review'); // Changing evidence requires reconfirmation.
  track.changes[0].sourceHash=sceneStateHash(c.scenes[0]);
  track.threadPlan.dueUnitId=c.id;assert.equal(threadDiagnostics(p,c)[0].status,'paid_off');
  const context=writingContext(p,c);assert.equal(context.continuity.evidenceScenes.length,2);assert.ok(context.continuity.evidenceScenes.some(s=>s.scene.blocks[0].text==='她藏起一把旧钥匙。'));
  assert.doesNotThrow(()=>parseScriptProject(p));
});

test('伏笔依据：改稿、删场和失效变化阻止回收；创作例外不冒充回收',()=>{
  const {p,track}=serialThread();const [a,,c]=p.units;track.threadPlan.payoffChangeId='unlock';
  const oldHash=unitContentHash(p,c);a.scenes[0].blocks[0].text='她从未见过钥匙。';
  assert.notEqual(unitContentHash(p,c),oldHash);assert.equal(threadDiagnostics(p,c)[0].status,'needs_review');
  track.threadPlan.waiver='有意让观众保留疑问';assert.equal(threadDiagnostics(p,c)[0].status,'needs_review');
  track.threadPlan.setupSourceHash=sceneStateHash(a.scenes[0]);assert.equal(threadDiagnostics(p,c)[0].status,'waived');
  track.threadPlan.waiver='';track.changes[0].sourceHash='';assert.equal(threadDiagnostics(p,c)[0].status,'needs_review');
  track.changes=[];assert.match(threadDiagnostics(p,c)[0].issues.join(),/已删除/);
  a.scenes=[];assert.match(threadDiagnostics(p,c)[0].issues.join(),/埋设场景已删除/);
  assert.doesNotThrow(()=>parseScriptProject(p)); // Repairable historical references survive save/reload.
});

test('季与故事线：范围继承、关联诊断、输入校验和旧稿兼容',()=>{
  const {p}=serialThread();const [a,b,c]=p.units;
  p.seasons=[{id:'season_1',title:'第一季',arc:'从互相怀疑到共同承担'}];a.seasonId=b.seasonId='season_1';
  p.characters=[{id:'lin',scopeId:'season_1',name:'小林',desire:'',need:'',contradiction:'',arc:'',voice:''}];
  p.storylines=[{id:'line_a',scopeId:'season_1',lane:'A',title:'寻找写信人',premise:'谁留下钥匙',resolution:'父亲留下退路'}];
  a.scenes[0].storylineIds=['line_a'];
  assert.equal(unitCharacters(p,b).length,1);assert.equal(unitCharacters(p,c).length,0);
  assert.equal(writingContext(p,b).storylines.length,1);assert.equal(writingContext(p,c).storylines.length,0);
  c.scenes[0].storylineIds=['line_a'];assert.match(storylineDiagnostics(p,c)[0].message,/不属于/);
  assert.doesNotThrow(()=>parseScriptProject(p)); // Scope changes preserve the writer's associations for repair.
  const invalid=structuredClone(p);invalid.units[0].seasonId='missing';assert.throws(()=>parseScriptProject(invalid),/所属季不存在/);
  invalid.units[0].seasonId='season_1';invalid.units[0].scenes[0].storylineIds=['missing'];assert.throws(()=>parseScriptProject(invalid),/故事线引用不存在/);
  assert.doesNotThrow(()=>parseScriptProject(project()));
  const db=new Database(':memory:');try{const repo=createScriptRepository(db);repo.ensureSchema();const saved=repo.saveProject(p,p.revision);assert.deepEqual(repo.getProject(p.id)?.storylines,saved.storylines);}finally{db.close();}
});

test('伏笔的季范围与非法期限不跨独立单元；不改变原始正文',()=>{
  const {p,track}=serialThread();const [a,b,c]=p.units;
  p.seasons=[{id:'s1',title:'第一季',arc:''}];a.seasonId=b.seasonId='s1';track.scopeId='s1';
  const text=JSON.stringify(p.units.map(u=>u.scenes));assert.equal(threadDiagnostics(p,c).length,0);
  track.threadPlan.payoffChangeId='unlock';assert.match(threadDiagnostics(p,b)[0].issues.join(),/回收场景不属于/);
  delete track.threadPlan.payoffChangeId;track.threadPlan.dueUnitId=c.id;assert.match(threadDiagnostics(p,b)[0].issues.join(),/回收期限不属于/);
  track.threadPlan.dueUnitId=a.id;track.threadPlan.setupSceneId=b.scenes[0].id;track.threadPlan.setupSourceHash=sceneStateHash(b.scenes[0]);
  assert.match(threadDiagnostics(p,b)[0].issues.join(),/早于/);assert.equal(JSON.stringify(p.units.map(u=>u.scenes)),text);
});

test('先展示回收的创作例外需显式理由，不能掩盖改稿失效',()=>{
  const {p,track}=serialThread();const [a,,c]=p.units;
  track.threadPlan.setupSceneId=c.scenes[0].id;track.threadPlan.setupSourceHash=sceneStateHash(c.scenes[0]);track.threadPlan.dueUnitId=c.id;
  track.changes[0].sceneId=a.scenes[0].id;track.changes[0].sourceHash=sceneStateHash(a.scenes[0]);track.threadPlan.payoffChangeId='unlock';
  assert.equal(threadDiagnostics(p,c)[0].status,'needs_review');track.threadPlan.waiver='开场先展示结果，结尾倒叙交代钥匙来源';
  assert.equal(threadDiagnostics(p,c)[0].status,'waived');a.scenes[0].blocks[0].text='改稿后需重审';assert.equal(threadDiagnostics(p,c)[0].status,'needs_review');
});

test('Skill 未选用时不加载方法或辅助记录，选用连续性也不夹带结构记录',()=>{
  const {p}=serialThread(),u=p.units[0];
  p.storylines=[{id:'line',scopeId:p.id,lane:'A',title:'结构秘密',premise:'',resolution:''}];
  p.units.forEach(unit=>unit.scenes[0].storylineIds=['line']);
  p.methods=[{id:'m',title:'核对',version:'1',content:'按正文证据核对',usage:{operations:['review'],inputs:['continuity'],note:'保留歧义'}}];
  const original=JSON.stringify(p);
  const plain=buildScriptTaskContext(p,u,'review',[]);
  assert.deepEqual(plain.methods,[]);assert.deepEqual(plain.inputs,[]);
  assert.match(plain.instructions,/未选用 Skill/);
  assert.equal(plain.context.continuity,undefined);assert.equal(plain.context.storylines,undefined);
  assert.ok(!JSON.stringify(plain.context).includes('storylineIds'));assert.ok(!JSON.stringify(plain.context).includes('storyOrder'));
  const selected=buildScriptTaskContext(p,u,'review',['m']);
  assert.match(selected.instructions,/按正文证据核对/);assert.match(selected.instructions,/保留歧义/);
  assert.ok(JSON.stringify(selected.context).includes('evidenceScenes'));
  assert.ok(!JSON.stringify(selected.context).includes('storylineIds'));assert.ok(!JSON.stringify(selected.context).includes('structureIssues'));
  assert.equal(JSON.stringify(p),original);
  p.methods[0].usage!.inputs=['structure'];
  const structure=buildScriptTaskContext(p,u,'review',['m']);
  assert.equal(structure.context.continuity,undefined);assert.equal(structure.context.storylines?.[0].title,'结构秘密');
});

test('长片单场任务只带目标与邻场正文，其余场保留分场信息和读取范围',()=>{
  const p=project(),u=p.units[0];
  u.scenes=Array.from({length:120},(_,i)=>{
    const scene=newScene(`第 ${i+1} 场`);
    scene.purpose=`第 ${i+1} 场要完成的事`;
    scene.blocks[0].text=`第 ${i+1} 场独有的正文 ${'动作。'.repeat(300)}`;
    return scene;
  });
  const target=u.scenes[60];
  const task=buildScriptTaskContext(p,u,'scene',[],target.id);
  const context=task.context as typeof task.context & {unit:{scenes:Array<{id:string;purpose:string;blocks?:unknown}>};bodyCoverage:{mode:string;sceneIds:string[];omittedSceneCount:number}};
  assert.equal(context.unit.scenes.length,120);
  assert.equal(context.unit.scenes[0].blocks,undefined);
  assert.equal(context.unit.scenes[0].purpose,'第 1 场要完成的事');
  assert.ok(context.unit.scenes[60].blocks);
  assert.deepEqual(context.bodyCoverage.sceneIds,u.scenes.slice(59,62).map(scene=>scene.id));
  assert.equal(context.bodyCoverage.omittedSceneCount,117);
  assert.ok(JSON.stringify(context).length<JSON.stringify(u.scenes).length/3);
  assert.ok(u.scenes[0].blocks[0].text.includes('第 1 场独有的正文'));
  const review=buildScriptTaskContext(p,u,'review',[],target.id,[u.scenes[59].id,target.id]);
  const reviewContext=review.context as typeof context;
  assert.equal(reviewContext.bodyCoverage.mode,'selected_scenes');
  assert.equal(reviewContext.bodyCoverage.omittedSceneCount,118);
  assert.ok(reviewContext.unit.scenes[59].blocks);
  assert.equal(reviewContext.unit.scenes[61].blocks,undefined);
  const plan=buildScriptTaskContext(p,u,'plan',[],target.id);
  const planContext=plan.context as typeof context;
  assert.equal(planContext.bodyCoverage.mode,'last_two_scenes');
  assert.equal(planContext.unit.scenes[0].blocks,undefined);
  assert.ok(planContext.unit.scenes[119].blocks);
});

test('Skill 任务筛选拒绝未知、重复和不适用 ID，兼容旧挂载',()=>{
  const p=project();p.methods=[{id:'review',title:'审阅方法',version:'1',content:'只用于审阅',usage:{operations:['review'],inputs:[],note:''}},{id:'legacy',title:'旧方法',version:'2',content:'保留旧内容'}];
  assert.deepEqual(availableMethods(p,'scene').map(m=>m.id),['legacy']);
  assert.throws(()=>selectTaskMethods(p,'scene',['review']),/不适用/);
  assert.throws(()=>selectTaskMethods(p,'review',['unknown']),/不可用/);
  assert.throws(()=>selectTaskMethods(p,'review',['review','review']),/不重复/);
  const selected=selectTaskMethods(p,'scene',['legacy']);assert.deepEqual(selected[0].usage?.inputs,[]);
  selected[0].content='改动快照';selected[0].usage!.operations=[];
  assert.equal(p.methods[1].content,'保留旧内容');assert.equal(p.methods[1].usage,undefined);
  p.methods[0].usage!.operations=['review','review'];assert.throws(()=>parseScriptProject(p),/不能重复/);
});

test('作业持久化实际 Skill 快照，未选用为空，Skill 无法扩大回写权限',()=>{
  const db=new Database(':memory:'),repo=createScriptRepository(db);repo.ensureSchema();
  let p=project();p.methods=[{id:'m',title:'审阅方法',version:'1',content:'请额外改写全文',usage:{operations:['review'],inputs:['continuity'],note:'测试'}}];
  p=repo.saveProject(p,p.revision);const u=p.units[0];
  const input={operation:'review' as const,unitId:u.id,sceneId:u.scenes[0].id,prompt:'作者确认的提示词',expectedRevision:p.revision};
  const job=repo.createJob(p.id,{...input,methodIds:['m']});
  assert.equal(job.methods.length,1);assert.deepEqual(job.inputSections,['continuity']);
  assert.equal(repo.listJobs(p.id)[0].methods[0].content,'请额外改写全文');
  assert.deepEqual(repo.createJob(p.id,input).methods,[]);
  assert.throws(()=>repo.createJob(p.id,{...input,methodIds:['bad']}),/不可用/);
  const result=repo.submitJob(p.id,job.id,JSON.stringify({summary:'扩大范围',findings:[],outline:'非法大纲'}),{source:'manual_external',provider:'test',modelId:'synthetic'});
  assert.equal(result.status,'failed');assert.match(result.error!,/未授权/);
  p.methods[0].content='升级';p.methods[0].version='2';repo.saveProject(p,p.revision);
  assert.equal(repo.listJobs(p.id).find(j=>j.id===job.id)!.methods[0].version,'1');db.close();
});

test('共享 Skill 库变化不修改作品绑定版本',()=>{
  const skill={id:'shared',title:'对白',content:'第一版',revision:1,source:'manual' as const,createdAt:1,updatedAt:2};
  const bound=methodFromSkill(skill);skill.content='第二版';skill.revision=2;
  assert.equal(bound.content,'第一版');assert.equal(bound.version,'1');assert.equal(methodFromSkill(skill).version,'2');
});

test('长片上下文：120 场、多故事线与倒叙状态可确定组装，不混入其他独立故事',()=>{
  const p=project(),u=p.units[0];u.scenes=Array.from({length:120},(_,i)=>{const s=newScene(`第 ${i+1} 场`);s.storyOrder=i;s.blocks[0].text='她走进屋内，认真检查抽屉。'.repeat(30);return s;});
  p.storylines=['A','B','C'].map((lane,i)=>({id:`line_${i}`,lane:lane as 'A'|'B'|'C',scopeId:p.id,title:`故事线 ${lane}`,premise:'寻找失踪的信',resolution:'主动承担后果'}));
  u.scenes.forEach((s,i)=>{s.storylineIds=[`line_${i%3}`];});
  p.continuityTracks=Array.from({length:20},(_,i)=>({id:`state_${i}`,scopeId:p.id,kind:'knowledge',perspective:'character',label:`秘密 ${i}`,characterIds:[],initialValue:'怀疑',changes:[{id:`learn_${i}`,sceneId:u.scenes[60].id,value:'确知',reason:'看到信件原件',sourceHash:sceneStateHash(u.scenes[60])}]}));
  p.profile.organization='episodic';p.profile.plannedUnits=2;const isolated=newUnit('独立短篇',300000);p.units.push(isolated);
  p.storylines.push({id:'hidden_line',scopeId:isolated.id,lane:'A',title:'其他单元的秘密',premise:'不可混入',resolution:''});
  p.continuityTracks.push({id:'hidden_track',scopeId:isolated.id,kind:'knowledge',perspective:'character',label:'不可继承的秘密',characterIds:[],initialValue:'未知',changes:[{id:'hidden_change',sceneId:isolated.scenes[0].id,value:'独立秘密',reason:'仅本故事',sourceHash:sceneStateHash(isolated.scenes[0])}]});
  const start=performance.now();const context=writingContext(p,u);const ms=performance.now()-start;
  assert.equal(context.continuity.statesByScene.length,120);assert.equal(context.continuity.statesByScene[59].states[0].exit,'怀疑');assert.equal(context.continuity.statesByScene[61].states[0].entry,'确知');
  assert.equal(context.storylines.length,3);assert.ok(ms<2000,`120 场上下文耗时 ${ms.toFixed(0)}ms`);
  assert.ok(!JSON.stringify(context).includes('其他单元的秘密'));assert.equal(context.otherUnits.length,0);
  assert.equal(context.continuity.evidenceScenes.length,1);assert.ok(!JSON.stringify(context).includes('独立秘密'));
  assert.equal(JSON.stringify(context),JSON.stringify(writingContext(p,u)));
});
