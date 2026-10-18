import { create } from 'zustand';
import { produce } from 'immer';
import { GameNode, GameChoice, GameVariable, GameProjectData, GameNodeSnapshot } from '../types/game';

interface GameState {
  // Store active project and episode IDs
  projectId: string | null;
  episodeId: string | null;
  data: GameProjectData;
  initGameProject: (projectId: string, episodeId?: string) => void;
  updateNode: (nodeId: string, updates: Partial<GameNode>) => void;
  addNode: (node: GameNode) => void;
  deleteNode: (nodeId: string) => void;
  addEdge: (edge: GameChoice) => void;
  updateEdge: (edgeId: string, updates: Partial<GameChoice>) => void;
  deleteEdge: (edgeId: string) => void;
  addVariable: (variable: GameVariable) => void;
  deleteVariable: (variableId: string) => void;
  createNodeSnapshot: (nodeId: string, reason: string) => GameNodeSnapshot | null;
  restoreNodeSnapshot: (snapshotId: string) => void;
  deleteNodeSnapshot: (snapshotId: string) => void;
  setGameData: (data: GameProjectData) => void;
}

export const getDefaultGameData = (): GameProjectData => ({
  variables: [],
  nodes: [],
  edges: [],
  blueprint: '',
  currentStep: 1,
  nodeSnapshots: [],
});

export const useGameStore = create<GameState>((set) => ({
  projectId: null,
  episodeId: null,
  data: getDefaultGameData(),

  initGameProject: (projectId: string, episodeId?: string) => set((state) => {
    // Re-initialize if either project or episode changes
    if (state.projectId === projectId && state.episodeId === (episodeId || null)) {
      return state;
    }
    return { projectId, episodeId: episodeId || null, data: getDefaultGameData() };
  }),

  addNode: (node) => set((state) => ({
    data: { ...state.data, nodes: [...state.data.nodes, node] }
  })),

  updateNode: (nodeId, updates) => set((state) => {
    return produce(state, (draft: any) => {
      const node = draft.data.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        // Deep merge updates
        for (const key of Object.keys(updates)) {
           if (typeof (updates as any)[key] === 'object' && (updates as any)[key] !== null && !Array.isArray((updates as any)[key])) {
             node[key] = { ...node[key], ...(updates as any)[key] };
           } else {
             node[key] = (updates as any)[key];
           }
        }
      }
    });
  }),

  deleteNode: (nodeId) => set((state) => ({
    data: {
      ...state.data,
      nodes: state.data.nodes.filter(n => n.id !== nodeId),
      // remove connected edges
      edges: state.data.edges.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId)
    }
  })),

  addEdge: (edge) => set((state) => ({
    data: { ...state.data, edges: [...state.data.edges, edge] }
  })),

  updateEdge: (edgeId, updates) => set((state) => ({
    data: {
      ...state.data,
      edges: state.data.edges.map(e => e.id === edgeId ? { ...e, ...updates } : e)
    }
  })),

  deleteEdge: (edgeId) => set((state) => ({
    data: {
      ...state.data,
      edges: state.data.edges.filter(e => e.id !== edgeId)
    }
  })),

  addVariable: (v) => set((state) => ({
    data: { ...state.data, variables: [...state.data.variables, v] }
  })),

  deleteVariable: (vId) => set((state) => ({
    data: {
      ...state.data,
      variables: state.data.variables.filter(v => v.id !== vId)
    }
  })),

  createNodeSnapshot: (nodeId, reason) => {
    let snapshot: GameNodeSnapshot | null = null;
    set((state) => {
      const node = state.data.nodes.find(n => n.id === nodeId);
      if (!node) return state;
      snapshot = {
        id: `node-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        nodeId,
        reason,
        node: JSON.parse(JSON.stringify(node)),
        createdAt: Date.now(),
      };
      const existing = state.data.nodeSnapshots || [];
      const scoped = existing.filter(item => item.nodeId === nodeId);
      const other = existing.filter(item => item.nodeId !== nodeId);
      return {
        data: {
          ...state.data,
          nodeSnapshots: [...other, snapshot, ...scoped].slice(0, other.length + 8),
        },
      };
    });
    return snapshot;
  },

  restoreNodeSnapshot: (snapshotId) => set((state) => {
    const snapshot = state.data.nodeSnapshots?.find(item => item.id === snapshotId);
    if (!snapshot) return state;
    return {
      data: {
        ...state.data,
        nodes: state.data.nodes.map(node => node.id === snapshot.nodeId ? JSON.parse(JSON.stringify(snapshot.node)) : node),
      },
    };
  }),

  deleteNodeSnapshot: (snapshotId) => set((state) => ({
    data: {
      ...state.data,
      nodeSnapshots: (state.data.nodeSnapshots || []).filter(item => item.id !== snapshotId),
    },
  })),

  setGameData: (newData) => set({ data: newData }),

}));
