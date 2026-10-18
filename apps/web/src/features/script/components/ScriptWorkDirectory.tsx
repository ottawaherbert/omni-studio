import React, { createContext, useContext, useRef } from 'react';
import { PanelLeft, Plus, Globe, Sparkles, Folder, FolderOpen, Clapperboard, Layers, Film, Tv, Hash } from 'lucide-react';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import { anchorCurrent, getOutlineGuide, outlineText, unitOutlineOwner } from '../../../../../../packages/script/src/outlineGuides';

import { UNASSIGNED_NODE } from '../scriptWorkspaceLocation';
export { UNASSIGNED_NODE } from '../scriptWorkspaceLocation';
export type OutlineNavigationChoice = 'current' | 'story' | 'project' | 'season' | 'legacy';
export const ScriptDirectoryContext = createContext<{
  open: boolean;
  drawer: boolean;
  setOpen: (open: boolean) => void;
  outline?: {
    choice: OutlineNavigationChoice;
    seasonId?: string;
    onSelect: (choice: OutlineNavigationChoice, seasonId?: string) => void;
  };
}>({ open: true, drawer: false, setOpen: () => {} });

export function ScriptWorkDirectory({
  project,
  unitId,
  nodeId,
  sceneId,
  showScenes = false,
  onUnit,
  onNode,
  onScene,
  onAddUnit,
}: {
  project: ScriptProject;
  unitId: string;
  nodeId?: string;
  sceneId?: string;
  showScenes?: boolean;
  onUnit: (id: string) => void;
  onNode: (id?: string) => void;
  onScene?: (unitId: string, sceneId: string) => void;
  onAddUnit?: () => void;
}) {
  const { open, drawer, setOpen, outline } = useContext(ScriptDirectoryContext);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (drawer) {
      setOpen(false);
      requestAnimationFrame(() => toggle.current?.focus());
    }
  };
  const activeUnit = project.units.find((unit) => unit.id === unitId);
  const season = project.seasons?.find((season) => season.id === (activeUnit?.seasonId || activeUnit?.scopeId));
  const independentStory = activeUnit && activeUnit.scopeId !== project.id && !project.seasons?.some((season) => season.id === activeUnit.scopeId);

  return (
    <aside
      className="script-work-directory custom-scrollbar"
      data-open={open}
      data-drawer={drawer}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className="p-2 border-b border-border-primary/10 flex items-center justify-between">
        <button
          ref={toggle}
          type="button"
          className="script-directory-toggle w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors cursor-pointer"
          aria-expanded={open}
          aria-label={open ? '收起目录' : '展开目录'}
          onClick={() => setOpen(!open)}
        >
          <PanelLeft size={15} className="shrink-0 text-text-muted" />
          <span className="truncate">{open ? '收起目录' : ''}</span>
        </button>
      </div>

      {open && (
        <nav aria-label="作品目录" className="p-2 space-y-3 text-xs">
          {outline && project.profile.organization !== 'standalone' && (
            <div aria-label="整体故事" className="space-y-1 pb-2 border-b border-border-primary/10">
              <div className="px-2 py-1 text-[11px] font-semibold text-text-muted">故事全局</div>
              <button
                type="button"
                aria-current={outline.choice === 'project' ? 'location' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all text-left cursor-pointer ${
                  outline.choice === 'project'
                    ? 'bg-bg-surface-hover text-text-primary font-semibold shadow-xs'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                }`}
                onClick={() => {
                  outline.onSelect('project');
                  close();
                }}
              >
                <Globe size={13} className="shrink-0 text-text-muted" />
                <span className="truncate">作品整体走向</span>
              </button>
              {season && (
                <button
                  type="button"
                  aria-current={outline.choice === 'season' && outline.seasonId === season.id ? 'location' : undefined}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all text-left cursor-pointer ${
                    outline.choice === 'season' && outline.seasonId === season.id
                      ? 'bg-bg-surface-hover text-text-primary font-semibold shadow-xs'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                  }`}
                  onClick={() => {
                    outline.onSelect('season', season.id);
                    close();
                  }}
                >
                  <Sparkles size={13} className="shrink-0 text-text-muted" />
                  <span className="truncate">{season.title} · 整体走向</span>
                </button>
              )}
              {independentStory && (
                <button
                  type="button"
                  aria-current={outline.choice === 'story' ? 'location' : undefined}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all text-left cursor-pointer ${
                    outline.choice === 'story'
                      ? 'bg-bg-surface-hover text-text-primary font-semibold shadow-xs'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                  }`}
                  onClick={() => {
                    outline.onSelect('story');
                    close();
                  }}
                >
                  <Sparkles size={13} className="shrink-0 text-text-muted" />
                  <span className="truncate">当前故事整体走向</span>
                </button>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="px-2 py-0.5 text-[11px] font-semibold text-text-muted">
              {project.profile.organization === 'standalone' ? '剧本结构' : '分集目录'}
            </div>
            {project.units.map((unit, index) => {
              const selected = unit.id === unitId;
              const owner = unitOutlineOwner(project, unit);
              const guide = getOutlineGuide(project, owner);
              const text = outlineText(project, owner);
              const nodes = unit.structureNodes ?? [];
              const visible = unit.scenes.filter((scene) =>
                !nodeId || nodeId === UNASSIGNED_NODE
                  ? !nodeId || !scene.structureNodeId
                  : scene.structureNodeId === nodeId || nodes.find((node) => node.id === scene.structureNodeId)?.parentId === nodeId
              );

              return (
                <div key={unit.id} className="space-y-1">
                  <button
                    type="button"
                    className={`script-directory-unit w-full flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all text-left cursor-pointer ${
                      selected && !nodeId && (!outline || outline.choice === 'current')
                        ? 'bg-bg-surface-hover text-text-primary font-semibold shadow-xs'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                    }`}
                    aria-current={selected && !nodeId && (!outline || outline.choice === 'current') ? 'location' : undefined}
                    onClick={() => {
                      onUnit(unit.id);
                      close();
                    }}
                  >
                    {project.profile.organization === 'standalone' ? (
                      <Film size={14} className="shrink-0 text-text-muted" />
                    ) : (
                      <Tv size={14} className="shrink-0 text-text-muted" />
                    )}
                    <span className="truncate font-medium">
                      {project.profile.organization === 'standalone' ? '全片' : `${index + 1}. ${unit.title}`}
                    </span>
                  </button>

                  {selected && (
                    <div className="pl-3.5 space-y-1 border-l border-border-primary/15 ml-3 my-1">
                      <button
                        type="button"
                        className={`w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg transition-all text-left cursor-pointer ${
                          !nodeId && (!outline || outline.choice === 'current')
                            ? 'bg-bg-surface-hover text-text-primary font-medium'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                        }`}
                        aria-current={!nodeId && (!outline || outline.choice === 'current') ? 'location' : undefined}
                        onClick={() => {
                          onNode(undefined);
                          close();
                        }}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Layers size={12} className="text-text-muted shrink-0" />
                          <span className="truncate">
                            {project.profile.organization === 'standalone' ? '全片全部内容' : '本集全部内容'}
                            {showScenes ? ' · 全部场景' : ''}
                          </span>
                        </span>
                        {showScenes && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-bg-surface text-text-muted">
                            {unit.scenes.length}
                          </span>
                        )}
                      </button>

                      {nodes.map((node) => {
                        const link = guide?.nodeLinks.find((link) => link.nodeId === node.id);
                        const isNodeActive = nodeId === node.id;
                        const isStale = link && !anchorCurrent(link.anchor, text);
                        return (
                          <button
                            type="button"
                            key={node.id}
                            style={{ paddingLeft: node.parentId ? 24 : 8 }}
                            className={`w-full flex items-center justify-between gap-1.5 py-1.5 pr-2 rounded-lg transition-all text-left cursor-pointer ${
                              isNodeActive
                                ? 'bg-bg-surface-hover text-text-primary font-medium'
                                : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                            }`}
                            aria-current={isNodeActive ? 'location' : undefined}
                            onClick={() => {
                              onNode(node.id);
                              close();
                            }}
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              {isNodeActive ? (
                                <FolderOpen size={12} className="text-text-muted shrink-0" />
                              ) : (
                                <Folder size={12} className="text-text-muted shrink-0" />
                              )}
                              <span className="truncate">{node.title}</span>
                            </span>
                            {isStale && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-accent-amber/15 text-accent-amber shrink-0">
                                待复核
                              </span>
                            )}
                          </button>
                        );
                      })}

                      {showScenes && nodes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            onNode(UNASSIGNED_NODE);
                            close();
                          }}
                          aria-current={nodeId === UNASSIGNED_NODE ? 'location' : undefined}
                          className={`w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg transition-all text-left cursor-pointer ${
                            nodeId === UNASSIGNED_NODE
                              ? 'bg-bg-surface-hover text-text-primary font-medium'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-soft'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <Hash size={12} className="text-text-muted shrink-0" />
                            <span>未归组</span>
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-bg-surface text-text-muted">
                            {unit.scenes.filter((scene) => !scene.structureNodeId).length}
                          </span>
                        </button>
                      )}

                      {showScenes &&
                        visible.map((scene) => {
                          const isSceneActive = sceneId === scene.id;
                          return (
                            <button
                              type="button"
                              className={`script-directory-scene w-full flex items-center gap-1.5 pl-4 pr-2 py-1 rounded-lg transition-all text-left cursor-pointer ${
                                isSceneActive
                                  ? 'bg-bg-surface-hover text-text-primary font-medium'
                                  : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-soft'
                              }`}
                              key={scene.id}
                              aria-current={isSceneActive ? 'location' : undefined}
                              onClick={() => {
                                onScene?.(unit.id, scene.id);
                                close();
                              }}
                            >
                              <Clapperboard size={11} className="text-text-muted/60 shrink-0" />
                              <span className="truncate">
                                {unit.scenes.indexOf(scene) + 1}. {scene.title}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {project.profile.organization !== 'standalone' && onAddUnit && (
            <button
              type="button"
              onClick={onAddUnit}
              className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-all cursor-pointer"
            >
              <Plus size={13} />
              <span>新增下一集</span>
            </button>
          )}
        </nav>
      )}
    </aside>
  );
}
