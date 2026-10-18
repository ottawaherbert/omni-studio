import React from 'react';
import { ArrowLeft, Sparkles, CheckCircle2, Play, AlertCircle, Save } from 'lucide-react';
import { Button } from '../../ui/Button';

export interface InteractiveWhiteboardHeaderProps {
  title: string;
  genre?: string;
  hasUnsavedChanges?: boolean;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
  onBack: () => void;
  onOpenAiDrawer: () => void;
  onRunAudit: () => void;
  onPlaytest: () => void;
  onSave?: () => void;
}

export const InteractiveWhiteboardHeader: React.FC<InteractiveWhiteboardHeaderProps> = ({
  title,
  genre,
  hasUnsavedChanges = false,
  primaryActionLabel = 'AI 共创',
  primaryActionDisabled = false,
  onBack,
  onOpenAiDrawer,
  onRunAudit,
  onPlaytest,
  onSave,
}) => {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border-soft/30 bg-bg-surface/90 dark:bg-neutral-900/90 px-3 backdrop-blur-xl transition-colors sm:px-4 text-text-primary shadow-sm">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors"
          title="返回项目库"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex min-w-0 items-center space-x-2">
          <h1 className="max-w-[110px] truncate text-sm font-bold text-text-primary sm:max-w-[220px] sm:text-base md:max-w-[340px]">
            {title || '未命名互动作品'}
          </h1>
          {genre && (
            <span className="hidden border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-bold text-gold rounded-lg md:inline">
              {genre}
            </span>
          )}
          <span className="hidden text-xs text-text-muted lg:inline">互动白板</span>
        </div>

        <div className="h-4 w-px bg-border-soft/40 mx-1 hidden sm:block" />

        <div className="items-center space-x-1.5 text-xs hidden sm:flex">
          {hasUnsavedChanges ? (
            <span className="flex items-center text-amber-500 font-medium">
              <AlertCircle className="w-3.5 h-3.5 mr-1" />
              未保存更改
            </span>
          ) : (
            <span className="flex items-center text-emerald-500 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              已保存
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          aria-label={primaryActionLabel}
          title={primaryActionLabel}
          onClick={onOpenAiDrawer}
          disabled={primaryActionDisabled}
          className="flex h-9 items-center justify-center bg-gold hover:bg-gold-light text-bg-primary font-bold shadow-md shadow-gold/20 rounded-xl px-3 text-xs transition-all active:scale-95 disabled:cursor-wait disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          <span>{primaryActionLabel}</span>
        </button>

        <button
          aria-label="检查故事"
          title="检查故事"
          onClick={onRunAudit}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft text-text-primary hover:bg-bg-surface-hover transition-colors"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        </button>

        {onSave && hasUnsavedChanges && (
          <button
            type="button"
            onClick={onSave}
            aria-label="保存修订"
            title="保存修订"
            className="flex h-9 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-500 hover:bg-amber-500/20 transition-colors"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">保存修订</span>
          </button>
        )}

        <button
          type="button"
          aria-label="试玩"
          title="试玩"
          onClick={onPlaytest}
          className="flex h-9 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft px-3 text-xs font-bold text-text-primary hover:bg-bg-surface-hover transition-colors"
        >
          <Play className="h-3.5 w-3.5 mr-1.5 fill-current text-gold" />
          <span>试玩</span>
        </button>
      </div>
    </header>
  );
};
