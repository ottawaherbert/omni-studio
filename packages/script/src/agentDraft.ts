import { parseModelJson } from '../../model-output/src';
import {reorderScenes} from './sceneOrder';
import {buildOutlineDevelopment,outlineDevelopmentSchema} from './outlineDevelopment';
import { BLUEPRINT_BRIEF_FIELDS, CHARACTER_TEXT_FIELDS, type BlueprintBriefField } from './blueprint';
import { sha256 } from 'js-sha256';
import { hashValue } from '../../agent-core/src/identity';
import { unitCharacters } from './continuity';
import { blocksToScreenplayText, replaceScreenplaySelection, screenplayBlockTextRanges } from './fountainAdapter';
import { parseScriptProject, BLOCK_TYPES, type ScriptBlock, type ScriptProject } from './schema';
import { createWorkspacePatch, type WorkspacePatch } from './workspacePatch';
import { assertAgentDraftScope, assertContinuationReplayScope, type AgentDraftOperation, type DraftSelection, type ScriptDraftCreationLedger,
  type ScriptDraftScope } from './agentScope';
import { insertScenesInStructure } from './structure';
import { appendSceneContinuation, generatedSceneState, type SceneContinuationCheckpoint } from './continuation';
import { sceneHasAuthorWork } from './planning';

export type AgentDraftRequest = { candidateId: string; identitySeed?:string; repairCandidateId?:string; operation: AgentDraftOperation; unitId?: string; sceneId?: string;
  slotId?: string; scopeId?: string; seasonId?:string; entityId?: string; blockIds?: string[]; selection?: DraftSelection;
  nodeId?:string; beforeSceneId?:string; afterSceneId?:string; continuationCheckpoint?:SceneContinuationCheckpoint };
export type AgentDraftIdMap = Record<string, string>;
export type AgentDraftCandidate = { request: AgentDraftRequest; result: Record<string, unknown>; idMap: AgentDraftIdMap;
  patch: WorkspacePatch; patchDigest: string; baseRevision: number; baseContentHash: string; delivery?:{missing:string[];errors:string[]}; replayed?:boolean };
const string = { type: 'string' } as const;
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const block = obj({ localKey: string, type: { type: 'string', enum: [...BLOCK_TYPES] }, text: string,
  speakerId: nullable(string), speakerName: nullable(string) });
const schemas: Record<AgentDraftOperation, Record<string, unknown>> = {
  scene_order:obj({summary:string,sceneIds:{type:'array',items:string}}),outline_development:outlineDevelopmentSchema,
  concept: obj({ summary: string, content: string }), theme: obj({ summary: string, content: string }),
  audienceExperience:obj({summary:string,content:string}),constraints:obj({summary:string,content:string}),
  update_character:obj({summary:string,changes:{type:'array',minItems:1,maxItems:7,items:obj({field:{type:'string',enum:[...CHARACTER_TEXT_FIELDS]},value:string})}}),
  update_fact:obj({summary:string,changes:{type:'array',minItems:1,maxItems:2,items:obj({field:{type:'string',enum:['text','status']},value:string})}}),
  project_outline: obj({ summary: string, content: string }), unit_outline: obj({ summary: string, content: string }),
  story_outline:obj({summary:string,content:string}),season_outline:obj({summary:string,content:string}),
  add_unit: obj({ summary: string, title: string, unitSummary: string }),
  plan_structure:obj({summary:string,nodes:{type:'array',minItems:1,maxItems:100,items:obj({localKey:string,parentLocalKey:nullable(string),title:string,purpose:string,sceneIds:{type:'array',items:string}})}}),
  plan_scenes: obj({ summary: string, scenes: { type: 'array', minItems: 1, maxItems: 30,
    items: obj({ localKey: string, title: string, purpose: string, location: string, timeOfDay: string,outlineRequirementIds:nullable({type:'array',items:string}) }) } }),
  scene_plan: obj({summary:string,title:string,purpose:string,location:string,timeOfDay:string,entryState:string,exitState:string,outlineRequirementIds:nullable({type:'array',items:string})}),
  scene_body: obj({ summary: string, blocks: { type: 'array', minItems: 1, maxItems: 1000, items: block } }),
  append_scene_body:obj({summary:string,blocks:{type:'array',minItems:1,maxItems:1000,items:block},isComplete:{type:'boolean'}}),
  replace_blocks: obj({ summary: string, blocks: { type: 'array', minItems: 1, maxItems: 1000, items: block } }),
  replace_selection: obj({ summary: string, replacement: string }),
  add_character: obj({ summary: string, character: obj({ localKey: string, name: string, bio: string, desire: string, need: string,
    contradiction: string, arc: string, voice: string }) }),
  add_fact: obj({ summary: string, fact: obj({ localKey: string, text: string }) }),
};
/** Every nested object has fixed keys; no permissive blocks.items object. */
export function agentDraftOutputSchema(operation: AgentDraftOperation): Record<string, unknown> {
  if (!Object.hasOwn(schemas, operation)) throw new Error('未知剧本候选操作');
  return structuredClone(schemas[operation]);
}

