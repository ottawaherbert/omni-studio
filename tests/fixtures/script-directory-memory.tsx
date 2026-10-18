import React, { useState } from 'react';
import { StoryOutlineView } from '../../apps/web/src/features/script/components/StoryOutlineView';
import { ScriptDirectoryContext } from '../../apps/web/src/features/script/components/ScriptWorkDirectory';
import { createScriptProject, newUnit } from '../../packages/script/src/project';
import { createScriptCreationProfile } from '../../packages/script/src/creation';
import { parseScriptProject, type ScriptProject, type StructureNode } from '../../packages/script/src/schema';

export const DIRECTORY_MEMORY_IDS = {
  project: 'script_directory_memory_fixture', alternateProject: 'script_directory_memory_other',
  firstUnit: 'unit_directory_memory_first', secondUnit: 'unit_directory_memory_second',
  firstNode: 'node_directory_memory_first', secondNode: 'node_directory_memory_second',
} as const;

export interface DirectoryMemorySnapshot {
  projectId: string;
  revision: number;
  unitId: string;
  nodes: StructureNode[];
}
export interface DirectoryMemoryEvent {
  kind: 'author-update' | 'adopt' | 'unit-switch' | 'project-switch' | 'navigation' | 'request';
  data: DirectoryMemorySnapshot;
}

function createFixtureProject(): ScriptProject {
  const project = createScriptProject('目录草稿内存验收', createScriptCreationProfile('tv-series', 2, 5));
  project.id = DIRECTORY_MEMORY_IDS.project;
  project.brief.outline = '主人公发现旧信，核实地址后决定启程。';
  const first = project.units[0];
  first.id = DIRECTORY_MEMORY_IDS.firstUnit;
  first.scopeId = project.id;
  first.summary = '本集发现旧信并核实地址。';
  first.structureNodes = [{ id: DIRECTORY_MEMORY_IDS.firstNode, title: '旧目录名称', purpose: '旧段落安排' }];
  first.scenes[0].structureNodeId = DIRECTORY_MEMORY_IDS.firstNode;
  const second = newUnit('第 2 集', first.targetDurationMs, project.id);
  second.id = DIRECTORY_MEMORY_IDS.secondUnit;
  second.summary = '第二集继续核实信件来历。';
  second.structureNodes = [{ id: DIRECTORY_MEMORY_IDS.secondNode, title: '第二集目录', purpose: '第二集安排' }];
  second.scenes[0].structureNodeId = DIRECTORY_MEMORY_IDS.secondNode;
  project.units.push(second);
  return parseScriptProject(project);
}

function snapshot(project: ScriptProject, unitId: string): DirectoryMemorySnapshot {
  const unit = project.units.find((item) => item.id === unitId);
  if (!unit) throw new Error('内存夹具的当前单元不存在');
  return { projectId: project.id, revision: project.revision, unitId, nodes: structuredClone(unit.structureNodes ?? []) };
}

