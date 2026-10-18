import { AlertTriangle, Check, Clapperboard, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ManualVideoStoryboardCandidate } from "../../hooks/useManualVideoStoryboard";

interface ManualVideoStoryboardReviewModalProps {
  candidate: ManualVideoStoryboardCandidate | null;
  onClose: () => void;
  onAdopt: () => void;
}

export function ManualVideoStoryboardReviewModal({ candidate, onClose, onAdopt }: ManualVideoStoryboardReviewModalProps) {
  if (!candidate) return null;
  const blocking = candidate.issues.some((item) => item.severity === "blocking");
  const title = candidate.kind === "strategy" ? "预览故事板策略" : candidate.kind === "board" ? "预览视频故事板" : "预览故事板质检";

  return createPortal(
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-neutral-900">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-5 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {candidate.issues.length > 0 && (
            <div className="mb-5 space-y-2">
              {candidate.issues.map((issue, index) => (
                <div key={`${issue.code}-${index}`} className={`flex gap-2 rounded-md px-3 py-2 text-xs ${issue.severity === "blocking" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {candidate.kind === "strategy" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border border-gray-200 p-4 dark:border-neutral-800"><p className="text-xs text-gray-400">策略</p><p className="mt-1 font-bold">{candidate.decision.selectedStrategyId}</p></div>
                <div className="rounded-md border border-gray-200 p-4 dark:border-neutral-800"><p className="text-xs text-gray-400">视频模型 Profile</p><p className="mt-1 font-bold">{candidate.decision.selectedModelProfileId}</p></div>
                <div className="rounded-md border border-gray-200 p-4 dark:border-neutral-800"><p className="text-xs text-gray-400">预计控制图</p><p className="mt-1 font-bold">{candidate.decision.expectedBoardShape}</p></div>
              </div>
              <p className="text-sm leading-6 text-gray-700 dark:text-neutral-200">{candidate.decision.rationale}</p>
              {candidate.decision.riskNotes.map((note) => <p key={note} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{note}</p>)}
            </div>
          )}

          {candidate.kind === "board" && candidate.workflow.board && (
            <div>
              <p className="mb-4 text-sm leading-6 text-gray-600 dark:text-neutral-300">{candidate.workflow.board.lineArtPrompt}</p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {candidate.workflow.board.panels.map((panel) => (
                  <article key={panel.id} className="rounded-md border border-gray-200 p-4 dark:border-neutral-800">
                    <div className="flex justify-between"><strong className="text-xs">PANEL {panel.panelNumber}</strong><span className="text-xs text-violet-600">{panel.durationSeconds || 0}s</span></div>
                    <p className="mt-2 text-xs font-semibold text-gray-800 dark:text-neutral-100">{panel.framePurpose}</p>
                    <p className="mt-2 text-xs leading-5 text-gray-500">{panel.visualBeat || panel.subjectAction}</p>
                    <p className="mt-2 text-[11px] text-gray-400">{panel.cameraNote || panel.cameraMove}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {candidate.kind === "qa" && (
            <div>
              <div className="flex items-end gap-3"><strong className="text-4xl text-gray-900 dark:text-white">{candidate.qa.score}</strong><span className="pb-1 text-sm font-bold uppercase text-gray-400">{candidate.qa.verdict}</span></div>
              <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-neutral-300">{candidate.qa.summary}</p>
              <div className="mt-4 space-y-2">
                {candidate.qa.issues.map((issue, index) => <div key={`${issue.description}-${index}`} className="rounded-md border border-gray-200 p-3 text-xs dark:border-neutral-800"><b>{issue.severity}</b> · {issue.description}<p className="mt-1 text-gray-500">{issue.suggestion}</p></div>)}
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-neutral-800">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-500">放弃草案</button>
          <button type="button" onClick={onAdopt} disabled={blocking} className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            <Check className="h-4 w-4" />
            采用
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
