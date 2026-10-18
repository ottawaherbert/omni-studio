import assert from "node:assert/strict";

import type { ProductionPreparationBatchRun } from "../packages/domain/src/assistantProduction";
import type {
  Episode,
  ManualFilmTeamDepartment,
  ManualFilmTeamOutput,
  Project,
} from "../src/types/project";
import {
  MANUAL_FILM_TEAM_DEPARTMENTS,
  manualFilmTeamOutputFor,
} from "../src/services/production/manualFilmTeam";
import {
  manualFilmTeamCollaborationIsStale,
  manualFilmTeamCollaborationSnapshot,
} from "../src/services/production/manualFilmTeamCommunication";

const baseUrl = process.env.OMNI_BASE_URL || "http://127.0.0.1:3000";
const requestedSourceProjectId = process.env.OMNI_REHEARSAL_SOURCE_PROJECT_ID;
const resumeBatchId = process.env.OMNI_REHEARSAL_BATCH_ID;
const startedAt = Date.now();
const rehearsalProjectId = `production-collaboration-rehearsal-${startedAt}`;

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${path} failed (${response.status}): ${String(body.error || JSON.stringify(body))}`);
  }
  return body as T;
};

const projectHasRehearsalMaterial = (project: Project) =>
  (project.episodes as Episode[]).some((episode) =>
    episode.scenes.length > 0 && episode.scenes.some((scene) => (scene.shots || []).length > 0),
  );

const resolveSourceProject = async () => {
  if (requestedSourceProjectId) {
    const requested = await request<Project>(`/api/projects/${requestedSourceProjectId}`);
    assert.ok(projectHasRehearsalMaterial(requested), "requested rehearsal project must contain scenes and shots");
    return requested;
  }
  const projectSummaries = await request<Project[]>("/api/projects");
  let candidate: Project | undefined;
  for (const summary of projectSummaries.filter((project) => !project.id.startsWith("production-collaboration-rehearsal-"))) {
    const project = await request<Project>(`/api/projects/${summary.id}`);
    if (projectHasRehearsalMaterial(project)) {
      candidate = project;
      break;
    }
  }
  assert.ok(candidate, "no rehearsal-ready project found; set OMNI_REHEARSAL_SOURCE_PROJECT_ID or create a project with scenes and shots");
  return candidate;
};

const remapExactStrings = (value: unknown, idMap: Map<string, string>): unknown => {
  if (typeof value === "string") return idMap.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => remapExactStrings(item, idMap));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapExactStrings(item, idMap)]));
  }
  return value;
};

const cloneProjectForRehearsal = (source: Project): Project => {
  const firstEpisode = source.episodes[0] as Episode | undefined;
  assert.ok(firstEpisode, "source project must contain one episode");
  const idMap = new Map<string, string>([[source.id, rehearsalProjectId]]);
  idMap.set(firstEpisode.id, `${rehearsalProjectId}-episode-1`);
  firstEpisode.scenes.forEach((scene, sceneIndex) => {
    idMap.set(scene.id, `${rehearsalProjectId}-scene-${sceneIndex + 1}`);
    (scene.shots || []).forEach((shot, shotIndex) => {
      idMap.set(shot.id, `${rehearsalProjectId}-shot-${sceneIndex + 1}-${shotIndex + 1}`);
    });
  });
  const cloned = remapExactStrings(structuredClone({ ...source, episodes: [firstEpisode] }), idMap) as Project;
  const cleanEpisode = cloned.episodes[0] as Episode;
  delete cleanEpisode.productionTeam;
  cleanEpisode.scenes = cleanEpisode.scenes.map((scene) => {
    if (!scene.productionPreparation) return scene;
    const { coordination: _coordination, ...productionPreparation } = scene.productionPreparation;
    return { ...scene, productionPreparation };
  });
  return {
    ...cloned,
    id: rehearsalProjectId,
    title: `${source.title} · 十二部门真实筹备演练`,
    episodes: [cleanEpisode],
  };
};

const waitForBatch = async (batchId: string): Promise<ProductionPreparationBatchRun> => {
  const deadline = Date.now() + 30 * 60_000;
  let lastProgress = "";
  while (Date.now() < deadline) {
    const { batch } = await request<{ batch: ProductionPreparationBatchRun }>(`/api/production/preparation-batch-runs/${batchId}`);
    const passed = batch.departmentSteps.filter((step) => step.status === "passed").length;
    const active = batch.departmentSteps.filter((step) => ["generating", "qa", "repairing", "rechecking"].includes(step.status));
    const progress = `${batch.status}:${passed}:${active.map((step) => `${step.departmentName}/${step.status}`).join(",")}:${batch.promptExecutions.length}`;
    if (progress !== lastProgress) {
      console.log(`[rehearsal] ${batch.status} · ${passed}/12 departments passed · ${active.map((step) => `${step.departmentName}:${step.status}`).join("、") || "waiting"} · ${batch.promptExecutions.length} model calls`);
      lastProgress = progress;
    }
    if (["ready_to_adopt", "needs_decision", "failed", "cancelled", "completed"].includes(batch.status)) return batch;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("real production collaboration rehearsal timed out after 30 minutes");
};

const handoffAcknowledged = (
  outputs: ManualFilmTeamOutput[],
  source: ManualFilmTeamOutput,
  target: ManualFilmTeamDepartment,
) => {
  const targetOutput = outputs.find((output) => output.department === target);
  const sourceHandoffIds = (source.handoffs || [])
    .filter((handoff) => handoff.toDepartments.includes(target))
    .map((handoff) => handoff.id);
  return Boolean(targetOutput && (
    sourceHandoffIds.every((id) => targetOutput.collaborationHandoffIds?.includes(id))
    || (targetOutput.collaborationSourceVersions?.[source.department] || 0) >= source.version
  ));
};

const auditAdoptedEpisode = (project: Project) => {
  const episode = project.episodes[0] as Episode;
  const outputs = episode.productionTeam?.outputs || [];
  assert.equal(outputs.length, MANUAL_FILM_TEAM_DEPARTMENTS.length, "adopted rehearsal must contain all twelve departments");
  assert.equal(new Set(outputs.map((output) => output.department)).size, 12, "department outputs must remain unique");
  assert.ok(outputs.every((output) => output.status === "confirmed"), "every adopted department must be confirmed");
  assert.ok(outputs.every((output) => output.qa?.verdict === "pass" && (output.qa?.score || 0) >= 85), "every department must pass professional QA");
  assert.ok(outputs.every((output) => output.scenePlans.length === episode.scenes.length), "every department must cover every formal scene");
  assert.ok(outputs.every((output) => Boolean(output.collaborationSourceHash)), "every output must retain its collaboration snapshot");

  const coordinator = manualFilmTeamOutputFor(episode, "production_coordination");
  const continuity = manualFilmTeamOutputFor(episode, "continuity");
  assert.ok((coordinator?.version || 0) >= 2, "production coordination must perform a final whole-team reconciliation");
  assert.ok(continuity, "continuity must close the preparation process");

  const specialistStale = outputs.filter((output) =>
    output.department !== "production_coordination"
    && output.department !== "continuity"
    && manualFilmTeamCollaborationIsStale(episode, output),
  );
  assert.deepEqual(specialistStale.map((output) => output.department), [], "no specialist may remain stale after collaboration review");

  const handoffs = outputs.flatMap((output) => (output.handoffs || []).map((handoff) => ({ output, handoff })));
  const invalidHandoffs = handoffs.filter(({ output, handoff }) =>
    !handoff.toDepartments.length
    || handoff.toDepartments.includes(output.department)
    || handoff.toDepartments.some((department) => !MANUAL_FILM_TEAM_DEPARTMENTS.some((candidate) => candidate.id === department)),
  );
  assert.equal(invalidHandoffs.length, 0, "handoffs must be directed to valid peer departments, never broadcast or self-addressed");
  const unacknowledgedRequired = handoffs.filter(({ output, handoff }) =>
    handoff.priority !== "advisory"
    && handoff.toDepartments.some((target) => !handoffAcknowledged(outputs, output, target)),
  );
  assert.equal(unacknowledgedRequired.length, 0, "every blocking or review handoff must be acknowledged by its recipient version");

  const continuityText = [continuity?.content, ...(continuity?.scenePlans || []).flatMap((plan) => [
    plan.summary,
    ...(plan.executionNotes || []),
    ...(plan.assetNeeds || []),
    ...(plan.continuityNotes || []),
  ])].join("\n");
  const criticalContinuityTerms = ["拍立得", "相片", "钥匙", "倒计时", "断电", "红色安全灯"];
  const missingContinuityTerms = criticalContinuityTerms.filter((term) => !continuityText.includes(term));
  assert.deepEqual(missingContinuityTerms, [], `continuity wrap missed critical story states: ${missingContinuityTerms.join("、")}`);

  const snapshots = outputs.map((output) => manualFilmTeamCollaborationSnapshot(episode, output.department));
  return {
    projectId: project.id,
    episodeId: episode.id,
    sceneCount: episode.scenes.length,
    shotCount: episode.scenes.flatMap((scene) => scene.shots || []).length,
    departmentVersions: Object.fromEntries(outputs.map((output) => [output.department, output.version])),
    qaScores: Object.fromEntries(outputs.map((output) => [output.department, output.qa?.score || 0])),
    handoffCount: handoffs.length,
    requiredHandoffCount: handoffs.filter(({ handoff }) => handoff.priority !== "advisory").length,
    acknowledgedIncomingCount: snapshots.reduce((sum, snapshot) => sum + snapshot.incomingHandoffs.filter((handoff) => handoff.acknowledged).length, 0),
    openQuestionCount: outputs.reduce((sum, output) => sum + output.openQuestions.length, 0),
    continuityTerms: criticalContinuityTerms,
  };
};

if (resumeBatchId) {
  const current = await request<{ batch: ProductionPreparationBatchRun }>(`/api/production/preparation-batch-runs/${resumeBatchId}`);
  assert.ok(current.batch.assistantRunId, "resumable batch must retain its assistant run id");
  await request(`/api/assistant/runs/${current.batch.assistantRunId}/resume`, {
    method: "POST",
    body: JSON.stringify({
      instruction: process.env.OMNI_REHEARSAL_RESUME_INSTRUCTION
        || "修正质检指出的事实与部门建议标签、措辞和证据边界，不改变已经确认的表演意图、资产状态与跨部门决定；修正后继续完成剩余部门协作。",
    }),
  });
  const resumed = await waitForBatch(resumeBatchId);
  if (resumed.status !== "ready_to_adopt") {
    throw new Error(`resumed rehearsal stopped at ${resumed.status}: ${resumed.error || resumed.qualityGate?.summary || "unknown error"}`);
  }
  const adopted = await request<{ batch: ProductionPreparationBatchRun; project: Project }>(`/api/production/preparation-batch-runs/${resumed.id}/adopt`, {
    method: "POST",
    body: "{}",
  });
  const savedProject = await request<Project>(`/api/projects/${resumed.projectId}`);
  console.log(JSON.stringify({
    result: "PASS_AFTER_CREATOR_DECISION",
    rehearsalProjectId: resumed.projectId,
    batchId: resumed.id,
    qualityGate: adopted.batch.qualityGate,
    audit: auditAdoptedEpisode(savedProject),
    projectUrl: `${baseUrl}/projects/${resumed.projectId}`,
    preparationUrl: `${baseUrl}/projects/${resumed.projectId}/production/preparation`,
  }, null, 2));
  process.exit(0);
}

const sourceProject = await resolveSourceProject();
const rehearsalProject = cloneProjectForRehearsal(sourceProject);
await request<Project>("/api/projects", { method: "POST", body: JSON.stringify(rehearsalProject) });
console.log(`[rehearsal] isolated project created: ${rehearsalProject.id}`);

const projectRef = { namespace: "production", projectId: rehearsalProject.id } as const;
const pageFocus = {
  module: "production",
  route: `/projects/${rehearsalProject.id}/production/preparation`,
  projectRef,
  episodeId: rehearsalProject.episodes[0].id,
  capturedAt: Date.now(),
};
const { thread } = await request<{ thread: { id: string } }>("/api/assistant/threads/default", {
  method: "POST",
  body: JSON.stringify({ ...projectRef, title: "十二部门真实筹备演练", pageFocus }),
});
const turn = await request<{ plan: { id: string; promptPreviews: unknown[]; requiresConfirmation: boolean } }>(`/api/assistant/threads/${thread.id}/messages`, {
  method: "POST",
  body: JSON.stringify({
    goal: "按真实影视制片团队的协作顺序完成本集十二部门筹备。部门必须读取上游决定和定向交接，发现冲突要明确交接给具体部门，最终由制片统筹裁决、场记收口。",
    capabilityId: "production.auto_prepare_unit",
    input: { episodeId: rehearsalProject.episodes[0].id, workUnitKind: "episode" },
    pageFocus,
    selectedSkills: [{
      id: "skill-production-rehearsal",
      title: "真实制片筹备验收",
      content: "所有建议必须忠于正式剧本并落到具体场次；资产状态、演员动作、摄影、灯光、声音和连续性必须能互相执行。不要用空泛套话，不确定项才提交创作者决定。",
    }],
  }),
});
assert.equal(turn.plan.requiresConfirmation, true, "the user must see and confirm one whole-batch plan before model calls begin");
console.log(`[rehearsal] plan ready for one confirmation · ${turn.plan.promptPreviews.length} prompt previews`);

const approved = await request<{ batch: ProductionPreparationBatchRun }>(`/api/assistant/plans/${turn.plan.id}/approve`, {
  method: "POST",
  body: JSON.stringify({ promptPreviews: turn.plan.promptPreviews, repairLimit: 2 }),
});
let batch = await waitForBatch(approved.batch.id);
if (batch.status !== "ready_to_adopt") {
  console.error(JSON.stringify({
    projectId: rehearsalProject.id,
    batchId: batch.id,
    status: batch.status,
    error: batch.error,
    qualityGate: batch.qualityGate,
    departments: batch.departmentSteps.map((step) => ({
      department: step.departmentId,
      status: step.status,
      retryCount: step.retryCount,
      error: step.error,
      qa: step.qa && typeof step.qa === "object" ? {
        score: (step.qa as Record<string, unknown>).score,
        verdict: (step.qa as Record<string, unknown>).verdict,
        summary: (step.qa as Record<string, unknown>).summary,
        issues: Array.isArray((step.qa as Record<string, unknown>).issues)
          ? ((step.qa as Record<string, unknown>).issues as Array<Record<string, unknown>>).map((issue) => ({
            severity: issue.severity,
            sceneId: issue.sceneId,
            description: issue.description,
            suggestion: issue.suggestion,
          }))
          : [],
      } : undefined,
    })),
  }, null, 2));
  throw new Error(`real preparation rehearsal stopped at ${batch.status}: ${batch.error || batch.qualityGate?.summary || "unknown error"}`);
}

const adopted = await request<{ batch: ProductionPreparationBatchRun; project: Project }>(`/api/production/preparation-batch-runs/${batch.id}/adopt`, {
  method: "POST",
  body: "{}",
});
batch = adopted.batch;
assert.equal(batch.status, "completed", "the explicit adoption action must commit the passed preparation batch");
const savedProject = await request<Project>(`/api/projects/${rehearsalProject.id}`);
const audit = auditAdoptedEpisode(savedProject);
console.log(JSON.stringify({
  result: "PASS",
  sourceProjectId: sourceProject.id,
  rehearsalProjectId,
  batchId: batch.id,
  qualityGate: batch.qualityGate,
  audit,
  projectUrl: `${baseUrl}/projects/${rehearsalProject.id}`,
  preparationUrl: `${baseUrl}/projects/${rehearsalProject.id}/production/preparation`,
}, null, 2));
