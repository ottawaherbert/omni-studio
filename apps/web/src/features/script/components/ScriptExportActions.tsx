import { scriptClient } from '../../../clients/scriptClient';
import { exportText, scriptExportFilename, type ScriptExportFormat } from '../../../../../../packages/script/src/exporters';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';

export function downloadLocalScript(project: ScriptProject, format: ScriptExportFormat) {
  const text = format === 'json' ? JSON.stringify(project, null, 2) : exportText(project, format);
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = scriptExportFilename(project, format, true);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ScriptExportActions({ project, localDraft = false }: { project: ScriptProject; localDraft?: boolean }) {
  const formats = [{ format: 'markdown', label: '可阅读文本 · Markdown' }, { format: 'fountain', label: '剧本格式 · Fountain' }, { format: 'json', label: '稿件与资料 · JSON' }] as const;
  const className = 'block w-full text-left px-3 py-2 rounded hover:bg-bg-surface-hover';
  return <div aria-label={localDraft ? '导出未保存草稿' : '导出当前稿'}>
    <p className="px-3 py-1 text-text-muted">{localDraft ? '导出尚未同步的当前稿' : '导出当前已保存稿'}</p>
    {formats.map(({ format, label }) => localDraft
      ? <button key={format} type="button" className={className} onClick={() => downloadLocalScript(project, format)}>{label}</button>
      : <a key={format} className={className} href={scriptClient.exportUrl(project.id, format)} download={scriptExportFilename(project, format)}>{label}</a>)}
  </div>;
}
