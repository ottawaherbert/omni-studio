import { CheckCircle2, CircleAlert, Layers3, RefreshCw, ShieldCheck, UserRound } from "lucide-react";

import type { ProductionAssetPreparationCandidate } from "../../hooks/useProductionAssetPreparationAI";
import { productionAssetPreparationVariantId } from "../../clients/productionAssetWorkflowClient";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { cn } from "../../lib/utils";

export function ProductionAssetPreparationReviewModal({
  candidate,
  isAdopting,
  onClose,
  onRerun,
  onAdopt,
}: {
  candidate: ProductionAssetPreparationCandidate | null;
  isAdopting: boolean;
  onClose: () => void;
  onRerun: () => void;
  onAdopt: () => void;
}) {
  if (!candidate) return null;
  const variantDecisions = candidate.decisions.filter((decision) => decision.use === "variant");
  const variantIds = new Set(variantDecisions.map(productionAssetPreparationVariantId));
  const changedProfiles = candidate.profiles.filter((profile) => profile.changedFields.length);
  const passed = candidate.review.verdict === "pass" && candidate.structureErrors.length === 0;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="整批资产筹备预览"
      size="xl"
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isAdopting}>放弃候选</Button>
          <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRerun} disabled={isAdopting}>AI 继续优化</Button>
          <Button size="sm" onClick={onAdopt} disabled={isAdopting}>
            {isAdopting ? "正在写入项目" : "采用整批结果"}
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <section
          className="grid divide-x divide-border-soft/25 border-y border-border-soft/20 py-3 text-center"
          style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
        >
          <Metric value={candidate.review.score} label="综合质量" attention={!passed} />
          <Metric value={changedProfiles.length} label="档案更新" />
          <Metric value={variantIds.size} label="正式变体" />
          <Metric value={candidate.decisions.length} label="场次绑定" />
        </section>

        <section className={cn("flex items-start gap-3 border-l-2 px-4 py-3", passed ? "border-emerald-500 bg-emerald-500/5" : "border-amber-500 bg-amber-500/5")}>
          {passed ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
          <div>
            <p className="text-sm font-black">{passed ? "自动质检已通过" : "候选暂不可采用"}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{candidate.review.summary}</p>
            <p className="mt-1 text-xs text-text-muted">
              {`共 ${candidate.review.attempts.length} 轮自动质检与修正；采用前没有再次弹出提示词。`}
            </p>
          </div>
        </section>

        {(candidate.structureErrors.length > 0 || candidate.review.issues.length > 0) && (
          <section>
            <h3 className="text-xs font-black">质检问题</h3>
            <div className="mt-2 divide-y divide-border-soft/20 border-y border-border-soft/20">
              {candidate.structureErrors.map((error) => <Issue key={error} title="结构校验" description={error} />)}
              {candidate.review.issues.map((issue, index) => (
                <Issue key={`${issue.targetId}-${index}`} title={`${issue.targetType} · ${issue.targetId}`} description={issue.description} suggestion={issue.suggestion} advisory={issue.severity === "advisory"} />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-2 text-xs font-black"><UserRound className="h-3.5 w-3.5 text-gold" />项目级档案</h3>
            <span className="text-[10px] text-text-muted">只更新预览中列出的字段</span>
          </div>
          <div className="mt-2 divide-y divide-border-soft/20 border-y border-border-soft/20">
            {candidate.profiles.map((profile) => (
              <details key={profile.assetId} className="py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xs">
                  <span className="font-black">{profile.assetName}</span>
                  <span className={cn("text-[10px] font-bold", profile.changedFields.length ? "text-gold" : "text-text-muted")}>{profile.changedFields.length ? `${profile.changedFields.length} 项更新` : "沿用现有档案"}</span>
                </summary>
                {profile.changedFields.length > 0 && (
                  <pre className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap bg-bg-surface-soft p-3 text-[10px] leading-5 text-text-secondary">
                    {JSON.stringify(Object.fromEntries(profile.changedFields.map((field) => [field, profile.proposedValues[field]])), null, 2)}
                  </pre>
                )}
                <div className="mt-3 grid gap-3 text-xs" style={{ gridTemplateColumns: profile.assumptions?.length ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" }}>
                  <ProfileSourceList title="来源证据" items={profile.evidence || []} />
                  {Boolean(profile.assumptions?.length) && <ProfileSourceList title="设计假设 / 待确认" items={profile.assumptions || []} attention />}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-2 text-xs font-black"><Layers3 className="h-3.5 w-3.5 text-gold" />场次状态绑定</h3>
            <span className="text-[10px] text-text-muted">基础身份 {candidate.decisions.length - variantDecisions.length} · 状态变体 {variantDecisions.length}</span>
          </div>
          <div className="mt-2 max-h-72 divide-y divide-border-soft/20 overflow-y-auto border-y border-border-soft/20">
            {candidate.decisions.map((decision) => {
              const usage = candidate.context.usages.find((item) => item.sceneId === decision.sceneId && item.assetId === decision.assetId);
              return (
                <div
                  key={`${decision.sceneId}:${decision.assetId}`}
                  className="grid gap-4 py-3"
                  style={{ gridTemplateColumns: "minmax(0, 1fr) 110px" }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black">{usage?.sceneTitle || decision.sceneId} · {usage?.assetName || decision.assetId}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{decision.reason}</p>
                    {decision.use === "variant" && <p className="mt-1 text-xs leading-5 text-text-secondary">{decision.variantName}：{decision.visibleDelta}</p>}
                  </div>
                  <span className={cn("self-start rounded px-2 py-1 text-center text-[9px] font-black", decision.use === "variant" ? "bg-gold/10 text-gold" : "bg-bg-surface-soft text-text-muted")}>
                    {decision.use === "variant" ? "状态变体" : "基础身份"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <details>
          <summary className="cursor-pointer text-[10px] font-black text-gold">查看质检与提示词审计</summary>
          <div className="mt-3 space-y-3">
            {candidate.review.attempts.map((attempt) => (
              <details key={attempt.attempt} className="border-l-2 border-border-soft/30 pl-3">
                <summary className="cursor-pointer text-[10px] font-bold">第 {attempt.attempt} 轮 · {attempt.score} 分 · {attempt.verdict}</summary>
                <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap bg-bg-surface-soft p-3 text-[9px] leading-4">{attempt.finalPrompt}</pre>
              </details>
            ))}
            <details className="border-l-2 border-border-soft/30 pl-3">
              <summary className="cursor-pointer text-[10px] font-bold">首次确认提示词</summary>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap bg-bg-surface-soft p-3 text-[9px] leading-4">{candidate.finalPrompt}</pre>
            </details>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function Metric({ value, label, attention = false }: { value: string | number; label: string; attention?: boolean }) {
  return <div><p className={cn("text-xl font-black", attention ? "text-amber-500" : "text-text-primary")}>{value}</p><p className="mt-1 text-[10px] text-text-muted">{label}</p></div>;
}

function Issue({ title, description, suggestion, advisory = false }: { title: string; description: string; suggestion?: string; advisory?: boolean }) {
  return (
    <div className="flex gap-3 py-3 text-[10px]">
      {advisory ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
      <div><p className="font-black text-text-secondary">{title}</p><p className="mt-1 leading-4 text-text-muted">{description}</p>{suggestion && <p className="mt-1 leading-4 text-text-secondary">{suggestion}</p>}</div>
    </div>
  );
}

function ProfileSourceList({ title, items, attention = false }: { title: string; items: string[]; attention?: boolean }) {
  return (
    <div className={cn("border-l-2 px-3 py-2", attention ? "border-amber-400 bg-amber-400/5" : "border-border-soft/40 bg-bg-surface-soft/60")}>
      <p className="font-black text-text-secondary">{title}</p>
      {items.length ? items.map((item, index) => <p key={`${item}-${index}`} className="mt-1 leading-5 text-text-muted">{item}</p>) : <p className="mt-1 text-text-muted">未提供</p>}
    </div>
  );
}
