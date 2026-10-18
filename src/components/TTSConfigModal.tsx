import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic } from 'lucide-react';
import toast from 'react-hot-toast';
import { QWEN_LANGUAGES, speechCapabilities, type VoiceSettings } from '../../packages/domain/src/speech';
import { useAIConfigStore } from '../clients/stateClient';
import type { ManualAIResult } from '../../packages/domain/src/manualAI';
import { ManualAIResultField } from './ManualAIResultField';
import { withManualAIResult } from '../clients/manualAIClient';

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialText: string;
  onConfirm: (text: string, direction?: Partial<VoiceSettings>) => void | Promise<void>;
  title?: string;
  confirmText?: string;
  modelId?: string;
  projectId?: string;
  voiceName?: string;
  language?: string;
  instructions?: string;
  speed?: number;
  contextSummary?: string;
  readOnly?: boolean;
}

export default function TTSConfigModal({ isOpen, onClose, initialText, onConfirm, title = '生成角色配音', confirmText = '生成音频', modelId, projectId, voiceName, language = 'Auto', instructions = '', speed = 1, contextSummary, readOnly = false }: TTSConfigModalProps) {
  const models = useAIConfigStore(state => state.models);
  const model = models.find(item => item.id === modelId);
  const capabilities = speechCapabilities(model?.modelId);
  const [text, setText] = useState(initialText);
  const [localLanguage, setLocalLanguage] = useState(language);
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [localSpeed, setLocalSpeed] = useState(speed);
  const [result, setResult] = useState<ManualAIResult>();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isOpen) { setText(initialText); setLocalLanguage(language); setLocalInstructions(instructions); setLocalSpeed(speed); setResult(undefined); }
  }, [isOpen, initialText, language, instructions, speed]);
  if (!isOpen || typeof document === 'undefined') return null;
  const field = 'mt-2 w-full rounded-md border border-border-soft bg-bg-surface p-3 text-sm';
  return createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
    <section role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg bg-bg-surface text-text-primary shadow-xl">
      <header className="flex items-center justify-between border-b border-border-soft p-4"><h2 className="flex items-center gap-2 font-bold"><Mic className="h-4 w-4" />{title}</h2><button aria-label="关闭配音窗口" disabled={busy || uploading} onClick={onClose}><X className="h-4 w-4" /></button></header>
      <div className="space-y-4 p-5">
        <p className="text-xs text-text-muted">音色：{voiceName || '未选择'} · 模型：{modelId || '系统默认'}</p>
        {contextSummary && <p className="text-xs text-text-muted">{contextSummary}</p>}
        <label className="block text-xs">配音台词<textarea className={field} rows={4} readOnly={readOnly || busy} value={text} onChange={event => { setText(event.target.value); setResult(undefined); }} /></label>
        {readOnly && <p className="text-xs text-text-muted">台词来自当前镜头；修改正文请返回分镜。</p>}
        <label className="block text-xs">本句配音语言<select aria-label="本句配音语言" disabled={busy} className={field} value={localLanguage} onChange={event => setLocalLanguage(event.target.value)}>{QWEN_LANGUAGES.map(item => <option key={item} value={item}>{item === 'Auto' ? '自动识别' : item}</option>)}</select></label>
        <label className="block text-xs">本句表演要求<textarea aria-label="本句表演要求" disabled={busy} className={field} rows={2} value={localInstructions} onChange={event => setLocalInstructions(event.target.value)} placeholder="例如：压低声音，语速缓慢，保留句中停顿。" /></label>
        {!capabilities.instructions && <p className="text-xs text-text-muted">当前接口模型不支持表演指令；请切换支持的模型，或按此要求在外部制作后上传。</p>}
        {capabilities.speed ? <label className="block text-xs">本句语速<input aria-label="本句语速" type="number" min={0.25} max={4} step={0.05} className={field} value={localSpeed} onChange={event => setLocalSpeed(Number(event.target.value))} disabled={busy} /></label> : <p className="text-xs text-text-muted">当前模型不支持数值语速。支持表演指令时，可用文字描述快慢。</p>}
        <ManualAIResultField kind="audio" projectId={projectId} prompt={[`音色：${voiceName}`, `语言：${localLanguage}`, capabilities.speed ? `语速：${localSpeed}` : '', localInstructions, text].filter(Boolean).join('\n')} sourcePrompt={text} value={result} onChange={setResult} onBusyChange={setUploading} disabled={busy} />
      </div>
      <footer className="flex justify-end gap-3 border-t border-border-soft p-4">
        <button disabled={busy || uploading} onClick={onClose} className="px-3 py-2 text-sm">取消</button>
        <button disabled={!text.trim() || busy || uploading} className="rounded-md bg-text-primary px-4 py-2 text-sm text-bg-surface disabled:opacity-50" onClick={async () => {
          setBusy(true);
          try { await withManualAIResult(text, result, () => onConfirm(text, { language: localLanguage, instructions: localInstructions, speed: capabilities.speed ? localSpeed : undefined })); onClose(); }
          catch (error) { toast.error(error instanceof Error ? error.message : '配音失败'); }
          finally { setBusy(false); }
        }}>{busy ? '声音生成中…' : result ? '使用上传的声音' : confirmText}</button>
      </footer>
    </section>
  </div>, document.body);
}
