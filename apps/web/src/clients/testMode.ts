import { useSettingsStore } from '../../../../src/store/useSettingsStore';

export const testModeEnabled = () => useSettingsStore.getState().isTestMode === true;
export const requireTestMode = () => {
  if (!testModeEnabled()) throw Object.assign(new Error('复制回填仅用于测试，请先在「设置 → 基本设置」开启测试模式。'), { code: 'TEST_MODE_REQUIRED' });
};
/** Reject stale test submissions rather than silently turn them into paid API calls. */
export function checkTestSubmission(body: unknown) {
  const value = body as { executionChannel?: string; executionMode?: string; provenance?: { source?: string } } | undefined;
  if (value?.executionChannel === 'external' || value?.executionMode === 'manual' || value?.provenance?.source === 'manual_external') requireTestMode();
}
