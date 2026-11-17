import { StudioLibrary } from '../spatial/StudioLibrary';
import { FolderOpen,Mic,Users,Map } from "lucide-react";
import { AnimatePresence,motion } from "motion/react";
import { useState } from "react";
import { GlobalAssetList } from "./GlobalAssetList";
import { GlobalVoiceLibrary } from "./GlobalVoiceLibrary";
import { ProjectAssetView } from "./ProjectAssetView";
import { ProjectList } from "./ProjectList";

import { useNavigate } from "react-router-dom";
import { useProjectStore } from "../../clients/stateClient";
import { GlobalAssetDetailView } from "./GlobalAssetDetailView";

export function GlobalLobby() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"assets" | "voices" | "projects" | "project-assets" | "studios">("assets");
  const [buildProjectPicker,setBuildProjectPicker]=useState(false);
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; type: 'global' | 'project'; assetType: 'character' | 'asset' } | null>(null);

  const menuItems = [
    { id: "assets", icon: Users, label: "全局资产" },
    { id: "studios", icon: Map, label: "3D影视城" },
    { id: "voices", icon: Mic, label: "音色库" },
    { id: "projects", icon: FolderOpen, label: "项目列表" },
  ];

  const handleAssetSelect = (id: string, type: 'global' | 'project', assetType: 'character' | 'asset') => {
    if (type === 'project') {
      const project = useProjectStore.getState().currentProject;
      if (project) navigate(`/production/assets/${assetType}/${encodeURIComponent(id)}?${new URLSearchParams({ projectId: project.id, returnTo: '/assets' })}`);
      return;
    }
    setSelectedAsset({ id, type, assetType });
  };

  const handleBackToList = () => {
    setSelectedAsset(null);
  };

  return (
    <div className="flex flex-col bg-bg-primary text-text-primary">
      {/* Top Navigation Bar */}
      <header className="shrink-0 bg-bg-primary border-b border-border-soft/10 py-4 z-20">
        <div className="max-w-7xl mx-auto px-8 w-full flex items-center min-h-[40px]">
          <nav className="flex h-10 items-center justify-start gap-1 rounded-xl bg-bg-surface-soft/60 border border-border-soft/20 p-1 select-none w-max">
            {menuItems.map((item) => {
              const isActive = activeTab === item.id || (item.id === "projects" && activeTab === "project-assets");
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    setSelectedAsset(null);
                  }}
                  className={`group relative flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isActive 
                      ? "bg-bg-surface text-text-primary shadow-sm border border-border-soft/10" 
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <item.icon className={`w-3.5 h-3.5 shrink-0`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`${activeTab === "studios" ? "" : "max-w-7xl"} mx-auto w-full px-8 pb-8 pt-4 flex flex-col`}>
        <div className="w-full text-text-primary">
          <div className="w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab + (selectedAsset ? '-detail' : '-list')}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="w-full"
              >
                {selectedAsset ? (
                  <GlobalAssetDetailView
                    assetId={selectedAsset.id} 
                    onBack={handleBackToList} 
                  />
                ) : (
                  <>
                    {activeTab === "assets" && <GlobalAssetList onAssetSelect={(id) => handleAssetSelect(id, 'global', 'asset')} />}
                    {activeTab === "studios" && (buildProjectPicker ? <section><div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-semibold">为哪部剧构建影视城</h2><p className="mt-2 text-xs text-text-muted">选择已有项目，AI 将读取该剧剧本、资产和现有世界。</p></div><button className="text-xs text-gold" onClick={()=>setBuildProjectPicker(false)}>返回影视城库</button></div><ProjectList onProjectSelect={id=>navigate(`/production/world?${new URLSearchParams({projectId:id,build:"1"})}`)}/></section> : <StudioLibrary onBuild={()=>setBuildProjectPicker(true)} />)}
                    {activeTab === "voices" && <GlobalVoiceLibrary />}
                    {activeTab === "projects" && <ProjectList onProjectSelect={() => setActiveTab("project-assets")} />}
                    {activeTab === "project-assets" && (
                      <ProjectAssetView 
                        onBack={() => setActiveTab("projects")} 
                        onAssetSelect={(id, assetType) => handleAssetSelect(id, 'project', assetType)}
                      />
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
