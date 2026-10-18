import { ImageIcon, Library, Wand2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import type {
  ManualProductionAssetReadModel,
  ManualProductionSceneState,
} from "../../clients/productionAssetWorkflowClient";

export function ManualProductionSceneStateView({
  readModel,
  onCreateVariant,
  onOpenAsset,
  showReferencePack = true,
}: {
  readModel: ManualProductionAssetReadModel;
  onCreateVariant?: (state: ManualProductionSceneState) => void;
  onOpenAsset?: (assetId: string) => void;
  showReferencePack?: boolean;
}) {
  return (
    <div className={showReferencePack ? "grid gap-5 p-5 lg:grid-cols-[1fr_1fr]" : "p-5"}>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-black text-gray-900 dark:text-white">当前场次视觉状态</h3>
          <Badge variant="outline" size="sm">
            {readModel.reusedSceneIds.length
              ? `复用 ${readModel.reusedSceneIds.length + 1} 场`
              : showReferencePack
                ? readModel.sceneVisualPack?.visualFingerprint || "无视觉包"
                : `${readModel.sceneStates.length} 项状态`}
          </Badge>
        </div>
        <div className={showReferencePack ? "space-y-2" : "grid gap-3 lg:grid-cols-2"}>
          {readModel.sceneStates.map((state) => (
            <div key={state.id} className="rounded-md border border-gray-200 p-3 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black text-gray-800 dark:text-neutral-100">{state.assetName}</p>
                <span className="text-[9px] font-bold text-gray-400">{readModel.assetBoards.find((board) => board.assetId === state.assetId && board.variantId === state.variantId)?.variantName || "基础状态"}</span>
              </div>
              <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-gray-500 dark:text-neutral-400">{state.stateSummary || "未声明可见状态"}</p>
              {onCreateVariant && (
                <button
                  type="button"
                  onClick={() => onCreateVariant(state)}
                  title="创建新状态，不覆盖已用状态"
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 px-2 text-[9px] font-black text-violet-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-violet-300"
                >
                  <Wand2 className="h-3 w-3" />建立状态变体
                </button>
              )}
              {onOpenAsset && (
                <button
                  type="button"
                  onClick={() => onOpenAsset(state.assetId)}
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 px-2 text-[9px] font-black text-gray-600 dark:border-neutral-700 dark:text-neutral-300"
                >
                  <Library className="h-3 w-3" />查看项目资产
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {showReferencePack && <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-black text-gray-900 dark:text-white">模型参考资产包</h3>
          <Badge variant="outline" size="sm">{readModel.assetReferencePack?.items.length || 0} ITEMS</Badge>
        </div>
        <div className="space-y-2">
          {(readModel.assetReferencePack?.items || []).map((item) => {
            const board = readModel.assetBoards.find((candidate) => candidate.assetId === item.assetId && candidate.variantId === item.variantId)
              || readModel.assetBoards.find((candidate) => candidate.assetId === item.assetId && !candidate.variantId);
            return (
              <div key={`${item.assetId}-${item.variantId || "base"}`} className="flex items-start gap-3 rounded-md border border-gray-200 p-3 dark:border-neutral-800">
                {item.referenceImageUrl ? <img src={item.referenceImageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-neutral-900"><ImageIcon className="h-4 w-4 text-gray-300" /></div>}
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-800 dark:text-neutral-100">{board?.assetName || item.assetId}</p>
                  <p className="mt-1 line-clamp-2 text-[10px] text-gray-500 dark:text-neutral-400">{item.roleInUnit}</p>
                  <p className="mt-1 text-[9px] font-bold text-gray-400">{item.referenceImageUrl ? "已有参考图" : "缺少参考图"} / {board?.variantName || item.variantId || "基础状态"} / {board?.usageRefs[0]?.title || readModel.sceneId}</p>
                </div>
              </div>
            );
          })}
          {readModel.issues.slice(0, 4).map((issue) => <div key={`${issue.code}-${issue.message}`} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">{issue.message}</div>)}
        </div>
      </div>}
    </div>
  );
}
