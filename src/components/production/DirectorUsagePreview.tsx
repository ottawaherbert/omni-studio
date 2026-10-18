import { useState } from "react";
import { isDirectorProfileV2, renderDirectorDirection, directorProfileText } from "../../clients/creativeDirectionClient";
import type { CreativeStage, ResolvedCreativeRole } from "../../clients/domainTypes";

const stages: Array<[CreativeStage, string]> = [["planning", "分镜规划"], ["asset_character", "角色外观"], ["asset_location", "场景设计"], ["asset_prop", "道具设计"]];
export function DirectorUsagePreview({ role }: { role: ResolvedCreativeRole }) {
  const [stage, setStage] = useState<CreativeStage>("planning");
  const profile = role.skill?.profile?.director;
  const completePrompt = renderDirectorDirection(role, stage);
  const text = isDirectorProfileV2(profile) ? [directorProfileText(profile, stage), ...(stage === "planning" ? role.notes : [])].filter(Boolean).join("\n\n")
    : stage === "planning" ? [role.skill?.content, ...role.notes].filter(Boolean).join("\n\n") : "";
  return <section className="space-y-2 border-t border-border-soft/40 pt-3" aria-label="导演应用预览">
    <h4 className="text-sm font-semibold text-text-primary">各阶段会收到什么</h4>
    {!role.enabled ? <p className="text-xs leading-5 text-text-muted">本范围不使用导演 Skill，仍按剧本、资产和你的制作要求完成分镜与生成。已采用的拍法和素材保留，可继续编辑。</p> : <>
      <p className="text-xs text-text-muted">{role.skill?.title || "自定义要求"} · 来源：{role.source}{!isDirectorProfileV2(role.skill?.profile?.director) ? " · 旧版正文 / 自定义补充，仅用于分镜规划" : " · 已按工作分类"}</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="导演指导阶段">{stages.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={stage === key} onClick={() => setStage(key)} className={"rounded-md px-2.5 py-1.5 text-xs " + (stage === key ? "bg-gold/15 text-gold" : "bg-bg-surface text-text-secondary")}>{label}</button>)}</div>
      <div role="tabpanel" className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">{text || "没有适用于此阶段的导演要求，按当前资产资料和画风正常制作。"}</div>
      {completePrompt && <details className="text-xs text-text-muted"><summary className="cursor-pointer">查看完整任务指令</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{completePrompt}</pre></details>}
      <p className="text-xs leading-5 text-text-muted">分镜图、视频、配音和剪辑执行采用后的镜头决定。可在分镜候选和镜头编辑中修改；这里改变方法不会自动重做已有素材。</p>
    </>}
  </section>;
}
