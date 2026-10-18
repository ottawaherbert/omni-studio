import { sha256 } from 'js-sha256';
import { parseScriptProject, type ScriptProject } from './schema';

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('结构变更不能包含未定义的值');
  return result;
};
const hash = (value: unknown) => sha256(canonical(value));
const collections = ['characters', 'facts', 'seasons', 'storylines', 'continuityTracks', 'outlineGuides'] as const;
const projectFields = ['title', 'profile', 'brief', 'methods'] as const;
const idPattern = '[\\w-]{1,120}';
const validKey = new RegExp(`^(?:project/(?:${projectFields.join('|')})|order/(?:${collections.join('|')}|units)|(?:${collections.join('|')}|unit|storyOutline)/${idPattern}|sceneOrder/${idPattern}|scene/${idPattern}/${idPattern})$`);
export class WorkspacePatchConflict extends Error { statusCode = 409; }
export type WorkspacePatchOperation = { key: string; field?: string; beforeHash: string | null; after: { present: false } | { present: true; value: unknown } };
export type WorkspacePatch = { projectId: string; operations: WorkspacePatchOperation[] };
export type WorkspacePatchConflictView = { id:string; key:string; field:string|null; authorPresent:boolean; authorValue:unknown|null; workspacePresent:boolean; workspaceValue:unknown|null };
export type WorkspacePatchResolution = { id:string; choice:'AUTHOR'|'WORKSPACE' };
const fields: Record<string, string[]> = {
  'project/profile': ['organization','continuity','workType','genres','language','plannedUnits','targetDurationMs','toleranceMs','includeCredits','aspectRatio','productionMode'],
  'project/brief': ['concept','theme','audienceExperience','constraints','outline'],
  characters: ['name','bio','scopeId','desire','need','contradiction','arc','voice'],
  facts: ['text','scopeId','status'], seasons: ['title','arc'], storylines: ['scopeId','lane','title','premise','resolution'],
  continuityTracks: ['scopeId','kind','perspective','label','characterIds','initialValue','changes','threadPlan'],
  storyOutline: ['outline'],
  outlineGuides: ['nodeLinks','beats','overview','development'],
  unit: ['title','summary','scopeId','targetDurationMs','endingHook','seasonId','timeline','timingEvidence','structureNodes'],
  scene: ['title','location','timeOfDay','storyTime','purpose','entryState','exitState','characterIds','targetDurationMs','blocks','storyOrder','storylineIds','structureNodeId','generation','outlineRequirementIds'],
};
const fieldNames = (key: string) => fields[key] || fields[key.split('/')[0]];

/** Entity and order changes are separate. Unrelated author edits can survive an
 * adoption; concurrent changes to the same entity/order require author choice. */
function flatten(project: ScriptProject) {
  const nodes = new Map<string, unknown>();
  for (const key of projectFields) nodes.set(`project/${key}`, structuredClone(project[key]));
  for (const outline of project.storyOutlines??[]) nodes.set(`storyOutline/${outline.scopeId}`,structuredClone(outline));
  for (const collection of collections) {
    const values = project[collection];
    if (values === undefined) continue;
    if(collection!=='outlineGuides')nodes.set(`order/${collection}`, values.map(item => item.id));
    for (const item of values) nodes.set(`${collection}/${item.id}`, structuredClone(item));
  }
  nodes.set('order/units', project.units.map(unit => unit.id));
  for (const unit of project.units) {
    const { scenes, ...header } = unit;
    nodes.set(`unit/${unit.id}`, structuredClone(header));
    nodes.set(`sceneOrder/${unit.id}`, scenes.map(scene => scene.id));
    for (const scene of scenes) nodes.set(`scene/${unit.id}/${scene.id}`, structuredClone(scene));
  }
  return nodes;
}
function immutable(project: ScriptProject) {
  const rest: any = structuredClone(project);
  for (const key of [...projectFields, ...collections, 'storyOutlines', 'units', 'revision', 'updatedAt']) delete rest[key];
  return rest;
}
export function createWorkspacePatch(base: ScriptProject, draft: ScriptProject): WorkspacePatch {
  base = parseScriptProject(base); draft = parseScriptProject(draft);
  if (hash(immutable(base)) !== hash(immutable(draft))) throw new WorkspacePatchConflict('工作稿不能改变作品身份、创建原件或未知字段');
  const previous = flatten(base), next = flatten(draft);
  const operations: WorkspacePatchOperation[] = [];
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    if (previous.has(key) === next.has(key) && (!previous.has(key) || hash(previous.get(key)) === hash(next.get(key)))) continue;
    if (previous.has(key) && next.has(key) && fieldNames(key)) {
      const before = previous.get(key) as any, after = next.get(key) as any;
      for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (Object.hasOwn(before,field) === Object.hasOwn(after,field) && (!Object.hasOwn(before,field) || hash(before[field]) === hash(after[field]))) continue;
        if (!fieldNames(key).includes(field)) throw new WorkspacePatchConflict(`不能改变结构实体的 ${field} 字段`);
        operations.push({ key, field, beforeHash: Object.hasOwn(before,field) ? hash(before[field]) : null, after: Object.hasOwn(after,field) ? { present:true,value:after[field] } : { present:false } });
      }
      continue;
    }
    operations.push({ key, beforeHash: previous.has(key) ? hash(previous.get(key)) : null, after: next.has(key) ? { present: true, value: next.get(key) } : { present: false } });
  }
  return { projectId: base.id, operations };
}
function conflictFor(nodes:Map<string,unknown>,operation:WorkspacePatchOperation):WorkspacePatchConflictView|null{
  const node=nodes.get(operation.key) as any;
  const parentMissing=operation.field!==undefined&&!nodes.has(operation.key);
  const present=operation.field===undefined?nodes.has(operation.key):Boolean(node&&Object.hasOwn(node,operation.field));
  const current=present?(operation.field===undefined?node:node[operation.field]):null;
  const actual=present?hash(current):null,desired=operation.after.present?hash(operation.after.value):null;
  if(!parentMissing&&(actual===operation.beforeHash||actual===desired))return null;
  return {id:sha256(JSON.stringify([operation.key,operation.field??null,operation.beforeHash,actual,desired])),key:operation.key,field:operation.field??null,authorPresent:present,
    authorValue:present?structuredClone(current):null,workspacePresent:operation.after.present,
    workspaceValue:operation.after.present?structuredClone(operation.after.value):null};
}
/** Read-only author choice list for a trusted patch. Values are pinned again
 * when preparing the merge; this projection does not grant a write. */
