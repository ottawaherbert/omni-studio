import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptProject, newScene} from '../packages/script/src/project';
import {parseScriptProject, type ProjectProfile, type ScriptProject} from '../packages/script/src/schema';
import {
  anchorCurrent, anchorFor, getOutlineGuide, outlineGuideId, outlineText,
  unitOutlineOwner, type OutlineOwner,
} from '../packages/script/src/outlineGuides';
import {applyEpisodePreview, previewNextEpisode} from '../packages/script/src/episodeDevelopment';
import {analysisEvidence} from '../packages/script/src/structureAnalysis';
import {
  locationFromParams, resolveScriptLocation, UNASSIGNED_NODE,
} from '../apps/web/src/features/script/scriptWorkspaceLocation';

const profile: ProjectProfile = {
  organization: 'episodic', continuity: 'anthology', workType: '电视剧',
  genres: ['剧情'], language: 'zh-CN', plannedUnits: 24,
  targetDurationMs: 1800000, toleranceMs: 15000, includeCredits: true,
  aspectRatio: '16:9', productionMode: 'live-action',
};

function locationFixture() {
  const project = createScriptProject('位置隔离样本', {...profile});
  const unit = project.units[0];
  unit.structureNodes = [
    {id: 'part_first', title: '第一段'},
    {id: 'part_second', title: '第二段'},
    {id: 'part_second_child', title: '第二段子段', parentId: 'part_second'},
    {id: 'part_empty', title: '尚未分场'},
  ];
  unit.scenes = ['第一段场景', '第二段场景', '子段场景', '未归组场景'].map(newScene);
  unit.scenes[0].structureNodeId = 'part_first';
  unit.scenes[1].structureNodeId = 'part_second';
  unit.scenes[2].structureNodeId = 'part_second_child';
  return parseScriptProject(project);
}

test('explicit season outline location survives refresh only for the selected season member',()=>{
  const project=locationFixture(),unit=project.units[0];
  project.seasons=[{id:'season_location_a',title:'第一季',arc:'失踪与追查。'},{id:'season_location_b',title:'第二季',arc:'新的选择。'}];
  unit.seasonId='season_location_a';
  const selected=resolveScriptLocation(project,{view:'outline',unitId:unit.id,outlineChoice:'season',outlineSeasonId:'season_location_a'});
  assert.equal(selected.outlineChoice,'season');assert.equal(selected.outlineSeasonId,'season_location_a');
  assert.equal(resolveScriptLocation(project,{},selected).outlineSeasonId,'season_location_a');
  const unrelated=resolveScriptLocation(project,{...selected,outlineSeasonId:'season_location_b'});
  assert.equal(unrelated.outlineChoice,'current');assert.equal(unrelated.outlineSeasonId,undefined);
  assert.equal(selected.unitId,unit.id);assert.equal(selected.sceneId,unit.scenes[0].id);
});

function legacyStoryFixture() {
  const project = createScriptProject('旧独立故事隔离样本', {...profile});
  const unit = project.units[0];
  const original = '旧友归来。选择留下。';
  unit.summary = '旧友远走。等待消息。';
  unit.structureNodes = [
    {id: 'part_arrival', title: '归来'},
    {id: 'part_decision', title: '选择'},
  ];
  unit.scenes = unit.structureNodes.map(node => ({...newScene(node.title), structureNodeId: node.id}));
  unit.scenes[0].blocks[0].text = '旧友把行李放在门槛外。';
  unit.scenes[1].blocks[0].text = '她取下门上的锁，将钥匙留在桌上。';
  const story: OutlineOwner = {kind: 'story', id: unit.scopeId};
  const current: OutlineOwner = {kind: 'unit', id: unit.id};
  project.storyOutlines = [{scopeId: unit.scopeId, outline: original}];
  project.outlineGuides = [
    {
      id: outlineGuideId(story), owner: story,
      nodeLinks: unit.structureNodes.map((node, index) => ({
        unitId: unit.id, nodeId: node.id, anchor: anchorFor(original, index * 5, index * 5 + 5),
      })),
      beats: [{
        id: 'beat_story_choice', title: '决定留下', change: '停止离开',
        anchors: [anchorFor(original, 5, 10)], unitIds: [unit.id],
        sceneRefs: [{unitId: unit.id, sceneId: unit.scenes[1].id}],
      }],
    },
    {
      id: outlineGuideId(current), owner: current,
      nodeLinks: [{unitId: unit.id, nodeId: unit.structureNodes[0].id, anchor: anchorFor(unit.summary, 0, 5)}],
      beats: [{
        id: 'beat_old_summary', title: '仍在等待', change: '没有等到旧友',
        anchors: [anchorFor(unit.summary, 5, 10)], unitIds: [unit.id],
        sceneRefs: [{unitId: unit.id, sceneId: unit.scenes[0].id}],
      }],
    },
  ];
  return {project: parseScriptProject(project), story, current, original};
}

