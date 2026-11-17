export class TextProviderError extends Error { constructor(public code:string,message:string,public status=409){super(message);} }
export type ModelRequest = {
  operationKey: string;
  channel: 'api' | 'external';
  routeRef: string;
  prompt: string;
  systemInstruction?: string;
  outputSchema?: Record<string, unknown>;
  outputFormat?: 'text' | 'json';
  inputManifest?: Record<string, unknown>;
  contextRef?: { id: string; digest: string };
  formatCorrection?: { sourceInvocationId: string; sourceResultHash: string; invalidText: string; problem: string };
};
export type ModelResult = {
  text: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  provenance: { channel: 'provider' | 'external-return'; producer?: string; model?: string; [key: string]: unknown };
  validationErrors?: string[];
  metadataSnapshot?: string;
  failure?: { kind: 'HTTP' | 'REFUSAL' | 'INCOMPLETE' | 'INVALID_RESPONSE'; code: string; message: string; httpStatus?: number };
  correctionInvocationId?: string;
};

export interface ModelTransport {
  // Local validation only: must not send a provider request. Failure here is
  // known not dispatched, so it must precede physical attempt accounting.
  preflight?(request: ModelRequest): void | Promise<void>;
  // The host must disable hidden SDK/proxy retries: one call is one attempt.
  sendOnce(request: ModelRequest, context: { attemptId: string; signal: AbortSignal }): Promise<ModelResult>;
  // Read only the frozen route; never use newly edited channel settings here.
  outputPolicy?(request: ModelRequest): { validateSchema: boolean; maxFormatCorrections: 0 | 1 };
}

export class ModelResponseError extends TextProviderError {
  constructor(public readonly result: ModelResult) {
    super(result.failure!.code, result.failure!.message, 502);
  }
}
