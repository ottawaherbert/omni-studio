import {freezeSceneOrder,reorderScenes,type SceneOrderGrant} from './sceneOrder';
import {assertOutlineDevelopment} from './outlineDevelopment';
import {freezeOutlineGrant, outlineText, type OutlineGrant} from './outlineGuides';
import { BLUEPRINT_BRIEF_FIELDS, CHARACTER_TEXT_FIELDS, type BlueprintBriefField } from './blueprint';
import { hashValue } from '../../agent-core/src/identity';
import { blocksToScreenplayText, screenplayBlockTextRanges } from './fountainAdapter';
import { unitCharacters } from './continuity';
import { applyWorkspacePatch, createWorkspacePatch, type WorkspacePatch } from './workspacePatch';
import type { ScriptProject } from './schema';
import { assertFrozenStructureScopeCurrent, freezeStructureScope, insertScenesInStructure, type FrozenStructureScope } from './structure';
import { appendSceneContinuation, generatedSceneState, type SceneContinuationCheckpoint } from './continuation';
import { sceneHasAuthorWork } from './planning';
import { validOutlineRequirementIds } from './goalCoverage';

export const AGENT_DRAFT_OPERATIONS = ['concept', 'theme', 'audienceExperience', 'constraints', 'update_character', 'update_fact', 'scene_order','outline_development', 'project_outline', 'story_outline', 'season_outline', 'unit_outline', 'add_unit', 'plan_structure', 'plan_scenes',
  'scene_plan', 'scene_body', 'append_scene_body', 'replace_blocks', 'replace_selection', 'add_character', 'add_fact'] as const;
export type AgentDraftOperation = typeof AGENT_DRAFT_OPERATIONS[number];
export type DraftSelection = { start: number; end: number; text: string };
export type DraftSceneScope = { sceneId: string; allowPlan: boolean; allowBody: boolean; blockIds: string[] | null; selection?: DraftSelection };
export type DraftUnitScope = { unitId: string; allowSummary: boolean; allowAllScenes: boolean; maxNewScenes: number; scenes: DraftSceneScope[]; allowStructure?:boolean; nodeScopes?:FrozenStructureScope[] };
export type DraftUnitSlot = { slotId: string; unitId: string; scopeId: string; targetDurationMs: number; maxNewScenes: number };
/** Persist this JSON with the authorization, never with a model response. The
 * origin is the author's frozen grant baseline, not each candidate's baseline. */
export type ScriptDraftScope = {
  workspaceId: string; documentId: string; originRevision: number; originContentHash: string;
  operations: AgentDraftOperation[]; units: DraftUnitScope[]; newUnitSlots: DraftUnitSlot[];
  sharedFields: Array<BlueprintBriefField | 'outline'>;
  characterIds?: string[]; factIds?: string[]; characterScopeIds: string[]; factScopeIds: string[];
  storyOutlineScopeIds?: string[]; seasonOutlineIds?: string[]; outlineGrants?:OutlineGrant[];sceneOrderGrants?:SceneOrderGrant[];
};
/** The repository extends this only when the candidate patch and Step effect
 * commit atomically. IDs are cumulative across all calls in this grant. */
export type ScriptDraftCreationLedger = {
  units: Array<{ slotId: string; unitId: string }>;
  scenes: Array<{ unitId: string; sceneId: string }>;
  blocks: Array<{ sceneId: string; blockId: string; originBlockIds: string[] }>;
  characters: Array<{ scopeId: string; id: string }>;
  facts: Array<{ scopeId: string; id: string }>;
};
export const emptyScriptDraftCreationLedger = (): ScriptDraftCreationLedger => ({ units: [], scenes: [], blocks: [], characters: [], facts: [] });
export type DraftPatchCheck = { origin: ScriptProject; ledger: ScriptDraftCreationLedger; blockIds?: string[]; selection?: DraftSelection; slotId?: string; entityId?: string;
  candidateId?:string; unitId?:string; sceneId?:string; scopeId?:string; seasonId?:string; nodeId?:string; beforeSceneId?:string; afterSceneId?:string; continuationCheckpoint?:SceneContinuationCheckpoint };
