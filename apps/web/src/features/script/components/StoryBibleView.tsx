import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Users, Plus, Trash2, Sparkles, Check, 
  Flame, ShieldAlert, Award, FileText, Compass, Edit3,
  Send, Copy, Wand2, Stethoscope, MessageSquare, Sliders,
  CheckCircle2, ChevronRight, Activity, ArrowRight, Lightbulb,
  AlertCircle, RefreshCw, X, LayoutGrid
} from 'lucide-react';
import type { ScriptProject, Character, ScriptOperation } from '../../../../../../packages/script/src/schema';
import { newId, setProjectContinuity } from '../../../../../../packages/script/src/project';
import {ScriptLongText} from './ScriptLongText';
import { scopeOptions, visibleInUnit } from '../../../../../../packages/script/src/continuity';
import toast from 'react-hot-toast';

interface Props {
  project: ScriptProject;
  activeUnitId?:string;
  onRequestTask:(operation:ScriptOperation,request?:string,entity?:{kind:'character'|'fact';id:string})=>void;
  defaultTab?: 'blueprint' | 'characters' | 'world' | 'specs' | 'bible';
  onUpdateProject: (updater: (draft: ScriptProject) => void) => void;
  onSwitchToWriting?: () => void;
  onSwitchToOutline?: () => void;
}

const PRESET_FACT_TAGS = [
  { label: '地点', icon: '📍', desc: '故事发生的场所' },
  { label: '人物关系', icon: '👥', desc: '人物之间已经确定的关系' },
  { label: '社会环境', icon: '🏛️', desc: '故事中的制度或生活背景' },
  { label: '规则', icon: '⚖️', desc: '已确定的世界或行业规则' },
  { label: '关键事件', icon: '📝', desc: '已经发生或计划发生的事' },
  { label: '其他', icon: '📌', desc: '其他需要留存的资料' },
];

function parseFact(rawText: string) {
  const match = rawText.match(/^【([^】]+)】\s*([\s\S]*)$/);
  if (match) {
    return {
      tag: match[1].trim(),
      content: match[2].trim(),
    };
  }
  return {
    tag: '故事设定',
    content: rawText.trim(),
  };
}

function serializeFact(tag: string, content: string) {
  const cleanTag = tag.trim() || '故事设定';
  return `【${cleanTag}】 ${content.trim()}`;
}

