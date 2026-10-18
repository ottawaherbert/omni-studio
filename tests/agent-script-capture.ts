import { writeFileSync } from 'node:fs';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';

// One-time capture of the real frozen request sent to the authorized Sol child.
// This creates only a synthetic author manuscript in the isolated harness.
const origin = 'http://127.0.0.1:3021';
async function api(path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
const selected = '林夏很紧张，不知道要不要开门。';
const { project } = await api('/api/scripts', { title: '验收·门外的雨（Agent 底座）', profile: createScriptCreationProfile('short-film', 1, 5), initialBrief: { concept: '母女在一次夜雨中重新开口。', theme: '', outline: '', sceneText: `门把手响了一声。\n\n${selected}\n\n门外，母亲把滴水的伞靠在墙边。` } });
const unit = project.units[0], scene = unit.scenes[0];
const source = blocksToScreenplayText(scene.blocks, []);
const start = source.indexOf(selected);
if (start < 0) throw new Error('Synthetic source selection missing');
const accepted = await api('/api/agent/runs', { requestId: `sol-capture-${project.id}`, scopeId: project.id, kind: 'CAPABILITY', maxInvocations: 2, input: { request: { capabilityId: 'script.rewrite', capabilityVersion: '1', callId: 'rewrite-selection', input: {
  projectId: project.id, expectedRevision: project.revision, unitId: unit.id, sceneId: scene.id, operation: 'text_rewrite', instruction: '把选中的心理说明改成一个克制的可见动作，不增加对白或新人物，保留开门前的犹豫。只修改选中的一句。', methodIds: [], channel: 'external', routeRef: 'simulation:gpt-6-sol', selection: { start, end: start + selected.length, text: selected },
} } } });
let state: any;
for (let i = 0; i < 100; i++) {
  state = await api(`/api/agent/runs/${accepted.runId}`);
  if (state.run.status === 'WAITING_EXTERNAL' || state.run.status === 'FAILED') break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (state.run.status !== 'WAITING_EXTERNAL') throw new Error(JSON.stringify(state));
const packet = { simulation: true, producerRequested: 'GPT-6 Sol subagent', origin, project, source, accepted, externalRequest: state.externalRequests[0] };
const filename = 'artifacts/agent-foundation-study-2026-09-26/sol-rewrite-request.json';
writeFileSync(filename, JSON.stringify(packet, null, 2));
console.log(JSON.stringify({ filename, projectId: project.id, runId: accepted.runId, requestId: packet.externalRequest.id, inputHash: packet.externalRequest.inputHash }));
