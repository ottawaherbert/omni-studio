import { ChevronLeft, ChevronRight, Layers3 } from 'lucide-react';

import type { InteractiveStoryUnit } from '../../../domains/interactive/structure/storyUnits.ts';

export function InteractiveStoryUnitSwitcher({
  units,
  activeUnitId,
  onSelect,
}: {
  units: InteractiveStoryUnit[];
  activeUnitId: string;
  onSelect: (unitId: string) => void;
}) {
  if (units.length < 2) return null;
  const activeIndex = Math.max(0, units.findIndex((unit) => unit.id === activeUnitId));
  const activeUnit = units[activeIndex] || units[0];
  const previous = units[activeIndex - 1];
  const next = units[activeIndex + 1];
  const displayTitle = (title: string) => title.replace(/^第[一二三四五六七八九十百\d]+章[：:]\s*/, '');
  const optionLabel = (unit: InteractiveStoryUnit) => [
    unit.episodeTitle ? `${unit.episodeTitle}/第${unit.order}章` : `第${unit.order}章`,
    displayTitle(unit.title),
    unit.scriptSceneCount == null
      ? `${unit.nodeIds.length}节点`
      : `${unit.nodeIds.length}节点/${unit.scriptSceneCount}场`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="absolute left-1/2 top-20 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center rounded-2xl border border-border-soft/40 bg-bg-surface/95 dark:bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-xl transition-colors xl:top-4 xl:max-w-[calc(100%-12rem)]">
      <button
        type="button"
        title={previous ? `上一章：${previous.episodeTitle ? `${previous.episodeTitle} · ` : ''}${previous.title}` : '已经是第一章'}
        aria-label="上一章"
        disabled={!previous}
        onClick={() => previous && onSelect(previous.id)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary disabled:opacity-25 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <label className="flex min-w-0 items-center gap-1 px-1 sm:gap-2 sm:px-2.5">
        <Layers3 className="h-4 w-4 shrink-0 text-gold" />
        <span className="sr-only">切换章节</span>
        <select
          aria-label="切换章节"
          value={activeUnit.id}
          onChange={(event) => onSelect(event.target.value)}
          className="h-8 min-w-0 max-w-64 bg-transparent text-xs font-bold text-text-primary outline-none sm:min-w-36 cursor-pointer"
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id} className="bg-bg-surface dark:bg-neutral-900 text-text-primary">
              {optionLabel(unit)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        title={next ? `下一章：${next.episodeTitle ? `${next.episodeTitle} · ` : ''}${next.title}` : '已经是最后一章'}
        aria-label="下一章"
        disabled={!next}
        onClick={() => next && onSelect(next.id)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary disabled:opacity-25 transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
