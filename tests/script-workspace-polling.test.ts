import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createScriptRuntime} from '../apps/api/src/agent/scriptRuntime';
import {registerScriptWorkspaceRoutes} from '../apps/api/src/routes/scriptWorkspaceRoutes';
import {scriptAgentClient} from '../apps/web/src/clients/scriptClient';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';

test('workspace polling reuses immutable text, keeps live metadata, and removes revoked or unrelated workspaces',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 const runtime=createScriptRuntime(db,{transport:{sendOnce:async()=>{throw new Error('NO_MODEL');}},
  owner:()=> 'author',trustedLegacyProjectOwner:'author',resolveMethods:async()=>[],
  resolveExecution:()=>({channel:'external',routeRef:'fixture'})});
 const thread=runtime.conversations.open('author','script:home','polling');
 const otherThread=runtime.conversations.open('author','script:home','other');
 const project=runtime.scripts.saveProject(createScriptProject('读取增量',createScriptCreationProfile('short-film',1,3)),0);
 runtime.workspaces.bindTrustedProjectOwner(project.id,'author');
 const create=(threadId:string,requestId:string)=>runtime.workspaces.create({ownerId:'author',threadId,requestId,source:{projectId:project.id,revision:project.revision}});
 const workspace=create(thread.id,'first');create(otherThread.id,'other');
 const routes=new Map<string,Function>();
 const app={get:(path:string,handler:Function)=>routes.set(path,handler),post:()=>{},put:()=>{}};
 registerScriptWorkspaceRoutes(app as any,{workspaces:runtime.workspaces,owner:req=>String(req.headers?.owner||'author')});
 const requests:Array<{query:Record<string,string>;body:any}>=[];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://fixture.invalid');let status=200,body:any;
  const query=Object.fromEntries(url.searchParams);
  routes.get(url.pathname)!({query,headers:{}},{status:(value:number)=>{status=value;return {json:(v:any)=>{body=v;}};},json:(value:any)=>{body=value;}});
  requests.push({query,body});return new Response(JSON.stringify(body),{status});
 });
 const first=(await scriptAgentClient.workspaceState(thread.id,project.id,[])).workspaces;
 assert.deepEqual(first.map(w=>w.id),[workspace.id]);
 assert.ok(requests.at(-1)!.body.workspaces[0].document);
 const second=(await scriptAgentClient.workspaceState(thread.id,project.id,first)).workspaces;
 assert.equal('document' in requests.at(-1)!.body.workspaces[0],false,'unchanged full manuscript is not transmitted');
 assert.equal(second[0],first[0],'unchanged workspace metadata preserves the rendered snapshot');
 assert.equal(second[0].document,first[0].document,'the caller reuses its exact immutable text');
 db.prepare('UPDATE script_workspaces SET writer_epoch=writer_epoch+1 WHERE id=?').run(workspace.id);
 const metadata=(await scriptAgentClient.workspaceState(thread.id,project.id,second)).workspaces;
 assert.equal(metadata[0].writerEpoch,workspace.writerEpoch+1,'metadata still updates at the same manuscript revision');
 const edited=structuredClone(workspace.document);edited.brief.concept='人工修改仍立即可见';
 runtime.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'edit',expectedRevision:1,expectedEpoch:metadata[0].writerEpoch,document:edited});
 const changed=(await scriptAgentClient.workspaceState(thread.id,project.id,metadata)).workspaces;
 assert.equal(changed[0].document.brief.concept,edited.brief.concept);
 assert.ok(requests.at(-1)!.body.workspaces[0].document,'a new revision includes its full text');
 db.prepare('UPDATE script_project_owners SET owner_id=? WHERE project_id=?').run('revoked',project.id);
 assert.deepEqual((await scriptAgentClient.workspaceState(thread.id,project.id,changed)).workspaces,[],'a known revision cannot bypass current ownership');
});

test('workspace polling never fills missing text from a different version or scope',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({workspaces:[{id:'w',threadId:'t',documentId:'p',revision:2}]})));
 await assert.rejects(scriptAgentClient.workspaceState('t','p',[{id:'w',threadId:'t',documentId:'p',revision:1,document:{}} as any]),/读取版本不一致/);
 await assert.rejects(scriptAgentClient.workspaceState('other','p',[{id:'w',threadId:'t',documentId:'p',revision:2,document:{}} as any]),/读取版本不一致/);
});
