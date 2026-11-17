import { submitGenerationRequest } from '../clients/generationSubmission';
import React, { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useAIConfigStore } from '../clients/stateClient';
import type { AIChannel, AIModel, ComfyWorkflow } from '../config/aiConfigDefaults';
import { comfyAPIPresets } from '../config/comfyPresets';
import { comfyMediaKind, validateComfyTemplate, type ComfyCapabilities, type ComfyOperation } from '../../packages/domain/src/comfyWorkflow';
import { comfyGatewayClient, type VideoGenerationTask } from '../clients/comfyGatewayClient';

const inputClass = 'w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-sm text-text-primary';
const buttonClass = 'rounded-md border border-border-soft px-3 py-2 text-xs font-medium disabled:opacity-50';
const freshChannel = (): AIChannel => ({ id: `comfy-service-${crypto.randomUUID()}`, type: 'comfyui', name: 'ComfyUI 生成服务', baseUrl: '', apiKey: '', enabled: true, comfyQueue: { maxInFlight: 2, pollIntervalMs: 3000, waitTimeoutMs: 3600000 } });
const freshWorkflow = (channelId: string): ComfyWorkflow => ({ id: `comfy-workflow-${crypto.randomUUID()}`, channelId, kind: 'api_graph', enabled: true, name: '自定义 API 工作流', workflowJson: {}, mappings: [], api: { operation: 't2i', imageInputs: 0, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 15 } });
const statusNames: Record<string, string> = { submitting: '提交中', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消', unknown: '提交结果待核对' };

export function ComfyGatewaySettings() {
  const store = useAIConfigStore();
  const services = store.channels.filter(c => c.type === 'comfyui' && c.managedBy !== 'comfyui_h3_workflow');
  const [channel, setChannel] = useState<AIChannel>(() => services[0] || freshChannel());
  const [workflow, setWorkflow] = useState<ComfyWorkflow>(() => store.comfyWorkflows.find(w => w.channelId === channel.id && w.kind === 'api_graph') || freshWorkflow(channel.id));
  const [graphText, setGraphText] = useState(JSON.stringify(workflow.workflowJson, null, 2));
  const [mappingText, setMappingText] = useState(JSON.stringify(workflow.mappings, null, 2));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<VideoGenerationTask[]>([]);
  const [resumeIds, setResumeIds] = useState<Record<string, string>>({});
  const [recentJobs, setRecentJobs] = useState<Record<string, Array<{ id: string; status: string }>>>({});
  const [testPrompt, setTestPrompt] = useState('雨后的渡口，一只红色纸船缓缓漂过水面，固定镜头，自然光。');
  const [testDuration, setTestDuration] = useState(5);
  const [testReferences, setTestReferences] = useState<Record<string, string>>({});
  const [testAspect, setTestAspect] = useState('16:9');
  const initialSelectionReady = useRef(store.hasHydrated);
  const selectWorkflow = (w: ComfyWorkflow) => { setWorkflow(structuredClone(w)); setGraphText(JSON.stringify(w.workflowJson, null, 2)); setMappingText(JSON.stringify(w.mappings, null, 2)); setTestReferences({}); };
  useEffect(() => {
    if (!store.hasHydrated || initialSelectionReady.current) return;
    initialSelectionReady.current = true;
    const saved = services[0];
    if (saved) { setChannel(structuredClone(saved)); selectWorkflow(store.comfyWorkflows.find(w => w.channelId === saved.id && w.kind === 'api_graph') || freshWorkflow(saved.id)); }
  }, [store.hasHydrated]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  const refresh = async () => setTasks(await comfyGatewayClient.list());
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!tasks.some(t => ['submitting', 'queued', 'running'].includes(t.status))) return;
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [tasks]);
  const save = async (withWorkflow: boolean) => {
    if (!channel.name.trim() || !channel.baseUrl.trim()) throw new Error('请填写服务名称和 Base URL。');
    const target = new URL(channel.baseUrl);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('服务地址无效。');
    const state = useAIConfigStore.getState();
    let workflows = state.comfyWorkflows, models = state.models;
    if (withWorkflow) {
      const w: ComfyWorkflow = { ...workflow, channelId: channel.id, workflowJson: JSON.parse(graphText), mappings: JSON.parse(mappingText) };
      validateComfyTemplate(w);
      if (!w.name.trim()) throw new Error('请填写工作流名称。');
      workflows = [...workflows.filter(item => item.id !== w.id), w];
      const existing = models.find(m => m.comfyWorkflowId === w.id && m.channelId === channel.id);
      const model: AIModel = { ...existing, id: existing?.id || `comfy-model-${crypto.randomUUID()}`, channelId: channel.id, alias: w.name, modelId: `comfy-api-${w.id}`, capabilities: [comfyMediaKind(w.api!.operation)], comfyWorkflowId: w.id, comfyCapabilities: w.api, videoAdapterId: 'auto' };
      models = [...models.filter(m => m.id !== model.id), model];
      setWorkflow(w);
    }
    await state.saveConfig({ channels: [...state.channels.filter(c => c.id !== channel.id), channel], comfyWorkflows: workflows, models });
    if (useAIConfigStore.getState().loadError) throw new Error(useAIConfigStore.getState().loadError);
    const saved = useAIConfigStore.getState().channels.find(c => c.id === channel.id);
    if (saved) setChannel(saved);
  };
  const updateAPI = (patch: Partial<ComfyCapabilities>) => setWorkflow(w => ({ ...w, api: { ...w.api!, ...patch } }));
  const test = () => run(async () => {
    await save(true);
    const state = useAIConfigStore.getState();
    const model = state.models.find(m => m.comfyWorkflowId === workflow.id && m.channelId === channel.id)!;
    const api = workflow.api!;
    const { execution } = await submitGenerationRequest({ modelConfigId: model.id, prompt: testPrompt, aspectRatio: testAspect, operation: comfyMediaKind(api.operation) === 'video' ? 'video' : 'asset_image', duration: comfyMediaKind(api.operation) === 'video' ? testDuration : undefined,
      references: (['image', 'video', 'audio'] as const).flatMap((kind, index) => Array.from({ length: api[(['imageInputs', 'videoInputs', 'audioInputs'] as const)[index]] }, (_, i) => ({ url: testReferences[`${kind}:${i}`] || '', kind }))) });
    setMessage(`测试已按固定方案提交：${execution.id}。生成记录保留在「生成」工作区；下方服务队列显示实际运行状态。`);
    await refresh();
  });
  const workflowOptions = store.comfyWorkflows.filter(w => w.channelId === channel.id && w.kind === 'api_graph');
  return <section className="space-y-6 text-text-primary">
    <div><h2 className="text-lg font-semibold">ComfyUI 图片与视频服务</h2><p className="mt-2 text-xs leading-5 text-text-muted">使用账号 API Key 和导出（API）工作流。图片与视频共享服务端生成队列；保存后可在任务路由中选择对应模型。</p></div>
    {error && <p role="alert" className="whitespace-pre-wrap text-sm text-red-500">{error}</p>}
    {message && <p role="status" className="whitespace-pre-wrap text-sm text-emerald-600">{message}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="min-w-0 flex-1 text-xs">生成服务<select aria-label="选择 ComfyUI 服务" className={inputClass} value={services.some(c => c.id === channel.id) ? channel.id : ''} onChange={e => { const c = services.find(c => c.id === e.target.value); if (c) { setChannel(structuredClone(c)); selectWorkflow(store.comfyWorkflows.find(w => w.channelId === c.id && w.kind === 'api_graph') || freshWorkflow(c.id)); } }}><option value="" disabled>尚未保存的新服务</option>{services.map(c => <option key={c.id} value={c.id}>{c.name}{c.enabled === false ? '（停用）' : ''}</option>)}</select></label>
      <button className={buttonClass} onClick={() => { const c = freshChannel(); setChannel(c); selectWorkflow(freshWorkflow(c.id)); }}><Plus className="mr-1 inline h-3 w-3" />新增服务</button>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs">名称<input aria-label="ComfyUI 服务名称" className={inputClass} value={channel.name} onChange={e => setChannel({ ...channel, name: e.target.value })} /></label>
      <label className="text-xs">Base URL<input aria-label="ComfyUI Base URL" className={inputClass} placeholder="https://comfy.chuangyi.chat" value={channel.baseUrl} onChange={e => setChannel({ ...channel, baseUrl: e.target.value })} /></label>
      <label className="text-xs">API Key<input aria-label="ComfyUI API Key" type="password" autoComplete="new-password" className={inputClass} value={channel.apiKey === '__OMNI_STORED_COMFY_KEY__' ? '' : channel.apiKey} placeholder={channel.apiKey === '__OMNI_STORED_COMFY_KEY__' ? '已保存在服务器，留空保留' : '账号的 ComfyUI API Key'} onChange={e => setChannel({ ...channel, apiKey: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={channel.enabled !== false} onChange={e => setChannel({ ...channel, enabled: e.target.checked })} />启用此服务</label>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">{([
      ['maxInFlight', '本系统最大在途任务', 1, 12, 1], ['pollIntervalMs', '查询间隔（毫秒）', 1000, 60000, 1000], ['waitTimeoutMs', '页面等待上限（毫秒）', 10000, 86400000, 10000],
    ] as const).map(([key, label, min, max, step]) => <label className="text-xs" key={key}>{label}<input type="number" className={inputClass} min={min} max={max} step={step} value={channel.comfyQueue?.[key] ?? (key === 'maxInFlight' ? 2 : key === 'pollIntervalMs' ? 3000 : 3600000)} onChange={e => setChannel({ ...channel, comfyQueue: { maxInFlight: 2, pollIntervalMs: 3000, waitTimeoutMs: 3600000, ...channel.comfyQueue, [key]: Number(e.target.value) } })} /></label>)}</div>
    <p className="text-xs text-text-muted">此上限由同一服务下的图片、视频共同使用；实际 GPU 容量由服务端动态分配。等待超时不会取消上游任务。</p>
    <div className="flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await save(false); setMessage('服务配置已保存。'); })}>保存服务</button><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await save(false); setMessage((await comfyGatewayClient.check(channel.id)).message); })}>检查连接</button></div>
    <div className="space-y-4 border-t border-border-soft pt-6">
      <h3 className="font-semibold">API 工作流</h3>
      <div className="flex flex-wrap gap-2"><select aria-label="选择 ComfyUI 工作流" className={`${inputClass} sm:max-w-sm`} value={workflowOptions.some(w => w.id === workflow.id) ? workflow.id : ''} onChange={e => { const w = workflowOptions.find(w => w.id === e.target.value); if (w) selectWorkflow(w); }}><option value="">新工作流</option>{workflowOptions.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className={buttonClass} onClick={() => selectWorkflow(freshWorkflow(channel.id))}>新增工作流</button></div>
      <div className="flex flex-wrap gap-2">{comfyAPIPresets.map(p => <button key={p.id} className={buttonClass} onClick={() => selectWorkflow({ ...structuredClone(p.template), id: `comfy-workflow-${crypto.randomUUID()}`, channelId: channel.id })}>载入 {p.label} 示例</button>)}</div>
      <p className="text-xs text-text-muted">这里配置源工作流。三图、四图只是历史示例的接线，不是 H3 模型上限。已识别的 YZ H3 参考工作流会在生成工作台提供“多素材参考”，按需选择图片、视频与音频，同时保留双采和放大核心；新组合仍需服务验证。宫格用于规划，不作为正片首帧。</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs">工作流名称<input className={inputClass} value={workflow.name} onChange={e => setWorkflow({ ...workflow, name: e.target.value })} /></label><label className="text-xs">生成方式<select className={inputClass} value={workflow.api?.operation} onChange={e => updateAPI({ operation: e.target.value as ComfyOperation })}>{[['t2i', '文生图'], ['i2i', '图生图'], ['t2v', '文生视频'], ['i2v', '图生视频'], ['reference_video', '多素材参考视频']].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
      <div className="grid gap-3 sm:grid-cols-3">{(['imageInputs', 'videoInputs', 'audioInputs'] as const).map((key, i) => <label key={key} className="text-xs">{['图片', '视频', '音频'][i]}输入数量<input type="number" min="0" max="16" className={inputClass} value={workflow.api?.[key] || 0} onChange={e => updateAPI({ [key]: Number(e.target.value) })} /></label>)}</div>
      <div className="flex flex-wrap items-center gap-4 text-xs"><label><input type="checkbox" checked={workflow.enabled !== false} onChange={e => setWorkflow({ ...workflow, enabled: e.target.checked })} /> 启用工作流</label><label><input type="checkbox" checked={workflow.api?.nativeAudio || false} onChange={e => updateAPI({ nativeAudio: e.target.checked })} /> 输出包含原生声音</label><label>最短秒数 <input type="number" min="1" max="3600" className="w-20 rounded border border-border-soft bg-bg-primary p-1" value={workflow.api?.minDuration} onChange={e => updateAPI({ minDuration: Number(e.target.value) })} /></label><label>最长秒数 <input type="number" min="1" max="3600" className="w-20 rounded border border-border-soft bg-bg-primary p-1" value={workflow.api?.maxDuration} onChange={e => updateAPI({ maxDuration: Number(e.target.value) })} /></label></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={workflow.api?.multiShot === true} onChange={e => updateAPI({ multiShot: e.target.checked })} />支持一段视频内按时间切换多个镜头</label>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs"><Upload size={14} />导入 API JSON<input aria-label="导入 ComfyUI API JSON" type="file" accept=".json,application/json" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('工作流超过 8 MiB。'); const text = await file.text(); JSON.parse(text); setGraphText(text); setMessage(`已读取 ${file.name}，请检查映射后保存。`); }); e.currentTarget.value = ''; }} /></label>
      <div className="grid gap-4 lg:grid-cols-2"><label className="min-w-0 text-xs">API 节点图<textarea aria-label="ComfyUI API 节点图" className={`${inputClass} mt-1 h-64 font-mono text-xs`} value={graphText} onChange={e => setGraphText(e.target.value)} /></label><label className="min-w-0 text-xs">参数映射 JSON<textarea aria-label="ComfyUI 参数映射" className={`${inputClass} mt-1 h-64 font-mono text-xs`} value={mappingText} onChange={e => setMappingText(e.target.value)} /></label></div>
      <p className="text-xs leading-5 text-text-muted">每项包含 systemParam、nodeId、nodeInput。参数：prompt、width、height、aspectRatio、duration、seed，以及 image:0、video:0、audio:0（从 0 编号）。节点枚举名称可用 valueMap 转换，见视频示例。</p>
      <div className="flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await save(true); setMessage('工作流及对应生成模型已保存。'); })}>保存工作流与模型</button><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await save(true); const s = useAIConfigStore.getState(); const m = s.models.find(m => m.comfyWorkflowId === workflow.id && m.channelId === channel.id)!; await s.saveConfig({ routing: { ...s.routing, [comfyMediaKind(workflow.api!.operation) === 'image' ? 'imageGen' : 'videoGen']: m.id } }); if (useAIConfigStore.getState().loadError) throw new Error(useAIConfigStore.getState().loadError); setMessage('已选作当前生成模型。'); })}>用于当前{workflow.api && comfyMediaKind(workflow.api.operation) === 'video' ? '视频' : '图片'}生成</button><button disabled={busy || !workflowOptions.some(w => w.id === workflow.id)} className={buttonClass} onClick={() => void run(async () => { const s = useAIConfigStore.getState(); if (tasks.some(t => ['queued', 'running', 'submitting', 'unknown'].includes(t.status) && t.audit?.workflowId === workflow.id)) throw new Error('此工作流还有在途任务，请结束任务后删除。'); await s.saveConfig({ comfyWorkflows: s.comfyWorkflows.filter(w => w.id !== workflow.id), models: s.models.filter(m => m.comfyWorkflowId !== workflow.id) }); if (useAIConfigStore.getState().loadError) throw new Error(useAIConfigStore.getState().loadError); selectWorkflow(freshWorkflow(channel.id)); setMessage('工作流已删除，已生成素材仍保留。'); })}><Trash2 size={12} className="mr-1 inline" />删除工作流</button></div>
    </div>
    <details className="border-t border-border-soft pt-4"><summary className="cursor-pointer text-sm font-medium">提交小型测试任务</summary><div className="mt-4 space-y-3"><p className="text-xs text-text-muted">会保存当前配置并实际调用所选工作流。耗时取决于节点图参数和服务端排队；视频示例默认 1.2 MP，可先在图中将 megapixels 调低至 0.2。</p><textarea aria-label="ComfyUI 测试提示词" className={`${inputClass} h-20`} value={testPrompt} onChange={e => setTestPrompt(e.target.value)} /><div className="flex flex-wrap gap-4 text-xs"><label>画幅<select className={inputClass} value={testAspect} onChange={e => setTestAspect(e.target.value)}>{['16:9', '9:16', '1:1'].map(a => <option key={a}>{a}</option>)}</select></label>{workflow.api && comfyMediaKind(workflow.api.operation) === 'video' && <label>目标秒数<input type="number" className={inputClass} value={testDuration} onChange={e => setTestDuration(Number(e.target.value))} /></label>}</div>{(['image', 'video', 'audio'] as const).flatMap((kind, index) => Array.from({ length: workflow.api?.[(['imageInputs', 'videoInputs', 'audioInputs'] as const)[index]] || 0 }, (_, i) => <label key={`${kind}:${i}`} className="block text-xs">{kind}:{i}<input type="file" accept={`${kind}/*`} className={inputClass} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 50 * 1024 * 1024) throw new Error('单个素材不能超过 50 MiB。'); const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); setTestReferences(r => ({ ...r, [`${kind}:${i}`]: url })); }); }} /></label>))}<button disabled={busy || channel.enabled === false || workflow.enabled === false} className={buttonClass} onClick={() => void test()}>提交一次测试</button></div></details>
    <div className="space-y-3 border-t border-border-soft pt-6"><div className="flex items-center justify-between"><h3 className="font-semibold">生成任务与结果</h3><button disabled={busy} className={buttonClass} onClick={() => void run(refresh)}><RefreshCw size={12} className="mr-1 inline" />刷新</button></div>{!tasks.length && <p className="text-xs text-text-muted">尚无 ComfyUI API 任务。</p>}{tasks.map(task => <article className="space-y-2 border-b border-border-soft py-3 text-xs" key={task.id}><p className="break-words font-medium">{String(task.audit?.workflowName || 'ComfyUI')} · {statusNames[task.status] || task.status}</p><p className="break-all text-text-muted">{task.id}{task.providerTaskId ? ` · prompt_id: ${task.providerTaskId}` : ''}</p>{task.error && <p className="whitespace-pre-wrap break-words text-amber-600">{task.error}</p>}<div className="flex flex-wrap gap-2">{!['succeeded', 'failed', 'cancelled'].includes(task.status) && <><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await comfyGatewayClient.query(task.id); await refresh(); })}>查询</button><button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await comfyGatewayClient.cancel(task.id); await refresh(); })}>取消任务</button></>}{task.providerTaskId && ['unknown', 'queued', 'running'].includes(task.status) && <button disabled={busy} className={buttonClass} onClick={() => void run(async () => { await comfyGatewayClient.resume(task.id); await refresh(); })}>恢复查询与下载</button>}{task.outputs?.map(output => <a key={output.url} href={output.url} target="_blank" rel="noreferrer" className="break-all underline">查看{output.kind === 'image' ? '图片' : output.kind === 'video' ? '视频' : '音频'} {output.filename}</a>)}</div>{task.status === 'unknown' && !task.providerTaskId && <div className="space-y-2"><button className={buttonClass} disabled={busy} onClick={() => void run(async () => { const recent = await comfyGatewayClient.recent(task.id); setRecentJobs(r => ({ ...r, [task.id]: recent })); })}>查看账号近期任务</button>{recentJobs[task.id]?.map(j => <p key={j.id} className="break-all">{j.id} · {j.status}</p>)}<label className="block">核对后填写 prompt_id<input aria-label={`恢复任务 ${task.id}`} className={inputClass} value={resumeIds[task.id] || ''} onChange={e => setResumeIds(r => ({ ...r, [task.id]: e.target.value }))} /></label><button className={buttonClass} disabled={busy} onClick={() => void run(async () => { await comfyGatewayClient.resume(task.id, resumeIds[task.id]); await refresh(); })}>校验工作流并关联任务</button></div>}</article>)}</div>
  </section>;
}
