import {readScriptPlanningRepairProgress} from '../agent/scriptPlanningRepair';
import { isPlanningStage, type ScriptStage } from '../../../../packages/script/src/agentStages';
import type { Express, Request, Response } from 'express';
import { AgentError, hashValue, type GoalSnapshot } from '../../../../packages/agent-core/src';
import type { AgentSqliteStore, SqliteModelJournal, SqliteGoalStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import type { ScriptDraftStore, ScriptDraftRecord } from '../repositories/scriptDraftStore';
import type { ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';
import type { ScriptReviewStore } from '../repositories/scriptReviewStore';
import type { ScriptCommandService } from '../agent/scriptCommands';

/** Author projections only. Model input and candidate payloads are read from
 * committed rows, then checked against their original context before display. */
export function registerScriptReadRoutes(app: Express, deps: {
  store: AgentSqliteStore; journal: SqliteModelJournal; goals: SqliteGoalStore;
  workspaces: ScriptWorkspaceStore; drafts: ScriptDraftStore; authorizations: ScriptAuthorizationStore; reviews: ScriptReviewStore;
  commands: ScriptCommandService;
  owner(req: Request): string;
}) {
  const fail = (res: Response, error: unknown) => res.status(error instanceof AgentError ? error.status : 400).json({
    error: error instanceof Error ? error.message : '读取剧本任务失败',
    code: error instanceof AgentError ? error.code : 'INVALID_SCRIPT_READ',
  });
  const withdrawnSource = (error: unknown) => error instanceof AgentError &&
    /(?:REVOKED|SOURCE_INVALID|MEMORY_STALE|MEMORY_NOT_FOUND|MEMORY_COLLECTION_CHANGED|MEMORY_SOURCE_RANGE_DENIED|WORKSPACE_POLICY_MISSING|SCRIPT_PROJECT_NOT_FOUND)/.test(error.code);
  const sourceVisible = (goal: GoalSnapshot, runId: string, stateOnly = false) => {
    const run = deps.store.readRun(runId, goal.ownerId);
    if (run.threadId !== goal.threadId || run.kind !== 'GOAL') throw new AgentError('GOAL_RUN_MISMATCH', '委托执行记录与会话不一致', 403);
    const auth = deps.authorizations.read(goal.revision.authorizationRef, goal.ownerId);
    if (auth.threadId !== goal.threadId || auth.workspaceId !== goal.revision.workspaceRef.uri.split('/').at(-1))
      throw new AgentError('GOAL_AUTHORIZATION_MISMATCH', '委托工作稿与授权不一致', 403);
    return deps.authorizations.withAuthorization(auth.id, goal.ownerId, 'VIEW', () => {
      const grants = deps.authorizations.grants(auth.id, goal.ownerId);
      if (grants.length !== goal.revision.sourceRefs.length ||
        hashValue(grants.map(grant => hashValue(grant.source.ref)).sort()) !==
        hashValue(goal.revision.sourceRefs.map(ref => hashValue(ref)).sort()))
        throw new AgentError('GOAL_SOURCE_MISMATCH', '委托来源与授权不一致', 403);
      for (const grant of grants) deps.authorizations.readGranted(deps.authorizations.ref(grant),
        { ownerId: goal.ownerId, scopeId: auth.workspaceId, branch: `workspace:${auth.workspaceId}` }, 'EXACT');
      return stateOnly ? deps.journal.stateRun(run) : deps.journal.viewRun(run);
    });
  };
  const goalView = (goalId: string, ownerId: string, stateOnly = false) => {
    const goal = deps.goals.read(goalId, ownerId);
    const row = deps.store.db.prepare('SELECT last_run_id FROM agent_goals WHERE id=? AND owner_id=?').get(goalId, ownerId) as { last_run_id: string } | undefined;
    if (!row) throw new AgentError('GOAL_NOT_FOUND', '委托不存在或不属于当前作者', 404);
    const actualRun = deps.store.readRun(goal.activeRunId ?? row.last_run_id, ownerId);
    let run;
    let pendingQuestion:ReturnType<SqliteGoalStore['pendingQuestion']>=null;
    let sourceRedacted = false;
    try { run = sourceVisible(goal, actualRun.id, stateOnly); pendingQuestion = deps.goals.pendingQuestion(goal.id,ownerId); }
    catch (error) {
      if (!(error instanceof AgentError) || !['CONTEXT_REVOKED', 'CONTEXT_SOURCE_INVALID', 'MEMORY_STALE', 'MEMORY_NOT_FOUND', 'SCRIPT_AUTHORIZATION_DENIED'].includes(error.code)) throw error;
      sourceRedacted = true;
      run = { ...actualRun, reason: '委托上下文已撤回', input: { redacted: true, reason: error.code }, result: { redacted: true, reason: error.code } };
    }
    const workspaceId = goal.revision.workspaceRef.uri.split('/').at(-1)!;
    deps.workspaces.assertReadable(workspaceId, ownerId);
    const redacted = sourceRedacted || Boolean((run.input as { redacted?: boolean } | null)?.redacted);
    const createdSceneCounts=redacted?{}:Object.fromEntries(deps.commands.goalCreatedSceneCounts(goal.id,goal.activeRevision));
    return { goal: { ...goal, lastRunId: row.last_run_id, workspaceId, pendingQuestion,createdSceneCounts,
      ...(redacted ? { redacted: true, revision: { ...goal.revision, objective: '此委托的上下文已撤回。', skillManifest: [], sourceRefs: [], route: { ...goal.revision.route, routeRef: 'redacted' } } } : {}) }, run };
  };
  const candidateView = (record: ScriptDraftRecord) => {
    const application = deps.store.db.prepare('SELECT workspace_revision FROM script_draft_applications WHERE candidate_id=?').get(record.id) as { workspace_revision: number } | undefined;
    return { id: record.id, workspaceId: record.workspaceId, runId: record.runId, status: record.status,
      error: record.error, candidate: record.candidate, request: record.request, baseRef: record.baseRef,
      modelInputHash: record.modelInputHash, appliedRevision: application?.workspace_revision ?? null };
  };
  const candidate = (req: Request) => {
    const ownerId = deps.owner(req), workspace = deps.workspaces.read(req.params.id, ownerId);
    const record = deps.drafts.readCandidate(ownerId, req.params.candidateId, 'VIEW');
    if (record.workspaceId !== workspace.id) throw new AgentError('SCRIPT_DRAFT_NOT_FOUND', '候选不存在或不属于此工作稿', 404);
    return record;
  };
  const scriptRun = (runId: string, ownerId: string) => {
    const run = deps.store.readRun(runId, ownerId);
    if (!['CAPABILITY', 'GOAL'].includes(run.kind)) throw new AgentError('SCRIPT_RUN_NOT_FOUND', '剧本执行任务不存在', 404);
    const auth = deps.authorizations.forRun(run, 'VIEW');
    if (auth.ownerId !== ownerId || auth.threadId !== run.threadId) throw new AgentError('SCRIPT_RUN_NOT_FOUND', '剧本执行任务不存在', 404);
    deps.workspaces.assertReadable(auth.workspaceId, ownerId);
    return { run, auth };
  };

  app.get('/api/script-runs', (req, res) => {
    try { return deps.journal.withViewBatch(() => {
      const ownerId = deps.owner(req), threadId = req.query.threadId;
      if (typeof threadId !== 'string' || !/^[\w-]{1,120}$/.test(threadId))
        throw new AgentError('INVALID_THREAD_ID', '请指定有效的会话', 400);
      if (!deps.store.db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND owner_id=?').get(threadId, ownerId))
        throw new AgentError('THREAD_NOT_FOUND', '会话不存在或不属于当前作者', 404);
      const rows = deps.store.db.prepare("SELECT id FROM agent_runs WHERE owner_id=? AND thread_id=? AND kind IN ('CAPABILITY','GOAL') ORDER BY rowid").all(ownerId, threadId) as Array<{ id: string }>;
      res.json({ runs: rows.flatMap(row => {
        try {
          const { run, auth } = scriptRun(row.id, ownerId);
          const link = deps.goals.readRunLink(run.id);
          return [{ run: req.query.view === 'state' ? deps.journal.stateRun(run) : deps.journal.viewRun(run), workspaceId: auth.workspaceId, goalId: link?.goalId ?? null,planningRepair:readScriptPlanningRepairProgress(deps,run) }];
        } catch (error) {
          if (withdrawnSource(error) || error instanceof AgentError && ['SCRIPT_AUTHORIZATION_DENIED', 'SCRIPT_RUN_NOT_FOUND'].includes(error.code)) return [];
          throw error;
        }
      }) });
    }); } catch (error) { fail(res, error); }
  });
  app.get('/api/agent/runs/:id/invocations', (req, res) => {
    try {
      const ownerId = deps.owner(req), { run } = scriptRun(req.params.id, ownerId);
      const rows = deps.store.db.prepare('SELECT id FROM agent_invocations WHERE run_id=? ORDER BY rowid').all(run.id) as Array<{ id: string }>;
      res.json({ invocations: rows.flatMap(row => {
        const invocation = deps.journal.read(row.id);
        if (invocation.request.channel !== 'api') return [];
        let request = invocation.request, redacted = false, contextError: string | null = null;
        try { deps.journal.assertRunInput(request, run, 'VIEW'); }
        catch (error) {
          redacted = true;
          contextError = error instanceof AgentError ? error.code : 'CONTEXT_UNAVAILABLE';
          request = { operationKey: request.operationKey, channel: request.channel, routeRef: request.routeRef,
            prompt: '此请求的上下文已撤回或不可访问。' };
        }
        const attempts = deps.store.db.prepare('SELECT id,attempt_no,status FROM agent_attempts WHERE invocation_id=? ORDER BY attempt_no').all(invocation.id) as Array<{ id: string; attempt_no: number; status: string }>;
        return [{ id: invocation.id, runId: run.id, status: invocation.status, inputHash: invocation.inputHash,
          request, redacted, contextError, attempts: attempts.map(attempt => ({ id: attempt.id, attemptNo: attempt.attempt_no, status: attempt.status })) }];
      }) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/script-goals', (req, res) => {
    try {
      const ownerId = deps.owner(req), threadId = req.query.threadId;
      if (typeof threadId !== 'string' || !/^[\w-]{1,120}$/.test(threadId))
        throw new AgentError('INVALID_THREAD_ID', '请指定有效的会话', 400);
      if (!deps.store.db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND owner_id=?').get(threadId, ownerId))
        throw new AgentError('THREAD_NOT_FOUND', '会话不存在或不属于当前作者', 404);
      const rows = deps.store.db.prepare('SELECT id FROM agent_goals WHERE owner_id=? AND thread_id=? ORDER BY rowid').all(ownerId, threadId) as Array<{ id: string }>;
      res.json(deps.journal.withViewBatch(()=>({ goals: rows.flatMap(row => {
        try { return [goalView(row.id, ownerId, req.query.view === 'state').goal]; }
        catch (error) { if (withdrawnSource(error)) return []; throw error; }
      }) })));
    } catch (error) { fail(res, error); }
  });
  app.get('/api/script-goals/:id', (req, res) => {
    try { res.json(goalView(req.params.id, deps.owner(req), req.query.view === 'state')); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/script-goals/:id/review', (req, res) => {
    try { return deps.journal.withViewBatch(() => {
      const ownerId = deps.owner(req);
      const planning = isPlanningStage((deps.goals.read(req.params.id, ownerId).revision.contract.value as {stopAfter?:ScriptStage}).stopAfter);
      // The review projection may contain model-derived findings. Validate
      // their original context before exposing them. Planning returns no
      // findings, so it only needs current source and authorization checks.
      const { goal, run } = goalView(req.params.id, ownerId, planning);
      if (goal.redacted) return res.json({ redacted: true, review: null });
      if(isPlanningStage((goal.revision.contract.value as {stopAfter?:ScriptStage}).stopAfter))return res.json({redacted:false,review:null});
      const link = deps.goals.readRunLink(run.id);
      if (link?.goalId !== goal.id || link.role !== 'GOAL_CONTROLLER' || link.goalRevision !== goal.revision.revision)
        throw new AgentError('GOAL_RUN_MISMATCH', '审阅执行记录与当前委托不一致', 403);
      try { return res.json({ redacted: false, review: req.query.view === 'progress' ? deps.reviews.readAuthorProgress(run) : deps.reviews.readAuthorStatus(run) }); }
      catch (error) {
        if (error instanceof Error && !(error instanceof AgentError) &&
          /^(目标单元必须存在且不能重复|目标单元不存在：)/.test(error.message))
          return res.json({ redacted: false, review: null, pendingBody: error.message });
        throw error;
      }
    }); } catch (error) { fail(res, error); }
  });
  app.get('/api/script-goals/:id/external-requests', (req, res) => {
    try {
      const ownerId = deps.owner(req), goal = deps.goals.read(req.params.id, ownerId);
      const rows = deps.store.db.prepare(`SELECT l.run_id FROM agent_run_links l JOIN agent_runs r ON r.id=l.run_id
        WHERE l.goal_id=? AND r.owner_id=? AND r.thread_id=?
        ${req.query.view === 'state' ? "AND EXISTS (SELECT 1 FROM agent_external_requests e WHERE e.run_id=r.id AND e.status='WAITING')" : ''}
        ORDER BY r.rowid`).all(goal.id, ownerId, goal.threadId) as Array<{ run_id: string }>;
      res.json(deps.journal.withViewBatch(() => ({ externalRequests: rows.flatMap(row => {
        const { run } = scriptRun(row.run_id, ownerId), link = deps.goals.readRunLink(run.id);
        if (link?.goalId !== goal.id) throw new AgentError('GOAL_RUN_MISMATCH', '委托子任务关联已改变', 403);
        return deps.journal.listExternal(run.id, ownerId, req.query.view === 'state' ? 'WAITING' : undefined)
          .map(request => ({ runId: run.id, role: link.role, request }));
      }) })));
    } catch (error) { fail(res, error); }
  });
  const workspaceCandidates=(workspaceId:string,ownerId:string)=>{
    deps.workspaces.assertReadable(workspaceId,ownerId);
    const rows=deps.store.db.prepare('SELECT id FROM script_draft_candidates WHERE owner_id=? AND workspace_id=? ORDER BY rowid').all(ownerId,workspaceId) as Array<{id:string}>;
    return rows.map(row=>{
      try{return candidateView(deps.drafts.readCandidate(ownerId,row.id,'VIEW'));}
      catch(error){
        if(!(error instanceof AgentError)||!['CONTEXT_REVOKED','CONTEXT_SOURCE_INVALID','MEMORY_STALE','MEMORY_NOT_FOUND','SCRIPT_DRAFT_DENIED'].includes(error.code))throw error;
        return {id:row.id,workspaceId,status:'REDACTED',error:'候选来源已撤回或不可访问',candidate:null,request:null,baseRef:null,modelInputHash:null,runId:null,appliedRevision:null};
      }
    });
  };
  // One synchronous authorization snapshot for the visible workspace set. Every
  // candidate is still revalidated; no evidence or permission survives a request.
  app.get('/api/script-candidates',(req,res)=>{
    try {res.json(deps.journal.withViewBatch(()=>{
      const ownerId=deps.owner(req),{threadId,documentId}=req.query;
      if(typeof threadId!=='string'||typeof documentId!=='string'||typeof req.query.workspaceIds!=='string')throw new AgentError('INVALID_CANDIDATE_SCOPE','候选读取范围无效',400);
      const ids:unknown=JSON.parse(req.query.workspaceIds);
      if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||! /^[\w-]{1,120}$/.test(id))||new Set(ids).size!==ids.length)throw new AgentError('INVALID_CANDIDATE_SCOPE','候选工作稿列表无效',400);
      if(!deps.store.db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND owner_id=?').get(threadId,ownerId))throw new AgentError('THREAD_NOT_FOUND','会话不存在或不属于当前作者',404);
      return {candidates:ids.flatMap(id=>{
        if(!deps.store.db.prepare('SELECT 1 FROM script_workspaces WHERE id=? AND owner_id=? AND thread_id=? AND document_id=?').get(id,ownerId,threadId,documentId))throw new AgentError('WORKSPACE_NOT_FOUND','工作稿不存在或不属于当前范围',404);
        return workspaceCandidates(id,ownerId);
      })};
    }));}catch(error){fail(res,error);}
  });
  app.get('/api/script-workspaces/:id/candidates',(req,res)=>{
    try{res.json(deps.journal.withViewBatch(()=>({candidates:workspaceCandidates(req.params.id,deps.owner(req))})));}
    catch(error){fail(res,error);}
  });
  app.get('/api/script-workspaces/:id/candidates/:candidateId', (req, res) => {
    try { res.json({ candidate: candidateView(candidate(req)) }); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/script-workspaces/:id/candidates/:candidateId/request', (req, res) => {
    try {
      const record = candidate(req), run = deps.store.readRun(record.runId, record.ownerId);
      const invocation = deps.journal.read(record.invocationId);
      if (invocation.runId !== run.id || invocation.ownerKey !== record.stepId ||
        invocation.inputHash !== record.modelInputHash || hashValue(invocation.request) !== hashValue(record.modelRequest))
        throw new AgentError('SCRIPT_DRAFT_REQUEST_MISMATCH', '候选与冻结请求不一致', 403);
      deps.journal.assertRunInput(invocation.request, run, 'VIEW');
      res.json({ request: invocation.request, inputHash: invocation.inputHash, invocationId: invocation.id });
    } catch (error) { fail(res, error); }
  });
}