const fail = (reason: string): never => { throw new Error(`剧本候选格式无效：${reason}`); };
const record = (value: unknown, fields: string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...fields].sort().join()) fail(`${path} 字段不符合严格合同`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, path: string, required = true): string => {
  if (typeof value !== 'string' || value.length > 200000 || required && !value.trim()) fail(`${path} 缺少有效文本`);
  return value as string;
};
const localKey = (value: unknown, path: string): string => {
  const key = text(value, path);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) fail(`${path} 不可作为本批稳定键`);
  return key;
};
const stableId = (candidateId: string, kind: 'unit' | 'scene' | 'block' | 'char' | 'fact' | 'node', key: string) =>
  `${kind}_${sha256(JSON.stringify([candidateId, kind, key])).slice(0, 48)}`;
const requireId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) fail(`${label} 无效`);
  return value as string;
};
const allIds = (project: ScriptProject) => new Set([project.id, ...project.units.flatMap(unit => [unit.id, ...(unit.structureNodes??[]).map(node=>node.id), ...unit.scenes.flatMap(scene => [scene.id, ...scene.blocks.map(block => block.id)])]),
  ...project.characters.map(character => character.id), ...project.facts.map(fact => fact.id)]);

function parsedBlocks(value: unknown, request: AgentDraftRequest, project: ScriptProject, idMap: AgentDraftIdMap): ScriptBlock[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) fail('正文块必须为 1–1000 个');
  const unit = project.units.find(item => item.id === request.unitId);
  if (!unit) fail('目标单元不存在');
  const characters = new Set(unitCharacters(project, unit).map(item => item.id)), keys = new Set<string>();
  return (value as unknown[]).map((item, index) => {
    const row = record(item, ['localKey', 'type', 'text', 'speakerId', 'speakerName'], `blocks[${index}]`);
    const key = localKey(row.localKey, `blocks[${index}].localKey`);
    if (keys.has(key)) fail('本批正文块 localKey 重复'); keys.add(key);
    if (!BLOCK_TYPES.includes(row.type as ScriptBlock['type'])) fail('正文块类型无效');
    const content = text(row.text, `blocks[${index}].text`, false);
    const speakerId = row.speakerId === null ? null : requireId(row.speakerId, '说话人物 ID');
    const speakerName = row.speakerName === null ? null : text(row.speakerName, '说话人物姓名');
    if (row.type === 'dialogue') {
      if (Boolean(speakerId) === Boolean(speakerName) || speakerId && !characters.has(speakerId) || speakerName && speakerName.length > 80) fail('对白必须引用本单元人物或声明待登记姓名');
    } else if (speakerId || speakerName) fail('非对白块不能填写说话人物');
    const id = stableId(request.candidateId, 'block', key); idMap[`block:${key}`] = id;
    return { id, type: row.type as ScriptBlock['type'], text: content,
      ...(speakerId ? { speakerId } : {}), ...(speakerName ? { speakerName } : {}) };
  });
}

