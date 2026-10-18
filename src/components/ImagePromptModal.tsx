import { ManualAIResultField } from "./ManualAIResultField";
import { withManualAIResult } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, type ManualAIResult } from "../../packages/domain/src/manualAI";
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Wand2, Upload, Image as ImageIcon } from 'lucide-react';

interface ImagePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt: string;
  initialReferenceImage?: string;
  onConfirm: (finalPrompt: string, referenceImage?: string, selection?: ImagePromptSelection) => void | Promise<void>;
  title?: string;
  confirmText?: string;
}

export interface ImagePromptSelection {
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
}

export default function ImagePromptModal({
  isOpen,
  onClose,
  initialPrompt,
  initialReferenceImage,
  onConfirm,
  title = "AI 生成图片",
  confirmText = "生成图片",
}: ImagePromptModalProps) {
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  const [resultUploading, setResultUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [referenceImage, setReferenceImage] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPrompt(initialPrompt);
      setManualResult(undefined);
      setResultUploading(false);
      setSubmitError("");
      setReferenceImage(initialReferenceImage);
    }
  }, [isOpen, initialPrompt, initialReferenceImage]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setReferenceImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (submitting || resultUploading) return;
    setSubmitting(true); setSubmitError("");
    try {
      await withManualAIResult(prompt.trim(), manualResult, () => onConfirm(prompt.trim(), referenceImage, {
        selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [],
      }));
      onClose();
    } catch (error) { setSubmitError((error as Error).message); }
    finally { setSubmitting(false); }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className="bg-white dark:bg-neutral-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-800 w-full max-w-6xl flex flex-col h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 px-6 py-4 border-b border-gray-100 dark:border-neutral-900 bg-white dark:bg-neutral-950 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center">
                  <Wand2 className="w-4 h-4" />
                </div>
                <h2 className="text-[15px] font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  {title}
                </h2>
              </div>
              <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Layout */}
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col bg-white dark:bg-neutral-950 min-w-0 p-6 gap-6 overflow-y-auto">
                <div className="flex-1 flex flex-col h-full min-h-[50vh]">
                  <label className="block text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">提示词 (Prompt)</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-1 w-full bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-800 rounded-xl p-4 text-[13px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none custom-scrollbar min-h-[200px]"
                    placeholder="输入图片生成提示词..."
                  />
                </div>

                <div className="shrink-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">参考图 (可选)</label>
                  <div 
                    className="border-2 border-dashed border-gray-200 dark:border-neutral-800 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500/50 transition-colors group relative overflow-hidden bg-gray-50 dark:bg-neutral-950/50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {referenceImage ? (
                      <>
                        <img src={referenceImage} alt="Reference" className="max-h-48 object-contain rounded-lg" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-sm font-medium flex items-center gap-2">
                            <Upload className="w-4 h-4" /> 更换参考图
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-500 dark:text-neutral-500 py-8">
                        <ImageIcon className="w-8 h-8 opacity-50" />
                        <span className="text-sm">点击上传参考图 (Image-to-Image)</span>
                      </div>
                    )}
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </div>
                  {referenceImage && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); setReferenceImage(undefined); }}
                      className="mt-2 text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
                    >
                      移除参考图
                    </button>
                  )}
                </div>
              </div>
            </div>

            <ManualAIResultField prompt={prompt} value={manualResult} onChange={setManualResult} kind="image" disabled={submitting} onBusyChange={setResultUploading} />
            {submitError && <p role="alert" className="px-6 text-sm text-red-600">{submitError}</p>}
            {/* Footer Panel */}
            <div className="shrink-0 p-5 bg-white dark:bg-neutral-950 border-t border-gray-100 dark:border-neutral-900 flex items-center justify-end gap-3 z-20">
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || submitting || resultUploading}
                className="px-8 py-2.5 rounded-xl text-[13px] font-black text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 className="w-4 h-4" />
                {submitting ? "处理中…" : hasManualAIResult(manualResult) ? "确认使用上传图片" : confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
