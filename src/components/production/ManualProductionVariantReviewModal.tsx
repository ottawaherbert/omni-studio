import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { ManualProductionVariantCandidate } from "../../hooks/useManualProductionAssetVariants";

export function ManualProductionVariantReviewModal({
  candidate,
  onClose,
  onAdopt,
}: {
  candidate: ManualProductionVariantCandidate | null;
  onClose: () => void;
  onAdopt: () => void;
}) {
  if (!candidate || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-neutral-900">
          <div><h2 className="text-sm font-black text-gray-900 dark:text-white">状态变体预览</h2><p className="mt-1 text-xs text-gray-500">{candidate.state.assetName} / {candidate.state.stateSummary}</p></div>
          <button type="button" onClick={onClose} title="关闭" className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-neutral-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <ReviewField label="状态名称" value={candidate.draft.name} />
          <ReviewField label="可见差异与连续性" value={candidate.draft.description} />
          <ReviewField label="生成提示增量" value={candidate.draft.promptModifiers || "无"} />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-neutral-900">
          <button type="button" onClick={onClose} className="h-9 rounded border border-gray-200 px-4 text-xs font-black text-gray-500 dark:border-neutral-800">放弃</button>
          <button type="button" onClick={onAdopt} className="inline-flex h-9 items-center gap-2 rounded bg-gray-900 px-4 text-xs font-black text-white dark:bg-neutral-100 dark:text-neutral-900"><Check className="h-4 w-4" />采用并绑定</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p><p className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm leading-relaxed text-gray-700 dark:bg-neutral-900 dark:text-neutral-200">{value}</p></div>;
}
