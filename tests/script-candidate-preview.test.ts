import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScriptCandidateCard} from '../apps/web/src/features/script/components/ScriptCandidateCard';
import {createScriptProject,newScene} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {hashValue} from '../packages/agent-core/src';
import type {ScriptCandidateView} from '../apps/web/src/clients/scriptClient';

test('plain candidate display avoids full manuscript cloning while relationship previews still resolve new scenes',t=>{
 const project=createScriptProject('候选展示',createScriptCreationProfile('short-film',1,3));
 const plain=structuredClone(project);plain.brief.concept='只显示这一段候选';
 const structure=structuredClone(project);structure.units[0].scenes.push(newScene('新场景的名字'));
 const candidate=(operation:'concept'|'scene_order',after:typeof project):ScriptCandidateView=>{
  const patch=createWorkspacePatch(project,after),request={candidateId:'candidate',operation};
  return {id:'candidate',workspaceId:'work',runId:null,status:'VALID',error:null,baseRef:null,modelInputHash:null,
   appliedRevision:null,request,candidate:{request,patch,result:{summary:''},idMap:{},patchDigest:hashValue(patch),baseRevision:project.revision,baseContentHash:hashValue(project)}};
 };
 const simple=candidate('concept',plain),linked=candidate('scene_order',structure);
 const before=JSON.stringify(project),clones=t.mock.method(globalThis,'structuredClone');
 const render=(value:ScriptCandidateView)=>renderToStaticMarkup(React.createElement(ScriptCandidateCard,{candidate:value,project,handled:false,busy:false,onAdopt:()=>{}}));
 assert.match(render(simple),/只显示这一段候选/);
 assert.equal(clones.mock.callCount(),0,'displaying plain text does not rebuild the current manuscript');
 assert.match(render(linked),/第 1 场 → 新场景的名字/,'relationship labels use the proposed structure');
 assert.ok(clones.mock.callCount()>0,'relationship preview retains normal patch validation');
 assert.equal(JSON.stringify(project),before,'display never modifies the author manuscript');
});
