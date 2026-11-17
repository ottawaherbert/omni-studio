import { useState } from 'react';
import { Plus, BookOpen, Search } from 'lucide-react';
import type { ProjectProfile } from '../../../../../packages/script/src/schema';
import type { ScriptProjectSummary } from '../../../../../packages/domain/src/scriptDelivery';
import { SCRIPT_CREATION_PRESETS, createScriptCreationProfile, type ScriptCreationFormat, type InitialBriefPayload } from '../../../../../packages/script/src/creation';
import { Modal } from '../../../../../src/components/ui/Modal';

interface Props {
  projects: ScriptProjectSummary[]; error: string;
  onOpen: (id: string, view?: 'blueprint') => void;
  onCreate: (title: string, profile: ProjectProfile, initialBrief?: InitialBriefPayload) => Promise<void>;
  onDeleteProject?: (id: string) => void; onOpenLibrary?: () => void;
}

export function ScriptLibrary({ projects, error, onOpen, onCreate, onOpenLibrary }: Props) {
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''), [title, setTitle] = useState(''), [material, setMaterial] = useState('');
  const [format, setFormat] = useState<ScriptCreationFormat>('short-film');
  const [units, setUnits] = useState(1), [minutes, setMinutes] = useState(5);
  const [kind, setKind] = useState<'concept'|'outline'|'scene'>('concept'), [failure, setFailure] = useState('');
  const [customType, setCustomType] = useState(''), [organization, setOrganization] = useState<ProjectProfile['organization']>('standalone');
  const submit = async () => {
    if (busy) return;
    setBusy(true); setFailure('');
    try {
      if (!title.trim()) throw new Error('请填写作品名称');
      const profile = createScriptCreationProfile(format, units, minutes, undefined, undefined, {workType:customType,organization});
      await onCreate(title.trim(), profile, material.trim() ? {
        concept: kind==='concept'?material:'', theme:'', outline:kind==='outline'?material:'',
        ...(kind==='scene'?{sceneText:material}:{}), originalMaterial:{kind:kind==='concept'?'idea':kind,text:material},
      } : undefined);
      setCreating(false);
    } catch (e) { setFailure(e instanceof Error?e.message:'创建失败，输入已保留'); }
    finally { setBusy(false); }
  };
  return <main className="h-full overflow-auto bg-bg-primary text-text-primary p-8">
    <div className="max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4 mb-8">
        <div><h1 className="text-2xl font-semibold">剧本工坊</h1><p className="text-sm text-text-muted mt-2">管理作品、编辑剧本，导入外部创作结果并检查采用。</p></div>
        <div className="flex gap-3"><button className="px-3 py-2 text-sm border border-border-soft rounded-lg" onClick={onOpenLibrary}>管理作品</button><button className="px-4 py-2 text-sm rounded-lg bg-text-primary text-bg-primary flex items-center gap-2" onClick={()=>setCreating(true)}><Plus size={16}/>新建剧本</button></div>
      </header>
      <label className="flex items-center gap-2 border-b border-border-soft pb-3 mb-4 text-text-muted"><Search size={16}/><input aria-label="搜索作品" className="flex-1 bg-transparent outline-none text-sm text-text-primary" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索作品名称"/></label>
      {error&&<p role="alert" className="text-accent-red">{error}</p>}
      <div className="divide-y divide-border-soft">{projects.filter(p=>p.title.toLowerCase().includes(search.toLowerCase())).map(p=><button key={p.id} className="w-full py-5 flex items-center gap-4 text-left hover:bg-bg-surface-soft" onClick={()=>onOpen(p.id)}><BookOpen size={20} className="text-text-muted"/><div><strong className="text-sm">{p.title}</strong><p className="text-xs text-text-muted mt-1">{p.workType||'剧本'}</p></div><span className="ml-auto text-sm text-text-secondary">打开作品</span></button>)}</div>
      {!projects.length&&<p className="py-16 text-center text-text-muted">新建作品后，可以直接编辑，也可以准备任务并回填外部模型的结果。</p>}
      <details className="mt-8 text-sm text-text-muted"><summary className="cursor-pointer">历史内容存档</summary><p className="my-3">旧助手已停用。以下只读文件保留原稿、候选与记录，不会执行任务或覆盖作品；分页文件中的 next 指向下一页。</p><div className="flex flex-wrap gap-4">{Object.entries({workspaces:'旧工作稿',drafts:'旧执行草稿',candidates:'旧候选',conversations:'会话记录',messages:'消息记录',jobs:'任务记录',writing_turns:'写作对话原文',writing_sources:'写作输入原件',workspace_revisions:'工作稿版本',preparation:'旧筹备成果'}).map(([key,label])=><a key={key} href={`/api/script-archives/${key}`} download className="underline">导出{label}</a>)}</div></details>
    </div>
    <Modal isOpen={creating} onClose={()=>{if(!busy)setCreating(false);}} title="新建剧本">
      <div className="sw space-y-4 text-sm">
        <label className="sw-field">作品名称<input aria-label="作品名称" value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label className="sw-field">作品形式<select aria-label="作品形式" value={format} onChange={e=>{const key=e.target.value as ScriptCreationFormat;setFormat(key);setUnits(SCRIPT_CREATION_PRESETS[key].plannedUnits);setMinutes(SCRIPT_CREATION_PRESETS[key].targetMinutes);}}>{Object.entries(SCRIPT_CREATION_PRESETS).map(([id,p])=><option key={id} value={id}>{p.label}</option>)}</select></label>
        {format==='custom'&&<><label className="sw-field">类型名称<input value={customType} onChange={e=>setCustomType(e.target.value)}/></label><label className="sw-field">组织方式<select value={organization} onChange={e=>setOrganization(e.target.value as ProjectProfile['organization'])}><option value="standalone">单部作品</option><option value="episodic">分集作品</option></select></label></>}
        <div className="flex gap-4"><label className="sw-field flex-1">计划集数<input type="number" min={1} max={1000} disabled={format==='custom'?organization==='standalone':SCRIPT_CREATION_PRESETS[format].organization==='standalone'} value={units} onChange={e=>setUnits(Number(e.target.value))}/></label><label className="sw-field flex-1">每集目标分钟<input type="number" min={0.5} max={600} step={0.5} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label></div>
        <label className="sw-field">已有资料（可选）<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="concept">故事想法</option><option value="outline">故事大纲</option><option value="scene">已有正文</option></select><textarea aria-label="已有资料" rows={6} value={material} onChange={e=>setMaterial(e.target.value)} placeholder="粘贴已有内容，原件会随项目保存"/></label>
        {failure&&<p role="alert">{failure}</p>}<button className="sw-primary" disabled={busy||!title.trim()} onClick={()=>void submit()}>{busy?'创建中…':'创建并打开'}</button>
      </div>
    </Modal>
  </main>;
}
