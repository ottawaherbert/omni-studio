import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { useState, useEffect } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useProjectStore, useGlobalStore, flushDebouncedProjectSave } from '../clients/stateClient';
import { GenerationWorkbench } from '../components/generation/GenerationWorkbench';
import { GLOBAL_GENERATION_SCOPE } from '../../packages/domain/src/generation';
import { assetClient } from '../clients/assetClient';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';
import type { Asset, Character } from '../clients/domainTypes';

export default function ImageGen() {
  const [searchParams] = useSearchParams();
  const scratchId = searchParams.get("scratchId") || undefined;
  const projectId = scratchId ? searchParams.get("projectId") || GLOBAL_GENERATION_SCOPE : GLOBAL_GENERATION_SCOPE;
  const [open, setOpen] = useState(true);
  const [imageToImport, setImageToImport] = useState<string>();
  return <div className="mx-auto max-w-7xl space-y-5 px-8 py-6 text-text-primary">
    <h1 className="text-lg font-semibold">独立生成</h1>
    <p className="text-sm text-text-muted">在统一工作台选择素材与参数，结果和执行记录会保存。检查后可导入全局资产或项目；不会自动覆盖作品。</p>
    <button className="btn-primary rounded-md px-4 py-2 text-sm" onClick={() => setOpen(true)}>打开生成工作台与记录</button>
    <label className="block text-xs text-text-secondary">导入外部模型生成的图片<input className="mt-2 block" type="file" accept="image/*" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const result = await assetClient.uploadFile(file); setImageToImport(result.url); } catch (error) { toast.error(error instanceof Error ? error.message : '上传失败'); } }} /></label>
    {open && <GenerationWorkbench target={{ projectId, kind: 'scratch', scratchId, shotIds: [] }} operation="asset_image" returnLabel="返回独立生成" onClose={() => setOpen(false)} onUseResult={url => { setOpen(false); setImageToImport(url); }} />}
    {imageToImport && <ImportAssetModal imageUrl={imageToImport} onClose={() => setImageToImport(undefined)} />}
  </div>;
}

