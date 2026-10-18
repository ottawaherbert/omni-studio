import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { createServer } from 'node:http';
import { hashValue } from '../packages/agent-core/src';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

test('planning status omits historical model validation while pending requests retain it', async t => {
  const db = new Database(':memory:');
  const runtime = createScriptRuntime(db, {
    transport: { sendOnce: async () => { throw new Error('NO_EXTERNAL_MODEL'); } },
    owner: req => String(req.header('x-test-owner') || 'author'), trustedLegacyProjectOwner: 'author',
    resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'MECHANICAL_PROTOCOL' }),
  });
  const app = express(); app.use(express.json()); runtime.register(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const api = async (path: string, owner = 'author', body?: unknown, expected = 200) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-test-owner': owner, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as any; assert.equal(response.status, expected, JSON.stringify(value)); return value;
  };
  const thread = runtime.conversations.open('author', 'script:home', 'planning-poll');
  const project = runtime.scripts.saveProject(createScriptProject('机械规划轮询', createScriptCreationProfile('short-film', 1, 3)), 0);
  runtime.workspaces.bindTrustedProjectOwner(project.id, 'author');
  const accepted = await api('/api/script-commands', 'author', { kind: 'GOAL_START', requestId: 'planning-poll',
    threadId: thread.id, expectedConversationVersion: thread.version,
    source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
    objective: '机械分场规划', task: 'WRITE', stopAfter: 'SCENES',
    target: { unitIds: [project.units[0].id], wholeUnitIds: [project.units[0].id] }, methodIds: [] }, 202);
  await runtime.worker.runOnce(accepted.runId);
  const frozen = runtime.journal.listExternal(accepted.runId, 'author')[0];
  assert.equal(frozen.status, 'WAITING');
  const fullView = t.mock.method(runtime.journal, 'viewRun');
  const pendingView = t.mock.method(runtime.journal, 'externalRequest');
  assert.deepEqual(await api(`/api/script-goals/${accepted.goalId}/review`), { redacted: false, review: null });
  assert.equal(fullView.mock.callCount(), 0, 'planning has no model findings to revalidate');
  const pending = await api(`/api/script-goals/${accepted.goalId}/external-requests?view=state`);
  assert.deepEqual(pending.externalRequests.map((item: any) => item.request.id), [frozen.id]);
  assert.equal(pendingView.mock.callCount(), 1, 'the pending model context is still checked');
  await api(`/api/script-goals/${accepted.goalId}/review`, 'stranger', undefined, 404);
  await api(`/api/script-goals/${accepted.goalId}/external-requests?view=state`, 'stranger', undefined, 404);
  runtime.journal.submitExternal(frozen.id, 'author', frozen.inputHash, JSON.stringify({ kind: 'ASK',
    capabilityId: null, capabilityVersion: null, arguments: null, planUpdate: null, message: '机械暂停问题',
    choices: [], artifactRefs: null, summary: null, reason: null, remainingWork: null }), { name: 'MECHANICAL_PROTOCOL' });
  const readWorkspace = t.mock.method(runtime.workspaces, 'read');
  assert.deepEqual((await api(`/api/script-goals/${accepted.goalId}/external-requests?view=state`)).externalRequests, []);
  assert.equal(readWorkspace.mock.callCount(), 0, 'no pending request must not rescan old run workspaces');
  db.prepare('UPDATE script_project_owners SET owner_id=? WHERE project_id=?').run('withdrawn-owner', project.id);
  await api(`/api/script-goals/${accepted.goalId}/review`, 'author', undefined, 404);
});

