import {registerScriptPlanningRepair,handleScriptPlanningRepair} from './scriptPlanningRepair';
import { registerScriptAssistantStart } from './scriptAssistantStart';
import type Database from 'better-sqlite3';
import { AgentError, ExecutionInvalidated, AgentWorker, AgentChildWorker, DecisionDriver, hashValue, type AgentRun, type ModelRequest, type ModelTransport } from '../../../../packages/agent-core/src';
import { AgentSqliteStore, SqliteContextStore, SqliteModelJournal, SqliteConversationStore, SqliteBudgetStore, SqliteGoalStore, SqliteHistoryStore } from '../../../../packages/agent-sqlite/src';
import { createScriptRepository } from '../repositories/scriptStore';
import { createScriptCapabilityRegistry, scriptImplementationManifest } from './scriptCapabilities';
import { createScriptDraftAuthorization, registerScriptDraftCapabilities } from './scriptDraftCapabilities';
import type { ConversationValidationScope } from './scriptConversation';
import { ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';
import { ScriptDraftStore } from '../repositories/scriptDraftStore';
import type { MethodBinding } from '../../../../packages/script/src/schema';
import { validateScriptDraftScope, type ScriptDraftScope } from '../../../../packages/script/src/agentScope';
import type { ContextAccess, Dependency } from '../../../../packages/agent-context/src';
import { ScriptReviewStore } from '../repositories/scriptReviewStore';
import { createScriptReviewAuthorization, registerScriptReviewCapabilities } from './scriptReviewCapabilities';
import { createScriptReviewPolicy } from './scriptReviewPolicy';
import { createScriptHistoryPolicy, createScriptHistorySourceResolver } from './scriptHistory';
import { createScriptGoalPlugin } from './scriptGoalPlugin';
import { registerScriptReadCapability } from './scriptReadCapability';
import { ScriptCommandService } from './scriptCommands';
import { ScriptMemoryScheduler, conversationTurnSourceAllowed, scriptMemoryRangeAllowed, createScriptMemoryProjection } from './scriptMemory';
import { handleScriptManualDispatch } from './scriptManualDispatch';
import { createScriptConversationReadAuthorization, registerScriptConversationRead } from './scriptConversationRead';

export function createScriptAgentHost(db: InstanceType<typeof Database>, transport: ModelTransport, workerId: string,
  options:{trustedLegacyProjectOwner?:string}={}) {
  const store = new AgentSqliteStore(db); store.ensureSchema();
  let contexts: SqliteContextStore;
  let workspaces: ScriptWorkspaceStore;
  let authorizations: ScriptAuthorizationStore;
  let drafts: ScriptDraftStore;
  let reviews: ScriptReviewStore;
  let history: SqliteHistoryStore;
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  const scripts = createScriptRepository(db, {
    projectChanged: projectId => { contexts.queueSourceInvalidation(projectId); },
    assertAdopt: job => contexts.assertArtifact('script-job', job.id),
    assertInput: job => contexts.assertArtifact('script-job', job.id, 'VIEW'),
    assertLegacyExecution: job => { if (contexts.hasArtifact('script-job', job.id)) throw new AgentError('ENGINE_OWNER_CONFLICT', '此候选由持久任务管理，请通过对应请求继续，不能从旧执行接口重写'); },
    view: job => {
      try { contexts.assertArtifact('script-job', job.id, 'VIEW'); return job; }
      catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return { ...job, prompt: '此任务的上下文已撤回或不可访问。', rawResult: undefined, result: undefined, executionPrompt: undefined, attempts: [], methods: job.methods.map(method => ({ ...method, content: '' })), error: 'CONTEXT_REVOKED：旧返回与提示词已隐藏，当前稿未被修改。' }; }
    },
  }); scripts.ensureSchema();
  let validationDepth = 0;
  // A batch is one synchronous, read-only caller operation. SQLite pins its
  // snapshot and authority memo never survives the return, an await, or a
  // request. Bounded pure content decoding/digests do not carry authority.
  const withConversationValidation: ConversationValidationScope = read => contexts.withValidationBatch(()=>workspaces.withContentReadBatch(()=>history.withValidationBatch(read)));
  const sourceAllowed = (dependency:Dependency,access:ContextAccess,unitIds:string[]|null=null):boolean => {
    const url = new URL(dependency.ref.uri);
    if(url.protocol!=='resource:'||url.username||url.password||url.port||url.search||url.hash)return false;
    if(url.hostname==='script'&&url.pathname.startsWith('/read-grants/'))return authorizations.sourceAllowed(dependency,access);
    if(url.hostname==='conversation-turn')return conversationTurnSourceAllowed(db,contexts,dependency.ref,access);
    if(url.hostname==='agent-history')return Boolean(history)&&createScriptHistorySourceResolver(history)(dependency,access);
    if(url.hostname==='script'&&url.pathname.startsWith('/draft-candidates/'))return Boolean(drafts)&&drafts.sourceAllowed(dependency.ref,access,dependency.freshness);
    if(url.hostname==='script'&&url.pathname.startsWith('/check-receipts/'))return Boolean(reviews)&&reviews.sourceAllowed(dependency.ref,access,dependency.freshness);
    if(url.hostname==='script'&&access.scopeId==='script:home'&&access.branch==='author'){
      const own=/^\/workspaces\/(workspace_[\w-]+)$/.exec(url.pathname);
      if(own){const active=authorizations?.activeAuthorization();
        return (!active||active.workspaceId===own[1])&&workspaces.sourceAllowed(dependency.ref,
          {ownerId:access.ownerId,scopeId:own[1],branch:`workspace:${own[1]}`},dependency.freshness);}
    }
    try { authorizations?.assertSourceIntersection({ref:dependency.ref,access,unitIds,purpose:url.hostname==='conversation'?'CONVERSATION':'PREVIOUS_SCRIPT'}); } catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return false; }
    if (url.hostname === 'script' && url.pathname.startsWith('/workspaces/')) {
      return workspaces.sourceAllowed(dependency.ref, access, dependency.freshness);
    }
    if (url.hostname === 'conversation') return conversations.sourceAllowed(dependency.ref, access.ownerId, access.scopeId, refs => {
      if (++validationDepth > 100) { validationDepth--; return false; }
      try { return contexts.withValidationBatch(()=>{for(const ref of refs)contexts.assertVisible(ref,access);return true;}); }
      catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return false; } finally { validationDepth--; }
    });
    const match = /^\/projects\/([^/]+)$/.exec(url.pathname);
    if (url.hostname !== 'script' || !match || match[1] !== access.scopeId || dependency.ref.branch !== 'author'||access.branch!=='author') return false;
    if(!workspaces.ownsProject(match[1],access.ownerId))return false;
    const current = scripts.getProject(match[1]);
    if (!current) return false;
    const revision=Number(dependency.ref.version);
    if(!Number.isSafeInteger(revision)||revision<1||String(revision)!==dependency.ref.version)return false;
    const project = scripts.readProjectInput(match[1],revision);
    return Boolean(project && hashValue(project) === dependency.ref.contentHash && (dependency.freshness === 'EXACT' || current.revision === project.revision));
  };
  let memoryProjection:ReturnType<typeof createScriptMemoryProjection>|null=null;
  contexts = new SqliteContextStore(store,sourceAllowed,()=>authorizations?.readerDigest()??'',
    (memory,access)=>!authorizations?.activeAuthorization()||('scriptProjection' in memory?
      Boolean(memoryProjection?.allowed(memory,access)):scriptMemoryRangeAllowed(db,workspaces,memory,access,
      (workspaceId,range)=>authorizations.coversMemoryBlock(workspaceId,range))),23_000,true,
    (access,wantedId)=>memoryProjection?.candidates(access,wantedId)??[]); contexts.ensureSchema();
  workspaces = new ScriptWorkspaceStore(store, scripts, {
    trustedLegacyProjectOwner:options.trustedLegacyProjectOwner,
    assertModelWrite: input=>drafts.assertWorkspaceWrite(input),
    bindModelVersion: (workspace,ref)=>contexts.bindEvidenceArtifact('script-workspace-version',`${workspace.id}:${workspace.revision}`,ref,{ownerId:workspace.ownerId,scopeId:workspace.id,branch:`workspace:${workspace.id}`}),
    assertVersion: (id, revision, phase) => authorizations.withHistoricalProvenance(() =>
      contexts.assertArtifact('script-workspace-version', `${id}:${revision}`, phase)),
    validationKey: ()=>authorizations?.readerDigest()??'',
    changed: id => contexts.queueSourceInvalidation(id),
  }); workspaces.ensureSchema();
  const memory = new ScriptMemoryScheduler(db,store,contexts,workspaces,transport);
  authorizations = new ScriptAuthorizationStore(store,workspaces,{
    validateScope:(value,workspace)=>{
      const scope=value as ScriptDraftScope;
      if(scope?.workspaceId!==workspace.id)throw new AgentError('SCRIPT_SCOPE_DENIED','写作范围不属于此工作稿',403);
      validateScriptDraftScope(workspace.document,scope);
    },
    readSource:source=>{
      if(!sourceAllowed({ref:source.ref,freshness:'EXACT'},source.access,source.unitIds))throw new AgentError('CONTEXT_SOURCE_INVALID','已选来源不存在或已撤回');
      const url=new URL(source.ref.uri);
      if(source.purpose==='CONVERSATION'){
        const row=store.db.prepare('SELECT data_json FROM agent_conversation_sources WHERE id=?').get(url.pathname.slice(1)) as any;
        const data=JSON.parse(row.data_json);
        return {kind:'CONVERSATION',ref:source.ref,messages:data.messages,
          ...(data.archive?.version===1?{retrieve:{capabilityId:'script.read_conversation',threadId:data.archive.threadId,
            throughTurnId:data.archive.throughTurnId,totalEntries:data.archive.entries.length}}:{})};
      }
      if(url.pathname.startsWith('/projects/'))workspaces.assertProjectOwner(source.access.scopeId,source.access.ownerId);
      const project=url.pathname.startsWith('/projects/')?scripts.readProjectInput(source.access.scopeId,Number(source.ref.version))!:workspaces.version(source.access.scopeId,source.access.ownerId,Number(source.ref.version));
      if(source.unitIds?.some(id=>!project.units.some(unit=>unit.id===id)))throw new AgentError('SCRIPT_SOURCE_UNIT_MISSING','所选前集不在固定来源中');
      if(url.pathname.startsWith('/projects/'))scripts.captureProjectInput(project);
      const units=project.units.filter(unit=>source.unitIds===null||source.unitIds.includes(unit.id));
      const characterIds=new Set(units.flatMap(unit=>unit.scenes.flatMap(scene=>[...scene.characterIds,...scene.blocks.map(block=>block.speakerId).filter(Boolean)])));
      return {kind:'SCRIPT_BODY',ref:source.ref,projectId:project.id,title:project.title,
        units:units.map(unit=>({id:unit.id,title:unit.title,scenes:unit.scenes.map(scene=>({id:scene.id,title:scene.title,location:scene.location,timeOfDay:scene.timeOfDay,storyTime:scene.storyTime,characterIds:scene.characterIds,blocks:scene.blocks}))})),
        characters:project.characters.filter(character=>characterIds.has(character.id)).map(character=>({id:character.id,name:character.name}))};
    },
  });authorizations.ensureSchema();
  memoryProjection=createScriptMemoryProjection(db,workspaces,authorizations);
  const assertModelInput = (request:ModelRequest, run:AgentRun, phase:'VIEW'|'CONSUME') => {
    if (!request.contextRef) throw new AgentError('CONTEXT_REQUIRED', '剧本模型调用需要冻结上下文');
    const verify=(access:ContextAccess)=>workspaces.withContentReadBatch(()=>{
      const bundle = phase === 'VIEW' ? contexts.assertVisible(request.contextRef!, access) : contexts.assertAllowed(request.contextRef!, access);
      if (bundle.prompt !== request.prompt || bundle.systemInstruction !== (request.systemInstruction || '') || hashValue(bundle.outputSchema ?? {}) !== hashValue(request.outputSchema ?? {})) throw new AgentError('CONTEXT_PAYLOAD_CHANGED', '实际请求未使用冻结上下文');
    });
    const operationKey = request.formatCorrection ? request.operationKey.replace(/:format-correction$/, '') : request.operationKey;
    if(operationKey==='manual-dispatch'||operationKey==='manual-dispatch:history-read'){
      if(run.kind!=='CHAT'||(run.input as any)?.request?.capabilityId!=='script.dispatch')
        throw new AgentError('MANUAL_DISPATCH_SCOPE_DENIED','模型请求不属于作者聊天派发',403);
      verify({ownerId:run.ownerId,scopeId:run.scopeId,branch:'author'});
    }
    else if(run.kind==='GOAL'||(run.input as any)?.authorizationRef){
      authorizations.withRunAuthorization(run,phase,()=>{const auth=authorizations.forRun(run,phase);verify({ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`});});
    }else verify({ ownerId: run.ownerId, scopeId: run.scopeId, branch: 'author' });
  };
  const journal = new SqliteModelJournal(store,assertModelInput,read=>contexts.withValidationBatch(()=>workspaces.withContentReadBatch(()=>history.withValidationBatch(read)))); journal.ensureSchema();
  drafts=new ScriptDraftStore(store,workspaces,authorizations,contexts,journal);drafts.ensureSchema();
  const budgets=new SqliteBudgetStore(store);
  const goals=new SqliteGoalStore(store,budgets,(run,proof)=>contexts.withValidationBatch(()=>authorizations.withRunAuthorization(run,'CONSUME',()=>reviews.verifyCompletionForRun(run,proof))),assertModelInput);goals.ensureSchema();
  reviews=new ScriptReviewStore(store,workspaces,contexts,journal,createScriptReviewPolicy({store,goals,authorizations,workspaces,drafts}));reviews.ensureSchema();
  history=new SqliteHistoryStore(store,goals,createScriptHistoryPolicy({store,contexts,authorizations,assertSource:(ref,access,freshness)=>{
    if(!sourceAllowed({ref,freshness},access))throw new AgentError('CONTEXT_SOURCE_INVALID','历史来源已变化或不可访问');
  }}));history.ensureSchema();
  const commands=new ScriptCommandService({store,conversations,workspaces,authorizations,drafts,goals,scripts});commands.ensureSchema();
  const executionSettings=(runId:string)=>{
    const run=store.readRun(runId),auth=authorizations.forRun(run);
    let value:any;
    if(auth.binding?.kind==='GOAL'){
      const row=store.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision=?').get(auth.binding.goalId,auth.binding.revision) as any;
      const revision=JSON.parse(row.data_json);value={...revision.route,methods:revision.skillManifest,authorRequest:revision.objective};
    }else value=(run.input as any).scriptExecution;
    if(!value||!['api','external'].includes(value.channel)||typeof value.routeRef!=='string'||!value.routeRef||typeof value.authorRequest!=='string'||!Array.isArray(value.methods))throw new AgentError('SCRIPT_EXECUTION_SETTINGS_MISSING','作者命令没有固定模型与 Skill 配置');
    return {...value,methods:value.methods as MethodBinding[]};
  };
  const domainDeps={store,journal,contexts,authorizations,workspaces,drafts,transport,executionSettings};
  const reviewDeps={...domainDeps,reviews},draftAuthorization=createScriptDraftAuthorization(domainDeps),reviewAuthorization=createScriptReviewAuthorization(reviewDeps);
  const registry = createScriptCapabilityRegistry({ store, journal, scripts, transport, contexts, conversations,workspaces,authorizations,withConversationValidation,
    conversationReadAuthorization:createScriptConversationReadAuthorization({store,contexts,conversations,authorizations,implementationDigest:hashValue(scriptImplementationManifest())}),
    domainAuthorization:(spec,...args)=>['script.propose','script.apply_patch'].includes(spec.id)?draftAuthorization(spec,...args):reviewAuthorization(spec,...args) });
  const implementationDigest=hashValue(scriptImplementationManifest());
  registerScriptAssistantStart(registry,{store,journal,contexts,conversations,commands,workspaces,transport,implementationDigest});
  registerScriptConversationRead(registry,{store,contexts,conversations,authorizations,implementationDigest});
  registerScriptDraftCapabilities(registry,domainDeps,implementationDigest);
  registerScriptPlanningRepair(registry,domainDeps,implementationDigest);
  registerScriptReadCapability(registry,domainDeps,implementationDigest);
  registerScriptReviewCapabilities(registry,reviewDeps,implementationDigest);
  store.addSchedulingBypass((candidate,earlier)=>candidate.scopeId==='script:home'&&candidate.kind==='CHAT'&&
    (candidate.input as any)?.request?.capabilityId==='script.converse'&&earlier.kind==='GOAL'&&earlier.status==='WAITING_EXTERNAL');
  store.addThreadReleaseOnWait((run,status)=>status==='WAITING_EXTERNAL'&&run.scopeId==='script:home'&&
    (run.kind==='GOAL'||run.kind==='CHAT'&&(run.input as any)?.request?.capabilityId==='script.converse'));
  store.addLifecycleParticipant(workspaces.lifecycle(run=>{
    if(run.kind==='GOAL'){
      const exists=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_run_links'").get();
      const row=exists?store.db.prepare('SELECT data_json FROM agent_run_links WHERE run_id=?').get(run.id) as any:null;
      // Scheduling only locates the workspace. The capability separately
      // validates the current Goal revision before any read/model/write.
      return row?authorizations.read(JSON.parse(row.data_json).authorizationRef,run.ownerId).workspaceId:null;
    }
    const id=(run.input as any)?.authorizationRef;
    return id?authorizations.read(id,run.ownerId).workspaceId:null;
  }));
  const plugin=createScriptGoalPlugin({store,goals,history,contexts,authorizations,workspaces,drafts,reviews,registry});
  const decisionDriver=new DecisionDriver(goals,journal,transport,plugin,{maxNoProgressStreak:3});
  const worker = new AgentWorker(store, registry, { workerId, handlers: { CAPABILITY: async context=>{if((context.run.input as any)?.planningRepair)return handleScriptPlanningRepair(context,domainDeps);const observation=await context.call((context.run.input as any).request);return {status:observation.status==='SUCCEEDED'?'SUCCEEDED':'FAILED',result:observation};}, GOAL: context=>decisionDriver.handle(context), CHAT: async context => {
    if((context.run.input as any)?.request?.capabilityId==='script.dispatch')return handleScriptManualDispatch(context,{store,contexts,conversations,commands});
    const observation = await context.call((context.run.input as any).request); return { status: observation.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', result: observation }; } } });
  const childWorker = new AgentChildWorker(store, registry, { workerId: `${workerId}:child` });
  return { store, journal, scripts, workspaces, authorizations, drafts, reviews, budgets, goals, history, commands, registry, worker, childWorker, contexts, conversations, memory, withConversationValidation };
}
