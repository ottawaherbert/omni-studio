import { useEffect, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import type { InteractiveWritingSceneOption, NarrativeNode, NodeContentBinding } from '../../clients/interactiveProductionClient.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';

export interface ContentMappingChange {
  nodeId: string;
  action: 'set' | 'clear';
  /** Complete ordered list, including previously bound scenes retained by the author. */
  scenes: InteractiveWritingSceneOption[];
  rationale: string;
}

type Row = { keys: string[]; reviewedKeys: string[]; rationale: string; dirty: boolean };
const sceneKey = (scene: InteractiveWritingSceneOption) => `${scene.ref.artifactId}:${scene.ref.versionId}:${scene.ref.checksum}`;
const refKey = (ref: { artifactId: string; versionId: string; checksum: string }) => `${ref.artifactId}:${ref.versionId}:${ref.checksum}`;
const bindingRefs = (binding?: NodeContentBinding) => binding?.scriptSceneRefs || (binding?.scriptSceneRef ? [binding.scriptSceneRef] : []);
const sceneLabel = (scene: InteractiveWritingSceneOption) => `${scene.unitTitle} · ${scene.sceneIndex}. ${scene.sceneTitle}`;
const blankRow = (): Row => ({ keys: [], reviewedKeys: [], rationale: '', dirty: false });

export function InteractiveContentMappingModal({ isOpen, nodes, scenes, bindings = [], loadScenes, onClose, onConfirm }: {
  isOpen: boolean;
  nodes: NarrativeNode[];
  /** Lightweight picker list. Full text comes from loadScenes. */
  scenes: InteractiveWritingSceneOption[];
  bindings?: NodeContentBinding[];
  loadScenes: (nodeId?: string) => Promise<InteractiveWritingSceneOption[]>;
  onClose: () => void;
  onConfirm: (changes: ContentMappingChange[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [fullScenes, setFullScenes] = useState<InteractiveWritingSceneOption[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const allSceneByKey = useMemo(() => new Map([...scenes, ...fullScenes].map((scene) => [sceneKey(scene), scene])), [scenes, fullScenes]);
  const fullSceneByKey = useMemo(() => new Map(fullScenes.map((scene) => [sceneKey(scene), scene])), [fullScenes]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const initial: Record<string, Row> = {};
    nodes.forEach((node) => {
      const binding = bindings.find((item) => item.nodeId === node.id && item.slot === 'main');
      initial[node.id] = { ...blankRow(), keys: bindingRefs(binding).map(refKey) };
    });
    setRows(initial);
    setError('');
    setIsSubmitting(false);
    setLoadingScenes(true);
    setFullScenes([]);
    void Promise.all([loadScenes(), ...nodes.filter((node) => initial[node.id]?.keys.length).map((node) => loadScenes(node.id))])
      .then((groups) => { if (active) setFullScenes([...new Map(groups.flat().map((scene) => [sceneKey(scene), scene])).values()]); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '读取剧本正文失败'); })
      .finally(() => { if (active) setLoadingScenes(false); });
    return () => { active = false; };
  }, [isOpen]);

  const changeRow = (nodeId: string, updater: (row: Row) => Row) => setRows((current) => ({ ...current, [nodeId]: updater(current[nodeId] || blankRow()) }));
  const changed = nodes.filter((node) => rows[node.id]?.dirty);
  const invalid = changed.some((node) => {
    const row = rows[node.id];
    const selected = row.keys.map((key) => fullSceneByKey.get(key)).filter((scene): scene is InteractiveWritingSceneOption => Boolean(scene));
    return row.keys.length > 0 && (
      !row.rationale.trim()
      || row.keys.some((key) => !fullSceneByKey.has(key) || !row.reviewedKeys.includes(key))
      || new Set(selected.map((scene) => scene.unitId)).size > 1
      || new Set(selected.map((scene) => scene.writingProjectRevision)).size > 1
    );
  });
  const confirm = async () => {
    if (!changed.length || invalid || loadingScenes || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      await onConfirm(changed.map((node): ContentMappingChange => {
        const row = rows[node.id];
        return { nodeId: node.id, action: row.keys.length ? 'set' : 'clear', scenes: row.keys.map((key) => fullSceneByKey.get(key)!), rationale: row.rationale.trim() };
      }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '节点内容映射写入失败');
    } finally { setIsSubmitting(false); }
  };

  return <Modal isOpen={isOpen} onClose={onClose} title="映射剧本场次" size="xl" footer={<><Button variant="secondary" size="sm" onClick={onClose}>取消</Button><Button size="sm" leftIcon={<Link2 className="h-3.5 w-3.5" />} disabled={!changed.length || invalid || loadingScenes} isLoading={isSubmitting} onClick={() => void confirm()}>确认所改节点</Button></>}>
    <p className="text-xs leading-5 text-text-muted">逐个节点查看正式场次正文，选择需要绑定的内容，再确认它与节点相符。未改的节点保持原绑定。</p>
    <div className="mt-4 max-h-[520px] divide-y divide-border-soft/20 overflow-y-auto border-y border-border-soft/25">
      {nodes.map((node) => {
        const row = rows[node.id] || blankRow();
        const boundCount = bindingRefs(bindings.find((item) => item.nodeId === node.id && item.slot === 'main')).length;
        return <section key={node.id} className="space-y-3 py-4 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold text-text-primary">{node.brief.title}</h3><p className="mt-0.5 text-text-muted">{node.brief.intent}</p></div><span className="text-text-muted">原绑定 {boundCount} 场{row.dirty ? ' · 已修改' : ''}</span></div>
          {row.keys.length > 0 && !row.dirty && <button type="button" aria-label={`${node.brief.title}重新核对正文`} className="text-xs font-bold text-gold" onClick={() => changeRow(node.id, (current) => ({ ...current, dirty: true, reviewedKeys: [], rationale: '' }))}>重新核对当前绑定</button>}
          {row.keys.map((key, index) => {
            const scene = allSceneByKey.get(key);
            const full = fullSceneByKey.get(key);
            return <div key={key} className="rounded-xl border border-border-soft/30 bg-bg-surface-soft/40 p-3">
              <div className="flex items-start justify-between gap-2"><span className="font-bold text-text-primary">{index + 1}. {scene ? sceneLabel(scene) : `旧场次 ${key}（当前不可读取）`}</span><div className="flex shrink-0 gap-1"><button type="button" aria-label={`${node.brief.title}场次上移 ${index + 1}`} disabled={index === 0} onClick={() => changeRow(node.id, (current) => { const keys = [...current.keys]; [keys[index - 1], keys[index]] = [keys[index], keys[index - 1]]; return { ...current, keys, reviewedKeys: [], dirty: true }; })} className="text-gold disabled:opacity-30">上移</button><button type="button" aria-label={`${node.brief.title}移除场次 ${index + 1}`} onClick={() => changeRow(node.id, (current) => ({ ...current, keys: current.keys.filter((item) => item !== key), reviewedKeys: [], dirty: true }))} className="text-rose-500">移除</button></div></div>
              {full ? <div className="mt-2 space-y-2"><p className="whitespace-pre-wrap text-text-secondary">{full.synopsis || '此场没有摘要'}</p>{full.scriptBlocks?.length ? <div className="max-h-40 space-y-1 overflow-y-auto border-l-2 border-gold/30 pl-2 text-text-secondary">{full.scriptBlocks.map((block, at) => <p key={at} className="whitespace-pre-wrap">{block.content}</p>)}</div> : <p className="text-amber-500">此场暂没有正文，可根据摘要复核</p>}{row.dirty && <label className="flex items-center gap-2 text-text-primary"><input type="checkbox" checked={row.reviewedKeys.includes(key)} onChange={(event) => changeRow(node.id, (current) => ({ ...current, reviewedKeys: event.target.checked ? [...current.reviewedKeys, key] : current.reviewedKeys.filter((item) => item !== key) }))} />我已查看并确认此场与节点相符</label>}</div> : <p className="mt-2 text-amber-500">正文尚未读取，不能确认此场；可以移除后重新选择。</p>}
            </div>;
          })}
          <select aria-label={`${node.brief.title}添加剧本场次`} value="" onChange={(event) => { const key = event.target.value; if (key) changeRow(node.id, (current) => current.keys.includes(key) ? current : { ...current, keys: [...current.keys, key], reviewedKeys: [], dirty: true }); }} className="h-10 w-full border border-border-soft/35 bg-bg-primary px-3 text-xs text-text-primary outline-none focus:border-gold/60"><option value="">添加一场正式剧本内容</option>{scenes.filter((scene) => !row.keys.includes(sceneKey(scene))).map((scene) => <option key={sceneKey(scene)} value={sceneKey(scene)}>{sceneLabel(scene)}</option>)}</select>
          {row.dirty && row.keys.length > 0 && <label className="block text-text-muted">为何这些场次适合当前节点<textarea aria-label={`${node.brief.title}匹配理由`} rows={2} value={row.rationale} onChange={(event) => changeRow(node.id, (current) => ({ ...current, rationale: event.target.value }))} placeholder="例如：主角在码头取得线索，符合本节点的行动与情绪转折" className="mt-1 w-full border border-border-soft/35 bg-bg-primary p-2 text-xs text-text-primary outline-none focus:border-gold/60" /></label>}
          {row.dirty && new Set(row.keys.map((key) => fullSceneByKey.get(key)?.unitId).filter(Boolean)).size > 1 && <p className="text-amber-500">一个节点只能绑定同一剧本单元的场次。</p>}
          {row.dirty && row.keys.length === 0 && <p className="text-amber-500">将解除此节点的全部正文绑定。</p>}
        </section>;
      })}
    </div>
    <p className={`mt-3 text-xs ${changed.length && !invalid ? 'text-emerald-500' : 'text-amber-500'}`}>{loadingScenes ? '正在读取剧本正文…' : !changed.length ? '请选择要修改的节点' : invalid ? '请查看并确认每场正文，填写匹配理由' : `已准备更新 ${changed.length} 个节点`}</p>
    {error && <p role="alert" className="mt-3 border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-xs text-accent-red">{error}</p>}
  </Modal>;
}
