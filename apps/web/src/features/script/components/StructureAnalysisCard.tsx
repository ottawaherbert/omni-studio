import type { PlanningRepairTarget } from '../../../../../../packages/script/src/planningRepair';
import { getOutlineGuide, outlineText, anchorCurrent, type OutlineOwner } from '../../../../../../packages/script/src/outlineGuides';
import React from 'react';
import { unitCharacters } from '../../../../../../packages/script/src/continuity';
import { analysisEvidenceCurrent, type StructureAnalysis } from '../../../../../../packages/script/src/structureAnalysis';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import type { AssistantRequest } from '../scriptAssistantShortcuts';
import { bodyEvidenceSelection } from '../scriptAnalysisNavigation';

export type SceneEvidenceSource = { kind: 'SCENE_PLAN' | 'BODY_BLOCK'; field?: string; blockId?: string; quote?: string };
export type OutlineEvidenceSource = { owner: OutlineOwner; start: number; end: number; nodeId?: string; beatId?: string; tab?: 'outline' | 'beats' };
export type AnalysisEvidenceLocation = { scene?: SceneEvidenceSource; outline?: OutlineEvidenceSource };
const kindLabels = { OUTLINE_SPAN: '大纲原文', NODE_BEAT: '结构／节拍规划', SCENE_PLAN: '场景规划', BODY_BLOCK: '正文原文' };