const id = (value: unknown) => typeof value === 'string' && /^[\w-]{1,120}$/.test(value);
const unique = (values: string[]) => new Set(values).size === values.length;
const same = (a: unknown, b: unknown) => hashValue(a) === hashValue(b);
const deny = (reason: string): never => { throw new Error(`候选越过冻结写作范围：${reason}`); };
const allIds = (project: ScriptProject) => new Set([project.id, ...project.units.flatMap(unit => [unit.id, ...(unit.structureNodes??[]).map(node=>node.id), ...unit.scenes.flatMap(scene => [scene.id, ...scene.blocks.map(block => block.id)])]),
  ...project.characters.map(character => character.id), ...project.facts.map(fact => fact.id)]);

export function validateScriptDraftScope(origin: ScriptProject, scope: ScriptDraftScope): void {
  if (!id(scope.workspaceId) || !id(scope.documentId) || origin.id !== scope.documentId || origin.revision !== scope.originRevision ||
    hashValue(origin) !== scope.originContentHash) deny('原授权稿身份或版本不一致');
  if (!Array.isArray(scope.operations) || !unique(scope.operations) ||
    scope.operations.some(value => !AGENT_DRAFT_OPERATIONS.includes(value))) deny('操作白名单无效');
  if (!Array.isArray(scope.units) || !Array.isArray(scope.newUnitSlots) || !Array.isArray(scope.sharedFields) ||
    !Array.isArray(scope.characterScopeIds) || !Array.isArray(scope.factScopeIds)) deny('授权结构无效');
  const unitIds = scope.units.map(unit => unit.unitId), slots = scope.newUnitSlots.map(slot => slot.slotId);
  if (!unique(unitIds) || !unique(slots) || !unique(scope.newUnitSlots.map(slot => slot.unitId)) ||
    !unique(scope.sharedFields) || !unique(scope.characterScopeIds) || !unique(scope.factScopeIds)) deny('授权目标重复');
  if (scope.sharedFields.some(field => ![...BLUEPRINT_BRIEF_FIELDS, 'outline'].includes(field))) deny('共享字段不在白名单');
  for(const [key,valid] of [['storyOutlineScopeIds',new Set(origin.units.map(unit=>unit.scopeId).filter(value=>value!==origin.id&&!origin.seasons?.some(season=>season.id===value)))],['seasonOutlineIds',new Set(origin.seasons?.map(season=>season.id)??[])]] as const){
    const values=scope[key]??[];if(!Array.isArray(values)||!unique(values)||values.some(value=>!valid.has(value)))deny('故事或季大纲授权无效');
  }
  for(const [key,entities] of [['characterIds',origin.characters],['factIds',origin.facts]] as const){
    const selected=scope[key]??[];
    if(!Array.isArray(selected)||!unique(selected)||selected.some(value=>!entities.some(entity=>entity.id===value)))deny('待修改人物或设定不存在');
  }
  for(const grant of scope.sceneOrderGrants??[])if(!scope.units.some(u=>u.unitId===grant.unitId)||!same(grant,freezeSceneOrder(origin,grant.unitId,grant.nodeId)))deny('场序授权与冻结稿不一致');
  if(scope.outlineGrants){if(!Array.isArray(scope.outlineGrants)||scope.outlineGrants.length>1)deny('大纲原文授权无效');for(const grant of scope.outlineGrants)if(!same(grant,freezeOutlineGrant(origin,grant.owner,{...grant,...(!grant.nodeId&&(grant.start!==0||grant.end!==outlineText(origin,grant.owner).length)?{range:{start:grant.start,end:grant.end,quote:outlineText(origin,grant.owner).slice(grant.start,grant.end)}}:{})})))deny('大纲原文授权与冻结稿不符');}
  const existing = allIds(origin);
  for (const slot of scope.newUnitSlots) {
    const allowedScopes=new Set([slot.unitId,origin.id,...(origin.seasons??[]).map(season=>season.id),...origin.units.map(unit=>unit.scopeId)]);
    if (![slot.slotId, slot.unitId, slot.scopeId].every(id) || existing.has(slot.unitId) || !Number.isSafeInteger(slot.targetDurationMs) || slot.targetDurationMs < 1 ||
      !Number.isSafeInteger(slot.maxNewScenes) || slot.maxNewScenes < 0 || !unitIds.includes(slot.unitId) ||
      !allowedScopes.has(slot.scopeId)) deny('新单元槽无效');
  }
  for (const unit of scope.units) {
    const old = origin.units.find(item => item.id === unit.unitId), slot = scope.newUnitSlots.find(item => item.unitId === unit.unitId);
    if (!old && !slot || !id(unit.unitId) || typeof unit.allowSummary !== 'boolean' || typeof unit.allowAllScenes !== 'boolean' ||
      !Number.isSafeInteger(unit.maxNewScenes) || unit.maxNewScenes < 0 || !Array.isArray(unit.scenes) ||
      slot && unit.maxNewScenes !== slot.maxNewScenes || !unique(unit.scenes.map(scene => scene.sceneId))) deny('单元授权无效');
    if(unit.allowStructure!==undefined&&typeof unit.allowStructure!=='boolean')deny('结构授权无效');
    if(unit.nodeScopes!==undefined){
      if(!Array.isArray(unit.nodeScopes)||!unique(unit.nodeScopes.map(node=>node.nodeId))||unit.nodeScopes.length&&(!old||unit.allowAllScenes||unit.allowStructure))deny('节点授权不能隐式扩大为全单元');
      for(const node of unit.nodeScopes){
        if(!same(node,freezeStructureScope(origin,unit.unitId,node.nodeId,{allowCreate:node.allowCreate,stopAfterSceneId:node.stopAfterSceneId})))deny('节点授权不是原稿冻结范围');
      }
      if(unit.nodeScopes.length&&unit.scenes.some(scene=>!unit.nodeScopes!.some(node=>node.sceneIds.includes(scene.sceneId))))deny('显式场景跨出节点授权');
    }
    for (const scene of unit.scenes) {
      const previous = old?.scenes.find(item => item.id === scene.sceneId);
      if (!previous || typeof scene.allowPlan !== 'boolean' || typeof scene.allowBody !== 'boolean' ||
        !(scene.blockIds === null || Array.isArray(scene.blockIds) && scene.blockIds.every(blockId => previous.blocks.some(block => block.id === blockId)) && unique(scene.blockIds))) deny('场景授权无效');
      if (scene.selection) {
        const rendered = blocksToScreenplayText(previous.blocks, unitCharacters(origin, old!));
        const { start, end, text } = scene.selection;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || rendered.slice(start, end) !== text) deny('文字选区与原授权稿不一致');
      }
    }
  }
  const scopes = new Set([origin.id, ...origin.units.flatMap(unit => [unit.id, unit.scopeId,...(unit.seasonId?[unit.seasonId]:[])]), ...scope.newUnitSlots.flatMap(slot => [slot.unitId, slot.scopeId])]);
  if ([...scope.characterScopeIds, ...scope.factScopeIds].some(value => !scopes.has(value))) deny('人物或事实作用域无效');
}

