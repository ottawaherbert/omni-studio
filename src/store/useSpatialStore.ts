import { create } from 'zustand';
import { SpatialComposition } from '../types/project';

export interface SpatialEntity {
  id: string;
  type: 'character' | 'prop';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  label?: string;
  model3dUrl?: string;
}

interface SpatialState {
  entities: SpatialEntity[];
  activeEntityId: string | null;
  isCapturing: boolean;
  addEntity: (entity: SpatialEntity) => void;
  updateEntity: (id: string, updates: Partial<SpatialEntity>) => void;
  setActiveEntity: (id: string | null) => void;
  clearEntities: () => void;
  setIsCapturing: (isCapturing: boolean) => void;
}

export const useSpatialStore = create<SpatialState>((set) => ({
  entities: [],
  activeEntityId: null,
  isCapturing: false,
  addEntity: (entity) => set((state) => ({ entities: [...state.entities, entity] })),
  updateEntity: (id, updates) => set((state) => ({
    entities: state.entities.map(e => e.id === id ? { ...e, ...updates } : e)
  })),
  setActiveEntity: (id) => set({ activeEntityId: id }),
  clearEntities: () => set({ entities: [], activeEntityId: null }),
  setIsCapturing: (isCapturing) => set({ isCapturing }),
}));
