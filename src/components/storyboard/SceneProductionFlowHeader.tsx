import { ArrowRight, Film, Grid3X3, Settings2, Workflow, Box } from 'lucide-react';
import type { Scene } from '../../clients/domainTypes';
import { sceneProductionVisualSummary, type SceneProductionStage } from '../../clients/productionStoryboardWorkflowClient';
import { cn } from '../../lib/utils';

export function SceneProductionFlowHeader({ scene, stage, settingsOpen, onStageChange, onSettings, onStudio, onGenerate, generationLabel, generationDisabled, onPrevis }: {
  scene: Scene; stage: SceneProductionStage; settingsOpen: boolean;
  onStageChange: (stage: SceneProductionStage) => void; onSettings: () => void; onStudio: () => void;
  onGenerate: () => void; generationLabel: string; generationDisabled?: boolean;
  onPrevis?: () => void;
}) {
  const visuals = sceneProductionVisualSummary(scene);
  return <header className="shrink-0 border-b border-border-soft/30">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
      <div className="min-w-0"><h1 className="text-base font-bold text-text-primary">{scene.title}</h1><p className="mt-1 text-xs text-text-muted">{scene.shots?.length || 0} 个镜头 · 计划 {(scene.shots || []).reduce((sum, shot) => sum + Number(shot.duration || 0), 0)} 秒</p></div>
      <div className="flex items-center gap-3"><button type="button" onClick={onSettings} aria-expanded={settingsOpen} className="inline-flex h-9 items-center gap-2 px-2 text-xs text-text-secondary hover:text-text-primary"><Settings2 className="h-4 w-4" />创作设置</button><button type="button" onClick={onGenerate} disabled={generationDisabled} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-soft/40 px-3 text-xs text-text-primary hover:border-gold disabled:opacity-40"><Workflow className="h-4 w-4" />{generationLabel}</button></div>
    </div>
    <div className="flex items-center justify-between gap-3 px-4 md:px-6"><nav aria-label="场次工作区" className="flex gap-6">
      {([{ id: 'shots', label: '分镜', icon: Film }, { id: 'visuals', label: '故事板', icon: Grid3X3 }] as const).map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => onStageChange(id)} aria-current={stage === id ? 'page' : undefined} className={cn('inline-flex items-center gap-2 border-b-2 py-3 text-sm', stage === id ? 'border-gold text-gold' : 'border-transparent text-text-muted hover:text-text-primary')}><Icon className="h-4 w-4" />{label}{id === 'visuals' && visuals.pending > 0 && <span className="text-xs">{visuals.pending} 待检查</span>}</button>)}
    </nav><div className="flex items-center gap-4">{onPrevis && <button type="button" onClick={onPrevis} className="inline-flex items-center gap-2 text-xs text-text-secondary hover:text-gold"><Box className="h-3.5 w-3.5" />白模预演 · 高级</button>}<button type="button" onClick={onStudio} className="inline-flex items-center gap-2 text-xs text-text-secondary hover:text-gold">去摄影棚<ArrowRight className="h-3.5 w-3.5" /></button></div></div>
  </header>;
}
