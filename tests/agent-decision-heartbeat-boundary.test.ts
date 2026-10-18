import test from 'node:test';
import assert from 'node:assert/strict';
import {DecisionDriver, hashValue} from '../packages/agent-core/src';

test('completion proof commit runs after a heartbeat turn following synchronous assessment',async()=>{
 const token={runId:'run',workerId:'worker',fence:1,generation:1,inputRevision:1};
 const run={id:'run'};
 const execution={run,goal:{id:'goal'},link:{role:'GOAL_CONTROLLER',goalId:'goal'}};
 const turn={id:'turn',runId:'run',inputGeneration:1,state:'OPEN',nextDecisionIndex:0};
 const decision={id:'decision',callId:null,consumed:false,decision:{kind:'FINISH',artifactRefs:[],summary:'MECHANICAL_FINISH'}};
 const sampling={id:'sampling',turnId:'turn',index:0,inputGeneration:1,progressFingerprint:'state:1',
  allowedToolsDigest:hashValue([]),modelRequest:{inputManifest:{allowedGoalTools:[]}},acceptedDecision:decision};
 let assessmentDone=false,checkpointAfterAssessment=false,finished=false;
 const goals={
  execution:()=>execution,openTurn:()=>turn,readSampling:()=>sampling,
  finishDecision:()=>{assert.equal(checkpointAfterAssessment,true);finished=true;},
 } as any;
 const plugin={
  projectProgress:async()=>({fingerprint:'state:1',remainingWork:[]}),
  assessCompletion:async()=>{assessmentDone=true;
   return {complete:true,gaps:[],completionProof:{mechanical:true},verifiedArtifactRefs:[],evidence:[]};},
 } as any;
 const driver=new DecisionDriver(goals,{} as any,{} as any,plugin);
 const result=await driver.handle({run,token,signal:new AbortController().signal,checkpoint:async()=>{if(assessmentDone)checkpointAfterAssessment=true;},call:async()=>{throw new Error('No CALL expected');}} as any);
 assert.deepEqual(result,{kind:'SETTLED'});
 assert.equal(finished,true);
});
