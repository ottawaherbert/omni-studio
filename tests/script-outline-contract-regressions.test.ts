import test from 'node:test';
import assert from 'node:assert/strict';
import {hashValue} from '../packages/domain/src/contentIdentity';
import {createScriptProject, newScene} from '../packages/script/src/project';
import {parseScriptProject, type ScriptProject} from '../packages/script/src/schema';
import {
  anchorCurrent, anchorFor, beatsForUnit, freezeOutlineGrant, getOutlineGuide,
  outlineGuideId, unitOutlineOwner, type OutlineGrant, type OutlineOwner,
} from '../packages/script/src/outlineGuides';
import {applyWorkspacePatch, createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {} from '../packages/script/src/writingStages';

function fixture(options: {ungrouped?: boolean; nested?: boolean} = {}): ScriptProject {
  const project = createScriptProject('联合大纲合同回归', {
    organization: 'standalone', continuity: 'serialized', workType: '剧情', genres: [],
    language: 'zh-CN', plannedUnits: 1, targetDurationMs: 60000, toleranceMs: 0,
    includeCredits: false, aspectRatio: '16:9', productionMode: 'live-action',
  });
  project.brief.outline = 'A段。B段。';
  const unit = project.units[0];
  unit.structureNodes = [
    ...(options.nested ? [{id: 'node_root', title: '总段', purpose: ''}] : []),
    {id: 'node_a', title: 'A', purpose: '', ...(options.nested ? {parentId: 'node_root'} : {})},
    {id: 'node_b', title: 'B', purpose: '', ...(options.nested ? {parentId: 'node_root'} : {})},
  ];
  const scene = (title: string, structureNodeId?: string) => {
    const value = newScene(title);
    value.blocks[0].text = `${title}已有正文，必须保留。`;
    return {...value, ...(structureNodeId ? {structureNodeId} : {})};
  };
  unit.scenes = [
    ...(options.ungrouped ? [scene('序幕')] : []),
    scene('A场', 'node_a'),
    ...(options.ungrouped ? [scene('间场')] : []),
    scene('B场', 'node_b'),
    ...(options.ungrouped ? [scene('尾声')] : []),
  ];
  const owner: OutlineOwner = {kind: 'project', id: project.id};
  project.outlineGuides = [{
    id: outlineGuideId(owner), owner,
    nodeLinks: [
      ...(options.nested ? [{unitId: unit.id, nodeId: 'node_root', anchor: anchorFor(project.brief.outline, 0, 6)}] : []),
      {unitId: unit.id, nodeId: 'node_a', anchor: anchorFor(project.brief.outline, 0, 3)},
      {unitId: unit.id, nodeId: 'node_b', anchor: anchorFor(project.brief.outline, 3, 6)},
    ],
    beats: [{
      id: 'beat_a', title: 'A中的发现', change: '人物发现线索',
      anchors: [anchorFor(project.brief.outline, 0, 3)], unitIds: [unit.id], sceneRefs: [],
    }],
  }];
  return parseScriptProject(project);
}

function result(project: ScriptProject, changes: Record<string, unknown> = {}) {
  return {summary: '按明确范围整理原文', content: project.brief.outline, nodes: null, beats: null, ...changes};
}

function modelNodes(project: ScriptProject) {
  const unit = project.units[0], guide = project.outlineGuides![0];
  return unit.structureNodes!.map(node => ({
    id: node.id, localKey: node.id, parentLocalKey: node.parentId ?? null,
    title: node.title, purpose: node.purpose ?? '',
    quote: guide.nodeLinks.find(link => link.nodeId === node.id)!.anchor.quote,
    sceneIds: unit.scenes.filter(scene => scene.structureNodeId === node.id).map(scene => scene.id),
  }));
}

function workspace(project: ScriptProject) {
  return {
    id: 'workspace_outline_review', documentId: project.id, ownerId: 'owner_outline_review',
    revision: project.revision, document: project,
  };
}

test('film scene planning excludes legacy-summary beats once the full outline owns the story', () => {
  const project = fixture(), unit = project.units[0], owner: OutlineOwner = {kind: 'unit', id: unit.id};
  unit.summary = '旧摘要：人物死亡。';
  project.outlineGuides!.push({
    id: outlineGuideId(owner), owner, nodeLinks: [], beats: [{
      id: 'legacy_beat', title: '旧稿人物死亡', change: '死亡',
      anchors: [anchorFor(unit.summary, 0, unit.summary.length)], unitIds: [unit.id], sceneRefs: [],
    }],
  });
  parseScriptProject(project);
  assert.deepEqual(unitOutlineOwner(project, unit), {kind: 'project', id: project.id});
  assert.deepEqual(beatsForUnit(project, unit).map(entry => entry.beat.id), ['beat_a']);
  assert.equal(getOutlineGuide(project, owner)!.beats[0].id, 'legacy_beat', 'old material remains saved and inspectable');
});
