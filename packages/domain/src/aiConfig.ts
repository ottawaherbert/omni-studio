import type { AIConfigSnapshot } from "../../../src/config/aiConfigDefaults";

export type AIConfigDTO = AIConfigSnapshot;

export interface AIConfigResponse {
  config: AIConfigDTO;
  hasSavedConfig: boolean;
  updatedAt?: number;
}

export type ProviderKeyStatusResponse = Record<string, unknown>;
