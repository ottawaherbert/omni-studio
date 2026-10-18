import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Modal } from '../../../../../../src/components/ui/Modal';
import { Button } from '../../../../../../src/components/ui/Button';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import { ScriptContinuity } from '../ScriptContinuity';
import { ScriptStructure } from '../ScriptStructure';
import { threadDiagnostics, visibleInUnit } from '../../../../../../packages/script/src/continuity';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: ScriptProject;
  activeUnitId?: string;
  onRequestReview:(unitId:string)=>void;
  onChange:(edit:(project:ScriptProject)=>void)=>void;
  onSave:()=>void;
  dirty:boolean;
  saving:boolean;
  onOpenScene?: (unitId: string, sceneId: string) => void;
}

export function ContinuityRadarModal({
  isOpen,
  onClose,
  project,
  activeUnitId,
  onRequestReview, onChange, onSave, dirty, saving, onOpenScene,
}: Props) {
  const [activeTab, setActiveTab] = useState<'clues' | 'knowledge' | 'records'>('clues');
  const [scanUnitId,setScanUnitId]=useState(activeUnitId||project.units[0]?.id||'');
  const scanUnit=project.units.find(unit=>unit.id===scanUnitId)||project.units[0];
  useEffect(()=>{if(isOpen)setScanUnitId(activeUnitId||project.units[0]?.id||'');},[isOpen,project.id,activeUnitId]);
  const tracks=(project.continuityTracks||[]).filter(track=>scanUnit&&visibleInUnit(track.scopeId,project,scanUnit));
  const clues=tracks.filter(track=>track.kind==='thread'||track.kind==='prop');
  const knowledge=tracks.filter(track=>track.kind==='knowledge');
  const diagnostic=new Map(scanUnit?threadDiagnostics(project,scanUnit).map(item=>[item.trackId,item]):[]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="连续性与线索检查"
      size="lg"
      footer={
        <div className="flex flex-wrap gap-2 items-center justify-between w-full text-xs">
          <button
            type="button"
            disabled={dirty||saving||!scanUnit||!scanUnit.scenes.some(scene=>scene.blocks.some(block=>block.type!=='note'&&block.text.trim()))}
            onClick={()=>onRequestReview(scanUnit.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary border border-border-primary/30 transition-colors cursor-pointer"
          >
            <Sparkles size={13} className="text-text-muted" />
            <span>分批审阅本单元正文</span>
          </button>
          {dirty&&<Button variant="secondary" size="sm" disabled={saving} onClick={onSave}>{saving?'保存中…':'保存连续性资料'}</Button>}
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs text-text-primary">
        <label className="flex items-center gap-2 text-text-secondary">当前单元
          <select value={scanUnit?.id||''} onChange={event=>setScanUnitId(event.target.value)} className="rounded-lg border border-border-primary/30 bg-bg-surface-soft px-2 py-1 text-text-primary">
            {project.units.map(unit=><option key={unit.id} value={unit.id}>{unit.title}</option>)}
          </select>
          <span>分批审阅会打开 Agent 任务设置，可选 Skill、手动回填，记录每批实际读取的场景。</span>
        </label>
        {dirty&&<p className="text-text-muted">当前资料尚未保存，保存后再开始 AI 检查。</p>}
        {/* Navigation Tabs */}
        <div className="flex border-b border-border-primary/20 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('clues')}
            className={`py-2 px-4 font-medium transition-colors border-b-2 ${
              activeTab === 'clues'
                ? 'text-text-primary border-text-primary'
                : 'text-text-muted hover:text-text-primary border-transparent'
            }`}
          >
            线索与道具
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('knowledge')}
            className={`py-2 px-4 font-medium transition-colors border-b-2 ${
              activeTab === 'knowledge'
                ? 'text-text-primary border-text-primary'
                : 'text-text-muted hover:text-text-primary border-transparent'
            }`}
          >
            人物与观众知情
          </button>
          <button type="button" onClick={()=>setActiveTab('records')} className={`py-2 px-4 font-medium border-b-2 ${activeTab==='records'?'text-text-primary border-text-primary':'text-text-muted border-transparent'}`}>登记与维护</button>
        </div>

        {activeTab==='records'&&scanUnit&&<div className="sw" style={{padding:0,minHeight:0}}>
          <ScriptContinuity project={project} unit={scanUnit} onChange={onChange} onOpenScene={(sceneId,unitId)=>onOpenScene?.(unitId||scanUnit.id,sceneId)}/>
        </div>}

        {/* Tab 1: Clues Tracker */}
        {activeTab === 'clues' && (
          <div className="space-y-3">
            <p className="text-text-muted text-[11px]">
              这里显示作者登记的线索、道具及其回收状态。未登记的内容可由检查任务提出建议，须由作者确认。
            </p>

            <div className="space-y-2">
              {clues.map((track) => (
                <div
                  key={track.id}
                  className="p-3 rounded-xl bg-bg-surface-soft border border-border-primary/20 flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <span className="font-semibold text-text-primary">{track.label}</span>
                    <div className="text-[10px] text-text-muted">
                      {track.kind === 'thread' ? `回收状态：${diagnostic.get(track.id)?.status || '未规划'}` : `道具变化：${track.changes.length} 次`}
                    </div>
                  </div>
                  <span className="text-[11px] text-text-secondary font-mono px-2 py-0.5 rounded bg-bg-surface border border-border-primary/20">
                    {track.kind === 'thread' ? '伏笔' : '道具'}
                  </span>
                </div>
              ))}
              {!clues.length && (
                <div className="p-6 text-center text-text-muted bg-bg-surface-soft rounded-xl">
                  暂无已登记的线索或道具。
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Knowledge State */}
        {activeTab === 'knowledge' && (
          <div className="space-y-3">
            <p className="text-text-muted text-[11px]">
              这里显示作者登记的知情变化；人物欲望不代表角色已经知道某件事。
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {knowledge.map((track) => (
                <div
                  key={track.id}
                  className="p-3 rounded-xl bg-bg-surface-soft border border-border-primary/20 space-y-1.5"
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>{track.label}</span>
                    <span className="text-[10px] text-text-muted">{track.perspective === 'audience' ? '观众' : '角色'}</span>
                  </div>
                  <div className="text-[11px] text-text-muted">
                    初始状态：{track.initialValue || '待填写'}
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    已登记变化：{track.changes.length} 次
                  </div>
                </div>
              ))}
              {!knowledge.length && <p className="text-text-muted">暂无已登记的知情变化。</p>}
            </div>
          </div>
        )}


      </div>
    </Modal>
  );
}
