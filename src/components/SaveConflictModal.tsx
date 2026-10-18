import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Database, HardDrive, Cpu, CheckCircle } from 'lucide-react';
import { Project } from '../clients/domainTypes';

interface SaveConflictModalProps {
  isOpen: boolean;
  projectId: string;
  dbVersion: Project | null;
  localVersion: Project | null;
  memoryVersion: Project | null;
  onResolve: (choice: 'db' | 'local' | 'memory' | 'merge') => void;
  onClose: () => void;
}

export default function SaveConflictModal({
  isOpen,
  projectId,
  dbVersion,
  localVersion,
  memoryVersion,
  onResolve,
  onClose,
}: SaveConflictModalProps) {
  if (typeof document === 'undefined') return null;

  const formatDate = (timestamp?: string | number) => {
    if (!timestamp) return '未知时间';
    const date = new RegExp(/^\d+$/).test(String(timestamp))
      ? new Date(Number(timestamp))
      : new Date(timestamp);
    return date.toLocaleString();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 rounded-[2.5rem] shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-4 bg-amber-50/50 dark:bg-amber-950/10">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-black text-neutral-900 dark:text-white tracking-tight">
                  检测到本地保存版本冲突
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  您的项目在网络断开或保存失败时留下了本地差异。请选择最适合的版本以恢复或合并。
                </p>
              </div>
            </div>

            {/* Grid options */}
            <div className="p-8 overflow-y-auto custom-scrollbar flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Option 1: Database Version */}
              <div className="flex flex-col border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 bg-neutral-50 dark:bg-neutral-950/30">
                <div className="flex items-center gap-3 mb-4">
                  <Database className="w-5 h-5 text-blue-500" />
                  <span className="font-bold text-sm text-neutral-800 dark:text-neutral-200">云端/数据库版本</span>
                </div>
                <div className="flex-1 space-y-3 text-xs text-neutral-600 dark:text-neutral-400">
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">更新时间</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{dbVersion ? formatDate(dbVersion.id) : '无'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">项目名称</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{dbVersion?.title || '空'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Logline 核心设定</span>
                    <p className="line-clamp-3 text-neutral-500 dark:text-neutral-400">{dbVersion?.logline || '空'}</p>
                  </div>
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">角色数</span>
                      <span className="font-bold">{dbVersion?.characters?.length || 0}</span>
                    </div>
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">资产数</span>
                      <span className="font-bold">{dbVersion?.assets?.length || 0}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onResolve('db')}
                  className="mt-6 w-full py-3 bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-2xl text-xs font-black transition-all active:scale-95"
                >
                  保留数据库版本
                </button>
              </div>

              {/* Option 2: Local Recovery Queue Version */}
              <div className="flex flex-col border-2 border-violet-500 dark:border-violet-500 rounded-3xl p-6 bg-violet-50/10 dark:bg-violet-950/5 relative">
                <div className="absolute -top-3 right-6 px-3 py-1 bg-violet-500 text-white rounded-full text-[9px] font-black uppercase tracking-widest">
                  本地挂起
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <HardDrive className="w-5 h-5 text-violet-500" />
                  <span className="font-bold text-sm text-neutral-800 dark:text-neutral-200">本地未保存缓存</span>
                </div>
                <div className="flex-1 space-y-3 text-xs text-neutral-600 dark:text-neutral-400">
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">更新时间</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{localVersion ? formatDate(localVersion.id) : '无'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">项目名称</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{localVersion?.title || '空'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Logline 核心设定</span>
                    <p className="line-clamp-3 text-neutral-500 dark:text-neutral-400">{localVersion?.logline || '空'}</p>
                  </div>
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">角色数</span>
                      <span className="font-bold">{localVersion?.characters?.length || 0}</span>
                    </div>
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">资产数</span>
                      <span className="font-bold">{localVersion?.assets?.length || 0}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onResolve('local')}
                  className="mt-6 w-full py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl text-xs font-black transition-all shadow-lg shadow-violet-600/25 active:scale-95"
                >
                  使用本地缓存覆盖
                </button>
              </div>

              {/* Option 3: Memory State Version */}
              <div className="flex flex-col border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 bg-neutral-50 dark:bg-neutral-950/30">
                <div className="flex items-center gap-3 mb-4">
                  <Cpu className="w-5 h-5 text-emerald-500" />
                  <span className="font-bold text-sm text-neutral-800 dark:text-neutral-200">当前活动内存</span>
                </div>
                <div className="flex-1 space-y-3 text-xs text-neutral-600 dark:text-neutral-400">
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">更新时间</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{memoryVersion ? formatDate(memoryVersion.id) : '无'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">项目名称</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{memoryVersion?.title || '空'}</span>
                  </div>
                  <div>
                    <span className="block font-black text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Logline 核心设定</span>
                    <p className="line-clamp-3 text-neutral-500 dark:text-neutral-400">{memoryVersion?.logline || '空'}</p>
                  </div>
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">角色数</span>
                      <span className="font-bold">{memoryVersion?.characters?.length || 0}</span>
                    </div>
                    <div>
                      <span className="block font-black text-[9px] text-neutral-400 dark:text-neutral-500 uppercase">资产数</span>
                      <span className="font-bold">{memoryVersion?.assets?.length || 0}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onResolve('memory')}
                  className="mt-6 w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black transition-all shadow-lg shadow-emerald-600/25 active:scale-95"
                >
                  保持当前活动内存
                </button>
              </div>

            </div>

            {/* Footer */}
            <div className="p-6 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 flex flex-col md:flex-row items-center justify-between gap-4">
              <span className="text-[10px] text-neutral-500 leading-relaxed max-w-lg">
                <strong>智能建议</strong>: 如果您想要安全合并两者并且不愿丢失任何新建角色/分集，请选择右侧的 <strong>“三方字段保守合并”</strong>。
              </span>
              <div className="flex gap-3 w-full md:w-auto">
                <button
                  onClick={onClose}
                  className="flex-1 md:flex-none px-6 py-3 border border-neutral-200 dark:border-neutral-800 rounded-2xl text-xs font-black text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition-all uppercase tracking-wider active:scale-95"
                >
                  稍后决定
                </button>
                <button
                  onClick={() => onResolve('merge')}
                  className="flex-1 md:flex-none px-8 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 active:scale-95"
                >
                  <CheckCircle className="w-4 h-4" />
                  智能合并三方字段
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
