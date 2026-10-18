import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PromptCompositionManifest } from "../services/production/promptComposition";

export interface StoredPromptCompositionAudit {
  id: string;
  createdAt: number;
  phase: "initial" | "structured_output_fallback" | "image_generation" | "video_generation";
  taskType: string;
  channelType: string;
  modelId: string;
  manifest: PromptCompositionManifest;
}

interface PromptCompositionAuditState {
  records: StoredPromptCompositionAudit[];
  record: (audit: Omit<StoredPromptCompositionAudit, "id" | "createdAt">) => void;
  clear: () => void;
}

const auditId = () => globalThis.crypto?.randomUUID?.()
  || `prompt-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const usePromptCompositionAuditStore = create<PromptCompositionAuditState>()(
  persist(
    (set) => ({
      records: [],
      record: (audit) => set((state) => ({
        records: [...state.records, { ...audit, id: auditId(), createdAt: Date.now() }],
      })),
      clear: () => set({ records: [] }),
    }),
    {
      name: "omni-prompt-composition-audits-v1",
      version: 1,
    },
  ),
);
