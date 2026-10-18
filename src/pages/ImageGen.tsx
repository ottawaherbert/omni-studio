import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Image as ImageIcon, Upload, Loader2, Sparkles, X, Plus, Save, ChevronDown, Wand2, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { generateAIImage } from '../clients/aiClient';
import { useProjectStore } from '../clients/stateClient';
import { useGlobalStore } from '../clients/stateClient';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';
import { Asset, Character } from '../clients/domainTypes';
import {
  createImageGenerationReference,
  type ImageReferenceRole,
} from '../clients/productionVisualImageClient';

const referenceRoleOptions: Array<{ value: ImageReferenceRole; label: string }> = [
  { value: "character_identity", label: "角色身份" },
  { value: "wardrobe_state", label: "服装状态" },
  { value: "location_design", label: "场景设计" },
  { value: "prop_design", label: "道具设计" },
  { value: "composition_anchor", label: "构图锚点" },
  { value: "continuity_frame", label: "连续性画面" },
  { value: "style_reference", label: "视觉风格" },
];

// Helper component for auto-resizing
const AutoResizingTextarea = ({ value, onChange, placeholder, className, minHeight = "120px" }: { value: string, onChange: (val: string) => void, placeholder: string, className?: string, minHeight?: string }) => {
  return (
    <div className="grid relative" style={{ minHeight }}>
      <div 
        className={cn(className, "col-start-1 col-end-2 row-start-1 row-end-2 invisible whitespace-pre-wrap break-words pointer-events-none p-0")}
        aria-hidden="true"
      >
        {value + " "}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(className, "col-start-1 col-end-2 row-start-1 row-end-2 w-full h-full resize-none overflow-hidden bg-transparent outline-none p-0 custom-scrollbar")}
      />
    </div>
  );
};

