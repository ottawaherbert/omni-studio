import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check, Loader2, RefreshCw, X } from "lucide-react";

import {
  getOperatorAssets,
  reviewStoryboardMediaCandidate,
  type OperatorRegisteredAsset,
} from "../../clients/operatorClient";

const isVisibleStoryboardMedia = (
  asset: OperatorRegisteredAsset,
  sceneId: string,
) => asset.kind === "image"
  && asset.metadata?.phase === "storyboards"
  && ["awaiting_review", "adopted"].includes(String(asset.metadata?.adoptionStatus || ""))
  && asset.targetEntity?.sceneId === sceneId;

export function StoryboardMediaCandidateReview({
  projectId,
  sceneId,
}: {
  projectId: string;
  sceneId: string;
}) {
  const [mediaAssets, setMediaAssets] = useState<OperatorRegisteredAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const assets = await getOperatorAssets<OperatorRegisteredAsset[]>(projectId, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      const seenAdoptedSourceIds = new Set<string>();
      setMediaAssets(assets
        .filter((asset) => isVisibleStoryboardMedia(asset, sceneId))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .filter((asset) => {
          if (asset.metadata?.adoptionStatus !== "adopted") return true;
          const sourceId = String(asset.metadata?.sourceId || asset.id);
          if (seenAdoptedSourceIds.has(sourceId)) return false;
          seenAdoptedSourceIds.add(sourceId);
          return true;
        }));
    } catch (error) {
      if (!signal?.aborted) toast.error(error instanceof Error ? error.message : "故事板候选读取失败");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [projectId, sceneId]);

  useEffect(() => {
    const controller = new AbortController();
    setMediaAssets([]);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const review = async (asset: OperatorRegisteredAsset, decision: "adopt" | "discard") => {
    if (reviewingId) return;
    setReviewingId(asset.id);
    try {
      await reviewStoryboardMediaCandidate(projectId, asset.id, decision);
      await refresh();
      toast.success(decision === "adopt" ? "故事板候选已采用" : "故事板候选已放弃");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "故事板候选处理失败");
    } finally {
      setReviewingId(null);
    }
  };

  const pendingCount = mediaAssets.filter((asset) => asset.metadata?.adoptionStatus === "awaiting_review").length;
  const adoptedCount = mediaAssets.filter((asset) => asset.metadata?.adoptionStatus === "adopted").length;

  if (!isLoading && mediaAssets.length === 0) return null;

  return (
    <section className="mb-5 border-y border-border-soft/30 bg-bg-surface px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-black text-text-primary">批量故事板媒体</h2>
          <p className="mt-1 text-[10px] font-semibold text-text-muted">
            <span className={pendingCount ? "text-accent-amber" : undefined}>{pendingCount} 项待复核</span>
            {adoptedCount > 0 ? ` · ${adoptedCount} 项已采用` : ""}
          </p>
        </div>
        <button
          type="button"
          title="刷新候选"
          aria-label="刷新故事板候选"
          disabled={isLoading}
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center text-text-muted hover:bg-bg-surface-soft hover:text-text-primary disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
      {mediaAssets.length > 0 && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {mediaAssets.map((candidate) => {
            const isPending = candidate.metadata?.adoptionStatus === "awaiting_review";
            return (
              <article key={candidate.id} className="grid min-h-32 grid-cols-[160px_minmax(0,1fr)] overflow-hidden border border-border-soft/30 bg-bg-primary">
                <div className="flex min-h-32 items-center justify-center bg-black/30">
                  {candidate.mediaUrl
                    ? <img src={candidate.mediaUrl} alt="故事板候选" className="h-full w-full object-contain" referrerPolicy="no-referrer" />
                    : <span className="text-[10px] text-text-muted">媒体不可用</span>}
                </div>
                <div className="flex min-w-0 flex-col p-3">
                  <p className="truncate text-xs font-black text-text-primary">{String(candidate.metadata?.sourceId || "故事板")}</p>
                  <p className="mt-1 text-[10px] text-text-muted">{isPending ? "技术检查通过 · 视觉待确认" : "已采用为当前故事板媒体"}</p>
                  {isPending && candidate.metadata?.sourceReviewRecommended === true && (
                    <p className="mt-2 text-[10px] font-bold leading-4 text-accent-amber">来源有更新，建议复核；仍可明确采用</p>
                  )}
                  {isPending ? (
                    <div className="mt-auto flex justify-end gap-2 pt-3">
                      <button
                        type="button"
                        title="放弃候选"
                        disabled={Boolean(reviewingId)}
                        onClick={() => void review(candidate, "discard")}
                        className="inline-flex h-8 items-center gap-1.5 px-2 text-[10px] font-bold text-text-muted hover:bg-bg-surface-soft hover:text-text-primary disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" />放弃
                      </button>
                      <button
                        type="button"
                        title="采用候选"
                        disabled={Boolean(reviewingId)}
                        onClick={() => void review(candidate, "adopt")}
                        className="inline-flex h-8 items-center gap-1.5 bg-gold px-2.5 text-[10px] font-black text-black hover:bg-gold/90 disabled:opacity-40"
                      >
                        {reviewingId === candidate.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        采用
                      </button>
                    </div>
                  ) : (
                    <div className="mt-auto flex items-center justify-end gap-1.5 pt-3 text-[10px] font-black text-gold">
                      <Check className="h-3.5 w-3.5" />已采用
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