function sceneGrant(scope: ScriptDraftScope, unitId: string, sceneId: string, ledger: ScriptDraftCreationLedger,current:ScriptProject): DraftSceneScope | null {
  const unit = scope.units.find(item => item.unitId === unitId);
  if (!unit) return null;
  if(unit.nodeScopes?.length){
    const scene=current.units.find(item=>item.id===unitId)?.scenes.find(item=>item.id===sceneId);
    const node=unit.nodeScopes.find(node=>(node.sceneIds.includes(sceneId)||node.allowCreate&&ledger.scenes.some(entry=>entry.unitId===unitId&&entry.sceneId===sceneId))&&[node.nodeId,...node.descendantNodeIds].includes(scene?.structureNodeId??''));
    if(!node)return null;
    if(node.stopAfterSceneId&&node.sceneIds.indexOf(sceneId)>node.sceneIds.indexOf(node.stopAfterSceneId))return null;
    return unit.scenes.find(item=>item.sceneId===sceneId)??{sceneId,allowPlan:true,allowBody:true,blockIds:null};
  }
  const listed = unit.scenes.find(item => item.sceneId === sceneId);
  if (listed) return listed;
  if (unit.allowAllScenes || ledger.scenes.some(item => item.unitId === unitId && item.sceneId === sceneId))
    return { sceneId, allowPlan: true, allowBody: true, blockIds: null };
  return null;
}
function permittedOutlineRequirements(project:ScriptProject,grant:DraftUnitScope,nodeId?:string):Set<string>{
  if(grant.nodeScopes?.length)return new Set(grant.nodeScopes
    .filter(node=>[node.nodeId,...node.descendantNodeIds].includes(nodeId??''))
    .flatMap(node=>validOutlineRequirementIds(project,grant.unitId,node.nodeId)));
  // Selecting one scene narrows the write target, including when adopting a
  // whole-unit candidate; it does not detach that scene from its unit outline.
  return new Set(validOutlineRequirementIds(project,grant.unitId));
}
export function assertStructureScopesCurrent(current:ScriptProject,scope:ScriptDraftScope,ledger:ScriptDraftCreationLedger):void{
  for(const unit of scope.units){
    for(const node of unit.nodeScopes??[])assertFrozenStructureScopeCurrent(current,unit.unitId,node,ledger.scenes);
    if(unit.nodeScopes?.length)for(const created of ledger.scenes.filter(entry=>entry.unitId===unit.unitId)){
      const scene=current.units.find(item=>item.id===unit.unitId)?.scenes.find(item=>item.id===created.sceneId);
      if(!scene||!unit.nodeScopes.some(node=>node.allowCreate&&[node.nodeId,...node.descendantNodeIds].includes(scene.structureNodeId??'')))deny('创建场景已移出冻结节点');
    }
  }
}
export function assertContinuationReplayScope(current:ScriptProject,scope:ScriptDraftScope,check:DraftPatchCheck):void{
  validateScriptDraftScope(check.origin,scope);assertStructureScopesCurrent(current,scope,check.ledger);
  const grant=check.unitId&&check.sceneId?sceneGrant(scope,check.unitId,check.sceneId,check.ledger,current):null;
  if(current.id!==scope.documentId||!scope.operations.includes('append_scene_body')||!grant?.allowBody||grant.blockIds!==null||grant.selection)deny('续写重放不属于当前授权');
}
export function selectionBlockIds(project: ScriptProject, unitId: string, sceneId: string, selection: DraftSelection): string[] {
  const unit = project.units.find(item => item.id === unitId), scene = unit?.scenes.find(item => item.id === sceneId);
  if (!unit || !scene) return [];
  const characters = unitCharacters(project, unit), affected: string[] = [];
  const ranges=screenplayBlockTextRanges(scene.blocks,characters);
  for (const range of ranges) {
    // The dialogue group's rendered span includes its preceding parenthetical.
    // A selection wholly inside the parenthetical cannot authorize dialogue.
    if(scene.blocks[range.index]?.type==='dialogue'&&scene.blocks[range.index-1]?.type==='parenthetical'){
      const parenthetical=ranges.find(item=>item.index===range.index-1);
      if(parenthetical&&selection.start>=parenthetical.start&&selection.end<=parenthetical.end)continue;
    }
    if (selection.start < range.end && selection.end > range.start) affected.push(scene.blocks[range.index].id);
  }
  return affected;
}
const appended = (previous: string[], next: string[], count: number) => next.length === previous.length + count && previous.every((id, index) => next[index] === id) && unique(next);
const plain = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function modelBlocksClean(blocks: ScriptProject['units'][number]['scenes'][number]['blocks']) {
  return blocks.every(block => onlyKeys(block, ['id', 'type', 'text', 'speakerId', 'speakerName']) &&
    (block.type === 'dialogue' ? Boolean(block.speakerId) !== Boolean(block.speakerName) : !block.speakerId && !block.speakerName));
}