/** Parse one actual model result into a typed, scope-checked candidate. This
 * never mutates the base; the host persists raw text/provenance separately and
 * stores patch+idMap under candidateId before any apply. */
export function buildAgentDraft(raw: string, request: AgentDraftRequest, current: ScriptProject, scope: ScriptDraftScope,
  check: { origin: ScriptProject; ledger: ScriptDraftCreationLedger }): AgentDraftCandidate {
  requireId(request.candidateId, '候选 ID');
  const schema = agentDraftOutputSchema(request.operation), fields = Object.keys((schema as any).properties);
  let parsed: unknown;
  try { parsed = parseModelJson(raw); } catch { return fail('模型结果不是 JSON'); }
  const result = record(parsed, request.operation==='scene_plan'&&parsed&&typeof parsed==='object'&&!Object.hasOwn(parsed,'outlineRequirementIds')?fields.filter(field=>field!=='outlineRequirementIds'):fields, 'result');
  text(result.summary, 'summary');
  let next = structuredClone(current);let delivery:AgentDraftCandidate['delivery'];const idMap: AgentDraftIdMap = {}, existing = allIds(current);
  const unit = request.unitId ? next.units.find(item => item.id === request.unitId) : undefined;
  const scene = request.sceneId ? unit?.scenes.find(item => item.id === request.sceneId) : undefined;
  if(request.operation==='scene_order'){const grant=scope.sceneOrderGrants?.find(g=>g.unitId===request.unitId&&g.nodeId===request.nodeId);if(!grant)fail('缺少场序授权');next=reorderScenes(current,grant,result.sceneIds);
  }else if(request.operation==='outline_development'){
    const grant=scope.outlineGrants?.[0];if(!grant||!request.unitId)fail('大纲授权不存在');
    const build=(value:Record<string,unknown>)=>parseScriptProject(buildOutlineDevelopment(current,grant,request.unitId!,request.identitySeed??request.candidateId,value));
    try{next=build(result);}catch(error){
      // Keep a valid original even when one relationship step is malformed.
      // The complete returned JSON remains immutable in the host invocation.
      const errors=[error instanceof Error?error.message:'关系未完成'];let partial={...result,nodes:null,beats:null};next=build(partial);
      for(const field of ['nodes','beats'] as const)if(result[field]!==null){try{const trial={...partial,[field]:result[field]};next=build(trial);partial=trial;}catch(cause){errors.push(cause instanceof Error?cause.message:'关系未完成');}}
      result.nodes=partial.nodes;result.beats=partial.beats;delivery={missing:['nodes','beats'].filter(field=>result[field]===null&&(field!=='nodes'||grant.allowStructure||grant.nodeId)),errors:[...new Set(errors)]};
    }
    if(!delivery)delivery={missing:['nodes','beats'].filter(field=>result[field]===null&&(field!=='nodes'||grant.allowStructure||grant.nodeId)),errors:[]};
  } else if ([...BLUEPRINT_BRIEF_FIELDS, 'project_outline'].includes(request.operation)) {
    const field = request.operation === 'project_outline' ? 'outline' : request.operation as BlueprintBriefField;
    next.brief[field] = text(result.content, 'content',field==='concept'||field==='outline');
  } else if(request.operation==='story_outline'){
    const scopeId=requireId(request.scopeId,'故事作用域');const previous=next.storyOutlines?.find(item=>item.scopeId===scopeId);
    if(previous)previous.outline=text(result.content,'content');else(next.storyOutlines??=[]).push({scopeId,outline:text(result.content,'content')});
  } else if(request.operation==='season_outline'){
    const season=next.seasons?.find(item=>item.id===request.seasonId);if(!season)fail('目标季不存在');season.arc=text(result.content,'content');
  } else if (request.operation === 'unit_outline') {
    if (!unit) fail('目标单元不存在'); unit.summary = text(result.content, 'content');
  } else if (request.operation === 'add_unit') {
    const slot = scope.newUnitSlots.find(item => item.slotId === request.slotId);
    if (!slot || next.units.some(item => item.id === slot.unitId)) fail('新单元槽不存在或已使用');
    text(result.title, 'title'); text(result.unitSummary, 'unitSummary', false);
    next.units.push({ id: slot.unitId, title: result.title as string, summary: result.unitSummary as string, scopeId: slot.scopeId,
      targetDurationMs: slot.targetDurationMs, scenes: [], timeline: [], timingEvidence: [] });
    if (next.units.length > next.profile.plannedUnits) next.profile.plannedUnits = next.units.length;
    idMap[`unit:${slot.slotId}`] = slot.unitId;
  } else if(request.operation==='plan_structure'){
    if(!unit||unit.structureNodes?.length||!Array.isArray(result.nodes)||!result.nodes.length||result.nodes.length>100)fail('结构只允许首次规划1–100个节点');
    const keys=new Map<string,string>(),claimed=new Set<string>();
    const rows=(result.nodes as unknown[]).map((item,index)=>{const row=record(item,['localKey','parentLocalKey','title','purpose','sceneIds'],`nodes[${index}]`),key=localKey(row.localKey,'node.localKey');if(keys.has(key))fail('结构键重复');const id=stableId(request.candidateId,'node',key);if(existing.has(id))fail('结构ID冲突');keys.set(key,id);idMap[`node:${key}`]=id;return row;});
    unit.structureNodes=rows.map(row=>{const id=keys.get(String(row.localKey))!,parentId=row.parentLocalKey===null?undefined:keys.get(localKey(row.parentLocalKey,'node.parentLocalKey'));if(row.parentLocalKey!==null&&!parentId)fail('结构父节点不存在');
      if(!Array.isArray(row.sceneIds))fail('结构成员需要场景ID数组');for(const rawId of row.sceneIds as unknown[]){const sceneId=requireId(rawId,'结构场景ID'),member=unit.scenes.find(scene=>scene.id===sceneId);if(!member||claimed.has(sceneId))fail('结构场景不存在或重复');claimed.add(sceneId);member.structureNodeId=id;}
      return {id,title:text(row.title,'node.title'),purpose:text(row.purpose,'node.purpose',false),...(parentId?{parentId}:{})};});
  } else if (request.operation === 'plan_scenes') {
    if (!unit || !Array.isArray(result.scenes) || result.scenes.length < 1 || result.scenes.length > 30) fail('单批分场必须为 1–30 场');
    const keys = new Set<string>(),additions:ScriptProject['units'][number]['scenes']=[];
    for (const [index, item] of (result.scenes as unknown[]).entries()) {
      const row = record(item, ['localKey', 'title', 'purpose', 'location', 'timeOfDay',...(item&&typeof item==='object'&&Object.hasOwn(item,'outlineRequirementIds')?['outlineRequirementIds']:[])], `scenes[${index}]`);
      const key = localKey(row.localKey, `scenes[${index}].localKey`);
      if (keys.has(key)) fail('本批分场 localKey 重复'); keys.add(key);
      const id = stableId(request.candidateId, 'scene', key);
      if (existing.has(id)) fail('分场 ID 与当前稿冲突'); idMap[`scene:${key}`] = id;
      if(row.outlineRequirementIds!==undefined&&row.outlineRequirementIds!==null&&(!Array.isArray(row.outlineRequirementIds)||row.outlineRequirementIds.some(value=>typeof value!=='string')))fail('大纲映射必须为ID数组');
      additions.push({ id, title: text(row.title, 'scene.title'), purpose: text(row.purpose, 'scene.purpose'),
        location: text(row.location, 'scene.location', false), timeOfDay: text(row.timeOfDay, 'scene.timeOfDay', false),
        storyTime: '', entryState: '', exitState: '', characterIds: [], targetDurationMs: 0, blocks: [],...(row.outlineRequirementIds?{outlineRequirementIds:row.outlineRequirementIds as string[]}:{}) });
    }
    const grant=scope.units.find(item=>item.unitId===unit.id);
    if(!request.nodeId&&!request.beforeSceneId&&!request.afterSceneId&&grant?.allowAllScenes&&unit.scenes.length===1&&!unit.scenes[0].structureNodeId&&!sceneHasAuthorWork(unit.scenes[0],current))unit.scenes=[];
    next=insertScenesInStructure(next,unit.id,additions,{nodeId:request.nodeId,beforeSceneId:request.beforeSceneId,afterSceneId:request.afterSceneId});
  } else if (request.operation === 'scene_plan') {
    if(!scene)fail('目标场景不存在');
    for(const key of ['title','purpose','location','timeOfDay','entryState','exitState'] as const)scene![key]=text(result[key],key,key==='title'||key==='purpose');
    if(result.outlineRequirementIds!==undefined&&result.outlineRequirementIds!==null){if(!Array.isArray(result.outlineRequirementIds)||result.outlineRequirementIds.some(value=>typeof value!=='string'))fail('大纲映射必须为ID数组');scene!.outlineRequirementIds=result.outlineRequirementIds as string[];}
  } else if(request.operation==='append_scene_body'){
    if(!scene||!unit||!request.continuationCheckpoint||typeof result.isComplete!=='boolean')fail('同场续写缺少检查点或明确完成状态');
    const blocks=parsedBlocks(result.blocks,request,current,idMap),appended=appendSceneContinuation(current,unit.id,scene.id,blocks,{stepId:request.candidateId,checkpoint:request.continuationCheckpoint,isComplete:result.isComplete as boolean});
    next=appended.project;
    if(!appended.applied){
      // The host must return the previously committed effect; do not create another revision.
      assertContinuationReplayScope(current,scope,{...check,...request});
      const patch=createWorkspacePatch(current,next);return {request:structuredClone(request),result:structuredClone(result),idMap,patch,patchDigest:hashValue(patch),baseRevision:current.revision,baseContentHash:hashValue(current),replayed:true};
    }
  } else if (request.operation === 'scene_body' || request.operation === 'replace_blocks') {
    if (!scene) fail('目标场景不存在');
    const blocks = parsedBlocks(result.blocks, request, current, idMap);
    if (blocks.some(block => existing.has(block.id))) fail('正文块 ID 与当前稿冲突');
    if (request.operation === 'scene_body') {scene.blocks = blocks;scene.generation=generatedSceneState(scene,request.candidateId,hashValue(blocks),true);}
    else {
      const ids = request.blockIds;
      if (!ids?.length || new Set(ids).size !== ids.length) fail('缺少连续待改块');
      const start = scene.blocks.findIndex(block => block.id === ids[0]);
      if (start < 0 || ids.some((id, index) => scene.blocks[start + index]?.id !== id)) fail('待改块不连续或已改变');
      scene.blocks.splice(start, ids.length, ...blocks);
    }
  } else if (request.operation === 'replace_selection') {
    if (!scene || !request.selection) fail('缺少目标场景或文字选区');
    const replacement = text(result.replacement, 'replacement', false), old = scene.blocks;
    const chars = unitCharacters(current, current.units.find(item => item.id === request.unitId)!);
    const original = blocksToScreenplayText(old, chars);
    if (original.slice(request.selection.start, request.selection.end) !== request.selection.text) fail('选中的原文已改变');
    // A rendered selection is measured after formatting and trimming. Map a
    // selection inside one block's raw body back to that raw body so its
    // whitespace, speaker and type remain byte-for-byte unchanged outside it.
    let direct: ScriptBlock[] | null = null;
    for (const {index,bodyStart,bodyEnd} of screenplayBlockTextRanges(old,chars)) {
      const item=old[index];
      if (item.text.trim() && request.selection.start >= bodyStart &&
        request.selection.end <= bodyEnd && !replacement.includes('\n')) {
        const leading = item.text.length - item.text.trimStart().length;
        const wrapper = item.type==='parenthetical'&&/^[（(]/.test(item.text.trim())?1:0;
        const rawStart = leading + wrapper + request.selection.start - bodyStart;
        const rawEnd = leading + wrapper + request.selection.end - bodyStart;
        direct = structuredClone(old);
        direct[index].text = item.text.slice(0, rawStart) + replacement + item.text.slice(rawEnd);
        break;
      }
    }
    const replaced = direct ?? replaceScreenplaySelection(old, chars, request.selection, replacement);
    if (!direct && old.some(item => item.text !== item.text.trim())) fail('该选区包含原始空白，不能无损解析；请按块改写');
    for (const [index, item] of replaced.entries()) if (!existing.has(item.id)) {
      const key = `selection_${index}`, id = stableId(request.candidateId, 'block', key);
      item.id = id; idMap[`block:${key}`] = id;
    }
    scene.blocks = replaced;
  } else if(request.operation==='update_character'||request.operation==='update_fact'){
    const isCharacter=request.operation==='update_character';
    const entity=isCharacter?next.characters.find(item=>item.id===request.entityId):next.facts.find(item=>item.id===request.entityId);
    if(!entity)fail('要修改的人物或设定不存在');
    if(!Array.isArray(result.changes)||!result.changes.length||result.changes.length>(isCharacter?7:2))fail('修改字段数量无效');
    const seen=new Set<string>();
    for(const change of result.changes as unknown[]){
      const row=record(change,['field','value'],'change'),field=text(row.field,'field');
      if(!(isCharacter?[...CHARACTER_TEXT_FIELDS]:['text','status']).includes(field as any)||seen.has(field))fail('修改字段未知或重复');
      seen.add(field);const value=text(row.value,field,field==='name'||field==='text'||field==='status');
      if(field==='status'&&!['draft','approved'].includes(value))fail('设定确认状态无效');
      (entity as any)[field]=value;
    }
  } else if (request.operation === 'add_character') {
    const row = record(result.character, ['localKey', 'name', ...((result.character as any)?.bio!==undefined?['bio']:[]), 'desire', 'need', 'contradiction', 'arc', 'voice'], 'character');
    const key = localKey(row.localKey, 'character.localKey'), id = stableId(request.candidateId, 'char', key);
    const scopeId = requireId(request.scopeId, '人物作用域');
    if (existing.has(id)) fail('人物 ID 与当前稿冲突'); idMap[`char:${key}`] = id;
    next.characters.push({ id, scopeId, name: text(row.name, 'character.name'), ...(row.bio!==undefined?{bio:text(row.bio,'character.bio',false)}:{}), desire: text(row.desire, 'character.desire', false),
      need: text(row.need, 'character.need', false), contradiction: text(row.contradiction, 'character.contradiction', false),
      arc: text(row.arc, 'character.arc', false), voice: text(row.voice, 'character.voice', false) });
  } else if (request.operation === 'add_fact') {
    const row = record(result.fact, ['localKey', 'text'], 'fact');
    const key = localKey(row.localKey, 'fact.localKey'), id = stableId(request.candidateId, 'fact', key);
    const scopeId = requireId(request.scopeId, '事实作用域');
    if (existing.has(id)) fail('事实 ID 与当前稿冲突'); idMap[`fact:${key}`] = id;
    next.facts.push({ id, scopeId, text: text(row.text, 'fact.text'), status: 'draft' });
  } else fail('未知候选操作');
  const validated = parseScriptProject(next);
  const patch = createWorkspacePatch(current, validated);
  assertAgentDraftScope(current, patch, scope, request.operation, { ...check,...request });
  return { request: structuredClone(request), result: structuredClone(result), idMap, patch, patchDigest: hashValue(patch),
    baseRevision: current.revision, baseContentHash: hashValue(current),...(delivery?{delivery}:{}) };
}
