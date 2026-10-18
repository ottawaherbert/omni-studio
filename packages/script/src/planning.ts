import type { DeliveryUnit, Scene, ScriptProject } from './schema';
import { newScene, newUnit } from './project';

export interface ProposedScene {
  title?: string;
  purpose?: string;
  entryState?: string;
  exitState?: string;
}
export interface ProposedUnit {
  unitIndex?: number;
  title?: string;
  summary?: string;
  cliffhanger?: string;
  scenes?: ProposedScene[];
}

export interface ScriptChoice {title:string;content:string;subtitle?:string;extra?:{purpose?:string;entryState?:string;exitState?:string}}
export function parseScriptChoices(raw:string):ScriptChoice[]{
  const clean=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  let decoded:unknown;
  try{decoded=JSON.parse(clean);}catch{throw new Error('建议返回不是完整 JSON 数组');}
  if(!Array.isArray(decoded)||!decoded.length||decoded.length>5)throw new Error('建议需要 1–5 个方案');
  const validText=(value:unknown,label:string,required=false)=>{
    if(value===undefined&&!required)return undefined;
    if(typeof value!=='string'||(required&&!value.trim())||value.length>20000)throw new Error(`${label}需要有效文本`);
    return value.trim();
  };
  return decoded.map((rawChoice,index)=>{
    if(!rawChoice||typeof rawChoice!=='object'||Array.isArray(rawChoice))throw new Error(`第 ${index+1} 个方案格式不正确`);
    const choice=rawChoice as Record<string,unknown>;
    if(Object.keys(choice).some(key=>!['title','subtitle','content','extra'].includes(key)))throw new Error(`第 ${index+1} 个方案包含未授权字段`);
    let extra:ScriptChoice['extra'];
    if(choice.extra!==undefined){
      if(!choice.extra||typeof choice.extra!=='object'||Array.isArray(choice.extra))throw new Error(`第 ${index+1} 个方案的场景资料格式不正确`);
      const source=choice.extra as Record<string,unknown>;
      if(Object.keys(source).some(key=>!['purpose','entryState','exitState'].includes(key)))throw new Error(`第 ${index+1} 个方案的场景资料包含未授权字段`);
      extra={purpose:validText(source.purpose,'场景发生的事'),entryState:validText(source.entryState,'入场状况'),exitState:validText(source.exitState,'结束变化')};
    }
    return {title:validText(choice.title,'方案标题',true)!,content:validText(choice.content,'方案内容',true)!,subtitle:validText(choice.subtitle,'方案说明'),...(extra?{extra}:{})};
  });
}

/** Unit outlines have a narrower write contract than scene planning. */
export function parseProposedUnitOutlines(value:unknown,maxUnits:number,allowedUnitIndices?:number[]):ProposedUnit[]{
  if(!Array.isArray(value)||!value.length||value.length>maxUnits)throw new Error(`单元大纲需要 1–${maxUnits} 项`);
  const seen=new Set<number>();
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('单元大纲需要对象');
    const unit=item as Record<string,unknown>;
    if(Object.keys(unit).some(key=>!['unitIndex','title','summary'].includes(key)))throw new Error('单元大纲只接受序号、标题与大纲，不可修改分场或结尾');
    if(!Number.isInteger(unit.unitIndex)||Number(unit.unitIndex)<1||Number(unit.unitIndex)>maxUnits||seen.has(Number(unit.unitIndex))||allowedUnitIndices&&!allowedUnitIndices.includes(Number(unit.unitIndex)))throw new Error('单元序号无效、重复或超出本批范围');
    seen.add(Number(unit.unitIndex));
    if(typeof unit.summary!=='string'||!unit.summary.trim()||unit.summary.length>20000)throw new Error('单元大纲需要非空文本');
    if(unit.title!==undefined&&(typeof unit.title!=='string'||unit.title.length>20000))throw new Error('单元标题需要有效文本');
    return {unitIndex:Number(unit.unitIndex),summary:unit.summary.trim(),...(unit.title?{title:unit.title as string}:{})};
  });
}

