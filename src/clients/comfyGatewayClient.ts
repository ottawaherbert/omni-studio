import type { ComfyGenerationInput } from '../../packages/domain/src/comfyWorkflow';
import type { VideoGenerationTask } from '../services/providers/videoGenerationTask';
export type { VideoGenerationTask } from '../services/providers/videoGenerationTask';
const ROOT = '/api/proxy/comfyui-api';
async function request(endpoint: string, body?: unknown) {
  const response = await fetch(`${ROOT}${endpoint}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `ComfyUI 请求失败（${response.status}）`);
  return data;
}
export const comfyGatewayClient = {
  check: (channelId: string): Promise<{ ready: boolean; message: string }> => request('/check', { channelId }),
  list: async (): Promise<VideoGenerationTask[]> => (await request('/tasks')).tasks,
  submit: async (options: { channelId: string; modelConfigId: string; input: ComfyGenerationInput; idempotencyKey: string; projectId?: string }): Promise<VideoGenerationTask> => (await request('/tasks', options)).task,
  query: async (id: string): Promise<VideoGenerationTask> => (await request(`/tasks/${encodeURIComponent(id)}`)).task,
  cancel: async (id: string): Promise<VideoGenerationTask> => (await request(`/tasks/${encodeURIComponent(id)}/cancel`, {})).task,
  resume: async (id: string, providerTaskId?: string): Promise<VideoGenerationTask> => (await request(`/tasks/${encodeURIComponent(id)}/resume`, { providerTaskId })).task,
  recent: async (id: string): Promise<Array<{ id: string; status: string; createdAt?: string }>> => (await request(`/tasks/${encodeURIComponent(id)}/recent`)).jobs,
};
export async function waitForComfyMedia(task: VideoGenerationTask, timeoutMs = 3600000, pollIntervalMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (task.status === 'succeeded') {
      const output = task.outputs?.find(o => o.kind === 'image');
      if (!output) throw new Error('任务没有图片输出。');
      return output.url;
    }
    if (['failed', 'cancelled', 'unknown'].includes(task.status)) throw new Error(`${task.error || 'ComfyUI 任务未成功'}（本地任务 ${task.id}，可在设置中查看或恢复）`);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    task = await comfyGatewayClient.query(task.id);
  }
  throw new Error(`等待超时，任务仍保留且未取消。请在设置的 ComfyUI 任务列表恢复 ${task.id}。`);
}
