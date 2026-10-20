import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ManualAIResultField } from '../src/components/ManualAIResultField';
import { useSettingsStore } from '../src/store/useSettingsStore';

test('normal external-video flow offers copying and the real import path without exposing test result injection', () => {
  const previous = useSettingsStore.getState().isTestMode;
  try {
    useSettingsStore.setState({ isTestMode: false });
    const render = (manualOnly: boolean) => renderToStaticMarkup(React.createElement(ManualAIResultField, { prompt: '外部视频任务', kind: 'video', manualOnly, onChange: () => {} }));
    assert.equal(render(false), '');
    assert.match(render(true), /复制完整提示词/);
    assert.match(render(true), /导入视频/);
    assert.doesNotMatch(render(true), /上传结果|填写 AI 返回/);
  } finally { useSettingsStore.setState({ isTestMode: previous }); }
});
