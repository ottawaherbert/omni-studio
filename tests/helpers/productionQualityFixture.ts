import assert from 'node:assert/strict';
import type { SceneDirectorPlan } from '../../packages/domain/src/directorPlan';
import type { ProductionQuality } from '../../src/server/productionQuality';
import { qualityStages, type ProductionQualityStage, type QualityTarget } from '../../packages/domain/src/productionQuality';

/** Test-only authored plan. These records exercise the real review service in an isolated DB;
 * they represent protocol fixture decisions, never acceptance of a production work. */
export function fixtureDirectorPlan(intent = '人物放下杯子，动作完成后观察结果'): SceneDirectorPlan {
  return { schemaVersion: 'scene-director.v1', id: 'fixture-director', intent, rhythm: '动作、停顿、反应', requirements: [], beatDirections: [], assumptions: [], applications: [], exceptions: [], assetIds: [], createdAt: 1, sourceHash: 'fixture', bindingHash: 'fixture', skillTitle: '隔离测试本场方案' };
}

export async function reviewFixtureStage(quality: ProductionQuality, stage: ProductionQualityStage, target: QualityTarget) {
  if (!quality.responsibility(target.projectId)) quality.saveResponsibility(target.projectId, {
    director: '隔离测试导演', coordinator: '隔离测试统筹', intent: '验证已编写的测试场次及候选来源合同',
    visualDirection: '测试场景中的角色、空间与动作保持可辨识；仅协议夹具，不代表作品创作验收', spatialMode: 'scene_plan',
  });
  const inspection = await quality.inspect(stage, target);
  assert.ok(inspection.snapshot, `${stage} must freeze the actual fixture content`);
  const record = quality.review(inspection.id, { verdict: 'passed', reviewerName: '隔离测试导演',
    findings: qualityStages[stage].checks.map(check => ({check, passed: true, note: `隔离协议夹具：已核对冻结的 ${stage} 内容及 ${check}，仅用于测试前置条件。` })),
  }, 'external_agent');
  assert.equal(record.verdict, 'passed');
  assert.equal(quality.state(stage, target).status, 'passed');
}

/** Explicitly called after a fixture's authored changes, never hooked into generation/preflight. */
export async function reviewFixturePreparation(quality: ProductionQuality, target: QualityTarget) {
  for (const stage of ['project_plan', 'scene_plan', 'shot_plan', 'preparation'] as const) {
    if (quality.state(stage, target).status !== 'passed') await reviewFixtureStage(quality, stage, target);
  }
}