export function StructureAnalysisCard({
  analysis,
  project,
  onRequest,
  onOpenScene,
  onOpenOutline,
  onRepair,
}: {
  onRepair?: (target: PlanningRepairTarget, instruction: string, source?: AnalysisEvidenceLocation) => void;
  analysis: StructureAnalysis;
  project: ScriptProject;
  onRequest: (request: AssistantRequest, source?: AnalysisEvidenceLocation) => void;
  onOpenScene: (unitId: string, sceneId: string, source?: SceneEvidenceSource) => void;
  onOpenOutline: (unitId: string, source?: OutlineEvidenceSource) => void;
}) {
  return (
    <section aria-label="结构与节奏分析" className="space-y-4">
      {/* Overview Card */}
      <div className="rounded-2xl bg-bg-surface p-5 shadow-xs space-y-2.5">
        <strong className="text-base font-semibold text-text-primary tracking-tight block">
          结构与节奏分析
        </strong>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
          {analysis.summary}
        </p>
        <p className="text-xs text-text-muted flex flex-wrap items-center gap-1 pt-1">
          <span>实际读取：</span>
          <span className="font-medium text-text-secondary">
            {analysis.evidenceKinds.map((kind) => kindLabels[kind]).join('、') || '无原文'}
          </span>
          <span>。</span>
          {!analysis.evidenceKinds.includes('BODY_BLOCK') && <span>本次没有正文检查依据。</span>}
        </p>
      </div>

      {/* Findings List */}
      <div className="space-y-3.5">
        {analysis.findings.map((finding) => {
          const e = finding.evidence,
            current = analysisEvidenceCurrent(project, e),
            unit = project.units.find((u) => u.id === e.unitId),
            scene = unit?.scenes.find((s) => s.id === e.sceneId);
          let request: AssistantRequest | undefined;
          const base = {
            id: Date.now(),
            label: '按分析建议修改',
            unitId: e.unitId,
            text: `请按这条意见提出修改候选，保留范围外内容。问题：${finding.issue}。建议：${finding.suggestion}。原文：${finding.quote}`,
          };
          if (current && e.kind === 'OUTLINE_SPAN') {
            const at = e.text.indexOf(finding.quote);
            if (at >= 0 && e.text.indexOf(finding.quote, at + 1) < 0)
              request = {
                ...base,
                stage: 'OUTLINE',
                draftOperation: 'outline_development',
                operation: e.owner!.kind === 'unit' ? 'unit_outline' : 'outline',
                ...(e.owner!.kind !== 'unit'
                  ? { scopeId: e.owner!.id, ...(e.owner!.kind === 'season' ? { seasonId: e.owner!.id } : {}) }
                  : {}),
                outlineStructure: false,
                outlineSceneOrder: false,
                outlineRange: { start: e.start + at, end: e.start + at + finding.quote.length, text: finding.quote },
              };
          }
          const guide = e.owner ? getOutlineGuide(project, e.owner) : undefined;
          let original = '';
          try {
            if (e.owner) original = outlineText(project, e.owner);
          } catch {
            /* A deleted source remains a stale historical finding. */
          }
          const related = e.beatId
            ? guide?.beats.find((b) => b.id === e.beatId)?.anchors
            : guide?.nodeLinks.filter((link) => link.nodeId === e.nodeId).map((link) => link.anchor);
          const quoteAt = e.text.indexOf(finding.quote),
            uniqueQuote = quoteAt >= 0 && e.text.indexOf(finding.quote, quoteAt + 1) < 0;
          const source: AnalysisEvidenceLocation = e.sceneId
            ? {
                scene: {
                  kind: e.kind === 'SCENE_PLAN' ? 'SCENE_PLAN' : 'BODY_BLOCK',
                  field: e.field,
                  blockId: e.blockId,
                  quote: finding.quote,
                },
              }
            : e.owner
              ? {
                  outline: {
                    owner: e.owner,
                    start:
                      e.kind === 'OUTLINE_SPAN'
                        ? uniqueQuote
                          ? e.start + quoteAt
                          : e.start
                        : related?.length
                          ? Math.min(...related.map((a) => a.start))
                          : 0,
                    end:
                      e.kind === 'OUTLINE_SPAN'
                        ? uniqueQuote
                          ? e.start + quoteAt + finding.quote.length
                          : e.end
                        : related?.length
                          ? Math.max(...related.map((a) => a.end))
                          : 0,
                    nodeId: e.nodeId,
                    ...(e.kind === 'NODE_BEAT'
                      ? { tab: e.beatId ? ('beats' as const) : ('outline' as const), ...(e.beatId ? { beatId: e.beatId } : {}) }
                      : {}),
                  },
                }
              : {};
          if (current && e.kind === 'NODE_BEAT' && e.owner && related?.length && related.every((a) => anchorCurrent(a, original))) {
            const start = Math.min(...related.map((a) => a.start)),
              end = Math.max(...related.map((a) => a.end));
            request = {
              ...base,
              stage: 'OUTLINE',
              draftOperation: 'outline_development',
              operation: e.owner.kind === 'unit' ? 'unit_outline' : 'outline',
              ...(e.owner.kind !== 'unit'
                ? { scopeId: e.owner.id, ...(e.owner.kind === 'season' ? { seasonId: e.owner.id } : {}) }
                : {}),
              outlineStructure: false,
              outlineSceneOrder: false,
              outlineRange: { start, end, text: original.slice(start, end) },
              text: `${base.text} 修改所引大纲及关键节拍，保持未涉及的变化和场景关联。`,
            };
          }
          if (current && e.kind === 'SCENE_PLAN')
            request = {
              ...base,
              stage: 'SCENES',
              draftOperation: 'scene_plan',
              operation: 'consult',
              sceneId: e.sceneId,
              text: `${base.text} 只修改本场规划，不写正文。`,
            };
          if (current && e.kind === 'BODY_BLOCK' && scene && unit) {
            const selection = bodyEvidenceSelection(scene.blocks, unitCharacters(project, unit), {
              blockId: e.blockId,
              quote: finding.quote,
            });
            if (selection)
              request = {
                ...base,
                stage: 'BODY',
                draftOperation: 'replace_selection',
                operation: 'text_rewrite',
                sceneId: scene.id,
                selection,
              };
          }

          return (
            <article
              key={finding.id}
              className="rounded-2xl bg-bg-surface p-5 shadow-xs space-y-3 hover:shadow-sm transition-all"
            >
              {/* Finding Tag & Scope */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-surface-soft text-text-secondary">
                    {kindLabels[e.kind]}
                  </span>
                  <span className="text-xs text-text-muted">
                    {scene?.title || unit?.title}
                  </span>
                </div>
                {!current && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600">
                    原文已变化，待复核
                  </span>
                )}
              </div>

              {/* Issue & Quote */}
              <p className="text-sm font-semibold text-text-primary tracking-tight">
                {finding.issue}
              </p>
              <blockquote className="rounded-xl bg-bg-surface-soft/60 p-3 text-xs text-text-secondary italic border-l-2 border-primary/40 leading-relaxed whitespace-pre-wrap">
                {finding.quote}
              </blockquote>

              {/* Suggestion */}
              <p className="text-xs text-text-secondary leading-relaxed bg-bg-surface-soft/30 p-2.5 rounded-xl">
                {finding.suggestion}
              </p>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={!current}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  onClick={() =>
                    e.sceneId
                      ? onOpenScene(e.unitId, e.sceneId, source.scene)
                      : onOpenOutline(e.unitId, source.outline)
                  }
                >
                  定位原文
                </button>
                {request && (
                  <button
                    type="button"
                    data-primary="true"
                    className="script-primary-btn px-3.5 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] shadow-xs transition-all cursor-pointer"
                    onClick={() => onRequest({ ...request!, id: Date.now() }, source)}
                  >
                    提出修改候选
                  </button>
                )}
                {current &&
                  e.kind === 'SCENE_PLAN' &&
                  analysis.target &&
                  !analysis.target.seasonId &&
                  !analysis.target.sceneId &&
                  (unit?.scenes.length ?? 0) > 1 && (
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      onClick={() =>
                        onRequest(
                          {
                            ...base,
                            id: Date.now(),
                            label: '按分析调整场序',
                            stage: 'SCENES',
                            operation: 'consult',
                            draftOperation: 'scene_order',
                            ...(analysis.target?.nodeId ? { nodeId: analysis.target.nodeId } : {}),
                            text: `${base.text} 仅调整本次所分析范围内已有场景的顺序，保留场景内容、正文和归属，不增加或删除场景。`,
                          },
                          source,
                        )
                      }
                    >
                      提出场序调整候选
                    </button>
                  )}
                {request && onRepair && e.kind !== 'BODY_BLOCK' && (
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() =>
                      onRepair(
                        e.kind === 'SCENE_PLAN'
                          ? { unitId: e.unitId, sceneId: e.sceneId }
                          : {
                              unitId: e.unitId,
                              scopeId: request!.scopeId,
                              seasonId: request!.seasonId,
                              outlineRange: request!.outlineRange,
                              outlineStructure: false,
                            },
                        `检查并修正这一范围的规划，最多两轮；将候选采用到独立工作稿并复核，完成后留给作者比较采用。重点意见：${finding.issue}。${finding.suggestion}`,
                        source,
                      )
                    }
                  >
                    检查并修正本范围，最多两轮
                  </button>
                )}
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                  onClick={() =>
                    onRequest(
                      {
                        ...base,
                        id: Date.now(),
                        stage: e.kind === 'BODY_BLOCK' ? 'BODY' : e.kind === 'SCENE_PLAN' ? 'SCENES' : 'OUTLINE',
                        operation: 'consult',
                        analysis: true,
                        ...(e.owner && e.owner.kind !== 'unit'
                          ? { scopeId: e.owner.id, ...(e.owner.kind === 'season' ? { seasonId: e.owner.id } : {}) }
                          : {}),
                        ...(e.nodeId ? { nodeId: e.nodeId } : {}),
                        ...(e.sceneId ? { sceneId: e.sceneId } : {}),
                        text: `请复核这一条结构节奏意见是否仍成立，引用当前原文，不改稿：${finding.issue}`,
                      },
                      source,
                    )
                  }
                >
                  重新检查
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
