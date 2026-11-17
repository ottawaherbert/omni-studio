import type { ScriptOperation, ScriptProject } from './schema';
import { anchorCurrent, freezeOutlineGrant, getOutlineGuide, outlineText, ownerUnits, type OutlineGrant, type OutlineOwner } from './outlineGuides';
import { buildOutlineDevelopment } from './outlineDevelopment';
import { hashValue } from '../../domain/src/contentIdentity';

export interface OutlineTaskScope {
  outlineRange?: { start: number; end: number; text: string };
  outlineBeatIds?: string[];
}
export interface OutlineTaskTarget {
  operation: ScriptOperation; unitId: string; scopeId?: string; seasonId?: string;
}
export function outlineTaskOwner(project: ScriptProject, target: OutlineTaskTarget): OutlineOwner {
  const owner: OutlineOwner = target.operation === 'unit_outline' ? {kind:'unit',id:target.unitId}
    : target.operation === 'story_outline' ? {kind:'story',id:target.scopeId!}
    : target.operation === 'season_outline' ? {kind:'season',id:target.seasonId!}
    : target.operation === 'outline' ? {kind:'project',id:project.id}
    : (() => { throw new Error('本任务不接受大纲范围'); })();
  outlineText(project, owner);
  if (owner.kind !== 'project' && !ownerUnits(project,owner).some(unit=>unit.id===target.unitId)) throw new Error('任务单元不属于目标大纲范围');
  return owner;
}
export function freezeOutlineTask(project: ScriptProject, target: OutlineTaskTarget & OutlineTaskScope): OutlineGrant | undefined {
  if (target.outlineRange === undefined && target.outlineBeatIds === undefined) return;
  const range=target.outlineRange;
  if (!range || typeof range.text !== 'string') throw new Error('局部大纲任务需要明确的原文区间');
  return freezeOutlineGrant(project,outlineTaskOwner(project,target),{
    range:{start:range.start,end:range.end,quote:range.text}, outlineBeatIds:target.outlineBeatIds,
  });
}
export function applyOutlineTask(project: ScriptProject, grant: OutlineGrant, unitId: string, jobId: string, result: Record<string, unknown>) {
  if (grant.outlineBeatIds) {
    const beats=getOutlineGuide(project,grant.owner)?.beats??[];
    if (!Array.isArray(result.beats) || result.beats.length!==grant.outlineBeatIds.length
      || new Set(result.beats.map(beat=>beat?.id)).size!==grant.outlineBeatIds.length) throw new Error('返回必须完整保留本次选中的节拍编号');
    for (const beat of result.beats) {
      const prior=beats.find(item=>item.id===beat?.id);
      if (!prior || !grant.outlineBeatIds.includes(prior.id) || hashValue(beat.unitIds??null)!==hashValue(prior.unitIds)) throw new Error('节拍任务不能改变编号或所属单元');
    }
  } else if (result.beats !== null) {
    throw new Error('未选择节拍的原文任务不能修改节拍，beats 必须为 null');
  }
  return buildOutlineDevelopment(project,grant,unitId,jobId,result);
}
export function outlineTaskContext(project: ScriptProject, target: OutlineTaskTarget & OutlineTaskScope) {
  const owner=outlineTaskOwner(project,target), text=outlineText(project,owner);
  return {owner,text,...(target.outlineRange?{selectedRange:target.outlineRange}:{}),
    beats:(getOutlineGuide(project,owner)?.beats??[]).filter(beat=>!target.outlineBeatIds||target.outlineBeatIds.includes(beat.id))
      .map(beat=>({...beat,current:beat.anchors.every(anchor=>anchorCurrent(anchor,text))})),
    units:ownerUnits(project,owner).map(unit=>({id:unit.id,title:unit.title,summary:unit.summary})),
  };
}
export function currentTaskOutline(project: ScriptProject, target: OutlineTaskTarget & {outlineGrant?:OutlineGrant}) {
  try { const text=outlineText(project,outlineTaskOwner(project,target));return target.outlineGrant?text.slice(target.outlineGrant.start,target.outlineGrant.end):text; }
  catch { return '原大纲归属已变化，请查看任务输入原件。'; }
}
