import { validateSkillMetadata, type SkillApplicability } from "../../domain/src/skillMetadata";
import {validateOutlineGuides, type OutlineGuide} from './outlineGuides';
export const SCHEMA_VERSION = 'script.v1' as const;
export const ORGANIZATIONS = ['standalone', 'episodic'] as const;
export const CONTINUITY_MODES = ['serialized', 'procedural', 'anthology', 'mixed'] as const;
export const BLOCK_TYPES = ['action', 'dialogue', 'parenthetical', 'transition', 'note'] as const;
export interface ScriptFact {id:string;text:string;scopeId:string;status:'draft'|'approved'}
export type ScriptBlock = { id: string; type: typeof BLOCK_TYPES[number]; text: string; speakerId?: string; speakerName?: string };
export interface ProjectProfile {
  organization: typeof ORGANIZATIONS[number];
  continuity: typeof CONTINUITY_MODES[number]; workType: string; genres: string[]; language: string;
  plannedUnits: number; targetDurationMs: number; toleranceMs: number; includeCredits: boolean;
  aspectRatio: '16:9' | '9:16' | '1:1'; productionMode: 'live-action' | 'AI-video' | 'animation' | 'hybrid';
}
export interface Character {
  bio?: string;
  id: string; name: string; scopeId: string;
  desire: string; need: string; contradiction: string; arc: string; voice: string;
}
export interface Scene {
  id: string; title: string; location: string; timeOfDay: string; storyTime: string; purpose: string;
  entryState: string; exitState: string; characterIds: string[]; targetDurationMs: number;
  blocks: ScriptBlock[];
  storyOrder?: number;
  storylineIds?: string[];
  /** One direct membership; presentation order always comes from unit.scenes. */
  structureNodeId?: string;
  outlineRequirementIds?: string[];
  /** Absent on older/manual drafts. New generated body records explicit completion. */
  generation?: { status: 'partial' | 'complete'; checkpointId: string; appliedSteps: Array<{ id: string; digest: string }> };
}
export interface StructureNode { id: string; title: string; parentId?: string; purpose?: string }
export interface TimelineItem {
  id: string; sceneId?: string; track: string; modality: 'video' | 'audio';
  /** Missing in early v1 documents means story content. */
  scope?: 'story' | 'credits';
  kind: 'content' | 'placeholder' | 'gap' | 'marker'; startMs: number; endMs: number;
  included: boolean; label: string; contentHash: string;
}
export interface TimingEvidence {
  id: string; kind: 'estimate' | 'preview' | 'final'; source: 'assumption' | 'synthetic' | 'ffprobe';
  contentHash: string; durationMs: number; lowMs?: number; highMs?: number; assumptions: string;
  mediaUrl?: string; mediaHash?: string; toolVersion?: string; rawMeasurement?: string; settingsHash?: string;
}
export interface DeliveryUnit {
  id: string; title: string; summary: string; scopeId: string; targetDurationMs: number;
  /** Optional ending direction; older projects have only a unit summary. */
  endingHook?: string;
  seasonId?: string;
  structureNodes?: StructureNode[];
  scenes: Scene[]; timeline: TimelineItem[]; timingEvidence: TimingEvidence[];
}
export const SCRIPT_OPERATIONS = ['scene','rewrite','text_rewrite','consult','concept','theme','character','fact','outline','story_outline','season_outline','unit_outline','unit_outlines','plan','board_plan','ending','scene_turn','review'] as const;
export type ScriptOperation = typeof SCRIPT_OPERATIONS[number];
export const METHOD_INPUTS = ['structure','continuity'] as const;
export interface MethodUsage { operations:ScriptOperation[]; inputs:typeof METHOD_INPUTS[number][]; note:string }
export interface MethodBinding { purposes?: string[]; applicability?: import("../../domain/src/skillMetadata").SkillApplicability; id: string; title: string; version: string; content: string; usage?:MethodUsage }
export interface ContinuityChange { id:string; sceneId:string; value:string; reason:string; sourceHash:string }
export interface Season { id:string; title:string; arc:string }
export interface Storyline { id:string; scopeId:string; lane:'A'|'B'|'C'; title:string; premise:string; resolution:string }
export interface ThreadPlan {
  setupSceneId:string; setupSourceHash:string; dueUnitId:string; payoffChangeId?:string; waiver?:string;
}
export interface ContinuityTrack {
  id:string; scopeId:string; kind:'knowledge'|'relationship'|'prop'|'thread';
  perspective:'character'|'audience'; label:string; characterIds:string[]; initialValue:string;
  changes:ContinuityChange[];
  threadPlan?:ThreadPlan;
}
export interface ScriptProject {
  schemaVersion: typeof SCHEMA_VERSION; id: string;
  /** Internal CAS stamp for the one current manuscript. Not an author version. */
  revision: number; title: string;
  profile: ProjectProfile; brief: { concept: string; theme: string; audienceExperience: string; constraints: string; outline: string };
  characters: Character[]; facts: ScriptFact[];
  /** Verbatim creation input; archival copy, never another editable story source. */
  originalMaterial?: {kind:'idea'|'outline'|'scene';text:string};
  continuityTracks?: ContinuityTrack[];
  seasons?:Season[];
  storylines?:Storyline[];
  /** Only non-project, non-season story scopes; never an automatic copy of brief.outline. */
  storyOutlines?: Array<{ scopeId: string; outline: string }>;
  outlineGuides?: OutlineGuide[];
  /** Historical project bindings; new tasks resolve the global library and keep their own snapshots. */
  methods: MethodBinding[]; units: DeliveryUnit[]; createdAt: number; updatedAt: number;
}
export class ScriptValidationError extends Error {
  statusCode = 400;
  constructor(public path: string, message: string) { super(`${path}: ${message}`); }
}
const fail = (path: string, message: string): never => { throw new ScriptValidationError(path, message); };
function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要对象');
}
function text(value: unknown, path: string, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > 200_000 || (required && !value.trim())) fail(path, '需要有效文本');
}
function integer(value: unknown, path: string, min = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < min) fail(path, `需要不小于 ${min} 的整数`);
}
function choice(value: unknown, values: readonly string[], path: string) {
  if (typeof value !== 'string' || !values.includes(value)) fail(path, `需要选择 ${values.join(' / ')}`);
}
function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) fail(path, '需要最多 10000 项的数组');
}
function strings(value: unknown, path: string) {
  array(value, path); value.forEach((item, i) => text(item, `${path}[${i}]`, true));
}
function boolean(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path, '需要布尔值'); }
function fields(value: Record<string, unknown>, keys: string[], path: string) { keys.forEach(key => text(value[key], `${path}.${key}`)); }
function id(value: unknown, path: string): asserts value is string {
  text(value, path, true); if (!/^[\w-]{1,120}$/.test(value)) fail(path, '标识只能包含字母、数字、横线和下划线');
}
export function parseProjectProfile(value: unknown, path = 'profile'): ProjectProfile {
  object(value, path);
  choice(value.organization, ORGANIZATIONS, `${path}.organization`);
  choice(value.continuity, CONTINUITY_MODES, `${path}.continuity`);
  choice(value.aspectRatio, ['16:9','9:16','1:1'], `${path}.aspectRatio`);
  choice(value.productionMode, ['live-action','AI-video','animation','hybrid'], `${path}.productionMode`);
  text(value.workType, `${path}.workType`, true); text(value.language, `${path}.language`, true);
  strings(value.genres, `${path}.genres`); integer(value.plannedUnits, `${path}.plannedUnits`, 1);
  if (Number(value.plannedUnits) > 1000 || (value.organization === 'standalone' && value.plannedUnits !== 1)) fail(`${path}.plannedUnits`, '单部为 1；分集最多 1000 集');
  integer(value.targetDurationMs, `${path}.targetDurationMs`, 1); integer(value.toleranceMs, `${path}.toleranceMs`);
  if (Number(value.toleranceMs) > Number(value.targetDurationMs)) fail(`${path}.toleranceMs`, '不能超过目标时长');
  boolean(value.includeCredits, `${path}.includeCredits`);
  return value as unknown as ProjectProfile;
}
export function parseScriptBlock(value: unknown, path = 'block'): ScriptBlock {
  object(value, path); id(value.id, `${path}.id`); choice(value.type, BLOCK_TYPES, `${path}.type`);
  text(value.text, `${path}.text`); if (value.speakerId !== undefined) id(value.speakerId, `${path}.speakerId`);
  if (value.speakerName !== undefined) text(value.speakerName, `${path}.speakerName`, true);
  return value as unknown as ScriptBlock;
}
export function parseScene(value: unknown, path = 'scene'): Scene {
  object(value,path); id(value.id,`${path}.id`); text(value.title,`${path}.title`,true);
  fields(value,['location','timeOfDay','storyTime','purpose','entryState','exitState'],path);
  strings(value.characterIds,`${path}.characterIds`); integer(value.targetDurationMs,`${path}.targetDurationMs`);
  if(value.storyOrder!==undefined)integer(value.storyOrder,`${path}.storyOrder`);
  if(value.storylineIds!==undefined)strings(value.storylineIds,`${path}.storylineIds`);
  if(value.structureNodeId!==undefined)id(value.structureNodeId,`${path}.structureNodeId`);
  if(value.outlineRequirementIds!==undefined){strings(value.outlineRequirementIds,`${path}.outlineRequirementIds`);if(new Set(value.outlineRequirementIds as string[]).size!==(value.outlineRequirementIds as string[]).length)fail(path,'大纲映射重复');}
  if(value.generation!==undefined){
    object(value.generation,`${path}.generation`);
    choice(value.generation.status,['partial','complete'],`${path}.generation.status`);
    id(value.generation.checkpointId,`${path}.generation.checkpointId`);
    array(value.generation.appliedSteps,`${path}.generation.appliedSteps`);
    const steps=new Set<string>();
    for(const step of value.generation.appliedSteps){object(step,path);id(step.id,`${path}.generation.step.id`);text(step.digest,`${path}.generation.step.digest`,true);if(!/^[a-f0-9]{64}$/.test(step.digest as string)||steps.has(step.id))fail(path,'续写台账无效或重复');steps.add(step.id);}
  }
  array(value.blocks,`${path}.blocks`); value.blocks.forEach((item,i)=>parseScriptBlock(item,`${path}.blocks[${i}]`));
  return value as unknown as Scene;
}
export function parseTimelineItem(value: unknown, path = 'timelineItem'): TimelineItem {
  object(value,path); id(value.id,`${path}.id`); text(value.track,`${path}.track`,true);
  choice(value.modality,['video','audio'],`${path}.modality`); choice(value.kind,['content','placeholder','gap','marker'],`${path}.kind`);
  if (value.scope !== undefined) choice(value.scope,['story','credits'],`${path}.scope`);
  integer(value.startMs,`${path}.startMs`); integer(value.endMs,`${path}.endMs`);
  if (Number(value.endMs)<Number(value.startMs)) fail(`${path}.endMs`,'结束不能早于开始');
  if (value.kind==='marker' && value.endMs!==value.startMs) fail(path,'标记必须为零长度');
  boolean(value.included,`${path}.included`); fields(value,['label','contentHash'],path);
  if (value.sceneId !== undefined) id(value.sceneId,`${path}.sceneId`);
  return value as unknown as TimelineItem;
}
export function parseTimingEvidence(value: unknown,path='timingEvidence'): TimingEvidence {
  object(value,path); id(value.id,`${path}.id`); choice(value.kind,['estimate','preview','final'],`${path}.kind`);
  choice(value.source,['assumption','synthetic','ffprobe'],`${path}.source`);
  text(value.contentHash,`${path}.contentHash`,true); text(value.assumptions,`${path}.assumptions`);
  integer(value.durationMs,`${path}.durationMs`);
  for (const key of ['lowMs','highMs']) if(value[key]!==undefined) integer(value[key],`${path}.${key}`);
  if (value.lowMs!==undefined && Number(value.lowMs)>Number(value.durationMs) || value.highMs!==undefined && Number(value.highMs)<Number(value.durationMs)) fail(path,'估算范围顺序错误');
  if(value.kind!=='estimate' && value.source==='assumption') fail(path,'假设不能作为实测');
  if(value.mediaUrl!==undefined){text(value.mediaUrl,`${path}.mediaUrl`,true);if(!/^\/media\/script-audio\/[a-f0-9]{64}\.audio$/.test(value.mediaUrl))fail(path,'无效音频地址');}
  if(value.source==='ffprobe') for(const key of ['mediaHash','toolVersion','rawMeasurement','settingsHash']) text(value[key],`${path}.${key}`,true);
  return value as unknown as TimingEvidence;
}
export function parseDeliveryUnit(value: unknown,path='unit'): DeliveryUnit {
  object(value,path); id(value.id,`${path}.id`); id(value.scopeId,`${path}.scopeId`);
  if(value.seasonId!==undefined)id(value.seasonId,`${path}.seasonId`);
  text(value.title,`${path}.title`,true); text(value.summary,`${path}.summary`); integer(value.targetDurationMs,`${path}.targetDurationMs`,1);
  if(value.endingHook!==undefined) text(value.endingHook,`${path}.endingHook`);
  for(const key of ['scenes','timeline','timingEvidence']) array(value[key],`${path}.${key}`);
  (value.scenes as unknown[]).forEach((s,i)=>parseScene(s,`${path}.scenes[${i}]`));
  (value.timeline as unknown[]).forEach((s,i)=>parseTimelineItem(s,`${path}.timeline[${i}]`));
  (value.timingEvidence as unknown[]).forEach((s,i)=>parseTimingEvidence(s,`${path}.timingEvidence[${i}]`));
  if(value.structureNodes!==undefined){
    array(value.structureNodes,`${path}.structureNodes`);
    value.structureNodes.forEach((node,i)=>{const p=`${path}.structureNodes[${i}]`;object(node,p);id(node.id,`${p}.id`);text(node.title,`${p}.title`,true);if(node.parentId!==undefined)id(node.parentId,`${p}.parentId`);if(node.purpose!==undefined)text(node.purpose,`${p}.purpose`);});
  }
  validateUnitStructure(value as unknown as DeliveryUnit,path);
  return value as unknown as DeliveryUnit;
}
/** Validate the directory and canonical scene order together, never silently sort. */
export function validateUnitStructure(unit: DeliveryUnit,path='unit'): void {
  const nodes=unit.structureNodes??[],byId=new Map(nodes.map(node=>[node.id,node]));
  if(byId.size!==nodes.length)fail(path,'结构节点标识重复');
  let currentRoot:string|undefined;
  for(const node of nodes){
    if(node.parentId){const parent=byId.get(node.parentId);if(!parent||parent.parentId||parent.id===node.id)fail(path,'结构最多两层且父节点必须存在');if(nodes.indexOf(parent)>nodes.indexOf(node)||currentRoot!==node.parentId)fail(path,'父子目录须保持连续且父节点排在前面');}
    else currentRoot=node.id;
  }
  for(const scene of unit.scenes)if(scene.structureNodeId&&!byId.has(scene.structureNodeId))fail(scene.id,'所属结构节点不存在');
  const indexes=(node:StructureNode)=>unit.scenes.flatMap((scene,index)=>scene.structureNodeId===node.id||byId.get(scene.structureNodeId??'')?.parentId===node.id?[index]:[]);
  for(const node of nodes){const positions=indexes(node);if(positions.length&&positions.at(-1)!-positions[0]+1!==positions.length)fail(node.id,'结构节点的场景必须形成连续区间');}
  for(const parentId of [undefined,...nodes.filter(node=>!node.parentId).map(node=>node.id)]){
    const siblings=nodes.filter(node=>node.parentId===parentId);let end=-1;
    for(const node of siblings){const positions=indexes(node);if(!positions.length)continue;if(positions[0]<=end)fail(node.id,'目录顺序与场景展示顺序不一致');end=positions.at(-1)!;}
  }
}
export function parseScriptProject(value: unknown): ScriptProject {
  object(value,'project'); choice(value.schemaVersion,[SCHEMA_VERSION],'schemaVersion'); id(value.id,'id');
  integer(value.revision,'revision'); text(value.title,'title',true); parseProjectProfile(value.profile);
  integer(value.createdAt,'createdAt'); integer(value.updatedAt,'updatedAt'); object(value.brief,'brief');
  fields(value.brief,['concept','theme','audienceExperience','constraints','outline'],'brief');
  if(value.originalMaterial!==undefined){
    object(value.originalMaterial,'originalMaterial');
    choice(value.originalMaterial.kind,['idea','outline','scene'],'originalMaterial.kind');
    text(value.originalMaterial.text,'originalMaterial.text');
  }
  for(const key of ['characters','facts','methods','units']) array(value[key],key);
  if(!(value.units as unknown[]).length)fail('units','作品至少需要一个交付单元');
  const seen=new Set<string>();
  const unique=(itemId:string)=>{ if(seen.has(itemId)) fail(itemId,'标识重复'); seen.add(itemId); };
  (value.characters as unknown[]).forEach((c,i)=>{
    const p=`characters[${i}]`; object(c,p); id(c.id,`${p}.id`); unique(c.id); id(c.scopeId,`${p}.scopeId`);
    text(c.name,`${p}.name`,true); fields(c,['desire','need','contradiction','arc','voice'],p);if(c.bio!==undefined)text(c.bio,`${p}.bio`);
  });
  (value.facts as unknown[]).forEach((f,i)=>{const p=`facts[${i}]`; object(f,p); id(f.id,`${p}.id`); unique(f.id); id(f.scopeId,`${p}.scopeId`); text(f.text,`${p}.text`); choice(f.status,['draft','approved'],`${p}.status`);});
  (value.methods as unknown[]).forEach((m,i)=>{
    const p=`methods[${i}]`; object(m,p); text(m.id,`${p}.id`,true); unique(String(m.id)); fields(m,['title','version','content'],p);
    validateSkillMetadata({ purposes: m.purposes as string[] | undefined, applicability: m.applicability as SkillApplicability | undefined });
    if(m.usage!==undefined){
      object(m.usage,`${p}.usage`);array(m.usage.operations,`${p}.usage.operations`);array(m.usage.inputs,`${p}.usage.inputs`);text(m.usage.note,`${p}.usage.note`);
      m.usage.operations.forEach(v=>choice(v,SCRIPT_OPERATIONS,`${p}.usage.operations`));m.usage.inputs.forEach(v=>choice(v,METHOD_INPUTS,`${p}.usage.inputs`));
      if(new Set(m.usage.operations).size!==m.usage.operations.length||new Set(m.usage.inputs).size!==m.usage.inputs.length)fail(p,'Skill 挂载配置不能重复');
    }
  });
  const project=value as unknown as ScriptProject;
  if(project.seasons!==undefined){
    array(project.seasons,'seasons');
    project.seasons.forEach((s,i)=>{const p=`seasons[${i}]`;object(s,p);id(s.id,`${p}.id`);unique(s.id);text(s.title,`${p}.title`,true);text(s.arc,`${p}.arc`);});
  }
  const characters=new Set(project.characters.map(c=>c.id));
  const seasons=new Set(project.seasons?.map(s=>s.id)||[]);
  const scopes=new Set([project.id,...seasons,...project.units.flatMap(u=>[u.id,u.scopeId])]);
  if(project.storyOutlines!==undefined){
    array(project.storyOutlines,'storyOutlines');const claimed=new Set<string>();
    project.storyOutlines.forEach((item,i)=>{const p=`storyOutlines[${i}]`;object(item,p);id(item.scopeId,`${p}.scopeId`);text(item.outline,`${p}.outline`);if(!scopes.has(item.scopeId)||item.scopeId===project.id||seasons.has(item.scopeId)||claimed.has(item.scopeId))fail(p,'故事大纲作用域不存在、重复或应使用作品/季大纲');claimed.add(item.scopeId);});
  }
  if(project.storylines!==undefined){
    array(project.storylines,'storylines');
    project.storylines.forEach((s,i)=>{const p=`storylines[${i}]`;object(s,p);id(s.id,`${p}.id`);unique(s.id);id(s.scopeId,`${p}.scopeId`);if(!scopes.has(s.scopeId))fail(p,'故事线作用域不存在');choice(s.lane,['A','B','C'],`${p}.lane`);text(s.title,`${p}.title`,true);fields(s,['premise','resolution'],p);});
  }
  const storylines=new Set(project.storylines?.map(s=>s.id)||[]);
  for(const entity of [...project.characters,...project.facts])if(!scopes.has(entity.scopeId))fail(entity.id,'连续性作用域不存在');
  project.units.forEach((u,i)=>{
    parseDeliveryUnit(u,`units[${i}]`); unique(u.id);
    u.structureNodes?.forEach(node=>unique(node.id));
    if(u.seasonId&&!seasons.has(u.seasonId))fail(u.id,'所属季不存在');
    const scenes=new Set(u.scenes.map(s=>s.id));
    u.scenes.forEach(s=>{unique(s.id); s.characterIds.forEach(c=>{if(!characters.has(c)) fail(s.id,'人物引用不存在');});
      if(new Set(s.storylineIds).size!==(s.storylineIds?.length||0))fail(s.id,'故事线引用重复');
      s.storylineIds?.forEach(id=>{if(!storylines.has(id))fail(s.id,'故事线引用不存在');});
      s.blocks.forEach(b=>{unique(b.id); if(b.speakerId && !characters.has(b.speakerId)) fail(b.id,'说话者不存在');});});
    u.timeline.forEach(t=>{unique(t.id); if(t.sceneId && !scenes.has(t.sceneId)) fail(t.id,'场景引用不存在');});
    u.timingEvidence.forEach(e=>unique(e.id));
  });
  if(project.continuityTracks!==undefined){
    array(project.continuityTracks,'continuityTracks');
    project.continuityTracks.forEach((t,i)=>{
      const p=`continuityTracks[${i}]`;object(t,p);id(t.id,`${p}.id`);unique(t.id);id(t.scopeId,`${p}.scopeId`);
      if(!scopes.has(t.scopeId))fail(p,'连续性作用域不存在');
      choice(t.kind,['knowledge','relationship','prop','thread'],`${p}.kind`);choice(t.perspective,['character','audience'],`${p}.perspective`);
      text(t.label,`${p}.label`,true);text(t.initialValue,`${p}.initialValue`);strings(t.characterIds,`${p}.characterIds`);
      for(const id of t.characterIds)if(!characters.has(id))fail(p,'关联人物不存在');
      array(t.changes,`${p}.changes`);
      for(const c of t.changes){object(c,p);id(c.id,`${p}.change.id`);unique(c.id);id(c.sceneId,`${p}.sceneId`);fields(c,['value','reason','sourceHash'],p);}
      if(t.threadPlan!==undefined){
        const plan=t.threadPlan;object(plan,`${p}.threadPlan`);if(t.kind!=='thread')fail(p,'只有伏笔可设置回收计划');
        id(plan.setupSceneId,`${p}.setupSceneId`);text(plan.setupSourceHash,`${p}.setupSourceHash`);id(plan.dueUnitId,`${p}.dueUnitId`);
        if(plan.payoffChangeId!==undefined)id(plan.payoffChangeId,`${p}.payoffChangeId`);
        if(plan.waiver!==undefined)text(plan.waiver,`${p}.waiver`);
        // Deleted evidence remains readable so the writer can repair the link.
      }
    });
  }
  validateOutlineGuides(project);
  if(project.units.length>project.profile.plannedUnits) fail('units','交付单元数超过计划集数');
  return structuredClone(project);
}