test('unassigned range survives resolution, URL restoration, and a page change', () => {
  const project = locationFixture(), unit = project.units[0];
  const selected = resolveScriptLocation(project, {
    view: 'board', unitId: unit.id, nodeId: UNASSIGNED_NODE, sceneId: unit.scenes[0].id,
  });
  assert.equal(selected.nodeId, UNASSIGNED_NODE);
  assert.equal(selected.sceneId, unit.scenes[3].id);
  const params = new URLSearchParams({view: 'studio', unitId: unit.id, nodeId: UNASSIGNED_NODE, sceneId: selected.sceneId!});
  const restored = resolveScriptLocation(project, locationFromParams(params));
  assert.equal(restored.nodeId, UNASSIGNED_NODE);
  assert.equal(restored.sceneId, selected.sceneId);
  assert.equal(restored.view, 'studio');
});

test('switching a structure range selects its own first scene and preserves a selected descendant', () => {
  const project = locationFixture(), unit = project.units[0];
  const remembered = {view: 'board' as const, unitId: unit.id, nodeId: 'part_first', sceneId: unit.scenes[0].id};
  const switched = resolveScriptLocation(project, {nodeId: 'part_second'}, remembered);
  assert.equal(switched.sceneId, unit.scenes[1].id);
  const child = resolveScriptLocation(project, {view: 'studio', sceneId: unit.scenes[2].id}, switched);
  assert.equal(child.nodeId, 'part_second');
  assert.equal(child.sceneId, unit.scenes[2].id);
});

test('empty structure and empty unassigned ranges never fall back to an unrelated scene', () => {
  const project = locationFixture(), unit = project.units[0];
  const remembered = {view: 'studio' as const, unitId: unit.id, sceneId: unit.scenes[0].id};
  const empty = resolveScriptLocation(project, {nodeId: 'part_empty'}, remembered);
  assert.equal(empty.nodeId, 'part_empty');
  assert.equal(empty.sceneId, undefined);
  unit.scenes = unit.scenes.filter(scene => scene.structureNodeId);
  const unassigned = resolveScriptLocation(project, {nodeId: UNASSIGNED_NODE}, remembered);
  assert.equal(unassigned.nodeId, UNASSIGNED_NODE);
  assert.equal(unassigned.sceneId, undefined);
});

test('old episode-detail links resolve to the common scene planner without losing their scene', () => {
  const project = locationFixture(), unit = project.units[0];
  const params = new URLSearchParams({view: 'episode', unitId: unit.id, sceneId: unit.scenes[2].id});
  const location = resolveScriptLocation(project, locationFromParams(params));
  assert.equal(location.view, 'board');
  assert.equal(location.unitId, unit.id);
  assert.equal(location.sceneId, unit.scenes[2].id);
});

test('an old independent story remains the primary readable original when its unit summary is empty', () => {
  const {project, story, original} = legacyStoryFixture();
  project.units[0].summary = '';
  project.outlineGuides = project.outlineGuides!.filter(guide => guide.owner.kind !== 'unit');
  const before = structuredClone(project);
  const owner = unitOutlineOwner(project, project.units[0]);
  assert.deepEqual(owner, story);
  assert.equal(outlineText(project, owner), original);
  assert.deepEqual(project, before, 'reading must not migrate the old document');
});

test('a new one-episode story uses its unit outline without creating a duplicate story outline', () => {
  const project = createScriptProject('新独立故事', {...profile});
  const unit = project.units[0];
  unit.summary = '她归还借来的钥匙。';
  assert.deepEqual(unitOutlineOwner(project, unit), {kind: 'unit', id: unit.id});
  assert.equal(outlineText(project, unitOutlineOwner(project, unit)), unit.summary);
  assert.equal(project.storyOutlines, undefined);
});

