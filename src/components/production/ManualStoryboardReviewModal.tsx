import { ShotExecutionEditor } from "./ShotExecutionEditor";
import { ShotAppearanceEditor } from "./ShotAppearanceEditor";
import { DirectorPlanSummary } from "./DirectorPlanSummary";
import type { Project, Scene, Shot, SceneDirectorPlan } from "../../clients/domainTypes";
import { AlertTriangle, Check, CheckCircle2, Film, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { StoryboardReviewCandidate } from "../../hooks/useStoryboardAI";

interface ManualStoryboardReviewModalProps {
  candidate: StoryboardReviewCandidate | null;
  project: Project;
  previousScene?: Scene;
  onChangeShot: (shot: Shot) => void;
  onChangePlan?: (plan: SceneDirectorPlan) => void;
  onClose: () => void;
  onAdopt: () => void;
}

export function ManualStoryboardReviewModal({ candidate, project, previousScene, onChangeShot, onChangePlan, onClose, onAdopt }: ManualStoryboardReviewModalProps) {
  if (!candidate) return null;
  const hasBlockingIssue = candidate.issues.some((issue) => issue.severity === "blocking");
  const totalDuration = candidate.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  const title = candidate.kind === "shots"
    ? "镜头方案需要决策"
    : candidate.kind === "image_prompts"
      ? "图片提示词需要决策"
      : "视频提示词需要决策";
  const quality = candidate.audit.agentQuality;
  const promptExecutions = candidate.audit.promptExecutions || [];

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-3 sm:p-8 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-neutral-900">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-5 dark:border-neutral-800">
          <div>
            <div className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Film className="h-5 w-5 text-violet-600" />
              <h2 className="text-lg font-bold">{title}</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {candidate.shots.length} 个镜头 · {Math.round(totalDuration)} 秒 · {promptExecutions.length || 1} 次模型调用已审计
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {candidate.kind === "shots" && <DirectorPlanSummary plan={candidate.directorPlan} shots={candidate.shots} candidate onChange={onChangePlan} />}
          {candidate.kind === "shots" && Boolean(previousScene?.shots?.length) && <details className="mb-4 text-xs text-gray-600 dark:text-neutral-300">
            <summary className="cursor-pointer">对照当前已采用版本 · {previousScene!.shots!.length} 镜 · {Math.round(previousScene!.shots!.reduce((sum, shot) => sum + (shot.duration || 0), 0))} 秒</summary>
            <DirectorPlanSummary plan={previousScene?.manualStoryboard?.directorPlan} shots={previousScene!.shots!} />
            <ol className="mt-2 list-inside list-decimal space-y-1 leading-5">{previousScene!.shots!.map(shot => <li key={shot.id}>{[shot.shotSize, shot.cameraMovement, shot.visualAction].filter(Boolean).join(" · ")}</li>)}</ol>
          </details>}
          {candidate.authorEdited && <p className="mb-4 text-xs leading-5 text-amber-600 dark:text-amber-400">候选已手动修改。采用前请核对当前内容；下方 AI 质检针对生成时版本，不能证明修改后的效果。</p>}
          {quality && (
            <div className={`mb-5 flex items-start justify-between gap-5 rounded-md px-4 py-3 ${quality.verdict === "pass" && quality.score >= 90 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
              <div className="flex min-w-0 items-start gap-2.5">
                {quality.verdict === "pass" && quality.score >= 90
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <p className="text-xs font-bold">{quality.reviewKind === "author_self_review" ? "作者自查" : "独立质检"} {quality.score} 分 · {quality.verdict === "pass" ? "通过" : "需修订"}</p>
                  <p className="mt-1 text-xs leading-5 opacity-80">{quality.summary || "已完成结构、剧本覆盖、节奏、连续性与资产一致性检查。"}</p>
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-bold">尚未写入当前场</span>
            </div>
          )}

          {candidate.issues.length > 0 && (
            <div className="mb-5 space-y-2">
              {candidate.issues.map((issue, index) => (
                <div
                  key={`${issue.message}-${index}`}
                  className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${issue.severity === "blocking" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {candidate.shots.map((shot, index) => (
              <article key={shot.id} className="rounded-md border border-gray-200 p-4 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-gray-900 dark:text-white">镜头 {String(index + 1).padStart(2, "0")}</strong>
                  <span className="text-xs font-bold text-violet-600">{shot.duration || 0}s</span>
                </div>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-gray-600 dark:text-neutral-300">
                  {shot.visualAction || "缺少可见动作"}
                </p>
                {candidate.kind === "shots" ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                    <div><dt>景别</dt><dd className="font-semibold text-gray-800 dark:text-neutral-200">{shot.shotSize || "未设置"}</dd></div>
                    <div><dt>运动</dt><dd className="font-semibold text-gray-800 dark:text-neutral-200">{shot.cameraMovement || "未设置"}</dd></div>
                  </dl>
                ) : (
                  <div className="mt-3 space-y-2 text-[11px] leading-4 text-gray-500">
                    {candidate.kind === "image_prompts" ? (
                      <p className="line-clamp-5"><b className="text-gray-800 dark:text-neutral-200">图片：</b>{shot.imagePrompt || "缺失"}</p>
                    ) : (
                      <p className="line-clamp-5"><b className="text-gray-800 dark:text-neutral-200">视频：</b>{shot.videoPrompt || "缺失"}</p>
                    )}
                  </div>
                )}
              <details className="mt-3 text-xs text-gold"><summary className="cursor-pointer font-semibold">{candidate.kind === "shots" ? "编辑本镜拍法、表演与声音" : "编辑本镜提示词"}</summary><div className="mt-3">
                {candidate.kind === "shots" ? <ShotExecutionEditor shot={shot} onChange={onChangeShot} /> : <label className="block text-text-secondary">{candidate.kind === "image_prompts" ? "图片提示词" : "视频提示词"}<textarea aria-label={candidate.kind === "image_prompts" ? "候选图片提示词" : "候选视频提示词"} className="mt-1 min-h-40 w-full rounded-md border border-border-soft bg-bg-primary p-2 text-xs" value={candidate.kind === "image_prompts" ? shot.imagePrompt || "" : shot.videoPrompt || ""} onChange={e => onChangeShot({ ...shot, [candidate.kind === "image_prompts" ? "imagePrompt" : "videoPrompt"]: e.target.value })} /></label>}
                {candidate.kind === "image_prompts" && <label className="mt-3 block text-text-secondary">画面摘要<textarea aria-label="候选画面摘要" className="mt-1 min-h-20 w-full rounded-md border border-border-soft bg-bg-primary p-2 text-xs" value={shot.visualSummary || ""} onChange={e => onChangeShot({ ...shot, visualSummary: e.target.value })} /></label>}
              </div></details>
              {candidate.kind === "shots" && <ShotAppearanceEditor project={project} shot={shot} onChange={onChangeShot} />}
              </article>
            ))}
          </div>

          {(candidate.audit.confirmedPrompt || promptExecutions.length > 0) && (
            <details className="mt-6 border-t border-gray-200 pt-4 dark:border-neutral-800">
              <summary className="cursor-pointer text-xs font-bold text-gray-700 dark:text-neutral-200">
                查看 Prompt、Skill 与自动修订审计
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-[11px] text-gray-500">
                  Skill：{candidate.audit.selectedSkillTitles.join("、") || "未额外选择"} · 上下文 {candidate.audit.selectedContextIds.length} 项
                </p>
                {promptExecutions.map((execution, index) => (
                  <details key={`${execution.action}-${execution.startedAt}-${index}`} className="rounded-md border border-gray-200 px-3 py-2 dark:border-neutral-800">
                    <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-neutral-200">
                      {index + 1}. {execution.action === "generate" ? "生成" : execution.action === "qa" ? "独立质检" : "自动修订"}
                      {typeof execution.score === "number" ? ` · ${execution.score} 分` : ""}
                      {execution.status === "failed" ? " · 失败" : " · 完成"}
                    </summary>
                    {execution.issueSummary?.length ? (
                      <ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                        {execution.issueSummary.map((issue, issueIndex) => <li key={`${issue}-${issueIndex}`}>{issue}</li>)}
                      </ul>
                    ) : null}
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-[10px] leading-5 text-gray-600 dark:bg-neutral-950 dark:text-neutral-300">
                      {execution.prompt}
                    </pre>
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-neutral-800">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 dark:text-neutral-300 dark:hover:text-white">
            暂不采用
          </button>
          <button
            type="button"
            onClick={onAdopt}
            disabled={hasBlockingIssue}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-4 w-4" />
            采用到当前场
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