/** Validate bulk AI plans before showing an adoptable proposal. */
export function parseProposedSceneUnits(value:unknown,maxUnits:number,allowedUnitIndices?:number[]):ProposedUnit[]{
  if(!Array.isArray(value)||value.length<1||value.length>maxUnits)throw new Error(`分场建议需要 1–${maxUnits} 个单元`);
  let totalScenes=0;
  const used=new Set<number>();
  const optionalText=(value:unknown,label:string)=>{
    if(value!==undefined&&(typeof value!=='string'||value.length>20000))throw new Error(`${label}需要有效文本`);
    return value as string|undefined;
  };
  return value.map((raw,index)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`第 ${index+1} 个单元格式不正确`);
    const unit=raw as Record<string,unknown>;
    const unitIndex=unit.unitIndex===undefined?index+1:unit.unitIndex;
    if(!Number.isInteger(unitIndex)||Number(unitIndex)<1||Number(unitIndex)>maxUnits||used.has(Number(unitIndex))||allowedUnitIndices&&!allowedUnitIndices.includes(Number(unitIndex)))throw new Error(`第 ${index+1} 个单元的序号无效、重复或超出本批范围`);
    used.add(Number(unitIndex));
    if(!Array.isArray(unit.scenes)||!unit.scenes.length||unit.scenes.length>200)throw new Error(`第 ${unitIndex} 个单元需要 1–200 场`);
    totalScenes+=unit.scenes.length;
    if(totalScenes>2000)throw new Error('一次最多规划 2000 场');
    const scenes=unit.scenes.map((rawScene:unknown,sceneIndex:number)=>{
      if(!rawScene||typeof rawScene!=='object'||Array.isArray(rawScene))throw new Error(`第 ${unitIndex} 单元第 ${sceneIndex+1} 场格式不正确`);
      const scene=rawScene as Record<string,unknown>;
      if(typeof scene.purpose!=='string'||!scene.purpose.trim()||scene.purpose.length>20000)throw new Error(`第 ${unitIndex} 单元第 ${sceneIndex+1} 场缺少“发生什么”`);
      return {title:optionalText(scene.title,'场景标题'),purpose:scene.purpose.trim(),entryState:optionalText(scene.entryState,'入场状况'),exitState:optionalText(scene.exitState,'结束变化')};
    });
    return {unitIndex:Number(unitIndex),title:optionalText(unit.title,'单元标题'),summary:optionalText(unit.summary,'单元大纲'),cliffhanger:optionalText(unit.cliffhanger,'结尾安排'),scenes};
  });
}

export function sceneHasAuthorWork(scene: Scene, project?: ScriptProject): boolean {
  return scene.blocks.some(block => block.text.trim() || block.type!=='action' || block.speakerId || block.speakerName || Object.keys(block).some(key=>!['id','type','text','speakerId','speakerName'].includes(key))) ||
    Boolean(scene.purpose.trim() || scene.location.trim() || scene.timeOfDay.trim() || scene.storyTime.trim() || scene.entryState.trim() || scene.exitState.trim()) ||
    scene.characterIds.length > 0 || scene.targetDurationMs > 0 || scene.storyOrder !== undefined || Boolean(scene.storylineIds?.length) ||
    Boolean(scene.structureNodeId||scene.outlineRequirementIds?.length||scene.generation) ||
    Boolean(project?.units.some(unit=>unit.timeline.some(item=>item.sceneId===scene.id))) ||
    Boolean(project?.continuityTracks?.some(track=>track.changes.some(change=>change.sceneId===scene.id)||track.threadPlan?.setupSceneId===scene.id)) ||
    Object.keys(scene).some(key=>!['id','title','location','timeOfDay','storyTime','purpose','entryState','exitState','characterIds','targetDurationMs','blocks','storyOrder','storylineIds','structureNodeId','outlineRequirementIds','generation'].includes(key)) ||
    !/^第\s*\d+\s*场$/.test(scene.title.trim());
}

export function unitHasAuthorWork(unit: DeliveryUnit): boolean {
  return Boolean(unit.summary.trim() || unit.endingHook?.trim() || unit.structureNodes?.length || unit.scenes.length>1 || unit.scenes.some(scene=>sceneHasAuthorWork(scene)));
}

export function ensurePlannedUnits(project: ScriptProject): void {
  if (project.profile.organization === 'standalone') return;
  while (project.units.length < project.profile.plannedUnits) {
    const scopeId = ['anthology', 'procedural'].includes(project.profile.continuity) ? undefined : project.id;
    project.units.push(newUnit(`第 ${project.units.length + 1} 集`, project.profile.targetDurationMs, scopeId));
  }
}

