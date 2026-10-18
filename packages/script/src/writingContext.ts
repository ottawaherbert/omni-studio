import {visibleOutlineGuides,outlineText,anchorCurrent,unitOutlineOwner} from './outlineGuides';
import { sha256 } from 'js-sha256';
import type { DeliveryUnit, Scene, ScriptProject } from './schema';
import { blueprintContext } from './blueprint';
import { createContinuityReader, sceneStateHash } from './continuity';
import { planningContext, type PlanningContextOptions } from './outlines';
import { collectOutlineRequirements } from './goalCoverage';

export interface ManuscriptContextSource { kind: 'AUTHOR' | 'WORKSPACE'; id: string; version: string | number }
export interface RequiredWritingContextOptions extends PlanningContextOptions {
  unitIds: string[]; sceneId?: string; nodeId?: string; operation?: string; source?: ManuscriptContextSource;
  includeAdjacentBodies?: boolean; maxExcerptChars?: number; readSceneIds?: string[];
  outlineNodeIds?: string[]; includeUnitOutlineRequirements?: boolean;
}

/** Excerpts preserve exact block offsets and hashes. A long predecessor is explicitly a tail, never a fabricated summary. */
function excerpt(unit: DeliveryUnit, scene: Scene, reason: string, source: ManuscriptContextSource, maxChars: number, tail: boolean) {
  const totalChars = scene.blocks.reduce((n, block) => n + block.text.length, 0);
  let remaining = maxChars;
  const ordered = tail ? [...scene.blocks].reverse() : scene.blocks;
  const blocks = ordered.flatMap(block => {
    if (!remaining || !block.text.length) return [];
    const length = Math.min(remaining, block.text.length), start = tail ? block.text.length - length : 0;
    remaining -= length;
    return [{id: block.id, type: block.type, ...(block.speakerId ? {speakerId: block.speakerId} : {}),
      ...(block.speakerName ? {speakerName: block.speakerName} : {}), text: block.text.slice(start, start + length),
      start, end: start + length, sourceHash: sha256(block.text)}];
  });
  if (tail) blocks.reverse();
  const readChars = maxChars - remaining;
  return {unitId: unit.id, sceneId: scene.id, title: scene.title, reason, source, sceneHash: sceneStateHash(scene), blocks,
    coverage: {mode: readChars < totalChars ? tail ? 'TAIL_EXCERPT' : 'HEAD_EXCERPT' : 'FULL_SCENE', totalChars, readChars,
      omittedChars: totalChars - readChars, omittedBlockIds: scene.blocks.filter(block => !blocks.some(read => read.id === block.id)).map(block => block.id)},
    notice: readChars < totalChars ? '这里只读取了明确标记的原文片段；更早／更晚原文仍在当前稿件中，需要时按场景与块ID读取，不能声称已通读全场。' : '当前稿件中的原文；不得把邻场内容作为本次可写范围。'};
}

/** Shared essential inputs for ordinary drafting, saved Agent drafts and review.
 * Caller chooses the authoritative snapshot; this function never merges candidates or chat into it. */
