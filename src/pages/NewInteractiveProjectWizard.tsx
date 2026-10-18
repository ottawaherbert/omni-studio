import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clapperboard, FileText, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';

import {
  interactiveClient,
  type ExperienceSpec,
  type InteractionFormatProfile,
  type InteractiveWritingProjectOption,
  type StoryArchitecture,
} from '../clients/interactiveProductionClient.ts';
import { interactiveAuthoringClient } from '../clients/interactiveAuthoringClient.ts';
import PromptEditorModal from '../components/PromptEditorModal.tsx';
import { creatorFacingInteractiveAiError } from '../features/interactive/creatorFacingAiError.ts';

const genreTemplates = [
  '悬疑惊悚',
  '都市情感',
  '科幻幻想',
  '动作生存',
  '古装仙侠',
  '悬疑探案',
  '喜剧冒险',
  '青春校园',
];

const scaleOptions = [
  { id: 'feature', label: '互动长片', detail: '单次约 90 分钟 · 完整探索约 240 分钟', sessionMinutes: 90, completeMinutes: 240 },
  { id: 'short', label: '短篇体验', detail: '单次约 20 分钟 · 完整探索约 60 分钟', sessionMinutes: 20, completeMinutes: 60 },
  { id: 'micro', label: '微短剧体验', detail: '单次约 5 分钟 · 完整探索约 15 分钟', sessionMinutes: 5, completeMinutes: 15 },
  { id: 'medium', label: '中篇剧场', detail: '单次约 45 分钟 · 完整探索约 120 分钟', sessionMinutes: 45, completeMinutes: 120 },
] as const;
type ExperienceScale = typeof scaleOptions[number]['id'] | 'custom';

