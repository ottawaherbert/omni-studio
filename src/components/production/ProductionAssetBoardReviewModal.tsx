import { formatAIExecutionProvenance } from "../../utils/aiExecutionProvenance";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { isProductionAssetBoardVisualQualityPassing } from "../../clients/productionVisualImageClient";
import type { ProductionAssetBoardCandidate } from "../../hooks/useProductionAssetBoardImage";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export function ProductionAssetBoardReviewModal({
  candidate,
  isAdopting,
  onClose,
  onAdopt,
}: {
  candidate: ProductionAssetBoardCandidate | null;
  isAdopting: boolean;
  onClose: () => void;
  onAdopt: () => void;
}) {
  const automaticQualityPassed = Boolean(
    candidate?.quality && isProductionAssetBoardVisualQualityPassing(candidate.quality),
  );

  return (
    <Modal
      isOpen={Boolean(candidate)}
      onClose={isAdopting ? () => undefined : onClose}
      title={candidate?.referenceMode === "clean_reference" ? "纯净参考候选" : "资料资产板候选"}
      size="xl"
      className="bg-bg-surface text-text-primary"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isAdopting} leftIcon={<X className="h-4 w-4" />}>
            放弃候选
          </Button>
          <Button size="sm" onClick={onAdopt} disabled={isAdopting} leftIcon={isAdopting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}>
            {candidate?.referenceMode === "clean_reference" ? "采用为纯净参考" : "采用为资料资产板"}
          </Button>
        </>
      }
    >
      {candidate && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-[430px] items-center justify-center overflow-hidden rounded-lg border border-border-soft/20 bg-bg-primary">
            <img src={candidate.imageUrl} alt={`${candidate.board.assetName}资产板候选`} className="max-h-[68vh] w-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <aside className="min-w-0 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-text-muted">资产身份</p>
              <h3 className="mt-1 text-base font-black text-text-primary">{candidate.board.assetName}</h3>
              <p className="mt-1 text-xs text-text-muted">{candidate.board.variantName || "基础身份"} · {candidate.referenceMode === "clean_reference" ? "无文字模型参考" : "制作资料板"}</p>
            </div>
            <dl className="space-y-2 rounded-lg bg-bg-surface-soft p-4 text-xs text-text-secondary">
              <div className="flex justify-between gap-3"><dt>来源</dt><dd className="font-bold">{candidate.source === "upload" ? "本地导入" : candidate.source === "existing" ? "既有素材" : "AI 生成"}</dd></div>
              <div className="flex justify-between gap-3"><dt>执行来源</dt><dd className="truncate font-bold">{formatAIExecutionProvenance(candidate.executionProvenance, candidate.modelId, candidate.source)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Skill</dt><dd className="font-bold">{candidate.selection?.selectedSkillIds.length || 0}</dd></div>
              <div className="flex justify-between gap-3"><dt>上下文</dt><dd className="font-bold">{candidate.selection?.selectedContextIds.length || 0}</dd></div>
              <div className="flex justify-between gap-3"><dt>版式合同</dt><dd className="max-w-[170px] truncate font-bold">{candidate.layoutContractId}</dd></div>
            </dl>
            {candidate.sourceReview?.status === "review_recommended" && (
              <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary">
                <p className="flex items-center gap-2 font-black text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  来源有更新，建议复核
                </p>
                <p className="mt-1 leading-5 text-text-muted">候选仍保留，系统不会自动撤销或采用；你可以看图后继续明确采用。</p>
              </div>
            )}
            <div className={`border px-4 py-3 text-xs ${automaticQualityPassed ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`}>
              <p className="font-black text-text-primary">
                {candidate.quality
                  ? automaticQualityPassed
                    ? `整板质检 ${candidate.quality.score} 分 · 仍待人工采用`
                    : `整板质检 ${candidate.quality.score} 分 · 未通过，需人工判断`
                  : "整板待人工看图验收"}
              </p>
              <p className="mt-1 text-[10px] text-text-muted">{candidate.quality && formatAIExecutionProvenance(candidate.review.executionProvenance)}</p>
              <p className="mt-1 leading-5 text-text-muted">{candidate.quality?.summary || "请检查这是一张完整横向制作参考板，且必需视图、身份、空间/结构和状态全部一致。"}</p>
              {candidate.quality?.issues.length ? <p className="mt-2 text-[10px] text-text-muted">{candidate.quality.issues.map((issue) => `[${issue.severity}] ${issue.description}`).join("；")}</p> : null}
            </div>
            <details className="rounded-lg border border-border-soft/20 bg-bg-surface-soft p-4 text-xs">
              <summary className="cursor-pointer font-bold text-gold">查看最终提示词</summary>
              <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-text-secondary custom-scrollbar">{candidate.finalPrompt || "本次为本地导入，没有调用模型。"}</pre>
            </details>
          </aside>
        </div>
      )}
    </Modal>
  );
}
