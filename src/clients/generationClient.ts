import type { GenerationWorkspace, GenerationTarget, GenerationTaskDraft, GenerationPlanRevision, GenerationIssue, GenerationExecution, GenerationPolicy, GenerationLayout, GenerationReference } from '../../packages/domain/src/generation';
const base = '/api/production/generation';
export class GenerationClientError extends Error { constructor(message: string, readonly code: string, readonly details?: unknown) { super(message); } }
async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(base + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new GenerationClientError(data.error || '请求失败，草稿仍保留。', data.code || 'HTTP_ERROR', data.details);
  return data;
}
export const generationClient = {
  workspace: (target: GenerationTarget) => request<GenerationWorkspace>(`/workspaces/current?target=${encodeURIComponent(JSON.stringify(target))}`),
  catalog: () => request<{ recipes: Array<{ capability: GenerationWorkspace['capabilities'][number]; legacyModelIds: string[]; presets: Array<{ id: string; label: string; values: Record<string, string | number | boolean> }> }> }>('/capabilities'),
  create: (target: GenerationTarget, operation: GenerationTaskDraft['operation'], commandId: string, capabilityId?: string) => request<{ task: GenerationTaskDraft }>('/tasks', { target, operation, commandId, capabilityId }),
  update: (task: GenerationTaskDraft, patch: Partial<GenerationTaskDraft>, refreshSource = false) => request<{ task: GenerationTaskDraft }>(`/tasks/${task.id}`, { expectedRevision: task.revision, patch, refreshSource }, 'PATCH'),
  preflight: (task: GenerationTaskDraft) => request<{ plan?: GenerationPlanRevision; issues: GenerationIssue[] }>(`/tasks/${task.id}/preflight`, { expectedRevision: task.revision }),
  propose: (task: GenerationTaskDraft, useAI = false) => request<{ proposal: { id: string; explanation: string; parameters: Record<string, string | number | boolean>; enabledReferenceIds: string[]; source: string } }>(`/tasks/${task.id}/proposals`, { useAI }),
  applyProposal: (task: GenerationTaskDraft, proposalId: string) => request<{ task: GenerationTaskDraft }>(`/tasks/${task.id}/apply-proposal`, { proposalId, expectedRevision: task.revision }),
  schedule: (taskIds: string[], commandId: string) => request('/queue', { taskIds, commandId }),
  batch: (plans: GenerationPlanRevision[], keys: Record<string, string>) => request<{ executions: GenerationExecution[] }>('/batches', { plans: plans.map(p => ({ planRevisionId: p.id, planHash: p.planHash, idempotencyKey: keys[p.id] })) }),
  execute: (plan: GenerationPlanRevision, idempotencyKey: string) => request<{ execution: GenerationExecution }>('/executions', { planRevisionId: plan.id, planHash: plan.planHash, idempotencyKey }),
  policy: (policy: GenerationPolicy, patch: Partial<GenerationPolicy>) => request<{ policy: GenerationPolicy }>(`/projects/${policy.projectId}/policy`, { expectedRevision: policy.revision, patch }, 'PATCH'),
  associate: (executionId: string, providerTaskId: string) => request(`/executions/${executionId}/associate`, { providerTaskId }),
  releaseReservation: (executionId: string, evidence: string) => request<{ execution: GenerationExecution }>(`/executions/${executionId}/release-reservation`, { evidence }),
  cancel: (executionId: string) => request<{ execution: GenerationExecution }>(`/executions/${executionId}/cancel`, {}),
  resume: (executionId: string) => request<{ execution: GenerationExecution }>(`/executions/${executionId}/reconcile`, {}),
  layout: (workspace: GenerationWorkspace, nodes: GenerationLayout['nodes'], viewport?: GenerationLayout['viewport'], groups?: GenerationLayout['groups']) => request<{ layout: GenerationLayout }>(`/workspaces/${encodeURIComponent(workspace.id)}/layout`, { target: workspace.target, expectedLayoutRevision: workspace.layout.revision, nodes, viewport, groups }, 'PATCH'),
  importReference: (projectId: string, mediaUrl: string, mediaKind: GenerationReference['mediaKind'], role: GenerationReference['role'], label: string) => request<{ reference: GenerationReference }>('/references', { projectId, mediaUrl, mediaKind, role, label }),
  importResult: (planRevisionId: string, mediaUrl: string, commandId: string) => request<{ execution: GenerationExecution }>('/imports', { planRevisionId, mediaUrl, commandId }),
  registerResults: (executionId: string) => request(`/executions/${executionId}/register-results`, {}),
  review: (executionId: string, resultId: string, verdict: 'adopted' | 'needs_changes', expectedRevision: number | undefined, notes: string, observations?: import('../../packages/domain/src/productionCollaboration').ProductionObservation[]) => request<{ execution: GenerationExecution }>(`/executions/${executionId}/review`, { resultId, verdict, expectedRevision, notes, observations }),
};
