import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {Toaster} from 'react-hot-toast';
import ScriptWorkspace from '../../apps/web/src/features/script/ScriptWorkspace';
import ManualAIRequestHost from '../../src/components/ManualAIRequestHost';
import '../../src/index.css';
import '../../src/i18n';
import {installIdeationMock} from './script-ideation-mock';
import {useSettingsStore} from '../../apps/web/src/clients/stateClient';
declare const __SCRIPT_IDEATION_ACCEPTANCE__: boolean;
if (new URLSearchParams(location.search).get('storageFault') === 'draft-quota') {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key: string, value: string) {
    if (this === localStorage && key.startsWith('omni.script.draft.'))
      throw new DOMException('隔离验收注入：本机草稿空间不足', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  };
}
if (__SCRIPT_IDEATION_ACCEPTANCE__) installIdeationMock();
// Explicit opt-in on the isolated harness, never included in the production app.
if (new URLSearchParams(location.search).get('testMode') === '1') useSettingsStore.setState({isTestMode:true});
createRoot(document.getElementById('root')!).render(<BrowserRouter><div style={{height:'100vh'}}><ScriptWorkspace/></div><ManualAIRequestHost/><Toaster/></BrowserRouter>);
