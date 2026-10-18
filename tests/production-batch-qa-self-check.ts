import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Episode, ManualFilmTeamOutput, Project, Scene } from '../src/types/project';
import type { ProductionPreparationBatchRun } from '../packages/domain/src/assistant';
import type { AssistantRepository } from '../src/server/assistantRepository';

// Runtime imports initialize DB helpers; isolate them even though this test uses
// an in-memory repository and never loads or modifies a user's project.
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'a22-batch-qa-'));
process.env.OMNI_DB_PATH = path.join(tempDirectory, 'isolated.db');
const { ProductionPreparationBatchRuntime } = await import('../src/services/assistant/productionPreparationBatch');
const { db } = await import('../src/server/db');
const { manualFilmTeamQaEvidenceCatalog, manualFilmTeamQaOutputBatches } = await import('../src/services/production/manualFilmTeam');

const scenes: Scene[] = Array.from({ length: 36 }, (_, index) => ({
  id: `scene-${index + 1}`, title: `第${index + 1}场`, description: '人物把表交还后离开。',
  script: `第${index + 1}场：甲把机械表交给乙，乙收下后离开。`, valueCharge: 'neutral',
}));
const episode: Episode = { id: 'episode', title: '完整36场', inspiration: '', scenes };
const project = { id: 'project', title: '分批契约', type: 'tv-series', characters: [], assets: [], episodes: [episode] } as unknown as Project;
const output: ManualFilmTeamOutput = {
  department: 'directing', sourceScriptHash: 'script', taskSummary: '让交表动作保持可读。',
  content: '导演建议：用可读手部动作表现交表，保留每场不同的离场节奏。',
  scenePlans: scenes.map((scene, index) => ({
    sceneId: scene.id, sceneTitle: scene.title, summary: `第${index + 1}场交表后离场。`,
    // Force one scene across the existing 16-evidence transport boundary.
    executionNotes: Array.from({ length: index === 0 ? 20 : 2 }, (_, n) => `【建议】第${index + 1}场执行项${n + 1}，手表始终交到乙手里。`),
    assetNeeds: ['机械表'], continuityNotes: ['交表后由乙持有。'], handoffNotes: [],
  })),
  openQuestions: [], handoffNotes: [], status: 'draft', version: 1, updatedAt: 1,
  audit: { action: 'generate', templateId: 'generate', promptHash: 'initial', selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], createdAt: 1 },
};
const expected = manualFilmTeamQaOutputBatches(output);
const allEvidence = manualFilmTeamQaEvidenceCatalog(output);
assert.ok(expected.length > 37, 'a large scene must split further while preserving all 36 scenes');
assert.ok(expected.every((part) => part.evidenceIds.length <= 16));

const newBatch = (): ProductionPreparationBatchRun => ({
  id: 'batch', projectId: project.id, sourceSnapshotId: 'source', workUnit: { kind: 'episode', id: episode.id, title: episode.title },
  sceneIds: scenes.map((scene) => scene.id), sceneLabels: {}, status: 'running',
  promptPreviews: [{ id: 'department:directing:qa', title: '导演逐项QA', templateId: 'productionTeamQa',
    prompt: '【本批结果】\n__ASSISTANT_CURRENT_OUTPUT__\n【质检边界】\n__ASSISTANT_QA_CONTEXT__',
    promptHash: 'preview', selectedSkillIds: ['continuity'], selectedSkillTitles: ['连续性'], contextSources: [],
  }, { id: 'department:directing:optimize', title: '导演修复', templateId: 'productionTeamOptimize',
    prompt: 'OPTIMIZE\n__ASSISTANT_CURRENT_OUTPUT__\n__ASSISTANT_QA_CONTEXT__', promptHash: 'optimize',
    selectedSkillIds: [], selectedSkillTitles: [], contextSources: [],
  }],
  promptExecutions: [], breakdownCandidates: {},
  departmentSteps: [{ id: 'step', batchRunId: 'batch', departmentId: 'directing', departmentName: '导演',
    sceneIds: scenes.map((scene) => scene.id), dependsOn: [], status: 'qa', candidate: structuredClone(output),
    promptExecutionIds: [], retryCount: 0, blockingIssueIds: [], updatedAt: 1,
  }], createdAt: 1, updatedAt: 1,
} as ProductionPreparationBatchRun);

type DepartmentRuntime = { executeDepartment(batch: ProductionPreparationBatchRun, project: Project, episode: Episode, department: 'directing', repairLimit: number): Promise<ProductionPreparationBatchRun> };

