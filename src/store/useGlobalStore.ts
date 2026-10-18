import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VisualImageAdoptionAudit, VisualImageCandidate } from '../types/project';

export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  tags: string[];
  apiUrl: string;
  method: 'POST' | 'GET';
  headers: string;
  bodyTemplate: string;
  audioPath: string;
  testAudioUrl?: string;
}

export interface GlobalAsset {
  id: string;
  type: 'character' | 'location' | 'prop' | 'vfx' | 'sfx' | 'wardrobe' | 'makeupHair' | 'vehicles' | 'extrasAtmosphere' | 'specialEquipment' | 'bgm';
  name: string;
  description: string;
  imageUrls: string[];
  /** Generated previews awaiting an explicit human adoption action. */
  visualImageCandidates?: VisualImageCandidate[];
  /** Immutable audit snapshots retained after a generated candidate is adopted. */
  visualImageAdoptionAudits?: VisualImageAdoptionAudit[];
  url?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BgmSettings {
  provider: 'gemini' | 'custom';
  customApiUrl?: string;
  customApiKey?: string;
  customKeySource?: 'serverEnv' | 'local';
  customApiKeyEnvName?: string;
  customModelId?: string;
}

interface GlobalState {
  globalAssets: GlobalAsset[];
  voiceProfiles: VoiceProfile[];
  bgmSettings: BgmSettings;
  
  addGlobalAsset: (asset: Omit<GlobalAsset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void;
  updateGlobalAsset: (id: string, asset: Partial<GlobalAsset>) => void;
  deleteGlobalAsset: (id: string) => void;
  
  addVoiceProfile: (profile: Omit<VoiceProfile, 'id'>) => void;
  updateVoiceProfile: (id: string, profile: Partial<VoiceProfile>) => void;
  deleteVoiceProfile: (id: string) => void;

  updateBgmSettings: (settings: Partial<BgmSettings>) => void;
}

export const useGlobalStore = create<GlobalState>()(
  persist(
    (set) => ({
      globalAssets: [],
      voiceProfiles: [],
      bgmSettings: {
        provider: 'gemini',
      },
      
      addGlobalAsset: (asset) => set((state) => ({
        globalAssets: [
          ...state.globalAssets,
          {
            ...asset,
            id: asset.id || crypto.randomUUID(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        ]
      })),
      
      updateGlobalAsset: (id, asset) => set((state) => ({
        globalAssets: state.globalAssets.map(a => 
          a.id === id ? { ...a, ...asset, updatedAt: Date.now() } : a
        )
      })),
      
      deleteGlobalAsset: (id) => set((state) => ({
        globalAssets: state.globalAssets.filter(a => a.id !== id)
      })),
      
      addVoiceProfile: (profile) => set((state) => ({
        voiceProfiles: [
          ...state.voiceProfiles,
          {
            ...profile,
            id: crypto.randomUUID(),
          }
        ]
      })),
      
      updateVoiceProfile: (id, profile) => set((state) => ({
        voiceProfiles: state.voiceProfiles.map(p => 
          p.id === id ? { ...p, ...profile } : p
        )
      })),
      
      deleteVoiceProfile: (id) => set((state) => ({
        voiceProfiles: state.voiceProfiles.filter(p => p.id !== id)
      })),

      updateBgmSettings: (settings) => set((state) => ({
        bgmSettings: { ...state.bgmSettings, ...settings }
      }))
    }),
    {
      name: 'global-storage',
    }
  )
);