test('revoked workspace in one thread cannot hide independent workspace, Goal or Run HTTP listings', async t => {
  const db = new Database(':memory:');
  const runtime = createScriptRuntime(db, {
    transport: { sendOnce: async () => { throw new Error('NO_EXTERNAL_MODEL'); } },
    owner: () => 'author', trustedLegacyProjectOwner: 'author', resolveMethods: async () => [],
    resolveExecution: () => ({ channel: 'external', routeRef: 'MECHANICAL_PROTOCOL' }),
  });
  const app = express(); app.use(express.json()); runtime.register(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const read = async (path: string, expected = 200) => {
    const response = await fetch(origin + path); const body = await response.json() as any;
    assert.equal(response.status, expected, JSON.stringify(body)); return body;
  };
  const thread = runtime.conversations.open('author', 'script:home', 'isolated-listing');
  const profile = createScriptCreationProfile('short-film', 1, 3);
  const projects = ['withdrawn', 'visible'].map(label => runtime.scripts.saveProject(createScriptProject(`机械${label}`, profile), 0));
  projects.forEach(project => runtime.workspaces.bindTrustedProjectOwner(project.id, 'author'));
  const receipts = [];
  for (const [index, project] of projects.entries()) {
    const response = await fetch(origin + '/api/script-commands', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'GOAL_START', requestId: `listing-${index}`, threadId: thread.id,
        expectedConversationVersion: runtime.conversations.read(thread.id, 'author').version,
        source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
        objective: `【机械目标】${index}`, task: 'REVIEW', target: { unitIds: [project.units[0].id] }, methodIds: [] }) });
    const body = await response.json() as any; assert.equal(response.status, 202, JSON.stringify(body)); receipts.push(body);
  }
  db.prepare('UPDATE script_project_owners SET owner_id=? WHERE project_id=?').run('withdrawn-owner', projects[0].id);
  assert.deepEqual((await read('/api/script-workspaces')).workspaces.map((item: any) => item.id), [receipts[1].workspaceId]);
  assert.deepEqual((await read(`/api/script-goals?threadId=${thread.id}`)).goals.map((item: any) => item.id), [receipts[1].goalId]);
  assert.deepEqual((await read(`/api/script-runs?threadId=${thread.id}`)).runs.map((item: any) => item.run.id), [receipts[1].runId]);
  await read(`/api/script-goals/${receipts[0].goalId}`, 404);
});