function ensureReturnedUnits(project:ScriptProject,proposals:ProposedUnit[],allowedUnitIndices?:number[]):void{
  const indices=proposals.map((proposal,index)=>proposal.unitIndex??index+1);
  if(new Set(indices).size!==indices.length||indices.some(index=>!Number.isInteger(index)||index<1||index>project.profile.plannedUnits||allowedUnitIndices&&!allowedUnitIndices.includes(index)))throw new Error('返回单元超出本批授权范围或重复');
  // Missing requested units remain missing. Never manufacture up to plannedUnits.
  let length=project.units.length;const additions:number[]=[];
  for(const index of [...indices].sort((a,b)=>a-b)){
    if(index<=length)continue;
    if(index!==length+1)throw new Error('返回单元与已有场序不连续，请先补回缺失的前一集');
    length++;additions.push(index);
  }
  for(const index of additions){
    const scopeId=['anthology','procedural'].includes(project.profile.continuity)?undefined:project.id;
    project.units.push(newUnit(`第 ${index} 集`,project.profile.targetDurationMs,scopeId));
  }
}
export function applyUnitOutlines(project: ScriptProject, proposals: ProposedUnit[],allowedUnitIndices?:number[]): number {
  ensureReturnedUnits(project,proposals,allowedUnitIndices);
  let applied = 0;
  const claimed = new Set<number>();
  proposals.forEach((proposal, index) => {
    const targetIndex = Number.isInteger(proposal.unitIndex) ? proposal.unitIndex! - 1 : index;
    if (targetIndex < 0 || targetIndex >= project.units.length || claimed.has(targetIndex)) return;
    claimed.add(targetIndex);
    const unit = project.units[targetIndex];
    const hadWork = unitHasAuthorWork(unit);
    if (!unit.summary.trim() && typeof proposal.summary === 'string' && proposal.summary.trim()) {
      unit.summary = proposal.summary.trim();
      applied++;
    }
    if (typeof proposal.title === 'string' && proposal.title.trim() && !hadWork) unit.title = proposal.title.trim();
  });
  return applied;
}

export function applyScenePlans(project: ScriptProject, proposals: ProposedUnit[],allowedUnitIndices?:number[]): { applied: number; preserved: number } {
  if(allowedUnitIndices&&proposals.some((proposal,index)=>!allowedUnitIndices.includes(proposal.unitIndex??index+1)))throw new Error('分场建议超出本批授权范围');
  let applied = 0;
  let preserved = 0;
  const claimed = new Set<number>();
  proposals.forEach((proposal, index) => {
    const targetIndex = Number.isInteger(proposal.unitIndex) ? proposal.unitIndex! - 1 : index;
    if (targetIndex < 0 || targetIndex >= project.units.length || claimed.has(targetIndex)) return;
    claimed.add(targetIndex);
    const unit = project.units[targetIndex];
    if (!Array.isArray(proposal.scenes) || !proposal.scenes.length) return;
    if (unit.scenes.length>1 || unit.structureNodes?.length || unit.scenes.some(scene=>sceneHasAuthorWork(scene,project))) { preserved++; return; }
    unit.scenes = proposal.scenes.filter(item => item && typeof item === 'object').map((item, sceneIndex) => {
      const scene = newScene(typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `第 ${sceneIndex + 1} 场`);
      scene.purpose = typeof item.purpose === 'string' ? item.purpose : '';
      scene.entryState = typeof item.entryState === 'string' ? item.entryState : '';
      scene.exitState = typeof item.exitState === 'string' ? item.exitState : '';
      return scene;
    });
    if (unit.scenes.length) applied++;
  });
  return { applied, preserved };
}

export function applyWholeBoardPlan(project: ScriptProject, proposals: ProposedUnit[],allowedUnitIndices?:number[]): { applied: number; preserved: number } {
  ensureReturnedUnits(project,proposals,allowedUnitIndices);
  proposals.forEach((proposal, index) => {
    const targetIndex = Number.isInteger(proposal.unitIndex) ? proposal.unitIndex! - 1 : index;
    const unit = project.units[targetIndex];
    if (!unit) return;
    if(unit.scenes.length>1||unit.structureNodes?.length||unit.scenes.some(scene=>sceneHasAuthorWork(scene,project)))return;
    if (!unit.summary.trim() && typeof proposal.summary === 'string') unit.summary = proposal.summary.trim();
    if (!unit.endingHook?.trim() && typeof proposal.cliffhanger === 'string') unit.endingHook = proposal.cliffhanger.trim();
  });
  return applyScenePlans(project, proposals,allowedUnitIndices);
}