export default function NewInteractiveProjectWizard() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState(genreTemplates[0]);
  const [isCustomGenre, setIsCustomGenre] = useState(false);
  const [customGenre, setCustomGenre] = useState('');
  const [creativeBrief, setCreativeBrief] = useState('');
  const [sourceMode, setSourceMode] = useState<'scratch' | 'bind_writing'>('scratch');
  const [writingProjectId, setWritingProjectId] = useState('');
  const [writingProjects, setWritingProjects] = useState<InteractiveWritingProjectOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [experienceScale, setExperienceScale] = useState<ExperienceScale>('feature');
  const [customSessionMinutes, setCustomSessionMinutes] = useState(30);
  const [customCompleteMinutes, setCustomCompleteMinutes] = useState(90);

  const currentGenre = (isCustomGenre ? customGenre : genre).trim();

  useEffect(() => {
    interactiveClient.listWritingProjects()
      .then(setWritingProjects)
      .catch(() => toast.error('暂时无法读取已有剧本'));
  }, []);

  const openCreatePrompt = () => {
    if (!title.trim()) return toast.error('先给作品起一个名字');
    if (!currentGenre) return toast.error('请输入或选择故事类型');
    if (!creativeBrief.trim() && sourceMode === 'scratch') return toast.error('用一两句话告诉 AI 你想创作什么');
    if (sourceMode === 'bind_writing' && !writingProjectId) return toast.error('请选择一个已有剧本');
    setIsPromptOpen(true);
  };

  const handleCreateManual = async () => {
    if (!title.trim()) return toast.error('先给作品起一个名字');
    if (!currentGenre) return toast.error('请输入或选择故事类型');
    if (sourceMode === 'bind_writing' && !writingProjectId) return toast.error('请选择一个已有剧本');
    setIsSubmitting(true);
    try {
      const aggregate = await interactiveClient.createExperience({
        ...experienceInput(),
        executionPolicy: 'guided',
        authoringPrompt: undefined,
      });
      navigate(`/interactive/experiences/${encodeURIComponent(aggregate.experience.id)}/graph`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '项目创建失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getScaleValues = () => {
    if (experienceScale === 'custom') {
      const session = Math.max(1, Number(customSessionMinutes) || 30);
      const complete = Math.max(session, Number(customCompleteMinutes) || 90);
      return {
        label: `自定义 (${session}/${complete}分)`,
        detail: `单次约 ${session} 分钟 · 完整探索约 ${complete} 分钟`,
        sessionMinutes: session,
        completeMinutes: complete,
        maxDepth: session <= 20 ? 10 : session <= 45 ? 20 : 40,
        exclusiveContentPercent: session <= 20 ? 30 : 50,
      };
    }
    const scale = scaleOptions.find((option) => option.id === experienceScale) || scaleOptions[0];
    return {
      label: scale.label,
      detail: scale.detail,
      sessionMinutes: scale.sessionMinutes,
      completeMinutes: scale.completeMinutes,
      maxDepth: scale.id === 'short' || scale.id === 'micro' ? 10 : 40,
      exclusiveContentPercent: scale.id === 'short' || scale.id === 'micro' ? 30 : 55,
    };
  };

  const experienceInput = (authoringPrompt?: string) => {
    const scale = getScaleValues();
    const finalGenre = currentGenre || '都市情感';
    const formatProfile: InteractionFormatProfile = {
      format: 'branching_fmv',
      aspectRatio: '16:9',
      platforms: ['web'],
      primaryLanguage: 'zh-CN',
      targetSessionMinutes: scale.sessionMinutes,
      targetCompleteMinutes: scale.completeMinutes,
    };
    const experienceSpec: ExperienceSpec = {
      playerRole: '故事中的关键行动者',
      playerPersona: '通过观察和选择推动故事的人',
      interactionPromise: '玩家的关键选择会改变人物关系、信息掌握和最终结局。',
      coreVerbs: ['观察', '选择', '行动'],
      dramaticContract: { genre: finalGenre, theme: '', centralConflict: creativeBrief.trim() },
      choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 6 },
      consequenceHorizon: ['immediate', 'delayed', 'ending'],
      failStatePolicy: 'rollback',
      savePolicy: 'auto_checkpoint',
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'standard', colorBlindSafe: true },
    };
    const storyArchitecture: StoryArchitecture = {
      premise: creativeBrief.trim(),
      protagonistGoal: '',
      thematicQuestion: '',
      mandatoryNodes: [],
      variableNodes: [],
      endings: [],
      branchBudget: {
        maxDepth: scale.maxDepth,
        maxParallelBranches: 5,
      },
      storyBeats: [],
      storyChapters: [],
      storyEpisodes: [],
      endingContracts: [],
      productionBlocks: [],
      durationBudget: {
        p50TargetSec: scale.sessionMinutes * 60,
        p90TargetSec: scale.completeMinutes * 60,
        maxSecondsWithoutChoice: 360,
        tolerancePercent: 20,
      },
    };
    return {
      title: title.trim(),
      genre: finalGenre,
      executionPolicy: 'autopilot' as const,
      authoringPrompt: authoringPrompt?.trim() || undefined,
      formatProfile,
      experienceSpec,
      storyArchitecture,
      storySource: { mode: sourceMode, writingProjectId: sourceMode === 'bind_writing' ? writingProjectId : undefined },
      productionBoundary: {
        maxBranchDepth: scale.maxDepth,
        maxParallelBranches: 5,
        exclusiveContentPercent: scale.exclusiveContentPercent,
        maxAutomaticRepairAttempts: 2,
      },
    };
  };

  const handleCreate = async (finalPrompt: string) => {
    setIsSubmitting(true);
    try {
      const aggregate = await interactiveClient.createExperience(experienceInput(finalPrompt));

      try {
        const draft = await interactiveAuthoringClient.createDraft(aggregate.experience.id, {
          action: 'initial',
          authorIntent: finalPrompt,
        });
        toast.success('AI 已搭好第一版，请审阅');
        navigate(`/interactive/experiences/${aggregate.experience.id}/graph?draftId=${encodeURIComponent(draft.id)}`);
      } catch (error) {
        toast.error(`项目已创建。${creatorFacingInteractiveAiError(error, 'AI 暂时没有完成第一版，可稍后在白板中重试。')}`);
        navigate(`/interactive/experiences/${aggregate.experience.id}/graph?aiRetry=1`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '项目创建失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-primary px-5 py-8 text-text-primary transition-colors duration-200 md:py-12">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => navigate('/interactive')} className="mb-6 flex items-center gap-1.5 text-sm font-bold text-text-muted hover:text-text-primary transition-colors"><ArrowLeft className="h-4 w-4" />返回互动项目</button>
        <header className="mb-8">
          <div className="flex items-center gap-2 text-gold"><Sparkles className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wider">互动立项</span></div>
          <h1 className="mt-2 text-3xl font-extrabold text-text-primary">创建互动作品</h1>
          <p className="mt-2 text-sm text-text-muted">选好故事来源和规模后，可以自己搭建分支，也可以让 AI 给出可审阅的初稿。剧本正文在剧本工作区创作，再绑定场景。</p>
        </header>

        <div className="space-y-7 border border-border-soft/30 bg-bg-surface p-6 shadow-xl rounded-2xl md:p-8 backdrop-blur-xl">
          <label className="block"><span className="mb-2 block text-sm font-bold text-text-primary">作品名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雾港回声" className="w-full border border-border-soft/40 bg-bg-surface-soft px-4 py-3 text-sm text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors" /></label>

          <section>
            <div className="mb-3 text-sm font-bold text-text-primary">从哪里开始</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={() => setSourceMode('scratch')} className={`border p-4 text-left rounded-2xl transition-all ${sourceMode === 'scratch' ? 'border-gold bg-gold/10' : 'border-border-soft/30 bg-bg-surface-soft/60 hover:border-border-soft/60'}`}><Clapperboard className="mb-2.5 h-6 w-6 text-gold" /><div className="text-sm font-bold text-text-primary">从一个想法开始</div><div className="mt-1 text-xs text-text-muted">填写故事构想，再选择手工或 AI 搭建</div></button>
              <button type="button" onClick={() => setSourceMode('bind_writing')} className={`border p-4 text-left rounded-2xl transition-all ${sourceMode === 'bind_writing' ? 'border-gold bg-gold/10' : 'border-border-soft/30 bg-bg-surface-soft/60 hover:border-border-soft/60'}`}><FileText className="mb-2.5 h-6 w-6 text-sky-400" /><div className="text-sm font-bold text-text-primary">使用已有剧本</div><div className="mt-1 text-xs text-text-muted">让互动作品连接现有正文</div></button>
            </div>
          </section>

          {sourceMode === 'bind_writing' && <label className="block"><span className="mb-2 block text-sm font-bold text-text-primary">选择剧本</span><select value={writingProjectId} onChange={(event) => setWritingProjectId(event.target.value)} className="w-full border border-border-soft/40 bg-bg-surface-soft px-4 py-3 text-sm text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors"><option value="">请选择</option>{writingProjects.map((project) => <option key={project.id} value={project.id}>{project.title} · r{project.revision}</option>)}</select></label>}

          {/* 故事类型 & 作品规模：单行并排双下拉框 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 故事类型 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="genre-select" className="text-sm font-bold text-text-primary">
                  故事类型
                </label>
                {isCustomGenre && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomGenre(false);
                      setGenre(genreTemplates[0]);
                    }}
                    className="text-xs text-gold hover:underline cursor-pointer"
                  >
                    选用预设模版
                  </button>
                )}
              </div>
              <select
                id="genre-select"
                value={isCustomGenre ? 'custom' : genre}
                onChange={(event) => {
                  const val = event.target.value;
                  if (val === 'custom') {
                    setIsCustomGenre(true);
                  } else {
                    setIsCustomGenre(false);
                    setGenre(val);
                  }
                }}
                className="w-full border border-border-soft/40 bg-bg-surface-soft px-4 py-3 text-sm font-semibold text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors cursor-pointer"
              >
                <optgroup label="预设模版">
                  {genreTemplates.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </optgroup>
                <option value="custom">✏️ 手动输入类型...</option>
              </select>

              {isCustomGenre && (
                <input
                  autoFocus
                  value={customGenre}
                  onChange={(e) => setCustomGenre(e.target.value)}
                  placeholder="输入自定义故事类型，如：古装悬疑 / 赛博谍战"
                  className="mt-2 w-full border border-border-soft/40 bg-bg-surface-soft px-4 py-2.5 text-xs text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors"
                />
              )}
            </div>

            {/* 作品规模 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="scale-select" className="text-sm font-bold text-text-primary">
                  作品规模
                </label>
                {experienceScale === 'custom' && (
                  <button
                    type="button"
                    onClick={() => setExperienceScale('feature')}
                    className="text-xs text-gold hover:underline cursor-pointer"
                  >
                    选用预设模版
                  </button>
                )}
              </div>
              <select
                id="scale-select"
                value={experienceScale}
                onChange={(event) => setExperienceScale(event.target.value as ExperienceScale)}
                className="w-full border border-border-soft/40 bg-bg-surface-soft px-4 py-3 text-sm font-semibold text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors cursor-pointer"
              >
                <optgroup label="预设模版">
                  {scaleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}（{option.detail}）
                    </option>
                  ))}
                </optgroup>
                <option value="custom">✏️ 手动自定义时长...</option>
              </select>

              {experienceScale === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <span className="mb-1 block text-[11px] text-text-muted">单次体验(分钟)</span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={customSessionMinutes}
                      onChange={(e) => setCustomSessionMinutes(Math.max(1, Number(e.target.value) || 0))}
                      placeholder="如 30"
                      className="w-full border border-border-soft/40 bg-bg-surface-soft px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60 rounded-xl"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] text-text-muted">完整探索(分钟)</span>
                    <input
                      type="number"
                      min={1}
                      max={1200}
                      value={customCompleteMinutes}
                      onChange={(e) => setCustomCompleteMinutes(Math.max(1, Number(e.target.value) || 0))}
                      placeholder="如 90"
                      className="w-full border border-border-soft/40 bg-bg-surface-soft px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60 rounded-xl"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <label className="block"><span className="mb-2 block text-sm font-bold text-text-primary">你想讲一个什么故事</span><textarea value={creativeBrief} onChange={(event) => setCreativeBrief(event.target.value)} rows={5} placeholder="例如：一名记者来到被封锁的海港调查失踪案。她必须决定相信老船长还是年轻警员，而真相会改变她对父亲死亡的认知。" className="w-full resize-none border border-border-soft/40 bg-bg-surface-soft px-4 py-3.5 text-sm leading-6 text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors" /></label>

          <div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={isSubmitting} onClick={() => void handleCreateManual()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gold/50 bg-gold/10 px-5 py-3 text-sm font-bold text-gold hover:bg-gold/20 transition-all disabled:opacity-60">{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}手动创建空白画布</button><button type="button" disabled={isSubmitting} onClick={openCreatePrompt} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-bg-primary hover:bg-gold-light transition-all shadow-md shadow-gold/20 disabled:opacity-60"><Sparkles className="h-4 w-4" />创建并生成 AI 方案</button></div>
        </div>
      </div>
      <PromptEditorModal
        isOpen={isPromptOpen}
        onClose={() => setIsPromptOpen(false)}
        title="创建互动作品 - 提示词确认"
        templateId="interactiveCreateFirstDraft"
        workflowStepId="manual.game.editor"
        variables={{
          projectTitle: title.trim(),
          genre: currentGenre || '都市情感',
          sourceSummary: sourceMode === 'bind_writing'
            ? `使用已有剧本：${writingProjects.find((project) => project.id === writingProjectId)?.title || writingProjectId}`
            : '从作者的一段故事构想开始',
          experienceScale: getScaleValues().label,
          targetDuration: `典型单次 ${getScaleValues().sessionMinutes} 分钟，完整探索 ${getScaleValues().completeMinutes} 分钟`,
          creativeBrief: creativeBrief.trim() || '请从已选择的剧本中提取故事构想',
        }}
        onConfirm={handleCreate}
      />
    </main>
  );
}
