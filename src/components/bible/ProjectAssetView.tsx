import { useState } from "react";
import { useProjectStore } from "../../clients/stateClient";
import { ArrowLeft, Image as ImageIcon, Music, Plus } from "lucide-react";
import { Asset, Character } from "../../clients/domainTypes";
import { Card } from "../ui/Card";

export function ProjectAssetView({ onBack, onAssetSelect }: { onBack: () => void, onAssetSelect: (id: string, assetType: 'character' | 'asset') => void }) {
  const { currentProject } = useProjectStore();
  const [filterType, setFilterType] = useState<"all" | "character" | "location" | "prop" | "bgm">("all");

  if (!currentProject) return null;

  const characters = currentProject.characters.map(c => ({
    id: c.id,
    type: "character" as const,
    name: c.name,
    description: c.internalDesire || c.externalGoal || '暂无描述',
    imageUrl: c.referenceImageUrl,
    original: c
  }));

  const otherAssets = (currentProject.assets || [])
    .filter(a => a.type !== 'character')
    .map(a => ({
      id: a.id,
      type: a.type,
      name: a.name,
      description: a.description,
      imageUrl: a.imageUrl,
      original: a
    }));

  const allAssets = [...characters, ...otherAssets];
  const filteredAssets = allAssets.filter(a => filterType === "all" || a.type === filterType);

  return (
    <div className="flex flex-col">
      <div className="flex justify-between items-center mb-10 shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={onBack}
            className="p-2 hover:bg-bg-surface-soft rounded-xl text-text-muted hover:text-text-primary transition-all cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-text-primary tracking-tight">
              {currentProject.title || "未命名项目"}
            </h2>
            <p className="text-[9px] font-bold text-text-muted uppercase tracking-[0.15em] mt-1">项目资产库 (Project Assets)</p>
          </div>
        </div>
        <div className="flex gap-1.5 bg-bg-surface-soft/60 p-1 rounded-xl border border-border-soft/10">
          {["all", "character", "location", "prop", "bgm"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${
                filterType === t 
                  ? "bg-bg-surface border border-border-soft/10 text-text-primary shadow-sm" 
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t === "all" ? "全部" : t === "character" ? "角色" : t === "location" ? "场景" : t === "prop" ? "道具" : "背景音乐"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
        {filteredAssets.map((asset) => (
          <Card 
            key={asset.id} 
            onClick={() => onAssetSelect(asset.id, asset.type === 'character' ? 'character' : 'asset')}
            className="group relative flex flex-col bg-bg-surface border border-border-soft/15 rounded-2xl overflow-hidden transition-all hover:bg-bg-surface-soft/80 cursor-pointer h-[320px] shadow-sm"
          >
            {/* Image Preview */}
            <div className="aspect-[16/10] bg-bg-surface-soft relative overflow-hidden border-b border-border-soft/10">
              {asset.type === 'bgm' ? (
                <div className="w-full h-full flex items-center justify-center bg-bg-surface-soft">
                  <Music className="w-8 h-8 text-text-muted opacity-40" />
                </div>
              ) : asset.imageUrl ? (
                <img 
                  src={asset.imageUrl || undefined} 
                  alt={asset.name} 
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-text-muted opacity-40" />
                </div>
              )}
              
              {/* Type Badge */}
              <div className="absolute top-3 left-3 px-2 py-1 bg-bg-surface-soft/90 backdrop-blur-md rounded-lg border border-border-soft/15 shadow-sm">
                <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
                  {asset.type === "character" ? "角色" : asset.type === "location" ? "场景" : asset.type === "prop" ? "道具" : "背景音乐"}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col flex-1">
              <h3 className="text-sm font-bold text-text-primary tracking-tight mb-1 line-clamp-1">
                {asset.name}
              </h3>
              <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                {asset.description || "暂无描述..."}
              </p>
              
              <div className="mt-auto pt-3 flex items-center justify-between">
                <span className="text-[10px] text-text-muted">
                  查看详情
                </span>
                <span className="text-[10px] text-text-muted group-hover:text-text-primary transition-colors">
                  →
                </span>
              </div>
            </div>
          </Card>
        ))}
        {filteredAssets.length === 0 && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-text-muted">
            <div className="w-16 h-16 rounded-2xl bg-bg-surface border border-border-soft/10 flex items-center justify-center mb-4 shadow-sm">
              <Plus className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest">该项目暂无此类资产</p>
          </div>
        )}
      </div>
    </div>
  );
}
