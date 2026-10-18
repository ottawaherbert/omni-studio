import { Palette } from "lucide-react";

import type { VisualStyleLock } from "../../clients/domainTypes";
import { cn } from "../../lib/utils";

interface VisualStyleInheritanceBadgeProps {
  visualStyleLock?: VisualStyleLock;
  fallbackVisualStyle?: string;
  className?: string;
  compact?: boolean;
}

const modeLabels: Record<string, string> = {
  live_action: "真人实拍",
  "2d_animation": "2D 动画",
  "3d_animation": "3D 动画",
  stop_motion: "定格动画",
  mixed_media: "混合媒介",
};

export const resolveVisualStyleInheritancePresentation = ({
  visualStyleLock,
  fallbackVisualStyle,
}: Pick<VisualStyleInheritanceBadgeProps, "visualStyleLock" | "fallbackVisualStyle">) => {
  if (visualStyleLock?.humanApprovalState === "rejected") return {
    mode: "未继承",
    styleSummary: "该规范已拒绝，不会进入图片或视频生成",
    status: "已拒绝 / 需重设",
    tone: "rejected" as const,
  };

  const productionMode = visualStyleLock?.visualImplementation?.productionMode;
  const mode = productionMode
    ? modeLabels[productionMode] || productionMode
    : "实现方式待设置";
  const styleSummary = [
    ...(visualStyleLock?.visualImplementation?.appearance?.descriptors || []),
    ...(visualStyleLock?.treatment?.directives || []),
  ].filter(Boolean).slice(0, 2).join("；") || fallbackVisualStyle?.trim() || "视觉方向待补充";
  const isApproved = visualStyleLock?.humanApprovalState === "approved";
  const reviewRecommended = visualStyleLock?.sourceReview?.status === "review_recommended";
  return {
    mode,
    styleSummary,
    status: visualStyleLock
      ? reviewRecommended ? "建议复核" : isApproved ? "已应用" : "草稿"
      : "待设置",
    tone: isApproved && !reviewRecommended ? "approved" as const : "attention" as const,
  };
};

export function VisualStyleInheritanceBadge({
  visualStyleLock,
  fallbackVisualStyle,
  className,
  compact = false,
}: VisualStyleInheritanceBadgeProps) {
  const { mode, styleSummary, status, tone } = resolveVisualStyleInheritancePresentation({
    visualStyleLock,
    fallbackVisualStyle,
  });

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-md border border-border-soft/30 bg-bg-surface-soft/45 text-left",
        compact ? "max-w-md px-2.5 py-1.5" : "max-w-xl px-3 py-2",
        className,
      )}
      title={`项目视觉规范：${mode}；${styleSummary}`}
    >
      <Palette className="h-3.5 w-3.5 shrink-0 text-gold" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-text-secondary">
          <span className="shrink-0">项目视觉规范</span>
          <span className="text-text-dark">·</span>
          <span className="truncate">{mode}</span>
          <span className={cn(
            "shrink-0",
            tone === "approved" ? "text-emerald-500" : tone === "rejected" ? "text-red-500" : "text-amber-500",
          )}>{status}</span>
        </span>
        {!compact && <span className="mt-0.5 block truncate text-[10px] text-text-muted">{styleSummary}</span>}
      </span>
    </div>
  );
}