/** Revalidate a typed patch independently of the model parser. The repository
 * must pass its trusted origin and cumulative ledger, then repeat this check
 * inside the same transaction as applyFromRun/commitStep. */
export function assertAgentDraftScope(current: ScriptProject, patch: WorkspacePatch, scope: ScriptDraftScope,
  operation: AgentDraftOperation, check: DraftPatchCheck): void {
  validateScriptDraftScope(check.origin, scope);
  assertStructureScopesCurrent(current,scope,check.ledger);
  if (current.id !== scope.documentId || current.revision < scope.originRevision || !scope.operations.includes(operation)) deny('当前稿或操作不属于授权');
  const next = applyWorkspacePatch(current, patch);
  const diff = createWorkspacePatch(current, next);
  if (!same(diff, patch) || !diff.operations.length) deny('候选补丁不是当前稿的最小有效变更');
  if(operation==='scene_order'){const grant=scope.sceneOrderGrants?.find(g=>g.unitId===check.unitId&&g.nodeId===check.nodeId);if(!grant)deny('场序未授权');const actual=next.units.find(u=>u.id===grant.unitId);const expected=reorderScenes(current,grant,actual?.scenes.filter(s=>grant.sceneIds.includes(s.id)).map(s=>s.id));if(!same(expected,next))deny('场序候选不能改动正文或其他字段');return;}
  if(operation==='outline_development'){const grant=scope.outlineGrants?.[0];if(!grant||!check.unitId||!scope.units.some(unit=>unit.unitId===check.unitId)||grant.nodeId!==check.nodeId)deny('缺少明确的大纲原文授权');assertOutlineDevelopment(current,next,grant,check.unitId);return;}
  const oldIds = allIds(current);
  const newSceneIds = next.units.flatMap(unit => unit.scenes.filter(scene => !current.units.some(old => old.scenes.some(item => item.id === scene.id))).map(scene => ({ unitId: unit.id, sceneId: scene.id })));
  for (const unit of scope.units) {
    const consumed = check.ledger.scenes.filter(item => item.unitId === unit.unitId).length;
    if (consumed + newSceneIds.filter(item => item.unitId === unit.unitId).length > unit.maxNewScenes) deny('新场景累计额度已用尽');
  }
  for (const entry of check.ledger.scenes) if (!scope.units.some(unit => unit.unitId === entry.unitId) ||
    !current.units.find(unit => unit.id === entry.unitId)?.scenes.some(scene => scene.id === entry.sceneId)) deny('创建台账与当前稿不匹配');
  for (const entry of check.ledger.units) if (!scope.newUnitSlots.some(slot => slot.slotId === entry.slotId && slot.unitId === entry.unitId) ||
    !current.units.some(unit => unit.id === entry.unitId)) deny('新单元台账与当前稿不匹配');
  for (const reserved of scope.newUnitSlots) if (current.units.some(unit => unit.id === reserved.unitId) &&
    !check.ledger.units.some(entry => entry.slotId === reserved.slotId && entry.unitId === reserved.unitId)) deny('已创建的新单元缺少授权台账');
  const slot = check.slotId ? scope.newUnitSlots.find(item => item.slotId === check.slotId) : undefined;
  for (const change of diff.operations) {
    const { key, field, after } = change;
    if (key === 'project/brief') {
      const expected = operation === 'project_outline' ? 'outline' : operation;
      if (!field || ![...BLUEPRINT_BRIEF_FIELDS, 'outline'].includes(field) || field !== expected || !scope.sharedFields.includes(field as BlueprintBriefField | 'outline')) deny('共享大纲字段未授权');
    } else if(key.startsWith('storyOutline/')){
      const scopeId=key.slice('storyOutline/'.length),outline=next.storyOutlines?.find(item=>item.scopeId===scopeId);
      if(operation!=='story_outline'||scopeId!==check.scopeId||!scope.storyOutlineScopeIds?.includes(scopeId)||!after.present||!outline||
        (field!==undefined&&field!=='outline')||!onlyKeys(outline,['scopeId','outline']))deny('故事大纲未授权');
    } else if(key.startsWith('seasons/')){
      const seasonId=key.slice('seasons/'.length);
      if(operation!=='season_outline'||seasonId!==check.seasonId||!scope.seasonOutlineIds?.includes(seasonId)||field!=='arc'||!after.present)deny('季大纲未授权');
    } else if (key === 'project/profile') {
      if (operation !== 'add_unit' || field !== 'plannedUnits' || next.profile.plannedUnits !== Math.max(current.profile.plannedUnits, next.units.length)) deny('不得改变作品配置或时长');
    } else if (key === 'order/units') {
      if (operation !== 'add_unit' || !slot || !appended(current.units.map(unit => unit.id), next.units.map(unit => unit.id), 1) || next.units.at(-1)?.id !== slot.unitId) deny('新单元顺序或身份无效');
    } else if (key.startsWith('unit/')) {
      const unitId = key.slice(5), grant = scope.units.find(item => item.unitId === unitId);
      if (!grant) deny('单元不在授权范围');
      if (operation === 'add_unit') {
        const unit = next.units.find(item => item.id === unitId);
        if (!slot || unitId !== slot.unitId || field !== undefined || !after.present || oldIds.has(unitId) ||
          !unit || !onlyKeys(unit, ['id', 'title', 'summary', 'scopeId', 'targetDurationMs', 'scenes', 'timeline', 'timingEvidence']) ||
          unit.scopeId !== slot.scopeId || unit.targetDurationMs !== slot.targetDurationMs || unit.timeline.length || unit.timingEvidence.length || unit.scenes.length) deny('新单元携带未授权字段');
      } else if(operation==='plan_structure'){
        if(field!=='structureNodes'||!grant.allowStructure||!grant.allowAllScenes||current.units.find(unit=>unit.id===unitId)?.structureNodes?.length)deny('只能首次规划明确授权的全单元结构');
        const nodes=next.units.find(unit=>unit.id===unitId)?.structureNodes;
        if(!nodes?.length||nodes.length>100||nodes.some(node=>oldIds.has(node.id)||!onlyKeys(node,['id','title','parentId','purpose'])))deny('首次结构节点身份或字段无效');
      } else if (operation !== 'unit_outline' || field !== 'summary' || !grant.allowSummary) deny('单元字段未授权');
    } else if (key.startsWith('sceneOrder/')) {
      const unitId = key.slice(11), oldUnit = current.units.find(item => item.id === unitId), newUnit = next.units.find(item => item.id === unitId);
      if (operation === 'add_unit') {
        if (!slot || unitId !== slot.unitId || field !== undefined || oldUnit || !newUnit || newUnit.scenes.length) deny('新单元场序无效');
      } else {
        if(operation!=='plan_scenes'||!oldUnit||!newUnit||!scope.units.some(unit=>unit.unitId===unitId))deny('场序操作未授权');
        const removed=oldUnit.scenes.filter(scene=>!newUnit.scenes.some(item=>item.id===scene.id));
        if(removed.length&&(oldUnit.scenes.length!==1||removed.length!==1||sceneHasAuthorWork(removed[0],current)||removed[0].structureNodeId))deny('已有作者场景不能删除');
        const insertionBase=structuredClone(current);insertionBase.units.find(unit=>unit.id===unitId)!.scenes=oldUnit.scenes.filter(scene=>!removed.some(item=>item.id===scene.id));
        const additions=newUnit.scenes.filter(scene=>!oldUnit.scenes.some(item=>item.id===scene.id));
        const expected=insertScenesInStructure(insertionBase,unitId,additions,{nodeId:check.nodeId,beforeSceneId:check.beforeSceneId,afterSceneId:check.afterSceneId});
        if(!same(expected.units.find(unit=>unit.id===unitId)!.scenes.map(scene=>scene.id),newUnit.scenes.map(scene=>scene.id)))deny('已有场景不能重排或越过指定插入点');
      }
    } else if (key.startsWith('scene/')) {
      const [, unitId, sceneId] = key.split('/');
      const before = current.units.find(unit => unit.id === unitId)?.scenes.find(scene => scene.id === sceneId);
      const afterScene = next.units.find(unit => unit.id === unitId)?.scenes.find(scene => scene.id === sceneId);
      if (!afterScene) {
        const oldUnit=current.units.find(unit=>unit.id===unitId)!,grant=scope.units.find(unit=>unit.unitId===unitId);
        if(operation==='plan_scenes'&&before&&oldUnit.scenes.length===1&&!sceneHasAuthorWork(before,current)&&!before.structureNodeId&&grant?.allowAllScenes)continue;
        deny('不得删除场景');
      }
      if (!before) {
        if (operation !== 'plan_scenes' || field !== undefined || !scope.units.some(unit => unit.unitId === unitId) || oldIds.has(sceneId) ||
          !onlyKeys(afterScene, ['id', 'title', 'location', 'timeOfDay', 'storyTime', 'purpose', 'entryState', 'exitState', 'characterIds', 'targetDurationMs', 'blocks','structureNodeId','outlineRequirementIds']) ||
          afterScene.blocks.length || afterScene.characterIds.length || afterScene.targetDurationMs !== 0 || afterScene.entryState || afterScene.exitState || afterScene.storyTime) deny('新场景携带未授权正文或元数据');
        const unitGrant=scope.units.find(unit=>unit.unitId===unitId)!;
        if(afterScene.structureNodeId!==check.nodeId||unitGrant.nodeScopes?.length&&!unitGrant.nodeScopes.some(node=>node.allowCreate&&[node.nodeId,...node.descendantNodeIds].includes(check.nodeId??'')&&!node.stopAfterSceneId))deny('新场景不在授权的创建节点或越过停点');
        const valid=permittedOutlineRequirements(current,unitGrant,check.nodeId);if(afterScene.outlineRequirementIds?.some(id=>!valid.has(id)))deny('分场引用了当前范围外的大纲要求');
      } else {
        if(operation==='plan_structure'){
          const unitGrant=scope.units.find(unit=>unit.unitId===unitId);
          if(field!=='structureNodeId'||!unitGrant?.allowStructure||!unitGrant.allowAllScenes||current.units.find(unit=>unit.id===unitId)?.structureNodes?.length)deny('结构规划不能改动正文或已有目录');
          continue;
        }
        const grant = sceneGrant(scope, unitId, sceneId, check.ledger,current);
        if(operation==='scene_plan'){
          if(!grant||!grant.allowPlan||!field||!['title','purpose','location','timeOfDay','entryState','exitState','outlineRequirementIds'].includes(field))deny('节拍或分场字段未授权');
          const valid=permittedOutlineRequirements(current,scope.units.find(unit=>unit.unitId===unitId)!,before.structureNodeId);if(afterScene.outlineRequirementIds?.some(id=>!valid.has(id)))deny('场景引用了当前范围外的大纲要求');
          continue;
        }
        if (!grant || !['blocks','generation'].includes(field??'') || !grant.allowBody || !['scene_body', 'append_scene_body', 'replace_blocks', 'replace_selection'].includes(operation)) deny('场景正文不在授权范围');
        if(field==='generation'&&operation!=='scene_body'&&operation!=='append_scene_body')deny('局部改写不能自报全场完成');
        if(operation==='append_scene_body'){
          if(grant.blockIds!==null||grant.selection||!check.continuationCheckpoint||!check.candidateId||!afterScene.generation)deny('同场续写缺少整场授权或检查点');
          const appended=afterScene.blocks.slice(before.blocks.length);
          const expected=appendSceneContinuation(current,unitId,sceneId,appended,{stepId:check.candidateId,checkpoint:check.continuationCheckpoint,isComplete:afterScene.generation.status==='complete'});
          if(!same(expected.project.units.find(unit=>unit.id===unitId)!.scenes.find(scene=>scene.id===sceneId),afterScene))deny('续写改动了检查点以前的原文或完成台账');
        }
        if(operation==='scene_body'){
          if(!check.candidateId||!afterScene.generation||!same(afterScene.generation,generatedSceneState({...afterScene,generation:before.generation},check.candidateId,hashValue(afterScene.blocks),true)))deny('正文完成台账无效');
        }
        if (!modelBlocksClean(afterScene.blocks.filter(block => !before.blocks.some(old => same(old, block))))) deny('正文块夹带未知字段或说话者');
        if (operation === 'scene_body' && (grant.blockIds !== null || grant.selection)) deny('局部块或选区授权不能替换整场');
        if (operation === 'replace_blocks') {
          if (grant.selection) deny('文字选区授权不能改写整块');
          const ids = check.blockIds, oldBlocks = before.blocks, newBlocks = afterScene.blocks;
          if (!ids?.length || !unique(ids) || ids.some(id => !oldBlocks.some(block => block.id === id))) deny('待改块无效');
          const start = oldBlocks.findIndex(block => block.id === ids[0]);
          if (ids.some((id, index) => oldBlocks[start + index]?.id !== id) ||
            newBlocks.length <= oldBlocks.length - ids.length ||
            !same(oldBlocks.slice(0, start), newBlocks.slice(0, start)) ||
            !same(oldBlocks.slice(start + ids.length), newBlocks.slice(newBlocks.length - (oldBlocks.length - start - ids.length)))) deny('局部块以外的原文被改动');
          if (grant.blockIds !== null) {
            const derived = check.ledger.blocks.filter(item => item.sceneId === sceneId && item.originBlockIds.some(id => grant.blockIds!.includes(id))).map(item => item.blockId);
            if (ids.some(id => !grant.blockIds!.includes(id) && !derived.includes(id))) deny('块不在原授权或派生范围');
          }
        }
        if (operation === 'replace_selection') {
          const selection = check.selection, unit = current.units.find(item => item.id === unitId)!;
          const originalText = blocksToScreenplayText(before.blocks, unitCharacters(current, unit));
          const nextText = blocksToScreenplayText(afterScene.blocks, unitCharacters(next, next.units.find(item => item.id === unitId)!));
          if (!selection || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 ||
            selection.end <= selection.start || originalText.slice(selection.start, selection.end) !== selection.text ||
            grant.selection && !same(grant.selection, selection) || !nextText.startsWith(originalText.slice(0, selection.start)) ||
            !nextText.endsWith(originalText.slice(selection.end))) deny('选区以外的正文被改动');
          const affected = selectionBlockIds(current, unitId, sceneId, selection);
          if (affected.length === 1) {
            const index = before.blocks.findIndex(block => block.id === affected[0]);
            const originalBlock = before.blocks[index];
            if (afterScene.blocks.length === before.blocks.length && afterScene.blocks[index]?.id === originalBlock.id) {
              const range=screenplayBlockTextRanges(before.blocks,unitCharacters(current,unit)).find(item=>item.index===index);
              const leading = originalBlock.text.length - originalBlock.text.trimStart().length;
              const wrapper = originalBlock.type==='parenthetical'&&/^[（(]/.test(originalBlock.text.trim())?1:0;
              const rawStart = leading + wrapper + selection.start - (range?.bodyStart??-1);
              const rawEnd = leading + wrapper + selection.end - (range?.bodyStart??-1);
              if (!range || selection.start<range.bodyStart || selection.end>range.bodyEnd || rawStart < leading || rawEnd > originalBlock.text.length ||
                !same(before.blocks.slice(0, index), afterScene.blocks.slice(0, index)) ||
                !same(before.blocks.slice(index + 1), afterScene.blocks.slice(index + 1)) ||
                !same({ ...originalBlock, text: '' }, { ...afterScene.blocks[index], text: '' }) ||
                !afterScene.blocks[index].text.startsWith(originalBlock.text.slice(0, rawStart)) ||
                !afterScene.blocks[index].text.endsWith(originalBlock.text.slice(rawEnd))) deny('选区外原始块数据被改动');
            } else if (originalBlock.text !== originalBlock.text.trim()) deny('选区涉及不能无损解析的原始空白');
          } else if (affected.some(id => { const block = before.blocks.find(item => item.id === id)!; return block.text !== block.text.trim(); }))
            deny('多块选区涉及不能无损解析的原始空白');
          if (grant.blockIds !== null) {
            const derived = check.ledger.blocks.filter(item => item.sceneId === sceneId && item.originBlockIds.some(id => grant.blockIds!.includes(id))).map(item => item.blockId);
            if (!affected.length || affected.some(id => !grant.blockIds!.includes(id) && !derived.includes(id))) deny('文字选区跨出授权块');
          }
        }
      }
    } else if (key === 'order/characters' || key === 'order/facts') {
      const characters = key === 'order/characters', previous = characters ? current.characters.map(item => item.id) : current.facts.map(item => item.id),
        proposed = characters ? next.characters.map(item => item.id) : next.facts.map(item => item.id);
      if (operation !== (characters ? 'add_character' : 'add_fact') || !appended(previous, proposed, 1)) deny('人物或事实集合只能追加');
    } else if (key.startsWith('characters/') || key.startsWith('facts/')) {
      const character = key.startsWith('characters/'), entityId = key.split('/')[1], entity = character ? next.characters.find(item => item.id === entityId) : next.facts.find(item => item.id === entityId);
      const scopes = character ? scope.characterScopeIds : scope.factScopeIds;
      if(operation===(character?'update_character':'update_fact')){
        const allowedIds=character?scope.characterIds:scope.factIds;
        if(entityId!==check.entityId||!allowedIds?.includes(entityId)||!oldIds.has(entityId)||!entity||!after.present||!field||
          !(character?[...CHARACTER_TEXT_FIELDS]:['text','status']).includes(field as any))deny('只能修改指定人物或设定的资料字段');
        continue;
      }
      if (operation !== (character ? 'add_character' : 'add_fact') || field !== undefined || !after.present || oldIds.has(entityId) ||
        !entity || !onlyKeys(entity, character ? ['id', 'name', 'bio', 'scopeId', 'desire', 'need', 'contradiction', 'arc', 'voice'] : ['id', 'text', 'scopeId', 'status']) ||
        !scopes.includes(entity.scopeId) || !character && next.facts.find(item => item.id === entityId)?.status !== 'draft') deny('人物或事实新增越权');
    } else deny(`禁止修改 ${key}`);
  }
  if (operation === 'plan_scenes' && (!newSceneIds.length || newSceneIds.length > 30)) deny('单批分场必须为 1–30 场');
  if (operation === 'add_unit' && (!slot || check.ledger.units.some(item => item.slotId === slot.slotId))) deny('新单元槽已使用或不存在');
  if (operation === 'replace_selection' && !plain(check.selection)) deny('缺少精确文字选区');
}