test('read-only Goal and candidate HTTP projections use the real isolated runtime and owner', async t => {
  const db = new Database(':memory:');
  const runtime = createScriptRuntime(db, {
    transport: { sendOnce: async () => { throw new Error('NO_EXTERNAL_MODEL'); } },
    owner: req => String(req.header('x-test-owner') || 'author'),
    trustedLegacyProjectOwner: 'author',
    resolveMethods: async () => [],
    resolveExecution: req => ({ channel: req.body?.executionChannel === 'api' ? 'api' : 'external', routeRef: 'MECHANICAL_PROTOCOL' }),
  });
  const app = express(); app.use(express.json()); runtime.register(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const api = async (path: string, owner = 'author', body?: unknown, expected = 200) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-test-owner': owner, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  };
  const thread = runtime.conversations.open('author', 'script:home', 'mechanical-http');
  const otherThread = runtime.conversations.open('author', 'script:home', 'other-thread');
  const apiThread = runtime.conversations.open('author', 'script:home', 'api-unknown-thread');
  const profile = createScriptCreationProfile('short-film', 1, 3);
  const project = runtime.scripts.saveProject(createScriptProject('机械只读接口', profile), 0);
  const goalCommand = { kind: 'GOAL_START', requestId: 'goal-read', threadId: thread.id,
    expectedConversationVersion: thread.version,
    source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
    objective: '【机械目标】验证只读入口', task: 'REVISE',
    target: { unitIds: [project.units[0].id], wholeUnitIds: [project.units[0].id] }, methodIds: [] };
  const accepted = await api('/api/script-commands', 'author', goalCommand, 202);
  const listing = await api(`/api/script-goals?threadId=${thread.id}`);
  assert.deepEqual(listing.goals.map((goal: any) => goal.id), [accepted.goalId]);
  assert.equal(listing.goals[0].workspaceId, accepted.workspaceId);
  assert.equal(listing.goals[0].lastRunId, accepted.runId);
  const firstBudget = (await api(`/api/script-goals/${accepted.goalId}/budget`)).budget;
  assert.ok(firstBudget.limits.maxInvocations>=40);
  const nextLimit=[80,160,320,640,1000].find(limit=>limit>firstBudget.limits.maxInvocations);
  assert.ok(nextLimit,'机械委托仍应存在可由作者选择的下一档有界预算');
  const increase={requestId:'mechanical-budget-increase',expectedGoalVersion:listing.goals[0].version,
    expectedBudgetVersion:firstBudget.version,maxInvocations:nextLimit};
  const raised=(await api(`/api/script-goals/${accepted.goalId}/budget`,'author',increase)).budget;
  assert.equal(raised.limits.maxInvocations,nextLimit);
  assert.deepEqual((await api(`/api/script-goals/${accepted.goalId}/budget`,'author',increase)).budget,raised);
  assert.deepEqual(raised.used,firstBudget.used,'增加总额度不抹去原账');
  assert.ok(raised.limits.maxRepairRounds>=firstBudget.limits.maxRepairRounds);
  assert.ok(raised.limits.maxActiveMs>=firstBudget.limits.maxActiveMs);
  await api(`/api/script-goals/${accepted.goalId}/budget`,'author',{...increase,maxInvocations:nextLimit===80?160:80},409);
  await api(`/api/script-goals/${accepted.goalId}/budget`,'author',{...increase,expectedGoalVersion:increase.expectedGoalVersion+1},409);
  await api(`/api/script-goals/${accepted.goalId}/budget`,'stranger',undefined,404);
  await api(`/api/script-goals/${accepted.goalId}/budget`,'stranger',increase,404);
  await api(`/api/script-goals/${accepted.goalId}/budget`,'author',{...increase,requestId:'stale-budget'},409);
  let timeBudget=raised;
  for(const tier of [160,320,640]){
    if(tier<=timeBudget.limits.maxInvocations)continue;
    timeBudget=(await api(`/api/script-goals/${accepted.goalId}/budget`,'author',{
      requestId:`mechanical-budget-${tier}`,expectedGoalVersion:listing.goals[0].version,
      expectedBudgetVersion:timeBudget.version,maxInvocations:tier})).budget;
  }
  assert.equal(timeBudget.limits.maxInvocations,640);
  db.prepare('INSERT INTO agent_budget_entries(budget_id,kind,operation_id,data_json) VALUES(?,?,?,?)')
    .run(timeBudget.id,'ACTIVE','mechanical-active-exhausted',JSON.stringify({durationMs:timeBudget.limits.maxActiveMs}));
  assert.equal(runtime.goals.budgets.timeAvailable(timeBudget.id),false);
  const extendedTime=(await api(`/api/script-goals/${accepted.goalId}/budget`,'author',{
    requestId:'mechanical-budget-1000',expectedGoalVersion:listing.goals[0].version,
    expectedBudgetVersion:timeBudget.version,maxInvocations:1000})).budget;
  assert.equal(extendedTime.used.activeMs,timeBudget.limits.maxActiveMs);
  assert.ok(extendedTime.limits.maxActiveMs>timeBudget.limits.maxActiveMs);
  assert.equal(runtime.goals.budgets.timeAvailable(timeBudget.id),true);
  const detail = await api(`/api/script-goals/${accepted.goalId}`);
  assert.equal(detail.run.id, accepted.runId);
  assert.equal(detail.goal.activeRevision, 1);
  const review = await api(`/api/script-goals/${accepted.goalId}/review`);
  assert.equal(review.redacted, false);
  assert.equal(review.review.workspaceId, accepted.workspaceId);
  assert.equal(review.review.workspaceRevision, 1);
  assert.deepEqual(review.review.targetUnitIds, [project.units[0].id]);
  assert.equal(review.review.coverage.localComplete, false);
  assert.ok(review.review.tasks.length > 0);
  const progress = await api(`/api/script-goals/${accepted.goalId}/review?view=progress`);
  const {tasks:_tasks,findings:_findings,...expectedProgress}=review.review;
  assert.deepEqual(progress,{redacted:false,review:expectedProgress});
  await api(`/api/script-goals/${accepted.goalId}/review?view=progress`, 'stranger', undefined, 404);
  await api(`/api/script-goals/${accepted.goalId}/review`, 'stranger', undefined, 404);
  assert.deepEqual((await api(`/api/script-goals?threadId=${otherThread.id}`)).goals, []);
  await api('/api/script-goals', 'author', undefined, 400);
  await api(`/api/script-goals?threadId=${thread.id}`, 'stranger', undefined, 404);
  await api(`/api/script-goals/${accepted.goalId}`, 'stranger', undefined, 404);
  const goalAccess = { ownerId: 'author', scopeId: accepted.workspaceId, branch: `workspace:${accepted.workspaceId}` };
  const goalSecret = 'MECHANICAL_WITHDRAWN_GOAL_MARKER';
  const goalMemory = runtime.contexts.createMemory(goalAccess, 'author', 'goal-memory', {
    key: 'mechanical.goal', kind: 'AUTHOR_PREFERENCE',
    content: { label: 'mechanical goal', value: goalSecret }, dependencies: [],
  });
  await runtime.worker.runOnce(accepted.runId);
  const goalExternal = runtime.journal.listExternal(accepted.runId, 'author')[0];
  assert.match(goalExternal.request.prompt, /MECHANICAL_WITHDRAWN_GOAL_MARKER/);
  const goalRequests = await api(`/api/script-goals/${accepted.goalId}/external-requests`);
  assert.equal(goalRequests.externalRequests[0].runId, accepted.runId);
  assert.deepEqual(goalRequests.externalRequests[0].request, goalExternal);
  assert.deepEqual((await api(`/api/script-goals/${accepted.goalId}/external-requests?view=state`)).externalRequests, goalRequests.externalRequests);
  await api(`/api/script-goals/${accepted.goalId}/external-requests`, 'stranger', undefined, 404);
  runtime.contexts.updateMemory(goalAccess, 'goal-forget', goalMemory.id, 1, 'DELETE');
  const hiddenGoal = await api(`/api/script-goals/${accepted.goalId}`);
  assert.equal(hiddenGoal.goal.redacted, true);
  assert.equal(hiddenGoal.run.input.redacted, true);
  assert.equal(JSON.stringify(hiddenGoal).includes(goalSecret), false);
  const hiddenReview = await api(`/api/script-goals/${accepted.goalId}/review`);
  assert.equal(hiddenReview.redacted, true);
  assert.equal(hiddenReview.review, null);
  assert.deepEqual(await api(`/api/script-goals/${accepted.goalId}/review?view=progress`),hiddenReview,
    'progress must recheck the same original controller context after withdrawal');
  assert.equal(JSON.stringify(hiddenReview).includes(goalSecret), false);
  const hiddenGoals = await api(`/api/script-goals?threadId=${thread.id}`);
  assert.equal(hiddenGoals.goals[0].redacted, true);
  assert.equal(JSON.stringify(hiddenGoals).includes(goalSecret), false);
  const redactedGoalRequests = await api(`/api/script-goals/${accepted.goalId}/external-requests`);
  assert.equal(redactedGoalRequests.externalRequests[0].request.redacted, true);
  assert.equal(JSON.stringify(redactedGoalRequests).includes(goalSecret), false);
  const redactedPending = await api(`/api/script-goals/${accepted.goalId}/external-requests?view=state`);
  assert.equal(redactedPending.externalRequests[0].request.redacted, true);
  assert.equal(JSON.stringify(redactedPending).includes(goalSecret), false);

  const proposal = await api('/api/script-commands', 'author', {
    kind: 'PROPOSE', requestId: 'candidate-read', threadId: otherThread.id,
    expectedConversationVersion: otherThread.version,
    source: { kind: 'NEW', title: '机械候选', profile }, operation: 'concept',
    instruction: '【机械协议】产生候选', target: {}, methodIds: [], executionChannel: 'external',
  }, 202);
  const access = { ownerId: 'author', scopeId: proposal.workspaceId, branch: `workspace:${proposal.workspaceId}` };
  const secret = 'MECHANICAL_WITHDRAWN_MEMORY_MARKER';
  const memory = runtime.contexts.createMemory(access, 'author', 'candidate-memory', {
    key: 'mechanical.preference', kind: 'AUTHOR_PREFERENCE',
    content: { label: 'mechanical', value: secret }, dependencies: [],
  });
  await runtime.worker.runOnce(proposal.runId);
  await runtime.childWorker.runOnce(proposal.runId);
  const frozen = runtime.journal.listExternal(proposal.runId, 'author')[0];
  assert.equal(frozen.status, 'WAITING');
  assert.match(frozen.request.prompt, /MECHANICAL_WITHDRAWN_MEMORY_MARKER/);
  const raw = JSON.stringify({ summary: 'MECHANICAL_PROTOCOL', content: '机械候选正文。' });
  runtime.journal.submitExternal(frozen.id, 'author', frozen.inputHash, raw,
    { name: 'MECHANICAL_PROTOCOL', model: 'test' });
  for (let i = 0; i < 5 && runtime.store.readRun(proposal.runId).status !== 'SUCCEEDED'; i++) {
    await runtime.childWorker.runOnce(proposal.runId); await runtime.worker.runOnce(proposal.runId);
  }
  assert.equal(runtime.store.readRun(proposal.runId).status, 'SUCCEEDED');
  const repeated = await api('/api/script-commands', 'author', {
    kind: 'PROPOSE', requestId: 'candidate-read-again', threadId: otherThread.id,
    expectedConversationVersion: runtime.conversations.read(otherThread.id, 'author').version,
    source: { kind: 'WORKSPACE', workspaceId: proposal.workspaceId,
      expectedRevision: runtime.workspaces.read(proposal.workspaceId, 'author').revision },
    operation: 'concept', instruction: '【机械协议】产生第二份候选', target: {}, methodIds: [], executionChannel: 'external',
  }, 202);
  await runtime.worker.runOnce(repeated.runId);
  await runtime.childWorker.runOnce(repeated.runId);
  const secondFrozen = runtime.journal.listExternal(repeated.runId, 'author')[0];
  assert.equal(secondFrozen.status, 'WAITING');
  runtime.journal.submitExternal(secondFrozen.id, 'author', secondFrozen.inputHash,
    JSON.stringify({ summary: 'MECHANICAL_PROTOCOL', content: '第二份机械候选正文。' }),
    { name: 'MECHANICAL_PROTOCOL', model: 'test' });
  for (let i = 0; i < 5 && runtime.store.readRun(repeated.runId).status !== 'SUCCEEDED'; i++) {
    await runtime.childWorker.runOnce(repeated.runId); await runtime.worker.runOnce(repeated.runId);
  }
  assert.equal(runtime.store.readRun(repeated.runId).status, 'SUCCEEDED');
  const batched = t.mock.method(runtime.journal, 'withViewBatch');
  const checkedWorkspaceSources = t.mock.method(runtime.workspaces, 'sourceAllowed');
  const list = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates`);
  assert.equal(list.candidates.length, 2);
  assert.equal(batched.mock.callCount(), 1, 'the HTTP listing validates every candidate in one view batch');
  const candidate = list.candidates[0];
  assert.equal(candidate.status, 'VALID');
  assert.equal(list.candidates[1].status, 'VALID');
  assert.ok(checkedWorkspaceSources.mock.callCount() > 0, 'the real source validator still runs');
  assert.equal(checkedWorkspaceSources.mock.callCount(), 1,
    'two real candidates with the same workspace source reuse its validation inside the batch');
  assert.match(JSON.stringify(candidate.candidate.patch), /机械候选正文/);
  assert.equal(candidate.modelInputHash, frozen.inputHash);
  assert.equal(JSON.stringify(candidate).includes(frozen.request.prompt), false);
  const candidateBatchPath=(ids:string[],documentId=runtime.workspaces.read(proposal.workspaceId,'author').documentId)=>`/api/script-candidates?${new URLSearchParams({threadId:otherThread.id,documentId,workspaceIds:JSON.stringify(ids)})}`;
  const batchPath=candidateBatchPath([proposal.workspaceId]);
  const beforeBatch=batched.mock.callCount();
  assert.deepEqual(await api(batchPath),list,'batched transport retains the complete authorized candidate projection');
  assert.equal(batched.mock.callCount(),beforeBatch+1);
  await api(batchPath,'stranger',undefined,404);
  await api(candidateBatchPath([proposal.workspaceId],'other-document'),'author',undefined,404);
  await api(candidateBatchPath([accepted.workspaceId]),'author',undefined,404);
  await api(candidateBatchPath([proposal.workspaceId,proposal.workspaceId]),'author',undefined,400);
  const one = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates/${candidate.id}`);
  assert.deepEqual(one.candidate, candidate);
  const request = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates/${candidate.id}/request`);
  assert.deepEqual(request.request, frozen.request);
  assert.equal(request.inputHash, frozen.inputHash);
  await api(`/api/script-workspaces/${accepted.workspaceId}/candidates/${candidate.id}`, 'author', undefined, 404);
  await api(`/api/script-workspaces/${proposal.workspaceId}/candidates`, 'stranger', undefined, 404);
  await api(`/api/script-workspaces/${proposal.workspaceId}/candidates/${candidate.id}/request`, 'stranger', undefined, 404);
  const scriptRuns = await api(`/api/script-runs?threadId=${otherThread.id}`);
  assert.deepEqual(scriptRuns.runs.map((item: any) => item.run.id), [proposal.runId, repeated.runId]);
  assert.equal(scriptRuns.runs[0].workspaceId, proposal.workspaceId);
  assert.deepEqual((await api(`/api/script-runs?threadId=${thread.id}`)).runs.map((item: any) => item.run.id), [accepted.runId]);
  assert.deepEqual((await api(`/api/script-runs?threadId=${apiThread.id}`)).runs, []);
  await api(`/api/script-runs?threadId=${otherThread.id}`, 'stranger', undefined, 404);
  assert.deepEqual((await api(`/api/agent/runs/${proposal.runId}/invocations`)).invocations, []);
  const batchesBeforeWithdraw = batched.mock.callCount();
  runtime.contexts.updateMemory(access, 'candidate-forget', memory.id, 1, 'DELETE');
  const withdrawn = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates`);
  assert.deepEqual(withdrawn.candidates.map((item: any) => item.status), ['REDACTED', 'REDACTED']);
  assert.equal(batched.mock.callCount(), batchesBeforeWithdraw + 1, 'a new HTTP request starts a new validation batch');
  assert.equal(JSON.stringify(withdrawn).includes(secret), false);
  assert.deepEqual(await api(batchPath),withdrawn,'another batch must revalidate withdrawal and remove every sensitive old candidate');

  const hiddenDetail = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates/${candidate.id}`, 'author', undefined, 409);
  assert.equal(JSON.stringify(hiddenDetail).includes(secret), false);
  const hiddenRequest = await api(`/api/script-workspaces/${proposal.workspaceId}/candidates/${candidate.id}/request`, 'author', undefined, 409);
  assert.equal(JSON.stringify(hiddenRequest).includes(secret), false);

  const apiProposal = await api('/api/script-commands', 'author', {
    kind: 'PROPOSE', requestId: 'api-unknown', threadId: apiThread.id,
    expectedConversationVersion: apiThread.version,
    source: { kind: 'NEW', title: '机械未知请求', profile }, operation: 'concept',
    instruction: '【机械协议】发出后未知', target: {}, methodIds: [], executionChannel: 'api',
  }, 202);
  const apiAccess = { ownerId: 'author', scopeId: apiProposal.workspaceId, branch: `workspace:${apiProposal.workspaceId}` };
  const apiSecret = 'MECHANICAL_UNKNOWN_MEMORY_MARKER';
  const apiMemory = runtime.contexts.createMemory(apiAccess, 'author', 'unknown-memory', {
    key: 'mechanical.unknown', kind: 'AUTHOR_PREFERENCE',
    content: { label: 'mechanical unknown', value: apiSecret }, dependencies: [],
  });
  await runtime.worker.runOnce(apiProposal.runId);
  await runtime.childWorker.runOnce(apiProposal.runId);
  assert.equal(runtime.store.readRun(apiProposal.runId).status, 'RECONCILIATION_REQUIRED');
  const unknown = await api(`/api/agent/runs/${apiProposal.runId}/invocations`);
  assert.equal(unknown.invocations.length, 1);
  assert.equal(unknown.invocations[0].status, 'UNKNOWN');
  assert.equal(unknown.invocations[0].request.channel, 'api');
  assert.match(unknown.invocations[0].request.prompt, /MECHANICAL_UNKNOWN_MEMORY_MARKER/);
  assert.equal(unknown.invocations[0].attempts.length, 1);
  await api(`/api/agent/runs/${apiProposal.runId}/invocations`, 'stranger', undefined, 404);
  runtime.contexts.updateMemory(apiAccess, 'unknown-forget', apiMemory.id, 1, 'DELETE');
  const redactedUnknown = await api(`/api/agent/runs/${apiProposal.runId}/invocations`);
  assert.equal(redactedUnknown.invocations[0].redacted, true);
  assert.equal(redactedUnknown.invocations[0].inputHash, unknown.invocations[0].inputHash);
  assert.equal(JSON.stringify(redactedUnknown).includes(apiSecret), false);
});
