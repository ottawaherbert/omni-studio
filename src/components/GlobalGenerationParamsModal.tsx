import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Settings2, Save } from 'lucide-react';
import { useProjectStore } from '../clients/stateClient';

interface GlobalGenerationParamsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GlobalGenerationParamsModal({ isOpen, onClose }: GlobalGenerationParamsModalProps) {
  const { currentProject, updateProject } = useProjectStore();
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    currentProject?.aspectRatio === '9:16' ? '9:16' : '16:9'
  );

  useEffect(() => {
    if (isOpen && currentProject) {
      setAspectRatio(currentProject.aspectRatio === '9:16' ? '9:16' : '16:9');
    }
  }, [isOpen, currentProject]);

  if (!currentProject) return null;
  if (typeof document === 'undefined') return null;

  const handleSave = () => {
    updateProject({ aspectRatio });
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="p-6 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between bg-gray-50/50 dark:bg-neutral-950/50">
            <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-3 tracking-tight">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center shadow-sm">
                <Settings2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              项目画幅
            </h2>
            <button
              onClick={onClose}
              className="p-2.5 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-2xl transition-all text-gray-400 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-white active:scale-90"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-6 p-8">
            <div>
              <label className="block text-xs font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-3">
                项目成片画幅
              </label>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="项目成片画幅">
                {(['16:9', '9:16'] as const).map((ratio) => {
                  const selected = aspectRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAspectRatio(ratio)}
                      className={`min-h-12 rounded-lg border px-4 py-3 text-left transition-colors ${
                        selected
                          ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
                      }`}
                    >
                      <span className="block text-sm font-black">{ratio}</span>
                      <span className="block text-xs text-current opacity-70">
                        {ratio === '16:9' ? '横屏' : '竖屏'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-neutral-500">
                这是项目级设置，不是单个分镜的设置。只影响之后的生成，不会改动已有图片。
              </p>
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
              className="px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl text-sm font-black transition-all flex items-center gap-2 shadow-lg shadow-violet-600/25 active:scale-95"
            >
              <Save className="w-4 h-4" />
              保存画幅
            </button>
          </div>
        </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
