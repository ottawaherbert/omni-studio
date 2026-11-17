import type { AssetProductionUse, BeatDirection, ProductionEventState, ProductionObservation, ProductionRequirement, ProductionWorkRecord } from '../../../packages/domain/src/productionCollaboration';
import type { SceneDirectorPlan } from '../../../packages/domain/src/directorPlan';
import type { Project, Scene } from '../../types/project';

const text = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown) => v === undefined || Array.isArray(v) && v.every(text);
function records<T>(value: unknown, label: string, valid: (item: any) => boolean): T[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some(item => !item || typeof item !== 'object' || !valid(item))) throw Object.assign(new Error(`${label}格式无效。`), { statusCode: 400 });
  return structuredClone(value);
}
export const readRequirements = (value: unknown) => records<ProductionRequirement>(value, '制作需求', i => text(i.id) && text(i.department) && text(i.description) && strings(i.targetIds) && strings(i.beatIds));
export const readBeatDirections = (value: unknown) => records<BeatDirection>(value, '节拍意图', i => text(i.beatId) && text(i.intent) && strings(i.shotIds));
export const readEventStates = (value: unknown) => records<ProductionEventState>(value, '事件状态', i => ['id', 'event', 'entityId', 'before', 'after'].every(k => text(i[k])) && strings(i.shotIds));
export const readObservations = (value: unknown) => records<ProductionObservation>(value, '实际观察', i => text(i.id) && text(i.note) && ['note', 'issue', 'unusable'].includes(i.impact) && strings(i.targetIds) && ['mediaUrl','contentHash','viewpointId','fixTargetId'].every(k => i[k] === undefined || text(i[k])) && ['startSeconds','endSeconds'].every(k => i[k] === undefined || Number.isFinite(i[k]) && i[k] >= 0) && (i.startSeconds === undefined || i.endSeconds === undefined || i.endSeconds >= i.startSeconds));
export const readWorkRecords = (value: unknown) => records<ProductionWorkRecord>(value, '工作记录', i => text(i.scopeKey) && ['reviewsUsed','repairsUsed'].every(k => Number.isInteger(i[k]) && i[k] >= 0) && ['maxReviews','maxRepairs'].every(k => i[k] == null || Number.isInteger(i[k]) && i[k] >= 0));
export function readProductionUse(value: unknown): AssetProductionUse {
  if (!value || typeof value !== 'object' || ['shotScale','dimensions','operations','limitations'].some(k => (value as any)[k] !== undefined && !text((value as any)[k]))) throw Object.assign(new Error('资产用途格式无效。'), {statusCode:400});
  return Object.fromEntries(['shotScale','dimensions','operations','limitations'].filter(k => (value as any)[k] !== undefined).map(k => [k,(value as any)[k]]));
}
export type { CollaborationPatch } from '../../../packages/domain/src/productionCollaboration';
import type { CollaborationPatch } from '../../../packages/domain/src/productionCollaboration';
export function readCollaborationPatch(raw: any): CollaborationPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('请提供本场修改内容。'),{statusCode:400});
  const patch: CollaborationPatch = {};
  if (raw.direction !== undefined) {
    const d=raw.direction;
    if (!d || typeof d !== 'object' || ['intent','rhythm'].some(k => d[k] !== undefined && !text(d[k])) || !strings(d.assumptions)) throw Object.assign(new Error('场面方案格式无效。'),{statusCode:400});
    patch.direction={...Object.fromEntries(['intent','rhythm','assumptions'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]])), ...(d.requirements!==undefined?{requirements:readRequirements(d.requirements)}:{}), ...(d.beatDirections!==undefined?{beatDirections:readBeatDirections(d.beatDirections)}:{})};
  }
  if(raw.eventStates!==undefined)patch.eventStates=readEventStates(raw.eventStates);
  if(raw.observations!==undefined)patch.observations=readObservations(raw.observations);
  if(raw.workRecords!==undefined)patch.workRecords=readWorkRecords(raw.workRecords);
  if(raw.beats!==undefined)patch.beats=records(raw.beats,'剧情节拍',i=>text(i.id)&&text(i.action));
  return patch;
}
export function productionNextActions(scene: Scene) {
  const records=scene.productionPreparation?.workRecords || [];
  const limited=records.filter(w=>w.handoff || w.maxRepairs!=null && w.repairsUsed>=w.maxRepairs || w.maxReviews!=null && w.reviewsUsed>=w.maxReviews);
  return {
    workRecords: records,
    notices: (scene.productionPreparation?.observations || []).filter(o=>o.impact!=='note'),
    nextActions: limited.length ? limited.map(w=>({scopeKey:w.scopeKey,action:'handoff',description:w.nextStep || '交付已有成果与问题，继续其他范围。'}))
      : [{scopeKey:scene.id,action:'continue',description:scene.shots?.length?'继续本场素材或整场粗剪，按约定交付。':'可同次设计场面与镜头，无需额外审批。'}],
  };
}
export function sceneProductionAssets(project: Partial<Project>, scene: Scene) {
  const ids=new Set([...(scene.breakdown?.characterIds||[]),...(scene.breakdown?.propIds||[]),...(scene.breakdown?.vehicleIds||[]),scene.breakdown?.locationId,...(scene.shots||[]).flatMap(s=>[...(s.characterIdsInShot||[]),...(s.propIds||[]),...(s.vehicleIds||[]),...(s.dialogueLines||[]).flatMap(l=>l.characterId?[l.characterId]:[]),s.locationId])]);
  return [...(project.characters||[]),...(project.assets||[])].filter(a=>ids.has(a.id)&&a.productionUse).map(a=>({id:a.id,name:a.name,productionUse:a.productionUse}));
}

/** Only an observed, explicitly unusable exact reference affects execution. */
export function observedReferenceIssue(scene: Scene | undefined, reference: {mediaUrl:string;contentHash?:string}, shotIds: string[]) {
  return scene?.productionPreparation?.observations?.find(o=>o.impact==='unusable' && o.mediaUrl===reference.mediaUrl && (!o.contentHash || o.contentHash===reference.contentHash) && (!o.targetIds?.length || o.targetIds.some(id=>id===scene.id || shotIds.includes(id))))?.note;
}
