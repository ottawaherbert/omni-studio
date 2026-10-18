import { useState } from 'react';
import { useSettingsStore } from '../../clients/stateClient';

type Channel = 'api' | 'external';
export function useScriptExecutionChannel(initial: Channel | (() => Channel) = 'api') {
  const isTestMode = useSettingsStore(state => state.isTestMode);
  const [selected, setChannel] = useState<Channel>(initial);
  // Old local preferences and historical test goals must not select copy/return
  // for a new normal-mode request, even before effects run.
  const channel: Channel = isTestMode ? selected : 'api';
  return { isTestMode, channel, setChannel };
}
