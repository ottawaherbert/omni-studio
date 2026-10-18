import { useId, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Route } from "lucide-react";
import { Link } from "react-router-dom";

const stages = [
  { path: "/production/preparation", title: "剧本与场次", task: "编辑剧本和场次，核对角色、场景与道具。", result: "确认本场剧本与资产清单", impact: "修改剧本后，后续资产和分镜需要核对。" },
  { path: "/production/assets", title: "项目资产", task: "编辑资产资料与外观，选择或替换参考图。", result: "采用外观与参考图", impact: "修改外观或画风后，已有图片保留，后续生成使用新设置。" },
  { path: "/production/storyboard", title: "分镜与故事板", task: "修改镜头与提示词，生成并确认故事板。", result: "采用镜头方案与故事板", impact: "修改拍法后，检查受影响的提示词与故事板；可保留原素材对照。" },
  { path: "/production/studio", title: "摄影棚", task: "选择素材，调整声音与时间线，预览并导出。", result: "选定素材并完成成片", impact: "调整后先预览，再导出新版本。需要改拍法时可返回分镜。" },
];

const focusStyle = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary";

export function ProductionWorkflowGuide({ pathname, href }: { pathname: string; href: (path: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const index = stages.findIndex(stage => pathname === stage.path || pathname.startsWith(stage.path + "/"));
  if (index < 0) return null;
  const current = stages[index];
  // Match the page's content gutter, inside (not outside) its max-width container.
  const containerLayout = index === 3 ? "px-3" : `max-w-7xl ${index === 1 ? "px-8" : index === 2 ? "px-3 md:px-8" : "px-4 md:px-8"}`;

  return (
    <section className="shrink-0 overflow-y-auto [scrollbar-gutter:stable] bg-bg-primary py-3" aria-label="制片流程与修改入口">
      <div className={`mx-auto w-full ${containerLayout}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border-soft pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <Route aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="text-xs text-text-secondary">制作流程 · {index + 1} / {stages.length}</span>
                <span className="font-semibold text-text-primary">{current.title}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-secondary">{current.result}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-surface hover:text-text-primary ${focusStyle}`}>
              {expanded ? "收起流程" : "查看流程"}
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {index > 0 && <Link className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary hover:bg-bg-surface hover:text-text-primary ${focusStyle}`} to={href(stages[index - 1].path)} aria-label={`返回${stages[index - 1].title}`}>
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />上一步
            </Link>}
            {index < stages.length - 1 && <Link className={`inline-flex min-h-9 items-center gap-2 rounded-md border border-gold/25 bg-gold/10 px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-gold/20 ${focusStyle}`} to={href(stages[index + 1].path)}>
              前往{stages[index + 1].title}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-gold" />
            </Link>}
          </div>
        </div>
        <div id={panelId} hidden={!expanded} className="max-h-[45vh] overflow-y-auto overscroll-contain pt-3">
          <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="各阶段修改入口">
            {stages.map((stage, i) => (
              <Link key={stage.path} to={href(stage.path)} aria-current={index === i ? "step" : undefined}
                className={`group flex min-w-0 gap-3 rounded-lg border p-3 transition-colors ${focusStyle} ${index === i ? "border-gold/40 bg-gold/5" : "border-border-soft bg-bg-surface hover:border-gold/30 hover:bg-bg-surface-hover"}`}>
                <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${index === i ? "bg-gold text-bg-primary" : "bg-bg-surface-soft text-text-secondary"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-text-primary">{stage.title}</span>
                    {index === i ? <span className="text-xs font-medium text-gold">当前</span> : <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-text-secondary group-hover:text-gold" />}
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-text-secondary">{stage.task}</p>
                </div>
              </Link>
            ))}
          </nav>
          <div className="mt-3 space-y-1 text-xs leading-5 text-text-secondary">
            <p><span className="font-medium text-text-primary">修改后：</span>{current.impact}</p>
            <p>各阶段均可返回编辑；AI 候选经采用后生效，已有素材保留。导演与通用 Skill 可选，不选也能正常制作。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
