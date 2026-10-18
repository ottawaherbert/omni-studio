import { formatAIExecutionProvenance } from "../../utils/aiExecutionProvenance";
import { Check, Loader2, X } from "lucide-react";

import type { ProductionAssetProfileCandidate } from "../../hooks/useProductionAssetProfileAI";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  visualIdentity: "可见身份锚点",
  psychologicalProfile: "心理画像",
  mbti: "MBTI",
  enneagram: "九型人格",
  internalDesire: "内在渴望",
  externalGoal: "外在目标",
  flaw: "压力弱点",
  actingStyle: "表演流派 / 策略",
  vocalQuirk: "语言与声线行为",
  sliders: "情绪 / 压力维度",
  description: "制作身份描述",
  tags: "关键词",
};

const renderValue = (value: unknown) => {
  if (Array.isArray(value)) return value.join("、") || "未设置";
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${item}`).join("；") || "未设置";
  return String(value || "未设置");
};

export function ProductionAssetProfileReviewModal({
  candidate,
  isAdopting,
  onClose,
  onAdopt,
  onEdit,
  confirmText,
}: {
  candidate: ProductionAssetProfileCandidate | null;
  isAdopting: boolean;
  onClose: () => void;
  onAdopt: () => void;
  onEdit?: (field: string, value: string) => void;
  confirmText?: string;
}) {
  return (
    <Modal
      isOpen={Boolean(candidate)}
      onClose={isAdopting ? () => undefined : onClose}
      title={candidate?.task === 'appearance' ? '形象设计候选' : '制作档案候选'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isAdopting} leftIcon={<X className="h-4 w-4" />}>放弃候选</Button>
          <Button size="sm" onClick={onAdopt} disabled={isAdopting || !candidate?.changedFields.length} leftIcon={isAdopting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}>{confirmText || '采用档案修改'}</Button>
        </>
      }
    >
      {candidate && (
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><h3 className="text-base font-black text-text-primary">{candidate.assetName}</h3><p className="mt-1 text-xs text-text-muted">{candidate.changedFields.length} 项变化 · 采用后作为制作资料</p></div>
            <p className="text-[10px] text-text-muted">{formatAIExecutionProvenance(candidate.executionProvenance, candidate.modelId)} · Skill {candidate.metadata?.selectedSkillIds.length || 0}</p>
          </div>
          {candidate.task && <div className="mb-4 space-y-2 border-y border-border-soft/20 py-3 text-xs leading-5 text-text-secondary">
            <p className="font-bold">{candidate.task === "appearance" ? "外观设计候选，新增内容不代表原文事实" : "依据已选来源整理，未知内容允许留空"}</p>
            <p>本次依据：{candidate.sourceLabels?.join("；") || "未选择来源"}</p>
            <p className="whitespace-pre-wrap">{candidate.sourceNotes}</p>
            {!candidate.changedFields.length && <p>没有需要写入的变化，可关闭后继续制作。</p>}
          </div>}
          {candidate.review && <div className={candidate.review.verdict === "pass" ? "mb-4 border-y border-emerald-500/20 bg-emerald-500/5 px-4 py-3" : "mb-4 border-y border-red-500/20 bg-red-500/5 px-4 py-3"}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-black text-text-primary">质检 {candidate.review.score} 分 · {candidate.review.verdict === "pass" ? "已通过" : "需要修正"}</p>
              <p className="text-[10px] text-text-muted">{candidate.review.attempts.length} 轮生成后复检</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-text-secondary">{candidate.review.summary}</p>
            {candidate.review.issues.length > 0 && (
              <div className="mt-2 space-y-1 text-[10px] text-text-secondary">
                {candidate.review.issues.map((issue, index) => <p key={`${issue.field}:${index}`}>[{issue.severity}] {issue.field}：{issue.description}</p>)}
              </div>
            )}
            <details className="mt-2 text-[10px] text-text-muted">
              <summary className="cursor-pointer font-bold text-gold">查看质检与修正审计</summary>
              <div className="mt-2 space-y-3">
                {candidate.review.attempts.map((attempt) => (
                  <div key={attempt.attempt} className="border-t border-border-soft/20 pt-2">
                    <p className="font-bold text-text-secondary">第 {attempt.attempt} 轮 · {attempt.score} 分 · {attempt.verdict} · {formatAIExecutionProvenance(attempt.executionProvenance, attempt.modelId)}</p>
                    <p className="mt-1">{attempt.summary}</p>
                    <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 custom-scrollbar">{attempt.finalPrompt}</pre>
                  </div>
                ))}
              </div>
            </details>
          </div>}
          <div className="divide-y divide-border-soft/20 border-y border-border-soft/20">
            {candidate.changedFields.map((field) => (
              <div key={field} className="grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] gap-4 py-4 text-xs">
                <p className="font-black text-text-primary">{FIELD_LABELS[field] || field}</p>
                <div><p className="mb-1 text-[9px] font-bold text-text-muted">当前</p><p className="whitespace-pre-wrap leading-5 text-text-secondary">{renderValue(candidate.currentValues[field])}</p></div>
                <div><p className="mb-1 text-[9px] font-bold text-emerald-600">候选</p>{onEdit && candidate.task === 'appearance' ? <textarea aria-label={`${FIELD_LABELS[field] || field}设计候选`} value={String(candidate.proposedValues[field] || '')} onChange={event => onEdit(field, event.target.value)} disabled={isAdopting} className="min-h-48 w-full resize-y rounded-md bg-bg-surface-soft p-3 text-sm leading-6" /> : <p className="whitespace-pre-wrap leading-5 text-text-primary">{renderValue(candidate.proposedValues[field])}</p>}</div>
              </div>
            ))}
          </div>
          <details className="mt-4 rounded-lg border border-border-soft/20 bg-bg-surface-soft p-4 text-xs">
            <summary className="cursor-pointer font-bold text-gold">查看最终提示词</summary>
            <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap leading-5 text-text-secondary custom-scrollbar">{candidate.finalPrompt}</pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
