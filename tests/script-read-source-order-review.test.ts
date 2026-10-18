import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { createServer } from 'node:http';
import { hashValue } from '../packages/agent-core/src';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

test('author Goal HTTP reads two pinned sources regardless of generated grant ID order', async t => {
  const db = new Database(':memory:');
  const runtime = createScriptRuntime(db, {
    transport:{sendOnce:async () => {throw new Error('NO_EXTERNAL_MODEL');}},
    owner:req => String(req.header('x-test-owner') || 'author'),
    resolveMethods:async () => [],
    resolveExecution:() => ({channel:'external',routeRef:'MECHANICAL_ROUTE'}),
  });
  const app = express(); app.use(express.json()); runtime.register(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {await new Promise<void>(resolve => server.close(() => resolve()));db.close();});
  const address = server.address();assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (path:string,body?:unknown,owner='author') => {
    const response = await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-test-owner':owner},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json() as any};
  };
  const profile = createScriptCreationProfile('short-film',1,3);
  const base = runtime.scripts.saveProject(createScriptProject('MECHANICAL_GOAL_BASE',profile),0);
  const previous = [1,2].map(index => runtime.scripts.saveProject(createScriptProject(`MECHANICAL_PREVIOUS_${index}`,profile),0));
  // These fixtures are created by the trusted host, just like the real creation route.
  for(const project of [base,...previous])runtime.workspaces.bindTrustedProjectOwner(project.id,'author');
  const sources = previous.map(project => ({purpose:'PREVIOUS_SCRIPT',ref:{uri:`resource://script/projects/${project.id}`,
    version:String(project.revision),contentHash:hashValue(project),branch:'author'},unitIds:[project.units[0].id]}));
  const thread = runtime.conversations.open('author','script:home','two-source-order');
  let selected:{goalId:string}|null = null;
  // Grant IDs include a random authorization ID, so use a bounded set of real
  // author commands until the persisted grant sort is opposite author order.
  for(let attempt=0;attempt<20;attempt++){
    const response = await request('/api/script-commands',{kind:'GOAL_START',requestId:`two-source-${attempt}`,threadId:thread.id,
      expectedConversationVersion:thread.version,source:{kind:'PROJECT',projectId:base.id,revision:base.revision,contentHash:hashValue(base)},
      objective:'MECHANICAL_TWO_PINNED_SOURCES',task:'REVISE',target:{unitIds:[base.units[0].id],wholeUnitIds:[base.units[0].id]},
      methodIds:[],sources});
    assert.equal(response.status,202,JSON.stringify(response.data));
    const goal = runtime.goals.read(response.data.goalId,'author');
    const grants = runtime.authorizations.grants(goal.revision.authorizationRef,'author');
    if(hashValue(grants.map(grant=>grant.source.ref))!==hashValue(goal.revision.sourceRefs)){
      selected={goalId:goal.id};break;
    }
  }
  assert.ok(selected,'fixture must exercise grant order opposite the author source order');
  const detail = await request(`/api/script-goals/${selected.goalId}`);
  assert.equal(detail.status,200,JSON.stringify(detail.data));
  assert.deepEqual(detail.data.goal.revision.sourceRefs,sources.map(source=>source.ref));
  const listing = await request(`/api/script-goals?threadId=${thread.id}`);
  assert.equal(listing.status,200,JSON.stringify(listing.data));
  assert.ok(listing.data.goals.some((goal:any)=>goal.id===selected!.goalId));
  assert.equal((await request(`/api/script-goals/${selected.goalId}`,undefined,'other')).status,404);
});