/** Shared by the DOM regression and browser fixture; never calls a client, DB or model. */
export function ScriptDirectoryMemoryFixture() {
  const [project, setProject] = useState(createFixtureProject);
  const [unitId, setUnitId] = useState<string>(DIRECTORY_MEMORY_IDS.firstUnit);
  const [nodeId, setNodeId] = useState<string>();
  const [choice, setChoice] = useState<'current' | 'story' | 'project' | 'season' | 'legacy'>('current');
  const [tab, setTab] = useState<'outline' | 'beats' | 'structure'>('outline');
  const [events, setEvents] = useState<DirectoryMemoryEvent[]>([]);
  const [resetVersion, setResetVersion] = useState(0);
  const record = (kind: DirectoryMemoryEvent['kind'], next = project, nextUnitId = unitId) => {
    const event = { kind, data: snapshot(next, nextUnitId) };
    setEvents((list) => [...list, event]);
  };
  const update = (updater: (draft: ScriptProject) => void) => {
    const next = structuredClone(project);
    updater(next);
    setProject(next);
    record('author-update', next);
  };
  const adopt = () => {
    const next = structuredClone(project);
    next.revision += 1;
    next.updatedAt = Date.now();
    const node = next.units.find((item) => item.id === unitId)!.structureNodes![0];
    node.title = `已采用新名称 v${next.revision}`;
    node.purpose = `已采用新安排 v${next.revision}`;
    setProject(next);
    record('adopt', next);
  };
  const reset = () => {
    setProject(createFixtureProject()); setUnitId(DIRECTORY_MEMORY_IDS.firstUnit); setNodeId(undefined);
    setChoice('current'); setTab('outline'); setEvents([]); setResetVersion((value) => value + 1);
  };
  const switchUnit = () => {
    const next = unitId === DIRECTORY_MEMORY_IDS.firstUnit ? DIRECTORY_MEMORY_IDS.secondUnit : DIRECTORY_MEMORY_IDS.firstUnit;
    setUnitId(next); setNodeId(undefined); setChoice('current'); record('unit-switch', project, next);
  };
  const switchProject = () => {
    const next = structuredClone(project), oldId = next.id;
    next.id = oldId === DIRECTORY_MEMORY_IDS.project ? DIRECTORY_MEMORY_IDS.alternateProject : DIRECTORY_MEMORY_IDS.project;
    next.title = next.id === DIRECTORY_MEMORY_IDS.project ? '目录草稿内存验收' : '另一作品（同单元 ID）';
    next.units.forEach((unit) => { if (unit.scopeId === oldId) unit.scopeId = next.id; });
    setProject(next); record('project-switch', next);
  };
  const actionStyle: React.CSSProperties = {
    padding: '6px 12px', border: '1px solid #bdc4cd', borderRadius: 8,
    color: '#111820', background: '#fff', cursor: 'pointer',
  };

  return <div className="script-shared-layout" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ flexShrink: 0, padding: 12, background: '#eff2f5', color: '#111820', fontSize: 12 }}>
      <p>仅内存；实际故事大纲与目录编辑组件。采用按钮只替换当前同 ID 节点并增加版本，不连接数据库或模型。</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" style={actionStyle} onClick={adopt}>采用同ID新目录内容</button>
        <button type="button" style={actionStyle} onClick={reset}>重置夹具</button>
        <button type="button" style={actionStyle} onClick={switchUnit}>切换单元</button>
        <button type="button" style={actionStyle} onClick={switchProject}>切换作品（同unitID）</button>
      </div>
      <pre id="fixture-current-data" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{JSON.stringify(snapshot(project, unitId), null, 2)}</pre>
    </header>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <ScriptDirectoryContext.Provider value={{ open: false, drawer: false, setOpen: () => {} }}>
        <StoryOutlineView key={resetVersion} project={project} activeUnitId={unitId} activeNodeId={nodeId}
          choice={choice} tab={tab} setChoice={setChoice} setTab={setTab}
          onUpdateProject={update}
          onUpdateUnit={(updated) => update((draft) => { draft.units[draft.units.findIndex((unit) => unit.id === updated.id)] = updated; })}
          onSwitchToBlueprint={() => record('navigation')} onSwitchToBoard={() => record('navigation')}
          onSelectUnit={(id) => { setUnitId(id); setNodeId(undefined); }} onSelectNode={setNodeId}
          onAddUnit={() => record('navigation')} onRequestTask={() => record('request')}
        />
      </ScriptDirectoryContext.Provider>
    </div>
    <footer style={{ flexShrink: 0, maxHeight: 170, overflow: 'auto', padding: 12, background: '#eff2f5', color: '#111820', fontSize: 12 }}>
      <p>实际更新回调记录</p>
      <pre id="fixture-change-log" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(events, null, 2)}</pre>
    </footer>
  </div>;
}
