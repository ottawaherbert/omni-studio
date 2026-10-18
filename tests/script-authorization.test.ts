import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ResourceRef } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteGoalStore, SqliteBudgetStore } from '../packages/agent-sqlite/src';
import { compileContext, memorySection } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore, type ScriptReadSource } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();const conversations=new SqliteConversationStore(store);conversations.ensureSchema();
 const thread=conversations.open('author','script:home','test'),scripts=createScriptRepository(db);scripts.ensureSchema();
 let contexts:SqliteContextStore,authorizations:ScriptAuthorizationStore;
 const workspaces=new ScriptWorkspaceStore(store,scripts,{assertVersion:(id,rev,phase)=>contexts.assertArtifact('script-workspace-version',`${id}:${rev}`,phase)});workspaces.ensureSchema();
 const doc=createScriptProject('【机械授权测试】',createScriptCreationProfile('tv-series',2,20));
 const original=createScriptProject('【机械前集】',createScriptCreationProfile('tv-series',2,20));original.units.push(newUnit('第二单元',1200000,original.id));original.units[0].scenes[0].blocks[0].text='【协议文本】授权单元A';original.units[1].scenes[0].blocks[0].text='【协议文本】未选单元B';const project=scripts.saveProject(original,0);
 const source:ScriptReadSource={ref:{uri:`resource://script/projects/${project.id}`,version:String(project.revision),contentHash:hashValue(project),branch:'author'},access:{ownerId:'author',scopeId:project.id,branch:'author'},purpose:'PREVIOUS_SCRIPT',unitIds:null};
 contexts=new SqliteContextStore(store,(dep,access)=>{
   if(dep.ref.uri.startsWith('resource://script/read-grants/'))return authorizations.sourceAllowed(dep,access);
   if(dep.ref.uri.startsWith('resource://script/projects/')){
     try{authorizations.assertSourceIntersection({ref:dep.ref,access,purpose:'PREVIOUS_SCRIPT',unitIds:null});}catch{return false;}
     return access.ownerId==='author'&&access.scopeId===project.id&&access.branch==='author'&&hashValue(dep.ref)===hashValue(source.ref)&&!!scripts.getProject(project.id);
   }
   return false;
 });contexts.ensureSchema();
 const workspace=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:doc}});
 authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(scope,w)=>{assert.deepEqual(scope,{documentId:w.documentId});},readSource:s=>{
   assert.equal(s.access.ownerId,'author');
   if(s.purpose==='CONVERSATION'){
     if(!conversations.sourceAllowed(s.ref,s.access.ownerId,s.access.scopeId,refs=>{for(const ref of refs)contexts.assertVisible(ref,s.access);return true;}))throw new Error('Conversation withdrawn');
     return JSON.parse((db.prepare('SELECT data_json FROM agent_conversation_sources WHERE id=?').get(new URL(s.ref.uri).pathname.slice(1)) as any).data_json);
   }
   assert.equal(s.access.scopeId,project.id);assert.ok(scripts.getProject(project.id));const p=scripts.readProjectInput(project.id,Number(s.ref.version))!;assert.ok(p);assert.equal(hashValue(p),s.ref.contentHash);
   if(s.unitIds?.some(id=>!p.units.some(u=>u.id===id)))throw new Error('Unknown selected unit');
   scripts.captureProjectInput(p);
   return {...p,units:p.units.filter(u=>s.unitIds===null||s.unitIds.includes(u.id))};
 }});authorizations.ensureSchema();
 const issue=(commandId:string,sources:ScriptReadSource[]=[])=>authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId,scope:{documentId:workspace.documentId},sources});
 const manual=(name:string,sources:ScriptReadSource[]=[])=>{const a=issue(name,sources),r=store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:name,kind:'CAPABILITY',input:{authorizationRef:a.id},policyRevision:'1',maxInvocations:1});authorizations.bind(a.id,'author',{kind:'RUN',runId:r.runId,inputRevision:1});return {auth:authorizations.read(a.id,'author'),run:store.readRun(r.runId)};};
 return {db,store,scripts,project,thread,workspace,workspaces,contexts,conversations,authorizations,source,issue,manual};
}

