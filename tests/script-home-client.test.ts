import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptLibrary } from '../apps/web/src/features/script/ScriptLibrary';
import { useSettingsStore } from '../src/store/useSettingsStore';

function enableTestMode(t:test.TestContext){
  const initial=useSettingsStore.getInitialState(),previousInitial=initial.isTestMode,previous=useSettingsStore.getState().isTestMode;
  // Server rendering reads Zustand's initial snapshot; client requests read current state.
  initial.isTestMode=true;useSettingsStore.setState({isTestMode:true});
  t.after(()=>{initial.isTestMode=previousInitial;useSettingsStore.setState({isTestMode:previous});});
}

test('测试模式与正常模式使用同一作品库入口',t=>{
  enableTestMode(t);
  const html=renderToStaticMarkup(React.createElement(ScriptLibrary,{projects:[],error:'',onOpen:()=>{},onCreate:async()=>{}}));
  assert.match(html,/新建剧本/);assert.match(html,/历史内容存档/);assert.doesNotMatch(html,/给 AI 的消息|首页执行方式|普通模式/);
});