export function buildRequiredWritingContext(project: ScriptProject, options: RequiredWritingContextOptions) {
  const selected = project.units.filter(unit => options.unitIds.includes(unit.id));
  const source: ManuscriptContextSource = options.source || {kind: 'AUTHOR', id: project.id, version: project.revision};
  const planning = planningContext(project, options.unitIds, options);
  const maxChars = Math.max(1, Math.min(24000, options.maxExcerptChars || 6000));
  const evidence: ReturnType<typeof excerpt>[] = [];
  const allowedRawIds = options.readSceneIds ? new Set(options.readSceneIds) : null;
  const add = (unit: DeliveryUnit, scene: Scene | undefined, reason: string, tail = true) => {
    // Target raw belongs to the caller's independently enforced whole-scene/block/text read boundary.
    if (!scene || allowedRawIds && !allowedRawIds.has(scene.id) || scene.id === options.sceneId || !scene.blocks.some(block => block.text.trim()) || evidence.some(item => item.sceneId === scene.id)) return;
    evidence.push(excerpt(unit, scene, reason, source, maxChars, tail));
  };
  if (options.includeAdjacentBodies !== false) for (const unit of selected) {
    const unitIndex = project.units.findIndex(item => item.id === unit.id);
    const previous = project.units.slice(0, unitIndex).filter(item => item.scopeId === unit.scopeId).at(-1);
    if (previous) add(previous, [...previous.scenes].reverse().find(scene => scene.blocks.some(block => block.text.trim())), 'PREVIOUS_SAME_STORY_UNIT_END');
    const sceneIndex = unit.scenes.findIndex(scene => scene.id === options.sceneId);
    if (sceneIndex >= 0) {
      add(unit, unit.scenes[sceneIndex - 1], 'PREVIOUS_SCENE_END');
      if (['review', 'rewrite', 'text_rewrite', 'replace_blocks', 'replace_selection', 'scene_body'].includes(options.operation || ''))
        add(unit, unit.scenes[sceneIndex + 1], 'FOLLOWING_SCENE_CONTEXT', false);
    }
  }
  // An unrelated episode sharing a season label is not a source of character knowledge.
  const storyScopes = new Set(selected.map(unit => unit.scopeId));
  const relatedProject = {...project, units: project.units.filter(unit => storyScopes.has(unit.scopeId))};
  const readState = createContinuityReader(relatedProject);
  const knownInformation = selected.map(unit => {
    const scene = unit.scenes.find(item => item.id === options.sceneId) || unit.scenes[0];
    return {unitId: unit.id, sceneId: scene?.id || null, meaning: 'RECORDED_KNOWLEDGE_REQUIRES_MANUSCRIPT_EVIDENCE',
      states: scene ? readState(unit, scene.id) : [],
      guidance: '角色知识与观众知识分别保留；状态依据过期或故事时间不明时保持待核实，不能从未来规划补成确定事实。'};
  });
  const currentUnits = selected.map(unit => ({id: unit.id, title: unit.title, scopeId: unit.scopeId,
    ...(unit.seasonId ? {seasonId: unit.seasonId} : {}), targetDurationMs: unit.targetDurationMs,
    projectDefaultDurationMs: project.profile.targetDurationMs, summary: unit.summary, endingHook: unit.endingHook || '',
    structureNodes: unit.structureNodes || [],
    generation: unit.scenes.filter(scene => scene.generation).map(scene => ({sceneId: scene.id, ...scene.generation}))}));
  const outlineNodes=options.outlineNodeIds??(options.nodeId?[options.nodeId]:[]);
  const outlineTargets=selected.flatMap(unit=>outlineNodes.length?
    [{unitId:unit.id,nodeIds:outlineNodes},...(options.includeUnitOutlineRequirements?[{unitId:unit.id}]:[])]:[{unitId:unit.id}]);
  const outlineRequirements = ['plan', 'plan_scenes', 'scene_plan', 'plan_structure', 'scene', 'scene_body', 'append_scene_body', 'review'].includes(options.operation || '')
    ? {...collectOutlineRequirements(project, outlineTargets),
      guidance: '这些 ID 定位作者已经约定的大纲原文，不要求额外故事理论。分场时用 outlineRequirementIds 关联所展开的范围；无关项不勾选。已有正文数量不代表全部大纲已完成。'} : undefined;
  const outlineGuides=selected.flatMap(unit=>visibleOutlineGuides(project,unit).map(guide=>{
    const original=outlineText(project,guide.owner),nodes=guide.nodeLinks.filter(link=>link.unitId===unit.id&&(!outlineNodes.length||outlineNodes.includes(link.nodeId)));
    const beats=guide.beats.filter(beat=>(guide.owner.kind==='unit'||project.profile.organization==='standalone'||beat.unitIds.includes(unit.id)||beat.sceneRefs.some(ref=>ref.unitId===unit.id))&&(!outlineNodes.length||beat.anchors.every(anchor=>nodes.some(link=>anchorCurrent(link.anchor,original)&&anchor.start>=link.anchor.start&&anchor.end<=link.anchor.end))));
    return {unitId:unit.id,owner:guide.owner,nodes:nodes.map(link=>({...link,current:anchorCurrent(link.anchor,original)})),beats:beats.map(beat=>({...beat,sceneRefs:beat.sceneRefs.filter(ref=>ref.unitId===unit.id),current:beat.anchors.every(anchor=>anchorCurrent(anchor,original))})),meaning:'AUTHOR_PLANNING_NOT_MANUSCRIPT_EVIDENCE'};
  }));
  const blueprint = blueprintContext(project, options.unitIds, options);
  return {source, blueprint, blueprintHash: sha256(JSON.stringify(blueprint)), planning, currentUnits, outlineGuides,
    manuscript: {meaning: 'CURRENT_SNAPSHOT_MANUSCRIPT_EXCERPTS', source, excerpts: evidence,
      contextHash: sha256(JSON.stringify({source, evidence: evidence.map(item => ({sceneId: item.sceneId, sceneHash: item.sceneHash}))})),
      guidance: '只有这一作者稿或任务工作稿已保存的正文可作当前稿件事件依据；候选、聊天和流式片段均不包含。工作稿事件只在本工作稿有效，不自动成为作者稿事实。'},
    knownInformation, ...(outlineRequirements ? {outlineRequirements} : {}), planningHash: sha256(JSON.stringify(planning)),
    rules: '分别理解作者规划、当前稿件原文和当前位置已知信息。阅读上下文不授予修改权限；实际原文与旧规划矛盾时指出差异，不用规划覆盖原文。'};
}
