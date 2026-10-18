import { formatAIExecutionProvenance } from "../../utils/aiExecutionProvenance";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import type { ManualProductionReferenceImageCandidate } from "../../hooks/useManualProductionAssetImages";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export function ManualProductionReferenceReviewModal({
  candidate,
  isAdopting,
  onClose,
  onAdopt,
}: {
  candidate: ManualProductionReferenceImageCandidate | null;
  isAdopting: boolean;
  onClose: () => void;
  onAdopt: () => void;
}) {
  return (
    <Modal
      isOpen={Boolean(candidate)}
      onClose={isAdopting ? () => undefined : onClose}
      title="资产参考图候选"
      size="lg"
      className="bg-bg-surface text-text-primary"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isAdopting}>
            <X className="h-4 w-4" />
            放弃候选
          </Button>
          <Button size="sm" onClick={onAdopt} disabled={isAdopting}>
            {isAdopting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            采用为正式参考图
          </Button>
        </>
      }
    >
      {candidate && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-border-soft/20 bg-bg-primary">
            <img src={candidate.imageUrl} alt={`${candidate.board.assetName}参考图候选`} className="max-h-[66vh] w-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <aside className="min-w-0 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-text-muted">资产身份</p>
              <h3 className="mt-1 text-base font-black text-text-primary">{candidate.board.assetName}</h3>
              <p className="mt-1 text-xs text-text-muted">{candidate.board.variantName || "基础身份"}</p>
            </div>
            <div className="rounded-lg bg-bg-surface-soft p-4">
              <p className="text-[10px] font-bold text-text-muted">来源记录</p>
              <dl className="mt-3 space-y-2 text-xs text-text-secondary">
                <div className="flex justify-between gap-3"><dt>来源</dt><dd className="truncate font-bold">{candidate.source === "upload" ? "本地上传" : candidate.source === "existing" ? "已有素材" : "AI 生成"}</dd></div>
                {candidate.source === "ai_generation" && <>
                  <div className="flex justify-between gap-3"><dt>执行来源</dt><dd className="truncate font-bold">{formatAIExecutionProvenance(candidate.executionProvenance, candidate.modelId, candidate.source)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Skill</dt><dd className="font-bold">{candidate.selection?.selectedSkillIds.length || 0}</dd></div>
                  <div className="flex justify-between gap-3"><dt>上下文</dt><dd className="font-bold">{candidate.selection?.selectedContextIds.length || 0}</dd></div>
                </>}
              </dl>
            </div>
            {candidate.sourceReview?.status === "review_recommended" && (
              <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary">
                <p className="flex items-center gap-2 font-black text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  来源有更新，建议复核
                </p>
                <p className="mt-1 leading-5 text-text-muted">候选仍保留，系统不会自动撤销或采用；你可以看图后继续明确采用。</p>
              </div>
            )}
            {candidate.source === "ai_generation" && <details className="rounded-lg border border-border-soft/20 bg-bg-surface-soft p-4 text-xs">
              <summary className="cursor-pointer font-bold text-gold">查看最终提示词</summary>
              <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-text-secondary custom-scrollbar">{candidate.finalPrompt}</pre>
            </details>}
          </aside>
        </div>
      )}
    </Modal>
  );
}