export function StoryBibleView({
  project,
  activeUnitId,
  defaultTab = 'blueprint',
  onUpdateProject,
  onSwitchToWriting,
  onSwitchToOutline,
  onRequestTask,
}: Props) {
  const resolveSection = (t?: string): 'blueprint' | 'characters' | 'world' | 'specs' => {
    if (t === 'characters') return 'characters';
    if (t === 'world') return 'world';
    if (t === 'specs') return 'specs';
    return 'blueprint';
  };

  const [activeSection, setActiveSection] = useState<'blueprint' | 'characters' | 'world' | 'specs'>(
    resolveSection(defaultTab)
  );

  useEffect(() => {
    if (defaultTab) {
      setActiveSection(resolveSection(defaultTab));
    }
  }, [defaultTab]);

  // Selected character ID for quick focus
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);

  // Character creation drawer / modal state
  const [isAddingChar, setIsAddingChar] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharBio,setNewCharBio]=useState('');
  const [newCharVoice, setNewCharVoice] = useState('');
  const [newCharDesire, setNewCharDesire] = useState('');
  const [newCharNeed, setNewCharNeed] = useState('');

  // Fact creation state
  const [isAddingFact, setIsAddingFact] = useState(false);
  const [newFactTag, setNewFactTag] = useState('故事设定');
  const [newCharScopeId,setNewCharScopeId]=useState('');
  const [newFactScopeId,setNewFactScopeId]=useState('');
  const [newFactContent, setNewFactContent] = useState('');
  const scopes=scopeOptions(project);
  const defaultScopeId=['anthology','procedural'].includes(project.profile.continuity) ? project.units.find(unit=>unit.id===activeUnitId)?.scopeId || project.units[0]?.scopeId || project.id : project.id;


  // Handle adding new character
  const handleSaveNewCharacter = () => {
    if (!newCharName.trim()) {
      toast.error('请输入角色姓名');
      return;
    }
    const newChar: Character = {
      id: newId('char'),
      name: newCharName.trim(),
      bio:newCharBio.trim(),
      scopeId: newCharScopeId || defaultScopeId,
      desire: newCharDesire.trim(),
      need: newCharNeed.trim(),
      contradiction: '',
      arc: '',
      voice: newCharVoice.trim(),
    };

    onUpdateProject((p) => {
      p.characters.push(newChar);
    });

    setNewCharName('');setNewCharBio('');
    setNewCharVoice('');
    setNewCharDesire('');
    setNewCharNeed('');
    setNewCharScopeId('');
    setIsAddingChar(false);
    setSelectedCharId(newChar.id);
    toast.success(`角色「${newChar.name}」已添加`);
  };

  const handleDeleteCharacter = (charId: string, charName: string) => {
    const used=project.units.some(unit=>unit.scenes.some(scene=>scene.characterIds.includes(charId)||scene.blocks.some(block=>block.speakerId===charId))) || (project.continuityTracks||[]).some(track=>track.characterIds.includes(charId));
    if(used){toast.error('此人物已被场景或连续性记录引用，请先处理引用。');return;}
    if (window.confirm(`确定删除角色「${charName}」？`)) {
      onUpdateProject((p) => {
        p.characters = p.characters.filter((c) => c.id !== charId);
      });
      if (selectedCharId === charId) setSelectedCharId(null);
      toast.success(`已删除角色「${charName}」`);
    }
  };

  // Handle Fact Operations
  const handleSaveNewFact = () => {
    if (!newFactContent.trim()) {
      toast.error('请输入设定规则内容');
      return;
    }
    const fullText = serializeFact(newFactTag, newFactContent);
    onUpdateProject((p) => {
      p.facts.push({
        id: newId('fact'),
        text: fullText,
        scopeId: newFactScopeId || defaultScopeId,
        status: 'approved',
      });
    });
    setNewFactTag('故事设定');
    setNewFactContent('');
    setNewFactScopeId('');
    setIsAddingFact(false);
    toast.success('世界观设定已添加');
  };

  const handleUpdateFact = (factId: string, newTag: string, newContent: string) => {
    onUpdateProject((p) => {
      const f = p.facts.find((x) => x.id === factId);
      if (f) {
        f.text = serializeFact(newTag, newContent);
      }
    });
  };

  const handleDeleteFact = (factId: string) => {
    if (window.confirm('确定删除这条故事设定？')) {
      onUpdateProject((p) => {
        p.facts = p.facts.filter((x) => x.id !== factId);
      });
      toast.success('已删除设定');
    }
  };

  // This is only an inventory of reference material, never a quality score.
  const healthChecks = [
    {
      title: '作品形式与篇幅',
      status: Boolean(project.profile.workType && project.profile.genres.length > 0),
      desc: `${project.profile.workType} · ${project.profile.genres.join('/') || '未填标签'}`,
    },
    {
      title: '故事想法',
      status: Boolean(project.brief.concept?.trim()),
      desc: project.brief.concept?.trim() ? '已有文字' : '可以边写边补',
    },
    {
      title: '主题与冲突',
      status: Boolean(project.brief.theme?.trim()),
      desc: project.brief.theme?.trim() ? '已有文字' : '可以留空',
    },
    {
      title: '人物资料',
      status: project.characters.length > 0,
      desc: `已有 ${project.characters.length} 位角色`,
    },
    {
      title: '故事设定',
      status: project.facts.length >= 1,
      desc: `已有 ${project.facts.length} 条设定`,
    },

  ];

  const completedCount = healthChecks.filter((c) => c.status).length;
  const healthScore = Math.round((completedCount / healthChecks.length) * 100);

  return (
    <div className="script-blueprint-layout flex-1 h-full flex overflow-hidden select-none bg-bg-primary relative">
      {/* ========================================================= */}
      {/* 1. LEFT SIDEBAR (w-64): BLUEPRINT DIRECTORY               */}
      {/* ========================================================= */}
      <aside className="script-blueprint-nav w-52 h-full flex flex-col bg-bg-surface border-r border-border-primary/20 shrink-0 select-none">
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-border-primary/10">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span className="font-bold text-text-primary flex items-center gap-1.5">
              <Compass size={13} className="text-text-secondary" />
              <span>全案蓝图设定</span>
            </span>
            <span className="text-[11px] font-mono text-text-secondary font-medium">
              当前稿
            </span>
          </div>
          <div className="text-[11px] text-text-muted flex items-center justify-between">
            <span>{project.profile.workType}</span>
            <span className="text-text-secondary">
              {project.characters.length} 角色 · {project.facts.length} 条设定
            </span>
          </div>
        </div>

        {/* Directory Navigation Items */}
        <div className="script-blueprint-directory flex-1 overflow-y-auto p-2 space-y-1">
          {/* Section 1: Master Blueprint */}
          <button
            type="button"
            onClick={() => setActiveSection('blueprint')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
              activeSection === 'blueprint'
                ? 'bg-bg-surface text-text-primary font-semibold border border-border-primary/40 shadow-xs'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={14} className={activeSection === 'blueprint' ? 'text-text-primary' : 'text-text-muted'} />
              <div className="truncate">
                <div className="leading-tight">创作方向与概览</div>
                <div className="text-[10px] text-text-muted font-normal mt-0.5">构想 · 风格 · 要求</div>
              </div>
            </div>
            <ChevronRight size={13} className="opacity-40" />
          </button>

          {/* Section 2: Characters */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setActiveSection('characters')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                activeSection === 'characters'
                  ? 'bg-bg-surface text-text-primary font-semibold border border-border-primary/40 shadow-xs'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Users size={14} className={activeSection === 'characters' ? 'text-text-primary' : 'text-text-muted'} />
                <div className="truncate">
                  <div className="leading-tight">人物资料</div>
                  <div className="text-[10px] text-text-muted font-normal mt-0.5">身份 · 动机 · 表达</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface-soft text-text-muted border border-border-primary/20">
                {project.characters.length}
              </span>
            </button>
          </div>

          {/* Section 3: World Lore & Rules */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setActiveSection('world')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                activeSection === 'world'
                  ? 'bg-bg-surface text-text-primary font-semibold border border-border-primary/40 shadow-xs'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen size={14} className={activeSection === 'world' ? 'text-text-primary' : 'text-text-muted'} />
                <div className="truncate">
                  <div className="leading-tight">故事设定</div>
                  <div className="text-[10px] text-text-muted font-normal mt-0.5">地点 · 关系 · 背景</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-bg-surface-soft text-text-muted border border-border-primary/20">
                {project.facts.length}
              </span>
            </button>
          </div>

          {/* Section 4: Specifications */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setActiveSection('specs')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                activeSection === 'specs'
                  ? 'bg-bg-surface text-text-primary font-semibold border border-border-primary/40 shadow-xs'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sliders size={14} className={activeSection === 'specs' ? 'text-text-primary' : 'text-text-muted'} />
                <div className="truncate">
                  <div className="leading-tight">作品形式与篇幅</div>
                  <div className="text-[10px] text-text-muted font-normal mt-0.5">形式 · 题材 · 篇幅</div>
                </div>
              </div>
              <ChevronRight size={13} className="opacity-40" />
            </button>
          </div>
        </div>

        {/* Sidebar Footer: Jump to Story Outline */}
        {onSwitchToOutline && (
          <div className="p-3 border-t border-border-primary/10 bg-bg-surface-soft/40">
            <button
              type="button"
              onClick={onSwitchToOutline}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all shadow-xs cursor-pointer"
            >
              <BookOpen size={13} />
              <span>进入故事大纲</span>
            </button>
          </div>
        )}
        <details className="px-3 py-3 text-xs border-t border-border-primary/20"><summary>资料填写 {completedCount}/{healthChecks.length}</summary><p className="text-text-secondary my-2">仅供参考，不必填满才能写作。</p>{healthChecks.map(item=><p key={item.title} className="py-1">{item.status?'已有':'留空'} · {item.title}</p>)}</details>
      </aside>

      {/* ========================================================= */}
      {/* 2. MIDDLE CONTENT (flex-1): BLUEPRINT EDITING CANVAS     */}
      {/* ========================================================= */}
      <div className="script-blueprint-content flex-1 min-w-0 min-h-0 h-full overflow-y-auto p-6 md:p-8 flex justify-center bg-bg-primary/95">
        <div className="w-full max-w-3xl space-y-6">

          {/* SECTION A: MASTER BLUEPRINT */}
          {activeSection === 'blueprint' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Header Title Banner */}
              <div className="flex flex-wrap gap-3 items-center justify-between pb-3 border-b border-border-primary/20">
                <div>
                  <h1 className="text-base font-bold text-text-primary">
                    《{project.title}》· 故事资料与创作目标
                  </h1>
                  <p className="text-xs text-text-muted mt-1">
                    记录故事想法、人物和设定，写作时可以随时补充
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/25">
                  {project.profile.workType}
                </span>
              </div>

              {/* Logline Card */}
              <div className="p-4 rounded-lg bg-bg-surface border border-border-primary/30 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <FileText size={14} className="text-text-secondary" />
                    <span>故事想法与前提</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onRequestTask('concept')}
                    className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                    title="基于已有想法提出可选择的故事前提"
                   aria-label="基于已有想法提出可选择的故事前提"><Sparkles size={16} /></button>
                </div>
                <ScriptLongText
                  aria-label="故事想法与前提"
                  value={project.brief.concept}
                  onChange={(e) =>
                    onUpdateProject((p) => {
                      p.brief.concept = e.target.value;
                    })
                  }
                  placeholder="用一两句话写下想讲的人、事或处境，也可以先留空…"
                  rows={4}
                  className="w-full text-xs p-3 rounded-xl bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/60"
                />
              </div>

              {/* Central Dilemma Card */}
              <div className="p-4 rounded-lg bg-bg-surface border border-border-primary/30 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                    <Flame size={14} className="text-text-muted" />
                    <span>主题与核心问题</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onRequestTask('theme')}
                    className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                    title="根据故事想法提出不同的推进方向"
                   aria-label="根据故事想法提出不同的推进方向"><Sparkles size={16} /></button>
                </div>
                <ScriptLongText
                  aria-label="主题与核心问题"
                  value={project.brief.theme}
                  onChange={(e) =>
                    onUpdateProject((p) => {
                      p.brief.theme = e.target.value;
                    })
                  }
                  placeholder="作品想探讨什么问题？可以暂定，也不必预先得出结论。"
                  rows={4}
                  className="w-full text-xs p-3 rounded-xl bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/60"
                />
              </div>

              {([{key:'audienceExperience',label:'风格与观众感受',placeholder:'希望观众感受到什么？例如轻松、紧张、温暖；可由 AI 先拟定。'},
                {key:'constraints',label:'作者要求与暂定事项',placeholder:'已明确的保留或避免事项，以及尚待确认的形式与篇幅。没有特殊要求可留空。'}] as const).map(field=>(
                <section key={field.key} className="space-y-2 py-3 border-b border-border-primary/20">
                  <div className="flex items-center justify-between"><label htmlFor={`blueprint-${field.key}`} className="text-xs font-semibold text-text-primary">{field.label}</label>
                    <button type="button" title={`与 AI 讨论${field.label}`} aria-label={`与 AI 讨论${field.label}`} onClick={()=>onRequestTask('consult',`请根据已有蓝图，整理一版${field.label}候选供我审阅采用。保留已确定的要求；建议或假设明确标注，不自行添加限制。`)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover"><Sparkles size={16}/></button></div>
                  <ScriptLongText id={`blueprint-${field.key}`} value={project.brief[field.key]} onChange={event=>onUpdateProject(draft=>{draft.brief[field.key]=event.target.value;})} placeholder={field.placeholder} rows={3} className="w-full text-xs p-3 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:outline-none leading-relaxed"/>
                </section>
              ))}
              <p className="text-xs text-text-muted">当前规格：{project.profile.workType} · {project.profile.organization==='episodic'?`${project.profile.plannedUnits} 集，每集`:'全片'} {project.profile.targetDurationMs/60000} 分钟。<button type="button" onClick={()=>setActiveSection('specs')} className="underline ml-1">查看或调整</button></p>

              {/* Master Outline Bridge Card */}
              <div className="p-4 rounded-lg bg-bg-surface border border-border-primary/30 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-text-secondary" />
                    <span className="text-xs font-semibold text-text-primary">
                      故事总纲与分集大纲
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface-soft text-text-muted border border-border-primary/20">
                      {project.brief.outline?.replace(/\s/g, '').length || 0} 字
                    </span>
                  </div>

                  {onSwitchToOutline && (
                    <button
                      type="button"
                      onClick={onSwitchToOutline}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-all cursor-pointer shadow-xs"
                      title="整理故事总纲和分集大纲"
                    >
                      <span>进入故事大纲</span>
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-text-muted leading-relaxed">
                  在故事大纲中整理全篇走向和各集内容，再按需拆成场景；也可以直接开始写正文。
                </p>

                {project.brief.outline?.trim() ? (
                  <div className="p-3.5 rounded-xl bg-bg-surface-soft/80 border border-border-primary/20 text-xs text-text-secondary font-sans leading-relaxed line-clamp-4">
                    {project.brief.outline}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-bg-surface-soft/40 border border-dashed border-border-primary/30 text-center text-xs text-text-muted space-y-2">
                    <p>还没有故事总纲。可以自己填写，或请 AI 根据已有想法提出建议。</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION B: CHARACTERS */}
          {activeSection === 'characters' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="flex flex-wrap gap-3 items-center justify-between pb-3 border-b border-border-primary/20">
                <div>
                  <h1 className="text-base font-bold text-text-primary">
                    人物资料 ({project.characters.length})
                  </h1>
                  <p className="text-xs text-text-muted mt-1">
                    记录人物怎样行动、说话，以及他们在故事中与谁有关。未确定的信息可以留空。
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRequestTask('character')}
                    className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                   title="与 AI 讨论人物" aria-label="与 AI 讨论人物"><Sparkles size={16} /></button>
                  <button
                    type="button"
                    onClick={() => setIsAddingChar(true)}
                    className="flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-colors shadow-xs cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>添加人物</span>
                  </button>
                </div>
              </div>

              {/* Add New Character Card */}
              {isAddingChar && (
                <div className="p-4 rounded-lg bg-bg-surface border border-border-primary/40 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-border-primary/20">
                    <span className="text-xs font-semibold text-text-primary">添加新人物小传</span>
                    <button
                      type="button"
                      onClick={() => setIsAddingChar(false)}
                      className="text-text-muted hover:text-text-primary text-xs cursor-pointer"
                    >
                      取消
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-text-muted mb-1">
                        角色姓名
                      </label>
                      <input
                        type="text"
                        autoFocus
                        value={newCharName}
                        onChange={(e) => setNewCharName(e.target.value)}
                        placeholder="例如：林墨"
                        className="w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-text-muted mb-1">
                        说话方式与表演提示
                      </label>
                      <input
                        type="text"
                        value={newCharVoice}
                        onChange={(e) => setNewCharVoice(e.target.value)}
                        placeholder="例如：表面玩世不恭，语速快，暗藏试探"
                        className="w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none"
                      />
                    </div>
                  </div>

                  <label className="block text-[11px] text-text-muted">人物简介 · 可选
                    <ScriptLongText value={newCharBio} onChange={event=>setNewCharBio(event.target.value)} placeholder="身份、处境及影响当前选择的经历，简要写一段即可。" rows={3} className="mt-1 w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30"/>
                  </label>
                  <label className="block text-[11px] text-text-muted">适用故事范围
                    <select value={newCharScopeId||defaultScopeId} onChange={event=>setNewCharScopeId(event.target.value)} className="block mt-1 w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 text-text-primary">{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-text-muted mb-1">
                        人物目标 · 可选
                      </label>
                      <ScriptLongText
                        value={newCharDesire}
                        onChange={(e) => setNewCharDesire(e.target.value)}
                        placeholder="人物此刻想做什么或得到什么？"
                        rows={4}
                        className="w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-text-muted mb-1">
                        内在需要 · 可选
                      </label>
                      <ScriptLongText
                        value={newCharNeed}
                        onChange={(e) => setNewCharNeed(e.target.value)}
                        placeholder="人物希望得到什么？可以暂时留空"
                        rows={4}
                        className="w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => onRequestTask('character')}
                      className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                     title="与 AI 讨论人物" aria-label="与 AI 讨论人物"><Sparkles size={16} /></button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsAddingChar(false)}
                        className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveNewCharacter}
                        className="px-4 py-1.5 text-xs font-medium rounded-lg bg-text-primary text-bg-surface hover:opacity-90 transition-colors cursor-pointer"
                      >
                        保存人物
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Characters Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {project.characters.map((char) => {
                  const isFocused = selectedCharId === char.id;
                  return (
                    <div
                      key={char.id}
                      className={`p-4 rounded-lg bg-bg-surface border shadow-xs transition-all space-y-3 flex flex-col justify-between ${
                        isFocused
                          ? 'border-border-primary/60 ring-1 ring-border-primary/40 shadow-xs'
                          : 'border-border-primary/30 hover:border-border-primary/50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between pb-2 border-b border-border-primary/10">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-bg-surface-soft text-text-secondary border border-border-primary/30 flex items-center justify-center font-bold text-xs">
                              {char.name.slice(0, 1)}
                            </div>
                            <div>
                              <input
                                type="text"
                                value={char.name}
                                onChange={(e) =>
                                  onUpdateProject((p) => {
                                    const c = p.characters.find((x) => x.id === char.id);
                                    if (c) c.name = e.target.value;
                                  })
                                }
                                className="font-bold text-sm bg-transparent text-text-primary focus:outline-none border-b border-transparent focus:border-border-primary/60 px-0.5"
                              />
                              <div className="text-[10px] text-text-muted">
                                {char.bio?'已有简介':'人物资料'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onRequestTask('consult',`请根据已有故事，完善人物「${char.name}」的资料，给出简洁的修改候选供我采用。保留已确定内容，只修改需要调整的字段，不新增同名人物。`,{kind:'character',id:char.id});
                              }}
                              className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                              title="与 AI 完善人物资料"
                             aria-label="与 AI 完善人物资料"><Sparkles size={16} /></button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCharacter(char.id, char.name)}
                              className="p-1.5 rounded-lg text-text-muted hover:text-accent-red hover:bg-bg-surface-soft transition-colors cursor-pointer"
                              title="删除角色"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-2 text-xs">
                          <label className="block text-[10px] font-semibold text-text-muted">适用故事范围
                            <select value={char.scopeId} onChange={event=>{
                              const target=event.target.value;
                              if((project.continuityTracks||[]).some(track=>track.characterIds.includes(char.id))){toast.error('此人物已用于连续性记录，请先处理该记录再调整范围。');return;}
                              const outside=project.units.some(unit=>!visibleInUnit(target,project,unit)&&unit.scenes.some(scene=>scene.characterIds.includes(char.id)||scene.blocks.some(block=>block.speakerId===char.id)));
                              if(outside){toast.error('此人物已在目标范围以外的场景登场，请先调整场景引用。');return;}
                              onUpdateProject(draft=>{const current=draft.characters.find(item=>item.id===char.id);if(current)current.scopeId=target;});
                            }} className="block mt-1 w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 text-text-primary">{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select>
                          </label>
                          {([{key:'bio',label:'人物简介',hint:'身份、处境及与故事有关的经历。'},
                            {key:'desire',label:'人物目标',hint:'此刻想做什么或得到什么？'},
                            {key:'voice',label:'说话方式',hint:'语气、用词或表达习惯。'},
                            {key:'need',label:'内在需要 · 可选',hint:'尚未意识到的需要，不适用可留空。'},
                            {key:'contradiction',label:'人物矛盾 · 可选',hint:'愿望、立场或行为之间的矛盾。'},
                            {key:'arc',label:'变化方向 · 可选',hint:'可以成长、退步、反复或保持稳定。'}] as const).map(field=>(
                            <label key={field.key} className="block text-[10px] font-semibold text-text-muted">{field.label}
                              <ScriptLongText aria-label={`${char.name} · ${field.label}`} value={char[field.key]||''} onChange={event=>onUpdateProject(draft=>{const current=draft.characters.find(item=>item.id===char.id);if(current)current[field.key]=event.target.value;})} placeholder={field.hint} rows={field.key==='bio'?3:2} className="mt-1 w-full text-xs font-normal p-2 rounded-lg bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/60 focus:outline-none leading-relaxed text-text-secondary"/>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!project.characters.length && !isAddingChar && (
                  <div className="col-span-full p-8 text-center rounded-2xl bg-bg-surface border border-dashed border-border-primary/30 space-y-2">
                    <Users size={28} className="mx-auto text-text-muted/60" />
                    <div className="text-xs text-text-secondary font-medium">暂无人物档案</div>
                    <p className="text-[11px] text-text-muted">
                      可以手动添加人物，也可以先写正文，出现新名字时再登记。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION C: WORLD LORE & RULES (CARD-BASED GALLERY) */}
          {activeSection === 'world' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="flex flex-wrap gap-3 items-center justify-between pb-3 border-b border-border-primary/20">
                <div>
                  <h1 className="text-base font-bold text-text-primary">
                    故事设定 ({project.facts.length})
                  </h1>
                  <p className="text-xs text-text-muted mt-1">
                    记录地点、关系、规则和事件，并标明哪些已经确认。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRequestTask('fact')}
                    className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                   title="与 AI 讨论设定" aria-label="与 AI 讨论设定"><Sparkles size={16} /></button>
                  <button
                    type="button"
                    onClick={() => setIsAddingFact(true)}
                    className="flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 transition-colors shadow-xs cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>添加设定</span>
                  </button>
                </div>
              </div>

              {/* Add New Fact Drawer Card */}
              {isAddingFact && (
                <div className="p-4 rounded-lg bg-bg-surface border border-border-primary/40 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-border-primary/20">
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                      <ShieldAlert size={14} className="text-text-muted" />
                      <span>新增故事设定</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingFact(false)}
                      className="text-text-muted hover:text-text-primary text-xs cursor-pointer"
                    >
                      取消
                    </button>
                  </div>

                  {/* Preset Tag Chips */}
                  <div>
                    <label className="block text-[11px] font-medium text-text-muted mb-1.5">
                      选择设定维度或自定义标签：
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {PRESET_FACT_TAGS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setNewFactTag(preset.label)}
                          className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 transition-all cursor-pointer ${
                            newFactTag === preset.label
                              ? 'bg-bg-surface text-text-primary border border-border-primary/50 font-medium shadow-xs'
                              : 'bg-bg-surface-soft text-text-muted hover:text-text-secondary border border-border-primary/20'
                          }`}
                        >
                          <span>{preset.icon}</span>
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">当前标签：</span>
                      <input
                        type="text"
                        value={newFactTag}
                        onChange={(e) => setNewFactTag(e.target.value)}
                        placeholder="自定义标签名称"
                        className="text-xs px-2.5 py-1 rounded-lg bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none w-36 text-text-primary font-medium"
                      />
                    </div>
                  </div>

                  {/* Fact Content Textarea */}
                  <label className="block text-[11px] text-text-muted">适用故事范围
                    <select value={newFactScopeId||defaultScopeId} onChange={event=>setNewFactScopeId(event.target.value)} className="block mt-1 w-full text-xs p-2 rounded-lg bg-bg-surface-soft border border-border-primary/30 text-text-primary">{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select>
                  </label>
                  <div>
                    <label className="block text-[11px] font-medium text-text-muted mb-1">
                      设定内容：
                    </label>
                    <ScriptLongText
                      value={newFactContent}
                      onChange={(e) => setNewFactContent(e.target.value)}
                      placeholder="例如：渡口每晚十点停航；母亲和女儿多年没有见面。"
                      rows={3}
                      className="w-full text-xs p-3 rounded-xl bg-bg-surface-soft border border-border-primary/30 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/60"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => onRequestTask('fact')}
                      className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                     title="与 AI 讨论设定" aria-label="与 AI 讨论设定"><Sparkles size={16} /></button>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsAddingFact(false)}
                        className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveNewFact}
                        className="px-4 py-1.5 text-xs font-medium rounded-lg bg-text-primary text-bg-surface hover:opacity-90 transition-colors cursor-pointer"
                      >
                        保存设定
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Facts Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {project.facts.map((fact, fIdx) => {
                  const { tag, content } = parseFact(fact.text);
                  return (
                    <div
                      key={fact.id}
                      className="p-4 rounded-lg bg-bg-surface border border-border-primary/30 shadow-xs hover:border-border-primary/50 transition-all flex flex-col justify-between space-y-3 group"
                    >
                      <div>
                        {/* Card Top: Number, Tag Pill, Delete */}
                        <div className="flex items-center justify-between pb-2.5 border-b border-border-primary/10">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-bg-surface-soft text-text-secondary border border-border-primary/30 flex items-center justify-center font-mono font-bold text-[10px]">
                              #{fIdx + 1}
                            </span>
                            <div className="flex items-center gap-0.5 bg-bg-surface-soft px-2 py-0.5 rounded-lg border border-border-primary/20 text-xs">
                              <span className="text-[10px] text-text-muted">【</span>
                              <input
                                type="text"
                                value={tag}
                                onChange={(e) => handleUpdateFact(fact.id, e.target.value, content)}
                                placeholder="类别标签"
                                className="bg-transparent text-text-primary font-semibold text-xs focus:outline-none w-28"
                              />
                              <span className="text-[10px] text-text-muted">】</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onRequestTask('consult',`请基于已有故事，完善这条设定【${tag}】：${content}。生成针对原设定的修改候选供我审阅采用，不新增重复设定，保留原确认状态。`,{kind:'fact',id:fact.id});
                              }}
                              className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
                              title="与 AI 完善这条设定"
                             aria-label="与 AI 完善这条设定"><Sparkles size={16} /></button>
                            <button
                              type="button"
                              onClick={() => handleDeleteFact(fact.id)}
                              className="p-1.5 rounded-lg text-text-muted hover:text-accent-red hover:bg-bg-surface-soft transition-colors cursor-pointer"
                              title="删除设定"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Card Content Textarea */}
                        <div className="pt-2">
                          <label className="text-[10px] font-semibold text-text-muted block mb-1">
                            设定内容：
                          </label>
                          <ScriptLongText
                            value={content}
                            onChange={(e) => handleUpdateFact(fact.id, tag, e.target.value)}
                            placeholder="写下已经确定的事实或待确认的设想"
                            rows={4}
                            className="w-full text-xs p-2.5 rounded-xl bg-bg-surface-soft border border-border-primary/20 focus:border-border-primary/60 focus:outline-none resize-none leading-relaxed text-text-primary placeholder:text-text-muted/60"
                          />
                        </div>
                      </div>

                      {/* Card Footer: Metadata */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-muted pt-2 border-t border-border-primary/10">
                        <span className="flex items-center gap-1 text-text-muted">
                          <ShieldAlert size={11} />
                          <span>故事设定</span>
                        </span>
                        <select aria-label={`设定 ${fIdx+1} 的适用范围`} value={fact.scopeId} onChange={event=>onUpdateProject(draft=>{const current=draft.facts.find(item=>item.id===fact.id);if(current)current.scopeId=event.target.value;})} className="rounded border border-border-primary/20 bg-bg-surface-soft px-1 py-0.5 text-text-secondary">{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select>
                        <select aria-label={`设定 ${fIdx+1} 的确认状态`} value={fact.status} onChange={event=>onUpdateProject(draft=>{const current=draft.facts.find(item=>item.id===fact.id);if(current)current.status=event.target.value as 'draft'|'approved';})} className="rounded border border-border-primary/20 bg-bg-surface-soft px-1 py-0.5 text-text-secondary"><option value="draft">待确认</option><option value="approved">已确认</option></select>
                        <span className="font-mono opacity-60">
                          {content.length} 字
                        </span>
                      </div>
                    </div>
                  );
                })}

                {!project.facts.length && !isAddingFact && (
                  <div className="col-span-full p-8 text-center rounded-2xl bg-bg-surface border border-dashed border-border-primary/30 space-y-2">
                    <BookOpen size={28} className="mx-auto text-text-muted/60" />
                    <div className="text-xs text-text-secondary font-medium">暂无故事设定</div>
                    <p className="text-[11px] text-text-muted">
                      可以记录地点、关系、规则或事件。AI 建议会先作为待确认草稿。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION D: SPECIFICATIONS */}
          {activeSection === 'specs' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <label className="block text-xs text-text-secondary">作品名称<input aria-label="作品名称" value={project.title} onChange={event=>onUpdateProject(draft=>{draft.title=event.target.value;})} className="block mt-2 w-full rounded-lg bg-bg-surface-soft border border-border-primary/30 p-3 text-text-primary"/></label>
              <div className="flex flex-wrap gap-3 items-center justify-between pb-3 border-b border-border-primary/20">
                <div>
                  <h1 className="text-base font-bold text-text-primary">
                    作品形式与篇幅
                  </h1>
                  <p className="text-xs text-text-muted mt-1">
                    配置交付形态、连续性、计划体量与时长。题材和创作方法可独立选择。
                  </p>
                </div>
              </div>

              {/* Explain the organization without prescribing a writing formula. */}
              <div className="p-4 rounded-lg bg-bg-surface-soft border border-border-primary/30 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                  <Lightbulb size={14} className="text-text-muted" />
                  <span>作品组织方式</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  单部作品按全片组织，分集作品按集组织。计划集数与已经写出的集数分开记录；时长是创作目标，不代表已测得的成片时长。
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-bg-surface border border-border-primary/30 shadow-xs space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Work type is a label, not a hidden preset. */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">作品类型名称</label>
                    <input
                      type="text"
                      value={project.profile.workType}
                      onChange={(e) => onUpdateProject((p) => { p.profile.workType = e.target.value; })}
                      placeholder="例如电影短片、连续剧、微短剧"
                      className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary font-medium text-xs focus:outline-none focus:border-border-primary/60 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">组织方式</label>
                    <select value={project.profile.organization} onChange={(e) => onUpdateProject((p) => {
                      p.profile.organization = e.target.value as 'standalone' | 'episodic';
                      if (p.profile.organization === 'standalone') p.profile.plannedUnits = 1;
                    })} className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60">
                      <option value="standalone" disabled={project.units.length > 1}>单部作品</option>
                      <option value="episodic">分集作品</option>
                    </select>
                    {project.units.length > 1 && <p className="text-[11px] text-text-muted">已有多集内容，不能直接改为单部。</p>}
                  </div>

                  {project.profile.organization==='episodic' && (<div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">跨集关系</label>
                    <select value={project.profile.continuity} onChange={(e) => {
                      const mode=e.target.value as typeof project.profile.continuity;
                      if(project.units.length>1&&!window.confirm(mode==='serialized'?'将现有单元归入同一故事范围，原本只属于单集的人物与设定会扩展为全剧共用。确定吗？':'将现有单元改为各自的故事范围。全剧共用的人物与设定仍然共用，可在资料页逐项调整。确定吗？'))return;
                      onUpdateProject(draft=>setProjectContinuity(draft,mode));
                      setNewCharScopeId('');setNewFactScopeId('');
                    }} className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60">
                      <option value="serialized">连续故事</option>
                      <option value="procedural">常驻人物，单集故事</option>
                      <option value="anthology">独立故事合集</option>
                      <option value="mixed">混合结构</option>
                    </select>
                  </div>)}

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">{project.profile.organization === 'standalone' ? '全片目标时长（分钟）' : '默认每集目标时长（分钟）'}</label>
                    <input type="number" min={0.5} max={600} step={0.5} value={project.profile.targetDurationMs / 60000} onChange={(e) => {
                      const minutes = Number(e.target.value);
                      if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 600) return;
                      onUpdateProject((p) => {
                        const previous = p.profile.targetDurationMs;
                        const next = Math.round(minutes * 60000);
                        p.profile.targetDurationMs = next;
                        p.profile.toleranceMs = Math.min(p.profile.toleranceMs, next);
                        p.units.forEach(unit => { if (unit.targetDurationMs === previous) unit.targetDurationMs = next; });
                      });
                    }} className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60" />
                  </div>

                  {/* Genres */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">题材标签 (斜杠分隔)</label>
                    <input
                      type="text"
                      value={project.profile.genres.join(' / ')}
                      onChange={(e) => {
                        const val = e.target.value;
                        onUpdateProject((p) => {
                          p.profile.genres = val.split(/[/,，、]/).map(s => s.trim()).filter(Boolean);
                        });
                      }}
                      placeholder="例如：科幻 / 悬疑 / 哲学"
                      className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60"
                    />
                  </div>

                  {/* Planned Units */}
                  {project.profile.organization === 'episodic' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-secondary">规划总集数</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={project.profile.plannedUnits || project.units.length || 1}
                        onChange={(e) => {
                          const val = Math.min(1000, Math.max(project.units.length, parseInt(e.target.value, 10) || 1));
                          onUpdateProject((p) => {
                            p.profile.plannedUnits = val;
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60"
                      />
                    </div>
                  )}
                </div>
                <details className="pt-3 border-t border-border-primary/20 text-xs"><summary className="cursor-pointer text-text-secondary">语言与制作设置（可选）</summary><div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                  {/* Aspect Ratio */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary">画幅规格</label>
                    <select
                      value={project.profile.aspectRatio || '16:9'}
                      onChange={(e) => {
                        const val = e.target.value as '16:9' | '9:16' | '1:1';
                        onUpdateProject((p) => {
                          p.profile.aspectRatio = val;
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-bg-surface-soft border border-border-primary/20 text-text-primary text-xs focus:outline-none focus:border-border-primary/60 cursor-pointer"
                    >
                      <option value="16:9">16:9 (横屏院线/主流长视频)</option>
                      <option value="9:16">9:16 (竖屏手机短剧/信息流)</option>
                      <option value="1:1">1:1 (通用社交媒介画幅)</option>
                    </select>
                  </div>

                  <label className="space-y-1.5 text-text-secondary">剧本语言<input aria-label="剧本语言" value={project.profile.language} onChange={event=>onUpdateProject(draft=>{draft.profile.language=event.target.value;})} className="block w-full p-2 rounded-lg bg-bg-surface-soft border border-border-primary/20"/></label>
                  <label className="space-y-1.5 text-text-secondary">制作方式<select aria-label="制作方式" value={project.profile.productionMode} onChange={event=>onUpdateProject(draft=>{draft.profile.productionMode=event.target.value as typeof draft.profile.productionMode;})} className="block w-full p-2 rounded-lg bg-bg-surface-soft border border-border-primary/20"><option value="live-action">真人实拍</option><option value="AI-video">AI 视频</option><option value="animation">动画</option><option value="hybrid">混合制作</option></select></label>
                </div></details>
              </div>
            </div>
          )}

        </div>
      </div>


    </div>
  );
}
