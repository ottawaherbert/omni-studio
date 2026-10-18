import React, { useState } from 'react';
import { X } from 'lucide-react';
import { durationBudgetForFormat } from '../../../domains/interactive/durationContract.ts';
import type { ExperienceSpec, InteractionFormatProfile, ProductionBoundary, StoryArchitecture, StoryChapter, StoryEpisode } from '../../../domains/interactive/types/schema.ts';

export interface InteractiveProjectSettingsValue {
  title: string;
  genre: string;
  formatProfile: InteractionFormatProfile;
  experienceSpec: ExperienceSpec;
  storyArchitecture: StoryArchitecture;
  productionBoundary: ProductionBoundary;
}

const input = 'mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60';
const action = 'rounded-xl border border-border-soft/40 px-3 py-2 text-xs font-bold text-text-secondary hover:border-gold/50';

export function InteractiveProjectSettingsInspector({ value, onSave, onClose }: {
  value: InteractiveProjectSettingsValue;
  onSave: (next: InteractiveProjectSettingsValue) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<InteractiveProjectSettingsValue>(() => {
    const copy = structuredClone(value);
    const episodeByChapter = new Map((copy.storyArchitecture.storyEpisodes || []).flatMap((episode) => episode.storyChapterIds.map((id) => [id, episode.id] as const)));
    copy.storyArchitecture.storyChapters = (copy.storyArchitecture.storyChapters || []).map((chapter) => ({
      ...chapter, episodeId: chapter.episodeId || episodeByChapter.get(chapter.id),
    }));
    return copy;
  });
  const [error, setError] = useState('');
  const format = draft.formatProfile;
  const spec = draft.experienceSpec;
  const architecture = draft.storyArchitecture;
  const boundary = draft.productionBoundary;
  const chapters = architecture.storyChapters || [];
  const episodes = architecture.storyEpisodes || [];
  const setFormat = (patch: Partial<InteractionFormatProfile>) => setDraft((current) => ({ ...current, formatProfile: { ...current.formatProfile, ...patch } }));
  const setSpec = (patch: Partial<ExperienceSpec>) => setDraft((current) => ({ ...current, experienceSpec: { ...current.experienceSpec, ...patch } }));
  const setArchitecture = (patch: Partial<StoryArchitecture>) => setDraft((current) => ({ ...current, storyArchitecture: { ...current.storyArchitecture, ...patch } }));
  const setBoundary = (patch: Partial<ProductionBoundary>) => setDraft((current) => ({ ...current, productionBoundary: { ...current.productionBoundary, ...patch } }));
  const setChapters = (next: StoryChapter[]) => setArchitecture({ storyChapters: next });
  const setEpisodes = (next: StoryEpisode[]) => setArchitecture({ storyEpisodes: next });
  const updateChapter = (id: string, patch: Partial<StoryChapter>) => setChapters(chapters.map((item) => item.id === id ? { ...item, ...patch } : item));
  const updateEpisode = (id: string, patch: Partial<StoryEpisode>) => setEpisodes(episodes.map((item) => item.id === id ? { ...item, ...patch } : item));
  const handleSave = () => {
    if (!draft.title.trim() || !draft.genre.trim() || !spec.playerRole.trim() || !spec.interactionPromise.trim()) return setError('请填写作品名、类型、玩家身份和互动承诺');
    if (format.targetSessionMinutes < 1 || format.targetCompleteMinutes < format.targetSessionMinutes) return setError('完整探索时长不能短于单次时长');
    if (chapters.some((item) => !item.title.trim() || item.targetDurationRangeSec[0] < 1 || item.targetDurationRangeSec[1] < item.targetDurationRangeSec[0])) return setError('请填写章节标题与有效时长');
    if (chapters.some((item) => item.episodeId && !episodes.some((episode) => episode.id === item.episodeId))) return setError('有章节指向已删除的分集，请重新指定所属集');
    const storyEpisodes = episodes.map((episode) => ({
      ...episode,
      storyChapterIds: chapters.filter((chapter) => chapter.episodeId === episode.id).map((chapter) => chapter.id),
    }));
    onSave({ ...draft, title: draft.title.trim(), genre: draft.genre.trim(), storyArchitecture: { ...architecture, storyEpisodes, durationBudget: durationBudgetForFormat({ ...architecture.durationBudget, maxSecondsWithoutChoice: spec.choiceCadence.maxMinutesWithoutChoice * 60 } as NonNullable<StoryArchitecture['durationBudget']>, format) } });
  };
  return <aside className="fixed top-14 bottom-0 right-0 z-40 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[420px]">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4"><h2 className="text-base font-extrabold">作品与故事设置</h2><button type="button" aria-label="关闭作品设置" onClick={onClose}><X className="h-5 w-5" /></button></header>
    <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
      <label className="block">作品名称<input aria-label="作品名称" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={input} /></label>
      <label className="block">故事类型<input aria-label="故事类型" value={draft.genre} onChange={(event) => setDraft({ ...draft, genre: event.target.value })} className={input} /></label>
      <div className="grid grid-cols-2 gap-2"><label>单次体验（分钟）<input aria-label="单次体验" type="number" min={1} value={format.targetSessionMinutes} onChange={(event) => setFormat({ targetSessionMinutes: Number(event.target.value) })} className={input} /></label><label>完整探索（分钟）<input aria-label="完整探索" type="number" min={1} value={format.targetCompleteMinutes} onChange={(event) => setFormat({ targetCompleteMinutes: Number(event.target.value) })} className={input} /></label></div>
      <div className="grid grid-cols-2 gap-2"><label>作品形式<select aria-label="作品形式" value={format.format} onChange={(event) => setFormat({ format: event.target.value as InteractionFormatProfile['format'] })} className={input}><option value="branching_fmv">互动影像</option><option value="interactive_series">互动剧集</option><option value="narrative_game">叙事游戏</option></select></label><label>画面比例<select aria-label="画面比例" value={format.aspectRatio} onChange={(event) => setFormat({ aspectRatio: event.target.value as InteractionFormatProfile['aspectRatio'] })} className={input}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></label></div>
      <details className="rounded-xl border border-border-soft/30 p-3"><summary className="cursor-pointer font-bold">玩家与故事承诺</summary><div className="mt-3 space-y-3">
        <label className="block">玩家身份<input value={spec.playerRole} onChange={(event) => setSpec({ playerRole: event.target.value })} className={input} /></label>
        <label className="block">玩家画像<input value={spec.playerPersona} onChange={(event) => setSpec({ playerPersona: event.target.value })} className={input} /></label>
        <label className="block">互动承诺<textarea value={spec.interactionPromise} onChange={(event) => setSpec({ interactionPromise: event.target.value })} className={input} /></label>
        <label className="block">故事前提<textarea value={architecture.premise} onChange={(event) => setArchitecture({ premise: event.target.value })} className={input} /></label>
        <label className="block">主角目标<input value={architecture.protagonistGoal} onChange={(event) => setArchitecture({ protagonistGoal: event.target.value })} className={input} /></label>
        <label className="block">主题问题<input value={architecture.thematicQuestion} onChange={(event) => setArchitecture({ thematicQuestion: event.target.value })} className={input} /></label>
        <label className="block">核心冲突<input value={spec.dramaticContract.centralConflict} onChange={(event) => setSpec({ dramaticContract: { ...spec.dramaticContract, centralConflict: event.target.value } })} className={input} /></label>
        <label className="block">主题<input value={spec.dramaticContract.theme} onChange={(event) => setSpec({ dramaticContract: { ...spec.dramaticContract, theme: event.target.value } })} className={input} /></label>
        <label className="block">玩家主要行动（每行一项）<textarea value={spec.coreVerbs.join('\n')} onChange={(event) => setSpec({ coreVerbs: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className={input} /></label>
      </div></details>
      <details className="rounded-xl border border-border-soft/30 p-3"><summary className="cursor-pointer font-bold">互动规模与策略</summary><div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2"><label>最大分支深度<input type="number" min={1} value={boundary.maxBranchDepth} onChange={(event) => setBoundary({ maxBranchDepth: Number(event.target.value) })} className={input} /></label><label>并行分支上限<input type="number" min={1} value={boundary.maxParallelBranches} onChange={(event) => setBoundary({ maxParallelBranches: Number(event.target.value) })} className={input} /></label></div>
        <label className="block">专属内容比例上限（%）<input type="number" min={0} max={100} value={boundary.exclusiveContentPercent} onChange={(event) => setBoundary({ exclusiveContentPercent: Number(event.target.value) })} className={input} /></label>
        <div className="grid grid-cols-2 gap-2"><label>每十分钟选择数<input type="number" min={0} value={spec.choiceCadence.targetChoicesPerTenMinutes} onChange={(event) => setSpec({ choiceCadence: { ...spec.choiceCadence, targetChoicesPerTenMinutes: Number(event.target.value) } })} className={input} /></label><label>最长无选择时间（分钟）<input type="number" min={1} value={spec.choiceCadence.maxMinutesWithoutChoice} onChange={(event) => setSpec({ choiceCadence: { ...spec.choiceCadence, maxMinutesWithoutChoice: Number(event.target.value) } })} className={input} /></label></div>
        <label className="block">失败处理<select value={spec.failStatePolicy} onChange={(event) => setSpec({ failStatePolicy: event.target.value as ExperienceSpec['failStatePolicy'] })} className={input}><option value="retry">重试</option><option value="rollback">回退</option><option value="checkpoint">回到存档点</option><option value="game_over">结束游玩</option></select></label>
        <label className="block">存档策略<select value={spec.savePolicy} onChange={(event) => setSpec({ savePolicy: event.target.value as ExperienceSpec['savePolicy'] })} className={input}><option value="auto_checkpoint">自动存档点</option><option value="manual_save">手动保存</option><option value="chapter_only">按章存档</option></select></label>
        <label className="block">限时选择辅助<select aria-label="限时选择辅助" value={spec.accessibilitySettings.timedChoiceOption} onChange={(event) => setSpec({ accessibilitySettings: { ...spec.accessibilitySettings, timedChoiceOption: event.target.value as ExperienceSpec['accessibilitySettings']['timedChoiceOption'] } })} className={input}><option value="standard">标准时间</option><option value="extended">加长时间</option><option value="infinite">不限时</option></select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={spec.accessibilitySettings.closedCaptions} onChange={(event) => setSpec({ accessibilitySettings: { ...spec.accessibilitySettings, closedCaptions: event.target.checked } })} />显示字幕</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={spec.accessibilitySettings.colorBlindSafe} onChange={(event) => setSpec({ accessibilitySettings: { ...spec.accessibilitySettings, colorBlindSafe: event.target.checked } })} />色彩辅助</label>
      </div></details>
      <details className="rounded-xl border border-border-soft/30 p-3" open><summary className="cursor-pointer font-bold">故事章节</summary><div className="mt-3 space-y-3">{chapters.map((chapter) => <div key={chapter.id} className="space-y-2 rounded-xl border border-border-soft/30 bg-bg-surface-soft/40 p-3"><div className="flex gap-2"><input aria-label="章节标题" value={chapter.title} onChange={(event) => updateChapter(chapter.id, { title: event.target.value })} className={input} /><button type="button" className={action} onClick={() => setArchitecture({ storyChapters: chapters.filter((item) => item.id !== chapter.id), storyBeats: (architecture.storyBeats || []).map((beat) => beat.storyChapterId === chapter.id ? { ...beat, storyChapterId: undefined } : beat) })}>删除</button></div><textarea aria-label="章节概要" value={chapter.summary} onChange={(event) => updateChapter(chapter.id, { summary: event.target.value })} className={input} /><div className="grid grid-cols-2 gap-2"><label>最短秒数<input type="number" min={1} value={chapter.targetDurationRangeSec[0]} onChange={(event) => updateChapter(chapter.id, { targetDurationRangeSec: [Number(event.target.value), chapter.targetDurationRangeSec[1]] })} className={input} /></label><label>最长秒数<input type="number" min={1} value={chapter.targetDurationRangeSec[1]} onChange={(event) => updateChapter(chapter.id, { targetDurationRangeSec: [chapter.targetDurationRangeSec[0], Number(event.target.value)] })} className={input} /></label></div>{episodes.length > 0 && <label>所属集<select value={chapter.episodeId || ''} onChange={(event) => updateChapter(chapter.id, { episodeId: event.target.value || undefined })} className={input}><option value="">不指定</option>{episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title}</option>)}</select></label>}</div>)}<button type="button" className={action} onClick={() => setChapters([...chapters, { id: `chapter_${crypto.randomUUID().slice(0, 8)}`, title: `第 ${chapters.length + 1} 章`, summary: '', storyBeatIds: [], targetDurationRangeSec: [60, 300], order: chapters.length + 1 }])}>添加章节</button></div></details>
      {format.format === 'interactive_series' && <details className="rounded-xl border border-border-soft/30 p-3"><summary className="cursor-pointer font-bold">分集</summary><div className="mt-3 space-y-2">{episodes.map((episode) => <div key={episode.id} className="flex gap-2"><input aria-label="分集标题" value={episode.title} onChange={(event) => updateEpisode(episode.id, { title: event.target.value })} className={input} /><button type="button" className={action} onClick={() => setEpisodes(episodes.filter((item) => item.id !== episode.id))}>删除</button></div>)}<button type="button" className={action} onClick={() => setEpisodes([...episodes, { id: `episode_${crypto.randomUUID().slice(0, 8)}`, title: `第 ${episodes.length + 1} 集`, storyChapterIds: [], order: episodes.length + 1 }])}>添加分集</button></div></details>}
      {error && <p role="alert" className="text-rose-500">{error}</p>}
    </div><footer className="border-t border-border-soft/30 p-4"><button type="button" onClick={handleSave} className="w-full rounded-xl bg-gold px-4 py-2.5 text-xs font-bold text-bg-primary hover:bg-gold-light">保存作品设置</button></footer>
  </aside>;
}
