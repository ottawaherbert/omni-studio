import { aiAwareFetch } from "./manualAIClient";
/**
 * Web Client for Interactive Graph AI Authoring API
 * Current architecture and boundaries: doc/design.md.
 */

import type { InteractiveGraphDraft } from '../../../../src/domains/interactive/authoring/graphDraft';
import type { ExperienceSpec, InteractiveExperience, InteractiveExperienceAggregate, NarrativeGraphVersion, StateSchema, StoryArchitecture } from '../../../../src/domains/interactive/types/schema';

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Interactive Authoring API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

const draftPathFor = (experienceId: string, suffix = '') =>
  `/api/interactive/experiences/${encodeURIComponent(experienceId)}/graph-drafts${suffix}`;

const postJson = <T>(url: string, body: unknown) => {
  return aiAwareFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((res) => parseResponse<T>(res));
};

export interface CreateGraphDraftApiInput {
  action: 'initial' | 'blueprint' | 'golden_path' | 'extend' | 'strategy' | 'repair' | 'revise';
  authorIntent: string;
  expectedGraphVersionIndex?: number;
  revisionOfDraftId?: string;
  scopeNodeId?: string;
  strategy?: 'foldback' | 'parallel' | 'failure';
  issueIds?: string[];
}

export interface AdoptGraphDraftApiResponse {
  success: boolean;
  draft: InteractiveGraphDraft;
  newGraph?: NarrativeGraphVersion;
  stateSchema?: StateSchema;
  storyArchitecture?: StoryArchitecture;
  reason?: string;
}

export const interactiveAuthoringClient = {
  createDraft: (experienceId: string, input: CreateGraphDraftApiInput) =>
    postJson<InteractiveGraphDraft>(draftPathFor(experienceId), input),

  getDraft: (experienceId: string, draftId: string) =>
    aiAwareFetch(draftPathFor(experienceId, `/${encodeURIComponent(draftId)}`)).then((res) =>
      parseResponse<InteractiveGraphDraft>(res)
    ),

  getLatestDraft: (experienceId: string) =>
    aiAwareFetch(draftPathFor(experienceId, '/latest')).then((res) =>
      parseResponse<InteractiveGraphDraft | null>(res)
    ),

  adoptDraft: (experienceId: string, draftId: string) =>
    postJson<AdoptGraphDraftApiResponse>(draftPathFor(experienceId, `/${encodeURIComponent(draftId)}/adopt`), {}),

  rejectDraft: (experienceId: string, draftId: string) =>
    postJson<InteractiveGraphDraft>(draftPathFor(experienceId, `/${encodeURIComponent(draftId)}/reject`), {}),

  saveExperienceDetails: (
    experienceId: string,
    details: Pick<InteractiveExperience, 'title' | 'genre' | 'formatProfile' | 'productionBoundary'>,
    expectedUpdatedAt?: string,
  ) => aiAwareFetch(`/api/interactive/experiences/${encodeURIComponent(experienceId)}/details`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ details, expectedUpdatedAt }),
  }).then((response) => parseResponse<InteractiveExperienceAggregate>(response)),

  saveExperienceSpec: (experienceId: string, spec: ExperienceSpec, expectedVersionIndex?: number) =>
    aiAwareFetch(`/api/interactive/experiences/${encodeURIComponent(experienceId)}/experience-spec`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, expectedVersionIndex }),
    }).then((response) => parseResponse<InteractiveExperienceAggregate>(response)),

  saveStoryArchitecture: (experienceId: string, architecture: StoryArchitecture, expectedVersionIndex?: number) =>
    aiAwareFetch(`/api/interactive/experiences/${encodeURIComponent(experienceId)}/story-architecture`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ architecture, expectedVersionIndex }),
    }).then((response) => parseResponse<InteractiveExperienceAggregate>(response)),

  saveStateSchema: (experienceId: string, stateSchema: StateSchema, expectedVersionIndex?: number) =>
    aiAwareFetch(`/api/interactive/experiences/${encodeURIComponent(experienceId)}/state-schema`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...stateSchema, expectedVersionIndex }),
    }).then((response) => parseResponse<InteractiveExperienceAggregate>(response)),
};