test('a season with only its first episode keeps the season arc separate from the episode outline', () => {
  const project = createScriptProject('只有首集的独立季', {...profile});
  const unit = project.units[0];
  project.seasons = [{id: 'season_new', title: '新季', arc: '整季先失踪，后追查，最终揭开真相。'}];
  unit.scopeId = 'season_new';
  unit.seasonId = 'season_new';
  unit.summary = '第一集只写失踪，不揭露真相。';
  const before = structuredClone(project);
  assert.deepEqual(unitOutlineOwner(project, unit), {kind: 'unit', id: unit.id});
  assert.equal(outlineText(project, unitOutlineOwner(project, unit)), unit.summary);
  assert.deepEqual(project, before);
  const preview = previewNextEpisode(project, {kind: 'continue', sourceUnitId: unit.id, title: '第二集'});
  assert.equal(preview.conversion, null);
  const result = applyEpisodePreview(project, preview);
  assert.equal(outlineText(result, unitOutlineOwner(result, result.units[0])), unit.summary);
  assert.deepEqual(result.seasons, project.seasons);
});

test('node-purpose evidence retains its outline owner and a selected scene analysis excludes other scenes', () => {
  const {project, current} = legacyStoryFixture();
  // Use the episode original to exercise node ownership independently of legacy conversion.
  project.storyOutlines = [];
  project.outlineGuides = project.outlineGuides!.filter(guide => guide.owner.kind === 'unit');
  const unit = project.units[0];
  unit.structureNodes![0].purpose = '让等待变成行动。';
  const nodeEvidence = analysisEvidence(project, {unitId: unit.id, nodeId: unit.structureNodes![0].id});
  const purpose = nodeEvidence.find(item => item.kind === 'NODE_BEAT' && item.field === 'purpose');
  assert.ok(purpose);
  assert.deepEqual(purpose.owner, current);
  assert.equal(purpose.nodeId, unit.structureNodes![0].id);
  const unassigned = newScene('未归组的线索');
  unassigned.purpose = '核实一封信的地址。';
  unassigned.blocks[0].text = '她将信封翻到背面。';
  unit.scenes.push(unassigned);
  const selected = analysisEvidence(project, {unitId: unit.id, sceneId: unassigned.id});
  const sceneEvidence = selected.filter(item => item.kind === 'SCENE_PLAN' || item.kind === 'BODY_BLOCK');
  assert.ok(sceneEvidence.length > 0);
  assert.ok(sceneEvidence.every(item => item.sceneId === unassigned.id));
});

test('a legacy sequel conversion preserves node, beat, scene and body identities without duplicating guides', () => {
  const {project, story, current, original} = legacyStoryFixture();
  const before = structuredClone(project), unit = project.units[0];
  const preview = previewNextEpisode(project, {kind: 'continue', sourceUnitId: unit.id, title: '故事续篇'});
  assert.deepEqual(project, before, 'preview must not mutate the author document');
  assert.equal(preview.conversion?.original, original);
  assert.equal(preview.conversion?.previousSummary, before.units[0].summary);
  assert.equal(preview.conversion?.replacesExistingRelations, true);
  const result = applyEpisodePreview(project, preview);
  const oldUnit = result.units.find(item => item.id === unit.id)!;
  assert.equal(oldUnit.summary, original);
  assert.deepEqual(oldUnit.structureNodes, unit.structureNodes);
  assert.deepEqual(oldUnit.scenes, unit.scenes);
  assert.equal(outlineText(result, story), '');
  assert.equal(getOutlineGuide(result, story), undefined);
  const moved = getOutlineGuide(result, current)!;
  const source = getOutlineGuide(before, story)!;
  assert.deepEqual(moved.nodeLinks, source.nodeLinks);
  assert.deepEqual(moved.beats, source.beats);
  assert.ok(moved.nodeLinks.every(link => anchorCurrent(link.anchor, oldUnit.summary)));
  assert.ok(moved.beats.every(beat => beat.anchors.every(anchor => anchorCurrent(anchor, oldUnit.summary))));
  assert.equal(result.outlineGuides!.flatMap(guide => guide.beats).filter(beat => beat.id === 'beat_story_choice').length, 1);
  assert.ok(!result.outlineGuides!.some(guide => guide.beats.some(beat => beat.id === 'beat_old_summary')));
  assert.equal(result.units.find(item => item.id === preview.unitId)!.scopeId, unit.scopeId);
  assert.deepEqual(parseScriptProject(result), result);
});

