const parseOperatorResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `HTTP ${response.status}`);
  }
  return response.json();
};

const operatorProjectPath = (projectId: string, suffix: string) =>
  `/api/operator/projects/${encodeURIComponent(projectId)}${suffix}`;

const postJson = <T,>(url: string, body: unknown): Promise<T> =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => parseOperatorResponse<T>(response));

const getJson = <T,>(url: string, init?: RequestInit): Promise<T> =>
  fetch(url, init).then((response) => parseOperatorResponse<T>(response));

export const createCreativeChange = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/creative-changes"), body);

export const createCastingDecision = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/casting-decisions"), body);

export const createCastingCandidate = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/casting-candidates"), body);

export const createStoryboardStrategyTrial = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/storyboard-strategy-trials"), body);

export const createStoryboardStrategyPromotion = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/storyboard-strategy-promotions"), body);

export const getOperatorRuns = <T = unknown>(projectId: string, init?: RequestInit) =>
  getJson<T>(`/api/operator/runs?projectId=${encodeURIComponent(projectId)}`, init);

export const getOperatorArtifacts = <T = unknown>(projectId: string, init?: RequestInit) =>
  getJson<T>(`/api/operator/artifacts?projectId=${encodeURIComponent(projectId)}`, init);

export const getOperatorAssets = <T = unknown>(projectId: string, init?: RequestInit) =>
  getJson<T>(`/api/operator/assets?projectId=${encodeURIComponent(projectId)}`, init);

export const reviewStoryboardMediaCandidate = (
  projectId: string,
  assetId: string,
  decision: "adopt" | "discard",
) => postJson<OperatorRegisteredAsset>(
  `${operatorProjectPath(projectId, `/assets/${encodeURIComponent(assetId)}/${decision}`)}`,
  {},
);

export const getProductionCockpit = <T = unknown>(
  projectId: string,
  options: {
    environment?: string;
    stageType?: string;
    scope?: string;
    episodeIds?: string[];
    init?: RequestInit;
  } = {},
) => {
  const params = new URLSearchParams();
  if (options.environment) params.set("environment", options.environment);
  if (options.stageType) params.set("stageType", options.stageType);
  if (options.scope) params.set("scope", options.scope);
  options.episodeIds?.forEach((episodeId) => params.append("episodeIds", episodeId));
  const query = params.toString();
  return getJson<T>(operatorProjectPath(projectId, `/production-cockpit${query ? `?${query}` : ""}`), options.init);
};

export const createLegacyProductionDraft = <T = unknown>(
  projectId: string,
  body: unknown,
  options: { environment?: string } = {},
) => {
  const params = new URLSearchParams();
  if (options.environment) params.set("environment", options.environment);
  const query = params.toString();
  return postJson<T>(operatorProjectPath(projectId, `/legacy-production-draft${query ? `?${query}` : ""}`), body);
};

export const createStyleReferenceAnalysis = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/style-reference-analysis"), body);

export const createStyleLockChangeOrder = <T = unknown>(projectId: string, body: unknown) =>
  postJson<T>(operatorProjectPath(projectId, "/style-lock-change-orders"), body);
import type { OperatorRegisteredAsset } from "../../../../packages/domain/src/operatorApi";

export type { OperatorRegisteredAsset } from "../../../../packages/domain/src/operatorApi";