// Modal Component for saving to assets
function ImportAssetModal({ imageUrl, onClose }: { imageUrl: string, onClose: () => void }) {
  const { projects, currentProject, updateProject, loadProject } = useProjectStore();
  const [saving, setSaving] = useState(false);
  const { globalAssets, addGlobalAsset, updateGlobalAsset } = useGlobalStore();

  const [targetScope, setTargetScope] = useState<"project" | "global">("project");
  const [projectId, setProjectId] = useState<string>(useProjectStore.getState().currentProject?.id || (projects[0]?.id || ""));
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  
  // Existing mode state
  const [existingAssetId, setExistingAssetId] = useState<string>("");

  // New mode state
  const [newAssetType, setNewAssetType] = useState<"character" | "location" | "prop">("character");
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetDesc, setNewAssetDesc] = useState("");
  const [imageUsage, setImageUsage] = useState<"standard" | "panorama" | "multi">("standard");

  const selectedProject = currentProject?.id === projectId ? currentProject : undefined;
  useEffect(() => { if (targetScope === "project" && projectId && currentProject?.id !== projectId) void loadProject(projectId).catch(error => toast.error(error instanceof Error ? error.message : "项目读取失败")); }, [projectId, targetScope, currentProject?.id]);

  const availableAssets = targetScope === "project" && selectedProject
    ? [
        ...(selectedProject.characters || []).map(c => ({ id: c.id, name: c.name, type: "character" })), 
        ...(selectedProject.assets || []).map(a => ({ id: a.id, name: a.name, type: a.type }))
      ]
    : (globalAssets || []).map(g => ({ id: g.id, name: g.name, type: g.type }));

  useEffect(() => {
    if (availableAssets.length > 0 && !availableAssets.some(a => a.id === existingAssetId)) {
      setExistingAssetId(availableAssets[0].id);
    }
  }, [availableAssets, existingAssetId]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
    if (targetMode === "new" && !newAssetName.trim()) {
      toast.error("请输入资产名称");
      return;
    }

    if (targetMode === "existing" && !availableAssets.some(a => a.id === existingAssetId)) throw new Error("请选择仍然存在的资产。");
    const assetType = targetMode === "new" ? newAssetType : availableAssets.find(a => a.id === existingAssetId)?.type;
    if (imageUsage === 'panorama' && assetType !== 'location') throw new Error('全景环境图仅适用于场景资产，请选择基础图或多视图。');
    const mediaPatch = imageUsage === 'multi' ? { multiViewUrl: imageUrl }
      : imageUsage === 'panorama' ? { panoramaUrl: imageUrl } : { url: imageUrl };
    if (targetScope === "project") {
      if (!selectedProject || useProjectStore.getState().currentProject?.id !== projectId) throw new Error("项目正在读取或已切换，请重新选择。");
      if (targetMode === "new") {
        if (newAssetType === "character") {
          const newChar: Character = {
            id: crypto.randomUUID(),
            name: newAssetName,
            internalDesire: "",
            externalGoal: "",
            flaw: "",
            psychologicalProfile: newAssetDesc,
            ...(imageUsage === 'standard' ? { referenceImageUrl: imageUrl } : { multiViewUrl: imageUrl })
          };
          await updateProject({ characters: [...(selectedProject.characters || []), newChar] }, { expectedProjectId: projectId });
        } else {
          const newAss: Asset = {
            id: crypto.randomUUID(),
            name: newAssetName,
            description: newAssetDesc,
            type: newAssetType,
            ...(imageUsage === 'standard' ? { imageUrl: imageUrl } : imageUsage === 'panorama' ? { panoramaUrl: imageUrl } : { multiViewUrl: imageUrl })
          };
          await updateProject({ assets: [...(selectedProject.assets || []), newAss] }, { expectedProjectId: projectId });
        }
      } else {
        // Exisiting
        const charIndex = (selectedProject.characters || []).findIndex(c => c.id === existingAssetId);
        if (charIndex >= 0) {
          const chars = (selectedProject.characters || []).map(c => ({ ...c }));
          if (imageUsage === 'standard') chars[charIndex].referenceImageUrl = imageUrl;
          else if (imageUsage === 'multi') chars[charIndex].multiViewUrl = imageUrl;
          else throw new Error('角色不支持全景用途，请选择基础图或多视图。');
          await updateProject({ characters: chars }, { expectedProjectId: projectId });
        } else {
          const assIndex = (selectedProject.assets || []).findIndex(a => a.id === existingAssetId);
          if (assIndex >= 0) {
            const asm = (selectedProject.assets || []).map(a => ({ ...a }));
            if (imageUsage === 'standard') asm[assIndex].imageUrl = imageUrl;
            else if (imageUsage === 'panorama') asm[assIndex].panoramaUrl = imageUrl;
            else if (imageUsage === 'multi') asm[assIndex].multiViewUrl = imageUrl;
            await updateProject({ assets: asm }, { expectedProjectId: projectId });
          }
        }
      }
    } else {
      // Global
      if (targetMode === "new") {
        addGlobalAsset({
          name: newAssetName,
          description: newAssetDesc,
          type: newAssetType,
          imageUrls: [imageUrl],
          ...mediaPatch
        });
      } else {
        const ga = globalAssets.find(g => g.id === existingAssetId);
        if (ga) {
          updateGlobalAsset(existingAssetId, {
            imageUrls: [...ga.imageUrls, imageUrl],
            ...mediaPatch
          });
        }
      }
    }
    
    if (targetScope === "project") await flushDebouncedProjectSave(projectId);
    toast.success("资产保存成功");
    onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败，图片仍保留"); } finally { setSaving(false); }
  };

  return (
    <Modal 
      isOpen 
      onClose={onClose} 
      title="导入图片到资产库" 
      size="lg"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={saving || (targetScope === "project" && !selectedProject)} onClick={() => void handleSave()} className="bg-gray-900 text-white dark:bg-white dark:text-gray-900 hover:opacity-90">确认保存</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-2">
        <div>
          <div className="aspect-square bg-gray-50 dark:bg-neutral-900 rounded-xl overflow-hidden border border-gray-100 dark:border-neutral-800 shadow-inner">
            <img src={imageUrl} alt="preview" className="w-full h-full object-contain" />
          </div>
          <div className="mt-4 p-4 bg-violet-50/50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-800/50 rounded-xl">
             <p className="text-[11px] text-violet-700 dark:text-violet-300 leading-relaxed">
               <Sparkles className="w-3 h-3 inline-block mr-1 mb-0.5" />
               提示：将生成的创意成果导入资产库，可以确保视觉风格在整个剧本创作中保持连贯性。
             </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">导入作用域范围</label>
            <div className="flex gap-2 p-1 bg-gray-50 dark:bg-neutral-950 rounded-xl border border-gray-100 dark:border-neutral-800">
              {[ { id: "project", label: "具体项目" }, { id: "global", label: "全局资产" }].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTargetScope(t.id as any)}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-center",
                    targetScope === t.id ? "bg-white dark:bg-neutral-900 text-violet-600 shadow-sm ring-1 ring-black/5" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {targetScope === "project" && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">选择项目</label>
              <div className="relative group">
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500/50 appearance-none cursor-pointer"
                >
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title || '未命名项目'}</option>)}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          <div className="pt-2">
            <div className="flex gap-6 border-b border-gray-100 dark:border-neutral-800 mb-6">
              {[ { id: "new", label: "创建新资产" }, { id: "existing", label: "关联已有资产" }].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTargetMode(t.id as any)}
                  className={cn(
                    "pb-3 text-xs font-bold uppercase tracking-widest transition-all relative",
                    targetMode === t.id ? "text-gray-900 dark:text-white" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {t.label}
                  {targetMode === t.id && (
                    <motion.div 
                      layoutId="tab-underline"
                      className="absolute bottom-[-1px] left-0 w-full h-0.5 bg-violet-600" 
                    />
                  )}
                </button>
              ))}
            </div>

            {targetMode === "new" ? (
              <div className="space-y-5 animate-in fade-in duration-300">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">资产类型</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['character', 'location', 'prop'].map(type => (
                      <button
                        key={type}
                        onClick={() => setNewAssetType(type as any)}
                        className={cn(
                          "py-2.5 text-[11px] font-bold rounded-xl border transition-all",
                          newAssetType === type ? "border-violet-600 bg-violet-600 text-white shadow-lg shadow-violet-600/20" : "border-gray-100 dark:border-neutral-800 text-gray-500 hover:border-gray-300 dark:hover:border-neutral-700"
                        )}
                      >
                        {type === 'character' ? '人物' : type === 'location' ? '场景' : '道具'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">资产名称</label>
                  <input
                    type="text"
                    value={newAssetName}
                    onChange={e => setNewAssetName(e.target.value)}
                    placeholder="输入资产识别名..."
                    className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">补充描述 (可选)</label>
                  <input
                    type="text"
                    value={newAssetDesc}
                    onChange={e => setNewAssetDesc(e.target.value)}
                    placeholder="简要备注资产特征..."
                    className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 animate-in fade-in duration-300">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">选择要更新的资产</label>
                <div className="relative group">
                  <select
                    value={existingAssetId}
                    onChange={e => setExistingAssetId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 appearance-none cursor-pointer"
                  >
                    <option value="" disabled>请选择资产...</option>
                    {availableAssets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type === 'character' ? '人物' : a.type === 'location' ? '场景' : '道具'})</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}

            <div className="space-y-3 mt-8">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">图片用途分配</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'standard', label: '参考图 / 头像' },
                  { id: 'panorama', label: '全景环境图' },
                  { id: 'multi', label: '多视图 / 三视图' }
                ].map(usage => {
                  if (usage.id === 'panorama' && (targetMode === 'new' ? newAssetType : availableAssets.find(a => a.id === existingAssetId)?.type) !== 'location') return null;
                  return (
                    <button
                      key={usage.id}
                      onClick={() => setImageUsage(usage.id as any)}
                      className={cn(
                        "px-4 py-2 text-[11px] font-bold rounded-full transition-all border",
                        imageUsage === usage.id 
                          ? "bg-violet-600 border-violet-600 text-white" 
                          : "bg-transparent border-gray-100 dark:border-neutral-800 text-gray-400 hover:border-gray-300 dark:hover:border-neutral-700"
                      )}
                    >
                      {usage.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
