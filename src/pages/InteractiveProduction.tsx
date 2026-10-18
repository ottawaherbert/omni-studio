import { useEffect, useState } from 'react';
import { ArrowRight, GitBranch, Loader2, Plus, Route, Sparkles, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';

import { interactiveClient, type InteractiveExperience } from '../clients/interactiveProductionClient';
import { Button } from '@/src/components/ui/Button';

const statusLabel: Record<InteractiveExperience['status'], string> = {
  development: '体验设计中',
  graph_locked: '历史图谱快照',
  content_production: '内容制作中',
  runtime_qa: '运行时质检',
  playtest: '试玩中',
  release_candidate: '待发布',
  released: '已发布',
};

const INITIAL_PROJECT_COUNT = 12;

export default function InteractiveProduction() {
  const navigate = useNavigate();
  const [experiences, setExperiences] = useState<InteractiveExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(INITIAL_PROJECT_COUNT);

  const load = async () => {
    setLoading(true);
    try {
      setExperiences(await interactiveClient.listExperiences());
      setVisibleCount(INITIAL_PROJECT_COUNT);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '互动项目读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex h-full w-full max-w-7xl flex-col bg-bg-primary px-6 py-8 text-text-primary transition-colors duration-200 md:px-8 md:py-10"
    >
      <header className="mb-8 flex flex-col gap-4 border-b border-border-soft/30 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-gold mb-1">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-wider">Interactive Cinema</span>
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-text-primary">
            <GitBranch className="h-8 w-8 text-gold" />
            互动影视项目库
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            以叙事图谱白板为创作中枢，构建多结局分支故事与互动试玩
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/interactive/new')}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-bg-primary shadow-md shadow-gold/20 hover:bg-gold-light transition-all active:scale-95 shrink-0"
        >
          <Plus className="h-4 w-4" />
          新建互动项目
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-8">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-text-muted">
            <Loader2 className="h-7 w-7 animate-spin text-gold" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {experiences.slice(0, visibleCount).map((experience) => (
              <article
                key={experience.id}
                className="flex min-h-56 flex-col rounded-2xl border border-border-soft/30 bg-bg-surface p-6 shadow-md hover:border-gold/40 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="rounded-xl border border-border-soft/40 bg-bg-surface-soft px-3 py-1 text-xs font-bold text-text-secondary">
                    {experience.genre}
                  </span>
                  <span className="text-xs font-bold text-gold flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                    {statusLabel[experience.status]}
                  </span>
                </div>
                <h2 className="mb-2 line-clamp-2 text-lg font-bold text-text-primary">{experience.title}</h2>
                <p className="line-clamp-3 flex-1 text-xs leading-6 text-text-muted">
                  {experience.formatProfile.format === 'branching_fmv' ? '分支互动影视' : '互动叙事项目'}
                  {' · '}
                  {experience.formatProfile.targetSessionMinutes} 分钟单次体验
                  {' · '}
                  {experience.formatProfile.aspectRatio}
                </p>
                <div className="mt-5 flex items-center justify-between border-t border-border-soft/20 pt-4">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`删除“${experience.title}”及其互动领域数据？`)) return;
                      await interactiveClient.deleteExperience(experience.id);
                      toast.success('互动项目已删除');
                      await load();
                    }}
                    className="rounded-xl p-2 text-text-muted hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                    title="删除互动项目"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/interactive/experiences/${experience.id}/graph`)}
                    className="flex items-center gap-1.5 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-bold text-gold hover:bg-gold/20 transition-colors"
                  >
                    <Route className="h-4 w-4" />
                    打开白板
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
            {experiences.length === 0 && (
              <div className="col-span-full flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border-soft/40 bg-bg-surface-soft/30 p-8 text-center">
                <GitBranch className="mb-4 h-10 w-10 text-text-dark" />
                <p className="mb-2 text-base font-bold text-text-primary">还没有互动项目</p>
                <p className="mb-5 text-xs text-text-muted">告诉 AI 你的想法，快速搭建第一个互动叙事故事</p>
                <button
                  type="button"
                  onClick={() => navigate('/interactive/new')}
                  className="flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-xs font-bold text-bg-primary hover:bg-gold-light transition-all shadow-md shadow-gold/20"
                >
                  <Plus className="h-4 w-4" />
                  创建第一个互动项目
                </button>
              </div>
            )}
            {visibleCount < experiences.length && (
              <div className="col-span-full flex justify-center pt-2">
                <Button
                  variant="secondary"
                  onClick={() => setVisibleCount((count) => count + INITIAL_PROJECT_COUNT)}
                >
                  显示更多项目（还有 {experiences.length - visibleCount} 个）
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.main>
  );
}
