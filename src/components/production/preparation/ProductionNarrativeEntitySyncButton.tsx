import { useState } from "react";
import { MapPin, Package, RefreshCw, UserRound } from "lucide-react";
import toast from "react-hot-toast";

import { scriptClient } from "../../../../apps/web/src/clients/scriptClient";
import type { Project } from "../../../clients/domainTypes";
import {
  applyProductionNarrativeEntityMergeCandidate,
  buildProductionNarrativeEntityMergeCandidate,
  type ProductionNarrativeEntityKind,
  type ProductionNarrativeEntityMergeCandidate,
} from "../../../clients/productionPreparationWorkflowClient";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";

const kindLabel: Record<ProductionNarrativeEntityKind, string> = {
  character: "人物",
  location: "地点",
  prop: "道具",
};

const kindIcon = {
  character: UserRound,
  location: MapPin,
  prop: Package,
};

export function ProductionNarrativeEntitySyncButton({
  project,
  updateProject,
}: {
  project: Project;
  updateProject: (updates: Partial<Project>) => Promise<void>;
}) {
  const source = project.productionSourceSnapshot;
  const [candidate, setCandidate] = useState<ProductionNarrativeEntityMergeCandidate | null>(null);
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  if (source?.sourceType !== "writing_export") return null;

  const checkForUpdates = async () => {
    setIsChecking(true);
    try {
      const result = await scriptClient.exportPackage(source.sourceWritingProjectId);
      const next = buildProductionNarrativeEntityMergeCandidate({
        project,
        sourcePackage: result.package,
      });
      if (!next.changes.length && !next.removedSources.length) {
        toast.success(next.unmappedSources.length
          ? `明确的人物、地点和道具已同步；${next.unmappedSources.length} 项世界设定保持在剧本中`
          : "剧本人物、地点和道具已同步");
        return;
      }
      setCandidate(next);
      setSelectedChangeIds(next.changes.map((item) => item.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "检查剧本设定更新失败");
    } finally {
      setIsChecking(false);
    }
  };

  const applySelected = async () => {
    if (!candidate || (selectedChangeIds.length === 0 && candidate.removedSources.length === 0)) return;
    setIsApplying(true);
    try {
      const patch = applyProductionNarrativeEntityMergeCandidate({
        project,
        candidate,
        selectedChangeIds,
      });
      await updateProject(patch);
      setCandidate(null);
      toast.success(selectedChangeIds.length
        ? `已采用 ${selectedChangeIds.length} 项剧本设定更新`
        : "已保留制片资产，不跟随剧本删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "采用剧本设定更新失败");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void checkForUpdates()}
        disabled={isChecking}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-bg-surface-soft px-3 text-xs font-bold text-text-primary transition hover:bg-bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 text-gold ${isChecking ? "animate-spin" : ""}`} />
        <span>{isChecking ? "检查中..." : "检查剧本设定更新"}</span>
      </button>
      <Modal
        isOpen={Boolean(candidate)}
        onClose={() => !isApplying && setCandidate(null)}
        title="剧本设定更新"
        size="lg"
      >
        {candidate && (
          <div className="space-y-5">
            <div className="rounded-lg border border-border-soft/30 bg-bg-surface-soft p-4">
              <p className="text-sm font-bold text-text-primary">
                这些变化还没有改动制片资产
              </p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                确认后只更新人物、地点和道具的故事事实。参考图、造型、声音、分镜和已生成媒体不会被覆盖。
              </p>
            </div>

            {candidate.changes.length > 0 && (
              <div className="space-y-2">
                {candidate.changes.map((change) => {
                  const Icon = kindIcon[change.kind];
                  const selected = selectedChangeIds.includes(change.id);
                  return (
                    <label
                      key={change.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-soft/30 p-4 transition hover:border-gold/40"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setSelectedChangeIds((current) => selected
                          ? current.filter((id) => id !== change.id)
                          : [...current, change.id])}
                        className="mt-1 h-4 w-4 accent-gold"
                      />
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-text-primary">{change.name}</span>
                          <span className="text-[10px] font-bold text-text-muted">
                            {change.action === "create" ? `新增${kindLabel[change.kind]}` : `更新${kindLabel[change.kind]}`}
                          </span>
                        </span>
                        <span className="mt-2 block space-y-1">
                          {change.fieldChanges.map((field) => (
                            <span key={field.field} className="block text-xs leading-5 text-text-muted">
                              <strong className="text-text-secondary">{field.label}：</strong>
                              {field.before ? `${field.before} → ` : ""}
                              <span className="text-text-primary">{field.after}</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {candidate.removedSources.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  剧本中已移除 {candidate.removedSources.length} 项设定
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {candidate.removedSources.map((item) => item.name).join("、")}。系统不会自动删除制片资产，请在确认不再使用后手动处理。
                </p>
              </div>
            )}

            {candidate.unmappedSources.length > 0 && (
              <div className="rounded-lg border border-border-soft/30 bg-bg-surface-soft p-4">
                <p className="text-xs font-bold text-text-secondary">
                  {candidate.unmappedSources.length} 项世界设定暂不进入制片资产
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {candidate.unmappedSources.map((item) => item.name).join("、")} 尚未明确为地点或道具。系统不会猜测，避免把组织、规则或抽象概念错误建成道具。
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border-soft/20 pt-4">
              <Button variant="ghost" size="sm" onClick={() => setCandidate(null)} disabled={isApplying}>
                暂不采用
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void applySelected()}
                disabled={(selectedChangeIds.length === 0 && candidate.removedSources.length === 0) || isApplying}
              >
                {isApplying
                  ? "采用中..."
                  : selectedChangeIds.length
                    ? `采用所选更新 (${selectedChangeIds.length})`
                    : "知道了，保留制片资产"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