export function workspacePatchConflicts(current:ScriptProject,patch:WorkspacePatch):WorkspacePatchConflictView[]{
  if(patch.projectId!==current.id)throw new WorkspacePatchConflict('结构变更不属于当前作品');
  const nodes=flatten(parseScriptProject(current));
  return patch.operations.flatMap(operation=>{const conflict=conflictFor(nodes,operation);return conflict?[conflict]:[];});
}
export function applyWorkspacePatch(current: ScriptProject, patch: WorkspacePatch, resolutions:WorkspacePatchResolution[]=[], draft?:ScriptProject): ScriptProject {
  current = parseScriptProject(current);
  if (patch?.projectId !== current.id || !Array.isArray(patch.operations) || patch.operations.length > 30000) throw new WorkspacePatchConflict('结构变更不属于当前作品');
  const nodes = flatten(current), authorNodes=flatten(current), draftNodes=draft?flatten(parseScriptProject(draft)):null;
  if(draft&&draft.id!==current.id)throw new WorkspacePatchConflict('工作稿与作者稿不属于同一作品');
  const keys = new Set<string>(), wholeKeys = new Set<string>(), fieldKeys = new Set<string>();
  if(!Array.isArray(resolutions)||resolutions.length>30000||resolutions.some(item=>!item||typeof item.id!=='string'||!['AUTHOR','WORKSPACE'].includes(item.choice))||
    new Set(resolutions.map(item=>item.id)).size!==resolutions.length)throw new WorkspacePatchConflict('合并选择格式无效或重复');
  const choices=new Map(resolutions.map(item=>[item.id,item.choice])),conflicts=new Set<string>();
  const chosen=new Map<WorkspacePatchOperation,'AUTHOR'|'WORKSPACE'>();
  const chosenOrder=new Map<string,'AUTHOR'|'WORKSPACE'>();
  const absentFieldChoices=new Map<string,Set<'AUTHOR'|'WORKSPACE'>>();
  for (const operation of patch.operations) {
    const target = operation && JSON.stringify([operation.key, operation.field ?? null]);
    if (!operation || typeof operation.key !== 'string' || !validKey.test(operation.key) || keys.has(target)
      || !(operation.beforeHash === null || /^[a-f0-9]{64}$/.test(operation.beforeHash))
      || !operation.after || typeof operation.after.present !== 'boolean'
      || (operation.after.present && !Object.hasOwn(operation.after, 'value'))) throw new WorkspacePatchConflict('结构变更格式无效或包含重复目标');
    keys.add(target);
    const node = nodes.get(operation.key) as any;
    if (operation.field !== undefined) {
      if (!fieldNames(operation.key)?.includes(operation.field) || (node!==undefined&&(typeof node !== 'object'||node===null)) || wholeKeys.has(operation.key)) throw new WorkspacePatchConflict('结构字段无效或目标已删除');
      fieldKeys.add(operation.key);
    } else {
      if (fieldKeys.has(operation.key)) throw new WorkspacePatchConflict('不能混合整体与字段变更');
      wholeKeys.add(operation.key);
    }
    const conflict=conflictFor(nodes,operation);
    if(conflict){
      conflicts.add(conflict.id);
      const choice=choices.get(conflict.id);
      if(!choice)throw new WorkspacePatchConflict(`作者与工作稿分别改动了 ${operation.key}，请比较后处理；原稿未修改`);
      chosen.set(operation,choice);
      if(operation.key.startsWith('order/')||operation.key.startsWith('sceneOrder/'))chosenOrder.set(operation.key,choice);
      if(operation.field!==undefined&&!nodes.has(operation.key)){
        const group=absentFieldChoices.get(operation.key)??new Set<'AUTHOR'|'WORKSPACE'>();group.add(choice);absentFieldChoices.set(operation.key,group);
      }
    }
  }
  if(choices.size!==conflicts.size||[...choices.keys()].some(id=>!conflicts.has(id)))throw new WorkspacePatchConflict('合并选择与当前冲突集合不一致');
  for(const [key,group] of absentFieldChoices){
    if(group.size!==1)throw new WorkspacePatchConflict('同一已删除实体的选择不能混用作者稿与工作稿');
    if(group.has('WORKSPACE')){
      if(!draftNodes?.has(key))throw new WorkspacePatchConflict('恢复已删除实体需要固定工作稿版本');
      nodes.set(key,structuredClone(draftNodes.get(key)));
    }
  }
  for (const operation of patch.operations) {
    if(chosen.get(operation)==='AUTHOR')continue;
    if (operation.field !== undefined) {
      const node = nodes.get(operation.key) as any;
      if(!node){
        if(absentFieldChoices.get(operation.key)?.has('AUTHOR'))continue;
        throw new WorkspacePatchConflict('结构字段目标已删除');
      }
      if (operation.after.present) node[operation.field] = structuredClone(operation.after.value); else delete node[operation.field];
    } else if (operation.after.present) nodes.set(operation.key, structuredClone(operation.after.value));
    else nodes.delete(operation.key);
  }
  // A field decision on an absent entity, or a decision to keep an entity
  // deleted by the draft, also controls the containing order. Keep every
  // unrelated draft change while restoring the chosen entity's parent path.
  const insertFrom=(orderKey:string,id:string,source:Map<string,unknown>)=>{
    const preferred=source.get(orderKey) as string[]|undefined;
    if(!preferred?.includes(id))throw new WorkspacePatchConflict('选择的实体不在固定版本顺序中');
    const order=nodes.get(orderKey) as string[]|undefined;
    if(!order)throw new WorkspacePatchConflict('选择的实体缺少父级顺序');
    if(order.includes(id))return;
    if(chosenOrder.has(orderKey)&&chosenOrder.get(orderKey)!==(source===authorNodes?'AUTHOR':'WORKSPACE'))
      throw new WorkspacePatchConflict('实体与父级顺序的选择矛盾，请统一选择');
    const index=preferred.indexOf(id);
    const previous=[...preferred.slice(0,index)].reverse().find(item=>order.includes(item));
    const following=preferred.slice(index+1).find(item=>order.includes(item));
    order.splice(previous?order.indexOf(previous)+1:following?order.indexOf(following):order.length,0,id);
  };
  const restoreUnit=(id:string,source:Map<string,unknown>)=>{
    if(!source.has(`unit/${id}`))throw new WorkspacePatchConflict('选择的单元不在固定版本中');
    if(!nodes.has(`unit/${id}`))nodes.set(`unit/${id}`,structuredClone(source.get(`unit/${id}`)));
    if(!nodes.has(`sceneOrder/${id}`))nodes.set(`sceneOrder/${id}`,structuredClone(source.get(`sceneOrder/${id}`)));
    for(const sceneId of nodes.get(`sceneOrder/${id}`) as string[]){
      const key=`scene/${id}/${sceneId}`;
      if(!nodes.has(key)){
        if(!source.has(key))throw new WorkspacePatchConflict('选择的单元场景不在固定版本中');
        nodes.set(key,structuredClone(source.get(key)));
      }
    }
    insertFrom('order/units',id,source);
  };
  const restoreEntity=(key:string,source:Map<string,unknown>)=>{
    if(!source.has(key))throw new WorkspacePatchConflict('选择的实体不在固定版本中');
    if(!nodes.has(key))nodes.set(key,structuredClone(source.get(key)));
    const parts=key.split('/');
    if(parts[0]==='scene'){
      restoreUnit(parts[1],source);
      insertFrom(`sceneOrder/${parts[1]}`,parts[2],source);
    }else if(parts[0]==='unit')restoreUnit(parts[1],source);
    else if(parts[0]!=='outlineGuides'&&collections.includes(parts[0] as typeof collections[number]))insertFrom(`order/${parts[0]}`,parts[1],source);
  };
  for(const [operation,choice] of chosen){
    if(choice==='AUTHOR'&&operation.field===undefined&&!operation.after.present&&authorNodes.has(operation.key))restoreEntity(operation.key,authorNodes);
    if(choice==='WORKSPACE'&&operation.field!==undefined&&!authorNodes.has(operation.key))restoreEntity(operation.key,draftNodes!);
  }
  for(const [orderKey,choice] of chosenOrder){
    const ids=choice==='AUTHOR'?authorNodes.get(orderKey) as string[]|undefined:nodes.get(orderKey) as string[]|undefined;
    if(choice==='AUTHOR'){
      if(!ids)throw new WorkspacePatchConflict('作者顺序已不存在');
      nodes.set(orderKey,structuredClone(ids));
    }
    if(orderKey==='order/units'){
      if(choice==='AUTHOR')for(const id of ids??[])restoreUnit(id,authorNodes);
      for(const key of [...nodes.keys()])if((key.startsWith('unit/')||key.startsWith('sceneOrder/')||key.startsWith('scene/'))&&!(ids??[]).includes(key.split('/')[1]))nodes.delete(key);
    }else if(orderKey.startsWith('sceneOrder/')){
      const unitId=orderKey.slice('sceneOrder/'.length);
      if(choice==='AUTHOR'){
        restoreUnit(unitId,authorNodes);
        for(const id of ids??[])restoreEntity(`scene/${unitId}/${id}`,authorNodes);
      }
      for(const key of [...nodes.keys()])if(key.startsWith(`scene/${unitId}/`)&&!(ids??[]).includes(key.split('/')[2]))nodes.delete(key);
    }else if(orderKey.startsWith('order/')){
      const collection=orderKey.slice('order/'.length);
      if(choice==='AUTHOR')for(const id of ids??[])restoreEntity(`${collection}/${id}`,authorNodes);
      for(const key of [...nodes.keys()])if(key.startsWith(`${collection}/`)&&!(ids??[]).includes(key.split('/')[1]))nodes.delete(key);
    }
  }
  const consumed = new Set<string>();
  const take = (key: string): any => { if (!nodes.has(key)) throw new WorkspacePatchConflict(`结构变更缺少 ${key}`); consumed.add(key); return structuredClone(nodes.get(key)); };
  const order = (key: string): string[] => {
    const ids = take(key);
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !new RegExp(`^${idPattern}$`).test(id)) || new Set(ids).size !== ids.length) throw new WorkspacePatchConflict('结构顺序包含无效或重复标识');
    return ids;
  };
  const entity = (key: string, id: string): any => { const value = take(key); if (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== id) throw new WorkspacePatchConflict('结构实体标识不一致'); return value; };
  const next = structuredClone(current);
  for (const key of projectFields) (next as any)[key] = take(`project/${key}`);
  const storyKeys=[...nodes.keys()].filter(key=>key.startsWith('storyOutline/'));
  if(storyKeys.length||current.storyOutlines!==undefined)next.storyOutlines=storyKeys.map(key=>{const value=take(key);if(!value||value.scopeId!==key.slice('storyOutline/'.length))throw new WorkspacePatchConflict('故事大纲身份不一致');return value;});
  for (const collection of collections) {
    if(collection==='outlineGuides'){const keys=[...nodes.keys()].filter(key=>key.startsWith('outlineGuides/'));if(keys.length||current.outlineGuides!==undefined)next.outlineGuides=keys.map(key=>entity(key,key.slice('outlineGuides/'.length)));else delete next.outlineGuides;continue;}
    if (!nodes.has(`order/${collection}`)) {
      if (collection === 'characters' || collection === 'facts') throw new WorkspacePatchConflict('不能删除作品的必需集合');
      delete (next as any)[collection];
    } else (next as any)[collection] = order(`order/${collection}`).map(id => entity(`${collection}/${id}`, id));
  }
  next.units = order('order/units').map(id => {
    const header = entity(`unit/${id}`, id);
    if (Object.hasOwn(header, 'scenes')) throw new WorkspacePatchConflict('单元结构不能夹带未校验的场景');
    return { ...header, scenes: order(`sceneOrder/${id}`).map(sceneId => entity(`scene/${id}/${sceneId}`, sceneId)) };
  });
  if ([...nodes.keys()].some(key => !consumed.has(key))) throw new WorkspacePatchConflict('结构变更留下未引用实体，不能静默丢弃');
  return parseScriptProject(next);
}
