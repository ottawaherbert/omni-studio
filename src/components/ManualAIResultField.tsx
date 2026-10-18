import { useSettingsStore } from '../clients/stateClient';
import { useEffect, useRef, useState } from "react";
import { Copy, Upload, X } from "lucide-react";
import { assetClient } from "../clients/assetClient";
import { hasManualAIResult, type ManualAIKind, type ManualAIResult } from "../../packages/domain/src/manualAI";

export const ManualAIResultField = ({ prompt, value, onChange, kind, projectId, disabled = false, onBusyChange, sourcePrompt = prompt, manualOnly = false }: {
  prompt: string;
  manualOnly?: boolean;
  sourcePrompt?: string;
  value?: ManualAIResult;
  onChange: (value?: ManualAIResult) => void;
  kind?: ManualAIKind;
  projectId?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) => {
  const isTestMode = useSettingsStore(state => state.isTestMode);
  const [expanded, setExpanded] = useState(Boolean(value));
  const [uploading, setUploading] = useState(false);
  const [uploadAttempted, setUploadAttempted] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const mediaKind = kind && kind !== "text" ? kind : "image";
  const labels = { image: "图片", video: "视频", audio: "声音", text: "文字" };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setMessage("完整提示词已复制"); }
    catch { setMessage("复制失败，请选中提示词手动复制。"); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const token = ++generation.current;
    setUploadAttempted(true); setUploading(true); onBusyChange?.(true); setMessage("");
    try {
      if (!file.type.startsWith(`${mediaKind}/`)) throw new Error(`请选择${labels[mediaKind]}文件。`);
      if (mediaKind === "image") {
        const image = await createImageBitmap(file).catch(() => { throw new Error("无法读取这张图片，请选择完整的 PNG、JPEG 或 WebP 图片。"); });
        image.close();
      }
      const saved = await assetClient.uploadFile(file, projectId);
      if (!saved.url) throw new Error("结果文件未保存，请重试上传。");
      if (generation.current === token) { onChange({ kind: mediaKind, url: saved.url, fileName: file.name, sourcePrompt, embeddedAudio: saved.videoMetadata?.hasAudio }); setUploadAttempted(false); onBusyChange?.(false); }
    } catch (error) { if (generation.current === token) setMessage((error as Error).message); }
    finally { if (generation.current === token) { setUploading(false); } if (inputRef.current) inputRef.current.value = ""; }
  };
  if (!isTestMode) return null;
  return <div className="shrink-0 border-t border-gray-200 px-4 py-3 text-xs dark:border-neutral-800" data-manual-ai-result="true">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"><Copy className="h-3.5 w-3.5" />复制完整提示词</button>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="font-semibold text-text-primary">{expanded ? "收起手动返回" : "填写 AI 返回 / 上传结果"}</button>
      <span className="text-text-muted">{hasManualAIResult(value) ? "本次使用手动结果，不调用 AI 接口" : manualOnly ? "外部制作：上传结果后确认，不调用 AI 接口" : "留空则正常调用 AI 接口"}</span>
    </div>
    {expanded && <div className="mt-3 space-y-2">
      {(!kind || kind === "text") && <textarea aria-label="手动 AI 返回内容" disabled={disabled || uploading} value={value?.kind === "text" ? value.text || "" : ""} onChange={(event) => onChange(event.target.value ? { kind: "text", text: event.target.value, sourcePrompt } : undefined)} placeholder="将提示词粘贴到外部 AI，复制它的完整回答到这里。要求 JSON 的任务请保留字段与结构。" className="h-28 w-full resize-y rounded-md border border-gray-300 bg-transparent p-3 font-mono text-xs leading-5 text-text-primary dark:border-neutral-700" />}
      {(!kind || kind === "text") && <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 dark:border-neutral-700">读取返回文件（TXT / JSON）<input aria-label="读取 AI 返回文件" type="file" accept=".txt,.json,text/plain,application/json" disabled={disabled || uploading} className="sr-only" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        const token = ++generation.current; setUploading(true); onBusyChange?.(true);
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error('返回文件超过 5 MiB，请按场次分批处理。');
          const text = await file.text();
          if (generation.current === token) { onChange({ kind: 'text', text, sourcePrompt }); setMessage(`已读取 ${file.name}（${text.length} 字符）`); }
        } catch (error) { if (generation.current === token) setMessage((error as Error).message); }
        finally { if (generation.current === token) { setUploading(false); onBusyChange?.(false); } }
        event.target.value = '';
      }} /></label>}
      {kind !== "text" && <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 disabled:opacity-50 dark:border-neutral-700"><Upload className="h-3.5 w-3.5" />{uploading ? "正在保存结果文件…" : `上传生成结果${labels[mediaKind]}`}</button>
        <input ref={inputRef} aria-label={`上传生成结果${labels[mediaKind]}`} type="file" accept={`${mediaKind}/*`} className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
        <span className="text-text-muted">生成结果与参考素材分别保存。</span>
      </div>}
      {value?.url && <div className="flex items-center gap-3">
        {value.kind === "image" && <img src={value.url} alt="手动上传的生成结果" className="h-20 w-28 rounded object-contain" />}
        {value.kind === "video" && <video src={value.url} controls className="h-28 max-w-xs" />}
        {value.kind === "audio" && <audio src={value.url} controls />}
        <span className="truncate">{value.fileName || "已保存的结果"}</span>
      </div>}
      {(hasManualAIResult(value) || uploadAttempted) && <button type="button" disabled={disabled} onClick={() => { generation.current++; setUploading(false); setUploadAttempted(false); onBusyChange?.(false); onChange(undefined); }} className="flex items-center gap-1 text-text-muted"><X className="h-3.5 w-3.5" />清除手动返回</button>}
    </div>}
    {message && <p role="status" className="mt-2 text-text-secondary">{message}</p>}
  </div>;
};
