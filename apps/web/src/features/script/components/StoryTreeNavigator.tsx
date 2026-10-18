import React, { useState, useEffect } from 'react';
import { 
  Plus, Film, ChevronRight, ChevronDown, Trash2, ArrowUp, ArrowDown, ArrowRight,
  Layers, Compass, BookOpen, Sparkles, MoreHorizontal
} from 'lucide-react';
import type { ScriptProject, DeliveryUnit, Scene } from '../../../../../../packages/script/src/schema';

interface Props {
  project: ScriptProject;
  activeUnitId: string;
  activeSceneId: string;activeNodeId?:string;onSelectNode?:(nodeId?:string)=>void;
  onSelectUnit: (unitId: string) => void;
  onSelectScene: (unitId: string, sceneId: string) => void;
  onAddScene: (unitId: string) => void;
  onAddUnit: () => void;
  onDeleteScene: (unitId: string, sceneId: string) => void;
  onMoveScene: (unitId: string, sceneIndex: number, direction: 'up' | 'down') => void;
  onOpenBlueprint?: () => void;
  onOpenOutline?: () => void;
}

export function StoryTreeNavigator({
  project,
  activeUnitId,
  activeSceneId,activeNodeId,onSelectNode,
  onSelectUnit,
  onSelectScene,
  onAddScene,
  onAddUnit,
  onDeleteScene,
  onMoveScene,
  onOpenBlueprint,
  onOpenOutline,
}: Props) {
  const [collapsedUnits, setCollapsedUnits] = useState<Record<string, boolean>>({});
  const [openMenuSceneId, setOpenMenuSceneId] = useState<string | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    const handleDocClick = () => setOpenMenuSceneId(null);
    window.addEventListener('click', handleDocClick);
    return () => window.removeEventListener('click', handleDocClick);
  }, []);

  const toggleCollapse = (unitId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }));
  };

  const isStandalone = project.profile.organization === 'standalone';
  const isSingleUnitMovie = isStandalone && project.units.length <= 1;
  const singleUnit = project.units[0];

  // Overall statistics
  const totalScenes = project.units.reduce((acc, u) => acc + u.scenes.length, 0);
  const totalWords = project.units.reduce(
    (acc, u) => acc + u.scenes.reduce(
      (sAcc, s) => sAcc + s.blocks.reduce((bAcc, b) => bAcc + (b.text || '').replace(/\s/g, '').length, 0),
      0
    ),
    0
  );

  const selectedUnit=project.units.find(item=>item.id===activeUnitId);
  const selectedNodes=new Set([activeNodeId,...(selectedUnit?.structureNodes||[]).filter(node=>node.parentId===activeNodeId).map(node=>node.id)]);
  const visibleScenes=(unit:DeliveryUnit)=>unit.scenes.filter(scene=>unit.id!==activeUnitId||!activeNodeId||!scene.structureNodeId||selectedNodes.has(scene.structureNodeId));
  // Render individual scene row
  const renderSceneItem = (unit: DeliveryUnit, scene: Scene, sceneIdx: number) => {
    const isSceneActive = scene.id === activeSceneId;
    const charCount = scene.blocks.reduce(
      (acc, b) => acc + (b.text || '').replace(/\s/g, '').length,
      0
    );
    const hasContent = charCount > 0;

    return (
      <div
        key={scene.id}
        onClick={() => {
          onSelectScene(unit.id, scene.id);
        }}
        className={`group relative flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${
          isSceneActive
            ? 'bg-bg-surface-hover text-text-primary font-medium border border-border-primary/40 shadow-xs'
            : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface-soft'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
          <span className="font-mono text-[10px] opacity-60 shrink-0">
            {String(sceneIdx + 1).padStart(2, '0')}
          </span>
          <span className="truncate text-[12px]">{scene.title || '未命名场景'}{scene.structureNodeId&&<small className="block text-[10px] text-text-muted font-normal truncate">{unit.structureNodes?.find(node=>node.id===scene.structureNodeId)?.title}</small>}</span>
        </div>

        {/* Status Label or Hover Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* When hovered: show discreet more menu trigger */}
          <div
            className="relative hidden group-hover:flex items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuSceneId(openMenuSceneId === scene.id ? null : scene.id);
              }}
              className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-surface-hover rounded"
              title="更多操作"
            >
              <MoreHorizontal size={12} />
            </button>

            {/* Dropdown Menu */}
            {openMenuSceneId === scene.id && (
              <div className="absolute right-0 top-full mt-1 w-28 bg-bg-surface border border-border-primary/40 rounded-lg shadow-xl py-1 z-30 text-xs">
                <button
                  type="button"
                  disabled={sceneIdx === 0}
                  onClick={() => {
                    onMoveScene(unit.id, sceneIdx, 'up');
                    setOpenMenuSceneId(null);
                  }}
                  className="w-full px-2.5 py-1 text-left flex items-center gap-2 hover:bg-bg-surface-hover text-text-secondary disabled:opacity-30"
                >
                  <ArrowUp size={11} />
                  <span>上移场次</span>
                </button>
                <button
                  type="button"
                  disabled={sceneIdx === unit.scenes.length - 1}
                  onClick={() => {
                    onMoveScene(unit.id, sceneIdx, 'down');
                    setOpenMenuSceneId(null);
                  }}
                  className="w-full px-2.5 py-1 text-left flex items-center gap-2 hover:bg-bg-surface-hover text-text-secondary disabled:opacity-30"
                >
                  <ArrowDown size={11} />
                  <span>下移场次</span>
                </button>
                {unit.scenes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuSceneId(null);
                      if (window.confirm(`确定删除场景「${scene.title}」？关联的时长安排会一并删除；连续性证据保留待复核。`)) {
                        onDeleteScene(unit.id, scene.id);
                      }
                    }}
                    className="w-full px-2.5 py-1 text-left flex items-center gap-2 hover:bg-accent-red/10 text-accent-red"
                  >
                    <Trash2 size={11} />
                    <span>删除场次</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* State Tag when not hovered */}
          <div className="group-hover:hidden">
            {hasContent ? (
              <span className="text-[10px] font-mono text-text-muted">
                {charCount}字
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary bg-bg-surface-soft px-1.5 py-0.5 rounded font-mono border border-border-primary/20">
                <Sparkles size={9} className="text-text-muted" />
                <span>待写</span>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="max-md:w-full w-64 h-full flex flex-col bg-bg-surface border-r border-border-primary/20 shrink-0 select-none">
      {Boolean(selectedUnit?.structureNodes?.length)&&<label className="p-3 text-xs text-text-muted">幕／段落<select aria-label="写作目录结构范围" value={activeNodeId||''} onChange={event=>onSelectNode?.(event.target.value||undefined)} className="block w-full mt-1 px-2 py-1.5 bg-bg-surface-soft rounded"><option value="">全部场景</option>{selectedUnit!.structureNodes!.map(node=><option key={node.id} value={node.id}>{node.parentId?'　':''}{node.title}</option>)}</select><span className="block mt-1">未分组场景始终显示</span></label>}
      {/* Sidebar Header / Project Meta Info */}
      <div className="p-3.5 border-b border-border-primary/10">
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span className="font-bold text-text-primary flex items-center gap-1.5">
            <BookOpen size={13} className="text-text-secondary" />
            <span>剧本场次大纲</span>
          </span>
          <span className="text-[11px] font-mono text-text-secondary font-medium">
            {isStandalone ? '全片' : `${project.units.length} 集`} · {totalScenes} 场
          </span>
        </div>
        <div className="text-[11px] text-text-muted flex items-center justify-between">
          <span>总计约 {totalWords} 字</span>
          <span className="text-text-secondary">{project.profile.workType}</span>
        </div>
      </div>

      {/* Units & Scenes Tree List */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {isSingleUnitMovie && singleUnit ? (
          /* Movie Mode (Single Continuous Feature Film): Flat Scene List */
          <div className="space-y-0.5">
            {visibleScenes(singleUnit).map((scene, sceneIdx) =>
              renderSceneItem(singleUnit, scene, singleUnit.scenes.findIndex(item=>item.id===scene.id))
            )}
            {singleUnit.scenes.length === 0 && (
              <div className="py-6 px-3 text-center text-xs text-text-muted">
                全片暂无场次，请在分场规划中规划
              </div>
            )}
          </div>
        ) : (
          /* Episodic Series OR Multi-Act Movie: Structured Unit Folders */
          project.units.map((unit) => {
            const isUnitActive = unit.id === activeUnitId;
            const isCollapsed = collapsedUnits[unit.id];

            return (
              <div key={unit.id} className="rounded-xl overflow-hidden">
                {/* Unit Item Heading */}
                <div
                  onClick={() => {
                    onSelectUnit(unit.id);
                    if (unit.scenes[0]) {
                      onSelectScene(unit.id, unit.scenes[0].id);
                    }
                  }}
                  className={`group flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all ${
                    isUnitActive
                      ? 'bg-bg-surface-hover text-text-primary border border-border-primary/30'
                      : 'text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => toggleCollapse(unit.id, e)}
                      className="text-text-muted hover:text-text-primary p-0.5 rounded"
                    >
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <Layers size={13} className={isUnitActive ? 'text-text-primary' : 'text-text-muted'} />
                    <span className="truncate">{unit.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-text-muted">
                    <span>{unit.scenes.length}场</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddScene(unit.id);
                      }}
                      title="添加新场景"
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-text-primary rounded transition-opacity"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>

                {/* Scenes Sub-tree */}
                {!isCollapsed && (
                  <div className="ml-4 pl-2 my-1 border-l border-border-primary/15 space-y-0.5">
                    {visibleScenes(unit).map((scene, sceneIdx) =>
                      renderSceneItem(unit, scene, unit.scenes.findIndex(item=>item.id===scene.id))
                    )}

                    {unit.scenes.length === 0 && (
                      <div className="py-2 px-3 text-center text-[11px] text-text-muted">
                        本单元暂无场次
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer: Outline / Blueprint Link & Unobtrusive Auxiliary Actions */}
      <div className="p-3 border-t border-border-primary/10 space-y-1.5">
        {onOpenOutline && (
          <button
            type="button"
            onClick={onOpenOutline}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft rounded-lg transition-colors cursor-pointer border border-transparent hover:border-border-primary/20"
          >
            <div className="flex items-center gap-2">
              <BookOpen size={13} className="text-text-muted" />
              <span className="font-medium">查看故事大纲与分集</span>
            </div>
            <ArrowRight size={12} className="text-text-muted" />
          </button>
        )}

        {onOpenBlueprint && (
          <button
            type="button"
            onClick={onOpenBlueprint}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft rounded-lg transition-colors cursor-pointer border border-transparent hover:border-border-primary/20"
          >
            <div className="flex items-center gap-2">
              <Compass size={13} className="text-text-muted" />
              <span className="font-medium">查看全案蓝图与设定</span>
            </div>
            <ArrowRight size={12} className="text-text-muted" />
          </button>
        )}

        {!isStandalone ? (
          <div className="flex items-center justify-between pt-1 px-1 text-[11px] text-text-muted">
            <span className="flex items-center gap-1 text-[10px]">
              <Sparkles size={10} className="text-text-muted" />
              <span>按场规划写作</span>
            </span>
            <button
              type="button"
              onClick={onAddUnit}
              className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
              title="手动增加新集数"
            >
              <Plus size={11} />
              <span>加集</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1 px-1 text-[11px] text-text-muted">
            <span className="flex items-center gap-1 text-[10px]">
              <Sparkles size={10} className="text-text-muted" />
              <span>全片按场景连续编写</span>
            </span>
            <button
              type="button"
              onClick={() => singleUnit && onAddScene(singleUnit.id)}
              className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
              title="在全片末尾添加一场"
            >
              <Plus size={11} />
              <span>添加场景</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