test('host-only authority is bound to actual owner/thread/run, frozen source and original idempotency envelope',t=>{
 const h=setup(t),a=h.issue('once',[h.source]);assert.equal(a.binding,null);assert.throws(()=>h.authorizations.grants(a.id,'author'),/尚未/);
 assert.equal(h.issue('once',[h.source]).id,a.id);assert.throws(()=>h.issue('once',[]),/different|不同|重用|重复|同一/i);
 assert.throws(()=>h.authorizations.read(a.id,'other'),/作者/);
 const wrong=h.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'wrong',kind:'CAPABILITY',input:{authorizationRef:'other'},policyRevision:'1',maxInvocations:1});
 assert.throws(()=>h.authorizations.bind(a.id,'author',{kind:'RUN',runId:wrong.runId,inputRevision:1}),/未绑定/);
 const m=h.manual('proper',[{...h.source,unitIds:[h.project.units[0].id]}]);const grant=h.authorizations.grants(m.auth.id,'author')[0],ref=h.authorizations.ref(grant),access={ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`};
 const data=h.authorizations.withRunAuthorization(m.run,'CONSUME',()=>h.authorizations.readGranted(ref,access,'CURRENT').data) as any;
 assert.equal(data.units.length,1);assert.equal(data.units[0].id,h.project.units[0].id);
 assert.equal(h.authorizations.sourceAllowed({ref, freshness:'EXACT'},{...access,ownerId:'another'}),false);
 assert.equal(h.authorizations.sourceAllowed({ref:{...ref,version:'2'},freshness:'EXACT'},access),false);
});

test('old wide summary in a derived memory cannot enter a narrower new run, including recursive source checks',t=>{
 const h=setup(t),wide=h.manual('wide',[h.source]),narrow=h.manual('narrow',[{...h.source,unitIds:[h.project.units[0].id]}]),sameScope=h.manual('same',[h.source]);
 const access={ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`};
 const oldRef=h.authorizations.ref(h.authorizations.grants(wide.auth.id,'author')[0]);
 const first=h.contexts.createMemory(access,'model','old-summary',{key:'summary.first',kind:'DOMAIN_DERIVED',content:{label:'机械派生',value:'【协议摘要】含A和B单元引用'},dependencies:[{ref:oldRef,freshness:'EXACT'}]});
 const second=h.contexts.createMemory(access,'model','second-summary',{key:'summary.second',kind:'DOMAIN_DERIVED',content:{label:'机械派生二层',value:'【协议摘要】二层引用'},dependencies:[{ref:{uri:`resource://memory/${first.id}`,version:'1',contentHash:hashValue(h.contexts.getMemory(first.id,access)),branch:access.branch},freshness:'CURRENT'}]});
 const compiled=compileContext({systemInstruction:'机械闭包验证',skills:[],sections:[memorySection(h.contexts.getMemory(second.id,access))]});
 const ref=h.contexts.capture(access,compiled);
 assert.throws(()=>h.authorizations.withRunAuthorization(narrow.run,'CONSUME',()=>h.contexts.assertVisible(ref,access)),/来源/);
 assert.doesNotThrow(()=>h.authorizations.withRunAuthorization(sameScope.run,'CONSUME',()=>h.contexts.assertVisible(ref,access)));
 assert.throws(()=>h.authorizations.withRunAuthorization(sameScope.run,'CONSUME',()=>h.authorizations.withRunAuthorization(narrow.run,'VIEW',()=>h.contexts.assertVisible(ref,access))));
 // Nested throw and an accidentally async callback cannot retain an authorization frame.
 assert.throws(()=>h.authorizations.withRunAuthorization(narrow.run,'VIEW',()=>Promise.resolve('wrong')),/同步/);
 assert.doesNotThrow(()=>h.contexts.assertVisible(ref,access));
});

test('direct original project dependency cannot bypass the current source unit intersection',t=>{
 const h=setup(t),narrow=h.manual('narrow',[{...h.source,unitIds:[h.project.units[0].id]}]);
 const compiled=compileContext({systemInstruction:'机械直接来源',skills:[],sections:[{id:'original',text:'【机械原稿依赖】',required:true,priority:100,dependencies:[{ref:h.source.ref,freshness:'EXACT'}]}]});
 const ref=h.contexts.capture(h.source.access,compiled);
 assert.throws(()=>h.authorizations.withRunAuthorization(narrow.run,'VIEW',()=>h.contexts.assertVisible(ref,h.source.access)),/来源/);
});

test('Goal binding and revision freshness are distinct from historical VIEW',t=>{
 const h=setup(t),a=h.issue('goal',[h.source]),goals=new SqliteGoalStore(h.store,new SqliteBudgetStore(h.store));goals.ensureSchema();
 const revision={objective:'机械委托',contract:{pluginId:'mechanical',version:'1',value:{},digest:hashValue({})},authorizationRef:a.id,workspaceRef:workspaceRef(h.workspace),sourceRefs:[h.source.ref],skillManifest:[],route:{channel:'external' as const,routeRef:'mechanical'},stopPolicy:'CONTRACT_COMPLETE' as const,turnLimits:{maxDecisions:2,maxToolCalls:2}};
 const accepted=goals.accept({...revision,ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'goal',requestEnvelope:{once:true},policyRevision:'1',budgetLimits:{maxInvocations:2,maxToolCalls:2,maxTurns:2,maxRepairRounds:1}});
 h.authorizations.bind(a.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:1});const first=h.store.readRun(accepted.runId);assert.equal(h.authorizations.forRun(first).id,a.id);
 const ref=h.authorizations.ref(h.authorizations.grants(a.id,'author')[0]),access={ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`};
 const b=h.issue('revise',[h.source]);goals.revise({goalId:accepted.goalId,ownerId:'author',expectedVersion:goals.read(accepted.goalId,'author').version,expectedRunVersion:first.version,requestId:'revise',requestEnvelope:{revision:2},revision:{...revision,objective:'机械委托修订',authorizationRef:b.id}});h.authorizations.bind(b.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:2});
 assert.equal(h.authorizations.sourceAllowed({ref,freshness:'CURRENT'},access),false);assert.equal(h.authorizations.sourceAllowed({ref,freshness:'EXACT'},access),true);
 assert.doesNotThrow(()=>h.authorizations.withRunAuthorization(h.store.readRun(first.id),'VIEW',()=>h.authorizations.readGranted(ref,access)));
});