async function scenario(options: { invalidReply?: boolean; lateWarning?: boolean; repairs?: number; permanentInvalid?: boolean }) {
  let persisted = newBatch();
  const repository = {
    getPreparationBatch: () => structuredClone(persisted),
    savePreparationBatch: (value: ProductionPreparationBatchRun) => { persisted = structuredClone(value); return structuredClone(value); },
    getAuthorization: () => null,
  } as unknown as AssistantRepository;
  const calls: Array<{ index: number; evidenceIds: string[] }> = [];
  let invalidSent = false;
  let repaired = false;
  const runtime = new ProductionPreparationBatchRuntime(async ({ prompt }) => {
    if (prompt.startsWith('OPTIMIZE')) { repaired = true; return { ...output, content: `${output.content} 已按质检修订。` }; }
    const match = prompt.match(/【本批结果】\s*([\s\S]*?)\s*【(?:分批)?质检边界】/);
    assert.ok(match, 'each real runtime call must carry a bounded output context');
    const evidence: Array<{ itemId: string; text: string }> = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if ('itemId' in value && 'text' in value) evidence.push(value as { itemId: string; text: string });
      else Object.values(value).forEach(visit);
    };
    visit(JSON.parse(match[1]));
    const boundary = prompt.match(/第 (\d+)\/(\d+) 个语义批次/);
    assert.ok(boundary); assert.equal(Number(boundary[2]), expected.length);
    const index = Number(boundary[1]) - 1;
    assert.deepEqual(evidence.map((item) => item.itemId), expected[index].evidenceIds, 'prompt includes exactly this batch, preserving original IDs/order');
    calls.push({ index, evidenceIds: evidence.map((item) => item.itemId) });
    const invalid = index === 1 && (options.permanentInvalid || (options.invalidReply && !invalidSent));
    if (invalid) invalidSent = true;
    const warning = options.lateWarning && !repaired && index === expected.length - 1;
    return {
      score: 97, verdict: 'pass', summary: `独立审查第${index + 1}批`, strengths: ['证据对应'],
      coverage: (invalid ? evidence.slice(1) : evidence).map((item, i) => ({
        itemId: item.itemId, judgment: warning && i === 0 ? 'issue' : 'marked_proposal',
        outputEvidence: item.text, sourceEvidence: '当前场交表后离开。', note: '核对本批证据。',
      })),
      issues: warning ? [{ severity: 'warning', description: '最后一场交接需要明确。', suggestion: '修订交接说明。',
        outputEvidenceId: evidence[0].itemId, outputEvidence: evidence[0].text, sourceEvidence: '当前场交表后离开。',
      }] : [],
    };
  }, repository) as unknown as DepartmentRuntime;
  let result: ProductionPreparationBatchRun | undefined;
  let error: unknown;
  try { result = await runtime.executeDepartment(persisted, project, episode, 'directing', options.repairs || 0); }
  catch (caught) { error = caught; }
  return { result, error, persisted, calls, repaired };
}

try {
  const passing = await scenario({ invalidReply: true });
  assert.ifError(passing.error);
  const passed = passing.result!.departmentSteps[0];
  const passedQa = passed.qa as NonNullable<ManualFilmTeamOutput['qa']>;
  assert.equal(passed.status, 'passed');
  assert.equal(passedQa.coverage?.length, allEvidence.length);
  assert.equal(new Set(passedQa.coverage!.map((row) => row.itemId)).size, allEvidence.length);
  assert.equal(passing.calls.length, expected.length + 1, 'only the malformed batch is retried');
  assert.equal(passing.calls.filter((call) => call.index === 0).length, 1, 'valid earlier batches are not rerun by structural retry');
  assert.equal(passed.promptExecutionIds.length, passing.calls.length, 'all independent requests including invalid reply retain audit links');
  assert.equal(passing.persisted.promptExecutions.length, passing.calls.length);
  assert.ok(passing.persisted.promptExecutions.every((item) => item.result && item.resultHash && item.promptHash));
  assert.ok(passing.persisted.promptExecutions.every((item) => passed.promptExecutionIds.includes(item.id)));
  assert.notEqual(passedQa.audit.promptHash, passing.persisted.promptExecutions.at(-1)?.promptHash, 'aggregate QA audit covers more than the final batch prompt');

  const blocked = await scenario({ lateWarning: true });
  assert.ifError(blocked.error);
  const blockedQa = blocked.result!.departmentSteps[0].qa as NonNullable<ManualFilmTeamOutput['qa']>;
  assert.equal(blocked.result!.departmentSteps[0].status, 'needs_decision', 'a late warning cannot be diluted by earlier passing batches');
  assert.equal(blockedQa.verdict, 'revise');
  assert.ok(blockedQa.score < 85);

  const repaired = await scenario({ lateWarning: true, repairs: 1 });
  assert.ifError(repaired.error); assert.equal(repaired.repaired, true);
  assert.equal(repaired.result!.departmentSteps[0].status, 'passed');
  assert.equal(repaired.calls.length, expected.length * 2, 'changed output must receive a fresh independent full QA round');

  const failed = await scenario({ permanentInvalid: true });
  assert.match(String(failed.error), /第 2\/.*质检连续返回无法验证/);
  assert.equal(failed.calls.length, 3, 'two bounded attempts at bad batch stop without visiting later batches');
  assert.equal(failed.persisted.departmentSteps[0].promptExecutionIds.length, failed.calls.length, 'failed QA still retains audit links to preceding valid and invalid replies');
  console.log(`production-batch-qa: 36 scenes, ${expected.length} semantic QA batches; scoped coverage, local retries, audit, late warning and repaired-output recheck passed`);
} finally {
  db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
