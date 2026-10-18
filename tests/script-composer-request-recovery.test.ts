import test from 'node:test';
import assert from 'node:assert/strict';
import {composerMatchesSentMessage,composerRequestDecision,queuedRequestAfterSend,sameComposerRequest} from '../apps/web/src/features/script/ScriptDurablePanel';
import type {AssistantRequest} from '../apps/web/src/features/script/scriptAssistantShortcuts';

const request:AssistantRequest={id:1,text:'只修改她决定离开这一变化。',label:'修改关键变化：她决定离开',unitId:'unit_first',stage:'OUTLINE',operation:'outline',draftOperation:'outline_development',scopeId:'season_first',seasonId:'season_first',outlineBeatIds:['beat_leave'],outlineRange:{start:4,end:10,text:'她决定离开。'},outlineStructure:false,outlineSceneOrder:false};
const repeat=(patch:Partial<AssistantRequest>={}):AssistantRequest=>({...structuredClone(request),id:2,...patch});

test('a restored shortcut draft and a repeated button event keep the draft without a replacement prompt',()=>{
  const restored=JSON.parse(JSON.stringify({text:request.text,context:request})) as {text:string;context:AssistantRequest};
  assert.equal(composerRequestDecision(restored.text,restored.context,repeat()),'keep');assert.equal(sameComposerRequest(restored.context,repeat()),true);
  assert.equal(queuedRequestAfterSend(repeat(),request),null,'a duplicate already queued during hydration is dismissed');
});

test('a confirmed send removes only the duplicate queued shortcut, regardless of its fresh event id',()=>{
  const context=repeat(),queued=repeat({id:3});
  assert.equal(composerMatchesSentMessage(context.text,context,request.text,request),true);
  assert.equal(queuedRequestAfterSend(queued,context),null);
  assert.equal(composerRequestDecision('',null,repeat({id:4})),'replace','a later intentional new request may be used after sending');
});

test('an author-edited unsent draft still requires explicit replacement even for the original shortcut',()=>{
  assert.equal(composerRequestDecision('作者另加了一条修改要求。',request,repeat()),'queue');
  assert.equal(composerMatchesSentMessage('作者另加了一条修改要求。',request,request.text,request),false,'an in-flight response cannot clear newer words');
  const queued=repeat();assert.equal(queuedRequestAfterSend(queued,request,'作者发送的是另加要求后的内容。'),queued,'sending edited words does not consume a pending request with different words');
});

test('a general draft with the same words does not silently acquire a shortcut scope',()=>{
  assert.equal(composerRequestDecision(request.text,null,repeat()),'queue');
  assert.equal(sameComposerRequest(null,request),false);assert.equal(queuedRequestAfterSend(request,null),request);
});

const changedTargets:Array<[string,Partial<AssistantRequest>]>=[
  ['beat identity',{outlineBeatIds:['beat_other']}],['beat allowlist',{outlineBeatIds:['beat_leave','beat_other']}],
  ['source start',{outlineRange:{start:5,end:11,text:'她决定离开。'}}],['source quote',{outlineRange:{start:4,end:10,text:'她决定留下。'}}],
  ['structure permission',{outlineStructure:true}],['scene order permission',{outlineSceneOrder:true}],
  ['season',{seasonId:'season_second'}],['outline owner',{scopeId:'story_other'}],['unit',{unitId:'unit_second'}],
  ['scene',{sceneId:'scene_second'}],['node',{nodeId:'node_other'}],['operation',{operation:'consult'}],
  ['draft operation',{draftOperation:'scene_plan'}],['selected body',{selection:{start:1,end:3,text:'正文'}}],
  ['analysis',{analysis:true}],['stage',{stage:'BODY'}],['content',{text:'改变另一条具体变化。'}]
];
for(const [label,patch] of changedTargets)test(`the same words with different ${label} stay queued and survive another target's successful send`,()=>{
  const next=repeat(patch),before=structuredClone(next);
  assert.equal(composerRequestDecision(request.text,request,next),'queue');assert.equal(sameComposerRequest(request,next),false);
  assert.equal(queuedRequestAfterSend(next,request),next);assert.deepEqual(next,before);
});

test('a current draft with the same message but a new scope is not cleared by the old send receipt',()=>{
  const next=repeat({outlineBeatIds:['beat_other']});assert.equal(composerMatchesSentMessage(next.text,next,request.text,request),false);
  assert.equal(queuedRequestAfterSend(next,request),next);
});

test('durable recovery retains the original composer context outside the server message body',()=>{
  const pending={threadId:'thread_isolated',composerContext:request,body:{requestId:'server_turn_id',text:request.text,selection:{outlineBeatIds:request.outlineBeatIds}}};
  const restored=JSON.parse(JSON.stringify(pending));
  assert.equal(composerMatchesSentMessage(request.text,request,restored.body.text,restored.composerContext),true);
  assert.equal(queuedRequestAfterSend(repeat(),restored.composerContext),null);
  assert.deepEqual(Object.keys(restored.body),['requestId','text','selection'],'composer recovery metadata does not enter the server request');
});

test('older pending messages remain recoverable without assuming an unrecorded shortcut identity',()=>{
  assert.equal(composerMatchesSentMessage(request.text,null,request.text,undefined),true,'an unscoped identical draft retains legacy cleanup');
  assert.equal(composerMatchesSentMessage(request.text,request,request.text,undefined),false,'an explicit current shortcut cannot be identified by an old unscoped record');
  for(const patch of [{outlineBeatIds:['beat_other']},{scopeId:'story_other',seasonId:undefined},{outlineRange:{start:5,end:11,text:'她决定离开。'}}]){
    const scoped=repeat(patch);assert.equal(composerMatchesSentMessage(scoped.text,scoped,request.text,undefined),false,'same words do not grant an old receipt the right to clear a new beat, owner or range');
  }
  assert.equal(composerMatchesSentMessage('后来输入的新内容',request,request.text,undefined),false);
  assert.equal(composerMatchesSentMessage('后来输入的新内容',null,request.text,undefined),false);
  assert.equal(queuedRequestAfterSend(repeat(),null)?.outlineBeatIds?.[0],'beat_leave');
});
