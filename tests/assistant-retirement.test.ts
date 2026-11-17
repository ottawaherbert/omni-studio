import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {registerScriptArchiveRoutes} from '../apps/api/src/routes/scriptArchiveRoutes';
import {createScriptProjectFromMaterial,createScriptCreationProfile} from '../packages/script/src/creation';

test('retired candidates remain readable while all mutation paths reject and current稿 stays intact',()=>{
 const db=new Database(':memory:');try{
 const repo=createScriptRepository(db);repo.ensureSchema();
 const p=repo.saveProject(createScriptProjectFromMaterial('隔离样例',createScriptCreationProfile('short-film',1,5)),0),u=p.units[0];
 const job=repo.createJob(p.id,{operation:'concept',unitId:u.id,sceneId:u.id,expectedRevision:p.revision,prompt:'固定输入',methodIds:[]});
 repo.submitJob(p.id,job.id,JSON.stringify({summary:'固定返回',suggestions:[{title:'方案',content:'新的前提'}]}),{source:'manual_external',provider:'fixture',modelId:'fixture'});
 const ready=repo.getJob(p.id,job.id);
 db.prepare('UPDATE script_jobs SET data=? WHERE id=?').run(JSON.stringify({...ready,agentRunId:'retired-run'}),job.id);
 assert.equal(repo.getJob(p.id,job.id).readOnly,true);
 assert.equal(repo.listJobs(p.id)[0].result?.suggestions?.[0].content,'新的前提');
 for(const action of ['approve','reject','cancel'] as const)assert.throws(()=>repo.transition(p.id,job.id,action,0),/历史助手任务/);
 assert.throws(()=>repo.failJob(p.id,job.id,'failed'),/历史助手任务/);
 assert.throws(()=>repo.submitJob(p.id,job.id,'{}',{source:'manual_external',provider:'fixture',modelId:'fixture'}),/历史助手任务/);
 assert.throws(()=>repo.createJob(p.id,{operation:'concept',unitId:u.id,sceneId:u.id,expectedRevision:p.revision,prompt:'x',agentRunId:'new',methodIds:[]}),/已移除/);
 assert.deepEqual(repo.getProject(p.id),p);
 }finally{db.close();}
});

test('archive exports are bounded and read only; a fresh database creates no retired tables',async()=>{
 const db=new Database(':memory:');const app=express();registerScriptArchiveRoutes(app,db);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/script-archives`;
 try{
 assert.equal((await (await fetch(base+'/workspaces')).json()).rows.length,0);
 assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as {n:number}).n,0);
 db.exec('CREATE TABLE script_workspaces(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 for(let n=0;n<201;n++)db.prepare('INSERT INTO script_workspaces VALUES(?,?)').run(String(n),JSON.stringify({draft:'保留'+n}));
 const first=await (await fetch(base+'/workspaces')).json();assert.equal(first.rows.length,200);assert.equal(first.readOnly,true);assert.ok(first.next.endsWith('offset=200'));
 assert.equal((await (await fetch(base+'/workspaces?offset=200')).json()).rows.length,1);
 assert.equal((await fetch(base+'/workspaces?offset=-1')).status,400);
 assert.equal((await fetch(base+'/unknown')).status,404);
 assert.equal((await fetch(base+'/workspaces',{method:'DELETE'})).status,404);
 assert.equal((db.prepare('SELECT count(*) AS n FROM script_workspaces').get() as {n:number}).n,201);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});