test('the complete pre-conversion snapshot restores both old texts and their valid relationships', () => {
  const {project, story, current} = legacyStoryFixture();
  const archived = JSON.stringify(project);
  const preview = previewNextEpisode(project, {kind: 'continue', sourceUnitId: project.units[0].id, title: '续篇'});
  const result = applyEpisodePreview(project, preview);
  const restored = parseScriptProject(JSON.parse(archived));
  assert.deepEqual(restored, project);
  assert.notEqual(outlineText(restored, story), outlineText(restored, current));
  for (const guide of restored.outlineGuides!) {
    const text = outlineText(restored, guide.owner);
    assert.ok(guide.nodeLinks.every(link => anchorCurrent(link.anchor, text)));
    assert.ok(guide.beats.every(beat => beat.anchors.every(anchor => anchorCurrent(anchor, text))));
  }
  assert.deepEqual(getOutlineGuide(restored, current)!.beats.map(beat => beat.id), ['beat_old_summary']);
  const duplicated = structuredClone(result);
  duplicated.outlineGuides!.push(structuredClone(getOutlineGuide(restored, story)!));
  assert.throws(() => parseScriptProject(duplicated), /标识无效或重复/, 'a moved beat must not remain active under both owners');
});

test('the second independent season starts a new story and its next episode retains that season and arc', () => {
  const project = createScriptProject('按季独立故事', {...profile});
  const first = project.units[0];
  project.seasons = [{id: 'season_first', title: '第一季', arc: '第一季的独立故事。'}];
  first.scopeId = 'season_first';
  first.seasonId = 'season_first';
  first.summary = '第一季第一集。';
  const initial = previewNextEpisode(project, {kind: 'season_independent', sourceUnitId: first.id, title: '第二季第一集'});
  const secondSeason = applyEpisodePreview(project, initial);
  const source = secondSeason.units.find(unit => unit.id === initial.unitId)!;
  assert.notEqual(source.scopeId, first.scopeId);
  assert.equal(source.scopeId, source.seasonId);
  const season = secondSeason.seasons!.find(item => item.id === source.seasonId)!;
  season.arc = '第二季完整走向，包含第一集之后的事件。';
  source.summary = '第二季第一集只写失踪事件。';
  const next = previewNextEpisode(secondSeason, {kind: 'continue', sourceUnitId: source.id, title: '第二季第二集'});
  assert.equal(next.conversion, null, 'a season arc is not a legacy single-episode original');
  const continued = applyEpisodePreview(secondSeason, next);
  const following = continued.units.find(unit => unit.id === next.unitId)!;
  assert.equal(following.scopeId, source.scopeId);
  assert.equal(following.seasonId, source.seasonId);
  assert.equal(continued.seasons!.find(item => item.id === season.id)!.arc, season.arc);
  assert.equal(continued.units.find(unit => unit.id === source.id)!.summary, source.summary);
  assert.deepEqual(continued.units.find(unit => unit.id === first.id), first);
});

test('a season used only for scheduling does not turn a new independent episode into a shared story', () => {
  const project = createScriptProject('编排季', {...profile});
  const first = project.units[0];
  project.seasons = [{id: 'season_schedule', title: '第一季', arc: ''}];
  first.seasonId = 'season_schedule';
  const preview = previewNextEpisode(project, {kind: 'independent', sourceUnitId: first.id, title: '另一个独立故事'});
  const added = preview.project.units.find(unit => unit.id === preview.unitId)!;
  assert.notEqual(added.scopeId, first.scopeId);
  assert.notEqual(added.scopeId, first.seasonId);
  assert.equal(preview.conversion, null);
});

test('changes to either original, its relations, or body after preview prevent conversion', () => {
  const {project, story, current} = legacyStoryFixture();
  const preview = previewNextEpisode(project, {kind: 'continue', sourceUnitId: project.units[0].id, title: '续篇'});
  const changes: Array<(copy: ScriptProject) => void> = [
    copy => { copy.storyOutlines![0].outline += '作者新改的结尾。'; },
    copy => { copy.units[0].summary += '作者修订旧摘要。'; },
    copy => { getOutlineGuide(copy, story)!.beats[0].title = '作者改过的关键变化'; },
    copy => { getOutlineGuide(copy, current)!.beats[0].sceneRefs = []; },
    copy => { copy.units[0].scenes[0].blocks[0].text += '新写的动作。'; },
  ];
  for (const change of changes) {
    const changed = structuredClone(project);
    change(changed);
    const before = structuredClone(changed);
    assert.throws(() => applyEpisodePreview(changed, preview), /预览后已变化/);
    assert.deepEqual(changed, before, 'failed adoption must not undo newer author content');
  }
});
