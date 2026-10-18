import { Check, X } from "lucide-react";

import type { VisualImageCandidate, VisualStyleLock } from "../../clients/domainTypes";
import {
  resolveVisualImageCandidateSourceStatus,
  type VisualImageCandidateSourceOwner,
} from "../../clients/productionVisualImageClient";

const kindLabel: Record<VisualImageCandidate["kind"], string> = {
  base: "基础形象",
  multiview: "多视图",
  variant: "状态变体",
};

export function VisualImageCandidatePanel({
  candidates,
  owner,
  visualStyleLock,
  onAdopt,
  onReject,
}: {
  candidates?: VisualImageCandidate[];
  owner: VisualImageCandidateSourceOwner;
  visualStyleLock?: VisualStyleLock;
  onAdopt: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
}) {
  if (!candidates?.length) return null;
  return (
    <section className="space-y-3 border-t border-border-soft/20 pt-5" aria-label="待采用图片候选">
      <div>
        <h3 className="text-xs font-black text-text-primary">待人工采用的图片</h3>
        <p className="mt-1 text-[10px] leading-4 text-text-muted">生成结果不会自动替换正式资产。预览后明确采用或丢弃。</p>
      </div>
      <div className="grid gap-3">
        {[...candidates].sort((left, right) => right.createdAt - left.createdAt).map((candidate) => {
          const styleSourceStatus = resolveVisualImageCandidateSourceStatus(candidate, owner, visualStyleLock);
          return (
            <article key={candidate.id} className="overflow-hidden rounded-md border border-border-soft/25 bg-bg-surface">
              <img src={candidate.imageUrl} alt={`${kindLabel[candidate.kind]}候选`} className="aspect-video w-full object-cover" referrerPolicy="no-referrer" />
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-black text-text-primary">{kindLabel[candidate.kind]}</p>
                  <p className="truncate text-[9px] text-text-muted">{candidate.modelId}</p>
                  {styleSourceStatus === "review_recommended" && (
                    <p className="mt-1 text-[9px] font-bold text-amber-500">来源有更新，建议复核</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onReject(candidate.id)} aria-label="丢弃图片候选" title="丢弃" className="flex h-8 w-8 items-center justify-center rounded-md border border-border-soft/30 text-text-muted hover:text-red-500">
                    <X className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => onAdopt(candidate.id)} aria-label="采用图片候选" title="采用" className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
