import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AIProvider = 'google' | 'deepseek';
export type ThemeMode = 'light' | 'dark' | 'system';
export type EdgeLineMode = 'bezier' | 'orthogonal' | 'straight';

interface SettingsState {
  isTestMode: boolean;
  setIsTestMode: (enabled: boolean) => void;
  aiProvider: AIProvider;
  setAiProvider: (provider: AIProvider) => void;
  isFastMode: boolean;
  setIsFastMode: (enabled: boolean) => void;
  isAutoProductionModeEnabled: boolean;
  setIsAutoProductionModeEnabled: (enabled: boolean) => void;
  isStoryChapterGateEnabled: boolean;
  setIsStoryChapterGateEnabled: (enabled: boolean) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  edgeLineMode: EdgeLineMode;
  setEdgeLineMode: (mode: EdgeLineMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isTestMode: false,
      setIsTestMode: (enabled) => set({ isTestMode: enabled }),
      aiProvider: 'google', // Default to google
      setAiProvider: (provider) => set({ aiProvider: provider }),
      isFastMode: false,
      setIsFastMode: (enabled) => set({ isFastMode: enabled }),
      isAutoProductionModeEnabled: true,
      setIsAutoProductionModeEnabled: (enabled) => set({ isAutoProductionModeEnabled: enabled }),
      isStoryChapterGateEnabled: false,
      setIsStoryChapterGateEnabled: (enabled) => set({ isStoryChapterGateEnabled: enabled }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      edgeLineMode: 'bezier',
      setEdgeLineMode: (edgeLineMode) => set({ edgeLineMode }),
    }),
    {
      name: 'settings-storage',
    }
  )
);

// A settings tab also updates already-open writing tabs in this browser.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === 'settings-storage') void useSettingsStore.persist.rehydrate();
});
