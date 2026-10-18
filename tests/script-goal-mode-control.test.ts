import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseThreadGoals } from '../apps/web/src/features/script/scriptGoalControl';
import type { AgentRun } from '../packages/agent-core/src';

const run=(id:string,status:AgentRun['status'],kind:AgentRun['kind']='GOAL')=>({id,status,kind,version:7} as AgentRun);
const conversation={get:async()=>({conversation:{turns:[]}})} as any;
test('manual takeover pauses every working Goal with its version; waiting ASK and terminal runs stay unchanged',async()=>{
  const runs=['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','WAITING_INPUT','PAUSED','SUCCEEDED'].map((status,i)=>({run:run(String(i),status as AgentRun['status'])}));
  const calls:unknown[]=[];
  await pauseThreadGoals('thread',{runs:async()=>({runs}) as any,control:async(r,action)=>{calls.push([r.id,r.version,action]);return {run:{...r,status:'PAUSED'}};}},conversation);
  assert.deepEqual(calls,[['0',7,'pause'],['1',7,'pause'],['2',7,'pause'],['3',7,'pause']]);
});
test('pause failure prevents switching and retry uses a fresh version; switching never resumes',async()=>{
  let mode='agent',version=7;
  const calls:unknown[]=[];
  const client={runs:async()=>({runs:[{run:run('goal','RUNNING') ,workspaceId:'workspace',goalId:'goal'}].map(x=>({...x,run:{...x.run,version}}))}),control:async(r:AgentRun,action:any)=>{calls.push([r.version,action]);if(r.version===7)throw new Error('任务状态已更新，请刷新后重试');return {run:{...r,status:'PAUSED' as const}};}};
  await assert.rejects(async()=>{await pauseThreadGoals('thread',client,conversation);mode='manual';},/状态已更新/);
  assert.equal(mode,'agent');version=8;
  await pauseThreadGoals('thread',client,conversation);mode='manual';
  assert.equal(mode,'manual');assert.deepEqual(calls,[[7,'pause'],[8,'pause']]);
});
test('pending chat that could start a Goal prevents premature manual switch',async()=>{
  let controls=0;
  await assert.rejects(pauseThreadGoals('thread',{runs:async()=>({runs:[]}),control:async()=>{controls++;throw new Error('unexpected');}},
    {get:async()=>({conversation:{turns:[{status:'RUNNING'}]}})} as any),/消息尚未完成/);
  assert.equal(controls,0);
});

test('unresolved Goal prevents manual switch until the author reconciles the original result',async()=>{
  let controls=0;
  await assert.rejects(pauseThreadGoals('thread',{runs:async()=>({runs:[{run:run('unknown','RECONCILIATION_REQUIRED'),workspaceId:'workspace',goalId:'goal'}]}),
    control:async()=>{controls++;throw new Error('unexpected');}},conversation),/委托结果待核对/);
  assert.equal(controls,0);
});
