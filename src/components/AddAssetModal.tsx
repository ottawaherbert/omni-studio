import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Image as ImageIcon, Box } from 'lucide-react';
import { useProjectStore } from '../clients/stateClient';
import { Asset } from '../clients/domainTypes';
import toast from 'react-hot-toast';
import { summarizeUnknownError } from '../utils/logging';

interface AddAssetModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialName?: string;
  initialType?: "character" | "location" | "prop" | "wardrobe" | "makeupHair" | "vehicles" | "extrasAtmosphere" | "specialEquipment";
  onSave?: (assetId: string) => void;
}

export default function AddAssetModal({ isOpen = true, onClose, initialName = '', initialType = 'character', onSave }: AddAssetModalProps) {
  const { currentProject, updateProject } = useProjectStore();
  const [type, setType] = useState<"character" | "location" | "prop" | "wardrobe" | "makeupHair" | "vehicles" | "extrasAtmosphere" | "specialEquipment">(initialType);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tags, setTags] = useState('');

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setType(initialType);
      setDescription('');
      setPrompt('');
      setTags('');
    }
  }, [isOpen, initialName, initialType]);

  const handleSave = async () => {
    if (!currentProject) return;
    if (!name.trim()) {
      toast.error('请输入资产名称');
      return;
    }

    const newAsset: Asset = {
      id: type === 'character' ? `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` : `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    };

    let updatedAssets = currentProject.assets || [];
    let updatedCharacters = currentProject.characters || [];
    const savedAssetId = type === 'character' ? newAsset.id.replace('char-', '') : newAsset.id;

    if (type === 'character') {
      updatedCharacters = [
        ...updatedCharacters,
        {
          id: savedAssetId,
          name: newAsset.name,
          psychologicalProfile: newAsset.description || undefined,
          multiViewPrompt: newAsset.prompt || undefined,
          internalDesire: '待补充',
          externalGoal: '待补充',
          flaw: '待补充',
        }
      ];
      // Do not add to updatedAssets here, updateProject will generate it from characters
    } else {
      updatedAssets = [...updatedAssets, newAsset];
    }

    try {
      await updateProject({
        assets: updatedAssets,
        characters: updatedCharacters
      });
      toast.success('资产添加成功');
      if (onSave) {
        onSave(savedAssetId);
      }
      onClose();
    } catch (e) {
      console.error('Add asset failed:', summarizeUnknownError(e));
      toast.error('添加失败');
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-950/50">
              <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">新增资产</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭新增资产"
                title="关闭"
                className="p-2.5 text-gray-400 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-white rounded-2xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-all active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

          <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh] custom-scrollbar">
            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-4">资产类型</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                <button
                  onClick={() => setType('character')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'character' 
                      ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">角色</span>
                </button>
                <button
                  onClick={() => setType('location')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'location' 
                      ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <ImageIcon className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">场地</span>
                </button>
                <button
                  onClick={() => setType('prop')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'prop' 
                      ? 'bg-amber-50 dark:bg-amber-600/20 border-amber-500 text-amber-600 dark:text-amber-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <Box className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">道具</span>
                </button>
                <button
                  onClick={() => setType('wardrobe')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'wardrobe' 
                      ? 'bg-pink-50 dark:bg-pink-600/20 border-pink-500 text-pink-600 dark:text-pink-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">服饰</span>
                </button>
                <button
                  onClick={() => setType('makeupHair')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'makeupHair' 
                      ? 'bg-rose-50 dark:bg-rose-600/20 border-rose-500 text-rose-600 dark:text-rose-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">妆发</span>
                </button>
                <button
                  onClick={() => setType('vehicles')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'vehicles' 
                      ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <Box className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">车辆</span>
                </button>
                <button
                  onClick={() => setType('extrasAtmosphere')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'extrasAtmosphere' 
                      ? 'bg-orange-50 dark:bg-orange-600/20 border-orange-500 text-orange-600 dark:text-orange-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">群演</span>
                </button>
                <button
                  onClick={() => setType('specialEquipment')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                    type === 'specialEquipment' 
                      ? 'bg-teal-50 dark:bg-teal-600/20 border-teal-500 text-teal-600 dark:text-teal-400 shadow-sm' 
                      : 'bg-gray-50 dark:bg-neutral-950 border-gray-100 dark:border-neutral-800 text-gray-400 dark:text-neutral-600 hover:border-gray-300 dark:hover:border-neutral-700'
                  }`}
                >
                  <Box className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">设备</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-3">资产名称 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：张三、废弃工厂、神秘怀表"
                className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-inner"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-3">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="详细描述该资产的外观、特征或氛围..."
                className="w-full h-28 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all resize-none custom-scrollbar shadow-inner leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-3">AI 绘图提示词 (可选)</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="用于生成生产参考候选的 Prompt..."
                className="w-full h-24 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all resize-none custom-scrollbar font-mono text-sm shadow-inner leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-3">标签 (可选)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="用逗号分隔，如：赛博朋克, 反派, 室内"
                className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-inner"
              />
            </div>
          </div>

          <div className="p-6 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-950/50 flex justify-end gap-4">
            <button
              onClick={onClose}
              className="px-6 py-3 text-sm font-black text-gray-400 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-white transition-all uppercase tracking-widest active:scale-95"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-8 py-3 bg-gray-900 dark:bg-neutral-800 hover:bg-black dark:hover:bg-neutral-700 text-white rounded-2xl text-sm font-black transition-all shadow-lg shadow-gray-900/20 active:scale-95"
            >
              保存资产
            </button>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
