import test from 'node:test';
import assert from 'node:assert/strict';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { checkTestSubmission, requireTestMode, testModeEnabled } from '../apps/web/src/clients/testMode';
import {  scriptClient } from '../apps/web/src/clients/scriptClient';
import { withManualAIResult, resolveManualAIRequest, getManualAIPending, answerManualAI, cancelManualAI } from '../apps/web/src/clients/manualAIClient';

test('test tools are off by default and API submissions remain available', () => {
  assert.equal(useSettingsStore.getInitialState().isTestMode, false);
  useSettingsStore.setState({isTestMode:false});
  assert.equal(testModeEnabled(), false);
  assert.throws(requireTestMode, /测试模式/);
  for (const body of [{executionChannel:'external'},{executionMode:'manual'},{provenance:{source:'manual_external'}}])
    assert.throws(()=>checkTestSubmission(body), /测试模式/);
  assert.doesNotThrow(()=>checkTestSubmission({executionChannel:'api'}));
  assert.doesNotThrow(()=>checkTestSubmission({kind:'APPLY'}));
});

test('normal API execution bypasses manual dialogs and a stale manual seed cannot switch to API', async()=>{
  useSettingsStore.setState({isTestMode:false});let executed=false;
  const value=await withManualAIResult('',undefined,()=>resolveManualAIRequest({kind:'text',prompt:'API request'}),true);
  assert.equal(value,undefined);assert.equal(getManualAIPending(),undefined);
  await assert.rejects(()=>withManualAIResult('',{kind:'text',text:'old test'},()=>{executed=true;}),/测试模式/);
  await assert.rejects(()=>withManualAIResult('',undefined,()=>{executed=true;},false,true),/测试模式/);
  assert.equal(executed,false);
});

test('enabled test mode accepts explicit copy/return, disabling blocks its pending answer', async t=>{
  useSettingsStore.setState({isTestMode:true});
  t.after(()=>useSettingsStore.setState({isTestMode:false}));
  assert.doesNotThrow(()=>checkTestSubmission({executionChannel:'external'}));
  const promise=withManualAIResult('',undefined,()=>resolveManualAIRequest({kind:'text',prompt:'test prompt'}),false,true);
  await Promise.resolve();
  const pending=getManualAIPending()!;assert.equal(pending.prompt,'test prompt');
  useSettingsStore.setState({isTestMode:false});
  assert.throws(()=>answerManualAI(pending.id,{kind:'text',text:'test answer'}),/测试模式/);
  cancelManualAI(pending.id);
  await assert.rejects(()=>promise,/取消/);
  assert.equal(getManualAIPending(),undefined);
});
