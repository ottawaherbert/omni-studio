import { create } from 'zustand';
import {
  AIConfigSnapshot,
  AIChannel,
  AIModel,
  ComfyWorkflow,
  TaskRouting,
  defaultAIConfig,
  defaultChannels,
  defaultRouting,
  normalizeAIConfig,
} from '../config/aiConfigDefaults';
import { aiConfigClient } from '../clients/aiConfigClient';

export type {
  AIChannel,
  AIModel,
  ChannelType,
  ComfyNodeMapping,
  ComfyWorkflow,
  TaskRouting,
} from '../config/aiConfigDefaults';

interface AIConfigState extends AIConfigSnapshot {
  hasHydrated: boolean;
  isHydrating: boolean;
  isSaving: boolean;
  loadError?: string;

  hydrate: () => Promise<void>;
  saveConfig: (snapshot?: Partial<AIConfigSnapshot>) => Promise<void>;

  addChannel: (channel: AIChannel) => void;
  updateChannel: (id: string, channel: Partial<AIChannel>) => void;
  deleteChannel: (id: string) => void;

  addModel: (model: AIModel) => void;
  updateModel: (id: string, model: Partial<AIModel>) => void;
  deleteModel: (id: string) => void;

  updateRouting: (routing: Partial<TaskRouting>) => void;
  setVisualQcEnabled: (enabled: boolean) => void;

  addComfyWorkflow: (workflow: ComfyWorkflow) => void;
  updateComfyWorkflow: (id: string, workflow: Partial<ComfyWorkflow>) => void;
  deleteComfyWorkflow: (id: string) => void;
  resetToDefaults: () => void;
}

const configSnapshotFromState = (state: AIConfigState): AIConfigSnapshot => ({
  schemaVersion: state.schemaVersion,
  channels: state.channels,
  models: state.models,
  routing: state.routing,
  visualQcEnabled: state.visualQcEnabled,
  comfyWorkflows: state.comfyWorkflows,
});

const readLegacyLocalStorageConfig = (): AIConfigSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('ai-config-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const legacyState = parsed?.state || parsed;
    return normalizeAIConfig(legacyState);
  } catch {
    return null;
  }
};

const hasLegacyUserConfig = (config: AIConfigSnapshot) =>
  config.channels.some((channel) => Boolean(channel.apiKey?.trim())) ||
  config.models.some((model) => Boolean(model.apiKeyOverride?.trim())) ||
  config.models.length > 0 ||
  config.channels.some((channel) => {
    const defaultChannel = defaultChannels.find((item) => item.id === channel.id);
    return !defaultChannel
      || defaultChannel.type !== channel.type
      || defaultChannel.name !== channel.name
      || defaultChannel.baseUrl !== channel.baseUrl;
  }) ||
  JSON.stringify(config.routing) !== JSON.stringify(defaultRouting) ||
  config.visualQcEnabled !== defaultAIConfig.visualQcEnabled ||
  config.comfyWorkflows.length > 0;

let hydratePromise: Promise<void> | null = null;
let saveTimer: number | null = null;

export const useAIConfigStore = create<AIConfigState>()((set, get) => {
  const persistSoon = () => {
    if (typeof window === 'undefined') return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void get().saveConfig();
    }, 250);
  };

  return {
    ...normalizeAIConfig(defaultAIConfig),
    hasHydrated: false,
    isHydrating: false,
    isSaving: false,
    loadError: undefined,

    hydrate: async () => {
      if (get().hasHydrated) return;
      if (hydratePromise) return hydratePromise;

      hydratePromise = (async () => {
        set({ isHydrating: true, loadError: undefined });
        try {
          const payload = await aiConfigClient.loadConfig();
          let config = normalizeAIConfig(payload.config);

          const legacyConfig = readLegacyLocalStorageConfig();
          if (!payload.hasSavedConfig && legacyConfig && hasLegacyUserConfig(legacyConfig)) {
            config = legacyConfig;
            await aiConfigClient.saveConfig(config);
          }

          set({
            ...config,
            hasHydrated: true,
            isHydrating: false,
            loadError: undefined,
          });
        } catch (err: any) {
          set({
            hasHydrated: true,
            isHydrating: false,
            loadError: err?.message || 'AI config load failed',
          });
        } finally {
          hydratePromise = null;
        }
      })();

      return hydratePromise;
    },

    saveConfig: async (snapshot) => {
      const config = normalizeAIConfig({
        ...configSnapshotFromState(get()),
        ...(snapshot || {}),
      });
      set({ isSaving: true });
      try {
        const payload = await aiConfigClient.saveConfig(config);
        set({
          ...normalizeAIConfig(payload.config || config),
          isSaving: false,
          hasHydrated: true,
          loadError: undefined,
        });
      } catch (err: any) {
        set({
          isSaving: false,
          loadError: err?.message || 'AI config save failed',
        });
      }
    },

    addChannel: (channel) => {
      set((state) => ({ channels: [...state.channels, channel] }));
      persistSoon();
    },
    updateChannel: (id, updates) => {
      set((state) => ({
        channels: state.channels.map((channel) => channel.id === id ? { ...channel, ...updates } : channel),
      }));
      persistSoon();
    },
    deleteChannel: (id) => {
      set((state) => {
        const config = normalizeAIConfig({
          ...configSnapshotFromState(state),
          channels: state.channels.filter((channel) => channel.id !== id),
          models: state.models.filter((model) => model.channelId !== id),
        });
        return { channels: config.channels, models: config.models, routing: config.routing };
      });
      persistSoon();
    },

    addModel: (model) => {
      set((state) => ({ models: [...state.models, model] }));
      persistSoon();
    },
    updateModel: (id, updates) => {
      set((state) => ({
        models: state.models.map((model) => model.id === id ? { ...model, ...updates } : model),
      }));
      persistSoon();
    },
    deleteModel: (id) => {
      set((state) => {
        const config = normalizeAIConfig({
          ...configSnapshotFromState(state),
          models: state.models.filter((model) => model.id !== id),
        });
        return { models: config.models, routing: config.routing };
      });
      persistSoon();
    },

    updateRouting: (updates) => {
      set((state) => ({
        routing: { ...state.routing, ...updates },
      }));
      persistSoon();
    },
    setVisualQcEnabled: (enabled) => {
      set({ visualQcEnabled: enabled });
      persistSoon();
    },

    addComfyWorkflow: (workflow) => {
      set((state) => ({ comfyWorkflows: [...state.comfyWorkflows, workflow] }));
      persistSoon();
    },
    updateComfyWorkflow: (id, updates) => {
      set((state) => ({
        comfyWorkflows: state.comfyWorkflows.map((workflow) => workflow.id === id ? { ...workflow, ...updates } : workflow),
      }));
      persistSoon();
    },
    deleteComfyWorkflow: (id) => {
      set((state) => ({
        comfyWorkflows: state.comfyWorkflows.filter((workflow) => workflow.id !== id),
      }));
      persistSoon();
    },

    resetToDefaults: () => {
      set({
        channels: defaultChannels,
        models: [],
        routing: defaultRouting,
        visualQcEnabled: true,
        comfyWorkflows: [],
      });
      persistSoon();
    },
  };
});

if (typeof window !== 'undefined') {
  void useAIConfigStore.getState().hydrate();
}