export default function ImageGen() {
  const { currentProject, updateProject, projects } = useProjectStore();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "3:4" | "4:3" | "9:16" | "16:9">("16:9");
  const [referenceImages, setReferenceImages] = useState<Array<{
    id: string;
    imageUrl: string;
    label: string;
    role: ImageReferenceRole | "";
  }>>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; prompt: string; ratio: string; id: string }[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [imageToImport, setImageToImport] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        if (base64) {
          const label = file.name.replace(/\.[^.]+$/, "").trim();
          setReferenceImages(prev => [...prev, {
            id: crypto.randomUUID(),
            imageUrl: base64,
            label,
            role: "",
          }]);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const updateReferenceRole = (id: string, role: ImageReferenceRole) => {
    setReferenceImages((previous) => previous.map((reference) => reference.id === id ? { ...reference, role } : reference));
  };

  const updateReferenceLabel = (id: string, label: string) => {
    setReferenceImages((previous) => previous.map((reference) => reference.id === id ? { ...reference, label } : reference));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("请输入提示词");
      return;
    }
    const incompleteReferenceIndex = referenceImages.findIndex((reference) => !reference.label.trim() || !reference.role);
    if (incompleteReferenceIndex >= 0) {
      toast.error(`请为参考图 ${incompleteReferenceIndex + 1} 填写名称并选择职责。`);
      return;
    }
    setIsGenerating(true);
    try {
      const url = await generateAIImage({
        promptCore: prompt,
        aspectRatio,
        references: referenceImages.length > 0 ? referenceImages.map((reference) => createImageGenerationReference({
          imageUrl: reference.imageUrl,
          label: reference.label.trim(),
          role: reference.role as ImageReferenceRole,
        })) : undefined
      });
      const newImg = { url, prompt, ratio: aspectRatio, id: crypto.randomUUID() };
      setGeneratedImages(prev => [newImg, ...prev]);
      setActiveImageId(newImg.id);
      
      toast.success("生成成功");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const activeImage = generatedImages.find(img => img.id === activeImageId);

  return (
    <div className="mx-auto w-full max-w-7xl flex px-8 pb-8 pt-4 flex-col md:flex-row gap-6 relative bg-bg-primary">
      {/* Left Panel: Controls (Split into modular card blocks) */}
      <aside className="w-96 shrink-0 flex flex-col gap-4 z-10">
        {/* Title Header (Borderless) */}
        <div className="py-2 shrink-0">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-text-muted" />
            图片生成
          </h2>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1 font-bold">Image Generation</p>
        </div>

        {/* Card 1: Core Parameters (Prompt + Aspect Ratio) */}
        <div className="p-6 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm space-y-6 shrink-0">
          {/* Prompt */}
          <div className="space-y-3">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
              核心提示词 <span className="text-red-500">*</span>
            </label>
            <div className="relative bg-bg-surface-soft border border-border-soft/10 rounded-xl p-4 transition-colors focus-within:border-border-soft/40">
              <AutoResizingTextarea
                value={prompt}
                onChange={setPrompt}
                placeholder="描述你想要的画面，例如：赛博朋克风格的霓虹街道标题，高定画质..."
                className="text-sm text-text-secondary"
                minHeight="140px"
              />
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-3">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-widest">
              画幅比例
            </label>
            <div className="grid grid-cols-5 gap-2">
              {[
                { id: "16:9", icon: <div className="w-6 h-3 border border-current" />, label: "横屏" },
                { id: "9:16", icon: <div className="w-3 h-6 border border-current" />, label: "竖屏" },
                { id: "1:1", icon: <div className="w-4 h-4 border border-current" />, label: "正方" },
                { id: "4:3", icon: <div className="w-5 h-4 border border-current" />, label: "标准" },
                { id: "3:4", icon: <div className="w-4 h-5 border border-current" />, label: "肖像" },
              ].map((ratio) => (
                <button
                  key={ratio.id}
                  onClick={() => setAspectRatio(ratio.id as any)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all cursor-pointer",
                    aspectRatio === ratio.id
                      ? "bg-bg-surface-soft border-border-soft/30 text-text-primary font-bold shadow-sm"
                      : "bg-bg-surface border-border-soft/10 text-text-muted hover:text-text-primary"
                  )}
                >
                  <div className="opacity-80 scale-90">{ratio.icon}</div>
                  <span className="text-[10px] font-bold">{ratio.id}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Reference Images */}
        <div className="p-6 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-widest">
              参考图 (垫图)
            </label>
            <span className="text-[10px] text-text-muted font-mono">{referenceImages.length}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {referenceImages.map((reference, idx) => (
              <div key={reference.id} className="rounded-xl overflow-hidden border border-border-soft/20 bg-bg-surface-soft">
                <div className="relative aspect-square group">
                <img src={reference.imageUrl} alt={`参考图 ${idx + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button 
                    onClick={() => removeReferenceImage(idx)}
                    className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transform scale-90 group-hover:scale-100 transition-all shadow-xl"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                </div>
                <select
                  value={reference.role}
                  onChange={(event) => updateReferenceRole(reference.id, event.target.value as ImageReferenceRole)}
                  className="w-full h-8 px-2 bg-bg-surface text-[10px] font-bold text-text-secondary border-t border-border-soft/20 outline-none"
                  aria-label={`参考图 ${idx + 1} 职责`}
                >
                  <option value="" disabled>选择职责</option>
                  {referenceRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <input
                  value={reference.label}
                  onChange={(event) => updateReferenceLabel(reference.id, event.target.value)}
                  placeholder="人物、场景或道具名称"
                  aria-label={`参考图 ${idx + 1} 名称`}
                  className="h-8 w-full border-t border-border-soft/20 bg-bg-surface px-2 text-[10px] font-bold text-text-secondary outline-none placeholder:font-normal placeholder:text-text-muted"
                />
              </div>
            ))}
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-xl border border-dashed border-border-soft/20 flex flex-col items-center justify-center gap-2 text-text-muted hover:text-text-primary hover:border-border-soft/40 hover:bg-bg-surface-soft transition-all cursor-pointer"
            >
              <Plus className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase tracking-widest">上传图片</span>
            </button>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            multiple 
            onChange={handleImageUpload}
          />
        </div>

        {/* Card 3: Generate Button wrapper */}
        <div className="p-4 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm shrink-0">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full h-12 btn-primary rounded-xl cursor-pointer"
            leftIcon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          >
            {isGenerating ? "正在渲染图像..." : "立即生成"}
          </Button>
        </div>
      </aside>

      {/* Main Panel: Results (Split into Canvas and History cards) */}
      <main className="flex-grow min-w-0 flex flex-col gap-6 text-text-primary relative">
        {/* Canvas Workspace Card */}
        <div className="bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm overflow-hidden flex flex-col relative min-h-[520px]">
          <div className={cn("flex-grow relative flex items-center justify-center p-8")}>
            {activeImage ? (
              <motion.div 
                key={activeImage.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative max-w-full max-h-full flex items-center justify-center group"
              >
                <img 
                  src={activeImage.url} 
                  alt="Generated" 
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl ring-1 ring-border-soft/10"
                />
                
                {/* Overlay Controls */}
                <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                  <Button 
                    onClick={() => window.open(activeImage.url, '_blank')}
                    variant="outline"
                    className="bg-black/60 hover:bg-black/80 text-white border-white/10 backdrop-blur-md rounded-full shadow-2xl"
                    leftIcon={<ImageIcon className="w-4 h-4" />}
                  >
                    新标签页打开
                  </Button>
                  <Button 
                    onClick={() => {
                      setImageToImport(activeImage.url);
                      setIsImportModalOpen(true);
                    }}
                    className="bg-white hover:bg-neutral-100 text-black border-transparent rounded-full shadow-xl"
                    leftIcon={<Save className="w-4 h-4" />}
                  >
                    导入到资产库
                  </Button>
                </div>
              </motion.div>
            ) : (
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-surface-soft flex items-center justify-center border border-border-soft/10">
                  <ImageIcon className="w-6 h-6 text-text-muted opacity-60" />
                </div>
                <p className="text-xs font-bold text-text-muted uppercase tracking-widest">
                  等待生成
                </p>
              </div>
            )}
          </div>
        </div>

        {/* History Strip Card */}
        <div className="h-32 bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm shrink-0 p-4 flex items-center overflow-x-auto custom-scrollbar gap-4">
          {generatedImages.length === 0 && (
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest mx-auto">
              生成历史记录将显示在这里
            </p>
          )}
          <AnimatePresence>
            {generatedImages.map((img) => (
              <motion.div
                key={img.id}
                initial={{ opacity: 0, scale: 0.8, x: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setActiveImageId(img.id)}
                className={cn(
                  "h-full aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all shrink-0 relative",
                  activeImageId === img.id 
                    ? "border-text-primary shadow-sm" 
                    : "border-transparent hover:border-border-soft/30 opacity-60 hover:opacity-100"
                )}
              >
                <img src={img.url} alt="History thumb" className="w-full h-full object-cover" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {isImportModalOpen && imageToImport && (
        <ImportAssetModal 
          imageUrl={imageToImport} 
          onClose={() => {
            setIsImportModalOpen(false);
            setImageToImport(null);
          }} 
        />
      )}
    </div>
  );
}

// Modal Component for saving to assets
function ImportAssetModal({ imageUrl, onClose }: { imageUrl: string, onClose: () => void }) {
  const { projects, updateProject } = useProjectStore();
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

  const selectedProject = projects.find(p => p.id === projectId);

  const availableAssets = targetScope === "project" && selectedProject
    ? [
        ...(selectedProject.characters || []).map(c => ({ id: c.id, name: c.name, type: "character" })), 
        ...(selectedProject.assets || []).map(a => ({ id: a.id, name: a.name, type: a.type }))
      ]
    : (globalAssets || []).map(g => ({ id: g.id, name: g.name, type: g.type }));

  useEffect(() => {
    if (availableAssets.length > 0 && !existingAssetId) {
      setExistingAssetId(availableAssets[0].id);
    }
  }, [availableAssets, existingAssetId]);

  const handleSave = () => {
    if (targetMode === "new" && !newAssetName.trim()) {
      toast.error("请输入资产名称");
      return;
    }

    if (targetScope === "project") {
      if (!selectedProject) return;
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
          updateProject({ ...selectedProject, characters: [...(selectedProject.characters || []), newChar] });
        } else {
          const newAss: Asset = {
            id: crypto.randomUUID(),
            name: newAssetName,
            description: newAssetDesc,
            type: newAssetType,
            ...(imageUsage === 'standard' ? { imageUrl: imageUrl } : imageUsage === 'panorama' ? { panoramaUrl: imageUrl } : { multiViewUrl: imageUrl })
          };
          updateProject({ ...selectedProject, assets: [...(selectedProject.assets || []), newAss] });
        }
      } else {
        // Exisiting
        const charIndex = (selectedProject.characters || []).findIndex(c => c.id === existingAssetId);
        if (charIndex >= 0) {
          const chars = [...(selectedProject.characters || [])];
          if (imageUsage === 'standard') chars[charIndex].referenceImageUrl = imageUrl;
          else if (imageUsage === 'multi') chars[charIndex].multiViewUrl = imageUrl;
          updateProject({ ...selectedProject, characters: chars });
        } else {
          const assIndex = (selectedProject.assets || []).findIndex(a => a.id === existingAssetId);
          if (assIndex >= 0) {
            const asm = [...(selectedProject.assets || [])];
            if (imageUsage === 'standard') asm[assIndex].imageUrl = imageUrl;
            else if (imageUsage === 'panorama') asm[assIndex].panoramaUrl = imageUrl;
            else if (imageUsage === 'multi') asm[assIndex].multiViewUrl = imageUrl;
            updateProject({ ...selectedProject, assets: asm });
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
          url: imageUrl
        } as any); // Assuming basic mapping
      } else {
        const ga = globalAssets.find(g => g.id === existingAssetId);
        if (ga) {
          updateGlobalAsset(existingAssetId, {
            imageUrls: [...ga.imageUrls, imageUrl],
            url: imageUrl
          });
        }
      }
    }
    
    toast.success("资产保存成功");
    onClose();
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
          <Button onClick={handleSave} className="bg-gray-900 text-white dark:bg-white dark:text-gray-900 hover:opacity-90">确认保存</Button>
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
                  if (usage.id === 'panorama' && (newAssetType === 'character' && targetMode === 'new')) return null;
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
