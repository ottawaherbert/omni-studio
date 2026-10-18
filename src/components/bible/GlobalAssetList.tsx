import { useState } from "react";
import { useGlobalStore } from "../../clients/stateClient";
import { Plus, Trash2, Image as ImageIcon, Music } from "lucide-react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function GlobalAssetList({ onAssetSelect }: { onAssetSelect: (id: string) => void }) {
  const { globalAssets, addGlobalAsset, deleteGlobalAsset } = useGlobalStore();
  const [filterType, setFilterType] = useState<"all" | "character" | "location" | "prop" | "bgm">("all");

  const filteredAssets = globalAssets.filter(a => filterType === "all" || a.type === filterType);

  const handleAdd = () => {
    const id = `global_${Date.now()}`;
    addGlobalAsset({
      id,
      type: filterType === "all" ? "character" : filterType,
      name: "新全局资产",
      description: "",
      imageUrls: []
    });
    onAssetSelect(id);
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-between items-center mb-8 shrink-0">
        <div className="flex gap-2">
          {["all", "character", "location", "prop", "bgm"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-300 cursor-pointer ${
                filterType === t 
                  ? "bg-bg-surface border border-border-soft/20 text-text-primary shadow-sm" 
                  : "bg-bg-surface-soft border border-border-soft/10 text-text-muted hover:text-text-primary"
              }`}
            >
              {t === "all" ? "全部" : t === "character" ? "角色" : t === "location" ? "场景" : t === "prop" ? "道具" : "背景音乐"}
            </button>
          ))}
        </div>
        <Button
          onClick={handleAdd}
          leftIcon={<Plus className="w-4 h-4" />}
          className="rounded-xl px-5 py-2.5 font-bold uppercase tracking-widest btn-primary cursor-pointer text-xs"
        >
          添加全局资产
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
        {filteredAssets.map((asset) => (
          <Card 
            key={asset.id} 
            onClick={() => onAssetSelect(asset.id)}
            className="group relative flex flex-col bg-bg-surface border border-border-soft/15 rounded-2xl overflow-hidden transition-all hover:bg-bg-surface-soft/80 cursor-pointer h-[320px] text-text-primary shadow-sm"
          >
            {/* Image Preview */}
            <div className="aspect-[16/10] bg-bg-surface-soft relative overflow-hidden border-b border-border-soft/10">
              {asset.type === 'bgm' ? (
                <div className="w-full h-full flex items-center justify-center bg-bg-surface-soft">
                  <Music className="w-10 h-10 text-text-muted" />
                </div>
              ) : asset.imageUrls[0] ? (
                <img 
                  src={asset.imageUrls[0] || undefined} 
                  alt={asset.name} 
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-10 h-10 text-text-muted opacity-60" />
                </div>
              )}
              
              {/* Type Badge */}
              <div className="absolute top-3 left-3 px-2 py-1 bg-bg-surface/90 backdrop-blur-md rounded-lg border border-border-soft/15 shadow-sm">
                <span className="text-[9px] font-bold text-text-primary uppercase tracking-widest">
                  {asset.type === "character" ? "角色" : asset.type === "location" ? "场景" : asset.type === "prop" ? "道具" : "背景音乐"}
                </span>
              </div>

              {/* Delete Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteGlobalAsset(asset.id);
                }}
                className="absolute top-3 right-3 p-2 bg-bg-surface/90 backdrop-blur-md text-text-muted hover:text-red-500 rounded-lg border border-border-soft/15 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-105 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col flex-1">
              <h3 className="text-md font-bold text-text-primary tracking-tight mb-1 transition-colors uppercase line-clamp-1">
                {asset.name}
              </h3>
              <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                {asset.description || "暂无描述..."}
              </p>
              
              <div className="mt-auto pt-4 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {/* Placeholder for variants or other info */}
                  <div className="w-6 h-6 rounded-full border border-bg-surface bg-bg-surface-soft flex items-center justify-center">
                    <Plus className="w-3 h-3 text-text-muted" />
                  </div>
                </div>
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                  查看详情 →
                </span>
              </div>
            </div>
          </Card>
        ))}
        {filteredAssets.length === 0 && (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-text-muted">
            <div className="w-16 h-16 rounded-2xl bg-bg-surface-soft flex items-center justify-center mb-4">
              <Plus className="w-6 h-6 opacity-20" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest">暂无全局资产</p>
            <button onClick={handleAdd} className="mt-3 text-text-secondary font-bold text-xs uppercase tracking-widest hover:underline cursor-pointer">
              立即添加
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
